/* XYNTAX COMPLIANCE · the counterparty's KYC page (4.33). Opened with a link — https://<portal>/#/kyc/<token> — and nothing else:
 * no portal login, no owner data. The token is the credential; it is sent only in the body of POSTs to the "kyc" function and is
 * never stored by this page. The form is drawn from KYC_SCHEMA (kyc-schema.js, the same file the app and the function use): eight
 * sections, one at a time, a section index on the left (a stepper on a phone), autosave of the draft, documents uploaded straight
 * to signed addresses, a sanctions declaration, a typed signature. States: link not valid (unknown, expired and revoked look the
 * same) · draft · changes requested (the reviewer's comments per section) · submitted (a receipt and a printable copy, read-only). */
(function () {
  "use strict";
  const K = window.KYC; const CFG = window.PORTAL_CONFIG || {}; const URL0 = String(CFG.url || "").replace(/\/$/, ""); const ANON = CFG.anon || "";
  const tokenOf = () => { const m = /^#\/?kyc\/([^/?#]+)/.exec(location.hash || ""); return m ? decodeURIComponent(m[1]) : null; };
  const H = (tag, attrs, ...kids) => { const el = document.createElement(tag); for (const [k, v] of Object.entries(attrs || {})) { if (v == null || v === false) continue; if (k === "class") el.className = v; else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v); else if (k === "value") el.value = v; else el.setAttribute(k, v === true ? "" : v); } for (const kid of kids.flat(Infinity)) { if (kid == null || kid === false) continue; el.append(kid.nodeType ? kid : document.createTextNode(String(kid))); } return el; };
  const day = (s) => { if (!s) return "—"; const d = new Date(String(s).length <= 10 ? s + "T00:00:00Z" : s); return isNaN(d) ? String(s) : d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }); };
  const stamp = (s) => { const d = new Date(s); return isNaN(d) ? "" : d.toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }); };
  const clock = (d) => String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
  const bytes = (n) => (n < 1024 ? n + " B" : n < 1048576 ? Math.round(n / 1024) + " KB" : (n / 1048576).toFixed(1) + " MB");
  const today = () => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
  const st = { token: null, root: null, view: null, data: null, files: [], cur: 0, tried: false, touched: new Set(), dirty: false, saving: false, savedAt: null, saveErr: "", timer: null, ups: [], state: "loading" };
  const S = () => K.KYC_SCHEMA; const secs = () => S().sections; const editable = () => !!(st.view && st.view.editable);
  const ctx = () => ({ type: st.view.type, required: st.view.required });

  // ---- the function
  async function call(action, extra) {
    const headers = { "Content-Type": "application/json" }; if (ANON) { headers.apikey = ANON; headers.Authorization = "Bearer " + ANON; }
    let r; try { r = await fetch(URL0 + "/functions/v1/kyc", { method: "POST", headers, body: JSON.stringify({ action, token: st.token, ...(extra || {}) }) }); } catch (e) { return { status: 0, body: { error: "network" } }; }
    let body = null; try { body = await r.json(); } catch (e) { body = {}; } return { status: r.status, body: body || {} };
  }
  const gone = (r) => { if (r.status === 404) { st.state = "invalid"; render(); return true; } if (r.status === 429) { st.state = "rate"; render(); return true; } return false; };

  // ---- data access by path ("company.legal_name", "ownership.ubos.0.name", "declaration.answers.a.details")
  const getP = (p) => p.split(".").reduce((o, k) => (o == null ? undefined : o[k]), st.data);
  const setP = (p, v) => { const ks = p.split("."); let o = st.data; for (let i = 0; i < ks.length - 1; i++) { if (o[ks[i]] == null) o[ks[i]] = {}; o = o[ks[i]]; } o[ks[ks.length - 1]] = v; changed(); };
  function changed() { if (!editable()) return; st.dirty = true; clearTimeout(st.timer); st.timer = setTimeout(save, 1200); paintState(); paintIndex(); }
  async function save() {
    clearTimeout(st.timer); if (!st.dirty || st.saving || !editable()) return; st.saving = true; st.dirty = false; paintState();
    const r = await call("save", { data: st.data }); st.saving = false;
    if (r.status === 200) { st.savedAt = new Date(); st.saveErr = ""; } else if (gone(r)) return; else if (r.status === 409) { await load(); return; } else { st.dirty = true; st.saveErr = r.status === 413 ? "The form is too large to save — shorten the longest answers" : "Not saved — retrying"; st.timer = setTimeout(save, 5000); }
    paintState(); if (st.dirty && !st.timer) st.timer = setTimeout(save, 1200);
  }
  function paintState() { const el = st.root && st.root.querySelector(".kyc-save"); if (!el) return; el.textContent = !editable() ? "" : st.saving ? "Saving…" : st.saveErr ? st.saveErr : st.dirty ? "Unsaved changes" : st.savedAt ? "Draft saved " + clock(st.savedAt) : "Draft"; el.classList.toggle("bad", !!st.saveErr); }

  // ---- load
  async function load() {
    const r = await call("open"); if (gone(r)) return; if (r.status !== 200) { st.state = "error"; render(); return; }
    if (r.body.receipt) { st.view = r.body; st.data = null; st.files = []; st.copy = false; st.state = "receipt"; render(); return; } // submitted or decided: the receipt, and nothing of the form
    st.view = r.body; st.data = K.sanitize(r.body.data); st.files = r.body.files || []; st.dirty = false; st.saveErr = "";
    if (st.data.declaration && !st.data.declaration.signed_date && st.view.editable) st.data.declaration.signed_date = today();
    st.state = "form";
    if (st.view.status === "changes_requested") { st.tried = true; const first = secs().findIndex((s) => (st.view.comments || {})[s.id]); if (first >= 0) st.cur = first; }
    render();
  }

  // ---- fields
  const errOf = (secId, key) => { if (!editable()) return ""; const e = K.sectionErrors(secId, st.data, st.files, ctx()).find((x) => x.k === key); return e && (st.tried || st.touched.has(secId + "." + key)) ? e.msg : ""; };
  function control(f, path, secId, errKey, redraw) {
    const v = getP(path); const ro = !editable();
    // a field is checked when it is left — a moment later, so a message appearing or going never moves the thing being clicked — and a
    // message already showing clears while the answer is typed
    const touch = () => setTimeout(() => { st.touched.add(secId + "." + errKey); paintErr(secId, errKey); }, 220); const live = () => { const w = st.root.querySelector('[data-err="' + secId + "." + errKey + '"]'); if (w && w.classList.contains("bad")) paintErr(secId, errKey); };
    if (f.t === "yesno") return H("div", { class: "kyc-yn", role: "radiogroup", "aria-label": f.l }, K.YES_NO.map((o) => H("button", { type: "button", class: v === o.v ? "on" : "", "data-k": path, "data-v": o.v, disabled: ro, "aria-pressed": v === o.v ? "true" : "false", onclick: () => { setP(path, o.v); st.touched.add(secId + "." + errKey); redraw(); } }, o.l)));
    if (f.t === "check") return H("label", { class: "kyc-chk" }, H("input", { type: "checkbox", name: path, checked: v === true, disabled: ro, onchange: (e) => { setP(path, e.target.checked); redraw(); } }), H("span", {}, f.l));
    if (f.t === "select") return H("select", { name: path, disabled: ro, onchange: (e) => { setP(path, e.target.value); touch(); } }, H("option", { value: "" }, "Choose…"), (f.options || []).map((o) => H("option", { value: o, selected: v === o }, o)));
    if (f.t === "textarea") { const el = H("textarea", { name: path, rows: 3, readonly: ro, placeholder: f.ph || "", oninput: (e) => { setP(path, e.target.value); live(); }, onblur: touch }); el.value = v || ""; return el; }
    return H("input", { type: f.t === "date" ? "date" : f.t === "email" ? "email" : f.t === "tel" ? "tel" : f.t === "number" ? "number" : "text", name: path, value: v == null ? "" : v, readonly: ro, placeholder: f.ph || "", step: f.t === "number" ? "any" : null, min: f.t === "number" && f.min != null ? f.min : null, max: f.t === "number" && f.max != null ? f.max : null, inputmode: f.t === "number" ? "decimal" : null, autocomplete: "off", oninput: (e) => { setP(path, e.target.value); live(); }, onblur: touch });
  }
  function field(f, path, secId, errKey, redraw) {
    const e = errOf(secId, errKey); const w = H("div", { class: "kyc-f" + (f.t === "textarea" || f.t === "yesno" ? " wide" : "") + (e ? " bad" : ""), "data-err": secId + "." + errKey });
    if (f.t !== "check") w.append(H("label", {}, f.l, f.req ? H("span", { class: "req", title: "required" }, " *") : null)); w.append(control(f, path, secId, errKey, redraw), H("div", { class: "kyc-e" }, e)); return w;
  }
  function paintErr(secId, key) { const w = st.root.querySelector('[data-err="' + secId + "." + key + '"]'); if (!w) return; const e = errOf(secId, key); w.classList.toggle("bad", !!e); const x = w.querySelector(".kyc-e"); if (x) x.textContent = e; paintIndex(); }
  function rowsField(f, sec, redraw) {
    const path = sec.id + "." + f.k; let rows = getP(path); if (!Array.isArray(rows)) { rows = []; st.data[sec.id][f.k] = rows; } const box = H("div", { class: "kyc-rows", "data-rows": path });
    box.append(H("div", { class: "kyc-rh" }, H("h3", {}, f.l), H("div", { class: "kyc-e" }, errOf(sec.id, f.k))));
    rows.forEach((r, i) => box.append(H("div", { class: "kyc-row" }, H("div", { class: "kyc-rt" }, H("span", { class: "caps" }, f.noun + " " + (i + 1)), editable() ? H("button", { type: "button", class: "q", "data-remove": path + "." + i, onclick: () => { rows.splice(i, 1); changed(); redraw(); } }, "Remove") : null),
      H("div", { class: "kyc-grid" }, f.cols.map((c) => field(c, path + "." + i + "." + c.k, sec.id, f.k + "." + i + "." + c.k, redraw))))));
    if (editable() && rows.length < (f.max || 20)) box.append(H("button", { type: "button", class: "btn", "data-add": path, onclick: () => { const o = {}; for (const c of f.cols) o[c.k] = ""; rows.push(o); changed(); redraw(); } }, "+ Add " + f.noun));
    return box;
  }

  // ---- documents
  async function attach(slotId, list, redraw) {
    for (const file of Array.from(list || [])) {
      const mime = S().files.types[K.extOf(file.name)] || file.type; const err = K.fileError({ slot: slotId, name: file.name, mime, size: file.size }, st.files.length + st.ups.length);
      const up = { slot: slotId, name: file.name, size: file.size, state: err ? "error" : "up", msg: err || "Uploading…" }; st.ups.push(up); redraw(); if (err) continue;
      const fail = (m) => { up.state = "error"; up.msg = m || "The upload failed — try again"; redraw(); };
      const a = await call("upload-url", { slot: slotId, name: file.name, mime, size: file.size }); if (gone(a)) return; if (a.status !== 200) { fail(a.body.message); continue; }
      let ok = false; try { const r = await fetch(a.body.upload.url, { method: a.body.upload.method || "PUT", headers: a.body.upload.headers || {}, body: file }); ok = r.ok; } catch (e) { ok = false; } if (!ok) { fail(); continue; }
      const d = await call("file-done", { file_id: a.body.file_id }); if (gone(d)) return; if (d.status !== 200) { fail(d.body.message); continue; }
      st.ups.splice(st.ups.indexOf(up), 1); st.files.push(d.body.file); redraw(); paintIndex();
    }
  }
  async function removeFile(f, redraw) { const r = await call("file-delete", { file_id: f.id }); if (gone(r)) return; if (r.status === 200) { st.files = st.files.filter((x) => x.id !== f.id); redraw(); paintIndex(); } }
  let metaT = {}; const fileMeta = (f, key, v) => { f[key] = v || null; paintIndex(); clearTimeout(metaT[f.id]); metaT[f.id] = setTimeout(async () => { const r = await call("file-meta", { file_id: f.id, doc_date: f.doc_date || "", expiry: f.expiry || "" }); gone(r); }, 600); };
  function slotBox(sl, secId, redraw) {
    const req = st.view.required.includes(sl.id); const files = K.filesIn(st.files, sl.id); const ups = st.ups.filter((u) => u.slot === sl.id); const na = (st.data.documents.na || {})[sl.id] || ""; const e = errOf(secId, "slot:" + sl.id);
    const box = H("div", { class: "kyc-slot" + (e ? " bad" : ""), "data-slot": sl.id, "data-err": secId + ".slot:" + sl.id });
    const pick = H("input", { type: "file", multiple: true, class: "kyc-file", "data-slot": sl.id, accept: ".pdf,.jpg,.jpeg,.png,.docx,.xlsx", onchange: (ev) => { const l = ev.target.files; attach(sl.id, l, redraw); ev.target.value = ""; } });
    box.append(H("div", { class: "kyc-sh" }, H("div", {}, H("b", {}, sl.l), H("span", { class: "kyc-tag" + (req ? " req" : "") }, req ? "Required" : "Optional")), editable() ? H("label", { class: "btn kyc-pick" }, "Attach files", pick) : null));
    for (const f of files) box.append(H("div", { class: "kyc-doc", "data-file": f.id }, H("div", { class: "kyc-dn" }, H("span", { class: "n" }, f.name), H("span", { class: "s" }, bytes(+f.size || 0))),
      H("label", { class: "kyc-dd" }, H("span", {}, "Document date"), H("input", { type: "date", name: "file." + f.id + ".doc_date", value: f.doc_date || "", readonly: !editable(), onchange: (ev) => fileMeta(f, "doc_date", ev.target.value) })),
      sl.expiry ? H("label", { class: "kyc-dd" }, H("span", {}, "Expiry date"), H("input", { type: "date", name: "file." + f.id + ".expiry", "data-expiry": sl.id, value: f.expiry || "", readonly: !editable(), onchange: (ev) => fileMeta(f, "expiry", ev.target.value) })) : null,
      editable() ? H("button", { type: "button", class: "q", onclick: () => removeFile(f, redraw) }, "Remove") : null));
    for (const u of ups) box.append(H("div", { class: "kyc-doc up " + u.state }, H("div", { class: "kyc-dn" }, H("span", { class: "n" }, u.name), H("span", { class: "s" }, u.msg)), u.state === "error" ? H("button", { type: "button", class: "q", onclick: () => { st.ups.splice(st.ups.indexOf(u), 1); redraw(); } }, "Dismiss") : null));
    if (req && !files.length && !ups.length) { const t = H("textarea", { name: "documents.na." + sl.id, rows: 2, readonly: !editable(), placeholder: "If this document cannot be provided, say why", oninput: (ev) => { st.data.documents.na[sl.id] = ev.target.value; changed(); if (box.classList.contains("bad")) paintErr(secId, "slot:" + sl.id); }, onblur: () => setTimeout(() => { st.touched.add(secId + ".slot:" + sl.id); paintErr(secId, "slot:" + sl.id); }, 220) }); t.value = na; box.append(t); }
    box.append(H("div", { class: "kyc-e" }, e)); return box;
  }

  // ---- one section
  function sectionBody(sec) {
    const body = H("div", { class: "kyc-sec", "data-sec": sec.id }); const redraw = () => { /* the section as it stands in the page now (an upload may finish after an earlier redraw, or on another section) */ const cur = st.root.querySelector('.kyc-sec[data-sec="' + sec.id + '"]'); if (cur) { const y = window.scrollY; cur.replaceWith(sectionBody(sec)); window.scrollTo(0, y); } paintIndex(); };
    const c = st.view.status === "changes_requested" ? (st.view.comments || {})[sec.id] : ""; if (c) body.append(H("div", { class: "kyc-comment", "data-comment": sec.id }, H("div", { class: "caps" }, "Changes requested by the reviewer"), H("p", {}, c)));
    if (sec.fields) { const o = st.data[sec.id]; let grid = null, group = null;
      for (const f of sec.fields) { if (!K.shown(f, o)) continue;
        if (f.t === "rows") { grid = null; body.append(rowsField(f, sec, redraw)); continue; }
        if (f.group !== group) { group = f.group; grid = null; if (group) body.append(H("h3", { class: "kyc-gh" }, group)); }
        if (!grid) { grid = H("div", { class: "kyc-grid" + (group ? " g3" : "") }); body.append(grid); }
        const fl = group ? { ...f, l: f.l.replace(/^.* — /, "").replace(/^name$/, "Name") } : f; grid.append(field(fl, sec.id + "." + f.k, sec.id, f.k, redraw)); }
      for (const sid of Array.isArray(sec.slots) ? sec.slots : []) body.append(slotBox(K.slot(sid), sec.id, redraw)); }
    if (sec.slots === "*") for (const sl of S().slots) body.append(slotBox(sl, sec.id, redraw));
    if (sec.declaration) { const D = S().declaration; body.append(H("p", { class: "kyc-note" }, D.intro));
      D.questions.forEach((q) => { const p = "declaration.answers." + q.id; const a = getP(p) || {}; const e = errOf(sec.id, "q:" + q.id); const w = H("div", { class: "kyc-q" + (e ? " bad" : ""), "data-err": sec.id + ".q:" + q.id }, H("div", { class: "kyc-qt" }, H("span", { class: "caps" }, "(" + q.id + ")"), H("p", {}, q.q)),
          H("div", { class: "kyc-yn" }, K.YES_NO.map((o) => H("button", { type: "button", class: a.v === o.v ? "on" : "", "data-q": q.id, "data-v": o.v, disabled: !editable(), onclick: () => { setP(p + ".v", o.v); st.touched.add(sec.id + ".q:" + q.id); redraw(); } }, o.l))));
        if (a.v === q.detailsOn) { const t = H("textarea", { name: p + ".details", rows: 3, readonly: !editable(), placeholder: "Please give the details", oninput: (ev) => { setP(p + ".details", ev.target.value); if (w.classList.contains("bad")) paintErr(sec.id, "q:" + q.id); }, onblur: () => setTimeout(() => paintErr(sec.id, "q:" + q.id), 220) }); t.value = a.details || ""; w.append(t); }
        w.append(H("div", { class: "kyc-e" }, e)); body.append(w); });
      body.append(H("h3", { class: "kyc-gh" }, "Undertakings"));
      for (const u of D.undertakings) { const p = "declaration.undertakings." + u.id; const e = errOf(sec.id, "u:" + u.id); body.append(H("label", { class: "kyc-chk kyc-u" + (e ? " bad" : ""), "data-err": sec.id + ".u:" + u.id }, H("input", { type: "checkbox", name: p, checked: getP(p) === true, disabled: !editable(), onchange: (ev) => { setP(p, ev.target.checked); st.touched.add(sec.id + ".u:" + u.id); paintErr(sec.id, "u:" + u.id); } }), H("span", {}, u.t), H("span", { class: "kyc-e" }, e))); }
      body.append(H("h3", { class: "kyc-gh" }, "Signature")); const g = H("div", { class: "kyc-grid" }); for (const f of D.sign) g.append(field(f, "declaration." + f.k, sec.id, f.k, redraw)); body.append(g, H("p", { class: "kyc-note" }, "Typing your name here has the same effect as signing this declaration on behalf of the company.")); }
    return body;
  }

  // ---- index, stepper, progress
  function marks() { const v = K.validate(st.data, st.files, ctx()); return { v, of: (id) => ((st.view.comments || {})[id] && st.view.status === "changes_requested" && !v.sections[id].complete ? "note" : v.sections[id].complete ? "done" : "todo") }; }
  function paintIndex() {
    if (!st.root || st.state !== "form") return; const m = marks(); const text = m.v.done + " of " + m.v.total + " sections complete";
    for (const b of st.root.querySelectorAll("[data-go]")) { const i = +b.getAttribute("data-go"); const s = secs()[i]; b.className = (i === st.cur ? "on " : "") + m.of(s.id) + (st.view.status === "changes_requested" && (st.view.comments || {})[s.id] ? " cm" : ""); }
    for (const p of st.root.querySelectorAll(".kyc-prog")) p.textContent = text; for (const b of st.root.querySelectorAll(".kyc-bar i")) b.style.width = Math.round((m.v.done / m.v.total) * 100) + "%";
  }
  function go(i) { save(); st.cur = Math.max(0, Math.min(secs().length - 1, i)); render(); window.scrollTo(0, 0); }

  // ---- submit
  async function submit(btn) {
    st.tried = true; const v = K.validate(st.data, st.files, ctx());
    if (st.ups.some((u) => u.state === "up")) { summary(["A document is still uploading — wait a moment."]); return; }
    if (!v.ok) { render(); summary(null, v); return; }
    btn.disabled = true; btn.textContent = "Submitting…"; clearTimeout(st.timer); st.dirty = false;
    const r = await call("submit", { data: st.data }); if (gone(r)) return;
    // the receipt, with a copy of what was sent — from what is in this page, this once: a later visit of the link shows the receipt alone
    if (r.status === 200) { st.view = { receipt: true, org_name: st.view.org_name, company_name: st.view.company_name, reference: r.body.reference, submitted_at: r.body.submitted_at, state: "received", valid_until: null }; st.copy = true; st.state = "receipt"; render(); window.scrollTo(0, 0); return; }
    btn.disabled = false; btn.textContent = "Submit";
    if (r.status === 422) { const bySec = {}; for (const e of r.body.errors || []) (bySec[e.section] = bySec[e.section] || []).push(e); summary(null, { sections: Object.fromEntries(secs().map((s) => [s.id, { complete: !bySec[s.id], errors: bySec[s.id] || [] }])) }); return; }
    if (r.status === 409) { await load(); return; }
    summary([r.status === 0 ? "No connection — your draft is safe; try again." : "The form could not be submitted — try again in a moment."]);
  }
  function summary(lines, v) {
    const box = st.root.querySelector(".kyc-sum"); if (!box) return; box.innerHTML = ""; box.hidden = false;
    if (lines) { for (const l of lines) box.append(H("p", {}, l)); return; }
    box.append(H("div", { class: "caps" }, "Before you can submit")); secs().forEach((s, i) => { const x = v.sections[s.id]; if (!x || x.complete) return; box.append(H("button", { type: "button", class: "kyc-sl", onclick: () => go(i) }, H("b", {}, (i + 1) + " · " + s.title), H("span", {}, x.errors.length + (x.errors.length === 1 ? " item" : " items") + " to complete — " + x.errors.slice(0, 2).map((e) => e.msg).join("; ") + (x.errors.length > 2 ? "…" : "")))); });
    box.scrollIntoView({ block: "nearest" });
  }

  // ---- the read-only copy (the receipt page, and what Print prints)
  const showV = (f, v) => (f.t === "yesno" ? (v === "yes" ? "Yes" : v === "no" ? "No" : "—") : f.t === "check" ? (v ? "Yes" : "No") : f.t === "date" ? (v ? day(v) : "—") : v === "" || v == null ? "—" : String(v));
  function copy() {
    const out = H("div", { class: "kyc-copy" });
    for (const sec of secs()) { const box = H("section", {}, H("h3", {}, sec.title)); const o = st.data[sec.id] || {};
      if (sec.fields) { const kv = H("div", { class: "kyc-kv" }); for (const f of sec.fields) { if (!K.shown(f, o)) continue; if (f.t === "rows") { (o[f.k] || []).forEach((r, i) => { kv.append(H("div", { class: "k rowh" }, f.noun + " " + (i + 1)), H("div", { class: "v" }, "")); for (const c of f.cols) kv.append(H("div", { class: "k" }, c.l), H("div", { class: "v" }, showV(c, r[c.k]))); }); continue; } kv.append(H("div", { class: "k" }, f.l), H("div", { class: "v" }, showV(f, o[f.k]))); } box.append(kv); }
      const slots = sec.slots === "*" ? S().slots : []; if (slots.length) { const kv = H("div", { class: "kyc-kv" }); for (const sl of slots) { const fs = K.filesIn(st.files, sl.id); const na = (st.data.documents.na || {})[sl.id]; kv.append(H("div", { class: "k" }, sl.l), H("div", { class: "v" }, fs.length ? fs.map((f) => H("div", {}, f.name + (f.doc_date ? " · dated " + day(f.doc_date) : "") + (f.expiry ? " · expires " + day(f.expiry) : ""))) : na ? "Not provided — " + na : "—")); } box.append(kv); }
      if (sec.declaration) { const D = S().declaration; const dec = st.data.declaration || {}; const kv = H("div", { class: "kyc-kv q" }); for (const q of D.questions) { const a = (dec.answers || {})[q.id] || {}; kv.append(H("div", { class: "k" }, "(" + q.id + ") " + q.q), H("div", { class: "v" }, (a.v === "yes" ? "Yes" : a.v === "no" ? "No" : "—") + (a.details ? " — " + a.details : ""))); }
        for (const u of D.undertakings) kv.append(H("div", { class: "k" }, u.t), H("div", { class: "v" }, (dec.undertakings || {})[u.id] ? "Confirmed" : "—")); for (const f of D.sign) kv.append(H("div", { class: "k" }, f.l.replace(/ — .*/, "")), H("div", { class: "v" }, showV(f, dec[f.k]))); box.append(kv); }
      out.append(box); }
    return out;
  }

  // ---- render
  function theme() { let t = ""; try { t = localStorage.getItem("portal.theme") || ""; } catch (e) { /* private mode */ } if (t) document.documentElement.setAttribute("data-theme", t); }
  function header() { return H("header", { class: "top kyc-top" }, H("span", { class: "lockup" }, H("span", { class: "word" }, "XYNTAX"), H("span", { class: "div" }, "|"), H("span", {}, "COMPLIANCE")), H("div", { class: "who" }, st.view && st.view.org_name ? H("span", {}, "KYC for ", H("b", {}, st.view.org_name)) : null, H("span", { class: "kyc-save", "aria-live": "polite" }, ""))); }
  function message(title, text) { return H("div", { class: "signin" }, H("div", { class: "box kyc-msg" }, H("h2", {}, title), H("p", {}, text))); }
  function render() {
    const root = st.root; root.innerHTML = ""; document.title = "XYNTAX | COMPLIANCE · " + ((st.view && st.view.org_name) || "Onboarding"); root.append(header());
    if (st.state === "loading") { root.append(message("Opening your form…", "One moment.")); return; }
    if (st.state === "invalid") { root.append(message("This link is not valid", "It may have expired or been replaced by a newer one. Ask your contact for a new link — what you saved earlier is kept.")); root.querySelector(".kyc-msg").setAttribute("data-state", "invalid"); return; }
    if (st.state === "rate") { root.append(message("Too many attempts", "Wait a few minutes, then open the link again.")); return; }
    if (st.state === "error") { root.append(message("The form could not be opened", "Check your connection and reload the page.")); return; }
    const v = st.view; const type = K.typeOf(v.type || "customer");
    if (st.state === "receipt") {
      const valid = v.state === "completed" && v.valid_until;
      const done = H("div", { class: "pane kyc-receipt", "data-state": v.state || "received" }, H("div", { class: "body" }, H("div", { class: "caps" }, "KYC package · " + K.receiptState(v.state)), H("h1", {}, valid ? "Your KYC is valid" : v.state === "completed" ? "Completed" : "Submitted"),
        H("p", { class: "kyc-rl" }, "Submitted on ", H("b", {}, stamp(v.submitted_at)), " · reference ", H("b", { class: "ref" }, v.reference)), H("p", { class: "sub" }, v.company_name || ""),
        valid ? H("p", { class: "kyc-valid" }, "Your KYC is valid until ", H("b", {}, day(v.valid_until)), ".") : H("p", { class: "kyc-note" }, v.state === "completed" ? "The review of this package is complete. Your contact will be in touch if anything else is needed." : "Our compliance team will review the package and contact you if anything else is needed. The form can no longer be changed."),
        st.copy ? H("p", { class: "kyc-note" }, "Print or save your copy now — for your protection the answers are not shown again when this link is opened later.") : null,
        st.copy ? H("div", { class: "kyc-acts" }, H("button", { type: "button", class: "primary", "data-act": "print", onclick: () => window.print() }, "Print a copy")) : null));
      root.append(H("div", { class: "wrap kyc-wrap one" }, done, st.copy && st.data ? copy() : null)); return;
    }
    const sec = secs()[st.cur]; const last = st.cur === secs().length - 1;
    const index = H("nav", { class: "kyc-index", "aria-label": "Sections" }, H("div", { class: "kyc-prog" }, ""), H("div", { class: "kyc-bar" }, H("i", {})), secs().map((s, i) => H("button", { type: "button", "data-go": i, onclick: () => go(i) }, H("span", { class: "no" }, i + 1), H("span", { class: "t" }, s.title), H("span", { class: "mk", "aria-hidden": "true" }))));
    const step = H("div", { class: "kyc-step" }, H("div", { class: "kyc-st" }, H("span", { class: "caps" }, "Step " + (st.cur + 1) + " of " + secs().length), H("span", { class: "kyc-prog" }, "")), H("div", { class: "kyc-dots" }, secs().map((s, i) => H("button", { type: "button", "data-go": i, title: s.title, "aria-label": s.title, onclick: () => go(i) }))));
    const main = H("main", { class: "kyc-main" }, H("div", { class: "kyc-head" }, H("div", { class: "caps" }, v.company_name), H("h1", {}, (st.cur + 1) + ". " + sec.title), H("p", { class: "sub" }, sec.intro || ""),
        st.cur === 0 ? H("p", { class: "kyc-ctx" }, type.ctx + " This form is for " + v.org_name + ". Your answers are saved as you go; you can close this page and come back with the same link until " + day(v.expires_at) + "." + (v.renewal ? " This is a renewal: last year's answers are filled in — check them, attach current documents and sign again." : "")) : null,
        st.cur === 0 && v.note ? H("p", { class: "kyc-ctx" }, "Note from " + v.org_name + ": " + v.note) : null,
        v.status === "changes_requested" && st.cur === 0 ? H("div", { class: "kyc-comment" }, H("div", { class: "caps" }, "Changes requested"), H("p", {}, "The reviewer asked for changes in the marked sections. Update them and submit again.")) : null),
      sectionBody(sec), H("div", { class: "kyc-sum", hidden: true, role: "alert" }),
      H("div", { class: "kyc-nav" }, st.cur > 0 ? H("button", { type: "button", class: "btn", "data-nav": "back", onclick: () => go(st.cur - 1) }, "Back") : H("span"), H("span", { class: "sp" }), H("button", { type: "button", class: "btn", "data-nav": "save", onclick: async () => { st.dirty = true; await save(); } }, "Save draft"), last ? H("button", { type: "button", class: "primary", "data-nav": "submit", onclick: (e) => submit(e.currentTarget) }, v.status === "changes_requested" ? "Submit again" : "Submit") : H("button", { type: "button", class: "primary", "data-nav": "next", onclick: () => go(st.cur + 1) }, "Save and continue")));
    root.append(step, H("div", { class: "wrap kyc-wrap" }, index, main)); paintIndex(); paintState();
  }

  // ---- start: before the portal's own sign-in gate, and instead of it
  function start(root) {
    st.token = tokenOf(); st.root = root; theme(); document.documentElement.classList.add("kyc"); render();
    if (!K || !K.tokenOk(st.token) || !URL0) { st.state = "invalid"; render(); return; }
    load();
    window.addEventListener("beforeunload", (e) => { if (st.dirty && editable()) { save(); e.preventDefault(); e.returnValue = ""; } });
    document.addEventListener("visibilitychange", () => { if (document.hidden) save(); });
  }
  let started = false;
  window.XKYC = { route() { if (tokenOf() == null) return false; started = true; start(document.getElementById("app")); return true; }, state: st, save };
  // a KYC link opened in a tab that shows the vessel portal (or the reverse) starts that page afresh
  window.addEventListener("hashchange", () => { if ((tokenOf() != null) !== started || (started && tokenOf() !== st.token)) location.reload(); });
})();
