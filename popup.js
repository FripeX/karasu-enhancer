const I = self.KarasuI18n;
if (!I) throw new Error("i18n.js non chargé : vérifie que popup.html l'inclut avant popup.js");

const $ = (id) => document.getElementById(id);
const DEFAULTS = { autoReady: false, teamElo: true, mapStats: true, teamMapStats: true, readyDelay: 0, notifications: true, mapOptimizer: true, sessionStats: true };

const boxes = [...document.querySelectorAll("input[data-key]")];
const autoBox = document.querySelector('input[data-key="autoReady"]');
const delayInput = $("delay");
const delayBox = $("delay-box");
const MAX_DELAY = Number(delayInput.max);
const round = (v) => Math.round(v * 10) / 10;
const clampDelay = (v) => round(Math.min(MAX_DELAY, Math.max(0, Number(v) || 0)));

function syncDelayState() {
  const on = autoBox.checked;
  delayBox.setAttribute("aria-disabled", String(!on));
  delayInput.disabled = !on;
}

chrome.storage.sync.get(DEFAULTS, (v) => {
  boxes.forEach((b) => { b.checked = Boolean(v[b.dataset.key]); });
  delayInput.value = clampDelay(v.readyDelay);
  syncDelayState();
});

boxes.forEach((b) => {
  b.addEventListener("change", () => {
    chrome.storage.sync.set({ [b.dataset.key]: b.checked });
    if (b === autoBox) syncDelayState();
  });
});

// Manual seconds input: saved on commit (blur / Enter), and live while the value is valid,
// so the setting is never lost if the popup closes.
let saveTimer = null;
const saveDelay = () => chrome.storage.sync.set({ readyDelay: clampDelay(delayInput.value) });
delayInput.addEventListener("input", () => {
  if (delayInput.value === "") return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveDelay, 300);
});
delayInput.addEventListener("change", () => {
  clearTimeout(saveTimer);
  delayInput.value = clampDelay(delayInput.value); // fixes empty, negative, > 10...
  saveDelay();
});
delayInput.addEventListener("keydown", (e) => { if (e.key === "Enter") delayInput.blur(); });

const langButtons = document.querySelectorAll(".seg button");
langButtons.forEach((btn) => {
  btn.addEventListener("click", () => chrome.storage.sync.set({ lang: btn.dataset.lang }));
});

let matchCount = null; // null until storage has answered

function renderStatus() {
  if (matchCount === null) return;
  $("dot").classList.toggle("on", matchCount > 0);
  $("status-text").textContent = matchCount === 0
    ? I.t("matchNone")
    : I.t(matchCount > 1 ? "matchMany" : "matchOne", { n: matchCount });
}

function applyLang() {
  document.documentElement.lang = I.lang;
  document.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = I.t(el.dataset.i18n); });
  document.querySelectorAll("[data-i18n-title]").forEach((el) => { el.title = I.t(el.dataset.i18nTitle); });
  document.querySelectorAll("[data-i18n-aria]").forEach((el) => { el.setAttribute("aria-label", I.t(el.dataset.i18nAria)); });
  langButtons.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.lang === I.lang)));
  $("version").textContent = `v${chrome.runtime.getManifest().version}`;
  renderStatus();
}

I.ready.then(applyLang);
I.onChange(applyLang);

chrome.storage.local.get({ karasuMatches: {} }, ({ karasuMatches }) => {
  matchCount = Object.keys(karasuMatches).length;
  renderStatus();
});

// If the author photo fails to load (offline...), just hide the image.
const authorImg = $("author-img");
authorImg.addEventListener("error", () => authorImg.classList.add("broken"));

// Karasu logo: shown once loaded, otherwise the fallback icon stays visible.
const logoImg = $("logo-img");
const logoBox = $("logo");
const showLogo = () => { if (logoImg.naturalWidth > 0) logoBox.classList.add("ok"); };
if (logoImg.complete) showLogo(); else logoImg.addEventListener("load", showLogo);
