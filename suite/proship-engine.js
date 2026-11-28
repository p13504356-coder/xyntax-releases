/* XYNTAX PROSHIP — engine (PSE)
 * Pure functions for ship management money and time: hire to the minute, off-hire overlap, commissions, hire periods,
 * what is still unbilled, voyage estimates, laytime and demurrage, a vessel's finances out of the book, performance against
 * the market, statements and report models, and the snapshot the customer portal publishes. No DOM. Runs in Node (tests)
 * and in the renderer. `ps` is the PROSHIP document (PS.data()), `store` is the accounting book (S.store).
 * Time: ISO "YYYY-MM-DDTHH:mm" read as wall-clock UTC; a day is 1440 minutes; days are shown to 4 dp, money to 2 dp. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.PSE = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  const MIN = 60000, DAYM = 1440, MONTHM = 30 * 1440;
  const r2 = (n) => Math.round((+n + Number.EPSILON) * 100) / 100;
  const r4 = (n) => Math.round((+n + Number.EPSILON) * 10000) / 10000;
  const r6 = (n) => Math.round((+n + Number.EPSILON) * 1e8) / 1e8; // line quantities: 8 dp so qty × rate lands on the statement's cents
  const sum = (a, f) => a.reduce((k, x) => k + (f ? f(x) : x), 0);
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const MV = (name) => { const n = String(name || "").trim(); return !n ? "" : /^(MV|MT|M\/V|M\/T|SS|MS|LNG\/C|MSV)\b/i.test(n) ? n : "MV " + n; };

  // ---------- time
  // "YYYY-MM-DD", "YYYY-MM-DDTHH:mm", "YYYY-MM-DD HH:mm", with seconds, or the shipping "24:00" (the next day's 00:00)
  function parse(iso) {
    if (iso == null || iso === "") return NaN; if (typeof iso === "number") return iso; if (iso instanceof Date) return iso.getTime();
    const m = String(iso).trim().match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?)?/); if (!m) { const t = Date.parse(iso); return isNaN(t) ? NaN : t; }
    return Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
  }
  const pad = (n) => String(n).padStart(2, "0");
  // minute-precision formatting straight from the epoch (no Date object: periods() formats tens of thousands of these for a fleet)
  const ISO_CACHE = new Map();
  function iso(ms) { if (ms == null || isNaN(ms)) return ""; ms = Math.floor(ms / MIN) * MIN; const hit = ISO_CACHE.get(ms); if (hit) return hit; const d = new Date(ms); const mo = d.getUTCMonth() + 1, da = d.getUTCDate(), h = d.getUTCHours(), mi = d.getUTCMinutes(); const out = d.getUTCFullYear() + "-" + (mo < 10 ? "0" : "") + mo + "-" + (da < 10 ? "0" : "") + da + "T" + (h < 10 ? "0" : "") + h + ":" + (mi < 10 ? "0" : "") + mi; if (ISO_CACHE.size > 50000) ISO_CACHE.clear(); ISO_CACHE.set(ms, out); return out; }
  const isoDate = (ms) => iso(ms).slice(0, 10);
  const minutes = (a, b) => { const x = parse(a), y = parse(b); return isNaN(x) || isNaN(y) ? 0 : Math.round((y - x) / MIN); };
  const addMinutes = (a, n) => iso(parse(a) + n * MIN);
  const maxIso = (a, b) => (parse(a) >= parse(b) ? a : b), minIso = (a, b) => (parse(a) <= parse(b) ? a : b);
  function overlapMinutes(a, b) { if (!a || !b) return 0; const s = Math.max(parse(a.from), parse(b.from)), e = Math.min(parse(a.to), parse(b.to)); return isNaN(s) || isNaN(e) || e <= s ? 0 : Math.round((e - s) / MIN); }
  const days = (min) => r4(min / DAYM);
  const fmtDays = (min) => (min / DAYM).toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 4 });
  function fmtAt(isoStr, opt) { const ms = parse(isoStr); if (isNaN(ms)) return "—"; const d = new Date(ms); let hh = d.getUTCHours(), mm = d.getUTCMinutes(), day = d.getUTCDate(), mon = d.getUTCMonth(), yr = d.getUTCFullYear(); if (opt && opt.end && hh === 0 && mm === 0) { const p = new Date(ms - MIN); day = p.getUTCDate(); mon = p.getUTCMonth(); yr = p.getUTCFullYear(); hh = 24; } return pad(day) + " " + MONTHS[mon] + " " + yr + " " + pad(hh) + ":" + pad(mm); }
  const fmtEnd = (isoStr) => fmtAt(isoStr, { end: true });
  const fmtDate = (isoStr) => { const ms = parse(isoStr); if (isNaN(ms)) return "—"; const d = new Date(ms); return pad(d.getUTCDate()) + " " + MONTHS[d.getUTCMonth()] + " " + d.getUTCFullYear(); };
  const fmtMoney = (n, ccy) => (n == null || isNaN(n) ? "—" : (ccy ? ccy + " " : "") + (+n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  const fmtQty = (n) => (+n).toLocaleString("en-US", { maximumFractionDigits: 3 });
  const nowIso = () => iso(Date.now()).slice(0, 16);

  // ---------- fixtures
  // 4.13: lookups go through indexes built once per document / book revision (thousands of vessels stay instant)
  const fixturesOf = (ps, vesselId) => (ps ? psIndex(ps).fixturesByVessel.get(vesselId) || [] : []).slice();
  const delAt = (f) => (f.delivery && f.delivery.at) || f.from || null;
  const redelAt = (f) => (f.redelivery && f.redelivery.at) || f.to || null;
  const redelActual = (f) => !!(f.redelivery && f.redelivery.at && f.redelivery.estimated === false) || f.status === "redelivered";
  // 4.32.2 · when a voyage charter's employment begins — the ballast leg to the load port counts as employed. Owners leave "Delivery"
  // blank on voyage charters, so: delivery.at when given; else the first departure (atd, else etd) of the first port of the voyage
  // file(s) under the fixture; else the end of her previous fixture when it ended within 30 days before the laycan; else the laycan's
  // first day less the ballast days from where the previous fixture left her (sea route at her ballast speed); else nothing.
  // commencement(ps, f) → { at, basis: "delivery" | "voyage" | "previous" | "ballast" | null, text }; commencedAt(ps, f) → the date; startAt(ps, f) → it
  // for a voyage charter, delAt(f) for a time charter or bareboat (every employment span, utilisation, TCE and the status read it)
  function commencement(ps, f) {
    if (!f) return { at: null, basis: null, text: "" }; const d = delAt(f); if (d) return { at: d, basis: "delivery", text: "" };
    if (f.kind !== "voyage" || !ps) return { at: null, basis: null, text: "" };
    // 4.32.2 · only a voyage charter that has begun gets a derived start: by its status (delivered / commenced / completed / redelivered), or,
    // with no status, by an actual completion in the past — a fixture still on subs or fixed is the next employment, not the current one
    const raw = String(f.status || "").toLowerCase(); const begun = ["delivered", "commenced", "completed", "redelivered"].includes(raw) || (!raw && f.redelivery && f.redelivery.at && f.redelivery.estimated === false && parse(f.redelivery.at) <= parse(nowIso()));
    if (!begun) return { at: null, basis: null, text: "" };
    const vys = ((ps.voyages || []).filter((v) => v && v.fixtureId === f.id && v.status !== "cancelled")); let first = NaN; for (const vy of vys) { const p0 = (vy.ports || [])[0]; const t = p0 ? parse(p0.atd || p0.etd) : NaN; if (!isNaN(t) && (isNaN(first) || t < first)) first = t; }
    if (!isNaN(first)) return { at: iso(first), basis: "voyage", text: "from the voyage file" };
    const lay = f.cargo && f.cargo.laycan && f.cargo.laycan.from ? parse(f.cargo.laycan.from) : NaN; const ref = !isNaN(lay) ? lay : parse(f.cpDate);
    const prev = (ps.fixtures || []).filter((x) => x && x.id !== f.id && x.vesselId === f.vesselId && x.status !== "cancelled" && redelAt(x) && !isNaN(parse(redelAt(x))) && (isNaN(ref) || parse(redelAt(x)) <= ref)).sort((a, b) => parse(redelAt(b)) - parse(redelAt(a)))[0] || null;
    if (prev && !isNaN(ref) && ref - parse(redelAt(prev)) <= 30 * DAYM * MIN && ref - parse(redelAt(prev)) >= 0) return { at: redelAt(prev), basis: "previous", text: "from the end of her previous fixture" };
    if (!isNaN(lay)) { const from = prev && prev.redelivery && prev.redelivery.lat != null && prev.redelivery.lon != null ? { lat: +prev.redelivery.lat, lon: +prev.redelivery.lon } : null; const fp = fixturePorts(f); const load = fp.load.find((x) => x.lat != null) || null;
      if (from && load) { try { const v = ((ps.vessels || []).find((x) => x.id === f.vesselId)) || {}; const speed = +(f.warranties && f.warranties.speedBallast) || +v.speedBallast || +(f.warranties && f.warranties.speedLaden) || +v.speedLaden || 12; const rt = routeLine(from, load, null, (ps.settings && ps.settings.routing) || null); const daysB = rt.nm / (speed * 24); return { at: iso(lay - Math.round(daysB * DAYM) * MIN), basis: "ballast", text: "laycan less " + r2(daysB) + " ballast days from " + (prev.redelivery.port || "her last port") }; } catch (e) { /* no route */ } } }
    return { at: null, basis: null, text: "" };
  }
  const commencedAt = (ps, f) => commencement(ps, f).at;
  const startAt = (ps, f) => (f && f.kind === "voyage" ? commencedAt(ps, f) : delAt(f));
  // a fixture as the status module reads it: a voyage charter with the commencement derived stands in for a blank delivery (delivery.derived = basis)
  const withStart = (ps, f) => { if (!f || f.kind !== "voyage" || delAt(f)) return f; const c = commencement(ps, f); return c.at ? { ...f, delivery: { ...(f.delivery || {}), at: c.at, derived: c.basis } } : f; };
  // the fixture in force at a moment: delivered and not (actually) redelivered before it; the latest delivery wins
  function activeFixture(ps, vesselId, at) { at = at || nowIso(); const t = parse(at); const list = fixturesOf(ps, vesselId).filter((f) => { const d = parse(startAt(ps, f)); if (isNaN(d) || d > t) return false; const r = parse(redelAt(f)); return isNaN(r) || !redelActual(f) || r >= t; }).sort((a, b) => parse(startAt(ps, b)) - parse(startAt(ps, a))); return list[0] || null; }
  const offhiresOf = (ps, fixture) => { if (!ps || !fixture) return []; const ix = psIndex(ps); return (ix.offhireByFixture.get(fixture.id) || []).concat((ix.offhireLooseByVessel.get(fixture.vesselId) || []).filter((o) => o.scope !== "vessel")); }; // 4.31.20 · a vessel off-hire (no fixture) never touches a charter's hire
  const fxLabel = (f) => (f.kind === "tc" ? "Time charter" : f.kind === "bareboat" ? "Bareboat charter" : "Voyage charter");
  // 4.31.11 · an off-hire has a kind: technical (the vessel is not available — dry dock, repairs, breakdown, class or survey, crew or ISM,
  // guarantee works, detention, awaiting spares) or commercial (available but not earning — waiting for orders, idle, positioning for
  // owners' account, a commercial dispute). Rows recorded before 4.31.11 carry no kind: it is read from the reason until the desk
  // confirms it (the off-hire table says "inferred — confirm"); nothing is rewritten by itself.
  const OFFHIRE_KINDS = [["technical", "Technical"], ["commercial", "Commercial"]];
  const OFFHIRE_TECHNICAL = /dock|repair|breakdown|survey|class|crew|guarantee|ism|detention|spares/i;
  const offhireKindInferred = (o) => !(o && (o.kind === "technical" || o.kind === "commercial"));
  const offhireKind = (o) => (offhireKindInferred(o) ? (OFFHIRE_TECHNICAL.test((o && o.reason) || "") ? "technical" : "commercial") : o.kind);
  const offhireKindName = (k) => (k === "technical" ? "Technical" : k === "commercial" ? "Commercial" : "");
  // the minutes covered by a set of {from, to} rows inside [a, b] (epoch ms), overlapping rows merged so nothing is counted twice; an open row runs to `now`
  function mergedMinutes(rows, a, b, now) { const iv = []; for (const o of rows || []) { if (!o || !o.from) continue; const s = Math.max(parse(o.from), a), e = Math.min(parse(o.to || now), b); if (!isNaN(s) && !isNaN(e) && e > s) iv.push([s, e]); } iv.sort((x, y) => x[0] - y[0]); let tot = 0, cs = null, ce = null; for (const [s, e] of iv) { if (cs == null || s > ce) { if (cs != null) tot += ce - cs; cs = s; ce = e; } else if (e > ce) ce = e; } if (cs != null) tot += ce - cs; return Math.round(tot / MIN); }

  // ---------- 4.32.2 · parcels, brokers and the charterer-paid extras of a fixture
  // parcelsOf(f) → every parcel of a voyage charter: f.parcels when the fixture has them (parcel 0 mirrors f.cargo), else the one parcel f.cargo
  // describes; each { commodity, qty, unit, loadPorts, dischargePorts, loadPortRefs, dischargePortRefs, rate, rateUnit, notes } — rate /
  // rateUnit null = the fixture's. cargoTotals(f) → { qty, unit, commodity (joined), parcels } across them.
  const PARCEL_KEYS = ["commodity", "qty", "unit", "loadPorts", "dischargePorts", "loadPortRefs", "dischargePortRefs", "rate", "rateUnit", "notes", "id"];
  function parcelsOf(f) { const c = (f && f.cargo) || null; const list = Array.isArray(f && f.parcels) && f.parcels.length ? f.parcels : (c ? [c] : []);
    return list.map((p, i) => { const o = {}; for (const k of PARCEL_KEYS) o[k] = p[k] !== undefined ? p[k] : (i === 0 && c ? c[k] : undefined); o.commodity = o.commodity || ""; o.qty = +o.qty || 0; o.unit = o.unit || (c && c.unit) || "MT"; o.loadPorts = Array.isArray(o.loadPorts) ? o.loadPorts : []; o.dischargePorts = Array.isArray(o.dischargePorts) ? o.dischargePorts : []; o.loadPortRefs = Array.isArray(o.loadPortRefs) ? o.loadPortRefs : []; o.dischargePortRefs = Array.isArray(o.dischargePortRefs) ? o.dischargePortRefs : []; o.rate = o.rate != null && o.rate !== "" && +o.rate > 0 ? +o.rate : null; o.rateUnit = o.rate != null ? (o.rateUnit || (f && f.rateUnit) || "mt") : null; o.notes = o.notes || ""; o.no = i + 1; return o; }); }
  const parcelRate = (f, p) => ({ rate: p && p.rate != null ? +p.rate : +(f && f.rate) || 0, unit: p && p.rate != null ? p.rateUnit || (f && f.rateUnit) || "mt" : (f && f.rateUnit) || "mt" });
  function cargoTotals(f) { const ps = parcelsOf(f); const units = [...new Set(ps.map((p) => p.unit))]; const names = [...new Set(ps.map((p) => p.commodity).filter(Boolean))]; return { parcels: ps.length, qty: r2(ps.reduce((k, p) => k + (+p.qty || 0), 0)), unit: units.length === 1 ? units[0] : (units[0] || "MT"), mixedUnits: units.length > 1, commodity: names.join(" + "), commodities: names }; }
  // brokersOf(f) → [{ cpId, pct }] — f.brokers when set, else the one broker f.brokerCpId / f.brokerage describe; brokeragePct(f) → the sum (= f.brokerage)
  function brokersOf(f) { if (!f) return []; const list = Array.isArray(f.brokers) && f.brokers.length ? f.brokers : (f.brokerCpId || +f.brokerage ? [{ cpId: f.brokerCpId || null, pct: +f.brokerage || 0 }] : []); return list.filter((b) => b && (b.cpId || +b.pct)).map((b) => ({ cpId: b.cpId || null, pct: +b.pct || 0 })); }
  const brokeragePct = (f) => { const bs = brokersOf(f); return bs.length ? r4(bs.reduce((k, b) => k + b.pct, 0)) : (+(f && f.brokerage) || 0); };
  // fixtureExtras(f) → [{ kind, label, amount, currency, note }] — interim port(s), AWRP, heating (amount, or per day × days) and an "other" line,
  // all for the charterer's account; only lines with an amount. EXTRA_KINDS keeps the order and the words the lines carry (REV_KINDS reads them back).
  const EXTRA_KINDS = [["interim", "Interim port"], ["awrp", "AWRP"], ["heating", "Heating"], ["extras", "Other"]];
  const extraLabel = (k) => (EXTRA_KINDS.find((x) => x[0] === k) || [k, k])[1];
  function fixtureExtras(f) { const ex = (f && f.extras) || null; if (!ex) return []; const ccy0 = (f && f.currency) || "USD"; const out = [];
    const one = (kind, x) => { if (!x) return; const amt = kind === "heating" && !(+x.amount > 0) && +x.perDay > 0 && +x.days > 0 ? r2(+x.perDay * +x.days) : r2(+x.amount || 0); if (!(amt > 0)) return; out.push({ kind, label: kind === "extras" ? (String(x.label || "").trim() || "Other extras") : extraLabel(kind), amount: amt, currency: String(x.currency || ex.currency || ccy0).toUpperCase(), note: String(x.note || "").trim(), perDay: kind === "heating" && +x.perDay > 0 ? +x.perDay : null, days: kind === "heating" && +x.days > 0 ? +x.days : null, calls: kind === "interim" && +x.calls > 0 ? +x.calls : null }); };
    if (Array.isArray(ex)) { for (const x of ex) one(x && x.kind === "other" ? "extras" : (x && x.kind) || "extras", x); } else for (const [k] of EXTRA_KINDS) one(k, ex[k] || (k === "extras" ? ex.other : null));
    return out; }
  const extrasTotal = (f) => r2(fixtureExtras(f).reduce((k, x) => k + x.amount, 0));
  // the invoice line of an extra: its words name the kind so a recorded invoice is read back into the same revenue key
  const extraLine = (x) => ({ kind: "extra-" + x.kind, extra: x.kind, description: (x.kind === "interim" ? "Interim port call" + (x.calls > 1 ? "s (" + x.calls + ")" : "") : x.kind === "awrp" ? "AWRP — additional war risk premium" : x.kind === "heating" ? "Heating" + (x.perDay && x.days ? " " + x.days + " days at " + fmtMoney(x.perDay, x.currency) + "/day" : "") : x.label) + (x.note ? " — " + x.note : "") + ", for charterers' account", qty: 1, unit: "lumpsum", price: x.amount, amount: x.amount, currency: x.currency });

  // ---------- 4.34.7 · a time charter with several hire rates, each for a period (fixture.rateSteps: [{ rate, days }])
  // "USD 25,000 for 30 days, then 27,500 for 60 days, then 30,000 for 90 days." One helper, used wherever hire is worked out.
  // The rules:
  //  · the period clock counts ON-HIRE time only, from delivery. Deductible off-hire of the fixture — the very periods the hire
  //    statement deducts (offhiresOf(ps, f) with deductible !== false, both ends known) — STOPS the clock; off-hire that is not
  //    deductible (hire is paid for it) and off-hire of the vessel that does not belong to the fixture do not. Overlapping
  //    off-hires stop it once (their intervals are merged). There is no partly deductible off-hire in the model (an off-hire is
  //    deductible or it is not), so there is no proportional case.
  //  · a rate begins with the first on-hire minute after the one before it has had its days: a boundary reached at the instant an
  //    off-hire starts falls at the END of that off-hire, so an off-hire always lies within one rate.
  //  · the last rate runs to redelivery whatever its own period says; periods that add up to more than the charter simply are not
  //    all reached. Absent rateSteps, or a single one, is the fixture as it always was: fixture.rate for the whole charter.
  //  · fixture.rate stays the first rate, so every reader that knows nothing of this still has a number.
  const rateSteps = (f) => { const one = [{ rate: +(f && f.rate) || 0, days: null }]; if (!f || (f.kind !== "tc" && f.kind !== "bareboat") || !Array.isArray(f.rateSteps)) return one; const list = f.rateSteps.filter((x) => x && +x.rate > 0).map((x) => ({ rate: +x.rate, days: +x.days > 0 ? +x.days : null })); if (list.length < 2) return one; const cut = list.findIndex((x) => x.days == null); /* a rate without a period runs to redelivery: nothing after it is reached */ return cut >= 0 ? list.slice(0, cut + 1) : list; };
  const hasRateSteps = (f) => !!(f && Array.isArray(f.rateSteps) && f.rateSteps.length > 1) && rateSteps(f).length > 1;
  // the merged intervals [startMs, endMs] during which the clock stands still
  function hireStops(offhires) { const iv = []; for (const o of offhires || []) { if (!o || o.deductible === false) continue; const a = parse(o.from), b = parse(o.to); if (isNaN(a) || isNaN(b) || b <= a) continue; iv.push([a, b]); } iv.sort((x, y) => x[0] - y[0]); const out = []; for (const [a, b] of iv) { const l = out[out.length - 1]; if (l && a <= l[1]) l[1] = Math.max(l[1], b); else out.push([a, b]); } return out; }
  // rateSchedule(f, offhires) → [{ step, rate, days, startMs, endMs }]: the calendar time each rate begins and ends, given the off-hire
  // on record (endMs null = to redelivery). Without a delivery time there is nothing to count from: the first rate, open-ended.
  function rateSchedule(f, offhires) {
    const steps = rateSteps(f); const d0 = parse(delAt(f || {}) || ""); if (steps.length < 2 || isNaN(d0)) return [{ step: 0, rate: steps[0].rate, days: steps[0].days, startMs: isNaN(d0) ? null : d0, endMs: null }];
    const stops = hireStops(offhires).filter((x) => x[1] > d0).map((x) => [Math.max(x[0], d0), x[1]]); const out = []; let t = d0, k = 0;
    // walk the calendar from delivery: t is always the first on-hire instant of the rate being placed
    const skip = () => { while (k < stops.length && stops[k][1] <= t) k++; if (k < stops.length && stops[k][0] <= t) { t = stops[k][1]; k++; skip(); } };
    for (let i = 0; i < steps.length; i++) { skip(); const start = t; if (i === steps.length - 1 || steps[i].days == null) { out.push({ step: i, rate: steps[i].rate, days: steps[i].days, startMs: start, endMs: null }); break; }
      let left = Math.round(steps[i].days * DAYM) * MIN; let j = k; while (left > 0) { const nextStop = j < stops.length ? stops[j] : null; if (nextStop && nextStop[0] - t < left) { left -= nextStop[0] - t; t = nextStop[1]; j++; } else { t += left; left = 0; } } k = j; skip();
      out.push({ step: i, rate: steps[i].rate, days: steps[i].days, startMs: start, endMs: t }); }
    return out;
  }
  // hireSegments(f, offhires, from, to) → [{ from, to, rate, onHire, step, minutes }] in calendar order, covering [from, to] exactly
  function hireSegments(f, offhires, from, to) {
    const a = parse(from), b = parse(to); if (isNaN(a) || isNaN(b) || b <= a) return []; const sched = rateSchedule(f, offhires); const stops = hireStops(offhires); const cuts = new Set([a, b]);
    for (const x of sched) { if (x.startMs != null && x.startMs > a && x.startMs < b) cuts.add(x.startMs); } for (const [s, e] of stops) { if (s > a && s < b) cuts.add(s); if (e > a && e < b) cuts.add(e); }
    const pts = [...cuts].sort((x, y) => x - y); const out = [];
    for (let i = 0; i + 1 < pts.length; i++) { const s = pts[i], e = pts[i + 1]; let st = sched[0]; for (const x of sched) if (x.startMs != null && x.startMs <= s) st = x; const off = stops.some((x) => x[0] <= s && x[1] >= e); const l = out[out.length - 1];
      if (l && l.step === st.step && l.onHire === !off) { l.to = iso(e); l.minutes += Math.round((e - s) / MIN); } else out.push({ from: iso(s), to: iso(e), rate: st.rate, onHire: !off, step: st.step, minutes: Math.round((e - s) / MIN) }); }
    return out;
  }
  // hireAmount = Σ rate × on-hire minutes (what the charter earns between two instants, before commissions and extras)
  function hireAmount(f, offhires, from, to) { let x = 0; for (const g of hireSegments(f, offhires, from, to)) if (g.onHire) x += g.rate * g.minutes / DAYM; return r2(x); }
  // hireGross = Σ rate × calendar minutes (off-hire not taken off — for estimates, which count days at the rate in force)
  function hireGross(f, offhires, from, to) { let x = 0; for (const g of hireSegments(f, offhires, from, to)) x += g.rate * g.minutes / DAYM; return r2(x); }
  // the rate in force at an instant (the first rate before delivery or without a time)
  function rateAt(f, offhires, at) { const sched = rateSchedule(f, offhires); const t = parse(at || ""); let st = sched[0]; if (!isNaN(t)) for (const x of sched) if (x.startMs != null && x.startMs <= t) st = x; return st.rate; }
  // "USD 25,000 → 27,500 → 30,000/day" (up to four rates), "6 rates from USD 25,000/day" beyond; one rate reads as it always did
  function rateText(f, opt) { opt = opt || {}; const steps = rateSteps(f); const ccy = (f && f.currency) || "USD"; const n0 = (n) => (+n).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 }); const per = opt.per != null ? opt.per : "/day"; if (steps.length < 2) return (opt.money ? opt.money(steps[0].rate, ccy) : ccy + " " + n0(steps[0].rate)) + per; if (steps.length > 4) return steps.length + " rates from " + ccy + " " + n0(steps[0].rate) + per; return ccy + " " + steps.map((x) => n0(x.rate)).join(" → ") + per; }
  // the rows of the fixture page's "Hire rates" block: each rate, its period, and the calendar dates it ran or will run given the
  // off-hire so far ({ step, rate, days, from, to, toKnown, reached, current, shortDays }); to = redelivery for the last one
  function rateRows(f, offhires, now) { const sched = rateSchedule(f, offhires); const rAt = redelAt(f || {}); const r = parse(rAt || ""); const n = parse(now || nowIso()); return sched.map((x, i) => { const end = x.endMs != null ? x.endMs : (isNaN(r) ? null : r); const reached = x.startMs != null && (isNaN(r) || x.startMs < r); return { step: i, rate: x.rate, days: x.days, from: x.startMs != null ? iso(x.startMs) : null, to: end != null ? iso(isNaN(r) ? end : Math.min(end, r)) : null, last: i === sched.length - 1, reached, current: x.startMs != null && x.startMs <= n && (end == null || n < end) }; }); }
  // the one-line check under the form's rows: how the periods compare with the charter (delivery to redelivery less deductible off-hire)
  function rateCheck(f, offhires) { const steps = rateSteps(f); const d = parse(delAt(f || {}) || ""), r = parse(redelAt(f || {}) || ""); const sum = r4(steps.reduce((k, x) => k + (x.days || 0), 0)); let charter = null; if (!isNaN(d) && !isNaN(r) && r > d) { let off = 0; for (const [s, e] of hireStops(offhires)) off += Math.max(0, Math.min(e, r) - Math.max(s, d)); charter = r4((r - d - off) / (DAYM * MIN)); } const open = steps[steps.length - 1].days == null; return { rates: steps.length, days: sum, charter, open, state: charter == null ? "unknown" : open || sum < charter - 1e-6 ? "short" : sum > charter + 1e-6 ? "long" : "exact" }; }

  // ---------- hire: the statement for one period, to the minute
  // opt: { vesselName, deductBrokerage (false), clamp (true), includeBallastBonus (true), includeBunkers (true) }
  function hire(fixture, offhires, from, to, opt) {
    opt = opt || {}; const f = fixture || {}; const rate = +f.rate || 0, ccy = f.currency || "USD"; const name = opt.vesselName || f.vesselName || "";
    const warn = [];
    const dAt = delAt(f), rAt = redelAt(f);
    if (opt.clamp !== false && dAt && parse(from) < parse(dAt)) { from = dAt; warn.push("Period start moved to delivery " + fmtAt(dAt)); }
    if (opt.clamp !== false && rAt && redelActual(f) && parse(to) > parse(rAt)) { to = rAt; warn.push("Period end moved to redelivery " + fmtEnd(rAt)); }
    const min = Math.max(0, minutes(from, to)); if (!(min > 0)) warn.push("The period is empty");
    // 4.34.7 · several rates: the period is split where a rate ends (rateSchedule: on-hire days only), one hire line per rate, and
    // each off-hire is taken off at the rate in force when it happened. Rounding: with one rate every amount is rate × minutes,
    // rounded once, as it always was. With several, a line is the difference of two rounded running totals counted from where its
    // rate (or its off-hire) began — R(rate × minutes to the line's end) − R(rate × minutes to its start) — so the pieces of a rate
    // that invoice periods cut apart add up to the rounded whole exactly: no cent drifts however many periods there are.
    const stepped = hasRateSteps(f); const sched = stepped ? rateSchedule(f, offhires) : null; const a0 = parse(from), b0 = parse(to);
    const stepOf = (ms) => { let st = sched[0]; for (const x of sched) if (x.startMs != null && x.startMs <= ms) st = x; return st; };
    const run = (r, fromMs, toMs) => r2(r * Math.round((toMs - fromMs) / MIN) / DAYM);
    const rates = []; if (stepped && min > 0) { for (let i = 0; i < sched.length; i++) { const x = sched[i]; const s0 = i === 0 ? -Infinity : x.startMs, e0 = x.endMs == null ? Infinity : x.endMs; const s = Math.max(a0, s0), e = Math.min(b0, e0); if (!(e > s)) continue; const base = i === 0 ? Math.min(x.startMs, a0) : x.startMs; const m = Math.round((e - s) / MIN); rates.push({ step: i, rate: x.rate, from: iso(s), to: iso(e), minutes: m, days: days(m), amount: r2(run(x.rate, base, e) - run(x.rate, base, s)) }); } }
    const gross = stepped ? r2(sum(rates, (x) => x.amount)) : r2(rate * min / DAYM);
    const period = { from, to };
    const off = []; let offMin = 0, offAmt = 0, offBunkers = 0;
    for (const o of (offhires || [])) { if (o.deductible === false) continue; const ov = overlapMinutes({ from: o.from, to: o.to }, period); if (!ov) continue; const s = maxIso(o.from, from), e = minIso(o.to, to); const oRate = stepped ? stepOf(Math.max(parse(o.from), isNaN(parse(delAt(f) || "")) ? -Infinity : parse(delAt(f)))).rate : rate; const o0 = parse(o.from); const amount = stepped ? r2(run(oRate, o0, parse(e)) - run(oRate, o0, parse(s))) : r2(rate * ov / DAYM); const bl = (o.bunkers || []).filter((b) => +b.qty && +b.price).map((b) => ({ grade: b.grade || "", qty: +b.qty, price: +b.price, amount: r2(+b.qty * +b.price) })); const bAmt = r2(sum(bl, (b) => b.amount)); off.push({ id: o.id, from: s, to: e, minutes: ov, days: days(ov), amount, rate: oRate, reason: o.reason || "", bunkers: bl, bunkersAmount: bAmt }); offMin += ov; offAmt += amount; offBunkers += bAmt; }
    offAmt = r2(offAmt); offBunkers = r2(offBunkers);
    const netMin = min - offMin; const hireNet = r2(gross - offAmt);
    const cveRate = +f.cve || 0; const cve = cveRate ? r2(cveRate * netMin / MONTHM) : 0;
    const first = !!dAt && parse(from) <= parse(dAt); const last = !!rAt && redelActual(f) && parse(to) >= parse(rAt);
    const ballastBonus = first && opt.includeBallastBonus !== false ? r2(+f.ballastBonus || 0) : 0;
    const bk = f.bunkers || {}; const bunkersLines = (list, sign) => (list || []).filter((b) => +b.qty && +b.price).map((b) => ({ grade: b.grade || "", qty: +b.qty, price: +b.price, amount: r2(sign * +b.qty * +b.price) }));
    const bDel = first && opt.includeBunkers !== false ? bunkersLines(bk.delivery, 1) : [], bRedel = last && opt.includeBunkers !== false ? bunkersLines(bk.redelivery, -1) : [];
    const bunkersDelivery = r2(sum(bDel, (b) => b.amount)), bunkersRedelivery = r2(-sum(bRedel, (b) => b.amount));
    const commBase = r2(hireNet + cve + ballastBonus);
    const addPct = +f.addressCommission || 0, brkPct = brokeragePct(f); /* 4.32.2 · the sum over every broker */
    const addressCommission = r2(commBase * addPct / 100), brokerage = r2(commBase * brkPct / 100);
    const deductBrk = !!opt.deductBrokerage;
    const net = r2(hireNet - offBunkers + cve + ballastBonus + bunkersDelivery - bunkersRedelivery - addressCommission - (deductBrk ? brokerage : 0));
    const vn = name ? MV(name) + ", " : "";
    const lines = [];
    if (stepped && rates.length) for (const x of rates) lines.push({ kind: "hire", step: x.step, description: "Time charter hire " + vn + fmtAt(x.from) + " – " + fmtEnd(x.to) + " UTC, " + fmtDays(x.minutes) + " days at " + fmtMoney(x.rate, ccy) + "/day", qty: r6(x.minutes / DAYM), unit: "day", price: x.rate, amount: x.amount });
    else lines.push({ kind: "hire", description: "Time charter hire " + vn + fmtAt(from) + " – " + fmtEnd(to) + " UTC, " + fmtDays(min) + " days at " + fmtMoney(rate, ccy) + "/day", qty: r6(min / DAYM), unit: "day", price: rate, amount: gross });
    for (const o of off) { lines.push({ kind: "offhire", description: "Off-hire " + fmtAt(o.from) + " – " + fmtEnd(o.to) + ", " + fmtDays(o.minutes) + " days" + (o.reason ? " — " + o.reason : "") + (stepped ? " at " + fmtMoney(o.rate, ccy) + "/day" : ""), qty: -r6(o.minutes / DAYM), unit: "day", price: o.rate, amount: -o.amount }); for (const b of o.bunkers) lines.push({ kind: "offhire-bunkers", description: "Bunkers consumed during off-hire: " + fmtQty(b.qty) + " MT " + b.grade + " at " + fmtMoney(b.price, ccy) + "/MT", qty: -b.qty, unit: "MT", price: b.price, amount: -b.amount }); }
    if (cve) lines.push({ kind: "cve", description: "CVE (communications, victualling, entertainment) " + fmtMoney(cveRate, ccy) + " per 30 days, " + fmtDays(netMin) + " days", qty: r6(netMin / MONTHM), unit: "month", price: cveRate, amount: cve });
    if (ballastBonus) lines.push({ kind: "ballast-bonus", description: "Ballast bonus, lumpsum on delivery", qty: 1, unit: "lumpsum", price: ballastBonus, amount: ballastBonus });
    for (const b of bDel) lines.push({ kind: "bunkers-delivery", description: "Bunkers on delivery: " + fmtQty(b.qty) + " MT " + b.grade + " at " + fmtMoney(b.price, ccy) + "/MT", qty: b.qty, unit: "MT", price: b.price, amount: b.amount });
    for (const b of bRedel) lines.push({ kind: "bunkers-redelivery", description: "Bunkers on redelivery: " + fmtQty(b.qty) + " MT " + b.grade + " at " + fmtMoney(b.price, ccy) + "/MT", qty: -b.qty, unit: "MT", price: b.price, amount: b.amount });
    if (addressCommission) lines.push({ kind: "address-commission", description: "Address commission " + addPct + "% on " + fmtMoney(commBase, ccy), qty: -1, unit: "each", price: addressCommission, amount: -addressCommission });
    const brokers = brokersOf(f).map((b) => ({ ...b, amount: r2(commBase * b.pct / 100), name: opt.cpName && b.cpId ? opt.cpName(b.cpId) : "" }));
    if (deductBrk && brokerage) { if (brokers.length > 1) for (const b of brokers) { if (b.amount) lines.push({ kind: "brokerage", cpId: b.cpId, description: "Brokerage " + b.pct + "% on " + fmtMoney(commBase, ccy) + (b.name ? " · " + b.name : ""), qty: -1, unit: "each", price: b.amount, amount: -b.amount }); } else lines.push({ kind: "brokerage", cpId: brokers[0] ? brokers[0].cpId : null, description: "Brokerage " + brkPct + "% on " + fmtMoney(commBase, ccy), qty: -1, unit: "each", price: brokerage, amount: -brokerage }); }
    return { fixtureId: f.id || null, vesselId: f.vesselId || null, currency: ccy, from, to, minutes: min, days: days(min), netMinutes: netMin, rate: stepped && rates.length ? rates[0].rate : rate, rates: stepped ? rates : [{ step: 0, rate, from, to, minutes: min, days: days(min), amount: gross }], stepped, gross, offhire: off, offhireMinutes: offMin, offhireDays: days(offMin), offhireAmount: offAmt, offhireBunkers: offBunkers, hireNet, cve, cveRate, ballastBonus, bunkersDelivery, bunkersRedelivery, addressCommission, addressCommissionPct: addPct, brokerage, brokeragePct: brkPct, brokers, brokerageDeducted: deductBrk, net, first, last, lines, warnings: warn };
  }

  // the hire periods of a fixture: 15- or 30-day intervals from delivery; in advance (due at the start) or in arrears
  function periods(fixture, until, opt) {
    opt = opt || {}; const f = fixture || {}; const dAt = delAt(f); if (!dAt) return [];
    const stepMin = (+f.hireInterval || 15) * DAYM; const adv = f.hireInAdvance !== false;
    const rAt = redelAt(f); const hardEnd = rAt && redelActual(f) ? parse(rAt) : null;
    let limit = parse(until || nowIso()); if (adv && !opt.noLookahead) limit += stepMin * MIN; if (hardEnd != null) limit = Math.min(limit, hardEnd); if (opt.max) limit = Math.min(limit, parse(dAt) + opt.max * stepMin * MIN);
    const out = []; let s = parse(dAt), n = 1;
    while (s < limit || (out.length === 0 && hardEnd != null && s < hardEnd)) { let e = s + stepMin * MIN; let final = false; if (hardEnd != null && e >= hardEnd) { e = hardEnd; final = true; } out.push({ no: n++, from: iso(s), to: iso(e), dueAt: adv ? iso(s) : iso(e), minutes: Math.round((e - s) / MIN), final, _s: s, _e: e }); if (final) break; s = e; if (n > 400) break; }
    return out;
  }

  // invoices of the book that belong to a fixture (hire statements created from PROSHIP carry fixtureId + meta.period)
  function fixtureInvoices(store, fixture) { if (!store || !fixture) return []; const ix = index(store); return (ix.invoicesByFixture.get(fixture.id) || []).map((i) => { const t = ix.tradeById.get(i.tradeId) || null; const meta = i.meta || (t && t.meta) || {}; return { id: i.id, ref: i.ref, date: i.date, amount: i.amount, currency: i.currency, paid: i.paid, period: meta.period || null, kind: meta.kind || "hire" }; }); }
  // x.y · a hire period counts as invoiced when the invoices' periods together cover it — invoices recorded from the owners' own files
  // rarely fall on the 15-day grid XYNTAX counts from delivery (calendar months, half months, a statement that stopped mid-period); the
  // invoice named for the period is the one that covers most of it. bounds: [{ i, f, t }] with f/t in ms.
  function coverOf(bounds, s, e) {
    const pf = s + MIN, pt = e - MIN; let touching = 0;
    for (const b of bounds) { if (b.f <= pf && b.t >= pt) return b.i; if (b.t >= pf && b.f <= pt) touching++; } // one invoice covers it (the usual case): no allocation
    if (touching < 2) return null; const hits = []; let best = null, bestOv = -1;
    for (const b of bounds) { if (b.t < pf || b.f > pt) continue; hits.push(b); const ov = Math.min(b.t, pt) - Math.max(b.f, pf); if (ov > bestOv) { bestOv = ov; best = b; } } hits.sort((x, y) => x.f - y.f); let reach = pf; for (const b of hits) { if (b.f > reach + MIN) return null; if (b.t > reach) reach = b.t; if (reach >= pt) return best.i; }
    return reach >= pt ? best.i : null;
  }
  function unbilled(ps, store, fixture, now) {
    now = now || nowIso(); const ps0 = ps || {}; const list = periods(fixture, now); const invs = fixtureInvoices(store, fixture).filter((i) => i.period && i.period.from && i.period.to);
    const bounds = invs.map((i) => ({ i, f: parse(i.period.from), t: parse(i.period.to) })); // parsed once, not per period
    const covered = (p) => coverOf(bounds, p._s != null ? p._s : parse(p.from), p._e != null ? p._e : parse(p.to));
    const out = list.map((p) => { const i = covered(p); return { ...p, invoiced: !!i, invoiceId: i ? i.id : null, invoiceRef: i ? i.ref : null }; });
    let billedTo = delAt(fixture), billedMs = parse(billedTo); for (const b of bounds) if (b.t > billedMs) { billedTo = b.i.period.to; billedMs = b.t; }
    const dueMs = parse(now); const next = out.find((p) => !p.invoiced && p._e > billedMs + MIN) || null;
    // when a statement ended mid-period, the next one starts where it stopped
    const nextPeriod = next ? { from: maxIso(next.from, billedTo), to: next.to, no: next.no, dueAt: next.dueAt } : null;
    const due = out.filter((p) => !p.invoiced && (p.dueAt === p.from ? p._s : p._e) <= dueMs);
    void ps0;
    return { periods: out, next: nextPeriod, billedTo, invoices: invs, due: due.length, overdueMinutes: due.reduce((k, p) => k + p.minutes, 0) };
  }

  // ---------- x.y · recording an invoice that already exists outside XYNTAX (back-dating the books from the owners' own files)
  // recordInvoice(ps, store, { entityId, ref, date, due, kind, vesselId, fixtureId, voyageId, counterpartyId, currency, amount, note,
  //   periodFrom, periodTo, payment: { date, amount, bankId, reference, bankAmount } }, { E, today }) → { kind, invoice | bill, payment }
  // Not a parallel record: the book gets the same trade + invoice + AR journal a generated invoice gets (E.addTrade, delivered), under the
  // external number and due date and flagged recorded / origin "external", and the money through E.receivePayments — so the statement of
  // accounts, hire to invoice, voyage P&L and TCE, cash flow, alerts and the portal take it as they take any invoice. A hire invoice carries
  // its period (the period then counts as invoiced and is never generated again); a period already invoiced is refused. A despatch
  // invoice is the charterer's claim on the owners: it is recorded as a payable to the charterer (a bill, paid through E.payBill).
  // Everything is checked before anything is posted, so a refusal leaves the books as they were.
  const RECORD_KINDS = [["hire", "Hire period"], ["freight", "Freight"], ["demurrage", "Demurrage"], ["despatch", "Despatch"], ["other", "Other"]];
  const atOf = (x) => { const t = parse(x); return isNaN(t) ? "" : iso(t); };
  function recordInvoice(ps, store, d, opt) {
    opt = opt || {}; d = d || {}; ps = ps || {}; const E = opt.E || ENGINE(); if (!E || !E.addTrade) throw new Error("The book engine is not loaded");
    const today = opt.today || isoDate(Date.now()); const kind = RECORD_KINDS.some((k) => k[0] === d.kind) ? d.kind : "other"; const lc = (x) => String(x || "").trim().toLowerCase();
    const ref = String(d.ref || "").trim(); if (!ref) throw new Error("Give the invoice number as it stands on the invoice");
    const date = String(d.date || "").slice(0, 10); if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Give the invoice date"); if (date > today) throw new Error("The invoice date is in the future — only invoices already issued are recorded");
    const due = String(d.due || "").slice(0, 10) || date; if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) throw new Error("Give the due date"); if (due < date) throw new Error("The due date is before the invoice date");
    const amount = r2(+d.amount); if (!(amount > 0)) throw new Error("The amount must be greater than zero");
    const ent = (store.entities || []).find((e) => e.id === d.entityId); if (!ent) throw new Error("Pick the entity whose books carry the invoice");
    if (!d.vesselId) throw new Error("Pick the vessel"); if (!(store.counterparties || []).some((c) => c.id === d.counterpartyId)) throw new Error("Pick the counterparty");
    const px = psIndex(ps); const vy = d.voyageId ? px.voyageById.get(d.voyageId) || null : null; if (d.voyageId && !vy) throw new Error("Unknown voyage"); if (vy && vy.vesselId !== d.vesselId) throw new Error("The voyage belongs to another vessel");
    let f = d.fixtureId ? px.fixtureById.get(d.fixtureId) || null : null; if (d.fixtureId && !f) throw new Error("Unknown fixture"); if (f && f.vesselId !== d.vesselId) throw new Error("The fixture belongs to another vessel");
    if (!f && vy && vy.fixtureId) f = px.fixtureById.get(vy.fixtureId) || null; if (f && vy && vy.fixtureId && vy.fixtureId !== f.id) throw new Error("The voyage sails under another fixture");
    const currency = String(d.currency || (f && f.currency) || ent.currency || "USD").toUpperCase(); const note = String(d.note || "").trim();
    const lock = E.lockedFor ? E.lockedFor(store, ent.id) : null; if (lock && date <= lock) throw new Error("The books of " + ent.name + " are locked through " + lock + " — reopen the period to record an invoice of " + date);
    if ((store.invoices || []).some((x) => x.entityId === ent.id && lc(x.ref) === lc(ref))) throw new Error("Invoice " + ref + " is already in the books");
    if (kind === "despatch" && (store.bills || []).some((x) => x.entityId === ent.id && x.recorded && lc(x.ref) === lc(ref))) throw new Error("Despatch invoice " + ref + " is already in the books");
    let period = null;
    if (kind === "hire") { if (!f || f.kind === "voyage") throw new Error("A hire invoice belongs to a time charter — pick the fixture"); const pf = atOf(d.periodFrom), pt = atOf(d.periodTo); if (!pf || !pt || parse(pt) <= parse(pf)) throw new Error("Give the hire period the invoice covers (from and to)"); period = { from: pf, to: pt };
      for (const i of fixtureInvoices(store, f)) if (i.period && i.period.from && i.period.to && overlapMinutes(i.period, period) > 1) throw new Error("Hire " + fmtAt(maxIso(i.period.from, pf)) + " – " + fmtEnd(minIso(i.period.to, pt)) + " is already invoiced on " + i.ref); }
    // the money received (or paid, for despatch) in the same step: checked in full before the invoice is posted
    const pay = d.payment && (+d.payment.amount > 0) ? d.payment : null; let bank = null;
    if (pay) { bank = (store.banks || []).find((b) => b.id === pay.bankId); if (!bank) throw new Error("Pick the bank account the money went through"); if (bank.entityId !== ent.id) throw new Error("The bank account belongs to another entity");
      const pd = String(pay.date || "").slice(0, 10); if (!/^\d{4}-\d{2}-\d{2}$/.test(pd)) throw new Error("Give the payment date"); if (pd > today) throw new Error("The payment date is in the future"); if (lock && pd <= lock) throw new Error("The books are locked through " + lock + " — the payment of " + pd + " cannot be posted");
      if (r2(+pay.amount) > amount + 0.005) throw new Error("The payment is more than the invoice"); if (bank.currency !== currency && !(+pay.bankAmount > 0)) throw new Error("The account is in " + bank.currency + ", the invoice in " + currency + " — give the amount that went through the account");
      if (kind === "despatch" && E.needsApproval && E.toBase) { const n = E.needsApproval(store, "payment", E.toBase(store, ent.id, +pay.amount, currency)); if (n && n.required) throw new Error("This payment needs approval (" + n.reason + ") — record the despatch invoice unpaid and pay it from Pay bills"); } }
    const label = (RECORD_KINDS.find((k) => k[0] === kind) || [])[1] || "Other"; const vname = MV(((px.vesselById.get(d.vesselId) || {}).name) || ""); const where = vy ? " · voyage " + (vy.no != null ? vy.no : "") : "";
    const desc = kind === "hire" ? "Hire " + fmtAt(period.from) + " – " + fmtEnd(period.to) + " UTC" + (vname ? " · " + vname : "") : kind === "other" ? (note || "Other") + (vname ? " · " + vname : "") : label + (vname ? " " + vname : "") + where;
    const meta = { kind, vesselId: d.vesselId, voyageId: vy ? vy.id : null, fixtureId: f ? f.id : null, recorded: true, origin: "external", ...(period ? { period } : {}) };
    if (kind === "despatch") {
      const r = E.expense(store, { entityId: ent.id, category: "Despatch", amount, counterpartyId: d.counterpartyId, date, due, currency, fx: d.fx, vesselId: d.vesselId, voyageId: vy ? vy.id : null, fixtureId: f ? f.id : null, memo: "Despatch " + ref + (note ? " · " + note : "") });
      const bill = r.bill; Object.assign(bill, { ref, recorded: true, origin: "external", meta }); if (note) bill.note = note; let payment = null;
      if (pay) payment = E.payBill(store, { billId: bill.id, bankId: bank.id, amount: r2(+pay.amount), date: String(pay.date).slice(0, 10), reference: pay.reference || "", bankAmount: pay.bankAmount });
      if (E.invalidate) E.invalidate(store); return { kind: "bill", bill, payment };
    }
    const t = E.addTrade(store, { entityId: ent.id, customerId: d.counterpartyId, vesselId: d.vesselId, voyageId: vy ? vy.id : null, fixtureId: f ? f.id : null, currency, fx: d.fx, date, deliveryDate: date, terms: Math.max(0, Math.round((parse(due) - parse(date)) / (DAYM * MIN))), delivered: true, vatRate: 0, note, buyerRef: d.theirRef || "", meta, lines: [{ kind: "service", description: desc, qty: 1, unit: "lumpsum", price: amount }], invoice: { recorded: true, ref, due, note } });
    const invoice = (store.invoices || []).find((i) => i.tradeId === t.id); let payment = null;
    if (pay) { try { const r = E.receivePayments(store, { bankId: bank.id, date: String(pay.date).slice(0, 10), amount: r2(+pay.amount), counterpartyId: d.counterpartyId, reference: pay.reference || "", bankAmount: pay.bankAmount, allocations: [{ invoiceId: invoice.id, amount: r2(+pay.amount) }], ps }); payment = (store.payments || []).find((p) => p.id === r.paymentIds[0]) || null; }
      catch (e) { try { E.undeliverTrade(store, t.id, { __approved: true }); E.deleteTrade(store, t.id); } catch (x) { /* left as recorded, unpaid */ } throw e; } }
    if (E.invalidate) E.invalidate(store); return { kind: "invoice", invoice, trade: t, payment };
  }
  // a document recorded from outside (invoice or bill) — lists and pages say so; nothing prints it as if XYNTAX had issued it
  const isRecorded = (doc) => !!(doc && (doc.recorded || doc.origin === "external" || (doc.meta && doc.meta.recorded)));
  // ---------- x.y · the laytime result of a voyage entered as agreed (a past voyage, no statement of facts on file): allowed and used
  // hours, the rate, the demurrage (or despatch) it gives, the amount agreed or settled and when, the counterparty. vy.laytimeResult is
  // { kind, allowedHours, usedHours, rate, agreedAmount, settledAt, cpId, currency, note, invoiceId, billId }. The figure is the agreed
  // amount when given, else the computed one; it is dated by its own settlement date (else the voyage's end), never by when it was typed.
  function laytimeResult(vy, fixture, opt) {
    opt = opt || {}; const r = vy && vy.laytimeResult; if (!r || (r.allowedHours == null && r.agreedAmount == null && r.amount == null && (r.days == null || r.days === ""))) return null; const f = fixture || {}; const c = f.cargo || {};
    const daysGiven = r.days != null && r.days !== "" && !isNaN(+r.days) ? +r.days : null;
    const allowed = r.allowedHours != null && r.allowedHours !== "" ? +r.allowedHours : null, used = r.usedHours != null && r.usedHours !== "" ? +r.usedHours : null;
    // 4.32.1 · the time can be given straight as days on demurrage (or saved), e.g. 4.09123, instead of allowed and used hours
    const diff = allowed != null && used != null ? r4(used - allowed) : daysGiven != null ? (r.kind === "despatch" ? -1 : 1) * daysGiven * 24 : null; // days keep their full precision: 4.09123 d × rate is the figure the owner expects
    const kind = r.kind === "despatch" || r.kind === "demurrage" ? r.kind : diff != null ? (diff > 0 ? "demurrage" : diff < 0 ? "despatch" : "within") : "demurrage";
    const rate = r.rate != null && r.rate !== "" ? +r.rate : kind === "despatch" ? (+c.despatchRate || r2((+c.demurrageRate || 0) / 2)) : +c.demurrageRate || 0;
    const hours = diff == null ? null : kind === "despatch" ? Math.max(0, -diff) : Math.max(0, diff); const computed = hours != null && rate ? r2(rate * hours / 24) : null;
    const agreed = r.agreedAmount != null && r.agreedAmount !== "" ? r2(+r.agreedAmount) : null; const amount = agreed != null ? agreed : computed != null ? computed : r2(+r.amount || 0);
    let date = r.settledAt ? String(r.settledAt).slice(0, 10) : ""; if (!date && opt.ps) { try { const sp = voyageSpan(opt.ps, vy); date = sp && sp.to ? String(sp.to).slice(0, 10) : ""; } catch (e) { date = ""; } }
    return { kind: kind === "within" ? "within" : kind, allowedHours: allowed, usedHours: used, days: daysGiven != null && (allowed == null || used == null) ? daysGiven : hours != null ? r4(hours / 24) : null, hours, demurrageHours: kind === "demurrage" ? hours : 0, despatchHours: kind === "despatch" ? hours : 0, rate, computed, agreed, amount, currency: String(r.currency || f.currency || "USD").toUpperCase(), cpId: r.cpId || f.chartererCpId || null, date: date || null, settled: !!r.settledAt, note: r.note || "", invoiceId: r.invoiceId || null, billId: r.billId || null };
  }

  // ---------- voyage charter: freight, demurrage and the lines of the freight invoice
  function freight(fixture, voyage, opt) {
    opt = opt || {}; const f = fixture || {}; const ccy = f.currency || "USD"; const cargo = f.cargo || {}; const parcels = parcelsOf(f); const multi = parcels.length > 1;
    // 4.32.2 · one freight line per parcel (its own rate when it has one, else the fixture's); a single parcel reads as before (opt.qty / voyage.cargoQty override its quantity)
    const vn = opt.vesselName ? MV(opt.vesselName) + ", " : ""; const lines = []; let amount = 0, qty = 0; const rate = +f.rate || 0; const unit = f.rateUnit === "lumpsum" ? "lumpsum" : (cargo.unit || "MT");
    for (const p of (parcels.length ? parcels : [{ ...cargo, qty: +cargo.qty || 0, unit: cargo.unit || "MT", loadPorts: cargo.loadPorts || [], dischargePorts: cargo.dischargePorts || [], no: 1 }])) {
      const pr = parcelRate(f, p); const pq = !multi && opt.qty != null ? +opt.qty : !multi && voyage && voyage.cargoQty != null ? +voyage.cargoQty : +p.qty || 0; const pu = pr.unit === "lumpsum" ? "lumpsum" : (p.unit || "MT"); const amt = pr.unit === "lumpsum" ? r2(pr.rate) : r2(pr.rate * pq);
      lines.push({ kind: "freight", parcel: p.no || 1, description: "Freight " + (multi ? "parcel " + (p.no || 1) + ", " : "") + vn + (p.commodity ? p.commodity + " " : "") + (pr.unit === "lumpsum" ? "lumpsum" : fmtQty(pq) + " " + pu + " at " + fmtMoney(pr.rate, ccy) + "/" + pu) + (p.loadPorts && p.loadPorts.length ? ", " + p.loadPorts.join("/") + " – " + (p.dischargePorts || []).join("/") : ""), qty: pr.unit === "lumpsum" ? 1 : pq, unit: pu, price: pr.rate, amount: amt });
      amount = r2(amount + amt); qty += pq; }
    let demurrage = 0, despatch = 0; const lts = (opt.laytime || []).filter(Boolean);
    // 4.30 · records with a statement of facts go through the voyage statement once: a reversible voyage gives ONE demurrage (or despatch)
    // line for the whole voyage, a non-reversible one a line per port; the old per-record results keep working as before
    if (opt.statement || lts.some((lt) => Array.isArray(lt.sof))) { const st = opt.statement || laytimeStatement(voyage, fixture, lts); for (const l of laytimeLines(st)) { lines.push(l); if (l.kind === "demurrage") demurrage += l.amount; else despatch += Math.abs(l.amount); } }
    else for (const lt of lts) { const res = lt.result || laytime(lt, fixture); if (res.kind === "demurrage" && res.amount) { demurrage += res.amount; lines.push({ kind: "demurrage", description: "Demurrage " + (lt.port || "") + ": " + res.demurrageHours.toFixed(2) + " hours at " + fmtMoney(cargo.demurrageRate || 0, ccy) + "/day", qty: r6(res.demurrageHours / 24), unit: "day", price: +cargo.demurrageRate || 0, amount: res.amount }); } if (res.kind === "despatch" && res.amount) { despatch += Math.abs(res.amount); lines.push({ kind: "despatch", description: "Despatch " + (lt.port || "") + ": " + res.despatchHours.toFixed(2) + " hours at " + fmtMoney(cargo.despatchRate || 0, ccy) + "/day", qty: -r6(res.despatchHours / 24), unit: "day", price: +cargo.despatchRate || 0, amount: -Math.abs(res.amount) }); } }
    const commBase = r2(amount + demurrage - despatch); const brkPct = brokeragePct(f); const addressCommission = r2(commBase * (+f.addressCommission || 0) / 100), brokerage = r2(commBase * brkPct / 100);
    if (addressCommission) lines.push({ kind: "address-commission", description: "Address commission " + (+f.addressCommission) + "% on " + fmtMoney(commBase, ccy), qty: -1, unit: "each", price: addressCommission, amount: -addressCommission });
    // 4.32.2 · the charterer-paid extras typed on the fixture (interim port, AWRP, heating, other) go on the freight invoice as their own lines, no commission on them (opt.extras === false leaves them off)
    const extras = opt.extras === false ? [] : fixtureExtras(f).map(extraLine); for (const l of extras) lines.push(l); const extrasAmt = r2(extras.reduce((k, l) => k + l.amount, 0));
    return { currency: ccy, qty, rate, freight: amount, parcels: lines.filter((l) => l.kind === "freight").map((l) => ({ parcel: l.parcel, amount: l.amount, qty: l.qty, price: l.price })), demurrage: r2(demurrage), despatch: r2(despatch), addressCommission, brokerage, brokeragePct: brkPct, brokers: brokersOf(f).map((b) => ({ ...b, amount: r2(commBase * b.pct / 100) })), extras: extrasAmt, extraLines: extras, net: r2(commBase - addressCommission + extrasAmt), lines };
  }

  // ---------- laytime: time counted against the allowance, demurrage or despatch
  // calc: { norTendered, commenced, completed, allowedHours, events: [{ from, to, desc, counts (true), pct (100) }], reversible }
  function laytime(calc, fixture, voyage, records) {
    calc = calc || {}; const cargo = (fixture && fixture.cargo) || {};
    // 4.30 · a record with a statement of facts is one port of the voyage statement (pass the voyage and all its records for the
    // reversible context; alone, it is measured against its own allowance); the old result shape is kept for the callers
    if (Array.isArray(calc.sof)) { const own = calc.allowedHours != null && calc.allowedHours !== "" ? +calc.allowedHours : null; const vy = voyage || (own != null ? { laytime: { reversible: false, allowedPerPort: { [calc.portId || "p"]: own } } } : null); const st = laytimeStatement(vy, fixture, Array.isArray(records) && records.length ? records : [calc]); const p = st.ports.find((x) => x.id === calc.id || x.portId === calc.portId) || st.ports[0] || {}; const rev = st.reversible; const kind = rev ? st.kind : p.kind || "within"; const demH = rev ? st.demurrageHours : p.demurrageHours || 0, desH = rev ? st.despatchHours : p.despatchHours || 0; const amount = kind === "demurrage" ? (rev ? st.demurrage : p.demurrage) : kind === "despatch" ? -(rev ? st.despatch : p.despatch) : 0; return { allowedHours: rev ? st.allowedHours : p.allowedHours || 0, usedHours: p.netHours || 0, usedMinutes: Math.round((p.netHours || 0) * 60), grossHours: p.grossHours || 0, deductedHours: p.deductedHours || 0, demurrageHours: demH, despatchHours: desH, demurrageRate: st.demurrageRate, despatchRate: st.despatchRate, amount, kind, events: p.events || [], deductions: p.deductions || [], currency: st.currency, reversible: rev, laytimeStart: p.laytimeStart || null, laytimeStop: p.laytimeStop || null, warnings: p.warnings || [], statement: st }; }
    const allowedHours = +(calc.allowedHours != null && calc.allowedHours !== "" ? calc.allowedHours : cargo.laytimeHours) || 0;
    const ev = (calc.events || []).filter((e) => e.from && e.to && parse(e.to) > parse(e.from));
    let usedMin = 0; const counted = [];
    if (ev.length) { for (const e of ev) { if (e.counts === false) { counted.push({ ...e, minutes: minutes(e.from, e.to), countedMinutes: 0 }); continue; } const m = minutes(e.from, e.to); const pct = e.pct == null || e.pct === "" ? 100 : +e.pct; const c = Math.round(m * pct / 100); usedMin += c; counted.push({ ...e, minutes: m, countedMinutes: c }); } }
    else if (calc.commenced && calc.completed) usedMin = Math.max(0, minutes(calc.commenced, calc.completed));
    const usedHours = r4(usedMin / 60); const allowedMin = Math.round(allowedHours * 60);
    const demMin = Math.max(0, usedMin - allowedMin), desMin = Math.max(0, allowedMin - usedMin);
    const demRate = +cargo.demurrageRate || +calc.demurrageRate || 0; const desRate = calc.despatchRate != null ? +calc.despatchRate : cargo.despatchRate != null && cargo.despatchRate !== "" ? +cargo.despatchRate : demRate / 2;
    const kind = demMin > 0 ? "demurrage" : desMin > 0 && desRate > 0 && (calc.completed || ev.length) ? "despatch" : "within";
    const amount = kind === "demurrage" ? r2(demRate * demMin / DAYM) : kind === "despatch" ? -r2(desRate * desMin / DAYM) : 0;
    return { allowedHours: r4(allowedHours), usedHours, usedMinutes: usedMin, demurrageHours: r4(demMin / 60), despatchHours: r4(desMin / 60), demurrageRate: demRate, despatchRate: desRate, amount, kind, events: counted, currency: (fixture && fixture.currency) || "USD" };
  }

  // ---------- 4.30 · the laytime statement: statement of facts → laytime start and stop → deductions → time counted → demurrage or despatch
  // Terms live on the voyage (voyage.laytime), defaults come from the fixture's cargo: { reversible (true), allowedHours, allowedPerPort: { [portId]: h }
  // (non-reversible), noticeHours (6), startRule notice | commenced | allfast, stopEvent hoses | completed | sailed, deductShifting (true: anchor
  // aweigh → all fast is "Berthing"), onceOnDemurrage (false), demurrageRate, despatchBasis none | half | rate, despatchRate, addressCommission %,
  // brokerage %, currency, remarks }. One record per load/discharge port: { id, voyageId, portId, port, activity, sof: [{ id, code, label, at }],
  // deductions: [{ id, desc, from, to, pct (100), hours (fixed hours instead of from/to), kind }], shifting (false switches the automatic berthing
  // deduction off), notes }. Hours are decimal to 2 dp per line (minutes / 60), money to 2 dp, as on a laytime sheet.
  const LT_CODES = [["arrived", "Arrived"], ["nor", "NOR Tendered"], ["aweigh", "Anchor Aweigh"], ["firstline", "First Line"], ["allfast", "All Fast"], ["commenced", "Commenced"], ["suspended", "Suspended"], ["resumed", "Resumed"], ["completed", "Completed"], ["hoses", "Hose Disconnected"], ["sailed", "Sailed"], ["custom", "Other"]];
  const ltCodeLabel = (code, activity) => { const base = (LT_CODES.find((c) => c[0] === code) || ["", ""])[1]; const op = activity === "discharge" ? "Discharging" : activity === "load" ? "Loading" : ""; return op && ["commenced", "suspended", "resumed", "completed"].includes(code) ? base + " " + op : base; };
  const ltHours = (min) => r2(min / 60);
  const fmtH = (h) => (Math.round(+h * 100) / 100).toString();
  function laytimeTerms(voyage, fixture) {
    const t = (voyage && voyage.laytime) || {}; const f = fixture || {}; const cargo = f.cargo || {}; const num = (v) => (v == null || v === "" || isNaN(+v) ? null : +v);
    const demurrageRate = num(t.demurrageRate) != null ? num(t.demurrageRate) : num(cargo.demurrageRate) || 0;
    const despatchBasis = t.despatchBasis || (num(cargo.despatchRate) > 0 ? "rate" : "none");
    const despatchRate = despatchBasis === "half" ? r2(demurrageRate / 2) : despatchBasis === "rate" ? (num(t.despatchRate) != null ? num(t.despatchRate) : num(cargo.despatchRate) || 0) : 0;
    return { reversible: t.reversible != null ? !!t.reversible : cargo.reversible != null ? !!cargo.reversible : true, allowedHours: num(t.allowedHours) != null ? num(t.allowedHours) : num(cargo.laytimeHours) || 0, allowedPerPort: t.allowedPerPort || {}, noticeHours: num(t.noticeHours) != null ? num(t.noticeHours) : 6, startRule: t.startRule || "notice", stopEvent: t.stopEvent || "hoses", deductShifting: t.deductShifting !== false, onceOnDemurrage: !!t.onceOnDemurrage, demurrageRate, despatchBasis, despatchRate, addressCommission: num(t.addressCommission) != null ? num(t.addressCommission) : +f.addressCommission || 0, brokerage: num(t.brokerage) != null ? num(t.brokerage) : brokeragePct(f), currency: t.currency || f.currency || "USD", remarks: t.remarks || "" };
  }
  // an old record (norTendered / commenced / completed / events with counts and pct) as a statement-of-facts record; a record that has `sof` is returned as is
  function laytimeMigrate(rec) {
    if (!rec || Array.isArray(rec.sof)) return rec; const sof = [], ded = []; let n = 0; const id = (p) => (rec.id || "lt") + "." + p + (++n);
    const ev = (rec.events || []).filter((e) => e && e.from && e.to);
    const commenced = rec.commenced || (ev.length ? ev.slice().sort((a, b) => parse(a.from) - parse(b.from))[0].from : null), completed = rec.completed || (ev.length ? ev.slice().sort((a, b) => parse(b.to) - parse(a.to))[0].to : null);
    if (rec.norTendered) sof.push({ id: id("e"), code: "nor", at: rec.norTendered }); if (commenced) sof.push({ id: id("e"), code: "commenced", at: commenced }); if (completed) sof.push({ id: id("e"), code: "completed", at: completed });
    for (const e of ev) { const pct = e.pct == null || e.pct === "" ? 100 : +e.pct; const excl = e.counts === false ? 100 : 100 - pct; if (excl > 0) ded.push({ id: id("d"), desc: e.desc || "Time not counting", from: e.from, to: e.to, pct: excl, counts: false }); }
    return { ...rec, sof, deductions: ded, migratedFrom: "events", terms: rec.allowedHours != null && rec.allowedHours !== "" ? { allowedHours: +rec.allowedHours, startRule: rec.norTendered ? "notice" : "commenced", stopEvent: "completed" } : { startRule: rec.norTendered ? "notice" : "commenced", stopEvent: "completed" } };
  }
  function laytimePort(rec, terms, carriedMin, allowedMin) {
    rec = rec || {}; const warn = []; const act = rec.activity || ""; const port = rec.port || "Port";
    const events = (rec.sof || []).filter((e) => e && !isNaN(parse(e.at))).map((e) => ({ id: e.id, code: e.code || "custom", label: e.label || ltCodeLabel(e.code, act) || "Event", at: iso(parse(e.at)), ms: parse(e.at) })).sort((a, b) => a.ms - b.ms);
    const first = (code) => events.find((e) => e.code === code) || null, last = (code) => { for (let i = events.length - 1; i >= 0; i--) if (events[i].code === code) return events[i]; return null; };
    const nor = first("nor"), aweigh = first("aweigh"), allfast = first("allfast"), commenced = first("commenced"), completed = last("completed"), hoses = last("hoses"), sailed = last("sailed");
    if (!nor && events.length) warn.push(port + ": no NOR tendered");
    const noticeMs = nor ? nor.ms + terms.noticeHours * 60 * MIN : NaN; const noticeLabel = "Laytime Start (NOR + " + fmtH(terms.noticeHours) + ")";
    let startMs = NaN, startLabel = "Laytime Start";
    if (terms.startRule === "allfast" && allfast) { startMs = allfast.ms; startLabel = "Laytime Start (all fast)"; }
    else if (terms.startRule === "commenced" && commenced && (!nor || commenced.ms < noticeMs)) { startMs = commenced.ms; startLabel = "Laytime Start (commenced)"; }
    else if (nor) { startMs = noticeMs; startLabel = noticeLabel; }
    else if (commenced) { startMs = commenced.ms; startLabel = "Laytime Start (commenced)"; }
    else if (allfast) { startMs = allfast.ms; startLabel = "Laytime Start (all fast)"; }
    else if (events.length) { startMs = events[0].ms; startLabel = "Laytime Start (first event)"; warn.push(port + ": laytime starts at the first event for want of NOR, all fast or commenced"); }
    const order = terms.stopEvent === "completed" ? [completed, hoses, sailed] : terms.stopEvent === "sailed" ? [sailed, hoses, completed] : [hoses, completed, sailed];
    const stopEv = order.find(Boolean) || null; const stopMs = stopEv ? stopEv.ms : NaN;
    if (!stopEv && events.length) warn.push(port + ": no completion yet — the statement is provisional");
    if (commenced && allfast && commenced.ms < allfast.ms) warn.push(port + ": commenced before all fast"); if (completed && commenced && completed.ms < commenced.ms) warn.push(port + ": completed before commenced"); if (hoses && completed && hoses.ms < completed.ms) warn.push(port + ": hoses disconnected before completion"); if (nor && allfast && allfast.ms < nor.ms) warn.push(port + ": all fast before NOR");
    if (!isNaN(startMs) && !isNaN(stopMs) && stopMs < startMs) warn.push(port + ": laytime stops before it starts");
    const grossMin = !isNaN(startMs) && !isNaN(stopMs) ? Math.max(0, Math.round((stopMs - startMs) / MIN)) : 0;
    const list = []; const hasShift = (rec.deductions || []).some((x) => x && x.kind === "shifting");
    if (terms.deductShifting && rec.shifting !== false && !hasShift && aweigh && allfast && allfast.ms > aweigh.ms) list.push({ id: "shifting", kind: "shifting", desc: "Berthing", from: aweigh.at, to: allfast.at, pct: 100, auto: true });
    for (const x of rec.deductions || []) if (x) list.push({ ...x });
    const sorted = list.map((x, i) => ({ x, i, ms: parse(x.from) })).sort((a, b) => (isNaN(a.ms) ? 1 : isNaN(b.ms) ? -1 : a.ms - b.ms || a.i - b.i));
    const out = []; let dedMin = 0;
    for (const { x } of sorted) {
      const pct = x.pct == null || x.pct === "" || isNaN(+x.pct) ? 100 : +x.pct; const share = x.counts === true ? 0 : pct / 100;
      const d = { id: x.id, kind: x.kind || "", desc: x.desc || "", label: x.desc || "", from: null, to: null, pct, hours: 0, minutes: 0, fixed: false, auto: !!x.auto, ignored: false, note: "" };
      if (x.hours != null && x.hours !== "" && !(x.from && x.to)) { d.fixed = true; d.minutes = Math.round(+x.hours * 60 * share); }
      else { let f = parse(x.from), t = parse(x.to); d.label = d.desc + " (" + pct + "%)"; if (isNaN(f) || isNaN(t)) { d.note = "needs from and to"; warn.push(port + ": deduction \"" + d.desc + "\" has no times"); } else { d.from = iso(f); d.to = iso(t); if (!isNaN(startMs)) f = Math.max(f, startMs); if (!isNaN(stopMs)) t = Math.min(t, stopMs); if (t > f) { d.from = iso(f); d.to = iso(t); const m = Math.round((t - f) / MIN); if (terms.onceOnDemurrage && allowedMin != null && !isNaN(startMs)) { const countedBefore = carriedMin + Math.round((f - startMs) / MIN) - dedMin; if (countedBefore >= allowedMin) { d.ignored = true; d.note = "once on demurrage, always on demurrage"; } } if (!d.ignored) d.minutes = Math.round(m * share); } else { d.note = "outside the counted time"; } } }
      d.hours = ltHours(d.minutes); dedMin += d.minutes; out.push(d);
    }
    const grossHours = ltHours(grossMin), deductedHours = r2(sum(out, (x) => x.hours)), netHours = r2(grossHours - deductedHours);
    return { id: rec.id || null, portId: rec.portId || null, port, activity: act, events: events.map((e) => ({ id: e.id, code: e.code, label: e.label, at: e.at })), nor: nor ? nor.at : null, commenced: commenced ? commenced.at : null, completed: completed ? completed.at : null, laytimeStart: isNaN(startMs) ? null : iso(startMs), startLabel, laytimeStop: isNaN(stopMs) ? null : iso(stopMs), stopLabel: "Laytime Stop" + (stopEv ? " (" + (stopEv.code === "hoses" ? "hoses off" : stopEv.code === "sailed" ? "sailed" : "completed") + ")" : ""), provisional: !stopEv, grossMinutes: grossMin, grossHours, usedHours: grossHours, deductions: out, deductedHours, netHours, notes: rec.notes || "", warnings: warn };
  }
  function laytimeStatement(voyage, fixture, records, opt) {
    opt = opt || {}; const vy = voyage || {}; const terms = laytimeTerms(vy, fixture); const warn = [];
    const orderOf = new Map((vy.ports || []).map((p, i) => [p.id, i]));
    const recs = (records || []).filter(Boolean).map(laytimeMigrate).sort((a, b) => (orderOf.has(a.portId) ? orderOf.get(a.portId) : 1e9) - (orderOf.has(b.portId) ? orderOf.get(b.portId) : 1e9));
    // a migrated single record may carry its own terms (allowed hours, start at commenced, stop at completion)
    if (recs.length === 1 && recs[0].migratedFrom && recs[0].terms && !(vy.laytime && Object.keys(vy.laytime).length)) { const t = recs[0].terms; if (t.allowedHours != null) { terms.allowedHours = t.allowedHours; terms.reversible = true; } terms.startRule = t.startRule || terms.startRule; terms.stopEvent = t.stopEvent || terms.stopEvent; }
    const n = recs.length || 1; const perPort = (rec) => (terms.allowedPerPort[rec.portId] != null && terms.allowedPerPort[rec.portId] !== "" ? +terms.allowedPerPort[rec.portId] : r2(terms.allowedHours / n));
    const ports = []; let carried = 0;
    for (const rec of recs) {
      const allowedH = terms.reversible ? terms.allowedHours : perPort(rec);
      const p = laytimePort(rec, terms, terms.reversible ? carried : 0, Math.round(allowedH * 60));
      if (terms.reversible) { p.allowedHours = null; p.kind = null; }
      else { p.allowedHours = allowedH; p.demurrageHours = Math.max(0, r2(p.netHours - allowedH)); p.despatchHours = terms.despatchRate > 0 && !p.provisional ? Math.max(0, r2(allowedH - p.netHours)) : 0; p.demurrage = r2(terms.demurrageRate * p.demurrageHours / 24); p.despatch = r2(terms.despatchRate * p.despatchHours / 24); p.kind = p.demurrageHours > 0 ? "demurrage" : p.despatchHours > 0 ? "despatch" : "within"; }
      carried += Math.round(p.netHours * 60); ports.push(p); warn.push(...p.warnings);
    }
    const grossHours = r2(sum(ports, (p) => p.grossHours)), deductedHours = r2(sum(ports, (p) => p.deductedHours)), netHours = r2(grossHours - deductedHours);
    const complete = ports.length > 0 && ports.every((p) => !p.provisional);
    let demurrageHours, despatchHours, demurrage, despatch;
    if (terms.reversible) { demurrageHours = Math.max(0, r2(netHours - terms.allowedHours)); despatchHours = terms.despatchRate > 0 && complete ? Math.max(0, r2(terms.allowedHours - netHours)) : 0; demurrage = r2(terms.demurrageRate * demurrageHours / 24); despatch = r2(terms.despatchRate * despatchHours / 24); }
    else { demurrageHours = r2(sum(ports, (p) => p.demurrageHours || 0)); despatchHours = r2(sum(ports, (p) => p.despatchHours || 0)); demurrage = r2(sum(ports, (p) => p.demurrage || 0)); despatch = r2(sum(ports, (p) => p.despatch || 0)); }
    const addressCommission = r2(demurrage * terms.addressCommission / 100), brokerage = r2(demurrage * terms.brokerage / 100);
    const demurrageDue = r2(demurrage - addressCommission - brokerage), despatchDue = despatch;
    const kind = demurrage - despatch > 0.005 ? "demurrage" : despatch > 0.005 ? "despatch" : demurrageHours > 0 ? "demurrage" : "within";
    const remarks = [].concat(String(terms.remarks || "").split("\n").map((s) => s.trim()).filter(Boolean), terms.reversible ? ["Laytime calculation basis entire voyage."] : ["Laytime calculated per port (non-reversible)."]).map((s, i) => "(" + (i + 1) + ") " + s);
    return { voyageId: vy.id || null, fixtureId: (fixture && fixture.id) || null, currency: terms.currency, terms, reversible: terms.reversible, allowedHours: terms.allowedHours, noticeHours: terms.noticeHours, ports, grossHours, deductedHours, netHours, demurrageHours, despatchHours, demurrageRate: terms.demurrageRate, despatchRate: terms.despatchRate, demurrage, despatch, addressCommissionPct: terms.addressCommission, addressCommission, brokeragePct: terms.brokerage, brokerage, brokers: (() => { const bs = brokersOf(fixture); return bs.length > 1 && Math.abs(bs.reduce((k, b) => k + b.pct, 0) - terms.brokerage) < 1e-6 ? bs.map((b) => ({ ...b, amount: r2(demurrage * b.pct / 100) })) : []; })(), demurrageDue, despatchDue, kind, complete, warnings: warn, remarks, now: opt.now || null };
  }
  // the invoice lines of a statement: one per voyage when reversible, one per port otherwise; opt.commissions adds the deductions of the sheet
  function laytimeLines(st, opt) {
    opt = opt || {}; const ccy = st.currency; const lines = []; const basis = st.reversible ? " basis entire voyage" : "";
    const dem = (label, h, amount) => lines.push({ kind: "demurrage", description: "Demurrage" + label + ": " + h.toFixed(2) + " hours at " + fmtMoney(st.demurrageRate, ccy) + "/day" + basis, qty: r6(h / 24), unit: "day", price: st.demurrageRate, amount });
    const des = (label, h, amount) => lines.push({ kind: "despatch", description: "Despatch" + label + ": " + h.toFixed(2) + " hours at " + fmtMoney(st.despatchRate, ccy) + "/day" + basis, qty: -r6(h / 24), unit: "day", price: st.despatchRate, amount: -Math.abs(amount) });
    if (st.reversible) { if (st.demurrageHours > 0 && st.demurrage) dem("", st.demurrageHours, st.demurrage); if (st.despatchHours > 0 && st.despatch) des("", st.despatchHours, st.despatch); }
    else for (const p of st.ports) { if (p.kind === "demurrage" && p.demurrage) dem(" " + p.port, p.demurrageHours, p.demurrage); if (p.kind === "despatch" && p.despatch) des(" " + p.port, p.despatchHours, p.despatch); }
    if (opt.commissions && st.demurrage) { if (st.addressCommission) lines.push({ kind: "address-commission", description: "Less address commission " + fmtH(st.addressCommissionPct) + "% on demurrage " + fmtMoney(st.demurrage, ccy), qty: -1, unit: "each", price: st.addressCommission, amount: -st.addressCommission }); if (st.brokerage && st.brokers && st.brokers.length > 1) { for (const b of st.brokers) if (b.amount) lines.push({ kind: "brokerage", cpId: b.cpId, description: "Less brokerage " + fmtH(b.pct) + "% on demurrage " + fmtMoney(st.demurrage, ccy) + (opt.cpName && b.cpId ? " · " + opt.cpName(b.cpId) : ""), qty: -1, unit: "each", price: b.amount, amount: -b.amount }); } /* 4.32.2 · one line per broker */ else if (st.brokerage) lines.push({ kind: "brokerage", description: "Less brokerage " + fmtH(st.brokeragePct) + "% on demurrage " + fmtMoney(st.demurrage, ccy), qty: -1, unit: "each", price: st.brokerage, amount: -st.brokerage }); }
    return lines;
  }
  // the model of the printed sheet (DOCS.vesselReport): header, one events-and-deductions table per port, the summary, the remarks
  function laytimeDocument(st, opt) {
    opt = opt || {}; const ccy = st.currency; const money = (n) => (opt.money === false ? "—" : fmtMoney(n, ccy)); const at = (s) => (s ? fmtAt(s) : "—"); const h = (n) => (+n || 0).toFixed(2);
    const cargo = opt.cargo || {}; const loads = st.ports.filter((p) => p.activity === "load").map((p) => p.port), dis = st.ports.filter((p) => p.activity === "discharge").map((p) => p.port);
    const meta = [["Vessel", opt.vesselName ? MV(opt.vesselName) : ""], opt.voyageNo ? ["Voyage", String(opt.voyageNo)] : null, opt.chartererName ? ["Charterers", opt.chartererName] : null, opt.cpDate ? ["Charter party", fmtDate(opt.cpDate)] : null, ["Allowed laytime", h(st.allowedHours) + " hours" + (st.reversible ? ", reversible" : ", per port")], ["Demurrage rate", money(st.demurrageRate) + " PDPR"], st.despatchRate ? ["Despatch rate", money(st.despatchRate) + " per day"] : null, cargo.commodity ? ["Cargo", cargo.commodity + (cargo.qty ? ", " + fmtQty(cargo.qty) + " " + (cargo.unit || "MT") : "")] : null, loads.length ? ["Load port", loads.join(" / ")] : null, dis.length ? ["Discharge port", dis.join(" / ")] : null].filter(Boolean);
    const sections = [];
    for (const p of st.ports) {
      const items = p.events.map((e) => ({ label: e.label, at: e.at, k: 0 })); if (p.laytimeStart) items.push({ label: p.startLabel, at: p.laytimeStart, k: 1 }); if (p.laytimeStop) items.push({ label: p.stopLabel, at: p.laytimeStop, k: 2 });
      items.sort((a, b) => parse(a.at) - parse(b.at) || a.k - b.k);
      const rows = []; const nrow = Math.max(items.length, p.deductions.length); for (let i = 0; i < nrow; i++) { const e = items[i], dd = p.deductions[i]; rows.push([e ? e.label : "", e ? at(e.at) : "", dd ? dd.label + (dd.ignored ? " — not deducted" : "") : "", dd && dd.from ? at(dd.from) : "", dd && dd.to ? at(dd.to) : "", dd ? h(dd.hours) : ""]); }
      sections.push({ heading: (p.activity === "load" ? "Load port" : p.activity === "discharge" ? "Discharge port" : "Port") + " — " + p.port + (p.provisional ? " (provisional)" : ""), table: { cols: ["Events", "Date / time", "Deduction", "From", "To", "Hours"], rows, totals: ["", "", "Deducted", "", "", h(p.deductedHours)] } });
    }
    const perPort = []; for (const p of st.ports) { perPort.push([(p.activity === "load" ? "Load port" : p.activity === "discharge" ? "Discharge port" : "Port") + " — " + p.port, ""], ["Laytime start", at(p.laytimeStart)], ["Laytime stop", at(p.laytimeStop)], ["Laytime used", h(p.usedHours) + " h"]); if (!st.reversible) perPort.push(["Allowed", h(p.allowedHours) + " h"], [p.kind === "demurrage" ? "Time on demurrage" : p.kind === "despatch" ? "Time saved" : "Within laytime", p.kind === "demurrage" ? h(p.demurrageHours) + " h" : p.kind === "despatch" ? h(p.despatchHours) + " h" : ""]); }
    sections.push({ heading: "Time per port", kv: perPort.map(([k, v]) => [k, v === "" ? " " : v]) });
    const summary = [["Gross time used", h(st.grossHours) + " h"], ["Total deducted time", h(st.deductedHours) + " h"], ["Net time used", h(st.netHours) + " h"], ["Allowed laytime", h(st.allowedHours) + " h"]];
    if (st.kind === "despatch") summary.push(["Time saved", h(st.despatchHours) + " h"], ["Despatch rate", money(st.despatchRate)], ["Despatch due", money(st.despatchDue)]);
    else summary.push(["Time on demurrage", h(st.demurrageHours) + " h"], ["Demurrage rate", money(st.demurrageRate)], ["Total demurrage", money(st.demurrage)], ["Less " + fmtH(st.addressCommissionPct) + "% address commission", money(st.addressCommission)], ["Less " + fmtH(st.brokeragePct) + "% brokers commission", money(st.brokerage)], ["Demurrage due", money(st.demurrageDue)]);
    sections.push({ heading: "Summary", kv: summary });
    const remarks = st.remarks.concat(st.warnings.map((w) => "Note: " + w)); if (!st.complete) remarks.push("Provisional — not every port has completed.");
    sections.push({ heading: "Remarks", text: remarks.join(" ") });
    return { title: "Laytime calculation", meta, subtitle: (opt.vesselName ? MV(opt.vesselName) + " · " : "") + (opt.voyageNo ? "voyage " + opt.voyageNo + " · " : "") + (st.kind === "demurrage" ? "demurrage " + money(st.demurrageDue) : st.kind === "despatch" ? "despatch " + money(st.despatchDue) : "within laytime"), sections, statement: st };
  }

  // ---------- voyage estimate
  function voyageEstimate(voyage, vessel, fixture, opt) {
    opt = opt || {}; const v = voyage || {}; const ves = vessel || {}; const f = fixture || {}; const ports = v.ports || [];
    // 4.24 · the legs the app computed (great-circle or routed distances, speeds per condition) when it passes them; else the saved overrides
    const legs = Array.isArray(opt.legs) && opt.legs.length ? opt.legs.map((l) => ({ fromPortId: l.from && l.from.id, toPortId: l.to && l.to.id, distanceNm: l.nm != null ? l.nm : l.distanceNm, speed: l.speed, routeVia: l.via || l.routeVia, days: l.days })) : (v.legs || []);
    const grades = ves.grades && ves.grades.length ? ves.grades : ["VLSFO", "LSMGO"]; const gSea = grades[0], gPort = grades[1] || grades[0];
    // prices are kept per grade, or as main/aux (the voyage form) — both read
    const raw = Object.assign({}, (f.bunkers && f.bunkers.prices) || {}, (v.bunkers && v.bunkers.prices) || {}); const prices = { ...raw }; if (!prices[gSea] && raw.main) prices[gSea] = raw.main; if (!prices[gPort] && raw.aux) prices[gPort] = raw.aux; if (!prices[gPort] && gPort === gSea && raw.main) prices[gPort] = raw.main;
    const portOf = (id) => ports.find((p) => p.id === id) || null;
    let laden = false; const legRows = []; let seaMin = 0; const bunkers = { [gSea]: 0, [gPort]: 0 };
    for (const l of legs) { const from = portOf(l.fromPortId), to = portOf(l.toPortId); if (from && from.activity === "load") laden = true; if (from && from.activity === "discharge") laden = false; const speed = +l.speed || (laden ? +ves.speedLaden : +ves.speedBallast) || 12; const dist = +l.distanceNm || 0; const dys = l.days != null && l.days !== "" ? +l.days : dist / (speed * 24); const m = Math.round(dys * DAYM); seaMin += m; const cons = laden ? (+ves.consLaden || 0) : (+ves.consBallast || 0); bunkers[gSea] += cons * dys; legRows.push({ from: from ? from.name : "", to: to ? to.name : "", laden, distanceNm: dist, speed, days: r4(dys), via: l.routeVia || "direct", bunkers: r2(cons * dys) }); }
    let portMin = 0; const portRows = []; let portDa = 0;
    for (const p of ports) { const a = p.ata || p.eta, d = p.atd || p.etd; let m = a && d ? Math.max(0, minutes(a, d)) : Math.round((+p.days || (p.activity === "load" || p.activity === "discharge" ? 1.5 : p.activity === "canal" ? 1 : 0.5)) * DAYM); portMin += m; const cons = +ves.consPort || 0; bunkers[gPort] += cons * m / DAYM; portDa += +p.da || 0; portRows.push({ name: p.name, activity: p.activity || "", days: r4(m / DAYM), da: +p.da || 0, bunkers: r2(cons * m / DAYM) }); }
    const bunkerRows = Object.keys(bunkers).filter((g) => bunkers[g] > 0).map((g) => ({ grade: g, qty: r2(bunkers[g]), price: +prices[g] || 0, cost: r2(bunkers[g] * (+prices[g] || 0)) }));
    const bunkerCost = r2(sum(bunkerRows, (b) => b.cost));
    const costRows = (v.costs || []).filter((c) => +c.amount).map((c) => ({ kind: c.kind || "other", label: c.label || c.kind || "cost", amount: r2(+c.amount) }));
    const otherCosts = r2(sum(costRows, (c) => c.amount));
    const totalMin = seaMin + portMin; const totalDays = totalMin / DAYM;
    // 4.32.2 · the cargo is every parcel's quantity; freight is summed per parcel (a parcel's own rate, else the fixture's); the charterer-paid extras are revenue without commission
    const parcels = f.kind === "voyage" || !f.kind ? parcelsOf(f) : []; const multi = parcels.length > 1;
    const cargoQty = +((v.cargoQty != null && !multi ? v.cargoQty : multi ? cargoTotals(f).qty : f.cargo && f.cargo.qty) || 0);
    let revenue, hireRevenue = 0, freightRevenue = 0;
    if (f.kind === "tc" || f.kind === "bareboat") { const hf = hasRateSteps(f) ? parse(opt.hireFrom || "") : NaN; /* 4.34.7 · several rates: the days of this voyage at the rate in force on each (its start is needed; without one, the first rate) */ hireRevenue = isNaN(hf) ? r2((+f.rate || 0) * totalMin / DAYM + (+f.ballastBonus || 0)) : r2(hireGross(f, opt.offhires || [], iso(hf), iso(hf + Math.round(totalMin) * MIN)) + (+f.ballastBonus || 0)); revenue = hireRevenue; }
    else if (multi) { freightRevenue = r2(parcels.reduce((k, p) => { const pr = parcelRate(f, p); return k + (pr.unit === "lumpsum" ? pr.rate : pr.rate * (+p.qty || 0)); }, 0)); revenue = freightRevenue; }
    else { freightRevenue = f.rateUnit === "lumpsum" ? r2(+f.rate || 0) : r2((+f.rate || 0) * cargoQty); revenue = freightRevenue; }
    const extra = v.revenue || {}; revenue = r2(revenue + (+extra.demurrage || 0) + (+extra.other || 0));
    const commPct = (+f.addressCommission || 0) + brokeragePct(f); const commissions = r2(revenue * commPct / 100);
    const extrasRevenue = extrasTotal(f); revenue = r2(revenue + extrasRevenue);
    const voyageCosts = r2(bunkerCost + portDa + otherCosts);
    const result = r2(revenue - commissions - voyageCosts);
    const tce = totalDays > 0 ? r2(result / totalDays) : 0;
    const breakEvenFreight = cargoQty > 0 && f.kind !== "tc" ? r2(voyageCosts / (cargoQty * (1 - commPct / 100))) : null;
    return { currency: f.currency || v.currency || "USD", seaDays: r4(seaMin / DAYM), portDays: r4(portMin / DAYM), totalDays: r4(totalDays), legs: legRows, ports: portRows, bunkers: bunkerRows, bunkerCost, portDa: r2(portDa), otherCosts, costRows, costs: voyageCosts, commissions, commissionPct: commPct, revenue, hireRevenue, freightRevenue, extrasRevenue, cargoQty, parcels: parcels.length, result, tce, breakEvenFreight };
  }

  // ---------- the book, per vessel
  const docOpen = (d) => (d.pending ? 0 : r2((+d.amount || 0) - (+d.paid || 0) - (+d.credited || 0)));
  const dStatus = (d, today) => (d.pending ? "not delivered" : docOpen(d) < 0.01 ? (d.credited && d.credited >= d.amount - 0.005 ? "credited" : "paid") : d.due < today ? "overdue" : "open");
  const tradeOf = (store, id) => (store && id ? index(store).tradeById.get(id) || null : null);
  const inRange = (date, range) => !range || ((!range.from || date >= range.from) && (!range.to || date <= range.to));
  const len = (a) => (Array.isArray(a) ? a.length : 0);

  // ---------- indexes
  // The book index: every document, bank line, journal and trade grouped by vessel, plus id maps. Built once per book revision
  // (engine.invalidate bumps store.__rev; the collection lengths guard the rest) and kept in a WeakMap keyed by the store object,
  // so a cloud reload (a new object) starts fresh. With 50,000 documents it builds in a few tens of milliseconds.
  const STORE_IDX = new WeakMap(), PS_IDX = new WeakMap();
  // 4.21.2 · presentation currency. Shipping measures in one currency (ps.settings.currency, USD by default) whatever currency
  // each entity keeps its books in (DKK, AED…). The books stay in the entity currency for audit; PROSHIP converts for display
  // at the daily table's rate on the document date (engine.fxRateOn semantics, kept Node-safe here), falling back to the
  // entity's group rate when the table has no pair, and flags what it could not convert rather than mixing currencies.
  const presCcy = (ps, opt) => String((opt && opt.currency) || (ps && ps.settings && ps.settings.currency) || "USD").toUpperCase();
  function fxOn(store, from, to, date) {
    from = String(from || "").toUpperCase(); to = String(to || "").toUpperCase(); if (!from || !to || from === to) return 1; const meta = (store && store.meta) || {};
    const hist = meta.fxHistory || {}; const cur = meta.fx; const d = String(date || "").slice(0, 10);
    const conv = (base, rates) => { if (!rates) return null; const rf = from === base ? 1 : rates[from], rt = to === base ? 1 : rates[to]; if (!rf || !rt) return null; return Math.round((rt / rf) * 1e9) / 1e9; };
    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) { const keys = Object.keys(hist).filter((k) => k <= d).sort(); for (let i = keys.length - 1; i >= 0; i--) { const r = conv((cur && cur.base) || "USD", hist[keys[i]]); if (r) return r; } }
    return cur ? conv(cur.base || "USD", cur.rates) : null;
  }
  // rate from an entity's book currency into the presentation currency on a date; null when nothing is known
  function presRate(store, ent, pres, date) {
    const book = String((ent && ent.currency) || "USD").toUpperCase(); pres = String(pres || "USD").toUpperCase(); if (book === pres) return 1;
    const r = fxOn(store, book, pres, date); if (r) return r;
    const rc = String((store && store.meta && store.meta.reportingCurrency) || "USD").toUpperCase();
    if (pres === rc && ent && +ent.groupFx > 0 && ent.groupFx !== 1) return +ent.groupFx;
    if (book === rc && store && store.entities) { const other = store.entities.find((e) => String(e.currency || "").toUpperCase() === pres && +e.groupFx > 0); if (other) return Math.round((1 / +other.groupFx) * 1e9) / 1e9; }
    if (ent && +ent.groupFx > 0 && ent.groupFx !== 1 && store && store.entities) { const other = store.entities.find((e) => String(e.currency || "").toUpperCase() === pres && +e.groupFx > 0 && (e.groupFx !== 1 || String(e.currency || "").toUpperCase() === rc)); if (other) return Math.round((+ent.groupFx / +other.groupFx) * 1e9) / 1e9; }
    if (date) return null; const t = store && store.meta && store.meta.fx && store.meta.fx.rates; if (t && t[book] && t[pres]) return Math.round((+t[pres] / +t[book]) * 1e9) / 1e9; /* the latest daily table: both against its base */
    return null;
  }
  // a memoised converter for one entity: rate(date) and whether anything stayed unconverted
  function presConverter(store, ent, pres) { const cache = new Map(); const c = { book: String((ent && ent.currency) || "USD").toUpperCase(), pres, same: false, unconverted: false, asked: 0, rate(date) { c.asked++; const k = String(date || "").slice(0, 10); if (cache.has(k)) return cache.get(k); let r = presRate(store, ent, pres, k); if (r == null) { r = presRate(store, ent, pres, null); /* the latest rate when the day has none */ if (r == null) { c.unconverted = true; r = 1; } } cache.set(k, r); return r; } }; c.same = c.book === pres; return c; }
  // the table's own signature so memoised figures refresh when a new day's rates arrive
  const fxSig = (s) => { const m = s.meta || {}; return ((m.fx && m.fx.date) || "") + ":" + (m.fxHistory ? Object.keys(m.fxHistory).length : 0) + ":" + (m.reportingCurrency || ""); };
  const storeSig = (s) => fxSig(s) + ":" + (s.__rev || 0) + ":" + len(s.invoices) + ":" + len(s.bills) + ":" + len(s.bankTx) + ":" + len(s.ledger) + ":" + len(s.trades) + ":" + len(s.cargoes) + ":" + len(s.vessels) + ":" + len(s.counterparties) + ":" + len(s.entities) + ":" + len(s.banks) + ":" + len(s.payments) + ":" + len(s.documents);
  const push = (m, k, v) => { if (k == null || k === "") return; const a = m.get(k); if (a) a.push(v); else m.set(k, [v]); };
  function index(store) {
    store = store || {}; const sig = storeSig(store); const hit = STORE_IDX.get(store); if (hit && hit.sig === sig) return hit;
    const byId = (arr) => { const m = new Map(); for (const x of arr || []) if (x && x.id) m.set(x.id, x); return m; };
    const tradeById = byId(store.trades), cargoById = byId(store.cargoes), invoiceById = byId(store.invoices), billById = byId(store.bills), txById = byId(store.bankTx), bankById = byId(store.banks), entityById = byId(store.entities), cpById = byId(store.counterparties), vesselById = byId(store.vessels), journalById = byId(store.ledger);
    const tradeVessel = (t) => (t && t.vesselId) || null;
    const docVessel = (d) => { if (!d) return null; if (d.vesselId) return d.vesselId; const t = d.tradeId ? tradeById.get(d.tradeId) : null; if (t && t.vesselId) return t.vesselId; if (d.cargoId) { const c = cargoById.get(d.cargoId); const t2 = c && c.createdFromTradeId ? tradeById.get(c.createdFromTradeId) : null; if (t2 && t2.vesselId) return t2.vesselId; } return null; };
    const docFixture = (d) => { if (!d) return null; if (d.fixtureId) return d.fixtureId; const t = d.tradeId ? tradeById.get(d.tradeId) : null; return (t && t.fixtureId) || null; };
    // 4.14 · the voyage a document belongs to: tagged, through its trade, or named in the fixture panel's meta
    const docVoyage = (d) => { if (!d) return null; if (d.voyageId) return d.voyageId; const t = d.tradeId ? tradeById.get(d.tradeId) : null; if (t && t.voyageId) return t.voyageId; const m = d.meta || (t && t.meta); return (m && m.voyageId) || null; };
    const invoicesByVessel = new Map(), billsByVessel = new Map(), bankTxByVessel = new Map(), journalsByVessel = new Map(), tradesByVessel = new Map(), invoicesByFixture = new Map(), paymentsByInvoice = new Map(), creditNotesByInvoice = new Map(), invoicesByCp = new Map(), billsByCp = new Map();
    const invoicesByVoyage = new Map(), billsByVoyage = new Map(), bankTxByVoyage = new Map(), journalsByVoyage = new Map(), paymentsByBill = new Map();
    const paymentsByVessel = new Map(), paymentsByVoyage = new Map(), paymentsByFixture = new Map(), paymentsByCp = new Map(), onAccountByCp = new Map();
    const sameAll = (list, k) => new Set(list.map((a) => a[k] || null)).size === 1;
    const shareOf = (doc, a) => { const f = doc.amount ? a.amount / doc.amount : 0; return { ...doc, amount: r2(a.amount), net: r2((+doc.net || +doc.amount || 0) * f), vat: r2((+doc.vat || 0) * f), paid: r2((+doc.paid || 0) * f), credited: r2((+doc.credited || 0) * f), vesselId: a.vesselId || null, voyageId: a.voyageId || null, fixtureId: a.fixtureId || null, category: a.category || doc.category, share: true, allocation: a, shareOf: doc.id }; };
    const docVesselMap = new Map(), journalVesselMap = new Map(), docVoyageMap = new Map(), journalVoyageMap = new Map();
    for (const t of store.trades || []) push(tradesByVessel, tradeVessel(t), t);
    for (const i of store.invoices || []) { const v = docVessel(i); docVesselMap.set(i.id, v); push(invoicesByVessel, v, i); push(invoicesByFixture, docFixture(i), i); push(invoicesByCp, i.counterpartyId, i); const vy = docVoyage(i); docVoyageMap.set(i.id, vy); push(invoicesByVoyage, vy, i); }
    for (const b of store.bills || []) { if (b.allocations && b.allocations.length && !sameAll(b.allocations, "vesselId")) { docVesselMap.set(b.id, null); docVoyageMap.set(b.id, null); push(billsByCp, b.counterpartyId, b); for (const a of b.allocations) { const sh = shareOf(b, a); push(billsByVessel, a.vesselId || null, sh); push(billsByVoyage, a.voyageId || null, sh); } continue; } const v = docVessel(b); docVesselMap.set(b.id, v); push(billsByVessel, v, b); push(billsByCp, b.counterpartyId, b); const vy = docVoyage(b); docVoyageMap.set(b.id, vy); push(billsByVoyage, vy, b); }
    // 4.19 · a bank line or a bill split across vessels (allocations) is held as one SHARE per vessel/voyage; its docVessel is null
    for (const t of store.bankTx || []) { if (t.allocations && t.allocations.length) { for (const a of t.allocations) { const sh = shareOf(t, a); push(bankTxByVessel, a.vesselId || null, sh); push(bankTxByVoyage, a.voyageId || null, sh); } continue; } push(bankTxByVessel, t.vesselId || null, t); push(bankTxByVoyage, t.voyageId || null, t); }
    const journalVessel = (j) => { const r = j.ref || {}; if (r.vesselId) return r.vesselId; if (r.tradeId) { const t = tradeById.get(r.tradeId); if (t && t.vesselId) return t.vesselId; } if (r.invoiceId) { const v = docVesselMap.get(r.invoiceId) || docVessel(invoiceById.get(r.invoiceId)); if (v) return v; } if (r.billId) { const v = docVesselMap.get(r.billId) || docVessel(billById.get(r.billId)); if (v) return v; } if (r.txId) { const tx = txById.get(r.txId); if (tx && tx.vesselId) return tx.vesselId; } return null; };
    const journalVoyage = (j) => { const r = j.ref || {}; if (r.voyageId) return r.voyageId; if (r.tradeId) { const t = tradeById.get(r.tradeId); if (t && t.voyageId) return t.voyageId; } if (r.invoiceId && docVoyageMap.has(r.invoiceId)) return docVoyageMap.get(r.invoiceId); if (r.billId && docVoyageMap.has(r.billId)) return docVoyageMap.get(r.billId); if (r.txId) { const tx = txById.get(r.txId); if (tx && tx.voyageId) return tx.voyageId; } return null; };
    for (const j of store.ledger || []) { const v = journalVessel(j); journalVesselMap.set(j.id, v); push(journalsByVessel, v, j); const vy = journalVoyage(j); journalVoyageMap.set(j.id, vy); push(journalsByVoyage, vy, j); }
    for (const p of store.payments || []) { push(paymentsByInvoice, p.invoiceId, p); if (p.billId) push(paymentsByBill, p.billId, p); if (p.reversed) continue; const pv = p.vesselId || (p.invoiceId ? docVesselMap.get(p.invoiceId) : p.billId ? docVesselMap.get(p.billId) : null) || null; push(paymentsByVessel, pv, p); push(paymentsByVoyage, p.voyageId || (p.invoiceId ? docVoyageMap.get(p.invoiceId) : p.billId ? docVoyageMap.get(p.billId) : null) || null, p); push(paymentsByFixture, p.fixtureId || (p.invoiceId ? (invoiceById.get(p.invoiceId) || {}).fixtureId : null) || null, p); push(paymentsByCp, p.counterpartyId || null, p); if (p.onAccount && r2(p.amount - (p.applied || 0)) > 0.005) push(onAccountByCp, p.counterpartyId || null, p); }
    for (const d of store.documents || []) if (d.type === "creditnote") push(creditNotesByInvoice, d.invoiceId, d);
    const idx = { sig, tradeById, cargoById, invoiceById, billById, txById, bankById, entityById, cpById, vesselById, journalById, invoicesByVessel, billsByVessel, bankTxByVessel, journalsByVessel, tradesByVessel, invoicesByFixture, paymentsByInvoice, creditNotesByInvoice, invoicesByCp, billsByCp, docVessel: (d) => (d && d.id && docVesselMap.has(d.id) ? docVesselMap.get(d.id) : docVessel(d)), journalVessel: (j) => (j && j.id && journalVesselMap.has(j.id) ? journalVesselMap.get(j.id) : journalVessel(j)),
      invoicesByVoyage, billsByVoyage, bankTxByVoyage, journalsByVoyage, paymentsByBill, paymentsByVessel, paymentsByVoyage, paymentsByFixture, paymentsByCp, onAccountByCp, docVoyage: (d) => (d && d.id && docVoyageMap.has(d.id) ? docVoyageMap.get(d.id) : docVoyage(d)), journalVoyage: (j) => (j && j.id && journalVoyageMap.has(j.id) ? journalVoyageMap.get(j.id) : journalVoyage(j)) };
    STORE_IDX.set(store, idx); return idx;
  }
  // the PROSHIP document index: fixtures by vessel (sorted by delivery, cancelled ones out), off-hire by fixture, the rest by vessel
  const psSig = (d) => (d.__rev || 0) + ":" + len(d.vessels) + ":" + len(d.fixtures) + ":" + len(d.offhire) + ":" + len(d.voyages) + ":" + len(d.laytime) + ":" + len(d.claims) + ":" + len(d.marketRates) + ":" + len(d.strategies) + ":" + len(d.compliance) + ":" + len(d.reports) + ":" + len(d.lists) + ":" + len(d.das) + ":" + len(d.bunkerLog) + ":" + len(d.noonReports) + ":" + len(d.hireStatements) + ":" + len(d.portCalls) + ":" + len(d.voyageTasks);
  function psIndex(ps) {
    ps = ps || {}; const sig = psSig(ps); const hit = PS_IDX.get(ps); if (hit && hit.sig === sig) return hit;
    const fixturesByVessel = new Map(), offhireByFixture = new Map(), offhireLooseByVessel = new Map(), offhireByVessel = new Map(), complianceByVessel = new Map(), claimsByVessel = new Map(), voyagesByVessel = new Map(), strategiesByVessel = new Map(), reportsByVessel = new Map(), laytimeByVoyage = new Map(); const vesselById = new Map(), fixtureById = new Map();
    for (const v of ps.vessels || []) if (v && v.id) vesselById.set(v.id, v);
    for (const f of ps.fixtures || []) { if (!f || !f.id) continue; fixtureById.set(f.id, f); if (f.status !== "cancelled") push(fixturesByVessel, f.vesselId, f); }
    for (const a of fixturesByVessel.values()) a.sort((x, y) => (parse(delAt(x)) || 0) - (parse(delAt(y)) || 0));
    for (const o of ps.offhire || []) { if (!o) continue; if (o.fixtureId) push(offhireByFixture, o.fixtureId, o); else push(offhireLooseByVessel, o.vesselId, o); push(offhireByVessel, o.vesselId || (fixtureById.get(o.fixtureId) || {}).vesselId, o); }
    for (const c of ps.compliance || []) push(complianceByVessel, c && c.vesselId, c);
    for (const c of ps.claims || []) push(claimsByVessel, c && c.vesselId, c);
    for (const v of ps.voyages || []) push(voyagesByVessel, v && v.vesselId, v);
    for (const x of ps.strategies || []) push(strategiesByVessel, x && x.vesselId, x);
    for (const x of ps.reports || []) push(reportsByVessel, x && x.vesselId, x);
    for (const x of ps.laytime || []) push(laytimeByVoyage, x && x.voyageId, x);
    // 4.14 · voyages by id, disbursement accounts, the bunker log, noon reports and claims by voyage
    const voyageById = new Map(), dasByVoyage = new Map(), dasByVessel = new Map(), bunkerLogByVessel = new Map(), bunkerLogByVoyage = new Map(), noonByVessel = new Map(), noonByVoyage = new Map(), claimsByVoyage = new Map(), portCallsByVoyage = new Map();
    for (const v of ps.voyages || []) if (v && v.id) voyageById.set(v.id, v);
    for (const x of ps.das || []) { if (!x) continue; push(dasByVoyage, x.voyageId, x); push(dasByVessel, x.vesselId || (voyageById.get(x.voyageId) || {}).vesselId, x); }
    for (const x of ps.bunkerLog || []) { if (!x) continue; push(bunkerLogByVessel, x.vesselId || (voyageById.get(x.voyageId) || {}).vesselId, x); push(bunkerLogByVoyage, x.voyageId, x); }
    for (const a of bunkerLogByVessel.values()) a.sort((x, y) => (parse(x.at) || 0) - (parse(y.at) || 0));
    for (const x of ps.noonReports || []) { if (!x) continue; push(noonByVessel, x.vesselId || (voyageById.get(x.voyageId) || {}).vesselId, x); push(noonByVoyage, x.voyageId, x); }
    for (const a of noonByVessel.values()) a.sort((x, y) => (parse(x.at) || 0) - (parse(y.at) || 0));
    for (const c of ps.claims || []) push(claimsByVoyage, c && c.voyageId, c);
    for (const x of ps.portCalls || []) push(portCallsByVoyage, x && x.voyageId, x);
    const marketRates = (ps.marketRates || []).filter((m) => m && m.date).slice().sort((a, b) => (a.date < b.date ? -1 : 1));
    const idx = { sig, vesselById, fixtureById, fixturesByVessel, offhireByFixture, offhireLooseByVessel, offhireByVessel, complianceByVessel, claimsByVessel, voyagesByVessel, strategiesByVessel, reportsByVessel, laytimeByVoyage, marketRates, voyageById, dasByVoyage, dasByVessel, bunkerLogByVessel, bunkerLogByVoyage, noonByVessel, noonByVoyage, claimsByVoyage, portCallsByVoyage };
    PS_IDX.set(ps, idx); return idx;
  }
  // `touch(doc)` marks a document changed in place (same lengths): the app calls it from PS.onChange, the book from engine.invalidate
  const touch = (doc) => { if (doc && typeof doc === "object") { try { Object.defineProperty(doc, "__rev", { value: (doc.__rev || 0) + 1, writable: true, enumerable: false, configurable: true }); } catch (e) { doc.__rev = (doc.__rev || 0) + 1; } } return doc; };
  // memo: results keyed by the two signatures + arguments; bounded, cleared wholesale when it grows
  const MEMO = new Map(); const MEMO_MAX = 20000;
  const memo = (key, make) => { const hit = MEMO.get(key); if (hit !== undefined) return hit; const v = make(); if (MEMO.size >= MEMO_MAX) MEMO.clear(); MEMO.set(key, v); return v; };
  const rangeKey = (r) => (r ? (r.from || "") + "~" + (r.to || "") : "");
  const idsKey = (ids) => { let h = 2166136261; for (const id of ids) { for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 16777619); } h ^= 124; } return ids.length + ":" + (h >>> 0).toString(36); };

  const vesselOfDoc = (store, d) => (store ? index(store).docVessel(d) : (d && d.vesselId) || null);
  const vesselOfJournal = (store, j) => (store ? index(store).journalVessel(j) : ((j && j.ref && j.ref.vesselId) || null));
  // 4.19 · how a document's amount falls on vessels: one entry for an ordinary document, one per allocation for a split one
  function vesselSharesOf(store, d) { const m = new Map(); if (!d) return m; if (d.allocations && d.allocations.length) { for (const a of d.allocations) m.set(a.vesselId || null, r2((m.get(a.vesselId || null) || 0) + a.amount)); return m; } m.set(vesselOfDoc(store, d), r2(+d.amount || 0)); return m; }

  // ---------- a vessel's finances out of the book (one pass over the vessel's own documents, from the index)
  function financeCore(ps, store, vesselId, range, opt) {
    opt = opt || {}; store = store || {}; const ix = index(store); const today = opt.today || isoDate(Date.now());
    const invoices = (ix.invoicesByVessel.get(vesselId) || []).filter((i) => inRange(i.date, range));
    const bills = (ix.billsByVessel.get(vesselId) || []).filter((b) => inRange(b.date, range));
    const bankTx = (ix.bankTxByVessel.get(vesselId) || []).filter((t) => inRange(t.date, range));
    const journals = (ix.journalsByVessel.get(vesselId) || []).filter((j) => !j.reversedBy && inRange(j.date, range));
    const psv = (ps ? psIndex(ps).vesselById.get(vesselId) : null) || {};
    const entId = psv.managerEntityId || (invoices[0] || bills[0] || bankTx[0] || journals[0] || {}).entityId || null;
    const ent = ix.entityById.get(entId) || null; const pres = presCcy(ps, opt); const cv = presConverter(store, ent, pres); const currency = pres, bookCurrency = cv.book;
    // a document's fx takes it into the entity's books; the converter takes the books into the presentation currency on that day
    const fxOf = (d) => (+d.fx > 0 ? +d.fx : 1) * cv.rate(d.date);
    const bankRate = (tx) => { const b = ix.bankById.get(tx.bankId); return (b && +b.fx > 0 ? +b.fx : 1) * cv.rate(tx.date); };
    const byCategory = {}; const add = (k, v) => { byCategory[k] = r2((byCategory[k] || 0) + v); };
    const months = {}; const mon = (date, k, v) => { const m = (date || "").slice(0, 7); if (!m) return; const row = months[m] || (months[m] = { month: m, income: 0, expenses: 0, result: 0 }); row[k] = r2(row[k] + v); row.result = r2(row.income - row.expenses); };
    let income = 0, expenses = 0, open = 0, overdue = 0, payablesOpen = 0, payablesOverdue = 0, paidIn = 0, paidOut = 0;
    for (const i of invoices) { const fx = fxOf(i); const v = r2(+i.net * fx); income += v; mon(i.date, "income", v); const o = docOpen(i); open += o * fx; if (o > 0.005 && i.due < today) overdue += o * fx; paidIn += (+i.paid || 0) * fx; }
    for (const b of bills) { const fx = fxOf(b); const v = r2(+b.net * fx); expenses += v; add(b.category || b.memo || "Vendor bills", v); mon(b.date, "expenses", v); const o = docOpen(b); payablesOpen += o * fx; if (o > 0.005 && b.due < today && !b.pending) payablesOverdue += o * fx; paidOut += (+b.paid || 0) * fx; }
    for (const t of bankTx) { const v = r2(+t.net * bankRate(t)); if (t.kind === "in") { income += v; mon(t.date, "income", v); } else { expenses += v; add(t.category || "Other", v); mon(t.date, "expenses", v); paidOut += (+t.amount || 0) * bankRate(t); } }
    for (const j of journals) { if (!j.ref || j.ref.type !== "journal") continue; const jr = cv.rate(j.date); for (const l of j.lines || []) { if (l.account === "expense" || l.account === "fees" || l.account === "cogs" || l.account === "inventory_loss") { const v = r2(((l.debit || 0) - (l.credit || 0)) * jr); expenses += v; add(l.sub && typeof l.sub === "string" && !/^[a-z]+_/.test(l.sub) ? l.sub : "Journals", v); mon(j.date, "expenses", v); } if (l.account === "revenue" || l.account === "other_income") { const v = r2(((l.credit || 0) - (l.debit || 0)) * jr); income += v; mon(j.date, "income", v); } } }
    income = r2(income); expenses = r2(expenses);
    // nothing known to convert with: the figures are shown as booked and say so, rather than DKK amounts under a USD label
    const out = { vesselId, currency: cv.unconverted && cv.asked ? bookCurrency : currency, bookCurrency, presentation: pres, converted: !cv.same && !cv.unconverted, unconverted: cv.unconverted && cv.asked > 0, entityId: entId, income, expenses, result: r2(income - expenses), byCategory, months: Object.values(months).sort((a, b) => (a.month < b.month ? -1 : 1)), open: r2(open), overdue: r2(overdue), payablesOpen: r2(payablesOpen), payablesOverdue: r2(payablesOverdue), paidIn: r2(paidIn), paidOut: r2(paidOut), count: { invoices: invoices.length, bills: bills.length, bankTx: bankTx.length, journals: journals.length } };
    if (opt.lite) return out;
    out.invoices = invoices; out.bills = bills; out.bankTx = bankTx; out.journals = journals;
    out.docs = [...invoices.map((d) => ({ kind: "invoice", id: d.id, ref: d.ref, date: d.date, due: d.due, cpId: d.counterpartyId, currency: d.currency, amount: d.amount, open: docOpen(d), status: dStatus(d, today), base: r2(d.amount * fxOf(d)), fixtureId: d.fixtureId || null, meta: d.meta || null, recorded: isRecorded(d) })), ...bills.map((d) => ({ kind: d.internal ? "internal" : "bill", id: d.id, ref: d.ref, date: d.date, due: d.due, cpId: d.counterpartyId, currency: d.currency, amount: d.amount, open: docOpen(d), status: dStatus(d, today), base: r2(d.amount * fxOf(d)), category: d.category || "", memo: d.memo || "", recorded: isRecorded(d) }))].sort((a, b) => (a.date < b.date ? 1 : -1));
    return out;
  }
  function vesselFinance(ps, store, vesselId, range, opt) {
    opt = opt || {}; store = store || {}; const today = opt.today || isoDate(Date.now());
    const key = "vf|" + storeSig(store) + "|" + (ps ? psSig(ps) : "") + "|" + vesselId + "|" + rangeKey(range) + "|" + today + "|" + presCcy(ps, opt) + "|" + (opt.lite ? 1 : 0);
    return memo(key, () => financeCore(ps, store, vesselId, range, { today, currency: opt.currency, lite: !!opt.lite }));
  }
  // ---------- the fleet in one pass: a summary per vessel (lite), totals and the merged months; memoised per selection
  function fleetFinance(ps, store, vesselIds, range, opt) {
    opt = opt || {}; store = store || {}; ps = ps || {}; const today = opt.today || isoDate(Date.now()); const ids = vesselIds || (ps.vessels || []).map((v) => v.id);
    const key = "ff|" + storeSig(store) + "|" + psSig(ps) + "|" + idsKey(ids) + "|" + rangeKey(range) + "|" + today + "|" + presCcy(ps, opt);
    return memo(key, () => {
      const perVessel = new Map(); const totals = { income: 0, expenses: 0, result: 0, open: 0, overdue: 0, payablesOpen: 0, payablesOverdue: 0, paidIn: 0, paidOut: 0, vessels: ids.length, withMovements: 0 }; const months = {}; const byCategory = {}; const currencies = {}; const bookCurrencies = {}; let unconverted = false;
      for (const id of ids) { const f = vesselFinance(ps, store, id, range, { today, currency: opt.currency, lite: true }); perVessel.set(id, f); if (f.bookCurrency) bookCurrencies[f.bookCurrency] = (bookCurrencies[f.bookCurrency] || 0) + 1; if (f.unconverted) unconverted = true; for (const k of ["income", "expenses", "result", "open", "overdue", "payablesOpen", "payablesOverdue", "paidIn", "paidOut"]) totals[k] += f[k] || 0; if (f.count.invoices || f.count.bills || f.count.bankTx || f.count.journals) totals.withMovements++; currencies[f.currency] = (currencies[f.currency] || 0) + 1; for (const m of f.months) { const row = months[m.month] || (months[m.month] = { month: m.month, income: 0, expenses: 0, result: 0 }); row.income = r2(row.income + m.income); row.expenses = r2(row.expenses + m.expenses); row.result = r2(row.income - row.expenses); } for (const [c, v] of Object.entries(f.byCategory)) byCategory[c] = r2((byCategory[c] || 0) + v); }
      for (const k of Object.keys(totals)) if (k !== "vessels" && k !== "withMovements") totals[k] = r2(totals[k]);
      const currency = opt.currency || Object.entries(currencies).sort((a, b) => b[1] - a[1]).map((x) => x[0])[0] || "USD";
      const ranked = ids.map((id) => ({ vesselId: id, result: perVessel.get(id).result, income: perVessel.get(id).income })).sort((a, b) => b.result - a.result);
      return { vesselIds: ids, perVessel, totals, currency, bookCurrencies: Object.keys(bookCurrencies).sort(), converted: Object.keys(bookCurrencies).some((c) => c !== currency), unconverted, mixedCurrencies: Object.keys(currencies).length > 1, months: Object.values(months).sort((a, b) => (a.month < b.month ? -1 : 1)), byCategory, top: ranked.slice(0, 5), bottom: ranked.slice(-5).reverse() };
    });
  }

  // ---------- market and performance
  // the latest market rate on or before a date (same segment when one is named); strict = nothing when none precedes the date
  // 4.17 · a rate's unit: per day (TC indices, TCE assessments) or per MT (voyage route assessments) — `unit` on the record, else read
  // from the segment's name; a fixture's unit is its rateUnit (a voyage charter without one is per MT). Rates are only compared like
  // with like: `unit` filters marketRateAt.
  const unitOfRate = (m) => (m && m.unit) || (/usd\s*\/\s*mt|\/\s*mt\b|per\s*mt\b|\bpmt\b/i.test((m && m.segment) || "") ? "mt" : "day");
  const unitOfFixture = (f) => (f && f.rateUnit) || (f && f.kind === "voyage" ? "mt" : "day");
  // 4.30 · structured market rates: the class the desk quotes (VLCC … Handy; the dry classes too), the basis (time charter per
  // month band, or the voyage TCE), eco / scrubber, the trading area; a vessel's class comes from her own marketClass, else her type and dwt
  const MARKET_CLASSES = ["VLCC", "Suezmax", "Aframax", "LR2", "LR1", "MR2", "MR1", "Handy", "Capesize", "Kamsarmax", "Panamax", "Ultramax", "Supramax", "Handysize"];
  const MARKET_MONTHS = [3, 6, 9, 12];
  function marketClass(v) { if (!v) return null; if (v.marketClass) return v.marketClass; const t = String(v.type || "").toLowerCase(); const dwt = +v.dwt || 0; if (/vlcc|ulcc/.test(t)) return "VLCC"; if (/suezmax/.test(t)) return "Suezmax"; if (/lr2/.test(t)) return "LR2"; if (/lr1/.test(t)) return "LR1"; if (/aframax/.test(t)) return "Aframax"; if (/mr2/.test(t)) return "MR2"; if (/mr1/.test(t)) return "MR1"; if (/\bmr\b|product|chemical/.test(t)) return dwt && dwt >= 55000 ? (dwt >= 80000 ? "LR2" : "LR1") : dwt && dwt < 42000 ? (dwt < 30000 ? "Handy" : "MR1") : "MR2"; if (/newcastlemax|capesize|vloc/.test(t)) return "Capesize"; if (/kamsarmax/.test(t)) return "Kamsarmax"; if (/panamax/.test(t)) return "Panamax"; if (/ultramax/.test(t)) return "Ultramax"; if (/supramax/.test(t)) return "Supramax"; if (/handysize|handy/.test(t)) return /tank/.test(t) ? "Handy" : "Handysize"; if (/tank/.test(t) && dwt) return dwt >= 200000 ? "VLCC" : dwt >= 120000 ? "Suezmax" : dwt >= 80000 ? "Aframax" : dwt >= 55000 ? "LR1" : dwt >= 42000 ? "MR2" : dwt >= 30000 ? "MR1" : "Handy"; return null; }
  const tcMonthsOf = (f) => { if (!f || f.kind !== "tc") return null; const a = tOf(delAt(f)), b = tOf(redelAt(f)); let m = a != null && b != null && b > a ? (b - a) / (30.4375 * 86400000) : (+f.periodMonths || null); if (!m) return null; let best = 12; for (const k of MARKET_MONTHS) if (Math.abs(k - m) < Math.abs(best - m)) best = k; return best; };
  const marketWant = (v, f) => ({ cls: marketClass(v), eco: !!(v && v.eco), scrubber: !!(v && v.scrubber), basis: f && f.kind === "voyage" ? "tce" : "tc", months: tcMonthsOf(f), area: (f && f.area) || (v && v.area) || null });
  // how well a rate fits what we want: the class must match when both are known; the basis, the area, eco and scrubber count; the period band nearest wins
  function rateScore(m, want) { if (!want) return 0; let s = 0; if (m.cls && want.cls) { if (m.cls !== want.cls) return -Infinity; s += 4; } if (m.basis && want.basis) s += m.basis === want.basis ? 3 : -3; if (m.area && want.area) s += m.area === want.area ? 2 : -2; if (m.eco != null) s += !!m.eco === !!want.eco ? 1 : -1; if (m.scrubber != null) s += !!m.scrubber === !!want.scrubber ? 1 : -1; if (m.months && want.months) s -= Math.abs(m.months - want.months) / 12; return s; }
  const marketLabel = (m) => { if (!m) return ""; if (!m.cls) return m.segment || ""; return [m.cls, m.basis === "tce" ? "TCE" : (m.months ? m.months + "m" : "") + " TC", m.eco ? "ECO" : null, m.scrubber ? "scrubber" : null, m.area ? String(m.area).toUpperCase() : null].filter(Boolean).join(" · "); };
  function marketRateAt(ps, date, segment, strict, unit, want) { const all = ps ? psIndex(ps).marketRates : []; let best = null, first = null;
    if (want && !segment) { let bs = -Infinity, fs = -Infinity; for (const m of all) { if (unit && unitOfRate(m) !== unit) continue; const sc = rateScore(m, want); if (sc === -Infinity) continue; if (m.date <= date) { if (sc >= bs) { bs = sc; best = m; } } else if (sc > fs) { fs = sc; first = m; } } return best || (strict ? null : first); }
    for (const m of all) { if (segment && m.segment && m.segment !== segment) continue; if (unit && unitOfRate(m) !== unit) continue; if (!first) first = m; if (m.date <= date) best = m; else break; } return best || (strict ? null : first); }
  function onHire(ps, fixtures, range, now) {
    now = now || nowIso(); let onMin = 0, offMin = 0; const downtime = [];
    const rFrom = range && range.from ? parse(range.from) : -Infinity, rTo = range && range.to ? parse(range.to + (range.to.length === 10 ? "T24:00" : "")) : parse(now);
    // 4.31.11 · overlapping off-hire rows (a dry dock and an idle spell over the same days) are merged, so no minute is counted off twice; an off-hire still open runs to `now`
    for (const f of fixtures) { const d = parse(startAt(ps, f)); if (isNaN(d)) continue; let r = redelAt(f) && (redelActual(f) || parse(redelAt(f)) < parse(now)) ? parse(redelAt(f)) : parse(now); if (!redelActual(f) && redelAt(f) && parse(redelAt(f)) > parse(now)) r = parse(now); const s = Math.max(d, rFrom), e = Math.min(r, rTo); if (e <= s) continue; const span = Math.round((e - s) / MIN); const win = { from: iso(s), to: iso(e) }; const rows = offhiresOf(ps, f); for (const o of rows) { const oTo = o.to || now; const ov = overlapMinutes({ from: o.from, to: oTo }, win); if (ov) downtime.push({ from: maxIso(o.from, win.from), to: minIso(oTo, win.to), minutes: ov, days: days(ov), reason: o.reason || "", kind: offhireKind(o), kindInferred: offhireKindInferred(o), open: !o.to, fixtureId: f.id, deductible: o.deductible !== false }); } const off = Math.min(span, mergedMinutes(rows, s, e, now)); onMin += span - off; offMin += off; }
    return { onMinutes: onMin, offMinutes: offMin, onHireDays: days(onMin), offHireDays: days(offMin), downtime };
  }
  // 4.31.11 · utilisation, two ways, over a window of `rangeMin` minutes under management ([aFrom, aTo] in epoch ms):
  //   total       = employed / total            — every day she was not earning counts against her, whatever the reason
  //   commercial  = employed / available        — available = total − technical off-hire: the days the commercial manager could have employed her
  // employed is the on-hire time under fixtures (TC on-hire less off-hire, voyage charter time); technical off-hire is the merged
  // technical rows clipped to the window; commercial off-hire is the rest — recorded commercial off-hire and the unfixed gaps between
  // employments — so total = employed + technical + commercial always holds. 0 / 0 → null (shown "—").
  // the window under management inside the range: from her onboarding or first delivery to her offboarding or now (epoch ms, minutes)
  function mgmtWindow(ps, vesselId, fixtures, range, now, oh) {
    const psv = ((ps && ps.vessels) || []).find((v) => v.id === vesselId) || {};
    const firstDel = fixtures.length ? Math.min(...fixtures.map((f) => parse(startAt(ps, f))).filter((x) => !isNaN(x)).concat([Infinity])) : NaN; const onb = parse(psv.onboarded); const availStart = Math.min(isNaN(onb) ? Infinity : onb, isNaN(firstDel) ? Infinity : firstDel);
    const aFrom = Math.max(range && range.from ? parse(range.from) : -Infinity, availStart === Infinity ? -Infinity : availStart);
    const aTo = Math.min(range && range.to ? parse(range.to + (range.to.length === 10 ? "T24:00" : "")) : parse(now), psv.offboarded ? parse(psv.offboarded + "T24:00") : parse(now));
    const rangeMin = isFinite(aFrom) && aTo > aFrom ? Math.round((aTo - aFrom) / MIN) : oh.onMinutes + oh.offMinutes;
    return { aFrom, aTo, rangeMin };
  }
  // utilisationOf(ps, vesselId, range, { now }) → the two rates and the day breakdown alone (no books): what the Overview tiles and ranked lists read
  function utilisationOf(ps, vesselId, range, opt) {
    opt = opt || {}; const now = (opt.now || nowIso()).slice(0, 16); const key = "ut|" + psSig(ps || {}) + "|" + vesselId + "|" + rangeKey(range) + "|" + now;
    return memo(key, () => { const fixtures = fixturesOf(ps, vesselId).filter((f) => f.status !== "cancelled").sort((a, b) => parse(startAt(ps, a)) - parse(startAt(ps, b))); const oh = onHire(ps, fixtures, range, now); const w = mgmtWindow(ps, vesselId, fixtures, range, now, oh); const split = utilisationSplit(ps, vesselId, oh, w.aFrom, w.aTo, w.rangeMin, now);
      return { vesselId, utilisation: w.rangeMin > 0 ? r2(Math.min(100, oh.onMinutes / w.rangeMin * 100)) : 0, ...split, onMinutes: oh.onMinutes, offMinutes: oh.offMinutes, totalMinutes: w.rangeMin, onHireDays: oh.onHireDays, offHireDays: oh.offHireDays }; });
  }
  function utilisationSplit(ps, vesselId, oh, aFrom, aTo, rangeMin, now) {
    const rows = ps ? psIndex(ps).offhireByVessel.get(vesselId) || [] : []; const a = isFinite(aFrom) ? aFrom : -Infinity;
    const techMin = rangeMin > 0 ? Math.min(rangeMin, mergedMinutes(rows.filter((o) => offhireKind(o) === "technical"), a, aTo, now)) : 0;
    const employedMin = Math.max(0, Math.min(oh.onMinutes, rangeMin)); const availMin = Math.max(0, rangeMin - techMin); const commMin = Math.max(0, rangeMin - employedMin - techMin);
    return { totalDays: days(rangeMin), employedDays: days(employedMin), availableDays: days(availMin), technicalOffDays: days(techMin), commercialOffDays: days(commMin), utilisationCommercial: availMin > 0 ? r2(Math.min(100, employedMin / availMin * 100)) : null };
  }
  // 4.31.1 · ONE voyage estimate for every TCE shown while a voyage is open (performance, the voyage P&L, the portal tiles): the legs
  // come from the voyage plan (distance and speed per leg), the days are ballast + laden + port from the estimate — or the actual
  // days so far when the voyage has already run longer — and TCE = (revenue − commissions − costs) / those days
  function voyageEstimateFor(ps, vy, fixture, opt) {
    opt = opt || {}; const now = opt.now || nowIso(); const vessel = (ps.vessels || []).find((v) => v.id === vy.vesselId) || {}; let legs = null;
    // 4.31.10 · a voyage with no positioned ports yet is estimated on its fixture's picked load and discharge ports (same routing, the warranted speed)
    const own = (vy.ports || []).filter((p) => p.lat != null && p.lon != null && p.lat !== "" && isFinite(+p.lat)).length >= 2; const vyx = own ? vy : (voyageFromFixture(vy, fixture) || vy); const w = (fixture && fixture.warranties) || {};
    try { const plan = voyagePlan(ps, vy.vesselId, vyx === vy ? vy.id : vyx, { now }); if (plan && plan.legs && plan.legs.length) legs = plan.legs.map((l) => ({ from: { id: l.fromPortId }, to: { id: l.toPortId }, nm: l.distanceNm, speed: vyx !== vy ? ((l.laden ? +w.speedLaden : +w.speedBallast) || l.speed) : l.speed, via: l.via })); } catch (e) { legs = null; }
    const veOpt = legs ? { legs } : {}; if (fixture && hasRateSteps(fixture)) { try { veOpt.offhires = offhiresOf(ps, fixture); veOpt.hireFrom = voyageSpan(ps, vy).from || delAt(fixture); } catch (e) { /* the first rate then */ } } const ve = voyageEstimate(vyx, vessel, fixture || {}, veOpt); const estDays = +ve.totalDays || 0;
    let actualDays = opt.actualDays != null ? +opt.actualDays : 0; if (opt.actualDays == null) { try { const sp = voyageSpan(ps, vy); const s = parse(sp.from), e = parse(sp.to); if (!isNaN(s) && !isNaN(e) && e > s) actualDays = days(Math.max(0, Math.round((Math.min(e, parse(now)) - s) / MIN))); } catch (x) { actualDays = 0; } }
    const tceDays = Math.max(estDays, actualDays); return { ...ve, estimatedDays: estDays, actualDays: r4(actualDays), tceDays: r4(tceDays), tce: actualDays > estDays ? r2(ve.result / actualDays) : r2(ve.tce || 0) };
  }
  function voyageTce(ps, store, vesselId, fixture, now) {
    const vy = voyagesOfFixture(ps, fixture.id)[0] || null; if (!vy) return null;
    try { if (store && vy.status === "completed") { const vr = voyageResult(ps, store, vy.id, { now }); if (vr && vr.tce != null) return { value: r2(vr.tce), estimated: false, basis: "result", days: vr.voyageDays, net: vr.result, revenue: vr.revenue && vr.revenue.total != null ? vr.revenue.total : null, costs: vr.costs && vr.costs.total != null ? vr.costs.total : null, currency: vr.currency, voyageId: vy.id, voyageNo: vy.no }; } } catch (e) { /* estimate */ }
    try { const ve = voyageEstimateFor(ps, vy, fixture, { now }); if (!ve || !(ve.tceDays > 0)) return null; return { value: r2(ve.tce || 0), estimated: true, basis: "estimate", days: ve.tceDays, net: ve.result, revenue: ve.revenue, costs: r2((ve.costs || 0) + (ve.commissions || 0)), currency: ve.currency || fixture.currency || "USD", voyageId: vy.id, voyageNo: vy.no }; } catch (e) { return null; }
  }
  function performance(ps, store, vesselId, range, opt) {
    opt = opt || {}; const now = opt.now || nowIso();
    const key = "pf|" + storeSig(store || {}) + "|" + psSig(ps || {}) + "|" + vesselId + "|" + rangeKey(range) + "|" + now.slice(0, 16) + "|" + (opt.segment || "") + "|" + (opt.lite ? 1 : 0) + "|" + (opt.today || "");
    return memo(key, () => performanceCore(ps, store, vesselId, range, { ...opt, now }));
  }
  function performanceCore(ps, store, vesselId, range, opt) {
    opt = opt || {}; const now = opt.now || nowIso(); const fixtures = fixturesOf(ps, vesselId).sort((a, b) => parse(startAt(ps, a)) - parse(startAt(ps, b)));
    const cur = activeFixture(ps, vesselId, now) || fixtures[fixtures.length - 1] || null;
    const fixedRate = cur ? rateAt(cur, hasRateSteps(cur) ? offhiresOf(ps, cur) : [], now) || 0 : 0; /* 4.34.7 · the rate in force now */ const seg = cur && cur.marketSegment || opt.segment || null;
    // 4.17 · like with like: a per-day fixture against a per-day rate, a per-MT voyage charter against the per-MT assessment of its route;
    // a voyage charter with no route assessment is compared by its TCE (the voyage result per day) against the day-rate market
    const fUnit = unitOfFixture(cur); let basis = "rate", compareRate = fixedRate, mk = null;
    // 4.30.5 · a voyage charter's TCE: freight less voyage costs and commissions over the voyage days — the booked result once the
    // voyage is completed, else the estimate from the plan (distances from the routed legs at her speeds) and marked as such
    const voyTce = cur && cur.kind === "voyage" ? voyageTce(ps, store, vesselId, cur, now) : null;
    if (cur) { const date = cur.cpDate || isoDate(parse(delAt(cur))); const byId = (ps.marketRates || []).find((m) => m.id === cur.marketRateId) || null;
      // per MT, only the fixture's own route counts (another lane's freight says nothing); per day, any index when none is named
      const want = marketWant((ps.vessels || []).find((x) => x.id === vesselId) || null, cur);
      const ownSeg = cur.marketSegment || null; mk = byId && unitOfRate(byId) === fUnit ? byId : fUnit === "day" ? marketRateAt(ps, date, seg, false, "day", seg ? null : want) || (seg ? marketRateAt(ps, date, null, false, "day", want) : null) : ownSeg ? marketRateAt(ps, date, ownSeg, false, fUnit) : null;
      if (!mk && fUnit !== "day") { const daySeg = opt.segment && !/usd\s*\/\s*mt|\/\s*mt\b/i.test(opt.segment) ? opt.segment : (cur.marketSegment && unitOfRate({ segment: cur.marketSegment }) === "day" ? cur.marketSegment : null); const dayMk = (byId && unitOfRate(byId) === "day" ? byId : null) || marketRateAt(ps, date, daySeg, false, "day", daySeg ? null : want) || (daySeg ? marketRateAt(ps, date, null, false, "day", want) : null);
        const tceV = voyTce ? voyTce.value : null;
        if (dayMk && tceV) { mk = dayMk; basis = "tce"; compareRate = r2(tceV); } } }
    const marketRateAtFixing = mk ? +mk.rate : null; const delta = marketRateAtFixing != null ? r2(compareRate - marketRateAtFixing) : null; const deltaPct = marketRateAtFixing ? r2((compareRate - marketRateAtFixing) / marketRateAtFixing * 100) : null;
    const oh = onHire(ps, fixtures, range, now);
    // utilisation: on-hire time over the time the vessel was under management (from her onboarding, or her first delivery), within the range
    const { aFrom, aTo, rangeMin } = mgmtWindow(ps, vesselId, fixtures, range, now, oh);
    const utilisation = rangeMin > 0 ? r2(Math.min(100, oh.onMinutes / rangeMin * 100)) : 0;
    const split = utilisationSplit(ps, vesselId, oh, aFrom, aTo, rangeMin, now); // 4.31.11 · the commercial rate and the day breakdown
    const fin = vesselFinance(ps, store, vesselId, range, { today: opt.today, currency: opt.currency, lite: !!opt.lite });
    const netRate = cur ? r2(fixedRate * (1 - ((+cur.addressCommission || 0) + brokeragePct(cur)) / 100)) : 0;
    // 4.30.8 · a time charter earns from the day she is delivered, invoiced or not: the TCE accrues from the charter party over the
    // on-hire time in the range (hire less off-hire, less address commission; CVE and bonuses aside) and only turns into the books'
    // figure once the charter is redelivered and fully invoiced — so owners see a steady number, not one that jumps on invoice day
    let accrued = 0, accruedMin = 0, accruedCcy = null; { const rFrom = range && range.from ? parse(range.from) : -Infinity, rTo = range && range.to ? parse(range.to + (range.to.length === 10 ? "T24:00" : "")) : parse(now); for (const f of fixtures) { if (f.kind === "voyage") continue; const d0 = parse(delAt(f)); if (isNaN(d0)) continue; const r0 = redelAt(f) && (redelActual(f) || parse(redelAt(f)) < parse(now)) ? parse(redelAt(f)) : parse(now); const s0 = Math.max(d0, rFrom), e0 = Math.min(r0, rTo); if (e0 <= s0) continue; try { const h = hire(f, offhiresOf(ps, f), iso(s0), iso(e0)); accrued += h.hireNet * (1 - (+f.addressCommission || 0) / 100); accruedMin += h.netMinutes; accruedCcy = accruedCcy || h.currency; } catch (e) { /* skip */ } } }
    const accruedTce = accruedMin > 0 ? r2(accrued / (accruedMin / 1440)) : null;
    const tcClosed = !!(cur && cur.kind !== "voyage" && cur.status === "redelivered" && redelActual(cur) && fin.income > 0 && oh.onHireDays > 0 && fin.income >= 0.98 * accrued);
    const tceFromBooks = tcClosed; const tce = cur && cur.kind === "voyage" ? (voyTce ? voyTce.value : null) : tceFromBooks ? r2(fin.income / oh.onHireDays) : (accruedTce != null ? accruedTce : netRate); const tceCurrency = tceFromBooks ? fin.currency : (accruedTce != null && accruedCcy ? accruedCcy : (cur ? cur.currency || "USD" : fin.currency));
    const tceEstimated = !!(voyTce && voyTce.estimated); const tceBasis = cur && cur.kind === "voyage" ? (voyTce ? voyTce.basis : "none") : tceFromBooks ? "books" : accruedTce != null ? "accrued" : "rate";
    // month by month: the rate in force against the market rate of that month
    const vsMarket = []; if (fixtures.length && !opt.lite) { const start = (isFinite(aFrom) ? isoDate(aFrom) : isoDate(parse(startAt(ps, fixtures[0]) || fixtures[0].cpDate))).slice(0, 7); const end = (range && range.to ? range.to : isoDate(parse(now))).slice(0, 7); let y = +start.slice(0, 4), m = +start.slice(5, 7); let guard = 0; while ((y + "-" + pad(m)) <= end && guard++ < 240) { const date = y + "-" + pad(m) + "-15"; const f = activeFixture(ps, vesselId, date + "T12:00"); const mr = marketRateAt(ps, date, seg, true, fUnit); vsMarket.push({ month: y + "-" + pad(m), date, fixed: f && unitOfFixture(f) === fUnit ? +f.rate || 0 : null, market: mr ? +mr.rate : null }); m++; if (m > 12) { m = 1; y++; } } }
    const score = Math.max(0, Math.min(100, Math.round(50 + (deltaPct == null ? 0 : Math.max(-25, Math.min(25, deltaPct))) + (utilisation - 90) / 2)));
    return { vesselId, fixture: cur, fixedRate, netRate, rateCurrency: cur ? cur.currency || "USD" : fin.currency, rateUnit: fUnit, basis, compareRate, marketUnit: mk ? unitOfRate(mk) : null, marketRateAtFixing, marketSource: mk ? (mk.segment || "") + (mk.source ? " · " + mk.source : "") + (mk.date ? " · " + mk.date : "") : "", delta, deltaPct, tce, tceEstimated, tceBasis, tceDetail: voyTce || null, accrued: r2(accrued), accruedDays: days(accruedMin), onHireDays: oh.onHireDays, offHireDays: oh.offHireDays, utilisation, utilisationCommercial: split.utilisationCommercial, totalDays: split.totalDays, employedDays: split.employedDays, availableDays: split.availableDays, technicalOffDays: split.technicalOffDays, commercialOffDays: split.commercialOffDays, downtime: oh.downtime, earnings: fin.income, costs: fin.expenses, result: fin.result, currency: tceCurrency, financeCurrency: fin.currency, vsMarket, score, finance: fin };
  }

  // ---------- the fleet at a glance: employment, days left, position age and what is pending, per vessel, in one pass
  const fleetStatusRow = (ps, store, ix, v, now, opt) => {
    const nowMs = parse(now); const sv = store && store.vessels ? (index(store).vesselById.get(v.id) || {}) : {}; const name = v.name || sv.name || ""; const imo = v.imo || sv.imo || "";
    const fixtures = ix.fixturesByVessel.get(v.id) || []; const cur = activeFixture(ps, v.id, now);
    const next = !cur ? fixtures.find((f) => { const d = parse(startAt(ps, f)); return !isNaN(d) && d > nowMs; }) || fixtures.find((f) => f.status === "on-subs") || null : null;
    const redel = cur ? redelAt(cur) : null; const daysLeft = cur && redel ? r2((parse(redel) - nowMs) / (DAYM * MIN)) : null; const daysOn = cur ? r2((nowMs - parse(delAt(cur))) / (DAYM * MIN)) : null;
    let unbilledDue = 0, unbilledNext = null, billedTo = null; if (cur && cur.kind === "tc" && store && opt.unbilled !== false) { const u = unbilled(ps, store, cur, now); unbilledDue = u.due; unbilledNext = u.next; billedTo = u.billedTo; }
    const comp = ix.complianceByVessel.get(v.id) || []; const compDue = comp.filter((c) => c.expires && c.expires >= now.slice(0, 10) && c.expires <= isoDate(nowMs + 60 * DAYM * MIN)).length, compExpired = comp.filter((c) => c.expires && c.expires < now.slice(0, 10)).length;
    const claims = (ix.claimsByVessel.get(v.id) || []).filter((c) => c.status === "open").length;
    const offOpen = (ix.offhireByVessel.get(v.id) || []).some((o) => o.from && (!o.to || parse(o.to) > nowMs) && parse(o.from) <= nowMs);
    const pos = lastPosition(ps, v.id, { index: ix }) || ((ps && ps.positions) || {})[imo] || null; /* ("dated ahead" is against the real clock, not the day a report is drawn for) */ const posAgeMin = pos && pos.ts ? Math.max(0, Math.round((nowMs - Date.parse(pos.ts)) / MIN)) : null;
    const vy = (ix.voyagesByVessel.get(v.id) || []).filter((x) => x.status !== "completed").sort((a, b) => (b.no || 0) - (a.no || 0))[0] || null; let nextPort = null, currentPort = null; if (vy) { const ports = (vy.ports || []); currentPort = ports.find((p) => (p.ata || p.eta) && parse(p.ata || p.eta) <= nowMs && !(p.atd && parse(p.atd) <= nowMs)) || null; nextPort = ports.find((p) => !p.ata && !p.atd && (!p.eta || parse(p.eta) > nowMs) && p !== currentPort) || null; }
    const pending = (unbilledDue ? 1 : 0) + compDue + compExpired + claims + (offOpen ? 1 : 0);
    const employed = !!cur; const state = v.status === "offboarded" ? "offboarded" : employed ? (offOpen ? "off-hire" : "on-hire") : v.status === "drydock" || v.status === "laid-up" ? v.status : next ? "fixed, awaiting delivery" : "open";
    return { vesselId: v.id, name, imo, mmsi: v.mmsi || "", type: v.type || sv.type || "", dwt: v.dwt || sv.dwt || 0, flag: v.flag || sv.flag || "", built: v.built || sv.built || 0, status: v.status || "trading", state, employed, ownerCpId: v.ownerCpId || null, managerEntityId: v.managerEntityId || null,
      fixture: cur, kind: cur ? cur.kind : null, label: cur ? fxLabel(cur) : "", chartererCpId: cur ? cur.chartererCpId || null : null, rate: cur ? (hasRateSteps(cur) ? rateAt(cur, offhiresOf(ps, cur), now) : +cur.rate || 0) : null, rateText: cur && hasRateSteps(cur) ? rateText(cur) : null, rateUnit: cur ? cur.rateUnit || "day" : null, currency: cur ? cur.currency || "USD" : null, delivery: cur ? delAt(cur) : null, redelivery: redel, redeliveryEstimated: cur ? !redelActual(cur) : null, daysLeft, daysOn, nextFixture: next,
      unbilledDue, unbilledNext, billedTo, compliance: { due: compDue, expired: compExpired, total: comp.length }, claimsOpen: claims, offhireOpen: offOpen, position: pos, positionAgeMinutes: posAgeMin, dest: pos ? pos.dest || "" : "", eta: pos ? pos.eta || "" : "", voyage: vy ? { id: vy.id, no: vy.no, status: vy.status } : null, currentPort: currentPort ? currentPort.name : "", nextPort: nextPort ? nextPort.name : "", nextPortEta: nextPort ? nextPort.eta || "" : "", pending };
  };
  function fleetStatus(ps, store, opt) {
    opt = opt || {}; ps = ps || {}; const now = (opt.now || nowIso()).slice(0, 16); const ids = opt.vesselIds || null;
    const key = "fs|" + psSig(ps) + "|" + (store ? storeSig(store) : "") + "|" + now + "|" + (ids ? idsKey(ids) : "*") + "|" + (opt.unbilled === false ? 0 : 1);
    return memo(key, () => { const ix = psIndex(ps); const vs = ids ? ids.map((id) => ix.vesselById.get(id)).filter(Boolean) : (ps.vessels || []); const rows = vs.map((v) => fleetStatusRow(ps, store, ix, v, now, opt)); const byId = new Map(rows.map((r) => [r.vesselId, r]));
      const counts = { vessels: rows.filter((r) => r.status !== "offboarded").length, exited: rows.filter((r) => r.status === "offboarded").length, onHire: rows.filter((r) => r.employed && !r.offhireOpen).length, offHire: rows.filter((r) => r.offhireOpen).length, open: rows.filter((r) => !r.employed && r.status !== "offboarded").length, tc: rows.filter((r) => r.kind === "tc").length, voyage: rows.filter((r) => r.kind === "voyage").length, bareboat: rows.filter((r) => r.kind === "bareboat").length, pending: rows.reduce((k, r) => k + r.pending, 0), tracked: rows.filter((r) => r.position).length, redeliveringSoon: rows.filter((r) => r.daysLeft != null && r.daysLeft >= 0 && r.daysLeft <= 30).length };
      const byStatus = {}, byType = {}, byKind = {}; for (const r of rows) { byStatus[r.state] = (byStatus[r.state] || 0) + 1; if (r.type) byType[r.type] = (byType[r.type] || 0) + 1; byKind[r.kind || "unfixed"] = (byKind[r.kind || "unfixed"] || 0) + 1; }
      return { now, rows, byId, counts, byStatus, byType, byKind }; });
  }
  // ---------- fleet performance: fixed against market, TCE, utilisation and result per vessel, plus weighted fleet totals
  function fleetPerformance(ps, store, vesselIds, range, opt) {
    opt = opt || {}; ps = ps || {}; store = store || {}; const now = (opt.now || nowIso()).slice(0, 16); const ids = vesselIds || (ps.vessels || []).map((v) => v.id);
    const key = "fp|" + storeSig(store) + "|" + psSig(ps) + "|" + idsKey(ids) + "|" + rangeKey(range) + "|" + now + "|" + (opt.segment || "");
    return memo(key, () => { const ix = psIndex(ps); const rows = []; const tceCcys = new Set(); let onMin = 0, offMin = 0, earnings = 0, costs = 0, result = 0, deltaSum = 0, deltaN = 0, utilSum = 0, utilN = 0, tceW = 0, tceWDays = 0, tceEarn = 0, tceEmpMin = 0, tceN = 0, totMin = 0, empMin = 0, techMin = 0, commMin = 0, availMin = 0;
      for (const id of ids) { const v = ix.vesselById.get(id); if (!v) continue; const p = performance(ps, store, id, range, { now, lite: true, segment: opt.segment, today: opt.today }); const sv = ix.vesselById.get(id) || {}; rows.push({ vesselId: id, name: v.name || (index(store).vesselById.get(id) || {}).name || "", type: v.type || "", kind: p.fixture ? p.fixture.kind : null, label: p.fixture ? fxLabel(p.fixture) : "", chartererCpId: p.fixture ? p.fixture.chartererCpId || null : null, fixedRate: p.fixedRate, netRate: p.netRate, rateCurrency: p.rateCurrency, marketRateAtFixing: p.marketRateAtFixing, delta: p.delta, deltaPct: p.deltaPct, tce: p.tce, tceEstimated: !!p.tceEstimated, onHireDays: p.onHireDays, offHireDays: p.offHireDays, utilisation: p.utilisation, utilisationCommercial: p.utilisationCommercial, totalDays: p.totalDays, employedDays: p.employedDays, availableDays: p.availableDays, technicalOffDays: p.technicalOffDays, commercialOffDays: p.commercialOffDays, earnings: p.earnings, costs: p.costs, result: p.result, currency: p.currency, score: p.score, downtimeCount: p.downtime.length }); void sv;
        onMin += Math.round(p.onHireDays * DAYM); offMin += Math.round(p.offHireDays * DAYM); totMin += Math.round(p.totalDays * DAYM); empMin += Math.round(p.employedDays * DAYM); techMin += Math.round(p.technicalOffDays * DAYM); commMin += Math.round(p.commercialOffDays * DAYM); availMin += Math.round(p.availableDays * DAYM); if (p.tce != null && p.onHireDays > 0) { tceW += p.tce * p.onHireDays; tceWDays += p.onHireDays; } { const dd = p.employedDays > 0 ? p.employedDays : p.onHireDays; if (p.tce != null && dd > 0) { tceEarn += p.tce * dd; tceEmpMin += Math.round(dd * DAYM); tceN++; tceCcys.add(p.currency || "USD"); } } earnings += p.earnings; costs += p.costs; result += p.result; if (p.deltaPct != null) { deltaSum += p.deltaPct; deltaN++; } if (p.fixture) { utilSum += p.utilisation; utilN++; } }
      // 4.31.11 · the fleet's two rates are weighted by days: Σ employed / Σ total and Σ employed / Σ available (never the mean of percentages)
      const onDays = days(onMin); const totals = { vessels: rows.length, onHireDays: onDays, offHireDays: days(offMin), utilisation: totMin > 0 ? r2(Math.min(100, empMin / totMin * 100)) : onMin + offMin > 0 ? r2(onMin / (onMin + offMin) * 100) : (utilN ? r2(utilSum / utilN) : 0), utilisationCommercial: availMin > 0 ? r2(Math.min(100, empMin / availMin * 100)) : null, totalDays: days(totMin), employedDays: days(empMin), availableDays: days(availMin), technicalOffDays: days(techMin), commercialOffDays: days(commMin), tce: tceWDays > 0 ? r2(tceW / tceWDays) : (onDays > 0 ? r2(earnings / onDays) : 0), /* 4.30.8 · each vessel's TCE (accrued, estimate or result) weighted by her on-hire days */ earnings: r2(earnings), costs: r2(costs), result: r2(result), /* x.y · the fleet's average daily TCE: Σ (each vessel's TCE × her employed days) ÷ Σ employed days — total TCE earnings over total
        employed days in the range, never the mean of the vessels' rates; same per-vessel TCE as performance() (accrued, estimate or books) */
        avgDailyTce: tceEmpMin > 0 ? r2(tceEarn / (tceEmpMin / DAYM)) : null, tceEarnings: r2(tceEarn), tceDays: days(tceEmpMin), tceVessels: tceN, tceCurrency: tceCcys.size === 1 ? [...tceCcys][0] : null, tceMixed: tceCcys.size > 1, avgDeltaPct: deltaN ? r2(deltaSum / deltaN) : null, aboveMarket: rows.filter((r) => r.deltaPct != null && r.deltaPct > 0).length, belowMarket: rows.filter((r) => r.deltaPct != null && r.deltaPct < 0).length };
      // 4.31.11 · byCommercial: the manager's own ranking — commercial utilisation first (vessels with none last), then the score
      const byCommercial = rows.slice().sort((a, b) => ((b.utilisationCommercial == null ? -1 : b.utilisationCommercial) - (a.utilisationCommercial == null ? -1 : a.utilisationCommercial)) || (b.score || 0) - (a.score || 0));
      return { vesselIds: ids, rows, byId: new Map(rows.map((r) => [r.vesselId, r])), totals, top: byCommercial.slice(0, 5), bottom: byCommercial.filter((r) => r.utilisationCommercial != null).slice(-5).reverse(), byCommercial, currency: (rows[0] || {}).currency || "USD" }; });
  }
  // ---------- alerts: what needs a hand, fleet-wide, most urgent first
  const SEV = { high: 3, medium: 2, low: 1 };
  function alerts(ps, store, opt) {
    opt = opt || {}; ps = ps || {}; const now = (opt.now || nowIso()).slice(0, 16); const nowMs = parse(now); const today = now.slice(0, 10);
    const key = "al|" + psSig(ps) + "|" + (store ? storeSig(store) : "") + "|" + now + "|" + (opt.vesselIds ? idsKey(opt.vesselIds) : "*");
    return memo(key, () => { const fs = fleetStatus(ps, store, { now, vesselIds: opt.vesselIds || null }); const ix = psIndex(ps); const out = []; const ixS = store ? index(store) : null;
      const add = (sev, kind, r, text, extra) => out.push({ id: kind + ":" + r.vesselId + (extra && extra.ref ? ":" + extra.ref : ""), severity: sev, rank: SEV[sev], kind, vesselId: r.vesselId, vesselName: r.name, text, at: (extra && extra.at) || null, amount: (extra && extra.amount) || null, currency: (extra && extra.currency) || null, tab: (extra && extra.tab) || "overview", ref: (extra && extra.ref) || null });
      for (const r of fs.rows) {
        if (r.status === "offboarded") continue;
        for (const c of ix.complianceByVessel.get(r.vesselId) || []) { if (!c.expires) continue; if (c.expires < today) add("high", "compliance-expired", r, (c.name || c.kind || "Certificate") + " expired " + fmtDate(c.expires), { at: c.expires, tab: "compliance", ref: c.id }); else if (c.expires <= isoDate(nowMs + 60 * DAYM * MIN)) add(c.expires <= isoDate(nowMs + 14 * DAYM * MIN) ? "medium" : "low", "compliance-due", r, (c.name || c.kind || "Certificate") + " expires " + fmtDate(c.expires), { at: c.expires, tab: "compliance", ref: c.id }); }
        if (r.unbilledDue) add(r.unbilledDue > 1 ? "high" : "medium", "hire-unbilled", r, r.unbilledDue + " hire period" + (r.unbilledDue > 1 ? "s" : "") + " due and not invoiced" + (r.unbilledNext ? " · from " + fmtAt(r.unbilledNext.from) : ""), { at: r.unbilledNext ? r.unbilledNext.from : null, tab: "financials" });
        if (store) { const f = vesselFinance(ps, store, r.vesselId, null, { today, lite: true }); if (f.overdue > 0.005) add(f.overdue > 100000 ? "high" : "medium", "invoice-overdue", r, "Receivables overdue " + fmtMoney(f.overdue, f.currency), { amount: f.overdue, currency: f.currency, tab: "financials" }); if (f.payablesOverdue > 0.005) add("low", "bill-overdue", r, "Payables overdue " + fmtMoney(f.payablesOverdue, f.currency), { amount: f.payablesOverdue, currency: f.currency, tab: "financials" }); }
        if (r.daysLeft != null && r.daysLeft >= 0 && r.daysLeft <= 30) add(r.daysLeft <= 7 ? "high" : "medium", "redelivery-soon", r, "Redelivery " + (r.redeliveryEstimated ? "estimated " : "") + fmtAt(r.redelivery) + " · " + r.daysLeft.toFixed(1) + " days left" + (r.nextFixture ? "" : " · nothing fixed next"), { at: r.redelivery, tab: "commercial" });
        if (r.daysLeft != null && r.daysLeft < 0 && r.redeliveryEstimated) add("medium", "redelivery-passed", r, "Estimated redelivery " + fmtAt(r.redelivery) + " has passed — confirm the actual redelivery or extend", { at: r.redelivery, tab: "commercial" });
        if (r.employed && !r.offhireOpen) { if (!r.position) add("low", "position-none", r, "No position reported" + (r.mmsi ? "" : " · add her MMSI for AIS tracking"), { tab: "operations" }); else if (r.positionAgeMinutes != null && r.positionAgeMinutes > 48 * 60) add("low", "position-stale", r, "Last position " + Math.round(r.positionAgeMinutes / 60) + " h ago", { at: r.position.ts, tab: "operations" }); }
        if (r.offhireOpen) add("high", "offhire-open", r, "Off-hire in progress", { tab: "operations" });
        if (r.nextFixture && r.nextFixture.status === "on-subs" && r.nextFixture.cargo && r.nextFixture.cargo.laycan && r.nextFixture.cargo.laycan.to && r.nextFixture.cargo.laycan.to < today) add("medium", "subs-laycan-passed", r, "Fixture on subjects with laycan passed " + fmtDate(r.nextFixture.cargo.laycan.to), { tab: "commercial", ref: r.nextFixture.id });
        for (const c of (ix.claimsByVessel.get(r.vesselId) || []).filter((x) => x.status === "open")) { const age = c.date ? Math.round((nowMs - parse(c.date)) / (DAYM * MIN)) : 0; if (age > 90) add("low", "claim-stale", r, (c.kind || "Claim") + " open for " + age + " days" + (c.amount ? " · " + fmtMoney(c.amount, c.currency) : ""), { at: c.date, amount: c.amount, currency: c.currency, tab: "compliance", ref: c.id }); }
      }
      void ixS; out.sort((a, b) => b.rank - a.rank || (a.at || "").localeCompare(b.at || "") || a.vesselName.localeCompare(b.vesselName));
      const counts = { high: out.filter((a) => a.severity === "high").length, medium: out.filter((a) => a.severity === "medium").length, low: out.filter((a) => a.severity === "low").length, total: out.length }; const byVessel = new Map(); for (const a of out) push(byVessel, a.vesselId, a);
      return { now, items: out, counts, byVessel }; });
  }

  // ---------- statements of account
  function soa(ps, store, id, range) {
    store = store || {}; const isVessel = (store.vessels || []).some((v) => v.id === id) || ((ps && ps.vessels) || []).some((v) => v.id === id);
    const items = [];
    const ix = index(store); const opt = (range && range.vesselIds) ? { vesselIds: new Set(range.vesselIds) } : {};
    const invs = (isVessel ? ix.invoicesByVessel.get(id) || [] : ix.invoicesByCp.get(id) || []).filter((i) => !opt.vesselIds || opt.vesselIds.has(ix.docVessel(i)));
    const invSet = new Set(invs.map((i) => i.id)); const invById = new Map(invs.map((i) => [i.id, i]));
    for (const i of invs) { if (inRange(i.date, range)) items.push({ date: i.date, ref: i.ref, type: "Invoice", detail: (tradeOf(store, i.tradeId) || {}).ref || (i.meta && i.meta.period ? fmtAt(i.meta.period.from) + " – " + fmtEnd(i.meta.period.to) : ""), due: i.due, debit: +i.amount, credit: 0, currency: i.currency, id: i.id }); }
    const pays = []; for (const i of invs) for (const p of ix.paymentsByInvoice.get(i.id) || []) if (p.kind === "in") pays.push(p);
    for (const p of pays) if (inRange(p.date, range) && !p.reversed && !p.appliedFrom) items.push({ date: p.date, ref: p.reference || "Receipt", type: "Receipt", detail: (invById.get(p.invoiceId) || {}).ref || "", due: "", debit: 0, credit: +p.amount, currency: p.currency, id: p.id });
    // 4.19 · money received on account (no invoice yet) is a credit on the statement until it is applied
    const onAcc = (store.payments || []).filter((p) => p.onAccount && !p.reversed && (isVessel ? p.vesselId === id : p.counterpartyId === id) && (!opt.vesselIds || opt.vesselIds.has(p.vesselId)));
    for (const p of onAcc) if (inRange(p.date, range)) items.push({ date: p.date, ref: p.reference || "Receipt", type: "On account", detail: "held on account" + ((p.applied || 0) > 0.005 ? " · " + fmtMoney(p.applied) + " applied" : ""), due: "", debit: 0, credit: +p.amount, currency: p.currency, id: p.id, onAccount: true });
    for (const i of invs) for (const cn of ix.creditNotesByInvoice.get(i.id) || []) if (inRange(cn.date, range)) items.push({ date: cn.date, ref: cn.ref, type: "Credit note", detail: i.ref || "", due: "", debit: 0, credit: +cn.amount, currency: cn.currency, id: cn.id });
    items.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.type === "Invoice" ? -1 : 1));
    let bal = 0; for (const it of items) { bal = r2(bal + it.debit - it.credit); it.balance = bal; }
    const opening = r2(sum(invs.filter((i) => range && range.from && i.date < range.from), (i) => +i.amount) - sum(pays.filter((p) => range && range.from && p.date < range.from && invSet.has(p.invoiceId) && !p.reversed && !p.appliedFrom), (p) => +p.amount) - sum(onAcc.filter((p) => range && range.from && p.date < range.from), (p) => +p.amount));
    const currency = (invs[0] || {}).currency || "USD";
    return { id, isVessel, currency, items, opening, closing: r2(opening + bal), open: r2(sum(invs, (i) => docOpen(i))), overdue: r2(sum(invs.filter((i) => docOpen(i) > 0.005 && i.due < isoDate(Date.now())), (i) => docOpen(i))) };
  }

  // ---------- 4.14 · voyage accounting: the span, document status, the P&L with every invoice and bill, hire statements,
  // cash flow by week, FIFO bunkers, consumption against the charter party, claims into invoices
  const voyageOf = (ps, id) => (ps && id ? psIndex(ps).voyageById.get(id) || null : null);
  // the span of a voyage: explicit from/to, else first arrival and last departure of its ports, else the fixture's dates
  function voyageSpan(ps, vy) {
    if (!vy) return { from: null, to: null, minutes: 0 };
    const ports = vy.ports || [];
    const firsts = ports.map((p) => p.ata || p.eta).filter(Boolean).map(parse).filter((x) => !isNaN(x));
    const lasts = ports.map((p) => p.atd || p.etd || p.ata || p.eta).filter(Boolean).map(parse).filter((x) => !isNaN(x));
    let from = vy.from || (firsts.length ? iso(Math.min(...firsts)) : null), to = vy.to || (lasts.length ? iso(Math.max(...lasts)) : null);
    if (ps && vy.fixtureId) { const f = psIndex(ps).fixtureById.get(vy.fixtureId); if (f) { const st0 = startAt(ps, f); if (!from) from = st0; else if (f.kind === "voyage" && st0 && parse(st0) < parse(from)) from = st0; /* 4.32.2 · a voyage charter runs from its commencement: the ballast leg counts */ to = to || redelAt(f); } }
    return { from, to, minutes: from && to ? Math.max(0, minutes(from, to)) : 0 };
  }
  // one word for where a document stands: paid · part-paid · unpaid · overdue · credited · void · not delivered
  function docStatus(d, today) {
    if (!d) return ""; if (d.void || d.voided) return "void"; if (d.pending) return "not delivered";
    const amt = +d.amount || 0, paid = +d.paid || 0, cred = +d.credited || 0; const open = r2(amt - paid - cred);
    if (open < 0.01) return cred > 0.005 && cred >= amt - 0.005 ? "credited" : "paid";
    const late = !!(d.due && today && d.due < today);
    if (late) return "overdue"; return paid > 0.005 || cred > 0.005 ? "part-paid" : "unpaid";
  }
  const COST_KINDS = [["bunkers", /bunker|fuel|lube|vlsfo|hsfo|lsmgo|\bmgo\b|\bifo\b/i], ["canal", /canal|suez|panama|kiel|bosph|strait|transit dues/i], ["commissions", /commission|brokerage|broker/i], ["portDa", /\b(da|pda|fda)\b|disburs|port (dues|charges|cost)|pilot|tug|berth|wharf|harbou?r|towage|mooring|stevedor|light ?dues|quay/i], ["agency", /agen/i], ["insurance", /insur|p ?& ?i|h ?& ?m|war risk/i], ["claims", /claim|damage|cargo loss/i]];
  const costKind = (label) => { for (const [k, re] of COST_KINDS) if (re.test(label || "")) return k; return "other"; };
  const REV_KINDS = [["despatch", /despatch/i], ["demurrage", /demurrage/i], ["ballastBonus", /ballast bonus/i], ["commissions", /address commission|brokerage/i], ["management_fee", /management fee|mgmt fee|manager'?s fee/i], ["interim", /interim port/i], ["heating", /\bheating\b/i], ["awrp", /\bawrp\b|war risk/i], ["extras", /charterers?'?s? account/i], ["hire", /off-hire|hire/i], ["freight", /freight|deadfreight/i], ["other", /./]]; /* 4.32.2 · interim port, heating, AWRP and "for charterers' account" (the extras typed on the fixture) are read back into their own keys */
  const revKind = (desc) => { for (const [k, re] of REV_KINDS) if (re.test(desc || "")) return k; return "other"; };
  // the trade lines behind an invoice, scaled to its net so VAT-free lines and the net agree
  function invoiceLineKinds(store, inv) {
    const t = tradeOf(store, inv.tradeId); const lines = (t && t.lines) || []; const out = {}; let s = 0; const parts = [];
    for (const l of lines) { const a = r2((+l.qty || 0) * (+l.price || 0)); if (!a) continue; parts.push([revKind(l.description || ""), a]); s += a; }
    const net = +inv.net || +inv.amount || 0; const k = parts.length && Math.abs(s) > 0.005 ? net / s : 1;
    if (!parts.length) { const m = inv.meta || (t && t.meta) || {}; out[m.kind === "freight" ? "freight" : m.kind === "hire" ? "hire" : m.kind === "claim" ? "demurrage" : "other"] = net; return out; }
    for (const [kind, a] of parts) out[kind] = r2((out[kind] || 0) + a * k); return out;
  }
  // ---- bunkers: a vessel's timeline of receipts and consumption, FIFO-valued
  // events come from the fixture (bunkers on delivery/redelivery), the bunker log (receipts, delivered stems, consumption, surveys)
  // and noon reports (consumption since the last report, unless the log already carries one at the same time)
  function bunkerEvents(ps, vesselId) {
    const px = psIndex(ps || {}); const ev = [];
    for (const f of px.fixturesByVessel.get(vesselId) || []) { const bk = f.bunkers || {}; const dAt = delAt(f), rAt = redelAt(f); if (f.kind === "tc" || f.kind === "bareboat") continue; /* a time charterer pays for bunkers; the owner's book is not ours */ for (const b of bk.delivery || []) if (+b.qty && dAt) ev.push({ at: dAt, kind: "receipt", grade: b.grade || "", qty: +b.qty, price: +b.price || 0, source: "fixture", fixtureId: f.id }); for (const b of bk.redelivery || []) if (+b.qty && rAt && redelActual(f)) ev.push({ at: rAt, kind: "out", grade: b.grade || "", qty: +b.qty, price: +b.price || 0, source: "fixture", fixtureId: f.id }); }
    for (const f of px.fixturesByVessel.get(vesselId) || []) { if (f.kind !== "tc" && f.kind !== "bareboat") continue; const bk = f.bunkers || {}; const dAt = delAt(f), rAt = redelAt(f); for (const b of bk.delivery || []) if (+b.qty && dAt) ev.push({ at: dAt, kind: "receipt", grade: b.grade || "", qty: +b.qty, price: +b.price || 0, source: "fixture", fixtureId: f.id, charterers: true }); for (const b of bk.redelivery || []) if (+b.qty && rAt && redelActual(f)) ev.push({ at: rAt, kind: "out", grade: b.grade || "", qty: +b.qty, price: +b.price || 0, source: "fixture", fixtureId: f.id, charterers: true }); }
    const log = px.bunkerLogByVessel.get(vesselId) || []; const consAt = new Set();
    for (const x of log) { if (!x || !x.at) continue; const k = x.kind || "receipt"; if (k === "stem" && x.status !== "delivered") continue; if (k === "receipt" || k === "stem") ev.push({ at: x.at, kind: "receipt", grade: x.grade || "", qty: +x.qty || 0, price: +x.price || 0, source: "log", id: x.id, voyageId: x.voyageId || null, billId: x.billId || null, port: x.port || "" }); else if (k === "consumption") { ev.push({ at: x.at, kind: "consumption", grade: x.grade || "", qty: +x.qty || 0, source: "log", id: x.id, voyageId: x.voyageId || null }); consAt.add((x.grade || "") + "@" + Math.floor(parse(x.at) / 3600000)); } else if (k === "survey") ev.push({ at: x.at, kind: "survey", grade: x.grade || "", qty: +x.qty || 0, source: "log", id: x.id, voyageId: x.voyageId || null }); }
    for (const n of px.noonByVessel.get(vesselId) || []) { if (!n || !n.at || !n.cons) continue; for (const [g, q] of Object.entries(n.cons)) { if (!(+q > 0)) continue; const key = g + "@" + Math.floor(parse(n.at) / 3600000); if (consAt.has(key)) continue; ev.push({ at: n.at, kind: "consumption", grade: g, qty: +q, source: "noon", id: n.id, voyageId: n.voyageId || null }); } }
    // same minute: receipts first, then consumption and bunkers out, and a survey last — so a measured ROB stamped with a noon report lands on the stock after that report's consumption
    const ORDER = { receipt: 0, consumption: 1, out: 2, survey: 3 };
    ev.sort((a, b) => (parse(a.at) || 0) - (parse(b.at) || 0) || (ORDER[a.kind] ?? 2) - (ORDER[b.kind] ?? 2));
    return ev;
  }
  function bunkerWalk(ps, vesselId, untilIso) {
    const layers = {}; const until = untilIso ? parse(untilIso) : Infinity; const consumed = []; let lastPrice = {};
    const draw = (grade, qty) => { const L = layers[grade] || (layers[grade] = []); let left = qty, cost = 0; while (left > 0.0005 && L.length) { const l = L[0]; const take = Math.min(left, l.qty); cost += take * l.price; l.qty = r4(l.qty - take); left = r4(left - take); if (l.qty <= 0.0005) L.shift(); } if (left > 0.0005) { cost += left * (lastPrice[grade] || 0); } return r2(cost); };
    for (const e of bunkerEvents(ps, vesselId)) { if (parse(e.at) > until) break; const g = e.grade || "";
      if (e.kind === "receipt") { (layers[g] || (layers[g] = [])).push({ qty: +e.qty, price: +e.price, at: e.at, source: e.source, port: e.port || "", charterers: !!e.charterers }); if (+e.price) lastPrice[g] = +e.price; }
      else if (e.kind === "consumption" || e.kind === "out") { const cost = draw(g, +e.qty); consumed.push({ ...e, cost, unitCost: +e.qty ? r2(cost / +e.qty) : 0 }); }
      else if (e.kind === "survey") { const have = r4(sum(layers[g] || [], (l) => l.qty)); const diff = r4(have - +e.qty); if (diff > 0.0005) { const cost = draw(g, diff); consumed.push({ ...e, kind: "consumption", qty: diff, cost, unitCost: r2(cost / diff), adjustment: true }); } else if (diff < -0.0005) (layers[g] || (layers[g] = [])).push({ qty: -diff, price: lastPrice[g] || 0, at: e.at, source: "survey" }); } }
    const stock = {}; for (const [g, L] of Object.entries(layers)) { const qty = r4(sum(L, (l) => l.qty)); const value = r2(sum(L, (l) => l.qty * l.price)); if (qty > 0.0005 || L.length) stock[g] = { grade: g, qty, value, avgPrice: qty ? r2(value / qty) : lastPrice[g] || 0, layers: L.filter((l) => l.qty > 0.0005).map((l) => ({ ...l })) }; }
    return { stock, consumed, lastPrice };
  }
  function bunkerStock(ps, vesselId, atIso) { const key = "bs|" + psSig(ps || {}) + "|" + vesselId + "|" + (atIso || ""); return memo(key, () => { const w = bunkerWalk(ps, vesselId, atIso); const grades = Object.values(w.stock); return { vesselId, at: atIso || null, grades, totalQty: r4(sum(grades, (g) => g.qty)), totalValue: r2(sum(grades, (g) => g.value)), lastPrice: w.lastPrice }; }); }
  // consumption of a voyage (or a period): FIFO cost of what was burnt; a voyage without any recorded burn falls back to the
  // voyage's own consumption table priced at the voyage/fixture prices (flagged as "recorded: false")
  function voyageBunkers(ps, vy, span, f) {
    const w = bunkerWalk(ps, vy.vesselId); const s = parse(span.from), e = parse(span.to);
    const mine = w.consumed.filter((c) => c.kind === "consumption" && (c.voyageId ? c.voyageId === vy.id : !isNaN(s) && !isNaN(e) && parse(c.at) >= s && parse(c.at) <= e));
    const byGrade = {}; for (const c of mine) { const g = byGrade[c.grade] || (byGrade[c.grade] = { grade: c.grade, qty: 0, cost: 0 }); g.qty = r4(g.qty + c.qty); g.cost = r2(g.cost + c.cost); }
    let recorded = mine.length > 0; let rows = Object.values(byGrade).map((g) => ({ ...g, price: g.qty ? r2(g.cost / g.qty) : 0 }));
    if (!recorded) { const prices = Object.assign({}, (f && f.bunkers && f.bunkers.prices) || {}, (vy.bunkers && vy.bunkers.prices) || {}); rows = ((vy.bunkers && vy.bunkers.consumption) || []).filter((c) => +c.qty).map((c) => ({ grade: c.grade || "", qty: +c.qty, price: +prices[c.grade] || +c.price || w.lastPrice[c.grade] || 0, cost: r2(+c.qty * (+prices[c.grade] || +c.price || w.lastPrice[c.grade] || 0)) })); }
    const receipts = (psIndex(ps).bunkerLogByVoyage.get(vy.id) || []).filter((x) => (x.kind === "receipt" || (x.kind === "stem" && x.status === "delivered")) && +x.qty).map((x) => ({ id: x.id, at: x.at, port: x.port || "", grade: x.grade || "", qty: +x.qty, price: +x.price || 0, cost: r2(+x.qty * (+x.price || 0)), billId: x.billId || null, supplierCpId: x.supplierCpId || null }));
    const stems = (psIndex(ps).bunkerLogByVoyage.get(vy.id) || []).filter((x) => x.kind === "stem" && x.status !== "delivered").map((x) => ({ id: x.id, at: x.at, port: x.port || "", grade: x.grade || "", qty: +x.qty || 0, price: +x.price || 0, cost: r2((+x.qty || 0) * (+x.price || 0)), status: x.status || "planned", supplierCpId: x.supplierCpId || null }));
    return { consumed: rows, cost: r2(sum(rows, (r) => r.cost)), recorded, receipts, stems, events: mine, valuation: "fifo" };
  }
  // the P&L of one voyage out of the book: every invoice (hire pro-rata by period overlap for time charters, freight and demurrage
  // in full), every bill, bank line and journal tagged with the voyage, disbursement accounts, bunkers burnt at FIFO cost
  function voyageResultCore(ps, store, voyageId, opt) {
    opt = opt || {}; ps = ps || {}; store = store || {}; const now = opt.now || nowIso(); const today = now.slice(0, 10);
    const ix = index(store), px = psIndex(ps); const vy = px.voyageById.get(voyageId) || null; if (!vy) return null;
    const vesselId = vy.vesselId; const f = vy.fixtureId ? px.fixtureById.get(vy.fixtureId) || null : null;
    const vessel = { ...(ix.vesselById.get(vesselId) || {}), ...(px.vesselById.get(vesselId) || {}) };
    const span = voyageSpan(ps, vy); const currency = (f && f.currency) || vy.currency || opt.currency || "USD";
    const sMs = parse(span.from), eMs = parse(span.to); const hasSpan = !isNaN(sMs) && !isNaN(eMs) && eMs > sMs;
    const fixtureVoyages = f ? (px.voyagesByVessel.get(vesselId) || []).filter((v) => v.fixtureId === f.id) : [];
    const vEnt = ix.entityById.get(vessel.managerEntityId || vessel.entityId) || null;
    // the voyage is measured in the fixture currency; documents in the books' currency come across at the rate the invoices in that currency were booked at, else the day's table
    const fxOf = (d) => (+d.fx > 0 ? +d.fx : (vEnt && d.currency ? fxOn(store, d.currency, vEnt.currency, d.date) : null) || 1); const vfx = opt.fx || (() => { const inv = (f ? ix.invoicesByFixture.get(f.id) || [] : []).find((i) => i.currency === currency && +i.fx > 0); if (inv) return +inv.fx; return (vEnt && vEnt.currency !== currency && fxOn(store, currency, vEnt.currency, span.from || today)) || 1; })();
    let mixed = false; const toV = (amount, d) => { if (!d.currency || d.currency === currency) return +amount || 0; mixed = true; return r2(((+amount || 0) * fxOf(d)) / vfx); };
    const lines = []; const revenue = { hire: 0, freight: 0, demurrage: 0, despatch: 0, ballastBonus: 0, commissions: 0, interim: 0, awrp: 0, heating: 0, extras: 0, other: 0, total: 0 }; /* 4.32.2 · the charterer-paid extras have their own keys */
    const addRev = (inv, share, how) => { const kinds = invoiceLineKinds(store, inv); const amt = r2(toV(+inv.net || +inv.amount || 0, inv) * share); for (const [k, v] of Object.entries(kinds)) revenue[k in revenue ? k : "other"] = r2(revenue[k in revenue ? k : "other"] + toV(v, inv) * share); lines.push({ kind: "invoice", id: inv.id, ref: inv.ref, date: inv.date, due: inv.due, cpId: inv.counterpartyId, description: inv.meta && inv.meta.period ? fmtAt(inv.meta.period.from) + " – " + fmtEnd(inv.meta.period.to) : (tradeOf(store, inv.tradeId) || {}).ref || "", category: (inv.meta && inv.meta.kind) || Object.keys(kinds)[0] || "invoice", amount: +inv.amount || 0, net: +inv.net || 0, currency: inv.currency || currency, allocated: amt, share: r4(share), how, open: docOpen(inv), paid: +inv.paid || 0, status: docStatus(inv, today), base: r2((+inv.amount || 0) * fxOf(inv)), voyageTagged: ix.docVoyage(inv) === vy.id, recorded: isRecorded(inv) }); };
    const seen = new Set();
    for (const inv of ix.invoicesByVoyage.get(vy.id) || []) { seen.add(inv.id); addRev(inv, 1, "tagged"); }
    if (f) for (const inv of ix.invoicesByFixture.get(f.id) || []) { if (seen.has(inv.id)) continue; const vyOf = ix.docVoyage(inv); if (vyOf && vyOf !== vy.id) continue; const m = inv.meta || (tradeOf(store, inv.tradeId) || {}).meta || {}; if (m.period && m.period.from && m.period.to && hasSpan) { const pm = Math.max(0, minutes(m.period.from, m.period.to)); const ov = overlapMinutes({ from: m.period.from, to: m.period.to }, { from: span.from, to: span.to }); if (pm > 0 && ov > 0) { seen.add(inv.id); addRev(inv, Math.min(1, ov / pm), "pro-rata"); } } else if (fixtureVoyages.length === 1) { seen.add(inv.id); addRev(inv, 1, "fixture"); } }
    revenue.total = r2(revenue.hire + revenue.freight + revenue.demurrage + revenue.despatch + revenue.ballastBonus + revenue.commissions + revenue.interim + revenue.awrp + revenue.heating + revenue.extras + revenue.other);
    const costs = { bunkers: 0, portDa: 0, canal: 0, commissions: 0, agency: 0, insurance: 0, claims: 0, other: 0, total: 0 };
    const addCost = (kind, v) => { costs[kind in costs ? kind : "other"] = r2(costs[kind in costs ? kind : "other"] + v); };
    const billIds = new Set();
    for (const b of ix.billsByVoyage.get(vy.id) || []) { billIds.add(b.id); const desp = /^despatch$/i.test(b.category || "") || !!(b.meta && b.meta.kind === "despatch"); const kind = desp ? "despatch" : costKind([b.category, b.memo, b.payee].filter(Boolean).join(" ")); const v = toV(+b.net || +b.amount || 0, b);
      // x.y · despatch the owners pay the charterers is less revenue, not a voyage cost (the freight invoice carries it as a negative line)
      if (desp) { revenue.despatch = r2(revenue.despatch - v); revenue.total = r2(revenue.total - v); } else addCost(kind, v); lines.push({ kind: "bill", internal: !!b.internal, id: b.id, ref: b.ref, date: b.date, due: b.due, cpId: b.counterpartyId, description: b.memo || b.category || "", category: b.category || kind, costKind: kind, amount: +b.amount || 0, net: +b.net || 0, currency: b.currency || currency, allocated: -r2(v), share: 1, how: "tagged", open: docOpen(b), paid: +b.paid || 0, status: docStatus(b, today), base: r2((+b.amount || 0) * fxOf(b)), voyageTagged: true, recorded: isRecorded(b) }); }
    for (const t of ix.bankTxByVoyage.get(vy.id) || []) { const bank = ix.bankById.get(t.bankId) || {}; const d = { currency: t.currency, fx: bank.fx }; const v = toV(+t.net || +t.amount || 0, d); if (t.kind === "in") { revenue.other = r2(revenue.other + v); revenue.total = r2(revenue.total + v); lines.push({ kind: "banktx", id: t.id, ref: t.reference || "Bank", date: t.date, due: "", cpId: t.counterpartyId || null, description: (t.payee ? t.payee + " · " : "") + (t.memo || t.category || ""), category: t.category || "", amount: +t.amount || 0, net: +t.net || 0, currency: t.currency, allocated: r2(v), share: 1, how: "tagged", open: 0, paid: +t.amount || 0, status: "paid", base: r2((+t.amount || 0) * (bank.fx || 1)), voyageTagged: true, direction: "in" }); } else { const kind = costKind([t.category, t.memo, t.payee].filter(Boolean).join(" ")); addCost(kind, v); lines.push({ kind: "banktx", id: t.id, ref: t.reference || "Bank", date: t.date, due: "", cpId: t.counterpartyId || null, description: (t.payee ? t.payee + " · " : "") + (t.memo || t.category || ""), category: t.category || kind, costKind: kind, amount: +t.amount || 0, net: +t.net || 0, currency: t.currency, allocated: -r2(v), share: 1, how: "tagged", open: 0, paid: +t.amount || 0, status: "paid", base: r2((+t.amount || 0) * (bank.fx || 1)), voyageTagged: true, direction: "out" }); } }
    for (const j of ix.journalsByVoyage.get(vy.id) || []) { if (j.reversedBy || !j.ref || j.ref.type !== "journal") continue; let exp = 0, inc = 0; for (const l of j.lines || []) { if (["expense", "fees", "cogs", "inventory_loss"].includes(l.account)) exp += (l.debit || 0) - (l.credit || 0); if (l.account === "revenue" || l.account === "other_income") inc += (l.credit || 0) - (l.debit || 0); } exp = r2(exp); inc = r2(inc); if (exp) { const kind = costKind(j.memo); addCost(kind, exp / vfx); } if (inc) { revenue.other = r2(revenue.other + inc / vfx); revenue.total = r2(revenue.total + inc / vfx); } if (exp || inc) lines.push({ kind: "journal", id: j.id, ref: "Journal", date: j.date, due: "", cpId: j.ref.counterpartyId || null, description: j.memo || "", category: costKind(j.memo), amount: exp || inc, net: exp || inc, currency, allocated: r2((inc - exp) / vfx), share: 1, how: "tagged", open: 0, paid: exp || inc, status: "posted", base: exp || inc, voyageTagged: true }); }
    // disbursement accounts: a DA without a bill of its own is accrued at FDA (or the advance) so the P&L does not wait for paper
    const das = (px.dasByVoyage.get(vy.id) || []).map((x) => { const pb = x.pdaBillId ? ix.billById.get(x.pdaBillId) : null, fb = x.fdaBillId ? ix.billById.get(x.fdaBillId) : null, pt = x.pdaTxId ? ix.txById.get(x.pdaTxId) : null; const port = x.port || ((vy.ports || []).find((p) => p.id === x.portId) || {}).name || ""; const billed = r2((fb ? +fb.amount : 0) + (pb ? +pb.amount : 0) + (pt ? +pt.amount : 0)); const paid = r2((pb ? +pb.paid || 0 : 0) + (fb ? +fb.paid || 0 : 0) + (pt ? +pt.amount || 0 : 0)); const accrued = !pb && !fb && !pt ? r2(+x.fda || +x.pda || 0) : (fb || x.fda == null || x.fda === "" ? 0 : Math.max(0, r2(+x.fda - (pb ? +pb.amount : 0) - (pt ? +pt.amount : 0)))); if (accrued) { addCost("portDa", toV(accrued, { currency: x.currency || currency })); lines.push({ kind: "da", id: x.id, ref: "DA " + port, date: (x.fdaReceivedAt || x.pdaPaidAt || "").slice(0, 10), due: "", cpId: x.agentCpId || null, description: (x.fda != null && x.fda !== "" ? (pb || pt ? "FDA balance" : "FDA") : "PDA") + " " + port + (x.status ? " · " + x.status : ""), category: "portDa", costKind: "portDa", amount: accrued, net: accrued, currency: x.currency || currency, allocated: -r2(toV(accrued, { currency: x.currency || currency })), share: 1, how: "accrued", open: x.status === "settled" ? 0 : accrued, paid: x.status === "settled" ? accrued : 0, status: x.status === "settled" ? "paid" : "accrued", base: accrued, voyageTagged: true }); } return { id: x.id, portId: x.portId || null, port, agentCpId: x.agentCpId || null, currency: x.currency || currency, pda: +x.pda || 0, fda: x.fda != null && x.fda !== "" ? +x.fda : null, billed, paid, variance: x.fda != null && x.fda !== "" ? r2(+x.fda - (+x.pda || 0)) : null, status: x.status || (x.fda != null && x.fda !== "" ? "fda-received" : x.pdaPaidAt ? "advance-paid" : "requested"), pdaBillId: x.pdaBillId || null, fdaBillId: x.fdaBillId || null, pdaTxId: x.pdaTxId || null, pdaPaidAt: x.pdaPaidAt || null, fdaReceivedAt: x.fdaReceivedAt || null, balance: x.fda != null && x.fda !== "" ? r2(+x.fda - paid) : r2((+x.pda || 0) - paid) }; });
    // x.y · a laytime result entered as agreed accrues until a document carries it (an invoice for demurrage, a bill or a freight line for
    // despatch): revenue from its own date (settlement, else the voyage's end), so a back-dated voyage reads right before the paper is in
    const lr = laytimeResult(vy, f, { ps }); let laytimeAcc = null;
    if (lr && lr.amount > 0.005 && (lr.kind === "demurrage" || lr.kind === "despatch")) { const carried = (lr.invoiceId && ix.invoiceById.get(lr.invoiceId)) || (lr.billId && ix.billById.get(lr.billId)) || lines.some((l) => (l.kind === "invoice" && (l.category === lr.kind || (l.category === "claim" && lr.kind === "demurrage"))) || (l.kind === "bill" && lr.kind === "despatch" && /despatch/i.test(l.category || "")));
      if (!carried) { const v = r2(toV(lr.amount, { currency: lr.currency })); const sg = lr.kind === "despatch" ? -1 : 1; revenue[lr.kind] = r2(revenue[lr.kind] + sg * v); revenue.total = r2(revenue.total + sg * v); laytimeAcc = { kind: lr.kind, amount: lr.amount, currency: lr.currency, date: lr.date };
        lines.push({ kind: "laytime", id: "laytime:" + vy.id, ref: lr.kind === "despatch" ? "Despatch" : "Demurrage", date: lr.date || "", due: "", cpId: lr.cpId, description: (lr.kind === "despatch" ? "Despatch" : "Demurrage") + (lr.agreed != null ? " agreed" : " per laytime") + (lr.hours != null ? " · " + r2(lr.hours) + " h" : "") + (lr.settled ? " · settled " + fmtDate(lr.date) : "") + " · not yet invoiced", category: lr.kind, amount: lr.amount, net: lr.amount, currency: lr.currency, allocated: sg * v, share: 1, how: "accrued", open: 0, paid: 0, status: "accrued", base: lr.amount, voyageTagged: false }); } }
    // 4.32.2 · the extras typed on the fixture for the charterer's account (interim port, AWRP, heating, other) accrue the same way: revenue from
    // the voyage's end until an invoice carries a line of that kind (a freight invoice with the pre-ticked line, or one recorded from outside)
    const extrasAcc = []; if (f && f.kind === "voyage") { const vyAll = fixtureVoyages.length ? fixtureVoyages : [vy]; const first = vyAll.find((x) => x.status === "completed") || vyAll[0]; if (!first || first.id === vy.id) for (const x of fixtureExtras(f)) { const carried = Math.abs(revenue[x.kind] || 0) > 0.005; if (carried) continue; const v = r2(toV(x.amount, { currency: x.currency })); revenue[x.kind] = r2(revenue[x.kind] + v); revenue.total = r2(revenue.total + v); extrasAcc.push({ kind: x.kind, label: x.label, amount: x.amount, currency: x.currency });
      lines.push({ kind: "extra", id: "extra:" + vy.id + ":" + x.kind, ref: x.label, date: span.to ? String(span.to).slice(0, 10) : "", due: "", cpId: f.chartererCpId || null, description: extraLine(x).description.replace(/, for charterers' account$/, "") + " · charterers' account · not yet invoiced", category: x.kind, amount: x.amount, net: x.amount, currency: x.currency, allocated: v, share: 1, how: "accrued", open: 0, paid: 0, status: "accrued", base: x.amount, voyageTagged: false }); } }
    // bunkers burnt on the voyage (FIFO), unless the fixture is a time charter where the charterer supplies them
    const bunkers = f && (f.kind === "tc" || f.kind === "bareboat") ? { consumed: [], cost: 0, recorded: false, receipts: [], stems: [], charterers: true, valuation: "fifo" } : voyageBunkers(ps, vy, span, f);
    if (!bunkers.charterers && bunkers.cost && !costs.bunkers) { addCost("bunkers", bunkers.cost); bunkers.counted = "consumption"; } else if (bunkers.charterers) bunkers.counted = "none"; else bunkers.counted = costs.bunkers ? "bills" : "none";
    costs.total = r2(costs.bunkers + costs.portDa + costs.canal + costs.commissions + costs.agency + costs.insurance + costs.claims + costs.other);
    const result = r2(revenue.total - costs.total);
    const untilMs = hasSpan ? Math.min(eMs, parse(now)) : NaN; const voyageMinutes = hasSpan ? Math.max(0, Math.round((untilMs - sMs) / MIN)) : 0; const voyageDays = days(voyageMinutes);
    const tce = voyageDays > 0 ? r2(result / voyageDays) : 0;
    const estimate = voyageEstimateFor(ps, vy, f || {}, { now, actualDays: voyageDays }); const estDays = estimate.tceDays || voyageDays;
    const variance = { revenue: r2(revenue.total - estimate.revenue), commissions: r2(-revenue.commissions - estimate.commissions), costs: r2(costs.total - estimate.costs), result: r2(result - estimate.result), tce: r2(tce - estimate.tce), days: r4(voyageDays - estDays) };
    const cash = { received: r2(sum(lines.filter((l) => l.kind === "invoice"), (l) => toV(l.paid, { currency: l.currency }) * l.share) + sum(lines.filter((l) => l.kind === "banktx" && l.direction === "in"), (l) => l.allocated)), receivable: r2(sum(lines.filter((l) => l.kind === "invoice"), (l) => toV(l.open, { currency: l.currency }) * l.share)), paid: r2(sum(lines.filter((l) => (l.kind === "bill" || l.kind === "internal")), (l) => toV(l.paid, { currency: l.currency })) + sum(lines.filter((l) => l.kind === "banktx" && l.direction === "out"), (l) => -l.allocated) + sum(das, (d) => d.paid)), payable: r2(sum(lines.filter((l) => (l.kind === "bill" || l.kind === "internal")), (l) => toV(l.open, { currency: l.currency })) + sum(lines.filter((l) => l.kind === "da"), (l) => l.open)) };
    cash.net = r2(cash.received - cash.paid);
    lines.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    const counts = { invoices: lines.filter((l) => l.kind === "invoice").length, bills: lines.filter((l) => l.kind === "bill" || l.kind === "internal").length, overdue: lines.filter((l) => l.status === "overdue").length, unpaid: lines.filter((l) => l.status === "unpaid" || l.status === "part-paid").length };
    // 4.31.1 · the TCE to show: the estimate's (est.) while the voyage is open, the booked one once completed — the figure performance() reports
    const tceEstimated = vy.status !== "completed"; const tceShown = tceEstimated ? estimate.tce : tce;
    return { voyageId: vy.id, voyage: vy, vesselId, vessel, fixture: f, currency, mixedCurrencies: mixed, span: { ...span, days: days(span.minutes) }, voyageDays, revenue, costs, result, tce, tceShown, tceEstimated, estimate, variance, lines, das, bunkers, cash, counts, now, laytime: lr, laytimeAccrued: laytimeAcc, extrasAccrued: extrasAcc, extrasTotal: r2(revenue.interim + revenue.awrp + revenue.heating + revenue.extras) };
  }
  function voyageResult(ps, store, voyageId, opt) { opt = opt || {}; const now = opt.now || nowIso(); const key = "vr|" + storeSig(store || {}) + "|" + psSig(ps || {}) + "|" + voyageId + "|" + now.slice(0, 16) + "|" + (opt.fx || ""); return memo(key, () => voyageResultCore(ps, store, voyageId, { ...opt, now })); }
  // costs of the vessel in the voyage's window that nobody has assigned to a voyage yet — offered for one-click assignment
  function voyageCandidates(ps, store, voyageId, opt) {
    opt = opt || {}; const ix = index(store || {}); const vy = voyageOf(ps, voyageId); if (!vy) return []; const span = voyageSpan(ps, vy); const s = parse(span.from), e = parse(span.to); const pad = (opt.padDays != null ? opt.padDays : 14) * DAYM * MIN;
    const inWin = (date) => { if (!date) return false; const t = parse(date); if (isNaN(s) || isNaN(e)) return true; return t >= s - pad && t <= e + pad; };
    const out = [];
    for (const b of ix.billsByVessel.get(vy.vesselId) || []) if (!ix.docVoyage(b) && inWin(b.date)) out.push({ kind: "bill", id: b.id, ref: b.ref, date: b.date, cpId: b.counterpartyId, description: b.memo || b.category || "", amount: +b.amount || 0, currency: b.currency, status: docStatus(b, (opt.now || nowIso()).slice(0, 10)) });
    for (const t of ix.bankTxByVessel.get(vy.vesselId) || []) if (!t.voyageId && inWin(t.date)) out.push({ kind: "banktx", id: t.id, ref: t.reference || "Bank", date: t.date, cpId: t.counterpartyId || null, description: (t.payee ? t.payee + " · " : "") + (t.memo || t.category || ""), amount: (t.kind === "in" ? 1 : -1) * (+t.amount || 0), currency: t.currency, status: "paid" });
    for (const j of ix.journalsByVessel.get(vy.vesselId) || []) if (j.ref && j.ref.type === "journal" && !j.reversedBy && !ix.journalVoyage(j) && inWin(j.date)) out.push({ kind: "journal", id: j.id, ref: "Journal", date: j.date, cpId: null, description: j.memo || "", amount: r2(sum(j.lines || [], (l) => l.debit || 0)), currency: "", status: "posted" });
    for (const i of ix.invoicesByVessel.get(vy.vesselId) || []) { if (ix.docVoyage(i)) continue; const m = i.meta || (tradeOf(store, i.tradeId) || {}).meta || {}; if (m.period) continue; if (inWin(i.date)) out.push({ kind: "invoice", id: i.id, ref: i.ref, date: i.date, cpId: i.counterpartyId, description: (tradeOf(store, i.tradeId) || {}).ref || "", amount: +i.amount || 0, currency: i.currency, status: docStatus(i, (opt.now || nowIso()).slice(0, 10)) }); }
    return out.sort((a, b) => (a.date < b.date ? 1 : -1));
  }
  // ---- hire statements: every period of a fixture with where its money stands
  function hireStatementsCore(ps, store, fixture, opt) {
    opt = opt || {}; const now = opt.now || nowIso(); const today = now.slice(0, 10); const ix = index(store || {}); const f = fixture; if (!f) return [];
    const list = periods(f, now); const offs = offhiresOf(ps, f);
    const invs = (ix.invoicesByFixture.get(f.id) || []).filter((i) => { const m = i.meta || (tradeOf(store, i.tradeId) || {}).meta || {}; return m.period && m.period.from && m.period.to; }).map((i) => { const m = i.meta || (tradeOf(store, i.tradeId) || {}).meta; return { i, f: parse(m.period.from), t: parse(m.period.to) }; });
    const covered = (p) => coverOf(invs, p._s, p._e);
    const onAcc = r2(sum((ix.paymentsByFixture.get(f.id) || []).filter((x) => x.onAccount && !x.reversed), (x) => x.amount - (x.applied || 0)));
    return list.map((p) => { const inv = covered(p); const paysFor = inv ? (ix.paymentsByInvoice.get(inv.id) || []).filter((x) => x.kind === "in") : []; const dueAt = inv ? (inv.due ? inv.due + "T00:00" : p.dueAt) : p.dueAt; const ds = inv ? docStatus(inv, today) : ""; const st = !inv ? "not invoiced" : ds === "unpaid" ? "invoiced" : ds; const amount = inv ? +inv.amount : hire(f, offs, p.from, p.to, { vesselName: opt.vesselName }).net; const overdueDays = st === "overdue" ? Math.max(0, Math.floor((parse(today) - parse(inv.due)) / (DAYM * MIN))) : (!inv && parse(p.dueAt) < parse(now) ? Math.floor((parse(now) - parse(p.dueAt)) / (DAYM * MIN)) : 0); const paidAt = paysFor.length ? paysFor.map((x) => x.date).sort().pop() : null; return { id: f.id + ":" + p.no, fixtureId: f.id, vesselId: f.vesselId || null, no: p.no, from: p.from, to: p.to, minutes: p.minutes, days: days(p.minutes), dueAt, amount: r2(amount), currency: f.currency || "USD", invoiceId: inv ? inv.id : null, invoiceRef: inv ? inv.ref : null, status: st, due: !inv && parse(p.dueAt) <= parse(now), open: inv ? docOpen(inv) : r2(amount), paid: inv ? +inv.paid || 0 : 0, paidAt, overdueDays, final: !!p.final, onAccountOpen: onAcc }; });
  }
  function hireStatements(ps, store, fixture, opt) { opt = opt || {}; const now = opt.now || nowIso(); const key = "hs|" + storeSig(store || {}) + "|" + psSig(ps || {}) + "|" + (fixture && fixture.id) + "|" + now.slice(0, 16); return memo(key, () => hireStatementsCore(ps, store, fixture, { ...opt, now })); }
  // the cache rows A3's pages read (ps.hireStatements); returns the rows that differ from what the document holds
  function hireStatementRows(ps, store, opt) { const out = []; for (const f of (ps && ps.fixtures) || []) { if (!f || f.status === "cancelled" || f.kind === "voyage" || !delAt(f)) continue; for (const r of hireStatements(ps, store, f, opt)) out.push({ ...r, updated: (opt && opt.now) || nowIso() }); } return out; }
  // ---- cash flow by week: what is expected in and out for a vessel or a selection, from due dates and the hire calendar
  function cashflowCore(ps, store, vesselIds, opt) {
    opt = opt || {}; ps = ps || {}; store = store || {}; const now = opt.now || nowIso(); const today = now.slice(0, 10); const ix = index(store), px = psIndex(ps);
    const ids = vesselIds && vesselIds.length ? vesselIds : (ps.vessels || []).map((v) => v.id);
    const start = parse((opt.from || today) + (opt.from && opt.from.length > 10 ? "" : "T00:00")); const weeks = opt.weeks || 12; const end = opt.to ? parse(opt.to + "T24:00") : start + weeks * 7 * DAYM * MIN;
    const buckets = []; for (let t = start; t < end; t += 7 * DAYM * MIN) buckets.push({ from: isoDate(t), to: isoDate(Math.min(end, t + 7 * DAYM * MIN) - MIN), _s: t, _e: Math.min(end, t + 7 * DAYM * MIN), inflow: 0, outflow: 0, net: 0, items: [] });
    const put = (at, item) => { let t = parse(at); if (isNaN(t)) t = start; if (t < start) { t = start; item.overdue = true; } const b = buckets.find((x) => t >= x._s && t < x._e); if (!b) return; if (item.amount >= 0) b.inflow = r2(b.inflow + item.amount); else b.outflow = r2(b.outflow - item.amount); b.net = r2(b.inflow - b.outflow); b.items.push(item); };
    const pres = presCcy(ps, opt); let unconverted = false; const convs = new Map(); const cvFor = (eid) => { if (!convs.has(eid)) convs.set(eid, presConverter(store, ix.entityById.get(eid) || null, pres)); return convs.get(eid); };
    // every expected amount is shown in the presentation currency; the original stays on the item
    const toP = (amount, ccy, date, docFx, entityId) => { ccy = String(ccy || pres).toUpperCase(); amount = +amount || 0; if (ccy === pres) return r2(amount); if (entityId && +docFx > 0) return r2(amount * +docFx * cvFor(entityId).rate(date)); const r = fxOn(store, ccy, pres, date); if (r) return r2(amount * r); unconverted = true; return r2(amount); };
    const currencies = {}; const name = (id) => ((px.vesselById.get(id) || ix.vesselById.get(id) || {}).name || id);
    for (const vid of ids) {
      for (const i of ix.invoicesByVessel.get(vid) || []) { const o = docOpen(i); if (o > 0.005) { currencies[i.currency] = 1; put((i.due || i.date) + "T00:00", { kind: "invoice", id: i.id, ref: i.ref, vesselId: vid, vessel: name(vid), cpId: i.counterpartyId, amount: toP(o, i.currency, i.due || i.date, i.fx, i.entityId), currency: pres, origAmount: r2(o), origCurrency: i.currency, date: i.due || i.date, status: docStatus(i, today) }); } }
      for (const b of ix.billsByVessel.get(vid) || []) { const o = docOpen(b); if (o > 0.005 && !b.pending) { currencies[b.currency] = 1; put((b.due || b.date) + "T00:00", { kind: "bill", id: b.id, ref: b.ref, vesselId: vid, vessel: name(vid), cpId: b.counterpartyId, amount: -toP(o, b.currency, b.due || b.date, b.fx, b.entityId), currency: pres, origAmount: r2(o), origCurrency: b.currency, date: b.due || b.date, status: docStatus(b, today) }); } }
      for (const f of px.fixturesByVessel.get(vid) || []) { if (f.kind === "voyage" || !delAt(f)) continue; for (const r of hireStatements(ps, store, f, { now })) { if (r.invoiceId || parse(r.dueAt) >= end) continue; if (parse(r.dueAt) < start - 60 * DAYM * MIN) continue; currencies[r.currency] = 1; put(r.dueAt, { kind: "hire", id: r.id, ref: "Hire " + r.no, vesselId: vid, vessel: name(vid), cpId: f.chartererCpId, amount: toP(r.amount, r.currency, r.dueAt), currency: pres, origAmount: r2(r.amount), origCurrency: r.currency, date: r.dueAt.slice(0, 10), status: r.due ? "due, not invoiced" : "upcoming", fixtureId: f.id, from: r.from, to: r.to }); } }
      for (const x of px.dasByVessel.get(vid) || []) { if (x.status === "settled") continue; const vy = px.voyageById.get(x.voyageId); const port = (vy && (vy.ports || []).find((p) => p.id === x.portId)) || null; const pb = x.pdaBillId ? ix.billById.get(x.pdaBillId) : null, fb = x.fdaBillId ? ix.billById.get(x.fdaBillId) : null; if (pb || fb) continue; /* the bills carry it */ if (x.pdaTxId && (x.fda == null || x.fda === "")) continue; /* the advance left the bank already */ const amt = x.fda != null && x.fda !== "" ? r2(+x.fda - (x.pdaPaidAt ? +x.pda || 0 : 0)) : (x.pdaPaidAt ? 0 : +x.pda || 0); if (!(Math.abs(amt) > 0.005)) continue; currencies[x.currency || "USD"] = 1; put(x.fdaReceivedAt ? addMinutes(x.fdaReceivedAt, 7 * DAYM) : ((port && (port.eta || port.ata)) || now), { kind: "da", id: x.id, ref: "DA " + (x.port || (port && port.name) || ""), vesselId: vid, vessel: name(vid), cpId: x.agentCpId || null, amount: -toP(amt, x.currency || "USD", x.fdaReceivedAt || (port && (port.eta || port.ata)) || now), currency: pres, origAmount: amt, origCurrency: x.currency || "USD", date: (x.fdaReceivedAt || (port && (port.eta || port.ata)) || now).slice(0, 10), status: x.status || "requested" }); }
      for (const x of px.bunkerLogByVessel.get(vid) || []) { if (x.kind !== "stem" || x.status === "delivered" || x.status === "cancelled") continue; const amt = r2((+x.qty || 0) * (+x.price || 0)); if (!(amt > 0.005) || x.billId) continue; currencies[x.currency || "USD"] = 1; put(x.at || now, { kind: "stem", id: x.id, ref: "Stem " + (x.port || "") + " " + (x.grade || ""), vesselId: vid, vessel: name(vid), cpId: x.supplierCpId || null, amount: -toP(amt, x.currency || "USD", x.at || now), currency: pres, origAmount: amt, origCurrency: x.currency || "USD", date: (x.at || now).slice(0, 10), status: x.status || "planned" }); }
    }
    for (const b of buckets) { delete b._s; delete b._e; b.items.sort((x, y) => (x.date < y.date ? -1 : 1)); }
    const totals = { inflow: r2(sum(buckets, (b) => b.inflow)), outflow: r2(sum(buckets, (b) => b.outflow)), net: 0, overdueIn: r2(sum(buckets, (b) => sum(b.items.filter((i) => i.overdue && i.amount > 0), (i) => i.amount))), overdueOut: r2(sum(buckets, (b) => sum(b.items.filter((i) => i.overdue && i.amount < 0), (i) => -i.amount))) }; totals.net = r2(totals.inflow - totals.outflow);
    let running = 0; for (const b of buckets) { running = r2(running + b.net); b.cumulative = running; }
    return { from: isoDate(start), to: isoDate(end - MIN), weeks: buckets, totals, currency: pres, origCurrencies: Object.keys(currencies).sort(), converted: Object.keys(currencies).some((c) => c !== pres), unconverted, mixedCurrencies: false, vesselIds: ids };
  }
  function cashflow(ps, store, vesselIds, opt) { opt = opt || {}; const now = opt.now || nowIso(); const ids = vesselIds && vesselIds.length ? vesselIds : ((ps && ps.vessels) || []).map((v) => v.id); const key = "cf|" + storeSig(store || {}) + "|" + psSig(ps || {}) + "|" + idsKey(ids) + "|" + (opt.from || "") + "|" + (opt.to || "") + "|" + (opt.weeks || "") + "|" + presCcy(ps, opt) + "|" + now.slice(0, 13); return memo(key, () => cashflowCore(ps, store, ids, { ...opt, now })); }
  // ---- consumption against the charter party's warranties (good-weather, from noon reports): the performance claim basis
  function consumption(ps, vesselId, range, opt) {
    opt = opt || {}; ps = ps || {}; const px = psIndex(ps); const reps = (px.noonByVessel.get(vesselId) || []).filter((n) => inRange((n.at || "").slice(0, 10), range));
    const f = opt.fixture || activeFixture(ps, vesselId, (range && range.to) ? range.to + "T12:00" : undefined) || null; const v = px.vesselById.get(vesselId) || {};
    const w = (f && f.warranties) || {}; const warrSpeed = +w.speedLaden || +w.speedBallast || +v.speedLaden || +v.speedBallast || 0; const warrCons = +w.consLaden || +w.consBallast || +v.consLaden || +v.consBallast || 0; const grade = w.grade || (v.grades && v.grades[0]) || "VLSFO";
    let hours = 0, dist = 0, sogSum = 0, sogN = 0; const cons = {}; for (const n of reps) { const h = +n.hoursSteaming || (n.distance && n.sog ? +n.distance / +n.sog : 24); hours += h; dist += +n.distance || 0; if (+n.sog) { sogSum += +n.sog; sogN++; } for (const [g, q] of Object.entries(n.cons || {})) cons[g] = r4((cons[g] || 0) + (+q || 0)); }
    const seaDays = r4(hours / 24); const mainCons = cons[grade] != null ? cons[grade] : Object.values(cons)[0] || 0; const actualDaily = seaDays > 0 ? r4(mainCons / seaDays) : 0;
    const avgSpeed = sogN ? r4(sogSum / sogN) : (hours > 0 ? r4(dist / hours) : 0);
    const excessDaily = warrCons ? Math.max(0, r4(actualDaily - warrCons)) : 0; const excess = r4(excessDaily * seaDays);
    const price = opt.price != null ? +opt.price : (bunkerStock(ps, vesselId).lastPrice[grade] || (f && f.bunkers && f.bunkers.prices && +f.bunkers.prices[grade]) || 0);
    const speedShort = warrSpeed && avgSpeed ? r4(warrSpeed - avgSpeed) : 0; const timeLost = speedShort > 0 && avgSpeed > 0 ? r4(dist / avgSpeed - dist / warrSpeed) : 0; // hours lost against the warranted speed
    const hireRate = f && (f.kind === "tc" || f.kind === "bareboat") ? (hasRateSteps(f) ? rateAt(f, offhiresOf(ps, f), (reps.length && reps[reps.length - 1].at) || ((range && range.to) ? range.to + "T12:00" : nowIso())) : +f.rate || 0) : 0; /* 4.34.7 · the rate in force at the time of the reports */
    // x.y · a claim rests on the charter party: with no warranties on the fixture the vessel's own particulars still give the comparison,
    // but no claim value (it was valued against her design figures before)
    const cpWarranted = !!(f && (+w.consLaden || +w.consBallast || +w.speedLaden || +w.speedBallast)); const warrantySource = cpWarranted ? "charter party" : warrCons || warrSpeed ? "vessel particulars" : null;
    const claimValue = cpWarranted ? r2((+w.consLaden || +w.consBallast ? excess * price : 0) + (timeLost > 0 && (+w.speedLaden || +w.speedBallast) ? hireRate * timeLost / 24 : 0)) : 0;
    return { vesselId, fixtureId: f ? f.id : null, reports: reps.length, seaDays, distanceNm: r2(dist), avgSpeed, warrantedSpeed: warrSpeed || null, speedShortfall: speedShort > 0 ? speedShort : 0, timeLostHours: timeLost > 0 ? timeLost : 0, grade, actualCons: r4(mainCons), actualDaily, warrantedCons: warrCons || null, warrantedTotal: r4((warrCons || 0) * seaDays), excessDaily, excess, price, claimValue, warrantySource, byGrade: cons, currency: (f && f.currency) || "USD" };
  }
  // ---- claims → invoice lines (demurrage from the laytime record, anything else as one line)
  // 4.31 · the subject of an action comes from the record — its own fixture, the fixture of its voyage, or the fixture in force on
  // its date — never from "whatever is current now" (the 4.30.5 invoice-hire bug, generalised)
  const noCmp = (a, b) => String(b.no == null ? "" : b.no).localeCompare(String(a.no == null ? "" : a.no), undefined, { numeric: true }) || String(b.created || "").localeCompare(String(a.created || ""));
  function voyagesOfFixture(ps, fixtureId) { return fixtureId ? ((ps && ps.voyages) || []).filter((v) => v && v.fixtureId === fixtureId && v.status !== "cancelled").sort(noCmp) : []; }
  function claimFixture(ps, claim) {
    if (!ps || !claim) return null; const px = psIndex(ps); const own = claim.fixtureId ? px.fixtureById.get(claim.fixtureId) : null; if (own && (!claim.vesselId || own.vesselId === claim.vesselId)) return own;
    const vy = claim.voyageId ? voyageOf(ps, claim.voyageId) : null; const vf = vy && vy.fixtureId ? px.fixtureById.get(vy.fixtureId) : null; if (vf) return vf;
    return claim.vesselId ? activeFixture(ps, claim.vesselId, claim.date ? String(claim.date).slice(0, 10) + "T12:00" : undefined) : null;
  }
  // the charter a voyage file sails under: its own fixture, else the one in force when she started it (never today's)
  function voyageFixture(ps, vy) { if (!ps || !vy) return null; const px = psIndex(ps); const own = vy.fixtureId ? px.fixtureById.get(vy.fixtureId) : null; if (own) return own; let at; try { const sp = voyageSpan(ps, vy); at = sp && sp.from ? sp.from : undefined; } catch (e) { at = undefined; } return at ? activeFixture(ps, vy.vesselId, at) : null; }
  // what an invoice form opened for (vessel, {fixtureId, voyageId, kind, at}) is about: that fixture and that voyage when given
  function invoiceTarget(ps, vesselId, ref) {
    ref = ref || {}; if (!ps || !vesselId) return { fixture: null, voyage: null }; const px = psIndex(ps); const want = (f) => f && f.vesselId === vesselId && f.status !== "cancelled" && (!ref.kind || (ref.kind === "voyage" ? f.kind === "voyage" : f.kind !== "voyage"));
    let f = ref.fixtureId ? px.fixtureById.get(ref.fixtureId) : null; if (!want(f)) f = null;
    let vy = ref.voyageId ? voyageOf(ps, ref.voyageId) : null; if (vy && vy.vesselId !== vesselId) vy = null;
    if (!f && vy && vy.fixtureId && want(px.fixtureById.get(vy.fixtureId))) f = px.fixtureById.get(vy.fixtureId);
    if (!f) { const a = activeFixture(ps, vesselId, ref.at); f = want(a) ? a : null; }
    if (!f) f = fixturesOf(ps, vesselId).filter(want).sort((a, b) => (parse(delAt(b) || b.cpDate) || 0) - (parse(delAt(a) || a.cpDate) || 0))[0] || null;
    if (vy && f && vy.fixtureId !== f.id) vy = null; if (!vy && f) vy = voyagesOfFixture(ps, f.id)[0] || null;
    return { fixture: f, voyage: vy };
  }
  function claimLines(ps, store, claim, opt) {
    opt = opt || {}; const px = psIndex(ps || {}); const f = claimFixture(ps, claim);
    const ccy = claim.currency || (f && f.currency) || "USD";
    if (claim.kind === "demurrage" && claim.voyageId) { const lts = px.laytimeByVoyage.get(claim.voyageId) || []; const vy = voyageOf(ps, claim.voyageId);
      // 4.30 · a voyage with a statement of facts invoices the sheet: the demurrage line(s), less the address commission and the brokerage it deducts
      if (lts.some((l) => l && Array.isArray(l.sof))) { const st = laytimeStatement(vy, f, lts); const ls = laytimeLines(st, { commissions: true }); if (ls.length) return { currency: st.currency || ccy, lines: ls, amount: r2(sum(ls, (l) => l.amount)), source: "laytime", statement: st }; }
      const fr = freight(f || {}, vy, { laytime: lts, vesselName: opt.vesselName }); const dem = fr.lines.filter((l) => l.kind === "demurrage" || l.kind === "despatch"); if (dem.length) return { currency: ccy, lines: dem, amount: r2(sum(dem, (l) => l.amount)), source: "laytime" }; }
    const amount = r2(+claim.amount || 0); const label = (claim.kind === "offhire" ? "Off-hire claim" : claim.kind === "damage" ? "Damage claim" : claim.kind === "cargo" ? "Cargo claim" : claim.kind === "performance" ? "Performance claim" : claim.kind === "demurrage" ? "Demurrage" : "Claim") + (opt.vesselName ? " " + MV(opt.vesselName) : "") + (claim.notes ? " — " + claim.notes : "");
    return { currency: ccy, lines: [{ kind: "claim", description: label, qty: 1, unit: "lumpsum", price: amount, amount }], amount, source: "claim" };
  }

  // ---------- 4.18 · a tenure: the time a vessel was under management, from the day she entered to the day she exited (or now),
  // and what happened in it — her fixtures, voyages, on-hire time, the money through the books, what was still open at the end.
  // tenure(ps, store, vesselId, { from, to, now, today }) — from/to default to her onboarded/offboarded dates; memoised like the rest.
  const EXIT_REASONS = [["sold", "Sold"], ["transferred", "Management transferred"], ["redelivered", "Redelivered to owners"], ["scrapped", "Scrapped / recycled"], ["loss", "Total loss"], ["owners", "Owners' decision"], ["other", "Other"]];
  const exitReasonName = (r) => (EXIT_REASONS.find((x) => x[0] === r) || [r, r || ""])[1];
  function tenure(ps, store, vesselId, opt) {
    opt = opt || {}; ps = ps || {}; store = store || {}; const now = opt.now || nowIso(); const today = opt.today || now.slice(0, 10);
    const psv = (ps.vessels || []).find((v) => v.id === vesselId) || {};
    const from = String(opt.from || psv.onboarded || "").slice(0, 10) || null; const to = String(opt.to || (opt.from ? "" : psv.offboarded) || "").slice(0, 10) || null;
    const key = "tn|" + storeSig(store) + "|" + psSig(ps) + "|" + vesselId + "|" + from + "|" + to + "|" + now.slice(0, 16) + "|" + today;
    return memo(key, () => {
      const end = to || today; const fromMs = from ? parse(from + "T00:00") : NaN; const endMs = to ? parse(to + "T24:00") : parse(now);
      const inside = (a, b) => { const s = a != null ? parse(a) : -Infinity, e = b != null ? parse(b) : Infinity; return (isNaN(fromMs) || e >= fromMs) && s <= endMs; };
      const fixtures = fixturesOf(ps, vesselId).filter((f) => f && f.status !== "cancelled" && inside(delAt(f) || f.cpDate, redelAt(f))).sort((a, b) => String(delAt(a) || a.cpDate || "").localeCompare(String(delAt(b) || b.cpDate || "")));
      const voyages = ((psIndex(ps).voyagesByVessel.get(vesselId)) || []).filter((v) => { const sp = voyageSpan(ps, v); return inside(sp.from, sp.to); });
      const range = from ? { from, to: end } : null;
      const fin = vesselFinance(ps, store, vesselId, range, { today, currency: opt.currency });
      const oh = onHire(ps, fixtures, range, to ? end + "T24:00" : now);
      const spanMin = !isNaN(fromMs) && endMs > fromMs ? Math.round((endMs - fromMs) / MIN) : oh.onMinutes + oh.offMinutes;
      const split = utilisationSplit(ps, vesselId, oh, isNaN(fromMs) ? -Infinity : fromMs, endMs, spanMin, to ? end + "T24:00" : now); // 4.31.11
      const byKind = {}; for (const f of fixtures) byKind[f.kind || "tc"] = (byKind[f.kind || "tc"] || 0) + 1;
      const charterers = [...new Set(fixtures.map((f) => f.chartererCpId).filter(Boolean))];
      const claims = ((psIndex(ps).claimsByVessel.get(vesselId)) || []).filter((c) => c && inside(c.date, c.date)); const claimsOpen = claims.filter((c) => c.status === "open").length;
      const openDocs = (fin.docs || []).filter((d) => d.open > 0.005);
      const pos = lastPosition(ps, vesselId) || (ps.positions || {})[psv.imo] || (ps.positions || {})[vesselId] || null;
      const ex = psv.exit && (!to || String(psv.exit.at || psv.offboarded || "").slice(0, 10) === to) ? psv.exit : null;
      return { vesselId, name: psv.name || "", imo: psv.imo || "", from, to, end, open: !to, days: spanMin ? r2(spanMin / DAYM) : 0, months: spanMin ? r2(spanMin / DAYM / 30.4375) : 0,
        fixtures: fixtures.map((f) => ({ id: f.id, kind: f.kind, label: fxLabel(f), chartererCpId: f.chartererCpId || null, rate: +f.rate || 0, rateText: hasRateSteps(f) ? rateText(f) : null, rateUnit: f.rateUnit || "day", currency: f.currency || "USD", from: delAt(f) || null, to: redelAt(f) || null, estimated: !!(f.redelivery && f.redelivery.estimated), status: f.status })),
        fixtureCount: fixtures.length, byKind, charterers, voyages: voyages.length, onHireDays: oh.onHireDays, offHireDays: oh.offHireDays, utilisation: spanMin > 0 ? r2(Math.min(100, oh.onMinutes / spanMin * 100)) : 0, utilisationCommercial: split.utilisationCommercial, totalDays: split.totalDays, employedDays: split.employedDays, availableDays: split.availableDays, technicalOffDays: split.technicalOffDays, commercialOffDays: split.commercialOffDays, downtime: oh.downtime,
        currency: fin.currency, income: fin.income, expenses: fin.expenses, result: fin.result, receivablesOpen: fin.open, overdue: fin.overdue, payablesOpen: fin.payablesOpen, documents: (fin.docs || []).length, openDocs, byCategory: fin.byCategory, months_: fin.months,
        claims: claims.length, claimsOpen, lastPosition: pos && pos.lat != null ? { lat: pos.lat, lon: pos.lon, ts: pos.ts || null, dest: pos.dest || "", source: pos.source || "" } : null,
        exit: ex ? { at: String(ex.at || psv.offboarded || "").slice(0, 10), reason: ex.reason || "other", reasonName: exitReasonName(ex.reason), reasonText: ex.reasonText || "", handedTo: ex.handedTo || "", note: ex.note || "", by: ex.by || "", recordedAt: ex.recordedAt || null } : null };
    });
  }

  // ---------- 4.19 · what is due to the owners, per vessel and for a selection, in two buckets (PROSHIP.md §25.1)
  // ownersStatement(ps, store, vesselIds, range, { bucket: "freight" | "others" | "all", E }) — E.ownersAccount does the reading
  const ENGINE = () => { if (typeof XyntaxEngine !== "undefined") return XyntaxEngine; try { return typeof require === "function" ? require("./engine.js") : null; } catch (e) { return null; } };
  function ownersStatement(ps, store, vesselIds, range, opt) {
    opt = opt || {}; ps = ps || {}; store = store || {}; const E = opt.E || ENGINE(); if (!E || !E.ownersAccount) throw new Error("The book engine is not loaded");
    const ids = vesselIds || (ps.vessels || []).map((v) => v.id); const bucket = opt.bucket || "all"; const today = opt.today || isoDate(Date.now());
    const pres = presCcy(ps, opt); const key = "os|" + storeSig(store) + "|" + psSig(ps) + "|" + idsKey(ids) + "|" + rangeKey(range) + "|" + bucket + "|" + today + "|" + pres;
    return memo(key, () => {
      const ix = index(store); const px = psIndex(ps); const perVessel = new Map(); const rows = []; const monthsMap = {}; const byKind = { gross: {}, deductions: {} }; const totals = { gross: 0, deductions: 0, fees: 0, net: 0, remitted: 0, balance: 0 }; const currencies = new Set(); const bookCurrencies = new Set(); let unconverted = false;
      // 4.21.2 · each owner's account is kept in the entity's book currency and shown here in the presentation currency at the closing rate (the end of the range, else today)
      const rateDate = (range && range.to) || today;
      const ownerOf = (id) => { const pv = px.vesselById.get(id); if (pv && pv.ownerCpId) return pv.ownerCpId; const c = (store.counterparties || []).find((x) => (x.vesselIds || []).includes(id) && x.role === "owner") || (store.counterparties || []).find((x) => (x.vesselIds || []).includes(id)); return c ? c.id : null; };
      for (const id of ids) { if (!ix.vesselById.get(id)) continue; let a0; try { a0 = E.ownersAccount(store, id, range || {}); } catch (e) { continue; }
        const bookCcy = a0.currency; bookCurrencies.add(bookCcy); const ent = ix.entityById.get(a0.entityId || (px.vesselById.get(id) || {}).managerEntityId || (ix.vesselById.get(id) || {}).entityId) || null;
        let k = presRate(store, { currency: bookCcy, groupFx: ent ? ent.groupFx : 0 }, pres, rateDate); if (k == null) { unconverted = true; k = 1; }
        const sc = (n) => r2((+n || 0) * k); const scK = (o) => { const out = {}; for (const [kk, vv] of Object.entries(o || {})) out[kk] = typeof vv === "number" ? sc(vv) : vv; return out; };
        const a = k === 1 ? a0 : { ...a0, currency: pres, lines: a0.lines.map((l) => ({ ...l, amount: sc(l.amount), bookAmount: l.amount, bookCurrency: bookCcy })), gross: scK(a0.gross), deductions: scK(a0.deductions), buckets: Object.fromEntries(Object.entries(a0.buckets || {}).map(([kk, vv]) => [kk, scK(vv)])), fees: sc(a0.fees), net: sc(a0.net), remitted: sc(a0.remitted), balance: sc(a0.balance), months: Array.isArray(a0.months) ? a0.months.map(scK) : a0.months };
        const lines = bucket === "all" ? a.lines : a.lines.filter((l) => l.bucket === bucket); const b = bucket === "all" ? { gross: a.gross.total, deductions: a.deductions.total, net: a.net } : a.buckets[bucket];
        const fees = bucket === "all" || bucket === "others" ? a.fees : 0; const remitted = bucket === "all" ? a.remitted : 0; const balance = bucket === "all" ? a.balance : b.net;
        const v = { ...a, lines, gross: { ...a.gross, total: b.gross }, deductions: { ...a.deductions, total: b.deductions }, fees, net: b.net, remitted, balance, remittedAll: a.remitted, balanceAll: a.balance, bucket, currency: pres, bookCurrency: bookCcy, rate: k, rateDate };
        perVessel.set(id, v); currencies.add(pres);
        const name = (px.vesselById.get(id) || ix.vesselById.get(id) || {}).name || id;
        rows.push({ vesselId: id, name, ownerCpId: ownerOf(id), model: a.model, currency: pres, bookCurrency: bookCcy, rate: k, gross: b.gross, deductions: b.deductions, fees, net: b.net, remitted, balance, lines: lines.length });
        totals.gross = r2(totals.gross + b.gross); totals.deductions = r2(totals.deductions + b.deductions); totals.net = r2(totals.net + b.net); totals.remitted = r2(totals.remitted + remitted); totals.balance = r2(totals.balance + balance); totals.fees = r2(totals.fees + fees);
        for (const l of lines) { if (l.bucket === "remit") continue; if (l.amount > 0) byKind.gross[l.kind] = r2((byKind.gross[l.kind] || 0) + l.amount); else byKind.deductions[l.kind] = r2((byKind.deductions[l.kind] || 0) - l.amount); const m = String(l.date || "").slice(0, 7); const row = monthsMap[m] || (monthsMap[m] = { month: m, gross: 0, deductions: 0, net: 0, remitted: 0, balance: 0 }); if (l.amount > 0) row.gross = r2(row.gross + l.amount); else row.deductions = r2(row.deductions - l.amount); }
        if (bucket === "all") for (const l of a.lines) if (l.bucket === "remit") { const m = String(l.date || "").slice(0, 7); const row = monthsMap[m] || (monthsMap[m] = { month: m, gross: 0, deductions: 0, net: 0, remitted: 0, balance: 0 }); row.remitted = r2(row.remitted - l.amount); } }
      const months = Object.values(monthsMap).sort((a, b) => (a.month < b.month ? -1 : 1)); let run = 0; for (const m of months) { m.net = r2(m.gross - m.deductions); run = r2(run + m.net - m.remitted); m.balance = run; }
      rows.sort((a, b) => b.balance - a.balance);
      return { currency: pres, bookCurrencies: [...bookCurrencies].sort(), converted: [...bookCurrencies].some((c) => c !== pres), unconverted, rateDate, mixed: false, bucket, perVessel, rows, totals, months, byKind };
    });
  }

  // ---------- 4.31.14 · the owners' Statement of accounts (src/owner-statement.js computes it; this builds the rows from the book)
  // ownerStatementRows(ps, store, vesselId, { now, currency }) → every movement of the vessel that the statement needs, whole history,
  // converted from the managing entity's book currency into the presentation currency at today's closing rate (one rate per vessel,
  // so the portal — which receives these rows — and the desktop agree to the cent). Desktop and portal both run OwnerStatement.compute.
  const OS = () => { if (typeof OwnerStatement !== "undefined") return OwnerStatement; try { return typeof require === "function" ? require("./owner-statement.js") : null; } catch (e) { return null; } };
  const OS_MGR_CATS = ["Bank charges", "Management fee", "Office", "Salaries"];
  const OS_REMIT = /owner.?s? remit|remit(tance)? to owners|to owners|owners.? share|net to owners/i;
  const osKind = (desc, meta) => { const d = String(desc || ""); if (/off-?hire/i.test(d)) return "offhire"; const k = revKind(d); if (k === "commissions") return "commissions"; if (k === "management_fee") return "management_fee"; if (k !== "other") return k; if (/claim/i.test(d)) return "claims"; const mk = meta && meta.kind; if (mk === "claim") return "demurrage"; if (["freight", "hire", "demurrage", "awrp", "interim", "heating", "extras", "despatch", "management_fee"].includes(mk)) return mk; return "other"; };
  function ownerStatementRows(ps, store, vesselId, opt) {
    opt = opt || {}; ps = ps || {}; store = store || {}; const now = opt.now || nowIso(); const today = String(now).slice(0, 10);
    const ix = index(store), px = psIndex(ps); const sv = ix.vesselById.get(vesselId) || {}; const pv = px.vesselById.get(vesselId) || {};
    const model = sv.accounting === "agency" ? "agency" : "principal"; const cps = (id) => ((ix.cpById.get(id) || {}).name || "");
    const entId = sv.entityId || (() => { const last = [...(ix.invoicesByVessel.get(vesselId) || []), ...(ix.billsByVessel.get(vesselId) || [])].filter((d) => d.entityId).sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")))[0]; return last ? last.entityId : null; })();
    const ent = ix.entityById.get(entId) || null; const bookCcy = String((ent && ent.currency) || (store.meta && store.meta.reportingCurrency) || "USD").toUpperCase(); const pres = presCcy(ps, opt);
    let k = presRate(store, { currency: bookCcy, groupFx: ent ? ent.groupFx : 0 }, pres, today); let unconverted = false; if (k == null) { k = presRate(store, { currency: bookCcy, groupFx: ent ? ent.groupFx : 0 }, pres, null); if (k == null) { unconverted = true; k = 1; } }
    const P = (n) => r2((+n || 0) * k); const fxd = (d) => (+d.fx > 0 ? +d.fx : 1); const mgr = new Set(((store.settings && Array.isArray(store.settings.managerCostCategories)) ? store.settings.managerCostCategories : OS_MGR_CATS).map((c) => String(c).toLowerCase()));
    const voyages = {}, fixtures = {}; const rows = [];
    for (const vy of px.voyagesByVessel.get(vesselId) || []) { const ports = (vy.ports || []).map((p) => p.name).filter(Boolean); voyages[vy.id] = { no: vy.no != null ? String(vy.no) : "", label: "Voyage " + (vy.no != null ? vy.no : "") + (ports.length ? " · " + ports[0] + (ports.length > 1 ? " → " + ports[ports.length - 1] : "") : ""), open: vy.status !== "completed", fx: vy.fixtureId || null }; }
    for (const f of (ps.fixtures || []).filter((x) => x && x.vesselId === vesselId && x.status !== "cancelled")) fixtures[f.id] = { label: fxLabel(f) + (f.chartererCpId ? " · " + cps(f.chartererCpId) : "") + (delAt(f) ? " · from " + fmtDate(delAt(f)) : ""), cp: cps(f.chartererCpId), open: !redelActual(f) };
    // hire period numbers, by invoice reference, from the hire statements of each time charter
    const hireNo = {}; for (const f of (ps.fixtures || []).filter((x) => x && x.vesselId === vesselId && (x.kind === "tc" || x.kind === "bareboat"))) { try { for (const h of hireStatements(ps, store, f, { now })) if (h.invoiceRef) hireNo[h.invoiceRef] = h.no; } catch (e) { /* the statement never fails on a hire period */ } }
    const daPort = {}; for (const da of px.dasByVessel.get(vesselId) || []) for (const kk of ["billId", "advanceBillId", "finalBillId", "pdaBillId", "fdaBillId"]) if (da[kk]) daPort[da[kk]] = da.port || "";
    const vyOf = (d) => ix.docVoyage(d) || d.voyageId || null; const fxOf = (d) => d.fixtureId || (d.meta && d.meta.fixtureId) || ((tradeOf(store, d.tradeId) || {}).fixtureId) || (vyOf(d) && voyages[vyOf(d)] ? voyages[vyOf(d)].fx : null) || null;
    const invMap = new Map();
    for (const inv of ix.invoicesByVessel.get(vesselId) || []) {
      if (inv.void || inv.voided || inv.pending) continue; const t = tradeOf(store, inv.tradeId); const meta = inv.meta || (t && t.meta) || {}; const f0 = fxd(inv); const vy = vyOf(inv), fx = fxOf(inv);
      const parts = []; let s = 0; for (const l of (inv.lines || (t && t.lines) || [])) { const a = r2(l.amount != null && l.qty == null ? +l.amount : (+l.qty || 0) * (+l.price || 0)); if (!a) continue; parts.push([osKind(l.description, meta), a]); s += a; }
      const net = +inv.net || +inv.amount || 0; if (!parts.length) parts.push([meta.kind === "freight" ? "freight" : meta.kind === "hire" ? "hire" : meta.kind === "claim" ? "demurrage" : "other", net]); const sc = parts.length && Math.abs(s) > 0.005 ? net / s : 1;
      const byK = {}; for (const [kk, a] of parts) byK[kk] = (byK[kk] || 0) + a * sc;
      const main = Object.entries(byK).filter(([kk]) => GROSS_K.has(kk)).sort((a, b) => b[1] - a[1])[0]; const mk = main ? main[0] : "other";
      const what = meta.period ? "Hire" + (hireNo[inv.ref] ? " period " + hireNo[inv.ref] : "") + " · " + fmtDate(meta.period.from) + " – " + fmtDate(String(meta.period.to || "").slice(0, 10)) : (meta.kind === "claim" ? "Claim / demurrage" : (OS_LABEL[mk] || "Other"));
      const amtP = P(+inv.amount * f0); let incSum = 0;
      for (const [kk, a] of Object.entries(byK)) { const v = P(a * f0); if (!v) continue; if (kk === "management_fee" || (kk === "commissions" && v > 0)) { rows.push({ t: "e", id: "fee:" + inv.id + ":" + kk, d: inv.date, ref: inv.ref, cp: (ent && ent.name) || "Commercial manager", vy, fx, k: kk === "management_fee" ? "Management fee" : "Commissions kept", memo: "on " + inv.ref + " · " + what, a: v, p: [], bank: true, fee: true, doc: "invoice:" + inv.id }); incSum += v; continue; } rows.push({ t: "n", d: inv.date, ref: inv.ref, cp: cps(inv.counterpartyId), vy, fx, k: kk === "commissions" ? "commission" : kk, a: v }); incSum += v; }
      const row = { t: "i", id: inv.id, d: inv.date, due: inv.due || "", ref: inv.ref, cp: cps(inv.counterpartyId), vy, fx, k: what, a: amtP, v: r2(amtP - incSum), p: [], c: [] }; rows.push(row); invMap.set(inv.id, { row, inv, what });
      for (const cn of ix.creditNotesByInvoice.get(inv.id) || []) { const v = P(+cn.amount * fxd(cn.fx ? cn : inv)); row.c.push([cn.date, v]); rows.push({ t: "n", d: cn.date, ref: cn.ref, cp: cps(inv.counterpartyId), vy, fx, k: "credit", a: -P(+(cn.net != null ? cn.net : cn.amount) * fxd(cn.fx ? cn : inv)) }); row.v = r2(row.v - (v - P(+(cn.net != null ? cn.net : cn.amount) * fxd(cn.fx ? cn : inv)))); }
    }
    // receipts: cash against an invoice, cash held on account (and its later applications), other money received on the vessel
    const seen = new Set(); const pays = [...(ix.paymentsByVessel.get(vesselId) || [])]; for (const { inv } of invMap.values()) for (const p of ix.paymentsByInvoice.get(inv.id) || []) if (!pays.includes(p)) pays.push(p);
    for (const p of pays) { if (seen.has(p.id) || p.reversed) continue; seen.add(p.id);
      if (p.kind === "in" && p.invoiceId && invMap.has(p.invoiceId)) { const m = invMap.get(p.invoiceId); const v = P(+p.amount * fxd(m.inv)); m.row.p.push([p.date, v]); if (p.appliedFrom) continue; rows.push({ t: "r", id: p.id, d: p.date, ref: p.reference || "Receipt", cp: cps(p.counterpartyId || m.inv.counterpartyId), vy: p.voyageId || m.row.vy, fx: p.fixtureId || m.row.fx, a: v, inv: m.inv.ref, k: m.what, oa: false }); }
      else if (p.kind === "in" && p.onAccount && (p.vesselId === vesselId)) { const apps = (store.payments || []).filter((q) => q.appliedFrom === p.id && !q.reversed).map((q) => { const inv = ix.invoiceById.get(q.invoiceId); return [q.date, P(+q.amount * (inv ? fxd(inv) : (+p.fx || 1))), inv ? inv.ref : ""]; }); rows.push({ t: "r", id: p.id, d: p.date, ref: p.reference || "Receipt", cp: cps(p.counterpartyId), vy: p.voyageId || null, fx: p.fixtureId || (p.voyageId && voyages[p.voyageId] ? voyages[p.voyageId].fx : null), a: P(+p.amount * (+p.fx || 1)), inv: null, k: "On account" + (p.voyageId && voyages[p.voyageId] ? " · " + voyages[p.voyageId].label : p.fixtureId && fixtures[p.fixtureId] ? " · " + fixtures[p.fixtureId].label : ""), oa: true, ap: apps }); }
      else if (p.kind === "remit" && p.vesselId === vesselId) { const bk = ix.bankById.get(p.bankId) || {}; rows.push({ t: "m", id: p.id, d: p.date, ref: p.reference || "Remittance", memo: p.memo || "Remittance to owners", cp: cps(p.counterpartyId), a: P(+p.amount * (+bk.fx || 1)) }); } }
    // expenses for the owners' account: bills (accrued or paid) and bank lines on the vessel; a remittance by bank line is a payout
    const agency = model === "agency"; const mine = (cat) => agency && mgr.has(String(cat || "").toLowerCase());
    for (const b of ix.billsByVessel.get(vesselId) || []) { if (b.void || b.voided || b.pending) continue; const cat = (b.allocation && b.allocation.category) || b.category || ""; if (mine(cat)) continue; const orig = b.share ? ix.billById.get(b.shareOf) : b; const share = b.share && orig && +orig.amount ? +b.amount / +orig.amount : 1; const f0 = fxd(orig || b);
      const p = (ix.paymentsByBill.get(orig ? orig.id : b.id) || []).filter((q) => !q.reversed).map((q) => [q.date, P(+q.amount * share * f0)]);
      rows.push({ t: "e", id: "bill:" + b.id + (b.share ? ":" + vyOf(b) : ""), d: b.date, ref: b.ref, cp: cps(b.counterpartyId) || b.payee || "", vy: b.share ? (b.voyageId || null) : vyOf(b), fx: b.share ? (b.fixtureId || null) : fxOf(b), k: cat || OS_COST[costKind([b.category, b.memo, b.payee].filter(Boolean).join(" "))] || "Expense", memo: b.memo || "", port: daPort[orig ? orig.id : b.id] || b.port || "", a: P(+b.amount * f0), p, doc: "bill:" + (orig ? orig.id : b.id) }); }
    for (const t of ix.bankTxByVessel.get(vesselId) || []) { if (t.reversed) continue; const bk = ix.bankById.get(t.bankId) || {}; const v = P(+t.amount * (+bk.fx || 1)); const cat = (t.allocation && t.allocation.category) || t.category || ""; const id = t.share ? t.shareOf + ":" + (t.voyageId || "") : t.id;
      if (t.kind === "in") { rows.push({ t: "r", id: "tx:" + id, d: t.date, ref: t.reference || "Bank", cp: cps(t.counterpartyId) || t.payee || "", vy: t.voyageId || null, fx: t.fixtureId || null, a: v, inv: null, k: cat || t.memo || "Other income", oa: false, bank: true }); rows.push({ t: "n", d: t.date, ref: t.reference || "Bank", cp: cps(t.counterpartyId) || t.payee || "", vy: t.voyageId || null, fx: t.fixtureId || null, k: "other", a: v }); continue; }
      if (OS_REMIT.test([t.category, t.memo, t.payee].filter(Boolean).join(" "))) { rows.push({ t: "m", id: "tx:" + id, d: t.date, ref: t.reference || "Bank", memo: t.memo || t.category || "Remittance to owners", cp: cps(t.counterpartyId) || t.payee || "", a: v }); continue; }
      if (mine(cat)) continue; rows.push({ t: "e", id: "tx:" + id, d: t.date, ref: t.reference || "Bank", cp: cps(t.counterpartyId) || t.payee || "", vy: t.voyageId || null, fx: t.fixtureId || null, k: cat || "Expense", memo: t.memo || "", port: "", a: v, bank: true, doc: "banktx:" + (t.share ? t.shareOf : t.id) }); }
    rows.sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0));
    return { v: 1, vesselId, vessel: pv.name || sv.name || "", owner: cps(pv.ownerCpId) || ((store.counterparties || []).find((c) => (c.vesselIds || []).includes(vesselId) && c.role === "owner") || {}).name || "", manager: (ent && ent.name) || "", model, currency: pres, bookCurrency: bookCcy, rate: k, rateDate: today, unconverted, voyages, fixtures, rows };
  }
  const GROSS_K = new Set(["hire", "freight", "ballastBonus", "deadfreight", "demurrage", "despatch", "awrp", "interim", "heating", "extras", "claims", "other"]);
  const OS_LABEL = { hire: "Hire", freight: "Freight", ballastBonus: "Ballast bonus", deadfreight: "Deadfreight", demurrage: "Demurrage", despatch: "Despatch", awrp: "AWRP", interim: "Interim port", heating: "Heating", extras: "Charterers' extras", claims: "Claim", other: "Other" };
  const OS_COST = { bunkers: "Bunkers", portDa: "Port costs", canal: "Canal dues", agency: "Agency", commissions: "Commissions", insurance: "Insurance", claims: "Claims", other: "Other expenses" };
  // ownerStatement(ps, store, { vesselIds, from, to, voyageId, fixtureId, cpId, now }) → the seven parts (OwnerStatement.compute) for the
  // vessels picked, plus a check of the owners' account against the ledger (Due to owners) for agency vessels
  function ownerStatement(ps, store, opt) {
    opt = opt || {}; ps = ps || {}; store = store || {}; const S = OS(); if (!S) throw new Error("owner-statement.js is not loaded"); const now = opt.now || nowIso();
    const ids = opt.vesselIds && opt.vesselIds.length ? opt.vesselIds : (ps.vessels || []).map((v) => v.id); const stmts = ids.map((id) => ownerStatementRows(ps, store, id, { now, currency: opt.currency }));
    const cp = opt.cp || (opt.cpId ? ((index(store).cpById.get(opt.cpId) || {}).name || opt.cpId) : null);
    const res = S.compute(stmts, { vesselIds: ids, from: opt.from || null, to: opt.to || null, voyageId: opt.voyageId || null, fixtureId: opt.fixtureId || null, cp, now });
    // the ledger check (agency vessels, whole vessel, to the period end): Due to owners per the journals = the owners' account the statement shows
    try { const E = opt.E || ENGINE(); if (E && E.ownersAccount && !opt.voyageId && !opt.fixtureId && !cp) { let ledger = 0, mine = 0, n = 0; for (const s of stmts) { if (s.model !== "agency") continue; n++; const a = E.ownersAccount(store, s.vesselId, { to: res.asOf }); ledger = r2(ledger + r2(a.balance * s.rate)); const one = S.compute([s], { now, to: res.asOf }); mine = r2(mine + one.reconciliation.ownersAccount); } if (n) res.ledgerCheck = { vessels: n, ledger, statement: mine, difference: r2(mine - ledger), matches: Math.abs(mine - ledger) < 0.05 }; } } catch (e) { /* the check is a convenience */ }
    res.statements = stmts; return res;
  }

  // ---------- report models: { title, subtitle, meta: [[k, v]], sections: [{ heading, text | table: { cols, rows, totals } | kv }] }
  function report(kind, ctx) {
    ctx = ctx || {}; const ps = ctx.ps || {}, store = ctx.store || {}; const vname = ctx.vesselName || ""; const nm = (id) => ctx.cpName ? ctx.cpName(id) : id || "";
    const money = (n, c) => fmtMoney(n, c);
    // 4.31.11 · the two rates and the day breakdown, worded the same everywhere a report shows utilisation
    const pctS = (n) => (n == null ? "—" : n + " %"); const dd = (d) => fmtDays(Math.round((+d || 0) * DAYM)) + " d";
    const utilTotalText = (p) => p.utilisation + " % · employed " + dd(p.employedDays != null ? p.employedDays : p.onHireDays) + " of " + dd(p.totalDays) + " under management";
    const utilCommText = (p) => pctS(p.utilisationCommercial) + " · employed " + dd(p.employedDays != null ? p.employedDays : p.onHireDays) + " of " + dd(p.availableDays) + " available (technical off-hire " + dd(p.technicalOffDays) + ", commercial off-hire " + dd(p.commercialOffDays) + ")";
    const kindCell = (d) => offhireKindName(d.kind || offhireKind(d)) + (d.kindInferred ? " (inferred)" : "");
    if (kind === "hire") {
      const f = ctx.fixture; const h = ctx.hire || hire(f, offhiresOf(ps, f), ctx.from, ctx.to, { vesselName: vname }); const c = h.currency;
      return { kind, title: "Hire statement", subtitle: MV(vname) + " · " + fmtAt(h.from) + " – " + fmtEnd(h.to) + " UTC", currency: c, meta: [["Charterers", nm(f.chartererCpId)], ["Charter party", (f.cpForm || "") + (f.cpDate ? " dated " + fmtDate(f.cpDate) : "")], ["Delivery", fmtAt(delAt(f)) + (f.delivery && f.delivery.port ? " " + f.delivery.port : "")], ["Hire rate", money(h.rate, c) + " per day"], ["Days this period", fmtDays(h.minutes)], ["Hire interval", (f.hireInterval || 15) + " days " + (f.hireInAdvance === false ? "in arrears" : "in advance")]],
        sections: [{ heading: "Statement", table: { cols: ["Description", "Days / qty", "Rate", "Amount " + c], rows: h.lines.map((l) => [l.description, (l.unit === "day" || l.unit === "month" ? (Math.abs(l.qty) * (l.unit === "month" ? 30 : 1)).toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 4 }) + (l.unit === "month" ? " d" : "") : l.unit === "each" || l.unit === "lumpsum" ? "" : fmtQty(Math.abs(l.qty)) + " " + l.unit), l.unit === "each" || l.unit === "lumpsum" ? "" : money(l.price), money(l.amount)]), totals: [["Net hire", money(h.hireNet)], h.addressCommission ? ["Address commission", "-" + money(h.addressCommission)] : null, ["Amount due", money(h.net, c)]].filter(Boolean) } }, ...(h.offhire.length ? [{ heading: "Off-hire", table: { cols: ["From", "To", "Days", "Reason", "Amount " + c], rows: h.offhire.map((o) => [fmtAt(o.from), fmtEnd(o.to), fmtDays(o.minutes), o.reason, "-" + money(o.amount)]) } }] : []), { heading: "Brokerage", text: h.brokeragePct ? "Brokerage " + h.brokeragePct + "% (" + money(h.brokerage, c) + ") is " + (h.brokerageDeducted ? "deducted above" : "for owners' account and not deducted") + "." : "No brokerage on this charter." }] };
    }
    if (kind === "soa") {
      const s = ctx.soa || soa(ps, store, ctx.id, ctx.range); const c = s.currency;
      return { kind, title: "Statement of account", subtitle: (s.isVessel ? MV(vname) : nm(ctx.id)) + (ctx.range && ctx.range.from ? " · " + fmtDate(ctx.range.from) + " – " + fmtDate(ctx.range.to || isoDate(Date.now())) : ""), currency: c, meta: [["Opening balance", money(s.opening, c)], ["Closing balance", money(s.closing, c)], ["Open now", money(s.open, c)], ["Of which overdue", money(s.overdue, c)]],
        sections: [{ heading: "Movements", table: { cols: ["Date", "Reference", "Type", "Detail", "Due", "Debit", "Credit", "Balance"], rows: s.items.map((i) => [i.date, i.ref, i.type, i.detail, i.due || "", i.debit ? money(i.debit) : "", i.credit ? money(i.credit) : "", money(i.balance)]) } }, { heading: "Payment", text: "Please settle the open balance of " + money(s.open, c) + " by bank transfer; invoices older than their due date carry the charter party's interest terms where agreed." }] };
    }
    if (kind === "performance") {
      const p = ctx.performance || performance(ps, store, ctx.vesselId, ctx.range, { now: ctx.now }); const c = p.currency;
      return { kind, title: "Performance report", subtitle: MV(vname) + (ctx.range && ctx.range.from ? " · " + fmtDate(ctx.range.from) + " – " + fmtDate(ctx.range.to || isoDate(Date.now())) : ""), currency: c, meta: [["Employment", p.fixture ? fxLabel(p.fixture) + " to " + nm(p.fixture.chartererCpId) : "Unfixed"], ["Fixed rate", p.fixture ? money(p.fixedRate, p.fixture.currency) + (p.fixture.kind === "tc" ? "/day" : "") : "—"], ["Market at fixing", p.marketRateAtFixing != null ? money(p.marketRateAtFixing, p.rateCurrency) + (p.marketSource ? " (" + p.marketSource + ")" : "") : "no market rate recorded"], ["Against market", p.deltaPct != null ? (p.deltaPct >= 0 ? "+" : "") + p.deltaPct + "%" : "—"], ["TCE" + (p.tceEstimated ? " (est.)" : ""), money(p.tce, c) + "/day" + (p.tceEstimated ? " est." : "")], ["Utilisation, total", utilTotalText(p)], ["Utilisation, commercial", utilCommText(p)], ["On / off hire", fmtDays(Math.round(p.onHireDays * DAYM)) + " d · " + fmtDays(Math.round(p.offHireDays * DAYM)) + " d"]],
        sections: [{ heading: "Financial", kv: [["Earnings", money(p.earnings, c)], ["Costs", money(p.costs, c)], ["Result", money(p.result, c)], ["Receivables open", money(p.finance.open, c)], ["Overdue", money(p.finance.overdue, c)]] }, { heading: "Rate against the market, by month", table: { cols: ["Month", "Fixed", "Market", "Difference"], rows: p.vsMarket.map((r) => [r.month, r.fixed != null ? money(r.fixed) : "—", r.market != null ? money(r.market) : "—", r.fixed != null && r.market != null ? money(r2(r.fixed - r.market)) : ""]) } }, { heading: "Downtime", table: p.downtime.length ? { cols: ["From", "To", "Days", "Kind", "Reason", "Deductible"], rows: p.downtime.map((d) => [fmtAt(d.from), fmtEnd(d.to), fmtDays(d.minutes), kindCell(d), d.reason, d.deductible ? "yes" : "no"]) } : null, text: p.downtime.length ? null : "No off-hire in the period." }, { heading: "Utilisation", text: "Total utilisation counts every day she was not earning against her, whatever the reason: employed " + dd(p.employedDays) + " of " + dd(p.totalDays) + " under management = " + p.utilisation + " %. Commercial utilisation measures the commercial manager alone: the days she was available (under management less technical off-hire — dry dock, repairs, breakdown, survey, crew, guarantee works, detention) against the days she was employed: " + dd(p.employedDays) + " of " + dd(p.availableDays) + " = " + pctS(p.utilisationCommercial) + ". Technical off-hire " + dd(p.technicalOffDays) + " · commercial off-hire (waiting, idle, positioning, unfixed days) " + dd(p.commercialOffDays) + "." }, { heading: "Costs by category", table: { cols: ["Category", "Amount " + c], rows: Object.entries(p.finance.byCategory).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, money(v)]) } }] };
    }
    if (kind === "tenure") {
      const t = ctx.tenure || tenure(ps, store, ctx.vesselId, { from: ctx.from, to: ctx.to, now: ctx.now }); const c = t.currency; const ex = t.exit;
      return { kind, title: t.open ? "Management statement" : "Management closing statement", subtitle: MV(vname || t.name) + " · under management " + (t.from ? fmtDate(t.from) : "—") + " – " + (t.to ? fmtDate(t.to) : "to date"), currency: c,
        meta: [["Entered management", t.from ? fmtDate(t.from) : "—"], ["Exited", t.to ? fmtDate(t.to) + (ex && ex.reasonName ? " · " + ex.reasonName + (ex.reasonText ? " (" + ex.reasonText + ")" : "") : "") : "still under management"], ex && ex.handedTo ? ["Handed over to", ex.handedTo] : null, ["Time under management", (t.days || 0).toLocaleString("en-US", { maximumFractionDigits: 0 }) + " days" + (t.months >= 2 ? " (" + t.months.toLocaleString("en-US", { maximumFractionDigits: 1 }) + " months)" : "")], ["Fixtures", String(t.fixtureCount) + (t.voyages ? " · " + t.voyages + " voyage" + (t.voyages === 1 ? "" : "s") : "")], ["On hire", fmtDays(t.onHireDays * DAYM) + " days · utilisation " + t.utilisation + " % total · " + pctS(t.utilisationCommercial) + " commercial"], ["Available", dd(t.availableDays) + " of " + dd(t.totalDays) + " · technical off-hire " + dd(t.technicalOffDays) + " · commercial off-hire " + dd(t.commercialOffDays)], ["Result", money(t.result, c)]].filter(Boolean),
        sections: [{ heading: "Employment", table: { cols: ["Kind", "Charterer", "Rate", "From", "To", "Status"], rows: t.fixtures.map((f) => [f.label, nm(f.chartererCpId), f.rateText || money(f.rate, f.currency) + (f.rateUnit === "mt" ? "/MT" : f.rateUnit === "lumpsum" ? " lumpsum" : "/day"), fmtAt(f.from), f.to ? fmtEnd(f.to) + (f.estimated ? " (est.)" : "") : "open", f.status]) } },
          { heading: "Financial", kv: [["Income", money(t.income, c)], ["Expenses", money(t.expenses, c)], ["Result", money(t.result, c)], ["Receivables open", money(t.receivablesOpen, c) + (t.overdue ? " · overdue " + money(t.overdue) : "")], ["Payables open", money(t.payablesOpen, c)], ["Documents", String(t.documents)]] },
          Object.keys(t.byCategory || {}).length ? { heading: "Expenses by category", table: { cols: ["Category", "Amount " + c], rows: Object.entries(t.byCategory).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, money(v)]) } } : null,
          { heading: t.open ? "Open items" : "Open at exit", table: t.openDocs.length ? { cols: ["Date", "Ref", "Kind", "Counterparty", "Amount", "Open", "Status"], rows: t.openDocs.map((d) => [d.date, d.ref, d.kind, nm(d.cpId), money(d.amount, d.currency), money(d.open, d.currency), d.status]) } : null, text: t.openDocs.length ? null : "Nothing open — every invoice and bill of the tenure is settled." },
          t.downtime && t.downtime.length ? { heading: "Downtime", table: { cols: ["From", "To", "Days", "Kind", "Reason", "Deductible"], rows: t.downtime.map((d) => [fmtAt(d.from), fmtEnd(d.to), fmtDays(d.minutes), kindCell(d), d.reason || "", d.deductible === false ? "no" : "yes"]) } } : null,
          ex && ex.note ? { heading: "Handover note", text: ex.note } : null].filter(Boolean) };
    }
    if (kind === "financial") {
      const fin = ctx.finance || vesselFinance(ps, store, ctx.vesselId, ctx.range); const c = fin.currency;
      return { kind, title: "Financial analysis", subtitle: MV(vname) + (ctx.range && ctx.range.from ? " · " + fmtDate(ctx.range.from) + " – " + fmtDate(ctx.range.to || isoDate(Date.now())) : ""), currency: c, meta: [["Income", money(fin.income, c)], ["Expenses", money(fin.expenses, c)], ["Result", money(fin.result, c)], ["Receivables open", money(fin.open, c) + (fin.overdue ? " · overdue " + money(fin.overdue) : "")], ["Payables open", money(fin.payablesOpen, c)]],
        sections: [{ heading: "Month by month", table: { cols: ["Month", "Income", "Expenses", "Result"], rows: fin.months.map((m) => [m.month, money(m.income), money(m.expenses), money(m.result)]) } }, { heading: "Expenses by category", table: { cols: ["Category", "Amount " + c], rows: Object.entries(fin.byCategory).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, money(v)]) } }, { heading: "Documents", table: { cols: ["Date", "Ref", "Kind", "Counterparty", "Amount", "Open", "Status"], rows: fin.docs.map((d) => [d.date, d.ref, d.kind, nm(d.cpId), money(d.amount, d.currency), money(d.open, d.currency), d.status]) } }] };
    }
    if (kind === "voyage") {
      const est = ctx.estimate || voyageEstimate(ctx.voyage, ctx.vessel, ctx.fixture); const c = est.currency;
      return { kind, title: "Voyage result", subtitle: MV(vname) + (ctx.voyage && ctx.voyage.no ? " · voyage " + ctx.voyage.no : ""), currency: c, meta: [["Sea days", fmtDays(Math.round(est.seaDays * DAYM))], ["Port days", fmtDays(Math.round(est.portDays * DAYM))], ["Revenue", money(est.revenue, c)], ["Commissions", money(est.commissions, c)], ["Voyage costs", money(est.costs, c)], ["Result", money(est.result, c)], ["TCE", money(est.tce, c) + "/day"], est.breakEvenFreight != null ? ["Break-even freight", money(est.breakEvenFreight, c) + "/MT"] : null].filter(Boolean),
        sections: [{ heading: "Legs", table: { cols: ["From", "To", "Laden", "Distance nm", "Speed", "Days", "Bunkers MT"], rows: est.legs.map((l) => [l.from, l.to, l.laden ? "laden" : "ballast", fmtQty(l.distanceNm), l.speed, l.days.toFixed(2), fmtQty(l.bunkers)]) } }, { heading: "Ports", table: { cols: ["Port", "Activity", "Days", "DA " + c, "Bunkers MT"], rows: est.ports.map((p) => [p.name, p.activity, p.days.toFixed(2), money(p.da), fmtQty(p.bunkers)]) } }, { heading: "Bunkers", table: { cols: ["Grade", "MT", "Price", "Cost " + c], rows: est.bunkers.map((b) => [b.grade, fmtQty(b.qty), money(b.price), money(b.cost)]) } }, { heading: "Other costs", table: { cols: ["Kind", "Label", "Amount " + c], rows: est.costRows.map((x) => [x.kind, x.label, money(x.amount)]) } }] };
    }
    // 4.13 · fleet reports for a selection of vessels
    const vn = (id) => (ctx.vesselName2 ? ctx.vesselName2(id) : ((ps.vessels || []).find((v) => v.id === id) || (store.vessels || []).find((v) => v.id === id) || {}).name || id);
    const span = ctx.range && ctx.range.from ? " · " + fmtDate(ctx.range.from) + " – " + fmtDate(ctx.range.to || isoDate(Date.now())) : "";
    if (kind === "fleetEarnings") {
      const ff = ctx.fleet || fleetFinance(ps, store, ctx.vesselIds, ctx.range); const c = ff.currency; const rows = ff.vesselIds.map((id) => [id, ff.perVessel.get(id)]).sort((a, b) => b[1].result - a[1].result);
      return { kind, title: "Earnings by vessel", subtitle: (ctx.selectionName || ff.vesselIds.length + " vessels") + span, currency: c, meta: [["Vessels", String(ff.totals.vessels)], ["Income", money(ff.totals.income, c)], ["Expenses", money(ff.totals.expenses, c)], ["Result", money(ff.totals.result, c)], ["Receivables open", money(ff.totals.open, c)], ["Overdue", money(ff.totals.overdue, c)]],
        sections: [{ heading: "Vessels", table: { cols: ["Vessel", "Income", "Expenses", "Result", "Open", "Overdue"], rows: rows.map(([id, f]) => [vn(id), money(f.income), money(f.expenses), money(f.result), money(f.open), money(f.overdue)]), totals: ["Total", money(ff.totals.income), money(ff.totals.expenses), money(ff.totals.result), money(ff.totals.open), money(ff.totals.overdue)] } }, { heading: "Month by month", table: { cols: ["Month", "Income", "Expenses", "Result"], rows: ff.months.map((m) => [m.month, money(m.income), money(m.expenses), money(m.result)]) } }, { heading: "Expenses by category", table: { cols: ["Category", "Amount"], rows: Object.entries(ff.byCategory).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, money(v)]) } }] };
    }
    if (kind === "fleetPerformance") {
      const fp = ctx.fleet || fleetPerformance(ps, store, ctx.vesselIds, ctx.range, { now: ctx.now }); const t = fp.totals; const rows = (fp.byCommercial || fp.rows).slice(); // 4.31.11 · ranked by commercial utilisation
      return { kind, title: "Performance by vessel", subtitle: (ctx.selectionName || fp.rows.length + " vessels") + span + " · ranked by commercial utilisation", currency: fp.currency, meta: [["Vessels", String(t.vessels)], ["Utilisation, total", t.utilisation + " % · employed " + dd(t.employedDays) + " of " + dd(t.totalDays)], ["Utilisation, commercial", pctS(t.utilisationCommercial) + " · of " + dd(t.availableDays) + " available · technical off-hire " + dd(t.technicalOffDays) + " · commercial off-hire " + dd(t.commercialOffDays)], ["On-hire days", fmtDays(Math.round(t.onHireDays * DAYM))], ["Fleet TCE", money(t.tce, fp.currency) + "/day"], ["Above market", String(t.aboveMarket)], ["Below market", String(t.belowMarket)], ["Result", money(t.result, fp.currency)]],
        sections: [{ heading: "Vessels · by commercial utilisation", table: { cols: ["Vessel", "Employment", "Charterer", "Fixed", "Market", "Δ %", "TCE", "Utilisation", "Commercial", "Tech. off d", "On-hire d", "Result"], rows: rows.map((r) => [r.name, r.label || "unfixed", nm(r.chartererCpId), r.fixedRate ? money(r.fixedRate, r.rateCurrency) : "", r.marketRateAtFixing != null ? money(r.marketRateAtFixing) : "", r.deltaPct != null ? (r.deltaPct > 0 ? "+" : "") + r.deltaPct.toFixed(1) : "", money(r.tce), r.utilisation + " %", pctS(r.utilisationCommercial), fmtDays(Math.round((r.technicalOffDays || 0) * DAYM)), fmtDays(Math.round(r.onHireDays * DAYM)), money(r.result)]) } }, { heading: "How the rates are read", text: "Total utilisation = employed days / days under management, every off-hire and unfixed day counted. Commercial utilisation = employed days / available days, where available = days under management less technical off-hire (dry dock, repairs, breakdown, survey, crew, guarantee works, detention) — the measure of the commercial manager's own employment of the vessel. Fleet figures are weighted by days." }] };
    }
    if (kind === "customerSoa") {
      const sel = ctx.vesselIds ? { ...(ctx.range || {}), vesselIds: ctx.vesselIds } : ctx.range; const s2 = soa(ps, store, ctx.id, sel); const c = s2.currency;
      return { kind, title: "Statement of account", subtitle: nm(ctx.id) + (ctx.vesselIds ? " · " + ctx.vesselIds.length + " vessel" + (ctx.vesselIds.length > 1 ? "s" : "") : " · all vessels") + span, currency: c, meta: [["Opening", money(s2.opening, c)], ["Closing", money(s2.closing, c)], ["Open", money(s2.open, c)], ["Overdue", money(s2.overdue, c)]],
        sections: [{ heading: "Movements", table: { cols: ["Date", "Reference", "Type", "Detail", "Due", "Debit", "Credit", "Balance"], rows: s2.items.map((i) => [i.date, i.ref, i.type, i.detail, i.due || "", i.debit ? money(i.debit) : "", i.credit ? money(i.credit) : "", money(i.balance)]) } }] };
    }
    // 4.14 · voyage accounting reports
    if (kind === "voyagePnl") {
      const r = ctx.result || voyageResult(ps, store, ctx.voyageId, { now: ctx.now }); if (!r) throw new Error("Voyage not found"); const c = r.currency; const est = r.estimate; const st = (x) => x.status;
      return { kind, title: "Voyage result", subtitle: MV(vname || r.vessel.name) + " · voyage " + (r.voyage.no || "") + (r.span.from ? " · " + fmtDate(r.span.from) + " – " + (r.span.to ? fmtDate(r.span.to) : "") : "") + (r.fixture ? " · " + fxLabel(r.fixture) + " to " + nm(r.fixture.chartererCpId) : ""), currency: c,
        meta: [["Revenue", money(r.revenue.total, c)], ["Voyage costs", money(r.costs.total, c)], ["Result", money(r.result, c)], ["Voyage days", fmtDays(Math.round(r.voyageDays * DAYM))], ["TCE", money(r.tce, c) + "/day"], ["Against estimate", (r.variance.result >= 0 ? "+" : "") + money(r.variance.result, c)], ["Received / receivable", money(r.cash.received, c) + " / " + money(r.cash.receivable, c)], ["Paid / payable", money(r.cash.paid, c) + " / " + money(r.cash.payable, c)]],
        sections: [
          { heading: "Estimate against actual", table: { cols: ["", "Estimate", "Actual", "Variance"], rows: [["Revenue", money(est.revenue), money(r.revenue.total), money(r.variance.revenue)], ["Commissions", money(-est.commissions), money(r.revenue.commissions), money(r2(r.revenue.commissions + est.commissions))], ["Bunkers", money(-est.bunkerCost), money(-r.costs.bunkers), money(r2(est.bunkerCost - r.costs.bunkers))], ["Port costs", money(-est.portDa), money(-(r.costs.portDa + r.costs.agency)), money(r2(est.portDa - r.costs.portDa - r.costs.agency))], ["Canal and other", money(-est.otherCosts), money(-(r.costs.canal + r.costs.other + r.costs.insurance + r.costs.claims + r.costs.commissions)), money(r2(est.otherCosts - r.costs.canal - r.costs.other - r.costs.insurance - r.costs.claims - r.costs.commissions))], ["Result", money(est.result), money(r.result), money(r.variance.result)], ["Days", est.totalDays.toFixed(2), r.voyageDays.toFixed(2), r.variance.days.toFixed(2)], ["TCE / day", money(est.tce), money(r.tce), money(r.variance.tce)]] } },
          { heading: "Revenue", table: { cols: ["Date", "Reference", "Charterer", "Description", "Amount", "To this voyage", "Open", "Status"], rows: r.lines.filter((l) => l.kind === "invoice" || l.kind === "laytime" || l.kind === "extra" || (l.kind === "banktx" && l.direction === "in")).map((l) => [l.date, l.ref, nm(l.cpId), l.description, money(l.amount, l.currency), money(l.allocated) + (l.share < 1 ? " (" + Math.round(l.share * 100) + "%)" : ""), l.open > 0.005 ? money(l.open, l.currency) : "", st(l)]), totals: ["", "", "", "Revenue", "", money(r.revenue.total), money(r.cash.receivable), ""] } },
          { heading: "Costs", table: { cols: ["Date", "Reference", "Supplier", "Description", "Kind", "Amount", "Open", "Status"], rows: r.lines.filter((l) => l.kind !== "invoice" && !(l.kind === "banktx" && l.direction === "in")).map((l) => [l.date, l.ref, nm(l.cpId), l.description, l.costKind || l.category || "", money(l.amount, l.currency), l.open > 0.005 ? money(l.open, l.currency) : "", st(l)]), totals: ["", "", "", "Voyage costs", "", money(r.costs.total), money(r.cash.payable), ""] } },
          r.bunkers.consumed.length ? { heading: "Bunkers consumed (" + (r.bunkers.recorded ? "recorded, FIFO" : "from the voyage table") + ")", table: { cols: ["Grade", "MT", "Price", "Cost " + c], rows: r.bunkers.consumed.map((b) => [b.grade, fmtQty(b.qty), money(b.price), money(b.cost)]), totals: ["", "", "", money(r.bunkers.cost)] } } : null,
          r.das.length ? { heading: "Disbursement accounts", table: { cols: ["Port", "Agent", "PDA", "FDA", "Variance", "Paid", "Status"], rows: r.das.map((d) => [d.port, nm(d.agentCpId), money(d.pda, d.currency), d.fda != null ? money(d.fda, d.currency) : "", d.variance != null ? money(d.variance) : "", money(d.paid), d.status]) } } : null
        ].filter(Boolean) };
    }
    if (kind === "hireStatements") {
      const f = ctx.fixture; const rows = ctx.statements || hireStatements(ps, store, f, { now: ctx.now, vesselName: vname }); const c = f.currency || "USD";
      return { kind, title: "Hire statements", subtitle: MV(vname) + " · " + fxLabel(f) + " to " + nm(f.chartererCpId) + " · " + (hasRateSteps(f) ? rateText(f) : money(f.rate, c) + "/day"), currency: c, meta: [["Delivery", fmtAt(delAt(f))], ["Redelivery", redelAt(f) ? fmtEnd(redelAt(f)) + (redelActual(f) ? "" : " (est.)") : "—"], ["Periods", String(rows.length)], ["Invoiced", money(sum(rows.filter((r) => r.invoiceId), (r) => r.amount), c)], ["Open", money(sum(rows, (r) => r.open), c)], ["Overdue", money(sum(rows.filter((r) => r.status === "overdue"), (r) => r.open), c)]],
        sections: [{ heading: "Periods", table: { cols: ["#", "From", "To", "Days", "Due", "Amount", "Invoice", "Paid", "Status"], rows: rows.map((r) => [String(r.no), fmtAt(r.from), fmtEnd(r.to), fmtDays(r.minutes), fmtDate(r.dueAt), money(r.amount), r.invoiceRef || "", r.paid ? money(r.paid) : "", r.status + (r.overdueDays ? " · " + r.overdueDays + " d" : "")]), totals: ["", "", "", "", "", money(sum(rows, (r) => r.amount)), "", money(sum(rows, (r) => r.paid)), ""] } }] };
    }
    if (kind === "cashflow") {
      const cf = ctx.cashflow || cashflow(ps, store, ctx.vesselIds, { from: ctx.from, to: ctx.to, weeks: ctx.weeks, now: ctx.now }); const c = cf.currency;
      return { kind, title: "Cash flow forecast", subtitle: (ctx.selectionName || (vname ? MV(vname) : cf.vesselIds.length + " vessels")) + " · " + fmtDate(cf.from) + " – " + fmtDate(cf.to), currency: c, meta: [["Expected in", money(cf.totals.inflow, c)], ["Expected out", money(cf.totals.outflow, c)], ["Net", money(cf.totals.net, c)], ["Overdue in", money(cf.totals.overdueIn, c)], ["Overdue out", money(cf.totals.overdueOut, c)]],
        sections: [{ heading: "By week", table: { cols: ["Week from", "To", "In", "Out", "Net", "Cumulative"], rows: cf.weeks.map((w) => [w.from, w.to, money(w.inflow), money(w.outflow), money(w.net), money(w.cumulative)]) } }, { heading: "Items", table: { cols: ["Date", "Vessel", "Reference", "Counterparty", "Kind", "Amount", "Status"], rows: cf.weeks.flatMap((w) => w.items).map((i) => [i.date, i.vessel, i.ref, nm(i.cpId), i.kind, money(i.amount, i.currency), i.status + (i.overdue ? " · overdue" : "")]) } }] };
    }
    if (kind === "da") {
      const r = ctx.result || voyageResult(ps, store, ctx.voyageId, { now: ctx.now }); if (!r) throw new Error("Voyage not found"); const c = r.currency;
      return { kind, title: "Disbursement accounts", subtitle: MV(vname || r.vessel.name) + " · voyage " + (r.voyage.no || ""), currency: c, meta: [["Ports", String(r.das.length)], ["Advances", money(sum(r.das, (d) => d.pda), c)], ["Final accounts", money(sum(r.das.filter((d) => d.fda != null), (d) => d.fda), c)], ["Paid", money(sum(r.das, (d) => d.paid), c)], ["Balance", money(sum(r.das, (d) => d.balance), c)]],
        sections: [{ heading: "Accounts", table: { cols: ["Port", "Agent", "PDA", "Advance paid", "FDA", "Variance", "Paid", "Balance", "Status"], rows: r.das.map((d) => [d.port, nm(d.agentCpId), money(d.pda, d.currency), d.pdaPaidAt ? fmtDate(d.pdaPaidAt) : "—", d.fda != null ? money(d.fda, d.currency) : "—", d.variance != null ? money(d.variance) : "", money(d.paid), money(d.balance), d.status]) } }] };
    }
    throw new Error("Unknown report " + kind);
  }

  // ---------- the portal snapshot
  function portalSnapshot(ps, store, vesselId, vis, opt) {
    opt = opt || {}; vis = vis || {}; ps = ps || {}; store = store || {}; const now = opt.now || nowIso();
    const psv = (ps.vessels || []).find((v) => v.id === vesselId) || {}; const sv = (store.vessels || []).find((v) => v.id === vesselId) || {};
    const nm = (id) => (opt.cpName ? opt.cpName(id) : ((store.counterparties || []).find((c) => c.id === id) || {}).name || "");
    const vessel = { id: vesselId, name: psv.name || sv.name || "", imo: psv.imo || sv.imo || "", type: psv.type || sv.type || "", flag: psv.flag || sv.flag || "", dwt: psv.dwt || sv.dwt || 0, built: psv.built || sv.built || 0, loa: psv.loa || null, beam: psv.beam || null, draft: psv.draft || null, status: psv.status || "trading", management: psv.management || "", onboarded: psv.onboarded || null, offboarded: psv.offboarded || null, exit: psv.exit ? { at: String(psv.exit.at || psv.offboarded || "").slice(0, 10), reason: psv.exit.reason || "other", reasonName: exitReasonName(psv.exit.reason), handedTo: psv.exit.handedTo || "" } : null };
    const position = vis.positions === false ? null : (lastPosition(ps, vesselId) || (ps.positions || {})[vessel.imo] || null); /* 4.34.7 · the latest of AIS, report and typed position: what the office's own map shows */
    const f = activeFixture(ps, vesselId, now);
    // 4.31.15 · the employment the page shows: the fixture in force (delivered / commenced), else the next one (fixed, then on subs) with its
    // status — a fixed voyage charter not yet commenced reads "Fixed · … · voyage to commence", never "Open", and counts no days left
    const FSx = FST(); const vfx = (ps.fixtures || []).filter((x) => x && x.vesselId === vesselId && x.status !== "cancelled").map((x) => withStart(ps, x));
    const vst = FSx ? FSx.vesselState(vfx, now, { charterer: (x) => nm(x.chartererCpId) }) : null; const shownF = (vst && vst.shown) || f; const sInfo = FSx && shownF ? FSx.brief(shownF, now, { charterer: nm(shownF.chartererCpId) }) : null;
    const fixture = shownF && vis.commercial !== false ? { id: shownF.id, kind: shownF.kind, label: fxLabel(shownF), charterer: nm(shownF.chartererCpId), broker: shownF.brokerCpId ? nm(shownF.brokerCpId) : "", rate: +shownF.rate || 0, ...(hasRateSteps(shownF) ? { rateText: rateText(shownF, { per: "" }), rateSteps: rateRows(shownF, offhiresOf(ps, shownF)).map((x) => ({ rate: x.rate, days: x.days, from: x.from, to: x.to })) } : {}), rateUnit: shownF.rateUnit || "day", currency: shownF.currency || "USD", delivery: shownF.delivery || null, redelivery: shownF.redelivery || null, cpDate: shownF.cpDate || "", cpForm: shownF.cpForm || "", cargo: shownF.cargo || null, status: shownF.status, statusInfo: sInfo, subs: shownF.subs || null, daysLeft: sInfo ? sInfo.daysLeft : (shownF.redelivery && shownF.redelivery.at ? days(Math.max(0, minutes(now, shownF.redelivery.at))) : null), startsInDays: sInfo ? sInfo.startsInDays : null } : (shownF ? { kind: shownF.kind, label: fxLabel(shownF), status: shownF.status, statusInfo: sInfo ? { key: sInfo.key, word: sInfo.word, cls: sInfo.cls, started: sInfo.started, current: sInfo.current } : null } : null);
    const vy = (ps.voyages || []).filter((v) => v.vesselId === vesselId && v.status !== "completed").sort((a, b) => (b.no || 0) - (a.no || 0))[0] || (ps.voyages || []).filter((v) => v.vesselId === vesselId).sort((a, b) => (b.no || 0) - (a.no || 0))[0] || null;
    let voyage = null; if (vy && vis.commercial !== false) { const ports = (vy.ports || []).map((p) => ({ id: p.id, name: p.name, lat: p.lat, lon: p.lon, activity: p.activity, eta: p.eta, etd: p.etd, ata: p.ata, atd: p.atd, inPortMinutes: (p.ata || p.eta) && (p.atd || p.etd) ? Math.max(0, minutes(p.ata || p.eta, p.atd || p.etd)) : null })); const t = parse(now); const past = ports.filter((p) => parse(p.atd || p.etd) <= t); const next = ports.find((p) => isNaN(parse(p.atd || p.etd)) || parse(p.atd || p.etd) > t) || null; const current = ports.find((p) => parse(p.ata || p.eta) <= t && (isNaN(parse(p.atd || p.etd)) || parse(p.atd || p.etd) > t)) || null; voyage = { id: vy.id, no: vy.no, status: vy.status, ports, legs: (vy.legs || []).map((l) => ({ fromPortId: l.fromPortId, toPortId: l.toPortId, distanceNm: l.distanceNm, routeVia: l.routeVia })), previousPort: past.length ? past[past.length - 1] : null, currentPort: current, nextPort: next && next !== current ? next : (ports[ports.indexOf(current) + 1] || null), estimate: vis.financials ? voyageEstimate(vy, psv, f) : null }; }
    const financials = vis.financials ? (() => { const fin = vesselFinance(ps, store, vesselId, opt.range); const s = soa(ps, store, vesselId, opt.range); return { currency: fin.currency, income: fin.income, expenses: fin.expenses, result: fin.result, open: fin.open, overdue: fin.overdue, payablesOpen: fin.payablesOpen, months: fin.months, byCategory: fin.byCategory, docs: fin.docs.map((d) => ({ ...d, counterparty: nm(d.cpId) })), soa: { opening: s.opening, closing: s.closing, items: s.items } }; })() : null;
    const perf = vis.performance ? (() => { const p = performance(ps, store, vesselId, opt.range, { now }); return { fixedRate: p.fixedRate, netRate: p.netRate, marketRateAtFixing: p.marketRateAtFixing, delta: p.delta, deltaPct: p.deltaPct, tce: vis.financials ? p.tce : null, tceEstimated: !!p.tceEstimated, tceBasis: p.tceBasis || null, onHireDays: p.onHireDays, offHireDays: p.offHireDays, utilisation: p.utilisation, utilisationCommercial: p.utilisationCommercial, totalDays: p.totalDays, employedDays: p.employedDays, availableDays: p.availableDays, technicalOffDays: p.technicalOffDays, commercialOffDays: p.commercialOffDays, downtime: p.downtime, vsMarket: p.vsMarket, currency: p.currency }; })() : null;
    const strategy = vis.strategy ? (ps.strategies || []).filter((s) => s.vesselId === vesselId).map((s) => ({ horizon: s.horizon, from: s.from, targetRate: s.targetRate, markets: s.markets || [], products: s.products || [], relocateTo: s.relocateTo || "", notes: s.notes || "", updated: s.updated })) : null;
    const compliance = vis.operations !== false ? (ps.compliance || []).filter((c) => c.vesselId === vesselId).map((c) => ({ kind: c.kind, name: c.name, expires: c.expires, status: c.status })) : null;
    const offhire = vis.operations !== false ? (ps.offhire || []).filter((o) => o.vesselId === vesselId).map((o) => ({ from: o.from, to: o.to, reason: o.reason, kind: offhireKind(o), kindInferred: offhireKindInferred(o), days: days(minutes(o.from, o.to || now)) })) : null;
    const reports = (ps.reports || []).filter((r) => r.vesselId === vesselId).map((r) => ({ id: r.id, kind: r.kind, period: r.period, sentAt: r.sentAt, docId: r.docId || null }));
    // 4.14 · voyage accounting for the portal: the P&L lines with their status, the hire statements, bunkers on board and the DAs
    let voyagePnl = null, hireStmts = null, bunkers = null;
    try {
      if (vis.financials && vy) { const r = voyageResult(ps, store, vy.id, { now }); if (r) voyagePnl = { voyageId: r.voyageId, no: r.voyage.no, status: r.voyage.status || "", currency: r.currency, span: r.span, voyageDays: r.voyageDays, revenue: r.revenue, costs: r.costs, result: r.result, tce: r.tce, tceShown: r.tceShown, tceEstimated: r.tceEstimated, estimate: { revenue: r.estimate.revenue, costs: r.estimate.costs, result: r.estimate.result, tce: r.estimate.tce, totalDays: r.estimate.totalDays }, variance: r.variance, cash: r.cash, lines: r.lines.map((l) => ({ kind: l.kind, ref: l.ref, date: l.date, due: l.due, counterparty: nm(l.cpId), description: l.description, category: l.costKind || l.category, amount: l.amount, currency: l.currency, allocated: l.allocated, share: l.share, open: l.open, status: l.status, direction: l.direction || (l.kind === "invoice" ? "in" : "out") })), das: r.das.map((d) => ({ ...d, agent: nm(d.agentCpId) })), bunkers: r.bunkers.charterers ? { charterers: true } : { consumed: r.bunkers.consumed, cost: r.bunkers.cost, recorded: r.bunkers.recorded } }; }
      if (vis.financials && f && (f.kind === "tc" || f.kind === "bareboat")) hireStmts = hireStatements(ps, store, f, { now, vesselName: vessel.name }).map((r) => ({ no: r.no, from: r.from, to: r.to, days: r.days, dueAt: r.dueAt, amount: r.amount, currency: r.currency, invoiceRef: r.invoiceRef, status: r.status, due: !!r.due, open: r.open, paid: r.paid, paidAt: r.paidAt, overdueDays: r.overdueDays }));
      if (vis.operations !== false) { const bs = bunkerStock(ps, vesselId); bunkers = { grades: bs.grades.map((g) => ({ grade: g.grade, qty: g.qty, avgPrice: vis.financials ? g.avgPrice : null, value: vis.financials ? g.value : null })), totalQty: bs.totalQty }; }
    } catch (e) { /* the portal never fails on an accounting detail */ }
    // 4.20 · the metrics the portal shows first; a tile is absent (not zero) when the customer may not see that side
    const metrics = (() => { const cur = vst ? vst.current : (f && f.status === "delivered" ? f : null); const m = { asOf: now, employed: vst ? vst.state === "delivered" : !!(f && f.status === "delivered"), status: vst ? vst.state : (f ? f.status : "open"), statusWord: vst ? vst.word : null, statusLine: sInfo ? (vis.commercial !== false ? sInfo.line : sInfo.word) : "Open · no fixture", employment: fixture ? fixture.label : (shownF ? fxLabel(shownF) : "Open"), charterer: fixture ? fixture.charterer || null : null, daysLeft: sInfo && sInfo.current ? sInfo.daysLeft : null, startsInDays: sInfo ? sInfo.startsInDays : null, nextEvent: vst && vst.next ? vst.next : null, nextRedelivery: cur && cur.redelivery && cur.redelivery.at ? cur.redelivery.at : null, redeliveryEstimated: !!(cur && cur.redelivery && cur.redelivery.estimated !== false), voyageNo: vy ? vy.no || null : null, exited: vessel.status === "offboarded" };
      try {
        if (perf) { m.utilisation = perf.utilisation; m.utilisationCommercial = perf.utilisationCommercial; m.totalDays = perf.totalDays; m.employedDays = perf.employedDays; m.availableDays = perf.availableDays; m.technicalOffDays = perf.technicalOffDays; m.commercialOffDays = perf.commercialOffDays; m.onHireDays = perf.onHireDays; m.offHireDays = perf.offHireDays; m.deltaPct = perf.deltaPct; if (vis.financials) m.tce = perf.tce; m.tceEstimated = !!perf.tceEstimated; }
        if (vis.financials && financials) { const yr = now.slice(0, 4), ym = now.slice(0, 7); const months = (financials.months || []).map((x) => ({ month: x.month, income: r2(+x.income || 0), expenses: r2(+x.expenses || 0), amount: r2(+x.result || 0) }));
          m.currency = financials.currency; m.earningsByMonth = months.slice(-12); m.earningsYTD = r2(months.filter((x) => x.month >= yr).reduce((k, x) => k + x.amount, 0)); m.incomeYTD = r2(months.filter((x) => x.month >= yr).reduce((k, x) => k + x.income, 0)); m.earningsMTD = r2((months.find((x) => x.month === ym) || {}).amount || 0); m.result = financials.result; m.income = financials.income;
          const openInv = (financials.docs || []).filter((d) => d.kind === "invoice" && +d.open > 0.005); m.openInvoices = { n: openInv.length, amount: financials.open, overdue: financials.overdue, currency: financials.currency };
          if (voyagePnl) m.voyage = { no: voyagePnl.no, result: voyagePnl.result, estimate: voyagePnl.estimate ? voyagePnl.estimate.result : null, tce: voyagePnl.tceShown != null ? voyagePnl.tceShown : voyagePnl.tce, tceEstimated: !!voyagePnl.tceEstimated, estimateTce: voyagePnl.estimate ? voyagePnl.estimate.tce : null, closed: voyagePnl.status === "completed", currency: voyagePnl.currency, days: voyagePnl.voyageDays };
          if (hireStmts) m.hire = { periods: hireStmts.length, open: hireStmts.filter((h) => h.status !== "paid" && h.status !== "not invoiced" && +h.open > 0.005).length, overdue: hireStmts.filter((h) => h.status === "overdue").length, openAmount: r2(hireStmts.reduce((k, h) => k + (h.status !== "not invoiced" ? +h.open || 0 : 0), 0)) /* 4.30.6 · what is outstanding on the statements raised, not the periods never invoiced */, notInvoiced: hireStmts.filter((h) => h.status === "not invoiced" && h.due).length }; }
      } catch (e) { /* metrics are a convenience */ }
      return m; })();
    // 4.31.14 · the owners' Statement of accounts: the vessel's whole history as rows; the portal filters and totals them with the same OwnerStatement.compute as the desktop
    let statement = null; if (vis.financials) { try { statement = ownerStatementRows(ps, store, vesselId, { now, currency: opt.currency }); } catch (e) { statement = null; } }
    // 4.31.15 · every fixture with its terms, status and history, the plan of its cargo, its voyages and off-hire (the portal's Fixture page),
    // and the documents the manager marked for the customer with the fixture or voyage they belong to (the files themselves are portal_files)
    let fixturesOut = null; if (vis.commercial !== false) { try { fixturesOut = portalFixtures(ps, vesselId, now, nm, opt); } catch (e) { fixturesOut = null; } }
    let documents = []; if (vis.documents !== false) { try { documents = portalDocuments(ps, vesselId, opt.cpId || null); } catch (e) { documents = []; } }
    const out = { v: 1, vessel, position, fixture, voyage, financials, performance: perf, strategy, compliance, offhire, reports, documents, visibility: vis, updatedAt: now, voyagePnl, hireStatements: hireStmts, bunkers, metrics, statement };
    if (fixturesOut) out.fixtures = fixturesOut; return out;
  }
  const FST = () => { if (typeof FixtureStatus !== "undefined") return FixtureStatus; try { return typeof require === "function" ? require("./fixture-status.js") : null; } catch (e) { return null; } };
  // the status history of a fixture: what the desk recorded (statusLog, 4.31.15), else what its dates say
  function fixtureLog(f) { if (Array.isArray(f.statusLog) && f.statusLog.length) return f.statusLog.filter((x) => x && x.status).map((x) => ({ status: x.status, at: x.at || null, by: x.by || "" })); const out = []; const s = f.status || "";
    if (f.cpDate) out.push({ status: s === "on-subs" ? "on-subs" : "fixed", at: String(f.cpDate).slice(0, 10), derived: true }); if (f.delivery && f.delivery.at && ["delivered", "redelivered"].includes(s)) out.push({ status: "delivered", at: f.delivery.at, derived: true }); if (s === "redelivered" && f.redelivery && f.redelivery.at) out.push({ status: "redelivered", at: f.redelivery.at, derived: true }); if (s === "cancelled" || s === "failed") out.push({ status: s, at: f.updated ? String(f.updated).slice(0, 16) : null, derived: true }); return out; }
  const portalSection = (s) => { const k = String(s || "").toLowerCase(); return ["commercial", "operations", "financial", "compliance", "reports"].includes(k) ? k : "documents"; };
  function portalFixtures(ps, vesselId, now, nm, opt) {
    const FSx = FST(); const list = (ps.fixtures || []).filter((x) => x && x.vesselId === vesselId).slice().sort((a, b) => String(startAt(ps, a) || a.cpDate || "").localeCompare(String(startAt(ps, b) || b.cpDate || "")));
    return list.map((f0) => { const f = withStart(ps, f0); const cm = commencement(ps, f0); const c = f.cargo || null; let plan = null;
      if (f.kind === "voyage" && c && ((c.loadPorts || []).length || (c.dischargePorts || []).length)) { try { const pl = fixturePlan(ps, f, { resolve: opt.resolvePort || null }); const s0 = FSx ? FSx.parse(delAt(f) || (c.laycan && c.laycan.from) || "") : NaN; const portH = c.laytimeHours ? Math.max(12, +c.laytimeHours / Math.max(1, pl.ports.length)) : 36; let t = s0; const etas = {}; if (!isNaN(t)) { etas[pl.ports[0] ? pl.ports[0].name : ""] = iso(t); for (const l of pl.legs) { t += portH * 60 * MIN + l.days * DAYM * MIN; etas[l.to] = iso(t); } }
          plan = { totalNm: Math.round(pl.totalNm), seaDays: r2(pl.seaDays), speed: pl.speed, via: pl.via, missing: pl.missing, ports: pl.ports.map((p) => ({ name: p.name, activity: p.activity, sts: !!p.sts, parcels: p.parcels || null, lat: p.lat, lon: p.lon, eta: etas[p.name] || null })), legs: pl.legs.map((l) => ({ from: l.from, to: l.to, nm: Math.round(l.nm), via: l.via, speed: l.speed, days: r2(l.days) })), etaBasis: isNaN(s0) ? null : (delAt(f) ? "delivery" : "laycan") }; } catch (e) { plan = null; } }
      const fa = parse(delAt(f)), fz = redelAt(f) ? parse(redelAt(f)) : parse(now); const ohs = offhiresOf(ps, f).filter((o) => o.fixtureId === f.id || (!o.fixtureId && !isNaN(fa) && parse(o.from) >= fa && parse(o.from) <= fz)).map((o) => ({ from: o.from, to: o.to || null, reason: o.reason || "", kind: offhireKind(o), kindInferred: offhireKindInferred(o), days: days(minutes(o.from, o.to || now)) }));
      return { id: f.id, kind: f.kind, label: fxLabel(f), charterer: nm(f.chartererCpId), broker: f.brokerCpId ? nm(f.brokerCpId) : "", brokers: brokersOf(f).map((b) => ({ name: b.cpId ? nm(b.cpId) : "", pct: b.pct })), rate: +f.rate || 0, ...(hasRateSteps(f) ? { rateText: rateText(f, { per: "" }), rateSteps: rateRows(f, offhiresOf(ps, f)).map((x) => ({ rate: x.rate, days: x.days, from: x.from, to: x.to })) } : {}), rateUnit: f.rateUnit || "day", currency: f.currency || "USD", addressCommission: +f.addressCommission || 0, brokerage: brokeragePct(f), hireInterval: f.kind === "voyage" ? null : (+f.hireInterval || 15), hireInAdvance: f.hireInAdvance !== false, ballastBonus: +f.ballastBonus || 0, minDays: f.minDays || null, maxDays: f.maxDays || null, cpDate: f.cpDate || "", cpForm: f.cpForm || "", delivery: f.delivery ? { at: f.delivery.at || null, port: f.delivery.port || "", estimated: f.status !== "delivered" && f.status !== "redelivered", derived: f.delivery.derived || null } : null, commencement: f.kind === "voyage" ? { at: cm.at, basis: cm.basis, text: cm.text } : null, redelivery: f.redelivery ? { at: f.redelivery.at || null, port: f.redelivery.port || "", estimated: !redelActual(f) } : null,
        cargo: c ? { commodity: c.commodity || "", qty: c.qty || null, unit: c.unit || "MT", loadPorts: c.loadPorts || [], dischargePorts: c.dischargePorts || [], laycan: c.laycan || null, laytimeHours: c.laytimeHours || null, terms: c.terms || "", reversible: !!c.reversible, demurrageRate: c.demurrageRate || null, despatchRate: c.despatchRate || null } : null,
        // 4.32.2 · every parcel (commodity, quantity, its ports with the STS flag, its rate when its own), the STS ports and the charterer-paid extras
        parcels: f.kind === "voyage" && c ? parcelsOf(f).map((p) => { const pr = parcelRate(f, p); return { no: p.no, commodity: p.commodity, qty: p.qty || null, unit: p.unit, loadPorts: p.loadPorts, dischargePorts: p.dischargePorts, sts: { load: p.loadPorts.filter((n) => (p.loadPortRefs || []).some((r) => r && r.sts && normName(r.name) === normName(n))), discharge: p.dischargePorts.filter((n) => (p.dischargePortRefs || []).some((r) => r && r.sts && normName(r.name) === normName(n))) }, rate: p.rate != null ? pr.rate : null, rateUnit: p.rate != null ? pr.unit : null, notes: p.notes || "" }; }) : null,
        totals: f.kind === "voyage" && c ? (() => { const t = cargoTotals(f); return { qty: t.qty, unit: t.unit, commodity: t.commodity, parcels: t.parcels }; })() : null,
        extras: fixtureExtras(f).map((x) => ({ kind: x.kind, label: x.label, amount: x.amount, currency: x.currency, note: x.note })),
        subs: f.status === "on-subs" && f.subs ? { deadline: f.subs.deadline || null, items: f.subs.items || f.subs.text || null } : null, status: f.status, statusInfo: FSx ? FSx.brief(f, now, { charterer: nm(f.chartererCpId) }) : null, statusLog: fixtureLog(f), plan, voyageIds: (ps.voyages || []).filter((v) => v.fixtureId === f.id).map((v) => v.id), offhire: ohs, updated: f.updated || null }; });
  }
  function portalDocuments(ps, vesselId, cpId) {
    const FSx = FST(); const out = []; const tag = (list, fixtureId, voyageId) => { for (const d of list || []) { if (!d || d.visibility !== "customer") continue; if (cpId && Array.isArray(d.cpIds) && d.cpIds.length && !d.cpIds.includes(cpId)) continue; out.push({ name: d.name, section: d.psec || portalSection(d.section), kind: FSx ? FSx.docKind(d.name, d.kind) : (d.kind || "other"), fixtureId: fixtureId || null, voyageId: voyageId || null, sharedAt: d.sharedAt || d.at || null }); } };
    for (const f of (ps.fixtures || []).filter((x) => x && x.vesselId === vesselId)) tag(f.docs, f.id, null);
    for (const vy of (ps.voyages || []).filter((x) => x && x.vesselId === vesselId)) tag(vy.docs, vy.fixtureId || null, vy.id);
    const v = (ps.vessels || []).find((x) => x.id === vesselId); if (v) tag(v.docs, null, null);
    return out;
  }


  // ---------- 4.15 · the voyage plan on the map (app and portal share this): routes through the canals and capes, the sailed /
  // ahead split, the track from AIS and noon reports, and an estimated position along the plan when nothing has been heard.
  // The region classifier is coarse (boxes by latitude/longitude) — enough to choose Suez, Panama or the Cape and the corners.
  const RAD = Math.PI / 180, NMR = 3440.065;
  const WPT = { gib: [36.0, -5.6], said: [31.3, 32.35], suez: [29.9, 32.55], bab: [12.55, 43.4], hormuz: [26.5, 56.6], malacca: [1.2, 103.9], cape: [-35.2, 18.5], colon: [9.4, -79.9], balboa: [8.85, -79.5], dakar: [14.4, -17.9], dondra: [5.6, 80.6], horn: [-56.6, -67.3], ushant: [48.6, -5.6], finisterre: [43.2, -9.6], red: [19.5, 38.8], hadd: [22.3, 60.2] };
  const BOXES = [["MED", 30, 47, -6, 42], ["NEUR", 47, 72, -12, 32], ["RED", 12, 30, 32, 44], ["AG", 23, 31, 47, 56], ["AG", 26.4, 31, 56, 57.2], ["GOO", 15, 27, 56, 66], ["IND", 5, 26, 66, 93], ["FE", -12, 52, 93, 150], ["AUS", -48, -10, 110, 180], ["SAF", -36, -22, 14, 36], ["EAF", -27, 12, 36, 60], ["WAF", -20, 21, -20, 15], ["ATL", 20, 47, -32, -6], ["USEC", 24, 50, -82, -60], ["USG", 17, 31, -98, -80.5], ["CARIB", 7, 24, -90, -58], ["WCSA", -57, 7, -95, -70], ["ECSA", -56, 7, -70, -30], ["WCNA", 23, 61, -170, -105]];
  function regionOf(lat, lon) { lat = +lat; lon = +lon; if (isNaN(lat) || isNaN(lon)) return "ATL"; for (const b of BOXES) if (lat >= b[1] && lat <= b[2] && lon >= b[3] && lon <= b[4]) return b[0]; if (lon >= -40 && lon < 20) return lat < 0 ? "WAF" : "ATL"; if (lon >= 20 && lon < 95) return "IND"; if (lon >= 95 || lon < -150) return lat < -10 ? "AUS" : "FE"; return lat > 10 ? "WCNA" : "WCSA"; }
  const ATLR = new Set(["NEUR", "ATL", "USEC", "USG", "CARIB", "ECSA", "WAF", "MED"]), INDR = new Set(["RED", "AG", "GOO", "IND", "EAF", "SAF"]), PACR = new Set(["WCNA", "WCSA"]);
  const atlantic = (r) => ATLR.has(r), indian = (r) => INDR.has(r), pacific = (r) => PACR.has(r), fe = (r) => r === "FE", aus = (r) => r === "AUS", eastSide = (r) => indian(r) || fe(r) || aus(r);
  function gcNm(a, b) { const la1 = a[0] * RAD, lo1 = a[1] * RAD, la2 = b[0] * RAD, lo2 = b[1] * RAD; const h = Math.sin((la2 - la1) / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin((lo2 - lo1) / 2) ** 2; return 2 * NMR * Math.asin(Math.min(1, Math.sqrt(h))); }
  function gcPts(a, b, n) { const out = []; const la1 = a[0] * RAD, lo1 = a[1] * RAD, la2 = b[0] * RAD, lo2 = b[1] * RAD; const d = 2 * Math.asin(Math.min(1, Math.sqrt(Math.sin((la2 - la1) / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin((lo2 - lo1) / 2) ** 2))); if (d < 1e-6) return [a, b]; n = n || Math.max(2, Math.min(60, Math.round(d * NMR / 150))); for (let i = 0; i <= n; i++) { const f = i / n, A = Math.sin((1 - f) * d) / Math.sin(d), B = Math.sin(f * d) / Math.sin(d); const x = A * Math.cos(la1) * Math.cos(lo1) + B * Math.cos(la2) * Math.cos(lo2), y = A * Math.cos(la1) * Math.sin(lo1) + B * Math.cos(la2) * Math.sin(lo2), z = A * Math.sin(la1) + B * Math.sin(la2); out.push([Math.atan2(z, Math.sqrt(x * x + y * y)) / RAD, Math.atan2(y, x) / RAD]); } return out; }
  // 4.30.7 · the routing policy (ps.settings.routing: avoidSuez → round the Cape of Good Hope; avoidPanama → Cape Horn for the Pacific
  // coast, Good Hope for the Far East) applies to legs without a route of their own
  function suggestVia(ra, rb, policy) { policy = policy || {}; const pair = (x, y) => (x(ra) && y(rb)) || (x(rb) && y(ra)); const sam = (r) => r === "ECSA" || r === "WAF", usa = (r) => r === "USG" || r === "USEC" || r === "CARIB", saf = (r) => r === "SAF"; let via = "direct"; if (pair(atlantic, saf)) via = "cape"; else if (pair(sam, (r) => fe(r) || aus(r) || indian(r))) via = "cape"; else if (pair(atlantic, pacific)) via = "panama"; else if (pair(usa, (r) => fe(r) || aus(r))) via = "panama"; else if (pair(atlantic, eastSide)) via = "suez"; if (via === "suez" && policy.avoidSuez) via = "cape"; if (via === "panama" && policy.avoidPanama) via = pair(atlantic, pacific) ? "horn" : "cape"; return via; }
  function waypoints(a, b, via, policy) {
    const ra = a.region || regionOf(a.lat, a.lon), rb = b.region || regionOf(b.lat, b.lon); const A = [+a.lat, +a.lon], B = [+b.lat, +b.lon]; let chain = []; const need = (c, wp) => { if (c) chain.push(wp); };
    via = via && via !== "auto" ? via : suggestVia(ra, rb, policy);
    if (via === "horn") { const pacA = pacific(ra) || fe(ra) || aus(ra), pacB = pacific(rb) || fe(rb) || aus(rb); if (pacA !== pacB) { chain = [WPT.horn]; const atlR = pacA ? rb : ra; if (atlR === "MED") chain = pacA ? [WPT.horn, WPT.gib] : [WPT.gib, WPT.horn]; return { via, pts: [A, ...chain, B] }; } via = "direct"; }
    if (via === "panama") { const pacA = pacific(ra) || fe(ra) || aus(ra), pacB = pacific(rb) || fe(rb) || aus(rb); if (pacA !== pacB) { chain = pacA ? [WPT.balboa, WPT.colon] : [WPT.colon, WPT.balboa]; const atlR = pacA ? rb : ra; if (atlR === "MED") chain = pacA ? [...chain, WPT.gib] : [WPT.gib, ...chain]; return { via, pts: [A, ...chain, B] }; } via = "direct"; }
    if (via === "suez" || via === "cape") { const westR = atlantic(ra) ? ra : atlantic(rb) ? rb : null, eastR = eastSide(ra) ? ra : eastSide(rb) ? rb : null; if (westR && eastR) { need(westR === "NEUR", WPT.ushant); need(westR === "NEUR", WPT.finisterre); if (via === "suez") { need(westR !== "MED", WPT.gib); chain.push(WPT.said, WPT.suez, WPT.red, WPT.bab); } else { need(westR === "MED", WPT.gib); need(westR === "NEUR" || westR === "MED" || westR === "ATL", WPT.dakar); chain.push(WPT.cape); } need(eastR === "AG" || eastR === "GOO", WPT.hadd); need(eastR === "AG", WPT.hormuz); need(fe(eastR), WPT.dondra); need(fe(eastR), WPT.malacca); if (!atlantic(ra)) chain.reverse(); return { via, pts: [A, ...chain, B] }; } via = "direct"; }
    if (((ra === "NEUR") !== (rb === "NEUR")) && atlantic(ra) && atlantic(rb) && Math.min(A[0], B[0]) < 46) { const south = ra === "NEUR" ? rb : ra; chain = [WPT.ushant, WPT.finisterre]; if (south === "MED") chain.push(WPT.gib); if (ra !== "NEUR") chain.reverse(); return { via: "direct", pts: [A, ...chain, B] }; }
    need(atlantic(ra) && atlantic(rb) && ((ra === "MED") !== (rb === "MED")), WPT.gib);
    need((ra === "AG") !== (rb === "AG"), WPT.hormuz);
    const viaMalacca = (indian(ra) && fe(rb)) || (indian(rb) && fe(ra)) || (pacific(ra) && indian(rb)) || (pacific(rb) && indian(ra));
    need(viaMalacca, WPT.malacca); need(viaMalacca && Math.min(A[1], B[1]) < 79, WPT.dondra); // round the south of Sri Lanka, not across India
    chain.sort((p, q) => p[1] - q[1]); const goingEast = ((B[1] - A[1] + 540) % 360) - 180 > 0; if (!goingEast) chain.reverse();
    return { via: "direct", pts: [A, ...chain, B] };
  }
  const unwrapLine = (line) => { const out = []; let off = 0; for (let i = 0; i < line.length; i++) { let lon = line[i][1] + off; if (i) { const prev = out[i - 1][1]; if (lon - prev > 180) { off -= 360; lon -= 360; } else if (prev - lon > 180) { off += 360; lon += 360; } } out.push([line[i][0], lon]); } return out; };
  // 4.31.22 · real sea routes: the shortest track over a 0.25° sea grid built from Natural Earth (src/searoute.js, bundled — no
  // routing service), through the canals and straits, round the capes; `via` / the fleet's policy close Suez, Panama, the Cape or
  // Cape Horn. The waypoint chains above remain the fallback when the grid is not loaded.
  const SRX = () => { if (typeof SeaRoute !== "undefined" && SeaRoute && SeaRoute.route) return SeaRoute; try { return typeof require === "function" ? require("./searoute.js") : null; } catch (e) { return null; } };
  // seaRoute([lng, lat], [lng, lat], { avoid: ["suez" | "panama" | "cape" | "horn"], via, policy }) → { nm, points: [[lng, lat], …], via: ["Suez", …], ok }
  function seaRoute(from, to, opt) { opt = opt || {}; const S = SRX(); const avoid = opt.avoid || (S ? S.avoidFor(opt.via, opt.policy) : []); if (S && S.ready()) return S.route(from, to, { avoid });
    const a = { lat: +from[1], lon: +from[0] }, b = { lat: +to[1], lon: +to[0] }; const w = waypoints(a, b, opt.via, opt.policy); let nm = 0; const pts = []; for (let i = 0; i < w.pts.length - 1; i++) { nm += gcNm(w.pts[i], w.pts[i + 1]); for (const q of gcPts(w.pts[i], w.pts[i + 1])) pts.push(q); }
    return { nm: Math.round(nm), points: unwrapLine(pts).map((q) => [q[1], q[0]]), via: w.via === "direct" ? [] : [VIA_NAME[w.via] ? VIA_NAME[w.via].replace(/^via (the )?/, "") : w.via], ok: false }; }
  // trackPath([{ lat, lon } | [lat, lon], …], gapNm = 200) → the reported positions joined by sea routes where two consecutive reports
  // are more than gapNm apart (straight otherwise): { segments: [[[lat, lon], …] per gap], line: [[lat, lon], …] } — the reports stay the vertices
  function trackPath(points, gapNm) { const pts = (points || []).map((q) => (Array.isArray(q) ? [+q[0], +q[1]] : [+q.lat, +q.lon])).filter((q) => isFinite(q[0]) && isFinite(q[1])); const S = SRX(); const segs = [];
    if (S && S.ready()) { for (const seg of S.trackLine(pts.map((q) => [q[1], q[0]]), gapNm == null ? 200 : gapNm)) segs.push(seg.map((q) => [q[1], q[0]])); } else for (let i = 1; i < pts.length; i++) segs.push([pts[i - 1], pts[i]]);
    const line = []; segs.forEach((sg, i) => { for (let k = i ? 1 : 0; k < sg.length; k++) line.push(sg[k]); }); return { segments: segs, line: line.length ? unwrapLine(line) : pts.slice() }; }
  // routeLine({lat, lon, region?}, {lat, lon, region?}, via?, policy?) → { nm, via, passages, line: [[lat, lon], …] (longitudes unwrapped), points }
  function routeLine(a, b, via, policy) { if (!a || !b || a.lat == null || b.lat == null) return { nm: 0, via: via || "direct", line: [], points: [] };
    const S = SRX(); if (S && S.ready()) { const r = S.route([+a.lon, +a.lat], [+b.lon, +b.lat], { avoid: S.avoidFor(via, policy) }); if (r.ok) { const line = r.points.map((q) => [q[1], q[0]]); return { nm: r.nm, via: S.viaWord(r.via), passages: r.via, line, points: line, sea: true }; } }
    const w = waypoints(a, b, via, policy); let nm = 0; const line = []; for (let i = 0; i < w.pts.length - 1; i++) { nm += gcNm(w.pts[i], w.pts[i + 1]); for (const p of gcPts(w.pts[i], w.pts[i + 1])) line.push(p); } return { nm: Math.round(nm), via: w.via, line: unwrapLine(line), points: w.pts }; }
  const tOf = (x) => { const t = parse(x); return isNaN(t) ? null : t; };
  function currentVoyage(ps, vesselId, now) { const list = (ps.voyages || []).filter((v) => v.vesselId === vesselId); if (!list.length) return null; const sailing = list.find((v) => v.status === "sailing"); if (sailing) return sailing; for (const v of list) { const sp = voyageSpan(ps, v); const f = tOf(sp.from), t = tOf(sp.to); if (f != null && t != null && now >= f && now <= t) return v; } const planned = list.filter((v) => v.status !== "completed" && (v.ports || []).some((p) => p.lat != null)).sort((a, b) => { const fa = tOf(voyageSpan(ps, a).from) || 0, fb = tOf(voyageSpan(ps, b).from) || 0; return fa - fb; }); if (planned.length) return planned[0]; return list[list.length - 1]; }
  // voyagePlan(ps, vesselId, voyageId | voyage | null, { now }) → the ports with their status, the legs with routed lines and
  // sailed/current/ahead, where she comes from and where she goes
  function voyagePlan(ps, vesselId, voyageRef, opt) {
    opt = opt || {}; const now = tOf(opt.now) || Date.now();
    const vy = voyageRef && typeof voyageRef === "object" ? voyageRef : voyageRef ? (ps.voyages || []).find((v) => v.id === voyageRef) : currentVoyage(ps, vesselId, now);
    if (!vy) return null;
    const vessel = (ps.vessels || []).find((v) => v.id === (vesselId || vy.vesselId)) || {}; const fixture = (ps.fixtures || []).find((f) => f.id === vy.fixtureId) || null;
    const ports = (vy.ports || []).map((p, i) => { const ata = tOf(p.ata), atd = tOf(p.atd), eta = tOf(p.eta), etd = tOf(p.etd); const status = atd != null ? "done" : ata != null ? "current" : "ahead"; return { id: p.id, idx: i, name: p.name || p.port || "", activity: p.activity || "", lat: p.lat != null ? +p.lat : null, lon: p.lon != null ? +p.lon : null, region: p.region || null, eta: p.eta || null, etd: p.etd || null, ata: p.ata || null, atd: p.atd || null, status, agentCpId: p.agentCpId || null, cargoQty: p.cargoQty != null ? +p.cargoQty : null, t: { ata, atd, eta, etd } }; });
    const withPos = ports.filter((p) => p.lat != null && p.lon != null && !isNaN(p.lat) && !isNaN(p.lon));
    const legs = []; let laden = false;
    for (let i = 0; i < withPos.length - 1; i++) {
      const a = withPos[i], b = withPos[i + 1]; const saved = (vy.legs || []).find((l) => l.fromPortId === a.id && l.toPortId === b.id) || {};
      const rt = routeLine(a, b, saved.routeVia || saved.via || null, (ps.settings && ps.settings.routing) || null); if (a.activity === "load") laden = true; else if (a.activity === "discharge") laden = false;
      const distanceNm = +saved.distanceNm || rt.nm; const speed = +saved.speed || (laden ? +vessel.speedLaden : +vessel.speedBallast) || +vessel.speedLaden || 12;
      const dep = a.t.atd != null ? a.t.atd : a.t.etd, arr = b.t.ata != null ? b.t.ata : b.t.eta;
      let status = "ahead"; if (b.t.ata != null || b.t.atd != null) status = "sailed"; else if (a.t.atd != null) status = "current"; else if (dep != null && dep <= now && (arr == null || arr >= now - 6 * 3600000)) status = "current";
      legs.push({ index: legs.length, fromPortId: a.id, toPortId: b.id, from: a.name, to: b.name, via: rt.via, routeVia: saved.routeVia || saved.via || null, passages: rt.passages || [], distanceNm, routedNm: rt.nm, speed, hours: speed ? r2(distanceNm / speed) : null, laden, departed: dep != null ? iso(dep) : null, arrives: arr != null ? iso(arr) : null, status, line: rt.line });
    }
    // exactly one current leg: the first "current" wins; ahead legs after a current one stay ahead, sailed ones before it
    let cur = legs.findIndex((l) => l.status === "current"); if (cur < 0) { const lastSailed = legs.map((l) => l.status).lastIndexOf("sailed"); if (lastSailed >= 0 && lastSailed < legs.length - 1 && legs[lastSailed + 1].status === "ahead" && withPos[lastSailed + 1].status === "done") { cur = lastSailed + 1; legs[cur].status = "current"; } }
    for (let i = 0; i < legs.length; i++) { if (cur >= 0 && i < cur && legs[i].status !== "sailed") legs[i].status = "sailed"; if (cur >= 0 && i > cur) legs[i].status = "ahead"; }
    const totalNm = legs.reduce((k, l) => k + l.distanceNm, 0), sailedNm = legs.filter((l) => l.status === "sailed").reduce((k, l) => k + l.distanceNm, 0);
    const inPort = ports.find((p) => p.status === "current") || null; const done = ports.filter((p) => p.status === "done"); const previousPort = done.length ? done[done.length - 1] : null;
    const curLeg = cur >= 0 ? legs[cur] : null; const nextPort = curLeg ? ports.find((p) => p.id === curLeg.toPortId) : (inPort ? ports.find((p) => p.idx > inPort.idx) || null : ports.find((p) => p.status === "ahead") || null);
    const onward = nextPort ? ports.filter((p) => p.idx > nextPort.idx) : [];
    const out = (p) => (p ? { id: p.id, name: p.name, activity: p.activity, lat: p.lat, lon: p.lon, eta: p.eta, etd: p.etd, ata: p.ata, atd: p.atd, status: p.status } : null);
    return { voyageId: vy.id, vesselId: vy.vesselId, no: vy.no || "", status: vy.status || "", routing: (ps.settings && ps.settings.routing) || null, fixtureId: vy.fixtureId || null, charterer: fixture ? fixture.chartererCpId || null : null, ports: ports.map((p) => out(p)), legs, totalNm: Math.round(totalNm), sailedNm: Math.round(sailedNm), progress: totalNm ? r4(sailedNm / totalNm) : 0, currentLeg: cur, inPort: out(inPort), previousPort: out(previousPort), currentPort: out(inPort), nextPort: out(nextPort), onward: onward.map((p) => out(p)), etd: curLeg ? curLeg.departed : (inPort ? inPort.etd : null), eta: nextPort ? (nextPort.ata || nextPort.eta) : null, from: previousPort ? previousPort.name : (withPos[0] ? withPos[0].name : ""), to: nextPort ? nextPort.name : "" };
  }
  // ---------- 4.34.7 · where a vessel is: the latest position held for her from any source (src/last-position.js, shared with
  // the portal). lastPosition(ps, vesselId, { now, positions: [extra fixes] }) → { lat, lon, at, source: "ais" | "report" |
  // "manual", kind, ref, sog, cog, hdg, dest, eta, navStatus } | null. The candidates: the live slot of the vessel (ps.positions:
  // the last AIS fix, or the last position typed in), every report of hers that carries a latitude and a longitude, and any fix
  // the caller adds. Compared by the time of the position itself; the same instant → AIS; places that are not places and times
  // more than ten minutes ahead are left out.
  const LPX = () => { if (typeof LastPosition !== "undefined") return LastPosition; try { return typeof require === "function" ? require("./last-position.js") : null; } catch (e) { return null; } };
  function positionCandidates(ps, vesselId, opt) { opt = opt || {}; ps = ps || {}; let px = null; try { px = psIndex(ps); } catch (e) { px = null; } const vessel = (px ? px.vesselById.get(vesselId) : (ps.vessels || []).find((v) => v.id === vesselId)) || {}; const out = []; const live = (ps.positions || {})[vessel.imo] || (ps.positions || {})[vesselId] || null; if (live) out.push({ ...live, at: live.ts, source: live.source === "ais" ? "ais" : live.source === "noon" ? "noon" : "manual" });
    const reps = px ? px.noonByVessel.get(vesselId) || [] : (ps.noonReports || []).filter((n) => n && n.vesselId === vesselId);
    for (const n of reps) { if (!n || n.lat == null || n.lon == null || n.lat === "" || n.lon === "") continue; out.push({ lat: n.lat, lon: n.lon, at: n.at || n.ts || n.date, source: "report", kind: n.kind || n.type || "noon", ref: n.id || null, sog: n.sog != null ? n.sog : n.speed, cog: n.cog != null ? n.cog : n.course }); }
    for (const q of opt.positions || []) if (q) out.push({ ...q, at: q.at != null ? q.at : q.ts, source: q.source || q.kind || "ais" }); return out; }
  function lastPosition(ps, vesselId, opt) { const L = LPX(); if (!L) return null; opt = opt || {}; ps = ps || {}; const now = opt.now ? L.time(opt.now) : Date.now(); const nowT = isNaN(now) ? Date.now() : now; let px = null; try { px = opt.index || psIndex(ps); } catch (e) { px = null; }
    if (!px) { const p0 = L.pick(positionCandidates(ps, vesselId, opt), nowT); if (!p0) return null; const { t: t0, ...r0 } = p0; void t0; return r0; }
    const vessel = px.vesselById.get(vesselId) || {}; const pos = ps.positions || {}; const live = pos[vessel.imo] || pos[vesselId] || null; const cands = []; if (live) cands.push(live.source === "ais" || live.source === "noon" ? (live.at != null ? live : { ...live, at: live.ts }) : { ...live, at: live.ts, source: "manual" });
    // her reports are kept in time order: the newest usable one is the only one that can win
    const reps = px.noonByVessel.get(vesselId) || []; for (let i = reps.length - 1; i >= 0; i--) { const n = reps[i]; if (!n || n.lat == null || n.lon == null || n.lat === "" || n.lon === "") continue; const c = { lat: n.lat, lon: n.lon, at: n.at || n.ts || n.date, source: "report", kind: n.kind || n.type || "noon", ref: n.id || null, sog: n.sog != null ? n.sog : n.speed, cog: n.cog != null ? n.cog : n.course }; if (L.usable(c, nowT)) { cands.push(c); break; } }
    for (const q of opt.positions || []) if (q) cands.push({ ...q, at: q.at != null ? q.at : q.ts, source: q.source || q.kind || "ais" });
    const p = L.pick(cands, nowT); if (!p) return null; const { t, ...rest } = p; void t; return rest; }
  const positionLabel = (p, now) => { const L = LPX(); return L && p ? L.label(p, now ? L.time(now) : undefined) : ""; };
  // track(ps, vesselId, { from, to }, { positions: [extra points], limit }) → the reported positions in time order (noon reports,
  // the last AIS/manual position, anything the caller adds), de-duplicated within ten minutes
  function track(ps, vesselId, range, opt) {
    opt = opt || {}; range = range || {}; const vessel = (ps.vessels || []).find((v) => v.id === vesselId) || {}; const f0 = tOf(range.from), t0 = tOf(range.to);
    const pts = [];
    for (const n of ps.noonReports || []) { if (n.vesselId !== vesselId) continue; const lat = n.lat != null ? +n.lat : NaN, lon = n.lon != null ? +n.lon : NaN; if (isNaN(lat) || isNaN(lon)) continue; const ts = tOf(n.at || n.ts || n.date); if (ts == null) continue; pts.push({ lat, lon, ts, sog: n.sog != null ? +n.sog : (n.speed != null ? +n.speed : null), cog: n.cog != null ? +n.cog : (n.course != null ? +n.course : null), kind: "noon", voyageId: n.voyageId || null }); }
    const live = (ps.positions || {})[vessel.imo]; if (live && live.lat != null && live.lon != null && isFinite(+live.lat) && isFinite(+live.lon) && (Math.abs(+live.lat) + Math.abs(+live.lon) > 0 || live.ts)) { const ts = tOf(live.ts); if (ts != null) pts.push({ lat: +live.lat, lon: +live.lon, ts, sog: live.sog != null ? +live.sog : null, cog: live.cog != null ? +live.cog : null, kind: live.source === "ais" ? "ais" : "manual" }); }
    for (const q of opt.positions || []) { const lat = +q.lat, lon = +q.lon, ts = tOf(q.ts); if (isNaN(lat) || isNaN(lon) || ts == null) continue; pts.push({ lat, lon, ts, sog: q.sog != null ? +q.sog : null, cog: q.cog != null ? +q.cog : null, kind: q.kind || q.source || "ais" }); }
    { const L = LPX(); const nowT = opt.now && L ? L.time(opt.now) : Date.now(); const rank = (k) => (k === "ais" ? 3 : k === "manual" ? 1 : 2); for (let i = pts.length - 1; i >= 0; i--) { const q = pts[i]; if ((L && !L.place(q.lat, q.lon)) || q.ts > nowT + 10 * 60000) pts.splice(i, 1); } pts.sort((a, b) => a.ts - b.ts || rank(a.kind) - rank(b.kind)); } /* 4.34.7 · as lastPosition: no impossible places, nothing dated ahead, AIS last at the same instant */
    const out = []; for (const p of pts) { if (f0 != null && p.ts < f0) continue; if (t0 != null && p.ts > t0) continue; const last = out[out.length - 1]; if (last && p.ts - last.ts < 10 * 60000 && gcNm([last.lat, last.lon], [p.lat, p.lon]) < 1) { out[out.length - 1] = p; continue; } out.push(p); }
    const lim = opt.limit || 400; const trimmed = out.length > lim ? out.slice(out.length - lim) : out;
    return trimmed.map((p) => ({ lat: r4(p.lat), lon: r4(p.lon), ts: new Date(p.ts).toISOString(), sog: p.sog, cog: p.cog, kind: p.kind }));
  }
  // planPosition(ps, vesselId, voyage | voyageId | null, nowIso, { position, speed }) → where she should be now, dead-reckoned
  // along the planned route from the last known point (a position report, a noon report, or the departure from the last port)
  function planPosition(ps, vesselId, voyageRef, nowIso, opt) {
    opt = opt || {}; const now = tOf(nowIso) || Date.now(); const vessel = (ps.vessels || []).find((v) => v.id === vesselId) || {};
    const plan = voyagePlan(ps, vesselId, voyageRef, { now }); if (!plan) return null;
    const known = []; const live = opt.position || (ps.positions || {})[vessel.imo]; if (live && live.lat != null && live.lon != null && isFinite(+live.lat) && isFinite(+live.lon) && tOf(live.ts) != null && (Math.abs(+live.lat) + Math.abs(+live.lon) > 0)) known.push({ kind: live.source === "ais" ? "ais" : "manual", ts: tOf(live.ts), lat: +live.lat, lon: +live.lon, sog: live.sog != null ? +live.sog : null });
    const tr = track(ps, vesselId, null, { limit: 1 }); if (tr.length) { const q = tr[tr.length - 1]; known.push({ kind: q.kind, ts: tOf(q.ts), lat: q.lat, lon: q.lon, sog: q.sog }); }
    const curLeg = plan.currentLeg >= 0 ? plan.legs[plan.currentLeg] : null;
    const portPt = (pp) => (pp && pp.lat != null ? { lat: pp.lat, lon: pp.lon } : null);
    const base = { voyageId: plan.voyageId, plan, from: plan.from, to: plan.to, fromPortId: curLeg ? curLeg.fromPortId : null, toPortId: curLeg ? curLeg.toPortId : (plan.nextPort ? plan.nextPort.id : null), legIndex: plan.currentLeg, etd: plan.etd, eta: plan.eta, speed: curLeg ? curLeg.speed : null, distanceSailedNm: plan.sailedNm, distanceToGoNm: Math.max(0, plan.totalNm - plan.sailedNm), toNextPortNm: null, basis: "plan", confidence: "low", anchor: null, ageMinutes: null, arrived: false, inPort: !!plan.inPort };
    // alongside or at anchor in a port: she is where the port is
    if (plan.inPort) { const pp = portPt(plan.inPort); if (pp) return { ...base, lat: pp.lat, lon: pp.lon, speed: 0, basis: "port", confidence: "high", anchor: { kind: "port", ts: plan.inPort.ata, name: plan.inPort.name }, ageMinutes: plan.inPort.ata ? Math.round((now - tOf(plan.inPort.ata)) / 60000) : null, toNextPortNm: null }; }
    if (!curLeg) { // not under way on a planned leg: before departure she sits in the first port, after the last arrival in the last port
      const first = plan.ports.find((p) => p.lat != null), last = [...plan.ports].reverse().find((p) => p.lat != null); const dep0 = first ? tOf(first.etd || first.atd) : null;
      const at = first && (dep0 == null || now < dep0) ? first : last; const pp = portPt(at); if (!pp) return null;
      return { ...base, lat: pp.lat, lon: pp.lon, speed: 0, basis: "port", confidence: "medium", anchor: { kind: "port", ts: at === first ? (first.eta || first.ata) : (last.ata || last.eta), name: at.name }, arrived: at === last, toNextPortNm: 0 };
    }
    const fromPort = plan.ports.find((p) => p.id === curLeg.fromPortId), toPort = plan.ports.find((p) => p.id === curLeg.toPortId);
    const depTs = tOf(curLeg.departed); const line = curLeg.line && curLeg.line.length > 1 ? curLeg.line : [[fromPort.lat, fromPort.lon], [toPort.lat, toPort.lon]];
    // the anchor: the newest known point after departure, else the departure itself
    let anchor = known.filter((k) => depTs == null || k.ts >= depTs - 3600000).sort((a, b) => b.ts - a.ts)[0] || null;
    if (!anchor) { if (depTs == null) return null; anchor = { kind: "port", ts: depTs, lat: fromPort.lat, lon: fromPort.lon, name: fromPort.name }; }
    const speed = +opt.speed || (anchor.sog != null && anchor.sog > 3 ? anchor.sog : null) || curLeg.speed || 12;
    // start on the route: the vertex nearest to the anchor, then the remaining polyline to the next port
    // 4.31.22 · from a reported position: the sea route from there to the next port (the distance to go of a noon report)
    let path = null; if (anchor.kind !== "port" && SRX() && SRX().ready()) { const rt = routeLine({ lat: anchor.lat, lon: anchor.lon }, toPort, curLeg.routeVia || null, (ps.settings && ps.settings.routing) || null); if (rt.sea && rt.line.length > 1) path = rt.line; }
    if (!path) { let startIdx = 0; if (anchor.kind !== "port") { let bd = 1e12; for (let i = 0; i < line.length; i++) { const d = gcNm(line[i], [anchor.lat, anchor.lon]); if (d < bd) { bd = d; startIdx = i; } } } path = anchor.kind === "port" ? line.slice() : [[anchor.lat, anchor.lon], ...line.slice(startIdx + 1)]; }
    let remaining = 0; for (let i = 0; i < path.length - 1; i++) remaining += gcNm(path[i], path[i + 1]);
    const hours = Math.max(0, (now - anchor.ts) / 3600000); const target = hours * speed;
    const ageMinutes = Math.round((now - anchor.ts) / 60000);
    const onwardNm = plan.legs.filter((l) => l.index > curLeg.index).reduce((k, l) => k + l.distanceNm, 0);
    if (target >= remaining) { // she should have arrived
      const etaEst = anchor.ts + remaining / speed * 3600000;
      return { ...base, lat: toPort.lat, lon: toPort.lon, speed: 0, arrived: true, toNextPortNm: 0, distanceToGoNm: Math.round(onwardNm), etaEstimated: new Date(etaEst).toISOString(), anchor: { kind: anchor.kind, ts: new Date(anchor.ts).toISOString(), lat: anchor.lat, lon: anchor.lon, name: anchor.name || null }, ageMinutes, basis: anchor.kind === "port" ? "plan" : "track", confidence: ageMinutes < 360 ? "medium" : "low" };
    }
    let acc = 0, lat = path[0][0], lon = path[0][1], cog = null;
    for (let i = 0; i < path.length - 1; i++) { const seg = gcNm(path[i], path[i + 1]); if (acc + seg >= target) { const f = seg ? (target - acc) / seg : 0; lat = path[i][0] + (path[i + 1][0] - path[i][0]) * f; lon = path[i][1] + (path[i + 1][1] - path[i][1]) * f; const dy = path[i + 1][0] - path[i][0], dx = (path[i + 1][1] - path[i][1]) * Math.cos(path[i][0] * RAD); cog = (Math.atan2(dx, dy) / RAD + 360) % 360; break; } acc += seg; }
    lon = ((lon + 540) % 360 + 360) % 360 - 180;
    const toNext = remaining - target; const etaEst = now + toNext / speed * 3600000;
    return { ...base, lat: r4(lat), lon: r4(lon), cog: cog != null ? Math.round(cog) : null, speed, toNextPortNm: Math.round(toNext), distanceToGoNm: Math.round(toNext + onwardNm), distanceSailedNm: Math.round(plan.sailedNm + (curLeg.distanceNm - toNext)), etaEstimated: new Date(etaEst).toISOString(), eta: plan.eta || new Date(etaEst).toISOString(), anchor: { kind: anchor.kind, ts: new Date(anchor.ts).toISOString(), lat: anchor.lat, lon: anchor.lon, name: anchor.name || null }, ageMinutes, basis: anchor.kind === "port" ? "plan" : "track", confidence: ageMinutes < 360 ? "high" : ageMinutes < 1440 ? "medium" : "low" };
  }
  const route = { line: routeLine, via: suggestVia, regionOf, waypoints: WPT, gcNm };

  // ---------- 4.17 · a fixture recap pasted as free text → the fixture form's fields. Nothing is saved here: the caller fills the
  // form, marks what was recognised, and the user confirms. ctx: { vessels:[{id,name,imo}], counterparties:[{id,name,short,role}],
  // ports:[{name}], cpForms:[…], today:"YYYY-MM-DD" }. Returns { values:{k:v}, found:[{k,label,text}], unknown:[text], notes }
  const RMONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  function recapDate(s, today, hint) {
    s = String(s || ""); const t = today || isoDate(Date.now()); const y0 = +t.slice(0, 4), m0 = +t.slice(5, 7);
    const time = (rest) => { const mm = String(rest || "").match(/\b([01]?\d|2[0-3])[:.h]([0-5]\d)\b|\b([01]\d|2[0-3])([0-5]\d)\s*(?:hrs?\b|lt\b|utc|gmt|z\b|local|london|ldn|sgt|cet|est\b|edt)/i); return mm ? String(mm[1] || mm[3]).padStart(2, "0") + ":" + (mm[2] || mm[4]) : null; };
    let y, m, d, rest = s, mm;
    if ((mm = s.match(/\b(20\d\d)-(\d\d)-(\d\d)(?:[T ](\d\d):(\d\d))?/))) { y = +mm[1]; m = +mm[2]; d = +mm[3]; if (mm[4]) return mm[1] + "-" + mm[2] + "-" + mm[3] + "T" + mm[4] + ":" + mm[5]; rest = s.slice(mm.index + mm[0].length); }
    else if ((mm = s.match(/\b(\d{1,2})(?:st|nd|rd|th)?(?:\s*[-/–]\s*\d{1,2}(?:st|nd|rd|th)?)?[\s.\-/]*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?(?:[\s.\-/,]*(20\d\d|\d\d)(?!\d|:))?/i))) { d = +mm[1]; m = RMONTHS.indexOf(mm[2].toLowerCase()) + 1; y = mm[3] ? (mm[3].length === 2 ? 2000 + +mm[3] : +mm[3]) : null; rest = s.slice(mm.index + mm[0].length); }
    else if ((mm = s.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:[\s,]+(20\d\d))?/i))) { m = RMONTHS.indexOf(mm[1].toLowerCase()) + 1; d = +mm[2]; y = mm[3] ? +mm[3] : null; rest = s.slice(mm.index + mm[0].length); }
    else if ((mm = s.match(/\b(\d{1,2})[./](\d{1,2})[./](20\d\d|\d\d)\b/))) { d = +mm[1]; m = +mm[2]; y = mm[3].length === 2 ? 2000 + +mm[3] : +mm[3]; rest = s.slice(mm.index + mm[0].length); }
    else return null;
    if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
    if (!y) { y = y0; if (m < m0 - 2) y++; }
    const day = y + "-" + String(m).padStart(2, "0") + "-" + String(d).padStart(2, "0"); const tm = time(rest) || time(s.replace(rest, "")) || (hint === "end" ? "23:59" : hint === "start" ? "00:01" : null);
    return tm ? day + "T" + tm : day;
  }
  function recapMoney(s) { const mm = String(s || "").match(/(?:(usd|us\$|\$|eur|€|gbp|£|jpy|sgd|nok|dkk|cny)\s*)?(\d{1,3}(?:[,\s]\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)\s*(k|m|mio|million)?\b\s*(usd|eur|gbp)?/i); if (!mm) return null; let n = +mm[2].replace(/[,\s]/g, ""); const suf = (mm[3] || "").toLowerCase(); if (suf === "k") n *= 1000; else if (suf) n *= 1e6; const c = (mm[1] || mm[4] || "").toLowerCase(); const ccy = /usd|\$/.test(c) ? "USD" : /eur|€/.test(c) ? "EUR" : /gbp|£/.test(c) ? "GBP" : c ? c.toUpperCase() : null; return { amount: r2(n), currency: ccy, at: mm.index, text: mm[0] }; }
  function parseRecap(text, ctx) {
    ctx = ctx || {}; const raw = String(text || ""); const t = raw.replace(/\r/g, ""); const low = t.toLowerCase(); const values = {}, found = [], unknown = [];
    const lines = t.split(/\n|;\s+(?=[A-Z])/).map((s) => s.trim()).filter(Boolean);
    const lineOf = (re) => lines.find((l) => re.test(l)) || null; const after = (l, re) => (l ? l.replace(re, "").replace(/^[\s:.\-–=]+/, "").trim() : "");
    const set = (k, v, label, txt) => { if (v == null || v === "" || (typeof v === "number" && isNaN(v))) return; values[k] = v; found.push({ k, label, text: String(txt == null ? v : txt).slice(0, 80) }); };
    const byName = (list, s, minLen) => { const q = String(s || "").toLowerCase(); if (!q) return null; let best = null; for (const x of list || []) for (const n of [x.name, x.short].filter(Boolean)) { const nl = n.toLowerCase(); if (nl.length >= (minLen || 3) && (q.includes(nl) || (nl.includes(q) && q.length >= 4))) if (!best || nl.length > best.n) best = { x, n: nl.length }; } return best ? best.x : null; };
    // vessel: a known name anywhere in the recap (longest first), or her IMO
    const imo = low.match(/\bimo\s*(?:no\.?|number)?\s*[:#]?\s*(\d{7})\b/); let v = imo ? (ctx.vessels || []).find((x) => String(x.imo) === imo[1]) : null;
    if (!v) { const vl = lineOf(/^(?:m\/?v|mv|vessel|vsl|ship)\b/i); v = byName(ctx.vessels, vl ? after(vl, /^(?:m\/?v|mv|vessel|vsl|ship)\b\.?/i) : null, 3) || byName(ctx.vessels, t, 4); }
    if (v) set("vesselId", v.id, "Vessel", v.name);
    // kind
    const kind = /\bbare\s*boat|\bbbc\b|\bbarecon/i.test(t) ? "bareboat" : /\b(?:tct|t\/c|tc|time\s*charter|period|trip\s*time|nype|baltime|shelltime)\b/i.test(t) ? "tc" : /\b(?:voyage\s*charter|vc|gencon|asbatankvoy|synacomex|bpvoy|pmt|per\s*mt|fio[st]?|frt|freight)\b/i.test(t) ? "voyage" : null;
    if (kind) set("kind", kind, "Kind", kind === "tc" ? "Time charter" : kind === "voyage" ? "Voyage charter" : "Bareboat");
    // parties
    const chl = lineOf(/^(?:chrtrs?|chrts?|chtrs?|chts|charterers?|charts|chrs|acct|a\/c|account)\b/i); const chs = chl ? after(chl, /^(?:chrtrs?|chrts?|chtrs?|chts|charterers?|charts|chrs|acct|a\/c|account)\b\.?/i) : null;
    const ch = byName((ctx.counterparties || []).filter((c) => !c.role || ["charterer", "owner", "customer"].includes(c.role)), chs || "", 3) || (chs ? null : byName((ctx.counterparties || []).filter((c) => c.role === "charterer"), t, 4));
    if (ch) set("chartererCpId", ch.id, "Charterer", ch.name); else if (chs) unknown.push("Charterer “" + chs.slice(0, 60) + "” is not among your counterparties");
    const brl = lineOf(/^(?:brokers?|brkrs?|bkrs?|via)\b/i); const brs = brl ? after(brl, /^(?:brokers?|brkrs?|bkrs?|via)\b\.?/i) : null;
    const br = brs ? byName(ctx.counterparties, brs, 3) : null; if (br) set("brokerCpId", br.id, "Broker", br.name); else if (brs) unknown.push("Broker “" + brs.slice(0, 60) + "” is not among your counterparties");
    // charter party form and date
    const norm = (s) => s.toLowerCase().replace(/[\s\-]/g, ""); const form = (ctx.cpForms || []).filter((f) => f !== "Other").find((f) => norm(t).includes(norm(f))) || ((ctx.cpForms || []).filter((f) => f !== "Other").find((f) => norm(t).includes(norm(f.split(" ")[0])) && norm(f).length > 4) || null);
    if (form) set("cpForm", form, "Form", form);
    const cpl = lineOf(/\b(?:c\/?p\s*dated?|cp\s*date|charter\s*party\s*dated?|dated)\b/i); const cpd = cpl ? recapDate(after(cpl, /^.*?\b(?:dated?|date)\b/i), ctx.today) : null; if (cpd) set("cpDate", cpd.slice(0, 10), "CP date", cpd.slice(0, 10));
    // rate: the hire / freight line, or the first money with a per-day / per-mt / lumpsum marker
    const rl = lineOf(/^(?:hire|rate|frt|freight|lumpsum|l\/s)\b/i) || lineOf(/\b(?:pdpr|p\.?d\.?p\.?r|per\s*day|\/day|daily|pmt|per\s*mt|\/mt|lumpsum|l\/?s)\b/i);
    if (rl) { const mon = recapMoney(after(rl, /^(?:hire|rate|frt|freight)\b/i)); if (mon) { set("rate", mon.amount, "Rate", mon.text.trim()); if (mon.currency) set("currency", mon.currency, "Currency", mon.currency); const unit = /\b(?:pmt|per\s*mt|\/mt|per\s*metric|fio)/i.test(rl) ? "mt" : /\b(?:lumpsum|l\/?s|lump\s*sum)\b/i.test(rl) ? "lumpsum" : /\b(?:pdpr|p\.?d\.?p\.?r|per\s*day|\/day|daily|pd)\b/i.test(rl) ? "day" : null; if (unit) set("rateUnit", unit, "Per", unit === "mt" ? "MT" : unit === "day" ? "Day" : "Lumpsum"); } }
    // commissions
    const pct = (re) => { const mm = t.match(re); return mm ? +String(mm[1] || mm[2]).replace(",", ".") : null; };
    const adc = pct(/(\d+(?:[.,]\d+)?)\s*%\s*(?:add(?:ress)?\.?\s*com|adcom|addcom|adc\b)|(?:add(?:ress)?\.?\s*comm?(?:ission)?|adcom|addcomm?)\s*[:\-]?\s*(\d+(?:[.,]\d+)?)\s*%?/i); if (adc != null) set("addressCommission", adc, "Address commission", adc + "%");
    const brk = pct(/(\d+(?:[.,]\d+)?)\s*%\s*(?:brokerage|brkg|bkge|brk|comm(?:ission)?\s+(?:to|on)|to\s+[A-Z])|(?:brokerage|brkg|bkge)\s*[:\-]?\s*(\d+(?:[.,]\d+)?)\s*%?/i); if (brk != null) set("brokerage", brk, "Brokerage", brk + "%");
    // delivery / redelivery: place (a known port, else the words) and the first date on the line
    const portIn = (s) => { let best = null; const sl = String(s || "").toLowerCase(); for (const p of ctx.ports || []) { const n = p.name.toLowerCase(); const i = sl.indexOf(n); if (i >= 0 && (!best || n.length > best.n.length || (n.length === best.n.length && i < best.i))) best = { p, n, i }; } return best ? best.p.name : null; };
    const place = (s) => portIn(s) || (String(s || "").replace(/\b(?:dlosp|aps|on\s+arrival|pilot\s+station|psp|atdnshinc|dop|ppt|basis)\b/gi, "").replace(/\b\d{1,2}(?:st|nd|rd|th)?\b.*$/, "").replace(/[,(].*$/, "").trim().slice(0, 40) || null);
    const dl = lineOf(/^(?:del(?:ivery)?|dely|dlvy)\b(?!.*\bredel)/i); if (dl) { const s = after(dl, /^(?:del(?:ivery)?|dely|dlvy)\b\.?/i); const p = place(s); if (p) set("delPort", p, "Delivery port", p); const dt = recapDate(s, ctx.today, "start"); if (dt) set("delAt", dt.length === 10 ? dt + "T00:01" : dt, "Delivery", dt); }
    const rdl = lineOf(/^(?:re-?del(?:ivery)?|redely|redlvy)\b/i); if (rdl) { const s = after(rdl, /^(?:re-?del(?:ivery)?|redely|redlvy)\b\.?/i); const p = place(s); if (p) set("redPort", p, "Redelivery port", p); const dt = recapDate(s, ctx.today, "end"); if (dt) { set("redAt", dt.length === 10 ? dt + "T23:59" : dt, "Redelivery", dt); set("redEst", !/\b(?:on|at)\s+\d{1,2}[:.]?\d\d|\bexact\b/i.test(s), "Redelivery estimated", "estimate"); } }
    const lcl = lineOf(/^(?:laycan|l\/c|lc|layday)\b/i); if (lcl) { const s = after(lcl, /^(?:laycan|l\/c|lc|layday)s?\b\.?/i); const mm = s.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s*[-/–]\s*(\d{1,2})(?:st|nd|rd|th)?\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i); const a = recapDate(s, ctx.today); if (a) { set("laycanFrom", a.slice(0, 10), "Laycan from", a.slice(0, 10)); const b = mm ? recapDate(mm[2] + " " + mm[3], ctx.today) : null; if (b) set("laycanTo", b.slice(0, 10), "Laycan to", b.slice(0, 10)); if (!values.delAt && kind !== "voyage") set("delAt", a.slice(0, 10) + "T00:01", "Delivery", a.slice(0, 10)); } }
    // duration: "abt 50/55 days", "min 4 max 6 months", "11-13 months"
    const dur = t.match(/(?:min(?:imum)?\.?\s*)?(\d{1,3})\s*(?:[-/–]|to|max(?:imum)?\.?)\s*(\d{1,3})\s*(days?|months?|mos?)\b/i) || t.match(/\babt\.?\s*(\d{1,3})\s*(days?|months?|mos?)\b/i);
    if (dur) { const mo = /^mo/i.test(dur[3] || dur[2]); const k = mo ? 30.4375 : 1; const a = +dur[1], b = dur[3] ? +dur[2] : +dur[1]; set("minDays", Math.round(a * k), "Minimum duration", Math.round(a * k) + " days"); set("maxDays", Math.round(b * k), "Maximum duration", Math.round(b * k) + " days"); }
    // ballast bonus, CVE, hire payment
    const bbl = lineOf(/\b(?:ballast\s*bonus|gbb|bb)\b/i); if (bbl) { const mon = recapMoney(bbl.replace(/^.*?\b(?:ballast\s*bonus|gbb|bb)\b/i, "")); if (mon) set("ballastBonus", mon.amount, "Ballast bonus", mon.text.trim()); }
    const cvl = lineOf(/\b(?:c\/?v\/?e|cve|ilohc|communications)\b/i); if (cvl) { const mon = recapMoney(cvl.replace(/^.*?\b(?:c\/?v\/?e|cve)\b/i, "")); if (mon && mon.amount < 20000) set("cve", mon.amount, "CVE per month", mon.text.trim()); }
    const hp = t.match(/\b(?:hire\s*)?(?:paid|payable)?\s*every\s*(\d{1,3})\s*days\b[^.\n]*/i); if (hp) { set("hireInterval", hp[1], "Hire paid every", hp[1] + " days"); set("hireInAdvance", !/\barrears?\b/i.test(hp[0]), "Hire in advance", /\barrears?\b/i.test(hp[0]) ? "in arrears" : "in advance"); }
    // speed and consumption: "laden abt 13.5 kn on 28 mt", "ballast 14 kts / 26 mt"
    const sc = (cond) => { const l = lines.find((x) => new RegExp("\\b" + cond + "\\b", "i").test(x) && /\b(?:kn|kts?|knots)\b/i.test(x)); if (!l) return null; const seg = l.slice(l.toLowerCase().indexOf(cond)); const sp = seg.match(/(\d{1,2}(?:[.,]\d)?)\s*(?:kn|kts?|knots)\b/i); const co = seg.match(/(\d{1,3}(?:[.,]\d)?)\s*(?:mt|t)\b/i); return { sp: sp ? +sp[1].replace(",", ".") : null, co: co ? +co[1].replace(",", ".") : null, text: seg.slice(0, 60) }; };
    const lad = sc("laden"), bal = sc("ballast"); if (lad) { if (lad.sp) set("wSpeedLaden", lad.sp, "Speed laden", lad.sp + " kn"); if (lad.co) set("wConsLaden", lad.co, "Consumption laden", lad.co + " MT/day"); } if (bal) { if (bal.sp) set("wSpeedBallast", bal.sp, "Speed ballast", bal.sp + " kn"); if (bal.co) set("wConsBallast", bal.co, "Consumption ballast", bal.co + " MT/day"); }
    const prt = t.match(/\b(?:in\s*)?port\s*(?:idle|working)?\s*[:\-]?\s*(?:abt\.?\s*)?(\d{1,2}(?:[.,]\d)?)\s*(?:mt|t)\b/i); if (prt) set("wConsPort", +prt[1].replace(",", "."), "Consumption in port", prt[1] + " MT/day");
    // bunkers on delivery / redelivery: "BOD abt 600 mt VLSFO @ 580 / 80 mt LSMGO @ 750"
    const bunk = (re) => { const l = lineOf(re); if (!l) return null; const out = []; const rx = /(\d{2,5}(?:[.,]\d+)?)\s*(?:mt|t)?\s*(vlsfo|lsmgo|mgo|hsfo|ifo|mdo|lsfo|ulsfo)\b(?:\s*(?:@|at)\s*(?:usd\s*|\$\s*)?(\d{2,4}(?:[.,]\d+)?))?/gi; let mm; while ((mm = rx.exec(l))) out.push(mm[2].toUpperCase() + " " + mm[1].replace(",", "") + (mm[3] ? "@" + mm[3].replace(",", "") : "")); return out.length ? out.join("\n") : null; };
    const bod = bunk(/^(?:bod|bunkers?\s*on\s*del)/i); if (bod) set("bod", bod, "Bunkers on delivery", bod.replace(/\n/g, ", ")); const bor = bunk(/^(?:bor|bunkers?\s*on\s*re-?del)/i); if (bor) set("bor", bor, "Bunkers on redelivery", bor.replace(/\n/g, ", "));
    // voyage cargo: quantity, commodity, load / discharge, terms, demurrage
    if (kind === "voyage" || values.rateUnit === "mt") { const cq = t.match(/(\d{1,3}(?:[,\s]\d{3})+|\d{4,6})\s*(mt|cbm)\b(?:\s*\d{1,2}\s*%\s*(?:moloo|mol|more\s*or\s*less)\w*)?\s*(?:of\s+)?([a-z][a-z \-]{2,30}?)(?=\s*(?:\n|,|;|$|\bin\b|\bbulk\b))/i); if (cq) { set("qty", +cq[1].replace(/[,\s]/g, ""), "Quantity", cq[1] + " " + cq[2]); set("unit", cq[2].toUpperCase(), "Unit", cq[2].toUpperCase()); set("commodity", cq[3].trim().replace(/^\w/, (c) => c.toUpperCase()), "Commodity", cq[3].trim()); }
      const ports = (re) => { const l = lineOf(re); if (!l) return null; const s = after(l, re); const ks = (ctx.ports || []).filter((p) => s.toLowerCase().includes(p.name.toLowerCase())).map((p) => p.name); return ks.length ? ks.join(", ") : s.split(/[\/,]| or /i).map((x) => x.replace(/\b\d.*$/, "").trim()).filter(Boolean).slice(0, 3).join(", ") || null; };
      const lp = ports(/^(?:load(?:ing)?(?:\s*port)?s?|lp|pol)\b\.?/i); if (lp) set("loadPorts", lp, "Load port(s)", lp); const dp = ports(/^(?:disch(?:arge|arging)?(?:\s*port)?s?|dp|pod)\b\.?/i); if (dp) set("dischargePorts", dp, "Discharge port(s)", dp);
      const term = ["SHEX EIU", "SHEX UU", "SHINC", "SHEX", "FHEX", "WWD"].find((x) => new RegExp("\\b" + x.replace(" ", "\\s*") + "\\b", "i").test(t)); if (term) set("terms", term, "Laytime terms", term);
      const dem = t.match(/\b(?:dem(?:urrage)?)\s*[:\-]?\s*((?:usd|\$)?\s*[\d,.]+\s*k?)/i); if (dem) { const mon = recapMoney(dem[1]); if (mon) { set("demurrageRate", mon.amount, "Demurrage per day", mon.text.trim()); if (/\bdhd\b|half\s*despatch/i.test(t)) set("despatchRate", r2(mon.amount / 2), "Despatch per day", "DHD"); } } }
    // status and subjects
    const subs = /\b(?:on\s*subs|subjects?|subs?\s+(?:stem|details|rcvrs|shippers|board|to\s+be\s+lifted|latest|by))\b/i.test(t) && !/\b(?:all\s*)?subs?\s*(?:lifted|clean)\b|\bclean\s*fixed\b|\bfully\s*fixed\b/i.test(t);
    set("status", subs ? "on-subs" : /\b(?:clean\s*fixed|fully\s*fixed|subs\s*lifted|fixed)\b/i.test(t) ? "fixed" : null, "Status", subs ? "On subjects" : "Fixed");
    if (subs) { const sl = lineOf(/\bsubs?(?:jects?)?\b.*\b(?:by|until|latest|lifted)\b/i); const sd = sl ? recapDate(sl.replace(/^.*?\b(?:by|until|latest)\b/i, ""), ctx.today) : null; if (sd) set("subsDeadline", sd.length === 10 ? sd + "T17:00" : sd, "Subjects by", sd); }
    return { values, found, unknown, kind, notes: raw.trim() };
  }

  // ---------- 4.31.10 · coordinates as mariners type them, and the exact port search
  // parseCoord(text | number, "lat" | "lon") → { ok, empty, value (decimal degrees, 6 dp), text ("24°19.80′ N"), error }
  // decimal degrees (24.33, -24.33, 24.33N, N24.33, 056.40E), degrees + decimal minutes (24°19.8'N, 24 19.8 N, 24-19.8N, 056-24E),
  // degrees minutes seconds (24°19'48"N, 24 19 48 N, 24-19-48N), comma decimals (24,33). A hyphen between numbers separates,
  // a leading one is the sign; S and W are negative; a sign that contradicts the hemisphere letter is refused.
  const COORD_NUM = /^\d+(?:\.\d+)?$/;
  // every typographic mark a master's message carries: ' ’ ‘ ′ ` ´ for minutes, " ” “ ″ '' for seconds, ° º ˚ DEG D for degrees; ends trimmed of commas
  const coordNorm = (t) => String(t).toUpperCase().replace(/[′’‘´`]/g, "'").replace(/[″“”]/g, '"').replace(/''/g, '"').replace(/[º˚]/g, "°").replace(/[−–—]/g, "-").replace(/\s*MIN(?:UTES?|S)?\.?\s*/g, "'").replace(/\s*SEC(?:ONDS?|S)?\.?\s*/g, '"').replace(/\s*DEG(?:REES?|S)?\.?\s*/g, "°").replace(/(\d)\s*D(?![A-Z])/g, "$1°").replace(/^[\s,;]+|[\s,;]+$/g, "");
  // parseCoordPair(text) → { ok, lat, lon (parseCoord results), latText, lonText, error } when the text holds BOTH coordinates
  // ("01°49.00’N ,104°42.00E", "01-49.0N 104-42.0E", "1.8167, 104.7"), else null. With letters N/S is the latitude whichever comes
  // first; without letters the first is the latitude. Without letters a pair needs a ; / separator, a comma beside a decimal point,
  // or two plain numbers the first of them decimal (so "24 19.8" stays degrees and minutes).
  function parseCoordPair(input) {
    const s0 = input == null ? "" : String(input).trim(); if (!s0) return null; const s = coordNorm(s0); if (!s) return null;
    const letters = [...s.matchAll(/[A-Z]/g)]; let a = null, b = null;
    if (letters.length) { if (letters.length !== 2 || letters.some((m) => !"NSEW".includes(m[0]))) return null; const k1 = letters[0][0], k2 = letters[1][0]; if ("NS".includes(k1) === "NS".includes(k2)) return null;
      const i1 = letters[0].index, i2 = letters[1].index; const cut = i1 === 0 ? i2 : i1 + 1; a = s.slice(0, cut); b = s.slice(cut); }
    else { let bits = null; if (/[;\/]/.test(s)) bits = s.split(/\s*[;\/]\s*/); else if (/,/.test(s) && (/\./.test(s) || /,\s/.test(s))) bits = s.split(/\s*,\s*/); else { const t = s.split(/\s+/); if (t.length === 2 && /^[-+]?\d+\.\d+$/.test(t[0]) && /^[-+]?\d+(?:\.\d+)?$/.test(t[1])) bits = t; }
      if (!bits || bits.length !== 2) return null; a = bits[0]; b = bits[1]; }
    const trim = (x) => x.replace(/^[\s,;\/]+|[\s,;\/]+$/g, ""); a = trim(a); b = trim(b); if (!a || !b) return null;
    const aIsLon = /[EW]/.test(a); const latText = aIsLon ? b : a, lonText = aIsLon ? a : b; const lat = parseCoord(latText, "lat"), lon = parseCoord(lonText, "lon");
    return { ok: lat.ok && lon.ok && !lat.empty && !lon.empty, lat, lon, latText, lonText, error: !lat.ok ? lat.error : !lon.ok ? lon.error : null };
  }
  function parseCoord(input, axis) {
    axis = axis === "lon" ? "lon" : "lat"; const max = axis === "lat" ? 90 : 180; const what = axis === "lat" ? "latitude" : "longitude";
    const s0 = input == null ? "" : String(input).trim();
    const bad = (why) => ({ ok: false, empty: false, value: null, text: "", error: "Not a " + what + ": " + s0 + (why ? " — " + why : "") });
    const good = (v) => { v = Math.round(v * 1e6) / 1e6; if (Object.is(v, -0)) v = 0; return { ok: true, empty: false, value: v, text: fmtCoord(v, axis), error: null }; };
    if (!s0) return { ok: true, empty: true, value: null, text: "", error: null };
    if (typeof input === "number") return isFinite(input) && Math.abs(input) <= max ? good(input) : bad("beyond ±" + max + "°");
    let s = coordNorm(s0);
    const letters = s.match(/[A-Z]/g) || []; const hemis = axis === "lat" ? "NS" : "EW";
    if (letters.some((L) => !hemis.includes(L))) return bad(letters.some((L) => (axis === "lat" ? "EW" : "NS").includes(L)) ? "that is a " + (axis === "lat" ? "longitude" : "latitude") + " hemisphere" : "unexpected letters");
    if (letters.length > 1) return bad("more than one hemisphere");
    const hemi = letters[0] || null;
    if (hemi) { const at = s.indexOf(hemi); const before = s.slice(0, at).trim(), after = s.slice(at + 1).trim(); if (before && after) return bad("the hemisphere goes first or last"); s = (before || after).trim(); }
    let sign = 0; if (/^-/.test(s)) { sign = -1; s = s.slice(1).trim(); } else if (/^\+/.test(s)) { sign = 1; s = s.slice(1).trim(); }
    if (hemi && sign) { const neg = hemi === "S" || hemi === "W"; if ((sign < 0) !== neg) return bad("the sign and " + hemi + " disagree"); }
    s = s.replace(/(\d),(\d)/g, "$1.$2");
    const parts = s.split(/\s*[°'"]\s*|\s*-\s*|\s+/).filter((x) => x !== "");
    if (!parts.length || parts.length > 3 || parts.some((x) => !COORD_NUM.test(x))) return bad();
    const n = parts.map(Number); let v = n[0];
    if (parts.length >= 2) { if (!Number.isInteger(n[0]) || /\./.test(parts[0])) return bad("degrees with minutes are whole"); if (n[1] >= 60) return bad("minutes under 60"); v += n[1] / 60; }
    if (parts.length === 3) { if (/\./.test(parts[1])) return bad("minutes with seconds are whole"); if (n[2] >= 60) return bad("seconds under 60"); v += n[2] / 3600; }
    if (v > max) return bad("beyond ±" + max + "°");
    const neg = hemi ? hemi === "S" || hemi === "W" : sign < 0;
    return good(neg ? -v : v);
  }
  // fmtCoord(-24.33, "lat") → "24°19.80′ S"; fmtCoord(1.816667, "lat") → "01°49.00′ N"; fmtCoord(56.4, "lon") → "056°24.00′ E" (degrees padded as a master writes them)
  function fmtCoord(v, axis) {
    if (v == null || v === "" || !isFinite(+v)) return ""; v = +v; const a = Math.abs(v);
    let d = Math.floor(a), m = Math.round((a - d) * 60 * 100) / 100; if (m >= 60) { d += 1; m = 0; }
    const h = axis === "lon" ? (v < 0 ? "W" : "E") : (v < 0 ? "S" : "N");
    return String(d).padStart(axis === "lon" ? 3 : 2, "0") + "°" + (m < 10 ? "0" : "") + m.toFixed(2) + "′ " + h;
  }
  // coordHint(text, axis) → "= 24°19.80′ N · 24.3300" | the error | ""
  function coordHint(input, axis) { const r = parseCoord(input, axis); if (r.empty) return { text: "", bad: false }; if (!r.ok) { const pr = parseCoordPair(input); if (pr && pr.ok) return { text: "= " + pr.lat.text + " · " + pr.lat.value.toFixed(4) + "  and  " + pr.lon.text + " · " + pr.lon.value.toFixed(4) + " — both coordinates; they go into Latitude and Longitude", bad: false, pair: pr }; return { text: r.error, bad: true }; } return { text: "= " + r.text + " · " + r.value.toFixed(4), bad: false }; }
  // ports: { name, country, lat, lon, region, id? }; names compared without case, accents or punctuation
  const normName = (s) => String(s == null ? "" : s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const bareName = (s) => normName(String(s == null ? "" : s).replace(/\s*\(.*\)\s*$/, ""));
  // searchPorts(ports, query, { country, limit }) → exact name first, then the name before a bracket, then prefix, then a word
  // starting with it, then contains; a trailing ", XX" or "(XX)" or opt.country keeps one country
  function searchPorts(ports, query, opt) {
    opt = opt || {}; let q = String(query == null ? "" : query).trim(); let cc = opt.country ? String(opt.country).toUpperCase() : null;
    const m = q.match(/^(.*?)(?:\s*,\s*|\s+\()([A-Za-z]{2})\)?$/); if (m && m[1].trim() && !cc) { cc = m[2].toUpperCase(); q = m[1].trim(); }
    const nq = normName(q); const out = [];
    for (const p of ports || []) { if (!p || !p.name) continue; if (cc && String(p.country || "").toUpperCase() !== cc) continue; if (!nq) { if (cc) out.push({ p, s: 5 }); continue; }
      const n = normName(p.name), b = bareName(p.name); let s = -1;
      if (n === nq) s = 0; else if (b === nq) s = 1; else if (n.startsWith(nq)) s = 2; else if ((" " + n).includes(" " + nq)) s = 3; else if (n.includes(nq)) s = 4;
      // 4.32.2 · a port's other names (aliases: "Muscat" for Mina Al Fahal, "RT" for Ras Tanura, "Yanbu'" for Yanbu) match like the name, one step behind it
      if (s !== 0 && Array.isArray(p.aliases)) for (const a of p.aliases) { const na = normName(a); if (!na) continue; let sa = -1; if (na === nq) sa = 1; else if (na.startsWith(nq)) sa = 2; else if ((" " + na).includes(" " + nq)) sa = 3; if (sa >= 0 && (s < 0 || sa < s)) s = sa; }
      if (s >= 0) out.push({ p, s }); }
    out.sort((a, b) => a.s - b.s || a.p.name.length - b.p.name.length || a.p.name.localeCompare(b.p.name));
    const kinds = ["exact", "exact", "prefix", "word", "contains", "country"];
    return out.slice(0, opt.limit || 8).map((x) => ({ ...x.p, match: kinds[x.s] }));
  }
  // exactPort(ports, name) → the one port of that name (or of that name before its bracket, when only one has it), else null
  function exactPort(ports, name) { const nq = normName(name); if (!nq) return null; const list = ports || []; const full = list.find((p) => normName(p.name) === nq); if (full) return full; const bare = list.filter((p) => bareName(p.name) === nq); if (bare.length === 1) return bare[0]; if (bare.length) return null; const al = list.filter((p) => Array.isArray(p.aliases) && p.aliases.some((a) => normName(a) === nq)); return al.length === 1 ? al[0] : null; /* 4.32.2 · an alias names the port exactly too, when only one port carries it */ }
  // 4.31.22 · a redelivery "port / range" as typed in a recap → the places it names, in order: "Skaw-Passero", "Singapore–Japan range",
  // "DOP Fujairah", "1 SP Rotterdam or Antwerp", "US Gulf" … → [{ text, region }] where region is set for a trade-area word (Skaw → North
  // Europe, Passero → the Med, USG, Far East …) and the rest are port names for the caller to look up
  const AREA_WORDS = [["skaw", "NEUR"], ["ukc", "NEUR"], ["uk cont", "NEUR"], ["ukcont", "NEUR"], ["cont", "NEUR"], ["continent", "NEUR"], ["ara", "NEUR"], ["baltic", "NEUR"], ["north sea", "NEUR"], ["nwe", "NEUR"], ["north europe", "NEUR"], ["northwest europe", "NEUR"],
    ["passero", "MED"], ["cape passero", "MED"], ["med", "MED"], ["mediterranean", "MED"], ["east med", "MED"], ["west med", "MED"], ["emed", "MED"], ["wmed", "MED"], ["black sea", "MED"], ["bsea", "MED"], ["red sea", "RED"],
    ["ag", "AG"], ["pg", "AG"], ["meg", "AG"], ["arabian gulf", "AG"], ["persian gulf", "AG"], ["middle east gulf", "AG"], ["goo", "GOO"], ["gulf of oman", "GOO"], ["wci", "IND"], ["eci", "IND"], ["india", "IND"], ["west coast india", "IND"], ["east coast india", "IND"],
    ["spore", "FE"], ["sing", "FE"], ["japan", "FE"], ["korea", "FE"], ["china", "FE"], ["north china", "FE"], ["south china", "FE"], ["far east", "FE"], ["fe", "FE"], ["se asia", "FE"], ["south east asia", "FE"], ["southeast asia", "FE"], ["cjk", "FE"], ["taiwan", "FE"], ["philippines", "FE"], ["indonesia", "FE"], ["vietnam", "FE"],
    ["australia", "AUS"], ["aussie", "AUS"], ["west australia", "AUS"], ["east australia", "AUS"], ["new zealand", "AUS"], ["nz", "AUS"], ["south africa", "SAF"], ["saf", "SAF"], ["east africa", "EAF"], ["eafr", "EAF"], ["west africa", "WAF"], ["wafr", "WAF"], ["waf", "WAF"],
    ["usg", "USG"], ["us gulf", "USG"], ["usgulf", "USG"], ["usac", "USEC"], ["usec", "USEC"], ["us east coast", "USEC"], ["usnh", "USEC"], ["caribs", "CARIB"], ["caribbean", "CARIB"], ["ecsa", "ECSA"], ["east coast south america", "ECSA"], ["brazil", "ECSA"], ["river plate", "ECSA"],
    ["wcsa", "WCSA"], ["west coast south america", "WCSA"], ["uswc", "WCNA"], ["us west coast", "WCNA"], ["pnw", "WCNA"], ["nopac", "WCNA"]];
  const RANGE_NOISE = /\b(?:dop|aps|pob|dlosp|1sp|2sp|\d\s*sp|sbp|sb|safe (?:ports?|berths?)|range|in (?:charterers'?|chrs'?|owners'?) option|chopt|chrtrs? opt(?:ion)?|passing|or|incl(?:uding|\.)?|both ports inclusive|bss|atdnshinc|redelivery|delivery|on|at)\b/gi;
  function rangeParts(text) { const raw = String(text || "").trim(); if (!raw) return []; const out = [];
    for (let part of raw.split(/\s*(?:[-–—\/,;+&]|\bto\b|\bor\b|\band\b)\s*/i)) { const t0 = part.replace(/[()[\]."]/g, " ").replace(RANGE_NOISE, " ").replace(/\s+/g, " ").trim(); if (!t0) continue; const k = t0.toLowerCase(); const area = AREA_WORDS.find((w) => w[0] === k); out.push({ text: t0, region: area ? area[1] : null }); }
    return out; }
  // fixturePorts(f, resolve?) → { load: [...], discharge: [...] } with name, lat, lon, region, country, portId and how each was found:
  // "picked" (an exact pick stored on the fixture), "name" (an older fixture's free text resolved by name), "unknown"
  // 4.32.2 · every parcel's ports, loads first then discharges, in the order given, a port named by two parcels once (its STS flag kept); sts: true
  // marks a ship-to-ship load or discharge (stored on the ref); each port says which parcels it serves
  function fixturePorts(f, resolve) {
    const side = (names, refs, pno) => (names || []).map((nm, i) => { const r = (refs || []).find((x) => x && normName(x.name) === normName(nm)) || (refs || [])[i]; const sts = !!(r && normName(r.name) === normName(nm) && r.sts); if (r && normName(r.name) === normName(nm) && r.lat != null && r.lon != null && isFinite(+r.lat) && isFinite(+r.lon)) return { name: r.name, lat: +r.lat, lon: +r.lon, region: r.region || null, country: r.country || "", portId: r.portId || null, how: "picked", sts, parcels: [pno] };
      const p = resolve ? resolve(nm) : null; return p && p.lat != null ? { name: nm, lat: +p.lat, lon: +p.lon, region: p.region || null, country: p.country || "", portId: p.id || null, how: "name", sts, parcels: [pno] } : { name: nm, lat: null, lon: null, region: null, country: "", portId: null, how: "unknown", sts, parcels: [pno] }; });
    const merge = (list) => { const out = []; for (const p of list) { const d = out.find((x) => normName(x.name) === normName(p.name)); if (d) { d.sts = d.sts || p.sts; d.parcels = [...new Set([...d.parcels, ...p.parcels])]; if (d.how === "unknown" && p.how !== "unknown") Object.assign(d, { lat: p.lat, lon: p.lon, region: p.region, country: p.country, portId: p.portId, how: p.how }); } else out.push(p); } return out; };
    const ps = parcelsOf(f); const load = [], discharge = []; for (const p of ps) { load.push(...side(p.loadPorts, p.loadPortRefs, p.no)); discharge.push(...side(p.dischargePorts, p.dischargePortRefs, p.no)); }
    return { load: merge(load), discharge: merge(discharge), parcels: ps.length };
  }
  // fixturePlan(ps, f, { resolve, vessel, speedLaden, policy }) → the laden legs load → … → discharge routed like a voyage leg:
  // { legs: [{ from, to, nm, via, speed, days }], totalNm, seaDays, speed, via, missing: [names without a position] }
  function fixturePlan(ps, f, opt) {
    opt = opt || {}; const fp = fixturePorts(f, opt.resolve); const all = [...fp.load.map((p) => ({ ...p, activity: "load" })), ...fp.discharge.map((p) => ({ ...p, activity: "discharge" }))];
    const vessel = opt.vessel || ((ps && ps.vessels) || []).find((v) => f && v.id === f.vesselId) || {}; const w = (f && f.warranties) || {};
    const speed = +opt.speedLaden || +w.speedLaden || +vessel.speedLaden || 12; const policy = opt.policy !== undefined ? opt.policy : (ps && ps.settings && ps.settings.routing) || null;
    const have = all.filter((p) => p.lat != null); const legs = [];
    for (let i = 0; i < have.length - 1; i++) { const a = have[i], b = have[i + 1]; const rt = routeLine(a, b, null, policy); legs.push({ from: a.name, to: b.name, nm: rt.nm, via: rt.via, passages: rt.passages || [], speed, days: r4(rt.nm / (speed * 24)), line: rt.line }); }
    const totalNm = legs.reduce((k, l) => k + l.nm, 0); const longest = legs.slice().sort((a, b) => b.nm - a.nm)[0];
    return { ports: all, legs, totalNm, seaDays: r4(totalNm / (speed * 24)), speed, via: longest ? (legs.find((l) => l.via !== "direct") || longest).via : "direct", missing: all.filter((p) => p.lat == null).map((p) => p.name), legacy: all.some((p) => p.how === "name") };
  }
  const VIA_NAME = { direct: "direct", suez: "via Suez", cape: "via the Cape of Good Hope", panama: "via Panama", horn: "via Cape Horn" };
  // planLine(plan) → "Zhapu → Barcelona · 8,542 nm · 27.8 d at 12.8 kn (via Suez)"
  function planLine(plan) { if (!plan || !plan.legs.length) return ""; const stsOf = (n) => (plan.ports || []).some((p) => p.name === n && p.sts); const names = [plan.legs[0].from, ...plan.legs.map((l) => l.to)].map((n) => n + (stsOf(n) ? " (STS)" : "")); return names.join(" → ") + " · " + fmtQty(plan.totalNm) + " nm · " + (Math.round(plan.seaDays * 10) / 10).toFixed(1) + " d at " + plan.speed + " kn" + (plan.via && plan.via !== "direct" ? " (" + (VIA_NAME[plan.via] || plan.via) + ")" : ""); }
  // a voyage without positioned ports of its own is estimated on the fixture's picked load and discharge ports
  function voyageFromFixture(vy, f) { const fp = fixturePorts(f); const ports = [...fp.load.map((p, i) => ({ ...p, id: "fxl" + i, activity: "load", sts: !!p.sts })), ...fp.discharge.map((p, i) => ({ ...p, id: "fxd" + i, activity: "discharge", sts: !!p.sts }))].filter((p) => p.lat != null); return ports.length >= 2 ? { ...vy, ports, legs: [] } : null; }

  return { MIN, DAYM, parse, iso, isoDate, minutes, addMinutes, overlapMinutes, days, fmtDays, fmtAt, fmtEnd, fmtDate, fmtMoney, fmtQty, nowIso, r2, r4, r6,
    lastPosition, positionCandidates, positionLabel, rateSteps, hasRateSteps, hireStops, rateSchedule, hireSegments, hireAmount, hireGross, rateAt, rateText, rateRows, rateCheck, MARKET_CLASSES, MARKET_MONTHS, marketClass, marketWant, marketLabel, rateScore, tcMonthsOf, fixturesOf, activeFixture, offhiresOf, OFFHIRE_KINDS, offhireKind, offhireKindInferred, offhireKindName, mergedMinutes, utilisationSplit, utilisationOf, delAt, redelAt, redelActual, fxLabel, hire, periods, fixtureInvoices, unbilled, freight, laytime, voyageEstimate,
    vesselOfDoc, vesselOfJournal, vesselFinance, marketRateAt, onHire, performance, soa, report, portalSnapshot, fixtureLog, portalSection, portalFixtures, portalDocuments,
    // 4.13 · scale
    MV, index, psIndex, touch, fleetFinance, fleetStatus, fleetPerformance, alerts, memoSize: () => MEMO.size, memoClear: () => MEMO.clear(), storeSig, psSig,
    // 4.14 · voyage accounting
    voyageOf, voyageSpan, docStatus, costKind, revKind, invoiceLineKinds, bunkerEvents, bunkerStock, voyageBunkers, voyageResult, voyageCandidates, hireStatements, hireStatementRows, cashflow, consumption, claimLines, claimFixture, invoiceTarget, voyagesOfFixture, voyageFixture, voyageEstimateFor,
    // 4.15 · the voyage plan on the map
    route, routeLine, voyagePlan, track, planPosition, currentVoyage, seaRoute, trackPath,
    // 4.17 · paste a recap
    parseRecap, recapDate, recapMoney, unitOfRate, unitOfFixture,
    // 4.18 · exit from management
    tenure, EXIT_REASONS, exitReasonName,
    // x.y · back-dating: invoices recorded from outside, laytime results entered as agreed
    recordInvoice, RECORD_KINDS, isRecorded, laytimeResult, coverOf,
    // 4.19 · the money model
    vesselSharesOf, ownersStatement, ownerStatement, ownerStatementRows, REV_KINDS, revKind,
    // 4.30 · the laytime statement
    laytimeStatement, laytimeTerms, laytimePort, laytimeLines, laytimeDocument, laytimeMigrate, LT_CODES, ltCodeLabel,
    // 4.31.10 · coordinates and the exact port search
    parseCoord, parseCoordPair, fmtCoord, coordHint, normName, searchPorts, exactPort, fixturePorts, fixturePlan, planLine, voyageFromFixture,
    // 4.31.22 · the redelivery range
    rangeParts,
    // 4.32.2 · parcels, brokers, the charterer-paid extras, and a voyage charter's commencement
    commencement, commencedAt, startAt, withStart, parcelsOf, parcelRate, cargoTotals, brokersOf, brokeragePct, fixtureExtras, extrasTotal, extraLine, EXTRA_KINDS, extraLabel };
});
