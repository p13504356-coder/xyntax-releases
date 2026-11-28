/* XYNTAX 4.16 — CLOUD.book: the accounting book as rows in the workspace (table book_rows, functions book_save /
 * book_reverse / book_since / book_latest). book-store.js (BOOKDB) sits on top of this; cloud.js keeps its document
 * methods (load / save / version) and they become thin wrappers over BOOKDB once the company runs on rows.
 *
 *   CLOUD.book.rows(since, { orgId, page, kind })   → rows changed since a moment (paged, ordered)
 *   CLOUD.book.save(rows, { orgId, migrate })        → { versions: [{ kind, id, version, updated_at }], renumbered: [{ kind, id, from, to }], conflicts: [{ kind, id, version, data, deleted_at, conflict }] }
 *                                                      (4.31.3: each row carries base_version; a stale row is not written and comes back in conflicts)
 *   CLOUD.book.reverse(id, by, { orgId })            → { version, updated_at }   (the one change a posted journal allows)
 *   CLOUD.book.latest({ orgId })                     → { updated_at, rows, stamp }
 *   CLOUD.book.document({ orgId })                   → { data, version } | null   (the 4.15 document, kept as a backup)
 *   CLOUD.book.writeDocument(store, version, { orgId }) → version                 (the document store, for the fallback)
 * Errors carry the workspace's words: "read only…", "locked: …", "immutable: …", "Offline: …". */
(function () {
  if (typeof CLOUD === "undefined") return;
  if (Array.isArray(CLOUD.TABLES) && !CLOUD.TABLES.includes("book_rows")) CLOUD.TABLES.push("book_rows");
  const orgOf = (opt) => (opt && opt.orgId) || (CLOUD.session() || {}).org_id || null;
  const fail = async (r, what) => { let t = ""; try { t = await r.text(); } catch (e) { t = ""; } let msg = t; try { const j = JSON.parse(t); msg = j.message || j.error || j.hint || t; } catch (e) { /* plain */ } throw new Error((what ? what + ": " : "") + String(msg || r.status).slice(0, 300)); };
  CLOUD.book = {
    async rows(since, opt) {
      // 4.31.4 · limit/offset pages through CLOUD.pull (no Range header; each page retried, the failure names the page)
      opt = opt || {}; const org = orgOf(opt); if (!org) return [];
      return CLOUD.pull("/rest/v1/book_rows?select=kind,id,data,version,updated_at,deleted_at,posted&org_id=eq." + org + (since ? "&updated_at=gte." + encodeURIComponent(since) : "") + (opt.kind ? "&kind=eq." + encodeURIComponent(opt.kind) : "") + "&order=updated_at.asc,kind.asc,id.asc", "Book records", { page: opt.page });
    },
    async save(rows, opt) {
      opt = opt || {}; const org = orgOf(opt); if (!org) throw new Error("No company");
      const r = await CLOUD.req("/rest/v1/rpc/book_save", { method: "POST", body: JSON.stringify({ p_org: org, p_rows: rows, p_migrate: !!opt.migrate }) });
      if (!r.ok) { if (r.status >= 500 || r.status === 0) throw new Error("Offline: the workspace did not answer (" + r.status + ")"); await fail(r, "Could not save the books"); }
      const j = await r.json(); return { versions: Array.isArray(j && j.versions) ? j.versions : [], renumbered: Array.isArray(j && j.renumbered) ? j.renumbered : [], conflicts: Array.isArray(j && j.conflicts) ? j.conflicts : [] };
    },
    async reverse(id, by, opt) { const org = orgOf(opt); const r = await CLOUD.req("/rest/v1/rpc/book_reverse", { method: "POST", body: JSON.stringify({ p_org: org, p_id: String(id), p_by: String(by) }) }); if (!r.ok) await fail(r, "Could not mark the reversal"); return r.json(); },
    async latest(opt) { const org = orgOf(opt); if (!org) return null; const r = await CLOUD.req("/rest/v1/rpc/book_latest", { method: "POST", body: JSON.stringify({ p_org: org }) }); if (!r.ok) return null; const j = await r.json(); return j && typeof j === "object" ? { updated_at: j.updated_at || null, rows: +j.rows || 0, stamp: +j.stamp || 0 } : null; },
    async document(opt) { const org = orgOf(opt); if (!org) return null; const r = await CLOUD.req("/rest/v1/books?select=data,version,updated_at&org_id=eq." + org); if (!r.ok) await fail(r, "Could not read the book document"); const rows = await r.json(); return rows.length ? { data: rows[0].data, version: rows[0].version, updated_at: rows[0].updated_at } : null; },
    async documentMeta(opt) { const org = orgOf(opt); if (!org) return null; const r = await CLOUD.req("/rest/v1/books?select=version,meta:data->meta&org_id=eq." + org); if (!r.ok) return null; const rows = await r.json(); return rows.length ? { version: rows[0].version, meta: rows[0].meta || (rows[0].data && rows[0].data.meta) || {} } : null; },
    // is this session on the row store? (BOOKDB loaded for the open company, not device-only, not switched back to the document)
    rowsMode() { try { const org = (CLOUD.session() || {}).org_id; return !!(org && typeof BOOKDB !== "undefined" && BOOKDB.state.loaded && !BOOKDB.state.local && BOOKDB.state.orgId === org); } catch (e) { return false; } },
    async writeDocument(store, version, opt) { const org = orgOf(opt); const r = await CLOUD.req("/rest/v1/rpc/save_book", { method: "POST", body: JSON.stringify({ p_org: org, p_version: version, p_data: store }) }); if (!r.ok) await fail(r, "Could not write the book document"); return r.json(); },
  };

  // the document methods become thin wrappers once the company runs on rows: callers (boot, reconnect, the poll) keep working
  const orig = { load: CLOUD.load, save: CLOUD.save, version: CLOUD.version };
  CLOUD.load = async function () {
    const s = this.session() || {}; const org = s.org_id;
    if (!org || typeof BOOKDB === "undefined" || !BOOKDB.enabledFor(org)) return orig.load.call(this);
    const store = await BOOKDB.load({ orgId: org });
    this.state.role = s.role; this.state.org = org; this.state.orgName = s.org_name; this.state.email = s.email; this.state.apps = s.apps === undefined ? null : s.apps; this.state.quota = s.quota; this.state.lastSync = new Date(); this.state.version = BOOKDB.state.stamp;
    // the document itself may say "document store" (an emergency fallback made on another device): then this device follows
    if (!BOOKDB.state.local && !BOOKDB.state.migrated) CLOUD.book.documentMeta({ orgId: org }).then((m) => { if (m && m.meta && m.meta.rowStore === false) { try { localStorage.setItem("xyntax.book.mode." + org, "document"); } catch (e) { /* no storage */ } } }).catch(() => {});
    return store;
  };
  CLOUD.save = async function (store) {
    if (!CLOUD.book.rowsMode()) return orig.save.call(this, store);
    const s = this.session() || {}; if (!CLOUD.canEdit()) throw new Error("Your role does not change the books (" + CLOUD.roleName(s.role) + ")");
    await BOOKDB.save(store); this.state.version = BOOKDB.state.stamp; this.state.lastSync = new Date(); this.state.error = null; return this.state.version;
  };
  CLOUD.version = async function () {
    if (!CLOUD.book.rowsMode()) return orig.version.call(this);
    const l = await CLOUD.book.latest(); return l ? l.stamp : null;
  };
})();
