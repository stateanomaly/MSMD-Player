const { execFile } = require("node:child_process");
const { EventEmitter } = require("node:events");

const BLENDER_BOUNDS_SCRIPT =
  'tell application "System Events" to tell (first process whose name is "Blender") to get {position, size} of window 1';

function parseBounds(stdout) {
  const values = String(stdout)
    .match(/-?\d+(?:\.\d+)?/g)
    ?.map(Number);
  if (!values || values.length < 4 || values.some((value) => !Number.isFinite(value))) {
    return null;
  }
  const [x, y, width, height] = values;
  if (width <= 0 || height <= 0) {
    return null;
  }
  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height),
  };
}

function sameBounds(a, b) {
  return Boolean(
    a &&
      b &&
      a.x === b.x &&
      a.y === b.y &&
      a.width === b.width &&
      a.height === b.height
  );
}

class BlenderWindowWatcher extends EventEmitter {
  constructor(options = {}) {
    super();
    this.pollMs = options.pollMs || 500;
    this.logger = options.logger || console;
    this.timer = null;
    this.inFlight = false;
    this.lastBounds = null;
    this.wasGone = false;
  }

  start() {
    if (this.timer) {
      return;
    }
    this.poll();
    this.timer = setInterval(() => this.poll(), this.pollMs);
    this.timer.unref?.();
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  poll() {
    if (this.inFlight) {
      return;
    }
    this.inFlight = true;
    execFile("osascript", ["-e", BLENDER_BOUNDS_SCRIPT], { timeout: 1200 }, (error, stdout) => {
      this.inFlight = false;
      if (error) {
        if (!this.wasGone || this.lastBounds) {
          this.wasGone = true;
          this.lastBounds = null;
          this.emit("gone");
        }
        return;
      }

      const bounds = parseBounds(stdout);
      if (!bounds) {
        if (!this.wasGone || this.lastBounds) {
          this.wasGone = true;
          this.lastBounds = null;
          this.emit("gone");
        }
        return;
      }

      this.wasGone = false;
      if (!sameBounds(bounds, this.lastBounds)) {
        this.lastBounds = bounds;
        this.emit("bounds", bounds);
      }
    });
  }
}

module.exports = {
  BLENDER_BOUNDS_SCRIPT,
  BlenderWindowWatcher,
  parseBounds,
};
