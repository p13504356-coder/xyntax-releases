/* XYNTAX 1.0 — engine
 * Pure domain logic. No DOM, no Electron. Runs in Node (tests) and in the renderer.
 * Everything is linked through one store; every business event posts to one ledger.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.XyntaxEngine = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const DAY = 86400000;
  const uid = (p = "x") => p + "_" + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
  const today = () => new Date().toISOString().slice(0, 10);
  const addDays = (d, n) => new Date(new Date(d).getTime() + n * DAY).toISOString().slice(0, 10);
  const daysBetween = (a, b) => Math.round((new Date(b) - new Date(a)) / DAY);
  const entIn = (eid, sel) => !sel || (Array.isArray(sel) ? sel.includes(eid) : eid === sel); // null/"" = every entity; [] = none
  // group rate for combining entities: 1 when the selected entities all share one currency (then figures are shown in that currency)
  const groupRate = (store, eid, sel) => { const ents = store.entities.filter((x) => entIn(x.id, sel)); if (typeof sel === "string" && sel) return 1; const cs = new Set(ents.map((x) => x.currency)); if (cs.size === 1) return 1; const e = store.entities.find((x) => x.id === eid); return (e && e.groupFx) || 1; };
  const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
  const sum = (arr, f) => arr.reduce((s, x) => s + (f ? f(x) : x), 0);
  const by = (arr, k) => arr.reduce((m, x) => ((m[x[k]] = m[x[k]] || []).push(x), m), {});
  const avg = (arr) => (arr.length ? sum(arr) / arr.length : 0);

  // ---------------------------------------------------------------- store
  function newStore() {
    return {
      version: 1,
      meta: { name: "XYNTAX 1.0", created: today(), reportingCurrency: "USD" },
      settings: { screeningValidityDays: 90, highRiskCountries: ["IR", "KP", "SY", "CU", "RU"], workingCapitalHorizonDays: 45, lossAllowanceDefaultPct: 0.3, vatRates: [0, 5, 25], defaultVat: 0, expenseCategories: ["Bank charges", "Salaries", "Office", "Brokerage", "Agency", "Insurance", "Legal & audit", "Travel", "Other"], controls: { paymentLimit: 0, paymentTwoApproversAbove: 0, journalLimit: 0, closeRequiresApproval: false, voidRequiresApproval: false, approvers: [], preparerCannotApprove: true, limitChangeRequiresApproval: true }, locks: {} },
      entities: [], banks: [], futuresAccounts: [], counterparties: [], vessels: [], products: [], contracts: [],
      cargoes: [], cargoLosses: [], trades: [], invoices: [], bills: [], payments: [], futuresTrades: [],
      screenings: [], watchlist: [], ledger: [], notes: [], enquiries: [], bankTx: [], documents: [], closings: [], recon: {}, attachments: [], people: [],
      approvals: [], audit: [], periodCloses: [],
    };
  }
  // 4.16 ENTERPRISE · controls: approval limits (in the group reporting currency; 0 = off), who may approve, separation of duties
  const CONTROLS_DEFAULT = () => ({ paymentLimit: 0, paymentTwoApproversAbove: 0, journalLimit: 0, closeRequiresApproval: false, voidRequiresApproval: false, approvers: [], preparerCannotApprove: true, limitChangeRequiresApproval: true });
  function migrate(store) {
    const fresh = newStore();
    for (const k of Object.keys(fresh)) if (store[k] == null) store[k] = fresh[k];
    for (const k of Object.keys(fresh.settings)) if (store.settings[k] == null) store.settings[k] = fresh.settings[k];
    store.settings.controls = { ...CONTROLS_DEFAULT(), ...(store.settings.controls || {}) }; if (!Array.isArray(store.settings.controls.approvers)) store.settings.controls.approvers = []; if (!store.settings.locks || typeof store.settings.locks !== "object") store.settings.locks = {};
    for (const k of ["approvals", "audit", "periodCloses"]) if (!Array.isArray(store[k])) store[k] = [];
    for (const e of store.entities) { e.address = e.address || ""; e.trn = e.trn || ""; e.docFooter = e.docFooter || ""; e.bankDetails = e.bankDetails || ""; e.phone = e.phone || ""; e.email = e.email || ""; e.signature = e.signature || ""; e.stamp = e.stamp || ""; e.signatory = e.signatory || ""; if (e.groupFx == null) e.groupFx = 1; e.altCurrency = e.altCurrency || ""; if (e.altRate == null) e.altRate = 0; e.docPrefix = e.docPrefix || ""; e.logo = e.logo || ""; }
    for (const b of store.banks) { b.type = b.type || "bank"; b.swift = b.swift || ""; b.accountName = b.accountName || ""; if (b.onDocs == null) b.onDocs = b.type !== "cash"; }
    if (!store.meta.reportingCurrency) store.meta.reportingCurrency = "USD";
    for (const c of store.counterparties) { c.trn = c.trn || ""; c.address = c.address || ""; }
    store.people = store.people || []; if (!store.meta.repairedAt && store.ledger && store.ledger.length) { try { const notes = repairBooks(store); store.meta.repairedAt = new Date().toISOString(); if (notes.length) store.meta.repairNotes = notes; } catch (e) { /* leave for the manual button */ } } for (const p of store.products) p.unit = p.unit || "MT"; for (const c of store.cargoes) c.unit = c.unit || (store.products.find((p) => p.id === c.productId) || {}).unit || "MT"; for (const t of store.trades) { t.salesIds = t.salesIds || []; if (t.lines) for (const l of t.lines) { if (l.kind === "product" && !l.unit) l.unit = (store.products.find((p) => p.id === l.productId) || {}).unit || "MT"; } if (!t.lines) t.lines = [{ id: uid("ln"), kind: "product", productId: t.productId, qty: t.qty, unit: (store.products.find((p) => p.id === t.productId) || {}).unit || "MT", price: t.price, cargoId: t.cargoId || null, deliveredQty: t.deliveredQty != null ? t.deliveredQty : null }]; t.events = t.events || [{ date: t.date, type: "booked", text: "Trade booked" }]; t.vatRate = t.vatRate || 0; t.vatKind = t.vatKind || "standard"; t.doc = t.doc || {}; if (t.status === "delivered" && !t.events.some((x) => x.type === "delivered")) t.events.push({ by: who(store), date: t.deliveredDate || t.deliveryDate, type: "delivered", text: "Delivered" }); }
    for (const c of store.cargoes) { c.vatRate = c.vatRate || 0; c.vatKind = c.vatKind || "standard"; c.doc = c.doc || {}; }
    for (const i of store.invoices) { if (i.net == null) i.net = i.amount; if (i.vat == null) i.vat = 0; i.credited = i.credited || 0; if (!i.lines) { const t = store.trades.find((x) => x.id === i.tradeId); i.lines = t ? t.lines.map((l) => ({ ...l, qty: l.deliveredQty != null ? l.deliveredQty : l.qty })) : []; } }
    for (const b of store.bills) { if (b.net == null) b.net = b.amount; if (b.vat == null) b.vat = 0; b.credited = b.credited || 0; }
    store.version = 2; try { refreshGroupFx(store); } catch (e) { /* no table yet */ } return store;
  }
  const vatOf = (rate, kind) => (kind === "standard" ? +rate || 0 : 0);
  const vatLabel = (rate, kind) => (kind === "zero" ? "Zero-rated" : kind === "exempt" ? "Exempt" : kind === "out" ? "Out of scope" : (+rate || 0) + "%");

  // ---------------------------------------------------------------- ledger
  // Accounts: cash:<bankId> futures:<faId> inventory ar ap revenue cogs inventory_loss fees futures_pnl capital
  function setUser(store, name) { Object.defineProperty(store, "__user", { value: name || "", enumerable: false, writable: true, configurable: true }); }
  const who = (store) => store.__user || "";
  // 4.16: the lock is per entity (settings.locks[entityId]) on top of the global one; the later date wins
  function lockedFor(store, entityId) { const s = store.settings || {}; const g = s.lockedThrough || ""; const e = entityId && s.locks && s.locks[entityId] ? s.locks[entityId] : ""; return e > g ? e : g; }
  function post(store, entityId, date, memo, lines, ref) {
    const lock = lockedFor(store, entityId); if (lock && date <= lock) throw new Error("Period locked through " + lock + ": nothing can be posted on " + date + ". Reopen the period under Data → Period close if this is intended.");
    const dr = sum(lines, (l) => l.debit || 0), cr = sum(lines, (l) => l.credit || 0);
    if (Math.abs(dr - cr) > 0.005) throw new Error("Unbalanced posting: " + memo + " dr=" + dr + " cr=" + cr);
    const e = { id: uid("j"), entityId, date, memo, by: who(store), at: new Date().toISOString(), ref: ref || null, lines: lines.map((l) => ({ ...l, debit: r2(l.debit || 0), credit: r2(l.credit || 0) })) };
    store.ledger.push(e); invalidate(store);
    return e;
  }
  const bal = (store, entityId, pred, until) =>
    r2(sum(store.ledger.filter((j) => j.entityId === entityId && (!until || j.date <= until)), (j) => sum(j.lines.filter(pred), (l) => l.debit - l.credit)));

  function journal(store, d) {
    const rc = (store.entities.find((e) => e.id === d.entityId) || {}).currency;
    guard(store, "journal", { entityId: d.entityId, amount: sum(d.lines || [], (l) => +l.debit || 0), currency: rc, d });
    // 4.11.1: a line may carry its own currency and amount (Odoo-style "amount in currency"); debit/credit stay in the recording currency
    const lines = (d.lines || []).filter((l) => l.account && (+l.debit || +l.credit)).map((l) => { const o = { account: l.account, sub: l.sub || null, debit: r2(+l.debit || 0), credit: r2(+l.credit || 0) }; const cc = String(l.currency || "").toUpperCase(); if (cc && cc !== rc && +l.amount > 0) { o.currency = cc; o.amount = r2(+l.amount); if (+l.fx > 0) o.fx = +l.fx; } return o; });
    for (const l of lines) if (!ACCOUNT_META[l.account] && !customAccounts(store).some((a) => a.code === l.account)) throw new Error("Unknown account " + l.account);
    for (const l of lines) { const bk = l.sub && store.banks.find((b) => b.id === l.sub); if (l.account === "cash" && !bk) throw new Error("A line on Cash and bank needs the bank account in its Detail column, otherwise the money belongs to no account"); if (bk && bk.entityId !== d.entityId) throw new Error("Bank account " + bk.label + " belongs to another entity"); if (bk && l.account !== "cash") throw new Error("Bank account " + bk.label + " is always posted to Cash and bank; pick that account for the line, not " + l.account); if (bk && l.currency && l.currency !== bk.currency) throw new Error("Bank account " + bk.label + " is kept in " + bk.currency + "; enter that line in " + bk.currency); if (bk && bk.currency !== rc) { l.currency = bk.currency; if (!l.amount) l.amount = r2((l.debit || l.credit) / (bk.fx || 1)); } }
    if (lines.length < 2) throw new Error("A journal needs at least two lines");
    return post(store, d.entityId, d.date || today(), d.memo || "Manual journal", lines, { type: "journal", by: d.by || "", vesselId: d.vesselId || null, voyageId: d.voyageId || null, tradeId: d.tradeId || null, counterpartyId: d.counterpartyId || null, payee: d.payee || "" });
  }
  const PL_ACCOUNTS = ["revenue", "cogs", "inventory_loss", "fees", "expense", "other_income", "fx_diff", "futures_pnl"];
  function lastClose(store, entityId) { const c = store.closings.filter((x) => x.entityId === entityId).sort((a, b) => (a.date < b.date ? 1 : -1))[0]; return c ? c.date : null; }
  function closeYear(store, d) {
    const e = store.entities.find((x) => x.id === d.entityId); if (!e) throw new Error("Entity required"); const date = d.date; if (!date) throw new Error("Closing date required");
    const prev = lastClose(store, e.id); if (prev && date <= prev) throw new Error("Already closed through " + prev);
    const open = store.trades.filter((t) => t.entityId === e.id && t.status === "agreed" && t.deliveryDate <= date).length;
    const lines = []; let result = 0;
    for (const acct of PL_ACCOUNTS.concat(customAccounts(store).filter((a) => a.kind === "income" || a.kind === "expense").map((a) => a.code))) { const subs = {}; for (const j of store.ledger.filter((j) => j.entityId === e.id && j.date <= date && (!prev || j.date > prev))) for (const l of j.lines) if (l.account === acct) subs[l.sub || ""] = r2((subs[l.sub || ""] || 0) + l.debit - l.credit); for (const [sub, bal] of Object.entries(subs)) { if (!bal) continue; if (bal > 0) lines.push({ account: acct, sub: sub || null, credit: bal }); else lines.push({ account: acct, sub: sub || null, debit: -bal }); result -= bal; } }
    result = r2(result);
    if (!lines.length) throw new Error("Nothing to close: no profit or loss postings in the period");
    if (result >= 0) lines.push({ account: "retained_earnings", credit: result }); else lines.push({ account: "retained_earnings", debit: -result });
    const j = post(store, e.id, date, "Year-end close " + date + ": result " + fmtMoney(result) + " transferred to retained earnings", lines, { type: "close" });
    const c = { id: uid("yc"), entityId: e.id, date, result, journalId: j.id, openTrades: open, by: d.by || "" };
    store.closings.push(c);
    if (d.lock !== false) { if (!store.settings.lockedThrough || store.settings.lockedThrough < date) store.settings.lockedThrough = date; }
    return c;
  }
  const ACCOUNTS = ["retained_earnings", "cash", "futures", "inventory", "ar", "ap", "owners_due", "vat_input", "vat_output", "revenue", "cogs", "inventory_loss", "fees", "expense", "other_income", "fx_diff", "futures_pnl", "capital"];
  // ---------------------------------------------------------------- master data
  function addEntity(store, d) {
    // 4.21.2 · autoFx is kept (it was dropped before, so a manual rate became automatic on the next table); an automatic entity's group rate starts from the table
    const autoFx = d.autoFx !== false; const rc = (store.meta && store.meta.reportingCurrency) || "USD"; const ccy = String(d.currency || "USD").toUpperCase();
    const live = autoFx && ccy !== String(rc).toUpperCase() ? fxRateOn(store, ccy, rc) : null;
    const e = { id: uid("e"), name: d.name, country: d.country || "", currency: d.currency || "USD", autoFx, groupFx: ccy === String(rc).toUpperCase() ? 1 : (autoFx && live) || +d.groupFx || 1, fxRates: d.fxRates || {}, created: d.created || today(), notes: d.notes || "", address: d.address || "", trn: d.trn || "", phone: d.phone || "", email: d.email || "", bankDetails: d.bankDetails || "", docFooter: d.docFooter || "", signature: d.signature || "", stamp: d.stamp || "", signatory: d.signatory || "", altCurrency: d.altCurrency || "", altRate: +d.altRate || 0, docPrefix: d.docPrefix || "", logo: d.logo || "" };
    store.entities.push(e); return e;
  }
  function addBank(store, d) {
    const entCcy = (store.entities.find((e) => e.id === d.entityId) || {}).currency; const ccy = d.currency || entCcy || "USD";
    const b = { id: uid("b"), entityId: d.entityId, bank: d.bank, label: d.label || d.bank, currency: ccy, iban: d.iban || "", fx: ccy === entCcy ? 1 : (+d.fx || 1), type: d.type || "bank", swift: d.swift || "", accountName: d.accountName || "", onDocs: d.onDocs != null ? !!d.onDocs : (d.type || "bank") !== "cash" };
    store.banks.push(b); return b;
  }
  function fundBank(store, d) {
    const b = store.banks.find((x) => x.id === d.bankId); if (!b) throw new Error("Bank not found"); if (!(+d.amount > 0)) throw new Error("Amount must be greater than zero");
    const amt = +d.amount, base = r2(amt * (b.fx || 1));
    post(store, b.entityId, d.date || today(), d.memo || "Capital funding " + b.label, [
      { account: "cash", sub: b.id, debit: base, currency: b.currency, amount: amt },
      { account: "capital", credit: base },
    ], { type: "funding", bankId: b.id });
  }
  function transfer(store, d) {
    const from = store.banks.find((x) => x.id === d.fromId), to = store.banks.find((x) => x.id === d.toId);
    if (!from || !to || from.entityId !== to.entityId) throw new Error("Transfer must be between accounts of one entity"); if (from.id === to.id) throw new Error("Choose two different accounts"); if (!(+d.amount > 0)) throw new Error("Amount must be greater than zero");
    guard(store, "payment", { entityId: from.entityId, amount: +d.amount, currency: from.currency, d });
    const amt = +d.amount; const baseOut = r2(amt * (from.fx || 1));
    const received = d.receivedAmount != null && d.receivedAmount !== "" ? +d.receivedAmount : from.currency === to.currency ? amt : r2(baseOut / (to.fx || 1));
    const baseIn = r2(received * (to.fx || 1)); const diff = r2(baseIn - baseOut);
    const lines = [{ account: "cash", sub: to.id, debit: baseIn, currency: to.currency, amount: received }, { account: "cash", sub: from.id, credit: baseOut, currency: from.currency, amount: amt }];
    if (diff > 0) lines.push({ account: "fx_diff", credit: diff }); else if (diff < 0) lines.push({ account: "fx_diff", debit: -diff });
    const memo = d.memo || "Transfer " + from.label + " to " + to.label + (from.currency !== to.currency ? " (" + amt + " " + from.currency + " → " + received + " " + to.currency + ")" : "");
    post(store, from.entityId, d.date || today(), memo, lines, { type: "transfer" });
    if (+d.charge) bankTransaction(store, { __internal: true, bankId: from.id, kind: "out", category: "Bank charges", amount: +d.charge, vatRate: +d.chargeVat || 0, date: d.date, memo: d.chargeMemo || "Bank charges on transfer to " + to.label, __internal: true });
  }
  function bankTransaction(store, d) {
    const b = store.banks.find((x) => x.id === d.bankId); if (!b) throw new Error("Bank account required");
    const gross = +d.amount; if (!(gross > 0)) throw new Error("Amount must be greater than zero; use the direction field for money in or out");
    if (d.kind !== "in") guard(store, "payment", { entityId: b.entityId, amount: gross, currency: b.currency, d });
    const rate = d.rate ? +d.rate : (b.fx || 1); const vr = +d.vatRate || 0; const net = r2(gross / (1 + vr / 100)), vat = r2(gross - net);
    const category = d.category || "Other"; const baseGross = r2(gross * rate), baseVat = r2(vat * rate), baseNet = r2(baseGross - baseVat);
    // 4.19 · a line may be split across vessels and voyages (allocations); each part posts to its vessel's account (expense, or owners_due for an agency vessel)
    const allocs = checkAllocations(store, d.allocations, gross, { ps: d.ps });
    const tx = { id: uid("bt"), bankId: b.id, entityId: b.entityId, kind: d.kind === "in" ? "in" : "out", category, amount: gross, net, vat, vatRate: vr, currency: b.currency, date: d.date || today(), memo: d.memo || "", counterpartyId: d.counterpartyId || null, payee: d.payee || "", reference: d.reference || "", vesselId: allocs ? sameOf(allocs, "vesselId") : d.vesselId || null, voyageId: allocs ? sameOf(allocs, "voyageId") : d.voyageId || null, fixtureId: allocs ? sameOf(allocs, "fixtureId") : d.fixtureId || null, tradeId: d.tradeId || null, cargoId: d.cargoId || null };
    if (allocs) { tx.allocations = allocs; tx.allocated = true; }
    store.bankTx.push(tx);
    const parts = allocs || [{ vesselId: tx.vesselId, voyageId: tx.voyageId, fixtureId: tx.fixtureId, amount: gross, category: null }];
    const partLines = []; let left = baseNet; parts.forEach((pt, i) => { const bn = i === parts.length - 1 ? r2(left) : r2(baseNet * pt.amount / gross); left = r2(left - bn); const pf = postingFor(store, pt.vesselId, tx.kind === "out" ? "cost" : "income", pt.category || category); const tags = allocs || pt.vesselId ? { vesselId: pt.vesselId || null, voyageId: pt.voyageId || null, fixtureId: pt.fixtureId || null } : null; partLines.push(tx.kind === "out" ? { account: pf.account, sub: pf.sub, debit: bn, ...(tags ? { tags } : {}) } : { account: pf.account, sub: pf.sub, credit: bn, ...(tags ? { tags } : {}) }); });
    const lines = tx.kind === "out"
      ? [...partLines, ...(baseVat ? [{ account: "vat_input", debit: baseVat }] : []), { account: "cash", sub: b.id, credit: baseGross, currency: b.currency, amount: gross }]
      : [{ account: "cash", sub: b.id, debit: baseGross, currency: b.currency, amount: gross }, ...partLines, ...(baseVat ? [{ account: "vat_output", credit: baseVat }] : [])];
    const j = post(store, b.entityId, tx.date, (tx.kind === "out" ? category + (tx.payee ? " to " + tx.payee : "") + ": " : "Income, " + category + (tx.payee ? " from " + tx.payee : "") + ": ") + (tx.memo || b.label), lines, { type: "banktx", txId: tx.id, vesselId: tx.vesselId, voyageId: tx.voyageId || null, fixtureId: tx.fixtureId || null, tradeId: tx.tradeId, cargoId: tx.cargoId, counterpartyId: tx.counterpartyId, payee: tx.payee, allocated: !!allocs });
    tx.journalId = j.id; return tx;
  }
  function addFuturesAccount(store, d) {
    const f = { id: uid("f"), entityId: d.entityId, broker: d.broker, label: d.label || d.broker, currency: d.currency || "USD", fx: d.fx || 1 };
    store.futuresAccounts.push(f); return f;
  }
  function fundFutures(store, d) {
    const f = store.futuresAccounts.find((x) => x.id === d.accountId); if (!f) throw new Error("Futures account not found");
    const base = r2(+d.amount * (f.fx || 1));
    const lines = [{ account: "futures", sub: f.id, debit: base, currency: f.currency, amount: +d.amount }];
    if (d.fromBankId) { const b = store.banks.find((x) => x.id === d.fromBankId); lines.push({ account: "cash", sub: b.id, credit: base, currency: b.currency, amount: r2(base / (b.fx || 1)) }); }
    else lines.push({ account: "capital", credit: base });
    post(store, f.entityId, d.date || today(), d.memo || "Fund futures " + f.label, lines, { type: "futures_funding" });
  }
  function addCounterparty(store, d) {
    const c = { id: uid("c"), name: d.name, short: d.short || d.name.split(" ")[0], role: d.role || "customer", country: d.country || "", city: d.city || "",
      creditLimit: +d.creditLimit || 0, terms: +d.terms || 30, contact: d.contact || "", email: d.email || "", registration: d.registration || "", trn: d.trn || "", address: d.address || "", created: d.created || today(), notes: d.notes || "", vesselIds: d.vesselIds || [] };
    store.counterparties.push(c); return c;
  }
  function addVessel(store, d) {
    const v = { id: uid("v"), name: d.name, imo: d.imo || "", type: d.type || "Bulk carrier", flag: d.flag || "", dwt: +d.dwt || 0, built: +d.built || 0, notes: d.notes || "" };
    store.vessels.push(v); return v;
  }
  function linkVessel(store, cpId, vesselId) {
    const c = store.counterparties.find((x) => x.id === cpId); if (!c.vesselIds.includes(vesselId)) c.vesselIds.push(vesselId);
  }
  function unlinkVessel(store, cpId, vesselId) { const c = store.counterparties.find((x) => x.id === cpId); c.vesselIds = c.vesselIds.filter((v) => v !== vesselId); }
  const UNITS = ["MT", "CBM", "L", "KG", "BBL", "each"];
  const unitOf = (store, productId, given) => given || (store.products.find((p) => p.id === productId) || {}).unit || "MT";
  function addProduct(store, d) { const p = { id: uid("p"), code: d.code, name: d.name || d.code, grade: d.grade || "", density: +d.density || 0.98, unit: UNITS.includes(d.unit) ? d.unit : "MT" }; store.products.push(p); return p; }
  function addContract(store, d) {
    const c = { id: uid("k"), code: d.code, name: d.name || d.code, unit: d.unit || "MT", lotSize: +d.lotSize || 1000, mtPerUnit: +d.mtPerUnit || 1, marginPerLot: +d.marginPerLot || 0, feePerLot: +d.feePerLot || 0, productId: d.productId || null, lastMark: d.lastMark || null, markDate: d.markDate || null };
    store.contracts.push(c); return c;
  }

  // ---------------------------------------------------------------- 4.19 · two posting models per vessel (PROSHIP.md §25.1)
  // principal: a chartered-in or owned vessel — her invoices are revenue, her costs expenses, her result the company's.
  // agency: a vessel managed for an owner — freight, hire, demurrage, AWRP… are the owners' money (AR dr / owners_due cr), costs paid
  // or accrued on her reduce what is due to them (owners_due dr), only the manager's own kinds (management fee, commissions kept) are
  // revenue; a remittance clears owners_due. One place decides: postingFor(store, vesselId, kind, category) → { account, sub }.
  const REV_KIND_RE = [["despatch", /despatch/i], ["demurrage", /demurrage/i], ["ballastBonus", /ballast bonus/i], ["commissions", /address commission|brokerage/i], ["management_fee", /management fee|mgmt fee|manager'?s fee/i], ["awrp", /\bawrp\b|war risk/i], ["hire", /off-hire|hire/i], ["freight", /freight|deadfreight/i], ["claim", /claim/i]];
  function revKindOf(desc, meta) { for (const [k, re] of REV_KIND_RE) if (re.test(desc || "")) return k; const mk = meta && meta.kind; if (mk === "freight" || mk === "hire" || mk === "demurrage" || mk === "claim" || mk === "awrp" || mk === "management_fee" || mk === "despatch") return mk; return "other"; }
  const MANAGER_KINDS = new Set(["management_fee", "commissions"]);
  const DEFAULT_MANAGER_CATS = ["Bank charges", "Management fee", "Office", "Salaries"];
  const vesselModel = (store, vesselId) => { const v = vesselId && (store.vessels || []).find((x) => x.id === vesselId); return v && v.accounting === "agency" ? "agency" : "principal"; };
  function setVesselAccounting(store, vesselId, model, fromDate) { const v = (store.vessels || []).find((x) => x.id === vesselId); if (!v) throw new Error("Unknown vessel"); if (!["principal", "agency"].includes(model)) throw new Error("The posting model is principal (own P&L) or agency (owners' money)"); if ((v.accounting || "principal") !== model) { v.accounting = model; v.accountingSince = fromDate || today(); audit(store, { kind: "vessel", action: "accounting", refKind: "vessel", refId: v.id, text: v.name + " booked as " + (model === "agency" ? "owners' money (agency)" : "own P&L (principal)") + " from " + v.accountingSince, detail: { model, from: v.accountingSince } }); } invalidate(store); return v; }
  function setVesselEntity(store, vesselId, entityId, fromDate) { const v = (store.vessels || []).find((x) => x.id === vesselId); if (!v) throw new Error("Unknown vessel"); if (entityId && !store.entities.some((e) => e.id === entityId)) throw new Error("Unknown entity"); if ((v.entityId || null) !== (entityId || null)) { v.entityId = entityId || null; v.entitySince = fromDate || today(); audit(store, { kind: "vessel", action: "entity", refKind: "vessel", refId: v.id, entityId: entityId || null, text: v.name + (entityId ? " on the account of " + ((store.entities.find((e) => e.id === entityId) || {}).name || entityId) : " no longer booked on an entity") + " from " + v.entitySince, detail: { entityId: entityId || null, from: v.entitySince } }); } invalidate(store); return v; }
  function vesselEntity(store, vesselId) { const v = vesselId && (store.vessels || []).find((x) => x.id === vesselId); if (!v) return null; if (v.entityId) return v.entityId; const last = [...(store.invoices || []).filter((i) => i.vesselId === vesselId), ...(store.bills || []).filter((b) => b.vesselId === vesselId), ...(store.bankTx || []).filter((t) => t.vesselId === vesselId)].sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")))[0]; return last ? last.entityId || null : null; }
  const managerCats = (store) => new Set(((store.settings && Array.isArray(store.settings.managerCostCategories)) ? store.settings.managerCostCategories : DEFAULT_MANAGER_CATS).map((c) => String(c).toLowerCase()));
  function postingFor(store, vesselId, kind, category) {
    const agency = vesselModel(store, vesselId) === "agency";
    if (kind === "cost") { if (agency && !managerCats(store).has(String(category || "").toLowerCase())) return { account: "owners_due", sub: vesselId }; return { account: "expense", sub: category || "Other" }; }
    if (kind === "income") { if (agency) return { account: "owners_due", sub: vesselId }; return { account: "other_income", sub: category || "Other" }; }
    if (kind === "fees") return agency ? { account: "owners_due", sub: vesselId } : { account: "fees", sub: category || null };
    if (agency && !MANAGER_KINDS.has(kind)) return { account: "owners_due", sub: vesselId };
    return { account: "revenue", sub: category || "services" };
  }
  // allocations: [{ vesselId, voyageId?, fixtureId?, invoiceId?, billId?, amount, category? }] summing to the document amount
  function checkAllocations(store, allocs, amount, opt) {
    opt = opt || {}; const list = (allocs || []).map((a) => ({ vesselId: a.vesselId || null, voyageId: a.voyageId || null, fixtureId: a.fixtureId || null, invoiceId: a.invoiceId || null, billId: a.billId || null, amount: r2(+a.amount || 0), category: a.category || null })).filter((a) => a.amount !== 0);
    if (!list.length) return null; for (const a of list) { if (a.amount < 0) throw new Error("An allocation cannot be negative"); if (a.vesselId && !store.vessels.some((v) => v.id === a.vesselId)) throw new Error("Unknown vessel in an allocation"); if (!a.vesselId && !a.invoiceId && !a.billId) throw new Error("Each allocation names a vessel (or an invoice / bill)"); const ps = opt.ps || store.__ps; if (ps && a.vesselId) { if (a.voyageId) { const vy = (ps.voyages || []).find((x) => x.id === a.voyageId); if (!vy) throw new Error("Unknown voyage in an allocation"); if (vy.vesselId !== a.vesselId) throw new Error("Voyage " + (vy.no || "") + " is not a voyage of that vessel"); } if (a.fixtureId) { const f = (ps.fixtures || []).find((x) => x.id === a.fixtureId); if (!f) throw new Error("Unknown fixture in an allocation"); if (f.vesselId !== a.vesselId) throw new Error("That fixture belongs to another vessel"); } } }
    if (amount != null && Math.abs(r2(sum(list, (a) => a.amount)) - r2(+amount)) > 0.005) throw new Error("The allocations add up to " + fmtMoney(sum(list, (a) => a.amount)) + ", the amount is " + fmtMoney(+amount) + " — the split must match the amount");
    return list;
  }
  const sameOf = (list, k) => { const vals = [...new Set(list.map((a) => a[k] || null))]; return vals.length === 1 ? vals[0] : null; };

  // trade lines: product lines (MT, sourced from a cargo) and service lines (surveyor, barge, agency...) billed to the customer
  const lineQty = (l) => (l.deliveredQty != null ? l.deliveredQty : +l.qty || 0);
  const lineNet = (l) => r2(lineQty(l) * (+l.price || 0));
  const productLines = (t) => (t.lines || []).filter((l) => l.kind === "product");
  const productMT = (t) => r2(sum(productLines(t), lineQty));
  const tradeValue = (t) => r2(sum(t.lines || [], lineNet));
  const normLines = (d) => { d.__store = d.__store || normLines.store;
    const hasPrice = (l) => l.price != null && l.price !== "" && !isNaN(+l.price);
    const posQty = (l) => +l.qty > 0;
    let lines = (d.lines || []).filter((l) => (l.kind === "service" ? (l.description && hasPrice(l) && +l.price >= 0) : (l.productId && posQty(l) && hasPrice(l) && +l.price >= 0))).map((l) => ({ id: l.id || uid("ln"), kind: l.kind === "service" ? "service" : "product", catalogId: l.catalogId || null, productId: l.kind === "service" ? null : l.productId, description: l.description || "", qty: l.kind === "service" ? (+l.qty || 1) : +l.qty, unit: l.kind === "service" ? (l.unit || "each") : unitOf(d.__store, l.productId, UNITS.includes(l.unit) ? l.unit : null), price: +l.price, cargoId: l.kind === "service" ? null : (l.cargoId || null), cost: l.kind === "service" ? (+l.cost || 0) : 0, vendorId: l.kind === "service" ? (l.vendorId || null) : null, deliveredQty: null, b2b: l.kind === "product" && !l.cargoId && (l.b2b || l.cargoId === "__b2b") ? { supplierId: l.supplierId || null, buyPrice: +l.buyPrice || 0, supplierTerms: l.supplierTerms ? +l.supplierTerms : undefined, vatRate: l.buyVatRate, vatKind: l.buyVatKind } : null }));
    if (!lines.some((l) => l.kind === "product") && d.productId && +d.qty && +d.price) lines.unshift({ id: uid("ln"), kind: "product", productId: d.productId, description: "", qty: +d.qty, unit: unitOf(d.__store, d.productId, null), price: +d.price, cargoId: d.cargoId || null, cost: 0, deliveredQty: null, b2b: d.backToBack && !d.cargoId ? { supplierId: d.supplierId, buyPrice: +d.buyPrice || 0, supplierTerms: d.supplierTerms } : null });
    return lines;
  };
  function nextRef(store, coll, entityId, tag) { const e = store.entities.find((x) => x.id === entityId) || {}; const pre = e.docPrefix || ""; let n = store[coll].filter((x) => x.entityId === entityId).length + 1; let ref = pre + tag + "-" + String(n).padStart(4, "0"); while (store[coll].some((x) => x.ref === ref)) ref = pre + tag + "-" + String(++n).padStart(4, "0"); return ref; }
  // ---------------------------------------------------------------- cargo (purchase)
  function addCargo(store, d) {
    const ent = store.entities.find((e) => e.id === d.entityId); if (!ent) throw new Error("Entity required");
    if (!(+d.qty > 0)) throw new Error("Quantity must be greater than zero"); if (!(+d.price >= 0)) throw new Error("Price cannot be negative"); if (!store.products.find((p) => p.id === d.productId)) throw new Error("Product required"); d = { ...d, unit: unitOf(store, d.productId, UNITS.includes(d.unit) ? d.unit : null) };
    const sup = store.counterparties.find((c) => c.id === d.supplierId);
    const costs = (d.costs || []).filter((c) => +c.amount).map((c) => ({ label: c.label, amount: r2(+c.amount) }));
    const fx = autoFx(store, d.entityId, d.currency, d.date, d.fx);
    const c = { id: uid("g"), ref: d.ref || nextRef(store, "cargoes", ent.id, "CGO"), createdBy: who(store), entityId: ent.id, supplierId: sup ? sup.id : null, productId: d.productId, unit: d.unit,
      qty: +d.qty, price: +d.price, currency: d.currency || ent.currency, fx, costs, port: d.port || "", country: d.country || "", date: d.date || today(), terms: +d.terms || (sup ? sup.terms : 30),
      allowancePct: d.allowancePct != null ? +d.allowancePct : store.settings.lossAllowanceDefaultPct, received: false, deliveryMode: d.deliveryMode || "ex-tank", note: d.note || "", createdFrom: d.createdFrom || null,
      vatRate: +d.vatRate || 0, vatKind: d.vatKind || "standard", doc: d.doc || {} };
    store.cargoes.push(c); invalidate(store);
    if (sup) autoScreen(store, "counterparty", sup.id);
    if (d.received === false) { const net = cargoLanded(c), vr = vatOf(c.vatRate, c.vatKind), vat = r2(net * vr / 100); store.bills.push({ id: uid("bl"), ref: nextRef(store, "bills", c.entityId, "BILL"), entityId: c.entityId, counterpartyId: c.supplierId, cargoId: c.id, date: c.date, due: addDays(c.date, c.terms), net, vat, vatRate: vr, vatKind: c.vatKind, amount: r2(net + vat), currency: c.currency, fx: c.fx, paid: 0, credited: 0, pending: true }); }
    if (d.received !== false) receiveCargo(store, c.id, c.date);
    return c;
  }
  const cargoGross = (c) => r2(c.qty * c.price);
  const cargoLanded = (c) => r2(cargoGross(c) + sum(c.costs, (x) => x.amount));
  const cargoUnitCost = (c) => (c.qty ? cargoLanded(c) / c.qty : 0);
  function receiveCargo(store, cargoId, date, opt) {
    const c = store.cargoes.find((x) => x.id === cargoId); if (c.received) return store.bills.find((b) => b.cargoId === c.id);
    if ((date || today()) > today()) throw new Error("Receipt date cannot be in the future");
    if (opt && opt.qty != null && +opt.qty > 0) c.qty = +opt.qty;
    c.received = true; c.receivedDate = date || today();
    const net = cargoLanded(c), vr = vatOf(c.vatRate, c.vatKind), vat = r2(net * vr / 100), gross = r2(net + vat);
    const base = r2(net * c.fx), baseVat = r2(vat * c.fx);
    let bill = store.bills.find((b) => b.cargoId === c.id);
    if (bill) Object.assign(bill, { pending: false, date: c.receivedDate, due: addDays(c.receivedDate, c.terms), net, vat, vatRate: vr, vatKind: c.vatKind, amount: gross });
    else { bill = { id: uid("bl"), ref: nextRef(store, "bills", c.entityId, "BILL"), entityId: c.entityId, counterpartyId: c.supplierId, cargoId: c.id, date: c.receivedDate, due: addDays(c.receivedDate, c.terms), net, vat, vatRate: vr, vatKind: c.vatKind, amount: gross, currency: c.currency, fx: c.fx, paid: 0, credited: 0 }; store.bills.push(bill); }
    const lines = [{ account: "inventory", sub: c.id, debit: base }];
    if (baseVat) lines.push({ account: "vat_input", debit: baseVat });
    lines.push({ account: "ap", sub: c.supplierId, credit: r2(base + baseVat), currency: c.currency, amount: gross });
    post(store, c.entityId, c.receivedDate, "Cargo " + c.ref + " received", lines, { type: "cargo", cargoId: c.id, billId: bill.id });
    return bill;
  }
  function recordCargoLoss(store, d) {
    const c = store.cargoes.find((x) => x.id === d.cargoId); if (!c) throw new Error("Cargo required"); if (!(+d.qty > 0)) throw new Error("Loss quantity must be greater than zero"); const stL = cargoStatus(store, c); if (+d.qty > stL.physical + 0.001) throw new Error("Loss of " + fmtQty(+d.qty) + " MT exceeds the " + fmtQty(stL.physical) + " MT physically left");
    const l = { id: uid("l"), cargoId: c.id, qty: +d.qty, date: d.date || today(), reason: d.reason || "Shrinkage / evaporation" };
    store.cargoLosses.push(l);
    const base = r2(l.qty * cargoUnitCost(c) * c.fx);
    post(store, c.entityId, l.date, "Loss " + l.qty + " MT on " + c.ref + " (" + l.reason + ")", [
      { account: "inventory_loss", sub: c.id, debit: base }, { account: "inventory", sub: c.id, credit: base },
    ], { type: "loss", cargoId: c.id });
    return l;
  }
  const fingerprint = (store) => store.trades.length + ":" + store.cargoes.length + ":" + store.cargoLosses.length + ":" + store.ledger.length + ":" + store.invoices.length + ":" + store.bills.length + ":" + store.payments.length;
  function cargoStatus(store, c) {
    if (!store.__cache) Object.defineProperty(store, "__cache", { value: { profiles: {}, stmts: {}, banks: {}, cargo: {} }, enumerable: false, writable: true, configurable: true });
    const fp = fingerprint(store); if (store.__cache.fp !== fp) { store.__cache.fp = fp; store.__cache.cargo = {}; store.__cache.profiles = {}; store.__cache.stmts = {}; store.__cache.banks = {}; }
    if (!store.__cache.cargo) store.__cache.cargo = {}; if (store.__cache.cargo[c.id]) return store.__cache.cargo[c.id];
    const r = cargoStatusCalc(store, c); store.__cache.cargo[c.id] = r; return r;
  }
  function cargoStatusCalc(store, c) {
    const live = store.trades.filter((t) => t.status !== "cancelled");
    const delivered = sum(live.filter((t) => t.status === "delivered"), (t) => sum(productLines(t).filter((l) => l.cargoId === c.id), lineQty));
    const committed = sum(live.filter((t) => t.status === "agreed"), (t) => sum(productLines(t).filter((l) => l.cargoId === c.id), lineQty));
    const lost = sum(store.cargoLosses.filter((l) => l.cargoId === c.id), (l) => l.qty);
    const allowance = r2(c.qty * (c.allowancePct / 100));
    const physical = r2(c.qty - delivered - lost);                       // actually in tank; matches the inventory ledger
    const sellable = r2(Math.max(0, physical - committed - Math.max(0, allowance - lost)));
    const trades = live.filter((t) => productLines(t).some((l) => l.cargoId === c.id));
    return { allocated: r2(delivered + committed), delivered: r2(delivered), committed: r2(committed), lost: r2(lost), allowance, physical, sellable, unitCost: cargoUnitCost(c), landed: cargoLanded(c), gross: cargoGross(c), ageDays: daysBetween(c.date, today()), trades,
      pctAllocated: c.qty ? (delivered + committed) / c.qty : 0 };
  }


  // ---------------------------------------------------------------- inter-company cargo transfer
  function internalCp(store, entityId) {
    const e = store.entities.find((x) => x.id === entityId); let cp = store.counterparties.find((c) => c.internalEntityId === entityId);
    if (!cp) { cp = addCounterparty(store, { name: e.name + " (internal)", short: e.name, role: "both", country: e.country, terms: 30, creditLimit: 0, trn: e.trn, address: e.address, notes: "Internal: group entity " + e.name }); cp.internalEntityId = entityId; cp.internal = true; recordScreening(store, { type: "counterparty", id: cp.id, by: "Engine (internal entity)", result: "clear" }); }
    return cp;
  }
  function transferCargo(store, d) {
    const c = store.cargoes.find((x) => x.id === d.cargoId); if (!c) throw new Error("Cargo required"); if (!c.received) throw new Error("Cargo must be received before it can be transferred");
    const to = store.entities.find((x) => x.id === d.toEntityId); if (!to) throw new Error("Receiving entity required"); if (to.id === c.entityId) throw new Error("Choose a different entity");
    const st = cargoStatus(store, c); const qty = d.qty != null && d.qty !== "" ? +d.qty : st.sellable; if (qty <= 0 || qty > st.sellable + 0.001) throw new Error("Quantity must be between 0 and the sellable " + fmtQty(st.sellable) + " MT");
    const price = +d.price || 0; const date = d.date || today(); const terms = d.terms != null && d.terms !== "" ? +d.terms : 30;
    const buyerCp = internalCp(store, to.id), sellerCp = internalCp(store, c.entityId);
    const t = addTrade(store, { entityId: c.entityId, customerId: buyerCp.id, port: c.port, country: c.country, date, deliveryDate: date, terms, currency: c.currency, fx: c.fx, vatKind: d.vatKind || "out", vatRate: d.vatRate || 0, note: d.note || "", lines: [{ kind: "product", productId: c.productId, qty, unit: c.unit, price, cargoId: c.id }], delivered: true, buyerRef: "Internal transfer to " + to.name });
    t.internalTransfer = { toEntityId: to.id, fromCargoId: c.id };
    const cargoB = addCargo(store, { entityId: to.id, supplierId: sellerCp.id, productId: c.productId, qty, unit: c.unit, price, currency: c.currency, fx: d.fxTo != null && d.fxTo !== "" ? +d.fxTo : (to.currency === c.currency ? 1 : c.fx), port: c.port, country: c.country, date, terms, allowancePct: d.allowancePct != null && d.allowancePct !== "" ? +d.allowancePct : c.allowancePct, received: true, deliveryMode: c.deliveryMode, note: "Transferred from " + (store.entities.find((x) => x.id === c.entityId) || {}).name + " · " + c.ref + " · " + t.ref });
    cargoB.transferredFrom = { cargoId: c.id, tradeId: t.id, entityId: c.entityId }; t.internalTransfer.toCargoId = cargoB.id;
    const inv = store.invoices.find((i) => i.tradeId === t.id); const bill = store.bills.find((b) => b.cargoId === cargoB.id); if (inv && bill) { bill.intercompanyInvoiceId = inv.id; inv.intercompanyBillId = bill.id; }
    t.events.push({ date, type: "note", text: "Internal transfer: " + fmtQty(qty) + " MT moved to " + to.name + " as " + cargoB.ref + " at " + fmtMoney(price) + "/MT (cost " + fmtMoney(st.unitCost) + "/MT, result " + fmtMoney((price - st.unitCost) * qty) + ")" });
    return { trade: t, cargo: cargoB, invoice: inv, bill, result: r2((price - st.unitCost) * qty) };
  }
  // ---------------------------------------------------------------- trades (sales / allocations)
  function addPerson(store, d) { if (!d.name) throw new Error("Name required"); const p = { id: uid("pp"), name: d.name.trim(), initials: (d.initials || d.name.split(/\s+/).map((w) => w[0]).join("").slice(0, 3)).toUpperCase(), active: true, email: d.email || "" }; store.people.push(p); return p; }
  function salesReport(store, opt) {
    const { entityId, from, to } = opt || {}; const rows = {}; const inR = (d) => (!from || d >= from) && (!to || d <= to);
    for (const t of store.trades) { if (!entIn(t.entityId, entityId) || t.status === "cancelled") continue; const dt = t.deliveredDate || t.deliveryDate; if (!inR(dt)) continue; const ids = (t.salesIds || []).length ? t.salesIds : ["__none"]; const share = 1 / ids.length; const m = tradeMargin(store, t); const k = groupRate(store, t.entityId, entityId);
      for (const id of ids) { const r = (rows[id] = rows[id] || { id, name: id === "__none" ? "Unassigned" : ((store.people.find((p) => p.id === id) || {}).name || "?"), trades: 0, delivered: 0, mt: 0, revenue: 0, cogs: 0, other: 0, margin: 0, customers: new Set() }); r.trades += share; if (t.status === "delivered") r.delivered += share; r.mt += productMT(t) * share; r.revenue += tradeValue(t) * t.fx * k * share; if (m.total != null) { r.cogs += (m.cogs || 0) * t.fx * k * share; r.other += (m.other || 0) * t.fx * k * share; r.margin += m.total * t.fx * k * share; } r.customers.add(t.customerId); } }
    return Object.values(rows).map((r) => ({ ...r, trades: r2(r.trades), delivered: r2(r.delivered), mt: r2(r.mt), revenue: r2(r.revenue), cogs: r2(r.cogs), other: r2(r.other), margin: r2(r.margin), marginMT: r.mt ? r2(r.margin / r.mt) : 0, marginPct: r.revenue ? r.margin / r.revenue : 0, customers: r.customers.size })).sort((a, b) => b.margin - a.margin);
  }
  function addTrade(store, d) {
    const ent = store.entities.find((e) => e.id === d.entityId); if (!ent) throw new Error("Entity required");
    const cust = store.counterparties.find((c) => c.id === d.customerId); if (!cust) throw new Error("Customer required");
    normLines.store = store; const lines = normLines(d); const prim = lines.find((l) => l.kind === "product") || null; if (!prim && !lines.some((l) => l.kind === "service")) throw new Error("A trade needs at least one product or service line");
    d = { ...d, productId: prim ? prim.productId : null, qty: prim ? prim.qty : 0, price: prim ? prim.price : 0, cargoId: prim ? prim.cargoId : null };
    { const need = {}; for (const l of lines) if (l.kind === "product" && l.cargoId) { const cg = store.cargoes.find((c) => c.id === l.cargoId); if (!cg) throw new Error("Cargo not found for a line"); if (cg.entityId !== ent.id) throw new Error("Cargo " + cg.ref + " belongs to " + (store.entities.find((e) => e.id === cg.entityId) || {}).name + ", not to " + ent.name + " — transfer it first"); if (cg.productId !== l.productId) throw new Error("Cargo " + cg.ref + " is " + (store.products.find((p) => p.id === cg.productId) || {}).code + ", the line is " + (store.products.find((p) => p.id === l.productId) || {}).code); if ((cg.unit || "MT") !== (l.unit || "MT")) throw new Error("Cargo " + cg.ref + " is in " + (cg.unit || "MT") + ", the line is in " + l.unit); need[cg.id] = (need[cg.id] || 0) + l.qty; } for (const [cid, q] of Object.entries(need)) { const cg = store.cargoes.find((c) => c.id === cid); const st = cargoStatus(store, cg); if (q > st.sellable + 0.001) throw new Error("Lines take " + fmtQty(q) + " MT from " + cg.ref + " but only " + fmtQty(st.sellable) + " MT is sellable"); } }
    let cargoId = d.cargoId || null; const b2bCargoes = [];
    for (const l of lines) if (l.kind === "product" && !l.cargoId && l.b2b && !(l.b2b.buyPrice > 0 && l.b2b.supplierId)) { l.b2bPending = true; }
    for (const l of lines) if (l.kind === "product" && !l.cargoId && l.b2b && l.b2b.buyPrice > 0 && l.b2b.supplierId) {
      const cg = addCargo(store, { entityId: ent.id, supplierId: l.b2b.supplierId, productId: l.productId, qty: l.qty, unit: l.unit, price: l.b2b.buyPrice, currency: d.currency, fx: d.fx, port: d.port, country: d.country,
        date: d.deliveryDate || today(), terms: l.b2b.supplierTerms, allowancePct: 0, received: !!d.delivered, deliveryMode: "back-to-back", createdFrom: "trade", vatRate: l.b2b.vatRate, vatKind: l.b2b.vatKind });
      l.cargoId = cg.id; b2bCargoes.push(cg); if (l === prim) cargoId = cg.id;
    }
    for (const l of lines) delete l.b2b;
    const t = { id: uid("t"), ref: d.ref || nextRef(store, "trades", ent.id, "TRD"), entityId: ent.id, customerId: cust.id, vesselId: d.vesselId || null, productId: d.productId, cargoId,
      lines, createdBy: who(store), createdAt: new Date().toISOString(), salesIds: Array.isArray(d.salesIds) ? d.salesIds.filter(Boolean) : [], qty: +d.qty, price: +d.price, currency: d.currency || ent.currency, fx: autoFx(store, ent.id, d.currency || ent.currency, d.date, d.fx), port: d.port || "", country: d.country || "", date: d.date || today(), deliveryDate: d.deliveryDate || d.date || today(),
      terms: d.terms != null ? +d.terms : cust.terms, status: "agreed", deliveredQty: null, note: d.note || "", costs: (d.costs || []).filter((c) => +c.amount).map((c) => ({ label: c.label, amount: r2(+c.amount), vendorId: c.vendorId || null })),
      vatRate: +d.vatRate || 0, vatKind: d.vatKind || "standard", altCurrency: d.altCurrency || "", altRate: +d.altRate || 0, eta: d.eta || "", agent: d.agent || "", buyerRef: d.buyerRef || "", bdnNo: d.bdnNo || "", doc: d.doc || {}, fixtureId: d.fixtureId || null, voyageId: d.voyageId || (d.meta && d.meta.voyageId) || null, meta: d.meta && typeof d.meta === "object" ? d.meta : null, events: [{ date: d.date || today(), type: "booked", text: "Trade booked" + (cargoId ? ", sourced from " + (store.cargoes.find((c) => c.id === cargoId) || {}).ref : ", unsourced") }] };
    if (prim) prim.cargoId = cargoId; store.trades.push(t); invalidate(store);
    for (const cg of b2bCargoes) { cg.createdFromTradeId = t.id; t.events.push({ by: who(store), date: t.date, type: "allocated", text: "Back-to-back purchase " + cg.ref + ": " + fmtQty(cg.qty) + " MT " + (store.products.find((p) => p.id === cg.productId) || {}).code + " from " + ((store.counterparties.find((c) => c.id === cg.supplierId) || {}).short || "supplier") + " at " + fmtMoney(cg.price) + "/MT" }); }
    autoScreen(store, "counterparty", cust.id); if (t.vesselId) autoScreen(store, "vessel", t.vesselId);
    if (d.delivered) deliverTrade(store, t.id, { date: t.deliveryDate, invoice: d.invoice || null });
    return t;
  }
  function deliverTrade(store, tradeId, d) {
    const t = store.trades.find((x) => x.id === tradeId); if (t.status === "delivered") return; d = d || {};
    const dDate = d.date || t.deliveryDate; if (dDate > today()) throw new Error("Delivery date " + dDate + " is in the future; enter the actual delivery date");
    if (productLines(t).some((l) => l.b2bPending)) throw new Error("The purchase side of this back-to-back trade is still missing; add it first (Workflow → Add purchase)");
    const ent = store.entities.find((e) => e.id === t.entityId) || {};
    const planned = {}; for (const l of t.lines) if (l.kind === "product") { const q = d.qtys && d.qtys[l.id] != null && d.qtys[l.id] !== "" ? +d.qtys[l.id] : (d.qty != null && l === t.lines[0] ? +d.qty : l.qty); if (!(q >= 0)) throw new Error("Delivered quantity cannot be negative"); planned[l.id] = q; }
    for (const l of productLines(t)) { const c = store.cargoes.find((x) => x.id === l.cargoId); if (!c || c.createdFromTradeId === t.id) continue; const st = cargoStatus(store, c); const others = sum(productLines(t).filter((x) => x.cargoId === c.id && x !== l), (x) => planned[x.id] - lineQty(x)); if (planned[l.id] - lineQty(l) + others > st.sellable + 0.001) throw new Error("Delivered " + fmtQty(planned[l.id]) + " MT exceeds what " + c.ref + " has left (" + fmtQty(st.sellable + lineQty(l)) + " MT for this line)"); }
    t.status = "delivered"; t.deliveredDate = d.date || t.deliveryDate;
    for (const l of t.lines) if (l.kind === "product") l.deliveredQty = planned[l.id]; invalidate(store);
    t.deliveredQty = productMT(t);
    for (const l of productLines(t)) { const c = store.cargoes.find((x) => x.id === l.cargoId); if (c && !c.received && c.createdFromTradeId === t.id) receiveCargo(store, c.id, t.deliveredDate, { qty: lineQty(l) }); }
    const revenue = tradeValue(t), base = r2(revenue * t.fx);
    const vr = vatOf(t.vatRate, t.vatKind), vat = r2(revenue * vr / 100), gross = r2(revenue + vat), baseVat = r2(vat * t.fx);
    // x.y · an invoice that already exists outside XYNTAX is recorded under its own number and due date (d.invoice.recorded): the
    // books take it like any other invoice, the document is marked as a record so nothing prints it as if XYNTAX had issued it
    const ext = d.invoice && d.invoice.recorded ? d.invoice : null; if (ext) { const r0 = String(ext.ref || "").trim(); if (!r0) throw new Error("The invoice number is required"); if (store.invoices.some((x) => x.entityId === t.entityId && String(x.ref).toLowerCase() === r0.toLowerCase())) throw new Error("Invoice " + r0 + " is already in the books"); if (ext.due && ext.due < t.deliveredDate) throw new Error("The due date is before the invoice date"); }
    const inv = { id: uid("in"), ref: ext ? String(ext.ref).trim() : nextRef(store, "invoices", t.entityId, "INV"), altCurrency: t.altCurrency || ent.altCurrency || "", altRate: +t.altRate || +ent.altRate || 0, entityId: t.entityId, counterpartyId: t.customerId, tradeId: t.id, date: t.deliveredDate, due: ext && ext.due ? ext.due : addDays(t.deliveredDate, t.terms), net: revenue, vat, vatRate: vr, vatKind: t.vatKind, amount: gross, currency: t.currency, fx: t.fx, paid: 0, credited: 0,
      lines: t.lines.map((l) => ({ ...l, qty: lineQty(l) })), vesselId: t.vesselId || null, fixtureId: t.fixtureId || null, voyageId: t.voyageId || null, meta: t.meta || null };
    if (ext) { inv.recorded = true; inv.origin = "external"; if (ext.note) inv.memo = String(ext.note); }
    store.invoices.push(inv);
    if (d.bdnNo) t.bdnNo = d.bdnNo;
    t.events.push({ by: who(store), date: t.deliveredDate, type: "delivered", text: "Delivered " + fmtQty(t.deliveredQty) + " MT" + (t.bdnNo ? ", BDN " + t.bdnNo : "") }, { by: who(store), date: t.deliveredDate, type: "invoiced", text: inv.ref + (ext ? " recorded (issued outside XYNTAX)" : " raised") + ", due " + inv.due });
    const lines = [{ account: "ar", sub: t.customerId, debit: r2(base + baseVat), currency: t.currency, amount: gross }];
    // 4.19 · an agency vessel's freight/hire/demurrage… is the owners' money (owners_due); the manager's fee and kept commissions are revenue
    const agency = !!t.vesselId && vesselModel(store, t.vesselId) === "agency";
    for (const l of t.lines) { const ln = r2(lineNet(l) * t.fx); if (!ln) continue; const rk = l.kind === "product" ? "other" : revKindOf(l.description, t.meta); const pf = agency ? postingFor(store, t.vesselId, rk === "commissions" && ln < 0 ? "deduction" : rk, l.productId || "services") : { account: "revenue", sub: l.productId || "services" }; lines.push({ account: pf.account, sub: pf.sub, credit: ln, ...(agency ? { tags: { vesselId: t.vesselId, voyageId: t.voyageId || null, fixtureId: t.fixtureId || null, kind: revKindOf(l.description, t.meta) } } : {}) }); }
    // 4.17 · each line is rounded on its own; the cents left over (many lines × a rate) go onto the largest line so the journal balances
    { const rev = lines.filter((x) => x.account === "revenue" || x.account === "owners_due"); const diff = r2(base - sum(rev, (x) => x.credit)); if (rev.length && Math.abs(diff) >= 0.005) { const big = rev.reduce((a, b) => (Math.abs(b.credit) > Math.abs(a.credit) ? b : a)); big.credit = r2(big.credit + diff); } }
    if (baseVat) lines.push({ account: "vat_output", credit: baseVat });
    for (const l of productLines(t)) { const c = store.cargoes.find((x) => x.id === l.cargoId); if (!c) continue; const cogs = r2(lineQty(l) * cargoUnitCost(c) * c.fx); if (cogs) lines.push({ account: "cogs", sub: l.productId, debit: cogs }, { account: "inventory", sub: c.id, credit: cogs }); }
    const costItems = [...(t.costs || []).map((c) => ({ label: c.label, amount: r2(c.amount), vendorId: c.vendorId || null })), ...t.lines.filter((l) => l.kind === "service" && +l.cost).map((l) => ({ label: l.description + " (cost)", amount: r2(+l.cost), vendorId: l.vendorId || null }))];
    const byVendor = {}; for (const x of costItems) (byVendor[x.vendorId || ""] = byVendor[x.vendorId || ""] || []).push(x);
    for (const [vid, items] of Object.entries(byVendor)) { const amt = r2(sum(items, (x) => x.amount) * t.fx); if (amt) { const pf = postingFor(store, t.vesselId, "fees", t.id); lines.push({ account: pf.account, sub: pf.sub, debit: amt, ...(agency ? { tags: { vesselId: t.vesselId, voyageId: t.voyageId || null, fixtureId: t.fixtureId || null } } : {}) }, { account: "ap", sub: vid || null, credit: amt, currency: t.currency, amount: r2(sum(items, (x) => x.amount)) }); } }
    post(store, t.entityId, t.deliveredDate, "Delivery " + t.ref + " to " + (store.counterparties.find((x) => x.id === t.customerId) || {}).name, lines, { type: "delivery", tradeId: t.id, invoiceId: inv.id, vesselId: t.vesselId || null, fixtureId: t.fixtureId || null, voyageId: t.voyageId || null });
    // every cost becomes a payable bill: one bill per vendor (or one unassigned bill), with the cost lines on it
    for (const [vid, items] of Object.entries(byVendor)) { const vendor = vid ? store.counterparties.find((c) => c.id === vid) : null; const amt = r2(sum(items, (x) => x.amount)); if (!amt) continue;
      store.bills.push({ id: uid("bl"), ref: nextRef(store, "bills", t.entityId, "BILL"), entityId: t.entityId, counterpartyId: vid || null, tradeId: t.id, cargoId: null, date: t.deliveredDate, due: addDays(t.deliveredDate, vendor ? vendor.terms : 30), net: amt, vat: 0, vatRate: 0, vatKind: "out", amount: amt, currency: t.currency, fx: t.fx, paid: 0, credited: 0, internal: true, lines: items.map((x) => ({ label: x.label, amount: x.amount })), memo: items.map((x) => x.label).join(", ") + " on " + t.ref });
    }
    return inv;
  }
  function cancelTrade(store, tradeId) {
    const t = store.trades.find((x) => x.id === tradeId); if (t.status !== "agreed") return;
    for (const cg of store.cargoes.filter((c) => c.createdFromTradeId === t.id)) { if (cg.received) throw new Error("Back-to-back cargo " + cg.ref + " has already been received; reverse it with a credit note or journal instead"); store.bills = store.bills.filter((b) => b.cargoId !== cg.id); store.cargoes = store.cargoes.filter((c) => c.id !== cg.id); }
    for (const l of t.lines) l.cargoId = null; t.cargoId = null; invalidate(store);
    t.status = "cancelled"; t.events.push({ by: who(store), date: today(), type: "cancelled", text: "Trade cancelled" + (store.cargoes.some((c) => c.createdFromTradeId === t.id) ? "" : "; pending back-to-back purchases withdrawn") });
  }
  // ---- corrections: edit an undelivered trade, reset a delivered trade to draft, delete, non-financial edits on documents, void bills
  function unreceiveCargo(store, cargoId) {
    // undo a cargo receipt: reverse its posting and withdraw the vendor bill; only while nothing has been paid and nothing delivered from it
    const c = store.cargoes.find((x) => x.id === cargoId); if (!c) throw new Error("Cargo not found"); if (!c.received) return c;
    const st = cargoStatus(store, c); if (st.delivered > 1e-6) throw new Error(c.ref + " has deliveries against it; reset those trades to draft first"); if (store.cargoLosses.some((l) => l.cargoId === c.id)) throw new Error(c.ref + " has recorded losses; reverse those first");
    const bill = store.bills.find((b) => b.cargoId === c.id); if (bill && (bill.paid > 0.001 || bill.credited > 0.001)) throw new Error(bill.ref + " has been paid or credited; reverse that first");
    { const lock = lockedFor(store, c.entityId); if (lock && c.receivedDate <= lock) throw new Error("Period locked through " + lock); }
    for (const j of store.ledger) if (j.ref && j.ref.type === "cargo" && j.ref.cargoId === c.id && !j.reversedBy) { const r = post(store, j.entityId, today(), "Receipt of " + c.ref + " withdrawn: reversal of " + j.memo, j.lines.map((l) => ({ account: l.account, sub: l.sub, debit: l.credit, credit: l.debit, currency: l.currency, amount: l.amount })), { type: "reversal", of: j.id, cargoId: c.id }); j.reversedBy = r.id; }
    if (bill) { if (c.createdFromTradeId) Object.assign(bill, { pending: true, paid: 0, credited: 0 }); else store.bills = store.bills.filter((b) => b.id !== bill.id); }
    c.received = false; c.receivedDate = null; c.updatedBy = who(store); invalidate(store); return c;
  }
  function editCargo(store, cargoId, d) {
    const c = store.cargoes.find((x) => x.id === cargoId); if (!c) throw new Error("Cargo not found"); const st = cargoStatus(store, c);
    const wasReceived = c.received, recDate = c.receivedDate; if (wasReceived) unreceiveCargo(store, c.id);
    if (d.qty != null && +d.qty < st.committed - 1e-6) throw new Error("Quantity cannot go below the " + fmtQty(st.committed) + " already allocated to trades");
    if (d.supplierId !== undefined && d.supplierId && !store.counterparties.find((x) => x.id === d.supplierId)) throw new Error("Supplier not found");
    if (d.unit && (d.unit !== (c.unit || "MT")) && st.committed > 1e-6) throw new Error("Unit cannot change while lines are allocated from this cargo");
    Object.assign(c, { supplierId: d.supplierId !== undefined ? d.supplierId : c.supplierId, qty: d.qty != null ? +d.qty : c.qty, price: d.price != null ? +d.price : c.price, unit: d.unit || c.unit, port: d.port !== undefined ? d.port : c.port, country: d.country !== undefined ? d.country : c.country, date: d.date || c.date, terms: d.terms != null && d.terms !== "" ? +d.terms : c.terms, currency: d.currency || c.currency, fx: d.fx ? +d.fx : c.fx, vatRate: d.vatRate != null ? +d.vatRate : c.vatRate, vatKind: d.vatKind || c.vatKind, allowancePct: d.allowancePct != null ? +d.allowancePct : c.allowancePct, costs: d.costs ? d.costs.filter((x) => +x.amount).map((x) => ({ label: x.label, amount: r2(+x.amount) })) : c.costs, memo: d.memo !== undefined ? d.memo : c.memo, updatedBy: who(store), updatedAt: new Date().toISOString() });
    const pb = store.bills.find((b) => b.cargoId === c.id && b.pending); if (pb) { const net = cargoLanded(c), vr = vatOf(c.vatRate, c.vatKind), vat = r2(net * vr / 100); Object.assign(pb, { counterpartyId: c.supplierId, net, vat, vatRate: vr, vatKind: c.vatKind, amount: r2(net + vat), currency: c.currency, fx: c.fx }); }
    if (wasReceived) receiveCargo(store, c.id, recDate);
    for (const t of store.trades) if (t.lines.some((l) => l.cargoId === c.id)) t.events.push({ by: who(store), date: today(), type: "note", text: "Purchase " + c.ref + " edited: " + fmtQty(c.qty) + " " + (c.unit || "MT") + " at " + fmtMoney(c.price) + "/" + (c.unit || "MT") + " from " + ((store.counterparties.find((x) => x.id === c.supplierId) || {}).short || "supplier") });
    invalidate(store); return c;
  }
  function editTrade(store, tradeId, d) {
    const t = store.trades.find((x) => x.id === tradeId); if (!t) throw new Error("Trade not found"); if (t.status !== "agreed") throw new Error("Only an undelivered trade can be edited; reset it to draft first");
    { const lock = lockedFor(store, t.entityId); if (lock && (d.deliveryDate || t.deliveryDate) <= lock) throw new Error("Period locked"); }
    // withdraw pending back-to-back purchases (they are recreated from the new lines), free allocations
    for (const cg of store.cargoes.filter((c) => c.createdFromTradeId === t.id)) { if (cg.received) unreceiveCargo(store, cg.id); store.bills = store.bills.filter((b) => b.cargoId !== cg.id); store.cargoes = store.cargoes.filter((c) => c.id !== cg.id); }
    for (const l of t.lines) l.cargoId = null; t.cargoId = null; invalidate(store);
    const before = JSON.stringify({ lines: t.lines, customerId: t.customerId, deliveryDate: t.deliveryDate, price: t.price, qty: t.qty });
    const probe = { ...t, ...d, id: t.id, ref: t.ref, lines: d.lines || t.lines, __store: store };
    normLines.store = store; const lines = normLines(probe); const prim = lines.find((l) => l.kind === "product") || null; if (!prim && !lines.some((l) => l.kind === "service")) throw new Error("A trade needs at least one product or service line");
    const ent = store.entities.find((e) => e.id === (d.entityId || t.entityId)); const cust = store.counterparties.find((c) => c.id === (d.customerId || t.customerId)); if (!ent || !cust) throw new Error("Entity and customer required");
    // validate allocations like addTrade
    const need = {}; for (const l of lines) if (l.kind === "product" && l.cargoId) { const cg = store.cargoes.find((c) => c.id === l.cargoId); if (!cg) throw new Error("Cargo not found"); if (cg.entityId !== ent.id) throw new Error("Cargo " + cg.ref + " belongs to another entity"); if (cg.productId !== l.productId) throw new Error("Cargo " + cg.ref + " is another product"); if ((cg.unit || "MT") !== (l.unit || "MT")) throw new Error("Cargo " + cg.ref + " is in " + (cg.unit || "MT")); need[cg.id] = (need[cg.id] || 0) + l.qty; }
    for (const [cid, q] of Object.entries(need)) { const st = cargoStatus(store, store.cargoes.find((c) => c.id === cid)); if (q > st.sellable + 1e-6) throw new Error("Cargo " + st.ref + " has only " + fmtQty(st.sellable) + " sellable"); }
    for (const l of lines) if (l.kind === "product" && !l.cargoId && l.b2b && !(l.b2b.buyPrice > 0 && l.b2b.supplierId)) l.b2bPending = true;
    for (const l of lines) if (l.kind === "product" && !l.cargoId && l.b2b && l.b2b.buyPrice > 0 && l.b2b.supplierId) { const cg = addCargo(store, { entityId: ent.id, supplierId: l.b2b.supplierId, productId: l.productId, qty: l.qty, unit: l.unit, price: l.b2b.buyPrice, currency: d.currency || t.currency, fx: d.fx || t.fx, port: d.port || t.port, country: d.country || t.country, date: today(), terms: l.b2b.terms, allowancePct: 0, received: false, deliveryMode: "back-to-back", createdFrom: "trade", vatRate: l.b2b.vatRate, vatKind: l.b2b.vatKind }); cg.createdFromTradeId = t.id; l.cargoId = cg.id; }
    Object.assign(t, { customerId: cust.id, vesselId: d.vesselId !== undefined ? d.vesselId : t.vesselId, fixtureId: d.fixtureId !== undefined ? d.fixtureId || null : t.fixtureId || null, voyageId: d.voyageId !== undefined ? d.voyageId || null : t.voyageId || null, meta: d.meta !== undefined ? (d.meta && typeof d.meta === "object" ? d.meta : null) : t.meta || null, port: d.port !== undefined ? d.port : t.port, country: d.country !== undefined ? d.country : t.country, date: d.date || t.date, deliveryDate: d.deliveryDate || t.deliveryDate, terms: d.terms != null && d.terms !== "" ? +d.terms : t.terms, currency: d.currency || t.currency, fx: d.fx ? +d.fx : t.fx, vatRate: d.vatRate != null ? +d.vatRate : t.vatRate, vatKind: d.vatKind || t.vatKind, buyerRef: d.buyerRef !== undefined ? d.buyerRef : t.buyerRef, agent: d.agent !== undefined ? d.agent : t.agent, salesIds: Array.isArray(d.salesIds) ? d.salesIds : t.salesIds, lines, costs: d.costs ? d.costs.filter((c) => +c.amount).map((c) => ({ label: c.label, amount: r2(+c.amount), vendorId: c.vendorId || null })) : t.costs });
    const p0 = lines.find((l) => l.kind === "product"); t.productId = p0 ? p0.productId : null; t.qty = productMT(t); t.price = p0 ? p0.price : 0; t.cargoId = p0 ? p0.cargoId || null : null; t.updatedBy = who(store); t.updatedAt = new Date().toISOString();
    t.events.push({ by: who(store), date: today(), type: "note", text: "Trade edited" + (JSON.stringify({ lines: t.lines, customerId: t.customerId, deliveryDate: t.deliveryDate, price: t.price, qty: t.qty }) !== before ? "" : " (no change)") }); invalidate(store); return t;
  }
  function undeliverTrade(store, tradeId, opt) {
    const t = store.trades.find((x) => x.id === tradeId); if (!t) throw new Error("Trade not found"); if (t.status !== "delivered") throw new Error("Only a delivered trade can be reset to draft");
    { const inv0 = store.invoices.find((i) => i.tradeId === t.id); guard(store, "invoice-void", { entityId: t.entityId, amount: inv0 ? inv0.amount : 0, currency: inv0 ? inv0.currency : t.currency, d: opt || {} }); }
    const inv = store.invoices.find((i) => i.tradeId === t.id); if (inv && (inv.paid > 0.001 || inv.credited > 0.001)) throw new Error("Invoice " + inv.ref + " has receipts or credit notes; reverse those first");
    { const lock = lockedFor(store, t.entityId); if (lock && t.deliveredDate <= lock) throw new Error("Period locked through " + lock); }
    const costBills = store.bills.filter((b) => b.tradeId === t.id && b.internal && !b.expense); if (costBills.some((b) => b.paid > 0.001)) throw new Error("A cost bill of this trade has been paid; reverse the payment first");
    for (const j of store.ledger) if (j.ref && j.ref.type === "delivery" && j.ref.tradeId === t.id && !j.reversedBy) { const r = post(store, j.entityId, today(), "Reset to draft: reversal of " + j.memo, j.lines.map((l) => ({ account: l.account, sub: l.sub, debit: l.credit, credit: l.debit, currency: l.currency, amount: l.amount })), { type: "reversal", of: j.id, tradeId: t.id }); j.reversedBy = r.id; }
    store.bills = store.bills.filter((b) => !costBills.includes(b)); if (inv) { store.documents = store.documents.filter((d) => d.invoiceId !== inv.id); store.invoices = store.invoices.filter((i) => i.id !== inv.id); }
    for (const l of t.lines) l.deliveredQty = null; const wasDate = t.deliveredDate; t.deliveredDate = null; t.deliveredQty = null; t.status = "agreed"; t.bdn = ""; t.updatedBy = who(store); t.updatedAt = new Date().toISOString();
    for (const cg of store.cargoes.filter((c) => c.createdFromTradeId === t.id && c.received)) { const bl = store.bills.find((b) => b.cargoId === cg.id); if (!bl || (bl.paid < 0.001 && bl.credited < 0.001)) unreceiveCargo(store, cg.id); }
    t.events.push({ by: who(store), date: today(), type: "note", text: "Reset to draft: delivery of " + wasDate + " reversed" + (inv ? ", " + inv.ref + " withdrawn" : "") }); invalidate(store); return t;
  }
  function deleteTrade(store, tradeId) {
    const t = store.trades.find((x) => x.id === tradeId); if (!t) throw new Error("Trade not found"); if (!["agreed", "cancelled"].includes(t.status)) throw new Error("Only an undelivered or cancelled trade can be deleted; reset a delivered one to draft first");
    if (store.ledger.some((j) => j.ref && j.ref.tradeId === t.id && !j.reversedBy && j.ref.type !== "reversal")) throw new Error("This trade has postings; cancel it instead so the audit trail stays");
    if (t.status === "agreed") cancelTrade(store, t.id); store.trades = store.trades.filter((x) => x.id !== t.id); store.attachments = (store.attachments || []).filter((a) => !(a.subjectType === "trade" && a.subjectId === t.id)); invalidate(store); return t.ref;
  }
  function payBills(store, d) {
    // one bank transfer settling several bills (same entity, same currency; typically one vendor)
    const bills = (d.billIds || []).map((id) => store.bills.find((b) => b.id === id)).filter(Boolean); const b = store.banks.find((x) => x.id === d.bankId);
    if (!bills.length || !b) throw new Error("Bills and bank account required"); if (bills.some((x) => x.pending)) throw new Error("A pending bill (cargo not delivered) cannot be paid yet"); if (new Set(bills.map((x) => x.entityId)).size > 1) throw new Error("Bills of different entities cannot be paid in one transfer"); if (new Set(bills.map((x) => x.currency)).size > 1) throw new Error("Bills in different currencies cannot be paid in one transfer"); if (bills.some((x) => docOpen(x) < 0.01)) throw new Error("One of the bills has nothing open");
    const date = d.date || today(); if (date > today()) throw new Error("Payment date is in the future"); { const lock = lockedFor(store, bills[0].entityId); if (lock && date <= lock) throw new Error("Period locked through " + lock); }
    const ent = store.entities.find((e) => e.id === bills[0].entityId); const ccy = bills[0].currency; const fx = bills[0].fx || 1;
    const extra = checkAllocations(store, d.allocations, null, { ps: d.ps }); const extraAmt = extra ? r2(sum(extra, (a) => a.amount)) : 0; if (extra && b.currency !== ccy) throw new Error("An unbilled remainder can only be added when the bank account is kept in the bills' currency");
    const total = r2(sum(bills, (x) => docOpen(x))); guard(store, "payment", { entityId: ent.id, amount: r2(total + extraAmt), currency: ccy, d }); const base = r2(sum(bills, (x) => docOpen(x) * x.fx)); const bankAmt = d.bankAmount != null && d.bankAmount !== "" ? +d.bankAmount : (b.currency === ccy ? total : r2(base / (b.fx || 1)));
    const bankRate = b.currency === ent.currency ? 1 : (d.rate ? +d.rate : (b.fx || 1)); const cashBase = r2(bankAmt * bankRate); const diff = r2(base - cashBase);
    const batchId = uid("pb"); const lines = []; const ids = [];
    for (const bill of bills) { const amt = docOpen(bill); bill.paid = r2(bill.paid + amt); bill.paidDate = date; const p = { id: uid("pm"), kind: "out", billId: bill.id, counterpartyId: bill.counterpartyId, entityId: bill.entityId, bankId: b.id, amount: amt, currency: ccy, bankAmount: r2(bankAmt * (amt / total)), bankCurrency: b.currency, date, reference: d.reference || "", batchId }; store.payments.push(p); ids.push(p.id); lines.push({ account: "ap", sub: bill.counterpartyId || null, debit: r2(amt * bill.fx), currency: ccy, amount: amt }); }
    lines.push({ account: "cash", sub: b.id, credit: cashBase, currency: b.currency, amount: bankAmt }); if (diff > 0) lines.push({ account: "fx_diff", credit: diff }); else if (diff < 0) lines.push({ account: "fx_diff", debit: -diff });
    const vendors = [...new Set(bills.map((x) => (store.counterparties.find((c) => c.id === x.counterpartyId) || {}).short || "").filter(Boolean))];
    post(store, ent.id, date, "Payment of " + bills.length + " bills " + bills.map((x) => x.ref).join(", ") + (vendors.length ? " to " + vendors.join(", ") : "") + (b.currency !== ccy ? " (" + bankAmt + " " + b.currency + ")" : ""), lines, { type: "payment", paymentIds: ids, batchId, billId: bills[0].id, counterpartyId: bills.length === 1 || vendors.length === 1 ? bills[0].counterpartyId : null });
    if (+d.charge) bankTransaction(store, { bankId: b.id, kind: "out", category: "Bank charges", amount: +d.charge, date, memo: "Bank charges on payment of " + bills.map((x) => x.ref).join(", "), counterpartyId: bills[0].counterpartyId });
    for (const bill of bills) { const t = bill.tradeId ? store.trades.find((x) => x.id === bill.tradeId) : null; if (t) t.events.push({ by: who(store), date, type: "payment", text: "Paid " + bill.ref + " in a transfer of " + fmtMoney(bankAmt, b.currency) + " covering " + bills.length + " bills" }); }
    let txId = null; if (extra) { const tx = bankTransaction(store, { __internal: true, bankId: b.id, kind: "out", category: d.category || "Other", amount: extraAmt, date, memo: d.memo || "Unbilled remainder of the transfer with " + bills.map((x) => x.ref).join(", "), counterpartyId: bills.length === 1 || vendors.length === 1 ? bills[0].counterpartyId : null, reference: d.reference || "", allocations: extra, ps: d.ps }); tx.batchId = batchId; txId = tx.id; }
    for (const p of store.payments) if (p.batchId === batchId) { const bill = store.bills.find((x) => x.id === p.billId); if (bill && !p.vesselId) { p.vesselId = bill.vesselId || null; p.voyageId = bill.voyageId || null; p.fixtureId = bill.fixtureId || null; } }
    invalidate(store); return { batchId, paymentIds: ids, bankAmount: extra ? r2(bankAmt + extraAmt) : bankAmt, txId };
  }
  function reversePayment(store, paymentId, reason) {
    const p = store.payments.find((x) => x.id === paymentId); if (!p) throw new Error("Payment not found"); if (p.reversed) throw new Error("Already reversed");
    { const lock = lockedFor(store, p.entityId); if (lock && p.date <= lock) throw new Error("Period locked through " + lock); }
    // 4.19 · an application of money held on account: nothing was posted, the invoice gives the amount back to the on-account row
    if (p.appliedFrom) { const src = store.payments.find((x) => x.id === p.appliedFrom); const inv = store.invoices.find((i) => i.id === p.invoiceId); if (inv) { inv.paid = r2(Math.max(0, (inv.paid || 0) - p.amount)); if (inv.paidDate && inv.paid < 0.005) inv.paidDate = null; } if (src) src.applied = r2(Math.max(0, (src.applied || 0) - p.amount)); if (p.fxJournalId) { const fj = store.ledger.find((x) => x.id === p.fxJournalId); if (fj && !fj.reversedBy) { const rj = post(store, fj.entityId, today(), "Reversal of " + fj.memo + (reason ? " — " + reason : ""), fj.lines.map((l) => ({ account: l.account, sub: l.sub, debit: l.credit, credit: l.debit, currency: l.currency, amount: l.amount })), { type: "reversal", of: fj.id, paymentId: p.id, invoiceId: p.invoiceId || null, counterpartyId: p.counterpartyId || null }); fj.reversedBy = rj.id; } } p.reversed = true; p.reversedAt = today(); p.reversedBy = who(store); invalidate(store); return null; }
    { const batch0 = p.batchId ? store.payments.filter((x) => x.batchId === p.batchId && !x.appliedFrom) : [p]; if (batch0.some((q) => q.onAccount && (q.applied || 0) > 0.005)) throw new Error("Part of this receipt has been applied to invoices; reverse those applications first"); }
    const j = store.ledger.find((x) => x.ref && (x.ref.paymentId === p.id || (x.ref.paymentIds && x.ref.paymentIds.includes(p.id)) || (!x.ref.paymentId && !x.ref.paymentIds && (x.ref.type === "receipt" || x.ref.type === "payment") && (p.invoiceId ? x.ref.invoiceId === p.invoiceId : x.ref.billId === p.billId) && x.date === p.date && !x.reversedBy)));
    if (!j) throw new Error("The posting of this payment could not be found"); if (j.reversedBy) throw new Error("Already reversed");
    const r = post(store, j.entityId, today(), "Reversal of " + j.memo + (reason ? " — " + reason : ""), j.lines.map((l) => ({ account: l.account, sub: l.sub, debit: l.credit, credit: l.debit, currency: l.currency, amount: l.amount })), { type: "reversal", of: j.id, paymentId: p.id, invoiceId: p.invoiceId || null, billId: p.billId || null, counterpartyId: p.counterpartyId || null });
    j.reversedBy = r.id; const batch = p.batchId ? store.payments.filter((x) => x.batchId === p.batchId && !x.appliedFrom) : [p];
    for (const q of batch) { q.reversed = true; q.reversedAt = today(); q.reversedBy = who(store); const doc = q.invoiceId ? store.invoices.find((i) => i.id === q.invoiceId) : store.bills.find((b) => b.id === q.billId); if (doc) { doc.paid = r2(Math.max(0, (doc.paid || 0) - q.amount)); if (doc.paidOn && doc.paid < 0.005) doc.paidOn = null; if (doc.paidDate && doc.paid < 0.005) doc.paidDate = null; } }
    const doc = p.invoiceId ? store.invoices.find((i) => i.id === p.invoiceId) : store.bills.find((b) => b.id === p.billId);
    const t = doc && doc.tradeId ? store.trades.find((x) => x.id === doc.tradeId) : null; if (t) t.events.push({ by: who(store), date: today(), type: "note", text: (p.invoiceId ? "Receipt" : "Payment") + " of " + fmtMoney(p.amount, p.currency) + " on " + p.date + " reversed" + (reason ? ": " + reason : "") });
    invalidate(store); return r;
  }
  function editInvoice(store, invoiceId, d) { const i = store.invoices.find((x) => x.id === invoiceId); if (!i) throw new Error("Invoice not found"); if (d.due) i.due = d.due; if (d.buyerRef !== undefined) { const t = store.trades.find((x) => x.id === i.tradeId); if (t) t.buyerRef = d.buyerRef; } if (d.memo !== undefined) i.memo = d.memo; i.updatedBy = who(store); return i; }
  function editBill(store, billId, d) { const b = store.bills.find((x) => x.id === billId); if (!b) throw new Error("Bill not found"); if (d.due) b.due = d.due; if (d.memo !== undefined) b.memo = d.memo; if (d.reference !== undefined) b.reference = d.reference; b.updatedBy = who(store); return b; }
  function voidBill(store, billId, opt) {
    const b = store.bills.find((x) => x.id === billId); if (!b) throw new Error("Bill not found"); guard(store, "bill-void", { entityId: b.entityId, amount: b.amount, currency: b.currency, d: opt || {} }); if (b.paid > 0.001 || b.credited > 0.001) throw new Error("This bill has payments or credits; reverse those first"); if (!b.internal) throw new Error("A cargo bill is withdrawn by cancelling the cargo or the trade, not on its own");
    const j = store.ledger.find((x) => x.ref && (x.ref.billId === b.id) && !x.reversedBy && ["expense", "delivery"].includes(x.ref.type)); if (j && j.ref.type === "expense") { const r = post(store, j.entityId, today(), "Void " + b.ref + ": reversal of " + j.memo, j.lines.map((l) => ({ account: l.account, sub: l.sub, debit: l.credit, credit: l.debit, currency: l.currency, amount: l.amount })), { type: "reversal", of: j.id }); j.reversedBy = r.id; }
    else { const amt = r2(b.amount * (b.fx || 1)); post(store, b.entityId, today(), "Void " + b.ref + " (" + b.memo + ")", [{ account: "ap", sub: b.counterpartyId || null, debit: amt, currency: b.currency, amount: b.amount }, { account: "fees", sub: b.tradeId || null, credit: amt }], { type: "reversal", billId: b.id, tradeId: b.tradeId || null }); }
    store.bills = store.bills.filter((x) => x.id !== b.id); invalidate(store); return b.ref;
  }
  function addB2bPurchase(store, tradeId, lineId, d) {
    const t = store.trades.find((x) => x.id === tradeId); if (!t) throw new Error("Trade not found"); const l = t.lines.find((x) => x.id === lineId) || productLines(t).find((x) => x.b2bPending); if (!l) throw new Error("No line waiting for its purchase"); if (l.cargoId) throw new Error("This line already has a cargo");
    if (!d.supplierId) throw new Error("Supplier required"); if (!(+d.buyPrice > 0)) throw new Error("Purchase price required");
    const cg = addCargo(store, { entityId: t.entityId, supplierId: d.supplierId, productId: l.productId, qty: l.qty, unit: l.unit, price: +d.buyPrice, currency: t.currency, fx: t.fx, port: t.port, country: t.country, date: today(), terms: d.terms, allowancePct: 0, received: t.status === "delivered", deliveryMode: "back-to-back", createdFrom: "trade", vatRate: d.vatRate, vatKind: d.vatKind });
    cg.createdFromTradeId = t.id; l.cargoId = cg.id; l.b2bPending = false; if (l === productLines(t)[0]) t.cargoId = cg.id; invalidate(store);
    t.events.push({ by: who(store), date: today(), type: "allocated", text: "Purchase side added: " + cg.ref + " from " + ((store.counterparties.find((c) => c.id === d.supplierId) || {}).short || "supplier") + " at " + fmtMoney(+d.buyPrice) + "/" + (l.unit || "MT") });
    if (t.status === "delivered") { const cogs = r2(lineQty(l) * cargoUnitCost(cg) * cg.fx); if (cogs) post(store, t.entityId, today(), "Cost of goods for " + t.ref + " (purchase added after delivery)", [{ account: "cogs", sub: l.productId, debit: cogs }, { account: "inventory", sub: cg.id, credit: cogs }], { type: "delivery", tradeId: t.id, cargoId: cg.id }); }
    return cg;
  }
  function allocateTrade(store, tradeId, cargoId, lineId) { const t = store.trades.find((x) => x.id === tradeId); const c = store.cargoes.find((x) => x.id === cargoId); if (!t || !c) throw new Error("Trade and cargo required"); const l = lineId ? t.lines.find((x) => x.id === lineId) : productLines(t).find((x) => !x.cargoId) || productLines(t)[0]; if (!l) throw new Error("No product line"); if (c.entityId !== t.entityId) throw new Error("Cargo " + c.ref + " belongs to another entity — transfer it first"); if (c.productId !== l.productId) throw new Error("Cargo product differs from the line"); if ((c.unit || "MT") !== (l.unit || "MT")) throw new Error("Cargo is in " + (c.unit || "MT") + ", the line is in " + l.unit); const st = cargoStatus(store, c); if (st.sellable + 0.001 < l.qty) throw new Error("Only " + fmtQty(st.sellable) + " MT sellable on " + c.ref); l.cargoId = c.id; if (l === productLines(t)[0]) { t.cargoId = c.id; } invalidate(store); t.events.push({ by: who(store), date: today(), type: "allocated", text: fmtQty(l.qty) + " MT " + (store.products.find((p) => p.id === l.productId) || {}).code + " sourced from " + c.ref + " at " + fmtMoney(st.unitCost) + "/MT" }); }
  function addTradeEvent(store, tradeId, ev) { const t = store.trades.find((x) => x.id === tradeId); t.events.push({ date: ev.date || today(), type: ev.type || "note", text: ev.text }); }
  function tradeStage(store, t) {
    if (t.status === "cancelled") return "cancelled";
    if (t.status === "agreed") return productLines(t).some((l) => l.b2bPending) ? "purchase missing" : t.deliveryDate < today() ? "late" : productLines(t).length && productLines(t).some((l) => !l.cargoId) ? "unsourced" : "scheduled";
    const inv = store.invoices.find((i) => i.tradeId === t.id); if (!inv) return "delivered";
    return docOpen(inv) < 0.01 ? "closed" : docStatus(inv) === "overdue" ? "overdue" : "invoiced";
  }
  function tradeMargin(store, t) {
    const pl = productLines(t); const mt = productMT(t);
    if (!pl.length) { const rev = tradeValue(t); const oth = sum(t.lines.filter((l) => l.kind === "service"), (l) => +l.cost || 0) + sum(t.costs || [], (x) => x.amount); if (!t.lines || !t.lines.some((l) => l.kind === "service")) return { unitCost: null, perMT: null, total: null, pct: null }; return { unitCost: null, perMT: null, total: r2(rev - oth), pct: rev ? (rev - oth) / rev : null, revenue: rev, cogs: 0, other: r2(oth), serviceOnly: true }; }
    if (pl.some((l) => !l.cargoId)) { const c0 = store.cargoes.find((x) => x.id === pl[0].cargoId); return { unitCost: c0 ? cargoUnitCost(c0) : null, perMT: null, total: null, pct: null }; }
    const revenue = tradeValue(t);
    const cogs = sum(pl, (l) => { const c = store.cargoes.find((x) => x.id === l.cargoId); return c ? lineQty(l) * cargoUnitCost(c) : 0; });
    const other = sum(t.lines.filter((l) => l.kind === "service"), (l) => +l.cost || 0) + sum(t.costs || [], (x) => x.amount);
    const total = r2(revenue - cogs - other);
    const unitCost = mt ? r2(cogs / mt) : null;
    return { unitCost, perMT: mt ? r2(total / mt) : null, total, pct: revenue ? total / revenue : null, revenue, cogs, other };
  }

  // ---------------------------------------------------------------- payments
  function receivePayment(store, d) {
    const inv = store.invoices.find((x) => x.id === d.invoiceId); const b = store.banks.find((x) => x.id === d.bankId);
    if (!inv || !b) throw new Error("Invoice and bank required"); if (!(+d.amount > 0)) throw new Error("Amount must be greater than zero"); if (docOpen(inv) < 0.01) throw new Error(inv.ref + " has nothing open"); if ((d.date || today()) > today()) throw new Error("Receipt date cannot be in the future");
    const amt = r2(Math.min(+d.amount, docOpen(inv)));
    inv.paid = r2(inv.paid + amt); if (docOpen(inv) < 0.01) inv.paidDate = d.date || today();
    const base = r2(amt * inv.fx);
    const bankAmt = d.bankAmount != null && d.bankAmount !== "" ? +d.bankAmount : (b.currency === inv.currency ? amt : r2(base / (b.fx || 1)));
    const bankRate = b.currency === (store.entities.find((e) => e.id === inv.entityId) || {}).currency ? 1 : (d.rate ? +d.rate : (b.fx || 1));
    const cashBase = r2(bankAmt * bankRate); const diff = r2(cashBase - base);
    const p = { id: uid("pm"), kind: "in", invoiceId: inv.id, counterpartyId: inv.counterpartyId, entityId: inv.entityId, bankId: b.id, amount: amt, currency: inv.currency, bankAmount: bankAmt, bankCurrency: b.currency, date: d.date || today(), reference: d.reference || "", vesselId: inv.vesselId || ((store.trades.find((t) => t.id === inv.tradeId) || {}).vesselId) || null, voyageId: inv.voyageId || null, fixtureId: inv.fixtureId || null };
    store.payments.push(p);
    const lines = [{ account: "cash", sub: b.id, debit: cashBase, currency: b.currency, amount: bankAmt }, { account: "ar", sub: inv.counterpartyId, credit: base, currency: inv.currency, amount: amt }];
    if (diff > 0) lines.push({ account: "fx_diff", credit: diff }); else if (diff < 0) lines.push({ account: "fx_diff", debit: -diff });
    post(store, inv.entityId, p.date, "Receipt " + inv.ref + (b.currency !== inv.currency ? " (" + bankAmt + " " + b.currency + ")" : ""), lines, { type: "receipt", invoiceId: inv.id, paymentId: p.id, counterpartyId: inv.counterpartyId });
    if (+d.charge) bankTransaction(store, { bankId: b.id, kind: "out", category: "Bank charges", amount: +d.charge, date: p.date, memo: "Bank charges on receipt " + inv.ref, counterpartyId: inv.counterpartyId });
    const t = store.trades.find((x) => x.id === inv.tradeId); if (t) t.events.push({ by: who(store), date: p.date, type: "receipt", text: "Received " + fmtMoney(amt, inv.currency) + " into " + b.label + (docOpen(inv) < 0.01 ? " — settled" : "") });
    return p;
  }
  function payBill(store, d) {
    const bill = store.bills.find((x) => x.id === d.billId); const b = store.banks.find((x) => x.id === d.bankId);
    if (!bill || !b) throw new Error("Bill and bank required"); if (bill.pending) throw new Error("This bill is not payable until the cargo is delivered"); if (!(+d.amount > 0)) throw new Error("Amount must be greater than zero"); if (docOpen(bill) < 0.01) throw new Error(bill.ref + " has nothing open"); if ((d.date || today()) > today()) throw new Error("Payment date cannot be in the future");
    const amt = r2(Math.min(+d.amount, docOpen(bill))); guard(store, "payment", { entityId: bill.entityId, amount: amt, currency: bill.currency, d });
    bill.paid = r2(bill.paid + amt); if (docOpen(bill) < 0.01) bill.paidDate = d.date || today();
    const base = r2(amt * bill.fx);
    const bankAmt = d.bankAmount != null && d.bankAmount !== "" ? +d.bankAmount : (b.currency === bill.currency ? amt : r2(base / (b.fx || 1)));
    const bankRate = b.currency === (store.entities.find((e) => e.id === bill.entityId) || {}).currency ? 1 : (d.rate ? +d.rate : (b.fx || 1)); const cashBase = r2(bankAmt * bankRate); const diff = r2(base - cashBase);
    const p = { id: uid("pm"), kind: "out", billId: bill.id, counterpartyId: bill.counterpartyId, entityId: bill.entityId, bankId: b.id, amount: amt, currency: bill.currency, bankAmount: bankAmt, bankCurrency: b.currency, date: d.date || today(), reference: d.reference || "", vesselId: bill.vesselId || null, voyageId: bill.voyageId || null, fixtureId: bill.fixtureId || null };
    store.payments.push(p);
    const lines = [{ account: "ap", sub: bill.counterpartyId || null, debit: base, currency: bill.currency, amount: amt }, { account: "cash", sub: b.id, credit: cashBase, currency: b.currency, amount: bankAmt }];
    if (diff > 0) lines.push({ account: "fx_diff", credit: diff }); else if (diff < 0) lines.push({ account: "fx_diff", debit: -diff });
    post(store, bill.entityId, p.date, "Payment " + bill.ref + (b.currency !== bill.currency ? " (" + bankAmt + " " + b.currency + ")" : ""), lines, { type: "payment", billId: bill.id, paymentId: p.id, counterpartyId: bill.counterpartyId });
    if (+d.charge) bankTransaction(store, { bankId: b.id, kind: "out", category: "Bank charges", amount: +d.charge, date: p.date, memo: "Bank charges on payment " + bill.ref, counterpartyId: bill.counterpartyId, __internal: true });
    return p;
  }
  // ---------------------------------------------------------------- 4.19 · one receipt split across vessels, voyages and time charters
  // receivePayments(store, { bankId, date, amount, counterpartyId, reference, charge, rate, bankAmount, allocations, ps })
  // One cash line. Each allocation with an invoiceId settles that invoice (up to its open amount); one without is held ON ACCOUNT for
  // that customer, vessel and voyage/fixture until applyOnAccount puts it against an invoice. Every payments row shares the batchId.
  function receivePayments(store, d) {
    const b = store.banks.find((x) => x.id === d.bankId); if (!b) throw new Error("Bank account required"); const date = d.date || today(); if (date > today()) throw new Error("Receipt date cannot be in the future");
    const total = r2(+d.amount || 0); if (!(total > 0)) throw new Error("Amount must be greater than zero");
    const allocs = checkAllocations(store, d.allocations, total, { ps: d.ps }); if (!allocs) throw new Error("Say which invoices, vessels or voyages the money is for (allocations)");
    const invOf = (a) => (a.invoiceId ? store.invoices.find((x) => x.id === a.invoiceId) : null);
    for (const a of allocs) { if (a.invoiceId) { const inv = invOf(a); if (!inv) throw new Error("Unknown invoice in an allocation"); if (a.amount > docOpen(inv) + 0.005) throw new Error(inv.ref + " has " + fmtMoney(docOpen(inv), inv.currency) + " open, the allocation is " + fmtMoney(a.amount)); if (!a.vesselId) a.vesselId = inv.vesselId || ((store.trades.find((t) => t.id === inv.tradeId) || {}).vesselId) || null; if (!a.fixtureId && inv.fixtureId) a.fixtureId = inv.fixtureId; if (!a.voyageId && inv.voyageId) a.voyageId = inv.voyageId; } }
    const cps = [...new Set(allocs.map((a) => (invOf(a) || {}).counterpartyId || d.counterpartyId || null))].filter(Boolean); const cpId = d.counterpartyId || cps[0] || null; if (!cpId) throw new Error("Customer required"); if (cps.some((c) => c !== cpId)) throw new Error("The invoices belong to different customers — one receipt settles one customer");
    const ents = [...new Set(allocs.map((a) => (invOf(a) || {}).entityId).filter(Boolean))]; const entityId = ents[0] || b.entityId; if (ents.length > 1) throw new Error("The invoices belong to different entities"); if (b.entityId !== entityId) throw new Error("The bank account belongs to another entity");
    const ccys = [...new Set(allocs.map((a) => (invOf(a) || {}).currency).filter(Boolean))]; const ccy = ccys[0] || d.currency || b.currency; if (ccys.length > 1) throw new Error("The invoices are in different currencies — one receipt, one currency");
    { const lock = lockedFor(store, entityId); if (lock && date <= lock) throw new Error("Period locked through " + lock); }
    const ent = store.entities.find((e) => e.id === entityId) || {}; const fx = ccys.length ? (invOf(allocs.find((a) => a.invoiceId)) || {}).fx || 1 : (ccy === ent.currency ? 1 : (d.fx ? +d.fx : (b.currency === ccy ? b.fx || 1 : 1)));
    const base = r2(total * fx); const bankAmt = d.bankAmount != null && d.bankAmount !== "" ? +d.bankAmount : (b.currency === ccy ? total : r2(base / (b.fx || 1)));
    const bankRate = b.currency === ent.currency ? 1 : (d.rate ? +d.rate : (b.fx || 1)); const cashBase = r2(bankAmt * bankRate); const diff = r2(cashBase - base);
    const batchId = uid("pb"); const ids = [], onAccount = []; const lines = [{ account: "cash", sub: b.id, debit: cashBase, currency: b.currency, amount: bankAmt }];
    let leftBase = base; allocs.forEach((a, i) => { const inv = invOf(a); const amt = inv ? r2(Math.min(a.amount, docOpen(inv))) : a.amount; const ab = i === allocs.length - 1 ? r2(leftBase) : r2(amt * fx); leftBase = r2(leftBase - ab);
      const p = { id: uid("pm"), kind: "in", invoiceId: inv ? inv.id : null, onAccount: !inv, applied: inv ? undefined : 0, fx: inv ? undefined : (amt ? r2(ab / amt * 1e6) / 1e6 : fx), counterpartyId: cpId, entityId, bankId: b.id, amount: amt, currency: ccy, bankAmount: r2(bankAmt * (amt / total)), bankCurrency: b.currency, date, reference: d.reference || "", batchId, vesselId: a.vesselId || null, voyageId: a.voyageId || null, fixtureId: a.fixtureId || null };
      if (inv) { inv.paid = r2(inv.paid + amt); if (docOpen(inv) < 0.01) inv.paidDate = date; } else onAccount.push(p.id);
      store.payments.push(p); ids.push(p.id);
      lines.push({ account: "ar", sub: cpId, credit: ab, currency: ccy, amount: amt, tags: { vesselId: a.vesselId || null, voyageId: a.voyageId || null, fixtureId: a.fixtureId || null, invoiceId: inv ? inv.id : null, onAccount: !inv } }); });
    if (diff > 0) lines.push({ account: "fx_diff", credit: diff }); else if (diff < 0) lines.push({ account: "fx_diff", debit: -diff });
    const refs = allocs.map((a) => (invOf(a) || {}).ref).filter(Boolean); const vn = [...new Set(allocs.map((a) => (store.vessels.find((v) => v.id === a.vesselId) || {}).name).filter(Boolean))];
    post(store, entityId, date, "Receipt " + fmtMoney(total, ccy) + " from " + ((store.counterparties.find((c) => c.id === cpId) || {}).name || "customer") + (refs.length ? " for " + refs.join(", ") : "") + (onAccount.length ? (refs.length ? " and " : " ") + onAccount.length + " on account" : "") + (vn.length > 1 ? " · " + vn.length + " vessels" : "") + (b.currency !== ccy ? " (" + bankAmt + " " + b.currency + ")" : ""), lines, { type: "receipt", paymentIds: ids, batchId, invoiceId: refs.length === 1 ? (invOf(allocs.find((a) => a.invoiceId)) || {}).id : null, counterpartyId: cpId, vesselId: sameOf(allocs, "vesselId"), voyageId: sameOf(allocs, "voyageId"), allocated: true });
    if (+d.charge) bankTransaction(store, { bankId: b.id, kind: "out", category: "Bank charges", amount: +d.charge, date, memo: "Bank charges on receipt from " + ((store.counterparties.find((c) => c.id === cpId) || {}).name || "customer"), counterpartyId: cpId, __internal: true });
    for (const a of allocs) { const inv = invOf(a); const t = inv ? store.trades.find((x) => x.id === inv.tradeId) : null; if (t) t.events.push({ by: who(store), date, type: "receipt", text: "Received " + fmtMoney(a.amount, ccy) + " into " + b.label + " in a receipt of " + fmtMoney(total, ccy) + (docOpen(inv) < 0.01 ? " — settled" : "") }); }
    audit(store, { kind: "money", action: "receipt", refKind: "batch", refId: batchId, entityId, text: "Receipt " + fmtMoney(total, ccy) + " split over " + allocs.length + " allocation" + (allocs.length === 1 ? "" : "s"), detail: { allocations: allocs, onAccount } });
    invalidate(store); return { batchId, paymentIds: ids, bankAmount: bankAmt, onAccount };
  }
  // an on-account receipt (or part of it) put against an invoice later: the AR credit exists already, so nothing posts — the
  // application is a payments row of its own (kind "in", appliedFrom) so the invoice shows it as received
  function applyOnAccount(store, paymentId, invoiceId, amount, date) {
    const p = store.payments.find((x) => x.id === paymentId); if (!p || !p.onAccount) throw new Error("Not an on-account receipt"); if (p.reversed) throw new Error("This receipt was reversed");
    const inv = store.invoices.find((x) => x.id === invoiceId); if (!inv) throw new Error("Invoice required"); if (inv.counterpartyId !== p.counterpartyId) throw new Error("The invoice belongs to another customer"); if (inv.currency !== p.currency) throw new Error("The invoice is in " + inv.currency + ", the receipt in " + p.currency);
    const openP = r2(p.amount - (p.applied || 0)); const amt = r2(Math.min(+amount || openP, openP, docOpen(inv))); if (!(amt > 0)) throw new Error("Nothing to apply");
    p.applied = r2((p.applied || 0) + amt); inv.paid = r2(inv.paid + amt); if (docOpen(inv) < 0.01) inv.paidDate = date || today();
    const q = { id: uid("pm"), kind: "in", invoiceId: inv.id, appliedFrom: p.id, noJournal: true, counterpartyId: inv.counterpartyId, entityId: inv.entityId, bankId: p.bankId, amount: amt, currency: inv.currency, bankAmount: r2((p.bankAmount || p.amount) * (amt / p.amount)), bankCurrency: p.bankCurrency, date: date || today(), reference: p.reference || "on account", batchId: p.batchId || null, vesselId: inv.vesselId || p.vesselId || null, voyageId: inv.voyageId || p.voyageId || null, fixtureId: inv.fixtureId || p.fixtureId || null };
    store.payments.push(q);
    // 4.31 · the money was credited to the customer at the receipt's rate, the invoice debited at its own: the difference is an FX
    // gain or loss when they meet, so the customer's receivable in the base currency ends at nil and not at the rate gap
    { let pfx = +p.fx || 0; if (!pfx) { const j = store.ledger.find((x) => x.ref && x.ref.paymentIds && x.ref.paymentIds.includes(p.id)); const l = j && j.lines.find((y) => y.account === "ar" && y.tags && y.tags.onAccount && Math.abs((+y.amount || 0) - p.amount) < 0.005); pfx = l && l.amount ? (l.credit || 0) / l.amount : 0; }
      const diff = pfx ? r2(amt * pfx - amt * (inv.fx || 1)) : 0; if (Math.abs(diff) >= 0.01) { const fj = post(store, inv.entityId, q.date, "FX difference · on-account receipt applied to " + inv.ref, diff > 0 ? [{ account: "ar", sub: inv.counterpartyId, debit: diff, currency: inv.currency, amount: 0 }, { account: "fx_diff", credit: diff }] : [{ account: "fx_diff", debit: -diff }, { account: "ar", sub: inv.counterpartyId, credit: -diff, currency: inv.currency, amount: 0 }], { type: "fxdiff", paymentId: q.id, invoiceId: inv.id, counterpartyId: inv.counterpartyId }); q.fxJournalId = fj.id; q.fxDiff = diff; } }
    const t = store.trades.find((x) => x.id === inv.tradeId); if (t) t.events.push({ by: who(store), date: q.date, type: "receipt", text: "Applied " + fmtMoney(amt, inv.currency) + " held on account" + (docOpen(inv) < 0.01 ? " — settled" : "") });
    audit(store, { kind: "money", action: "apply", refKind: "invoice", refId: inv.id, entityId: inv.entityId, text: "Applied " + fmtMoney(amt, inv.currency) + " on account to " + inv.ref, detail: { paymentId: p.id } });
    invalidate(store); return q;
  }
  const onAccountOpen = (store, counterpartyId) => (store.payments || []).filter((p) => p.onAccount && !p.reversed && (!counterpartyId || p.counterpartyId === counterpartyId) && r2(p.amount - (p.applied || 0)) > 0.005).map((p) => ({ ...p, open: r2(p.amount - (p.applied || 0)) }));
  // ---------------------------------------------------------------- 4.19 · a remittance to the owners of an agency vessel
  function remitOwners(store, d) {
    const v = store.vessels.find((x) => x.id === d.vesselId); if (!v) throw new Error("Vessel required"); if (vesselModel(store, v.id) !== "agency") throw new Error("Nothing is due to owners on " + v.name + " — she is booked as own P&L (principal)");
    const b = store.banks.find((x) => x.id === d.bankId); if (!b) throw new Error("Bank account required"); const amt = r2(+d.amount || 0); if (!(amt > 0)) throw new Error("Amount must be greater than zero"); const date = d.date || today(); if (date > today()) throw new Error("The date cannot be in the future");
    guard(store, "payment", { entityId: b.entityId, amount: amt, currency: b.currency, d });
    { const lock = lockedFor(store, b.entityId); if (lock && date <= lock) throw new Error("Period locked through " + lock); }
    const base = r2(amt * (b.fx || 1)); const cpId = d.counterpartyId || (store.counterparties.find((c) => (c.vesselIds || []).includes(v.id) && c.role === "owner") || {}).id || null;
    const p = { id: uid("pm"), kind: "remit", vesselId: v.id, counterpartyId: cpId, entityId: b.entityId, bankId: b.id, amount: amt, currency: b.currency, bankAmount: amt, bankCurrency: b.currency, date, reference: d.reference || "", memo: d.memo || "" };
    store.payments.push(p);
    const j = post(store, b.entityId, date, "Remittance to owners of " + v.name + (cpId ? " (" + ((store.counterparties.find((c) => c.id === cpId) || {}).name || "") + ")" : "") + (d.memo ? " — " + d.memo : ""), [{ account: "owners_due", sub: v.id, debit: base, tags: { vesselId: v.id } }, { account: "cash", sub: b.id, credit: base, currency: b.currency, amount: amt }], { type: "remit", paymentId: p.id, vesselId: v.id, counterpartyId: cpId });
    p.journalId = j.id; audit(store, { kind: "money", action: "remit", refKind: "vessel", refId: v.id, entityId: b.entityId, text: "Remitted " + fmtMoney(amt, b.currency) + " to the owners of " + v.name, detail: { paymentId: p.id } });
    invalidate(store); return p;
  }
  // ---------------------------------------------------------------- 4.19 · what is due to the owners of a vessel, and why
  // ownersAccount(store, vesselId, range) → gross by kind, deductions by kind, fees kept, net, remitted, balance, the two buckets,
  // every line, month by month. Agency: read off the owners_due sub-ledger; principal: the same shape from her documents.
  const VOYAGE_COST_CATS = new Set(["bunkers", "port da", "port", "canal dues", "canal", "agency", "port costs", "port disbursements"]);
  const bucketOfKind = (k) => (["freight", "hire", "ballastBonus", "deadfreight", "commissions"].includes(k) ? "freight" : "others");
  const COMMISSION_CATS = /brokerage|commission/i;
  const bucketOfCost = (cat) => (VOYAGE_COST_CATS.has(String(cat || "").toLowerCase()) || COMMISSION_CATS.test(String(cat || "")) ? "freight" : "others");
  function ownersAccount(store, vesselId, range) {
    const v = store.vessels.find((x) => x.id === vesselId); if (!v) throw new Error("Unknown vessel"); const model = vesselModel(store, vesselId); range = range || {};
    const inR = (dt) => (!range.from || dt >= range.from) && (!range.to || dt <= range.to);
    const entityId = vesselEntity(store, vesselId) || null; const ent = store.entities.find((e) => e.id === entityId) || {}; const currency = ent.currency || store.meta.reportingCurrency || "USD";
    const lines = []; const push = (o) => lines.push(o);
    const cpName = (id) => (store.counterparties.find((c) => c.id === id) || {}).name || "";
    const tradeOf = (id) => store.trades.find((t) => t.id === id) || null;
    const invKind = (inv) => { const t = tradeOf(inv.tradeId); const kinds = {}; for (const l of (inv.lines || t && t.lines || [])) { const k = revKindOf(l.description, inv.meta || (t && t.meta)); kinds[k] = r2((kinds[k] || 0) + lineNet(l)); } if (!Object.keys(kinds).length) kinds[revKindOf("", inv.meta || (t && t.meta))] = +inv.net || 0; return kinds; };
    const docStatusOf = (doc) => docStatus(doc);
    if (model === "agency") {
      for (const j of store.ledger) { if (j.reversedBy) continue; if (!inR(j.date)) continue; const r = j.ref || {}; for (const l of j.lines) { if (l.account !== "owners_due" || l.sub !== vesselId) continue; const amt = r2((l.credit || 0) - (l.debit || 0)); if (!amt) continue; const kind = (l.tags && l.tags.kind) || null;
        if (r.type === "delivery") { const inv = store.invoices.find((x) => x.id === r.invoiceId); const k = kind || "other"; push({ date: j.date, ref: inv ? inv.ref : j.memo, kind: k, bucket: bucketOfKind(k), description: inv ? ((tradeOf(inv.tradeId) || {}).ref ? j.memo : j.memo) : j.memo, amount: amt, counterpartyId: inv ? inv.counterpartyId : r.counterpartyId || null, docKind: "invoice", docId: inv ? inv.id : null, voyageId: (l.tags && l.tags.voyageId) || r.voyageId || null, fixtureId: (l.tags && l.tags.fixtureId) || r.fixtureId || null, status: inv ? docStatusOf(inv) : "posted", gross: amt > 0 }); }
        else if (r.type === "remit") { push({ date: j.date, ref: "Remittance", kind: "remit", bucket: "remit", description: j.memo, amount: amt, counterpartyId: r.counterpartyId || null, docKind: "remit", docId: r.paymentId || null, voyageId: null, fixtureId: null, status: "paid" }); }
        else if (r.type === "creditnote") { const cn = store.documents.find((x) => x.id === r.docId); push({ date: j.date, ref: cn ? cn.ref : "Credit note", kind: "credit", bucket: (() => { const inv0 = cn ? store.invoices.find((x) => x.id === cn.invoiceId) : null; const ks = inv0 ? Object.keys(invKind(inv0)) : []; return ks.length && ks.every((k) => bucketOfKind(k) === "freight") ? "freight" : "others"; })(), description: j.memo, amount: amt, counterpartyId: cn ? cn.counterpartyId : null, docKind: "creditnote", docId: r.docId || null, voyageId: null, fixtureId: null, status: "posted", gross: true }); }
        else { const bill = r.billId ? store.bills.find((x) => x.id === r.billId) : null; const tx = r.txId ? store.bankTx.find((x) => x.id === r.txId) : null; const cat = (bill && bill.category) || (tx && tx.category) || (l.sub && typeof l.sub === "string" ? l.sub : "") || "Other"; const income = amt > 0 && (!tx || tx.kind === "in"); push({ date: j.date, ref: bill ? bill.ref : tx ? tx.reference || "Bank" : "Journal", kind: income ? (tx ? "income" : "other") : cat, bucket: income ? "others" : bucketOfCost(cat), description: j.memo, amount: amt, counterpartyId: r.counterpartyId || (bill && bill.counterpartyId) || (tx && tx.counterpartyId) || null, docKind: bill ? "bill" : tx ? "banktx" : "journal", docId: bill ? bill.id : tx ? tx.id : j.id, voyageId: (l.tags && l.tags.voyageId) || r.voyageId || (bill && bill.voyageId) || (tx && tx.voyageId) || null, fixtureId: (l.tags && l.tags.fixtureId) || null, status: bill ? docStatusOf(bill) : tx ? "paid" : "posted", gross: income }); } } }
    } else {
      // principal: her documents, in her currency, the same shape — nothing is due to anyone, the balance is her result
      const fxOf = (d) => (+d.fx > 0 ? +d.fx : 1);
      for (const inv of store.invoices) { const vid = inv.vesselId || (tradeOf(inv.tradeId) || {}).vesselId; if (vid !== vesselId || !inR(inv.date)) continue; const kinds = invKind(inv); for (const [k, amt] of Object.entries(kinds)) { if (!amt) continue; const a = r2(amt * fxOf(inv)); push({ date: inv.date, ref: inv.ref, kind: k, bucket: bucketOfKind(k), description: (tradeOf(inv.tradeId) || {}).ref || inv.ref, amount: a, counterpartyId: inv.counterpartyId, docKind: "invoice", docId: inv.id, voyageId: inv.voyageId || null, fixtureId: inv.fixtureId || null, status: docStatusOf(inv), gross: a > 0 }); } }
      for (const cn of store.documents) { if (cn.type !== "creditnote" || !inR(cn.date)) continue; const inv = store.invoices.find((x) => x.id === cn.invoiceId); const vid = inv && (inv.vesselId || (tradeOf(inv.tradeId) || {}).vesselId); if (vid !== vesselId) continue; push({ date: cn.date, ref: cn.ref, kind: "credit", bucket: (() => { const ks = Object.keys(invKind(inv)); return ks.length && ks.every((k) => bucketOfKind(k) === "freight") ? "freight" : "others"; })(), description: "Credit note against " + inv.ref, amount: -r2(cn.net * fxOf(cn)), counterpartyId: cn.counterpartyId, docKind: "creditnote", docId: cn.id, voyageId: inv.voyageId || null, fixtureId: inv.fixtureId || null, status: "posted", gross: true }); }
      for (const bill of store.bills) { const vid = bill.vesselId || (tradeOf(bill.tradeId) || {}).vesselId; const shares = bill.allocations && bill.allocations.length ? bill.allocations.filter((a) => a.vesselId === vesselId) : vid === vesselId ? [{ amount: bill.net, voyageId: bill.voyageId || null, fixtureId: bill.fixtureId || null, category: null }] : []; if (!shares.length || !inR(bill.date) || bill.pending) continue; for (const a of shares) { const cat = a.category || bill.category || bill.memo || "Vendor bills"; const amt = bill.allocations ? r2(a.amount * (bill.net / bill.amount)) : a.amount; push({ date: bill.date, ref: bill.ref, kind: cat, bucket: bucketOfCost(cat), description: bill.memo || cat, amount: -r2(amt * fxOf(bill)), counterpartyId: bill.counterpartyId, docKind: "bill", docId: bill.id, voyageId: a.voyageId || null, fixtureId: a.fixtureId || null, status: docStatusOf(bill), gross: false }); } }
      for (const tx of store.bankTx) { if (tx.reversed || !inR(tx.date)) continue; const bank = store.banks.find((x) => x.id === tx.bankId) || {}; const rate = bank.fx || 1; const shares = tx.allocations && tx.allocations.length ? tx.allocations.filter((a) => a.vesselId === vesselId) : tx.vesselId === vesselId ? [{ amount: tx.amount, voyageId: tx.voyageId || null, fixtureId: tx.fixtureId || null, category: null }] : []; for (const a of shares) { const cat = a.category || tx.category || "Other"; const amt = r2(a.amount * (tx.net / tx.amount) * rate); if (tx.kind === "in") push({ date: tx.date, ref: tx.reference || "Bank", kind: "income", bucket: "others", description: tx.memo || cat, amount: amt, counterpartyId: tx.counterpartyId, docKind: "banktx", docId: tx.id, voyageId: a.voyageId || null, fixtureId: a.fixtureId || null, status: "paid", gross: true }); else push({ date: tx.date, ref: tx.reference || "Bank", kind: cat, bucket: bucketOfCost(cat), description: tx.memo || cat, amount: -amt, counterpartyId: tx.counterpartyId, docKind: "banktx", docId: tx.id, voyageId: a.voyageId || null, fixtureId: a.fixtureId || null, status: "paid", gross: false }); } }
    }
    lines.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    const gross = { byKind: {}, total: 0 }, deductions = { byKind: {}, total: 0 }; let fees = 0, remitted = 0; const buckets = { freight: { gross: 0, deductions: 0, net: 0 }, others: { gross: 0, deductions: 0, net: 0 } }; const monthsMap = {};
    const mon = (dt) => { const m = String(dt || "").slice(0, 7); return monthsMap[m] || (monthsMap[m] = { month: m, gross: 0, deductions: 0, net: 0, remitted: 0, balance: 0 }); };
    // the manager's own income on an agency vessel (fee and kept commissions) is revenue, shown beside the owners' figures
    if (model === "agency") for (const j of store.ledger) { if (j.reversedBy || !inR(j.date)) continue; const r = j.ref || {}; if (r.type !== "delivery" && r.type !== "creditnote") continue; const inv = r.invoiceId ? store.invoices.find((x) => x.id === r.invoiceId) : null; const vid = inv ? inv.vesselId || (tradeOf(inv.tradeId) || {}).vesselId : r.vesselId; if (vid !== vesselId) continue; for (const l of j.lines) if (l.account === "revenue") fees = r2(fees + (l.credit || 0) - (l.debit || 0)); }
    for (const l of lines) { const m = mon(l.date); if (l.bucket === "remit") { remitted = r2(remitted - l.amount); m.remitted = r2(m.remitted - l.amount); continue; } if (l.amount > 0) { gross.byKind[l.kind] = r2((gross.byKind[l.kind] || 0) + l.amount); gross.total = r2(gross.total + l.amount); buckets[l.bucket].gross = r2(buckets[l.bucket].gross + l.amount); m.gross = r2(m.gross + l.amount); } else { deductions.byKind[l.kind] = r2((deductions.byKind[l.kind] || 0) - l.amount); deductions.total = r2(deductions.total - l.amount); buckets[l.bucket].deductions = r2(buckets[l.bucket].deductions - l.amount); m.deductions = r2(m.deductions - l.amount); } }
    for (const k of Object.keys(buckets)) buckets[k].net = r2(buckets[k].gross - buckets[k].deductions);
    const months = Object.values(monthsMap).sort((a, b) => (a.month < b.month ? -1 : 1)); let run = 0; for (const m of months) { m.net = r2(m.gross - m.deductions); run = r2(run + m.net - m.remitted); m.balance = run; }
    const net = r2(gross.total - deductions.total); const balance = model === "agency" ? r2(net - remitted) : net;
    return { vesselId, model, currency, entityId, gross, deductions, fees, net, remitted, balance, buckets, lines, months };
  }

  const docOpen = (doc) => (doc.pending ? 0 : r2(doc.amount - doc.paid - (doc.credited || 0)));
  const docStatus = (doc, asOf) => { if (doc.pending) return "not delivered"; const open = docOpen(doc); if (open < 0.01) return (doc.credited || 0) > 0 && (doc.credited || 0) >= doc.amount - 0.01 ? "credited" : "paid"; return doc.due < (asOf || today()) ? "overdue" : "open"; };
  function creditNote(store, d) {
    const inv = store.invoices.find((x) => x.id === d.invoiceId); if (!inv) throw new Error("Invoice required");
    const net = r2(+d.amount); if (!net) throw new Error("Amount required");
    const vr = vatOf(inv.vatRate, inv.vatKind), vat = r2(net * vr / 100), gross = r2(net + vat); guard(store, "credit-note", { entityId: inv.entityId, amount: gross, currency: inv.currency, d });
    if (gross > docOpen(inv) + 0.01) throw new Error("Credit note exceeds the open balance of " + fmtMoney(docOpen(inv)));
    inv.credited = r2((inv.credited || 0) + gross);
    const cn = { id: uid("cn"), type: "creditnote", ref: ((store.entities.find((e) => e.id === inv.entityId) || {}).docPrefix || "") + "CN-" + String(store.documents.filter((x) => x.type === "creditnote" && x.entityId === inv.entityId).length + 1).padStart(4, "0"), altCurrency: inv.altCurrency, altRate: inv.altRate, entityId: inv.entityId, counterpartyId: inv.counterpartyId, invoiceId: inv.id, tradeId: inv.tradeId, date: d.date || today(), net, vat, vatRate: vr, amount: gross, currency: inv.currency, fx: inv.fx, reason: d.reason || "", custom: d.custom || {} };
    store.documents.push(cn);
    const base = r2(net * inv.fx), baseVat = r2(vat * inv.fx);
    const lines = []; { const dj = store.ledger.find((x) => x.ref && x.ref.invoiceId === inv.id && x.ref.type === "delivery" && !x.reversedBy); const od = dj ? r2(sum(dj.lines.filter((l) => l.account === "owners_due"), (l) => l.credit - l.debit)) : 0; const rv = dj ? r2(sum(dj.lines.filter((l) => l.account === "revenue"), (l) => l.credit - l.debit)) : 0; if (od > 0 && od + rv > 0) { const share = r2(base * od / (od + rv)); lines.push({ account: "owners_due", sub: inv.vesselId || (dj.lines.find((l) => l.account === "owners_due") || {}).sub || null, debit: share, tags: { vesselId: inv.vesselId || null } }); if (r2(base - share)) lines.push({ account: "revenue", sub: null, debit: r2(base - share) }); } else lines.push({ account: "revenue", sub: null, debit: base }); }
    if (baseVat) lines.push({ account: "vat_output", debit: baseVat }); lines.push({ account: "ar", sub: inv.counterpartyId, credit: r2(base + baseVat), currency: inv.currency, amount: gross });
    post(store, inv.entityId, cn.date, "Credit note " + cn.ref + " against " + inv.ref, lines, { type: "creditnote", docId: cn.id, invoiceId: inv.id, vesselId: inv.vesselId || null });
    const t = store.trades.find((x) => x.id === inv.tradeId); if (t) t.events.push({ by: who(store), date: cn.date, type: "credit", text: cn.ref + " " + fmtMoney(gross, inv.currency) + (cn.reason ? " — " + cn.reason : "") });
    return cn;
  }

  // ---------------------------------------------------------------- futures
  function openFutures(store, d) {
    const acc = store.futuresAccounts.find((x) => x.id === d.accountId); const k = store.contracts.find((x) => x.id === d.contractId);
    if (!acc || !k) throw new Error("Account and contract required"); if (!(+d.lots > 0)) throw new Error("Lots must be greater than zero"); if (!(+d.entry > 0)) throw new Error("Entry price required");
    const f = { id: uid("ft"), ref: "FUT-" + String(store.futuresTrades.length + 1).padStart(4, "0"), accountId: acc.id, entityId: acc.entityId, contractId: k.id, side: d.side === "sell" ? "sell" : "buy", lots: +d.lots, entry: +d.entry, exit: null, openDate: d.date || today(), closeDate: null, expiry: d.expiry || "", fees: r2((+d.fees || k.feePerLot * +d.lots)), hedgeFor: d.hedgeFor || null, note: d.note || "" };
    store.futuresTrades.push(f);
    if (f.fees) post(store, acc.entityId, f.openDate, "Fees " + f.ref, [{ account: "fees", sub: f.id, debit: r2(f.fees * acc.fx) }, { account: "futures", sub: acc.id, credit: r2(f.fees * acc.fx), currency: acc.currency, amount: f.fees }], { type: "futures_fee", futuresId: f.id });
    return f;
  }
  const futPnl = (k, f, px) => r2((px - f.entry) * (f.side === "buy" ? 1 : -1) * f.lots * k.lotSize);
  function closeFutures(store, d) {
    const f = store.futuresTrades.find((x) => x.id === d.tradeId); const k = store.contracts.find((x) => x.id === f.contractId); const acc = store.futuresAccounts.find((x) => x.id === f.accountId);
    if (f.exit != null) return;
    f.exit = +d.exit; f.closeDate = d.date || today();
    const pnl = futPnl(k, f, f.exit), base = r2(pnl * acc.fx);
    const closeFee = r2(+d.fees || k.feePerLot * f.lots); f.closeFees = closeFee;
    const lines = pnl >= 0
      ? [{ account: "futures", sub: acc.id, debit: base, currency: acc.currency, amount: pnl }, { account: "futures_pnl", sub: k.id, credit: base }]
      : [{ account: "futures_pnl", sub: k.id, debit: -base }, { account: "futures", sub: acc.id, credit: -base, currency: acc.currency, amount: -pnl }];
    if (closeFee) lines.push({ account: "fees", sub: f.id, debit: r2(closeFee * acc.fx) }, { account: "futures", sub: acc.id, credit: r2(closeFee * acc.fx), currency: acc.currency, amount: closeFee });
    post(store, acc.entityId, f.closeDate, "Close " + f.ref + " @ " + f.exit, lines, { type: "futures_close", futuresId: f.id });
    return pnl;
  }
  function markContract(store, contractId, price, date) { const k = store.contracts.find((x) => x.id === contractId); k.lastMark = +price; k.markDate = date || today(); }
  function futuresAccountView(store, accId) {
    const acc = store.futuresAccounts.find((x) => x.id === accId);
    const cash = r2(bal(store, acc.entityId, (l) => l.account === "futures" && l.sub === acc.id) / (acc.fx || 1));
    const open = store.futuresTrades.filter((f) => f.accountId === accId && f.exit == null);
    const rows = open.map((f) => { const k = store.contracts.find((x) => x.id === f.contractId); const mark = k.lastMark != null ? k.lastMark : f.entry; return { f, k, mark, unrealized: futPnl(k, f, mark), margin: r2(k.marginPerLot * f.lots), mt: r2(f.lots * k.lotSize * k.mtPerUnit) * (f.side === "buy" ? 1 : -1) }; });
    const unrealized = r2(sum(rows, (r) => r.unrealized)), margin = r2(sum(rows, (r) => r.margin));
    const realized = r2(sum(store.futuresTrades.filter((f) => f.accountId === accId && f.exit != null), (f) => futPnl(store.contracts.find((x) => x.id === f.contractId), f, f.exit)));
    const equity = r2(cash + unrealized);
    return { acc, cash, unrealized, realized, margin, equity, excess: r2(equity - margin), marginUse: margin ? margin / Math.max(equity, 1) : 0, rows };
  }

  // ---------------------------------------------------------------- compliance
  const norm = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const STOP = new Set(["ltd", "limited", "co", "company", "corp", "corporation", "inc", "llc", "llp", "plc", "pte", "as", "aps", "sa", "ag", "gmbh", "bv", "nv", "dmcc", "fze", "fzco", "shipping", "maritime", "marine", "trading", "group", "holdings", "holding", "international", "the", "of", "and", "mv", "mt", "ms"]);
  const tokens = (s) => (s || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((t) => t.length > 1 && !STOP.has(t));
  function nameMatch(a, b) {
    const ta = tokens(a), tb = tokens(b); if (!ta.length || !tb.length) return 0;
    const shared = ta.filter((t) => tb.includes(t) || tb.some((u) => u.length > 4 && (u.startsWith(t) || t.startsWith(u))));
    if (!shared.length) return 0;
    if (norm(a) === norm(b)) return 1;
    const ratio = shared.length / Math.min(ta.length, tb.length);
    return ratio >= 0.5 || shared.some((t) => t.length >= 6) ? Math.max(ratio, 0.6) : 0;
  }
  function screenSubject(store, type, id) {
    const s = type === "vessel" ? store.vessels.find((v) => v.id === id) : store.counterparties.find((c) => c.id === id);
    const hits = [];
    for (const w of store.watchlist) {
      const m = nameMatch(s.name, w.name); if (w.name && m) hits.push({ rule: m >= 1 ? "name (exact)" : "name (similar)", item: w, strength: m });
      if (type === "vessel" && w.imo && s.imo && String(w.imo) === String(s.imo)) hits.push({ rule: "imo", item: w });
      if (type !== "vessel" && w.registration && s.registration && norm(w.registration) === norm(s.registration)) hits.push({ rule: "registration", item: w });
    }
    const country = type === "vessel" ? s.flag : s.country;
    if (country && store.settings.highRiskCountries.includes(country.toUpperCase())) hits.push({ rule: "high-risk jurisdiction", item: { name: country } });
    const hasBlock = hits.some((h) => h.item.severity === "block" || h.rule === "imo" || h.rule === "registration");
    return { result: hits.length ? (hasBlock ? "block" : "flag") : "clear", hits };
  }
  function recordScreening(store, d) {
    const auto = screenSubject(store, d.type, d.id);
    const s = { id: uid("s"), type: d.type, subjectId: d.id, date: d.date || today(), result: d.result || auto.result, hits: auto.hits, method: d.method || "internal watchlist", by: d.by || "", notes: d.notes || "" };
    store.screenings.push(s); invalidate(store); return s;
  }
  function autoScreen(store, type, id) { const cs = complianceStatus(store, type, id); if (cs.state === "unscreened" || cs.state === "stale") return recordScreening(store, { type, id, by: "Engine (automatic)" }); return null; }
  function rescreenStale(store) { let n = 0; for (const c of store.counterparties) if (autoScreen(store, "counterparty", c.id)) n++; for (const v of store.vessels) if (autoScreen(store, "vessel", v.id)) n++; return n; }
  function rescreenAll(store, by) { for (const c of store.counterparties) recordScreening(store, { type: "counterparty", id: c.id, by: by || "Watchlist change" }); for (const v of store.vessels) recordScreening(store, { type: "vessel", id: v.id, by: by || "Watchlist change" }); }
  function lookup(store, q) {
    // ad-hoc check of any name / IMO / registration against the watchlist and jurisdiction list, without onboarding
    const hits = []; const t = (q || "").trim(); if (!t) return { result: "clear", hits };
    for (const w of store.watchlist) { const m = nameMatch(t, w.name); if (w.name && m) hits.push({ rule: m >= 1 ? "name (exact)" : "name (similar)", item: w, strength: m }); if (w.imo && String(w.imo) === t) hits.push({ rule: "imo", item: w }); if (w.registration && norm(w.registration) === norm(t)) hits.push({ rule: "registration", item: w }); }
    if (t.length === 2 && store.settings.highRiskCountries.includes(t.toUpperCase())) hits.push({ rule: "high-risk jurisdiction", item: { name: t.toUpperCase() } });
    const known = [...store.counterparties.filter((c) => nameMatch(t, c.name) || (c.registration && norm(c.registration) === norm(t))).map((c) => ({ type: "counterparty", id: c.id, name: c.name, state: complianceStatus(store, "counterparty", c.id).state })), ...store.vessels.filter((v) => nameMatch(t, v.name) || (v.imo && v.imo === t)).map((v) => ({ type: "vessel", id: v.id, name: v.name, state: complianceStatus(store, "vessel", v.id).state }))];
    return { result: hits.length ? (hits.some((h) => h.item.severity === "block" || h.rule === "imo" || h.rule === "registration") ? "block" : "flag") : "clear", hits, known };
  }
  function complianceStatus(store, type, id) {
    const list = store.screenings.filter((s) => s.type === type && s.subjectId === id).sort((a, b) => (a.date < b.date ? 1 : -1));
    if (!list.length) return { state: "unscreened", last: null, age: null };
    const last = list[0]; const age = daysBetween(last.date, today());
    if (last.result === "block") return { state: "blocked", last, age };
    if (last.result === "flag") return { state: "flagged", last, age };
    return { state: age > store.settings.screeningValidityDays ? "stale" : "clear", last, age };
  }

  // ---------------------------------------------------------------- computed views
  function bankBalanceBase(store, bankId, until) {
    const b = store.banks.find((x) => x.id === bankId);
    if (!until) { if (!store.__cache) Object.defineProperty(store, "__cache", { value: { profiles: {}, stmts: {}, banks: {} }, enumerable: false, writable: true, configurable: true }); if (!store.__cache.banks) store.__cache.banks = {}; if (store.__cache.banks[bankId] != null) return store.__cache.banks[bankId]; }
    const v = bal(store, b.entityId, (l) => l.account === "cash" && l.sub === bankId, until); if (!until) store.__cache.banks[bankId] = v; return v;
  }
  function bankBalance(store, bankId, until) { const b = store.banks.find((x) => x.id === bankId); return r2(bankBalanceBase(store, bankId, until) / (b.fx || 1)); }
  function entityStatements(store, entityId, from, to) {
    if (!store.__cache) Object.defineProperty(store, "__cache", { value: { profiles: {}, stmts: {} }, enumerable: false, writable: true, configurable: true });
    if (!store.__cache.stmts) store.__cache.stmts = {};
    const fp = fingerprint(store); if (store.__cache.fp !== fp) { store.__cache.fp = fp; store.__cache.cargo = {}; store.__cache.profiles = {}; store.__cache.stmts = {}; store.__cache.banks = {}; }
    const ck = entityId + "|" + (from || "") + "|" + (to || ""); if (store.__cache.stmts[ck]) return store.__cache.stmts[ck];
    // one pass over the ledger: cumulative balances to `to`, and period movements from..to
    const cum = {}, per = {}; const expenseByCat = {};
    for (const j of store.ledger) { if (j.entityId !== entityId) continue; if (to && j.date > to) continue; const inPeriod = !from || j.date >= from; for (const l of j.lines) { const v = l.debit - l.credit; cum[l.account] = (cum[l.account] || 0) + v; if (inPeriod) { per[l.account] = (per[l.account] || 0) + v; if (l.account === "expense") expenseByCat[l.sub || "Other"] = r2((expenseByCat[l.sub || "Other"] || 0) + v); } } }
    const A = (k) => r2(cum[k] || 0), P = (k) => r2(per[k] || 0);
    const cash = A("cash"), futures = A("futures"), inventory = A("inventory"), ar = A("ar"), ap = -A("ap"), ownersDue = -A("owners_due"), capital = -A("capital"), vatIn = A("vat_input"), vatOut = -A("vat_output"), priorRetained = -A("retained_earnings");
    const cust = customAccounts(store); const cx = { asset: 0, liability: 0, equity: 0, income: 0, expense: 0 }, cxAll = { income: 0, expense: 0 }; const custVals = {};
    for (const a of cust) { let v = 0; if (a.kind === "asset") { v = A(a.code); cx.asset += v; } else if (a.kind === "liability") { v = -A(a.code); cx.liability += v; } else if (a.kind === "equity") { v = -A(a.code); cx.equity += v; } else if (a.kind === "income") { v = -P(a.code); cx.income += v; cxAll.income -= A(a.code); } else if (a.kind === "expense") { v = P(a.code); cx.expense += v; cxAll.expense += A(a.code); } custVals["c_" + a.code] = r2(v); }
    const revenue = -P("revenue"), cogs = P("cogs"), loss = P("inventory_loss"), fees = P("fees"), futPnlv = -P("futures_pnl"), expenses = P("expense"), otherIncome = -P("other_income") + r2(cx.income), fx = -P("fx_diff");
    const gross = r2(revenue - cogs), net = r2(gross - loss - fees + futPnlv - expenses + otherIncome + fx - cx.expense);
    const retainedAll = r2(-A("revenue") - A("cogs") - A("inventory_loss") - A("fees") - A("futures_pnl") - A("expense") - A("other_income") - A("fx_diff") + cxAll.income - cxAll.expense);
    const res = { ...custVals, cash, futures, inventory, ar, ap, ownersDue, capital, vatIn, vatOut, vatNet: r2(vatOut - vatIn), revenue, cogs, gross, loss, fees, futPnl: futPnlv, expenses, expenseByCat, otherIncome: r2(-P("other_income")), fx, net, retained: retainedAll, priorRetained, lastClose: lastClose(store, entityId), otherAssets: r2(cx.asset), otherLiabilities: r2(cx.liability), otherEquity: r2(cx.equity), otherExpenses: r2(cx.expense), otherIncomeCustom: r2(cx.income),
      assets: r2(cash + futures + inventory + ar + vatIn + cx.asset), liabilities: r2(ap + ownersDue + vatOut + cx.liability), equity: r2(capital + priorRetained + retainedAll + cx.equity) };
    store.__cache.stmts[ck] = res; return res;
  }

  function invalidate(store) { if (store.__cache) { store.__cache.profiles = {}; store.__cache.stmts = {}; store.__cache.banks = {}; store.__cache.cargo = {}; } /* 4.13: a revision counter the PROSHIP indexes key on (non-enumerable: never saved) */ try { Object.defineProperty(store, "__rev", { value: (store.__rev || 0) + 1, writable: true, enumerable: false, configurable: true }); } catch (e) { /* frozen store */ } }
  function counterpartyProfile(store, cpId, asOf) {
    asOf = asOf || today();
    if (!store.__cache) Object.defineProperty(store, "__cache", { value: { profiles: {} }, enumerable: false, writable: true, configurable: true });
    const fp = fingerprint(store); if (store.__cache.fp !== fp) { store.__cache.fp = fp; store.__cache.cargo = {}; store.__cache.profiles = {}; store.__cache.stmts = {}; store.__cache.banks = {}; }
    const ck = cpId + "|" + asOf; if (store.__cache.profiles[ck]) return store.__cache.profiles[ck];
    const res = counterpartyProfileCalc(store, cpId, asOf); store.__cache.profiles[ck] = res; return res;
  }
  function counterpartyProfileCalc(store, cpId, asOf) {
    const cp = store.counterparties.find((c) => c.id === cpId);
    const trades = store.trades.filter((t) => t.customerId === cpId && t.status !== "cancelled");
    const delivered = trades.filter((t) => t.status === "delivered");
    const invs = store.invoices.filter((i) => i.counterpartyId === cpId);
    const openInv = invs.filter((i) => docOpen(i) > 0.01);
    const overdue = openInv.filter((i) => i.due < asOf);
    const arOpen = r2(sum(openInv, (i) => docOpen(i) * i.fx));
    const undelivered = r2(sum(trades.filter((t) => t.status === "agreed"), (t) => tradeValue(t) * t.fx));
    const exposure = r2(arOpen + undelivered);
    const paidInv = invs.filter((i) => i.paidDate);
    const dtp = paidInv.map((i) => daysBetween(i.date, i.paidDate));
    const margins = delivered.map((t) => tradeMargin(store, t)).filter((m) => m.perMT != null);
    const volume = r2(sum(delivered, productMT));
    const revenue = r2(sum(delivered, (t) => tradeValue(t) * t.fx));
    const last = trades.slice().sort((a, b) => (a.date < b.date ? 1 : -1))[0];
    const recent = delivered.filter((t) => daysBetween(t.date, asOf) <= 90), prior = delivered.filter((t) => { const d = daysBetween(t.date, asOf); return d > 90 && d <= 180; });
    const trend = prior.length ? (sum(recent, (t) => t.deliveredQty) - sum(prior, (t) => t.deliveredQty)) / Math.max(1, sum(prior, (t) => t.deliveredQty)) : null;
    const supplies = store.cargoes.filter((c) => c.supplierId === cpId);
    const bills = store.bills.filter((b) => b.counterpartyId === cpId);
    const serviceBills = bills.filter((b) => b.internal);
    const apOpen = r2(sum(bills.filter((b) => docOpen(b) > 0.01), (b) => docOpen(b) * b.fx));
    return { cp, trades, delivered, invoices: invs, openInvoices: openInv, overdue, arOpen, undelivered, exposure, creditLimit: cp.creditLimit, utilization: cp.creditLimit ? exposure / cp.creditLimit : null,
      avgDaysToPay: dtp.length ? r2(avg(dtp)) : null, paidCount: dtp.length, avgMarginMT: margins.length ? r2(avg(margins.map((m) => m.perMT))) : null, totalMargin: r2(sum(margins, (m) => m.total)),
      volume, revenue, last, trend, supplies, bills, serviceBills, apOpen, daysSinceLast: last ? daysBetween(last.date, asOf) : null, compliance: complianceStatus(store, "counterparty", cpId),
      vessels: cp.vesselIds.map((id) => store.vessels.find((v) => v.id === id)).filter(Boolean) };
  }
  function priceSeries(store, productId, port, side, days) {
    const asOf = today(); const f = (x) => x.productId === productId && (!port || norm(x.port) === norm(port)) && daysBetween(x.date, asOf) <= (days || 90);
    if (side === "buy") return store.cargoes.filter(f).map((c) => ({ date: c.date, price: c.price, qty: c.qty, port: c.port })).sort((a, b) => (a.date < b.date ? -1 : 1));
    return store.trades.filter((t) => t.status !== "cancelled" && f(t)).map((t) => ({ date: t.date, price: t.price, qty: t.qty, port: t.port })).sort((a, b) => (a.date < b.date ? -1 : 1));
  }
  function positions(store, entityId) {
    const out = {};
    for (const c of store.cargoes.filter((c) => (entIn(c.entityId, entityId)) && c.received)) {
      const st = cargoStatus(store, c); const p = (out[c.productId] = out[c.productId] || { productId: c.productId, physicalMT: 0, sellableMT: 0, value: 0, forwardSoldMT: 0, hedgeMT: 0, cargoes: 0 });
      p.physicalMT += st.physical; p.sellableMT += st.sellable; p.value += st.physical * st.unitCost * c.fx; p.cargoes++;
    }
    for (const t of store.trades.filter((t) => (entIn(t.entityId, entityId)) && t.status === "agreed")) for (const l of productLines(t).filter((l) => !l.cargoId)) { const p = (out[l.productId] = out[l.productId] || { productId: l.productId, physicalMT: 0, sellableMT: 0, value: 0, forwardSoldMT: 0, hedgeMT: 0, cargoes: 0 }); p.forwardSoldMT += l.qty; }
    for (const f of store.futuresTrades.filter((f) => (entIn(f.entityId, entityId)) && f.exit == null)) {
      const k = store.contracts.find((x) => x.id === f.contractId); if (!k.productId) continue;
      const p = (out[k.productId] = out[k.productId] || { productId: k.productId, physicalMT: 0, sellableMT: 0, value: 0, forwardSoldMT: 0, hedgeMT: 0, cargoes: 0 });
      p.hedgeMT += f.lots * k.lotSize * k.mtPerUnit * (f.side === "buy" ? 1 : -1);
    }
    return Object.values(out).map((p) => ({ ...p, physicalMT: r2(p.physicalMT), sellableMT: r2(p.sellableMT), value: r2(p.value), hedgeMT: r2(p.hedgeMT), netMT: r2(p.physicalMT - p.forwardSoldMT + p.hedgeMT), hedgeRatio: p.physicalMT ? -p.hedgeMT / p.physicalMT : 0 }));
  }
  function cashForecast(store, entityId, horizonDays) {
    const asOf = today(); const h = horizonDays || store.settings.workingCapitalHorizonDays;
    const ents = store.entities.map((e) => e.id).filter((id) => entIn(id, entityId));
    const days = []; let running = r2(sum(store.banks.filter((b) => ents.includes(b.entityId)), (b) => bankBalanceBase(store, b.id) * groupRate(store, b.entityId, entityId)));
    const start = running;
    const ins = store.invoices.filter((i) => ents.includes(i.entityId) && docOpen(i) > 0.01), outs = store.bills.filter((b) => ents.includes(b.entityId) && (b.pending || docOpen(b) > 0.01)).map((b) => (b.pending ? { ...b, __open: b.amount } : { ...b, __open: docOpen(b) }));
    for (let d = 0; d <= h; d++) {
      const date = addDays(asOf, d);
      const inn = r2(sum(ins.filter((i) => (d === 0 ? i.due <= date : i.due === date)), (i) => docOpen(i) * i.fx * groupRate(store, i.entityId, entityId)));
      const out = r2(sum(outs.filter((b) => (d === 0 ? b.due <= date : b.due === date)), (b) => b.__open * b.fx * groupRate(store, b.entityId, entityId)));
      running = r2(running + inn - out); days.push({ date, inn, out, balance: running });
    }
    const low = days.reduce((m, x) => (x.balance < m.balance ? x : m), days[0]);
    return { start, days, low, end: days[days.length - 1].balance };
  }

  // ---------------------------------------------------------------- intelligence
  function analyzeTrade(store, d) {
    // d: {entityId, customerId, vesselId, productId, qty, price, port, cargoId, terms, deliveryDate, backToBack, buyPrice}
    const sig = []; const add = (level, area, text, data) => sig.push({ level, area, text, data });
    const ent = store.entities.find((e) => e.id === d.entityId), cp = store.counterparties.find((c) => c.id === d.customerId); let prod = store.products.find((p) => p.id === d.productId);
    normLines.store = store; const L2 = d.lines ? normLines({ ...d, lines: d.lines }) : null; const P0 = L2 ? L2.find((l) => l.kind === "product") : null;
    if (P0) { d = { ...d, productId: P0.productId, qty: P0.qty, price: P0.price, cargoId: P0.cargoId, backToBack: !!(P0.b2b && P0.b2b.buyPrice), buyPrice: P0.b2b ? P0.b2b.buyPrice : d.buyPrice }; }
    const prod2 = P0 ? store.products.find((p) => p.id === P0.productId) : prod;
    const qty = +d.qty || 0, price = +d.price || 0, value = L2 ? r2(sum(L2, lineNet)) : r2(qty * price);
    prod = prod2;
    // 4.30 · d.services: lines without a product (hire, freight, a service) are enough — the counterparty, credit, cash and relationship
    // signals run; what needs a product and a cargo (inventory, margin per MT, dealt prices, hedge) is skipped
    const svcOnly = !!d.services && !P0 && !!L2 && L2.length > 0 && value > 0;
    if (!ent || !cp || (!svcOnly && (!prod2 || !qty || (!price && !(cp.internal && price === 0))))) return { ok: false, signals: [{ level: "info", area: "input", text: "Enter entity, customer, product, quantity and price to see the analysis." }], score: null };
    if (L2 && L2.length > 1) { for (const l of L2.slice(1)) { if (l.kind === "service") { add(+l.cost && +l.cost >= lineNet(l) ? "warn" : "ok", "lines", l.description + ": billed " + fmtMoney(lineNet(l)) + (l.cost ? ", costs you " + fmtMoney(l.cost) : ", no cost recorded") + "."); continue; } const p = store.products.find((x) => x.id === l.productId) || {}; if (l.cargoId) { const cg = store.cargoes.find((x) => x.id === l.cargoId); const st = cg ? cargoStatus(store, cg) : null; if (!cg) add("stop", "inventory", "Line " + p.code + ": cargo not found."); else if (cg.productId !== l.productId) add("stop", "inventory", "Line " + p.code + " is sourced from " + cg.ref + " which is " + (store.products.find((x) => x.id === cg.productId) || {}).code + "."); else if (l.qty > st.sellable + 0.001) add("stop", "inventory", "Line " + p.code + ": only " + fmtQty(st.sellable) + " MT sellable on " + cg.ref + ", requested " + fmtQty(l.qty) + "."); else add("ok", "inventory", "Line " + fmtQty(l.qty) + " MT " + p.code + " from " + cg.ref + " at " + fmtMoney(st.unitCost) + "/MT, margin " + fmtMoney(l.price - st.unitCost) + "/MT."); } else if (l.b2b && !(l.b2b.buyPrice > 0 && l.b2b.supplierId)) add("warn", "inventory", "Line " + fmtQty(l.qty) + " " + (l.unit || "MT") + " " + p.code + ": back-to-back, purchase side to be added later."); else if (l.b2b && l.b2b.buyPrice) add(l.price - l.b2b.buyPrice <= 0 ? "stop" : "ok", "margin", "Line " + fmtQty(l.qty) + " MT " + p.code + " back-to-back from " + ((store.counterparties.find((c) => c.id === l.b2b.supplierId) || {}).short || "supplier") + " at " + fmtMoney(l.b2b.buyPrice) + ": margin " + fmtMoney(l.price - l.b2b.buyPrice) + "/MT."); else add("warn", "inventory", "Line " + fmtQty(l.qty) + " MT " + p.code + " is unsourced."); } }
    const prof = counterpartyProfile(store, cp.id);
    if (cp.internal) { const cargoI = d.cargoId ? store.cargoes.find((c) => c.id === d.cargoId) : null; const uc = cargoI ? cargoUnitCost(cargoI) : null; if (uc != null) { const res = r2((price - uc) * qty); add(res < 0 ? "warn" : "ok", "transfer", "Internal transfer to " + cp.name + ": cost " + fmtMoney(uc) + "/MT, price " + fmtMoney(price) + "/MT, " + (res < 0 ? "loss " : "result ") + fmtMoney(res) + " stays in " + ent.name + "; the receiving entity carries the cargo at " + fmtMoney(price) + "/MT."); } add("info", "transfer", "Group total is unchanged by an internal transfer; only the split of result between entities moves."); return finish(sig, { value, margin: uc != null ? r2(price - uc) : null, newExposure: prof.exposure, unitCost: uc }); }
    // compliance
    const cs = prof.compliance;
    if (cs.state === "blocked") add("stop", "compliance", cp.name + " is blocked by the latest screening. Do not trade.", cs);
    else if (cs.state === "flagged") add("warn", "compliance", cp.name + " has an open flag from screening on " + cs.last.date + ". Clear it before delivery.", cs);
    else if (cs.state === "unscreened") add("warn", "compliance", cp.name + " has never been screened.", cs);
    else if (cs.state === "stale") add("warn", "compliance", "Screening of " + cp.name + " is " + cs.age + " days old; re-screen.", cs);
    else add("ok", "compliance", cp.name + " screened clear " + cs.age + " days ago.", cs);
    if (d.vesselId) {
      const v = store.vessels.find((x) => x.id === d.vesselId); const vs = complianceStatus(store, "vessel", v.id);
      if (vs.state === "blocked") add("stop", "compliance", "Vessel " + v.name + " is blocked.", vs);
      else if (vs.state !== "clear") add("warn", "compliance", "Vessel " + v.name + " is " + vs.state + ".", vs);
      if (!cp.vesselIds.includes(v.id)) add("warn", "compliance", v.name + " is not linked to " + cp.name + " in your records. Confirm who is buying for her.");
    }
    // credit
    const newExposure = d.review ? prof.exposure : r2(prof.exposure + value);
    if (cp.creditLimit) {
      const u = newExposure / cp.creditLimit;
      if (u > 1) add("stop", "credit", "This trade takes " + cp.short + " to " + fmtPct(u) + " of its " + fmtMoney(cp.creditLimit) + " credit line (exposure " + fmtMoney(newExposure) + ").", { u, newExposure });
      else if (u > 0.8) add("warn", "credit", "Credit line " + fmtPct(u) + " used after this trade (" + fmtMoney(newExposure) + " of " + fmtMoney(cp.creditLimit) + ").", { u, newExposure });
      else add("ok", "credit", "Credit line " + fmtPct(u) + " used after this trade.", { u, newExposure });
    } else add("warn", "credit", cp.short + " has no credit limit set; exposure after trade " + fmtMoney(newExposure) + ".", { newExposure });
    if (prof.overdue.length) add("warn", "credit", prof.overdue.length + " overdue invoice" + (prof.overdue.length > 1 ? "s" : "") + " (" + fmtMoney(sum(prof.overdue, (i) => docOpen(i) * i.fx)) + "). Oldest due " + prof.overdue.map((i) => i.due).sort()[0] + ".", prof.overdue);
    if (prof.avgDaysToPay != null) {
      const terms = d.terms != null ? +d.terms : cp.terms;
      if (prof.avgDaysToPay > terms + 10) add("warn", "credit", cp.short + " pays in " + prof.avgDaysToPay + " days on average against " + terms + "-day terms. Price the delay or tighten terms.", { dtp: prof.avgDaysToPay, terms });
      else add("ok", "credit", "Pays in " + prof.avgDaysToPay + " days on average (" + prof.paidCount + " invoices).", { dtp: prof.avgDaysToPay });
    } else add("info", "credit", "No payment history yet for " + cp.short + ".");
    // concentration
    const totalAR = r2(sum(store.invoices.filter((i) => i.entityId === ent.id && docOpen(i) > 0.01), (i) => docOpen(i) * i.fx) + sum(store.trades.filter((t) => t.entityId === ent.id && t.status === "agreed"), (t) => t.qty * t.price * t.fx));
    const share = (newExposure) / Math.max(1, totalAR + value);
    if (share > 0.4 && totalAR + value > 0) add("warn", "concentration", cp.short + " would be " + fmtPct(share) + " of " + ent.name + "'s open receivables.", { share });
    // inventory / sourcing
    let unitCost = null, cargo = null;
    if (svcOnly) { if (d.review) { const tr0 = store.trades.find((t) => t.id === d.tradeId); if (tr0) { const m0 = tradeMargin(store, tr0); if (m0.total != null) add(m0.total < 0 ? "stop" : "ok", "margin", "Result " + fmtMoney(m0.total) + " on " + fmtMoney(m0.revenue) + " invoiced after " + fmtMoney(m0.other || 0) + " internal costs."); } } else add("info", "lines", L2.length + " line" + (L2.length === 1 ? "" : "s") + ", " + fmtMoney(value) + " in all" + (L2.some((l) => +l.cost) ? "; costs recorded on the lines " + fmtMoney(sum(L2, (l) => +l.cost || 0)) : "") + "."); }
    else if (d.review) { cargo = store.cargoes.find((c) => c.id === d.cargoId) || null; unitCost = cargo ? cargoUnitCost(cargo) : null; const tr0 = store.trades.find((t) => t.id === d.tradeId); if (tr0) { const m0 = tradeMargin(store, tr0); if (m0.total != null) add(m0.total < 0 ? "stop" : "ok", "margin", "Realised margin " + fmtMoney(m0.total) + " on " + fmtMoney(m0.revenue) + " revenue (" + fmtMoney(m0.perMT) + "/MT after " + fmtMoney(m0.other) + " internal costs)."); } if (!cargo) add("warn", "inventory", "Delivered without a source cargo: no cost of goods was booked against this revenue."); }
    else if (d.cargoId) {
      cargo = store.cargoes.find((c) => c.id === d.cargoId); const st = cargoStatus(store, cargo);
      unitCost = st.unitCost;
      if (cargo.productId !== prod.id) add("stop", "inventory", "Cargo " + cargo.ref + " is " + (store.products.find((p) => p.id === cargo.productId) || {}).code + ", not " + prod.code + ".");
      if (qty > st.sellable + 0.001) add("stop", "inventory", "Only " + fmtQty(st.sellable) + " MT sellable on " + cargo.ref + " (" + fmtQty(st.physical) + " physical less loss allowance). Requested " + fmtQty(qty) + ".", st);
      else add("ok", "inventory", fmtQty(st.sellable - qty) + " MT sellable remains on " + cargo.ref + " after this allocation.", st);
      if (d.port && cargo.port && norm(d.port) !== norm(cargo.port)) add("warn", "inventory", "Cargo sits at " + cargo.port + "; delivery is at " + d.port + ". Add the transfer cost.");
      if (st.ageDays > 45) add("info", "inventory", "Cargo " + cargo.ref + " is " + st.ageDays + " days old; moving it reduces ageing and loss.");
    } else if (d.backToBack && +d.buyPrice) { unitCost = +d.buyPrice; add("info", "inventory", "Back-to-back: purchase at " + fmtMoney(unitCost) + "/MT booked with the sale."); }
    else {
      const pos = positions(store, ent.id).find((p) => p.productId === prod.id);
      if (pos && pos.sellableMT >= qty) add("warn", "inventory", "No cargo selected but " + fmtQty(pos.sellableMT) + " MT of " + prod.code + " is sellable in stock. Allocate from stock to recognise cost.");
      else add("warn", "inventory", "Unsourced forward sale: " + fmtQty(qty) + " MT " + prod.code + " will show as open short until a cargo is allocated.");
    }
    // margin
    let margin = null;
    if (unitCost != null) {
      margin = r2(price - unitCost);
      const hist = prof.avgMarginMT, entHist = entityAvgMargin(store, ent.id, prod.id);
      const base = hist != null ? hist : entHist;
      if (margin < 0) add("stop", "margin", "Negative margin: " + fmtMoney(margin) + "/MT (" + fmtMoney(margin * qty) + " on the trade).", { margin });
      else if (base != null && margin < base * 0.6) add("warn", "margin", "Margin " + fmtMoney(margin) + "/MT is well below your average with " + (hist != null ? cp.short : "this product") + " (" + fmtMoney(base) + "/MT).", { margin, base });
      else add("ok", "margin", "Margin " + fmtMoney(margin) + "/MT, " + fmtMoney(margin * qty) + " total" + (base != null ? " (your average " + fmtMoney(base) + "/MT)" : "") + ".", { margin, base });
    }
    // price vs own dealt
    const ps = svcOnly ? [] : priceSeries(store, prod.id, d.port, "sell", 60), psAll = svcOnly ? [] : priceSeries(store, prod.id, null, "sell", 60);
    const ref = ps.length >= 2 ? ps : psAll;
    if (ref.length >= 2) {
      const last = ref[ref.length - 1].price, mean = avg(ref.map((x) => x.price));
      const dev = (price - mean) / mean;
      add(Math.abs(dev) > 0.05 ? "warn" : "ok", "price", "You dealt " + prod.code + (ps.length >= 2 ? " at " + d.port : "") + " at " + fmtMoney(last) + " last, " + fmtMoney(mean) + " average over 60 days. This is " + (dev >= 0 ? "+" : "") + fmtPct(dev) + " vs average.", { last, mean, dev });
    }
    const bs = svcOnly ? [] : priceSeries(store, prod.id, d.port, "buy", 60);
    if (bs.length) { const lastBuy = bs[bs.length - 1].price; if (price < lastBuy) add("warn", "price", "Sale price is below your last purchase of " + prod.code + " here (" + fmtMoney(lastBuy) + ").", { lastBuy }); }
    if (d.review) { const tr = store.trades.find((t) => t.id === d.tradeId); const inv = tr && store.invoices.find((i) => i.tradeId === tr.id); if (inv) add(inv.paidDate ? "ok" : docStatus(inv) === "overdue" ? "warn" : "info", "settlement", inv.paidDate ? "Settled " + daysBetween(inv.date, inv.paidDate) + " days after invoice against " + tr.terms + "-day terms." : docStatus(inv) === "overdue" ? fmtMoney(docOpen(inv)) + " open, " + daysBetween(inv.due, today()) + " days past due." : fmtMoney(docOpen(inv)) + " open, due " + inv.due + "."); return finish(sig, { value, margin, newExposure, unitCost }); }
    // cash / working capital
    const terms = d.terms != null ? +d.terms : cp.terms; const delivery = d.deliveryDate || today();
    const cashIn = addDays(delivery, terms);
    if (cargo) { const bill = store.bills.find((b) => b.cargoId === cargo.id); if (bill && docOpen(bill) > 0 && bill.due < cashIn) add("info", "cash", "You pay the supplier on " + bill.due + " and collect on " + cashIn + ": " + daysBetween(bill.due, cashIn) + " days of " + fmtMoney(value) + " funded by " + ent.name + ".", { gap: daysBetween(bill.due, cashIn) }); }
    const fc = cashForecast(store, ent.id); if (fc.low.balance < 0) add("warn", "cash", ent.name + " cash goes negative on " + fc.low.date + " (" + fmtMoney(fc.low.balance) + ") on current invoices and bills, before this trade.", fc.low);
    // hedge
    const pos = svcOnly ? null : positions(store, ent.id).find((p) => p.productId === prod.id);
    if (pos && pos.physicalMT > 0) { const after = pos.physicalMT - (cargo ? qty : 0); const hr = after ? -pos.hedgeMT / after : 0; if (after > 2000 && hr < 0.5) add("info", "hedge", fmtQty(after) + " MT " + prod.code + " stays in stock after this trade with " + fmtPct(hr) + " hedged.", { after, hr }); }
    // relationship
    if (prof.daysSinceLast != null && prof.daysSinceLast > 60) add("info", "customer", "First trade with " + cp.short + " in " + prof.daysSinceLast + " days.");
    if (prof.trend != null && prof.trend < -0.3) add("info", "customer", cp.short + "'s volume is down " + fmtPct(-prof.trend) + " vs the prior 90 days.");
    return finish(sig, { value, margin, newExposure, cashIn, unitCost });
  }
  function entityAvgMargin(store, entityId, productId) {
    const ms = store.trades.filter((t) => t.entityId === entityId && t.productId === productId && t.status === "delivered").map((t) => tradeMargin(store, t)).filter((m) => m.perMT != null);
    return ms.length ? r2(avg(ms.map((m) => m.perMT))) : null;
  }
  function analyzeCargo(store, d) {
    const sig = []; const add = (level, area, text, data) => sig.push({ level, area, text, data });
    const ent = store.entities.find((e) => e.id === d.entityId), sup = store.counterparties.find((c) => c.id === d.supplierId), prod = store.products.find((p) => p.id === d.productId);
    const qty = +d.qty || 0, price = +d.price || 0, costs = sum(d.costs || [], (c) => +c.amount || 0), landed = r2(qty * price + costs);
    if (!ent || !prod || !qty || !price) return { ok: false, signals: [{ level: "info", area: "input", text: "Enter entity, product, quantity and price to see the analysis." }], score: null };
    if (sup) { const cs = complianceStatus(store, "counterparty", sup.id); if (cs.state === "blocked") add("stop", "compliance", sup.name + " is blocked."); else if (cs.state !== "clear") add("warn", "compliance", "Supplier " + sup.name + " is " + cs.state + "."); else add("ok", "compliance", "Supplier screened clear " + cs.age + " days ago."); }
    const unit = landed / qty;
    const pos = positions(store, ent.id).find((p) => p.productId === prod.id);
    if (pos && d.existing) { const own = store.cargoes.find((c) => c.id === d.existing); if (own) { const st = cargoStatus(store, own); pos.sellableMT = r2(pos.sellableMT - st.sellable); pos.physicalMT = r2(pos.physicalMT - st.physical); } }
    const asOf = today(); const sold90 = store.trades.filter((t) => t.entityId === ent.id && t.productId === prod.id && t.status === "delivered" && daysBetween(t.date, asOf) <= 90);
    const daily = sum(sold90, (t) => t.deliveredQty) / 90;
    if (pos && pos.sellableMT > 0) {
      const dos = daily ? (pos.sellableMT + qty) / daily : null;
      add(dos && dos > 60 ? "warn" : "info", "inventory", "You already hold " + fmtQty(pos.sellableMT) + " MT sellable " + prod.code + "; with this cargo " + fmtQty(pos.sellableMT + qty) + " MT" + (dos ? ", about " + Math.round(dos) + " days of sales at the last 90 days' pace." : "."), { dos });
    } else add(daily ? "ok" : "info", "inventory", daily ? "No " + prod.code + " in stock; you sell about " + fmtQty(daily * 30) + " MT a month." : "No " + prod.code + " in stock and no sales history for it.");
    const shortMT = pos ? pos.forwardSoldMT : 0; if (shortMT) add("ok", "inventory", fmtQty(shortMT) + " MT of unsourced " + prod.code + " sales can be covered by this cargo.");
    const bs = priceSeries(store, prod.id, d.port, "buy", 90); const ref = bs.length >= 2 ? bs : priceSeries(store, prod.id, null, "buy", 90);
    if (ref.length) { const mean = avg(ref.map((x) => x.price)), last = ref[ref.length - 1].price, dev = (price - mean) / mean; add(dev > 0.03 ? "warn" : "ok", "price", "Last bought " + prod.code + " at " + fmtMoney(last) + "; 90-day average " + fmtMoney(mean) + ". This is " + (dev >= 0 ? "+" : "") + fmtPct(dev) + ".", { mean, last, dev }); }
    const ss = priceSeries(store, prod.id, d.port, "sell", 60); const sref = ss.length >= 2 ? ss : priceSeries(store, prod.id, null, "sell", 60);
    if (sref.length) { const mean = avg(sref.map((x) => x.price)); const m = r2(mean - unit); add(m <= 0 ? "stop" : m < 8 ? "warn" : "ok", "margin", "At your recent selling average of " + fmtMoney(mean) + " this cargo makes " + fmtMoney(m) + "/MT after " + fmtMoney(unit) + " landed cost.", { m, mean, unit }); }
    if (sup) { const prof = counterpartyProfile(store, sup.id); if (prof.supplies.length) add("info", "supplier", prof.supplies.length + " prior cargo" + (prof.supplies.length > 1 ? "es" : "") + " from " + sup.short + ", " + fmtMoney(prof.apOpen) + " currently owed."); else add("info", "supplier", "First cargo from " + sup.short + "."); }
    const existingBill = d.existing ? store.bills.find((b) => b.cargoId === d.existing) : null;
    if (existingBill) { const open = docOpen(existingBill); if (open > 0.01) { const fc = cashForecast(store, ent.id); const dayRow = fc.days.find((x) => x.date === existingBill.due) || fc.days[existingBill.due < asOf ? 0 : fc.days.length - 1]; add(dayRow.balance < 0 ? "stop" : dayRow.balance < open ? "warn" : "ok", "cash", fmtMoney(open) + " still owed on " + existingBill.ref + ", due " + existingBill.due + ". Projected cash then " + fmtMoney(dayRow.balance) + ".", { due: existingBill.due }); } else add("ok", "cash", "Supplier bill paid in full."); }
    else {
      const terms = d.terms != null ? +d.terms : sup ? sup.terms : 30; const due = addDays(d.date || asOf, terms);
      const fc = cashForecast(store, ent.id); const dayRow = fc.days.find((x) => x.date === due) || fc.days[fc.days.length - 1];
      const after = r2(dayRow.balance - landed * (+d.fx || 1));
      add(after < 0 ? "stop" : after < landed * 0.5 ? "warn" : "ok", "cash", "Bill of " + fmtMoney(landed) + " due " + due + ". Projected " + ent.name + " cash that day " + fmtMoney(dayRow.balance) + ", " + fmtMoney(after) + " after paying it.", { after, due });
    }
    const allowance = d.allowancePct != null ? +d.allowancePct : store.settings.lossAllowanceDefaultPct;
    if (!d.existing) add("info", "inventory", "Loss allowance " + allowance + "% reserves " + fmtQty(qty * allowance / 100) + " MT; sellable " + fmtQty(qty * (1 - allowance / 100)) + " MT.");
    return finish(sig, { landed, unit: r2(unit) });
  }
  function finish(signals, data) {
    const w = { stop: 40, warn: 12, info: 0, ok: 0 }; const score = Math.max(0, 100 - sum(signals, (s) => w[s.level] || 0));
    const verdict = signals.some((s) => s.level === "stop") ? "Blocked as entered" : score >= 85 ? "Clear to execute" : score >= 65 ? "Execute with conditions" : "Review required";
    return { ok: true, signals, score, verdict, data };
  }
  function insights(store, entityId) {
    const out = []; const asOf = today(); const add = (level, area, text, link) => out.push({ level, area, text, link });
    const ents = store.entities.map((e) => e.id).filter((id) => entIn(id, entityId));
    for (const i of store.invoices.filter((i) => ents.includes(i.entityId) && docStatus(i) === "overdue")) { const cp = store.counterparties.find((c) => c.id === i.counterpartyId); add("warn", "credit", (cp || {}).short + " " + i.ref + " overdue " + daysBetween(i.due, asOf) + " days, " + fmtMoney(docOpen(i) * i.fx) + " open.", { view: "finance", id: i.id }); }
    for (const b of store.bills.filter((b) => ents.includes(b.entityId) && docOpen(b) > 0.01 && b.due <= addDays(asOf, 5))) { const cp = store.counterparties.find((c) => c.id === b.counterpartyId); add(b.due < asOf ? "warn" : "info", "cash", "Pay " + (cp || {}).short + " " + fmtMoney(docOpen(b) * b.fx) + " " + (b.due < asOf ? "overdue since " : "due ") + b.due + ".", { view: "finance", id: b.id }); }
    for (const cp of store.counterparties) {
      const p = counterpartyProfile(store, cp.id);
      if (p.utilization != null && p.utilization > 0.9) add("warn", "credit", cp.short + " at " + fmtPct(p.utilization) + " of credit line.", { view: "counterparties", id: cp.id });
      if (p.compliance.state === "stale" && (p.trades.length || p.supplies.length)) add("warn", "compliance", "Re-screen " + cp.short + " (" + p.compliance.age + " days).", { view: "compliance", id: cp.id });
      if (p.compliance.state === "unscreened" && (p.trades.length || p.supplies.length)) add("warn", "compliance", cp.short + " trades with you but was never screened.", { view: "compliance", id: cp.id });
      if (p.delivered.length >= 3 && p.daysSinceLast > 45) add("info", "customer", cp.short + " has gone quiet: " + p.daysSinceLast + " days since last trade (" + p.delivered.length + " deliveries before).", { view: "counterparties", id: cp.id });
      if (p.trend != null && p.trend < -0.4 && p.delivered.length >= 4) add("info", "customer", cp.short + " volume down " + fmtPct(-p.trend) + " vs prior quarter.", { view: "counterparties", id: cp.id });
    }
    for (const c of store.cargoes.filter((c) => ents.includes(c.entityId) && c.received)) { const st = cargoStatus(store, c); if (st.sellable > 0 && st.ageDays > 60) add("info", "inventory", c.ref + ": " + fmtQty(st.sellable) + " MT unsold after " + st.ageDays + " days.", { view: "book", id: c.id }); }
    for (const eid of ents) {
      const fc = cashForecast(store, eid); const e = store.entities.find((x) => x.id === eid);
      if (fc.low.balance < 0) add("warn", "cash", e.name + " projected cash " + fmtMoney(fc.low.balance) + " on " + fc.low.date + ".", { view: "finance" });
      for (const p of positions(store, eid)) { const prod = store.products.find((x) => x.id === p.productId) || {}; if (p.physicalMT > 3000 && p.hedgeRatio < 0.3) add("info", "hedge", e.name + " holds " + fmtQty(p.physicalMT) + " MT " + prod.code + " with " + fmtPct(p.hedgeRatio) + " hedged.", { view: "futures" }); if (p.forwardSoldMT > 0) add("info", "inventory", fmtQty(p.forwardSoldMT) + " MT " + prod.code + " sold forward without a cargo.", { view: "book" }); }
      for (const fa of store.futuresAccounts.filter((f) => f.entityId === eid)) { const v = futuresAccountView(store, fa.id); if (v.margin && v.marginUse > 0.8) add("warn", "futures", fa.label + " margin use " + fmtPct(v.marginUse) + "; excess " + fmtMoney(v.excess) + ".", { view: "futures" }); }
    }
    const rank = { warn: 0, info: 1, ok: 2 }; return out.sort((a, b) => rank[a.level] - rank[b.level]);
  }

  // ---------------------------------------------------------------- reports
  function report(store, opt) {
    const { type, entityId, from, to, counterpartyId, vesselId } = opt; const inRange = (d) => (!from || d >= from) && (!to || d <= to);
    const ent = (id) => (store.entities.find((e) => e.id === id) || {}).name || ""; const cpn = (id) => (store.counterparties.find((c) => c.id === id) || {}).name || ""; const pc = (id) => (store.products.find((p) => p.id === id) || {}).code || "";
    const period = (from || "start") + " to " + (to || today());
    if (type === "trades") {
      const rows = store.trades.filter((t) => (entIn(t.entityId, entityId)) && (!counterpartyId || t.customerId === counterpartyId) && (!vesselId || t.vesselId === vesselId) && inRange(t.date) && t.status !== "cancelled").map((t) => { const m = tradeMargin(store, t); const cg = [...new Set(productLines(t).map((l) => l.cargoId).filter(Boolean))].map((id) => (store.cargoes.find((x) => x.id === id) || {}).ref).join(", "); return [t.ref, t.date, ent(t.entityId), cpn(t.customerId), (store.vessels.find((v) => v.id === t.vesselId) || {}).name || "", productLines(t).map((l) => pc(l.productId)).join(", "), t.port, productMT(t), t.price, tradeValue(t), t.currency, cg, m.unitCost != null ? r2(m.unitCost) : "", m.perMT != null ? m.perMT : "", m.total != null ? m.total : "", t.status]; });
      return { title: "Trades " + period, columns: ["Ref", "Date", "Entity", "Customer", "Vessel", "Products", "Port", "MT", "Price", "Value", "Ccy", "Cargoes", "Cost/MT", "Margin/MT", "Margin", "Status"], rows, totals: { MT: r2(sum(rows, (r) => r[7])), Value: r2(sum(rows, (r) => r[9])), Margin: r2(sum(rows, (r) => +r[14] || 0)) } };
    }
    if (type === "sales") {
      const rows = salesReport(store, opt).map((r) => [r.name, r.trades, r.delivered, r.mt, r.revenue, r.cogs, r.other, r.margin, r.marginMT, Math.round(r.marginPct * 1000) / 10 + "%", r.customers]);
      return { title: "Sales people " + period, columns: ["Sales person", "Trades", "Delivered", "MT", "Revenue", "Cost of goods", "Other costs", "Net margin", "Margin/MT", "Margin %", "Customers"], rows, totals: { Revenue: r2(sum(rows, (r) => r[4])), "Net margin": r2(sum(rows, (r) => r[7])), MT: r2(sum(rows, (r) => r[3])) } };
    }
    if (type === "tradelines") {
      const rows = []; for (const t of store.trades.filter((t) => (entIn(t.entityId, entityId)) && (!counterpartyId || t.customerId === counterpartyId) && (!vesselId || t.vesselId === vesselId) && inRange(t.date) && t.status !== "cancelled")) for (const l of t.lines || []) { const c = store.cargoes.find((x) => x.id === l.cargoId); const cost = l.kind === "product" ? (c ? r2(lineQty(l) * cargoUnitCost(c)) : "") : r2(+l.cost || 0); rows.push([t.ref, t.date, ent(t.entityId), cpn(t.customerId), l.kind, l.kind === "product" ? pc(l.productId) : l.description, lineQty(l), l.unit, l.price, lineNet(l), t.currency, c ? c.ref : "", cost, cost !== "" ? r2(lineNet(l) - cost) : "", t.status]); }
      return { title: "Trade lines " + period, columns: ["Trade", "Date", "Entity", "Customer", "Kind", "Item", "Qty", "Unit", "Price", "Net", "Ccy", "Cargo", "Cost", "Margin", "Status"], rows, totals: { Net: r2(sum(rows, (r) => r[9])), Margin: r2(sum(rows, (r) => +r[13] || 0)) } };
    }
    if (type === "cargoes") {
      const rows = store.cargoes.filter((c) => (entIn(c.entityId, entityId)) && (!counterpartyId || c.supplierId === counterpartyId) && inRange(c.date)).map((c) => { const st = cargoStatus(store, c); return [c.ref, c.date, ent(c.entityId), cpn(c.supplierId), pc(c.productId), c.port, c.qty, c.price, st.landed, st.unitCost, st.allocated, st.lost, st.physical, st.sellable, c.received ? "received" : "contracted"]; });
      return { title: "Cargoes " + period, columns: ["Ref", "Date", "Entity", "Supplier", "Product", "Port", "MT", "Price", "Landed cost", "Cost/MT", "Allocated", "Lost", "Physical left", "Sellable left", "Status"], rows, totals: { MT: r2(sum(rows, (r) => r[6])), "Landed cost": r2(sum(rows, (r) => r[8])), "Sellable left": r2(sum(rows, (r) => r[13])) } };
    }
    if (type === "invoices" || type === "bills") {
      const docs = (type === "invoices" ? store.invoices : store.bills).filter((x) => (entIn(x.entityId, entityId)) && (!counterpartyId || x.counterpartyId === counterpartyId) && inRange(x.date));
      const rows = docs.map((x) => [x.ref, x.date, x.due, ent(x.entityId), cpn(x.counterpartyId), x.currency, x.amount, x.paid, docOpen(x), docStatus(x), docStatus(x) === "overdue" ? daysBetween(x.due, today()) : ""]);
      return { title: (type === "invoices" ? "Customer invoices " : "Vendor bills ") + period, columns: ["Ref", "Date", "Due", "Entity", "Counterparty", "Ccy", "Amount", "Paid", "Open", "Status", "Days overdue"], rows, totals: { Amount: r2(sum(rows, (r) => r[6])), Open: r2(sum(rows, (r) => r[8])) } };
    }
    if (type === "ledger") {
      const rows = []; for (const j of store.ledger.filter((j) => (entIn(j.entityId, entityId)) && inRange(j.date)).sort((a, b) => (a.date < b.date ? -1 : 1))) for (const l of j.lines) rows.push([j.date, ent(j.entityId), j.memo, l.account, subName(store, l), l.debit || "", l.credit || "", l.currency || "", l.amount != null ? l.amount : ""]);
      return { title: "General ledger " + period, columns: ["Date", "Entity", "Memo", "Account", "Detail", "Debit", "Credit", "Ccy", "Amount (ccy)"], rows, totals: { Debit: r2(sum(rows, (r) => +r[5] || 0)), Credit: r2(sum(rows, (r) => +r[6] || 0)) } };
    }
    if (type === "pnl" || type === "balance") {
      const ents = store.entities.filter((e) => entIn(e.id, entityId));
      const cust = customAccounts(store); const plCust = cust.filter((a) => a.kind === "income" || a.kind === "expense"), bsCust = cust.filter((a) => ["asset", "liability", "equity"].includes(a.kind));
      const rows = ents.map((e) => { const s = entityStatements(store, e.id, type === "pnl" ? (from || (s0 => s0 ? addDays(s0, 1) : null)(lastClose(store, e.id))) : null, to); return type === "pnl" ? [e.name, e.currency, s.revenue, s.cogs, s.gross, s.loss, s.fees, s.expenses, s.otherIncome, s.fx, s.futPnl, ...plCust.map((a) => (a.kind === "expense" ? -1 : 1) * (s["c_" + a.code] || 0)), s.net] : [e.name, e.currency, s.cash, s.futures, s.inventory, s.ar, s.vatIn, ...bsCust.filter((a) => a.kind === "asset").map((a) => s["c_" + a.code] || 0), s.assets, s.ap, s.vatOut, ...bsCust.filter((a) => a.kind === "liability").map((a) => s["c_" + a.code] || 0), s.capital, s.priorRetained, s.retained, ...bsCust.filter((a) => a.kind === "equity").map((a) => s["c_" + a.code] || 0), s.equity]; });
      const netIdx = 11 + plCust.length; const assetsIdx = 7 + bsCust.filter((a) => a.kind === "asset").length; const eqIdx = 13 + bsCust.length;
      return type === "pnl" ? { title: "Profit and loss " + period, columns: ["Entity", "Ccy", "Revenue", "Cost of goods", "Gross margin", "Inventory loss", "Trade costs", "Expenses", "Other income", "FX result", "Futures P&L", ...plCust.map((a) => a.name), "Net result"], rows, totals: { Revenue: r2(sum(rows, (r) => r[2])), "Net result": r2(sum(rows, (r) => r[netIdx])) } }
        : { title: "Balance sheet as of " + (to || today()), columns: ["Entity", "Ccy", "Cash", "Futures cash", "Inventory", "Receivables", "VAT receivable", ...bsCust.filter((a) => a.kind === "asset").map((a) => a.name), "Total assets", "Payables", "VAT payable", ...bsCust.filter((a) => a.kind === "liability").map((a) => a.name), "Capital", "Retained earnings", "Result for period", ...bsCust.filter((a) => a.kind === "equity").map((a) => a.name), "Equity"], rows, totals: { "Total assets": r2(sum(rows, (r) => r[assetsIdx])), Equity: r2(sum(rows, (r) => r[eqIdx])) } };
    }
    if (type === "futures") {
      const rows = store.futuresTrades.filter((f) => (entIn(f.entityId, entityId)) && inRange(f.openDate)).map((f) => { const k = store.contracts.find((x) => x.id === f.contractId); const px = f.exit != null ? f.exit : k.lastMark; return [f.ref, f.openDate, ent(f.entityId), (store.futuresAccounts.find((a) => a.id === f.accountId) || {}).label, k.code, f.side, f.lots, f.entry, f.exit != null ? f.exit : "", px != null ? futPnl(k, f, px) : "", r2(f.fees + (f.closeFees || 0)), f.exit != null ? "closed " + f.closeDate : "open"]; });
      return { title: "Futures " + period, columns: ["Ref", "Opened", "Entity", "Account", "Contract", "Side", "Lots", "Entry", "Exit", "P&L", "Fees", "Status"], rows, totals: { "P&L": r2(sum(rows, (r) => +r[9] || 0)), Fees: r2(sum(rows, (r) => r[10])) } };
    }
    if (type === "customers") {
      const rows = store.counterparties.filter((c) => !counterpartyId || c.id === counterpartyId).map((c) => { const p = counterpartyProfile(store, c.id); return [c.name, c.country, c.role, p.compliance.state, c.creditLimit, p.exposure, p.utilization != null ? r2(p.utilization * 100) : "", p.volume, p.revenue, p.totalMargin, p.avgMarginMT != null ? p.avgMarginMT : "", p.avgDaysToPay != null ? p.avgDaysToPay : "", p.overdue.length, p.vessels.length, p.last ? p.last.date : ""]; });
      return { title: "Counterparties", columns: ["Name", "Country", "Role", "Screening", "Credit limit", "Exposure", "Use %", "Volume MT", "Revenue", "Margin", "Margin/MT", "Days to pay", "Overdue", "Vessels", "Last trade"], rows, totals: { Exposure: r2(sum(rows, (r) => r[5])), Revenue: r2(sum(rows, (r) => r[8])), Margin: r2(sum(rows, (r) => r[9])) } };
    }
    if (type === "positions") {
      const rows = []; for (const e of entityId ? store.entities.filter((x) => x.id === entityId) : store.entities) for (const p of positions(store, e.id)) rows.push([e.name, pc(p.productId), p.cargoes, p.physicalMT, p.sellableMT, p.value, p.forwardSoldMT, p.hedgeMT, p.netMT, r2(p.hedgeRatio * 100)]);
      return { title: "Positions as of " + today(), columns: ["Entity", "Product", "Cargoes", "Physical MT", "Sellable MT", "Book value", "Forward sold MT", "Futures MT", "Net MT", "Hedged %"], rows, totals: { "Physical MT": r2(sum(rows, (r) => r[3])), "Net MT": r2(sum(rows, (r) => r[8])) } };
    }
    if (type === "statement") {
      if (!counterpartyId) throw new Error("Statement of account needs a counterparty");
      const soa = statementOfAccount(store, counterpartyId, entityId || null, from || null, to || null);
      const rows = [...(soa.opening ? [[from || "", "", "Opening balance", "", "", "", "", soa.opening]] : []), ...soa.rows.map((r) => [r.date, r.ref, r.type, r.detail, r.due, r.debit || "", r.credit || "", r.balance])];
      const vs = (soa.cp.vesselIds || []).map((id) => (store.vessels.find((v) => v.id === id) || {}).name).filter(Boolean).join(", ");
      return { title: "Statement of account · " + soa.cp.name + (vs ? " · vessels: " + vs : "") + " · " + period, columns: ["Date", "Ref", "Type", "Detail", "Due", "Debit", "Credit", "Balance"], rows, totals: { Debit: r2(sum(soa.rows, (r) => r.debit)), Credit: r2(sum(soa.rows, (r) => r.credit)), "Closing balance": soa.closing, "Overdue": r2(sum(soa.overdue, (o) => o.open)) } };
    }
    if (type === "trial") {
      const ents = store.entities.filter((e) => entIn(e.id, entityId)); const rows = [];
      for (const e of ents) { const acc = {}; for (const j of store.ledger.filter((j) => j.entityId === e.id && (!to || j.date <= to))) for (const l of j.lines) { const k = l.account + (l.sub ? " · " + subName(store, l) : ""); acc[k] = acc[k] || { dr: 0, cr: 0 }; acc[k].dr += l.debit; acc[k].cr += l.credit; } for (const [k, v] of Object.entries(acc).sort()) { const bal = r2(v.dr - v.cr); rows.push([e.name, k.split(" · ")[0], k.split(" · ")[1] || "", r2(v.dr), r2(v.cr), bal > 0 ? bal : "", bal < 0 ? -bal : ""]); } }
      return { title: "Trial balance as of " + (to || today()), columns: ["Entity", "Account", "Detail", "Debits", "Credits", "Balance Dr", "Balance Cr"], rows, totals: { Debits: r2(sum(rows, (r) => r[3])), Credits: r2(sum(rows, (r) => r[4])), "Balance Dr": r2(sum(rows, (r) => +r[5] || 0)), "Balance Cr": r2(sum(rows, (r) => +r[6] || 0)) } };
    }
    if (type === "vatsummary") {
      const ents = store.entities.filter((e) => entIn(e.id, entityId)); const rows = [];
      for (const e of ents) {
        const inv = store.invoices.filter((x) => x.entityId === e.id && inRange(x.date)); const cns = store.documents.filter((x) => x.type === "creditnote" && x.entityId === e.id && inRange(x.date)); const bills = store.bills.filter((x) => x.entityId === e.id && !x.pending && inRange(x.date)); const btx = store.bankTx.filter((x) => x.entityId === e.id && inRange(x.date) && x.vatRate);
        const kind = (x) => (x.vatKind === "standard" && x.vatRate ? "standard" : x.vatKind === "standard" ? "standard0" : x.vatKind || "standard");
        const S1 = (k) => r2(sum(inv.filter((x) => kind(x) === k), (x) => x.net * x.fx) - sum(cns.filter((x) => (x.vatRate ? "standard" : "standard0") === k), (x) => x.net * x.fx));
        const outVat = r2(sum(inv, (x) => x.vat * x.fx) - sum(cns, (x) => x.vat * x.fx) + sum(btx.filter((x) => x.kind === "in"), (x) => x.vat));
        const P1 = (k) => r2(sum(bills.filter((x) => kind(x) === k), (x) => x.net * x.fx));
        const inVat = r2(sum(bills, (x) => x.vat * x.fx) + sum(btx.filter((x) => x.kind === "out"), (x) => x.vat));
        const expNet = r2(sum(btx.filter((x) => x.kind === "out"), (x) => x.net));
        rows.push([e.name, "Sales: standard-rated supplies", S1("standard"), outVat - r2(sum(btx.filter((x) => x.kind === "in"), (x) => x.vat))], [e.name, "Sales: zero-rated supplies", S1("zero"), 0], [e.name, "Sales: exempt supplies", S1("exempt"), 0], [e.name, "Sales: out of scope", S1("out"), 0], [e.name, "Other income with VAT", r2(sum(btx.filter((x) => x.kind === "in"), (x) => x.net)), r2(sum(btx.filter((x) => x.kind === "in"), (x) => x.vat))], [e.name, "Total output VAT", "", outVat], [e.name, "Purchases: standard-rated (cargo)", P1("standard"), r2(sum(bills, (x) => x.vat * x.fx))], [e.name, "Purchases: zero-rated / exempt / out of scope", r2(P1("zero") + P1("exempt") + P1("out") + P1("standard0")), 0], [e.name, "Expenses with VAT", expNet, r2(sum(btx.filter((x) => x.kind === "out"), (x) => x.vat))], [e.name, "Total input VAT (recoverable)", "", inVat], [e.name, "Net VAT payable (+) / refundable (−)", "", r2(outVat - inVat)]);
      }
      return { title: "VAT return summary " + period, columns: ["Entity", "Line", "Net amount", "VAT"], rows, totals: {} };
    }
    if (type === "vat") {
      const rows = [];
      for (const i of store.invoices.filter((x) => (entIn(x.entityId, entityId)) && inRange(x.date))) rows.push([i.date, ent(i.entityId), "Sale", i.ref, cpn(i.counterpartyId), (store.counterparties.find((c) => c.id === i.counterpartyId) || {}).trn || "", i.currency, vatLabel(i.vatRate, i.vatKind), i.net, i.vat, i.amount, r2(i.vat * i.fx)]);
      for (const cn of store.documents.filter((x) => x.type === "creditnote" && (entIn(x.entityId, entityId)) && inRange(x.date))) rows.push([cn.date, ent(cn.entityId), "Credit note", cn.ref, cpn(cn.counterpartyId), (store.counterparties.find((c) => c.id === cn.counterpartyId) || {}).trn || "", cn.currency, vatLabel(cn.vatRate, "standard"), -cn.net, -cn.vat, -cn.amount, -r2(cn.vat * cn.fx)]);
      for (const b of store.bills.filter((x) => (entIn(x.entityId, entityId)) && inRange(x.date))) rows.push([b.date, ent(b.entityId), "Purchase", b.ref, cpn(b.counterpartyId), (store.counterparties.find((c) => c.id === b.counterpartyId) || {}).trn || "", b.currency, vatLabel(b.vatRate, b.vatKind), b.net, b.vat, b.amount, -r2(b.vat * b.fx)]);
      for (const x of store.bankTx.filter((x) => (entIn(x.entityId, entityId)) && inRange(x.date) && x.vat)) rows.push([x.date, ent(x.entityId), x.kind === "in" ? "Other income" : "Expense: " + x.category, x.reference || "", cpn(x.counterpartyId), "", x.currency, x.vatRate + "%", x.net, x.vat, x.amount, (x.kind === "in" ? 1 : -1) * x.vat]);
      rows.sort((a, b) => (a[0] < b[0] ? -1 : 1));
      return { title: "VAT return detail " + period, columns: ["Date", "Entity", "Type", "Ref", "Counterparty", "TRN", "Ccy", "VAT", "Net", "VAT amount", "Gross", "Net VAT (base, + payable)"], rows, totals: { "Net VAT (base, + payable)": r2(sum(rows, (r) => r[11])) } };
    }
    if (type === "banktx") {
      const rows = store.bankTx.filter((x) => (entIn(x.entityId, entityId)) && (!counterpartyId || x.counterpartyId === counterpartyId) && inRange(x.date)).map((x) => [x.date, ent(x.entityId), (store.banks.find((b) => b.id === x.bankId) || {}).label, x.kind, x.category, x.payee || cpn(x.counterpartyId), x.memo, x.reference, x.currency, x.net, x.vatRate + "%", x.vat, x.amount]);
      return { title: "Bank transactions " + period, columns: ["Date", "Entity", "Account", "In/out", "Category", "Payee / payer", "Memo", "Reference", "Ccy", "Net", "VAT", "VAT amount", "Gross"], rows, totals: { Gross: r2(sum(rows, (r) => r[12])) } };
    }
    if (type === "creditnotes") {
      const rows = store.documents.filter((x) => x.type === "creditnote" && (entIn(x.entityId, entityId)) && (!counterpartyId || x.counterpartyId === counterpartyId) && inRange(x.date)).map((x) => [x.ref, x.date, ent(x.entityId), cpn(x.counterpartyId), (store.invoices.find((i) => i.id === x.invoiceId) || {}).ref, x.currency, x.net, x.vat, x.amount, x.reason]);
      return { title: "Credit notes " + period, columns: ["Ref", "Date", "Entity", "Customer", "Invoice", "Ccy", "Net", "VAT", "Gross", "Reason"], rows, totals: { Gross: r2(sum(rows, (r) => r[8])) } };
    }
    if (type === "currency") {
      const items = [];
      const cp = (id) => cpn(id);
      for (const i of store.invoices.filter((x) => (entIn(x.entityId, entityId)) && (!counterpartyId || x.counterpartyId === counterpartyId) && inRange(x.date))) items.push({ date: i.date, type: "Sales invoice", ref: i.ref, cp: cp(i.counterpartyId), ent: ent(i.entityId), ccy: i.currency, amount: i.amount, base: r2(i.amount * i.fx), sign: 1 });
      for (const cn of store.documents.filter((x) => x.type === "creditnote" && (entIn(x.entityId, entityId)) && (!counterpartyId || x.counterpartyId === counterpartyId) && inRange(x.date))) items.push({ date: cn.date, type: "Credit note", ref: cn.ref, cp: cp(cn.counterpartyId), ent: ent(cn.entityId), ccy: cn.currency, amount: -cn.amount, base: -r2(cn.amount * cn.fx), sign: 1 });
      for (const b of store.bills.filter((x) => (entIn(x.entityId, entityId)) && (!counterpartyId || x.counterpartyId === counterpartyId) && inRange(x.date))) items.push({ date: b.date, type: "Purchase bill", ref: b.ref, cp: cp(b.counterpartyId), ent: ent(b.entityId), ccy: b.currency, amount: -b.amount, base: -r2(b.amount * b.fx), sign: -1 });
      for (const p of store.payments.filter((x) => !x.reversed && (entIn(x.entityId, entityId)) && (!counterpartyId || x.counterpartyId === counterpartyId) && inRange(x.date))) { const bk = store.banks.find((b) => b.id === p.bankId) || {}; items.push({ date: p.date, type: p.kind === "in" ? "Receipt" : "Payment", ref: (p.kind === "in" ? store.invoices.find((i) => i.id === p.invoiceId) : store.bills.find((b) => b.id === p.billId)) ? (p.kind === "in" ? store.invoices.find((i) => i.id === p.invoiceId).ref : store.bills.find((b) => b.id === p.billId).ref) : "", cp: cp(p.counterpartyId), ent: ent(p.entityId), ccy: p.bankCurrency || p.currency, amount: (p.kind === "in" ? 1 : -1) * (p.bankAmount || p.amount), base: (p.kind === "in" ? 1 : -1) * r2((p.bankAmount || p.amount) * (bk.fx || 1)), sign: 0 }); }
      for (const x of store.bankTx.filter((x) => (entIn(x.entityId, entityId)) && (!counterpartyId || x.counterpartyId === counterpartyId) && inRange(x.date))) { const bk = store.banks.find((b) => b.id === x.bankId) || {}; items.push({ date: x.date, type: x.kind === "in" ? "Other income: " + x.category : "Expense: " + x.category, ref: x.reference || "", cp: cp(x.counterpartyId), ent: ent(x.entityId), ccy: x.currency, amount: (x.kind === "in" ? 1 : -1) * x.amount, base: (x.kind === "in" ? 1 : -1) * r2(x.amount * (bk.fx || 1)), sign: 0 }); }
      items.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
      const ccys = [...new Set(items.map((x) => x.ccy))].sort((a, b) => (a === "USD" ? -1 : b === "USD" ? 1 : a.localeCompare(b)));
      const baseCcy = entityId ? (store.entities.find((e) => e.id === entityId) || {}).currency || "base" : "entity currency";
      const rows = items.map((x) => [x.date, x.type, x.ref, x.ent, x.cp, x.ccy, ...ccys.map((c) => (x.ccy === c ? x.amount : "")), x.base]);
      const totals = {};
      for (const c of ccys) { const of = (f) => items.filter((x) => x.ccy === c && f(x)); const sales = r2(sum(of((x) => x.sign === 1), (x) => x.amount)), purch = r2(-sum(of((x) => x.sign === -1), (x) => x.amount)); totals["Sales " + c] = sales; totals["Purchases " + c] = purch; totals["Net trading " + c] = r2(sales - purch); totals["Received " + c] = r2(sum(of((x) => x.type === "Receipt"), (x) => x.amount)); totals["Paid " + c] = r2(-sum(of((x) => x.type === "Payment"), (x) => x.amount)); totals["Expenses " + c] = r2(-sum(of((x) => x.type.startsWith("Expense")), (x) => x.amount)); }
      totals["Net trading in " + baseCcy] = r2(sum(items.filter((x) => x.sign !== 0), (x) => x.base));
      return { title: "Currency combined (" + ccys.join("/") + ") " + period, columns: ["Date", "Type", "Ref", "Entity", "Counterparty", "Ccy", ...ccys, "In " + baseCcy], rows, totals };
    }
    if (type === "compliance") {
      const rows = store.screenings.filter((s) => inRange(s.date)).map((s) => [s.date, s.type, s.type === "vessel" ? (store.vessels.find((v) => v.id === s.subjectId) || {}).name : cpn(s.subjectId), s.result, s.method, s.by, s.hits.map((h) => h.rule + ": " + h.item.name).join("; "), s.notes]);
      return { title: "Screening log " + period, columns: ["Date", "Type", "Subject", "Result", "Method", "By", "Hits", "Notes"], rows, totals: {} };
    }
    throw new Error("Unknown report " + type);
  }
  function statementOfAccount(store, cpId, entityId, from, to) {
    const cp = store.counterparties.find((c) => c.id === cpId); to = to || today();
    const items = [];
    for (const i of store.invoices.filter((i) => i.counterpartyId === cpId && (entIn(i.entityId, entityId)))) items.push({ date: i.date, ref: i.ref, type: "Invoice", detail: (store.trades.find((t) => t.id === i.tradeId) || {}).ref || "", due: i.due, debit: i.amount, credit: 0, currency: i.currency });
    for (const cn of store.documents.filter((x) => x.type === "creditnote" && x.counterpartyId === cpId && (entIn(x.entityId, entityId)))) items.push({ date: cn.date, ref: cn.ref, type: "Credit note", detail: (store.invoices.find((i) => i.id === cn.invoiceId) || {}).ref || "", due: "", debit: 0, credit: cn.amount, currency: cn.currency });
    for (const p of store.payments.filter((p) => !p.reversed && p.kind === "in" && p.counterpartyId === cpId && (entIn(p.entityId, entityId)))) items.push({ date: p.date, ref: (store.invoices.find((i) => i.id === p.invoiceId) || {}).ref || "", type: "Receipt", detail: (store.banks.find((b) => b.id === p.bankId) || {}).label || "", due: "", debit: 0, credit: p.amount, currency: p.currency });
    items.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    let bal = 0; const opening = r2(sum(items.filter((x) => from && x.date < from), (x) => x.debit - x.credit)); bal = opening;
    const rows = items.filter((x) => (!from || x.date >= from) && x.date <= to).map((x) => { bal = r2(bal + x.debit - x.credit); return { ...x, balance: bal }; });
    const overdue = store.invoices.filter((i) => i.counterpartyId === cpId && (entIn(i.entityId, entityId)) && docStatus(i) === "overdue").map((i) => ({ ref: i.ref, due: i.due, open: docOpen(i), days: daysBetween(i.due, to) }));
    return { cp, from, to, opening, rows, closing: bal, overdue };
  }
  function subName(store, l) {
    if (!l.sub) return "";
    const b = store.banks.find((x) => x.id === l.sub); if (b) return b.label;
    const f = store.futuresAccounts.find((x) => x.id === l.sub); if (f) return f.label;
    const c = store.counterparties.find((x) => x.id === l.sub); if (c) return c.name;
    const g = store.cargoes.find((x) => x.id === l.sub); if (g) return g.ref;
    const p = store.products.find((x) => x.id === l.sub); if (p) return p.code;
    const k = store.contracts.find((x) => x.id === l.sub); if (k) return k.code;
    const t = store.trades.find((x) => x.id === l.sub); if (t) return t.ref;
    return l.sub;
  }
  function toCSV(rep) { const esc = (v) => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }; return [rep.columns.map(esc).join(","), ...rep.rows.map((r) => r.map(esc).join(","))].join("\n"); }

  // ---------------------------------------------------------------- management report
  function management(store, opt) {
    const { entityId, from, to } = opt || {}; const asOf = to || today(); const ents = store.entities.filter((e) => entIn(e.id, entityId)); const ids = ents.map((e) => e.id);
    const gfx = (eid) => groupRate(store, eid, entityId); const ccy = (typeof entityId === "string" && entityId) || new Set(ents.map((e) => e.currency)).size === 1 ? (ents[0] || {}).currency : store.meta.reportingCurrency;
    const per = ents.map((e) => ({ e, s: entityStatements(store, e.id, from || (lastClose(store, e.id) ? addDays(lastClose(store, e.id), 1) : null), asOf) }));
    const T = (k) => r2(sum(per, (x) => x.s[k] * gfx(x.e.id)));
    const trades = store.trades.filter((t) => ids.includes(t.entityId) && t.status === "delivered" && (!from || (t.deliveredDate || t.deliveryDate) >= from) && (t.deliveredDate || t.deliveryDate) <= asOf);
    const mt = r2(sum(trades, productMT)); const margin = r2(sum(trades, (t) => (tradeMargin(store, t).total || 0) * t.fx * gfx(t.entityId))); const revenue = r2(sum(trades, (t) => tradeValue(t) * t.fx * gfx(t.entityId)));
    const byCust = {}, byProd = {}, byPort = {};
    for (const t of trades) { const m = (tradeMargin(store, t).total || 0) * t.fx * gfx(t.entityId); const q = productMT(t); byCust[t.customerId] = byCust[t.customerId] || { mt: 0, revenue: 0, margin: 0, n: 0 }; byCust[t.customerId].mt += q; byCust[t.customerId].revenue += tradeValue(t) * t.fx * gfx(t.entityId); byCust[t.customerId].margin += m; byCust[t.customerId].n++; byPort[t.port] = byPort[t.port] || { mt: 0, margin: 0, n: 0 }; byPort[t.port].mt += q; byPort[t.port].margin += m; byPort[t.port].n++; for (const l of productLines(t)) { const c = store.cargoes.find((x) => x.id === l.cargoId); const lm = (lineNet(l) - (c ? lineQty(l) * cargoUnitCost(c) : 0)) * t.fx * gfx(t.entityId); byProd[l.productId] = byProd[l.productId] || { mt: 0, revenue: 0, margin: 0 }; byProd[l.productId].mt += lineQty(l); byProd[l.productId].revenue += lineNet(l) * t.fx * gfx(t.entityId); byProd[l.productId].margin += lm; } }
    const inv = store.invoices.filter((i) => ids.includes(i.entityId) && docOpen(i) > 0.01); const ageing = { current: 0, d1_30: 0, d31_60: 0, d61: 0 }; for (const i of inv) { const late = daysBetween(i.due, asOf); const v = docOpen(i) * i.fx * gfx(i.entityId); if (late <= 0) ageing.current += v; else if (late <= 30) ageing.d1_30 += v; else if (late <= 60) ageing.d31_60 += v; else ageing.d61 += v; }
    const bills = store.bills.filter((b) => ids.includes(b.entityId) && !b.pending && docOpen(b) > 0.01); const apOverdue = r2(sum(bills.filter((b) => b.due < asOf), (b) => docOpen(b) * b.fx * gfx(b.entityId)));
    const pos = ents.flatMap((e) => positions(store, e.id).map((p) => ({ ...p, entityId: e.id })));
    const fc = cashForecast(store, entityId || null); const expenses = {}; for (const x of per) for (const [k, v] of Object.entries(x.s.expenseByCat)) expenses[k] = r2((expenses[k] || 0) + v * gfx(x.e.id));
    const fut = store.futuresAccounts.filter((f) => ids.includes(f.entityId)).map((f) => futuresAccountView(store, f.id));
    const cps = store.counterparties; const overLimit = cps.map((c) => counterpartyProfile(store, c.id)).filter((p) => p.utilization != null && p.utilization > 1);
    return { ccy, from: from || "start of period", to: asOf, entities: per, totals: { revenue: T("revenue"), cogs: T("cogs"), gross: T("gross"), loss: T("loss"), fees: T("fees"), expenses: T("expenses"), otherIncome: T("otherIncome"), fx: T("fx"), futPnl: T("futPnl"), net: T("net"), cash: T("cash"), futures: T("futures"), inventory: T("inventory"), ar: T("ar"), ap: T("ap"), vatNet: T("vatNet"), assets: T("assets"), liabilities: T("liabilities"), equity: T("equity"), capital: T("capital"), priorRetained: T("priorRetained") },
      trading: { deliveries: trades.length, mt, revenue, margin, marginMT: mt ? r2(margin / mt) : 0, marginPct: revenue ? margin / revenue : 0, customers: new Set(trades.map((t) => t.customerId)).size },
      byCust: Object.entries(byCust).map(([id, v]) => ({ id, name: (cps.find((c) => c.id === id) || {}).name, ...v })).sort((a, b) => b.margin - a.margin), byProd: Object.entries(byProd).map(([id, v]) => ({ id, code: (store.products.find((p) => p.id === id) || {}).code, ...v })).sort((a, b) => b.margin - a.margin), byPort: Object.entries(byPort).map(([port, v]) => ({ port, ...v })).sort((a, b) => b.mt - a.mt),
      ageing, arOpen: r2(sum(inv, (i) => docOpen(i) * i.fx * gfx(i.entityId))), overdueCount: inv.filter((i) => i.due < asOf).length, apOpen: r2(sum(bills, (b) => docOpen(b) * b.fx * gfx(b.entityId))), apOverdue, positions: pos, cashLow: fc.low, cashStart: fc.start, expenses, futures: { unrealized: r2(sum(fut, (f) => f.unrealized)), realized: r2(sum(fut, (f) => f.realized)), margin: r2(sum(fut, (f) => f.margin)), equity: r2(sum(fut, (f) => f.equity)) }, overLimit: overLimit.map((p) => ({ name: p.cp.name, exposure: p.exposure, limit: p.creditLimit })), closings: store.closings.filter((c) => ids.includes(c.entityId)) };
  }

  // ---------------------------------------------------------------- cash timeline: history from the ledger, future from open documents
  function cashTimeline(store, entityId, from, to) {
    const ents = store.entities.map((e) => e.id).filter((id) => entIn(id, entityId)); const gfx = (eid) => groupRate(store, eid, entityId);
    const t0 = today(); const days = []; for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);
    // history: cash account movements per day
    const mv = {}; let opening = 0;
    for (const j of store.ledger) { if (!ents.includes(j.entityId)) continue; for (const l of j.lines) { if (l.account !== "cash") continue; const v = (l.debit - l.credit) * gfx(j.entityId); if (j.date < from) opening += v; else if (j.date <= to) mv[j.date] = (mv[j.date] || 0) + v; } }
    const ins = store.invoices.filter((i) => ents.includes(i.entityId) && docOpen(i) > 0.01), outs = store.bills.filter((b) => ents.includes(b.entityId) && (b.pending || docOpen(b) > 0.01));
    let bal = opening; const out = [];
    for (const d of days) { let inn = 0, o = 0; if (d <= t0) { bal += mv[d] || 0; } else { inn = sum(ins.filter((i) => i.due === d || (d === addDays(t0, 1) && i.due <= t0)), (i) => docOpen(i) * i.fx * gfx(i.entityId)); o = sum(outs.filter((b) => b.due === d || (d === addDays(t0, 1) && b.due <= t0)), (b) => (b.pending ? b.amount : docOpen(b)) * b.fx * gfx(b.entityId)); bal += inn - o; } out.push({ date: d, balance: r2(bal), inn: r2(inn), out: r2(o), actual: d <= t0 }); }
    const low = out.reduce((a, b) => (b.balance < a.balance ? b : a), out[0] || { balance: 0, date: t0 });
    return { days: out, opening: r2(opening), low, todayIndex: Math.max(0, Math.min(out.length - 1, out.findIndex((x) => x.date === t0))) };
  }
  // ---------------------------------------------------------------- ledger workbench: accounts, lines, expenses, reversals, edits
  function customAccounts(store) { return (store.settings && store.settings.accounts) || []; }
  function addAccount(store, d) { const code = String(d.code || "").trim().toLowerCase().replace(/[^a-z0-9_]/g, "_"); if (!code) throw new Error("Code required"); if (ACCOUNT_META[code] || customAccounts(store).some((a) => a.code === code)) throw new Error("An account with that code exists"); if (!["asset", "liability", "equity", "income", "expense"].includes(d.kind)) throw new Error("Kind must be asset, liability, equity, income or expense"); store.settings.accounts = customAccounts(store).concat([{ code, name: d.name || code, kind: d.kind }]); return code; }
  function accountMeta(store, code) { return ACCOUNT_META[code] || (() => { const c = customAccounts(store).find((a) => a.code === code); return c ? [c.name, c.kind] : [code, "other"]; })(); }
  const ACCOUNT_META = { cash: ["Cash and bank", "asset"], futures: ["Futures margin accounts", "asset"], inventory: ["Inventory", "asset"], ar: ["Trade receivables", "asset"], vat_input: ["VAT receivable (input VAT)", "asset"], ap: ["Trade payables", "liability"], owners_due: ["Due to owners", "liability"], vat_output: ["VAT payable (output VAT)", "liability"], capital: ["Capital", "equity"], retained_earnings: ["Retained earnings", "equity"], revenue: ["Revenue", "income"], other_income: ["Other income", "income"], futures_pnl: ["Futures result", "income"], fx_diff: ["FX result", "income"], cogs: ["Cost of goods sold", "expense"], inventory_loss: ["Inventory losses", "expense"], fees: ["Trade-related costs", "expense"], expense: ["Operating expenses", "expense"] };
  function accountsOverview(store, opt) {
    const { entityId, from, to, gfx } = opt || {}; const out = {}; const k = (eid) => (gfx ? gfx(eid) : 1);
    for (const j of store.ledger) { if (!entIn(j.entityId, entityId)) continue; if (to && j.date > to) continue; const inP = !from || j.date >= from; const f = k(j.entityId); for (const l of j.lines) { const a = (out[l.account] = out[l.account] || { account: l.account, name: accountMeta(store, l.account)[0], kind: accountMeta(store, l.account)[1], opening: 0, debits: 0, credits: 0, closing: 0, lines: 0 }); const v = (l.debit - l.credit) * f; if (inP) { a.debits += l.debit * f; a.credits += l.credit * f; a.lines++; } else a.opening += v; a.closing += v; } }
    const order = ["cash", "futures", "inventory", "ar", "vat_input", "ap", "vat_output", "capital", "retained_earnings", "revenue", "other_income", "futures_pnl", "fx_diff", "cogs", "inventory_loss", "fees", "expense"];
    return Object.values(out).map((a) => ({ ...a, opening: r2(a.opening), debits: r2(a.debits), credits: r2(a.credits), closing: r2(a.closing), balance: r2(["liability", "equity", "income"].includes(a.kind) ? -a.closing : a.closing) })).sort((x, y) => (order.indexOf(x.account) < 0 ? 99 : order.indexOf(x.account)) - (order.indexOf(y.account) < 0 ? 99 : order.indexOf(y.account)));
  }
  // 4.13: the vessel a journal belongs to — tagged on its ref, or through the trade, invoice, bill or bank line it came from
  function vesselOfJournal(store, j, maps) {
    const r = (j && j.ref) || {}; if (r.vesselId) return r.vesselId;
    const m = maps || { trades: new Map(store.trades.map((t) => [t.id, t])), invoices: new Map(store.invoices.map((i) => [i.id, i])), bills: new Map(store.bills.map((b) => [b.id, b])), tx: new Map((store.bankTx || []).map((t) => [t.id, t])), cargoes: new Map(store.cargoes.map((c) => [c.id, c])) };
    const tradeVessel = (id) => { const t = id && m.trades.get(id); return t && t.vesselId ? t.vesselId : null; };
    const docVessel = (d) => { if (!d) return null; if (d.vesselId) return d.vesselId; const v = tradeVessel(d.tradeId); if (v) return v; if (d.cargoId) { const c = m.cargoes.get(d.cargoId); const v2 = c && tradeVessel(c.createdFromTradeId); if (v2) return v2; } return null; };
    return tradeVessel(r.tradeId) || docVessel(r.invoiceId && m.invoices.get(r.invoiceId)) || docVessel(r.billId && m.bills.get(r.billId)) || (r.txId && m.tx.get(r.txId) && m.tx.get(r.txId).vesselId) || null;
  }
  function ledgerLines(store, opt) {
    const { entityId, account, sub, from, to, q, vesselId } = opt || {}; const out = []; let bal = 0;
    const vmaps = vesselId ? { trades: new Map(store.trades.map((t) => [t.id, t])), invoices: new Map(store.invoices.map((i) => [i.id, i])), bills: new Map(store.bills.map((b) => [b.id, b])), tx: new Map((store.bankTx || []).map((t) => [t.id, t])), cargoes: new Map(store.cargoes.map((c) => [c.id, c])) } : null;
    const js = store.ledger.filter((j) => (entIn(j.entityId, entityId)) && (!from || j.date >= from) && (!to || j.date <= to) && (!vesselId || vesselOfJournal(store, j, vmaps) === vesselId)).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    for (const j of js) for (const l of j.lines) { if (account && l.account !== account) continue; if (sub != null && sub !== "" && l.sub !== sub) continue; const subName_ = l.sub ? subName(store, l) : ""; if (q) { const hay = (j.memo + " " + l.account + " " + subName_ + " " + ((j.ref && j.ref.payee) || "")).toLowerCase(); if (!hay.includes(q.toLowerCase())) continue; } bal += l.debit - l.credit; out.push({ journal: j, line: l, subName: subName_, balance: r2(bal), reversed: !!j.reversedBy, reversal: !!(j.ref && j.ref.type === "reversal") }); }
    return out;
  }
  const EDITABLE_TYPES = ["banktx", "journal", "expense", "reversal"];
  function journalEditable(j) { return !!j.ref && EDITABLE_TYPES.includes(j.ref.type) && !j.reversedBy; }
  function reverseJournal(store, journalId, reason) {
    const j = store.ledger.find((x) => x.id === journalId); if (!j) throw new Error("Journal not found"); if (j.reversedBy) throw new Error("Already reversed"); if (!journalEditable(j)) throw new Error("This posting comes from a trade, cargo, invoice or bill; correct it through a credit note, a cancellation or a manual journal instead");
    const date = today() > j.date ? today() : j.date;
    const r = post(store, j.entityId, date, "Reversal of: " + j.memo + (reason ? " — " + reason : ""), j.lines.map((l) => ({ account: l.account, sub: l.sub, debit: l.credit, credit: l.debit, currency: l.currency, amount: l.amount })), { type: "reversal", of: j.id });
    j.reversedBy = r.id;
    if (j.ref && j.ref.type === "banktx") { const tx = store.bankTx.find((t) => t.id === j.ref.txId); if (tx) tx.reversed = true; }
    if (j.ref && j.ref.type === "expense" && j.ref.billId) { const b = store.bills.find((x) => x.id === j.ref.billId); if (b) { if (b.paid > 0.001) throw new Error("This expense bill has payments against it; reverse the payment first"); store.bills = store.bills.filter((x) => x.id !== b.id); } }
    return r;
  }
  function expense(store, d) {
    // Paid from an account → bank transaction. Not yet paid → accrual: expense now, a vendor bill to pay later.
    if (!(+d.amount > 0)) throw new Error("Amount must be greater than zero");
    if (d.bankId) return { kind: "paid", tx: bankTransaction(store, { ...d, kind: "out" }) };
    const ent = store.entities.find((e) => e.id === d.entityId); if (!ent) throw new Error("Entity required");
    const vr = +d.vatRate || 0, gross = r2(+d.amount), net = r2(gross / (1 + vr / 100)), vat = r2(gross - net); const fx = autoFx(store, d.entityId, d.currency, d.date, d.fx); const category = d.category || "Other"; const cp = store.counterparties.find((c) => c.id === d.counterpartyId);
    const allocs = checkAllocations(store, d.allocations, gross, { ps: d.ps });
    const bill = { id: uid("bl"), ref: nextRef(store, "bills", ent.id, "BILL"), entityId: ent.id, counterpartyId: cp ? cp.id : null, tradeId: d.tradeId || null, cargoId: null, vesselId: allocs ? sameOf(allocs, "vesselId") : d.vesselId || null, voyageId: allocs ? sameOf(allocs, "voyageId") : d.voyageId || null, fixtureId: allocs ? sameOf(allocs, "fixtureId") : d.fixtureId || null, date: d.date || today(), due: d.due || addDays(d.date || today(), cp ? cp.terms : 30), net, vat, vatRate: vr, vatKind: vr ? "standard" : "out", amount: gross, currency: d.currency || ent.currency, fx, paid: 0, credited: 0, internal: true, expense: true, category, payee: d.payee || "", memo: (d.memo || category) + (d.payee ? " · " + d.payee : ""), lines: [{ label: d.memo || category, amount: net }] };
    if (allocs) { bill.allocations = allocs; bill.allocated = true; }
    store.bills.push(bill);
    const bNet = r2(net * fx), bVat = vat ? r2(vat * fx) : 0; // 4.17 · the payable is the sum of the rounded lines, so net + VAT at a rate never leaves a cent over
    const parts = allocs || [{ vesselId: bill.vesselId, voyageId: bill.voyageId, fixtureId: bill.fixtureId, amount: gross, category: null }]; const partLines = []; let left = bNet; parts.forEach((pt, i) => { const bn = i === parts.length - 1 ? r2(left) : r2(bNet * pt.amount / gross); left = r2(left - bn); const pf = postingFor(store, pt.vesselId, "cost", pt.category || category); partLines.push({ account: pf.account, sub: pf.sub, debit: bn, ...(allocs || pt.vesselId ? { tags: { vesselId: pt.vesselId || null, voyageId: pt.voyageId || null, fixtureId: pt.fixtureId || null } } : {}) }); });
    const lines = [...partLines, ...(vat ? [{ account: "vat_input", debit: bVat }] : []), { account: "ap", sub: bill.counterpartyId, credit: r2(bNet + bVat), currency: bill.currency, amount: gross }];
    const j = post(store, ent.id, bill.date, category + (d.payee ? " to " + d.payee : cp ? " to " + cp.name : "") + ": " + (d.memo || "expense, unpaid"), lines, { type: "expense", billId: bill.id, vesselId: bill.vesselId || null, voyageId: bill.voyageId || null, fixtureId: bill.fixtureId || null, tradeId: d.tradeId || null, counterpartyId: bill.counterpartyId, payee: d.payee || "", allocated: !!allocs });
    bill.journalId = j.id; return { kind: "accrued", bill };
  }
  function expenseLines(store, opt) {
    // every expense-type line with what it belongs to, for the Expenses page
    const { entityId, from, to } = opt || {}; const out = [];
    for (const j of store.ledger) { if (!entIn(j.entityId, entityId)) continue; if (from && j.date < from) continue; if (to && j.date > to) continue; if (j.ref && j.ref.type === "reversal") continue;
      for (const l of j.lines) { if (!["expense", "fees", "inventory_loss"].includes(l.account)) continue; if (!l.debit && !l.credit) continue; const ref = j.ref || {}; const tx = ref.type === "banktx" ? store.bankTx.find((t) => t.id === ref.txId) : null; const bill = ref.billId ? store.bills.find((b) => b.id === ref.billId) : null; const trade = ref.tradeId ? store.trades.find((t) => t.id === ref.tradeId) : (l.account === "fees" && l.sub ? store.trades.find((t) => t.id === l.sub) : null); const vat = j.lines.find((x) => x.account === "vat_input"); const cargoLoss = ref.type === "loss" ? store.cargoes.find((c) => c.id === ref.cargoId) : null;
        out.push({ id: j.id + ":" + j.lines.indexOf(l), journal: j, date: j.date, entityId: j.entityId, account: l.account, category: l.account === "expense" ? (l.sub || "Other") : l.account === "fees" ? "Trade costs" : "Inventory loss", amount: r2(l.debit - l.credit), vat: vat ? r2(vat.debit - vat.credit) : 0, memo: j.memo, payee: ref.payee || (tx && tx.payee) || (bill && bill.payee) || "", counterpartyId: ref.counterpartyId || (tx && tx.counterpartyId) || (bill && bill.counterpartyId) || null, vesselId: ref.vesselId || (tx && tx.vesselId) || (bill && bill.vesselId) || (trade ? trade.vesselId : null), tradeId: trade ? trade.id : null, voyageId: ref.voyageId || (tx && tx.voyageId) || (bill && bill.voyageId) || (trade ? trade.voyageId : null) || null, cargoId: cargoLoss ? cargoLoss.id : (ref.cargoId || null), source: ref.type || "posting", paid: tx ? "paid" : bill ? (docOpen(bill) < 0.01 ? "paid" : bill.pending ? "not delivered" : "unpaid") : ref.type === "delivery" ? "on delivery" : "", billId: bill ? bill.id : null, txId: tx ? tx.id : null, bankId: tx ? tx.bankId : null, editable: journalEditable(j), reversed: !!j.reversedBy }); } }
    return out.sort((a, b) => (a.date < b.date ? 1 : -1));
  }

  // ---------------------------------------------------------------- exchange rates: a daily table (USD base) kept in the book, applied to entities and accounts marked automatic
  // 4.12 PROSHIP · a cost or income is applied to a vessel after the fact: the record and its journal(s) carry the vessel
  function tagVessel(store, kind, id, vesselId) {
    vesselId = vesselId || null; if (vesselId && !store.vessels.some((v) => v.id === vesselId)) throw new Error("Unknown vessel");
    const tagJ = (jid) => { const j = store.ledger.find((x) => x.id === jid); if (j) j.ref = { ...(j.ref || {}), vesselId }; };
    if (kind === "banktx") { const tx = store.bankTx.find((x) => x.id === id); if (!tx) throw new Error("Bank transaction not found"); tx.vesselId = vesselId; tagJ(tx.journalId); for (const j of store.ledger) if (j.ref && j.ref.type === "banktx" && j.ref.txId === tx.id) j.ref.vesselId = vesselId; }
    else if (kind === "bill") { const b = store.bills.find((x) => x.id === id); if (!b) throw new Error("Bill not found"); b.vesselId = vesselId; for (const j of store.ledger) if (j.ref && j.ref.billId === b.id) j.ref.vesselId = vesselId; }
    else if (kind === "invoice") { const i = store.invoices.find((x) => x.id === id); if (!i) throw new Error("Invoice not found"); i.vesselId = vesselId; const t = store.trades.find((x) => x.id === i.tradeId); if (t) t.vesselId = vesselId; for (const j of store.ledger) if (j.ref && (j.ref.invoiceId === i.id || (t && j.ref.tradeId === t.id))) j.ref.vesselId = vesselId; }
    else if (kind === "trade") { const t = store.trades.find((x) => x.id === id); if (!t) throw new Error("Trade not found"); t.vesselId = vesselId; for (const i of store.invoices) if (i.tradeId === t.id) i.vesselId = vesselId; for (const j of store.ledger) if (j.ref && j.ref.tradeId === t.id) j.ref.vesselId = vesselId; }
    else if (kind === "journal") { const j = store.ledger.find((x) => x.id === id); if (!j) throw new Error("Journal not found"); j.ref = { ...(j.ref || {}), vesselId }; }
    else throw new Error("Unknown record kind " + kind);
    invalidate(store); return true;
  }
  // 4.14 · the same for a voyage: a document, bank line or journal belongs to one voyage of the vessel (or to none)
  function tagVoyage(store, kind, id, voyageId) {
    voyageId = voyageId || null;
    const tagJ = (pred) => { for (const j of store.ledger) if (j.ref && pred(j.ref)) j.ref = { ...j.ref, voyageId }; };
    if (kind === "banktx") { const tx = store.bankTx.find((x) => x.id === id); if (!tx) throw new Error("Bank transaction not found"); tx.voyageId = voyageId; tagJ((r) => r.type === "banktx" && r.txId === tx.id); }
    else if (kind === "bill") { const b = store.bills.find((x) => x.id === id); if (!b) throw new Error("Bill not found"); b.voyageId = voyageId; tagJ((r) => r.billId === b.id); }
    else if (kind === "invoice") { const i = store.invoices.find((x) => x.id === id); if (!i) throw new Error("Invoice not found"); i.voyageId = voyageId; const t = store.trades.find((x) => x.id === i.tradeId); if (t) t.voyageId = voyageId; tagJ((r) => r.invoiceId === i.id || (t && r.tradeId === t.id)); }
    else if (kind === "trade") { const t = store.trades.find((x) => x.id === id); if (!t) throw new Error("Trade not found"); t.voyageId = voyageId; for (const i of store.invoices) if (i.tradeId === t.id) i.voyageId = voyageId; tagJ((r) => r.tradeId === t.id); }
    else if (kind === "journal") { const j = store.ledger.find((x) => x.id === id); if (!j) throw new Error("Journal not found"); j.ref = { ...(j.ref || {}), voyageId }; }
    else throw new Error("Unknown record kind " + kind);
    invalidate(store); return true;
  }
  // every journal that belongs to a vessel: tagged directly, or through its trade, invoice, bill or bank transaction
  function vesselLedger(store, vesselId) {
    const tradeV = (tid) => { const t = store.trades.find((x) => x.id === tid); return t ? t.vesselId : null; };
    const docV = (d) => (d ? d.vesselId || (d.tradeId ? tradeV(d.tradeId) : null) : null);
    return store.ledger.filter((j) => { const r = j.ref || {}; if ((j.lines || []).some((l) => l.tags && l.tags.vesselId === vesselId)) return true; if (r.vesselId) return r.vesselId === vesselId; if (r.tradeId && tradeV(r.tradeId)) return tradeV(r.tradeId) === vesselId; if (r.invoiceId) { const v = docV(store.invoices.find((x) => x.id === r.invoiceId)); if (v) return v === vesselId; } if (r.billId) { const v = docV(store.bills.find((x) => x.id === r.billId)); if (v) return v === vesselId; } if (r.txId) { const tx = store.bankTx.find((x) => x.id === r.txId); if (tx && tx.vesselId) return tx.vesselId === vesselId; } return false; });
  }
  function fxRate(store, from, to) { const t = store.meta.fx; from = (from || "").toUpperCase(); to = (to || "").toUpperCase(); if (from === to) return 1; if (!t || !t.rates) return null; const rf = from === t.base ? 1 : t.rates[from], rt = to === t.base ? 1 : t.rates[to]; if (!rf || !rt) return null; return Math.round((rt / rf) * 1e6) / 1e6; }
  // 4.21 · the rate on a date: the day's table from the history (the latest day on or before the date), else the current table.
  // Returns null when the book has never seen that currency — the caller then asks for a fetch or a typed rate.
  function fxRateOn(store, from, to, date) {
    from = (from || "").toUpperCase(); to = (to || "").toUpperCase(); if (!from || !to || from === to) return 1;
    const hist = (store.meta && store.meta.fxHistory) || {}; const cur = store.meta && store.meta.fx; const d = String(date || "").slice(0, 10);
    const conv = (base, rates) => { if (!rates) return null; const rf = from === base ? 1 : rates[from], rt = to === base ? 1 : rates[to]; if (!rf || !rt) return null; return Math.round((rt / rf) * 1e6) / 1e6; };
    if (d && /^\d{4}-\d{2}-\d{2}$/.test(d)) { const keys = Object.keys(hist).filter((k) => k <= d).sort(); for (let i = keys.length - 1; i >= 0; i--) { const r = conv((cur && cur.base) || "USD", hist[keys[i]]); if (r) return r; } }
    return cur ? conv(cur.base || "USD", cur.rates) : null;
  }
  // the rate a document is recorded at: the one given on the document, else 1 for the entity's own currency, else the day's table
  function autoFx(store, entityId, currency, date, given) {
    if (given != null && given !== "" && +given > 0) return +given;
    const ent = store.entities.find((e) => e.id === entityId); const ccy = (currency || (ent && ent.currency) || "").toUpperCase(); if (!ent || !ccy || ccy === String(ent.currency).toUpperCase()) return 1;
    return fxRateOn(store, ccy, ent.currency, date) || 1;
  }
  // the history can also hold a day fetched on demand (a backdated document)
  function addFxDay(store, table) { if (!table || !table.rates || !table.date) return; const hist = (store.meta.fxHistory = store.meta.fxHistory || {}); if (!hist[table.date]) hist[table.date] = table.base && table.base !== "USD" ? rebase(table) : table.rates; }
  const rebase = (t) => { const u = t.rates.USD; if (!u) return t.rates; const out = {}; for (const [k, v] of Object.entries(t.rates)) out[k] = Math.round((v / u) * 1e6) / 1e6; out[t.base] = Math.round((1 / u) * 1e6) / 1e6; out.USD = 1; return out; };
  // 4.21.2 · the group rate of every automatic entity follows the table on file (not only on the day a new table arrives):
  // called on load and after an entity is saved, so a book opened on a machine that fetched rates earlier never shows 1 DKK = 1 USD
  function refreshGroupFx(store) {
    const notes = []; if (!store || !store.meta || !store.meta.fx || !store.meta.fx.rates) return notes; const rc = store.meta.reportingCurrency || "USD";
    for (const e of store.entities || []) { if (e.autoFx === false) continue; if (String(e.currency || "").toUpperCase() === String(rc).toUpperCase()) { if (e.groupFx !== 1) { e.groupFx = 1; notes.push(e.name + ": 1"); } continue; } const r = fxRate(store, e.currency, rc); if (r && Math.abs(r - (e.groupFx || 0)) > 1e-6) { notes.push(e.name + ": 1 " + e.currency + " = " + r + " " + rc); e.groupFx = r; } }
    if (notes.length) invalidate(store); return notes;
  }
  function applyFxRates(store, table) {
    // table: { base: "USD", date: "YYYY-MM-DD", rates: { AED: 3.6725, DKK: 6.87, ... }, source }
    if (!table || !table.rates) throw new Error("No rates"); store.meta.fx = { base: table.base || "USD", date: table.date, rates: table.rates, source: table.source || "", fetchedAt: new Date().toISOString() };
    const hist = (store.meta.fxHistory = store.meta.fxHistory || {}); hist[table.date] = table.rates; const keys = Object.keys(hist).sort(); const keep = new Set(keys.slice(-45).concat(keys.filter((d) => d.endsWith("-01") || /-(28|29|30|31)$/.test(d)).slice(-60))); for (const k of keys) if (!keep.has(k)) delete hist[k];
    const notes = []; const rc = store.meta.reportingCurrency || "USD";
    for (const e of store.entities) { if (e.autoFx === false || e.currency === rc) continue; const r = fxRate(store, e.currency, rc); if (r && Math.abs(r - (e.groupFx || 0)) > 1e-6) { notes.push(e.name + ": 1 " + e.currency + " = " + r + " " + rc); e.groupFx = r; } }
    for (const b of store.banks) { const e = store.entities.find((x) => x.id === b.entityId); if (!e || b.autoFx === false || b.currency === e.currency) continue; const r = fxRate(store, b.currency, e.currency); if (r && Math.abs(r - (b.fx || 0)) > 1e-6) { notes.push(b.label + ": 1 " + b.currency + " = " + r + " " + e.currency); b.fx = r; } }
    invalidate(store); return notes;
  }
  // ---------------------------------------------------------------- e-invoicing (UAE PINT AE via an accredited service provider such as ClearTax)
  // The book carries the identifiers the standard needs; einvoicePayload builds the document in a UBL-shaped JSON that an ASP converts and transmits;
  // einvoiceCheck lists what is still missing before a submission could succeed. Transmission itself is done by the desktop app (IPC) once credentials exist.
  const INVOICE_TYPES = { invoice: "380", credit: "381", proforma: "325" };
  function einvoiceCheck(store, doc) {
    const isCn = doc.type === "creditnote"; const e = store.entities.find((x) => x.id === doc.entityId) || {}; const cp = store.counterparties.find((x) => x.id === doc.counterpartyId) || {}; const miss = [];
    if (!e.trn) miss.push("Seller TRN (entity)"); if (!e.address) miss.push("Seller address (entity)"); if (!e.peppolId) miss.push("Seller Peppol ID (entity)");
    if (!cp.name) miss.push("Buyer name"); if (!cp.address) miss.push("Buyer address (counterparty)"); if (!cp.trn && !cp.tin) miss.push("Buyer TRN or TIN (counterparty)"); if (cp.freeZone && !cp.freeZoneName) miss.push("Buyer free zone name (counterparty)");
    if (!doc.lines || !doc.lines.length) miss.push("At least one line"); if (isCn && !doc.invoiceId) miss.push("Referenced invoice (credit note)");
    return miss;
  }
  function einvoicePayload(store, doc) {
    const isCn = doc.type === "creditnote"; const e = store.entities.find((x) => x.id === doc.entityId) || {}; const cp = store.counterparties.find((x) => x.id === doc.counterpartyId) || {}; const t = doc.tradeId ? store.trades.find((x) => x.id === doc.tradeId) : null; const ref = isCn ? store.invoices.find((x) => x.id === doc.invoiceId) : null;
    const vr = vatOf(doc.vatRate, doc.vatKind); const cat = doc.vatKind === "zero" ? "Z" : doc.vatKind === "exempt" ? "E" : doc.vatKind === "out" ? "O" : cp.reverseCharge ? "AE" : "S";
    const lines = (doc.lines || (t ? t.lines : [])).map((l, i) => { const p = l.productId ? store.products.find((x) => x.id === l.productId) : null; const qty = l.deliveredQty != null ? l.deliveredQty : l.qty; const net = r2(qty * l.price); return { ID: String(i + 1), InvoicedQuantity: { value: qty, unitCode: (l.unit || "MT") === "MT" ? "TNE" : (l.unit === "L" ? "LTR" : l.unit === "CBM" ? "MTQ" : l.unit === "KG" ? "KGM" : l.unit === "BBL" ? "BLL" : "EA") }, LineExtensionAmount: net, Item: { Name: p ? p.name + " (" + p.code + ")" : l.description, ClassifiedTaxCategory: { ID: cat, Percent: vr } }, Price: { PriceAmount: l.price, BaseQuantity: 1 } }; });
    const net = r2(sum(lines, (l) => l.LineExtensionAmount)), vat = r2(net * vr / 100);
    return { CustomizationID: "urn:peppol:pint:billing-1@ae-1", ProfileID: "urn:peppol:bis:billing", ID: doc.ref, IssueDate: doc.date, DueDate: doc.due || null, InvoiceTypeCode: isCn ? INVOICE_TYPES.credit : INVOICE_TYPES.invoice, DocumentCurrencyCode: doc.currency, TaxCurrencyCode: "AED", BuyerReference: t ? t.buyerRef || "" : "", ...(ref ? { BillingReference: { InvoiceDocumentReference: { ID: ref.ref, IssueDate: ref.date } } } : {}),
      AccountingSupplierParty: { Party: { EndpointID: e.peppolId || "", PartyName: e.name, PostalAddress: e.address || "", Country: e.country || "AE", PartyTaxScheme: { CompanyID: e.trn || "" }, PartyLegalEntity: { RegistrationName: e.name } } },
      AccountingCustomerParty: { Party: { EndpointID: cp.peppolId || "", PartyName: cp.name, PostalAddress: cp.address || "", Country: cp.country || "", PartyTaxScheme: { CompanyID: cp.trn || cp.tin || "" }, PartyLegalEntity: { RegistrationName: cp.name }, ...(cp.freeZone ? { FreeZone: cp.freeZoneName || "" } : {}) } },
      Delivery: t ? { ActualDeliveryDate: t.deliveredDate || t.deliveryDate, DeliveryLocation: { Address: t.port || "" }, Vessel: (store.vessels.find((v) => v.id === t.vesselId) || {}).name || "" } : null,
      PaymentTerms: doc.due ? { Note: "Due " + doc.due } : null,
      TaxTotal: { TaxAmount: vat, TaxSubtotal: [{ TaxableAmount: net, TaxAmount: vat, TaxCategory: { ID: cat, Percent: vr } }] },
      LegalMonetaryTotal: { LineExtensionAmount: net, TaxExclusiveAmount: net, TaxInclusiveAmount: r2(net + vat), PayableAmount: r2(net + vat) }, InvoiceLine: lines };
  }
  function einvoiceRecord(store, doc, result) { doc.einvoice = { ...(doc.einvoice || {}), ...result, updatedAt: new Date().toISOString() }; return doc.einvoice; }
  // ---------------------------------------------------------------- cash posted without a bank account (or to an unknown one)
  function unassignedCash(store, entityId) {
    const out = []; for (const j of store.ledger) { if (entityId && j.entityId !== entityId) continue; j.lines.forEach((l, i) => { if (l.account !== "cash") return; const bk = l.sub && store.banks.find((b) => b.id === l.sub); if (!bk) out.push({ journal: j, index: i, line: l, amount: r2(l.debit - l.credit) }); }); }
    return out;
  }
  function assignCashLine(store, journalId, index, bankId) {
    const j = store.ledger.find((x) => x.id === journalId); const bk = store.banks.find((b) => b.id === bankId); if (!j || !bk) throw new Error("Journal and bank required"); const l = j.lines[index]; if (!l || l.account !== "cash") throw new Error("Not a cash line"); if (bk.entityId !== j.entityId) throw new Error("That account belongs to another entity");
    l.sub = bk.id; const e = store.entities.find((x) => x.id === j.entityId); if (bk.currency !== (e || {}).currency) { l.currency = bk.currency; l.amount = r2((l.debit || l.credit) / (bk.fx || 1)); } else { l.currency = bk.currency; l.amount = r2(l.debit || l.credit); } invalidate(store); return l;
  }
  // ---------------------------------------------------------------- repair: same-currency bank postings and bank lines on the wrong account
  function repairBooks(store) {
    const notes = [];
    for (const b of store.banks) { const e = store.entities.find((x) => x.id === b.entityId); if (e && b.currency === e.currency && b.fx !== 1) { notes.push(b.label + ": rate set to 1 (same currency as " + e.name + ")"); b.fx = 1; } }
    for (const j of store.ledger) {
      for (const l of j.lines) { if (l.account === "cash" && !(l.sub && store.banks.find((b) => b.id === l.sub))) { const banks = store.banks.filter((b) => b.entityId === j.entityId); if (banks.length === 1) { l.sub = banks[0].id; l.currency = banks[0].currency; l.amount = r2(l.debit || l.credit); notes.push(j.date + " " + j.memo + ": " + fmtMoney(l.debit || l.credit) + " on Cash and bank had no account and was assigned to " + banks[0].label + " (the entity's only account)"); } } }
      for (const l of j.lines) { const bk = l.sub && store.banks.find((b) => b.id === l.sub); if (bk && l.account !== "cash") { notes.push(j.date + " " + j.memo + ": " + fmtMoney(l.debit || l.credit) + " on " + l.account + " moved to Cash and bank (" + bk.label + ")"); l.account = "cash"; } }
      const ref = j.ref || {}; const pay = ref.paymentId ? store.payments.find((p) => p.id === ref.paymentId) : (ref.type === "receipt" || ref.type === "payment") ? store.payments.find((p) => (ref.invoiceId ? p.invoiceId === ref.invoiceId : p.billId === ref.billId) && p.date === j.date) : null;
      const cashLines = j.lines.filter((l) => l.account === "cash" && l.sub);
      for (const l of cashLines) { const bk = store.banks.find((b) => b.id === l.sub); const e = bk && store.entities.find((x) => x.id === bk.entityId); if (!bk || !e || (bk.currency || "").toUpperCase() !== (e.currency || "").toUpperCase()) continue;
        const bankAmt = l.amount != null ? l.amount : pay && pay.bankId === bk.id ? pay.bankAmount || pay.amount : null; if (bankAmt == null) continue;
        const base = r2(l.debit - l.credit), want = l.debit ? bankAmt : -bankAmt; const delta = r2(base - want); if (Math.abs(delta) < 0.01) continue; const fxl = j.lines.find((x) => x.account === "fx_diff"); if (!fxl) continue;
        if (l.debit) l.debit = r2(bankAmt); else l.credit = r2(bankAmt); l.amount = r2(bankAmt); l.currency = bk.currency; const cur = r2(fxl.debit - fxl.credit + delta); fxl.debit = cur > 0 ? cur : 0; fxl.credit = cur < 0 ? -cur : 0; notes.push(j.date + " " + j.memo + ": bank amount corrected to " + fmtMoney(bankAmt, bk.currency) + " and the false FX difference of " + fmtMoney(delta) + " removed"); }
      j.lines = j.lines.filter((l) => !(l.account === "fx_diff" && !l.debit && !l.credit));
    }
    invalidate(store); return notes;
  }
  // ---------------------------------------------------------------- attachments (files live on disk under the data folder; the book keeps the index)
  function addAttachment(store, d) { const a = { id: uid("at"), subjectType: d.subjectType, subjectId: d.subjectId, name: d.name, size: +d.size || 0, file: d.file, added: d.added || today(), note: d.note || "", by: d.by || "" }; store.attachments.push(a); return a; }
  function removeAttachment(store, id) { const a = store.attachments.find((x) => x.id === id); store.attachments = store.attachments.filter((x) => x.id !== id); return a; }
  const attachmentsFor = (store, type, id) => (store.attachments || []).filter((a) => a.subjectType === type && a.subjectId === id).sort((x, y) => (x.added < y.added ? 1 : -1));

  // ---------------------------------------------------------------- bank reconciliation
  function bankEntries(store, bankId) {
    const b = store.banks.find((x) => x.id === bankId); const out = [];
    for (const j of store.ledger.filter((j) => j.entityId === b.entityId)) for (const l of j.lines) if (l.account === "cash" && l.sub === bankId) { const amt = l.amount != null ? (l.debit ? l.amount : -l.amount) : r2((l.debit - l.credit) / (b.fx || 1)); out.push({ journalId: j.id, date: j.date, memo: j.memo, amount: r2(amt) }); }
    return out.sort((a, b2) => (a.date < b2.date ? -1 : 1));
  }
  function parseCSV(text) {
    const rows = []; let row = [], cell = "", q = false; const push = () => { row.push(cell); cell = ""; };
    for (let i = 0; i < text.length; i++) { const ch = text[i]; if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; } else if (ch === '"') q = true; else if (ch === "," || ch === ";" || ch === "\t") push(); else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; push(); if (row.some((c) => c.trim() !== "")) rows.push(row); row = []; } else cell += ch; }
    if (cell || row.length) { push(); if (row.some((c) => c.trim() !== "")) rows.push(row); }
    return rows;
  }
  function parseAmount(v) { if (v == null) return NaN; let t = String(v).trim().replace(/\s/g, ""); const neg = /^\(.*\)$/.test(t) || /-/.test(t); t = t.replace(/[()\-+]/g, ""); if (/,\d{2}$/.test(t) && !/\.\d{2}$/.test(t)) t = t.replace(/\./g, "").replace(",", "."); else t = t.replace(/,/g, ""); const n = parseFloat(t); return isNaN(n) ? NaN : neg ? -n : n; }
  function parseDate(v) { if (!v) return null; const t = String(v).trim(); let m; if ((m = t.match(/^(\d{4})-(\d{2})-(\d{2})/))) return m[1] + "-" + m[2] + "-" + m[3]; if ((m = t.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})/))) return m[3] + "-" + m[2].padStart(2, "0") + "-" + m[1].padStart(2, "0"); if ((m = t.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2})$/))) return "20" + m[3] + "-" + m[2].padStart(2, "0") + "-" + m[1].padStart(2, "0"); const d = new Date(t); return isNaN(d) ? null : d.toISOString().slice(0, 10); }
  function importStatement(store, d) {
    // d: {bankId, rows (parsed CSV incl header), map: {date, desc, amount, debit, credit, ref}, hasHeader, statementBalance}
    const rec = (store.recon[d.bankId] = store.recon[d.bankId] || { lines: [], imports: [] }); const body = d.hasHeader === false ? d.rows : d.rows.slice(1); let added = 0;
    for (const r of body) { const date = parseDate(r[d.map.date]); let amount = d.map.amount != null && d.map.amount !== "" ? parseAmount(r[d.map.amount]) : NaN; if (isNaN(amount)) { const cr = parseAmount(r[d.map.credit]), dr = parseAmount(r[d.map.debit]); amount = (isNaN(cr) ? 0 : Math.abs(cr)) - (isNaN(dr) ? 0 : Math.abs(dr)); } if (!date || !amount) continue; const desc = (r[d.map.desc] || "").trim(); const ref = d.map.ref != null && d.map.ref !== "" ? (r[d.map.ref] || "").trim() : ""; const key = date + "|" + amount + "|" + desc; if (rec.lines.some((l) => l.key === key)) continue; rec.lines.push({ id: uid("sl"), key, date, desc, ref, amount: r2(amount), matched: null }); added++; }
    rec.imports.push({ date: today(), added, total: body.length, statementBalance: d.statementBalance != null ? +d.statementBalance : null, asOf: d.asOf || null }); if (d.statementBalance != null && d.statementBalance !== "") { rec.statementBalance = +d.statementBalance; rec.asOf = d.asOf || today(); }
    return added;
  }
  function autoMatch(store, bankId) {
    const rec = store.recon[bankId]; if (!rec) return 0; const entries = bankEntries(store, bankId); const used = new Set(rec.lines.filter((l) => l.matched).map((l) => l.matched)); let n = 0;
    for (const l of rec.lines.filter((l) => !l.matched)) { const cands = entries.filter((e) => !used.has(e.journalId) && Math.abs(e.amount - l.amount) < 0.01 && Math.abs(daysBetween(e.date, l.date)) <= 7).sort((a, b) => Math.abs(daysBetween(a.date, l.date)) - Math.abs(daysBetween(b.date, l.date))); if (cands.length) { l.matched = cands[0].journalId; used.add(cands[0].journalId); n++; } }
    return n;
  }
  function matchLine(store, bankId, lineId, journalId) { const rec = store.recon[bankId]; const l = rec.lines.find((x) => x.id === lineId); if (journalId && rec.lines.some((x) => x.matched === journalId && x.id !== lineId)) throw new Error("That entry is already matched"); l.matched = journalId || null; }
  function reconStatus(store, bankId) {
    const b = store.banks.find((x) => x.id === bankId); const rec = store.recon[bankId] || { lines: [] }; const entries = bankEntries(store, bankId); const matched = new Set(rec.lines.filter((l) => l.matched).map((l) => l.matched));
    const unmatchedApp = entries.filter((e) => !matched.has(e.journalId)); const unmatchedStmt = rec.lines.filter((l) => !l.matched);
    const appBal = bankBalance(store, bankId); const stmtBal = rec.statementBalance != null ? rec.statementBalance : null;
    return { bank: b, rec, entries, unmatchedApp, unmatchedStmt, matchedCount: matched.size, appBalance: appBal, statementBalance: stmtBal, difference: stmtBal != null ? r2(stmtBal - appBal) : null, unmatchedAppSum: r2(sum(unmatchedApp, (e) => e.amount)), unmatchedStmtSum: r2(sum(unmatchedStmt, (l) => l.amount)) };
  }

  // ---------------------------------------------------------------- chain, agenda, performance
  function tradeChain(store, tradeId) {
    const t = store.trades.find((x) => x.id === tradeId); const c = t.cargoId ? store.cargoes.find((x) => x.id === t.cargoId) : null;
    const cargoes = [...new Set(productLines(t).map((l) => l.cargoId).filter(Boolean))].map((id) => store.cargoes.find((x) => x.id === id)).filter(Boolean);
    const bills = cargoes.map((cg) => store.bills.find((b) => b.cargoId === cg.id)).filter(Boolean); const internalBills = store.bills.filter((b) => b.tradeId === t.id);
    const bill = c ? store.bills.find((b) => b.cargoId === c.id) : null; const inv = store.invoices.find((i) => i.tradeId === t.id);
    const cns = inv ? store.documents.filter((x) => x.type === "creditnote" && x.invoiceId === inv.id) : [];
    const rec = inv ? store.payments.filter((p) => p.invoiceId === inv.id && !p.reversed) : []; const pay = bill ? store.payments.filter((p) => !p.reversed && p.billId === bill.id) : [];
    const hedges = c ? store.futuresTrades.filter((f) => f.hedgeFor === c.id) : [];
    const payAll = store.payments.filter((p) => !p.reversed && (bills.some((b) => b.id === p.billId) || internalBills.some((b) => b.id === p.billId)));
    return { t, c, cargoes, bills, internalBills, bill, inv, cns, rec, pay: payAll, hedges, backToBack: cargoes.some((cg) => cg.createdFromTradeId === t.id) };
  }
  function workflow(store, tradeId) {
    const ch = tradeChain(store, tradeId); const t = ch.t; const pl = productLines(t);
    const sourced = pl.length ? pl.every((l) => l.cargoId) : true; const delivered = t.status === "delivered";
    const supplierBills = ch.bills; const supplierPaid = supplierBills.length ? (supplierBills.some((b) => b.pending) ? false : supplierBills.every((b) => docOpen(b) < 0.01)) : null;
    const received = ch.inv ? docOpen(ch.inv) < 0.01 : false;
    // 4.11: a foreign-currency amount on a step also says what it is in the entity's recording currency
    const wEnt = store.entities.find((e) => e.id === t.entityId) || {}; const fmD = (n, ccy, fx) => fmtMoney(n, ccy) + (wEnt.currency && ccy && ccy !== wEnt.currency && +fx && +fx !== 1 ? " ≈ " + fmtMoney(n * fx, wEnt.currency) : "");
    const steps = [
      { id: "confirm", label: "Confirmed", done: true, detail: t.ref + " · " + t.date, doc: "so" },
      { id: "source", label: "Sourced", done: !!sourced, na: !pl.length, detail: !pl.length ? "services only — nothing to source" : sourced ? ch.cargoes.map((c) => c.ref).join(", ") : pl.some((l) => l.b2bPending) ? "purchase side missing on " + pl.filter((l) => l.b2bPending).length + " line" + (pl.filter((l) => l.b2bPending).length === 1 ? "" : "s") : pl.filter((l) => !l.cargoId).length + " line" + (pl.filter((l) => !l.cargoId).length === 1 ? "" : "s") + " unsourced", action: sourced ? null : pl.some((l) => l.b2bPending) ? "purchase" : "allocate" },
      { id: "deliver", label: "Delivered", done: delivered, detail: delivered ? t.deliveredDate + " · " + fmtQty(t.deliveredQty) + " MT" : "due " + t.deliveryDate + (t.deliveryDate < today() ? " (late)" : ""), action: delivered ? null : "deliver", late: !delivered && t.deliveryDate < today() },
      { id: "invoice", label: "Tax invoice", done: !!ch.inv, detail: ch.inv ? ch.inv.ref + " · " + fmD(ch.inv.amount, ch.inv.currency, ch.inv.fx) + " · due " + ch.inv.due : "issued on delivery", doc: ch.inv ? "invoice" : "proforma" },
      { id: "supplier", label: "Supplier paid", done: supplierPaid === true, na: supplierPaid == null, detail: supplierPaid == null ? "no supplier bill" : supplierPaid ? supplierBills.map((b) => b.ref).join(", ") + " paid" : supplierBills.filter((b) => b.pending || docOpen(b) > 0.01).map((b) => b.ref + (b.pending ? " " + fmD(b.amount, b.currency, b.fx) + " · payable after delivery" : " " + fmD(docOpen(b), b.currency, b.fx) + " due " + b.due)).join("; "), action: supplierPaid === false && supplierBills.some((b) => !b.pending && docOpen(b) > 0.01) ? "pay" : null, billId: supplierPaid === false && supplierBills.some((b) => !b.pending && docOpen(b) > 0.01) ? supplierBills.find((b) => !b.pending && docOpen(b) > 0.01).id : null },
      { id: "receipt", label: "Payment received", done: received, detail: received ? "settled " + (ch.inv.paidDate || "") : ch.inv ? fmD(docOpen(ch.inv), ch.inv.currency, ch.inv.fx) + " open" + (docStatus(ch.inv) === "overdue" ? ", overdue " + daysBetween(ch.inv.due, today()) + " d" : "") : "after invoicing", action: ch.inv && !received ? "receive" : null, late: ch.inv && !received && docStatus(ch.inv) === "overdue" },
    ];
    const current = steps.find((s) => !s.done && !s.na) || null;
    return { steps, current, chain: ch };
  }
  function agenda(store, entIds, days) {
    const asOf = today(), until = addDays(asOf, days || 7); const out = []; const ok = (x) => entIds.includes(x.entityId);
    for (const t of store.trades.filter((t) => ok(t) && t.status === "agreed" && t.deliveryDate <= until)) out.push({ date: t.deliveryDate, kind: t.deliveryDate < asOf ? "late delivery" : "delivery", text: t.ref + " " + fmtQty(productMT(t)) + " MT " + productLines(t).map((l) => (store.products.find((p) => p.id === l.productId) || {}).code).join("+") + " to " + ((store.vessels.find((v) => v.id === t.vesselId) || {}).name || (store.counterparties.find((c) => c.id === t.customerId) || {}).short || "") + " at " + t.port + (t.cargoId ? "" : " — unsourced"), amount: null, level: t.deliveryDate < asOf ? "stop" : t.cargoId ? "info" : "warn", link: { view: "book", id: t.id } });
    for (const i of store.invoices.filter((i) => ok(i) && docOpen(i) > 0.01 && i.due <= until)) out.push({ date: i.due, kind: i.due < asOf ? "overdue receivable" : "collection due", text: i.ref + " " + (store.counterparties.find((c) => c.id === i.counterpartyId) || {}).short, amount: docOpen(i) * i.fx, ccy: i.currency, raw: docOpen(i), entityId: i.entityId, fx: i.fx, level: i.due < asOf ? "stop" : "ok", link: { view: "finance", id: i.id } });
    for (const b of store.bills.filter((b) => ok(b) && docOpen(b) > 0.01 && b.due <= until)) out.push({ date: b.due, kind: b.due < asOf ? "overdue payable" : "payment due", text: b.ref + " " + (store.counterparties.find((c) => c.id === b.counterpartyId) || {}).short, amount: -docOpen(b) * b.fx, ccy: b.currency, raw: docOpen(b), entityId: b.entityId, fx: b.fx, level: b.due < asOf ? "warn" : "info", link: { view: "finance", id: b.id } });
    for (const c of store.cargoes.filter((c) => ok(c) && !c.received && c.date <= until)) out.push({ date: c.date, kind: "cargo arriving", text: c.ref + " " + fmtQty(c.qty) + " MT at " + c.port, amount: null, level: "info", link: { view: "book", id: c.id } });
    return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  }
  function performance(store, entIds) {
    const asOf = today(); const m0 = asOf.slice(0, 7); const prev = addDays(m0 + "-01", -1).slice(0, 7);
    const gfx = (t) => groupRate(store, t.entityId, entIds && entIds.length ? entIds : null);
    const calc = (month) => { const tr = store.trades.filter((t) => entIds.includes(t.entityId) && t.status === "delivered" && (t.deliveredDate || t.deliveryDate).slice(0, 7) === month); const ms = tr.map((t) => ({ t, m: tradeMargin(store, t) })); const mt = sum(tr, productMT); const margin = sum(ms, (x) => (x.m.total || 0) * x.t.fx * gfx(x.t)); const byProd = {}; for (const x of ms) { const k = x.t.productId; byProd[k] = byProd[k] || { mt: 0, margin: 0, n: 0 }; byProd[k].mt += x.t.deliveredQty; byProd[k].margin += (x.m.total || 0) * x.t.fx * gfx(x.t); byProd[k].n++; } return { month, trades: tr.length, mt: r2(mt), revenue: r2(sum(tr, (t) => tradeValue(t) * t.fx * gfx(t))), margin: r2(margin), marginMT: mt ? r2(margin / mt) : null, customers: new Set(tr.map((t) => t.customerId)).size, byProd }; };
    return { current: calc(m0), previous: calc(prev) };
  }

  // ---------------------------------------------------------------- search
  function filterTrades(store, f) {
    f = f || {}; const q = (f.q || "").toLowerCase().split(/\s+/).filter(Boolean);
    const hay = (t) => { const c = store.counterparties.find((x) => x.id === t.customerId) || {}; const v = store.vessels.find((x) => x.id === t.vesselId) || {}; const p = store.products.find((x) => x.id === t.productId) || {}; const g = store.cargoes.find((x) => x.id === t.cargoId) || {}; const e = store.entities.find((x) => x.id === t.entityId) || {}; return [t.ref, c.name, c.short, v.name, v.imo, p.code, ...(t.lines || []).map((l) => (store.products.find((x) => x.id === l.productId) || {}).code || l.description), t.port, t.country, g.ref, e.name, t.status, t.buyerRef, t.bdnNo, t.note, tradeStage(store, t)].join(" ").toLowerCase(); };
    return store.trades.filter((t) => entIn(t.entityId, f.entityId) && (!f.customerId || t.customerId === f.customerId) && (!f.productId || (t.lines || []).some((l) => l.productId === f.productId)) && (!f.vesselId || t.vesselId === f.vesselId) && (!f.cargoId || t.cargoId === f.cargoId) && (!f.port || norm(t.port) === norm(f.port))
      && (!f.status || (f.status === "open" ? t.status === "agreed" : f.status === "stage:" + tradeStage(store, t) || t.status === f.status)) && (!f.from || t.deliveryDate >= f.from) && (!f.to || t.deliveryDate <= f.to) && (!f.minQty || t.qty >= +f.minQty) && (!f.maxQty || t.qty <= +f.maxQty)
      && (!q.length || q.every((w) => hay(t).includes(w))));
  }
  function filterCargoes(store, f) {
    f = f || {}; const q = (f.q || "").toLowerCase().split(/\s+/).filter(Boolean);
    return store.cargoes.map((c) => ({ c, st: cargoStatus(store, c) })).filter(({ c, st }) => entIn(c.entityId, f.entityId) && (!f.supplierId || c.supplierId === f.supplierId) && (!f.productId || c.productId === f.productId) && (!f.port || norm(c.port) === norm(f.port))
      && (!f.status || (f.status === "open" ? c.received && st.sellable > 0 : f.status === "depleted" ? c.received && st.sellable <= 0 : f.status === "contracted" ? !c.received : true)) && (!f.from || c.date >= f.from) && (!f.to || c.date <= f.to)
      && (!q.length || q.every((w) => [c.ref, c.port, c.country, (store.counterparties.find((x) => x.id === c.supplierId) || {}).name, (store.products.find((x) => x.id === c.productId) || {}).code, (store.entities.find((x) => x.id === c.entityId) || {}).name, c.note].join(" ").toLowerCase().includes(w))));
  }

  // ---------------------------------------------------------------- formatting
  function fmtMoney(n, ccy) { if (n == null || isNaN(n)) return "—"; const a = Math.abs(n); const s = a >= 1000 ? Math.round(a).toLocaleString("en-US") : a.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); return (n < 0 ? "-" : "") + (ccy ? ccy + " " : "") + s; }
  function fmtQty(n) { if (n == null || isNaN(n)) return "—"; return Math.abs(n - Math.round(n)) < 0.05 ? Math.round(n).toLocaleString("en-US") : n.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 }); }
  function fmtPct(n) { if (n == null || isNaN(n)) return "—"; return Math.round(n * 100) + "%"; }

  // ---------------------------------------------------------------- integrity
  function verify(store) {
    const errors = [];
    for (const j of store.ledger) { const dr = sum(j.lines, (l) => l.debit), cr = sum(j.lines, (l) => l.credit); if (Math.abs(dr - cr) > 0.01) errors.push("Journal " + j.id + " unbalanced"); }
    for (const e of store.entities) { const s = entityStatements(store, e.id); if (Math.abs(s.assets - s.liabilities - s.equity) > 0.05) errors.push(e.name + ": assets " + s.assets + " != liabilities " + s.liabilities + " + equity " + s.equity); }
    for (const c of store.cargoes) { const st = cargoStatus(store, c); if (st.physical - st.committed < -0.01) errors.push(c.ref + " over-allocated by " + -(st.physical - st.committed) + " MT"); }
    return errors;
  }

  // ---------------------------------------------------------------- demo data
  function removeDemo(store) {
    let n = 0; for (const k of Object.keys(store)) { if (!Array.isArray(store[k])) continue; const before = store[k].length; store[k] = store[k].filter((x) => !(x && x.demo)); n += before - store[k].length; }
    for (const t of store.trades) for (const l of t.lines || []) { const c = store.cargoes.find((x) => x.id === l.cargoId); if (!c) l.cargoId = null; }
    for (const c of store.counterparties) c.vesselIds = (c.vesselIds || []).filter((id) => store.vessels.some((v) => v.id === id));
    invalidate(store); return n;
  }
  const hasDemo = (store) => Object.keys(store).some((k) => Array.isArray(store[k]) && store[k].some((x) => x && x.demo));
  function seedDemo(store) { const lens = {}; for (const k of Object.keys(store)) if (Array.isArray(store[k])) lens[k] = store[k].length; const out = seedDemoInner(store); for (const k of Object.keys(lens)) for (let i = lens[k]; i < store[k].length; i++) if (store[k][i] && typeof store[k][i] === "object") store[k][i].demo = true; return out; }
  function seedDemoInner(store) {
    const d = (n) => addDays(today(), -n);
    const eA = addEntity(store, { name: "Xyntax Energy DMCC", country: "AE", currency: "USD", address: "Unit 2104, JBC 5, Cluster W\nJumeirah Lakes Towers, Dubai, UAE", trn: "100234567800003", email: "ops@xyntax-energy.example", phone: "+971 4 000 0000", bankDetails: "Emirates NBD · USD account · IBAN AE00 0000 0000 0000 0000 000 · SWIFT EBILAEAD", docFooter: "Supplies made under our General Terms and Conditions of Sale, latest edition. Title passes on full payment.", signatory: "A. Trader, Managing Director", altCurrency: "AED", altRate: 3.6725 });
    const eB = addEntity(store, { name: "Xyntax Trading ApS", country: "DK", currency: "USD", address: "Havnevej 1, 1000 Copenhagen, Denmark", trn: "DK12345678", bankDetails: "Danske Bank · USD account · IBAN DK00 0000 0000 0000 00 · SWIFT DABADKKK" });
    const bA1 = addBank(store, { entityId: eA.id, bank: "Emirates NBD", label: "ENBD USD", currency: "USD", accountName: "Xyntax Energy DMCC", iban: "AE07 0260 0010 1234 5678 901", swift: "EBILAEAD" });
    const bA2 = addBank(store, { entityId: eA.id, bank: "Mashreq", label: "Mashreq AED", currency: "AED", fx: 0.2723, accountName: "Xyntax Energy DMCC", iban: "AE33 0330 0000 1901 2345 678", swift: "BOMLAEAD" });
    addBank(store, { entityId: eA.id, bank: "Petty cash", label: "Petty cash AED", currency: "AED", fx: 0.2723, type: "cash", onDocs: false });
    const bB1 = addBank(store, { entityId: eB.id, bank: "Danske Bank", label: "Danske USD", currency: "USD", accountName: "Xyntax Trading ApS", iban: "DK50 0040 0440 1162 43", swift: "DABADKKK" });
    fundBank(store, { bankId: bA1.id, amount: 4000000, date: d(120) });
    fundBank(store, { bankId: bA2.id, amount: 1800000, date: d(118) });
    fundBank(store, { bankId: bB1.id, amount: 1500000, date: d(115) });
    transfer(store, { fromId: bA1.id, toId: bA2.id, amount: 100000, receivedAmount: 367100, charge: 35, chargeMemo: "SWIFT charges", date: d(60) });
    bankTransaction(store, { bankId: bA2.id, kind: "out", category: "Salaries", amount: 185000, date: d(45), memo: "Payroll August" });
    bankTransaction(store, { bankId: bA2.id, kind: "out", category: "Office", amount: 42000, vatRate: 5, date: d(40), memo: "JLT office rent Q3", reference: "RENT-Q3" });
    bankTransaction(store, { bankId: bA1.id, kind: "out", category: "Bank charges", amount: 120, date: d(30), memo: "Account maintenance" });
    bankTransaction(store, { bankId: bB1.id, kind: "out", category: "Legal & audit", amount: 6500, date: d(20), memo: "Audit fee 2025" });
    const fa = addFuturesAccount(store, { entityId: eA.id, broker: "Marex", label: "Marex futures" });
    fundFutures(store, { accountId: fa.id, amount: 400000, fromBankId: bA1.id, date: d(110) });
    const vlsfo = addProduct(store, { code: "VLSFO", name: "Very low sulphur fuel oil 0.5%", density: 0.97 });
    const hsfo = addProduct(store, { code: "HSFO", name: "High sulphur fuel oil 3.5%", density: 0.99 });
    const mgo = addProduct(store, { code: "MGO", name: "Marine gasoil 0.1%", density: 0.86 });
    const kB = addContract(store, { code: "SG380", name: "Singapore 380cst swap", unit: "MT", lotSize: 1000, mtPerUnit: 1, marginPerLot: 25000, feePerLot: 30, productId: hsfo.id, lastMark: 468, markDate: d(1) });
    const kV = addContract(store, { code: "SG05", name: "Singapore 0.5% swap", unit: "MT", lotSize: 1000, mtPerUnit: 1, marginPerLot: 28000, feePerLot: 30, productId: vlsfo.id, lastMark: 543, markDate: d(1) });
    addContract(store, { code: "BRN", name: "ICE Brent", unit: "bbl", lotSize: 1000, mtPerUnit: 0.1364, marginPerLot: 9000, feePerLot: 4, lastMark: 74.2, markDate: d(1) });
    const sup1 = addCounterparty(store, { name: "Fujairah Refinery Products", short: "FRP", role: "supplier", country: "AE", terms: 21, created: d(200), trn: "100987654300003", address: "Fujairah Oil Industry Zone, Fujairah, UAE" });
    const sup2 = addCounterparty(store, { name: "Gulf Blending Terminal LLC", short: "GBT", role: "supplier", country: "AE", terms: 30, created: d(200) });
    const c1 = addCounterparty(store, { name: "Nordic Bulk Carriers A/S", short: "Nordic Bulk", role: "customer", country: "DK", creditLimit: 1800000, terms: 30, created: d(180), trn: "DK87654321", address: "Havnegade 1, 1058 Copenhagen K, Denmark" });
    const c2 = addCounterparty(store, { name: "Meridian Tankers Pte", short: "Meridian", role: "customer", country: "SG", creditLimit: 1200000, terms: 30, created: d(170), trn: "M90312345A", address: "10 Anson Road, #22-01 International Plaza, Singapore 079903" });
    const c3 = addCounterparty(store, { name: "Aegean Coastal Shipping", short: "Aegean", role: "customer", country: "GR", creditLimit: 600000, terms: 45, created: d(150) });
    const c4 = addCounterparty(store, { name: "Sahara Maritime Ltd", short: "Sahara", role: "customer", country: "MT", creditLimit: 400000, terms: 30, created: d(90) });
    const c5 = addCounterparty(store, { name: "Kestrel Ship Management", short: "Kestrel", role: "customer", country: "GB", creditLimit: 900000, terms: 30, created: d(160) });
    const vs = [
      addVessel(store, { name: "Nordic Aurora", imo: "9412345", type: "Capesize bulk carrier", flag: "DK", dwt: 180000, built: 2012 }),
      addVessel(store, { name: "Nordic Comet", imo: "9412357", type: "Panamax bulk carrier", flag: "DK", dwt: 82000, built: 2015 }),
      addVessel(store, { name: "Meridian Star", imo: "9523456", type: "Aframax tanker", flag: "SG", dwt: 115000, built: 2018 }),
      addVessel(store, { name: "Meridian Sun", imo: "9523468", type: "MR product tanker", flag: "SG", dwt: 50000, built: 2016 }),
      addVessel(store, { name: "Aegean Pearl", imo: "9601234", type: "Handysize bulk carrier", flag: "GR", dwt: 35000, built: 2009 }),
      addVessel(store, { name: "Sahara Wind", imo: "9345678", type: "Supramax bulk carrier", flag: "PA", dwt: 56000, built: 2006 }),
      addVessel(store, { name: "Kestrel Bay", imo: "9711234", type: "Container feeder", flag: "GB", dwt: 22000, built: 2019 }),
      addVessel(store, { name: "Kestrel Reach", imo: "9711246", type: "Container feeder", flag: "GB", dwt: 22000, built: 2020 }),
    ];
    linkVessel(store, c1.id, vs[0].id); linkVessel(store, c1.id, vs[1].id); linkVessel(store, c2.id, vs[2].id); linkVessel(store, c2.id, vs[3].id); linkVessel(store, c3.id, vs[4].id); linkVessel(store, c4.id, vs[5].id); linkVessel(store, c5.id, vs[6].id); linkVessel(store, c5.id, vs[7].id); linkVessel(store, c1.id, vs[4].id);
    store.watchlist.push({ id: uid("w"), name: "Sahara Wind Shipping Co", imo: "", registration: "", country: "", severity: "flag", reason: "Adverse media: alleged STS transfers, 2025", added: d(40) });
    for (const cp of [sup1, sup2, c1, c2, c3, c5]) recordScreening(store, { type: "counterparty", id: cp.id, date: d(cp === c3 ? 110 : 20), by: "Compliance", method: "internal watchlist + manual" });
    for (const v of vs.slice(0, 5)) recordScreening(store, { type: "vessel", id: v.id, date: d(25), by: "Compliance" });
    recordScreening(store, { type: "vessel", id: vs[6].id, date: d(15), by: "Compliance" });
    // cargoes
    const g1 = addCargo(store, { entityId: eA.id, supplierId: sup1.id, productId: vlsfo.id, qty: 5000, price: 512, port: "Fujairah", country: "AE", date: d(95), costs: [{ label: "Inspection", amount: 4500 }, { label: "Terminal handling", amount: 12500 }], allowancePct: 0.3 });
    const g2 = addCargo(store, { entityId: eA.id, supplierId: sup2.id, productId: hsfo.id, qty: 4000, price: 441, port: "Fujairah", country: "AE", date: d(70), costs: [{ label: "Inspection", amount: 3800 }], allowancePct: 0.4, vatRate: 5, vatKind: "standard", doc: { poRef: "PO-2026-071", incoterm: "Ex-tank Fujairah" } });
    const g3 = addCargo(store, { entityId: eA.id, supplierId: sup1.id, productId: vlsfo.id, qty: 6000, price: 521, port: "Fujairah", country: "AE", date: d(38), costs: [{ label: "Inspection", amount: 4800 }, { label: "Terminal handling", amount: 15000 }], allowancePct: 0.3 });
    const g4 = addCargo(store, { entityId: eB.id, supplierId: sup2.id, productId: mgo.id, qty: 1500, price: 688, port: "Rotterdam", country: "NL", date: d(30), costs: [{ label: "Barge", amount: 9000 }], allowancePct: 0.2 });
    const g5 = addCargo(store, { entityId: eA.id, supplierId: sup1.id, productId: vlsfo.id, qty: 4000, price: 534, port: "Fujairah", country: "AE", date: d(6), costs: [{ label: "Inspection", amount: 4200 }], allowancePct: 0.3 });
    recordCargoLoss(store, { cargoId: g1.id, qty: 11, date: d(50), reason: "Tank shrinkage on survey" });
    recordCargoLoss(store, { cargoId: g2.id, qty: 9, date: d(30), reason: "Evaporation" });
    // trades
    const T = (o) => addTrade(store, { entityId: eA.id, delivered: true, vatKind: o.port === "Fujairah" ? "zero" : "standard", vatRate: 0, ...o });
    T({ customerId: c1.id, vesselId: vs[0].id, productId: vlsfo.id, cargoId: g1.id, qty: 1800, price: 541, port: "Fujairah", country: "AE", date: d(90), deliveryDate: d(88) });
    T({ customerId: c2.id, vesselId: vs[2].id, productId: vlsfo.id, cargoId: g1.id, qty: 1500, price: 538, port: "Fujairah", country: "AE", date: d(84), deliveryDate: d(82) });
    T({ customerId: c3.id, vesselId: vs[4].id, productId: vlsfo.id, cargoId: g1.id, qty: 900, price: 546, port: "Fujairah", country: "AE", date: d(75), deliveryDate: d(73) });
    T({ customerId: c1.id, vesselId: vs[1].id, productId: hsfo.id, cargoId: g2.id, qty: 1500, price: 466, port: "Fujairah", country: "AE", date: d(66), deliveryDate: d(64) });
    T({ customerId: c5.id, vesselId: vs[6].id, productId: hsfo.id, cargoId: g2.id, qty: 1200, price: 469, port: "Fujairah", country: "AE", date: d(58), deliveryDate: d(56) });
    T({ customerId: c2.id, vesselId: vs[3].id, productId: vlsfo.id, cargoId: g1.id, qty: 700, price: 549, port: "Fujairah", country: "AE", date: d(52), deliveryDate: d(50) });
    T({ customerId: c4.id, vesselId: vs[5].id, productId: hsfo.id, cargoId: g2.id, qty: 800, price: 471, port: "Fujairah", country: "AE", date: d(44), deliveryDate: d(42) });
    T({ customerId: c1.id, vesselId: vs[0].id, productId: vlsfo.id, cargoId: g3.id, qty: 2000, price: 552, port: "Fujairah", country: "AE", date: d(34), deliveryDate: d(32) });
    T({ customerId: c5.id, vesselId: vs[7].id, productId: vlsfo.id, cargoId: g3.id, qty: 1100, price: 556, port: "Fujairah", country: "AE", date: d(27), deliveryDate: d(25) });
    T({ entityId: eB.id, customerId: c1.id, vesselId: vs[1].id, productId: mgo.id, cargoId: g4.id, qty: 600, price: 724, port: "Rotterdam", country: "NL", date: d(24), deliveryDate: d(22) });
    T({ customerId: c2.id, vesselId: vs[2].id, productId: vlsfo.id, cargoId: g3.id, qty: 1500, price: 558, port: "Fujairah", country: "AE", date: d(18), deliveryDate: d(16) });
    T({ entityId: eB.id, customerId: c5.id, vesselId: vs[6].id, productId: mgo.id, cargoId: g4.id, qty: 400, price: 731, port: "Rotterdam", country: "NL", date: d(12), deliveryDate: d(10) });
    T({ customerId: c3.id, vesselId: vs[4].id, productId: vlsfo.id, cargoId: g5.id, qty: 800, price: 566, port: "Fujairah", country: "AE", date: d(4), deliveryDate: d(3) });
    addTrade(store, { entityId: eA.id, customerId: c1.id, vesselId: vs[0].id, productId: vlsfo.id, cargoId: g5.id, qty: 1500, price: 569, port: "Fujairah", country: "AE", date: d(1), deliveryDate: addDays(today(), 3) });
    addTrade(store, { entityId: eA.id, customerId: c4.id, vesselId: vs[5].id, productId: hsfo.id, cargoId: null, qty: 1000, price: 478, port: "Fujairah", country: "AE", date: d(2), deliveryDate: addDays(today(), 9) });
    addTrade(store, { entityId: eA.id, customerId: c2.id, vesselId: vs[3].id, port: "Fujairah", country: "AE", date: d(1), deliveryDate: addDays(today(), 4), vatKind: "zero", lines: [
      { kind: "product", productId: vlsfo.id, qty: 500, price: 571, cargoId: g5.id }, { kind: "product", productId: mgo.id, qty: 50, price: 745, cargoId: null }, { kind: "service", description: "Surveyor attendance", qty: 1, unit: "each", price: 2000, cost: 1400 }],
      costs: [{ label: "Barge hire (internal)", amount: 3500 }] });
    Object.assign(store.trades[7], { buyerRef: "NBC-STEM-2211", agent: "GAC Fujairah", bdnNo: "FJ-88121", doc: { deliveryMethod: "Barge", bargeName: "Al Wasl 7", incoterm: "Delivered ex-barge" } });
    // payments
    const inv = store.invoices.slice().sort((a, b) => (a.date < b.date ? -1 : 1));
    const payAll = (i, lag, bank) => receivePayment(store, { invoiceId: i.id, amount: i.amount, date: addDays(i.due, lag), bankId: bank });
    const bankFor = (i) => (i.entityId === eA.id ? bA1.id : bB1.id);
    inv.forEach((i, idx) => {
      const cp = store.counterparties.find((c) => c.id === i.counterpartyId);
      const lag = cp === c1 ? -2 : cp === c2 ? 3 : cp === c3 ? 14 : cp === c5 ? 1 : 25;
      if (daysBetween(addDays(i.due, lag), today()) >= 0 && !(cp === c4 && idx > 5) && !(cp === c3 && idx > 10)) payAll(i, lag, bankFor(i));
    });
    for (const b of store.bills) if (b.due < d(3)) payBill(store, { billId: b.id, amount: b.amount, date: addDays(b.due, -1), bankId: b.entityId === eA.id ? bA1.id : bB1.id });
    { const i = store.invoices.find((x) => x.counterpartyId === c2.id && docOpen(x) > 0); if (i) creditNote(store, { invoiceId: i.id, amount: 2100, date: d(2), reason: "Quantity dispute settled: BDN short 3.75 MT" }); }
    // futures
    openFutures(store, { accountId: fa.id, contractId: kV.id, side: "sell", lots: 1, entry: 538, date: d(37), hedgeFor: g3.id, expiry: "Oct-26" });
    const f2 = openFutures(store, { accountId: fa.id, contractId: kB.id, side: "sell", lots: 2, entry: 461, date: d(69), hedgeFor: g2.id, expiry: "Sep-26" });
    closeFutures(store, { tradeId: f2.id, exit: 472, date: d(40) });
    openFutures(store, { accountId: fa.id, contractId: kV.id, side: "sell", lots: 1, entry: 551, date: d(5), hedgeFor: g5.id, expiry: "Nov-26" });
    store.notes.push({ id: uid("n"), date: d(9), subject: "counterparty", subjectId: c4.id, text: "Broker says Sahara is shopping HSFO enquiries to two other suppliers in Fujairah. Their last two invoices ran late." });
    store.notes.push({ id: uid("n"), date: d(3), subject: "counterparty", subjectId: c2.id, text: "Meridian adding two MRs to the Gulf run from November; expects 2-3 stems a month." });
    store.enquiries.push({ id: uid("q"), date: d(7), counterpartyId: c3.id, productId: mgo.id, qty: 300, port: "Piraeus", ourPrice: 742, outcome: "lost", note: "Lost to local supplier, gap ~9 $/MT" });
    store.enquiries.push({ id: uid("q"), date: d(5), counterpartyId: c5.id, productId: vlsfo.id, qty: 1200, port: "Fujairah", ourPrice: 566, outcome: "won", note: "" });
    return store;
  }


  // ================================================================ 4.16 ENTERPRISE · controls
  // Maker-checker: a payment, journal, void, credit note or period close above the limits (or always, for closes when so set)
  // is not posted by the person who prepares it. It becomes an approval request holding the exact action; the engine posts
  // the action itself on the final approval, by a different person. Every step lands in the audit trail kept in the book
  // (store.audit) — the server trail (audit_as) is written by the app alongside.
  const controlsOf = (store) => ({ ...CONTROLS_DEFAULT(), ...((store.settings && store.settings.controls) || {}) });
  const normU = (u) => String(u || "").trim().toLowerCase();
  const isApprover = (store, user) => { const c = controlsOf(store); return c.approvers.length ? c.approvers.some((a) => normU(a) === normU(user)) : true; };
  // an amount in the group reporting currency: entity currency × the entity's group rate (a document currency goes through the daily table or the booked rate)
  function toBase(store, entityId, amount, currency, fx) {
    const e = store.entities.find((x) => x.id === entityId); const n = +amount || 0; if (!e) return r2(n);
    let inEnt = n; if (currency && e.currency && String(currency).toUpperCase() !== String(e.currency).toUpperCase()) { const rate = (+fx > 0 ? +fx : 0) || fxRate(store, currency, e.currency) || 1; inEnt = n * rate; }
    return r2(inEnt * (e.groupFx || 1));
  }
  // → { required: 0|1|2, limit, reason }
  function needsApproval(store, kind, base, opt) {
    const c = controlsOf(store); base = Math.abs(+base || 0); const two = c.paymentTwoApproversAbove > 0 && base >= c.paymentTwoApproversAbove;
    if (kind === "payment") { if (c.paymentLimit > 0 && base >= c.paymentLimit) return { required: two ? 2 : 1, limit: c.paymentLimit, reason: "payments of " + fmtMoney(c.paymentLimit) + " " + (store.meta.reportingCurrency || "USD") + " and above need " + (two ? "two approvals" : "an approval") }; return { required: 0 }; }
    if (kind === "journal") { if (c.journalLimit > 0 && base >= c.journalLimit) return { required: 1, limit: c.journalLimit, reason: "manual journals of " + fmtMoney(c.journalLimit) + " " + (store.meta.reportingCurrency || "USD") + " and above need an approval" }; return { required: 0 }; }
    if (kind === "close" || kind === "reopen") return c.closeRequiresApproval ? { required: 1, reason: "closing or reopening a period needs an approval" } : { required: 0 };
    if (kind === "bill-void" || kind === "invoice-void" || kind === "credit-note") return c.voidRequiresApproval ? { required: 1, reason: "voiding a document or crediting an invoice needs an approval" } : { required: 0 };
    if (kind === "limit-change") return c.limitChangeRequiresApproval && c.approvers.length ? { required: 1, reason: "changes to the controls need an approval" } : { required: 0 };
    return { required: 0 };
  }
  // the gate inside the posting functions: an action that needs an approval and did not come through one is refused
  function guard(store, kind, x) { const d = x.d || {}; if (d.__approved || d.__internal) return; const base = toBase(store, x.entityId, x.amount, x.currency, d.fx); const n = needsApproval(store, kind, base); if (n.required) { const err = new Error("Needs approval: " + n.reason + ". Request it from the form, an approver then posts it."); err.needsApproval = n; throw err; } }
  function audit(store, e) { if (!Array.isArray(store.audit)) store.audit = []; const row = { id: uid("au"), at: new Date().toISOString(), kind: e.kind || "", action: e.action || "", refKind: e.refKind || null, refId: e.refId || null, entityId: e.entityId || null, by: e.by || who(store) || "", detail: e.detail || null, text: e.text || "" }; store.audit.push(row); if (store.audit.length > 5000) store.audit.splice(0, store.audit.length - 5000); return row; }
  const auditFor = (store, refKind, refId) => (store.audit || []).filter((a) => a.refKind === refKind && a.refId === refId);
  function auditOf(store, opt) { opt = opt || {}; return (store.audit || []).filter((a) => (!opt.by || normU(a.by) === normU(opt.by)) && (!opt.kind || a.kind === opt.kind) && (!opt.entityId || a.entityId === opt.entityId) && (!opt.from || a.at.slice(0, 10) >= opt.from) && (!opt.to || a.at.slice(0, 10) <= opt.to) && (!opt.q || ((a.text || "") + " " + (a.refId || "") + " " + JSON.stringify(a.detail || {})).toLowerCase().includes(String(opt.q).toLowerCase()))).slice().reverse(); }
  const approvalTitle = (store, a) => {
    const ccy = a.currency ? " " + a.currency : ""; const amt = a.amount != null ? fmtMoney(a.amount) + ccy : "";
    if (a.kind === "payment") { if (a.refKind === "bill") { const b = store.bills.find((x) => x.id === a.refId); return "Pay " + (b ? b.ref : "bill") + " · " + amt; } if (a.refKind === "bills") return "Pay " + ((a.payload && a.payload.billIds) || []).length + " bills · " + amt; if (a.refKind === "transfer") { const fb = store.banks.find((x) => x.id === (a.payload && a.payload.fromId)), tb = store.banks.find((x) => x.id === (a.payload && a.payload.toId)); return "Transfer " + (fb ? fb.label : "") + " → " + (tb ? tb.label : "") + " · " + amt; } if (a.refKind === "expense") return (a.payload && a.payload.correctsJournalId ? "Corrected expense · " : "Expense paid · ") + amt + (a.payload && a.payload.category ? " · " + a.payload.category : "") + (a.payload && a.payload.payee ? " to " + a.payload.payee : ""); if (a.refKind === "banktx") return "Bank payment · " + amt + (a.payload && a.payload.payee ? " to " + a.payload.payee : ""); return "Payment · " + amt; }
    if (a.kind === "journal") return "Manual journal · " + amt + (a.payload && a.payload.memo ? " · " + a.payload.memo : "");
    if (a.kind === "close") return (a.refKind === "reopen" ? "Reopen period to " + ((a.payload && a.payload.to) || "the start") : "Close period through " + (a.payload && a.payload.through)) + " · " + (store.entities.find((e) => e.id === a.entityId) || {}).name;
    if (a.kind === "bill-void") { const b = store.bills.find((x) => x.id === a.refId); return "Void " + (b ? b.ref : "bill"); }
    if (a.kind === "invoice-void") { const t = store.trades.find((x) => x.id === a.refId); return "Reset " + (t ? t.ref : "trade") + " to draft (invoice withdrawn)"; }
    if (a.kind === "credit-note") { const i = store.invoices.find((x) => x.id === a.refId); return "Credit note on " + (i ? i.ref : "invoice") + " · " + amt; }
    if (a.kind === "limit-change") return "Change the controls";
    return a.title || a.kind;
  };
  // the exact action, run by the engine once approved (or at once when no approval is needed)
  function execute(store, a) {
    const p = { ...(a.payload || {}), __approved: true };
    switch (a.refKind) {
      case "bill": return { paymentId: payBill(store, p).id };
      case "bills": return payBills(store, p);
      case "banktx": return { txId: bankTransaction(store, p).id };
      case "transfer": transfer(store, p); return { transferred: true };
      case "expense": { if (p.correctsJournalId) reverseJournal(store, p.correctsJournalId, "corrected"); const r = expense(store, p); return { kind: r.kind, txId: r.tx ? r.tx.id : null }; }
      case "journal": return { journalId: journal(store, p).id };
      case "close": return { close: applyClose(store, a.payload, a.lastBy) };
      case "reopen": return { close: applyReopen(store, a.payload, a.lastBy) };
      case "bill-void": return { ref: voidBill(store, a.payload.billId, { __approved: true }) };
      case "invoice-void": undeliverTrade(store, a.payload.tradeId, { __approved: true }); return { tradeId: a.payload.tradeId };
      case "credit-note": return { creditNoteId: creditNote(store, p).id };
      case "remit": return { paymentId: remitOwners(store, p).id };
      case "controls": applyControls(store, a.payload.controls); return { controls: controlsOf(store) };
      default: throw new Error("Unknown approval kind " + a.refKind);
    }
  }
  function requestApproval(store, d) {
    if (!d.kind || !d.refKind) throw new Error("Approval kind required"); const by = d.by || who(store) || ""; if (!by) throw new Error("Who is requesting? Sign in first");
    const base = toBase(store, d.entityId, d.amount, d.currency, d.payload && d.payload.fx); const need = needsApproval(store, d.kind, base); const c = controlsOf(store);
    const a = { id: uid("ap"), kind: d.kind, refKind: d.refKind, refId: d.refId || null, entityId: d.entityId || null, amount: d.amount != null ? r2(+d.amount) : null, currency: d.currency || null, base, requestedBy: by, requestedAt: new Date().toISOString(), approvers: c.approvers.slice(), required: Math.max(1, need.required || 1), decisions: [], status: "pending", payload: d.payload || {}, note: d.note || "", title: "" };
    a.title = d.title || approvalTitle(store, a); if (!Array.isArray(store.approvals)) store.approvals = []; store.approvals.push(a);
    audit(store, { kind: "approval", action: "requested", refKind: a.refKind, refId: a.refId, entityId: a.entityId, by, text: a.title + " — approval requested" + (a.required > 1 ? " (two approvers)" : ""), detail: { approvalId: a.id, amount: a.amount, currency: a.currency } });
    return a;
  }
  // → { executed: true, result } at once, or { approval } when the action waits for someone else
  function submitOrRequest(store, d) {
    const base = toBase(store, d.entityId, d.amount, d.currency, d.payload && d.payload.fx); const need = needsApproval(store, d.kind, base);
    if (!need.required) { const result = execute(store, { refKind: d.refKind, payload: d.payload, lastBy: d.by || who(store) }); return { executed: true, result }; }
    return { approval: requestApproval(store, d), need };
  }
  function decide(store, approvalId, o) {
    const a = (store.approvals || []).find((x) => x.id === approvalId); if (!a) throw new Error("Approval not found"); const by = (o && o.by) || who(store) || ""; if (!by) throw new Error("Who is deciding? Sign in first"); const decision = (o && o.decision) || "approve"; const note = (o && o.note) || "";
    // a rejected request stays as a draft: its preparer resubmits it (optionally with a changed payload) or cancels it
    if (decision === "resubmit") { if (a.status !== "rejected") throw new Error("Only a rejected request can be resubmitted"); if (normU(by) !== normU(a.requestedBy)) throw new Error("Only the person who prepared the request can resubmit it"); if (o && o.payload) a.payload = { ...a.payload, ...o.payload }; if (o && o.amount != null) a.amount = +o.amount; a.status = "pending"; a.round = (a.round || 1) + 1; a.decisions.push({ by, at: new Date().toISOString(), decision, note }); audit(store, { kind: "approval", action: "resubmitted", refKind: a.refKind, refId: a.refId, entityId: a.entityId, by, text: a.title + " — resubmitted" + (note ? ": " + note : ""), detail: { approvalId: a.id } }); return a; }
    if (a.status !== "pending" && !(decision === "cancel" && a.status === "rejected")) throw new Error("This request is already " + a.status);
    const c = controlsOf(store);
    if (decision === "cancel") { if (normU(by) !== normU(a.requestedBy) && !isApprover(store, by)) throw new Error("Only the requester or an approver can cancel a request"); a.status = "cancelled"; a.decisions.push({ by, at: new Date().toISOString(), decision, note }); audit(store, { kind: "approval", action: "cancelled", refKind: a.refKind, refId: a.refId, entityId: a.entityId, by, text: a.title + " — cancelled" + (note ? ": " + note : ""), detail: { approvalId: a.id } }); return a; }
    if (c.preparerCannotApprove && normU(by) === normU(a.requestedBy)) throw new Error("The person who prepared a request cannot approve it (separation of duties)");
    if (!isApprover(store, by)) throw new Error("You are not one of the approvers (" + c.approvers.join(", ") + ")");
    const lastRe = a.decisions.map((x) => x.decision).lastIndexOf("resubmit"); const round = a.decisions.slice(lastRe + 1);
    if (round.some((x) => x.decision === "approve" && normU(x.by) === normU(by))) throw new Error("You have already approved this request; a second approval must come from someone else");
    a.decisions.push({ by, at: new Date().toISOString(), decision, note });
    if (decision === "reject") { a.status = "rejected"; audit(store, { kind: "approval", action: "rejected", refKind: a.refKind, refId: a.refId, entityId: a.entityId, by, text: a.title + " — rejected" + (note ? ": " + note : ""), detail: { approvalId: a.id } }); return a; }
    const approvals = a.decisions.slice(lastRe + 1).filter((x) => x.decision === "approve").length;
    audit(store, { kind: "approval", action: "approved", refKind: a.refKind, refId: a.refId, entityId: a.entityId, by, text: a.title + " — approved" + (a.required > 1 ? " (" + approvals + " of " + a.required + ")" : "") + (note ? ": " + note : ""), detail: { approvalId: a.id } });
    if (approvals < a.required) return a;
    // the final approval posts the action, by the approver, with the whole chain on the journal
    const n0 = store.ledger.length; const prevUser = store.__user; setUser(store, by); let result;
    try { a.lastBy = by; result = execute(store, a); } catch (e) { setUser(store, prevUser); a.decisions.push({ by: "engine", at: new Date().toISOString(), decision: "failed", note: e.message }); audit(store, { kind: "approval", action: "failed", refKind: a.refKind, refId: a.refId, entityId: a.entityId, by, text: a.title + " — posting failed: " + e.message, detail: { approvalId: a.id } }); throw e; }
    setUser(store, prevUser);
    const chain = { id: a.id, requestedBy: a.requestedBy, approvedBy: a.decisions.filter((x) => x.decision === "approve").map((x) => x.by) };
    for (let i = n0; i < store.ledger.length; i++) { const j = store.ledger[i]; j.ref = { ...(j.ref || {}), approval: chain }; }
    a.status = "approved"; a.postedAt = new Date().toISOString(); a.postedBy = by; a.result = result || null;
    audit(store, { kind: "approval", action: "posted", refKind: a.refKind, refId: a.refId, entityId: a.entityId, by, text: a.title + " — posted after approval (requested by " + a.requestedBy + ")", detail: { approvalId: a.id, result } });
    invalidate(store); return a;
  }
  const approvalsFor = (store, refKind, refId) => (store.approvals || []).filter((a) => a.refKind === refKind && a.refId === refId);
  function pendingApprovals(store, opt) { opt = opt || {}; const me = normU(opt.forUser); return (store.approvals || []).filter((a) => a.status === "pending" && (!opt.entityId || a.entityId === opt.entityId) && (!me || (isApprover(store, me) && !(controlsOf(store).preparerCannotApprove && normU(a.requestedBy) === me) && !a.decisions.some((x) => normU(x.by) === me && x.decision === "approve")))).slice().sort((x, y) => (x.requestedAt < y.requestedAt ? 1 : -1)); }
  function approvalsSummary(store, user) { const all = (store.approvals || []); const me = normU(user); return { pendingForMe: pendingApprovals(store, { forUser: user }).length, mine: all.filter((a) => normU(a.requestedBy) === me && a.status === "pending").length, pending: all.filter((a) => a.status === "pending").length, rejected: all.filter((a) => a.status === "rejected" && normU(a.requestedBy) === me).length }; }
  function applyControls(store, c) { const cur = controlsOf(store); const next = { ...cur, ...(c || {}) }; for (const k of ["paymentLimit", "paymentTwoApproversAbove", "journalLimit"]) next[k] = Math.max(0, +next[k] || 0); next.approvers = (Array.isArray(next.approvers) ? next.approvers : String(next.approvers || "").split(/[,;\n]+/)).map((x) => String(x).trim()).filter(Boolean); next.preparerCannotApprove = next.preparerCannotApprove !== false; next.closeRequiresApproval = !!next.closeRequiresApproval; next.voidRequiresApproval = !!next.voidRequiresApproval; next.limitChangeRequiresApproval = next.limitChangeRequiresApproval !== false; store.settings.controls = next; return next; }
  function proposeControls(store, c, by) { by = by || who(store); const need = needsApproval(store, "limit-change", 0); if (need.required) return { approval: requestApproval(store, { kind: "limit-change", refKind: "controls", refId: "controls", by, payload: { controls: c }, title: "Change the controls" }) }; const before = controlsOf(store); const after = applyControls(store, c); audit(store, { kind: "controls", action: "changed", refKind: "controls", refId: "controls", by, text: "Controls changed", detail: { before, after } }); return { executed: true, controls: after }; }
  // ---- period close per entity: the checklist, the close (an approval when so set), the lock, the reopening
  function closeChecklist(store, entityId, through, opt) {
    opt = opt || {}; const e = store.entities.find((x) => x.id === entityId); if (!e) throw new Error("Entity required"); if (!through) throw new Error("Closing date required");
    const items = [];
    const banks = store.banks.filter((b) => b.entityId === e.id && b.type !== "cash"); if (!banks.length) items.push({ key: "recon", label: "Bank accounts reconciled through " + through, ok: true, detail: "no bank accounts" });
    for (const b of banks) { const rs = reconStatus(store, b.id); const rec = store.recon[b.id]; const asOf = rec && rec.asOf ? rec.asOf : null; const ok = !!asOf && asOf >= through && rs.difference != null && Math.abs(rs.difference) < 0.01 && !rs.unmatchedApp.filter((x) => x.date <= through).length; items.push({ key: "recon:" + b.id, label: b.label + " reconciled through " + through, ok, detail: !asOf ? "no statement imported" : asOf < through ? "statement only to " + asOf : rs.difference == null ? "no statement balance" : Math.abs(rs.difference) >= 0.01 ? "difference " + fmtMoney(rs.difference) + " " + b.currency : rs.unmatchedApp.filter((x) => x.date <= through).length ? rs.unmatchedApp.filter((x) => x.date <= through).length + " book entries not on a statement" : "balanced" }); }
    const pend = (store.approvals || []).filter((a) => a.status === "pending" && a.entityId === e.id && ((a.payload && (a.payload.date || a.payload.through)) || a.requestedAt.slice(0, 10)) <= through); items.push({ key: "approvals", label: "No approvals pending in the period", ok: !pend.length, detail: pend.length ? pend.length + " waiting: " + pend.map((a) => a.title).slice(0, 3).join("; ") : "none" });
    const drafts = (store.approvals || []).filter((a) => a.status === "rejected" && a.entityId === e.id && ((a.payload && (a.payload.date || a.payload.through)) || a.requestedAt.slice(0, 10)) <= through); items.push({ key: "drafts", label: "No rejected drafts left in the period", ok: !drafts.length, detail: drafts.length ? drafts.length + " rejected request(s) still open — cancel or resubmit" : "none" });
    const open = store.trades.filter((t) => t.entityId === e.id && t.status === "agreed" && t.deliveryDate <= through).length; items.push({ key: "trades", label: "Trades due for delivery are delivered", ok: !open, warn: true, detail: open ? open + " undelivered trade(s) with a delivery date in the period" : "none" });
    items.push({ key: "vat", label: "VAT return prepared through " + through, ok: !!opt.vatPrepared, manual: true, detail: opt.vatPrepared ? "confirmed" : "tick when the return is prepared" });
    const lock = lockedFor(store, e.id); items.push({ key: "lock", label: "Not already closed", ok: !(lock && lock >= through), detail: lock ? "locked through " + lock : "open" });
    return { entity: e, through, items, ok: items.every((i) => i.ok || i.warn), blocking: items.filter((i) => !i.ok && !i.warn) };
  }
  function applyClose(store, p, by) { const e = store.entities.find((x) => x.id === p.entityId); if (!e) throw new Error("Entity required"); const cur = lockedFor(store, e.id); if (!store.settings.locks) store.settings.locks = {}; store.settings.locks[e.id] = p.through > cur ? p.through : cur; const row = { id: uid("pc"), kind: "close", entityId: e.id, through: p.through, by: by || who(store), at: new Date().toISOString(), note: p.note || "", vatPrepared: !!p.vatPrepared, checklist: (p.checklist || []).map((i) => ({ key: i.key, label: i.label, ok: !!i.ok, detail: i.detail || "" })) }; if (!Array.isArray(store.periodCloses)) store.periodCloses = []; store.periodCloses.push(row); audit(store, { kind: "close", action: "closed", refKind: "entity", refId: e.id, entityId: e.id, by: row.by, text: e.name + " closed through " + p.through, detail: { through: p.through } }); invalidate(store); return row; }
  function applyReopen(store, p, by) { const e = store.entities.find((x) => x.id === p.entityId); if (!e) throw new Error("Entity required"); if (!store.settings.locks) store.settings.locks = {}; const was = store.settings.locks[e.id] || ""; store.settings.locks[e.id] = p.to || ""; const row = { id: uid("pc"), kind: "reopen", entityId: e.id, through: p.to || "", from: was, by: by || who(store), at: new Date().toISOString(), note: p.reason || "" }; if (!Array.isArray(store.periodCloses)) store.periodCloses = []; store.periodCloses.push(row); audit(store, { kind: "close", action: "reopened", refKind: "entity", refId: e.id, entityId: e.id, by: row.by, text: e.name + " reopened" + (p.to ? " to " + p.to : "") + (was ? " (was locked through " + was + ")" : "") + (p.reason ? ": " + p.reason : ""), detail: { from: was, to: p.to || "" } }); invalidate(store); return row; }
  function closePeriod(store, d) {
    const cl = closeChecklist(store, d.entityId, d.through, { vatPrepared: d.vatPrepared }); if (cl.blocking.length && !d.force) throw new Error("Not ready to close: " + cl.blocking.map((i) => i.label + " (" + i.detail + ")").join("; "));
    const payload = { entityId: d.entityId, through: d.through, note: d.note || "", vatPrepared: !!d.vatPrepared, checklist: cl.items };
    if (!d.__approved) { const need = needsApproval(store, "close", 0); if (need.required) return { approval: requestApproval(store, { kind: "close", refKind: "close", refId: d.entityId, entityId: d.entityId, by: d.by, payload }) }; }
    return { close: applyClose(store, payload, d.by) };
  }
  function reopenPeriod(store, d) {
    const e = store.entities.find((x) => x.id === d.entityId); if (!e) throw new Error("Entity required"); if (!d.reason) throw new Error("A reason is required to reopen a closed period");
    const payload = { entityId: d.entityId, to: d.to || "", reason: d.reason };
    if (!d.__approved) { const need = needsApproval(store, "reopen", 0); if (need.required) return { approval: requestApproval(store, { kind: "close", refKind: "reopen", refId: d.entityId, entityId: d.entityId, by: d.by, payload }) }; }
    return { close: applyReopen(store, payload, d.by) };
  }
  // "Who did what" for one document: creation and edits on the record, every journal that refers to it, payments, approvals, audit lines
  function whoDidWhat(store, refKind, refId) {
    const out = []; const push = (at, by, what, extra) => { if (!at && !what) return; out.push({ at: at || "", by: by || "", what, ...(extra || {}) }); };
    const recs = { trade: store.trades, cargo: store.cargoes, invoice: store.invoices, bill: store.bills, cp: store.counterparties, vessel: store.vessels, entity: store.entities, payment: store.payments, banktx: store.bankTx, journal: store.ledger };
    const rec = (recs[refKind] || []).find((x) => x.id === refId);
    if (rec) { push(rec.createdAt || rec.date || "", rec.createdBy || rec.by || "", "created" + (rec.ref ? " " + rec.ref : "")); if (rec.updatedAt || rec.updatedBy) push(rec.updatedAt || "", rec.updatedBy || "", "last edited"); }
    const refMatch = (j) => { const r = j.ref || {}; if (refKind === "trade") return r.tradeId === refId; if (refKind === "cargo") return r.cargoId === refId; if (refKind === "invoice") return r.invoiceId === refId; if (refKind === "bill") return r.billId === refId; if (refKind === "payment") return r.paymentId === refId; if (refKind === "banktx") return r.txId === refId; if (refKind === "journal") return j.id === refId || r.of === refId; if (refKind === "cp") return r.counterpartyId === refId; return false; };
    for (const j of store.ledger) if (refMatch(j)) push(j.at || j.date, j.by, (j.reversedBy ? "posted (later reversed) " : "posted ") + j.memo, { journalId: j.id, approval: j.ref && j.ref.approval ? j.ref.approval : null });
    if (refKind === "bill" || refKind === "invoice") for (const p of store.payments) if ((refKind === "bill" ? p.billId : p.invoiceId) === refId) push(p.at || p.date, p.by || "", (p.reversed ? "payment reversed " : "payment ") + fmtMoney(p.amount) + " " + p.currency, { paymentId: p.id });
    for (const a of (store.approvals || [])) if (a.refKind === refKind && a.refId === refId) { push(a.requestedAt, a.requestedBy, "requested approval: " + a.title, { approvalId: a.id }); for (const d of a.decisions) push(d.at, d.by, d.decision + (d.note ? ": " + d.note : ""), { approvalId: a.id }); }
    for (const a of auditFor(store, refKind, refId)) if (a.kind !== "approval") push(a.at, a.by, a.text || a.action, { auditId: a.id });
    return out.sort((x, y) => (x.at < y.at ? -1 : x.at > y.at ? 1 : 0));
  }
  return { newStore, migrate, seedDemo, uid, today, addDays, daysBetween, r2, sum, avg, by, vatOf, vatLabel,
    // 4.16 controls
    lockedFor, controlsOf, toBase, needsApproval, requestApproval, submitOrRequest, decide, approvalsFor, pendingApprovals, approvalsSummary, approvalTitle, applyControls, proposeControls, closeChecklist, closePeriod, reopenPeriod, audit, auditFor, auditOf, whoDidWhat, isApprover,
    addEntity, addBank, fundBank, transfer, bankTransaction, addFuturesAccount, fundFutures, addCounterparty, addVessel, linkVessel, unlinkVessel, addProduct, addContract,
    addCargo, receiveCargo, recordCargoLoss, cargoStatus, cargoUnitCost, addTrade, deliverTrade, cancelTrade, allocateTrade, addTradeEvent, tradeStage, tradeMargin,
    receivePayment, payBill, creditNote, docStatus, docOpen, openFutures, closeFutures, markContract, futuresAccountView, futPnl,
    screenSubject, recordScreening, complianceStatus, autoScreen, rescreenStale, rescreenAll, lookup, bankBalance, bankBalanceBase, entityStatements, counterpartyProfile, priceSeries, positions, cashForecast, statementOfAccount,
    // 4.19 · the money model: two posting models per vessel, allocations, on account, owners
    revKindOf, vesselModel, setVesselAccounting, setVesselEntity, vesselEntity, postingFor, checkAllocations, receivePayments, applyOnAccount, onAccountOpen, remitOwners, ownersAccount,
    journal, ACCOUNTS, ACCOUNT_META, accountMeta, customAccounts, addAccount, fxRateOn, autoFx, addFxDay, refreshGroupFx, cashTimeline, setUser, addB2bPurchase, tagVessel, tagVoyage, vesselLedger, repairBooks, editTrade, undeliverTrade, deleteTrade, editInvoice, editBill, voidBill, reversePayment, payBills, fxRate, applyFxRates, unassignedCash, assignCashLine, editCargo, unreceiveCargo, einvoiceCheck, einvoicePayload, einvoiceRecord, removeDemo, hasDemo, addPerson, salesReport, UNITS, unitOf, accountsOverview, ledgerLines, expense, expenseLines, reverseJournal, journalEditable, invalidate, addAttachment, removeAttachment, attachmentsFor, transferCargo, internalCp, closeYear, lastClose, management, bankEntries, parseCSV, parseAmount, parseDate, importStatement, autoMatch, matchLine, reconStatus, analyzeTrade, analyzeCargo, insights, entityAvgMargin, report, toCSV, subName, filterTrades, filterCargoes, tradeChain, workflow, agenda, performance, productLines, productMT, tradeValue, lineQty, lineNet, fmtMoney, fmtQty, fmtPct, verify, post, vesselOfJournal };
});
