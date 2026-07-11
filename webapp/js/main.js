import { AudioManager, audioFileName } from "./audio.js";
import { GameEngine } from "./engine.js";
import { InputController } from "./input.js";
import { calculateMascotGuideRect, MascotAnimator } from "./mascot.js";

const SOURCE_WIDTH = 1920;
const SOURCE_HEIGHT = 1080;
const WELCOME_NARRATION_TIMEOUT_MS = 14000;
const PRAISE_NARRATION_DELAY_MS = 900;
const WIN_VOICE_DELAY_MS = 400;
const VOICE_BASE_PATH = "./assets/voice";
const SFX_BASE_PATH = "./assets/sfx";
const LEVELUP_SFX_FILES = Object.freeze(["levelup_00.mp3", "levelup_01.mp3", "levelup_02.mp3"]);
const EMPTY_VOICE_MANIFEST = Object.freeze({
  praise: Object.freeze([]),
  levelup: Object.freeze([]),
});

const startScreen = document.querySelector("#start-screen");
const gameScreen = document.querySelector("#game-screen");
const levelSetName = document.querySelector("#level-set-name");
const loadError = document.querySelector("#load-error");
const startButton = document.querySelector("#start-button");
const playAgainButton = document.querySelector("#play-again-button");
const homeButton = document.querySelector("#home-button");
const exitButton = document.querySelector("#exit-button");
const exitConfirmOverlay = document.querySelector("#exit-confirm-overlay");
const keepPlayingButton = document.querySelector("#keep-playing-button");
const leaveButton = document.querySelector("#leave-button");
const playSurface = document.querySelector("#play-surface");
const frameImage = document.querySelector("#frame-image");
const hotspot = document.querySelector("#hotspot");
const keyPrompt = document.querySelector("#key-prompt");
const progressChip = document.querySelector("#progress-chip");
const winOverlay = document.querySelector("#win-overlay");
const elapsedTime = document.querySelector("#elapsed-time");
const mascotImage = document.querySelector("#mascot");

const audio = new AudioManager();
const mascot = new MascotAnimator(mascotImage);

let manifest = null;
let voiceManifest = EMPTY_VOICE_MANIFEST;
let engine = null;
let input = null;
let currentStep = null;
let exitConfirmOpen = false;
let narrationToken = 0;
let pendingNarrationTimer = 0;
let pendingNarrationCleanup = null;
let pendingStepNarrationDelayMs = 0;
let pendingWinVoiceTimer = 0;
let welcomeNarrationGate = null;
let lastLevelupVoice = "";

function assetUrl(level, fileName) {
  return `./${level.path}/${fileName}`;
}

function voiceUrl(fileName) {
  return fileName ? `${VOICE_BASE_PATH}/${fileName}` : "";
}

function sfxUrl(fileName) {
  return fileName ? `${SFX_BASE_PATH}/${fileName}` : "";
}

function audioUrl(level, kind, index) {
  const available = level.audio?.[kind] || [];
  const fileName = audioFileName(kind, index);
  if (!fileName || !Array.isArray(available) || !available.includes(fileName)) {
    return "";
  }
  return assetUrl(level, fileName);
}

function normalizeVoiceList(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((fileName) => typeof fileName === "string" && fileName.endsWith(".mp3"));
}

async function loadVoiceManifest() {
  const response = await fetch(voiceUrl("voice.json"));
  if (!response.ok) {
    throw new Error(`voice manifest request failed: ${response.status}`);
  }
  const data = await response.json();
  return {
    praise: normalizeVoiceList(data.praise),
    levelup: normalizeVoiceList(data.levelup),
  };
}

function randomItem(items) {
  if (!items.length) {
    return "";
  }
  return items[Math.floor(Math.random() * items.length)];
}

function randomItemWithoutImmediateRepeat(items, previous) {
  if (items.length <= 1) {
    return items[0] || "";
  }

  let item = randomItem(items);
  if (item === previous) {
    const alternatives = items.filter((candidate) => candidate !== previous);
    item = randomItem(alternatives);
  }
  return item;
}

function clearPendingWinVoice() {
  if (!pendingWinVoiceTimer) {
    return;
  }
  window.clearTimeout(pendingWinVoiceTimer);
  pendingWinVoiceTimer = 0;
}

function cancelPendingNarration({ stopAudio = false } = {}) {
  narrationToken += 1;
  if (pendingNarrationTimer) {
    window.clearTimeout(pendingNarrationTimer);
    pendingNarrationTimer = 0;
  }
  if (pendingNarrationCleanup) {
    pendingNarrationCleanup();
    pendingNarrationCleanup = null;
  }
  if (stopAudio) {
    audio.stopNarration();
  }
}

function stopAllAudioAndTimers() {
  cancelPendingNarration({ stopAudio: true });
  clearPendingWinVoice();
  pendingStepNarrationDelayMs = 0;
  welcomeNarrationGate = null;
  audio.stopAll();
}

function queueNextStepNarrationDelay(delayMs) {
  pendingStepNarrationDelayMs = Math.max(pendingStepNarrationDelayMs, delayMs);
}

function takeNextStepNarrationDelay() {
  const delayMs = pendingStepNarrationDelayMs;
  pendingStepNarrationDelayMs = 0;
  return delayMs;
}

function scheduleStepNarration(level, stepIndex, options = {}) {
  cancelPendingNarration();

  const url = audioUrl(level, "say", stepIndex);
  if (!url) {
    return;
  }

  const token = narrationToken;
  const delayMs = options.delayMs || 0;
  const playNarration = () => {
    if (token !== narrationToken || !isGameplayActive()) {
      return;
    }
    pendingNarrationTimer = 0;
    audio.playNarration(url);
  };
  const playAfterDelay = () => {
    if (delayMs <= 0) {
      playNarration();
      return;
    }
    pendingNarrationTimer = window.setTimeout(playNarration, delayMs);
  };

  if (!options.afterAudio) {
    playAfterDelay();
    return;
  }

  const afterAudio = options.afterAudio;
  const finishGate = () => {
    if (token !== narrationToken) {
      return;
    }
    if (pendingNarrationCleanup) {
      pendingNarrationCleanup();
      pendingNarrationCleanup = null;
    }
    playAfterDelay();
  };
  const cleanupGate = () => {
    afterAudio.removeEventListener("ended", finishGate);
    if (pendingNarrationTimer) {
      window.clearTimeout(pendingNarrationTimer);
      pendingNarrationTimer = 0;
    }
  };

  pendingNarrationCleanup = cleanupGate;
  afterAudio.addEventListener("ended", finishGate, { once: true });
  pendingNarrationTimer = window.setTimeout(finishGate, options.timeoutMs || WELCOME_NARRATION_TIMEOUT_MS);

  if (afterAudio.ended) {
    finishGate();
  }
}

function playIntroAudio() {
  audio.playSfx(sfxUrl("start.mp3"));
  return audio.playVoice(voiceUrl("welcome.mp3"));
}

function playCorrectAudio(level, stepIndex) {
  const praiseVoice = randomItem(voiceManifest.praise);
  audio.playSfx(sfxUrl("pop.mp3"));
  if (praiseVoice) {
    audio.playVoice(voiceUrl(praiseVoice));
  } else {
    audio.stopVoice();
  }
  audio.playCompletion(audioUrl(level, "sound", stepIndex));
}

function playLevelCompleteAudio() {
  const levelupVoice = randomItemWithoutImmediateRepeat(voiceManifest.levelup, lastLevelupVoice);
  audio.playSfx(sfxUrl(randomItem(LEVELUP_SFX_FILES)));
  if (levelupVoice) {
    lastLevelupVoice = levelupVoice;
    audio.playVoice(voiceUrl(levelupVoice));
  } else {
    audio.stopVoice();
  }
}

function playWinAudio() {
  clearPendingWinVoice();
  audio.playSfx(sfxUrl("win.mp3"));
  pendingWinVoiceTimer = window.setTimeout(() => {
    pendingWinVoiceTimer = 0;
    audio.playVoice(voiceUrl("win.mp3"));
  }, WIN_VOICE_DELAY_MS);
}

function imageRect() {
  return frameImage.getBoundingClientRect();
}

function playSurfaceRect() {
  return playSurface.getBoundingClientRect();
}

function boxRect(left, top, width, height) {
  return {
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
  };
}

function setProgress(text) {
  progressChip.textContent = text;
}

function setFrame(level, frameName) {
  frameImage.src = assetUrl(level, frameName);
}

function buttonColor(button) {
  if (button === "right") {
    return "rgba(0, 0, 255, 0.5)";
  }
  if (button === "middle") {
    return "rgba(0, 255, 0, 0.5)";
  }
  return "rgba(255, 0, 0, 0.5)";
}

function restartPromptPop(element) {
  element.classList.remove("is-popping");
  void element.offsetWidth;
  element.classList.add("is-popping");
}

function hotspotRectForStep(step) {
  if (!step || step.type !== "mouse") {
    return null;
  }

  const rect = imageRect();
  if (rect.width <= 0 || rect.height <= 0) {
    return null;
  }

  const scale = Math.min(rect.width / SOURCE_WIDTH, rect.height / SOURCE_HEIGHT);
  const size = (manifest.hotSpotSize || 50) * scale;
  const [x, y] = step.position;
  return boxRect(rect.left + x * scale - size / 2, rect.top + y * scale - size / 2, size, size);
}

function renderHotspot(step, options = {}) {
  const stepHotspot = step?.type === "mouse" ? step : null;
  if (!stepHotspot) {
    hotspot.hidden = true;
    hotspot.classList.remove("is-popping");
    return;
  }

  const rect = hotspotRectForStep(stepHotspot);
  if (!rect) {
    hotspot.hidden = true;
    hotspot.classList.remove("is-popping");
    return;
  }

  hotspot.style.left = `${rect.left}px`;
  hotspot.style.top = `${rect.top}px`;
  hotspot.style.width = `${rect.width}px`;
  hotspot.style.height = `${rect.height}px`;
  hotspot.style.borderColor = buttonColor(stepHotspot.button);
  hotspot.hidden = false;
  if (options.pop) {
    restartPromptPop(hotspot);
  }
}

function modifierLabel(modifier) {
  return modifier
    .split(" ")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function keyLabel(name) {
  const labels = {
    enter: "Enter",
    space: "Space",
    tab: "Tab",
    backspace: "Backspace",
  };
  return labels[name] || String(name).toUpperCase();
}

function renderKeyPrompt(step, options = {}) {
  if (!step || step.type !== "key") {
    keyPrompt.hidden = true;
    keyPrompt.classList.remove("is-popping");
    keyPrompt.replaceChildren();
    return;
  }

  const parts = [...(step.modifiers || []).map(modifierLabel), keyLabel(step.name)];
  const fragment = document.createDocumentFragment();
  const label = document.createElement("span");
  label.className = "key-prompt-text";
  label.textContent = "Press";
  fragment.append(label);

  parts.forEach((part, index) => {
    const key = document.createElement("span");
    key.className = "key-cap";
    key.textContent = part;
    fragment.append(key);
    if (index < parts.length - 1) {
      const plus = document.createElement("span");
      plus.className = "key-plus";
      plus.textContent = "+";
      fragment.append(plus);
    }
  });

  keyPrompt.replaceChildren(fragment);
  keyPrompt.hidden = false;
  if (options.pop) {
    restartPromptPop(keyPrompt);
  }
}

function renderStepMascot(step, options = {}) {
  let targetRect = null;
  if (step?.type === "mouse") {
    targetRect = hotspotRectForStep(step);
  } else if (step?.type === "key" && !keyPrompt.hidden) {
    targetRect = keyPrompt.getBoundingClientRect();
  }

  const rect = targetRect ? calculateMascotGuideRect(playSurfaceRect(), targetRect) : null;
  if (!rect) {
    mascot.stop();
    return;
  }

  mascot.setGuideRect(rect, options);
  mascot.loop("idle");
}

function hidePrompts() {
  currentStep = null;
  hotspot.hidden = true;
  hotspot.classList.remove("is-popping");
  keyPrompt.hidden = true;
  keyPrompt.classList.remove("is-popping");
  keyPrompt.replaceChildren();
}

function isGameplayActive() {
  return !gameScreen.hidden && winOverlay.hidden;
}

function showExitButton() {
  exitButton.hidden = false;
  exitButton.disabled = false;
}

function hideExitButton() {
  exitButton.hidden = true;
  exitButton.disabled = true;
}

function resumeGameplayAfterConfirm() {
  engine?.resume();

  if (!engine?.getExpectedInput()) {
    input?.setEnabled(false);
    return;
  }

  renderStepMascot(currentStep, { snap: true });
  input.setEnabled(true);
  scheduleStepNarration(engine.currentLevel, engine.currentStepIndex);
  playSurface.focus({ preventScroll: true });
}

function showExitConfirm() {
  if (!isGameplayActive() || exitConfirmOpen) {
    return;
  }

  exitConfirmOpen = true;
  exitConfirmOverlay.hidden = false;
  exitButton.disabled = true;
  input?.setEnabled(false);
  welcomeNarrationGate = null;
  stopAllAudioAndTimers();
  mascot.stop();
  engine?.pause();
  keepPlayingButton.focus({ preventScroll: true });
}

function dismissExitConfirm() {
  if (!exitConfirmOpen) {
    return;
  }

  exitConfirmOpen = false;
  exitConfirmOverlay.hidden = true;
  exitButton.disabled = false;
  resumeGameplayAfterConfirm();
}

function returnToStartScreen() {
  exitConfirmOpen = false;
  exitConfirmOverlay.hidden = true;
  input?.setEnabled(false);
  hidePrompts();
  stopAllAudioAndTimers();
  mascot.stop();
  mascot.dock();
  engine?.reset();
  winOverlay.hidden = true;
  elapsedTime.textContent = "0.00 seconds";
  frameImage.removeAttribute("src");
  if (manifest) {
    setProgress(`Level 1/${manifest.levels.length} · Step 1/1`);
  }
  hideExitButton();
  gameScreen.hidden = true;
  startScreen.hidden = false;
  if (!startButton.disabled) {
    startButton.focus({ preventScroll: true });
  }
}

function handleStep({ level, levelIndex, stepIndex, stepKey, totalLevels }) {
  const step = level.hotspots[stepKey];
  currentStep = step;
  setFrame(level, level.frames[stepIndex]);
  setProgress(`Level ${levelIndex + 1}/${totalLevels} · Step ${stepIndex + 1}/${level.interactiveStepCount}`);
  renderKeyPrompt(step, { pop: true });
  renderHotspot(step, { pop: true });
  showExitButton();
  if (exitConfirmOpen) {
    input.setEnabled(false);
    return;
  }
  if (stepIndex === 0) {
    mascot.prepareLevelEntry();
  }
  renderStepMascot(step);
  input.setEnabled(true);
  scheduleStepNarration(level, stepIndex, {
    delayMs: takeNextStepNarrationDelay(),
    afterAudio: welcomeNarrationGate?.levelIndex === levelIndex && welcomeNarrationGate.stepIndex === stepIndex
      ? welcomeNarrationGate.audioElement
      : null,
    timeoutMs: WELCOME_NARRATION_TIMEOUT_MS,
  });
  playSurface.focus({ preventScroll: true });
}

function handleCorrect({ level, stepIndex }) {
  cancelPendingNarration({ stopAudio: true });
  welcomeNarrationGate = null;
  queueNextStepNarrationDelay(PRAISE_NARRATION_DELAY_MS);
  playCorrectAudio(level, stepIndex);
  mascot.playRandomSuccess();
}

function handleLevelCompletionFrame({ level, levelIndex, frameName, totalLevels }) {
  input.setEnabled(false);
  hidePrompts();
  cancelPendingNarration({ stopAudio: true });
  playLevelCompleteAudio();
  setFrame(level, frameName);
  setProgress(`Level ${levelIndex + 1}/${totalLevels} complete`);
}

function handleWin({ elapsedSeconds }) {
  input.setEnabled(false);
  hidePrompts();
  cancelPendingNarration({ stopAudio: true });
  pendingStepNarrationDelayMs = 0;
  setProgress("Game complete");
  elapsedTime.textContent = `${elapsedSeconds.toFixed(2)} seconds`;
  exitConfirmOpen = false;
  exitConfirmOverlay.hidden = true;
  hideExitButton();
  winOverlay.hidden = false;
  playWinAudio();
  mascot.startCelebration();
  playAgainButton.focus({ preventScroll: true });
}

function handleLayoutChange(options = {}) {
  if (!currentStep) {
    return;
  }
  renderHotspot(currentStep);
  if (exitConfirmOpen) {
    return;
  }
  renderStepMascot(currentStep, { snap: options.snapMascot });
}

async function loadManifest() {
  const response = await fetch("./content/manifest.json");
  if (!response.ok) {
    throw new Error(`manifest request failed: ${response.status}`);
  }
  return response.json();
}

function showLoadError(error) {
  levelSetName.textContent = "Content could not be loaded.";
  loadError.textContent = error.message;
  loadError.hidden = false;
}

function prepareGame() {
  engine = new GameEngine(manifest, {
    onStep: handleStep,
    onCorrect: handleCorrect,
    onLevelCompletionFrame: handleLevelCompletionFrame,
    onWin: handleWin,
  });

  input = new InputController(playSurface, {
    getExpectedInput: () => engine.getExpectedInput(),
    getImageRect: imageRect,
    onCorrect: () => engine.markCorrect(),
  });
}

async function startGame() {
  await audio.unlock().catch(() => {});
  stopAllAudioAndTimers();
  exitConfirmOpen = false;
  exitConfirmOverlay.hidden = true;
  winOverlay.hidden = true;
  mascot.stop();
  mascot.dock();
  startScreen.hidden = true;
  gameScreen.hidden = false;
  showExitButton();
  welcomeNarrationGate = {
    levelIndex: 0,
    stepIndex: 0,
    audioElement: playIntroAudio(),
  };
  engine.start();
}

function playAgain() {
  stopAllAudioAndTimers();
  exitConfirmOpen = false;
  exitConfirmOverlay.hidden = true;
  winOverlay.hidden = true;
  mascot.stop();
  mascot.dock();
  showExitButton();
  engine.start();
}

function handleWindowKeyDown(event) {
  if (event.key !== "Escape" || !isGameplayActive()) {
    return;
  }

  event.preventDefault();
  event.stopImmediatePropagation();
  if (exitConfirmOpen) {
    dismissExitConfirm();
    return;
  }
  showExitConfirm();
}

async function init() {
  try {
    void mascot.preload();
    [manifest, voiceManifest] = await Promise.all([loadManifest(), loadVoiceManifest()]);
    levelSetName.textContent = `${manifest.contentSet} · ${manifest.levels.length} levels · ${manifest.totalInteractiveSteps} steps`;
    prepareGame();
    startButton.disabled = false;
  } catch (error) {
    showLoadError(error);
  }
}

startButton.addEventListener("click", startGame);
playAgainButton.addEventListener("click", playAgain);
homeButton.addEventListener("click", returnToStartScreen);
exitButton.addEventListener("click", showExitConfirm);
keepPlayingButton.addEventListener("click", dismissExitConfirm);
leaveButton.addEventListener("click", returnToStartScreen);
frameImage.addEventListener("load", () => handleLayoutChange({ snapMascot: false }));
window.addEventListener("keydown", handleWindowKeyDown, { capture: true });
window.addEventListener("resize", () => handleLayoutChange({ snapMascot: true }));

void init();
