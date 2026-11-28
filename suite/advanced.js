/* XYNTAX · ADVANCED (4.7) — what the Suite takes over from the Bulwark System:
 *   · a command palette (Ctrl/⌘ K, and "Go to…" under More on the phone): every app, page and action by name
 *   · sealed bundles: a company's books, shared notebook, calendar, contacts and document index exported as one file encrypted under
 *     a passphrase (PBKDF2-SHA-256 310 000 rounds, AES-256-GCM) with a SHA-256 manifest and the audit head hash, for air-gapped transfer;
 *     an administrator imports it on another workspace
 *   · more windows on the desktop (Ctrl/⌘ Shift N): the same account in several windows, each on its own app
 * Nothing here touches the encryption of personal records; it adds controls around it. */
(() => {
  const H = (...a) => SUITE.H(...a);
  const cloud = () => typeof CLOUD !== "undefined" && CLOUD.signedIn && CLOUD.signedIn();
  const company = () => typeof CLOUD !== "undefined" && CLOUD.active && CLOUD.active();
  const isAdmin = () => company() && CLOUD.state && CLOUD.state.role === "admin";
  const enc = new TextEncoder(), dec = new TextDecoder();
  const b64 = (u8) => { u8 = new Uint8Array(u8); let b = ""; for (let i = 0; i < u8.length; i += 0x8000) b += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(b); }, unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  const sha256hex = async (bytes) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))).map((b) => b.toString(16).padStart(2, "0")).join("");

  // ---------- the command palette
  const PAL = { open: false, el: null, items: [], sel: 0 };
  function commands() {
    const out = [];
    for (const a of SUITE.APPS || []) if (typeof CLOUD === "undefined" || !CLOUD.hasApp || CLOUD.hasApp(a.id)) out.push({ l: a.name, s: a.desc || "", k: "app", fn: () => SUITE.open(a.id) });
    out.push({ l: "Home", s: "all the apps", k: "go", fn: () => SUITE.showHome() });
    out.push({ l: "Search everything", s: "notes, events, files, mail, conversations, contacts", k: "go", fn: () => SUITE.globalSearch && SUITE.globalSearch() });
    out.push({ l: "New…", s: "a note, an event, a file, a message, a contact", k: "go", fn: () => SUITE.newMenu && SUITE.newMenu() });
    out.push({ l: "Lock now", s: "the lock screen, at once", k: "act", fn: () => SUITE.lockNow && SUITE.lockNow() });
    if (typeof THEME !== "undefined") out.push({ l: THEME.isLight() ? "Switch to dark" : "Switch to light", s: "the theme on this device · System follows the phone or computer", k: "act", fn: () => { THEME.toggle(); SUITE.toast(THEME.isLight() ? "Light" : "Dark"); } });
    if (typeof THEME !== "undefined" && THEME.mode() !== "system") out.push({ l: "Theme: follow the system", s: "light by day, dark by night — whatever this computer or phone is set to", k: "act", fn: () => { THEME.set("system"); SUITE.toast("Following the system: " + (THEME.isLight() ? "light" : "dark") + " now"); } });
    if (typeof THEME !== "undefined" && THEME.setDensity) { const compact = THEME.density() === "compact"; out.push({ l: compact ? "Density: comfortable" : "Density: compact", s: compact ? "roomier rows and tables" : "tighter rows and tables — more on the screen", k: "act", fn: () => { THEME.setDensity(compact ? "comfortable" : "compact"); SUITE.toast(compact ? "Comfortable" : "Compact"); } }); }
    if (SUITE.shortcuts) out.push({ l: "Keyboard shortcuts", s: "every key in one list · press ? anywhere", k: "go", fn: () => SUITE.shortcuts() });
    if (SUITE.recent && SUITE.recent.list().length) out.push({ l: "Clear recent items", s: "the list the palette shows first", k: "act", fn: () => { SUITE.recent.clear(); SUITE.toast("Cleared"); } });
    if (cloud() && typeof CLOUD.account === "function") out.push({ l: "Lock my account everywhere", s: "every device of this account goes into lockdown until the encryption passphrase is given", k: "act", danger: 1, fn: async () => { if (await SUITE.confirm({ title: "Lock your account on every device?", text: "Every session of this account stops reading and writing until the account is unlocked with your encryption passphrase. Use it if a device is lost or you suspect someone is inside." }, "Lock everywhere", true)) { try { await CLOUD.account("lock_me", {}); location.reload(); } catch (e) { SUITE.toast(e.message); } } } });
    for (const p of [["profile", "Profile"], ["appearance", "Appearance"], ["security", "Security and privacy"], ["sharing", "Shared by me"], ["data", "Your data"], ["mycompanies", "Companies"], ["connections", "Connections"], ["update", "Software update"]]) out.push({ l: "Settings · " + p[1], s: "", k: "page", fn: () => openSettings(p[0]) });
    for (const x of window.SETTINGS_EXTRA || []) if (!x.when || x.when()) out.push({ l: "Settings · " + x.label, s: "", k: "page", fn: () => openSettings(x.id) });
    if (isAdmin()) out.push({ l: "Settings · Users and roles", s: "", k: "page", fn: () => openSettings("users") });
    if (typeof CLOUD !== "undefined" && CLOUD.state && CLOUD.state.isOwner) out.push({ l: "Settings · All companies", s: "", k: "page", fn: () => openSettings("companies") });
    if (SUITE.host && SUITE.host.newWindow) out.push({ l: "New window", s: "another window of XYNTAX, same account", k: "act", fn: () => SUITE.host.newWindow() });
    if (SUITE.host && SUITE.host.protectWindow) { const on = localStorage.getItem("xyntax.protectWindow") === "1"; out.push({ l: on ? "Allow screen capture of XYNTAX" : "Hide XYNTAX from screen capture", s: on ? "the window appears again in screenshots and screen sharing" : "screenshots and screen sharing show a black window (Windows, macOS)", k: "act", fn: async () => { const v = await SUITE.host.protectWindow(!on); localStorage.setItem("xyntax.protectWindow", v ? "1" : "0"); SUITE.toast(v ? "Hidden from screen capture" : "Visible to screen capture"); } }); }
    if (company()) out.push({ l: "Sealed bundle…", s: "export or import this company for an air-gapped transfer", k: "act", fn: () => openSettings("bundles") });
    return out;
  }
  function openSettings(view) { try { sessionStorage.setItem("xyntax.settingsView", view); } catch (e) { /* ignore */ } SUITE.open("settings", { view }); }
  function openPalette() {
    if (PAL.open && PAL.el && PAL.el.isConnected) return closePalette(); /* 4.16: Esc elsewhere may have removed it — then open afresh */ PAL.open = true; PAL.items = commands(); PAL.sel = 0;
    const input = H("input", { type: "text", placeholder: "Search everything, or type an app, a page or an action…", autocomplete: "off", spellcheck: "false", "aria-label": "Command palette" });
    const list = H("div", { class: "sh-pal-list" });
    PAL.el = H("div", { class: "sh-pal-wrap", onclick: (e) => { if (e.target === PAL.el) closePalette(); } }, H("div", { class: "sh-pal" }, H("div", { class: "sh-pal-in" }, SUITE.glyph ? SUITE.glyph("search") : null, input, H("kbd", {}, "esc")), list));
    document.body.append(PAL.el);
    // 4.16 · one box for everything: commands match by name; two letters or more also ask every app's search(q) at once
    // (each answer waits at most 1.2 s, slow apps simply arrive later); nothing typed → recently opened things first
    PAL.found = []; PAL.seq = 0;
    const recentItems = () => (SUITE.recent ? SUITE.recent.list() : []).map((r) => ({ l: r.l, s: r.s, k: "recent", app: r.app, fn: () => reopen(r) }));
    const reopen = (r) => { const mod = SUITE.apps[r.app]; SUITE.open(r.app); if (!mod || !mod.search) return; setTimeout(async () => { try { const hits = (await mod.search(r.q)) || []; const h = hits.find((x) => x.l === r.l) || hits[0]; if (h && h.fn) h.fn(); } catch (e) { /* the app opens anyway */ } }, 450); };
    const render = () => { const q = input.value.trim().toLowerCase(); const cmds = PAL.items.filter((it) => !q || (it.l + " " + it.s).toLowerCase().includes(q)).slice(0, q ? 8 : 14); const hits = q ? cmds.concat(PAL.found) : recentItems().slice(0, 6).concat(cmds); PAL.hits = hits; if (PAL.sel >= hits.length) PAL.sel = 0; list.innerHTML = ""; if (!hits.length) list.append(H("div", { class: "sh-pal-none" }, PAL.searching ? "Searching…" : "Nothing matches.")); let lastK = null; hits.forEach((it, i) => { const grp = it.k === "recent" ? "Recent" : it.app && it.k !== "app" ? "In " + it.k : null; if (grp && grp !== lastK) list.append(H("div", { class: "sh-pal-h" }, grp)); lastK = grp; list.append(H("button", { class: "sh-pal-item" + (i === PAL.sel ? " on" : "") + (it.danger ? " danger" : ""), onmousemove: () => { if (PAL.sel !== i) { PAL.sel = i; render(); } }, onclick: () => run(it) }, H("span", { class: "sh-pal-k" }, grp ? "" : it.k), H("span", { class: "sh-pal-l" }, it.l), it.k === "recent" ? H("span", { class: "sh-pal-s" }, [((SUITE.app(it.app) || {}).name || it.app), it.s].filter(Boolean).join(" · ")) : it.s ? H("span", { class: "sh-pal-s" }, it.s) : null)); }); if (q && PAL.searching) list.append(H("div", { class: "sh-pal-none" }, "Searching the apps…")); };
    const run = (it) => { closePalette(); if (it.app && it.k !== "recent" && SUITE.recent) SUITE.recent.add({ l: it.l, s: it.s, app: it.app, q: PAL.q || it.l }); try { it.fn(); } catch (e) { SUITE.toast(e.message); } };
    const searchApps = async (q) => { const my = ++PAL.seq; PAL.found = []; PAL.q = q; if (q.length < 2) { PAL.searching = false; render(); return; } PAL.searching = true; render(); const jobs = (SUITE.APPS || []).filter((a) => SUITE.apps[a.id] && SUITE.apps[a.id].search && SUITE.allowed(a.id)).map(async (a) => { let hits = []; try { hits = (await Promise.race([SUITE.apps[a.id].search(q), new Promise((r) => setTimeout(() => r([]), 1200))])) || []; } catch (e) { hits = []; } if (my !== PAL.seq || !PAL.open) return; for (const h of hits.slice(0, 5)) PAL.found.push({ l: h.l, s: h.d || "", k: a.name, app: a.id, fn: h.fn }); render(); }); await Promise.all(jobs); if (my === PAL.seq) { PAL.searching = false; if (PAL.open) render(); } };
    let deb = null; input.addEventListener("input", () => { PAL.sel = 0; render(); clearTimeout(deb); const q = input.value.trim(); deb = setTimeout(() => searchApps(q), 160); });
    input.addEventListener("keydown", (e) => { if (e.key === "ArrowDown") { e.preventDefault(); PAL.sel = Math.min((PAL.hits || []).length - 1, PAL.sel + 1); render(); } else if (e.key === "ArrowUp") { e.preventDefault(); PAL.sel = Math.max(0, PAL.sel - 1); render(); } else if (e.key === "Enter") { e.preventDefault(); const it = (PAL.hits || [])[PAL.sel]; if (it) run(it); } else if (e.key === "Escape") { e.preventDefault(); closePalette(); } });
    render(); setTimeout(() => input.focus(), 30);
  }
  function closePalette() { PAL.open = false; PAL.seq++; if (PAL.el) PAL.el.remove(); PAL.el = null; }
  SUITE.palette2 = openPalette;
  document.addEventListener("keydown", (e) => { if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "k") { e.preventDefault(); openPalette(); } if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "n" && SUITE.host && SUITE.host.newWindow) { e.preventDefault(); SUITE.host.newWindow(); } });

  // ---------- sealed bundles (air-gapped transfer of a company)
  const SHARED_APPS = ["notes", "calendar", "contacts", "workflow"];
  async function deriveKey(pass, salt) { const base = await crypto.subtle.importKey("raw", enc.encode(pass.normalize("NFKC")), "PBKDF2", false, ["deriveKey"]); return crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt, iterations: 310000 }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]); }
  async function gather() {
    const s = CLOUD.session(); const org = s.org_id; const out = { kind: "xyntax-bundle", version: 1, created: new Date().toISOString(), org: { id: org, name: s.org_name || CLOUD.state.orgName || "" }, suite: SUITE._ver || "", book: null, shared: {}, documents: [], audit_head: null };
    try { const r = await CLOUD.req("/rest/v1/books?select=data,version&org_id=eq." + org); if (r.ok) { const rows = await r.json(); if (rows.length) out.book = { data: rows[0].data, version: rows[0].version }; } } catch (e) { /* no book */ }
    for (const app of SHARED_APPS) { try { const r = await CLOUD.sharedLoad(app); if (r && r.data) out.shared[app] = { data: r.data, version: r.version }; } catch (e) { /* none */ } }
    try { const r = await CLOUD.req("/rest/v1/vault_items?select=id,name,kind,size,scope,mime,parent_id,created_at&org_id=eq." + org + "&deleted_at=is.null"); if (r.ok) out.documents = await r.json(); } catch (e) { /* none */ }
    try { const r = await CLOUD.admin("audit_verify", {}); if (r && r.head) out.audit_head = r.head; } catch (e) { /* audit not deployed */ }
    return out;
  }
  async function exportBundle(pass) {
    const body = await gather(); const plain = enc.encode(JSON.stringify(body)); const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(pass, salt); const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plain));
    const manifest = { kind: "xyntax-sealed-bundle", version: 1, created: body.created, org: body.org.name, suite: body.suite, kdf: { name: "PBKDF2-SHA-256", iterations: 310000, salt: b64(salt) }, cipher: { name: "AES-256-GCM", iv: b64(iv) }, plain_sha256: await sha256hex(plain), bytes: plain.length, counts: { book: body.book ? 1 : 0, shared: Object.keys(body.shared).length, documents: body.documents.length }, audit_head: body.audit_head };
    const file = JSON.stringify({ manifest, data: b64(ct) });
    const name = "xyntax-" + (body.org.name || "company").replace(/[^a-z0-9]+/gi, "-").toLowerCase() + "-" + body.created.slice(0, 10) + ".xbundle";
    await SUITE.download(name, new Blob([file], { type: "application/json" }));
    if (typeof CLOUD.account === "function") CLOUD.account("audit", { kind: "export", ref: "bundle", detail: { what: "sealed bundle", bytes: file.length, org: body.org.id } }).catch(() => {});
    return manifest;
  }
  async function openBundle(text, pass) {
    let j; try { j = JSON.parse(text); } catch (e) { throw new Error("That is not a bundle file"); } if (!j.manifest || j.manifest.kind !== "xyntax-sealed-bundle") throw new Error("That is not a sealed bundle");
    const key = await deriveKey(pass, unb64(j.manifest.kdf.salt)); let plain; try { plain = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(j.manifest.cipher.iv) }, key, unb64(j.data))); } catch (e) { throw new Error("Wrong passphrase, or the bundle was altered"); }
    if ((await sha256hex(plain)) !== j.manifest.plain_sha256) throw new Error("The bundle's manifest does not match its contents");
    return { manifest: j.manifest, body: JSON.parse(dec.decode(plain)) };
  }
  async function applyBundle(b) {
    const s = CLOUD.session(); const done = [];
    if (b.book && b.book.data) { const r = await CLOUD.req("/rest/v1/books?select=version&org_id=eq." + s.org_id); const rows = r.ok ? await r.json() : []; const v = rows.length ? rows[0].version : 0; const w = await CLOUD.req("/rest/v1/rpc/save_book", { method: "POST", body: JSON.stringify({ p_org: s.org_id, p_version: v, p_data: b.book.data }) }); if (!w.ok) throw new Error("The book could not be written: " + (await w.text()).slice(0, 120)); done.push("book"); }
    for (const [app, row] of Object.entries(b.shared || {})) { try { let v = 0; try { v = (await CLOUD.sharedVersion(app)) || 0; } catch (e) { /* new */ } await CLOUD.sharedSave(app, v, row.data); done.push(app); } catch (e) { done.push(app + " (failed: " + e.message + ")"); } }
    for (const app of SHARED_APPS) delete SUITE.db.cache["shared:" + app];
    if (typeof CLOUD.account === "function") CLOUD.account("audit", { kind: "import", ref: "bundle", detail: { what: "sealed bundle", applied: done, org: s.org_id } }).catch(() => {});
    return done;
  }

  // ---------- the pages in Settings
  function drawBundles(main, X) {
    main.append(X.h1("Sealed bundles", "export " + (CLOUD.state.orgName || "this company") + " as one encrypted file for an air-gapped transfer, or import one"));
    const exp = H("div"); main.append(X.panel("Export", H("div", { class: "sh-dim", style: "margin-bottom:10px" }, "The books, the shared notebook, calendar and contacts, the workflow and the index of company documents (not the files themselves) are sealed under a passphrase you choose — PBKDF2-SHA-256 with 310 000 rounds and AES-256-GCM — with a manifest and the audit trail's head hash. Carry the file on media; nothing passes over a network."), exp));
    exp.append(H("button", { class: "primary", onclick: async () => { const v = await SUITE.dialog({ title: "Seal the bundle", text: "Choose a passphrase for this bundle. It is not your account passphrase; whoever imports the bundle must know it.", fields: [{ k: "a", label: "Bundle passphrase (at least 12 characters)", type: "password" }, { k: "b", label: "Repeat", type: "password" }], ok: "Export", validate: (x) => { if ((x.a || "").length < 12) throw new Error("Twelve characters at least"); if (x.a !== x.b) throw new Error("The passphrases differ"); } }); if (!v) return; try { SUITE.busy("Sealing…"); const m = await exportBundle(v.a); SUITE.idle(); SUITE.toast("Bundle exported · " + m.counts.book + " book · " + m.counts.shared + " shared · " + m.counts.documents + " documents listed"); } catch (e) { SUITE.idle(); SUITE.toast(e.message); } } }, "Export a sealed bundle"));
    if (!isAdmin()) return;
    const imp = H("div"); main.append(X.panel("Import", H("div", { class: "sh-dim", style: "margin-bottom:10px" }, "Administrators only. The bundle's book replaces this company's book (the replaced version is kept in the book's history); shared documents are replaced too. Check the manifest before applying."), imp));
    imp.append(H("button", { onclick: async () => { const files = await SUITE.pickFiles({ accept: ".xbundle,application/json" }); if (!files || !files.length) return; const text = await files[0].text(); const v = await SUITE.dialog({ title: "Open the bundle", fields: [{ k: "p", label: "Bundle passphrase", type: "password" }], ok: "Open" }); if (!v) return; try { const { manifest, body } = await openBundle(text, v.p); const okk = await SUITE.confirm({ title: "Apply " + manifest.org + " · " + manifest.created.slice(0, 10) + "?", text: "Sealed with Suite " + manifest.suite + ". Contains: " + manifest.counts.book + " book, " + manifest.counts.shared + " shared documents, " + manifest.counts.documents + " document entries" + (manifest.audit_head ? "; audit head " + manifest.audit_head.slice(0, 16) + "…" : "") + ". The current book of " + (CLOUD.state.orgName || "this company") + " is replaced." }, "Apply", true); if (!okk) return; SUITE.busy("Applying…"); const done = await applyBundle(body); SUITE.idle(); SUITE.toast("Applied: " + done.join(", ")); } catch (e) { SUITE.idle(); SUITE.toast(e.message); } } }, "Import a bundle…"));
  }
  window.SETTINGS_EXTRA = (window.SETTINGS_EXTRA || []).concat([
    { id: "bundles", label: "Sealed bundles", group: "admin", when: () => company(), draw: drawBundles },
  ]);
  // "Go to…" under More on the phone (where there is no Ctrl K)
  SUITE.commandPalette = openPalette;
  const boot = () => { if (typeof SUITE === "undefined" || !SUITE.db) return; if (SUITE.host && SUITE.host.protectWindow && localStorage.getItem("xyntax.protectWindow") === "1") SUITE.host.protectWindow(true).catch(() => {}); };
  if (document.readyState === "complete") setTimeout(boot, 800); else window.addEventListener("load", () => setTimeout(boot, 800));
  window.ADVANCED = { openPalette, exportBundle, openBundle, applyBundle };
})();
