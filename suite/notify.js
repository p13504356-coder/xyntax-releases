/* XYNTAX — 4.8 · notifications: one bell, one count, one list.
 * The bell sits in the home band (top right) and, on the desktop, at the right of every app's header. Its count is what is
 * waiting for the person right now: unread conversations in Messages, unread mail, calendar reminders due today, invitations
 * to companies not yet answered. Tapping it lists them; tapping an item opens the app on it.
 * Nothing here reads another module's state directly: Messages and Mail expose a count (SUITE.messagesUnread, SUITE.mailUnread),
 * the calendar's reminders come through the reminders() each app already registers, invitations through the shared CLOUD.me().
 * The counts are refreshed when the realtime socket reports a change (cloud-change), when an app says so (suite-unread), on
 * focus, and every 60 s as the safety net. System notifications for new items keep coming from the modules themselves
 * (SUITE.notify → the phone's local notifications or the desktop's), with one addition here: a new invitation. */
(function () {
  if (typeof SUITE === "undefined") return;
  if (SUITE.I && !SUITE.I.bell) SUITE.I.bell = '<svg viewBox="0 0 24 24"><path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/></svg>';
  const H = SUITE.H || ((tag, attrs, ...kids) => { const el = document.createElement(tag); for (const [k, v] of Object.entries(attrs || {})) { if (k === "class") el.className = v; else if (k.startsWith("on") && typeof v === "function") el[k] = v; else if (v != null) el.setAttribute(k, v); } for (const k of kids.flat()) if (k != null && k !== false) el.append(k.nodeType ? k : document.createTextNode(String(k))); return el; });
  const cloud = () => typeof CLOUD !== "undefined" && CLOUD.signedIn();
  const N = {
    items: [], n: 0, timer: null, _busy: false, _soon: null, lastInvites: null, open: false,
    // ---------- what is waiting
    async collect() {
      const out = []; const today = new Date(); const dayEnd = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1).getTime();
      try { if (SUITE.messagesUnread && SUITE.allowed("messages")) { const m = SUITE.messagesUnread(); for (const i of m.items) out.push(i); } } catch (e) { /* not booted */ }
      try { if (SUITE.mailUnread && SUITE.allowed("mail") && cloud()) { const n = await SUITE.mailUnread(); if (n) out.push({ id: "mail", app: "mail", title: "Mail", body: n + " unread in your inbox", n, open: () => SUITE.open("mail") }); } } catch (e) { /* no mailbox */ }
      try { const cal = SUITE.apps.calendar; if (cal && cal.reminders && SUITE.allowed("calendar") && !(SUITE.lock && SUITE.lock.locked)) { SUITE.db.hush(); let list = []; try { list = (await cal.reminders()) || []; } finally { SUITE.db.unhush(); } const fired = SUITE.reminders && SUITE.reminders.fired ? SUITE.reminders.fired() : {}; const seen = new Set(); for (const r of list) { const at = new Date(r.at).getTime(); const evId = String(r.id).split("/")[0]; if (at < dayEnd && at > Date.now() - 15 * 60000 && !seen.has(evId)) { seen.add(evId); out.push({ id: r.id, app: "calendar", title: r.title, body: r.body, at: r.at, fired: !!fired[r.id], open: () => SUITE.open("calendar") }); } } } } catch (e) { /* sealed or not loaded */ }
      // 4.16 · birthdays and anniversaries of the day (Contacts' reminders), one line each, opening the card
      try { const ct = SUITE.apps.contacts; if (ct && ct.reminders && SUITE.allowed("contacts") && !(SUITE.lock && SUITE.lock.locked)) { SUITE.db.hush(); let list = []; try { list = (await ct.reminders()) || []; } finally { SUITE.db.unhush(); } for (const r of list) { const at = new Date(r.at).getTime(); if (at >= dayEnd) continue; out.push({ id: r.id, app: "contacts", title: r.title, body: r.body || "Today", open: () => SUITE.open("contacts", { id: r.contactId }) }); } } } catch (e) { /* sealed or not set up */ }
      // 4.33 · COMPLIANCE: packages waiting for review (officers), KYC expiring or expired (officers and the assigned sales person)
      try { const cm = SUITE.apps.compliance; if (cm && cm.waiting && cloud() && CLOUD.active() && SUITE.allowed("compliance") && !(SUITE.lock && SUITE.lock.locked)) for (const i of (await cm.waiting()) || []) out.push(i); } catch (e) { /* not set up in this workspace, or offline */ }
      try { if (cloud() && CLOUD.me) { const me = await CLOUD.me(); const inv = (me && me.invitations) || []; for (const i of inv) out.push({ id: "inv:" + (i.id || i.org_id), app: "settings", title: "Invitation · " + ((i.orgs || {}).name || "a company"), body: "Accept or decline in Settings → Companies", open: () => SUITE.open("settings", { view: "companies" }) }); const key = inv.map((i) => i.id || i.org_id).sort().join(","); if (this.lastInvites != null && key && key !== this.lastInvites) { const fresh = inv.filter((i) => !this.lastInvites.split(",").includes(String(i.id || i.org_id)))[0]; if (fresh) SUITE.notify("You are invited to " + ((fresh.orgs || {}).name || "a company"), "Accept it in Settings → Companies", "inv:" + (fresh.id || fresh.org_id)); } this.lastInvites = key; } } catch (e) { /* the account function is not deployed */ }
      return out;
    },
    async refresh(force) {
      if (!cloud() && !SUITE.apps.calendar) return; if (this._busy) { this._again = true; return; } this._busy = true;
      try { if (force && SUITE.mailUnread) await SUITE.mailUnread(true); this.items = await this.collect(); this.n = this.items.reduce((k, i) => k + (i.n || (i.app === "messages" ? parseInt(i.body, 10) || 1 : 1)), 0); this.draw(); }
      catch (e) { /* next time */ } finally { this._busy = false; if (this._again) { this._again = false; this.soon(); } }
    },
    soon(force) { clearTimeout(this._soon); this._soon = setTimeout(() => this.refresh(force), 250); },
    // ---------- the bell
    bell() { const b = H("button", { class: "quiet sh-bell", title: "Notifications", "aria-label": "Notifications", onclick: (e) => { e.stopPropagation(); this.toggle(e.currentTarget); } }, SUITE.icon ? SUITE.icon("bell") : "🔔", H("span", { class: "sh-belln", hidden: "" }, "")); return b; },
    place() {
      // the home band, top right; the desktop's app headers at their right; the accounting header too
      const spots = [];
      const home = document.querySelector("#home .sh-top .sh-right"); if (home) spots.push({ host: home, where: "first" });
      if (!SUITE.isMobile()) { const app = document.querySelector("#sapp .sh-apptop .sh-suitebtn"); if (app) spots.push({ host: app, where: "before" }); const acc = document.querySelector("header.cmd #suiteBtn"); if (acc) spots.push({ host: acc, where: "before" }); }
      for (const s of spots) { const parent = s.where === "first" ? s.host : s.host.parentNode; if (parent.querySelector(":scope > .sh-bell")) continue; const b = this.bell(); if (s.where === "first") s.host.prepend(b); else s.host.before(b); }
      this.draw();
    },
    draw() { for (const b of document.querySelectorAll(".sh-bell")) { const n = b.querySelector(".sh-belln"); if (!n) continue; if (this.n > 0) { n.textContent = this.n > 99 ? "99+" : String(this.n); n.hidden = false; b.classList.add("on"); } else { n.hidden = true; b.classList.remove("on"); } } if (this.open) this.list(); if (SUITE.host && SUITE.host.setBadge) { try { SUITE.host.setBadge(this.n); } catch (e) { /* optional */ } } },
    // ---------- the list
    toggle(btn) { if (this.open) return this.close(); this.open = true; this.anchor = btn; this.list(); this.refresh(true); document.addEventListener("keydown", this._esc = (e) => { if (e.key === "Escape") this.close(); }); setTimeout(() => document.addEventListener("mousedown", this._off = (e) => { const box = document.getElementById("shnotify"); if (box && !box.contains(e.target) && !e.target.closest(".sh-bell")) this.close(); }, true), 0); },
    close() { this.open = false; const box = document.getElementById("shnotify"); if (box) box.remove(); if (this._esc) document.removeEventListener("keydown", this._esc); if (this._off) document.removeEventListener("mousedown", this._off, true); this._esc = this._off = null; },
    list() {
      let box = document.getElementById("shnotify"); if (!box) { box = H("div", { id: "shnotify", role: "dialog", "aria-label": "Notifications" }); document.body.append(box); } box.innerHTML = "";
      const when = (i) => { if (!i.at) return ""; const d = new Date(i.at); if (isNaN(d)) return ""; return SUITE.ago ? SUITE.ago(d) : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); };
      const order = { messages: 0, mail: 1, calendar: 2, compliance: 3, settings: 4 }; const items = this.items.slice().sort((a, b) => (order[a.app] ?? 9) - (order[b.app] ?? 9) || String(b.at || "").localeCompare(String(a.at || "")));
      box.append(H("div", { class: "sh-nhead" }, H("b", {}, "Notifications"), H("span", { class: "sh-dim" }, items.length ? this.n + " waiting" : "Nothing waiting"), H("button", { class: "quiet", title: "Close", onclick: () => this.close() }, "×")));
      const glyph = (app) => SUITE.icon ? SUITE.icon(({ messages: "send", mail: "mail", calendar: "calendar", settings: "people", compliance: "check" })[app] || "bell") : "";
      if (!items.length) box.append(H("div", { class: "sh-nempty" }, "New messages, mail, reminders due today, invitations and KYC packages to review or renew appear here."));
      for (const i of items) box.append(H("button", { class: "sh-nitem" + (i.fired ? " fired" : ""), onclick: () => { this.close(); try { i.open(); } catch (e) { SUITE.open(i.app); } } }, glyph(i.app), H("span", { class: "sh-ntext" }, H("span", { class: "sh-nt" }, i.title), H("span", { class: "sh-nb" }, i.body)), H("span", { class: "sh-nwhen" }, when(i))));
      if (SUITE.isMobile()) box.classList.add("sheet"); else { if (!this.anchor || !this.anchor.isConnected) this.anchor = document.querySelector("#home .sh-bell, #sapp .sh-apptop .sh-bell"); if (!this.anchor) { this.close(); return; } const r = this.anchor.getBoundingClientRect(); box.style.top = Math.round(r.bottom + 6) + "px"; box.style.right = Math.max(8, Math.round(window.innerWidth - r.right)) + "px"; }
    },
    // ---------- wiring
    start() {
      if (this.timer) return; this.timer = setInterval(() => { this.refresh(); if (SUITE.messagesTick && !(CLOUD.realtime && CLOUD.realtime.live)) SUITE.messagesTick(); }, 60000);
      window.addEventListener("cloud-change", (e) => { const t = e.detail && e.detail.table; if (["msg_messages", "msg_threads", "msg_members", "msg_keys", "mail_messages", "invitations"].includes(t)) { if (t === "invitations" && CLOUD.me) CLOUD.me(true).catch(() => {}); this.soon(t === "mail_messages"); } if (["suite_shared", "suite_docs", "vault_items", "books"].includes(t)) { const row = e.detail.row; if (row && row.app && SUITE.db && SUITE.db.cache) { /* our own autosave coming back: the cache already holds that version */ const c = SUITE.db.cache[(t === "suite_shared" ? "shared:" : "") + row.app]; if (c && row.version != null && +row.version <= +(c.version || 0)) return; } this.wake(); } });
      window.addEventListener("suite-unread", () => this.soon()); window.addEventListener("focus", () => this.soon()); document.addEventListener("visibilitychange", () => { if (!document.hidden) this.soon(); });
      // the bell is put back whenever the home or an app header is drawn
      const wrap = (name) => { const orig = SUITE[name]; if (typeof orig !== "function" || orig._notify) return; const f = function () { const r = orig.apply(this, arguments); setTimeout(() => N.place(), 0); return r; }; f._notify = true; SUITE[name] = f; };
      wrap("showHome"); wrap("open"); if (typeof window.render === "function" && !window.render._notify) { const orig = window.render; const f = function () { const r = orig.apply(this, arguments); setTimeout(() => N.place(), 0); return r; }; f._notify = true; window.render = f; }
      new MutationObserver(() => { if (!this._mo) { this._mo = setTimeout(() => { this._mo = null; if (!document.querySelector("#home .sh-top .sh-bell, #sapp .sh-apptop .sh-bell")) this.place(); }, 200); } }).observe(document.body, { childList: true });
      this.place(); SUITE.whenIdle(() => this.refresh(), 2500);
      // Messages boots quietly once the home has been up for a moment, so its first open is instant and its badge is live
      SUITE.whenIdle(() => { if (SUITE.messagesWarm && cloud() && SUITE.allowed("messages")) SUITE.messagesWarm().then(() => this.soon()).catch(() => {}); }, 5000);
    },
    // a document changed somewhere else: the apps that poll on focus refresh now (notes, calendar, wealth, documents, contacts,
    // the workflow — each listens to window focus for exactly this), without waiting for their 20–30 s timers
    wake() { clearTimeout(this._wake); this._wake = setTimeout(() => { try { window.dispatchEvent(new Event("focus")); } catch (e) { /* nothing */ } if (SUITE.refreshCurrent && document.querySelector("#sapp.open")) { /* the open app redraws from its refreshed cache on its own focus handler */ } }, 300); },
  };
  SUITE.NOTIFY = N;
  const boot = () => { if (typeof CLOUD === "undefined" || !CLOUD.signedIn()) { setTimeout(boot, 2000); return; } N.start(); };
  if (document.readyState === "complete") setTimeout(boot, 600); else window.addEventListener("load", () => setTimeout(boot, 600));
})();
