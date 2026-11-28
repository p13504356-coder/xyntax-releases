/* XBS · mlkem.js — ML-KEM-768 (FIPS 203): K-PKE and the ML-KEM key encapsulation mechanism with implicit rejection.
 *
 * Pure JavaScript over keccak.js. Parameter set 768 only (k = 3, η1 = η2 = 2, du = 10, dv = 4): ek 1184 bytes, dk 2400 bytes,
 * ciphertext 1088 bytes, shared secret 32 bytes.
 *
 * STATUS — read before relying on it:
 *   · Self-consistent: keygen/encaps/decaps round-trip, implicit rejection, determinism and the NTT/arithmetic are tested
 *     (../../test/crypto/mlkem.test.js).
 *   · NOT validated against the official FIPS 203 known-answer tests (they were not available offline when this was written)
 *     and therefore NOT demonstrated to interoperate with other implementations. The points most likely to differ from the
 *     standard if anything does: the byte order of the matrix seed (ρ‖j‖i, as in FIPS 203 Algorithm 13), G(d‖k) in KeyGen,
 *     and the SampleNTT rejection parsing. Run the KATs before this is used between XBS and any non-XBS system.
 *   · Not constant time: JavaScript gives no such guarantee; secrets are zeroed where the language allows.
 *   · No third-party review yet.
 *
 * API (global MLKEM in the renderer, module.exports under Node):
 *   keygen(seed?)            seed = 64 bytes (d‖z) or omitted for random → { ek: Uint8Array(1184), dk: Uint8Array(2400) }
 *   encaps(ek, m?)           m = 32 random bytes or omitted → { ct: Uint8Array(1088), ss: Uint8Array(32) }
 *   decaps(dk, ct)           → ss (32 bytes; a wrong ciphertext yields the implicit-rejection secret, never a throw)
 *   SIZES                    { ek, dk, ct, ss }
 *   _internal                the arithmetic (ntt, invNtt, mulNtt, compress, decompress, encode, decode) for the tests
 */
(function (root) {
  "use strict";
  const K = typeof module !== "undefined" && module.exports ? require("./keccak.js") : root.KECCAK;
  const Q = 3329, N = 256, KK = 3, ETA1 = 2, ETA2 = 2, DU = 10, DV = 4;
  const SIZES = { ek: 384 * KK + 32, dk: 768 * KK + 96, ct: 32 * (DU * KK + DV), ss: 32 };
  const rnd = (n) => { const b = new Uint8Array(n); (root.crypto || require("crypto").webcrypto).getRandomValues(b); return b; };
  const cat = (...parts) => { let n = 0; for (const p of parts) n += p.length; const out = new Uint8Array(n); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };

  // ---------- arithmetic in Z_q[X]/(X^256+1), NTT form per FIPS 203 §4.3
  const bitrev7 = (i) => { let r = 0; for (let b = 0; b < 7; b++) r |= ((i >> b) & 1) << (6 - b); return r; };
  const powq = (b, e) => { let r = 1, x = b % Q; while (e > 0) { if (e & 1) r = (r * x) % Q; x = (x * x) % Q; e >>= 1; } return r; };
  const ZETAS = new Int32Array(128); for (let i = 0; i < 128; i++) ZETAS[i] = powq(17, bitrev7(i));
  const GAMMAS = new Int32Array(128); for (let i = 0; i < 128; i++) GAMMAS[i] = powq(17, 2 * bitrev7(i) + 1);
  const mod = (a) => { a %= Q; return a < 0 ? a + Q : a; };

  function ntt(f) { // in place, f: Int32Array(256) of coefficients
    let k = 1;
    for (let len = 128; len >= 2; len >>= 1) for (let start = 0; start < N; start += 2 * len) { const z = ZETAS[k++]; for (let j = start; j < start + len; j++) { const t = (z * f[j + len]) % Q; f[j + len] = mod(f[j] - t); f[j] = (f[j] + t) % Q; } }
    return f;
  }
  function invNtt(f) {
    let k = 127;
    for (let len = 2; len <= 128; len <<= 1) for (let start = 0; start < N; start += 2 * len) { const z = ZETAS[k--]; for (let j = start; j < start + len; j++) { const t = f[j]; f[j] = (t + f[j + len]) % Q; f[j + len] = (z * mod(f[j + len] - t)) % Q; } }
    for (let i = 0; i < N; i++) f[i] = (f[i] * 3303) % Q; // 128^-1 mod q
    return f;
  }
  function mulNtt(a, b) { // pointwise product of two NTT-form polynomials
    const c = new Int32Array(N);
    for (let i = 0; i < 128; i++) { const a0 = a[2 * i], a1 = a[2 * i + 1], b0 = b[2 * i], b1 = b[2 * i + 1]; c[2 * i] = (a0 * b0 + ((a1 * b1) % Q) * GAMMAS[i]) % Q; c[2 * i + 1] = (a0 * b1 + a1 * b0) % Q; }
    return c;
  }
  const addp = (a, b) => { const c = new Int32Array(N); for (let i = 0; i < N; i++) c[i] = (a[i] + b[i]) % Q; return c; };
  const subp = (a, b) => { const c = new Int32Array(N); for (let i = 0; i < N; i++) c[i] = mod(a[i] - b[i]); return c; };

  // ---------- compression and byte coding (§4.2.1)
  const compress = (x, d) => (((x << d) + (Q >> 1)) / Q | 0) & ((1 << d) - 1);
  const decompress = (y, d) => (Q * y + (1 << (d - 1))) >> d;
  function encode(f, d) { // 256 d-bit integers → 32d bytes, little-endian bit order
    const out = new Uint8Array(32 * d); let acc = 0, bits = 0, o = 0;
    for (let i = 0; i < N; i++) { acc |= (f[i] & ((1 << d) - 1)) << bits; bits += d; while (bits >= 8) { out[o++] = acc & 0xff; acc >>>= 8; bits -= 8; } }
    return out;
  }
  function decode(b, d) {
    const f = new Int32Array(N); let acc = 0, bits = 0, o = 0; const m = d === 12 ? Q : (1 << d);
    for (let i = 0; i < N; i++) { while (bits < d) { acc |= b[o++] << bits; bits += 8; } f[i] = (acc & ((1 << d) - 1)) % m; acc >>>= d; bits -= d; }
    return f;
  }

  // ---------- sampling (§4.2.2)
  function sampleNtt(rho, j, i) { // Â[i][j] ← SampleNTT(ρ‖j‖i)
    const xof = K.SHAKE128().update(cat(rho, Uint8Array.of(j, i))); const f = new Int32Array(N); let n = 0;
    while (n < N) { const c = xof.squeeze(168); for (let p = 0; p + 2 < c.length && n < N; p += 3) { const d1 = c[p] + 256 * (c[p + 1] & 15), d2 = (c[p + 1] >> 4) + 16 * c[p + 2]; if (d1 < Q) f[n++] = d1; if (d2 < Q && n < N) f[n++] = d2; } }
    xof.destroy(); return f;
  }
  function cbd(bytes, eta) { // SamplePolyCBD_η from 64η bytes
    const f = new Int32Array(N); const bit = (k) => (bytes[k >> 3] >> (k & 7)) & 1;
    for (let i = 0; i < N; i++) { let x = 0, y = 0; for (let j = 0; j < eta; j++) { x += bit(2 * i * eta + j); y += bit(2 * i * eta + eta + j); } f[i] = mod(x - y); }
    return f;
  }
  const prf = (eta, s, b) => K.shake256(cat(s, Uint8Array.of(b)), 64 * eta);
  const G = (m) => { const h = K.sha3_512(m); return [h.slice(0, 32), h.slice(32)]; };
  const H = (m) => K.sha3_256(m);
  const J = (m) => K.shake256(m, 32);

  // ---------- K-PKE (§5)
  function pkeKeygen(d) {
    const [rho, sigma] = G(cat(d, Uint8Array.of(KK))); let n = 0;
    const A = []; for (let i = 0; i < KK; i++) { A.push([]); for (let j = 0; j < KK; j++) A[i].push(sampleNtt(rho, j, i)); }
    const s = [], e = []; for (let i = 0; i < KK; i++) s.push(cbd(prf(ETA1, sigma, n++), ETA1)); for (let i = 0; i < KK; i++) e.push(cbd(prf(ETA1, sigma, n++), ETA1));
    const sh = s.map((p) => ntt(p)), eh = e.map((p) => ntt(p));
    const th = []; for (let i = 0; i < KK; i++) { let acc = eh[i]; for (let j = 0; j < KK; j++) acc = addp(acc, mulNtt(A[i][j], sh[j])); th.push(acc); }
    const ek = cat(...th.map((p) => encode(p, 12)), rho); const dk = cat(...sh.map((p) => encode(p, 12)));
    sigma.fill(0); return { ek, dk };
  }
  function pkeEncrypt(ek, m, r) {
    const th = []; for (let i = 0; i < KK; i++) th.push(decode(ek.subarray(384 * i, 384 * (i + 1)), 12)); const rho = ek.subarray(384 * KK, 384 * KK + 32); let n = 0;
    const A = []; for (let i = 0; i < KK; i++) { A.push([]); for (let j = 0; j < KK; j++) A[i].push(sampleNtt(rho, j, i)); }
    const y = [], e1 = []; for (let i = 0; i < KK; i++) y.push(cbd(prf(ETA1, r, n++), ETA1)); for (let i = 0; i < KK; i++) e1.push(cbd(prf(ETA2, r, n++), ETA2)); const e2 = cbd(prf(ETA2, r, n++), ETA2);
    const yh = y.map((p) => ntt(p));
    const u = []; for (let i = 0; i < KK; i++) { let acc = new Int32Array(N); for (let j = 0; j < KK; j++) acc = addp(acc, mulNtt(A[j][i], yh[j])); u.push(addp(invNtt(acc), e1[i])); }
    const mu = decode(m, 1); for (let i = 0; i < N; i++) mu[i] = decompress(mu[i], 1);
    let v = new Int32Array(N); for (let j = 0; j < KK; j++) v = addp(v, mulNtt(th[j], yh[j])); v = addp(addp(invNtt(v), e2), mu);
    const c1 = cat(...u.map((p) => { const c = new Int32Array(N); for (let i = 0; i < N; i++) c[i] = compress(p[i], DU); return encode(c, DU); }));
    const cv = new Int32Array(N); for (let i = 0; i < N; i++) cv[i] = compress(v[i], DV);
    return cat(c1, encode(cv, DV));
  }
  function pkeDecrypt(dk, c) {
    const u = []; for (let i = 0; i < KK; i++) { const p = decode(c.subarray(32 * DU * i, 32 * DU * (i + 1)), DU); for (let t = 0; t < N; t++) p[t] = decompress(p[t], DU); u.push(p); }
    const v = decode(c.subarray(32 * DU * KK, 32 * DU * KK + 32 * DV), DV); for (let t = 0; t < N; t++) v[t] = decompress(v[t], DV);
    const sh = []; for (let i = 0; i < KK; i++) sh.push(decode(dk.subarray(384 * i, 384 * (i + 1)), 12));
    let acc = new Int32Array(N); for (let i = 0; i < KK; i++) acc = addp(acc, mulNtt(sh[i], ntt(u[i])));
    const w = subp(v, invNtt(acc)); const m = new Int32Array(N); for (let i = 0; i < N; i++) m[i] = compress(w[i], 1);
    return encode(m, 1);
  }

  // ---------- ML-KEM (§7)
  const eq = (a, b) => { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i]; return d === 0; };
  function keygen(seed) {
    seed = seed || rnd(64); if (seed.length !== 64) throw new Error("seed must be 64 bytes (d‖z)");
    const d = seed.slice(0, 32), z = seed.slice(32); const { ek, dk: dkPke } = pkeKeygen(d);
    const dk = cat(dkPke, ek, H(ek), z); d.fill(0); return { ek, dk };
  }
  function checkEk(ek) { if (!(ek instanceof Uint8Array) || ek.length !== SIZES.ek) throw new Error("ek must be " + SIZES.ek + " bytes"); for (let i = 0; i < KK; i++) { const seg = ek.subarray(384 * i, 384 * (i + 1)); if (!eq(encode(decode(seg, 12), 12), seg)) throw new Error("ek is not a valid ML-KEM-768 encapsulation key (modulus check)"); } }
  function encaps(ek, m) {
    checkEk(ek); m = m || rnd(32); if (m.length !== 32) throw new Error("m must be 32 bytes");
    const [Kss, r] = G(cat(m, H(ek))); const ct = pkeEncrypt(ek, m, r); r.fill(0); return { ct, ss: Kss };
  }
  function decaps(dk, ct) {
    if (!(dk instanceof Uint8Array) || dk.length !== SIZES.dk) throw new Error("dk must be " + SIZES.dk + " bytes"); if (!(ct instanceof Uint8Array) || ct.length !== SIZES.ct) throw new Error("ct must be " + SIZES.ct + " bytes");
    const dkPke = dk.subarray(0, 384 * KK), ek = dk.subarray(384 * KK, 768 * KK + 32), h = dk.subarray(768 * KK + 32, 768 * KK + 64), z = dk.subarray(768 * KK + 64, 768 * KK + 96);
    if (!eq(H(ek), h)) throw new Error("dk is damaged (hash check)");
    const m2 = pkeDecrypt(dkPke, ct); const [k2, r2] = G(cat(m2, h)); const kbar = J(cat(z, ct)); const c2 = pkeEncrypt(ek, m2, r2);
    const same = eq(ct, c2); const out = new Uint8Array(32); for (let i = 0; i < 32; i++) out[i] = same ? k2[i] : kbar[i]; // both computed; select
    k2.fill(0); kbar.fill(0); r2.fill(0); m2.fill(0); return out;
  }

  const API = { keygen, encaps, decaps, SIZES, _internal: { ntt, invNtt, mulNtt, addp, subp, compress, decompress, encode, decode, cbd, sampleNtt, pkeKeygen, pkeEncrypt, pkeDecrypt, ZETAS, GAMMAS, Q, N } };
  if (typeof module !== "undefined" && module.exports) module.exports = API; else root.MLKEM = API;
})(typeof globalThis !== "undefined" ? globalThis : this);
