"""Main-thread scene watcher for MSMD Guided."""

from __future__ import annotations

import fnmatch
import queue
import time
from typing import Any

import bpy
from bpy.app.handlers import persistent

from . import checks
from .guard import GuardEpisode


TIMER_INTERVAL = 0.2
_DESTRUCTIVE_OPS = {"wm.read_homefile", "wm.open_mainfile", "scene.delete"}

_server: Any = None
_registered = False
_dirty = True
_force_snapshot = False
_tick_count = 0
_last_snapshot: dict[str, Any] | None = None
_last_operator_pointer: int | None = None
_last_operator_len = 0

_quest_id: str | None = None
_harmless_ops: list[str] = []
_steps: list[dict[str, Any]] = []
_step_by_id: dict[str, dict[str, Any]] = {}
_active_step_id: str | None = None
_active_check: dict[str, Any] | None = None
_step_op_log: list[str] = []
_last_non_harmless_step_op = ""
_guard_check: dict[str, Any] | None = None
_guard_step_id = "initial"
_guard_episode = GuardEpisode()


@persistent
def depsgraph_dirty(_scene: Any, _depsgraph: Any) -> None:
    global _dirty
    _dirty = True


def register(server: Any) -> None:
    global _server, _registered

    _server = server
    _reset_runtime_state()
    _mark_operator_tail()

    if depsgraph_dirty not in bpy.app.handlers.depsgraph_update_post:
        bpy.app.handlers.depsgraph_update_post.append(depsgraph_dirty)

    if not bpy.app.timers.is_registered(tick):
        bpy.app.timers.register(tick, first_interval=TIMER_INTERVAL, persistent=True)

    _registered = True


def unregister() -> None:
    global _server, _registered

    try:
        if bpy.app.timers.is_registered(tick):
            bpy.app.timers.unregister(tick)
    except ValueError:
        pass

    while depsgraph_dirty in bpy.app.handlers.depsgraph_update_post:
        bpy.app.handlers.depsgraph_update_post.remove(depsgraph_dirty)

    _server = None
    _registered = False
    _reset_runtime_state()


def tick() -> float:
    global _dirty, _force_snapshot, _tick_count, _last_snapshot

    _tick_count += 1
    _drain_inbox()
    _diff_operator_history()

    window = build_window_snapshot()
    window_changed = _last_snapshot is not None and window != _last_snapshot.get("window")
    should_rebuild = (
        _force_snapshot
        or _dirty
        or window_changed
        or _last_snapshot is None
        or _tick_count % 10 == 0
    )
    if should_rebuild:
        snapshot = build_snapshot(window=window)
        if _force_snapshot or snapshot != _last_snapshot:
            _emit_snapshot(snapshot)
        _last_snapshot = snapshot
        _dirty = False
        _force_snapshot = False

    if _active_step_id and _active_check and _last_snapshot is not None:
        if checks.evaluate(_active_check, _last_snapshot, _step_op_log):
            _verify_active_step()

    if _last_snapshot is not None:
        _tick_guard()

    return TIMER_INTERVAL


def build_snapshot(window: dict[str, int] | None = None) -> dict[str, Any]:
    context = bpy.context
    scene = context.scene
    active_object = context.view_layer.objects.active

    objects = []
    for obj in sorted(scene.objects, key=lambda item: item.name):
        objects.append(
            {
                "name": obj.name,
                "type": obj.type,
                "location": [float(obj.location.x), float(obj.location.y), float(obj.location.z)],
                "scale": [float(obj.scale.x), float(obj.scale.y), float(obj.scale.z)],
            }
        )

    return {
        "mode": getattr(context, "mode", "UNKNOWN"),
        "active_object": active_object.name if active_object else None,
        "selected": sorted(obj.name for obj in context.selected_objects),
        "objects": objects,
        "filepath": bpy.data.filepath,
        "is_dirty": bool(bpy.data.is_dirty),
        "window": window,
    }


def build_window_snapshot() -> dict[str, int] | None:
    try:
        windows = list(bpy.context.window_manager.windows)
    except Exception:
        return None

    best_window = None
    best_area = -1
    for window in windows:
        try:
            width = int(window.width)
            height = int(window.height)
        except Exception:
            continue
        area = width * height
        if area > best_area:
            best_area = area
            best_window = window

    if best_window is None:
        return None

    try:
        return {
            "x": int(best_window.x),
            "y": int(best_window.y),
            "width": int(best_window.width),
            "height": int(best_window.height),
        }
    except Exception:
        return None


def _reset_runtime_state() -> None:
    global _dirty, _force_snapshot, _tick_count, _last_snapshot
    global _last_operator_pointer, _last_operator_len
    global _quest_id, _harmless_ops, _steps, _step_by_id
    global _active_step_id, _active_check, _step_op_log, _last_non_harmless_step_op
    global _guard_check, _guard_step_id

    _dirty = True
    _force_snapshot = False
    _tick_count = 0
    _last_snapshot = None
    _last_operator_pointer = None
    _last_operator_len = 0
    _quest_id = None
    _harmless_ops = []
    _steps = []
    _step_by_id = {}
    _active_step_id = None
    _active_check = None
    _step_op_log = []
    _last_non_harmless_step_op = ""
    _guard_check = None
    _guard_step_id = "initial"
    _guard_episode.reset()


def _drain_inbox() -> None:
    if _server is None:
        return

    while True:
        try:
            message = _server.inbox.get_nowait()
        except queue.Empty:
            return
        _handle_message(message)


def _handle_message(message: dict[str, Any]) -> None:
    global _force_snapshot

    message_type = message.get("type")
    if message_type in {"hello", "pong"}:
        return
    if message_type == "quest_load":
        _handle_quest_load(message)
        return
    if message_type == "step_begin":
        _handle_step_begin(message)
        return
    if message_type == "snapshot_request":
        _force_snapshot = True
        return
    if message_type == "ping":
        _enqueue({"type": "pong", "t": message.get("t")})
        return

    _enqueue({"type": "error", "message": f"unknown type: {message_type}"})


def _handle_quest_load(message: dict[str, Any]) -> None:
    global _quest_id, _harmless_ops, _steps, _step_by_id
    global _active_step_id, _active_check, _step_op_log, _last_non_harmless_step_op
    global _guard_check, _guard_step_id

    quest_id = message.get("quest_id")
    steps = message.get("steps")
    harmless_ops = message.get("harmless_ops", [])
    initial_state = message.get("initial_state")

    if not isinstance(quest_id, str) or not isinstance(steps, list):
        _enqueue(
            {
                "type": "quest_loaded",
                "quest_id": quest_id,
                "ok": False,
                "error": "quest_id must be a string and steps must be a list",
            }
        )
        return

    if initial_state is not None and not isinstance(initial_state, dict):
        _enqueue(
            {
                "type": "quest_loaded",
                "quest_id": quest_id,
                "ok": False,
                "error": "initial_state must be an object when present",
            }
        )
        return
    if _operator_predicate_ids(initial_state):
        _enqueue(
            {
                "type": "quest_loaded",
                "quest_id": quest_id,
                "ok": False,
                "error": "initial_state must not contain operator predicates",
            }
        )
        return

    loaded_steps = []
    step_by_id = {}
    for step in steps:
        if not isinstance(step, dict):
            _enqueue(
                {
                    "type": "quest_loaded",
                    "quest_id": quest_id,
                    "ok": False,
                    "error": "each step must be an object",
                }
            )
            return
        step_id = step.get("id")
        check = step.get("check")
        if not isinstance(step_id, str) or not isinstance(check, dict):
            _enqueue(
                {
                    "type": "quest_loaded",
                    "quest_id": quest_id,
                    "ok": False,
                    "error": "each step needs a string id and object check",
                }
            )
            return
        state_after = step.get("state_after")
        if state_after is not None and not isinstance(state_after, dict):
            _enqueue(
                {
                    "type": "quest_loaded",
                    "quest_id": quest_id,
                    "ok": False,
                    "error": f"state_after for step {step_id} must be an object when present",
                }
            )
            return
        if _operator_predicate_ids(state_after):
            _enqueue(
                {
                    "type": "quest_loaded",
                    "quest_id": quest_id,
                    "ok": False,
                    "error": f"state_after for step {step_id} must not contain operator predicates",
                }
            )
            return

        expected_ops = step.get("expected_ops", [])
        if expected_ops is None:
            expected_ops = []
        if not isinstance(expected_ops, list):
            _enqueue(
                {
                    "type": "quest_loaded",
                    "quest_id": quest_id,
                    "ok": False,
                    "error": f"expected_ops for step {step_id} must be a list when present",
                }
            )
            return

        loaded_step = {
            "id": step_id,
            "check": check,
            "expected_ops": [op for op in expected_ops if isinstance(op, str)],
        }
        if state_after is not None:
            loaded_step["state_after"] = state_after
        loaded_steps.append(loaded_step)
        step_by_id[step_id] = loaded_step

    _quest_id = quest_id
    _harmless_ops = [op for op in harmless_ops if isinstance(op, str)]
    _steps = loaded_steps
    _step_by_id = step_by_id
    _active_step_id = None
    _active_check = None
    _step_op_log = []
    _last_non_harmless_step_op = ""
    _guard_check = initial_state
    _guard_step_id = "initial"
    _guard_episode.reset()
    _enqueue({"type": "quest_loaded", "quest_id": quest_id, "ok": True})


def _handle_step_begin(message: dict[str, Any]) -> None:
    global _active_step_id, _active_check, _step_op_log, _last_non_harmless_step_op, _dirty

    step_id = message.get("step_id")
    step = _step_by_id.get(step_id)
    if step is None:
        _enqueue({"type": "error", "message": f"unknown step_id: {step_id}"})
        return

    _active_step_id = step_id
    _active_check = step["check"]
    _step_op_log = []
    _last_non_harmless_step_op = ""
    _guard_episode.reset()
    _dirty = True
    _mark_operator_tail()


def _diff_operator_history() -> None:
    global _last_operator_pointer, _last_operator_len

    operators = _operator_history()
    if not operators:
        _last_operator_pointer = None
        _last_operator_len = 0
        return

    new_ops = []
    if _last_operator_pointer is None:
        new_ops = operators if _last_operator_len == 0 else operators[-_last_operator_len:]
    else:
        for index in range(len(operators) - 1, -1, -1):
            if _operator_pointer(operators[index]) == _last_operator_pointer:
                new_ops = operators[index + 1 :]
                break
        else:
            new_ops = operators

    for op in new_ops:
        _emit_operator(op)

    _last_operator_pointer = _operator_pointer(operators[-1])
    _last_operator_len = len(operators)


def _mark_operator_tail() -> None:
    global _last_operator_pointer, _last_operator_len

    operators = _operator_history()
    if operators:
        _last_operator_pointer = _operator_pointer(operators[-1])
        _last_operator_len = len(operators)
    else:
        _last_operator_pointer = None
        _last_operator_len = 0


def _operator_history() -> list[Any]:
    try:
        operators = bpy.context.window_manager.operators
    except Exception:
        operators = None

    if operators is None:
        try:
            managers = bpy.data.window_managers
            operators = managers[0].operators if managers else []
        except Exception:
            operators = []

    try:
        return list(operators)
    except TypeError:
        return []


def _emit_operator(op: Any) -> None:
    global _step_op_log, _last_non_harmless_step_op

    op_id = _normalize_operator_id(_operator_id(op))
    if not op_id:
        return

    classification = _classify_operator(op_id)
    if _active_step_id:
        _step_op_log.append(op_id)
        if classification != "harmless":
            _last_non_harmless_step_op = op_id

    now = time.time()
    _enqueue(
        {
            "type": "operator_event",
            "op_id": op_id,
            "props_summary": _props_summary(op),
            "classification": classification,
            "t": now,
        }
    )

    if _active_step_id and classification == "unexpected":
        _enqueue(
            {
                "type": "deviation",
                "step_id": _active_step_id,
                "op_id": op_id,
                "severity": "major" if op_id in _DESTRUCTIVE_OPS else "minor",
                "t": now,
            }
        )


def _classify_operator(op_id: str) -> str:
    for pattern in _operator_predicate_ids(_active_check):
        if fnmatch.fnmatchcase(op_id, pattern):
            return "expected"
    active_step = _step_by_id.get(_active_step_id)
    for pattern in active_step.get("expected_ops", []) if active_step else []:
        if fnmatch.fnmatchcase(op_id, pattern):
            return "expected"
    for pattern in _harmless_ops:
        if fnmatch.fnmatchcase(op_id, pattern):
            return "harmless"
    return "unexpected"


def _operator_predicate_ids(check: Any) -> list[str]:
    if not isinstance(check, dict):
        return []

    found = []
    if check.get("type") == "operator" and isinstance(check.get("id"), str):
        found.append(check["id"])

    for key in ("all", "any"):
        items = check.get(key)
        if isinstance(items, list):
            for item in items:
                found.extend(_operator_predicate_ids(item))

    return found


def _verify_active_step() -> None:
    global _active_step_id, _active_check, _step_op_log, _last_non_harmless_step_op
    global _guard_check, _guard_step_id

    step_id = _active_step_id
    if not step_id:
        return

    _enqueue({"type": "step_verified", "step_id": step_id, "t": time.time()})
    step = _step_by_id.get(step_id)
    if step and "state_after" in step:
        _guard_check = step["state_after"]
        _guard_step_id = step_id
    _guard_episode.reset()

    if _quest_id and _steps and _steps[-1]["id"] == step_id:
        _enqueue({"type": "quest_complete", "quest_id": _quest_id})

    _active_step_id = None
    _active_check = None
    _step_op_log = []
    _last_non_harmless_step_op = ""


def _tick_guard() -> None:
    guard_ok = checks.evaluate(_guard_check, _last_snapshot, []) if _guard_check else True
    now = time.time()
    for message in _guard_episode.tick(guard_ok, now):
        if message.get("type") == "wrong_state":
            _enqueue(
                {
                    "type": "wrong_state",
                    "guard_step_id": _guard_step_id,
                    "step_id": _active_step_id or "",
                    "op_id": _last_non_harmless_step_op,
                    "t": now,
                }
            )
        elif message.get("type") == "wrong_state_cleared":
            _enqueue(
                {
                    "type": "wrong_state_cleared",
                    "guard_step_id": _guard_step_id,
                    "step_id": _active_step_id or "",
                    "t": now,
                }
            )


def _emit_snapshot(snapshot: dict[str, Any]) -> None:
    payload = dict(snapshot)
    payload["type"] = "state_snapshot"
    payload["t"] = time.time()
    _enqueue(payload)


def _enqueue(message: dict[str, Any]) -> None:
    if _server is not None:
        _server.enqueue(message)


def _operator_pointer(op: Any) -> int | None:
    try:
        return int(op.as_pointer())
    except Exception:
        return None


def _operator_id(op: Any) -> str:
    for attr in ("bl_idname", "idname"):
        value = getattr(op, attr, None)
        if isinstance(value, str) and value:
            return value
    try:
        identifier = op.bl_rna.identifier
    except Exception:
        identifier = ""
    return identifier if isinstance(identifier, str) else ""


def _normalize_operator_id(op_id: str) -> str:
    if not op_id:
        return ""
    op_id = op_id.strip()
    if "_OT_" in op_id:
        prefix, suffix = op_id.split("_OT_", 1)
        return f"{prefix.lower()}.{suffix.lower()}"
    return op_id.lower()


def _props_summary(op: Any) -> str:
    props = getattr(op, "properties", op)
    try:
        rna_props = props.bl_rna.properties
    except Exception:
        return ""

    pairs = []
    for prop in rna_props:
        name = getattr(prop, "identifier", "")
        if not name or name == "rna_type" or getattr(prop, "is_hidden", False):
            continue
        try:
            value = getattr(props, name)
        except Exception:
            continue
        text = repr(value)
        if len(text) > 40:
            text = text[:37] + "..."
        pairs.append(f"{name}={text}")
        if len(pairs) >= 5:
            break

    return ", ".join(pairs)
