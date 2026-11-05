
(() => {
  const DEBUG = false;
  const K = 44;
  const M_MIN = 0.9;
  const M_MAX = 1.5;
  const THROTTLE_MS = 200;

  const COLOR_GOOD = "#34d399";
  const COLOR_BAD = "#f87171";

  const I = self.KarasuI18n;
  const log = (...a) => DEBUG && console.log("[Karasu Elo]", ...a);

  let enabled = true;
  let state = { sig: "", badges: [] };
  let timer = null;

  // Throttle, not debounce: a debounce never fires on a page that keeps changing.
  function schedule(delay = THROTTLE_MS) {
    if (timer) return;
    timer = setTimeout(() => { timer = null; run(); }, delay);
  }

  chrome.storage.sync.get({ teamElo: true }, (v) => { enabled = v.teamElo; schedule(0); });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync" || !changes.teamElo) return;
    enabled = changes.teamElo.newValue;
    if (!enabled) clearBadges();
    schedule(0);
  });

  const relang = () => { clearBadges(); schedule(0); };
  I.ready.then(relang);
  I.onChange(relang);

  document.addEventListener("visibilitychange", () => { if (!document.hidden) schedule(0); });

  const STYLE_ID = "kar-elo-style";
  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const st = document.createElement("style");
    st.id = STYLE_ID;
    st.textContent = `
      [data-kar-badge] {
        display: block; box-sizing: border-box; width: max-content; min-width: 220px; max-width: 100%;
        margin-top: 6px; padding: 9px 12px 10px; border-radius: 10px;
        background: rgba(18,18,22,.94);
        border: 1px solid rgba(255,255,255,.08);
        border-left: 3px solid var(--kar-c, rgba(255,255,255,.18));
        box-shadow: 0 2px 10px rgba(0,0,0,.28);
        color: #ececef; text-align: left;
        font: 500 12px/1.25 system-ui, -apple-system, "Segoe UI", sans-serif;
      }
      [data-kar-badge] .kar-row {
        display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 4px 16px;
      }
      [data-kar-badge] .kar-lbl { color: #8a8a93; }
      [data-kar-badge] .kar-val { font-weight: 700; font-variant-numeric: tabular-nums; }
      [data-kar-badge] .kar-note { margin-left: 5px; font-size: 11px; font-weight: 500; color: #8a8a93; }
      [data-kar-badge] .kar-chance {
        font-size: 15px; font-weight: 800; font-variant-numeric: tabular-nums; color: var(--kar-c, #ececef);
      }
      [data-kar-badge] .kar-bar {
        height: 5px; margin: 8px 0; border-radius: 3px;
        background: rgba(255,255,255,.12); overflow: hidden;
      }
      [data-kar-badge] .kar-fill {
        height: 100%; border-radius: 3px; background: var(--kar-c, #ececef);
        animation: kar-grow .45s ease-out;
      }
      @keyframes kar-grow { from { width: 0 } }
      [data-kar-badge] .kar-gain { color: ${COLOR_GOOD}; font-weight: 700; font-variant-numeric: tabular-nums; }
      [data-kar-badge] .kar-loss { color: ${COLOR_BAD}; font-weight: 700; font-variant-numeric: tabular-nums; }
      @media (prefers-reduced-motion: reduce) { [data-kar-badge] .kar-fill { animation: none; } }
    `;
    (document.head || document.documentElement).appendChild(st);
  }

  function clearBadges() {
    state.badges.forEach((b) => b.remove());
    state = { sig: "", badges: [] };
  }

  // Mutations caused by our own badges must not trigger a full rescan.
  const isOwnNode = (n) => n.nodeType === 1 && n.hasAttribute("data-kar-badge");
  function isOwnMutation(m) {
    const t = m.target.nodeType === 1 ? m.target : m.target.parentElement;
    if (t && t.closest("[data-kar-badge]")) return true;
    const changed = [...m.addedNodes, ...m.removedNodes];
    return changed.length > 0 && changed.every(isOwnNode);
  }

  // Walks the page text in DOM order: a "5 players · ..." header opens a team,
  // and the following "NNN Elo" values belong to it.
  function collectTeams() {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const teams = [];
    let current = null;
    let prev = "";
    let finished = false;
    let node;

    while ((node = walker.nextNode())) {
      const parent = node.parentElement;
      if (!parent || parent.closest("[data-kar-badge], script, style")) continue;
      const t = node.nodeValue.replace(/\s+/g, " ").trim();
      if (!t) continue;

      if (t === "Finished") finished = true;

      const header = t.length < 60 && t.match(/\b(\d+)\s+players?\b/i);
      if (header) {
        current = { el: parent, count: Number(header[1]), elos: [] };
        teams.push(current);
        prev = t;
        continue;
      }

      if (current && current.elos.length < current.count) {
        let elo = null;
        // strip "Level 3" so it isn't mistaken for the start of the number
        const m = t.replace(/Level\s*\d+/i, "").match(/(\d[\d ,.]*)\s*Elo\b/i);
        if (m) elo = parseInt(m[1].replace(/\D/g, ""), 10);
        else if (/^elo$/i.test(t) && /^\d[\d ,.]*$/.test(prev)) elo = parseInt(prev.replace(/\D/g, ""), 10);
        if (Number.isFinite(elo)) current.elos.push(elo);
      }
      prev = t;
    }
    return { teams: teams.filter((t) => t.elos.length > 0), finished };
  }

  const avg = (a) => a.reduce((s, x) => s + x, 0) / a.length;
  const expected = (mine, other) => 1 / (1 + Math.pow(10, (other - mine) / 400));

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  function makeBadge(team, own, other, finished) {
    const box = document.createElement("div");
    box.setAttribute("data-kar-badge", "1");

    const partial = team.elos.length < team.count
      ? `${team.elos.length}/${team.count} ${I.t("players")}`
      : "";

    const row1 = el("div", "kar-row");
    const left = el("span");
    left.append(el("span", "kar-lbl", I.t(finished ? "avgNow" : "avg") + " "),
                el("span", "kar-val", String(Math.round(own))));
    if (partial) left.append(el("span", "kar-note", partial));
    row1.append(left);

    if (finished) {
      // Displayed Elo values are post-match: no prediction possible
      box.append(row1);
      return box;
    }

    const e = expected(own, other);
    const chance = Math.round(e * 100);
    box.style.setProperty("--kar-c", chance >= 50 ? COLOR_GOOD : COLOR_BAD);

    row1.append(el("span", "kar-chance", `${chance}%`));

    const bar = el("div", "kar-bar");
    const fill = el("div", "kar-fill");
    fill.style.width = `${chance}%`;
    bar.append(fill);

    const win = [K * (1 - e) * M_MIN, K * (1 - e) * M_MAX].map(Math.round);
    // on a loss, a good performance reduces the penalty
    const loss = [K * e * (2 - M_MAX), K * e * (2 - M_MIN)].map(Math.round);
    const to = I.t("to");

    const row2 = el("div", "kar-row");
    const w = el("span");
    w.append(el("span", "kar-lbl", I.t("win") + " "), el("span", "kar-gain", `+${win[0]} ${to} +${win[1]}`));
    const l = el("span");
    l.append(el("span", "kar-lbl", I.t("loss") + " "), el("span", "kar-loss", `−${loss[0]} ${to} −${loss[1]}`));
    row2.append(w, l);

    box.append(row1, bar, row2);
    return box;
  }

  function run() {
    if (!enabled || !document.body || document.hidden) return;
    const { teams, finished } = collectTeams();
    if (teams.length !== 2) { if (state.badges.length) clearBadges(); return; }

    const a = avg(teams[0].elos);
    const b = avg(teams[1].elos);
    const sig = `${a}|${b}|${teams[0].elos.length}|${teams[1].elos.length}|${finished}`;
    if (sig === state.sig && state.badges.every((x) => x.isConnected)) return;

    ensureStyle();
    clearBadges();
    const badgeA = makeBadge(teams[0], a, b, finished);
    const badgeB = makeBadge(teams[1], b, a, finished);
    teams[0].el.after(badgeA);
    teams[1].el.after(badgeB);
    state = { sig, badges: [badgeA, badgeB] };
    log(finished ? "match terminé" : "match à venir", "| équipe 1", Math.round(a), "| équipe 2", Math.round(b));
  }

  new MutationObserver((muts) => {
    if (!enabled) return;
    if (muts.every(isOwnMutation)) return;
    schedule();
  }).observe(document.documentElement, { childList: true, subtree: true });
})();
