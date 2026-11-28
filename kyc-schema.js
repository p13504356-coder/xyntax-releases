/* XYNTAX COMPLIANCE · the KYC package (4.33). One config object — KYC_SCHEMA, versioned by schemaVersion — holds every question a
 * counterparty answers: the eight sections of the form, the document checklist and the sanctions declaration. The same file is
 * loaded by the app (src/kyc-schema.js), byte-identical by the portal (portal/kyc-schema.js) and embedded, byte-identical, in the
 * "kyc" edge function (cloud-kyc-function.ts, between the KYC-SCHEMA markers) — `node tools/kyc-build.js` copies it, a test keeps
 * the three equal. So the form a counterparty sees, what the server accepts and what the officer reviews are one definition.
 * THE WORDING OF THE DECLARATION AND THE UNDERTAKINGS IS A DRAFT FOR LEGAL REVIEW: have counsel review it, change it here, raise
 * schemaVersion, run tools/kyc-build.js and redeploy the function. Each submission records the version it was answered under.
 * Pure: no DOM, no network, no clock of its own (today is passed in). Dates are "YYYY-MM-DD" strings. */
(function (root, factory) { const api = factory(); if (typeof module !== "undefined" && module.exports) module.exports = api; root.KYC = api; })(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  const YES_NO = [{ v: "yes", l: "Yes" }, { v: "no", l: "No" }];
  const person = (p, label, req) => [{ k: p + "_name", l: label + " — name", req, group: label }, { k: p + "_email", l: "Email", t: "email", req, group: label }, { k: p + "_phone", l: "Phone", t: "tel", group: label }];
  const KYC_SCHEMA = {
    schemaVersion: "2026.11-draft.1",
    legalNote: "Draft wording — to be reviewed by legal counsel before use.",
    types: [{ v: "customer", l: "Customer", ctx: "You are being onboarded as our customer." }, { v: "vendor", l: "Vendor", ctx: "You are being onboarded as our vendor / supplier." }, { v: "both", l: "Customer and vendor", ctx: "You are being onboarded as our customer and our vendor." }],
    files: { maxBytes: 15 * 1024 * 1024, maxFiles: 40, types: { pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" } },
    maxDraftBytes: 200 * 1024,
    sections: [
      { id: "company", title: "Company", intro: "The legal entity that will trade with us.", fields: [
        { k: "legal_name", l: "Legal name", req: 1 }, { k: "trading_name", l: "Trading name (if different)" }, { k: "legal_form", l: "Legal form", ph: "LLC, Ltd, A/S, DMCC…", req: 1 },
        { k: "reg_no", l: "Registration number", req: 1 }, { k: "inc_date", l: "Date of incorporation", t: "date", req: 1 }, { k: "inc_country", l: "Country of incorporation", req: 1 },
        { k: "reg_address", l: "Registered address", t: "textarea", req: 1 }, { k: "op_address", l: "Operating address (if different)", t: "textarea" },
        { k: "website", l: "Website" }, { k: "phone", l: "Phone", t: "tel", req: 1 }, { k: "email", l: "General email", t: "email", req: 1 },
        { k: "tax_no", l: "Tax / VAT number (TRN)" }, { k: "lei", l: "LEI (optional)" },
        { k: "business", l: "Nature of business", t: "textarea", req: 1 }, { k: "countries", l: "Countries of operation", req: 1, ph: "UAE, Singapore, Greece…" },
        { k: "listed", l: "Is the company listed on a stock exchange?", t: "yesno", req: 1 }, { k: "listed_where", l: "Exchange and ticker", req: 1, showIf: { k: "listed", v: "yes" } },
        { k: "regulated", l: "Is the company a regulated entity?", t: "yesno", req: 1 }, { k: "regulator", l: "Regulator", req: 1, showIf: { k: "regulated", v: "yes" } }, { k: "regulator_licence", l: "Regulatory licence number", req: 1, showIf: { k: "regulated", v: "yes" } }] },
      { id: "licence", title: "Trade licence", intro: "The licence or registration under which the company trades.", slots: ["trade_licence"], fields: [
        { k: "licence_no", l: "Licence number", req: 1 }, { k: "authority", l: "Issuing authority", req: 1 }, { k: "issue_date", l: "Issue date", t: "date" },
        { k: "no_expiry", l: "This licence has no expiry date", t: "check" }, { k: "expiry_date", l: "Expiry date", t: "date", req: 1, showIf: { k: "no_expiry", not: true } }] },
      { id: "ownership", title: "Ownership & control", intro: "Every shareholder holding 25 % or more, every ultimate beneficial owner, and the directors or authorised signatories.", slots: ["structure_chart"], fields: [
        { k: "ubos", l: "Shareholders ≥ 25 % and ultimate beneficial owners", t: "rows", min: 1, max: 20, noun: "owner", cols: [
          { k: "name", l: "Full name", req: 1 }, { k: "nationality", l: "Nationality", req: 1 }, { k: "residence", l: "Country of residence", req: 1 }, { k: "dob", l: "Date of birth", t: "date", sensitive: 1 },
          { k: "pct", l: "Ownership %", t: "number", req: 1, min: 0, max: 100 }, { k: "id_no", l: "ID / passport number", req: 1, sensitive: 1 }, { k: "id_expiry", l: "ID expiry", t: "date" }, { k: "pep", l: "Politically exposed person?", t: "yesno", req: 1 }] },
        { k: "directors", l: "Directors and authorised signatories", t: "rows", min: 1, max: 20, noun: "director", cols: [
          { k: "name", l: "Full name", req: 1 }, { k: "title", l: "Title", req: 1 }, { k: "nationality", l: "Nationality" }, { k: "id_no", l: "ID / passport number", sensitive: 1 }, { k: "id_expiry", l: "ID expiry", t: "date" }] }] },
      { id: "contacts", title: "Contacts", intro: "Who we speak to.", fields: [...person("commercial", "Commercial", 1), ...person("operations", "Operations"), ...person("accounts", "Accounts / finance", 1), ...person("compliance", "Compliance")] },
      { id: "banking", title: "Banking", sensitive: 1, intro: "The account payments will be made to or received from. Seen by our compliance officers only.", slots: ["bank_letter"], fields: [
        { k: "bank_name", l: "Bank name", req: 1 }, { k: "bank_country", l: "Branch / country", req: 1 }, { k: "account_name", l: "Account name", req: 1 },
        { k: "account_no", l: "Account number / IBAN", req: 1 }, { k: "swift", l: "SWIFT / BIC", req: 1 }, { k: "currency", l: "Currency", req: 1, ph: "USD" }] },
      { id: "trading", title: "Trading profile", intro: "What you expect to trade with us.", fields: [
        { k: "products", l: "Products / services", t: "textarea", req: 1 },
        { k: "volume", l: "Expected annual value with us", t: "select", req: 1, options: ["Below USD 1 million", "USD 1 – 5 million", "USD 5 – 25 million", "USD 25 – 100 million", "Above USD 100 million"] },
        { k: "source_of_funds", l: "Source of funds", t: "textarea", req: 1 }, { k: "counterparties", l: "Main counterparties and countries", t: "textarea", req: 1 },
        { k: "vessels", l: "Vessels owned / operated — IMO numbers (shipping counterparties, optional)", t: "textarea" }] },
      { id: "documents", title: "Documents", intro: "PDF, JPG, PNG, DOCX or XLSX — up to 15 MB each. Where a required document cannot be provided, say why.", slots: "*" },
      { id: "declaration", title: "Sanctions declaration", intro: "Answered and signed by a director or authorised signatory.", declaration: 1 },
    ],
    // the document checklist. required: the default (COMPLIANCE › Settings may change it per counterparty type); expiry: the slot asks for an expiry date
    slots: [
      { id: "trade_licence", l: "Trade licence", required: 1, expiry: 1, section: "licence" },
      { id: "incorporation", l: "Certificate of incorporation", required: 1 },
      { id: "memorandum", l: "Memorandum & articles of association", required: 1 },
      { id: "share_register", l: "Share register / UBO declaration", required: 1 },
      { id: "ids", l: "Passports / IDs of UBOs and directors", required: 1, expiry: 1, sensitive: 1 },
      { id: "address_proof", l: "Proof of address", required: 1 },
      { id: "tax_cert", l: "Tax / VAT certificate", required: 1, expiry: 1 },
      { id: "bank_letter", l: "Bank confirmation letter", required: 1, section: "banking", sensitive: 1 },
      { id: "financials", l: "Audited financial statements (latest)", required: 1 },
      { id: "board_resolution", l: "Board resolution / power of attorney for the signatory", required: 1, expiry: 1 },
      { id: "policy", l: "Sanctions / compliance policy" },
      { id: "structure_chart", l: "Group structure chart", section: "ownership" },
      { id: "other", l: "Other" },
    ],
    declaration: {
      intro: "In this declaration, “the company” means the legal entity named in this form, and “sanctions” means economic or trade sanctions administered by the United Nations, the United States (OFAC), the European Union, the United Kingdom (OFSI) or the United Arab Emirates.",
      questions: [
        { id: "a", detailsOn: "yes", q: "Is the company, any owner of 25 % or more, any ultimate beneficial owner, director or officer named on any sanctions list (UN, OFAC, EU, UK OFSI, UAE Local Terrorist List), or owned or controlled 50 % or more by such a person?" },
        { id: "b", detailsOn: "yes", q: "Is the company located, organised or operating in, or dealing with, a comprehensively sanctioned country or territory (for example Iran, North Korea, Syria, Cuba, or the Crimea, Donetsk or Luhansk regions)?" },
        { id: "c", detailsOn: "yes", q: "In the last 5 years, has the company dealt in goods, cargoes or vessels subject to sanctions — including price-capped oil without an attestation, or vessels involved in AIS manipulation or ship-to-ship transfers to evade sanctions?" },
        { id: "d", detailsOn: "yes", q: "Has the company or any of its principals been the subject of a sanctions, money-laundering, bribery or fraud investigation, enforcement action or conviction?" },
        { id: "e", detailsOn: "yes", q: "Is any owner, director or senior manager a politically exposed person?" },
        { id: "f", detailsOn: "no", q: "Does the company maintain a sanctions / anti-money-laundering compliance programme?" },
      ],
      undertakings: [
        { id: "true", t: "The information and documents provided are true, accurate and complete." },
        { id: "notify", t: "We will notify you of any change to this information within 30 days." },
        { id: "nobreach", t: "We will not involve you in any transaction that breaches applicable sanctions." },
        { id: "consent", t: "We consent to sanctions and compliance screening, and to the processing of the personal data provided for that purpose." },
      ],
      sign: [{ k: "signatory_name", l: "Signatory name", req: 1 }, { k: "signatory_title", l: "Title", req: 1 }, { k: "signed_date", l: "Date", t: "date", req: 1 }, { k: "signature", l: "Signature — type your full name", req: 1 }],
    },
    // what a sales person never receives (the server strips the same in kyc_strip): whole sections, and these keys of every repeated row
    sensitive: { sections: ["banking"], rowKeys: ["id_no", "dob"] },
    defaults: { validityMonths: 12, reminderDays: 60, linkDays: 30, retentionMonths: 36 },
    statuses: { requested: "Asked by sales", invited: "Awaiting counterparty", submitted: "To review", changes_requested: "Changes requested", approved: "Approved", rejected: "Rejected", expiring: "Expiring", expired: "Expired" },
    risks: ["low", "medium", "high"],
  };
  const S = KYC_SCHEMA;
  const MAXLEN = { text: 300, textarea: 4000, email: 200, tel: 60, date: 10, number: 12, select: 120, yesno: 3 };
  const isDate = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s + "T00:00:00Z"));
  const isEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(s || ""));
  const str = (v, max) => (v == null ? "" : String(v)).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").slice(0, max).trim();
  const section = (id) => S.sections.find((x) => x.id === id) || null;
  const slot = (id) => S.slots.find((x) => x.id === id) || null;
  const typeOf = (v) => S.types.find((x) => x.v === v) || S.types[0];
  const dataSections = () => S.sections.filter((x) => x.fields);
  // ---- shape: only the keys the schema knows, as trimmed strings (rows as arrays of such objects); anything else is dropped
  function cleanField(f, v) {
    if (f.t === "rows") { const rows = Array.isArray(v) ? v.slice(0, f.max || 20) : []; return rows.map((r) => { const o = {}; for (const c of f.cols) o[c.k] = cleanField(c, r && typeof r === "object" ? r[c.k] : ""); return o; }); }
    if (f.t === "check") return v === true || v === "true" || v === 1;
    if (f.t === "yesno") return v === "yes" || v === "no" ? v : "";
    if (f.t === "date") { const s = str(v, 10); return isDate(s) ? s : ""; }
    if (f.t === "select") { const s = str(v, MAXLEN.select); return (f.options || []).includes(s) ? s : ""; }
    if (f.t === "number") { const s = str(v, MAXLEN.number).replace(",", "."); return s !== "" && isFinite(+s) ? String(+s) : ""; }
    return str(v, MAXLEN[f.t || "text"] || 300);
  }
  function sanitize(data) {
    const d = data && typeof data === "object" ? data : {}; const out = {};
    for (const s of dataSections()) { const src = d[s.id] && typeof d[s.id] === "object" ? d[s.id] : {}; const o = {}; for (const f of s.fields) o[f.k] = cleanField(f, src[f.k]); out[s.id] = o; }
    { const src = d.documents && typeof d.documents === "object" && d.documents.na && typeof d.documents.na === "object" ? d.documents.na : {}; const na = {}; for (const x of S.slots) { const v = str(src[x.id], 500); if (v) na[x.id] = v; } out.documents = { na }; }
    { const src = d.declaration && typeof d.declaration === "object" ? d.declaration : {}; const a = src.answers && typeof src.answers === "object" ? src.answers : {}; const u = src.undertakings && typeof src.undertakings === "object" ? src.undertakings : {};
      const dec = { answers: {}, undertakings: {} }; for (const q of S.declaration.questions) { const x = a[q.id] && typeof a[q.id] === "object" ? a[q.id] : {}; dec.answers[q.id] = { v: x.v === "yes" || x.v === "no" ? x.v : "", details: str(x.details, 2000) }; }
      for (const x of S.declaration.undertakings) dec.undertakings[x.id] = u[x.id] === true; for (const f of S.declaration.sign) dec[f.k] = cleanField(f, src[f.k]); out.declaration = dec; }
    return out;
  }
  const blank = () => sanitize({});
  const shown = (f, o) => { if (!f.showIf) return true; const v = o ? o[f.showIf.k] : undefined; return "not" in f.showIf ? v !== f.showIf.not : v === f.showIf.v; };
  function fieldError(f, v) {
    const empty = v == null || v === "" || v === false;
    if (f.req && empty) return f.l.replace(/\s*\(.*?\)\s*/g, " ").trim() + " is required";
    if (empty) return null;
    if (f.t === "email" && !isEmail(v)) return "Enter a valid email address";
    if (f.t === "date" && !isDate(v)) return "Enter a date";
    if (f.t === "number") { const n = +v; if (!isFinite(n)) return "Enter a number"; if (f.min != null && n < f.min) return "At least " + f.min; if (f.max != null && n > f.max) return "At most " + f.max; }
    return null;
  }
  // ---- the documents a type must provide: the schema's defaults unless Settings say otherwise ({ customer: [slot ids], vendor: […], both: […] })
  function requiredSlots(type, settings) { const set = settings && settings.required && Array.isArray(settings.required[type]) ? settings.required[type] : null; const ids = set ? set.filter((id) => slot(id)) : S.slots.filter((x) => x.required).map((x) => x.id); return S.slots.filter((x) => ids.includes(x.id)).map((x) => x.id); }
  const filesIn = (files, id) => (files || []).filter((f) => f && f.slot === id && !f.pending);
  // ---- one section: its errors as [{ k, msg }] (k "ubos.1.name" for a row cell, "slot:ids" for a document, "q:a" for an answer)
  function sectionErrors(id, data, files, ctx) {
    const s = section(id); const d = data || {}; const errs = []; if (!s) return errs; const req = (ctx && ctx.required) || requiredSlots((ctx && ctx.type) || "customer", ctx && ctx.settings);
    const needSlot = (sid) => { const x = slot(sid); if (!req.includes(sid) || filesIn(files, sid).length) return; const why = d.documents && d.documents.na ? d.documents.na[sid] : ""; if (!why || String(why).trim().length < 3) errs.push({ k: "slot:" + sid, msg: x.l + ": attach the document, or say why it is not available" }); };
    if (s.fields) { const o = d[s.id] || {};
      for (const f of s.fields) { if (!shown(f, o)) continue;
        if (f.t === "rows") { const rows = Array.isArray(o[f.k]) ? o[f.k] : []; if (rows.length < (f.min || 0)) errs.push({ k: f.k, msg: "Add at least " + (f.min === 1 ? "one " + f.noun : f.min + " " + f.noun + "s") }); rows.forEach((r, i) => { for (const c of f.cols) { const e = fieldError(c, r ? r[c.k] : ""); if (e) errs.push({ k: f.k + "." + i + "." + c.k, msg: e }); } }); continue; }
        const e = fieldError(f, o[f.k]); if (e) errs.push({ k: f.k, msg: e }); }
      for (const sid of Array.isArray(s.slots) ? s.slots : []) needSlot(sid); }
    if (s.slots === "*") for (const x of S.slots) needSlot(x.id);
    if (s.declaration) { const dec = d.declaration || {}; const a = dec.answers || {}, u = dec.undertakings || {};
      for (const q of S.declaration.questions) { const x = a[q.id] || {}; if (x.v !== "yes" && x.v !== "no") errs.push({ k: "q:" + q.id, msg: "Answer Yes or No" }); else if (x.v === q.detailsOn && String(x.details || "").trim().length < 3) errs.push({ k: "q:" + q.id, msg: "Give the details" }); }
      for (const x of S.declaration.undertakings) if (u[x.id] !== true) errs.push({ k: "u:" + x.id, msg: "Please confirm" });
      for (const f of S.declaration.sign) { const e = fieldError(f, dec[f.k]); if (e) errs.push({ k: f.k, msg: e }); } }
    return errs;
  }
  // ---- the whole package: { ok, errors: [{ section, k, msg }], sections: { id: { complete, errors } }, done, total }
  function validate(data, files, ctx) {
    const out = { ok: true, errors: [], sections: {}, done: 0, total: S.sections.length };
    for (const s of S.sections) { const errs = sectionErrors(s.id, data, files, ctx); out.sections[s.id] = { complete: !errs.length, errors: errs }; if (errs.length) { out.ok = false; for (const e of errs) out.errors.push({ section: s.id, k: e.k, msg: e.msg }); } else out.done++; }
    return out;
  }
  // ---- files: what may be uploaded
  const extOf = (name) => { const m = /\.([A-Za-z0-9]{1,8})$/.exec(String(name || "")); return m ? m[1].toLowerCase() : ""; };
  const safeName = (name) => { const ext = extOf(name); let base = String(name || "").replace(/\.[A-Za-z0-9]{1,8}$/, "").normalize("NFKD").replace(/[^A-Za-z0-9 ._-]+/g, "_").replace(/\s+/g, "-").replace(/\.{2,}/g, ".").replace(/^[.\-_]+|[.\-_]+$/g, "").slice(0, 80); if (!base) base = "document"; return ext ? base + "." + ext : base; };
  function fileError(f, count) {
    if (!f || !slot(f.slot)) return "Unknown document type"; const ext = extOf(f.name); const want = S.files.types[ext];
    if (!want) return "Only PDF, JPG, PNG, DOCX and XLSX files can be attached"; if (f.mime && f.mime !== want && !(want === "image/jpeg" && f.mime === "image/jpg")) return "The file type does not match its extension";
    const size = +f.size; if (!isFinite(size) || size <= 0) return "The file is empty"; if (size > S.files.maxBytes) return "The file is larger than 15 MB";
    if ((count || 0) >= S.files.maxFiles) return "No more than " + S.files.maxFiles + " files can be attached"; return null;
  }
  // ---- dates and validity
  const iso = (d) => d.getUTCFullYear() + "-" + String(d.getUTCMonth() + 1).padStart(2, "0") + "-" + String(d.getUTCDate()).padStart(2, "0");
  function addMonths(date, n) { const s = String(date || "").slice(0, 10); if (!isDate(s)) return ""; const d = new Date(s + "T00:00:00Z"); const day = d.getUTCDate(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + n); const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate(); d.setUTCDate(Math.min(day, last)); return iso(d); }
  const addDays = (date, n) => { const s = String(date || "").slice(0, 10); if (!isDate(s)) return ""; return iso(new Date(Date.parse(s + "T00:00:00Z") + n * 86400000)); };
  const daysBetween = (a, b) => (isDate(a) && isDate(b) ? Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000) : null);
  // the expiry of every required document: each file's own expiry; the trade licence also takes the expiry stated in section 2
  function docExpiries(data, files, required) {
    const out = []; const req = required || requiredSlots("customer");
    for (const sid of req) { const x = slot(sid); if (!x) continue; for (const f of filesIn(files, sid)) if (isDate(f.expiry)) out.push({ slot: sid, label: x.l, name: f.name, expiry: f.expiry }); }
    const lic = data && data.licence; if (req.includes("trade_licence") && lic && !lic.no_expiry && isDate(lic.expiry_date) && !out.some((e) => e.slot === "trade_licence" && e.expiry === lic.expiry_date)) out.push({ slot: "trade_licence", label: slot("trade_licence").l, name: "", expiry: lic.expiry_date });
    return out.sort((a, b) => (a.expiry < b.expiry ? -1 : a.expiry > b.expiry ? 1 : 0));
  }
  const earliestDocExpiry = (data, files, required) => { const e = docExpiries(data, files, required)[0]; return e ? e.expiry : ""; };
  // the default validity an approval proposes: the earlier of submission date + N months and the earliest expiry among the required documents
  function defaultValidUntil(submittedAt, data, files, required, months) { const byTime = addMonths(String(submittedAt || "").slice(0, 10), months == null ? S.defaults.validityMonths : months); const byDoc = earliestDocExpiry(data, files, required); return byDoc && (!byTime || byDoc < byTime) ? byDoc : byTime; }
  // ---- the status shown for a company. Its standing (status: pending / approved / rejected) and the stage of an open onboarding
  // (stage: invited / submitted / changes_requested). An approved company is Approved, Expiring (within reminderDays) or Expired —
  // by the officer's valid_until or by docs_until, the earliest required-document expiry recorded at approval, whichever is first.
  function status(co, today, reminderDays) {
    const standing = (co && co.status) || "pending", stage = (co && co.stage) || "";
    if (standing !== "approved") { const code = stage || (standing === "rejected" ? "rejected" : "invited"); return { code, label: S.statuses[code] || code, until: "", days: null, stage }; }
    const cands = [co.valid_until, co.docs_until].filter(isDate).sort(); const until = cands[0] || ""; const days = until ? daysBetween(today, until) : null; const warn = reminderDays == null ? S.defaults.reminderDays : reminderDays;
    const code = days == null ? "approved" : days < 0 ? "expired" : days <= warn ? "expiring" : "approved";
    return { code, label: S.statuses[code], until, days, stage, because: until && until === co.docs_until && until !== co.valid_until ? "document" : "validity" };
  }
  // ---- what a sales person sees: no banking, no ID numbers, no dates of birth
  function publicView(data) {
    const d = JSON.parse(JSON.stringify(data || {})); for (const id of S.sensitive.sections) delete d[id];
    for (const k of Object.keys(d)) { const sec = d[k]; if (!sec || typeof sec !== "object") continue; for (const f of Object.keys(sec)) if (Array.isArray(sec[f])) for (const row of sec[f]) if (row && typeof row === "object") for (const s of S.sensitive.rowKeys) delete row[s]; }
    return d;
  }
  // ---- the names to screen against the watchlist
  function screenNames(data) { const d = data || {}; const out = []; const c = d.company || {}; if (c.legal_name) out.push({ role: "Company", name: c.legal_name }); if (c.trading_name && c.trading_name !== c.legal_name) out.push({ role: "Trading name", name: c.trading_name }); for (const u of (d.ownership && d.ownership.ubos) || []) if (u && u.name) out.push({ role: "Owner / UBO", name: u.name }); for (const x of (d.ownership && d.ownership.directors) || []) if (x && x.name) out.push({ role: "Director", name: x.name }); return out; }
  // ---- automatic flags for the reviewer (watchlist hits are added by the app, which holds the watchlist)
  function flags(data, files, ctx) {
    const d = data || {}; const out = []; const today = (ctx && ctx.today) || ""; const req = (ctx && ctx.required) || requiredSlots((ctx && ctx.type) || "customer", ctx && ctx.settings);
    const dec = d.declaration || {}; for (const q of S.declaration.questions) { const a = (dec.answers || {})[q.id] || {}; if (a.v && a.v === q.detailsOn) out.push({ level: "high", code: "declaration:" + q.id, text: "Declaration (" + q.id + ") answered " + (a.v === "yes" ? "Yes" : "No"), detail: a.details || "" }); }
    for (const sid of req) { const x = slot(sid); if (x && !filesIn(files, sid).length) out.push({ level: "medium", code: "missing:" + sid, text: "Missing required document: " + x.l, detail: (d.documents && d.documents.na && d.documents.na[sid]) || "" }); }
    for (const f of files || []) { if (f && !f.pending && isDate(f.expiry) && today && f.expiry < today) { const x = slot(f.slot); out.push({ level: "medium", code: "expired:" + (f.id || f.name), text: "Expired document: " + (x ? x.l : f.slot), detail: f.name + " · expired " + f.expiry }); } }
    const lic = d.licence || {}; if (!lic.no_expiry && isDate(lic.expiry_date) && today && lic.expiry_date < today) out.push({ level: "medium", code: "expired:licence", text: "Trade licence expired", detail: "expired " + lic.expiry_date });
    for (const u of (d.ownership && d.ownership.ubos) || []) { if (u && u.pep === "yes") out.push({ level: "medium", code: "pep:" + u.name, text: "Politically exposed person: " + u.name, detail: "" }); if (u && isDate(u.id_expiry) && today && u.id_expiry < today) out.push({ level: "low", code: "idexp:" + u.name, text: "ID expired: " + u.name, detail: "expired " + u.id_expiry }); }
    return out;
  }
  // ---- the link's token: 32 random bytes as base64url (43 characters); only its SHA-256 (hex) is ever stored
  const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
  const tokenOk = (t) => typeof t === "string" && TOKEN_RE.test(t);
  const b64url = (bytes) => { let s = ""; for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]); const b = typeof btoa === "function" ? btoa(s) : Buffer.from(bytes).toString("base64"); return b.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); };
  const hex = (bytes) => { let s = ""; for (let i = 0; i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, "0"); return s; };
  async function sha256Hex(text) { const c = (typeof crypto !== "undefined" && crypto.subtle) ? crypto : (typeof require === "function" ? require("crypto").webcrypto : null); const buf = await c.subtle.digest("SHA-256", new TextEncoder().encode(String(text))); return hex(new Uint8Array(buf)); }
  // compares two strings in time that depends on their length only
  function timingSafeEqual(a, b) { a = String(a); b = String(b); let diff = a.length ^ b.length; const n = Math.max(a.length, b.length); for (let i = 0; i < n; i++) diff |= (a.charCodeAt(i % (a.length || 1)) || 0) ^ (b.charCodeAt(i % (b.length || 1)) || 0); return diff === 0; }
  // retention: a company is due for erasure n months after its KYC ended (Settings: retentionMonths; stored, shown, never automatic)
  function eraseDue(co, today, months) { if (!co || co.status !== "approved") return ""; const st = status(co, today, 0); if (st.code !== "expired" || !st.until) return ""; const due = addMonths(st.until, months == null ? S.defaults.retentionMonths : months); return due && due <= today ? due : ""; }
  // what the link shows once a package is no longer editable: a neutral word, never the decision
  const receiptState = (state) => ({ received: "Received", completed: "Completed", changes_requested: "Changes requested" })[state] || "Received";
  const linkOf = (base, token) => String(base || "").replace(/\/?$/, "/") + "#/kyc/" + token;
  return { KYC_SCHEMA, SCHEMA: KYC_SCHEMA, YES_NO, section, slot, typeOf, sanitize, blank, shown, fieldError, requiredSlots, filesIn, sectionErrors, validate, extOf, safeName, fileError, isDate, isEmail, addMonths, addDays, daysBetween, docExpiries, earliestDocExpiry, defaultValidUntil, status, eraseDue, receiptState, publicView, screenNames, flags, tokenOk, b64url, hex, sha256Hex, timingSafeEqual, linkOf };
});
