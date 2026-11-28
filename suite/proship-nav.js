/* XYNTAX PROSHIP — NAVIGATION (4.32): four places, one "+ New", one search.
 *
 *   Fleet       the map and the vessel list; a vessel opens HER PAGE (one scrollable page, a sticky section index)
 *   Commercial  fixtures, voyages, next open, strategy, customers
 *   Operations  board, noon reports, port calls, positions, bunkers, off-hire, claims & compliance
 *   Finance     P&L, invoices & payments, statement of accounts, hire, voyage P&L, DAs, cash flow, performance, reports
 *
 * The page renderers stay where they are (proship.js, proship-ops.js, proship-fin.js, proship-reports.js) and are composed here:
 * every section is a (tab, sub) of those renderers — the ROUTES table below — so an old PS.openTab / PS.openVessel / SUITE.open
 * call, a notes link or an inspector button lands in the place it now belongs to. The shell calls five hooks (mount, side,
 * main, skipPane) and exposes its building blocks on PS.ui. The fleet filter in the right pane (4.32.2, proship.js) is the one
 * filter on every place: the scope chip on the phone opens it as a sheet, the side's one line opens it on the desktop.
 * Header: places · search (finds anything; also filters the list on the page; 4.32.3: a vessel picked — or her record — becomes
 * the Showing) · + New (context-aware) · gear (Settings, Portal, Reload from cloud, About / Rendering). On her page the filter
 * drives the page (PSNAV.followScope, 4.32.3). Phone: the places in the bottom bar around Home, + New floating, search in the header,
 * the sections as a chip row. Deep links: PSNAV.go("#/vessel/<id>/fixture/<id>") and the hashchange listener. */
(function () {
  "use strict";
  if (typeof window === "undefined") return;
  const PSNAV = (window.PSNAV = window.PSNAV || {});
  PSNAV.enabled = true;
  const H = (...a) => SUITE.H(...a);
  const ok = () => typeof PS !== "undefined" && PS.ui && PS.ui.openTab && PS.state && PS.tabs;
  const st = () => PS.state;
  const U = () => PS.ui;
  const isM = () => (typeof SUITE !== "undefined" && SUITE.isMobile ? SUITE.isMobile() : false);
  const tabOk = (id) => !!(ok() && PS.tabs.get(id));
  const lc = (x) => String(x == null ? "" : x).toLowerCase();

  // ---------- the places and their sections: the routing table. A section is a (tab, sub) of the page renderers; vessel: true
  // shows the section only while a vessel is open (her hire statements, her procedure)
  const PLACES = [
    { id: "fleet", label: "Fleet", icon: "ship", sections: [
      { id: "overview", label: "Overview", tab: "overview" },
      { id: "map", label: "Live map", tab: "commercial", sub: "map" },
      { id: "vessels", label: "Vessels", tab: "vessels", count: "vessels" }] },
    { id: "commercial", label: "Commercial", icon: "trade", sections: [
      { id: "fixtures", label: "Fixtures", tab: "commercial", sub: "fixtures" },
      { id: "voyages", label: "Voyages", tab: "commercial", sub: "voyages" },
      { id: "open", label: "Next open", tab: "commercial", sub: "overview" },
      { id: "market", label: "Strategy", tab: "strategy" },
      { id: "customers", label: "Customers", tab: "commercial", sub: "customers" }] },
    { id: "operations", label: "Operations", icon: "planned", sections: [
      { id: "board", label: "Board", tab: "operations", sub: "board", count: "operations" },
      { id: "procedure", label: "Procedure", tab: "operations", sub: "procedure", vessel: true },
      { id: "noon", label: "Noon reports", tab: "operations", sub: "noon" },
      { id: "ports", label: "Port calls", tab: "operations", sub: "ports" },
      { id: "positions", label: "Positions", tab: "operations", sub: "positions" },
      { id: "bunkers", label: "Bunkers", tab: "operations", sub: "bunkers" },
      { id: "offhire", label: "Off-hire", tab: "operations", sub: "offhire" },
      { id: "claims", label: "Claims & compliance", tab: "compliance", count: "compliance" }] },
    { id: "finance", label: "Finance", icon: "ledger", sections: [
      { id: "pnl", label: "P&L", tab: "financials", sub: "overview" },
      { id: "invoices", label: "Invoices & payments", tab: "financials", sub: "documents" },
      { id: "soa", label: "Statement of accounts", tab: "financials", sub: "ownersSoa" },
      { id: "hire", label: "Hire statements", tab: "financials", sub: "statements", vessel: true },
      { id: "voyagepnl", label: "Voyage P&L", tab: "financials", sub: "voyages" },
      { id: "das", label: "DAs", tab: "financials", sub: "das" },
      { id: "cashflow", label: "Cash flow", tab: "financials", sub: "cashflow" },
      { id: "performance", label: "Performance", tab: "performance" },
      { id: "reports", label: "Reports", tab: "reports" }] }];
  const GEAR = { pssettings: "Settings", portal: "Portal" };
  // the tab labels the breadcrumbs read: the place a page now lives in
  const TAB_PLACE = { overview: "fleet", vessels: "fleet", commercial: "commercial", strategy: "commercial", operations: "operations", compliance: "operations", financials: "finance", performance: "finance", reports: "finance" };
  // (tab, sub, vessel open?) → [place, section]: every old route resolves to a place
  function routeOf(tab, sub, hasVessel, sel) {
    sub = sub == null ? "" : String(sub);
    switch (tab) {
      case "overview": return ["fleet", "overview"];
      case "vessels": return sel && sel.kind === "vessel" ? ["fleet", "vessel"] : ["fleet", "vessels"];
      case "commercial": if (sel && sel.kind === "fixture") return ["commercial", "fixtures"]; if (sel && sel.kind === "voyage") return ["commercial", "voyages"];
        if (sub === "map") return ["fleet", "map"]; if (sub === "fixtures" || sub === "voyages" || sub === "customers") return ["commercial", sub]; if (sub === "documents") return hasVessel ? ["fleet", "vessel"] : ["commercial", "fixtures"]; return hasVessel ? ["fleet", "vessel"] : ["commercial", "open"];
      case "strategy": return ["commercial", "market"];
      case "operations": { const s = sub || (hasVessel ? "procedure" : "board"); return s === "documents" ? (hasVessel ? ["fleet", "vessel"] : ["operations", "board"]) : ["operations", s]; }
      case "compliance": return ["operations", "claims"];
      case "financials": return ["finance", sub === "documents" ? "invoices" : /^owners/.test(sub) ? "soa" : sub === "statements" || sub === "invoice" ? "hire" : sub === "voyages" || /^voyage\//.test(sub) ? "voyagepnl" : sub === "das" ? "das" : sub === "cashflow" ? "cashflow" : "pnl"];
      case "performance": return ["finance", "performance"];
      case "reports": return ["finance", "reports"];
      case "pssettings": return ["gear", "settings"];
      case "portal": return ["gear", "portal"];
      default: return ["fleet", "overview"];
    }
  }
  const placeById = (id) => PLACES.find((p) => p.id === id) || null;
  const secOk = (s) => tabOk(s.tab) && (!s.vessel || !!st().vesselId);
  const placeOk = (p) => p.sections.some((s) => tabOk(s.tab) && !s.vessel);
  const visiblePlaces = () => PLACES.filter(placeOk);
  function current() { if (!ok()) return { place: "fleet", section: "overview" }; const s = st(); const sub = s.sub && s.sub[s.tab]; const [place, section] = routeOf(s.tab, sub != null ? sub : defSub(s.tab), !!s.vesselId, s.sel); return { place, section }; }
  const defSub = (tab) => (tab === "commercial" ? "overview" : tab === "operations" ? (st().vesselId ? "procedure" : "board") : tab === "financials" ? (window.PSF && PSF.state && PSF.state.finSub) || "overview" : null);
  PSNAV.PLACES = PLACES; PSNAV.routeOf = routeOf; PSNAV.current = current;

  // ---------- going places
  const last = {}; // the section each place was last on
  function openSection(pid, sid, o) {
    o = o || {}; if (!ok()) return; const p = placeById(pid); if (!p) return; const sec = p.sections.find((x) => x.id === sid) || p.sections.find(secOk); if (!sec) return; const s = st(); PSNAV._pendHer = null;
    // 4.32.2 · a one-vessel scope keeps her as the vessel in view on Commercial, Operations and Finance (her header card); Fleet shows the fleet of one
    if (o.clearVessel) s.vesselId = pid !== "fleet" && s.scope && s.scope.kind === "vessel" && PS.vessel(s.scope.id) ? s.scope.id : null; s.sel = null; if (o.q != null) s.q = o.q; last[pid] = sec.id;
    if (sec.tab === "financials" && window.PSF && PSF.state) PSF.state.finSub = sec.sub;
    if (sec.tab === "vessels") s.vseg = s.vseg === "historic" && o.historic !== false ? s.vseg : "active";
    const q = o.q; U().openTab(sec.tab, sec.sub ? { sub: sec.sub } : undefined); if (q) { s.q = q; U().drawMain(true); syncSearch(); }
    if (o.top !== false) { const m = U().main(); if (m) m.scrollTop = 0; }
  }
  function openPlace(pid) { const p = placeById(pid); if (!p) return; const sid = last[pid] && p.sections.some((x) => x.id === last[pid] && !x.vessel && tabOk(x.tab)) ? last[pid] : (p.sections.find((x) => !x.vessel && tabOk(x.tab)) || {}).id; openSection(pid, sid, { clearVessel: true }); }
  function openVessel(id, anchor) { if (!ok() || !PS.vessel(id)) return false; const s = st(); PSNAV._pendHer = null; s.vesselId = id; s.q = ""; PSNAV.anchor = anchor || null; U().openTab("vessels", { sel: { kind: "vessel", id } }); return true; }
  // her page remembers where it was opened from (PSNAV.from: the place and section in view before her) and ← goes back there;
  // with nothing before her — a deep link, a search from the gear — it goes to Fleet › Vessels
  // a vessel-only section (her hire statements, her procedure) was a place page with her open: ← keeps her open there
  function fromSec() { const f = PSNAV.from; const p = f && placeById(f.place); const sec = p && p.sections.find((x) => x.id === f.section); if (!p || !sec || !tabOk(sec.tab)) return { place: "fleet", sec: placeById("fleet").sections.find((x) => x.id === "vessels") || null }; return { place: p.id, sec, keep: !!sec.vessel }; }
  PSNAV.backLabel = () => { const t = fromSec(); return t.sec ? t.sec.label : "Vessels"; };
  function closeVessel() { if (!ok()) return; const s = st(); const v = s.vesselId ? PS.vessel(s.vesselId) : null; const t = fromSec(); if (!t.keep) s.vesselId = null; s.sel = null; if (v && PS.isExited(v) && t.place === "fleet" && t.sec && t.sec.id === "vessels") s.vseg = "historic"; if (t.sec) openSection(t.place, t.sec.id, { clearVessel: !t.keep }); else U().openTab("vessels"); }
  function openGear(tab) { if (!ok() || !tabOk(tab)) { SUITE.toast("Not available to your role"); return; } const s = st(); PSNAV._pendHer = null; s.vesselId = null; U().openTab(tab); }
  // 4.32.3 · on her page the filter drives the page: her page is a one-vessel view, so the ticked set decides what is open. Called by
  // PS.setScopeLive after its debounce; true = the page was handled here. Exactly one vessel ticked → her page (another vessel's page
  // at the section in view); several or none → the place and section she was opened from (Fleet › Vessels with nothing before her)
  // showing the ticked set. That place then remembers it was reached from her page: while the user stays on it, the first time the
  // ticked set narrows to one vessel her page opens (untick EL SIRENA, tick AMARA → AMARA › Overview); any other navigation forgets it.
  function followScope() {
    if (!ok()) return false; const s = st(); const ids = PS.scopeIds ? PS.scopeIds() : []; const pend = PSNAV._pendHer; PSNAV._pendHer = null;
    if (!onVesselPage()) { if (pend && ids.length === 1 && pend.place === current().place) { openVessel(ids[0], pend.sec); return true; } return false; } /* (the section is not compared: a one-vessel scope already moved the sub-page; every navigation clears pend) */
    const her = s.sel.id; const sec = PSNAV._spy && PSNAV._spy !== "summary" ? PSNAV._spy : null;
    if (ids.length === 1 && ids[0] === her) return true; /* she alone: her page as it is — the pane and the side line already say so */
    if (ids.length === 1) { openVessel(ids[0], sec); return true; }
    const t = fromSec(); s.sel = null; s.vesselId = null; if (t.sec && !t.keep) openSection(t.place, t.sec.id, { clearVessel: true }); else openPlace(t.place);
    PSNAV._pendHer = { place: current().place, sec }; return true;
  }
  Object.assign(PSNAV, { openSection, openPlace, openVessel, closeVessel, openGear, followScope });

  // ---------- normalising an old route onto the new pages (her page instead of the vessel file, the overview with a vessel, the commercial file)
  function normalize() {
    const s = st(); const sub = (t) => (s.sub && s.sub[t]) || defSub(t);
    // her page is the vessel list's file (tab vessels, sel vessel) — with her as the vessel in view
    const her = (anchor) => { s.tab = "vessels"; s.sel = { kind: "vessel", id: s.vesselId }; if (anchor) PSNAV.anchor = PSNAV.anchor || anchor; };
    if (s.tab === "vessels" && s.sel && s.sel.kind === "vessel") { if (PS.vessel(s.sel.id)) s.vesselId = s.sel.id; else s.sel = null; }
    if (s.tab === "overview" && s.vesselId && PS.vessel(s.vesselId)) her();
    if (s.tab === "commercial" && s.vesselId && !s.sel && tabOk("commercial") && PS.vessel(s.vesselId)) { const x = sub("commercial"); if (x === "overview" || x === "documents") her(x === "documents" ? "documents" : "employment"); }
    if (s.tab === "operations" && s.vesselId && !s.sel && sub("operations") === "documents" && PS.vessel(s.vesselId)) her("documents");
    // leaving her page for the list (Esc, the phone's Back) closes her: the list is the scope's again
    if (s.tab === "vessels" && !s.sel && s.vesselId && PSNAV._wasVp === s.vesselId) { const v = PS.vessel(s.vesselId); const t = fromSec(); if (!t.keep) s.vesselId = null; if (t.sec && !(t.place === "fleet" && t.sec.id === "vessels")) { s.tab = t.sec.tab; if (t.sec.sub) s.sub[t.sec.tab] = t.sec.sub; else delete s.sub[t.sec.tab]; if (t.sec.tab === "financials" && window.PSF && PSF.state) PSF.state.finSub = t.sec.sub; last[t.place] = t.sec.id; } else if (v && PS.isExited(v)) s.vseg = "historic"; }
  }
  const onVesselPage = () => ok() && st().tab === "vessels" && !!st().sel && st().sel.kind === "vessel" && !!PS.vessel(st().sel.id);
  function relabel() { for (const t of PS.tabs.list) { const p = TAB_PLACE[t.id]; if (p) { if (!t._pnLabel) t._pnLabel = t.label; t.label = placeById(p).label; } } }

  // ---------- the hooks the shell calls
  // 4.32.2 · the inspector is the fleet filter on every page, her page included (the phone's Details shows the same)
  PSNAV.skipPane = () => false;
  PSNAV.main = function (m, t, keepScroll) {
    if (!PSNAV.enabled || !ok()) return false;
    normalize(); relabel(); const s = st(); const root = U().root();
    if (root) { root.classList.add("pn"); root.classList.toggle("pn-vpage", onVesselPage()); root.classList.toggle("pn-nopane", !onVesselPage() && PSNAV.skipPane()); root.classList.toggle("pn-overview", s.tab === "overview" && !s.vesselId); }
    if (onVesselPage()) { if (!PSNAV._wasVp) PSNAV.from = PSNAV._lastPlace || null; vesselPage(m, keepScroll); PSNAV._wasVp = s.vesselId; after(); return true; }
    PSNAV._wasVp = null; { const c = current(); if (c.place !== "gear") PSNAV._lastPlace = c; }
    const t2 = PS.tabs.get(s.tab); if (!t2) return false;
    if (isM()) { const chips = placeChips(); if (chips) m.append(chips); }
    if (s.vesselId && t2.strip !== false && U().vesselStrip) { const strip = U().vesselStrip(); if (strip) { herPageLink(strip); m.append(strip); } }
    try { t2.render(m, PS.ctx()); } catch (e) { m.append(H("div", { class: "sh-err" }, "This page hit an error: " + e.message)); console.error(e); }
    dropSubSegs(m); tidy(m); if (isM() && !s.vesselId && t2.scoped !== false && !["pssettings", "portal", "vessels"].includes(t2.id)) groupLine(m); after(); return true;
  };
  // the phone's group: one line under the title (the desktop has it in the inspector) — data-* carry the words the old card had
  function groupLine(m) { const vs = PS.scopeVessels ? PS.scopeVessels() : []; const emp = vs.filter((v) => PS.activeFixture(v.id)).length; const pos = vs.filter((v) => PS.position(v)).length; const n = vs.length;
    let emps = ""; try { const c = {}; for (const v of vs) { const f = PS.activeFixture(v.id); const k = !f ? "open" : f.status !== "delivered" ? "fixed" : f.kind; c[k] = (c[k] || 0) + 1; } emps = [["tc", "on time charter"], ["voyage", "on voyage charter"], ["bareboat", "on bareboat"], ["fixed", "fixed, not delivered"], ["open", "open"]].filter(([k]) => c[k]).map(([k, l]) => c[k] + " " + l).join(" · "); } catch (e) { /* words only */ }
    const line = H("div", { class: "pn-gline", "data-title": U().groupTitle ? U().groupTitle() : "", "data-emp": emps, "data-pos": pos + " of " + n + " with a position" }, n.toLocaleString() + " vessel" + (n === 1 ? "" : "s") + " · " + emp.toLocaleString() + " employed · " + pos.toLocaleString() + " with a position");
    const hd = m.querySelector(".ps-pagehead .nt-hd"); if (hd) hd.append(line); else { const chips = m.querySelector(":scope > .pn-chips"); if (chips) chips.after(line); else m.prepend(line); } }
  // one path to each thing: the breadcrumb that repeats the place (the header and the side say it), page-head links to a section
  // (the side or the chip row has it) and second "new" buttons (+ New has them; the page keeps its one primary action)
  function tidy(host) {
    for (const c of host.querySelectorAll(".ps-pagehead .vt-crumbs")) c.remove(); /* the header says the place, the strip the vessel, the side the section — on record files too */
    const secLabels = new Set(["vessel list", "live map", "board", "all vessels", "her file", "on the map", "all fixtures", "all voyages"].concat(...PLACES.map((p) => p.sections.map((x) => x.label.toLowerCase()))));
    let labels; try { labels = new Set(newItems().map((x) => x.l.toLowerCase())); } catch (e) { labels = new Set(); }
    for (const acts of host.querySelectorAll(".ps-pagehead .ps-acts, .psf .psf-actions, .ps-pagehead .ps-tools-r")) {
      const btns = [...acts.querySelectorAll(":scope > button")]; const primary = btns.find((b) => b.classList.contains("primary"));
      for (const b of btns) { if (b === primary) continue; const t = b.textContent.replace(/^\+\s*/, "").replace(/…$/, "").trim().toLowerCase(); if (secLabels.has(t) || (b !== primary && (labels.has(t) || t === "from csv" || t === "onboard" || t === "edit vessel" && onVesselPage()))) b.remove(); }
      if (primary && acts.closest(".ps-pagehead")) { const pt = primary.textContent.trim(); for (const b of host.querySelectorAll(".sh-panel h3 > button, .sh-panel > .row > button, .sh-panel .psf-actions > button")) if (b.textContent.trim() === pt) b.remove(); }
    }
  }
  function after() { paintSecnav(); paintPlaces(); syncSearch(); if (SUITE.drawTabs && isM()) { try { SUITE.drawTabs(); } catch (e) { /* ignore */ } } }
  // the vessel header on a place page: her page one click away, the old section row and day buttons gone (+ New has them)
  function herPageLink(strip) { const v = PS.vessel(st().vesselId); if (!v) return; const acts = strip.querySelector(".ps-vhead-acts"); if (!acts) return; for (const b of [...acts.querySelectorAll(".ps-vh-day")]) if (!/^(Management statement|Re-enter…)$/.test(b.textContent.trim())) b.remove(); acts.prepend(H("button", { class: "quiet pn-herpage", onclick: () => openVessel(v.id) }, "Her page"));
    // "× Back to all vessels" stays on this place: the same section for the scope, or the place's first section when the section was hers alone (hire statements, procedure)
    const back = acts.querySelector(".ps-vh-back"); if (back) back.onclick = () => { const c = current(); const p = placeById(c.place); const sec = p && p.sections.find((x) => x.id === c.section); st().vesselId = null; if (p && sec && !sec.vessel) openSection(p.id, sec.id, { clearVessel: true }); else if (p) openPlace(p.id); else U().openTab("vessels"); }; }
  // the sub-page segments the renderers draw are the section list now: dropped (the period and view switches stay)
  const SUBLABELS = new Set(["Fleet", "Commercial file", "Fixtures", "Voyages", "Live map", "Customers", "Documents", "Board", "Procedure", "Port calls", "Positions", "Noon reports", "Bunkers", "Off-hire", "Overview", "Voyage P&L", "Hire", "Invoices & bills", "Invoices & payments", "Owners", "Cash flow", "DAs"]);
  function dropSubSegs(m) { for (const sg of m.querySelectorAll(".ps-pagehead .ps-tools-l > .sh-seg, .psf-subnav")) { const labels = [...sg.querySelectorAll(":scope > button")].map((b) => (b.firstChild && b.firstChild.nodeType === 3 ? b.firstChild.textContent : b.textContent).trim()); if (labels.filter((l) => SUBLABELS.has(l)).length >= 3) { const tools = sg.closest(".ps-tools"); sg.remove(); if (tools && !tools.querySelector("button, input, select")) tools.classList.add("empty"); } } }

  // the side: the place's sections (or her page's index, or the gear page) instead of the tab list; the finder goes (the header search finds vessels)
  PSNAV.side = function (side) {
    if (!PSNAV.enabled || !ok() || !side) return; const nav = side.querySelector(":scope > .sh-nav"); if (!nav) return;
    for (const b of [...nav.children]) if (b.tagName === "BUTTON") b.remove();
    for (const sel of [":scope > .ps-navgrp", ":scope > .ps-find"]) { const x = side.querySelector(sel); if (x) x.remove(); }
    let box = nav.querySelector(":scope > .pn-secnav"); if (!box) { box = H("div", { class: "pn-secnav" }); nav.prepend(box); }
    paintSecnav(box);
  };
  const countOf = (key) => { try { const t = PS.tabs.get(key); return t && t.count ? t.count(PS.ctx()) || 0 : 0; } catch (e) { return 0; } };
  function paintSecnav(box) {
    const side = U().side && U().side(); box = box || (side && side.querySelector(".pn-secnav")); if (!box) return; box.innerHTML = ""; const s = st(); const cur = current();
    if (onVesselPage()) { const v = PS.vessel(s.sel.id); box.classList.add("vp"); box.append(H("button", { class: "pn-back", onclick: () => closeVessel() }, "← " + PSNAV.backLabel()), H("div", { class: "pn-sechd" }, v.name)); for (const x of vSections(v)) box.append(H("button", { "data-sec": x.id, class: PSNAV._spy === x.id ? "on" : "", onclick: () => scrollToSec(x.id) }, H("span", { class: "lbl" }, x.label))); return; }
    box.classList.remove("vp");
    if (cur.place === "gear") { box.append(H("div", { class: "pn-sechd" }, GEAR[s.tab] || "Settings"), H("button", { class: "pn-back", onclick: () => openPlace("fleet") }, "← Fleet")); return; }
    const p = placeById(cur.place); if (!p) return; box.append(H("div", { class: "pn-sechd" }, p.label));
    for (const x of p.sections.filter(secOk)) { const n = x.count ? countOf(x.count) : 0; box.append(H("button", { "data-sec": x.id, class: cur.section === x.id ? "on" : "", onclick: () => openSection(p.id, x.id) }, H("span", { class: "lbl" }, x.label), n ? H("span", { class: "n" }, String(n)) : null)); }
  }
  // the phone: the place's sections as one chip row on top of the page
  function placeChips() { const cur = current(); const p = placeById(cur.place); if (!p) return null; const row = H("div", { class: "pn-chips", role: "tablist" }); if (PS.filterSheet && PS.showingText) row.append(H("button", { class: "pn-scope", title: "Which vessels every place shows — the fleet filter", onclick: () => PS.filterSheet() }, PS.showingText(), H("span", { class: "car" }, "▾"))); for (const x of p.sections.filter(secOk)) row.append(H("button", { "data-sec": x.id, role: "tab", class: cur.section === x.id ? "on" : "", onclick: () => openSection(p.id, x.id) }, x.label)); setTimeout(() => { const on = row.querySelector(".on"); const over = on ? on.offsetLeft + on.offsetWidth - row.clientWidth : 0; if (on && over > 0) row.scrollLeft = over + 24; }, 0); return row; }

  // ---------- the header: places · search · + New · gear
  let hdr = null;
  PSNAV.mount = function (root, frame) {
    if (!PSNAV.enabled || !ok()) return; PSNAV.root = root; PSNAV.frame = frame; root.classList.add("pn");
    const top = root.closest(".sh-frame") ? root.closest(".sh-frame").querySelector(".sh-apptop") : document.querySelector("#sapp .sh-apptop");
    hdr = { top, places: H("nav", { class: "pn-places", "aria-label": "Places" }), search: searchBox(), add: H("button", { class: "pn-new", title: "New — everything you can record (n)", onclick: (e) => newMenu(e.currentTarget) }, H("span", { class: "pl" }, "+"), " New"), gear: gearBtn() };
    if (top) { top.classList.add("pn-top"); const brand = top.querySelector(".sh-brand"); if (brand) brand.after(hdr.places); }
    frame.setActions(hdr.search, hdr.add, hdr.gear);
    if (frame.setBar) frame.setBar({ side: null, search: () => openSearch(), create: { l: "New", fn: () => newMenu() }, views: visiblePlaces().map((p) => ({ l: p.label, on: () => current().place === p.id, fn: () => openPlace(p.id) })), more: gearItems() });
    fab(); paintPlaces();
    // the phone's back on her page goes back to the vessel list (the shell sets it for its own panes and records)
    if (frame.setBack && !frame._pnBack) { const sb = frame.setBack; frame._pnBack = true; frame.setBack = (fn, label) => sb(fn || (isM() && onVesselPage() ? () => closeVessel() : null), fn && !(isM() && onVesselPage()) ? label : PSNAV.backLabel()); }
    // PROSHIP opens straight to Fleet (a route or SUITE.open's options take it elsewhere afterwards)
    const s = st(); s.tab = tabOk("overview") ? "overview" : "vessels"; s.vesselId = null; s.sel = null; s.q = "";
    const h = location.hash || ""; if (/^#\/[a-z]/i.test(h) && !/access_token=/.test(h)) PS.ready().then(() => setTimeout(() => go(h), 60));
    const main = U().main(); if (main && !main._pnSpy) { main._pnSpy = true; let raf = 0; main.addEventListener("scroll", () => { if (raf) return; raf = requestAnimationFrame(() => { raf = 0; spy(); }); }, { passive: true }); }
    root.addEventListener("click", groupClick, true);
    // the phone's scope chip follows a scope changed in place (ticking in the vessel list or the filter redraws only parts of the page)
    if (PS.onChange && !PSNAV._scopeL) PSNAV._scopeL = PS.onChange(() => { const b = U().main && U().main() && U().main().querySelector(".pn-chips .pn-scope"); if (b) b.firstChild.textContent = PS.showingText(); }, "scope");
  };
  // a group chip opens her page (one click, everywhere); the filter's rows are the filter's own
  function groupClick(e) { const b = e.target.closest && e.target.closest(".ps-gchip[data-id]"); if (!b || !PSNAV.enabled) return; const id = b.getAttribute("data-id"); if (!PS.vessel(id)) return; e.stopPropagation(); e.preventDefault(); openVessel(id); if (isM()) U().setPane("main"); }
  function paintPlaces() {
    if (!hdr || !hdr.places) return; const cur = current(); hdr.places.innerHTML = "";
    for (const p of visiblePlaces()) hdr.places.append(H("button", { "data-place": p.id, class: cur.place === p.id ? "on" : "", "aria-current": cur.place === p.id ? "page" : null, onclick: () => openPlace(p.id) }, p.label));
    if (hdr.gear) hdr.gear.classList.toggle("on", cur.place === "gear");
  }
  function gearBtn() { const b = H("button", { class: "pn-gear", title: "Settings, Portal, Reload from cloud, About", "aria-label": "Settings and more", onclick: (e) => SUITE.menu(e.currentTarget, gearItems()) }); b.append(SUITE.glyph ? SUITE.glyph("gear") : SUITE.icon("gear")); return b; }
  function gearItems() {
    const c = typeof CLOUD !== "undefined" ? CLOUD : null; const role = (c && c.state && c.state.role) || ""; const canReload = !!(window.PSDB && PS.hasStore && PS.hasStore() && c && c.active && c.active() && (c.state.isOwner || role === "admin" || role === "editor"));
    const items = [{ l: "Settings", d: "map, fleet currency, market rates, positions", fn: () => openGear("pssettings") }, tabOk("portal") ? { l: "Portal", d: "what each owner sees, logins", fn: () => openGear("portal") } : null,
      { l: "Reload from cloud", d: canReload ? "drop this device's copy and pull the company's records" : "needs a signed-in company (admin or editor)", disabled: !canReload, fn: async () => { try { const doc = await window.PSDB.reload(); SUITE.toast("Reloaded from the cloud — " + ((doc && doc.vessels) || []).length + " vessels"); } catch (e) { SUITE.toast(e.message); } } },
      { l: "Refresh positions", fn: () => (PS.refreshPositions ? PS.refreshPositions() : null) },
      { sep: 1 }, { l: "About / Rendering", fn: () => SUITE.open("settings", { view: "about" }) }];
    if (SUITE.showHelp) items.push({ l: "How PROSHIP works", fn: () => SUITE.showHelp("proship") });
    if (isM()) items.push({ sep: 1 }, { l: "Details", d: "the fleet filter, alerts and positions", fn: () => U().setPane("pane") }, SUITE.canSwitch && SUITE.canSwitch() ? { l: "Switch company…", fn: () => SUITE.switchCompany() } : null, { l: "Lock", fn: () => SUITE.lockNow && SUITE.lockNow() }, { l: "All apps", fn: () => SUITE.showHome() });
    return items.filter(Boolean);
  }
  // the phone's + New, floating above the bar
  function fab() { const sapp = document.getElementById("sapp"); if (!sapp) return; let f = sapp.querySelector(":scope > .pn-fab"); if (!f) { f = H("button", { class: "pn-fab", title: "New", "aria-label": "New", onclick: (e) => newMenu(e.currentTarget) }); f.append(SUITE.glyph ? SUITE.glyph("plus") : "+"); sapp.append(f); } }

  // the phone's bar: the four places around Home (two left, two right)
  if (typeof SUITE !== "undefined" && SUITE.drawTabs && !SUITE._pnBar) {
    SUITE._pnBar = true; const orig = SUITE.drawTabs;
    SUITE.drawTabs = function () {
      const el = this._tabsEl; if (!(this.current === "proship" && PSNAV.enabled && PSNAV.root && PSNAV.root.isConnected && el && ok())) { if (el) el.classList.remove("pn-bar"); return orig.apply(this, arguments); }
      el.innerHTML = ""; el.classList.add("pn-bar"); if (!this.isMobile()) return; const cur = current(); const ps = visiblePlaces();
      const key = (p) => H("button", { "data-place": p.id, class: cur.place === p.id ? "on" : "", onclick: () => openPlace(p.id) }, this.PT[p.icon] || (this.LINE && this.LINE[p.icon]) ? this.glyph(p.icon) : this.icon(p.icon), H("span", {}, p.label));
      const home = H("button", { class: "homekey", onclick: () => this.showHome() }, this.glyph("tiles"), H("span", {}, "Home"));
      const half = Math.ceil(ps.length / 2); el.append(...ps.slice(0, half).map(key), home, ...ps.slice(half).map(key)); el.style.gridTemplateColumns = "repeat(" + (ps.length + 1) + ", 1fr)";
    };
  }

  // ---------- one search: finds anything and opens it; while typing it also filters the list on the page (as the old page search did)
  let sbox = null, sinp = null, sres = null, hits = [], hiAt = -1, qT = null, fT = null, moreTok = 0;
  function searchBox() {
    sinp = H("input", { type: "search", placeholder: "Search vessels, fixtures, invoices…", title: "Vessels, fixtures, voyages, invoices, ports, customers, contacts, notes (/)", "aria-label": "Search PROSHIP", autocomplete: "off", spellcheck: "false" });
    sres = H("div", { class: "pn-res", role: "listbox", hidden: "" });
    const ic = SUITE.glyph ? SUITE.glyph("search") : H("span", {}, "⌕"); ic.classList.add("pn-sic");
    sbox = H("div", { class: "pn-search" }, H("button", { class: "pn-sbtn", type: "button", title: "Search (/)", "aria-label": "Search", onclick: () => openSearch() }, ic), sinp, H("kbd", {}, "/"), sres);
    sinp.addEventListener("input", () => { clearTimeout(qT); qT = setTimeout(() => paintHits(sinp.value), 70); clearTimeout(fT); fT = setTimeout(() => pageFilter(sinp.value), 240); });
    sinp.addEventListener("focus", () => { if (sinp.value.trim()) paintHits(sinp.value); });
    sinp.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); if (!hits.length) return; hiAt = (hiAt + (e.key === "ArrowDown" ? 1 : -1) + hits.length) % hits.length; markHit(); }
      else if (e.key === "Enter") { e.preventDefault(); const h = hits[hiAt >= 0 ? hiAt : 0]; if (h) pick(h); }
      else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); if (sinp.value) { sinp.value = ""; pageFilter(""); } closeRes(); sinp.blur(); sbox.classList.remove("open"); }
    });
    sinp.addEventListener("blur", () => setTimeout(() => { if (!sbox.contains(document.activeElement)) { closeRes(); if (!sinp.value) sbox.classList.remove("open"); } }, 160));
    return sbox;
  }
  function openSearch(q) { if (!sbox) return; sbox.classList.add("open"); if (q != null) { sinp.value = q; paintHits(q); } setTimeout(() => { sinp.focus(); sinp.select(); }, 30); }
  // the list hangs from the body (the header band clips what overflows it), placed under the field
  function placeRes() { if (!sres.isConnected) document.body.append(sres); const r = sbox.getBoundingClientRect(); if (isM()) { sres.style.left = "12px"; sres.style.right = "12px"; sres.style.width = "auto"; } else { sres.style.left = ""; sres.style.width = ""; sres.style.right = Math.max(8, window.innerWidth - r.right) + "px"; } sres.style.top = Math.round(r.bottom + 6) + "px"; }
  function closeRes() { if (sres) { sres.hidden = true; sres.innerHTML = ""; } hits = []; hiAt = -1; }
  function syncSearch() { if (!sinp || document.activeElement === sinp) return; const q = (ok() && st().q) || ""; if (sinp.value !== q) sinp.value = q; }
  function pageFilter(q) { if (!ok() || onVesselPage() || current().place === "gear") return; const s = st(); q = q.trim(); if ((s.q || "") === q) return; s.q = q; U().drawMain(true); }
  function markHit() { [...sres.querySelectorAll(".pn-hit")].forEach((b, i) => b.classList.toggle("on", i === hiAt)); const on = sres.querySelector(".pn-hit.on"); if (on) on.scrollIntoView({ block: "nearest" }); }
  // 4.32.3 · what the search opens becomes the Showing: a vessel picked — or her fixture, voyage, invoice or bill — is the one vessel
  // ticked (the others unticked), so every place shows her alone until the filter says otherwise; an exited vessel opens as she is
  function scopeTo(vid) { const v = vid && ok() && PS.vessel(vid); if (!v || PS.isExited(v) || !PS.setScope) return false; const sc = PS.scope; if (sc && sc.kind === "vessel" && sc.id === vid) return false; PS.setScope({ kind: "vessel", id: vid }, { quiet: true, keep: true }); return true; }
  function pick(h) { closeRes(); sinp.value = ""; sbox.classList.remove("open"); sinp.blur(); if (ok()) st().q = ""; if (h.vid) scopeTo(h.vid); try { h.fn(); } catch (e) { console.error(e); } }
  function paintHits(q) {
    if (!sres) return; hits = find(q); hiAt = hits.length ? 0 : -1; draw(); const tok = ++moreTok;
    findMore(q).then((more) => { if (tok !== moreTok || !more.length || sinp.value !== q) return; hits = hits.concat(more); draw(); });
    function draw() { sres.innerHTML = ""; if (!q.trim()) { sres.hidden = true; return; } placeRes(); let g = null; hits.forEach((h, i) => { if (h.g !== g) { g = h.g; sres.append(H("div", { class: "pn-hg" }, g)); } sres.append(H("button", { class: "pn-hit" + (i === hiAt ? " on" : ""), type: "button", role: "option", onmousedown: (e) => e.preventDefault(), onclick: () => pick(h) }, H("span", { class: "l" }, h.l), h.d ? H("span", { class: "d" }, h.d) : null)); }); if (!hits.length) sres.append(H("div", { class: "pn-none" }, "Nothing matches “" + q.trim() + "”" + (onVesselPage() ? "" : " · the page below is filtered too"))); sres.hidden = false; }
  }
  // the index: vessels, fixtures, voyages, invoices and bills (the Invoices & payments section), port calls, counterparties (contacts and notes come from their apps)
  let docCache = { at: 0, rows: [] };
  function docRows() { if (!(window.PSF && PSF.docRowsFor && typeof PSE !== "undefined" && PS.book && PS.book())) return []; if (Date.now() - docCache.at < 4000) return docCache.rows; try { docCache = { at: Date.now(), rows: PSF.docRowsFor(PS.vessels().map((v) => v.id), null).filter((r) => r.docKind === "invoice" || r.docKind === "bill") }; } catch (e) { docCache = { at: Date.now(), rows: [] }; } return docCache.rows; }
  function find(q) {
    q = lc(q).trim(); const out = []; if (!q || !ok() || !PS.data()) return out; const d = PS.data(); const has = (...xs) => xs.some((x) => x != null && x !== "" && lc(x).includes(q)); const vn = (id) => (PS.vessel(id) || {}).name || "";
    // every vessel is found, ticked or not: picked, she becomes the Showing (vid — pick() scopes to it) and her page opens
    let n = 0; for (const v of PS.vessels()) { if (!has(v.name, v.imo, v.mmsi, v.callSign)) continue; out.push({ g: "Vessels", l: v.name, d: [v.type, v.imo ? "IMO " + v.imo : null, PS.isExited(v) ? "exited" : null].filter(Boolean).join(" · "), fn: () => openVessel(v.id), kind: "vessel", id: v.id, vid: v.id }); if (++n >= 6) break; }
    if (tabOk("commercial")) { n = 0; for (const f of d.fixtures || []) { if (!has(vn(f.vesselId), PS.cpName(f.chartererCpId), f.cpForm, f.delivery && f.delivery.port, f.redelivery && f.redelivery.port, f.cargo && f.cargo.commodity, f.ref, f.id)) continue; out.push({ g: "Fixtures", l: vn(f.vesselId) + " · " + PS.fmt.kind(f.kind) + " to " + PS.cpName(f.chartererCpId), d: [PS.fmt.fstatus(f.status), f.cpDate ? "CP " + PS.fmt.d(f.cpDate) : null, f.cpForm].filter(Boolean).join(" · "), fn: () => openFixture(f), kind: "fixture", id: f.id, vid: f.vesselId }); if (++n >= 5) break; } }
    n = 0; for (const vy of d.voyages || []) { const ports = (vy.ports || []).map((p) => p.name).filter(Boolean); if (!has(vy.no, "voyage " + (vy.no || ""), "voy " + (vy.no || ""), vn(vy.vesselId), ports.join(" "))) continue; out.push({ g: "Voyages", l: vn(vy.vesselId) + " · voyage " + (vy.no || ""), d: [ports.join(" → "), vy.status].filter(Boolean).join(" · "), fn: () => openVoyage(vy), kind: "voyage", id: vy.id, vid: vy.vesselId }); if (++n >= 5) break; }
    if (PS.can && PS.can.money() && tabOk("financials")) { n = 0; for (const r of docRows()) { if (!has(r.ref, r.cp)) continue; out.push({ g: "Invoices & payments", l: (r.ref || "—") + " · " + (r.cp || ""), d: [r.kind, r.vessel, PS.fmt.money(r.amount, r.currency), r.status].filter(Boolean).join(" · "), fn: () => openDoc(r), kind: r.docKind, id: r.docId, vid: r.vesselId || null }); if (++n >= 5) break; } }
    { const ports = new Map(); for (const vy of d.voyages || []) for (const p of vy.ports || []) { if (!p.name || !has(p.name)) continue; const k = lc(p.name); const e = ports.get(k) || { name: p.name, calls: 0, vessels: new Set() }; e.calls++; e.vessels.add(vn(vy.vesselId)); ports.set(k, e); } n = 0; for (const e of ports.values()) { out.push({ g: "Port calls", l: e.name, d: e.calls + " port call" + (e.calls === 1 ? "" : "s") + " · " + [...e.vessels].slice(0, 3).join(", "), fn: () => openSection("operations", "ports", { clearVessel: true, q: e.name }), kind: "port", id: e.name }); if (++n >= 4) break; } }
    const b = PS.book && PS.book(); if (b && b.counterparties) { n = 0; for (const c of b.counterparties) { if (!has(c.name, c.short, c.email, c.contact)) continue; out.push({ g: "Customers", l: c.name, d: [c.role, c.country].filter(Boolean).join(" · "), fn: () => openCounterparty(c), kind: "counterparty", id: c.id }); if (++n >= 4) break; } }
    return out;
  }
  async function findMore(q) {
    q = String(q || "").trim(); if (q.length < 2 || typeof SUITE === "undefined") return []; const out = []; const allowed = (id) => SUITE.apps && SUITE.apps[id] && SUITE.apps[id].search && (!SUITE.allowed || SUITE.allowed(id));
    for (const [id, g] of [["contacts", "Contacts"], ["notes", "Notes"]]) if (allowed(id)) { try { const r = await SUITE.apps[id].search(q); for (const x of (r || []).slice(0, 4)) out.push({ g, l: x.l, d: x.d, fn: x.fn, kind: id }); } catch (e) { /* that app is not loaded */ } }
    return out;
  }
  function openFixture(f) { if (!ok()) return; const s = st(); s.vesselId = f.vesselId; PS.openTab("commercial", { sel: { kind: "fixture", id: f.id } }); }
  function openVoyage(vy) { if (!ok()) return; const s = st(); s.vesselId = vy.vesselId; s.sub.commercial = "voyages"; PS.openTab("commercial", { sel: { kind: "voyage", id: vy.id } }); }
  function openDoc(r) { if (!ok()) return; const s = st(); s.vesselId = r.vesselId || null; if (window.PSF && PSF.state) { PSF.state.finSub = "documents"; PSF.state.period = "all"; } U().openTab("financials", { sub: "documents" }); s.q = r.ref || ""; U().drawMain(true); syncSearch(); }
  function openCounterparty(c) { if (!ok()) return; const isCust = (PS.customers ? PS.customers() : []).some((x) => x.id === c.id); if (isCust && tabOk("commercial")) openSection("commercial", "customers", { clearVessel: true, q: c.name }); else if (U().forms && U().forms.customer) U().forms.customer(c); }
  Object.assign(PSNAV, { find, findMore, openSearch, openFixture, openVoyage, openDoc, scopeTo, pick });

  // ---------- + New: everything one can record, grouped by place, the current place first, the vessel in view preselected
  const qi = (label) => { const q = PS.quickItems(); const it = q.items.find((x) => x && x.l === label) || (q.own && q.own.l === label ? q.own : null); return it || null; };
  const vesselInScope = () => { const s = st(); if (s.vesselId) return s.vesselId; if (s.scope && s.scope.kind === "vessel" && PS.vessel(s.scope.id)) return s.scope.id; return null; };
  function pickVessel(title, fn, pref) { const vid = vesselInScope(); if (vid) return fn(vid); const all = (PS.scopeVessels ? PS.scopeVessels() : PS.activeVessels()).filter((v) => !PS.isExited(v)); const pool = all.filter((v) => !pref || pref(v)); const list = pool.length ? pool : all; if (list.length === 1) return fn(list[0].id); if (!list.length) return SUITE.toast("Onboard a vessel first"); SUITE.dialog({ title, fields: [{ k: "vesselId", label: "Vessel", type: "select", options: list.slice().sort((a, b) => a.name.localeCompare(b.name)).map((v) => ({ v: v.id, l: v.name })), value: list[0].id }], ok: "Continue" }).then((r) => { if (r && r.vesselId) fn(r.vesselId); }); }
  const withScope = (fn) => () => { const s = st(); const vid = vesselInScope(); if (!vid || s.vesselId) return fn(); s.vesselId = vid; try { return fn(); } finally { s.vesselId = null; } };
  const fx = (vid) => PS.activeFixture(vid);
  function newItems() {
    const can = PS.can || { kind: () => true, book: () => true, write: () => true, money: () => true }; const F = window.PSF || {}; const O = window.PSOPS && PSOPS.forms; const C = typeof SUITE !== "undefined" && SUITE.allowed ? SUITE.allowed("contacts") : true;
    const fromQ = (g, label, as, sec) => { const it = qi(label); return it ? { g, l: as || label, fn: withScope(() => { const again = qi(label); (again || it).fn(); }), sec } : null; };
    const v0 = vesselInScope(); const vx = v0 ? PS.vessel(v0) : null;
    const items = [
      fromQ("commercial", "Fixture", null, "fixtures"), fromQ("commercial", "Fixture from a recap"), fromQ("commercial", "Voyage", null, "voyages"),
      tabOk("strategy") && can.kind("strategies") ? { g: "commercial", l: "Strategy", sec: "market", fn: () => PS.tabs.get("strategy").create({ ...PS.ctx(), vesselId: vesselInScope() }) } : null,
      can.write() && PS.marketRateForm ? { g: "commercial", l: "Market rate", sec: "performance", fn: () => PS.marketRateForm() } : null,
      can.book() && U().forms && U().forms.customer ? { g: "commercial", l: "Customer or broker", sec: "customers", fn: () => U().forms.customer() } : null,
      fromQ("operations", "Noon report", null, "noon"), fromQ("operations", "Port call", null, "ports"), fromQ("operations", "Position report", null, "positions"),
      can.kind("bunkerLog") && (F.stemSheet || (O && O.stem)) ? { g: "operations", l: "Bunker stem", sec: "bunkers", fn: () => pickVessel("Bunker stem", (vid) => (F.stemSheet ? F.stemSheet(null, { vesselId: vid, voyageId: (PS.itinerary(vid).voyage || {}).id || null }, () => U().drawMain(true)) : O.stem(vid))) } : null,
      can.kind("voyages") && U().forms && U().forms.rob ? { g: "operations", l: "Bunkers on board (ROB)", fn: () => pickVessel("Bunkers on board", (vid) => U().forms.rob(vid)) } : null,
      fromQ("operations", "Off-hire", null, "offhire"), fromQ("operations", "Claim", null, "claims"), fromQ("operations", "Disbursement account", null, "das"), fromQ("operations", "Task", null, "board"), fromQ("operations", "Compliance item"),
      fromQ("finance", "Invoice hire", null, "hire"),
      can.book() && F.invoiceFreight && (!v0 || (fx(v0) && fx(v0).kind === "voyage")) ? { g: "finance", l: "Invoice freight", fn: () => pickVessel("Invoice freight", (vid) => F.invoiceFreight(vid), (v) => { const f = fx(v.id); return !!f && f.kind === "voyage"; }) } : null,
      fromQ("finance", "Expense", null, "pnl"),
      can.book() && F.receivePaymentSheet ? { g: "finance", l: "Receive payment", sec: "invoices", fn: () => F.receivePaymentSheet(vesselInScope() ? { vesselIds: [vesselInScope()] } : {}, () => U().drawMain(true)) } : null,
      can.book() && F.payBillsSheet ? { g: "finance", l: "Pay bills", fn: () => F.payBillsSheet(vesselInScope() ? { vesselIds: [vesselInScope()] } : {}, () => U().drawMain(true)) } : null,
      fromQ("fleet", "Onboard a vessel", null, "vessels"), fromQ("fleet", "Onboard from CSV"),
      C && SUITE.apps && SUITE.apps.contacts ? { g: "fleet", l: "Contact", fn: () => SUITE.open("contacts", { newContact: true }) } : null,
    ].filter(Boolean);
    return items;
  }
  const GROUP_LABEL = { fleet: "Fleet", commercial: "Commercial", operations: "Operations", finance: "Finance" };
  function newMenu(anchor) {
    if (!ok()) return null; const old = document.getElementById("shmenu"); if (old) { const same = old.classList.contains("pn-newmenu"); old.remove(); if (same && anchor && anchor.nodeType === 1) return null; }
    const cur = current(); const items = newItems(); const first = cur.section === "vessel" ? "commercial" : cur.place; /* on her page what one records for her comes first, not another vessel */ const order = [first, ...["commercial", "operations", "finance", "fleet"].filter((g) => g !== first)].filter((g) => GROUP_LABEL[g]);
    const def = items.find((x) => x.sec && x.sec === cur.section && x.g === cur.place); const v = vesselInScope() ? PS.vessel(vesselInScope()) : null;
    const m = H("div", { id: "shmenu", class: "ps-qmenu pn-newmenu", role: "menu" }); m.append(H("div", { class: "ps-qhd" }, "New" + (v ? " · " + v.name : "")));
    const btn = (it) => H("button", { role: "menuitem", class: it === def ? "on" : "", onclick: (e) => { e.stopPropagation(); m.remove(); try { it.fn(); } catch (err) { SUITE.toast(err.message); } } }, it.l);
    const cols = H("div", { class: "pn-ncols" });
    for (const g of order) { const list = items.filter((x) => x.g === g); if (def && def.g === g) { list.splice(list.indexOf(def), 1); list.unshift(def); } if (!list.length) continue; cols.append(H("div", { class: "pn-ncol", "data-group": g }, H("div", { class: "pn-mh" }, GROUP_LABEL[g]), ...list.map(btn))); }
    m.append(cols); document.body.append(m);
    if (isM()) m.classList.add("pn-sheetmenu"); else { const a = anchor && anchor.getBoundingClientRect ? anchor : (hdr && hdr.add); const r = a ? a.getBoundingClientRect() : { right: window.innerWidth - 16, bottom: 60, top: 60 }; const W = m.offsetWidth, Hh = m.offsetHeight; m.style.left = Math.min(window.innerWidth - W - 8, Math.max(8, r.right - W)) + "px"; m.style.top = Math.max(8, Math.min(r.bottom + 6, window.innerHeight - Hh - 8)) + "px"; }
    const btns = () => [...m.querySelectorAll("button")]; const focus = (i) => { const b = btns(); if (b.length) b[(i + b.length) % b.length].focus(); };
    m.addEventListener("keydown", (e) => { const b = btns(); const i = b.indexOf(document.activeElement); if (e.key === "ArrowDown") focus(i + 1); else if (e.key === "ArrowUp") focus(i - 1); else if (e.key === "Home") focus(0); else if (e.key === "End") focus(-1); else if (e.key === "Escape") m.remove(); else if ((e.key === "n" || e.key === "N") && b[0]) b[0].click(); else return; e.preventDefault(); e.stopPropagation(); });
    const t0 = Date.now(); const off = (e) => { if (Date.now() - t0 < 300) return; if (!m.isConnected) { cleanup(); return; } if (!m.contains(e.target) && !(anchor && anchor.contains && anchor.contains(e.target))) { m.remove(); cleanup(); } }; const cleanup = () => { document.removeEventListener("mousedown", off, true); document.removeEventListener("touchstart", off, true); };
    setTimeout(() => { document.addEventListener("mousedown", off, true); document.addEventListener("touchstart", off, true); }, 0);
    if (!isM()) setTimeout(() => focus(0), 0); return m;
  }
  Object.assign(PSNAV, { newItems, newMenu, gearItems });

  // ---------- HER PAGE: everything about one vessel on one scrollable page; each section is a page renderer drawn for her
  function vSections(v) {
    const exited = PS.isExited(v); const out = [];
    out.push({ id: "summary", label: "Overview", tab: "vessels", render: renderSummary });
    if (tabOk("commercial")) out.push({ id: "employment", label: "Employment", tab: "commercial", sub: "overview", more: [["Strategy", "strategy"], ["Fixtures", "commercial", "fixtures"]] });
    if (tabOk("commercial")) out.push({ id: "voyages", label: "Voyages", tab: "commercial", sub: "voyages", more: [["Voyage P&L", "financials", "voyages"], ["Port calls", "operations", "ports"]] });
    if (tabOk("operations") && !exited) out.push({ id: "reports", label: "Noon reports", tab: "operations", sub: "noon", more: [["Positions", "operations", "positions"], ["Procedure", "operations", "procedure"], ["Port calls", "operations", "ports"]] });
    if (tabOk("operations") && !exited) out.push({ id: "bunkers", label: "Bunkers", tab: "operations", sub: "bunkers" });
    if (tabOk("financials")) out.push({ id: "invoices", label: "Invoices & payments", tab: "financials", sub: "documents", more: [["Hire statements", "financials", "statements"], ["Statement of accounts", "financials", "ownersSoa"], ["P&L", "financials", "overview"], ["DAs", "financials", "das"], ["Cash flow", "financials", "cashflow"], ["Performance", "performance"], ["Reports", "reports"]] });
    if (tabOk("operations") || tabOk("compliance")) out.push({ id: "offhire", label: "Off-hire & claims", tab: tabOk("operations") ? "operations" : "compliance", sub: "offhire", render: renderOffhire });
    if (tabOk("compliance")) out.push({ id: "compliance", label: "Compliance", tab: "compliance", render: renderCompliance });
    out.push({ id: "documents", label: "Documents", render: (host) => { drawTab(host, tabOk("commercial") ? "commercial" : "operations", "documents"); for (const b of host.querySelectorAll(".ps-pagehead .ps-acts > button")) b.remove(); } });
    out.push({ id: "notes", label: "Notes & contacts", render: renderNotes });
    return out;
  }
  PSNAV.vesselSections = (id) => { const v = ok() && PS.vessel(id || st().vesselId); return v ? vSections(v).map((x) => ({ id: x.id, label: x.label })) : []; };
  // draw one renderer for her into a host, with its sub-page set for the call and put back afterwards
  function drawTab(host, tab, sub) {
    const s = st(); const t = PS.tabs.get(tab); if (!t) return; const had = Object.prototype.hasOwnProperty.call(s.sub, tab); const keep = s.sub[tab]; const keepFin = window.PSF && PSF.state ? PSF.state.finSub : null;
    if (sub != null) { s.sub[tab] = sub; if (tab === "financials" && window.PSF && PSF.state) PSF.state.finSub = sub; }
    const keepSel = s.sel; s.sel = null; try { t.render(host, PS.ctx()); } catch (e) { host.append(H("div", { class: "sh-err" }, "This section hit an error: " + e.message)); console.error(e); }
    finally { s.sel = keepSel; if (had) s.sub[tab] = keep; else delete s.sub[tab]; if (tab === "financials" && window.PSF && PSF.state) PSF.state.finSub = keepFin; }
    dropSubSegs(host); tidy(host);
  }
  function renderSummary(host, v) {
    const s = st(); const keep = s.sel; s.sel = { kind: "vessel", id: v.id }; try { PS.tabs.get("vessels").render(host, PS.ctx()); } catch (e) { host.append(H("div", { class: "sh-err" }, e.message)); } finally { s.sel = keep; }
    // what has its own section below leaves the summary: the fixtures list, the invoices, the folders, the "Open" links
    for (const p of host.querySelectorAll(".sh-panel")) { const h = p.querySelector(":scope > h3"); const t = h ? (h.firstChild && h.firstChild.nodeType === 3 ? h.firstChild.textContent : h.textContent).trim() : ""; if (t === "Open" || t === "Fixtures") p.remove(); }
    for (const sel of [".ps-vdocsfin", ".ps-vdocs"]) for (const x of host.querySelectorAll(sel)) x.remove();
    // the Pending tile is a count; its items are the Pending panel beside the map, one click away
    for (const k of host.querySelectorAll(".sh-kpi")) { const l = k.querySelector(".l"); if (!l || !/^pending$/i.test(l.textContent.trim())) continue; const panel = [...host.querySelectorAll(".sh-panel")].find((p) => /^Pending/.test(((p.querySelector(":scope > h3") || {}).firstChild || {}).textContent || "")); const k2 = k.cloneNode(true); const d = k2.querySelector(".d"); if (d) d.textContent = panel ? "see the list below" : ""; k2.classList.add("pn-pendk"); k2.onclick = panel ? () => { const m2 = U().main(); m2.scrollTo({ top: panel.getBoundingClientRect().top - m2.getBoundingClientRect().top + m2.scrollTop - 12, behavior: "smooth" }); } : null; k.replaceWith(k2); }
    if (PS.isExited(v) && isM()) { const acts = host.querySelector(".ps-pagehead .ps-acts"); if (acts && U().tenureReport) acts.append(H("button", { class: "quiet", onclick: () => U().tenureReport(v) }, "Management statement")); }
    // her page's way back is the index's "← Vessels" (the phone's Back): the file's own "← All vessels" goes, as does the map's "Operations" link (her sections are on this page)
    for (const b of host.querySelectorAll(".ps-pagehead button, .ps-vfile .row > button")) if (/^←/.test(b.textContent.trim()) || b.textContent.trim() === "Operations" || b.textContent.trim() === "+ Fixture") b.remove();
    { const acts = host.querySelector(".ps-pagehead .ps-acts"); const ed = acts && [...acts.querySelectorAll(":scope > button")].find((b) => b.textContent.trim() === "Edit"); if (ed && !acts.querySelector(":scope > button.primary")) { ed.classList.remove("quiet"); ed.classList.add("primary"); } }
  }
  function renderOffhire(host, v) { if (tabOk("operations")) drawTab(host, "operations", "offhire"); if (tabOk("compliance")) { const tmp = H("div"); drawTab(tmp, "compliance"); const cl = [...tmp.querySelectorAll(".sh-panel")].find((p) => /^Claims/.test(((p.querySelector(":scope > h3") || {}).textContent || "").trim())); if (cl) host.append(cl); } void v; }
  function renderCompliance(host) { drawTab(host, "compliance"); for (const p of [...host.querySelectorAll(".sh-panel")]) if (/^Claims/.test(((p.querySelector(":scope > h3") || {}).textContent || "").trim())) p.remove(); }
  // notes and contacts: who she works with (owner, charterers, brokers, agents), their people in Contacts, the notes about her
  function renderNotes(host, v) {
    const d = PS.data(); const cps = new Map(); const add = (id, role) => { if (!id) return; const e = cps.get(id) || { id, roles: new Set() }; e.roles.add(role); cps.set(id, e); };
    add(v.ownerCpId, "owner"); for (const f of PS.fixtures(v.id)) { add(f.chartererCpId, "charterer"); add(f.brokerCpId, "broker"); } for (const vy of (d.voyages || []).filter((x) => x.vesselId === v.id)) for (const p of vy.ports || []) add(p.agentCpId, "agent · " + p.name);
    const b = PS.book && PS.book(); const cpRec = (id) => (b && b.counterparties ? b.counterparties.find((c) => c.id === id) : null);
    host.append(U().h1("Notes & contacts", "who she works with, their people and the notes about her", H("button", { class: "quiet", onclick: () => SUITE.open("notes") }, "+ Note"), SUITE.apps && SUITE.apps.contacts ? H("button", { class: "quiet", onclick: () => SUITE.open("contacts", { newContact: true }) }, "+ Contact") : null));
    const rows = [...cps.values()].map((e) => { const c = cpRec(e.id); return { cells: [H("b", {}, PS.cpName(e.id)), [...e.roles].join(" · "), c ? [c.contact, c.email, c.phone].filter(Boolean).join(" · ") || "—" : "—"], onclick: c && U().forms && U().forms.customer ? () => U().forms.customer(c) : null }; });
    host.append(U().panel("Counterparties", U().tbl([{ l: "Name" }, { l: "Role" }, { l: "Contact" }], rows, { compact: 1, empty: "No owner, charterer, broker or agent on file for " + v.name + " yet" })));
    const desk = []; for (const f of PS.fixtures(v.id)) if (f.notes) desk.push([PS.fmt.kind(f.kind) + " · " + PS.cpName(f.chartererCpId), f.notes]); for (const o of (d.offhire || []).filter((x) => x.vesselId === v.id && x.notes)) desk.push(["Off-hire " + PS.fmt.d(o.from), o.notes]); if (v.notes) desk.unshift(["Vessel", v.notes]);
    if (desk.length) host.append(U().panel("Desk notes", H("div", { class: "pn-desk" }, desk.map(([k, t]) => H("div", {}, H("span", { class: "k" }, k), H("span", { class: "v" }, t))))));
    const people = H("div", { class: "pn-people" }, H("div", { class: "sh-dim" }, "Looking in Contacts and Notes…")); host.append(U().panel("People and notes", people));
    (async () => { const out = []; const seen = new Set(); const allowed = (id) => SUITE.apps && SUITE.apps[id] && SUITE.apps[id].search && (!SUITE.allowed || SUITE.allowed(id)); const qs = [v.name, ...[...cps.keys()].map((id) => PS.cpName(id)).filter((n) => n && n !== "—")];
      for (const [app, g] of [["contacts", "Contact"], ["notes", "Note"]]) if (allowed(app)) for (const q of app === "notes" ? [v.name] : qs) { try { for (const x of (await SUITE.apps[app].search(q)) || []) { const k = app + ":" + x.l + ":" + x.d; if (seen.has(k)) continue; seen.add(k); out.push({ g, ...x }); } } catch (e) { /* not loaded */ } }
      if (!people.isConnected) return; people.innerHTML = ""; if (!out.length) { people.append(H("div", { class: "sh-dim" }, "No contact or note mentions " + v.name + " or her counterparties yet")); return; }
      for (const x of out.slice(0, 24)) people.append(H("button", { class: "pn-person", onclick: () => x.fn && x.fn() }, H("span", { class: "k" }, x.g), H("b", {}, x.l), x.d ? H("span", { class: "d" }, x.d) : null)); })();
  }
  let vtok = 0; const vscroll = {};
  function vesselPage(m, keepScroll) {
    const s = st(); const v = PS.vessel(s.sel.id); s.vesselId = v.id; const tok = ++vtok; const secs = vSections(v); const same = PSNAV._vpId === v.id; PSNAV._vpId = v.id; const anchor = PSNAV.anchor; PSNAV.anchor = null;
    const page = H("div", { class: "pn-vp", "data-vessel": v.id }); if (isM()) page.append(vesselChips(secs)); m.append(page);
    const one = (x) => { const sec = H("section", { class: "pn-vsec", "data-sec": x.id, id: "pn-sec-" + x.id }, x.id === "summary" ? null : H("div", { class: "pn-vsec-h" }, x.label)); const body = H("div", { class: "pn-vsec-b" }); sec.append(body); page.append(sec);
      if (x.render) { try { x.render(body, v); } catch (e) { body.append(H("div", { class: "sh-err" }, "This section hit an error: " + e.message)); console.error(e); } } else drawTab(body, x.tab, x.sub);
      if (x.id !== "summary") { const hd = body.querySelector(".ps-pagehead .ps-titlerow .ps-acts, .vt-head .ps-titlerow .ps-acts"); if (hd && hd.querySelector("button")) { hd.closest(".ps-titlerow").classList.add("pn-lifted"); sec.firstChild.append(hd); } }
      if (x.more && x.more.some((mm) => tabOk(mm[1]))) sec.append(H("div", { class: "pn-more" }, x.more.filter((mm) => tabOk(mm[1])).map(([l, tab, sub]) => H("button", { class: "quiet", onclick: () => { s.vesselId = v.id; U().openTab(tab, sub ? { sub } : undefined); } }, l + " →")))); };
    const finish = () => { if (tok !== vtok) return; const tgt = anchor ? page.querySelector('[data-sec="' + anchor + '"]') : null; if (tgt) scrollToSec(anchor, true); else if (same && vscroll[v.id] != null) m.scrollTop = vscroll[v.id]; else if (!same) m.scrollTop = 0; spy(); if (U().fitKpis) U().fitKpis(m); };
    // her first open draws the top at once and the rest frame by frame (the page is usable at once); a redraw of the same page draws all, so the scroll stays put
    if (same || keepScroll || anchor) { for (const x of secs) one(x); finish(); return; }
    const first = secs.slice(0, 2), rest = secs.slice(2); for (const x of first) one(x); m.scrollTop = 0;
    const step = () => { if (tok !== vtok || !page.isConnected) return; const x = rest.shift(); if (!x) { finish(); return; } one(x); (window.requestAnimationFrame || setTimeout)(step); }; (window.requestAnimationFrame || setTimeout)(step);
  }
  PSNAV.vesselPageReady = () => { const p = ok() && U().main() && U().main().querySelector(".pn-vp"); if (!p) return false; return p.querySelectorAll(".pn-vsec").length === vSections(PS.vessel(p.dataset.vessel)).length; };
  function vesselChips(secs) { return H("div", { class: "pn-chips pn-vchips", role: "tablist" }, secs.map((x) => H("button", { "data-sec": x.id, role: "tab", class: x.id === "summary" ? "on" : "", onclick: () => scrollToSec(x.id) }, x.label))); }
  function scrollToSec(id, instant) { const m = U().main(); if (!m) return; const el = m.querySelector('.pn-vsec[data-sec="' + id + '"]'); if (!el) return; const chips = m.querySelector(".pn-vchips"); const off = (chips ? chips.offsetHeight : 0) + 6; const top = el.getBoundingClientRect().top - m.getBoundingClientRect().top + m.scrollTop - off; if (instant || !m.scrollTo) m.scrollTop = top; else m.scrollTo({ top, behavior: "smooth" }); PSNAV._spy = id; markSpy(id); }
  function spy() { if (!onVesselPage()) return; const m = U().main(); if (!m) return; vscroll[st().vesselId] = m.scrollTop; const secs = m.querySelectorAll(".pn-vsec"); if (!secs.length) return; const top = m.getBoundingClientRect().top + 90; let cur = secs[0].dataset.sec; for (const x of secs) { if (x.getBoundingClientRect().top <= top) cur = x.dataset.sec; else break; } if (m.scrollTop + m.clientHeight >= m.scrollHeight - 4) cur = secs[secs.length - 1].dataset.sec; if (cur !== PSNAV._spy) { PSNAV._spy = cur; markSpy(cur); } }
  function markSpy(id) { const side = U().side && U().side(); const m = U().main(); for (const host of [side && side.querySelector(".pn-secnav.vp"), m && m.querySelector(".pn-vchips")]) { if (!host) continue; for (const b of host.querySelectorAll("button[data-sec]")) b.classList.toggle("on", b.dataset.sec === id); const on = host.querySelector("button.on"); if (on && host.classList.contains("pn-vchips") && host.scrollWidth > host.clientWidth) host.scrollTo ? host.scrollTo({ left: Math.max(0, on.offsetLeft - 16) }) : (host.scrollLeft = Math.max(0, on.offsetLeft - 16)); } }
  PSNAV.scrollToSec = scrollToSec;

  // ---------- deep links: the old hashes and the new ones resolve to a place, a section, her page or a record
  const vesselByKey = (k) => { if (!k || !ok()) return null; k = decodeURIComponent(String(k)); const all = PS.vessels(); return PS.vessel(k) || all.find((v) => String(v.imo || "") === k || String(v.mmsi || "") === k) || all.find((v) => lc(v.name) === lc(k)) || null; };
  const OLD = { overview: ["fleet", "overview"], vessels: ["fleet", "vessels"], map: ["fleet", "map"], strategy: ["commercial", "market"], market: ["commercial", "market"], compliance: ["operations", "claims"], claims: ["operations", "claims"], performance: ["finance", "performance"], reports: ["finance", "reports"], financials: ["finance", "pnl"], money: ["finance", "pnl"] };
  function go(hash) {
    if (!ok()) return false; const parts = String(hash || "").replace(/^#?\/?/, "").split(/[?]/)[0].split("/").filter(Boolean).map((x) => { try { return decodeURIComponent(x); } catch (e) { return x; } }); const [a, b, c, d2] = parts; const s = st(); const data = PS.data() || {};
    if (!a) { openPlace("fleet"); return true; }
    const P = placeById(lc(a));
    if (P) { if (!b) { openPlace(P.id); return true; } const sec = P.sections.find((x) => x.id === lc(b)) || P.sections.find((x) => x.sub === b || lc(x.label) === lc(b)); if (lc(a) === "commercial" && (b === "map")) { openSection("fleet", "map", { clearVessel: true }); return true; } if (lc(a) === "commercial" && b === "overview") { openSection("commercial", "open", { clearVessel: true }); return true; } if (sec) { openSection(P.id, sec.id, { clearVessel: true }); return true; } if (P.id === "commercial" && b === "documents") { openSection("commercial", "fixtures", { clearVessel: true }); return true; } openPlace(P.id); return true; }
    if (a === "vessel" || a === "v" || a === "vessels" && b) { const v = vesselByKey(b); if (!v) { SUITE.toast("No vessel " + (b || "")); return false; } return vesselRoute(v, c, d2, parts.slice(4)); }
    if (a === "fixture") { const f = (data.fixtures || []).find((x) => x.id === b); if (f) { openFixture(f); return true; } return false; }
    if (a === "voyage") { const vy = (data.voyages || []).find((x) => x.id === b) || (data.voyages || []).find((x) => String(x.no) === String(b)); if (vy) { openVoyage(vy); return true; } return false; }
    if (a === "invoice" || a === "bill") { const r = docRows().find((x) => x.docId === b || x.ref === b); if (r) { openDoc(r); return true; } s.vesselId = null; openSection("finance", "invoices", { q: b || "" }); return true; }
    if (a === "financials") { const [, sec] = routeOf("financials", b || "overview", false); openSection("finance", sec, { clearVessel: true }); return true; }
    if (OLD[a]) { openSection(OLD[a][0], OLD[a][1], { clearVessel: true }); return true; }
    if (a === "settings" || a === "pssettings") { openGear("pssettings"); return true; }
    if (a === "portal") { openGear("portal"); return true; }
    if (a === "search") { openSearch(b || ""); return true; }
    // the portal's own routes, when one is pasted into the desktop
    if (a === "statement") { openSection("finance", "soa", { clearVessel: true }); return true; }
    if (a === "documents") { openSection("finance", "invoices", { clearVessel: true }); return true; }
    if (a === "help") { if (SUITE.showHelp) SUITE.showHelp("proship"); return true; }
    return false;
  }
  function vesselRoute(v, c, d2, rest) {
    const s = st(); const data = PS.data() || {};
    if (!c) return openVessel(v.id);
    if (c === "fixture") { const f = (data.fixtures || []).find((x) => x.id === d2); if (f) { openFixture(f); return true; } return openVessel(v.id, "employment"); }
    if (c === "voyage" || c === "port") { const vy = (data.voyages || []).find((x) => x.id === d2) || (data.voyages || []).find((x) => x.vesselId === v.id && String(x.no) === String(d2)); if (vy) { openVoyage(vy); return true; } return openVessel(v.id, "voyages"); }
    if (c === "invoice" || c === "bill") { const r = docRows().find((x) => x.vesselId === v.id && (x.docId === d2 || x.ref === d2)); if (r) { openDoc(r); return true; } s.vesselId = v.id; U().openTab("financials", { sub: "documents" }); s.q = d2 || ""; U().drawMain(true); syncSearch(); return true; }
    if (c === "noon") return openVessel(v.id, "reports");
    if (c === "voyages" && d2) { const vy = (data.voyages || []).find((x) => x.id === d2 || (x.vesselId === v.id && String(x.no) === String(d2))); if (vy) { openVoyage(vy); return true; } }
    const vs = vSections(v); if (vs.some((x) => x.id === c)) return openVessel(v.id, c);
    const map = { overview: null, voyages: "voyages", commercial: "employment", operations: "reports", financials: "invoices", compliance: "compliance", documents: "documents", notes: "notes", contacts: "notes", offhire: "offhire", claims: "offhire", bunkers: "bunkers" };
    if (["commercial", "operations", "financials", "strategy", "performance", "reports"].includes(c) && d2) { s.vesselId = v.id; U().openTab(c, { sub: d2 }); return true; }
    if (["strategy", "performance", "reports"].includes(c)) { s.vesselId = v.id; U().openTab(c); return true; }
    return openVessel(v.id, map[c] || null); void rest;
  }
  PSNAV.go = go;
  window.addEventListener("hashchange", () => { const h = location.hash || ""; if (typeof SUITE !== "undefined" && SUITE.current === "proship" && /^#\/[a-z]/i.test(h) && !/access_token=/.test(h)) go(h); });
  // SUITE.open("proship", { route: "#/vessel/…" }) or { place, section } — the old { vessel, tab, sub, sel } keep working through the shell
  const wrapOpen = () => { if (typeof SUITE === "undefined" || !SUITE.apps || !SUITE.apps.proship || SUITE.apps.proship._pnOpen) return !!(SUITE.apps && SUITE.apps.proship); const mod = SUITE.apps.proship; const orig = mod.open; mod._pnOpen = true; mod.open = function (opt) { if (opt && opt.route) return go(opt.route); if (opt && opt.place) return opt.section ? openSection(opt.place, opt.section, { clearVessel: !opt.vessel }) : openPlace(opt.place); if (opt && opt.vessel && !opt.sel && !opt.sub && (!opt.tab || ["commercial", "overview", "vessels"].includes(opt.tab))) { const go2 = () => openVessel(opt.vessel, opt.tab === "commercial" ? "employment" : null); return PS.ready ? PS.ready().then(go2) : go2(); } return orig ? orig.call(this, opt) : undefined; }; return true; };
  if (!wrapOpen()) { let n = 0; const t = setInterval(() => { if (wrapOpen() || ++n > 120) clearInterval(t); }, 250); }

  // ---------- keys: / focuses the search, n opens + New (the shell's own n menu is taken over while the new navigation is on)
  window.addEventListener("keydown", (e) => {
    if (!PSNAV.enabled || typeof SUITE === "undefined" || SUITE.current !== "proship" || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target; if (t && t.closest && t.closest("input, textarea, select, [contenteditable]")) return; if (document.querySelector("#sheet.open, #shdlg.open")) return; const menu = document.getElementById("shmenu"); if (menu && !menu.classList.contains("pn-newmenu")) return;
    if (e.key === "/") { e.preventDefault(); e.stopPropagation(); openSearch(); } else if ((e.key === "n" || e.key === "N") && !menu) { e.preventDefault(); e.stopPropagation(); newMenu(); }
  }, true);
})();
