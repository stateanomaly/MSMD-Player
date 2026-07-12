# MSMD Guided Companion

Electron overlay client for MSMD Guided mode. It connects to the Blender add-on TCP server on `127.0.0.1:41797`, loads the current quest, renders the mascot and hotspot over the Blender window, and can optionally escalate stuck/off-track moments through OpenAI or Claude plus ElevenLabs TTS from the main process only.

On normal startup, the companion connects to the Guided add-on TCP server. If the add-on is not reachable and `autoLaunchBlender` is enabled, it launches Blender with the Guided add-on bootstrap and waits for the add-on hello before starting the quest flow.

## Setup

```sh
cd companion
npm install
npm start
```

Create `companion/config.json` from `config.example.json` when you need a non-default quest path or API keys. `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, and `ELEVENLABS_API_KEY` override file values.

CUA uses OpenAI ChatGPT OAuth by default. To sign in with the built-in PKCE flow:

```sh
cd companion
npx electron . --login-openai
```

OAuth first uses app-owned tokens in Electron's `userData` directory, then falls back to Codex CLI tokens from `~/.codex/auth.json`. Refreshed tokens are written only to the app-owned `openai-oauth.json` file. To use an OpenAI API key instead, set `cua.openai.auth` to `"api-key"` and provide `openaiApiKey` or `OPENAI_API_KEY`. To keep using Anthropic, set `cua.provider` to `"anthropic"` and provide `anthropicApiKey` or `ANTHROPIC_API_KEY`.

`blenderPath` defaults to `/Applications/Blender.app/Contents/MacOS/Blender`. Set `"autoLaunchBlender": false` to keep the old manual Blender startup flow.

## Packaged App

```sh
cd companion
npm run dist
```

The packaged macOS app is written to `companion/dist-app/`. It includes the committed quest content and Guided add-on bootstrap under the app `Resources` directory.

In packaged builds, user config is read from Electron's `userData` directory instead of the repo file. On macOS this is typically `~/Library/Application Support/MSMD Guided/config.json`. Relative `questPath` values in packaged user config are resolved from that directory; the default packaged quest is `Contents/Resources/quests/snowman/quest.json`.

## Fake Mode

```sh
cd companion
MSMD_FAKE_ADDON=1 npm start
```

Fake mode starts `test/fake-addon.js`, uses an inline 3-step quest, and uses a fixed `1280x800` overlay rectangle when Blender is not open. The fake server sends `step_verified` every 4 seconds and one major deviation on step 2; with CUA disabled this is logged only.

## macOS Permissions

Guided play does not require macOS privacy permissions. The overlay bounds come from Blender itself over the add-on TCP protocol, using Blender's client-area window geometry, so the overlay covers the drawable Blender surface instead of the title bar.

Screen Recording is required only for CUA screenshot capture. Grant the app or Terminal before using `cua.enabled`. The legacy JXA/System Events window probes remain as a fallback for older add-ons that do not send geometry.

The overlay is always transparent, always on top, and click-through. It calls `setIgnoreMouseEvents(true)` unconditionally, so Blender keeps receiving all clicks.

## Real Blender E2E

1. Put the authored quest at `../quests/snowman/quest.json` relative to `companion/`, or set `questPath` in `companion/config.json`.
2. Run `npm start` from `companion/`, or double-click the packaged app.
3. If `autoLaunchBlender` is enabled, wait for the companion to launch Blender and the Guided add-on bootstrap. Otherwise, start Blender and the Guided add-on TCP server on `127.0.0.1:41797` manually.
4. Confirm the mascot appears over the Blender window, narration plays on step begin, and the hotspot aligns with the step target.
5. Complete each Blender action. The add-on should send `step_verified`; the companion advances only on that event and sends the next `step_begin`.
6. For CUA testing, set `cua.enabled: true` and sign in with ChatGPT, provide an OpenAI API key, or configure Anthropic. Run `npx electron . --cua-dry-run` to log the prompt and save the screenshot without calling a model.

## Verification

```sh
cd companion
npm test
node --check main/cua.js main/cua-providers/*.js main/index.js test/openai-auth.test.js test/openai-oauth-smoke.js
npx electron . --smoke
MSMD_FAKE_ADDON=1 npx electron . --smoke
npm run dist && "./dist-app/mac-arm64/MSMD Guided.app/Contents/MacOS/MSMD Guided" --smoke
```
