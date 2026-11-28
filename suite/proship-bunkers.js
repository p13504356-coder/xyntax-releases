/* XYNTAX PROSHIP — bunkers per day (4.19, item 6). Pure: no DOM; runs in Node (tests) and in the renderer as window.PSB.
 * PSB.dailyBunkerCost(ps, store, voyageId, { now }) — what the vessel burnt on each day of a voyage and what it cost, from the
 * noon reports (consumption per grade) priced FIFO against the bunkers actually bought: a stem with a vendor bill is priced at the
 * invoiced price (bill net / quantity), a stem without one at its stem price, the opening stock as PSE.bunkerStock has it. A noon
 * report covering more than 36 hours is spread over the days it covers (source "interpolated"); the rest is "noon". */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./proship-engine.js"));
  else root.PSB = factory(root.PSE);
})(typeof self !== "undefined" ? self : this, function (PSE) {
  const MIN = 60000, DAYM = 1440; const r2 = (n) => Math.round((+n || 0) * 100) / 100, r4 = (n) => Math.round((+n || 0) * 10000) / 10000;
  const parse = (s) => (PSE && PSE.parse ? PSE.parse(s) : Date.parse(s)); const sum = (a, f) => a.reduce((k, x) => k + (f ? f(x) : x), 0);
  const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10); const isoMin = (ms) => new Date(ms).toISOString().slice(0, 16);
  // the invoiced price of a stem: its bill's net over the stem quantity when the bill is for that stem alone (within 2 %), else the bill's unit price if it names one
  function invoicedPrice(store, ev) {
    if (!ev || !ev.billId || !store || !Array.isArray(store.bills)) return null; const b = store.bills.find((x) => x.id === ev.billId); if (!b || !(+ev.qty > 0)) return null;
    const net = +b.net || +b.amount || 0; if (!(net > 0)) return null; const unit = r2(net / +ev.qty); const stemCost = (+ev.price || 0) * +ev.qty;
    if (!stemCost || Math.abs(net - stemCost) / stemCost <= 0.25) return unit; /* the bill is the stem (price differs a little: quantity actually delivered, barging) */
    const line = (b.lines || []).find((l) => /vlsfo|hsfo|lsmgo|mgo|ifo|lng|fuel|bunker/i.test(l.label || l.description || "") && +l.qty); if (line && +line.qty) return r2((+line.amount || +line.price * +line.qty) / +line.qty);
    return null;
  }
  // FIFO layers per grade from the vessel's bunker events (receipts priced as invoiced when a bill exists), consumption priced as drawn
  function walk(ps, store, vesselId, untilMs) {
    const events = PSE && PSE.bunkerEvents ? PSE.bunkerEvents(ps, vesselId) : []; const layers = {}; const lastPrice = {}; const consumed = [];
    const draw = (g, qty) => { const L = layers[g] || (layers[g] = []); let left = qty, cost = 0; while (left > 0.0005 && L.length) { const l = L[0]; const take = Math.min(left, l.qty); cost += take * l.price; l.qty = r4(l.qty - take); left = r4(left - take); if (l.qty <= 0.0005) L.shift(); } if (left > 0.0005) cost += left * (lastPrice[g] || 0); return r2(cost); };
    for (const e of events) { const t = parse(e.at); if (!isNaN(untilMs) && t > untilMs) break; const g = e.grade || "";
      if (e.kind === "receipt") { const inv = invoicedPrice(store, e); const price = inv != null ? inv : +e.price || 0; (layers[g] || (layers[g] = [])).push({ qty: +e.qty, price, at: e.at, invoiced: inv != null, billId: e.billId || null, port: e.port || "", source: e.source }); if (price) lastPrice[g] = price; }
      else if (e.kind === "consumption" || e.kind === "out") { const cost = draw(g, +e.qty); consumed.push({ ...e, cost, unitCost: +e.qty ? r2(cost / +e.qty) : 0 }); }
      else if (e.kind === "survey") { const have = r4(sum(layers[g] || [], (l) => l.qty)); const diff = r4(have - +e.qty); if (diff > 0.0005) { const cost = draw(g, diff); consumed.push({ ...e, kind: "consumption", qty: diff, cost, unitCost: r2(cost / diff), adjustment: true }); } else if (diff < -0.0005) (layers[g] || (layers[g] = [])).push({ qty: -diff, price: lastPrice[g] || 0, at: e.at, source: "survey" }); } }
    const stock = Object.entries(layers).map(([g, L]) => { const qty = r4(sum(L, (l) => l.qty)); const value = r2(sum(L, (l) => l.qty * l.price)); return { grade: g, rob: qty, value, avgPrice: qty ? r2(value / qty) : lastPrice[g] || 0, invoicedShare: qty ? r4(sum(L.filter((l) => l.invoiced), (l) => l.qty) / qty) : 0 }; }).filter((s) => s.rob > 0.0005 || s.value);
    return { consumed, stock, lastPrice };
  }
  function dailyBunkerCost(ps, store, voyageId, opt) {
    opt = opt || {}; ps = ps || {}; store = store || {}; const vy = (ps.voyages || []).find((v) => v && v.id === voyageId); if (!vy) return null;
    const nowMs = parse(opt.now || (PSE && PSE.nowIso ? PSE.nowIso() : new Date().toISOString().slice(0, 16)));
    const span = PSE && PSE.voyageSpan ? PSE.voyageSpan(ps, vy) : { from: vy.from, to: vy.to }; const s = parse(span.from), e0 = parse(span.to); const e = isNaN(e0) ? nowMs : Math.min(e0, nowMs);
    const f = vy.fixtureId ? (ps.fixtures || []).find((x) => x.id === vy.fixtureId) : null; const vessel = (ps.vessels || []).find((v) => v.id === vy.vesselId) || {};
    const currency = (f && f.currency) || (vessel.currency) || "USD"; const charterers = !!(f && (f.kind === "tc" || f.kind === "bareboat"));
    const w = walk(ps, store, vy.vesselId, e);
    // consumption events on this voyage (tagged, else inside the span), each spread over the days it covers
    const mine = w.consumed.filter((c) => c.kind === "consumption" && (c.voyageId ? c.voyageId === voyageId : !isNaN(s) && !isNaN(e) && parse(c.at) >= s && parse(c.at) <= e)).sort((a, b) => parse(a.at) - parse(b.at));
    const noons = (ps.noonReports || []).filter((n) => n && n.voyageId === voyageId).sort((a, b) => parse(a.at) - parse(b.at));
    const prevAt = (c) => { const i = noons.findIndex((n) => n.id === c.id); if (i > 0) return parse(noons[i - 1].at); if (i === 0) return !isNaN(s) ? s : parse(c.at) - DAYM * MIN; return parse(c.at) - DAYM * MIN; };
    const days = new Map(); const dayRow = (d) => { let r = days.get(d); if (!r) { r = { date: d, grades: {}, qty: 0, cost: 0, cumulative: 0, source: "noon", reports: 0, where: null }; days.set(d, r); } return r; };
    for (const c of mine) { const to = parse(c.at); const from = c.source === "noon" ? prevAt(c) : to - DAYM * MIN; const hours = Math.max(1, (to - from) / 3600000); const spread = hours > 36;
      const put = (d, qty, cost, src) => { const r = dayRow(d); const g = r.grades[c.grade] || (r.grades[c.grade] = { qty: 0, cost: 0, price: 0 }); g.qty = r4(g.qty + qty); g.cost = r2(g.cost + cost); g.price = g.qty ? r2(g.cost / g.qty) : 0; r.qty = r4(r.qty + qty); r.cost = r2(r.cost + cost); if (src === "interpolated") r.source = "interpolated"; if (src === "noon") r.reports++; };
      if (!spread) put(dayOf(to), +c.qty, c.cost, c.source === "noon" ? "noon" : "log");
      else { let t = from; while (t < to) { const next = Math.min(to, Date.UTC(new Date(t).getUTCFullYear(), new Date(t).getUTCMonth(), new Date(t).getUTCDate() + 1)); const frac = (next - t) / (to - from); put(dayOf(t), r4(+c.qty * frac), r2(c.cost * frac), "interpolated"); t = next; } } }
    // where she was each day: in port when the day falls inside a port stay, else at sea
    const ports = (vy.ports || []).map((p) => ({ name: p.name || "", a: parse(p.ata || p.eta), d: parse(p.atd || p.etd) })).filter((p) => !isNaN(p.a));
    const list = [...days.values()].sort((a, b) => (a.date < b.date ? -1 : 1)); let cum = 0;
    for (const r of list) { const t0 = parse(r.date + "T12:00"); const inPort = ports.find((p) => t0 >= p.a && (isNaN(p.d) || t0 <= p.d)); r.where = inPort ? "port" : "sea"; r.port = inPort ? inPort.name : ""; cum = r2(cum + r.cost); r.cumulative = cum; }
    const total = r2(sum(list, (r) => r.cost)); const qty = r4(sum(list, (r) => r.qty)); const nDays = list.length; const perDay = nDays ? r2(total / nDays) : 0;
    const byGrade = {}; for (const r of list) for (const [g, x] of Object.entries(r.grades)) { const b = byGrade[g] || (byGrade[g] = { grade: g, qty: 0, cost: 0, price: 0 }); b.qty = r4(b.qty + x.qty); b.cost = r2(b.cost + x.cost); b.price = b.qty ? r2(b.cost / b.qty) : 0; }
    // the estimate: the voyage's own consumption table priced as the estimate prices it
    let est = { perDay: 0, total: 0, days: 0 }; try { const ve = PSE && PSE.voyageEstimate ? PSE.voyageEstimate(vy, vessel, f) : null; if (ve) { const total2 = r2(+ve.bunkerCost || sum(ve.bunkers || [], (b) => +b.cost || 0)); const d2 = +ve.totalDays || 0; est = { perDay: d2 ? r2(total2 / d2) : 0, total: total2, days: r4(d2) }; } } catch (x) { /* no estimate */ }
    const spanDays = !isNaN(s) ? r4(Math.max(0, (e - s)) / (DAYM * MIN)) : nDays;
    return { voyageId, vesselId: vy.vesselId, currency, charterers, from: !isNaN(s) ? isoMin(s) : null, to: !isNaN(e) ? isoMin(e) : null, spanDays, days: list, daysWithBurn: nDays, qty, total, perDay, byGrade: Object.values(byGrade), stock: w.stock, stockValue: r2(sum(w.stock, (x) => x.value)), estimate: est, variance: { total: r2(total - est.total), perDay: r2(perDay - est.perDay) }, interpolatedDays: list.filter((r) => r.source === "interpolated").length, invoicedShare: w.stock.length ? r4(sum(w.stock, (x) => x.invoicedShare * x.rob) / Math.max(0.0001, sum(w.stock, (x) => x.rob))) : 0 };
  }
  return { dailyBunkerCost, invoicedPrice, walk };
});
