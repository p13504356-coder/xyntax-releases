/* XYNTAX PROSHIP · the owners' Statement of accounts (4.31.14). Pure: the per-vessel statement rows (built by PSE.ownerStatementRows
 * from the book, carried whole in the portal snapshot) and a filter in, the seven parts out — opening balance, receipts from
 * charterers (applied / on account), invoices issued (received, outstanding, overdue), income earned per voyage or charter, expenses
 * for the owners' account (fees included), paid out to the owners, closing balance with a one-line reconciliation. The desktop
 * (PSE.ownerStatement) and the portal call the same compute(), so the same filters give the same totals by construction.
 * This file is loaded by the app (src/) and, byte-identical, by the portal (portal/owner-statement.js); a test keeps them equal.
 * Row kinds (amounts already in the statement currency): i invoice · n income line · r receipt · e expense · m remittance. */
(function (root, factory) { const api = factory(); if (typeof module !== "undefined" && module.exports) module.exports = api; root.OwnerStatement = api; })(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  const r2 = (n) => Math.round((+n || 0) * 100) / 100;
  const sum = (a, f) => r2(a.reduce((k, x) => k + (f ? +f(x) || 0 : +x || 0), 0));
  const DAY = 86400000; const dayN = (s) => Date.parse(String(s).slice(0, 10) + "T00:00:00Z");
  const GROSS = ["hire", "freight", "ballastBonus", "deadfreight", "demurrage", "despatch", "awrp", "claims", "other"];
  const KIND = { hire: "Hire", freight: "Freight", ballastBonus: "Ballast bonus", deadfreight: "Deadfreight", demurrage: "Demurrage", despatch: "Despatch", awrp: "AWRP", claims: "Claims", other: "Other income", commission: "Commissions", offhire: "Off-hire", credit: "Credit notes", income: "Other income" };
  const fmtMoney = (n, c) => { const v = r2(n); const s = Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); return (c ? c + " " : "") + (v < 0 ? "-" : "") + s; };
  const fmtDate = (s) => { if (!s) return ""; const d = new Date(String(s).slice(0, 10) + "T00:00:00Z"); return isNaN(d) ? String(s) : d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }); };
  // the period presets both pages offer: YTD, last quarter (the previous calendar quarter), last 12 months, all time, custom
  const PERIODS = [["ytd", "YTD"], ["lastq", "Last quarter"], ["12m", "Last 12 months"], ["all", "All time"], ["custom", "Custom"]];
  function period(key, today, from, to) {
    const t = String(today || new Date().toISOString()).slice(0, 10); const y = +t.slice(0, 4), m = +t.slice(5, 7);
    if (key === "ytd") return { from: y + "-01-01", to: t };
    if (key === "lastq") { const q = Math.floor((m - 1) / 3); const qy = q === 0 ? y - 1 : y, qs = q === 0 ? 10 : (q - 1) * 3 + 1; const end = new Date(Date.UTC(qy, qs + 2, 0)).toISOString().slice(0, 10); return { from: qy + "-" + String(qs).padStart(2, "0") + "-01", to: end }; }
    if (key === "12m") { const d = new Date(t + "T00:00:00Z"); d.setUTCFullYear(d.getUTCFullYear() - 1); d.setUTCDate(d.getUTCDate() + 1); return { from: d.toISOString().slice(0, 10), to: t }; }
    if (key === "custom") return { from: from || null, to: to || t };
    return { from: null, to: null };
  }
  // the choices a page offers for the vessels picked: voyages, charters and charterers that occur in the rows
  function options(stmts, vesselIds) {
    const set = vesselIds && vesselIds.length ? new Set(vesselIds) : null; const voy = [], fix = [], cps = new Set();
    for (const s of stmts || []) { if (!s || (set && !set.has(s.vesselId))) continue; const multi = !set || set.size !== 1;
      for (const [id, v] of Object.entries(s.voyages || {})) voy.push({ id, label: (multi ? s.vessel + " · " : "") + v.label, no: v.no });
      for (const [id, f] of Object.entries(s.fixtures || {})) fix.push({ id, label: (multi ? s.vessel + " · " : "") + f.label });
      for (const r of s.rows || []) if ((r.t === "i" || r.t === "r" || r.t === "n") && r.cp) cps.add(r.cp); }
    return { voyages: voy.sort((a, b) => String(b.no || "").localeCompare(String(a.no || ""), undefined, { numeric: true })), fixtures: fix, charterers: [...cps].sort() };
  }
  // compute(statements, { vesselIds, from, to, voyageId, fixtureId, cp, now }) → the statement as plain data
  function compute(stmts, f) {
    f = f || {}; const today = String(f.now || new Date().toISOString()).slice(0, 10); const from = f.from || null, to = f.to || null;
    const endD = to && to < today ? to : today; const asOf = endD; const set = f.vesselIds && f.vesselIds.length ? new Set(f.vesselIds) : null;
    const list = (stmts || []).filter((s) => s && (!set || set.has(s.vesselId)));
    const inP = (d) => (!from || d >= from) && (!to || d <= to); const before = (d) => !!from && d < from; const upTo = (d) => d <= endD;
    const currency = (list[0] || {}).currency || "USD"; const books = [...new Set(list.map((s) => s.bookCurrency).filter((c) => c && c !== currency))];
    const out = { currency, from, to, asOf, generatedAt: f.now || new Date().toISOString(), filters: { vesselIds: list.map((s) => s.vesselId), voyageId: f.voyageId || null, fixtureId: f.fixtureId || null, cp: f.cp || null },
      vessels: list.map((s) => ({ id: s.vesselId, name: s.vessel, owner: s.owner || "", manager: s.manager || "", model: s.model || "" })), fx: { bookCurrencies: books, rates: list.filter((s) => s.bookCurrency && s.bookCurrency !== currency).map((s) => ({ vessel: s.vessel, from: s.bookCurrency, rate: s.rate, date: s.rateDate })), unconverted: list.some((s) => s.unconverted) } };
    const rec = [], apps = [], invs = [], inc = [], exp = [], rem = []; const onAcc = {}; let opening = 0;
    const cum = { earned: 0, expenses: 0, remitted: 0, outstanding: 0, onAccount: 0, vat: 0 };
    for (const s of list) {
      const vy = s.voyages || {}, fx = s.fixtures || {}; const voyOf = (r) => (r.vy && vy[r.vy]) || null; const fixOf = (r) => (r.fx && fx[r.fx]) || (voyOf(r) && voyOf(r).fx && fx[voyOf(r).fx]) || null;
      const where = (r) => { const v = voyOf(r), x = fixOf(r); return [v ? v.label : "", x && !v ? x.label : ""].filter(Boolean).join(" · "); };
      const scope = (r) => (!f.voyageId || r.vy === f.voyageId) && (!f.fixtureId || r.fx === f.fixtureId || (voyOf(r) && voyOf(r).fx === f.fixtureId));
      const cpOk = (r) => !f.cp || ((r.t === "e" || r.t === "m") ? !!(fixOf(r) && fixOf(r).cp === f.cp) : r.cp === f.cp); /* a charterer's view: his receipts, invoices and income, and the costs of the voyages under his charters */
      const base = (r) => ({ vesselId: s.vesselId, vessel: s.vessel, date: r.d, ref: r.ref || "", counterparty: r.cp || "", voyageId: r.vy || null, fixtureId: r.fx || null, where: where(r) });
      for (const r of s.rows || []) {
        if (!scope(r) || !cpOk(r)) continue;
        if (r.t === "r") { if (before(r.d)) opening = r2(opening + r.a);
          if (inP(r.d)) rec.push({ ...base(r), amount: r.a, settles: r.k || (r.oa ? "On account" : ""), invoiceRef: r.inv || "", onAccount: !!r.oa, applied: r.oa ? sum((r.ap || []).filter((x) => upTo(x[0])), (x) => x[1]) : r.a, other: !!r.bank });
          if (r.oa) { for (const x of r.ap || []) if (inP(x[0])) apps.push({ ...base(r), date: x[0], amount: x[1], invoiceRef: x[2] || "", receiptDate: r.d, receiptRef: r.ref || "" });
            if (upTo(r.d)) { const open = r2(r.a - sum((r.ap || []).filter((x) => upTo(x[0])), (x) => x[1])); if (Math.abs(open) > 0.005) { const k = r.cp || "—"; onAcc[k] = r2((onAcc[k] || 0) + open); cum.onAccount = r2(cum.onAccount + open); } } } }
        else if (r.t === "i") { const received = sum((r.p || []).filter((x) => upTo(x[0])), (x) => x[1]), credited = sum((r.c || []).filter((x) => upTo(x[0])), (x) => x[1]); const outstanding = upTo(r.d) ? r2(r.a - received - credited) : 0;
          if (upTo(r.d)) { cum.outstanding = r2(cum.outstanding + outstanding); cum.vat = r2(cum.vat + (+r.v || 0)); }
          const listed = inP(r.d) || (before(r.d) && outstanding > 0.005);
          if (listed) { const od = outstanding > 0.005 && r.due && r.due < asOf ? Math.round((dayN(asOf) - dayN(r.due)) / DAY) : 0; invs.push({ ...base(r), what: r.k || "", due: r.due || "", amount: r.a, received, credited, outstanding, overdueDays: od, broughtForward: !inP(r.d), status: outstanding < 0.01 ? (credited > 0.005 && received < 0.005 ? "credited" : "paid") : od > 0 ? "overdue" : received > 0.005 || credited > 0.005 ? "part-paid" : "open" }); } }
        else if (r.t === "n") { if (upTo(r.d)) cum.earned = r2(cum.earned + r.a); if (inP(r.d)) inc.push({ ...base(r), kind: r.k, amount: r.a, estimated: !!((voyOf(r) && voyOf(r).open) || (!voyOf(r) && fixOf(r) && fixOf(r).open)) }); }
        else if (r.t === "e") { if (before(r.d)) opening = r2(opening - r.a); if (upTo(r.d) && !r.fee) cum.expenses = r2(cum.expenses + r.a); /* the manager's fee never reaches the owners' account: it is revenue when invoiced */
          if (inP(r.d)) { const paid = r.bank ? r.a : sum((r.p || []).filter((x) => upTo(x[0])), (x) => x[1]); exp.push({ ...base(r), category: r.k || "", description: r.memo || "", port: r.port || "", amount: r.a, paid, payable: r2(r.a - paid), fee: !!r.fee, doc: r.doc || null, status: r.bank ? "paid" : r2(r.a - paid) < 0.01 ? "paid" : paid > 0.005 ? "part-paid" : "payable" }); } }
        else if (r.t === "m") { if (before(r.d)) opening = r2(opening - r.a); if (upTo(r.d)) cum.remitted = r2(cum.remitted + r.a); if (inP(r.d)) rem.push({ ...base(r), description: r.memo || "", amount: r.a }); }
      }
    }
    const byDate = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : String(a.ref).localeCompare(String(b.ref)));
    const running = (arr, k) => { let run = 0; for (const x of arr.sort(byDate)) { run = r2(run + (k ? x[k] : x.amount)); x.running = run; } return arr; };
    running(rec); running(apps); running(invs, "outstanding"); running(exp); running(rem);
    // income per voyage / charter: gross by kind, less commissions and off-hire, credit notes, = net; "Est." while the voyage or charter is open
    const groups = new Map(); for (const l of inc.sort(byDate)) { const key = l.vesselId + "|" + (l.voyageId || (l.fixtureId ? "fx:" + l.fixtureId : "none")); const g = groups.get(key) || { key, vesselId: l.vesselId, vessel: l.vessel, voyageId: l.voyageId, fixtureId: l.fixtureId, where: l.where || "Not tied to a voyage", from: l.date, to: l.date, gross: {}, grossTotal: 0, commission: 0, offhire: 0, credit: 0, net: 0, estimated: false, lines: [] }; groups.set(key, g);
      g.to = l.date; g.lines.push(l); if (l.estimated) g.estimated = true; if (l.kind === "commission") g.commission = r2(g.commission + l.amount); else if (l.kind === "offhire") g.offhire = r2(g.offhire + l.amount); else if (l.kind === "credit") g.credit = r2(g.credit + l.amount); else { g.gross[l.kind] = r2((g.gross[l.kind] || 0) + l.amount); g.grossTotal = r2(g.grossTotal + l.amount); } g.net = r2(g.net + l.amount); }
    const income = [...groups.values()].sort((a, b) => (a.from < b.from ? -1 : 1)); { let run = 0; for (const g of income) { run = r2(run + g.net); g.running = run; } }
    const onAccountByCp = Object.entries(onAcc).map(([cp, amount]) => ({ counterparty: cp, amount })).sort((a, b) => b.amount - a.amount);
    out.opening = r2(opening);
    out.receipts = { lines: rec, total: sum(rec, (x) => x.amount), applied: sum(rec.filter((x) => !x.onAccount), (x) => x.amount), onAccount: sum(rec.filter((x) => x.onAccount), (x) => x.amount), applications: apps, appliedFromAccount: sum(apps, (x) => x.amount), onAccountByCp, onAccountOpen: sum(onAccountByCp, (x) => x.amount) };
    out.invoices = { lines: invs, issued: sum(invs.filter((x) => !x.broughtForward), (x) => x.amount), received: sum(invs, (x) => x.received), outstanding: sum(invs, (x) => x.outstanding), overdue: sum(invs.filter((x) => x.overdueDays > 0), (x) => x.outstanding), count: invs.length, open: invs.filter((x) => x.outstanding > 0.005).length };
    const gk = {}; for (const g of income) for (const [k, v] of Object.entries(g.gross)) gk[k] = r2((gk[k] || 0) + v);
    out.income = { groups: income, gross: gk, grossTotal: sum(income, (g) => g.grossTotal), commission: sum(income, (g) => g.commission), offhire: sum(income, (g) => g.offhire), credit: sum(income, (g) => g.credit), net: sum(income, (g) => g.net), estimated: income.some((g) => g.estimated) };
    out.expenses = { lines: exp, total: sum(exp, (x) => x.amount), fees: sum(exp.filter((x) => x.fee), (x) => x.amount), paid: sum(exp, (x) => x.paid), payable: sum(exp, (x) => x.payable) };
    out.remittances = { lines: rem, total: sum(rem, (x) => x.amount) };
    out.closing = r2(out.opening + out.receipts.total - out.expenses.total - out.remittances.total);
    // the books: the owners' account (income earned less expenses and remittances, to the period end) less what charterers still owe,
    // plus money held on account (plus VAT collected) — the money held must equal the closing balance
    const ownersAccount = r2(cum.earned - cum.expenses - cum.remitted); const held = r2(ownersAccount - cum.outstanding + cum.onAccount + cum.vat);
    out.reconciliation = { opening: out.opening, receipts: out.receipts.total, expenses: out.expenses.total, remittances: out.remittances.total, closing: out.closing, ownersAccount, earned: cum.earned, expensesToDate: cum.expenses, remittedToDate: cum.remitted, outstanding: cum.outstanding, onAccount: cum.onAccount, vat: cum.vat, held, difference: r2(out.closing - held), reconciled: Math.abs(out.closing - held) < 0.05,
      text: fmtMoney(out.opening, currency) + " opening + " + fmtMoney(out.receipts.total, currency) + " received − " + fmtMoney(out.expenses.total, currency) + " expenses − " + fmtMoney(out.remittances.total, currency) + " paid out = " + fmtMoney(out.closing, currency) + " closing",
      booksText: "Owners' account per the books (income earned " + fmtMoney(cum.earned, currency) + " − expenses " + fmtMoney(cum.expenses, currency) + " − paid out " + fmtMoney(cum.remitted, currency) + ") " + fmtMoney(ownersAccount, currency) + " − invoices outstanding " + fmtMoney(cum.outstanding, currency) + " + held on account " + fmtMoney(cum.onAccount, currency) + (Math.abs(cum.vat) > 0.005 ? " + VAT collected " + fmtMoney(cum.vat, currency) : "") + " = " + fmtMoney(held, currency) + (Math.abs(out.closing - held) < 0.05 ? " · reconciled" : " · difference " + fmtMoney(out.closing - held, currency)) };
    out.totals = { opening: out.opening, received: out.receipts.total, receivedApplied: out.receipts.applied, receivedOnAccount: out.receipts.onAccount, onAccountOpen: out.receipts.onAccountOpen, invoiced: out.invoices.issued, outstanding: out.invoices.outstanding, overdue: out.invoices.overdue, incomeGross: out.income.grossTotal, incomeNet: out.income.net, expenses: out.expenses.total, fees: out.expenses.fees, remitted: out.remittances.total, closing: out.closing };
    return out;
  }
  const fxNote = (res) => { const fx = res.fx || {}; const parts = []; if (fx.rates && fx.rates.length) parts.push("Shown in " + res.currency + " · " + fx.rates.map((r) => r.vessel + " is kept in " + r.from + ", converted at " + (+r.rate).toLocaleString("en-US", { maximumFractionDigits: 6 }) + " (closing rate " + fmtDate(r.date) + ")").join("; ")); else parts.push("All amounts in " + res.currency + "."); if (fx.unconverted) parts.push("Some amounts had no exchange rate on file and are shown as booked."); return parts.join(" "); };
  const scopeText = (res, labels) => { labels = labels || {}; const p = res.from || res.to ? (res.from ? fmtDate(res.from) : "start") + " – " + fmtDate(res.to || res.asOf) : "All time to " + fmtDate(res.asOf); const bits = [p]; if (res.filters.voyageId) bits.push(labels.voyage || "one voyage"); if (res.filters.fixtureId) bits.push(labels.fixture || "one charter"); if (res.filters.cp) bits.push("charterer " + res.filters.cp); return bits.join(" · "); };
  // the printed statement (one currency): the same model DOCS.vesselReport prints on the desktop and the portal prints itself
  function report(res, opt) {
    opt = opt || {}; const c = res.currency; const M = (n) => fmtMoney(n, c); const vs = res.vessels; const vName = vs.length === 1 ? vs[0].name : vs.length + " vessels · " + vs.map((v) => v.name).join(", ");
    const owners = [...new Set(vs.map((v) => v.owner).filter(Boolean))].join(", "); const managers = [...new Set(vs.map((v) => v.manager).filter(Boolean))].join(", "); const multi = vs.length > 1; const V = (x) => (multi ? [x.vessel] : []);
    const recRows = res.receipts.lines.map((x) => [fmtDate(x.date), ...V(x), x.counterparty, x.ref, x.settles + (x.invoiceRef ? " · " + x.invoiceRef : ""), x.where, x.onAccount ? "on account" : x.other ? "other income" : "applied", M(x.amount), M(x.running)]);
    const invRows = res.invoices.lines.map((x) => [x.ref, ...V(x), x.counterparty, x.what, x.where, fmtDate(x.date), fmtDate(x.due), M(x.amount), M(x.received), M(x.outstanding), x.overdueDays ? x.overdueDays + " d" : ""]);
    const incRows = res.income.groups.map((g) => [...V(g), g.where + (g.estimated ? " (Est.)" : ""), M(g.grossTotal), M(g.commission), M(g.offhire), M(g.credit), M(g.net)]);
    const expRows = res.expenses.lines.map((x) => [fmtDate(x.date), ...V(x), x.counterparty, x.ref, x.category + (x.description && x.description !== x.category ? " · " + x.description : ""), [x.where, x.port].filter(Boolean).join(" · "), M(x.amount), x.status]);
    const remRows = res.remittances.lines.map((x) => [fmtDate(x.date), ...V(x), x.ref, x.description, M(x.amount), M(x.running)]);
    const vh = multi ? ["Vessel"] : [];
    return { kind: "ownerStatement", title: "Statement of accounts", subtitle: vName + " · " + scopeText(res, opt.labels), currency: c,
      meta: [["Vessel" + (multi ? "s" : ""), vName], owners ? ["Owner" + (owners.includes(",") ? "s" : ""), owners] : null, managers ? ["Commercial manager", managers] : null, ["Period", scopeText(res, opt.labels)], ["Generated", String(res.generatedAt).replace("T", " ").slice(0, 16) + " UTC"], ["Currency", c], ["Opening balance", M(res.opening)], ["Closing balance", M(res.closing)]].filter(Boolean),
      sections: [
        { heading: "1 · Opening balance", text: "Held for the owners at the period start (all earlier receipts less expenses and remittances): " + M(res.opening) + "." },
        { heading: "2 · Receipts from charterers", table: { cols: ["Date", ...vh, "Charterer", "Reference", "Settles", "Voyage / charter", "How", "Amount", "Running"], rows: recRows, totals: [["Applied to invoices", M(res.receipts.applied)], ["Received on account", M(res.receipts.onAccount)], ["Total received", M(res.receipts.total)]] } },
        res.receipts.applications.length ? { heading: "On-account money applied in the period", table: { cols: ["Date", ...vh, "Charterer", "Receipt", "Applied to", "Amount"], rows: res.receipts.applications.map((x) => [fmtDate(x.date), ...V(x), x.counterparty, x.receiptRef + " of " + fmtDate(x.receiptDate), x.invoiceRef, M(x.amount)]) } } : null,
        { heading: "On account, not yet applied, at " + fmtDate(res.asOf), table: res.receipts.onAccountByCp.length ? { cols: ["Charterer", "Amount"], rows: res.receipts.onAccountByCp.map((x) => [x.counterparty, M(x.amount)]), totals: [["Total on account", M(res.receipts.onAccountOpen)]] } : null, text: res.receipts.onAccountByCp.length ? null : "Nothing held on account." },
        { heading: "3 · Invoices issued", table: { cols: ["Invoice", ...vh, "Charterer", "What", "Voyage / charter", "Issued", "Due", "Amount", "Received", "Outstanding", "Overdue"], rows: invRows, totals: [["Issued in the period", M(res.invoices.issued)], ["Pending (outstanding)", M(res.invoices.outstanding)], ["Of which overdue", M(res.invoices.overdue)]] } },
        { heading: "4 · Income earned" + (res.income.estimated ? " (Est. = voyage or charter still open)" : ""), table: { cols: [...vh, "Voyage / charter", "Gross", "Commissions", "Off-hire", "Credit notes", "Net"], rows: incRows, totals: [["Net income", M(res.income.net)]] } },
        { heading: "5 · Expenses for the owners' account", table: { cols: ["Date", ...vh, "Supplier", "Reference", "Category", "Voyage / port", "Amount", "Status"], rows: expRows, totals: [["Of which management fees and commissions kept", M(res.expenses.fees)], ["Still payable to suppliers", M(res.expenses.payable)], ["Total expenses", M(res.expenses.total)]] } },
        { heading: "6 · Paid out to the owners", table: { cols: ["Date", ...vh, "Reference", "Bank text", "Amount", "Running"], rows: remRows, totals: [["Total paid out", M(res.remittances.total)]] } },
        { heading: "7 · Closing balance", text: res.reconciliation.text + ". " + (res.closing >= 0 ? "Held for the owners." : "Due from the owners.") + " " + res.reconciliation.booksText + "." },
        { heading: "Currency", text: fxNote(res) }].filter(Boolean) };
  }
  // CSV: one row per line of every part, then the totals — what the page shows, in the statement currency
  function csv(res) {
    const c = res.currency; const head = ["Part", "Vessel", "Date", "Reference", "Counterparty", "Voyage / charter", "Description", "Due", "Amount " + c, "Received / paid " + c, "Outstanding " + c, "Running " + c]; const rows = [head];
    rows.push(["Opening balance", "", res.from || "", "", "", "", "Held for the owners at the period start", "", res.opening, "", "", res.opening]);
    for (const x of res.receipts.lines) rows.push(["Receipt", x.vessel, x.date, x.ref, x.counterparty, x.where, (x.onAccount ? "On account" : x.other ? "Other income" : "Applied") + (x.settles ? " · " + x.settles : "") + (x.invoiceRef ? " · " + x.invoiceRef : ""), "", x.amount, x.applied, x.onAccount ? r2(x.amount - x.applied) : "", x.running]);
    for (const x of res.receipts.applications) rows.push(["On account applied", x.vessel, x.date, x.receiptRef, x.counterparty, x.where, "Applied to " + x.invoiceRef, "", x.amount, "", "", x.running]);
    for (const x of res.receipts.onAccountByCp) rows.push(["On account at period end", "", res.asOf, "", x.counterparty, "", "Not yet applied", "", x.amount, "", x.amount, ""]);
    for (const x of res.invoices.lines) rows.push(["Invoice", x.vessel, x.date, x.ref, x.counterparty, x.where, x.what + (x.overdueDays ? " · overdue " + x.overdueDays + " d" : "") + (x.broughtForward ? " · brought forward" : ""), x.due, x.amount, x.received, x.outstanding, x.running]);
    for (const g of res.income.groups) rows.push(["Income", g.vessel, g.to, "", "", g.where, "Gross " + g.grossTotal + " · commissions " + g.commission + " · off-hire " + g.offhire + " · credit notes " + g.credit + (g.estimated ? " · Est." : ""), "", g.net, "", "", g.running]);
    for (const x of res.expenses.lines) rows.push(["Expense", x.vessel, x.date, x.ref, x.counterparty, [x.where, x.port].filter(Boolean).join(" · "), x.category + (x.description && x.description !== x.category ? " · " + x.description : ""), "", x.amount, x.paid, x.payable, x.running]);
    for (const x of res.remittances.lines) rows.push(["Paid to owners", x.vessel, x.date, x.ref, x.counterparty, "", x.description, "", x.amount, "", "", x.running]);
    rows.push(["Closing balance", "", res.to || res.asOf, "", "", "", res.reconciliation.text, "", res.closing, "", "", res.closing]);
    return rows;
  }
  const csvText = (rows) => rows.map((r) => r.map((v) => { const s = v == null ? "" : String(v); return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(",")).join("\r\n");
  return { compute, period, options, report, csv, csvText, fxNote, scopeText, fmtMoney, fmtDate, PERIODS, KIND, GROSS, r2 };
});
