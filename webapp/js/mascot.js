const FPS = 24;
const FRAME_MS = 1000 / FPS;
const CLIPS = {
  wave: 44,
  thumbsup: 38,
  dance: 80,
};

function frameUrl(clipName, index) {
  return `./assets/mascot/${clipName}/frame_${String(index).padStart(4, "0")}.png`;
}

export class MascotAnimator {
  constructor(imageElement) {
    this.imageElement = imageElement;
    this.frames = new Map();
    this.mode = "idle";
    this.clipName = "";
    this.frameIndex = 0;
    this.lastFrameAt = 0;
    this.animationFrame = 0;
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
    this.mode = "idle";
    this.clipName = "";
    this.frameIndex = 0;
    this.lastFrameAt = 0;
    if (this.animationFrame) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = 0;
    }
    this.imageElement.hidden = true;
    this.imageElement.removeAttribute("src");
  }

  start(clipName, mode) {
    const frames = this.frames.get(clipName);
    if (!frames || frames.length === 0) {
      return;
    }

    if (this.animationFrame) {
      cancelAnimationFrame(this.animationFrame);
    }

    this.mode = mode;
    this.clipName = clipName;
    this.frameIndex = 0;
    this.lastFrameAt = 0;
    this.imageElement.src = frames[0];
    this.imageElement.hidden = false;
    this.animationFrame = requestAnimationFrame(this.tick);
  }

  tick(timestamp) {
    if (this.mode === "idle") {
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
          this.stop();
          return;
        }
      }
      this.imageElement.src = frames[this.frameIndex];
    }

    this.animationFrame = requestAnimationFrame(this.tick);
  }
}
