const assert = require("node:assert/strict");
const { test } = require("node:test");
const { questLoadForWire } = require("../main/quest-wire");

test("questLoadForWire preserves existing id and check shape", () => {
  const wire = questLoadForWire({
    id: "quest-a",
    harmless_ops: ["view3d.*"],
    steps: [
      { id: "s0", check: { type: "scene_missing", name: "Cube" }, narration_text: "unused" },
      { id: "s1" },
    ],
  });

  assert.deepEqual(wire, {
    quest_id: "quest-a",
    harmless_ops: ["view3d.*"],
    steps: [
      { id: "s0", check: { type: "scene_missing", name: "Cube" } },
      { id: "s1", check: {} },
    ],
  });
});

test("questLoadForWire passes through guard fields when present", () => {
  const initialState = { type: "scene_exists", name: "Cube" };
  const stateAfter = { type: "scene_missing", name: "Cube" };
  const wire = questLoadForWire({
    id: "quest-b",
    initial_state: initialState,
    steps: [
      {
        id: "s0",
        expected_ops: ["object.delete"],
        check: { type: "scene_missing", name: "Cube" },
        state_after: stateAfter,
      },
    ],
  });

  assert.deepEqual(wire, {
    quest_id: "quest-b",
    harmless_ops: [],
    initial_state: initialState,
    steps: [
      {
        id: "s0",
        expected_ops: ["object.delete"],
        check: { type: "scene_missing", name: "Cube" },
        state_after: stateAfter,
      },
    ],
  });
});

test("questLoadForWire omits optional guard fields when absent", () => {
  const wire = questLoadForWire({
    id: "quest-c",
    steps: [{ id: "s0", check: { type: "saved" } }],
  });

  assert.equal(Object.hasOwn(wire, "initial_state"), false);
  assert.equal(Object.hasOwn(wire.steps[0], "expected_ops"), false);
  assert.equal(Object.hasOwn(wire.steps[0], "state_after"), false);
});
