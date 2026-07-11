import { AudioManager, audioFileName } from "./audio.js";
import { GameEngine } from "./engine.js";
import { InputController } from "./input.js";
import { calculateMascotGuideRect, MascotAnimator } from "./mascot.js";

const SOURCE_WIDTH = 1920;
const SOURCE_HEIGHT = 1080;

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
let engine = null;
let input = null;
let currentStep = null;
let exitConfirmOpen = false;

function assetUrl(level, fileName) {
  return `./${level.path}/${fileName}`;
}

function audioUrl(level, kind, index) {
  const available = level.audio?.[kind] || [];
  const fileName = audioFileName(kind, index);
  if (!fileName || !Array.isArray(available) || !available.includes(fileName)) {
    return "";
  }
  return assetUrl(level, fileName);
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

function renderHotspot(step) {
  const stepHotspot = step?.type === "mouse" ? step : null;
  if (!stepHotspot) {
    hotspot.hidden = true;
    return;
  }

  const rect = hotspotRectForStep(stepHotspot);
  if (!rect) {
    hotspot.hidden = true;
    return;
  }

  hotspot.style.left = `${rect.left}px`;
  hotspot.style.top = `${rect.top}px`;
  hotspot.style.width = `${rect.width}px`;
  hotspot.style.height = `${rect.height}px`;
  hotspot.style.borderColor = buttonColor(stepHotspot.button);
  hotspot.hidden = false;
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

function renderKeyPrompt(step) {
  if (!step || step.type !== "key") {
    keyPrompt.hidden = true;
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
}

function renderStepMascot(step) {
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

  mascot.setGuideRect(rect);
  mascot.loop("idle");
}

function hidePrompts() {
  currentStep = null;
  hotspot.hidden = true;
  keyPrompt.hidden = true;
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

  renderStepMascot(currentStep);
  input.setEnabled(true);
  audio.playNarration(audioUrl(engine.currentLevel, "say", engine.currentStepIndex));
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
  audio.stopNarration();
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
  audio.stopAll();
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
  renderKeyPrompt(step);
  renderHotspot(step);
  showExitButton();
  if (exitConfirmOpen) {
    input.setEnabled(false);
    return;
  }
  renderStepMascot(step);
  input.setEnabled(true);
  audio.playNarration(audioUrl(level, "say", stepIndex));
  playSurface.focus({ preventScroll: true });
}

function handleCorrect({ level, stepIndex }) {
  audio.playCompletion(audioUrl(level, "sound", stepIndex));
  mascot.playRandomSuccess();
}

function handleLevelCompletionFrame({ level, levelIndex, frameName, totalLevels }) {
  input.setEnabled(false);
  hidePrompts();
  audio.stopNarration();
  setFrame(level, frameName);
  setProgress(`Level ${levelIndex + 1}/${totalLevels} complete`);
}

function handleWin({ elapsedSeconds }) {
  input.setEnabled(false);
  hidePrompts();
  audio.stopNarration();
  setProgress("Game complete");
  elapsedTime.textContent = `${elapsedSeconds.toFixed(2)} seconds`;
  exitConfirmOpen = false;
  exitConfirmOverlay.hidden = true;
  hideExitButton();
  winOverlay.hidden = false;
  mascot.dock();
  mascot.loop("dance");
  playAgainButton.focus({ preventScroll: true });
}

function handleResize() {
  if (!currentStep) {
    return;
  }
  renderHotspot(currentStep);
  if (exitConfirmOpen) {
    return;
  }
  renderStepMascot(currentStep);
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
  exitConfirmOpen = false;
  exitConfirmOverlay.hidden = true;
  winOverlay.hidden = true;
  mascot.stop();
  mascot.dock();
  startScreen.hidden = true;
  gameScreen.hidden = false;
  showExitButton();
  engine.start();
}

function playAgain() {
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
    manifest = await loadManifest();
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
frameImage.addEventListener("load", handleResize);
window.addEventListener("keydown", handleWindowKeyDown, { capture: true });
window.addEventListener("resize", handleResize);

void init();
