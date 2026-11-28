/* XYNTAX — cloud mode. The book lives as one versioned document per organisation in a Supabase project;
 * users sign in with email + password; attachments go to the project's storage bucket.
 * Nothing here knows about trades: it moves the whole store up and down, and guards against two people
 * saving over each other with a version number checked by the database (save_book function). */
const CLOUD = {
  // 4.7 · pinned transport: the client talks to the configured workspace, the configured mail bridge, the release host and
  // hosts a person has explicitly linked (a calendar feed) — nothing else, whatever a page or an extension asks for.
  // The content-security policy says the same thing to the browser; this is the belt to that brace, and it names the refusal.
  PINNED: true,
  RELEASE_HOSTS: ["api.github.com", "github.com", "objects.githubusercontent.com", "release-assets.githubusercontent.com"],
  // 4.30 · the weather services the map reads (coordinates only, no key, no account)
  OPEN_HOSTS: ["marine-api.open-meteo.com", "api.open-meteo.com", "geocoding-api.open-meteo.com"],
  _allowed: new Set(),
  allowHost(h) { if (h) { this._allowed.add(String(h).toLowerCase()); if (typeof SUITE !== "undefined" && SUITE.host && SUITE.host.allowHost) { try { SUITE.host.allowHost(String(h).toLowerCase()); } catch (e) { /* desktop only */ } } } },
  allowed(url) {
    if (!this.PINNED) return true; let u; try { u = new URL(url, location.href); } catch (e) { return false; }
    if (u.protocol === "data:" || u.protocol === "blob:" || u.origin === location.origin) return true; if (u.protocol !== "https:" && u.protocol !== "http:") return false;
    const h = u.host.toLowerCase(); const c = this.cfg(); if (c && c.url) { try { if (new URL(c.url).host.toLowerCase() === h) return true; } catch (e) { /* no */ } }
    const bridge = (typeof localStorage !== "undefined" && localStorage.getItem("xyntax.mail.bridge")) || (typeof CLOUD_CONFIG !== "undefined" && CLOUD_CONFIG.bridge) || ""; if (bridge) { try { if (new URL(bridge).host.toLowerCase() === h) return true; } catch (e) { /* no */ } }
    if (/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(h)) return true; /* development and the test harness */
    return this.RELEASE_HOSTS.includes(h) || this.OPEN_HOSTS.includes(h) || this._allowed.has(h);
  },
  origin(u) { try { return new URL(String(u || "").trim()).origin; } catch (e) { return String(u || "").trim().replace(/\/(rest|auth|storage|functions)\/v1.*$/, "").replace(/\/$/, ""); } },
  baked() { return typeof CLOUD_CONFIG !== "undefined" && CLOUD_CONFIG.url && CLOUD_CONFIG.key ? { url: this.origin(CLOUD_CONFIG.url), key: String(CLOUD_CONFIG.key).trim(), baked: true } : null; },
  cfg() { const b = this.baked(); if (b) return b; try { const c = JSON.parse(localStorage.getItem("xyntax.cloud") || "null"); if (c && c.url) c.url = this.origin(c.url); return c; } catch (e) { return null; } },
  setCfg(c) { if (c) localStorage.setItem("xyntax.cloud", JSON.stringify(c)); else localStorage.removeItem("xyntax.cloud"); },
  session() { try { return JSON.parse(localStorage.getItem("xyntax.session") || "null"); } catch (e) { return null; } },
  setSession(s) { if (s) localStorage.setItem("xyntax.session", JSON.stringify(s)); else localStorage.removeItem("xyntax.session"); },
  active() { return !!(this.cfg() && this.cfg().url && this.session() && this.session().access_token && this.session().org_id); },
  signedIn() { return !!(this.cfg() && this.session() && this.session().access_token); },
  state: { version: 0, role: null, org: null, orgName: "", email: "", lastSync: null, error: null, polling: null, isOwner: false, memberships: [], online: true, lastError: "" },
  setOnline(on, why) { const was = this.state.online; this.state.online = !!on; this.state.lastError = on ? "" : (why || "No connection"); if (was !== !!on && typeof renderStatus === "function") renderStatus(); },
  // 4.34 · a change that weakens security is refused without the authenticator code in this session (code "aal2_required"):
  // the code is asked for here and the call made once more; without an authenticator the answer says to set one up first
  async admin(action, payload, again) { const r = await this.req("/functions/v1/admin", { method: "POST", body: JSON.stringify({ action, ...(payload || {}) }) }); let j = null; try { j = await r.json(); } catch (e) { j = { error: "No response from the admin function (is it deployed?)" }; }
    if (j && j.code === "aal2_required" && !again && !j.enrol && this.mfa && typeof this.mfa.prompt === "function") { const f = await this.mfa.verifiedFactor().catch(() => null); if (f && (await this.mfa.stepUp(f.id))) return this.admin(action, payload, true); throw new Error("Not changed — the authenticator code is needed"); }
    if (!r.ok || (j && j.error)) throw new Error((j && j.error) || ("Admin call failed: " + r.status)); return j; },
  touchSeen() { try { this.req("/rest/v1/rpc/touch_seen", { method: "POST", body: "{}" }).catch(() => {}); } catch (e) { /* nothing */ } },
  async whoami() { this.touchSeen(); try { const w = await this.admin("whoami"); const before = JSON.stringify([this.state.isOwner, this.state.memberships]); this.state.isOwner = !!w.isOwner; this.state.memberships = w.memberships || []; this.state.mfa = w.mfa || null; const s = this.session(); this.setSession({ ...s, isOwner: !!w.isOwner, memberships: this.state.memberships, mfa: w.mfa || null }); if (before !== JSON.stringify([this.state.isOwner, this.state.memberships])) { try { window.dispatchEvent(new CustomEvent("cloud-who", { detail: w })); } catch (e) { /* nothing */ } } return w; } catch (e) { this.state.isOwner = !!(this.session() || {}).isOwner; return null; } },
  // 4.8 · what the last whoami said, from the session, so the home can be drawn before the network answers; the fresh answer follows
  restoreWho() { const s = this.session() || {}; this.state.isOwner = !!s.isOwner; if (Array.isArray(s.memberships)) this.state.memberships = s.memberships; if (s.mfa) this.state.mfa = s.mfa; return !!(s.memberships); },
  // 4.8 · one "me" for everyone who needs it (the boot, the security poll, the notification badges): a call within 20 s shares the answer
  _me: null, _meAt: 0,
  me(force) { const fresh = this._me && !force && Date.now() - this._meAt < 20000; if (fresh) return this._me; this._meAt = Date.now(); this._me = this.account("me").then((m) => { this.state.myQuota = m.quota_gb; this.state.myName = m.name; this.state.meRow = m; return m; }).catch((e) => { this._me = null; throw e; }); return this._me; },

  headers(auth) { const c = this.cfg(); const s = this.session(); const h = { apikey: c.key, "Content-Type": "application/json" }; if (auth !== false && s && s.access_token) h.Authorization = "Bearer " + s.access_token; return h; },
  // one transport for every call to the workspace: on the desktop the main process (no preflight, pooled connections);
  // elsewhere the page's fetch (on Android, Capacitor's native HTTP when enabled)
  async transport(url, init) {
    init = init || {};
    if (window.xyntax && window.xyntax.fetchRaw && /^https:/i.test(url)) {
      let body = init.body; if (body != null && typeof body !== "string") { if (body instanceof Blob) body = new Uint8Array(await body.arrayBuffer()); else if (body instanceof ArrayBuffer) body = new Uint8Array(body); else if (ArrayBuffer.isView(body)) body = new Uint8Array(body.buffer, body.byteOffset, body.byteLength); else body = String(body); }
      const hs = {}; if (init.headers) { if (init.headers instanceof Headers) init.headers.forEach((v, k) => { hs[k] = v; }); else Object.assign(hs, init.headers); }
      const r = await window.xyntax.fetchRaw(url, { method: init.method || "GET", headers: hs, body });
      if (r && r.error && r.status == null) throw new TypeError(r.error);
      return new Response(r.status === 204 || r.status === 304 ? null : r.body, { status: r.status, headers: r.headers });
    }
    // 4.31.4 · reads never come from or go to the WebView's HTTP cache
    const method = String(init.method || "GET").toUpperCase(); if (method === "GET" && !init.cache) init = { ...init, cache: "no-store" };
    try { return await fetch(url, init); }
    catch (e) {
      // 4.31.4 · on Android, GETs pass through Capacitor's WebView interceptor; when it cannot hand the answer over (net error after the
      // server replied) the same request goes once through the native plugin call the app's POSTs already use
      const nat = method === "GET" && /^https:/i.test(url) && typeof window !== "undefined" && window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.CapacitorHttp;
      if (!nat || (e && e.name === "AbortError")) throw e;
      const hs = {}; if (init.headers) { if (typeof Headers !== "undefined" && init.headers instanceof Headers) init.headers.forEach((v, k) => { hs[k] = v; }); else Object.assign(hs, init.headers); }
      try { console.warn("XYNTAX: WebView fetch failed (" + (e && e.name) + ": " + (e && e.message) + "), retrying natively: " + url.replace(/\?.*$/, "")); } catch (x) { /* no console */ }
      const r = await nat.request({ url, method: "GET", headers: hs, responseType: "text", connectTimeout: 30000, readTimeout: 60000 });
      const body = r.status === 204 ? null : typeof r.data === "string" ? r.data : JSON.stringify(r.data);
      return new Response(body, { status: r.status, headers: r.headers || {} });
    }
  },
  // 4.31.4 · a paged pull of rows: limit/offset in the query (no Range header), one request in flight, ≥ 60 s per page, each page tried
  // three times (1 s, 3 s apart); a failure names the step and the page: "PROSHIP records page 2 of HARBOUR CO: Failed to fetch after 3 tries"
  async pull(path, what, opt) {
    opt = opt || {}; const page = opt.page || 1000; const out = []; const who = (this.session() || {}).org_name || "this company";
    for (let from = 0, n = 1; ; from += page, n++) {
      let rows = null, last = null;
      for (let t = 1; t <= 3 && rows == null; t++) {
        const ctl = typeof AbortController !== "undefined" ? new AbortController() : null; const timer = ctl ? setTimeout(() => ctl.abort(), opt.timeout || 60000) : null;
        try {
          const r = await this.req(path + "&limit=" + page + "&offset=" + from, { cache: "no-store", headers: { Prefer: "count=none" }, ...(ctl ? { signal: ctl.signal } : {}) });
          if (!r.ok) { const txt = (await r.text()).slice(0, 200); const err = new Error(txt || ("HTTP " + r.status)); err.status = r.status; if (r.status < 500 && r.status !== 408 && r.status !== 429) { err.final = true; throw err; } throw err; }
          rows = await r.json(); if (!Array.isArray(rows)) throw new Error("the answer was not a list");
        } catch (e) {
          last = e; try { console.warn("XYNTAX pull " + what + " page " + n + " try " + t + ": " + (e && e.name) + ": " + (e && e.message)); } catch (x) { /* no console */ }
          if (e && e.final) break; if (t < 3) await new Promise((res) => setTimeout(res, t === 1 ? 1000 : 3000));
        } finally { if (timer) clearTimeout(timer); }
      }
      if (rows == null) { const why = String(last && (last.name === "AbortError" || /\babort/i.test(last.message || "")) ? "no answer within " + Math.round((opt.timeout || 60000) / 1000) + " s" : ((last && last.message) || last || "unknown")).replace(/^Offline:\s*/, "").replace(/^The workspace did not answer \((.*)\)\.?$/, "$1"); const err = new Error(what + " page " + n + " of " + who + ": " + why + (last && last.final ? "" : " after 3 tries")); err.offline = !(last && last.final); try { console.error("XYNTAX " + err.message + " (" + ((last && last.name) || "Error") + ": " + ((last && last.message) || "") + ")"); } catch (x) { /* no console */ } throw err; }
      out.push(...rows); if (rows.length < page || from > 200000) break;
    }
    return out;
  },
  async req(path, opt, retry) {
    if (typeof SUITE !== "undefined" && SUITE.perf) SUITE.perf.reqs++;
    const c = this.cfg(); let r; try { r = await this.transport(c.url.replace(/\/$/, "") + path, { ...(opt || {}), headers: { ...this.headers(), ...((opt && opt.headers) || {}) } }); } catch (e) { this.setOnline(false, navigator.onLine === false ? "This computer has no internet connection." : "The workspace did not answer (" + e.message + ")."); throw new Error("Offline: " + this.state.lastError); }
    if (r.status >= 500) this.setOnline(false, "The workspace returned an error (" + r.status + ")."); else this.setOnline(true);
    if (r.status === 401 && retry !== false && this.session() && this.session().refresh_token) { const ok = await this.refresh(); if (ok) return this.req(path, opt, false); }
    return r;
  },
  USER_DOMAIN: "users.xyntax.local",
  toEmail(u) { u = String(u || "").trim().toLowerCase(); return u.includes("@") ? u : u.replace(/[^a-z0-9._-]/g, "") + "@" + this.USER_DOMAIN; },
  shown(email) { email = String(email || ""); return email.endsWith("@" + this.USER_DOMAIN) ? email.split("@")[0] : email; },
  async login(email, password) {
    email = this.toEmail(email);
    const c = this.cfg(); if (!c || !c.url || !c.key) throw new Error("Cloud is not configured on this computer");
    const r = await this.transport(c.url.replace(/\/$/, "") + "/auth/v1/token?grant_type=password", { method: "POST", headers: { apikey: c.key, "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
    const j = await r.json(); if (!r.ok) throw new Error(j.error_description || j.msg || j.message || "Sign-in failed");
    if (j.user && j.user.app_metadata && j.user.app_metadata.role === "portal") { try { await this.transport(c.url.replace(/\/$/, "") + "/auth/v1/logout", { method: "POST", headers: { apikey: c.key, Authorization: "Bearer " + j.access_token } }); } catch (e) { /* the token simply expires */ } throw new Error("This is a vessel-portal login, not a XYNTAX user. Open the portal instead: " + this.portal.url()); }
    this.setSession({ access_token: j.access_token, refresh_token: j.refresh_token, user_id: j.user.id, email: j.user.email });
    // 4.16 · a verified authenticator means the password alone is half a sign-in: ask for the code (or a recovery code) now
    const factor = (j.user.factors || []).find((f) => f.status === "verified" && (f.factor_type === "totp" || !f.factor_type));
    if (factor) { const done = await this.mfa.stepUp(factor.id); if (!done) { this.setSession(null); throw new Error("Sign-in cancelled — the authenticator code is needed"); } }
    const [, orgs] = await Promise.all([this.whoami(), this.myOrgs()]); return orgs; // none is fine since 4.4: the personal apps work without a company
  },
  // ---------- accounts (4.4): anyone may create one; the personal apps are theirs, a company is something they create or are invited to
  async signUp(email, password, name) {
    const c = this.cfg(); if (!c || !c.url || !c.key) throw new Error("Cloud is not configured on this computer");
    const r = await this.transport(c.url.replace(/\/$/, "") + "/auth/v1/signup", { method: "POST", headers: { apikey: c.key, "Content-Type": "application/json" }, body: JSON.stringify({ email: String(email).trim().toLowerCase(), password, data: { name: name || "" } }) });
    const j = await r.json(); if (!r.ok) throw new Error(j.error_description || j.msg || j.message || "Could not create the account");
    if (j.access_token) { this.setSession({ access_token: j.access_token, refresh_token: j.refresh_token, user_id: j.user.id, email: j.user.email }); return { confirmed: true }; }
    return { confirmed: false }; // the confirmation email is on its way
  },
  async recoverPassword(email) { const c = this.cfg(); const r = await this.transport(c.url.replace(/\/$/, "") + "/auth/v1/recover", { method: "POST", headers: { apikey: c.key, "Content-Type": "application/json" }, body: JSON.stringify({ email: this.toEmail(email) }) }); if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error_description || j.msg || "Could not send the email"); } return true; },
  // 4.34.5 · a new password, a removed authenticator or a used recovery code forgets every browser the person had remembered
  // (sql/4345-trusted-device.sql; the database does the same by trigger where it may — this call makes it hold either way)
  forgetDevices() { try { return this.req("/rest/v1/rpc/device_forget_all", { method: "POST", body: "{}" }).then(() => true, () => false); } catch (e) { return Promise.resolve(false); } },
  async setPassword(password) { const r = await this.req("/auth/v1/user", { method: "PUT", body: JSON.stringify({ password }) }); if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error_description || j.msg || "Could not change the password"); } await this.forgetDevices(); return true; },
  // tokens arriving in the address (an invitation, a password reset, an email confirmation) become the session
  takeAuthHash() { const h = location.hash || ""; if (!/access_token=/.test(h)) return null; const q = new URLSearchParams(h.replace(/^#\/?/, "")); const at = q.get("access_token"), rt = q.get("refresh_token"), type = q.get("type"); if (!at) return null; try { const payload = JSON.parse(atob(at.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))); this.setSession({ access_token: at, refresh_token: rt, user_id: payload.sub, email: payload.email }); } catch (e) { return null; } history.replaceState(null, "", location.pathname + location.search); if (!type) { try { localStorage.setItem("xyntax.sso.arrived", String(Date.now())); } catch (e) { /* nothing */ } } return type || "signin"; },
  async account(action, body) { const r = await this.req("/functions/v1/account", { method: "POST", body: JSON.stringify({ action, ...(body || {}) }) }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || ("Account service: " + r.status)); return j; },
  personal() { return this.signedIn() && !(this.session() || {}).org_id; },
  async verifyPassword(password) { const c = this.cfg(); const s = this.session(); if (!c || !s) return false; const r = await this.transport(c.url.replace(/\/$/, "") + "/auth/v1/token?grant_type=password", { method: "POST", headers: { apikey: c.key, "Content-Type": "application/json" }, body: JSON.stringify({ email: s.email, password }) }); if (!r.ok) return false; try { const j = await r.json(); await this.transport(c.url.replace(/\/$/, "") + "/auth/v1/logout", { method: "POST", headers: { apikey: c.key, Authorization: "Bearer " + j.access_token } }); } catch (e) { /* the extra session simply expires */ } return true; },
  // ---------- 4.16 · identity: two-factor authentication (TOTP), single sign-on, company settings, error reports, backups
  mfa: {
    // the session's assurance level, read from the token: aal2 means the authenticator was presented in this session
    aal() { try { const s = CLOUD.session(); const p = JSON.parse(atob(s.access_token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))); return p.aal || "aal1"; } catch (e) { return "aal1"; } },
    async user() { const r = await CLOUD.req("/auth/v1/user"); if (!r.ok) return null; return r.json(); },
    async verifiedFactor() { const u = await this.user(); return ((u && u.factors) || []).find((f) => f.status === "verified") || null; },
    async enrol(name) { const r = await CLOUD.req("/auth/v1/factors", { method: "POST", body: JSON.stringify({ friendly_name: name || "XYNTAX", factor_type: "totp", issuer: "XYNTAX" }) }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.msg || j.error_description || j.message || "Could not start the enrolment"); return j; },
    async challenge(factorId) { const r = await CLOUD.req("/auth/v1/factors/" + encodeURIComponent(factorId) + "/challenge", { method: "POST", body: "{}" }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.msg || j.error_description || j.message || "Could not start the verification"); return j; },
    // verifying a challenge answers with a new session at aal2; it replaces the password-only one
    async verify(factorId, challengeId, code) { const r = await CLOUD.req("/auth/v1/factors/" + encodeURIComponent(factorId) + "/verify", { method: "POST", body: JSON.stringify({ challenge_id: challengeId, code: String(code || "").replace(/\s+/g, "") }) }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.msg || j.error_description || j.message || "That code was not accepted"); if (j.access_token) { const cur = CLOUD.session() || {}; CLOUD.setSession({ ...cur, access_token: j.access_token, refresh_token: j.refresh_token || cur.refresh_token }); try { CLOUD.realtime.reauth && CLOUD.realtime.reauth(); } catch (e) { /* no realtime yet */ } } return j; },
    async unenrol(factorId) { const r = await CLOUD.req("/auth/v1/factors/" + encodeURIComponent(factorId), { method: "DELETE" }); if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.msg || j.error_description || "Could not remove the authenticator"); } await CLOUD.forgetDevices(); try { await CLOUD.admin("mfa_recovery_set", { hashes: [] }); } catch (e) { /* no admin function */ } return true; },
    status() { return CLOUD.admin("mfa_status"); },
    setRecovery(hashes) { return CLOUD.admin("mfa_recovery_set", { hashes }); },
    async recover(code) { const r = await CLOUD.admin("mfa_recover", { code }); await CLOUD.forgetDevices(); return r; },
    // sha-256 hex of a recovery code (what the server keeps)
    async hash(code) { const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(code).replace(/[^A-Za-z0-9]/g, "").toUpperCase())); return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, "0")).join(""); },
    newCodes(n) { const A = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; const out = []; for (let i = 0; i < (n || 8); i++) { const r = crypto.getRandomValues(new Uint8Array(10)); let c = ""; for (let k = 0; k < 10; k++) c += A[r[k] % 32]; out.push(c.slice(0, 5) + "-" + c.slice(5)); } return out; },
    // which companies require two-factor for this person (from whoami), and whether that is satisfied
    requiredBy() { return (CLOUD.state.mfa && CLOUD.state.mfa.requiredBy) || []; },
    enrolled() { return !!(CLOUD.state.mfa && CLOUD.state.mfa.enrolled); },
    needsEnrolment(org) { const req = this.requiredBy(); return !!(req.length && !this.enrolled() && (!org || req.includes(org))); },
    needsStepUp(org) { const req = this.requiredBy(); return !!(req.length && this.enrolled() && this.aal() !== "aal2" && (!org || req.includes(org))); },
    // the code dialog: security.js installs CLOUD.mfa.prompt(ctx) → { code } | { recovery } | null; without a UI the step fails closed
    prompt: null,
    async stepUp(factorId) {
      if (!factorId) { const f = await this.verifiedFactor(); if (!f) return true; factorId = f.id; }
      if (typeof this.prompt !== "function") return false;
      for (let attempt = 1; attempt <= 5; attempt++) {
        let ch; try { ch = await this.challenge(factorId); } catch (e) { return false; }
        const a = await this.prompt({ attempt, factorId });
        if (!a) return false;
        if (a.recovery) { try { await this.recover(a.recovery); CLOUD.state.mfa = { ...(CLOUD.state.mfa || {}), enrolled: false, recovered: true }; return true; } catch (e) { if (attempt === 5) return false; continue; } }
        try { await this.verify(factorId, ch.id, a.code); return true; } catch (e) { if (attempt === 5) return false; }
      }
      return false;
    },
  },
  sso: {
    domains() { const c = typeof CLOUD_CONFIG !== "undefined" && CLOUD_CONFIG && CLOUD_CONFIG.sso; return c && Array.isArray(c.domains) ? c.domains.map((d) => String(d).toLowerCase().replace(/^@/, "")) : []; },
    enabled() { return this.domains().length > 0 && !!CLOUD.cfg(); },
    // where the identity provider sends the browser back: the desktop's own protocol, the phone's app link, or this page
    redirect() { const c = typeof CLOUD_CONFIG !== "undefined" && CLOUD_CONFIG && CLOUD_CONFIG.sso; if (c && c.redirect) return c.redirect; if (window.xyntax) return "xyntax://auth/callback"; if (typeof SUITE !== "undefined" && SUITE.host && SUITE.host.mobile) return "xyntax://auth/callback"; return location.origin + location.pathname; },
    domainFor(email) { const d = String(email || "").toLowerCase().split("@")[1] || ""; return this.domains().includes(d) ? d : (this.domains().length === 1 ? this.domains()[0] : ""); },
    async start(domain) {
      const c = CLOUD.cfg(); if (!c || !c.url || !c.key) throw new Error("Cloud is not configured on this computer");
      domain = String(domain || this.domains()[0] || "").toLowerCase(); if (!domain) throw new Error("No SSO domain is configured");
      const r = await CLOUD.transport(c.url.replace(/\/$/, "") + "/auth/v1/sso", { method: "POST", headers: { apikey: c.key, "Content-Type": "application/json" }, body: JSON.stringify({ domain, redirect_to: this.redirect(), skip_http_redirect: true }) });
      const j = await r.json().catch(() => ({})); if (!r.ok || !j.url) throw new Error(j.error_description || j.msg || j.message || "Single sign-on is not set up for " + domain + " yet (GUIDE §12)");
      try { localStorage.setItem("xyntax.sso.pending", JSON.stringify({ at: Date.now(), domain })); } catch (e) { /* nothing */ }
      // desktop and phone open the system browser (the answer returns through xyntax://auth/callback); the web page goes there itself
      if (window.xyntax && window.xyntax.openExternal) await window.xyntax.openExternal(j.url);
      else if (typeof SUITE !== "undefined" && SUITE.host && SUITE.host.mobile && SUITE.host.openExternal) await SUITE.host.openExternal(j.url);
      else location.assign(j.url);
      return j.url;
    },
  },
  // a sign-in arriving as an address (the SSO callback, an invitation link): the tokens become the session, a first SSO sign-in joins its company
  async acceptAuthUrl(url) {
    let frag = ""; try { const u = new URL(String(url)); frag = (u.hash || "").replace(/^#\/?/, "") || u.search.replace(/^\?/, ""); } catch (e) { frag = String(url || "").split("#")[1] || ""; }
    const q = new URLSearchParams(frag); const at = q.get("access_token"), rt = q.get("refresh_token"); if (!at) return false;
    let payload = {}; try { payload = JSON.parse(atob(at.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))); } catch (e) { return false; }
    this.setSession({ access_token: at, refresh_token: rt, user_id: payload.sub, email: payload.email });
    try { localStorage.removeItem("xyntax.sso.pending"); } catch (e) { /* nothing */ }
    let w = await this.whoami();
    if (w && !(w.memberships || []).length) { try { const j = await this.admin("sso_jit"); if (j && j.joined && j.joined.length) w = await this.whoami(); } catch (e) { /* password account or no matching company */ } }
    try { window.dispatchEvent(new CustomEvent("cloud-signed-in", { detail: { via: "url", who: w } })); } catch (e) { /* nothing */ }
    return true;
  },
  // company settings (two-factor requirement, SSO domains, error reports): administrators set, members read
  orgSettings(org) { return this.admin("org_settings", { org: org || (this.session() || {}).org_id }).then((j) => (j && j.settings) || {}); },
  setOrgSettings(org, set) { return this.admin("org_settings", { org: org || (this.session() || {}).org_id, set }).then((j) => (j && j.settings) || {}); },
  // an error report: message and a scrubbed stack, the app and the version — never content, never a name
  async reportError(e) { if (!this.signedIn()) return false; const s = this.session() || {}; const row = { org_id: s.org_id || null, user_id: s.user_id || null, app: String(e.app || "").slice(0, 40), message: String(e.message || "").slice(0, 300), stack: String(e.stack || "").slice(0, 2000), version: String(e.version || "").slice(0, 20), platform: String(e.platform || "").slice(0, 40) }; const r = await this.req("/rest/v1/client_errors", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify(row) }); return r.ok; },
  health() { return this.admin("health"); },
  async backup(action, body) { const r = await this.req("/functions/v1/backup", { method: "POST", body: JSON.stringify({ action, ...(body || {}) }) }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || ("Backup service: " + r.status)); return j; },
  async changeEmail(email) { const r = await this.req("/auth/v1/user", { method: "PUT", body: JSON.stringify({ email: String(email).trim().toLowerCase() }) }); if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error_description || j.msg || "Could not change the email"); } return true; },
  async refresh() {
    // 4.8: single-flighted — parallel boot, the polls and the apps all hit a 401 at the same moment after an hour away;
    // one refresh serves them all, and only an invalid refresh token signs the person out (a 5xx/429/network blip does not)
    if (this._refreshing) return this._refreshing;
    this._refreshing = (async () => {
      const c = this.cfg(); const s = this.session(); if (!s || !s.refresh_token) return false;
      if (typeof SUITE !== "undefined" && SUITE.perf) SUITE.perf.reqs++; let r; try { r = await this.transport(c.url.replace(/\/$/, "") + "/auth/v1/token?grant_type=refresh_token", { method: "POST", headers: { apikey: c.key, "Content-Type": "application/json" }, body: JSON.stringify({ refresh_token: s.refresh_token }) }); } catch (e) { return false; }
      if (!r.ok) { if (r.status === 400 || r.status === 401 || r.status === 403) this.setSession(null); return false; }
      const j = await r.json(); const cur = this.session() || s; this.setSession({ ...cur, access_token: j.access_token, refresh_token: j.refresh_token || cur.refresh_token }); this.realtime.reauth(); return true;
    })();
    try { return await this._refreshing; } finally { this._refreshing = null; }
  },
  logout() { this.wipeDeviceCopies(); this.setSession(null); this.stopPolling(); this.realtime.stop(); this._me = null; },
  // 4.10.2 · the copies the apps keep on this device for an instant open (sealed personal docs, company docs, shared rows,
  // the book, the startup "who am I") leave with the person: signing out on a shared computer leaves nothing readable behind
  wipeDeviceCopies() { try { const gone = []; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (/^xyntax\.(suite\.|book\.|shared-items\.|who\.|people\.)/.test(k) && !/^xyntax\.suite\.(prefs|fired)\./.test(k)) gone.push(k); } for (const k of gone) localStorage.removeItem(k); } catch (e) { /* storage unavailable */ } },
  async myOrgs() {
    const mine = "&user_id=eq." + ((this.session() || {}).user_id || ""); let r = await this.req("/rest/v1/memberships?select=org_id,role,apps,orgs(name,quota_gb,plan,plan_until)" + mine); if (!r.ok) r = await this.req("/rest/v1/memberships?select=org_id,role,apps,orgs(name,quota_gb)" + mine); if (!r.ok) r = await this.req("/rest/v1/memberships?select=org_id,role,orgs(name)" + mine); if (!r.ok) throw new Error("Could not read memberships: " + (await r.text()).slice(0, 200));
    return (await r.json()).map((m) => ({ id: m.org_id, role: m.role, apps: m.apps === undefined ? null : m.apps, quota: m.orgs && m.orgs.quota_gb != null ? +m.orgs.quota_gb : 5, name: m.orgs ? m.orgs.name : m.org_id, plan: m.orgs ? m.orgs.plan : null, plan_until: m.orgs ? m.orgs.plan_until : null }));
  },
  // 4.31.2 · the apps hear a company switch: "org-will-change" before (to send what waits for the old one), "org-change" after
  chooseOrg(org) { const prev = (this.session() || {}).org_id || null; const next = org ? org.id : null; const tell = (ev) => { if (prev === next || typeof window === "undefined" || !window.dispatchEvent) return; try { window.dispatchEvent(new CustomEvent(ev, { detail: { from: prev, to: next } })); } catch (e) { /* no listener */ } }; tell("org-will-change"); this._chooseOrg(org); tell("org-change"); },
  _chooseOrg(org) { const s = this.session(); if (!org) { this.setSession({ ...s, org_id: null, role: null, org_name: "", apps: null, quota: null }); this.state.role = null; this.state.org = null; this.state.orgName = ""; this.state.apps = null; this.state.quota = null; return; } this.setSession({ ...s, org_id: org.id, role: org.role, org_name: org.name, apps: org.apps === undefined ? null : org.apps, quota: org.quota, plan: org.plan, plan_until: org.plan_until }); this.state.role = org.role; this.state.org = org.id; this.state.orgName = org.name; this.state.apps = org.apps === undefined ? null : org.apps; this.state.quota = org.quota; this.state.plan = org.plan; this.state.planUntil = org.plan_until; },
  // 4.6: there are no subscriptions — an open company is always entitled to Accounting
  entitled() { return this.active(); },
  // suite: may the signed-in user open this app? (owner: always; no list on the membership: every app)
  PERSONAL_APPS: ["notes", "wealth", "calendar", "contacts", "documents", "messages"],
  hasApp(app) { if (!this.signedIn()) return true; if (this.state.isOwner) return true; const ms = this.state.memberships || []; const s = this.session() || {}; const apps = this.state.apps !== undefined ? this.state.apps : s.apps; /* 4.34.4 · a person opens only the apps a company gave them. NOTES, WEALTH, CALENDAR, CONTACTS, DOCUMENTS and MESSAGES are the person's own (not tied to the company that is open), so one company granting the app is enough; none granting it means it is not there. Only an account in no company at all keeps its own personal apps. */ if (this.PERSONAL_APPS.includes(app)) { if (ms.length) return ms.some((m) => !m.apps || m.apps.includes(app)); if (s.org_id) return apps == null || apps.includes(app); return true; } /* 4.22 · an operations manager never opens the books */ if (app === "accounting" && this.active() && this.state.role === "operations") return false; if (!ms.length && !s.org_id) return false; if (!this.active()) return !ms.length || ms.some((m) => !m.apps || m.apps.includes(app)); return apps == null || apps.includes(app); },
  // 4.22 · five roles in a company. canEdit() is the right to change the BOOKS (Accounting) and stays admin/editor;
  // can(scope) answers the other questions. The server enforces the same matrix (cloud-setup.sql · 4.22 roles).
  ROLES: [
    { v: "admin", l: "Administrator", d: "Everything in this company: every app, the books, PROSHIP, its users and settings. Not the software owner." },
    { v: "editor", l: "Editor", d: "Enters and deletes anything anywhere in this company — the books, PROSHIP, documents. No user administration." },
    { v: "commercial", l: "Commercial manager", d: "Sees, adds and deletes anything in PROSHIP (fixtures, voyages, claims, strategy, portal). Sees all of Accounting, changes nothing there. The other apps as granted." },
    { v: "operations", l: "Operations manager", d: "PROSHIP: Vessels, Operations and Compliance only — no commercial terms, no financials, no strategy, no portal; never Accounting. The other apps as granted." },
    { v: "viewer", l: "Viewer", d: "Sees everything the apps granted show, changes nothing." },
  ],
  roleName(r) { const x = this.ROLES.find((y) => y.v === r); return x ? x.l : r || ""; },
  PROSHIP_WRITERS: ["admin", "editor", "commercial", "operations"],
  OPS_TABS: ["vessels", "operations", "compliance"],
  OPS_KINDS: ["vessels", "voyages", "voyageTasks", "noonReports", "das", "bunkerLog", "compliance", "offhire", "lists", "laytime"],
  can(scope) {
    if (!this.active() || this.state.isOwner) return true; const r = this.state.role;
    switch (scope) {
      case "book": return r === "admin" || r === "editor";
      case "admin": return r === "admin";
      case "proship": return this.PROSHIP_WRITERS.includes(r);
      case "proship:money": return r !== "operations"; // commercial terms and earnings
      case "portal": return ["admin", "editor", "commercial"].includes(r);
      case "suite": return r !== "viewer"; // shared notes, calendar, contacts, documents
      default: return this.canEdit();
    }
  },
  proshipKindOk(kind) { if (!this.active() || this.state.isOwner) return true; const r = this.state.role; if (r === "operations") return this.OPS_KINDS.includes(kind); return this.PROSHIP_WRITERS.includes(r); },
  proshipTabOk(id) { if (!this.active() || this.state.isOwner) return true; if (this.state.role === "operations") return this.OPS_TABS.includes(id); return true; },
  canEdit() { return !this.active() || ["admin", "editor"].includes(this.state.role) || this.state.isOwner; },
  isAdmin() { return this.state.isOwner || (this.active() && this.state.role === "admin"); },
  async load() {
    const s = this.session(); const r = await this.req("/rest/v1/books?select=data,version,updated_at&org_id=eq." + s.org_id);
    if (!r.ok) throw new Error("Could not load the book: " + (await r.text()).slice(0, 200));
    const rows = await r.json(); this.state.role = s.role; this.state.org = s.org_id; this.state.orgName = s.org_name; this.state.email = s.email; this.state.apps = s.apps === undefined ? null : s.apps; this.state.quota = s.quota; this.state.lastSync = new Date();
    if (!rows.length) { this.state.version = 0; return null; }
    this.state.version = rows[0].version; return rows[0].data;
  },
  async version() { const s = this.session(); const r = await this.req("/rest/v1/books?select=version&org_id=eq." + s.org_id); if (!r.ok) return null; const rows = await r.json(); return rows.length ? rows[0].version : 0; },
  async save(store) {
    const s = this.session(); if (!this.canEdit()) throw new Error("Your role does not change the books (" + this.roleName(s.role) + ")");
    const r = await this.req("/rest/v1/rpc/save_book", { method: "POST", body: JSON.stringify({ p_org: s.org_id, p_version: this.state.version, p_data: store }) });
    if (!r.ok) { const t = await r.text(); if (/conflict/i.test(t)) throw new Error("CONFLICT"); throw new Error("Cloud save failed: " + t.slice(0, 200)); }
    this.state.version = await r.json(); this.state.lastSync = new Date(); this.state.error = null; return this.state.version;
  },
  startPolling(onChange) { this.stopPolling(); this._onChange = onChange; this.realtime.start(); const tick = async (force) => { if (this._busy) return; if (force !== true && this.realtime.live && Date.now() - (this._lastPoll || 0) < 45000) return; this._lastPoll = Date.now(); this._busy = true; try { if (!this.active()) return; const v = await this.version(); if (v != null && v > this.state.version && !S.dirty) await onChange(v); } catch (e) { /* offline; try again next time */ } finally { this._busy = false; } }; this._tick = tick; this.state.polling = setInterval(tick, 4000); window.addEventListener("focus", () => tick()); document.addEventListener("visibilitychange", () => { if (!document.hidden) tick(); }); window.addEventListener("online", () => this.reconnect()); window.addEventListener("offline", () => this.setOnline(false, "This computer has no internet connection.")); },
  async reconnect() { try { const v = await this.version(); if (v == null) throw new Error("The workspace refused the request; sign in again."); this.setOnline(true); if (S.dirty) { await persist.save(S.store); S.dirty = false; } else if (v > this.state.version) { const fresh = await this.load(); if (fresh) { S.store = E.migrate(fresh); render(); } } if (typeof renderStatus === "function") renderStatus(); return true; } catch (e) { this.setOnline(false, e.message.replace(/^Offline: /, "")); if (typeof renderStatus === "function") renderStatus(); return false; } },
  stopPolling() { if (this.state.polling) clearInterval(this.state.polling); this.state.polling = null; },
  pollNow() { this._lastPoll = 0; if (this._tick) this._tick(true); },
  // ---- attachments in the storage bucket "attachments": <org>/<subjectId>/<name>
  objPath(subjectId, name) { return this.session().org_id + "/" + encodeURIComponent(subjectId) + "/" + encodeURIComponent(name); },
  async upload(subjectId, file) { const r = await this.req("/storage/v1/object/attachments/" + this.objPath(subjectId, file.name), { method: "POST", headers: { "Content-Type": file.type || "application/octet-stream", "x-upsert": "true" }, body: file }); if (!r.ok) throw new Error("Upload failed: " + (await r.text()).slice(0, 200)); return this.session().org_id + "/" + subjectId + "/" + file.name; },
  async download(subjectId, name) { const r = await this.req("/storage/v1/object/authenticated/attachments/" + this.objPath(subjectId, name)); if (!r.ok) throw new Error("Download failed: " + r.status); return await r.blob(); },
  async remove(subjectId, name) { const org = this.session().org_id; const from = org + "/" + subjectId + "/" + name; const to = org + "/.trash/" + subjectId + "/" + Date.now() + "-" + name; const r = await this.req("/storage/v1/object/move", { method: "POST", body: JSON.stringify({ bucketId: "attachments", sourceKey: from, destinationKey: to }) }); if (r.ok) return true; const r2 = await this.req("/storage/v1/object/attachments/" + this.objPath(subjectId, name), { method: "DELETE" }); return r2.ok; },
  // ---- self-service: own password, sign out of every device
  async changePassword(pw) { const r = await this.req("/auth/v1/user", { method: "PUT", body: JSON.stringify({ password: pw }) }); if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.msg || j.message || j.error_description || "Could not change the password"); } await this.forgetDevices(); return true; },
  async logoutEverywhere() { try { await this.req("/auth/v1/logout?scope=global", { method: "POST" }); } catch (e) { /* best effort */ } this.logout(); },
  // ---- suite: one personal JSON document per app (notes, wealth, calendar), versioned like the book
  async suiteLoad(app) { const r = await this.req("/rest/v1/suite_docs?select=data,version,updated_at&app=eq." + encodeURIComponent(app)); if (!r.ok) throw new Error("Could not load " + app + ": " + (await r.text()).slice(0, 160)); const rows = await r.json(); return rows.length ? { data: rows[0].data, version: rows[0].version } : { data: null, version: 0 }; },
  async suiteSave(app, version, data) { this._vers = null; const r = await this.req("/rest/v1/rpc/save_suite_doc", { method: "POST", body: JSON.stringify({ p_app: app, p_version: version, p_data: data }) }); if (!r.ok) { const t = await r.text(); if (/conflict/i.test(t)) throw new Error("CONFLICT"); { let m = t; try { m = JSON.parse(t).message || t; } catch (x) { /* plain */ } if (/^empty:/i.test(m)) throw new Error(m); } throw new Error("Save failed: " + t.slice(0, 160)); } return await r.json(); },
  // 4.10.3 · one request answers "which of my documents moved?" for every app: the version table is fetched once and
  // shared by all callers for a moment (the home's eleven checks become one; the fallback is the per-app query); any realtime notice or window focus forgets it
  async versions(force) {
    const now = Date.now(); if (!force && this._vers && now - this._versAt < 150) return this._vers; /* just long enough for one draw's callers to share it */
    if (this._versP) { /* a request in flight: join it if it just left, otherwise queue one more so the answer is at least as fresh as the ask */ return now - this._versStart < 100 ? this._versP : this._versP.then(() => this.versions(force)); }
    this._versStart = now; this._versP = (async () => { try { const s = this.session() || {}; const r = await this.req("/rest/v1/rpc/suite_versions", { method: "POST", body: JSON.stringify({ p_org: s.org_id || null }) }); if (!r.ok) return null; const v = await r.json(); this._vers = v && typeof v === "object" ? v : null; this._versAt = Date.now(); return this._vers; } catch (e) { return null; } finally { this._versP = null; } })();
    return this._versP;
  },
  async suiteVersion(app, force) { const v = await this.versions(force); if (v && v.docs) return v.docs[app] != null ? +v.docs[app] : 0; const r = await this.req("/rest/v1/suite_docs?select=version&app=eq." + encodeURIComponent(app)); if (!r.ok) return null; const rows = await r.json(); return rows.length ? rows[0].version : 0; },
  // shared per company: notes sections and the company calendar (suite_shared)
  async sharedLoad(app, org) { const r = await this.req("/rest/v1/suite_shared?select=data,version,updated_at,updated_by&org_id=eq." + (org || this.session().org_id) + "&app=eq." + encodeURIComponent(app)); if (!r.ok) throw new Error("Could not load shared " + app + ": " + (await r.text()).slice(0, 160)); const rows = await r.json(); return rows.length ? { data: rows[0].data, version: rows[0].version } : { data: null, version: 0 }; },
  async sharedSave(app, version, data, org) { this._vers = null; const r = await this.req("/rest/v1/rpc/save_suite_shared", { method: "POST", body: JSON.stringify({ p_org: org || this.session().org_id, p_app: app, p_version: version, p_data: data }) }); if (!r.ok) { const t = await r.text(); if (/conflict/i.test(t)) throw new Error("CONFLICT"); { let m = t; try { m = JSON.parse(t).message || t; } catch (x) { /* plain */ } if (/^empty:/i.test(m)) throw new Error(m); } if (/read only/i.test(t)) throw new Error("Your role is read-only in this company"); throw new Error("Save failed: " + t.slice(0, 160)); } return await r.json(); },
  async sharedVersion(app, force) { const v = await this.versions(force); if (v && v.shared) return v.shared[app] != null ? +v.shared[app] : 0; const r = await this.req("/rest/v1/suite_shared?select=version&org_id=eq." + this.session().org_id + "&app=eq." + encodeURIComponent(app)); if (!r.ok) return null; const rows = await r.json(); return rows.length ? rows[0].version : 0; },
  // 4.10 · items shared with named people: one row per note / event / contact (shared_items), owner + recipients only
  sharedItems: {
    async list(app) { const s = CLOUD.session() || {}; if (!s.org_id) return []; const r = await CLOUD.req("/rest/v1/shared_items?select=id,org_id,app,owner_id,shared_with,data,version,updated_at,updated_by&org_id=eq." + s.org_id + "&app=eq." + encodeURIComponent(app) + "&deleted_at=is.null&order=updated_at.desc"); if (!r.ok) throw new Error("Could not load shared " + app + ": " + (await r.text()).slice(0, 160)); return await r.json(); },
    async create(app, data, shared_with) { const s = CLOUD.session() || {}; const r = await CLOUD.req("/rest/v1/shared_items", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ org_id: s.org_id, app, owner_id: s.user_id, shared_with: shared_with || [], data, updated_by: s.user_id }) }); if (!r.ok) throw new Error("Could not share: " + (await r.text()).slice(0, 160)); const rows = await r.json(); return Array.isArray(rows) ? rows[0] : rows; },
    async save(id, version, data) { const r = await CLOUD.req("/rest/v1/rpc/save_shared_item", { method: "POST", body: JSON.stringify({ p_id: id, p_version: version, p_data: data }) }); if (!r.ok) { const t = await r.text(); if (/conflict/i.test(t)) throw new Error("CONFLICT"); if (/not found|not allowed/i.test(t) || r.status === 403 || r.status === 404) throw new Error("GONE"); throw new Error("Save failed: " + t.slice(0, 160)); } return await r.json(); },
    async get(id) { const r = await CLOUD.req("/rest/v1/shared_items?select=id,org_id,app,owner_id,shared_with,data,version,updated_at,updated_by,deleted_at&id=eq." + id); if (!r.ok) return null; const rows = await r.json(); return rows[0] || null; },
    async setPeople(id, shared_with) { const r = await CLOUD.req("/rest/v1/shared_items?id=eq." + id, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ shared_with }) }); if (!r.ok) throw new Error("Could not change who sees it: " + (await r.text()).slice(0, 160)); const rows = await r.json(); return rows[0] || null; },
    async remove(id) { const r = await CLOUD.req("/rest/v1/shared_items?id=eq." + id, { method: "PATCH", body: JSON.stringify({ deleted_at: new Date().toISOString() }) }); if (!r.ok) throw new Error("Could not stop sharing: " + (await r.text()).slice(0, 160)); return true; },
  },
  // the people in your companies (profiles are visible to co-members)
  async people() { const r = await this.req("/rest/v1/profiles?select=user_id,email,name&order=email.asc"); if (!r.ok) return []; return (await r.json()).map((p) => ({ id: p.user_id, user: this.shown(p.email), email: p.email, name: p.name || "" })); },
  async admins() { const r = await this.req("/rest/v1/rpc/org_admins", { method: "POST", body: JSON.stringify({ p_org: (this.session() || {}).org_id }) }); if (!r.ok) return []; return (await r.json()).map((x) => x.user_id || x); },
  // personal files (voice notes, images in notes): bucket "suite", <user id>/<key>
  suitePath(key) { const s = this.session(); const parts = key.split("/"); if (parts[0] === "org") return "org-" + s.org_id + "/" + parts.slice(1).map(encodeURIComponent).join("/"); return s.user_id + "/" + parts.map(encodeURIComponent).join("/"); },
  async suitePut(key, blob) { const r = await this.req("/storage/v1/object/suite/" + this.suitePath(key), { method: "POST", headers: { "Content-Type": blob.type || "application/octet-stream", "x-upsert": "true" }, body: blob }); if (!r.ok) throw new Error("Upload failed: " + (await r.text()).slice(0, 160)); return key; },
  async suiteGetPath(path) { const r = await this.req("/storage/v1/object/authenticated/suite/" + path); if (!r.ok) throw new Error("Download failed: " + r.status); return await r.blob(); },
  async suiteGet(key) { const r = await this.req("/storage/v1/object/authenticated/suite/" + this.suitePath(key)); if (!r.ok) throw new Error("Download failed: " + r.status); return await r.blob(); },
  async suiteDel(key) { const r = await this.req("/storage/v1/object/suite/" + this.suitePath(key), { method: "DELETE" }); return r.ok; },
  // ---- vault: index rows in vault_items, bytes in bucket "vault" under <org>/<item id>/<name>
  async vaultList() { const s = this.session(); const r = await this.req("/rest/v1/vault_items?select=*&" + (s.org_id ? "org_id=eq." + s.org_id : "org_id=is.null&owner_id=eq." + s.user_id) + "&order=name.asc"); if (!r.ok) throw new Error("Could not read the vault: " + (await r.text()).slice(0, 160)); return await r.json(); },
  async vaultInsert(item) { const r = await this.req("/rest/v1/vault_items", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ ...item, org_id: this.session().org_id || null, owner_id: this.session().user_id, owner_name: this.shown(this.state.email || (this.session() || {}).email || "") }) }); if (!r.ok) throw new Error("Could not create: " + (await r.text()).slice(0, 160)); return (await r.json())[0]; },
  async vaultUpdate(id, patch, baseVersion) { const body = { ...patch, updated_at: new Date().toISOString() }; if (baseVersion != null) body.base_version = +baseVersion; /* 4.31.3 · the version this device saw: a change made elsewhere first is not overwritten */ const r = await this.req("/rest/v1/vault_items?id=eq." + id, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify(body) }); if (!r.ok) { const t = await r.text(); if (/conflict/i.test(t)) throw new Error("Changed by someone else a moment ago — the list was refreshed; please try again"); if (/base_version/i.test(t) && baseVersion != null) return this.vaultUpdate(id, patch); throw new Error("Could not update: " + t.slice(0, 160)); } return (await r.json())[0]; },
  async vaultDeleteRow(id) { const r = await this.req("/rest/v1/vault_items?id=eq." + id, { method: "DELETE" }); if (!r.ok) throw new Error("Could not delete: " + (await r.text()).slice(0, 160)); return true; },
  vaultPath(item) { return (item.org_id || ("u-" + item.owner_id)) + "/" + item.id + "/" + encodeURIComponent(item.name); },
  async vaultUpload(item, blob) { const r = await this.req("/storage/v1/object/vault/" + this.vaultPath(item), { method: "POST", headers: { "Content-Type": blob.type || "application/octet-stream", "x-upsert": "true" }, body: blob }); if (!r.ok) throw new Error("Upload failed: " + (await r.text()).slice(0, 160)); return true; },
  async vaultDownload(item) { const r = await this.req("/storage/v1/object/authenticated/vault/" + this.vaultPath(item)); if (!r.ok) throw new Error("Download failed: " + r.status); return await r.blob(); },
  async vaultRemoveObject(item) { const r = await this.req("/storage/v1/object/vault/" + this.vaultPath(item), { method: "DELETE" }); return r.ok; },
  async vaultUsage() { const s = this.session(); const r = s.org_id ? await this.req("/rest/v1/rpc/vault_usage", { method: "POST", body: JSON.stringify({ p_org: s.org_id }) }) : await this.req("/rest/v1/rpc/vault_usage_me", { method: "POST", body: "{}" }); if (!r.ok) return null; return +(await r.json()); },
  // ---- 4.12 · PROSHIP: vessel positions (vessel_positions, one row per company and IMO; written by the ais function and by hand)
  // 4.15 · a position is real only with finite coordinates and a time stamp (a registration row has none, and 0,0 without a time is
  // a blank, not the Gulf of Guinea); anything else comes back as "registered, not heard yet": { tracked: true, position: null }
  _posReal(r) { const lat = +r.lat, lon = +r.lon; if (r.lat == null || r.lon == null || !isFinite(lat) || !isFinite(lon)) return false; if (!r.ts && Math.abs(lat) + Math.abs(lon) === 0) return false; return !!r.ts; },
  _posRow(r) { const base = { imo: r.imo, mmsi: r.mmsi || "", tracked: true, firstTrackedAt: r.first_tracked_at || null, updatedAt: r.updated_at }; if (!this._posReal(r)) return { ...base, position: null, lat: null, lon: null, sog: null, cog: null, hdg: null, ts: null, dest: r.dest || "", eta: r.eta || null, navStatus: "", source: r.source || "manual" }; const row = { ...base, lat: +r.lat, lon: +r.lon, sog: r.sog, cog: r.cog, hdg: r.hdg, ts: r.ts, dest: r.dest || "", eta: r.eta, navStatus: r.nav_status || "", source: r.source || "manual" }; row.position = { lat: row.lat, lon: row.lon, ts: row.ts }; return row; },
  async positions(imos) { const s = this.session() || {}; if (!s.org_id) return []; const q = Array.isArray(imos) && imos.length ? "&imo=in.(" + imos.map((i) => encodeURIComponent(String(i))).join(",") + ")" : ""; const r = await this.req("/rest/v1/vessel_positions?select=imo,mmsi,lat,lon,sog,cog,hdg,ts,dest,eta,nav_status,source,updated_at,first_tracked_at&org_id=eq." + s.org_id + q); if (!r.ok) throw new Error("Could not read positions: " + (await r.text()).slice(0, 160)); return (await r.json()).map((x) => this._posRow(x)); },
  async positionSave(row) { const s = this.session() || {}; if (!s.org_id) throw new Error("No company"); const body = { org_id: s.org_id, imo: String(row.imo || "").replace(/\D/g, ""), mmsi: String(row.mmsi || "").replace(/\D/g, ""), lat: row.lat != null ? +row.lat : null, lon: row.lon != null ? +row.lon : null, sog: row.sog != null ? +row.sog : null, cog: row.cog != null ? +row.cog : null, hdg: row.hdg != null ? +row.hdg : null, ts: row.ts || new Date().toISOString(), dest: row.dest || "", eta: row.eta || null, nav_status: row.navStatus || row.nav_status || "", source: row.source || "manual", updated_at: new Date().toISOString(), updated_by: s.user_id }; if (!body.imo) throw new Error("The vessel needs an IMO number"); const r = await this.req("/rest/v1/vessel_positions?on_conflict=org_id,imo", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=representation" }, body: JSON.stringify(body) }); if (!r.ok) throw new Error("Could not save the position: " + (await r.text()).slice(0, 160)); const rows = await r.json(); return this._posRow(Array.isArray(rows) ? rows[0] : rows); },
  // 4.13 · register the fleet with the tracker: one row per vessel in vessel_positions (no position yet) is what the 15-minute cron
  // follows; only IMO and MMSI are sent, so a position already heard is never overwritten. Chunks of 500, one request each.
  async track(vessels) {
    const s = this.session() || {}; if (!s.org_id) return { tracked: 0 };
    const rows = []; for (const v of vessels || []) { const imo = String(v.imo || "").replace(/\D/g, ""), mmsi = String(v.mmsi || "").replace(/\D/g, ""); if (!imo) continue; rows.push({ org_id: s.org_id, imo, mmsi }); }
    if (!rows.length) return { tracked: 0 };
    // rows without an MMSI must not blank one the tracker learned: send them without the column (merge touches only sent columns)
    const withM = rows.filter((r) => r.mmsi), withoutM = rows.filter((r) => !r.mmsi).map((r) => ({ org_id: r.org_id, imo: r.imo }));
    let n = 0; const send = async (list) => { for (let i = 0; i < list.length; i += 500) { const r = await this.req("/rest/v1/vessel_positions?on_conflict=org_id,imo", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(list.slice(i, i + 500)) }); if (!r.ok) throw new Error("Could not register the vessels for tracking: " + (await r.text()).slice(0, 160)); n += Math.min(500, list.length - i); } };
    await send(withM); await send(withoutM); return { tracked: n };
  },
  // 4.18 · a vessel that exited management leaves the tracker: her row goes, the feed stops listening for her at the next sample
  // (the app keeps her last known position with the tenure record)
  async untrack(imos) {
    const s = this.session() || {}; if (!s.org_id) return { untracked: 0 };
    const list = [...new Set((imos || []).map((x) => String(x && x.imo != null ? x.imo : x).replace(/\D/g, "")).filter(Boolean))]; if (!list.length) return { untracked: 0 };
    let n = 0; for (let i = 0; i < list.length; i += 200) { const slice = list.slice(i, i + 200); const r = await this.req("/rest/v1/vessel_positions?org_id=eq." + encodeURIComponent(s.org_id) + "&imo=in.(" + slice.join(",") + ")", { method: "DELETE", headers: { Prefer: "return=minimal" } }); if (!r.ok) throw new Error("Could not remove the vessel from tracking: " + (await r.text()).slice(0, 160)); n += slice.length; }
    return { untracked: n };
  },
  // 4.13 · the PROSHIP row store: rows of one company, read incrementally and written in batches through proship_save
  proship: {
    async rows(since, opt) { opt = opt || {}; const s = CLOUD.session() || {}; const org = opt.orgId || s.org_id; if (!org) return []; return CLOUD.pull("/rest/v1/proship_rows?select=kind,id,vessel_id,data,version,updated_at,deleted_at&org_id=eq." + org + (since ? "&updated_at=gte." + encodeURIComponent(since) : "") + (opt.live ? "&deleted_at=is.null" : "") + (opt.kind ? "&kind=eq." + encodeURIComponent(opt.kind) : "") + "&order=updated_at.asc,kind.asc,id.asc", "PROSHIP records", { page: opt.page }); },
    async save(rows, opt) { opt = opt || {}; const s = CLOUD.session() || {}; const org = opt.orgId || s.org_id; if (!org) throw new Error("No company"); const out = []; for (let i = 0; i < rows.length; i += 500) { const r = await CLOUD.req("/rest/v1/rpc/proship_save", { method: "POST", body: JSON.stringify({ p_org: org, p_rows: rows.slice(i, i + 500) }) }); if (!r.ok) { const t = await r.text(); throw new Error("Could not save the PROSHIP records: " + (t.match(/"message":"([^"]+)"/) || [0, t.slice(0, 160)])[1]); } const res = await r.json(); if (Array.isArray(res)) out.push(...res); } return out; },
    async latest(opt) { opt = opt || {}; const s = CLOUD.session() || {}; const org = opt.orgId || s.org_id; if (!org) return null; const r = await CLOUD.req("/rest/v1/rpc/proship_latest", { method: "POST", body: JSON.stringify({ p_org: org }) }); if (!r.ok) return null; return await r.json(); },
  },
  // the ais function listens to the provider for a moment and writes what it heard; the answer says what it managed
  ais: {
    // 4.15 · the function picks the window itself (100 s when a vessel has no or a stale position, 45 s otherwise) unless `seconds`
    // is given (10–100); the reply carries `vessels[]` with heard / last-seen / never / no-mmsi and a `summary`
    async refresh(opt) { opt = opt || {}; const s = CLOUD.session() || {}; const body = { org: s.org_id || null, vessels: opt.vessels || [], force: !!opt.force }; if (opt.seconds) body.seconds = Math.max(10, Math.min(100, +opt.seconds || 45)); const r = await CLOUD.req("/functions/v1/ais", { method: "POST", body: JSON.stringify(body) }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || ("AIS refresh failed: " + r.status)); j.text = this.describe(j); return j; },
    // 4.23 · VesselAPI: register the live webhook for the fleet (administrators); the function answers with the notification id
    async setupLive() { const s = CLOUD.session() || {}; const r = await CLOUD.req("/functions/v1/ais", { method: "POST", body: JSON.stringify({ action: "vesselapi_setup", org: s.org_id || null }) }); const j = await r.json().catch(() => ({})); if (!r.ok || j.error) throw new Error(j.error || "The tracker did not answer"); return j; },
    // one line for a toast or the pane: "3 of 12 heard in a 100 s sample · 7 last seen earlier · 2 never heard"
    describe(j) { if (!j) return ""; if (j.configured === false) return "No AIS provider is set up — positions can be entered by hand (noon reports)"; if (j.configured === null) return j.note || "No vessels to track yet"; const sm = j.summary || {}; const parts = [(sm.heard != null ? sm.heard : (j.heard || 0)) + " of " + (sm.asked != null ? sm.asked : (j.asked || 0)) + " heard in a " + (sm.window || j.window || 45) + " s sample"]; if (sm.lastSeen) parts.push(sm.lastSeen + " last seen earlier"); if (sm.never) parts.push(sm.never + " never heard"); if (sm.noMmsi) parts.push(sm.noMmsi + " without MMSI"); return parts.join(" · "); },
    // the state of one positions row (CLOUD.positions) or one reply vessel: live · stale · manual · never · no-mmsi · untracked
    status(row, now) { now = now || Date.now(); if (!row) return { state: "untracked", message: "Not registered with the tracker yet — save the vessel with her IMO and MMSI" }; const ts = row.ts || row.lastSeen || null; const age = ts ? Math.round((now - new Date(ts).getTime()) / 60000) : null; const first = row.firstTrackedAt || null; const tracked = first ? Math.round((now - new Date(first).getTime()) / 60000) : 0; const hours = (m) => (m < 60 ? m + " min" : m < 2880 ? Math.round(m / 60) + " h" : Math.round(m / 1440) + " d"); if (!row.mmsi && !ts) return { state: "no-mmsi", age, tracked, message: "No MMSI — add it to the vessel so the AIS feed can be filtered for her (the tracker tries to learn it from static data meanwhile)" }; if (!ts) { const check = tracked >= 360; return { state: "never", age, tracked, checkMmsi: check, message: "Registered " + hours(tracked) + " ago, never heard on the AIS feed" + (check ? " — check the MMSI (" + (row.mmsi || "none") + ") or use a commercial provider: the free community feed has thin coverage in some regions" : " — the feed is sampled every 10 minutes") }; } const src = row.source === "ais" || row.lastSource === "ais" ? "AIS" : "report"; if (age <= 120) return { state: "live", age, tracked, message: src + " · " + hours(age) + " ago" }; return { state: row.source === "ais" ? "stale" : "manual", age, tracked, message: src + " · last seen " + hours(age) + " ago" }; },
    coverageNote: "Positions come from aisstream.io, a free community AIS feed with terrestrial receivers: coverage is thin in some regions (Singapore measured two reports in 25 s), so a ship can take a while to be heard. A commercial provider (Datalastic, VesselFinder, MarineTraffic — satellite coverage) plugs in through the AIS_PROVIDER/AIS_KEY secrets.",
    async probe(opt) { opt = opt || {}; const s = CLOUD.session() || {}; const r = await CLOUD.req("/functions/v1/ais", { method: "POST", body: JSON.stringify({ org: s.org_id || null, probe: true, seconds: opt.seconds || 12, box: opt.box }) }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || ("AIS probe failed: " + r.status)); return j; },
  },
  // ---- 4.12 · the customer portal: customers, their logins (through the portal-admin function), published snapshots and files
  portal: {
    url() { try { const c = CLOUD.cfg(); const o = (typeof CLOUD_CONFIG !== "undefined" && CLOUD_CONFIG.portal) || localStorage.getItem("xyntax.portal.url"); if (o) return String(o).replace(/\/$/, "") + "/"; return c && c.url ? c.url.replace(/\/$/, "") + "/functions/v1/portal/" : ""; } catch (e) { return ""; } },
    // 4.12 · Supabase serves a function's HTML as plain text on the shared *.supabase.co host (only a custom domain renders it), so the
    // link only works for a customer once the workspace has its own domain (HOSTING.md §4) or the portal/ folder is published on a
    // static host and its address is in cloud-config.js as `portal` (or Settings → localStorage xyntax.portal.url). This says which.
    hosted() { const u = this.url(); if (!u) return { url: "", ok: false, why: "no workspace" }; try { const h = new URL(u).hostname; if (/\.supabase\.(co|in)$/i.test(h)) return { url: u, ok: false, why: "The shared " + h + " host shows the portal page as plain text. Give the workspace a custom domain (HOSTING.md §4), or publish the portal/ folder on a static host (Cloudflare Pages, free) and put its address in cloud-config.js as portal." }; } catch (e) { /* odd url */ } return { url: u, ok: true, why: "" }; },
    // 4.31.5 · the workspace refuses portal writes from an outdated desktop (42501, "XYNTAX x.y.z is out of date: …"): that message is
    // passed on as it is (e.outdated) so the Portal page can show it plainly; anything else keeps the old wording
    async fail(what, r) { const t = await r.text().catch(() => ""); let j = null; try { j = JSON.parse(t); } catch (e) { j = null; } if (j && j.code === "42501" && /out of date/i.test(j.message || "")) { const e = new Error(j.message); e.outdated = true; throw e; } throw new Error(what + ": " + t.slice(0, 160)); },
    async admin(action, payload) { const s = CLOUD.session() || {}; const r = await CLOUD.req("/functions/v1/portal-admin", { method: "POST", body: JSON.stringify({ action, org: s.org_id, ...(payload || {}) }) }); let j = null; try { j = await r.json(); } catch (e) { j = { error: "No answer from the portal-admin function (is it deployed?)" }; } if (!r.ok || (j && j.error)) throw new Error((j && j.error) || ("Portal call failed: " + r.status)); return j; },
    async customers() { const s = CLOUD.session() || {}; if (!s.org_id) return []; const r = await CLOUD.req("/rest/v1/portal_customers?select=id,cp_id,name,org_name,visibility,vessel_ids,live,created_at,updated_at&org_id=eq." + s.org_id + "&order=name.asc"); if (!r.ok) throw new Error("Could not read the portal customers: " + (await r.text()).slice(0, 160)); return await r.json(); },
    async saveCustomer(c) { const s = CLOUD.session() || {}; if (!s.org_id) throw new Error("No company"); const body = { org_id: s.org_id, cp_id: String(c.cpId || c.cp_id), name: c.name || "", org_name: c.orgName || c.org_name || CLOUD.state.orgName || "", visibility: c.visibility || {}, vessel_ids: c.vesselIds || c.vessel_ids || [], updated_at: new Date().toISOString(), updated_by: s.user_id }; if (c.live !== undefined) body.live = c.live !== false; /* 4.31.10 · the customer keeps itself current */ const r = await CLOUD.req("/rest/v1/portal_customers?on_conflict=org_id,cp_id", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=representation" }, body: JSON.stringify(body) }); if (!r.ok) await this.fail("Could not save the customer", r); const rows = await r.json(); return Array.isArray(rows) ? rows[0] : rows; },
    deleteCustomer(customerId) { return this.admin("delete_customer", { customer_id: customerId }); },
    async users(customerId) { const s = CLOUD.session() || {}; if (!s.org_id) return []; const r = await CLOUD.req("/rest/v1/portal_users?select=user_id,customer_id,email,name,active,created_at,last_seen&org_id=eq." + s.org_id + (customerId ? "&customer_id=eq." + customerId : "") + "&order=created_at.asc"); if (!r.ok) throw new Error("Could not read the portal logins: " + (await r.text()).slice(0, 160)); return await r.json(); },
    createUser(customerId, email, name, password) { return this.admin("create_user", { customer_id: customerId, email, name: name || "", password: password || undefined }); },
    resetPassword(userId, password) { return this.admin("reset_password", { user_id: userId, password: password || undefined }); },
    setActive(userId, active) { return this.admin("set_active", { user_id: userId, active: !!active }); },
    renameUser(userId, name) { return this.admin("rename", { user_id: userId, name }); },
    removeUser(userId) { return this.admin("delete", { user_id: userId }); },
    async published(customerId) { const s = CLOUD.session() || {}; if (!s.org_id) return []; const r = await CLOUD.req("/rest/v1/portal_vessels?select=vessel_id,customer_id,updated_at,updated_by,hash:data->>hash,app_version:data->>appVersion,published_by:data->>publishedBy&org_id=eq." + s.org_id + (customerId ? "&customer_id=eq." + customerId : "")); if (!r.ok) throw new Error("Could not read what is published: " + (await r.text()).slice(0, 160)); return await r.json(); },
    // 4.13 · many vessels in one request (500 a batch): [{ vesselId, customerId, data }]
    async publishMany(items) { const s = CLOUD.session() || {}; if (!s.org_id) throw new Error("No company"); const now = new Date().toISOString(); const rows = (items || []).map((x) => ({ org_id: s.org_id, vessel_id: String(x.vesselId), customer_id: x.customerId, data: x.data || {}, updated_at: now, updated_by: s.user_id })); let n = 0; for (let i = 0; i < rows.length; i += 500) { const r = await CLOUD.req("/rest/v1/portal_vessels?on_conflict=org_id,vessel_id,customer_id", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(rows.slice(i, i + 500)) }); if (!r.ok) await this.fail("Could not publish", r); n += Math.min(500, rows.length - i); } return n; },
    async publish(vesselId, customerId, data) { const s = CLOUD.session() || {}; if (!s.org_id) throw new Error("No company"); const r = await CLOUD.req("/rest/v1/portal_vessels?on_conflict=org_id,vessel_id,customer_id", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=representation" }, body: JSON.stringify({ org_id: s.org_id, vessel_id: String(vesselId), customer_id: customerId, data: data || {}, updated_at: new Date().toISOString(), updated_by: s.user_id }) }); if (!r.ok) await this.fail("Could not publish", r); const rows = await r.json(); return Array.isArray(rows) ? rows[0] : rows; },
    async unpublish(vesselId, customerId) { const s = CLOUD.session() || {}; const r = await CLOUD.req("/rest/v1/portal_vessels?org_id=eq." + s.org_id + "&vessel_id=eq." + encodeURIComponent(String(vesselId)) + (customerId ? "&customer_id=eq." + customerId : ""), { method: "DELETE" }); if (!r.ok) await this.fail("Could not unpublish", r); return true; },
    async files(customerId, vesselId) { const s = CLOUD.session() || {}; if (!s.org_id) return []; const r = await CLOUD.req("/rest/v1/portal_files?select=id,customer_id,vessel_id,path,name,size,kind,section,uploaded_at&org_id=eq." + s.org_id + (customerId ? "&customer_id=eq." + customerId : "") + (vesselId ? "&vessel_id=eq." + encodeURIComponent(String(vesselId)) : "") + "&order=uploaded_at.desc"); if (!r.ok) throw new Error("Could not read the shared files: " + (await r.text()).slice(0, 160)); return await r.json(); },
    filePath(customerId, vesselId, section, name) { const s = CLOUD.session() || {}; return [s.org_id, customerId, String(vesselId), section || "documents", String(name || "file").replace(/[\\/]/g, "_")].join("/"); },
    async uploadFile(customerId, vesselId, section, blob, name) { const s = CLOUD.session() || {}; if (!s.org_id) throw new Error("No company"); const path = this.filePath(customerId, vesselId, section, name || blob.name); const r = await CLOUD.req("/storage/v1/object/portal/" + path.split("/").map(encodeURIComponent).join("/"), { method: "POST", headers: { "Content-Type": blob.type || "application/octet-stream", "x-upsert": "true" }, body: blob }); if (!r.ok) throw new Error("Upload failed: " + (await r.text()).slice(0, 160)); const row = { org_id: s.org_id, customer_id: customerId, vessel_id: String(vesselId), path, name: name || blob.name, size: blob.size || 0, kind: blob.type || "", section: section || "documents", uploaded_at: new Date().toISOString(), uploaded_by: s.user_id }; const r2 = await CLOUD.req("/rest/v1/portal_files", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify(row) }); if (!r2.ok) await this.fail("Could not record the file", r2); const rows = await r2.json(); return Array.isArray(rows) ? rows[0] : rows; },
    async deleteFile(row) { const s = CLOUD.session() || {}; await CLOUD.req("/storage/v1/object/portal/" + String(row.path).split("/").map(encodeURIComponent).join("/"), { method: "DELETE" }).catch(() => {}); const r = await CLOUD.req("/rest/v1/portal_files?org_id=eq." + s.org_id + "&id=eq." + row.id, { method: "DELETE" }); if (!r.ok) await this.fail("Could not remove the file", r); return true; },
    async downloadFile(row) { const r = await CLOUD.req("/storage/v1/object/authenticated/portal/" + String(row.path).split("/").map(encodeURIComponent).join("/")); if (!r.ok) throw new Error("Download failed: " + r.status); return await r.blob(); },
  },
};
// the guard itself: every fetch from the page passes through here
// ---------- 4.8 · realtime: one WebSocket to the workspace (Phoenix protocol, as Supabase Realtime speaks it) carries every change
// to the tables the suite reads — the book, shared and personal documents, files, messages, mail, invitations. Each change calls the
// refresh path that the polls already use, so nothing is trusted from the socket itself: a row arriving is a reason to fetch, not data.
// Without a socket (an old browser, a blocked port, the test harness) nothing changes: the polls carry on exactly as before.
CLOUD.TABLES = ["books", "suite_shared", "suite_docs", "vault_items", "msg_messages", "msg_threads", "msg_members", "msg_keys", "mail_messages", "invitations", "shared_items", "vessel_positions", "portal_vessels", "proship_rows"];
CLOUD.realtime = {
  ws: null, live: false, ref: 0, tries: 0, hb: null, timer: null, handlers: {}, joined: false, stopped: true, _last: 0, _hbRef: null, _joinFails: 0,
  url() { const c = CLOUD.cfg(); if (!c || !c.url || !c.key) return null; try { const u = new URL(c.url); if (!/\.supabase\.(co|in)$/.test(u.hostname)) return null; return "wss://" + u.host + "/realtime/v1/websocket?apikey=" + encodeURIComponent(c.key) + "&vsn=1.0.0"; } catch (e) { return null; } },
  // the token's remaining life: the socket is joined with a token that will live, and renewed before it runs out (an idle
  // session otherwise sits on an expired token that the server closes the channel for — and REST would only notice at the next 401)
  expiresIn() { try { const s = CLOUD.session(); const p = JSON.parse(atob(s.access_token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))); return p.exp ? p.exp * 1000 - Date.now() : Infinity; } catch (e) { return Infinity; } },
  async freshen() { if (this.expiresIn() < 120000 && (CLOUD.session() || {}).refresh_token) { try { await CLOUD.refresh(); } catch (e) { /* the next request will */ } } },
  start() { if (this.stopped) { this._joinFails = 0; this.tries = 0; } this.stopped = false; if (this.ws || this._starting || !CLOUD.signedIn() || typeof WebSocket === "undefined") return; const url = this.url(); if (!url) return; this._starting = true; this.freshen().then(() => { this._starting = false; if (this.stopped || this.ws) return; this.open(url); if (!this._life) this._life = setInterval(() => { if (this.live) this.freshen(); }, 5 * 60000); }); },
  open(url) { let ws; try { ws = new WebSocket(url); } catch (e) { return; } this.ws = ws;
    // the retry counter is reset only once the subscription is confirmed — a socket that opens but whose join is refused
    // (an older workspace without the publication, a quota) backs off like a dead one instead of looping every second
    ws.onopen = () => { this.join(); this.hb = setInterval(() => { if (this._hbRef) { try { ws.close(); } catch (e) { /* the close handler retries */ } return; } this._hbRef = this.send("phoenix", "heartbeat", {}); }, 30000); };
    ws.onmessage = (ev) => { let m; try { m = JSON.parse(ev.data); } catch (e) { return; } this.onMessage(m); };
    ws.onclose = () => { this.cleanup(); if (!this.stopped) this.retry(); };
    ws.onerror = () => { try { ws.close(); } catch (e) { /* closing */ } };
  },
  stop() { this.stopped = true; if (this.timer) clearTimeout(this.timer); this.timer = null; if (this._life) clearInterval(this._life); this._life = null; const ws = this.ws; this.cleanup(); if (ws) { try { ws.onclose = null; ws.close(); } catch (e) { /* nothing */ } } },
  cleanup() { if (this.hb) clearInterval(this.hb); this.hb = null; this._hbRef = null; this.ws = null; const was = this.live; this.live = false; this.joined = false; if (was) this.emit("_status", { live: false }); },
  retry() { if (this.timer) return; if (this._joinFails >= 6) { console.warn("realtime: the workspace refused the subscription repeatedly — polling only until the next sign-in"); return; } const wait = Math.min(30000, 1000 * Math.pow(2, this.tries++)) + Math.random() * 500; this.timer = setTimeout(() => { this.timer = null; this.start(); }, wait); },
  send(topic, event, payload) { if (!this.ws || this.ws.readyState !== 1) return null; const ref = String(++this.ref); try { this.ws.send(JSON.stringify({ topic, event, payload, ref })); } catch (e) { return null; } return ref; },
  topic: "realtime:xyntax",
  join() { const s = CLOUD.session() || {}; const config = { broadcast: { self: false }, presence: { key: "" }, postgres_changes: CLOUD.TABLES.map((table) => ({ event: "*", schema: "public", table })) }; this.send(this.topic, "phx_join", { config, access_token: s.access_token }); },
  reauth() { const s = CLOUD.session() || {}; if (this.joined && s.access_token) this.send(this.topic, "access_token", { access_token: s.access_token }); },
  onMessage(m) {
    if (m.topic === "phoenix") { this._hbRef = null; return; } // heartbeat replies
    if (m.event === "phx_reply" && m.payload && m.payload.status === "ok" && !this.joined) { this.joined = true; return; }
    if (m.event === "phx_reply" && m.payload && m.payload.status === "error") { this._joinFails++; console.warn("realtime: join refused", m.payload.response || m.payload); try { if (this.ws) this.ws.close(); } catch (e) { /* retried */ } return; }
    if (m.event === "phx_error" || m.event === "phx_close") { try { if (this.ws) this.ws.close(); } catch (e) { /* retried */ } return; }
    if (m.event === "system" && m.payload) { if (m.payload.status === "error") { this._joinFails++; console.warn("realtime:", m.payload.message || m.payload); try { if (this.ws) this.ws.close(); } catch (e) { /* retried */ } } else if (m.payload.status === "ok" && !this.live) { this.tries = 0; this._joinFails = 0; this.live = true; this.emit("_status", { live: true }); } return; }
    if (m.event !== "postgres_changes" || !m.payload || !m.payload.data) return;
    const d = m.payload.data; const table = d.table; const row = d.record || null; this._last = Date.now();
    if (d.type === "DELETE" && !row) return; // deletes are not filtered by row security: a key alone says nothing — the polls carry those
    this.emit(table, { table, type: d.type, row });
  },
  emit(table, detail) { for (const fn of (this.handlers[table] || [])) { try { fn(detail); } catch (e) { /* a handler's problem */ } } for (const fn of (this.handlers["*"] || [])) { try { fn(detail); } catch (e) { /* idem */ } } if (table !== "_status") { try { window.dispatchEvent(new CustomEvent("cloud-change", { detail })); } catch (e) { /* no DOM */ } } },
};
CLOUD.onChange = function (table, fn) { const R = this.realtime; (R.handlers[table] = R.handlers[table] || []).push(fn); return () => { R.handlers[table] = (R.handlers[table] || []).filter((f) => f !== fn); }; };
CLOUD.onChange("books", () => CLOUD.pollNow());
// 4.16 · the desktop receives the identity provider's answer through xyntax://auth/callback (main.js → preload → here)
if (typeof window !== "undefined" && window.xyntax && window.xyntax.onAuthCallback) window.xyntax.onAuthCallback((url) => { CLOUD.acceptAuthUrl(url).then((ok) => { if (ok) location.reload(); }).catch(() => {}); });
CLOUD.onChange("*", () => { CLOUD._vers = null; });
if (typeof window !== "undefined") window.addEventListener("focus", () => { CLOUD._vers = null; });
(function pinTransport() { if (typeof window === "undefined" || !window.fetch || window.__xyntaxPinned) return; window.__xyntaxPinned = true; const real = window.fetch.bind(window); window.fetch = function (input, init) { const url = typeof input === "string" ? input : (input && input.url) || String(input); if (!CLOUD.allowed(url)) return Promise.reject(new Error("Refused: " + url.replace(/^(https?:\/\/[^/]+).*$/, "$1") + " is not a host this app talks to")); return real(input, init); }; })();
