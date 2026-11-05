
(() => {
  if (self.KarasuI18n) return;

  const DICT = {
    fr: {
      autoReady: "Auto-ready",
      autoReadyHint: "Clique sur READY dès que le match est trouvé",
      readyDelay: "Délai avant le clic",
      delayInstant: "Instantané",
      groupMatch: "Matchmaking",
      groupOverlay: "Affichages en jeu",
      teamElo: "Elo des équipes",
      teamEloHint: "Moyenne, chances de victoire et gain d'Elo prévu",
      mapStats: "Stats de maps",
      mapStatsHint: "Ton % de victoire sur chaque map du lobby",
      teamMapStats: "Stats de maps des équipes",
      teamMapStatsHint: "Moyenne des 30 derniers matchs de chaque équipe, par map",
      teamUs: "Nous",
      teamThem: "Eux",
      notifications: "Notifications",
      notificationsHint: "Alerte quand un match est trouvé",
      mapOptimizer: "Meilleurs picks",
      mapOptimizerHint: "Suggère les maps où tu as le meilleur winrate",
      sessionStats: "Stats en live",
      sessionStatsHint: "Affiche K/D et KDA pendant le match",
      matchOne: "{n} match enregistré pour les stats de maps.",
      matchMany: "{n} matchs enregistrés pour les stats de maps.",
      matchNone: "Aucun match enregistré. Ouvre ton historique de matchs sur karasu.live une seule fois : ensuite les stats se synchronisent toutes seules.",
      authorLink: "Voir le GitHub de FripeX",
      language: "Langue",
      w: "V",
      l: "D",
      noMatch: "aucun match",
      avg: "Elo moyen",
      avgNow: "Elo moyen actuel",
      players: "joueurs",
      win: "Victoire",
      loss: "Défaite",
      to: "à",
    },
    en: {
      autoReady: "Auto-ready",
      autoReadyHint: "Clicks READY as soon as a match is found",
      readyDelay: "Click delay",
      delayInstant: "Instant",
      groupMatch: "Matchmaking",
      groupOverlay: "In-game overlays",
      teamElo: "Team Elo",
      teamEloHint: "Average, win chance and expected Elo change",
      mapStats: "Map stats",
      mapStatsHint: "Your win rate on each lobby map",
      teamMapStats: "Team map stats",
      teamMapStatsHint: "Each team's average last 30 matches, per map",
      teamUs: "Us",
      teamThem: "Them",
      notifications: "Notifications",
      notificationsHint: "Alert when a match is found",
      mapOptimizer: "Best picks",
      mapOptimizerHint: "Suggests maps where you have the best winrate",
      sessionStats: "Live stats",
      sessionStatsHint: "Shows K/D and KDA during the match",
      matchOne: "{n} match saved for map stats.",
      matchMany: "{n} matches saved for map stats.",
      matchNone: "No matches saved yet. Open your match history on karasu.live just once: after that, stats sync automatically.",
      authorLink: "View FripeX on GitHub",
      language: "Language",
      w: "W",
      l: "L",
      noMatch: "no matches",
      avg: "Average Elo",
      avgNow: "Current average Elo",
      players: "players",
      win: "Win",
      loss: "Loss",
      to: "to",
    },
  };

  const detect = () => {
    const ui = (chrome.i18n && chrome.i18n.getUILanguage && chrome.i18n.getUILanguage()) || navigator.language || "fr";
    return /^fr/i.test(ui) ? "fr" : "en";
  };

  let lang = detect();
  const listeners = [];

  const t = (key, vars) => {
    let s = DICT[lang] && DICT[lang][key];
    if (s === undefined) s = DICT.fr[key];
    if (s === undefined) s = key;
    if (vars) for (const k of Object.keys(vars)) s = s.split(`{${k}}`).join(vars[k]);
    return s;
  };

  const ready = new Promise((resolve) => {
    try {
      chrome.storage.sync.get({ lang }, (v) => {
        if (v && DICT[v.lang]) lang = v.lang;
        resolve();
      });
    } catch (e) {
      resolve();
    }
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync" || !changes.lang || !DICT[changes.lang.newValue]) return;
    lang = changes.lang.newValue;
    listeners.forEach((fn) => { try { fn(lang); } catch (e) { /* ignore */ } });
  });

  self.KarasuI18n = {
    t,
    ready,
    onChange: (fn) => listeners.push(fn),
    get lang() { return lang; },
  };
})();
