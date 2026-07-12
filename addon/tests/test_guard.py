from __future__ import annotations

import sys
from pathlib import Path


ADDON_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ADDON_DIR))

from msmd_guided.guard import GuardEpisode


def test_debounce_emits_wrong_state_on_second_failing_tick_only():
    episode = GuardEpisode()

    assert episode.tick(False, 100.0) == []
    assert episode.state == "suspect"
    assert episode.tick(False, 100.2) == [{"type": "wrong_state"}]
    assert episode.state == "wrong"
    assert episode.tick(False, 100.4) == []


def test_reemits_wrong_state_after_cadence():
    episode = GuardEpisode()

    assert episode.tick(False, 0.0) == []
    assert episode.tick(False, 0.2) == [{"type": "wrong_state"}]
    assert episode.tick(False, 10.1) == []
    assert episode.tick(False, 10.2) == [{"type": "wrong_state"}]


def test_clear_on_pass_emits_once():
    episode = GuardEpisode()

    episode.tick(False, 0.0)
    episode.tick(False, 0.2)

    assert episode.tick(True, 0.4) == [{"type": "wrong_state_cleared"}]
    assert episode.state == "ok"
    assert episode.tick(True, 0.6) == []


def test_reset_is_silent():
    episode = GuardEpisode()
    episode.tick(False, 0.0)
    episode.tick(False, 0.2)

    assert episode.state == "wrong"
    assert episode.reset() is None
    assert episode.state == "ok"
    assert episode.tick(True, 0.4) == []
