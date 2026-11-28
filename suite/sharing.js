/* XYNTAX · sharing with people (4.10). One note, one event or one contact can be shared with named colleagues — not the whole
 * company. The item leaves the owner's personal document and becomes a row in shared_items; the owner and the named people read
 * and edit that row (the workspace enforces who, row by row); when sharing stops the item returns to the owner's personal
 * document. These rows, like company documents, are protected by the workspace's row-level security and not by the owner's
 * passphrase (SECURITY.md). This module holds what the three apps share: the people picker, the badge, the move in and out. */
(function () {
  if (typeof SUITE === "undefined") return;
  const H = SUITE.H.bind(SUITE);
  const me = () => (typeof CLOUD !== "undefined" && CLOUD.session() && CLOUD.session().user_id) || null;
  const on = () => typeof CLOUD !== "undefined" && CLOUD.active() && !!(CLOUD.session() || {}).org_id;
  const cache = { list: null, at: 0 };
  // the company's members only (profiles reach across companies; a share stays inside the company the item belongs to)
  // the company's members who have the app (profiles reach across companies; a share stays inside the company the item
  // belongs to, and a colleague without the app could never open it)
  const peopleKey = () => "xyntax.people." + ((CLOUD.session() || {}).org_id || "");
  async function people(force, app) { if (!on()) return []; const key = app || "*"; if (!cache.list) { try { const loc = JSON.parse(localStorage.getItem(peopleKey()) || "null"); if (Array.isArray(loc)) { cache.list = loc; cache.key = "*"; cache.at = 0; } } catch (e) { /* none */ } } if (!force && cache.list && cache.key === key && Date.now() - cache.at < 300000) return cache.list; if (cache._p && !force) return cache.list || cache._p; cache._p = (async () => { try { const org = (CLOUD.session() || {}).org_id; let allowed = null; try { const r = await CLOUD.req("/rest/v1/memberships?select=user_id,apps&org_id=eq." + org); if (r.ok) { allowed = new Map(); for (const m of await r.json()) allowed.set(m.user_id, m.apps == null || !app || (Array.isArray(m.apps) && m.apps.includes(app))); } } catch (e) { /* profiles alone */ } cache.list = (await CLOUD.people()).filter((p) => p.id !== me() && (!allowed || allowed.get(p.id))); cache.key = key; cache.at = Date.now(); if (key === "*") { try { localStorage.setItem(peopleKey(), JSON.stringify(cache.list)); } catch (e) { /* ignore */ } } } catch (e) { cache.list = cache.list || []; } finally { cache._p = null; } return cache.list; })(); return cache._p; }
  // sharing is writing: editors and administrators of the company, like the company documents
  const canShare = () => on() && ["admin", "editor"].includes((CLOUD.state && CLOUD.state.role) || (CLOUD.session() || {}).role);
  const nameOf = (id) => { const p = (cache.list || []).find((x) => x.id === id); return p ? (p.name || p.user) : "a colleague"; };
  const names = (ids) => (ids || []).map(nameOf);
  const mine = (row) => row && row.owner_id === me();
  const APP = { notes: "page", calendar: "event", contacts: "contact" };

  // the picker: who sees it — a multi-select of the company's people, with the current set ticked
  async function pick(current, opt) {
    opt = opt || {}; if (!canShare()) { SUITE.toast("Your role is read-only in this company"); return null; } const list = await people(true, opt.app); if (!list.length) { SUITE.toast(opt.app ? "No colleague in the company has " + opt.app.toUpperCase() + " yet" : "No colleagues to share with yet"); return null; }
    return new Promise((resolve) => {
      let done = false; const finish = (v) => { if (!done) { done = true; resolve(v); } };
      SUITE.form({ title: opt.title || "Share with people", subtitle: opt.subtitle || "they see and can edit it; only you decide who, and only you can stop sharing", fields: [{ k: "who", label: "People", type: "multi", wide: 1, options: list.map((p) => ({ v: p.id, l: p.user, d: p.name })), value: (current || []).slice() }], submitLabel: opt.submitLabel || "Share", submit: async (v) => { finish(v.who || []); }, onClose: () => finish(null) });
      // the sheet has no close hook in every build: resolve null when it closes without a submit
      const sh = document.getElementById("sheet"); if (sh) { const obs = new MutationObserver(() => { if (!sh.classList.contains("open")) { obs.disconnect(); setTimeout(() => finish(null), 50); } }); obs.observe(sh, { attributes: true, attributeFilter: ["class"] }); }
    });
  }
  // the badge: "You + 2" for the owner, "Shared by Anna" for a recipient
  function badge(row, opt) {
    if (!row) return null; const own = mine(row); const n = (row.shared_with || []).length; const who = names(row.shared_with);
    const b = H("span", { class: "sh-aud people" + ((opt && opt.cls) ? " " + opt.cls : ""), title: own ? (n ? "Shared with " + who.join(", ") : "Shared with nobody yet") : "Shared with you by " + nameOf(row.owner_id) + (n > 1 ? " and " + (n - 1) + " other" + (n > 2 ? "s" : "") : "") }, SUITE.icon ? SUITE.icon("people") : null, H("span", {}, own ? (n ? "You + " + n : "You") : "Shared by " + nameOf(row.owner_id)));
    return b;
  }
  // in: the item leaves its personal document and becomes a row
  // 4.10.2 · cache-first: the rows this device saw last come back at once (localStorage, per company and app) and the
  // workspace is asked in the background; when its answer differs the open app pulls through its focus path. `fresh`
  // (the polls, realtime notices, saves) always asks the workspace. The people list is warmed alongside, never awaited.
  const rowsKey = (app) => "xyntax.shared-items." + ((CLOUD.session() || {}).org_id || "") + "." + ((CLOUD.session() || {}).user_id || "") + "." + app;
  const rowsLocal = (app) => { try { return JSON.parse(localStorage.getItem(rowsKey(app)) || "null"); } catch (e) { return null; } };
  const rowsKeep = (app, rows) => { try { localStorage.setItem(rowsKey(app), JSON.stringify(rows)); } catch (e) { /* no room */ } };
  const sig = (rows) => JSON.stringify((rows || []).map((r) => [r.id, r.version, r.shared_with]));
  const inflight = {};
  async function fetchRows(app) { if (inflight[app]) return inflight[app]; inflight[app] = (async () => { try { const rows = await CLOUD.sharedItems.list(app); const was = rowsLocal(app); rowsKeep(app, rows); if (was && sig(was) !== sig(rows) && SUITE.current === app) window.dispatchEvent(new Event("focus")); return rows; } finally { delete inflight[app]; } })(); return inflight[app]; }
  const rowsDrop = (app) => { try { localStorage.removeItem(rowsKey(app)); } catch (e) { /* ignore */ } };
  async function _share(app, item, ids) { if (!on()) throw new Error("Sharing with people needs a company"); if (!canShare()) throw new Error("Your role is read-only in this company"); const data = JSON.parse(JSON.stringify(item)); delete data.shared; return CLOUD.sharedItems.create(app, data, ids || []); }
  // out: the row ends, the item (as last saved) comes back to the owner
  async function _unshare(row) { let latest = null; try { latest = await CLOUD.sharedItems.get(row.id); } catch (e) { /* the copy in hand */ } await CLOUD.sharedItems.remove(row.id); return latest && latest.data ? latest.data : row.data; }
  async function _setPeople(row, ids) { const r = await CLOUD.sharedItems.setPeople(row.id, ids); if (r) Object.assign(row, r); else row.shared_with = ids; return row; }
  // a row's content saved with its version; CONFLICT when someone else saved first — the caller reloads
  async function _save(row, data) { const v = await CLOUD.sharedItems.save(row.id, row.version, data); row.version = v; row.data = data; row.updated_at = new Date().toISOString(); return row; }
  // throws when the workspace cannot be asked — the caller keeps what it has rather than wiping it
  // every write drops the device copy of the rows, so the next list asks the workspace
  async function share(app, item, ids) { try { return await _share(app, item, ids); } finally { rowsDrop(app); } }
  async function unshare(row) { try { return await _unshare(row); } finally { if (row && row.app) rowsDrop(row.app); } }
  async function setPeople(row, ids) { try { return await _setPeople(row, ids); } finally { if (row && row.app) rowsDrop(row.app); } }
  async function save(row, data) { try { return await _save(row, data); } finally { if (row && row.app) rowsDrop(row.app); } }
  async function list(app, opt) { if (!on()) return []; opt = opt || {}; people(false, app).catch(() => {}); const local = rowsLocal(app); if (!opt.fresh && Array.isArray(local)) { fetchRows(app).catch(() => {}); if (typeof SUITE !== "undefined" && SUITE.perf) SUITE.perf.mark("shared rows " + app + " from device copy"); return local; } return fetchRows(app); }
  // rows pulled again: every row the device already holds keeps its object (open editors and forms point at it); its
  // content is refreshed in place when the version moved; a pending save keeps its edits. Returns the ids whose content changed.
  function merge(oldRows, rows) { const out = []; const changed = []; for (const n of rows) { const o = (oldRows || []).find((x) => x.id === n.id); if (!o) { out.push(n); continue; } if (o.version !== n.version) { if (!o._t) { for (const k of Object.keys(o.data)) if (!(k in n.data)) delete o.data[k]; Object.assign(o.data, n.data); } changed.push(n.id); } o.version = n.version; o.shared_with = n.shared_with; o.updated_at = n.updated_at; o.updated_by = n.updated_by; out.push(o); } return { rows: out, changed }; }
  // the label for Settings → Shared by me
  const audience = (row) => ({ audience: "people", people: names(row.shared_with) });
  window.SHARING = { on, canShare, me, people, names, nameOf, mine, pick, badge, share, unshare, setPeople, save, list, merge, audience, kind: (app) => APP[app] || "item" };
})();
