const { app, BrowserWindow, ipcMain } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { spawn } = require("node:child_process");
const { loadConfig } = require("./config");
const { GuidedTcpClient } = require("./tcp-client");
const { BlenderWindowWatcher } = require("./blender-window");
const { captureBlenderWindow } = require("./screenshot");
const { CuaController } = require("./cua");
const { ElevenLabsTts } = require("./tts");

app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

const APP_ROOT = path.resolve(__dirname, "..");
const TCP_PORT = Number(process.env.MSMD_GUIDED_PORT || 41797);
const FAKE_MODE = process.env.MSMD_FAKE_ADDON === "1";
const SMOKE = process.argv.includes("--smoke");
const CUA_DRY_RUN = process.argv.includes("--cua-dry-run");
const FAKE_BOUNDS = Object.freeze({ x: 100, y: 100, width: 1280, height: 800 });

let overlay = null;
let watcher = null;
let tcpClient = null;
let fakeAddon = null;
let cua = null;
let currentBounds = null;
let currentStepIndex = 0;
let questForRenderer = null;
let questForWire = null;
let smokeTimer = null;

function inlineFakeQuest() {
  return {
    schema: 2,
    id: "fake-guided-demo",
    title: "Guided Mode Demo",
    voice: "Mtmp3KhFIjYpWYRycDe3",
    harmless_ops: ["view3d.*", "screen.*", "outliner.*", "ed.undo", "object.select_all"],
    steps: [
      {
        id: "s0",
        narration_text: "Delete the default cube.",
        goal: "Delete the default cube",
        target: { kind: "window_norm", x: 0.5, y: 0.55 },
        check: { op: "object.delete" },
        timeout_s: 45,
      },
      {
        id: "s1",
        narration_text: "Add a round snowball.",
        goal: "Add a UV sphere for the snowman body",
        target: { kind: "window_norm", x: 0.36, y: 0.48 },
        check: { op: "mesh.primitive_uv_sphere_add" },
        timeout_s: 45,
      },
      {
        id: "s2",
        narration_text: "Great. Put one more snowball on top.",
        goal: "Add a smaller UV sphere for the snowman head",
        target: { kind: "window_norm", x: 0.54, y: 0.38 },
        check: { op: "mesh.primitive_uv_sphere_add" },
        timeout_s: 45,
      },
    ],
  };
}

function questLoadForWire(quest) {
  return {
    quest_id: quest.id,
    harmless_ops: Array.isArray(quest.harmless_ops) ? quest.harmless_ops : [],
    steps: (Array.isArray(quest.steps) ? quest.steps : []).map((step) => ({
      id: step.id,
      check: step.check || {},
    })),
  };
}

function loadQuest(config) {
  if (FAKE_MODE) {
    const quest = inlineFakeQuest();
    return {
      renderer: quest,
      wire: questLoadForWire(quest),
    };
  }

  const questPath = config.questPathResolved;
  if (!fs.existsSync(questPath)) {
    return {
      renderer: {
        error: {
          message: `Quest file is missing:\n${questPath}\n\nCreate companion/config.json or author the quest before running against Blender.`,
          path: questPath,
        },
      },
      wire: null,
    };
  }

  const quest = JSON.parse(fs.readFileSync(questPath, "utf8"));
  const questDir = path.dirname(questPath);
  const rendererQuest = {
    ...quest,
    steps: (Array.isArray(quest.steps) ? quest.steps : []).map((step) => ({
      ...step,
      narrationUrl: step.narration ? pathToFileURL(path.resolve(questDir, step.narration)).toString() : "",
    })),
  };
  return {
    renderer: rendererQuest,
    wire: questLoadForWire(quest),
  };
}

function currentStep() {
  const steps = questForRenderer?.steps || [];
  return steps[currentStepIndex] || null;
}

function firstStepId() {
  return questForWire?.steps?.[0]?.id || "";
}

function applyOverlayBounds(bounds) {
  currentBounds = bounds;
  if (!overlay || overlay.isDestroyed()) {
    return;
  }
  overlay.setBounds(bounds);
  overlay.webContents.send("guided:bounds", bounds);
  if (!SMOKE && !overlay.isVisible()) {
    overlay.showInactive();
  }
}

function hideOverlay() {
  if (!overlay || overlay.isDestroyed()) {
    return;
  }
  overlay.hide();
}

function createOverlay() {
  overlay = new BrowserWindow({
    transparent: true,
    frame: false,
    hasShadow: false,
    resizable: false,
    focusable: false,
    skipTaskbar: true,
    show: false,
    webPreferences: {
      preload: path.join(APP_ROOT, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  overlay.setAlwaysOnTop(true, "screen-saver");
  overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  overlay.setIgnoreMouseEvents(true);
  overlay.loadFile(path.join(APP_ROOT, "renderer", "index.html"));
  return overlay;
}

function startFakeAddon() {
  if (!FAKE_MODE) {
    return;
  }
  const script = path.join(APP_ROOT, "test", "fake-addon.js");
  fakeAddon = spawn(process.execPath, [script, String(TCP_PORT), "--demo"], {
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      MSMD_FAKE_ADDON_DEMO: "1",
    },
  });
  fakeAddon.stdout.on("data", (chunk) => process.stdout.write(`[fake-addon] ${chunk}`));
  fakeAddon.stderr.on("data", (chunk) => process.stderr.write(`[fake-addon] ${chunk}`));
  fakeAddon.on("exit", (code) => {
    if (!app.isQuitting) {
      console.warn(`fake-addon exited with code ${code}`);
    }
  });
}

function beginStep(stepIndex, options = {}) {
  currentStepIndex = stepIndex;
  const step = currentStep();
  if (!step) {
    return;
  }
  cua?.beginStep(step);
  if (!options.skipSend) {
    tcpClient?.beginStep(step.id);
  } else {
    tcpClient?.setCurrentStepId(step.id);
  }
}

function startTcp() {
  if (!questForWire) {
    return;
  }
  tcpClient = new GuidedTcpClient({
    port: TCP_PORT,
    logger: console,
  });
  tcpClient.setQuestLoad(questForWire);
  tcpClient.setCurrentStepId(firstStepId());

  tcpClient.on("message", (message) => {
    cua?.handleMessage(message);
    if (overlay && !overlay.isDestroyed()) {
      overlay.webContents.send("guided:event", message);
    }

    if (message.type === "step_verified") {
      const step = currentStep();
      if (!step || message.step_id !== step.id) {
        return;
      }
      const nextIndex = currentStepIndex + 1;
      if (nextIndex < (questForRenderer.steps || []).length) {
        beginStep(nextIndex);
      }
    } else if (message.type === "error") {
      console.warn(`Addon error: ${message.message}`);
    }
  });

  beginStep(0, { skipSend: true });
  tcpClient.connect();
}

function startWindowTracking() {
  if (FAKE_MODE) {
    applyOverlayBounds(FAKE_BOUNDS);
    return;
  }
  watcher = new BlenderWindowWatcher({ logger: console });
  watcher.on("bounds", applyOverlayBounds);
  watcher.on("gone", hideOverlay);
  watcher.start();
}

function startCua(config) {
  if (!questForRenderer || questForRenderer.error || !tcpClient) {
    return;
  }
  const tts = new ElevenLabsTts({
    apiKey: config.elevenLabsApiKey,
    userDataPath: app.getPath("userData"),
    logger: console,
  });
  cua = new CuaController({
    config,
    quest: questForRenderer,
    tcpClient,
    tts,
    dryRun: CUA_DRY_RUN,
    logger: console,
    captureScreenshot: () => captureBlenderWindow({ bounds: currentBounds, logger: console }),
  });
  cua.on("steer", (payload) => overlay?.webContents.send("guided:steer", payload));
  cua.on("replay_narration", ({ stepId }) => {
    overlay?.webContents.send("guided:event", { type: "replay_narration", step_id: stepId });
  });
  const step = currentStep();
  if (step) {
    cua.beginStep(step);
  }
}

function waitForRendererReady() {
  return new Promise((resolve) => {
    ipcMain.once("guided:ready", () => resolve());
  });
}

function stopAll() {
  watcher?.stop();
  watcher = null;
  cua?.stop();
  cua = null;
  tcpClient?.stop();
  tcpClient = null;
  if (fakeAddon && fakeAddon.exitCode === null) {
    fakeAddon.kill("SIGTERM");
  }
  fakeAddon = null;
  if (smokeTimer) {
    clearTimeout(smokeTimer);
    smokeTimer = null;
  }
}

async function main() {
  const config = loadConfig({ appRoot: APP_ROOT });
  const loadedQuest = loadQuest(config);
  questForRenderer = loadedQuest.renderer;
  questForWire = loadedQuest.wire;

  ipcMain.handle("guided:quest-data", () => questForRenderer);
  const rendererReady = waitForRendererReady();

  startFakeAddon();
  createOverlay();
  startWindowTracking();
  startTcp();
  startCua(config);

  if (SMOKE) {
    smokeTimer = setTimeout(() => {
      console.error("SMOKE timed out waiting for renderer ready");
      app.exit(1);
    }, 20000);
    await rendererReady;
    console.log("SMOKE OK");
    stopAll();
    app.exit(0);
  }
}

app.whenReady().then(main).catch((error) => {
  console.error(error);
  app.exit(1);
});

app.on("before-quit", () => {
  app.isQuitting = true;
  stopAll();
});

app.on("window-all-closed", () => {
  app.quit();
});
