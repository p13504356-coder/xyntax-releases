/* XYNTAX in the browser — the shell (4.34). Loaded ONLY by the web build, after every app script and before app.js (as phone.js is
 * on the phone). web-bridge.js gave the page window.xyntax; this file is what the Electron window and the operating system are on
 * the desktop: the session's rules for a login that faces the internet, the browser's Back / Forward / Reload, the new-version
 * prompt, the unsaved-form guard, and the few places where a browser needs other words or another way.
 *   session   two-step verification before the suite opens (company policy webMfaRequired, on unless every company of the person
 *             switched it off; a browser that gave the code once is remembered and not asked again) · no automatic sign-out
 *             unless a company sets webIdleMinutes (a 60-second warning first) or webSessionHours · sign-out revokes the session, clears every copy the suite kept in this browser and
 *             tells the other tabs · sign-in answers never say whether an address has an account
 *   history   every place the suite marks (app, PROSHIP place / section / vessel, Settings page, Accounting view) is a history entry
 *             (#!/proship/fleet/vessels): Back and Forward move between them, Reload returns to the same place; Back never drops a
 *             form with typing in it without asking
 *   versions  version.json is read every few minutes; a newer build shows "A new version of XYNTAX is available — Reload"; the page
 *             never reloads by itself
 * XWEB (web-bridge.js) carries what both files share. Nothing here runs on the desktop or the phone. */
(function () {
  "use strict";
  const X = window.XWEB; const CFG = window.XYNTAX_WEB; if (!X || !CFG || typeof SUITE === "undefined" || typeof CLOUD === "undefined") return;
  const H = (...a) => SUITE.H(...a); const sleep = (ms) => new Promise((r) => setTimeout(r, ms)); const LS = window.localStorage, SS = window.sessionStorage;
  const get = (k) => { try { return LS.getItem(k); } catch (e) { return null; } }; const set = (k, v) => { try { if (v == null) LS.removeItem(k); else LS.setItem(k, String(v)); } catch (e) { /* storage refused */ } };
  const T = (X.timing = { idleMs: null, absMs: null, warnMs: 60000, tickMs: 5000, versionMs: 5 * 60000, versionFirstMs: 20000 }); // the tests shorten these
  // H1 · while a session is only at password level and the second step may be needed, the program is told "nobody is signed in":
  // app.js then draws the sign-in card and starts no load of any kind (no books, no PROSHIP, no documents, no realtime, no home).
  // The shell keeps the session for the few calls the second step itself needs (whoami for the company's rule, the factor, the
  // challenge). Taking the cover away from the console shows a sign-in card: nothing else was ever fetched.
  const signedIn0 = CLOUD.signedIn.bind(CLOUD), active0 = CLOUD.active.bind(CLOUD); let held = false;
  CLOUD.signedIn = function () { return !held && signedIn0(); }; CLOUD.active = function () { return !held && active0(); };
  // … and the one door every request to the workspace goes through lets only the sign-in service, the call that carries the company's rule, the second step's own calls (recovery codes) and the one question "is this browser remembered?" (rpc/device_session) pass.
  const req0 = CLOUD.req.bind(CLOUD); CLOUD.req = function (path, opt, retry) { if (held && !(/^\/auth\/v1\//.test(String(path)) || /^\/rest\/v1\/rpc\/device_session$/.test(String(path)) || (/^\/functions\/v1\/admin$/.test(String(path)) && /"action":"(whoami|mfa_[a-z_]+)"/.test(String((opt && opt.body) || ""))))) return Promise.resolve(new Response('{"message":"Two-step verification first"}', { status: 403, headers: { "content-type": "application/json" } })); return req0(path, opt, retry); };
  const signedIn = () => { try { return signedIn0(); } catch (e) { return false; } };
  const sess = () => { try { return CLOUD.session() || {}; } catch (e) { return {}; } };
  const claims = () => { try { return JSON.parse(atob(String(sess().access_token).split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))); } catch (e) { return {}; } };

  held = signedIn() && (() => { try { const c = claims(); const amr = c.amr; return (c.aal || "aal1") !== "aal2" && !(Array.isArray(amr) && amr.some((a) => /^sso/i.test(String((a && a.method) || a)))); } catch (e) { return true; } })();
  X.held = () => held;
  // ---------- 0 · before app.js starts
  // a wipe that a reload interrupted (Sign out buttons that reload at once) is finished first
  let pendingWipe = null; try { if (SS.getItem("xw.wipe")) { SS.removeItem("xw.wipe"); pendingWipe = X.wipe(); } } catch (e) { /* storage refused */ }
  // tokens in the address (#access_token=…: a password reset, an invitation, single sign-on) are taken by app.js. A link must not
  // replace the session of a person who is signed in with one for somebody else (a crafted link would put you in another account
  // without your noticing): such an address is dropped, and the page says so.
  let dropped = false;
  const foreignTokens = () => { try { const h = location.hash || ""; if (!/access_token=/.test(h) || !signedIn()) return false; const q = new URLSearchParams(h.replace(/^#\/?/, "")); let sub = ""; try { sub = JSON.parse(atob(String(q.get("access_token")).split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).sub || ""; } catch (e) { sub = ""; } if (sub && sub === sess().user_id) return false; history.replaceState(history.state, "", location.pathname + location.search); return true; } catch (e) { return false; } };
  dropped = foreignTokens();
  // M1 · … and a link that would sign somebody in where nobody is signed in is not followed silently either (a crafted link would
  // put you into the sender's account, and what you then type would be theirs): the tokens leave the address at once, nothing is
  // stored, and the page asks "You are about to sign in as <email>" first. A reset or invitation link goes to its set-password
  // step as before; single sign-on that this browser started itself (within the last 15 minutes) continues without the question.
  const linkOf = (first) => { try { const h = location.hash || ""; if (!/access_token=/.test(h) || signedIn()) return null; const q = new URLSearchParams(h.replace(/^#\/?/, "")); const type = q.get("type") || ""; if (type === "recovery" || type === "invite") return null; let pend = null; try { pend = JSON.parse(get("xyntax.sso.pending") || "null"); } catch (e) { pend = null; } if (!type && pend && Date.now() - (+pend.at || 0) < 15 * 60000) return null; try { if (SS.getItem("xw.linkok") === h.slice(-24)) { if (first) SS.removeItem("xw.linkok"); return null; } } catch (e) { /* storage refused: ask */ } let email = ""; try { email = JSON.parse(atob(String(q.get("access_token")).split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).email || ""; } catch (e) { email = ""; } history.replaceState(history.state, "", location.pathname + location.search); return { hash: h, email }; } catch (e) { return null; } };
  let arriving = linkOf(true);
  // tokens still in the address now are a link this browser accepted: app.js takes them in a moment. They are a sign-in at the level
  // the token itself says — an emailed link (magic link, confirmation, reset, invitation) is password level at best — so the hold
  // starts here, before the session exists: without it the program found "signed in" and loaded everything before the second step.
  // A reset or an invitation first sets the password (the only call that passes the hold besides the second step's own); the
  // second step follows it, in CLOUD.setPassword below, and only then does the program start.
  const hashTok = (() => { try { const h = location.hash || ""; if (arriving || !/access_token=/.test(h)) return null; const q = new URLSearchParams(h.replace(/^#\/?/, "")); let c = {}; try { c = JSON.parse(atob(String(q.get("access_token")).split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))) || {}; } catch (e) { c = {}; } const amr = c.amr; return { type: q.get("type") || "", strong: c.aal === "aal2" || (Array.isArray(amr) && amr.some((a) => /^sso/i.test(String((a && a.method) || a)))) }; } catch (e) { return null; } })();
  let setting = !!(hashTok && (hashTok.type === "recovery" || hashTok.type === "invite")); if (hashTok && !hashTok.strong) held = true;
  X.linkHold = () => ({ tok: hashTok, setting });
  if (CLOUD.setPassword) { const setPassword0 = CLOUD.setPassword.bind(CLOUD); CLOUD.setPassword = async function (pw) { const r = await setPassword0(pw); if (setting) { setting = false; held = true; forgetHere(); /* a new password: this browser is not remembered any more — the code is asked for */ let pass = false; try { pass = await gate(); } catch (e) { pass = false; } if (!pass) { await endSession(); held = false; throw new Error("Two-step verification is needed to sign in from a browser."); } held = false; await renew(); stamp(true); } return r; }; }
  const askLink = async (l) => { if (!l) return; const yes = await ask("Sign in from this link?", "You are about to sign in as " + (l.email || "an account this link names") + ". Continue only if you asked for this link yourself and that is your account.", "Continue", "Cancel", true); if (!yes) { SUITE.toast("Not signed in — the link was not used"); return; } try { SS.setItem("xw.linkok", l.hash.slice(-24)); } catch (e) { /* asked again after the reload */ } location.hash = l.hash; location.reload(); };
  window.addEventListener("hashchange", (e) => { const l = linkOf(); if (l) { e.stopImmediatePropagation(); askLink(l); } }, true);
  // … also when the address changes under a page that is already open (the capture listener runs before the app's own)
  window.addEventListener("hashchange", (e) => { if (foreignTokens()) { e.stopImmediatePropagation(); try { SUITE.toast("That link was for another account. You are still signed in as before."); } catch (x) { /* no toast yet */ } } }, true);
  // the place in the address when the page was opened (#!/proship/fleet/vessels): returned to once the home is up. The "!" keeps
  // these apart from PROSHIP's own deep links (#/vessel/<id>…, proship-nav.js), which that app reads when it opens.
  const SEG = /^[A-Za-z0-9._:~-]{1,80}$/;
  const parse = (hash) => { const m = /^#!\/([a-z]{2,20})((?:\/[^/?#]{1,240}){0,4})\/?$/.exec(String(hash || "")); if (!m) return null; const parts = m[2] ? m[2].slice(1).split("/").map((p) => { try { return decodeURIComponent(p); } catch (e) { return ""; } }) : []; if (parts.some((p) => !SEG.test(p) || /^\.+$/.test(p))) return null; return { app: m[1], parts }; };
  const first = parse(location.hash);

  // ---------- 1 · the host: what the suite asks of the device (merged over the desktop's answers in app.js, as PHONE_HOST is)
  window.WEB_HOST = function (base) {
    return {
      mobile: false, web: true,
      signOut() { signOut("user"); },
      async saveFile(name, blob) { X.download(name, blob); return true; },
      openExternal(u) { window.xyntax.openExternal(u); },
      fxFetch: null, fetchText: null, dragOut: null, dragInfo: null,
      updateCheck: async () => { const r = await window.xyntax.updateCheck(); return r.available ? "A new version (" + r.version + ") is available — Reload when it suits you" : r.reason ? "Could not check: " + r.reason : "This is the current version (" + CFG.version + ")"; },
      // DOCUMENTS · "Open in Word / Excel": saved to the computer; changes come back while the tab is open (web-bridge.js §6)
      async openNative(item, blob) { const bytes = new Uint8Array(await blob.arrayBuffer()); const r = await X.openForEdit(item.id == null ? "tmp-" + Date.now() : item.id, item.name, bytes); if (r && r.error) { const e = new Error(r.error); e.blocked = !!r.blocked; throw e; } X._lastOpen = { name: item.name, mode: r.mode, at: Date.now() }; SUITE.toast(openedWords(X._lastOpen)); },
      // pictures, PDFs and text open in the suite's own viewer; anything else is a download (never a new tab with the file's own markup)
      async openBlob(name, blob, mime) { if (SUITE.view) return SUITE.view({ name, blob, mime }); X.download(name, blob); },
      mail: async (m) => { const r = await window.xyntax.mailCompose(m.name, m.bytes, null, m.subject, (m.body || "") + (m.to ? "\n\nTo: " + m.to : "")); if (r && r.note) SUITE.toast(r.note); },
      onOpen() { sync(); },
    };
  };
  // the suite's own back guard is for the app shells (one spare history entry, re-armed after every pop): a browser keeps real entries
  SUITE.nav.arm = function () {};
  // words that are the desktop's: the toast after "Open in Word / Excel" says what happened here instead
  const openedWords = (o) => (o.mode === "handle" ? o.name + " is saved on this computer — open it from there; every save comes back here while this tab is open" : o.mode === "upload" ? o.name + " was downloaded — edit it, then “Upload edited copy…” brings your changes back" : o.name + " was downloaded (a copy: changes are not saved back)");
  { const toast0 = SUITE.toast.bind(SUITE); SUITE.toast = function (m) { const o = X._lastOpen; if (o && Date.now() - o.at < 4000 && typeof m === "string" && /^Opening .+ in .+…/.test(m)) m = openedWords(o); return toast0(m); }; }
  // two tabs (or two people) changing the same PROSHIP record: the store settles it — the other version is kept in the record's
  // history and this one is saved on top (proship-store.js, proship_save's base_version guard). With several tabs open that is
  // more likely than on one desktop, so it is said here, in the words ACCOUNTING uses for its own records.
  // (PROSHIP sends a change 0.4 s after it is made: until that save has come back the change counts as "still on its way", so
  // closing the tab in that moment asks first — psSeq / psSent, read by waiting() below)
  let psSeq = 0, psSent = 0, psAt = 0; if (window.PS && typeof PS.onChange === "function") PS.onChange(() => { psSeq++; psAt = Date.now(); });
  if (window.PSDB && typeof PSDB.save === "function") { const save0 = PSDB.save.bind(PSDB); PSDB.save = async function (doc) { const seq = psSeq; const r = await save0(doc); if (!(r && r.refused)) psSent = Math.max(psSent, seq); try { if (r && r.conflicts) SUITE.toast(r.conflicts === 1 ? "A colleague or another tab changed this record a moment earlier — their version is kept in the history and yours was saved on top" : r.conflicts + " records were changed by a colleague or another tab a moment earlier — theirs are kept in the history"); } catch (e) { /* no toast yet */ } return r; }; }
  // stored rich text (a note's body — yours, or a colleague's shared page) is drawn as markup (SUITE.H's html). The policy keeps any
  // script in it from running; this also takes out, before it is drawn, what could send the page elsewhere or dress it up as
  // something else: a meta refresh, a base, a form, a frame, a style sheet, handlers and script addresses. The suite's own markup
  // (icons, charts) has none of these and passes untouched — the test is one regular expression.
  const RISKY = /<\s*(script|meta|base|link|iframe|frame|frameset|object|embed|form|style)\b|[\s\/"'`]on[a-z]+\s*=|script\s*:|data:text\/html|&(#|colon|tab|newline)|\bformaction\b/i;
  // (a handler after a slash or a quote, and a scheme spelled with character references or a tab inside it, are markup too: the test
  // above sends those through the cleaner, which judges every attribute by the value the browser decoded — not only href and src,
  // also an SVG animation's to / values / from, which can write a link's address later)
  const SCHEME = /^(javascript|vbscript|data:text\/html)/i; const bare = (v) => String(v).replace(/[\u0000-\u0020\u00a0\u1680\u2000-\u200f\u2028-\u202f\u205f\u3000\ufeff]/g, "");
  const cleanHtml = (v) => { const t = document.createElement("template"); t.innerHTML = v; /* template contents: nothing in them loads or runs (the browser still notes a handler attribute against the policy in its console) */ for (const el of t.content.querySelectorAll("script, meta, base, link, iframe, frame, frameset, object, embed, form, style")) el.remove(); for (const el of t.content.querySelectorAll("*")) for (const a of [...el.attributes]) { const n = a.name.toLowerCase(); if (/^on/.test(n) || n === "srcdoc" || n === "formaction" || bare(a.value).split(";").some((part) => SCHEME.test(part))) el.removeAttribute(a.name); } return t.innerHTML; };
  X.cleanHtml = cleanHtml;
  { const H0 = SUITE.H.bind(SUITE); SUITE.H = function (tag, attrs, ...kids) { if (attrs && typeof attrs.html === "string" && RISKY.test(attrs.html)) attrs = { ...attrs, html: cleanHtml(attrs.html) }; return H0(tag, attrs, ...kids); }; }
  // Settings → "Delete all my personal data" clears the device copies by walking the storage's own list of keys (Object.keys), which
  // in this page is the prefixed list — nothing matched, and the deleted notes were drawn again from the copy after the reload.
  // Once the workspace has deleted them, the copies go here by their real names.
  if (CLOUD.account) { const account0 = CLOUD.account.bind(CLOUD); CLOUD.account = async function (action, payload) { const r = await account0(action, payload); if (action === "delete_my_data") { try { for (const k of X.rawKeys("local")) { const key = k.slice(X.ns.length); if (key.startsWith("xyntax.suite")) LS.removeItem(key); } for (const app of Object.keys((SUITE.db && SUITE.db.cache) || {})) SUITE.db.forget(app); } catch (e) { /* storage refused */ } } return r; }; }
  // "Delete all my personal data" may discard what is unsent — after saying how many changes that is, and a yes
  if (CLOUD.account) { const account0 = CLOUD.account.bind(CLOUD); CLOUD.account = async function (action, body) { if (action === "delete_my_data" || action === "delete_account") { const u = await sendAll(6000); if (u.n && !(await ask("Delete with unsent changes?", u.n + " change" + (u.n === 1 ? " has" : "s have") + " not reached the workspace (" + words(u) + ") and will be lost with everything else.", "Delete anyway", "Cancel"))) throw new Error("Not deleted — " + u.n + " change" + (u.n === 1 ? " is" : "s are") + " still unsent"); } return account0(action, body); }; }
  // single sign-on returns to this page
  if (CLOUD.sso) CLOUD.sso.redirect = () => X.home();

  // ---------- 2 · signing in: plain answers, a pause after repeated failures, two-step verification, the session's clock
  const THR = "xw.throttle"; const thr = () => { try { return JSON.parse(get(THR) || "null") || { n: 0, until: 0 }; } catch (e) { return { n: 0, until: 0 }; } };
  const NOPE = "The email or password is not right."; const SLOW = "Too many attempts. Wait a minute and try again."; const DOWN = "The workspace cannot be reached. Check the connection and try again.";
  const plain = (e) => { const m = String((e && e.message) || e || ""); if (/vessel-portal login|authenticator code|not configured|Two-step/i.test(m)) return m; if (/rate limit|too many|security purposes|\b429\b/i.test(m)) return SLOW; if (/^Offline|did not answer|Failed to fetch|NetworkError|Load failed|Refused:/i.test(m)) return DOWN; return NOPE; };
  const login0 = CLOUD.login.bind(CLOUD);
  CLOUD.login = async function (email, password) {
    if (pendingWipe) await pendingWipe; const t = thr(); const wait = Math.ceil((t.until - Date.now()) / 1000); if (wait > 0) throw new Error("Too many attempts. Try again in " + (wait > 90 ? Math.ceil(wait / 60) + " minutes" : wait + " seconds") + ".");
    const before = get("xw.owner"); let orgs; const myOrgs0 = CLOUD.myOrgs; held = true; CLOUD.myOrgs = async () => []; /* the companies are asked for after the second step, not before */
    try { orgs = await login0(email, password); } catch (e) { held = false; CLOUD.myOrgs = myOrgs0; const m = plain(e); if (m === NOPE || m === SLOW) { const n = t.n + 1; set(THR, JSON.stringify({ n, until: n >= 5 ? Date.now() + Math.min(900, 30 * Math.pow(2, n - 5)) * 1000 : 0 })); } throw new Error(m); }
    set(THR, null);
    // another person's copies never meet this session (sign-out already clears them; this covers a browser that was closed instead)
    const uid = sess().user_id || ""; if (before && before !== uid) { const keep = LS.getItem("xyntax.session"); await X.wipe(); /* (the other person's copies still marked unsent stay, under their own keys, for their next sign-in here) */ if (keep) LS.setItem("xyntax.session", keep); }
    CLOUD.myOrgs = myOrgs0; let pass = false; try { pass = await gate(); } catch (e) { pass = false; }
    if (!pass) { await endSession(); held = false; throw new Error("Two-step verification is needed to sign in from a browser."); }
    held = false; orgs = await CLOUD.myOrgs(); stamp(true); tellTabs({ t: "signin", uid }); return orgs;
  };
  const recover0 = CLOUD.recoverPassword.bind(CLOUD);
  CLOUD.recoverPassword = async function (email) { try { await recover0(email); } catch (e) { const m = plain(e); if (m === SLOW || m === DOWN) throw new Error(m); /* anything else would say whether the address has an account */ } return true; };
  if (CLOUD.signUp) { const up0 = CLOUD.signUp.bind(CLOUD); CLOUD.signUp = async function (email, password, name) { try { return await up0(email, password, name); } catch (e) { const m = plain(e); if (m === SLOW || m === DOWN) throw new Error(m); if (/password/i.test(String(e.message))) throw e; return { confirmed: false }; } }; }
  // several tabs share one session: only one of them renews it at a time, and the others take the renewed one
  if (navigator.locks && navigator.locks.request) { const refresh0 = CLOUD.refresh.bind(CLOUD); CLOUD.refresh = function () { const had = sess().refresh_token; return navigator.locks.request(X.ns + "refresh", async () => { const now = sess().refresh_token; if (had && now && now !== had) return true; return refresh0(); }); }; }
  // every Sign out in the program ends here (some call CLOUD.logout() and reload at once: what cannot finish before the reload is
  // finished by the next page, §0)
  const logout0 = CLOUD.logout.bind(CLOUD); let leaving = false;
  // the program's own sign-out clears every device copy by name; a copy still marked unsent (somebody else's, waiting for their next
  // sign-in here — this person's own were sent, or knowingly discarded, before this is reached) is put back
  const logoutKeeping = (all) => { let saved = []; try { if (!all) saved = X.rawKeys("local").filter((k) => X.parkedValue(X.rawGet(k))).map((k) => [k.slice(X.ns.length), X.rawGet(k)]); } catch (e) { saved = []; } try { logout0(); } catch (e) { /* nothing to stop */ } for (const [k, v] of saved) { try { LS.setItem(k, v); } catch (e) { /* storage refused */ } } };
  const revoke = (s) => { try { const c = CLOUD.cfg(); if (!s || !s.access_token || !c || !c.url) return; window.fetch(c.url.replace(/\/$/, "") + "/auth/v1/logout?scope=local", { method: "POST", keepalive: true, headers: { apikey: c.key, Authorization: "Bearer " + s.access_token } }).catch(() => {}); } catch (e) { /* the token expires by itself */ } };
  CLOUD.logout = function () { if (!leaving && unsent().n) { setTimeout(() => signOut("user"), 0); return; } /* H3 · with changes still unsent nothing is cleared here: the person is asked (and the browser asks before the caller's reload) */ if (!leaving) revoke(sess()); /* a request that outlives the reload (keepalive): the session ends at the workspace too, not only in this browser */ logoutKeeping(false); for (const k of X.rawKeys("local")) { const bare = k.slice(X.ns.length); if (!X.KEEP.test(bare) && !X.parkedValue(X.rawGet(k))) LS.removeItem(bare); } for (const k of X.rawKeys("session")) SS.removeItem(k.slice(X.ns.length)); try { SS.setItem("xw.wipe", "1"); } catch (e) { /* storage refused */ } leaving = true; tellTabs({ t: "signout", reason: "user" }); };

  // ---- the company policy for browser sign-in (Settings → Company → Security): read from what whoami says about the memberships
  const settingsOf = () => { const live = CLOUD.state.memberships || []; return live.length ? live : ((sess().memberships) || []); }; const settingsNow = () => settingsOf().map((m) => (m && m.orgs && m.orgs.settings) || {});
  const policy = () => { const ss = settingsNow(); const idle = ss.map((s) => +s.webIdleMinutes).filter((n) => n >= 5 && n <= 480); const life = ss.map((s) => +s.webSessionHours).filter((n) => n >= 1 && n <= 72);
    return { mfa: !ss.length || ss.some((s) => s.webMfaRequired !== false), idleMin: idle.length ? Math.min(...idle) : (+CFG.idleMinutes > 0 ? +CFG.idleMinutes : 0), hours: life.length ? Math.min(...life) : (+CFG.sessionHours > 0 ? +CFG.sessionHours : 0) }; };
  // 4.34.5 · 0 (or nothing) is "off": no idle sign-out, no longest session — the session lasts until Sign out, as on the desktop.
  // That is the default; a company that sets a limit (Settings → Company → Security → Browser sign-in) gets the limit.
  const limits = (p) => ({ idleMs: T.idleMs || (p.idleMin > 0 ? p.idleMin * 60000 : Infinity), absMs: T.absMs || (p.hours > 0 ? p.hours * 3600000 : Infinity) });
  X.policy = policy;
  const viaSso = () => { const amr = claims().amr; return Array.isArray(amr) && amr.some((a) => /^sso/i.test(String((a && a.method) || a))); };
  // ---- 4.34.5 · the remembered browser (sql/4345-trusted-device.sql). After the code has been given once in this browser, a random
  // token is kept here under xw.device.<user id> — a key no sign-out removes; only "Forget this browser", forgetKeysOnSignOut, or
  // the workspace refusing it do — and its SHA-256 in the workspace. At the next password sign-in the token is shown to the
  // workspace BEFORE the code is asked for (the one request besides sign-in's own that passes the hold): accepted → this session
  // is marked trusted there (the database then treats it as it treats a session with the code) and no code is asked; refused →
  // the token is dropped and the code is asked for as before. The session itself stays at password level for Auth: a change that
  // weakens sign-in still asks for the real code (the admin function's rule, cloud.js steps up).
  const DEV = (uid) => "xw.device." + uid; let trustedSid = "", noTrust = false;
  const sidNow = () => String(claims().session_id || claims().sub || ""); const isTrusted = () => !!trustedSid && signedIn() && trustedSid === sidNow();
  const call = (fn, body) => req0("/rest/v1/rpc/" + fn, { method: "POST", body: JSON.stringify(body || {}) });
  async function tryDevice() { if (!signedIn()) return false; if (isTrusted()) return true; const uid = sess().user_id; const tok = uid && get(DEV(uid)); if (!tok) return false; let r; try { r = await call("device_session", { p_token: tok }); } catch (e) { return false; /* no answer: the token stays, the code is asked for */ } let v = false; try { v = r.ok && (await r.json()) === true; } catch (e) { v = false; } if (v) { trustedSid = sidNow(); return true; } if (r.status < 500) set(DEV(uid), null); return false; }
  const deviceLabel = () => { const ua = navigator.userAgent || ""; const b = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Browser"; const o = /Windows/.test(ua) ? "Windows" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Mac OS X/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : ""; return b + (o ? " on " + o : ""); };
  async function remember() { try { if (noTrust || !signedIn() || viaSso() || CLOUD.mfa.aal() !== "aal2" || CFG.forgetKeysOnSignOut) return false; const uid = sess().user_id; if (!uid) return false; const old = get(DEV(uid)); const b = new Uint8Array(32); crypto.getRandomValues(b); const tok = btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); const r = await call("device_trust", { p_token: tok, p_label: deviceLabel() }); if (!r.ok) { if (r.status === 404) noTrust = true; /* the workspace does not have the 4.34.5 SQL yet */ return false; } set(DEV(uid), tok); if (old) call("device_forget", { p_token: old }).catch(() => {}); return true; } catch (e) { return false; } }
  X.device = { trusted: isTrusted, remember, tryDevice, key: DEV };
  // the program's own "this company wants the code for you" prompt (security.js, after sign-in) is answered by a trusted session too
  if (CLOUD.mfa.needsStepUp) { const needs0 = CLOUD.mfa.needsStepUp.bind(CLOUD.mfa); CLOUD.mfa.needsStepUp = function (org) { return isTrusted() ? false : needs0(org); }; }
  // a new password forgets every remembered browser of the person (cloud.js asks the workspace to; the database does it by itself
  // where it may). This browser forgets its own token too, and — still signed in — proves the second step once more: with the
  // code it is remembered afresh (a new token); a session that was only trusted is asked for the code now.
  function forgetHere() { set(DEV(sess().user_id || ""), null); trustedSid = ""; }
  async function renew() { try { if (CLOUD.mfa.aal() === "aal2" && !viaSso()) { await call("device_forget_all", {}).catch(() => null); await remember(); } } catch (e) { /* asked for the code next time */ } }
  if (CLOUD.changePassword) { const change0 = CLOUD.changePassword.bind(CLOUD); CLOUD.changePassword = async function (pw) { const r = await change0(pw); forgetHere(); if (CLOUD.mfa.aal() === "aal2") await renew(); else if (signedIn() && !viaSso()) gate().then(async (ok) => { if (!ok) signOut("user"); else await renew(); }); return r; }; }
  // the code step of sign-in (cloud.js asks for it right after the password when the person has an authenticator; the gate below
  // asks when the company's browser rule wants it): the remembered browser answers first; a code really given renews the memory
  { const stepUp0 = CLOUD.mfa.stepUp.bind(CLOUD.mfa); CLOUD.mfa.stepUp = async function (factorId) { if (!held) return stepUp0(factorId); if (await tryDevice()) return true; const ok = await stepUp0(factorId); if (ok && CLOUD.mfa.aal() === "aal2") await remember(); return ok; }; }
  // ---- two-step verification: the same assurance the desktop reaches when a company requires it (aal2), asked of every browser
  // sign-in unless the person's companies all switched the policy off. No authenticator yet → it is set up now; a lost one is an
  // administrator's to reset (Settings → People), or a recovery code.
  let gating = null;
  function gate() { if (gating) return gating; gating = (async () => {
    try {
      if (!signedIn()) return true; if (CLOUD.mfa.aal() === "aal2" || viaSso()) return true; if (await tryDevice()) return true;
      const who = await CLOUD.whoami(); if (!who && !(sess().memberships)) return await gateCard("offline");
      if (!policy().mfa) return true;
      let user = null; try { user = await CLOUD.mfa.user(); } catch (e) { user = null; } if (!user) return await gateCard("offline");
      const f = (user.factors || []).find((x) => x.status === "verified" && (x.factor_type === "totp" || !x.factor_type));
      if (f) { cover(true); try { return !!(await CLOUD.mfa.stepUp(f.id)) && CLOUD.mfa.aal() === "aal2"; } finally { cover(false); } }
      return await gateCard("enrol");
    } finally { gating = null; }
  })(); return gating; }
  function cover(on) { let c = document.getElementById("xwgate"); if (!on) { if (c) c.remove(); for (const id of ["app", "home", "sapp", "sheet", "login"]) { const el = document.getElementById(id); if (el) el.inert = false; } return null; } if (!c) { c = H("div", { id: "xwgate", role: "dialog", "aria-modal": "true", "aria-label": "Two-step verification" }); document.body.append(c); } for (const id of ["app", "home", "sapp", "sheet", "login"]) { const el = document.getElementById(id); if (el) el.inert = true; } const b = document.getElementById("boot"); if (b) b.classList.add("gone"); return c; }
  function gateCard(kind) { return new Promise((res) => {
    const c = cover(true); const done = (v) => { cover(false); res(v); }; const err = H("div", { class: "sh-err", style: "min-height:16px" });
    const draw = () => { c.innerHTML = "";
      if (kind === "offline") c.append(H("div", { class: "sh-dcard" }, H("h3", {}, "Two-step verification"), H("p", {}, "The workspace could not be asked whether this sign-in needs your authenticator code. Check the connection and try again."), H("div", { class: "sh-dbtns" }, err, H("button", { onclick: () => done(false) }, "Sign out"), H("button", { class: "primary", onclick: async () => { done(await gate.again()); } }, "Try again"))));
      else c.append(H("div", { class: "sh-dcard" }, H("h3", {}, "Set up two-step verification"), H("p", {}, "Signing in from a browser needs a second step: a 6-digit code from an authenticator app on your phone. It takes a minute to set up, once."), H("p", { class: "sh-dim", style: "font-size:12px" }, "Your company decides this (Settings → Company → Security). If you lose the phone, a recovery code or an administrator gets you back in."), H("div", { class: "sh-dbtns" }, err, H("button", { onclick: () => done(false) }, "Sign out"), H("button", { class: "primary", "data-act": "xw-enrol", onclick: async () => { err.textContent = ""; if (typeof IDENTITY === "undefined" || !IDENTITY.enrol) { err.textContent = "The set-up page is not in this build"; return; } c.style.visibility = "hidden"; let ok = false; try { ok = await IDENTITY.enrol(); } catch (e) { err.textContent = e.message; } c.style.visibility = ""; if (ok && CLOUD.mfa.aal() === "aal2") { await remember(); done(true); } else if (!err.textContent) err.textContent = "Not set up yet"; } }, "Set up now"))));
    }; draw(); setTimeout(() => { const b = c.querySelector("button.primary"); if (b) try { b.focus(); } catch (e) { /* no focus */ } }, 50);
  }); }
  gate.again = async () => { gating = null; return gate(); };

  // ---- the session's clock: last activity (shared by the tabs), the sign-in time, and the two limits
  const ACT = "xw.active", AT = "xw.signedAt"; let lastWrite = 0, lastLocal = Date.now(), warnEl = null;
  const stamp = (fresh) => { const uid = sess().user_id || ""; if (fresh || !get(AT) || get("xw.owner") !== uid) set(AT, Date.now()); set("xw.owner", uid); touch(true); };
  // the limits do not trust this computer's clock alone: setting it back must not buy time. "Now" is the later of the wall clock
  // and the workspace's own time (the Date of its last answer, carried forward by a counter that only runs forward); quiet time is
  // at least what that counter measured since this tab's last activity; the sign-in's age is at least what it was when this tab
  // last looked plus the counter since (kept per tab across a reload).
  const mono = () => (window.performance && performance.now ? performance.now() : Date.now());
  const clock = () => { const n = X.net || {}; const est = n.serverAt ? n.serverAt + (mono() - n.serverSeen) : 0; return Math.max(Date.now(), est); };
  let lastMono = mono(), ageBase = null;
  const ageNow = (now) => { const at = +get(AT) || 0; if (!at) return 0; const wall = now - at; if (!ageBase || ageBase.at !== at) { let floor = 0; try { const j = JSON.parse(SS.getItem("xw.age") || "null"); if (j && j.at === at) floor = +j.age || 0; } catch (e) { floor = 0; } ageBase = { at, age: Math.max(wall, floor), mono: mono(), saved: 0 }; } const a = Math.max(wall, ageBase.age + (mono() - ageBase.mono)); try { if (mono() - ageBase.saved > 15000) { ageBase.saved = mono(); SS.setItem("xw.age", JSON.stringify({ at, age: a })); } } catch (e) { /* storage refused */ } return a; };
  const quietNow = (now) => { const stored = +get(ACT) || 0; const wall = now - Math.max(lastLocal, stored); return stored > lastLocal + 1500 ? wall : Math.max(wall, mono() - lastMono); };
  X.clock = { clock, ageNow, quietNow };
  function touch(force) { lastLocal = Date.now(); lastMono = mono(); if (force || lastLocal - lastWrite > 5000) { lastWrite = lastLocal; if (signedIn()) set(ACT, lastLocal); } if (warnEl && warnEl.dataset.kind === "idle") closeWarn(); }
  for (const ev of ["pointerdown", "keydown", "wheel", "touchstart"]) document.addEventListener(ev, () => touch(false), { capture: true, passive: true });
  { let mm = 0; document.addEventListener("mousemove", () => { const n = Date.now(); if (n - mm > 2000) { mm = n; touch(false); } }, { capture: true, passive: true }); }
  const lastActive = () => Math.max(lastLocal, +get(ACT) || 0);
  function closeWarn() { if (warnEl) { warnEl.remove(); warnEl = null; } }
  function warn(kind, left) { const s = Math.max(0, Math.ceil(left / 1000)); if (!warnEl || warnEl.dataset.kind !== kind) { closeWarn(); warnEl = H("div", { id: "xwwarn", class: "updbar", role: "alert", "data-kind": kind }, H("span", {}, kind === "idle" ? "No activity for a while — you will be signed out in " : "This sign-in has reached its time limit — you will be signed out in ", H("b", { class: "xw-secs" }, String(s)), kind === "idle" ? " s. " : " s; what waits is saved first. "), kind === "idle" ? H("button", { class: "primary", "data-act": "xw-stay", onclick: () => touch(true) }, "Stay signed in") : null); document.body.append(warnEl); } else warnEl.querySelector(".xw-secs").textContent = String(s); }
  let wasIn = signedIn();
  // a tab that is reloaded or opened again does not start the clocks afresh. Before app.js draws anything: tokens arriving in the
  // address are a new sign-in (the old stamps go); otherwise, when the last activity any tab noted — or the sign-in itself — is
  // already past its limit, the page stays covered and the session is ended the moment the suite is up (signOut: what waits is sent
  // first), or after a few seconds if it never comes up. Without this, closing the tab and opening it hours later counted as activity.
  if (/access_token=/.test(location.hash || "")) { set(ACT, null); set(AT, null); }
  const overdue = () => { if (!signedIn()) return ""; const p = policy(); const now = clock(); const at = +get(AT) || 0, act = +get(ACT) || 0; const L = limits(p); if (at && ageNow(now) >= L.absMs) return "expired"; if (act && now - act >= L.idleMs) return "idle"; return ""; };
  let late = overdue(); X.session0 = { late, overdue };
  if (late) { try { cover(true); } catch (e) { /* no page yet */ } setTimeout(() => { if (late) { const why = late; late = ""; signOut(why); } }, 12000); }
  function tick() {
    if (leaving) return; const inNow = signedIn();
    if (!inNow) { closeWarn(); if (wasIn) { wasIn = false; signOut("ended"); } return; } wasIn = true; lastEmail = sess().email || lastEmail; lastOrg = sess().org_id || lastOrg;
    const p = policy(); const now = clock(); const { idleMs, absMs } = limits(p); const warnMs = Math.min(T.warnMs, idleMs / 2);
    const quiet = quietNow(now); const age = ageNow(now);
    if (age >= absMs) return signOut("expired"); if (quiet >= idleMs) return signOut("idle");
    if (absMs - age <= warnMs) return warn("abs", absMs - age); if (idleMs - quiet <= warnMs) return warn("idle", idleMs - quiet);
    closeWarn();
  }
  let ticker = null; const startClock = () => { clearInterval(ticker); ticker = setInterval(tick, Math.min(T.tickMs, 1000)); };
  X.session = { restart: startClock, tick, touch, gate, lastActive, signOut: (r, o) => signOut(r, o) };
  document.addEventListener("visibilitychange", () => { if (!document.hidden) tick(); });
  // ---- H3 · what has not reached the workspace yet. Nothing in this file clears, revokes or reloads while this is not empty —
  // unless the person, told how many changes it is, says so. The queues: the apps' documents (notes, calendar, contacts, wealth…:
  // SUITE.db), the books (the debounced save and BOOKDB's device queue), PROSHIP (its 0.4 s save and PSDB's queue), every write
  // request still on its way (uploads to DOCUMENTS, messages being posted, attachments) and a watched Word / Excel file being read.
  const num = (x) => (Array.isArray(x) ? x.length : +x || 0);
  // device copies of the apps' documents that carry the unsent mark (suite.js keep): a change the workspace never confirmed, left
  // by a tab that was closed — or a computer that went off — while a save was failing. mine = of the person and company signed in now
  function parked() { const list = []; try { const s = sess(); for (const k of X.rawKeys("local")) { const key = k.slice(X.ns.length); if (!key.startsWith("xyntax.suite.") || !X.parkedValue(X.rawGet(k))) continue; let app = ""; if (key.startsWith("xyntax.suite.shared.")) { if (s.org_id && key.endsWith("." + s.org_id)) app = "shared:" + key.slice(20, -(s.org_id.length + 1)); } else if (s.user_id && key.endsWith("." + s.user_id)) app = key.slice(13, -(s.user_id.length + 1)); list.push({ key, app }); } } catch (e) { /* storage refused */ } return list; }
  X.parked = parked;
  function unsent() { const u = { docs: [], book: 0, proship: 0, writes: X.net.writes || 0, files: [] };
    try { for (const [a, c] of Object.entries((SUITE.db && SUITE.db.cache) || {})) if (c && c.dirty) u.docs.push(a); } catch (e) { /* none */ }
    try { if (signedIn()) for (const p of parked()) if (p.app && !u.docs.includes(p.app) && !(SUITE.db.cache[p.app] && SUITE.db.cache[p.app].data)) u.docs.push(p.app); } catch (e) { /* none */ }
    try { if (typeof BOOKDB !== "undefined" && BOOKDB.state) u.book += num(BOOKDB.state.pending); if (typeof S !== "undefined" && S && S.dirty && S.store) u.book += 1; } catch (e) { /* none */ }
    try { if (window.PSDB && PSDB.state) u.proship += num(PSDB.state.pending); if (psSeq > psSent && Date.now() - psAt < 20000) u.proship += 1; } catch (e) { /* none */ }
    try { for (const e of X.edits.values()) if (e.busy) u.files.push(e.name); } catch (e) { /* none */ }
    u.n = u.docs.length + u.book + u.proship + u.writes + u.files.length; return u; }
  X.unsent = unsent;
  async function flushDocs(ms) { try { const db = SUITE.db; if (!db || !db.cache) return 0; const jobs = Object.keys(db.cache).filter((a) => db.cache[a] && db.cache[a].dirty).map((a) => Promise.resolve().then(() => db.flush(a)).catch(() => null)); if (jobs.length) await Promise.race([Promise.all(jobs), sleep(ms)]); return jobs.length; } catch (e) { return 0; } }
  X.flushDocs = flushDocs;
  // every queue is sent and awaited (up to ms each); the answer is what is still unsent afterwards
  async function sendAll(ms) { try { await Promise.race([X.checkEdits(), sleep(3000)]); } catch (e) { /* a file that cannot be read says so in the tray */ } try { if (window.UPD && UPD.flush) await Promise.race([UPD.flush(ms), sleep(ms + 1000)]); } catch (e) { /* stays queued */ } try { if (signedIn()) for (const p of parked()) if (p.app && !(SUITE.db.cache[p.app] && SUITE.db.cache[p.app].data)) { SUITE.db.hush(); try { await Promise.race([SUITE.db.load(p.app).catch(() => null), sleep(4000)]); } finally { SUITE.db.unhush(); } } } catch (e) { /* stays marked, and counted */ } await flushDocs(ms); const t0 = Date.now(); while (X.net.writes > 0 && Date.now() - t0 < ms) await sleep(150); return unsent(); }
  X.sendAll = sendAll;
  // a copy of everything unsent, as one file — whatever happens next, the person has it
  function downloadUnsent() { const u = unsent(); const o = { what: "XYNTAX — changes that had not reached the workspace when this file was made", at: new Date().toISOString(), user: lastEmail || sess().email || "", company: sess().org_name || "", counts: { documents: u.docs, book: u.book, proship: u.proship, requestsOnTheirWay: u.writes, filesBeingRead: u.files }, documents: {}, book: null, proship: null, proshipQueue: null, filesOpenForEditing: [...X.edits.values()].map((e) => ({ name: e.name, mode: e.mode, savesBroughtBack: e.saves })) };
    try { for (const a of u.docs) o.documents[a] = SUITE.db.cache[a].data; } catch (e) { /* as far as it goes */ } try { if (u.book) o.book = S.store; } catch (e) { /* none */ } try { if (u.proship) { o.proship = PS.data(); o.proshipQueue = PSDB.state.pending; } } catch (e) { /* none */ }
    const name = "xyntax-unsent-" + new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-") + ".json"; X.download(name, new Blob([JSON.stringify(o)], { type: "application/json" })); return name; }
  X.downloadUnsent = downloadUnsent;
  const words = (u) => { const p = []; if (u.docs.length) p.push(u.docs.join(", ")); if (u.book) p.push("the books"); if (u.proship) p.push("PROSHIP"); if (u.writes) p.push(u.writes + " upload" + (u.writes === 1 ? "" : "s") + " or message" + (u.writes === 1 ? "" : "s")); if (u.files.length) p.push(u.files.join(", ")); return p.join(" · "); };
  async function endSession(opt) { try { await Promise.race([CLOUD.req("/auth/v1/logout?scope=local", { method: "POST" }, false), sleep(4000)]); } catch (e) { /* the token expires by itself */ } logoutKeeping(opt && opt.unsentToo); await X.wipe(opt); }
  // ---- the cover of a sign-out in progress: at once, over everything (nothing readable, nothing reachable), saying in plain words
  // what is happening; while changes are still unsent it stays, offers the copy, and lets the person back in with the password
  const TAB = Math.random().toString(36).slice(2, 10); let out = null, lastEmail = sess().email || "", lastOrg = sess().org_id || null;
  const WHY = { idle: "Signed out for inactivity", expired: "This sign-in reached its time limit", ended: "Your session ended", user: "Signing out", elsewhere: "Signed out in another tab", version: "Signing out" };
  function hideAll(on) { document.body.classList.toggle("xw-out", !!on); for (const el of [...document.body.children]) { if (/^(xwout|shdlg|xwask|xwgate)$/.test(el.id) || el.tagName === "SCRIPT") continue; if (on) { if (!el.dataset.xwHid) { el.dataset.xwHid = el.inert ? "i" : "1"; el.inert = true; el.style.visibility = "hidden"; } } else if (el.dataset.xwHid) { if (el.dataset.xwHid !== "i") el.inert = false; delete el.dataset.xwHid; el.style.visibility = ""; } } }
  function outCover(u, note) {
    if (!out) return; let c = document.getElementById("xwout"); if (!c) { c = H("div", { id: "xwout", role: "alertdialog", "aria-modal": "true", "aria-label": "Signing out" }); document.body.append(c); } hideAll(true); u = u || unsent(); const others = othersDirty(); const forced = out.reason !== "user";
    const key = [out.reason, u.n, words(u), others, note || "", out.err || "", out.tries].join("|"); if (c.dataset.key === key) return; c.dataset.key = key; const had = c.querySelector("input"); const typed = had ? had.value : ""; c.innerHTML = "";
    const files = [...X.edits.values()].map((e) => e.name);
    const pw = H("input", { type: "password", placeholder: "Password", autocomplete: "current-password", "aria-label": "Password", value: typed }); const err = H("div", { class: "sh-err", style: "min-height:16px" }, out.err || "");
    const tryUnlock = async () => { if (!pw.value || out.busy) return; out.busy = true; err.textContent = ""; let why = ""; try { why = await unlock(pw.value); } catch (e) { why = plain(e); } out.busy = false; if (why) { out.err = why; err.textContent = why; pw.value = ""; try { pw.focus(); } catch (e) { /* gone */ } return; } out.resumed = true; if (out.poke) out.poke(); };
    pw.addEventListener("keydown", (e) => { if (e.key === "Enter") tryUnlock(); });
    c.append(H("div", { class: "sh-dcard" }, H("div", { class: "xw-outmark" }, "XYNTAX"), H("h3", {}, WHY[out.reason] || "Signing out"),
      u.n ? H("p", { "data-act": "xw-unsent" }, (forced ? (WHY[out.reason] || "Signed out") + " — " : "") + u.n + " change" + (u.n === 1 ? " is" : "s are") + " still being sent" + (out.reason === "ended" ? ", and cannot be until you sign in again" : "") + ". Keep this tab open.") : others ? H("p", {}, "Another tab is still sending " + others + " change" + (others === 1 ? "" : "s") + ". Keep it open.") : H("p", {}, note || "Everything is sent. Clearing what this browser kept…"),
      u.n ? H("p", { class: "sh-dim", style: "font-size:12px" }, "Still to send: " + words(u) + ". " + (navigator.onLine === false ? "This computer has no internet connection; it is tried again when it is back." : "It is tried again every few seconds" + (out.tries ? " (" + out.tries + " so far)" : "") + ".") + " Nothing is cleared before it is sent.") : null,
      files.length ? H("p", { class: "sh-dim", style: "font-size:12px", "data-act": "xw-files" }, "Open for editing outside XYNTAX: " + files.join(", ") + ". What was saved there until now is being sent; saves made after this are not read — keep the file, and open it from DOCUMENTS again after you sign in.") : null,
      u.n && !forced ? H("div", { class: "xw-outrow" }, H("button", { "data-act": "xw-dl", onclick: () => { const n = downloadUnsent(); out.err = "Saved to your downloads: " + n; c.dataset.key = ""; outCover(); } }, "Download unsent changes"), !forced ? H("button", { class: "quiet danger", "data-act": "xw-dlout", onclick: () => { downloadUnsent(); out.discard = true; if (out.poke) out.poke(); } }, "Download and sign out") : null) : null,
      (u.n || others) && !out.follower ? H("div", { class: "xw-outrow" }, pw, H("button", { class: "primary", "data-act": "xw-unlock", onclick: tryUnlock }, out.reason === "ended" ? "Sign in again" : "Unlock and keep working")) : null, err));
  }
  // back in from the cover: the password (the workspace checks it), and the authenticator code when the session had one
  async function unlock(pw) { const t = thr(); if (t.until > Date.now()) return "Too many attempts. Wait a moment.";
    const fail = () => { const n = t.n + 1; set(THR, JSON.stringify({ n, until: n >= 5 ? Date.now() + Math.min(900, 30 * Math.pow(2, n - 5)) * 1000 : 0 })); return "Wrong password"; };
    if (out.reason === "ended" || !signedIn()) { const who = lastEmail; if (!who) return "Sign in from the sign-in page"; const uid0 = get("xw.owner"); leaving = false; let orgs = []; try { orgs = await CLOUD.login(who, pw); } catch (e) { leaving = true; return String(e.message || e); } leaving = true; if (uid0 && sess().user_id !== uid0) return "That is another account"; /* the same company as before, quietly: the program still holds that company's unsent work and must not load over it */ const org = (orgs || []).find((o) => o && o.id === lastOrg); if (lastOrg && !org) return "You are no longer a member of that company"; if (org) CLOUD._chooseOrg(org); return ""; }
    if (!(await CLOUD.verifyPassword(pw))) return fail(); set(THR, null);
    if (CLOUD.mfa.aal() === "aal2") { const f = await CLOUD.mfa.verifiedFactor().catch(() => null); if (f && !(await CLOUD.mfa.stepUp(f.id))) return "The authenticator code is needed"; } return ""; }
  function uncover() { const c = document.getElementById("xwout"); if (c) c.remove(); hideAll(false); }
  const othersDirty = () => { if (!out || out.follower) return 0; let n = 0; const now = Date.now(); for (const t of out.tabs.values()) if (t.n > 0 && now - t.at < 90000) n += t.n; return n; };
  // a manual Sign out with changes still unsent: the person chooses
  function askUnsent(u) { return new Promise((res) => { const old = document.getElementById("xwask"); if (old) old.remove(); const done = (v) => { box.remove(); res(v); }; const box = H("div", { id: "xwask", role: "alertdialog", "aria-modal": "true" }, H("div", { class: "sh-dcard" }, H("h3", {}, "Sign out with unsent changes?"), H("p", {}, u.n + " change" + (u.n === 1 ? " has" : "s have") + " not reached the workspace yet (" + words(u) + ")."), H("p", { class: "sh-dim", style: "font-size:12px" }, "“Send and sign out” waits until they are sent. “Download and sign out” gives you them as a file and signs out now; they are then not in the workspace."), H("div", { class: "sh-dbtns" }, H("span"), H("button", { "data-act": "xw-cancel", onclick: () => done("cancel") }, "Cancel"), H("button", { class: "quiet danger", "data-act": "xw-dlout", onclick: () => done("download") }, "Download and sign out"), H("button", { class: "primary", "data-act": "xw-send", onclick: () => done("send") }, "Send and sign out")))); document.body.append(box); }); }
  async function signOut(reason, opt) {
    opt = opt || {}; if (out || (leaving && !opt.follower)) return; const manual = reason === "user";
    if (manual && !opt.sure && !opt.follower) { let u = unsent(); if (u.n && u.n === u.writes) { await sleep(1500); u = unsent(); } /* a request already on its way is given a moment */ if (u.n) { const c = await askUnsent(u); if (c === "cancel") return; if (c === "download") { downloadUnsent(); opt.discard = true; } } }
    out = { reason, discard: !!opt.discard, follower: !!opt.follower, forget: !!opt.forget, resumed: false, tabs: new Map(), tries: 0, err: "", poke: null, busy: false }; leaving = true; clearInterval(ticker); closeWarn(); outCover();
    if (!out.follower) tellTabs({ t: "leaving", reason, from: TAB });
    let u = out.discard ? unsent() : await sendAll(8000); if (!out.follower) await sleep(700); /* the other tabs have answered by now */ let wait = 3000;
    while (!out.discard && !out.resumed && (u.n || othersDirty())) { outCover(u); if (out.follower) tellTabs({ t: "here", from: TAB, n: u.n }); await Promise.race([sleep(wait), new Promise((r) => { out.poke = r; })]); out.poke = null; if (out.resumed || out.discard) break; out.tries++; u = await sendAll(8000); wait = Math.min(Math.round(wait * 1.7), 60000); }
    if (out.resumed) { const why = out.reason; tellTabs({ t: "resume", from: TAB }); out = null; leaving = false; uncover(); stamp(why === "expired" || why === "ended"); wasIn = true; startClock(); SUITE.toast("Unlocked — what was waiting is still being sent"); setTimeout(() => { sendAll(8000).catch(() => {}); }, 300); return; }
    if (out.follower) { tellTabs({ t: "clean", from: TAB }); outCover(u, "Everything of this tab is sent. Waiting for the tab that signs out…"); return; } // the tab that signs out ends the session and says so
    outCover(unsent(), "Everything is sent. Clearing what this browser kept…");
    try { if (SUITE.messagesWipe && (CFG.forgetKeysOnSignOut || out.forget)) await SUITE.messagesWipe(); } catch (e) { /* best effort */ }
    try { const tok = get(DEV(sess().user_id || "")); if (tok && (CFG.forgetKeysOnSignOut || out.forget) && signedIn0()) await Promise.race([call("device_forget", { p_token: tok }), sleep(4000)]); } catch (e) { /* the token is deleted here in any case; in the workspace it expires */ }
    await endSession({ keys: out.forget, unsentToo: out.discard }); try { if (reason && reason !== "user") SS.setItem("xw.notice", reason); } catch (e) { /* storage refused */ }
    tellTabs({ t: "signout", reason }); location.replace(X.home());
  }
  // ---- the tabs of one browser: a sign-out anywhere signs every tab out — after every tab has sent what it had; a sign-in wakes a
  // tab that waits at the sign-in screen
  let bc = null; try { if (window.BroadcastChannel) bc = new BroadcastChannel("session"); } catch (e) { bc = null; }
  function tellTabs(m) { try { if (bc) bc.postMessage(m); } catch (e) { /* closed */ } }
  const otherTabLeft = (reason) => { if (out && !out.follower) return; const u = unsent(); if (u.n) { /* the session is gone and this tab still holds changes: they stay here, covered, with the copy on offer and a way back in */ if (out) { out.reason = "ended"; out.follower = false; outCover(u); if (out.poke) out.poke(); } else { leaving = false; signOut("ended"); } return; } leaving = true; for (const k of X.rawKeys("session")) SS.removeItem(k.slice(X.ns.length)); try { SS.setItem("xw.notice", reason === "user" ? "elsewhere" : reason || "elsewhere"); } catch (e) { /* storage refused */ } location.replace(X.home()); };
  if (bc) bc.onmessage = (e) => { const m = e.data || {}; if (m.from === TAB) return;
    if (m.t === "leaving") { if (!wasIn || out) return; tellTabs({ t: "here", from: TAB, n: unsent().n || 1 }); signOut(m.reason === "user" ? "elsewhere" : m.reason, { follower: true }); }
    else if (m.t === "here" && out && !out.follower) { out.tabs.set(m.from, { n: +m.n || 0, at: Date.now() }); outCover(); }
    else if (m.t === "clean" && out && !out.follower) { out.tabs.set(m.from, { n: 0, at: Date.now() }); if (out.poke) out.poke(); }
    else if (m.t === "resume" && out && out.follower) { out.resumed = true; if (out.poke) out.poke(); else { out = null; leaving = false; uncover(); startClock(); } }
    else if (m.t === "signout") otherTabLeft(m.reason); else if (m.t === "signin" && !wasIn && document.querySelector("#login.open")) location.reload(); };
  // without BroadcastChannel (older Safari) the storage event says the same: the session key went away
  window.addEventListener("storage", (e) => { if (e.key === X.ns + "xyntax.session" && e.oldValue && !e.newValue && wasIn) otherTabLeft("elsewhere"); });
  // why the page is at the sign-in screen, said once, quietly, on the card
  const NOTICE = { idle: "You were signed out after a while without activity.", expired: "This sign-in reached its time limit. Sign in again to continue.", ended: "Your session ended. Sign in again to continue.", elsewhere: "You signed out in another tab.", link: "That link was for another account. You are still signed in as before." };
  function notice() { let why = ""; try { why = SS.getItem("xw.notice") || ""; if (why) SS.removeItem("xw.notice"); } catch (e) { why = ""; } if (dropped) { dropped = false; setTimeout(() => SUITE.toast(NOTICE.link), 1500); } if (!why || !NOTICE[why]) return; const show = () => { const card = document.querySelector("#login.open .card"); if (!card || card.querySelector(".xw-note")) return !!card; card.append(H("div", { class: "xw-note", role: "status" }, NOTICE[why])); return true; }; if (!show()) { const mo = new MutationObserver(() => { if (show()) mo.disconnect(); }); mo.observe(document.getElementById("login"), { childList: true, attributes: true }); setTimeout(() => mo.disconnect(), 15000); } }

  // ---------- 3 · history: Back, Forward, Reload
  let idx = 0, cur = null, applying = false, skipPop = 0, homeSeen = false, lastDesc = "";
  const enc = (s) => encodeURIComponent(String(s)).replace(/%3A/gi, ":");
  function route() {
    const app = SUITE.nav.key(); if (!app || app === "home") return "";
    try {
      if (app === "accounting") { const v = typeof S !== "undefined" && S && S.view ? String(S.view) : ""; return "accounting" + (SEG.test(v) ? "/" + enc(v) : ""); }
      if (app === "proship" && window.PSNAV && PSNAV.current && typeof PS !== "undefined" && PS.state) { const c = PSNAV.current(); const s = PS.state; const v = s && s.vesselId ? String(s.vesselId) : ""; return "proship/" + enc(c.place) + "/" + enc(c.section) + (v && SEG.test(v) ? "/v/" + enc(v) : ""); }
      if (app === "settings") { const v = (lastDesc.split(":")[1] || ""); return "settings" + (SEG.test(v) ? "/" + enc(v) : ""); }
      if (app === "notes") { const m = /^pane:(.+)$/.exec(lastDesc); return "notes" + (m && SEG.test(m[1]) ? "/" + enc(m[1]) : ""); }
    } catch (e) { /* the app is still mounting */ }
    return app;
  }
  const href = (r) => location.pathname + location.search + (r ? "#!/" + r : "");
  function sync() {
    if (!homeSeen) return; const r = route(); if (cur !== null && r === cur) return;
    try { if (cur === null || applying) history.replaceState({ xw: idx, r }, "", href(r)); else history.pushState({ xw: ++idx, r }, "", href(r)); cur = r; } catch (e) { /* a locked-down history: the suite still works, Back leaves the page */ }
    title();
  }
  const later = () => { setTimeout(sync, 0); setTimeout(sync, 350); };
  function title() { const app = SUITE.nav.key(); const a = app && app !== "home" && SUITE.app ? SUITE.app(app) : null; const t = "XYNTAX" + (a && a.name ? " | " + a.name : ""); if (document.title !== t) document.title = t; }
  { const mark0 = SUITE.nav.mark.bind(SUITE.nav); SUITE.nav.mark = function (desc) { const r = mark0(desc); lastDesc = String(desc == null ? "" : desc); later(); return r; }; }
  { const home0 = SUITE.showHome.bind(SUITE); SUITE.showHome = function () { const r = home0(); lastDesc = ""; const firstTime = !homeSeen; homeSeen = true; if (firstTime) started(); else later(); return r; }; }
  { const open0 = SUITE.open.bind(SUITE); SUITE.open = function (id, opt) { lastDesc = ""; const r = open0(id, opt); later(); return r; }; }
  document.addEventListener("click", later, true); document.addEventListener("keyup", (e) => { if (e.key === "Enter" || e.key === "Escape" || e.key === "Backspace") later(); }, true);
  // a form with typing in it: the sheet or the dialog that is open and has taken input since it was drawn
  const FORMS = ["sheet", "shdlg"]; const mark = new WeakMap();
  const noteInput = (e) => { const t = e.target; if (!t || !t.closest) return; for (const id of FORMS) { const box = document.getElementById(id); if (box && box.contains(t) && !(t.type === "password" && box.id === "shdlg" && box.dataset.noback)) mark.set(box, box.firstElementChild); } };
  document.addEventListener("input", noteInput, true); document.addEventListener("change", noteInput, true);
  const dirtyForm = () => { for (const id of FORMS) { const box = document.getElementById(id); if (box && box.classList.contains("open") && mark.get(box) && mark.get(box) === box.firstElementChild) return box; } return null; };
  const floating = () => !!(document.querySelector("#xwprev, #shdlg.open, #sheet.open, .sh-enlarge, .expand, #shmenu, .sh-pal, .sh-pal-wrap, #shview.open") || (SUITE.NOTIFY && SUITE.NOTIFY.open));
  const waiting = () => unsent().n;
  X.unsaved = () => ({ form: !!dirtyForm(), waiting: waiting() });
  const discardOk = async () => { if (!dirtyForm()) return true; return !!(await ask("Leave this form?", "What you typed in it has not been saved.", "Discard", "Keep editing")); };
  // a question that does not use the suite's one dialog box (the form in question may be that dialog)
  function ask(titleText, text, ok, cancel) { return new Promise((res) => { const old = document.getElementById("xwask"); if (old) old.remove(); const done = (v) => { document.removeEventListener("keydown", key, true); box.remove(); res(v); }; const key = (e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); done(false); } }; const yes = H("button", { class: "primary danger", "data-act": "xw-yes", onclick: () => done(true) }, ok); const box = H("div", { id: "xwask", role: "alertdialog", "aria-modal": "true" }, H("div", { class: "sh-dcard" }, H("h3", {}, titleText), H("p", {}, text), H("div", { class: "sh-dbtns" }, H("span"), H("button", { "data-act": "xw-no", onclick: () => done(false) }, cancel), yes))); document.addEventListener("keydown", key, true); document.body.append(box); setTimeout(() => { try { box.querySelector('[data-act="xw-no"]').focus(); } catch (e) { /* no focus */ } }, 30); }); }
  X.ask = ask;
  async function go(target, dir) {
    const t = target ? parse("#!/" + target) : null; const app = t ? t.app : "home"; const here2 = SUITE.nav.key();
    if (app === "home" || !t) { if (here2 !== "home") SUITE.showHome(); return; }
    const known = app === "accounting" || (SUITE.apps && SUITE.apps[app]); if (!known || !SUITE.allowed(app)) { if (here2 !== "home") SUITE.showHome(); return; }
    if (app === "accounting") { SUITE.open("accounting", t.parts[0] ? { view: t.parts[0] } : undefined); return; }
    if (app === "proship") { if (here2 !== "proship") { SUITE.open("proship"); await sleep(60); } if (SUITE.current !== "proship" || !window.PSNAV) return; const [place, section, v, vid] = t.parts; if (v === "v" && vid && PSNAV.openVessel && PSNAV.openVessel(vid)) return; if (place && PSNAV.openSection) PSNAV.openSection(place, section, { clearVessel: true }); return; }
    if (app === "settings") { if (here2 !== "settings") SUITE.open("settings", t.parts[0] ? { view: t.parts[0] } : undefined); else if (SUITE.apps.settings && SUITE.apps.settings.open && t.parts[0]) SUITE.apps.settings.open({ view: t.parts[0] }); await sleep(120); return; }
    if (here2 === app) { if (dir < 0) SUITE.back({ fromHistory: true }); else if (app === "notes" && t.parts[0] && SUITE.apps.notes.open) SUITE.apps.notes.open({ page: t.parts[0] }); return; }
    SUITE.open(app, app === "notes" && t.parts[0] ? { page: t.parts[0] } : undefined); await sleep(300);
  }
  window.addEventListener("popstate", async (e) => {
    if (skipPop > 0) { skipPop--; return; } if (!homeSeen || leaving) return;
    const st = e.state && typeof e.state.xw === "number" ? e.state : null; const target = st ? st.r : ((parse(location.hash) || {}).app ? location.hash.slice(3) : ""); const to = st ? st.xw : idx - 1; const dir = to < idx ? -1 : 1;
    // something floats over the page (a form, a dialog, a menu, a preview): Back closes that, and the page stays where it is
    if (floating()) { skipPop++; try { history.go(-dir); } catch (x) { skipPop--; } if (dir > 0) return; const pv = document.getElementById("xwprev"); if (pv) { pv._close(); return; } if (!(await discardOk())) return; mark.delete(document.getElementById("sheet")); mark.delete(document.getElementById("shdlg") || document.body); SUITE.back({ fromHistory: true }); later(); return; }
    idx = to; applying = true; try { await go(target, dir); } catch (x) { console.error(x); } finally { await sleep(0); cur = null; applying = true; sync(); applying = false; }
  });
  // once the home is up: the place the address named (a reload, a bookmark) — only an app this person may open, never an address
  async function started() {
    cur = null; idx = (history.state && typeof history.state.xw === "number") ? history.state.xw : 0; const want = first && !(first.app === "home") ? first : null;
    if (want) { applying = true; try { await sleep(30); await go([want.app, ...want.parts.map(enc)].join("/"), 1); await sleep(400); } catch (e) { console.error(e); } finally { applying = true; cur = null; sync(); applying = false; } } else sync();
    if (late) { const why = late; late = ""; signOut(why); return; }
    stamp(false); startClock(); if (signedIn()) { gate().then((ok) => { if (!ok) signOut("user"); else if (CLOUD.mfa.aal() === "aal2" && !get(DEV(sess().user_id || ""))) remember(); /* a session that already has the code (from before 4.34.5, or stepped up later): this browser is remembered from now on */ }); } askNotify();
  }
  // with or without a session: why the page is at the sign-in screen, and the first look at the published version
  // a session at password level found when the page loads: the second step first, then — and only then — the program starts
  const loadScreen = (on) => { try { if (typeof window.xyntaxLoading === "function") window.xyntaxLoading(on); } catch (e) { /* app.js not there yet */ } };
  async function release() { held = false; try { if (typeof bootCloud !== "function" || typeof bootPersonal !== "function") throw new Error("no boot"); loadScreen(true); document.getElementById("login").classList.remove("open"); CLOUD.restoreWho();
    // a session that arrived in the address has no company yet (the sign-in card chooses one after a password): the only company is taken, several are offered
    if (hashTok && !sess().org_id) { let orgs = []; try { orgs = (await CLOUD.myOrgs()) || []; } catch (e) { orgs = []; } if (orgs.length === 1) CLOUD.chooseOrg(orgs[0]); else if (orgs.length > 1 && typeof showLogin === "function") { showLogin(orgs); return; } }
    if (CLOUD.active()) await bootCloud(); else if (sess().isOwner && !sess().personalMode && typeof bootOwnerConsole === "function") await bootOwnerConsole(); else await bootPersonal(); loadScreen(false); } catch (e) { console.error(e); let again = true; try { again = !SS.getItem("xw.rl"); SS.setItem("xw.rl", "1"); setTimeout(() => SS.removeItem("xw.rl"), 15000); } catch (x) { again = false; } if (again) location.reload(); } }
  // (the session of an accepted link is stored by app.js a moment after this file ran: the second step waits for it)
  const arrived = async () => { for (let i = 0; i < 60 && !signedIn(); i++) await sleep(100); return signedIn(); };
  const boot = () => { notice(); setTimeout(checkVersion, T.versionFirstMs); title(); if (arriving) { const l = arriving; arriving = null; askLink(l); } if (held && !late && !setting) arrived().then((there) => { if (!there) { held = false; return null; } if (get(DEV(sess().user_id || ""))) loadScreen(true); /* a remembered browser: the question takes a moment; the sign-in card is not flashed meanwhile */ return gate().then((ok) => (ok ? release() : signOut("user", { sure: true }))); }).catch(() => signOut("user", { sure: true })); }; if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else setTimeout(boot, 0);
  // the workspace's fresh answer about the person's apps arrives after the page is up (the last answer opens it at once): an app
  // that was taken away in the meantime is left, whether a reload or a link brought the person there
  window.addEventListener("cloud-who", () => { try { const app = SUITE.nav.key(); if (homeSeen && app && app !== "home" && !SUITE.allowed(app)) { SUITE.showHome(); SUITE.toast("That app is not enabled for your user any more"); } } catch (e) { /* still starting */ } });
  // leaving the page (close, reload, another address): the browser asks first when a form has typing in it or a save is still on its way
  window.addEventListener("beforeunload", (e) => { if (leaving && !(out && unsent().n)) return; const u = X.unsaved(); if (!u.form && !u.waiting) return; try { if (SUITE.db && SUITE.db.flushAll) SUITE.db.flushAll(); if (window.UPD && UPD.flush) UPD.flush(4000); } catch (x) { /* best effort */ } e.preventDefault(); e.returnValue = ""; });

  // ---------- 4 · a newer build is published: say so; the person reloads when it suits them
  let verBar = null, verSeen = "";
  async function reload() { if (dirtyForm() && !(await ask("Reload now?", "A form is open with typing in it; it is not saved by a reload.", "Reload", "Not yet"))) return; SUITE.toast("Sending what waits, then reloading…"); const u = await sendAll(8000); if (u.n) { SUITE.toast(u.n + " change" + (u.n === 1 ? " is" : "s are") + " still being sent (" + words(u) + ") — not reloading yet. Try again in a moment."); return; } leaving = true; X.reloadFresh(); }
  function versionBar(p) { if (verBar || (p && p.build === verSeen)) return; verBar = H("div", { id: "xwver", class: "updbar", role: "status" }, "A new version of XYNTAX is available" + (p && p.version && p.version !== CFG.version ? " (" + p.version + ")" : "") + ". ", H("button", { class: "primary", "data-act": "xw-reload", onclick: reload }, "Reload"), H("button", { class: "quiet", onclick: () => { verSeen = (p && p.build) || ""; verBar.remove(); verBar = null; } }, "Later")); document.body.append(verBar); }
  window.addEventListener("xw-version", (e) => versionBar(e.detail));
  let verAt = 0; function checkVersion() { if (leaving || Date.now() - verAt < 30000) return; verAt = Date.now(); window.xyntax.updateCheck().catch(() => {}); }
  X.checkVersion = () => { verAt = 0; return window.xyntax.updateCheck(); };
  setInterval(() => { if (!document.hidden) checkVersion(); }, Math.max(1000, T.versionMs)); document.addEventListener("visibilitychange", () => { if (!document.hidden && Date.now() - verAt > 60000) checkVersion(); });

  // ---------- 5 · keys a browser keeps for itself. Ctrl+N / Ctrl+T / Ctrl+W never reach a page: Alt+N is "new" here. Ctrl+S would
  // save the page as a file — everything is saved as you go, so it does nothing. Ctrl+P with a document preview open prints it.
  document.addEventListener("keydown", (e) => {
    const k = String(e.key || "").toLowerCase(); const mod = e.ctrlKey || e.metaKey;
    if (mod && !e.altKey && k === "s") { e.preventDefault(); return; }
    if (mod && !e.altKey && k === "p" && document.getElementById("xwprev")) { e.preventDefault(); e.stopPropagation(); const b = document.querySelector("#xwprev button.primary"); if (b) b.click(); return; }
    if (e.altKey && !mod && k === "n" && !floating()) { e.preventDefault(); document.dispatchEvent(new KeyboardEvent("keydown", { key: "n", code: "KeyN", ctrlKey: true, bubbles: true, cancelable: true })); }
  }, true);

  // ---------- 6 · notifications: the browser's permission question only on a click, never by itself
  if (window.Notification && Notification.requestPermission) { const real = Notification.requestPermission.bind(Notification); X.notifyAsks = 0; const ask0 = () => { X.notifyAsks++; return real(); }; let allow = false; Notification.requestPermission = function (cb) { const p = allow || (navigator.userActivation && navigator.userActivation.isActive) ? ask0() : Promise.resolve(Notification.permission); if (typeof cb === "function") p.then(cb); return p; }; X.allowNotifications = async () => { allow = true; try { return await ask0(); } finally { allow = false; } }; }
  function askNotify() { try { if (!window.Notification || Notification.permission !== "default" || !signedIn() || get("xw.notifyAsked")) return; } catch (e) { return; } setTimeout(() => { if (leaving || document.getElementById("xwnotify") || floating() || !document.querySelector("#home.open")) return; const bar = H("div", { id: "xwnotify", class: "updbar", role: "status" }, "Show reminders and messages as browser notifications? ", H("button", { class: "primary", onclick: async () => { set("xw.notifyAsked", "1"); bar.remove(); const r = await X.allowNotifications(); SUITE.toast(r === "granted" ? "Notifications are on" : "Notifications stay off — the browser's site settings can change that"); } }, "Allow"), H("button", { class: "quiet", onclick: () => { set("xw.notifyAsked", "1"); bar.remove(); } }, "Not now")); document.body.append(bar); }, 9000); }

  // ---------- 7 · DOCUMENTS: the files out for editing (web-bridge.js §6)
  function tray() {
    let box = document.getElementById("xwedits"); const list = [...X.edits.values()]; if (!list.length) { if (box) box.remove(); return; }
    if (!box) { box = H("div", { id: "xwedits", role: "region", "aria-label": "Files being edited" }); document.body.append(box); } box.innerHTML = "";
    box.append(H("div", { class: "xw-eh" }, "Editing outside XYNTAX"), ...list.map((e) => H("div", { class: "xw-er", "data-id": e.id }, H("div", { class: "xw-en" }, H("b", {}, e.name), H("span", {}, e.error ? e.error : e.mode === "handle" ? (e.saves ? "saved back " + e.saves + "×" : "saves come back here while this tab is open") : (e.saves ? "uploaded " + e.saves + "×" : "downloaded — edit it, then upload it"))), e.mode === "upload" ? H("button", { class: "primary", "data-act": "xw-upload", onclick: () => X.uploadEdited(e.id) }, "Upload edited copy…") : null, H("button", { class: "quiet", "data-act": "xw-done", onclick: () => X.stopEdit(e.id) }, "Done"))),
      H("div", { class: "xw-eq" }, X.canHandle() ? "A browser cannot start Word or Excel: open the saved file from its folder." : "This browser cannot watch a file on the computer: bring your changes back with Upload."));
  }
  window.addEventListener("xw-edits", (e) => { if (e && e.detail === "save") touch(true); /* M4 · a save coming back from Word or Excel is the person working */ tray(); });

  // ---------- 8 · places whose words are the desktop's. The same pages, with what is true in a browser.
  const fix = () => {
    // ACCOUNTING → Data → Storage: there is no data file here
    const dp = document.getElementById("dataPath"); if (dp && !dp.dataset.xw) { dp.dataset.xw = "1"; const info = dp.parentElement; const panel = info && info.parentElement; if (info) info.textContent = "In the browser the book lives in the company workspace and is saved after every change; nothing is kept as a file on this computer. “Export book only” gives you a single file you can keep or import elsewhere."; if (panel) for (const b of panel.querySelectorAll("button")) if (/^(Back up now|Open data folder)$/.test(b.textContent.trim())) b.remove(); }
    // the sign-in card: no installer to look for
    for (const a of document.querySelectorAll("#login .card a.faint")) if (a.textContent.trim() === "Check for updates") a.remove();
    // SETTINGS → About / Software update: no installer, no graphics-card switch
    for (const b of document.querySelectorAll("#sapp.open button")) { const t = b.textContent.trim(); if (t === "Try the GPU again" || t === "Restart with the GPU" || t === "Install update from file…") { const row = t === "Install update from file…" ? b.closest(".sh-panel, .st-panel, section") : null; (row || b).remove(); } }
    for (const d of document.querySelectorAll("#sapp.open .sh-h1 .sh-dim, #sapp.open h1 + .sh-dim, #sapp.open .st-sub")) if (/desktops install updates themselves/.test(d.textContent)) d.textContent = "this copy is " + CFG.version + " · the browser always loads the published version; a bar appears when a newer one is out";
    // the home of a person without a company: a company that was never moved to the workspace is not here
    const home = document.querySelector("#home.open"); if (home && signedIn() && !sess().org_id && !(CLOUD.state.memberships || []).length && !home.querySelector(".xw-local")) { const grid = home.querySelector(".sh-tiles, .sh-grid, .sh-home") || home.firstElementChild; if (grid) grid.after(H("div", { class: "xw-local", role: "note" }, "A company that lives on one computer (never signed in to the workspace) is not available in the browser. Open XYNTAX on that computer and sign in there to bring it along.")); }
    companyPolicy(); forgetPanel();
  };
  // M5 · SETTINGS → Security and privacy: what this browser keeps of MESSAGES after a sign-out, and the way to remove it
  function forgetPanel() { const main = document.querySelector("#sapp.open"); if (!main || document.body.dataset.app !== "settings" || main.querySelector(".xw-forget") || !/:security$/.test(lastDesc)) return; const host = main.querySelector(".st-main, .sh-main, main") || main.querySelector(".sh-body"); if (!host) return;
    host.append(H("div", { class: "sh-panel xw-policy xw-forget" }, H("h3", {}, "This browser"), H("div", { class: "sh-dim", style: "margin-bottom:8px" }, CFG.forgetKeysOnSignOut ? "Signing out here removes everything XYNTAX kept in this browser, the keys of your conversations included." : "Signing out clears the session and every copy of your data in this browser. Two things stay: this browser's keys for MESSAGES and the sealed history they open (as on the desktop), so that your conversations are still readable when you sign in here again — and the mark that this browser has already given your authenticator code, so that the next sign-in here asks for the password only. On a computer that is not yours, remove both."),
      H("label", { class: "xw-row" }, H("span", {}, "Forget this browser", H("small", {}, "signs you out, deletes this browser's message keys and history, and asks for the authenticator code here again; your other devices keep theirs")), H("button", { class: "quiet danger", "data-act": "xw-forget", onclick: async () => { if (await ask("Forget this browser?", "You are signed out, and the keys and history of your conversations kept in this browser are deleted. Conversations stay readable on your other devices; this browser starts afresh at the next sign-in, authenticator code included.", "Sign out and forget", "Cancel")) signOut("user", { forget: true }); } }, "Forget this browser")),
      (() => { const n = H("small", {}, "…"); const btn = H("button", { class: "quiet", "data-act": "xw-forget-all", disabled: true, onclick: async () => { if (!(await ask("Forget every remembered browser?", "Every browser that is remembered for your account — this one too — is asked for the authenticator code at its next sign-in. Nobody is signed out now.", "Forget all", "Cancel"))) return; try { const r = await call("device_forget_all", {}); if (!r.ok) throw new Error("The workspace did not answer (" + r.status + ")"); set(DEV(sess().user_id || ""), null); trustedSid = ""; SUITE.toast("Forgotten — the code is asked for at the next sign-in"); load(); } catch (e) { SUITE.toast(e.message); } } }, "Forget all");
        const load = async () => { try { const r = await call("device_list", {}); if (!r.ok) throw new Error(String(r.status)); const list = (await r.json()) || []; n.textContent = list.length ? list.length + " remembered" + (list.length ? " — " + list.slice(0, 3).map((d) => d.label || "a browser").join(", ") + (list.length > 3 ? "…" : "") : "") + " · a remembered browser is asked for the password only, for 90 days" : "none remembered — a browser is remembered once it has given the authenticator code"; btn.disabled = !list.length; } catch (e) { n.textContent = "not available in this workspace yet"; btn.disabled = true; } };
        load(); return H("label", { class: "xw-row xw-devices" }, H("span", {}, "Signed-in browsers", n), btn); })())); }
  let fixT = null; new MutationObserver(() => { clearTimeout(fixT); fixT = setTimeout(fix, 60); }).observe(document.body, { childList: true, subtree: true });

  // ---------- 9 · SETTINGS → Company → Security: the browser sign-in policy (administrators)
  function companyPolicy() {
    const main = document.querySelector("#sapp.open"); if (!main || document.body.dataset.app !== "settings" || main.querySelector(".xw-policy") || !/:company_security$/.test(lastDesc) || !CLOUD.active()) return;
    const host = main.querySelector(".st-main, .sh-main, main") || main.querySelector(".sh-body"); if (!host) return; const org = sess().org_id; const admin = CLOUD.state.role === "admin" || CLOUD.state.isOwner;
    const box = H("div", { class: "sh-panel xw-policy" }, H("h3", {}, "Browser sign-in"), H("div", { class: "sh-dim" }, "Loading…")); host.append(box);
    CLOUD.orgSettings(org).then((s) => {
      const save = async (patch) => { try { const now = (await CLOUD.setOrgSettings(org, patch)) || {}; const k = Object.keys(patch)[0]; if (patch[k] === 0 && +now[k] > 0) { SUITE.toast("Not switched off — this workspace's admin function is older than 4.34.5 and keeps " + now[k] + (k === "webIdleMinutes" ? " minutes" : " hours")); const el = k === "webIdleMinutes" ? idle : life; el.value = String(now[k]); } else SUITE.toast("Saved"); CLOUD.whoami(); } catch (e) { SUITE.toast(e.message); } };
      const mfa = H("input", { type: "checkbox", checked: s.webMfaRequired !== false ? true : null, disabled: admin ? null : true, onchange: () => save({ webMfaRequired: mfa.checked }) });
      const idle = H("select", { disabled: admin ? null : true, onchange: () => save({ webIdleMinutes: +idle.value }) }, [0, 10, 15, 30, 60, 120, 240].map((n) => H("option", { value: n, selected: (+s.webIdleMinutes || 0) === n ? true : null }, n ? n + " minutes" : "Off")));
      const life = H("select", { disabled: admin ? null : true, onchange: () => save({ webSessionHours: +life.value }) }, [0, 4, 8, 12, 24, 48].map((n) => H("option", { value: n, selected: (+s.webSessionHours || 0) === n ? true : null }, n ? n + " hours" : "Off")));
      box.lastChild.remove(); box.append(H("div", { class: "sh-dim", style: "margin-bottom:8px" }, "For people who open XYNTAX in a web browser (" + X.home().replace(/^https?:\/\//, "") + "). The desktop and phone apps are not affected."),
        H("label", { class: "xw-row" }, mfa, H("span", {}, "Require two-step verification for browser sign-in", H("small", {}, "an authenticator code after the password; a person without an authenticator sets one up at the first browser sign-in"))),
        H("label", { class: "xw-row" }, H("span", {}, "Sign out after no activity for", H("small", {}, "Off: nobody is signed out for being away")), idle), H("label", { class: "xw-row" }, H("span", {}, "Sign in again at least every", H("small", {}, "Off: a sign-in lasts until Sign out, as on the desktop")), life),
        admin ? null : H("div", { class: "sh-dim", style: "margin-top:6px" }, "Only an administrator of the company changes these."));
    }).catch((e) => { box.lastChild.textContent = e.message; });
  }
})();
