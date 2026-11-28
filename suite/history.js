/* XYNTAX 4.31.3 · Settings → Record history (administrators). Every change the workspace kept, across the company's stores:
 * the accounting book (book_rows_history), PROSHIP (proship_rows_history), the company's shared notes and calendar
 * (suite_shared_history), documents (vault_items_history), items shared with named people (their owner's) and your own personal
 * documents (yours only). Each line says when, who and what changed (the keys that differ, old → new), and Restore this version
 * writes the older copy back as a new version through the store's normal save (with base_version), so the restore is itself in
 * the history. Recently deleted lists removed records with the last copy before the removal; Exports lists the nightly snapshots.
 *
 *   CLOUD.records.history(filter) · deleted(filter) · restore(entry) · undelete(entry) · exports(org) · download(path) · exportNow(org)
 *   RECORD_HISTORY.diff(a, b) → [{ k, a, b }]   (the compact diff the page shows; also used by the tests) */
(function () {
  const H = (...a) => SUITE.H(...a);
  const STORES = [{ v: "", l: "All records" }, { v: "book", l: "Accounting" }, { v: "proship", l: "PROSHIP" }, { v: "shared", l: "Company notes and calendar" }, { v: "vault", l: "Documents" }, { v: "items", l: "Shared with people (yours)" }, { v: "personal", l: "Your personal apps" }];
  const storeName = (v) => (STORES.find((s) => s.v === v) || { l: v }).l;
  const isAdmin = () => typeof CLOUD !== "undefined" && CLOUD.signedIn && CLOUD.signedIn() && CLOUD.active && CLOUD.active() && CLOUD.isAdmin();
  const org = () => ((typeof CLOUD !== "undefined" && CLOUD.session && CLOUD.session()) || {}).org_id || null;
  const fail = async (r, what) => { let t = ""; try { t = await r.text(); } catch (e) { t = ""; } let m = t; try { const j = JSON.parse(t); m = j.message || j.error || t; } catch (e) { /* plain */ } throw new Error(what + ": " + String(m || r.status).slice(0, 240)); };
  const rpc = async (fn, body, what) => { const r = await CLOUD.req("/rest/v1/rpc/" + fn, { method: "POST", body: JSON.stringify(body) }); if (!r.ok) await fail(r, what); return r.json(); };
  const shown = (v) => { if (v === undefined) return "—"; const t = typeof v === "string" ? v : JSON.stringify(v); return t == null ? "—" : t.length > 70 ? t.slice(0, 67) + "…" : t; };
  const META = new Set(["updated_at", "version", "base_version"]);
  // the keys whose value differs between two copies of a record (one level deep; nested values compared as JSON)
  function diff(a, b) { const x = a && typeof a === "object" && !Array.isArray(a) ? a : { value: a }, y = b && typeof b === "object" && !Array.isArray(b) ? b : { value: b }; const out = []; for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) { if (META.has(k)) continue; if (JSON.stringify(x[k]) !== JSON.stringify(y[k])) out.push({ k, a: x[k], b: y[k] }); } return out; }
  const label = (e) => { const d = e.data && typeof e.data === "object" ? e.data : {}; const n = e.next && typeof e.next === "object" ? e.next : {}; return d.name || n.name || d.ref || n.ref || d.title || n.title || d.number || (e.store === "shared" || e.store === "personal" ? e.id : "") || e.id; };

  // ---------- the workspace calls
  const records = {
    history(f) { f = f || {}; return rpc("record_history", { p_org: f.org || org(), p_store: f.store || null, p_kind: f.kind || null, p_id: f.id || null, p_user: f.user || null, p_from: f.from || null, p_to: f.to || null, p_q: f.q || null, p_limit: f.limit || 200, p_offset: f.offset || 0 }, "Could not read the history"); },
    deleted(f) { f = f || {}; return rpc("record_deleted", { p_org: f.org || org(), p_store: f.store || null, p_q: f.q || null, p_demo: !!f.demo, p_limit: f.limit || 200 }, "Could not read the removed records"); },
    // the older copy goes back through the store's own save, on top of the version the workspace holds now
    async restore(e, data) {
      const o = org(); data = data === undefined ? e.data : data; const base = e.current_version != null ? +e.current_version : null;
      if (e.store === "book") { const res = await CLOUD.book.save([{ kind: e.kind, id: e.id, data, deleted: false, base_version: base }], { orgId: o }); if ((res.conflicts || []).length) throw new Error("Changed again a moment ago — refresh and try once more"); try { if (typeof BOOKDB !== "undefined") BOOKDB.sync().catch(() => {}); } catch (x) { /* not open */ } return res; }
      if (e.store === "proship") { const res = await CLOUD.proship.save([{ kind: e.kind, id: e.id, vessel_id: e.kind === "vessels" ? e.id : (data && data.vesselId) || null, data, deleted: false, base_version: base }], { orgId: o }); if ((res || []).some((x) => x && x.conflict)) throw new Error("Changed again a moment ago — refresh and try once more"); try { if (typeof PSDB !== "undefined") PSDB.sync().catch(() => {}); } catch (x) { /* not open */ } return res; }
      if (e.store === "shared") { const v = await CLOUD.sharedSave(e.id, base || 0, { ...(data || {}), __empty_ok: true }, o); try { SUITE.db.forget("shared:" + e.id); } catch (x) { /* not open */ } return v; }
      if (e.store === "personal") { const v = await CLOUD.suiteSave(e.id, base || 0, data && typeof data === "object" && !data.__sealed ? { ...data, __empty_ok: true } : data); try { SUITE.db.forget(e.id); } catch (x) { /* not open */ } return v; }
      if (e.store === "items") { const d = { ...(data || {}) }; delete d.shared_with; return CLOUD.sharedItems.save(e.id, base || 0, d); }
      if (e.store === "vault") { if (!e.current_exists) return rpc("vault_restore", { p_hid: e.hid }, "Could not restore"); const d = data || {}; const patch = {}; for (const k of ["name", "parent_id", "note", "starred", "locked", "scope", "shared_with", "deleted_at"]) if (k in d) patch[k] = d[k]; return CLOUD.vaultUpdate(e.id, patch, base); }
      throw new Error("This kind of record cannot be restored here");
    },
    // a removed record comes back with the last copy it had
    undelete(d) {
      if (d.store === "vault" && d.hid) return rpc("vault_restore", { p_hid: d.hid }, "Could not restore");
      if (d.store === "vault") return CLOUD.vaultUpdate(d.id, { deleted_at: null }, d.version);
      if (d.store === "items") return CLOUD.req("/rest/v1/shared_items?id=eq." + d.id, { method: "PATCH", body: JSON.stringify({ deleted_at: null }) }).then((r) => { if (!r.ok) return fail(r, "Could not restore"); return true; });
      if (!d.copy) throw new Error("No earlier copy of this record was kept");
      return records.restore({ store: d.store, kind: d.kind, id: d.id, current_version: d.version, current_exists: true }, d.copy);
    },
    async exports(o) { const r = await CLOUD.req("/storage/v1/object/list/exports", { method: "POST", body: JSON.stringify({ prefix: (o || org()) + "/", limit: 100, offset: 0, sortBy: { column: "name", order: "desc" } }) }); if (!r.ok) await fail(r, "Could not list the exports"); const rows = await r.json(); return (Array.isArray(rows) ? rows : []).filter((x) => /\.json\.gz$/.test(x.name || "")).map((x) => ({ name: x.name, path: (o || org()) + "/" + x.name, size: (x.metadata && +x.metadata.size) || 0, at: x.created_at || x.updated_at || null })); },
    async download(path) { const r = await CLOUD.req("/storage/v1/object/authenticated/exports/" + String(path).split("/").map(encodeURIComponent).join("/")); if (!r.ok) throw new Error("Download failed: " + r.status); return r.blob(); },
    exportNow(o) { return CLOUD.backup("export", { org: o || org() }); },
  };
  if (typeof CLOUD !== "undefined") CLOUD.records = records;

  // ---------- the page
  const CSS = `
  .rh-tabs { margin: 0 0 12px; max-width: 100%; }
  .rh-demo { display: flex; gap: 8px; align-items: center; justify-content: flex-start; grid-column: 1 / -1; white-space: nowrap; }
  .rh-filters .rh-demo input { width: auto; min-width: 0; flex: none; margin: 0; }
  .rh-filters { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 8px; margin: 0 0 12px; }
  .rh-filters input, .rh-filters select { width: 100%; min-width: 0; }
  .rh-diff { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 2px 10px; font-size: 11.5px; line-height: 1.45; }
  .rh-diff .k { color: var(--pt-faint); }
  .rh-diff .v { overflow-wrap: anywhere; }
  .rh-diff .v s { opacity: .55; }
  .rh-who { white-space: nowrap; }
  .rh-rec b { font-weight: 600; }
  .rh-rec .sh-faint { display: block; font-size: 11px; }
  @media (max-width: 760px) {
    .rh-list table, .rh-list tbody, .rh-list tr, .rh-list td { display: block; width: 100%; }
    .rh-list thead { display: none; }
    .rh-list tr { padding: 10px 0; border-bottom: 1px solid var(--pt-hair); }
    .rh-list td { padding: 2px 0; border: 0; text-align: left; }
    .rh-list td:empty { display: none; }
  }`;
  function ensureCss() { if (document.getElementById("rh-css")) return; const el = document.createElement("style"); el.id = "rh-css"; el.textContent = CSS; document.head.append(el); }
  const st = { tab: "changes", store: "", kind: "", user: "", from: "", to: "", q: "", people: null };
  async function peopleMap() { if (st.people) return st.people; const m = new Map(); try { for (const p of await CLOUD.people()) m.set(p.id, p.name || p.user || p.email); } catch (e) { /* names stay ids */ } st.people = m; return m; }
  const who = (m, id) => (id ? m.get(id) || "a former member" : "the workspace");

  function draw(main, X) {
    ensureCss(); const { h1 } = X; main.innerHTML = "";
    const refresh = H("button", { class: "quiet", onclick: () => draw(main, X) }, "Refresh");
    main.append(h1("Record history", "every change the workspace kept — when, who, what — and the way back", refresh));
    const tab = (id, l) => H("button", { class: st.tab === id ? "on" : "", "data-tab": id, "aria-selected": st.tab === id ? "true" : "false", onclick: () => { st.tab = id; draw(main, X); } }, l);
    main.append(H("div", { class: "sh-seg rh-tabs", role: "tablist" }, tab("changes", "Changes"), tab("deleted", "Recently deleted"), tab("exports", "Exports")));
    const body = H("div", { class: "rh-body" }); main.append(body);
    if (st.tab === "changes") changes(body, X); else if (st.tab === "deleted") deleted(body, X); else exportsTab(body, X);
  }

  function changes(body, X) {
    const { tbl } = X;
    const sel = (key, opts) => { const s = H("select", { "data-f": key, onchange: () => { st[key] = s.value; load(); } }, opts.map((o) => H("option", { value: o.v, selected: st[key] === o.v ? "" : null }, o.l))); return s; };
    const inp = (key, type, ph) => { const i = H("input", { type, "data-f": key, placeholder: ph || "", value: st[key] || "" }); let t = null; i.addEventListener(type === "search" ? "input" : "change", () => { clearTimeout(t); t = setTimeout(() => { st[key] = i.value.trim(); load(); }, type === "search" ? 300 : 0); }); return i; };
    const kinds = H("select", { "data-f": "kind", onchange: () => { st.kind = kinds.value; load(); } }, H("option", { value: "" }, "Every kind"));
    const users = H("select", { "data-f": "user", onchange: () => { st.user = users.value; load(); } }, H("option", { value: "" }, "Anyone"));
    body.append(H("div", { class: "rh-filters" }, sel("store", STORES), kinds, users, inp("from", "date"), inp("to", "date"), inp("q", "search", "Search by id or name")));
    const list = H("div", { class: "rh-list sh-dim" }, "Loading…"); body.append(list);
    peopleMap().then((m) => { for (const [id, n] of m) users.append(H("option", { value: id, selected: st.user === id ? "" : null }, n)); });
    async function load() {
      list.className = "rh-list sh-dim"; list.textContent = "Loading…";
      try {
        const m = await peopleMap(); const to = st.to ? new Date(Date.parse(st.to) + 86400000).toISOString() : null;
        const rows = await records.history({ store: st.store, kind: st.kind, user: st.user, from: st.from ? new Date(st.from).toISOString() : null, to, q: st.q });
        const seen = new Set([...kinds.options].map((o) => o.value)); for (const k of [...new Set(rows.map((r) => r.kind))].sort()) if (!seen.has(k)) kinds.append(H("option", { value: k }, k));
        list.className = "rh-list"; list.innerHTML = "";
        list.append(tbl([{ l: "When" }, { l: "Who" }, { l: "Record" }, { l: "What changed", wrap: 1 }, { l: "" }], rows.map((e) => ({ cells: [
          H("span", { title: SUITE.fmtDT(e.replaced_at) }, SUITE.fmtDT(e.replaced_at)),
          H("span", { class: "rh-who" }, who(m, e.replaced_by)),
          H("span", { class: "rh-rec" }, H("b", {}, shown(label(e))), H("span", { class: "sh-faint" }, storeName(e.store) + " · " + e.kind + " · v" + e.version + (e.next_version ? " → v" + e.next_version : ""))),
          change(e),
          restoreBtn(e, () => load()),
        ] })), { empty: "Nothing has changed yet — or nothing matches the filters." }));
        if (rows.length >= 200) list.append(H("div", { class: "sh-faint", style: "margin-top:8px" }, "The newest 200 changes are shown; narrow the filters to see older ones."));
      } catch (err) { list.className = "rh-list sh-err"; list.textContent = err.message; }
    }
    load();
  }
  function change(e) {
    if (e.next_deleted_at && !e.deleted_at) return H("div", { class: "rh-diff" }, H("span", { class: "k" }, "removed"), H("span", { class: "v" }, "the record was deleted"));
    if (e.deleted_at && !e.next_deleted_at && e.next_version) return H("div", { class: "rh-diff" }, H("span", { class: "k" }, "restored"), H("span", { class: "v" }, "the record came back"));
    const d = diff(e.data, e.next); if (!d.length) return H("span", { class: "sh-faint" }, "saved again, no change");
    const box = H("div", { class: "rh-diff" }); for (const x of d.slice(0, 8)) box.append(H("span", { class: "k" }, x.k), H("span", { class: "v" }, H("s", {}, shown(x.a)), " → ", shown(x.b)));
    if (d.length > 8) box.append(H("span", { class: "k" }, "…"), H("span", { class: "v sh-faint" }, (d.length - 8) + " more fields"));
    return box;
  }
  function restoreBtn(e, after) {
    if (e.store === "items" && e.current_deleted_at) return H("span", { class: "sh-faint" }, "ended");
    return H("button", { class: "quiet", "data-hid": String(e.hid), onclick: async (ev) => {
      const b = ev.currentTarget; const what = shown(label(e));
      if (!(await SUITE.confirm({ title: "Restore this version?", text: what + " goes back to how it was before " + SUITE.fmtDT(e.replaced_at) + " (version " + e.version + "). The workspace keeps the current version in the history, so this can be undone the same way." }, "Restore"))) return;
      b.disabled = true; try { await records.restore(e); SUITE.toast("Restored — " + what + " is back to version " + e.version + "'s content"); after(); } catch (err) { b.disabled = false; SUITE.toast(err.message); }
    } }, "Restore this version");
  }

  function deleted(body, X) {
    const { tbl } = X; const f = { store: "", q: "", demo: false };
    const s = H("select", { onchange: () => { f.store = s.value; load(); } }, STORES.filter((x) => ["", "book", "proship", "vault", "items"].includes(x.v)).map((o) => H("option", { value: o.v }, o.l)));
    const q = H("input", { type: "search", placeholder: "Search by id or name" }); let t = null; q.addEventListener("input", () => { clearTimeout(t); t = setTimeout(() => { f.q = q.value.trim(); load(); }, 300); });
    const demo = H("label", { class: "sh-dim rh-demo" }, H("input", { type: "checkbox", onchange: (ev) => { f.demo = ev.target.checked; load(); } }), "Include demo records");
    body.append(H("div", { class: "rh-filters" }, s, q, demo));
    const list = H("div", { class: "rh-list sh-dim" }, "Loading…"); body.append(list);
    async function load() {
      list.className = "rh-list sh-dim"; list.textContent = "Loading…";
      try {
        const m = await peopleMap(); const rows = await records.deleted(f); list.className = "rh-list"; list.innerHTML = "";
        list.append(tbl([{ l: "Removed" }, { l: "By" }, { l: "Record" }, { l: "Last copy", wrap: 1 }, { l: "" }], rows.map((d) => ({ cells: [
          SUITE.fmtDT(d.deleted_at), H("span", { class: "rh-who" }, who(m, d.deleted_by)),
          H("span", { class: "rh-rec" }, H("b", {}, shown((d.copy && (d.copy.name || d.copy.ref || d.copy.title)) || d.id)), H("span", { class: "sh-faint" }, storeName(d.store) + " · " + d.kind + (d.hid ? " · deleted for good" : ""))),
          d.copy ? H("span", { class: "sh-faint" }, shown(Object.fromEntries(Object.entries(d.copy).filter(([k]) => !["id", "org_id", "owner_id", "created_at", "updated_at", "enc"].includes(k)).slice(0, 5)))) : H("span", { class: "sh-faint" }, "no earlier copy kept (removed before 4.31.3)"),
          d.copy || d.store === "vault" || d.store === "items" ? H("button", { class: "quiet", "data-undelete": d.store + "/" + d.id, onclick: async (ev) => { const b = ev.currentTarget; if (!(await SUITE.confirm({ title: "Restore this record?", text: "It comes back as it was just before it was removed. The removal stays in the history." }, "Restore"))) return; b.disabled = true; try { await records.undelete(d); SUITE.toast("Restored"); load(); } catch (err) { b.disabled = false; SUITE.toast(err.message); } } }, "Restore") : null,
        ] })), { empty: "Nothing was removed — or nothing matches." }));
      } catch (err) { list.className = "rh-list sh-err"; list.textContent = err.message; }
    }
    load();
  }

  function exportsTab(body, X) {
    const { tbl, panel } = X;
    const now = H("button", { class: "primary", onclick: async () => { now.disabled = true; now.textContent = "Exporting…"; try { const r = await records.exportNow(); const one = (r.results || [])[0] || {}; SUITE.toast(one.ok ? "Exported — " + Math.round((one.bytes || 0) / 1024) + " KB" : "The export did not finish: " + (one.error || r.error || "unknown")); } catch (e) { SUITE.toast(e.message); } now.disabled = false; now.textContent = "Export now"; load(); } }, "Export now");
    body.append(panel(null, H("div", { class: "sh-dim", style: "line-height:1.5;margin-bottom:10px" }, "Every night at 02:25 UTC the workspace writes one compressed JSON file with every record of this company — live and removed — from the books, PROSHIP, the company's notes and calendar, and the company documents' index. The last 60 days are kept. Only administrators of this company can open them."), H("div", { class: "sh-toolbar" }, now)));
    const list = H("div", { class: "rh-list sh-dim" }, "Loading…"); body.append(list);
    async function load() {
      list.className = "rh-list sh-dim"; list.textContent = "Loading…";
      try { const rows = await records.exports(); list.className = "rh-list"; list.innerHTML = "";
        list.append(tbl([{ l: "Export" }, { l: "Size", num: 1 }, { l: "" }], rows.map((x) => ({ cells: [x.name.replace(/\.json\.gz$/, ""), x.size ? Math.max(1, Math.round(x.size / 1024)) + " KB" : "—", H("button", { class: "quiet", onclick: async (ev) => { const b = ev.currentTarget; b.disabled = true; try { const blob = await records.download(x.path); await SUITE.download("xyntax-export-" + x.name, blob); } catch (e) { SUITE.toast(e.message); } b.disabled = false; } }, "Download")] })), { empty: "No exports yet — the first one is written tonight, or press Export now." }));
      } catch (err) { list.className = "rh-list sh-err"; list.textContent = err.message; }
    }
    load();
  }

  (window.SETTINGS_EXTRA = window.SETTINGS_EXTRA || []).push({ id: "history", label: "Record history", group: "admin", when: isAdmin, draw });
  window.RECORD_HISTORY = { diff, label, records, draw };
})();
