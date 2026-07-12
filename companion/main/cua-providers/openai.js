const crypto = require("node:crypto");
const {
  getOauthAccessToken,
  resolveOpenAiApiKey,
} = require("./openai-auth");

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const CHATGPT_CODEX_RESPONSES_URL = "https://chatgpt.com/backend-api/codex/responses";

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

function getFetch(fetchImpl) {
  const impl = fetchImpl || globalThis.fetch;
  if (typeof impl !== "function") {
    throw new Error("fetch is required for OpenAI assessments");
  }
  return impl;
}

function buildInputContent(screenshotPng, userText) {
  const content = [];
  if (screenshotPng && screenshotPng.length) {
    content.push({
      type: "input_image",
      image_url: `data:image/png;base64,${screenshotPng.toString("base64")}`,
    });
  }
  content.push({
    type: "input_text",
    text: userText,
  });
  return content;
}

function jsonFormat() {
  return {
    format: {
      type: "json_schema",
      name: "report_assessment",
      strict: true,
      schema: REPORT_ASSESSMENT_SCHEMA,
    },
  };
}

function buildResponsesBody(options = {}) {
  const body = {
    model: options.model,
    instructions: options.instructions,
    input: [
      {
        role: "user",
        content: buildInputContent(options.screenshotPng, options.userText),
      },
    ],
    stream: Boolean(options.stream),
  };
  if (options.includeTextFormat !== false) {
    body.text = jsonFormat();
  }
  if (options.store !== undefined) {
    body.store = options.store;
  }
  return body;
}

function extractContentText(content) {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .map((part) => {
      if (!part || typeof part !== "object") {
        return "";
      }
      if (part.type === "output_text" && typeof part.text === "string") {
        return part.text;
      }
      if (typeof part.output_text === "string") {
        return part.output_text;
      }
      if (typeof part.text === "string" && !part.type) {
        return part.text;
      }
      return "";
    })
    .join("");
}

function extractOutputTextFromResponseJson(responseJson) {
  if (!responseJson || typeof responseJson !== "object") {
    return "";
  }
  if (typeof responseJson.output_text === "string") {
    return responseJson.output_text;
  }
  const output = Array.isArray(responseJson.output) ? responseJson.output : [];
  for (const item of output) {
    if (!item || typeof item !== "object") {
      continue;
    }
    if (item.type === "message" || Array.isArray(item.content)) {
      const text = extractContentText(item.content);
      if (text) {
        return text;
      }
    }
  }
  return "";
}

function extractFirstJsonObject(text) {
  const source = String(text || "");
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (start === -1) {
      if (char === "{") {
        start = index;
        depth = 1;
      }
      continue;
    }

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
    } else if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(start, index + 1);
      }
    }
  }
  return "";
}

function parseAssessmentJson(text, options = {}) {
  const trimmed = String(text || "").trim();
  try {
    return JSON.parse(trimmed);
  } catch (error) {
    if (options.extractJson) {
      const jsonBlock = extractFirstJsonObject(trimmed);
      if (jsonBlock) {
        try {
          return JSON.parse(jsonBlock);
        } catch {
          // Keep the generic value-free error below.
        }
      }
    }
    throw new Error("OpenAI assessment response was not valid JSON");
  }
}

function parseSseEvents(sseText) {
  return String(sseText || "")
    .replace(/\r\n/g, "\n")
    .split(/\n\n+/)
    .map((block) => {
      const event = { event: "message", data: "" };
      const dataLines = [];
      for (const rawLine of block.split("\n")) {
        if (!rawLine || rawLine.startsWith(":")) {
          continue;
        }
        const separator = rawLine.indexOf(":");
        const field = separator === -1 ? rawLine : rawLine.slice(0, separator);
        let value = separator === -1 ? "" : rawLine.slice(separator + 1);
        if (value.startsWith(" ")) {
          value = value.slice(1);
        }
        if (field === "event") {
          event.event = value || "message";
        } else if (field === "data") {
          dataLines.push(value);
        }
      }
      event.data = dataLines.join("\n");
      return event.data || event.event !== "message" ? event : null;
    })
    .filter(Boolean);
}

function aggregateSseOutputFromString(sseText) {
  let deltaText = "";
  let completedText = "";

  for (const event of parseSseEvents(sseText)) {
    if (!event.data || event.data === "[DONE]") {
      continue;
    }
    let payload = null;
    try {
      payload = JSON.parse(event.data);
    } catch {
      continue;
    }
    const type = payload.type || event.event;
    if (type === "response.output_text.delta") {
      deltaText += payload.delta || payload.text || "";
    } else if (type === "response.output_text.done" && typeof payload.text === "string") {
      completedText = payload.text;
    } else if (type === "response.completed") {
      const text = extractOutputTextFromResponseJson(payload.response || payload);
      if (text) {
        completedText = text;
      }
    } else if (event.event.endsWith(".delta") && typeof payload.delta === "string") {
      deltaText += payload.delta;
    }
  }

  return completedText || deltaText;
}

async function readResponseText(response) {
  if (typeof response.text === "function") {
    return response.text();
  }
  if (!response.body?.getReader) {
    return "";
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) {
      break;
    }
    text += decoder.decode(chunk.value, { stream: true });
  }
  text += decoder.decode();
  return text;
}

async function callOpenAiApiKeyAssessment(options = {}) {
  const fetchImpl = getFetch(options.fetchImpl);
  const key = await resolveOpenAiApiKey({
    config: options.config,
  });
  if (!key.apiKey) {
    throw new Error("OPENAI_API_KEY is required for OpenAI CUA api-key assessments");
  }
  const response = await fetchImpl(OPENAI_RESPONSES_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(
      buildResponsesBody({
        model: options.model,
        instructions: options.systemPrompt,
        userText: options.userText,
        screenshotPng: options.screenshotPng,
        includeTextFormat: true,
        stream: false,
        store: false,
      })
    ),
  });
  if (!response.ok) {
    throw new Error(`OpenAI API assessment failed with HTTP ${response.status}`);
  }
  const responseJson = await response.json();
  return parseAssessmentJson(extractOutputTextFromResponseJson(responseJson));
}

async function postOauthAssessment(options = {}) {
  const fetchImpl = getFetch(options.fetchImpl);
  if (!options.credentials.accessToken) {
    throw new Error("OpenAI OAuth access token is missing");
  }
  if (!options.credentials.accountId) {
    throw new Error("OpenAI OAuth account id is missing");
  }
  const instructions = options.includeTextFormat
    ? options.systemPrompt
    : `${options.systemPrompt}\n\nRespond with ONLY a JSON object: {"assessment":..., "steer_line":..., "point":...}`;
  return fetchImpl(CHATGPT_CODEX_RESPONSES_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${options.credentials.accessToken}`,
      "chatgpt-account-id": options.credentials.accountId,
      "OpenAI-Beta": "responses=experimental",
      originator: "codex_cli_rs",
      session_id: crypto.randomUUID(),
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify(
      buildResponsesBody({
        model: options.model,
        instructions,
        userText: options.userText,
        screenshotPng: options.screenshotPng,
        includeTextFormat: options.includeTextFormat,
        stream: true,
        store: false,
      })
    ),
  });
}

async function sendOauthWithAuthRetry(options = {}) {
  let credentials = await getOauthAccessToken({
    config: options.config,
    fetchImpl: options.fetchImpl,
    userDataPath: options.userDataPath,
  });
  let response = await postOauthAssessment({
    ...options,
    credentials,
  });
  if (response.status !== 401) {
    return response;
  }
  credentials = await getOauthAccessToken({
    config: options.config,
    fetchImpl: options.fetchImpl,
    forceRefresh: true,
    userDataPath: options.userDataPath,
  });
  return postOauthAssessment({
    ...options,
    credentials,
  });
}

async function callOpenAiOauthAssessment(options = {}) {
  let response = await sendOauthWithAuthRetry({
    ...options,
    includeTextFormat: true,
  });
  let extractJson = false;

  if (response.status === 400) {
    response = await sendOauthWithAuthRetry({
      ...options,
      includeTextFormat: false,
    });
    extractJson = true;
  }

  if (!response.ok) {
    throw new Error(`OpenAI OAuth assessment failed with HTTP ${response.status}`);
  }

  const sseText = await readResponseText(response);
  return parseAssessmentJson(aggregateSseOutputFromString(sseText), { extractJson });
}

function createOpenAiProvider(options = {}) {
  const config = options.config || {};
  const openaiConfig = config.cua?.openai || {};
  const auth = openaiConfig.auth || "oauth";
  const model = openaiConfig.model || "gpt-5.5";
  return {
    name: "openai",
    async assess(ctx) {
      const common = {
        config,
        fetchImpl: options.fetchImpl,
        model,
        screenshotPng: ctx.screenshotPng,
        systemPrompt: ctx.systemPrompt,
        userDataPath: options.userDataPath,
        userText: ctx.userText,
      };
      if (auth === "api-key") {
        return callOpenAiApiKeyAssessment(common);
      }
      if (auth === "oauth") {
        return callOpenAiOauthAssessment(common);
      }
      throw new Error(`Unsupported OpenAI CUA auth mode: ${auth}`);
    },
  };
}

module.exports = {
  CHATGPT_CODEX_RESPONSES_URL,
  OPENAI_RESPONSES_URL,
  REPORT_ASSESSMENT_SCHEMA,
  aggregateSseOutputFromString,
  buildResponsesBody,
  callOpenAiApiKeyAssessment,
  callOpenAiOauthAssessment,
  createOpenAiProvider,
  extractFirstJsonObject,
  extractOutputTextFromResponseJson,
  parseAssessmentJson,
  parseSseEvents,
};
