
(() => {
  const DEBUG = false;
  const I = self.KarasuI18n;
  const log = (...a) => DEBUG && console.log("[Karasu Map Optimizer]", ...a);

  let enabled = true;
  let stats = {};

  chrome.storage.sync.get({ mapOptimizer: true }, (v) => {
    enabled = v.mapOptimizer;
    loadStats();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.karasuMatches) loadStats();
    if (area === "sync" && changes.mapOptimizer) {
      enabled = changes.mapOptimizer.newValue;
      if (!enabled) removeOverlay();
      else render();
    }
  });

  function loadStats() {
    chrome.storage.local.get({ karasuMatches: {} }, (st) => {
      stats = buildStats(st.karasuMatches);
      render();
    });
  }

  const keyOf = (s) => String(s).toLowerCase().replace(/^de_/, "").replace(/[^a-z0-9]/g, "");

  function buildStats(matches) {
    const s = {};
    for (const m of Object.values(matches || {})) {
      if (!m || !Array.isArray(m.maps)) continue;
      if (m.ty && m.ty !== "Competitive") continue;
      for (const mp of m.maps) {
        const k = keyOf(mp.k);
        const e = s[k] || (s[k] = { w: 0, l: 0 });
        if (mp.w) e.w++; else e.l++;
      }
    }
    return s;
  }

  function getTopMaps(limit = 3) {
    const maps = Object.entries(stats)
      .map(([name, data]) => {
        const total = data.w + data.l;
        if (total < 2) return null;
        return { name, w: data.w, l: data.l, total, wr: Math.round((100 * data.w) / total) };
      })
      .filter(Boolean)
      .sort((a, b) => b.wr - a.wr || b.total - a.total)
      .slice(0, limit);
    return maps;
  }

  const STYLE_ID = "kar-map-opt-style";
  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const st = document.createElement("style");
    st.id = STYLE_ID;
    st.textContent = `
      [data-kar-pick] {
        margin: 12px 12px 0; padding: 12px 14px; border-radius: 8px;
        background: linear-gradient(135deg, rgba(25,181,230,.12) 0%, rgba(52,211,153,.08) 100%);
        border: 1px solid rgba(25,181,230,.2); box-shadow: 0 2px 8px rgba(0,0,0,.2);
        font: 500 12px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif; color: #e9e9ec;
      }
      [data-kar-pick] .kar-title { font-size: 11px; text-transform: uppercase; letter-spacing: .08em; color: #8a8a93; margin-bottom: 8px; }
      [data-kar-pick] .kar-maps { display: flex; flex-direction: column; gap: 6px; }
      [data-kar-pick] .kar-map { display: flex; justify-content: space-between; align-items: center; padding: 6px 8px; border-radius: 4px; background: rgba(18,18,22,.5); }
      [data-kar-pick] .kar-name { font-weight: 600; text-transform: capitalize; }
      [data-kar-pick] .kar-wr { font-size: 11px; color: #34d399; font-weight: 700; font-variant-numeric: tabular-nums; }
      @media (max-width: 480px) { [data-kar-pick] { margin: 10px 8px 0; padding: 10px 12px; } }
    `;
    (document.head || document.documentElement).appendChild(st);
  }

  function removeOverlay() {
    document.querySelectorAll("[data-kar-pick]").forEach((el) => el.remove());
  }

  function render() {
    if (!enabled || !document.body) return;
    const topMaps = getTopMaps(3);
    if (topMaps.length === 0) { removeOverlay(); return; }

    ensureStyle();

    let overlay = document.querySelector("[data-kar-pick]");
    if (!overlay) {
      const firstList = document.querySelector(".list");
      if (!firstList) return;
      overlay = document.createElement("div");
      overlay.setAttribute("data-kar-pick", "1");
      firstList.parentElement.insertBefore(overlay, firstList.nextSibling);
    }

    overlay.innerHTML = `
      <div class="kar-title">🔥 Meilleurs picks</div>
      <div class="kar-maps">
        ${topMaps.map((m) => `
          <div class="kar-map">
            <span class="kar-name">${m.name}</span>
            <span class="kar-wr">${m.wr}% <span style="font-size:10px;color:#8a8a93;">(${m.w}W-${m.l}L)</span></span>
          </div>
        `).join("")}
      </div>
    `;
  }

  I.ready.then(() => render());
  log("actif");
})();
