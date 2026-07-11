#!/usr/bin/env python3
"""Generate narration MP3s for a guided quest using ElevenLabs text-to-speech."""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_QUEST_DIR = REPO_ROOT / "quests" / "snowman"

ELEVENLABS_URL = (
    "https://api.elevenlabs.io/v1/text-to-speech/{voice}"
    "?output_format=mp3_44100_128"
)
MODEL_ID = "eleven_multilingual_v2"


def display_path(path: Path) -> Path:
    try:
        return path.resolve().relative_to(REPO_ROOT)
    except ValueError:
        return path


def load_quest(quest_dir: Path) -> dict[str, object]:
    quest_path = quest_dir / "quest.json"
    if not quest_path.is_file():
        raise FileNotFoundError(f"missing quest.json in {quest_dir}")
    with quest_path.open("r", encoding="utf-8") as handle:
        quest = json.load(handle)
    if not isinstance(quest, dict):
        raise ValueError(f"{quest_path} must contain a JSON object")
    return quest


def synth_one(
    text: str, voice: str, api_key: str, out_path: Path
) -> int:
    """Call ElevenLabs and write the MP3 to out_path; return byte count."""
    url = ELEVENLABS_URL.format(voice=voice)
    body = json.dumps({"text": text, "model_id": MODEL_ID}).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=body,
        headers={
            "xi-api-key": api_key,
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request) as response:
            payload = response.read()
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        print(f"ElevenLabs error {exc.code} for voice {voice}:", file=sys.stderr)
        print(detail, file=sys.stderr)
        raise SystemExit(1)
    except urllib.error.URLError as exc:
        print(f"network error talking to ElevenLabs: {exc}", file=sys.stderr)
        raise SystemExit(1)

    out_path.write_bytes(payload)
    return len(payload)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "quest_dir",
        type=Path,
        nargs="?",
        default=DEFAULT_QUEST_DIR,
        help="Path to the quest directory (default: quests/snowman).",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Overwrite narration files that already exist.",
    )
    args = parser.parse_args()
    args.quest_dir = args.quest_dir.resolve()

    api_key = os.environ.get("ELEVENLABS_API_KEY")
    if not api_key:
        print(
            "error: ELEVENLABS_API_KEY is not set; export it before running.",
            file=sys.stderr,
        )
        return 1

    quest = load_quest(args.quest_dir)
    voice_raw = quest.get("voice")
    if not isinstance(voice_raw, str) or not voice_raw:
        print(f"error: quest.json in {args.quest_dir} has no 'voice' field", file=sys.stderr)
        return 1
    voice: str = voice_raw

    steps = quest.get("steps")
    if not isinstance(steps, list) or not steps:
        print(f"error: quest.json in {args.quest_dir} has no 'steps' list", file=sys.stderr)
        return 1

    for index, step in enumerate(steps):
        narration_text = step.get("narration_text")
        if not narration_text:
            continue
        narration_field = step.get("narration")
        expected_name = f"say{index}.mp3"
        if narration_field != expected_name:
            print(
                f"error: step {index} narration field '{narration_field}' "
                f"does not match expected '{expected_name}'",
                file=sys.stderr,
            )
            return 1
        out_path = args.quest_dir / expected_name
        if out_path.is_file() and not args.force:
            print(f"skip {display_path(out_path)} (exists)")
            continue
        size = synth_one(narration_text, voice, api_key, out_path)
        print(f"wrote {display_path(out_path)} ({size} bytes)")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
