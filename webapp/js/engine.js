const STEP_KEY_WIDTH = 6;

function stepKey(index) {
  return String(index).padStart(STEP_KEY_WIDTH, "0");
}

export class GameEngine {
  constructor(manifest, callbacks = {}) {
    this.manifest = manifest;
    this.callbacks = callbacks;
    this.completionDelayMs = 900;
    this.pendingTimer = 0;
    this.reset();
  }

  reset() {
    this.clearPendingTimer();
    this.currentLevelIndex = 0;
    this.currentStepIndex = 0;
    this.completedSteps = 0;
    this.startTime = 0;
    this.state = "idle";
  }

  start() {
    this.reset();
    this.startTime = performance.now();
    this.showCurrentStep();
  }

  get currentLevel() {
    return this.manifest.levels[this.currentLevelIndex];
  }

  getExpectedInput() {
    if (this.state !== "playing") {
      return null;
    }
    return this.currentLevel.hotspots[stepKey(this.currentStepIndex)] || null;
  }

  markCorrect() {
    if (this.state !== "playing") {
      return;
    }

    const level = this.currentLevel;
    const stepIndex = this.currentStepIndex;
    this.callbacks.onCorrect?.({
      level,
      levelIndex: this.currentLevelIndex,
      stepIndex,
      completedSteps: this.completedSteps,
    });

    this.currentStepIndex += 1;
    this.completedSteps += 1;

    if (this.currentStepIndex >= level.interactiveStepCount) {
      this.showLevelCompletion();
      return;
    }

    this.showCurrentStep();
  }

  showCurrentStep() {
    this.state = "playing";
    const level = this.currentLevel;
    this.callbacks.onStep?.({
      level,
      levelIndex: this.currentLevelIndex,
      stepIndex: this.currentStepIndex,
      stepKey: stepKey(this.currentStepIndex),
      totalLevels: this.manifest.levels.length,
    });
  }

  showLevelCompletion() {
    this.state = "level-complete";
    const level = this.currentLevel;
    this.callbacks.onLevelCompletionFrame?.({
      level,
      levelIndex: this.currentLevelIndex,
      frameName: level.frames[level.frameCount - 1],
      totalLevels: this.manifest.levels.length,
    });

    this.pendingTimer = window.setTimeout(() => {
      this.pendingTimer = 0;
      if (this.currentLevelIndex >= this.manifest.levels.length - 1) {
        this.win();
        return;
      }
      this.currentLevelIndex += 1;
      this.currentStepIndex = 0;
      this.showCurrentStep();
    }, this.completionDelayMs);
  }

  win() {
    this.state = "won";
    const elapsedSeconds = (performance.now() - this.startTime) / 1000;
    this.callbacks.onWin?.({
      elapsedSeconds,
      level: this.currentLevel,
      levelIndex: this.currentLevelIndex,
      totalLevels: this.manifest.levels.length,
    });
  }

  clearPendingTimer() {
    if (this.pendingTimer) {
      window.clearTimeout(this.pendingTimer);
      this.pendingTimer = 0;
    }
  }
}
