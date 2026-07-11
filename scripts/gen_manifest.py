#!/usr/bin/env python3
"""Generate the static MSMD web content manifest."""

from __future__ import annotations

import argparse
import json
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CONTENT_ROOT = REPO_ROOT / "csb_msmd001"
DEFAULT_OUTPUT = REPO_ROOT / "webapp" / "content" / "manifest.json"
FRAME_SUFFIX = ".png"
AUDIO_SUFFIX = ".wav"


def numeric_stem(path: Path, prefix: str) -> int | None:
    stem = path.stem
    if not stem.startswith(prefix):
        return None
    value = stem[len(prefix) :]
    if not value.isdigit():
        return None
    return int(value)


def audio_indices(level_dir: Path, prefix: str) -> list[int]:
    indices = []
    for path in level_dir.glob(f"{prefix}*{AUDIO_SUFFIX}"):
        value = numeric_stem(path, prefix)
        if value is not None:
            indices.append(value)
    return sorted(indices)


def load_hotspots(level_dir: Path) -> dict[str, object]:
    hotspots_path = level_dir / "hotspots.json"
    if not hotspots_path.is_file():
        raise FileNotFoundError(f"missing hotspots.json in {level_dir}")
    with hotspots_path.open("r", encoding="utf-8") as handle:
        hotspots = json.load(handle)
    if not isinstance(hotspots, dict):
        raise ValueError(f"{hotspots_path} must contain a JSON object")
    return {key: hotspots[key] for key in sorted(hotspots)}


def validate_frames(level_dir: Path, frames: list[Path], step_count: int) -> None:
    expected_count = step_count + 1
    if len(frames) != expected_count:
        raise ValueError(
            f"{level_dir.name}: expected {expected_count} PNG frames for "
            f"{step_count} hotspots, found {len(frames)}"
        )
    expected_names = [f"{index:06d}{FRAME_SUFFIX}" for index in range(expected_count)]
    actual_names = [path.name for path in frames]
    if actual_names != expected_names:
        raise ValueError(f"{level_dir.name}: PNG frames are not sequential from 000000")


def build_manifest(content_root: Path) -> dict[str, object]:
    if not content_root.is_dir():
        raise FileNotFoundError(f"content root does not exist: {content_root}")

    level_dirs = sorted(path for path in content_root.iterdir() if path.is_dir())
    levels = []
    total_steps = 0

    for level_dir in level_dirs:
        hotspots = load_hotspots(level_dir)
        frames = sorted(level_dir.glob(f"*{FRAME_SUFFIX}"))
        validate_frames(level_dir, frames, len(hotspots))

        step_count = len(hotspots)
        total_steps += step_count
        levels.append(
            {
                "id": level_dir.name,
                "path": f"content/{content_root.name}/{level_dir.name}",
                "frameCount": len(frames),
                "interactiveStepCount": step_count,
                "frames": [path.name for path in frames],
                "hotspots": hotspots,
                "audio": {
                    "say": audio_indices(level_dir, "say"),
                    "sound": audio_indices(level_dir, "sound"),
                },
            }
        )

    return {
        "contentSet": content_root.name,
        "title": "Monkey See Monkey Do",
        "sourceSize": {"width": 1920, "height": 1080},
        "hotSpotSize": 50,
        "totalInteractiveSteps": total_steps,
        "levels": levels,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--content-root",
        type=Path,
        default=DEFAULT_CONTENT_ROOT,
        help="Path to the MSMD content set directory.",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=DEFAULT_OUTPUT,
        help="Manifest path to write.",
    )
    args = parser.parse_args()

    manifest = build_manifest(args.content_root)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("w", encoding="utf-8") as handle:
        json.dump(manifest, handle, indent=2)
        handle.write("\n")

    print(
        f"Wrote {args.output.relative_to(REPO_ROOT)}: "
        f"{len(manifest['levels'])} levels, "
        f"{manifest['totalInteractiveSteps']} interactive steps"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
