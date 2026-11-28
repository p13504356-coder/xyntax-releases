/* XYNTAX PROSHIP · where a vessel is (4.34.7). One rule for the desktop and the customer portal: of every position held for a
 * vessel — an AIS fix, a position in a noon / arrival / departure report, a position entered by hand — the marker stands on the
 * one whose OWN time is the latest (the instant of the position, UTC; never the time a row was saved). Same instant → the AIS fix.
 * Left out: coordinates that are not a place (not numbers, outside ±90 / ±180, the 0°, 0° of an empty field) and positions dated
 * more than ten minutes ahead of now. The track is the same positions in time order and ends on the marker.
 * Pure: candidates and the time in, the choice and its words out. This file is loaded by the app (src/) and, byte-identical, by
 * the portal (portal/last-position.js); a test keeps them equal. */
(function (root, factory) { const api = factory(); if (typeof module !== "undefined" && module.exports) module.exports = api; root.LastPosition = api; })(typeof self !== "undefined" ? self : this, function () {
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]; const AHEAD = 10 * 60000;
  // an instant: a number (ms), a Date, an ISO time with its zone, or the desk's wall-clock "YYYY-MM-DDTHH:mm" read as UTC
  function time(x) { if (x == null || x === "") return NaN; if (typeof x === "number") return x; if (x instanceof Date) return x.getTime(); const s = String(x).trim(); const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?$/.exec(s); if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)); const t = Date.parse(s); return isNaN(t) ? NaN : t; }
  const num = (v) => (v == null || v === "" || typeof v === "boolean" ? NaN : +v);
  const place = (lat, lon) => { lat = num(lat); lon = num(lon); return isFinite(lat) && isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && !(Math.abs(lat) < 1e-9 && Math.abs(lon) < 1e-9); };
  // "ais" | "report" | "manual" from whatever a row calls its source ("noon", "arrival", "departure" are reports; anything else was typed)
  const REPORTS = { noon: "noon", arrival: "arrival", departure: "departure", report: "", position: "position", sof: "", bunker: "bunkering" };
  function sourceOf(p) { const s = String((p && (p.source || p.kind)) || "").toLowerCase(); if (s === "ais") return "ais"; if (s in REPORTS || (p && p.source === "report")) return "report"; return "manual"; }
  const RANK = { ais: 3, report: 2, manual: 1 };
  // one candidate, normalised — or null when it is not a position that can be used at this time
  function norm(p, nowMs) { if (!p) return null; const lat = num(p.lat), lon = num(p.lon != null ? p.lon : p.lng); if (!place(lat, lon)) return null; const t = time(p.at != null ? p.at : p.ts != null ? p.ts : p.time); if (isNaN(t)) return null; const now = nowMs == null ? Date.now() : nowMs; if (t > now + AHEAD) return null; const source = sourceOf(p); const k = String(p.kind || p.source || "").toLowerCase(); const kind = source === "report" ? (k in REPORTS ? k : "report") : source; const at = new Date(t).toISOString();
    return { lat, lon, at, ts: at, t, source, kind, ref: p.ref != null ? p.ref : p.id != null ? p.id : null, sog: isFinite(num(p.sog)) ? +p.sog : null, cog: isFinite(num(p.cog)) ? +p.cog : null, hdg: isFinite(num(p.hdg)) ? +p.hdg : null, dest: p.dest || "", eta: p.eta || "", navStatus: p.navStatus || p.nav_status || "" }; }
  const later = (a, b) => (a.t !== b.t ? a.t - b.t : RANK[a.source] - RANK[b.source]);
  // pick(candidates, nowMs) → the position the marker stands on, or null
  // (the candidates are only weighed — place, time, source — and the one chosen is written out in full)
  function weigh(p, nowMs) { if (!p) return null; if (!place(p.lat, p.lon != null ? p.lon : p.lng)) return null; const t = time(p.at != null ? p.at : p.ts != null ? p.ts : p.time); if (isNaN(t) || t > (nowMs == null ? Date.now() : nowMs) + AHEAD) return null; return { p, t, source: sourceOf(p) }; }
  const usable = (p, nowMs) => !!weigh(p, nowMs);
  function pick(list, nowMs) { let best = null; for (const p of list || []) { const q = weigh(p, nowMs); if (q && (!best || later(q, best) > 0)) best = q; } return best ? norm(best.p, nowMs) : null; }
  // trail(points, nowMs) → the usable positions in time order (at the same instant the AIS fix last): its last point is pick()'s
  function trail(list, nowMs) { const out = []; for (const p of list || []) { const q = norm(p, nowMs); if (q) out.push(q); } out.sort(later); return out; }
  const two = (n) => String(n).padStart(2, "0");
  const stamp = (t) => { const d = new Date(t); return two(d.getUTCDate()) + " " + MON[d.getUTCMonth()] + " " + d.getUTCFullYear() + " " + two(d.getUTCHours()) + ":" + two(d.getUTCMinutes()) + " UTC"; };
  function ago(t, nowMs) { const m = Math.max(0, Math.round(((nowMs == null ? Date.now() : nowMs) - t) / 60000)); if (m < 1) return "just now"; if (m < 60) return m + " min ago"; const h = Math.round(m / 60); if (h < 48) return h + " h ago"; return Math.round(h / 24) + " days ago"; }
  // "AIS · 25 Nov 2026 06:10 UTC (2 h ago)" · "Position from noon report · 24 Nov 2026 12:00 UTC (23 h ago)" · "Position entered by hand · …"
  function words(p) { if (!p) return ""; const s = p.source || sourceOf(p); if (s === "ais") return "AIS"; if (s === "report") { const k = REPORTS[p.kind] != null ? REPORTS[p.kind] : ""; return "Position from " + (k ? k + " report" : "a report"); } return "Position entered by hand"; }
  function label(p, nowMs) { if (!p) return ""; const t = p.t != null ? p.t : time(p.at != null ? p.at : p.ts); if (isNaN(t)) return words(p); return words(p) + " · " + stamp(t) + " (" + ago(t, nowMs) + ")"; }
  return { time, place, sourceOf, norm, usable, pick, trail, label, words, stamp, ago, AHEAD };
});
