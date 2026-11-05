
(() => {
  const DEBUG = false;
  const MATCH_FOUND_RE = /match\s+(found|started|en\s+cours)|partie\s+(trouvée|lancée|commencée)/i;

  const log = (...a) => DEBUG && console.log("[Karasu Notifications]", ...a);

  let enabled = true;
  let lastNotificationTime = 0;
  const NOTIFICATION_COOLDOWN = 30000;

  chrome.storage.sync.get({ notifications: true }, (v) => {
    enabled = v.notifications;
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync" || !changes.notifications) return;
    enabled = changes.notifications.newValue;
  });

  function findMatchFoundIndicator() {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (MATCH_FOUND_RE.test(node.nodeValue)) {
        log("Texte trouvé:", node.nodeValue);
        return node.parentElement;
      }
    }
    return null;
  }

  function notifyMatchFound() {
    if (!enabled) return;

    const now = Date.now();
    if (now - lastNotificationTime < NOTIFICATION_COOLDOWN) {
      log("Cooldown actif, notification ignorée");
      return;
    }

    lastNotificationTime = now;
    log("Envoi notification");
    chrome.runtime.sendMessage(
      { type: "notify", title: "Match trouvé!", message: "Ton match sur Karasu est prêt !" },
      () => { if (chrome.runtime.lastError) log("Notification échouée:", chrome.runtime.lastError); }
    );
  }

  let currentlyFound = false;

  new MutationObserver(() => {
    if (!enabled) return;
    const found = findMatchFoundIndicator();

    if (found && !currentlyFound) {
      currentlyFound = true;
      notifyMatchFound();
    } else if (!found && currentlyFound) {
      currentlyFound = false;
      lastNotificationTime = 0; // Reset cooldown when the match disappears
    }
  }).observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
  });

  log("actif");
})();
