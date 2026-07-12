const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const {
  decodeJwtPayload,
  generatePkcePair,
  getAppOauthPath,
  getJwtExp,
  isAccessTokenExpired,
  loadOauthTokenSource,
  pkceChallengeForVerifier,
  readCodexTokenSource,
} = require("../main/cua-providers/openai-auth");
const {
  aggregateSseOutputFromString,
  parseAssessmentJson,
} = require("../main/cua-providers/openai");

function base64UrlJson(value) {
  return Buffer.from(JSON.stringify(value))
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function fakeJwt(payload) {
  return `${base64UrlJson({ alg: "none" })}.${base64UrlJson(payload)}.sig`;
}

async function withTempDir(fn) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "openai-auth-test-"));
  try {
    return await fn(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

test("JWT exp parsing decodes fake access tokens", () => {
  const token = fakeJwt({ exp: 1234, sub: "user" });
  assert.equal(decodeJwtPayload(token).sub, "user");
  assert.equal(getJwtExp(token), 1234);
  assert.equal(getJwtExp("not-a-jwt"), null);
});

test("access token expiry treats tokens as expired 60 seconds early", () => {
  const now = 1000;
  assert.equal(isAccessTokenExpired(fakeJwt({ exp: 1061 }), now), false);
  assert.equal(isAccessTokenExpired(fakeJwt({ exp: 1060 }), now), true);
  assert.equal(isAccessTokenExpired(fakeJwt({ exp: 999 }), now), true);
  assert.equal(isAccessTokenExpired("invalid", now), true);
});

test("app-owned oauth tokens take precedence over codex auth file", async () => {
  await withTempDir(async (root) => {
    const userDataPath = path.join(root, "user-data");
    const codexAuthPath = path.join(root, "codex-auth.json");
    await fs.mkdir(userDataPath, { recursive: true });
    await fs.writeFile(
      getAppOauthPath(userDataPath),
      JSON.stringify({
        auth_mode: "chatgpt-oauth",
        tokens: {
          access_token: fakeJwt({ exp: 3000 }),
          refresh_token: "app-refresh",
          account_id: "acct_app",
        },
      })
    );
    await fs.writeFile(
      codexAuthPath,
      JSON.stringify({
        auth_mode: "chatgpt-oauth",
        tokens: {
          access_token: fakeJwt({ exp: 4000 }),
          refresh_token: "codex-refresh",
          account_id: "acct_codex",
        },
      })
    );

    const source = await loadOauthTokenSource({
      userDataPath,
      config: { cua: { openai: { codexAuthPath } } },
    });
    assert.equal(source.source, "app");
    assert.equal(source.accountId, "acct_app");
  });
});

test("codex auth shape parses tokens and account id from id_token claim", async () => {
  await withTempDir(async (root) => {
    const codexAuthPath = path.join(root, "codex-auth.json");
    const idToken = fakeJwt({
      "https://api.openai.com/auth": {
        chatgpt_account_id: "acct_from_claim",
      },
    });
    await fs.writeFile(
      codexAuthPath,
      JSON.stringify({
        auth_mode: "chatgpt-oauth",
        OPENAI_API_KEY: "sk-test-key-that-is-long-enough",
        tokens: {
          access_token: fakeJwt({ exp: 5000 }),
          refresh_token: "codex-refresh",
          id_token: idToken,
        },
        last_refresh: 123,
      })
    );

    const source = await readCodexTokenSource({ codexAuthPath });
    assert.equal(source.source, "codex");
    assert.equal(source.accountId, "acct_from_claim");
    assert.equal(source.tokens.account_id, "acct_from_claim");
  });
});

test("PKCE challenge is S256 of the verifier", () => {
  const verifier = "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG";
  const expected = crypto
    .createHash("sha256")
    .update(verifier)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
  assert.equal(pkceChallengeForVerifier(verifier), expected);

  const pair = generatePkcePair();
  assert.ok(pair.codeVerifier.length >= 43);
  assert.equal(pair.codeChallenge, pkceChallengeForVerifier(pair.codeVerifier));
});

test("SSE parser aggregates output_text deltas into assessment JSON", () => {
  const sse = [
    "event: response.output_text.delta",
    `data: ${JSON.stringify({ delta: '{"assessment":"on_' })}`,
    "",
    "event: response.output_text.delta",
    `data: ${JSON.stringify({ delta: 'track","steer_line":"Nice move","point":null}' })}`,
    "",
    "event: response.completed",
    `data: ${JSON.stringify({ response: { status: "completed" } })}`,
    "",
  ].join("\n");

  const assembled = aggregateSseOutputFromString(sse);
  assert.deepEqual(parseAssessmentJson(assembled), {
    assessment: "on_track",
    steer_line: "Nice move",
    point: null,
  });
});
