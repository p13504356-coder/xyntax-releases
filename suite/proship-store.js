/* XYNTAX PROSHIP — the row store (4.13). The PROSHIP document the app works with in memory (vessels, fixtures, voyages…) is
 * kept in the cloud as one row per record (table proship_rows), not as one document per company: a fleet of thousands of
 * vessels loads from the device copy at once, syncs only what changed since the last look (updated_at > since), hears
 * changes row by row through realtime, and two people editing different vessels never conflict. The app's `PS` keeps
 * loading/saving the document shape it always had; this file is what lies underneath.
 *
 *   PSDB.load({ orgId })   → Promise<doc>      the document assembled from rows (device copy first, then the cloud)
 *   PSDB.save(doc)         → Promise<{saved, deleted}>  diffs against the last synced snapshot, writes only what changed
 *   PSDB.onRemote(fn)      → unsubscribe       fn({ kind, id, row|null, version }) for every change from elsewhere
 *   PSDB.migrate(doc)      → Promise<n>        one-time: the 4.12 shared:proship document → rows
 *   PSDB.sync()            → Promise<n>        pull what changed since the last sync (also runs on focus and realtime)
 *   PSDB.state             orgId, local, since, counts, pending, pulled
 *   PSDB.adopt(doc)        the singletons (settings, portal) as the app normalised them: only a change after this is saved
 *   PSDB.onPulled(fn)      fn() once a pull of the company has succeeded after a save was refused for want of one
 *   PSDB.confirmBulk()     the next save may remove many records at once (the explicit Delete-all paths only, 4.31.3)
 *
 * 4.31.2 · a company's records are never written before they were read in this process: save refuses (and queues nothing)
 * until a pull of that company succeeded, refuses a document assembled for another company, sends the version it last saw
 * with every row (base_version) and takes the server's row back when someone else changed it first. The singletons
 * (settings, portal) are sent only when the person changed them after load — never the defaults an empty document carries.
 *
 * 4.31.4 · a device copy is stamped with the version that wrote it (cacheVersion); one without a stamp or older than 4.31.2 is
 * dropped, and one with no live record is never used for its cursor — both pull the company in full. After load the workspace's
 * live count per kind (proship_latest.live) is compared with the device's once per app start; a difference means a full pull
 * that replaces the document (listeners get { doc }). PSDB.reload() does the same on demand (Settings → Reload from cloud).
 * Without a workspace (a personal user, a test, the harness) the same document is kept on the device only (SUITE.kv). */
(function () {
  const KINDS = ["vessels", "fixtures", "offhire", "voyages", "laytime", "claims", "marketRates", "strategies", "compliance", "reports", "lists", "settings", "portal", "voyageTasks", "noonReports", "das", "bunkerLog", "hireStatements", "addenda"];
  // 4.31.3 · kinds that are a cache recomputed from other records (the app replaces them wholesale): their removals never count as a bulk removal
  const DERIVED = ["hireStatements"];
  const SINGLE = { settings: () => ({ tileUrl: "", currency: "USD", dayBasis: "minutes" }), portal: () => ({ customers: [] }) };
  const st = { orgId: null, local: true, rows: {}, last: {}, since: null, loaded: false, doc: null, listeners: [], syncing: null, pending: [], unsub: null, hooked: false, cacheKey: "", pulled: false, base: new Map(), gen: 0, waiting: false, pulledFns: [], bulkOk: false };
  const CACHE_VERSION = "4.31.4"; const checked = new Set(); // companies whose counts were compared in this app start
  const verNum = (v) => String(v || "0").split(".").map((x) => +x || 0).reduce((k, x, i) => k + x * Math.pow(1000, 2 - i), 0);
  const cacheOk = (c) => !!c && !!c.cacheVersion && verNum(c.cacheVersion) >= verNum("4.31.2");
  const liveRecords = () => { let n = 0; for (const kind of KINDS) { if (SINGLE[kind]) continue; for (const r of st.rows[kind].values()) if (!r.deleted) n++; } return n; };
  const uid = (p) => (p || "ps") + "_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const kv = () => (typeof SUITE !== "undefined" && SUITE.kv) ? SUITE.kv : null;
  const cloudOk = () => typeof CLOUD !== "undefined" && CLOUD.signedIn && CLOUD.signedIn() && CLOUD.proship;
  const clone = (x) => (x == null ? x : JSON.parse(JSON.stringify(x)));
  const reset = () => { st.rows = {}; st.last = {}; for (const k of KINDS) { st.rows[k] = new Map(); st.last[k] = new Map(); } st.since = null; st.pending = []; st.doc = null; st.loaded = false; st.pulled = false; st.base = new Map(); st.waiting = false; };
  reset();
  // a singleton compared without the empty keys normalisation adds (reportSchedules: [], tileUrl: "") and in key order
  const canon = (v) => { if (!v || typeof v !== "object" || Array.isArray(v)) return JSON.stringify(v == null ? null : v); const o = {}; for (const k of Object.keys(v).sort()) { const x = v[k]; if (x == null || x === "" || (Array.isArray(x) && !x.length) || (typeof x === "object" && !Array.isArray(x) && !Object.keys(x).length)) continue; o[k] = x; } return JSON.stringify(o); };
  const verOf = (kind, id) => { const r = st.rows[kind] && st.rows[kind].get(id); return r ? +r.version || 0 : 0; };
  const rebase = () => { for (const k of Object.keys(SINGLE)) { const r = st.rows[k].get(k); st.base.set(k, canon(r && !r.deleted && r.data ? r.data : SINGLE[k]())); } };
  const vesselIdOf = (kind, item) => (kind === "vessels" ? String(item.id || "") : String(item.vesselId || "")) || null;

  // ---------- the device copy: everything, so the app opens at once and works offline
  async function readCache() { const k = kv(); if (!k) return false; try { const c = await k.get(st.cacheKey); if (!c || !c.rows || (c.org && c.org !== st.orgId)) return false; if (!cacheOk(c)) return false; /* a copy written before 4.31.2 (or unstamped): neither its rows, its cursor nor its queue are trusted */ for (const kind of KINDS) { const m = st.rows[kind], l = st.last[kind]; for (const r of c.rows[kind] || []) { m.set(r.id, { data: r.data, version: r.version || 0, updated_at: r.updated_at || "", deleted: !!r.deleted }); if (!r.deleted) l.set(r.id, JSON.stringify(r.data)); } } st.since = c.since || null; st.pending = Array.isArray(c.pending) ? c.pending : [];
      // rows that never reached the workspace show in the document (they go with the next save or sync); they are not in `last`, so a save sends them again
      overlayPending();
      // a copy without a single live record says nothing about the company: its cursor is not trusted (the 4.31.1 empty copy)
      if (!liveRecords()) st.since = null;
      return true; } catch (e) { return false; } }
  function overlayPending() { for (const p of st.pending) { const m = st.rows[p.kind]; if (!m) continue; const cur = m.get(p.id); if (p.deleted) { if (cur) cur.deleted = true; } else m.set(p.id, { data: p.data, version: cur ? cur.version : 0, updated_at: cur ? cur.updated_at : "", deleted: false }); } }
  let cacheTimer = null, cacheWrite = null;
  function writeCacheNow() { const k = kv(); if (!k) return Promise.resolve(); clearTimeout(cacheTimer); cacheTimer = null; const rows = {}; for (const kind of KINDS) rows[kind] = [...st.rows[kind].entries()].map(([id, r]) => ({ id, data: r.data, version: r.version, updated_at: r.updated_at, deleted: r.deleted })); cacheWrite = k.set(st.cacheKey, { cacheVersion: CACHE_VERSION, org: st.orgId, since: st.since, pending: st.pending, rows, at: new Date().toISOString() }).catch(() => {}); return cacheWrite; }
  function writeCache(now) { if (now) return writeCacheNow(); clearTimeout(cacheTimer); cacheTimer = setTimeout(writeCacheNow, 150); return null; }
  const settled = async () => { if (cacheTimer) await writeCacheNow(); else if (cacheWrite) await cacheWrite; };

  // ---------- the document the app sees
  function assemble() {
    const doc = { v: 1 };
    for (const kind of KINDS) {
      if (SINGLE[kind]) { const r = st.rows[kind].get(kind); doc[kind] = r && !r.deleted && r.data && typeof r.data === "object" ? r.data : SINGLE[kind](); continue; }
      const list = []; for (const [id, r] of st.rows[kind]) { if (r.deleted || !r.data) continue; if (r.data.id == null) r.data.id = id; list.push(r.data); } doc[kind] = list;
    }
    doc.positions = {}; Object.defineProperty(doc, "__psOrg", { value: st.orgId, enumerable: false }); return doc;
  }
  function counts() { const c = {}; for (const kind of KINDS) c[kind] = [...st.rows[kind].values()].filter((r) => !r.deleted).length; return c; }

  // ---------- remote rows → the maps (+ the listeners); echoes of our own writes are dropped by version
  function applyRemote(r, notify, replace) {
    const kind = r.kind; if (!KINDS.includes(kind)) return false; const id = String(r.id); const m = st.rows[kind]; const cur = m.get(id); const ver = +r.version || 0;
    if (cur && cur.version >= ver) return false;
    const deleted = !!r.deleted_at; m.set(id, { data: r.data, version: ver, updated_at: r.updated_at || "", deleted });
    if (deleted) st.last[kind].delete(id); else st.last[kind].set(id, JSON.stringify(r.data));
    if (SINGLE[kind]) st.base.set(kind, canon(deleted || !r.data ? SINGLE[kind]() : r.data));
    if (r.updated_at && (!st.since || r.updated_at > st.since)) st.since = r.updated_at;
    if (notify) for (const fn of st.listeners) { try { fn({ kind, id, row: deleted ? null : r.data, version: ver, replace: !!replace }); } catch (e) { /* a listener's problem */ } }
    return true;
  }
  async function sync() {
    if (st.local || !cloudOk()) return 0; if (st.syncing) return st.syncing;
    // pull first, then send what waited on the device: nothing is written to a company before its records were read here.
    // A first pull skips the tombstones (nothing on this device to remove), so a company with thousands of deleted rows opens at once.
    const g = st.gen, org = st.orgId;
    st.syncing = (async () => { try { const first = !st.since; const rows = await CLOUD.proship.rows(st.since, { orgId: org, live: first }); if (g !== st.gen) return 0; let n = 0; for (const r of rows) if (applyRemote(r, true)) n++; if (!rows.length && !st.since) st.since = new Date(0).toISOString(); st.pulled = true; if (n || rows.length) writeCache(); try { await flushPending(); } catch (e) { /* the rows keep waiting for the next sync */ } if (st.waiting) { st.waiting = false; for (const fn of st.pulledFns.slice()) { try { fn(); } catch (e) { /* a listener's problem */ } } } return n; } finally { if (g === st.gen) st.syncing = null; } })();
    return st.syncing;
  }

  // ---------- writes: diff the document against the last synced snapshot
  function diff(doc) {
    const rows = []; let deleted = 0;
    for (const kind of KINDS) {
      const l = st.last[kind];
      if (SINGLE[kind]) { const v = doc[kind] && typeof doc[kind] === "object" ? doc[kind] : SINGLE[kind](); const j = JSON.stringify(v); if (l.get(kind) !== j && canon(v) !== st.base.get(kind)) rows.push({ kind, id: kind, vessel_id: null, data: v, _json: j }); continue; }
      const seen = new Set(); for (const item of Array.isArray(doc[kind]) ? doc[kind] : []) { if (!item || typeof item !== "object") continue; if (item.id == null || item.id === "") item.id = uid(kind.slice(0, 3)); const id = String(item.id); if (seen.has(id)) continue; seen.add(id); const j = JSON.stringify(item); if (l.get(id) !== j) rows.push({ kind, id, vessel_id: vesselIdOf(kind, item), data: item, _json: j }); }
      for (const id of l.keys()) if (!seen.has(id)) { rows.push({ kind, id, vessel_id: null, data: {}, deleted: true, _json: null }); deleted++; }
    }
    return { rows, deleted };
  }
  function commitLocal(rows, result) {
    const byKey = new Map((result || []).map((x) => [x.kind + "/" + x.id, x]));
    for (const r of rows) { const m = st.rows[r.kind]; const res = byKey.get(r.kind + "/" + r.id); const cur = m.get(r.id); const version = res ? +res.version : (cur ? cur.version + 1 : 1); const at = res && res.updated_at ? res.updated_at : new Date().toISOString(); if (r.deleted) { m.set(r.id, { data: cur ? cur.data : {}, version, updated_at: at, deleted: true }); st.last[r.kind].delete(r.id); } else { m.set(r.id, { data: r.data, version, updated_at: at, deleted: false }); st.last[r.kind].set(r.id, r._json); if (SINGLE[r.kind]) st.base.set(r.kind, canon(r.data)); } if (at > (st.since || "")) st.since = at; }
    writeCache();
  }
  async function flushPending() { if (!st.pending.length || !cloudOk() || !st.pulled) return; const batch = st.pending.splice(0, st.pending.length); try { const res = await CLOUD.proship.save(batch.map(strip), { orgId: st.orgId }); await settle(batch.map((r) => ({ ...r, _json: r.deleted ? null : JSON.stringify(r.data) })), res); } catch (e) { st.pending.unshift(...batch); writeCache(); throw e; } }
  // every row carries the version this device last saw; a row queued offline keeps the one it was queued with
  const strip = (r) => { const o = { kind: r.kind, id: r.id, vessel_id: r.vessel_id || null, data: r.data, deleted: !!r.deleted, base_version: r.base_version != null ? +r.base_version : verOf(r.kind, r.id) }; if (r.deleted && (r.confirm_bulk || DERIVED.includes(r.kind) || (st.bulkOk && Date.now() - st.bulkOk < 120000))) o.confirm_bulk = true; return o; };
  // 4.31.3 · a batch the workspace refused as a bulk removal: the records come back into the document (the app hears each one)
  function giveBack(rows) { for (const r of rows) { if (!r.deleted) continue; const cur = st.rows[r.kind] && st.rows[r.kind].get(r.id); if (!cur || cur.deleted || !cur.data) continue; for (const fn of st.listeners) { try { fn({ kind: r.kind, id: r.id, row: cur.data, version: cur.version, replace: true }); } catch (e) { /* a listener */ } } } }
  // the answer of a save: rows written are committed; a row someone else changed first comes back with the server's copy.
  // A singleton keeps the cloud copy (the app redraws with it); any other row takes the server's version and is sent again
  // once with that version, so the person's change lands on top of the other one; a second conflict keeps the cloud copy.
  async function settle(rows, res, again) {
    const conf = new Map(); for (const x of res || []) if (x && x.conflict) conf.set(x.kind + "/" + x.id, x);
    if (!conf.size) { commitLocal(rows, res); return 0; }
    commitLocal(rows.filter((r) => !conf.has(r.kind + "/" + r.id)), res);
    const redo = [];
    for (const r of rows) { const c = conf.get(r.kind + "/" + r.id); if (!c) continue; const remote = { kind: c.kind, id: c.id, data: c.data, version: c.version, updated_at: c.updated_at, deleted_at: c.deleted_at || null };
      if (SINGLE[r.kind] || again) { applyRemote(remote, true, true); continue; }
      applyRemote(remote, false); redo.push({ ...r, base_version: verOf(r.kind, r.id) }); }
    writeCache();
    if (redo.length && cloudOk()) { const res2 = await CLOUD.proship.save(redo.map(strip), { orgId: st.orgId }); await settle(redo, res2, true); }
    setTimeout(() => sync().catch(() => {}), 0); // and a pull for anything else that moved meanwhile
    return conf.size;
  }
  async function save(doc) {
    // nothing goes to a company before its records were read in this process, and never a document of another company
    if (!st.loaded) return { saved: 0, deleted: 0, refused: "not-loaded" };
    if (doc && doc.__psOrg !== undefined && doc.__psOrg !== st.orgId) return { saved: 0, deleted: 0, refused: "other-company" };
    if (!st.local) { const ses = typeof CLOUD !== "undefined" && CLOUD.session ? CLOUD.session() || {} : {}; if ((ses.org_id || null) !== st.orgId) return { saved: 0, deleted: 0, refused: "other-company" }; if (!st.pulled) { st.waiting = true; return { saved: 0, deleted: 0, refused: "not-pulled" }; } }
    let { rows, deleted } = diff(doc); if (!rows.length) return { saved: 0, deleted: 0 };
    // 4.22 · rows outside the signed-in role never leave the device (the server would refuse the whole batch); the app says so once
    if (typeof CLOUD !== "undefined" && CLOUD.proshipKindOk) { const out = rows.filter((r) => !CLOUD.proshipKindOk(r.kind)); if (out.length) { rows = rows.filter((r) => CLOUD.proshipKindOk(r.kind)); deleted = rows.filter((r) => r.deleted).length; const real = out.filter((r) => !SINGLE[r.kind]); /* settings/portal defaults are written by normalisation, not by the person: dropped quietly */ const kinds = [...new Set(real.map((r) => r.kind))].join(", "); if (real.length && !st._roleWarned) { st._roleWarned = true; try { SUITE.toast("Not saved: your role does not change " + kinds); } catch (e) { /* no UI */ } } if (!rows.length) return { saved: 0, deleted: 0, skipped: out.length }; } }
    if (st.local || !cloudOk()) { commitLocal(rows, null); await writeCache(true); return { saved: rows.length - deleted, deleted, local: true }; }
    try { await flushPending(); const res = await CLOUD.proship.save(rows.map(strip), { orgId: st.orgId }); st.bulkOk = false; const conflicts = await settle(rows, res); return { saved: rows.length - deleted - conflicts, deleted, conflicts }; }
    catch (e) {
      st.bulkOk = false; if (/\bbulk\b/i.test(e.message || "")) giveBack(rows);
      // offline or refused: the rows wait on the device and go with the next save, sync or focus; the error still reaches the app
      if (/Offline|Could not save|workspace did not answer/i.test(e.message || "")) { const have = new Set(st.pending.map((p) => p.kind + "/" + p.id)); for (const r of rows) if (!have.has(r.kind + "/" + r.id)) st.pending.push(strip(r)); writeCache(); }
      throw e;
    }
  }

  // ---------- the 4.12 document → rows (once)
  async function migrate(doc) {
    if (!doc || typeof doc !== "object") return 0; const rows = [];
    for (const kind of KINDS) { if (SINGLE[kind]) { if (doc[kind] && typeof doc[kind] === "object" && Object.keys(doc[kind]).length) rows.push({ kind, id: kind, vessel_id: null, data: doc[kind] }); continue; } for (const item of Array.isArray(doc[kind]) ? doc[kind] : []) { if (!item || typeof item !== "object") continue; if (item.id == null) item.id = uid(kind.slice(0, 3)); rows.push({ kind, id: String(item.id), vessel_id: vesselIdOf(kind, item), data: item }); } }
    if (!rows.length) return 0;
    const withJson = rows.map((r) => ({ ...r, _json: JSON.stringify(r.data) }));
    if (st.local || !cloudOk()) { commitLocal(withJson, null); return rows.length; }
    if (!st.pulled) return 0; const res = await CLOUD.proship.save(rows.map(strip), { orgId: st.orgId }); await settle(withJson, res); return rows.length;
  }
  async function migrateIfNeeded() {
    if (st.local || typeof SUITE === "undefined" || !SUITE.db || !SUITE.db.load) return 0;
    const total = Object.values(counts()).reduce((k, n) => k + n, 0); if (total) return 0;
    let old = null; try { SUITE.db.hush && SUITE.db.hush(); old = await SUITE.db.load("shared:proship", { v: 1 }); } catch (e) { old = null; } finally { SUITE.db.unhush && SUITE.db.unhush(); }
    if (!old || old.migrated) return 0; const has = KINDS.some((k) => Array.isArray(old[k]) ? old[k].length : (k === "portal" && old.portal && (old.portal.customers || []).length));
    if (!has) return 0;
    const n = await migrate(clone(old));
    try { old.migrated = true; old.migratedAt = new Date().toISOString(); SUITE.db.save("shared:proship"); } catch (e) { /* the backup stays as it was */ }
    return n;
  }

  // ---------- 4.31.4 · a full pull that replaces the document (rows not yet sent stay and go with it)
  async function resync() {
    if (st.local || !cloudOk()) return st.doc;
    if (st.syncing) { try { await st.syncing; } catch (e) { /* the full pull follows */ } }
    const org = st.orgId; const g = ++st.gen; st.syncing = null; const pending = st.pending.slice();
    const rows = await CLOUD.proship.rows(null, { orgId: org, live: true });
    if (g !== st.gen || org !== st.orgId) throw new Error("The company changed while PROSHIP was reloading");
    for (const kind of KINDS) { st.rows[kind] = new Map(); st.last[kind] = new Map(); } st.since = null; st.pending = pending;
    for (const r of rows) applyRemote(r, false); if (!st.since) st.since = new Date(0).toISOString(); overlayPending(); rebase(); st.pulled = true; st.loaded = true; checked.add(org);
    await writeCache(true); try { await flushPending(); } catch (e) { /* the rows keep waiting */ }
    st.doc = assemble(); for (const fn of st.listeners) { try { fn({ doc: st.doc, replace: true }); } catch (e) { /* a listener's problem */ } }
    return st.doc;
  }
  // once per app start and company: does the workspace hold the same live records as this device? If not, a full pull
  async function verify() {
    const org = st.orgId; if (st.local || !cloudOk() || checked.has(org) || !CLOUD.proship.latest) return false; checked.add(org);
    let l = null; try { l = await CLOUD.proship.latest({ orgId: org }); } catch (e) { l = null; } if (!l || org !== st.orgId || st.pending.length) return false;
    let need;
    if (l.live && typeof l.live === "object") { need = KINDS.some((kind) => { const want = +l.live[kind] || 0; let have = 0; for (const r of st.rows[kind].values()) if (!r.deleted) have++; return want !== have; }); }
    else need = !liveRecords() && +l.rows > 0; // a workspace before 4.31.4: an empty device copy of a company with rows
    if (!need) return false; await resync(); return true;
  }

  // ---------- live changes and the focus poll
  function hook() {
    if (st.hooked) return; st.hooked = true;
    if (typeof CLOUD !== "undefined" && CLOUD.onChange) CLOUD.onChange("proship_rows", (d) => { const row = d && d.row; if (!row || st.local || !st.pulled) return; if (row.org_id && st.orgId && row.org_id !== st.orgId) return; if (row.kind && row.id != null && row.data !== undefined) { if (applyRemote(row, true)) writeCache(); } else sync().catch(() => {}); });
    if (typeof window !== "undefined") { let last = 0; const poke = () => { if (Date.now() - last < 8000) return; last = Date.now(); sync().catch(() => {}); }; window.addEventListener("focus", poke); document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") poke(); }); window.addEventListener("online", poke); }
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
    opt = opt || {}; const ses = typeof CLOUD !== "undefined" && CLOUD.session ? CLOUD.session() || {} : {}; const orgId = Object.prototype.hasOwnProperty.call(opt, "orgId") ? (opt.orgId || null) : (ses.org_id || null); // an explicit null = the device only
    const local = !orgId || !cloudOk();
    if (st.loaded && st.orgId === orgId && st.local === local && st.doc) { if (!local) sync().catch(() => {}); return st.doc; }
    // another company (or the first load): the previous company's maps, cursor and waiting rows stay in its own device copy
    await settled(); st.gen++; const g = st.gen; reset(); st.syncing = null; st.orgId = orgId; st.local = local; st.cacheKey = "proship:" + (orgId || "local");
    const t0 = Date.now(); const cached = await readCache(); if (g !== st.gen) throw new Error("The company changed while PROSHIP was loading"); const have = liveRecords(); rebase();
    if (local) { st.pulled = true; st.loaded = true; }
    else if (cached && have) { st.loaded = true; sync().then(() => verify()).then(() => migrateIfNeeded()).catch(() => {}); hook(); }
    else { st.since = null; try { await sync(); } catch (e) { try { console.error("XYNTAX PROSHIP load: " + (e && e.name) + ": " + (e && e.message)); } catch (x) { /* no console */ } throw new Error("Could not load the PROSHIP records (" + String(e.message || e).replace(/^Offline:\s*/, "") + ")"); } if (g !== st.gen) throw new Error("The company changed while PROSHIP was loading"); if (!st.pulled) throw new Error("Could not load the PROSHIP records of this company"); st.loaded = true; await migrateIfNeeded().catch(() => 0); hook(); setTimeout(() => verify().catch(() => {}), 0); }
    st.doc = assemble(); st.loadMs = Date.now() - t0; return st.doc;
  }

  window.PSDB = {
    KINDS, load, save, sync, migrate, verify, CACHE_VERSION,
    // Settings → Reload from cloud: the device copy and its cursor are dropped and the company is pulled in full
    async reload() { if (st.local || !cloudOk()) return st.doc; const k = kv(); if (k && st.cacheKey) { try { await k.del(st.cacheKey); } catch (e) { /* none */ } } return resync(); },
    onPulled(fn) { st.pulledFns.push(fn); return () => { st.pulledFns = st.pulledFns.filter((f) => f !== fn); }; },
    confirmBulk() { st.bulkOk = Date.now(); }, // good for the next save within two minutes
    versionOf: verOf,
    adopt(doc, kinds) { if (!doc || (doc.__psOrg !== undefined && doc.__psOrg !== st.orgId)) return; for (const k of kinds || Object.keys(SINGLE)) if (SINGLE[k]) st.base.set(k, canon(doc[k] && typeof doc[k] === "object" ? doc[k] : SINGLE[k]())); },
    canon,
    onRemote(fn) { st.listeners.push(fn); return () => { st.listeners = st.listeners.filter((f) => f !== fn); }; },
    get state() { return { orgId: st.orgId, local: st.local, since: st.since, loaded: st.loaded, counts: counts(), pending: st.pending.length, loadMs: st.loadMs || 0, pulled: st.pulled }; },
    assemble, // a fresh document from the maps (tests, exports)
    reset() { st.gen++; reset(); st.syncing = null; st.orgId = null; st.local = true; st.cacheKey = ""; },
    settled, // resolves once the device copy is written (tests, sign-out)
    async clearCache() { const k = kv(); if (k && st.cacheKey) await k.del(st.cacheKey); },
  };
})();
