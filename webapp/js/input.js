const BUTTONS = new Map([
  [0, "left"],
  [1, "middle"],
  [2, "right"],
]);

const MODIFIER_CODES = new Map([
  ["ShiftLeft", "left shift"],
  ["ShiftRight", "right shift"],
  ["ControlLeft", "left ctrl"],
  ["ControlRight", "right ctrl"],
  ["AltLeft", "left alt"],
  ["AltRight", "right alt"],
  ["MetaLeft", "left meta"],
  ["MetaRight", "right meta"],
]);

const PROTECTED_KEY_NAMES = new Set(["tab", "backspace", "space"]);
const HOTSPOT_DIAMETER = 50;

function keyNameFromEvent(event) {
  if (event.key === "Enter") {
    return "enter";
  }
  if (event.key === " ") {
    return "space";
  }
  if (event.key === "Tab") {
    return "tab";
  }
  if (event.key === "Backspace") {
    return "backspace";
  }
  if (event.key === "." || event.code === "Period") {
    return ".";
  }
  if (event.key === "-" || event.code === "Minus") {
    return "-";
  }
  if (/^Digit\d$/.test(event.code)) {
    return event.code.slice(-1);
  }
  if (/^[a-z]$/i.test(event.key)) {
    return event.key.toLowerCase();
  }
  return event.key.toLowerCase();
}

function baseModifierName(modifier) {
  return modifier.replace(/^(left|right)\s+/, "");
}

function sideSpecificModifier(modifier) {
  const match = /^(left|right)\s+(shift|ctrl|alt|meta)$/.exec(modifier);
  if (!match) {
    return null;
  }
  return {
    side: match[1],
    base: match[2],
    opposite: `${match[1] === "left" ? "right" : "left"} ${match[2]}`,
  };
}

function normalizeModifier(modifier) {
  return modifier.trim().toLowerCase().replace(/\s+/g, " ");
}

function pressedModifierTokensFromKeyboard(activeCodes, event) {
  const tokens = new Set();
  for (const code of activeCodes) {
    const token = MODIFIER_CODES.get(code);
    if (token) {
      tokens.add(token);
    }
  }

  if (event.shiftKey && !tokens.has("left shift") && !tokens.has("right shift")) {
    tokens.add("shift");
  }
  if (event.ctrlKey && !tokens.has("left ctrl") && !tokens.has("right ctrl")) {
    tokens.add("ctrl");
  }
  if (event.altKey && !tokens.has("left alt") && !tokens.has("right alt")) {
    tokens.add("alt");
  }
  if (event.metaKey && !tokens.has("left meta") && !tokens.has("right meta")) {
    tokens.add("meta");
  }
  return tokens;
}

function pressedModifierTokensFromMouse(event) {
  const tokens = new Set();
  if (event.shiftKey) {
    tokens.add("shift");
  }
  if (event.ctrlKey) {
    tokens.add("ctrl");
  }
  if (event.altKey) {
    tokens.add("alt");
  }
  if (event.metaKey) {
    tokens.add("meta");
  }
  return tokens;
}

function modifiersMatch(requiredModifiers, pressedTokens, mode) {
  const required = requiredModifiers.map(normalizeModifier);
  const requiredExact = new Set();
  const requiredBase = new Set();

  for (const modifier of required) {
    if (mode === "mouse") {
      requiredBase.add(baseModifierName(modifier));
    } else {
      requiredExact.add(modifier);
      requiredBase.add(baseModifierName(modifier));
    }
  }

  const pressedExact = new Set(pressedTokens);
  const pressedBase = new Set(Array.from(pressedTokens, baseModifierName));

  if (pressedBase.size !== requiredBase.size) {
    return false;
  }
  for (const modifier of requiredBase) {
    if (!pressedBase.has(modifier)) {
      return false;
    }
  }

  if (mode === "mouse") {
    return true;
  }

  for (const modifier of requiredExact) {
    const sideSpecific = sideSpecificModifier(modifier);
    if (sideSpecific) {
      if (!pressedExact.has(modifier)) {
        return false;
      }
      if (pressedExact.has(sideSpecific.opposite)) {
        return false;
      }
      continue;
    }
    if (!pressedBase.has(modifier)) {
      return false;
    }
  }
  return true;
}

export class InputController {
  constructor(surface, options) {
    this.surface = surface;
    this.getExpectedInput = options.getExpectedInput;
    this.getImageRect = options.getImageRect;
    this.onCorrect = options.onCorrect;
    this.enabled = false;
    this.activeModifierCodes = new Set();

    this.handleMouseDown = this.handleMouseDown.bind(this);
    this.handleKeyDown = this.handleKeyDown.bind(this);
    this.handleKeyUp = this.handleKeyUp.bind(this);
    this.handleBlur = this.handleBlur.bind(this);
    this.preventContextMenu = this.preventContextMenu.bind(this);

    this.surface.addEventListener("mousedown", this.handleMouseDown);
    this.surface.addEventListener("contextmenu", this.preventContextMenu);
    window.addEventListener("keydown", this.handleKeyDown);
    window.addEventListener("keyup", this.handleKeyUp);
    window.addEventListener("blur", this.handleBlur);
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    if (!enabled) {
      this.activeModifierCodes.clear();
    }
  }

  preventContextMenu(event) {
    event.preventDefault();
  }

  handleMouseDown(event) {
    if (!this.enabled) {
      return;
    }
    event.preventDefault();

    const expected = this.getExpectedInput();
    if (!expected || expected.type !== "mouse") {
      return;
    }

    const pressedButton = BUTTONS.get(event.button);
    if (pressedButton !== expected.button) {
      return;
    }

    const imageRect = this.getImageRect();
    if (!imageRect || imageRect.width <= 0 || imageRect.height <= 0) {
      return;
    }
    if (
      event.clientX < imageRect.left ||
      event.clientX > imageRect.right ||
      event.clientY < imageRect.top ||
      event.clientY > imageRect.bottom
    ) {
      return;
    }

    const sourceX = ((event.clientX - imageRect.left) / imageRect.width) * 1920;
    const sourceY = ((event.clientY - imageRect.top) / imageRect.height) * 1080;
    const [hotspotX, hotspotY] = expected.position;
    const radius = HOTSPOT_DIAMETER / 2;
    const distanceSquared = (sourceX - hotspotX) ** 2 + (sourceY - hotspotY) ** 2;
    if (distanceSquared > radius ** 2) {
      return;
    }

    if (!modifiersMatch(expected.modifiers || [], pressedModifierTokensFromMouse(event), "mouse")) {
      return;
    }

    this.onCorrect();
  }

  handleKeyDown(event) {
    if (MODIFIER_CODES.has(event.code)) {
      this.activeModifierCodes.add(event.code);
    }

    if (!this.enabled) {
      return;
    }

    const expected = this.getExpectedInput();
    if (!expected || expected.type !== "key") {
      return;
    }

    const pressedKey = keyNameFromEvent(event);
    if (PROTECTED_KEY_NAMES.has(pressedKey) || PROTECTED_KEY_NAMES.has(expected.name)) {
      event.preventDefault();
    }

    if (event.repeat) {
      return;
    }
    if (pressedKey !== String(expected.name).toLowerCase()) {
      return;
    }

    const pressedModifiers = pressedModifierTokensFromKeyboard(this.activeModifierCodes, event);
    if (!modifiersMatch(expected.modifiers || [], pressedModifiers, "keyboard")) {
      return;
    }

    event.preventDefault();
    this.onCorrect();
  }

  handleKeyUp(event) {
    if (MODIFIER_CODES.has(event.code)) {
      this.activeModifierCodes.delete(event.code);
    }
  }

  handleBlur() {
    this.activeModifierCodes.clear();
  }
}
