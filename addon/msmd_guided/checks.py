"""Pure quest predicate evaluation for MSMD Guided."""

from __future__ import annotations

import fnmatch
from typing import Any


_EQ_TOLERANCE = 1e-4


def evaluate(check: dict[str, Any], snapshot: dict[str, Any], op_log: list[str]) -> bool:
    """Return whether a quest check passes.

    This module is intentionally stdlib-only so it can be tested without
    Blender installed. Unknown or malformed predicates fail closed.
    """

    try:
        return _evaluate(check, snapshot, op_log)
    except Exception:
        return False


def _evaluate(check: dict[str, Any], snapshot: dict[str, Any], op_log: list[str]) -> bool:
    if not isinstance(check, dict):
        return False

    if "all" in check:
        items = check.get("all")
        if not isinstance(items, list):
            return False
        return all(evaluate(item, snapshot, op_log) for item in items)

    if "any" in check:
        items = check.get("any")
        if not isinstance(items, list):
            return False
        return any(evaluate(item, snapshot, op_log) for item in items)

    predicate_type = check.get("type")
    if predicate_type == "operator":
        pattern = check.get("id")
        if not isinstance(pattern, str):
            return False
        return any(fnmatch.fnmatchcase(op_id, pattern) for op_id in op_log)

    if predicate_type == "scene_exists":
        name = check.get("name")
        return isinstance(name, str) and _find_object(snapshot, name) is not None

    if predicate_type == "scene_missing":
        name = check.get("name")
        return isinstance(name, str) and _find_object(snapshot, name) is None

    if predicate_type == "object_attr":
        obj = _find_object(snapshot, check.get("name"))
        if obj is None:
            return False
        current = _object_attr(obj, check.get("attr"))
        return _compare(current, check.get("op"), check.get("value"))

    if predicate_type == "mode":
        return snapshot.get("mode") == check.get("mode")

    if predicate_type == "count":
        object_type = check.get("object_type")
        if not isinstance(object_type, str):
            return False
        count = sum(1 for obj in _objects(snapshot) if obj.get("type") == object_type)
        return _compare(count, check.get("op"), check.get("value"))

    if predicate_type == "saved":
        return bool(snapshot.get("filepath")) and snapshot.get("is_dirty") is False

    return False


def _objects(snapshot: dict[str, Any]) -> list[dict[str, Any]]:
    objects = snapshot.get("objects", [])
    if not isinstance(objects, list):
        return []
    return [obj for obj in objects if isinstance(obj, dict)]


def _find_object(snapshot: dict[str, Any], name: Any) -> dict[str, Any] | None:
    if not isinstance(name, str):
        return None
    for obj in _objects(snapshot):
        if obj.get("name") == name:
            return obj
    return None


def _object_attr(obj: dict[str, Any], attr: Any) -> float | None:
    if not isinstance(attr, str):
        return None

    parts = attr.split(".")
    if len(parts) != 2:
        return None

    vector_name, axis = parts
    if vector_name not in {"location", "scale"} or axis not in {"x", "y", "z"}:
        return None

    vector = obj.get(vector_name)
    if not isinstance(vector, (list, tuple)) or len(vector) < 3:
        return None

    index = {"x": 0, "y": 1, "z": 2}[axis]
    value = vector[index]
    if isinstance(value, bool):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _compare(left: Any, op: Any, right: Any) -> bool:
    if op not in {"gte", "lte", "gt", "lt", "eq"}:
        return False
    if isinstance(left, bool) or isinstance(right, bool):
        return False
    try:
        left_value = float(left)
        right_value = float(right)
    except (TypeError, ValueError):
        return False

    if op == "gte":
        return left_value >= right_value
    if op == "lte":
        return left_value <= right_value
    if op == "gt":
        return left_value > right_value
    if op == "lt":
        return left_value < right_value
    return abs(left_value - right_value) <= _EQ_TOLERANCE
