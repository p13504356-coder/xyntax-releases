/* XYNTAX — the demo company: a believable year of ship management and chartering (1 November last year → today) built through the
 * accounting engine and the PROSHIP document, every record tagged, removable in one step.
 *   XDEMO.build({ store, ps, seed, today, now }) → pure generator (no DOM); mutates the book store through the engine API and fills the
 *                                                  PROSHIP document; returns the counts. Deterministic for a seed (the engine's own ids aside).
 *   XDEMO.load()    → in the app: confirm, build into S.store and PS.data(), save through the normal BOOKDB / PSDB paths with progress
 *   XDEMO.remove()  → confirm, take every tagged record out of the book and PROSHIP and save (the row store accepts removing a demo journal);
 *                     falls back to the workspace's book_purge_demo when the server refuses
 *   XDEMO.present() → bool · XDEMO.summary() → counts per collection · XDEMO.strip(store, ps) → the in-memory removal
 * Tag: `demo: true` (what the 4.16 ledger trigger and E.hasDemo understand) and `demoSet: "xd1"` (this data set). No AIS positions are
 * invented: a vessel's position comes from her noon reports and the voyage plan. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(root, true);
  else root.XDEMO = Object.assign(root.XDEMO || {}, factory(root, false));
})(typeof self !== "undefined" ? self : this, function (root, isNode) {
  "use strict";
  const TAG = "xd1";
  const isDemo = (x) => !!x && typeof x === "object" && (x.demoSet === TAG || x.demo === TAG);
  const eng = () => (isNode ? require("./engine.js") : root.XyntaxEngine);
  const pse = () => (isNode ? require("./proship-engine.js") : root.PSE);
  const MIN = 60000, HOUR = 60 * MIN, DAY = 24 * HOUR;
  const pad = (n) => (n < 10 ? "0" : "") + n;
  const iso = (ms) => { const d = new Date(Math.floor(ms / MIN) * MIN); return d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1) + "-" + pad(d.getUTCDate()) + "T" + pad(d.getUTCHours()) + ":" + pad(d.getUTCMinutes()); };
  const day = (ms) => iso(ms).slice(0, 10);
  const msOf = (s) => Date.parse(s.length === 10 ? s + "T00:00:00Z" : s + ":00Z");
  const r2 = (n) => Math.round(n * 100) / 100;

  // ---------- ports (coordinates and regions from the PROSHIP port table)
  const PORTS = { "Santos": [-23.95, -46.33, "ECSA", "BR"], "Paranagua": [-25.5, -48.52, "ECSA", "BR"], "Qingdao": [36.07, 120.32, "FE", "CN"], "Tianjin": [38.98, 117.75, "FE", "CN"], "Dalian": [38.92, 121.63, "FE", "CN"], "New Orleans": [29.95, -90.07, "USG", "US"], "Mobile": [30.69, -88.04, "USG", "US"], "Busan": [35.1, 129.04, "FE", "KR"], "Balikpapan": [-1.27, 116.83, "FE", "ID"], "Mundra": [22.74, 69.7, "IND", "IN"], "Kandla": [23, 70.22, "IND", "IN"], "Paradip": [20.27, 86.67, "IND", "IN"], "Newcastle (AU)": [-32.92, 151.78, "AUS", "AU"], "Kashima": [35.92, 140.7, "FE", "JP"], "Gwangyang": [34.9, 127.7, "FE", "KR"], "Rotterdam": [51.95, 4.14, "NEUR", "NL"], "Constanta": [44.17, 28.65, "MED", "RO"], "Alexandria": [31.2, 29.88, "MED", "EG"], "Jeddah": [21.49, 39.17, "RED", "SA"], "Ruwais": [24.13, 52.73, "AG", "AE"], "Jubail": [27, 49.66, "AG", "SA"], "Izmir": [38.44, 27.14, "MED", "TR"], "Lagos (Apapa)": [6.44, 3.38, "WAF", "NG"], "Abidjan": [5.3, -4.02, "WAF", "CI"], "Shanghai": [31.23, 121.49, "FE", "CN"], "Jebel Ali": [25, 55.06, "AG", "AE"], "Dammam": [26.5, 50.2, "AG", "SA"], "Fremantle": [-32.05, 115.74, "AUS", "AU"], "Jakarta (Tanjung Priok)": [-6.1, 106.88, "FE", "ID"], "Ho Chi Minh City": [10.78, 106.7, "FE", "VN"], "Casablanca": [33.6, -7.62, "ATL", "MA"], "Amsterdam": [52.41, 4.82, "NEUR", "NL"], "Lome": [6.13, 1.28, "WAF", "TG"], "Houston": [29.73, -95, "USG", "US"], "Corpus Christi": [27.8, -97.4, "USG", "US"], "Rio de Janeiro": [-22.9, -43.17, "ECSA", "BR"], "Ras Tanura": [26.64, 50.16, "AG", "SA"], "Singapore": [1.26, 103.84, "FE", "SG"], "Brisbane": [-27.38, 153.17, "AUS", "AU"], "Kuwait (Shuaiba)": [29.04, 48.16, "AG", "KW"], "Map Ta Phut": [12.68, 101.15, "FE", "TH"], "Port Klang": [3, 101.39, "FE", "MY"], "Istanbul": [41, 28.98, "MED", "TR"], "Antwerp": [51.26, 4.39, "NEUR", "BE"], "Port Hedland": [-20.31, 118.58, "AUS", "AU"], "Richards Bay": [-28.8, 32.08, "SAF", "ZA"], "Chennai": [13.08, 80.29, "IND", "IN"] };
  const port = (name) => { const p = PORTS[name]; return { name, lat: p[0], lon: p[1], region: p[2], country: p[3] }; };
  const RAD = Math.PI / 180;
  const gcNm = (a, b) => { const la1 = a[0] * RAD, lo1 = a[1] * RAD, la2 = b[0] * RAD, lo2 = b[1] * RAD; const h = Math.sin((la2 - la1) / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin((lo2 - lo1) / 2) ** 2; return 2 * 3440.065 * Math.asin(Math.min(1, Math.sqrt(h))); };
  const bearing = (a, b) => { const la1 = a[0] * RAD, la2 = b[0] * RAD, dl = (b[1] - a[1]) * RAD; const y = Math.sin(dl) * Math.cos(la2), x = Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(dl); return (Math.atan2(y, x) / RAD + 360) % 360; };

  // ---------- trade lanes per vessel class
  const LANES = {
    dry: [
      { c: "Soybeans", load: ["Santos", "Paranagua"], disch: ["Qingdao", "Tianjin", "Dalian"], w: 3, ch: [0, 1, 8] },
      { c: "Corn", load: ["New Orleans", "Mobile"], disch: ["Qingdao", "Busan"], via: "panama", w: 2, ch: [0, 8] },
      { c: "Thermal coal", load: ["Balikpapan"], disch: ["Mundra", "Kandla", "Paradip"], w: 4, ch: [6, 1, 2] },
      { c: "Thermal coal", load: ["Newcastle (AU)"], disch: ["Kashima", "Gwangyang"], w: 3, ch: [2, 1] },
      { c: "Milling wheat", load: ["Constanta"], disch: ["Alexandria", "Jeddah"], w: 2, ch: [0, 8] },
      { c: "Granular urea", load: ["Ruwais", "Jubail"], disch: ["Paradip", "Santos"], w: 2, ch: [4] },
      { c: "Bagged cement", load: ["Izmir"], disch: ["Lagos (Apapa)", "Abidjan"], w: 1, ch: [7] },
      { c: "Hot-rolled steel coils", load: ["Tianjin", "Shanghai"], disch: ["Jebel Ali", "Dammam"], w: 2, ch: [3, 2] },
      { c: "Australian wheat", load: ["Fremantle"], disch: ["Jakarta (Tanjung Priok)", "Ho Chi Minh City"], w: 2, ch: [1, 0] },
      { c: "Iron ore fines", load: ["Port Hedland"], disch: ["Qingdao", "Gwangyang"], w: 2, ch: [3, 2] },
      { c: "Steam coal", load: ["Richards Bay"], disch: ["Chennai", "Mundra"], w: 2, ch: [6, 2] },
      { c: "Phosphate rock", load: ["Casablanca"], disch: ["Paradip"], w: 1, ch: [5] },
    ],
    mr: [
      { c: "Diesel (ULSD 10 ppm)", load: ["Jubail", "Ruwais"], disch: ["Rotterdam", "Antwerp"], w: 2, ch: [9, 10] },
      { c: "Gasoline (EBOB)", load: ["Rotterdam", "Amsterdam"], disch: ["Lagos (Apapa)", "Lome"], w: 3, ch: [11, 9] },
      { c: "Diesel (ULSD)", load: ["Houston", "Corpus Christi"], disch: ["Santos", "Rio de Janeiro"], w: 3, ch: [10, 11] },
      { c: "Jet A-1", load: ["Ras Tanura", "Jubail"], disch: ["Singapore"], w: 2, ch: [9, 10] },
      { c: "Naphtha", load: ["Kandla", "Mundra"], disch: ["Singapore", "Map Ta Phut"], w: 2, ch: [10, 13] },
      { c: "Gasoil 10 ppm", load: ["Singapore"], disch: ["Fremantle", "Brisbane"], w: 3, ch: [13, 9] },
    ],
    afra: [
      { c: "Arab Light crude", load: ["Ras Tanura"], disch: ["Singapore", "Map Ta Phut"], w: 2, ch: [9, 11] },
      { c: "Kuwait Export crude", load: ["Kuwait (Shuaiba)"], disch: ["Map Ta Phut", "Port Klang"], w: 2, ch: [10, 11] },
      { c: "WTI Midland crude", load: ["Corpus Christi", "Houston"], disch: ["Rotterdam", "Antwerp"], w: 3, ch: [11, 9] },
    ],
    chem: [
      { c: "Methanol", load: ["Jubail"], disch: ["Mundra", "Kandla"], w: 3, ch: [12] },
      { c: "Caustic soda solution", load: ["Houston"], disch: ["Santos", "Rio de Janeiro"], w: 2, ch: [12] },
      { c: "Palm olein", load: ["Port Klang"], disch: ["Rotterdam"], w: 2, ch: [12, 11] },
      { c: "Styrene monomer", load: ["Rotterdam", "Antwerp"], disch: ["Houston"], w: 2, ch: [12] },
    ],
  };
  const SEG = { supra: "Supramax / Ultramax 58k TCA", kamsar: "Kamsarmax 82k TCA", mr: "MR product tanker TCE", afra: "Aframax TCE", chem: "Chemical tanker 20k TCE" };
  const SEG_BASE = { [SEG.supra]: 14250, [SEG.kamsar]: 15500, [SEG.mr]: 24500, [SEG.afra]: 39000, [SEG.chem]: 19500 };
  const FLEET = [
    { name: "NORDVIK ARCTURUS", type: "Ultramax", cls: "dry", seg: SEG.supra, dwt: 63520, built: 2018, flag: "MH", owner: 0, ent: 0, home: "Qingdao", speedL: 12.5, speedB: 13, consL: 27, consB: 25, consP: 3.5, qty: [60000, 63000], rate: [22000, 30000], loa: 199.9, beam: 32.24, draft: 13.3, grt: 36500, nrt: 21800, call: "V7XA4" },
    { name: "NORDVIK BOREAS", type: "Supramax", cls: "dry", seg: SEG.supra, dwt: 58100, built: 2014, flag: "PA", owner: 0, ent: 0, home: "Singapore", speedL: 12.5, speedB: 13, consL: 26, consB: 24, consP: 3.5, qty: [54000, 57000], rate: [20000, 28000], loa: 197, beam: 32.26, draft: 12.8, grt: 32800, nrt: 19300, call: "3FBO7" },
    { name: "NORDVIK CASSIOPEIA", type: "Supramax", cls: "dry", seg: SEG.supra, dwt: 57000, built: 2012, flag: "LR", owner: 1, ent: 0, home: "Jebel Ali", speedL: 12.3, speedB: 12.8, consL: 27, consB: 25, consP: 3.5, qty: [53000, 56000], rate: [20000, 27000], loa: 190, beam: 32.26, draft: 12.8, grt: 32300, nrt: 19200, call: "D5CS2", end: "open" },
    { name: "NORDVIK DRACO", type: "Ultramax", cls: "dry", seg: SEG.supra, dwt: 61200, built: 2016, flag: "SG", owner: 1, ent: 0, home: "Santos", speedL: 12.5, speedB: 13, consL: 27, consB: 25, consP: 3.5, qty: [58000, 61000], rate: [22000, 30000], loa: 199.9, beam: 32.24, draft: 13, grt: 34800, nrt: 20900, call: "9V3DR" },
    { name: "NORDVIK ERIDANUS", type: "Kamsarmax", cls: "dry", seg: SEG.kamsar, dwt: 82000, built: 2019, flag: "MT", owner: 2, ent: 0, home: "Newcastle (AU)", speedL: 12.8, speedB: 13.3, consL: 30, consB: 28, consP: 4, qty: [74000, 78000], rate: [25000, 35000], loa: 229, beam: 32.26, draft: 14.5, grt: 44500, nrt: 27800, call: "9HER9" },
    { name: "NORDVIK FORNAX", type: "Kamsarmax", cls: "dry", seg: SEG.kamsar, dwt: 81600, built: 2015, flag: "MH", owner: 2, ent: 0, home: "Paradip", speedL: 12.5, speedB: 13, consL: 31, consB: 29, consP: 4, qty: [73000, 77000], rate: [25000, 35000], loa: 229, beam: 32.25, draft: 14.4, grt: 43900, nrt: 27500, call: "V7FX1", end: "drydock" },
    { name: "NORDVIK GEMINI", type: "Product tanker", cls: "mr", seg: SEG.mr, dwt: 49999, built: 2017, flag: "MH", owner: 3, ent: 1, home: "Rotterdam", speedL: 12.5, speedB: 13, consL: 28, consB: 25, consP: 7, qty: [36000, 40000], loa: 183, beam: 32.2, draft: 13.1, grt: 29800, nrt: 13600, call: "V7GM3" },
    { name: "NORDVIK HYDRA", type: "Product tanker", cls: "mr", seg: SEG.mr, dwt: 50300, built: 2020, flag: "DK", owner: 3, ent: 1, home: "Houston", speedL: 12.8, speedB: 13.2, consL: 26, consB: 24, consP: 7, qty: [36000, 40000], loa: 183, beam: 32.2, draft: 13.2, grt: 29900, nrt: 13700, call: "OXHY2" },
    { name: "NORDVIK ORION", type: "Aframax", cls: "afra", seg: SEG.afra, dwt: 114800, built: 2013, flag: "LR", owner: 3, ent: 0, home: "Ras Tanura", speedL: 13, speedB: 13.5, consL: 42, consB: 38, consP: 12, qty: [95000, 100000], loa: 250, beam: 44, draft: 15.1, grt: 62300, nrt: 33800, call: "D5OR8" },
    { name: "NORDVIK LYRA", type: "Chemical tanker", cls: "chem", seg: SEG.chem, dwt: 19900, built: 2011, flag: "NO", owner: 3, ent: 1, home: "Jubail", speedL: 12.5, speedB: 13, consL: 20, consB: 18, consP: 5, qty: [15000, 18000], loa: 147.8, beam: 24.2, draft: 9.6, grt: 11800, nrt: 5900, call: "LAZL5" },
    // 4.18 · two vessels that exited management during the year — the historic fleet (nothing of theirs is deleted)
    { name: "NORDVIK PHOENIX", type: "Supramax", cls: "dry", seg: SEG.supra, dwt: 56800, built: 2010, flag: "LR", owner: 1, ent: 0, home: "Chennai", speedL: 12.2, speedB: 12.8, consL: 28, consB: 26, consP: 3.5, qty: [52000, 55000], rate: [18000, 26000], loa: 190, beam: 32.26, draft: 12.6, grt: 31700, nrt: 18500, call: "D5PX2", exit: { frac: 0.62, reason: "sold", reasonText: "MOA with Meridian Bulk Carriers, delivered to buyers at Singapore", handedTo: "Meridian Bulk Carriers Pte Ltd", note: "Sold on an as-is basis. Class records and the certificate files handed to buyers' superintendent at delivery. Bunkers on board at delivery settled against the MOA; the last voyage's final DA at Singapore was still awaited at exit and stays on the file." } },
    { name: "NORDVIK VELA", type: "Product tanker", cls: "mr", seg: SEG.mr, dwt: 47400, built: 2012, flag: "DK", owner: 3, ent: 1, home: "Jebel Ali", speedL: 12.4, speedB: 12.9, consL: 27, consB: 24, consP: 7, qty: [34000, 38000], loa: 183, beam: 32.2, draft: 12.9, grt: 29100, nrt: 13200, call: "OXVL7", exit: { frac: 0.8, reason: "transferred", reasonText: "Owners took commercial management in-house", handedTo: "Baltic Tankers AS — in-house chartering desk", note: "Commercial management handed back to owners at their request; technical management was never ours. Open claims: none. SIRE validity and the vetting history forwarded to owners' chartering desk." } },
  ];
  const CPS = {
    owners: [["Aegean Bulk Holdings SA", "GR", "Piraeus"], ["Orient Pacific Shipowners Pte Ltd", "SG", "Singapore"], ["Hellenic Star Shipping Inc", "MH", "Athens"], ["Baltic Tankers AS", "NO", "Oslo"]],
    charterers: [["Westport Grain Trading SA", "CH", "Geneva"], ["Meridian Commodities Pte Ltd", "SG", "Singapore"], ["Atlas Ore & Minerals AG", "CH", "Zug"], ["Pacifica Steel Raw Materials Ltd", "HK", "Hong Kong"], ["Nordic Fertiliser Logistics AB", "SE", "Malmö"], ["Sahara Phosphates Trading SA", "MA", "Casablanca"], ["Indus Coal Marketing Pvt Ltd", "IN", "Mumbai"], ["Bosphorus Cement Exports AS", "TR", "Istanbul"], ["Iberia Agri Trading SL", "ES", "Madrid"], ["Coastline Energy Trading DMCC", "AE", "Dubai"], ["Gulfstream Petroleum Trading FZE", "AE", "Fujairah"], ["Caspian Oil Logistics Ltd", "GB", "London"], ["Lakeview Chemicals Trading BV", "NL", "Rotterdam"], ["Tasman Fuels Pty Ltd", "AU", "Perth"]],
    brokers: [["Clarkwell Shipbrokers Ltd", "GB", "London"], ["Hale & Morrow Chartering AS", "NO", "Oslo"], ["Ocean Axis Brokers Pte Ltd", "SG", "Singapore"], ["Simbel Shipbroking SA", "GR", "Piraeus"]],
    agents: [["Fujairah Marine Agency LLC", "AE", "Fujairah"], ["Straits Port Services Pte Ltd", "SG", "Singapore"], ["Rotterdam Ship Agency BV", "NL", "Rotterdam"], ["Santos Maritime Agentes Ltda", "BR", "Santos"], ["Qingdao Ocean Shipping Agency Co Ltd", "CN", "Qingdao"], ["Houston Gulf Agency Inc", "US", "Houston"]],
    suppliers: [["Seastream Bunkering Pte Ltd", "SG", "Singapore"], ["Gulf Marine Fuels LLC", "AE", "Fujairah"], ["Rhine Delta Bunkers BV", "NL", "Rotterdam"]],
    insurers: [["Northern Mutual P&I Association", "NO", "Bergen"], ["Triton Hull & Machinery Underwriters Ltd", "GB", "London"]],
  };
  const SLOW_PAYER = 3; // Pacifica Steel pays late: the overdue invoices of the year
  const agentFor = (p) => { const r = p.region; if (["AG", "GOO", "RED", "IND", "SAF"].includes(r)) return 0; if (r === "ECSA") return 3; if (["USG", "USEC"].includes(r)) return 5; if (r === "FE" && p.lat > 20) return 4; if (["FE", "AUS"].includes(r)) return 1; return 2; };
  const supplierFor = (p) => (["FE", "AUS"].includes(p.region) ? 0 : ["AG", "GOO", "RED", "IND", "SAF"].includes(p.region) ? 1 : 2);
  const WEATHER = [["Fair, wind NE 3", "slight"], ["Partly cloudy, wind SE 4", "moderate"], ["Overcast, swell 2 m, wind SW 5", "moderate"], ["Rain showers, wind W 6", "rough"], ["Clear, wind N 2", "calm"], ["Fresh breeze, wind NW 5, swell 2.5 m", "rough"]];
  const OFFHIRE_REASONS = ["Main engine breakdown — fuel pump replaced", "Hull cleaning at anchorage", "Crew change deviation", "Auxiliary engine repair", "Port state control detention", "Medical deviation for crew member"];

  function mulberry32(a) { return function () { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  const imoWithCheck = (six) => { const s = String(six); let sum = 0; for (let i = 0; i < 6; i++) sum += +s[i] * (7 - i); return s + (sum % 10); };

  // ============================================================== the generator
  function build(opt) {
    opt = opt || {}; const E = opt.E || eng(); const P = opt.PSE || pse(); if (!E || !P) throw new Error("The engines are not loaded");
    const store = opt.store; if (!store) throw new Error("A book store is required");
    const ps = opt.ps || {}; for (const k of ["vessels", "fixtures", "offhire", "voyages", "laytime", "claims", "marketRates", "strategies", "compliance", "reports", "lists", "voyageTasks", "noonReports", "das", "bunkerLog", "hireStatements", "addenda"]) if (!Array.isArray(ps[k])) ps[k] = [];
    if (!ps.portal || typeof ps.portal !== "object") ps.portal = { customers: [] }; if (!Array.isArray(ps.portal.customers)) ps.portal.customers = [];
    const today = opt.today || E.today(); const todayMs = msOf(today);
    const nowMs = Math.max(todayMs, Math.min(todayMs + DAY - MIN, opt.now ? msOf(opt.now) : Date.now()));
    const startMs = msOf(startOf(today)); const start = day(startMs);
    const rng = mulberry32(opt.seed || 20251101); const rnd = (a, b) => a + (b - a) * rng(); const ri = (a, b) => Math.floor(rnd(a, b + 1)); const chance = (p) => rng() < p; const pick = (a) => a[Math.floor(rng() * a.length)];
    let seq = 0; const pid = (p) => "xd" + p + "-" + (++seq).toString(36);
    const tagPs = (o) => Object.assign(o, { demo: true, demoSet: TAG });
    const before = {}; for (const k of Object.keys(store)) if (Array.isArray(store[k])) before[k] = new Set(store[k]);
    const savedLock = store.settings ? store.settings.lockedThrough : undefined; if (store.settings && savedLock && savedLock >= start) store.settings.lockedThrough = "";
    const I = { __internal: true };
    // market levels: a smooth monthly path per segment, from the start to two months ahead
    const months = []; for (let m = new Date(startMs); m.getTime() <= todayMs + 62 * DAY; m = new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + 1, 1))) months.push(m.getUTCFullYear() + "-" + pad(m.getUTCMonth() + 1));
    const market = {}; for (const seg of Object.values(SEG)) { let lvl = SEG_BASE[seg]; market[seg] = {}; months.forEach((ym, i) => { lvl = lvl * (1 + rnd(-0.07, 0.075)) + (SEG_BASE[seg] - lvl) * 0.18 + SEG_BASE[seg] * 0.06 * Math.sin(i / 1.7); market[seg][ym] = Math.round(lvl / 50) * 50; }); }
    const mkt = (seg, ms) => market[seg][day(ms).slice(0, 7)] || SEG_BASE[seg];
    const fuel = (ms, grade) => { const i = (ms - startMs) / (30 * DAY); return Math.round((grade === "LSMGO" ? 760 : 585) + 32 * Math.sin(i / 1.9) + 14 * Math.cos(i * 1.3)); };
    const usdDkk = (ms) => Math.round((6.88 + 0.13 * Math.sin((ms - startMs) / (45 * DAY))) * 10000) / 10000;
    const out = { fixtures: 0, voyages: 0, invoices: 0, bills: 0, noon: 0 };
    try {
      // ---------- the company
      const ents = [
        E.addEntity(store, { name: "Nordvik Ship Management DMCC", country: "AE", currency: "USD", created: start, address: "Unit 2104, Jumeirah Lakes Towers, Cluster X, Dubai, United Arab Emirates", trn: "100512345600003", phone: "+971 4 555 0142", email: "accounts@nordvik-demo.example", docPrefix: "NSM-", signatory: "Operations Director", docFooter: "Demo company — fictional data", bankDetails: "Emirates NBD · USD · AE07 0260 0010 1234 5678 901 · SWIFT EBILAEAD" }),
        E.addEntity(store, { name: "Nordvik Chartering ApS", country: "DK", currency: "DKK", created: start, address: "Amaliegade 31, 1256 København K, Denmark", trn: "DK41234567", phone: "+45 33 12 40 55", email: "finance@nordvik-demo.example", docPrefix: "NCH-", signatory: "Managing Director", docFooter: "Demo company — fictional data", bankDetails: "Danske Bank · USD · DK50 3000 0012 3456 78 · SWIFT DABADKKK" }),
      ];
      const banks = [
        E.addBank(store, { entityId: ents[0].id, bank: "Emirates NBD", label: "ENBD USD", currency: "USD", iban: "AE070260001012345678901", swift: "EBILAEAD", accountName: ents[0].name }),
        E.addBank(store, { entityId: ents[0].id, bank: "Emirates NBD", label: "ENBD AED", currency: "AED", fx: 0.2723, iban: "AE330260001012345678902", swift: "EBILAEAD", accountName: ents[0].name }),
        E.addBank(store, { entityId: ents[1].id, bank: "Danske Bank", label: "Danske USD", currency: "USD", fx: 6.9, iban: "DK5030000012345678", swift: "DABADKKK", accountName: ents[1].name }),
        E.addBank(store, { entityId: ents[1].id, bank: "Danske Bank", label: "Danske DKK", currency: "DKK", iban: "DK2130000012345690", swift: "DABADKKK", accountName: ents[1].name }),
      ];
      const usdBank = (ei) => (ei === 0 ? banks[0] : banks[2]);
      for (const [b, amt] of [[banks[0], 4500000], [banks[1], 750000], [banks[2], 2200000], [banks[3], 3000000]]) E.fundBank(store, { bankId: b.id, amount: amt, date: start, memo: "Share capital and shareholder loan — " + b.label });
      const mk = (list, role, terms, extra) => list.map((c, i) => E.addCounterparty(store, Object.assign({ name: c[0], short: c[0].split(" ")[0], role, country: c[1], city: c[2], terms, created: start, email: "ops@" + c[0].toLowerCase().replace(/[^a-z]+/g, "").slice(0, 14) + ".example", contact: "Operations desk" }, extra ? extra(i) : {})));
      const owners = mk(CPS.owners, "owner", 15), charterers = mk(CPS.charterers, "charterer", 5, (i) => ({ creditLimit: i === SLOW_PAYER ? 1200000 : 2500000 })), brokers = mk(CPS.brokers, "broker", 30), agents = mk(CPS.agents, "agent", 21), suppliers = mk(CPS.suppliers, "supplier", 30), insurers = mk(CPS.insurers, "supplier", 30);
      // ---------- the fleet
      const fleet = FLEET.map((f, i) => {
        const v = E.addVessel(store, { name: f.name, imo: imoWithCheck(990110 + i * 37), type: f.type, flag: f.flag, dwt: f.dwt, built: f.built, notes: "Demo vessel" });
        E.linkVessel(store, owners[f.owner].id, v.id);
        ps.vessels.push(tagPs({ id: v.id, imo: v.imo, mmsi: String(999100100 + i * 1013), callSign: f.call, name: f.name, type: f.type, flag: f.flag, dwt: f.dwt, grt: f.grt, nrt: f.nrt, built: f.built, loa: f.loa, beam: f.beam, draft: f.draft, speedLaden: f.speedL, speedBallast: f.speedB, consLaden: f.consL, consBallast: f.consB, consPort: f.consP, grades: ["VLSFO", "LSMGO"], ownerCpId: owners[f.owner].id, managerEntityId: ents[f.ent].id, management: "charter-in", status: f.end === "drydock" ? "drydock" : f.end === "open" ? "idle" : "trading", onboarded: start, offboarded: null, notes: "", docIds: [] }));
        return Object.assign({}, f, { v, ent: ents[f.ent], entIdx: f.ent, owner: owners[f.owner] });
      });

      // ---------- voyages, fixtures, noon reports and bunkers, vessel by vessel, in time order
      const routeOf = (a, b, via) => { const r = P.routeLine({ lat: a.lat, lon: a.lon, region: a.region }, { lat: b.lat, lon: b.lon, region: b.region }, via); const line = r.line && r.line.length ? r.line : [[a.lat, a.lon], [b.lat, b.lon]]; const cum = [0]; for (let i = 1; i < line.length; i++) cum.push(cum[i - 1] + gcNm(line[i - 1], line[i])); return { nm: Math.round(r.nm || cum[cum.length - 1]), via: r.via || via || "direct", line, cum }; };
      const at = (rt, frac) => { const target = frac * rt.cum[rt.cum.length - 1]; let i = 1; while (i < rt.cum.length - 1 && rt.cum[i] < target) i++; const seg = rt.cum[i] - rt.cum[i - 1] || 1; const f = Math.max(0, Math.min(1, (target - rt.cum[i - 1]) / seg)); const a = rt.line[i - 1], b = rt.line[i]; let lon = a[1] + (b[1] - a[1]) * f; lon = ((lon + 540) % 360) - 180; return { lat: a[0] + (b[0] - a[0]) * f, lon, cog: Math.round(bearing(a, b)) }; };
      // about 84 fixtures over the year, shared by class (product tankers run shorter voyages): a vessel ahead of that pace waits for employment
      const W = { dry: 1, mr: 1.3, afra: 0.95, chem: 1.05 }; const FX_TARGET = 84; let made = 0; const laneMk = new Set();
      for (const vs of fleet) {
        const restW = fleet.slice(fleet.indexOf(vs)).reduce((k, x) => k + (W[x.cls] || 1), 0); const per = (FX_TARGET - made) * (W[vs.cls] || 1) / restW;
        const rob = { VLSFO: Math.round(vs.consL * 22 / 10) * 10, LSMGO: 120 };
        ps.bunkerLog.push(tagPs({ id: pid("bl"), vesselId: vs.v.id, voyageId: null, at: iso(startMs), kind: "receipt", grade: "VLSFO", qty: rob.VLSFO, price: fuel(startMs, "VLSFO"), currency: "USD", port: vs.home, notes: "Opening stock on joining the fleet" }), tagPs({ id: pid("bl"), vesselId: vs.v.id, voyageId: null, at: iso(startMs), kind: "receipt", grade: "LSMGO", qty: rob.LSMGO, price: fuel(startMs, "LSMGO"), currency: "USD", port: vs.home, notes: "Opening stock on joining the fleet" }));
        let t = startMs + ri(0, 8) * DAY + 6 * HOUR, here = port(vs.home), vno = 0, lastNoon = null; const vf = [];
        // 4.18 · a vessel that exits during the year: everything of hers stops at the exit day
        const limitMs = vs.exit ? startMs + vs.exit.frac * (nowMs - startMs) : nowMs; vs.exitMs = vs.exit ? limitMs : null;
        const noonLeg = (vy, rt, dep, arr, laden, toName) => { const speed = laden ? vs.speedL : vs.speedB, cons = laden ? vs.consL : vs.consB; let d0 = Math.floor(dep / DAY) * DAY + 12 * HOUR; if (d0 <= dep) d0 += DAY; const recent = nowMs - 30 * DAY; let prev = dep; for (let t2 = d0; t2 < arr && t2 <= nowMs; t2 += DAY) { const daily = t2 >= recent; const k = Math.round((t2 - d0) / DAY); if (!daily && k % 4 !== 0) continue; const hrs = (t2 - prev) / HOUR; const cV = r2(cons * hrs / 24 * rnd(0.95, 1.07)), cG = r2(0.3 * hrs / 24); rob.VLSFO = Math.max(40, r2(rob.VLSFO - cV)); rob.LSMGO = Math.max(15, r2(rob.LSMGO - cG)); const p = at(rt, (t2 - dep) / (arr - dep)); const w = pick(WEATHER); const sog = r2(speed * rnd(0.94, 1.04)); ps.noonReports.push(tagPs({ id: pid("n"), vesselId: vs.v.id, voyageId: vy.id, at: iso(t2), lat: Math.round(p.lat * 1e4) / 1e4, lon: Math.round(p.lon * 1e4) / 1e4, cog: p.cog, sog, distance: Math.round(sog * hrs), hoursSteaming: Math.round(hrs * 10) / 10, rob: { VLSFO: rob.VLSFO, LSMGO: rob.LSMGO }, cons: { VLSFO: cV, LSMGO: cG }, weather: w[0], seaState: w[1], eta: iso(arr), nextPort: toName, remarks: laden ? "Laden passage" : "Ballast passage", by: "Master" })); out.noon++; lastNoon = t2; prev = t2; } const restHrs = (Math.min(arr, nowMs) - prev) / HOUR; if (restHrs > 0) { rob.VLSFO = Math.max(40, r2(rob.VLSFO - cons * restHrs / 24)); rob.LSMGO = Math.max(15, r2(rob.LSMGO - 0.3 * restHrs / 24)); } };
        const portStay = (hrs) => { rob.LSMGO = Math.max(15, r2(rob.LSMGO - 2.5 * hrs / 24)); rob.VLSFO = Math.max(40, r2(rob.VLSFO - vs.consP * 0.3 * hrs / 24)); };
        // an employed vessel (no planned end state) must be under a fixture TODAY whatever the calendar says: when her chain would
        // leave her idle into today, the next fixture starts right after the last one so that it spans now (4.17.1)
        const employedNow = () => vf.length && vf[vf.length - 1].end >= nowMs;
        while (true) {
          if (vs.exit) { if (t >= limitMs - 2 * DAY) break; } else if (vs.end) { if (t >= nowMs - 2 * DAY) break; } else if (employedNow()) break; else if (t >= nowMs - 2 * DAY) { t = (vf.length ? vf[vf.length - 1].end : t) + rnd(0.5, 1.5) * DAY; if (t > nowMs - 6 * HOUR) t = nowMs - rnd(1, 3) * DAY; }
          if (!vs.exit && made + vno >= FX_TARGET + 2 && (vs.end || employedNow())) break;
          if (!vs.exit && vno >= per * Math.max(0, (t - startMs) / (nowMs - startMs)) + 0.8 && (vs.end || t < nowMs - 30 * DAY)) { t += rnd(3, 8) * DAY; continue; }
          const voyageKind = chance(vs.cls === "dry" ? 0.42 : vs.cls === "afra" ? 0.72 : 0.6) ? "voyage" : "tc";
          const lanes = LANES[vs.cls]; const scored = lanes.map((l) => ({ l, s: l.w / (1 + gcNm([here.lat, here.lon], [port(l.load[0]).lat, port(l.load[0]).lon]) / 2500) })); let tot = scored.reduce((k, x) => k + x.s, 0), x = rng() * tot, lane = scored[0].l; for (const s of scored) { x -= s.s; if (x <= 0) { lane = s.l; break; } }
          const load = port(pick(lane.load)); let disch = port(pick(lane.disch)); if (disch.name === load.name) disch = port(lane.disch.find((n) => n !== load.name) || lane.disch[0]);
          const qty = vs.cls === "afra" ? 100000 : vs.cls === "mr" ? Math.round(rnd(vs.qty[0], vs.qty[1]) / 500) * 500 : Math.round(rnd(vs.qty[0], vs.qty[1]) / 100) * 100;
          const charterer = charterers[pick(lane.ch)], broker = brokers[ri(0, brokers.length - 1)];
          const delAt = voyageKind === "tc" ? t + ri(2, 14) * HOUR : t;
          const ballast = load.name === here.name ? null : routeOf(here, load); const dB = ballast ? ballast.nm / (vs.speedB * 24) * rnd(1.0, 1.06) : 0.25;
          const ataL = delAt + dB * DAY; const waitL = rnd(6, 72) * HOUR; const commL = ataL + waitL;
          const tank = vs.cls !== "dry"; const rateTerms = tank ? 0 : rnd(vs.rate[0], vs.rate[1]);
          const loadH = tank ? rnd(18, 34) : qty / (rateTerms * rnd(0.72, 1.25)) * 24; const complL = commL + loadH * HOUR; const atdL = complL + rnd(2, 8) * HOUR;
          const laden = routeOf(load, disch, lane.via); const dL = laden.nm / (vs.speedL * 24) * rnd(1.0, 1.05);
          const ataD = atdL + dL * DAY; const waitD = rnd(6, 84) * HOUR; const commD = ataD + waitD; const dischH = tank ? rnd(20, 40) : qty / (rnd(vs.rate[0], vs.rate[1]) * rnd(0.7, 1.2)) * 24; const complD = commD + dischH * HOUR; const atdD = complD + rnd(2, 6) * HOUR;
          const end = atdD; const cpMs = delAt - ri(5, 16) * DAY;
          if (vs.exit && end > limitMs - 2 * DAY) break;
          if (vs.end === "open" && end > nowMs - 4 * DAY) break;
          if (vs.end === "drydock" && end > nowMs - 24 * DAY) break;
          if (delAt > nowMs) break;
          vno++; const seg = vs.seg; const m = mkt(seg, cpMs);
          const vy = tagPs({ id: pid("vy"), vesselId: vs.v.id, fixtureId: null, no: String(vno).padStart(3, "0"), status: end <= nowMs ? "completed" : "sailing", ports: [], legs: [], bunkers: { rob: [], prices: { VLSFO: fuel(cpMs, "VLSFO"), LSMGO: fuel(cpMs, "LSMGO") }, consumption: [] }, costs: [], revenue: {}, from: iso(delAt), to: iso(end), cargoQty: qty, commodity: lane.c });
          const pp = (p, act, a, nor, c0, c1, d) => { const o = { id: pid("p"), name: p.name, lat: p.lat, lon: p.lon, activity: act, eta: iso(a), etd: iso(d), ata: a <= nowMs ? iso(a) : null, atd: d <= nowMs ? iso(d) : null, agentCpId: agents[agentFor(p)].id, notes: "" }; if (nor) { if (nor <= nowMs) o.nor = iso(nor); if (c0 <= nowMs) o.commenced = iso(c0); if (c1 <= nowMs) o.completed = iso(c1); o.cargoQty = qty; o.berth = act === "load" ? "Loading berth " + ri(1, 9) : "Discharge berth " + ri(1, 12); } return o; };
          if (voyageKind === "tc") vy.ports.push(pp(here, "delivery", delAt - 2 * HOUR, null, 0, 0, delAt));
          const pL = pp(load, "load", ataL, ataL + HOUR, commL, complL, atdL), pD = pp(disch, "discharge", ataD, ataD + HOUR, commD, complD, atdD); vy.ports.push(pL, pD);
          if (voyageKind === "tc") vy.legs.push({ fromPortId: vy.ports[0].id, toPortId: pL.id, distanceNm: ballast ? ballast.nm : 0, speed: vs.speedB, days: Math.round(dB * 100) / 100, routeVia: ballast ? ballast.via : "direct", laden: false });
          vy.legs.push({ fromPortId: pL.id, toPortId: pD.id, distanceNm: laden.nm, speed: vs.speedL, days: Math.round(dL * 100) / 100, routeVia: laden.via, laden: true });
          if (voyageKind === "voyage" && ballast) Object.assign(vy, { ballastFrom: here.name, ballastNm: ballast.nm });
          // fuel: the ballast leg, the stem at the load port, the laden leg, the port stays
          const robAtDel = { VLSFO: rob.VLSFO, LSMGO: rob.LSMGO };
          if (ballast) noonLeg(vy, ballast, delAt, ataL, false, load.name);
          portStay((atdL - ataL) / HOUR);
          const needLaden = vs.consL * dL * 1.1 + vs.consB * 12 + 150; let stem = null;
          if (rob.VLSFO < needLaden && ataL + 12 * HOUR <= nowMs) { const q = Math.ceil((needLaden - rob.VLSFO + 250) / 50) * 50; const stAt = ataL + 12 * HOUR; stem = tagPs({ id: pid("bl"), vesselId: vs.v.id, voyageId: vy.id, at: iso(stAt), deliveredAt: iso(stAt + 5 * HOUR), kind: "stem", status: "delivered", grade: "VLSFO", qty: q, price: fuel(stAt, "VLSFO") + ri(-8, 14), currency: "USD", port: load.name, supplierCpId: suppliers[supplierFor(load)].id, billId: null, bdn: "BDN-" + (240000 + ps.bunkerLog.length * 7), charterers: voyageKind === "tc", notes: voyageKind === "tc" ? "Charterers' stem (for their account)" : "" }); ps.bunkerLog.push(stem); rob.VLSFO = r2(rob.VLSFO + q); }
          if (rob.LSMGO < 90 && ataL + 13 * HOUR <= nowMs) { const stAt = ataL + 13 * HOUR; ps.bunkerLog.push(tagPs({ id: pid("bl"), vesselId: vs.v.id, voyageId: vy.id, at: iso(stAt), deliveredAt: iso(stAt + 3 * HOUR), kind: "stem", status: "delivered", grade: "LSMGO", qty: 150, price: fuel(stAt, "LSMGO"), currency: "USD", port: load.name, supplierCpId: suppliers[supplierFor(load)].id, billId: null, bdn: "BDN-" + (250000 + ps.bunkerLog.length * 7), charterers: voyageKind === "tc", notes: "" })); rob.LSMGO = r2(rob.LSMGO + 150); }
          const robDel = robAtDel;
          noonLeg(vy, laden, atdL, ataD, true, disch.name); portStay((Math.min(atdD, nowMs) - ataD) / HOUR);
          // the fixture
          const fx = tagPs({ id: pid("fx"), vesselId: vs.v.id, kind: voyageKind, chartererCpId: charterer.id, brokerCpId: broker.id, cpDate: day(cpMs), cpForm: voyageKind === "tc" ? (tank ? "SHELLTIME 4" : "NYPE 2015") : (tank ? "ASBATANKVOY" : "GENCON 94"), delivery: { at: iso(delAt), port: here.name, lat: here.lat, lon: here.lon }, redelivery: { at: iso(end), port: disch.name, lat: disch.lat, lon: disch.lon, estimated: end > nowMs }, currency: "USD", addressCommission: tank ? 2.5 : 3.75, brokerage: 1.25, status: end <= nowMs ? "redelivered" : "delivered", marketSegment: seg, notes: "", docIds: [], warranties: { speedLaden: vs.speedL, speedBallast: vs.speedB, consLaden: vs.consL, consBallast: vs.consB, consPort: vs.consP, grade: "VLSFO" }, subs: { deadline: iso(cpMs + 17 * HOUR), lifted: iso(cpMs + 15 * HOUR) } });
          const days = (end - delAt) / DAY; const bunkerCost = (vs.consB * dB + vs.consL * dL) * fuel(cpMs, "VLSFO") + 2.5 * ((atdL - ataL) + (atdD - ataD)) / DAY * fuel(cpMs, "LSMGO");
          const pdaL = Math.round(rnd(tank ? 28000 : 38000, tank ? 70000 : 95000) / 500) * 500, pdaD = Math.round(rnd(tank ? 25000 : 32000, tank ? 65000 : 85000) / 500) * 500;
          const viaCanal = [laden.via, ballast && ballast.via].find((v) => v === "suez" || v === "panama") || null; const canalCost = viaCanal === "suez" ? Math.round(vs.dwt * rnd(3.4, 4.2) / 500) * 500 : viaCanal === "panama" ? Math.round(vs.dwt * rnd(2.0, 2.6) / 500) * 500 : 0;
          if (voyageKind === "tc") {
            Object.assign(fx, { rate: Math.round(m * rnd(0.93, 1.1) / 250) * 250, rateUnit: "day", hireInterval: 15, hireInAdvance: true, cve: tank ? 0 : 1500, minDays: Math.max(15, Math.floor(days) - 5), maxDays: Math.ceil(days) + 10, ballastBonus: dB > 12 && chance(0.55) ? Math.round(m * dB * 0.45 / 5000) * 5000 : 0, bunkers: { delivery: [{ grade: "VLSFO", qty: Math.round(robDel.VLSFO), price: fuel(delAt, "VLSFO") }, { grade: "LSMGO", qty: Math.round(robDel.LSMGO), price: fuel(delAt, "LSMGO") }], redelivery: end <= nowMs ? [{ grade: "VLSFO", qty: Math.round(rob.VLSFO), price: fuel(delAt, "VLSFO") }, { grade: "LSMGO", qty: Math.round(rob.LSMGO), price: fuel(delAt, "LSMGO") }] : [] }, bunkerClause: "Bunkers on delivery and redelivery at the same price; about the quantities on board" });
            fx.notes = "Fixed " + vs.name + " / " + charterer.name + " · delivery " + here.name + " · TCT " + lane.c + " " + load.name + " – " + disch.name + " · redelivery " + disch.name + " · USD " + fx.rate.toLocaleString("en-US") + "/day · " + fx.addressCommission + "% address + 1.25% to " + broker.short;
          } else {
            const rev = (m * days * rnd(0.92, 1.1) + bunkerCost + pdaL + pdaD + canalCost) / 0.95; const rate = Math.ceil(rev / qty * 4) / 4;
            const demRate = Math.round(m * rnd(0.95, 1.1) / 250) * 250;
            // the freight market of the route (USD/MT): what the trade paid that month
            const segV = load.region + "–" + disch.region + " " + lane.c.toLowerCase() + " (USD/MT)"; fx.marketSegment = segV; const ym = day(cpMs).slice(0, 7);
            if (!laneMk.has(segV + ym)) { laneMk.add(segV + ym); ps.marketRates.push(tagPs({ id: pid("mr"), date: ym + "-01", segment: segV, rate: Math.round((m * days + bunkerCost + pdaL + pdaD + canalCost) / 0.95 / qty * 4) / 4, unit: "mt", currency: "USD", source: "Demo freight assessment (fictional)" })); }
            Object.assign(fx, { rate, rateUnit: "mt", cargo: { commodity: lane.c, qty, unit: "MT", loadPorts: [load.name], dischargePorts: [disch.name], laycan: { from: day(ataL - 2 * DAY), to: day(ataL + 3 * DAY) }, laytimeHours: tank ? 72 : Math.round(qty / rateTerms * 24), terms: tank ? "72 hours SHINC reversible" : "SHINC", demurrageRate: demRate, despatchRate: tank ? 0 : Math.round(demRate / 2), reversible: tank } });
            fx.notes = "Fixed " + vs.name + " / " + charterer.name + " · " + qty.toLocaleString("en-US") + " MT " + lane.c + " " + load.name + " – " + disch.name + " · laycan " + fx.cargo.laycan.from + "/" + fx.cargo.laycan.to + " · USD " + rate + "/MT · dem USD " + demRate.toLocaleString("en-US") + "/day pro rata · " + fx.addressCommission + "% address + 1.25% to " + broker.short;
            vy.costs.push({ kind: "port", label: "Port DA " + load.name, amount: pdaL, currency: "USD", cpId: pL.agentCpId }, { kind: "port", label: "Port DA " + disch.name, amount: pdaD, currency: "USD", cpId: pD.agentCpId }, { kind: "bunkers", label: "Bunkers (estimate)", amount: Math.round(bunkerCost), currency: "USD" });
            if (canalCost) vy.costs.push({ kind: "canal", label: (viaCanal === "suez" ? "Suez" : "Panama") + " Canal transit", amount: canalCost, currency: "USD" });
            vy.revenue = { freight: r2(rate * qty), demurrage: 0, other: 0 };
          }
          vy.fixtureId = fx.id; ps.fixtures.push(fx); ps.voyages.push(vy); vf.push({ fx, vy, pL, pD, load, disch, stem, viaCanal, canalCost, pdaL, pdaD, ataL, commL, complL, atdL, ataD, commD, complD, atdD, delAt, end, rateTerms, qty, tank, lane });
          out.fixtures++; out.voyages++;
          here = disch; t = end + (chance(0.4) ? rnd(5, 14) : rnd(0.5, 4)) * DAY;
        }
        // off-hires on past time charters (about one in five), one recent
        for (const w of vf.filter((x) => x.fx.kind === "tc" && x.end - x.delAt > 18 * DAY)) {
          const recentOne = w.end > nowMs && !ps.offhire.some((o) => o.recent); if (!(recentOne || chance(0.22))) continue;
          const s0 = recentOne ? Math.min(nowMs - 3 * DAY, w.delAt + (w.end - w.delAt) * 0.6) : w.delAt + (w.end - w.delAt) * rnd(0.2, 0.8); if (s0 <= w.delAt + DAY || s0 > nowMs - DAY) continue;
          const hrs = Math.round(rnd(6, 58)); const reason = pick(OFFHIRE_REASONS); const kind = P.offhireKind ? P.offhireKind({ reason }) : "technical"; // 4.31.11 · the demo's off-hire carries its kind, read the way an older row's is (breakdown, repair, detention, crew → technical; hull cleaning → commercial)
          ps.offhire.push(tagPs({ id: pid("oh"), vesselId: vs.v.id, fixtureId: w.fx.id, from: iso(s0), to: iso(s0 + hrs * HOUR), reason, kind, deductible: true, bunkers: [{ grade: "VLSFO", qty: r2(vs.consP * hrs / 24 + 2), price: fuel(s0, "VLSFO") }], notes: "Statement of facts from the master; agreed with charterers", recent: recentOne || undefined }));
        }
        made += vf.length; vs.fixtures = vf; vs.lastEnd = vf.length ? vf[vf.length - 1].end : startMs; vs.lastPort = here;
        // 4.18 · she leaves a few days after her last redelivery (never later than the planned exit day)
        if (vs.exit) vs.exitMs = Math.min(limitMs, vs.lastEnd + rnd(4, 12) * DAY);
      }
      for (const o of ps.offhire) delete o.recent;

      // ---------- the year in the books: hire, freight and demurrage invoices, costs, receipts and payments
      const fxOf = (vs, ms) => (vs.entIdx === 0 ? 1 : usdDkk(ms));
      const lineOf = (l) => ({ kind: "service", description: l.description, qty: l.qty, unit: l.unit, price: Math.abs(l.price) });
      // a rate at which the line-by-line base amounts add up to the invoice's base amount (the engine posts both, rounded)
      const safeFx = (lines, fx) => { if (fx === 1) return 1; const nets = lines.map((l) => r2(l.qty * l.price)); const rev = r2(nets.reduce((k, n) => k + n, 0)); for (let i = 0; i < 400; i++) { const f = Math.round((fx + (i % 2 ? 1 : -1) * Math.ceil(i / 2) * 0.0001) * 10000) / 10000; const parts = r2(nets.reduce((k, n) => k + r2(n * f), 0)); if (Math.abs(parts - r2(rev * f)) < 0.004) return f; } return fx; };
      const inv = (vs, w, dMs, lines, meta, terms) => { const dd = day(Math.min(dMs, nowMs)); const L = lines.map(lineOf); const t = E.addTrade(store, { entityId: vs.ent.id, customerId: w.fx.chartererCpId, vesselId: vs.v.id, date: dd, deliveryDate: dd, terms, currency: "USD", fx: safeFx(L, fxOf(vs, dMs)),vatRate: 0, vatKind: "zero", lines: L, fixtureId: w.fx.id, voyageId: w.vy.id, meta: Object.assign({ vesselId: vs.v.id, voyageId: w.vy.id }, meta), port: w.disch.name, delivered: true }); out.invoices++; return store.invoices.find((i) => i.tradeId === t.id); };
      const bill = (vs, dMs, cp, category, amount, memo, extra) => { const b = E.expense(store, Object.assign({ entityId: vs ? vs.ent.id : extra.entityId, category, amount: r2(amount), vatRate: 0, counterpartyId: cp ? cp.id : null, date: day(dMs), currency: "USD", fx: vs ? fxOf(vs, dMs) : 1, vesselId: vs ? vs.v.id : null, memo }, extra || {})); out.bills++; return b.bill; };
      const payQueue = [], receiveQueue = [];
      let partPaid = 0, slowLeft = 0;
      for (const vs of fleet) {
        const vName = vs.name; let skippedBacklog = false;
        for (const w of vs.fixtures) {
          const f = w.fx, offs = ps.offhire.filter((o) => o.fixtureId === f.id); let invoicedGross = 0;
          if (f.kind === "tc") {
            const pers = P.periods(f, iso(nowMs), { noLookahead: true });
            for (const p of pers) {
              const fromMs = msOf(p.from); if (fromMs > nowMs) break;
              if (!skippedBacklog && w.end > nowMs && fromMs > nowMs - 4 * DAY && vs.entIdx === 0) { skippedBacklog = true; continue; } // one statement still to raise
              const h = P.hire(f, offs, p.from, p.to, { vesselName: vName }); if (!(h.net > 0)) continue;
              const i = inv(vs, w, fromMs, h.lines, { kind: "hire", period: { from: h.from, to: h.to }, periodNo: p.no }, 3); invoicedGross += h.hireNet + h.cve + h.ballastBonus;
              receiveQueue.push({ vs, i, slow: f.chartererCpId === charterers[SLOW_PAYER].id });
            }
          } else {
            if (w.complL <= nowMs) { const fr = P.freight(f, w.vy, { vesselName: vName }); const i = inv(vs, w, w.complL + 6 * HOUR, fr.lines, { kind: "freight" }, 5); invoicedGross += fr.freight; receiveQueue.push({ vs, i, slow: f.chartererCpId === charterers[SLOW_PAYER].id }); }
            // laytime at both ends
            const lts = [];
            for (const [pt, nor, c0, c1] of [[w.pL, w.ataL + HOUR, w.commL, w.complL], [w.pD, w.ataD + HOUR, w.commD, w.complD]]) {
              if (c1 > nowMs) continue; const events = [{ from: iso(c0), to: iso(c1), desc: pt.activity === "load" ? "Loading" : "Discharging", counts: true, pct: 100 }];
              if (!w.tank && chance(0.3)) { const s = c0 + (c1 - c0) * rnd(0.2, 0.7), e = Math.min(c1, s + rnd(3, 14) * HOUR); events[0].to = iso(s); events.push({ from: iso(s), to: iso(e), desc: "Rain — hatches closed", counts: false, pct: 0 }); if (e < c1) events.push({ from: iso(e), to: iso(c1), desc: pt.activity === "load" ? "Loading resumed" : "Discharging resumed", counts: true, pct: 100 }); }
              const calc = { id: pid("lt"), voyageId: w.vy.id, portId: pt.id, port: pt.name, norTendered: iso(nor), commenced: iso(c0), completed: iso(c1), allowedHours: w.tank ? 36 : Math.round(w.qty / w.rateTerms * 24 * 10) / 10, events, reversible: w.tank };
              calc.result = P.laytime(calc, f); calc.updated = iso(c1 + 2 * DAY); lts.push(tagPs(calc)); ps.laytime.push(calc);
            }
            const dem = lts.reduce((k, l) => k + (l.result.kind === "demurrage" ? l.result.amount : 0), 0);
            if (dem > 500) {
              w.vy.revenue.demurrage = r2(dem); const raised = w.atdD + 18 * DAY;
              const claim = tagPs({ id: pid("cl"), vesselId: vs.v.id, fixtureId: f.id, voyageId: w.vy.id, kind: "demurrage", againstCpId: f.chartererCpId, amount: r2(dem), currency: "USD", status: "open", date: day(Math.min(raised, nowMs)), notes: "Laytime statement with SOFs and NORs sent to charterers", docIds: [] });
              if (raised <= nowMs) {
                const disputed = !ps.claims.some((c) => c.disputed) && raised > nowMs - 70 * DAY && chance(0.5);
                if (disputed) { claim.disputed = true; claim.notes = "Charterers dispute " + Math.round(lts[lts.length - 1].result.demurrageHours / 3) + " hours at " + w.disch.name + " (weather and shifting); our reply with the port log sent"; }
                else { const fr = P.freight(f, w.vy, { laytime: lts }); const dl = fr.lines.filter((l) => l.kind === "demurrage"); const ac = r2(dem * f.addressCommission / 100); dl.push({ kind: "address-commission", description: "Address commission " + f.addressCommission + "% on demurrage " + P.fmtMoney(dem, "USD"), qty: -1, unit: "each", price: ac, amount: -ac }); const i = inv(vs, w, raised, dl, { kind: "demurrage" }, 30); claim.invoiceId = i.id; claim.status = "invoiced"; receiveQueue.push({ vs, i, slow: true, claim }); invoicedGross += dem; }
              } else claim.status = "open";
              ps.claims.push(claim);
            }
            // port disbursements: the advance before arrival, the final account after sailing
            for (const [pt, ata, atd, pda] of [[w.pL, w.ataL, w.atdL, w.pdaL], [w.pD, w.ataD, w.atdD, w.pdaD]]) {
              if (ata - 5 * DAY > nowMs) continue; const agent = agents.find((a) => a.id === pt.agentCpId);
              const da = tagPs({ id: pid("da"), vesselId: vs.v.id, voyageId: w.vy.id, portId: pt.id, port: pt.name, agentCpId: agent.id, currency: "USD", pda, fda: null, pdaBillId: null, fdaBillId: null, pdaPaidAt: null, fdaReceivedAt: null, pdaDate: iso(Math.max(startMs, ata - 5 * DAY)), status: "requested", notes: "" });
              if (ata - 3 * DAY <= nowMs) { const bAt = Math.max(startMs, ata - 3 * DAY); const b = bill(vs, bAt, agent, "Port DA", pda, "PDA " + pt.name + " · " + vName, { voyageId: w.vy.id }); da.pdaBillId = b.id; da.status = "advance-paid"; da.pdaPaidAt = day(bAt + DAY); payQueue.push({ vs, b, at: bAt + DAY }); }
              if (atd + 16 * DAY <= nowMs) { const fda = Math.round(pda * rnd(0.86, 1.13) / 10) * 10; da.fda = fda; da.fdaReceivedAt = day(atd + 16 * DAY); da.fdaDate = iso(atd + 16 * DAY); const bal = r2(fda - pda); if (bal > 0) { const b = bill(vs, atd + 16 * DAY, agent, "Port DA", bal, "FDA balance " + pt.name + " · " + vName, { voyageId: w.vy.id }); da.fdaBillId = b.id; payQueue.push({ vs, b, at: atd + 16 * DAY + ri(5, 20) * DAY }); } else da.refundDue = Math.abs(bal); da.status = bal > 0 && atd + 30 * DAY > nowMs ? "fda-received" : "settled"; }
              ps.das.push(da);
            }
            if (w.stem) { const b = bill(vs, msOf(w.stem.at), suppliers.find((s) => s.id === w.stem.supplierCpId), "Bunkers", w.stem.qty * w.stem.price, w.stem.qty + " MT VLSFO at " + w.stem.port + " · " + w.stem.bdn + " · " + vName, { voyageId: w.vy.id }); w.stem.billId = b.id; payQueue.push({ vs, b, at: msOf(w.stem.at) + ri(24, 32) * DAY }); }
            for (const s of ps.bunkerLog.filter((x) => x.voyageId === w.vy.id && x.grade === "LSMGO" && x.kind === "stem" && !x.billId)) { const b = bill(vs, msOf(s.at), suppliers.find((c) => c.id === s.supplierCpId), "Bunkers", s.qty * s.price, s.qty + " MT LSMGO at " + s.port + " · " + s.bdn + " · " + vName, { voyageId: w.vy.id }); s.billId = b.id; payQueue.push({ vs, b, at: msOf(s.at) + ri(24, 32) * DAY }); }
            if (w.canalCost && w.atdL + 4 * DAY <= nowMs) { const b = bill(vs, w.atdL + 4 * DAY, agents[w.viaCanal === "suez" ? 0 : 5], "Canal", w.canalCost, (w.viaCanal === "suez" ? "Suez" : "Panama") + " Canal transit dues · " + vName, { voyageId: w.vy.id }); payQueue.push({ vs, b, at: w.atdL + 5 * DAY }); }
          }
          // the broker's commission once the fixture is done
          if (w.end + 10 * DAY <= nowMs && invoicedGross > 0) { const b = bill(vs, w.end + 10 * DAY, brokers.find((x) => x.id === f.brokerCpId), "Brokerage", invoicedGross * f.brokerage / 100, "Brokerage " + f.brokerage + "% · " + vName + " / " + (charterers.find((c) => c.id === f.chartererCpId) || {}).short + " CP " + f.cpDate, { voyageId: w.vy.id }); payQueue.push({ vs, b, at: w.end + ri(35, 50) * DAY }); }
        }
        // insurance: P&I quarterly, hull and machinery once a year
        for (let q = 0; q < 4; q++) { const dMs = startMs + q * 91 * DAY + 5 * DAY; if (dMs > (vs.exitMs || nowMs)) break; const amt = Math.round((vs.cls === "afra" ? 92000 : vs.cls === "dry" ? rnd(36000, 48000) : rnd(52000, 66000)) / 100) * 100; const b = bill(vs, dMs, insurers[0], "Insurance", amt, "P&I premium Q" + (q + 1) + " · " + vName, {}); payQueue.push({ vs, b, at: dMs + ri(20, 30) * DAY }); }
        { const dMs = startMs + 20 * DAY; const b = bill(vs, dMs, insurers[1], "Insurance", Math.round(vs.dwt * rnd(1.6, 2.2) / 100) * 100, "Hull and machinery annual premium · " + vName, {}); payQueue.push({ vs, b, at: dMs + 30 * DAY }); }
        // the vessel is chartered in from her owners on a period time charter: hire every 15 days in advance
        { const rateIn = Math.round(SEG_BASE[vs.seg] * (vs.cls === "dry" ? 0.88 : 0.9) / 250) * 250; const psv = ps.vessels.find((x) => x.id === vs.v.id); if (psv) psv.charterIn = { cpId: vs.owner.id, rate: rateIn, currency: "USD", from: iso(startMs), hireInterval: 15 }; for (let s0 = startMs; s0 < (vs.exitMs || nowMs); s0 += 15 * DAY) { const b = bill(vs, s0, vs.owner, "Charter hire", rateIn * 15, "Hire to owners " + vName + " " + day(s0) + " – " + day(s0 + 15 * DAY) + ", 15 days at USD " + rateIn.toLocaleString("en-US") + "/day, in advance", { due: day(s0 + 3 * DAY) }); payQueue.push({ vs, b, at: s0 + 2 * DAY }); } }
      }
      // receipts: hire in advance within days, freight within a week, demurrage slower; one charterer pays late; two part-paid
      const recentDue = receiveQueue.filter((q) => q.i && !q.claim && msOf(q.i.due) < nowMs - 5 * DAY && msOf(q.i.due) > nowMs - 70 * DAY).map((q) => ({ q, k: rng() })).sort((a, b) => a.k - b.k).map((x) => x.q);
      const unpaid = new Set([...recentDue.filter((q) => q.slow).slice(0, 2), ...recentDue.filter((q) => !q.slow).slice(0, 1)]);
      const shortPaid = new Set(recentDue.filter((q) => !unpaid.has(q) && q.i.amount > 150000).slice(0, 2));
      let overdueMade = unpaid.size;
      for (const q of receiveQueue) {
        const i = q.i; if (!i) continue; const dueMs = msOf(i.due); let payMs = dueMs + (q.slow ? ri(12, 38) : ri(-1, 5)) * DAY; if (q.claim) payMs = dueMs + ri(5, 40) * DAY;
        if (unpaid.has(q)) continue; if (shortPaid.has(q)) payMs = Math.min(nowMs, dueMs + ri(0, 3) * DAY);
        if (payMs > nowMs) continue; payMs = Math.max(payMs, msOf(i.date));
        let amt = i.amount; if (shortPaid.has(q)) { amt = r2(i.amount * 0.65); partPaid++; }
        E.receivePayment(store, Object.assign({ invoiceId: i.id, bankId: usdBank(q.vs.entIdx).id, amount: amt, date: day(payMs), reference: "Charterers' remittance " + i.ref }, I));
        if (q.claim && amt >= i.amount - 0.01) { q.claim.status = "settled"; q.claim.settledAt = day(payMs); q.claim.settledAmount = r2(i.amount); }
      }
      slowLeft = overdueMade;
      // one credit note: off-hire agreed after the statement (4.31.22 · or, when every hire invoice is settled, a freight rebate)
      { const openOf = (kind) => store.invoices.filter((i) => isNewIn(before, "invoices", i) && i.meta && i.meta.kind === kind && E.docOpen(i) > 20000).pop(); const hireT = openOf("hire"); const target = hireT || openOf("freight"); if (target) E.creditNote(store, Object.assign({ invoiceId: target.id, amount: 7750, date: day(Math.min(msOf(target.date) + 9 * DAY, todayMs)), reason: hireT ? "Off-hire 12 hours agreed after the statement (auxiliary engine)" : "Freight rebate agreed after the invoice (outturn shortage)" }, I)); }
      // payments: on time, a few early; two overdue bills left open
      let leftOpen = 0;
      for (const q of payQueue) { const b = q.b; if (!b) continue; const dueMs = msOf(b.due); const payMs = Math.max(msOf(b.date), Math.min(q.at, dueMs + ri(-2, 3) * DAY)); if (payMs > nowMs) continue; if (leftOpen < 2 && dueMs < nowMs - 5 * DAY && dueMs > nowMs - 45 * DAY && (b.category === "Port DA" || b.category === "Brokerage")) { leftOpen++; continue; } E.payBill(store, Object.assign({ billId: b.id, bankId: usdBank(q.vs.entIdx).id, amount: E.docOpen(b), date: day(payMs), reference: "Payment " + b.ref }, I)); }
      // the offices: salaries and rent every month
      for (let mth = 0; mth <= 12; mth++) { const base = Date.UTC(new Date(startMs).getUTCFullYear(), new Date(startMs).getUTCMonth() + mth, 1); const sal = base + 24 * DAY, rent = base; if (base + 20 * DAY <= nowMs && base + 20 * DAY >= startMs) { E.transfer(store, Object.assign({ fromId: banks[0].id, toId: banks[1].id, amount: 105000, date: day(base + 20 * DAY), memo: "Funding AED account for payroll and office" }, I)); E.transfer(store, Object.assign({ fromId: banks[2].id, toId: banks[3].id, amount: 72000, date: day(base + 20 * DAY), memo: "Funding DKK account for payroll and office" }, I)); }
        for (const [bk, cat, amt, payee, dMs] of [[banks[1], "Salaries", 318000, "Payroll (WPS)", sal], [banks[1], "Office", 66800, "JLT office lease and services", rent], [banks[3], "Salaries", 418000, "Lønninger", sal], [banks[3], "Office", 64500, "Amaliegade lease and services", rent]]) { if (dMs > nowMs || dMs < startMs) continue; E.bankTransaction(store, Object.assign({ bankId: bk.id, kind: "out", category: cat, amount: Math.round(amt * rnd(0.97, 1.03)), date: day(dMs), payee, memo: cat + " " + day(dMs).slice(0, 7) }, I)); } }

      // ---------- the present: pipeline, the open vessel, the dry dock
      const nextUp = new Set(fleet.filter((v) => !v.end && !v.exit && v.fixtures.length && v.fixtures[v.fixtures.length - 1].end > nowMs).sort((a, b) => a.fixtures[a.fixtures.length - 1].end - b.fixtures[b.fixtures.length - 1].end).slice(0, 2));
      for (const vs of fleet) {
        const last = vs.fixtures[vs.fixtures.length - 1];
        if (vs.end === "open") { const cp = charterers[pick(LANES.dry[2].ch)]; const delMs = nowMs + 5 * DAY; const f = tagPs({ id: pid("fx"), vesselId: vs.v.id, kind: "tc", chartererCpId: cp.id, brokerCpId: brokers[2].id, cpDate: day(nowMs - DAY), cpForm: "NYPE 2015", delivery: { at: iso(delMs), port: vs.lastPort.name, lat: vs.lastPort.lat, lon: vs.lastPort.lon }, redelivery: { at: iso(delMs + 32 * DAY), port: "Mundra", lat: PORTS.Mundra[0], lon: PORTS.Mundra[1], estimated: true }, rate: Math.round(mkt(vs.seg, nowMs) * 1.02 / 250) * 250, rateUnit: "day", currency: "USD", addressCommission: 3.75, brokerage: 1.25, cve: 1500, hireInterval: 15, hireInAdvance: true, status: "on-subs", marketSegment: vs.seg, notes: "On subs: " + vs.name + " / " + cp.name + " · TCT Indonesia–India coal · subjects charterers' board approval", docIds: [], warranties: { speedLaden: vs.speedL, speedBallast: vs.speedB, consLaden: vs.consL, consBallast: vs.consB, consPort: vs.consP, grade: "VLSFO" }, subs: { deadline: iso(nowMs + DAY + 6 * HOUR), lifted: null } }); ps.fixtures.push(f); out.fixtures++; }
        if (vs.end === "drydock") { const yard = gcNm([vs.lastPort.lat, vs.lastPort.lon], [PORTS.Singapore[0], PORTS.Singapore[1]]) < gcNm([vs.lastPort.lat, vs.lastPort.lon], [PORTS.Istanbul[0], PORTS.Istanbul[1]]) ? port("Singapore") : port("Istanbul"); const rt = routeOf(vs.lastPort, yard); const dep = vs.lastEnd + DAY; const arr = dep + rt.nm / (vs.speedB * 24) * DAY; const vy = tagPs({ id: pid("vy"), vesselId: vs.v.id, fixtureId: null, no: String(vs.fixtures.length + 1).padStart(3, "0"), status: arr <= nowMs ? "sailing" : "planned", ports: [{ id: pid("p"), name: yard.name, lat: yard.lat, lon: yard.lon, activity: "drydock", eta: iso(arr), etd: iso(arr + 26 * DAY), ata: arr <= nowMs ? iso(arr) : null, atd: null, agentCpId: agents[agentFor(yard)].id, notes: "Special survey and dry docking; underwater hull, propeller polishing, BWTS retrofit" }], legs: [], bunkers: { rob: [], prices: {}, consumption: [] }, costs: [{ kind: "other", label: "Dry dock budget", amount: 1450000, currency: "USD" }], revenue: {}, from: iso(dep), to: iso(arr + 26 * DAY), cargoQty: 0 }); ps.voyages.push(vy); out.voyages++; }
        if (nextUp.has(vs)) { const cp = vs.cls === "mr" ? charterers[11] : charterers[1]; const delMs = last.end + DAY; const f = tagPs({ id: pid("fx"), vesselId: vs.v.id, kind: "tc", chartererCpId: cp.id, brokerCpId: brokers[0].id, cpDate: day(nowMs - 3 * DAY), cpForm: vs.cls === "mr" ? "SHELLTIME 4" : "NYPE 2015", delivery: { at: iso(delMs), port: last.disch.name, lat: last.disch.lat, lon: last.disch.lon }, redelivery: { at: iso(delMs + 45 * DAY), port: last.disch.name, lat: last.disch.lat, lon: last.disch.lon, estimated: true }, rate: Math.round(mkt(vs.seg, nowMs) * 1.04 / 250) * 250, rateUnit: "day", currency: "USD", addressCommission: vs.cls === "mr" ? 2.5 : 3.75, brokerage: 1.25, cve: vs.cls === "mr" ? 0 : 1500, hireInterval: 15, hireInAdvance: true, status: "fixed", marketSegment: vs.seg, notes: "Fixed for the next employment: " + vs.name + " / " + cp.name + " · delivery on dropping outward pilot " + last.disch.name + " · about 45 days trip", docIds: [], warranties: { speedLaden: vs.speedL, speedBallast: vs.speedB, consLaden: vs.consL, consBallast: vs.consB, consPort: vs.consP, grade: "VLSFO" }, subs: { deadline: iso(nowMs - 3 * DAY + 17 * HOUR), lifted: iso(nowMs - 3 * DAY + 14 * HOUR) } }); ps.fixtures.push(f); out.fixtures++; }
      }
      // an addendum on a running time charter, a stevedore damage claim
      { const run = ps.fixtures.filter((f) => isDemo(f) && f.kind === "tc" && f.status === "delivered"); const f = run[0]; if (f) ps.addenda.push(tagPs({ id: pid("ad"), fixtureId: f.id, vesselId: f.vesselId, no: 1, date: day(nowMs - 6 * DAY), title: "Addendum No. 1 — redelivery range extended", text: "Owners and charterers agree to extend the redelivery range to include one safe port in the Arabian Gulf at the same rate of hire; all other terms per the charter party.", docIds: [] })); }
      { const w = fleet[3].fixtures.find((x) => x.fx.kind === "voyage" && x.end < nowMs - 20 * DAY); if (w) ps.claims.push(tagPs({ id: pid("cl"), vesselId: fleet[3].v.id, fixtureId: w.fx.id, voyageId: w.vy.id, kind: "damage", againstCpId: agents[agentFor(w.load)].id, amount: 18500, currency: "USD", status: "open", date: day(w.atdL + 2 * DAY), notes: "Stevedore damage to hatch coaming No. 3 at " + w.load.name + "; surveyor's report on file, held stevedores responsible", docIds: [] })); }

      // ---------- markets, compliance, strategy, lists, the portal customers
      for (const seg of Object.values(SEG)) for (const ym of months) { if (ym > day(nowMs).slice(0, 7)) continue; ps.marketRates.push(tagPs({ id: pid("mr"), date: ym + "-01", segment: seg, rate: market[seg][ym], unit: "day", currency: "USD", source: "Demo market index (fictional)" })); }
      fleet.filter((v) => !v.exit).forEach((vs, i) => {
        const c = (kind, name, issued, expires) => ps.compliance.push(tagPs({ id: pid("cm"), vesselId: vs.v.id, kind, name, issued, expires, status: !expires ? "ok" : expires < day(nowMs) ? "expired" : expires <= day(nowMs + 60 * DAY) ? "due" : "ok", docIds: [] }));
        c("certificate", "Safety Management Certificate (SMC)", day(startMs - 700 * DAY + i * 31 * DAY), day(startMs + 1100 * DAY + i * 31 * DAY));
        c("certificate", "International Ship Security Certificate (ISSC)", day(startMs - 600 * DAY + i * 17 * DAY), day(startMs + 1200 * DAY + i * 17 * DAY));
        c("certificate", "Class — annual survey endorsement", day(nowMs - 330 * DAY + i * 9 * DAY), day(nowMs + (i === 1 ? 24 : 35 + i * 30) * DAY));
        c("certificate", vs.cls === "dry" ? "International Load Line Certificate" : "International Oil Pollution Prevention Certificate (IOPP)", day(startMs - 400 * DAY), day(startMs + 1400 * DAY));
        c("insurance", "P&I certificate of entry — " + CPS.insurers[0][0], day(Date.UTC(new Date(nowMs).getUTCFullYear() - (new Date(nowMs).getUTCMonth() < 1 ? 1 : 0), 1, 20)), day(Date.UTC(new Date(nowMs).getUTCFullYear() + (new Date(nowMs).getUTCMonth() < 1 ? 0 : 1), 1, 20)));
        c("certificate", "Ship Sanitation Control Exemption Certificate", day(nowMs - 175 * DAY), day(nowMs + (i === 6 ? -5 : 15 + i * 12) * DAY));
        if (vs.cls !== "dry") c("vetting", "SIRE 2.0 inspection — " + pick(["Coastline Energy", "Caspian Oil", "Lakeview Chemicals"]), day(nowMs - 150 * DAY + i * 5 * DAY), day(nowMs + (i === 7 ? 33 : 40 + i * 3) * DAY));
        c("psc", "Port state control inspection — no deficiencies", day(nowMs - 120 * DAY + i * 7 * DAY), day(nowMs + 240 * DAY + i * 7 * DAY));
        c("sanctions", "Fleet sanctions screening (owners, flag, managers)", day(nowMs - 30 * DAY), day(nowMs + 60 * DAY));
        const lastF = vs.fixtures[vs.fixtures.length - 1]; const m0 = mkt(vs.seg, nowMs);
        ps.strategies.push(tagPs({ id: pid("st"), vesselId: vs.v.id, horizon: [3, 6, 9, 12][i % 4], from: day(nowMs - 20 * DAY), targetRate: Math.round(m0 * 1.08 / 250) * 250, markets: vs.cls === "dry" ? ["Indonesia–India coal", "ECSA grains to China"] : vs.cls === "mr" ? ["AG–Europe diesel", "USG–ECSA"] : vs.cls === "afra" ? ["AG–Far East crude", "USG–UKC crude"] : ["AG–India methanol", "Europe–USG chemicals"], products: vs.cls === "dry" ? ["Coal", "Grains", "Fertilisers"] : vs.cls === "chem" ? ["Methanol", "Caustic soda", "Veg oils"] : ["Diesel", "Gasoline", "Jet"], relocateTo: vs.cls === "dry" ? "Singapore" : "Fujairah", notes: "Keep the vessel in the " + (lastF ? lastF.disch.region : "FE") + " market; aim for period business at or above the target when the index firms; avoid long ballast legs.", updated: iso(nowMs - 20 * DAY) }));
      });
      ps.lists.push(tagPs({ id: pid("ls"), name: "Dry bulk fleet", kind: "manual", vesselIds: fleet.filter((v) => v.cls === "dry" && !v.exit).map((v) => v.v.id), filter: null, createdBy: "demo", updated: iso(nowMs) }), tagPs({ id: pid("ls"), name: "Tankers", kind: "manual", vesselIds: fleet.filter((v) => v.cls !== "dry" && !v.exit).map((v) => v.v.id), filter: null, createdBy: "demo", updated: iso(nowMs) }));
      owners.forEach((o, i) => ps.portal.customers.push(tagPs({ cpId: o.id, vesselIds: fleet.filter((v) => v.owner.id === o.id && !v.exit).map((v) => v.v.id), visibility: { commercial: true, financials: i % 2 === 0, operations: true, performance: true, strategy: false, documents: true, positions: true }, users: [], publishedAt: null })));
      // ---------- 4.18 · working capital: no demo bank ever runs below its cushion over the year — the shareholders' loan at the
      // start covers the lowest point of the running balance (the exits moved the cash flows of two vessels)
      { const dates = [...new Set([...store.payments.filter((x) => isNewIn(before, "payments", x)).map((x) => x.date), ...store.bankTx.filter((x) => isNewIn(before, "bankTx", x)).map((x) => x.date)])].filter((d) => d && d <= day(nowMs)).sort();
        for (const b of banks) { let low = Infinity; for (let i = 0; i < dates.length; i += Math.max(1, Math.floor(dates.length / 120))) low = Math.min(low, E.bankBalance(store, b.id, dates[i])); low = Math.min(low, E.bankBalance(store, b.id, day(nowMs))); const cushion = b.currency === "DKK" || b.currency === "AED" ? 500000 : 250000; if (low < cushion) E.fundBank(store, { bankId: b.id, amount: Math.ceil((cushion - low) / 50000) * 50000, date: start, memo: "Shareholder loan — working capital " + b.label }); } }
      // ---------- 4.18 · the exits: the tenure closes on the exit day with its summary from the engine (the same record PS.exitVessel writes)
      try { E.invalidate(store); } catch (e) { /* older engine */ } try { if (P.touch) P.touch(ps); } catch (e) { /* older engine */ }
      for (const vs of fleet.filter((v) => v.exit)) {
        const psv = ps.vessels.find((x) => x.id === vs.v.id); if (!psv) continue; const at = day(vs.exitMs); const ex = vs.exit;
        const exit = { at, reason: ex.reason, reasonText: ex.reasonText || "", handedTo: ex.handedTo || "", note: ex.note || "", by: "demo", recordedAt: iso(vs.exitMs), statusBefore: "trading", management: psv.management, ownerCpId: psv.ownerCpId || null, managerEntityId: psv.managerEntityId || null };
        let summary = null; try { const t = P.tenure(ps, store, psv.id, { from: start, to: at, now: iso(nowMs), today: day(nowMs) }); summary = { days: t.days, months: t.months, fixtures: t.fixtureCount, voyages: t.voyages, byKind: t.byKind, charterers: t.charterers.length, onHireDays: t.onHireDays, offHireDays: t.offHireDays, utilisation: t.utilisation, currency: t.currency, income: t.income, expenses: t.expenses, result: t.result, receivablesOpen: t.receivablesOpen, payablesOpen: t.payablesOpen, documents: t.documents, openDocs: t.openDocs.length, claims: t.claims, lastPosition: null }; } catch (e) { summary = null; }
        if (summary && vs.lastPort) summary.lastPosition = { lat: vs.lastPort.lat, lon: vs.lastPort.lon, ts: iso(vs.lastEnd || vs.exitMs), dest: "", source: "port" };
        psv.status = "offboarded"; psv.offboarded = at; psv.exit = exit; psv.tenures = [{ id: pid("tn"), from: start, to: at, ...exit, summary }];
      }
      out.slowPayerOverdue = slowLeft; out.billsLeftOpen = leftOpen;
    } finally {
      if (store.settings && savedLock !== undefined) store.settings.lockedThrough = savedLock;
    }
    // ---------- tag everything the engine created
    for (const k of Object.keys(store)) { if (!Array.isArray(store[k])) continue; const had = before[k] || new Set(); for (const x of store[k]) if (x && typeof x === "object" && !had.has(x)) { x.demo = true; x.demoSet = TAG; } }
    try { E.invalidate(store); } catch (e) { /* older engine */ } try { if (P.touch) P.touch(ps); } catch (e) { /* older engine */ }
    return Object.assign(out, countsOf(store, ps));
  }
  // the demo year: from the first of a month about a year ago (1 November for a load at the end of October) to today
  function startOf(today) { const t = msOf(today), d = new Date(t); let s = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 12, 1); if (t - s > 375 * DAY) s = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 11, 1); return day(s); }
  function isNewIn(before, k, x) { return !(before[k] && before[k].has(x)); }

  // ============================================================== removal and counts
  function countsOf(store, ps) {
    const book = {}, pro = {}; let nb = 0, np = 0;
    for (const k of Object.keys(store || {})) if (Array.isArray(store[k])) { const n = store[k].filter(isDemo).length; if (n) { book[k] = n; nb += n; } }
    if (ps) { for (const k of Object.keys(ps)) if (Array.isArray(ps[k])) { const n = ps[k].filter(isDemo).length; if (n) { pro[k] = n; np += n; } } const pc = ps.portal && Array.isArray(ps.portal.customers) ? ps.portal.customers.filter(isDemo).length : 0; if (pc) { pro["portal.customers"] = pc; np += pc; } }
    return { book, proship: pro, bookRecords: nb, proshipRecords: np };
  }
  function strip(store, ps) {
    let nb = 0, np = 0;
    if (store) for (const k of Object.keys(store)) if (Array.isArray(store[k])) { const n0 = store[k].length; store[k] = store[k].filter((x) => !isDemo(x)); nb += n0 - store[k].length; }
    if (store) { const live = new Set(store.vessels.map((v) => v.id)); for (const c of store.counterparties || []) if (Array.isArray(c.vesselIds)) c.vesselIds = c.vesselIds.filter((id) => live.has(id) || !String(id)); }
    if (ps) { for (const k of Object.keys(ps)) if (Array.isArray(ps[k])) { const n0 = ps[k].length; ps[k] = ps[k].filter((x) => !isDemo(x)); np += n0 - ps[k].length; } if (ps.portal && Array.isArray(ps.portal.customers)) { const n0 = ps.portal.customers.length; ps.portal.customers = ps.portal.customers.filter((x) => !isDemo(x)); np += n0 - ps.portal.customers.length; } }
    try { const E = eng(); if (E && store) E.invalidate(store); } catch (e) { /* none */ } try { const P = pse(); if (P && P.touch && ps) P.touch(ps); } catch (e) { /* none */ }
    return { book: nb, proship: np };
  }

  // ============================================================== in the app
  const app = () => (typeof S !== "undefined" && S && S.store ? S : null);
  const psDoc = () => (root.PS && root.PS.data ? root.PS.data() : null);
  function present() { const a = app(); if (a && Object.keys(a.store).some((k) => Array.isArray(a.store[k]) && a.store[k].some(isDemo))) return true; const d = psDoc(); return !!(d && Object.keys(d).some((k) => Array.isArray(d[k]) && d[k].some(isDemo))); }
  function summary() { const a = app(); const c = countsOf(a ? a.store : {}, psDoc()); const ves = psDoc() ? psDoc().vessels.filter((v) => isDemo(v) && v.status !== "offboarded").length : (a ? a.store.vessels.filter(isDemo).length : 0); const exited = psDoc() ? psDoc().vessels.filter((v) => isDemo(v) && v.status === "offboarded").length : 0; const fx = (psDoc() || { fixtures: [] }).fixtures.filter(isDemo).length; return Object.assign(c, { present: c.bookRecords + c.proshipRecords > 0, vessels: ves, exited, fixtures: fx, text: c.bookRecords + c.proshipRecords ? ves + " vessels" + (exited ? " (" + exited + " historic)" : "") + ", " + fx + " fixtures, " + (c.book.invoices || 0) + " invoices, " + (c.book.bills || 0) + " bills, " + (c.book.ledger || 0) + " journals" : "No demo data" }); }
  const say = (m) => { try { if (typeof toast === "function") toast(m); else if (root.SUITE && SUITE.toast) SUITE.toast(m); } catch (e) { /* none */ } };
  async function ask(title, text, ok, danger) { try { if (root.SUITE && SUITE.dialog) { const r = await SUITE.dialog({ title, text, ok, danger }); return !!r; } } catch (e) { /* fall back */ } return typeof confirm === "function" ? confirm(title + "\n\n" + text) : true; }
  function progress(text) {
    if (typeof document === "undefined") return { set() {}, close() {} };
    const box = document.createElement("div"); box.className = "xdemo-progress"; box.setAttribute("role", "status");
    box.style.cssText = "position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:var(--pt-veil, rgba(0,0,0,.55));backdrop-filter:blur(6px)";
    box.innerHTML = '<div style="min-width:300px;max-width:420px;padding:22px 24px;background:var(--pt-ground,#14161a);border:1px solid var(--pt-hair,rgba(255,255,255,.12));color:var(--pt-ink,#e8eaed);font:300 13px/1.5 var(--font, sans-serif)"><div style="font:400 10px var(--font-caps,inherit);letter-spacing:.22em;text-transform:uppercase;color:var(--pt-dim,#9aa0a6);margin-bottom:10px">Demo company</div><div class="t"></div><div style="height:2px;background:var(--pt-hair,rgba(255,255,255,.12));margin-top:14px"><div class="b" style="height:2px;width:4%;background:var(--pt-ink,#e8eaed);transition:width .3s"></div></div></div>';
    document.body.append(box); const t = box.querySelector(".t"), b = box.querySelector(".b"); t.textContent = text;
    return { set(f, m) { b.style.width = Math.round(Math.max(0.04, Math.min(1, f)) * 100) + "%"; if (m) t.textContent = m; }, close() { box.remove(); } };
  }
  const tick = () => new Promise((r) => setTimeout(r, 30));
  function canWrite() { if (typeof CLOUD === "undefined") return { ok: true }; if (CLOUD.signedIn && CLOUD.signedIn() && !CLOUD.active()) return { ok: false, why: "The demo company needs a company workspace — open a company first" }; if (CLOUD.active && CLOUD.active() && CLOUD.canEdit && !CLOUD.canEdit()) return { ok: false, why: "Your role in this company is read-only" }; return { ok: true }; }
  async function saveBook() {
    if (typeof persist !== "undefined" && persist && persist.save) { const r = await persist.save(S.store); if (r && r.ok === false && r.refused) throw Object.assign(new Error(r.refused), { refused: true }); }
    else if (typeof scheduleSave === "function") scheduleSave();
    try { S.dirty = false; const el = document.getElementById("saveState"); if (el) el.textContent = typeof CLOUD !== "undefined" && CLOUD.active && CLOUD.active() ? "synced" : "saved"; } catch (e) { /* no header */ }
  }
  const redraw = () => { try { if (typeof render === "function") render(); } catch (e) { /* not on the accounting page */ } try { if (root.SUITE && SUITE.current && SUITE.refreshCurrent) SUITE.refreshCurrent(); } catch (e) { /* none */ } try { document.dispatchEvent(new CustomEvent("xyntax:saved", { detail: { msg: "demo" } })); document.dispatchEvent(new CustomEvent("xyntax:demo", { detail: summary() })); } catch (e) { /* none */ } };
  // the procedure: what an operator would have ticked over the year (items more than three days old), so the board shows today's work
  function procedure(d) { const O = root.PSOPS; if (!O || !O.tasks || !d) return 0; try { if (O.invalidate) O.invalidate(); const ids = new Set(d.vessels.filter(isDemo).map((v) => v.id)); const now = new Date(); const cutoff = new Date(now.getTime() - 3 * DAY).toISOString().slice(0, 16); const list = O.tasks({ vesselIds: [...ids] }, { noDaily: true }); let n = 0; const have = new Set((d.voyageTasks || []).map((t) => t.id)); for (const t of list) { if (t.status !== "overdue" || !t.due || t.due > cutoff || have.has(t.id)) continue; d.voyageTasks.push({ id: t.id, vesselId: t.vesselId, fixtureId: t.fixtureId || null, voyageId: t.voyageId || null, portId: t.portId || null, stage: t.stage, key: t.key, custom: false, status: "done", doneAt: t.due, by: "Operations (demo)", reopened: false, docIds: [], created: t.due, updated: t.due, demo: true, demoSet: TAG }); n++; } if (O.invalidate) O.invalidate(); return n; } catch (e) { console.warn("demo procedure", e); return 0; } }

  async function load(opt) {
    opt = opt || {}; const E = eng(); const a = app();
    if (!E || !a) { say("Open ACCOUNTING once so the books are loaded, then try again"); return false; }
    const w = canWrite(); if (!w.ok) { say(w.why); return false; }
    if (present()) { say("The demo company is already loaded — " + summary().text); return false; }
    const lock = E.lockedFor ? E.lockedFor(a.store, null) : a.store.settings && a.store.settings.lockedThrough; const startDay = startOf(E.today());
    if (lock && lock >= startDay) { say("The books are closed through " + lock + "; the demo year starts " + startDay + ". Reopen the period first (Data → Period close)."); return false; }
    if (!opt.yes && !(await ask("Load the demo company?", "Adds a fictional ship-management and chartering company with a year of history: 2 entities, 12 vessels (10 under management, 2 that exited during the year), about 85 fixtures, voyages, noon reports, laytime, invoices, bills, receipts and payments. Everything is marked as demo and can be removed in one step; your own records are not touched.", "Load demo data"))) return false;
    const pr = progress("Building the demo year…"); const t0 = Date.now();
    try {
      await tick(); let ps = null; if (root.PS && root.PS.ready) { try { ps = await root.PS.ready(); } catch (e) { ps = null; } }
      const res = build({ store: a.store, ps: ps || {}, today: E.today() });
      pr.set(0.3, "Saving the books — " + res.bookRecords + " records…"); await tick();
      await saveBook();
      pr.set(0.7, "Saving PROSHIP — " + res.proshipRecords + " records…"); await tick();
      if (ps && root.PS) { root.PS.save(); if (root.PS.flush) await root.PS.flush(); pr.set(0.85, "Ticking the procedure…"); await tick(); const n = procedure(ps); if (n) { root.PS.save(); if (root.PS.flush) await root.PS.flush(); } res.procedure = n; }
      pr.set(1, "Done"); redraw();
      say("Demo company loaded in " + Math.round((Date.now() - t0) / 100) / 10 + " s — " + summary().text);
      return res;
    } catch (e) {
      console.error(e); say("The demo data could not be saved completely: " + (e.message || e) + ". Use Remove demo data to clear what was saved."); redraw(); return false;
    } finally { pr.close(); }
  }
  async function purgeServer() { const ses = CLOUD.session() || {}; const r = await CLOUD.req("/rest/v1/rpc/book_purge_demo", { method: "POST", body: JSON.stringify({ p_org: ses.org_id, p_tag: TAG }) }); if (!r.ok) throw new Error("The workspace refused the removal: " + (await r.text()).slice(0, 160)); return r.json(); }
  async function reloadBook() { const E = eng(); if (typeof BOOKDB === "undefined") return; const org = (CLOUD.session() || {}).org_id; try { await BOOKDB.clearCache(); } catch (e) { /* no cache */ } BOOKDB.reset(); const st = await BOOKDB.load({ orgId: org, fresh: true }); S.store = E.migrate(st); S.sel = null; }
  async function remove(opt) {
    opt = opt || {}; const E = eng(); const a = app();
    if (!E || !a) { say("Open ACCOUNTING once so the books are loaded, then try again"); return false; }
    const w = canWrite(); if (!w.ok) { say(w.why); return false; }
    if (!present()) { say("There is no demo data to remove"); return false; }
    const sum = summary(); if (!opt.yes && !(await ask("Remove the demo company?", "Removes everything marked as demo — " + sum.text + " and the PROSHIP records that go with them. Your own records stay exactly as they are.", "Remove demo data", true))) return false;
    const pr = progress("Removing the demo company…");
    try {
      let ps = null; if (root.PS && root.PS.ready) { try { ps = await root.PS.ready(); } catch (e) { ps = null; } }
      const n = strip(a.store, ps); S.sel = null;
      pr.set(0.3, "Saving the books…"); await tick();
      // 4.31.3 · the one explicit Delete-all path: the workspace refuses a save that removes most of a kind unless it is confirmed
      if (root.BOOKDB && root.BOOKDB.confirmBulk) root.BOOKDB.confirmBulk(); if (root.PSDB && root.PSDB.confirmBulk) root.PSDB.confirmBulk();
      try { await saveBook(); } catch (e) {
        if (!(e.refused || /immutable|cannot be removed|refused/i.test(e.message || "")) || typeof CLOUD === "undefined" || !CLOUD.active()) throw e;
        pr.set(0.45, "Asking the workspace to purge the demo rows…"); await purgeServer(); await reloadBook(); strip(S.store, null);
      }
      pr.set(0.75, "Saving PROSHIP…"); await tick();
      if (ps && root.PS) { if (root.PSDB && root.PSDB.confirmBulk) root.PSDB.confirmBulk(); root.PS.save(); if (root.PS.flush) await root.PS.flush(); }
      pr.set(1, "Done"); redraw(); say("Demo data removed — " + n.book + " book records and " + n.proship + " PROSHIP records");
      return n;
    } catch (e) { console.error(e); say("Removing the demo data stopped: " + (e.message || e)); redraw(); return false; }
    finally { pr.close(); }
  }

  return { TAG, isDemo, startOf, build, strip, countsOf, present, summary, load, remove, procedure, PORTS, FLEET };
});
