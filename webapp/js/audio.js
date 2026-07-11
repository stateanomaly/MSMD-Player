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

function playAudioElement(element, url, { restart = true } = {}) {
  if (!url) {
    return element;
  }
  if (restart) {
    element.pause();
  }
  element.src = url;
  element.currentTime = 0;
  void element.play().catch(() => {});
  return element;
}

export class AudioManager {
  constructor() {
    this.narration = new Audio();
    this.narration.preload = "auto";
    this.completion = new Audio();
    this.completion.preload = "auto";
    this.voice = new Audio();
    this.voice.preload = "auto";
    this.sfx = new Audio();
    this.sfx.preload = "auto";
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

  stopVoice() {
    stopAudioElement(this.voice);
  }

  stopSfx() {
    stopAudioElement(this.sfx);
  }

  stopAll() {
    this.stopNarration();
    this.stopCompletion();
    this.stopVoice();
    this.stopSfx();
  }

  playNarration(url) {
    this.stopNarration();
    return playAudioElement(this.narration, url);
  }

  playCompletion(url) {
    return playAudioElement(this.completion, url);
  }

  playVoice(url) {
    return playAudioElement(this.voice, url);
  }

  playSfx(url) {
    return playAudioElement(this.sfx, url);
  }
}
