/* XYNTAX Suite — the part shared by the desktop app and the Android app: the app dashboard, the frame every suite app runs in,
 * per-user app data (cloud document per app, or this device when there is no workspace), personal files, password locking,
 * charts, dialogs and menus. The apps themselves (notes.js, wealth.js, calendar.js, vault.js) register here. Nothing in this file
 * touches the accounting book. */
// 4.31.13 · one Intl formatter per format, made once: toLocaleDateString / toLocaleString with options build a new formatter on every
// call, which was half the time of opening a sheet with long date lists (New fixture: 99 market-rate dates, 9.9 of 22 ms)
const SUITE_FMT = { d: null, t: null, n: new Map(), date: (d) => (SUITE_FMT.d || (SUITE_FMT.d = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }))).format(d), time: (d) => (SUITE_FMT.t || (SUITE_FMT.t = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" }))).format(d),
  num: (n, min, max) => { const k = min + "/" + max; let f = SUITE_FMT.n.get(k); if (!f) { f = new Intl.NumberFormat("en-US", { minimumFractionDigits: min, maximumFractionDigits: max }); SUITE_FMT.n.set(k, f); } return f.format(n); } };
const SUITE = {
  // ---------- 4.10.2 · the startup timeline: marks with the network requests counted per phase; Settings → About shows it,
  // tests read SUITE.perf.report(). The user can send it from a real phone when something feels slow.
  perf: {
    t0: (typeof performance !== "undefined" && performance.timeOrigin) ? performance.timeOrigin : Date.now(), marks: [], reqs: 0, phases: {},
    now() { return Math.round(typeof performance !== "undefined" ? performance.now() : Date.now() - this.t0); },
    mark(name, extra) { const m = { name, at: this.now(), reqs: this.reqs, ...(extra || {}) }; this.marks.push(m); if (this.marks.length > 400) this.marks.shift(); return m; },
    // a phase: start(name) … end(name) → { ms, reqs } (requests made in between)
    start(name) { this.phases[name] = { at: this.now(), reqs: this.reqs }; this.mark(name + " ▸"); },
    end(name, extra) { const p = this.phases[name]; if (!p) return null; const r = { ms: this.now() - p.at, reqs: this.reqs - p.reqs, ...(extra || {}) }; this.mark(name + " ✓", r); delete this.phases[name]; return r; },
    report() { return { marks: this.marks.slice(), navigation: (() => { try { const n = performance.getEntriesByType("navigation")[0]; return n ? { domInteractive: Math.round(n.domInteractive), domContentLoaded: Math.round(n.domContentLoadedEventEnd), load: Math.round(n.loadEventEnd) } : null; } catch (e) { return null; } })(), requests: this.reqs }; },
    text() { const r = this.report(); const lines = []; if (r.navigation) lines.push("page parsed " + r.navigation.domInteractive + " ms · scripts ready " + r.navigation.domContentLoaded + " ms"); let prev = 0; for (const m of r.marks) { lines.push(String(m.at).padStart(6) + " ms  +" + String(m.at - prev).padStart(5) + "  " + m.name + (m.ms != null ? "  (" + m.ms + " ms, " + m.reqs + " requests)" : "") + (m.note ? "  " + m.note : "")); prev = m.at; } lines.push("requests in total: " + r.requests); return lines.join("\n"); },
  },
  APPS: [
    { id: "accounting", n: "01", name: "ACCOUNTING", desc: "The company: trades, cargoes, invoices and the books", icon: '<svg viewBox="0 0 48 48"><rect x="9" y="9" width="30" height="30" rx="5"/><path d="M9 18h30"/><path d="M15 25h6M15 31h6M27 25h6M27 31h6"/></svg>' },
    { id: "proship", n: "02", name: "PROSHIP", desc: "Vessels under management: fixtures, voyages, performance, portal", icon: '<svg viewBox="0 0 48 48"><path d="M6 30h36l-4 9H10z"/><path d="M11 30V20h26v10"/><path d="M17 20v-7h14v7"/><path d="M22 13V8h4v5"/><path d="M4 43c3 0 3-2 6-2s3 2 6 2 3-2 6-2 3 2 6 2 3-2 6-2 3 2 6 2"/></svg>' },
    { id: "notes", n: "03", name: "NOTES", desc: "Pages, to-do lists, voice notes, sketches", icon: '<svg viewBox="0 0 48 48"><path d="M13 7h15.5L38 16.5V37a4 4 0 0 1-4 4H13a4 4 0 0 1-4-4V11a4 4 0 0 1 4-4z"/><path d="M28 7v7a3 3 0 0 0 3 3h7"/><path d="M16 26h16M16 32h11"/></svg>' },
    { id: "wealth", n: "04", name: "WEALTH", desc: "Accounts, assets and net worth over time", icon: '<svg viewBox="0 0 48 48"><path d="M8 38h32"/><path d="M10 31c6 0 7-10 12-10s6 6 10 6 5-9 8-13"/><circle cx="40" cy="14" r="2.2"/></svg>' },
    { id: "calendar", n: "05", name: "CALENDAR", desc: "Meetings, reminders, Google and Outlook", icon: '<svg viewBox="0 0 48 48"><rect x="8" y="11" width="32" height="29" rx="5"/><path d="M8 20h32M17 7v7M31 7v7"/><circle cx="24" cy="30" r="2.4" fill="currentColor" stroke="none"/></svg>' },
    { id: "documents", n: "06", name: "DOCUMENTS", desc: "Files, folders, previews and locks", icon: '<svg viewBox="0 0 48 48"><path d="M8 15a4 4 0 0 1 4-4h8l4 4h12a4 4 0 0 1 4 4v15a4 4 0 0 1-4 4H12a4 4 0 0 1-4-4z"/><path d="M8 21h32"/></svg>' },
    { id: "messages", n: "07", name: "MESSAGES", desc: "Encrypted conversations with colleagues", icon: '<svg viewBox="0 0 48 48"><path d="M6 10h36v24H20l-9 8v-8H6z"/><path d="M14 19h20M14 25h12"/></svg>' },
    { id: "contacts", n: "08", name: "CONTACTS", desc: "People and companies, private and shared", icon: '<svg viewBox="0 0 48 48"><circle cx="19" cy="17" r="7"/><path d="M6 40c0-7 6-12 13-12s13 5 13 12"/><circle cx="34" cy="19" r="5"/><path d="M34 28c5 0 9 4 9 9"/></svg>' },
    { id: "mail", n: "09", name: "MAIL", desc: "Your email accounts in one private inbox", icon: '<svg viewBox="0 0 48 48"><path d="M42 31a3 3 0 0 1-3 3H9a3 3 0 0 1-3-3V18c0-5 4-9 9-9h20c4 0 7 3 7 7v15Z"/><path d="M15 9c5 0 9 4 9 9v16"/><path d="M31 16h6v5"/><path d="M13 19h3"/><path d="M28 34v9M22 43h12"/></svg>' },
    { id: "compliance", n: "11", name: "COMPLIANCE", desc: "Onboarding of customers and vendors: KYC, documents, sanctions declaration, validity", icon: '<svg viewBox="0 0 48 48"><path d="M24 5l15 6v11c0 10-6.2 17.6-15 21-8.8-3.4-15-11-15-21V11z"/><path d="M17 24l5 5 9-10"/></svg>' },
    { id: "settings", n: "10", name: "SETTINGS", desc: "Profile, security, companies", icon: '<svg viewBox="0 0 48 48"><path d="M40.7 20.7L40.7 27.3L36.6 27.3L35.2 30.6L38.1 33.5L33.5 38.1L30.6 35.2L27.3 36.6L27.3 40.7L20.7 40.7L20.7 36.6L17.4 35.2L14.5 38.1L9.9 33.5L12.8 30.6L11.4 27.3L7.3 27.3L7.3 20.7L11.4 20.7L12.8 17.4L9.9 14.5L14.5 9.9L17.4 12.8L20.7 11.4L20.7 7.3L27.3 7.3L27.3 11.4L30.6 12.8L33.5 9.9L38.1 14.5L35.2 17.4L36.6 20.7Z"/><circle cx="24" cy="24" r="5.5"/></svg>' },
  ],
  LOCK: '<svg viewBox="0 0 24 24" width="12" height="12"><rect x="5" y="10.5" width="14" height="10" rx="1.5"/><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5"/></svg>',
  // small monochrome glyphs used by every app (stroke = currentColor)
  I: { gear: '<svg viewBox="0 0 24 24"><path d="M20.4 10.3L20.4 13.7L18.4 13.7L17.7 15.3L19.1 16.8L16.8 19.1L15.3 17.7L13.7 18.4L13.7 20.4L10.3 20.4L10.3 18.4L8.7 17.7L7.2 19.1L4.9 16.8L6.3 15.3L5.6 13.7L3.6 13.7L3.6 10.3L5.6 10.3L6.3 8.7L4.9 7.2L7.2 4.9L8.7 6.3L10.3 5.6L10.3 3.6L13.7 3.6L13.7 5.6L15.3 6.3L16.8 4.9L19.1 7.2L17.7 8.7L18.4 10.3Z"/><circle cx="12" cy="12" r="2.8"/></svg>', mailbox: '<svg viewBox="0 0 24 24"><path d="M21 15.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 15.5V9a4.5 4.5 0 0 1 4.5-4.5h10A3.5 3.5 0 0 1 21 8v7.5Z"/><path d="M7.5 4.5A4.5 4.5 0 0 1 12 9v8"/><path d="M15.5 8h3v2.5"/><path d="M6.5 9.5h1.5"/><path d="M14 17v4.5M11 21.5h6"/></svg>', share: '<svg viewBox="0 0 24 24"><circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="M8.2 10.8l7.6-4.6M8.2 13.2l7.6 4.6"/></svg>', sliders: '<svg viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h16"/><circle cx="9" cy="7" r="2"/><circle cx="15" cy="12" r="2"/><circle cx="8" cy="17" r="2"/></svg>', forward: '<svg viewBox="0 0 24 24"><path d="M13.5 6l6 6-6 6M19.5 12H9.5a5 5 0 0 0-5 5v1"/></svg>', phone: '<svg viewBox="0 0 24 24"><path d="M5.5 3.5h3l1.8 4.3-2.2 1.7a12 12 0 0 0 6.4 6.4l1.7-2.2 4.3 1.8v3a2 2 0 0 1-2.2 2A16.5 16.5 0 0 1 3.5 5.7a2 2 0 0 1 2-2.2z"/></svg>', mail: '<svg viewBox="0 0 24 24"><rect x="3" y="5.5" width="18" height="13" rx="1.5"/><path d="M3.5 7l8.5 6 8.5-6"/></svg>', whatsapp: '<svg viewBox="0 0 24 24"><path d="M4 20l1.3-4A8.5 8.5 0 1 1 8.6 19z"/><path d="M9 8.5c0 3 3.5 6.5 6.5 6.5l1-1.5-2-1-1 1a5 5 0 0 1-3-3l1-1-1-2z"/></svg>', plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>', menu: '<svg viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h16"/></svg>', arrow: '<svg viewBox="0 0 24 24"><path d="M4 12h15M13 6l6 6-6 6"/></svg>', trade: '<svg viewBox="0 0 24 24"><path d="M4 8.5h13.5M14 5l3.5 3.5L14 12"/><path d="M20 15.5H6.5M10 12l-3.5 3.5L10 19"/></svg>', cargo: '<svg viewBox="0 0 24 24"><path d="M3 15h18l-2.5 4.5H5.5z"/><path d="M6 15V9h5V6h4v3h3v6"/></svg>', receipt: '<svg viewBox="0 0 24 24"><path d="M6 3h12v18l-2-1.5-2 1.5-2-1.5-2 1.5-2-1.5-2 1.5z"/><path d="M9 8h6M9 11.5h6M9 15h4"/></svg>', invoice: '<svg viewBox="0 0 24 24"><path d="M7 3h8l4 4v14H7z"/><path d="M15 3v4h4"/><path d="M10 11h6M10 14.5h6"/><circle cx="11.2" cy="18.2" r="1.6"/></svg>', payout: '<svg viewBox="0 0 24 24"><rect x="3" y="6" width="18" height="12" rx="1.5"/><path d="M3 10h18M7 15h3M14 15h3"/></svg>', desk: '<svg viewBox="0 0 24 24"><rect x="3.5" y="4.5" width="17" height="13" rx="1.5"/><path d="M8 21h8M12 17.5V21M7 13l3-3 3 2 4-4"/></svg>', book: '<svg viewBox="0 0 24 24"><path d="M5 4.5h11a2 2 0 0 1 2 2v13H7a2 2 0 0 1-2-2z"/><path d="M5 17.5a2 2 0 0 1 2-2h11M9 8.5h5"/></svg>', finance: '<svg viewBox="0 0 24 24"><rect x="5" y="3.5" width="14" height="17" rx="1"/><path d="M8 8h8M8 11.5h8M8 15h5M8 18h8"/></svg>', people: '<svg viewBox="0 0 24 24"><circle cx="9" cy="8.5" r="3"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0M15 5.8a3 3 0 0 1 0 5.4M17.5 13.5a5 5 0 0 1 3 4.5"/></svg>', chart: '<svg viewBox="0 0 24 24"><path d="M4 19h16M6 15l4-5 3 3 5-7"/></svg>', wallet: '<svg viewBox="0 0 24 24"><rect x="3.5" y="6.5" width="17" height="12" rx="2"/><path d="M3.5 10h17M15 14h2"/></svg>', search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/></svg>', grid: '<svg viewBox="0 0 24 24"><rect x="4" y="4" width="7" height="7"/><rect x="13" y="4" width="7" height="7"/><rect x="4" y="13" width="7" height="7"/><rect x="13" y="13" width="7" height="7"/></svg>', list: '<svg viewBox="0 0 24 24"><path d="M5 7h14M5 12h14M5 17h14"/></svg>', more: '<svg viewBox="0 0 24 24"><circle cx="6" cy="12" r="1.4" fill="currentColor"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/><circle cx="18" cy="12" r="1.4" fill="currentColor"/></svg>', trash: '<svg viewBox="0 0 24 24"><path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13M10 11v6M14 11v6"/></svg>', star: '<svg viewBox="0 0 24 24"><path d="M12 4l2.4 5 5.4.7-4 3.8 1 5.5-4.8-2.6L7.2 19l1-5.5-4-3.8L9.6 9z"/></svg>', upload: '<svg viewBox="0 0 24 24"><path d="M12 16V5M7 10l5-5 5 5M5 19h14"/></svg>', download: '<svg viewBox="0 0 24 24"><path d="M12 5v11M7 11l5 5 5-5M5 19h14"/></svg>', folder: '<svg viewBox="0 0 24 24"><path d="M4 7h6l2 2h8v9H4z"/></svg>', back: '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>', close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>', help: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 1-1 1.7M12 17h.01"/></svg>', theme: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M12 6a6 6 0 0 1 0 12z" fill="currentColor" stroke="none"/></svg>', home: '<svg viewBox="0 0 24 24"><path d="M4 11l8-7 8 7v9h-5v-6h-6v6H4z"/></svg>', pin: '<svg viewBox="0 0 24 24"><path d="M9 4h6l-1 6 3 3v2H7v-2l3-3zM12 15v5"/></svg>', clock: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3 2"/></svg>', check: '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>', settings: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8"/></svg>', calendar: '<svg viewBox="0 0 24 24"><rect x="4" y="6" width="16" height="14" rx="1.5"/><path d="M4 10h16M8 4v4M16 4v4"/></svg>', mic: '<svg viewBox="0 0 24 24"><rect x="9" y="4" width="6" height="11" rx="3"/><path d="M6 11a6 6 0 0 0 12 0M12 17v3M9 20h6"/></svg>', pen: '<svg viewBox="0 0 24 24"><path d="M15 4l5 5-10 10H5v-5z"/><path d="M13 6l5 5"/></svg>', doc: '<svg viewBox="0 0 24 24"><path d="M6 3h9l4 4v14H6z"/><path d="M15 3v4h4M9 12h6M9 16h4"/></svg>', todo: '<svg viewBox="0 0 24 24"><rect x="4" y="5" width="6" height="6"/><path d="M5.5 8l1.5 1.5 3-3M13 8h7M13 16h7"/><rect x="4" y="13" width="6" height="6"/></svg>', lock: '<svg viewBox="0 0 24 24"><rect x="5" y="10.5" width="14" height="10" rx="1.5"/><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5"/></svg>', bank: '<svg viewBox="0 0 24 24"><path d="M3.5 9.5L12 4.5l8.5 5M4.5 9.5h15M6 12.5v5M10 12.5v5M14 12.5v5M18 12.5v5M4 20h16"/></svg>', planned: '<svg viewBox="0 0 24 24"><rect x="4" y="6" width="16" height="14" rx="1.5"/><path d="M4 10h16M8 4v4M16 4v4M9 15l2 2 4-4"/></svg>', tag: '<svg viewBox="0 0 24 24"><path d="M4 4h8l8 8-8 8-8-8z"/><circle cx="8" cy="8" r="1.2"/></svg>', tiles: '<svg viewBox="0 0 24 24"><rect x="4" y="4" width="4.2" height="4.2"/><rect x="9.9" y="4" width="4.2" height="4.2"/><rect x="15.8" y="4" width="4.2" height="4.2"/><rect x="4" y="9.9" width="4.2" height="4.2"/><rect x="9.9" y="9.9" width="4.2" height="4.2"/><rect x="15.8" y="9.9" width="4.2" height="4.2"/><rect x="4" y="15.8" width="4.2" height="4.2"/><rect x="9.9" y="15.8" width="4.2" height="4.2"/><rect x="15.8" y="15.8" width="4.2" height="4.2"/></svg>', send: '<svg viewBox="0 0 24 24"><path d="M3 11.5L21 4l-4 17-5.2-5.3L8 18.5v-4.3L17 8l-9.5 5z"/></svg>', xmark: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>', user: '<svg viewBox="0 0 24 24"><circle cx="12" cy="8.5" r="3.5"/><path d="M5 20a7 7 0 0 1 14 0"/></svg>', arrowup: '<svg viewBox="0 0 24 24"><path d="M12 19V5M6 11l6-6 6 6"/></svg>', arrowdown: '<svg viewBox="0 0 24 24"><path d="M12 5v14M6 13l6 6 6-6"/></svg>', copy: '<svg viewBox="0 0 24 24"><rect x="8.5" y="8.5" width="11" height="11" rx="1.5"/><path d="M15.5 8.5V5.5a1 1 0 0 0-1-1h-9a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h3"/></svg>', eye: '<svg viewBox="0 0 24 24"><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6z"/><circle cx="12" cy="12" r="2.8"/></svg>', ship: '<svg viewBox="0 0 24 24"><path d="M3 15h18l-2 4.5H5z"/><path d="M5.5 15v-5h13v5"/><path d="M8.5 10V6.5h7V10"/><path d="M11 6.5V4h2v2.5"/><path d="M2 22c1.5 0 1.5-1 3-1s1.5 1 3 1 1.5-1 3-1 1.5 1 3 1 1.5-1 3-1 1.5 1 3 1"/></svg>' },
  // the mark beside the wordmark (src/brand.js)
  // 4.9.1 · one lockup everywhere: XYNTAX | SUITE on the home page, XYNTAX | NOTES inside an app — same font, size and tracking,
  // so moving between pages only changes the word after the divider
  // 4.10.1 · one sentence, everywhere, saying who can see what is on screen: { kind: private|people|company|readonly|mixed, names, org, app, by }
  visNote(aud) {
    const H = this.H.bind(this); aud = aud || { kind: "private" }; const org = aud.org || (typeof CLOUD !== "undefined" && CLOUD.state.orgName) || "the company"; const app = aud.app || "";
    let glyph = "lock", text = "Only you can see this";
    if (aud.kind === "people") { const n = aud.names || []; const shown = n.slice(0, 3).join(", "); const more = n.length > 3 ? " and " + (n.length - 3) + " more" : ""; glyph = "people"; text = aud.by ? "Shared with you by " + aud.by + (n.length ? " · with " + shown + more : "") : n.length ? "You and " + shown + more : "You and the people you choose"; }
    else if (aud.kind === "company") { glyph = "bank"; text = "Everyone in " + org + (app ? " who has " + app : ""); }
    else if (aud.kind === "readonly") { glyph = "calendar"; text = "Read-only · managed in " + (aud.source || "the linked calendar"); }
    else if (aud.kind === "mixed") { glyph = "people"; text = aud.text || "Private and shared items — each row says who sees it"; }
    else if (aud.kind === "swm") { glyph = "people"; text = "Shared with you by their owners — they decide who sees them"; }
    else if (aud.kind === "e2e") { glyph = "lock"; text = aud.text || "Only the people in this conversation · end-to-end encrypted"; }
    if (aud.text && aud.kind !== "mixed" && aud.kind !== "e2e") text = aud.text;
    const el = H("div", { class: "sh-visnote " + (aud.kind || "private"), title: text }, this.icon(glyph, "vn"), H("span", { class: "vn-t" }, text)); return el;
  },
  lockup(word) { const H = this.H.bind(this); return H("span", { class: "sh-lockup" }, this.wordmark(), H("span", { class: "sh-divider", "aria-hidden": "true" }, "|"), H("span", { class: "sh-appname" }, String(word || "SUITE").toUpperCase())); },
  wordmark(cls) { const sp = this.H("span", { class: "sh-wordmark" + (cls ? " " + cls : ""), "aria-label": "XYNTAX" }); const b = typeof BRAND !== "undefined" ? BRAND : {}; const art = cls === "word" ? b.wordmark : (b.lockup || b.wordmark); if (art) sp.innerHTML = art; else sp.textContent = b.word || "XYNTAX"; return sp; },
  icon(name, cls) { if (name === "settings" || name === "dial") name = "gear"; return this.svg(this.I[name] || "", "shic sh-g" + (cls ? " " + cls : "")); },
  // solid glyphs in brushed metal (filled with the page's #ptFill gradient): the bar, the quick rows, the menus
  PT: {
    shield: 'M24 4l16 6v12c0 10.5-6.6 18.7-16 22-9.4-3.3-16-11.5-16-22V10z M24 7.3L11 12.1V22c0 8.7 5.2 15.7 13 18.8 7.8-3.1 13-10.1 13-18.8v-9.9z M17.2 23.2l2.2-2.2 3.4 3.4 6.8-6.8 2.2 2.2-9 9z',
    xhome: 'M9.5 12.5l3-3L24 21l11.5-11.5 3 3L27 24l11.5 11.5-3 3L24 27 12.5 38.5l-3-3L21 24z',
    home: 'M24 5l19 16-2.2 2.6L38 21.3V43H28.5V31h-9v12H10V21.3l-2.8 2.3L5 21z M24 9.2L13.2 18.4V39.8H16.3V27.8h15.4v12h3.1V18.4z',
    text: 'M10 4h18l10 10v30H10z M26 4h2v12h-2z M26 14h12v2H26z M16 23h16v2.6H16z M16 30h16v2.6H16z M16 37h10v2.6H16z',
    todo: 'M6 12l3-3 3 3 7-7 3 3-10 10z M26 10.5h16v3H26z M6 26l3-3 3 3 7-7 3 3-10 10z M26 24.5h16v3H26z M6 40l3-3 3 3 7-7 3 3-10 10z M26 38.5h16v3H26z',
    voice: 'M24 5a7 7 0 0 1 7 7v12a7 7 0 0 1-14 0V12a7 7 0 0 1 7-7z M10.5 23h3a10.5 10.5 0 0 0 21 0h3a13.5 13.5 0 0 1-27 0z M22.5 36.5h3v5h-3z M17 41.5h14v3H17z',
    sketch: 'M33 5l10 10-21 21-13 3 3-13z M30.5 9.5l1.5-1.5 8 8-1.5 1.5z M12 29.5l1.5-1.5 6.5 6.5-1.5 1.5z',
    send: 'M4 21L44 5 36 43 24 32.5 16 39V28.5L34 13 12.5 25.5z',
    menu: 'M8 11h32v3H8z M8 22.5h32v3H8z M8 34h32v3H8z',
    back: 'M30 6l4 4-14 14 14 14-4 4-18-18z',
    search: 'M20 6a13 13 0 1 1 0 26 13 13 0 0 1 0-26z M20 10a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M29.5 27l3-3 10 10-3 3z',
    plus: 'M22.5 8h3v14.5H40v3H25.5V40h-3V25.5H8v-3h14.5z',
    more: 'M10 24a3.5 3.5 0 1 1 7 0 3.5 3.5 0 0 1-7 0z M20.5 24a3.5 3.5 0 1 1 7 0 3.5 3.5 0 0 1-7 0z M31 24a3.5 3.5 0 1 1 7 0 3.5 3.5 0 0 1-7 0z',
    list: 'M8 10h32v3H8z M8 19h32v3H8z M8 28h32v3H8z M8 37h20v3H8z',
    page: 'M10 4h18l10 10v30H10z M26 4h2v12h-2z M26 14h12v2H26z M16 23h16v2.6H16z M16 30h16v2.6H16z M16 37h10v2.6H16z',
    folder: 'M5 9h14l4 4h20v27H5z M8 16v21h32V16z',
    chart: 'M8 28h6v12H8z M18 20h6v20h-6z M28 24h6v16h-6z M38 10h6v30h-6z M6 42h40v2.4H6z',
    bank: 'M6 18L24 7l18 11v3H6z M9 25h4v11H9z M17.5 25h4v11h-4z M26.5 25h4v11h-4z M35 25h4v11h-4z M6 38.5h36v4.5H6z',
    arrows: 'M6 14.5h25l-5.5-5.5 2.5-2.5 9.8 9.8-9.8 9.8-2.5-2.5 5.5-5.5H6z M42 33.5H17l5.5 5.5-2.5 2.5-9.8-9.8 9.8-9.8 2.5 2.5-5.5 5.5h25z',
    clock: 'M24 5a19 19 0 1 1 0 38 19 19 0 0 1 0-38z M24 9a15 15 0 1 0 0 30 15 15 0 0 0 0-30z M22.5 13h3v11.5l7.5 4.5-1.5 2.6-9-5.4z',
    planned: 'M8 10h32v32H8z M11.5 18.5v20h25v-20z M14 6h3v7h-3z M31 6h3v7h-3z M16 28l2.5-2.5 4 4 8-8 2.5 2.5-10.5 10.5z',
    tag: 'M6 6h18l18 18-18 18L6 24z M13 11a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
    gear: 'M21 4h6l1 5.2 3.4 1.4 4.4-3 4.2 4.2-3 4.4 1.4 3.4L44 21v6l-5.2 1-1.4 3.4 3 4.4-4.2 4.2-4.4-3-3.4 1.4L27 44h-6l-1-5.2-3.4-1.4-4.4 3-4.2-4.2 3-4.4-1.4-3.4L4 27v-6l5.2-1 1.4-3.4-3-4.4 4.2-4.2 4.4 3 3.4-1.4z M24 17a7 7 0 1 0 0 14 7 7 0 0 0 0-14z',
    wallet: 'M6 10h30v5H9.5v2.5H42V40H6z M31 25a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z',
    calendar: 'M8 10h32v32H8z M11.5 18.5v20h25v-20z M14 6h3v7h-3z M31 6h3v7h-3z',
    grid: 'M7 7h15v15H7z M26 7h15v15H26z M7 26h15v15H7z M26 26h15v15H26z',
    tiles: 'M8 8h9v9H8z M19.5 8h9v9h-9z M31 8h9v9h-9z M8 19.5h9v9H8z M19.5 19.5h9v9h-9z M31 19.5h9v9h-9z M8 31h9v9H8z M19.5 31h9v9h-9z M31 31h9v9h-9z',
    cargo: 'M4 30h40l-5 9H9z M10 30V18h10v-6h8v6h6v12z M22 16h4v2h-4z',
    receipt: 'M11 4h26v40l-4.3-3-4.4 3-4.3-3-4.3 3-4.4-3L11 44z M17 14h14v2.6H17z M17 21h14v2.6H17z M17 28h9v2.6H17z',
    payout: 'M4 11h40v26H4z M7 20v14h34V20z M28 25a3.5 3.5 0 1 1 7 0 3.5 3.5 0 0 1-7 0z',
    desk: 'M5 8h38v26H5z M8.5 11.5v19h31v-19z M20 37h8v3h-8z M14 40h20v3H14z M12 27l6-6 5 4 8-8 2.5 2.5-10.5 10.5-5-4-3.5 3.5z',
    book: 'M8 6h26a6 6 0 0 1 6 6v30H14a6 6 0 0 1-6-6z M11.5 9.5v26.3A6 6 0 0 1 14 35.5h22.5V12a2.5 2.5 0 0 0-2.5-2.5z M11.5 38.5a2.5 2.5 0 0 0 2.5 2.5h22.5v-2.5z M17 15h13v2.6H17z',
    ledger: 'M9 4h30v40H9z M12.5 7.5v33h23v-33z M17 13h14v2.6H17z M17 20h14v2.6H17z M17 27h9v2.6H17z M17 34h14v2.6H17z',
    people: 'M18 7a7 7 0 1 1 0 14 7 7 0 0 1 0-14z M4 38a14 14 0 0 1 28 0v3H4z M32 11a6 6 0 0 1 0 12 9 9 0 0 0 0-12z M36 24a11 11 0 0 1 8 12v5h-8v-3a17 17 0 0 0-4-11z',
    trade: 'M6 14.5h25l-5.5-5.5 2.5-2.5 9.8 9.8-9.8 9.8-2.5-2.5 5.5-5.5H6z M42 33.5H17l5.5 5.5-2.5 2.5-9.8-9.8 9.8-9.8 2.5 2.5-5.5 5.5h25z',
    doc: 'M10 4h18l10 10v30H10z M26 4h2v12h-2z M26 14h12v2H26z M16 23h16v2.6H16z M16 30h16v2.6H16z M16 37h10v2.6H16z',
    star: 'M24 4l6 13.4 14.6 1.5-11 9.8 3.2 14.3L24 35.6 11.2 43l3.2-14.3-11-9.8 14.6-1.5z',
    upload: 'M22.5 15.5L14 24l-2.5-2.5L24 9l12.5 12.5L34 24l-8.5-8.5V34h-3z M8 38h32v3.5H8z',
    trash: 'M18 4h12v4h10v3.5H8V8h10z M11 14h26l-2 30H13z M15 18l1.5 22h3L18 18z M23.5 18v22h3V18z M30 18l-1.5 22h-3L27 18z',
    pin: 'M18 4h12v3h-2v10l5 5v3H27v12l-3 7-3-7V25H15v-3l5-5V7h-2z',
    history: 'M8 28h6v12H8z M18 20h6v20h-6z M28 24h6v16h-6z M38 10h6v30h-6z M6 42h40v2.4H6z',
    help: 'M24 4a20 20 0 1 1 0 40 20 20 0 0 1 0-40z M24 7.5a16.5 16.5 0 1 0 0 33 16.5 16.5 0 0 0 0-33z M24 13a7 7 0 0 1 7 7c0 3-2 4.3-3.6 5.4-1.3.9-1.9 1.5-1.9 3.1h-3c0-3.2 1.6-4.4 3.1-5.5 1.3-.9 2.4-1.6 2.4-3a4 4 0 0 0-8 0h-3a7 7 0 0 1 7-7z M22.3 32h3.4v3.4h-3.4z',
    theme: 'M24 4a20 20 0 1 1 0 40 20 20 0 0 1 0-40z M24 7.5v33a16.5 16.5 0 0 0 0-33z',
    lock: 'M14 21v-6a10 10 0 0 1 20 0v6h5v22H9V21z M18 21h12v-6a6 6 0 0 0-12 0z',
    people: 'M17 7a7 7 0 1 1 0 14 7 7 0 0 1 0-14z M31.5 11a5.5 5.5 0 1 1 0 11 5.5 5.5 0 0 1 0-11z M4 40c0-8.2 5.8-13.5 13-13.5S30 31.8 30 40z M31.5 26.5c6.6 0 11.5 4.6 11.5 11.5h-9.6c0-4.4-1.3-8.2-3.7-11.1z',
    ledger: 'M9 5h30v38H9z M12.5 8.5v31h23v-31z M16 14h16v2.6H16z M16 21h16v2.6H16z M16 28h10v2.6H16z M16 35h16v2.6H16z',
    desk: 'M5 9h38v25H5z M9 13v17h30V13z M20 36.5h8v4h-8z M13 40.5h22v3H13z M12 27l6-7 5 4 8-9 3 2.4-10.8 12-5.2-4.2L14.4 29z',
    book: 'M8 6h13a4.5 4.5 0 0 1 3 1.2A4.5 4.5 0 0 1 27 6h13v33H27a3 3 0 0 0-3 2 3 3 0 0 0-3-2H8z M11.5 9.5v26h9.5a6.4 6.4 0 0 1 1.3.3V11.4a2.8 2.8 0 0 0-1.3-1.9z M25.7 11.4v24.4a6.4 6.4 0 0 1 1.3-.3h9.5v-26h-9.5a2.8 2.8 0 0 0-1.3 1.9z',
    cargo: 'M6 16l18-9 18 9v18l-18 9-18-9z M10 18.6v13.2l12 6V24.6z M26 24.6v13.2l12-6V18.6z M24 10.4L12.9 16 24 21.6 35.1 16z',
    receipt: 'M10 4h28v40l-4-3-4 3-4-3-4 3-4-3-4 3-4-3z M14 8v30l4-3 4 3 4-3 4 3 4-3V8z M17 14h14v2.6H17z M17 20h14v2.6H17z M17 26h9v2.6H17z',
    payout: 'M4 12h40v24H4z M8 16v16h32V16z M24 18a6 6 0 1 1 0 12 6 6 0 0 1 0-12z M11 22h3v4h-3z M34 22h3v4h-3z',
  },
  LINE: { up: "arrowup", down: "arrowdown", phone: "phone", mail: "mail", whatsapp: "whatsapp", edit: "pen", check: "check", text: "doc", page: "doc", todo: "todo", voice: "mic", sketch: "pen", search: "search", menu: "menu", back: "back", plus: "plus", list: "list", folder: "folder", chart: "chart", history: "chart", bank: "bank", arrows: "trade", trade: "trade", clock: "clock", planned: "planned", tag: "tag", gear: "gear", settings: "gear", dial: "gear", sliders: "sliders", share: "share", mailbox: "mailbox", pen: "pen", arrow: "forward", forward: "forward", reply: "back", wallet: "wallet", calendar: "calendar", grid: "grid", tiles: "tiles", lock: "lock", upload: "upload", star: "star", trash: "trash", help: "help", theme: "theme", cargo: "cargo", receipt: "receipt", payout: "payout", desk: "desk", book: "book", ledger: "finance", people: "people", pin: "pin", home: "home", send: "send", more: "more", xhome: "xmark", copy: "copy", ship: "ship" },
  glyph(name, cls) { const sp = this.H("span", { class: "pt-ic" + (cls ? " " + cls : "") }); const ln = this.LINE[name]; if (ln && this.I[ln]) { sp.classList.add("pt-line"); sp.innerHTML = this.I[ln].replace("<svg ", '<svg aria-hidden="true" '); return sp; } sp.innerHTML = '<svg viewBox="0 0 48 48" aria-hidden="true"><path fill-rule="evenodd" d="' + (this.PT[name] || "") + '"/></svg>'; return sp; },
  iconBtn(name, title, onclick, cls) { const b = this.H("button", { class: "quiet sh-ib" + (cls ? " " + cls : ""), title, "aria-label": title, onclick }); b.append(this.LINE[name] ? this.glyph(name) : this.icon(name)); return b; },
  apps: {}, state: {}, current: null, host: null, _ver: "",
  register(id, mod) { this.apps[id] = mod; },
  app(id) { return this.APPS.find((a) => a.id === id); },
  allowed(id) { if (id === "settings") return true; return typeof CLOUD === "undefined" || !CLOUD.signedIn() ? true : CLOUD.hasApp(id); },
  userLabel() { if (typeof CLOUD === "undefined" || !CLOUD.signedIn()) return "This computer"; const s = CLOUD.session() || {}; return CLOUD.shown(CLOUD.state.email || s.email || ""); },
  orgLabel() { if (typeof CLOUD === "undefined" || !CLOUD.signedIn()) return "local book"; return CLOUD.state.isOwner && !CLOUD.active() ? "Software owner" : (CLOUD.state.orgName || (CLOUD.session() || {}).org_name || ""); },

  // ---------- tiny DOM helper, independent of the host's
  H(tag, attrs, ...kids) { const el = document.createElement(tag); for (const [k, v] of Object.entries(attrs || {})) { if (v == null || v === false) continue; if (k === "class") el.className = v; else if (k.startsWith("on")) el.addEventListener(k.slice(2), v); else if (k === "style") el.setAttribute("style", v); else if (k === "html") el.innerHTML = v; else if (k === "draggable") el.setAttribute(k, v ? "true" : "false"); else el.setAttribute(k, v === true ? "" : v); } const add = (x) => { if (x == null || x === false) return; if (Array.isArray(x)) x.forEach(add); else el.append(x.nodeType ? x : document.createTextNode(String(x))); }; kids.forEach(add); return el; },
  // 4.34 · stored or received rich text (a note's body — yours or a colleague's shared page —, an email's body) before it is drawn: an
  // allow-list. Tags that carry writing stay (unknown ones are unwrapped, their text kept; script, style, frames, forms, SVG, meta, base and
  // the like go with their content); attributes that carry writing stay (never id, name or a handler); a style keeps only harmless
  // properties (no position, no z-index, nothing with url()); a link goes to http, https, mailto or a place in this page and never
  // keeps a handle on the window; a picture comes from the message or the note itself (data:, blob:, cid:) or over https.
  // (what goes with its content is what carries no writing of the person's: code, style sheets, frames, plug-ins, media, drawings. A
  // form, a button, a list box, a text box, a dialog — a page copied from the web is often wrapped in one — are unwrapped like any
  // unknown tag: the words inside stay. Dropping them took the whole pasted page with them, and the next save made that permanent.)
  cleanHtml(html, opt) {
    const s = String(html == null ? "" : html); if (!s || !/[<&]/.test(s)) return s; opt = opt || {};
    const TAGS = this._okTags || (this._okTags = new Set("a,abbr,b,blockquote,br,caption,center,cite,code,col,colgroup,dd,del,details,div,dl,dt,em,figcaption,figure,font,h1,h2,h3,h4,h5,h6,hr,i,img,input,ins,kbd,label,li,mark,ol,p,pre,q,s,small,span,strike,strong,sub,summary,sup,table,tbody,td,tfoot,th,thead,tr,tt,u,ul,var,wbr".split(",")));
    const DROP = this._noTags || (this._noTags = new Set("script,style,iframe,frame,frameset,object,embed,applet,meta,base,link,svg,math,template,noscript,title,head,audio,video,source,track,canvas,xmp,plaintext,noembed,noframes".split(",")));
    const ATTR = this._okAttr || (this._okAttr = new Set("class,href,src,alt,title,colspan,rowspan,width,height,align,valign,bgcolor,border,cellpadding,cellspacing,color,face,size,dir,lang,start,type,checked,disabled,contenteditable,style,target,rel,span,open,cite,datetime".split(",")));
    const PROP = this._okProp || (this._okProp = /^(color|background-color|background|font|font-(weight|style|size|family|variant)|text-(decoration|decoration-line|align|indent|transform)|line-height|letter-spacing|white-space|word-break|vertical-align|list-style-type|margin(-(top|right|bottom|left))?|padding(-(top|right|bottom|left))?|border(-(top|right|bottom|left))?(-(width|style|color))?|border-(collapse|spacing|radius)|width|height|max-width|min-width|display|table-layout|direction)$/);
    const t = document.createElement("template"); t.innerHTML = s;
    const style = (v) => String(v).split(";").map((d) => { const i = d.indexOf(":"); if (i < 0) return ""; const k = d.slice(0, i).trim().toLowerCase(), val = d.slice(i + 1).trim(); if (!PROP.test(k) || !val || /url\s*\(|expression|[\\@<>{}]|javascript|image-set|var\s*\(|attr\s*\(/i.test(val) || (k === "display" && !/^(inline|block|inline-block|none|table|table-row|table-cell|list-item)$/i.test(val))) return ""; return k + ": " + val; }).filter(Boolean).join("; ");
    const walk = (node) => { for (const el of [...node.children]) { const tag = el.localName; if (el.namespaceURI !== "http://www.w3.org/1999/xhtml" || DROP.has(tag)) { el.remove(); continue; } walk(el.content && tag === "template" ? el.content : el); if (!TAGS.has(tag)) { el.replaceWith(...el.childNodes); continue; }
        for (const a of [...el.attributes]) { const n = a.name.toLowerCase(), v = a.value; let keep = ATTR.has(n) || /^data-[a-z0-9-]+$/.test(n);
          if (keep && n === "style") { const c = style(v); if (c) el.setAttribute("style", c); else keep = false; }
          else if (keep && n === "href") keep = tag === "a" && /^(https?:\/\/|mailto:|tel:[+0-9() .-]+$|#)/i.test(v.trim()) && !/[\u0000-\u001f]/.test(v);
          else if (keep && n === "src") keep = tag === "img" && (/^(data:image\/(png|jpe?g|gif|webp|bmp);|blob:|cid:)/i.test(v.trim()) || (/^https:\/\//i.test(v.trim()) && !opt.mail));
          else if (keep && n === "type") keep = tag === "input" && v.toLowerCase() === "checkbox"; else if (keep && n === "contenteditable") keep = v === "false"; else if (keep && (n === "target" || n === "rel")) keep = false; else if (keep && n === "class") keep = !/(^|\s)(sh-|xw|updbar|ub-)/.test(v) || /(^|\s)nt-/.test(v) && !/(^|\s)(sh-|xw|updbar|ub-)/.test(v);
          if (!keep) el.removeAttribute(a.name); }
        if (tag === "input" && el.getAttribute("type") !== "checkbox") { el.remove(); continue; }
        if (tag === "a" && /^(https?:|mailto:)/i.test(el.getAttribute("href") || "")) { el.setAttribute("target", "_blank"); el.setAttribute("rel", "noopener noreferrer"); } } };
    walk(t.content); return t.innerHTML;
  },
  svg(markup, cls) { const d = document.createElement("span"); d.className = "shic" + (cls ? " " + cls : ""); d.innerHTML = markup; return d; },
  esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); },
  uid() { return (Date.now().toString(36) + Math.random().toString(36).slice(2, 8)).toUpperCase(); },
  today() { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); },
  nowLocal() { const d = new Date(); return this.today() + "T" + String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0"); },
  fmtDate(s) { if (!s) return "—"; const d = new Date(s.length <= 10 ? s + "T00:00" : s); if (isNaN(d)) return s; return SUITE_FMT.date(d); },
  fmtDT(s) { if (!s) return "—"; const d = new Date(s); if (isNaN(d)) return s; return SUITE_FMT.date(d) + " " + SUITE_FMT.time(d); },
  fmtTime(s) { const d = new Date(s); return isNaN(d) ? "" : String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0"); },
  ago(s) { if (!s) return ""; const ms = Date.now() - new Date(s).getTime(); const m = Math.round(ms / 60000); if (m < 1) return "just now"; if (m < 60) return m + " min ago"; const hh = Math.round(m / 60); if (hh < 24) return hh + " h ago"; const dd = Math.round(hh / 24); if (dd < 30) return dd + " d ago"; return this.fmtDate(s.slice(0, 10)); },
  fmtBytes(n) { n = +n || 0; if (n < 1024) return n + " B"; if (n < 1048576) return (n / 1024).toFixed(0) + " KB"; if (n < 1073741824) return (n / 1048576).toFixed(1) + " MB"; return (n / 1073741824).toFixed(2) + " GB"; },
  money(n, ccy, dp) { if (n == null || isNaN(n)) return "—"; const v = SUITE_FMT.num(+n, dp == null ? 2 : dp, dp == null ? 2 : dp); return (ccy ? ccy + " " : "") + v; },
  compact(n) { n = +n || 0; const a = Math.abs(n); return (n < 0 ? "-" : "") + (a >= 1e9 ? (a / 1e9).toFixed(2) + "bn" : a >= 1e6 ? (a / 1e6).toFixed(2) + "m" : a >= 1e4 ? (a / 1e3).toFixed(0) + "k" : a.toLocaleString("en-US", { maximumFractionDigits: 0 })); },
  csv(cols, rows) { const q = (v) => { const s = String(v == null ? "" : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }; return [cols.map(q).join(","), ...rows.map((r) => r.map(q).join(","))].join("\n"); },
  toast(m) { if (this.host && this.host.toast) this.host.toast(m); else if (typeof toast === "function") toast(m); },
  readFile(file, as) { return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); if (as === "text") r.readAsText(file); else if (as === "dataurl") r.readAsDataURL(file); else r.readAsArrayBuffer(file); }); },
  async copy(text) { try { await navigator.clipboard.writeText(text); this.toast("Copied"); } catch (e) { const t = document.createElement("textarea"); t.value = text; document.body.append(t); t.select(); document.execCommand("copy"); t.remove(); this.toast("Copied"); } },
  async download(name, blob) { if (this.host && this.host.saveFile) return this.host.saveFile(name, blob); const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000); return true; },
  pickFiles(opt) { if (this.host && this.host.pickFiles) return this.host.pickFiles(opt || {}); return new Promise((res) => { const i = document.createElement("input"); i.type = "file"; if (opt && opt.accept) i.accept = opt.accept; if (!opt || opt.multiple !== false) i.multiple = true; i.style.display = "none"; document.body.append(i); i.onchange = () => { res(Array.from(i.files)); i.remove(); }; i.oncancel = () => { res([]); i.remove(); }; i.click(); }); },
  isMobile() { return !!(this.host && this.host.mobile) || window.innerWidth < 760; },

  // ---------- dashboard
  greeting() { const hh = new Date().getHours(); return hh < 5 ? "Good night" : hh < 12 ? "Good morning" : hh < 17 ? "Good afternoon" : "Good evening"; },
  profileMenu(anchor) {
    const signed = typeof CLOUD !== "undefined" && CLOUD.signedIn(); const who = this.userLabel(); const org = this.orgLabel();
    const items = [{ l: who || "Not signed in", d: org || (signed ? "no company" : ""), disabled: true, fn: () => {} }, { sep: 1 }];
    if (signed) items.push({ l: "Profile", fn: () => this.open("settings", { view: "profile" }) });
    if (signed && this.canSwitch()) items.push({ l: "Switch company", fn: () => this.switchCompany() });
    if (this.lock && this.lock.available && this.lock.available()) items.push({ l: "Lock", fn: () => this.lockNow() });
    if (signed) items.push({ sep: 1 }, { l: "Sign out", danger: 1, fn: () => this.signOut() });
    return this.menu(anchor, items);
  },
  home(root) {
    const H = this.H.bind(this); root.innerHTML = ""; root.classList.add("sh-home");
    const light = this.isLight(); const signed = typeof CLOUD !== "undefined" && CLOUD.signedIn();
    const who = this.userLabel();
    root.append(H("header", { class: "sh-top" }, H("div", { class: "sh-brand" }, this.lockup("SUITE")), H("div", { class: "sh-right" }, /* 4.8.3: the bell (placed by NOTIFY) and a small profile button; who you are and where sit in its menu */ H("button", { class: "quiet sh-ib sh-profile", title: who + (this.orgLabel() ? " · " + this.orgLabel() : ""), "aria-label": "Account", onclick: (e) => this.profileMenu(e.currentTarget) }, this.icon("user")))));
    const wrap = H("div", { class: "sh-homebody" }); root.append(wrap);
    const tiles = H("div", { class: "sh-tiles" }); const sums = {};
    for (const a of this.APPS) {
      const ok = this.allowed(a.id); const corp = a.id === "accounting" || a.id === "proship" || a.id === "compliance"; const corpWhat = a.id === "proship" ? "the fleet" : a.id === "compliance" ? "COMPLIANCE" : "the books"; /* 4.12: PROSHIP belongs to a company like the books */ const canOpen = ok && (a.id !== "documents" || this.vaultAvailable()) && (!corp || !(this.host && this.host.accountingAvailable) || this.host.accountingAvailable()); const personal = typeof CLOUD !== "undefined" && CLOUD.personal && CLOUD.personal(); const sum = H("span", { class: "sh-sum" }, canOpen ? "" : (corp && personal ? "Create or join a company" : !ok ? "Not enabled for your user" : "Needs a workspace")); sums[a.id] = sum;
      tiles.append(H("button", { class: "sh-tile" + (canOpen ? "" : " locked"), "data-app": a.id, title: corp && personal ? (a.id === "proship" ? "PROSHIP" : a.id === "compliance" ? "COMPLIANCE" : "Accounting") + " belongs to a company: create one or accept an invitation" : !ok ? "Not enabled for your user. Your administrator can switch it on." : a.id === "documents" && !canOpen ? "Documents need a workspace: sign in with a company user to use them" : corp && !canOpen ? (a.id === "proship" ? "The fleet belongs to a company: sign in with a company user" : a.id === "compliance" ? "COMPLIANCE belongs to a company: sign in with a company user" : "The books belong to a company: sign in with a company user") : a.desc + (+a.n > 10 ? "" : " · press " + (a.n === "10" ? "0" : a.n.replace(/^0/, ""))), onclick: () => { if (canOpen) this.open(a.id); else if (corp && personal) this.open("settings", { view: "companies" }); else this.toast(!ok ? a.name + " is not enabled for your user" : corp ? "Sign in with a company user to open " + corpWhat : "Documents need a workspace"); } }, this.glyph(({ accounting: "ledger", proship: "ship", notes: "text", wealth: "wallet", calendar: "calendar", documents: "folder", messages: "send", contacts: "people", mail: "mail", settings: "gear", compliance: "shield" })[a.id] || "grid", "sh-i"), !canOpen ? this.svg(this.LOCK, "sh-lock") : null, H("span", { class: "sh-name" }, a.name), sum));
    }
    wrap.append(tiles); this.setup.mount(wrap);
    root.append(H("footer", { class: "sh-foot" }, H("span", {}, "XYNTAX " + (this._ver || "")), H("span", { class: "sh-keys" }, this.isMobile() ? "" : "1 – 9 and 0 open an app · Esc returns here · ? help · L lock")));
    if (this.isMobile()) { const key = (g, l, fn, cls) => H("button", { class: cls || "", onclick: fn }, this.glyph(g), H("span", {}, l)); root.append(H("nav", { class: "sh-tabs sh-hometabs" }, key("lock", "Lock", () => this.lockNow()), key("gear", "Settings", () => this.open("settings")), key("tiles", "Home", () => {}, "homekey on"), signed && this.canSwitch() ? key("people", "Company", () => this.switchCompany()) : key("calendar", "Calendar", () => this.open("calendar")), signed ? key("back", "Sign out", () => this.signOut()) : key("text", "Notes", () => this.open("notes")))); }
    document.body.dataset.app = "home";
    // live one-liners under the tiles (what is new in each app), loaded quietly
    (async () => { SUITE.perf.start("home summaries"); this.db.hush(); const enc = await this.e2e.enabled(); const locked = enc && !(await this.e2e.ensure()); /* 4.8: all at once, not one after the other */ await Promise.all(this.APPS.map(async (a) => { const mod = this.apps[a.id]; if (!mod || !mod.summary || !this.allowed(a.id) || (a.id === "documents" && !this.vaultAvailable())) return; if (locked && ["notes", "wealth", "calendar"].includes(a.id)) { if (sums[a.id]) sums[a.id].textContent = "Encrypted · opens with your passphrase"; return; } try { const t = await mod.summary(); if (t && sums[a.id]) sums[a.id].textContent = t; } catch (e) { /* nothing */ } })); this.db.unhush(); SUITE.perf.end("home summaries"); })();
    if (typeof CLOUD !== "undefined" && CLOUD.active() && sums.accounting) { try { const st = typeof S !== "undefined" && S.store; if (st) { const open = st.invoices.filter((i) => typeof E !== "undefined" && E.docOpen(i) > 0.01).length; sums.accounting.textContent = st.trades.length + " trades · " + open + " open invoices"; } } catch (e) { /* no book yet */ } }
    if (!this._keys) { this._keys = true; document.addEventListener("keydown", (e) => { if (this.staleFocus(e)) e.target.blur(); if (!root.classList.contains("open") || (e.target.closest && e.target.closest("input,textarea,select,[contenteditable]") && !this.staleFocus(e)) || e.ctrlKey || e.metaKey || e.altKey) return; if (document.querySelector("#shdlg.open, .sh-pal-wrap")) return; if (e.key === "?") { e.preventDefault(); this.shortcuts(); return; } if (e.key === "/") { e.preventDefault(); if (this.palette2) this.palette2(); else this.globalSearch(); return; } const i = "1234567890".indexOf(e.key); const byKey = i >= 0 ? this.APPS.find((x) => +x.n === i + 1) : null; /* 4.33: by the app's number — COMPLIANCE (11) sits before SETTINGS and has no key */ if (byKey) { const a = byKey; if (this.allowed(a.id) && (a.id !== "documents" || this.vaultAvailable())) this.open(a.id); } if (e.key === "l" || e.key === "L") this.lockNow(); }); }
  },
  vaultAvailable() { return typeof CLOUD === "undefined" || !CLOUD.signedIn() || CLOUD.signedIn(); },
  // 4.17 · a field that keeps the focus after its sheet or dialog closed (hidden, or inside #sheet / #shdlg that is no longer open)
  staleFocus(e) { const t = e && e.target; if (!t || !t.closest || !t.closest("input,textarea,select,[contenteditable]")) return false; if (t.closest("#sheet:not(.open), #shdlg:not(.open)")) return true; return !t.isConnected || (t.offsetParent === null && getComputedStyle(t).position !== "fixed"); },
  // 4.17 · the search box of the app in view (the Documents-style quick search, else the first search field of the page)
  focusSearch() { const root = document.getElementById("sapp"); if (!root || !root.classList.contains("open")) return false; const cand = [...root.querySelectorAll(".nt-quick input, .sh-main input[type=search], .sh-main input[placeholder^='Search'], .sh-side input[placeholder^='Search']")].find((i) => i.offsetParent); if (!cand) return false; cand.focus(); try { cand.setSelectionRange(cand.value.length, cand.value.length); } catch (e) { /* not a text input */ } return true; },
  // ---------- 4.17 · the first-run checklist on the home page: what a new company still has to set up, read from the real state
  // (entities and banks in the book, colleagues and their apps, the PROSHIP fleet), each step one click away; it disappears when
  // everything is done and can be hidden per company. Viewers and personal accounts never see it.
  setup: {
    _members: null, _box: null,
    org() { try { const c = typeof CLOUD !== "undefined" ? CLOUD : null; return (c && c.signedIn() && ((c.state && c.state.org) || (c.session() || {}).org_id)) || "local"; } catch (e) { return "local"; } },
    cloud() { return typeof CLOUD !== "undefined" && CLOUD.signedIn(); },
    applies() {
      if (this.cloud() && (!CLOUD.active() || (CLOUD.personal && CLOUD.personal()) || !CLOUD.canEdit())) return false;
      if (typeof S === "undefined" || !S.store || S.ownerConsole || S.personal) return false;
      return SUITE.allowed("accounting") || SUITE.allowed("proship");
    },
    hidden() { const p = SUITE.prefs.get(); return !!((p.setupHidden || {})[this.org()]); },
    hide(on) { const p = SUITE.prefs.get(); const h = { ...(p.setupHidden || {}) }; if (on === false) delete h[this.org()]; else h[this.org()] = Date.now(); SUITE.prefs.set({ setupHidden: h }); },
    mark(what) { const p = SUITE.prefs.get(); const m = { ...(p.setupSeen || {}) }; m[this.org() + ":" + what] = Date.now(); SUITE.prefs.set({ setupSeen: m }); },
    seen(what) { return !!((SUITE.prefs.get().setupSeen || {})[this.org() + ":" + what]); },
    // colleagues and app limits (administrators only; the members list comes from the admin function, cached five minutes)
    async members() {
      if (!(this.cloud() && CLOUD.active() && CLOUD.isAdmin && CLOUD.isAdmin())) return null;
      const c = this._members; if (c && c.org === this.org() && Date.now() - c.at < 300000) return c;
      try { const list = await CLOUD.admin("org_users", { org: this.org() }); this._members = { org: this.org(), at: Date.now(), n: (list || []).length, limited: (list || []).some((m) => Array.isArray(m.apps) && m.apps.length) }; return this._members; } catch (e) { return null; }
    },
    fleet() { let n = 0; try { if (typeof PS !== "undefined" && PS.data && PS.data()) n = (PS.data().vessels || []).length; } catch (e) { /* not loaded */ } try { n = Math.max(n, ((S.store && S.store.vessels) || []).length); } catch (e) { /* no book */ } return n; },
    async items() {
      const st = S.store || {}; const ents = st.entities || [], banks = st.banks || []; const admin = !this.cloud() || (CLOUD.isAdmin && CLOUD.isAdmin()); const acc = SUITE.allowed("accounting"), ps = SUITE.allowed("proship");
      const openAcc = (then) => { SUITE.open("accounting", { view: "entities" }); setTimeout(() => { try { then && then(); } catch (e) { SUITE.toast(e.message); } }, 450); };
      const out = [];
      if (acc) {
        out.push({ id: "entity", l: "Create the company entity", d: ents.length ? ents.map((e) => e.name).slice(0, 2).join(", ") + (ents.length > 2 ? " +" + (ents.length - 2) : "") : admin ? "name, country, recording currency, address and TRN — every invoice and posting belongs to one" : "an administrator of the company creates it", done: ents.length > 0, cta: admin ? "Create" : null, fn: () => openAcc(() => { if (typeof forms !== "undefined" && forms.entity && !(S.store.entities || []).length) forms.entity(); }) });
        out.push({ id: "bank", l: "Add a bank account", d: banks.length ? banks.length + (banks.length === 1 ? " account" : " accounts") : "where money comes in and goes out; statements import into it", done: banks.length > 0, cta: ents.length ? "Add" : null, fn: () => openAcc(() => { if (typeof forms !== "undefined" && forms.bank && S.store.entities[0]) forms.bank(S.store.entities[0].id); }) });
      }
      if (this.cloud() && admin) {
        const m = await this.members();
        out.push({ id: "invite", l: "Invite your colleagues", d: m && m.n > 1 ? m.n + " people in the company" : "each person signs in with a username and a temporary password", done: !!(m && m.n > 1), cta: "Invite", fn: () => { this.mark("users"); SUITE.open("settings", { view: "users" }); } });
        out.push({ id: "apps", l: "Choose the apps each person opens", d: m && m.limited ? "app access set per person" : this.seen("users") ? "reviewed — everyone sees every app" : "a trader may not need PROSHIP, a captain not ACCOUNTING", done: !!(m && m.limited) || this.seen("users"), cta: "Review", fn: () => { this.mark("users"); SUITE.open("settings", { view: "users" }); } });
      }
      if (ps) { const n = this.fleet(); out.push({ id: "vessel", l: "Onboard a vessel in PROSHIP", d: n ? n + (n === 1 ? " vessel" : " vessels") + " on file" : "IMO and MMSI — positions, fixtures and voyage accounts follow", done: n > 0, cta: "Onboard", fn: () => SUITE.open("proship") }); }
      return out;
    },
    demoOk() { try { return typeof XDEMO !== "undefined" && typeof XDEMO.load === "function" && !(XDEMO.present && XDEMO.present()); } catch (e) { return false; } },
    async loadDemo() { try { await XDEMO.load(); SUITE.showHome(); } catch (e) { if (e && e.message && e.message !== "cancelled") SUITE.toast(e.message); } },
    mount(wrap) {
      return; /* 4.34.3: the "Set up your company" panel is no longer shown on the suite home */ // eslint-disable-next-line no-unreachable
      if (!this.applies() || this.hidden()) return; const H = SUITE.H.bind(SUITE); const box = H("section", { class: "sh-setup", "aria-label": "Set up your company" }); this._box = box; wrap.append(box);
      this.fill(box);
      if (!this._listen) { this._listen = true; const again = () => { const b = this._box; if (b && b.isConnected && document.querySelector("#home.open")) this.fill(b); }; document.addEventListener("xyntax:saved", () => setTimeout(again, 300)); document.addEventListener("xyntax:book-loaded", again); window.addEventListener("focus", again); }
    },
    async fill(box) {
      const H = SUITE.H.bind(SUITE); const list = await this.items(); if (!box.isConnected) return; box.innerHTML = "";
      const done = list.filter((x) => x.done).length; if (!list.length || done === list.length) { box.remove(); return; }
      const pct = Math.round((done / list.length) * 100); const next = list.find((x) => !x.done);
      const row = (x) => H("li", { class: x.done ? "done" : "" }, H("span", { class: "ck", "aria-hidden": "true" }, x.done ? SUITE.icon("check") : null), H("span", { class: "tx" }, H("span", { class: "l" }, x.l), H("span", { class: "d" }, x.d)), !x.done && x.cta ? H("button", { class: x === next ? "primary" : "", onclick: () => x.fn() }, x.cta) : H("span", { class: "st" }, x.done ? "done" : ""));
      const hide = H("button", { class: "quiet sh-setup-x", title: "Hide this checklist (Settings → Your data brings it back)", onclick: () => { this.hide(); box.remove(); } }, "Hide");
      const demo = this.demoOk() && !((S.store.entities || []).length) ? H("div", { class: "ft" }, H("span", {}, "Just looking around?"), H("button", { class: "quiet", onclick: () => this.loadDemo() }, "Load demo data")) : null;
      if (SUITE.isMobile()) {
        box.classList.add("mini"); box.append(H("button", { class: "sh-setup-strip", onclick: () => SUITE.dialog({ title: "Set up your company", text: done + " of " + list.length + " done", body: H("div", { class: "sh-setup in-dlg" }, H("ol", {}, list.map((x) => { const li = row(x); const b = li.querySelector("button"); if (b) { const f = b.onclick; b.onclick = () => { const d = document.getElementById("shdlg"); if (d) { d.classList.remove("open"); d.innerHTML = ""; } f(); }; } return li; })), demo), ok: " ", cancel: "Close" }) }, H("span", { class: "t" }, "Set up your company"), H("span", { class: "n" }, done + " of " + list.length), H("span", { class: "bar" }, H("i", { style: "width:" + pct + "%" })), SUITE.icon("forward")));
        return;
      }
      box.append(H("div", { class: "hd" }, H("span", { class: "t" }, "Set up your company"), H("span", { class: "n" }, done + " of " + list.length + " done"), H("span", { class: "bar" }, H("i", { style: "width:" + pct + "%" })), hide), H("ol", {}, list.map(row)), demo);
    },
  },
  showHome() { this.perf.mark("home"); this.reminders.start(); this.lock.start(); this.closeApp(); document.body.dataset.app = "home"; this.nav.mark(""); const home = document.getElementById("home"); this.home(home); home.classList.add("open"); const sapp = document.getElementById("sapp"); if (sapp) sapp.classList.remove("open"); if (this.host && this.host.onHome) this.host.onHome(); },

  // ---------- 4.10 · one step back: the trail of where the person has been (state descriptors, never DOM), and the
  // single back() every entry point uses — the header arrow, the phone's Back key, Android's gesture/hardware back
  // (through phone.js), the WebView's popstate. Apps step themselves with onBack()/onEsc(); the trail carries the
  // cross-app part (previous app, then home). While a back is in flight, marks pop instead of push, so the trail
  // shrinks as you go back and grows as you go forward.
  nav: {
    stack: [], max: 80, backing: false, _guard: false,
    key() { return (SUITE.current || (document.body.dataset.app === "accounting" ? "accounting" : "home")); },
    mark(desc) {
      const e = { app: this.key(), desc: String(desc == null ? "" : desc) }; const top = this.stack[this.stack.length - 1];
      if (this.backing) { this.stack.pop(); const t2 = this.stack[this.stack.length - 1]; if (!(t2 && t2.app === e.app && t2.desc === e.desc)) this.stack.push(e); return; }
      if (top && top.app === e.app && top.desc === e.desc) return;
      this.stack.push(e); if (this.stack.length > this.max) this.stack.shift(); this.arm();
    },
    previousApp() { const cur = this.key(); for (let i = this.stack.length - 1; i >= 0; i--) { if (this.stack[i].app !== cur) { this.stack.length = i + 1; return this.stack[i].app; } } this.stack.length = 0; return null; },
    // the WebView keeps one spare history entry so a swipe-back lands on popstate (handled by back()) instead of leaving the page
    // the guard is re-pushed after every pop, so inside the app shells (Capacitor WebView, Electron) back never leaves the
    // page; a plain browser tab is left alone so its own back still works — the test harness opts in with window.__forceNav
    arm() { if (typeof history === "undefined" || this._guard) return; if (!(window.Capacitor || window.xyntax || /Electron/i.test(navigator.userAgent) || window.__forceNav)) return; try { history.replaceState({ xyntax: "base" }, ""); history.pushState({ xyntax: "guard" }, ""); this._guard = true; window.addEventListener("popstate", () => { this._guard = false; SUITE.back({ fromHistory: true }); try { history.pushState({ xyntax: "guard" }, ""); this._guard = true; } catch (e) { /* nothing */ } }); } catch (e) { /* file:// or a locked-down WebView */ } },
  },
  back(opt) {
    opt = opt || {};
    // 1 · anything floating closes first
    const dlg = document.querySelector("#shdlg.open"); if (dlg) { if (dlg.dataset.noback) return true; /* a dialog that must be completed (recovery key, first passphrase, terms) swallows the press */ const c = dlg.querySelector(".sh-dbtns button:not(.primary)"); if (c) c.click(); /* no cancel (the lock screen, a custom card): swallowed, never dismissed */ return true; }
    const sh = document.getElementById("sheet"); if (sh && sh.classList.contains("open")) { if (typeof sheet !== "undefined" && sheet.close) sheet.close(); else sh.classList.remove("open"); return true; }
    const en = document.querySelector(".sh-enlarge"); if (en) { if (en._close) en._close(); else en.remove(); return true; }
    const ex = document.querySelector(".expand"); if (ex) { ex.remove(); return true; }
    const menu = document.getElementById("shmenu"); if (menu) { menu.remove(); return true; }
    if (this.NOTIFY && this.NOTIFY.open) { this.NOTIFY.close(); return true; }
    const pal = document.querySelector(".sh-pal, .sh-pal-wrap"); if (pal) { pal.remove(); return true; }
    const view = document.querySelector("#shview.open"); if (view) { if (view._closeAll) view._closeAll(); else view.classList.remove("open"); return true; }
    // 2 · the accounting desk: selection, then home
    if (!this.current && document.body.dataset.app === "accounting") { if (typeof S !== "undefined" && S.sel) { S.sel = null; if (typeof renderInspector === "function") { renderInspector(); if (typeof highlightSel === "function") highlightSel(); } return true; } this.showHome(); return true; }
    // 3 · at home there is nothing above: the caller decides (the phone minimises)
    if (!this.current) return false;
    const mod = this.apps[this.current]; this.nav.backing = true;
    try {
      if (mod && mod.onBack && mod.onBack()) return true;
      if (mod && mod.onEsc && mod.onEsc()) return true;
    } finally { this.nav.backing = false; }
    // 4 · the app is at its root: the previous app, else home
    const prev = this.nav.previousApp();
    if (prev && prev !== "home" && prev !== "accounting" && this.apps[prev] && this.allowed(prev)) { this.open(prev); return true; }
    this.showHome(); return true;
  },
  // ---------- 4.10 · filter chips: one row under every search box. spec = { key, groups: [{ id, label?, multi, options: [{ v, l }] }],
  // value: { [groupId]: v | [v] }, onChange(value) }. Selections persist per app on this device.
  chips(spec) {
    const H = this.H.bind(this); const storeKey = "xyntax.filters." + spec.key;
    const read = () => { try { return JSON.parse(localStorage.getItem(storeKey) || "null"); } catch (e) { return null; } };
    const val = spec.value || read() || {}; const write = () => { try { localStorage.setItem(storeKey, JSON.stringify(val)); } catch (e) { /* storage */ } };
    // a remembered choice whose option no longer exists (a calendar unlinked, a tag gone) is dropped, not silently applied
    let pruned = false; for (const g of spec.groups) { if (!g || !(g.id in val) || !val[g.id]) continue; const ok = new Set((g.options || []).map((o) => String(o.v))); if (g.multi) { const a = (Array.isArray(val[g.id]) ? val[g.id] : []).filter((v) => ok.has(String(v))); if (a.length !== (val[g.id] || []).length) { val[g.id] = a; pruned = true; } } else if (!ok.has(String(val[g.id]))) { val[g.id] = null; pruned = true; } }
    if (pruned) write();
    const active = () => Object.keys(val).some((k) => Array.isArray(val[k]) ? val[k].length : val[k]);
    const row = H("div", { class: "sh-filters" + (active() ? " active" : ""), role: "group", "aria-label": "Filters" });
    const draw = () => {
      row.innerHTML = ""; row.classList.toggle("active", active());
      for (const g of spec.groups) {
        if (!g || !g.options || !g.options.length) continue;
        const cur = val[g.id]; const isOn = (v) => g.multi ? Array.isArray(cur) && cur.includes(v) : cur === v;
        if (g.label) row.append(H("span", { class: "sh-flabel" }, g.label));
        for (const o of g.options) row.append(H("button", { type: "button", class: "sh-fchip" + (isOn(o.v) ? " on" : ""), "data-group": g.id, "data-v": String(o.v), "aria-pressed": isOn(o.v) ? "true" : "false", onclick: () => { if (g.multi) { const a = Array.isArray(cur) ? cur.slice() : []; const i = a.indexOf(o.v); if (i >= 0) a.splice(i, 1); else a.push(o.v); val[g.id] = a; } else val[g.id] = isOn(o.v) ? null : o.v; write(); draw(); spec.onChange(val); } }, o.l, o.n != null ? H("span", { class: "n" }, String(o.n)) : null));
        row.append(H("span", { class: "sh-fsep" }));
      }
      if (active()) row.append(H("button", { type: "button", class: "sh-fchip sh-fclear", onclick: () => { for (const k of Object.keys(val)) delete val[k]; write(); draw(); spec.onChange(val); } }, "Clear"));
    };
    draw(); row.value = val; return row;
  },
  clearFiltersButton(label) { return this.H("button", { class: "quiet", style: "margin-top:10px", onclick: () => { const c = document.querySelector("#sapp .sh-filters .sh-fclear"); if (c) c.click(); } }, label || "Clear filters"); },
  filterValue(key) { try { return JSON.parse(localStorage.getItem("xyntax.filters." + key) || "null") || {}; } catch (e) { return {}; } },
  // ---------- the frame a suite app runs in
  open(id, opt) {
    this.perf.mark("open " + id);
    if (id === "accounting") { this.closeApp(); document.body.dataset.app = "accounting"; document.getElementById("home").classList.remove("open"); document.getElementById("sapp").classList.remove("open"); if (this.host && this.host.openAccounting) this.host.openAccounting(opt); return; }
    if (id === "proship" && this.host && this.host.accountingAvailable && !this.host.accountingAvailable()) { this.toast("PROSHIP belongs to a company: sign in with a company user"); return; }
    const mod = this.apps[id]; if (!mod) { this.toast("This app is not installed in this build"); return; }
    this.closeApp(); const H = this.H.bind(this); const a = this.app(id);
    const sapp = document.getElementById("sapp"); sapp.innerHTML = ""; sapp.className = "sh-frame open"; document.getElementById("home").classList.remove("open");
    const back = H("button", { class: "quiet sh-back", style: "display:none", onclick: () => this.back() }, this.icon("back"), H("span", { class: "blbl" }, "Back"));
    const acts = H("div", { class: "sh-acts" }); const status = H("span", { class: "sh-status" }); const tabs = H("nav", { class: "sh-tabs" });
    document.body.dataset.app = id; this.groundHeight();
    const menuBtn = H("button", { class: "quiet sh-menubtn", title: "Menu", onclick: (e) => this.moreMenu(e.currentTarget, true) }, this.icon("menu"));
    sapp.append(H("header", { class: "sh-top sh-apptop" }, menuBtn, H("button", { class: "sh-brand sh-homebtn", title: "Back to the XYNTAX suite", onclick: () => this.showHome() }, this.lockup(a.name)), back, H("div", { class: "sh-title", hidden: "" }, H("span", {}, a.name)), acts, status, H("button", { class: "quiet sh-suitebtn", title: "All apps (Esc)", onclick: () => this.showHome() }, this.icon("home"), H("span", { class: "lbl" }, "Suite"))));
    const body = H("div", { class: "sh-body" }); sapp.append(body, tabs); this._tabs = null; this._bar = null; this._tabsEl = tabs; this._helpId = mod.help ? id : null;
    this.current = id; this._back = null;
    this.frame = { body, acts, status, back, setBack: (fn, label) => { this._back = fn; back.style.display = fn ? "" : "none"; sapp.classList.toggle("has-back", !!fn); back.querySelector(".blbl").textContent = label || "Back"; }, setActions: (...els) => { acts.innerHTML = ""; const list = els.flat().filter(Boolean); this._acts = list; for (const el of list) acts.append(el); this.drawTabs(); }, setTabs: (list) => { this._tabs = list; this._bar = null; this.drawTabs(); }, setBar: (bar) => { this._bar = bar; this._tabs = null; this.drawTabs(); }, refreshTabs: () => this.drawTabs(), setStatus: (txt, cls) => { status.textContent = txt || ""; status.className = "sh-status " + (cls || ""); }, setContext: (txt) => { let c = sapp.querySelector(".sh-ctx"); if (!c) { c = H("span", { class: "sh-ctx" }); status.before(c); } c.textContent = txt || ""; } };
    try { mod.mount(body, this.frame); } catch (e) { body.append(H("div", { class: "sh-err" }, "This app hit an error: " + e.message)); console.error(e); }
    this.nav.mark("");
    if (!this._esc) { this._esc = true; document.addEventListener("keydown", (e) => { if (!this.current) return; /* 4.17: a field left focused inside a closed sheet or dialog no longer swallows every shortcut */ if (this.staleFocus(e)) e.target.blur(); else if (e.target.closest && e.target.closest("input,textarea,select,[contenteditable]")) { if (e.key === "Escape") e.target.blur(); return; } { const mn = document.getElementById("shmenu"); if (mn) { if (e.key === "Escape") { e.preventDefault(); mn.remove(); } return; } } /* 4.16: Esc closes an open menu (it used to swallow the key) */ if (document.querySelector("#sheet.open") || document.querySelector("#shdlg.open")) return; const mod2 = this.apps[this.current]; if (e.key === "Escape") { if (mod2 && mod2.onEsc && mod2.onEsc()) { e.preventDefault(); return; } if (!this.isMobile()) this.showHome(); } else if (e.key === "?" && !e.ctrlKey && !e.metaKey) { e.preventDefault(); if (mod2 && mod2.help) this.showHelp(this.current); else this.shortcuts(this.current); } else { if (mod2 && mod2.onKey) mod2.onKey(e); /* 4.17: "/" focuses the app's own search box in every app that does not handle the key itself */ if (!e.defaultPrevented && e.key === "/" && !e.ctrlKey && !e.metaKey && !e.altKey && this.focusSearch()) e.preventDefault(); } }); }
    this.prefs.set({ lastApp: id });
    if (opt && mod.open) setTimeout(() => { try { mod.open(opt); } catch (e) { console.error(e); } }, 250);
    if (this.host && this.host.onOpen) this.host.onOpen(id);
  },
  // the phone's bottom bar — the same five keys in every app, so there is one bar to learn:
  //   the app's menu (its side pane: sections, folders, calendars, accounts…) · Search · Home · New · More
  // an app describes its bar with frame.setBar({ side, search, create, views, more }); the older setTabs(list) is folded into that shape
  bar() {
    if (this._bar) return this._bar; const t = this._tabs || []; if (!t.length) return { side: null, search: null, create: null, views: [], more: [] };
    return { side: t[0], search: null, create: null, views: t.slice(1), more: [] };
  },
  groundHeight() { try { const h = Math.max(window.screen && window.screen.height || 0, window.innerHeight || 0, this._skyH || 0); this._skyH = h; document.documentElement.style.setProperty("--sky-h", h + "px"); } catch (e) { /* nothing */ } },
  drawTabs() {
    const el = this._tabsEl; if (!el) return; el.innerHTML = ""; if (!this.isMobile()) return; const H = this.H.bind(this);
    const tab = (icon, label, fn, on, cls) => H("button", { class: (on ? "on" : "") + (cls ? " " + cls : ""), onclick: fn }, this.PT[icon] ? this.glyph(icon) : this.icon(icon), H("span", {}, label));
    const b = this.bar(); const on = (x) => x && (typeof x.on === "function" ? x.on() : !!x.on);
    const primary = (this._acts || []).find((a) => a.classList && a.classList.contains("primary"));
    const create = b.create || (primary ? { l: primary.textContent.trim() || "New", fn: () => primary.click() } : null);
    el.append(
      b.side ? tab(b.side.icon || "list", b.side.l, b.side.fn, on(b.side)) : tab("list", "Menu", (e) => this.moreMenu(e.currentTarget, false)),
      tab("search", "Search", (e) => (b.search ? b.search() : this.globalSearch()), on(b.searchOn ? { on: b.searchOn } : null)),
      tab("tiles", "Home", () => this.showHome(), false, "homekey"),
      tab("plus", "New", () => (create ? create.fn() : this.newMenu()), false, "newkey"),
      tab("more", "More", (e) => this.moreMenu(e.currentTarget, false)));
  },
  // every other action of the app, its views, its help, sharing, the company — from the bottom bar's More or the header's menu button
  moreMenu(anchor, full) {
    const b = this.bar(); const acts = this._acts || []; const primary = acts.find((a) => a.classList && a.classList.contains("primary"));
    const items = [];
    for (const v of b.views || []) items.push({ l: v.l, fn: v.fn, on: typeof v.on === "function" ? v.on() : !!v.on });
    const rest = acts.filter((a) => a !== primary || !this.isMobile()).map((a) => ({ l: (a.title && a.textContent.trim().length < 2 ? a.title : a.textContent.trim()) || a.title || "…", fn: () => a.click() }));
    if (rest.length) items.push(items.length ? { sep: 1 } : null, ...rest);
    if (b.more && b.more.length) items.push(items.length ? { sep: 1 } : null, ...b.more.map((t) => ({ l: t.l, fn: t.fn })));
    const mod = this.apps[this.current]; if (mod && mod.shareCurrent) items.push(items.length ? { sep: 1 } : null, { l: "Share…", fn: () => mod.shareCurrent() });
    if (this._helpId) items.push(items.length ? { sep: 1 } : null, { l: "How this app works", fn: () => this.showHelp(this._helpId) });
    if (this.canSwitch()) items.push({ l: "Switch company…", fn: () => this.switchCompany() });
    if (this.isMobile()) items.push({ sep: 1 }, { l: "Lock", fn: () => this.lockNow() }); if (full) items.push({ l: "All apps", fn: () => this.showHome() });
    this.menu(anchor, items.filter(Boolean));
  },
  // ---------- sharing across the suite: a note, a document, an email, a contact goes to a conversation, into an email,
  // into Documents, to the clipboard, or out to another app on the device. share({ title, text, files: [File], kind })
  async share(p) {
    p = p || {}; const H = this.H.bind(this); const files = (p.files || []).filter(Boolean); const text = p.text || ""; const title = p.title || (files[0] && files[0].name) || "Share";
    const items = [];
    if (this.allowed("messages") && this.messagesShare && typeof CLOUD !== "undefined" && CLOUD.signedIn()) items.push({ l: "Send in a conversation", d: "encrypted, to a person or a group", fn: () => this.messagesShare({ text: [title !== text ? title : "", text].filter(Boolean).join("\n"), files }) });
    if (this.allowed("mail") && this.mailCompose) items.push({ l: "Send by email", d: "opens a new message with it attached", fn: () => this.mailCompose({ subject: p.subject || title, html: text ? "<p>" + this.esc(text).replace(/\n/g, "<br>") + "</p>" : "", files }) });
    if (files.length && this.allowed("documents") && this.vaultSave && this.vaultAvailable()) items.push({ l: "Save to Documents", d: files.length === 1 ? files[0].name : files.length + " files", fn: async () => { const scope = typeof CLOUD !== "undefined" && CLOUD.active() ? "private" : "shared"; if (this.vaultSaveMany) await this.vaultSaveMany(files, { scope }); else { for (const f of files) await this.vaultSave(f, { scope }); this.toast("Saved to Documents"); } } });
    if (text) items.push({ l: "Copy the text", fn: async () => { try { await navigator.clipboard.writeText(text); this.toast("Copied"); } catch (e) { this.toast("Could not copy"); } } });
    if (this.host && this.host.share) items.push({ l: "Share with another app", d: "the device's share sheet", fn: () => this.host.share({ title, text, files }) });
    else if (navigator.share && (!files.length || (navigator.canShare && navigator.canShare({ files })))) items.push({ l: "Share with another app", fn: () => navigator.share(files.length ? { title, text, files } : { title, text }).catch(() => {}) });
    if (files.length) items.push({ l: files.length === 1 ? "Download" : "Download " + files.length + " files", fn: async () => { for (const f of files) await this.download(f.name, f); } });
    if (!items.length) { this.toast("Nothing to share this with yet"); return; }
    let box = document.getElementById("shdlg"); if (!box) { box = H("div", { id: "shdlg" }); document.body.append(box); } box.innerHTML = "";
    const close = () => { box.classList.remove("open"); box.innerHTML = ""; };
    box.append(H("div", { class: "sh-dcard sh-share" }, H("h3", {}, "Share"), H("p", { class: "sh-dim" }, title + (files.length > 1 ? " · " + files.length + " files" : files.length && files[0].size ? " · " + this.fmtBytes(files[0].size) : "")), H("div", { class: "sh-gsr" }, items.map((it) => H("button", { onclick: async () => { close(); try { await it.fn(); } catch (e) { this.toast("Could not share: " + e.message); } } }, H("span", {}, it.l), it.d ? H("small", {}, it.d) : null))), H("div", { class: "sh-dbtns" }, H("button", { class: "quiet", onclick: close }, "Cancel"))));
    box.classList.add("open"); box.onclick = (e) => { if (e.target === box) close(); };
  },
  // report something to the service: the operator cannot read it, so the report carries only a reference and your words
  async report(o) {
    if (typeof CLOUD === "undefined" || !CLOUD.signedIn()) { this.toast("Sign in to report"); return; }
    const v = await this.dialog({ title: "Report to Xyntax", text: "The service cannot open " + (o.what || "this") + " — it is encrypted. Your report reaches the operator with a reference and what you write here; the account that sent it can be suspended after review. Misuse of reporting is itself a breach of the acceptable-use policy.", fields: [{ k: "kind", label: "What is wrong", type: "select", value: "abuse", options: [{ v: "spam", l: "Spam or unwanted contact" }, { v: "abuse", l: "Harassment or abuse" }, { v: "illegal", l: "Illegal content or activity" }, { v: "security", l: "A security problem" }, { v: "other", l: "Something else" }] }, { k: "note", label: "What happened", type: "textarea", placeholder: "In your own words" }], ok: "Send report" });
    if (!v) return; try { await CLOUD.account("report_abuse", { kind: v.kind, ref: o.ref || "", note: (v.note || "").slice(0, 2000), subject_id: o.subject_id || null }); this.toast("Reported. Thank you."); } catch (e) { this.toast("Could not send the report: " + e.message); }
  },
  // the New key of an app without a create action: make something anywhere in the suite
  newMenu() {
    const H = this.H.bind(this); const items = [];
    const add = (id, l, fn) => { if (this.allowed(id) && this.apps[id]) items.push({ l, fn }); };
    add("notes", "Note", () => this.notesCreate ? this.notesCreate({ kind: "text" }) : this.open("notes"));
    add("calendar", "Event", () => this.calendarCreate ? this.calendarCreate({}) : this.open("calendar"));
    add("contacts", "Contact", () => this.open("contacts", { newContact: true }));
    add("messages", "Message", () => this.open("messages", { compose: true }));
    add("mail", "Email", () => this.mailCompose ? this.mailCompose({}) : this.open("mail"));
    add("documents", "Upload a file", () => this.open("documents", { upload: true }));
    this.dialog({ title: "New", text: "", ok: " ", cancel: "Close", body: H("div", { class: "sh-newgrid" }, items.map((it) => H("button", { onclick: () => { document.getElementById("shdlg").classList.remove("open"); it.fn(); } }, it.l))) });
  },
  // one search across the apps: every app that offers search(q) answers with [{ l, d, fn }]
  globalSearch() {
    const H = this.H.bind(this); let box = document.getElementById("shdlg"); if (!box) { box = H("div", { id: "shdlg" }); document.body.append(box); } box.innerHTML = "";
    const close = () => { box.classList.remove("open"); box.innerHTML = ""; }; const list = H("div", { class: "sh-gsr" }); let seq = 0;
    const inp = H("input", { type: "search", placeholder: "Search everywhere", "aria-label": "Search everywhere", oninput: async () => { const q = inp.value.trim(); const my = ++seq; list.innerHTML = ""; if (q.length < 2) return; for (const a of this.APPS) { const mod = this.apps[a.id]; if (!mod || !mod.search || !this.allowed(a.id)) continue; let hits = []; try { hits = (await mod.search(q)) || []; } catch (e) { hits = []; } if (my !== seq) return; if (!hits.length) continue; list.append(H("div", { class: "sh-gsh" }, a.name)); for (const h of hits.slice(0, 6)) list.append(H("button", { onclick: () => { close(); h.fn(); } }, H("span", {}, h.l), h.d ? H("small", {}, h.d) : null)); } if (!list.children.length) list.append(H("div", { class: "sh-dim", style: "padding:8px 0" }, "Nothing matches")); } });
    box.append(H("div", { class: "sh-dcard sh-gs" }, H("div", { class: "sh-field" }, inp), list, H("div", { class: "sh-dbtns" }, H("button", { class: "quiet", onclick: close }, "Close")))); box.classList.add("open"); box.onclick = (e) => { if (e.target === box) close(); }; setTimeout(() => inp.focus(), 50);
  },
  showHelp(id) { const mod = this.apps[id]; const a = this.app(id); if (!mod || !mod.help) return; const H = this.H.bind(this); const tips = mod.help(); let box = document.getElementById("shdlg"); if (!box) { box = H("div", { id: "shdlg" }); document.body.append(box); } box.innerHTML = ""; const close = () => { box.classList.remove("open"); box.innerHTML = ""; }; box.append(H("div", { class: "sh-dcard sh-help" }, H("h3", {}, a.name, H("span", { class: "sh-faint", style: "margin-left:auto;font-weight:400;font-size:11px" }, "how it works")), H("div", { class: "sh-tips" }, tips.map((t) => H("div", { class: "tip" }, H("b", {}, t[0]), H("span", {}, t[1])))), H("div", { class: "sh-dbtns" }, this.isMobile() ? null : H("button", { class: "quiet", onclick: () => { close(); this.shortcuts(id); } }, "Keyboard shortcuts"), H("button", { class: "primary", onclick: close }, "Got it")))); box.classList.add("open"); box.onclick = (e) => { if (e.target === box) close(); }; this.escCloses(box, close); },
  // 4.16 · every keyboard shortcut in one place: the suite's, then the open app's (an app may list its own with keys())
  shortcuts(id) {
    const H = this.H.bind(this); id = id || this.current; const mod = id ? this.apps[id] : null; const mac = /Mac|iPhone|iPad/.test(navigator.platform || ""); const C = mac ? "⌘" : "Ctrl";
    const suite = [[C + " K", "Command palette — apps, pages, actions and everything you have written"], ["/", "Search (the palette on the home page; the app's search inside an app)"], ["?", "This list"], ["1 – 9, 0", "Open an app from the home page"], ["Esc", "Close a sheet or a dialog · back to the home page"], ["L", "Lock the screen (home page)"], [C + " Shift N", "New window (desktop)"], [C + " + / −", "Zoom a preview"]];
    const app = (mod && typeof mod.keys === "function" ? mod.keys() : null) || ({ notes: [["n", "New page"], [C + " B / I / U", "Bold, italic, underline"], ["- or *  then space", "Bulleted list"], ["1.  then space", "Numbered list"], ["[ ]  then space", "Check box"], ["Tab / Shift Tab", "Indent / outdent a list item"]], calendar: [["n", "New event"], ["t", "Today"], ["← / →", "Previous / next period"], ["m · w · d · a", "Month, week, day, agenda"]], documents: [["n", "New folder"], ["u", "Upload files"], ["↑ ↓", "Move through files"], ["Enter", "Open"], ["Backspace", "Up one folder"]], wealth: [["n", "Record a movement"], ["u", "Update balances"]], messages: [["n", "New message"], ["Enter", "Send"], ["Shift Enter", "New line"], ["Double-click a message", "Reply to it"]], mail: [["c", "Compose"], ["r", "Reply"], ["a", "Reply all"], ["f", "Forward"], ["e", "Archive"]], contacts: [["n", "New contact"]], proship: [["/", "Search"], ["n", "New"], ["[ / ]", "Previous / next vessel in the list"]] })[id] || [];
    let box = document.getElementById("shdlg"); if (!box) { box = H("div", { id: "shdlg" }); document.body.append(box); } box.innerHTML = ""; const close = () => { box.classList.remove("open"); box.innerHTML = ""; };
    const list = (rows) => H("div", { class: "sh-keys-list" }, rows.map((r) => H("div", { class: "sh-key-row" }, H("kbd", {}, r[0]), H("span", {}, r[1]))));
    const a = id ? this.app(id) : null;
    box.append(H("div", { class: "sh-dcard sh-shortcuts" }, H("h3", {}, "Keyboard shortcuts"), H("div", { class: "sh-key-h" }, "Everywhere"), list(suite), app.length ? H("div", { class: "sh-key-h" }, (a && a.name) || "This app") : null, app.length ? list(app) : null, H("div", { class: "sh-dbtns" }, H("button", { class: "primary", onclick: close }, "Close"))));
    box.classList.add("open"); box.onclick = (e) => { if (e.target === box) close(); }; this.escCloses(box, close); setTimeout(() => { const b = box.querySelector(".sh-dbtns button.primary"); if (b) b.focus(); }, 30);
  },
  // 4.16 · Esc closes the read-only dialogs (help, shortcuts) even when nothing inside has the focus
  escCloses(box, close) { const onKey = (e) => { if (!box.classList.contains("open")) { document.removeEventListener("keydown", onKey, true); return; } if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); document.removeEventListener("keydown", onKey, true); close(); } }; document.addEventListener("keydown", onKey, true); },
  // 4.16 · recently opened things (not apps): the palette shows them first; kept per person on this device
  recent: {
    key() { const s = typeof CLOUD !== "undefined" && CLOUD.session ? CLOUD.session() : null; return "xyntax.recent." + ((s && s.user_id) || "local"); },
    list() { try { return JSON.parse(localStorage.getItem(this.key()) || "[]").slice(0, 12); } catch (e) { return []; } },
    add(it) { if (!it || !it.l || !it.app) return; const L = this.list().filter((x) => !(x.app === it.app && x.l === it.l)); L.unshift({ l: String(it.l).slice(0, 120), s: String(it.s || it.d || "").slice(0, 120), app: it.app, q: String(it.q || it.l).slice(0, 80), at: Date.now() }); try { localStorage.setItem(this.key(), JSON.stringify(L.slice(0, 12))); } catch (e) { /* storage full */ } },
    clear() { try { localStorage.removeItem(this.key()); } catch (e) { /* nothing */ } },
  },
  closeApp() { { const mn = document.getElementById("shmenu"); if (mn) mn.remove(); } delete document.body.dataset.app; if (this.current && this.apps[this.current] && this.apps[this.current].unmount) { try { this.apps[this.current].unmount(); } catch (e) { /* nothing */ } } this.current = null; this.db.flushAll(); },
  refreshCurrent() { if (this.current && this.apps[this.current] && this.apps[this.current].refresh) this.apps[this.current].refresh(); },

  // ---------- per-app document storage: cloud (suite_docs) when signed in, this device otherwise
  db: {
    cache: {},
    cloud() { return typeof CLOUD !== "undefined" && CLOUD.signedIn(); },
    // "shared:<app>" documents belong to the company (suite_shared) rather than to the user
    isShared(app) { return app.startsWith("shared:"); }, name(app) { return app.replace(/^shared:/, ""); },
    sharedOk() { return typeof CLOUD !== "undefined" && CLOUD.active(); },
    peek(app) { const c = this.cache[app]; return c && c.data ? c.data : null; },
    // device copies are per person (personal apps) and per company (shared docs): two accounts on one device never see each other's
    key(app) { const ses = typeof CLOUD !== "undefined" && CLOUD.session ? CLOUD.session() : null; return this.isShared(app) ? "xyntax.suite.shared." + this.name(app) + "." + ((ses && ses.org_id) || "local") : "xyntax.suite." + app + (ses && ses.user_id ? "." + ses.user_id : ""); },
    // 4.31.3 · a company document is read and written for the company it was loaded in, named explicitly (never "the open one")
    async remoteLoad(app, org) { return this.isShared(app) ? CLOUD.sharedLoad(this.name(app), org) : CLOUD.suiteLoad(app); },
    async remoteSave(app, v, data, org) { return this.isShared(app) ? CLOUD.sharedSave(this.name(app), v, data, org) : CLOUD.suiteSave(app, v, data); },
    owner() { const ses = typeof CLOUD !== "undefined" && CLOUD.session ? CLOUD.session() || {} : {}; return { org: ses.org_id || null, user: ses.user_id || null }; },
    // the workspace accepts an empty document over a full one only from a client that saw the stored version in this process
    marked(c, payload) { return payload && typeof payload === "object" && !Array.isArray(payload) && !payload.__sealed && c.seen && c.version > 0 ? { ...payload, __empty_ok: true } : payload; },
    async remoteVersion(app, force) { return this.isShared(app) ? CLOUD.sharedVersion(this.name(app), force) : CLOUD.suiteVersion(app, force); },
    online(app) { return this.isShared(app) ? this.sharedOk() : this.cloud(); },
    // quiet > 0 while the home tiles or the reminders read apps in the background: no passphrase prompt then (a counter, 4.8 —
    // two background readers overlapping used to leave the flag stuck and the next app open on "Loading…")
    quiet: 0, hush() { this.quiet++; }, unhush() { this.quiet = Math.max(0, this.quiet - 1); },
    _loading: {},
    async load(app, defaults) {
      const c = this.cache[app]; if (c && c.data) { if (this.online(app) && !c.dirty && Date.now() - (c.at || 0) > 1000) this.revalidate(app, true); /* 4.10.3: one cheap versions call per open, not one per five seconds — a change from another device must show on the next open */ return c.data; }
      // 4.8: one load per app at a time — the home summaries and the app opening the same moment must share one object,
      // or the app edits a copy the autosave never serialises
      if (this._loading[app]) return this._loading[app];
      this._loading[app] = this._load(app, defaults); try { return await this._loading[app]; } finally { delete this._loading[app]; }
    },
    async _load(app, defaults) {
      const c = this.cache[app]; if (c && c.data) return c.data;
      let data = null, version = 0, stale = false, seen = false, unsent = false; const own = this.owner();
      if (this.online(app)) {
        // 4.10.2 · cache-first: the copy this device kept last time (sealed stays sealed at rest) opens at once, with no round
        // trip; the workspace's version is compared in the background and a newer copy replaces it (revalidate → pull)
        const loc = this.localWrapped(app);
        if (loc && loc.v != null) { data = loc.d; version = loc.v; stale = true; unsent = !!loc.u; SUITE.perf.mark("db " + app + " from device copy"); }
        else { try { const r = await this.remoteLoad(app); data = r.data; version = r.version; seen = true; this.keep(app, data, version); SUITE.perf.mark("db " + app + " from workspace"); } catch (e) { SUITE.toast(e.message); data = loc ? loc.d : null; } }
      }
      else { const loc = this.localWrapped(app); data = loc ? loc.d : null; }
      if (data && data.__sealed) { if (!(await SUITE.e2e.ensure())) throw new Error("This app is encrypted; the passphrase is needed to open it"); try { data = await SUITE.e2e.openJSON(data); } catch (e) { SUITE.e2e.forget(); throw new Error("The passphrase did not open this data"); } }
      if (!data || typeof data !== "object") data = typeof defaults === "function" ? defaults() : JSON.parse(JSON.stringify(defaults || {}));
      else if (defaults) { const d = typeof defaults === "function" ? defaults() : defaults; for (const k of Object.keys(d)) if (data[k] === undefined) data[k] = JSON.parse(JSON.stringify(d[k])); }
      this.cache[app] = { data, version, dirty: false, timer: null, savedAt: null, at: Date.now(), seen, org: this.isShared(app) ? own.org : null, user: own.user };
      if (unsent) { const c2 = this.cache[app]; c2.dirty = true; c2.timer = setTimeout(() => { this.flush(app).catch(() => {}); }, 1200); /* the change that never reached the workspace goes now; a newer version there wins, and says so (flush) */ }
      else if (stale) this.revalidate(app);
      return data;
    },
    // the device copy: { v: version, d: payload as the workspace holds it (sealed or plain) }; older copies had the payload alone
    localWrapped(app) { try { const raw = JSON.parse(localStorage.getItem(this.key(app)) || "null"); if (!raw) return null; if (raw && typeof raw === "object" && raw.__v !== undefined && "d" in raw) return { v: raw.__v, d: raw.d, u: !!raw.__u }; return { v: null, d: raw }; } catch (e) { return null; } },
    local(app) { const w = this.localWrapped(app); return w ? w.d : null; },
    // 4.34 · unsent = this copy holds a change the workspace has not confirmed (written before the save is sent, cleared when it
    // has answered). A copy found with the mark when the app is next loaded — the window was closed, or the computer went off, while
    // a save was failing — is sent then; before, such a change sat in the copy unmarked and was lost to the next newer version
    keep(app, payload, version, unsent) { try { localStorage.setItem(this.key(app), JSON.stringify(this.online(app) ? (unsent ? { __v: version, d: payload, __u: 1 } : { __v: version, d: payload }) : payload)); /* local mode keeps the plain shape it always had */ } catch (e) { try { localStorage.removeItem(this.key(app)); } catch (e2) { /* ignore */ } } },
    // in the background, after a cache-first open: is the workspace ahead? then the open app pulls (its focus path redraws
    // without losing the editor), an unopened app is pulled here and the home tile updated
    _reval: {},
    revalidate(app, force) {
      if (this._reval[app]) return this._reval[app];
      this._reval[app] = (async () => { try { const c = this.cache[app]; if (!c || !this.online(app)) return false; const v = await this.remoteVersion(app, force); c.at = Date.now(); if (v == null || v <= c.version) { c.stale = false; if (v != null && v === c.version) c.seen = true; return false; }
          const mounted = SUITE.current && this.name(app) === SUITE.current;
          if (mounted) { window.dispatchEvent(new Event("focus")); return true; }
          const changed = await this.pull(app); if (changed && SUITE.tileRefresh) SUITE.tileRefresh(this.name(app)); return changed; } catch (e) { return false; } finally { delete this._reval[app]; } })();
      return this._reval[app];
    },
    save(app, now) {
      const c = this.cache[app]; if (!c) return; c.dirty = true; if (SUITE.frame && SUITE.current === this.name(app)) SUITE.frame.setStatus("unsaved", "dim"); clearTimeout(c.timer);
      const run = async () => { try { await this.flush(app); } catch (e) { /* reported in flush */ } };
      if (now) return run(); c.timer = setTimeout(run, 600);
    },
    async flush(app) {
      const c = this.cache[app]; if (!c || !c.dirty) return; clearTimeout(c.timer);
      // a personal document of another person on this device is never written under the one signed in now
      if (!this.isShared(app) && c.user && c.user !== this.owner().user) { delete this.cache[app]; return; }
      c.dirty = false;
      let payload = c.data; if (!c.plain && !this.isShared(app) && await SUITE.e2e.enabled()) { if (!(await SUITE.e2e.ensure())) { c.dirty = true; return; } payload = await SUITE.e2e.sealJSON(c.data); }
      this.keep(app, payload, c.version, true);
      if (!this.online(app)) { c.savedAt = new Date(); if (SUITE.frame && SUITE.current === this.name(app)) SUITE.frame.setStatus("saved on this device", "dim"); return; }
      if (this.isShared(app) && c.org !== this.owner().org) { try { await this.remoteSave(app, c.version, this.marked(c, payload), c.org); } catch (e) { SUITE.toast("Not saved to the previous company: " + e.message); } delete this.cache[app]; return; }
      try { c.version = await this.remoteSave(app, c.version, this.marked(c, payload), c.org); c.seen = true; c.savedAt = new Date(); this.keep(app, payload, c.version); if (SUITE.frame && SUITE.current === this.name(app)) SUITE.frame.setStatus("synced", "ok"); }
      catch (e) {
        if (e.message === "CONFLICT" || /^empty/i.test(e.message || "")) { if (e.message !== "CONFLICT") SUITE.toast("Not saved: " + e.message.replace(/^empty:\s*/i, "") + " — the workspace copy was kept"); const r = await this.remoteLoad(app, c.org); c.seen = true; this.keep(app, r.data, r.version); c.data = r.data && r.data.__sealed ? await SUITE.e2e.openJSON(r.data) : r.data; c.version = r.version; SUITE.toast(this.isShared(app) ? "A colleague saved first; refreshed — please redo your last change" : "This was changed on another device; refreshed to the latest copy"); SUITE.refreshCurrent(); return; }
        c.dirty = true; if (SUITE.frame && SUITE.current === this.name(app)) SUITE.frame.setStatus("not saved — " + e.message.replace(/^Offline: /, ""), "neg"); SUITE.toast("Not saved: " + e.message); throw e;
      }
    },
    flushAll() { for (const app of Object.keys(this.cache)) if (this.cache[app].dirty) this.flush(app).catch(() => {}); },
    async pull(app) { // on focus: fetch a newer copy saved from another device
      const c = this.cache[app]; if (!c || !this.online(app) || c.dirty) return false; try { if (this.isShared(app) && c.org !== this.owner().org) return false; const v = await this.remoteVersion(app); if (v != null && v > c.version) { const r = await this.remoteLoad(app, c.org); this.keep(app, r.data, r.version); c.data = r.data && r.data.__sealed ? await SUITE.e2e.openJSON(r.data) : r.data; c.version = r.version; c.seen = true; c.stale = false; c.at = Date.now(); return true; } if (v != null && v === c.version) c.seen = true; c.stale = false; c.at = Date.now(); } catch (e) { /* offline */ } return false;
    },
    forget(app) { delete this.cache[app]; },
    // 4.31.3 · a company switch: what waits goes to the company it belongs to, then the company documents are read afresh
    switched() { for (const app of Object.keys(this.cache)) { const c = this.cache[app]; if (!this.isShared(app)) continue; if (c.dirty) this.flush(app).catch(() => {}); else delete this.cache[app]; } },
  },

  // ---------- 4.10.2 · a small key/value store on the device (IndexedDB, localStorage when it is unavailable) for the copies
  // that make the next open instant: the company book, lists the apps keep. Values are whatever the workspace holds (sealed stays sealed).
  kv: {
    _db: null,
    db() { if (this._db) return this._db; this._db = new Promise((res, rej) => { try { const r = indexedDB.open("xyntax-cache", 1); r.onupgradeneeded = () => { r.result.createObjectStore("kv"); }; r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); } catch (e) { rej(e); } }).catch((e) => { this._db = null; throw e; }); return this._db; },
    async get(key) { try { const db = await this.db(); return await new Promise((res, rej) => { const tx = db.transaction("kv", "readonly"); const rq = tx.objectStore("kv").get(key); rq.onsuccess = () => res(rq.result === undefined ? null : rq.result); rq.onerror = () => rej(rq.error); }); } catch (e) { try { return JSON.parse(localStorage.getItem("xyntax.kv." + key) || "null"); } catch (e2) { return null; } } },
    async set(key, value) { try { const db = await this.db(); await new Promise((res, rej) => { const tx = db.transaction("kv", "readwrite"); tx.objectStore("kv").put(value, key); tx.oncomplete = res; tx.onerror = () => rej(tx.error); }); } catch (e) { try { localStorage.setItem("xyntax.kv." + key, JSON.stringify(value)); } catch (e2) { /* no room: the workspace copy is the one that counts */ } } },
    async del(key) { try { const db = await this.db(); await new Promise((res, rej) => { const tx = db.transaction("kv", "readwrite"); tx.objectStore("kv").delete(key); tx.oncomplete = res; tx.onerror = () => rej(tx.error); }); } catch (e) { /* ignore */ } try { localStorage.removeItem("xyntax.kv." + key); } catch (e) { /* ignore */ } },
    async clear() { try { const db = await this.db(); await new Promise((res, rej) => { const tx = db.transaction("kv", "readwrite"); tx.objectStore("kv").clear(); tx.oncomplete = res; tx.onerror = () => rej(tx.error); }); } catch (e) { /* ignore */ } },
  },
  // 4.10.2 · background work (bell refresh, Messages warm-up, the PDF engine) waits until the person has stopped tapping:
  // after at least `minMs`, and only once a second has passed without pointer or key input
  whenIdle(fn, minMs) { const start = Date.now(); const self = this; const run = () => { const since = Date.now() - (self._lastInput || 0); if (Date.now() - start < (minMs || 0) || since < 1000) { setTimeout(run, 500); return; } if (typeof requestIdleCallback === "function") requestIdleCallback(() => fn(), { timeout: 2000 }); else setTimeout(fn, 0); }; if (!this._inputHooked && typeof document !== "undefined") { this._inputHooked = true; for (const ev of ["pointerdown", "keydown", "touchstart"]) document.addEventListener(ev, () => { self._lastInput = Date.now(); }, { passive: true, capture: true }); } setTimeout(run, Math.max(0, minMs || 0)); },
  // the home tile of one app, redrawn when its data changed in the background (the device copy was behind the workspace)
  tileRefresh(appId) { try { const home = document.querySelector("#home.open"); if (!home) return; const mod = this.apps[appId]; const el = home.querySelector('.sh-tile[data-app="' + appId + '"] .sh-sum'); if (!mod || !mod.summary || !el) return; this.db.hush(); Promise.resolve(mod.summary()).then((t) => { if (t && el.isConnected) el.textContent = t; }).catch(() => {}).finally(() => this.db.unhush()); } catch (e) { /* nothing */ } },
  // ---------- personal files (voice notes, images, sketches): cloud bucket "suite" or IndexedDB on this device
  files: {
    mem: {},
    cloud() { return typeof CLOUD !== "undefined" && CLOUD.signedIn(); },
    idb() { return new Promise((res, rej) => { const r = indexedDB.open("xyntax-suite", 1); r.onupgradeneeded = () => { r.result.createObjectStore("files"); r.result.createObjectStore("vault"); r.result.createObjectStore("blobs"); }; r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); },
    async idbOp(store, mode, fn) { const db = await this.idb(); return new Promise((res, rej) => { const tx = db.transaction(store, mode); const rq = fn(tx.objectStore(store)); tx.oncomplete = () => res(rq && rq.result); tx.onerror = () => rej(tx.error); }); },
    async put(key, blob) { this.mem[key] = blob; let out = blob; if (!key.startsWith("org/") && await SUITE.e2e.enabled()) { if (!(await SUITE.e2e.ensure())) throw new Error("Passphrase needed"); out = await SUITE.crypto.seal(blob, SUITE.e2e.pass); } if (this.cloud()) return CLOUD.suitePut(key, out); await this.idbOp("files", "readwrite", (s) => s.put(out, key)); return key; },
    async get(key) { if (this.mem[key]) return this.mem[key]; let b = this.cloud() ? await CLOUD.suiteGet(key) : await this.idbOp("files", "readonly", (s) => s.get(key)); if (b && SUITE.crypto.isSealed(await b.slice(0, 9).arrayBuffer())) { if (!(await SUITE.e2e.ensure())) throw new Error("Passphrase needed"); b = await SUITE.crypto.open(b, SUITE.e2e.pass, b.type); } if (b) this.mem[key] = b; return b || null; },
    async del(key) { delete this.mem[key]; if (this.cloud()) return CLOUD.suiteDel(key); await this.idbOp("files", "readwrite", (s) => s.delete(key)); return true; },
  },

  // ---------- password locking of files: PBKDF2 → AES-GCM; the file keeps its name, only its bytes are sealed
  crypto: {
    MAGIC: new TextEncoder().encode("XYNVAULT1"),
    async key(password, salt) { const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]); return crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: 250000, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]); },
    async seal(blob, password) { const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12)); const k = await this.key(password, salt); const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, k, await blob.arrayBuffer())); const out = new Uint8Array(this.MAGIC.length + 16 + 12 + ct.length); out.set(this.MAGIC, 0); out.set(salt, this.MAGIC.length); out.set(iv, this.MAGIC.length + 16); out.set(ct, this.MAGIC.length + 28); return new Blob([out], { type: "application/octet-stream" }); },
    isSealed(bytes) { const u = new Uint8Array(bytes.slice(0, this.MAGIC.length)); return u.length === this.MAGIC.length && u.every((b, i) => b === this.MAGIC[i]); },
    async open(blob, password, mime) { const all = new Uint8Array(await blob.arrayBuffer()); if (!this.isSealed(all.buffer)) return new Blob([all], { type: mime || "" }); const m = this.MAGIC.length; const salt = all.slice(m, m + 16), iv = all.slice(m + 16, m + 28), ct = all.slice(m + 28); const k = await this.key(password, salt); try { const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, k, ct); return new Blob([pt], { type: mime || "" }); } catch (e) { throw new Error("Wrong password"); } },
  },

  // ---------- dialogs and menus (styled, shared by every app on both platforms)
  // one place to change company: every membership, plus (for the software owner) every other company, joined on the spot
  canSwitch() { if (typeof CLOUD === "undefined" || !CLOUD.signedIn()) return false; return (CLOUD.state.memberships || []).length > 1 || !!CLOUD.state.isOwner; },
  // a full-screen "working" state: a ring and one line, over the ground; used while a company opens (survives the reload through sessionStorage)
  busy(text) { const H = this.H.bind(this); let b = document.getElementById("shbusy"); if (!b) { b = H("div", { id: "shbusy" }, H("div", { class: "sh-spin" }), H("div", { class: "sh-busytext" })); document.body.append(b); } b.querySelector(".sh-busytext").textContent = text || "Working…"; b.classList.add("open"); },
  idle() { const b = document.getElementById("shbusy"); if (b) { b.classList.remove("open"); setTimeout(() => { if (!b.classList.contains("open")) b.remove(); }, 400); } try { sessionStorage.removeItem("xyntax.opening"); } catch (e) { /* ignore */ } },
  async switchCompany() {
    const H = this.H.bind(this); const ms = CLOUD.state.memberships || []; const cur = (CLOUD.session() || {}).org_id; const me = (CLOUD.session() || {}).user_id;
    const rows = ms.map((m) => ({ id: m.org_id, name: (m.orgs && m.orgs.name) || m.org_id, role: m.role, apps: m.apps === undefined ? null : m.apps, quota: m.orgs && m.orgs.quota_gb != null ? +m.orgs.quota_gb : 5 }));
    // the dialog opens at once with the companies you belong to; the owner's list of the other companies arrives from the server a moment later (and is kept for the session)
    const others = (this._otherOrgs || []).filter((o) => !rows.some((r) => r.id === o.id));
    const all = rows.concat(others).sort((a, b) => a.name.localeCompare(b.name));
    let box = document.getElementById("shdlg"); if (!box) { box = H("div", { id: "shdlg" }); document.body.append(box); }
    const close = () => { box.classList.remove("open"); box.innerHTML = ""; };
    const go = async (o) => {
      if (o.join) { if (!(await this.confirm("You are not a member of " + o.name + " yet. Add yourself as an administrator and open it?", "Join and open"))) return; try { await CLOUD.admin("create_user", { org: o.id, email: (CLOUD.session() || {}).email, name: "", password: "x-" + Math.random().toString(36).slice(2) + "Aa1!", role: "admin", apps: null }); await CLOUD.whoami(); } catch (e) { this.toast("Could not join: " + e.message); return; } const m = (CLOUD.state.memberships || []).find((x) => x.org_id === o.id); o = { id: o.id, name: o.name, role: m ? m.role : "admin", apps: m && m.apps !== undefined ? m.apps : null, quota: m && m.orgs && m.orgs.quota_gb != null ? +m.orgs.quota_gb : 5 }; }
      this.db.flushAll(); CLOUD.chooseOrg(o); close(); try { sessionStorage.setItem("xyntax.opening", o.name); } catch (e) { /* ignore */ } this.busy("Opening " + o.name + "…"); setTimeout(() => location.reload(), 60);
    };
    const card = H("div", { class: "sh-dcard" }, H("h3", {}, "Switch company"), H("p", {}, "The books, the shared documents, the shared notebook and the company calendar are those of the company you open. Your notes, wealth, calendar and private documents stay the same in every company."),
      H("div", { class: "sh-list sh-orgs" }, all.map((o) => H("button", { class: "sh-orgrow" + (o.id === cur ? " on" : ""), disabled: o.id === cur ? true : null, onclick: () => go(o) }, H("b", {}, o.name), H("span", { class: "sh-dim" }, o.id === cur ? "open now" : o.join ? "not a member — join as administrator" : o.role))), !all.length ? H("div", { class: "sh-dim" }, "No other company.") : null),
      H("div", { class: "sh-dbtns" }, H("button", { onclick: close }, "Cancel")));
    box.innerHTML = ""; box.append(card); box.classList.add("open"); box.onclick = (e) => { if (e.target === box) close(); };
    if (CLOUD.state.isOwner && !this._otherOrgs) {
      const list = card.querySelector(".sh-orgs"); const wait = H("div", { class: "sh-dim sh-wait" }, H("span", { class: "sh-spin small" }), "Looking for other companies…"); list.append(wait);
      CLOUD.admin("list_orgs").then((orgs) => { this._otherOrgs = orgs.map((o) => ({ id: o.id, name: o.name, join: true })); wait.remove(); if (!box.classList.contains("open")) return; for (const o of this._otherOrgs) { if (rows.some((r) => r.id === o.id)) continue; list.append(H("button", { class: "sh-orgrow", onclick: () => go(o) }, H("b", {}, o.name), H("span", { class: "sh-dim" }, "not a member — join as administrator"))); } const none = list.querySelector(":scope > .sh-dim"); if (none && list.querySelector(".sh-orgrow")) none.remove(); }).catch(() => { this._otherOrgs = []; wait.remove(); });
    }
  },
  dialog(o) {
    const H = this.H.bind(this); let box = document.getElementById("shdlg"); if (!box) { box = H("div", { id: "shdlg" }); document.body.append(box); }
    return new Promise((res) => {
      box.innerHTML = ""; const inputs = {}; const err = H("div", { class: "sh-err", style: "min-height:16px" });
      const close = (v) => { box.classList.remove("open"); box.innerHTML = ""; res(v); };
      const card = H("div", { class: "sh-dcard" }, H("h3", {}, o.title || ""), o.text ? H("p", {}, o.text) : null, o.body || null);
      for (const f of o.fields || []) { const inp = f.type === "checks" ? (() => { const box = H("div", { class: "sh-checks" }, (f.options || []).map((op) => H("label", { class: "sh-chk" }, H("input", { type: "checkbox", value: op.v, checked: (f.value || []).includes(op.v) ? true : null }), H("span", {}, op.l)))); Object.defineProperty(box, "value", { get: () => Array.from(box.querySelectorAll("input:checked")).map((i) => i.value) }); return box; })() : f.type === "select" ? H("select", {}, (f.options || []).map((op) => H("option", { value: op.v, selected: String(op.v) === String(f.value) ? true : null }, op.l))) : f.type === "textarea" ? H("textarea", { placeholder: f.placeholder || "" }, f.value || "") : H("input", { type: f.type || "text", placeholder: f.placeholder || "", value: f.value != null ? f.value : "", autocomplete: f.type === "password" ? "new-password" : "off" }); inputs[f.k] = inp; card.append(H("label", { class: "sh-f" }, H("span", {}, f.label), inp, f.hint ? H("small", {}, f.hint) : null)); }
      const btns = H("div", { class: "sh-dbtns" }, err, H("button", { onclick: () => close(null) }, o.cancel || "Cancel"), String(o.ok || "").trim() === "" && o.ok != null ? H("span") : H("button", { class: "primary" + (o.danger ? " danger" : ""), onclick: async () => { const v = {}; for (const k of Object.keys(inputs)) v[k] = inputs[k].value; try { if (o.validate) await o.validate(v); close(o.fields && o.fields.length ? v : true); } catch (e) { err.textContent = e.message; } } }, o.ok || "OK"));
      card.append(btns); box.append(card); if (o.must) box.dataset.noback = "1"; else delete box.dataset.noback; box.classList.add("open");
      box.onclick = (e) => { if (e.target === box) close(null); };
      card.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.tagName !== "TEXTAREA") { e.preventDefault(); btns.lastChild.click(); } if (e.key === "Escape") close(null); });
      setTimeout(() => { const first = card.querySelector("input,select,textarea") || btns.lastChild; first.focus(); }, 30);
    });
  },
  // the viewer: a file opens in place, at once — images, PDFs, text, sound and video — with Open in app / Download beside it
  async view(opt) {
    const H = this.H.bind(this); const { name, blob } = opt; const mime = opt.mime || blob.type || ""; const t = opt.type || this.kindOf(name, mime);
    let box = document.getElementById("shview"); if (box) box.remove(); box = H("div", { id: "shview" }); document.body.append(box);
    const close = () => { box.classList.remove("open"); setTimeout(() => box.remove(), 200); document.removeEventListener("keydown", onKey, true); for (const u of urls) URL.revokeObjectURL(u); };
    const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); (box._closeAll || close)(); } }; document.addEventListener("keydown", onKey, true);
    const urls = []; const url = () => { const u = URL.createObjectURL(blob); urls.push(u); return u; };
    const acts = H("div", { class: "vw-acts" });
    const zoomUI = (t === "image" || t === "pdf") ? H("div", { class: "vw-zoomui" }, H("button", { title: "Zoom out (Ctrl −)", "aria-label": "Zoom out", onclick: () => zoomer && zoomer.step(-1) }, "−"), H("button", { class: "vw-zpct", title: "Fit to width", onclick: () => zoomer && zoomer.set(1) }, "100%"), H("button", { title: "Zoom in (Ctrl +)", "aria-label": "Zoom in", onclick: () => zoomer && zoomer.step(1) }, "+")) : null;
    let zoomer = null; if (zoomUI) acts.append(zoomUI);
    if (this.host && this.host.openNative && this.isMobile()) acts.append(H("button", { onclick: () => this.host.openNative({ name, mime }, blob) }, "Open in app"));
    if (opt.download !== false) acts.append(H("button", { onclick: () => this.download(name, blob) }, this.isMobile() ? "Share" : "Download"));
    for (const x of opt.extra || []) if (x) acts.append(x);
    acts.append(H("button", { class: "vw-close", onclick: close }, "Close"));
    const body = H("div", { class: "vw-body" });
    box.append(H("div", { class: "vw-head" }, H("div", { class: "vw-title" }, H("b", {}, name), H("span", { class: "sh-dim" }, this.fmtBytes(blob.size) + (opt.sub ? " · " + opt.sub : ""))), acts), body);
    requestAnimationFrame(() => box.classList.add("open"));
    const onKeyZoom = (e) => { if (!zoomer || !(e.ctrlKey || e.metaKey)) return; if (e.key === "+" || e.key === "=") { e.preventDefault(); zoomer.step(1); } else if (e.key === "-") { e.preventDefault(); zoomer.step(-1); } else if (e.key === "0") { e.preventDefault(); zoomer.set(1); } }; document.addEventListener("keydown", onKeyZoom); const close0 = close; let pdfDoc = null; const closeAll = () => { document.removeEventListener("keydown", onKeyZoom); if (zoomer) zoomer.destroy(); if (pdfDoc) { try { pdfDoc.destroy(); } catch (e) { /* done */ } pdfDoc = null; } close0(); }; box._closeAll = closeAll; acts.lastChild.onclick = closeAll;
    try {
      if (t === "image") { const img = H("img", { class: "vw-img", src: url(), alt: name }); const wrap = H("div", { class: "vw-zoom" }, img); body.append(wrap); await new Promise((r) => { if (img.complete && img.naturalWidth) r(); else { img.onload = r; img.onerror = r; } }); const fitW = () => Math.min(body.clientWidth - 36, img.naturalWidth || 1000); zoomer = this.zoomer(body, wrap, { apply: (z) => { img.style.width = Math.round(fitW() * z) + "px"; img.style.maxWidth = "none"; img.style.maxHeight = "none"; }, label: zoomUI }); zoomer.set(1); }
      else if (t === "pdf") { if (true /* 4.10.1: pdf.js everywhere — the same fast, zoomable view on desktop and phone, no plug-in dependence */ || this.isMobile() || !this.hasNativePdf() || opt.render) { const pdf = await this.renderPdf(blob, body); if (!box.isConnected) { pdf.destroy(); return box; } pdfDoc = pdf; zoomer = this.zoomer(body, pdf.col, { apply: (z, settled) => pdf.setZoom(z, settled), label: zoomUI }); } else { body.append(H("iframe", { class: "vw-frame", src: url() + "#toolbar=0&view=FitH" })); if (zoomUI) zoomUI.remove(); } }
      else if (t === "text" || t === "sheet" && /\.csv$/i.test(name)) { const text = await blob.text(); if (/\.csv$/i.test(name)) { const rows = text.split(/\r?\n/).filter(Boolean).slice(0, 500).map((l) => l.split(",")); body.append(H("div", { class: "vw-table" }, H("table", { class: "sh-t" }, H("tbody", {}, rows.map((r) => H("tr", {}, r.map((c) => H("td", {}, c)))))))); } else body.append(H("pre", { class: "vw-text" }, text.slice(0, 400000))); }
      else if (t === "audio") body.append(H("audio", { controls: true, src: url(), style: "width:100%" }));
      else if (t === "video") body.append(H("video", { controls: true, src: url(), class: "vw-video" }));
      else body.append(H("div", { class: "vw-none" }, this.icon("doc", "big"), H("div", {}, "No preview for this kind of file."), this.host && this.host.openNative ? H("button", { class: "primary", onclick: () => this.host.openNative({ name, mime }, blob) }, "Open in app") : H("button", { class: "primary", onclick: () => this.download(name, blob) }, "Download")));
    } catch (e) { body.innerHTML = ""; console.error("viewer:", e); body.append(H("div", { class: "vw-none" }, this.icon("doc", "big"), H("div", {}, "Could not show this file"), H("div", { class: "sh-dim", style: "font-size:12px;max-width:420px;text-align:center" }, e.message || String(e)), this.host && this.host.openNative ? H("button", { class: "primary", onclick: () => this.host.openNative({ name, mime }, blob) }, "Open in app") : H("button", { class: "primary", onclick: () => this.download(name, blob) }, "Download"))); }
    return box;
  },
  // 4.9 · zoom for the viewer: Ctrl/⌘ + wheel, pinch, double-tap, +/− buttons; 50–400 %, around the pointer; `apply(z, settled)` sizes the
  // content (settled = the gesture ended, time to re-render crisply). The scroll position is kept so the point under the finger stays put.
  zoomer(scroller, content, opt) {
    const MIN = 0.5, MAX = 4; let z = 1, timer = null; const label = opt.label ? opt.label.querySelector(".vw-zpct") : null;
    const show = () => { if (label) label.textContent = Math.round(z * 100) + "%"; };
    const applyAt = (nz, cx, cy, settled) => {
      nz = Math.max(MIN, Math.min(MAX, nz)); const r = scroller.getBoundingClientRect(); const px = cx == null ? r.width / 2 : cx - r.left, py = cy == null ? r.height / 2 : cy - r.top;
      const f = nz / z; const ox = scroller.scrollLeft + px, oy = scroller.scrollTop + py; z = nz; opt.apply(z, !!settled); show();
      scroller.scrollLeft = ox * f - px; scroller.scrollTop = oy * f - py;
      clearTimeout(timer); if (!settled) timer = setTimeout(() => opt.apply(z, true), 220);
    };
    const onWheel = (e) => { if (!(e.ctrlKey || e.metaKey)) return; e.preventDefault(); applyAt(z * (e.deltaY < 0 ? 1.1 : 1 / 1.1), e.clientX, e.clientY, false); };
    let pinch = null, lastTap = 0;
    const dist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const onTS = (e) => { if (e.touches.length === 2) { pinch = { d: dist(e.touches), z, cx: (e.touches[0].clientX + e.touches[1].clientX) / 2, cy: (e.touches[0].clientY + e.touches[1].clientY) / 2 }; } else if (e.touches.length === 1) { const now = Date.now(); if (now - lastTap < 300) { e.preventDefault(); applyAt(z > 1.2 ? 1 : 2, e.touches[0].clientX, e.touches[0].clientY, true); } lastTap = now; } };
    const onTM = (e) => { if (pinch && e.touches.length === 2) { e.preventDefault(); applyAt(pinch.z * dist(e.touches) / pinch.d, pinch.cx, pinch.cy, false); } };
    const onTE = (e) => { if (pinch && e.touches.length < 2) { pinch = null; clearTimeout(timer); opt.apply(z, true); } };
    scroller.addEventListener("wheel", onWheel, { passive: false }); scroller.addEventListener("touchstart", onTS, { passive: false }); scroller.addEventListener("touchmove", onTM, { passive: false }); scroller.addEventListener("touchend", onTE); scroller.addEventListener("touchcancel", onTE);
    show();
    return { get: () => z, set: (nz) => applyAt(nz, null, null, true), step: (d) => applyAt(z * (d > 0 ? 1.25 : 0.8), null, null, true), destroy() { clearTimeout(timer); scroller.removeEventListener("wheel", onWheel); scroller.removeEventListener("touchstart", onTS); scroller.removeEventListener("touchmove", onTM); scroller.removeEventListener("touchend", onTE); scroller.removeEventListener("touchcancel", onTE); } };
  },
  kindOf(name, mime) { const ext = (name || "").toLowerCase().split(".").pop(); mime = mime || ""; if (mime.startsWith("image/") || ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "heic"].includes(ext)) return "image"; if (mime === "application/pdf" || ext === "pdf") return "pdf"; if (mime.startsWith("audio/") || ["mp3", "m4a", "wav", "ogg", "aac"].includes(ext)) return "audio"; if (mime.startsWith("video/") || ["mp4", "mov", "webm", "m4v"].includes(ext)) return "video"; if (["csv", "xls", "xlsx"].includes(ext)) return "sheet"; if (mime.startsWith("text/") || ["txt", "md", "json", "log", "xml", "ics", "eml"].includes(ext)) return "text"; if (["doc", "docx", "rtf", "odt"].includes(ext)) return "doc"; if (["ppt", "pptx", "key"].includes(ext)) return "slides"; return "file"; },
  hasNativePdf() { return !this.isMobile() && !!(navigator.pdfViewerEnabled || (navigator.mimeTypes && navigator.mimeTypes["application/pdf"])); },
  // 4.8.3: the first preview used to pay for loading the PDF engine (~1 MB on the phone) and starting its worker; now both happen
  // quietly a few seconds after the home is up, so the first document opens as fast as the second
  warmPreview() { if (this._warmed || typeof requestAnimationFrame === "undefined") return; this._warmed = true; const go = () => { this.pdfjs().then(async (lib) => { try { const tiny = "%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 10 10]>>endobj\ntrailer<</Root 1 0 R>>"; const doc = await lib.getDocument({ data: new TextEncoder().encode(tiny) }).promise; await doc.getPage(1); doc.destroy(); } catch (e) { /* the real open will say */ } }).catch(() => { this._warmed = false; }); }; if (window.requestIdleCallback) requestIdleCallback(go, { timeout: 8000 }); else setTimeout(go, 4000); },
  async pdfjs() { if (this._pdfjs) return this._pdfjs; if (this._pdfjsP) return this._pdfjsP; const phone = !!window.PHONE_HOST || !!window.WEB_HOST; /* 4.10.1: the engine ships inside src/pdf (and lib/pdf on the phone) — one path on every platform; the node_modules copy is the fallback */ const bases = phone ? [[new URL("lib/pdf/", location.href).href, ".js"]] : [[new URL("pdf/", location.href).href, ".js"], [new URL("../node_modules/pdfjs-dist/legacy/build/", location.href).href, ".mjs"]];
    const tryAt = (i) => { if (i >= bases.length) return Promise.reject(new Error("The PDF engine could not be loaded")); const [base, ext] = bases[i]; return import(base + "pdf.min" + ext).then((mod) => { mod.GlobalWorkerOptions.workerSrc = base + "pdf.worker.min" + ext; return mod; }).catch(() => tryAt(i + 1)); };
    this._pdfjsP = tryAt(0).then((mod) => { this._pdfjs = mod; return mod; }).finally(() => { this._pdfjsP = null; }); return this._pdfjsP; },
  // pages rendered as they come into view, at the screen's pixel density, into a scrolling column
  async renderPdf(blob, into) {
    const H = this.H.bind(this); const wait = H("div", { class: "vw-none" }, H("span", { class: "sh-spin small" }), "Opening…"); into.append(wait);
    let lib, doc; try { lib = await this.pdfjs(); doc = await lib.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise; } finally { wait.remove(); }
    const col = H("div", { class: "vw-pdf" }); into.append(col); const W0 = Math.min(into.clientWidth - 24, 1000); const dpr0 = Math.min(window.devicePixelRatio || 1, 2);
    let W = W0; const pages = new Map(); // i -> { page, vp0 }
    const slots = []; for (let i = 1; i <= doc.numPages; i++) { const slot = H("div", { class: "vw-page" }); slot.style.width = W + "px"; slot.style.height = Math.round(W * 1.414) + "px"; col.append(slot); slots.push(slot); }
    const sizeSlot = (i) => { const slot = slots[i - 1]; const p = pages.get(i); const h = p ? Math.round(W * p.vp0.height / p.vp0.width) : Math.round(W * 1.414); slot.style.width = W + "px"; slot.style.height = h + "px"; const c = slot.querySelector("canvas"); if (c) { c.style.width = W + "px"; c.style.height = h + "px"; } };
    const draw = async (i) => { const slot = slots[i - 1]; if (slot.dataset.w === String(W) || slot.dataset.busy) return; slot.dataset.busy = "1"; try { let p = pages.get(i); if (!p) { const page = await doc.getPage(i); p = { page, vp0: page.getViewport({ scale: 1 }) }; pages.set(i, p); } const scale = W / p.vp0.width; const vp = p.page.getViewport({ scale }); const dpr = Math.min(dpr0, 4096 / Math.max(1, vp.width)); const c = H("canvas"); c.width = Math.round(vp.width * dpr); c.height = Math.round(vp.height * dpr); c.style.width = vp.width + "px"; c.style.height = vp.height + "px"; slot.style.height = vp.height + "px"; const g = c.getContext("2d"); g.scale(dpr, dpr); await p.page.render({ canvasContext: g, viewport: vp }).promise; const old = slot.querySelector("canvas"); if (old) old.replaceWith(c); else slot.append(c); slot.dataset.w = String(W); } finally { delete slot.dataset.busy; } };
    const visible = () => { const r = into.getBoundingClientRect(); return slots.map((s2, k) => ({ s2, k })).filter(({ s2 }) => { const b = s2.getBoundingClientRect(); return b.bottom > r.top - 600 && b.top < r.bottom + 600; }).map(({ k }) => k + 1); };
    const io = new IntersectionObserver((es) => { for (const e of es) if (e.isIntersecting) draw(slots.indexOf(e.target) + 1); }, { root: into, rootMargin: "600px 0px" }); into.append(H("div", { class: "vw-count sh-faint" }, doc.numPages + (doc.numPages === 1 ? " page" : " pages"))); await draw(1); slots.forEach((s2) => io.observe(s2));
    // zoom: during a gesture the canvases are only resized (CSS); when it settles, the visible pages are drawn again at the new width
    const setZoom = (z, settled) => { W = Math.round(W0 * z); col.style.width = Math.max(W, into.clientWidth - 24) + "px"; for (let i = 1; i <= slots.length; i++) sizeSlot(i); if (settled) for (const i of visible()) draw(i); };
    return { col, doc, setZoom, destroy: () => { io.disconnect(); try { doc.destroy(); } catch (e) { /* done */ } } };
  },
  // phone: a row slides left or right to show its actions (opt.left = actions shown when you swipe left, opt.right = when you swipe right);
  // a tap on an open row closes it; opening one closes any other
  swipe(row, opt) {
    if (!this.isMobile() || !("ontouchstart" in window)) return row;
    const H = this.H.bind(this); const W = 84; let sx = 0, sy = 0, dx = 0, dragging = null, open = 0, built = false, timer = null;
    const n = (side) => ((side === "r" ? opt.left : opt.right) || []).length; let span = 0; const commitAt = () => Math.max(2 * W, Math.round(span * 0.58)); let committed = 0;
    // a swipe carried most of the way across commits the first action of that side without a tap: the pane stretches to show it
    // (4.8.3: the row's width is read once per gesture and the stretch is a single style write when the threshold is crossed —
    // nothing in the move handler forces layout, so the row follows the finger at the screen's frame rate)
    const stretch = (x) => { const side = x < 0 ? "r" : "l"; const c = Math.abs(x) >= commitAt() ? (x < 0 ? -1 : 1) : 0; if (c === committed) return; const pane = row.querySelector(".sw-acts." + side); if (!pane) return; committed = c; row.classList.toggle("sw-commit", !!c); if (c && navigator.vibrate) { try { navigator.vibrate(8); } catch (e) { /* nothing */ } } const first = pane.firstElementChild; if (first) first.style.width = c ? span + "px" : ""; };
    const build = () => { if (built) return; built = true; row.classList.add("sw-row"); const mk = (side, acts) => { if (!acts || !acts.length) return; const p = H("div", { class: "sw-acts " + side }); for (const a of acts) p.append(H("button", { class: a.cls || "", onclick: (e) => { e.stopPropagation(); e.preventDefault(); close(); a.fn(); } }, a.icon ? this.glyph(a.icon) : null, H("span", {}, a.l))); row.append(p); }; mk("r", opt.left); mk("l", opt.right); };
    const set = (x) => { row.style.transform = x ? "translateX(" + x + "px)" : ""; };
    const close = () => { open = 0; set(0); clearTimeout(timer); timer = setTimeout(() => { if (!open) row.classList.remove("sw-open"); }, 220); if (this._swOpen === row) this._swOpen = null; };
    row._swClose = close;
    row.addEventListener("touchstart", (e) => { if (e.touches.length !== 1) return; sx = e.touches[0].clientX; sy = e.touches[0].clientY; dx = open; dragging = null; span = row.offsetWidth; if (this._swOpen && this._swOpen !== row) this._swOpen._swClose(); row.style.transition = "none"; }, { passive: true });
    row.addEventListener("touchmove", (e) => { const t = e.touches[0]; const mx = t.clientX - sx, my = t.clientY - sy; if (dragging === null) { if (Math.abs(mx) < 8 && Math.abs(my) < 8) return; dragging = Math.abs(mx) > Math.abs(my) * 1.2; if (!dragging) return; build(); clearTimeout(timer); row.classList.add("sw-open"); } if (!dragging) return; e.preventDefault(); const maxL = n("r") * W, maxR = n("l") * W; dx = Math.max(maxL ? -span : 0, Math.min(maxR ? span : 0, open + mx)); set(dx); stretch(dx); }, { passive: false });
    const end = () => { if (!dragging) return; dragging = null; row.style.transition = "transform 180ms cubic-bezier(.2, .8, .2, 1)"; const maxL = n("r") * W, maxR = n("l") * W;
      if (committed) { const acts = committed < 0 ? opt.left : opt.right; const a = acts && acts[0]; const side = committed < 0 ? "r" : "l"; set(committed < 0 ? -span : span);
        const finish = () => { close(); row.classList.remove("sw-commit"); const first = row.querySelector(".sw-acts." + side + " > button"); if (first) first.style.width = ""; committed = 0; row.style.transition = ""; if (a) a.fn(); };
        // an action that takes the row away (Trash, Delete, Leave, Archive…) folds it shut instead of sliding it back first
        const removes = a && (a.collapse || /danger/.test(a.cls || "") || /^(archive|trash|delete|remove|leave)$/i.test(a.l || ""));
        if (removes) { setTimeout(() => { const h = row.offsetHeight; row.style.height = h + "px"; row.style.overflow = "hidden"; row.style.transition = "transform 180ms cubic-bezier(.2, .8, .2, 1), height 200ms ease, opacity 200ms ease, padding 200ms ease, border-width 200ms ease"; requestAnimationFrame(() => { row.style.height = "0px"; row.style.paddingTop = row.style.paddingBottom = "0px"; row.style.borderBottomWidth = "0px"; row.style.opacity = "0"; }); setTimeout(() => { finish(); if (row.isConnected) { row.style.height = row.style.overflow = row.style.opacity = row.style.paddingTop = row.style.paddingBottom = row.style.borderBottomWidth = ""; } }, 210); }, 170); return; }
        setTimeout(finish, 160); return; }
      if (maxL && dx < -maxL / 2) { open = -maxL; set(open); this._swOpen = row; } else if (maxR && dx > maxR / 2) { open = maxR; set(open); this._swOpen = row; } else close(); setTimeout(() => { row.style.transition = ""; }, 220); };
    row.addEventListener("touchend", end); row.addEventListener("touchcancel", end);
    row.addEventListener("click", (e) => { if (open && !e.target.closest(".sw-acts")) { e.stopPropagation(); e.preventDefault(); close(); } }, true);
    return row;
  },
  // ---------- 4.20 · enlarge anything: a table or a chart opens full-window in the suite's own frame (the band with the lockup, the
  // title, Esc/Close). render(host) draws a fresh, full-size copy; without it the element itself moves in and moves back on close
  // (virtual tables re-home their windowing, charts redraw for the new size). One at a time; sheets and dialogs still open on top.
  enlarge(el, opt) {
    opt = opt || {}; const H = this.H.bind(this); const prev = document.querySelector(".sh-enlarge"); if (prev && prev._close) prev._close();
    const title = opt.title || (el && (el.dataset && el.dataset.enlarge)) || (el && el.closest && (() => { const p = el.closest(".sh-panel, .panel, .psf-panel, section"); const h = p && p.querySelector("h3, h2, .ttl"); if (!h) return ""; const parts = [...h.childNodes].map((n) => (n.textContent || "").trim()).filter(Boolean); return parts.join(" · "); })()) || "";
    const ov = H("div", { class: "sh-enlarge" + (this.isMobile() ? " phone" : ""), role: "dialog", "aria-modal": "true", "aria-label": title || "Enlarged view" });
    const host = H("div", { class: "sh-enlarge-body" }); let placeholder = null, moved = null;
    const close = () => { if (ov._dead) return; ov._dead = true; document.removeEventListener("keydown", onKey, true); if (moved && placeholder && placeholder.parentNode) { placeholder.parentNode.replaceChild(moved, placeholder); moved.classList.remove("sh-enlarged"); settle(moved); } ov.remove(); document.body.classList.remove("sh-enlarging"); if (opt.onClose) { try { opt.onClose(); } catch (e) { /* ignore */ } } };
    const onKey = (e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); } };
    const settle = (node) => { try { if (node && typeof node.rehome === "function") node.rehome(); else if (node && typeof node.repaint === "function") node.repaint(); } catch (e) { /* ignore */ } try { for (const c of (node ? [node, ...node.querySelectorAll("*")] : [])) if (c && typeof c.redraw === "function") { const r = c.closest(".sh-enlarge-body") || c.parentElement; c.redraw(r ? r.clientWidth - 2 : undefined, r ? Math.max(240, r.clientHeight - 60) : undefined); break; } } catch (e) { /* ignore */ } window.dispatchEvent(new Event("resize")); };
    ov._close = close; ov.append(H("div", { class: "sh-enlarge-head" }, H("div", { class: "sh-enlarge-brand" }, this.wordmark(), H("span", { class: "sh-divider", "aria-hidden": "true" }, "|"), H("span", { class: "sh-enlarge-title" }, title || "Enlarged")), H("div", { class: "sh-enlarge-acts" }, opt.actions ? [].concat(opt.actions) : null, H("button", { class: "quiet sh-enlarge-close", title: "Close (Esc)", onclick: close }, this.isMobile() ? "Close" : "Esc"))), host);
    if (typeof opt.render === "function") { let node = null; try { node = opt.render(host); } catch (e) { node = H("div", { class: "sh-err" }, e.message); } if (node && node.nodeType === 1 && !node.isConnected) host.append(node); }
    else if (el && el.nodeType === 1) { placeholder = H("div", { class: "sh-enlarge-ph", style: "display:none" }); el.parentNode.insertBefore(placeholder, el); host.append(el); el.classList.add("sh-enlarged"); moved = el; }
    document.body.append(ov); document.body.classList.add("sh-enlarging"); document.addEventListener("keydown", onKey, true);
    requestAnimationFrame(() => { settle(moved || host.firstElementChild); setTimeout(() => settle(moved || host.firstElementChild), 120); });
    if (this.nav && this.nav.mark) { try { this.nav.mark("enlarge:" + (title || "")); } catch (e) { /* ignore */ } }
    return { close, el: ov, host };
  },
  // the small ⤢ control any app can put on a table or a chart: SUITE.enlargeable(el, title, { render }) → the button it added.
  // Elements carrying data-enlarge="Title" are picked up by SUITE.enlargeScan(root) after a render.
  enlargeable(el, title, opt) {
    if (!el || el._shx) return el ? el._shx : null; opt = opt || {}; const H = this.H.bind(this); if (title) el.dataset.enlarge = title;
    const btn = H("button", { type: "button", class: "sh-xbtn" + (opt.cls ? " " + opt.cls : ""), title: "Enlarge" + (title ? " · " + title : ""), "aria-label": "Enlarge " + (title || "this view"), onclick: (e) => { e.stopPropagation(); e.preventDefault(); this.enlarge(el, { title: title || el.dataset.enlarge, render: opt.render }); } }, H("span", { "aria-hidden": "true" }, "⤢"));
    const where = opt.into || el; where.classList.add("sh-xhost"); /* .sh-xhost positions relative (enlarge.css) — the element may not be in the document yet */ where.append(btn); el._shx = btn;
    // 4.32.3 · a host that scrolls (a wide table) keeps the control at the top-right of what is visible: it follows the scroll (one transform, no layout)
    where.addEventListener("scroll", () => { btn.style.transform = where.scrollLeft || where.scrollTop ? "translate(" + where.scrollLeft + "px," + where.scrollTop + "px)" : ""; }, { passive: true });
    return btn;
  },
  enlargeScan(root) { for (const el of (root || document).querySelectorAll("[data-enlarge]")) if (!el._shx) this.enlargeable(el, el.dataset.enlarge); },
  // 4.32.3 · every plain table wrapper of the suite (.sh-tw — Finance, Settings, Wealth, Documents, Portal …) that turns out wider than
  // its box carries ⤢ at the top-right of what is visible, without a sideways scroll (sh-xwide shows it; a table that fits has none).
  // PROSHIP's PSUI tables keep their own control in the header row, which sticks to the right edge (proship.css); ACCOUNTING's
  // .tablewrap has had its own since 4.9 (.twouter). Hosts are found as they are added, in one observer for every app.
  enlargeWide(w) { if (!w || w._shxw || w.classList.contains("psu-tw") || w.closest(".sh-enlarge-body")) return; w._shxw = true; const wide = () => w.classList.toggle("sh-xwide", w.isConnected && w.scrollWidth > w.clientWidth + 2); this.enlargeable(w, null); wide(); if (window.ResizeObserver) { const ro = new ResizeObserver(wide); ro.observe(w); const t = w.firstElementChild; if (t && t !== w._shx) ro.observe(t); } },
  enlargeWatch() { if (this._xwatch || typeof MutationObserver === "undefined" || !document.body) return; let q = [], raf = 0; const flush = () => { raf = 0; const list = q; q = []; for (const w of list) this.enlargeWide(w); }; const add = (n) => { if (!n || n.nodeType !== 1) return; if (n.classList.contains("sh-tw")) q.push(n); if (n.firstElementChild) for (const w of n.querySelectorAll(".sh-tw")) q.push(w); if (q.length && !raf) raf = requestAnimationFrame(flush); }; this._xwatch = new MutationObserver((recs) => { for (const r of recs) for (const n of r.addedNodes) add(n); }); this._xwatch.observe(document.body, { childList: true, subtree: true }); for (const w of document.querySelectorAll(".sh-tw")) this.enlargeWide(w); },
  async lockNow() { if (!this.lock.available()) { this.toast("Set a PIN in Settings → Security to use the lock"); return; } if (!(await this.confirm({ title: "Lock XYNTAX?", text: "The screen locks until you enter your PIN" + (typeof CLOUD !== "undefined" && CLOUD.signedIn() ? " or your password" : "") + ". Nothing is closed or signed out." }, "Lock"))) return; this.lock.now(); },
  async signOut() { if (!(await this.confirm({ title: "Sign out?", text: "This device leaves the company workspace. Your work is already saved to the cloud; to use XYNTAX here again you sign in with your username and password. Messages kept on this device are removed." }, "Sign out", true))) return; if (this.messagesWipe) { try { await this.messagesWipe(); } catch (e) { /* best effort */ } } if (this.host && this.host.signOut) this.host.signOut(); },
  confirm(text, ok, danger) { return this.dialog({ title: typeof text === "object" ? text.title : "Please confirm", text: typeof text === "object" ? text.text : text, ok: ok || "Yes", danger }); },
  prompt(title, label, value, type) { return this.dialog({ title, fields: [{ k: "v", label, value, type: type || "text" }], ok: "OK" }).then((v) => (v ? v.v : null)); },
  password(title, text) { return this.dialog({ title, text, fields: [{ k: "v", label: "Password", type: "password" }], ok: "Unlock" }).then((v) => (v ? v.v : null)); },
  menu(anchor, items) {
    const H = this.H.bind(this); const old = document.getElementById("shmenu"); if (old) { const same = old._anchor === anchor; old.remove(); if (same) return null; }
    const m = H("div", { id: "shmenu" }); for (const it of items) { if (!it) continue; if (it.sep) { m.append(H("div", { class: "sep" })); continue; } m.append(H("button", { class: (it.danger ? "danger" : "") + (it.disabled ? " off" : "") + (it.on ? " on" : ""), disabled: it.disabled ? true : null, onclick: (e) => { e.stopPropagation(); m.remove(); it.fn(); } }, it.l, it.d ? H("small", {}, it.d) : null)); }
    document.body.append(m); const r = anchor.getBoundingClientRect(); const W = m.offsetWidth || 200, Hh = m.offsetHeight || 200; const left = Math.min(window.innerWidth - W - 8, Math.max(8, r.right - W)); const top = r.bottom + 4 + Hh > window.innerHeight ? Math.max(8, r.top - Hh - 4) : r.bottom + 4; m.style.left = left + "px"; m.style.top = top + "px";
    m._anchor = anchor;
    const openedAt = Date.now(); const off = (e) => { if (Date.now() - openedAt < 450) return; if (anchor && anchor.contains && anchor.contains(e.target)) return; if (!m.contains(e.target)) { m.remove(); document.removeEventListener("mousedown", off, true); document.removeEventListener("touchstart", off, true); } }; setTimeout(() => { document.addEventListener("mousedown", off, true); document.addEventListener("touchstart", off, true); }, 0);
    return m;
  },
  form(opt) { if (this.host && this.host.form) return this.host.form(opt); if (typeof sheet !== "undefined" && sheet.open) return sheet.open(opt); return this.dialog({ title: opt.title, fields: opt.fields, ok: opt.submitLabel }).then((v) => v && opt.submit(v)); },

  // ---------- charts: lines and stacked areas on a canvas; hover and touch show the values
  get theme() { return typeof THEME !== "undefined" ? THEME : null; },
  isLight() { return typeof THEME !== "undefined" ? THEME.isLight() : document.documentElement.dataset.theme === "light"; },
  palette() { const light = this.isLight(); return light ? ["#1c1f24", "#1f5fbf", "#6a7280", "#9aa0ad", "#9a6a1f", "#1f7a46", "#b8423a", "#2f7f9a", "#8a92a3", "#555a68"] : ["#f0f2f5", "#a9d3df", "#9aa0a9", "#5f656f", "#c9a06a", "#9fd6b2", "#d9736b", "#7fb0c0", "#3f454e", "#cfd3d9"]; },
  // the wash under a filled line: the accent, strong at the line and gone at the base
  chartFill(g, top, bottom) { const cs = getComputedStyle(document.documentElement); const grad = g.createLinearGradient(0, top, 0, bottom); grad.addColorStop(0, cs.getPropertyValue("--chart-fill-top").trim() || "rgba(127,196,216,.22)"); grad.addColorStop(1, cs.getPropertyValue("--chart-fill-bottom").trim() || "rgba(127,196,216,.04)"); return grad; },
  chart(el, opt) {
    const dpr = window.devicePixelRatio || 1; const W = el.clientWidth || el.parentElement.clientWidth || 400, Hh = opt.height || 160; el.width = W * dpr; el.height = Hh * dpr; el.style.height = Hh + "px"; el.style.width = "100%";
    const g = el.getContext("2d"); g.scale(dpr, dpr); const light = this.isLight(); const pal = this.palette();
    const pad = { l: opt.padL || 54, r: 10, t: 10, b: 22 }; let series = opt.series.map((s, i) => ({ ...s, color: s.color || pal[i % pal.length] })); const n = Math.max(0, ...series.map((s) => s.values.length));
    if (!n) { g.fillStyle = light ? "#8a90a0" : "#4a4a4a"; g.font = "11px " + getComputedStyle(document.body).fontFamily; g.fillText(opt.empty || "No data yet", pad.l, Hh / 2); return; }
    let stackTops = null; if (opt.stacked) { stackTops = series.map(() => []); const acc = new Array(n).fill(0); series.forEach((s, si) => { for (let i = 0; i < n; i++) { acc[i] += s.values[i] || 0; stackTops[si][i] = acc[i]; } }); }
    const all = opt.stacked ? stackTops.flat() : series.flatMap((s) => s.values.filter((v) => v != null)); let min = opt.zero === false ? Math.min(...all) : Math.min(0, ...all), max = Math.max(...all); if (min === max) max = min + 1; const span = max - min; min -= opt.zero === false ? span * 0.05 : 0; max += span * 0.06;
    const x = (i) => pad.l + (W - pad.l - pad.r) * (n > 1 ? i / (n - 1) : 0.5), y = (v) => pad.t + (Hh - pad.t - pad.b) * (1 - (v - min) / (max - min)); const font = getComputedStyle(document.body).fontFamily;
    const axisStep = (max - min) / 4; const unit = Math.max(Math.abs(min), Math.abs(max)) >= 1e6 ? 1e6 : Math.max(Math.abs(min), Math.abs(max)) >= 1e3 ? 1e3 : 1; const dec = Math.min(3, Math.max(0, Math.ceil(-Math.log10(axisStep / unit)))) || 0;
    const fmt = opt.fmt || ((v) => (unit === 1e6 ? (v / 1e6).toFixed(dec) + "m" : unit === 1e3 ? (v / 1e3).toFixed(dec) + "k" : (+v).toFixed(dec)));
    const draw = (hi) => {
      g.clearRect(0, 0, W, Hh); g.strokeStyle = light ? "#e6e8ee" : "#1a1a1a"; g.fillStyle = light ? "#6b7280" : "#6a6a6a"; g.font = "10px " + font; g.textAlign = "right"; g.lineWidth = 1;
      for (let k = 0; k <= 4; k++) { const v = min + (max - min) * k / 4; g.beginPath(); g.moveTo(pad.l, y(v)); g.lineTo(W - pad.r, y(v)); g.stroke(); g.fillText(fmt(v), pad.l - 6, y(v) + 3); }
      if (min < 0 && max > 0) { g.strokeStyle = light ? "#c9ccd6" : "#333"; g.beginPath(); g.moveTo(pad.l, y(0)); g.lineTo(W - pad.r, y(0)); g.stroke(); }
      g.textAlign = "center"; if (opt.labels) { const step = Math.ceil(opt.labels.length / Math.max(2, Math.floor((W - pad.l) / 64))); opt.labels.forEach((l, i) => { if (i % step === 0 || i === opt.labels.length - 1) g.fillText(l, x(i), Hh - 7); }); }
      if (opt.marker != null) { g.strokeStyle = light ? "#9aa0ae" : "#555"; g.setLineDash([2, 4]); g.beginPath(); g.moveTo(x(opt.marker), pad.t); g.lineTo(x(opt.marker), Hh - pad.b); g.stroke(); g.setLineDash([]); }
      series.forEach((s, si) => {
        const vals = opt.stacked ? stackTops[si] : s.values; const base = opt.stacked ? (si ? stackTops[si - 1] : new Array(n).fill(0)) : null;
        if (opt.stacked || s.fill) { const lastI = vals.length - 1; g.beginPath(); let started = false; vals.forEach((v, i) => { if (v == null) return; if (started) g.lineTo(x(i), y(v)); else { g.moveTo(x(i), y(v)); started = true; } }); if (base) for (let i = n - 1; i >= 0; i--) g.lineTo(x(i), y(base[i])); else { g.lineTo(x(lastI), y(Math.max(min, 0))); g.lineTo(x(vals.findIndex((v) => v != null)), y(Math.max(min, 0))); } g.closePath(); if (opt.stacked) { g.fillStyle = s.color; g.globalAlpha = 0.22 + 0.08 * (si % 3); } else { g.fillStyle = SUITE.chartFill(g, pad.t, Hh - pad.b); g.globalAlpha = 1; } g.fill(); g.globalAlpha = 1; }
        if (s.type === "bar") { const bw = Math.max(2, (W - pad.l - pad.r) / n * 0.6); vals.forEach((v, i) => { if (v == null) return; g.fillStyle = v >= 0 ? s.color : (light ? "#c33a34" : "#7a3a3a"); g.fillRect(x(i) - bw / 2, Math.min(y(0), y(v)), bw, Math.abs(y(v) - y(0))); }); return; }
        g.strokeStyle = s.color; g.lineWidth = s.width || 1.6; if (s.dashed) g.setLineDash([4, 4]); g.beginPath(); let pen = false; vals.forEach((v, i) => { if (v == null) { pen = false; return; } if (pen) g.lineTo(x(i), y(v)); else g.moveTo(x(i), y(v)); pen = true; }); g.stroke(); g.setLineDash([]);
        if (s.dots || n < 40) { g.fillStyle = s.color; vals.forEach((v, i) => { if (v == null) return; g.beginPath(); g.arc(x(i), y(v), 2, 0, 7); g.fill(); }); }
      });
      if (hi != null) { g.strokeStyle = light ? "#b8bcc8" : "#444"; g.setLineDash([3, 3]); g.beginPath(); g.moveTo(x(hi), pad.t); g.lineTo(x(hi), Hh - pad.b); g.stroke(); g.setLineDash([]); series.forEach((s, si) => { const v = opt.stacked ? stackTops[si][hi] : s.values[hi]; if (v == null) return; g.fillStyle = s.color; g.beginPath(); g.arc(x(hi), y(v), 3.5, 0, 7); g.fill(); }); }
    };
    draw();
    let tip = el.parentElement.querySelector(".sh-ctip"); if (!tip) { tip = this.H("div", { class: "sh-ctip" }); el.parentElement.style.position = "relative"; el.parentElement.append(tip); }
    let lastHi = null; const show = (clientX) => { const r = el.getBoundingClientRect(); const mx = clientX - r.left; let best = 0, bd = 1e9; for (let i = 0; i < n; i++) { const d = Math.abs(x(i) - mx); if (d < bd) { bd = d; best = i; } } if (best === lastHi && tip.style.display === "block") return; lastHi = best; draw(best); tip.style.display = "block"; tip.style.left = Math.min(W - 170, Math.max(0, x(best) + 8)) + "px"; tip.innerHTML = "<b>" + this.esc(opt.labels ? opt.labels[best] : best) + "</b>" + series.map((s) => (s.values[best] != null ? "<div><i style='background:" + s.color + "'></i>" + this.esc(s.name || "") + " <b>" + this.esc(opt.tipFmt ? opt.tipFmt(s.values[best]) : fmt(s.values[best])) + "</b></div>" : "")).join(""); };
    el.onmousemove = (ev) => show(ev.clientX); el.onmouseleave = () => { lastHi = null; draw(); tip.style.display = "none"; }; el.ontouchstart = el.ontouchmove = (ev) => { show(ev.touches[0].clientX); }; el.ontouchend = () => { setTimeout(() => { draw(); tip.style.display = "none"; }, 1500); };
  },
  chartBlock(opt) { const cv = this.H("canvas", { class: "sh-chart" }); const wrap = this.H("div", { class: "sh-chartwrap", style: "min-height:" + ((opt.height || 160) + 4) + "px" }, cv); const legend = this.H("div", { class: "sh-legend" }); const pal = this.palette(); opt.series.forEach((s, i) => legend.append(this.H("span", {}, this.H("i", { style: "background:" + (s.color || pal[i % pal.length]) }), s.name || ""))); if (opt.series.length > 1) wrap.append(legend); setTimeout(() => this.chart(cv, opt), 0); const ro = new ResizeObserver(() => this.chart(cv, opt)); setTimeout(() => ro.observe(wrap), 50); return wrap; },

  spark(values, w, hgt, color) { const vs = values.filter((v) => v != null); const svgNS = "http://www.w3.org/2000/svg"; const el = document.createElementNS(svgNS, "svg"); el.setAttribute("viewBox", "0 0 " + (w || 90) + " " + (hgt || 22)); el.setAttribute("class", "sh-spark"); if (vs.length < 2) return el; const min = Math.min(...vs), max = Math.max(...vs); const W = w || 90, Hh = hgt || 22; const pts = values.map((v, i) => (v == null ? null : [(i / (values.length - 1)) * (W - 2) + 1, Hh - 2 - ((v - min) / ((max - min) || 1)) * (Hh - 4)])).filter(Boolean); const path = document.createElementNS(svgNS, "path"); path.setAttribute("d", pts.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" ")); path.setAttribute("fill", "none"); path.setAttribute("stroke", color || "currentColor"); path.setAttribute("stroke-width", "1.4"); path.setAttribute("stroke-linejoin", "round"); el.append(path); const dot = document.createElementNS(svgNS, "circle"); const last = pts[pts.length - 1]; dot.setAttribute("cx", last[0]); dot.setAttribute("cy", last[1]); dot.setAttribute("r", "1.8"); dot.setAttribute("fill", color || "currentColor"); el.append(dot); return el; },
  // ---------- per-device preferences (what this user chose on this device)
  prefs: {
    key() { const u = typeof CLOUD !== "undefined" && CLOUD.session() ? CLOUD.session().user_id : "local"; return "xyntax.suite.prefs." + u; },
    get() { try { return { notify: true, activity: true, idleMin: 0, pin: null, dueMorning: "08:00", ...JSON.parse(localStorage.getItem(this.key()) || "{}") }; } catch (e) { return { notify: true, activity: true, idleMin: 0, pin: null, dueMorning: "08:00" }; } },
    set(patch) { localStorage.setItem(this.key(), JSON.stringify({ ...this.get(), ...patch })); },
  },
  // ---------- reminders from every app in one place: checked every 30 s while XYNTAX is open, pushed to the phone's scheduler
  reminders: {
    timer: null, firedKey() { return SUITE.prefs.key().replace("prefs", "fired"); },
    fired() { try { return JSON.parse(localStorage.getItem(this.firedKey()) || "{}"); } catch (e) { return {}; } },
    start() { if (this.timer) return; this.timer = setInterval(() => this.tick(), 30000); setTimeout(() => this.tick(), 2500); setInterval(() => this.push(), 10 * 60000); setTimeout(() => this.push(), 4000); },
    async collect() { const out = []; SUITE.db.hush(); try { for (const [id, mod] of Object.entries(SUITE.apps)) { if (!mod.reminders || !SUITE.allowed(id)) continue; try { const list = await mod.reminders(); for (const r of list || []) out.push({ ...r, app: id }); } catch (e) { /* that app is not ready or still sealed */ } } } finally { SUITE.db.unhush(); } return out; },
    async tick() { if (!SUITE.prefs.get().notify || (SUITE.lock && SUITE.lock.locked)) return; const now = Date.now(); const fired = this.fired(); let changed = false; const list = await this.collect(); for (const r of list) { const at = r.at instanceof Date ? r.at.getTime() : new Date(r.at).getTime(); if (now >= at && now < at + 15 * 60000 && !fired[r.id]) { fired[r.id] = now; changed = true; SUITE.notify(r.title, r.body, r.id); } } for (const k of Object.keys(fired)) if (now - fired[k] > 14 * 86400000) { delete fired[k]; changed = true; } if (changed) localStorage.setItem(this.firedKey(), JSON.stringify(fired)); },
    async push() { if (!(SUITE.host && SUITE.host.scheduleReminders) || !SUITE.prefs.get().notify) return; const list = (await this.collect()).filter((r) => new Date(r.at) > new Date()).sort((a, b) => new Date(a.at) - new Date(b.at)).slice(0, 60).map((r, i) => ({ id: i + 1, title: r.title, body: r.body, at: new Date(r.at) })); try { await SUITE.host.scheduleReminders(list); } catch (e) { /* optional */ } },
  },
  // ---------- end-to-end encryption of the personal apps: a passphrase only you know seals notes, wealth and calendar before they
  // leave this device. The workspace then holds sealed bytes it cannot read. The passphrase is never stored; losing it loses the data.
  e2e: {
    /* End-to-end encryption of the personal apps. Since 4.4 the documents are sealed under a random 256-bit secret; the secret
     * is kept wrapped twice — under the passphrase and under a recovery key shown once at setup. Lose both and the data is gone
     * for everyone, us included: there is no third copy. Accounts from before 4.4 (secret = passphrase) are upgraded in place
     * the first time they unlock, gaining a recovery key without resealing anything. */
    pass: null, salt: null, marker: null,
    b64(u8) { let b = ""; for (let i = 0; i < u8.length; i += 0x8000) b += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(b); }, unb64(str) { const b = atob(str); const u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; },
    _markerKey() { const u = typeof CLOUD !== "undefined" && CLOUD.session() ? CLOUD.session().user_id : "local"; return "xyntax.suite.e2e.marker." + u; },
    async loadMarker() { if (this.marker !== null) return this.marker; let m = null; try { if (SUITE.db.cloud()) {
          // 4.10.2 · the marker (salt + check value, no secret) is kept on the device: no round trip before the first decrypt;
          // the workspace copy is compared in the background and replaces it when it changed (passphrase changed elsewhere)
          let local = null; try { local = JSON.parse(localStorage.getItem(this._markerKey()) || "null"); } catch (e) { local = null; }
          if (local && typeof local === "object") { m = local.off ? false : local; const self = this; setTimeout(async () => { try { const r = await CLOUD.suiteLoad("e2e"); const fresh = r.data && r.data.salt ? { ...r.data, version: r.version } : false; const was = local.off ? false : local; if (JSON.stringify(fresh) !== JSON.stringify(was)) { self.marker = fresh; self._kc = null; try { localStorage.setItem(self._markerKey(), JSON.stringify(fresh || { off: true })); } catch (e) { /* ignore */ } } } catch (e) { /* offline: the local marker stands */ } }, 0); }
          else { const r = await CLOUD.suiteLoad("e2e"); m = r.data && r.data.salt ? { ...r.data, version: r.version } : false; try { localStorage.setItem(this._markerKey(), JSON.stringify(m || { off: true })); } catch (e) { /* ignore */ } } } else { m = JSON.parse(localStorage.getItem("xyntax.suite.e2e") || "null") || false; } } catch (e) { m = false; } this.marker = m; if (m && !this.pass) { try { this.pass = sessionStorage.getItem("xyntax.e2e.pass") || null; } catch (e) { /* no session storage */ } } return m; },
    async saveMarker(marker) { if (SUITE.db.cloud()) { const r = await CLOUD.suiteLoad("e2e"); const v = await CLOUD.suiteSave("e2e", r.version, marker); this.marker = { ...marker, version: v }; try { localStorage.setItem(this._markerKey(), JSON.stringify(this.marker)); } catch (e) { /* ignore */ } this._kc = null; return; } else localStorage.setItem("xyntax.suite.e2e", JSON.stringify(marker)); this.marker = { ...marker }; this._kc = null; },
    async enabled() { const m = await this.loadMarker(); return !!m; },
    // 4.10.2 · PBKDF2 (250 000 rounds, a few hundred ms on a phone) runs once per passphrase+salt per session, not per document
    _kc: null,
    async key(pass, salt) { const sb = this.b64(salt); if (this._kc && this._kc.pass === pass && this._kc.salt === sb) return this._kc.key; const key = await SUITE.crypto.key(pass, salt); this._kc = { pass, salt: sb, key }; return key; },
    // the recovery key: 24 characters from an alphabet without look-alikes, in six groups
    newRecoveryKey() { const A = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; const r = crypto.getRandomValues(new Uint8Array(24)); let out = ""; for (let i = 0; i < 24; i++) { out += A[r[i] % A.length]; if (i % 4 === 3 && i < 23) out += "-"; } return out; },
    normKey(k) { return String(k || "").toUpperCase().replace(/[^A-Z2-9]/g, ""); },
    looksLikeKey(k) { return this.normKey(k).length === 24 && !/\s/.test(String(k).trim().replace(/-/g, "")) && /^[A-Z2-9-]+$/.test(String(k).trim().toUpperCase()); },
    async wrap(secret, phrase) { const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12)); const k = await this.key(phrase, salt); const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, k, new TextEncoder().encode(secret))); return { salt: this.b64(salt), iv: this.b64(iv), ct: this.b64(ct) }; },
    async unwrap(box, phrase) { const k = await this.key(phrase, this.unb64(box.salt)); const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: this.unb64(box.iv) }, k, this.unb64(box.ct)); return new TextDecoder().decode(pt); },
    async sealJSON(obj) { const m = await this.loadMarker(); const salt = this.unb64(m.salt); const iv = crypto.getRandomValues(new Uint8Array(12)); const k = await this.key(this.pass, salt); const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, k, new TextEncoder().encode(JSON.stringify(obj)))); return { __sealed: 1, iv: this.b64(iv), ct: this.b64(ct) }; },
    async openJSON(box) { const m = await this.loadMarker(); const salt = this.unb64(m.salt); const k = await this.key(this.pass, salt); const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: this.unb64(box.iv) }, k, this.unb64(box.ct)); return JSON.parse(new TextDecoder().decode(pt)); },
    async verifySecret(secret) { const m = await this.loadMarker(); try { const k = await this.key(secret, this.unb64(m.salt)); const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: this.unb64(m.iv) }, k, this.unb64(m.ct)); return new TextDecoder().decode(pt) === "xyntax-e2e-ok"; } catch (e) { return false; } },
    // a passphrase or a recovery key → the secret (null when neither fits); legacy markers take the passphrase itself as the secret
    async resolve(entered) {
      const m = await this.loadMarker(); if (!m) return null;
      if (m.v >= 2) { for (const box of [m.wp, this.looksLikeKey(entered) ? m.wr : null]) { if (!box) continue; try { const secret = await this.unwrap(box, box === m.wr ? this.normKey(entered) : entered); if (await this.verifySecret(secret)) return { secret, viaRecovery: box === m.wr }; } catch (e) { /* next */ } } return null; }
      if (await this.verifySecret(entered)) return { secret: entered, legacy: true }; if (m.wr && this.looksLikeKey(entered)) { try { const secret = await this.unwrap(m.wr, this.normKey(entered)); if (await this.verifySecret(secret)) return { secret, viaRecovery: true, legacy: true }; } catch (e) { /* no */ } } return null;
    },
    async check(pass) { const m = await this.loadMarker(); if (!m) return true; return !!(await this.resolve(pass)); },
    remember(secret) { this.pass = secret; this.okPass = secret; try { sessionStorage.setItem("xyntax.e2e.pass", secret); } catch (e) { /* ignore */ } },
    async ensure() { // make sure the secret is in memory; asks for the passphrase when a sealed document is met (one prompt at a time)
      if (!(await this.enabled())) return true; if (this.pass && this.okPass === this.pass) return true; if (this.pass && await this.verifySecret(this.pass)) { this.okPass = this.pass; return true; } this.pass = null;
      if (SUITE.db.quiet > 0) return false; if (this._asking) return this._asking;
      this._asking = (async () => { try { for (let i = 0; i < 3; i++) { const p = await SUITE.password("Your passphrase", "Your personal apps are encrypted end to end. Enter the passphrase you chose" + (i ? " (that one was not right)" : "") + " — or your recovery key."); if (p == null) return false; const r = await this.resolve(p); if (r) { this.remember(r.secret); if (r.legacy && !r.viaRecovery) await this.upgrade(p).catch(() => {}); if (r.viaRecovery) await this.afterRecovery(); return true; } } return false; } finally { this._asking = null; } })(); return this._asking;
    },
    // switching on: a fresh secret, wrapped under the passphrase and under a recovery key; everything personal is resealed; the key is returned once
    async enable(pass) {
      const secret = this.b64(crypto.getRandomValues(new Uint8Array(32))); const R = this.newRecoveryKey();
      const salt = crypto.getRandomValues(new Uint8Array(16)); const iv = crypto.getRandomValues(new Uint8Array(12)); const k = await this.key(secret, salt); const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, k, new TextEncoder().encode("xyntax-e2e-ok")));
      const marker = { v: 2, salt: this.b64(salt), iv: this.b64(iv), ct: this.b64(ct), wp: await this.wrap(secret, pass), wr: await this.wrap(secret, this.normKey(R)), since: new Date().toISOString() };
      await this.saveMarker(marker); this.remember(secret); await this.resealAll(); const prev = this._retiredLockKey; this._retiredLockKey = null; this.publishLockKey(prev); if (typeof SECURITY !== "undefined") SECURITY.log("e2e_on", null, {}); return R;
    },
    // a pre-4.4 account: the passphrase stays the secret; it gains a wrapped copy and a recovery key without resealing
    async upgrade(pass) { const m = await this.loadMarker(); if (!m || m.v >= 2) return null; const R = this.newRecoveryKey(); const marker = { ...m, v: 2, wp: await this.wrap(pass, pass), wr: await this.wrap(pass, this.normKey(R)) }; delete marker.version; await this.saveMarker(marker); this._pendingKey = R; return R; },
    async changePassphrase(newPass) { if (!(await this.ensure())) throw new Error("Unlock first"); const m = await this.loadMarker(); const marker = { ...m, v: 2, wp: await this.wrap(this.pass, newPass) }; if (!marker.wr) { const R = this.newRecoveryKey(); marker.wr = await this.wrap(this.pass, this.normKey(R)); this._pendingKey = R; } delete marker.version; await this.saveMarker(marker); if (typeof SECURITY !== "undefined") SECURITY.log("passphrase_changed", null, {}); return true; },
    async rotateRecoveryKey() { if (!(await this.ensure())) throw new Error("Unlock first"); const m = await this.loadMarker(); const R = this.newRecoveryKey(); const marker = { ...m, v: 2, wr: await this.wrap(this.pass, this.normKey(R)) }; if (!marker.wp && m.v < 2) marker.wp = await this.wrap(this.pass, this.pass); delete marker.version; await this.saveMarker(marker); return R; },
    // unlocked with the recovery key: a new passphrase is set right away, and a new recovery key issued (the old one is spent)
    async afterRecovery() { const p = await SUITE.dialog({ must: true, title: "Choose a new passphrase", text: "You unlocked with your recovery key. Set a new passphrase now; a new recovery key follows, because the old one should be treated as used.", fields: [{ k: "a", label: "New passphrase", type: "password" }, { k: "b", label: "Again", type: "password" }], ok: "Set", validate: (v) => { if ((v.a || "").length < 8) throw new Error("At least 8 characters"); if (v.a !== v.b) throw new Error("The two do not match"); } }); if (!p) return; await this.changePassphrase(p.a); const R = await this.rotateRecoveryKey(); await this.showRecoveryKey(R); },
    // the one-time display of a recovery key
    async showRecoveryKey(R) { const H = SUITE.H.bind(SUITE); let box = document.getElementById("shdlg"); if (!box) { box = H("div", { id: "shdlg" }); document.body.append(box); } return new Promise((res) => { box.innerHTML = ""; const close = () => { delete box.dataset.noback; box.classList.remove("open"); box.innerHTML = ""; res(true); }; const chk = H("input", { type: "checkbox" }); const txt = "XYNTAX recovery key\n\n" + R + "\n\nThis key opens your encrypted personal apps if you forget your passphrase. Keep it where you keep your passport. Nobody at XYNTAX has a copy; without the passphrase or this key your encrypted data cannot be read by anyone, ever."; box.append(H("div", { class: "sh-dcard sh-rkey" }, H("h3", {}, "Your recovery key"), H("p", {}, "Write it down or save the file. It is shown once. If you forget your passphrase, this key is the only way back in — there is no reset, not even by us."), H("div", { class: "sh-rkey-code" }, R), H("div", { class: "sh-toolbar", style: "justify-content:center;gap:8px" }, H("button", { class: "quiet", onclick: () => { SUITE.copy(R); } }, "Copy"), H("button", { class: "quiet", onclick: () => SUITE.download("xyntax-recovery-key.txt", new Blob([txt], { type: "text/plain" })) }, "Save as file")), H("label", { class: "sh-chk", style: "justify-content:center;margin:14px 0 4px" }, chk, H("span", {}, "I have saved this key somewhere safe")), H("div", { class: "sh-dbtns" }, H("button", { class: "primary", onclick: () => { if (!chk.checked) { chk.focus(); return; } close(); } }, "Done")))); box.dataset.noback = "1"; box.classList.add("open"); }); },
    async disable() { try { this._retiredLockKey = await this.lockKey(); } catch (e) { this._retiredLockKey = null; } await this.resealAll(true); if (SUITE.db.cloud()) { const r = await CLOUD.suiteLoad("e2e"); await CLOUD.suiteSave("e2e", r.version, {}); } else localStorage.removeItem("xyntax.suite.e2e"); this.marker = false; this.pass = null; this._kc = null; try { localStorage.removeItem(this._markerKey()); } catch (e) { /* ignore */ } try { sessionStorage.removeItem("xyntax.e2e.pass"); } catch (e) { /* ignore */ } },
    async resealAll(plain) { for (const app of ["notes", "wealth", "calendar", "contacts"]) { const mod = SUITE.apps[app]; if (!mod) continue; SUITE.db.forget(app); const d = await SUITE.db.load(app, mod.defaults || {}); if (!d) continue; const c = SUITE.db.cache[app]; c.dirty = true; c.plain = !!plain; await SUITE.db.flush(app); delete c.plain; } },
    forget() { this.pass = null; this.okPass = null; this._kc = null; try { sessionStorage.removeItem("xyntax.e2e.pass"); } catch (e) { /* ignore */ } },
    // 4.7 · the lockdown key: K_lock = HKDF-SHA256(secret, salt = the marker's salt, info "xyntax-lockdown-v1"). The secret never leaves
    // the device; the server keeps only sha256(K_lock) and compares it when the person unlocks. The secret survives passphrase changes
    // and recovery, so K_lock is stable until encryption is switched off and on again (then the old key is presented to replace it).
    async lockKeyFor(secret) { const m = await this.loadMarker(); if (!m || !secret) return null; const km = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), "HKDF", false, ["deriveBits"]); const bits = await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: this.unb64(m.salt), info: new TextEncoder().encode("xyntax-lockdown-v1") }, km, 256); return this.b64(new Uint8Array(bits)); },
    async lockKey() { return this.lockKeyFor(this.pass); },
    async sha256b64(b64) { return this.b64(new Uint8Array(await crypto.subtle.digest("SHA-256", this.unb64(b64)))); },
    async publishLockKey(oldKey) { try { if (!SUITE.db.cloud() || typeof CLOUD === "undefined" || !CLOUD.signedIn()) return false; const k = await this.lockKey(); if (!k) return false; await CLOUD.account("set_lock_key", { hash: await this.sha256b64(k), old_key: oldKey || undefined }); this._lockKeyPublished = true; return true; } catch (e) { return false; } },
  },
  // ---------- lock screen: a PIN (or your password) after a quiet spell, or on demand (L on the dashboard, Lock in Settings)
  lock: {
    locked: false, last: Date.now(),
    async hash(pin, salt) { const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveBits"]); const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: SUITE.e2e.unb64(salt), iterations: 120000, hash: "SHA-256" }, base, 256); return SUITE.e2e.b64(new Uint8Array(bits)); },
    async setPin(pin) { if (!pin) { SUITE.prefs.set({ pin: null }); return; } const salt = SUITE.e2e.b64(crypto.getRandomValues(new Uint8Array(16))); SUITE.prefs.set({ pin: { salt, hash: await this.hash(pin, salt) } }); },
    async checkPin(pin) { const p = SUITE.prefs.get().pin; if (!p) return false; return (await this.hash(pin, p.salt)) === p.hash; },
    available() { return !!SUITE.prefs.get().pin || (typeof CLOUD !== "undefined" && CLOUD.signedIn()); },
    start() { if (this._on) return; this._on = true; const touch = () => { this.last = Date.now(); }; for (const ev of ["mousemove", "keydown", "touchstart", "click"]) document.addEventListener(ev, touch, { passive: true }); setInterval(() => { const m = SUITE.prefs.get().idleMin; if (m && !this.locked && this.available() && Date.now() - this.last > m * 60000) this.now(); }, 15000); document.addEventListener("visibilitychange", () => { if (!document.hidden) { const m = SUITE.prefs.get().idleMin; if (m && !this.locked && this.available() && Date.now() - this.last > m * 60000) this.now(); } }); },
    now() {
      if (this.locked || !this.available()) { if (!this.available()) SUITE.toast("Set a PIN in Settings → Security to use the lock"); return; }
      this.locked = true; const H = SUITE.H.bind(SUITE); let box = document.getElementById("shlock"); if (!box) { box = H("div", { id: "shlock" }); document.body.append(box); } box.innerHTML = "";
      for (const [id, mod] of Object.entries(SUITE.apps)) if (mod.onLock) { try { mod.onLock(); } catch (e) { /* ignore */ } }
      const hasPin = !!SUITE.prefs.get().pin; const cloud = typeof CLOUD !== "undefined" && CLOUD.signedIn();
      const inp = H("input", { type: "password", inputmode: hasPin ? "numeric" : "text", placeholder: hasPin ? "PIN" : "Password", autocomplete: "off", maxlength: hasPin ? 12 : null }); const err = H("div", { class: "sh-err", style: "min-height:16px;text-align:center" });
      const bio = SUITE.prefs.get().biometric && SUITE.host && SUITE.host.biometricPrompt; const unlockOk = () => { this.locked = false; this.last = Date.now(); box.classList.remove("open"); box.innerHTML = ""; };
      const tryBio = async () => { if (!bio) return; if (await SUITE.host.biometricPrompt("Unlock XYNTAX")) unlockOk(); };
      const tryUnlock = async () => { const v = inp.value; if (!v) return; let ok = false; if (hasPin) ok = await this.checkPin(v); else if (cloud) { try { ok = await CLOUD.verifyPassword(v); } catch (e) { ok = false; } } if (ok) { this.locked = false; this.last = Date.now(); box.classList.remove("open"); box.innerHTML = ""; } else { err.textContent = hasPin ? "Wrong PIN" : "Wrong password"; inp.value = ""; inp.focus(); } };
      inp.addEventListener("keydown", (e) => { if (e.key === "Enter") tryUnlock(); });
      box.append(H("div", { class: "sh-lockcard" }, H("div", { class: "sh-brand" }, SUITE.wordmark(), H("small", {}, "suite")), SUITE.icon("lock", "big"), H("div", { class: "sh-dim" }, "Locked" + (SUITE.userLabel() && SUITE.userLabel() !== "This computer" ? " · " + SUITE.userLabel() : "")), inp, err, H("button", { class: "primary", style: "width:100%", onclick: tryUnlock }, "Unlock"), bio ? H("button", { class: "quiet sh-bio", onclick: tryBio }, SUITE.icon("lock", "sh-g"), "Use fingerprint or face") : null, cloud ? H("button", { class: "quiet", style: "margin-top:6px", onclick: () => { SUITE.signOut(); } }, "Sign out instead") : null));
      box.classList.add("open"); if (bio) setTimeout(tryBio, 350); else setTimeout(() => inp.focus(), 50);
    },
  },
  // ---------- notifications (reminders): system notification when allowed, always an in-app toast
  async notify(title, body, tag) {
    if (!this.prefs.get().notify) return;
    if (this.host && this.host.notify) { try { await this.host.notify(title, body, tag); return; } catch (e) { /* fall through */ } }
    try { if ("Notification" in window) { if (Notification.permission === "default") await Notification.requestPermission(); if (Notification.permission === "granted") new Notification(title, { body, tag }); } } catch (e) { /* no system notifications here */ }
    this.toast(title + (body ? " — " + body : ""));
  },
};
if (typeof module !== "undefined") { module.exports = SUITE; module.exports.SUITE_FMT = SUITE_FMT; }
// a company is being opened across a reload: show the working state at once, before anything loads
try { const op = typeof sessionStorage !== "undefined" && sessionStorage.getItem("xyntax.opening"); if (op && typeof document !== "undefined") { const go = () => { SUITE.busy("Opening " + op + "…"); const b = document.getElementById("shbusy"); if (b) b.classList.add("now"); }; if (document.body) go(); else document.addEventListener("DOMContentLoaded", go); } } catch (e) { /* ignore */ }
// 4.8.3: the preview engine warms up a few seconds after sign-in (never during boot), so the first document opens at once
if (typeof window !== "undefined") { let tries = 0; const t = setInterval(() => { if (++tries > 24) return clearInterval(t); if (!document.querySelector("#home.open, #sapp.open")) return; clearInterval(t); SUITE.whenIdle(() => SUITE.warmPreview(), 8000); }, 2000); }
// 4.32.3 · wide tables carry ⤢ in view from the first paint (SUITE.enlargeWatch, above)
if (typeof document !== "undefined" && document.addEventListener) { const go = () => { try { SUITE.enlargeWatch(); } catch (e) { /* no observer here */ } }; if (document.body) go(); else document.addEventListener("DOMContentLoaded", go); }
// 4.31.3 · company documents follow a company switch inside the session (personal ones stay with their person)
if (typeof window !== "undefined" && window.addEventListener) window.addEventListener("org-change", () => { try { SUITE.db.switched(); if (typeof CLOUD !== "undefined") CLOUD._vers = null; } catch (e) { /* nothing open */ } });
// 4.31.10 · smooth scrolling: on a long page nearly all the work of a wheel tick is the hover state moving under a still pointer (a style
// recalc of the page and a repaint of the row and the frame on every tick). While a pane scrolls, a transparent veil (one element, no
// paint of its own) lies over the visible part of its content and takes the pointer, so nothing underneath changes state; it lifts
// 140 ms after the last tick. The wheel still reaches the pane through the veil; nested scrollers (a wide table, a map) and the
// Accounting pane (whose rows were cheap to hover already; the veil cost more there than it saved) are left alone.
if (typeof document !== "undefined" && document.addEventListener) { let scrT = null, scrEl = null, veil = null;
  // the veil stays in the pane (a page redraw that empties the pane drops it; the next tick puts it back) and only its pointer-events flip
  const lift = () => { if (veil) { veil.classList.remove("on"); veil.style.top = "0px"; veil.style.height = "0px"; veil._top = null; } if (scrEl) scrEl.classList.remove("is-scrolling"); scrEl = null; }; // 4.31.12 · lifted = no size, so it never holds the pane open
  const cover = (s) => { if (!veil || veil.parentNode !== s) { if (veil && veil.parentNode) veil.remove(); veil = s.querySelector(":scope > .sh-scrollveil") || document.createElement("div"); veil.className = "sh-scrollveil"; veil.setAttribute("aria-hidden", "true"); s.append(veil); veil._top = null; }
    const top = s.scrollTop; if (veil._top !== top) { veil._top = top; veil.style.top = top + "px"; veil.style.height = Math.max(0, Math.min(s.clientHeight, s.scrollHeight - top)) + "px"; } veil.classList.add("on"); }; // 4.31.12 · the veil covers exactly the visible part: an absolutely placed box that reached below the content was adding scroll room on every tick (the "endless scrolling" of 4.31.10)
  document.addEventListener("scroll", (e) => { const s = e.target; if (!s || s === document || !s.classList || !(s.classList.contains("sh-main") || s.classList.contains("sh-pane"))) return; if (scrEl !== s) { lift(); scrEl = s; s.classList.add("is-scrolling"); } cover(s); clearTimeout(scrT); scrT = setTimeout(lift, 140); }, { capture: true, passive: true }); }
