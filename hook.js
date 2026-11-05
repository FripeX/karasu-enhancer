// Runs in the page context (world: MAIN), before the site's own code.
// Extracts map + result from match-history GraphQL responses and replays the learned history request on each load to keep map stats synced.
(() => {
  if (window.__karasuEnhancerHook) return;
  window.__karasuEnhancerHook = true;

  const SRC = "karasu-enhancer";
  const EXT = "karasu-enhancer-ext";
  const SYNC_EVERY_MS = 10 * 60 * 1000;
  const RETRY_GAP_MS = 3000;
  const MAX_ATTEMPTS = 3;
  const SYNC_LIMIT = 100;
  const pageOrigin = window.location.origin;

  let template = null; // learned history request
  let lastReq = null; // last GraphQL request made by the site (for auth)
  let syncing = false;
  let lastSyncOk = 0;
  let lastAttempt = 0;
  let attempts = 0;

  const isKarasuUrl = (u) => {
    try {
      const h = new URL(u, window.location.href).hostname;
      return h === "karasu.live" || h.endsWith(".karasu.live");
    } catch (e) { return false; }
  };

  function extract(json) {
    const data = json && json.data;
    if (!data || typeof data !== "object") return null;

    const items = [];
    let me = null;
    let allMine = true;

    for (const list of Object.values(data)) {
      if (!Array.isArray(list)) continue;
      for (const m of list) {
        if (!m || !Array.isArray(m.match_maps)) continue;
        if (m.status !== "Finished") continue;
        // Only keep the logged-in user's history
        if (m.is_in_lineup !== true) { allMine = false; continue; }

        const elo = m.elo_changes && m.elo_changes[0];
        const sid = elo && elo.player_steam_id;
        if (!sid) continue;
        if (me && me !== sid) { allMine = false; continue; }
        me = sid;

        const lineup = [m.lineup_1, m.lineup_2].find(
          (l) => l && Array.isArray(l.lineup_players) &&
                 l.lineup_players.some((lp) => lp.player && lp.player.steam_id === sid)
        );
        const myLineupId = lineup ? lineup.id : null;

        const maps = [];
        for (const mm of m.match_maps) {
          if (!mm.map || !mm.map.name || !mm.winning_lineup_id) continue;
          let won;
          if (myLineupId) won = mm.winning_lineup_id === myLineupId;
          else if (m.match_maps.length === 1 && elo.match_result) won = elo.match_result === "win";
          else continue;
          maps.push({ k: mm.map.name, w: won });
        }
        if (maps.length) {
          items.push({
            id: m.id,
            t: m.ended_at || m.created_at || null,
            ty: (m.options && m.options.type) || null,
            maps,
          });
        }
      }
    }
    if (!me || !allMine || !items.length) return null;
    return { me: String(me), items };
  }

  function handle(res) {
    if (!res || !res.ok) return "";
    return res.clone().text();
  }

  function process(text) {
    // Cheap prefilter: only parse responses that contain played maps
    if (!text || text.indexOf('"match_maps"') === -1) return null;
    const r = extract(JSON.parse(text));
    if (r) window.postMessage({ source: SRC, type: "matches", me: r.me, items: r.items }, pageOrigin);
    return r;
  }

  function replayBody(raw) {
    try {
      const b = JSON.parse(raw);
      if (!b || typeof b.query !== "string") return null;
      const v = b.variables && typeof b.variables === "object" ? { ...b.variables } : {};
      if ("limit" in v) v.limit = Math.max(Number(v.limit) || 0, SYNC_LIMIT);
      if ("offset" in v) v.offset = 0;
      b.variables = v;
      return JSON.stringify(b);
    } catch (e) { return null; }
  }

  function maybeSync() {
    if (syncing || !template || !lastReq) return;
    const now = Date.now();
    if (lastSyncOk && now - lastSyncOk < SYNC_EVERY_MS) return;
    if (attempts >= MAX_ATTEMPTS || now - lastAttempt < RETRY_GAP_MS) return;

    const body = replayBody(template.body);
    if (!body) { attempts = MAX_ATTEMPTS; return; }

    syncing = true;
    lastAttempt = now;
    orig.call(window, template.url, {
      method: "POST",
      headers: { ...lastReq.headers, "content-type": "application/json" },
      credentials: lastReq.credentials,
      body,
    })
      .then(handle)
      .then(process)
      .then((r) => { if (r) { lastSyncOk = Date.now(); attempts = 0; } else attempts++; })
      .catch(() => { attempts++; })
      .then(() => { syncing = false; });
  }

  // The extension (mapstats.js) sends back the stored request on page load.
  window.addEventListener("message", (ev) => {
    if (ev.source !== window) return;
    const d = ev.data;
    if (!d || d.source !== EXT || d.type !== "template") return;
    if (typeof d.url !== "string" || typeof d.body !== "string" || !isKarasuUrl(d.url)) return;
    template = { url: d.url, body: d.body };
    maybeSync();
  });

  const orig = window.fetch;
  if (typeof orig !== "function") return;

  const headersOf = (a0, init) => {
    try {
      const h = (init && init.headers) || (a0 && a0.headers) || {};
      return Object.fromEntries(new Headers(h).entries());
    } catch (e) { return {}; }
  };

  window.fetch = function (...args) {
    const p = orig.apply(this, args);
    try {
      const a0 = args[0];
      const init = args[1];
      const url = typeof a0 === "string" ? a0 : (a0 && a0.url) || String(a0);
      if (url.indexOf("/v1/graphql") !== -1) {
        lastReq = {
          headers: headersOf(a0, init),
          credentials: (init && init.credentials) || (a0 && a0.credentials) || "same-origin",
        };
        const body = init && typeof init.body === "string" ? init.body : null;

        // Attached before the site receives the promise, so the body is never already consumed
        p.then(handle).then(process).then((r) => {
          // Valid history response: remember the request to replay it later
          if (r && body && isKarasuUrl(url) && body.length < 20000) {
            template = { url, body };
            window.postMessage({ source: SRC, type: "template", url, body }, pageOrigin);
          }
        }).catch(() => {});

        maybeSync();
      }
    } catch (e) { /* never break the site */ }
    return p;
  };
})();
