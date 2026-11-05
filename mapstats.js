
(() => {
  const DEBUG = false;
  const log = (...a) => DEBUG && console.log("[Karasu Maps]", ...a);

  const I = self.KarasuI18n;

  const KNOWN = ["ancient", "anubis", "cache", "cobblestone", "dust2", "inferno", "mirage",
                 "nuke", "overpass", "train", "tuscan", "vertigo", "office", "italy", "agency"];
  const MAX_MATCHES = 400;
  const THROTTLE_MS = 120;

  const API_URL = "https://api.karasu.live/v1/graphql";
  const TEAM_MATCHES = 30; // recent matches counted per player (like "L30" on the profile)
  const FETCH_LIMIT = 60; // margin: cancelled / ongoing matches are dropped client-side
  const CACHE_TTL_MS = 15 * 60 * 1000;
  const POOL_SIZE = 4;
  const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

  const COLOR_GOOD = "#34d399";
  const COLOR_BAD = "#f87171";
  const COLOR_MID = "#d4d4da";
  const COLOR_NONE = "#8a8a93";

  let enabled = true;
  let teamEnabled = true;
  let stats = {};
  let me = null; // steam_id of the logged-in account
  let team = null; // shape: { matchId, teams: [{ mine, players: [{ steam, name }] }], perPlayer: { steam: { mapKey: { w, l } } } }
  let timer = null;
  let queue = Promise.resolve();

  const keyOf = (s) => String(s).toLowerCase().replace(/^de_/, "").replace(/[^a-z0-9]/g, "");
  const colorOf = (pct) => (pct >= 60 ? COLOR_GOOD : pct <= 40 ? COLOR_BAD : COLOR_MID);

  const STYLE_ID = "kar-map-style";
  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const st = document.createElement("style");
    st.id = STYLE_ID;
    st.textContent = `
      [data-kar-map] {
        position: absolute; top: 6px; left: 6px; z-index: 3; min-width: 62px;
        padding: 5px 7px 6px; border-radius: 7px;
        background: rgba(12,12,14,.8);
        -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px);
        border: 1px solid rgba(255,255,255,.1);
        box-shadow: 0 2px 8px rgba(0,0,0,.35);
        font: 600 11px/1 system-ui, -apple-system, "Segoe UI", sans-serif;
        pointer-events: none;
      }
      [data-kar-map] .kar-top { display: flex; align-items: baseline; gap: 6px; white-space: nowrap; }
      [data-kar-map] .kar-pct {
        font-size: 13px; font-weight: 700; color: var(--kar-c, ${COLOR_NONE});
        font-variant-numeric: tabular-nums;
      }
      [data-kar-map] .kar-rec {
        font-size: 10px; font-weight: 500; color: #9a9aa4; font-variant-numeric: tabular-nums;
      }
      [data-kar-map] .kar-bar {
        height: 3px; margin-top: 5px; border-radius: 2px;
        background: rgba(255,255,255,.14); overflow: hidden;
      }
      [data-kar-map] .kar-fill {
        height: 100%; width: 0; border-radius: 2px;
        background: var(--kar-c, ${COLOR_NONE}); transition: width .25s ease;
      }
      [data-kar-map][data-low="1"] { opacity: .72; border-style: dashed; }
      [data-kar-map] .kar-teams {
        margin-top: 6px; padding-top: 5px; border-top: 1px solid rgba(255,255,255,.1);
        display: flex; flex-direction: column; gap: 3px;
      }
      [data-kar-map] .kar-teams[hidden] { display: none; }
      [data-kar-map] .kar-trow { display: flex; align-items: baseline; gap: 5px; white-space: nowrap; }
      [data-kar-map] .kar-tl { font-size: 9px; font-weight: 600; color: #7a7a84; min-width: 28px; text-transform: uppercase; letter-spacing: .04em; }
      [data-kar-map] .kar-tp {
        font-size: 11px; font-weight: 700; color: var(--c, ${COLOR_NONE}); font-variant-numeric: tabular-nums;
      }
      [data-kar-map] .kar-tn { font-size: 9px; font-weight: 500; color: #7a7a84; font-variant-numeric: tabular-nums; }
      @media (prefers-reduced-motion: reduce) { [data-kar-map] .kar-fill { transition: none; } }
      [data-kar-map][data-compact="1"] {
        left: auto; right: 4px; top: 4px; min-width: 0; padding: 4px 5px;
      }
      [data-kar-map][data-compact="1"] .kar-rec,
      [data-kar-map][data-compact="1"] .kar-bar { display: none; }
      [data-kar-map][data-compact="1"] .kar-pct { font-size: 11px; }
      [data-kar-map][data-compact="1"] .kar-teams { margin-top: 3px; padding-top: 3px; gap: 2px; }
      [data-kar-map][data-compact="1"] .kar-tl { min-width: 22px; font-size: 8px; }
      [data-kar-map][data-compact="1"] .kar-tp { font-size: 10px; }
      [data-kar-map][data-compact="1"] .kar-tn { display: none; }
    `;
    (document.head || document.documentElement).appendChild(st);
  }

  // Mirrors FACEIT Enhancer's "average last 30 matches" team stats:
  // fetch both teams' players, then their last 30 matches via GraphQL.

  const MATCH_QUERY = `query ($id: uuid!) {
    matches(where: {id: {_eq: $id}}, limit: 1) {
      id
      lineup_1 { id lineup_players { player { name steam_id } } }
      lineup_2 { id lineup_players { player { name steam_id } } }
    }
  }`;

  const HISTORY_QUERY = `query ($where: matches_bool_exp, $limit: Int!, $sid: bigint!) {
    matches(where: $where, limit: $limit, order_by: [{effective_at: desc_nulls_last}, {created_at: desc}]) {
      id
      status
      options { type }
      match_maps { map { name } winning_lineup_id }
      lineup_1 { id lineup_players(where: {steam_id: {_eq: $sid}}) { steam_id } }
      lineup_2 { id lineup_players(where: {steam_id: {_eq: $sid}}) { steam_id } }
    }
  }`;

  async function gql(query, variables) {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ query, variables }),
    });
    const json = await res.json();
    if (json.errors && json.errors.length) throw new Error(json.errors[0].message);
    if (!res.ok || !json.data) throw new Error(`HTTP ${res.status}`);
    return json.data;
  }

  const matchIdFromUrl = () => {
    const m = UUID_RE.exec(location.pathname);
    return m ? m[0].toLowerCase() : null;
  };

  // { mapKey: { w, l } } over the player's last TEAM_MATCHES finished (competitive) matches
  function summarize(matches, sid) {
    const out = {};
    let taken = 0;
    for (const m of matches) {
      if (taken >= TEAM_MATCHES) break;
      if (m.status !== "Finished") continue;
      if (m.options && m.options.type && m.options.type !== "Competitive") continue;
      const inLineup = (l) => l && Array.isArray(l.lineup_players) &&
        l.lineup_players.some((lp) => String(lp.steam_id) === sid);
      const mine = inLineup(m.lineup_1) ? m.lineup_1 : inLineup(m.lineup_2) ? m.lineup_2 : null;
      if (!mine) continue;
      taken++;
      for (const mm of m.match_maps || []) {
        if (!mm.map || !mm.map.name || !mm.winning_lineup_id) continue;
        const e = out[keyOf(mm.map.name)] || (out[keyOf(mm.map.name)] = { w: 0, l: 0 });
        if (mm.winning_lineup_id === mine.id) e.w++; else e.l++;
      }
    }
    return out;
  }

  const historyCache = new Map(); // steam_id -> { t, p: Promise<summary> }

  function playerHistory(sid) {
    const hit = historyCache.get(sid);
    if (hit && Date.now() - hit.t < CACHE_TTL_MS) return hit.p;
    const where = {
      _and: [
        { source: { _eq: "5stack" } },
        { _or: [
          { lineup_1: { lineup_players: { steam_id: { _eq: sid } } } },
          { lineup_2: { lineup_players: { steam_id: { _eq: sid } } } },
        ] },
      ],
    };
    const p = gql(HISTORY_QUERY, { where, limit: FETCH_LIMIT, sid })
      .then((d) => summarize(d.matches || [], sid));
    p.catch(() => historyCache.delete(sid));
    historyCache.set(sid, { t: Date.now(), p });
    return p;
  }

  async function pool(items, n, fn) {
    const it = items[Symbol.iterator]();
    await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
      for (let r = it.next(); !r.done; r = it.next()) await fn(r.value);
    }));
  }

  async function loadTeam(matchId) {
    const cur = { matchId, teams: [], perPlayer: {} };
    team = cur;
    try {
      const d = await gql(MATCH_QUERY, { id: matchId });
      const m = d.matches && d.matches[0];
      if (!m) throw new Error("match introuvable");
      cur.teams = [m.lineup_1, m.lineup_2].filter(Boolean).map((l) => {
        const players = (l.lineup_players || [])
          .filter((lp) => lp.player && lp.player.steam_id)
          .map((lp) => ({ steam: String(lp.player.steam_id), name: lp.player.name }));
        return { mine: me !== null && players.some((p) => p.steam === me), players };
      });
      schedule(0);

      const everyone = [...new Set(cur.teams.flatMap((t) => t.players.map((p) => p.steam)))];
      await pool(everyone, POOL_SIZE, async (sid) => {
        try {
          cur.perPlayer[sid] = await playerHistory(sid);
        } catch (e) {
          log("historique indisponible", sid, e);
        }
        if (team === cur) schedule(0);
      });
      console.info("[Karasu Maps] stats d'équipe chargées :", Object.keys(cur.perPlayer).length, "/", everyone.length, "joueurs");
    } catch (e) {
      console.warn("[Karasu Maps] stats d'équipe indisponibles :", e && e.message);
    }
  }

  // Per-player average win rate on a map: every player weighs the same, as on FACEIT Enhancer.
  function teamMapAvg(t, mapKey) {
    if (!team) return null;
    let sum = 0, players = 0, games = 0;
    for (const p of t.players) {
      const s = team.perPlayer[p.steam] && team.perPlayer[p.steam][mapKey];
      if (!s || s.w + s.l === 0) continue;
      sum += s.w / (s.w + s.l);
      games += s.w + s.l;
      players++;
    }
    return players ? { pct: Math.round((100 * sum) / players), games, players } : null;
  }

  // Display order: my team first (otherwise team 1, team 2).
  function teamRows() {
    if (!team || team.teams.length === 0) return [];
    const rows = team.teams.map((t, i) => ({
      t,
      label: t.mine ? I.t("teamUs") : team.teams.some((x) => x.mine) ? I.t("teamThem") : `T${i + 1}`,
    }));
    return rows.sort((a, b) => Number(b.t.mine) - Number(a.t.mine));
  }

  function syncTeam() {
    const id = teamEnabled ? matchIdFromUrl() : null;
    if (!id) { team = null; return; }
    if (team && team.matchId === id) return;
    loadTeam(id);
  }

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

  function loadStats() {
    chrome.storage.local.get({ karasuMatches: {}, karasuMe: null }, (st) => {
      stats = buildStats(st.karasuMatches);
      if (st.karasuMe !== me) { me = st.karasuMe; team = null; }
      schedule(0);
    });
  }

  function ingest(d) {
    return new Promise((resolve) => {
      chrome.storage.local.get({ karasuMatches: {}, karasuMe: null }, (st) => {
        let matches = st.karasuMatches;
        if (st.karasuMe && st.karasuMe !== d.me) matches = {}; // other account: start from scratch
        for (const it of d.items) matches[it.id] = { t: it.t, ty: it.ty, maps: it.maps };

        const ids = Object.keys(matches);
        if (ids.length > MAX_MATCHES) {
          ids.sort((a, b) => String(matches[b].t).localeCompare(String(matches[a].t)));
          ids.slice(MAX_MATCHES).forEach((id) => delete matches[id]);
        }
        chrome.storage.local.set({ karasuMatches: matches, karasuMe: d.me }, resolve);
      });
    });
  }

  let template = null;

  const validTemplate = (t) => {
    if (!t || typeof t.url !== "string" || typeof t.body !== "string" || t.body.length > 20000) return false;
    try {
      const h = new URL(t.url).hostname;
      if (h !== "karasu.live" && !h.endsWith(".karasu.live")) return false;
      return typeof JSON.parse(t.body).query === "string";
    } catch (e) { return false; }
  };

  function pushTemplate() {
    if (!template) return;
    window.postMessage({ source: "karasu-enhancer-ext", type: "template", url: template.url, body: template.body },
                       window.location.origin);
  }

  function saveTemplate(d) {
    const t = { url: d.url, body: d.body };
    if (!validTemplate(t)) return;
    if (template && template.url === t.url && template.body === t.body) return;
    template = t;
    chrome.storage.local.set({ karasuTemplate: t });
  }

  chrome.storage.local.get({ karasuTemplate: null }, (st) => {
    if (validTemplate(st.karasuTemplate)) { template = st.karasuTemplate; pushTemplate(); }
  });

  window.addEventListener("message", (ev) => {
    if (ev.source !== window) return;
    const d = ev.data;
    if (!d || d.source !== "karasu-enhancer") return;
    if (d.type === "matches") {
      if (typeof d.me !== "string" || !Array.isArray(d.items)) return;
      queue = queue.then(() => ingest(d)).catch(() => {});
    } else if (d.type === "template") {
      saveTemplate(d);
    }
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.karasuMatches) loadStats();
    if (area === "sync" && changes.mapStats) {
      enabled = changes.mapStats.newValue;
      if (!enabled) removeBadges();
      schedule(0);
    }
    if (area === "sync" && changes.teamMapStats) {
      teamEnabled = changes.teamMapStats.newValue;
      team = null;
      schedule(0);
    }
  });
  chrome.storage.sync.get({ mapStats: true, teamMapStats: true }, (v) => {
    enabled = v.mapStats;
    teamEnabled = v.teamMapStats;
    schedule(0);
  });
  loadStats();

  const relang = () => { removeBadges(); schedule(0); };
  I.ready.then(relang);
  I.onChange(relang);

  document.addEventListener("visibilitychange", () => { if (!document.hidden) schedule(0); });

  // Throttle, not debounce: a debounce never fires on a page that keeps changing.
  function schedule(delay = THROTTLE_MS) {
    if (timer) return;
    timer = setTimeout(() => { timer = null; render(); }, delay);
  }

  function removeBadges() {
    document.querySelectorAll("[data-kar-map]").forEach((b) => b.remove());
  }

  function lookup(tileKey) {
    if (stats[tileKey]) return stats[tileKey];
    if (tileKey.length < 4) return null;
    for (const k of Object.keys(stats)) {
      if (k.length >= 4 && (tileKey.startsWith(k) || k.startsWith(tileKey))) return stats[k];
    }
    return null;
  }

  // Canonical tile key ("dust2", "mirage"...) used to look up team stats.
  function canonKey(tk) {
    const k = KNOWN.find((n) => tk === n || (tk.startsWith(n) && /^\d{0,4}$/.test(tk.slice(n.length))));
    return k || tk;
  }

  function isMapName(tk) {
    if (!tk) return false;
    return KNOWN.some((k) => tk === k || (tk.startsWith(k) && /^\d{0,4}$/.test(tk.slice(k.length))));
  }

  // A tile = the smallest card-like ancestor with at least 2 siblings (the map grid).
  // Don't rely on <img>: the veto uses CSS background images.
  function findTile(textParent) {
    let el = textParent;
    for (let i = 0; i < 6 && el && el !== document.body; i++, el = el.parentElement) {
      const r = el.getBoundingClientRect();
      const siblings = el.parentElement ? el.parentElement.children.length : 0;
      if (r.width >= 80 && r.width <= 420 && r.height >= 50 && r.height <= 260 && siblings >= 3) return el;
    }
    el = textParent;
    for (let i = 0; i < 4 && el; i++, el = el.parentElement) {
      if (el.querySelector("img")) return el;
    }
    return textParent.parentElement || textParent;
  }

  // Map tiles all share the same size: ignore any lone element (profile card, sidebar...)
  // that merely looks like a tile.
  function sizeKey(el) {
    const r = el.getBoundingClientRect();
    return `${Math.round(r.width / 6)}x${Math.round(r.height / 6)}`;
  }

  function makeBadge() {
    const badge = document.createElement("div");
    badge.setAttribute("data-kar-map", "1");

    const top = document.createElement("div");
    top.className = "kar-top";
    const pct = document.createElement("span");
    pct.className = "kar-pct";
    const rec = document.createElement("span");
    rec.className = "kar-rec";
    top.append(pct, rec);

    const bar = document.createElement("div");
    bar.className = "kar-bar";
    const fill = document.createElement("div");
    fill.className = "kar-fill";
    bar.append(fill);

    const teams = document.createElement("div");
    teams.className = "kar-teams";
    teams.hidden = true;
    for (let i = 0; i < 2; i++) {
      const row = document.createElement("div");
      row.className = "kar-trow";
      const l = document.createElement("span");
      l.className = "kar-tl";
      const p = document.createElement("span");
      p.className = "kar-tp";
      const n = document.createElement("span");
      n.className = "kar-tn";
      row.append(l, p, n);
      teams.append(row);
    }

    badge.append(top, bar, teams);
    return badge;
  }

  const setText = (el, v) => { if (el.textContent !== v) el.textContent = v; };

  function updateTeams(badge, mapKey) {
    const box = badge.querySelector(".kar-teams");
    const rows = teamRows();
    box.hidden = rows.length === 0;
    const els = box.children;
    for (let i = 0; i < els.length; i++) {
      const r = rows[i];
      els[i].hidden = !r;
      if (!r) continue;
      const avg = teamMapAvg(r.t, mapKey);
      setText(els[i].children[0], r.label);
      setText(els[i].children[1], avg ? `${avg.pct}%` : "–");
      setText(els[i].children[2], avg ? `${avg.games}` : "");
      els[i].children[1].style.setProperty("--c", avg ? colorOf(avg.pct) : COLOR_NONE);
    }
  }

  function updateBadge(badge, e, mapKey) {
    const pctEl = badge.querySelector(".kar-pct");
    const recEl = badge.querySelector(".kar-rec");
    const fill = badge.querySelector(".kar-fill");

    let pctText = "–";
    let recText = I.t("noMatch");
    let width = "0%";
    let color = COLOR_NONE;
    let low = "0";

    if (e) {
      const g = e.w + e.l;
      const pct = Math.round((100 * e.w) / g);
      pctText = `${pct}%`;
      recText = `${e.w}${I.t("w")} ${e.l}${I.t("l")}`;
      width = `${pct}%`;
      color = colorOf(pct);
      if (g < 3) low = "1";
    }

    setText(pctEl, pctText);
    setText(recEl, recText);
    if (fill.style.width !== width) fill.style.width = width;
    badge.style.setProperty("--kar-c", color);
    if (badge.dataset.low !== low) badge.dataset.low = low;
    updateTeams(badge, mapKey);
  }

  // Mutations caused by our own badges must not trigger a full rescan.
  const isOwnNode = (n) => n.nodeType === 1 && n.hasAttribute("data-kar-map");
  function isOwnMutation(m) {
    const t = m.target.nodeType === 1 ? m.target : m.target.parentElement;
    if (t && t.closest("[data-kar-map]")) return true;
    const changed = [...m.addedNodes, ...m.removedNodes];
    return changed.length > 0 && changed.every(isOwnNode);
  }

  function render() {
    if (!enabled || !document.body || document.hidden) return;
    syncTeam();
    if (!Object.keys(stats).length && !team) { removeBadges(); return; }
    ensureStyle();

    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    // On a match page (ban phase) there may be no "Map preferences" heading.
    let isLobby = Boolean(team);
    const candidates = [];
    let node;
    while ((node = walker.nextNode())) {
      const parent = node.parentElement;
      if (!parent || parent.closest("[data-kar-map], script, style")) continue;
      const t = node.nodeValue.replace(/\s+/g, " ").trim();
      if (!t || t.length > 24) continue;
      if (/^map preferences$/i.test(t)) { isLobby = true; continue; }
      if (!isLobby) continue; // tiles always come after the "Map preferences" heading
      const tk = keyOf(t);
      if (isMapName(tk) || lookup(tk)) candidates.push({ parent, tk });
    }

    // One tile per element, excluding sidebars / navigation
    const tiles = new Map();
    for (const { parent, tk } of candidates) {
      const tile = findTile(parent);
      if (tile.closest("aside, nav, header, footer")) continue;
      if (!tiles.has(tile)) tiles.set(tile, tk);
    }

    // Keep only the largest group of same-size tiles (at least 3)
    const bySize = new Map();
    for (const tile of tiles.keys()) {
      const k = sizeKey(tile);
      if (!bySize.has(k)) bySize.set(k, []);
      bySize.get(k).push(tile);
    }
    let valid = [];
    for (const group of bySize.values()) if (group.length > valid.length) valid = group;
    if (valid.length < 3) valid = [];
    const validSet = new Set(valid);

    // Cleanup: any badge outside a valid tile is removed
    document.querySelectorAll("[data-kar-map]").forEach((b) => {
      if (!validSet.has(b.parentElement)) b.remove();
    });

    for (const tile of valid) {
      const tk = tiles.get(tile);
      const e = lookup(tk);
      const compact = tile.getBoundingClientRect().height < 110 ? "1" : "0";
      let badge = tile.querySelector(":scope > [data-kar-map]");
      if (!badge) {
        if (getComputedStyle(tile).position === "static") tile.style.position = "relative";
        badge = makeBadge();
        tile.appendChild(badge);
      }
      if (badge.dataset.compact !== compact) badge.dataset.compact = compact;
      updateBadge(badge, e, canonKey(tk));
    }
    log("tuiles de maps :", valid.length);
  }

  // Observe `document`: works even if <html> doesn't exist yet at document_start.
  new MutationObserver((muts) => {
    if (!enabled) return;
    if (muts.every(isOwnMutation)) return;
    schedule();
  }).observe(document, { childList: true, subtree: true });
})();
