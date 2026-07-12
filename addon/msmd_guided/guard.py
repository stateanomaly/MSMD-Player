"""Pure state guard episode machine for MSMD Guided."""

from __future__ import annotations


RECOACH_SECONDS = 10.0


class GuardEpisode:
    """Debounce and cadence wrong-state coaching events."""

    def __init__(self, recoach_seconds: float = RECOACH_SECONDS) -> None:
        self.recoach_seconds = recoach_seconds
        self.state = "ok"
        self._last_wrong_emit_at: float | None = None

    def reset(self) -> None:
        self.state = "ok"
        self._last_wrong_emit_at = None

    def tick(self, guard_ok: bool, now: float) -> list[dict]:
        if guard_ok:
            messages = []
            if self.state == "wrong":
                messages.append({"type": "wrong_state_cleared"})
            self.reset()
            return messages

        if self.state == "ok":
            self.state = "suspect"
            return []

        if self.state == "suspect":
            self.state = "wrong"
            self._last_wrong_emit_at = now
            return [{"type": "wrong_state"}]

        if self._last_wrong_emit_at is None or now - self._last_wrong_emit_at >= self.recoach_seconds:
            self._last_wrong_emit_at = now
            return [{"type": "wrong_state"}]
        return []
