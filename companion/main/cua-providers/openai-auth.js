const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { URL } = require("node:url");

const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const AUTHORIZE_URL = "https://auth.openai.com/oauth/authorize";
const TOKEN_URL = "https://auth.openai.com/oauth/token";
const REDIRECT_URI = "http://localhost:1455/auth/callback";
const DEFAULT_CODEX_AUTH_PATH = "~/.codex/auth.json";
const EXPIRY_SKEW_SECONDS = 60;

function nowSeconds() {
  return Date.now() / 1000;
}

function getFetch(fetchImpl) {
  const impl = fetchImpl || globalThis.fetch;
  if (typeof impl !== "function") {
    throw new Error("fetch is required for OpenAI auth");
  }
  return impl;
}

function base64UrlEncode(input) {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input);
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeBase64Url(value) {
  const input = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = input + "=".repeat((4 - (input.length % 4)) % 4);
  return Buffer.from(padded, "base64");
}

function decodeJwtPayload(token) {
  if (typeof token !== "string") {
    return null;
  }
  const parts = token.split(".");
  if (parts.length < 2 || !parts[1]) {
    return null;
  }
  try {
    return JSON.parse(decodeBase64Url(parts[1]).toString("utf8"));
  } catch {
    return null;
  }
}

function getJwtExp(token) {
  const exp = Number(decodeJwtPayload(token)?.exp);
  return Number.isFinite(exp) ? exp : null;
}

function isAccessTokenExpired(accessToken, referenceSeconds = nowSeconds(), skewSeconds = EXPIRY_SKEW_SECONDS) {
  const exp = getJwtExp(accessToken);
  if (!Number.isFinite(exp)) {
    return true;
  }
  return exp <= referenceSeconds + skewSeconds;
}

function expandHome(filePath, homeDir = os.homedir()) {
  if (!filePath) {
    return "";
  }
  if (filePath === "~") {
    return homeDir;
  }
  if (filePath.startsWith("~/")) {
    return path.join(homeDir, filePath.slice(2));
  }
  return filePath;
}

function getAppOauthPath(userDataPath) {
  return userDataPath ? path.join(userDataPath, "openai-oauth.json") : "";
}

function codexAuthPathFromConfig(config = {}) {
  return expandHome(config.cua?.openai?.codexAuthPath || DEFAULT_CODEX_AUTH_PATH);
}

async function readJsonIfPresent(filePath) {
  if (!filePath) {
    return null;
  }
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return null;
    }
    throw new Error(`Failed to read OpenAI auth file at ${filePath}: ${error.message}`);
  }
}

function extractAccountId(tokens = {}) {
  if (typeof tokens.account_id === "string" && tokens.account_id) {
    return tokens.account_id;
  }
  const authClaim = decodeJwtPayload(tokens.id_token)?.["https://api.openai.com/auth"];
  const accountId = authClaim?.chatgpt_account_id;
  return typeof accountId === "string" && accountId ? accountId : "";
}

function normalizeTokens(record) {
  const rawTokens =
    record && typeof record === "object" && record.tokens && typeof record.tokens === "object"
      ? record.tokens
      : record;
  if (!rawTokens || typeof rawTokens !== "object") {
    return null;
  }
  const tokens = { ...rawTokens };
  for (const key of ["access_token", "refresh_token", "id_token", "account_id"]) {
    if (tokens[key] !== undefined && typeof tokens[key] !== "string") {
      delete tokens[key];
    }
  }
  if (!tokens.access_token && !tokens.refresh_token) {
    return null;
  }
  const accountId = extractAccountId(tokens);
  if (accountId) {
    tokens.account_id = accountId;
  }
  return tokens;
}

function sourceFromRecord(record, source, filePath) {
  const tokens = normalizeTokens(record);
  if (!tokens) {
    return null;
  }
  return {
    source,
    path: filePath,
    tokens,
    accountId: extractAccountId(tokens),
    expiresAt: getJwtExp(tokens.access_token),
  };
}

async function readAppTokenSource(userDataPath) {
  const filePath = getAppOauthPath(userDataPath);
  const record = await readJsonIfPresent(filePath);
  return sourceFromRecord(record, "app", filePath);
}

async function readCodexTokenSource(options = {}) {
  const filePath = expandHome(options.codexAuthPath || codexAuthPathFromConfig(options.config));
  const record = await readJsonIfPresent(filePath);
  return sourceFromRecord(record, "codex", filePath);
}

async function loadOauthTokenSource(options = {}) {
  const appSource = await readAppTokenSource(options.userDataPath);
  if (appSource) {
    return appSource;
  }
  return readCodexTokenSource(options);
}

async function hasOauthCredentials(options = {}) {
  return Boolean(await loadOauthTokenSource(options));
}

function isRealApiKey(value) {
  return typeof value === "string" && value.trim().length > 20;
}

async function resolveOpenAiApiKey(options = {}) {
  const env = options.env || process.env;
  if (isRealApiKey(env.OPENAI_API_KEY)) {
    return { apiKey: env.OPENAI_API_KEY, source: "env" };
  }
  if (isRealApiKey(options.config?.openaiApiKey)) {
    return { apiKey: options.config.openaiApiKey, source: "config" };
  }
  const codexPath = expandHome(options.codexAuthPath || codexAuthPathFromConfig(options.config));
  const codexAuth = await readJsonIfPresent(codexPath);
  if (isRealApiKey(codexAuth?.OPENAI_API_KEY)) {
    return { apiKey: codexAuth.OPENAI_API_KEY, source: "codex" };
  }
  return { apiKey: "", source: "none" };
}

function mergeTokenResponse(previousTokens, responseBody) {
  const tokens = {
    ...(previousTokens || {}),
    ...(responseBody || {}),
  };
  if (!tokens.refresh_token && previousTokens?.refresh_token) {
    tokens.refresh_token = previousTokens.refresh_token;
  }
  const accountId = extractAccountId(tokens);
  if (accountId) {
    tokens.account_id = accountId;
  }
  return normalizeTokens(tokens);
}

async function safeJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function persistOauthTokens(options = {}) {
  const filePath = getAppOauthPath(options.userDataPath);
  if (!filePath) {
    throw new Error("userDataPath is required to store OpenAI OAuth tokens");
  }
  const tokens = normalizeTokens(options.tokens);
  if (!tokens) {
    throw new Error("OpenAI OAuth token response did not include usable tokens");
  }
  const record = {
    auth_mode: "chatgpt-oauth",
    tokens,
    last_refresh: Math.floor(options.lastRefresh || nowSeconds()),
  };
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
  try {
    await fs.chmod(filePath, 0o600);
  } catch {
    // chmod is best-effort on non-POSIX filesystems.
  }
  return sourceFromRecord(record, "app", filePath);
}

async function refreshOauthTokens(options = {}) {
  const fetchImpl = getFetch(options.fetchImpl);
  const previousTokens = options.tokens || {};
  if (!previousTokens.refresh_token) {
    throw new Error("OpenAI OAuth refresh token is missing");
  }
  const response = await fetchImpl(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      grant_type: "refresh_token",
      refresh_token: previousTokens.refresh_token,
      client_id: CLIENT_ID,
      scope: "openid profile email",
    }),
  });
  if (!response.ok) {
    throw new Error(`OpenAI OAuth refresh failed with HTTP ${response.status}`);
  }
  const responseBody = await safeJson(response);
  const tokens = mergeTokenResponse(previousTokens, responseBody);
  if (!tokens?.access_token) {
    throw new Error("OpenAI OAuth refresh response did not include an access token");
  }
  return persistOauthTokens({
    userDataPath: options.userDataPath,
    tokens,
  });
}

function credentialsFromSource(source, referenceSeconds = nowSeconds()) {
  return {
    accessToken: source.tokens.access_token || "",
    accountId: source.accountId || extractAccountId(source.tokens),
    expiresAt: source.expiresAt,
    expired: isAccessTokenExpired(source.tokens.access_token, referenceSeconds),
    refreshTokenPresent: Boolean(source.tokens.refresh_token),
    source: source.source,
  };
}

async function getOauthAccessToken(options = {}) {
  const referenceSeconds = options.referenceSeconds || nowSeconds();
  const source = await loadOauthTokenSource(options);
  if (!source) {
    throw new Error(
      "OpenAI OAuth credentials were not found; run `npx electron . --login-openai` or sign in with Codex CLI"
    );
  }

  if (!options.forceRefresh && !isAccessTokenExpired(source.tokens.access_token, referenceSeconds)) {
    return credentialsFromSource(source, referenceSeconds);
  }

  try {
    const refreshed = await refreshOauthTokens({
      tokens: source.tokens,
      userDataPath: options.userDataPath,
      fetchImpl: options.fetchImpl,
    });
    return credentialsFromSource(refreshed, referenceSeconds);
  } catch (firstError) {
    const codexSource = await readCodexTokenSource(options);
    if (codexSource) {
      if (!options.forceRefresh && !isAccessTokenExpired(codexSource.tokens.access_token, referenceSeconds)) {
        return credentialsFromSource(codexSource, referenceSeconds);
      }
      try {
        const refreshed = await refreshOauthTokens({
          tokens: codexSource.tokens,
          userDataPath: options.userDataPath,
          fetchImpl: options.fetchImpl,
        });
        return credentialsFromSource(refreshed, referenceSeconds);
      } catch {
        // Fall through to the clear, value-free error below.
      }
    }
    throw new Error(
      `OpenAI OAuth token refresh failed; run \`npx electron . --login-openai\` to sign in again (${firstError.message})`
    );
  }
}

function pkceChallengeForVerifier(verifier) {
  return base64UrlEncode(crypto.createHash("sha256").update(verifier).digest());
}

function generatePkcePair() {
  const codeVerifier = base64UrlEncode(crypto.randomBytes(32));
  return {
    codeVerifier,
    codeChallenge: pkceChallengeForVerifier(codeVerifier),
  };
}

function buildAuthorizeUrl(options = {}) {
  const params = [
    ["response_type", "code"],
    ["client_id", CLIENT_ID],
    ["redirect_uri", REDIRECT_URI],
    ["scope", "openid profile email offline_access"],
    ["code_challenge", options.codeChallenge],
    ["code_challenge_method", "S256"],
    ["state", options.state],
    ["id_token_add_organizations", "true"],
    ["codex_cli_simplified_flow", "true"],
  ];
  return `${AUTHORIZE_URL}?${params
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&")}`;
}

async function exchangeAuthorizationCode(options = {}) {
  const fetchImpl = getFetch(options.fetchImpl);
  const response = await fetchImpl(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      grant_type: "authorization_code",
      code: options.code,
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      code_verifier: options.codeVerifier,
    }),
  });
  if (!response.ok) {
    throw new Error(`OpenAI OAuth code exchange failed with HTTP ${response.status}`);
  }
  const responseBody = await safeJson(response);
  const tokens = mergeTokenResponse(null, responseBody);
  if (!tokens?.access_token) {
    throw new Error("OpenAI OAuth code exchange response did not include an access token");
  }
  return persistOauthTokens({
    userDataPath: options.userDataPath,
    tokens,
  });
}

function resolveOpenExternal(options = {}) {
  if (typeof options.openExternal === "function") {
    return options.openExternal;
  }
  if (typeof options.shell?.openExternal === "function") {
    return options.shell.openExternal.bind(options.shell);
  }
  try {
    const electron = require("electron");
    if (typeof electron.shell?.openExternal === "function") {
      return electron.shell.openExternal.bind(electron.shell);
    }
  } catch {
    // Standalone node diagnostics cannot launch Electron's shell.
  }
  throw new Error("Electron shell.openExternal is required for OpenAI sign-in");
}

function listen(server, port) {
  return new Promise((resolve, reject) => {
    const onError = (error) => reject(error);
    server.once("error", onError);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", onError);
      resolve();
    });
  });
}

function closeServer(server) {
  return new Promise((resolve) => {
    if (!server.listening) {
      resolve();
      return;
    }
    server.close(() => resolve());
  });
}

function sendHtml(response, statusCode, body) {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "text/html; charset=utf-8");
  response.end(`<!doctype html><html><body><p>${body}</p></body></html>`);
}

async function signIn(options = {}) {
  const userDataPath = options.userDataPath;
  if (!userDataPath) {
    throw new Error("userDataPath is required for OpenAI sign-in");
  }
  const fetchImpl = getFetch(options.fetchImpl);
  const openExternal = resolveOpenExternal(options);
  const pkce = options.pkce || generatePkcePair();
  const state = options.state || base64UrlEncode(crypto.randomBytes(24));
  const timeoutMs = Number(options.timeoutMs || 5 * 60 * 1000);
  const port = Number(options.port || 1455);
  const server = http.createServer();

  let settled = false;
  const finish = async (resolve, reject, value, isError = false) => {
    if (settled) {
      return;
    }
    settled = true;
    clearTimeout(timeout);
    await closeServer(server);
    if (isError) {
      reject(value);
    } else {
      resolve(value);
    }
  };

  let timeout = null;
  const callback = new Promise((resolve, reject) => {
    timeout = setTimeout(() => {
      finish(resolve, reject, new Error("OpenAI sign-in timed out"), true).catch(reject);
    }, timeoutMs);
    timeout.unref?.();

    server.on("request", async (request, response) => {
      try {
        const requestUrl = new URL(request.url, REDIRECT_URI);
        if (requestUrl.pathname !== "/auth/callback") {
          sendHtml(response, 404, "Not found");
          return;
        }
        if (requestUrl.searchParams.get("state") !== state) {
          sendHtml(response, 400, "OpenAI sign-in state mismatch.");
          await finish(resolve, reject, new Error("OpenAI sign-in state mismatch"), true);
          return;
        }
        const authError = requestUrl.searchParams.get("error");
        if (authError) {
          sendHtml(response, 400, "OpenAI sign-in failed.");
          await finish(resolve, reject, new Error(`OpenAI sign-in failed: ${authError}`), true);
          return;
        }
        const code = requestUrl.searchParams.get("code");
        if (!code) {
          sendHtml(response, 400, "OpenAI sign-in did not include an authorization code.");
          await finish(resolve, reject, new Error("OpenAI sign-in did not include an authorization code"), true);
          return;
        }
        const source = await exchangeAuthorizationCode({
          code,
          codeVerifier: pkce.codeVerifier,
          fetchImpl,
          userDataPath,
        });
        sendHtml(response, 200, "Signed in &mdash; you can close this tab.");
        await finish(resolve, reject, source);
      } catch (error) {
        if (!response.headersSent) {
          sendHtml(response, 500, "OpenAI sign-in failed.");
        }
        await finish(resolve, reject, error, true);
      }
    });
  });

  try {
    await listen(server, port);
    await openExternal(buildAuthorizeUrl({ codeChallenge: pkce.codeChallenge, state }));
  } catch (error) {
    clearTimeout(timeout);
    await closeServer(server);
    throw error;
  }
  return callback;
}

module.exports = {
  AUTHORIZE_URL,
  CLIENT_ID,
  DEFAULT_CODEX_AUTH_PATH,
  EXPIRY_SKEW_SECONDS,
  REDIRECT_URI,
  TOKEN_URL,
  base64UrlEncode,
  buildAuthorizeUrl,
  codexAuthPathFromConfig,
  decodeJwtPayload,
  expandHome,
  extractAccountId,
  generatePkcePair,
  getAppOauthPath,
  getJwtExp,
  getOauthAccessToken,
  hasOauthCredentials,
  isAccessTokenExpired,
  loadOauthTokenSource,
  mergeTokenResponse,
  persistOauthTokens,
  pkceChallengeForVerifier,
  readCodexTokenSource,
  refreshOauthTokens,
  resolveOpenAiApiKey,
  signIn,
};
