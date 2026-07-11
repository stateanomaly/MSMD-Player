# MSMD Guided Companion

Electron overlay client for MSMD Guided mode. It connects to the Blender add-on TCP server on `127.0.0.1:41797`, loads the current quest, renders the mascot and hotspot over the Blender window, and can optionally escalate stuck/off-track moments through Claude plus ElevenLabs TTS from the main process only.

## Setup

```sh
cd companion
npm install
npm start
```

Create `companion/config.json` from `config.example.json` when you need a non-default quest path or API keys. `ANTHROPIC_API_KEY` and `ELEVENLABS_API_KEY` override file values.

## Fake Mode

```sh
cd companion
MSMD_FAKE_ADDON=1 npm start
```

Fake mode starts `test/fake-addon.js`, uses an inline 3-step quest, and falls back to a fixed `1280x800` overlay rectangle when Blender is not open. The fake server sends `step_verified` every 4 seconds and one major deviation on step 2; with CUA disabled this is logged only.

## macOS Permissions

Real Blender tracking uses:

- Accessibility: required for `osascript` / System Events to read the Blender window bounds. Grant the built companion app, or Terminal when running in dev.
- Screen Recording: required for CUA screenshot capture. Grant the app or Terminal before using `cua.enabled`.

The overlay is always transparent, always on top, and click-through. It calls `setIgnoreMouseEvents(true)` unconditionally, so Blender keeps receiving all clicks.

## Real Blender E2E

1. Start Blender.
2. Start the Blender Guided add-on TCP server on `127.0.0.1:41797`.
3. Put the authored quest at `../quests/snowman/quest.json` relative to `companion/`, or set `questPath` in `companion/config.json`.
4. Run `npm start` from `companion/`.
5. Confirm the mascot appears over the Blender window, narration plays on step begin, and the hotspot aligns with the step target.
6. Complete each Blender action. The add-on should send `step_verified`; the companion advances only on that event and sends the next `step_begin`.
7. For CUA testing, set `cua.enabled: true` and API keys, or run `npx electron . --cua-dry-run` to log the prompt and save the screenshot without calling Claude.

## Verification

```sh
cd companion
npm test
node --check main/*.js preload.js renderer/guided.js renderer/guided-engine.js test/*.js
npx electron . --smoke
MSMD_FAKE_ADDON=1 npx electron . --smoke
```
