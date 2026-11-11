/* XYNTAX PROSHIP · fixture status (4.31.15). One vocabulary for the desktop and the customer portal: On subs (with the subjects
 * deadline), Fixed (not commenced: laycan / expected delivery, "starts in n d"), Delivered · on hire (time charter) or Commenced
 * (voyage), Redelivered / Completed, Cancelled / Failed. Pure: a fixture and the time in, the words, the countdowns and the timeline
 * style out. Only a delivered (commenced) fixture is current employment — a fixed one is the next employment and counts no days.
 * Also the document kinds (recap, CP, addenda, NOR, SOF…) and the activity feed of a published vessel page.
 * This file is loaded by the app (src/) and, byte-identical, by the portal (portal/fixture-status.js); a test keeps them equal. */
(function (root, factory) { const api = factory(); if (typeof module !== "undefined" && module.exports) module.exports = api; root.FixtureStatus = api; })(typeof self !== "undefined" ? self : this, function () {
  const DAY = 86400000, HOUR = 3600000; const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  // wall-clock times as the desk writes them ("YYYY-MM-DDTHH:mm", no zone) read as UTC, like the engine
  function parse(x) { if (x == null || x === "") return NaN; if (typeof x === "number") return x; if (x instanceof Date) return x.getTime(); if (typeof x === "object") return parse(x.at); const m = String(x).trim().match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?)?/); if (!m) { const t = Date.parse(x); return isNaN(t) ? NaN : t; } return Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)); }
  const at = (x) => (x && typeof x === "object" ? x.at : x) || null;
  const r1 = (n) => Math.round(n * 10) / 10;
  const dd = (ms) => { const d = new Date(ms); return String(d.getUTCDate()).padStart(2, "0") + " " + MON[d.getUTCMonth()]; };
  const ddy = (ms) => dd(ms) + " " + new Date(ms).getUTCFullYear();
  const span = (a, b) => { if (isNaN(a)) return ""; if (isNaN(b)) return dd(a); const x = new Date(a), y = new Date(b); return x.getUTCMonth() === y.getUTCMonth() && x.getUTCFullYear() === y.getUTCFullYear() ? String(x.getUTCDate()).padStart(2, "0") + "–" + dd(b) : dd(a) + " – " + dd(b); };
  const left = (ms) => { const h = ms / HOUR; return h < 48 ? Math.max(0, Math.round(h)) + " h" : Math.round(h / 24) + " d"; };
  const KIND = { tc: "Time charter", voyage: "Voyage charter", bareboat: "Bareboat", coa: "COA", pool: "Pool" };
  const kindName = (k) => KIND[k] || (k ? String(k).replace(/^\w/, (c) => c.toUpperCase()) : "Fixture");
  const KEYS = ["on-subs", "fixed", "delivered", "completed", "cancelled"];
  // the word for a status of a kind of fixture: a time charter is delivered (on hire) and redelivered, a voyage commences and completes
  function word(key, kind, raw) { if (key === "on-subs") return "On subs"; if (key === "fixed") return "Fixed"; if (key === "delivered") return kind === "voyage" ? "Commenced" : "Delivered"; if (key === "completed") return kind === "voyage" ? "Completed" : "Redelivered"; if (key === "cancelled") return raw === "failed" ? "Failed" : "Cancelled"; return "Open"; }
  const BAR = { "on-subs": "subs", fixed: "fixed", delivered: "live", completed: "done", cancelled: "none" };
  const CLS = { "on-subs": "s-subs", fixed: "s-fixed", delivered: "s-live", completed: "s-done", cancelled: "s-cancel", open: "s-open" };
  const LEGEND = [["s-live", "Delivered / commenced"], ["s-fixed", "Fixed, not commenced"], ["s-subs", "On subs"], ["s-done", "Completed"]];
  const laycanOf = (f) => { const l = (f.cargo && f.cargo.laycan) || f.laycan || null; return l && (l.from || l.to) ? { from: parse(l.from), to: parse(l.to) } : null; };
  // f: a fixture (desk record or published page); now: ISO or ms; opt.charterer: the charterer's name when f carries only an id
  function derive(f, now, opt) {
    opt = opt || {}; if (!f) return { key: "open", word: "Open", cls: CLS.open, bar: "none", started: false, current: false, line: "Open · no fixture", when: "" };
    const N = now == null ? Date.now() : parse(now); const raw = String(f.status || "").toLowerCase(); const kind = f.kind || "";
    const del = parse(at(f.delivery)), red = parse(at(f.redelivery)); const redActual = !!(f.redelivery && f.redelivery.at && f.redelivery.estimated === false) || raw === "redelivered" || raw === "completed";
    let key;
    if (raw === "cancelled" || raw === "failed") key = "cancelled";
    else if (raw === "redelivered" || raw === "completed") key = "completed";
    else if (raw === "delivered" || raw === "commenced") key = redActual && !isNaN(red) && red <= N ? "completed" : "delivered";
    else if (raw === "on-subs") key = "on-subs";
    else if (raw === "fixed") key = "fixed";
    else key = !isNaN(del) && del <= N ? (redActual && !isNaN(red) && red <= N ? "completed" : "delivered") : "fixed"; // a record without a status: by its dates
    const lay = laycanOf(f); const expected = !isNaN(del) ? del : lay && !isNaN(lay.from) ? lay.from : NaN;
    const started = key === "delivered" || key === "completed"; const current = key === "delivered";
    const startsInDays = (key === "fixed" || key === "on-subs") && !isNaN(expected) && expected > N ? r1((expected - N) / DAY) : null;
    const deliveryOverdue = key === "fixed" && !isNaN(del) && del <= N; // fixed, the delivery date passed and nobody marked her delivered
    const daysLeft = current && !isNaN(red) ? r1(Math.max(0, (red - N) / DAY)) : null;
    const dl = f.subs && f.subs.deadline ? parse(f.subs.deadline) : NaN; const subsLeftH = key === "on-subs" && !isNaN(dl) ? r1((dl - N) / HOUR) : null; const subsPassed = subsLeftH != null && subsLeftH < 0;
    const w = word(key, kind, raw); const cp = opt.charterer != null ? opt.charterer : (typeof f.charterer === "string" ? f.charterer : "");
    let when = "";
    if (key === "on-subs") when = isNaN(dl) ? "no subjects deadline" : subsPassed ? "subjects deadline passed " + dd(dl) : "subjects " + left(dl - N) + " left · " + dd(dl);
    else if (key === "fixed") when = startsInDays != null ? "starts in " + (startsInDays < 1 ? "under a day" : Math.round(startsInDays) + " d") : deliveryOverdue ? "delivery due " + dd(del) + " — not confirmed" : (kind === "voyage" ? "voyage to commence" : "delivery to come");
    else if (key === "delivered") when = daysLeft != null ? (daysLeft < 1 ? "under a day left" : Math.round(daysLeft) + " d left") : "open-ended";
    else if (key === "completed") when = (kind === "voyage" ? "completed " : "redelivered ") + (isNaN(red) ? "" : ddy(red));
    else when = w.toLowerCase();
    let phrase = "";
    if (key === "fixed") phrase = (kind === "voyage" ? "voyage to commence" : "delivery " + (!isNaN(del) ? (deliveryOverdue ? "due " : "expected ") + dd(del) : "to come")) + (lay ? " · laycan " + span(lay.from, lay.to) : "") + (startsInDays != null ? " · starts in " + (startsInDays < 1 ? "under a day" : Math.round(startsInDays) + " d") : "");
    else if (key === "on-subs") phrase = when;
    else if (key === "delivered") phrase = (kind === "voyage" ? "voyage under way" : "on hire") + (!isNaN(del) ? " since " + dd(del) : "") + (daysLeft != null ? " · " + when : "");
    else if (key === "completed") phrase = when;
    else phrase = "";
    const line = [w, cp, phrase].filter(Boolean).join(" · ");
    return { key, raw, kind, kindName: kindName(kind), word: w, cls: CLS[key], bar: BAR[key], started, current, deliveryOverdue, startsInDays, daysLeft, subsDeadline: isNaN(dl) ? null : new Date(dl).toISOString(), subsLeftH, subsPassed, laycan: lay ? { from: isNaN(lay.from) ? null : new Date(lay.from).toISOString(), to: isNaN(lay.to) ? null : new Date(lay.to).toISOString(), text: span(lay.from, lay.to) } : null, expectedStart: isNaN(expected) ? null : new Date(expected).toISOString(), when, phrase, line, charterer: cp };
  }
  // the figures that go with a fixture on a published page (plain JSON)
  const brief = (f, now, opt) => { const s = derive(f, now, opt); return { key: s.key, word: s.word, cls: s.cls, bar: s.bar, started: s.started, current: s.current, startsInDays: s.startsInDays, daysLeft: s.daysLeft, subsDeadline: s.subsDeadline, subsLeftH: s.subsLeftH, subsPassed: s.subsPassed, deliveryOverdue: s.deliveryOverdue, laycan: s.laycan, expectedStart: s.expectedStart, when: s.when, line: s.line }; };
  // a vessel's employment from all her fixtures: the one in force (delivered / commenced), else the next one (fixed before on subs,
  // the earliest first); the state the fleet lists show and the next event (redelivery, laycan or delivery, subjects deadline)
  function vesselState(fixtures, now, opt) {
    opt = opt || {}; const N = now == null ? Date.now() : parse(now); const name = opt.charterer || ((f) => (typeof f.charterer === "string" ? f.charterer : ""));
    const all = (fixtures || []).filter(Boolean).map((f) => ({ f, s: derive(f, N, { charterer: name(f) }) }));
    const live = all.filter((x) => x.s.key === "delivered").sort((a, b) => (parse(at(b.f.delivery)) || 0) - (parse(at(a.f.delivery)) || 0))[0] || null;
    const rank = (x) => (x.s.key === "fixed" ? 0 : 1); const ts = (x) => (x.s.expectedStart ? parse(x.s.expectedStart) : Infinity);
    const upcoming = all.filter((x) => x.s.key === "fixed" || x.s.key === "on-subs").sort((a, b) => rank(a) - rank(b) || ts(a) - ts(b));
    const shown = live || upcoming[0] || null; const state = live ? "delivered" : shown ? shown.s.key : "open";
    const open = nextOpen(shown ? shown.f : null, N); // the same reading of the redelivery as the desk's open positions
    let next = null; if (live) { const red = parse(open.at); next = !isNaN(red) ? { kind: live.f.kind === "voyage" ? "completion" : "redelivery", at: new Date(red).toISOString(), estimated: !(live.f.redelivery && live.f.redelivery.estimated === false), text: (live.f.kind === "voyage" ? "Completion " : "Redelivery ") + dd(red) + (live.f.redelivery && live.f.redelivery.estimated === false ? "" : " (est.)") } : null; }
    else if (shown && shown.s.key === "fixed") { const l = shown.s.laycan; next = l && l.from ? { kind: "laycan", at: l.from, text: "Laycan " + l.text } : shown.s.expectedStart ? { kind: "delivery", at: shown.s.expectedStart, text: "Delivery " + dd(parse(shown.s.expectedStart)) } : { kind: "commence", at: null, text: shown.f.kind === "voyage" ? "Voyage to commence" : "Delivery to come" }; }
    else if (shown && shown.s.key === "on-subs") next = shown.s.subsDeadline ? { kind: "subjects", at: shown.s.subsDeadline, text: shown.s.subsPassed ? "Subjects deadline passed" : "Subjects " + dd(parse(shown.s.subsDeadline)) } : { kind: "subjects", at: null, text: "On subjects" };
    const after = live ? upcoming[0] || null : null;
    return { state, word: state === "open" ? "Open" : shown.s.word, cls: CLS[state] || CLS.open, current: live ? live.f : null, currentStatus: live ? live.s : null, shown: shown ? shown.f : null, shownStatus: shown ? shown.s : null, upcoming: upcoming.map((x) => x.f), nextFixture: after ? after.f : null, nextFixtureStatus: after ? after.s : null, next, open };
  }
  // ---- documents: what a file is, from the manager's choice or its name
  const DOC_KINDS = [["recap", "Recap"], ["cp", "Charter party"], ["addendum", "Addenda"], ["nor", "NOR"], ["sof", "Statement of facts"], ["laytime", "Laytime"], ["invoice", "Invoices"], ["bl", "Bills of lading"], ["q88", "Q88 / questionnaire"], ["report", "Reports"], ["certificate", "Certificates"], ["other", "Other"]];
  const docKindName = (k) => (DOC_KINDS.find((x) => x[0] === k) || [k, k ? String(k).replace(/^\w/, (c) => c.toUpperCase()) : "Other"])[1];
  function docKind(name, given) { if (given && DOC_KINDS.some((x) => x[0] === given)) return given; const n = String(name || "").toLowerCase().replace(/[_.]+/g, " ");
    if (/recap/.test(n)) return "recap"; if (/addend/.test(n)) return "addendum"; if (/\bc ?\/ ?p\b|\bcp\b|charter ?party|charterparty/.test(n)) return "cp"; if (/\bnor\b|notice of readiness/.test(n)) return "nor"; if (/\bsof\b|statement of facts/.test(n)) return "sof";
    if (/laytime|demurrage calc|\blaycalc/.test(n)) return "laytime"; if (/invoice|\binv\b|credit note|\bfda\b|\bpda\b/.test(n)) return "invoice"; if (/\bb ?\/ ?l\b|bill of lading/.test(n)) return "bl"; if (/\bq88\b|questionnaire/.test(n)) return "q88"; if (/report|statement/.test(n)) return "report"; if (/certificate|\bcert\b|class|p ?& ?i/.test(n)) return "certificate"; return "other"; }
  // ---- the activity feed of one published vessel page (newest first): fixture status changes, delivery and redelivery, port
  // arrivals and departures, the last noon report, invoices issued and paid, documents shared, the publish itself. Every event
  // carries the route it opens in the portal; nothing in the future is an event.
  function activity(v, files, opt) {
    opt = opt || {}; const N = opt.now == null ? Date.now() : parse(opt.now); const id = encodeURIComponent((v && (v.id || (v.vessel || {}).id)) || ""); const name = (v && v.vessel && v.vessel.name) || ""; const ev = [];
    const push = (t, kind, text, href, extra) => { const ms = parse(t); if (isNaN(ms) || ms > N + 60000) return; ev.push(Object.assign({ at: new Date(ms).toISOString(), ms, kind, text, href: href || "", vesselId: decodeURIComponent(id), vessel: name }, extra || {})); };
    for (const f of (v && v.fixtures) || []) { const fh = "#/vessel/" + id + "/fixture/" + encodeURIComponent(f.id || ""); const who = (f.charterer ? f.charterer + " · " : "") + kindName(f.kind);
      const log = (f.statusLog || []).filter((x) => x && x.status && x.at); const seen = new Set(log.map((x) => x.status));
      for (const x of log) push(x.at, "fixture", word(x.status === "redelivered" || x.status === "completed" ? "completed" : x.status === "delivered" ? "delivered" : x.status === "on-subs" ? "on-subs" : x.status === "cancelled" || x.status === "failed" ? "cancelled" : "fixed", f.kind, x.status) + " · " + who, fh);
      if (!seen.has("delivered") && f.delivery && f.delivery.at && (f.status === "delivered" || f.status === "redelivered")) push(f.delivery.at, "fixture", word("delivered", f.kind) + " · " + who + (f.delivery.port ? " · " + f.delivery.port : ""), fh);
      if (!seen.has("redelivered") && f.status === "redelivered" && f.redelivery && f.redelivery.at) push(f.redelivery.at, "fixture", word("completed", f.kind) + " · " + who + (f.redelivery.port ? " · " + f.redelivery.port : ""), fh); }
    for (const vy of (v && v.voyages) || []) for (const p of vy.ports || []) { const ph = "#/vessel/" + id + "/port/" + encodeURIComponent(vy.id || "") + "/" + encodeURIComponent(p.id || p.name || ""); if (p.ata) push(p.ata, "port", "Arrived " + p.name + (p.activity ? " · " + p.activity : "") + (vy.no ? " · voyage " + vy.no : ""), ph); if (p.atd) push(p.atd, "port", "Departed " + p.name + (vy.no ? " · voyage " + vy.no : ""), ph); }
    const noon = v && v.operations && v.operations.noon; if (noon && noon.at) push(noon.at, "noon", "Noon report" + (noon.speed != null ? " · " + noon.speed + " kn" : "") + (noon.nextPort ? " · next " + noon.nextPort : ""), "#/v/" + id + "/operations");
    const st = v && v.statement; if (st && st.rows) for (const r of st.rows) { if (r.t === "i") { push(r.d, "invoice", "Invoice " + r.ref + " issued" + (r.cp ? " · " + r.cp : ""), "#/vessel/" + id + "/invoice/" + encodeURIComponent(r.ref || ""), { amount: r.a }); } else if (r.t === "r") push(r.d, "receipt", "Payment received" + (r.inv ? " for " + r.inv : r.ref ? " · " + r.ref : "") + (r.cp ? " · " + r.cp : ""), r.inv ? "#/vessel/" + id + "/invoice/" + encodeURIComponent(r.inv) : "#/v/" + id + "/financials", { amount: r.a }); else if (r.t === "m") push(r.d, "remit", "Paid out to you · " + (r.ref || "remittance"), "#/v/" + id + "/financials", { amount: r.a }); }
    else { const docs = (v && v.financials && (v.financials.docs || v.financials.invoices)) || []; for (const d of docs) if (d.kind === "invoice" || d.openAmount != null) push(d.date, "invoice", "Invoice " + (d.ref || "") + " issued", "#/vessel/" + id + "/invoice/" + encodeURIComponent(d.ref || ""), { amount: d.amount }); }
    for (const fl of files || []) if (fl && (fl.vessel_id == null || String(fl.vessel_id) === decodeURIComponent(id))) push(fl.uploaded_at, "document", "Document shared · " + fl.name, "#/v/" + id + "/documents", { fileId: fl.id });
    if (v && v.updatedAt && !opt.noPublish) push(v.updatedAt, "publish", "Page updated by the manager", "#/v/" + id);
    ev.sort((a, b) => b.ms - a.ms || (a.kind < b.kind ? -1 : 1)); return ev.slice(0, opt.limit || 30);
  }
  // 4.31.22 · when a vessel comes open: the redelivery (completion) of the fixture she is on; when that is an estimate with a window
  // (redelivery.windowDays, ± days) the earliest day of the window; with no redelivery date, delivery + the minimum period (minDays …
  // maxDays). The month is read on the desk's wall clock — the stored "YYYY-MM-DDTHH:mm" as written, never through the computer's
  // time zone — so 30 Nov 23:00 is November everywhere. A month before the current one (a redelivery overdue) counts as open now; no
  // fixture is open now. → { month: "now" | "YYYY-MM" | null, at, earliest, latest, estimated, windowDays, overdue, openNow, port, lat, lon }
  const p2 = (n) => String(n).padStart(2, "0");
  const wall = (ms) => { const d = new Date(ms); return d.getUTCFullYear() + "-" + p2(d.getUTCMonth() + 1) + "-" + p2(d.getUTCDate()) + "T" + p2(d.getUTCHours()) + ":" + p2(d.getUTCMinutes()); };
  const monthKey = (ms) => { const d = new Date(ms); return d.getUTCFullYear() + "-" + p2(d.getUTCMonth() + 1); };
  function nextOpen(f, now, opt) {
    opt = opt || {}; const N = now == null ? Date.now() : parse(now); const cur = monthKey(N);
    const none = { month: null, at: null, earliest: null, latest: null, estimated: true, windowDays: null, overdue: false, openNow: false, port: "", lat: null, lon: null, fixtureId: f ? f.id || null : null };
    if (!f) return { ...none, month: "now", estimated: false, openNow: true };
    const red = f.redelivery || {}; let t = parse(at(red)), est = red.estimated !== false, early = t, late = t; const win = Math.max(0, +red.windowDays || 0);
    if (!isNaN(t) && est && win) { early = t - win * DAY; late = t + win * DAY; }
    if (isNaN(t)) { const d = parse(at(f.delivery)); if (!isNaN(d) && +f.minDays > 0) { t = d + f.minDays * DAY; early = t; late = +f.maxDays > +f.minDays ? d + f.maxDays * DAY : t; est = true; } }
    const where = { port: red.port || "", lat: red.lat != null && isFinite(+red.lat) ? +red.lat : null, lon: red.lon != null && isFinite(+red.lon) ? +red.lon : null };
    if (isNaN(t)) return { ...none, ...where };
    const mk = monthKey(early); const overdue = mk < cur;
    return { ...none, ...where, month: overdue ? "now" : mk, at: wall(t), earliest: wall(early), latest: wall(late), estimated: est, windowDays: win || null, overdue };
  }
  // the next n months from now's month, on the wall clock: [{ key: "2026-11", label: "Nov 2026" }, …]
  function months(now, n) { const d = new Date(now == null ? Date.now() : parse(now)); const out = []; for (let i = 0; i < (n || 12); i++) { const m = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + i, 1); out.push({ key: monthKey(m), label: MON[new Date(m).getUTCMonth()] + " " + new Date(m).getUTCFullYear() }); } return out; }
  return { parse, derive, brief, vesselState, nextOpen, months, monthKey, word, kindName, KEYS, LEGEND, CLS, DOC_KINDS, docKind, docKindName, activity, laycanText: (l) => (l ? span(parse(l.from), parse(l.to)) : "") };
});
