export class GuidedEngine {
  constructor(quest, callbacks = {}) {
    this.quest = quest || {};
    this.steps = Array.isArray(this.quest.steps) ? this.quest.steps : [];
    this.callbacks = callbacks;
    this.currentIndex = 0;
    this.state = "idle";
  }

  start() {
    this.currentIndex = 0;
    if (!this.steps.length) {
      this.state = "complete";
      this.callbacks.onWin?.({ quest: this.quest, elapsedSeconds: 0 });
      return;
    }
    this.state = "running";
    this.emitStep();
  }

  currentStep() {
    return this.steps[this.currentIndex] || null;
  }

  onStepVerified(stepId) {
    if (this.state !== "running") {
      return false;
    }
    const step = this.currentStep();
    if (!step || step.id !== stepId) {
      return false;
    }

    const finishedIndex = this.currentIndex;
    this.callbacks.onCorrect?.({
      quest: this.quest,
      step,
      stepIndex: finishedIndex,
    });

    this.currentIndex += 1;
    if (this.currentIndex >= this.steps.length) {
      this.state = "complete";
      this.callbacks.onWin?.({
        quest: this.quest,
        elapsedSeconds: 0,
      });
      return true;
    }

    this.emitStep();
    return true;
  }

  emitStep() {
    const step = this.currentStep();
    if (!step) {
      return;
    }
    this.callbacks.onStep?.({
      quest: this.quest,
      step,
      stepIndex: this.currentIndex,
      totalSteps: this.steps.length,
    });
  }
}
