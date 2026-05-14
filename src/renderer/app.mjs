import { BLSSAnalyzer, getRatingTier } from "../shared/blssAnalyzer.mjs";
import { GamepadReader } from "./gamepad.mjs";
import { drawLineChart, fitCanvas, trimSeries } from "./charts.mjs";
import { DEFAULT_LANGUAGE, TRANSLATIONS } from "./i18n.mjs";

const STICK_CALIBRATION_STEPS = [
  { key: "up", labelKey: "direction.up" },
  { key: "down", labelKey: "direction.down" },
  { key: "left", labelKey: "direction.left" },
  { key: "right", labelKey: "direction.right" }
];

const B_RELEASE_STOP_MS = 90;
const STICK_CENTER_STOP_MS = 320;
const STICK_CENTER_STOP_RADIUS = 0.16;
const RUN_START_GRACE_MS = 550;

const analyzer = new BLSSAnalyzer();
const gamepadReader = new GamepadReader();

const dom = {
  connectionBadge: document.querySelector("#connectionBadge"),
  gamepadSelect: document.querySelector("#gamepadSelect"),
  axisXSelect: document.querySelector("#axisXSelect"),
  axisYSelect: document.querySelector("#axisYSelect"),
  bButtonSelect: document.querySelector("#bButtonSelect"),
  calibrateStickButton: document.querySelector("#calibrateStickButton"),
  calibrateBButton: document.querySelector("#calibrateBButton"),
  calibrationStatus: document.querySelector("#calibrationStatus"),
  deadzoneInput: document.querySelector("#deadzoneInput"),
  deadzoneValue: document.querySelector("#deadzoneValue"),
  calibrateButton: document.querySelector("#calibrateButton"),
  sessionModeSelect: document.querySelector("#sessionModeSelect"),
  countdownSelect: document.querySelector("#countdownSelect"),
  sessionDurationInput: document.querySelector("#sessionDurationInput"),
  timerOptions: document.querySelector("#timerOptions"),
  sessionCue: document.querySelector("#sessionCue"),
  trainingStatus: document.querySelector("#trainingStatus"),
  startButton: document.querySelector("#startButton"),
  stopButton: document.querySelector("#stopButton"),
  resetButton: document.querySelector("#resetButton"),
  sessionBadge: document.querySelector("#sessionBadge"),
  sessionTime: document.querySelector("#sessionTime"),
  rawXValue: document.querySelector("#rawXValue"),
  rawYValue: document.querySelector("#rawYValue"),
  bValue: document.querySelector("#bValue"),
  ratingLabel: document.querySelector("#ratingLabel"),
  scoreValue: document.querySelector("#scoreValue"),
  axisAngle: document.querySelector("#axisAngle"),
  heatmapPeak: document.querySelector("#heatmapPeak"),
  stickCanvas: document.querySelector("#stickCanvas"),
  heatmapCanvas: document.querySelector("#heatmapCanvas"),
  oscValue: document.querySelector("#oscValue"),
  dirValue: document.querySelector("#dirValue"),
  centerValue: document.querySelector("#centerValue"),
  releaseValue: document.querySelector("#releaseValue"),
  sampleCount: document.querySelector("#sampleCount"),
  finalScore: document.querySelector("#finalScore"),
  finalDuration: document.querySelector("#finalDuration"),
  rhythmVariance: document.querySelector("#rhythmVariance"),
  pauseValue: document.querySelector("#pauseValue"),
  contourValue: document.querySelector("#contourValue"),
  stopReasonValue: document.querySelector("#stopReasonValue"),
  languageSelect: document.querySelector("#languageSelect"),
  tutorialButton: document.querySelector("#tutorialButton"),
  tutorialOverlay: document.querySelector("#tutorialOverlay"),
  closeTutorialButton: document.querySelector("#closeTutorialButton"),
  charts: {
    frequency: document.querySelector("#frequencyChart"),
    stability: document.querySelector("#stabilityChart"),
    center: document.querySelector("#centerChart")
  }
};

const session = {
  active: false,
  countdownActive: false,
  waitingForB: false,
  mode: "timer",
  startedAt: 0,
  endsAt: 0,
  targetDurationMs: 10000,
  countdownStartedAt: 0,
  countdownEndsAt: 0,
  goCueUntil: 0,
  guardGraceUntil: 0,
  bReleaseStartedAt: 0,
  centerStartedAt: 0,
  lastBPressed: false,
  lastStopReasonKey: "status.ready",
  lastUiUpdate: 0,
  lastChartUpdate: 0,
  lastGamepadRefresh: 0,
  lastHeatmapRender: 0,
  liveTrail: [],
  charts: {
    frequency: [],
    stability: [],
    center: []
  }
};

let calibration = null;
let tooltipEl = null;
let activeTooltipTarget = null;
let currentLanguage = localStorage.getItem("blss-language") || DEFAULT_LANGUAGE;

if (!TRANSLATIONS[currentLanguage]) {
  currentLanguage = DEFAULT_LANGUAGE;
}

initControls();
requestAnimationFrame(loop);

function initControls() {
  dom.stopButton.disabled = true;
  fillNumberSelect(dom.axisXSelect, 0, 7, 0);
  fillNumberSelect(dom.axisYSelect, 0, 7, 1);
  fillNumberSelect(dom.bButtonSelect, 0, 15, 0);

  dom.gamepadSelect.addEventListener("change", () => {
    gamepadReader.setSelectedIndex(dom.gamepadSelect.value);
  });

  dom.axisXSelect.addEventListener("change", () => {
    gamepadReader.setAxisX(dom.axisXSelect.value);
  });

  dom.axisYSelect.addEventListener("change", () => {
    gamepadReader.setAxisY(dom.axisYSelect.value);
  });

  dom.bButtonSelect.addEventListener("change", () => {
    gamepadReader.setBButton(dom.bButtonSelect.value);
  });

  dom.deadzoneInput.addEventListener("input", () => {
    gamepadReader.setDeadzone(dom.deadzoneInput.value);
    dom.deadzoneValue.textContent = Number(dom.deadzoneInput.value).toFixed(2);
  });

  dom.calibrateButton.addEventListener("click", () => {
    gamepadReader.calibrateCenter();
    setCalibrationStatus(t("calibration.center"), "done");
  });

  dom.calibrateBButton.addEventListener("click", startButtonCalibration);
  dom.calibrateStickButton.addEventListener("click", startStickCalibration);
  dom.sessionModeSelect.addEventListener("change", updateSessionModeUi);
  dom.languageSelect.addEventListener("change", () => {
    currentLanguage = dom.languageSelect.value;
    localStorage.setItem("blss-language", currentLanguage);
    applyLanguage();
  });
  dom.tutorialButton.addEventListener("click", showTutorial);
  dom.closeTutorialButton.addEventListener("click", closeTutorial);
  dom.tutorialOverlay.addEventListener("click", (event) => {
    if (event.target === dom.tutorialOverlay) {
      closeTutorial();
    }
  });
  dom.startButton.addEventListener("click", startSession);
  dom.stopButton.addEventListener("click", () => stopSession("status.manualStop"));
  dom.resetButton.addEventListener("click", resetSession);

  window.addEventListener("gamepadconnected", refreshGamepadList);
  window.addEventListener("gamepaddisconnected", refreshGamepadList);
  setupTooltips();
  dom.languageSelect.value = currentLanguage;
  applyLanguage();
  updateSessionModeUi();
  refreshGamepadList();
  maybeShowFirstRunTutorial();
}

function fillNumberSelect(select, min, max, selected) {
  for (let value = min; value <= max; value += 1) {
    const option = document.createElement("option");
    option.value = String(value);
    option.textContent = String(value);
    option.selected = value === selected;
    select.append(option);
  }
}

function ensureNumberOption(select, value) {
  const stringValue = String(value);

  if (Array.from(select.options).some((option) => option.value === stringValue)) {
    return;
  }

  const option = document.createElement("option");
  option.value = stringValue;
  option.textContent = stringValue;
  select.append(option);
}

function t(key, params = {}) {
  const dictionary = TRANSLATIONS[currentLanguage] ?? TRANSLATIONS[DEFAULT_LANGUAGE];
  const fallback = TRANSLATIONS[DEFAULT_LANGUAGE];
  const template = dictionary[key] ?? fallback[key] ?? key;

  return Object.entries(params).reduce(
    (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
    template
  );
}

function applyLanguage() {
  document.documentElement.lang = currentLanguage;

  document.querySelectorAll("[data-i18n]").forEach((element) => {
    element.textContent = t(element.dataset.i18n);
  });

  document.querySelectorAll("[data-tooltip-key]").forEach((element) => {
    element.dataset.tooltip = t(element.dataset.tooltipKey);
  });

  dom.languageSelect.value = currentLanguage;
  updateSessionModeUi();
  refreshLocalizedSessionText();
  updateUi(analyzer.getSessionStats(), gamepadReader.read(), performance.now());
  updateReview(analyzer.getSessionStats());
}

function refreshLocalizedSessionText() {
  if (session.active) {
    dom.sessionBadge.textContent = t("status.running");
    setTrainingStatusKey(session.mode === "timer" ? "status.timerStarted" : "status.bHeld");
    return;
  }

  if (session.countdownActive) {
    dom.sessionBadge.textContent = t("status.countdown");
    return;
  }

  if (session.waitingForB) {
    dom.sessionBadge.textContent = t("status.armed");
    setTrainingStatusKey("status.waitB");
    return;
  }

  dom.sessionBadge.textContent = t("status.idle");
  setTrainingStatusKey(session.lastStopReasonKey);
}

function showTutorial() {
  dom.tutorialOverlay.classList.remove("hidden");
}

function closeTutorial() {
  dom.tutorialOverlay.classList.add("hidden");
  localStorage.setItem("blss-tutorial-seen", "true");
}

function maybeShowFirstRunTutorial() {
  if (!localStorage.getItem("blss-tutorial-seen")) {
    showTutorial();
  }
}

function startButtonCalibration() {
  if (session.active || session.countdownActive || session.waitingForB) {
    stopSession("status.calibration");
  }

  const baseline = gamepadReader.getButtonSnapshot();

  if (baseline.length === 0) {
    setCalibrationStatus(t("calibration.noGamepad"), "active");
    return;
  }

  calibration = {
    type: "button",
    startedAt: performance.now(),
    baseline
  };
  setCalibrationStatus(t("calibration.buttonPrompt"), "active");
}

function startStickCalibration() {
  if (session.active || session.countdownActive || session.waitingForB) {
    stopSession("status.calibration");
  }

  const baseline = gamepadReader.getAxisSnapshot();

  if (baseline.length === 0) {
    setCalibrationStatus(t("calibration.noGamepad"), "active");
    return;
  }

  calibration = {
    type: "stick",
    startedAt: performance.now(),
    baseline,
    stepIndex: 0,
    stage: "waiting",
    captureStart: 0,
    releaseStart: 0,
    peak: baseline.map(() => 0),
    peakMagnitude: 0,
    records: {}
  };
  updateStickCalibrationPrompt();
}

function processCalibration(now) {
  if (!calibration) {
    return;
  }

  if (calibration.type === "button") {
    processButtonCalibration(now);
    return;
  }

  if (calibration.type === "stick") {
    processStickCalibration(now);
  }
}

function processButtonCalibration(now) {
  if (now - calibration.startedAt > 10000) {
    calibration = null;
    setCalibrationStatus(t("calibration.buttonExpired"), "active");
    return;
  }

  const buttons = gamepadReader.getButtonSnapshot();

  for (let index = 0; index < buttons.length; index += 1) {
    const value = buttons[index] ?? 0;
    const baseline = calibration.baseline[index] ?? 0;

    if (value > 0.65 && baseline < 0.3) {
      gamepadReader.setBButton(index);
      ensureNumberOption(dom.bButtonSelect, index);
      dom.bButtonSelect.value = String(index);
      calibration = null;
      setCalibrationStatus(t("calibration.buttonSet", { index }), "done");
      return;
    }
  }
}

function processStickCalibration(now) {
  if (now - calibration.startedAt > 35000) {
    calibration = null;
    setCalibrationStatus(t("calibration.stickExpired"), "active");
    return;
  }

  const axes = gamepadReader.getAxisSnapshot();

  if (axes.length === 0) {
    calibration = null;
    setCalibrationStatus(t("calibration.disconnected"), "active");
    return;
  }

  const deltas = axes.map((value, index) => value - (calibration.baseline[index] ?? 0));
  const maxDelta = getMaxAxisDelta(deltas);

  if (calibration.stage === "waiting" && maxDelta.magnitude > 0.42) {
    calibration.stage = "capturing";
    calibration.captureStart = now;
    calibration.peak = deltas.slice();
    calibration.peakMagnitude = maxDelta.magnitude;
    setCalibrationStatus(t("calibration.stickHold", { direction: currentStickStepLabel() }), "active");
    return;
  }

  if (calibration.stage === "capturing") {
    if (maxDelta.magnitude > calibration.peakMagnitude) {
      calibration.peak = deltas.slice();
      calibration.peakMagnitude = maxDelta.magnitude;
    }

    if (now - calibration.captureStart > 260) {
      calibration.records[currentStickStep().key] = calibration.peak.slice();
      calibration.stage = "release";
      calibration.releaseStart = 0;
      setCalibrationStatus(t("calibration.releaseStick"), "active");
    }

    return;
  }

  if (calibration.stage === "release") {
    if (maxDelta.magnitude < 0.18) {
      calibration.releaseStart = calibration.releaseStart || now;

      if (now - calibration.releaseStart > 240) {
        calibration.stepIndex += 1;

        if (calibration.stepIndex >= STICK_CALIBRATION_STEPS.length) {
          finishStickCalibration();
          return;
        }

        calibration.stage = "waiting";
        calibration.captureStart = 0;
        calibration.releaseStart = 0;
        calibration.peakMagnitude = 0;
        updateStickCalibrationPrompt();
      }
    } else {
      calibration.releaseStart = 0;
    }
  }
}

function currentStickStep() {
  return STICK_CALIBRATION_STEPS[calibration.stepIndex];
}

function currentStickStepLabel() {
  return t(currentStickStep().labelKey);
}

function updateStickCalibrationPrompt() {
  setCalibrationStatus(t("calibration.stickPush", { direction: currentStickStepLabel() }), "active");
}

function finishStickCalibration() {
  const { baseline, records } = calibration;
  const yAxis = choosePairAxis(records.up, records.down);
  const xAxis = choosePairAxis(records.right, records.left, yAxis.axis);

  if (xAxis.axis < 0 || yAxis.axis < 0 || xAxis.score < 0.25 || yAxis.score < 0.25) {
    calibration = null;
    setCalibrationStatus(t("calibration.axesAmbiguous"), "active");
    return;
  }

  const axisXSign = (records.right[xAxis.axis] ?? 0) >= 0 ? 1 : -1;
  const axisYSign = (records.up[yAxis.axis] ?? 0) >= 0 ? 1 : -1;
  const axisXScale = scaleFromPair(records.right[xAxis.axis], records.left[xAxis.axis]);
  const axisYScale = scaleFromPair(records.up[yAxis.axis], records.down[yAxis.axis]);

  gamepadReader.setAxisMapping({
    axisX: xAxis.axis,
    axisY: yAxis.axis,
    axisXSign,
    axisYSign,
    axisXScale,
    axisYScale,
    centerOffset: {
      x: baseline[xAxis.axis] ?? 0,
      y: baseline[yAxis.axis] ?? 0
    }
  });

  ensureNumberOption(dom.axisXSelect, xAxis.axis);
  ensureNumberOption(dom.axisYSelect, yAxis.axis);
  dom.axisXSelect.value = String(xAxis.axis);
  dom.axisYSelect.value = String(yAxis.axis);
  calibration = null;
  setCalibrationStatus(
    t("calibration.stickSet", {
      xAxis: xAxis.axis,
      xScale: axisXScale.toFixed(2),
      yAxis: yAxis.axis,
      yScale: axisYScale.toFixed(2)
    }),
    "done"
  );
}

function scaleFromPair(primaryValue = 0, oppositeValue = 0) {
  const measuredExtreme = Math.max(Math.abs(primaryValue), Math.abs(oppositeValue), 0.4);
  return clamp(1 / measuredExtreme, 0.75, 2.5);
}

function choosePairAxis(primary, opposite, excludedAxis = -1) {
  let best = { axis: -1, score: 0 };
  const length = Math.max(primary?.length ?? 0, opposite?.length ?? 0);

  for (let axis = 0; axis < length; axis += 1) {
    if (axis === excludedAxis) {
      continue;
    }

    const a = primary?.[axis] ?? 0;
    const b = opposite?.[axis] ?? 0;
    const magnitude = Math.abs(a) + Math.abs(b);
    const hasOppositeSigns = Math.sign(a) !== 0 && Math.sign(b) !== 0 && Math.sign(a) !== Math.sign(b);
    const balance = 1 - Math.min(0.7, Math.abs(Math.abs(a) - Math.abs(b)) / Math.max(magnitude, 0.001));
    const score = magnitude * balance * (hasOppositeSigns ? 1 : 0.25);

    if (score > best.score) {
      best = { axis, score };
    }
  }

  return best;
}

function getMaxAxisDelta(deltas) {
  return deltas.reduce(
    (best, value, index) => {
      const magnitude = Math.abs(value);
      return magnitude > best.magnitude ? { index, magnitude, value } : best;
    },
    { index: -1, magnitude: 0, value: 0 }
  );
}

function setCalibrationStatus(text, state = "") {
  dom.calibrationStatus.textContent = text;
  dom.calibrationStatus.className = `calibration-status ${state}`.trim();
}

function startSession() {
  calibration = null;
  setCalibrationStatus(t("calibration.ready"), "");
  const now = performance.now();
  const mode = dom.sessionModeSelect.value;

  prepareAttempt(now);
  session.mode = mode;
  session.targetDurationMs = readDurationMs();
  session.lastBPressed = gamepadReader.read().bPressed;
  setSessionControlsLocked(true);

  if (mode === "holdB") {
    session.waitingForB = true;
    session.lastStopReasonKey = "status.waitB";
    dom.sessionBadge.textContent = t("status.armed");
    dom.sessionBadge.className = "badge armed";
    dom.startButton.disabled = true;
    dom.stopButton.disabled = false;
    setSessionCue("B", "armed");
    setTrainingStatusKey("status.waitB");
    updateReview(analyzer.getSessionStats());
    return;
  }

  session.countdownActive = true;
  session.countdownStartedAt = now;
  session.countdownEndsAt = now + readCountdownMs();
  session.lastStopReasonKey = "status.countdown";
  dom.sessionBadge.textContent = t("status.countdown");
  dom.sessionBadge.className = "badge countdown";
  dom.startButton.disabled = true;
  dom.stopButton.disabled = false;
  setTrainingStatusKey("status.launchSoon");
  updateCountdownCue(now);
  updateReview(analyzer.getSessionStats());
}

function startActiveRun(now) {
  session.active = true;
  session.countdownActive = false;
  session.waitingForB = false;
  session.startedAt = now;
  session.endsAt = session.mode === "timer" ? now + session.targetDurationMs : 0;
  session.goCueUntil = now + 650;
  session.guardGraceUntil = now + RUN_START_GRACE_MS;
  session.bReleaseStartedAt = 0;
  session.centerStartedAt = 0;
  session.lastStopReasonKey = "status.running";
  dom.sessionBadge.textContent = t("status.running");
  dom.sessionBadge.className = "badge running";
  dom.startButton.disabled = true;
  dom.stopButton.disabled = false;
  setSessionCue("GO", "live");
  setTrainingStatusKey(session.mode === "timer" ? "status.timerStarted" : "status.bHeld");
}

function stopSession(reasonKey = "status.manualStop") {
  if (!session.active && !session.countdownActive && !session.waitingForB) {
    return;
  }

  session.active = false;
  session.countdownActive = false;
  session.waitingForB = false;
  session.endsAt = 0;
  session.countdownEndsAt = 0;
  session.bReleaseStartedAt = 0;
  session.centerStartedAt = 0;
  session.lastStopReasonKey = reasonKey;
  dom.sessionBadge.textContent = t("status.idle");
  dom.sessionBadge.className = "badge idle";
  dom.startButton.disabled = false;
  dom.stopButton.disabled = true;
  setSessionControlsLocked(false);
  setSessionCue(t("cue.stop"), "stopped");
  setTrainingStatusKey(reasonKey);
  updateReview(analyzer.getSessionStats());
}

function resetSession() {
  calibration = null;
  setCalibrationStatus(t("calibration.ready"), "");
  analyzer.reset();
  clearCharts();
  session.active = false;
  session.countdownActive = false;
  session.waitingForB = false;
  session.startedAt = 0;
  session.endsAt = 0;
  session.countdownStartedAt = 0;
  session.countdownEndsAt = 0;
  session.goCueUntil = 0;
  session.guardGraceUntil = 0;
  session.bReleaseStartedAt = 0;
  session.centerStartedAt = 0;
  session.lastStopReasonKey = "status.ready";
  session.liveTrail = [];
  dom.sessionBadge.textContent = t("status.idle");
  dom.sessionBadge.className = "badge idle";
  dom.startButton.disabled = false;
  dom.stopButton.disabled = true;
  setSessionControlsLocked(false);
  setSessionCue(t("cue.ready"), "");
  setTrainingStatusKey("status.ready");
  updateUi(analyzer.getSessionStats(), gamepadReader.read(), performance.now());
  updateReview(analyzer.getSessionStats());
  renderHeatmap();
}

function prepareAttempt(now) {
  analyzer.reset();
  clearCharts();
  session.active = false;
  session.countdownActive = false;
  session.waitingForB = false;
  session.startedAt = 0;
  session.endsAt = 0;
  session.countdownStartedAt = now;
  session.countdownEndsAt = 0;
  session.goCueUntil = 0;
  session.guardGraceUntil = 0;
  session.bReleaseStartedAt = 0;
  session.centerStartedAt = 0;
  session.liveTrail = [];
  renderHeatmap();
}

function updateSessionModeUi() {
  const isHoldMode = dom.sessionModeSelect.value === "holdB";
  dom.timerOptions.classList.toggle("hidden", isHoldMode);
  dom.startButton.textContent = t(isHoldMode ? "button.armB" : "button.start");

  if (!session.active && !session.countdownActive && !session.waitingForB) {
    setTrainingStatusKey(isHoldMode ? "status.detectB" : "status.ready");
    setSessionCue(isHoldMode ? "B" : t("cue.ready"), isHoldMode ? "armed" : "");
  }
}

function setSessionControlsLocked(locked) {
  dom.sessionModeSelect.disabled = locked;
  dom.countdownSelect.disabled = locked;
  dom.sessionDurationInput.disabled = locked;
}

function readCountdownMs() {
  return clamp(Number(dom.countdownSelect.value) || 3, 1, 10) * 1000;
}

function readDurationMs() {
  return clamp(Number(dom.sessionDurationInput.value) || 10, 1, 300) * 1000;
}

function setTrainingStatus(text) {
  dom.trainingStatus.textContent = text;
}

function setTrainingStatusKey(key, params = {}) {
  setTrainingStatus(t(key, params));
}

function setSessionCue(text, state = "") {
  dom.sessionCue.textContent = text;
  dom.sessionCue.className = `cue-readout ${state}`.trim();
}

function setupTooltips() {
  document.querySelectorAll("[title]").forEach((element) => {
    element.dataset.tooltip = element.getAttribute("title");
    element.removeAttribute("title");
  });

  tooltipEl = document.createElement("div");
  tooltipEl.className = "tooltip-popover";
  document.body.append(tooltipEl);

  document.addEventListener("pointerover", (event) => {
    const target = event.target.closest("[data-tooltip]");

    if (!target) {
      return;
    }

    activeTooltipTarget = target;
    tooltipEl.textContent = target.dataset.tooltip;
    tooltipEl.classList.add("visible");
    positionTooltip(event);
  });

  document.addEventListener("pointermove", (event) => {
    if (activeTooltipTarget) {
      positionTooltip(event);
    }
  });

  document.addEventListener("pointerout", (event) => {
    const nextTooltip = event.relatedTarget?.closest?.("[data-tooltip]");

    if (!activeTooltipTarget || nextTooltip === activeTooltipTarget) {
      return;
    }

    activeTooltipTarget = null;
    tooltipEl.classList.remove("visible");
  });
}

function positionTooltip(event) {
  if (!tooltipEl) {
    return;
  }

  const margin = 14;
  const rect = tooltipEl.getBoundingClientRect();
  const x = clamp(event.clientX + margin, 8, window.innerWidth - rect.width - 8);
  const y = clamp(event.clientY + margin, 8, window.innerHeight - rect.height - 8);
  tooltipEl.style.transform = `translate(${x}px, ${y}px)`;
}

function clearCharts() {
  for (const key of Object.keys(session.charts)) {
    session.charts[key] = [];
  }
}

function processSessionAutomation(now, input) {
  if (session.countdownActive) {
    if (now >= session.countdownEndsAt) {
      startActiveRun(now);
    } else {
      updateCountdownCue(now);
    }
  }

  if (session.waitingForB && input.bPressed && !session.lastBPressed) {
    startActiveRun(now);
  }

  if (session.active && session.mode === "timer" && now >= session.endsAt) {
    stopSession("status.timeFinished");
  }

  if (session.active) {
    enforceBlssGuards(now, input);
  }

  if (session.active && session.goCueUntil > 0 && now > session.goCueUntil) {
    setSessionCue(t("cue.live"), "live");
    session.goCueUntil = 0;
  }

  session.lastBPressed = input.bPressed;
}

function updateCountdownCue(now) {
  const remainingMs = Math.max(0, session.countdownEndsAt - now);
  const remainingSeconds = Math.max(1, Math.ceil(remainingMs / 1000));
  setSessionCue(String(remainingSeconds), "countdown");
  setTrainingStatusKey("status.countIn", { time: formatDuration(remainingMs) });
}

function enforceBlssGuards(now, input) {
  if (!input.bPressed) {
    session.bReleaseStartedAt = session.bReleaseStartedAt || now;

    if (now - session.bReleaseStartedAt >= B_RELEASE_STOP_MS) {
      stopSession("status.bReleased");
      return;
    }
  } else {
    session.bReleaseStartedAt = 0;
  }

  if (now < session.guardGraceUntil) {
    return;
  }

  const stickMagnitude = Math.hypot(input.x, input.y);

  if (stickMagnitude <= STICK_CENTER_STOP_RADIUS) {
    session.centerStartedAt = session.centerStartedAt || now;

    if (now - session.centerStartedAt >= STICK_CENTER_STOP_MS) {
      stopSession("status.stickCentered");
    }
  } else {
    session.centerStartedAt = 0;
  }
}

function loop(now) {
  if (now - session.lastGamepadRefresh > 1000) {
    refreshGamepadList();
    session.lastGamepadRefresh = now;
  }

  const input = gamepadReader.read();
  processCalibration(now);
  processSessionAutomation(now, input);
  pushLiveTrail(now, input);

  if (session.active) {
    analyzer.addSample({
      time: now,
      x: input.x,
      y: input.y,
      bPressed: input.bPressed
    });
  }

  const stats = session.active ? analyzer.getLiveStats(2600) : analyzer.getSessionStats();

  if (session.active && now - session.lastChartUpdate > 92) {
    pushChartValues(now, stats);
    session.lastChartUpdate = now;
  }

  renderStick(input, stats);
  renderCharts();

  if (now - session.lastHeatmapRender > 160) {
    renderHeatmap();
    session.lastHeatmapRender = now;
  }

  if (now - session.lastUiUpdate > 58) {
    updateUi(stats, input, now);
    session.lastUiUpdate = now;
  }

  requestAnimationFrame(loop);
}

function pushLiveTrail(now, input) {
  session.liveTrail.push({
    time: now,
    x: input.x,
    y: input.y
  });

  const cutoff = now - 1600;
  while (session.liveTrail.length > 0 && session.liveTrail[0].time < cutoff) {
    session.liveTrail.shift();
  }
}

function pushChartValues(now, stats) {
  for (const key of Object.keys(session.charts)) {
    session.charts[key].push({
      time: now,
      value: stats.chartValues[key]
    });
    session.charts[key] = trimSeries(session.charts[key], 45000);
  }
}

function refreshGamepadList() {
  const gamepads = gamepadReader.listGamepads();
  const selected = dom.gamepadSelect.value;

  dom.gamepadSelect.replaceChildren();
  const auto = document.createElement("option");
  auto.value = "auto";
  auto.textContent = "Auto";
  dom.gamepadSelect.append(auto);

  for (const gamepad of gamepads) {
    const option = document.createElement("option");
    option.value = String(gamepad.index);
    option.textContent = `${gamepad.index}: ${gamepad.id}`;
    dom.gamepadSelect.append(option);
  }

  dom.gamepadSelect.value = Array.from(dom.gamepadSelect.options).some((option) => option.value === selected)
    ? selected
    : "auto";
  gamepadReader.setSelectedIndex(dom.gamepadSelect.value);

  const gamepad = gamepadReader.getSelectedGamepad();

  if (gamepad) {
    for (let index = 0; index < gamepad.axes.length; index += 1) {
      ensureNumberOption(dom.axisXSelect, index);
      ensureNumberOption(dom.axisYSelect, index);
    }

    for (let index = 0; index < gamepad.buttons.length; index += 1) {
      ensureNumberOption(dom.bButtonSelect, index);
    }
  }
}

function updateUi(stats, input, now) {
  const connected = input.connected;
  dom.connectionBadge.textContent = t(connected ? "status.online" : "status.offline");
  dom.connectionBadge.className = connected ? "badge online" : "badge offline";
  dom.rawXValue.textContent = input.rawX.toFixed(3);
  dom.rawYValue.textContent = input.rawY.toFixed(3);
  dom.bValue.textContent = input.bValue.toFixed(2);
  dom.ratingLabel.textContent = getLocalizedRatingLabel(stats.score);
  dom.scoreValue.textContent = Math.round(stats.score).toString();
  dom.axisAngle.textContent = `${Math.round((stats.axis.angle * 180) / Math.PI)}°`;
  dom.oscValue.textContent = stats.frequency.oscillationsPerSecond.toFixed(2);
  dom.dirValue.textContent = stats.frequency.directionChangesPerSecond.toFixed(2);
  dom.centerValue.textContent = stats.center.averageDistance.toFixed(3);
  dom.releaseValue.textContent = String(stats.bHold.releaseCount);
  dom.sessionTime.textContent = getSessionClock(now);
  updateSubscores(stats.subScores);

  if (!session.active) {
    updateReview(stats);
  }
}

function getSessionClock(now) {
  if (session.countdownActive) {
    return formatDuration(session.countdownEndsAt - now);
  }

  if (session.waitingForB) {
    return "00:00.000";
  }

  if (session.active && session.mode === "timer") {
    return formatDuration(session.endsAt - now);
  }

  if (session.active) {
    return formatDuration(now - session.startedAt);
  }

  return formatDuration(analyzer.getDurationMs());
}

function getLocalizedRatingLabel(score) {
  return t(`rating.${getRatingTier(score)}`);
}

function updateSubscores(subScores) {
  for (const row of document.querySelectorAll(".score-row")) {
    const key = row.dataset.score;
    const value = subScores[key] ?? 0;
    const meter = row.querySelector(".meter i");
    const number = row.querySelector("strong");
    meter.style.width = `${Math.min(100, value)}%`;
    meter.style.background = scoreColor(value);
    number.textContent = Math.round(value).toString();
  }
}

function updateReview(stats) {
  dom.sampleCount.textContent = t("review.samples", { count: stats.sampleCount });
  dom.finalScore.textContent = Math.round(stats.score).toString();
  dom.finalDuration.textContent = formatDuration(stats.durationMs);
  dom.rhythmVariance.textContent = stats.rhythm.intervalVariance.toFixed(4);
  dom.pauseValue.textContent = String(stats.rhythm.pauseCount);
  dom.contourValue.textContent = `${Math.round(stats.center.contourPenalty * 100)}%`;
  dom.stopReasonValue.textContent = t(session.lastStopReasonKey);
}

function renderStick(input, stats) {
  const { ctx, width, height } = fitCanvas(dom.stickCanvas);
  const size = Math.min(width, height);
  const cx = width / 2;
  const cy = height / 2;
  const radius = size * 0.42;

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#111517";
  ctx.fillRect(0, 0, width, height);

  drawStickGrid(ctx, cx, cy, radius, stats.axis.angle);
  drawTrail(ctx, session.liveTrail, cx, cy, radius);

  const px = cx + input.x * radius;
  const py = cy - input.y * radius;
  ctx.beginPath();
  ctx.arc(px, py, 8, 0, Math.PI * 2);
  ctx.fillStyle = input.bPressed ? "#65d982" : "#47c7d9";
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(255,255,255,0.75)";
  ctx.stroke();
}

function drawStickGrid(ctx, cx, cy, radius, angle) {
  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.lineWidth = 1;

  for (const ratio of [0.25, 0.5, 0.75, 1]) {
    ctx.beginPath();
    ctx.arc(cx, cy, radius * ratio, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.beginPath();
  ctx.moveTo(cx - radius, cy);
  ctx.lineTo(cx + radius, cy);
  ctx.moveTo(cx, cy - radius);
  ctx.lineTo(cx, cy + radius);
  ctx.stroke();

  ctx.strokeStyle = "rgba(71,199,217,0.55)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx - Math.cos(angle) * radius, cy + Math.sin(angle) * radius);
  ctx.lineTo(cx + Math.cos(angle) * radius, cy - Math.sin(angle) * radius);
  ctx.stroke();

  ctx.strokeStyle = "rgba(101,217,130,0.52)";
  ctx.beginPath();
  ctx.arc(cx, cy, radius * 0.08, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function drawTrail(ctx, trail, cx, cy, radius) {
  if (trail.length < 2) {
    return;
  }

  ctx.save();
  ctx.lineWidth = 2;

  for (let index = 1; index < trail.length; index += 1) {
    const previous = trail[index - 1];
    const current = trail[index];
    const alpha = index / trail.length;
    ctx.strokeStyle = `rgba(71, 199, 217, ${0.08 + alpha * 0.62})`;
    ctx.beginPath();
    ctx.moveTo(cx + previous.x * radius, cy - previous.y * radius);
    ctx.lineTo(cx + current.x * radius, cy - current.y * radius);
    ctx.stroke();
  }

  ctx.restore();
}

function renderHeatmap() {
  const { ctx, width, height } = fitCanvas(dom.heatmapCanvas);
  const heatmap = analyzer.getHeatmap(58);
  const radius = Math.min(width, height) * 0.42;
  const left = width / 2 - radius;
  const top = height / 2 - radius;
  const cellSize = (radius * 2) / heatmap.size;

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#111517";
  ctx.fillRect(0, 0, width, height);

  for (let y = 0; y < heatmap.size; y += 1) {
    for (let x = 0; x < heatmap.size; x += 1) {
      const value = heatmap.grid[y * heatmap.size + x];

      if (value <= 0 || heatmap.max <= 0) {
        continue;
      }

      const intensity = Math.pow(value / heatmap.max, 0.55);
      ctx.fillStyle = heatColor(intensity);
      ctx.fillRect(left + x * cellSize, top + y * cellSize, cellSize + 0.6, cellSize + 0.6);
    }
  }

  ctx.strokeStyle = "rgba(255,255,255,0.1)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(width / 2, height / 2, radius, 0, Math.PI * 2);
  ctx.moveTo(width / 2, top);
  ctx.lineTo(width / 2, top + radius * 2);
  ctx.moveTo(left, height / 2);
  ctx.lineTo(left + radius * 2, height / 2);
  ctx.stroke();

  dom.heatmapPeak.textContent = t("visual.hits", { count: heatmap.max });
}

function renderCharts() {
  drawLineChart(dom.charts.frequency, session.charts.frequency, {
    label: t("chart.frequency"),
    min: 0,
    max: 14,
    color: "#65d982",
    formatValue: (value) => value.toFixed(2)
  });
  drawLineChart(dom.charts.stability, session.charts.stability, {
    label: t("chart.stability"),
    min: 0,
    max: 100,
    color: "#e0b85b",
    formatValue: (value) => `${Math.round(value)}`
  });
  drawLineChart(dom.charts.center, session.charts.center, {
    label: t("chart.center"),
    min: 0,
    max: 100,
    color: "#a78bfa",
    formatValue: (value) => `${Math.round(value)}`
  });
}

function heatColor(intensity) {
  const alpha = 0.16 + intensity * 0.76;

  if (intensity > 0.72) {
    return `rgba(226, 103, 103, ${alpha})`;
  }

  if (intensity > 0.42) {
    return `rgba(224, 184, 91, ${alpha})`;
  }

  return `rgba(71, 199, 217, ${alpha})`;
}

function scoreColor(value) {
  if (value >= 92) {
    return "#65d982";
  }

  if (value >= 68) {
    return "#47c7d9";
  }

  if (value >= 42) {
    return "#e0b85b";
  }

  return "#e26767";
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function formatDuration(ms) {
  const safeMs = Math.max(0, ms);
  const minutes = Math.floor(safeMs / 60000);
  const seconds = Math.floor((safeMs % 60000) / 1000);
  const millis = Math.floor(safeMs % 1000);
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
}
