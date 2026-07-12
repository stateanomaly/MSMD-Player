#!/usr/bin/env node

const os = require("node:os");
const path = require("node:path");
const {
  DEFAULT_CODEX_AUTH_PATH,
  getOauthAccessToken,
} = require("../main/cua-providers/openai-auth");
const { callOpenAiOauthAssessment } = require("../main/cua-providers/openai");

function defaultUserDataPath() {
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "MSMD Guided");
  }
  if (process.platform === "win32" && process.env.APPDATA) {
    return path.join(process.env.APPDATA, "MSMD Guided");
  }
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "MSMD Guided");
}

function parseArgs(argv) {
  const result = { userDataPath: "" };
  for (const arg of argv) {
    if (arg.startsWith("--user-data=")) {
      result.userDataPath = arg.slice("--user-data=".length);
    } else if (!arg.startsWith("-") && !result.userDataPath) {
      result.userDataPath = arg;
    }
  }
  return result;
}

function expiryLabel(expiresAt) {
  return Number.isFinite(expiresAt) ? new Date(expiresAt * 1000).toISOString() : "unknown";
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const userDataPath = path.resolve(args.userDataPath || defaultUserDataPath());
  const model = process.env.OPENAI_CUA_MODEL || "gpt-5.5";
  const config = {
    openaiApiKey: "",
    cua: {
      provider: "openai",
      openai: {
        auth: "oauth",
        model,
        codexAuthPath: process.env.CODEX_AUTH_PATH || DEFAULT_CODEX_AUTH_PATH,
      },
    },
  };

  const credentials = await getOauthAccessToken({ config, userDataPath });
  console.log(
    `[guided] OpenAI OAuth source=${credentials.source} expires=${expiryLabel(
      credentials.expiresAt
    )} account_id=${credentials.accountId ? "present" : "missing"}`
  );

  const result = await callOpenAiOauthAssessment({
    config,
    model,
    screenshotPng: null,
    systemPrompt:
      "Return one report_assessment JSON object with assessment, steer_line, and point. Use point null.",
    userDataPath,
    userText: "kid is on track, screenshot omitted",
  });

  console.log(JSON.stringify({ assessment: result.assessment }));
}

main().catch((error) => {
  console.error(`[guided] OpenAI OAuth smoke failed: ${error.message}`);
  process.exit(1);
});
