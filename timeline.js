/* XYNTAX PROSHIP · customer portal — the employment timeline's layout (4.31.10). Pure: fixtures and off-hire in, positions in percent
 * of a window of the last 24 months and the next 12 out, so the page draws it and the tests check it without a browser. The window is
 * whole months (UTC); a bar starts at delivery (else the CP date) and ends at redelivery — an open-ended charter runs 45 days past today,
 * a redelivered one without a date collapses to its start; bars outside the window are dropped, the rest are clipped to it; overlapping
 * fixtures take the next free lane (greedy, by start); off-hire sits on the lane of its fixture. */
(function (root, factory) { const api = factory(); if (typeof module !== "undefined" && module.exports) module.exports = api; root.PortalTimeline = api; })(typeof self !== "undefined" ? self : this, function () {
  // 4.31.17: zone-less times ("2026-11-12T00:00") are UTC wall-clock, never the viewer's local time
  const tms = (s) => { if (s == null || s === "") return NaN; if (s instanceof Date) return s.getTime(); if (typeof s === "number") return s; const x = String(s).trim(); const m = x.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?)?$/); if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0), m[7] ? Math.round(+("0." + m[7]) * 1000) : 0); return Date.parse(x); };
  const MS_DAY = 86400000; const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const KIND = { tc: "Time charter", voyage: "Voyage charter", bareboat: "Bareboat", coa: "COA", pool: "Pool" };
  const kindName = (k) => KIND[k] || (k ? String(k).replace(/^\w/, (c) => c.toUpperCase()) : "Fixture");
  const num = (n) => Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 });
  const rateText = (f) => (f.rate ? (f.currency || "USD") + " " + num(f.rate) + (f.rateUnit === "mt" ? "/MT" : f.rateUnit === "lumpsum" ? " lumpsum" : "/day") : "");
  const at = (x) => (x && typeof x === "object" ? x.at : x) || null;
  const startOf = (f) => at(f.delivery) || (f.cpDate ? String(f.cpDate).slice(0, 10) + "T00:00:00Z" : null);
  const endOf = (f) => at(f.redelivery);
  function layout(opt) {
    opt = opt || {}; const now = new Date(opt.now || Date.now()); const back = opt.back != null ? opt.back : 24, ahead = opt.ahead != null ? opt.ahead : 12;
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1)); const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + ahead + 1, 0, 23, 59, 59)); const span = end - start;
    const X = (t) => Math.max(0, Math.min(100, (tms(t) - start) / span * 100));
    const ticks = []; for (let m = new Date(start); m <= end; m = new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + 1, 1))) { const q = m.getUTCMonth() % 3 === 0; const first = m.getTime() === start.getTime(); ticks.push({ x: Math.round(X(m) * 1000) / 1000, q, label: q ? MON[m.getUTCMonth()] + (m.getUTCMonth() === 0 || first ? " " + String(m.getUTCFullYear()).slice(2) : "") : "" }); }
    const T = now.getTime();
    const fx = (opt.fixtures || []).filter((f) => f && f.status !== "cancelled").map((f) => { const a = startOf(f); if (!a) return null; const e = endOf(f); const estimated = !e || !!(f.redelivery && f.redelivery.estimated); const b = e || (f.status === "redelivered" ? a : new Date(T + 45 * MS_DAY).toISOString()); const t1 = tms(a); const t2 = Math.max(tms(b), t1 + MS_DAY); if (isNaN(t1) || isNaN(t2)) return null; if (t2 < start.getTime() || t1 > end.getTime()) return null; return { f, t1, t2, estimated }; }).filter(Boolean).sort((p, q) => p.t1 - q.t1 || p.t2 - q.t2);
    const laneEnd = [];
    const bars = fx.map((b) => { let lane = laneEnd.findIndex((e) => e <= b.t1); if (lane < 0) { lane = laneEnd.length; laneEnd.push(0); } laneEnd[lane] = b.t2; const x1 = X(b.t1), x2 = Math.max(X(b.t2), Math.min(100, x1 + 0.4)); const f = b.f; const running = b.t1 <= T && b.t2 > T;
      return { id: f.id, lane, x1: r3(x1), x2: r3(x2), clippedLeft: b.t1 < start.getTime(), clippedRight: b.t2 > end.getTime(), kind: f.kind || "", charterer: f.charterer || "", label: (f.charterer || kindName(f.kind)) + (rateText(f) ? " · " + rateText(f) : ""), kindName: kindName(f.kind), rateText: rateText(f), estimated: b.estimated, done: f.status === "redelivered" || b.t2 <= T, subs: f.status === "on-subs", running, from: new Date(b.t1).toISOString(), to: new Date(b.t2).toISOString(), status: f.status || "", deliveryPort: (f.delivery && f.delivery.port) || "", redeliveryPort: (f.redelivery && f.redelivery.port) || "", daysLeft: running ? Math.round((b.t2 - T) / MS_DAY * 10) / 10 : null, elapsed: r3(b.t2 <= T ? 100 : b.t1 >= T ? 0 : (X(now) - x1) / (x2 - x1) * 100) }; });
    const offs = []; for (const o of opt.offhire || []) { if (!o || !o.from) continue; const a = tms(o.from), z = tms(o.to || now); if (isNaN(a) || isNaN(z) || z < start.getTime() || a > end.getTime()) continue; const host = bars.find((b) => (o.fixtureId && b.id === o.fixtureId) || (!o.fixtureId && new Date(b.from).getTime() <= a && new Date(b.to).getTime() >= a)); const x1 = X(a), x2 = Math.max(X(z), Math.min(100, x1 + 0.3)); offs.push({ lane: host ? host.lane : 0, x1: r3(x1), x2: r3(x2), reason: o.reason || "", kind: o.kind || null, kindInferred: !!o.kindInferred, from: o.from, to: o.to || null }); }
    return { start: start.toISOString(), end: end.toISOString(), today: r3(X(now)), ticks, bars, offs, lanes: Math.max(1, laneEnd.length) };
  }
  const r3 = (x) => Math.round(x * 1000) / 1000;
  return { layout, kindName, rateText };
});
