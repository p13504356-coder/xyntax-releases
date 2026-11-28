/* XYNTAX 4.31.5 · updates are not optional.
 * A desktop that never installed its updates (4.17.1) published a customer's portal with the old engine's figures. Now:
 *  - the desktop downloads a found update by itself and installs it when the app quits; once downloaded a quiet bar offers Restart now
 *  - on start and every hour the app reads the workspace's minimum version (app_policy.min_version). Below it, the app first sends what
 *    waits (the book's and PROSHIP's debounced saves and their device queues; up to 60 s; nothing is ever discarded: what cannot be sent
 *    stays in the device copy and goes out after the update), then covers the window with "Update required": the download's progress
 *    and Restart. While it is up nothing can be edited.
 *  - the phone cannot install itself: the same screen links the latest APK. A Mac (unsigned build) whose install fails is offered the
 *    disk image for its processor (arm64 or x64).
 *  - 4.31.8 · a Mac installs itself (main process, macupdate.js): Restart → "Downloading 4.31.8… 43%" (prepare: download, sha512,
 *    copy next to the running app) → what waits is sent → the app ends, a script swaps the copies and opens the new one. A copy that
 *    cannot replace itself opens the disk image with "Drag XYNTAX to Applications and replace". Errors in plain words + the image.
 * UPD.cmp(a, b) · below(v, min) · version() · policy() · pending() · flush(ms) · check() · restart() · state */
(function () {
  const FALLBACK = "4.31.4"; const HOUR = 3600 * 1000; const FLUSH_MS = 60000;
  const st = { current: "", min: "", blocked: false, flushing: false, flushed: null, desk: null, lastOk: 0, checking: null, apk: "", restartAt: 0, started: false, ready: "", asked: false, busy: false, dismissed: "" };
  const parse = (v) => { const m = /^(\d+)\.(\d+)\.(\d+)/.exec(String(v == null ? "" : v).trim()); return m ? [+m[1], +m[2], +m[3]] : null; };
  const cmp = (a, b) => { const x = parse(a), y = parse(b); if (!x || !y) return 0; for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1; return 0; };
  const below = (v, min) => !!parse(v) && !!parse(min) && cmp(v, min) < 0;
  const sleep = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)));
  const W = typeof window !== "undefined" ? window : globalThis;
  const desk = () => !!(W.xyntax && W.xyntax.updateInstall);
  const mac = () => desk() && !!st.desk && st.desk.platform === "darwin";
  const HINT = "Drag XYNTAX to Applications and replace the old copy, then open XYNTAX again.";
  const phone = () => !desk() && !!(W.Capacitor || (typeof SUITE !== "undefined" && SUITE.host && SUITE.host.mobile) || (typeof document !== "undefined" && document.body && document.body.classList.contains("phone")));
  const repo = () => (typeof RELEASES_REPO !== "undefined" && RELEASES_REPO) || (st.desk && st.desk.releases) || "p13504356-coder/xyntax-releases";

  // ---------- the running version: the desktop's own, the phone's build stamp, or the user agent the workspace sees (XYNTAX/x.y.z)
  async function version() {
    if (st.current) return st.current; let v = "";
    try { if (W.xyntax && W.xyntax.version) v = await W.xyntax.version(); } catch (e) { v = ""; }
    if (!parse(v) && typeof APP_VERSION !== "undefined") v = APP_VERSION;
    if (!parse(v) && typeof navigator !== "undefined") { const m = /XYNTAX\/(\d+\.\d+\.\d+)/.exec(navigator.userAgent || ""); if (m) v = m[1]; }
    st.current = parse(v) ? String(v).trim() : ""; return st.current;
  }
  // ---------- the workspace's minimum: null when signed out or unreadable (the app carries on), the fallback when the row is absent
  async function policy() {
    if (typeof CLOUD === "undefined" || !CLOUD.session || !CLOUD.session() || !CLOUD.session().access_token) return null;
    const r = await CLOUD.req("/rest/v1/app_policy?select=min_version&id=eq.1", { cache: "no-store" }); if (!r || !r.ok) return null;
    let j = null; try { j = await r.json(); } catch (e) { j = null; } st.lastOk = Date.now();
    const v = Array.isArray(j) && j[0] ? j[0].min_version : null; return parse(v) ? String(v) : Array.isArray(j) ? FALLBACK : null;
  }
  // ---------- what waits to be saved: the book's debounced save, PROSHIP's debounced save, and both stores' device queues
  const bookDirty = () => { try { return typeof S !== "undefined" && S && S.dirty && S.store && typeof persist !== "undefined"; } catch (e) { return false; } };
  function pending() { let n = 0; try { if (typeof BOOKDB !== "undefined" && BOOKDB.state) n += BOOKDB.state.pending || 0; } catch (e) { /* none */ } try { if (W.PSDB && W.PSDB.state) n += W.PSDB.state.pending || 0; } catch (e) { /* none */ } if (bookDirty()) n += 1; return n; }
  async function saveBook() { if (!bookDirty()) return; clearTimeout(S.saveTimer); const r = await persist.save(S.store); if (!(r && r.ok === false)) S.dirty = false; }
  async function send() {
    const jobs = [];
    try { if (bookDirty()) jobs.push(saveBook()); } catch (e) { /* stays waiting */ }
    try { if (typeof BOOKDB !== "undefined" && BOOKDB.state && BOOKDB.state.pending && BOOKDB.sync) jobs.push(BOOKDB.sync()); } catch (e) { /* stays waiting */ }
    try { if (W.PSDB && W.PSDB.state && W.PSDB.state.pending && W.PSDB.sync) jobs.push(W.PSDB.sync()); } catch (e) { /* stays waiting */ }
    await Promise.all(jobs.map((p) => Promise.resolve(p).catch(() => null)));
  }
  // flush: the debounced saves go now, then the queues are sent until empty or the time is up; the device copies are written either way
  async function flush(ms) {
    const end = Date.now() + (ms == null ? FLUSH_MS : ms); st.flushing = true;
    try {
      try { await saveBook(); } catch (e) { /* the save waits in the store */ }
      try { if (W.PS && typeof W.PS.flush === "function") await W.PS.flush(); } catch (e) { /* the save waits in the store */ }
      while (pending() && Date.now() < end) { let t = null; await Promise.race([send(), new Promise((r) => { t = setTimeout(r, Math.max(0, end - Date.now())); })]); clearTimeout(t); if (pending()) await sleep(Math.min(1000, end - Date.now())); }
      try { if (typeof BOOKDB !== "undefined" && BOOKDB.settled) await BOOKDB.settled(); } catch (e) { /* best effort */ }
      try { if (W.PSDB && W.PSDB.settled) await W.PSDB.settled(); } catch (e) { /* best effort */ }
      const left = pending(); st.flushed = { ok: !left, pending: left, at: Date.now() }; return st.flushed;
    } finally { st.flushing = false; }
  }
  // ---------- the check: on start, once a session exists, and every hour
  function check() {
    if (st.checking) return st.checking;
    st.checking = (async () => {
      try {
        const v = await version(); if (!v) return { skipped: "version" };
        let min = null; try { min = await policy(); } catch (e) { min = null; } if (!min) return { skipped: "policy" };
        st.min = min; if (below(v, min)) { await block(); return { blocked: true, current: v, min }; }
        if (st.blocked) unblock(); return { blocked: false, current: v, min };
      } finally { st.checking = null; }
    })();
    return st.checking;
  }
  async function block() {
    if (st.blocked) return; st.blocked = true; UPD.ui.freeze(true); UPD.ui.saving(true);
    try { await flush(FLUSH_MS); } finally { UPD.ui.saving(false); }
    if (phone()) findApk().then(() => UPD.ui.screen()).catch(() => {});
    UPD.ui.screen();
  }
  function unblock() { st.blocked = false; UPD.ui.freeze(false); UPD.ui.close(); }
  // ---------- Restart: what waits goes first; the desktop installs the download; a Mac whose install does not happen gets the disk image
  async function restart() {
    if (mac()) return macRestart();
    if (st.flushing) return false; await flush(st.blocked ? 15000 : FLUSH_MS);
    if (desk()) { st.restartAt = Date.now(); UPD.ui.screen(); const r = await W.xyntax.updateInstall().catch((e) => ({ ok: false, error: e.message })); if (r && r.ok === false) { st.desk = { ...(st.desk || {}), error: r.error || "The update could not be installed", manual: r.manual || (st.desk || {}).manual || "" }; UPD.ui.screen(); } setTimeout(() => UPD.ui.screen(), 20000); return true; }
    if (phone()) { await findApk(); open(st.apk || releasesPage()); return true; }
    try { location.reload(); } catch (e) { /* not a page */ } return true;
  }
  // 4.31.8 · Mac: prepare (download, check, stage; progress in the bar or the screen) → what waits is sent → install (the app ends and
  // comes back as the new version) · a copy that cannot replace itself: the disk image opens with the drag instructions
  const draw = () => (st.blocked ? UPD.ui.screen() : UPD.ui.bar());
  async function macRestart() {
    if (st.flushing || st.busy) return false; st.busy = true; st.asked = true; st.dismissed = ""; st.restartAt = 0; st.desk = { ...(st.desk || {}), error: "", manual: "" }; draw();
    const failed = (r, why) => { st.restartAt = 0; st.desk = { ...(st.desk || {}), error: (r && r.error) || why, manual: (r && r.manual) || "" }; draw(); return true; };
    try {
      if (W.xyntax.updatePrepare) { const p = await W.xyntax.updatePrepare().catch((e) => ({ ok: false, error: e.message })); if (!p || p.ok === false) return failed(p, "The new version could not be downloaded."); }
      await flush(st.blocked ? 15000 : FLUSH_MS);
      st.restartAt = Date.now(); draw();
      const r = await W.xyntax.updateInstall().catch((e) => ({ ok: false, error: e.message }));
      if (!r || r.ok === false) return failed(r, "The update could not be installed.");
      if (r.mode === "manual") { st.restartAt = 0; st.desk = { ...(st.desk || {}), mode: "manual", reason: r.reason || (st.desk || {}).reason || "", file: r.file || "" }; }
      draw(); setTimeout(draw, 20000); return true;
    } finally { st.busy = false; }
  }
  const releasesPage = () => "https://github.com/" + repo() + "/releases/latest";
  const dmg = () => { const s = st.desk || {}; if (s.manual) return s.manual; const v = s.version || ""; return v ? "https://github.com/" + repo() + "/releases/download/v" + v + "/XYNTAX-" + v + "-" + (s.arch === "arm64" ? "arm64" : "x64") + ".dmg" : releasesPage(); };
  const macFailed = () => { const s = st.desk || {}; return s.platform === "darwin" && (!!s.error || !!s.manual || (st.restartAt && Date.now() - st.restartAt > 15000)); };
  async function findApk() { if (st.apk) return st.apk; try { const r = await fetch("https://api.github.com/repos/" + repo() + "/releases/latest", { headers: { Accept: "application/vnd.github+json" } }); const j = await r.json(); const a = (j.assets || []).find((x) => /\.apk$/i.test(x.name)); st.apk = a ? a.browser_download_url : ""; } catch (e) { st.apk = ""; } return st.apk; }
  function open(u) { try { if (typeof SUITE !== "undefined" && SUITE.host && SUITE.host.openExternal) return SUITE.host.openExternal(u); } catch (e) { /* fall through */ } if (W.xyntax && W.xyntax.openExternal) return W.xyntax.openExternal(u); W.open(u, "_system"); }

  // ---------- the interface (monochrome, the updbar pattern for the bar, one full-window card for the block)
  const E = (tag, attrs, ...kids) => { const el = document.createElement(tag); for (const [k, v] of Object.entries(attrs || {})) { if (v == null || v === false) continue; if (k.startsWith("on")) el.addEventListener(k.slice(2), v); else if (k === "style") el.style.cssText = v; else el.setAttribute(k, v === true ? "" : v); } for (const c of kids.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : String(c)); return el; };
  const keyGuard = (e) => { if (!st.blocked) return; const box = document.getElementById("updblock"); if (box && box.contains(e.target)) return; e.preventDefault(); e.stopPropagation(); };
  const ui = {
    freeze(on) { if (typeof document === "undefined") return; for (const el of document.body.children) if (el.id !== "updblock" && !el.classList.contains("updbar") && el.id !== "toast") el.inert = !!on; if (on) document.addEventListener("keydown", keyGuard, true); else document.removeEventListener("keydown", keyGuard, true); },
    saving(on) { if (typeof document === "undefined") return; const old = document.getElementById("updsaving"); if (old) old.remove(); if (on) document.body.append(E("div", { id: "updsaving", class: "updbar", role: "status" }, "XYNTAX must update: saving your changes first…")); },
    close() { if (typeof document === "undefined") return; const el = document.getElementById("updblock"); if (el) el.remove(); },
    ready(v) { if (typeof document === "undefined" || st.blocked) return; st.ready = v; if (mac()) return UPD.ui.bar(); let bar = document.getElementById("updready"); if (bar) bar.remove(); bar = E("div", { id: "updready", class: "updbar", role: "status" }, "XYNTAX " + v + " is ready — ", E("button", { class: "primary", onclick: () => { restart(); } }, "Restart now"), E("button", { class: "quiet", onclick: () => bar.remove() }, "Later")); document.body.append(bar); },
    // 4.31.8 · the Mac's bar: progress once asked, then "Restart to finish"; the manual way and errors with the disk image
    bar() {
      if (typeof document === "undefined" || st.blocked || !mac()) return; const s = st.desk || {}; const v = s.downloaded || s.version || st.ready || ""; let bar = document.getElementById("updready"); if (bar) bar.remove();
      const later = () => E("button", { class: "quiet", onclick: () => { st.dismissed = v; st.asked = false; const b = document.getElementById("updready"); if (b) b.remove(); } }, "Later");
      let kids = null;
      if (s.error && st.asked) kids = ["The update could not be installed: " + s.error + " ", E("button", { class: "primary", "data-act": "upd-dmg", onclick: () => open(dmg()) }, "Download the disk image (" + (s.arch === "arm64" ? "Apple silicon" : "Intel") + ")"), later()];
      else if (st.dismissed && st.dismissed === v && !st.asked) return;
      else if (st.restartAt && !macFailed()) kids = ["Restarting into XYNTAX " + v + "…"];
      else if (s.downloaded && s.mode === "manual") kids = ["XYNTAX " + v + " is downloaded. " + (st.asked ? HINT + " " : "This copy cannot replace itself here. "), E("button", { class: "primary", "data-act": "upd-open", onclick: () => restart() }, "Open the disk image"), later()];
      else if (s.downloaded) kids = ["XYNTAX " + v + " is ready — ", E("button", { class: "primary", "data-act": "upd-restart", onclick: () => restart() }, "Restart to finish"), later()];
      else if (st.asked && s.stage === "staging") kids = ["Preparing XYNTAX " + v + "…"];
      else if (st.asked && v) kids = ["Downloading XYNTAX " + v + "… " + (s.percent || 0) + "%"];
      else if (st.asked) kids = ["Looking for the new version…"];
      if (!kids) return; bar = E("div", { id: "updready", class: "updbar", role: "status" }, kids); document.body.append(bar);
    },
    screen() {
      if (typeof document === "undefined" || !st.blocked) return; const s = st.desk || {}; const left = st.flushed ? st.flushed.pending : pending();
      const rd = document.getElementById("updready"); if (rd) rd.remove();
      const prog = mac() ? (s.downloaded && s.mode === "manual" ? "XYNTAX " + s.downloaded + " is downloaded. This copy cannot replace itself" + (s.reason ? " (" + s.reason + ")" : "") + "." : s.downloaded ? "XYNTAX " + s.downloaded + " is ready. Restart to finish." : s.stage === "staging" ? "Preparing XYNTAX " + (s.version || "") + "…" : s.version ? "Downloading XYNTAX " + s.version + "… " + (s.percent || 0) + "%" : "Looking for the new version…") : desk() ? (s.downloaded ? "XYNTAX " + s.downloaded + " is downloaded and installs when you restart." : s.version ? "Downloading XYNTAX " + s.version + " · " + (s.percent || 0) + " %" : "Looking for the new version…") : "";
      const acts = [];
      const manual = mac() && s.downloaded && s.mode === "manual";
      if (desk()) acts.push(E("button", { class: "primary", "data-act": "upd-restart", disabled: st.flushing || st.busy ? true : null, onclick: () => restart() }, manual ? "Open the disk image" : st.restartAt && !macFailed() ? "Restarting…" : mac() && s.downloaded ? "Restart to finish" : "Restart"));
      if (desk() && macFailed()) acts.push(E("button", { class: "quiet", "data-act": "upd-dmg", onclick: () => open(dmg()) }, "Download the disk image (" + (s.arch === "arm64" ? "Apple silicon" : "Intel") + ")"));
      if (phone()) acts.push(E("button", { class: "primary", "data-act": "upd-apk", onclick: () => restart() }, "Download the new app"));
      if (!desk() && !phone()) acts.push(E("button", { class: "primary", "data-act": "upd-restart", onclick: () => restart() }, "Restart"));
      const card = E("div", { class: "ub-card" },
        E("div", { class: "ub-mark" }, "XYNTAX"), E("h2", { id: "updblock-t" }, "Update required"),
        E("p", {}, "This copy is XYNTAX " + (st.current || "?") + ". The workspace now needs " + st.min + " or later, so that everyone works with the same figures."),
        E("p", { class: "ub-saved" }, left ? left + " change" + (left === 1 ? " is" : "s are") + " kept on this device and sent after the update." : "Your changes are saved."),
        desk() ? E("div", { class: "ub-prog" }, E("div", { class: "ub-track" }, E("i", { style: "width:" + Math.max(2, Math.min(100, s.downloaded ? 100 : s.percent || 0)) + "%" })), E("span", { class: "ub-pct" }, prog)) : null,
        phone() ? E("p", { class: "ub-dim" }, "Install the new app over this one; your data stays in the workspace.") : null,
        manual ? E("p", { class: "ub-dim", "data-act": "upd-hint" }, HINT) : null,
        E("div", { class: "ub-acts" }, acts),
        s.error && desk() ? E("p", { class: "ub-dim ub-err" }, (mac() ? "" : "The updater said: ") + s.error) : null);
      let el = document.getElementById("updblock"); const box = E("div", { id: "updblock", role: "dialog", "aria-modal": "true", "aria-labelledby": "updblock-t" }, card);
      if (el) el.replaceWith(box); else document.body.append(box); el = box; const b = el.querySelector("button.primary"); if (b && !el.contains(document.activeElement)) try { b.focus(); } catch (e) { /* no focus */ }
    },
  };

  function start() {
    if (st.started || typeof document === "undefined") return; st.started = true;
    if (W.xyntax && W.xyntax.onUpdateState) { W.xyntax.onUpdateState((s) => { st.desk = s; if (st.blocked) UPD.ui.screen(); else if (mac()) UPD.ui.bar(); }); W.xyntax.updateState().then((s) => { st.desk = s; if (s && s.downloaded) UPD.ui.ready(s.downloaded); }).catch(() => {}); }
    if (W.xyntax && W.xyntax.onUpdateDownloaded) W.xyntax.onUpdateDownloaded((v) => { st.desk = { ...(st.desk || {}), downloaded: v, version: v, percent: 100 }; if (st.blocked) UPD.ui.screen(); else UPD.ui.ready(v); });
    const tick = () => { if (!st.checking && Date.now() - st.lastOk >= HOUR) check(); };
    setTimeout(tick, 4000); setInterval(tick, 60000); W.addEventListener("cloud-who", () => { if (!st.lastOk) check(); });
  }
  const UPD = { FALLBACK, parse, cmp, below, version, policy, pending, flush, check, restart, start, ui, get state() { return { current: st.current, min: st.min, blocked: st.blocked, flushing: st.flushing, flushed: st.flushed, desk: st.desk, lastOk: st.lastOk }; }, _st: st };
  W.UPD = UPD;
  if (typeof document !== "undefined" && !W.__updManual) { if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start(); }
  if (typeof module !== "undefined" && module.exports) module.exports = UPD;
})();
