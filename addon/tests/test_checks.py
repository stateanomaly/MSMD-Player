from __future__ import annotations

import sys
from pathlib import Path


ADDON_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ADDON_DIR))

from msmd_guided import checks


def snapshot(**overrides):
    base = {
        "mode": "OBJECT",
        "active_object": "Sphere",
        "selected": ["Sphere"],
        "objects": [
            {
                "name": "Cube",
                "type": "MESH",
                "location": [0.0, 0.0, 0.0],
                "scale": [1.0, 1.0, 1.0],
            },
            {
                "name": "Sphere",
                "type": "MESH",
                "location": [1.0, 2.0, 3.0],
                "scale": [1.30005, 1.0, 1.0],
            },
            {
                "name": "Lamp",
                "type": "LIGHT",
                "location": [0.0, 0.0, 4.0],
                "scale": [1.0, 1.0, 1.0],
            },
        ],
        "filepath": "/tmp/lesson.blend",
        "is_dirty": False,
    }
    base.update(overrides)
    return base


def test_operator_glob_matching():
    assert checks.evaluate(
        {"type": "operator", "id": "mesh.primitive_*_add"},
        snapshot(),
        ["mesh.primitive_uv_sphere_add"],
    )
    assert not checks.evaluate(
        {"type": "operator", "id": "mesh.primitive_cube_add"},
        snapshot(),
        ["transform.resize"],
    )


def test_scene_exists_and_missing():
    snap = snapshot()
    assert checks.evaluate({"type": "scene_exists", "name": "Sphere"}, snap, [])
    assert checks.evaluate({"type": "scene_missing", "name": "Belly"}, snap, [])
    assert not checks.evaluate({"type": "scene_exists", "name": "Belly"}, snap, [])
    assert not checks.evaluate({"type": "scene_missing", "name": "Cube"}, snap, [])


def test_object_attr_numeric_ops_and_eq_tolerance():
    snap = snapshot()
    assert checks.evaluate(
        {"type": "object_attr", "name": "Sphere", "attr": "scale.x", "op": "gte", "value": 1.3},
        snap,
        [],
    )
    assert checks.evaluate(
        {"type": "object_attr", "name": "Sphere", "attr": "location.y", "op": "lte", "value": 2.0},
        snap,
        [],
    )
    assert checks.evaluate(
        {"type": "object_attr", "name": "Sphere", "attr": "location.z", "op": "gt", "value": 2.9},
        snap,
        [],
    )
    assert checks.evaluate(
        {"type": "object_attr", "name": "Sphere", "attr": "location.x", "op": "lt", "value": 1.1},
        snap,
        [],
    )
    assert checks.evaluate(
        {"type": "object_attr", "name": "Sphere", "attr": "scale.x", "op": "eq", "value": 1.3},
        snap,
        [],
    )
    assert not checks.evaluate(
        {"type": "object_attr", "name": "Sphere", "attr": "scale.x", "op": "eq", "value": 1.31},
        snap,
        [],
    )


def test_object_attr_missing_object_false():
    assert not checks.evaluate(
        {"type": "object_attr", "name": "Missing", "attr": "scale.x", "op": "gte", "value": 1.0},
        snapshot(),
        [],
    )


def test_mode_count_saved_and_unknown():
    snap = snapshot()
    assert checks.evaluate({"type": "mode", "mode": "OBJECT"}, snap, [])
    assert not checks.evaluate({"type": "mode", "mode": "EDIT_MESH"}, snap, [])
    assert checks.evaluate({"type": "count", "object_type": "MESH", "op": "gte", "value": 2}, snap, [])
    assert checks.evaluate({"type": "count", "object_type": "LIGHT", "op": "eq", "value": 1}, snap, [])
    assert not checks.evaluate({"type": "count", "object_type": "CAMERA", "op": "gt", "value": 0}, snap, [])
    assert checks.evaluate({"type": "saved"}, snap, [])
    assert not checks.evaluate({"type": "saved"}, snapshot(filepath=""), [])
    assert not checks.evaluate({"type": "saved"}, snapshot(is_dirty=True), [])
    assert not checks.evaluate({"type": "something_else"}, snap, [])


def test_all_any_nesting():
    check = {
        "all": [
            {"type": "mode", "mode": "OBJECT"},
            {
                "any": [
                    {"type": "operator", "id": "mesh.primitive_uv_sphere_add"},
                    {"type": "scene_exists", "name": "Sphere"},
                ]
            },
        ]
    }
    assert checks.evaluate(check, snapshot(), [])
    assert not checks.evaluate(
        {"all": [check, {"type": "scene_missing", "name": "Sphere"}]},
        snapshot(),
        [],
    )


def test_real_quest_check_delete_cube_pass_and_fail():
    check = {"type": "scene_missing", "name": "Cube"}
    assert checks.evaluate(check, snapshot(objects=[]), [])
    assert not checks.evaluate(check, snapshot(), [])


def test_real_quest_check_add_sphere_operator_or_state():
    check = {
        "any": [
            {"type": "operator", "id": "mesh.primitive_uv_sphere_add"},
            {"type": "scene_exists", "name": "Sphere"},
        ]
    }
    snap_without_sphere = snapshot(objects=[snapshot()["objects"][0]])
    assert checks.evaluate(check, snap_without_sphere, ["mesh.primitive_uv_sphere_add"])
    assert checks.evaluate(check, snapshot(), [])
    assert not checks.evaluate(check, snap_without_sphere, ["transform.resize"])


def test_real_quest_check_resize_sphere():
    check = {
        "all": [
            {"type": "operator", "id": "transform.resize"},
            {
                "type": "object_attr",
                "name": "Sphere",
                "attr": "scale.x",
                "op": "gte",
                "value": 1.3,
            },
        ]
    }
    assert checks.evaluate(check, snapshot(), ["transform.resize"])
    assert not checks.evaluate(check, snapshot(), ["mesh.primitive_uv_sphere_add"])
    small_sphere = snapshot(
        objects=[
            {
                "name": "Sphere",
                "type": "MESH",
                "location": [0.0, 0.0, 0.0],
                "scale": [1.0, 1.0, 1.0],
            }
        ]
    )
    assert not checks.evaluate(check, small_sphere, ["transform.resize"])


def test_real_quest_check_saved():
    check = {"type": "saved"}
    assert checks.evaluate(check, snapshot(), [])
    assert not checks.evaluate(check, snapshot(is_dirty=True), [])
    assert not checks.evaluate(check, snapshot(filepath=""), [])
