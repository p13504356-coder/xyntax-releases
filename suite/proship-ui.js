/* XYNTAX PROSHIP — shared UI components (4.13): a virtualised, sortable, selectable table that stays smooth with thousands of
 * rows; filter chips; a vessel picker (saved lists, filters, hand-picked vessels); the page header and toolbar with the same
 * markup DOCUMENTS uses; KPI tiles; small monochrome charts; CSV export. Pure DOM helpers on SUITE.H — no PROSHIP state here. */
(function () {
  const H = (...a) => SUITE.H(...a);
  const PSUI = (window.PSUI = window.PSUI || {});
  const esc = (s) => String(s == null ? "" : s);
  // 4.34.2 · a value that starts with a written date ("29 Nov 2025 05:20 Port Klang") sorts by the date, not by its first digits
  const MON3 = { jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06", jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12" };
  const dateKey = (t) => { if (typeof t !== "string") return t; const m = /^\s*(\d{1,2})\s+([A-Za-z]{3})[a-z]*\.?,?\s+(\d{4})(?:[ ,]+(\d{1,2}):(\d{2}))?/.exec(t); if (!m || !MON3[m[2].toLowerCase()]) return t; return m[3] + "-" + MON3[m[2].toLowerCase()] + "-" + m[1].padStart(2, "0") + " " + (m[4] ? m[4].padStart(2, "0") + ":" + m[5] : "00:00") + t.slice(m[0].length); };
  const textOf = (x) => (x == null ? "" : typeof x === "string" || typeof x === "number" ? String(x) : x.textContent || "");
  const ls = { get(k, def) { try { const v = JSON.parse(localStorage.getItem(k) || "null"); return v == null ? def : v; } catch (e) { return def; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } } };
  const cmp = (a, b) => { const na = typeof a === "number" || a instanceof Date, nb = typeof b === "number" || b instanceof Date; if (a == null || a === "") return b == null || b === "" ? 0 : 1; if (b == null || b === "") return -1; if (na && nb) return a - b; const sa = String(a), sb = String(b); const fa = parseFloat(sa.replace(/[^0-9.-]/g, "")), fb = parseFloat(sb.replace(/[^0-9.-]/g, "")); if (!isNaN(fa) && !isNaN(fb) && /^[\s$€£0-9.,-]+/.test(sa) && /^[\s$€£0-9.,-]+/.test(sb)) return fa - fb; return sa.localeCompare(sb, undefined, { numeric: true, sensitivity: "base" }); };
  const scrollParent = (el) => { let p = el.parentElement; while (p && p !== document.body) { const o = getComputedStyle(p).overflowY; if (o === "auto" || o === "scroll") return p; p = p.parentElement; } return null; };

  // ---------- table
  // spec: { id, cols: [{ k, label, w, align: "right", cell(row) → node|string, sort: true|fn(row) → value, title, hidden, hideable, wrap, card: "title"|"sub"|"right"|"skip" }],
  //         rows, key(row) → id, sort: { k, dir: 1|-1 }, onSort, onRow(row, ev), virtual, rowHeight, empty, selectable, selected: Set, onSelect(set), chooser, rowClass(row), compact }
  PSUI.table = function (spec) {
    spec = spec || {}; const id = spec.id || "t"; const cols0 = spec.cols || []; const rowH = spec.rowHeight || (spec.compact ? 36 : 44); const key = spec.key || ((r, i) => (r && (r.id || r.key)) || i);
    const state = { rows: spec.rows || [], sort: ls.get("xyntax.ps.sort." + id, spec.sort || null), hidden: new Set(ls.get("xyntax.ps.cols." + id, (cols0.filter((c) => c.hidden).map((c) => c.k)))), selected: spec.selected || new Set(), cur: -1, start: 0, end: 0 };
    const phone = SUITE.isMobile && SUITE.isMobile();
    const wrap = H("div", { class: "psu-tw sh-tw" + (spec.compact ? " compact" : "") + (phone ? " phone" : ""), tabindex: "0" });
    const table = H("table", { class: "sh-t ps-t psu-t" }); const thead = H("thead"), tbody = H("tbody"); table.append(thead, tbody); wrap.append(table);
    let timer = null, sp = null, onScroll = null, ro = null;
    const visCols = () => cols0.filter((c) => !state.hidden.has(c.k));
    const sortVal = (c, r) => dateKey(typeof c.sort === "function" ? c.sort(r) : c.cell ? textOf(c.cell(r)) : r[c.k]);
    const sorted = () => { const rows = state.rows.slice(); const s = state.sort; if (!s || !s.k) return rows; const c = cols0.find((x) => x.k === s.k); if (!c || c.sort === false) return rows; const vals = new Map(); for (const r of rows) vals.set(r, sortVal(c, r)); rows.sort((a, b) => cmp(vals.get(a), vals.get(b)) * (s.dir || 1)); return rows; };
    let view = [];
    const setSort = (k) => { const s = state.sort; state.sort = !s || s.k !== k ? { k, dir: 1 } : s.dir === 1 ? { k, dir: -1 } : null; ls.set("xyntax.ps.sort." + id, state.sort); if (spec.onSort) spec.onSort(state.sort); render(); };
    const chooser = (btn) => SUITE.menu(btn, cols0.filter((c) => c.hideable !== false && c.k !== "__sel").map((c) => ({ l: (state.hidden.has(c.k) ? "☐ " : "☑ ") + (c.label || c.k), fn: () => { if (state.hidden.has(c.k)) state.hidden.delete(c.k); else if (visCols().length > 2) state.hidden.add(c.k); ls.set("xyntax.ps.cols." + id, [...state.hidden]); render(); } })));
    const allSelected = () => view.length && view.every((r, i) => state.selected.has(key(r, i)));
    const drawHead = () => {
      thead.innerHTML = ""; const tr = H("tr");
      if (spec.selectable) { const cb = H("input", { type: "checkbox", class: "psu-cb", "aria-label": "Select all", checked: allSelected() ? true : null, onchange: () => { if (cb.checked) view.forEach((r, i) => state.selected.add(key(r, i))); else state.selected.clear(); if (spec.onSelect) spec.onSelect(state.selected); render(); } }); tr.append(H("th", { class: "sel" }, cb)); }
      for (const c of visCols()) { const on = state.sort && state.sort.k === c.k; tr.append(H("th", { class: (c.align === "right" ? "num" : "") + (c.sort === false ? "" : " sortable") + (on ? " on" : ""), style: c.w ? "width:" + c.w : null, title: c.title || (c.sort === false ? "" : "Sort by " + (c.label || c.k)), onclick: c.sort === false ? null : () => setSort(c.k) }, H("span", { class: "lbl" }, c.label || ""), c.sort === false ? null : H("span", { class: "dir" }, on ? (state.sort.dir === 1 ? "▲" : "▼") : ""))); }
      const xb = spec.enlarge === false ? null : H("button", { type: "button", class: "quiet psu-x sh-xbtn", title: "Enlarge" + (spec.title ? " · " + spec.title : ""), "aria-label": "Enlarge the table", onclick: (e) => { e.stopPropagation(); enlargeTable(); } }, "⤢");
      if (spec.chooser !== false && cols0.length > 3) tr.append(H("th", { class: "more" }, xb, H("button", { class: "quiet psu-cols", title: "Columns", onclick: (e) => { e.stopPropagation(); chooser(e.currentTarget); } }, "⋯")));
      else if (xb) tr.append(H("th", { class: "more" }, xb));
      thead.append(tr);
    };
    const rowEl = (r, i) => {
      const k = key(r, i); const tr = H("tr", { class: (spec.onRow ? "click" : "") + (state.selected.has(k) ? " selected" : "") + (state.cur === i ? " cur" : "") + (spec.rowClass ? " " + (spec.rowClass(r) || "") : ""), "data-i": i, onclick: spec.onRow ? (e) => { if (e.target.closest("button,input,select,a,.psu-cb")) return; state.cur = i; spec.onRow(r, e); } : null });
      if (spec.selectable) { const cb = H("input", { type: "checkbox", class: "psu-cb", checked: state.selected.has(k) ? true : null, onchange: () => { if (cb.checked) state.selected.add(k); else state.selected.delete(k); if (spec.onSelect) spec.onSelect(state.selected); tr.classList.toggle("selected", cb.checked); const hc = thead.querySelector("input"); if (hc) hc.checked = allSelected(); } }); tr.append(H("td", { class: "sel" }, cb)); }
      for (const c of visCols()) { let v; try { v = c.cell ? c.cell(r) : r[c.k]; } catch (e) { v = "—"; } tr.append(H("td", { class: (c.align === "right" ? "num" : "") + (c.wrap ? " wrap" : ""), title: c.titleOf ? c.titleOf(r) : null }, v == null ? "" : v)); }
      if (spec.chooser !== false && cols0.length > 3) tr.append(H("td", { class: "more" }));
      return tr;
    };
    const cardEl = (r, i) => { const k = key(r, i); const cols = visCols(); const t = cols.find((c) => c.card === "title") || cols[0]; const right = cols.find((c) => c.card === "right"); const subs = cols.filter((c) => c !== t && c !== right && c.card !== "skip").slice(0, 4); const get = (c) => { try { return c.cell ? c.cell(r) : r[c.k]; } catch (e) { return "—"; } }; const card = H("div", { class: "psu-card" + (spec.onRow ? " click" : "") + (state.selected.has(k) ? " selected" : ""), onclick: spec.onRow ? (e) => { if (e.target.closest("button,input,select,a")) return; spec.onRow(r, e); } : null }, spec.selectable ? H("input", { type: "checkbox", class: "psu-cb", checked: state.selected.has(k) ? true : null, onchange: (e) => { if (e.target.checked) state.selected.add(k); else state.selected.delete(k); if (spec.onSelect) spec.onSelect(state.selected); card.classList.toggle("selected", e.target.checked); } }) : null, H("div", { class: "psu-cmain" }, H("div", { class: "psu-ct" }, get(t)), H("div", { class: "psu-cs" }, subs.map((c) => { const v = get(c); return v == null || v === "" || v === "—" ? null : H("span", {}, H("i", {}, (c.label || c.k) + " "), v); }))), right ? H("div", { class: "psu-cr" }, get(right)) : null); return card; };
    const render = () => {
      view = sorted(); drawHead(); tbody.innerHTML = "";
      // 4.32.3 · scrollx (the table is wider than its box) is kept in both modes and as the box resizes: the fade at the right edge,
      // and the last header cell with ⤢ and ⋯ sticks to the right edge of what is visible (proship.css) so the controls never need a
      // sideways scroll
      const sx = () => wrap.classList.toggle("scrollx", wrap.scrollWidth > wrap.clientWidth + 2);
      if (!ro && window.ResizeObserver) { ro = new ResizeObserver(() => { if (onScroll) onScroll(); sx(); }); ro.observe(wrap); }
      if (!view.length) { tbody.append(H("tr", {}, H("td", { colspan: visCols().length + (spec.selectable ? 1 : 0) + 1, class: "sh-dim psu-empty" }, spec.empty || "Nothing here yet."))); wrap.classList.remove("virtual"); requestAnimationFrame(sx); return; }
      const virtual = spec.virtual === true || (spec.virtual !== false && view.length > 120);
      wrap.classList.toggle("virtual", virtual); wrap.classList.toggle("cards", !!phone);
      if (phone) { tbody.remove(); table.remove(); if (!wrap.querySelector(".psu-cards")) wrap.append(H("div", { class: "psu-cards" })); const box = wrap.querySelector(".psu-cards"); box.innerHTML = ""; const sortBtn = H("button", { class: "quiet psu-sortbtn", onclick: (e) => SUITE.menu(e.currentTarget, cols0.filter((c) => c.sort !== false && c.k !== "__sel").map((c) => ({ l: (c.label || c.k) + (state.sort && state.sort.k === c.k ? (state.sort.dir === 1 ? " ▲" : " ▼") : ""), on: state.sort && state.sort.k === c.k, fn: () => setSort(c.k) }))) }, "Sort" + (state.sort ? ": " + ((cols0.find((c) => c.k === state.sort.k) || {}).label || "") : "")); box.append(H("div", { class: "psu-cardtools" }, H("span", { class: "sh-dim" }, view.length.toLocaleString() + " row" + (view.length === 1 ? "" : "s")), spec.enlarge === false ? null : H("button", { type: "button", class: "quiet psu-x sh-xbtn", title: "Enlarge", "aria-label": "Enlarge the table", onclick: () => enlargeTable() }, "⤢"), spec.selectable ? H("button", { class: "quiet", onclick: () => { if (allSelected()) state.selected.clear(); else view.forEach((r, i) => state.selected.add(key(r, i))); if (spec.onSelect) spec.onSelect(state.selected); render(); } }, allSelected() ? "Clear" : "Select all") : null, sortBtn)); const lim = virtual ? Math.min(view.length, 80) : view.length; for (let i = 0; i < lim; i++) box.append(cardEl(view[i], i)); if (view.length > lim) { let shown = lim; const more = H("button", { class: "quiet psu-more", onclick: () => { const to = Math.min(view.length, shown + 80); for (let i = shown; i < to; i++) box.insertBefore(cardEl(view[i], i), more); shown = to; if (shown >= view.length) more.remove(); else more.textContent = "Show " + Math.min(80, view.length - shown) + " more of " + (view.length - shown).toLocaleString(); } }, "Show 80 more of " + (view.length - lim).toLocaleString()); box.append(more); } return; }
      if (!table.isConnected) wrap.append(table);
      if (!virtual) { for (let i = 0; i < view.length; i++) tbody.append(rowEl(view[i], i)); requestAnimationFrame(sx); return; }
      // windowed rows: spacer rows above and below keep the scroll geometry; the window follows the nearest scrolling ancestor
      const top = H("tr", { class: "psu-sp" }, H("td", { colspan: 99 })), bot = H("tr", { class: "psu-sp" }, H("td", { colspan: 99 })); tbody.append(top, bot);
      // the scrolling ancestor is found once the wrapper is in the document (it is built before being appended); until then the viewport is the window
      if (!onScroll) { onScroll = () => { if (timer) return; timer = requestAnimationFrame(() => { timer = null; if (wrap.isConnected && wrap._paint) wrap._paint(); }); }; window.addEventListener("resize", onScroll, { passive: true }); }
      const ensureSp = () => { if (sp) return sp; if (!wrap.isConnected) return null; const p = scrollParent(wrap); if (p) { sp = p; sp.addEventListener("scroll", onScroll, { passive: true }); } return sp; };
      const paint = () => { const parent = ensureSp(); const pr = parent ? parent.getBoundingClientRect() : { top: 0 }; const tr = tbody.getBoundingClientRect(); const offset = tr.top - pr.top; const viewH = parent && parent.clientHeight ? parent.clientHeight : window.innerHeight; const first = Math.max(0, Math.floor((-offset) / rowH) - 8); const count = Math.ceil(viewH / rowH) + 16; const last = Math.min(view.length, first + count); if (first === state.start && last === state.end && tbody.children.length > 2) return; state.start = first; state.end = last; while (tbody.children.length > 2) tbody.children[1].remove(); const frag = document.createDocumentFragment(); for (let i = first; i < last; i++) frag.append(rowEl(view[i], i)); tbody.insertBefore(frag, bot); top.firstChild.style.height = first * rowH + "px"; bot.firstChild.style.height = Math.max(0, (view.length - last) * rowH) + "px"; };
      wrap._paint = paint; state.start = -1; state.end = -1; paint(); requestAnimationFrame(() => { if (wrap.isConnected) { paint(); sx(); } });
    };
    wrap.addEventListener("keydown", (e) => { if (!view.length || !spec.onRow) return; if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); state.cur = Math.max(0, Math.min(view.length - 1, state.cur + (e.key === "ArrowDown" ? 1 : -1))); for (const tr of tbody.querySelectorAll("tr.cur")) tr.classList.remove("cur"); const tr = tbody.querySelector('tr[data-i="' + state.cur + '"]'); if (tr) { tr.classList.add("cur"); tr.scrollIntoView({ block: "nearest" }); } } else if (e.key === "Enter" && state.cur >= 0) { e.preventDefault(); spec.onRow(view[state.cur], e); } });
    // 4.20 · enlarge: the whole table moves into the full-window view and back (SUITE.enlarge); the windowing follows its new scroller
    const titleOf = () => { if (spec.title) return spec.title; const p = wrap.closest && wrap.closest(".sh-panel, .panel, .psf-panel, section, .ps-vfile > div"); const h = p && p.querySelector("h3, h2, .ttl"); if (h) return (h.childNodes[0] && h.childNodes[0].textContent || h.textContent).trim(); const hd = document.querySelector("#sapp .ps-pagehead h2, #sapp .vt-head h2, #sapp h1"); return hd ? hd.textContent.trim() : ""; };
    const enlargeTable = () => { if (!(typeof SUITE !== "undefined" && SUITE.enlarge)) return; SUITE.enlarge(wrap, { title: titleOf() }); };
    wrap.rehome = () => { if (sp) { try { sp.removeEventListener("scroll", onScroll); } catch (e) { /* ignore */ } sp = null; } state.start = -1; state.end = -1; if (wrap._paint) wrap._paint(); wrap.classList.toggle("scrollx", wrap.scrollWidth > wrap.clientWidth + 2); };
    wrap.enlarge = enlargeTable;
    wrap.update = (rows) => { state.rows = rows || []; render(); return wrap; };
    wrap.rows = () => view.slice(); wrap.selected = () => state.selected; wrap.setSelected = (set) => { state.selected = set || new Set(); render(); }; wrap.sortState = () => state.sort; wrap.repaint = () => { if (wrap._paint) wrap._paint(); };
    render();
    return wrap;
  };

  // ---------- filter chips (the suite's own chips with counts)
  PSUI.filters = (spec) => SUITE.chips(spec);

  // ---------- CSV export: cols [{ label, value(row) }], rows → downloads <name>.csv
  PSUI.csv = function (cols, rows, name) {
    const q = (v) => { const s = String(v == null ? "" : v); return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const lines = [cols.map((c) => q(c.label)).join(",")]; for (const r of rows) lines.push(cols.map((c) => q(typeof c.value === "function" ? c.value(r) : r[c.k])).join(","));
    const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    if (SUITE.download) return SUITE.download(name || "export.csv", blob);
    const a = H("a", { href: URL.createObjectURL(blob), download: name || "export.csv" }); document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 800);
  };

  // ---------- page header and toolbar, the DOCUMENTS way: .vt-head (crumbs, h2, sub) then .sh-toolbar.vt-tools (segments left, actions right)
  PSUI.page = function (o) {
    o = o || {}; const head = H("div", { class: "vt-head ps-head" });
    if (o.crumbs && o.crumbs.length) head.append(H("div", { class: "vt-crumbs" }, o.crumbs.map((c, i) => [i ? H("span", { class: "sep" }, "›") : null, c.fn ? H("button", { class: "quiet", onclick: c.fn }, c.l) : H("span", {}, c.l)])));
    // 4.17 · the title row: title and subtitle stacked on the left (as DOCUMENTS and NOTES), the page's actions on the right of the title
    const hd = H("div", { class: "nt-hd" }, H("h2", {}, o.title || ""), o.subtitle || o.subExtra ? H("div", { class: "nt-sub" }, o.subtitle || "", o.subExtra || null) : null);
    const acts = (o.actions || []).filter(Boolean);
    head.append(H("div", { class: "ps-titlerow" }, hd, H("div", { class: "ps-acts ps-tools-r" + (acts.length ? "" : " empty") }, ...acts)));
    return head;
  };
  // 4.15 · one segment for every sub-page switch and period chooser: items [[id, label, count?]] — a count of 0 shows the item dimmed, never hides it
  PSUI.segment = function (items, value, onChange, opt) {
    opt = opt || {}; const on = (id) => (typeof opt.isOn === "function" ? opt.isOn(id, value) : id === value);
    return H("div", { class: "sh-seg ps-seg" + (opt.cls ? " " + opt.cls : ""), role: "tablist" }, (items || []).filter(Boolean).map((it) => H("button", { type: "button", role: "tab", "aria-selected": on(it[0]) ? "true" : "false", class: (on(it[0]) ? "on" : "") + (it[2] === 0 && opt.dimEmpty !== false ? " empty" : ""), title: it[3] || "", onclick: () => onChange && onChange(it[0]) }, it[1], it[2] != null && it[2] !== "" ? H("span", { class: "n" }, String(it[2])) : null)));
  };
  PSUI.toolbar = function (o) {
    o = o || {}; const bar = H("div", { class: "sh-toolbar vt-tools ps-tools" });
    const left = H("div", { class: "ps-tools-l" }); if (o.seg) left.append(PSUI.segment(o.seg.items, o.seg.value, o.seg.onChange, o.seg)); if (o.left) left.append(...[].concat(o.left).filter(Boolean)); bar.append(left);
    const right = H("div", { class: "ps-tools-r" }); if (o.rightSeg) right.append(PSUI.segment(o.rightSeg.items, o.rightSeg.value, o.rightSeg.onChange, o.rightSeg)); if (o.right) right.append(...[].concat(o.right).filter(Boolean)); bar.append(right);
    return bar;
  };

  // ---------- KPI tiles: [{ l, v, d, cls, onclick }] — a tile with onclick is a real button
  // 4.17 · the grid takes its column count from the number of tiles, so a row never ends in a lone tile (5 → 3+2 reads worse than 5 across)
  const kpiCols = (n) => (n <= 4 ? n : n === 5 ? 5 : n === 6 ? 3 : n <= 8 ? 4 : n === 9 ? 3 : 4);
  PSUI.kpis = (items) => H("div", { class: "sh-kpis ps-kpis cols" + kpiCols(items.filter(Boolean).length) }, items.filter(Boolean).map((k) => H(k.onclick ? "button" : "div", { class: "sh-kpi" + (k.onclick ? " click" : "") + (k.cls ? " " + k.cls : ""), type: k.onclick ? "button" : null, onclick: k.onclick || null, title: k.title || null }, H("div", { class: "l" }, k.l), H("div", { class: "v" }, k.v), k.d ? H("div", { class: "d" }, k.d) : null)));

  // ---------- small monochrome charts (inline SVG): bars { labels, series: [{ name, values }], format }, line { labels, series }
  const fmtAxis = (n) => (Math.abs(n) >= 1e6 ? (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M" : Math.abs(n) >= 1e3 ? Math.round(n / 1e3) + "k" : String(Math.round(n)));
  PSUI.chart = function (o) {
    o = o || {}; const W = o.width || 640, Hh = o.height || 180, padL = 44, padB = 26, padT = 10, padR = 8; const labels = o.labels || []; const series = (o.series || []).filter((s) => s && s.values);
    const all = series.flatMap((s) => s.values).filter((v) => v != null); const max = Math.max(1, ...all.map((v) => Math.abs(v))); const min = Math.min(0, ...all);
    const y = (v) => padT + (Hh - padT - padB) * (1 - (v - min) / (max - min || 1));
    const n = Math.max(1, labels.length); const bw = (W - padL - padR) / n;
    const parts = [];
    for (let g = 0; g <= 4; g++) { const v = min + (max - min) * g / 4; parts.push('<line x1="' + padL + '" x2="' + (W - padR) + '" y1="' + y(v) + '" y2="' + y(v) + '" class="grid"/><text x="' + (padL - 6) + '" y="' + (y(v) + 3) + '" text-anchor="end" class="ax">' + fmtAxis(v) + "</text>"); }
    if (o.type === "line") { series.forEach((s, si) => { const pts = s.values.map((v, i) => v == null ? null : (padL + bw * (i + 0.5)) + "," + y(v)).filter(Boolean); parts.push('<polyline points="' + pts.join(" ") + '" class="ln s' + si + '"/>'); s.values.forEach((v, i) => { if (v != null) parts.push('<circle cx="' + (padL + bw * (i + 0.5)) + '" cy="' + y(v) + '" r="2.2" class="dot s' + si + '"><title>' + esc(labels[i]) + " · " + esc(s.name || "") + " " + esc(o.format ? o.format(v) : v) + "</title></circle>"); }); }); }
    else { const k = series.length || 1; const gap = bw * 0.18; const w1 = (bw - gap * 2) / k; series.forEach((s, si) => { s.values.forEach((v, i) => { if (v == null) return; const x = padL + bw * i + gap + w1 * si; const y0 = y(0), y1 = y(v); parts.push('<rect x="' + x + '" y="' + Math.min(y0, y1) + '" width="' + Math.max(1, w1 - 1) + '" height="' + Math.max(1, Math.abs(y0 - y1)) + '" class="bar s' + si + (v < 0 ? " neg" : "") + '"><title>' + esc(labels[i]) + " · " + esc(s.name || "") + " " + esc(o.format ? o.format(v) : v) + "</title></rect>"); }); }); }
    const step = Math.ceil(n / 12); labels.forEach((l, i) => { if (i % step === 0 || i === n - 1) parts.push('<text x="' + (padL + bw * (i + 0.5)) + '" y="' + (Hh - 8) + '" text-anchor="middle" class="ax">' + esc(l) + "</text>"); });
    const svg = H("div", { class: "psu-chart" }); svg.innerHTML = '<svg viewBox="0 0 ' + W + " " + Hh + '" preserveAspectRatio="none">' + parts.join("") + "</svg>" + (series.length > 1 ? '<div class="psu-legend">' + series.map((s, si) => '<span class="s' + si + '"><i></i>' + esc(s.name || "") + "</span>").join("") + "</div>" : "");
    // 4.20 · enlarge: the chart redraws at the size it is given (SUITE.enlarge calls redraw after the move and after the close)
    svg._spec = o; svg.redraw = (w, h) => { const big = svg.classList.contains("sh-enlarged"); const n = PSUI.chart(Object.assign({}, o, { width: big && w ? Math.round(w) : (o.width || 640), height: big && h ? Math.round(Math.min(h, w * 0.6)) : (o.height || 180), _noX: true })); const svgEl = svg.querySelector("svg"); const nn = n.querySelector("svg"); if (svgEl && nn) svgEl.replaceWith(nn); };
    if (!o._noX && typeof SUITE !== "undefined" && SUITE.enlargeable) SUITE.enlargeable(svg, o.title || "", { cls: "psu-x" });
    return svg;
  };

  // ---------- vessel picker: a saved list, a filter, or hand-picked vessels
  // spec: { value: { kind: "all"|"list"|"filter"|"manual", id, name, vesselIds, filter }, lists: [{ id, name, kind, vesselIds, filter }], vessels: [{ id, name, imo, status, type, ownerCpId, managerEntityId, charterer }],
  //         facets: { status: [[v,l]], type: [...], owner: [...], entity: [...], charterer: [...] }, resolve(sel) → vesselIds, onChange(sel), onSave(name, sel), onDelete(id) }
  PSUI.vesselPicker = function (spec) {
    spec = spec || {}; const v = spec.value || { kind: "all" }; const vessels = spec.vessels || []; const lists = spec.lists || [];
    const count = (sel) => { try { return (spec.resolve ? spec.resolve(sel) : sel.vesselIds || []).length; } catch (e) { return 0; } };
    const label = v.kind === "all" || !v.kind ? "All vessels" : v.name || (v.kind === "manual" ? "Picked vessels" : "Filtered");
    const btn = H("button", { class: "ps-picker" + (v.kind && v.kind !== "all" ? " on" : ""), title: "Choose which vessels this page shows" }, SUITE.glyph ? SUITE.glyph("list") : null, H("span", { class: "nm" }, label), H("span", { class: "n" }, count(v).toLocaleString()), H("span", { class: "car" }, "▾"));
    const pickDialog = async () => {
      const chosen = new Set(v.kind === "manual" ? v.vesselIds || [] : []); const q = H("input", { placeholder: "Type to find vessels (name, IMO, type)", class: "ps-pickq" }); const list = H("div", { class: "ps-picklist" }); const cnt = H("span", { class: "sh-dim" });
      const paint = () => { const s = q.value.trim().toLowerCase(); const hits = vessels.filter((x) => !s || [x.name, x.imo, x.type, x.flag].some((t) => String(t || "").toLowerCase().includes(s))); list.innerHTML = ""; for (const x of hits.slice(0, 200)) { const cb = H("input", { type: "checkbox", checked: chosen.has(x.id) ? true : null, onchange: () => { if (cb.checked) chosen.add(x.id); else chosen.delete(x.id); cnt.textContent = chosen.size + " picked"; } }); list.append(H("label", { class: "ps-pickrow" }, cb, H("b", {}, x.name), H("span", { class: "sh-dim" }, [x.type, x.imo ? "IMO " + x.imo : null].filter(Boolean).join(" · ")))); } if (hits.length > 200) list.append(H("div", { class: "sh-dim" }, "and " + (hits.length - 200).toLocaleString() + " more — narrow the search")); cnt.textContent = chosen.size + " picked"; list._hits = hits; };
      q.addEventListener("input", paint); paint();
      const body = H("div", { class: "ps-pickbody" }, q, H("div", { class: "row", style: "justify-content:space-between;margin:6px 0" }, cnt, H("span", {}, H("button", { class: "quiet", onclick: () => { for (const x of list._hits || []) chosen.add(x.id); paint(); } }, "All matches"), H("button", { class: "quiet", onclick: () => { chosen.clear(); paint(); } }, "None"))), list);
      const r = await SUITE.dialog({ title: "Pick vessels", body, ok: "Use these" }); if (!r) return; spec.onChange({ kind: "manual", name: "Picked vessels", vesselIds: [...chosen] });
    };
    const filterDialog = async () => {
      const f = (v.kind === "filter" && v.filter) || {}; const fac = spec.facets || {}; const fields = [];
      const opt = (key, label) => { if (!fac[key] || !fac[key].length) return; fields.push({ k: key, label, type: "select", value: f[key] || "", options: [{ v: "", l: "Any" }, ...fac[key].map((x) => ({ v: x[0], l: x[1] }))] }); };
      opt("status", "Status"); opt("type", "Type"); opt("employment", "Employment"); opt("owner", "Owner"); opt("entity", "Managing entity"); opt("charterer", "Charterer");
      const r = await SUITE.dialog({ title: "Filter vessels", text: "Every page then shows only the vessels that match; save it as a list to come back to it.", fields, ok: "Apply" }); if (!r) return;
      const filter = {}; for (const k of Object.keys(r)) if (r[k]) filter[k] = r[k]; const name = Object.entries(filter).map(([k, val]) => { const o = (fac[k] || []).find((x) => x[0] === val); return o ? o[1] : val; }).join(" · ") || "Filtered";
      spec.onChange({ kind: "filter", name, filter });
    };
    const saveDialog = async () => { if (!spec.onSave) return; const r = await SUITE.dialog({ title: "Save as a list", fields: [{ k: "name", label: "Name", value: v.name && v.kind !== "all" ? v.name : "" }], ok: "Save", validate: (x) => { if (!x.name.trim()) throw new Error("Give the list a name"); } }); if (r) spec.onSave(r.name.trim(), v); };
    btn.addEventListener("click", (e) => { const items = [{ l: "All vessels", d: vessels.length.toLocaleString(), on: !v.kind || v.kind === "all", fn: () => spec.onChange({ kind: "all" }) }];
      if (lists.length) { items.push({ sep: 1 }); for (const l of lists) items.push({ l: l.name, d: count(l).toLocaleString() + (l.kind === "filter" ? " · filter" : ""), on: v.kind === "list" && v.id === l.id, fn: () => spec.onChange({ kind: "list", id: l.id, name: l.name, vesselIds: l.vesselIds, filter: l.filter, listKind: l.kind }) }); }
      items.push({ sep: 1 }, { l: "Filter…", fn: filterDialog }, { l: "Pick vessels…", fn: pickDialog }); if (v.kind && v.kind !== "all" && v.kind !== "list" && spec.onSave) items.push({ l: "Save as a list…", fn: saveDialog }); if (v.kind === "list" && spec.onDelete) items.push({ l: "Remove this list", fn: () => spec.onDelete(v.id), danger: 1 });
      SUITE.menu(e.currentTarget, items); });
    return btn;
  };

  // ---------- a searchable select for long option lists (vessels, counterparties): input + datalist-like dropdown, value = option id
  PSUI.searchSelect = function (o) {
    o = o || {}; const opts = o.options || []; const inp = H("input", { placeholder: o.placeholder || "Type to search…", autocomplete: "off", class: "ps-ss" }); const dd = H("div", { class: "ps-ssdd", style: "display:none" }); const box = H("div", { class: "ps-sswrap" }, inp, dd); let value = o.value || ""; const byId = new Map(opts.map((x) => [x.v, x]));
    const show = (v) => { value = v; const x = byId.get(v); inp.value = x ? x.l : ""; box.dispatchEvent(new Event("input", { bubbles: true })); if (o.onChange) o.onChange(v); };
    const paint = () => { const s = inp.value.trim().toLowerCase(); const hits = opts.filter((x) => !s || x.l.toLowerCase().includes(s) || String(x.d || "").toLowerCase().includes(s)).slice(0, 40); dd.innerHTML = ""; for (const x of hits) dd.append(H("button", { type: "button", class: x.v === value ? "on" : "", onmousedown: (e) => { e.preventDefault(); show(x.v); dd.style.display = "none"; } }, x.l, x.d ? H("span", { class: "sh-dim" }, " " + x.d) : null)); if (o.allowNew && s && !hits.some((x) => x.l.toLowerCase() === s)) dd.append(H("button", { type: "button", class: "new", onmousedown: (e) => { e.preventDefault(); dd.style.display = "none"; o.allowNew(inp.value.trim(), (x) => { opts.push(x); byId.set(x.v, x); show(x.v); }); } }, "+ New: " + inp.value.trim())); dd.style.display = hits.length || o.allowNew ? "" : "none"; };
    inp.addEventListener("focus", paint); inp.addEventListener("input", paint); inp.addEventListener("blur", () => setTimeout(() => { dd.style.display = "none"; if (!byId.has(value) || (byId.get(value).l !== inp.value && inp.value.trim() === "")) { value = ""; inp.value = ""; } else if (byId.has(value)) inp.value = byId.get(value).l; }, 120));
    Object.defineProperty(box, "value", { get: () => value, set: (v) => show(v) }); box.read = () => value; if (value) inp.value = (byId.get(value) || {}).l || "";
    return box;
  };

  // ---------- 4.31.10 · coordinates as typed, ports picked from the list
  // coordField(k, label, "lat"|"lon", value) → a form field: text (N/S/E/W, °, ′, hyphens, commas), the reading shown live under it
  const PSEX = () => window.PSE;
  PSUI.coordField = function (k, label, axis, value, extra) {
    const v0 = value == null || value === "" || !isFinite(+value) ? "" : PSEX().fmtCoord(+value, axis);
    const pk = (extra && extra.pair) || { lat: "lat", lon: "lon" };
    // both coordinates pasted into either box ("01°49.00’N ,104°42.00E") are split: the N/S one to Latitude, the E/W one to Longitude
    const attach = (inp, inputs) => { const split = () => { const pr = PSEX().parseCoordPair(inp.value); const li = inputs[pk.lat], lo = inputs[pk.lon]; if (!pr || !pr.ok || !li || !lo) return; li.value = pr.latText; lo.value = pr.lonText; (inp === li ? lo : li).dispatchEvent(new Event("input", { bubbles: true })); };
      inp.addEventListener("input", (e) => { if (!e.inputType || /Paste|Drop|Replacement/.test(e.inputType)) split(); }); inp.addEventListener("change", split); };
    return { k, label, type: "text", inputmode: "text", autocapitalize: "characters", placeholder: axis === "lon" ? "104°42.00′E or 104.7" : "01°49.00′N or 1.8167", value: v0, coord: axis, orig: v0 ? +value : null, live: (v) => PSEX().coordHint(v, axis), attach, ...(extra || {}) };
  };
  // coordPair(vals, { lat: "lat", lon: "lon", origLat, origLon, required }) → { lat, lon } in decimal degrees; a pair typed into one
  // box is read as both; an unreadable value throws at its own field
  PSUI.coordPair = function (vals, o) {
    o = o || {}; const kl = o.lat || "lat", ko = o.lon || "lon"; let tl = vals[kl] == null ? "" : String(vals[kl]), to = vals[ko] == null ? "" : String(vals[ko]); const P = PSEX();
    for (const t of [tl, to]) { if (P.parseCoord(t, "lat").ok && P.parseCoord(t, "lon").ok) continue; const pr = P.parseCoordPair(t); if (pr && pr.ok) { tl = pr.latText; to = pr.lonText; break; } }
    const lat = PSUI.coordVal(tl, "lat", { field: kl, orig: o.origLat }), lon = PSUI.coordVal(to, "lon", { field: ko, orig: o.origLon });
    if (o.required && (lat == null || lon == null)) { const e = new Error(o.requiredText || "Coordinates required (or a port name)"); e.field = lat == null ? kl : ko; throw e; }
    if ((lat == null) !== (lon == null)) { const e = new Error(lat == null ? "Latitude missing" : "Longitude missing"); e.field = lat == null ? kl : ko; throw e; }
    return { lat, lon };
  };
  // coordVal(text, axis, { field, required, orig }) → decimal degrees (6 dp) | null; an unreadable value throws at its field.
  // An untouched value keeps the stored number exactly (the form shows it to 0.01′).
  PSUI.coordVal = function (text, axis, o) {
    o = o || {}; const P = PSEX(); const t = text == null ? "" : String(text).trim();
    if (o.orig != null && isFinite(+o.orig) && t === P.fmtCoord(+o.orig, axis)) return +o.orig;
    const r = P.parseCoord(t, axis); if (!r.ok) { const e = new Error(r.error); e.field = o.field || axis; throw e; }
    if (r.empty) { if (o.required) { const e = new Error(o.requiredText || "Coordinates required (or a port name)"); e.field = o.field || axis; throw e; } return null; }
    return r.value;
  };
  const llText = (p) => (p && p.lat != null && PSEX() ? PSEX().fmtCoord(p.lat, "lat") + "  " + PSEX().fmtCoord(p.lon, "lon") : "no position");
  // portSuggest(input, { search(q) → ports, geocode?(q) → Promise<hits>, onPick(port), onEnter?(text), onBlur?(text) }) → type-ahead under a text input
  PSUI.portSuggest = function (input, o) {
    const list = H("div", { class: "psu-pplist", role: "listbox", style: "display:none" }); let items = [], cur = -1, seq = 0;
    const close = () => { seq++; list.style.display = "none"; list.innerHTML = ""; items = []; cur = -1; };
    const mark = () => { [...list.querySelectorAll(".psu-ppitem[data-i]")].forEach((el) => el.classList.toggle("on", +el.dataset.i === cur)); };
    const choose = (p) => { close(); o.onPick(p); };
    const row = (p, i, extra) => H("div", { class: "psu-ppitem", role: "option", "data-i": String(i), onmousedown: (e) => { e.preventDefault(); choose(p); } }, H("b", {}, p.name), H("span", { class: "psu-ppcc" }, [p.admin, p.country, p.region].filter(Boolean).join(" · ")), H("span", { class: "psu-ppll" }, llText(p)), extra || null);
    const lookup = async (q) => { const my = ++seq; list.innerHTML = ""; list.append(H("div", { class: "psu-ppitem psu-ppmsg" }, "Looking up “" + q + "”…"));
      try { const hits = await o.geocode(q); if (my !== seq) return; items = hits.map((x) => ({ ...x, source: "geocoder" })); list.innerHTML = ""; if (!items.length) list.append(H("div", { class: "psu-ppitem psu-ppmsg" }, "Nothing found — add it in Settings → Ports")); items.forEach((p, i) => list.append(row(p, i, H("span", { class: "psu-ppcc" }, "gazetteer — check the position on the map")))); cur = items.length ? 0 : -1; mark(); }
      catch (e) { if (my !== seq) return; list.innerHTML = ""; list.append(H("div", { class: "psu-ppitem psu-ppmsg" }, "Lookup failed: " + e.message)); } };
    const render = () => { const q = input.value.trim(); if (!q) return close(); seq++; items = o.search(q) || []; list.innerHTML = ""; items.forEach((p, i) => list.append(row(p, i)));
      if (!items.length) list.append(H("div", { class: "psu-ppitem psu-ppmsg" }, "Unknown port — pick from the list or add it in Settings → Ports"));
      if (o.geocode && q.length > 2) list.append(H("div", { class: "psu-ppitem psu-ppgeo", onmousedown: (e) => { e.preventDefault(); lookup(q); } }, "Look up “" + q + "” in the gazetteer…"));
      cur = items.length ? 0 : -1; mark(); list.style.display = ""; };
    input.setAttribute("autocomplete", "off"); input.setAttribute("spellcheck", "false"); input.setAttribute("role", "combobox");
    input.addEventListener("input", render);
    input.addEventListener("keydown", (e) => { const open = list.style.display !== "none";
      if (e.key === "ArrowDown" && open) { e.preventDefault(); cur = Math.min(items.length - 1, cur + 1); mark(); }
      else if (e.key === "ArrowUp" && open) { e.preventDefault(); cur = Math.max(0, cur - 1); mark(); }
      else if (e.key === "Enter" && !e.isComposing && !(e.ctrlKey || e.metaKey)) { if (open && cur >= 0 && items[cur]) { e.preventDefault(); e.stopPropagation(); choose(items[cur]); } else if (o.onEnter && input.value.trim()) { e.preventDefault(); e.stopPropagation(); close(); o.onEnter(input.value); } }
      else if (e.key === "Escape" && open) { e.preventDefault(); e.stopPropagation(); close(); } });
    input.addEventListener("blur", () => setTimeout(() => { if (document.activeElement === input) return; close(); if (o.onBlur) o.onBlur(input.value); }, 150));
    return { list, close, render, lookup };
  };
  // portPicker({ value: [{ name, lat, lon, … } | "name"], search, exact(name), legacy(name), geocode, multi, placeholder }) → a field element
  // (type "raw"): chips of the ports picked in order and a type-ahead. Its value is [{ name, lat, lon, region, country, portId, how }]
  // with how = "picked" (an exact pick), "name" (an older fixture's free text resolved by name — "pick exact port"), "unknown" (no
  // position: flagged, never given a guessed one) or "typed" (text not committed yet, resolved like Enter would on save).
  PSUI.portPicker = function (o) {
    o = o || {}; const multi = o.multi !== false; let refs = [];
    const box = H("div", { class: "psu-portpick" + (multi ? " multi" : "") }); const chips = H("div", { class: "psu-ppchips" }); const input = H("input", { type: "text", class: "psu-ppin", placeholder: o.placeholder || (multi ? "Type a port, pick it; then the next" : "Type a port and pick it") }); const note = H("div", { class: "hint psu-ppnote" });
    const fire = () => box.dispatchEvent(new Event("input", { bubbles: true }));
    // 4.32.2 · sts: true on a ref marks a ship-to-ship load / discharge (o.sts: the chips carry a monochrome STS toggle); o.addPort(name, done) offers
    // "+ Add 'X' with a position…" under an unknown port and takes the port saved there into the chip
    const refOf = (p, how) => ({ name: p.name, lat: p.lat != null ? +p.lat : null, lon: p.lon != null ? +p.lon : null, region: p.region || null, country: p.country || "", portId: p.id || p.portId || null, how, ...(p.sts ? { sts: true } : {}), ...(p.source ? { source: p.source } : {}) });
    const resolveText = (t) => { const nm = String(t || "").trim(); if (!nm) return null; const p = o.exact ? o.exact(nm) : null; return p ? refOf(p, "picked") : { name: nm, lat: null, lon: null, region: null, country: "", portId: null, how: "unknown" }; };
    const paint = () => { chips.innerHTML = ""; refs.forEach((r, i) => { const flag = r.how === "unknown" ? "unknown" : r.how === "name" ? "legacy" : "";
        chips.append(H("span", { class: "psu-ppchip" + (flag ? " " + flag : "") + (r.sts ? " sts" : ""), title: r.how === "unknown" ? "Unknown port — no position" : r.how === "name" ? "Found by name only — pick the exact port" : llText(r) }, H("button", { type: "button", class: "psu-ppname", onclick: () => { refs.splice(i, 1); input.value = r.name; paint(); fire(); input.focus(); sug.render(); } }, (multi && refs.length > 1 ? (i + 1) + ". " : "") + r.name + (r.country ? " · " + r.country : "") + (flag === "unknown" ? " ?" : "")),
          o.sts ? H("button", { type: "button", class: "psu-ppsts" + (r.sts ? " on" : ""), "aria-pressed": r.sts ? "true" : "false", title: r.sts ? "Ship-to-ship — click to make it a berth / terminal call" : "Mark as a ship-to-ship (STS) " + (o.stsWord || "operation"), onclick: () => { r.sts = !r.sts; paint(); fire(); } }, "STS") : null,
          H("button", { type: "button", class: "psu-ppx", title: "Remove", onclick: () => { refs.splice(i, 1); paint(); fire(); } }, "×"))); });
      const unk = refs.filter((r) => r.how === "unknown"), leg = refs.filter((r) => r.how === "name").map((r) => r.name); note.innerHTML = "";
      for (const r of unk) note.append(H("div", { class: "psu-ppwarn" }, "“" + r.name + "” is not in the port list", o.addPort ? H("span", {}, " — ", H("button", { type: "button", class: "linkbtn psu-ppadd", onclick: () => o.addPort(r.name, (p) => { const j = refs.indexOf(r); if (j < 0 || !p) return; refs[j] = { ...refOf(p, "picked"), sts: !!r.sts }; paint(); fire(); }) }, "+ Add “" + r.name + "” with a position…")) : " — pick from the list or add it in Settings → Ports"));
      if (leg.length) note.append(H("div", { class: "psu-pplegacy" }, "pick exact port: " + leg.join(", ") + " — found by name; click it and pick it from the list"));
      input.style.display = !multi && refs.length ? "none" : ""; };
    const add = (r) => { if (!r) return; if (!multi) refs = []; refs.push(r); input.value = ""; paint(); fire(); };
    const sug = PSUI.portSuggest(input, { search: o.search, geocode: o.geocode, onPick: (p) => add(refOf(p, "picked")), onEnter: (t) => add(resolveText(t)), onBlur: (t) => { if (String(t || "").trim()) add(resolveText(t)); } });
    input.addEventListener("input", (e) => { e.stopPropagation(); const v = input.value; if (multi && /[,;]/.test(v)) { const bits = v.split(/[,;]/); input.value = bits.pop(); for (const b of bits) if (b.trim()) add(resolveText(b)); sug.render(); } });
    const setList = (list) => { refs = []; for (const x of list || []) { if (!x) continue; if (typeof x === "string") { const nm = x.trim(); if (!nm) continue; const p = o.exact ? o.exact(nm) : null; if (p) { refs.push(refOf(p, o.legacyByName ? "name" : "picked")); continue; } const l = o.legacy ? o.legacy(nm) : null; refs.push(l ? { ...refOf(l, "name"), name: nm } : { name: nm, lat: null, lon: null, region: null, country: "", portId: null, how: "unknown" }); } else refs.push({ ...x, how: x.how || (x.lat != null ? "picked" : "unknown") }); } paint(); };
    Object.defineProperty(box, "value", { get: () => { const out = refs.slice(); const t = input.value.trim(); if (t) { const r = resolveText(t); if (r) out.push({ ...r, how: r.how === "picked" ? "picked" : "typed" }); } return multi ? out : (out[out.length - 1] || null); }, set: (v) => { setList(Array.isArray(v) ? v : v ? [v] : []); } });
    box._setText = (t) => { setList(String(t || "").split(/[,;\/]/).map((s) => s.trim()).filter(Boolean)); fire(); };
    box.input = input; box.suggest = sug;
    box.append(chips, input, sug.list, note); setList(o.value || []);
    return box;
  };

  PSUI.sortCompare = cmp; PSUI.textOf = textOf; PSUI.dateKey = dateKey;
})();
