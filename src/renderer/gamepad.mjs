export class GamepadReader {
  constructor() {
    this.selectedIndex = "auto";
    this.axisX = 0;
    this.axisY = 1;
    this.axisXSign = 1;
    this.axisYSign = -1;
    this.axisXScale = 1;
    this.axisYScale = 1;
    this.bButton = 0;
    this.deadzone = 0.08;
    this.centerOffset = { x: 0, y: 0 };
  }

  listGamepads() {
    if (!navigator.getGamepads) {
      return [];
    }

    return Array.from(navigator.getGamepads()).filter(Boolean);
  }

  setSelectedIndex(value) {
    this.selectedIndex = value;
  }

  setAxisX(value) {
    this.axisX = Number(value);
    this.axisXSign = 1;
    this.axisXScale = 1;
  }

  setAxisY(value) {
    this.axisY = Number(value);
    this.axisYSign = -1;
    this.axisYScale = 1;
  }

  setAxisMapping({ axisX, axisY, axisXSign, axisYSign, axisXScale = 1, axisYScale = 1, centerOffset }) {
    this.axisX = Number(axisX);
    this.axisY = Number(axisY);
    this.axisXSign = Math.sign(Number(axisXSign)) || 1;
    this.axisYSign = Math.sign(Number(axisYSign)) || -1;
    this.axisXScale = clamp(Number(axisXScale) || 1, 0.75, 2.5);
    this.axisYScale = clamp(Number(axisYScale) || 1, 0.75, 2.5);

    if (centerOffset) {
      this.centerOffset = {
        x: Number(centerOffset.x) || 0,
        y: Number(centerOffset.y) || 0
      };
    }
  }

  setBButton(value) {
    this.bButton = Number(value);
  }

  setDeadzone(value) {
    this.deadzone = Number(value);
  }

  calibrateCenter() {
    const gamepad = this.getSelectedGamepad();

    if (!gamepad) {
      this.centerOffset = { x: 0, y: 0 };
      return;
    }

    this.centerOffset = {
      x: gamepad.axes[this.axisX] ?? 0,
      y: gamepad.axes[this.axisY] ?? 0
    };
  }

  getAxisSnapshot() {
    const gamepad = this.getSelectedGamepad();
    return gamepad ? Array.from(gamepad.axes) : [];
  }

  getButtonSnapshot() {
    const gamepad = this.getSelectedGamepad();
    return gamepad ? Array.from(gamepad.buttons).map((button) => button.value) : [];
  }

  getSelectedGamepad() {
    const gamepads = this.listGamepads();

    if (this.selectedIndex === "auto") {
      return gamepads[0] ?? null;
    }

    return gamepads.find((gamepad) => String(gamepad.index) === String(this.selectedIndex)) ?? null;
  }

  read() {
    const gamepad = this.getSelectedGamepad();

    if (!gamepad) {
      return {
        connected: false,
        id: "",
        x: 0,
        y: 0,
        rawX: 0,
        rawY: 0,
        bPressed: false,
        bValue: 0
      };
    }

    const rawX = ((gamepad.axes[this.axisX] ?? 0) - this.centerOffset.x) * this.axisXSign * this.axisXScale;
    const rawY = ((gamepad.axes[this.axisY] ?? 0) - this.centerOffset.y) * this.axisYSign * this.axisYScale;
    const normalized = applyCircularDeadzone(rawX, rawY, this.deadzone);
    const button = gamepad.buttons[this.bButton];
    const bValue = button ? button.value : 0;

    return {
      connected: true,
      id: gamepad.id,
      index: gamepad.index,
      x: normalized.x,
      y: normalized.y,
      rawX,
      rawY,
      bPressed: Boolean(button?.pressed || bValue > 0.5),
      bValue
    };
  }
}

function applyCircularDeadzone(x, y, deadzone) {
  const magnitude = Math.hypot(x, y);

  if (magnitude <= deadzone) {
    return { x: 0, y: 0 };
  }

  const scaled = Math.min(1, (magnitude - deadzone) / (1 - deadzone));
  return {
    x: (x / magnitude) * scaled,
    y: (y / magnitude) * scaled
  };
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
