const fs = require("node:fs");
const path = require("node:path");
const { DEFAULT_BLENDER_PATH } = require("./blender-launch");

const DEFAULT_CONFIG = Object.freeze({
  questPath: "../quests/snowman/quest.json",
  blenderPath: DEFAULT_BLENDER_PATH,
  autoLaunchBlender: true,
  cua: Object.freeze({
    enabled: false,
    model: "claude-opus-4-8",
    cooldownS: 30,
    maxPerStep: 3,
  }),
  anthropicApiKey: "",
  elevenLabsApiKey: "",
});

function mergeConfig(base, override) {
  const next = {
    ...base,
    ...(override || {}),
    cua: {
      ...(base.cua || {}),
      ...((override && override.cua) || {}),
    },
  };
  return next;
}

function loadJsonIfPresent(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  const raw = fs.readFileSync(filePath, "utf8");
  return JSON.parse(raw);
}

function companionRootFromHere() {
  return path.resolve(__dirname, "..");
}

function resolveQuestPath(config, appRoot = companionRootFromHere()) {
  const questPath = config.questPath || DEFAULT_CONFIG.questPath;
  return path.isAbsolute(questPath) ? questPath : path.resolve(appRoot, questPath);
}

function loadConfig(options = {}) {
  const appRoot = options.appRoot || companionRootFromHere();
  const isPackaged = Boolean(options.isPackaged);
  const resourcesPath = options.resourcesPath || process.resourcesPath || path.resolve(appRoot, "..");
  const userDataPath = options.userDataPath || appRoot;
  const configRoot = isPackaged ? userDataPath : appRoot;
  const configPath = path.join(configRoot, "config.json");
  const defaults = {
    ...DEFAULT_CONFIG,
    questPath: isPackaged
      ? path.join(resourcesPath, "quests", "snowman", "quest.json")
      : DEFAULT_CONFIG.questPath,
  };
  const fileConfig = loadJsonIfPresent(configPath);
  const config = mergeConfig(defaults, fileConfig);

  if (process.env.ANTHROPIC_API_KEY) {
    config.anthropicApiKey = process.env.ANTHROPIC_API_KEY;
  }
  if (process.env.ELEVENLABS_API_KEY) {
    config.elevenLabsApiKey = process.env.ELEVENLABS_API_KEY;
  }

  config.appRoot = appRoot;
  config.configPath = configPath;
  config.resourcesPath = resourcesPath;
  config.userDataPath = userDataPath;
  config.questPathResolved = resolveQuestPath(config, configRoot);
  return config;
}

module.exports = {
  DEFAULT_CONFIG,
  loadConfig,
  resolveQuestPath,
};
