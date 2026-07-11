import { AudioManager, audioFileName } from "./audio.js";
import { GameEngine } from "./engine.js";
import { InputController } from "./input.js";
import { MascotAnimator } from "./mascot.js";

const SOURCE_WIDTH = 1920;
const SOURCE_HEIGHT = 1080;

const startScreen = document.querySelector("#start-screen");
const gameScreen = document.querySelector("#game-screen");
const levelSetName = document.querySelector("#level-set-name");
const loadError = document.querySelector("#load-error");
const startButton = document.querySelector("#start-button");
const playAgainButton = document.querySelector("#play-again-button");
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
let currentHotspot = null;

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

function renderHotspot(step) {
  currentHotspot = step?.type === "mouse" ? step : null;
  if (!currentHotspot) {
    hotspot.hidden = true;
    return;
  }

  const rect = imageRect();
  if (rect.width <= 0 || rect.height <= 0) {
    hotspot.hidden = true;
    return;
  }

  const scale = Math.min(rect.width / SOURCE_WIDTH, rect.height / SOURCE_HEIGHT);
  const size = (manifest.hotSpotSize || 50) * scale;
  const [x, y] = currentHotspot.position;
  const left = rect.left + x * scale - size / 2;
  const top = rect.top + y * scale - size / 2;

  hotspot.style.left = `${left}px`;
  hotspot.style.top = `${top}px`;
  hotspot.style.width = `${size}px`;
  hotspot.style.height = `${size}px`;
  hotspot.style.borderColor = buttonColor(currentHotspot.button);
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

function hidePrompts() {
  currentHotspot = null;
  hotspot.hidden = true;
  keyPrompt.hidden = true;
  keyPrompt.replaceChildren();
}

function handleStep({ level, levelIndex, stepIndex, stepKey, totalLevels }) {
  const step = level.hotspots[stepKey];
  setFrame(level, level.frames[stepIndex]);
  setProgress(`Level ${levelIndex + 1}/${totalLevels} · Step ${stepIndex + 1}/${level.interactiveStepCount}`);
  renderKeyPrompt(step);
  renderHotspot(step);
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
  winOverlay.hidden = false;
  mascot.loop("dance");
  playAgainButton.focus({ preventScroll: true });
}

function handleResize() {
  renderHotspot(currentHotspot);
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
  winOverlay.hidden = true;
  mascot.stop();
  startScreen.hidden = true;
  gameScreen.hidden = false;
  engine.start();
}

function playAgain() {
  winOverlay.hidden = true;
  mascot.stop();
  engine.start();
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
frameImage.addEventListener("load", handleResize);
window.addEventListener("resize", handleResize);

void init();
