import { AudioManager } from "./js/audio.js";
import { calculateMascotGuideRect, MascotAnimator } from "./js/mascot.js";
import { GuidedEngine } from "./guided-engine.js";

const VOICE_BASE_PATH = "./assets/voice";
const SFX_BASE_PATH = "./assets/sfx";
const CAPTION_MS = 4200;
const STEER_CAPTION_MS = 6500;
const TARGET_SIZE = 56;
const EMPTY_VOICE_MANIFEST = Object.freeze({
  praise: Object.freeze([]),
  levelup: Object.freeze([]),
  oops: Object.freeze([]),
  recover: Object.freeze([]),
});

const mascotImage = document.querySelector("#mascot");
const hotspot = document.querySelector("#hotspot");
const caption = document.querySelector("#steer-caption");
const errorOverlay = document.querySelector("#error-overlay");

const audio = new AudioManager();
const mascot = new MascotAnimator(mascotImage);

let quest = null;
let engine = null;
let voiceManifest = EMPTY_VOICE_MANIFEST;
let lastPraise = "";
let lastOops = "";
let captionTimer = 0;
let latestBounds = {
  x: 0,
  y: 0,
  width: window.innerWidth || 1280,
  height: window.innerHeight || 800,
};

function voiceUrl(fileName) {
  return fileName ? `${VOICE_BASE_PATH}/${fileName}` : "";
}

function sfxUrl(fileName) {
  return fileName ? `${SFX_BASE_PATH}/${fileName}` : "";
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
    item = randomItem(items.filter((candidate) => candidate !== previous));
  }
  return item;
}

function normalizeVoiceList(value) {
  return Array.isArray(value)
    ? value.filter((fileName) => typeof fileName === "string" && fileName.endsWith(".mp3"))
    : [];
}

async function loadVoiceManifest() {
  try {
    const response = await fetch(voiceUrl("voice.json"));
    if (!response.ok) {
      return EMPTY_VOICE_MANIFEST;
    }
    const data = await response.json();
    return {
      praise: normalizeVoiceList(data.praise),
      levelup: normalizeVoiceList(data.levelup),
      oops: normalizeVoiceList(data.oops),
      recover: normalizeVoiceList(data.recover),
    };
  } catch {
    return EMPTY_VOICE_MANIFEST;
  }
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

function restartPop(element) {
  element.classList.remove("is-popping");
  void element.offsetWidth;
  element.classList.add("is-popping");
  element.addEventListener(
    "animationend",
    (event) => {
      if (event.target === element && !event.pseudoElement) {
        element.classList.remove("is-popping");
      }
    },
    { once: true }
  );
}

function playSurfaceRect() {
  return {
    left: 0,
    top: 0,
    width: latestBounds.width || window.innerWidth,
    height: latestBounds.height || window.innerHeight,
  };
}

function targetRectFromStep(step) {
  const target = step?.target || { kind: "none" };
  if (target.kind !== "window_norm") {
    return null;
  }
  const surface = playSurfaceRect();
  const centerX = Number(target.x) * surface.width;
  const centerY = Number(target.y) * surface.height;
  return boxRect(centerX - TARGET_SIZE / 2, centerY - TARGET_SIZE / 2, TARGET_SIZE, TARGET_SIZE);
}

function guideRectForTarget(targetRect) {
  return calculateMascotGuideRect(playSurfaceRect(), targetRect);
}

function renderHotspot(targetRect, options = {}) {
  if (!targetRect) {
    hotspot.hidden = true;
    hotspot.classList.remove("is-popping");
    return;
  }
  hotspot.style.left = `${targetRect.left}px`;
  hotspot.style.top = `${targetRect.top}px`;
  hotspot.style.width = `${targetRect.width}px`;
  hotspot.style.height = `${targetRect.height}px`;
  hotspot.hidden = false;
  if (options.pop) {
    restartPop(hotspot);
  }
}

function showCaption(text, durationMs = CAPTION_MS) {
  if (captionTimer) {
    window.clearTimeout(captionTimer);
    captionTimer = 0;
  }
  const cleanText = String(text || "").trim();
  if (!cleanText) {
    caption.hidden = true;
    caption.textContent = "";
    return;
  }
  caption.textContent = cleanText;
  caption.hidden = false;
  captionTimer = window.setTimeout(() => {
    caption.hidden = true;
    captionTimer = 0;
  }, durationMs);
}

function narrationForStep(step) {
  return step?.narrationUrl || "";
}

function renderStep(step, options = {}) {
  const targetRect = targetRectFromStep(step);
  renderHotspot(targetRect, { pop: true });

  if (!targetRect) {
    mascot.dock();
    mascot.loop("idle");
    return;
  }

  const guideRect = guideRectForTarget(targetRect);
  if (guideRect) {
    mascot.setGuideRect(guideRect, options);
    mascot.loop("idle");
  }
}

function handleStep({ step }) {
  renderStep(step);
  audio.playNarration(narrationForStep(step));
  showCaption(step.narration_text || step.goal || "");
}

function handleCorrect() {
  audio.stopNarration();
  audio.playSfx(sfxUrl("pop.mp3"));
  const praise = randomItemWithoutImmediateRepeat(voiceManifest.praise, lastPraise);
  if (praise) {
    lastPraise = praise;
    audio.playVoice(voiceUrl(praise));
  }
  mascot.playRandomSuccess();
}

function replayCurrentStep() {
  const step = engine?.currentStep?.();
  if (step) {
    audio.playNarration(narrationForStep(step));
    showCaption(step.narration_text || step.goal || "");
  }
}

function handleWrongState() {
  audio.stopNarration();
  const oops = randomItemWithoutImmediateRepeat(voiceManifest.oops, lastOops);
  if (oops) {
    lastOops = oops;
    audio.playVoice(voiceUrl(oops));
  }
  showCaption("Oops — that's not it! Press ⌘Z to undo.", STEER_CAPTION_MS);
  mascot.playOnce("wave");
}

function handleWrongStateCleared() {
  const recover = randomItem(voiceManifest.recover);
  if (recover) {
    audio.playVoice(voiceUrl(recover));
  } else {
    const praise = randomItemWithoutImmediateRepeat(voiceManifest.praise, lastPraise);
    if (praise) {
      lastPraise = praise;
      audio.playVoice(voiceUrl(praise));
    }
  }
  replayCurrentStep();
}

function handleWin() {
  renderHotspot(null);
  audio.stopNarration();
  audio.playSfx(sfxUrl("win.mp3"));
  audio.playVoice(voiceUrl("win.mp3"));
  mascot.startCelebration();
}

function handleSteer(payload) {
  if (!payload) {
    return;
  }
  if (payload.audioFileUrl) {
    audio.playVoice(payload.audioFileUrl);
  }
  if (payload.steerLine) {
    showCaption(payload.steerLine, STEER_CAPTION_MS);
  }
  mascot.playOnce("wave");

  const point = payload.point;
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    return;
  }

  const surface = playSurfaceRect();
  const targetRect = boxRect(
    point.x * surface.width - TARGET_SIZE / 2,
    point.y * surface.height - TARGET_SIZE / 2,
    TARGET_SIZE,
    TARGET_SIZE
  );
  renderHotspot(targetRect, { pop: true });
  const guideRect = guideRectForTarget(targetRect);
  if (guideRect) {
    window.setTimeout(() => {
      mascot.setGuideRect(guideRect);
      mascot.loop("idle");
    }, 300);
  }
  window.setTimeout(() => {
    const currentStep = engine?.currentStep?.();
    renderHotspot(targetRectFromStep(currentStep));
  }, STEER_CAPTION_MS);
}

function showQuestError(error) {
  errorOverlay.textContent = error?.message || "Unable to load quest.";
  errorOverlay.hidden = false;
}

function currentEntranceRect() {
  const firstTarget = targetRectFromStep(quest?.steps?.[0]);
  const guideRect = firstTarget ? guideRectForTarget(firstTarget) : null;
  if (guideRect) {
    return guideRect;
  }
  const surface = playSurfaceRect();
  const size = Math.min(Math.max(surface.height * 0.2, 132), 220);
  return boxRect(surface.width - size - 24, surface.height - size - 18, size, size);
}

async function startQuest() {
  await audio.unlock().catch(() => {});
  voiceManifest = await loadVoiceManifest();
  await mascot.preload();
  mascot.loop("idle");

  engine = new GuidedEngine(quest, {
    onStep: handleStep,
    onCorrect: handleCorrect,
    onWin: handleWin,
  });

  const entranceRect = currentEntranceRect();
  const didStartEntrance = mascot.startEntrance(entranceRect, {
    onComplete: () => engine.start(),
  });
  if (!didStartEntrance) {
    engine.start();
  }
}

function handleEvent(message) {
  if (!message || !engine) {
    return;
  }
  if (message.type === "step_verified") {
    engine.onStepVerified(message.step_id);
  } else if (message.type === "wrong_state") {
    handleWrongState();
  } else if (message.type === "wrong_state_cleared") {
    handleWrongStateCleared();
  } else if (message.type === "replay_narration") {
    const step = engine.currentStep();
    if (!message.step_id || message.step_id === step?.id) {
      replayCurrentStep();
    }
  }
}

function handleBounds(bounds) {
  if (!bounds) {
    return;
  }
  latestBounds = {
    ...latestBounds,
    ...bounds,
  };
  if (!engine || engine.state !== "running") {
    return;
  }
  renderStep(engine.currentStep(), { snap: true });
}

async function init() {
  try {
    quest = await window.guided.questData();
    window.guided.onBounds(handleBounds);
    window.guided.onEvent(handleEvent);
    window.guided.onSteer(handleSteer);

    if (quest?.error) {
      showQuestError(quest.error);
      return;
    }
    await startQuest();
  } catch (error) {
    showQuestError({ message: error.message });
  } finally {
    window.guided.ready();
  }
}

void init();
