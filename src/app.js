// ============================================================
// Riki Fatigue Check — app.js v0.3.0
//
// Major changes in this version:
//   A. Personal baseline scoring (rolling 14-day, per-game,
//      activates after 4+ sessions) via localStorage history.
//      Score is now performance-relative-to-YOU, not a fixed
//      universal scale.
//   B. Context penalties REMOVED from scoring. Sleep / shift /
//      symptoms / caffeine / self-rated fatigue are collected,
//      submitted to Google Forms, and DISPLAYED as context on
//      the results screen — but the score itself is driven by
//      objective test performance only.
//   C. Circadian multiplier removed (it unfairly penalised
//      night-shift staff on every session).
//   D. PVT fixed: lapse threshold back to literature-standard
//      500 ms, inter-stimulus interval shortened to 1–4 s
//      (PVT-B style → ~15-20 trials per minute instead of ~7),
//      and a 3 s stimulus timeout so a full zone-out can't
//      stall the test.
//   E. 2-Back fixed: YES-only response design (no phantom NO
//      button), missed-target bug at trial index 2 fixed,
//      arbitrary score floor of 20 removed, scoring now uses
//      hit rate minus false-alarm rate, 30 trials (~60 s).
//   F. Stroop interference now measured the classic way: the
//      REACTION-TIME gap between congruent and incongruent
//      trials (accuracy is near ceiling for everyone, RT gap
//      is the sensitive fatigue signal).
//   G. 14-day trend graph (dependency-free inline SVG) on the
//      results screen and via a "View my trend" button.
//   H. Demo mode: add ?demo=1 to the URL to seed 12 realistic
//      sessions of history for the entered alias (if it has
//      fewer than 4 real sessions) and skip the cooldown —
//      so judges can see baseline comparison + the trend graph
//      working live from a single session.
//
// Google Forms submission is unchanged — it remains the
// research/archive pipeline. localStorage is the read layer
// that powers baselines and the graph (device-bound: history
// lives on the device it was recorded on).
// ============================================================

// ===============================
// FORM 1: CHECK-IN (unchanged)
// ===============================
const FORM_CHECKIN_URL =
  "https://docs.google.com/forms/d/e/1FAIpQLSfSO6_C_mIWA1G1OHuCwPIaOn_srffgsm6XmM8Y2SKKwhGyBA/formResponse";

const CHECKIN_ENTRY = {
  timestamp_utc: "entry.1572758946",
  session_id: "entry.1944994785",
  alias_hash: "entry.1791040349",
  app_version: "entry.1171626104",
  device_info: "entry.556106516",
  session_number_today: "entry.187344393",
  is_first_session_today: "entry.1633018053",
  sleep_hours: "entry.1121567346",
  shift_length_hours: "entry.978814771",
  hours_into_shift: "entry.1639077315",
  caffeine_level: "entry.563674604",
  fatigue_scale: "entry.1736915856",
  motivation_scale: "entry.884871826",
  symptoms: "entry.1133216744",
  age: "entry.1773262357"
};

// ===============================
// FORM 2: GAME RESULTS (unchanged)
// ===============================
const FORM_RESULTS_URL =
  "https://docs.google.com/forms/d/e/1FAIpQLSeL7efoV0n5cBJeJlM_sMfOufITpQcFirPkzAwC7-7uSmmoyA/formResponse";

const RESULTS_ENTRY = {
  timestamp_utc: "entry.474040265",
  session_id: "entry.678239311",
  alias_hash: "entry.567749104",
  app_version: "entry.81590406",
  sdmt_correct: "entry.740812054",
  sdmt_incorrect: "entry.136926342",
  sdmt_score_0_100: "entry.1439510000",
  nback_hits: "entry.557094512",
  nback_misses: "entry.1417958972",
  nback_false_alarms: "entry.1104830090",
  nback_score_0_100: "entry.2143341535",
  stroop_correct: "entry.1349594133",
  stroop_incorrect: "entry.351916292",
  stroop_median_rt_ms: "entry.430287127",
  stroop_score_0_100: "entry.1928939925",
  pvt_median_rt_ms: "entry.788283783",
  pvt_lapses: "entry.1056650105",
  pvt_false_starts: "entry.1994575411",
  pvt_score_0_100: "entry.461582704",
  overall_score_0_100: "entry.1796082506",
  overall_band: "entry.134879237",
  advice_text: "entry.447359756"
};

let CONFIG = null;

async function loadConfig() {
  const res = await fetch("config.json", { cache: "no-store" });
  CONFIG = await res.json();
}

// ===============================
// Generic helpers
// ===============================
function show(id) { const el = document.getElementById(id); if (el) el.classList.remove("hidden"); }
function hide(id) { const el = document.getElementById(id); if (el) el.classList.add("hidden"); }

function normalizeAlias(raw) { return (raw || "").trim().toUpperCase(); }

function isValidAliasFormat(alias) {
  if (!alias || alias.length !== 4) return false;
  const chars = alias.split("");
  const letters = chars.filter((c) => /[A-Z]/.test(c)).length;
  const digits = chars.filter((c) => /[0-9]/.test(c)).length;
  return letters === 2 && digits === 2;
}

function isAllowedAlias(alias) {
  const list = CONFIG?.ALLOWED_ALIASES || [];
  return list.includes(alias);
}

async function sha256Hex(str) {
  const enc = new TextEncoder().encode(str);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function nowMs() { return Date.now(); }

function formatCountdown(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const hh = String(Math.floor(s / 3600)).padStart(2, "0");
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

function deviceInfo() { return navigator.userAgent; }
function uuidv4() { return crypto.randomUUID(); }
function selectedSymptoms() {
  return Array.from(document.querySelectorAll(".symptom:checked")).map((x) => x.value);
}

function clamp01(x) { return Math.max(0, Math.min(1, x)); }
function clamp0to100(x) { return Math.max(0, Math.min(100, x)); }

function median(arr) {
  if (!arr || arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

// Median Absolute Deviation — robust spread estimate.
// One bad/outlier session won't wreck the baseline the way
// a mean/SD would with only ~10 data points.
function mad(arr, center) {
  if (!arr || arr.length === 0) return 0;
  const deviations = arr.map((v) => Math.abs(v - center));
  return median(deviations);
}

function getTodayKeyUTC() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

function getSessionCountToday(aliasHash) {
  return Number(localStorage.getItem(`sessions_${aliasHash}_${getTodayKeyUTC()}`) || "0");
}

function incrementSessionCountToday(aliasHash) {
  const key = `sessions_${aliasHash}_${getTodayKeyUTC()}`;
  const n = getSessionCountToday(aliasHash) + 1;
  localStorage.setItem(key, String(n));
  return n;
}

function getCooldownUntilMs(aliasHash) {
  const v = localStorage.getItem(`cooldown_until_${aliasHash}`);
  return v ? Number(v) : 0;
}

function setCooldownUntilMs(aliasHash, untilMs) {
  localStorage.setItem(`cooldown_until_${aliasHash}`, String(untilMs));
}

function cacheAgeIfProvided(aliasHash, ageVal) {
  if (!ageVal) return;
  localStorage.setItem(`age_${aliasHash}`, String(ageVal));
}

function getCachedAge(aliasHash) {
  const v = localStorage.getItem(`age_${aliasHash}`);
  return v ? Number(v) : null;
}

function submitHiddenForm(url, fields) {
  let iframe = document.getElementById("gf_hidden_iframe");
  if (!iframe) {
    iframe = document.createElement("iframe");
    iframe.id = "gf_hidden_iframe";
    iframe.name = "gf_hidden_iframe";
    iframe.style.display = "none";
    document.body.appendChild(iframe);
  }
  const form = document.createElement("form");
  form.action = url;
  form.method = "POST";
  form.target = "gf_hidden_iframe";
  form.style.display = "none";
  for (const [name, value] of Object.entries(fields)) {
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = name;
    input.value = value ?? "";
    form.appendChild(input);
  }
  document.body.appendChild(form);
  form.submit();
  form.remove();
}

// ============================================================
// CHANGE A: Session history store (the read layer)
// ============================================================
const HISTORY_WINDOW_DAYS = 14;
const BASELINE_MIN_SESSIONS = 4;   // per game, before baseline scoring activates
const DAY_MS = 86400000;

function historyKey(aliasHash) { return `history_${aliasHash}`; }

// Returns sessions from the last 14 days, oldest first.
function getHistory(aliasHash) {
  let raw;
  try { raw = JSON.parse(localStorage.getItem(historyKey(aliasHash)) || "[]"); }
  catch { raw = []; }
  const cutoff = nowMs() - HISTORY_WINDOW_DAYS * DAY_MS;
  return raw
    .filter((h) => h && typeof h.ts === "number" && h.ts >= cutoff)
    .sort((a, b) => a.ts - b.ts);
}

function saveSessionToHistory(aliasHash, entry) {
  const hist = getHistory(aliasHash); // already trimmed to window
  hist.push(entry);
  localStorage.setItem(historyKey(aliasHash), JSON.stringify(hist));
}

// Per-game baseline stats from the user's own history.
// Returns null until this game has BASELINE_MIN_SESSIONS data points.
function baselineStatsFor(history, gameKey) {
  const values = history
    .map((h) => h[gameKey])
    .filter((v) => typeof v === "number" && !isNaN(v));
  if (values.length < BASELINE_MIN_SESSIONS) return null;
  const center = median(values);
  // Floor the spread at 5 points so a very consistent user's tiny
  // variance doesn't turn a 3-point dip into an extreme z-score.
  const sd = Math.max(mad(values, center) * 1.4826, 5);
  return { center, sd, n: values.length };
}

// ============================================================
// CHANGE H: Demo mode (?demo=1)
// Seeds realistic history so judges can see baseline scoring
// and the trend graph from a single live session.
// ============================================================
function isDemoMode() {
  return new URLSearchParams(window.location.search).get("demo") === "1";
}

function seedDemoHistory(aliasHash) {
  const existing = getHistory(aliasHash);
  if (existing.length >= BASELINE_MIN_SESSIONS) return false;

  const base = { pvt: 74, sdmt: 66, stroop: 72, nback: 62 };
  const jitter = () => Math.round(Math.random() * 10 - 5);
  const entries = [];
  const now = nowMs();

  for (let daysAgo = 13; daysAgo >= 1; daysAgo--) {
    if (daysAgo === 8 || daysAgo === 3) continue; // realistic missed days
    // A mild mid-window dip so the graph tells a story.
    const dip = daysAgo >= 4 && daysAgo <= 6 ? -10 : 0;
    const s = {
      pvt:    clamp0to100(base.pvt + dip + jitter()),
      sdmt:   clamp0to100(base.sdmt + dip + jitter()),
      stroop: clamp0to100(base.stroop + dip + jitter()),
      nback:  clamp0to100(base.nback + dip + jitter())
    };
    const overall = Math.round(s.pvt * 0.4 + s.sdmt * 0.2 + s.stroop * 0.2 + s.nback * 0.2);
    entries.push({
      ts: now - daysAgo * DAY_MS - Math.floor(Math.random() * 5) * 3600000,
      ...s,
      overall,
      band: scoreToBandAbsolute(overall)
    });
  }
  localStorage.setItem(historyKey(aliasHash), JSON.stringify(entries));
  return true;
}

// ===============================
// Session state
// ===============================
let SESSION = {
  alias: "",
  aliasHash: "",
  sessionId: "",
  sessionNumberToday: 0,
  isFirstToday: false,
  symptoms: [],
  checkin: {}
};

let GAME_RESULTS = { sdmt: null, nback: null, stroop: null, pvt: null };

const FLOW = [
  { key: "sdmt",   title: "SDMT",   text: "A key at the top shows 9 symbols, each paired with a number. A symbol appears in the centre — press the matching number as fast as you can. You have 4 seconds per symbol before it counts as incorrect." },
  // CHANGE E: instructions now match the YES-only design.
  { key: "nback",  title: "2-Back", text: "Letters appear one at a time. Press YES only when the letter matches the one shown 2 steps ago. If it doesn't match, don't press anything. Stay focused — it gets tricky!" },
  { key: "stroop", title: "Stroop", text: "A colour word will appear on screen printed in a different ink colour. Tap the button matching the INK COLOUR — ignore what the word says. Respond as quickly and accurately as you can. You have 60 seconds." },
  // CHANGE D: delay text updated to 1–4 s.
  { key: "pvt",    title: "PVT",    text: "A red dot will appear on screen after a short random delay (1-4 seconds). Tap it as fast as you can. Do NOT tap before it appears — that counts as a false start. You have 60 seconds." }
];

let flowIndex = 0;

// ===============================
// SDMT Game — logic unchanged (v0.2.2 curve retained)
// ===============================
function runSDMT({ durationSec = 60, trialTimeoutSec = 4, onDone }) {
  const SYMBOLS = ["▭", "◯", "∧", "⊕", "≡", "⇔", "◄", "∴", "Ψ"];
  const digits = [1, 2, 3, 4, 5, 6, 7, 8, 9];
  for (let i = digits.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [digits[i], digits[j]] = [digits[j], digits[i]];
  }
  const mapSymbolToDigit = new Map();
  SYMBOLS.forEach((sym, idx) => mapSymbolToDigit.set(sym, digits[idx]));

  let correct = 0, incorrect = 0, trials = 0;
  let currentSymbol = SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)];

  hide("explainSection");
  show("gameSection");

  const gameTitle = document.getElementById("gameTitle");
  const gameUI    = document.getElementById("gameUI");
  const timerEl   = document.getElementById("gameTimer");
  gameTitle.textContent = "Symbol Digit Modality Test (SDMT)";

  const keyTableCells    = SYMBOLS.map((s) => `<td style="text-align:center;padding:4px 10px;font-size:26px;line-height:1;">${s}</td>`).join("");
  const digitTableCells  = SYMBOLS.map((s) => `<td style="text-align:center;padding:4px 10px;font-size:20px;font-weight:700;">${mapSymbolToDigit.get(s)}</td>`).join("");

  gameUI.innerHTML = `
    <div style="overflow-x:auto;text-align:center;">
      <table style="margin:0 auto;border-collapse:collapse;border:1px solid #ccc;border-radius:8px;overflow:hidden;">
        <tbody>
          <tr style="background:#f5f5f5;">${keyTableCells}</tr>
          <tr>${digitTableCells}</tr>
        </tbody>
      </table>
    </div>
    <div style="display:flex;justify-content:center;align-items:center;height:160px;margin-top:16px;">
      <div id="sdmtTarget" style="font-size:92px;font-weight:700;">${currentSymbol}</div>
    </div>
    <div style="text-align:center;margin-top:4px;">
      <span id="sdmtTrialTimer" style="font-size:18px;color:#e44;font-weight:700;"></span>
    </div>
    <div id="sdmtFeedback" style="text-align:center;min-height:22px;font-size:15px;margin-top:6px;"></div>
    <div style="display:flex;justify-content:center;gap:10px;flex-wrap:wrap;margin-top:14px;">
      ${[1,2,3,4,5,6,7,8,9].map((n) => `<button class="sdmtBtn" data-n="${n}" style="width:64px;height:46px;font-size:18px;">${n}</button>`).join("")}
    </div>
    <div class="hint" style="text-align:center;margin-top:14px;">
      Correct: <b id="sdmtCorrect">0</b> &nbsp;|&nbsp; Incorrect: <b id="sdmtIncorrect">0</b>
    </div>`;

  const targetEl    = document.getElementById("sdmtTarget");
  const feedbackEl  = document.getElementById("sdmtFeedback");
  const correctEl   = document.getElementById("sdmtCorrect");
  const incorrectEl = document.getElementById("sdmtIncorrect");
  const trialTimerEl = document.getElementById("sdmtTrialTimer");

  const startMs = Date.now();
  let ended = false, trialStartMs = Date.now(), trialTimeoutHandle = null;

  function updateTimer() {
    const remaining = Math.max(0, Math.ceil(durationSec - (Date.now() - startMs) / 1000));
    timerEl.textContent = remaining + "s";
    if (remaining <= 0 && !ended) finish();
  }
  const timerInt = setInterval(updateTimer, 200);
  updateTimer();

  function updateTrialTimer() {
    if (ended) return;
    trialTimerEl.textContent = Math.max(0, trialTimeoutSec - (Date.now() - trialStartMs) / 1000).toFixed(1) + "s";
  }
  const trialTimerInt = setInterval(updateTrialTimer, 100);

  function startTrialTimeout() {
    clearTimeout(trialTimeoutHandle);
    trialStartMs = Date.now();
    trialTimeoutHandle = setTimeout(() => {
      if (ended) return;
      incorrect++;
      feedbackEl.textContent = `⏱ Too slow! (was ${mapSymbolToDigit.get(currentSymbol)})`;
      feedbackEl.style.color = "#c00";
      incorrectEl.textContent = String(incorrect);
      nextTrial();
    }, trialTimeoutSec * 1000);
  }

  function nextTrial() {
    trials++;
    currentSymbol = SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)];
    targetEl.textContent = currentSymbol;
    startTrialTimeout();
    setTimeout(() => { if (!ended) feedbackEl.style.color = ""; }, 600);
  }
  startTrialTimeout();

  function handleAnswer(n) {
    if (ended) return;
    clearTimeout(trialTimeoutHandle);
    const correctDigit = mapSymbolToDigit.get(currentSymbol);
    if (n === correctDigit) { correct++; feedbackEl.textContent = "✓ Correct"; feedbackEl.style.color = "#080"; }
    else { incorrect++; feedbackEl.textContent = `✗ Incorrect (was ${correctDigit})`; feedbackEl.style.color = "#c00"; }
    correctEl.textContent = String(correct);
    incorrectEl.textContent = String(incorrect);
    nextTrial();
  }

  Array.from(gameUI.querySelectorAll(".sdmtBtn")).forEach((btn) => {
    btn.addEventListener("click", () => handleAnswer(Number(btn.dataset.n)));
  });

  function keyHandler(e) { if (/^[1-9]$/.test(e.key)) handleAnswer(Number(e.key)); }
  window.addEventListener("keydown", keyHandler);

  function finish() {
    ended = true;
    clearInterval(timerInt); clearInterval(trialTimerInt); clearTimeout(trialTimeoutHandle);
    window.removeEventListener("keydown", keyHandler);
    trialTimerEl.textContent = "";

    const attempts = correct + incorrect;
    let score = null;
    if (attempts >= 10) {
      const effective = correct - 0.25 * incorrect;
      let mappedScore = 0;
      if      (effective <= 10) { mappedScore = 0; }
      else if (effective <= 25) { mappedScore = 10 + ((effective - 10) / 15) * 50; }
      else if (effective <= 40) { mappedScore = 60 + ((effective - 25) / 15) * 25; }
      else                      { mappedScore = 85 + ((effective - 40) / 5) * 15; }
      score = clamp0to100(Math.round(mappedScore));
    }
    onDone?.({ correct, incorrect, trials, score_0_100: score });
  }
}

// ===============================
// 2-Back Game
// CHANGE E: YES-only design made explicit, missed-target bug at
// the first scoreable trial fixed, score floor removed, scoring
// now hit rate minus false-alarm rate, 30 trials (~60 s).
// UI unchanged apart from the hint text.
// ===============================
function runNBack({ rounds = 30, nBack = 2, onDone }) {
  const LETTERS = "BCDFGHJKLMNPQRSTVWXYZ".split("");
  const DISPLAY_MS = 500, ISI_MS = 2000;

  hide("explainSection"); show("gameSection");
  const gameTitle = document.getElementById("gameTitle");
  const gameUI    = document.getElementById("gameUI");
  const timerEl   = document.getElementById("gameTimer");
  timerEl.textContent = "";
  gameTitle.textContent = "2-Back Task";

  gameUI.innerHTML = `
    <div style="text-align:center;margin-top:20px;">
      <p class="hint">Press YES only when the letter matches the one from <b>2 steps ago</b>.</p>
      <div id="nbackStimulus" style="font-size:120px;font-weight:700;height:160px;line-height:160px;letter-spacing:2px;">&nbsp;</div>
      <div id="nbackFeedback" style="min-height:28px;font-size:16px;margin-top:8px;"></div>
      <div style="display:flex;justify-content:center;gap:24px;margin-top:20px;">
        <button id="nbackYes" style="width:110px;height:56px;font-size:20px;background:#1a73e8;color:#fff;border:none;border-radius:10px;cursor:pointer;">YES</button>
      </div>
      <div class="hint" style="margin-top:20px;">
        Trial: <b id="nbackTrialNum">0</b> / ${rounds} &nbsp;|&nbsp;
        Hits: <b id="nbackHits">0</b> &nbsp;|&nbsp;
        Misses: <b id="nbackMisses">0</b> &nbsp;|&nbsp;
        False alarms: <b id="nbackFA">0</b>
      </div>
    </div>`;

  const stimEl = document.getElementById("nbackStimulus");
  const feedbackEl = document.getElementById("nbackFeedback");
  const trialNumEl = document.getElementById("nbackTrialNum");
  const hitsEl = document.getElementById("nbackHits");
  const missesEl = document.getElementById("nbackMisses");
  const faEl = document.getElementById("nbackFA");
  const yesBtn = document.getElementById("nbackYes");

  const sequence = [];
  for (let i = 0; i < rounds; i++) {
    if (i >= nBack && Math.random() < 0.30) { sequence.push(sequence[i - nBack]); }
    else {
      let letter;
      do { letter = LETTERS[Math.floor(Math.random() * LETTERS.length)]; }
      while (i >= nBack && letter === sequence[i - nBack]);
      sequence.push(letter);
    }
  }

  let trialIndex = 0, hits = 0, misses = 0, falseAlarms = 0;
  let responded = false, isTarget = false, displayTimer = null, isiTimer = null, ended = false;

  function setButtons(enabled) {
    yesBtn.disabled = !enabled;
    yesBtn.style.opacity = enabled ? "1" : "0.4";
  }
  function showFeedback(text, color) { feedbackEl.textContent = text; feedbackEl.style.color = color; }

  function recordNoResponse() {
    // CHANGE E (bug fix): was `trialIndex > nBack`, which silently
    // ignored a missed target on the FIRST scoreable trial (index 2).
    if (trialIndex >= nBack && !responded && isTarget) {
      misses++; missesEl.textContent = String(misses); showFeedback("✗ Miss", "#c00");
    }
  }

  function runTrial() {
    if (ended) return;
    if (trialIndex >= rounds) { finish(); return; }
    responded = false;
    const letter = sequence[trialIndex];
    isTarget = trialIndex >= nBack && sequence[trialIndex] === sequence[trialIndex - nBack];
    stimEl.textContent = letter;
    trialNumEl.textContent = String(trialIndex + 1);
    feedbackEl.textContent = "";
    setButtons(trialIndex >= nBack);
    displayTimer = setTimeout(() => { stimEl.textContent = ""; }, DISPLAY_MS);
    isiTimer = setTimeout(() => { recordNoResponse(); trialIndex++; runTrial(); }, ISI_MS);
  }

  function handleYes() {
    if (ended || trialIndex < nBack || responded) return;
    responded = true;
    clearTimeout(isiTimer);
    if (isTarget) { hits++;       hitsEl.textContent = String(hits);        showFeedback("✓ Hit!", "#080"); }
    else          { falseAlarms++; faEl.textContent   = String(falseAlarms); showFeedback("✗ False alarm", "#c00"); }
    isiTimer = setTimeout(() => { trialIndex++; runTrial(); }, 600);
  }

  yesBtn.addEventListener("click", handleYes);
  function keyHandler(e) { if (e.key.toLowerCase() === "y") handleYes(); }
  window.addEventListener("keydown", keyHandler);

  function finish() {
    ended = true;
    clearTimeout(displayTimer); clearTimeout(isiTimer);
    window.removeEventListener("keydown", keyHandler);
    setButtons(false);

    const scoreable = Math.max(0, rounds - nBack);
    const targetCount = sequence.filter((_, i) => i >= nBack && sequence[i] === sequence[i - nBack]).length;
    const nonTargetCount = Math.max(0, scoreable - targetCount);

    // CHANGE E: hit rate minus false-alarm rate (simple d'-style
    // discrimination measure). No-response-to-everything now
    // scores 0, not an arbitrary 20.
    const hitRate = targetCount > 0 ? hits / targetCount : 0;
    const faRate  = nonTargetCount > 0 ? falseAlarms / nonTargetCount : 0;
    let score = clamp0to100(Math.round((hitRate - faRate) * 100));
    if (rounds < 20) score = null;
    onDone?.({ hits, misses, false_alarms: falseAlarms, score_0_100: score });
  }
  runTrial();
}

// ===============================
// Stroop Game
// CHANGE F: interference is now the classic RT-based measure —
// the gap between median incongruent RT and median congruent RT.
// Accuracy sits near ceiling for almost everyone, so the RT gap
// is the sensitive fatigue signal. UI and trial generation unchanged.
// ===============================
function runStroop({ durationSec = 60, onDone }) {
  const COLOURS = [
    { name: "RED",    hex: "#e53935" },
    { name: "BLUE",   hex: "#1e88e5" },
    { name: "GREEN",  hex: "#43a047" },
    { name: "YELLOW", hex: "#f9a825" }
  ];

  hide("explainSection"); show("gameSection");
  const gameTitle = document.getElementById("gameTitle");
  const gameUI    = document.getElementById("gameUI");
  const timerEl   = document.getElementById("gameTimer");
  gameTitle.textContent = "Stroop Colour Task";

  const btnHTML = COLOURS.map((c) =>
    `<button class="stroopBtn" data-colour="${c.name}"
      style="width:120px;height:54px;font-size:18px;font-weight:700;background:${c.hex};color:#fff;border:none;border-radius:10px;cursor:pointer;">
      ${c.name}
    </button>`).join("");

  gameUI.innerHTML = `
    <p class="hint" style="text-align:center;">Tap the button matching the <b>ink colour</b> — ignore the word.</p>
    <div style="display:flex;justify-content:center;align-items:center;height:130px;margin-top:8px;">
      <div id="stroopWord" style="font-size:72px;font-weight:900;letter-spacing:2px;"></div>
    </div>
    <div id="stroopFeedback" style="text-align:center;min-height:24px;font-size:15px;margin-top:4px;"></div>
    <div style="display:flex;justify-content:center;gap:12px;flex-wrap:wrap;margin-top:18px;">${btnHTML}</div>
    <div class="hint" style="text-align:center;margin-top:16px;">
      Correct: <b id="stroopCorrect">0</b> &nbsp;|&nbsp; Incorrect: <b id="stroopIncorrect">0</b>
    </div>`;

  const wordEl      = document.getElementById("stroopWord");
  const feedbackEl  = document.getElementById("stroopFeedback");
  const correctEl   = document.getElementById("stroopCorrect");
  const incorrectEl = document.getElementById("stroopIncorrect");

  let correct = 0, incorrect = 0;
  const reactionTimes = [];
  const congruentRTs = [], incongruentRTs = []; // CHANGE F
  let trialStart = 0, currentInkColour = "", currentIsCongruent = false, ended = false;

  function nextTrial() {
    const wordIdx = Math.floor(Math.random() * COLOURS.length);
    let inkIdx;
    if (Math.random() < 0.6) { do { inkIdx = Math.floor(Math.random() * COLOURS.length); } while (inkIdx === wordIdx); }
    else { inkIdx = wordIdx; }
    currentInkColour   = COLOURS[inkIdx].name;
    currentIsCongruent = (inkIdx === wordIdx);
    wordEl.textContent = COLOURS[wordIdx].name;
    wordEl.style.color = COLOURS[inkIdx].hex;
    trialStart = Date.now();
  }
  nextTrial();

  const startMs = Date.now();
  function updateTimer() {
    const remaining = Math.max(0, Math.ceil(durationSec - (Date.now() - startMs) / 1000));
    timerEl.textContent = remaining + "s";
    if (remaining <= 0 && !ended) finish();
  }
  const timerInt = setInterval(updateTimer, 200);
  updateTimer();

  function handleClick(chosen) {
    if (ended) return;
    const rt = Date.now() - trialStart;
    if (chosen === currentInkColour) {
      correct++; reactionTimes.push(rt);
      // CHANGE F: bank RTs per congruency (correct trials only)
      if (currentIsCongruent) congruentRTs.push(rt); else incongruentRTs.push(rt);
      feedbackEl.textContent = "✓ Correct"; feedbackEl.style.color = "#080";
      correctEl.textContent = String(correct);
    } else {
      incorrect++;
      feedbackEl.textContent = `✗ Wrong — it was ${currentInkColour}`; feedbackEl.style.color = "#c00";
      incorrectEl.textContent = String(incorrect);
    }
    nextTrial();
    setTimeout(() => { if (!ended) feedbackEl.style.color = ""; }, 500);
  }

  Array.from(gameUI.querySelectorAll(".stroopBtn")).forEach((btn) => {
    btn.addEventListener("click", () => handleClick(btn.dataset.colour));
  });

  function finish() {
    ended = true;
    clearInterval(timerInt);
    const total = correct + incorrect;
    const medianRt = median(reactionTimes);
    let score = null;

    if (total >= 10) {
      const accuracy = total > 0 ? correct / total : 0;
      // CHANGE F: RT-based interference. Needs a few trials of
      // each type to be meaningful; otherwise treated as 0.
      let interferenceMs = 0;
      if (congruentRTs.length >= 3 && incongruentRTs.length >= 3) {
        interferenceMs = Math.max(0, median(incongruentRTs) - median(congruentRTs));
      }
      // 0–50 ms gap = normal, no penalty; 450 ms+ gap = maximum.
      const interferenceNorm = clamp01((interferenceMs - 50) / 400);
      const speedScore = clamp01((1200 - medianRt) / 800);
      const rawScore = accuracy * 0.5 + speedScore * 0.3 + (1 - interferenceNorm) * 0.2;
      score = clamp0to100(Math.round(rawScore * 100));
    }
    onDone?.({ correct, incorrect, median_rt_ms: medianRt, score_0_100: score });
  }
}

// ===============================
// PVT Game
// CHANGE D:
//   - Lapse threshold restored to the literature-standard 500 ms
//     (450 ms + touchscreen input latency was flagging normal
//     alert responses as lapses).
//   - Inter-stimulus interval shortened to 1–4 s (PVT-B style),
//     roughly tripling trials per minute — far less noisy median.
//   - 3 s stimulus timeout: a complete zone-out (the exact person
//     this device exists to catch) now counts as a lapse and the
//     test moves on, instead of stalling for the rest of the minute.
// ===============================
function runPVT({ durationSec = 60, minDelaySec = 1, maxDelaySec = 4, onDone }) {
  const LAPSE_THRESHOLD_MS = 500;      // CHANGE D
  const STIMULUS_TIMEOUT_MS = 3000;    // CHANGE D

  hide("explainSection"); show("gameSection");
  const gameTitle = document.getElementById("gameTitle");
  const gameUI    = document.getElementById("gameUI");
  const timerEl   = document.getElementById("gameTimer");
  gameTitle.textContent = "Psychomotor Vigilance Task (PVT)";

  gameUI.innerHTML = `
    <p class="hint" style="text-align:center;">Tap the dot as soon as it appears. Do NOT tap early.</p>
    <div id="pvtArena" style="display:flex;justify-content:center;align-items:center;height:200px;margin-top:16px;cursor:pointer;user-select:none;">
      <div id="pvtDot" style="width:100px;height:100px;border-radius:50%;background:#ccc;opacity:0.25;display:flex;align-items:center;justify-content:center;font-size:18px;font-weight:700;color:#fff;transition:background 0.1s;"></div>
    </div>
    <div id="pvtFeedback" style="text-align:center;min-height:28px;font-size:16px;margin-top:8px;"></div>
    <div class="hint" style="text-align:center;margin-top:12px;">
      Responses: <b id="pvtResponses">0</b> &nbsp;|&nbsp;
      Lapses (&gt;500ms): <b id="pvtLapses">0</b> &nbsp;|&nbsp;
      False starts: <b id="pvtFalseStarts">0</b>
    </div>
    <div class="hint" style="text-align:center;margin-top:4px;">Last RT: <b id="pvtLastRT">—</b></div>`;

  const arena         = document.getElementById("pvtArena");
  const dot           = document.getElementById("pvtDot");
  const feedbackEl    = document.getElementById("pvtFeedback");
  const responsesEl   = document.getElementById("pvtResponses");
  const lapsesEl      = document.getElementById("pvtLapses");
  const falseStartsEl = document.getElementById("pvtFalseStarts");
  const lastRtEl      = document.getElementById("pvtLastRT");

  const reactionTimes = [];
  let lapses = 0, falseStarts = 0, timeouts = 0, stimulusOn = false, stimulusStart = 0;
  let waitHandle = null, ended = false, trials = 0;
  let respondedThisTrial = false, currentTrialLapseCounted = false;
  let lapseTimerHandle = null, stimulusTimeoutHandle = null;

  const startMs = Date.now();
  function updateTimer() {
    const remaining = Math.max(0, Math.ceil(durationSec - (Date.now() - startMs) / 1000));
    timerEl.textContent = remaining + "s";
    if (remaining <= 0 && !ended) finish();
  }
  const timerInt = setInterval(updateTimer, 200);
  updateTimer();

  function showStimulus() {
    if (ended) return;
    trials++; respondedThisTrial = false; currentTrialLapseCounted = false;
    stimulusOn = true; stimulusStart = Date.now();
    dot.style.background = "#e53935"; dot.style.opacity = "1"; dot.textContent = "";
    clearTimeout(waitHandle); clearTimeout(lapseTimerHandle); clearTimeout(stimulusTimeoutHandle);

    lapseTimerHandle = setTimeout(() => {
      if (ended) return;
      if (stimulusOn && !respondedThisTrial && !currentTrialLapseCounted) {
        lapses++; currentTrialLapseCounted = true; lapsesEl.textContent = String(lapses);
      }
    }, LAPSE_THRESHOLD_MS);

    // CHANGE D: full non-response — count it, move on.
    stimulusTimeoutHandle = setTimeout(() => {
      if (ended || !stimulusOn || respondedThisTrial) return;
      timeouts++;
      if (!currentTrialLapseCounted) { lapses++; currentTrialLapseCounted = true; lapsesEl.textContent = String(lapses); }
      feedbackEl.textContent = "✗ No response"; feedbackEl.style.color = "#c00";
      hideStimulus(); scheduleNext();
      setTimeout(() => { if (!ended) feedbackEl.style.color = ""; }, 700);
    }, STIMULUS_TIMEOUT_MS);
  }

  function hideStimulus() {
    stimulusOn = false;
    dot.style.background = "#ccc"; dot.style.opacity = "0.25"; dot.textContent = "";
    clearTimeout(waitHandle); clearTimeout(lapseTimerHandle); clearTimeout(stimulusTimeoutHandle);
  }

  function scheduleNext() {
    if (ended) return;
    const delay = (minDelaySec + Math.random() * (maxDelaySec - minDelaySec)) * 1000;
    waitHandle = setTimeout(showStimulus, delay);
  }

  arena.addEventListener("click", () => {
    if (ended) return;
    if (!stimulusOn) {
      falseStarts++; falseStartsEl.textContent = String(falseStarts);
      feedbackEl.textContent = "✗ Too early! (false start)"; feedbackEl.style.color = "#e65100";
      return;
    }
    respondedThisTrial = true;
    clearTimeout(lapseTimerHandle); clearTimeout(stimulusTimeoutHandle);
    const rt = Date.now() - stimulusStart;
    reactionTimes.push(rt);
    responsesEl.textContent = String(reactionTimes.length);
    lastRtEl.textContent = rt + " ms";
    if (rt >= LAPSE_THRESHOLD_MS) {
      if (!currentTrialLapseCounted) { lapses++; currentTrialLapseCounted = true; lapsesEl.textContent = String(lapses); }
      feedbackEl.textContent = `⚠ Slow: ${rt} ms (lapse)`; feedbackEl.style.color = "#c00";
    } else {
      feedbackEl.textContent = `✓ ${rt} ms`; feedbackEl.style.color = rt < 250 ? "#080" : "#555";
    }
    hideStimulus(); scheduleNext();
    setTimeout(() => { if (!ended) feedbackEl.style.color = ""; }, 700);
  });

  scheduleNext();

  function finish() {
    ended = true;
    clearInterval(timerInt); clearTimeout(waitHandle);
    clearTimeout(lapseTimerHandle); clearTimeout(stimulusTimeoutHandle);
    hideStimulus();
    const medianRt   = median(reactionTimes);
    const lapseRate  = trials > 0 ? lapses / trials : 0;
    const fsRate     = trials > 0 ? falseStarts / trials : 0;
    const speedScore   = clamp01((700 - medianRt) / (700 - 300));
    const lapsePenalty = clamp01(lapseRate * 1.2);
    const fsPenalty    = clamp01(fsRate * 0.4);
    const rawScore     = speedScore * (1 - clamp01(lapsePenalty + fsPenalty));
    let score = clamp0to100(Math.round(rawScore * 100));
    // Need a sensible number of trials AND actual responses for a valid median.
    if (trials < 8 || reactionTimes.length < 5) score = null;
    onDone?.({ median_rt_ms: medianRt, lapses, false_starts: falseStarts, timeouts, score_0_100: score });
  }
}

// ============================================================
// CHANGES A, B, C: Scoring
//
// The score is now driven purely by objective test performance.
// Once a game has 4+ sessions of history, today's raw game score
// is converted to a PERSONAL score:
//
//     z = (today − your 14-day median) / your robust SD
//     personal = 75 + z × 12        (75 = "your normal")
//
// The composite is the weighted average of personal scores
// (falling back to the raw score for games without a baseline
// yet). Banding is deviation-based in baseline mode:
//
//     ≥ 69  Green      (within ~0.5 SD of your normal)
//     ≥ 57  Amber      (0.5–1.5 SD below)
//     ≥ 45  Amber-Red  (1.5–2.5 SD below)
//     < 45  Red        (> 2.5 SD below)
//
// Sleep / shift / symptoms are no longer subtracted — they are
// shown as context alongside the score. The circadian multiplier
// is gone: a 3 am session is now compared against your own
// history, not handicapped by a blanket night-time haircut.
// ============================================================
const GAME_WEIGHTS = { pvt: 0.40, sdmt: 0.20, stroop: 0.20, nback: 0.20 };

function scoreToBandAbsolute(score) {
  if (score >= 75) return "Green";
  if (score >= 60) return "Amber";
  if (score >= 40) return "Amber-Red";
  return "Red";
}

function scoreToBandBaseline(score) {
  if (score >= 69) return "Green";
  if (score >= 57) return "Amber";
  if (score >= 45) return "Amber-Red";
  return "Red";
}

function computeSessionScore(results, history) {
  const perGame = {};
  let total = 0, wSum = 0, baselineGamesUsed = 0;

  for (const [key, w] of Object.entries(GAME_WEIGHTS)) {
    const r = results[key];
    if (!r || typeof r.score_0_100 !== "number") continue;
    const abs = r.score_0_100;
    const stats = baselineStatsFor(history, key);
    let effective = abs, z = null, personal = null;
    if (stats) {
      z = (abs - stats.center) / stats.sd;
      personal = clamp0to100(Math.round(75 + z * 12));
      effective = personal;
      baselineGamesUsed++;
    }
    perGame[key] = { abs, personal, z, baseline: stats ? stats.center : null };
    total += effective * w;
    wSum += w;
  }

  const composite = wSum > 0 ? Math.round(total / wSum) : 0;
  const mode = baselineGamesUsed >= 3 ? "baseline" : "absolute";
  const band = mode === "baseline" ? scoreToBandBaseline(composite) : scoreToBandAbsolute(composite);

  // Delta vs the user's recent overall average (for the headline
  // "N points below your 2-week average" line).
  const priorOveralls = history
    .map((h) => h.overall)
    .filter((v) => typeof v === "number" && !isNaN(v));
  let delta = null;
  if (priorOveralls.length >= BASELINE_MIN_SESSIONS) {
    const avg = Math.round(priorOveralls.reduce((a, b) => a + b, 0) / priorOveralls.length);
    delta = composite - avg;
  }

  return { composite, band, mode, baselineGamesUsed, perGame, delta, priorSessions: history.length };
}

// CHANGE B: advice softened to wellness-companion register —
// the device helps you notice changes, it doesn't issue orders.
function adviceFor(band, mode) {
  if (mode === "baseline") {
    if (band === "Green")     return "You're performing at or around your usual level. No unusual signs of fatigue in today's results — recheck after your next break if you'd like to keep tracking.";
    if (band === "Amber")     return "Your performance is a little below your recent average. You may benefit from a short break and some water before tasks needing sustained focus. Consider rechecking in a couple of hours.";
    if (band === "Amber-Red") return "Your performance is noticeably below your recent average. Consider taking a proper rest break before demanding tasks, and keep an eye on how you're feeling.";
    return "Your performance is well below your recent average. Rest is recommended when you're able, and you may wish to recheck after a break before taking on demanding tasks.";
  }
  if (band === "Green")     return "Cognitive performance looks good today. Recheck after your next rest break to keep building your personal baseline.";
  if (band === "Amber")     return "Mild signs of reduced performance. A short break and some water may help — consider rechecking in a couple of hours.";
  if (band === "Amber-Red") return "Moderate signs of reduced performance. Consider a proper rest before tasks that need sustained focus.";
  return "Significant signs of reduced performance. Rest is recommended when you're able, and consider rechecking after a break.";
}

function bandColour(band) {
  const map = { "Green": "#2e7d32", "Amber": "#f9a825", "Amber-Red": "#e65100", "Red": "#c62828" };
  return map[band] || "#555";
}

// ============================================================
// CHANGE G: 14-day trend graph (dependency-free inline SVG —
// no charting library, so it works offline / on venue wifi)
// ============================================================
function fmtDate(ts) {
  return new Date(ts).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function renderTrendSVG(history) {
  const entries = [...history].sort((a, b) => a.ts - b.ts);
  if (entries.length < 2) {
    return `<p class="hint" style="text-align:center;padding:16px 0;">Complete at least 2 sessions on this device to see your trend over time.</p>`;
  }

  const W = 640, H = 260, padL = 36, padR = 14, padT = 16, padB = 32;
  const minTs = entries[0].ts, maxTs = entries[entries.length - 1].ts;
  const span = Math.max(maxTs - minTs, 1);
  const x = (ts) => padL + ((ts - minTs) / span) * (W - padL - padR);
  const y = (s) => padT + (1 - s / 100) * (H - padT - padB);

  const gridLines = [0, 25, 50, 75, 100].map((v) => `
    <line x1="${padL}" y1="${y(v)}" x2="${W - padR}" y2="${y(v)}" stroke="#eee" stroke-width="1"/>
    <text x="${padL - 8}" y="${y(v) + 4}" text-anchor="end" font-size="11" fill="#999">${v}</text>`).join("");

  const linePath = entries
    .map((e, i) => `${i === 0 ? "M" : "L"} ${x(e.ts).toFixed(1)} ${y(e.overall).toFixed(1)}`)
    .join(" ");

  const overalls = entries.map((e) => e.overall);
  const avg = median(overalls);
  const avgLine = entries.length >= BASELINE_MIN_SESSIONS ? `
    <line x1="${padL}" y1="${y(avg)}" x2="${W - padR}" y2="${y(avg)}" stroke="#888" stroke-width="1.5" stroke-dasharray="6 5"/>
    <text x="${W - padR}" y="${y(avg) - 6}" text-anchor="end" font-size="11" fill="#666">14-day average (${avg})</text>` : "";

  const dots = entries.map((e) => `
    <circle cx="${x(e.ts).toFixed(1)}" cy="${y(e.overall).toFixed(1)}" r="5"
      fill="${bandColour(e.band)}" stroke="#fff" stroke-width="1.5">
      <title>${fmtDate(e.ts)} — ${e.overall} (${e.band})</title>
    </circle>`).join("");

  const midTs = entries[Math.floor(entries.length / 2)].ts;
  const dateLabels = `
    <text x="${x(minTs)}" y="${H - 10}" text-anchor="start" font-size="11" fill="#999">${fmtDate(minTs)}</text>
    ${entries.length > 3 ? `<text x="${x(midTs)}" y="${H - 10}" text-anchor="middle" font-size="11" fill="#999">${fmtDate(midTs)}</text>` : ""}
    <text x="${x(maxTs)}" y="${H - 10}" text-anchor="end" font-size="11" fill="#999">${fmtDate(maxTs)}</text>`;

  return `
    <svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block;" role="img" aria-label="Overall score over the last 14 days">
      ${gridLines}
      ${avgLine}
      <path d="${linePath}" fill="none" stroke="#1a73e8" stroke-width="2" stroke-linejoin="round"/>
      ${dots}
      ${dateLabels}
    </svg>
    <p class="hint" style="text-align:center;margin-top:6px;">
      Dot colour shows the band for each session${entries.length >= BASELINE_MIN_SESSIONS ? " · dashed line is your 14-day average" : ""}.
    </p>`;
}

function renderTrendSummary(history) {
  if (!history.length) return "";
  const overalls = history.map((h) => h.overall).filter((v) => typeof v === "number");
  if (!overalls.length) return "";
  const avg = Math.round(overalls.reduce((a, b) => a + b, 0) / overalls.length);
  const best = Math.max(...overalls);
  return `<p class="hint" style="text-align:center;margin-top:4px;">
    ${history.length} session${history.length === 1 ? "" : "s"} in the last 14 days · average ${avg} · best ${best}
  </p>`;
}

let lastSectionBeforeTrend = "aliasSection";

function openTrendView(fromSectionId) {
  if (!SESSION.aliasHash) return;
  lastSectionBeforeTrend = fromSectionId;
  const history = getHistory(SESSION.aliasHash);
  document.getElementById("trendContent").innerHTML =
    renderTrendSVG(history) + renderTrendSummary(history);
  hide(fromSectionId);
  show("trendSection");
}

// ===============================
// UI helpers
// ===============================
function showExplanation(i) {
  hide("startSection"); hide("gameSection"); hide("resultsSection"); show("explainSection");
  const step = FLOW[i];
  document.getElementById("explainTitle").textContent = `${step.title} – Instructions`;
  document.getElementById("explainText").textContent  = step.text;
}

// Small helper for per-game cards: show absolute score plus
// "vs your baseline" line once a baseline exists for that game.
function baselineLineFor(perGame, key) {
  const g = perGame?.[key];
  if (!g || g.personal === null) return "";
  const diff = g.abs - g.baseline;
  const sign = diff >= 0 ? "+" : "";
  return `<li>Vs your baseline: <b>${sign}${diff}</b> (usual ~${g.baseline})</li>`;
}

function contextPanelHTML(checkin, symptoms) {
  const bits = [];
  if (typeof checkin?.sleep_hours === "number") {
    bits.push(`${checkin.sleep_hours}h sleep${checkin.broken_sleep === "yes" ? " (broken)" : ""}`);
  }
  if (typeof checkin?.hours_into_shift === "number" && typeof checkin?.shift_length_hours === "number") {
    bits.push(`${checkin.hours_into_shift}h into a ${checkin.shift_length_hours}h shift`);
  } else if (typeof checkin?.hours_into_shift === "number") {
    bits.push(`${checkin.hours_into_shift}h into your shift`);
  }
  if (checkin?.caffeine_level) bits.push(`caffeine: ${checkin.caffeine_level}`);
  if (typeof checkin?.fatigue_scale === "number") bits.push(`self-rated fatigue ${checkin.fatigue_scale}/10`);
  const symptomText = (symptoms || []).length
    ? `Symptoms reported: ${symptoms.join(", ").replace(/_/g, " ")}.`
    : "";
  if (!bits.length && !symptomText) return "";
  return `
    <div style="background:#f5f7fa;border:1px solid #e0e5ec;border-radius:8px;padding:12px 16px;margin-top:16px;font-size:14px;line-height:1.5;color:#444;">
      <b>Context you reported:</b> ${bits.join(" · ")}.
      ${symptomText}
      <span style="display:block;margin-top:4px;color:#777;">Your score is based on test performance only — this context is shown alongside it, not subtracted from it.</span>
    </div>`;
}

function showResultsScreen() {
  hide("gameSection"); hide("explainSection"); hide("startSection"); show("resultsSection");

  const sdmt = GAME_RESULTS.sdmt, nback = GAME_RESULTS.nback, stroop = GAME_RESULTS.stroop, pvt = GAME_RESULTS.pvt;

  // CHANGE A: score against the user's own prior 14 days.
  const priorHistory = getHistory(SESSION.aliasHash);
  const scoring = computeSessionScore(GAME_RESULTS, priorHistory);
  const { composite: overallScore, band, mode, perGame, delta } = scoring;
  const advice  = adviceFor(band, mode);
  const bColour = bandColour(band);

  // Persist this session so future sessions can baseline against it.
  saveSessionToHistory(SESSION.aliasHash, {
    ts: nowMs(),
    sdmt:   sdmt?.score_0_100 ?? null,
    nback:  nback?.score_0_100 ?? null,
    stroop: stroop?.score_0_100 ?? null,
    pvt:    pvt?.score_0_100 ?? null,
    overall: overallScore,
    band
  });

  // Google Forms archive submission — unchanged pipeline.
  submitHiddenForm(FORM_RESULTS_URL, {
    [RESULTS_ENTRY.timestamp_utc]:       new Date().toISOString(),
    [RESULTS_ENTRY.session_id]:          SESSION.sessionId,
    [RESULTS_ENTRY.alias_hash]:          SESSION.aliasHash,
    [RESULTS_ENTRY.app_version]:         CONFIG.APP_VERSION,
    [RESULTS_ENTRY.sdmt_correct]:        String(sdmt   ? sdmt.correct       : ""),
    [RESULTS_ENTRY.sdmt_incorrect]:      String(sdmt   ? sdmt.incorrect     : ""),
    [RESULTS_ENTRY.sdmt_score_0_100]:    String(sdmt?.score_0_100 ?? ""),
    [RESULTS_ENTRY.nback_hits]:          String(nback  ? nback.hits         : ""),
    [RESULTS_ENTRY.nback_misses]:        String(nback  ? nback.misses       : ""),
    [RESULTS_ENTRY.nback_false_alarms]:  String(nback  ? nback.false_alarms : ""),
    [RESULTS_ENTRY.nback_score_0_100]:   String(nback?.score_0_100 ?? ""),
    [RESULTS_ENTRY.stroop_correct]:      String(stroop ? stroop.correct      : ""),
    [RESULTS_ENTRY.stroop_incorrect]:    String(stroop ? stroop.incorrect    : ""),
    [RESULTS_ENTRY.stroop_median_rt_ms]: String(stroop ? stroop.median_rt_ms : ""),
    [RESULTS_ENTRY.stroop_score_0_100]:  String(stroop?.score_0_100 ?? ""),
    [RESULTS_ENTRY.pvt_median_rt_ms]:    String(pvt    ? pvt.median_rt_ms   : ""),
    [RESULTS_ENTRY.pvt_lapses]:          String(pvt    ? pvt.lapses         : ""),
    [RESULTS_ENTRY.pvt_false_starts]:    String(pvt    ? pvt.false_starts   : ""),
    [RESULTS_ENTRY.pvt_score_0_100]:     String(pvt?.score_0_100 ?? ""),
    [RESULTS_ENTRY.overall_score_0_100]: String(overallScore),
    [RESULTS_ENTRY.overall_band]:        band,
    [RESULTS_ENTRY.advice_text]:         advice
  });

  // Calibration notice while baseline is still being established.
  const calibrationHTML = mode === "absolute"
    ? `<div style="background:#fff8e1;border:1px solid #ffe082;border-radius:8px;padding:12px 16px;margin-bottom:16px;font-size:14px;line-height:1.5;color:#6d4c00;">
        <b>Calibration notice:</b> Your first few sessions establish your personal baseline (${scoring.priorSessions} of ${BASELINE_MIN_SESSIONS} completed on this device). Once it's ready, your score will be compared against <i>your own</i> typical performance rather than a fixed scale.
      </div>`
    : "";

  // Headline delta vs personal average (baseline mode only).
  let deltaHTML = "";
  if (mode === "baseline" && delta !== null) {
    const absD = Math.abs(delta);
    const deltaText = delta > 2 ? `${absD} points above your 2-week average`
                    : delta < -2 ? `${absD} points below your 2-week average`
                    : "in line with your 2-week average";
    deltaHTML = `<div style="font-size:15px;color:#555;margin-top:6px;">${deltaText}</div>`;
  }

  const modeLabel = mode === "baseline"
    ? `<p class="hint" style="text-align:center;margin-top:8px;">Scored against your personal baseline (last 14 days on this device).</p>`
    : "";

  const updatedHistory = getHistory(SESSION.aliasHash);

  document.getElementById("resultsSummary").innerHTML = `
    ${calibrationHTML}
    <div style="text-align:center;padding:16px 0 8px;">
      <div style="font-size:64px;font-weight:900;color:${bColour};">${overallScore}</div>
      <div style="font-size:22px;font-weight:700;color:${bColour};margin-top:4px;">${band}</div>
      ${deltaHTML}
      <p style="max-width:480px;margin:12px auto 0;font-size:15px;line-height:1.55;color:#333;">${advice}</p>
    </div>
    ${modeLabel}
    ${contextPanelHTML(SESSION.checkin, SESSION.symptoms)}
    <hr style="margin:20px 0;border:none;border-top:1px solid #e0e0e0;" />
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
      <div style="background:#f9f9f9;border-radius:10px;padding:14px;">
        <p style="margin:0 0 8px;font-weight:700;">SDMT</p>
        <ul style="margin:0;padding-left:18px;font-size:14px;line-height:1.8;">
          <li>Correct: <b>${sdmt ? sdmt.correct : "—"}</b></li>
          <li>Incorrect: <b>${sdmt ? sdmt.incorrect : "—"}</b></li>
          <li>Score: <b>${sdmt ? (sdmt.score_0_100 ?? "—") : "—"} / 100</b></li>
          ${baselineLineFor(perGame, "sdmt")}
        </ul>
      </div>
      <div style="background:#f9f9f9;border-radius:10px;padding:14px;">
        <p style="margin:0 0 8px;font-weight:700;">2-Back</p>
        <ul style="margin:0;padding-left:18px;font-size:14px;line-height:1.8;">
          <li>Hits: <b>${nback ? nback.hits : "—"}</b></li>
          <li>Misses: <b>${nback ? nback.misses : "—"}</b></li>
          <li>False alarms: <b>${nback ? nback.false_alarms : "—"}</b></li>
          <li>Score: <b>${nback ? (nback.score_0_100 ?? "—") : "—"} / 100</b></li>
          ${baselineLineFor(perGame, "nback")}
        </ul>
      </div>
      <div style="background:#f9f9f9;border-radius:10px;padding:14px;">
        <p style="margin:0 0 8px;font-weight:700;">Stroop</p>
        <ul style="margin:0;padding-left:18px;font-size:14px;line-height:1.8;">
          <li>Correct: <b>${stroop ? stroop.correct : "—"}</b></li>
          <li>Incorrect: <b>${stroop ? stroop.incorrect : "—"}</b></li>
          <li>Median RT: <b>${stroop ? stroop.median_rt_ms + " ms" : "—"}</b></li>
          <li>Score: <b>${stroop ? (stroop.score_0_100 ?? "—") : "—"} / 100</b></li>
          ${baselineLineFor(perGame, "stroop")}
        </ul>
      </div>
      <div style="background:#f9f9f9;border-radius:10px;padding:14px;">
        <p style="margin:0 0 8px;font-weight:700;">PVT</p>
        <ul style="margin:0;padding-left:18px;font-size:14px;line-height:1.8;">
          <li>Median RT: <b>${pvt ? pvt.median_rt_ms + " ms" : "—"}</b></li>
          <li>Lapses: <b>${pvt ? pvt.lapses : "—"}</b></li>
          <li>False starts: <b>${pvt ? pvt.false_starts : "—"}</b></li>
          <li>Score: <b>${pvt ? (pvt.score_0_100 ?? "—") : "—"} / 100</b></li>
          ${baselineLineFor(perGame, "pvt")}
        </ul>
      </div>
    </div>
    <hr style="margin:20px 0;border:none;border-top:1px solid #e0e0e0;" />
    <h3 style="margin:0 0 8px;">Your 14-day trend</h3>
    ${renderTrendSVG(updatedHistory)}
    ${renderTrendSummary(updatedHistory)}
    <p class="hint" style="text-align:center;margin-top:16px;">
      Results submitted. &nbsp; Session ID: ${SESSION.sessionId}
    </p>`;
}

// ===============================
// MAIN
// ===============================
async function main() {
  await loadConfig();

  const aliasInput  = document.getElementById("aliasInput");
  const aliasBtn    = document.getElementById("aliasBtn");
  const aliasError  = document.getElementById("aliasError");
  const cooldownText        = document.getElementById("cooldownText");
  const cooldownOverrideBtn = document.getElementById("cooldownOverrideBtn");
  const overrideMsg         = document.getElementById("overrideMsg");
  const submitBtn  = document.getElementById("submitCheckinBtn");
  const submitMsg  = document.getElementById("submitMsg");
  const startBtn     = document.getElementById("startSessionBtn");
  const beginTestBtn = document.getElementById("beginTestBtn");
  const finishBtn    = document.getElementById("finishBtn");
  const viewTrendBtn = document.getElementById("viewTrendBtn");
  const trendBackBtn = document.getElementById("trendBackBtn");

  aliasBtn.addEventListener("click", async () => {
    aliasError.textContent = "";
    const alias = normalizeAlias(aliasInput.value);
    if (!isValidAliasFormat(alias)) { aliasError.textContent = "Invalid format. Must be 4 chars: 2 letters + 2 numbers (any order)."; return; }
    if (!isAllowedAlias(alias))     { aliasError.textContent = "That code is not recognised."; return; }

    const salted = `${CONFIG.HASHING.salt}::${alias}`;
    const aliasHash = await sha256Hex(salted);
    SESSION.alias = alias; SESSION.aliasHash = aliasHash;

    // CHANGE H: demo mode — seed history, skip cooldown.
    if (isDemoMode()) {
      seedDemoHistory(aliasHash);
      hide("aliasSection"); show("checkinSection");
      return;
    }

    const cachedAge = getCachedAge(aliasHash);
    if (cachedAge) document.getElementById("age").value = cachedAge;

    const until = getCooldownUntilMs(aliasHash);
    if (nowMs() < until) {
      hide("aliasSection"); show("cooldownSection");
      const tick = () => {
        const left = until - nowMs();
        cooldownText.textContent = `Available in ${formatCountdown(left)}.`;
        if (left <= 0) { clearInterval(int); hide("cooldownSection"); show("checkinSection"); }
      };
      tick();
      const int = setInterval(tick, 500);
      return;
    }
    hide("aliasSection"); show("checkinSection");
  });

  cooldownOverrideBtn.addEventListener("click", () => {
    const pw = prompt("Admin password:");
    if (pw === "ADMIN123") { overrideMsg.textContent = "Override enabled."; hide("cooldownSection"); show("checkinSection"); }
    else { overrideMsg.textContent = "Incorrect password."; }
  });

  submitBtn.addEventListener("click", () => {
    submitMsg.textContent = ""; submitBtn.disabled = true;

    const sleep_hours        = Number(document.getElementById("sleepHours").value || "");
    const shift_length_hours = Number(document.getElementById("shiftLen").value   || "");
    const hours_into_shift   = Number(document.getElementById("hoursInto").value  || "");
    const caffeine_level     = document.getElementById("caffeine").value || "";
    const fatigue_scale      = Number(document.getElementById("fatigue").value    || "");
    const motivation_scale   = Number(document.getElementById("motivation").value || "");
    const age                = Number(document.getElementById("age").value        || "");

    const gender             = document.getElementById("gender").value || "";
    const brokenSleepEl      = document.querySelector('input[name="brokenSleep"]:checked');
    const broken_sleep       = brokenSleepEl ? brokenSleepEl.value : "";

    if (age) cacheAgeIfProvided(SESSION.aliasHash, age);

    SESSION.sessionId          = uuidv4();
    SESSION.sessionNumberToday = incrementSessionCountToday(SESSION.aliasHash);
    SESSION.isFirstToday       = SESSION.sessionNumberToday === 1;

    const payload = {
      timestamp_utc: new Date().toISOString(),
      session_id:    SESSION.sessionId,
      alias_hash:    SESSION.aliasHash,
      app_version:   CONFIG.APP_VERSION,
      device_info:   deviceInfo(),
      session_number_today:   SESSION.sessionNumberToday,
      is_first_session_today: SESSION.isFirstToday,
      checkin: {
        sleep_hours:        Number.isFinite(sleep_hours)        ? sleep_hours        : null,
        broken_sleep:       broken_sleep,
        shift_length_hours: Number.isFinite(shift_length_hours) ? shift_length_hours : null,
        hours_into_shift:   Number.isFinite(hours_into_shift)   ? hours_into_shift   : null,
        caffeine_level,
        fatigue_scale:      Number.isFinite(fatigue_scale)      ? fatigue_scale      : null,
        motivation_scale:   Number.isFinite(motivation_scale)   ? motivation_scale   : null,
        symptoms:           selectedSymptoms(),
        age:                Number.isFinite(age)                ? age                : null,
        gender:             gender
      }
    };

    SESSION.symptoms = payload.checkin.symptoms;
    // CHANGE B: check-in is kept on SESSION for DISPLAY as context —
    // it is no longer fed into the score.
    SESSION.checkin  = payload.checkin;

    submitHiddenForm(FORM_CHECKIN_URL, {
      [CHECKIN_ENTRY.timestamp_utc]:          payload.timestamp_utc,
      [CHECKIN_ENTRY.session_id]:             payload.session_id,
      [CHECKIN_ENTRY.alias_hash]:             payload.alias_hash,
      [CHECKIN_ENTRY.app_version]:            payload.app_version,
      [CHECKIN_ENTRY.device_info]:            payload.device_info,
      [CHECKIN_ENTRY.session_number_today]:   String(payload.session_number_today),
      [CHECKIN_ENTRY.is_first_session_today]: String(payload.is_first_session_today),
      [CHECKIN_ENTRY.sleep_hours]:            String(payload.checkin.sleep_hours ?? ""),
      [CHECKIN_ENTRY.shift_length_hours]:     String(payload.checkin.shift_length_hours ?? ""),
      [CHECKIN_ENTRY.hours_into_shift]:       String(payload.checkin.hours_into_shift ?? ""),
      [CHECKIN_ENTRY.caffeine_level]:         String(payload.checkin.caffeine_level),
      [CHECKIN_ENTRY.fatigue_scale]:          String(payload.checkin.fatigue_scale ?? ""),
      [CHECKIN_ENTRY.motivation_scale]:       String(payload.checkin.motivation_scale ?? ""),
      [CHECKIN_ENTRY.symptoms]:               (payload.checkin.symptoms || []).join("|"),
      [CHECKIN_ENTRY.age]:                    String(payload.checkin.age ?? "")
    });

    if (!isDemoMode()) {
      setCooldownUntilMs(SESSION.aliasHash, nowMs() + CONFIG.COOLDOWN_HOURS * 3600 * 1000);
    }
    GAME_RESULTS = { sdmt: null, nback: null, stroop: null, pvt: null };
    submitMsg.textContent = "Saved. Continuing to tests…";
    submitBtn.disabled = false;
    hide("checkinSection"); show("startSection");
  });

  startBtn.addEventListener("click", () => { flowIndex = 0; showExplanation(flowIndex); });

  // CHANGE G: trend view wiring.
  if (viewTrendBtn) viewTrendBtn.addEventListener("click", () => openTrendView("startSection"));
  if (trendBackBtn) trendBackBtn.addEventListener("click", () => {
    hide("trendSection"); show(lastSectionBeforeTrend);
  });

  beginTestBtn.addEventListener("click", () => {
    const step = FLOW[flowIndex];
    if (step.key === "sdmt") {
      runSDMT({ durationSec: 60, trialTimeoutSec: 4, onDone: (result) => {
        GAME_RESULTS.sdmt = result; flowIndex++;
        flowIndex < FLOW.length ? showExplanation(flowIndex) : showResultsScreen();
      }}); return;
    }
    if (step.key === "nback") {
      runNBack({ rounds: 30, nBack: 2, onDone: (result) => {
        GAME_RESULTS.nback = result; flowIndex++;
        flowIndex < FLOW.length ? showExplanation(flowIndex) : showResultsScreen();
      }}); return;
    }
    if (step.key === "stroop") {
      runStroop({ durationSec: 60, onDone: (result) => {
        GAME_RESULTS.stroop = result; flowIndex++;
        flowIndex < FLOW.length ? showExplanation(flowIndex) : showResultsScreen();
      }}); return;
    }
    if (step.key === "pvt") {
      runPVT({ durationSec: 60, minDelaySec: 1, maxDelaySec: 4, onDone: (result) => {
        GAME_RESULTS.pvt = result; flowIndex++;
        flowIndex < FLOW.length ? showExplanation(flowIndex) : showResultsScreen();
      }}); return;
    }
  });

  finishBtn.addEventListener("click", () => {
    hide("resultsSection"); show("aliasSection");
    document.getElementById("aliasInput").value = "";
  });
}

main();
