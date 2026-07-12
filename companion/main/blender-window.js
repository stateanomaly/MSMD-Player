const { execFile } = require("node:child_process");
const { EventEmitter } = require("node:events");

const BLENDER_BOUNDS_SCRIPT = String.raw`
ObjC.import("Foundation");
ObjC.import("CoreGraphics");
ObjC.bindFunction("CGWindowListCopyWindowInfo", ["@", ["I", "I"]]);

var kCGWindowListOptionOnScreenOnly = 1;
var kCGWindowListExcludeDesktopElements = 16;
var kCGNullWindowID = 0;
var windows = ObjC.deepUnwrap(
  $.CGWindowListCopyWindowInfo(
    kCGWindowListOptionOnScreenOnly | kCGWindowListExcludeDesktopElements,
    kCGNullWindowID
  )
) || [];
var best = null;

function numeric(value) {
  var number = Number(value);
  return isFinite(number) ? number : null;
}

for (var index = 0; index < windows.length; index += 1) {
  var entry = windows[index];
  if (!entry || entry.kCGWindowOwnerName !== "Blender" || numeric(entry.kCGWindowLayer) !== 0) {
    continue;
  }

  var bounds = entry.kCGWindowBounds || {};
  var x = numeric(bounds.X);
  var y = numeric(bounds.Y);
  var width = numeric(bounds.Width);
  var height = numeric(bounds.Height);
  if (x === null || y === null || width === null || height === null || width <= 0 || height <= 0) {
    continue;
  }

  var area = width * height;
  if (!best || area > best.area) {
    best = { x: x, y: y, w: width, h: height, area: area };
  }
}

console.log(
  best
    ? JSON.stringify({
        x: Math.round(best.x),
        y: Math.round(best.y),
        w: Math.round(best.w),
        h: Math.round(best.h),
      })
    : "null"
);
`.trim();

const SYSTEM_EVENTS_BOUNDS_SCRIPT =
  'tell application "System Events" to tell (first process whose name is "Blender") to get {position, size} of window 1';

function normalizeBounds(bounds) {
  if (!bounds || typeof bounds !== "object") {
    return null;
  }
  const x = Number(bounds.x);
  const y = Number(bounds.y);
  const width = Number(bounds.w ?? bounds.width);
  const height = Number(bounds.h ?? bounds.height);
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) {
    return null;
  }
  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height),
  };
}

function parseJsonBounds(stdout) {
  const text = String(stdout).trim();
  if (!text || text === "null") {
    return null;
  }
  return normalizeBounds(JSON.parse(text));
}

function parseSystemEventsBounds(stdout) {
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

function parseBounds(stdout) {
  const text = String(stdout).trim();
  if (!text || text === "null") {
    return null;
  }
  if (text.startsWith("{")) {
    return normalizeBounds(JSON.parse(text));
  }
  return parseSystemEventsBounds(stdout);
}

function probeErrorMessage(error, stderr) {
  return String(stderr || error?.message || error || "unknown error")
    .trim()
    .replace(/\s+/g, " ");
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

function addonWindowToElectronBounds(addonWindow, primaryHeight) {
  const source = normalizeBounds(addonWindow);
  const displayHeight = Number(primaryHeight);
  if (!source || !Number.isFinite(displayHeight) || displayHeight <= 0) {
    return null;
  }
  return normalizeBounds({
    x: source.x,
    y: displayHeight - (source.y + source.height),
    width: source.width,
    height: source.height,
  });
}

function boundsIntersect(a, b) {
  return Boolean(
    a &&
      b &&
      a.x < b.x + b.width &&
      a.x + a.width > b.x &&
      a.y < b.y + b.height &&
      a.y + a.height > b.y
  );
}

function boundsIntersectAnyDisplay(bounds, displays) {
  if (!Array.isArray(displays) || displays.length === 0) {
    return true;
  }
  return displays.some((display) => boundsIntersect(bounds, normalizeBounds(display.bounds || display)));
}

class BlenderWindowWatcher extends EventEmitter {
  constructor(options = {}) {
    super();
    this.pollMs = options.pollMs || 500;
    this.addonGeometryFreshMs = options.addonGeometryFreshMs || 5000;
    this.logger = options.logger || console;
    this.getScreenInfo =
      typeof options.getScreenInfo === "function"
        ? options.getScreenInfo
        : () => ({
            primaryHeight: options.primaryHeight,
            displays: options.displays || [],
          });
    this.timer = null;
    this.inFlight = false;
    this.lastBounds = null;
    this.startedAt = 0;
    this.lastAddonGeometryAt = 0;
    this.forceProbe = false;
    this.wasGone = false;
    this.loggedProbeError = false;
    this.loggedAddonBoundsOffscreen = false;
  }

  start() {
    if (this.timer) {
      return;
    }
    this.startedAt = Date.now();
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
    if (this.shouldSkipProbe()) {
      return;
    }
    if (this.inFlight) {
      return;
    }
    this.inFlight = true;
    execFile(
      "osascript",
      ["-l", "JavaScript", "-e", BLENDER_BOUNDS_SCRIPT],
      { timeout: 1200 },
      (error, stdout, stderr) => {
        if (error) {
          this.runSystemEventsFallback(probeErrorMessage(error, stderr));
          return;
        }

        let bounds = null;
        try {
          bounds = parseJsonBounds(stdout);
        } catch (parseError) {
          this.runSystemEventsFallback(probeErrorMessage(parseError));
          return;
        }

        this.inFlight = false;
        if (this.hasFreshAddonGeometry()) {
          return;
        }
        this.handleProbeResult(bounds);
      }
    );
  }

  runSystemEventsFallback(primaryError) {
    this.logProbeError(primaryError);
    execFile("osascript", ["-e", SYSTEM_EVENTS_BOUNDS_SCRIPT], { timeout: 1200 }, (error, stdout) => {
      this.inFlight = false;
      if (this.hasFreshAddonGeometry()) {
        return;
      }
      if (error) {
        this.handleProbeResult(null);
        return;
      }

      this.handleProbeResult(parseSystemEventsBounds(stdout));
    });
  }

  handleAddonWindow(addonWindow) {
    const screenInfo = this.getScreenInfo() || {};
    const primaryHeight =
      screenInfo.primaryHeight ??
      screenInfo.primaryDisplay?.bounds?.height ??
      screenInfo.primaryDisplayBounds?.height ??
      screenInfo.primaryBounds?.height;
    const bounds = addonWindowToElectronBounds(addonWindow, primaryHeight);
    if (!bounds) {
      return false;
    }
    if (!boundsIntersectAnyDisplay(bounds, screenInfo.displays)) {
      this.forceProbe = true;
      if (!this.loggedAddonBoundsOffscreen) {
        this.loggedAddonBoundsOffscreen = true;
        this.logger?.warn?.(
          `[guided] addon window bounds ${JSON.stringify(
            bounds
          )} did not intersect any display; falling back to window probe`
        );
      }
      return false;
    }

    this.lastAddonGeometryAt = Date.now();
    this.forceProbe = false;
    this.handleProbeResult(bounds);
    return true;
  }

  shouldSkipProbe(now = Date.now()) {
    if (this.forceProbe) {
      return false;
    }
    if (this.hasFreshAddonGeometry(now)) {
      return true;
    }
    return !this.lastAddonGeometryAt && this.startedAt && now - this.startedAt < this.addonGeometryFreshMs;
  }

  hasFreshAddonGeometry(now = Date.now()) {
    return Boolean(
      this.lastAddonGeometryAt && now - this.lastAddonGeometryAt <= this.addonGeometryFreshMs
    );
  }

  logProbeError(message) {
    if (this.loggedProbeError) {
      return;
    }
    this.loggedProbeError = true;
    this.logger?.warn?.(`[guided] window probe error: ${message}`);
  }

  handleProbeResult(bounds) {
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
  }
}

module.exports = {
  BLENDER_BOUNDS_SCRIPT,
  SYSTEM_EVENTS_BOUNDS_SCRIPT,
  BlenderWindowWatcher,
  addonWindowToElectronBounds,
  boundsIntersectAnyDisplay,
  parseBounds,
};
