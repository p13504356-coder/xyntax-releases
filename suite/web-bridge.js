/* XYNTAX in the browser — the bridge (4.34). Loaded ONLY by the web build (web/build.js puts it in the head, before theme.js);
 * the desktop page (src/index.html) and the phone page (mobile/build.js) never name it, and without window.XYNTAX_WEB it does nothing.
 * The browser runs the same program as the desktop; this file is what preload.js + main.js are there — window.xyntax, member for
 * member (test/web-bridge.test.js holds the two lists together) — answered with what a browser can do:
 *   files       → a download, a file picker, the print window ("Save as PDF"); nothing is written to the computer silently
 *   the store   → the workspace; the browser keeps no data file (the apps' own device copies are the phone's, wiped at sign-out)
 *   the network → fetch, to this site and the one workspace only (the content-security policy says the same)
 *   updates, GPU, windows, mail programs, SMTP, e-invoicing keys → not in a browser; each answers in plain words
 * It also keeps the suite apart from the customer portal that shares this origin: every localStorage / sessionStorage key,
 * IndexedDB database, Cache and BroadcastChannel name of this page is prefixed (xyntax-suite/), so a portal customer's session
 * and a suite session never see each other and a sign-out in one leaves the other alone. web-shell.js (before app.js) carries
 * the rest: the session rules, history, the new-version prompt. */
(function () {
  "use strict";
  const CFG = window.XYNTAX_WEB; if (!CFG || window.XWEB) return;
  // ---------- 1 · never inside a frame. A <meta> policy cannot say frame-ancestors, so the page refuses by itself: loading stops,
  // nothing is drawn, no script after this one runs, and the top window is asked to show the real address.
  if (window.top !== window.self) { window.__XW_FRAMED = true; try { window.stop(); } catch (e) { /* older engines */ } try { document.documentElement.textContent = ""; } catch (e) { /* nothing drawn yet */ } try { window.top.location.href = window.self.location.href; } catch (e) { /* cross-origin without a gesture: stays blank */ } return; }
  try { window.opener = null; } catch (e) { /* no opener */ }

  // ---------- 2 · storage of this page only: one prefix for everything the suite keeps in the browser
  const NS = "xyntax-suite/";
  const SP = Storage.prototype; const raw = { get: SP.getItem, set: SP.setItem, del: SP.removeItem, key: SP.key, len: Object.getOwnPropertyDescriptor(SP, "length").get };
  const keysOf = (st) => { const out = []; const n = raw.len.call(st); for (let i = 0; i < n; i++) { const k = raw.key.call(st, i); if (k !== null && k.startsWith(NS)) out.push(k); } return out; };
  SP.getItem = function (k) { return raw.get.call(this, NS + k); };
  SP.setItem = function (k, v) { return raw.set.call(this, NS + k, v); };
  SP.removeItem = function (k) { return raw.del.call(this, NS + k); };
  SP.key = function (i) { const k = keysOf(this)[i]; return k === undefined ? null : k.slice(NS.length); };
  SP.clear = function () { for (const k of keysOf(this)) raw.del.call(this, k); };
  Object.defineProperty(SP, "length", { configurable: true, enumerable: true, get() { return keysOf(this).length; } });
  const idb = { open: null, del: null, list: null };
  if (window.IDBFactory) { const IP = IDBFactory.prototype; idb.open = IP.open; idb.del = IP.deleteDatabase; idb.list = IP.databases || null;
    IP.open = function (name, ver) { return ver === undefined ? idb.open.call(this, NS + name) : idb.open.call(this, NS + name, ver); };
    IP.deleteDatabase = function (name) { return idb.del.call(this, NS + name); };
    if (idb.list) IP.databases = function () { return idb.list.call(this).then((xs) => xs.filter((x) => x.name && x.name.startsWith(NS)).map((x) => ({ name: x.name.slice(NS.length), version: x.version }))); }; }
  if (window.CacheStorage) { const CP = CacheStorage.prototype; for (const m of ["open", "has", "delete"]) { const f = CP[m]; CP[m] = function (name) { return f.call(this, NS + name); }; } const ks = CP.keys; CP.keys = function () { return ks.call(this).then((xs) => xs.filter((x) => x.startsWith(NS)).map((x) => x.slice(NS.length))); }; }
  const BC = window.BroadcastChannel || null; if (BC) window.BroadcastChannel = class extends BC { constructor(name) { super(NS + name); } };
  // no service worker in this version (SECURITY.md): nothing of the suite is cached outside the browser's own HTTP cache, and a
  // registration attempt from any script on this page is refused
  if (navigator.serviceWorker && navigator.serviceWorker.register) { try { navigator.serviceWorker.register = () => Promise.reject(new Error("XYNTAX registers no service worker")); } catch (e) { /* read-only in this engine */ } }

  // ---------- 3 · the network: this site and the one workspace. Every call to the workspace says which client it is
  // (X-Client-Info: XYNTAX/x.y.z web — a browser cannot set User-Agent; sql/4340-web-client.sql reads this header for the same guards)
  const WS = CFG.workspace; const CLIENT = "XYNTAX/" + CFG.version + " web";
  const ALLOWED = new Set([WS, "https://marine-api.open-meteo.com", "https://api.open-meteo.com", "https://geocoding-api.open-meteo.com"]); if (CFG.bridge) ALLOWED.add(CFG.bridge);
  const here = location.origin; const home = () => here + CFG.base;
  const nativeFetch = window.fetch.bind(window); const net = { last: Date.now(), count: 0, writes: 0, serverAt: 0, serverSeen: 0 };
  window.fetch = function (input, init) {
    let url; try { url = new URL(typeof input === "string" ? input : input && input.url ? input.url : String(input), location.href); } catch (e) { return Promise.reject(new TypeError("Not an address")); }
    if (url.protocol === "blob:" || url.protocol === "data:") return nativeFetch(input, init);
    if (url.origin !== here && !ALLOWED.has(url.origin)) return Promise.reject(new TypeError("Refused: " + url.host + " is not a host XYNTAX talks to from a browser"));
    if (url.origin !== WS) return nativeFetch(input, init);
    net.count++; const o = { ...(init || {}) }; const hs = new Headers(o.headers || (typeof input !== "string" && input && input.headers) || undefined); hs.set("X-Client-Info", CLIENT); o.headers = hs; o.credentials = "omit"; o.referrerPolicy = "no-referrer";
    // emails the workspace sends for this sign-in (password reset, confirmation, invitation, magic link) lead back to this address
    if (/^\/auth\/v1\/(recover|signup|otp|magiclink|invite|resend)$/.test(url.pathname) && !url.searchParams.has("redirect_to")) url.searchParams.set("redirect_to", home());
    // a write on its way counts as "not yet sent" until the workspace has answered (web-shell.js: nothing is cleared before that)
    // (rows written to a table, a save / send / delete function, a file being stored — not the reads and polls that also travel as POST)
    const write = !/^(GET|HEAD|OPTIONS)$/i.test(String(o.method || (typeof input !== "string" && input && input.method) || "GET")) && (/^\/rest\/v1\/(?!rpc\/)[a-z_0-9]+$/.test(url.pathname) || /^\/rest\/v1\/rpc\/[a-z_0-9]*(save|set|put|add|create|delete|remove|update|decide|send|post|purge|reverse|revoke|regenerate|ask|dismiss|erase|accept|move|restore)[a-z_0-9]*$/.test(url.pathname) || (/^\/storage\/v1\/object\//.test(url.pathname) && !/^\/storage\/v1\/object\/(sign|list|info|authenticated|public)\//.test(url.pathname)));
    if (write) net.writes++;
    const p = nativeFetch(typeof input === "string" || !(input instanceof Request) ? url.toString() : new Request(url.toString(), input), o);
    p.then((r) => { try { const d = r.headers.get("date"); const t = d ? Date.parse(d) : NaN; if (t > 0) { net.serverAt = t; net.serverSeen = performance.now(); } } catch (e) { /* no Date header exposed */ } }, () => {}).then(() => { if (write) net.writes = Math.max(0, net.writes - 1); });
    return p;
  };
  // links leave without a handle on this window and without a referrer
  const nativeOpen = window.open.bind(window);
  window.open = function (url, target, features) { const u = String(url == null ? "" : url); if (!u || u === "about:blank") return nativeOpen(url, target, features); let p; try { p = new URL(u, location.href); } catch (e) { return null; } if (!/^(https?|mailto|tel|blob):$/.test(p.protocol)) return null; if (p.protocol === "mailto:" || p.protocol === "tel:") { leave(p.href); return null; } nativeOpen(p.href, "_blank", "noopener,noreferrer"); return null; };
  function leave(href) { const a = document.createElement("a"); a.href = href; a.rel = "noopener noreferrer"; a.style.display = "none"; document.body.append(a); a.click(); a.remove(); }

  // ---------- 4 · files
  const say = (m) => { try { if (typeof SUITE !== "undefined" && SUITE.toast) return SUITE.toast(m); if (typeof toast === "function") return toast(m); } catch (e) { /* no toast yet */ } };
  const safeName = (n) => { let x = String(n == null ? "" : n).split(/[\\/]/).pop().replace(/[\u0000-\u001f\u007f​-‏‪-‮⁦-⁩﻿]/g, "").replace(/[\\/:*?"<>|]+/g, "_").replace(/^[. ]+/, "").replace(/[. ]+$/, "").slice(0, 180); return x || "file"; };
  const u8 = (b) => (b instanceof Uint8Array ? b : b instanceof ArrayBuffer ? new Uint8Array(b) : ArrayBuffer.isView(b) ? new Uint8Array(b.buffer, b.byteOffset, b.byteLength) : new Uint8Array(b || []));
  const MIME = { pdf: "application/pdf", json: "application/json", csv: "text/csv", txt: "text/plain", html: "text/html", xml: "application/xml", zip: "application/zip", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", svg: "image/svg+xml", ics: "text/calendar", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" };
  const extOf = (name) => { const t = String(name == null ? "" : name).replace(/[\u0000-\u001f\u007f​-‏‪-‮⁦-⁩﻿]/g, "").replace(/:.*$/, "").replace(/[. ]+$/, "").split(/[\\/]/).pop(); const i = t.lastIndexOf("."); return i < 0 ? "" : t.slice(i + 1).trim().toLowerCase(); };
  const mimeOf = (name) => MIME[extOf(name)] || "application/octet-stream";
  const BLOCKED = new Set(CFG.blockedExt || []); const blocked = (name) => BLOCKED.has(extOf(name));
  // a download: the browser's own, into the folder the person chose for downloads. Types a browser would run or render from this
  // origin are always sent as a file (the download attribute plus an octet-stream body), never opened in a tab.
  function download(name, data, mime) { const nm = safeName(name); const blob = data instanceof Blob ? data : new Blob([data], { type: mime || mimeOf(nm) }); const safe = /^(text\/html|image\/svg\+xml|application\/xhtml\+xml|text\/xml|application\/xml)/i.test(blob.type) ? new Blob([blob], { type: "application/octet-stream" }) : blob; const u = URL.createObjectURL(safe); const a = document.createElement("a"); a.href = u; a.download = nm; a.rel = "noopener"; a.style.display = "none"; document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(u); a.remove(); }, 10000); X.downloads.push({ name: nm, size: blob.size, type: blob.type, at: Date.now() }); if (X.downloads.length > 50) X.downloads.shift(); return "your downloads folder (" + nm + ")"; }
  // a file picker: resolves with the chosen files, or [] when the window is closed without one
  function pick(opt) { opt = opt || {}; return new Promise((res) => { const inp = document.createElement("input"); inp.type = "file"; if (opt.accept) inp.accept = opt.accept; if (opt.multiple) inp.multiple = true; inp.style.display = "none"; inp.dataset.xw = "pick"; let done = false; const end = (files) => { if (done) return; done = true; inp.remove(); res(files); }; inp.addEventListener("change", () => end([...(inp.files || [])])); inp.addEventListener("cancel", () => end([]));
    // browsers without the cancel event (Safari before 16.4, Firefox before 91): the window gets the focus back when the picker closes;
    // a moment later (the change event, if a file was chosen, has fired by then) the promise is settled empty instead of never
    const back = () => { window.removeEventListener("focus", back); setTimeout(() => { if (!done && !(inp.files && inp.files.length)) end([]); }, 1200); }; setTimeout(() => window.addEventListener("focus", back), 300);
    document.body.append(inp); X.picking = inp; inp.click(); }); }
  async function pickJson(what) { const fs = await pick({ accept: ".json,application/json" }); if (!fs.length) return null; if (fs[0].size > 256 * 1048576) throw new Error("That file is too large to be " + what); try { return JSON.parse(await fs[0].text()); } catch (e) { throw new Error("That file is not " + what); } }
  // a ZIP without a library: stored entries (no compression), CRC-32, UTF-8 names — enough for "everything about this trade"
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return (b) => { let c = ~0; for (let i = 0; i < b.length; i++) c = t[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (~c) >>> 0; }; })();
  function zip(entries) { const enc = new TextEncoder(); const parts = [], cds = []; let at = 0; const d = new Date(); const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    for (const e of entries) { const nm = enc.encode(e.name); const data = u8(e.bytes); const crc = CRC(data); const lh = new DataView(new ArrayBuffer(30)); lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true); lh.setUint16(10, time, true); lh.setUint16(12, date, true); lh.setUint32(14, crc, true); lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true); lh.setUint16(26, nm.length, true);
      const cd = new DataView(new ArrayBuffer(46)); cd.setUint32(0, 0x02014b50, true); cd.setUint16(4, 20, true); cd.setUint16(6, 20, true); cd.setUint16(8, 0x0800, true); cd.setUint16(10, 0, true); cd.setUint16(12, time, true); cd.setUint16(14, date, true); cd.setUint32(16, crc, true); cd.setUint32(20, data.length, true); cd.setUint32(24, data.length, true); cd.setUint16(28, nm.length, true); cd.setUint32(42, at, true);
      parts.push(new Uint8Array(lh.buffer), nm, data); cds.push(new Uint8Array(cd.buffer), nm); at += 30 + nm.length + data.length; }
    const cdLen = cds.reduce((n, x) => n + x.length, 0); const end = new DataView(new ArrayBuffer(22)); end.setUint32(0, 0x06054b50, true); end.setUint16(8, entries.length, true); end.setUint16(10, entries.length, true); end.setUint32(12, cdLen, true); end.setUint32(16, at, true);
    return new Blob([...parts, ...cds, new Uint8Array(end.buffer)], { type: "application/zip" }); }

  // ---------- 5 · documents on paper: the same HTML documents the desktop prints, in a frame that cannot run script, and the
  // browser's print window (which also saves a PDF). The frame is not visible; it is removed after printing.
  const PAGE = (o) => "<style>@page { size: A4 " + (o && o.landscape ? "landscape" : "portrait") + "; margin: 0.4in; } html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }</style>";
  const withPage = (html, o) => { const s = String(html == null ? "" : html); if (/@page\s*{/.test(s)) return s; return /<\/head>/i.test(s) ? s.replace(/<\/head>/i, PAGE(o) + "</head>") : PAGE(o) + s; };
  const frameOf = (html, cls) => { const f = document.createElement("iframe"); f.className = cls; f.setAttribute("sandbox", "allow-same-origin allow-modals"); f.setAttribute("referrerpolicy", "no-referrer"); f.title = "Document"; f.srcdoc = html; return f; };
  function print(html, opt) {
    opt = opt || {}; return new Promise((res) => {
      for (const old of document.querySelectorAll("iframe.xw-print")) old.remove();
      const f = frameOf(withPage(html, opt), "xw-print"); f.setAttribute("aria-hidden", "true"); f.dataset.name = opt.name || ""; f.dataset.landscape = opt.landscape ? "1" : "";
      let fired = false; const go = () => { if (fired) return; fired = true; let w = null; try { w = f.contentWindow; if (opt.name && f.contentDocument) f.contentDocument.title = String(opt.name).replace(/\.pdf$/i, ""); } catch (e) { w = null; }
        const done = () => { setTimeout(() => f.remove(), 1500); res(true); };
        try { if (!w) throw new Error("no frame"); X.printed.push({ name: opt.name || "", landscape: !!opt.landscape, bytes: String(html || "").length, at: Date.now() }); if (X.printed.length > 20) X.printed.shift(); if (X.printer) { X.printer(w, f, opt); done(); return; } w.addEventListener("afterprint", done, { once: true }); setTimeout(done, 120000); w.focus(); w.print(); }
        catch (e) { f.remove(); say("The print window could not be opened: " + e.message); res(false); } };
      f.addEventListener("load", () => setTimeout(go, 120)); setTimeout(go, 4000); document.body.append(f);
    });
  }
  // the desktop's preview window, as a layer of this page: the document, Print / Save as PDF, Close (Esc)
  function preview(html, opt) {
    opt = opt || {}; const old = document.getElementById("xwprev"); if (old) old.remove();
    const el = (t, c, txt) => { const x = document.createElement(t); if (c) x.className = c; if (txt) x.textContent = txt; return x; };
    const box = el("div"); box.id = "xwprev"; box.setAttribute("role", "dialog"); box.setAttribute("aria-modal", "true"); box.setAttribute("aria-label", "Document preview");
    const bar = el("div", "xw-prevbar"); const title = el("span", "xw-prevtitle", opt.name || "Document preview"); const pr = el("button", "primary", "Print or save as PDF"); const cl = el("button", "quiet", "Close");
    const f = frameOf(withPage(html, opt), "xw-prevframe"); const close = () => { document.removeEventListener("keydown", onKey, true); box.remove(); };
    const onKey = (e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); } };
    pr.onclick = () => print(html, opt); cl.onclick = close; box._close = close; document.addEventListener("keydown", onKey, true);
    bar.append(title, pr, cl); box.append(bar, f); document.body.append(box); setTimeout(() => { try { pr.focus(); } catch (e) { /* no focus */ } }, 50); return true;
  }

  // ---------- 6 · DOCUMENTS: "open in the app that owns it". A browser cannot start Word or Excel, so the file is saved to the
  // computer and its changes come back one of two ways: where the browser can keep a handle on the saved file (File System Access:
  // Chrome, Edge) every save in Word or Excel is read back while this tab is open, exactly like the desktop; elsewhere the file is
  // downloaded and "Upload edited copy…" takes the edited file back. web-shell.js draws the small tray that lists them.
  const edits = new Map(); let changed = null; const tell = (why) => { try { window.dispatchEvent(new CustomEvent("xw-edits", { detail: why || "" })); } catch (e) { /* no DOM */ } };
  // one more look at every watched file, now (before a sign-out: a save made a second ago is read and sent like any other)
  const checkEdits = () => Promise.all([...edits.values()].filter((e) => e.mode === "handle" && e.handle && !e.error).map((e) => watch(e).catch(() => {})));
  const canHandle = () => typeof window.showSaveFilePicker === "function";
  async function watch(e) { if (!e.handle || e.busy) return; e.busy = true; try { const file = await e.handle.getFile(); if (file.lastModified !== e.stamp && file.size > 0) { e.stamp = file.lastModified; const bytes = new Uint8Array(await file.arrayBuffer()); e.saves++; e.at = Date.now(); if (changed) changed({ id: e.id, name: e.name, bytes }); tell("save"); } } catch (x) { e.error = "The file can no longer be read (moved, renamed or permission withdrawn)"; clearInterval(e.timer); e.timer = null; tell(); } finally { e.busy = false; } }
  async function openForEdit(id, name, bytes) {
    id = String(id); const nm = safeName(name); if (blocked(nm)) return { error: "." + extOf(nm) + " files are programs or scripts; XYNTAX does not open them. Save it to a folder instead.", blocked: true };
    const data = u8(bytes); const prev = edits.get(id); if (prev && prev.timer) clearInterval(prev.timer);
    if (id.startsWith("tmp-")) { download(nm, data); return { ok: true, path: nm, mode: "copy" }; } // a read-only copy: nothing comes back
    if (canHandle()) {
      try { const ext = extOf(nm); const handle = await window.showSaveFilePicker({ suggestedName: nm, types: ext ? [{ description: ext.toUpperCase() + " file", accept: { [mimeOf(nm)]: ["." + ext] } }] : undefined });
        const w = await handle.createWritable(); await w.write(data); await w.close(); const stamp = (await handle.getFile()).lastModified;
        const e = { id, name: nm, mode: "handle", handle, stamp, saves: 0, at: Date.now(), error: "", busy: false, timer: null }; e.timer = setInterval(() => watch(e), 2000); edits.set(id, e); tell(); return { ok: true, path: handle.name, mode: "handle" }; }
      catch (x) { if (x && x.name === "AbortError") return { error: "Not saved — no place was chosen", cancelled: true }; /* refused (a gesture too old, a policy): the download way */ }
    }
    download(nm, data); edits.set(id, { id, name: nm, mode: "upload", saves: 0, at: Date.now(), error: "" }); tell(); return { ok: true, path: nm, mode: "upload" };
  }
  async function uploadEdited(id) { const e = edits.get(String(id)); if (!e) return false; const fs = await pick({}); if (!fs.length) return false; const f = fs[0]; if (extOf(f.name) !== extOf(e.name)) { say("That is a ." + (extOf(f.name) || "?") + " file; " + e.name + " needs a ." + extOf(e.name) + " file"); return false; } const bytes = new Uint8Array(await f.arrayBuffer()); if (!bytes.length) { say("That file is empty"); return false; } e.saves++; e.at = Date.now(); if (changed) changed({ id: e.id, name: e.name, bytes }); tell("save"); return true; }
  function stopEdit(id) { const e = edits.get(String(id)); if (!e) return; if (e.timer) clearInterval(e.timer); edits.delete(String(id)); tell(); }

  // ---------- 7 · the version this page runs, and the one that is published (web-shell.js polls version.json)
  const upd = { state: { version: "", percent: 0, downloaded: "", error: "", manual: "", installing: false, mode: "", reason: "", stage: "", current: CFG.version, platform: "web", arch: "", releases: CFG.releases, enabled: true, build: CFG.build }, onState: [], onDownloaded: [], onAvailable: [] };
  async function published() { const r = await nativeFetch(new URL("version.json?t=" + Date.now(), home()).toString(), { cache: "no-store", credentials: "omit" }); if (!r.ok) throw new Error("HTTP " + r.status); const j = await r.json(); if (!j || typeof j.build !== "string" || typeof j.version !== "string") throw new Error("version.json is not readable"); return j; }
  function reloadFresh() { const u = new URL(home()); u.searchParams.set("v", String(Date.now())); u.hash = location.hash; location.replace(u.toString()); }
  const NOT = { smtp: "Sending from XYNTAX (SMTP) needs the desktop app: a browser cannot reach a mail server, and the mail password is not kept in a browser.", einv: "E-invoicing is set up and submitted from the desktop app: the provider's key stays on that computer, never in a browser.", fx: "Exchange rates are fetched by the desktop and phone apps; the browser uses the table they saved in the book.", feed: "Linked calendar feeds are read by the desktop and phone apps: a browser may not fetch another site's calendar address.", local: "This attachment lives on the computer that added it and is not available in the browser." };

  // ---------- 8 · window.xyntax — the desktop bridge's 53 members, in preload.js's order
  const bridge = {
    version: async () => CFG.version,
    gpuStatus: async () => ({ mode: "browser", forced: false, since: null, reason: null, retried: null, failures: 0, feature: null, adapter: null, line: "the browser decides (no desktop app)" }),
    gpuRetry: async () => false,
    updateFromFile: async () => ({ started: false }),
    updateCheck: async () => { try { const p = await published(); if (p.build !== CFG.build) { upd.state.version = p.version; upd.state.downloaded = p.version; upd.state.percent = 100; for (const cb of upd.onState) cb({ ...upd.state }); try { window.dispatchEvent(new CustomEvent("xw-version", { detail: p })); } catch (e) { /* no DOM */ } return { available: true, version: p.version }; } return { available: false, version: CFG.version }; } catch (e) { return { available: false, reason: String(e.message || e) }; } },
    updateInstall: async () => { setTimeout(reloadFresh, 50); return { ok: true }; },
    updatePrepare: async () => ({ ok: true, mode: "" }),
    onUpdateAvailable: (cb) => { if (typeof cb === "function") upd.onAvailable.push(cb); },
    updateState: async () => ({ ...upd.state }),
    onUpdateState: (cb) => { if (typeof cb === "function") upd.onState.push(cb); },
    onUpdateDownloaded: (cb) => { if (typeof cb === "function") upd.onDownloaded.push(cb); },
    onAuthCallback: () => { /* a browser sign-in returns in the address of this page (CLOUD.takeAuthHash), not through a protocol link */ },
    load: async () => null,
    save: async () => ({ ok: true, path: "", size: 0 }),
    saveSync: () => ({ ok: true, path: "", size: 0 }),
    backup: async () => null,
    dataPath: async () => "the company workspace (a browser keeps no data file)",
    openFolder: async () => "",
    importFile: async () => { try { return await pickJson("a XYNTAX export"); } catch (e) { say(e.message); return null; } },
    saveFile: async (name, content) => download(name, new Blob([String(content == null ? "" : content)], { type: mimeOf(name) + ";charset=utf-8" })),
    saveBytes: async (name, bytes) => download(name, u8(bytes)),
    bundleZip: async (name, files) => { try { const used = new Set(); const entries = []; for (const f of files || []) { let fname = safeName(f.html ? String(f.name).replace(/\.pdf$/i, ".html") : f.name); let i = 1; const dot = fname.lastIndexOf("."); const stem = dot > 0 ? fname.slice(0, dot) : fname, ext = dot > 0 ? fname.slice(dot) : ""; const folder = f.folder ? safeName(f.folder) + "/" : ""; while (used.has(folder + fname)) fname = stem + " (" + (i++) + ")" + ext; used.add(folder + fname); entries.push({ name: folder + fname, bytes: f.html ? new TextEncoder().encode(withPage(f.html, {})) : u8(f.bytes) }); } const nm = safeName(name || "bundle.zip"); download(nm, zip(entries)); return { ok: true, path: nm, count: entries.length, note: "Generated documents are in the ZIP as HTML pages (open one and print it to make a PDF); the desktop app writes them as PDF." }; } catch (e) { return { ok: false, error: String(e.message || e) }; } },
    fxFetch: async () => ({ ok: false, error: NOT.fx }),
    newWindow: async () => { nativeOpen(home() + location.hash, "_blank", "noopener"); return true; },
    protectWindow: async () => false,
    backupExportDir: async (store) => { const text = JSON.stringify(store); if (typeof window.showDirectoryPicker === "function") { try { const dir = await window.showDirectoryPicker({ mode: "readwrite" }); const sub = await dir.getDirectoryHandle("XYNTAX backup " + new Date().toISOString().slice(0, 10), { create: true }); const fh = await sub.getFileHandle("xyntax.json", { create: true }); const w = await fh.createWritable(); await w.write(text); await w.close(); return dir.name + "/" + sub.name + " (the book; attachments stay in the workspace)"; } catch (e) { if (e && e.name === "AbortError") return null; } } return download("xyntax.json", new Blob([text], { type: "application/json" })) + " — the book; attachments stay in the workspace"; },
    backupImportDir: async () => { try { const d = await pickJson("a XYNTAX book (xyntax.json)"); if (!d) return null; if (!d.entities) return { error: "That file is not a XYNTAX book (choose xyntax.json from the backup folder)" }; return { store: d }; } catch (e) { return { error: e.message }; } },
    attachAdd: async () => { say("Attachments are kept in the workspace: add them from the trade, invoice or bill"); return []; },
    attachOpen: async () => { say(NOT.local); return ""; },
    attachRead: async () => { say(NOT.local); return null; },
    mailCompose: async (name, bytes, html, subject, body) => { const nm = safeName(name || "attachment"); if (html) await print(html, { name: nm }); else if (bytes) download(nm, u8(bytes)); const subj = subject || nm.replace(/\.[^.]+$/, ""); leave("mailto:?subject=" + encodeURIComponent(subj) + "&body=" + encodeURIComponent((body || "") + "\n\n(Attach " + nm + (html ? " — save it as a PDF from the print window" : " from your downloads folder") + ".)")); return { ok: true, via: "mailto", note: html ? "A message was opened in your mail program; save the document as a PDF from the print window and attach it." : "A message was opened in your mail program; attach " + nm + " from your downloads folder." }; },
    mailApps: async () => [{ id: "mailto", name: "Default mail app (message only; the file is downloaded beside it)" }],
    mailGetSettings: async () => ({}),
    einvoiceGetSettings: async () => ({ apiKey: "", enabled: false }),
    einvoiceSetSettings: async () => { say(NOT.einv); return false; },
    einvoiceSubmit: async () => ({ ok: false, error: NOT.einv }),
    mailSetSettings: async () => { say(NOT.smtp); return false; },
    mailSend: async () => ({ ok: false, error: NOT.smtp }),
    attachReveal: async () => { say(NOT.local); return false; },
    attachPreview: async () => { say(NOT.local); return false; },
    attachSaveAs: async () => { say(NOT.local); return null; },
    attachRemove: async () => true,
    savePDF: async (name, html, opt) => { say("Choose “Save as PDF” in the print window to keep " + safeName(name || "the document")); await print(html, { name, landscape: !!(opt && opt.landscape) }); return null; },
    pdfBytes: async () => null,
    preview: async (html) => preview(html, {}),
    openExternal: async (url) => { const s = String(url == null ? "" : url); if (!/^(https?|mailto):/i.test(s)) return false; let p; try { p = new URL(s); } catch (e) { return false; } if (p.protocol === "mailto:") { leave(p.href); return true; } if (p.origin === WS && p.pathname.startsWith("/auth/v1/")) { location.assign(p.href); return true; } /* single sign-on continues in this tab */ nativeOpen(p.href, "_blank", "noopener,noreferrer"); return true; },
    fetchText: async () => ({ ok: false, error: NOT.feed }),
    fetchRaw: async (url, init) => { try { init = init || {}; const r = await window.fetch(String(url), { method: init.method || "GET", headers: init.headers || {}, body: init.body == null ? undefined : init.body, cache: "no-store" }); const hs = []; r.headers.forEach((v, k) => hs.push([k, v])); return { status: r.status, headers: hs, body: new Uint8Array(await r.arrayBuffer()) }; } catch (e) { return { error: String((e && e.message) || e) }; } },
    allowHost: async () => 0,
    vaultOpen: (id, name, bytes) => openForEdit(id, name, bytes),
    onVaultChanged: (cb) => { changed = typeof cb === "function" ? cb : null; },
    dragOut: async () => ({ error: "Dragging a document out of the window needs the desktop app — use Download" }),
    dragIdFor: () => null,
  };
  Object.defineProperty(window, "xyntax", { value: Object.freeze(bridge), writable: false, configurable: false, enumerable: true });

  // ---------- 9 · what web-shell.js builds on (not part of the desktop bridge)
  const X = {
    ns: NS, cfg: CFG, client: CLIENT, net, downloads: [], printed: [], printer: null, picking: null, edits, upd,
    home, download, pick, print, preview, zip, safeName, blocked, extOf, canHandle, openForEdit, uploadEdited, stopEdit, checkEdits, published, reloadFresh, say, leave,
    // everything of the suite in this browser profile, by its real (prefixed) name
    rawKeys(kind) { return keysOf(kind === "session" ? window.sessionStorage : window.localStorage); },
    rawGet(k) { return raw.get.call(window.localStorage, k); },
    parkedValue(v) { return typeof v === "string" && v.charAt(0) === "{" && v.endsWith(',"__u":1}'); },
    // sign-out: every key and database of the suite goes, except what the device itself may keep (the theme, the density, the
    // sign-in throttle) and — unless the build says otherwise — the messaging keys of this browser, which a person cannot get back
    KEEP: /^(xyntax\.theme(\.density)?|xw\.throttle|xw\.device\.[0-9a-f-]{36})$/, DEVICE: /^xw\.device\.[0-9a-f-]{36}$/, // 4.34.5 · xw.device.<user id>: the token of a remembered browser — it outlives a sign-out (that is its purpose); "Forget this browser" removes it
    async wipe(opt) {
      opt = opt || {}; let n = 0;
      // a device copy still marked unsent (SUITE.db: a change the workspace never confirmed) is not cleared by a wipe unless the person
      // chose to discard it: the tab that signs out sends its own first, so what is left with the mark belongs to somebody who is
      // not signed in here now — it waits, under that person's key, for their next sign-in in this browser
      for (const st of [window.localStorage, window.sessionStorage]) for (const k of keysOf(st)) { if (st === window.localStorage && X.KEEP.test(k.slice(NS.length)) && !((opt.keys || CFG.forgetKeysOnSignOut) && X.DEVICE.test(k.slice(NS.length)))) continue; if (st === window.localStorage && !opt.unsentToo && X.parkedValue(raw.get.call(st, k))) continue; raw.del.call(st, k); n++; }
      const names = new Set(["xyntax-cache", "xyntax-suite", "xyntax-keys"]);
      if (idb.list) { try { for (const d of await idb.list.call(indexedDB)) if (d.name && d.name.startsWith(NS)) names.add(d.name.slice(NS.length)); } catch (e) { /* the list is optional */ } }
      if (!(opt.keys || CFG.forgetKeysOnSignOut)) names.delete("xyntax-keys");
      await Promise.all([...names].map((nm) => new Promise((res) => { try { const r = idb.del.call(indexedDB, NS + nm); r.onsuccess = r.onerror = r.onblocked = () => res(); setTimeout(res, 1500); } catch (e) { res(); } })));
      if (window.caches && caches.keys) { try { for (const k of await caches.keys()) await caches.delete(k); } catch (e) { /* no cache storage */ } }
      for (const e of edits.values()) if (e.timer) clearInterval(e.timer); edits.clear();
      return n;
    },
  };
  window.XWEB = X;
})();
