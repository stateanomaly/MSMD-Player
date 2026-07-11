const FPS = 24;
const FRAME_MS = 1000 / FPS;
const GUIDE_HEIGHT_RATIO = 0.20;
const GUIDE_MIN_SIZE = 96;
const GUIDE_MAX_SIZE = 240;
const GUIDE_GAP = 10;
const CLIPS = {
  idle: 48,
  wave: 40,
  thumbsup: 32,
  dance: 48,
};

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function frameUrl(clipName, index) {
  return `./assets/mascot/${clipName}/frame_${String(index).padStart(4, "0")}.png`;
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
    this.pendingLoop = "";
    this.preloadPromise = null;

    this.tick = this.tick.bind(this);
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

  loop(clipName) {
    this.start(clipName, "loop");
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
    this.imageElement.hidden = true;
    this.imageElement.removeAttribute("src");
  }

  setGuideRect(rect) {
    this.imageElement.classList.add("is-guiding");
    this.imageElement.style.left = `${rect.left}px`;
    this.imageElement.style.top = `${rect.top}px`;
    this.imageElement.style.width = `${rect.width}px`;
    this.imageElement.style.height = `${rect.height}px`;
  }

  dock() {
    this.pendingLoop = "";
    this.imageElement.classList.remove("is-guiding");
    this.imageElement.style.removeProperty("left");
    this.imageElement.style.removeProperty("top");
    this.imageElement.style.removeProperty("width");
    this.imageElement.style.removeProperty("height");
  }

  start(clipName, mode) {
    const frames = this.frames.get(clipName);
    if (!frames || frames.length === 0) {
      return;
    }

    if (this.mode === "once" && mode === "loop") {
      this.pendingLoop = clipName;
      this.imageElement.hidden = false;
      return;
    }

    if (this.mode === mode && this.clipName === clipName && this.animationFrame) {
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
}
