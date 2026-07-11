const FPS = 24;
const FRAME_MS = 1000 / FPS;
const GUIDE_HEIGHT_RATIO = 0.20;
const GUIDE_MIN_SIZE = 96;
const GUIDE_MAX_SIZE = 240;
const GUIDE_GAP = 10;
const CELEBRATION_LAP_MS = 6000;
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
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
    this.nextGuideStartsOffscreen = false;
    this.celebrationStartedAt = 0;

    this.tick = this.tick.bind(this);
    this.tickFlight = this.tickFlight.bind(this);
    this.tickCelebration = this.tickCelebration.bind(this);
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

  stopMotion() {
    if (this.motionFrame) {
      cancelAnimationFrame(this.motionFrame);
      this.motionFrame = 0;
    }
    this.motionMode = "";
    this.flight = null;
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

  startFlight(fromRect, targetRect) {
    this.stopMotion();

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
    };

    this.motionMode = "flight";
    this.applyBox(fromRect, 1, 0);
    this.imageElement.hidden = false;
    this.motionFrame = requestAnimationFrame(this.tickFlight);
  }

  applyBox(rect, scale, rotation) {
    const safeScale = Number.isFinite(scale) ? scale : 1;
    const safeRotation = Number.isFinite(rotation) ? rotation : 0;

    this.visualRect = copyRect(rect);
    this.imageElement.style.left = `${rect.left}px`;
    this.imageElement.style.top = `${rect.top}px`;
    this.imageElement.style.width = `${rect.width}px`;
    this.imageElement.style.height = `${rect.height}px`;
    this.imageElement.style.opacity = "1";
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
      this.applyBox(flight.targetRect, 1, 0);
      this.stopMotion();
      return;
    }

    let center = flight.start;
    let scale = 1;
    let rotation = 0;
    let positionAmount = 0;

    if (elapsed < flight.anticipationMs) {
      const anticipationAmount = easeInCubic(clamp(elapsed / flight.anticipationMs, 0, 1));
      center = {
        x: mix(flight.start.x, flight.anticipation.x, anticipationAmount),
        y: mix(flight.start.y, flight.anticipation.y, anticipationAmount) - Math.sin(anticipationAmount * Math.PI) * 3,
      };
      scale = mix(1, 0.94, anticipationAmount);
      rotation = clamp(-((flight.end.x - flight.start.x) / Math.max(flight.distance, 1)) * 7 * anticipationAmount, -10, 10);
    } else {
      const rawAmount = clamp((elapsed - flight.anticipationMs) / flight.mainMs, 0, 1);
      positionAmount = easeInOutCubic(rawAmount);
      const transformAmount = easeOutCubic(clamp((elapsed - flight.anticipationMs) / Math.max(1, flight.mainMs - 84), 0, 1));
      center = quadraticPoint(flight.anticipation, flight.control, flight.end, positionAmount);

      const distanceFactor = clamp(flight.distance / 520, 0, 1);
      const awayDip = 0.15 * distanceFactor * Math.sin(positionAmount * Math.PI);
      const arrivalStart = Math.max(0, 1 - 120 / flight.mainMs);
      const arrivalAmount = clamp((rawAmount - arrivalStart) / Math.max(0.001, 1 - arrivalStart), 0, 1);
      const overshoot = arrivalAmount > 0 ? 0.06 * Math.sin(arrivalAmount * Math.PI) : 0;
      scale = 1 - awayDip + overshoot;
      if (rawAmount >= 0.995) {
        scale = 1;
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
