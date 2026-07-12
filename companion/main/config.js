const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_CONFIG = Object.freeze({
  questPath: "../quests/snowman/quest.json",
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
  const fileConfig = loadJsonIfPresent(path.join(appRoot, "config.json"));
  const config = mergeConfig(DEFAULT_CONFIG, fileConfig);

  if (process.env.ANTHROPIC_API_KEY) {
    config.anthropicApiKey = process.env.ANTHROPIC_API_KEY;
  }
  if (process.env.ELEVENLABS_API_KEY) {
    config.elevenLabsApiKey = process.env.ELEVENLABS_API_KEY;
  }

  config.appRoot = appRoot;
  config.questPathResolved = resolveQuestPath(config, appRoot);
  return config;
}

module.exports = {
  DEFAULT_CONFIG,
  loadConfig,
  resolveQuestPath,
};
