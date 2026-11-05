
(() => {
  const DEBUG = false;
  const I = self.KarasuI18n;
  const log = (...a) => DEBUG && console.log("[Karasu Session Stats]", ...a);

  let enabled = true;
  let currentStats = { kills: 0, deaths: 0, rwins: 0, rlosses: 0 };
  let lastSig = "";

  chrome.storage.sync.get({ sessionStats: true }, (v) => {
    enabled = v.sessionStats;
    render();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync" || !changes.sessionStats) return;
    enabled = changes.sessionStats.newValue;
    if (!enabled) removeOverlay();
  });

  const STYLE_ID = "kar-session-style";
  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const st = document.createElement("style");
    st.id = STYLE_ID;
    st.textContent = `
      [data-kar-session] {
        position: fixed; bottom: 16px; right: 16px; z-index: 9999;
        padding: 12px 16px; border-radius: 8px; background: rgba(12,12,14,.92);
        border: 1px solid rgba(255,255,255,.12); box-shadow: 0 4px 16px rgba(0,0,0,.4);
        font: 500 12px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif;
        color: #e9e9ec;
      }
      [data-kar-session] .kar-row { display: flex; gap: 16px; }
      [data-kar-session] .kar-stat { display: flex; align-items: baseline; gap: 4px; }
      [data-kar-session] .kar-val { font-weight: 700; font-variant-numeric: tabular-nums; }
      [data-kar-session] .kar-lbl { font-size: 10px; color: #8a8a93; }
      @media (max-width: 480px) { [data-kar-session] { font-size: 11px; padding: 8px 12px; } }
    `;
    (document.head || document.documentElement).appendChild(st);
  }

  function removeOverlay() {
    document.querySelectorAll("[data-kar-session]").forEach((el) => el.remove());
  }

  function extractStats() {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    let k = 0, d = 0, rw = 0, rl = 0;
    const patterns = [
      /(\d+)\s*\/\s*(\d+)/, // K/D format
      /kills?:\s*(\d+)/i,
      /deaths?:\s*(\d+)/i,
      /rounds?\s+won?:\s*(\d+)/i,
      /rounds?\s+lost?:\s*(\d+)/i,
    ];

    while ((node = walker.nextNode())) {
      const t = (node.nodeValue || "").trim();
      if (!t || t.length > 50) continue;

      const kdMatch = t.match(/^(\d+)\s*\/\s*(\d+)$/);
      if (kdMatch) {
        k = parseInt(kdMatch[1], 10);
        d = parseInt(kdMatch[2], 10);
      }
    }
    return { k, d, rw, rl };
  }

  function render() {
    if (!enabled || !document.body) return;
    const stats = extractStats();
    if (!stats.k && !stats.d) { removeOverlay(); return; }

    ensureStyle();
    let overlay = document.querySelector("[data-kar-session]");
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.setAttribute("data-kar-session", "1");
      document.body.appendChild(overlay);
    }

    const sig = `${stats.k}|${stats.d}`;
    if (sig === lastSig) return;
    lastSig = sig;

    const kda = stats.d > 0 ? (stats.k / stats.d).toFixed(2) : stats.k;
    overlay.innerHTML = `
      <div class="kar-row">
        <div class="kar-stat"><span class="kar-val">${stats.k}</span> <span class="kar-lbl">K</span></div>
        <div class="kar-stat"><span class="kar-val">${stats.d}</span> <span class="kar-lbl">D</span></div>
        <div class="kar-stat"><span class="kar-val">${kda}</span> <span class="kar-lbl">KDA</span></div>
      </div>
    `;
  }

  new MutationObserver(() => {
    if (!enabled) return;
    render();
  }).observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
  });

  I.ready.then(() => render());
  log("actif");
})();
