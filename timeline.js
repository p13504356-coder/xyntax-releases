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
    const ticks = []; for (let m = new Date(start); m <= end; m = new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + 1, 1))) { const q = m.getUTCMonth() % 3 === 0; const first = m.getTime() === start.getTime(); ticks.push({ x: Math.round(X(m) * 1000) / 1000, q, m: MON[m.getUTCMonth()] + (m.getUTCMonth() === 0 ? " " + String(m.getUTCFullYear()).slice(2) : ""), label: q ? MON[m.getUTCMonth()] + (m.getUTCMonth() === 0 || first ? " " + String(m.getUTCFullYear()).slice(2) : "") : "" }); }
    const T = now.getTime();
    const fx = (opt.fixtures || []).filter((f) => f && f.status !== "cancelled").map((f) => { const a = startOf(f); if (!a) return null; const e = endOf(f); const estimated = !e || !!(f.redelivery && f.redelivery.estimated); const b = e || (f.status === "redelivered" ? a : new Date(T + 45 * MS_DAY).toISOString()); const t1 = tms(a); const t2 = Math.max(tms(b), t1 + MS_DAY); if (isNaN(t1) || isNaN(t2)) return null; if (t2 < start.getTime() || t1 > end.getTime()) return null; return { f, t1, t2, estimated }; }).filter(Boolean).sort((p, q) => p.t1 - q.t1 || p.t2 - q.t2);
    const laneEnd = [];
    const bars = fx.map((b) => { let lane = laneEnd.findIndex((e) => e <= b.t1); if (lane < 0) { lane = laneEnd.length; laneEnd.push(0); } laneEnd[lane] = b.t2; const x1 = X(b.t1), x2 = Math.max(X(b.t2), Math.min(100, x1 + 0.4)); const f = b.f; const running = b.t1 <= T && b.t2 > T;
      return { id: f.id, lane, x1: r3(x1), x2: r3(x2), clippedLeft: b.t1 < start.getTime(), clippedRight: b.t2 > end.getTime(), kind: f.kind || "", charterer: f.charterer || "", label: (f.charterer || kindName(f.kind)) + (rateText(f) ? " · " + rateText(f) : ""), kindName: kindName(f.kind), rateText: rateText(f), estimated: b.estimated, done: f.status === "redelivered" || b.t2 <= T, subs: f.status === "on-subs", running, from: new Date(b.t1).toISOString(), to: new Date(b.t2).toISOString(), status: f.status || "", deliveryPort: (f.delivery && f.delivery.port) || "", redeliveryPort: (f.redelivery && f.redelivery.port) || "", daysLeft: running ? Math.round((b.t2 - T) / MS_DAY * 10) / 10 : null, elapsed: r3(b.t2 <= T ? 100 : b.t1 >= T ? 0 : (X(now) - x1) / (x2 - x1) * 100) }; });
    const offs = []; for (const o of opt.offhire || []) { if (!o || !o.from) continue; const a = tms(o.from), z = tms(o.to || now); if (isNaN(a) || isNaN(z) || z < start.getTime() || a > end.getTime()) continue; const host = bars.find((b) => (o.fixtureId && b.id === o.fixtureId) || (!o.fixtureId && new Date(b.from).getTime() <= a && new Date(b.to).getTime() >= a)); const x1 = X(a), x2 = Math.max(X(z), Math.min(100, x1 + 0.3)); offs.push({ lane: host ? host.lane : 0, x1: r3(x1), x2: r3(x2), reason: o.reason || "", kind: o.kind || null, kindInferred: !!o.kindInferred, from: o.from, to: o.to || null }); }
    // 4.34.10 · the day she came under management (and the day she left): a marker when it falls inside the window
    const mark = (d) => { const t = tms(d && String(d).length <= 10 ? String(d) + "T00:00:00Z" : d); if (isNaN(t)) return null; return { at: new Date(t).toISOString(), x: r3(X(t)), inside: t >= start.getTime() && t <= end.getTime(), before: t < start.getTime() }; };
    const managed = { from: opt.onboarded ? mark(opt.onboarded) : null, to: opt.offboarded ? mark(opt.offboarded) : null };
    return { start: start.toISOString(), end: end.toISOString(), today: r3(X(now)), ticks, bars, offs, lanes: Math.max(1, laneEnd.length), managed };
  }
  const r3 = (x) => Math.round(x * 1000) / 1000;
  // 4.34.10 · zoom: the chart keeps its 36 months and grows wider inside its own box (1× to 12×); − / + and the wheel with Ctrl or a
  // pinch change it, the month under the pointer (or the middle of the view) stays where it is. `scroller` scrolls sideways, `inner`
  // is the element whose width is the whole window. Returns the − / + control to put in the panel's heading.
  const ZOOMS = [1, 2, 3, 4, 6, 8, 12];
  function zoomable(scroller, inner, opt) {
    opt = opt || {}; const doc = scroller.ownerDocument; let z = 1; const el = (t, c, x) => { const e = doc.createElement(t); if (c) e.className = c; if (x != null) e.textContent = x; return e; };
    const out = el("button", "tlz-b", "\u2212"), inn = el("button", "tlz-b", "+"), lab = el("span", "tlz-l", "36 months"), box = el("span", "tlz"); out.type = inn.type = "button"; out.setAttribute("aria-label", "Zoom out"); inn.setAttribute("aria-label", "Zoom in"); out.title = "Zoom out"; inn.title = "Zoom in (or Ctrl + wheel on the chart)"; box.append(out, lab, inn);
    const set = (nz, anchor) => { nz = Math.max(1, Math.min(12, nz)); const w0 = inner.getBoundingClientRect().width || 1; const view = scroller.clientWidth || 1; const ax = anchor != null ? anchor : view / 2; const frac = (scroller.scrollLeft + ax) / w0; z = nz; inner.style.width = (z * 100) + "%"; inner.style.minWidth = (z * 100) + "%"; scroller.classList.toggle("zoomed", z > 1); scroller.classList.toggle("zoomed-months", z >= 3); const w1 = inner.getBoundingClientRect().width || 1; scroller.scrollLeft = Math.max(0, frac * w1 - ax); const months = Math.round(36 / z * 10) / 10; lab.textContent = (months >= 10 ? Math.round(months) : months) + " months"; out.disabled = z <= 1; inn.disabled = z >= 12; if (opt.onchange) opt.onchange(z); };
    const step = (d, anchor) => { const i = ZOOMS.indexOf(z); const j = Math.max(0, Math.min(ZOOMS.length - 1, (i < 0 ? 0 : i) + d)); set(ZOOMS[j], anchor); };
    out.addEventListener("click", () => step(-1)); inn.addEventListener("click", () => step(1));
    scroller.addEventListener("wheel", (e) => { if (!(e.ctrlKey || e.metaKey)) return; e.preventDefault(); const r = scroller.getBoundingClientRect(); step(e.deltaY < 0 ? 1 : -1, e.clientX - r.left); }, { passive: false });
    // 4.34.12 · drag the chart sideways (mouse or finger) to go back in time or forward; a drag is not a click on a bar
    let drag = null, moved = false;
    scroller.addEventListener("pointerdown", (e) => { if (e.button != null && e.button !== 0) return; if (scroller.scrollWidth <= scroller.clientWidth + 1) return; drag = { x: e.clientX, left: scroller.scrollLeft, id: e.pointerId }; moved = false; });
    scroller.addEventListener("pointermove", (e) => { if (!drag || e.pointerId !== drag.id) return; const dx = e.clientX - drag.x; if (!moved && Math.abs(dx) < 4) return; if (!moved) { moved = true; scroller.classList.add("dragging"); try { scroller.setPointerCapture(e.pointerId); } catch (x) { /* no capture */ } } scroller.scrollLeft = drag.left - dx; e.preventDefault(); });
    const endDrag = (e) => { if (!drag) return; try { scroller.releasePointerCapture(drag.id); } catch (x) { /* none */ } drag = null; scroller.classList.remove("dragging"); if (moved) setTimeout(() => { moved = false; }, 0); };
    scroller.addEventListener("pointerup", endDrag); scroller.addEventListener("pointercancel", endDrag);
    scroller.addEventListener("click", (e) => { if (moved) { e.stopPropagation(); e.preventDefault(); } }, true);
    scroller.addEventListener("keydown", (e) => { if (scroller.scrollWidth <= scroller.clientWidth + 1) return; if (e.key === "ArrowLeft" || e.key === "ArrowRight") { scroller.scrollLeft += (e.key === "ArrowLeft" ? -1 : 1) * Math.max(40, scroller.clientWidth / 6); e.preventDefault(); } });
    out.disabled = true; return { el: box, set, get zoom() { return z; }, centre: (pct) => { const w = inner.getBoundingClientRect().width || 1; scroller.scrollLeft = Math.max(0, w * pct / 100 - scroller.clientWidth / 2); } };
  }
  return { layout, kindName, rateText, zoomable, ZOOMS };
});
