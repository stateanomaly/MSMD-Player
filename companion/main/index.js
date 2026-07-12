const { app, BrowserWindow, ipcMain, dialog, screen, shell } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { spawn } = require("node:child_process");
const { loadConfig } = require("./config");
const { GuidedTcpClient } = require("./tcp-client");
const { BlenderWindowWatcher } = require("./blender-window");
const { launchBlender } = require("./blender-launch");
const { captureBlenderWindow } = require("./screenshot");
const { CuaController } = require("./cua");
const { hasOauthCredentials, signIn } = require("./cua-providers/openai-auth");
const { ElevenLabsTts } = require("./tts");
const { questLoadForWire } = require("./quest-wire");

app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

const APP_ROOT = path.resolve(__dirname, "..");
const TCP_PORT = Number(process.env.MSMD_GUIDED_PORT || 41797);
const FAKE_MODE = process.env.MSMD_FAKE_ADDON === "1";
const SMOKE = process.argv.includes("--smoke");
const CUA_DRY_RUN = process.argv.includes("--cua-dry-run");
const LOGIN_OPENAI = process.argv.includes("--login-openai");
const FAKE_BOUNDS = Object.freeze({ x: 100, y: 100, width: 1280, height: 800 });

let overlay = null;
let watcher = null;
let tcpClient = null;
let fakeAddon = null;
let cua = null;
let currentBounds = null;
let overlayBoundsApplied = null;
let currentStepIndex = 0;
let questForRenderer = null;
let questForWire = null;
let smokeTimer = null;
let spawnedBlender = null;
let blenderLaunchAttempted = false;
let addonHelloReceived = false;
let questFlowStarted = false;
let fatalShown = false;

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

function applyOverlayBounds(bounds) {
  if (!bounds) {
    return;
  }
  currentBounds = bounds;
  if (!overlay || overlay.isDestroyed()) {
    return;
  }
  if (sameBounds(bounds, overlayBoundsApplied)) {
    return;
  }
  overlay.setBounds(bounds);
  overlayBoundsApplied = { ...bounds };
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

function destroyOverlay() {
  if (overlay && !overlay.isDestroyed()) {
    overlay.hide();
    overlay.destroy();
  }
  overlay = null;
  overlayBoundsApplied = null;
}

function showFatalAndQuit(title, message) {
  if (fatalShown) {
    return;
  }
  fatalShown = true;
  destroyOverlay();
  console.error(message);
  dialog.showErrorBox(title, message);
  app.quit();
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
  overlayBoundsApplied = null;
  if (currentBounds) {
    applyOverlayBounds(currentBounds);
  }
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
  const total = (questForRenderer?.steps || []).length;
  console.log(`[guided] step_begin ${step.id} (${stepIndex + 1}/${total})`);
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
  addonHelloReceived = false;
  tcpClient = new GuidedTcpClient({
    port: TCP_PORT,
    logger: console,
  });

  tcpClient.on("connect", () => console.log("[guided] connected to addon socket"));
  tcpClient.on("disconnect", () => console.log("[guided] disconnected, retrying"));

  tcpClient.on("message", (message) => {
    cua?.handleMessage(message);
    if (message.type === "state_snapshot" && message.window) {
      watcher?.handleAddonWindow(message.window);
    }
    if (overlay && !overlay.isDestroyed()) {
      overlay.webContents.send("guided:event", message);
    }

    if (message.type === "hello") {
      if (message.role === "addon") {
        addonHelloReceived = true;
      }
      console.log(`[guided] addon hello blender=${message.blender_version}`);
    } else if (message.type === "quest_loaded") {
      console.log(`[guided] quest_loaded ok=${message.ok}`);
    } else if (message.type === "step_verified") {
      console.log(`[guided] step_verified ${message.step_id}`);
      const step = currentStep();
      if (!step || message.step_id !== step.id) {
        return;
      }
      const nextIndex = currentStepIndex + 1;
      if (nextIndex < (questForRenderer.steps || []).length) {
        beginStep(nextIndex);
      }
    } else if (message.type === "deviation") {
      console.log(`[guided] deviation ${message.op_id} severity=${message.severity}`);
    } else if (message.type === "wrong_state") {
      console.log(`[guided] wrong_state guard=${message.guard_step_id} op=${message.op_id}`);
    } else if (message.type === "wrong_state_cleared") {
      console.log(`[guided] wrong_state_cleared guard=${message.guard_step_id} op=${message.op_id || ""}`);
    } else if (message.type === "quest_complete") {
      console.log(`[guided] quest_complete ${message.quest_id}`);
    } else if (message.type === "error") {
      console.warn(`Addon error: ${message.message}`);
    }
  });

  tcpClient.connect();
}

function startQuestFlow() {
  if (questFlowStarted || !questForWire || !tcpClient) {
    return;
  }
  questFlowStarted = true;
  tcpClient.setQuestLoad(questForWire);
  tcpClient.setCurrentStepId(firstStepId());
  tcpClient.send("quest_load", questForWire);
  beginStep(0);
}

function getScreenInfo() {
  return {
    primaryHeight: screen.getPrimaryDisplay().bounds.height,
    displays: screen.getAllDisplays().map((display) => display.bounds),
  };
}

function startWindowTracking() {
  if (FAKE_MODE) {
    applyOverlayBounds(FAKE_BOUNDS);
    return;
  }
  watcher = new BlenderWindowWatcher({ logger: console, getScreenInfo });
  watcher.on("bounds", applyOverlayBounds);
  watcher.on("gone", hideOverlay);
  watcher.start();
}

function waitForAddonHello(timeoutMs) {
  if (addonHelloReceived) {
    return Promise.resolve(true);
  }
  if (!tcpClient) {
    return Promise.resolve(false);
  }
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok) => {
      if (done) {
        return;
      }
      done = true;
      clearTimeout(timer);
      tcpClient?.off("hello", onHello);
      resolve(ok);
    };
    const onHello = (message) => {
      if (!message || message.role === "addon") {
        addonHelloReceived = true;
        finish(true);
      }
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    timer.unref?.();
    tcpClient.once("hello", onHello);
  });
}

function spawnedBlenderIsAlive() {
  return Boolean(spawnedBlender && spawnedBlender.exitCode === null && !spawnedBlender.killed);
}

function showAddonUnreachable(config) {
  let message = `Couldn't reach the guided add-on.\n\nStart Blender with the MSMD Guided add-on enabled, or set blenderPath in config.json:\n${config.blenderPath}\n\nExpected a TCP hello on 127.0.0.1:${TCP_PORT}.`;
  if (spawnedBlenderIsAlive()) {
    message +=
      "\n\nBlender is still running, but the guided add-on did not accept the TCP connection within 45 seconds.";
  }
  showFatalAndQuit("Couldn't reach the guided add-on", message);
}

async function ensureBlenderAddon(config) {
  if (SMOKE && !FAKE_MODE) {
    return true;
  }

  const existingHello = await waitForAddonHello(3000);
  if (existingHello) {
    return true;
  }

  if (!FAKE_MODE && !blenderLaunchAttempted && config.autoLaunchBlender !== false) {
    blenderLaunchAttempted = true;
    console.log("[guided] launching Blender");
    spawnedBlender = launchBlender({ config, logger: console });
    spawnedBlender.once("exit", () => {
      console.log("[guided] Blender exited");
      app.quit();
    });
  }

  const reached = await waitForAddonHello(45000);
  if (!reached) {
    console.log("[guided] couldn't reach guided add-on");
    showAddonUnreachable(config);
    return false;
  }
  return true;
}

function usesOpenAiOauth(config) {
  return (
    (config.cua?.provider || "openai") === "openai" &&
    (config.cua?.openai?.auth || "oauth") === "oauth"
  );
}

async function maybePromptForOpenAiSignIn(config) {
  if (!config.cua?.enabled || CUA_DRY_RUN || !usesOpenAiOauth(config)) {
    return;
  }
  const userDataPath = app.getPath("userData");
  if (await hasOauthCredentials({ config, userDataPath })) {
    return;
  }
  const result = await dialog.showMessageBox({
    type: "question",
    buttons: ["Sign In", "Not Now"],
    defaultId: 0,
    cancelId: 1,
    title: "Sign in with ChatGPT",
    message: "Sign in with ChatGPT now?",
    detail: "Guided CUA uses OpenAI OAuth by default and stores app-owned tokens in the app data directory.",
  });
  if (result.response !== 0) {
    console.warn("[guided] OpenAI sign-in skipped; CUA OAuth credentials are not available");
    return;
  }
  await signIn({ shell, userDataPath });
  console.log("[guided] OpenAI sign-in complete");
}

async function startCua(config) {
  if (SMOKE || !questForRenderer || questForRenderer.error || !tcpClient) {
    return;
  }
  await maybePromptForOpenAiSignIn(config);
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
    userDataPath: app.getPath("userData"),
    captureScreenshot: () => captureBlenderWindow({ bounds: currentBounds, logger: console }),
  });
  cua.on("steer", (payload) => {
    console.log(`[guided] steer "${payload.steerLine}"`);
    overlay?.webContents.send("guided:steer", payload);
  });
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
  const config = loadConfig({
    appRoot: APP_ROOT,
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    userDataPath: app.getPath("userData"),
  });
  if (LOGIN_OPENAI) {
    await signIn({ shell, userDataPath: app.getPath("userData") });
    console.log("[guided] OpenAI sign-in complete");
    app.exit(0);
    return;
  }
  const loadedQuest = loadQuest(config);
  questForRenderer = loadedQuest.renderer;
  questForWire = loadedQuest.wire;
  if (questForRenderer?.error) {
    showFatalAndQuit("Quest file missing", questForRenderer.error.message);
    return;
  }

  ipcMain.handle("guided:quest-data", () => questForRenderer);
  const rendererReady = waitForRendererReady();

  startFakeAddon();
  if (SMOKE && !FAKE_MODE) {
    applyOverlayBounds(FAKE_BOUNDS);
  } else {
    startWindowTracking();
  }

  if (!(SMOKE && !FAKE_MODE)) {
    startTcp();
    const addonReady = await ensureBlenderAddon(config);
    if (!addonReady) {
      return;
    }
  }

  createOverlay();
  if (!(SMOKE && !FAKE_MODE)) {
    startQuestFlow();
    await startCua(config);
  }

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
  if (app.isReady()) {
    showFatalAndQuit("MSMD Guided Error", error?.stack || String(error));
    return;
  }
  app.exit(1);
});

app.on("before-quit", () => {
  app.isQuitting = true;
  stopAll();
});

app.on("window-all-closed", () => {
  app.quit();
});
