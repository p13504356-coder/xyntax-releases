/* XYNTAX CONTACTS — the people you deal with, in two books: your own (private, sealed with your other personal data) and the
 * company's (shared with everyone in the workspace, alongside Accounting's counterparties and the people at them). One card
 * for a person wherever they appear: here, as a chip in a note or an event, on a trade. From the card: call, message, email,
 * WhatsApp, directions. The phone's own address book can be read into the private book and kept in step. */
// ---- CT_PHONE · pure helpers for telling one number from another (4.8.3). Android hands the same person's number once per
// account it is stored in (SIM, Google, WhatsApp, the device), each written differently; these decide what is the same number.
const CT_PHONE = (() => {
  const key = (v) => { let s = String(v || "").trim().replace(/[^\d+]/g, ""); if (s.startsWith("00")) s = "+" + s.slice(2); if (s.indexOf("+") > 0) s = s.replace(/\+/g, ""); return s; };
  const digits = (v) => key(v).replace(/^\+/, "");
  // the same number: identical after normalising, or a local form (leading 0) whose national part ends an international one
  const same = (a, b) => { const ka = key(a), kb = key(b); if (!ka || !kb) return false; if (ka === kb) return true; const da = digits(a), db = digits(b); if (da === db) return true; const loc = (d) => d.replace(/^0+/, ""); const la = loc(da), lb = loc(db); if (la.length < 7 || lb.length < 7) return false; return (ka.startsWith("+") && !kb.startsWith("+") && da.endsWith(lb)) || (kb.startsWith("+") && !ka.startsWith("+") && db.endsWith(la)); };
  // one entry per distinct number; a typed/labelled entry beats a bare one, an international form beats a local one
  const score = (p) => (p.t && p.t !== "mobile" ? 2 : p.t ? 1 : 0) + (key(p.v).startsWith("+") ? 4 : 0);
  const dedupePhones = (list) => { const out = []; for (const p of list || []) { if (!p || !key(p.v)) continue; const i = out.findIndex((q) => same(q.v, p.v)); if (i < 0) out.push(p); else if (score(p) > score(out[i])) out[i] = p; } return out; };
  const dedupeEmails = (list) => { const out = []; const seen = new Set(); for (const e of list || []) { const k = String((e && e.v) || "").trim().toLowerCase(); if (!k || seen.has(k)) continue; seen.add(k); out.push({ ...e, v: String(e.v).trim() }); } return out; };
  return { key, same, dedupePhones, dedupeEmails };
})();
if (typeof module !== "undefined" && module.exports) module.exports = CT_PHONE;
(function () {
  if (typeof SUITE === "undefined") return; // node: only CT_PHONE is wanted
  const H = (...a) => SUITE.H(...a); const esc = (s) => SUITE.esc(s);
  const DEF = { contacts: [], synced: {}, groups: [] }; const SDEF = { contacts: [] };
  const st = { data: null, sd: null, sh: [], view: "all", q: "", sel: null, pane: "main", letter: null };
  // 4.10 · contacts shared with named people live as rows (SHARING), found by the contact id
  const rowOf = (x) => { const id = typeof x === "string" ? x : x && x.id; return (st.sh || []).find((r) => r.data && r.data.id === id) || null; };
  function saveRow(row) { clearTimeout(row._t); row._t = setTimeout(async () => { row._t = null; try { await SHARING.save(row, row.data); } catch (e) { if (e.message === "CONFLICT" || e.message === "GONE") { await pullRows(true); draw(); SUITE.toast(e.message === "GONE" ? "This contact is no longer shared with you" : "This contact was changed by someone else — reloaded"); } else SUITE.toast("Could not save the shared contact: " + e.message); } }, 400); }
  async function pullRows(force) { if (typeof SHARING === "undefined" || !SHARING.on()) return false; let rows; try { rows = await SHARING.list("contacts", { fresh: true }); } catch (e) { return false; } const before = JSON.stringify((st.sh || []).map((r) => [r.id, r.version, r.shared_with])); const after = JSON.stringify(rows.map((r) => [r.id, r.version, r.shared_with])); if (!force && before === after) return false; const m = SHARING.merge(st.sh, rows); st.sh = m.rows; st._rowsChanged = m.changed; if (st.sel && !find(st.sel)) st.sel = null; return true; }
  const D = () => st.data; const SD = () => st.sd; const now = () => new Date().toISOString();
  const sharedOn = () => SUITE.db.sharedOk();
  const uid = () => SUITE.uid();
  const save = (c) => { if (!c) { SUITE.db.save("contacts"); if (st.sd) SUITE.db.save("shared:contacts"); return; } if (rowOf(c)) return saveRow(rowOf(c)); SUITE.db.save(bookOf(c) === "company" ? "shared:contacts" : "contacts"); };
  const bookOf = (c) => rowOf(c) ? "people" : (st.sd && st.sd.contacts.includes(c)) ? "company" : c.source === "counterparty" || c.source === "person" ? "corporate" : "private";
  const H1 = (t, sub, ...acts) => H("h1", { class: "sh-h1" }, H("span", { class: "hd" }, H("span", { class: "ttl" }, t), sub ? H("span", { class: "sub" }, sub) : null), acts.length ? H("span", { class: "acts" }, acts) : null);
  let root, side, main, pane, frame;

  // ---------- the books
  function displayName(c) { return (c.name || [c.first, c.last].filter(Boolean).join(" ") || c.company || "Unnamed").trim(); }
  // 4.9 · a company card: created with the Company button (kind) or recognisable by its name; its people are the contacts whose company matches
  const CO_RX = /\b(A\/S|ApS|AS|Ltd\.?|LLC|GmbH|Inc\.?|S\.?A\.?|B\.?V\.?|Corp\.?|Limited|PLC|FZE|FZCO|DMCC|LLP|Pte|Pty|AG|SpA|Oy|AB|KK|Co\.|Group|Holdings?|Bank|Carriers|Shipping|Trading|Services|Energy|Marine|Bunkering)\b/i;
  function isCompany(c) { if (c.kind === "company") return true; if (c.kind === "person" || !c.name || c.first || c.last) return false; const n = c.name.toLowerCase(), k = (c.company || "").toLowerCase(); if (k && k === n) return true; return CO_RX.test(c.name) && (!k || n.startsWith(k) || k.startsWith(n)); }
  const coKey = (v) => String(v || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  function companyOf(c) { if (!c.company && !c.companyId) return null; const L = all(); if (c.companyId) { const x = L.find((k) => k.id === c.companyId); if (x) return x; } const k = coKey(c.company); if (!k) return null; return L.find((x) => x.id !== c.id && isCompany(x) && (coKey(x.name) === k || coKey(x.company) === k || coKey(x.name).startsWith(k) || k.startsWith(coKey(x.name)))) || null; }
  function peopleOf(co) { const ks = [coKey(co.name), coKey(co.company)].filter(Boolean); return all().filter((x) => x.id !== co.id && !isCompany(x) && (x.companyId === co.id || ks.some((k) => coKey(x.company) === k || (coKey(x.company) && (coKey(x.company).startsWith(k) || k.startsWith(coKey(x.company))))))).sort((a, b) => displayName(a).localeCompare(displayName(b))); }
  function companyNames() { const set = new Map(); for (const x of all()) { if (isCompany(x)) set.set(coKey(x.name), x.name); else if (x.company && !set.has(coKey(x.company))) set.set(coKey(x.company), x.company); } return [...set.values()].sort((a, b) => a.localeCompare(b)); }
  // a quiet tone per name for the avatar: the hue comes from the name, the saturation stays low so the list reads as one palette
  function tone(c) { const n = displayName(c); let h = 0; for (let i = 0; i < n.length; i++) h = (h * 31 + n.charCodeAt(i)) % 360; return "--av-h:" + h; }
  function avatar(c, big) { const co = isCompany(c); return H("span", { class: "ct-av" + (big ? " big" : "") + (co ? " co" : c._book === "corporate" ? " cp" : ""), style: tone(c) }, co ? SUITE.glyph("bank") : initials(c)); }
  function initials(c) { const n = displayName(c); return n.split(/\s+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join("").toUpperCase(); }
  function normPhone(v) { return (v || "").replace(/[^\d+]/g, ""); }
  function corporate() {
    // Accounting's counterparties and sales people, read-only here, live in the books
    const out = []; if (typeof S === "undefined" || !S.store) return out;
    for (const cp of S.store.counterparties || []) out.push({ id: "cp:" + cp.id, source: "counterparty", name: cp.name, company: cp.name, title: cp.role === "supplier" ? "Supplier" : cp.role === "both" ? "Customer and supplier" : "Customer", phones: cp.phone ? [{ t: "work", v: cp.phone }] : [], emails: cp.email ? [{ t: "work", v: cp.email }] : [], address: [cp.address, cp.city, cp.country].filter(Boolean).join(", "), notes: cp.contact ? "Contact: " + cp.contact : "", counterpartyId: cp.id, updatedAt: cp.created });
    for (const p of S.store.people || []) if (p.active !== false) out.push({ id: "pp:" + p.id, source: "person", name: p.name, company: (typeof CLOUD !== "undefined" && CLOUD.state && CLOUD.state.orgName) || "Our company", title: "Sales", phones: [], emails: p.email ? [{ t: "work", v: p.email }] : [], personId: p.id });
    return out;
  }
  function all() { const own = D().contacts.map((c) => ({ ...c, _book: "private" })); const co = st.sd ? st.sd.contacts.map((c) => ({ ...c, _book: "company" })) : []; const sh = (st.sh || []).map((r) => ({ ...r.data, _book: "people", _row: r })); const corp = corporate().map((c) => ({ ...c, _book: "corporate" })); return own.concat(co, sh, corp); }
  function find(id) { return D().contacts.find((c) => c.id === id) || (st.sd && st.sd.contacts.find((c) => c.id === id)) || (rowOf(id) || {}).data || corporate().find((c) => c.id === id) || null; }
  function matches(c, q) { if (!q) return true; const s = (displayName(c) + " " + (c.company || "") + " " + (c.title || "") + " " + (c.emails || []).map((e) => e.v).join(" ") + " " + (c.phones || []).map((p) => p.v).join(" ") + " " + (c.tags || []).join(" ")).toLowerCase(); return q.toLowerCase().split(/\s+/).every((w) => s.includes(w)); }
  function listFor(view) { let L = all(); if (view === "favorites") L = L.filter((c) => c.favorite); else if (view === "private") L = L.filter((c) => c._book === "private"); else if (view === "company") L = L.filter((c) => c._book === "company"); else if (view === "corporate") L = L.filter((c) => c._book === "corporate"); else if (view === "recent") L = L.slice().sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || "")).slice(0, 30); if (st.q) L = L.filter((c) => matches(c, st.q)); if (view !== "recent") L.sort((a, b) => displayName(a).localeCompare(displayName(b))); return L; }

  // ---------- the app
  function mount(body, fr) {
    frame = fr; root = H("div", { class: "sh-app ct with-pane", "data-pane": "main" }); side = H("div", { class: "sh-side" }); main = H("div", { class: "sh-main" }); pane = H("div", { class: "sh-pane" }); root.append(side, main, pane); body.append(root);
    frame.setActions(H("button", { class: "quiet", onclick: (e) => importMenu(e.currentTarget) }, "Import"), H("button", { class: "quiet", onclick: (e) => exportMenu(e.currentTarget) }, "Export"), SUITE.host && SUITE.host.deviceContacts ? H("button", { class: "quiet", onclick: syncPhone }, "From phone") : null, H("button", { class: "primary", onclick: () => form() }, "New contact"));
    const show = (v) => { st.view = v; st.q = ""; st.sel = null; draw(); setPane("main"); };
    if (frame.setBar) frame.setBar({ side: { l: "Books", icon: "people", on: () => st.pane === "side", fn: () => setPane(st.pane === "side" ? "main" : "side") }, search: () => { setPane("main"); setTimeout(() => { const i = main.querySelector(".ct-quick input"); if (i) i.focus(); }, 80); }, create: { l: "New contact", fn: () => form() }, views: [{ l: "All contacts", on: () => st.view === "all", fn: () => show("all") }, { l: "Favourites", on: () => st.view === "favorites", fn: () => show("favorites") }, { l: "Company book", on: () => st.view === "company", fn: () => show("company") }, { l: "Counterparties", on: () => st.view === "corporate", fn: () => show("corporate") }], more: [{ l: "Import…", fn: () => importAny() }, { l: "Export…", fn: () => exportDialog() }, ...(SUITE.host && SUITE.host.deviceContacts ? [{ l: "From phone", fn: syncPhone }] : [])] });
    else if (frame.setTabs) frame.setTabs([{ l: "Contacts", icon: "people", on: () => st.pane === "main", fn: () => show("all") }]);
    main.append(H("div", { class: "sh-dim", style: "padding:20px" }, "Loading…"));
    Promise.all([SUITE.db.load("contacts", DEF), sharedOn() ? SUITE.db.load("shared:contacts", SDEF).catch(() => null) : Promise.resolve(null), typeof SHARING !== "undefined" ? SHARING.list("contacts") : Promise.resolve([])]).then(([d, sd, sh]) => { st.data = d; st.sh = sh || []; d.contacts = d.contacts || []; d.synced = d.synced || {}; st.sd = sd; if (sd) sd.contacts = sd.contacts || []; if (!d.synced.cleaned && repairPhones()) { d.synced.cleaned = now(); SUITE.db.save("contacts"); } else if (!d.synced.cleaned) d.synced.cleaned = now(); draw(); });
    // 4.7 · a contact saved on another device appears here within half a minute, and at once when the window comes back
    st.focus = async () => { let changed = false; if (await SUITE.db.pull("contacts")) { st.data = SUITE.db.cache.contacts.data; st.data.contacts = st.data.contacts || []; changed = true; } if (await pullRows().catch(() => false)) changed = true; if (st.sd && await SUITE.db.pull("shared:contacts")) { st.sd = SUITE.db.cache["shared:contacts"].data; st.sd.contacts = st.sd.contacts || []; changed = true; } if (changed && !document.querySelector("#shdlg.open")) draw(); };
    window.addEventListener("focus", st.focus); st.poll = setInterval(() => { if (!document.hidden) st.focus(); }, 25000);
  }
  function unmount() { frame.setBack(null); if (st._index) { st._index.remove(); st._index = null; } if (st.focus) window.removeEventListener("focus", st.focus); clearInterval(st.poll); st.poll = null; }
  function setPane(p) { st.pane = p; root.dataset.pane = p; if (SUITE.nav) SUITE.nav.mark(p + (p === "pane" && st.sel ? ":" + st.sel : "")); frame.setBack(SUITE.isMobile() && p === "pane" ? () => setPane("main") : null, "Contacts"); if (frame.refreshTabs) frame.refreshTabs(); }
  function draw() { drawSide(); drawMain(); drawPane(); setPane(st.pane); }
  function refresh() { if (st.data) draw(); }
  function onEsc() { if (SUITE.isMobile() && st.pane === "pane") { setPane("main"); return true; } if (st.sel) { st.sel = null; drawMain(); drawPane(); return true; } return false; }
  // 4.10 · one step back: card → list → books (phone); the desk clears the card, then a search
  function onBack() { if (SUITE.isMobile()) { if (st.pane === "pane") { st.sel = null; setPane("main"); drawList(); return true; } if (st.pane === "main") { setPane("side"); return true; } return false; } if (st.sel) { st.sel = null; drawMain(); drawPane(); return true; } if (st.q) { st.q = ""; drawMain(); return true; } return false; }

  // 4.16 · groups (your own lists of people across every book) and the view helpers shared by the list, the title and the count
  const groups = () => { const d = D(); if (!Array.isArray(d.groups)) d.groups = []; return d.groups; };
  const groupById = (id) => groups().find((g) => g.id === id) || null;
  const viewBase = (view) => (view.startsWith("tag:") || view.startsWith("group:") ? "all" : view);
  function inView(c, view) { if (view.startsWith("tag:")) return (c.tags || []).includes(view.slice(4)); if (view.startsWith("group:")) { const g = groupById(view.slice(6)); return !!g && (g.memberIds || []).includes(c.id); } return true; }
  const groupsOf = (c) => groups().filter((g) => (g.memberIds || []).includes(c.id));
  async function newGroup(preselect) { const v = await SUITE.prompt("New group", "Name (e.g. Brokers, Owners Q4, Singapore agents)", ""); if (!v || !v.trim()) return null; const g = { id: uid(), name: v.trim(), memberIds: preselect ? [].concat(preselect) : [], createdAt: now() }; groups().push(g); save(); draw(); SUITE.toast("Group " + g.name + " created"); return g; }
  async function renameGroup(g) { const v = await SUITE.prompt("Rename group", "Name", g.name); if (!v || !v.trim()) return; g.name = v.trim(); save(); draw(); }
  async function deleteGroup(g) { if (!(await SUITE.confirm({ title: "Delete the group " + g.name + "?", text: "The people stay in your books; only the list goes." }, "Delete group", true))) return; const d = D(); d.groups = groups().filter((x) => x !== g); if (st.view === "group:" + g.id) st.view = "all"; save(); draw(); }
  async function pickGroups(c) {
    if (!groups().length) { await newGroup(c.id); return; }
    const v = await SUITE.dialog({ title: "Groups for " + displayName(c), fields: [{ k: "ids", label: "Member of", type: "checks", options: groups().map((g) => ({ v: g.id, l: g.name })), value: groupsOf(c).map((g) => g.id) }], ok: "Save" }); if (!v) return;
    for (const g of groups()) { const has = (g.memberIds || []).includes(c.id), want = v.ids.includes(g.id); if (want && !has) g.memberIds = (g.memberIds || []).concat(c.id); if (!want && has) g.memberIds = g.memberIds.filter((x) => x !== c.id); }
    save(); drawSide(); drawPane(); if (st.view.startsWith("group:")) drawList();
  }
  function groupMail(g) { const to = [...new Set(all().filter((c) => (g.memberIds || []).includes(c.id)).map((c) => (c.emails || [])[0] && c.emails[0].v).filter(Boolean))]; if (!to.length) return SUITE.toast("Nobody in " + g.name + " has an email address"); if (SUITE.allowed("mail")) SUITE.open("mail", { compose: { to } }); else location.href = "mailto:" + to.join(","); }
  // 4.16 · duplicates: the same email, the same phone number or the same name (folded) inside one book; merging keeps the fuller card
  const fold = (n) => String(n || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
  function duplicates() {
    const out = []; const seen = new Set();
    const books = [["private", D().contacts]].concat(st.sd ? [["company", st.sd.contacts]] : []);
    for (const [book, arr] of books) for (let i = 0; i < arr.length; i++) for (let j = i + 1; j < arr.length; j++) { const a = arr[i], b = arr[j]; if (isCompany(a) !== isCompany(b)) continue; const why = [];
      const ea = new Set((a.emails || []).map((e) => String(e.v || "").trim().toLowerCase()).filter(Boolean)); if ((b.emails || []).some((e) => ea.has(String(e.v || "").trim().toLowerCase()))) why.push("same email");
      if ((a.phones || []).some((p) => (b.phones || []).some((q) => CT_PHONE.same(p.v, q.v)))) why.push("same phone");
      const fa = fold(displayName(a)), fb = fold(displayName(b)); if (fa && fa === fb) why.push("same name"); else if (fa && fb && why.length && (fa.split(" ").slice(-1)[0] === fb.split(" ").slice(-1)[0])) why.push("similar name");
      if (!why.length) continue; const k = a.id + "|" + b.id; if (seen.has(k)) continue; seen.add(k); out.push({ book, a, b, why }); }
    return out;
  }
  const filled = (c) => ["name", "company", "title", "address", "birthday", "notes"].filter((k) => c[k]).length + (c.phones || []).length + (c.emails || []).length + (c.tags || []).length;
  function merge(keep, drop, book) {
    keep.phones = CT_PHONE.dedupePhones((keep.phones || []).concat(drop.phones || [])); keep.emails = CT_PHONE.dedupeEmails((keep.emails || []).concat(drop.emails || []));
    keep.tags = [...new Set((keep.tags || []).concat(drop.tags || []))]; for (const k of ["company", "companyId", "title", "address", "birthday", "first", "last", "counterpartyId", "phoneId"]) if (!keep[k] && drop[k]) keep[k] = drop[k];
    if (drop.notes && drop.notes !== keep.notes) keep.notes = [keep.notes, drop.notes].filter(Boolean).join("\n"); keep.favorite = !!(keep.favorite || drop.favorite); keep.updatedAt = now();
    for (const g of groups()) if ((g.memberIds || []).includes(drop.id)) g.memberIds = [...new Set(g.memberIds.map((x) => (x === drop.id ? keep.id : x)))];
    const arr = book === "company" ? st.sd.contacts : D().contacts; const i = arr.indexOf(drop); if (i >= 0) arr.splice(i, 1);
    if (st.sel === drop.id) st.sel = keep.id;
    SUITE.db.save("contacts"); if (book === "company") SUITE.db.save("shared:contacts");
  }
  function duplicatesDialog() {
    const list = duplicates(); const box = H("div", { class: "ct-dups" });
    const draw2 = () => { box.innerHTML = ""; const L = duplicates(); if (!L.length) { box.append(H("div", { class: "sh-empty", style: "margin:12px 0" }, SUITE.icon("check"), H("b", {}, "No duplicates"), H("div", {}, "Every card has its own email, phone and name."))); return; }
      for (const d of L) { const keep = filled(d.a) >= filled(d.b) ? d.a : d.b, drop = keep === d.a ? d.b : d.a; const line = (c, lbl) => H("div", { class: "ct-dupc" }, H("span", { class: "ct-dupl" }, lbl), H("b", {}, displayName(c)), H("small", {}, [c.company, (c.emails || [])[0] && c.emails[0].v, (c.phones || [])[0] && c.phones[0].v].filter(Boolean).join(" · ") || "—"));
        box.append(H("div", { class: "ct-dup" }, H("div", { class: "ct-dupw" }, d.why.join(" · ") + (d.book === "company" ? " · company book" : "")), line(keep, "keep"), line(drop, "merge in"), H("div", { class: "ct-dupb" }, H("button", { class: "primary", onclick: () => { merge(keep, drop, d.book); SUITE.toast("Merged into " + displayName(keep)); draw2(); draw(); } }, "Merge")))); } };
    draw2(); SUITE.dialog({ title: "Duplicates" + (list.length ? " · " + list.length : ""), text: "Merging keeps the fuller card and adds the other's numbers, addresses, tags, groups and notes to it.", body: box, ok: " ", cancel: "Close" });
  }
  // 4.16 · one record, three uses: a contact linked to an ACCOUNTING counterparty is also that PROSHIP customer
  async function linkCounterparty(c) {
    if (typeof S === "undefined" || !S.store || !(S.store.counterparties || []).length) return SUITE.toast("Open Accounting once so the counterparties are known here");
    const cps = S.store.counterparties.slice().sort((a, b) => a.name.localeCompare(b.name)); const guess = cps.find((x) => (c.emails || []).some((e) => x.email && x.email.toLowerCase() === String(e.v).toLowerCase())) || cps.find((x) => fold(x.name) === fold(c.company || displayName(c)));
    const v = await SUITE.dialog({ title: "Link " + displayName(c) + " to a counterparty", text: "Sales, purchases, open invoices, vessels and charters of that counterparty then appear on this card.", fields: [{ k: "id", label: "Counterparty", type: "select", options: [{ v: "", l: "— not linked —" }].concat(cps.map((x) => ({ v: x.id, l: x.name + (x.role ? " · " + x.role : "") }))), value: c.counterpartyId || (guess && guess.id) || "" }], ok: "Link" }); if (!v) return;
    c.counterpartyId = v.id || null; c.updatedAt = now(); save(c); drawPane(); SUITE.toast(v.id ? "Linked" : "Unlinked");
  }
  const cpOf = (c) => (c.counterpartyId && typeof S !== "undefined" && S.store ? (S.store.counterparties || []).find((x) => x.id === c.counterpartyId) : null);
  // 4.16 · birthdays and anniversaries reach the bell and the morning reminders (the suite's reminder loop), at the morning hour
  async function reminders() { let d = st.data; if (!d) { try { d = await SUITE.db.load("contacts", DEF); } catch (e) { return []; } } const out = []; const morning = (SUITE.prefs && SUITE.prefs.get().dueMorning) || "08:00"; const t0 = new Date(); t0.setHours(0, 0, 0, 0);
    for (const c of (d && d.contacts) || []) for (const [k, label] of [["birthday", "Birthday"], ["anniversary", "Anniversary"]]) { const v = c[k]; if (!v || !/^\d{4}-\d{2}-\d{2}/.test(v)) continue; const at = new Date(t0.getFullYear() + "-" + v.slice(5, 10) + "T" + morning); if (isNaN(at)) continue; if (at < t0) at.setFullYear(at.getFullYear() + 1); if (at - t0 > 14 * 86400000) continue; const age = k === "birthday" && +v.slice(0, 4) > 1900 ? at.getFullYear() - +v.slice(0, 4) : null; out.push({ id: "ct:" + c.id + ":" + k + ":" + at.getFullYear(), at, title: label + " · " + displayName(c), body: (age ? "Turns " + age + " · " : "") + ((c.phones || [])[0] ? c.phones[0].v : (c.emails || [])[0] ? c.emails[0].v : ""), app: "contacts", contactId: c.id }); }
    return out.sort((a, b) => a.at - b.at); }

  function drawSide() {
    side.innerHTML = ""; const nav = H("div", { class: "sh-nav" }); side.append(H("div", { class: "sh-sh" }, H("h2", {}, "Books")), nav);
    // 4.8.3: a book opens its list — on the phone that means leaving the Books pane for the main one (draw() alone kept the pane)
    const item = (id, label, n) => H("button", { class: st.view === id ? "on" : "", onclick: () => { st.view = id; st.q = ""; st.sel = null; draw(); setPane("main"); } }, H("span", { class: "lbl" }, label), n ? H("span", { class: "n" }, n) : null);
    const L = all();
    nav.append(item("all", "All contacts", L.length), item("favorites", "Favourites", L.filter((c) => c.favorite).length || null), item("recent", "Recently added"));
    nav.append(H("div", { class: "grp" }, "Where they live"), item("private", "Private", D().contacts.length || null));
    if (st.sd) nav.append(item("company", "Company book", st.sd.contacts.length || null));
    if (corporate().length) nav.append(item("corporate", "Counterparties", corporate().length));
    nav.append(H("div", { class: "grp ct-grp-h" }, H("span", {}, "Groups"), H("button", { class: "quiet ct-grp-add", title: "New group", "aria-label": "New group", onclick: () => newGroup() }, "+")));
    for (const g of groups()) { const n = all().filter((c) => (g.memberIds || []).includes(c.id)).length; nav.append(H("button", { class: st.view === "group:" + g.id ? "on" : "", onclick: () => { st.view = "group:" + g.id; st.q = ""; st.sel = null; draw(); setPane("main"); }, oncontextmenu: (e) => { e.preventDefault(); SUITE.menu(e.currentTarget, [{ l: "Email the group", fn: () => groupMail(g) }, { l: "Rename", fn: () => renameGroup(g) }, { l: "Delete group", danger: 1, fn: () => deleteGroup(g) }]); } }, H("span", { class: "lbl" }, g.name), H("span", { class: "n" }, n ? String(n) : ""))); }
    if (!groups().length) nav.append(H("button", { class: "ct-grp-empty", onclick: () => newGroup() }, H("span", { class: "lbl" }, "Make a list of people…")));
    const tags = [...new Set(L.flatMap((c) => c.tags || []))].sort(); if (tags.length) { nav.append(H("div", { class: "grp" }, "Tags")); for (const t of tags) nav.append(H("button", { class: st.view === "tag:" + t ? "on" : "", onclick: () => { st.view = "tag:" + t; st.q = ""; st.sel = null; draw(); setPane("main"); } }, H("span", { class: "lbl" }, t), H("span", { class: "n" }, L.filter((c) => (c.tags || []).includes(t)).length))); }
  }
  // 4.10 · the chip filters, applied on top of the book/search on the left
  function applyFilters(list) {
    const F = SUITE.filterValue ? SUITE.filterValue("contacts") : {}; const has = Array.isArray(F.has) ? F.has : [], tags = Array.isArray(F.tag) ? F.tag : [];
    const since = F.when === "7d" ? Date.now() - 7 * 86400000 : F.when === "30d" ? Date.now() - 30 * 86400000 : 0;
    return list.filter((c) => (!F.kind || (F.kind === "company" ? isCompany(c) : !isCompany(c))) && (!F.fav || c.favorite) && (!F.book || c._book === F.book)
      && (!has.includes("phone") || (c.phones && c.phones.length)) && (!has.includes("email") || (c.emails && c.emails.length))
      && (!since || Date.parse(c.createdAt || c.addedAt || 0) >= since) && (!tags.length || tags.every((t) => (c.tags || []).includes(t))));
  }
  function countLine() { const view = st.view; const base = listFor(viewBase(view)).filter((c) => inView(c, view)); const list = applyFilters(base); const F = SUITE.filterValue ? SUITE.filterValue("contacts") : {}; const filtered = Object.keys(F).some((k) => Array.isArray(F[k]) ? F[k].length : F[k]); return filtered ? list.length + " of " + base.length + " · filtered" : list.length + (list.length === 1 ? " person" : " people") + (st.q ? " matching" : ""); }
  function drawMain() {
    main.innerHTML = ""; const view = st.view;
    const inp = H("input", { placeholder: "Search people and companies", value: st.q, oninput: (e) => { st.q = e.target.value; drawList(); } });
    main.append(H("div", { class: "nt-quick ct-quick" }, inp, H("button", { class: "quiet", title: "Search", onclick: () => inp.focus() }, SUITE.glyph("search"))));
    // 4.10 · filter chips: kind · favourites · book · tags · has phone/email · recent; they combine with the search text and the book on the left
    if (SUITE.chips) { const tagSet = new Map(); for (const c of all()) for (const t of c.tags || []) tagSet.set(t, (tagSet.get(t) || 0) + 1); const tags = [...tagSet.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([t, n]) => ({ v: t, l: t, n }));
      main.append(SUITE.chips({ key: "contacts", onChange: () => { drawList(); const sub = main.querySelector(".ct-head .nt-sub"); if (sub) sub.textContent = countLine(); }, groups: [
        { id: "kind", multi: false, options: [{ v: "person", l: "People" }, { v: "company", l: "Companies" }] },
        { id: "fav", multi: false, options: [{ v: "1", l: "Favourites" }] },
        ...(!["private", "company", "corporate"].includes(view) ? [{ id: "book", multi: false, options: [{ v: "private", l: "Private" }, ...(st.sd ? [{ v: "company", l: "Company" }] : []), ...(corporate().length ? [{ v: "corporate", l: "Counterparties" }] : [])] }] : []),
        { id: "has", multi: true, options: [{ v: "phone", l: "Has phone" }, { v: "email", l: "Has email" }] },
        { id: "when", multi: false, options: [{ v: "7d", l: "Added 7 days" }, { v: "30d", l: "Added 30 days" }] },
        ...(tags.length ? [{ id: "tag", multi: true, label: "Tags", options: tags }] : []),
      ] })); }
    const kinds = H("div", { class: "pt-kinds ct-kinds" }, H("button", { onclick: () => form() }, SUITE.glyph("plus"), H("span", {}, "New")), H("button", { onclick: () => form({ company: "" }, true) }, SUITE.glyph("bank"), H("span", {}, "Company")), H("button", { onclick: syncPhone, disabled: SUITE.host && SUITE.host.deviceContacts ? null : true, title: SUITE.host && SUITE.host.deviceContacts ? "Read the phone's address book into your private book" : "Available on the phone" }, SUITE.glyph("people"), H("span", {}, "From phone")), H("button", { onclick: () => importAny() }, SUITE.glyph("upload"), H("span", {}, "Import")));
    main.append(kinds);
    const list = listFor(viewBase(view)).filter((c) => inView(c, view));
    const title = view === "favorites" ? "Favourites" : view === "private" ? "Private" : view === "company" ? "Company book" : view === "corporate" ? "Counterparties" : view === "recent" ? "Recently added" : view.startsWith("tag:") ? view.slice(4) : view.startsWith("group:") ? ((groupById(view.slice(6)) || {}).name || "Group") : "Contacts";
    const listAud = view === "private" ? { kind: "private", text: "Only you can see your private book" } : view === "company" ? { kind: "company", app: "CONTACTS" } : view === "corporate" ? { kind: "mixed", text: "Counterparties from the company's books · everyone in " + ((typeof CLOUD !== "undefined" && CLOUD.state.orgName) || "the company") + " who has ACCOUNTING" } : view === "people" ? { kind: "swm" } : { kind: "mixed" };
    main.append(H("div", { class: "nt-head ct-head" }, H("div", { class: "nt-hd" }, H("h2", {}, title), H("div", { class: "nt-sub" }, countLine()), SUITE.visNote(listAud)), H("button", { class: "quiet nt-more", title: "More", onclick: (e) => SUITE.menu(e.currentTarget, [{ l: "Import vCard or CSV…", fn: () => importAny() }, { l: "Export…", fn: () => exportDialog() }, { sep: 1 }, { l: "Find duplicates…", fn: () => duplicatesDialog() }, { l: "New group…", fn: () => newGroup() }, ...(view.startsWith("group:") && groupById(view.slice(6)) ? [{ l: "Email the group", fn: () => groupMail(groupById(view.slice(6))) }, { l: "Rename the group", fn: () => renameGroup(groupById(view.slice(6))) }, { l: "Delete the group", danger: 1, fn: () => deleteGroup(groupById(view.slice(6))) }] : []), { sep: 1 }, { l: "How this app works", fn: () => SUITE.showHelp("contacts") }]) }, "⋯")));
    const box = H("div", { class: "ct-list" }); main.append(box); st._box = box; drawList();
  }
  function drawList() {
    const box = st._box; if (!box) return; box.innerHTML = ""; const view = st.view; const list = applyFilters(listFor(viewBase(view)).filter((c) => inView(c, view)));
    const F0 = SUITE.filterValue ? SUITE.filterValue("contacts") : {}; const isFiltered = Object.keys(F0).some((k) => Array.isArray(F0[k]) ? F0[k].length : F0[k]);
    if (!list.length) { box.append(H("div", { class: "sh-empty" }, SUITE.icon("people"), H("b", {}, st.q || isFiltered ? "Nobody matches" : "No contacts here yet"), H("div", {}, st.q || isFiltered ? "Try another name, company or number, or clear the filters." : "Add a person with New, or read the phone's address book with From phone."), isFiltered && !st.q ? SUITE.clearFiltersButton() : !st.q ? H("div", {}, H("button", { class: "primary", onclick: () => form() }, "New contact")) : null)); return; }
    // 4.9 · groups: favourites first (All, no search), then A–Z with a sticky letter; a thin A–Z index on the phone
    const groups = []; const byLetter = new Map();
    const favs = view === "all" && !st.q ? list.filter((c) => c.favorite) : [];
    if (favs.length) groups.push({ key: "★", label: "Favourites", items: favs });
    for (const c of list) { if (view === "recent") { if (!byLetter.has("")) { byLetter.set("", []); groups.push({ key: "", label: "", items: byLetter.get("") }); } byLetter.get("").push(c); continue; } let L0 = displayName(c)[0].toUpperCase(); if (!/[A-ZÆØÅÄÖÜ]/.test(L0)) L0 = "#"; if (!byLetter.has(L0)) { byLetter.set(L0, []); groups.push({ key: L0, label: L0, items: byLetter.get(L0) }); } byLetter.get(L0).push(c); }
    const row = (c) => {
      const city = c.address ? c.address.split(",").slice(-1)[0].trim() : ""; const second = isCompany(c) ? [c.title, city && !(c.title || "").toLowerCase().includes(city.toLowerCase()) ? city : null].filter(Boolean).join(" · ") : [c.title, c.company && c.company !== displayName(c) ? c.company : null].filter(Boolean).join(" · ");
      const fallback = (c.phones && c.phones[0] ? c.phones[0].v : (c.emails && c.emails[0] ? c.emails[0].v : ""));
      const r = H("div", { class: "ct-row" + (st.sel === c.id ? " on" : "") + (isCompany(c) ? " isco" : ""), "data-id": c.id, onclick: () => select(c.id), oncontextmenu: (e) => { e.preventDefault(); rowMenu(e.currentTarget, c); } },
        avatar(c),
        H("div", { class: "ct-main" }, H("div", { class: "t" }, H("span", { class: "nm" }, displayName(c)), c.favorite ? H("span", { class: "ct-fav", title: "Favourite" }, "★") : null, c._book === "people" && c._row ? SHARING.badge(c._row, { cls: "ct-bk" }) : c._book === "company" ? H("span", { class: "ct-bk sh-aud", title: "Everyone in " + orgLabel() + " who has CONTACTS sees this contact" }, "Company") : null), H("div", { class: "p" }, second || fallback)),
        H("div", { class: "ct-rq" }, c.phones && c.phones[0] ? H("button", { class: "quiet", title: "Call " + c.phones[0].v, onclick: (e) => { e.stopPropagation(); act("call", c); } }, SUITE.glyph("phone")) : null, c.emails && c.emails[0] ? H("button", { class: "quiet", title: "Email " + c.emails[0].v, onclick: (e) => { e.stopPropagation(); act("mail", c); } }, SUITE.glyph("mail")) : null));
      SUITE.swipe(r, { left: c._book === "corporate" ? [] : [{ l: "Delete", icon: "trash", cls: "danger", fn: () => remove(c) }], right: [{ l: c.favorite ? "Unstar" : "Star", icon: "star", fn: () => toggleFav(c) }, ...(c.phones && c.phones[0] ? [{ l: "Call", icon: "phone", fn: () => act("call", c) }] : [])] });
      return r;
    };
    for (const g of groups) { const sec = H("div", { class: "ct-group", "data-letter": g.key }); if (g.label) sec.append(H("div", { class: "ct-letter" }, g.label)); for (const c of g.items) sec.append(row(c)); box.append(sec); }
    if (SUITE.isMobile() && view !== "recent" && groups.length > 6) {
      const idx = H("div", { class: "ct-index", "aria-hidden": "true" }); const letters = groups.map((g) => g.key);
      for (const k of letters) idx.append(H("span", { "data-l": k }, k === "★" ? "★" : k));
      const jump = (y) => { const r = idx.getBoundingClientRect(); const i = Math.max(0, Math.min(letters.length - 1, Math.floor(((y - r.top) / r.height) * letters.length))); const sec = box.querySelector('.ct-group[data-letter="' + letters[i].replace(/"/g, "") + '"]'); if (sec) { const sc = main; const top = sec.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop - 4; sc.scrollTo({ top, behavior: "auto" }); idx.dataset.on = letters[i]; for (const el of idx.children) el.classList.toggle("on", el.dataset.l === letters[i]); } };
      idx.addEventListener("touchstart", (e) => { e.preventDefault(); jump(e.touches[0].clientY); }, { passive: false }); idx.addEventListener("touchmove", (e) => { e.preventDefault(); jump(e.touches[0].clientY); }, { passive: false }); idx.addEventListener("touchend", () => { setTimeout(() => { for (const el of idx.children) el.classList.remove("on"); }, 250); });
      idx.addEventListener("click", (e) => jump(e.clientY));
      if (st._index) st._index.remove(); root.append(idx); st._index = idx;
    } else if (st._index) { st._index.remove(); st._index = null; }
  }
  function select(id) { st.sel = id; drawList(); drawPane(); setPane("pane"); }
  function rowMenu(el, c) { SUITE.menu(el, [{ l: "Open", fn: () => select(c.id) }, c.phones && c.phones[0] ? { l: "Call " + c.phones[0].v, fn: () => act("call", c) } : null, c.emails && c.emails[0] ? { l: "Email", fn: () => act("mail", c) } : null, { sep: 1 }, { l: c.favorite ? "Remove star" : "Star", fn: () => toggleFav(c) }, { l: "Groups…", fn: () => pickGroups(c) }, c._book !== "corporate" ? { l: "Edit", fn: () => form(find(c.id), isCompany(c)) } : { l: "Open in Accounting", fn: () => openCorporate(c) }, { l: "Share…", fn: () => shareVcf(c) }, c._book === "private" && st.sd ? { l: "Move to the company book", fn: () => moveTo(find(c.id), "company") } : null, c._book === "company" ? { l: "Move to my private book", fn: () => moveTo(find(c.id), "private") } : null, { sep: 1 }, c._book !== "corporate" ? { l: "Delete", danger: 1, fn: () => remove(find(c.id)) } : null].filter(Boolean)); }

  // ---------- the card
  function drawPane() {
    pane.innerHTML = ""; const c = st.sel ? find(st.sel) : null;
    if (!c) { pane.append(H("div", { class: "sh-empty", style: "margin:40px 20px" }, SUITE.icon("people"), H("b", {}, "Nobody selected"), H("div", {}, "Pick a person on the left to see their card."))); return; }
    pane.append(card(c, { full: true }));
  }
  function card(c, opt) {
    opt = opt || {}; const book = bookOf(c) === "private" && c._book ? c._book : (c._book || bookOf(c)); const co = isCompany(c); const ro = book === "corporate";
    const el = H("div", { class: "ct-card" + (opt.full ? " full" : "") + (co ? " isco" : "") });
    const parent = co ? null : companyOf(c);
    const city = c.address ? c.address.split(",").slice(-1)[0].trim() : ""; const sub = co ? [c.title, city && !(c.title || "").toLowerCase().includes(city.toLowerCase()) ? city : null].filter(Boolean).join(" · ") : [c.title, c.company && c.company !== displayName(c) ? c.company : null].filter(Boolean).join(" · ");
    // header: avatar, name, role · company (the company is a link to its card), star and edit top right
    const tools = H("div", { class: "ct-tools" });
    if (!ro) { tools.append(H("button", { class: "quiet sh-ib" + (c.favorite ? " on" : ""), title: c.favorite ? "Remove from favourites" : "Add to favourites", "aria-label": "Favourite", onclick: () => toggleFav(find(c.id)) }, SUITE.glyph("star")), H("button", { class: "quiet ct-edit", onclick: () => form(find(c.id), co) }, "Edit")); }
    else tools.append(H("button", { class: "quiet ct-edit", onclick: () => openCorporate(c) }, "Open in Accounting"));
    el.append(H("div", { class: "ct-top" }, avatar(c, true), H("div", { class: "ct-who" }, H("h2", {}, displayName(c)), H("div", { class: "nt-sub" }, parent && !co ? [c.title ? H("span", {}, c.title + " · ") : null, H("a", { href: "#", class: "ct-colink", onclick: (e) => { e.preventDefault(); select(parent.id); } }, parent.name)] : (sub || (ro ? "Counterparty in Corporate" : book === "company" ? "Company book" : co ? "Company" : "Private contact")))), tools));
    { const r = rowOf(c); const aud = r ? (SHARING.mine(r) ? { kind: "people", names: SHARING.names(r.shared_with) } : { kind: "people", by: SHARING.nameOf(r.owner_id), names: SHARING.names((r.shared_with || []).filter((id) => id !== SHARING.me())) }) : book === "company" ? { kind: "company", app: "CONTACTS" } : ro ? { kind: "mixed", text: "A counterparty in the company's books · everyone with ACCOUNTING" } : { kind: "private" }; el.append(H("div", { class: "ct-vis", style: "padding:0 22px" }, SUITE.visNote(aud))); }
    // actions: only the ones that can do something
    const acts = H("div", { class: "pt-kinds ct-acts" }); const hasPhone = !!(c.phones && c.phones.length), hasMail = !!(c.emails && c.emails.length);
    const a = (g, l, k) => acts.append(H("button", { onclick: () => act(k, c) }, SUITE.glyph(g), H("span", {}, l)));
    if (hasPhone) a("phone", "Call", "call"); if (hasPhone || hasMail) a("send", "Message", "message"); if (hasPhone) a("whatsapp", "WhatsApp", "whatsapp"); if (hasMail) a("mail", "Email", "mail"); a("share", "Share", "share");
    el.append(acts);
    // fields, grouped; a tap acts, the copy icon copies, a long press / right click copies too
    const rows = H("div", { class: "ct-rows" });
    const copyBtn = (v) => H("button", { class: "quiet ct-copy", title: "Copy", "aria-label": "Copy", onclick: (e) => { e.stopPropagation(); SUITE.copy(v); } }, SUITE.glyph("copy"));
    const r = (k, v, onclick, extra) => { const row = H("div", { class: "ct-r" + (onclick ? " act" : ""), onclick: onclick || null, oncontextmenu: (e) => { e.preventDefault(); SUITE.copy(typeof v === "string" ? v : row.querySelector(".v").textContent); } }, H("span", { class: "k" }, k), H("span", { class: "v" }, v), extra || (typeof v === "string" ? copyBtn(v) : null)); let t = null; row.addEventListener("touchstart", () => { t = setTimeout(() => { t = null; SUITE.copy(typeof v === "string" ? v : row.querySelector(".v").textContent); }, 550); }, { passive: true }); row.addEventListener("touchend", () => { if (t) clearTimeout(t); t = null; }); row.addEventListener("touchmove", () => { if (t) clearTimeout(t); t = null; }, { passive: true }); rows.append(row); return row; };
    const group = (label) => rows.append(H("div", { class: "ct-g" }, label));
    if (c.phones && c.phones.length) { group("Phone"); for (const p of c.phones) r(p.t === "work" ? "office" : (p.t || "phone"), p.v, () => act("call", c, p.v)); }
    if (c.emails && c.emails.length) { group("Email"); for (const e of c.emails) r(e.t === "work" ? "work" : (e.t || "email"), e.v, () => act("mail", c, e.v)); }
    if (c.address) { group("Address"); r("address", c.address, () => act("map", c)); }
    if (!co && (c.company || c.title)) { group("Company"); if (c.company) r("company", parent ? H("a", { href: "#", class: "ct-colink", onclick: (e) => { e.preventDefault(); e.stopPropagation(); select(parent.id); } }, c.company) : c.company, parent ? () => select(parent.id) : (ro ? null : () => form({ name: c.company, company: c.company, kind: "company" }, true)), parent ? H("span", { class: "ct-go" }, SUITE.glyph("arrow")) : (ro ? H("span") : H("button", { class: "quiet ct-copy", title: "Create a card for " + c.company, onclick: (e) => { e.stopPropagation(); form({ name: c.company, company: c.company, kind: "company" }, true); } }, SUITE.glyph("plus")))); if (c.title) r("role", c.title); }
    if (c.birthday) { group("More"); r("birthday", SUITE.fmtDate(c.birthday)); }
    if (c.tags && c.tags.length) { if (!c.birthday) group("More"); rows.append(H("div", { class: "ct-r" }, H("span", { class: "k" }, "tags"), H("span", { class: "v" }, c.tags.map((t) => H("button", { class: "sh-tag ct-tagbtn", onclick: () => { st.view = "tag:" + t; st.q = ""; st.sel = null; draw(); setPane("main"); } }, t))))); }
    { const gs = groupsOf(c); if (gs.length || !ro) { rows.append(H("div", { class: "ct-r" }, H("span", { class: "k" }, "groups"), H("span", { class: "v" }, gs.map((g) => H("button", { class: "sh-tag ct-tagbtn", onclick: () => { st.view = "group:" + g.id; st.q = ""; st.sel = null; draw(); setPane("main"); } }, g.name)), H("button", { class: "quiet ct-grp-edit", onclick: () => pickGroups(c) }, gs.length ? "Change" : "Add to a group…")))); } }
    { const cp = cpOf(c); if (!ro && (cp || (typeof S !== "undefined" && S.store && (S.store.counterparties || []).length))) rows.append(H("div", { class: "ct-r" }, H("span", { class: "k" }, "counterparty"), H("span", { class: "v" }, cp ? H("a", { href: "#", class: "ct-colink", onclick: (e) => { e.preventDefault(); SUITE.open("accounting", { view: "counterparty", id: cp.id }); } }, cp.name) : H("span", { class: "sh-dim" }, "not linked")), H("button", { class: "quiet ct-grp-edit", onclick: () => linkCounterparty(find(c.id)) }, cp ? "Change" : "Link…"))); }
    if (c.notes) { if (!c.birthday && !(c.tags && c.tags.length)) group("More"); r("notes", c.notes); rows.lastElementChild.querySelector(".v").style.whiteSpace = "pre-wrap"; }
    if (rows.children.length) el.append(rows);
    // a company: the people who work there
    if (co) { const ppl = peopleOf(c); const sec = H("div", { class: "ct-people" }, H("h3", {}, ppl.length ? ppl.length + (ppl.length === 1 ? " person" : " people") + " at " + displayName(c) : "Nobody linked yet")); for (const x of ppl) sec.append(H("button", { class: "ct-person", onclick: () => select(x.id) }, avatar(x), H("span", { class: "nm" }, displayName(x)), H("small", {}, x.title || (x.phones && x.phones[0] ? x.phones[0].v : (x.emails && x.emails[0] ? x.emails[0].v : ""))))); if (!ro) sec.append(H("button", { class: "quiet ct-addp", onclick: () => form({ company: displayName(c), companyId: c.id }) }, SUITE.glyph("plus"), H("span", {}, "Add a person here"))); el.append(sec); }
    // where they appear: notes and events that mention them, the trades of a counterparty
    const app = appearances(c); if (app.length) { const sec = H("div", { class: "ct-appears" }, H("h3", {}, "Appears in")); for (const x of app) sec.append(H("button", { class: "ct-app", onclick: x.fn }, SUITE.glyph(x.icon), H("span", {}, x.l), H("small", {}, x.d))); el.append(sec); }
    const foot = H("div", { class: "ct-foot" });
    if (ro) foot.append(H("button", { class: "quiet", onclick: () => form({ name: displayName(c), company: c.company, phones: c.phones, emails: c.emails, address: c.address, counterpartyId: c.counterpartyId }) }, "Copy to my contacts"));
    else if (book === "people") { const row = rowOf(c.id); const own = row && SHARING.mine(row); if (own) foot.append(H("button", { class: "quiet", onclick: () => shareContact(find(c.id)) }, "Shared with " + (row.shared_with.length ? SHARING.names(row.shared_with).join(", ") : "nobody") + "…"), H("button", { class: "quiet", onclick: () => unshareContact(find(c.id)) }, "Stop sharing")); else foot.append(H("span", { class: "sh-dim", style: "font-size:11.5px" }, "Shared with you by " + SHARING.nameOf(row ? row.owner_id : null))); foot.append(H("button", { class: "quiet", onclick: () => shareVcf(c) }, "Share as vCard")); if (own) foot.append(H("button", { class: "quiet danger", onclick: () => remove(find(c.id)) }, "Delete")); }
    else { if (book === "private" && st.sd) foot.append(H("button", { class: "quiet", onclick: () => moveTo(find(c.id), "company") }, "Share with the company")); if (book === "private" && typeof SHARING !== "undefined" && SHARING.canShare()) foot.append(H("button", { class: "quiet", onclick: () => shareContact(find(c.id)) }, "Share with people…")); if (book === "company") foot.append(H("button", { class: "quiet", onclick: () => moveTo(find(c.id), "private") }, "Make private")); foot.append(H("button", { class: "quiet", onclick: () => shareVcf(c) }, "Share as vCard"), H("button", { class: "quiet danger", onclick: () => remove(find(c.id)) }, "Delete")); }
    if (c.updatedAt) foot.append(H("span", { class: "ct-when" }, "Updated " + SUITE.ago(c.updatedAt)));
    el.append(foot);
    return el;
  }
  function appearances(c) {
    const out = []; const id = c.id; const name = displayName(c).toLowerCase();
    try { const nd = SUITE.db.peek && SUITE.db.peek("notes"); if (nd) for (const p of nd.pages || []) if (!p.deletedAt && ((p.body || "").includes('data-contact="' + id + '"') || (p.body || "").toLowerCase().includes(name))) out.push({ icon: "text", l: p.title || "Untitled", d: "note · " + SUITE.ago(p.updatedAt), fn: () => SUITE.open("notes", { page: p.id }) }); } catch (e) { /* none */ }
    try { const cd = SUITE.db.peek && SUITE.db.peek("calendar"); if (cd) for (const ev of cd.events || []) if ((ev.title + " " + (ev.notes || "")).includes("data-contact=\"" + id + "\"") || (ev.title + " " + (ev.notes || "") + " " + (ev.location || "")).toLowerCase().includes(name)) out.push({ icon: "calendar", l: ev.title, d: "event · " + SUITE.fmtDate(ev.start.slice(0, 10)), fn: () => SUITE.open("calendar", { event: ev.id }) }); } catch (e) { /* none */ }
    // 4.16: sales carry customerId (not counterpartyId — 4.9–4.15 showed none); purchases (supplierId), open invoices, PROSHIP vessels and charters too
    const cid = c.counterpartyId; if (cid && typeof S !== "undefined" && S.store) { const trades = (S.store.trades || []).filter((t) => t.customerId === cid || t.counterpartyId === cid).slice(-5).reverse(); for (const t of trades) out.push({ icon: "trade", l: t.ref + (t.deliveryDate ? " · " + SUITE.fmtDate(t.deliveryDate) : ""), d: "sale · " + (t.status || ""), fn: () => SUITE.open("accounting", { view: "trade", id: t.id }) }); const cg = (S.store.cargoes || []).filter((x) => x.supplierId === cid).slice(-3).reverse(); for (const x of cg) out.push({ icon: "cargo", l: x.ref + (x.date ? " · " + SUITE.fmtDate(x.date) : ""), d: "purchase", fn: () => SUITE.open("accounting", { view: "book" }) }); const open = (S.store.invoices || []).filter((i) => i.counterpartyId === cid && (i.amount - (i.paid || 0) - (i.credited || 0)) > 0.005); if (open.length) out.push({ icon: "invoice", l: open.length + " open invoice" + (open.length > 1 ? "s" : ""), d: "receivables · " + open.map((i) => i.ref).slice(0, 3).join(", "), fn: () => SUITE.open("accounting", { view: "counterparty", id: cid }) }); }
    if (cid && typeof PS !== "undefined" && PS.data && PS.data()) { try { const d = PS.data(); const vs = (PS.vessels ? PS.vessels() : []).filter((v) => v.ownerCpId === cid); for (const v of vs.slice(0, 5)) out.push({ icon: "ship", l: v.name || "Vessel", d: "PROSHIP · owner", fn: () => { SUITE.open("proship"); setTimeout(() => PS.openVessel && PS.openVessel(v.id, "overview"), 400); } }); const fx = (d.fixtures || []).filter((f) => f.chartererCpId === cid && f.status !== "cancelled").slice(-4).reverse(); for (const f of fx) { const v = PS.vessel ? PS.vessel(f.vesselId) : null; out.push({ icon: "ship", l: ((v && v.name) || "Vessel") + " · " + (f.kind === "tc" ? "time charter" : f.kind === "voyage" ? "voyage charter" : f.kind || "charter"), d: "PROSHIP · charterer · " + (f.status || ""), fn: () => { SUITE.open("proship"); setTimeout(() => PS.openVessel && PS.openVessel(f.vesselId, "commercial"), 400); } }); } } catch (e) { /* PROSHIP not loaded */ } }
    return out.slice(0, 12);
  }
  function act(kind, c, value) {
    const phone = value || (c.phones && c.phones[0] && c.phones[0].v) || ""; const mail = value || (c.emails && c.emails[0] && c.emails[0].v) || "";
    const go = (u) => { if (SUITE.host && SUITE.host.openExternal) SUITE.host.openExternal(u); else window.open(u, "_blank"); };
    if (kind === "call" && phone) go("tel:" + normPhone(phone));
    else if (kind === "sms" && phone) go("sms:" + normPhone(phone));
    else if (kind === "whatsapp" && phone) go("https://wa.me/" + normPhone(phone).replace(/^\+/, ""));
    else if (kind === "mail" && mail) go("mailto:" + encodeURIComponent(mail));
    else if (kind === "map" && c.address) go("https://maps.google.com/?q=" + encodeURIComponent(c.address));
    else if (kind === "share") shareVcf(c);
    else if (kind === "message") { if (SUITE.apps.messages && SUITE.messagesWith) SUITE.messagesWith(c); else if (phone) go("sms:" + normPhone(phone)); else SUITE.toast("No number for " + displayName(c)); }
  }
  function openCorporate(c) { if (c.counterpartyId) SUITE.open("accounting", { view: "counterparty", id: c.counterpartyId }); else SUITE.open("accounting"); }

  // ---------- editing
  function form(c, asCompany) {
    const isNew = !c || !c.id; const v = c || {}; const co0 = asCompany != null ? !!asCompany : (!!v.id && isCompany(v)) || v.kind === "company";
    const bookOpts = [{ v: "private", l: "My private book" }].concat(st.sd ? [{ v: "company", l: "Company book — everyone in " + ((typeof CLOUD !== "undefined" && CLOUD.state.orgName) || "the company") + " sees it" }] : []);
    const ph = (t) => ((v.phones || []).find((p) => p.t === t) || {}).v || ""; const phones0 = v.phones || [];
    const mobile = ph("mobile") || (phones0[0] && !["work", "home"].includes(phones0[0].t) ? phones0[0].v : ""); const office = ph("work"); const home = ph("home") || (phones0.find((p) => !["mobile", "work", "home"].includes(p.t) && p.v !== mobile) || {}).v || "";
    const em = (v.emails || []); const email1 = em[0] ? em[0].v : "", email2 = em[1] ? em[1].v : "";
    const isCo = (x) => x.kind === "company"; const isP = (x) => x.kind !== "company";
    // 4.9 · the company field offers the companies already in the book
    const coInput = H("input", { type: "text", value: v.company || "", placeholder: "Start typing — existing companies are offered", autocomplete: "off", list: "ct-companies" });
    let dl = document.getElementById("ct-companies"); if (!dl) { dl = H("datalist", { id: "ct-companies" }); document.body.append(dl); } dl.innerHTML = ""; for (const n of companyNames()) dl.append(H("option", { value: n }));
    SUITE.form({ title: isNew ? (co0 ? "New company" : "New contact") : "Edit " + displayName(v), submitLabel: isNew ? "Add" : "Save",
      fields: [
        // the kind is a choice, never a guess that sticks: a person recognised as a company by its name can be put back here
        { k: "kind", label: "This is", type: "choice", value: co0 ? "company" : "person", options: [{ v: "person", l: "A person" }, { v: "company", l: "A company" }], wide: true },
        { type: "heading", label: "Name & company" },
        { k: "name", label: "Name", labelOf: (x) => isCo(x) ? "Company name" : "Name", value: v.name || "", placeholder: co0 ? "Nordic Bulk Carriers A/S" : "First and last name", required: true, wide: true },
        { k: "company", label: "Company", labelOf: (x) => isCo(x) ? "Short name" : "Company", type: "raw", el: coInput },
        { k: "title", label: "Role", labelOf: (x) => isCo(x) ? "What they do" : "Role", value: v.title || "", placeholder: co0 ? "Dry bulk owner, Copenhagen" : "Head of bunkers" },
        { type: "heading", label: "Phone & email" },
        { k: "phone", label: "Mobile", labelOf: (x) => isCo(x) ? "Main number" : "Mobile", value: mobile, type: "tel", placeholder: "+971 50 123 4567" },
        { k: "phone2", label: "Office", labelOf: (x) => isCo(x) ? "Second number" : "Office", value: office, type: "tel" },
        { k: "email", label: "Email", value: email1, type: "email", placeholder: "name@company.com" },
        { k: "email2", label: "Second email", value: email2, type: "email" },
        { k: "phone3", label: "Home", value: home, type: "tel", show: isP },
        { type: "heading", label: "Address" },
        { k: "address", label: "Address", value: v.address || "", wide: true, placeholder: "Street, city, country" },
        { type: "heading", label: "More" },
        { k: "birthday", label: "Birthday", value: v.birthday || "", type: "date", show: isP },
        { k: "tags", label: "Tags", value: (v.tags || []).join(", "), placeholder: "supplier, broker, bank" },
        { k: "notes", label: "Notes", value: v.notes || "", type: "textarea", wide: true },
        isNew ? { k: "book", label: "Keep in", type: "select", value: "private", options: bookOpts, allowEmpty: false } : null].filter(Boolean),
      submit: async (x) => {
        const co = x.kind === "company";
        // the slots the form shows, plus whatever the record held that the form has no slot for (an "other" number, a third email): nothing is dropped
        const slotT = ["mobile", "work", "home"]; const phones = []; if (x.phone) phones.push({ t: "mobile", v: x.phone.trim() }); if (x.phone2) phones.push({ t: "work", v: x.phone2.trim() }); if (!co && x.phone3) phones.push({ t: "home", v: x.phone3.trim() }); else if (co && home) phones.push({ t: "home", v: home });
        for (const p of phones0) if (!slotT.includes(p.t) && p.v !== mobile && p.v !== office && p.v !== home) phones.push(p);
        const emails = []; if (x.email) emails.push({ t: "work", v: x.email.trim() }); if (x.email2) emails.push({ t: "other", v: x.email2.trim() }); for (const e of em.slice(2)) emails.push(e);
        const text = (x.company || "").trim(); const link = co || !text ? null : companyOf({ company: text, id: v.id });
        const fields = { name: x.name.trim(), company: text, title: (x.title || "").trim(), phones: CT_PHONE.dedupePhones(phones), emails: CT_PHONE.dedupeEmails(emails), address: (x.address || "").trim(), birthday: co ? (v.birthday || "") : (x.birthday || ""), tags: (x.tags || "").split(",").map((t) => t.trim()).filter(Boolean), notes: x.notes || "", kind: co ? "company" : "person", companyId: link ? link.id : null, updatedAt: now() };
        if (isNew) { const toCo = x.book === "company" && st.sd; if (toCo && !(await confirmCompany(fields.name || fields.company || "this contact"))) return; const nc = { id: uid(), ...fields, favorite: false, counterpartyId: v.counterpartyId || null, createdAt: now(), source: "xyntax", by: toCo ? SUITE.userLabel() : undefined }; const target = toCo ? st.sd : D(); target.contacts.push(nc); save(nc); st.sel = nc.id; }
        else { Object.assign(c, fields); save(c); }
        draw(); if (SUITE.isMobile()) setPane("pane"); SUITE.toast(isNew ? "Added" : "Saved"); if (SUITE.host && SUITE.host.deviceContacts && (c ? c.phoneId : false)) pushToPhone(c);
      } });
  }
  function toggleFav(c) { if (!c) return; c.favorite = !c.favorite; c.updatedAt = now(); save(c); drawList(); drawPane(); }
  async function remove(c) { if (!c) return; const row = rowOf(c); if (row) { if (!SHARING.mine(row)) return SUITE.toast("Only " + SHARING.nameOf(row.owner_id) + " can delete this contact"); if (!(await SUITE.confirm("Delete " + displayName(c) + "? It disappears for everyone it is shared with.", "Delete", true))) return; clearTimeout(row._t); try { await CLOUD.sharedItems.remove(row.id); } catch (e) { return SUITE.toast("Could not delete: " + e.message); } st.sh = st.sh.filter((r) => r !== row); if (st.sel === c.id) st.sel = null; draw(); SUITE.toast("Deleted"); return; } if (!(await SUITE.confirm("Delete " + displayName(c) + "?", "Delete", true))) return; const book = bookOf(c); const arr = book === "company" ? st.sd.contacts : D().contacts; { const ai = arr.indexOf(c); if (ai >= 0) arr.splice(ai, 1); } if (st.sel === c.id) st.sel = null; book === "company" ? SUITE.db.save("shared:contacts") : SUITE.db.save("contacts"); draw(); SUITE.toast("Deleted"); }
  const orgLabel = () => (typeof CLOUD !== "undefined" && CLOUD.state.orgName) || "the company";
  const confirmCompany = (name) => SUITE.confirm({ title: "Put " + name + " in the company book?", text: "Everyone in " + orgLabel() + " who has CONTACTS will see this contact — numbers, emails, address and notes — and can edit it. Your other contacts stay private." }, "Share");
  async function moveTo(c, book, silent) { if (!c) return; if (rowOf(c)) { if (!silent) SUITE.toast("Stop sharing this contact first"); return; } if (book === "company" && !silent && !(await confirmCompany(displayName(c)))) return; const sd = st.sd || (await SUITE.db.load("shared:contacts", SDEF)); const d = D() || (await SUITE.db.load("contacts", DEF)); const from = bookOf(c) === "company" ? sd.contacts : d.contacts; const to = book === "company" ? sd.contacts : d.contacts; const i = from.indexOf(c); if (i >= 0) from.splice(i, 1); to.push(c); c.updatedAt = now(); if (book === "company") c.by = SUITE.userLabel(); SUITE.db.save("contacts"); SUITE.db.save("shared:contacts"); if (!silent) { draw(); SUITE.toast(book === "company" ? "Now in the company book" : "Now private"); } }

  // ---------- the phone's address book
  async function syncPhone() {
    if (!SUITE.host || !SUITE.host.deviceContacts) { SUITE.toast("Available on the phone"); return; }
    SUITE.toast("Reading the phone's contacts…");
    let list; try { list = await SUITE.host.deviceContacts(); } catch (e) { SUITE.toast("Could not read the phone's contacts: " + e.message); return; }
    if (!list) { SUITE.toast("No permission to read contacts"); return; }
    // 4.8.3: the phone lists a number once per account it is stored in (SIM, Google, WhatsApp…), each written its own way —
    // one entry per distinct number, and a person is matched by any of their numbers or emails, so a second sync adds nothing twice
    let added = 0, updated = 0; const findByKeys = (phones, emails) => D().contacts.find((x) => phones.some((p) => (x.phones || []).some((q) => CT_PHONE.same(q.v, p.v))) || emails.some((e) => (x.emails || []).some((q) => (q.v || "").toLowerCase() === e.v.toLowerCase())));
    for (const pc of list) {
      const phones = CT_PHONE.dedupePhones((pc.phones || []).map((v) => ({ t: v.type || "mobile", v: String(v.number || v || "").trim() })).filter((p) => p.v)); const emails = CT_PHONE.dedupeEmails((pc.emails || []).map((v) => ({ t: v.type || "work", v: v.address || v })).filter((e) => e.v)); const name = (pc.name || "").trim(); if (!name && !phones.length) continue;
      let c = D().contacts.find((x) => x.phoneId === pc.id) || findByKeys(phones, emails);
      if (c) { let changed = false; if (name && c.name !== name && !c.renamed) { c.name = name; changed = true; } const mergedP = CT_PHONE.dedupePhones((c.phones || []).concat(phones)); if (mergedP.length !== (c.phones || []).length || mergedP.some((p, i) => p !== (c.phones || [])[i])) { c.phones = mergedP; changed = true; } const mergedE = CT_PHONE.dedupeEmails((c.emails || []).concat(emails)); if (mergedE.length !== (c.emails || []).length) { c.emails = mergedE; changed = true; } if (!c.phoneId) { c.phoneId = pc.id; changed = true; } if (changed) { c.updatedAt = now(); updated++; } }
      else { D().contacts.push({ id: uid(), name: name || phones[0].v, company: pc.organization || "", title: pc.jobTitle || "", phones, emails, address: pc.address || "", tags: [], notes: "", favorite: false, createdAt: now(), updatedAt: now(), source: "phone", phoneId: pc.id }); added++; }
    }
    const repaired = repairPhones(); D().synced.at = now(); SUITE.db.save("contacts"); draw(); SUITE.toast(added + " added, " + updated + " updated from the phone" + (repaired ? ", " + repaired + " cleaned" : ""));
  }
  // one entry per number on every private card (cards imported before 4.8.3 carry each number three or four times)
  function repairPhones(all) { let n = 0; for (const c of (all ? allPrivate() : D().contacts)) { const ph = CT_PHONE.dedupePhones(c.phones || []); const em = CT_PHONE.dedupeEmails(c.emails || []); if (ph.length !== (c.phones || []).length || em.length !== (c.emails || []).length) { c.phones = ph; c.emails = em; n++; } } return n; }
  const allPrivate = () => D().contacts;
  async function pushToPhone(c) { if (!SUITE.host || !SUITE.host.deviceContactSave) return; try { await SUITE.host.deviceContactSave({ id: c.phoneId, name: displayName(c), company: c.company, jobTitle: c.title, phones: (c.phones || []).map((p) => ({ type: p.t, number: p.v })), emails: (c.emails || []).map((e) => ({ type: e.t, address: e.v })) }); } catch (e) { /* the phone said no */ } }

  // ---------- vCard and CSV: out, in (Google, Outlook, Apple, any vCard 2.1/3.0/4.0, a generic CSV with a mapping), duplicates
  const vEsc = (v) => String(v || "").replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\;");
  function vcf(c) { const n = displayName(c); const parts = n.split(/\s+/); const last = c.last || (parts.length > 1 ? parts.slice(-1)[0] : ""), first = c.first || (parts.length > 1 ? parts.slice(0, -1).join(" ") : n);
    return ["BEGIN:VCARD", "VERSION:3.0", "FN:" + vEsc(n), "N:" + vEsc(last) + ";" + vEsc(first) + ";;;", c.company ? "ORG:" + vEsc(c.company) : null, c.title ? "TITLE:" + vEsc(c.title) : null, ...(c.phones || []).map((p) => "TEL;TYPE=" + (p.t === "mobile" ? "CELL" : (p.t || "work").toUpperCase()) + ":" + p.v), ...(c.emails || []).map((e) => "EMAIL;TYPE=" + (e.t || "work").toUpperCase() + ":" + e.v), c.address ? "ADR;TYPE=WORK:;;" + vEsc(c.address) + ";;;;" : null, c.birthday ? "BDAY:" + c.birthday : null, c.url ? "URL:" + c.url : null, (c.tags || []).length ? "CATEGORIES:" + c.tags.map(vEsc).join(",") : null, c.notes ? "NOTE:" + vEsc(c.notes) : null, "REV:" + (c.updatedAt || now()), "END:VCARD"].filter(Boolean).join("\r\n"); }
  const csvCell = (v) => { v = v == null ? "" : String(v); return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  function csv(list) { const cols = ["Name", "First Name", "Last Name", "Company", "Title", "Mobile", "Phone", "Email", "Email 2", "Address", "Birthday", "Tags", "Notes"]; const rows = list.map((c) => { const n = displayName(c); const parts = n.split(/\s+/); const mob = (c.phones || []).find((p) => p.t === "mobile"); const oth = (c.phones || []).find((p) => p !== mob); return [n, c.first || (parts.length > 1 ? parts.slice(0, -1).join(" ") : n), c.last || (parts.length > 1 ? parts.slice(-1)[0] : ""), c.company || "", c.title || "", mob ? mob.v : "", oth ? oth.v : "", (c.emails || [])[0] ? c.emails[0].v : "", (c.emails || [])[1] ? c.emails[1].v : "", c.address || "", c.birthday || "", (c.tags || []).join("; "), c.notes || ""]; }); return "\uFEFF" + [cols].concat(rows).map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n"; }
  function exportable(scope) { const view = st.view; const cur = listFor(viewBase(view)).filter((c) => inView(c, view)); return (scope === "list" ? cur : all()).filter((c) => c._book !== "corporate"); }
  function exportAll() { doExport("all", "vcf"); }
  function doExport(scope, fmt) { const L = exportable(scope); if (!L.length) { SUITE.toast("Nothing to export"); return; } const name = (scope === "list" ? "contacts-" + (st.view.replace(/^tag:/, "") || "list") : "contacts") + "." + fmt; const blob = fmt === "csv" ? new Blob([csv(L)], { type: "text/csv" }) : new Blob([L.map(vcf).join("\r\n") + "\r\n"], { type: "text/vcard" }); SUITE.download(name, blob); SUITE.toast(L.length + " exported"); }
  function exportMenu(el) { const n = exportable("list").length, m = exportable("all").length; SUITE.menu(el, [{ l: "This list as vCard", d: n + " people", fn: () => doExport("list", "vcf") }, { l: "This list as CSV", fn: () => doExport("list", "csv") }, { sep: 1 }, { l: "Everything as vCard", d: m + " people", fn: () => doExport("all", "vcf") }, { l: "Everything as CSV", fn: () => doExport("all", "csv") }]); }
  async function exportDialog() { const v = await SUITE.dialog({ title: "Export contacts", fields: [{ k: "scope", label: "Which", type: "select", value: "all", options: [{ v: "all", l: "Everything (" + exportable("all").length + ")" }, { v: "list", l: "This list (" + exportable("list").length + ")" }] }, { k: "fmt", label: "As", type: "select", value: "vcf", options: [{ v: "vcf", l: "vCard (.vcf) — phones, Outlook, Google" }, { v: "csv", l: "CSV (.csv) — spreadsheets" }] }], ok: "Export" }); if (v) doExport(v.scope, v.fmt); }
  function vcfFile(c) { return new File([vcf(c) + "\r\n"], displayName(c).replace(/[^\w ]+/g, "").trim().replace(/\s+/g, "-") + ".vcf", { type: "text/vcard" }); }
  function shareVcf(c) { if (!c) return; const text = [displayName(c), c.title, c.company, ...(c.phones || []).map((p) => p.v), ...(c.emails || []).map((e) => e.v), c.address].filter(Boolean).join("\n"); if (SUITE.share) SUITE.share({ title: displayName(c), text, files: [vcfFile(c)], kind: "contact" }); else { const f = vcfFile(c); SUITE.download(f.name, f); } }
  function shareCurrent() { const c = st.sel ? find(st.sel) : null; if (!c) { SUITE.toast("Pick a person first"); return; } shareVcf(c); }

  // vCard in: unfold, split cards, decode quoted-printable and the escapes, read what we keep (photos are skipped)
  function qpDecode(v, charset) { const bytes = []; for (let i = 0; i < v.length; i++) { if (v[i] === "=" && /^[0-9A-F]{2}$/i.test(v.slice(i + 1, i + 3))) { bytes.push(parseInt(v.slice(i + 1, i + 3), 16)); i += 2; } else bytes.push(v.charCodeAt(i) & 255); } try { return new TextDecoder((charset || "utf-8").toLowerCase()).decode(new Uint8Array(bytes)); } catch (e) { return new TextDecoder().decode(new Uint8Array(bytes)); } }
  const vUnesc = (v) => String(v || "").replace(/\\n/gi, "\n").replace(/\\([,;\\])/g, "$1");
  function parseVcf(text) {
    const lines = text.replace(/\r\n?/g, "\n").replace(/\n[ \t]/g, "").split("\n"); const cards = []; let cur = null;
    for (const raw of lines) { const line = raw.trim(); if (!line) continue; if (/^BEGIN:VCARD$/i.test(line)) { cur = []; continue; } if (/^END:VCARD$/i.test(line)) { if (cur) cards.push(cur); cur = null; continue; } if (!cur) continue;
      const i = line.indexOf(":"); if (i < 0) continue; const head = line.slice(0, i), value = line.slice(i + 1); const hp = head.split(";"); let name = hp[0].toUpperCase(); if (name.includes(".")) name = name.split(".").pop(); const params = {}; for (const p of hp.slice(1)) { const eq = p.indexOf("="); const k = eq >= 0 ? p.slice(0, eq) : "TYPE", v = eq >= 0 ? p.slice(eq + 1) : p; const kk = k.toUpperCase(); params[kk] = (params[kk] ? params[kk] + "," : "") + (v || "").replace(/"/g, ""); }
      let val = value; if (/QUOTED-PRINTABLE/i.test(params.ENCODING || "")) val = qpDecode(val, params.CHARSET); if (/^(B|BASE64)$/i.test(params.ENCODING || "") || /^data:/i.test(val)) { if (name === "PHOTO" || name === "LOGO" || name === "SOUND" || name === "KEY") continue; }
      cur.push({ name, params, value: val }); }
    return cards.map((props) => { const g = (n) => props.find((p) => p.name === n); const ga = (n) => props.filter((p) => p.name === n); const typ = (p) => (p.params.TYPE || "").toUpperCase();
      const nParts = g("N") ? g("N").value.split(";").map(vUnesc) : []; const fn = g("FN") ? vUnesc(g("FN").value) : ""; const name = fn || [nParts[3], nParts[1], nParts[2], nParts[0], nParts[4]].filter(Boolean).join(" ").trim();
      const phones = ga("TEL").map((p) => ({ t: /CELL|MOBILE/.test(typ(p)) ? "mobile" : /HOME/.test(typ(p)) ? "home" : /FAX/.test(typ(p)) ? "fax" : "work", v: vUnesc(p.value).replace(/^tel:/i, "").trim() })).filter((p) => p.v);
      const emails = ga("EMAIL").map((p) => ({ t: /HOME/.test(typ(p)) ? "home" : "work", v: vUnesc(p.value).trim() })).filter((e) => e.v);
      const adr = g("ADR") ? g("ADR").value.split(";").map(vUnesc).filter(Boolean).join(", ") : ""; const org = g("ORG") ? vUnesc(g("ORG").value).split(";")[0] : "";
      const bday = g("BDAY") ? g("BDAY").value.replace(/^(\d{4})(\d{2})(\d{2})$/, "$1-$2-$3").slice(0, 10) : ""; const cats = g("CATEGORIES") ? vUnesc(g("CATEGORIES").value).split(",").map((x) => x.trim()).filter(Boolean) : [];
      if (!name && !org && !phones.length && !emails.length) return null;
      return { name: name || org || (emails[0] ? emails[0].v : phones[0].v), first: nParts[1] || "", last: nParts[0] || "", company: org, title: g("TITLE") ? vUnesc(g("TITLE").value) : "", phones, emails, address: adr, birthday: /^\d{4}-\d{2}-\d{2}$/.test(bday) ? bday : "", url: g("URL") ? g("URL").value.trim() : "", tags: cats, notes: g("NOTE") ? vUnesc(g("NOTE").value) : "", source: "vcard" }; }).filter(Boolean);
  }
  // CSV in: RFC 4180 cells, then the headers of Google (both generations), Outlook and Apple are known; anything else asks which column is what
  function parseCsv(text) { text = text.replace(/^\uFEFF/, ""); const sep = text.split("\n")[0].includes(",") ? "," : ";"; const rows = []; let row = [], cell = "", q = false; for (let i = 0; i < text.length; i++) { const ch = text[i]; if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; } else if (ch === '"') q = true; else if (ch === sep) { row.push(cell); cell = ""; } else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; } else cell += ch; } if (cell !== "" || row.length) { row.push(cell); rows.push(row); } return rows.filter((r) => r.some((c) => c.trim() !== "")); }
  const CSV_KNOWN = [
    { k: "name", any: ["Name", "Full Name", "Display Name"] }, { k: "first", any: ["Given Name", "First Name", "FirstName"] }, { k: "last", any: ["Family Name", "Last Name", "LastName", "Surname"] },
    { k: "company", any: ["Organization 1 - Name", "Organization Name", "Company", "Organisation", "Organization"] }, { k: "title", any: ["Organization 1 - Title", "Organization Title", "Job Title", "Title", "Role"] },
    { k: "email", any: ["E-mail 1 - Value", "E-mail Address", "Email", "E-mail", "Email Address", "Primary Email"] }, { k: "email2", any: ["E-mail 2 - Value", "E-mail 2 Address", "Email 2", "Secondary Email"] },
    { k: "mobile", any: ["Mobile Phone", "Mobile", "Cell Phone", "Phone 1 - Value"] }, { k: "phone", any: ["Business Phone", "Phone", "Work Phone", "Phone 2 - Value", "Home Phone", "Primary Phone", "Telephone"] },
    { k: "address", any: ["Address 1 - Formatted", "Business Address", "Address", "Home Address"] }, { k: "street", any: ["Business Street", "Address 1 - Street", "Street"] }, { k: "city", any: ["Business City", "Address 1 - City", "City"] }, { k: "zip", any: ["Business Postal Code", "Address 1 - Postal Code", "Postal Code", "ZIP"] }, { k: "country", any: ["Business Country/Region", "Address 1 - Country", "Country"] },
    { k: "birthday", any: ["Birthday", "Birth Date"] }, { k: "tags", any: ["Labels", "Group Membership", "Categories", "Tags"] }, { k: "notes", any: ["Notes", "Note"] }];
  const norm = (h) => String(h || "").trim().toLowerCase().replace(/\s+/g, " ");
  function csvAutoMap(headers) { const map = {}; const hn = headers.map(norm); for (const f of CSV_KNOWN) { for (const a of f.any) { const i = hn.indexOf(norm(a)); if (i >= 0 && !Object.values(map).includes(i)) { map[f.k] = i; break; } } } return map; }
  function csvToContacts(rows, map) { const out = []; const at = (r, k) => map[k] == null ? "" : String(r[map[k]] || "").trim(); for (const r of rows.slice(1)) { if (!r.some((c) => c && c.trim())) continue;
      const first = at(r, "first"), last = at(r, "last"); const name = at(r, "name") || [first, last].filter(Boolean).join(" ").trim(); const company = at(r, "company"); const phones = [];
      if (at(r, "mobile")) phones.push({ t: "mobile", v: at(r, "mobile") }); if (at(r, "phone")) phones.push({ t: "work", v: at(r, "phone") }); const emails = [at(r, "email"), at(r, "email2")].filter(Boolean).map((v) => ({ t: "work", v }));
      const address = at(r, "address") || [at(r, "street"), [at(r, "zip"), at(r, "city")].filter(Boolean).join(" "), at(r, "country")].filter(Boolean).join(", "); const tags = at(r, "tags").split(/\s:::\s|:::|[;,]/).map((t) => t.replace(/^\*\s*/, "").trim()).filter((t) => t && !/^myContacts$|^starred$/i.test(t));
      if (!name && !company && !phones.length && !emails.length) continue; const bd = at(r, "birthday").replace(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/, (m, a, b, y) => y + "-" + b.padStart(2, "0") + "-" + a.padStart(2, "0"));
      out.push({ name: name || company || (emails[0] ? emails[0].v : phones[0].v), first, last, company, title: at(r, "title"), phones, emails, address, birthday: /^\d{4}-\d{2}-\d{2}$/.test(bd) ? bd : "", tags, notes: at(r, "notes"), source: "csv" }); } return out; }
  async function askMapping(headers) { const opts = [{ v: "", l: "—" }].concat(headers.map((h, i) => ({ v: String(i), l: h }))); const auto = csvAutoMap(headers); const F = [["name", "Full name"], ["first", "First name"], ["last", "Last name"], ["company", "Company"], ["title", "Role"], ["email", "Email"], ["mobile", "Mobile"], ["phone", "Phone"], ["address", "Address"], ["notes", "Notes"]];
    const v = await SUITE.dialog({ title: "Which column is what?", text: "This file's headers are not ones XYNTAX knows. Say which column holds what; the rest is ignored.", fields: F.map(([k, l]) => ({ k, label: l, type: "select", value: auto[k] != null ? String(auto[k]) : "", options: opts })), ok: "Import" }); if (!v) return null; const map = {}; for (const [k] of F) if (v[k] !== "") map[k] = +v[k]; return map; }
  function importMenu(el) { SUITE.menu(el, [{ l: "vCard (.vcf)…", d: "from a phone, Outlook, Apple, Google", fn: () => importAny("vcf") }, { l: "CSV (.csv)…", d: "Google or Outlook export, or any spreadsheet", fn: () => importAny("csv") }]); }
  async function importVcf() { return importAny("vcf"); }
  async function parseFiles(files) { let incoming = []; for (const f of files) { const text = await f.text(); if (/BEGIN:VCARD/i.test(text)) incoming = incoming.concat(parseVcf(text)); else { const rows = parseCsv(text); if (rows.length < 2) continue; let map = csvAutoMap(rows[0]); const known = ["name", "first", "last", "email", "mobile", "phone"].some((k) => map[k] != null); if (!known) { map = await askMapping(rows[0]); if (!map) return null; } incoming = incoming.concat(csvToContacts(rows, map)); } } return incoming; }
  async function importAny(kind) {
    const files = await SUITE.pickFiles({ accept: kind === "vcf" ? ".vcf,text/vcard" : kind === "csv" ? ".csv,text/csv" : ".vcf,.csv,text/vcard,text/csv" }); if (!files || !files.length) return;
    const incoming = await parseFiles(files); if (incoming === null) return;
    if (!incoming.length) { SUITE.toast("No contacts found in " + (files.length === 1 ? files[0].name : "those files")); return; }
    return importContacts(incoming);
  }
  // the same door for every source: pick the book, decide about the look-alikes, then write once
  async function importContacts(incoming) {
    const target0 = st.view === "company" && st.sd ? "company" : "private"; const keyOf = (c) => [...(c.emails || []).map((e) => "e:" + e.v.toLowerCase()), ...(c.phones || []).map((p) => "p:" + normPhone(p.v))].filter((k) => k.length > 3);
    const books = { private: D().contacts, company: st.sd ? st.sd.contacts : null }; const existingIndex = (book) => { const m = new Map(); for (const c of books[book] || []) for (const k of keyOf(c)) m.set(k, c); return m; };
    const dupCount = (book) => { const idx = existingIndex(book); return incoming.filter((c) => keyOf(c).some((k) => idx.has(k))).length; };
    const fields = [books.company ? { k: "book", label: "Into", type: "select", value: target0, options: [{ v: "private", l: "My private book" }, { v: "company", l: "Company book — everyone in " + ((typeof CLOUD !== "undefined" && CLOUD.state.orgName) || "the company") + " sees it" }] } : null, { k: "dups", label: "People already in the book (same email or number)", type: "select", value: "merge", options: [{ v: "merge", l: "Merge: add new numbers, emails and details to the existing card" }, { v: "skip", l: "Skip them" }, { v: "add", l: "Add anyway, as a second card" }] }].filter(Boolean);
    const v = await SUITE.dialog({ title: "Import " + incoming.length + (incoming.length === 1 ? " contact" : " contacts"), text: dupCount(target0) ? dupCount(target0) + " of them look like people already in the book." : "", fields, ok: "Import" }); if (!v) return;
    const book = v.book || "private"; const arr = books[book] || books.private; const idx = existingIndex(book); let added = 0, merged = 0, skipped = 0;
    for (const inc of incoming) { const ex = keyOf(inc).map((k) => idx.get(k)).find(Boolean);
      if (ex && v.dups === "skip") { skipped++; continue; }
      if (ex && v.dups === "merge") { let ch = false; for (const p of inc.phones || []) if (!(ex.phones || []).some((q) => normPhone(q.v) === normPhone(p.v))) { ex.phones = (ex.phones || []).concat([p]); ch = true; } for (const e of inc.emails || []) if (!(ex.emails || []).some((q) => q.v.toLowerCase() === e.v.toLowerCase())) { ex.emails = (ex.emails || []).concat([e]); ch = true; } for (const k of ["company", "title", "address", "birthday", "url", "notes"]) if (inc[k] && !ex[k]) { ex[k] = inc[k]; ch = true; } const nt = (inc.tags || []).filter((t) => !(ex.tags || []).includes(t)); if (nt.length) { ex.tags = (ex.tags || []).concat(nt); ch = true; } if (ch) { ex.updatedAt = now(); merged++; } else skipped++; continue; }
      const nc = { id: uid(), name: inc.name, company: inc.company || "", title: inc.title || "", phones: inc.phones || [], emails: inc.emails || [], address: inc.address || "", tags: inc.tags || [], notes: inc.notes || "", favorite: false, createdAt: now(), updatedAt: now(), source: inc.source || "import" }; if (inc.first) nc.first = inc.first; if (inc.last) nc.last = inc.last; if (inc.birthday) nc.birthday = inc.birthday; if (inc.url) nc.url = inc.url; arr.push(nc); for (const k of keyOf(nc)) idx.set(k, nc); added++; }
    SUITE.db.save(book === "company" ? "shared:contacts" : "contacts"); draw(); SUITE.toast(added + " added" + (merged ? ", " + merged + " merged" : "") + (skipped ? ", " + skipped + " skipped" : ""));
    return { added, merged, skipped };
  }

  // ---------- for the other apps: lookup, the chip, the card as a popover, suggestions while typing
  function peek() { if (st.data) return all(); try { const d = SUITE.db.peek && SUITE.db.peek("contacts"); const sd = SUITE.db.peek && SUITE.db.peek("shared:contacts"); return (d ? d.contacts.map((c) => ({ ...c, _book: "private" })) : []).concat(sd ? sd.contacts.map((c) => ({ ...c, _book: "company" })) : [], corporate().map((c) => ({ ...c, _book: "corporate" }))); } catch (e) { return corporate(); } }
  function suggest(text) { const q = (text || "").trim().toLowerCase(); if (q.length < 3) return []; const L = peek(); const out = []; for (const c of L) { const n = displayName(c).toLowerCase(); const co = (c.company || "").toLowerCase(); const words = n.split(/\s+/); if (n.startsWith(q) || words.some((w) => w.startsWith(q) && q.length >= 3) || (co && co.startsWith(q))) out.push(c); if (out.length >= 5) break; } return out; }
  function chipHtml(c) { return '<a class="ct-mention" data-contact="' + esc(c.id) + '" contenteditable="false">' + esc(displayName(c)) + "</a>"; }
  // 4.31.22 · a tagged contact clicked (or tapped) in a note, an event or a mail: a small card — name, role · company, phone, email — with
  // "Open in Contacts". The contacts are read on demand when CONTACTS has not been opened yet in this session (before, that was "not found"
  // and the click looked dead); the full card (groups, sharing, appearances) stays in CONTACTS.
  function miniCard(c, box) {
    const co = isCompany(c); const sub = [c.title, !co && c.company && c.company !== displayName(c) ? c.company : null].filter(Boolean).join(" · ");
    const line = (k, v, fn) => H("div", { class: "ct-mr" }, H("span", { class: "k" }, k), fn ? H("button", { type: "button", class: "quiet v", title: v, onclick: () => { fn(); } }, v) : H("span", { class: "v" }, v), H("button", { type: "button", class: "quiet ct-copy", title: "Copy", "aria-label": "Copy " + k, onclick: (e) => { e.stopPropagation(); SUITE.copy(v); } }, SUITE.glyph("copy")));
    const el = H("div", { class: "ct-mini", role: "dialog", "aria-label": displayName(c) }, H("div", { class: "ct-mtop" }, avatar(c), H("div", { class: "ct-who" }, H("b", {}, displayName(c)), sub ? H("div", { class: "nt-sub" }, sub) : null)));
    for (const p of (c.phones || []).slice(0, 2)) el.append(line(p.t === "work" ? "office" : (p.t || "phone"), p.v, () => act("call", c, p.v)));
    for (const e of (c.emails || []).slice(0, 2)) el.append(line(e.t || "email", e.v, () => act("mail", c, e.v)));
    if (!(c.phones || []).length && !(c.emails || []).length) el.append(H("div", { class: "ct-mr dim" }, "No phone or email on the card yet"));
    el.append(H("div", { class: "ct-mfoot" }, H("button", { type: "button", class: "primary", onclick: () => { box.remove(); SUITE.open("contacts", { id: c.id }); } }, c._book === "corporate" ? "Open in Accounting" : "Open in Contacts")));
    if (c._book === "corporate") el.lastChild.firstChild.onclick = () => { box.remove(); try { openCorporate(c); } catch (e) { SUITE.open("contacts", { id: c.id }); } };
    return el;
  }
  const lookup = (id) => { try { return (st.data ? find(id) : null) || peek().find((x) => x.id === id) || null; } catch (e) { return null; } };
  async function cardPopover(id, anchor) {
    let c = lookup(id); let box = document.getElementById("shcard"); if (box) box.remove();
    if (!c && !st.data) { try { await SUITE.db.load("contacts", DEF); if (SUITE.db.sharedOk && SUITE.db.sharedOk()) await SUITE.db.load("shared:contacts", SDEF).catch(() => null); } catch (e) { /* locked or offline: said below */ } c = lookup(id); }
    if (!c) { SUITE.toast("That contact is no longer in your books"); return; }
    box = H("div", { id: "shcard", class: "mini" }); box.append(H("button", { class: "quiet ct-x", "aria-label": "Close", onclick: () => box.remove() }, "✕"), miniCard(c, box)); document.body.append(box);
    const r = anchor && anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : { left: 20, bottom: 80, top: 60 }; const W = Math.min(320, window.innerWidth - 24); box.style.width = W + "px"; const left = Math.min(window.innerWidth - W - 12, Math.max(12, r.left)); box.style.left = left + "px"; const h = Math.min(box.offsetHeight || 240, window.innerHeight - 24); box.style.top = (r.bottom + 8 + h > window.innerHeight ? Math.max(12, r.top - h - 8) : r.bottom + 8) + "px";
    const openedAt = Date.now(); const done = () => { box.remove(); document.removeEventListener("mousedown", off, true); document.removeEventListener("touchstart", off, true); document.removeEventListener("keydown", key, true); };
    const off = (e) => { if (Date.now() - openedAt < 300) return; if (!box.contains(e.target)) done(); }; const key = (e) => { if (e.key === "Escape" && box.isConnected) { e.stopPropagation(); done(); } };
    setTimeout(() => { document.addEventListener("mousedown", off, true); document.addEventListener("touchstart", off, true); document.addEventListener("keydown", key, true); }, 0);
    return box;
  }
  // a text field or an editable area watches what is typed; when the last word(s) match a contact, a small chip offers the link
  function attachSuggest(el, opt) {
    opt = opt || {}; let bubble = null; let last = ""; const kill = () => { if (bubble) { bubble.remove(); bubble = null; } };
    const currentWord = () => { if (el.isContentEditable) { const sel = window.getSelection(); if (!sel.rangeCount || !sel.isCollapsed) return null; const r = sel.getRangeAt(0); const node = r.startContainer; if (node.nodeType !== 3) return null; const text = node.textContent.slice(0, r.startOffset); const m = /([A-Za-zÀ-ÿ][\w'&.-]*(?:\s+[A-Za-zÀ-ÿ][\w'&.-]*){0,2})$/.exec(text); return m ? { text: m[1], node, end: r.startOffset } : null; } const text = el.value.slice(0, el.selectionStart); const m = /([A-Za-zÀ-ÿ][\w'&.-]*(?:\s+[A-Za-zÀ-ÿ][\w'&.-]*){0,2})$/.exec(text); return m ? { text: m[1], end: el.selectionStart } : null; };
    const show = () => { let w = currentWord(); if (!w) { kill(); last = ""; return; } if (w.text === last && bubble) return; let hits = []; const words = w.text.split(/\s+/); for (let k = words.length; k >= 1 && !hits.length; k--) { const t = words.slice(words.length - k).join(" "); hits = suggest(t); if (hits.length) w = { ...w, text: t }; } hits = hits.filter((c) => displayName(c).toLowerCase() !== w.text.toLowerCase() || el.isContentEditable); if (!hits.length) { kill(); last = ""; return; } last = w.text; kill(); bubble = H("div", { class: "ct-suggest" }, hits.slice(0, 3).map((c) => H("button", { onmousedown: (e) => e.preventDefault(), onclick: () => apply(c, w) }, H("span", { class: "ct-av" }, initials(c)), H("span", {}, displayName(c)), c.company && c.company !== displayName(c) ? H("small", {}, c.company) : null))); document.body.append(bubble); place(); };
    const place = () => { if (!bubble) return; let r; if (el.isContentEditable) { const sel = window.getSelection(); if (sel.rangeCount) { const rr = sel.getRangeAt(0).cloneRange(); rr.collapse(true); r = rr.getBoundingClientRect(); if (!r.width && !r.height) r = el.getBoundingClientRect(); } else r = el.getBoundingClientRect(); } else r = el.getBoundingClientRect(); const W = bubble.offsetWidth || 260; bubble.style.left = Math.min(window.innerWidth - W - 8, Math.max(8, r.left)) + "px"; bubble.style.top = (r.bottom + 6 + (bubble.offsetHeight || 40) > window.innerHeight ? r.top - (bubble.offsetHeight || 40) - 6 : r.bottom + 6) + "px"; };
    const apply = (c, w) => { kill(); last = ""; if (el.isContentEditable) { const sel = window.getSelection(); const r = document.createRange(); r.setStart(w.node, w.end - w.text.length); r.setEnd(w.node, w.end); sel.removeAllRanges(); sel.addRange(r); document.execCommand("insertHTML", false, chipHtml(c) + "&nbsp;"); } else { const v = el.value; el.value = v.slice(0, w.end - w.text.length) + displayName(c) + v.slice(w.end); el.dispatchEvent(new Event("input", { bubbles: true })); } if (opt.onPick) opt.onPick(c); el.dispatchEvent(new Event("input", { bubbles: true })); };
    el.addEventListener("input", () => setTimeout(show, 0)); el.addEventListener("keyup", (e) => { if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) setTimeout(show, 0); });
    el.addEventListener("keydown", (e) => { if (!bubble) return; if (e.key === "Escape") { kill(); e.stopPropagation(); } if (e.key === "Tab" || (e.key === "Enter" && !el.isContentEditable)) { const b = bubble.querySelector("button"); if (b) { e.preventDefault(); b.click(); } } });
    el.addEventListener("blur", () => setTimeout(kill, 150));
    el.addEventListener("click", (e) => { const chip = e.target.closest(".ct-mention"); if (chip) { e.preventDefault(); e.stopPropagation(); cardPopover(chip.dataset.contact, chip); } });
  }
  document.addEventListener("click", (e) => { const chip = e.target.closest(".ct-mention"); if (chip && !e.defaultPrevented) { e.preventDefault(); cardPopover(chip.dataset.contact, chip); } });

  const summary = () => { const d = SUITE.db.peek && SUITE.db.peek("contacts"); const n = d ? d.contacts.length : 0; return n ? n + (n === 1 ? " contact" : " contacts") : "People you deal with"; };
  // 4.10 · one contact, named people
  async function shareContact(c) {
    if (!c) return; const row = rowOf(c); const ids = await SHARING.pick(row ? row.shared_with : [], { app: "contacts", title: "Share " + displayName(c) + " with people", subtitle: "they see the contact in their list and can edit it; only you decide who, and only you can stop sharing" }); if (ids == null) return;
    try { if (row) await SHARING.setPeople(row, ids); else { const nr = await SHARING.share("contacts", c, ids); const arr = bookOf(c) === "company" ? st.sd.contacts : D().contacts; const i = arr.indexOf(c); if (i >= 0) arr.splice(i, 1); st.sh.push(nr); await SUITE.db.save(arr === D().contacts ? "contacts" : "shared:contacts", true); } draw(); SUITE.toast(ids.length ? "Shared with " + ids.length + (ids.length === 1 ? " person" : " people") : "Shared with nobody yet"); } catch (e) { SUITE.toast(e.message); }
  }
  async function unshareContact(c, silent) {
    const row = rowOf(c); if (!row || !SHARING.mine(row)) return; clearTimeout(row._t); const d = D() || (await SUITE.db.load("contacts", DEF)); d.contacts = d.contacts || [];
    let data = null; try { const fresh = await CLOUD.sharedItems.get(row.id); data = fresh && fresh.data ? fresh.data : row.data; } catch (e) { data = row.data; }
    d.contacts.push(data);
    try { await SUITE.db.pull("contacts").catch(() => false); if (!d.contacts.includes(data)) d.contacts.push(data); await SUITE.db.save("contacts", true); } catch (e) { const i = d.contacts.indexOf(data); if (i >= 0) d.contacts.splice(i, 1); SUITE.toast("Could not take the contact back: " + e.message); return; }
    try { await CLOUD.sharedItems.remove(row.id); } catch (e) { const i = d.contacts.indexOf(data); if (i >= 0) d.contacts.splice(i, 1); SUITE.db.save("contacts", true); SUITE.toast("Could not stop sharing: " + e.message); return; }
    st.sh = (st.sh || []).filter((r) => r !== row); if (!silent) { draw(); SUITE.toast("Private again"); }
  }
  async function sharedByMe() {
    if (!SUITE.db.sharedOk()) return []; let sd; try { sd = await SUITE.db.load("shared:contacts", SDEF); } catch (e) { return []; }
    const mine = SUITE.userLabel(); const out = (sd.contacts || []).filter((c) => !c.by || c.by === mine).map((c) => ({ id: c.id, name: displayName(c), kind: c.company && c.company !== displayName(c) ? c.company : "contact", audience: "company", path: "CONTACTS › Company book", unshare: () => moveTo(c, "private", true) }));
    if (typeof SHARING !== "undefined" && SHARING.on()) { const rows = await SHARING.list("contacts", { fresh: true }); for (const r of rows.filter((x) => SHARING.mine(x))) out.push({ id: r.id, name: displayName(r.data), kind: "contact", path: "CONTACTS", ...SHARING.audience(r), unshare: async () => { if (!st.data) { try { st.data = await SUITE.db.load("contacts", DEF); st.data.contacts = st.data.contacts || []; } catch (e) { throw new Error("Contacts are locked — open CONTACTS first"); } } if (!(st.sh || []).some((x) => x.id === r.id)) (st.sh = st.sh || []).push(r); await unshareContact(r.data, true); } }); }
    return out;
  }
  if (typeof CLOUD !== "undefined" && CLOUD.onChange) CLOUD.onChange("shared_items", (d) => { if (!root || !root.isConnected || !st.data || (d.row && d.row.app && d.row.app !== "contacts")) return; clearTimeout(st._rtT); st._rtT = setTimeout(async () => { if (await pullRows().catch(() => false) && !document.querySelector("#shdlg.open, #sheet.open")) draw(); }, 250); });
  const help = () => [["Private and Company", "New contacts go to your private book: stored under your account, sealed with your passphrase, invisible to colleagues and administrators — this includes everything imported from your phone. A contact becomes visible only when you choose the Company book (in the form, or Share with the company on the card), which asks first and marks it Company; everyone in the company with CONTACTS then sees and can edit it. Make private takes it back. Settings → Security & privacy → Shared by me lists everything you share."], ["Two books", "Private is yours alone and sealed with your other personal data. The Company book is shared with everyone in the workspace. Counterparties come from Accounting and are read-only here."], ["The card", "Call, Message, Email and WhatsApp from the strip; tap a number or an address to use it. Appears in lists the notes, events and trades the person is part of."], ["While you type", "In a note or an event, start typing a name or a company: a small chip offers the contact. Tap it and the name becomes a link that opens the card."], ["From phone", "Reads the phone's address book into your private book and keeps the two in step on the next sync. Nothing leaves the phone except into your own sealed book."], ["Favourites", "Star people you call often; they get their own list and the right-swipe on a row."], ["In and out", "Import a vCard (.vcf) from any phone or mail program, or a CSV from Google or Outlook; people already in the book are merged, not doubled. Export a list or everything as vCard or CSV. Share… sends one card into a conversation, by email, or to another app."]];
  // the suite-wide search: name, company, email, phone
  async function search(q) { const L = st.data ? all() : peek(); return L.filter((c) => matches(c, q)).slice(0, 8).map((c) => ({ l: displayName(c), d: [c.title, c.company && c.company !== displayName(c) ? c.company : null, (c.emails || [])[0] ? c.emails[0].v : ((c.phones || [])[0] ? c.phones[0].v : null)].filter(Boolean).join(" · "), fn: () => SUITE.open("contacts", { id: c.id }) })); }
  // 4.17 G · n new contact
  function onKey(e) { if (e.ctrlKey || e.metaKey || e.altKey) return; if (e.key === "n") { e.preventDefault(); form(); } }
  SUITE.register("contacts", { onKey, sharedByMe, mount, unmount, refresh, onEsc, onBack, summary, help, search, shareCurrent, reminders, defaults: DEF, open(opt) { if (!opt) return; const go = () => { if (opt.newContact) form(opt.prefill || undefined); else if (opt.id) select(opt.id); }; if (st.data) go(); else { const t = setInterval(() => { if (st.data) { clearInterval(t); go(); } }, 100); setTimeout(() => clearInterval(t), 6000); } } });
  SUITE.contacts = { find, peek, suggest, card: cardPopover, chipHtml, attachSuggest, displayName, initials, act, form: (c) => form(c), importContacts, parseVcf, parseCsv, vcf, share: shareVcf };
})();
