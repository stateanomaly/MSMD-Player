export class AudioManager {
  constructor() {
    this.narration = new Audio();
    this.narration.preload = "auto";
    this.completion = new Audio();
    this.completion.preload = "auto";
  }

  async unlock() {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) {
      return;
    }
    if (!this.audioContext) {
      this.audioContext = new AudioContextClass();
    }
    if (this.audioContext.state === "suspended") {
      await this.audioContext.resume();
    }
  }

  stopNarration() {
    this.narration.pause();
    this.narration.removeAttribute("src");
    this.narration.load();
  }

  playNarration(url) {
    this.stopNarration();
    if (!url) {
      return;
    }
    this.narration.src = url;
    this.narration.currentTime = 0;
    void this.narration.play().catch(() => {});
  }

  playCompletion(url) {
    if (!url) {
      return;
    }
    this.completion.pause();
    this.completion.src = url;
    this.completion.currentTime = 0;
    void this.completion.play().catch(() => {});
  }
}
