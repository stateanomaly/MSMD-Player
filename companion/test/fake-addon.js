#!/usr/bin/env node
const net = require("node:net");

const portArg = Number(process.argv[2] || process.env.PORT || 41797);
const fast = process.argv.includes("--fast") || process.env.MSMD_FAKE_ADDON_FAST === "1";
const demo = process.argv.includes("--demo") || process.env.MSMD_FAKE_ADDON_DEMO === "1";
const intervalMs = fast ? 120 : 4000;

let server = null;
let sockets = new Set();

function send(socket, message) {
  if (!socket.destroyed) {
    socket.write(`${JSON.stringify(message)}\n`);
  }
}

function parseLines(socket, onMessage) {
  let buffer = "";
  socket.setEncoding("utf8");
  socket.on("data", (chunk) => {
    buffer += chunk;
    let newlineIndex = buffer.indexOf("\n");
    while (newlineIndex >= 0) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (line) {
        try {
          onMessage(JSON.parse(line));
        } catch {
          send(socket, { type: "error", message: "Malformed JSON" });
        }
      }
      newlineIndex = buffer.indexOf("\n");
    }
  });
}

function fakeSnapshot() {
  return {
    type: "state_snapshot",
    mode: "OBJECT",
    active_object: "Cube",
    selected: ["Cube"],
    objects: ["Cube", "Camera", "Light"],
    filepath: "",
    is_dirty: true,
    t: Date.now(),
  };
}

function handleConnection(socket) {
  sockets.add(socket);
  const timers = new Set();
  let quest = null;
  let begunCount = 0;

  const later = (delayMs, callback) => {
    const timer = setTimeout(() => {
      timers.delete(timer);
      callback();
    }, delayMs);
    timers.add(timer);
  };

  send(socket, { type: "hello", role: "addon", version: 1 });
  later(fast ? 40 : 1000, () => send(socket, { type: "ping", t: Date.now() }));

  parseLines(socket, (message) => {
    if (message.type === "ping") {
      send(socket, { type: "pong", t: message.t });
      return;
    }
    if (message.type === "pong") {
      return;
    }
    if (message.type === "quest_load") {
      quest = message;
      send(socket, { type: "quest_loaded", ok: true });
      return;
    }
    if (message.type === "snapshot_request") {
      send(socket, fakeSnapshot());
      return;
    }
    if (message.type !== "step_begin") {
      return;
    }

    const steps = Array.isArray(quest?.steps) ? quest.steps : [];
    const index = Math.max(
      0,
      steps.findIndex((step) => step.id === message.step_id)
    );
    begunCount += 1;
    const stepId = message.step_id || steps[index]?.id || `s${index}`;

    later(Math.max(20, intervalMs / 4), () => {
      send(socket, {
        type: "operator_event",
        op_id: index === 1 ? "mesh.primitive_uv_sphere_add" : "object.delete",
        props_summary: {},
        classification: "expected",
        t: Date.now(),
      });
    });

    if (demo && index === 1) {
      later(Math.max(30, intervalMs / 2), () => {
        send(socket, {
          type: "deviation",
          step_id: stepId,
          op_id: "object.random_bad_idea",
          severity: "major",
          t: Date.now(),
        });
      });
    }

    later(intervalMs, () => {
      send(socket, { type: "step_verified", step_id: stepId, t: Date.now() });
      if (steps.length && index >= steps.length - 1) {
        send(socket, { type: "quest_complete", quest_id: quest.quest_id || "fake" });
      }
    });

    if (fast && begunCount > 1000) {
      socket.destroy();
    }
  });

  socket.on("close", () => {
    sockets.delete(socket);
    for (const timer of timers) {
      clearTimeout(timer);
    }
    timers.clear();
  });
}

server = net.createServer(handleConnection);
server.listen(portArg, "127.0.0.1", () => {
  const address = server.address();
  console.log(`FAKE_ADDON_READY ${address.port}`);
});

function shutdown() {
  for (const socket of sockets) {
    socket.destroy();
  }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 500).unref();
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
