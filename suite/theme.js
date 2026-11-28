/* XYNTAX · theme (4.10). Loaded first, in the head, so the page paints in the right theme from the first frame.
   Three modes — dark (default), light, system — kept per device in localStorage; the effective theme is written to
   <html data-theme="dark|light"> and every token in vertu.css / graphite.css reads from that. SUITE.theme is an alias. */
(function () {
  const KEY = "xyntax.theme"; const mq = typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: light)") : null;
  const read = () => { try { const v = localStorage.getItem(KEY); return v === "light" || v === "system" ? v : "dark"; } catch (e) { return "dark"; } };
  const T = {
    mode() { return read(); },
    effective(mode) { mode = mode || read(); return mode === "system" ? (mq && mq.matches ? "light" : "dark") : mode; },
    isLight() { return T.effective() === "light"; },
    apply() {
      const eff = T.effective(); const root = document.documentElement; const was = root.dataset.theme;
      root.dataset.theme = eff; root.style.colorScheme = eff;
      let meta = document.querySelector('meta[name="theme-color"]'); if (!meta && document.head) { meta = document.createElement("meta"); meta.name = "theme-color"; document.head.append(meta); }
      if (meta) meta.content = eff === "light" ? "#f4f5f7" : "#0a0b0c";
      if (was !== eff) { try { window.dispatchEvent(new CustomEvent("theme-change", { detail: { theme: eff, mode: read() } })); } catch (e) { /* no DOM */ } }
      return eff;
    },
    set(mode) { mode = mode === "light" || mode === "system" ? mode : "dark"; try { localStorage.setItem(KEY, mode); } catch (e) { /* private window */ } return T.apply(); },
    toggle() { return T.set(T.isLight() ? "dark" : "light"); },
    // 4.16 · density: comfortable (default) or compact — tables, lists and rows tighten; per device like the theme
    density() { try { return localStorage.getItem(KEY + ".density") === "compact" ? "compact" : "comfortable"; } catch (e) { return "comfortable"; } },
    setDensity(d) { d = d === "compact" ? "compact" : "comfortable"; try { localStorage.setItem(KEY + ".density", d); } catch (e) { /* private window */ } document.documentElement.dataset.density = d; try { window.dispatchEvent(new CustomEvent("density-change", { detail: { density: d } })); } catch (e) { /* no DOM */ } return d; },
  };
  document.documentElement.dataset.density = T.density();
  if (mq && mq.addEventListener) mq.addEventListener("change", () => { if (read() === "system") T.apply(); });
  T.apply(); window.THEME = T;
})();
