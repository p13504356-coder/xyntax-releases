/* XYNTAX · the software owner's service metrics. Counts only — how many accounts, companies, conversations, sign-ups a day —
 * never who: no names, emails, company names or identifiers reach this page, and the function that answers (admin → metrics)
 * is written to return aggregates alone. Shown under Settings → Software owner → Service metrics. */
(function () {
  const H = (...a) => SUITE.H(...a);
  const n = (v) => (v == null || isNaN(+v) ? "—" : (+v).toLocaleString("en-US"));
  const gb = (v) => (v == null || isNaN(+v) ? "—" : (+v >= 100 ? Math.round(+v) : (+v).toFixed(+v >= 10 ? 1 : 2)) + " GB");
  const pick = (o, path, d) => { let c = o; for (const k of path.split(".")) { if (!c || typeof c !== "object") return d; c = c[k]; } return c == null ? d : c; };
  let last = null, loading = false, err = null;

  // a 30-day series as a row of bars: tallest bar is the series' maximum; labels on the first and last day and the maximum
  function bars(series, opt) {
    opt = opt || {}; const L = Array.isArray(series) ? series.slice(-30) : []; if (!L.length) return H("div", { class: "ow-nodata sh-dim" }, "No days yet");
    const W = 300, Hh = 72, pad = 2; const max = Math.max(1, ...L.map((d) => +d.n || 0)); const bw = (W - pad * (L.length - 1)) / L.length; const total = L.reduce((k, d) => k + (+d.n || 0), 0);
    const rects = L.map((d, i) => { const v = +d.n || 0; const h = Math.max(v ? 2 : 0, Math.round((v / max) * (Hh - 14))); return '<rect x="' + (i * (bw + pad)).toFixed(1) + '" y="' + (Hh - h) + '" width="' + bw.toFixed(1) + '" height="' + h + '" rx="1" class="' + (opt.cls || "") + '"><title>' + d.day + ": " + v + "</title></rect>"; }).join("");
    const svg = H("div", { class: "ow-chart" }); svg.innerHTML = '<svg viewBox="0 0 ' + W + " " + Hh + '" preserveAspectRatio="none" aria-label="' + (opt.label || "") + '">' + rects + "</svg>";
    return H("div", { class: "ow-series" }, H("div", { class: "ow-sh" }, H("span", {}, opt.label || ""), H("b", {}, n(total) + (opt.unit ? " " + opt.unit : "") + " · 30 days")), svg, H("div", { class: "ow-axis sh-faint" }, H("span", {}, (L[0].day || "").slice(5)), H("span", {}, "peak " + n(max)), H("span", {}, (L[L.length - 1].day || "").slice(5))));
  }
  const kpis = (items) => H("div", { class: "sh-kpis ow-kpis" }, items.map((k) => H("div", { class: "sh-kpi" }, H("div", { class: "l" }, k.l), H("div", { class: "v" }, k.v), k.d ? H("div", { class: "d sh-faint" }, k.d) : null)));

  async function load(force) { if (loading) return; if (last && !force) return; loading = true; err = null; try { const r = await CLOUD.admin("metrics"); if (!r || r.error) throw new Error((r && r.error) || "No answer"); last = r; } catch (e) { err = e.message || String(e); } loading = false; }

  function draw(main, X) {
    const { h1, panel } = X; main.innerHTML = "";
    const refresh = H("button", { class: "primary", onclick: async () => { last = null; refresh.disabled = true; refresh.textContent = "Loading…"; await load(true); draw(main, X); } }, "Refresh");
    main.append(h1("Service metrics", "how the service is doing, in numbers alone", refresh));
    main.append(H("div", { class: "ow-note" }, H("b", {}, "Counts only."), " The service cannot see who or what: no names, addresses, company names or contents are available to this page or to the function behind it."));
    if (!last && !err) { main.append(H("div", { class: "sh-dim", style: "padding:20px 0" }, "Loading…")); load().then(() => draw(main, X)); return; }
    if (err) { main.append(H("div", { class: "sh-err" }, "Could not load the metrics: " + err)); return; }
    const m = last; const u = m.users || {}, c = m.companies || {}, us = m.usage || {};
    main.append(H("div", { class: "sh-faint ow-when" }, "Generated " + (m.generated_at ? SUITE.ago(m.generated_at) + " · " + new Date(m.generated_at).toLocaleString() : "just now")));
    main.append(panel("Accounts", kpis([{ l: "Accounts", v: n(u.total) }, { l: "New · 7 days", v: n(u.new_7d) }, { l: "New · 30 days", v: n(u.new_30d) }, { l: "Active · 7 days", v: n(u.active_7d), d: u.total ? Math.round(100 * (+u.active_7d || 0) / +u.total) + "% of accounts" : null }, { l: "Active · 30 days", v: n(u.active_30d) }, { l: "Personal / in companies", v: n(u.personal) + " / " + n(u.in_companies) }])));
    main.append(panel("Companies", kpis([{ l: "Companies", v: n(c.total) }, { l: "Seats", v: n(c.seats_total) }, { l: "Trials started · 30 days", v: n(c.trials_started_30d) }, { l: "Converted · 30 days", v: n(c.converted_30d), d: c.trials_started_30d ? Math.round(100 * (+c.converted_30d || 0) / +c.trials_started_30d) + "% of trials" : null }])));
    main.append(panel("Usage", kpis([{ l: "Notes", v: n(us.notes) }, { l: "Documents", v: n(us.docs) }, { l: "Vault", v: gb(us.vault_gb) }, { l: "Conversations", v: n(us.threads) }, { l: "Messages · 7 days", v: n(us.messages_7d), d: "count of sealed rows; contents unreadable" }, { l: "Mail accounts", v: n(us.mail_accounts) }, { l: "Calendar events", v: n(us.calendar_events) }])));
    main.append(panel("The last 30 days", H("div", { class: "ow-charts" }, bars(m.signups, { label: "Accounts created a day", unit: "accounts" }), bars(m.messages, { label: "Messages a day", unit: "messages" }), bars(m.errors, { label: "Errors a day (functions and webhooks)", unit: "errors", cls: "neg" }))));
    main.append(H("div", { class: "sh-faint ow-foot" }, "Figures come from counts over the service's tables; daily series cover the last 30 days. Nothing here is kept beyond the page."));
  }

  // reports from members: a kind, an opaque reference and the reporter's words — never the contents, never who reported
  function drawReports(main, X) {
    const { h1, panel, tbl } = X; main.innerHTML = "";
    main.append(h1("Reports", "what members reported; the service cannot open what is referred to, it can only act on the account behind it"));
    main.append(H("div", { class: "ow-note" }, H("b", {}, "Reference only."), " A report names a conversation, file, email or account by an opaque id. Reading it is impossible by design; suspension makes an account read-only until lifted."));
    const box = H("div", { class: "sh-dim" }, "Loading…"); main.append(box);
    const outcomeOf = (r) => r.handled_at ? (r.outcome || "handled") : "open";
    const act = async (r, outcome) => { try { await CLOUD.admin("handle_report", { id: r.id, outcome }); SUITE.toast(outcome === "suspended" ? "Account suspended" : outcome === "unsuspended" ? "Suspension lifted" : "Report " + outcome); drawReports(main, X); } catch (e) { SUITE.toast("Could not: " + e.message); } };
    CLOUD.admin("reports").then((rows) => { box.innerHTML = ""; if (!rows || !rows.length) { box.textContent = "No reports."; return; }
      box.append(tbl([{ l: "When" }, { l: "Kind" }, { l: "About" }, { l: "Note", wrap: 1 }, { l: "Status" }, { l: "" }], rows.map((r) => ({ cells: [SUITE.ago(r.created_at), r.kind, (r.ref || "").split(":")[0] || "—", (r.note || "").slice(0, 240), outcomeOf(r), H("div", { class: "sh-toolbar", style: "margin:0;gap:6px;justify-content:flex-end" }, !r.handled_at ? H("button", { class: "quiet", onclick: () => act(r, "dismissed") }, "Dismiss") : null, !r.handled_at ? H("button", { class: "quiet", onclick: () => act(r, "noted") }, "Note") : null, r.has_subject && r.outcome !== "suspended" ? H("button", { class: "quiet danger", onclick: async () => { if (await SUITE.confirm({ title: "Suspend the account behind this report?", text: "It becomes read-only: the person can still open, export and delete their data. You can lift it later." }, "Suspend", true)) act(r, "suspended"); } }, "Suspend") : null, r.outcome === "suspended" ? H("button", { class: "quiet", onclick: () => act(r, "unsuspended") }, "Lift") : null)] }))));
    }).catch((e) => { box.className = "sh-err"; box.textContent = "Could not load: " + e.message; });
  }
  window.SETTINGS_EXTRA = (window.SETTINGS_EXTRA || []).concat([{ id: "metrics", label: "Service metrics", group: "owner", when: () => typeof CLOUD !== "undefined" && CLOUD.state && CLOUD.state.isOwner, draw }, { id: "reports", label: "Reports", group: "owner", when: () => typeof CLOUD !== "undefined" && CLOUD.state && CLOUD.state.isOwner, draw: drawReports }]);
})();

/* 4.16 · the owner's Health page (errors by version, function answers, scheduled jobs, backups — aggregates only) and Backups
 * (back up now, the list per company, the restore drill into a NEW company; nothing is ever overwritten). */
(function () {
  const H = (...a) => SUITE.H(...a);
  const isOwner = () => typeof CLOUD !== "undefined" && CLOUD.state && CLOUD.state.isOwner;
  const kb = (b) => (b == null ? "—" : b > 1048576 ? (b / 1048576).toFixed(1) + " MB" : Math.round(b / 1024) + " KB");
  const when = (t) => (t ? SUITE.ago(t) : "—");
  const kpis = (items) => H("div", { class: "sh-kpis ow-kpis" }, items.map((k) => H("div", { class: "sh-kpi" + (k.cls ? " " + k.cls : "") }, H("div", { class: "l" }, k.l), H("div", { class: "v" }, k.v), k.d ? H("div", { class: "d sh-faint" }, k.d) : null)));

  function health(main, X) {
    const { h1, panel, tbl } = X; main.innerHTML = "";
    const refresh = H("button", { class: "primary", onclick: () => health(main, X) }, "Refresh");
    main.append(h1("Health", "is the service working — errors, jobs, functions and backups", refresh));
    const box = H("div", { class: "sh-dim" }, "Loading…"); main.append(box);
    CLOUD.health().then((h) => {
      box.className = ""; box.innerHTML = "";
      const http = h.http24h || []; const fails = http.filter((x) => +x.status >= 400 || x.status == null).reduce((k, x) => k + (+x.n || 0), 0); const total = http.reduce((k, x) => k + (+x.n || 0), 0);
      const lastBackup = (h.backups || [])[0]; const jobsBad = (h.cron || []).filter((j) => j.last && j.last.status && j.last.status !== "succeeded");
      box.append(kpis([
        { l: "Client errors · 7 days", v: String(h.errors7d || 0), d: "from members who opted in" },
        { l: "Function calls · 24 h", v: String(total), d: fails ? fails + " failed" : "none failed", cls: fails ? "warn" : "" },
        { l: "Scheduled jobs", v: String((h.cron || []).length), d: jobsBad.length ? jobsBad.length + " last run failed" : "all last runs succeeded", cls: jobsBad.length ? "warn" : "" },
        { l: "Last backup", v: lastBackup ? when(lastBackup.at) : "never", d: lastBackup ? (lastBackup.ok ? "verified · " + kb(lastBackup.bytes) : "FAILED") : "run one under Backups", cls: lastBackup && !lastBackup.ok ? "warn" : "" },
        { l: "Rate-limit hits · 1 h", v: String(h.rateHits || 0), d: "callers above 60 a minute" },
      ]));
      main.append(panel("Errors by version · 7 days", tbl([{ l: "Version" }, { l: "App" }, { l: "Errors", num: 1 }], (h.errorsByVersion || []).map((r) => ({ cells: [r.version || "—", r.app || "—", String(r.n)] })), { empty: "No errors reported." })));
      main.append(panel("Latest errors", tbl([{ l: "When" }, { l: "App" }, { l: "Version" }, { l: "Platform" }, { l: "Message", wrap: 1 }], (h.recentErrors || []).map((r) => ({ cells: [when(r.at), r.app || "—", r.version || "—", r.platform || "—", r.message || ""] })), { empty: "No errors reported." })));
      main.append(panel("Scheduled jobs", tbl([{ l: "Job" }, { l: "Schedule" }, { l: "Last run" }, { l: "Status" }, { l: "Message", wrap: 1 }], (h.cron || []).map((j) => ({ cells: [j.job, j.schedule, j.last ? when(j.last.at) : "—", j.last ? j.last.status : "—", (j.last && j.last.message) || ""] })), { empty: "pg_cron is not on." })));
      main.append(panel("Function answers · 24 h", tbl([{ l: "Status" }, { l: "Count", num: 1 }], http.map((x) => ({ cells: [x.status == null ? "no answer" : String(x.status), String(x.n)] })), { empty: "No calls from the database in the last day." })));
    }).catch((e) => { box.className = "sh-err"; box.textContent = /Unknown action/.test(e.message) ? "The admin function is older than this app — redeploy it (GUIDE §2)." : "Could not load: " + e.message; });
  }

  function backups(main, X) {
    const { h1, panel, tbl } = X; main.innerHTML = "";
    const now = H("button", { class: "primary", onclick: async () => { now.disabled = true; now.textContent = "Backing up…"; try { const r = await CLOUD.backup("run"); SUITE.toast(r.ok ? "Backup done and verified" : "Backup finished with errors — see the list"); } catch (e) { SUITE.toast(e.message); } backups(main, X); } }, "Back up now");
    main.append(h1("Backups", "every company's rows as JSON in the private bucket \"backups\" — weekly on Sunday 03:15 UTC, the newest 12 kept, each read back to verify", now));
    const runs = H("div", { class: "sh-dim" }, "Loading…"); main.append(panel("Recent runs", runs));
    CLOUD.backup("status").then((s) => { runs.className = ""; runs.innerHTML = ""; runs.append(tbl([{ l: "When" }, { l: "Kind" }, { l: "Result" }, { l: "Size", num: 1 }, { l: "Rows", num: 1 }, { l: "Error", wrap: 1 }], (s.runs || []).map((r) => ({ cells: [when(r.ran_at), r.kind, H("span", { class: "sh-tag " + (r.ok ? "ok" : "warn") }, r.ok ? "verified" : "failed"), kb(r.bytes), String(Object.values(r.counts || {}).reduce((k, n) => k + (+n || 0), 0)), r.error || ""] })), { empty: "No backups yet — press Back up now." })); }).catch((e) => { runs.className = "sh-err"; runs.textContent = e.message; });
    const per = H("div", { class: "sh-dim" }, "Loading companies…"); main.append(panel("Restore drill", H("div", { class: "sh-dim", style: "line-height:1.5;margin-bottom:10px" }, "Restoring creates a NEW company named \"… (restored date)\" with you as its administrator, so the backup can be inspected next to the original. Nothing is overwritten; files in storage are not copied (GUIDE §12)."), per));
    CLOUD.admin("list_orgs").then(async (orgs) => {
      per.className = ""; per.innerHTML = ""; const sel = H("select", { style: "width:auto" }, (orgs || []).map((o) => H("option", { value: o.id }, o.name))); const list = H("div");
      const load = async () => { list.innerHTML = ""; list.append(H("div", { class: "sh-dim" }, "Loading…")); try { const r = await CLOUD.backup("list", { org: sel.value }); list.innerHTML = ""; list.append(tbl([{ l: "Backup" }, { l: "Kind" }, { l: "Rows", num: 1 }, { l: "Size", num: 1 }, { l: "" }], (r.backups || []).map((b) => { const date = String(b.at || "").slice(0, 19).replace(/[:T]/g, "-"); const stamp = (b.path || "").split("/")[1] || date; return { cells: [b.at ? new Date(b.at).toLocaleString() : stamp, b.kind || "—", String(Object.values(b.counts || {}).reduce((k, n) => k + (+n || 0), 0)), kb(b.bytes), b.error ? H("span", { class: "sh-err" }, b.error) : H("button", { class: "quiet", onclick: async () => { if (!(await SUITE.confirm({ title: "Restore into a new company?", text: "A new company is created from this backup for inspection; the original is untouched." }, "Restore"))) return; try { SUITE.busy && SUITE.busy("Restoring…"); const res = await CLOUD.backup("restore", { org: sel.value, date: stampOf(b) }); SUITE.toast("Restored into a new company (" + Object.values(res.done || {}).reduce((k, n) => k + n, 0) + " rows)"); } catch (e) { SUITE.toast(e.message); } finally { SUITE.busy && SUITE.busy(false); } } }, "Restore")] }; }), { empty: "No backups for this company yet." })); } catch (e) { list.innerHTML = ""; list.append(H("div", { class: "sh-err" }, e.message)); } };
      sel.onchange = load; per.append(H("div", { class: "sh-toolbar" }, H("span", { class: "sh-faint" }, "Company"), sel), list); if ((orgs || []).length) load();
    }).catch((e) => { per.className = "sh-err"; per.textContent = e.message; });
  }
  // the folder name of a backup: its manifest time as yyyy-mm-dd-hh-mm-ss (what the function writes)
  const stampOf = (b) => { if (b.stamp) return b.stamp; const d = new Date(b.at); const p = (n) => String(n).padStart(2, "0"); return isNaN(d) ? String(b.at || "") : d.getUTCFullYear() + "-" + p(d.getUTCMonth() + 1) + "-" + p(d.getUTCDate()) + "-" + p(d.getUTCHours()) + "-" + p(d.getUTCMinutes()) + "-" + p(d.getUTCSeconds()); };

  window.SETTINGS_EXTRA = (window.SETTINGS_EXTRA || []).concat([
    { id: "health", label: "Health", group: "owner", when: isOwner, draw: health },
    { id: "backups", label: "Backups", group: "owner", when: isOwner, draw: backups },
  ]);
  window.OWNER_HEALTH = { health, backups, stampOf };
})();
