/* XYNTAX 1.0 — bootstrap and frame rendering */
function applyTheme() { if (typeof THEME !== "undefined") THEME.apply(); } // 4.10: the theme lives in theme.js (dark · light · system)
function setTheme(m) { if (typeof THEME !== "undefined") THEME.set(m); }
// ---------- the suite: dashboard after sign-in; the accounting app is one of its tiles
function setupSuite() {
  if (typeof SUITE === "undefined") return;
  SUITE.host = {
    mobile: false, toast,
    form(o) { sheet.open(o); if (o.footer) { const f = $("#sheet .sfoot"); if (f) { f.innerHTML = ""; f.append(h("button", { onclick: () => sheet.close() }, "Close"), ...o.footer); } } },
    closeForm() { sheet.close(); },
    onHome() { const a = $("#inspector"); if (a) a.classList.remove("open"); try { sheet.closeAll(); } catch (e) { /* none open */ } },
    setTheme, signOut() { if (typeof CLOUD !== "undefined") CLOUD.logout(); location.reload(); },
    switchCompany() { SUITE.switchCompany(); },
    openAccounting(opt) { if (opt && opt.view === "trade" && opt.id) { S.fileId = opt.id; S.view = "trade"; } else if (opt && opt.view === "counterparty") { S.view = "counterparties"; } else if (opt && opt.view) S.view = opt.view; S.renderPending = false; render(); if (opt && opt.id && opt.view !== "trade") { try { inspect(opt.view === "counterparty" ? "cp" : opt.view, opt.id); } catch (e) { /* the inspector takes what it knows */ } } },
    accountingAvailable() { return !S.ownerConsole && !S.personal && (typeof CLOUD === "undefined" || !CLOUD.signedIn() || CLOUD.active()); },
    fxFetch: window.xyntax && window.xyntax.fxFetch ? async () => { const r = await window.xyntax.fxFetch(); if (!r.ok) throw new Error(r.error || "no rates"); return r.table; } : null,
    updateCheck: window.xyntax && window.xyntax.updateCheck ? async () => { const r = await window.xyntax.updateCheck(); if (r.available) { if (confirm("Version " + r.version + " is downloading. Restart into it now? What waits is saved first.")) { if (window.UPD) await window.UPD.restart(); else await window.xyntax.updateInstall(); return "Installing " + r.version; } return "Version " + r.version + " is downloading; it installs when XYNTAX restarts"; } if (r.reason && /latest(-mac)?\.yml[\s\S]*404|HttpError: 404/.test(r.reason)) return "A new version is being assembled right now (its installers are still uploading) — check again in a few minutes."; return r.reason ? "Update check: " + r.reason : "You have the latest version (" + r.version + ")"; } : null,
    async saveFile(name, blob) { if (!window.xyntax) { const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; a.click(); return true; } const p = await window.xyntax.saveBytes(name, new Uint8Array(await blob.arrayBuffer())); if (p) toast("Saved " + p); return !!p; },
    openExternal(u) { if (window.xyntax && window.xyntax.openExternal) window.xyntax.openExternal(u); else window.open(u, "_blank"); },
    fetchText: window.xyntax && window.xyntax.fetchText ? (u) => window.xyntax.fetchText(u).then((r) => { if (!r.ok) throw new Error(r.error || "Could not fetch"); return r.text; }) : null,
    openNative: window.xyntax && window.xyntax.vaultOpen ? async (item, blob) => { const r = await window.xyntax.vaultOpen(item.id, item.name, new Uint8Array(await blob.arrayBuffer())); if (r && r.error) throw new Error(r.error); } : null,
    // 4.9 · drag a file out of DOCUMENTS into another program; dragInfo tells a drop handler that a dropped file is one of ours (a move, not an upload)
    dragOut: window.xyntax && window.xyntax.dragOut ? async (id, name, blob) => { const r = await window.xyntax.dragOut(String(id), name, new Uint8Array(await blob.arrayBuffer())); if (r && r.error) throw new Error(r.error); return true; } : null,
    dragInfo: window.xyntax && window.xyntax.dragIdFor ? (file) => window.xyntax.dragIdFor(file) : null,
    onShared: (item) => (SUITE.receiveShared ? SUITE.receiveShared(item) : false),
    openBlob: window.xyntax && window.xyntax.vaultOpen ? async (name, blob, mime) => { await window.xyntax.vaultOpen("tmp-" + Date.now(), name, new Uint8Array(await blob.arrayBuffer())); } : null,
    mail: window.xyntax && window.xyntax.mailCompose ? async (m) => { const r = await window.xyntax.mailCompose(m.name, m.bytes, null, m.subject, m.body + (m.to ? "\n\nTo: " + m.to : ""), (localStorage.getItem("xyntax.mailApp") || "default")); if (r && r.error) throw new Error(r.error); } : null,
  };
  if (window.PHONE_HOST) Object.assign(SUITE.host, window.PHONE_HOST(SUITE.host));
  if (window.WEB_HOST) Object.assign(SUITE.host, window.WEB_HOST(SUITE.host));
  if (window.xyntax && window.xyntax.onVaultChanged) window.xyntax.onVaultChanged((p) => { if (SUITE.host.onNativeChanged) SUITE.host.onNativeChanged(p); });
  const sb = $("#suiteBtn"); if (sb) sb.onclick = () => SUITE.showHome();
  if (!SUITE._ver) SUITE._ver = "4.17";
  const bb = $("#brandBtn"); if (bb) bb.onclick = () => SUITE.showHome();
}
// a quiet notice when a colleague records a payment, a receipt or a new trade (Settings → Notifications → Activity)
function bookActivity(before, after) {
  try { if (typeof SUITE === "undefined" || !SUITE.prefs.get().activity || !before) return; const me = currentUser(); const ids = (list) => new Set((list || []).map((x) => x.id));
    const newPays = (after.payments || []).filter((p) => !ids(before.payments).has(p.id) && p.by !== me); for (const p of newPays.slice(0, 3)) { const inv = (after.invoices || []).find((i) => i.id === p.invoiceId); const bill = (after.bills || []).find((b) => b.id === p.billId); SUITE.notify((p.kind === "receipt" || inv ? "Receipt recorded" : "Payment recorded") + (p.by ? " by " + p.by : ""), (inv ? inv.ref + " · " : bill ? bill.ref + " · " : "") + (typeof fmtMoney === "function" ? fmtMoney(p.amount, p.currency) : p.amount), "pay-" + p.id); }
    const newTrades = (after.trades || []).filter((t) => !ids(before.trades).has(t.id) && t.createdBy !== me); for (const t of newTrades.slice(0, 3)) SUITE.notify("New trade " + (t.ref || ""), (t.createdBy ? "by " + t.createdBy + " · " : "") + (nm.cp ? nm.cp(t.counterpartyId) : ""), "trade-" + t.id);
  } catch (e) { /* notifications are best effort */ }
}
// 4.10.2 · at boot the accounting desk is not drawn behind the home (its full render is the longest task on a phone);
// `renderLater()` marks it pending and the first open of ACCOUNTING — or the next render() — draws it
function renderLater() { S.renderPending = true; if (typeof SUITE !== "undefined" && SUITE.whenIdle) SUITE.whenIdle(() => { if (S.renderPending) { S.renderPending = false; try { render(); } catch (e) { /* drawn on open */ } } }, 1500); }
// 4.34.5 · between "Sign in" and the home there is the first load of the company (its book, who you are). The sign-in card used to
// close first, and the page underneath — this file's own Accounting frame, still empty — stood there until the load was done.
// Now a loading screen (the wordmark and a quiet line) covers that time, in the theme's own colours; it goes when the home is drawn.
function loading(on) { let el = document.getElementById("xload"); if (!on) { if (el) { el.id = ""; el.classList.add("gone"); setTimeout(() => el.remove(), 300); } return; } if (el) return; el = h("div", { id: "xload", class: "xload", role: "status", "aria-live": "polite", "aria-label": "Loading" }, h("div", { class: "ld-w" }, typeof SUITE !== "undefined" && SUITE.wordmark ? SUITE.wordmark() : "XYNTAX"), h("div", { class: "ld-l", "aria-hidden": "true" })); document.body.append(el); }
window.xyntaxLoading = loading;
function showSuiteHome() { if (typeof SUITE === "undefined") return; SUITE.showHome(); loading(false); if (SUITE.idle) SUITE.idle(); { const b = document.getElementById("boot"); if (b) { b.classList.add("gone"); setTimeout(() => b.remove(), 400); } } const p = SUITE.prefs.get(); document.documentElement.classList.toggle("sh-dense", !!p.dense); if (p.startOn === "last" && p.lastApp && !S._startedOnce) { S._startedOnce = true; const a = SUITE.app(p.lastApp); if (a && SUITE.allowed(a.id)) SUITE.open(a.id); } }
function renderStatus() {}
function renderStatus() {
  const el = $("#status"); if (!el) return; el.innerHTML = ""; const save = $("#saveState");
  if (typeof CLOUD === "undefined" || !CLOUD.active()) { el.className = ""; if (save) save.style.display = ""; return; }
  if (save) save.style.display = "none"; const on = CLOUD.state.online; el.className = on ? "online" : "offline";
  const tip = h("div", { class: "tip" }, on ? "Online: connected to the company workspace. You have the latest data, every change is saved to the workspace at once and reaches your colleagues within seconds." : ["Offline: not connected to the company workspace. You can keep working; changes made now stay on this computer and will not reach the workspace until the connection is back.", CLOUD.state.lastError ? h("div", { class: "neg" }, CLOUD.state.lastError) : null, h("div", { style: "margin-top:8px" }, h("button", { class: "primary", onclick: async (e) => { e.stopPropagation(); const btn = e.currentTarget; btn.disabled = true; btn.textContent = "Reconnecting…"; const ok = await CLOUD.reconnect(); if (!ok) { btn.disabled = false; btn.textContent = "Try again"; toast("Could not reconnect: " + CLOUD.state.lastError); } } }, "Reconnect"))]);
  el.append(h("i"), on ? "Online" : "Offline", tip);
  el.onclick = null;
}
function renderEntityPicker(st) {
  const box = $("#entityPick"); if (!box) return; box.innerHTML = "";
  S.syncEntities(); const sel = S.entSel(); const label = !sel ? "All entities" : sel.length === 0 ? "No entities" : sel.length === 1 ? nm.entity(sel[0]) : sel.length + " of " + st.entities.length + " entities";
  const btn = h("button", { class: "epick", onclick: (e) => { e.stopPropagation(); S.entPickOpen = !S.entPickOpen; pop.classList.toggle("open", S.entPickOpen); } }, label, h("span", { class: "car" }, "▾"));
  const pop = h("div", { class: "epop" + (S.entPickOpen ? " open" : ""), onclick: (e) => e.stopPropagation() });
  const apply = () => { S.syncEntities(); render(); };
  pop.append(h("div", { class: "row", style: "justify-content:space-between;padding:4px 8px 8px" }, h("button", { class: "quiet", onclick: () => { S.entitiesAll = true; apply(); } }, "All"), h("button", { class: "quiet", onclick: () => { S.entitiesAll = false; S.entities = []; apply(); } }, "None")));
  for (const e of st.entities) { const on = S.entities.includes(e.id); pop.append(h("label", { class: "eitem" }, h("input", { type: "checkbox", checked: on ? "" : null, onchange: (ev) => { const set = new Set(S.entities); if (ev.target.checked) set.add(e.id); else set.delete(e.id); S.entities = [...set]; S.entitiesAll = S.entities.length === st.entities.length; apply(); } }), h("span", {}, e.name), h("span", { class: "faint" }, e.currency))); }
  if (!st.entities.length) pop.append(h("div", { class: "dim", style: "padding:8px" }, "No entities yet."));
  box.append(btn, pop);
  if (!S._pickListener) { S._pickListener = true; document.addEventListener("click", (ev) => { const bx = $("#entityPick"); if (bx && !bx.contains(ev.target) && S.entPickOpen) { S.entPickOpen = false; const pp = bx.querySelector(".epop"); if (pp) pp.classList.remove("open"); } }); }
}
function render() { S.renderPending = false;
  if (!document.querySelector("#home.open") && !document.querySelector("#sapp.open")) document.body.dataset.app = "accounting";
  if (S.store) S.syncEntities();
  const st = S.store;
  // rail
  const rail = $("#rail"); rail.innerHTML = "";
  const counts = { book: st.trades.filter((t) => inEntity(t) && t.status === "agreed").length, counterparties: st.counterparties.length, vessels: st.vessels.length, entities: st.entities.length, futures: st.futuresTrades.filter((f) => inEntity(f) && f.exit == null).length, finance: st.invoices.filter((i) => inEntity(i) && E.docStatus(i) === "overdue").length, compliance: [...st.counterparties.map((c) => E.complianceStatus(st, "counterparty", c.id).state), ...st.vessels.map((v) => E.complianceStatus(st, "vessel", v.id).state)].filter((s) => s !== "clear").length };
  const adminOn = typeof CLOUD !== "undefined" && (CLOUD.isAdmin() || S.ownerConsole);
  let grp = null; VIEWS.filter((v) => v.id !== "admin" && !S.ownerConsole).forEach((v) => { if (v.grp !== grp) { grp = v.grp; if (grp === "System") rail.append(h("div", { class: "spacer" })); rail.append(h("div", { class: "grp" }, grp)); } rail.append(h("button", { class: v.id === S.view || (S.view === "trade" && v.id === "book") || ((S.view === "recon" || S.view === "bankfile") && v.id === "finance") ? "active" : "", title: v.hint, onclick: () => { S.view = v.id; render(); } }, v.label, counts[v.id] ? h("span", { class: "n" }, counts[v.id]) : null)); });
  rail.append(h("div", { class: "foot" }, typeof CLOUD !== "undefined" && S.ownerConsole ? "Software owner" : typeof CLOUD !== "undefined" && CLOUD.active() ? [CLOUD.state.orgName || "", typeof SUITE !== "undefined" && SUITE.canSwitch() ? h("div", {}, h("a", { href: "#", onclick: (e) => { e.preventDefault(); SUITE.switchCompany(); } }, "Switch company")) : null] : "", h("div", { class: "ver" }, "XYNTAX " + ((typeof SUITE !== "undefined" && SUITE._ver) || ""))));
  renderTabs(counts); { const ep = $("#entityPick"), right = $("header.cmd .right"); if (ep && right && ep.parentElement !== right) right.prepend(ep); }
  // entity filter
  renderEntityPicker(st); renderStatus(); const tb = $("#themeBtn"); if (tb) tb.remove(); const sb = $("#suiteBtn"); if (sb && typeof SUITE !== "undefined" && !sb.innerHTML) { sb.append(SUITE.icon("home"), h("span", {}, "Suite")); }
  // main
  if (S.net) { S.net.stop(); S.net = null; }
  const main = $("#main"); const top = main.scrollTop;
  const ae = document.activeElement; const keep = ae && ae.tagName === "INPUT" && main.contains(ae) ? { ph: ae.placeholder, pos: ae.selectionStart } : null;
  // the command line sits at the top of the page on the desktop (under the band, like the fields of the other apps) and in the band on the phone
  const cw = $(".cmdwrap"); E.invalidate(S.store); main.innerHTML = "";
  if (cw) { main.append(cw); const ci = cw.querySelector("#cmd"); if (ci) ci.placeholder = isPhone() ? "Type a command or search" : typeof WORKFLOW !== "undefined" && WORKFLOW.model() === "shipping" ? "Type a command or search — invoice hire · pay hire · pay bunkers · find <charterer or vessel> · file TRD-0001 · ? for help" : "Type a command or search — sell 1500 vlsfo to nordic at 569 · buy 5000 hsfo from frp at 441 · find meridian · ? for help"; }
  try { if (!st.entities.length && !S.ownerConsole && typeof companySetup === "function" && ["desk", "book", "finance", "reports", "futures", "network", "trade", "recon", "bankfile"].includes(S.view || "desk")) companySetup(main); /* 4.17: no entity → set the company up first */ else (views[S.view] || views.desk)(main); if (S.view === "data") bookStorePanel(main); } catch (e) { main.append(h("div", { class: "neg" }, "This view hit an error: " + e.message)); console.error(e); }
  if (S.lastView !== S.view && S.sel && ["preview", "bank"].includes(S.sel.type)) { S.sel = null; S.preview = null; }
  if (S.lastView !== S.view && S.sel && S.view !== "trade" && S.lastView != null) { S.sel = null; }
  if (isPhone()) for (const t of main.querySelectorAll("table.t")) { if (t.closest(".tscroll")) continue; const w = h("div", { class: "tscroll" }); t.replaceWith(w); w.append(t); }
  main.scrollTop = S.lastView === S.view ? top : 0; S.lastView = S.view; addExpanders(main);
  if (keep) { const el = Array.from(main.querySelectorAll("input")).find((i) => i.placeholder === keep.ph); if (el) { el.focus(); try { el.setSelectionRange(keep.pos, keep.pos); } catch (e) { /* not a text input */ } } }
  renderInspector(); highlightSel(); renderStatus();
}

// the phone's bottom bar for the accounting app — the same five keys as every other app: Menu (its sections) · Search · Home · New · More
const isPhone = () => document.body.classList.contains("phone") || window.innerWidth < 760;
function renderTabs(counts) {
  let bar = $("#mtabs"); if (!isPhone()) { if (bar) bar.remove(); const mb = $("header.cmd .sh-menubtn"); if (mb) mb.remove(); return; }
  if (!bar) { bar = h("nav", { id: "mtabs", class: "sh-tabs" }); $("#app").append(bar); } bar.innerHTML = "";
  const SI = typeof SUITE !== "undefined" ? (n) => (SUITE.PT && SUITE.PT[n] ? SUITE.glyph(n) : SUITE.icon(n)) : () => null;
  const tab = (icon, label, fn, on, cls) => h("button", { class: (on ? "on" : "") + (cls ? " " + cls : ""), onclick: fn }, SI(icon), h("span", {}, label));
  const show = (id) => { S.view = id; S.sel = null; render(); };
  const viewOf = (id) => id === "trade" ? "book" : ["recon", "bankfile"].includes(id) ? "finance" : id;
  // Menu: the sections of the app, grouped as in the rail, the current one marked
  const menu = (e) => { const items = []; let grp = null; for (const v of VIEWS.filter((v) => v.id !== "admin")) { if (v.grp !== grp) { grp = v.grp; if (items.length) items.push({ sep: 1 }); } items.push({ l: v.label, d: counts && counts[v.id] ? String(counts[v.id]) : "", on: viewOf(S.view) === v.id, fn: () => show(v.id) }); } SUITE.menu(e.currentTarget, items); };
  const search = () => { const ci = $("#cmd"); if (ci) { ci.focus(); ci.select && ci.select(); ci.scrollIntoView && ci.scrollIntoView({ block: "nearest" }); } };
  const canEdit = typeof CLOUD === "undefined" || !CLOUD.active() || CLOUD.canEdit();
  const prim = typeof WORKFLOW !== "undefined" ? WORKFLOW.primary() : { l: "New trade", run: () => forms.trade({}) };
  const more = (e) => { const items = []; if (canEdit) { if (typeof WORKFLOW === "undefined" || WORKFLOW.has("cargo")) items.push({ l: typeof WORKFLOW !== "undefined" ? WORKFLOW.label("buy") : "Purchase cargo", fn: () => forms.cargo({}) }); const sec = typeof WORKFLOW !== "undefined" && WORKFLOW.secondary ? WORKFLOW.secondary() : null; if (sec) items.push({ l: sec.l, fn: sec.run }, { l: "Pay bunkers", fn: () => forms.expense({ category: "Bunkers", memo: "Bunkers" }) }, { l: "Pay broker", fn: () => forms.expense({ category: "Brokerage", memo: "Brokerage" }) }); items.push({ l: "Receive money", fn: () => forms.bankTx(undefined, "in") }, { l: "Pay", fn: () => forms.bankTx(undefined, "out") }, { sep: 1 }); }
    items.push({ l: "Help and commands", fn: () => show("help") }); if (typeof SUITE !== "undefined" && SUITE.canSwitch()) items.push({ l: "Switch company…", fn: () => SUITE.switchCompany() }); if (typeof SUITE !== "undefined" && SUITE.lockNow) items.push({ sep: 1 }, { l: "Lock", fn: () => SUITE.lockNow() }); SUITE.menu(e.currentTarget, items); };
  bar.append(tab("list", "Menu", menu, false), tab("search", "Search", search, false), tab("tiles", "Home", () => (typeof SUITE !== "undefined" ? SUITE.showHome() : null), false, "homekey"), tab("plus", "New", () => { if (!canEdit) { toast("Your role is read-only"); return; } prim.run(); }, false, "newkey"), tab("more", "More", more, false));
  // the band's ☰ opens the same sections menu where the suite apps have theirs
  let mb = $("header.cmd .sh-menubtn"); if (!mb && typeof SUITE !== "undefined") { mb = h("button", { class: "quiet sh-menubtn", title: "Menu" }, SUITE.icon("menu")); const br = $("header.cmd .brand"); if (br) br.before(mb); } if (mb) mb.onclick = menu;
}

const TERMS_VERSION = "2026-10";
function showLogin(orgs, mode) {
  const box = $("#login"); box.innerHTML = ""; box.classList.add("open"); loading(false); { const b = document.getElementById("boot"); if (b) { b.classList.add("gone"); setTimeout(() => b.remove(), 400); } } const cfg = CLOUD.cfg() || {};
  const err = h("div", { class: "neg", style: "min-height:18px" }); const busy = (btn, label) => { btn.disabled = true; btn.innerHTML = ""; btn.append(h("span", { class: "spin" }), label); };
  const field = (type, ph, extra) => h("input", { type, placeholder: ph, autocapitalize: "off", autocorrect: "off", spellcheck: "false", autocomplete: type === "password" ? "current-password" : "username", ...(type === "text" ? { inputmode: "email", enterkeyhint: "next" } : { enterkeyhint: "go" }), ...(extra || {}) });
  // 4.8.3 · the accounts this device signed in with before (usernames only, never passwords): one tap fills the field
  const RECENT = "xyntax.recentAccounts"; const recent = () => { try { return JSON.parse(localStorage.getItem(RECENT) || "[]").filter((x) => typeof x === "string" && x); } catch (e) { return []; } };
  const remember = (u) => { u = String(u || "").trim(); if (!u) return; try { localStorage.setItem(RECENT, JSON.stringify([u, ...recent().filter((x) => x.toLowerCase() !== u.toLowerCase())].slice(0, 5))); } catch (e) { /* storage full or blocked */ } };
  const forgetRecent = (u) => { try { localStorage.setItem(RECENT, JSON.stringify(recent().filter((x) => x !== u))); } catch (e) { /* idem */ } };
  // after sign-in: one company → open it; several → choose; none → the personal dashboard
  // the card closes onto the loading screen, never onto the empty frame; the screen goes when the home is drawn (or the start failed)
  const start = async (boot) => { loading(true); box.classList.remove("open"); try { await boot(); } finally { loading(false); } };
  const enter = async (list) => { loading(true); try { if (!list.length) list = await CLOUD.myOrgs().catch(() => list); } catch (e) { /* the list as it is */ } if (!list.length && CLOUD.state.isOwner) { await start(bootOwnerConsole); return; } if (list.length === 1) { CLOUD.chooseOrg(list[0]); await start(bootCloud); } else if (list.length > 1) showLogin(list); else { CLOUD.chooseOrg(null); await start(bootPersonal); } };
  if (orgs) { box.append(h("div", { class: "card" }, h("h2", {}, "Choose a company"), orgs.map((o) => h("button", { class: "primary", style: "display:block;width:100%;margin-bottom:6px", onclick: async () => { CLOUD.chooseOrg(o); await start(bootCloud); } }, o.name + " · " + o.role)), h("button", { class: "quiet", style: "width:100%;margin-top:4px", onclick: async () => { CLOUD.chooseOrg(null); await start(bootPersonal); } }, "Just my own apps"))); return; }
  if (mode === "forgot") {
    const email = field("email", "Email", { autocomplete: "email" });
    box.append(h("div", { class: "card" }, h("div", { class: "brand lg-brand", style: "margin-bottom:14px" }, (typeof SUITE !== "undefined" && SUITE.wordmark ? SUITE.wordmark() : "XYNTAX")), h("h2", {}, "Reset your password"), h("div", { class: "dim" }, "We email you a link to set a new one. Your encrypted apps keep their own passphrase — this does not reset that."), email, err, h("button", { class: "primary", onclick: async () => { err.textContent = ""; try { await CLOUD.recoverPassword(email.value); err.className = "dim"; err.textContent = "Sent, if an account exists for that address."; } catch (e) { err.textContent = e.message; } } }, "Send link"), h("button", { class: "quiet", onclick: () => showLogin() }, "Back"))); setTimeout(() => email.focus(), 50); return;
  }
  if (mode === "setpassword") {
    const pw = field("password", "New password (at least 10 characters)", { autocomplete: "new-password" }), pw2 = field("password", "Again", { autocomplete: "new-password" });
    box.append(h("div", { class: "card" }, h("div", { class: "brand lg-brand", style: "margin-bottom:14px" }, (typeof SUITE !== "undefined" && SUITE.wordmark ? SUITE.wordmark() : "XYNTAX")), h("h2", {}, "Set your password"), h("div", { class: "dim" }, "You arrived through an email link. Choose the password you will sign in with."), pw, pw2, err, h("button", { class: "primary", onclick: async () => { err.textContent = ""; if (pw.value.length < 10) return (err.textContent = "Ten characters at least"); if (pw.value !== pw2.value) return (err.textContent = "The passwords differ"); try { await CLOUD.setPassword(pw.value); localStorage.setItem("xyntax.firstRun", (CLOUD.session() || {}).user_id || "1"); await CLOUD.whoami(); await enter(await CLOUD.myOrgs()); } catch (e) { err.textContent = e.message; } } }, "Save and continue"))); setTimeout(() => pw.focus(), 50); return;
  }
  const known = recent(); const email = field("text", "Email or username", { value: CLOUD.shown((CLOUD.session() || {}).email || "") || known[0] || "" }), pw = field("password", "Password");
  // the password field with a show/hide eye, so a long password can be checked before Sign in
  const eye = h("button", { type: "button", class: "lg-eye", title: "Show password", "aria-label": "Show password", onclick: () => { const show = pw.type === "password"; pw.type = show ? "text" : "password"; eye.title = eye.ariaLabel = show ? "Hide password" : "Show password"; eye.classList.toggle("on", show); pw.focus(); } }, typeof SUITE !== "undefined" && SUITE.icon ? SUITE.icon("eye") : "👁");
  const pwWrap = h("div", { class: "lg-pw" }, pw, eye);
  const go2 = async () => { err.textContent = ""; const btn = box.querySelector("button.primary"); busy(btn, "Signing in…"); email.disabled = pw.disabled = true; try { const list = await CLOUD.login(email.value.trim(), pw.value); remember(email.value.trim()); await enter(list); } catch (e) { loading(false); err.textContent = e.message; btn.disabled = false; btn.textContent = "Sign in"; email.disabled = pw.disabled = false; } };
  // one tap per remembered account: fills the username and puts the cursor in the password
  const chips = known.length ? h("div", { class: "lg-recent" }, known.map((u) => h("button", { type: "button", class: "lg-chip" + (u === email.value ? " on" : ""), onclick: () => { email.value = u; for (const c of chips.querySelectorAll(".lg-chip")) c.classList.toggle("on", c.dataset.u === u); pw.focus(); }, "data-u": u }, h("span", { class: "lg-av" }, (u[0] || "?").toUpperCase()), h("span", { class: "lg-u" }, u), h("span", { class: "lg-x", title: "Forget this account on this device", onclick: (e) => { e.stopPropagation(); forgetRecent(u); showLogin(null); } }, "×")))) : null;
  email.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); pw.focus(); } });
  box.append(h("div", { class: "card" }, h("div", { class: "brand lg-brand", style: "margin-bottom:14px" }, (typeof SUITE !== "undefined" && SUITE.wordmark ? SUITE.wordmark() : "XYNTAX")), h("h2", {}, "Sign in"), cfg.baked ? null : h("div", { class: "dim", style: "margin-bottom:10px" }, "Workspace at " + (cfg.url || "").replace(/^https?:\/\//, "")), chips, email, pwWrap, err, h("div", { class: "row", style: "justify-content:space-between;margin-top:6px" }, h("a", { href: "#", class: "faint", onclick: (e) => { e.preventDefault(); showLogin(null, "forgot"); } }, "Forgot password?"), h("button", { class: "primary", onclick: go2 }, "Sign in")), window.xyntax ? h("a", { href: "#", class: "faint", style: "font-size:11px;text-align:center;margin-top:6px", onclick: async (e) => { e.preventDefault(); err.textContent = ""; const r = await window.xyntax.updateCheck(); if (r.available) { if (confirm("Version " + r.version + " is available. Download it now?")) window.xyntax.updateInstall(); } else err.textContent = r.error ? "Could not check: " + r.error : "You have the latest version."; } }, "Check for updates") : null));
  pw.addEventListener("keydown", (e) => { if (e.key === "Enter") go2(); }); setTimeout(() => (email.value ? pw : email).focus(), 50);
}
// what the account function says about this account: suspended accounts read and export but write nothing; terms once per version
function accountState(me) {
  if (!me || typeof SUITE === "undefined") return; CLOUD.state.suspended = !!me.suspended;
  // 4.7: a locked account or company shows the lock screen and nothing else; the poll keeps watching
  if (typeof SECURITY !== "undefined") { SECURITY.startPoll(); if (SECURITY.handle(me)) return; }
  if (me.suspended) { let bar = document.getElementById("shsusp"); if (!bar) { bar = h("div", { id: "shsusp", class: "sh-banner" }, h("b", {}, "This account is suspended."), " It is read-only after a report was upheld: you can still open, export and delete your data (Settings → Security and privacy). ", h("a", { href: "#", onclick: (e) => { e.preventDefault(); SUITE.open("settings", { view: "security" }); } }, "Open Settings")); document.body.append(bar); } return; }
  if (!me.accepted_terms_at || (me.terms_version && me.terms_version < TERMS_VERSION)) { if (localStorage.getItem("xyntax.termsAsked") === TERMS_VERSION + ":" + me.user_id) return; localStorage.setItem("xyntax.termsAsked", TERMS_VERSION + ":" + me.user_id); setTimeout(() => SUITE.dialog({ must: true, title: me.accepted_terms_at ? "Updated terms" : "Terms of service", text: "XYNTAX is offered under its terms of service, acceptable-use policy and privacy policy (version " + TERMS_VERSION + "), published on the website. In short: your content is encrypted and the service cannot read it; you may not use it for anything unlawful or to harm others; reports are reviewed and accounts can be suspended; a lost passphrase and recovery key means lost content.", ok: "I accept", cancel: "Later" }).then((v) => { if (v) CLOUD.account("accept_terms", { version: TERMS_VERSION }).catch(() => {}); if (!me.accepted_terms_at && me.fresh) offerPassphrase(me); }), 1200); }
}
// an account made by the owner or an administrator never saw the sign-up: on its first sign-in it still chooses the passphrase and
// takes its recovery key (4.6) — right after accepting the terms, when the account function says the account is fresh (never seen
// before). Older accounts are not interrupted; they switch encryption on from Settings → Security when they wish.
async function offerPassphrase(me) {
  if (!me || !me.user_id || typeof SUITE === "undefined") return; const k = "xyntax.e2eOffered:" + me.user_id; if (localStorage.getItem(k)) return;
  try { if (await SUITE.e2e.enabled()) { localStorage.setItem(k, "1"); return; } } catch (e) { return; }
  localStorage.setItem(k, "1"); localStorage.setItem("xyntax.firstRun", me.user_id); firstRun();
}
// signed in without a company: the personal apps, and the door to create or join one
async function bootPersonal() {
  S.store = E.migrate(E.newStore()); S.personal = true; $("#saveState").textContent = ""; render(); showSuiteHome();
  CLOUD.realtime.start();
  try { const me = await CLOUD.me(); accountState(me); if (me.invitations && me.invitations.length) SUITE.toast("You are invited to " + ((me.invitations[0].orgs || {}).name || "a company") + " — accept it in Settings → Companies"); } catch (e) { /* the account function is not deployed yet; the personal apps still work */ }
  firstRun();
}
// the first time on this account: encryption on, with a passphrase and a recovery key
async function firstRun() {
  const flag = localStorage.getItem("xyntax.firstRun"); if (!flag || typeof SUITE === "undefined") return; if (flag !== "1" && flag !== (CLOUD.session() || {}).user_id) return; localStorage.removeItem("xyntax.firstRun");
  if (await SUITE.e2e.enabled()) return;
  const v = await SUITE.dialog({ must: true, title: "Welcome — choose your passphrase", text: "Your notes, wealth, calendar and contacts are encrypted on your device before they are saved, under a passphrase only you know. We cannot read them and we cannot reset this: if you forget the passphrase and lose the recovery key shown next, the data is gone.", fields: [{ k: "a", label: "Passphrase (at least 8 characters)", type: "password" }, { k: "b", label: "Repeat", type: "password" }], ok: "Encrypt my apps", cancel: "Later", validate: (x) => { if (!x.a || x.a.length < 8) throw new Error("At least 8 characters"); if (x.a !== x.b) throw new Error("They differ"); } });
  if (!v) { SUITE.toast("You can switch encryption on any time in Settings → Security"); return; }
  try { const R = await SUITE.e2e.enable(v.a); await SUITE.e2e.showRecoveryKey(R); SUITE.toast("Encryption is on"); } catch (e) { SUITE.toast("Could not enable: " + e.message); }
}
async function bootOwnerConsole() { S.store = E.migrate(E.newStore()); S.ownerConsole = true; S.view = "admin"; $("#saveState").textContent = "owner"; render(); showSuiteHome(); CLOUD.realtime.start(); CLOUD.me().then(accountState).catch(() => {}); }
async function bootCloud() {
  SUITE.perf.start("boot cloud");
  const meP = CLOUD.me().catch(() => null); // 4.8: in flight while the book loads, not after it
  // 4.10.2 · the book this device saw last opens the home at once; the workspace copy is fetched meanwhile and swapped in
  // only when its version is ahead (the same path the poll uses). No round trip stands between the tap and the home.
  const org = (CLOUD.session() || {}).org_id; const bookKey = "book." + org;
  if (typeof BOOKDB !== "undefined" && BOOKDB.enabledFor(org)) return bootRows(org, meP, bookKey);
  let cached = null; try { cached = await SUITE.kv.get(bookKey); } catch (e) { cached = null; }
  if (cached && cached.data && cached.data.entities && typeof cached.v === "number") {
    S.store = E.migrate(cached.data); CLOUD.state.version = cached.v; E.setUser(S.store, currentUser()); $("#saveState").textContent = "synced"; renderLater(); showSuiteHome(); SUITE.perf.end("boot cloud", { note: "home from the device copy, v" + cached.v }); firstRun(); meP.then((me) => { if (me) accountState(me); });
    const v0 = cached.v;
    (async () => { try { const fresh = await CLOUD.load(); if (fresh && CLOUD.state.version > v0) { const before = S.store; S.store = E.migrate(fresh); E.setUser(S.store, currentUser()); render(); if (document.querySelector("#home.open")) SUITE.tileRefresh("accounting"); bookActivity(before, S.store); SUITE.perf.mark("book refreshed from the workspace, v" + CLOUD.state.version); SUITE.kv.set(bookKey, { v: CLOUD.state.version, data: fresh }).catch(() => {}); } else if (fresh) SUITE.perf.mark("book up to date (v" + v0 + ")"); } catch (e) { /* offline: the device copy stands; the poll retries */ } })();
    startBookPolling(bookKey); return;
  }
  try { let loaded = await CLOUD.load(); if ((!loaded || !loaded.entities) && localStorage.getItem("xyntax.seedCloud")) { const local = window.xyntax ? await window.xyntax.load() : (() => { try { return JSON.parse(localStorage.getItem("xyntax") || "null"); } catch (e) { return null; } })(); if (local && local.entities) { loaded = local; toast("Uploading this computer's book to the cloud…"); } } localStorage.removeItem("xyntax.seedCloud"); S.store = E.migrate(loaded && loaded.entities ? loaded : E.newStore()); if (loaded && CLOUD.state.version === 0 && loaded.entities) { try { await CLOUD.save(S.store); } catch (e) { toast("First upload failed: " + e.message); } } $("#saveState").textContent = "synced"; }
  catch (e) { toast("Cloud: " + e.message + " — working locally"); return bootLocal(); }
  E.setUser(S.store, currentUser()); renderLater(); showSuiteHome(); SUITE.perf.end("boot cloud", { note: "home after the first book load, v" + CLOUD.state.version }); firstRun(); meP.then((me) => { if (me) accountState(me); });
  if (S.store && S.store.entities) SUITE.kv.set(bookKey, { v: CLOUD.state.version, data: S.store }).catch(() => {});
  startBookPolling(bookKey);
}
function startBookPolling(bookKey) {
  CLOUD.startPolling(async (v) => { try {
    // 4.16: on the row store the poll only pulls what changed; the rows merge into the open store (hookRemote), nothing is replaced
    if (typeof CLOUD.book !== "undefined" && CLOUD.book.rowsMode && CLOUD.book.rowsMode()) { await BOOKDB.sync(); return; }
    const fresh = await CLOUD.load(); if (fresh) { const before = S.store; S.store = E.migrate(fresh); render(); toast("Book updated from the cloud (version " + v + ")"); bookActivity(before, S.store); SUITE.kv.set(bookKey, { v: CLOUD.state.version, data: fresh }).catch(() => {}); } } catch (e) { /* next poll */ } });
}
// ---------- 4.16 · the book as rows: boot from the device copy, merge colleagues' rows in place, the owner's way back to the document
async function bootRows(org, meP, bookKey) {
  try {
    const loaded = await CLOUD.load(); // BOOKDB.load: the device copy at once, the workspace's changes merged as they arrive
    S.store = E.migrate(loaded && loaded.entities ? loaded : E.newStore()); E.setUser(S.store, currentUser()); $("#saveState").textContent = "synced"; renderLater(); showSuiteHome();
    const c = BOOKDB.state.counts; SUITE.perf.end("boot cloud", { note: c.__total ? "home from the row store: " + c.__total + " rows, device copy in " + BOOKDB.state.loadMs + " ms" + (BOOKDB.state.migrated ? " (migrated from the document)" : "") : "home with an empty book" });
    firstRun(); meP.then((me) => { if (me) accountState(me); });
    try { SUITE.kv.del(bookKey).catch(() => {}); } catch (e) { /* no old copy */ }
    hookRemote(); startBookPolling(bookKey);
  } catch (e) { toast("Cloud: " + e.message + " — working locally"); return bootLocal(); }
}
let remoteTimer = null; const remoteKinds = new Set(); let remoteHooked = false;
function hookRemote() {
  if (remoteHooked || typeof BOOKDB === "undefined") return; remoteHooked = true;
  // a change made offline that the workspace refuses when it comes back (the period was closed meanwhile): dropped, and said so
  // 4.31.3 · a company switch: what waits goes to the old company first; the book of the new one is loaded before anything is saved to it
  window.addEventListener("org-will-change", () => { if (S.dirty && persist.rows()) { clearTimeout(S.saveTimer); persist.save(S.store).then(() => { S.dirty = false; }).catch(() => {}); } });
  window.addEventListener("org-change", (ev) => { const to = ev && ev.detail ? ev.detail.to : null; clearTimeout(S.saveTimer); S.dirty = false; if (!to || !BOOKDB.enabledFor(to)) return; BOOKDB.load({ orgId: to }).then((store) => { if ((CLOUD.session() || {}).org_id !== to) return; S.store = E.migrate(store && store.entities ? store : E.newStore()); S.sel = null; E.setUser(S.store, currentUser()); renderLater(); }).catch((e) => toast("Could not load the books of this company: " + e.message)); });
  document.addEventListener("xyntax:book-refused", (ev) => { const m = String((ev.detail && ev.detail.message) || "").replace(/^Could not save the books:\s*/i, "").replace(/^(locked|immutable|read only):\s*/i, ""); toast("Not saved (made while offline): " + m); });
  BOOKDB.onRemote((ch) => {
    // 4.31.4 · a full reload replaces the store (an open sheet is redrawn when the app is idle)
    if (ch && ch.all) { if ((CLOUD.session() || {}).org_id !== BOOKDB.state.orgId) return; S.store = E.migrate(ch.store && ch.store.entities ? ch.store : E.newStore()); E.setUser(S.store, currentUser()); S.syncEntities && S.syncEntities(); const busy = document.querySelector("#sheet.open") || document.querySelector("#shdlg.open"); if (busy) renderLater(); else render(); if (document.querySelector("#home.open") && typeof SUITE !== "undefined" && SUITE.tileRefresh) SUITE.tileRefresh("accounting"); return; }
    if (!S.store || !ch) return; if (!BOOKDB.mergeInto(S.store, ch)) return; remoteKinds.add(ch.kind);
    clearTimeout(remoteTimer); remoteTimer = setTimeout(() => {
      const kinds = [...remoteKinds]; remoteKinds.clear(); E.invalidate(S.store); S.syncEntities && S.syncEntities();
      // an open sheet or dialog is never disturbed: the page behind it is redrawn when the app is idle instead
      const busy = document.querySelector("#sheet.open") || document.querySelector("#shdlg.open") || document.getElementById("shmenu");
      if (document.body.dataset.app === "accounting" && !document.querySelector("#home.open") && !document.querySelector("#sapp.open")) { if (busy) renderLater(); else render(); } else renderLater();
      if (document.querySelector("#home.open") && typeof SUITE !== "undefined" && SUITE.tileRefresh) SUITE.tileRefresh("accounting");
      if (!S.dirty) $("#saveState").textContent = "synced";
      try { document.dispatchEvent(new CustomEvent("xyntax:remote", { detail: { kinds } })); } catch (e) { /* nothing */ }
    }, 250);
  });
}
// Data → "Book store": which store this company runs on, and the owner's or administrator's emergency switch to the document
function bookStorePanel(main) {
  // 4.31.4 · Reload from cloud (administrators and editors): this device's copy and its cursor are dropped, the book is read again in full
  if (typeof CLOUD !== "undefined" && CLOUD.active() && CLOUD.canEdit() && typeof BOOKDB !== "undefined" && CLOUD.book && CLOUD.book.rowsMode && CLOUD.book.rowsMode()) {
    const btn = h("button", { class: "quiet", "data-act": "book-reload", onclick: async () => { if (S.dirty) { toast("A change is still being saved — try again in a moment"); return; } btn.disabled = true; btn.textContent = "Reloading…"; try { await BOOKDB.reload(); toast("The books were reloaded from the cloud — " + (BOOKDB.state.counts.__total || 0).toLocaleString("en-US") + " records"); } catch (e) { toast(e.message); } btn.disabled = false; btn.textContent = "Reload from cloud"; } }, "Reload from cloud");
    main.append(h("div", { class: "panel bookreload" }, h("h3", {}, "Records on this device"), h("p", { class: "dim" }, "If something you know is in the workspace does not show here, reload: this device's copy of the books is dropped and every record is read again. Changes not yet sent are kept."), h("div", { class: "row" }, btn)));
  }
  if (typeof CLOUD === "undefined" || !CLOUD.active() || !CLOUD.isAdmin() || typeof BOOKDB === "undefined") return;
  const org = (CLOUD.session() || {}).org_id; const rows = CLOUD.book && CLOUD.book.rowsMode && CLOUD.book.rowsMode(); const c = rows ? BOOKDB.state.counts : null;
  const box = h("div", { class: "panel bookstore" }, h("h3", {}, "Book store"),
    h("p", { class: "dim" }, rows ? "This company runs on the row store: " + (c.__total || 0).toLocaleString("en-US") + " rows, each record saved on its own, colleagues' changes merged live, posted journals immutable, closed periods enforced by the workspace." : "This company runs on the document store (the whole book saved on every change). The row store is the normal mode since 4.16."),
    h("div", { class: "row" }, rows
      ? h("button", { class: "quiet danger", onclick: async () => { if (!confirm("Write the whole book as one document and run on the document store from now on? Every device follows after its next start. This is for emergencies only.")) return; try { await BOOKDB.fallbackToDocument(S.store); toast("The book was written as a document; restarting on the document store"); setTimeout(() => location.reload(), 600); } catch (e) { toast(e.message); } } }, "Use the document store")
      : h("button", { class: "primary", onclick: async () => { try { const n = await BOOKDB.resumeRows(); toast("Back on the row store (" + n + " rows); restarting"); setTimeout(() => location.reload(), 600); } catch (e) { toast(e.message); } } }, "Use the row store")));
  main.append(box);
}
async function bootLocal() {
  const loaded = window.xyntax ? await window.xyntax.load() : (() => { try { return JSON.parse(localStorage.getItem("xyntax") || "null"); } catch (e) { return null; } })();
  S.store = E.migrate(loaded && loaded.entities ? loaded : E.newStore()); $("#saveState").textContent = loaded ? "saved" : ""; render(); showSuiteHome();
}
(async function init() {
  if (typeof SUITE !== "undefined" && SUITE.perf) SUITE.perf.mark("scripts ready");
  const cloudCfg = typeof CLOUD !== "undefined" ? CLOUD.cfg() : null;
  setupSuite();
  if (window.xyntax && window.xyntax.version) { try { const v = await window.xyntax.version(); if (typeof SUITE !== "undefined" && v) SUITE._ver = v; } catch (e) { /* ignore */ } }
  if (cloudCfg && cloudCfg.url) { setupPalette(); applyTheme(); const arrived = CLOUD.takeAuthHash(); if (arrived === "invite" || arrived === "recovery") showLogin(null, "setpassword"); else if (CLOUD.signedIn()) {
      // 4.8: the last answer to "who am I" is kept in the session, so the home is drawn at once and the fresh answer, in flight
      // meanwhile, only redraws it when something changed (a membership granted, an app switched on)
      const cached = CLOUD.restoreWho(); SUITE.perf.mark(cached ? "session restored from device" : "session: asking the workspace"); const who = CLOUD.whoami(); if (!cached) await who;
      window.addEventListener("cloud-who", () => { if (typeof SUITE !== "undefined" && document.querySelector("#home.open")) SUITE.showHome(); });
      if (CLOUD.active()) await bootCloud(); else if ((CLOUD.session() || {}).isOwner && !(CLOUD.session() || {}).personalMode) await bootOwnerConsole(); else await bootPersonal();
    } else showLogin(null); if (window.xyntax) { try { S.dataPath = await window.xyntax.dataPath(); } catch (e) { /* ignore */ } } window.addEventListener("beforeunload", () => { if (S.dirty && !CLOUD.active()) { clearTimeout(S.saveTimer); if (window.xyntax) window.xyntax.saveSync(S.store); } }); return; }
  const loaded = await persist.load();
  S.store = E.migrate(loaded && loaded.entities ? loaded : E.newStore());
  if (!loaded) { $("#saveState").textContent = ""; } else $("#saveState").textContent = "saved";
  if (window.xyntax) { try { S.dataPath = await window.xyntax.dataPath(); if (loaded) await window.xyntax.backup(); } catch (e) { /* best effort */ } }
  const n = E.rescreenStale(S.store); if (n) { scheduleSave(); setTimeout(() => toast("Re-screened " + n + " stale subject" + (n > 1 ? "s" : "") + " on startup"), 600); }
  applyTheme();

  if (window.xyntax && window.xyntax.einvoiceGetSettings) { try { S.einvoiceCfg = await window.xyntax.einvoiceGetSettings(); } catch (e) { /* ignore */ } }
  if (window.xyntax && window.xyntax.fxFetch) { const tickFx = async () => { try { if (!S.store || (typeof CLOUD !== "undefined" && CLOUD.active() && !CLOUD.canEdit())) return; const cur = S.store.meta.fx; if (cur && cur.date === E.today()) { const n0 = E.refreshGroupFx(S.store); if (n0.length) commit("Group rates follow the table: " + n0.length + " updated"); return; } const r = await window.xyntax.fxFetch(); if (!r.ok) return; const notes = E.applyFxRates(S.store, r.table); commit("Exchange rates " + r.table.date + (notes.length ? ": " + notes.length + " rate" + (notes.length > 1 ? "s" : "") + " updated" : " loaded")); } catch (e) { /* offline; next tick */ } }; setTimeout(tickFx, 9000); setInterval(tickFx, 6 * 3600 * 1000); }
  if (window.xyntax && window.xyntax.mailGetSettings) { try { const ms = await window.xyntax.mailGetSettings(); S.mailReady = !!(ms.host && ms.user); } catch (e) { /* ignore */ } }
  // 4.31.5 · the update bar (ready → Restart now) and the required-update screen live in update.js for every mode
  window.addEventListener("beforeunload", () => { if (S.dirty) { clearTimeout(S.saveTimer); if (window.xyntax) window.xyntax.saveSync(S.store); else localStorage.setItem("xyntax", JSON.stringify(S.store)); S.dirty = false; } });
  setupPalette();
  render(); showSuiteHome();
})();
