const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

class ElevenLabsTts {
  constructor(options = {}) {
    this.apiKey = options.apiKey || "";
    this.userDataPath = options.userDataPath;
    this.logger = options.logger || console;
  }

  cacheDir() {
    if (!this.userDataPath) {
      throw new Error("TTS userDataPath is required");
    }
    return path.join(this.userDataPath, "tts-cache");
  }

  cachePath(voiceId, text) {
    const hash = crypto.createHash("sha1").update(`${voiceId}|${text}`).digest("hex");
    return path.join(this.cacheDir(), `${hash}.mp3`);
  }

  async synthesize(options = {}) {
    const voiceId = options.voiceId || "Mtmp3KhFIjYpWYRycDe3";
    const text = String(options.text || "").trim();
    if (!text) {
      throw new Error("TTS text is required");
    }

    const filePath = this.cachePath(voiceId, text);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    try {
      await fs.access(filePath);
      return {
        filePath,
        fileUrl: pathToFileURL(filePath).toString(),
        cached: true,
      };
    } catch {
      // Cache miss; synthesize below.
    }

    if (!this.apiKey) {
      throw new Error("ELEVENLABS_API_KEY is required for uncached steering audio");
    }

    const url = new URL(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`);
    url.searchParams.set("output_format", "mp3_44100_128");
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "xi-api-key": this.apiKey,
      },
      body: JSON.stringify({
        text,
        model_id: "eleven_multilingual_v2",
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`ElevenLabs TTS failed: ${response.status} ${body.slice(0, 240)}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    await fs.writeFile(filePath, buffer);
    return {
      filePath,
      fileUrl: pathToFileURL(filePath).toString(),
      cached: false,
    };
  }
}

module.exports = {
  ElevenLabsTts,
};
