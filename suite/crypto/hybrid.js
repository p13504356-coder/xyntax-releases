/* XBS · hybrid.js — hybrid key encapsulation: WebCrypto ECDH (X25519 when the runtime offers it, else P-256) combined with
 * ML-KEM-768, the two secrets bound together through HKDF-SHA-256.
 *
 * Why "concatenate and KDF": the shared secret is HKDF(ecdh_ss ‖ mlkem_ss ‖ transcript). If either component is broken —
 * the elliptic curve by a quantum computer, or ML-KEM by cryptanalysis of a young scheme — the other still contributes 32
 * bytes of entropy the attacker does not have, and the transcript (both public keys and the ML-KEM ciphertext) binds the
 * key to this exchange so a secret cannot be replayed into another context. This is the construction used by the IETF
 * hybrid drafts and by the major messengers' PQ upgrades; it is not a novel scheme.
 *
 * Status: tested for round trip, curve detection, transcript binding and tamper behaviour (../../test/crypto/hybrid.test.js).
 * The ML-KEM half carries the caveats in mlkem.js (self-consistent, not KAT-validated). The ECDH half is WebCrypto's.
 *
 * API (global HYBRID / module.exports), all async:
 *   curve()                        → "X25519" | "P-256" (decided once at first use)
 *   hybridKeygen()                 → { pub: { curve, ec: Uint8Array, kem: Uint8Array(1184) }, priv: { curve, ecKey: CryptoKey, ecPkcs8: Uint8Array, kemDk: Uint8Array(2400) } }
 *   hybridEncaps(peerPub)          → { ct: { ec: Uint8Array (ephemeral EC public), kem: Uint8Array(1088) }, ss: Uint8Array(32) }
 *   hybridDecaps(priv, ct)         → ss (32 bytes)
 *   exportPriv(priv) / importPriv(obj) → plain objects of Uint8Arrays for sealing under a device key
 *   serializePub(pub) / parsePub(bytes)  — a compact byte form for transport
 */
(function (root) {
  "use strict";
  const isNode = typeof module !== "undefined" && module.exports;
  const MLKEM = isNode ? require("./mlkem.js") : root.MLKEM;
  const subtle = (root.crypto && root.crypto.subtle) || require("crypto").webcrypto.subtle;
  const cat = (...parts) => { let n = 0; for (const p of parts) n += p.length; const out = new Uint8Array(n); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };
  const enc = new TextEncoder();
  let CURVE = null;
  async function curve() {
    if (CURVE) return CURVE;
    try { await subtle.generateKey({ name: "X25519" }, true, ["deriveBits"]); CURVE = "X25519"; } catch (e) { CURVE = "P-256"; }
    return CURVE;
  }
  const alg = (c) => c === "X25519" ? { name: "X25519" } : { name: "ECDH", namedCurve: "P-256" };
  const importPub = (c, raw) => subtle.importKey("raw", raw, alg(c), true, []);
  async function ecdh(c, priv, peerRaw) { const pub = await importPub(c, peerRaw); const bits = await subtle.deriveBits(c === "X25519" ? { name: "X25519", public: pub } : { name: "ECDH", public: pub }, priv, 256); return new Uint8Array(bits); }
  async function hkdf(ikm, salt, info, len) { const k = await subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]); return new Uint8Array(await subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, k, len * 8)); }
  // info = curve name ‖ SHA-256(transcript): the transcript (both public keys and the KEM ciphertext) is a few kilobytes, and
  // WebCrypto implementations cap HKDF's info length, so it is hashed first; the binding is the same
  async function combine(c, ecSs, kemSs, transcript) { const th = new Uint8Array(await subtle.digest("SHA-256", transcript)); const out = await hkdf(cat(ecSs, kemSs), enc.encode("XBS-HYBRID-KEM-v1"), cat(enc.encode(c), th), 32); ecSs.fill(0); kemSs.fill(0); return out; }

  async function hybridKeygen() {
    const c = await curve(); const pair = await subtle.generateKey(alg(c), true, ["deriveBits"]);
    const ec = new Uint8Array(await subtle.exportKey("raw", pair.publicKey)); const ecPkcs8 = new Uint8Array(await subtle.exportKey("pkcs8", pair.privateKey));
    const { ek, dk } = MLKEM.keygen();
    return { pub: { curve: c, ec, kem: ek }, priv: { curve: c, ecKey: pair.privateKey, ecPkcs8, kemDk: dk, ecPub: ec } };
  }
  async function hybridEncaps(peerPub) {
    const c = peerPub.curve; if (c !== await curve()) throw new Error("peer uses " + c + ", this runtime " + CURVE);
    const eph = await subtle.generateKey(alg(c), true, ["deriveBits"]); const ephRaw = new Uint8Array(await subtle.exportKey("raw", eph.publicKey));
    const ecSs = await ecdh(c, eph.privateKey, peerPub.ec); const { ct: kemCt, ss: kemSs } = MLKEM.encaps(peerPub.kem);
    const ss = await combine(c, ecSs, kemSs, cat(peerPub.ec, ephRaw, peerPub.kem, kemCt));
    return { ct: { ec: ephRaw, kem: kemCt }, ss };
  }
  async function hybridDecaps(priv, ct) {
    const c = priv.curve; const ecKey = priv.ecKey || await subtle.importKey("pkcs8", priv.ecPkcs8, alg(c), true, ["deriveBits"]);
    const ecSs = await ecdh(c, ecKey, ct.ec); const kemSs = MLKEM.decaps(priv.kemDk, ct.kem);
    const myEc = priv.ecPub || (priv.ecPub = await pubFromPriv(c, priv.ecPkcs8));
    const myKem = priv.kemDk.subarray(384 * 3, 768 * 3 + 32);
    return combine(c, ecSs, kemSs, cat(myEc, ct.ec, myKem, ct.kem));
  }
  // the public half of a stored private key: JWK carries x (and y) for both curves
  async function pubFromPriv(c, pkcs8) { const k = await subtle.importKey("pkcs8", pkcs8, alg(c), true, ["deriveBits"]); const jwk = await subtle.exportKey("jwk", k); delete jwk.d; jwk.key_ops = []; const pub = await subtle.importKey("jwk", jwk, alg(c), true, []); return new Uint8Array(await subtle.exportKey("raw", pub)); }
  const exportPriv = (priv) => ({ curve: priv.curve, ecPkcs8: priv.ecPkcs8, kemDk: priv.kemDk, ecPub: priv.ecPub });
  async function importPriv(o) { const ecKey = await subtle.importKey("pkcs8", o.ecPkcs8, alg(o.curve), true, ["deriveBits"]); return { curve: o.curve, ecKey, ecPkcs8: o.ecPkcs8, kemDk: o.kemDk, ecPub: o.ecPub || await pubFromPriv(o.curve, o.ecPkcs8) }; }
  const serializePub = (pub) => cat(Uint8Array.of(pub.curve === "X25519" ? 1 : 2, pub.ec.length), pub.ec, pub.kem);
  const parsePub = (b) => { const c = b[0] === 1 ? "X25519" : "P-256", n = b[1]; return { curve: c, ec: b.slice(2, 2 + n), kem: b.slice(2 + n) }; };

  const API = { curve, hybridKeygen, hybridEncaps, hybridDecaps, exportPriv, importPriv, serializePub, parsePub, _hkdf: hkdf, _ecdh: ecdh, _alg: alg };
  if (isNode) module.exports = API; else root.HYBRID = API;
})(typeof globalThis !== "undefined" ? globalThis : this);
