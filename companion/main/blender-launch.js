const path = require("node:path");
const { spawn } = require("node:child_process");
const { app } = require("electron");

const DEFAULT_BLENDER_PATH = "/Applications/Blender.app/Contents/MacOS/Blender";

function repoRootFromHere() {
  return path.resolve(__dirname, "..", "..");
}

function resolveBootstrapPath(options = {}) {
  const isPackaged = options.isPackaged ?? app?.isPackaged;
  if (isPackaged) {
    const resourcesPath = options.resourcesPath || process.resourcesPath;
    return path.join(resourcesPath, "addon", "dev_bootstrap.py");
  }
  return path.join(options.repoRoot || repoRootFromHere(), "addon", "dev_bootstrap.py");
}

function launchBlender({ config = {}, logger = console } = {}) {
  const blenderPath = config.blenderPath || DEFAULT_BLENDER_PATH;
  const bootstrapPath = resolveBootstrapPath();
  const child = spawn(blenderPath, ["--python", bootstrapPath], {
    detached: false,
    stdio: "ignore",
  });
  child.on("error", (error) => {
    logger.warn?.(`[guided] Blender launch failed: ${error.message}`);
  });
  return child;
}

module.exports = {
  DEFAULT_BLENDER_PATH,
  launchBlender,
  resolveBootstrapPath,
};
