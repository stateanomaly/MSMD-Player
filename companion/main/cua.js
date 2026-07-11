const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { EventEmitter } = require("node:events");

const SYSTEM_PROMPT =
  "You are the brain of a surfer-dude dragonfly mascot guiding a kid (about 7-10 years old) through Blender. Given the current quest step's goal, the kid's recent actions, and a screenshot of their Blender window, judge whether they're on track. steer_line must be one short spoken sentence, at most 20 words, laid-back surfer voice, kid-safe, encouraging, never scolding, no emojis. If pointing at a spot in the UI would help, set point to its normalized screenshot coordinates, else null.";

function nowSeconds() {
  return Date.now() / 1000;
}

function clampPoint(point) {
  if (!point || typeof point !== "object") {
    return null;
  }
  const x = Number(point.x);
  const y = Number(point.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }
  return {
    x: Math.min(Math.max(x, 0), 1),
    y: Math.min(Math.max(y, 0), 1),
  };
}

function trimSteerLine(line) {
  const text = String(line || "").trim();
  if (!text) {
    return "";
  }
  const words = text.split(/\s+/).slice(0, 20);
  return words.join(" ");
}

function sanitizeAssessment(input) {
  const assessment = ["on_track", "off_track", "stuck"].includes(input?.assessment)
    ? input.assessment
    : "on_track";
  return {
    assessment,
    steer_line: trimSteerLine(input?.steer_line),
    point: clampPoint(input?.point),
  };
}

function buildUserText({ quest, step, recentEvents, snapshot, secondsSinceActivity }) {
  const operatorEvents = recentEvents
    .filter((event) => event.type === "operator_event")
    .slice(-10);
  const deviations = recentEvents.filter((event) => event.type === "deviation").slice(-5);
  return [
    `Quest title: ${quest?.title || quest?.id || "Untitled quest"}`,
    `Step goal: ${step?.goal || step?.id || "Unknown goal"}`,
    `Kid-facing instruction: ${step?.narration_text || ""}`,
    `Seconds since last activity: ${Math.round(secondsSinceActivity)}`,
    "Recent operator events (oldest to newest, max 10):",
    JSON.stringify(operatorEvents, null, 2),
    "Recent deviations:",
    JSON.stringify(deviations, null, 2),
    "Latest state_snapshot JSON:",
    JSON.stringify(snapshot || null, null, 2),
  ].join("\n");
}

async function callClaudeAssessment(options) {
  const { apiKey, model, screenshotPng, systemPrompt, userText } = options;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is required for CUA assessment");
  }

  const mod = await import("@anthropic-ai/sdk");
  const Anthropic = mod.Anthropic || mod.default;
  const client = new Anthropic({ apiKey });
  const response = await client.messages.create({
    model,
    max_tokens: 1024,
    system: systemPrompt,
    tools: [
      {
        name: "report_assessment",
        description: "Report whether the child is on track and optionally provide one short steering line.",
        input_schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            assessment: {
              type: "string",
              enum: ["on_track", "off_track", "stuck"],
            },
            steer_line: {
              type: "string",
              maxLength: 160,
            },
            point: {
              anyOf: [
                {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    x: { type: "number", minimum: 0, maximum: 1 },
                    y: { type: "number", minimum: 0, maximum: 1 },
                  },
                  required: ["x", "y"],
                },
                { type: "null" },
              ],
            },
          },
          required: ["assessment", "steer_line", "point"],
        },
      },
    ],
    tool_choice: {
      type: "tool",
      name: "report_assessment",
    },
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: "image/png",
              data: screenshotPng.toString("base64"),
            },
          },
          {
            type: "text",
            text: userText,
          },
        ],
      },
    ],
  });

  const toolUse = response.content?.find(
    (block) => block.type === "tool_use" && block.name === "report_assessment"
  );
  if (!toolUse) {
    throw new Error("Claude response did not include report_assessment tool_use");
  }
  return sanitizeAssessment(toolUse.input);
}

class CuaController extends EventEmitter {
  constructor(options = {}) {
    super();
    this.config = options.config || {};
    this.quest = options.quest || null;
    this.tcpClient = options.tcpClient;
    this.captureScreenshot = options.captureScreenshot;
    this.tts = options.tts;
    this.dryRun = Boolean(options.dryRun);
    this.logger = options.logger || console;
    this.enabled = Boolean(this.config.cua?.enabled || this.dryRun);
    this.model = this.config.cua?.model || "claude-opus-4-8";
    this.cooldownS = Number(this.config.cua?.cooldownS || 30);
    this.maxPerStep = Number(this.config.cua?.maxPerStep || 3);
    this.currentStep = null;
    this.stepState = null;
    this.latestSnapshot = null;
    this.recentEvents = [];
    this.escalating = false;
    this.timer = setInterval(() => this.evaluate("timer").catch((error) => this.logError(error)), 1000);
    this.timer.unref?.();
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  beginStep(step) {
    this.currentStep = step || null;
    const now = nowSeconds();
    this.stepState = {
      beginT: now,
      lastOpT: now,
      unexpectedCount: 0,
      sameOpRepeat: 0,
      lastUnexpectedOp: "",
      escalations: 0,
      lastEscalationT: 0,
    };
    this.recentEvents = [];
  }

  handleMessage(message) {
    if (!message || typeof message !== "object") {
      return;
    }
    if (message.type === "state_snapshot") {
      this.latestSnapshot = message;
      return;
    }
    if (message.type === "operator_event") {
      this.handleOperatorEvent(message);
      return;
    }
    if (message.type === "deviation") {
      this.handleDeviation(message);
    }
  }

  handleOperatorEvent(message) {
    if (!this.stepState) {
      return;
    }
    this.stepState.lastOpT = nowSeconds();
    this.recentEvents.push({
      type: "operator_event",
      op_id: message.op_id,
      props_summary: message.props_summary,
      classification: message.classification,
      t: message.t,
    });
    this.recentEvents = this.recentEvents.slice(-20);

    if (message.classification === "unexpected") {
      this.stepState.unexpectedCount += 1;
      if (message.op_id && message.op_id === this.stepState.lastUnexpectedOp) {
        this.stepState.sameOpRepeat += 1;
      } else {
        this.stepState.sameOpRepeat = 1;
        this.stepState.lastUnexpectedOp = message.op_id || "";
      }
      this.evaluate("unexpected_ops").catch((error) => this.logError(error));
    }
  }

  handleDeviation(message) {
    if (!this.stepState) {
      return;
    }
    this.recentEvents.push({
      type: "deviation",
      step_id: message.step_id,
      op_id: message.op_id,
      severity: message.severity,
      t: message.t,
    });
    this.recentEvents = this.recentEvents.slice(-20);
    this.evaluate("deviation", message.severity === "major").catch((error) => this.logError(error));
  }

  async evaluate(reason, force = false) {
    if (!this.stepState || !this.currentStep || this.escalating) {
      return;
    }
    const now = nowSeconds();
    const timeoutS = Number(this.currentStep.timeout_s || 45);
    const secondsSinceActivity = now - Math.max(this.stepState.beginT, this.stepState.lastOpT);
    const stalled = secondsSinceActivity > timeoutS;
    const repeatedUnexpected = this.stepState.sameOpRepeat >= 2;
    const manyUnexpected = this.stepState.unexpectedCount >= 3;
    const shouldEscalate = force || stalled || repeatedUnexpected || manyUnexpected;
    if (!shouldEscalate) {
      return;
    }

    if (!this.enabled) {
      this.logger.info?.(`CUA disabled; escalation trigger ignored: ${reason}`);
      return;
    }

    if (now - this.stepState.lastEscalationT < this.cooldownS) {
      return;
    }

    if (this.stepState.escalations >= this.maxPerStep) {
      this.logger.info?.(`CUA max escalations reached for ${this.currentStep.id}; replaying narration`);
      this.emit("replay_narration", { stepId: this.currentStep.id });
      this.stepState.lastEscalationT = now;
      return;
    }

    await this.escalate(reason, secondsSinceActivity);
  }

  async escalate(reason, secondsSinceActivity) {
    this.escalating = true;
    this.stepState.escalations += 1;
    this.stepState.lastEscalationT = nowSeconds();

    try {
      this.tcpClient?.requestSnapshot();
      const snapshot = await this.waitForFreshSnapshot(900);
      const screenshotPng = await this.captureScreenshot();
      const userText = buildUserText({
        quest: this.quest,
        step: this.currentStep,
        recentEvents: this.recentEvents,
        snapshot,
        secondsSinceActivity,
      });

      if (this.dryRun) {
        const screenshotPath = path.join(
          os.tmpdir(),
          `msmd-cua-${Date.now()}-${this.currentStep.id}.png`
        );
        await fs.writeFile(screenshotPath, screenshotPng);
        this.logger.info?.(
          [
            "CUA dry run prompt:",
            "--- system ---",
            SYSTEM_PROMPT,
            "--- user ---",
            userText,
            `Screenshot saved to ${screenshotPath}`,
          ].join("\n")
        );
        return;
      }

      const assessment = await callClaudeAssessment({
        apiKey: this.config.anthropicApiKey,
        model: this.model,
        screenshotPng,
        systemPrompt: SYSTEM_PROMPT,
        userText,
      });

      if (!["off_track", "stuck"].includes(assessment.assessment) || !assessment.steer_line) {
        return;
      }

      const audio = await this.tts.synthesize({
        voiceId: this.quest?.voice || "Mtmp3KhFIjYpWYRycDe3",
        text: assessment.steer_line,
      });
      this.emit("steer", {
        steerLine: assessment.steer_line,
        audioFileUrl: audio.fileUrl,
        point: assessment.point,
      });
    } finally {
      this.escalating = false;
    }
  }

  waitForFreshSnapshot(timeoutMs) {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (snapshot) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        this.tcpClient?.off?.("state_snapshot", onSnapshot);
        resolve(snapshot || this.latestSnapshot);
      };
      const onSnapshot = (snapshot) => {
        this.latestSnapshot = snapshot;
        finish(snapshot);
      };
      const timer = setTimeout(() => finish(this.latestSnapshot), timeoutMs);
      timer.unref?.();
      this.tcpClient?.once?.("state_snapshot", onSnapshot);
    });
  }

  logError(error) {
    this.logger.warn?.(`CUA escalation failed: ${error.message}`);
  }
}

module.exports = {
  CuaController,
  SYSTEM_PROMPT,
  buildUserText,
  sanitizeAssessment,
};
