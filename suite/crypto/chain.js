/* XBS · chain.js — a hash-chained, tamper-evident log. Every entry carries its sequence number, a timestamp, the previous
 * entry's hash and its own SHA-256 over the canonical JSON of { seq, ts, prev, entry }; optionally each hash is signed with a
 * device's ECDSA P-256 key. Changing, removing or reordering any entry breaks every hash after it; forging one needs the
 * signing key. Append-only by construction; the operator of the store can truncate the tail (the last hash published or
 * countersigned elsewhere makes even that visible), which is why XBS exports the head hash with every air-gap bundle.
 *
 * Canonical JSON: object keys sorted, no whitespace, numbers as JSON prints them, strings as JSON escapes them; arrays keep
 * order. Entries must be JSON-serialisable (no undefined, no cycles, no non-finite numbers).
 *
 * Tested in ../../test/crypto/chain.test.js. Not reviewed by a third party.
 *
 * API (global CHAIN / module.exports), async where WebCrypto is involved:
 *   canonical(value) → string
 *   append(log (array), entry, signer?) → the new record { seq, ts, prev, hash, entry, sig? }  (pushes onto log)
 *   verify(log) → { ok, brokenAt (seq of the first bad record or -1), head }
 *   generateSigner() → { priv: CryptoKey, pubRaw: Uint8Array, privPkcs8 }     sign(priv, hash) / verifyChain(log, pubRaw) → { ok, brokenAt }
 */
(function (root) {
  "use strict";
  const isNode = typeof module !== "undefined" && module.exports;
  const subtle = (root.crypto && root.crypto.subtle) || require("crypto").webcrypto.subtle;
  const enc = new TextEncoder(); const GENESIS = "0".repeat(64);
  const hex = (u) => Array.from(u, (b) => b.toString(16).padStart(2, "0")).join(""); const unhex = (s) => Uint8Array.from(s.match(/../g).map((h) => parseInt(h, 16)));
  function canonical(v) {
    if (v === null || typeof v === "boolean" || typeof v === "string") return JSON.stringify(v);
    if (typeof v === "number") { if (!Number.isFinite(v)) throw new Error("non-finite number"); return JSON.stringify(v); }
    if (Array.isArray(v)) return "[" + v.map(canonical).join(",") + "]";
    if (typeof v === "object") return "{" + Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => JSON.stringify(k) + ":" + canonical(v[k])).join(",") + "}";
    throw new Error("not serialisable: " + typeof v);
  }
  const sha = async (s) => hex(new Uint8Array(await subtle.digest("SHA-256", enc.encode(s))));
  const hashOf = (rec) => sha(canonical({ seq: rec.seq, ts: rec.ts, prev: rec.prev, entry: rec.entry }));
  async function append(log, entry, signer) {
    const prev = log.length ? log[log.length - 1].hash : GENESIS; const rec = { seq: log.length, ts: new Date().toISOString(), prev, entry: JSON.parse(canonical(entry)) };
    rec.hash = await hashOf(rec); if (signer) rec.sig = hex(await sign(signer.priv || signer, rec.hash)); log.push(rec); return rec;
  }
  async function verify(log) {
    let prev = GENESIS;
    for (let i = 0; i < log.length; i++) { const r = log[i]; if (r.seq !== i || r.prev !== prev || (await hashOf(r)) !== r.hash) return { ok: false, brokenAt: i, head: null }; prev = r.hash; }
    return { ok: true, brokenAt: -1, head: prev };
  }
  async function generateSigner() { const pair = await subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]); return { priv: pair.privateKey, pubRaw: new Uint8Array(await subtle.exportKey("raw", pair.publicKey)), privPkcs8: new Uint8Array(await subtle.exportKey("pkcs8", pair.privateKey)) }; }
  const sign = async (priv, hashHex) => new Uint8Array(await subtle.sign({ name: "ECDSA", hash: "SHA-256" }, priv, unhex(hashHex)));
  async function verifyChain(log, pubRaw) {
    const base = await verify(log); if (!base.ok) return base; const pub = await subtle.importKey("raw", pubRaw, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    for (let i = 0; i < log.length; i++) { const r = log[i]; if (!r.sig || !(await subtle.verify({ name: "ECDSA", hash: "SHA-256" }, pub, unhex(r.sig), unhex(r.hash)))) return { ok: false, brokenAt: i, head: null }; }
    return base;
  }
  const API = { canonical, append, verify, generateSigner, sign, verifyChain, GENESIS };
  if (isNode) module.exports = API; else root.CHAIN = API;
})(typeof globalThis !== "undefined" ? globalThis : this);
