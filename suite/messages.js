/* XYNTAX MESSAGES — conversations between the members of a company, end to end encrypted with forward secrecy.
 * Written to be read by an auditor. Primitives are WebCrypto only: ECDH P-256, HKDF-SHA-256, AES-GCM-256.
 *
 * Identity. Every device of every user has an identity key pair (ECDH P-256) and, since 4.7, an ML-KEM-768 key pair beside it.
 * The ECDH private half is non-extractable and lives in the browser's key store; the ML-KEM private half is sealed under the
 * device's local AES key in the same store; both public halves are published in msg_devices (pub, kem_pub). The pairs are
 * renewed together about once an hour of use (the
 * previous private key is kept for 24 hours so that a key wrapped to it a moment before the renewal still opens, then dropped).
 *
 * Epochs. A conversation runs in numbered epochs; msg_threads.epoch is the authoritative counter. Whenever the membership
 * changes, a member's new device appears, a member asks for it, or an epoch is a week or a thousand messages old, a member's
 * device cuts the next epoch: a fresh 32-byte epoch secret, wrapped to every member device (and to the company archive key
 * where that is on) — one msg_keys row per device. Wrap v2 (4.7, used whenever the recipient device has published kem_pub):
 * ephemeral ECDH agreement ‖ ML-KEM-768 encapsulation → HKDF-SHA-256 with info bound to the thread, the epoch and SHA-256 of
 * the transcript (recipient EC key, ephemeral EC key, recipient KEM key, KEM ciphertext) → AES-GCM. A recording of today's
 * traffic cannot be opened by a future quantum computer unless both ECDH and ML-KEM fall. Wrap v1 (ECDH only) remains for
 * devices that have not published a KEM key yet. The binding limit is stated plainly: an ECDH key cannot sign, so kem_pub is
 * trusted by the same path as pub — the device record the server holds; a server that swaps a device's keys has always been
 * able to insert a device of its own, and the device list in Details is the member's check against that.
 * Padding (4.7): every plaintext is padded to a size bucket (256, 1 K, 4 K, 16 K, then 16 K steps) before encryption, so the
 * relay sees bucket sizes, not message lengths.
 *
 * Ratchets. A device that receives an epoch secret derives from it one sending chain per member device
 * (CK0 = HKDF(secret, "xyntax-chain:" + thread + ":" + epoch + ":" + device)), stores the chains, DELETES its wrapped copy from
 * the server and forgets the secret. Each message is encrypted under MK_n = HKDF(CK_n, "xyntax-mk") and the chain moves on to
 * CK_(n+1) = HKDF(CK_n, "xyntax-ck"); MK_n is used once and discarded, by the sender when it sends and by each receiver when it
 * reads. Messages carry (epoch, n) and bind thread, epoch, sender device and n as additional authenticated data. A receiver that
 * sees n jump ahead keeps the skipped message keys (bounded) for the stragglers.
 *
 * What that buys. A device captured at time T holds: its current identity key, the current chain keys, and its own local
 * history (sealed under a device-local key). It cannot derive the keys of messages already read — those keys no longer exist
 * anywhere — so the ciphertext the server holds for the past is dead; and the next epoch (cut on the next membership change,
 * renewal or request) locks the intruder out again. History therefore lives on the devices that were present: a new device
 * reads from the epoch it joins, like any serious messenger, and the thread says so.
 *
 * The company archive. If the company has switched it on, an archive key pair belongs to the company: its public key is
 * known to members, its private key is sealed to administrators' devices. Every group conversation's epoch secret is also
 * wrapped to the archive key, and the thread tells its members so. That is the one declared exception to the above: with the
 * archive key a conversation's history can be re-derived, which is the archive's purpose. Direct messages are never archived.
 *
 * Still ahead: sender signatures beyond the server's authentication of who posted a row, guests from outside the company,
 * and the MLS tree for groups of hundreds (the design above is Signal's sender-key arrangement with epoch resets). */
(function () {
  const H = (...a) => SUITE.H(...a); const esc = (s) => SUITE.esc(s);
  const b64 = (u8) => { let s = ""; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
  const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  const enc = new TextEncoder(), dec = new TextDecoder();
  const now = () => new Date().toISOString();
  const cloud = () => typeof CLOUD !== "undefined" && CLOUD.signedIn();
  const me = () => (cloud() && CLOUD.session()) || {};
  const org = () => me().org_id || null;
  // which threads this device shows: the open company's and the personal ones (between connected people); only personal ones without a company
  const threadFilter = () => (org() ? "or=(org_id.eq." + org() + ",org_id.is.null)" : "org_id=is.null");
  const deviceFilter = () => ""; // row-level security already limits devices to people I can reach
  const HOUR = 3600000, DAY = 86400000;

  // ---------- the store on this device: IndexedDB holds CryptoKey objects without exposing them; records are sealed under a local key
  const KDB = { name: "xyntax-keys", version: 2 };
  function kdb() { return new Promise((res, rej) => { const r = indexedDB.open(KDB.name, KDB.version); r.onupgradeneeded = () => { const d = r.result; if (!d.objectStoreNames.contains("keys")) d.createObjectStore("keys"); for (const s of ["msgs", "chains", "meta"]) if (!d.objectStoreNames.contains(s)) { const os = d.createObjectStore(s, { keyPath: "k" }); os.createIndex("uid", "uid"); } }; r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
  function kop(store, mode, fn) { return kdb().then((d) => new Promise((res, rej) => { const tx = d.transaction(store, mode); const rq = fn(tx.objectStore(store)); tx.oncomplete = () => res(rq && rq.result); tx.onerror = () => rej(tx.error); })); }
  const kget = (k) => kop("keys", "readonly", (s) => s.get(k)); const kput = (k, v) => kop("keys", "readwrite", (s) => s.put(v, k));
  const rput = (store, rec) => kop(store, "readwrite", (s) => s.put(rec)); const rdel = (store, k) => kop(store, "readwrite", (s) => s.delete(k));
  const rall = (store, uid) => kop(store, "readonly", (s) => s.index("uid").getAll(uid));
  let LK = null; // the local sealing key of this user on this device
  async function localKey() { if (LK) return LK; const uid = me().user_id; LK = await kget("lk:" + uid); if (!LK) { LK = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]); await kput("lk:" + uid, LK); } return LK; }
  async function lseal(obj) { const k = await localKey(); const iv = crypto.getRandomValues(new Uint8Array(12)); return { iv: b64(iv), ct: b64(new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, k, enc.encode(JSON.stringify(obj))))) }; }
  async function lopen(box) { const k = await localKey(); return JSON.parse(dec.decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(box.iv) }, k, unb64(box.ct)))); }

  const C = {
    async identity() {
      const uid = me().user_id; if (!uid) throw new Error("Sign in to a company workspace to use Messages");
      const key = "id:" + uid; let rec = await kget(key);
      if (!rec) { const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, false, ["deriveKey", "deriveBits"]); rec = { priv: pair.privateKey, pub: await crypto.subtle.exportKey("jwk", pair.publicKey), deviceId: crypto.randomUUID(), createdAt: now(), rotatedAt: now(), prev: null, name: SUITE.isMobile() ? "Phone" : (navigator.platform || "Computer").replace(/Win32/, "Windows").replace(/MacIntel/, "Mac") }; await kput(key, rec); }
      if (rec.prev && rec.prev.until < Date.now()) { rec.prev = null; await kput(key, rec); }
      if (!rec.kem && C.pq()) { rec.kem = await C.kemKeygen(); await kput(key, rec); }
      return rec;
    },
    // ML-KEM-768 is available when mlkem.js loaded (it always ships; the check keeps a missing script from breaking Messages)
    pq() { return typeof MLKEM !== "undefined" && !!MLKEM.keygen; },
    async kemKeygen() { const { ek, dk } = MLKEM.keygen(); const box = await lseal({ dk: b64(dk) }); dk.fill(0); return { ek: b64(ek), box }; },
    async kemDk(kem) { if (!kem) return null; return unb64((await lopen(kem.box)).dk); },
    async register() { const id = await C.identity(); const r = await CLOUD.req("/rest/v1/msg_devices?on_conflict=id", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify({ id: id.deviceId, user_id: me().user_id, org_id: org(), name: id.name, pub: id.pub, kem_pub: id.kem ? id.kem.ek : null, last_seen: now() }) }); if (!r.ok) throw new Error("Could not register this device: " + (await r.text()).slice(0, 120)); return id; },
    // a fresh identity pair; the old private key stays for a day so that a secret wrapped to it moments ago still opens
    async rotateIdentity() { const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, false, ["deriveKey", "deriveBits"]); const rec = st.id; rec.prev = { priv: rec.priv, pub: rec.pub, kem: rec.kem || null, until: Date.now() + DAY }; rec.priv = pair.privateKey; rec.pub = await crypto.subtle.exportKey("jwk", pair.publicKey); if (C.pq()) rec.kem = await C.kemKeygen(); rec.rotatedAt = now(); await kput("id:" + me().user_id, rec); await R.patch("msg_devices", "id=eq." + rec.deviceId, { pub: rec.pub, kem_pub: rec.kem ? rec.kem.ek : null, last_seen: now() }); },
    async importPub(jwk) { return crypto.subtle.importKey("jwk", jwk, { name: "ECDH", namedCurve: "P-256" }, false, []); },
    async kek(bits, salt, info, use) { const hk = await crypto.subtle.importKey("raw", bits, "HKDF", false, ["deriveKey"]); return crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt, info: enc.encode("xyntax-msg-wrap:" + info) }, hk, { name: "AES-GCM", length: 256 }, false, [use]); },
    // wrap 32 secret bytes to a device. v1: ephemeral ECDH → HKDF → AES-GCM. v2 (the device published kem_pub): ephemeral ECDH ‖
    // ML-KEM-768 shared secret → HKDF (info bound to the transcript) → AES-GCM. The record says which it is.
    async wrapTo(secret, devicePubJwk, info, kemPubB64) {
      const eph = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]); const pub = await C.importPub(devicePubJwk);
      const ecBits = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: pub }, eph.privateKey, 256)); const salt = crypto.getRandomValues(new Uint8Array(16)); const ephJwk = await crypto.subtle.exportKey("jwk", eph.publicKey);
      let kek, kemCt = null;
      if (kemPubB64 && C.pq()) { const ek = unb64(kemPubB64); const { ct, ss } = MLKEM.encaps(ek); kemCt = ct; kek = await C.kek2(ecBits, ss, salt, info, await C.transcript(devicePubJwk, ephJwk, ek, ct), "encrypt"); ss.fill(0); } else kek = await C.kek(ecBits, salt, info, "encrypt");
      ecBits.fill(0);
      const iv = crypto.getRandomValues(new Uint8Array(12)); const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, kek, secret));
      return kemCt ? { v: 2, eph: ephJwk, salt: b64(salt), iv: b64(iv), ct: b64(ct), kem: b64(kemCt) } : { eph: ephJwk, salt: b64(salt), iv: b64(iv), ct: b64(ct) };
    },
    // v2 key derivation: HKDF-SHA-256(ikm = ecdh ‖ kem_ss, salt, info = "xyntax-msg-wrap2:" + info + ":" + hex(SHA-256(transcript)))
    async kek2(ecBits, kemSs, salt, info, th, use) { const ikm = new Uint8Array(ecBits.length + kemSs.length); ikm.set(ecBits, 0); ikm.set(kemSs, ecBits.length); const hk = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveKey"]); ikm.fill(0); return crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt, info: enc.encode("xyntax-msg-wrap2:" + info + ":" + th) }, hk, { name: "AES-GCM", length: 256 }, false, [use]); },
    async transcript(devicePubJwk, ephJwk, ek, kemCt) { const parts = [enc.encode(devicePubJwk.x + "." + devicePubJwk.y + "|" + ephJwk.x + "." + ephJwk.y + "|"), ek, kemCt]; const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0; for (const p of parts) { all.set(p, o); o += p.length; } return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", all))).map((b) => b.toString(16).padStart(2, "0")).join(""); },
    async unwrapWith(wrapped, priv, info, kemDk, myPubJwk) {
      const pub = await C.importPub(wrapped.eph); const ecBits = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: pub }, priv, 256)); let kek;
      if (wrapped.v === 2) { if (!kemDk || !C.pq()) throw new Error("post-quantum wrap without a KEM key on this device"); const kemCt = unb64(wrapped.kem); const ss = MLKEM.decaps(kemDk, kemCt); const ek = kemDk.subarray(1152, 2336); kek = await C.kek2(ecBits, ss, unb64(wrapped.salt), info, await C.transcript(myPubJwk, wrapped.eph, ek, kemCt), "decrypt"); ss.fill(0); }
      else kek = await C.kek(ecBits, unb64(wrapped.salt), info, "decrypt");
      ecBits.fill(0); return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(wrapped.iv) }, kek, unb64(wrapped.ct)));
    },
    async unwrap(wrapped, info) { try { return await C.unwrapWith(wrapped, st.id.priv, info, wrapped.v === 2 ? await C.kemDk(st.id.kem) : null, st.id.pub); } catch (e) { if (st.id.prev) { const prevPub = st.id.prev.pub || st.id.pub; return C.unwrapWith(wrapped, st.id.prev.priv, info, wrapped.v === 2 ? await C.kemDk(st.id.prev.kem) : null, prevPub); } throw e; } },
    // the ratchet
    async hkdf(ikm, info) { const k = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]); return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: enc.encode(info) }, k, 256)); },
    chain0(secret, threadId, epoch, deviceId) { return C.hkdf(secret, "xyntax-chain:" + threadId + ":" + epoch + ":" + deviceId); },
    async step(ck) { const [mk, next] = await Promise.all([C.hkdf(ck, "xyntax-mk"), C.hkdf(ck, "xyntax-ck")]); return { mk, next }; },
    async mkey(mk, use) { return crypto.subtle.importKey("raw", mk, { name: "AES-GCM", length: 256 }, false, [use]); },
    // plaintexts are padded to buckets: 4-byte big-endian length, the JSON, zeros up to 256 / 1 K / 4 K / 16 K / n×16 K bytes
    bucket(n) { for (const b of [256, 1024, 4096, 16384]) if (n <= b) return b; return Math.ceil(n / 16384) * 16384; },
    pad(bytes) { const out = new Uint8Array(C.bucket(bytes.length + 4)); new DataView(out.buffer).setUint32(0, bytes.length); out.set(bytes, 4); return out; },
    unpad(pt) { if (pt[0] === 0x7b) return pt; /* a message from before padding: raw JSON */ const n = new DataView(pt.buffer, pt.byteOffset, pt.byteLength).getUint32(0); if (n + 4 > pt.length) throw new Error("bad padding"); return pt.subarray(4, 4 + n); },
    async seal(mk, obj, aad) { const key = await C.mkey(mk, "encrypt"); const iv = crypto.getRandomValues(new Uint8Array(12)); const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: enc.encode(aad) }, key, C.pad(enc.encode(JSON.stringify(obj))))); return { iv: b64(iv), ct: b64(ct) }; },
    async open(mk, iv, ct, aad) { const key = await C.mkey(mk, "decrypt"); const pt = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(iv), additionalData: enc.encode(aad) }, key, unb64(ct))); return JSON.parse(dec.decode(C.unpad(pt))); },
    async sealBytes(bytes) { const k = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]); const iv = crypto.getRandomValues(new Uint8Array(12)); const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, k, bytes)); return { ct, key: b64(new Uint8Array(await crypto.subtle.exportKey("raw", k))), iv: b64(iv) }; },
    async openBytes(ct, keyB64, ivB64) { const k = await crypto.subtle.importKey("raw", unb64(keyB64), { name: "AES-GCM", length: 256 }, false, ["decrypt"]); return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(ivB64) }, k, ct)); },
  };

  // ---------- the relay (PostgREST over the existing session)
  const R = {
    async get(path) { const r = await CLOUD.req("/rest/v1/" + path); if (!r.ok) throw new Error((await r.text()).slice(0, 160)); return r.json(); },
    async post(table, row, prefer) { const r = await CLOUD.req("/rest/v1/" + table, { method: "POST", headers: { Prefer: prefer || "return=representation" }, body: JSON.stringify(row) }); if (!r.ok) throw new Error((await r.text()).slice(0, 160)); const t = await r.text(); try { const j = JSON.parse(t); return Array.isArray(j) ? j[0] : j; } catch (e) { return null; } },
    async patch(table, filter, row, want) { const r = await CLOUD.req("/rest/v1/" + table + "?" + filter, { method: "PATCH", headers: { Prefer: want ? "return=representation" : "return=minimal" }, body: JSON.stringify(row) }); if (!r.ok) throw new Error((await r.text()).slice(0, 160)); if (!want) return null; try { return await r.json(); } catch (e) { return []; } },
    async del(table, filter) { const r = await CLOUD.req("/rest/v1/" + table + "?" + filter, { method: "DELETE", headers: { Prefer: "return=minimal" } }); return r.ok; },
  };

  // ---------- state
  // chains[thread][epoch][device] = { n, ck (Uint8Array), skipped: { n: mk b64 } }; epochs[thread] = { current, cutAt, devices: [] }
  const st = { ready: false, id: null, devices: [], people: [], threads: [], members: {}, chains: {}, epochs: {}, msgs: {}, sel: null, pane: "side", q: "", filter: "all", since: null, timer: null, drafts: {}, reads: {}, seen: {}, archivePub: null, archivePriv: null, err: null, consumed: 0, waiting: {} };
  let root, side, main, pane, frame;
  const nameOf = (uid) => { if (uid === me().user_id) return "You"; const p = st.people.find((x) => x.id === uid); return p ? (p.name || p.user) : "Someone"; };
  const initialsOf = (uid) => { const p = st.people.find((x) => x.id === uid); const n = (p && (p.name || p.user)) || nameOf(uid); return n.split(/[\s.@_-]+/).filter(Boolean).map((w) => w[0]).join("").slice(0, 2).toUpperCase(); };
  const aad = (threadId, epoch, deviceId, n) => threadId + "|" + epoch + "|" + deviceId + "|" + n;
  const threadTitle = (t) => { if (t.title) return t.title; const others = (st.members[t.id] || []).filter((m) => m.user_id !== me().user_id && m.role !== "archive" && !m.removed_at); return others.length ? others.map((m) => nameOf(m.user_id)).join(", ") : "Just you"; };
  const isMember = (t) => (st.members[t.id] || []).some((m) => m.user_id === me().user_id && !m.removed_at);
  const isArchived = (t) => (st.members[t.id] || []).some((m) => m.role === "archive" && !m.removed_at);
  const unread = (t) => { if (!isMember(t)) return 0; const last = st.reads[t.id] || "0"; return (st.msgs[t.id] || []).filter((m) => m.created_at > last && m.sender_user !== me().user_id && !m.deleted).length; };
  const currentMemberIds = (t) => (st.members[t.id] || []).filter((m) => !m.removed_at && m.role !== "archive").map((m) => m.user_id);
  const uid = () => me().user_id;
  const chainOf = (t, e, d) => st.chains[t] && st.chains[t][e] && st.chains[t][e][d];
  const myChain = (t) => { const ep = st.epochs[t.id]; return ep ? chainOf(t.id, ep.current, st.id.deviceId) : null; };

  // ---------- local history and chain persistence
  async function loadLocal() {
    const u = uid(); st.msgs = {}; st.chains = {}; st.epochs = {};
    for (const rec of await rall("msgs", u)) { try { const m = await lopen(rec.box); (st.msgs[m.thread_id] = st.msgs[m.thread_id] || []).push(m); } catch (e) { /* sealed under another key */ } }
    for (const rec of await rall("chains", u)) { try { const c = await lopen(rec.box); ((st.chains[c.thread_id] = st.chains[c.thread_id] || {})[c.epoch] = st.chains[c.thread_id][c.epoch] || {})[c.device_id] = { n: c.n, ck: unb64(c.ck), skipped: c.skipped || {}, user: c.user || null }; } catch (e) { /* skip */ } }
    for (const rec of await rall("meta", u)) { if (rec.k === u + ":since") st.since = rec.v; else if (rec.k.startsWith(u + ":epoch:")) st.epochs[rec.k.slice(u.length + 7)] = rec.v; }
    for (const id of Object.keys(st.msgs)) st.msgs[id].sort((a, b) => a.created_at.localeCompare(b.created_at));
  }
  const saveMsg = async (m) => rput("msgs", { k: uid() + ":" + m.id, uid: uid(), box: await lseal(m) });
  const saveChain = async (t, e, d) => { const c = chainOf(t, e, d); if (!c) return; await rput("chains", { k: uid() + ":" + t + ":" + e + ":" + d, uid: uid(), box: await lseal({ thread_id: t, epoch: e, device_id: d, n: c.n, ck: b64(c.ck), skipped: c.skipped, user: c.user || null }) }); };
  const saveEpoch = (t) => rput("meta", { k: uid() + ":epoch:" + t, uid: uid(), v: st.epochs[t] });
  const saveSince = () => rput("meta", { k: uid() + ":since", uid: uid(), v: st.since });
  async function forgetThreadLocal(threadId) { for (const m of st.msgs[threadId] || []) await rdel("msgs", uid() + ":" + m.id); for (const e of Object.keys(st.chains[threadId] || {})) for (const d of Object.keys(st.chains[threadId][e])) await rdel("chains", uid() + ":" + threadId + ":" + e + ":" + d); await rdel("meta", uid() + ":epoch:" + threadId); delete st.msgs[threadId]; delete st.chains[threadId]; delete st.epochs[threadId]; }

  // ---------- loading
  async function boot() {
    st.err = null; if (!cloud()) { st.ready = true; return; }
    // 4.8: a second visit in the same session does not boot again — the state is there; one poll tick brings it up to date
    const key = uid() + ":" + (org() || ""); if (st.ready && st.booted === key && st.id) { await refreshDirectory(); tickNow(); return; }
    if (st._booting) { await st._booting; if (st.booted === key) { await refreshDirectory(); tickNow(); return; } }
    st._booting = (async () => { try {
      // the device registration (an upsert) travels with the first batch of reads rather than before it; the identity it needs is local
      const regP = C.register(); const coP = org() ? R.get("memberships?select=user_id&org_id=eq." + org()).catch(() => []) : Promise.resolve([]);
      const [id, people, devices, threads, archive, co] = await Promise.all([regP, CLOUD.people(), R.get("msg_devices?select=id,user_id,name,pub,kem_pub,last_seen,created_at"), R.get("msg_threads?select=*&" + threadFilter() + "&order=last_at.desc.nullslast"), (org() ? R.get("msg_archive?select=device_id,pub,priv_sealed,holders&org_id=eq." + org()).catch(() => []) : Promise.resolve([])), coP]);
      st.id = id; await loadLocal();
      st.people = people; st.devices = devices; st.threads = threads; st.coMembers = co.map((m) => m.user_id); st.archivePub = archive && archive[0] ? { device_id: archive[0].device_id, pub: archive[0].pub } : null; st.archivePriv = null;
      if (archive && archive[0]) await openArchive(archive[0]);
      if (threads.length) { const ids = threads.map((t) => t.id).join(","); const [members, reads] = await Promise.all([R.get("msg_members?select=thread_id,user_id,role,added_at,removed_at&thread_id=in.(" + ids + ")"), R.get("msg_reads?select=thread_id,last_read_at&user_id=eq." + uid())]); st.members = {}; for (const m of members) (st.members[m.thread_id] = st.members[m.thread_id] || []).push(m); for (const r of reads) st.reads[r.thread_id] = r.last_read_at; }
      await consumeKeys(); await pullMessages(); st.ready = true; st.booted = key; ensureEpochs().catch(() => {});
    } catch (e) { st.err = e.message; st.ready = true; console.error(e); } finally { st._booting = null; } })();
    await st._booting;
  }
  // who can be written to may have changed since the quiet boot (a connection accepted, a colleague added, a new device): one batch
  async function refreshDirectory() { try { const [people, devices, co] = await Promise.all([CLOUD.people(), R.get("msg_devices?select=id,user_id,name,pub,kem_pub,last_seen,created_at"), org() ? R.get("memberships?select=user_id&org_id=eq." + org()).catch(() => []) : Promise.resolve([])]); st.people = people; st.devices = devices; st.coMembers = co.map((m) => m.user_id); } catch (e) { /* the lists stand */ } }
  // the archive's wrapping key: from this device's sealed copy first, else from the holder entry written for this device; kept here afterwards
  // so an identity renewal never costs an administrator the archive, and re-wrapped to administrators' devices that lack a current entry
  async function openArchive(a) {
    const metaKey = uid() + ":archive:" + a.device_id; let raw = null;
    try { const rec = await kop("meta", "readonly", (s) => s.get(metaKey)); if (rec && rec.box) raw = unb64((await lopen(rec.box)).raw); } catch (e) { raw = null; }
    if (!raw) { const mine = (a.holders || []).find((h) => h.device_id === st.id.deviceId); if (mine) { try { raw = await C.unwrap(mine.wrapped, "archive:" + a.device_id); await rput("meta", { k: metaKey, uid: uid(), box: await lseal({ raw: b64(raw) }) }); } catch (e) { console.warn("archive key did not open on this device"); } } }
    if (!raw) return;
    try { const aes = await crypto.subtle.importKey("raw", raw, { name: "AES-GCM", length: 256 }, false, ["decrypt"]); const jwk = JSON.parse(dec.decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(a.priv_sealed.iv) }, aes, unb64(a.priv_sealed.ct)))); st.archivePriv = await crypto.subtle.importKey("jwk", jwk, { name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]); } catch (e) { console.warn("archive key is damaged"); return; }
    rewrapArchive(a, raw).catch(() => {});
  }
  async function rewrapArchive(a, raw) {
    if (!CLOUD.isAdmin()) return; const admins = await CLOUD.admins(); if (!admins.length) return;
    const holders = (a.holders || []).slice(); let changed = false;
    for (const d of st.devices) { if (!admins.includes(d.user_id)) continue; const h = holders.find((x) => x.device_id === d.id); if (h && h.pub === d.pub && (h.kem || null) === (d.kem_pub || null)) continue; const wrapped = await C.wrapTo(raw, d.pub, "archive:" + a.device_id, d.kem_pub); if (h) { h.wrapped = wrapped; h.pub = d.pub; h.kem = d.kem_pub || null; } else holders.push({ device_id: d.id, pub: d.pub, kem: d.kem_pub || null, wrapped }); changed = true; }
    const live = holders.filter((h) => st.devices.some((d) => d.id === h.device_id && admins.includes(d.user_id))); if (live.length !== holders.length) changed = true;
    if (changed) await R.patch("msg_archive", "org_id=eq." + org() + "&device_id=eq." + a.device_id, { holders: live });
  }
  // an epoch secret becomes one chain per member device, then is forgotten
  async function adoptEpoch(threadId, epoch, secret, devs) {
    // every device known at the time gets a chain (a member removed later, or a device missing from a stale list, must still be readable); the thread's member devices are what the epoch is "for"
    const all = devs.slice(); for (const d of st.devices) if (!all.some((x) => x.id === d.id)) all.push(d);
    const ids = []; for (const d of all) { const ck = await C.chain0(secret, threadId, epoch, d.id); ((st.chains[threadId] = st.chains[threadId] || {})[epoch] = st.chains[threadId][epoch] || {})[d.id] = { n: 0, ck, skipped: {}, user: d.user_id || null }; if (devs.some((x) => x.id === d.id)) ids.push(d.id); await saveChain(threadId, epoch, d.id); }
    secret.fill(0); const cur = st.epochs[threadId]; if (!cur || epoch >= cur.current) st.epochs[threadId] = { current: epoch, cutAt: now(), devices: ids }; await saveEpoch(threadId);
    // a message that arrived before its chain did can now be read
    for (const m of st.msgs[threadId] || []) if (m.locked && m.epoch === epoch && m._row) { const d = await decryptRow(m._row); if (!d.locked) { Object.assign(m, d); await saveMsg(m); } }
  }
  const memberDevices = (t, devs) => { const ids = currentMemberIds(t); return (devs || st.devices).filter((d) => ids.includes(d.user_id)); };
  // wrapped secrets waiting for this device: adopt each, delete it from the relay; the archive's copies (never deleted) for threads read through the archive
  async function consumeKeys() {
    if (!st.id) return false; let fresh = false;
    const rows = await R.get("msg_keys?select=thread_id,epoch,wrapped&device_id=eq." + st.id.deviceId); if (rows.length) st.devices = await R.get("msg_devices?select=id,user_id,name,pub,kem_pub,last_seen,created_at");
    for (const k of rows) { const t = st.threads.find((x) => x.id === k.thread_id); try { if (t && !chainOf(k.thread_id, k.epoch, st.id.deviceId)) { const secret = await C.unwrap(k.wrapped, k.thread_id + ":" + k.epoch); await adoptEpoch(k.thread_id, k.epoch, secret, memberDevices(t)); fresh = true; st.consumed++; } } catch (e) { console.warn("epoch " + k.epoch + " of " + k.thread_id + " did not open here"); } if (t) await R.del("msg_keys", "thread_id=eq." + k.thread_id + "&device_id=eq." + st.id.deviceId + "&epoch=eq." + k.epoch); }
    if (st.archivePriv && st.archivePub) { const viewing = st.threads.filter((t) => !isMember(t)); if (viewing.length) { const ak = await R.get("msg_keys?select=thread_id,epoch,wrapped&device_id=eq." + st.archivePub.device_id + "&thread_id=in.(" + viewing.map((t) => t.id).join(",") + ")"); for (const k of ak) { if (st.chains[k.thread_id] && st.chains[k.thread_id][k.epoch]) continue; try { const secret = await C.unwrapWith(k.wrapped, st.archivePriv, k.thread_id + ":" + k.epoch); await adoptEpoch(k.thread_id, k.epoch, secret, st.devices); fresh = true; } catch (e) { /* not ours */ } } } }
    if (fresh && (!st.id.rotatedAt || Date.now() - new Date(st.id.rotatedAt) > HOUR)) C.rotateIdentity().catch(() => {});
    return fresh;
  }
  // a member device without a chain for the thread's current epoch (a new phone, a lost key) cuts the next epoch itself
  async function ensureEpochs() { for (const t of st.threads) { if (!isMember(t)) continue; const ep = st.epochs[t.id]; const ok = ep && ep.current >= (t.epoch || 0) && chainOf(t.id, ep.current, st.id.deviceId); if (ok) { delete st.waiting[t.id]; continue; } st.waiting[t.id] = (st.waiting[t.id] || 0) + 1; if (st.waiting[t.id] >= 2) { delete st.waiting[t.id]; await cutEpoch(t).catch(() => {}); } } }
  async function pullMessages() {
    if (!cloud() || !st.threads.length) return false; const ids = st.threads.map((t) => t.id).join(","); let changed = false;
    for (let page = 0; page < 20; page++) {
      const rows = await R.get("msg_messages?select=*&thread_id=in.(" + ids + ")" + (st.since ? "&created_at=gte." + encodeURIComponent(st.since) : "") + "&order=created_at.asc&limit=500");
      for (const r of rows) { if (!r.created_at) continue; if (!st.since || r.created_at > st.since) st.since = r.created_at; const list = (st.msgs[r.thread_id] = st.msgs[r.thread_id] || []); if (r.sender_device === st.id.deviceId || list.some((m) => m.id === r.id)) continue; const d = await decryptRow(r); if (d.body && d.body.kind) { await applyControl(d); changed = true; continue; } list.push(d); await saveMsg(d); changed = true; }
      if (rows.length < 500) break;
    }
    if (changed) { for (const t of st.threads) if (st.msgs[t.id]) st.msgs[t.id].sort((a, b) => a.created_at.localeCompare(b.created_at)); } await saveSince(); return changed;
  }
  // (epoch, n) from a sender's chain: step forward, keep what was skipped, use the message key once
  async function takeKey(t, e, d, n, user) {
    const c = chainOf(t, e, d); if (!c) return null; if (user && c.user && c.user !== user) return null; if (n - c.n > 1000) return null;
    if (n < c.n) { const mk = c.skipped[n]; if (!mk) return null; delete c.skipped[n]; await saveChain(t, e, d); return unb64(mk); }
    let ck = c.ck, mk = null; for (let i = c.n; i <= n; i++) { const s = await C.step(ck); if (i < n) { c.skipped[i] = b64(s.mk); } else mk = s.mk; ck = s.next; }
    const keys = Object.keys(c.skipped); if (keys.length > 400) for (const k of keys.sort((a, b) => a - b).slice(0, keys.length - 400)) delete c.skipped[k];
    c.ck = ck; c.n = n + 1; await saveChain(t, e, d); return mk;
  }
  async function decryptRow(r) {
    const out = { id: r.id, thread_id: r.thread_id, sender_user: r.sender_user, sender_device: r.sender_device, created_at: r.created_at, edited_at: r.edited_at || null, deleted: !!r.deleted, epoch: r.epoch, n: r.n, body: null, locked: false };
    if (r.deleted) return out;
    const own = st.devices.find((d) => d.id === r.sender_device); if (own && own.user_id !== r.sender_user) { out.locked = true; return out; } const mk = await takeKey(r.thread_id, r.epoch, r.sender_device, r.n || 0, r.sender_user); if (!mk) { out.locked = true; out._row = r; return out; }
    try { out.body = await C.open(mk, r.iv, r.ct, aad(r.thread_id, r.epoch, r.sender_device, r.n || 0)); } catch (e) { out.locked = true; } mk.fill(0);
    return out;
  }
  // edits and retractions travel as ratchet messages of their own and are applied to the local copy
  // 4.16 · reactions and pins travel the same way; anyone in the conversation may react or pin, only the sender edits or retracts
  async function applyControl(d) { const list = st.msgs[d.thread_id] || []; const m = list.find((x) => x.id === d.body.ref); if (!m) return;
    if (d.body.kind === "react") { const r = { ...(m.reactions || {}) }; if (d.body.r) r[d.sender_user] = String(d.body.r).slice(0, 2); else delete r[d.sender_user]; m.reactions = r; await saveMsg(m); return; }
    if (d.body.kind === "pin") { m.pinned = d.body.on ? { by: d.sender_user, at: d.created_at } : null; await saveMsg(m); return; }
    if (m.sender_user !== d.sender_user) return; if (d.body.kind === "edit") { m.body = { ...(m.body || {}), text: d.body.text }; m.edited_at = d.created_at; } else if (d.body.kind === "retract") { m.deleted = true; m.body = null; } await saveMsg(m); }
  let ticks = 0;
  function startPolling() { stopPolling(); const tick = async () => { if (!cloud() || !st.ready) { st._ticking = false; return; } try { const before = st.threads.length; const threads = await R.get("msg_threads?select=*&" + threadFilter() + "&order=last_at.desc.nullslast"); const newOnes = threads.filter((t) => !st.threads.some((x) => x.id === t.id)); st.threads = threads; if (newOnes.length) { const members = await R.get("msg_members?select=thread_id,user_id,role,added_at,removed_at&thread_id=in.(" + newOnes.map((t) => t.id).join(",") + ")"); for (const m of members) (st.members[m.thread_id] = st.members[m.thread_id] || []).push(m); }
    if (++ticks % 4 === 0 && st.threads.length) { const members = await R.get("msg_members?select=thread_id,user_id,role,added_at,removed_at&thread_id=in.(" + st.threads.map((t) => t.id).join(",") + ")"); st.members = {}; for (const m of members) (st.members[m.thread_id] = st.members[m.thread_id] || []).push(m); }
    const freshKeys = await consumeKeys(); const changed = await pullMessages(); await ensureEpochs();
    if (changed || freshKeys || newOnes.length || before !== threads.length) { notifyNew(); try { window.dispatchEvent(new CustomEvent("suite-unread", { detail: { app: "messages" } })); } catch (e2) { /* no DOM */ } if (root && root.isConnected) { const cur = st.threads.find((t) => t.id === st.sel); if (cur && !document.hidden) await markRead(cur); drawSide(); if (st.sel) drawMain(true); } } } catch (e) { /* next tick */ } finally { st._ticking = false; } };
    st._tick = tick; const every = () => { const live = typeof CLOUD !== "undefined" && CLOUD.realtime && CLOUD.realtime.live; /* 4 s only while the app is open and there is no socket; warmed in the background it polls like the other apps */ if (!st.open) return document.hidden ? 60000 : live ? 60000 : 30000; return document.hidden ? 15000 : live ? 30000 : 4000; }; const arm = () => { if (st.timer) clearInterval(st.timer); st.timer = setInterval(() => { if (!st._ticking) { st._ticking = true; tick(); } }, every()); }; arm(); if (!st._vis) { st._vis = true; document.addEventListener("visibilitychange", () => { if (st.timer) arm(); }); } if (typeof CLOUD !== "undefined" && CLOUD.onChange && !st._rt) { st._rt = true; CLOUD.onChange("_status", () => { if (st.timer) arm(); }); for (const t of ["msg_messages", "msg_threads", "msg_members", "msg_keys"]) CLOUD.onChange(t, () => tickNow()); } }
  // a change arrived (over the socket, or a colleague's device sent something): fetch now, once, however many events came together
  function tickNow() { if (!st._tick || !st.ready) return; clearTimeout(st._soon); st._soon = setTimeout(() => { if (st._ticking) { tickNow(); return; } st._ticking = true; st._tick(); }, 150); }
  function stopPolling() { if (st.timer) clearInterval(st.timer); st.timer = null; }
  let lastNotified = null;
  function notifyNew() { for (const t of st.threads) { const list = st.msgs[t.id] || []; const last = list[list.length - 1]; if (!last || last.sender_user === uid() || last.deleted || !last.body) continue; if (lastNotified && last.created_at <= lastNotified) continue; if (st.sel === t.id && !document.hidden) continue; if (SUITE.notify) SUITE.notify(nameOf(last.sender_user) + " · " + threadTitle(t), (last.body.text || (last.body.att && last.body.att.length ? "Sent a file" : "")).slice(0, 120), "msg:" + t.id); } const all = Object.values(st.msgs).flat().map((m) => m.created_at).sort(); lastNotified = all[all.length - 1] || lastNotified; }

  // ---------- threads and epochs
  async function devicesFor(userIds) { const fresh = await R.get("msg_devices?select=id,user_id,name,pub,kem_pub,last_seen,created_at" + "&user_id=in.(" + userIds.join(",") + ")"); st.devices = st.devices.filter((d) => !userIds.includes(d.user_id)).concat(fresh); return fresh; }
  // the next epoch: claim the number on the thread, wrap a fresh secret to every member device (and the archive), adopt it here
  async function cutEpoch(thread) {
    const memberIds = currentMemberIds(thread); const devs = (await devicesFor(memberIds)).filter((d) => memberIds.includes(d.user_id)); if (!devs.some((d) => d.id === st.id.deviceId)) devs.push({ id: st.id.deviceId, user_id: uid(), pub: st.id.pub, kem_pub: st.id.kem ? st.id.kem.ek : null });
    const fresh = await R.get("msg_threads?select=epoch&id=eq." + thread.id); const old = fresh[0] ? (fresh[0].epoch || 0) : (thread.epoch || 0); const epoch = old + 1;
    const claimed = await R.patch("msg_threads", "id=eq." + thread.id + "&epoch=eq." + old, { epoch }, true); if (!claimed || !claimed.length) { thread.epoch = old; return null; } thread.epoch = epoch;
    const secret = crypto.getRandomValues(new Uint8Array(32)); const rows = [];
    // the epoch is already claimed: one device with a damaged key record must not abort the delivery to everyone else (that would
    // leave the thread on a number nobody holds a key for, and every retry would fail the same way)
    for (const d of devs) if (d.id !== st.id.deviceId) { let w; try { w = await C.wrapTo(secret, d.pub, thread.id + ":" + epoch, d.kem_pub); } catch (e) { try { w = await C.wrapTo(secret, d.pub, thread.id + ":" + epoch); console.warn("kem_pub of device " + d.id + " unusable; classical wrap"); } catch (e2) { console.warn("device " + d.id + " skipped: " + e2.message); continue; } } rows.push({ thread_id: thread.id, device_id: d.id, epoch, wrapped: w, wrap_v: w.v === 2 ? 2 : 1, kem_ct: w.kem || null }); }
    if (st.archivePub && thread.kind !== "dm" && thread.org_id) { const w = await C.wrapTo(secret, st.archivePub.pub, thread.id + ":" + epoch); rows.push({ thread_id: thread.id, device_id: st.archivePub.device_id, epoch, wrapped: w, wrap_v: 1, kem_ct: null }); }
    if (rows.length) { const r = await CLOUD.req("/rest/v1/msg_keys?on_conflict=thread_id,device_id,epoch", { method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=minimal" }, body: JSON.stringify(rows) }); if (!r.ok) throw new Error("Could not deliver the key: " + (await r.text()).slice(0, 120)); }
    await adoptEpoch(thread.id, epoch, secret, devs); return epoch;
  }
  async function createThread(opt) {
    const members = [...new Set([uid()].concat(opt.userIds || []))]; const kind = opt.kind || (members.length === 2 && !opt.title ? "dm" : "group");
    if (kind === "dm") { const existing = st.threads.find((t) => t.kind === "dm" && (st.members[t.id] || []).filter((m) => !m.removed_at && m.role !== "archive").map((m) => m.user_id).sort().join() === members.slice().sort().join()); if (existing) return existing; }
    const inCompany = org() && members.every((u) => u === uid() || (st.coMembers || []).includes(u));
    const t = await R.post("msg_threads", { org_id: inCompany ? org() : null, kind, title: opt.title || null, about: opt.about || null, created_by: uid(), last_at: now(), epoch: 0 });
    const rows = members.map((u) => ({ thread_id: t.id, user_id: u, role: u === uid() ? "admin" : "member" })); if (st.archivePub && kind !== "dm" && inCompany) rows.push({ thread_id: t.id, user_id: st.archivePub.device_id, role: "archive" });
    await CLOUD.req("/rest/v1/msg_members", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify(rows) });
    st.threads.unshift(t); st.members[t.id] = rows.map((r) => ({ ...r, added_at: now(), removed_at: null })); await cutEpoch(t); return t;
  }
  async function sendRaw(thread, body) {
    let ep = st.epochs[thread.id]; let c = ep && chainOf(thread.id, ep.current, st.id.deviceId);
    if (!c || ep.current < (thread.epoch || 0) || Date.now() - new Date(ep.cutAt) > 7 * DAY || c.n >= 1000) { await consumeKeys(); ep = st.epochs[thread.id]; c = ep && chainOf(thread.id, ep.current, st.id.deviceId); if (!c || ep.current < (thread.epoch || 0) || Date.now() - new Date(ep.cutAt) > 7 * DAY || c.n >= 1000) { if (!(await cutEpoch(thread))) await consumeKeys(); ep = st.epochs[thread.id]; c = ep && chainOf(thread.id, ep.current, st.id.deviceId); } }
    if (!c) throw new Error("No key for this conversation on this device yet — try again in a moment");
    const n = c.n; const mk = await takeKey(thread.id, ep.current, st.id.deviceId, n); const sealed = await C.seal(mk, body, aad(thread.id, ep.current, st.id.deviceId, n)); mk.fill(0);
    const row = await R.post("msg_messages", { thread_id: thread.id, sender_user: uid(), sender_device: st.id.deviceId, epoch: ep.current, n, iv: sealed.iv, ct: sealed.ct });
    if (!st.since || row.created_at > st.since) { st.since = row.created_at; await saveSince(); } return row;
  }
  async function send(thread, body) {
    const row = await sendRaw(thread, body); await R.patch("msg_threads", "id=eq." + thread.id, { last_at: row.created_at }); thread.last_at = row.created_at;
    const m = { id: row.id, thread_id: thread.id, sender_user: uid(), sender_device: st.id.deviceId, created_at: row.created_at, edited_at: null, deleted: false, epoch: row.epoch, n: row.n, body, locked: false };
    (st.msgs[thread.id] = st.msgs[thread.id] || []).push(m); await saveMsg(m); markRead(thread);
  }
  async function editMessage(m, text) { const t = st.threads.find((x) => x.id === m.thread_id); const row = await sendRaw(t, { kind: "edit", ref: m.id, text }); m.body = { ...(m.body || {}), text }; m.edited_at = row.created_at; await saveMsg(m); }
  const REACTS = ["✓", "★", "!", "?"];
  async function react(m, r) { const t = st.threads.find((x) => x.id === m.thread_id); if (!t) return; const mine = (m.reactions || {})[uid()]; const next = mine === r ? "" : r; await sendRaw(t, { kind: "react", ref: m.id, r: next }); await applyControl({ thread_id: t.id, sender_user: uid(), created_at: now(), body: { kind: "react", ref: m.id, r: next } }); }
  async function pin(m, on) { const t = st.threads.find((x) => x.id === m.thread_id); if (!t) return; await sendRaw(t, { kind: "pin", ref: m.id, on: !!on }); await applyControl({ thread_id: t.id, sender_user: uid(), created_at: now(), body: { kind: "pin", ref: m.id, on: !!on } }); }
  // 4.16 · read receipts: msg_reads holds each member's last read time (members may read the thread's rows); fetched when a conversation opens
  async function seenBy(t) { try { const rows = await R.get("msg_reads?select=user_id,last_read_at&thread_id=eq." + t.id); const out = {}; for (const r of rows || []) if (r.user_id !== uid()) out[r.user_id] = r.last_read_at; st.seen[t.id] = out; return out; } catch (e) { return st.seen[t.id] || {}; } }
  async function retract(m) { const t = st.threads.find((x) => x.id === m.thread_id); await sendRaw(t, { kind: "retract", ref: m.id }); await R.patch("msg_messages", "id=eq." + m.id, { deleted: true, ct: "", iv: "", edited_at: now() }).catch(() => {}); m.deleted = true; m.body = null; await saveMsg(m); }
  async function markRead(thread) { const list = st.msgs[thread.id] || []; const last = list.length ? list[list.length - 1].created_at : now(); if (st.reads[thread.id] === last) return; st.reads[thread.id] = last; try { await CLOUD.req("/rest/v1/msg_reads?on_conflict=thread_id,user_id", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify({ thread_id: thread.id, user_id: uid(), last_read_at: last }) }); } catch (e) { /* later */ } }
  async function addMembers(thread, userIds) { const rows = userIds.filter((u) => !(st.members[thread.id] || []).some((m) => m.user_id === u && !m.removed_at)).map((u) => ({ thread_id: thread.id, user_id: u, role: "member" })); if (!rows.length) return; await CLOUD.req("/rest/v1/msg_members", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify(rows) }); st.members[thread.id] = (st.members[thread.id] || []).concat(rows.map((r) => ({ ...r, added_at: now(), removed_at: null }))); await cutEpoch(thread); }
  async function removeMember(thread, userId) { await R.patch("msg_members", "thread_id=eq." + thread.id + "&user_id=eq." + userId, { removed_at: now() }); for (const m of st.members[thread.id] || []) if (m.user_id === userId) m.removed_at = now(); if (userId !== uid()) await cutEpoch(thread); }
  // the company archive: an administrator creates the key once; its private half is sealed to each administrator's devices
  async function enableArchive() {
    if (!CLOUD.isAdmin()) { SUITE.toast("Only an administrator can switch on the archive"); return; }
    if (!(await SUITE.confirm({ title: "Keep a company archive of conversations?", text: "The company gets an archive key. Every group conversation is readable with it, and every thread says so to its members. Only administrators' devices receive the key. Direct messages between two people are not archived." }, "Switch on"))) return;
    const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveKey", "deriveBits"]); const pub = await crypto.subtle.exportKey("jwk", pair.publicKey); const priv = await crypto.subtle.exportKey("jwk", pair.privateKey);
    const admins = (await CLOUD.admins()).concat([uid()]); const devs = await devicesFor([...new Set(admins)]);
    const archiveId = crypto.randomUUID(); const wrapped = []; const raw = crypto.getRandomValues(new Uint8Array(32)); const aes = await crypto.subtle.importKey("raw", raw, { name: "AES-GCM", length: 256 }, false, ["encrypt"]);
    // the private key travels sealed under a one-time AES key that is itself wrapped to each admin device
    const iv = crypto.getRandomValues(new Uint8Array(12)); const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, aes, enc.encode(JSON.stringify(priv))));
    for (const d of devs) wrapped.push({ device_id: d.id, pub: d.pub, kem: d.kem_pub || null, wrapped: await C.wrapTo(raw, d.pub, "archive:" + archiveId, d.kem_pub) }); await rput("meta", { k: uid() + ":archive:" + archiveId, uid: uid(), box: await lseal({ raw: b64(raw) }) });
    const r = await CLOUD.req("/rest/v1/msg_archive", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ org_id: org(), device_id: archiveId, pub, priv_sealed: { iv: b64(iv), ct: b64(ct) }, holders: wrapped, created_by: uid() }) }); if (!r.ok) { SUITE.toast("Could not switch on the archive: " + (await r.text()).slice(0, 100)); return; }
    st.archivePub = { device_id: archiveId, pub }; st.archivePriv = pair.privateKey; SUITE.toast("The company archive is on"); drawSide(); if (st.sel) drawMain();
  }

  // ---------- link previews through the workspace's isolated function (never from the user's device)
  const previews = {}; const URLRE = /https?:\/\/[^\s<>"')\]]+/i;
  const previewImages = {};
  async function previewImage(src) { if (previewImages[src] !== undefined) return previewImages[src]; previewImages[src] = null; try { const r = await CLOUD.req("/functions/v1/preview", { method: "POST", body: JSON.stringify({ image: src }) }); if (r.ok && r.status === 200) { const b = await r.blob(); if (b.size && /^image\//.test(b.type)) previewImages[src] = URL.createObjectURL(b); } } catch (e) { /* no picture */ } return previewImages[src]; }
  async function preview(url) { if (previews[url] !== undefined) return previews[url]; previews[url] = null; try { const r = await CLOUD.req("/functions/v1/preview", { method: "POST", body: JSON.stringify({ url }) }); if (r.ok) { const j = await r.json(); previews[url] = j && (j.title || j.description) ? j : null; } } catch (e) { /* no preview */ } return previews[url]; }

  // ---------- the app
  function mount(body, fr) {
    frame = fr; st.open = true; root = H("div", { class: "sh-app ms with-pane", "data-pane": "side" }); side = H("div", { class: "sh-side" }); main = H("div", { class: "sh-main" }); pane = H("div", { class: "sh-pane" }); root.append(side, main, pane); body.append(root);
    frame.setActions(H("button", { class: "quiet", onclick: () => newGroup() }, "New group"), H("button", { class: "primary", onclick: () => newMessage() }, "New message"));
    if (frame.setBar) frame.setBar({ side: { l: "Chats", icon: "send", on: () => st.pane === "side", fn: () => setPane("side") }, search: () => { setPane("side"); setTimeout(() => { const i = side.querySelector(".ms-search input, input[placeholder^='Search']"); if (i) i.focus(); }, 80); }, create: { l: "New message", fn: () => newMessage() }, more: [{ l: "New group", fn: () => newGroup() }, { l: "Devices and keys", fn: () => devicesInfo() }, { l: "Company archive", fn: () => archiveInfo() }] });
    side.append(H("div", { class: "sh-dim", style: "padding:20px" }, "Opening…")); main.append(H("div", { class: "sh-empty" }, ""));
    if (st.ready && st.booted) draw(); boot().then(() => { draw(); startPolling(); });
  }
  function unmount() { stopPolling(); st.open = false; frame.setBack(null); }
  function setPane(p) { st.pane = p; root.dataset.pane = p; if (SUITE.nav) SUITE.nav.mark(p); frame.setBack(SUITE.isMobile() && p !== "side" ? () => setPane(p === "pane" ? "main" : "side") : null, p === "pane" ? "Conversation" : "Chats"); if (frame.refreshTabs) frame.refreshTabs(); }
  function draw() { drawSide(); drawMain(); drawPane(); setPane(st.pane); }
  function refresh() { if (st.ready) draw(); }
  function onEsc() { if (SUITE.isMobile() && st.pane !== "side") { setPane(st.pane === "pane" ? "main" : "side"); return true; } return false; }
  // 4.10 · one step back: conversation → list → chats (phone)
  function onBack() { return onEsc(); }
  function countLine() { const total = st.threads.reduce((k, t) => k + unread(t), 0); const L = filtered(); return (msFiltered() ? L.length + " of " + st.threads.length + " · filtered" : st.threads.length + (st.threads.length === 1 ? " conversation" : " conversations")) + (total ? " · " + total + " unread" : "") + (st.archivePub ? " · company archive on" : ""); }
  const msFilter = () => (SUITE.filterValue ? SUITE.filterValue("messages") : {}); const msFiltered = () => { const F = msFilter(); return Array.isArray(F.state) && F.state.length > 0; };
  function filtered() { let L = st.threads.slice(); if (st.filter === "unread") L = L.filter((t) => unread(t) > 0); else if (st.filter === "groups") L = L.filter((t) => t.kind === "group"); else if (st.filter === "about") L = L.filter((t) => t.about); else if (st.filter === "archive") L = L.filter((t) => isArchived(t));
    const chips = Array.isArray(msFilter().state) ? msFilter().state : []; /* 4.10 · chip filters combine */ if (chips.includes("unread")) L = L.filter((t) => unread(t) > 0); if (chips.includes("groups")) L = L.filter((t) => t.kind === "group"); if (chips.includes("trades")) L = L.filter((t) => t.about); if (st.q) { const q = st.q.toLowerCase(); L = L.filter((t) => threadTitle(t).toLowerCase().includes(q) || (st.msgs[t.id] || []).some((m) => m.body && (m.body.text || "").toLowerCase().includes(q))); } return L.sort((a, b) => (b.last_at || "").localeCompare(a.last_at || "")); }

  function drawSide() {
    side.innerHTML = "";
    if (!cloud()) { side.append(H("div", { class: "sh-empty", style: "margin:40px 16px" }, SUITE.icon("send"), H("b", {}, "Messages need an account"), H("div", {}, "Sign in to message colleagues and connections. Everything is encrypted end to end between your devices."))); return; }
    if (st.err) { side.append(H("div", { class: "sh-empty", style: "margin:40px 16px" }, SUITE.icon("send"), H("b", {}, "Messages are not set up in this workspace yet"), H("div", { class: "sh-dim" }, st.err.includes("does not exist") || st.err.includes("relation") ? "The administrator runs the 4.3 cloud script once (Settings → Software update explains); then this works for everyone." : st.err), H("div", {}, H("button", { onclick: () => { boot().then(draw); } }, "Try again")))); return; }
    const inp = H("input", { placeholder: "Search conversations", value: st.q, oninput: (e) => { st.q = e.target.value; drawList(); } });
    side.append(H("div", { class: "nt-quick ms-quick" }, inp, H("button", { class: "quiet", onclick: () => inp.focus() }, SUITE.glyph("search"))));
    if (SUITE.chips) side.append(SUITE.chips({ key: "messages", onChange: () => { drawList(); const sub = side.querySelector(".ms-head .nt-sub"); if (sub) sub.textContent = countLine(); }, groups: [{ id: "state", multi: true, options: [{ v: "unread", l: "Unread" }, { v: "groups", l: "Groups" }, { v: "trades", l: "Trades" }] }] }));
    side.append(H("div", { class: "pt-kinds ms-kinds" }, H("button", { onclick: () => newMessage() }, SUITE.glyph("send"), H("span", {}, "New")), H("button", { onclick: () => newGroup() }, SUITE.glyph("people"), H("span", {}, "Group")), H("button", { class: st.filter === "unread" ? "on" : "", onclick: () => { st.filter = st.filter === "unread" ? "all" : "unread"; drawList(); } }, SUITE.glyph("clock"), H("span", {}, "Unread")), H("button", { class: st.filter === "about" ? "on" : "", onclick: () => { st.filter = st.filter === "about" ? "all" : "about"; drawList(); } }, SUITE.glyph("trade"), H("span", {}, "Trades"))));
    const total = st.threads.reduce((k, t) => k + unread(t), 0);
    side.append(H("div", { class: "nt-head ms-head" }, H("div", { class: "nt-hd" }, H("h2", {}, "Chats"), H("div", { class: "nt-sub" }, countLine())), H("button", { class: "quiet nt-more", onclick: (e) => SUITE.menu(e.currentTarget, [{ l: "Devices and keys", fn: devicesInfo }, { l: st.archivePub ? "About the company archive" : "Switch on the company archive…", fn: () => (st.archivePub ? archiveInfo() : enableArchive()) }, st.archivePriv ? { l: st.filter === "archive" ? "All conversations" : "Archived conversations only", fn: () => { st.filter = st.filter === "archive" ? "all" : "archive"; drawList(); } } : null, { sep: 1 }, { l: "How this app works", fn: () => SUITE.showHelp("messages") }]) }, "⋯")));
    const list = H("div", { class: "ms-list" }); side.append(list); st._list = list; drawList();
  }
  function drawList() {
    const list = st._list; if (!list) return; list.innerHTML = ""; const L = filtered();
    if (!L.length) { list.append(H("div", { class: "sh-empty" }, SUITE.icon("send"), H("b", {}, st.q ? "Nothing matches" : st.filter !== "all" ? "Nothing here" : "No conversations yet"), H("div", {}, st.q || st.filter !== "all" ? "" : "Start one with New, or a group with the people on a trade."))); return; }
    for (const t of L) { const msgs = st.msgs[t.id] || []; const last = msgs.filter((m) => !m.deleted).slice(-1)[0]; const n = unread(t);
      const row = H("div", { class: "ms-row" + (st.sel === t.id ? " on" : "") + (n ? " unread" : ""), onclick: () => open(t.id) },
        H("span", { class: "ct-av" + (t.kind === "group" ? " co" : "") }, t.kind === "group" ? SUITE.glyph("people") : initialsOf(((st.members[t.id] || []).find((m) => m.user_id !== me().user_id && m.role !== "archive") || {}).user_id)),
        H("div", { class: "ms-main" }, H("div", { class: "t" }, H("span", { class: "ms-title" }, threadTitle(t)), H("span", { class: "ms-when" }, t.last_at ? SUITE.ago(t.last_at) : "")), H("div", { class: "p" }, t.about ? H("span", { class: "ms-about" }, t.about.label || t.about.id) : null, last ? (last.locked ? "Encrypted on another device" : (last.sender_user === me().user_id ? "You: " : "") + (last.body.text || (last.body.att && last.body.att.length ? "📎 " + last.body.att[0].name : ""))) : "No messages yet")),
        n ? H("span", { class: "ms-n" }, n) : null);
      SUITE.swipe(row, { left: [{ l: "Leave", icon: "trash", cls: "danger", fn: () => leave(t) }], right: [{ l: n ? "Read" : "Unread", icon: "check", fn: () => { if (n) markRead(t); else st.reads[t.id] = "0"; drawList(); } }] });
      list.append(row); }
  }
  async function open(id) { st.sel = id; st.pane = "main"; drawList(); drawMain(); drawPane(); setPane("main"); const t = st.threads.find((x) => x.id === id); if (t) markRead(t); }
  function drawMain(keepScroll) {
    const t = st.threads.find((x) => x.id === st.sel); const scroller = main.querySelector(".ms-msgs"); const atBottom = !scroller || scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 80;
    main.innerHTML = "";
    if (!t) { main.append(H("div", { class: "sh-empty", style: "margin:auto" }, SUITE.icon("send"), H("b", {}, cloud() ? "Pick a conversation" : "Messages"), H("div", {}, cloud() ? "or start one with New." : "Sign in to the company workspace to use Messages."))); return; }
    const arch = isArchived(t); const members = currentMemberIds(t);
    main.append(H("div", { class: "ms-top" }, H("div", { class: "ms-tt" }, H("h2", {}, threadTitle(t)), H("div", { class: "nt-sub" }, [members.length + (members.length === 1 ? " person" : " people"), !isMember(t) ? "archive view" : null, arch ? "archived by " + ((CLOUD.state && CLOUD.state.orgName) || "the company") : "end to end encrypted", t.about ? "about " + (t.about.label || t.about.id) : null].filter(Boolean).join(" · "))), H("div", { class: "ms-tacts" }, t.about ? H("button", { class: "quiet", onclick: () => openAbout(t) }, "Open " + (t.about.type || "trade")) : null, H("button", { class: "quiet", title: "Find in this conversation", onclick: () => findBar(t) }, "Find"), H("button", { class: "quiet", onclick: () => { st.pane = "pane"; drawPane(); setPane("pane"); } }, "Details"))));
    const msgs = st.msgs[t.id] || []; let lastDay = null, lastSender = null;
    const pins = msgs.filter((m) => m.pinned && !m.deleted && m.body); if (pins.length) { const p = pins[pins.length - 1]; main.append(H("button", { class: "ms-pinbar", title: "Show the pinned message", onclick: () => { const el = main.querySelector('.ms-b[data-id="' + p.id + '"]'); if (el) { el.scrollIntoView({ block: "center" }); el.classList.add("ms-flash"); setTimeout(() => el.classList.remove("ms-flash"), 1400); } } }, H("span", { class: "ms-pink" }, pins.length > 1 ? pins.length + " pinned" : "Pinned"), H("span", { class: "ms-pint" }, (p.body.text || (p.body.att && p.body.att[0] ? p.body.att[0].name : "")).slice(0, 160)))); }
    const box = H("div", { class: "ms-msgs" }); main.append(box);
    if (!msgs.length) box.append(H("div", { class: "ms-empty" }, arch ? "Say hello. Messages here are encrypted end to end and kept in the company archive." : "Say hello. Messages here are encrypted end to end; only the people in this conversation can read them."));
    for (const m of msgs) { const day = m.created_at.slice(0, 10); if (day !== lastDay) { lastDay = day; lastSender = null; box.append(H("div", { class: "ms-day" }, day === SUITE.today() ? "Today" : SUITE.fmtDate(day))); } box.append(bubble(m, t, lastSender !== m.sender_user)); lastSender = m.sender_user; }
    // 4.16 · read receipt under the last message I sent: "Seen" in a direct conversation, "Seen by …" in a group
    const lastMine = [...msgs].reverse().find((m) => m.sender_user === uid() && !m.deleted); if (lastMine && cloud()) { const rr = H("div", { class: "ms-seen" }); box.append(rr); seenBy(t).then((seen) => { const who = Object.entries(seen).filter(([, at]) => at && at >= lastMine.created_at).map(([u]) => u); if (!who.length) { rr.textContent = "Delivered"; return; } rr.textContent = t.kind === "dm" ? "Seen" : "Seen by " + who.map(nameOf).join(", "); }); }
    if (isMember(t)) main.append(composer(t)); else main.append(H("div", { class: "ms-compose ms-ro" }, H("div", { class: "sh-dim", style: "text-align:center;padding:6px" }, "Archive view — you are reading this as an administrator through the company's archive key; you are not in the conversation.")));
    requestAnimationFrame(() => { if (!keepScroll || atBottom) box.scrollTop = box.scrollHeight; });
  }
  function bubble(m, t, showName) {
    const mine = m.sender_user === me().user_id; const el = H("div", { class: "ms-b" + (mine ? " mine" : "") + (m.deleted ? " gone" : "") + (m.pinned ? " pinned" : ""), "data-id": m.id });
    if (showName && !mine) el.append(H("div", { class: "ms-who" }, nameOf(m.sender_user)));
    const body = H("div", { class: "ms-body", oncontextmenu: (e) => { e.preventDefault(); msgMenu(e, m, t); } });
    if (m.deleted) body.append(H("i", {}, "Message removed")); else if (m.locked) body.append(H("i", {}, "Sent before this device joined the conversation — it stays on the devices that were there."));
    else { if (m.body.reply) body.append(H("div", { class: "ms-reply" }, H("b", {}, m.body.reply.who || ""), " ", m.body.reply.text || "")); if (m.body.text) body.append(H("div", { class: "ms-text", html: linkify(m.body.text) })); for (const a of m.body.att || []) body.append(attachment(a, t, m)); const url = URLRE.exec(m.body.text || ""); if (url && cloud()) { const pv = H("div", { class: "ms-pv" }); body.append(pv); preview(url[0]).then((p) => { if (!p) { pv.remove(); return; } const img = p.image ? H("img", { alt: "" }) : null; if (img) previewImage(p.image).then((src) => { if (src) img.src = src; else img.remove(); }); pv.append(H("a", { href: url[0], target: "_blank", rel: "noopener noreferrer", onclick: (e) => { e.preventDefault(); openLink(url[0]); } }, img, H("div", { class: "ms-pvt" }, H("b", {}, p.title || url[0]), p.description ? H("span", {}, p.description) : null, H("small", {}, p.site || new URL(url[0]).hostname)))); }); } }
    const rx = m.reactions && !m.deleted ? Object.entries(m.reactions).reduce((acc, [u, r]) => { (acc[r] = acc[r] || []).push(u); return acc; }, {}) : {};
    if (Object.keys(rx).length) el.append(H("div", { class: "ms-rx" }, Object.entries(rx).map(([r, us]) => H("button", { class: "ms-rxb" + (us.includes(uid()) ? " on" : ""), title: us.map((u) => (u === uid() ? "You" : nameOf(u))).join(", "), onclick: () => react(m, r).then(() => drawMain(true)).catch((e) => SUITE.toast(e.message)) }, r, H("span", {}, String(us.length))))));
    el.append(body, H("div", { class: "ms-meta" }, m.pinned && !m.deleted ? H("span", { class: "ms-pin" }, "pinned · ") : null, new Date(m.created_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }), m.edited_at && !m.deleted ? " · edited" : "", !m.deleted && !m.locked ? H("button", { class: "quiet ms-more", title: "More", "aria-label": "More", onclick: (e) => msgMenu(e, m, t) }, "⋯") : null));
    if (Object.keys(rx).length) el.append(el.querySelector(".ms-rx"));
    el.addEventListener("dblclick", () => replyTo(m));
    return el;
  }
  function findBar(t) {
    let bar = main.querySelector(".ms-find"); if (bar) { bar.querySelector("input").focus(); return; } let hits = [], at = -1;
    const count = H("span", { class: "ms-findn" }, ""); const inp = H("input", { type: "search", placeholder: "Find in this conversation", "aria-label": "Find in this conversation" });
    const go = (d) => { if (!hits.length) return; at = (at + d + hits.length) % hits.length; hits.forEach((el, i) => el.classList.toggle("ms-cur", i === at)); hits[at].scrollIntoView({ block: "center" }); count.textContent = (at + 1) + " of " + hits.length; };
    const run = () => { const q = inp.value.trim().toLowerCase(); hits = []; at = -1; for (const el of main.querySelectorAll(".ms-b")) { const m = (st.msgs[t.id] || []).find((x) => x.id === el.dataset.id); const txt = m && m.body ? ((m.body.text || "") + " " + (m.body.att || []).map((a) => a.name).join(" ")).toLowerCase() : ""; const hit = q && txt.includes(q); el.classList.toggle("ms-hit", !!hit); el.classList.toggle("ms-dimmed", !!q && !hit); el.classList.remove("ms-cur"); if (hit) hits.push(el); } count.textContent = q ? (hits.length ? hits.length + " found" : "nothing") : ""; if (hits.length) go(hits.length); };
    const close = () => { bar.remove(); for (const el of main.querySelectorAll(".ms-b")) el.classList.remove("ms-hit", "ms-dimmed", "ms-cur"); };
    inp.addEventListener("input", run); inp.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); go(e.shiftKey ? -1 : 1); } if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); } });
    bar = H("div", { class: "ms-find" }, inp, count, H("button", { class: "quiet", title: "Previous", onclick: () => go(-1) }, "↑"), H("button", { class: "quiet", title: "Next", onclick: () => go(1) }, "↓"), H("button", { class: "quiet", title: "Close", onclick: close }, "✕"));
    const top = main.querySelector(".ms-top"); top.after(bar); setTimeout(() => inp.focus(), 20);
  }
  function linkify(text) { return esc(text).replace(/(https?:\/\/[^\s<>"')\]]+)/g, (u) => '<a href="' + u + '" data-link="' + u + '">' + u + "</a>").replace(/\n/g, "<br>"); }
  function openLink(u) { if (SUITE.host && SUITE.host.openExternal) SUITE.host.openExternal(u); else window.open(u, "_blank", "noopener"); }
  function attachment(a, t, m) { const el = H("button", { class: "ms-att", onclick: async () => { try { SUITE.toast("Opening " + a.name + "…"); const blob = a.path && CLOUD.signedIn() ? await CLOUD.suiteGetPath(a.path) : await SUITE.files.get(a.key); const bytes = await C.openBytes(new Uint8Array(await blob.arrayBuffer()), a.k, a.iv); await SUITE.view({ name: a.name, blob: new Blob([bytes], { type: a.mime || "" }), mime: a.mime }); } catch (e) { SUITE.toast("Could not open: " + e.message); } } }, SUITE.glyph("doc"), H("span", {}, a.name), H("small", {}, SUITE.fmtBytes(a.size))); return el; }
  function msgMenu(e, m, t) { const mine = m.sender_user === me().user_id; SUITE.menu(e.currentTarget || { getBoundingClientRect: () => ({ left: e.clientX, right: e.clientX, top: e.clientY, bottom: e.clientY }) }, [{ l: "Reply", fn: () => replyTo(m) }, ...(m.body && !m.deleted && isMember(t) ? [{ l: "React  " + REACTS.join("  "), fn: () => { const anchor = main.querySelector('.ms-b[data-id="' + m.id + '"] .ms-more') || main; SUITE.menu(anchor, REACTS.map((r) => ({ l: r + "  " + ({ "✓": "Agree / done", "★": "Important", "!": "Attention", "?": "Question" })[r] + ((m.reactions || {})[uid()] === r ? " · remove" : ""), fn: () => react(m, r).then(() => drawMain(true)).catch((e) => SUITE.toast(e.message)) }))); } }, { l: m.pinned ? "Unpin" : "Pin to the conversation", fn: () => pin(m, !m.pinned).then(() => drawMain(true)).catch((e) => SUITE.toast(e.message)) }] : []), m.body && m.body.text ? { l: "Copy text", fn: () => SUITE.copy(m.body.text) } : null, mine && !m.deleted && Date.now() - new Date(m.created_at) < 15 * 60000 ? { l: "Edit", fn: async () => { const v = await SUITE.prompt("Edit message", "Text", m.body.text || ""); if (v != null) { await editMessage(m, v); drawMain(true); } } } : null, mine && !m.deleted ? { l: "Remove for everyone", danger: 1, fn: async () => { if (await SUITE.confirm("Remove this message for everyone?", "Remove", true)) { await retract(m); drawMain(true); } } } : null].filter(Boolean)); }
  let replying = null;
  function replyTo(m) { if (!m.body) return; replying = { who: nameOf(m.sender_user), text: (m.body.text || (m.body.att && m.body.att[0] ? m.body.att[0].name : "")).slice(0, 140) }; const bar = main.querySelector(".ms-replybar"); if (bar) { bar.innerHTML = ""; bar.append(H("b", {}, replying.who), " ", replying.text, H("button", { class: "quiet", onclick: () => { replying = null; bar.style.display = "none"; } }, "✕")); bar.style.display = ""; } main.querySelector(".ms-input") && main.querySelector(".ms-input").focus(); }
  function composer(t) {
    const ta = H("textarea", { class: "ms-input", placeholder: "Message " + threadTitle(t), rows: 1, value: st.drafts[t.id] || "", oninput: (e) => { st.drafts[t.id] = e.target.value; e.target.style.height = "auto"; e.target.style.height = Math.min(160, e.target.scrollHeight) + "px"; }, onkeydown: (e) => { if (e.key === "Enter" && !e.shiftKey && !SUITE.isMobile()) { e.preventDefault(); go(); } } });
    if (SUITE.contacts) SUITE.contacts.attachSuggest(ta);
    const pending = []; const files = H("div", { class: "ms-pending" });
    const attach = async () => { const list = await SUITE.pickFiles({}); for (const f of list || []) { pending.push(f); files.append(H("span", { class: "sh-tag" }, f.name, H("button", { class: "quiet", onclick: (e) => { e.currentTarget.parentElement.remove(); pending.splice(pending.indexOf(f), 1); } }, "✕"))); } };
    const go = async () => { const text = ta.value.trim(); if (!text && !pending.length) return; const btn = main.querySelector(".ms-send"); if (btn) btn.disabled = true; try { const att = []; for (const f of pending) { const bytes = new Uint8Array(await f.arrayBuffer()); const sealed = await C.sealBytes(bytes); const key = (t.org_id ? "org/msg/" : "msg/") + t.id + "/" + crypto.randomUUID(); const blob = new Blob([sealed.ct], { type: "application/octet-stream" }); let path = null; if (CLOUD.signedIn()) { await CLOUD.suitePut(key, blob); path = CLOUD.suitePath(key); } else await SUITE.files.put(key, blob); att.push({ key, path, name: f.name, size: f.size, mime: f.type, k: sealed.key, iv: sealed.iv }); } await send(t, { text, att, reply: replying || undefined }); replying = null; ta.value = ""; st.drafts[t.id] = ""; pending.length = 0; files.innerHTML = ""; ta.style.height = "auto"; drawMain(); drawList(); } catch (e) { SUITE.toast("Not sent: " + e.message); } finally { if (btn) btn.disabled = false; } };
    return H("div", { class: "ms-compose" }, H("div", { class: "ms-replybar", style: replying ? "" : "display:none" }), files, H("div", { class: "ms-row2" }, H("button", { class: "quiet", title: "Attach", onclick: attach }, SUITE.glyph("upload")), ta, H("button", { class: "quiet ms-send", title: "Send", onclick: go }, SUITE.glyph("send"))));
  }
  function drawPane() {
    pane.innerHTML = ""; const t = st.threads.find((x) => x.id === st.sel); if (!t) { pane.append(H("div", { class: "sh-empty", style: "margin:40px 20px" }, SUITE.icon("people"), H("b", {}, "Details"), H("div", {}, "Who is in a conversation, what it is about, its files."))); return; }
    const members = (st.members[t.id] || []).filter((m) => !m.removed_at); const admin = members.some((m) => m.user_id === me().user_id && m.role === "admin");
    pane.append(H("div", { class: "ph" }, H("div", { style: "flex:1" }, H("h2", {}, threadTitle(t)), H("div", { class: "sub" }, t.kind === "group" ? "Group" : "Direct", " · created " + SUITE.fmtDate(t.created_at.slice(0, 10))), SUITE.visNote({ kind: "e2e", text: "Only the people in this conversation · end-to-end encrypted" }))));
    const sec = (title, ...k) => H("section", { style: "padding:16px 20px;border-bottom:1px solid var(--pt-hair)" }, H("h3", { class: "caps", style: "margin:0 0 8px" }, title), ...k);
    pane.append(sec("People", members.filter((m) => m.role !== "archive").map((m) => H("div", { class: "ms-member" }, H("span", { class: "ct-av" }, initialsOf(m.user_id)), H("span", {}, nameOf(m.user_id)), H("small", { class: "sh-faint" }, m.role === "admin" ? "admin" : ""), admin && m.user_id !== me().user_id && t.kind === "group" ? H("button", { class: "quiet", onclick: async () => { await removeMember(t, m.user_id); drawPane(); drawMain(); } }, "Remove") : null)), t.kind === "group" && admin ? H("button", { onclick: () => addPeople(t) }, "Add people") : null));
    if (isArchived(t)) pane.append(sec("Archive", H("div", { class: "sh-dim" }, "This conversation is kept in the company archive: administrators can read it with the archive key. Everyone in it is told so in the header.")));
    pane.append(sec("About", t.about ? H("button", { class: "quiet", onclick: () => openAbout(t) }, "Open " + (t.about.label || t.about.id)) : H("button", { class: "quiet", onclick: () => attachAbout(t) }, "Attach to a trade or counterparty…")));
    const files = (st.msgs[t.id] || []).flatMap((m) => (m.body && m.body.att) || []); if (files.length) pane.append(sec("Files", files.map((a) => attachment(a, t))));
    { const ep = st.epochs[t.id]; const c = myChain(t); pane.append(sec("Encryption", H("div", { class: "sh-dim", style: "font-size:12px;line-height:1.5" }, "Epoch " + (t.epoch || 0) + (ep ? " · this device holds chains for " + Object.keys(st.chains[t.id] || {}).length + " epoch" + (Object.keys(st.chains[t.id] || {}).length === 1 ? "" : "s") + (c && isMember(t) ? " · your sending chain is at message " + c.n : "") : " · waiting for the key") + ". Every message has its own key, used once and discarded; a new epoch is cut when the people or devices change, weekly, or on request. Identity key renewed " + SUITE.ago(st.id.rotatedAt) + "."), H("div", { class: "sh-dim", style: "font-size:12px;line-height:1.6;margin-top:6px" }, (() => { const devs = memberDevices(t); const pq = devs.filter((d) => d.kem_pub).length; return "Key delivery: " + (st.id.kem ? "post-quantum on this device (ECDH P-256 + ML-KEM-768)" : "classical on this device") + " · " + pq + " of " + devs.length + " member device" + (devs.length === 1 ? "" : "s") + " post-quantum" + (pq < devs.length ? " — the rest receive the classical wrap until they sign in with 4.7" : "") + "."; })()), H("div", { class: "sh-dim ms-devs", style: "font-size:12px;line-height:1.6" }, memberDevices(t).map((d) => H("div", {}, nameOf(d.user_id) + " · " + (d.name || "device") + " · " + d.id.slice(0, 8) + " · " + (d.kem_pub ? "post-quantum" : "classical")))), isMember(t) ? H("button", { class: "quiet", onclick: async () => { const e = await cutEpoch(t); SUITE.toast(e ? "New epoch cut" : "Someone just did"); drawPane(); } }, "New epoch now") : null)); }
    if (isMember(t)) pane.append(sec("", H("div", { class: "sh-toolbar", style: "margin:0;gap:10px" }, H("button", { class: "quiet danger", onclick: () => leave(t) }, t.kind === "group" ? "Leave group" : "Leave conversation"), H("button", { class: "quiet", onclick: () => { const other = members.find((m) => m.user_id !== me().user_id && m.role !== "archive"); SUITE.report({ what: "this conversation", ref: "thread:" + t.id, subject_id: t.kind === "dm" && other ? other.user_id : null }); } }, "Report…"))));
  }
  async function leave(t) { if (!(await SUITE.confirm({ title: "Leave " + threadTitle(t) + "?", text: "The others get a new key you do not have; this conversation's history leaves this device." }, "Leave", true))) return; await removeMember(t, me().user_id).catch(() => {}); if (!(st.archivePriv && isArchived(t))) { await forgetThreadLocal(t.id); st.threads = st.threads.filter((x) => x.id !== t.id); } if (st.sel === t.id) st.sel = null; draw(); setPane("side"); }
  function peopleOptions() { return st.people.filter((p) => p.id !== me().user_id); }
  async function pickPeople(title, multi) { const opts = peopleOptions(); if (!opts.length) { /* 4.17 G · no dead end: the step that makes someone reachable, one click away */ const admin = org() && typeof CLOUD !== "undefined" && CLOUD.isAdmin && CLOUD.isAdmin(); const go = await SUITE.dialog({ title: "Nobody to message yet", text: org() ? (admin ? "Nobody else in the company has signed in to XYNTAX yet. Invite your colleagues — or connect with someone outside the company." : "Nobody else in the company has signed in to XYNTAX yet. Ask your administrator to invite colleagues, or connect with someone you know.") : "Connect with someone first: they accept, and you can write to each other.", ok: admin ? "Invite colleagues" : "Connect with someone" }); if (go) SUITE.open("settings", { view: admin ? "users" : "connections" }); return null; } const v = await SUITE.dialog({ title, fields: multi ? [{ k: "who", label: "People", type: "checks", options: opts.map((p) => ({ v: p.id, l: p.name || p.user })) }] : [{ k: "who", label: "Person", type: "select", options: opts.map((p) => ({ v: p.id, l: p.name || p.user })) }], ok: "Next" }); if (!v) return null; return multi ? v.who : [v.who]; }
  async function newMessage(userId) { let ids = userId ? [userId] : await pickPeople("Message whom?", false); if (!ids || !ids.length) return; try { const t = await createThread({ userIds: ids }); draw(); open(t.id); } catch (e) { SUITE.toast(e.message); } }
  async function newGroup(preset) { if (preset && preset.about) { const ex = st.threads.find((t) => t.about && t.about.type === preset.about.type && t.about.id === preset.about.id); if (ex) { open(ex.id); return; } }
    const ids = preset && preset.userIds && preset.userIds.length ? preset.userIds : await pickPeople("Who is in the group?", true); if (!ids || !ids.length) return; const title = preset && preset.title ? preset.title : await SUITE.prompt("Name the group", "Name", preset && preset.about ? preset.about.label : ""); if (title == null) return; try { const t = await createThread({ userIds: ids, title: title || null, kind: "group", about: preset && preset.about }); draw(); open(t.id); } catch (e) { SUITE.toast(e.message); } }
  async function addPeople(t) { const ids = await pickPeople("Add whom?", true); if (!ids || !ids.length) return; await addMembers(t, ids); drawPane(); drawMain(); SUITE.toast("Added · new key cut"); }
  function openAbout(t) { const a = t.about; if (!a) return; if (a.type === "trade") SUITE.open("accounting", { view: "trade", id: a.id }); else if (a.type === "counterparty") SUITE.open("accounting", { view: "counterparty", id: a.id }); else if (a.type === "contact" && SUITE.contacts) SUITE.contacts.card(a.id); }
  async function attachAbout(t) { if (typeof S === "undefined" || !S.store) { SUITE.toast("Open Accounting first so the trades are known here"); return; } const trades = (S.store.trades || []).slice(-40).reverse(); const cps = S.store.counterparties || []; const v = await SUITE.dialog({ title: "Attach this conversation to", fields: [{ k: "what", label: "Trade or counterparty", type: "select", options: [{ v: "", l: "—" }].concat(trades.map((x) => ({ v: "trade:" + x.id, l: x.ref + " · " + ((cps.find((c) => c.id === x.customerId) || {}).name || "") })), cps.map((c) => ({ v: "counterparty:" + c.id, l: c.name }))) }], ok: "Attach" }); if (!v || !v.what) return; const [type, id] = v.what.split(":"); const label = type === "trade" ? (trades.find((x) => x.id === id) || {}).ref : (cps.find((c) => c.id === id) || {}).name; t.about = { type, id, label }; await R.patch("msg_threads", "id=eq." + t.id, { about: t.about }); drawMain(); drawPane(); drawList(); }
  function devicesInfo() { const mine = st.devices.filter((d) => d.user_id === me().user_id); SUITE.dialog({ title: "Your devices", text: "Each device has its own identity key, renewed about hourly while in use; epoch secrets are delivered to each device and turned into per-message keys there. This device: " + (st.id ? st.id.name + " · " + st.id.deviceId.slice(0, 8) + " · identity renewed " + SUITE.ago(st.id.rotatedAt) : "—") + ".\n\n" + mine.map((d) => "• " + d.name + " · " + d.id.slice(0, 8) + (d.id === st.id.deviceId ? " (this one)" : "") + " · " + (d.kem_pub ? "post-quantum" : "classical") + " · seen " + SUITE.ago(d.last_seen)).join("\n"), ok: "Close", cancel: " " }); }
  function archiveInfo() { if (!st.archivePub) { if (CLOUD.isAdmin()) enableArchive(); else SUITE.toast("The company archive is off; an administrator can switch it on"); return; } SUITE.dialog({ title: "Company archive", text: "On. Every group conversation's key is also delivered to the company's archive key, held by administrators' devices. Members see 'archived by " + ((CLOUD.state && CLOUD.state.orgName) || "the company") + "' in the header. Direct messages between two people are not archived.", ok: "Close", cancel: " " }); }

  // ---------- for the other apps
  async function messagesWith(contactOrUserId) { const uid = typeof contactOrUserId === "string" ? contactOrUserId : (contactOrUserId.userId || (st.people.find((p) => (contactOrUserId.emails || []).some((e) => e.v.toLowerCase() === (p.email || "").toLowerCase())) || {}).id); if (uid) { SUITE.open("messages", { with: uid }); return; } const em = typeof contactOrUserId === "object" && contactOrUserId.emails && contactOrUserId.emails[0] ? contactOrUserId.emails[0].v : null; if (em && cloud() && (await SUITE.confirm({ title: "Not connected yet", text: "Send " + em + " a connection request on XYNTAX? Once they accept, you can message each other here." }, "Send request"))) { try { const r = await CLOUD.account("connect", { email: em }); SUITE.toast(r.status === "accepted" ? "Connected — try again" : "Request sent"); } catch (e) { SUITE.toast(e.message); } } else SUITE.toast("No XYNTAX account to message — call or email instead"); }
  async function aboutThread(about, userIds) { SUITE.open("messages", { about, userIds }); }
  const summary = () => { const n = st.threads.reduce((k, t) => k + unread(t), 0); return n ? n + " unread" : (cloud() ? "Encrypted, company only" : "Sign in to use"); };
  const help = () => [["Who", "Members of your company who have signed in to XYNTAX. Direct messages and groups; a group can be attached to a trade or a counterparty, and opens from the trade file."], ["Encryption", "Every message has its own key, used once and discarded on every device — a device taken later cannot read what it already read, and the server's copy is dead ciphertext. Conversation epochs restart whenever people or devices change, weekly, or on request (Details → New epoch now)."], ["History", "Lives on the devices that were there. A new phone reads from the epoch it joins; what came before stays on the older devices (and in the company archive, where that is on)."], ["The archive", "If the company switches it on, group conversations are also readable with the company's archive key, held by administrators. The header of every such thread says so."], ["Links", "A link's preview is fetched by the workspace, never by your device, and only when the thread is open. Tap to open the link itself."], ["Files", "Attachments are encrypted on your device before upload and open in the viewer."]];
  async function search(q) { if (!cloud() || !st.ready) return []; q = q.toLowerCase(); const out = []; for (const t of st.threads) { const hit = threadTitle(t).toLowerCase().includes(q) ? null : (st.msgs[t.id] || []).slice().reverse().find((m) => m.body && (m.body.text || "").toLowerCase().includes(q)); if (threadTitle(t).toLowerCase().includes(q) || hit) out.push({ l: threadTitle(t), d: hit ? (hit.body.text || "").slice(0, 80) : (t.kind === "group" ? "group" : "conversation"), fn: () => SUITE.open("messages", { thread: t.id }) }); if (out.length >= 8) break; } return out; }
  // 4.17 G · n new message
  function onKey(e) { if (e.ctrlKey || e.metaKey || e.altKey) return; if (e.key === "n") { e.preventDefault(); newMessage(); } }
  SUITE.register("messages", { onKey, mount, unmount, refresh, onEsc, onBack, summary, help, search, defaults: {}, open(opt) { if (!opt) return; const after = () => { if (opt.with) newMessage(opt.with); else if (opt.about) newGroup({ about: opt.about, userIds: opt.userIds || [], title: opt.about.label }); else if (opt.thread) open(opt.thread); }; if (st.ready) after(); else setTimeout(after, 1200); } });
  SUITE.messagesWith = messagesWith; SUITE.messagesAbout = aboutThread;
  // 4.8 · for the notification bell: the unread conversations, without opening the app; and a quiet boot after the home is up,
  // so the first open is instant and the badge means something before Messages was ever opened in this session
  SUITE.messagesUnread = () => { if (!st.ready || !cloud()) return { n: 0, items: [] }; const items = st.threads.filter((t) => unread(t) > 0).map((t) => ({ id: "msg:" + t.id, app: "messages", title: threadTitle(t), body: unread(t) + " unread", at: t.last_at || null, open: () => SUITE.open("messages", { thread: t.id }) })); return { n: items.reduce((k, i) => k + (parseInt(i.body, 10) || 0), 0), items }; };
  SUITE.messagesTick = () => tickNow();
  SUITE.messagesWarm = async () => { if (!cloud() || (st.ready && st.booted)) return; await boot(); if (!st.timer && !st.open) startPolling(); };
  SUITE.messagesDebug = { _C: C, _id: () => st.id, rotateIdentity: () => C.rotateIdentity(), pq: () => ({ enabled: C.pq(), kemPub: st.id && st.id.kem ? st.id.kem.ek : null, deviceId: st.id && st.id.deviceId, devices: st.devices.map((d) => ({ id: d.id, pq: !!d.kem_pub })) }), bucket: (n) => C.bucket(n), pad: (n) => C.pad(new Uint8Array(n)).length, state: () => ({ epochs: st.epochs, rotatedAt: st.id && st.id.rotatedAt, chains: Object.fromEntries(Object.entries(st.chains).map(([t, e]) => [t, Object.fromEntries(Object.entries(e).map(([ep, d]) => [ep, Object.fromEntries(Object.entries(d).map(([id, c]) => [id, c.n]))]))])) }) };
  // signing out removes this device's history, chains and identity: the next sign-in here is a new device
  // sharing from other apps: text and files go to a person or a group, encrypted like anything else in a conversation
  SUITE.messagesShare = async (p) => {
    if (!cloud()) { SUITE.toast("Sign in to send messages"); return; }
    if (SUITE.current !== "messages") { await new Promise((res) => { SUITE.open("messages"); const t = setInterval(() => { if (st.ready) { clearInterval(t); res(); } }, 100); setTimeout(() => { clearInterval(t); res(); }, 5000); }); }
    const choices = st.threads.filter((t) => isMember(t)).map((t) => ({ v: "t:" + t.id, l: threadTitle(t) })); const people = peopleOptions().map((x) => ({ v: "u:" + x.id, l: x.name || x.user }));
    if (!choices.length && !people.length) { SUITE.toast("Nobody to send it to yet — connect with someone in Settings → Connections"); return; }
    const v = await SUITE.dialog({ title: "Send in a conversation", fields: [{ k: "to", label: "To", type: "select", options: choices.concat(people) }], ok: "Send" }); if (!v || !v.to) return;
    let t; if (v.to.startsWith("t:")) t = st.threads.find((x) => x.id === v.to.slice(2)); else t = await createThread({ userIds: [v.to.slice(2)] }); if (!t) return;
    try { const att = []; for (const f of p.files || []) { const bytes = new Uint8Array(await f.arrayBuffer()); const sealed = await C.sealBytes(bytes); const key = (t.org_id ? "org/msg/" : "msg/") + t.id + "/" + crypto.randomUUID(); const blob = new Blob([sealed.ct], { type: "application/octet-stream" }); await CLOUD.suitePut(key, blob); att.push({ key, path: CLOUD.suitePath(key), name: f.name, size: f.size, mime: f.type, k: sealed.key, iv: sealed.iv }); }
      await send(t, { text: p.text || "", att }); draw(); open(t.id); SUITE.toast("Sent"); } catch (e) { SUITE.toast("Not sent: " + e.message); }
  };
  SUITE.messagesWipe = async () => { const u = (CLOUD.session() || {}).user_id; if (!u) return; stopPolling(); try { const rec = await kget("id:" + u); if (rec && cloud()) { await R.del("msg_keys", "device_id=eq." + rec.deviceId); await R.del("msg_devices", "id=eq." + rec.deviceId); } } catch (e) { /* offline: the row stays until an administrator prunes it */ } for (const store of ["msgs", "chains", "meta"]) { const recs = await rall(store, u); for (const r of recs) await rdel(store, r.k); } await kop("keys", "readwrite", (s) => { s.delete("id:" + u); s.delete("lk:" + u); }); LK = null; st.msgs = {}; st.chains = {}; st.epochs = {}; st.since = null; st.id = null; st.ready = false; };
})();
