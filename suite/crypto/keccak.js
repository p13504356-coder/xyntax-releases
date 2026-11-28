/* XBS · keccak.js — Keccak-f[1600], SHA3-256, SHA3-512, SHAKE128, SHAKE256 (FIPS 202).
 *
 * Pure JavaScript, no dependencies. Byte-oriented sponge with incremental absorb and squeeze. The permutation works on
 * 32-bit halves of the 25 lanes (no BigInt), little-endian; a big-endian host is refused at load.
 *
 * Tested against the FIPS 202 known-answer values for the empty message and for "abc" (see ../../test/crypto/keccak.test.js);
 * NOT independently reviewed and NOT measured for side channels (JavaScript offers no constant-time guarantees). Used in XBS
 * only where ML-KEM needs SHA3/SHAKE; everything that WebCrypto provides (SHA-256, HMAC, HKDF, AES-GCM, ECDH) stays in WebCrypto.
 *
 * API (global KECCAK in the renderer, module.exports under Node):
 *   sha3_256(bytes) → Uint8Array(32)      sha3_512(bytes) → Uint8Array(64)
 *   shake128(bytes, outLen) → Uint8Array  shake256(bytes, outLen) → Uint8Array
 *   new Keccak(rateBytes, suffix, outLen) with .update(bytes) .digest() .squeeze(n) (SHAKE: squeeze repeatedly)
 *   SHA3_256 / SHA3_512 / SHAKE128 / SHAKE256: constructors preset for each function
 */
(function (root) {
  "use strict";
  if (new Uint8Array(new Uint32Array([1]).buffer)[0] !== 1) throw new Error("keccak.js needs a little-endian host");

  // round constants and permutation tables, computed from the specification rather than typed in
  const PI = [], ROTL = [], IOTA_LO = new Uint32Array(24), IOTA_HI = new Uint32Array(24);
  {
    let x = 1, y = 0, R = 0x01;
    for (let round = 0; round < 24; round++) {
      [x, y] = [y, (2 * x + 3 * y) % 5]; PI.push(2 * (x + y * 5));
      ROTL.push((((round + 1) * (round + 2)) / 2) % 64);
      let lo = 0, hi = 0;
      for (let j = 0; j < 7; j++) { R = ((R << 1) ^ ((R >> 7) * 0x71)) & 0xff; if (R & 2) { const bit = (1 << j) - 1; if (bit < 32) lo ^= 1 << bit; else hi ^= 1 << (bit - 32); } }
      IOTA_LO[round] = lo >>> 0; IOTA_HI[round] = hi >>> 0;
    }
  }
  // 64-bit rotate left on (h, l) halves; the state keeps each lane's low word first, and the pair is treated consistently as (h, l)
  const rotlH = (h, l, s) => s > 32 ? (l << (s - 32)) | (h >>> (64 - s)) : (h << s) | (l >>> (32 - s));
  const rotlL = (h, l, s) => s > 32 ? (h << (s - 32)) | (l >>> (64 - s)) : (l << s) | (h >>> (32 - s));
  const B = new Uint32Array(10);

  function keccakP(s) {
    for (let round = 0; round < 24; round++) {
      for (let x = 0; x < 10; x++) B[x] = s[x] ^ s[x + 10] ^ s[x + 20] ^ s[x + 30] ^ s[x + 40];
      for (let x = 0; x < 10; x += 2) {
        const i1 = (x + 8) % 10, i0 = (x + 2) % 10; const b0 = B[i0], b1 = B[i0 + 1];
        const th = rotlH(b0, b1, 1) ^ B[i1], tl = rotlL(b0, b1, 1) ^ B[i1 + 1];
        for (let y = 0; y < 50; y += 10) { s[x + y] ^= th; s[x + y + 1] ^= tl; }
      }
      let curH = s[2], curL = s[3];
      for (let t = 0; t < 24; t++) {
        const sh = ROTL[t]; const th = rotlH(curH, curL, sh), tl = rotlL(curH, curL, sh); const p = PI[t];
        curH = s[p]; curL = s[p + 1]; s[p] = th; s[p + 1] = tl;
      }
      for (let y = 0; y < 50; y += 10) {
        for (let x = 0; x < 10; x++) B[x] = s[y + x];
        for (let x = 0; x < 10; x++) s[y + x] ^= ~B[(x + 2) % 10] & B[(x + 4) % 10];
      }
      s[0] ^= IOTA_LO[round]; s[1] ^= IOTA_HI[round];
    }
  }

  class Keccak {
    constructor(rate, suffix, outLen) {
      if (!(rate > 0 && rate < 200)) throw new Error("bad rate"); this.rate = rate; this.suffix = suffix; this.outLen = outLen;
      this.state = new Uint32Array(50); this.bytes = new Uint8Array(this.state.buffer); this.pos = 0; this.squeezing = false; this.done = false;
    }
    update(data) {
      if (this.squeezing) throw new Error("update after squeeze"); if (typeof data === "string") data = new TextEncoder().encode(data);
      const b = this.bytes, r = this.rate; let i = 0;
      while (i < data.length) { const take = Math.min(r - this.pos, data.length - i); for (let j = 0; j < take; j++) b[this.pos + j] ^= data[i + j]; this.pos += take; i += take; if (this.pos === r) { keccakP(this.state); this.pos = 0; } }
      return this;
    }
    _pad() { const b = this.bytes; b[this.pos] ^= this.suffix; b[this.rate - 1] ^= 0x80; keccakP(this.state); this.pos = 0; this.squeezing = true; }
    squeeze(n) {
      if (!this.squeezing) this._pad(); const out = new Uint8Array(n); let i = 0;
      while (i < n) { if (this.pos === this.rate) { keccakP(this.state); this.pos = 0; } const take = Math.min(this.rate - this.pos, n - i); out.set(this.bytes.subarray(this.pos, this.pos + take), i); this.pos += take; i += take; }
      return out;
    }
    digest() { if (this.done) throw new Error("digest twice"); this.done = true; const out = this.squeeze(this.outLen); this.state.fill(0); return out; }
    destroy() { this.state.fill(0); }
  }
  const SHA3_256 = () => new Keccak(136, 0x06, 32), SHA3_512 = () => new Keccak(72, 0x06, 64), SHAKE128 = () => new Keccak(168, 0x1f, 0), SHAKE256 = () => new Keccak(136, 0x1f, 0);
  const API = {
    Keccak, SHA3_256, SHA3_512, SHAKE128, SHAKE256,
    sha3_256: (m) => SHA3_256().update(m).digest(), sha3_512: (m) => SHA3_512().update(m).digest(),
    shake128: (m, n) => { const h = SHAKE128().update(m); const o = h.squeeze(n); h.destroy(); return o; },
    shake256: (m, n) => { const h = SHAKE256().update(m); const o = h.squeeze(n); h.destroy(); return o; },
    keccakP,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API; else root.KECCAK = API;
})(typeof globalThis !== "undefined" ? globalThis : this);
