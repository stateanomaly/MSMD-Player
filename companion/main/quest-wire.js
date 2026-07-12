function questLoadForWire(quest) {
  const payload = {
    quest_id: quest.id,
    harmless_ops: Array.isArray(quest.harmless_ops) ? quest.harmless_ops : [],
    steps: (Array.isArray(quest.steps) ? quest.steps : []).map((step) => {
      const wireStep = {
        id: step.id,
        check: step.check || {},
      };
      if (Array.isArray(step.expected_ops)) {
        wireStep.expected_ops = step.expected_ops;
      }
      if (step.state_after) {
        wireStep.state_after = step.state_after;
      }
      return wireStep;
    }),
  };
  if (quest.initial_state) {
    payload.initial_state = quest.initial_state;
  }
  return payload;
}

module.exports = {
  questLoadForWire,
};
