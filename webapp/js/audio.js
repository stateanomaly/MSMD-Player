const AUDIO_EXTENSIONS = Object.freeze({
  say: ".mp3",
  sound: ".wav",
});

export function audioFileName(kind, index) {
  const extension = AUDIO_EXTENSIONS[kind];
  if (!extension || !Number.isInteger(index) || index < 0) {
    return "";
  }
  return `${kind}${index}${extension}`;
}

function stopAudioElement(element) {
  element.pause();
  element.removeAttribute("src");
  element.load();
}

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
    stopAudioElement(this.narration);
  }

  stopCompletion() {
    stopAudioElement(this.completion);
  }

  stopAll() {
    this.stopNarration();
    this.stopCompletion();
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
