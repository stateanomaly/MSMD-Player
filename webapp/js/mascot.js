const FPS = 24;
const FRAME_MS = 1000 / FPS;
const GUIDE_HEIGHT_RATIO = 0.20;
const GUIDE_MIN_SIZE = 96;
const GUIDE_MAX_SIZE = 240;
const GUIDE_GAP = 10;
const CELEBRATION_LAP_MS = 6000;
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
const ENTRANCE_SPIRAL_MS = 2200;
const ENTRANCE_PUSH_MS = 800;
const ENTRANCE_PULL_MS = 720;
const ENTRANCE_REDUCED_FADE_MS = 240;
const ENTRANCE_SPIRAL_TURNS = 1.75;
const ENTRANCE_HOLD_SCALE = 1.25;
const ENTRANCE_PUSH_SCALE = 1.6;
const ENTRANCE_PUSH_OVERSHOOT_SCALE = 1.68;
const CLIPS = {
  idle: 48,
  wave: 40,
  thumbsup: 32,
  dance: 48,
};

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function mix(start, end, amount) {
  return start + (end - start) * amount;
}

function easeInCubic(value) {
  return value * value * value;
}

function easeOutCubic(value) {
  return 1 - (1 - value) ** 3;
}

function easeOutBack(value, overshoot = 1.18) {
  const shifted = value - 1;
  return 1 + (overshoot + 1) * shifted ** 3 + overshoot * shifted ** 2;
}

function easeInOutCubic(value) {
  if (value < 0.5) {
    return 4 * value * value * value;
  }
  return 1 - (-2 * value + 2) ** 3 / 2;
}

function prefersReducedMotion() {
  return window.matchMedia?.(REDUCED_MOTION_QUERY).matches || false;
}

function frameUrl(clipName, index) {
  return `./assets/mascot/${clipName}/frame_${String(index).padStart(4, "0")}.png`;
}

function copyRect(rect) {
  return {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
    right: rect.left + rect.width,
    bottom: rect.top + rect.height,
    side: rect.side,
  };
}

function rectCenter(rect) {
  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
  };
}

function rectFromCenter(center, width, height) {
  return {
    left: center.x - width / 2,
    top: center.y - height / 2,
    width,
    height,
    right: center.x + width / 2,
    bottom: center.y + height / 2,
  };
}

function viewportCenter() {
  return {
    x: window.innerWidth / 2,
    y: window.innerHeight / 2,
  };
}

function quadraticPoint(start, control, end, amount) {
  const inverse = 1 - amount;
  return {
    x: inverse * inverse * start.x + 2 * inverse * amount * control.x + amount * amount * end.x,
    y: inverse * inverse * start.y + 2 * inverse * amount * control.y + amount * amount * end.y,
  };
}

function quadraticDerivative(start, control, end, amount) {
  return {
    x: 2 * (1 - amount) * (control.x - start.x) + 2 * amount * (end.x - control.x),
    y: 2 * (1 - amount) * (control.y - start.y) + 2 * amount * (end.y - control.y),
  };
}

function bankFromVector(deltaX, deltaY, maxDegrees = 14) {
  const distance = Math.hypot(deltaX, deltaY);
  if (distance <= 0.001) {
    return 0;
  }
  return clamp((deltaX / distance) * maxDegrees, -maxDegrees, maxDegrees);
}

function stepSpring(value, velocity, target, dtSeconds, stiffness = 520, damping = 26) {
  const nextVelocity = (velocity + (target - value) * stiffness * dtSeconds) * Math.exp(-damping * dtSeconds);
  return {
    value: value + nextVelocity * dtSeconds,
    velocity: nextVelocity,
  };
}

function shadowForScale(scale) {
  const depth = clamp((scale - 0.6) / 0.7, 0, 1);
  const offset = mix(3, 14, depth);
  const blur = mix(8, 30, depth);
  const alpha = mix(0.24, 0.48, depth);
  return `drop-shadow(0 ${offset.toFixed(1)}px ${blur.toFixed(1)}px rgba(0, 0, 0, ${alpha.toFixed(2)}))`;
}

function rectsClose(first, second) {
  return (
    Math.abs(first.left - second.left) < 1 &&
    Math.abs(first.top - second.top) < 1 &&
    Math.abs(first.width - second.width) < 1 &&
    Math.abs(first.height - second.height) < 1
  );
}

export function calculateMascotGuideRect(playSurfaceRect, targetRect) {
  if (
    !playSurfaceRect ||
    !targetRect ||
    playSurfaceRect.width <= 0 ||
    playSurfaceRect.height <= 0 ||
    targetRect.width <= 0 ||
    targetRect.height <= 0
  ) {
    return null;
  }

  const rawSize = playSurfaceRect.height * GUIDE_HEIGHT_RATIO;
  const maxSize = Math.min(GUIDE_MAX_SIZE, playSurfaceRect.width, playSurfaceRect.height);
  let size = clamp(rawSize, Math.min(GUIDE_MIN_SIZE, maxSize), maxSize);
  const playRight = playSurfaceRect.left + playSurfaceRect.width;
  const playBottom = playSurfaceRect.top + playSurfaceRect.height;
  const targetRight = targetRect.left + targetRect.width;
  const rightSpace = playRight - targetRight - GUIDE_GAP;
  const leftSpace = targetRect.left - playSurfaceRect.left - GUIDE_GAP;
  const rightLeft = targetRight + GUIDE_GAP;
  const leftLeft = targetRect.left - GUIDE_GAP - size;
  const fitsRight = rightSpace >= size;
  const fitsLeft = leftSpace >= size;

  let left = rightLeft;
  let side = "right";
  if (!fitsRight && fitsLeft) {
    left = leftLeft;
    side = "left";
  } else if (!fitsRight && !fitsLeft) {
    if (leftSpace > rightSpace) {
      size = Math.min(size, Math.max(0, leftSpace));
      left = targetRect.left - GUIDE_GAP - size;
      side = "left";
    } else {
      size = Math.min(size, Math.max(0, rightSpace));
      left = rightLeft;
    }
  }

  if (size <= 0) {
    return null;
  }

  const targetCenterY = targetRect.top + targetRect.height / 2;
  const top = clamp(targetCenterY - size / 2, playSurfaceRect.top, playBottom - size);

  return {
    left,
    top,
    width: size,
    height: size,
    right: left + size,
    bottom: top + size,
    side,
  };
}

export class MascotAnimator {
  constructor(imageElement) {
    this.imageElement = imageElement;
    this.frames = new Map();
    this.mode = "stopped";
    this.clipName = "";
    this.frameIndex = 0;
    this.lastFrameAt = 0;
    this.animationFrame = 0;
    this.motionFrame = 0;
    this.motionMode = "";
    this.pendingLoop = "";
    this.preloadPromise = null;
    this.visualRect = null;
    this.currentGuideRect = null;
    this.flight = null;
    this.entrance = null;
    this.visualScale = 1;
    this.visualRotation = 0;
    this.nextGuideStartsOffscreen = false;
    this.celebrationStartedAt = 0;

    this.tick = this.tick.bind(this);
    this.tickFlight = this.tickFlight.bind(this);
    this.tickCelebration = this.tickCelebration.bind(this);
    this.tickEntrance = this.tickEntrance.bind(this);
  }

  preload() {
    if (this.preloadPromise) {
      return this.preloadPromise;
    }

    const loads = [];
    for (const [clipName, count] of Object.entries(CLIPS)) {
      const urls = [];
      for (let index = 0; index < count; index += 1) {
        const url = frameUrl(clipName, index);
        urls.push(url);
        loads.push(
          new Promise((resolve) => {
            const image = new Image();
            image.onload = resolve;
            image.onerror = resolve;
            image.src = url;
          })
        );
      }
      this.frames.set(clipName, urls);
    }

    this.preloadPromise = Promise.all(loads);
    return this.preloadPromise;
  }

  playRandomSuccess() {
    const clip = Math.random() < 0.5 ? "wave" : "thumbsup";
    this.playOnce(clip);
  }

  playOnce(clipName) {
    this.start(clipName, "once");
  }

  loop(clipName, options = {}) {
    this.start(clipName, "loop", options);
  }

  prepareLevelEntry() {
    this.nextGuideStartsOffscreen = true;
  }

  stopMotion(options = {}) {
    if (this.motionFrame) {
      cancelAnimationFrame(this.motionFrame);
      this.motionFrame = 0;
    }
    this.motionMode = "";
    this.flight = null;
    if (!options.keepEntrance) {
      this.entrance = null;
    }
    this.celebrationStartedAt = 0;
  }

  stop() {
    this.mode = "stopped";
    this.clipName = "";
    this.frameIndex = 0;
    this.lastFrameAt = 0;
    this.pendingLoop = "";
    if (this.animationFrame) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = 0;
    }
    this.stopMotion();
    this.imageElement.hidden = true;
    this.imageElement.removeAttribute("src");
    this.imageElement.classList.remove("is-guiding", "is-celebrating");
  }

  isEntranceActive() {
    return Boolean(this.entrance);
  }

  startEntrance(targetRect, options = {}) {
    if (!targetRect) {
      return false;
    }

    this.stopMotion();
    const guideRect = copyRect(targetRect);
    const reduced = prefersReducedMotion();

    this.currentGuideRect = guideRect;
    this.nextGuideStartsOffscreen = false;
    this.imageElement.classList.add("is-guiding");
    this.imageElement.classList.remove("is-celebrating");
    this.loop("idle", { force: true });

    this.entrance = {
      targetRect: guideRect,
      reduced,
      phase: reduced ? "fade" : "spiral",
      startedAt: 0,
      lastTickAt: 0,
      holdStartedAt: 0,
      speechStarted: false,
      rotation: 0,
      rotationVelocity: 0,
      onSpeechStart: options.onSpeechStart || null,
      onComplete: options.onComplete || null,
    };

    if (reduced) {
      this.motionMode = "entrance";
      this.applyBox(guideRect, 1, 0, { opacity: 0 });
      this.motionFrame = requestAnimationFrame(this.tickEntrance);
      return true;
    }

    const startCenter = this.entranceSpiralPoint(0, guideRect);
    this.motionMode = "entrance";
    this.applyBox(rectFromCenter(startCenter, guideRect.width, guideRect.height), 0.5, 0);
    this.motionFrame = requestAnimationFrame(this.tickEntrance);
    return true;
  }

  updateEntranceTarget(rect) {
    if (!this.entrance || !rect) {
      return false;
    }

    const targetRect = copyRect(rect);
    this.entrance.targetRect = targetRect;
    this.currentGuideRect = targetRect;

    if (this.entrance.reduced && this.entrance.phase === "hold") {
      this.applyBox(targetRect, 1, 0);
      return true;
    }

    if (this.entrance.phase === "exit" && this.motionMode === "flight" && this.flight) {
      const onComplete = this.flight.onComplete;
      this.startFlight(this.visualRect || targetRect, targetRect, {
        fromScale: this.visualScale,
        toScale: 1,
        scaleDelayMs: 80,
        preserveEntrance: true,
        onComplete,
      });
    }

    return true;
  }

  cancelEntrance(options = {}) {
    if (!this.entrance) {
      return false;
    }

    const targetRect = this.entrance.targetRect ? copyRect(this.entrance.targetRect) : null;
    this.stopMotion();

    if (options.snap && targetRect) {
      this.imageElement.classList.add("is-guiding");
      this.imageElement.classList.remove("is-celebrating");
      this.applyBox(targetRect, 1, 0);
      this.currentGuideRect = targetRect;
      this.loop("idle");
    }

    return true;
  }

  finishEntranceToGuide() {
    const entrance = this.entrance;
    if (!entrance) {
      return false;
    }

    const targetRect = copyRect(entrance.targetRect);
    const onComplete = entrance.onComplete;

    if (entrance.reduced) {
      this.applyBox(targetRect, 1, 0);
      this.stopMotion();
      this.currentGuideRect = targetRect;
      if (onComplete) {
        onComplete();
      }
      return true;
    }

    entrance.phase = "exit";
    if (this.motionFrame) {
      cancelAnimationFrame(this.motionFrame);
      this.motionFrame = 0;
    }

    this.startFlight(this.visualRect || targetRect, targetRect, {
      fromScale: this.visualScale || ENTRANCE_HOLD_SCALE,
      toScale: 1,
      scaleDelayMs: 80,
      preserveEntrance: true,
      onComplete: () => {
        this.entrance = null;
        this.currentGuideRect = targetRect;
        if (onComplete) {
          onComplete();
        }
      },
    });
    return true;
  }

  setGuideRect(rect, options = {}) {
    if (!rect) {
      return;
    }

    const targetRect = copyRect(rect);
    const shouldSnap = options.snap || prefersReducedMotion();

    this.imageElement.classList.add("is-guiding");
    this.imageElement.classList.remove("is-celebrating");

    if (shouldSnap) {
      this.stopMotion();
      this.nextGuideStartsOffscreen = false;
      this.applyBox(targetRect, 1, 0);
      this.currentGuideRect = targetRect;
      return;
    }

    const fromRect = this.flightStartRect(targetRect);
    if (!this.nextGuideStartsOffscreen && rectsClose(fromRect, targetRect)) {
      this.stopMotion();
      this.applyBox(targetRect, 1, 0);
      this.currentGuideRect = targetRect;
      return;
    }

    this.startFlight(fromRect, targetRect);
  }

  startCelebration() {
    this.stopMotion();
    this.currentGuideRect = null;
    this.nextGuideStartsOffscreen = false;
    this.imageElement.classList.remove("is-guiding");
    this.imageElement.classList.add("is-celebrating");
    this.loop("dance", { force: true });

    const size = this.celebrationSize();
    const center = {
      x: window.innerWidth - size * 0.75,
      y: window.innerHeight - size * 0.65,
    };
    this.applyBox(rectFromCenter(center, size, size), 1, 0);

    if (prefersReducedMotion()) {
      return;
    }

    this.motionMode = "celebration";
    this.celebrationStartedAt = 0;
    this.motionFrame = requestAnimationFrame(this.tickCelebration);
  }

  dock() {
    this.stopMotion();
    this.pendingLoop = "";
    this.visualRect = null;
    this.currentGuideRect = null;
    this.nextGuideStartsOffscreen = false;
    this.imageElement.classList.remove("is-guiding", "is-celebrating");
    this.imageElement.style.removeProperty("left");
    this.imageElement.style.removeProperty("top");
    this.imageElement.style.removeProperty("width");
    this.imageElement.style.removeProperty("height");
    this.imageElement.style.removeProperty("transform");
    this.imageElement.style.removeProperty("filter");
    this.imageElement.style.removeProperty("opacity");
  }

  flightStartRect(targetRect) {
    if (this.nextGuideStartsOffscreen) {
      const top = clamp(targetRect.top - Math.min(targetRect.height * 0.35, 72), 0, window.innerHeight - targetRect.height);
      return {
        left: window.innerWidth + targetRect.width * 0.45,
        top,
        width: targetRect.width,
        height: targetRect.height,
        right: window.innerWidth + targetRect.width * 1.45,
        bottom: top + targetRect.height,
      };
    }

    if (this.visualRect) {
      return copyRect(this.visualRect);
    }

    if (this.currentGuideRect) {
      return copyRect(this.currentGuideRect);
    }

    return copyRect(targetRect);
  }

  startFlight(fromRect, targetRect, options = {}) {
    this.stopMotion({ keepEntrance: options.preserveEntrance });

    const start = rectCenter(fromRect);
    const end = rectCenter(targetRect);
    const deltaX = end.x - start.x;
    const deltaY = end.y - start.y;
    const distance = Math.hypot(deltaX, deltaY);
    const unitX = distance > 0 ? deltaX / distance : 1;
    const unitY = distance > 0 ? deltaY / distance : 0;
    const durationMs = clamp(450 + distance * 0.45, 450, 900);
    const anticipationMs = clamp(distance * 0.08, 62, 88);
    const backoff = clamp(distance * 0.04, 8, 28);
    const anticipation = {
      x: start.x - unitX * backoff,
      y: start.y - unitY * backoff + clamp(distance * 0.012, 2, 9),
    };
    const arcHeight = clamp(distance * 0.24, 42, 180);
    const control = {
      x: (anticipation.x + end.x) / 2,
      y: Math.min(anticipation.y, end.y) - arcHeight,
    };

    this.nextGuideStartsOffscreen = false;
    this.currentGuideRect = copyRect(targetRect);
    this.flight = {
      fromRect: copyRect(fromRect),
      targetRect: copyRect(targetRect),
      start,
      anticipation,
      control,
      end,
      distance,
      durationMs,
      anticipationMs,
      mainMs: Math.max(1, durationMs - anticipationMs),
      startedAt: 0,
      fromScale: options.fromScale || 1,
      toScale: options.toScale || 1,
      scaleDelayMs: options.scaleDelayMs || 0,
      preserveEntrance: options.preserveEntrance || false,
      onComplete: options.onComplete || null,
    };

    this.motionMode = "flight";
    this.applyBox(fromRect, this.flight.fromScale, 0);
    this.imageElement.hidden = false;
    this.motionFrame = requestAnimationFrame(this.tickFlight);
  }

  applyBox(rect, scale, rotation, options = {}) {
    const safeScale = Number.isFinite(scale) ? scale : 1;
    const safeRotation = Number.isFinite(rotation) ? rotation : 0;
    const safeOpacity = Number.isFinite(options.opacity) ? clamp(options.opacity, 0, 1) : 1;

    this.visualRect = copyRect(rect);
    this.visualScale = safeScale;
    this.visualRotation = safeRotation;
    this.imageElement.style.left = `${rect.left}px`;
    this.imageElement.style.top = `${rect.top}px`;
    this.imageElement.style.width = `${rect.width}px`;
    this.imageElement.style.height = `${rect.height}px`;
    this.imageElement.style.opacity = safeOpacity.toFixed(3);
    this.imageElement.style.transform = `scale(${safeScale.toFixed(3)}) rotate(${safeRotation.toFixed(2)}deg)`;
    this.imageElement.style.filter = shadowForScale(safeScale);
  }

  celebrationSize() {
    return clamp(window.innerHeight * 0.2, 118, 236);
  }

  start(clipName, mode, options = {}) {
    const frames = this.frames.get(clipName);
    if (!frames || frames.length === 0) {
      return;
    }

    const force = options.force || (mode === "loop" && this.motionMode === "flight");
    if (this.mode === "once" && mode === "loop" && !force) {
      this.pendingLoop = clipName;
      this.imageElement.hidden = false;
      return;
    }

    if (this.mode === mode && this.clipName === clipName && this.animationFrame && !force) {
      this.pendingLoop = "";
      this.imageElement.hidden = false;
      return;
    }

    if (this.animationFrame) {
      cancelAnimationFrame(this.animationFrame);
    }

    this.mode = mode;
    this.clipName = clipName;
    this.frameIndex = 0;
    this.lastFrameAt = 0;
    this.pendingLoop = "";
    this.imageElement.src = frames[0];
    this.imageElement.hidden = false;
    this.animationFrame = requestAnimationFrame(this.tick);
  }

  tick(timestamp) {
    if (this.mode === "stopped") {
      return;
    }

    if (!this.lastFrameAt) {
      this.lastFrameAt = timestamp;
    }

    if (timestamp - this.lastFrameAt >= FRAME_MS) {
      this.lastFrameAt += FRAME_MS;
      this.frameIndex += 1;

      const frames = this.frames.get(this.clipName);
      if (this.frameIndex >= frames.length) {
        if (this.mode === "loop") {
          this.frameIndex = 0;
        } else {
          const pendingLoop = this.pendingLoop;
          if (pendingLoop) {
            this.pendingLoop = "";
            this.mode = "stopped";
            this.start(pendingLoop, "loop");
            return;
          }
          this.stop();
          return;
        }
      }
      this.imageElement.src = frames[this.frameIndex];
    }

    this.animationFrame = requestAnimationFrame(this.tick);
  }

  tickFlight(timestamp) {
    const flight = this.flight;
    if (!flight || this.motionMode !== "flight") {
      return;
    }

    if (!flight.startedAt) {
      flight.startedAt = timestamp;
    }

    const elapsed = timestamp - flight.startedAt;
    if (elapsed >= flight.durationMs) {
      const onComplete = flight.onComplete;
      const preserveEntrance = flight.preserveEntrance;
      this.applyBox(flight.targetRect, flight.toScale, 0);
      this.stopMotion({ keepEntrance: preserveEntrance });
      if (onComplete) {
        onComplete();
      }
      return;
    }

    let center = flight.start;
    let scale = flight.fromScale;
    let rotation = 0;
    let positionAmount = 0;

    if (elapsed < flight.anticipationMs) {
      const anticipationAmount = easeInCubic(clamp(elapsed / flight.anticipationMs, 0, 1));
      center = {
        x: mix(flight.start.x, flight.anticipation.x, anticipationAmount),
        y: mix(flight.start.y, flight.anticipation.y, anticipationAmount) - Math.sin(anticipationAmount * Math.PI) * 3,
      };
      scale = mix(flight.fromScale, flight.fromScale * 0.94, anticipationAmount);
      rotation = clamp(-((flight.end.x - flight.start.x) / Math.max(flight.distance, 1)) * 7 * anticipationAmount, -10, 10);
    } else {
      const rawAmount = clamp((elapsed - flight.anticipationMs) / flight.mainMs, 0, 1);
      positionAmount = easeInOutCubic(rawAmount);
      const transformAmount = easeOutCubic(clamp((elapsed - flight.anticipationMs) / Math.max(1, flight.mainMs - 84), 0, 1));
      const scaleAmount = easeOutCubic(
        clamp((elapsed - flight.anticipationMs - flight.scaleDelayMs) / Math.max(1, flight.mainMs - flight.scaleDelayMs), 0, 1)
      );
      center = quadraticPoint(flight.anticipation, flight.control, flight.end, positionAmount);

      const distanceFactor = clamp(flight.distance / 520, 0, 1);
      const awayDip = 0.15 * distanceFactor * Math.sin(positionAmount * Math.PI);
      const arrivalStart = Math.max(0, 1 - 120 / flight.mainMs);
      const arrivalAmount = clamp((rawAmount - arrivalStart) / Math.max(0.001, 1 - arrivalStart), 0, 1);
      const overshoot = arrivalAmount > 0 ? 0.06 * Math.sin(arrivalAmount * Math.PI) : 0;
      scale = mix(flight.fromScale, flight.toScale, scaleAmount) * (1 - awayDip + overshoot);
      if (rawAmount >= 0.995) {
        scale = flight.toScale;
      }

      const derivative = quadraticDerivative(flight.anticipation, flight.control, flight.end, positionAmount);
      const bank = clamp((derivative.x / Math.max(flight.distance, 1)) * 12, -12, 12);
      rotation = bank * Math.sin(transformAmount * Math.PI);
    }

    const width = mix(flight.fromRect.width, flight.targetRect.width, positionAmount);
    const height = mix(flight.fromRect.height, flight.targetRect.height, positionAmount);
    this.applyBox(rectFromCenter(center, width, height), scale, rotation);
    this.motionFrame = requestAnimationFrame(this.tickFlight);
  }

  entranceSpiralPoint(amount, targetRect) {
    const center = viewportCenter();
    const size = Math.max(targetRect.width, targetRect.height);
    const startRadius = Math.hypot(window.innerWidth / 2 + size * 0.95, window.innerHeight / 2 + size * 0.95);
    const angle = -Math.PI / 4 + ENTRANCE_SPIRAL_TURNS * Math.PI * 2 * easeInOutCubic(amount);
    const radius = startRadius * Math.exp(-1.65 * amount) * (1 - amount) ** 1.24;
    return {
      x: center.x + Math.cos(angle) * radius,
      y: center.y + Math.sin(angle) * radius,
    };
  }

  entranceHoldCenter(elapsed) {
    const center = viewportCenter();
    return {
      x: center.x + Math.sin(elapsed / 1900) * 4 + Math.sin(elapsed / 4100 + 1.2) * 2,
      y: center.y - 3 + Math.sin(elapsed / 780) * 4 + Math.sin(elapsed / 2300 + 0.8) * 1.5,
    };
  }

  startEntranceHold(timestamp) {
    const entrance = this.entrance;
    if (!entrance || entrance.speechStarted) {
      return;
    }

    entrance.phase = "hold";
    entrance.holdStartedAt = timestamp;
    entrance.speechStarted = true;
    entrance.rotationVelocity *= 0.35;
    if (entrance.onSpeechStart) {
      entrance.onSpeechStart();
    }
  }

  tickEntrance(timestamp) {
    const entrance = this.entrance;
    if (!entrance || this.motionMode !== "entrance") {
      return;
    }

    if (!entrance.startedAt) {
      entrance.startedAt = timestamp;
      entrance.lastTickAt = timestamp;
    }

    const elapsed = timestamp - entrance.startedAt;
    const dtSeconds = clamp((timestamp - entrance.lastTickAt) / 1000, 0.001, 0.05);
    entrance.lastTickAt = timestamp;

    if (entrance.reduced) {
      const fadeAmount = easeOutCubic(clamp(elapsed / ENTRANCE_REDUCED_FADE_MS, 0, 1));
      this.applyBox(entrance.targetRect, 1, 0, { opacity: fadeAmount });
      if (fadeAmount >= 1) {
        this.motionFrame = 0;
        this.startEntranceHold(timestamp);
        return;
      }
      this.motionFrame = requestAnimationFrame(this.tickEntrance);
      return;
    }

    const targetRect = entrance.targetRect;
    const center = viewportCenter();
    let currentCenter = center;
    let scale = ENTRANCE_HOLD_SCALE;
    let rotationTarget = 0;

    if (elapsed < ENTRANCE_SPIRAL_MS) {
      const amount = clamp(elapsed / ENTRANCE_SPIRAL_MS, 0, 1);
      currentCenter = this.entranceSpiralPoint(amount, targetRect);
      const before = this.entranceSpiralPoint(clamp(amount - 0.004, 0, 1), targetRect);
      const after = this.entranceSpiralPoint(clamp(amount + 0.004, 0, 1), targetRect);
      const settleOut = 1 - easeOutCubic(clamp((amount - 0.82) / 0.18, 0, 1));
      rotationTarget = bankFromVector(after.x - before.x, after.y - before.y) * settleOut;
      scale = mix(0.5, 1, easeOutCubic(amount));
    } else if (elapsed < ENTRANCE_SPIRAL_MS + ENTRANCE_PUSH_MS) {
      const amount = clamp((elapsed - ENTRANCE_SPIRAL_MS) / ENTRANCE_PUSH_MS, 0, 1);
      const pushPosition = easeOutCubic(amount);
      currentCenter = {
        x: center.x,
        y: center.y - mix(0, 10, pushPosition),
      };
      if (amount < 0.78) {
        scale = mix(1, ENTRANCE_PUSH_OVERSHOOT_SCALE, easeOutCubic(amount / 0.78));
      } else {
        scale = mix(ENTRANCE_PUSH_OVERSHOOT_SCALE, ENTRANCE_PUSH_SCALE, easeOutCubic((amount - 0.78) / 0.22));
      }
    } else if (elapsed < ENTRANCE_SPIRAL_MS + ENTRANCE_PUSH_MS + ENTRANCE_PULL_MS) {
      const pullElapsed = elapsed - ENTRANCE_SPIRAL_MS - ENTRANCE_PUSH_MS;
      const positionAmount = easeOutCubic(clamp(pullElapsed / Math.max(1, ENTRANCE_PULL_MS - 140), 0, 1));
      const scaleAmount = easeOutBack(clamp((pullElapsed - 80) / Math.max(1, ENTRANCE_PULL_MS - 80), 0, 1));
      currentCenter = {
        x: center.x,
        y: mix(center.y - 10, center.y - 3, positionAmount),
      };
      scale = mix(ENTRANCE_PUSH_SCALE, ENTRANCE_HOLD_SCALE, scaleAmount);
    } else {
      if (!entrance.speechStarted) {
        this.startEntranceHold(timestamp);
      }
      const holdElapsed = timestamp - entrance.holdStartedAt;
      currentCenter = this.entranceHoldCenter(holdElapsed);
      scale = ENTRANCE_HOLD_SCALE + Math.sin(holdElapsed / 680) * 0.016 + Math.sin(holdElapsed / 1700 + 0.4) * 0.007;
      rotationTarget = Math.sin(holdElapsed / 1200) * 1.2 + Math.sin(holdElapsed / 2600 + 0.9) * 0.5;
    }

    const rotationSpring = stepSpring(entrance.rotation, entrance.rotationVelocity, rotationTarget, dtSeconds);
    entrance.rotation = clamp(rotationSpring.value, -14, 14);
    entrance.rotationVelocity = rotationSpring.velocity;

    this.applyBox(rectFromCenter(currentCenter, targetRect.width, targetRect.height), scale, entrance.rotation);
    this.motionFrame = requestAnimationFrame(this.tickEntrance);
  }

  tickCelebration(timestamp) {
    if (this.motionMode !== "celebration") {
      return;
    }

    if (!this.celebrationStartedAt) {
      this.celebrationStartedAt = timestamp;
    }

    const elapsed = timestamp - this.celebrationStartedAt;
    const angle = (elapsed / CELEBRATION_LAP_MS) * Math.PI * 2;
    const size = this.celebrationSize();
    const centerX = window.innerWidth / 2;
    const centerY = window.innerHeight / 2;
    const amplitudeX = Math.max(0, window.innerWidth / 2 - size * 0.72);
    const amplitudeY = Math.max(0, window.innerHeight / 2 - size * 0.82);
    const center = {
      x: centerX + Math.sin(angle) * amplitudeX,
      y: centerY + Math.sin(angle * 2 + Math.PI / 5) * amplitudeY,
    };
    const scale = 0.95 + 0.35 * Math.sin(angle + Math.PI / 2.7);
    const velocityX = Math.cos(angle) * amplitudeX;
    const rotation = clamp((velocityX / Math.max(amplitudeX, 1)) * 12, -12, 12);

    this.applyBox(rectFromCenter(center, size, size), scale, rotation);
    this.motionFrame = requestAnimationFrame(this.tickCelebration);
  }
}
