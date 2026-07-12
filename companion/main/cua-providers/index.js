const { createAnthropicProvider } = require("./anthropic");
const { createOpenAiProvider } = require("./openai");

function providerNameFromConfig(config = {}) {
  return config.cua?.provider || "openai";
}

function createCuaProvider(options = {}) {
  const config = options.config || {};
  const providerName = providerNameFromConfig(config);
  if (providerName === "anthropic") {
    return createAnthropicProvider(options);
  }
  if (providerName === "openai") {
    return createOpenAiProvider(options);
  }
  throw new Error(`Unsupported CUA provider: ${providerName}`);
}

module.exports = {
  createCuaProvider,
  providerNameFromConfig,
};
