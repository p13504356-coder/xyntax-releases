/* XYNTAX PROSHIP · bunker grade specifications (4.31.15). The company defines its grades once (Settings → Bunkers → Grades, kept in
 * the PROSHIP settings so every desk shares them): name, spec label (ISO 8217 class and sulphur), unit (MT or m³), typical density
 * for m³ ↔ MT, and the price currency. A vessel carries her own list (which specs she burns), the fleet set by default.
 * ROB and consumption are entered as one number per grade (PSGRADES.inputs) — never free text — and pasted master's text is read by
 * the tolerant parseGrades: "VLSFO: 850,5 mt", "LSMGO = 120", "ROB VLSFO 0.5% 850", the number on the next line, units either side,
 * decimal commas. Pure parts (defaults, parse, specs) run in node for the tests; the input control needs a page. */
(function (root, factory) { const api = factory(); if (typeof module !== "undefined" && module.exports) module.exports = api; root.PSGRADES = api; })(typeof self !== "undefined" ? self : this, function () {
  const DEFAULTS = [
    { id: "VLSFO", name: "VLSFO", spec: "ISO 8217 RMG 380 · 0.50 %S", sulphur: 0.5, unit: "MT", density: 0.96, currency: "USD" },
    { id: "LSMGO", name: "LSMGO", spec: "ISO 8217 DMA · 0.10 %S", sulphur: 0.1, unit: "MT", density: 0.85, currency: "USD" },
    { id: "HSFO", name: "HSFO", spec: "ISO 8217 RMG 380 · 3.50 %S", sulphur: 3.5, unit: "MT", density: 0.98, currency: "USD" },
    { id: "ULSFO", name: "ULSFO", spec: "ISO 8217 RMD 80 · 0.10 %S", sulphur: 0.1, unit: "MT", density: 0.92, currency: "USD" },
    { id: "MGO", name: "MGO", spec: "ISO 8217 DMA · 0.50 %S", sulphur: 0.5, unit: "MT", density: 0.85, currency: "USD" },
    { id: "LNG", name: "LNG", spec: "ISO 23306", sulphur: 0, unit: "m³", density: 0.45, currency: "USD" },
    { id: "METHANOL", name: "Methanol", spec: "IMPCA", sulphur: 0, unit: "MT", density: 0.79, currency: "USD" }];
  const ALIAS = { HFO: "HSFO", IFO: "HSFO", IFO380: "HSFO", "IFO 380": "HSFO", HSHFO: "HSFO", LSFO: "VLSFO", VLS: "VLSFO", "VLS FO": "VLSFO", ULS: "ULSFO", MDO: "MGO", DO: "MGO", GO: "MGO", LSGO: "LSMGO", "LS MGO": "LSMGO", MEOH: "METHANOL" };
  const norm = (s) => String(s || "").toUpperCase().replace(/[\s_]+/g, " ").trim();
  const idOf = (name) => norm(name).replace(/\s+/g, "");
  // the company's specs: settings.bunkerGrades when set (archived ones kept for history), else the defaults
  const specs = (settings, opt) => { const own = settings && Array.isArray(settings.bunkerGrades) && settings.bunkerGrades.length ? settings.bunkerGrades : DEFAULTS; return opt && opt.all ? own.slice() : own.filter((g) => !g.archived); };
  const specOf = (settings, grade) => { const n = idOf(grade); const all = specs(settings, { all: true }); return all.find((g) => idOf(g.id) === n || idOf(g.name) === n) || null; };
  // a vessel's grades in order: her own list, else the fleet's first two (the common pair), always as spec rows
  const vesselGrades = (settings, v) => { const list = v && Array.isArray(v.grades) && v.grades.length ? v.grades : specs(settings).slice(0, 2).map((g) => g.id); return list.map((g) => specOf(settings, g) || { id: idOf(g), name: String(g).toUpperCase(), spec: "", unit: "MT", density: null, currency: "USD", unknown: true }); };
  const label = (settings, grade) => { const s = specOf(settings, grade); return s ? s.name + (s.spec ? " · " + s.spec : "") : String(grade || ""); };
  const unitOf = (settings, grade) => { const s = specOf(settings, grade); return (s && s.unit) || "MT"; };
  // ---- numbers as people type them: 850 · 850.5 · 850,5 (decimal comma) · 1,250 / 1.250 / 1 250 (thousands) · 1,250.5 · 1.250,5
  function num(t) { let s = String(t || "").trim().replace(/['  ]/g, " "); if (!s) return NaN; const neg = /^-/.test(s); s = s.replace(/^[-+]/, "");
    if (/^\d{1,3}( \d{3})+([.,]\d+)?$/.test(s)) s = s.replace(/ /g, ""); else if (/\s/.test(s)) return NaN;
    if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, ""); else if (/^\d{1,3}(\.\d{3}){2,}$/.test(s) || /^\d{1,3}(\.\d{3})+,\d+$/.test(s)) s = s.replace(/\./g, "").replace(",", "."); /* 4.34.9: 20.235 is twenty point two three five — dots are thousands only when there are several (1.250.000) or a decimal comma follows (1.250,5) */ else if (/^\d+,\d+$/.test(s)) s = s.replace(",", "."); else if (!/^\d+(\.\d+)?$/.test(s)) return NaN;
    const v = +s; return isNaN(v) ? NaN : neg ? -v : v; }
  const UNIT = "(?:metric\\s*tons?|mts?|tons?|tonnes?|t|m3|m³|cbm|cu\\.?\\s*m)";
  const NUM = "[-+]?\\d{1,3}(?: \\d{3})+(?:[.,]\\d+)?|[-+]?\\d[\\d.,']*\\d|[-+]?\\d";
  const unitWord = (u) => { const x = String(u || "").toLowerCase().replace(/\s+/g, ""); if (!x) return null; return /m3|m³|cbm|cu\.?m/.test(x) ? "m³" : "MT"; };
  const SKIP = /^(rob|r\.o\.b\.?|remaining on board|bunkers?|consumption|consumed|cons|fuel|grade|total)\s*[:\-]?\s*$/i;
  // parseGrades(text, settings?) → { values: { VLSFO: 850.5, … }, rows: [{ grade, qty, unit, raw, known, converted }], unknown: [names], skipped: [lines] }
  function parseGrades(text, settings) {
    const out = { values: {}, rows: [], unknown: [], skipped: [] }; const lines = String(text || "").replace(/\r/g, "").split(/\n|;|\s\/\s|\|/).map((l) => l.replace(/\t/g, " : ").replace(/\b(IFO|HFO|RMG|RME|RMK|RMD)[\s-]?(80|180|380|500|700)\b/gi, "$1$2").trim());
    const reGN = new RegExp("^(.*?[A-Za-z].*?)\\s*(?:[:=]+|\\s)\\s*(" + UNIT + "\\s*)?(" + NUM + ")\\s*(" + UNIT + ")?\\.?$", "i");
    const reNG = new RegExp("^(" + NUM + ")\\s*(" + UNIT + ")?\\s+(?:of\\s+)?([A-Za-z].*)$", "i");
    const reN = new RegExp("^(?:[:=]\\s*)?(" + NUM + ")\\s*(" + UNIT + ")?\\.?$", "i");
    const add = (name, qtyText, unitText, raw) => { let g = String(name || "").replace(/^(rob|r\.o\.b\.?|cons(?:umption|umed)?|remaining on board)\s*[:\-]?\s*/i, "").replace(/[:=\-–\s]+$/, "").trim(); const q = num(qtyText); if (!g || isNaN(q)) return false;
      let key = norm(g); let sp = specOf(settings, key); if (!sp && ALIAS[key]) sp = specOf(settings, ALIAS[key]); if (!sp) { const first = key.split(/[\s\-\/(]+/)[0]; sp = specOf(settings, first) || (ALIAS[first] ? specOf(settings, ALIAS[first]) : null); }
      const id = sp ? sp.id : idOf(g).replace(/[^A-Z0-9.%\-]/g, ""); let qty = q; const typed = unitWord(unitText); let converted = false; const want = (sp && sp.unit) || "MT";
      if (typed && sp && typed !== want && +sp.density > 0) { qty = typed === "m³" ? q * sp.density : q / sp.density; qty = Math.round(qty * 1000) / 1000; converted = true; }
      out.values[id] = qty; out.rows.push({ grade: id, qty, unit: want, raw, known: !!sp, converted }); if (!sp && !out.unknown.includes(id)) out.unknown.push(id); return true; };
    for (let i = 0; i < lines.length; i++) { const l = lines[i]; if (!l) continue; if (SKIP.test(l)) continue; let m;
      if ((m = reGN.exec(l)) && add(m[1], m[3], m[4] || m[2], l)) continue;
      if ((m = reNG.exec(l)) && add(m[3], m[1], m[2], l)) continue;
      // the grade alone on its line, the number on the next one
      if (/[A-Za-z]/.test(l) && i + 1 < lines.length && (m = reN.exec(lines[i + 1])) && add(l.replace(/[:=]+$/, ""), m[1], m[2], l + " / " + lines[i + 1])) { i++; continue; }
      out.skipped.push(l); }
    return out; }
  // the old "grade qty per line" text and objects alike → { GRADE: qty }
  const toValues = (x, settings) => { if (x && typeof x === "object" && !Array.isArray(x)) { const o = {}; for (const [k, v] of Object.entries(x)) { if (v == null || v === "") continue; const q = typeof v === "number" ? v : num(v); if (!isNaN(q)) o[(specOf(settings, k) || {}).id || idOf(k)] = q; } return o; } if (Array.isArray(x)) { const o = {}; for (const b of x) if (b && b.grade && b.qty !== "" && b.qty != null) { const id = (specOf(settings, b.grade) || {}).id || idOf(b.grade); o[id] = Math.round(((o[id] || 0) + +b.qty) * 1e6) / 1e6; } return o; } return parseGrades(x, settings).values; };
  // ---- the entry control: one number per grade (her grades in order, with unit and spec), "+ grade" from the spec list, and a paste box
  // for the master's text; opt.price adds a price per grade (bunkers on delivery / redelivery). Its value: { GRADE: qty } or, with price,
  // [{ grade, qty, price }]. A field of type "raw" in SUITE.form.
  function inputs(opt) {
    opt = opt || {}; const H = (...a) => SUITE.H(...a); const S = opt.settings || null; let list = (opt.grades || []).map((g) => (typeof g === "string" ? specOf(S, g) || { id: idOf(g), name: g, unit: "MT", spec: "" } : g));
    const val = {}, price = {}; const seed = opt.value; let rowN = 0; const KEY = (g) => g.key || g.id; /* 4.34.9: with prices, a grade may stand on several rows — lots at different prices; the first row keeps the grade as its key */ const another = (id, name) => { const base = specOf(S, id) || list.find((g) => g.id === id) || { id, name: name || id, unit: "MT", spec: "" }; const g = { ...base, key: id + "#" + (++rowN) }; const at = list.map((x) => x.id).lastIndexOf(id); if (at >= 0) list.splice(at + 1, 0, g); else list.push(g); return g; };
    const seedRows = (rows) => { for (const b of rows) if (b && b.grade) { const id = (specOf(S, b.grade) || {}).id || idOf(b.grade); let g = list.find((x) => x.id === id && (!opt.price || val[KEY(x)] == null)); if (!g) { if (opt.price && list.some((x) => x.id === id)) g = another(id, b.grade); else { g = specOf(S, id) || { id, name: b.grade, unit: "MT", spec: "" }; list.push(g); } } val[KEY(g)] = b.qty; if (b.price != null) price[KEY(g)] = b.price; } };
    if (Array.isArray(seed)) seedRows(seed); else for (const [k, v] of Object.entries(toValues(seed || {}, S))) { val[k] = v; if (!list.some((g) => g.id === k)) list.push(specOf(S, k) || { id: k, name: k, unit: "MT", spec: "" }); }
    const box = H("div", { class: "ps-gin" + (opt.price ? " price" : "") }); const rowsEl = H("div", { class: "ps-gin-rows" }); const note = H("div", { class: "hint ps-gin-note" });
    const fire = () => box.dispatchEvent(new Event("input", { bubbles: true }));
    const paint = () => { rowsEl.innerHTML = ""; for (const g of list) { const K = KEY(g); const q = H("input", { type: "text", inputmode: "decimal", class: "ps-gin-q", "data-grade": g.id, "aria-label": g.name + " " + (g.unit || "MT"), placeholder: "—", value: val[K] != null ? String(val[K]) : "" }); q.addEventListener("input", (e) => { e.stopPropagation(); val[K] = q.value; fire(); });
        const p = opt.price ? H("input", { type: "text", inputmode: "decimal", class: "ps-gin-p", "data-grade": g.id, "aria-label": g.name + " price", placeholder: "price", value: price[K] != null ? String(price[K]) : "" }) : null; if (p) p.addEventListener("input", (e) => { e.stopPropagation(); price[K] = p.value; fire(); });
        rowsEl.append(H("div", { class: "ps-gin-row" }, H("span", { class: "ps-gin-g" }, H("b", {}, g.name), g.spec ? H("small", {}, g.spec) : null), q, H("span", { class: "ps-gin-u" }, g.unit || "MT"), p, H("button", { type: "button", class: "quiet ps-gin-x", title: "Remove " + g.name, onclick: () => { list = list.filter((x) => x !== g); delete val[K]; delete price[K]; paint(); fire(); } }, "×"))); } };
    const addSel = H("select", { class: "ps-gin-add", "aria-label": "Add a grade", onchange: () => { const id = addSel.value; addSel.value = ""; if (!id) return; if (!list.some((g) => g.id === id)) list.push(specOf(S, id)); else if (opt.price) another(id); paint(); fire(); const els = rowsEl.querySelectorAll('input.ps-gin-q[data-grade="' + id + '"]'); const el = els[els.length - 1]; if (el) el.focus(); } }, H("option", { value: "" }, "+ grade"), specs(S).map((g) => H("option", { value: g.id }, g.name + (g.spec ? " · " + g.spec : ""))));
    const paste = H("textarea", { class: "ps-gin-paste", rows: 2, placeholder: "Paste the master's figures, e.g. VLSFO: 850,5 mt — they fill the boxes" });
    paste.addEventListener("input", (e) => { e.stopPropagation(); const r = parseGrades(paste.value, S); for (const row of r.rows) { if (!list.some((g) => g.id === row.grade)) list.push(specOf(S, row.grade) || { id: row.grade, name: row.grade, unit: row.unit, spec: "" }); val[row.grade] = row.qty; } if (r.rows.length) paint(); note.textContent = r.rows.length ? "Read " + r.rows.map((x) => x.grade + " " + x.qty + (x.converted ? " (from m³)" : "")).join(" · ") + (r.unknown.length ? " — not in the grade list: " + r.unknown.join(", ") : "") + (r.skipped.length ? " · skipped: " + r.skipped.join(" | ") : "") : (paste.value.trim() ? "Nothing readable yet — write the grade and the number, one per line" : ""); fire(); });
    box.append(rowsEl, H("div", { class: "ps-gin-tools" }, addSel, H("button", { type: "button", class: "quiet ps-gin-pastebtn", onclick: () => { paste.hidden = !paste.hidden; if (!paste.hidden) paste.focus(); } }, "Paste text")), paste, note); paste.hidden = !opt.showPaste; paint();
    const read = () => { const o = {}; for (const g of list) { const q = num(val[g.id]); if (!isNaN(q)) o[g.id] = q; } return o; };
    Object.defineProperty(box, "value", { get: () => { if (!opt.price) return read(); const out = []; for (const g of list) { const K = KEY(g); const q = num(val[K]); if (isNaN(q)) continue; out.push({ grade: g.id, qty: q, price: isNaN(num(price[K])) ? null : num(price[K]) }); } return out; }, set: (v) => { for (const k of Object.keys(val)) delete val[k]; if (opt.price && Array.isArray(v)) { for (const k of Object.keys(price)) delete price[k]; list = list.filter((g) => !g.key); seedRows(v); paint(); return; } for (const [k, q] of Object.entries(toValues(v || {}, S))) { val[k] = q; if (!list.some((g) => g.id === k)) list.push(specOf(S, k) || { id: k, name: k, unit: "MT", spec: "" }); } paint(); } });
    // 4.31.17: the noon report's vessel switch — per grade, a figure the sheet filled (or a blank) follows the new vessel; a figure the
    // user typed stays. The rows become her grades, plus any grade still holding a typed figure.
    box.refill = (grades, oldV, newV) => { const was = toValues(oldV || {}, S), now = toValues(newV || {}, S); const typed = {};
      for (const [k, q] of Object.entries(val)) { if (String(q == null ? "" : q).trim() === "") continue; const n = num(q); if (isNaN(n) || was[k] == null || Math.abs(n - was[k]) > 1e-9) typed[k] = q; }
      list = (grades || []).map((g) => (typeof g === "string" ? specOf(S, g) || { id: idOf(g), name: g, unit: "MT", spec: "" } : g));
      for (const k of Object.keys(val)) delete val[k];
      for (const [k, q] of Object.entries(now)) val[k] = q;
      for (const [k, q] of Object.entries(typed)) val[k] = q;
      for (const k of Object.keys(val)) if (!list.some((g) => g.id === k)) list.push(specOf(S, k) || { id: k, name: k, unit: "MT", spec: "" });
      paint(); };
    box.problems = () => list.filter((g) => String(val[g.id] == null ? "" : val[g.id]).trim() !== "" && isNaN(num(val[g.id]))).map((g) => g.name);
    box.paste = paste; return box; }
  return { DEFAULTS, ALIAS, specs, specOf, vesselGrades, label, unitOf, num, parseGrades, toValues, inputs, idOf };
});
