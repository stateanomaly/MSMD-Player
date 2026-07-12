const REPORT_ASSESSMENT_SCHEMA = {
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
};

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
        input_schema: REPORT_ASSESSMENT_SCHEMA,
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
  return toolUse.input;
}

function createAnthropicProvider(options = {}) {
  const config = options.config || {};
  return {
    name: "anthropic",
    async assess(ctx) {
      return callClaudeAssessment({
        apiKey: config.anthropicApiKey,
        model: config.cua?.model || "claude-opus-4-8",
        screenshotPng: ctx.screenshotPng,
        systemPrompt: ctx.systemPrompt,
        userText: ctx.userText,
      });
    },
  };
}

module.exports = {
  REPORT_ASSESSMENT_SCHEMA,
  callClaudeAssessment,
  createAnthropicProvider,
};
