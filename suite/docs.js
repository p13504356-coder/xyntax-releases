/* XYNTAX 1.2 — documents: sales confirmation, proforma, tax invoice, credit note, purchase order, vendor bill, statement of account */
const DOCS = {
  css: `
  @page { size: A4; margin: 14mm 14mm 16mm; }
  * { box-sizing: border-box; }
  body { font: 10.5px/1.45 Helvetica, Arial, sans-serif; color: #111; margin: 0; padding: 26px 30px; font-variant-numeric: tabular-nums; }
  .page { display: flex; flex-direction: column; min-height: calc(297mm - 30mm - 52px); }
  .bottom { margin-top: auto; padding-top: 18px; }
  .hdr { display: grid; grid-template-columns: 1fr 300px; gap: 24px; align-items: start; padding-bottom: 14px; border-bottom: 1.5px solid #111; }
  .ent { font-size: 14px; font-weight: bold; letter-spacing: .01em; margin-bottom: 3px; }
  img.logo { max-height: 120px; max-width: 380px; display: block; margin-bottom: 10px; }
  .muted { color: #666; }
  .title { font-size: 22px; font-weight: 300; letter-spacing: .02em; text-align: right; margin: 0 0 8px; }
  .meta { width: 100%; border-collapse: collapse; }
  .meta td { padding: 2px 0; border: 0; font-size: 10.5px; }
  .meta td:first-child { color: #666; padding-right: 12px; white-space: nowrap; }
  .meta td:last-child { text-align: right; font-weight: bold; }
  .parties { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-top: 16px; }
  .box { border: 1px solid #d5d5d5; padding: 9px 11px; min-height: 92px; }
  .box .lbl { font-size: 9px; color: #666; text-transform: uppercase; letter-spacing: .06em; margin-bottom: 4px; }
  .box .name { font-weight: bold; margin-bottom: 2px; }
  .kv { display: grid; grid-template-columns: max-content 1fr; gap: 1px 12px; }
  .kv span:nth-child(odd) { color: #666; white-space: nowrap; }
  table.lines { width: 100%; border-collapse: collapse; margin-top: 16px; }
  table.lines th { text-align: left; font-size: 9px; color: #444; text-transform: uppercase; letter-spacing: .06em; padding: 6px 8px; border-top: 1px solid #111; border-bottom: 1px solid #111; }
  table.lines td { padding: 7px 8px; border-bottom: 1px solid #e4e4e4; vertical-align: top; }
  table.lines .n { text-align: right; white-space: nowrap; }
  .sum { display: flex; justify-content: flex-end; margin-top: 8px; }
  table.tot { border-collapse: collapse; min-width: 280px; }
  table.tot td { padding: 3px 8px; border: 0; }
  table.tot td.l { color: #555; text-align: right; }
  table.tot td.n { text-align: right; white-space: nowrap; min-width: 120px; }
  table.tot tr.grand td { border-top: 1.5px solid #111; font-weight: bold; font-size: 12px; padding-top: 6px; }
  table.tot tr.after td { color: #333; }
  table.tot tr.due td { font-weight: bold; border-top: 1px solid #999; }
  table.tot.alt { margin-top: 6px; } table.tot.alt td { color: #444; font-size: 10px; } table.tot.alt tr.due td { font-weight: normal; border-top: 1px solid #ccc; }
  .terms { margin-top: 18px; display: grid; grid-template-columns: max-content 1fr; gap: 3px 14px; }
  .terms span:nth-child(odd) { color: #666; white-space: nowrap; }
  .sig { display: flex; justify-content: flex-end; margin-top: 8px; }
  .sig .blk { width: 340px; text-align: left; }
  .sig .lbl { font-size: 9px; color: #666; text-transform: uppercase; letter-spacing: .06em; }
  .sig .imgs { display: flex; gap: 16px; align-items: flex-end; height: 88px; margin: 4px 0 2px; }
  .sig img.stamp, .sig img.signature { max-height: 84px; max-width: 150px; width: auto; height: auto; }
  .sig img.stamp { opacity: .92; }
  .sig .line { border-top: 1px solid #111; padding-top: 3px; }
  .digital { margin: 14px 0 6px; padding: 8px 12px; border: 1px solid #ccc; border-radius: 3px; color: #444; font-size: 9.5px; }
  .sig2 { display: grid; grid-template-columns: 1fr 1fr; gap: 30px; margin-top: 30px; }
  .sig2 .blk .lbl { font-size: 9px; color: #666; text-transform: uppercase; letter-spacing: .06em; }
  .sig2 .imgs { display: flex; gap: 16px; align-items: flex-end; height: 88px; margin: 4px 0 2px; }
  .sig2 img.stamp, .sig2 img.signature { max-height: 84px; max-width: 150px; }
  .sig2 .line { border-top: 1px solid #111; padding-top: 3px; }
  table.bank { width: 100%; border-collapse: collapse; margin-top: 22px; }
  table.bank th { text-align: left; font-size: 9px; color: #666; text-transform: uppercase; letter-spacing: .06em; padding: 4px 8px 3px 0; border-bottom: 1px solid #bbb; }
  table.bank td { padding: 4px 8px 4px 0; border-bottom: 1px solid #eee; white-space: nowrap; }
  .foot { margin-top: 14px; color: #555; font-size: 9px; line-height: 1.5; }
  pre { font: inherit; margin: 0; white-space: pre-wrap; }
  .note { margin-top: 12px; }
  h3 { font-size: 11px; margin: 20px 0 4px; }
  `,
  money: (n) => (n == null ? "" : (+n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })),
  qty: (n) => (+n).toLocaleString("en-US", { maximumFractionDigits: 4 }),
  esc: (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])),
  page(title, body) { return "<!doctype html><html><head><meta charset='utf-8'><title>" + this.esc(title) + "</title><style>" + this.css + "</style></head><body><div class='page'>" + body + "</div></body></html>"; },
  tail(e, extra, noBank, docType) { return "<div class='bottom'>" + this.signature(e, docType) + (noBank ? "" : this.bank(e)) + this.footer(e, extra) + "</div>"; },
  header(e, docTitle, meta) {
    const x = this.esc;
    return "<div class='hdr'><div>" + (e.logo ? "<img class='logo' src='" + e.logo + "'>" : "") + "<div class='ent'>" + x(e.name) + "</div><pre class='muted'>" + x(e.address) + "</pre>" + (e.trn ? "<div class='muted'>TRN " + x(e.trn) + "</div>" : "") + (e.phone || e.email ? "<div class='muted'>" + x([e.phone, e.email].filter(Boolean).join("  ·  ")) + "</div>" : "") + "</div>"
      + "<div><div class='title'>" + x(docTitle) + "</div><table class='meta'>" + meta.filter(Boolean).map(([k, v]) => "<tr><td>" + x(k) + "</td><td>" + x(v) + "</td></tr>").join("") + "</table></div></div>";
  },
  party(label, cp) { const x = this.esc; if (!cp) return "<div class='box'><div class='lbl'>" + x(label) + "</div><span class='muted'>—</span></div>"; return "<div class='box'><div class='lbl'>" + x(label) + "</div><div class='name'>" + x(cp.name) + "</div>" + (cp.address ? "<pre class='muted'>" + x(cp.address) + "</pre>" : "") + (cp.trn ? "<div>TRN " + x(cp.trn) + "</div>" : "") + (cp.registration ? "<div class='muted'>Reg. " + x(cp.registration) + "</div>" : "") + (cp.contact || cp.email ? "<div class='muted'>" + x([cp.contact, cp.email].filter(Boolean).join("  ·  ")) + "</div>" : "") + "</div>"; },
  entityBox(label, e) { const x = this.esc; return "<div class='box'><div class='lbl'>" + x(label) + "</div><div class='name'>" + x(e.name) + "</div><pre class='muted'>" + x(e.address) + "</pre>" + (e.trn ? "<div>TRN " + x(e.trn) + "</div>" : "") + "</div>"; },
  kvBox(label, rows) { const x = this.esc; rows = rows.filter((r) => r && r[1] != null && r[1] !== ""); return "<div class='box'><div class='lbl'>" + x(label) + "</div><div class='kv'>" + rows.map(([k, v]) => "<span>" + x(k) + "</span><span>" + x(v) + "</span>").join("") + "</div></div>"; },
  // the company's words and model (workflow.js); the Trading words without it
  wf: { trading: () => typeof WORKFLOW === "undefined" || WORKFLOW.model() === "trading", label: (k, o) => (typeof WORKFLOW === "undefined" ? ({ trade: "Trade", customer: "Customer", sell: "New trade" }[k] || k) : WORKFLOW.label(k, o)) },
  deliveryRows(v, t) { const r = []; if (v) r.push(["Vessel", v.name], ["IMO", v.imo || "—"], ["Flag", cn(v.flag) || "—"], ["Type", v.type || "—"]); if (t) { if (t.port || t.country) r.push([t.port ? "Port" : "Country", (t.port || "") + (t.country ? (t.port ? ", " : "") + cn(t.country) : "")]); r.push([t.status === "delivered" ? "Delivered" : "Delivery date", t.deliveredDate || t.deliveryDate]); if (t.eta) r.push(["ETA", t.eta]); if (t.agent) r.push(["Agent", t.agent]); if (t.bdnNo) r.push(["BDN no.", t.bdnNo]); } return r; },
  custom(obj) { const en = Object.entries(obj || {}).filter(([k, v]) => v !== "" && v != null); if (!en.length) return ""; return "<div class='terms'>" + en.map(([k, v]) => "<span>" + this.esc(k) + "</span><span>" + this.esc(v) + "</span>").join("") + "</div>"; },
  lines(rows, ccy) {
    const x = this.esc;
    return "<table class='lines'><thead><tr><th style='width:44%'>Description</th><th class='n'>Quantity</th><th class='n'>Unit price " + x(ccy) + "</th><th class='n'>Net</th><th class='n'>VAT</th><th class='n'>VAT amount</th><th class='n'>Total</th></tr></thead><tbody>"
      + rows.map((r) => "<tr><td>" + x(r.desc) + (r.sub ? "<div class='muted'>" + x(r.sub) + "</div>" : "") + "</td><td class='n'>" + (r.qty != null ? this.qty(r.qty) + " " + (r.unit || "MT") : "—") + "</td><td class='n'>" + (r.price != null ? this.money(r.price) : "—") + "</td><td class='n'>" + this.money(r.net) + "</td><td class='n'>" + x(r.vatLabel) + "</td><td class='n'>" + this.money(r.vat) + "</td><td class='n'>" + this.money(r.gross) + "</td></tr>").join("") + "</tbody></table>";
  },
  totals(net, vat, gross, ccy, after) {
    const x = this.esc; const row = (k, v, cl) => "<tr class='" + (cl || "") + "'><td class='l'>" + x(k) + "</td><td class='n'>" + x(ccy) + " " + this.money(v) + "</td></tr>";
    return "<div class='sum'><table class='tot'>" + row("Net", net) + row("VAT", vat) + row("Total", gross, "grand") + (after || []).map(([k, v], i, arr) => row(k, v, i === arr.length - 1 ? "due" : "after")).join("") + "</table></div>";
  },
  alt(ccy, altCcy, rate, vat, gross, label) {
    if (!altCcy || !rate || altCcy === ccy) return "";
    return "<div class='sum'><table class='tot alt'><tr><td class='l' colspan='2'>" + this.esc(label || "Equivalent in " + altCcy) + " at 1 " + this.esc(ccy) + " = " + rate + " " + this.esc(altCcy) + "</td></tr><tr><td class='l'>VAT in " + this.esc(altCcy) + "</td><td class='n'>" + this.esc(altCcy) + " " + this.money(vat * rate) + "</td></tr><tr class='due'><td class='l'>Total in " + this.esc(altCcy) + "</td><td class='n'>" + this.esc(altCcy) + " " + this.money(gross * rate) + "</td></tr></table></div>";
  },
  signature(e, docType) {
    const x = this.esc; const type = docType || "document";
    if (!e.signature && !e.stamp) return "<div class='digital'>This " + x(type) + " is a digital version issued by " + x(e.name) + " and is valid without a stamp or signature.</div>";
    return "<div class='sig'><div class='blk'><div class='lbl'>" + x("For and on behalf of " + e.name) + "</div><div class='imgs'>" + (e.stamp ? "<img class='stamp' src='" + e.stamp + "'>" : "") + (e.signature ? "<img class='signature' src='" + e.signature + "'>" : "") + "</div></div></div>";
  },
  bank(e) {
    const x = this.esc; const accts = S.store.banks.filter((b) => b.entityId === e.id && b.onDocs && b.type !== "cash");
    if (!accts.length) return e.bankDetails ? "<div class='foot'><b>Payment to:</b> " + x(e.bankDetails) + "</div>" : "";
    return "<table class='bank'><thead><tr><th>Bank</th><th>Account name</th><th>Currency</th><th>IBAN / account</th><th>SWIFT</th></tr></thead><tbody>" + accts.map((b) => "<tr><td>" + x(b.bank) + "</td><td>" + x(b.accountName || e.name) + "</td><td>" + x(b.currency) + "</td><td>" + x(b.iban || "—") + "</td><td>" + x(b.swift || "—") + "</td></tr>").join("") + "</tbody></table>";
  },
  footer(e, extra) { return "<div class='foot'>" + (extra ? this.esc(extra) + "<br>" : "") + this.esc(e.docFooter || "") + "</div>"; },
  tradeLines(t, vr, inv) {
    const v = L.vessel(t.vesselId); const src = inv && inv.lines && inv.lines.length ? inv.lines : t.lines;
    const label = E.vatLabel(inv ? inv.vatRate : t.vatRate, inv ? inv.vatKind : t.vatKind);
    const rows = src.map((l) => { if (l.kind === "product") { const p = L.product(l.productId) || {}; return { desc: (p.name || "") + " (" + (p.code || "") + ")" + (p.grade ? ", " + p.grade : ""), qty: E.lineQty(l), unit: l.unit || "MT", price: l.price, net: E.lineNet(l), vatLabel: label }; } return { desc: l.description, qty: l.qty, unit: l.unit || "each", price: l.price, net: E.lineNet(l), vatLabel: label }; });
    for (const r of rows) { r.vat = E.r2(r.net * vr / 100); r.gross = E.r2(r.net + r.vat); }
    return rows;
  },


  // x.y · an invoice (or a despatch bill) recorded from outside XYNTAX prints as what it is: a record of the document, under its own
  // number, with what was received or paid — no tax-invoice title, no bank details to pay into, no signature, marked on every line that
  // the original is the document of record
  record(doc, kind) {
    const x = this.esc; const isInv = kind === "invoice"; const e = L.entity(doc.entityId) || {}, cp = L.cp(doc.counterpartyId); const m = doc.meta || {}; const v = doc.vesselId ? L.vessel(doc.vesselId) : null;
    const what = { hire: "Hire", freight: "Freight", demurrage: "Demurrage", despatch: "Despatch", other: "Other" }[m.kind] || (isInv ? "Invoice" : "Bill");
    const per = m.period && typeof PSE !== "undefined" ? PSE.fmtAt(m.period.from) + " – " + PSE.fmtEnd(m.period.to) + " UTC" : null;
    const pays = (S.store.payments || []).filter((p) => (isInv ? p.invoiceId === doc.id : p.billId === doc.id) && !p.reversed);
    const rows = (doc.lines || []).length ? doc.lines.map((l) => ({ desc: l.description || l.label || what, net: l.amount != null && l.qty == null ? +l.amount : E.r2((+l.qty || 0) * (+l.price || 0)) || +l.amount || 0, vatLabel: "" })) : [{ desc: what, net: doc.net, vatLabel: "" }];
    for (const r of rows) { r.vat = 0; r.gross = r.net; }
    const after = [...pays.map((p) => [(isInv ? "Received " : "Paid ") + p.date + (p.reference ? " · " + p.reference : ""), -p.amount]), ...(pays.length ? [["Open", E.docOpen(doc)]] : [])];
    const body = "<div style='border:1.5px solid #222;padding:6px 10px;margin-bottom:12px;font-weight:600;letter-spacing:.04em'>RECORD — NOT AN INVOICE ISSUED BY XYNTAX</div>"
      + this.header(e, (isInv ? "Record of an invoice issued outside XYNTAX" : "Record of an invoice received") + " · " + what, [[isInv ? "Their invoice no." : "Invoice no.", doc.ref], ["Invoice date", doc.date], ["Due date", doc.due], per ? ["Period", per] : null, v ? ["Vessel", v.name + (v.imo ? " · IMO " + v.imo : "")] : null, ["Status", E.docStatus(doc)], ["Currency", doc.currency]])
      + "<div class='parties'>" + this.party(isInv ? "Invoiced to" : "Issued by", cp) + this.entityBox("Books of", e) + "</div>" + this.lines(rows, doc.currency) + this.totals(doc.net, 0, doc.amount, doc.currency, after)
      + (doc.memo || doc.note ? "<div class='terms'><span>Note</span><span>" + x(doc.note || doc.memo) + "</span></div>" : "")
      + "<div class='bottom'>" + this.footer(e, "Recorded in the books from the original document, which remains the document of record. This page is not a tax invoice, not a request for payment and carries no bank details.") + "</div>";
    return this.page("Record " + doc.ref + (cp ? " " + cp.name : ""), body);
  },
  invoice(inv) {
    if (inv && (inv.recorded || inv.origin === "external")) return this.record(inv, "invoice");
    const e = L.entity(inv.entityId), cp = L.cp(inv.counterpartyId), t = L.trade(inv.tradeId), v = t && L.vessel(t.vesselId);
    const vr = E.vatOf(inv.vatRate, inv.vatKind); const rows = t ? this.tradeLines(t, vr, inv) : [{ desc: "Supply", net: inv.net, vatLabel: E.vatLabel(inv.vatRate, inv.vatKind), vat: inv.vat, gross: inv.amount }];
    const cns = S.store.documents.filter((x) => x.type === "creditnote" && x.invoiceId === inv.id);
    const after = [...(inv.paid ? [["Received", -inv.paid]] : []), ...cns.map((c) => ["Credit note " + c.ref, -c.amount])]; if (after.length) after.push(["Balance due", E.docOpen(inv)]);
    const meta = inv.meta || (t && t.meta) || null; const per = meta && meta.period && typeof PSE !== "undefined" ? [PSE.fmtAt(meta.period.from) + " – " + PSE.fmtEnd(meta.period.to) + " UTC"] : null;
    const body = this.header(e, meta && meta.kind === "hire" ? "Tax invoice · hire statement" : meta && meta.kind === "freight" ? "Tax invoice · freight" : "Tax invoice", [["Invoice no.", inv.ref], ["Invoice date", inv.date], ["Due date", inv.due], ["Payment terms", (t ? t.terms : "") + " days"], t ? ["Our reference", t.ref] : null, t && t.buyerRef ? ["Your reference", t.buyerRef] : null, per ? ["Hire period", per[0]] : null, v && (v.imo || v.name) && meta ? ["Vessel", v.name + (v.imo ? " · IMO " + v.imo : "")] : null, ["Currency", inv.currency]])
      + "<div class='parties'>" + this.party("Bill to", cp) + this.kvBox("Delivery", this.deliveryRows(v, t)) + "</div>" + this.lines(rows, inv.currency) + this.totals(inv.net, inv.vat, inv.amount, inv.currency, after) + this.alt(inv.currency, inv.altCurrency, inv.altRate, inv.vat, inv.amount) + this.custom(t && t.doc)
      + "<div class='terms'><span>Payment</span><span>" + (t ? t.terms : "") + " days from invoice date, due " + inv.due + ". Payable in " + this.esc(inv.currency) + " by bank transfer to the account below; all bank charges for the account of the payer.</span></div>"
      + this.tail(e, "", false, "tax invoice");
    return this.page(inv.ref + " " + cp.name, body);
  },
  proforma(t) {
    const e = L.entity(t.entityId), cp = L.cp(t.customerId), v = L.vessel(t.vesselId); const vr = E.vatOf(t.vatRate, t.vatKind); const rows = this.tradeLines(t, vr, null);
    const net = E.r2(E.sum(rows, (r) => r.net)), vat = E.r2(E.sum(rows, (r) => r.vat)), gross = E.r2(net + vat); const due = E.addDays(t.deliveryDate, t.terms);
    const body = this.header(e, "Proforma invoice", [["Proforma no.", "PF-" + t.ref.replace("TRD-", "")], ["Date", E.today()], ["Expected delivery", t.deliveryDate], ["Payment terms", t.terms + " days from delivery"], ["Indicative due date", due], t.buyerRef ? ["Your reference", t.buyerRef] : null, ["Currency", t.currency]])
      + "<div class='parties'>" + this.party("Bill to", cp) + this.kvBox("Delivery", this.deliveryRows(v, t)) + "</div>" + this.lines(rows, t.currency) + this.totals(net, vat, gross, t.currency) + this.alt(t.currency, t.altCurrency || e.altCurrency, t.altRate || e.altRate, vat, gross) + this.custom(t.doc)
      + "<div class='terms'><span>Basis</span><span>" + (this.wf.trading() ? "Quantity and value are indicative; the tax invoice will be issued on the delivered quantity per BDN." : "Quantities and value are indicative; the tax invoice is issued on completion.") + "</span></div>" + this.tail(e, "This proforma is not a tax invoice and does not create a VAT liability.", false, "proforma invoice");
    return this.page("Proforma " + t.ref, body);
  },
  so(t) {
    const e = L.entity(t.entityId), cp = L.cp(t.customerId), v = L.vessel(t.vesselId); const vr = E.vatOf(t.vatRate, t.vatKind); const rows = this.tradeLines(t, vr, null);
    const net = E.r2(E.sum(rows, (r) => r.net)), vat = E.r2(E.sum(rows, (r) => r.vat)), gross = E.r2(net + vat);
    const body = this.header(e, this.wf.trading() ? "Sales order confirmation" : this.wf.label("trade") + " confirmation", [["Confirmation no.", t.ref], ["Date", t.date], [this.wf.trading() ? "Delivery date" : "Date of delivery / completion", t.deliveryDate], ["Payment terms", t.terms + " days from delivery"], t.buyerRef ? ["Buyer reference", t.buyerRef] : null, ["Currency", t.currency]])
      + "<div class='parties'>" + this.party("Buyer", cp) + this.kvBox("Delivery", this.deliveryRows(v, t)) + "</div>" + this.lines(rows, t.currency) + this.totals(net, vat, gross, t.currency) + this.alt(t.currency, t.altCurrency || e.altCurrency, t.altRate || e.altRate, vat, gross) + this.custom(t.doc) + (t.note ? "<div class='note'>" + this.esc(t.note) + "</div>" : "")
      + "<div class='terms'>" + (this.wf.trading() ? "<span>Quantity</span><span>As per Bunker Delivery Note. Prices in " + this.esc(t.currency) + " per metric ton.</span>" : "<span>Prices</span><span>In " + this.esc(t.currency) + ", per unit as stated on each line.</span>") + "<span>Terms</span><span>Subject to the seller's General Terms and Conditions of Sale, latest edition.</span></div>" + this.tail(e, "", false, "sales order confirmation");
    return this.page("Confirmation " + t.ref, body);
  },
  creditnote(cn) {
    const e = L.entity(cn.entityId), cp = L.cp(cn.counterpartyId), inv = L.invoice(cn.invoiceId), t = L.trade(cn.tradeId);
    const rows = [{ desc: "Credit against " + (inv ? inv.ref + " of " + inv.date : ""), sub: cn.reason, net: cn.net, vatLabel: E.vatLabel(cn.vatRate, "standard"), vat: cn.vat, gross: cn.amount }];
    const body = this.header(e, "Credit note", [["Credit note no.", cn.ref], ["Date", cn.date], ["Against invoice", inv ? inv.ref : ""], t ? ["Our reference", t.ref] : null, ["Currency", cn.currency]])
      + "<div class='parties'>" + this.party("Credit to", cp) + this.kvBox("Delivery", this.deliveryRows(t && L.vessel(t.vesselId), t)) + "</div>" + this.lines(rows, cn.currency) + this.totals(cn.net, cn.vat, cn.amount, cn.currency, inv ? [["Invoice balance after credit", E.docOpen(inv)]] : []) + this.alt(cn.currency, cn.altCurrency, cn.altRate, cn.vat, cn.amount) + this.custom(cn.custom) + this.tail(e, "", true, "credit note");
    return this.page(cn.ref + " " + cp.name, body);
  },
  po(c) {
    const e = L.entity(c.entityId), cp = L.cp(c.supplierId), p = L.product(c.productId); const vr = E.vatOf(c.vatRate, c.vatKind); const label = E.vatLabel(c.vatRate, c.vatKind);
    const rows = [{ desc: p.name + " (" + p.code + ")" + (p.grade ? ", " + p.grade : ""), qty: c.qty, unit: c.unit || "MT", price: c.price, net: E.r2(c.qty * c.price), vatLabel: label }, ...c.costs.map((x) => ({ desc: x.label, net: x.amount, vatLabel: label }))];
    for (const r of rows) { r.vat = E.r2(r.net * vr / 100); r.gross = E.r2(r.net + r.vat); }
    const net = E.r2(E.sum(rows, (r) => r.net)), vat = E.r2(E.sum(rows, (r) => r.vat));
    const body = this.header(e, "Purchase order", [["PO no.", (c.doc && c.doc.poRef) || c.ref], ["Date", c.date], ["Payment terms", c.terms + " days"], ["Our reference", c.ref], c.createdFromTradeId ? ["Against sale", (L.trade(c.createdFromTradeId) || {}).ref] : null, ["Currency", c.currency]])
      + "<div class='parties'>" + this.party("Supplier", cp) + this.kvBox("Delivery", [["Port / terminal", c.port + (c.country ? ", " + cn(c.country) : "")], ["Basis", c.deliveryMode], ["Date", c.date], ["Loss allowance", c.allowancePct + "%"]]) + "</div>" + this.lines(rows, c.currency) + this.totals(net, vat, E.r2(net + vat), c.currency) + this.custom(c.doc && Object.fromEntries(Object.entries(c.doc).filter(([k]) => k !== "poRef"))) + (c.note ? "<div class='note'>" + this.esc(c.note) + "</div>" : "")
      + this.tail(e, "", true, "purchase order");
    return this.page("PO " + c.ref, body);
  },
  bill(b) {
    if (b && (b.recorded || b.origin === "external")) return this.record(b, "bill");
    const e = L.entity(b.entityId), cp = L.cp(b.counterpartyId), c = L.cargo(b.cargoId), p = c && L.product(c.productId); const vr = E.vatOf(b.vatRate, b.vatKind); const label = E.vatLabel(b.vatRate, b.vatKind);
    const rows = c ? [{ desc: p.name + " (" + p.code + ")", qty: c.qty, unit: c.unit || "MT", price: c.price, net: E.r2(c.qty * c.price), vatLabel: label }, ...c.costs.map((x) => ({ desc: x.label, net: x.amount, vatLabel: label }))] : (b.lines && b.lines.length ? b.lines.map((x) => ({ desc: x.label, net: x.amount, vatLabel: label })) : [{ desc: b.memo || "Supplier bill", net: b.net, vatLabel: label }]);
    for (const r of rows) { r.vat = E.r2(r.net * vr / 100); r.gross = E.r2(r.net + r.vat); }
    const after = b.paid ? [["Paid", -b.paid], ["Balance", E.docOpen(b)]] : [];
    const body = this.header(e, b.internal ? "Internal cost record" : "Vendor bill", [["Bill no.", b.ref], ["Bill date", b.date], ["Due date", b.due], c ? ["Cargo", c.ref] : null, b.tradeId ? ["Trade", (L.trade(b.tradeId) || {}).ref] : null, c && c.doc && c.doc.poRef ? ["PO reference", c.doc.poRef] : null, ["Status", E.docStatus(b)], ["Currency", b.currency]])
      + "<div class='parties'>" + this.party("Supplier", cp) + this.entityBox("Billed to", e) + "</div>" + this.lines(rows, b.currency) + this.totals(b.net, b.vat, b.amount, b.currency, after) + this.custom(c && c.doc) + "<div class='bottom'>" + this.footer(e, "Internal record of a supplier bill, generated from the booked cargo. The supplier's original invoice is the tax document.") + "</div>";
    return this.page(b.ref + " " + (cp ? cp.name : b.memo || ""), body);
  },
  // 4.12 PROSHIP · a report model from PSE.report() as a printable page: entity branding, the meta block, sections of tables / key-values / text
  vesselReport(model, opt) {
    opt = opt || {}; const x = this.esc; const e = (opt.entityId && L.entity(opt.entityId)) || (S.entity && L.entity(S.entity)) || S.store.entities[0] || { name: "" };
    const cell = (v, i, cols) => "<td class='" + (i > 0 && /^[-+]?[\d,]+(\.\d+)?( [A-Z]{3})?$|^[A-Z]{3} [-\d,.]+$|^-?[A-Z]{3} /.test(String(v || "").trim()) ? "num" : "") + "'>" + x(v == null ? "" : v) + "</td>";
    let body = this.header(e, model.title, (model.meta || []).filter(Boolean).map(([k, v]) => [k, v]));
    if (model.subtitle) body += "<div class='terms'><span>Subject</span><span>" + x(model.subtitle) + "</span></div>";
    for (const sec of model.sections || []) {
      if (!sec) continue; body += "<h3 class='rsec'>" + x(sec.heading || "") + "</h3>";
      if (sec.table && sec.table.rows) { body += "<table class='lines'><thead><tr>" + sec.table.cols.map((c, i) => "<th class='" + (i > 0 ? "num" : "") + "'>" + x(c) + "</th>").join("") + "</tr></thead><tbody>" + (sec.table.rows.length ? sec.table.rows.map((r) => "<tr>" + r.map((v, i) => cell(v, i, sec.table.cols)).join("") + "</tr>").join("") : "<tr><td colspan='" + sec.table.cols.length + "' class='muted'>Nothing in the period.</td></tr>") + "</tbody>" + (sec.table.totals && sec.table.totals.length ? "<tfoot>" + (Array.isArray(sec.table.totals[0]) ? sec.table.totals.map((t) => "<tr><td colspan='" + (sec.table.cols.length - 1) + "' class='num'><b>" + x(t[0]) + "</b></td><td class='num'><b>" + x(t[1]) + "</b></td></tr>").join("") : "<tr>" + sec.table.totals.map((v, i) => "<td class='" + (i > 0 ? "num" : "") + "'><b>" + x(v == null ? "" : v) + "</b></td>").join("") + "</tr>") + "</tfoot>" : "") + "</table>"; }
      if (sec.kv) body += "<div class='parties'>" + this.kvBox(sec.heading || "", sec.kv) + "</div>";
      if (sec.text) body += "<div class='note'>" + x(sec.text) + "</div>";
    }
    body += "<style>.rsec{font-size:11px;letter-spacing:.14em;text-transform:uppercase;margin:16px 0 6px;color:#333}.note{font-size:10.5px;line-height:1.5;margin:4px 0 8px}</style>";
    body += this.tail(e, opt.footer || "", true, (model.title || "report").toLowerCase());
    return this.page(model.title + (model.subtitle ? " — " + model.subtitle : ""), body);
  },
  soa(cpId, entityId, from, to) {
    const soa = E.statementOfAccount(S.store, cpId, entityId, from, to); const e = L.entity(entityId) || S.store.entities[0]; const cp = soa.cp; const x = this.esc; const m = (n) => (n ? this.money(n) : "");
    const body = this.header(e, "Statement of account", [["Statement date", E.today()], ["Period", (from || "opening") + " to " + soa.to], ["Closing balance", this.money(soa.closing)], ["Overdue", this.money(E.sum(soa.overdue, (o) => o.open))]])
      + "<div class='parties'>" + this.party("Account", cp) + this.kvBox("Summary", [["Opening balance", this.money(soa.opening)], ["Invoiced", this.money(E.sum(soa.rows, (r) => r.debit))], ["Credited and received", this.money(E.sum(soa.rows, (r) => r.credit))], ["Closing balance", this.money(soa.closing)], ["Overdue invoices", soa.overdue.length]]) + "</div>"
      + "<table class='lines'><thead><tr><th>Date</th><th>Reference</th><th>Type</th><th>Detail</th><th>Due</th><th class='n'>Debit</th><th class='n'>Credit</th><th class='n'>Balance</th></tr></thead><tbody>" + (soa.opening ? "<tr><td>" + x(from || "") + "</td><td></td><td>Opening balance</td><td></td><td></td><td class='n'></td><td class='n'></td><td class='n'>" + this.money(soa.opening) + "</td></tr>" : "") + soa.rows.map((r) => "<tr><td>" + r.date + "</td><td>" + x(r.ref) + "</td><td>" + x(r.type) + "</td><td>" + x(r.detail) + "</td><td>" + x(r.due) + "</td><td class='n'>" + m(r.debit) + "</td><td class='n'>" + m(r.credit) + "</td><td class='n'>" + this.money(r.balance) + "</td></tr>").join("") + "</tbody></table>"
      + "<div class='sum'><table class='tot'><tr class='grand'><td class='l'>Closing balance</td><td class='n'>" + this.money(soa.closing) + "</td></tr></table></div>"
      + (soa.overdue.length ? "<h3>Overdue</h3><table class='lines' style='margin-top:4px'><thead><tr><th>Invoice</th><th>Due</th><th class='n'>Days overdue</th><th class='n'>Open</th></tr></thead><tbody>" + soa.overdue.map((o) => "<tr><td>" + o.ref + "</td><td>" + o.due + "</td><td class='n'>" + o.days + "</td><td class='n'>" + this.money(o.open) + "</td></tr>").join("") + "</tbody></table>" : "")
      + "<div class='terms'><span>Remittance</span><span>Please settle the closing balance to the account below and quote invoice numbers on payment.</span></div>" + this.tail(e, "", false, "statement of account");
    return this.page("Statement " + cp.name, body);
  },
};
// ---------- financial statements (landscape, audit-style)
const FIN = {
  css: `
  @page { size: A4 landscape; margin: 12mm 14mm 14mm; }
  body { font: 10px/1.4 Arial, Helvetica, sans-serif; color: #111; margin: 0; padding: 22px 28px; font-variant-numeric: tabular-nums; }
  .hd { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid #111; padding-bottom: 8px; margin-bottom: 14px; }
  .hd .co { font-size: 15px; font-weight: bold; } .hd .co small { display: block; font-weight: normal; color: #555; font-size: 10px; margin-top: 2px; }
  .hd .rt { text-align: right; } .hd .rt .t { font-size: 16px; font-weight: bold; letter-spacing: .02em; } .hd .rt .p { color: #555; margin-top: 2px; }
  h2 { font-size: 11px; margin: 16px 0 4px; letter-spacing: .04em; text-transform: uppercase; color: #333; border-bottom: 1px solid #999; padding-bottom: 2px; }
  table { border-collapse: collapse; width: 100%; page-break-inside: auto; }
  th { text-align: right; font-weight: bold; padding: 5px 8px; border-bottom: 1px solid #111; font-size: 9.5px; white-space: nowrap; }
  th:first-child { text-align: left; }
  td { padding: 3px 8px; text-align: right; white-space: nowrap; }
  td:first-child { text-align: left; white-space: normal; }
  tr.sub td { border-top: 1px solid #333; font-weight: bold; padding-top: 5px; }
  tr.tot td { border-top: 1px solid #111; border-bottom: 3px double #111; font-weight: bold; padding-top: 5px; padding-bottom: 5px; }
  tr.sec td { font-weight: bold; padding-top: 8px; color: #222; }
  tr.ind td:first-child { padding-left: 22px; color: #333; }
  tr.dim td { color: #666; }
  .neg { color: #111; }
  .note { color: #555; font-size: 9px; margin-top: 6px; }
  .ft { margin-top: 18px; border-top: 1px solid #999; padding-top: 6px; color: #555; font-size: 9px; display: flex; justify-content: space-between; }
  .kpis { display: grid; grid-template-columns: repeat(6, 1fr); gap: 8px; margin: 6px 0 10px; }
  .kpi { border: 1px solid #ccc; padding: 6px 9px; } .kpi .l { color: #555; font-size: 9px; } .kpi .v { font-size: 13px; font-weight: bold; margin-top: 2px; }
  .cols2 { display: grid; grid-template-columns: 1fr 1fr; gap: 26px; }
  .cols3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 26px; }
  .pb { page-break-before: always; }
  `,
  n(v, dec) { if (v == null || v === "") return ""; const a = Math.abs(v); const t = a.toLocaleString("en-US", { minimumFractionDigits: dec || 0, maximumFractionDigits: dec || 0 }); return v < 0 ? "(" + t + ")" : t; },
  esc: (x) => DOCS.esc(x),
  page(title, body) { return "<!doctype html><html><head><meta charset='utf-8'><title>" + this.esc(title) + "</title><style>" + this.css + "</style></head><body>" + body + "</body></html>"; },
  head(title, period, scope, ccy) { const x = this.esc; const co = S.entity ? L.entity(S.entity) : null; return "<div class='hd'><div class='co'>" + x(co ? co.name : (S.store.meta.groupName || "XYNTAX group")) + "<small>" + x(scope) + (co && co.trn ? " · TRN " + co.trn : "") + "</small></div><div class='rt'><div class='t'>" + x(title) + "</div><div class='p'>" + x(period) + " · amounts in " + x(ccy) + "</div></div></div>"; },
  foot(extra) { return "<div class='ft'><span>Prepared from the XYNTAX ledger on " + E.today() + " · unaudited management figures" + (extra ? " · " + this.esc(extra) : "") + "</span><span>" + this.esc(S.store.meta.name || "XYNTAX") + "</span></div>"; },
  statement(cols, lines) {
    // cols: [{label, sub}] ; lines: [{label, cls, vals:[...] }]
    const x = this.esc; return "<table><thead><tr><th style='width:34%'></th>" + cols.map((c) => "<th>" + x(c.label) + (c.sub ? "<br><span style='font-weight:normal;color:#666'>" + x(c.sub) + "</span>" : "") + "</th>").join("") + "</tr></thead><tbody>" + lines.map((l) => "<tr class='" + (l.cls || "") + "'><td>" + x(l.label) + "</td>" + (l.vals ? l.vals.map((v) => "<td>" + (typeof v === "number" ? this.n(v) : x(v)) + "</td>").join("") : cols.map(() => "<td></td>").join("")) + "</tr>").join("") + "</tbody></table>";
  },
  pnl(f) {
    const st = S.store; const ents = f.entityId ? st.entities.filter((e) => e.id === f.entityId) : st.entities; const gccy = f.entityId ? ents[0].currency : st.meta.reportingCurrency; const gfx = (e) => (f.entityId ? 1 : e.groupFx || 1);
    const per = ents.map((e) => ({ e, s: E.entityStatements(st, e.id, f.from || (E.lastClose(st, e.id) ? E.addDays(E.lastClose(st, e.id), 1) : null), f.to || E.today()) }));
    const cols = [...per.map((x) => ({ label: x.e.name, sub: x.e.currency })), ...(per.length > 1 ? [{ label: "Total", sub: gccy + (per.some((x) => x.e.currency !== gccy) ? " at group rates" : "") }] : [])];
    const custRows = (kind, sign) => E.customAccounts(S.store).filter((a) => a.kind === kind).filter((a) => per.some((x) => x.s["c_" + a.code])).map((a) => row(a.name, "c_" + a.code, "", sign));
    const row = (label, k, cls, sign) => { const vals = per.map((x) => (sign || 1) * (x.s[k] || 0)); return { label, cls, vals: [...vals, ...(per.length > 1 ? [E.r2(per.reduce((acc, x, i) => acc + vals[i] * gfx(x.e), 0))] : [])] }; };
    const cats = [...new Set(per.flatMap((x) => Object.keys(x.s.expenseByCat)))].sort();
    const lines = [{ label: "Revenue", cls: "sec" }, row("Sales of goods and services", "revenue"), row("Cost of goods sold", "cogs", "", -1), row("Gross profit", "gross", "sub"), { label: "Operating items", cls: "sec" }, row("Inventory losses", "loss", "", -1), row("Trade-related costs", "fees", "", -1), ...cats.map((c) => { const vals = per.map((x) => -(x.s.expenseByCat[c] || 0)); return { label: c, cls: "ind", vals: [...vals, ...(per.length > 1 ? [E.r2(per.reduce((acc, x, i) => acc + vals[i] * gfx(x.e), 0))] : [])] }; }), row("Total operating expenses", "expenses", "sub", -1), { label: "Other items", cls: "sec" }, row("Other income", "otherIncome"), ...custRows("income", 1), row("Foreign exchange result", "fx"), row("Futures and hedging result", "futPnl"), ...custRows("expense", -1), row("Net result for the period", "net", "tot")];
    const period = (f.from || per.map((x) => x.s.lastClose ? "after close " + x.s.lastClose : "inception")[0]) + " to " + (f.to || E.today());
    return this.page("Profit and loss", this.head("Statement of profit and loss", period, f.entityId ? "Entity statement" : ents.length + " entities, consolidated by simple addition (no eliminations)", gccy) + this.statement(cols, lines) + "<div class='note'>Revenue is recognised on delivery per Bunker Delivery Note; cost of goods at the landed cost of the cargo allocated to each delivery. Negative figures are shown in parentheses.</div>" + this.foot());
  },
  balance(f) {
    const st = S.store; const ents = f.entityId ? st.entities.filter((e) => e.id === f.entityId) : st.entities; const gccy = f.entityId ? ents[0].currency : st.meta.reportingCurrency; const gfx = (e) => (f.entityId ? 1 : e.groupFx || 1);
    const per = ents.map((e) => ({ e, s: E.entityStatements(st, e.id, null, f.to || E.today()) }));
    const cols = [...per.map((x) => ({ label: x.e.name, sub: x.e.currency })), ...(per.length > 1 ? [{ label: "Total", sub: gccy }] : [])];
    const custRows = (kind) => E.customAccounts(S.store).filter((a) => a.kind === kind).filter((a) => per.some((x) => x.s["c_" + a.code])).map((a) => row(a.name, "c_" + a.code));
    const row = (label, k, cls) => { const vals = per.map((x) => x.s[k] || 0); return { label, cls, vals: [...vals, ...(per.length > 1 ? [E.r2(per.reduce((acc, x, i) => acc + vals[i] * gfx(x.e), 0))] : [])] }; };
    const lines = [{ label: "Assets", cls: "sec" }, row("Cash and bank balances", "cash"), row("Futures margin accounts", "futures"), row("Inventory at landed cost", "inventory"), row("Trade receivables", "ar"), row("VAT receivable", "vatIn"), ...custRows("asset"), row("Total assets", "assets", "tot"), { label: "Liabilities", cls: "sec" }, row("Trade payables", "ap"), row("VAT payable", "vatOut"), ...custRows("liability"), row("Total liabilities", "liabilities", "sub"), { label: "Equity", cls: "sec" }, row("Share capital and owner funding", "capital"), row("Retained earnings, prior periods", "priorRetained"), row("Result for the current period", "retained"), ...custRows("equity"), row("Total equity", "equity", "sub"), { label: "Total liabilities and equity", cls: "tot", vals: [...per.map((x) => E.r2(x.s.liabilities + x.s.equity)), ...(per.length > 1 ? [E.r2(per.reduce((acc, x) => acc + (x.s.liabilities + x.s.equity) * gfx(x.e), 0))] : [])] }];
    return this.page("Balance sheet", this.head("Statement of financial position", "as at " + (f.to || E.today()), f.entityId ? "Entity statement" : ents.length + " entities, consolidated by simple addition (no eliminations)", gccy) + this.statement(cols, lines) + "<div class='note'>Inventory is carried at landed cost less allocations and recorded losses. Receivables and payables are shown gross; pending vendor bills for undelivered cargo are not liabilities until receipt.</div>" + this.foot());
  },
  management(f) {
    const st = S.store; const d = E.management(st, { entityId: f.entityId || "", from: f.from || "", to: f.to || "" }); const n = (v) => this.n(v); const pct = (v) => Math.round(v * 100) + "%"; const x = this.esc;
    const kpi = (l, v) => "<div class='kpi'><div class='l'>" + x(l) + "</div><div class='v'>" + v + "</div></div>";
    const period = d.from + " to " + d.to; const scope = f.entityId ? "Entity report" : d.entities.length + " entities";
    let body = this.head("Executive management report", period, scope, d.ccy);
    body += "<h2>1. Headline figures</h2><div class='kpis'>" + kpi("Revenue", n(d.trading.revenue)) + kpi("Gross margin", n(d.trading.margin)) + kpi("Margin %", pct(d.trading.marginPct)) + kpi("Margin per MT", this.n(d.trading.marginMT, 2)) + kpi("Net result", n(d.totals.net)) + kpi("Deliveries / tonnes", d.trading.deliveries + " / " + n(d.trading.mt)) + kpi("Cash and bank", n(d.totals.cash)) + kpi("Receivables", n(d.totals.ar)) + kpi("Payables", n(d.totals.ap)) + kpi("Inventory", n(d.totals.inventory)) + kpi("Equity", n(d.totals.equity)) + kpi("Customers served", d.trading.customers) + "</div>";
    body += "<h2>2. Results by entity</h2>" + this.statement([{ label: "Revenue" }, { label: "Cost of goods" }, { label: "Gross profit" }, { label: "Expenses" }, { label: "Other / FX / futures" }, { label: "Net result" }, { label: "Cash" }, { label: "Receivables" }, { label: "Payables" }, { label: "Equity" }], [...d.entities.map((e) => ({ label: e.e.name + " (" + e.e.currency + ")", vals: [e.s.revenue, -e.s.cogs, e.s.gross, -(e.s.expenses + e.s.loss + e.s.fees), e.s.otherIncome + e.s.fx + e.s.futPnl, e.s.net, e.s.cash, e.s.ar, e.s.ap, e.s.equity] })), ...(d.entities.length > 1 ? [{ label: "Total in " + d.ccy, cls: "tot", vals: [d.totals.revenue, -d.totals.cogs, d.totals.gross, -(d.totals.expenses + d.totals.loss + d.totals.fees), d.totals.otherIncome + d.totals.fx + d.totals.futPnl, d.totals.net, d.totals.cash, d.totals.ar, d.totals.ap, d.totals.equity] }] : [])]);
    body += "<div class='cols3'><div><h2>3. Profitability by product</h2>" + this.statement([{ label: "MT" }, { label: "Revenue" }, { label: "Margin" }, { label: "Margin/MT" }], d.byProd.map((p) => ({ label: p.code, vals: [p.mt, p.revenue, p.margin, p.mt ? this.n(p.margin / p.mt, 2) : ""] }))) + "</div><div><h2>4. Top customers by margin</h2>" + this.statement([{ label: "Stems" }, { label: "MT" }, { label: "Margin" }], d.byCust.slice(0, 10).map((c) => ({ label: c.name, vals: [c.n, c.mt, c.margin] }))) + "</div><div><h2>5. Ports</h2>" + this.statement([{ label: "Stems" }, { label: "MT" }, { label: "Margin" }], d.byPort.map((c) => ({ label: c.port, vals: [c.n, c.mt, c.margin] }))) + "</div></div>";
    body += "<div class='pb'></div><div class='cols2'><div><h2>6. Working capital</h2>" + this.statement([{ label: d.ccy }], [{ label: "Receivables, not yet due", vals: [d.ageing.current] }, { label: "Receivables 1–30 days overdue", vals: [d.ageing.d1_30] }, { label: "Receivables 31–60 days overdue", vals: [d.ageing.d31_60] }, { label: "Receivables over 60 days overdue", vals: [d.ageing.d61] }, { label: "Total receivables (" + d.overdueCount + " invoices overdue)", cls: "sub", vals: [d.arOpen] }, { label: "Payables open", vals: [d.apOpen] }, { label: "of which overdue", cls: "ind", vals: [d.apOverdue] }, { label: "Inventory at landed cost", vals: [d.totals.inventory] }, { label: "Net VAT position (payable +)", vals: [d.totals.vatNet] }, { label: "Cash today", vals: [d.cashStart] }, { label: "Lowest projected cash (" + d.cashLow.date + ")", vals: [d.cashLow.balance] }]) + "</div><div><h2>7. Positions and risk</h2>" + this.statement([{ label: "Physical MT" }, { label: "Sellable" }, { label: "Fwd sold" }, { label: "Futures MT" }, { label: "Net MT" }, { label: "Hedged" }], d.positions.map((p) => ({ label: (L.entity(p.entityId) || {}).name + " · " + (L.product(p.productId) || {}).code, vals: [p.physicalMT, p.sellableMT, p.forwardSoldMT, p.hedgeMT, p.netMT, pct(p.hedgeRatio)] }))) + "<div class='note'>Futures: unrealised " + n(d.futures.unrealized) + ", realised " + n(d.futures.realized) + ", initial margin " + n(d.futures.margin) + ", account equity " + n(d.futures.equity) + ".</div>" + (d.overLimit.length ? "<h2>Credit lines exceeded</h2>" + this.statement([{ label: "Exposure" }, { label: "Limit" }], d.overLimit.map((c) => ({ label: c.name, vals: [c.exposure, c.limit] }))) : "") + "</div></div>";
    const ex = Object.entries(d.expenses).sort((a, b) => b[1] - a[1]);
    body += "<div class='cols2'><div><h2>8. Operating expenses by category</h2>" + this.statement([{ label: d.ccy }], [...ex.map(([k, v]) => ({ label: k, vals: [v] })), { label: "Total", cls: "sub", vals: [d.totals.expenses] }]) + "</div><div><h2>9. Basis of preparation</h2><div class='note' style='font-size:9.5px;line-height:1.5'>Figures are drawn from the XYNTAX double-entry ledger as at " + E.today() + ". Revenue is recognised on delivery; cost of goods at landed cost of the allocated cargo; group totals convert each entity at its stated group rate with no inter-company eliminations. " + (d.closings.length ? "Year-end closes recorded: " + d.closings.map((c) => (L.entity(c.entityId) || {}).name + " " + c.date).join("; ") + ". " : "No year-end close has been recorded. ") + (st.settings.lockedThrough ? "Ledger locked through " + st.settings.lockedThrough + "." : "No period lock is set.") + "</div></div></div>";
    return this.page("Executive management report", body + this.foot());
  },
};
async function openFin(kind, f, preview) {
  const html = FIN[kind](f); const name = { pnl: "Profit-and-loss", balance: "Balance-sheet", management: "Management-report" }[kind] + "-" + (f.to || E.today()) + ".pdf";
  if (preview) { if (NATIVE.host()) { openPreview({ kind: "document", title: name.replace(/\.pdf$/, ""), name, html }); return; } await NATIVE.preview(html); return; }
  await NATIVE.savePDF(name, html, { landscape: true });
}
async function openDoc(kind, id, opt) {
  let html, name;
  if (kind === "invoice") { const i = L.invoice(id); html = DOCS.invoice(i); name = i.ref + ".pdf"; }
  else if (kind === "proforma") { const t = L.trade(id); html = DOCS.proforma(t); name = "Proforma-" + t.ref + ".pdf"; }
  else if (kind === "bill") { const b = L.bill(id); html = DOCS.bill(b); name = b.ref + ".pdf"; }
  else if (kind === "po") { const c = L.cargo(id); html = DOCS.po(c); name = "PO-" + c.ref + ".pdf"; }
  else if (kind === "so") { const t = L.trade(id); html = DOCS.so(t); name = "Confirmation-" + t.ref + ".pdf"; }
  else if (kind === "creditnote") { const cn = S.store.documents.find((x) => x.id === id); html = DOCS.creditnote(cn); name = cn.ref + ".pdf"; }
  else if (kind === "soa") { html = DOCS.soa(id, opt.entityId, opt.from, opt.to); name = "Statement-" + nm.cps(id).replace(/\s+/g, "-") + "-" + E.today() + ".pdf"; }
  if (opt && opt.preview) { const back = kind === "invoice" || kind === "creditnote" ? { type: "invoice", id: kind === "creditnote" ? (S.store.documents.find((x) => x.id === id) || {}).invoiceId : id } : kind === "bill" ? { type: "bill", id } : kind === "po" ? { type: "cargo", id } : kind === "soa" ? { type: "cp", id } : { type: "trade", id }; openPreview({ kind: "document", title: name.replace(/\.pdf$/, "").replace(/-/g, " "), name, html, subject: name.replace(/\.pdf$/, "").replace(/-/g, " "), back }); return; }
  await NATIVE.savePDF(name, html, { landscape: false });
}
const docButtons = (list) => h("div", { class: "row" }, list.map(([label, kind, id, opt]) => h("button", { class: "quiet", onclick: () => openDoc(kind, id, opt) }, label)));
