/* XYNTAX 4.16 — the accounting book as rows. The engine keeps working on one in-memory store (S.store: entities, trades,
 * invoices, ledger…); underneath, every record is one row in the workspace (table book_rows) instead of the whole book
 * being one document saved on every change. What that buys a company with thousands of documents and many desks:
 *   · the book opens from the device copy at once and syncs only what changed since the last look (updated_at >= since)
 *   · colleagues' changes arrive live, row by row, merged into the open store in place — an open sheet is never disturbed
 *   · two people posting at the same time never conflict: each save sends only the rows it changed
 *   · a document number taken by a colleague a second earlier is renumbered by the workspace and reported
 *   · posted journals are immutable (tags and the reversal mark aside) and a closed period refuses postings — on the server
 *
 *   BOOKDB.load({ orgId })      → Promise<store>   the store assembled from rows (device copy first, then the cloud)
 *   BOOKDB.save(store)          → Promise<{ saved, deleted, renumbered, local? }>  diff against the last synced snapshot
 *   BOOKDB.onRemote(fn)         → unsubscribe       fn({ kind, id, row|null, version }) for changes from elsewhere
 *   BOOKDB.mergeInto(store, change)                 the in-place merge the app applies to S.store
 *   BOOKDB.sync() · migrate() · fallbackToDocument(store) · resumeRows() · state · assemble() · reset() · settled()
 *   BOOKDB.enabledFor(orgId)    rows unless this device (or the document itself) says "document store"
 *   BOOKDB.confirmBulk()        the next save may remove many records at once (the explicit Delete-all paths only)
 *   BOOKDB.onPulled(fn)         fn() once a pull of the company has succeeded after a save was refused for want of one
 *
 * 4.31.3 · as PROSHIP in 4.31.2: a company's rows are never written before they were read in this process (save answers
 * { refused: "not-pulled" } and the app saves again once the pull is in), never from a session now in another company, and never
 * from a device copy kept for another company. Every row carries the version it was read at (base_version); a row someone else
 * changed first comes back from the workspace — a record of a list is sent again once on top of it, a single row (settings, meta,
 * recon, scalars) keeps the workspace copy. A batch that would remove most of a kind is refused by the workspace ("bulk: …")
 * unless confirmBulk() was called first; the records then come back into the store.
 * 4.31.4 · the device copy carries the version that wrote it (cacheVersion): none, or older than 4.31.2, and it is dropped; a copy
 * with no live record never lends its cursor. Once per app start the workspace's row count (book_latest.rows, tombstones included,
 * as the pull) is compared with the device's; a difference means a full pull that replaces the store (listeners get { all, store }).
 * BOOKDB.reload() does the same on demand (Data → Reload from cloud).
 * Without a workspace the same store is kept on the device only (SUITE.kv), so the harness and offline work behave alike. */
(function () {
  const SINGLES = ["meta", "settings", "recon"]; const SCALARS = "scalars";
  const CACHE_VERSION = "4.31.4"; const checked = new Set();
  const verNum = (v) => String(v || "0").split(".").map((x) => +x || 0).reduce((k, x, i) => k + x * Math.pow(1000, 2 - i), 0);
  const cacheOk = (c) => !!c && !!c.cacheVersion && verNum(c.cacheVersion) >= verNum("4.31.2");
  const NUMBERED = ["trades", "invoices", "bills", "cargoes", "documents", "payments", "futuresTrades"];
  const st = { orgId: null, local: true, rows: {}, last: {}, since: null, stamp: 0, loaded: false, listeners: [], syncing: null, pending: [], hooked: false, cacheKey: "", loadMs: 0, timer: null, migrated: false, pulled: false, waiting: false, pulledFns: [], gen: 0, bulkOk: false };
  const E = () => (typeof XyntaxEngine !== "undefined" ? XyntaxEngine : (typeof window !== "undefined" ? window.XyntaxEngine : null));
  const kv = () => (typeof SUITE !== "undefined" && SUITE.kv) ? SUITE.kv : null;
  const cloudOk = () => typeof CLOUD !== "undefined" && CLOUD.signedIn && CLOUD.signedIn() && CLOUD.book;
  const uid = (p) => (p || "r") + "_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const clone = (x) => (x == null ? x : JSON.parse(JSON.stringify(x)));
  const map = (kind) => { if (!st.rows[kind]) { st.rows[kind] = new Map(); st.last[kind] = new Map(); } return st.rows[kind]; };
  const lastOf = (kind) => { map(kind); return st.last[kind]; };
  const reset = () => { st.rows = {}; st.last = {}; st.since = null; st.stamp = 0; st.pending = []; st.loaded = false; st.migrated = false; st.pulled = false; st.waiting = false; st.bulkOk = false; };
  const verOf = (kind, id) => { const r = st.rows[kind] && st.rows[kind].get(id); return r ? +r.version || 0 : 0; };
  const ONE = (kind) => SINGLES.includes(kind) || kind === SCALARS;
  const sessionOrg = () => { try { return (typeof CLOUD !== "undefined" && CLOUD.session ? (CLOUD.session() || {}).org_id : null) || null; } catch (e) { return null; } };
  const baseKinds = () => { const e = E(); const fresh = e && e.newStore ? e.newStore() : {}; return Object.keys(fresh).filter((k) => Array.isArray(fresh[k])); };
  const kinds = () => { const set = new Set(baseKinds()); for (const k of Object.keys(st.rows)) set.add(k); return [...set]; };
  const modeKey = (org) => "xyntax.book.mode." + (org || "local");
  const stampOf = (iso) => { const t = Date.parse(iso || ""); return isNaN(t) ? 0 : t; };

  // ---------- the device copy
  async function readCache() { const k = kv(); if (!k) return false; try { const c = await k.get(st.cacheKey); if (!c || !c.rows || (c.org !== undefined && (c.org || null) !== (st.orgId || null)) || !cacheOk(c)) return false; for (const kind of Object.keys(c.rows)) { const m = map(kind), l = lastOf(kind); for (const r of c.rows[kind] || []) { m.set(r.id, { data: r.data, version: r.version || 0, updated_at: r.updated_at || "", deleted: !!r.deleted }); if (!r.deleted) l.set(r.id, JSON.stringify(r.data)); } } st.since = c.since || null; st.stamp = c.stamp || 0; st.pending = Array.isArray(c.pending) ? c.pending : [];
      overlayPending();
      if (!liveRecords()) { st.since = null; st.stamp = 0; return false; } // an empty copy says nothing: the company is pulled in full
      return true; } catch (e) { return false; } }
  function overlayPending() { for (const p of st.pending) { const m = map(p.kind); const cur = m.get(p.id); if (p.deleted) { if (cur) cur.deleted = true; } else m.set(p.id, { data: p.data, version: cur ? cur.version : 0, updated_at: cur ? cur.updated_at : "", deleted: false }); } }
  const liveRecords = () => { let n = 0; for (const kind of Object.keys(st.rows)) { if (ONE(kind)) continue; for (const r of st.rows[kind].values()) if (!r.deleted) n++; } return n; };
  const allRows = () => { let n = 0; for (const kind of Object.keys(st.rows)) for (const r of st.rows[kind].values()) if (r.version > 0) n++; return n; };
  let cacheTimer = null, cacheWrite = null;
  function writeCacheNow() { const k = kv(); if (!k) return Promise.resolve(); clearTimeout(cacheTimer); cacheTimer = null; const rows = {}; for (const kind of Object.keys(st.rows)) rows[kind] = [...st.rows[kind].entries()].map(([id, r]) => ({ id, data: r.data, version: r.version, updated_at: r.updated_at, deleted: r.deleted })); cacheWrite = k.set(st.cacheKey, { cacheVersion: CACHE_VERSION, org: st.orgId, since: st.since, stamp: st.stamp, pending: st.pending, rows, at: new Date().toISOString() }).catch(() => {}); return cacheWrite; }
  function writeCache(now) { if (now) return writeCacheNow(); clearTimeout(cacheTimer); cacheTimer = setTimeout(writeCacheNow, 150); return null; }
  const settled = async () => { if (cacheTimer) await writeCacheNow(); else if (cacheWrite) await cacheWrite; };

  // ---------- the store the engine sees
  function assemble() {
    const e = E(); const store = e && e.newStore ? e.newStore() : {};
    const sc = map(SCALARS).get(SCALARS); if (sc && !sc.deleted && sc.data && typeof sc.data === "object") Object.assign(store, sc.data);
    for (const kind of SINGLES) { const r = map(kind).get(kind); if (r && !r.deleted && r.data && typeof r.data === "object") store[kind] = clone(r.data); }
    for (const kind of kinds()) { if (SINGLES.includes(kind) || kind === SCALARS) continue; const list = []; for (const [id, r] of map(kind)) { if (r.deleted || !r.data) continue; const item = clone(r.data); if (item.id == null) item.id = id; list.push(item); } store[kind] = list; }
    try { Object.defineProperty(store, "__bookOrg", { value: st.orgId, enumerable: false, configurable: true }); } catch (e) { /* frozen */ }
    return store;
  }
  function counts() { const c = {}; let total = 0; for (const kind of Object.keys(st.rows)) { c[kind] = [...st.rows[kind].values()].filter((r) => !r.deleted).length; total += c[kind]; } c.__total = total; return c; }

  // ---------- remote rows → the maps (+ the listeners); echoes of our own writes are dropped by version
  function applyRemote(r, notify) {
    const kind = r.kind; if (!kind || r.id == null) return false; const id = String(r.id); const m = map(kind); const cur = m.get(id); const ver = +r.version || 0;
    if (cur && cur.version >= ver) return false;
    const deleted = !!r.deleted_at; m.set(id, { data: r.data, version: ver, updated_at: r.updated_at || "", deleted });
    if (deleted) lastOf(kind).delete(id); else lastOf(kind).set(id, JSON.stringify(r.data));
    if (r.updated_at && (!st.since || r.updated_at > st.since)) st.since = r.updated_at; st.stamp = Math.max(st.stamp, stampOf(r.updated_at));
    if (notify) for (const fn of st.listeners) { try { fn({ kind, id, row: deleted ? null : r.data, version: ver }); } catch (e) { /* a listener's problem */ } }
    return true;
  }
  async function sync() {
    if (st.local || !cloudOk()) return 0; if (st.syncing) return st.syncing;
    // pull first, then send what waited on the device: nothing is written to a company before its rows were read here
    const g = st.gen, org = st.orgId;
    st.syncing = (async () => { try { const rows = await CLOUD.book.rows(st.since, { orgId: org }); if (g !== st.gen) return 0; const firstLook = !st.since; let n = 0; for (const r of rows) if (applyRemote(r, true)) n++; if (!rows.length && !st.since) st.since = new Date(0).toISOString(); st.pulled = true; if (n || rows.length || firstLook) writeCache(); try { await flushPending(); } catch (e) { /* the rows keep waiting, or were refused and reported */ } if (st.waiting) { st.waiting = false; for (const fn of st.pulledFns.slice()) { try { fn(); } catch (e) { /* a listener */ } } } return n; } finally { if (g === st.gen) st.syncing = null; } })();
    return st.syncing;
  }

  // ---------- the in-place merge: a changed row lands in the live store without replacing it
  function mergeInto(store, ch) {
    if (!store || !ch || !ch.kind) return false; const kind = ch.kind;
    if (kind === SCALARS) { if (ch.row && typeof ch.row === "object") Object.assign(store, ch.row); return true; }
    if (SINGLES.includes(kind)) { if (!ch.row) return false; const target = store[kind] && typeof store[kind] === "object" ? store[kind] : (store[kind] = {}); for (const k of Object.keys(target)) delete target[k]; Object.assign(target, clone(ch.row)); return true; }
    if (!Array.isArray(store[kind])) { if (ch.row) store[kind] = []; else return false; }
    const arr = store[kind]; const id = String(ch.id); const i = arr.findIndex((x) => x && String(x.id) === id);
    if (!ch.row) { if (i >= 0) arr.splice(i, 1); return i >= 0; }
    const item = clone(ch.row); if (item.id == null) item.id = ch.id; if (i >= 0) arr[i] = item; else arr.push(item); return true;
  }

  // ---------- writes: diff the store against the last synced snapshot
  function diff(store) {
    const rows = []; let deleted = 0; const scalars = {};
    for (const key of Object.keys(store)) {
      if (key.startsWith("__")) continue; const v = store[key];
      if (Array.isArray(v)) {
        const l = lastOf(key); const seen = new Set();
        for (const item of v) { if (!item || typeof item !== "object") continue; if (item.id == null || item.id === "") item.id = uid(key.slice(0, 3)); const id = String(item.id); if (seen.has(id)) continue; seen.add(id); const j = JSON.stringify(item); if (l.get(id) !== j) rows.push({ kind: key, id, data: item, _json: j }); }
        for (const id of l.keys()) if (!seen.has(id)) { rows.push({ kind: key, id, data: {}, deleted: true, _json: null }); deleted++; }
      } else if (SINGLES.includes(key)) { const val = v && typeof v === "object" ? v : {}; const j = JSON.stringify(val); if (lastOf(key).get(key) !== j) rows.push({ kind: key, id: key, data: val, _json: j }); }
      else if (v !== undefined && typeof v !== "function") scalars[key] = v;
    }
    const sj = JSON.stringify(scalars); if (lastOf(SCALARS).get(SCALARS) !== sj) rows.push({ kind: SCALARS, id: SCALARS, data: scalars, _json: sj });
    return { rows, deleted };
  }
  function commitLocal(rows, versions) {
    const byKey = new Map((versions || []).map((x) => [x.kind + "/" + x.id, x]));
    for (const r of rows) { const m = map(r.kind); const res = byKey.get(r.kind + "/" + r.id); const cur = m.get(r.id); const version = res ? +res.version : (cur ? cur.version + 1 : 1); const at = res && res.updated_at ? res.updated_at : new Date().toISOString(); if (r.deleted) { m.set(r.id, { data: cur ? cur.data : {}, version, updated_at: at, deleted: true }); lastOf(r.kind).delete(r.id); } else { m.set(r.id, { data: r._json ? JSON.parse(r._json) : clone(r.data), version, updated_at: at, deleted: false }); lastOf(r.kind).set(r.id, r._json || JSON.stringify(r.data)); } if (at > (st.since || "")) st.since = at; st.stamp = Math.max(st.stamp, stampOf(at)); }
    writeCache();
  }
  // every row carries the version this device last saw (a row queued offline keeps the one it was queued with)
  const strip = (r) => { const o = { kind: r.kind, id: r.id, data: r.data, deleted: !!r.deleted, base_version: r.base_version != null ? +r.base_version : verOf(r.kind, r.id) }; if (r.deleted && (r.confirm_bulk || (st.bulkOk && Date.now() - st.bulkOk < 120000))) o.confirm_bulk = true; return o; };
  // only a network failure queues a change; a refusal (read only, locked, immutable…) is final and goes back to the desk
  const offlineish = (e) => { const m = (e && e.message) || ""; return /^Offline|workspace did not answer|Failed to fetch|NetworkError|Load failed|internet connection/i.test(m) && !refusal(e); };
  const refusal = (e) => /\b(read only|locked|immutable|lockdown|not entitled|suspended|bulk|empty)\b/i.test((e && e.message) || "");
  // a refused batch: every row goes back to what the workspace holds, and the app hears it (the removed records come back)
  function giveBack(rows) { for (const r of rows) { const m = map(r.kind), j = lastOf(r.kind).get(r.id), cur = m.get(r.id); const back = j ? JSON.parse(j) : null; if (back) m.set(r.id, { data: back, version: cur ? cur.version : 0, updated_at: cur ? cur.updated_at : "", deleted: false }); else if (cur && !cur.version) m.delete(r.id); for (const fn of st.listeners) { try { fn({ kind: r.kind, id: r.id, row: back, version: cur ? cur.version : 0, refused: true }); } catch (x) { /* a listener */ } } } writeCache(); }
  // the answer of a save: rows written are committed; a row someone else changed first takes the workspace's copy. A record of a
  // list is then sent once more on top of it (the person's change wins over the older one, both stay in the history); a single
  // row keeps the workspace copy; a second conflict keeps the workspace copy too.
  async function settle(store, rows, res, again) {
    const conf = new Map(); for (const x of (res && res.conflicts) || []) if (x && x.conflict) conf.set(x.kind + "/" + x.id, x);
    applyRenumbered(store, rows, res && res.renumbered);
    if (!conf.size) { commitLocal(rows, res && res.versions); return 0; }
    commitLocal(rows.filter((r) => !conf.has(r.kind + "/" + r.id)), res.versions);
    const redo = [];
    for (const r of rows) { const c = conf.get(r.kind + "/" + r.id); if (!c) continue; const remote = { kind: c.kind, id: c.id, data: c.data, version: c.version, updated_at: c.updated_at, deleted_at: c.deleted_at || null };
      if (ONE(r.kind) || again) { applyRemote(remote, true); continue; }
      applyRemote(remote, false); redo.push({ ...r, base_version: verOf(r.kind, r.id) }); }
    writeCache();
    if (redo.length && cloudOk()) { const res2 = await saveBatches(redo.map(strip)); await settle(store, redo, res2, true); }
    setTimeout(() => sync().catch(() => {}), 0);
    return conf.size;
  }
  // a colleague took that number a moment earlier: the workspace renumbered the new document; the store follows
  function applyRenumbered(store, rows, renumbered) {
    for (const x of renumbered || []) { const r = rows.find((q) => q.kind === x.kind && q.id === x.id); if (r && r.data) { r.data.ref = x.to; r._json = JSON.stringify(r.data); } const arr = store && Array.isArray(store[x.kind]) ? store[x.kind] : null; const item = arr && arr.find((q) => q && String(q.id) === String(x.id)); if (item) item.ref = x.to; }
  }
  // the queue of changes made offline; a queued change the workspace now refuses (the period was closed meanwhile, say) is dropped
  // and reported, never retried for ever
  async function flushPending() { if (!st.pending.length || !cloudOk()) return; if (!st.pulled) return; const batch = st.pending.splice(0, st.pending.length); try { const res = await saveBatches(batch.map(strip)); await settle(null, batch.map((r) => ({ ...r, _json: r.deleted ? null : JSON.stringify(r.data) })), res); } catch (e) { if (offlineish(e)) { st.pending.unshift(...batch); writeCache(); throw e; } giveBack(batch);
      try { document.dispatchEvent(new CustomEvent("xyntax:book-refused", { detail: { message: (e && e.message) || "", rows: batch.length } })); } catch (x) { /* no document */ } const err = new Error((e && e.message) || "refused"); err.dropped = batch.length; throw err; } }
  async function saveBatches(rows, migrate) { const versions = [], renumbered = [], conflicts = []; for (let i = 0; i < rows.length; i += 500) { const res = await CLOUD.book.save(rows.slice(i, i + 500), { orgId: st.orgId, migrate: !!migrate }); versions.push(...res.versions); renumbered.push(...res.renumbered); conflicts.push(...(res.conflicts || [])); } return { versions, renumbered, conflicts }; }
  async function save(store) {
    if (!st.loaded) throw new Error("The books are not loaded yet");
    // never a store of another company, never before this company's rows were read in this process
    if (store && store.__bookOrg !== undefined && store.__bookOrg !== st.orgId) return { saved: 0, deleted: 0, renumbered: [], refused: "other-company" };
    if (!st.local) { if (sessionOrg() !== st.orgId) return { saved: 0, deleted: 0, renumbered: [], refused: "other-company" }; if (!st.pulled) { st.waiting = true; return { saved: 0, deleted: 0, renumbered: [], refused: "not-pulled" }; } }
    const { rows, deleted } = diff(store); if (!rows.length) { st.bulkOk = false; return { saved: 0, deleted: 0, renumbered: [] }; }
    if (st.local || !cloudOk()) { commitLocal(rows, null); await writeCache(true); st.bulkOk = false; return { saved: rows.length - deleted, deleted, renumbered: [], local: true }; }
    try { await flushPending(); const res = await saveBatches(rows.map(strip)); const conflicts = await settle(store, rows, res); st.bulkOk = false; return { saved: rows.length - deleted - conflicts, deleted, renumbered: res.renumbered, conflicts }; }
    catch (e) {
      if (offlineish(e)) { const have = new Set(st.pending.map((p) => p.kind + "/" + p.id)); for (const r of rows) if (!have.has(r.kind + "/" + r.id)) st.pending.push(strip(r)); writeCache(); }
      else if (refusal(e) && /\b(bulk|empty)\b/i.test(e.message || "")) giveBack(rows);
      st.bulkOk = false; throw e;
    }
  }

  // ---------- the document → rows (once), and the way back
  function rowsFromDocument(doc) { const rows = []; const scalars = {}; for (const key of Object.keys(doc || {})) { if (key.startsWith("__")) continue; const v = doc[key]; if (Array.isArray(v)) { for (const item of v) { if (!item || typeof item !== "object") continue; if (item.id == null) item.id = uid(key.slice(0, 3)); rows.push({ kind: key, id: String(item.id), data: item }); } } else if (SINGLES.includes(key)) { if (v && typeof v === "object") rows.push({ kind: key, id: key, data: v }); } else if (v !== undefined && typeof v !== "function") scalars[key] = v; } rows.push({ kind: SCALARS, id: SCALARS, data: scalars }); return rows; }
  async function migrate(doc, opt) {
    // the engine's own upgrade (and its one-time repair of old journals) runs before the rows are written: what lands on the
    // server is exactly what the app will hold, so no posted journal needs changing afterwards (the server would refuse it)
    opt = opt || {}; if (!doc || typeof doc !== "object") return 0; let src = clone(doc); try { const e = E(); if (e && e.migrate) src = e.migrate(src); } catch (err) { src = clone(doc); }
    const rows = rowsFromDocument(src);
    if (opt.replace) { const present = new Set(rows.map((r) => r.kind + "/" + r.id)); for (const kind of Object.keys(st.rows)) for (const [id, r] of st.rows[kind]) if (!r.deleted && !present.has(kind + "/" + id)) rows.push({ kind, id, data: {}, deleted: true }); }
    const withJson = rows.map((r) => ({ ...r, _json: r.deleted ? null : JSON.stringify(r.data) }));
    if (st.local || !cloudOk()) { commitLocal(withJson, null); return rows.length; }
    if (!st.pulled) return 0; const res = await saveBatches(rows.map(strip), true); await settle(null, withJson, res); st.migrated = true; return rows.length;
  }
  async function migrateIfNeeded() {
    if (st.local || !cloudOk() || !st.pulled) return 0; if (counts().__total) return 0;
    let doc = null; try { doc = await CLOUD.book.document({ orgId: st.orgId }); } catch (e) { doc = null; }
    if (!doc || !doc.data || !Array.isArray(doc.data.entities) || doc.data.meta && doc.data.meta.migrated) return 0;
    const n = await migrate(doc.data);
    try { const backup = clone(doc.data); backup.meta = { ...(backup.meta || {}), migrated: true, migratedAt: new Date().toISOString(), rowStore: true }; await CLOUD.book.writeDocument(backup, doc.version, { orgId: st.orgId }); } catch (e) { /* the backup stays as it was */ }
    return n;
  }
  // emergencies: write the whole book as a document again and run on the document store from now on (this device at once,
  // every other device after its next start: the document says so in meta.rowStore)
  async function fallbackToDocument(store) {
    if (!cloudOk()) throw new Error("No workspace");
    const doc = clone(store); doc.meta = { ...(doc.meta || {}), rowStore: false, migrated: false, documentSince: new Date().toISOString() };
    let version = 0; try { const cur = await CLOUD.book.document({ orgId: st.orgId }); version = cur ? cur.version : 0; } catch (e) { version = 0; }
    const v = await CLOUD.book.writeDocument(doc, version, { orgId: st.orgId });
    try { localStorage.setItem(modeKey(st.orgId), "document"); } catch (e) { /* no storage */ }
    return v;
  }
  async function resumeRows() {
    if (!cloudOk()) throw new Error("No workspace");
    try { localStorage.removeItem(modeKey(st.orgId)); } catch (e) { /* no storage */ }
    const doc = await CLOUD.book.document({ orgId: st.orgId }); if (!doc || !doc.data) return 0;
    const n = await migrate(doc.data, { replace: true });
    try { const backup = clone(doc.data); backup.meta = { ...(backup.meta || {}), migrated: true, rowStore: true, migratedAt: new Date().toISOString() }; await CLOUD.book.writeDocument(backup, doc.version, { orgId: st.orgId }); } catch (e) { /* fine */ }
    return n;
  }
  function enabledFor(orgId) { try { if (localStorage.getItem(modeKey(orgId)) === "document") return false; } catch (e) { /* no storage */ } return true; }

  // ---------- 4.31.4 · a full pull that replaces the store (rows not yet sent stay and go with it)
  async function resync() {
    if (st.local || !cloudOk()) return assemble();
    if (st.syncing) { try { await st.syncing; } catch (e) { /* the full pull follows */ } }
    const org = st.orgId; const g = ++st.gen; st.syncing = null; const pending = st.pending.slice();
    const rows = await CLOUD.book.rows(null, { orgId: org });
    if (g !== st.gen || org !== st.orgId) throw new Error("The company changed while the books were reloading");
    st.rows = {}; st.last = {}; st.since = null; st.stamp = 0; st.pending = pending;
    for (const r of rows) applyRemote(r, false); if (!st.since) st.since = new Date(0).toISOString(); overlayPending(); st.pulled = true; checked.add(org);
    await writeCache(true); try { await flushPending(); } catch (e) { /* the rows keep waiting */ }
    const store = assemble(); for (const fn of st.listeners) { try { fn({ all: true, store }); } catch (e) { /* a listener */ } }
    return store;
  }
  // once per app start and company: the workspace's row count against the device's (both with tombstones); a difference → full pull
  async function verify() {
    const org = st.orgId; if (st.local || !cloudOk() || checked.has(org) || !CLOUD.book.latest) return false; checked.add(org);
    let l = null; try { l = await CLOUD.book.latest({ orgId: org }); } catch (e) { l = null; } if (!l || org !== st.orgId || st.pending.length) return false;
    if ((+l.rows || 0) === allRows()) return false; await resync(); return true;
  }

  // ---------- live changes, the focus poll, a slow heartbeat when realtime is not live
  function hook() {
    if (st.hooked) return; st.hooked = true;
    if (typeof CLOUD !== "undefined" && CLOUD.onChange) CLOUD.onChange("book_rows", (d) => { const row = d && d.row; if (!row || st.local) return; if (row.org_id && st.orgId && row.org_id !== st.orgId) return; if (row.kind && row.id != null && row.data !== undefined) { if (applyRemote(row, true)) writeCache(); } else sync().catch(() => {}); });
    if (typeof window !== "undefined") { let last = 0; const poke = () => { if (Date.now() - last < 8000) return; last = Date.now(); sync().catch(() => {}); }; window.addEventListener("focus", poke); document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") poke(); }); window.addEventListener("online", poke);
      st.timer = setInterval(() => { const live = typeof CLOUD !== "undefined" && CLOUD.realtime && CLOUD.realtime.live; if (!live && !st.local) sync().catch(() => {}); }, 30000); }
  }

  // 4.31.4 · one load per company at a time: a second caller (the retry timer, Try again, a tile) joins the one in flight instead of
  // restarting it — a restart used to bump the generation and leave the first caller with an error while its pull was still running
  let loading = null;
  function load(opt) {
    opt = opt || {}; const ses = typeof CLOUD !== "undefined" && CLOUD.session ? CLOUD.session() || {} : {}; const org = Object.prototype.hasOwnProperty.call(opt, "orgId") ? (opt.orgId || null) : (ses.org_id || null);
    if (loading && loading.org === org && !opt.fresh) return loading.p;
    const p = load1(opt).finally(() => { if (loading && loading.p === p) loading = null; }); loading = { org, p }; return p;
  }
  async function load1(opt) {
    opt = opt || {}; const ses = typeof CLOUD !== "undefined" && CLOUD.session ? CLOUD.session() || {} : {}; const orgId = Object.prototype.hasOwnProperty.call(opt, "orgId") ? (opt.orgId || null) : (ses.org_id || null);
    const local = !orgId || !cloudOk();
    if (st.loaded && st.orgId === orgId && st.local === local && !opt.fresh) { if (!local) sync().catch(() => {}); return assemble(); }
    await settled(); st.gen++; reset(); st.syncing = null; st.orgId = orgId; st.local = local; st.cacheKey = "book:" + (orgId || "local");
    const t0 = Date.now(); const cached = await readCache(); const have = counts().__total;
    st.loaded = true; if (local) st.pulled = true;
    if (!local) { if (!cached) { st.since = null; try { await sync(); } catch (e) { /* offline: the device copy, if any; nothing is written until a pull succeeds */ } if (st.pulled) await migrateIfNeeded().catch(() => 0); if (st.pulled) setTimeout(() => verify().catch(() => {}), 0); } else sync().then(() => verify()).then(() => migrateIfNeeded()).catch(() => {}); hook(); }
    st.loadMs = Date.now() - t0; return assemble();
  }

  window.BOOKDB = {
    SINGLES, NUMBERED, CACHE_VERSION, verify, load, save,
    // Data → Reload from cloud: the device copy and its cursor are dropped and the book pulled in full
    async reload() { if (st.local || !cloudOk()) return assemble(); const k = kv(); if (k && st.cacheKey) { try { await k.del(st.cacheKey); } catch (e) { /* none */ } } return resync(); }, sync, migrate, mergeInto, fallbackToDocument, resumeRows, enabledFor, applyRemote, assemble, settled,
    onRemote(fn) { st.listeners.push(fn); return () => { st.listeners = st.listeners.filter((f) => f !== fn); }; },
    onPulled(fn) { st.pulledFns.push(fn); return () => { st.pulledFns = st.pulledFns.filter((f) => f !== fn); }; },
    confirmBulk() { st.bulkOk = Date.now(); }, // good for the next save within two minutes
    versionOf: verOf,
    get state() { return { orgId: st.orgId, local: st.local, since: st.since, stamp: st.stamp, loaded: st.loaded, counts: counts(), pending: st.pending.length, loadMs: st.loadMs || 0, migrated: st.migrated, pulled: st.pulled }; },
    reset() { st.gen++; reset(); st.syncing = null; st.orgId = null; st.local = true; st.cacheKey = ""; if (st.timer) clearInterval(st.timer); st.timer = null; st.hooked = false; },
    async clearCache() { const k = kv(); if (k && st.cacheKey) await k.del(st.cacheKey); },
    rowsFromDocument, diff,
  };
})();
