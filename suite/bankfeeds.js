/* XYNTAX — bank statement parsers (4.16). Pure functions, no DOM dependency beyond an optional DOMParser:
 *   BANKFEEDS.detect(text)            → "mt940" | "camt053" | "csv" | null
 *   BANKFEEDS.parse(text, filename)   → { format, account: { iban, currency, bank, number }, statement: { id, from, to, openingBalance, closingBalance },
 *                                        lines: [{ date, valueDate, amount (signed), currency, reference, description, counterparty, iban, kind, raw }], warnings }
 *   BANKFEEDS.toImportRows(parsed)    → what E.importStatement expects: { rows, hasHeader: false, map: { date, desc, amount, ref }, statementBalance, asOf, currency }
 * MT940 (SWIFT, with the :86: sub-field conventions of Danske Bank, Nordea, HSBC, Emirates NBD, Mashreq, ADCB), CAMT.053 (ISO 20022
 * XML — DOMParser in the browser, a small walker under node) and CSV (delimiter, decimal and date-format detection, header synonyms in
 * English, Danish, German, French and Arabic transliterations, debit/credit columns or D/C markers). Runs in node (tests) and the renderer. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.BANKFEEDS = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // ---------- small helpers
  const r2 = (n) => Math.round((+n + Number.EPSILON) * 100) / 100;
  const pad2 = (n) => String(n).padStart(2, "0");
  const clean = (s) => String(s == null ? "" : s).replace(/\s+/g, " ").trim();
  const stripBom = (t) => String(t || "").replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12, maj: 5, okt: 10, mrz: 3, mär: 3, dez: 12, janv: 1, févr: 2, fevr: 2, mars: 3, avr: 4, mai: 5, juin: 6, juil: 7, août: 8, aout: 8, sept_: 9, déc: 12 };
  const iso = (y, m, d) => y + "-" + pad2(m) + "-" + pad2(d);
  const validDate = (y, m, d) => m >= 1 && m <= 12 && d >= 1 && d <= 31 && y >= 1900 && y <= 2100 && new Date(Date.UTC(y, m - 1, d)).getUTCDate() === d;
  // CSV dates: accepts yyyy-mm-dd, dd.mm.yyyy, dd/mm/yyyy, dd-mm-yyyy, dd-MMM-yy(yy), MMM dd yyyy, yyyymmdd; `dayFirst` settles dd/mm vs mm/dd
  function parseDate(v, dayFirst) {
    if (v == null) return null; const t = String(v).trim(); let m;
    if ((m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return validDate(+m[1], +m[2], +m[3]) ? iso(+m[1], +m[2], +m[3]) : null;
    if ((m = t.match(/^(\d{4})(\d{2})(\d{2})$/))) return validDate(+m[1], +m[2], +m[3]) ? iso(+m[1], +m[2], +m[3]) : null;
    if ((m = t.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})/))) { let a = +m[1], b = +m[2]; const y = +m[3]; let d = a, mo = b; if (dayFirst === false) { d = b; mo = a; } else if (dayFirst == null && a <= 12 && b > 12) { d = b; mo = a; } return validDate(y, mo, d) ? iso(y, mo, d) : null; }
    if ((m = t.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2})$/))) { let d = +m[1], mo = +m[2]; if (dayFirst === false) { d = +m[2]; mo = +m[1]; } const y = 2000 + +m[3]; return validDate(y, mo, d) ? iso(y, mo, d) : null; }
    if ((m = t.match(/^(\d{1,2})[ \-\/.]([A-Za-zéûä]{3,5})\.?[ \-\/.](\d{2,4})$/))) { const mo = MONTHS[m[2].toLowerCase().replace(/\.$/, "")]; const y = m[3].length === 2 ? 2000 + +m[3] : +m[3]; return mo && validDate(y, mo, +m[1]) ? iso(y, mo, +m[1]) : null; }
    if ((m = t.match(/^([A-Za-z]{3,5})\.?\s+(\d{1,2}),?\s+(\d{4})$/))) { const mo = MONTHS[m[1].toLowerCase()]; return mo && validDate(+m[3], mo, +m[2]) ? iso(+m[3], mo, +m[2]) : null; }
    return null;
  }
  // amounts: "1.234,56" / "1,234.56" / "1 234,56" / "(123.45)" / "-0" / "123.45-" / "CR 12.00"; `decimal` forces "," or "."
  function parseAmount(v, decimal) {
    if (v == null) return NaN; let t = String(v).trim(); if (!t) return NaN;
    let neg = /^\(.*\)$/.test(t) || /^-/.test(t) || /-\s*$/.test(t) || /^(DR|D|DB|DEBIT|DEBET|SOLL)\b/i.test(t) || /\b(DR|DEBIT)\s*$/i.test(t); if (/^(CR|C|CREDIT|KREDIT|HABEN)\b/i.test(t) || /\b(CR|CREDIT)\s*$/i.test(t)) neg = false;
    t = t.replace(/^(CR|DR|C|D|DB|DEBIT|DEBET|CREDIT|KREDIT|SOLL|HABEN)\b\.?/i, "").replace(/\b(CR|DR|DEBIT|CREDIT)\s*$/i, "").replace(/[A-Za-z]{3}\b/g, "").replace(/[^\d.,'’\u00a0 ]/g, "").replace(/[\s\u00a0'’]/g, "");
    if (!t || !/\d/.test(t)) return NaN;
    let dec = decimal;
    if (!dec) { const lc = t.lastIndexOf(","), ld = t.lastIndexOf("."); if (lc >= 0 && ld >= 0) dec = lc > ld ? "," : "."; else if (lc >= 0 || ld >= 0) { const sep = lc >= 0 ? "," : "."; const pos = Math.max(lc, ld); const tail = t.length - pos - 1; const count = (t.match(sep === "," ? /,/g : /\./g) || []).length; dec = tail === 3 || count > 1 ? (sep === "," ? "." : ",") : sep; } else dec = "."; }
    if (dec === ",") t = t.replace(/\./g, "").replace(",", "."); else t = t.replace(/,/g, "");
    const n = parseFloat(t); if (isNaN(n)) return NaN; const out = neg ? -n : n; return Object.is(out, -0) || out === 0 ? 0 : out;
  }

  // ---------- classification of a line into a kind
  // stems match anywhere (Kontoführungsgebühr, Overførselsgebyr, Renteindtægt); words need letter boundaries (fee, pos, tt)
  const W = (list) => new RegExp("(?<![\\p{L}\\p{N}])(?:" + list.join("|") + ")(?![\\p{L}\\p{N}])", "iu");
  const S = (list) => new RegExp("(?:" + list.join("|") + ")", "iu");
  const KIND_RULES = [
    ["fee", S(["gebyr", "gebuehr", "gebühr", "frais", "entgelt", "rusoom", "rasoom", "masarif", "service charge", "bank charges", "charges", "vat on"]), W(["fee", "fees", "charge", "maintenance", "sms charge", "kontogebyr"])],
    ["interest", S(["rente", "zins", "intérêt", "interet", "faida", "fawaid"]), W(["interest", "profit paid", "profit credit"])],
    ["fx", S(["forex", "wechselkurs", "devisen", "conversion", "tahweel", "sarf"]), W(["fx", "exchange", "valutahandel", "devise", "fx deal"])],
    ["card", S(["kortkøb", "kortbetaling", "dankort", "mastercard", "visa", "karte", "kreditkarte", "carte", "bitaqa", "cash withdrawal", "hævning", "haevning", "cashpoint"]), W(["card", "kort", "pos", "atm", "debit card", "credit card", "sahb"])],
    ["transfer", S(["overførsel", "overfoersel", "überweisung", "ueberweisung", "gutschrift", "lastschrift", "virement", "telegraphic", "hawala", "tahwil", "remittance", "løn", "salaire", "salary", "betaling", "zahlung", "paiement", "faktura", "invoice", "rechnung", "facture", "credit transfer", "direct debit", "standing order"]), W(["transfer", "swift", "sepa", "tt", "wire", "neft", "rtgs", "ift", "payment", "lohn", "dd", "ach"])],
  ];
  function kindOf(text, mtCode) {
    const code = String(mtCode || "").toUpperCase();
    if (/^N?(CHG|COM)$/.test(code)) return "fee"; if (/^N?INT$/.test(code)) return "interest"; if (/^N?FEX$/.test(code)) return "fx"; if (/^N?(CHK|DDT|STO|TRF|SEC|BNK|CLR)$/.test(code)) return "transfer";
    const t = String(text || "");
    for (const [k, stem, word] of KIND_RULES) if (stem.test(t) || word.test(t)) return k;
    return "other";
  }
  const IBAN_RE = /\b([A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){2,7}(?:[ ]?[A-Z0-9]{1,4})?)\b/;
  const ibanIn = (t) => { const m = String(t || "").toUpperCase().match(IBAN_RE); if (!m) return ""; const v = m[1].replace(/\s/g, ""); return v.length >= 15 && v.length <= 34 && /^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(v) ? v : ""; };

  // ---------- MT940
  function mtDate(yymmdd, yearHint) { const m = String(yymmdd || "").match(/^(\d{2})(\d{2})(\d{2})$/); if (!m) return null; const y = 2000 + +m[1]; return validDate(y, +m[2], +m[3]) ? iso(y, +m[2], +m[3]) : null; }
  function mtAmount(t) { const n = parseFloat(String(t || "").replace(/\./g, "").replace(",", ".")); return isNaN(n) ? NaN : n; }
  // :60F:C240930EUR1234,56  → { sign, date, currency, amount }
  function mtBalance(v) { const m = String(v || "").trim().match(/^([CD])(\d{6})([A-Z]{3})([\d,\.]+)$/); if (!m) return null; const a = mtAmount(m[4]); return { date: mtDate(m[2]), currency: m[3], amount: m[1] === "D" ? -a : a }; }
  // :61:2409300930DR1234,56NTRFNONREF//BANKREF
  function mtLine61(v) {
    const m = String(v || "").trim().match(/^(\d{6})(\d{4})?(R?[CD])([A-Z])?([\d,]+)([A-Z][A-Z0-9]{3})(.*)$/);
    if (!m) return null; const sign = /D$/.test(m[3]) ? -1 : 1; const reversal = /^R/.test(m[3]);
    const rest = m[7] || ""; const parts = rest.split("//"); const ref = clean(parts[0]).replace(/^NONREF$/i, ""); const bankRef = clean(parts[1] || "");
    const amount = mtAmount(m[5]) * (reversal ? -sign : sign);
    const date = mtDate(m[1]); let valueDate = date; if (m[2]) { const y = +("20" + m[1].slice(0, 2)); let mo = +m[2].slice(0, 2), d = +m[2].slice(2, 4); let yy = y; if (date && mo === 12 && +date.slice(5, 7) === 1) yy = y - 1; if (date && mo === 1 && +date.slice(5, 7) === 12) yy = y + 1; valueDate = validDate(yy, mo, d) ? iso(yy, mo, d) : date; }
    return { date: valueDate, valueDate, bookingDate: date, amount, code: m[6], reference: ref, bankRef, raw61: v };
  }
  // :86: sub-fields — the common conventions: "/CODE/value" (Danske/Nordea/HSBC/ENBD), "?20…?32…" (German/SWIFT structured), free text
  function mt86(text, sign) {
    const t = String(text || "").replace(/\n/g, " ").trim(); const out = { description: "", counterparty: "", iban: "", reference: "", kind: "" };
    if (/\?\d{2}/.test(t)) { // ?00 GVC text ?20..?29 purpose ?30 bank ?31 account ?32/?33 name ?34 ?60..?63 purpose
      const f = {}; for (const m of t.matchAll(/\?(\d{2})([^?]*)/g)) f[m[1]] = (f[m[1]] || "") + m[2];
      const purpose = ["20", "21", "22", "23", "24", "25", "26", "27", "28", "29", "60", "61", "62", "63"].map((k) => f[k] || "").join(" ");
      out.description = clean((f["00"] ? f["00"] + " " : "") + purpose); out.counterparty = clean((f["32"] || "") + (f["33"] || "")); out.iban = ibanIn(f["31"] || "") || ibanIn(purpose); out.reference = clean(purpose.match(/\b(EREF|KREF|MREF|SVWZ)\+([^ ]+)/i) ? purpose.match(/\b(EREF|KREF|MREF|SVWZ)\+([^ ]+)/i)[2] : ""); return out;
    }
    if (/\/[A-Z]{2,6}\//.test(t)) { // /ORDP/NAME/REMI/text/IBAN/.. (SWIFT MT structured) or Danske "/BENM/…/REMI/…"
      const f = {}; for (const m of t.matchAll(/\/([A-Z]{2,6})\/([^\/]*(?:\/(?![A-Z]{2,6}\/)[^\/]*)*)/g)) f[m[1]] = clean(m[2]);
      out.counterparty = (sign < 0 ? (f.BENM || f.CDTR || f.PAYEE || f.ORDP) : (f.ORDP || f.DBTR || f.PAYER || f.BENM)) || f.NAME || f.CNTP || ""; out.iban = ibanIn(f.IBAN || f.ACCT || "") || ibanIn(t); out.reference = f.EREF || f.REF || f.PREF || f.RREF || f.KREF || f.REMI || ""; out.description = clean([f.REMI || f.PURP || f.DESC || f.TXT || "", f.EREF && !f.REMI ? f.EREF : ""].filter(Boolean).join(" ")) || clean(t.replace(/\/[A-Z]{2,6}\//g, " ")); return out;
    }
    out.description = clean(t); out.iban = ibanIn(t);
    const nm = t.match(/(?:from|to|fra|til|von|an|de|à)\s*:?\s+([A-Z][A-Za-z0-9&.' \-]{2,40}?)(?=\s{2,}|\s*(?:ref|iban|inv|$))/i); if (nm) out.counterparty = clean(nm[1]);
    return out;
  }
  function parseMT940(text, warnings) {
    const t = stripBom(text); const lines = t.split("\n"); const tags = []; let cur = null; let started = false;
    for (const raw of lines) { const line = raw.replace(/\s+$/, ""); if (!line) continue; if (/^\{\d:/.test(line) || line === "-" || /^-\}$/.test(line)) { if (line === "-" && cur) { tags.push(cur); cur = null; } continue; } const m = line.match(/^:(\d{2}[A-Z]?):(.*)$/); if (m) { if (cur) tags.push(cur); cur = { tag: m[1], value: m[2] }; started = true; } else if (cur && started) cur.value += "\n" + line; }
    if (cur) tags.push(cur);
    if (!tags.some((x) => x.tag === "61")) { warnings.push("MT940: no :61: statement lines found"); }
    const statements = []; let st = null; let last = null;
    for (const x of tags) {
      if (x.tag === "20") { st = { id: clean(x.value), account: "", currency: "", openingBalance: null, closingBalance: null, from: null, to: null, lines: [], number: "" }; statements.push(st); last = null; continue; }
      if (!st) { st = { id: "", account: "", currency: "", openingBalance: null, closingBalance: null, from: null, to: null, lines: [], number: "" }; statements.push(st); }
      if (x.tag === "25") st.account = clean(x.value).replace(/^\/+/, "");
      else if (x.tag === "28C" || x.tag === "28") st.number = clean(x.value);
      else if (x.tag === "60F" || x.tag === "60M") { const b = mtBalance(x.value); if (b) { if (x.tag === "60F" || st.openingBalance == null) { st.openingBalance = b.amount; st.from = b.date; } st.currency = st.currency || b.currency; } else warnings.push("MT940: unreadable :60: " + x.value); }
      else if (x.tag === "62F" || x.tag === "62M") { const b = mtBalance(x.value); if (b) { st.closingBalance = b.amount; st.to = b.date; st.currency = st.currency || b.currency; } else warnings.push("MT940: unreadable :62: " + x.value); }
      else if (x.tag === "61") { const l = mtLine61(x.value); if (!l) { warnings.push("MT940: unreadable :61: " + x.value); last = null; continue; } last = l; st.lines.push(l); }
      else if (x.tag === "86") { if (last) { last.info86 = (last.info86 ? last.info86 + "\n" : "") + x.value; } else st.info = x.value; }
      else if (x.tag === "64" || x.tag === "65") { /* available balances — ignored */ }
    }
    const allLines = []; let currency = "", account = "", bank = "";
    for (const s of statements) { currency = currency || s.currency; account = account || s.account; for (const l of s.lines) { const f = mt86(l.info86 || "", l.amount < 0 ? -1 : 1); const description = clean(f.description || l.reference || l.code); allLines.push({ date: l.date, valueDate: l.valueDate, bookingDate: l.bookingDate, amount: r2(l.amount), currency: s.currency || currency, reference: f.reference || l.reference || l.bankRef || "", description, counterparty: f.counterparty || "", iban: f.iban || "", kind: kindOf(description + " " + (f.counterparty || ""), l.code), code: l.code, raw: (l.raw61 || "") + (l.info86 ? " | " + l.info86.replace(/\n/g, " ") : "") }); } }
    const first = statements[0] || {}; const lastS = statements[statements.length - 1] || {};
    const ib = ibanIn(account); if (/DABADKKK|DANSKE/i.test(t)) bank = "Danske Bank"; else if (/NDEADKKK|NORDEA/i.test(t)) bank = "Nordea"; else if (/HSBC|HBUK|MIDL/i.test(t)) bank = "HSBC"; else if (/EBILAEAD|EMIRATES NBD|ENBD/i.test(t)) bank = "Emirates NBD"; else if (/BOMLAEAD|MASHREQ/i.test(t)) bank = "Mashreq"; else if (/ADCBAEAA|ADCB/i.test(t)) bank = "ADCB";
    // balance check: opening + movements = closing (per statement); a mismatch is a warning, not an error
    for (const s of statements) { if (s.openingBalance != null && s.closingBalance != null) { const sum = s.lines.reduce((k, l) => k + l.amount, 0); if (Math.abs(r2(s.openingBalance + sum) - r2(s.closingBalance)) > 0.005) warnings.push("MT940: statement " + (s.number || s.id) + " does not balance (" + r2(s.openingBalance + sum) + " vs " + s.closingBalance + ")"); } }
    return { format: "mt940", account: { iban: ib, number: account, currency, bank }, statement: { id: first.id || "", number: statements.map((s) => s.number).filter(Boolean).join(", "), from: first.from || (allLines[0] && allLines[0].date) || null, to: lastS.to || (allLines.length ? allLines[allLines.length - 1].date : null), openingBalance: first.openingBalance, closingBalance: lastS.closingBalance, statements: statements.length }, lines: allLines, warnings };
  }

  // ---------- CAMT.053 (ISO 20022)
  // a tiny element tree: { name, attrs, children, text } — DOMParser when present, a forgiving walker otherwise
  function xmlTree(text) {
    const src = stripBom(text).replace(/<\?xml[^>]*\?>/g, "").replace(/<!--[\s\S]*?-->/g, "");
    const root = { name: "#root", children: [], text: "" }; const stack = [root]; let i = 0; const n = src.length;
    const decode = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d)).replace(/&amp;/g, "&");
    while (i < n) {
      const lt = src.indexOf("<", i); if (lt < 0) { stack[stack.length - 1].text += decode(src.slice(i)); break; }
      if (lt > i) stack[stack.length - 1].text += decode(src.slice(i, lt));
      const gt = src.indexOf(">", lt); if (gt < 0) break; const tag = src.slice(lt + 1, gt).trim(); i = gt + 1;
      if (tag.startsWith("![CDATA[")) { const end = src.indexOf("]]>", lt); stack[stack.length - 1].text += src.slice(lt + 9, end < 0 ? n : end); i = end < 0 ? n : end + 3; continue; }
      if (tag.startsWith("/")) { if (stack.length > 1) stack.pop(); continue; }
      const selfClose = tag.endsWith("/"); const body = selfClose ? tag.slice(0, -1) : tag; const sp = body.search(/\s/); const name = (sp < 0 ? body : body.slice(0, sp)).replace(/^[A-Za-z0-9]+:/, ""); const el = { name, attrs: {}, children: [], text: "" };
      if (sp > 0) for (const m of body.slice(sp).matchAll(/([A-Za-z0-9:_\-]+)\s*=\s*"([^"]*)"/g)) el.attrs[m[1]] = m[2];
      stack[stack.length - 1].children.push(el); if (!selfClose) stack.push(el);
    }
    return root;
  }
  const kids = (el, name) => (el && el.children ? el.children.filter((c) => c.name === name) : []);
  const kid = (el, name) => kids(el, name)[0] || null;
  const path = (el, ...names) => { let cur = el; for (const nm of names) { cur = kid(cur, nm); if (!cur) return null; } return cur; };
  const txt = (el) => (el ? clean(el.text) : "");
  const deep = (el, name) => { if (!el) return null; for (const c of el.children || []) { if (c.name === name) return c; const f = deep(c, name); if (f) return f; } return null; };
  function parseCAMT(text, warnings) {
    const root = xmlTree(text); const doc = deep(root, "BkToCstmrStmt") || deep(root, "BkToCstmrAcctRpt") || deep(root, "Document") || root;
    const stmts = kids(doc, "Stmt").length ? kids(doc, "Stmt") : kids(doc, "Rpt").length ? kids(doc, "Rpt") : (deep(doc, "Stmt") ? [deep(doc, "Stmt")] : []);
    if (!stmts.length) warnings.push("CAMT: no <Stmt> found");
    const lines = []; let account = { iban: "", number: "", currency: "", bank: "" }; let statement = { id: "", from: null, to: null, openingBalance: null, closingBalance: null, statements: stmts.length };
    for (const s of stmts) {
      const acct = kid(s, "Acct"); const ib = txt(path(acct, "Id", "IBAN")); const othr = txt(path(acct, "Id", "Othr", "Id")); const ccy = txt(kid(acct, "Ccy")); const bank = txt(path(acct, "Svcr", "FinInstnId", "Nm")) || txt(path(acct, "Svcr", "FinInstnId", "BICFI")) || txt(path(acct, "Svcr", "FinInstnId", "BIC"));
      account = { iban: account.iban || ib, number: account.number || othr || ib, currency: account.currency || ccy, bank: account.bank || bank };
      statement.id = statement.id || txt(kid(s, "Id")); const fr = txt(path(s, "FrToDt", "FrDtTm")), to = txt(path(s, "FrToDt", "ToDtTm")); if (fr) statement.from = statement.from || fr.slice(0, 10); if (to) statement.to = to.slice(0, 10);
      for (const bal of kids(s, "Bal")) { const code = txt(path(bal, "Tp", "CdOrPrtry", "Cd")); const amtEl = kid(bal, "Amt"); const amt = parseFloat(txt(amtEl)); const sign = txt(kid(bal, "CdtDbtInd")) === "DBIT" ? -1 : 1; const d = txt(path(bal, "Dt", "Dt")) || txt(path(bal, "Dt", "DtTm")).slice(0, 10); if (!isNaN(amt)) { if (code === "OPBD" || (code === "PRCD" && statement.openingBalance == null)) { if (statement.openingBalance == null) { statement.openingBalance = sign * amt; statement.from = statement.from || d; } } else if (code === "CLBD") { statement.closingBalance = sign * amt; statement.to = d || statement.to; } if (amtEl && amtEl.attrs && amtEl.attrs.Ccy) account.currency = account.currency || amtEl.attrs.Ccy; } }
      for (const e of kids(s, "Ntry")) {
        const amtEl = kid(e, "Amt"); const amt = parseFloat(txt(amtEl)); if (isNaN(amt)) { warnings.push("CAMT: entry without amount"); continue; }
        const sign = txt(kid(e, "CdtDbtInd")) === "DBIT" ? -1 : 1; const rev = txt(kid(e, "RvslInd")) === "true"; const amount = r2(amt * sign * (rev ? -1 : 1));
        const bookg = txt(path(e, "BookgDt", "Dt")) || txt(path(e, "BookgDt", "DtTm")).slice(0, 10); const val = txt(path(e, "ValDt", "Dt")) || txt(path(e, "ValDt", "DtTm")).slice(0, 10) || bookg;
        const ccy = (amtEl && amtEl.attrs && amtEl.attrs.Ccy) || account.currency; const ref = txt(kid(e, "AcctSvcrRef")) || txt(kid(e, "NtryRef"));
        const dtls = deep(e, "TxDtls"); const refs = dtls ? kid(dtls, "Refs") : null; const endToEnd = txt(kid(refs, "EndToEndId")); const instrId = txt(kid(refs, "InstrId")); const txRef = txt(kid(refs, "TxId"));
        const parties = dtls ? kid(dtls, "RltdPties") : null; const debtor = txt(path(parties, "Dbtr", "Nm")) || txt(path(parties, "Dbtr", "Pty", "Nm")); const creditor = txt(path(parties, "Cdtr", "Nm")) || txt(path(parties, "Cdtr", "Pty", "Nm"));
        const counterparty = sign > 0 ? (debtor || creditor) : (creditor || debtor); const cpIban = sign > 0 ? txt(path(parties, "DbtrAcct", "Id", "IBAN")) : txt(path(parties, "CdtrAcct", "Id", "IBAN"));
        const ustrd = dtls ? kids(kid(dtls, "RmtInf"), "Ustrd").map(txt).join(" ") : ""; const strd = dtls ? txt(path(kid(dtls, "RmtInf"), "Strd", "CdtrRefInf", "Ref")) : ""; const addtl = txt(kid(e, "AddtlNtryInf")) || (dtls ? txt(kid(dtls, "AddtlTxInf")) : "");
        const fam = txt(path(e, "BkTxCd", "Domn", "Fmly", "Cd")); const sub = txt(path(e, "BkTxCd", "Domn", "Fmly", "SubFmlyCd")); const prtry = txt(path(e, "BkTxCd", "Prtry", "Cd"));
        const description = clean(ustrd || strd || addtl || prtry || sub || "");
        let kind = kindOf(description + " " + counterparty + " " + prtry);
        if (kind === "other") { if (/^(CHRG|FEES)$/.test(sub) || /^CHRG$/.test(fam)) kind = "fee"; else if (/^INTR$|^INT/.test(sub) || /^INTR$/.test(fam)) kind = "interest"; else if (/^FEX|^FX/.test(fam) || /FEX/.test(sub)) kind = "fx"; else if (/^CCRD|^MCRD|^ICDT|^RCDT|^RDDT|^IDDT|^ESCT|^ESDD/.test(fam) || /POSD|POSC|CWDL/.test(sub)) kind = /CCRD|MCRD|POS|CWDL/.test(fam + sub) ? "card" : "transfer"; }
        lines.push({ date: val || bookg, valueDate: val || bookg, bookingDate: bookg || val, amount, currency: ccy, reference: endToEnd !== "NOTPROVIDED" && endToEnd ? endToEnd : (strd || txRef || instrId || ref || ""), description, counterparty: counterparty || "", iban: cpIban || "", kind, code: [fam, sub].filter(Boolean).join("/"), raw: ref });
      }
    }
    if (statement.openingBalance != null && statement.closingBalance != null) { const sum = lines.reduce((k, l) => k + l.amount, 0); if (Math.abs(r2(statement.openingBalance + sum) - r2(statement.closingBalance)) > 0.005) warnings.push("CAMT: statement does not balance (" + r2(statement.openingBalance + sum) + " vs " + statement.closingBalance + ")"); }
    return { format: "camt053", account, statement, lines, warnings };
  }

  // ---------- CSV
  function splitCsv(text, delim) {
    const rows = []; let row = [], cell = "", q = false; const t = text;
    for (let i = 0; i < t.length; i++) { const c = t[i]; if (q) { if (c === '"') { if (t[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; } else if (c === '"') q = true; else if (c === delim) { row.push(cell); cell = ""; } else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; } else cell += c; }
    if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
    return rows.filter((r) => r.some((x) => String(x).trim() !== ""));
  }
  function detectDelimiter(text) { const all = text.split("\n").filter((l) => l.trim()); const tail = all.slice(-12); const cands = [",", ";", "\t", "|"]; let best = ",", bestN = -1; for (const d of cands) { const counts = tail.map((l) => (l.match(d === "|" ? /\|/g : d === "\t" ? /\t/g : new RegExp(d, "g")) || []).length).filter((n) => n > 0); if (!counts.length) continue; const min = Math.min(...counts), max = Math.max(...counts); const score = (min === max ? min * 10 : min) * (counts.length / tail.length); if (score > bestN) { bestN = score; best = d; } } return best; }
  const H = {
    date: ["date", "dato", "bogføringsdato", "bogforingsdato", "bogført", "datum", "buchungstag", "buchungsdatum", "date opération", "date operation", "date de l'opération", "transaction date", "trans date", "txn date", "posting date", "booking date", "tareekh", "tarikh", "al-tareekh"],
    valueDate: ["value date", "valør", "valørdato", "valoer", "valuta", "wertstellung", "valutadatum", "date valeur", "date de valeur", "val date", "tareekh al qeema"],
    desc: ["description", "verwendungszweck", "tekst", "beskrivelse", "posteringstekst", "buchungstext", "umsatz", "libellé", "libelle", "description de l'opération", "narration", "narrative", "details", "transaction details", "particulars", "memo", "text", "wasf", "bayan", "tafasil"],
    amount: ["amount", "beløb", "beloeb", "betrag", "umsatzbetrag", "montant", "sum", "value", "mablagh", "qeema", "al-mablagh", "amount (aed)", "transaction amount"],
    debit: ["debit", "debet", "udgift", "hævet", "haevet", "soll", "lastschrift", "débit", "ausgang", "withdrawal", "withdrawals", "dr", "debit amount", "money out", "paid out", "madeen", "sahb"],
    credit: ["credit", "kredit", "indtægt", "indsat", "haben", "gutschrift", "crédit", "eingang", "deposit", "deposits", "cr", "credit amount", "money in", "paid in", "daen", "eedaa"],
    balance: ["balance", "saldo", "kontostand", "solde", "running balance", "closing balance", "al-raseed", "raseed"],
    ref: ["reference", "ref", "referens", "reference number", "ref no", "ref.", "bankreference", "kundenreferenz", "référence", "reference no.", "cheque no", "chq no", "transaction id", "txn id", "id", "marjia"],
    counterparty: ["counterparty", "modpart", "name", "navn", "beneficiary", "payee", "payer", "auftraggeber", "empfänger", "empfaenger", "begünstigter", "beguenstigter", "contrepartie", "bénéficiaire", "remitter", "ism", "al-mustafeed"],
    iban: ["iban", "account", "konto", "kontonummer", "account number", "iban/bban", "hisab", "raqm al hisab"],
    dc: ["d/c", "dc", "debit/credit", "type", "cr/dr", "dr/cr", "indicator", "art", "sens", "signe", "débit/crédit", "debit/credit indicator", "dr/cr indicator", "transaction type"],
    currency: ["currency", "valuta", "währung", "waehrung", "devise", "ccy", "omla"],
  };
  const norm = (s) => clean(String(s || "")).toLowerCase().replace(/[_\-]+/g, " ").replace(/\s+/g, " ").replace(/[.:]+$/, "");
  function mapHeader(cells) {
    const map = {}; const used = new Set();
    const find = (key) => { const names = H[key]; let best = -1, bestScore = 0; cells.forEach((c, i) => { if (used.has(i)) return; const n = norm(c); if (!n) return; let score = 0; for (let ni = 0; ni < names.length; ni++) { const nm = names[ni]; if (n === nm) { score = 3 + (names.length - ni) / 1000; break; } if (n.startsWith(nm + " ") || n.endsWith(" " + nm) || n.includes("(" + nm)) score = Math.max(score, 2); else if (n.includes(nm) && nm.length > 3) score = Math.max(score, 1); } if (score > bestScore) { bestScore = score; best = i; } }); if (best >= 0) used.add(best); return best; };
    for (const k of ["date", "valueDate", "debit", "credit", "amount", "balance", "desc", "counterparty", "ref", "iban", "dc", "currency"]) { const i = find(k); if (i >= 0) map[k] = i; }
    if (map.desc != null) { const j = find("desc"); if (j >= 0) map.desc2 = j; }
    return map;
  }
  const looksLikeHeader = (row) => row.filter((c) => c && c.trim()).length >= 2 && row.filter((c) => parseDate(c) || (/\d/.test(c) && !isNaN(parseAmount(c)) && !/[A-Za-z]{3,}/.test(c))).length === 0;
  // dd/mm unless a month-position above 12 proves mm/dd; ISO or named-month dates leave it undecided (null)
  function detectDayFirst(rows, col) { let dmy = 0, mdy = 0, slashed = 0; for (const r of rows) { const m = String(r[col] || "").trim().match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-]\d{2,4}/); if (!m) continue; slashed++; if (+m[1] > 12) dmy++; if (+m[2] > 12) mdy++; } return mdy > dmy ? false : dmy > mdy ? true : slashed ? true : null; }
  function detectDecimal(rows, cols) { let comma = 0, dot = 0; for (const r of rows) for (const c of cols) { const v = String(r[c] || ""); if (/,\d{1,2}$/.test(v) || /,\d{1,2}[^\d]*$/.test(v)) comma++; if (/\.\d{1,2}$/.test(v) || /\.\d{1,2}[^\d]*$/.test(v)) dot++; } return comma > dot ? "," : dot > comma ? "." : null; }
  function parseCSVStatement(text, warnings, opt) {
    const t = stripBom(text); const delim = detectDelimiter(t); const rows = splitCsv(t, delim); if (!rows.length) { warnings.push("CSV: empty"); return { format: "csv", account: { iban: "", number: "", currency: "", bank: "" }, statement: {}, lines: [], warnings }; }
    const out = rowsToStatement(rows, warnings, "csv", delim, opt); out.rows = rows; return out;
  }
  // 4.20 · the same statement from a grid of cells — an Excel sheet read by XLSXREAD.rows (dates already ISO, numbers plain)
  function fromXlsx(rows, filename, opt) { const warnings = []; const grid = (rows || []).map((r) => (r || []).map((c) => (c == null ? "" : String(c)))); if (!grid.length) { warnings.push("Excel: the sheet is empty"); return { format: "xlsx", account: { iban: "", number: "", currency: "", bank: "" }, statement: {}, lines: [], warnings, filename }; } const out = rowsToStatement(grid, warnings, "xlsx", "\t", opt); out.filename = filename || ""; out.rows = grid; return out; }
  function rowsToStatement(rows, warnings, format, delim, opt) {
    opt = opt || {};
    // skip preamble lines (account info) until the header row
    let hi = 0; while (hi < rows.length && !looksLikeHeader(rows[hi]) && hi < 15) hi++; if (hi >= rows.length || !looksLikeHeader(rows[hi])) hi = -1;
    if (opt.headerRow != null) hi = +opt.headerRow; /* 4.20 · the person corrected the header row in the preview */
    const header = hi >= 0 ? rows[hi] : null; const body = rows.slice(hi >= 0 ? hi + 1 : 0);
    let map = header ? mapHeader(header) : {}; if (opt.map) { for (const k of Object.keys(opt.map)) { const v = opt.map[k]; if (v === "" || v == null) delete map[k]; else map[k] = +v; } }
    if (map.date == null) { // guess by content
      const sample = body.slice(0, 20); const cols = Math.max(...sample.map((r) => r.length)); let dateCol = -1, best = 0; for (let c = 0; c < cols; c++) { const n = sample.filter((r) => parseDate(r[c])).length; if (n > best) { best = n; dateCol = c; } } if (dateCol >= 0) map.date = dateCol;
      if (map.amount == null && map.debit == null) { const numeric = []; for (let c = 0; c < cols; c++) { if (c === map.date) continue; const n = sample.filter((r) => r[c] != null && String(r[c]).trim() !== "" && !isNaN(parseAmount(r[c])) && !parseDate(r[c])).length; if (n >= Math.max(1, sample.length * 0.6)) numeric.push(c); } if (numeric.length === 1) map.amount = numeric[0]; else if (numeric.length >= 2) { map.amount = numeric[0]; map.balance = numeric[numeric.length - 1]; } }
      if (map.desc == null) { let txtCol = -1, bestL = 0; for (let c = 0; c < cols; c++) { if (c === map.date || c === map.amount || c === map.balance) continue; const l = sample.reduce((k, r) => k + String(r[c] || "").length, 0); if (l > bestL) { bestL = l; txtCol = c; } } if (txtCol >= 0) map.desc = txtCol; }
      if (header) warnings.push("CSV: header not recognised, columns guessed from content");
    }
    if (map.date == null) { warnings.push((format === "xlsx" ? "Excel" : "CSV") + ": no date column found"); return { format, account: { iban: "", number: "", currency: "", bank: "" }, statement: {}, lines: [], warnings, map, header }; }
    const dayFirst = detectDayFirst(body, map.date); const decimal = detectDecimal(body, [map.amount, map.debit, map.credit, map.balance].filter((x) => x != null));
    const lines = []; let currency = ""; let firstBal = null, lastBal = null; let skipped = 0;
    for (const r of body) {
      const date = parseDate(r[map.date], dayFirst); if (!date) { skipped++; continue; }
      let amount = NaN; if (map.amount != null) amount = parseAmount(r[map.amount], decimal);
      if (isNaN(amount) || (map.amount == null)) { const cr = map.credit != null ? parseAmount(r[map.credit], decimal) : NaN, dr = map.debit != null ? parseAmount(r[map.debit], decimal) : NaN; if (!isNaN(cr) || !isNaN(dr)) amount = (isNaN(cr) ? 0 : Math.abs(cr)) - (isNaN(dr) ? 0 : Math.abs(dr)); }
      if (map.dc != null && !isNaN(amount)) { const ind = String(r[map.dc] || "").trim().toUpperCase(); if (/^(D|DR|DB|DEBIT|DEBET|SOLL|DÉBIT|UDGIFT|DEBITO|S)$/.test(ind)) amount = -Math.abs(amount); else if (/^(C|CR|CREDIT|KREDIT|HABEN|CRÉDIT|INDTÆGT|CREDITO|H)$/.test(ind)) amount = Math.abs(amount); }
      if (isNaN(amount)) { skipped++; continue; } if (Object.is(amount, -0)) amount = 0;
      const ccy = map.currency != null ? clean(r[map.currency]).toUpperCase() : ""; currency = currency || ccy;
      let description = clean(r[map.desc] != null ? r[map.desc] : ""); if (map.desc2 != null) { const d2 = clean(r[map.desc2]); if (d2 && !description.includes(d2)) description = description ? d2 + " · " + description : d2; } const counterparty = map.counterparty != null ? clean(r[map.counterparty]) : ""; const ref = map.ref != null ? clean(r[map.ref]) : "";
      const ib = map.iban != null ? ibanIn(r[map.iban]) : ibanIn(description + " " + counterparty);
      if (map.balance != null) { const b = parseAmount(r[map.balance], decimal); if (!isNaN(b)) { if (firstBal == null) firstBal = { date, b, amount }; lastBal = { date, b }; } }
      lines.push({ date, valueDate: map.valueDate != null ? parseDate(r[map.valueDate], dayFirst) || date : date, amount: r2(amount), currency: ccy || "", reference: ref, description, counterparty, iban: ib, kind: kindOf(description + " " + counterparty), raw: r.join(delim) });
    }
    if (skipped) warnings.push("CSV: " + skipped + " row" + (skipped > 1 ? "s" : "") + " without a date or amount skipped");
    // running balance → opening/closing; the balance column may run either way, take the row order as given
    let openingBalance = null, closingBalance = null; if (firstBal && lastBal) { const asc = lines.length > 1 && lines[0].date <= lines[lines.length - 1].date; const f = asc ? firstBal : lastBal, l = asc ? lastBal : firstBal; openingBalance = r2(f.b - (asc ? firstBal.amount : lines[lines.length - 1].amount)); closingBalance = l.b; }
    const sorted = lines.slice().sort((a, b) => a.date.localeCompare(b.date)); const acctLine = rows.slice(0, hi >= 0 ? hi : 0).map((r) => r.join(" ")).join(" ");
    return { format, account: { iban: ibanIn(acctLine), number: "", currency, bank: "" }, statement: { id: "", from: sorted.length ? sorted[0].date : null, to: sorted.length ? sorted[sorted.length - 1].date : null, openingBalance, closingBalance }, lines, warnings, map, header, delimiter: delim, decimal, dayFirst };
  }

  // ---------- public
  function detect(text) {
    const t = stripBom(String(text || "")).slice(0, 4000);
    if (/^\s*</.test(t) && /camt\.053|BkToCstmrStmt|camt\.052|BkToCstmrAcctRpt|<Stmt>|<Ntry>/i.test(t)) return "camt053";
    if (/^(\{1:|\{2:|:20:)/m.test(t) && /:61:|:60F:|:60M:|:25:/.test(t)) return "mt940";
    if (/:20:[^\n]*\n[\s\S]*:61:/.test(t)) return "mt940";
    if (/[,;\t|]/.test(t) && t.split("\n").filter(Boolean).length >= 2) return "csv";
    return null;
  }
  function parse(text, filename, opt) {
    const warnings = []; let format = detect(text); const ext = String(filename || "").toLowerCase().match(/\.([a-z0-9]+)$/); const e = ext ? ext[1] : "";
    if (!format) { if (/^(sta|mt940|940|swi)$/.test(e)) format = "mt940"; else if (/^(xml|camt|053)$/.test(e)) format = "camt053"; else if (/^(csv|txt|tsv)$/.test(e)) format = "csv"; }
    if (!format) throw new Error("Not a bank statement I can read (MT940, CAMT.053 or CSV)");
    const out = format === "mt940" ? parseMT940(text, warnings) : format === "camt053" ? parseCAMT(text, warnings) : parseCSVStatement(text, warnings, opt);
    out.filename = filename || ""; return out;
  }
  // the shape E.importStatement consumes: rows without a header, a column map, and the closing balance as the statement balance
  function toImportRows(parsed) {
    const rows = (parsed.lines || []).map((l) => [l.date, [l.description, l.counterparty && !String(l.description).includes(l.counterparty) ? l.counterparty : ""].filter(Boolean).join(" · "), l.amount, l.reference || ""]);
    return { rows, hasHeader: false, map: { date: 0, desc: 1, amount: 2, ref: 3, debit: null, credit: null }, statementBalance: parsed.statement && parsed.statement.closingBalance != null ? parsed.statement.closingBalance : null, asOf: parsed.statement && parsed.statement.to ? parsed.statement.to : null, currency: parsed.account ? parsed.account.currency || "" : "", iban: parsed.account ? parsed.account.iban || "" : "", format: parsed.format, warnings: parsed.warnings || [] };
  }
  const FORMATS = { mt940: "MT940 (SWIFT)", camt053: "CAMT.053 (ISO 20022)", csv: "CSV / text", xlsx: "Excel (.xlsx)" };
  return { detect, parse, toImportRows, fromXlsx, rowsToStatement, parseMT940: (t) => parseMT940(t, []), parseCAMT: (t) => parseCAMT(t, []), parseCSV: (t) => parseCSVStatement(t, []), parseDate, parseAmount, kindOf, ibanIn, mt86, FORMATS, _xmlTree: xmlTree };
});
