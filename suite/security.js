/* XYNTAX · security (4.7). Three things the Bulwark System had, brought into the Suite:
 *   · every export leaves with a TRACE CODE — ten letters and digits stamped into the file where a file can carry text (PDF footer,
 *     a trailing line in CSV/text, a property in vCard and iCalendar, a field in the backup) and written to the audit trail with
 *     what was exported, by whom, when and from which company; a document found outside the software is traced back from it;
 *   · LOCKDOWN — an account or a whole company can be locked by the owner, an administrator, the person (panic) or the automatic
 *     scan; the database then refuses every read and write of that data to every session, and only the person's encryption
 *     passphrase opens it again (K_lock, derived from the end-to-end secret, is proved to the server; the secret is never sent);
 *   · the AUDIT TRAIL and the owner's SECURITY CENTRE — posture checks, locks, alerts, the chain-verified trail, leak analysis
 *     with countermeasures, and the thresholds for the automatic lock. Administrators get the same for their own company.
 * Owner pages show references and names, never a person's content. */
(function () {
  const H = (...a) => SUITE.H(...a);
  const ALPHA = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const TEXT_EXT = /\.(txt|md|csv|tsv|html?|json|xbundle|vcf|ics|eml|xml|log)$/i;
  const fmt = (s) => (s ? new Date(s).toLocaleString() : "—");
  const short = (s) => (s ? String(s).slice(0, 8) : "");

  const SECURITY = (window.SECURITY = {
    // ---------- trace codes
    newCode() { const r = crypto.getRandomValues(new Uint8Array(10)); let c = ""; for (let i = 0; i < 10; i++) c += ALPHA[r[i] % 32]; return c.slice(0, 4) + "-" + c.slice(4, 8) + "-" + c.slice(8); },
    normCode(s) { const c = String(s || "").toUpperCase().replace(/[^A-Z2-9]/g, ""); return c.length === 10 ? c.slice(0, 4) + "-" + c.slice(4, 8) + "-" + c.slice(8) : null; },
    cloud() { try { return typeof CLOUD !== "undefined" && CLOUD.signedIn() && SUITE.db.cloud(); } catch (e) { return false; } },
    // one record in the audit trail (fire and forget; the server is the keeper of the chain)
    log(kind, ref, detail) { if (!this.cloud()) return; try { CLOUD.account("audit", { kind, ref: ref || null, detail: detail || {}, org: (CLOUD.state && CLOUD.state.org) || null }).catch(() => {}); } catch (e) { /* offline */ } },
    nextKind: null, mark(kind) { this.nextKind = kind; },
    async hashName(name) { try { const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(name || ""))); return Array.from(new Uint8Array(d)).slice(0, 8).map((b) => b.toString(16).padStart(2, "0")).join(""); } catch (e) { return ""; } },
    device() { try { return (SUITE.isMobile && SUITE.isMobile() ? "phone" : window.xyntax ? "desktop" : "browser") + " · " + (navigator.platform || ""); } catch (e) { return ""; } },
    // stamp the code into a text-bearing export; binary files are logged only
    async stamp(name, blob, code) {
      const ext = (name.match(/\.([a-z0-9]+)$/i) || [, ""])[1].toLowerCase(); if (!TEXT_EXT.test(name)) return blob;
      let text; try { text = await blob.text(); } catch (e) { return blob; } const type = blob.type || "text/plain";
      const nl = text.includes("\r\n") ? "\r\n" : "\n"; let out = text;
      if (ext === "json" || ext === "xbundle") { try { const j = JSON.parse(text); if (j && typeof j === "object" && !Array.isArray(j)) { j.trace = code; out = JSON.stringify(j, null, text.includes("\n  ") ? 2 : 0); } } catch (e) { /* not an object */ } }
      else if (ext === "html" || ext === "htm") out = this.stampHtml(text, code);
      else if (ext === "vcf") out = text.replace(/END:VCARD/i, "X-XYNTAX-TRACE:" + code + nl + "END:VCARD");
      else if (ext === "ics") out = text.replace(/END:VCALENDAR/i, "X-XYNTAX-TRACE:" + code + nl + "END:VCALENDAR");
      else if (ext === "eml" || ext === "xml") out = text + nl + (ext === "xml" ? "<!-- XYNTAX trace " + code + " -->" : "X-XYNTAX-Trace: " + code) + nl;
      else out = text.replace(/\s*$/, "") + nl + (ext === "csv" || ext === "tsv" ? "# " : "") + "XYNTAX trace " + code + nl;
      return new Blob([out], { type });
    },
    stampHtml(html, code) { const foot = '<div class="xy-trace" style="position:fixed;bottom:6mm;right:10mm;font:8px/1 Helvetica,Arial,sans-serif;color:#9aa0a6;letter-spacing:.06em">XYNTAX · ' + code + "</div><!-- XYNTAX trace " + code + " -->"; return /<\/body>/i.test(html) ? html.replace(/<\/body>/i, foot + "</body>") : html + foot; },
    async record(kind, name, blob, code, extra) { const detail = { what: kind === "download" ? "document" : "export", format: (String(name).match(/\.([a-z0-9]+)$/i) || [, ""])[1].toLowerCase(), bytes: blob && blob.size != null ? blob.size : (extra && extra.bytes) || 0, name_hash: await this.hashName(name), device: this.device(), ...(extra || {}) }; this.log(kind, code, detail); },

    // ---------- lockdown: the screen, the key, the poll
    me: null, locked: false,
    handle(me) {
      this.me = me || this.me; this.publishIfMissing(me);
      const org = (me && me.org_locked || []).find((o) => typeof CLOUD !== "undefined" && CLOUD.state && CLOUD.state.org === o.id);
      if (me && (me.locked || org)) { this.showLock(me, org); return true; }
      if (this.locked) this.hideLock(); return false;
    },
    async publishIfMissing(me) { try { if (!me || me.lock_key || me.locked || SUITE.e2e._lockKeyPublished) return; if (!(await SUITE.e2e.enabled())) return; if (!SUITE.e2e.pass) return; await SUITE.e2e.publishLockKey(); } catch (e) { /* later */ } },
    startPoll() { if (this._poll || !this.cloud()) return; this._poll = setInterval(async () => { try { if (!this.cloud()) return; const me = await (CLOUD.me ? CLOUD.me(true) : CLOUD.account("me")); this.handle(me); } catch (e) { if (/423|lockdown/i.test(String(e.message))) this.showLock({ locked: true, locked_reason: "This account is in lockdown." }); } }, 60000); },
    showLock(me, org) {
      this.locked = true; document.body.classList.add("sh-locked");
      // nothing decrypted stays in memory: the secret, the open caches, the lock screen is all there is
      try { SUITE.e2e.forget(); SUITE.db.cache = {}; SUITE.db.mem = {}; } catch (e) { /* ignore */ }
      let box = document.getElementById("shlock"); if (!box) { box = H("div", { id: "shlock" }); document.body.append(box); }
      box.innerHTML = "";
      const isAdminOfLockedOrg = org && typeof CLOUD !== "undefined" && CLOUD.state && CLOUD.state.role === "admin";
      const title = me.locked ? "This account is locked" : "This company is locked";
      const why = me.locked ? (me.locked_reason || "Locked.") : ((org && org.reason) || "Locked.") + " — " + (org ? org.name : "");
      const err = H("div", { class: "sh-err", style: "min-height:18px" });
      const pass = H("input", { type: "password", placeholder: "Encryption passphrase or recovery key", autocomplete: "off" });
      const canUnlock = me.locked || isAdminOfLockedOrg;
      const unlock = async () => { err.textContent = ""; btn.disabled = true; try { const r = await SUITE.e2e.resolve(pass.value); if (!r) throw new Error("That is not the right passphrase"); const key = await SUITE.e2e.lockKeyFor(r.secret); if (!key) throw new Error("Encryption is not set up on this account, so there is no key to unlock with — the software owner can unlock it"); if (!me.locked && !me.lock_key) { SUITE.e2e.remember(r.secret); await SUITE.e2e.publishLockKey(); } /* an administrator whose key was never registered (account open, company locked) registers it now */ await CLOUD.account("unlock", { key }); SUITE.e2e.remember(r.secret); this.hideLock(); SUITE.toast("Unlocked"); setTimeout(() => location.reload(), 300); } catch (e) { err.textContent = e.message; btn.disabled = false; } };
      const btn = H("button", { class: "primary", onclick: unlock }, "Unlock");
      pass.addEventListener("keydown", (e) => { if (e.key === "Enter") unlock(); });
      box.append(H("div", { class: "sh-lockcard sh-lockdown" },
        H("div", { class: "brand lg-brand", style: "margin-bottom:10px" }, SUITE.wordmark ? SUITE.wordmark() : "XYNTAX"),
        H("h2", {}, title),
        H("p", { class: "sh-dim" }, why),
        H("p", { class: "sh-dim", style: "font-size:12px;line-height:1.5" }, me.locked
          ? "While locked, nothing of yours can be read or written from any device or session — not even by someone holding your password. Only your encryption passphrase (or recovery key) opens it — or the software owner, from the Security centre, if the lock was theirs or you have lost both. Nobody can read your personal records in the meantime: there is no key to them on the server."
          : isAdminOfLockedOrg ? "An administrator unlocks the company with their own encryption passphrase. Until then nobody reads or writes its books, documents or conversations." : "Your personal apps are not affected. An administrator of the company, or the software owner, will unlock it."),
        canUnlock ? H("div", { class: "sh-lockform" }, pass, err, H("div", { class: "sh-toolbar", style: "justify-content:flex-end;margin:0" }, btn)) : null,
        H("div", { class: "sh-toolbar", style: "justify-content:space-between;margin-top:14px" },
          !me.locked ? H("button", { class: "quiet", onclick: () => { CLOUD.chooseOrg(null); location.reload(); } }, "Open my personal apps") : H("span"),
          H("button", { class: "quiet", onclick: () => { CLOUD.logout(); location.reload(); } }, "Sign out"))));
      setTimeout(() => pass.focus(), 50);
    },
    hideLock() { this.locked = false; document.body.classList.remove("sh-locked"); const b = document.getElementById("shlock"); if (b) b.remove(); },
    async lockMe() {
      if (!this.cloud()) return SUITE.toast("Only signed-in accounts can be locked");
      if (!(await SUITE.confirm({ title: "Lock your account now?", text: "Every session on every device loses access at once — books, documents, notes, mail and conversations become unreadable and unwritable on the server. Only your encryption passphrase (or recovery key) unlocks it. Use this when a device is lost or a password may be known to someone else." }, "Lock now", true))) return;
      // the key that will open it again must be on the server before the door shuts (the account refuses set_lock_key once locked)
      try { if (await SUITE.e2e.enabled()) { if (!(await SUITE.e2e.ensure())) return SUITE.toast("Not locked: the passphrase is needed first, it is what unlocks the account later"); await SUITE.e2e.publishLockKey(); } } catch (e) { /* the owner can still unlock */ }
      try { await CLOUD.account("lock_me"); this.showLock({ locked: true, locked_reason: "locked by you" }); } catch (e) { SUITE.toast(e.message); }
    },

    // ---------- the owner's Security centre and the administrator's Security page
    drawOwner(main, X) { drawCentre(main, X, true); },
    drawAdmin(main, X) { drawCentre(main, X, false); },
  });

  // ---------- hooks: every way a file leaves the suite
  if (typeof SUITE !== "undefined" && SUITE.download && !SUITE.download._traced) {
    const orig = SUITE.download.bind(SUITE);
    SUITE.download = async function (name, blob) { const kind = SECURITY.nextKind || "export"; SECURITY.nextKind = null; let out = blob; const code = SECURITY.newCode(); try { if (blob && typeof blob.text === "function") out = await SECURITY.stamp(String(name), blob, code); } catch (e) { out = blob; } SECURITY.record(kind, name, blob, code); return orig(name, out); };
    SUITE.download._traced = true;
  }
  if (typeof NATIVE !== "undefined") {
    if (NATIVE.savePDF && !NATIVE.savePDF._traced) { const o = NATIVE.savePDF.bind(NATIVE); NATIVE.savePDF = async function (name, html, opt) { const code = SECURITY.newCode(); SECURITY.record("export", name, null, code, { bytes: (html || "").length, format: "pdf" }); return o(name, SECURITY.stampHtml(html || "", code), opt); }; NATIVE.savePDF._traced = true; }
    if (NATIVE.saveText && !NATIVE.saveText._traced) { const o = NATIVE.saveText.bind(NATIVE); NATIVE.saveText = async function (name, content, filters, mime) { const code = SECURITY.newCode(); let out = content; try { out = await (await SECURITY.stamp(String(name), new Blob([content], { type: mime || "text/plain" }), code)).text(); } catch (e) { out = content; } SECURITY.record("export", name, null, code, { bytes: (content || "").length }); return o(name, out, filters, mime); }; NATIVE.saveText._traced = true; }
    if (NATIVE.saveBytes && !NATIVE.saveBytes._traced) { const o = NATIVE.saveBytes.bind(NATIVE); NATIVE.saveBytes = async function (name, bytes, mime) { const code = SECURITY.newCode(); SECURITY.record("export", name, null, code, { bytes: bytes ? bytes.length || bytes.byteLength || 0 : 0 }); return o(name, bytes, mime); }; NATIVE.saveBytes._traced = true; }
  }

  // ---------- the pages
  const KINDS = { signin: "Signed in", export: "Export", download: "Download", backup: "Backup", import: "Import", e2e_on: "Encryption on", passphrase_changed: "Passphrase changed", device: "Device", lock: "Locked", lock_self: "Locked (self)", unlock: "Unlocked", unlock_failed: "Unlock failed", unlock_by_admin: "Unlocked by admin", org_lock: "Company locked", org_unlock: "Company unlocked", autolock: "Automatic lock", sessions_revoked: "Sessions revoked", company_created: "Company created", company_deleted: "Company deleted", owner_joined: "Owner joined", user_created: "User created", user_removed: "User removed", role_set: "Role set", invite: "Invited", joined: "Joined", left: "Left", password_reset: "Password reset", report_handled: "Report handled", settings_changed: "Settings changed", scan: "Scan run", data_deleted: "Data deleted", account_deleted: "Account deleted" };
  const kindLabel = (k) => KINDS[k] || k;
  const who = (r) => (r.actor_name || r.actor_email || (r.actor ? short(r.actor) + "…" : "system"));
  const tag = (t, cls) => H("span", { class: "sh-tag" + (cls ? " " + cls : "") }, t);

  function drawCentre(main, X, owner) {
    const { h1, panel, row, tbl } = X; main.innerHTML = "";
    const st = (drawCentre.st = drawCentre.st || { tab: owner ? "posture" : "audit" });
    const org = !owner && typeof CLOUD !== "undefined" ? CLOUD.state.org : null;
    if (!owner && !org) { main.append(h1("Security", "open your company first")); return; }
    const tabs = owner ? [["posture", "Posture"], ["locks", "Locks"], ["alerts", "Alerts"], ["audit", "Audit trail"], ["leak", "Leak analysis"], ["settings", "Settings"]] : [["audit", "Audit trail"], ["leak", "Exports"], ["locks", "Locks"]];
    const bar = H("div", { class: "sh-subtabs" }, tabs.map(([id, l]) => H("button", { class: st.tab === id ? "on" : "", onclick: () => { st.tab = id; drawCentre(main, X, owner); } }, l)));
    main.append(h1(owner ? "Security centre" : "Security", owner ? "what protects the service, who is locked out, what left the building, and how to respond" : "your company's trail, its exports and the locks you can apply", H("button", { class: "danger", onclick: () => SECURITY.lockMe() }, "Lock my account")));
    main.append(bar);
    const body = H("div"); main.append(body);
    ({ posture, locks, alerts, audit, leak, settings })[st.tab](body, X, owner, org);
  }
  const loading = (box) => { box.innerHTML = ""; box.append(H("div", { class: "sh-dim", style: "padding:14px 0" }, "Loading…")); };
  const fail = (box, e) => { box.innerHTML = ""; box.append(H("div", { class: "sh-err" }, e.message || String(e), /Unknown action|admin function/.test(e.message || "") ? " — the admin function is not up to date (deploy cloud-admin-function.ts)" : "")); };

  async function posture(box, X) {
    const { panel, row } = X; loading(box);
    try {
      const checks = await CLOUD.admin("security_posture");
      box.innerHTML = "";
      const p = panel("Posture", H("div", { class: "sh-dim", style: "margin-bottom:8px" }, "Checked on the database just now. Every line should be green before the first outside user."));
      for (const c of checks || []) p.append(row(c.label, tag(c.ok ? "OK" : "ATTENTION", c.ok ? "ok" : "warn"), c.detail || ""));
      box.append(p);
      const scan = H("button", { onclick: async () => { scan.disabled = true; try { const r = await CLOUD.admin("anomaly_scan"); SUITE.toast(r.locked ? r.locked + " account(s) locked" : "Nothing over the thresholds"); } catch (e) { SUITE.toast(e.message); } scan.disabled = false; } }, "Run the scan now");
      box.append(panel("Automatic lock", row("Scan", scan, "locks any account whose exports or downloads in the last hour exceed the thresholds under Settings; pg_cron runs it every five minutes")));
      box.append(panel("What this protects", H("div", { class: "sh-dim", style: "line-height:1.6;font-size:13px" }, "Row-level security keeps every table closed except to its members; the lockdown policies close them further for a locked person or company, to every session including stolen ones. The audit trail is hash-chained: a changed or removed record breaks the chain and Verify says where. Personal records are encrypted on the device under a passphrase the service does not have — a leak of the database exposes ciphertext.")));
    } catch (e) { fail(box, e); }
  }
  async function locks(box, X, owner, org) {
    const { panel, tbl } = X; loading(box);
    try {
      const r = await CLOUD.admin("locks"); box.innerHTML = "";
      const act = async (fn, msg) => { try { await fn(); SUITE.toast(msg); locks(box, X, owner, org); } catch (e) { SUITE.toast(e.message); } };
      box.append(panel("Locked accounts", tbl([{ l: "Person" }, { l: "Since" }, { l: "Reason", wrap: 1 }, { l: "" }], (r.users || []).map((u) => ({ cells: [H("span", {}, u.name || "", H("div", { class: "sh-faint", style: "font-size:11px" }, u.email || "")), fmt(u.locked_at), u.locked_reason || "", H("span", { class: "sh-toolbar", style: "margin:0;justify-content:flex-end" }, H("button", { class: "quiet", onclick: () => act(() => CLOUD.admin("unlock_user", { user_id: u.user_id }), "Unlocked") }, "Unlock"), H("button", { class: "quiet", onclick: () => act(() => CLOUD.admin("revoke_sessions", { user_id: u.user_id }), "Sessions revoked") }, "Revoke sessions"))] })), { empty: "Nobody is locked out." })));
      box.append(panel("Locked companies", tbl([{ l: "Company" }, { l: "Since" }, { l: "Reason", wrap: 1 }, { l: "" }], (r.orgs || []).map((o) => ({ cells: [o.name, fmt(o.locked_at), o.locked_reason || "", owner ? H("button", { class: "quiet", onclick: () => act(() => CLOUD.admin("unlock_org", { org: o.id }), "Company unlocked") }, "Unlock") : H("span", { class: "sh-faint" }, "unlock with your passphrase on the lock screen")] })), { empty: "No company is locked." })));
      if (!owner) box.append(panel("Panic", H("div", { class: "sh-toolbar" }, H("button", { class: "danger", onclick: () => act(async () => { if (!(await SUITE.confirm({ title: "Lock the whole company?", text: "Every member loses access to the books, documents and conversations at once. Only an administrator's encryption passphrase, or the software owner, unlocks it." }, "Lock the company", true))) throw new Error("Cancelled"); await CLOUD.admin("lock_org", { org, reason: "locked by an administrator" }); }, "Company locked") }, "Lock the company now"))));
    } catch (e) { fail(box, e); }
  }
  async function alerts(box, X) {
    const { panel, tbl } = X; loading(box);
    try {
      const rows = await CLOUD.admin("alerts"); box.innerHTML = "";
      box.append(panel("The last 7 days", tbl([{ l: "When" }, { l: "What" }, { l: "Who" }, { l: "Detail", wrap: 1 }], (rows || []).map((r) => ({ cells: [fmt(r.at), tag(kindLabel(r.kind), /lock/.test(r.kind) ? "warn" : ""), r.kind === "autolock" || r.kind === "lock" ? (r.ref ? short(r.ref) + "…" : "") : who(r), summarise(r)] })), { empty: "Quiet." })));
    } catch (e) { fail(box, e); }
  }
  const summarise = (r) => { const d = r.detail || {}; const bits = []; if (d.reason) bits.push(d.reason); if (d.kind && d.count) bits.push(d.count + " " + d.kind + "s in an hour"); if (d.format) bits.push(d.format.toUpperCase()); if (d.bytes) bits.push(SUITE.fmtBytes(d.bytes)); if (d.device) bits.push(d.device); if (r.org_name) bits.push(r.org_name); if (d.role) bits.push("role " + d.role); return bits.join(" · "); };
  async function audit(box, X, owner, org) {
    const { panel, tbl } = X; loading(box);
    const st = (audit.st = audit.st || { kind: "" });
    try {
      const rows = await CLOUD.admin("audit_list", { org: org || undefined, kind: st.kind || undefined, limit: 200 }); box.innerHTML = "";
      const sel = H("select", { style: "width:auto", onchange: (e) => { st.kind = e.target.value; audit(box, X, owner, org); } }, H("option", { value: "" }, "Every kind"), Object.keys(KINDS).map((k) => H("option", { value: k, selected: st.kind === k ? true : null }, KINDS[k])));
      const verify = owner ? H("button", { onclick: async () => { verify.disabled = true; try { const v = await CLOUD.admin("audit_verify"); SUITE.toast(v.ok ? "Chain intact · " + v.count + " records · head " + short(v.head) : "BROKEN at record " + v.broken_at); } catch (e) { SUITE.toast(e.message); } verify.disabled = false; } }, "Verify chain") : null;
      box.append(H("div", { class: "sh-toolbar" }, sel, verify, H("span", { class: "sh-faint", style: "margin-left:auto;font-size:11px" }, "latest 200 · every record is chained to the one before it")));
      box.append(panel("", tbl([{ l: "When" }, { l: "What" }, { l: "Who" }, { l: "Company" }, { l: "Reference" }, { l: "Detail", wrap: 1 }], (rows || []).map((r) => ({ cells: [fmt(r.at), kindLabel(r.kind), who(r), r.org_name || "", r.ref || "", summarise(r)] })), { empty: "No records yet." })));
    } catch (e) { fail(box, e); }
  }
  async function leak(box, X, owner, org) {
    const { panel, row, tbl } = X; box.innerHTML = "";
    const st = (leak.st = leak.st || { days: 30 });
    const code = H("input", { placeholder: "Trace code from the document, e.g. XR7K-2PQ9-M4", style: "min-width:260px" });
    const result = H("div");
    const look = async () => { const c = SECURITY.normCode(code.value); if (!c) return SUITE.toast("A trace code has ten letters and digits"); loading(result); try { const r = await CLOUD.admin("trace", { code: c }); result.innerHTML = ""; if (!r.found || !r.found.length) { result.append(H("div", { class: "sh-dim" }, "No export carries " + c + ". The code may be mistyped, the file may predate 4.7, or it may have been produced outside the suite.")); return; } const f = r.found[0]; const d = f.detail || {}; result.append(panel("Found", row("Who", H("b", {}, who(f)), f.actor_email || ""), row("When", fmt(f.at)), row("What", (d.what || f.kind) + (d.format ? " · " + d.format.toUpperCase() : "") + (d.bytes ? " · " + SUITE.fmtBytes(d.bytes) : "")), row("Company", f.org_name || "— (personal)"), row("Device", d.device || "—"), row("Record", "#" + f.id + " · " + short(f.hash))), countermeasures(f, owner, org, X)); if (r.around && r.around.length > 1) result.append(panel("The same person, a day either side", tbl([{ l: "When" }, { l: "What" }, { l: "Reference" }, { l: "Detail", wrap: 1 }], r.around.map((a) => ({ cells: [fmt(a.at), kindLabel(a.kind), a.ref || "", summarise(a)] }))))); } catch (e) { fail(result, e); } };
    code.addEventListener("keydown", (e) => { if (e.key === "Enter") look(); });
    box.append(panel(owner ? "Leak analysis" : "Trace an export", H("div", { class: "sh-dim", style: "margin-bottom:10px;font-size:13px;line-height:1.5" }, "Every PDF, CSV, text, vCard, calendar and backup the suite produces carries a trace code (PDF: bottom right; text files: the last line; backups: the trace field). Paste it here to see who produced it, when, from which company and device. A photographed screen carries no code; the audit trail still shows who opened what."), H("div", { class: "sh-toolbar" }, code, H("button", { class: "primary", onclick: look }, "Trace")), result));
    const list = H("div"); loading(list); box.append(panel("Exports in the last " + st.days + " days", H("div", { class: "sh-toolbar", style: "margin-bottom:8px" }, [7, 30, 90].map((d) => H("button", { class: st.days === d ? "" : "quiet", onclick: () => { st.days = d; leak(box, X, owner, org); } }, d + " days"))), list));
    try { const r = await CLOUD.admin("exports", { org: org || undefined, days: st.days }); list.innerHTML = ""; list.append(tbl([{ l: "Person" }, { l: "Exports", num: 1 }, { l: "Last" }, { l: "" }], (r.by_person || []).map((p) => ({ cells: [H("span", {}, p.name || "", H("div", { class: "sh-faint", style: "font-size:11px" }, p.email || "")), String(p.n), fmt(p.last), owner || org ? H("span", { class: "sh-toolbar", style: "margin:0;justify-content:flex-end" }, H("button", { class: "quiet danger", onclick: () => act(X, () => CLOUD.admin("lock_user", { user_id: p.actor, reason: "locked after a leak review" }), "Account locked", () => leak(box, X, owner, org)) }, "Lock"), H("button", { class: "quiet", onclick: () => act(X, () => CLOUD.admin("revoke_sessions", { user_id: p.actor }), "Sessions revoked") }, "Revoke sessions")) : ""] })), { empty: "No exports in this period." })); list.append(H("details", { style: "margin-top:10px" }, H("summary", { class: "sh-dim" }, "Every export (" + (r.rows || []).length + ")"), tbl([{ l: "When" }, { l: "Who" }, { l: "Code" }, { l: "Company" }, { l: "Detail", wrap: 1 }], (r.rows || []).map((a) => ({ cells: [fmt(a.at), who(a), a.ref || "", a.org_name || "", summarise(a)] }))))); } catch (e) { fail(list, e); }
  }
  const act = async (X, fn, msg, after) => { try { await fn(); SUITE.toast(msg); if (after) after(); } catch (e) { SUITE.toast(e.message); } };
  function countermeasures(f, owner, org, X) {
    const { panel } = X; const uid = f.actor; const btns = [];
    if (uid) { btns.push(H("button", { class: "danger", onclick: () => act(X, () => CLOUD.admin("lock_user", { user_id: uid, reason: "locked after a leak review (" + (f.ref || "") + ")" }), "Account locked — only their passphrase unlocks it") }, "Lock the account")); btns.push(H("button", { onclick: () => act(X, () => CLOUD.admin("revoke_sessions", { user_id: uid }), "Every session signed out") }, "Revoke sessions")); }
    if (f.org_id && (owner || f.org_id === org)) btns.push(H("button", { class: "danger", onclick: () => act(X, () => CLOUD.admin("lock_org", { org: f.org_id, reason: "locked after a leak review (" + (f.ref || "") + ")" }), "Company locked") }, "Lock the company"));
    if (owner) btns.push(H("button", { onclick: () => { drawCentre.st.tab = "settings"; const main = document.querySelector("#sapp .sh-main") || document.body; drawCentre(main, X, true); } }, "Tighten thresholds"));
    return panel("Countermeasures", H("div", { class: "sh-toolbar" }, btns), H("div", { class: "sh-faint", style: "font-size:11px;margin-top:6px;line-height:1.5" }, "Messaging keys turn over by themselves on the next epoch (Messages → Details → New epoch now, in each conversation); a lock stops the person's devices from reading or sending anything in the meantime."));
  }
  async function settings(box, X) {
    const { panel, row } = X; loading(box);
    try {
      const s = await CLOUD.admin("security_settings"); box.innerHTML = "";
      const num = (k) => H("input", { type: "number", min: 1, value: s[k], style: "width:110px", onchange: async (e) => { try { await CLOUD.admin("security_settings", { set: { [k]: +e.target.value } }); SUITE.toast("Saved"); } catch (err) { SUITE.toast(err.message); } } });
      const auto = H("input", { type: "checkbox", checked: s.auto_lock ? true : null, onchange: async (e) => { try { await CLOUD.admin("security_settings", { set: { auto_lock: e.target.checked } }); SUITE.toast(e.target.checked ? "Automatic lock on" : "Automatic lock off"); } catch (err) { SUITE.toast(err.message); } } });
      box.append(panel("Thresholds", row("Exports per hour", num("export_per_hour"), "PDFs, CSV, text, vCard, calendar and backups; above this an account is locked automatically"), row("Document downloads per hour", num("downloads_per_hour"), "files opened or saved from Documents"), row("Automatic lock", auto, "the five-minute scan locks accounts over the thresholds; the owner unlocks them here, or the person with their passphrase")));
      box.append(panel("Last change", H("div", { class: "sh-dim" }, s.updated_at ? fmt(s.updated_at) : "never")));
    } catch (e) { fail(box, e); }
  }

  const isOwner = () => typeof CLOUD !== "undefined" && CLOUD.state && CLOUD.state.isOwner;
  const isAdmin = () => typeof CLOUD !== "undefined" && CLOUD.state && CLOUD.state.role === "admin" && CLOUD.active() && !isOwner();
  window.SETTINGS_EXTRA = (window.SETTINGS_EXTRA || []).concat([
    { id: "security_centre", label: "Security centre", group: "owner", when: isOwner, draw: (m, X) => SECURITY.drawOwner(m, X) },
    { id: "company_security", label: "Security", group: "admin", when: isAdmin, draw: (m, X) => SECURITY.drawAdmin(m, X) },
  ]);
})();

/* ---------- 4.16 · IDENTITY: two-factor (TOTP) enrolment and step-up, company security settings, single sign-on, error reports.
 * The server half is in cloud.js (CLOUD.mfa / CLOUD.sso / CLOUD.orgSettings / CLOUD.reportError) and the admin function; the
 * database refuses writes to company tables without aal2 when the company requires two-factor for the person's role (mfa_guard). */
(function () {
  const H = (...a) => SUITE.H(...a);
  const C = () => (typeof CLOUD !== "undefined" ? CLOUD : null);
  const signed = () => { const c = C(); try { return !!(c && c.signedIn && c.signedIn()); } catch (e) { return false; } };
  const ID = (window.IDENTITY = {});

  // ---- the code prompt used at sign-in and before sensitive changes; returns { code } | { recovery } | null
  ID.prompt = (ctx) => new Promise((resolve) => {
    let useRecovery = false;
    const code = H("input", { type: "text", inputmode: "numeric", autocomplete: "one-time-code", maxlength: "6", placeholder: "6-digit code", class: "id-code", "aria-label": "Authenticator code" });
    const rec = H("input", { type: "text", autocomplete: "off", placeholder: "XXXXX-XXXXX", class: "id-rec", style: "display:none", "aria-label": "Recovery code" });
    const toggle = H("button", { type: "button", class: "quiet id-switch", onclick: () => { useRecovery = !useRecovery; code.style.display = useRecovery ? "none" : ""; rec.style.display = useRecovery ? "" : "none"; toggle.textContent = useRecovery ? "Use the authenticator app" : "Use a recovery code instead"; (useRecovery ? rec : code).focus(); } }, "Use a recovery code instead");
    const body = H("div", { class: "id-prompt" }, code, rec, toggle, ctx && ctx.attempt > 1 ? H("div", { class: "sh-err" }, "That code did not work — try the newest one (attempt " + ctx.attempt + " of 5)") : null);
    SUITE.dialog({ title: "Two-factor authentication", text: (ctx && ctx.reason) || "Enter the 6-digit code from your authenticator app.", body, ok: "Verify", must: true,
      validate: () => { if (useRecovery) { if (rec.value.replace(/[^A-Za-z0-9]/g, "").length < 8) throw new Error("Enter one of your recovery codes"); } else if (!/^\d{6}$/.test(code.value.trim())) throw new Error("Six digits"); } })
      .then((v) => { if (v === null || v === undefined) return resolve(null); resolve(useRecovery ? { recovery: rec.value.trim() } : { code: code.value.trim() }); });
  });
  const install = () => { const c = C(); if (c && c.mfa && !c.mfa.prompt) c.mfa.prompt = ID.prompt; };
  install(); document.addEventListener("DOMContentLoaded", install);

  // ---- recovery codes: shown once, kept by the server as hashes
  ID.newRecovery = async () => {
    const c = C(); const codes = c.mfa.newCodes(8); const hashes = []; for (const x of codes) hashes.push(await c.mfa.hash(x));
    await c.mfa.setRecovery(hashes);
    const list = H("ol", { class: "id-codes" }, codes.map((x) => H("li", {}, H("code", {}, x))));
    await SUITE.dialog({ title: "Your recovery codes", text: "Each code works once, if you lose the phone with the authenticator. Keep them somewhere safe — they are not shown again.", body: H("div", {}, list, H("div", { class: "sh-toolbar", style: "margin-top:10px" }, H("button", { type: "button", onclick: () => SUITE.copy(codes.join("\n")) }, "Copy"), H("button", { type: "button", onclick: () => SUITE.download("xyntax-recovery-codes.txt", new Blob(["XYNTAX recovery codes — each works once\n\n" + codes.join("\n") + "\n"], { type: "text/plain" })) }, "Download"))), ok: "I have saved them", cancel: "Close", must: true });
    return codes;
  };

  // ---- enrol: create a TOTP factor, show its QR (an SVG the server returns — nothing is fetched) and the secret, verify one code
  ID.enrol = async (after) => {
    const c = C(); let f;
    try { f = await c.mfa.enrol("XYNTAX " + (SUITE.isMobile && SUITE.isMobile() ? "phone" : "desktop")); } catch (e) { SUITE.toast(e.message); return false; }
    const t = f.totp || {}; const qr = H("div", { class: "id-qr", "aria-label": "QR code for the authenticator app" });
    if (t.qr_code && /^data:image\/svg\+xml/.test(t.qr_code)) { const svg = decodeURIComponent(t.qr_code.replace(/^data:image\/svg\+xml;(utf-8|charset=utf-8)?,?/, "")); if (/^\s*<svg[\s>]/i.test(svg) && !/<script|on\w+=/i.test(svg)) qr.innerHTML = svg; }
    if (!qr.innerHTML) qr.append(H("div", { class: "sh-dim" }, "Scan not available — type the key below into the app."));
    const secret = String(t.secret || "").replace(/(.{4})/g, "$1 ").trim();
    const code = H("input", { type: "text", inputmode: "numeric", autocomplete: "one-time-code", maxlength: "6", placeholder: "6-digit code", class: "id-code" });
    const body = H("div", { class: "id-enrol" }, H("ol", { class: "id-steps" }, H("li", {}, "Open an authenticator app (Microsoft Authenticator, Google Authenticator, 1Password, Authy…)."), H("li", {}, "Scan the code, or enter the key by hand."), H("li", {}, "Type the 6-digit code it shows.")), qr, secret ? H("div", { class: "id-secret" }, H("span", { class: "sh-faint" }, "Key"), H("code", {}, secret), H("button", { type: "button", class: "quiet", onclick: () => SUITE.copy(String(t.secret || "")) }, "Copy")) : null, code);
    const ok = await SUITE.dialog({ title: "Set up two-factor authentication", body, ok: "Verify and turn on", validate: async () => { if (!/^\d{6}$/.test(code.value.trim())) throw new Error("Six digits from the app"); const ch = await c.mfa.challenge(f.id); await c.mfa.verify(f.id, ch.id, code.value.trim()); } });
    if (!ok) { try { await c.mfa.unenrol(f.id); } catch (e) { /* an unverified factor expires by itself */ } return false; }
    c.state.mfa = { ...(c.state.mfa || {}), enrolled: true };
    if (typeof SECURITY !== "undefined") SECURITY.log("mfa_enrolled", null, {});
    await ID.newRecovery(); SUITE.toast("Two-factor authentication is on"); if (after) after(); return true;
  };
  ID.remove = async (factorId, after) => {
    const c = C(); if (!(await SUITE.confirm({ title: "Turn two-factor off?", text: "Signing in will need only the password. If your company requires two-factor for your role, changes to company data are refused until you set it up again." }, "Turn off", true))) return;
    if (c.mfa.aal() !== "aal2" && !(await c.mfa.stepUp(factorId))) return SUITE.toast("Not changed — the code is needed");
    try { await c.mfa.unenrol(factorId); await c.mfa.setRecovery([]); c.state.mfa = { ...(c.state.mfa || {}), enrolled: false }; if (typeof SECURITY !== "undefined") SECURITY.log("mfa_removed", null, {}); SUITE.toast("Two-factor is off"); } catch (e) { SUITE.toast(e.message); }
    if (after) after();
  };

  // ---- Settings → Security and privacy: the person's panel
  ID.panel = (X) => {
    const { panel, row } = X; const box = panel("Two-factor authentication", H("div", { class: "sh-dim" }, "Checking…"));
    const draw = () => C().mfa.status().then((s) => {
      box.innerHTML = ""; const f = (s.factors || [])[0]; const req = C().mfa.requiredBy().length > 0;
      box.append(H("h3", {}, "Two-factor authentication", H("span", { class: "sh-tag " + (f ? "ok" : req ? "warn" : "") }, f ? "on" : req ? "required" : "off")));
      box.append(H("div", { class: "sh-dim", style: "line-height:1.5;margin-bottom:10px" }, "A code from an app on your phone, asked for at every sign-in on a new session. A stolen password alone then opens nothing." + (req ? " Your company requires it for your role: changes to company data are refused until it is on." : "")));
      if (!f) box.append(row("Authenticator app", H("button", { class: "primary", onclick: () => ID.enrol(draw) }, "Set up"), "about a minute; you get eight recovery codes"));
      else {
        box.append(row("Authenticator app", H("div", { class: "sh-toolbar", style: "margin:0;justify-content:flex-end" }, H("span", { class: "sh-dim" }, (f.name || "Authenticator") + " · since " + (f.created_at ? new Date(f.created_at).toLocaleDateString() : "—")), H("button", { class: "quiet danger", onclick: () => ID.remove(f.id, draw) }, "Turn off"))));
        box.append(row("Recovery codes", H("div", { class: "sh-toolbar", style: "margin:0;justify-content:flex-end" }, H("span", { class: "sh-dim" }, (s.recoveryLeft || 0) + " left"), H("button", { onclick: async () => { if (C().mfa.aal() !== "aal2" && !(await C().mfa.stepUp(f.id))) return; await ID.newRecovery(); draw(); } }, "New codes")), "making new codes retires the old ones"));
        box.append(row("This session", H("span", { class: "sh-tag " + (C().mfa.aal() === "aal2" ? "ok" : "") }, C().mfa.aal() === "aal2" ? "verified with the code" : "password only"), C().mfa.aal() === "aal2" ? "" : H("button", { class: "quiet", onclick: async () => { if (await C().mfa.stepUp(f.id)) { SUITE.toast("Verified"); draw(); } } }, "Verify now")));
      }
    }).catch((e) => { box.innerHTML = ""; box.append(H("h3", {}, "Two-factor authentication"), H("div", { class: "sh-err" }, /Unknown action|admin function/i.test(e.message) ? "The workspace's admin function is older than this app (GUIDE §2)." : e.message)); });
    draw(); return box;
  };

  // ---- error reports: the person's choice on this device; sent only when the company allows them too
  ID.reportsOn = () => { try { return !!SUITE.prefs.get().errorReports; } catch (e) { return false; } };
  const scrub = (s) => String(s || "").replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "<email>").replace(/\b\d{5,}\b/g, "<n>").replace(/([?&#])[^\s)'"]*/g, "$1…").replace(/(access_token|refresh_token|apikey)=\S+/gi, "$1=…").slice(0, 2000);
  let sent = 0; const seen = new Set();
  ID.report = (message, stack) => {
    if (!ID.reportsOn() || !signed() || sent >= 10) return;
    const c = C(); const org = (c.state && c.state.orgSettings) || null; if (org && org.errorReports === false) return;
    const key = String(message).slice(0, 120); if (seen.has(key)) return; seen.add(key); sent++;
    c.reportError({ app: (document.body && document.body.dataset.app) || "", message: scrub(message), stack: scrub(stack), version: SUITE._ver || "", platform: window.xyntax ? "desktop" : SUITE.host && SUITE.host.mobile ? "phone" : "browser" }).catch(() => {});
  };
  window.addEventListener("error", (e) => ID.report(e.message || "error", e.error && e.error.stack));
  window.addEventListener("unhandledrejection", (e) => { const r = e.reason || {}; ID.report(r.message || String(r), r.stack); });

  // ---- company security (administrators): require two-factor, single sign-on domains, error reports
  ID.companyPanel = (X) => {
    const { panel, row } = X; const org = (C().session() || {}).org_id; const box = panel("Company security", H("div", { class: "sh-dim" }, "Loading…"));
    const tog = (on, fn) => H("label", { class: "st-tog" + (on ? " on" : "") }, H("input", { type: "checkbox", checked: on ? true : null, onchange: (e) => { e.target.closest(".st-tog").classList.toggle("on", e.target.checked); fn(e.target.checked); } }), H("i"));
    const save = async (set) => { try { const s = await C().setOrgSettings(org, set); C().state.orgSettings = s; SUITE.toast("Saved"); draw(s); } catch (e) { SUITE.toast(e.message); } };
    const draw = (s) => {
      box.innerHTML = ""; box.append(H("h3", {}, "Company security", H("span", { class: "sh-faint", style: "font-size:11px;margin-left:8px" }, (C().state.orgName || ""))));
      box.append(row("Require two-factor for administrators", tog(!!s.mfaRequired, (v) => save({ mfaRequired: v })), "enforced by the database: an administrator's session without the code cannot change company data"));
      // 4.34 · everyone, every device: the database then shows and accepts nothing of the company without the code, whatever program asks
      box.append(row("Require two-step verification for everyone, on every device", tog(!!s.mfaEveryone, async (v) => { if (v && !(await SUITE.confirm({ title: "Require it for everyone?", text: "Every person of this company will need an authenticator code on the desktop, the phone and in the browser. People who have not set one up are asked to do so at their next sign-in, and see none of the company's data until they have. Your own code is asked for now." }, "Require for everyone"))) { draw(s); return; } save({ mfaEveryone: v }); }), "enforced by the database for reading and writing; switching it on or off needs your own authenticator code"));
      const emails = H("textarea", { rows: "2", placeholder: "approver@company.com, controller@company.com", style: "width:100%" }); emails.value = (s.mfaRequiredFor || []).join(", ");
      box.append(row("Also require it for", H("div", { style: "width:100%" }, emails, H("button", { style: "margin-top:6px", onclick: () => save({ mfaRequiredFor: emails.value.split(/[\s,;]+/).filter(Boolean) }) }, "Save list")), "approvers and anyone who pays; applies when the switch above is on"));
      const doms = H("input", { type: "text", placeholder: "company.com", value: (s.ssoDomains || []).join(", ") });
      const role = H("select", { style: "width:auto" }, CLOUD.ROLES.map((x) => [x.v, x.l]).map(([v, l]) => H("option", { value: v, selected: (s.ssoDefaultRole || "viewer") === v ? true : null }, l)));
      box.append(row("Single sign-on domains", H("div", { style: "width:100%" }, doms, H("div", { class: "sh-toolbar", style: "margin:6px 0 0" }, H("span", { class: "sh-faint" }, "New people join as"), role, H("button", { onclick: () => save({ ssoDomains: doms.value.split(/[\s,;]+/).filter(Boolean), ssoDefaultRole: role.value }) }, "Save"))), "people from these domains who sign in through your identity provider join the company automatically (set up in GUIDE §12)"));
      box.append(row("Error reports", tog(s.errorReports !== false, (v) => save({ errorReports: v })), "lets members who opt in send technical error messages (never content) to the software owner"));
    };
    C().orgSettings(org).then((s) => { C().state.orgSettings = s; draw(s); }).catch((e) => { box.innerHTML = ""; box.append(H("h3", {}, "Company security"), H("div", { class: "sh-err" }, e.message)); });
    return box;
  };

  // ---- after sign-in: a company that requires two-factor gets it set up (or the code asked for) before work starts
  let checked = false;
  ID.enforce = async () => {
    const c = C(); if (!signed() || !c.state || !c.state.mfa) return; const org = (c.session() || {}).org_id; if (!org) return;
    if (c.mfa.needsEnrolment(org) && !checked) { checked = true; const go = await SUITE.confirm({ title: "Two-factor authentication required", text: (c.state.orgName || "Your company") + " requires two-factor authentication for your role. Until it is set up you can read, but changes to company data are refused." }, "Set it up now"); if (go) await ID.enrol(); }
    else if (c.mfa.needsStepUp(org) && !checked) { checked = true; const ok = await c.mfa.stepUp(); if (!ok) SUITE.toast("Read-only until the code is entered (Settings → Security and privacy)"); }
  };
  window.addEventListener("cloud-signed-in", () => setTimeout(() => ID.enforce(), 800));
  document.addEventListener("DOMContentLoaded", () => { let n = 0; const t = setInterval(() => { n++; if (C() && C().state && C().state.mfa) { clearInterval(t); ID.enforce(); } else if (n > 20) clearInterval(t); }, 1000); });

  // ---- single sign-on on the sign-in card, and the web callback (#access_token=…) when the page itself is the redirect target
  const addSso = () => {
    const c = C(); const box = document.getElementById("login"); if (!c || !c.sso || !c.sso.enabled() || !box) return;
    const card = box.querySelector(".card"); if (!card || card.querySelector(".id-sso") || !card.querySelector('input[type="password"]')) return;
    const btn = H("button", { type: "button", class: "id-sso", onclick: async () => { const u = card.querySelector('input[type="text"],input[type="email"]'); btn.disabled = true; btn.textContent = "Opening your company's sign-in…"; try { await c.sso.start(c.sso.domainFor(u && u.value)); btn.textContent = "Finish signing in in the browser window"; } catch (e) { btn.disabled = false; btn.textContent = "Sign in with company SSO"; SUITE.toast ? SUITE.toast(e.message) : alert(e.message); } } }, "Sign in with company SSO");
    const primary = card.querySelector("button.primary"); const sep = H("div", { class: "id-or" }, H("span", {}, "or"));
    if (primary && primary.parentNode) { primary.after(sep, btn); } else card.append(sep, btn);
  };
  document.addEventListener("DOMContentLoaded", () => {
    const box = document.getElementById("login"); if (box && window.MutationObserver) new MutationObserver(addSso).observe(box, { childList: true, subtree: true }); addSso(); setTimeout(addSso, 400); setTimeout(addSso, 1500);
    const take = () => { if (/access_token=/.test(location.hash || "") && !/type=(invite|recovery|signup|magiclink)/.test(location.hash) && C() && C().acceptAuthUrl) C().acceptAuthUrl(location.href).then((ok) => { if (ok) { history.replaceState(null, "", location.pathname); location.reload(); } }).catch(() => {}); };
    take(); window.addEventListener("hashchange", take);
    // boot took the tokens from the address itself (CLOUD.takeAuthHash): a first SSO sign-in still joins its company
    let arrived = 0; try { arrived = +localStorage.getItem("xyntax.sso.arrived") || 0; localStorage.removeItem("xyntax.sso.arrived"); } catch (e) { /* nothing */ }
    if (arrived && Date.now() - arrived < 60000 && signed()) setTimeout(async () => { try { const w = await C().whoami(); if (w && !(w.memberships || []).length) { const j = await C().admin("sso_jit"); if (j && j.joined && j.joined.length) location.reload(); } } catch (e) { /* a password account, or no company lists the domain */ } }, 1200);
  });
})();
