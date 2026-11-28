/* XYNTAX PROSHIP — LAYTIME (4.30): the laytime statement on the voyage page.
 * The engine (PSE.laytimeStatement) turns a statement of facts per load/discharge port — NOR, anchor aweigh, all fast, commenced,
 * suspended/resumed, completed, hoses off, sailed — plus the deductions (berthing, weather, a fixed number of hours agreed in an
 * addendum) into the sheet the desk used to make by hand: laytime start (NOR + notice), laytime stop, gross time per port, total
 * deducted, net, allowed, time on demurrage (or saved), rate, total, less address commission, less brokerage, due. Terms live on
 * the voyage (voyage.laytime), defaulting from the fixture; one record per port in d.laytime (kind "laytime", an operations manager
 * may keep it). Records are seeded from the port call (NOR, commenced, completed, departed) and never overwrite what was typed.
 * PSLT = { panel, ensure, statement, terms, document, html, raiseClaim, open, portResult, forms }. Building blocks come from PS.ui. */
(function () {
  const H = (...a) => SUITE.H(...a); const M = (n, c, dp) => SUITE.money(n, c, dp);
  const d = () => PS.data(); const U = () => PS.ui; const E = () => window.PSE;
  const uid = (p) => PS.uid(p); const fmtDT = (s) => (s ? SUITE.fmtDT(s) : "—");
  const canEdit = () => !!(PS.can && PS.can.write() && PS.can.kind("laytime")); const money = () => !PS.can || PS.can.money();
  const h2 = (n) => (n == null || isNaN(n) ? "—" : (+n).toFixed(2));
  // a date-time in the statement of facts: date over time, so the four time columns stay narrow
  const dtCell = (s) => { if (!s) return ""; const t = E().fmtAt(s); const i = t.lastIndexOf(" "); return H("span", { class: "lt-dt" }, t.slice(0, i), H("i", {}, t.slice(i + 1))); };
  const mask = (txt) => (money() ? txt : "—");
  const fixtureOf = (vy) => (d().fixtures || []).find((x) => x.id === vy.fixtureId) || null;
  const recordsOf = (vy) => (d().laytime || []).filter((l) => l && l.voyageId === vy.id);
  const cargoPorts = (vy) => (vy.ports || []).filter((p) => p.activity === "load" || p.activity === "discharge");
  const portName = (p) => (p.activity === "load" ? "Load port" : p.activity === "discharge" ? "Discharge port" : "Port") + " — " + p.name;
  const stamp = () => new Date().toISOString();

  // ---------- records: one per cargo port, seeded from the port call; old records (events / norTendered) migrate once
  function ensure(vy, opt) {
    opt = opt || {}; const doc = d(); if (!doc) return []; doc.laytime = doc.laytime || []; const f = fixtureOf(vy); if (!f || f.kind !== "voyage") return [];
    // a role that may not write laytime (a viewer) gets the same statement from a transient copy; nothing is saved for it
    const persist = canEdit(); let changed = false, added = 0; const out = [];
    for (const p of cargoPorts(vy)) {
      let rec = doc.laytime.find((l) => l && l.voyageId === vy.id && l.portId === p.id); if (rec && !persist) rec = JSON.parse(JSON.stringify(rec));
      if (!rec) { rec = { id: uid("lt"), vesselId: vy.vesselId, voyageId: vy.id, fixtureId: f.id, portId: p.id, port: p.name, activity: p.activity, sof: [], deductions: [], notes: "", created: stamp() }; if (persist) doc.laytime.push(rec); changed = true; }
      if (!Array.isArray(rec.sof)) { const m = E().laytimeMigrate(rec); rec.sof = m.sof; rec.deductions = m.deductions; rec.migratedFrom = "events"; if (m.terms && !vy.laytime) { vy.laytime = { allowedHours: m.terms.allowedHours, startRule: m.terms.startRule, stopEvent: m.terms.stopEvent }; } changed = true; }
      if (rec.port !== p.name || rec.activity !== p.activity || rec.vesselId !== vy.vesselId || rec.fixtureId !== f.id) { rec.port = p.name; rec.activity = p.activity; rec.vesselId = vy.vesselId; rec.fixtureId = f.id; changed = true; }
      for (const [code, at] of [["arrived", p.ata], ["nor", p.nor], ["commenced", p.commenced], ["completed", p.completed], ["sailed", p.atd]]) { if (!at || rec.sof.some((e) => e && e.code === code)) continue; rec.sof.push({ id: uid("ev"), code, at, seeded: true }); added++; changed = true; }
      if (changed) rec.updated = stamp(); out.push(rec);
    }
    if (changed && persist) { refreshResults(vy, out); PS.save(); }
    if (opt.report) return { records: out, added };
    return out;
  }
  // each record keeps the port's result so the Operations procedure ("Laytime calculated") and the old callers read it
  function refreshResults(vy, recs) { try { const f = fixtureOf(vy); const st = E().laytimeStatement(vy, f, recs); for (const rec of recs) { const p = st.ports.find((x) => x.id === rec.id); if (!p || p.provisional) { delete rec.result; continue; } rec.result = { kind: st.reversible ? st.kind : p.kind, amount: st.reversible ? (st.kind === "demurrage" ? st.demurrage : st.kind === "despatch" ? -st.despatch : 0) : (p.kind === "demurrage" ? p.demurrage : p.kind === "despatch" ? -p.despatch : 0), usedHours: p.netHours, grossHours: p.grossHours, deductedHours: p.deductedHours, allowedHours: st.reversible ? st.allowedHours : p.allowedHours, demurrageHours: st.reversible ? st.demurrageHours : p.demurrageHours, despatchHours: st.reversible ? st.despatchHours : p.despatchHours, currency: st.currency, reversible: st.reversible, laytimeStart: p.laytimeStart, laytimeStop: p.laytimeStop }; } } catch (e) { /* the statement is drawn again on the page */ } }
  function statement(vy) { const recs = ensure(vy); return E().laytimeStatement(vy, fixtureOf(vy), recs); }
  const terms = (vy) => E().laytimeTerms(vy, fixtureOf(vy));
  function saveRecord(vy, rec) { rec.updated = stamp(); refreshResults(vy, recordsOf(vy)); PS.save(); }
  // the port card's line: this port's time against the voyage's figure
  function portResult(vy, p) { try { const recs = ensure(vy); const rec = recs.find((r) => r.portId === p.id); if (!rec) return null; return E().laytime(rec, fixtureOf(vy), vy, recs); } catch (e) { return null; } }
  function open(vy, p) { PS.openVessel(vy.vesselId, "commercial", { sub: "voyages", sel: { kind: "voyage", id: vy.id } }); if (p) setTimeout(() => { const el = document.querySelector('[data-lt-port="' + p.id + '"]'); if (el && el.scrollIntoView) el.scrollIntoView({ block: "start", behavior: "smooth" }); }, 250); }

  // ---------- forms (SUITE.dialog: values back or null)
  const yn = (v) => (v ? "yes" : "no"); const YN = [{ v: "yes", l: "Yes" }, { v: "no", l: "No" }];
  async function termsForm(vy, redraw) {
    if (!canEdit()) { SUITE.toast("Your role does not change laytime terms"); return; } const t = terms(vy); const f = fixtureOf(vy) || {}; const ports = cargoPorts(vy); const m = money();
    const fields = [{ k: "reversible", label: "Reversible laytime (one allowance for the whole voyage)", type: "select", value: yn(t.reversible), options: YN }, { k: "allowedHours", label: "Allowed laytime, hours", type: "number", value: t.allowedHours, hint: ports.length > 1 ? "non-reversible: split equally unless a port has its own hours below" : "" }, ...ports.map((p) => ({ k: "pp_" + p.id, label: "Allowed hours at " + p.name + " (non-reversible only)", type: "number", value: t.allowedPerPort[p.id] != null ? t.allowedPerPort[p.id] : "" })), { k: "noticeHours", label: "Notice time after NOR, hours", type: "number", value: t.noticeHours }, { k: "startRule", label: "Laytime starts", type: "select", value: t.startRule, options: [{ v: "notice", l: "NOR + notice time" }, { v: "commenced", l: "Earlier of NOR + notice and commenced (time used counts)" }, { v: "allfast", l: "All fast" }] }, { k: "stopEvent", label: "Laytime stops at", type: "select", value: t.stopEvent, options: [{ v: "hoses", l: "Hoses disconnected (else completed)" }, { v: "completed", l: "Completed loading / discharging" }, { v: "sailed", l: "Sailed" }] }, { k: "deductShifting", label: "Deduct shifting from anchorage to berth (anchor aweigh → all fast)", type: "select", value: yn(t.deductShifting), options: YN }, { k: "onceOnDemurrage", label: "Once on demurrage, always on demurrage", type: "select", value: yn(t.onceOnDemurrage), options: YN }];
    if (m) fields.push({ k: "demurrageRate", label: "Demurrage per day (" + t.currency + ")", type: "number", value: t.demurrageRate }, { k: "despatchBasis", label: "Despatch", type: "select", value: t.despatchBasis, options: [{ v: "none", l: "None" }, { v: "half", l: "Half the demurrage rate" }, { v: "rate", l: "A rate of its own" }] }, { k: "despatchRate", label: "Despatch per day (when a rate of its own)", type: "number", value: t.despatchBasis === "rate" ? t.despatchRate : (f.cargo && f.cargo.despatchRate) || "" }, { k: "addressCommission", label: "Address commission %", type: "number", value: t.addressCommission }, { k: "brokerage", label: "Brokerage %", type: "number", value: t.brokerage }, { k: "currency", label: "Currency", value: t.currency });
    fields.push({ k: "remarks", label: "Remarks on the statement (one per line)", type: "textarea", value: t.remarks || "" });
    const r = await SUITE.dialog({ title: "Laytime terms · voyage " + (vy.no || ""), text: "Defaults come from the charter party; what you set here applies to this voyage only.", fields, ok: "Save", validate: (v) => { if (!(+v.allowedHours >= 0)) throw new Error("Allowed hours must be a number"); if (!(+v.noticeHours >= 0)) throw new Error("Notice hours must be a number"); } });
    if (!r) return; const prev = vy.laytime || {}; const perPort = {}; for (const p of ports) if (r["pp_" + p.id] !== "" && r["pp_" + p.id] != null && !isNaN(+r["pp_" + p.id])) perPort[p.id] = +r["pp_" + p.id];
    const next = { ...prev, reversible: r.reversible === "yes", allowedHours: +r.allowedHours, allowedPerPort: perPort, noticeHours: +r.noticeHours, startRule: r.startRule, stopEvent: r.stopEvent, deductShifting: r.deductShifting === "yes", onceOnDemurrage: r.onceOnDemurrage === "yes", remarks: r.remarks || "" };
    if (m) Object.assign(next, { demurrageRate: +r.demurrageRate || 0, despatchBasis: r.despatchBasis, despatchRate: r.despatchBasis === "rate" ? +r.despatchRate || 0 : null, addressCommission: +r.addressCommission || 0, brokerage: +r.brokerage || 0, currency: String(r.currency || t.currency).toUpperCase() });
    vy.laytime = next; refreshResults(vy, recordsOf(vy)); PS.save(); if (redraw) redraw(); SUITE.toast("Laytime terms saved");
  }
  const codeOpts = (activity) => E().LT_CODES.map(([v]) => ({ v, l: E().ltCodeLabel(v, activity) }));
  async function eventForm(vy, rec, ev, redraw) {
    if (!canEdit()) { SUITE.toast("Your role does not change the statement of facts"); return; } const isNew = !ev; ev = ev || {}; const act = rec.activity;
    const last = (rec.sof || []).map((e) => e.at).filter(Boolean).sort().pop();
    const r = await SUITE.dialog({ title: (isNew ? "Event · " : "Edit event · ") + rec.port, fields: [{ k: "code", label: "Event", type: "select", value: ev.code || (isNew ? "custom" : "custom"), options: codeOpts(act) }, { k: "label", label: "Wording on the statement (empty = the standard wording)", value: ev.label || "", placeholder: E().ltCodeLabel(ev.code || "allfast", act) }, { k: "at", label: "Date and time (local port time)", type: "datetime-local", value: ev.at || last || "" }], ok: "Save", validate: (v) => { if (!v.at || isNaN(E().parse(v.at))) throw new Error("Give the date and time"); if (v.code === "custom" && !String(v.label || "").trim()) throw new Error("Say what happened"); } });
    if (!r) return; const row = { id: ev.id || uid("ev"), code: r.code, label: String(r.label || "").trim() || undefined, at: r.at.slice(0, 16) };
    if (isNew) rec.sof.push(row); else Object.assign(ev, row, { label: row.label, seeded: undefined }); rec.sof.sort((a, b) => E().parse(a.at) - E().parse(b.at));
    saveRecord(vy, rec); if (redraw) redraw();
  }
  async function deductionForm(vy, rec, dd, redraw) {
    if (!canEdit()) { SUITE.toast("Your role does not change the statement of facts"); return; } const isNew = !dd; dd = dd || {}; const st = statement(vy); const p = st.ports.find((x) => x.id === rec.id) || {};
    const r = await SUITE.dialog({ title: (isNew ? "Deduction · " : "Edit deduction · ") + rec.port, text: "Time that does not count: a period (clipped to the laytime window, with the share deducted) or a fixed number of hours.", fields: [{ k: "desc", label: "Description", value: dd.desc || "", placeholder: "Berthing, weather, shifting, as per addendum…" }, { k: "from", label: "From", type: "datetime-local", value: dd.from || p.laytimeStart || "" }, { k: "to", label: "To", type: "datetime-local", value: dd.to || "" }, { k: "pct", label: "Share deducted, %", type: "number", value: dd.pct != null ? dd.pct : 100 }, { k: "hours", label: "Or a fixed number of hours (leave From / To empty)", type: "number", value: dd.hours != null ? dd.hours : "" }], ok: "Save", validate: (v) => { if (!String(v.desc || "").trim()) throw new Error("Describe the deduction"); const fixed = v.hours !== "" && v.hours != null; if (!fixed && !(v.from && v.to)) throw new Error("Give From and To, or a fixed number of hours"); if (!fixed && E().parse(v.to) <= E().parse(v.from)) throw new Error("To must be after From"); if (fixed && !(+v.hours >= 0)) throw new Error("Hours must be a number"); } });
    if (!r) return; const fixed = r.hours !== "" && r.hours != null; const row = { id: dd.id && dd.id !== "shifting" ? dd.id : uid("dd"), kind: dd.kind || (dd.id === "shifting" ? "shifting" : ""), desc: r.desc.trim(), from: fixed ? null : r.from.slice(0, 16), to: fixed ? null : r.to.slice(0, 16), pct: r.pct === "" || r.pct == null ? 100 : +r.pct, hours: fixed ? +r.hours : null, counts: false };
    rec.deductions = rec.deductions || []; const i = rec.deductions.findIndex((x) => x && x.id === row.id); if (i >= 0) rec.deductions[i] = { ...rec.deductions[i], ...row }; else rec.deductions.push(row);
    saveRecord(vy, rec); if (redraw) redraw();
  }
  function deleteEvent(vy, rec, id, redraw) { if (!canEdit()) return; rec.sof = (rec.sof || []).filter((e) => e.id !== id); saveRecord(vy, rec); if (redraw) redraw(); SUITE.toast("Event removed"); }
  function deleteDeduction(vy, rec, dd, redraw) { if (!canEdit()) return; if (dd.auto) { rec.shifting = false; SUITE.toast("Berthing is no longer deducted at " + rec.port); } else { rec.deductions = (rec.deductions || []).filter((x) => x && x.id !== dd.id); SUITE.toast("Deduction removed"); } saveRecord(vy, rec); if (redraw) redraw(); }
  function recalc(vy, redraw) { if (!canEdit()) { SUITE.toast("Your role does not change the statement of facts"); return; } const r = ensure(vy, { report: true }); refreshResults(vy, r.records || []); PS.save(); if (redraw) redraw(); SUITE.toast(r.added ? r.added + " event" + (r.added > 1 ? "s" : "") + " added from the port calls" : "Nothing new in the port calls — the statement already has every time entered there"); }

  // ---------- the claim and the printed sheet
  function raiseClaim(vy, redraw) {
    if (!canEdit()) { SUITE.toast("Your role does not raise claims"); return null; } const st = statement(vy); const f = fixtureOf(vy) || {}; if (st.kind !== "demurrage" || !(st.demurrageDue > 0)) { SUITE.toast("No demurrage on this voyage"); return null; }
    const doc = d(); doc.claims = doc.claims || []; let c = doc.claims.find((x) => x && x.voyageId === vy.id && x.kind === "demurrage" && x.status !== "dropped" && x.status !== "settled" && !x.invoiceId); const isNew = !c;
    const notes = "Laytime statement: " + h2(st.demurrageHours) + " h on demurrage at " + M(st.demurrageRate, st.currency) + "/day = " + M(st.demurrage, st.currency) + (st.addressCommission ? ", less " + st.addressCommissionPct + "% address commission " + M(st.addressCommission, st.currency) : "") + (st.brokerage ? ", less " + st.brokeragePct + "% brokerage " + M(st.brokerage, st.currency) : "") + (st.reversible ? " — basis entire voyage" : " — per port");
    if (!c) { c = { id: uid("cl"), vesselId: vy.vesselId, fixtureId: f.id || null, voyageId: vy.id, kind: "demurrage", againstCpId: f.chartererCpId || null, amount: st.demurrageDue, currency: st.currency, status: "open", date: SUITE.today(), notes, docIds: [], created: stamp() }; doc.claims.push(c); }
    else Object.assign(c, { amount: st.demurrageDue, currency: st.currency, notes, updated: stamp() });
    PS.save(); if (redraw) redraw(); SUITE.toast((isNew ? "Demurrage claim raised: " : "Demurrage claim updated: ") + M(st.demurrageDue, st.currency) + " — Commercial → Claims"); return c;
  }
  function docModel(vy) { const st = statement(vy); const f = fixtureOf(vy) || {}; const v = PS.vessel(vy.vesselId) || {}; return E().laytimeDocument(st, { vesselName: v.name || "", voyageNo: vy.no || "", cargo: f.cargo || {}, chartererName: f.chartererCpId ? PS.cpName(f.chartererCpId) : "", cpDate: f.cpDate || "", money: money() }); }
  function html(vy) { const model = docModel(vy); const v = PS.vessel(vy.vesselId) || {}; return DOCS.vesselReport(model, { entityId: v.managerEntityId || undefined }); }
  function printDoc(vy) { try { const v = PS.vessel(vy.vesselId) || {}; const out = html(vy); if (window.PSF && PSF.preview) PSF.preview("Laytime calculation · " + (v.name || "") + " · voyage " + (vy.no || ""), out, { name: "Laytime-" + String(v.name || "vessel").replace(/\s+/g, "-") + "-voyage-" + (vy.no || ""), vesselId: vy.vesselId, section: "Commercial" }); return out; } catch (e) { SUITE.toast(e.message); return null; } }

  // ---------- x.y · the laytime result of a voyage entered as agreed — for a past voyage with no statement of facts on file, or when the
  // owners and charterers settled on a figure: allowed and used hours, the rate, the demurrage or despatch it gives, the amount agreed or
  // settled and its date, the counterparty. Nothing refuses it for a completed voyage or past dates; it is dated by its own settlement
  // date. Until an invoice carries it, the voyage P&L (and the TCE, the portal's voyage page) accrue it; then the invoice does.
  const cpOptions = () => { const b = typeof S !== "undefined" && S.store ? S.store : null; return [{ v: "", l: "— counterparty —" }, ...((b && b.counterparties) || []).slice().sort((a, c) => String(a.name).localeCompare(String(c.name))).map((c) => ({ v: c.id, l: c.name }))]; };
  function resultForm(vy, redraw) {
    if (!canEdit()) { SUITE.toast("Your role does not change laytime"); return; } const f = fixtureOf(vy) || {}; const c = f.cargo || {}; const r0 = vy.laytimeResult || {}; const t = f.kind === "voyage" ? terms(vy) : null; const ccy = r0.currency || (t && t.currency) || f.currency || (d().settings || {}).currency || "USD";
    let st = null; try { st = f.kind === "voyage" && recordsOf(vy).some((x) => x && Array.isArray(x.sof) && x.sof.length) ? statement(vy) : null; } catch (e) { st = null; }
    const calc = (v) => { const lr = E().laytimeResult({ laytimeResult: { kind: v.kind === "auto" ? null : v.kind, allowedHours: v.allowedHours, usedHours: v.usedHours, days: v.days, rate: v.rate, agreedAmount: v.agreedAmount } }, f); return lr; };
    const out = H("div", { class: "sh-dim lt-result-calc" });
    const paint = (v) => { const lr = calc(v); out.textContent = !lr ? "Give the days on demurrage, or allowed and used laytime (hours), or the agreed amount." : (lr.hours != null ? (lr.kind === "despatch" ? "Time saved " : lr.kind === "demurrage" ? "Time on demurrage " : "Within laytime ") + (lr.days != null ? String(lr.days) + " d · " : "") + h2(lr.hours) + " h" : "") + (lr.computed != null ? " × " + M(lr.rate, v.currency || ccy) + "/day = " + M(lr.computed, v.currency || ccy) : "") + (lr.agreed != null ? " · agreed " + M(lr.agreed, v.currency || ccy) + " (counts)" : ""); };
    SUITE.form({ title: "Laytime result · voyage " + (vy.no || ""), subtitle: "the result as agreed or settled — for a voyage already completed too; it reaches the voyage P&L, the TCE and the portal, and is invoiced (or recorded) from here", onInput: (v) => paint(v), fields: [
      { k: "kind", label: "Result", type: "select", options: [{ v: "auto", l: "From the hours (demurrage if used > allowed)" }, { v: "demurrage", l: "Demurrage" }, { v: "despatch", l: "Despatch" }], value: r0.kind || "auto", allowEmpty: false },
      { k: "days", label: "Days on demurrage (or saved), e.g. 4.09123 — instead of the hours", type: "number", step: "any", value: r0.days != null ? r0.days : "" },
      { k: "allowedHours", label: "Allowed laytime, hours", type: "number", value: r0.allowedHours != null ? r0.allowedHours : st ? E().r2(st.allowedHours) : (c.laytimeHours || "") },
      { k: "usedHours", label: "Laytime used, hours", type: "number", value: r0.usedHours != null ? r0.usedHours : st ? E().r2(st.netHours) : "" },
      { k: "rate", label: "Demurrage (or despatch) rate per day", type: "number", value: r0.rate != null ? r0.rate : (t ? t.demurrageRate : c.demurrageRate) || "" },
      { k: "agreedAmount", label: "Amount agreed / settled (empty = as computed)", type: "number", value: r0.agreedAmount != null ? r0.agreedAmount : "" },
      { k: "settledAt", label: "Agreed / settled on", type: "date", value: r0.settledAt || "" },
      { k: "cpId", label: "Counterparty", type: "select", options: cpOptions(), value: r0.cpId || f.chartererCpId || "" },
      { k: "currency", label: "Currency", type: "currency", value: ccy },
      { k: "note", label: "Note", type: "textarea", value: r0.note || "" },
      { k: "calc", label: "Result", type: "raw", el: out, wide: 1 }],
      submitLabel: "Save result", submit: (v) => {
        const num = (x) => (x === "" || x == null ? null : +x); const rec = { kind: v.kind === "auto" ? null : v.kind, days: num(v.days), allowedHours: num(v.allowedHours), usedHours: num(v.usedHours), rate: num(v.rate), agreedAmount: num(v.agreedAmount), settledAt: v.settledAt || null, cpId: v.cpId || null, currency: String(v.currency || ccy).toUpperCase(), note: v.note || "", invoiceId: r0.invoiceId || null, billId: r0.billId || null, entered: r0.entered || stamp(), updated: stamp() };
        for (const k of ["days", "allowedHours", "usedHours", "rate", "agreedAmount"]) if (rec[k] != null && !(rec[k] >= 0)) throw new Error("Days, hours, rate and amount cannot be negative");
        if (rec.agreedAmount == null && rec.days == null && (rec.allowedHours == null || rec.usedHours == null)) throw new Error("Give the days on demurrage, or allowed and used laytime, or the agreed amount");
        if (rec.days != null && rec.agreedAmount == null && !(rec.rate > 0)) throw new Error("Give the demurrage rate per day (the fixture has none)");
        if (rec.settledAt && rec.settledAt > SUITE.today()) throw new Error("The settlement date is in the future");
        vy.laytimeResult = rec; PS.save(); if (redraw) redraw(); const lr = E().laytimeResult(vy, f); SUITE.toast("Laytime result saved" + (lr && lr.amount ? ": " + lr.kind + " " + M(lr.amount, lr.currency) : "")); } });
    setTimeout(() => paint({ kind: r0.kind || "auto", days: r0.days, allowedHours: r0.allowedHours, usedHours: r0.usedHours, rate: r0.rate != null ? r0.rate : (t ? t.demurrageRate : c.demurrageRate), agreedAmount: r0.agreedAmount, currency: ccy }), 0);
  }
  // the invoice for the result: generated (the trade form with the demurrage line) or recorded as issued outside XYNTAX
  function resultInvoice(vy, how, redraw) {
    const f = fixtureOf(vy) || {}; const lr = E().laytimeResult(vy, f, { ps: d() }); if (!lr || !(lr.amount > 0) || lr.kind === "within") { SUITE.toast("No demurrage or despatch to invoice"); return; }
    const done = (r) => { const doc = r && (r.invoice || r.bill); if (!doc || !vy.laytimeResult) return; if (r.invoice) vy.laytimeResult.invoiceId = doc.id; else vy.laytimeResult.billId = doc.id; vy.laytimeResult.updated = stamp(); PS.save(); };
    if (how === "record" || lr.kind === "despatch") { if (!(window.PSF && PSF.recordInvoice)) { SUITE.toast("Financials is not loaded"); return; } PSF.recordInvoice({ vesselId: vy.vesselId, voyageId: vy.id, fixtureId: f.id || null, kind: lr.kind, amount: lr.amount, counterpartyId: lr.cpId, currency: lr.currency, date: lr.date || undefined, note: (lr.kind === "despatch" ? "Despatch" : "Demurrage") + (lr.hours != null ? " " + h2(lr.hours) + " h" : "") + (lr.rate ? " at " + M(lr.rate, lr.currency) + "/day" : "") + (lr.agreed != null ? " · agreed" : ""), onDone: done }, redraw); return; }
    if (typeof forms === "undefined" || !forms.trade) { SUITE.toast("ACCOUNTING is not loaded"); return; } const v = PS.vessel(vy.vesselId) || {}; const b = typeof S !== "undefined" ? S.store : null;
    forms.trade({ entityId: v.managerEntityId || (typeof S !== "undefined" && S.entity) || ((b && b.entities[0]) || {}).id, customerId: lr.cpId, vesselId: vy.vesselId, voyageId: vy.id, currency: lr.currency, delivered: true, fixtureId: f.id || null, meta: { kind: "demurrage", vesselId: vy.vesselId, voyageId: vy.id, laytime: true }, lines: [{ kind: "service", description: "Demurrage " + E().MV(v.name || "") + " voyage " + (vy.no || "") + (lr.hours != null ? " · " + h2(lr.hours) + " h" : "") + (lr.rate ? " at " + M(lr.rate, lr.currency) + "/day" : "") + (lr.agreed != null ? " (as agreed)" : ""), qty: 1, unit: "lumpsum", price: lr.amount }] });
  }
  function resultSection(vy, o) {
    o = o || {}; const redraw = o.redraw || (() => U().drawMain()); const f = fixtureOf(vy) || {}; const edit = canEdit(); let lr = null; try { lr = E().laytimeResult(vy, f, { ps: d() }); } catch (e) { lr = null; }
    const b = typeof S !== "undefined" && S.store ? S.store : null; const inv = lr && lr.invoiceId && b ? (b.invoices || []).find((x) => x.id === lr.invoiceId) : null; const bill = lr && lr.billId && b ? (b.bills || []).find((x) => x.id === lr.billId) : null; const doc = inv || bill || (lr && b && lr.kind === "demurrage" ? (b.invoices || []).find((x) => x.voyageId === vy.id && x.meta && (x.meta.kind === "demurrage" || x.meta.laytime)) : null) || (lr && b && lr.kind === "despatch" ? (b.bills || []).find((x) => x.voyageId === vy.id && (/^despatch$/i.test(x.category || "") || (x.meta && x.meta.kind === "despatch"))) : null);
    const box = H("div", { class: "lt-result", "data-lt-result": vy.id }, H("div", { class: "lt-port-head" }, H("b", {}, "Laytime result (as agreed)"), lr ? H("span", { class: "sh-faint" }, lr.settled ? "settled " + SUITE.fmtDate(lr.date) : lr.date ? "dated " + SUITE.fmtDate(lr.date) : "") : null));
    if (!lr) box.append(H("div", { class: "sh-dim" }, "No result entered. For a voyage already completed — or when the figure was agreed without a statement of facts here — enter allowed and used laytime, the rate and the amount agreed."));
    else box.append(H("div", { class: "sh-kv ps-kv lt-kv" }, H("span", {}, "Allowed / used"), H("span", {}, (lr.allowedHours != null ? h2(lr.allowedHours) : "—") + " h / " + (lr.usedHours != null ? h2(lr.usedHours) : "—") + " h"), H("span", {}, lr.kind === "despatch" ? "Time saved" : "Time on demurrage"), H("span", {}, lr.hours != null ? h2(lr.hours) + " h" : "—"), H("span", {}, "Rate"), H("span", {}, mask(lr.rate ? M(lr.rate, lr.currency) + "/day" : "—")), H("span", {}, "Computed"), H("span", {}, mask(lr.computed != null ? M(lr.computed, lr.currency) : "—")), H("span", {}, "Agreed / settled"), H("span", {}, mask(lr.agreed != null ? M(lr.agreed, lr.currency) : "—")), H("span", { class: "lt-due" }, lr.kind === "despatch" ? "Despatch" : lr.kind === "demurrage" ? "Demurrage" : "Result"), H("span", { class: "lt-due" }, lr.kind === "within" ? "within laytime" : mask(M(lr.amount, lr.currency))), H("span", {}, "Counterparty"), H("span", {}, lr.cpId ? PS.cpName(lr.cpId) : "—"), H("span", {}, "Invoice"), H("span", {}, doc ? doc.ref + (doc.recorded ? " · recorded" : "") + " · " + (doc.paid > 0.005 ? (doc.amount - doc.paid > 0.005 ? "part-paid" : "paid") : "open") : "not yet invoiced — accrued on the voyage P&L"), lr.note ? H("span", {}, "Note") : null, lr.note ? H("span", {}, lr.note) : null));
    const can = lr && lr.amount > 0 && lr.kind !== "within" && !doc && money();
    box.append(H("div", { class: "row lt-acts" }, H("button", { type: "button", class: "quiet", "data-act": "laytime-result", disabled: edit ? null : true, onclick: () => resultForm(vy, redraw) }, lr ? "Edit result" : "Enter laytime result"), can && lr.kind === "demurrage" ? H("button", { type: "button", class: "quiet", onclick: () => resultInvoice(vy, "raise", redraw) }, "Raise demurrage invoice") : null, can ? H("button", { type: "button", class: "quiet", "data-act": "laytime-record", onclick: () => resultInvoice(vy, "record", redraw) }, "Record " + lr.kind + " invoice") : null));
    return box;
  }
  function resultPanel(vy, o) { const p = H("div", { class: "sh-panel lt-panel" }, H("h3", {}, "Laytime")); p.append(resultSection(vy, o)); return p; }

  // ---------- the panel on the voyage page
  function panel(vy, o) {
    o = o || {}; const redraw = o.redraw || (() => U().drawMain()); const ui = U(); const f = fixtureOf(vy); const ccy = (f && f.currency) || "USD";
    const box = H("div", { class: "sh-panel lt-panel" }, H("h3", {}, "Laytime statement", H("span", { class: "sh-faint" }, f && f.cargo && f.cargo.terms ? f.cargo.terms : "")));
    if (!cargoPorts(vy).length) { box.append(H("div", { class: "sh-dim" }, "Add the load and discharge ports for a statement of facts per cargo port — or enter the result as agreed below."), resultSection(vy, o)); return box; }
    let st; try { st = statement(vy); } catch (e) { box.append(H("div", { class: "sh-dim" }, "Laytime: " + e.message), resultSection(vy, o)); return box; }
    const t = st.terms; const edit = canEdit(); const m = money();
    // the terms line
    box.append(H("div", { class: "lt-terms" }, H("span", {}, H("b", {}, h2(st.allowedHours) + " h"), " allowed · " + (st.reversible ? "reversible, basis entire voyage" : "per port")), H("span", {}, "demurrage ", H("b", {}, mask(M(st.demurrageRate, ccy))), "/day", st.despatchRate ? H("span", {}, " · despatch " + mask(M(st.despatchRate, ccy)) + "/day") : null), H("span", {}, "NOR + " + E().r2(t.noticeHours) + " h · stops at " + (t.stopEvent === "completed" ? "completion" : t.stopEvent === "sailed" ? "sailing" : "hoses off") + (t.deductShifting ? " · berthing deducted" : "") + (t.onceOnDemurrage ? " · once on demurrage" : "")), H("span", {}, "address commission " + E().r2(t.addressCommission) + "% · brokerage " + E().r2(t.brokerage) + "%"), H("button", { type: "button", class: "quiet lt-terms-btn", disabled: edit ? null : true, onclick: () => termsForm(vy, redraw) }, "Edit terms")));
    // one statement of facts per port
    for (const p of st.ports) {
      const rec = recordsOf(vy).find((r) => r.id === p.id) || { id: p.id, port: p.port, activity: p.activity, sof: [], deductions: [] };
      const items = p.events.map((e) => ({ kind: "event", id: e.id, label: e.label, at: e.at, k: 0 })); if (p.laytimeStart) items.push({ kind: "start", label: p.startLabel, at: p.laytimeStart, k: 1 }); if (p.laytimeStop) items.push({ kind: "stop", label: p.stopLabel, at: p.laytimeStop, k: 2 });
      items.sort((a, b) => E().parse(a.at) - E().parse(b.at) || a.k - b.k);
      const n = Math.max(items.length, p.deductions.length); const rows = [];
      for (let i = 0; i < n; i++) {
        const it = items[i] || null, dd = p.deductions[i] || null; const ev = it && it.kind === "event" ? rec.sof.find((e) => e.id === it.id) : null;
        const menu = []; if (it && it.kind === "event") menu.push({ l: "Edit event…", fn: () => eventForm(vy, rec, ev, redraw) }, { l: "Delete event", danger: 1, fn: () => deleteEvent(vy, rec, it.id, redraw) }); else if (it) menu.push({ l: "Edit terms…", fn: () => termsForm(vy, redraw) });
        if (dd) { if (menu.length) menu.push({ sep: 1 }); const src = dd.auto ? dd : (rec.deductions || []).find((x) => x && x.id === dd.id) || dd; menu.push({ l: "Edit deduction…", fn: () => deductionForm(vy, rec, src, redraw) }, { l: dd.auto ? "Delete deduction (stop deducting berthing here)" : "Delete deduction", danger: 1, fn: () => deleteDeduction(vy, rec, dd, redraw) }); }
        if (!menu.length) menu.push({ l: "+ Event…", fn: () => eventForm(vy, rec, null, redraw) });
        rows.push({ id: p.id + ":" + i, cls: it && it.kind !== "event" ? "lt-computed" : "", cells: [it ? H("span", { class: it.kind !== "event" ? "lt-c" : "" }, it.label) : "", it ? dtCell(it.at) : "", dd ? H("span", { class: dd.ignored ? "lt-ignored" : "", title: dd.note || "" }, dd.label, dd.note ? H("span", { class: "sh-faint" }, " · " + dd.note) : null) : "", dd && dd.from ? dtCell(dd.from) : "", dd && dd.to ? dtCell(dd.to) : "", dd ? h2(dd.hours) : "", edit ? ui.menuBtn(menu) : ""], sortv: [i, i, i, i, i, i, ""] });
      }
      const sec = H("div", { class: "lt-port", "data-lt-port": p.portId || "" }, H("div", { class: "lt-port-head" }, H("b", {}, portName({ activity: p.activity, name: p.port })), p.provisional ? ui.pill("provisional", "warn") : null, H("span", { class: "sh-faint" }, "used " + h2(p.usedHours) + " h · deducted " + h2(p.deductedHours) + " h · net " + h2(p.netHours) + " h" + (!st.reversible && p.allowedHours != null ? " · allowed " + h2(p.allowedHours) + " h · " + (p.kind === "demurrage" ? h2(p.demurrageHours) + " h on demurrage" : p.kind === "despatch" ? h2(p.despatchHours) + " h saved" : "within laytime") : "")), H("span", { class: "lt-grow" }), edit ? H("button", { type: "button", class: "quiet", onclick: () => eventForm(vy, rec, null, redraw) }, "+ Event") : null, edit ? H("button", { type: "button", class: "quiet", onclick: () => deductionForm(vy, rec, null, redraw) }, "+ Deduction") : null),
        ui.tbl([{ l: "Event", wrap: 1 }, { l: "Date / time" }, { l: "Deduction", wrap: 1 }, { l: "From" }, { l: "To" }, { l: "Hours", num: 1 }, { l: "" }], rows, { id: "ps.lt.sof", compact: 1, empty: "No events yet — + Event, or enter NOR, commenced and completed on the port call." }),
        H("div", { class: "lt-port-foot" }, H("span", {}, "Total deducted at " + p.port), H("b", {}, h2(p.deductedHours))));
      box.append(sec);
    }
    // the summary, as on the sheet
    const left = H("div", { class: "sh-kv ps-kv lt-kv" }); for (const p of st.ports) left.append(H("span", { class: "lt-kv-h" }, portName({ activity: p.activity, name: p.port })), H("span", {}), H("span", {}, "Laytime start"), H("span", {}, fmtDT(p.laytimeStart)), H("span", {}, "Laytime stop"), H("span", {}, fmtDT(p.laytimeStop)), H("span", {}, "Laytime used"), H("span", {}, h2(p.usedHours) + " h"));
    const right = H("div", { class: "sh-kv ps-kv lt-kv lt-sum" }); const kv = (k, v, cls) => right.append(H("span", { class: cls || "" }, k), H("span", { class: cls || "" }, v));
    kv("Gross time used", h2(st.grossHours) + " h"); kv("Total deducted time", h2(st.deductedHours) + " h"); kv("Net time used", h2(st.netHours) + " h"); kv("Allowed laytime", h2(st.allowedHours) + " h");
    if (st.kind === "despatch") { kv("Time saved", h2(st.despatchHours) + " h"); kv("Despatch rate", mask(M(st.despatchRate, ccy))); kv("Despatch due", mask(M(st.despatchDue, ccy)), "lt-due"); }
    else { kv("Time on demurrage", h2(st.demurrageHours) + " h"); kv("Demurrage rate", mask(M(st.demurrageRate, ccy))); kv("Total demurrage", mask(M(st.demurrage, ccy))); kv("Less " + E().r2(st.addressCommissionPct) + "% address commission", mask(M(st.addressCommission, ccy))); if (st.brokers && st.brokers.length > 1) for (const b of st.brokers) kv("Less " + E().r2(b.pct) + "% brokerage" + (b.cpId && window.PS && PS.cpName ? " · " + PS.cpName(b.cpId) : ""), mask(M(b.amount, ccy))); else kv("Less " + E().r2(st.brokeragePct) + "% brokers commission", mask(M(st.brokerage, ccy))); kv("Demurrage due", mask(M(st.demurrageDue, ccy)), "lt-due"); }
    box.append(H("div", { class: "lt-summary" }, left, right));
    const agreed = vy.laytimeResult && (vy.laytimeResult.agreedAmount != null || vy.laytimeResult.usedHours != null) ? vy.laytimeResult : null;
    if (agreed) box.append(H("div", { class: "sh-dim lt-agreed-note" }, "A result as agreed is entered below — the voyage P&L, the TCE and the portal use it, not this sheet."));
    const claim = (d().claims || []).find((x) => x && x.voyageId === vy.id && x.kind === "demurrage" && x.status !== "dropped");
    box.append(H("div", { class: "lt-remarks sh-faint" }, st.remarks.join(" "), st.warnings.length ? H("div", { class: "lt-warn" }, st.warnings.map((w) => H("div", {}, "⚠ " + w))) : null, !st.complete ? H("div", {}, "Provisional — not every port has completed.") : null, claim ? H("div", {}, "Claim " + (claim.status || "open") + (claim.invoiceId ? ", invoiced" : "") + ": " + mask(M(claim.amount, claim.currency)) + (claim.date ? " · " + SUITE.fmtDate(claim.date) : "")) : null));
    box.append(H("div", { class: "row lt-acts" }, H("button", { type: "button", class: "quiet", onclick: () => printDoc(vy) }, "Print statement"), H("button", { type: "button", class: "quiet", disabled: edit && st.kind === "demurrage" && st.demurrageDue > 0 && !agreed ? null : true, title: agreed ? "The result as agreed is invoiced from the section below" : st.kind !== "demurrage" ? "No demurrage on this voyage" : "", onclick: () => raiseClaim(vy, redraw) }, claim && !claim.invoiceId && claim.status === "open" ? "Update demurrage claim" : "Raise demurrage claim"), H("button", { type: "button", class: "quiet", disabled: edit ? null : true, onclick: () => recalc(vy, redraw) }, "Recalculate from port calls")));
    box.append(resultSection(vy, o));
    return box;
  }

  window.PSLT = { panel, resultPanel, resultForm, resultInvoice, ensure, statement, terms, document: printDoc, html, docModel, raiseClaim, open, portResult, recalc, CODES: () => E().LT_CODES, forms: { terms: termsForm, event: eventForm, deduction: deductionForm } };
})();
