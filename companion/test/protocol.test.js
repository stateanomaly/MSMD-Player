const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("node:path");
const { test } = require("node:test");
const { GuidedTcpClient } = require("../main/tcp-client");

const fakeAddonPath = path.join(__dirname, "fake-addon.js");

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitFor(predicate, timeoutMs = 3000, label = "condition") {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      const value = predicate();
      if (value) {
        resolve(value);
        return;
      }
      if (Date.now() - startedAt > timeoutMs) {
        reject(new Error(`Timed out waiting for ${label}`));
        return;
      }
      setTimeout(tick, 20);
    };
    tick();
  });
}

function startFakeAddon(port = 0) {
  const child = spawn(process.execPath, [fakeAddonPath, String(port), "--fast"], {
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      MSMD_FAKE_ADDON_FAST: "1",
    },
  });

  let stdout = "";
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });

  const ready = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`fake-addon did not start: ${stderr}`));
    }, 3000);
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      const match = stdout.match(/FAKE_ADDON_READY\s+(\d+)/);
      if (match) {
        clearTimeout(timeout);
        resolve({
          child,
          port: Number(match[1]),
          stop: () => stopChild(child),
        });
      }
    });
    child.on("exit", (code) => {
      if (!stdout.includes("FAKE_ADDON_READY")) {
        clearTimeout(timeout);
        reject(new Error(`fake-addon exited early with ${code}: ${stderr}`));
      }
    });
  });

  return ready;
}

function stopChild(child) {
  return new Promise((resolve) => {
    if (child.exitCode !== null) {
      resolve();
      return;
    }
    child.once("exit", () => resolve());
    child.kill("SIGTERM");
  });
}

test("tcp client handshakes, replays current quest on reconnect, and heartbeats", async () => {
  let fake = await startFakeAddon(0);
  let replacement = null;
  const messages = [];
  const sent = [];
  const logger = {
    info() {},
    warn() {},
  };

  const client = new GuidedTcpClient({
    port: fake.port,
    reconnectMs: 120,
    heartbeatMs: 120,
    deadMs: 1000,
    logger,
  });
  client.setQuestLoad({
    quest_id: "protocol-test",
    harmless_ops: ["view3d.*"],
    steps: [
      { id: "s0", check: { op: "object.delete" } },
      { id: "s1", check: { op: "mesh.primitive_uv_sphere_add" } },
    ],
  });
  client.setCurrentStepId("s0");
  client.on("message", (message) => messages.push(message));
  client.on("sent", (message) => sent.push(message));

  try {
    client.connect();

    await waitFor(() => sent.find((message) => message.type === "hello"), 1500, "hello send");
    assert.ok(sent.find((message) => message.type === "quest_load"));
    assert.ok(sent.find((message) => message.type === "step_begin" && message.step_id === "s0"));

    await waitFor(
      () => messages.find((message) => message.type === "quest_loaded" && message.ok),
      1500,
      "quest_loaded"
    );
    const verified = await waitFor(
      () => messages.find((message) => message.type === "step_verified" && message.step_id === "s0"),
      1500,
      "step_verified"
    );
    assert.equal(verified.step_id, "s0");

    const pongCountBefore = messages.filter((message) => message.type === "pong").length;
    client.send("ping", { t: 123 });
    await waitFor(
      () => messages.filter((message) => message.type === "pong").length > pongCountBefore,
      1500,
      "pong"
    );

    const questLoadedCountBefore = messages.filter((message) => message.type === "quest_loaded").length;
    await fake.stop();
    await delay(250);
    replacement = await startFakeAddon(fake.port);
    fake = replacement;

    await waitFor(
      () => messages.filter((message) => message.type === "quest_loaded").length > questLoadedCountBefore,
      3000,
      "quest_loaded after reconnect"
    );
    const reconnectSlice = sent.slice(sent.findLastIndex((message) => message.type === "hello"));
    assert.ok(reconnectSlice.find((message) => message.type === "quest_load"));
    assert.ok(reconnectSlice.find((message) => message.type === "step_begin" && message.step_id === "s0"));

    await waitFor(
      () =>
        messages.filter((message) => message.type === "step_verified" && message.step_id === "s0").length >= 2,
      2000,
      "step_verified after reconnect"
    );
  } finally {
    client.stop();
    await fake?.stop();
  }
});
