const net = require("node:net");
const { EventEmitter } = require("node:events");

class GuidedTcpClient extends EventEmitter {
  constructor(options = {}) {
    super();
    this.host = options.host || "127.0.0.1";
    this.port = options.port || 41797;
    this.version = options.version || 1;
    this.reconnectMs = options.reconnectMs || 2000;
    this.heartbeatMs = options.heartbeatMs || 5000;
    this.deadMs = options.deadMs || 15000;
    this.logger = options.logger || console;

    this.socket = null;
    this.buffer = "";
    this.stopped = true;
    this.connected = false;
    this.reconnectTimer = null;
    this.heartbeatTimer = null;
    this.lastReceivedAt = 0;
    this.questLoad = null;
    this.currentStepId = "";
  }

  setQuestLoad(questLoad) {
    this.questLoad = questLoad || null;
  }

  setCurrentStepId(stepId) {
    this.currentStepId = stepId || "";
  }

  connect() {
    if (this.socket || this.connected) {
      return;
    }
    this.stopped = false;
    this.clearReconnectTimer();
    this.openSocket();
  }

  stop() {
    this.stopped = true;
    this.clearReconnectTimer();
    this.clearHeartbeatTimer();
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.destroy();
      this.socket = null;
    }
    this.connected = false;
  }

  beginStep(stepId) {
    this.setCurrentStepId(stepId);
    if (this.connected) {
      this.send("step_begin", { step_id: stepId });
    }
  }

  requestSnapshot() {
    this.send("snapshot_request", {});
  }

  send(type, payload = {}) {
    if (!type) {
      return false;
    }
    return this.sendObject({ type, ...payload });
  }

  sendObject(message) {
    if (!this.socket || !this.connected) {
      return false;
    }
    const line = `${JSON.stringify(message)}\n`;
    this.socket.write(line);
    this.emit("sent", message);
    return true;
  }

  openSocket() {
    const socket = net.createConnection({ host: this.host, port: this.port });
    this.socket = socket;
    socket.setEncoding("utf8");
    socket.setNoDelay(true);

    socket.on("connect", () => {
      this.connected = true;
      this.lastReceivedAt = Date.now();
      this.emit("connect");
      this.sendResumeMessages();
      this.startHeartbeat();
    });

    socket.on("data", (chunk) => {
      this.lastReceivedAt = Date.now();
      this.buffer += chunk;
      this.drainBuffer();
    });

    socket.on("error", (error) => {
      this.emit("socket_error", error);
      if (!this.stopped) {
        this.logger.warn?.(`TCP client error: ${error.message}`);
      }
    });

    socket.on("close", () => {
      const wasConnected = this.connected;
      this.connected = false;
      this.socket = null;
      this.buffer = "";
      this.clearHeartbeatTimer();
      if (wasConnected) {
        this.emit("disconnect");
      }
      if (!this.stopped) {
        this.scheduleReconnect();
      }
    });
  }

  sendResumeMessages() {
    this.send("hello", {
      role: "companion",
      version: this.version,
    });

    if (this.questLoad) {
      this.send("quest_load", this.questLoad);
      const stepId = this.currentStepId || this.questLoad.steps?.[0]?.id || "";
      if (stepId) {
        this.setCurrentStepId(stepId);
        this.send("step_begin", { step_id: stepId });
      }
    }
  }

  drainBuffer() {
    let newlineIndex = this.buffer.indexOf("\n");
    while (newlineIndex >= 0) {
      const line = this.buffer.slice(0, newlineIndex).trim();
      this.buffer = this.buffer.slice(newlineIndex + 1);
      if (line) {
        this.handleLine(line);
      }
      newlineIndex = this.buffer.indexOf("\n");
    }
  }

  handleLine(line) {
    let message = null;
    try {
      message = JSON.parse(line);
    } catch (error) {
      this.logger.warn?.(`Skipping malformed TCP line: ${line}`);
      this.emit("malformed", line);
      return;
    }

    if (!message || typeof message !== "object" || typeof message.type !== "string") {
      this.logger.warn?.(`Skipping TCP message without type: ${line}`);
      this.emit("malformed", line);
      return;
    }

    if (message.type === "ping") {
      this.send("pong", { t: message.t ?? Date.now() });
    }

    this.emit("message", message);
    this.emit(message.type, message);
  }

  startHeartbeat() {
    this.clearHeartbeatTimer();
    this.heartbeatTimer = setInterval(() => {
      if (!this.connected) {
        return;
      }
      const silenceMs = Date.now() - this.lastReceivedAt;
      if (silenceMs > this.deadMs) {
        this.logger.warn?.(`TCP server silent for ${silenceMs}ms; reconnecting`);
        this.socket?.destroy();
        return;
      }
      this.send("ping", { t: Date.now() });
    }, this.heartbeatMs);
    this.heartbeatTimer.unref?.();
  }

  clearHeartbeatTimer() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  scheduleReconnect() {
    if (this.reconnectTimer) {
      return;
    }
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.stopped && !this.socket) {
        this.openSocket();
      }
    }, this.reconnectMs);
    this.reconnectTimer.unref?.();
  }

  clearReconnectTimer() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}

module.exports = {
  GuidedTcpClient,
};
