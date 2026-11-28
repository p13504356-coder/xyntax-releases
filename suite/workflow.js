/* XYNTAX · WORKFLOW — how a company works, and so what the Accounting app shows.
 * A company picks a model (Trading, Services, General business), switches modules on and off, renames the terms its people
 * use, keeps a catalogue of products or services with prices, and sets defaults. The profile is one company-shared suite
 * document ("workflow"): administrators change it in Settings → Workflow, every member reads it. Nothing in the books
 * changes with it — a hidden module's records stay where they are; only what is shown, offered and printed follows the profile.
 * Without a company (local or personal use) the Trading default applies and any change is kept on the device. */
(function () {
  const MODELS = {
    trading: { name: "Trading", hint: "Buy cargoes, sell trades, vessels and ports — the full desk", modules: { trades: true, cargo: true, products: true, counterparties: true, vessels: true, futures: true, compliance: true, invoices: true, payouts: true, ledger: true, bank: true },
      labels: { trade: "Trade", trades: "Trades", book: "Book", cargo: "Cargo", cargoes: "Cargoes", counterparty: "Counterparty", counterparties: "Counterparties", customer: "Customer", supplier: "Supplier", buy: "Purchase cargo", sell: "New trade", line: "Sales lines", group: "Trading" } },
    services: { name: "Services", hint: "Engagements billed from a catalogue of services — no cargo, no vessels", modules: { trades: true, cargo: false, products: false, counterparties: true, vessels: false, futures: false, compliance: true, invoices: true, payouts: true, ledger: true, bank: true },
      labels: { trade: "Engagement", trades: "Engagements", book: "Engagements", cargo: "Cargo", cargoes: "Cargoes", counterparty: "Client", counterparties: "Clients and vendors", customer: "Client", supplier: "Vendor", buy: "Purchase", sell: "New engagement", line: "Services", group: "Work" } },
    // 4.22 · chartering in and out: hire and freight invoiced to charterers, hire paid to owners, bunkers and brokers paid — no products, no stock
    shipping: { name: "Shipping", hint: "Charter vessels in and out — collect hire and freight, pay hire, bunkers and brokers; no products", modules: { trades: true, cargo: false, products: false, counterparties: true, vessels: true, futures: false, compliance: true, invoices: true, payouts: true, ledger: true, bank: true },
      labels: { trade: "Charter", trades: "Charters", book: "Charters", cargo: "Cargo", cargoes: "Cargoes", counterparty: "Counterparty", counterparties: "Charterers, owners and brokers", customer: "Charterer", supplier: "Owner / supplier", buy: "Pay hire (charter in)", sell: "Invoice a charterer", line: "Hire, freight and charges", group: "Shipping" } },
    general: { name: "General business", hint: "Sales, products, invoices, bank and the books — no trade desk", modules: { trades: true, cargo: false, products: true, counterparties: true, vessels: false, futures: false, compliance: false, invoices: true, payouts: true, ledger: true, bank: true },
      labels: { trade: "Sale", trades: "Sales", book: "Sales", cargo: "Stock", cargoes: "Stock", counterparty: "Counterparty", counterparties: "Customers and suppliers", customer: "Customer", supplier: "Supplier", buy: "Purchase", sell: "New sale", line: "Lines", group: "Business" } },
  };
  const MODULES = [["trades", "Trades and the book", "the sales side: trades or engagements, their files and documents"], ["cargo", "Cargo and stock", "purchases into stock, allocation, landed cost"], ["products", "Product lines", "physical product lines priced per unit; off, every line is a service"], ["counterparties", "Counterparties", "customers, suppliers, onboarding"], ["vessels", "Vessels and ports", "the fleet you supply, delivery ports, ETA and agents"], ["futures", "Futures", "paper positions and margin accounts"], ["compliance", "Compliance", "screening and the watchlist"], ["ledger", "Ledger", "journals, accounts, statements"], ["bank", "Bank", "bank accounts, statements and reconciliation"]];
  const DEF = () => ({ model: "trading", modules: { ...MODELS.trading.modules }, labels: { ...MODELS.trading.labels }, products: [], defaults: { currency: "USD", vat: 5, paymentDays: 30, unit: "each" } });
  const KEY = "shared:workflow";
  let cur = DEF(); let loaded = false; let loadedFor = null; let loading = null; const subs = [];
  const orgKey = () => (typeof CLOUD !== "undefined" && CLOUD.session && CLOUD.session() && CLOUD.session().org_id) || "local";
  const company = () => typeof CLOUD !== "undefined" && CLOUD.active && CLOUD.active();
  const isAdmin = () => typeof CLOUD === "undefined" || !CLOUD.signedIn() || (CLOUD.isAdmin && CLOUD.isAdmin());
  const fill = (p) => { const d = DEF(); const m = MODELS[p.model] ? p.model : "trading"; return { model: m, modules: { ...MODELS[m].modules, ...(p.modules || {}) }, labels: { ...MODELS[m].labels, ...(p.labels || {}) }, products: Array.isArray(p.products) ? p.products : [], defaults: { ...d.defaults, ...(p.defaults || {}) } }; };
  function fire() { for (const f of subs) { try { f(cur); } catch (e) { /* a listener's own error */ } } document.dispatchEvent(new CustomEvent("workflow-change", { detail: cur })); if (document.body.dataset.app === "accounting" && typeof render === "function" && typeof S !== "undefined" && S.store) { try { render(); } catch (e) { /* not mounted */ } } }
  const W = {
    MODELS, MODULES, KEY,
    get() { return cur; },
    loaded() { return loaded; },
    async load() { const k = orgKey(); if (loading && loadedFor === k) return loading; loadedFor = k; loading = (async () => { try { const d = await SUITE.db.load(KEY, DEF); cur = fill(d); } catch (e) { cur = fill(SUITE.db.local(KEY) || {}); } loaded = true; loading = null; fire(); return cur; })(); return loading; },
    // called by the accounting views: the profile follows the open company (sign-in happens after the page loads)
    ensure() { if (loadedFor !== orgKey() && typeof SUITE !== "undefined" && SUITE.db) { delete SUITE.db.cache[KEY]; this.load().catch(() => {}); return false; } return loaded; },
    // the live document is kept whole in SUITE.db's cache; a change replaces its fields and saves
    async set(patch) {
      if (!isAdmin()) { SUITE.toast("Only an administrator changes the workflow"); return cur; }
      let d = SUITE.db.peek(KEY); if (!d) { try { d = await SUITE.db.load(KEY, DEF); } catch (e) { d = null; } }
      const next = fill({ ...cur, ...patch, modules: { ...cur.modules, ...(patch.modules || {}) }, labels: { ...cur.labels, ...(patch.labels || {}) }, defaults: { ...cur.defaults, ...(patch.defaults || {}) } });
      if (patch.model && patch.model !== cur.model && !patch.modules) next.modules = { ...MODELS[next.model].modules }; if (patch.model && patch.model !== cur.model && !patch.labels) next.labels = { ...MODELS[next.model].labels };
      cur = next; if (d) { Object.assign(d, JSON.parse(JSON.stringify(cur))); SUITE.db.save(KEY, true); }
      fire(); return cur;
    },
    async applyPreset(model) { if (!MODELS[model]) return; const r = await this.set({ model, modules: { ...MODELS[model].modules }, labels: { ...MODELS[model].labels } }); if (model === "shipping") { try { await this.ensureShipping(cur.defaults.currency); } catch (e) { /* catalogue later */ } this.ensureShippingCategories(); } return r; },
    // 4.22 · the Shipping model pays hire, bunkers, port costs and brokers: those categories exist in the books from the first bill
    SHIPPING_CATEGORIES: ["Hire", "Bunkers", "Port costs", "Brokerage", "Agency", "Insurance", "Canal dues", "Surveys"],
    ensureShippingCategories() { try { if (typeof S === "undefined" || !S.store || !S.store.settings) return false; const list = S.store.settings.expenseCategories || (S.store.settings.expenseCategories = []); const have = new Set(list.map((c) => c.toLowerCase())); const add = this.SHIPPING_CATEGORIES.filter((c) => !have.has(c.toLowerCase())); if (!add.length) return false; list.splice(Math.max(0, list.length - 1), 0, ...add); /* before "Other" */ if (typeof commit === "function" && (typeof CLOUD === "undefined" || !CLOUD.active() || CLOUD.canEdit())) commit("Shipping expense categories added"); return true; } catch (e) { return false; } },
    has(mod) { const m = cur.modules; return m[mod] !== false; },
    model() { return cur.model; },
    label(k, o) { let s = cur.labels[k] || MODELS.trading.labels[k] || k; if (o && o.lower) s = s.toLowerCase(); return s; },
    // 4.30 · the words of a model for what the engine stores in trading terms: a shipping company performs a charter where a trader
    // delivers a stem. The books do not change; the page maps the word when it is shown. A model without an entry keeps the trading word.
    WORDS: { trading: { delivered: "Delivered", deliver: "Mark delivered", deliverInvoice: "Mark delivered and invoice", delivery: "Delivery", deliveryDate: "delivery", deliveries: "Deliveries", "stage:delivered": "delivered", cogs: "Cost of goods", revenue: "Revenue, all lines", receivedFrom: "Received from customer", paidTo: "Paid to suppliers and costs", source: "Purchase", postingsStart: "Nothing posted yet; postings start at delivery.", assessHint: "Enter entity, customer, product, quantity and price to see the analysis." },
      shipping: { delivered: "Performed", deliver: "Mark performed", deliverInvoice: "Mark performed and invoice", delivery: "Performance", deliveryDate: "invoice date", deliveries: "Charters performed", "stage:delivered": "performed", "Trade booked, unsourced": "Charter booked", "Trade booked": "Charter booked", "Trade edited": "Charter edited", "Trade cancelled": "Charter cancelled", cogs: "Voyage costs", cashOn: "Cash on this charter", ledgerFor: "Ledger entries for this charter", docsHint: "Charter party, recap, statements of facts, hire statements, bunker delivery notes — anything supporting this charter.", assessHint: "Enter entity, charterer, vessel, period/quantity and rate to see the analysis.", revenue: "Revenue (hire, freight and charges)", postingsStart: "Nothing posted yet; postings start when the charter is performed and invoiced.", receivedFrom: "Received from charterer", paidTo: "Paid to owners, suppliers and costs", source: "Costs", ledgerDelivery: "Hire/freight", resetDelivery: "performance" } },
    word(k, o) { const d = this.WORDS[cur.model]; let s = d && d[k] != null ? d[k] : this.WORDS.trading[k] != null ? this.WORDS.trading[k] : k; if (o && o.lower) s = s.toLowerCase(); return s; },
    // the stored texts of a trade's timeline and ledger memos, in the model's words (display only)
    text(s) { const d = cur.model === "shipping" ? this.WORDS.shipping : null; if (!d || typeof s !== "string") return s; if (d[s] != null) return d[s]; return s.replace(/^Delivered 0 MT(, |$)/, "Performed and invoiced$1").replace(/^Delivered ([\d.,]+) MT/, "Performed · $1 MT").replace(/^Reset to draft: delivery of /, "Reset to draft: " + d.resetDelivery + " of ").replace(/^Delivery (\S+) to /, d.ledgerDelivery + " $1 to ").replace(/^Reset to draft: reversal of Delivery /, "Reset to draft: reversal of " + d.ledgerDelivery + " ").replace(/^Trade booked/, "Charter booked"); },
    products() { return cur.products.slice(); },
    product(id) { return cur.products.find((p) => p.id === id) || null; },
    async saveProduct(p) { const list = cur.products.slice(); const i = list.findIndex((x) => x.id === p.id); if (i >= 0) list[i] = { ...list[i], ...p }; else list.push({ ...p, id: p.id || SUITE.uid() }); return this.set({ products: list }); },
    async removeProduct(id) { return this.set({ products: cur.products.filter((p) => p.id !== id) }); },
    defaults() { return { ...cur.defaults }; },
    // 4.12 PROSHIP · the shipping catalogue: hire, freight, demurrage and the rest, seeded once (by code) for companies that run PROSHIP
    SHIPPING: [["PS-TCH", "Time charter hire", "day"], ["PS-FRT", "Voyage freight", "MT"], ["PS-FRL", "Voyage freight (lumpsum)", "lumpsum"], ["PS-DEM", "Demurrage", "day"], ["PS-DES", "Despatch (credit)", "day"], ["PS-BB", "Ballast bonus", "lumpsum"], ["PS-ADC", "Address commission (deduction)", "each"], ["PS-BRK", "Brokerage", "each"], ["PS-CVE", "CVE (communications, victualling, entertainment)", "month"], ["PS-ILOHC", "ILOHC (in lieu of hold cleaning)", "lumpsum"], ["PS-BOD", "Bunkers on delivery", "MT"], ["PS-BOR", "Bunkers on redelivery (credit)", "MT"], ["PS-PDA", "Port disbursement", "lumpsum"], ["PS-LTA", "Laytime adjustment", "day"], ["PS-OFH", "Off-hire deduction", "day"]],
    async ensureShipping(ccy) { if (!isAdmin()) return cur; const have = new Set(cur.products.map((p) => p.code)); const add = this.SHIPPING.filter(([code]) => !have.has(code)); if (!add.length) return cur; const list = cur.products.concat(add.map(([code, name, unit]) => ({ id: SUITE.uid(), code, name, unit, price: 0, currency: ccy || cur.defaults.currency || "USD", vat: 0, description: name }))); return this.set({ products: list }); },
    hasShipping() { return cur.products.some((p) => p.code === "PS-TCH"); },
    onChange(fn) { subs.push(fn); return () => { const i = subs.indexOf(fn); if (i >= 0) subs.splice(i, 1); } },
    // the primary thing a company creates in its model, for the New key and the desk
    primary() { if (this.has("trades")) return { l: this.label("sell"), run: () => (cur.model === "shipping" ? W.charterOut() : typeof forms !== "undefined" && forms.trade ? forms.trade({}) : null) }; return { l: "Record bank transaction", run: () => (typeof forms !== "undefined" && forms.bankTx ? forms.bankTx() : null) }; },
    // 4.22 · the second thing a shipping company creates: a charter in — the owner's hire as a bill (payable), bunkers and brokers the same way
    secondary() { if (cur.model !== "shipping") return null; return { l: this.label("buy"), run: () => W.charterIn() }; },
    // 4.25 · in the Shipping model nothing is typed freely: what a charterer is invoiced comes from the fixture in PROSHIP —
    // the next hire period of a time charter, the freight of a voyage (qty × rate, address commission, brokerage, laytime),
    // an open demurrage claim. This picker lists what is billable across the fleet and hands the chosen item to PROSHIP's
    // own invoicing (PSF.invoiceHire / invoiceFreightFor / raiseClaim), which prefills the invoice from the charter party.
    async charterOut() {
      const H = SUITE.H; const money = (n, c) => SUITE.money(n, c, 0);
      if (typeof PS === "undefined" || !PS.ready || typeof PSE === "undefined" || typeof PSF === "undefined") { if (typeof forms !== "undefined" && forms.trade) forms.trade({ meta: { kind: "hire" } }); return; }
      let d; try { d = await PS.ready(); } catch (e) { d = null; } if (!d) { forms.trade({ meta: { kind: "hire" } }); return; }
      const book = typeof S !== "undefined" ? S.store : null; const items = [];
      const vessels = (PS.activeVessels ? PS.activeVessels() : PS.vessels()).slice().sort((a, b) => a.name.localeCompare(b.name));
      for (const v of vessels) {
        for (const f of PS.fixtures(v.id)) {
          if (["cancelled", "on-subs"].includes(f.status)) continue; const ch = PS.cpName(f.chartererCpId) || "charterer";
          if (f.kind === "tc" || f.kind === "bareboat") { let u = null; try { u = PSE.unbilled(d, book, f); } catch (e) { u = null; } const p = u && u.next; items.push({ vessel: v, kind: "hire", title: v.name + " · hire to " + ch, sub: p ? "period " + p.no + " · " + PSE.fmtAt(p.from) + " – " + PSE.fmtEnd(p.to) + (p.amount != null ? " · " + money(p.amount, f.currency) : "") + (u.due ? " · " + u.due + " due" : "") : "every period so far is invoiced — a custom period", amount: p ? p.amount : null, due: !!(u && u.due), run: () => PSF.invoiceHire(v.id, f.id) }); }
          else { const voys = (d.voyages || []).filter((x) => x.fixtureId === f.id).sort((a, b) => String(a.no || "").localeCompare(String(b.no || ""))); const list = voys.length ? voys : [null]; for (const vy of list) { let fr = null; try { fr = PSE.freight(f, vy, { laytime: vy ? (d.laytime || []).filter((x) => x.voyageId === vy.id) : [], vesselName: v.name }); } catch (e) { fr = null; } const done = (book ? book.invoices : []).some((i) => i.fixtureId === f.id && i.meta && i.meta.kind === "freight" && (!vy || i.meta.voyageId === vy.id)); items.push({ vessel: v, kind: "freight", title: v.name + " · freight to " + ch + (vy ? " · voyage " + (vy.no || "") : ""), sub: (fr ? money(fr.freight, fr.currency) + (fr.demurrage ? " + demurrage " + money(fr.demurrage, fr.currency) : "") + (fr.qty ? " · " + (+fr.qty).toLocaleString() + " MT × " + fr.rate : "") : "freight from the charter party") + (done ? " · invoiced" : ""), amount: fr ? fr.freight : null, done, run: () => (vy ? PSF.invoiceFreightFor(v.id, vy) : PSF.invoiceFreight(v.id)) }); } }
        }
        for (const c of (d.claims || []).filter((x) => x.vesselId === v.id && x.status === "open" && +x.amount > 0)) items.push({ vessel: v, kind: "claim", title: v.name + " · " + (c.kind || "claim") + " against " + (PS.cpName(c.againstCpId) || "counterparty"), sub: money(c.amount, c.currency) + (c.date ? " · " + c.date : ""), amount: +c.amount, run: () => PSF.raiseClaim(c.id) });
      }
      items.sort((a, b) => (b.due ? 1 : 0) - (a.due ? 1 : 0) || (a.done ? 1 : 0) - (b.done ? 1 : 0) || a.title.localeCompare(b.title));
      const close = () => { const box = document.getElementById("shdlg"); if (box) { box.classList.remove("open"); box.innerHTML = ""; } };
      const row = (it) => H("button", { class: "wf-bill" + (it.done ? " done" : "") + (it.due ? " due" : ""), onclick: () => { close(); try { it.run(); } catch (e) { SUITE.toast(e.message); } } }, H("b", {}, it.title), H("span", { class: "sh-dim" }, it.sub));
      const body = H("div", { class: "wf-bills" }, items.length ? items.map(row) : H("div", { class: "sh-dim" }, "Nothing is fixed yet. A charter is invoiced from its charter party: fix the vessel in PROSHIP (Commercial → Fixture) and the hire periods, freight and laytime follow from it."),
        H("div", { class: "row", style: "margin-top:10px;gap:8px;flex-wrap:wrap" }, H("button", { class: "quiet", onclick: () => { close(); if (PS.openTab) { SUITE.open("proship"); setTimeout(() => PS.openTab("commercial", { sub: "fixtures" }), 300); } } }, "Fix a vessel in PROSHIP…"), H("button", { class: "quiet", onclick: () => { close(); forms.trade({ meta: { kind: "other" } }); } }, "Other charge to a charterer…")));
      SUITE.dialog({ title: "Invoice a charterer", text: "What the charterer owes under the charter party — pick the item; the invoice is drawn up from the fixture in PROSHIP.", body, ok: "", cancel: "Close" }).then(() => {});
    },
    // the owner's side of a chartered-in vessel: hire payable, as a bill on the vessel (bunkers and brokers go the same way)
    charterIn() {
      if (typeof forms === "undefined" || !forms.expense) return; const H = SUITE.H;
      const vessels = typeof PS !== "undefined" && PS.vessels ? (PS.activeVessels ? PS.activeVessels() : PS.vessels()).filter((v) => v.management === "charter-in" || v.accounting === "principal") : [];
      if (!vessels.length) { forms.expense({ category: "Hire", memo: "Hire — charter in" }); return; }
      const close = () => { const box = document.getElementById("shdlg"); if (box) { box.classList.remove("open"); box.innerHTML = ""; } };
      const body = H("div", { class: "wf-bills" }, vessels.map((v) => H("button", { class: "wf-bill", onclick: () => { close(); forms.expense({ category: "Hire", memo: "Hire — " + v.name, vesselId: v.id, counterpartyId: v.ownerCpId || undefined }); } }, H("b", {}, v.name), H("span", { class: "sh-dim" }, (v.ownerCpId && PS.cpName(v.ownerCpId) ? "owner " + PS.cpName(v.ownerCpId) : "owner not set") + (v.management === "charter-in" ? " · chartered in" : "")))), H("div", { class: "row", style: "margin-top:10px" }, H("button", { class: "quiet", onclick: () => { close(); forms.expense({ category: "Hire", memo: "Hire — charter in" }); } }, "Another vessel or owner…")));
      SUITE.dialog({ title: "Pay hire — charter in", text: "The owner's hire for a vessel you have taken in, as a bill to settle; bunkers and brokerage are recorded the same way under their own categories.", body, ok: "", cancel: "Close" }).then(() => {});
    },
  };
  window.WORKFLOW = W;
  // 4.30 · the command line in the Shipping model: "invoice hire" / "invoice <vessel>" opens the charterer picker, "pay hire" the owner's
  // hire, "pay bunkers" / "pay broker" the bill under its category, "new charter" the picker. The parser itself (ui.js) is untouched;
  // its results come first and the shipping entries are added when the model is Shipping.
  if (typeof commands !== "undefined" && commands && typeof commands.parse === "function" && !commands.__shipping) {
    const orig = commands.parse; commands.__shipping = true;
    commands.parse = function (q) {
      const out = orig.call(this, q); if (cur.model !== "shipping") return out; const low = String(q || "").trim().toLowerCase(); const extra = [];
      const mi = low.match(/^(?:invoice|bill|charter)(?:\s+(?:a\s+)?(?:charterer|hire|freight|demurrage))?(?:\s+(.+))?$/) || low.match(/^(?:new|add|create)\s+charter(?:\s+(.+))?$/);
      if (mi) { const vq = (mi[1] || "").trim(); const v = vq && typeof PS !== "undefined" && PS.vessels ? PS.vessels().find((x) => (x.name || "").toLowerCase().includes(vq)) : null; extra.push({ k: "charter", label: W.label("sell") + (v ? " · " + v.name : ""), d: "what the charterer owes under the charter party — hire period, freight, demurrage", run: () => W.charterOut() }); }
      const mp = low.match(/^pay\s+(hire|bunkers?|brokers?|brokerage|port(?:\s+costs?)?|agency)(?:\s+(.+))?$/);
      if (mp) { const k = mp[1]; if (k === "hire") extra.push({ k: "hire", label: W.label("buy"), d: "the owner's hire for a vessel taken in, as a bill to settle", run: () => W.charterIn() }); else if (typeof forms !== "undefined" && forms.expense) { const cat = /^bunker/.test(k) ? "Bunkers" : /^brok/.test(k) ? "Brokerage" : /^port/.test(k) ? "Port costs" : "Agency"; extra.push({ k: "bill", label: "Pay " + cat.toLowerCase(), d: "a bill under " + cat + ", on the vessel", run: () => forms.expense({ category: cat, memo: cat }) }); } }
      const mb = low.match(/^charters\s+(.+)$/); if (mb && typeof S !== "undefined" && S.store && typeof XyntaxEngine !== "undefined") { const tq = mb[1].trim(); const tm = XyntaxEngine.filterTrades(S.store, { q: tq }); if (tm.length) extra.push({ k: "charters", label: "Show " + tm.length + " " + W.label("trades", { lower: true }) + " matching \"" + tq + "\"", d: "filters the charters; add words for charterer, port, vessel or stage", run: () => { S.filters.book = Object.assign(S.filters.book || {}, { q: tq, page: 0 }); S.view = "book"; if (typeof render === "function") render(); } }); }
      return extra.length ? extra.concat(out).slice(0, 14) : out;
    };
  }
  // load with the company (and again when it changes)
  const boot = () => { if (typeof SUITE === "undefined" || !SUITE.db) return; W.load().catch(() => {}); };
  if (document.readyState === "complete") setTimeout(boot, 0); else window.addEventListener("load", () => setTimeout(boot, 0));

  // ---------- Settings → Workflow (administrators of the open company)
  const page = {
    id: "workflow", label: "Workflow", group: "admin",
    when: () => typeof CLOUD !== "undefined" && CLOUD.active() && CLOUD.isAdmin(),
    draw(main, X) {
      const { H, h1, panel, row, tbl } = X; const w = W.get(); const redraw = () => { if (X.go) X.go("workflow"); };
      const act = (fn) => async () => { try { await fn(); redraw(); } catch (e) { SUITE.toast(e.message); } };
      main.append(h1("Workflow", "how " + ((CLOUD.state && CLOUD.state.orgName) || "the company") + " works — what Accounting shows, offers and prints. Records of a hidden module are kept, not shown."));
      main.append(panel("Model", H("div", { class: "wf-models" }, Object.entries(MODELS).map(([id, m]) => H("button", { class: "wf-model" + (w.model === id ? " on" : ""), onclick: act(() => W.applyPreset(id)) }, H("b", {}, m.name), H("span", {}, m.hint))))));
      main.append(panel("Modules", ...MODULES.map(([id, l, hint]) => row(l, H("label", { class: "st-tog" }, H("input", { type: "checkbox", checked: W.has(id) ? true : null, onchange: act(() => W.set({ modules: { [id]: !W.has(id) } })) }), H("span", { class: "sw" })), hint))));
      const terms = [["trade", "One sale"], ["trades", "Several"], ["book", "The list of them (the Book)"], ["sell", "The button that creates one"], ["customer", "Who buys"], ["supplier", "Who sells to you"], ["counterparties", "Both together"], ["cargo", "A purchase into stock"], ["buy", "The button that buys stock"], ["line", "The lines on an invoice"], ["group", "The group name in the menu"]];
      main.append(panel("Terms", H("div", { class: "sh-dim", style: "margin-bottom:8px" }, "Your people's words for things; used in menus, buttons, tables and on the PDFs."), H("div", { class: "wf-terms" }, terms.map(([k, hint]) => H("label", { class: "sh-f" }, H("span", {}, hint), H("input", { value: W.label(k), onchange: (e) => { const v = e.target.value.trim(); if (v) W.set({ labels: { [k]: v } }); } })))), H("div", { class: "sh-toolbar" }, H("button", { class: "quiet", onclick: act(() => W.set({ labels: { ...MODELS[w.model].labels } })) }, "Reset to the model's terms"))));
      const prodForm = (p) => SUITE.form({ title: p ? "Edit " + p.name : (W.has("products") ? "New product or service" : "New service"), fields: [{ k: "name", label: "Name", value: p ? p.name : "" }, { k: "code", label: "Code (optional)", value: p ? p.code || "" : "" }, { k: "unit", label: "Unit", type: "select", options: ["each", "hour", "day", "month", "lot", "MT", "CBM", "L", "KG", "BBL"].map((u) => ({ v: u, l: u })), value: p ? p.unit : w.defaults.unit }, { k: "price", label: "Price per unit", type: "number", value: p ? p.price : "" }, { k: "currency", label: "Currency", value: p ? p.currency : w.defaults.currency }, { k: "vat", label: "VAT %", type: "number", value: p ? p.vat : w.defaults.vat }, { k: "description", label: "Description on the invoice (optional)", type: "textarea", value: p ? p.description || "" : "" }], submitLabel: p ? "Save" : "Add", submit: async (v) => { if (!v.name) throw new Error("A name, please"); await W.saveProduct({ id: p ? p.id : undefined, name: v.name.trim(), code: (v.code || "").trim(), unit: v.unit || "each", price: v.price === "" || v.price == null ? 0 : +v.price, currency: (v.currency || w.defaults.currency).toUpperCase(), vat: v.vat === "" || v.vat == null ? w.defaults.vat : +v.vat, description: v.description || "" }); redraw(); } });
      main.append(panel(w.model === "shipping" ? "Catalogue — hire, freight and charges (the lines on hire statements and freight invoices)" : W.has("products") ? "Catalogue — products and services" : "Catalogue — services", H("div", { class: "sh-toolbar" }, H("button", { class: "primary", onclick: () => prodForm(null) }, "+ Add")), tbl([{ l: "Name" }, { l: "Code" }, { l: "Unit" }, { l: "Price", num: 1 }, { l: "VAT", num: 1 }, { l: "" }], w.products.map((p) => ({ cells: [H("b", {}, p.name), p.code || "", p.unit, SUITE.money(p.price, p.currency), (p.vat == null ? w.defaults.vat : p.vat) + "%", H("span", { class: "sh-toolbar", style: "margin:0;justify-content:flex-end" }, H("button", { class: "quiet", onclick: () => prodForm(p) }, "Edit"), H("button", { class: "quiet danger", onclick: act(async () => { if (await SUITE.confirm({ title: "Remove " + p.name + "?", text: "Invoices already raised keep their lines." }, "Remove", true)) await W.removeProduct(p.id); }) }, "Remove")) ] })), { empty: "Nothing in the catalogue yet. Lines can still be typed freely." })));
      const dflt = (k, label, type, hint) => row(label, H("input", { type: type || "text", value: w.defaults[k], style: "width:120px;text-align:right", onchange: (e) => W.set({ defaults: { [k]: type === "number" ? +e.target.value : e.target.value.trim().toUpperCase() } }) }), hint);
      main.append(panel("Defaults", dflt("currency", "Currency", "text", "offered first on new lines and catalogue items"), dflt("vat", "VAT %", "number"), dflt("paymentDays", "Payment terms (days)", "number", "when the customer has none of their own"), row("Unit", H("select", { style: "width:120px", onchange: (e) => W.set({ defaults: { unit: e.target.value } }) }, ["each", "hour", "day", "month", "lot", "MT"].map((u) => H("option", { value: u, selected: w.defaults.unit === u ? true : null }, u))), "for new catalogue items and service lines")));
    },
  };
  window.SETTINGS_EXTRA = (window.SETTINGS_EXTRA || []).concat([page]);
})();
