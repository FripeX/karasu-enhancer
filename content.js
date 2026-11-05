// Auto-clicks the READY button of the ready check, with a configurable delay (storage key "readyDelay", in seconds).
(() => {
  const DEBUG = false;
  const SCAN_INTERVAL_MS = 400;
  const SCAN_THROTTLE_MS = 30;
  const MAX_DELAY_S = 10;
  // Match by CSS class, not text: independent of the site language
  const READY_SELECTOR = "button.match-ready-accept";

  let enabled = true;
  let delayMs = 0;
  let lastClicked = null;
  let pending = null;

  const log = (...a) => DEBUG && console.log("[Karasu Auto Ready]", ...a);
  const toMs = (s) => Math.round(Math.min(MAX_DELAY_S, Math.max(0, Number(s) || 0)) * 1000);

  chrome.storage.sync.get({ autoReady: true, readyDelay: 0 }, (v) => {
    enabled = v.autoReady;
    delayMs = toMs(v.readyDelay);
    scheduleScan();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync") return;
    if (changes.readyDelay) delayMs = toMs(changes.readyDelay.newValue);
    if (changes.autoReady) {
      enabled = changes.autoReady.newValue;
      if (!enabled) cancelPending();
      else scheduleScan();
    }
  });

  function isVisible(el) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return false;
    const s = getComputedStyle(el);
    return s.visibility !== "hidden" && s.display !== "none" && s.opacity !== "0";
  }

  function isReadyButton(el) {
    if (!el.isConnected) return false;
    if (!el.matches(READY_SELECTOR)) return false;
    if (el.disabled || el.getAttribute("aria-disabled") === "true") return false;
    if (el.getAttribute("aria-busy") === "true") return false;
    return isVisible(el);
  }

  function cancelPending() {
    if (!pending) return;
    clearTimeout(pending.timer);
    pending = null;
  }

  function fire(btn) {
    lastClicked = btn;
    log("clic sur READY", btn);
    btn.click();
  }

  function arm(btn) {
    if (delayMs <= 0) return fire(btn);
    log(`READY détecté, clic dans ${delayMs} ms`);
    const timer = setTimeout(() => {
      pending = null;
      if (enabled && isReadyButton(btn)) fire(btn);
    }, delayMs);
    pending = { btn, timer };
  }

  function scan() {
    if (!enabled) return;

    if (pending) {
      if (isReadyButton(pending.btn)) return;
      cancelPending();
    }

    if (lastClicked && (!lastClicked.isConnected || !isVisible(lastClicked))) lastClicked = null;

    for (const btn of document.querySelectorAll(READY_SELECTOR)) {
      if (btn === lastClicked) continue;
      if (isReadyButton(btn)) { arm(btn); return; }
    }
  }

  // setTimeout, not requestAnimationFrame: rAF is suspended in background tabs.
  let queued = false;
  function scheduleScan() {
    if (queued) return;
    queued = true;
    setTimeout(() => { queued = false; scan(); }, SCAN_THROTTLE_MS);
  }

  new MutationObserver(() => { if (enabled) scheduleScan(); }).observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["disabled", "class", "style", "aria-busy", "aria-disabled"],
  });
  setInterval(scan, SCAN_INTERVAL_MS);

  log("actif sur", location.hostname);
})();
