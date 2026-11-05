import { ActionBehavior, TouchActionRouter } from "./TouchActionRouter.js";

const MOVE_KEYS = new Set([
  "KeyW",
  "KeyA",
  "KeyS",
  "KeyD",
  "ArrowUp",
  "ArrowLeft",
  "ArrowDown",
  "ArrowRight",
]);
const SPRINT_KEYS = new Set(["ShiftLeft", "ShiftRight"]);
const GAME_KEYS = new Set([
  ...MOVE_KEYS,
  ...SPRINT_KEYS,
  "KeyR",
  "KeyF",
  "KeyE",
]);
const DEAD_ZONE = 0.1;

/**
 * Device input only: no world-space, camera, animation, or physics knowledge.
 * move.x is screen-right and move.y is screen-forward, each normalized to [-1, 1].
 * Camera deltas use CSS pixels, independent of the renderer's device pixel ratio.
 */
export class InputController {
  constructor({
    joystick,
    joystickKnob,
    sprintButton,
    cameraSurface,
    resetButton,
    fightButton,
    dashButton,
    onReset,
    actionRoot = document.documentElement,
    actionBindings = [],
  }) {
    this.joystick = joystick;
    this.joystickKnob = joystickKnob;
    this.sprintButton = sprintButton;
    this.cameraSurface = cameraSurface;
    this.fightButton = fightButton;
    this.dashButton = dashButton;
    this.onReset = onReset ?? (() => {});

    this.move = { x: 0, y: 0 };
    this.sprinting = false;
    // Stance is a persistent selection, unlike held movement/sprint input.
    this.fighting = false;
    this.dashRequested = false;
    this.touchMove = { x: 0, y: 0 };
    this.lookDelta = { x: 0, y: 0 };
    this.keys = new Set();
    this.joystickPointer = null;
    this.cameraPointer = null;
    this.lastCameraPoint = { x: 0, y: 0 };
    this.listeners = [];

    const listen = (target, type, handler, options) => {
      target.addEventListener(type, handler, options);
      this.listeners.push(() =>
        target.removeEventListener(type, handler, options),
      );
    };
    const pointerOptions = { passive: false };

    listen(
      joystick,
      "pointerdown",
      (event) => {
        if (!this.canStartPointer(event) || this.joystickPointer !== null)
          return;
        this.consumeEvent(event);
        this.joystickPointer = event.pointerId;
        this.capture(joystick, event.pointerId);
        joystick.classList.add("is-active");
        this.updateJoystick(event);
      },
      pointerOptions,
    );

    listen(
      cameraSurface,
      "pointerdown",
      (event) => {
        if (!this.canStartPointer(event) || this.cameraPointer !== null) return;
        this.consumeEvent(event);
        this.cameraPointer = event.pointerId;
        this.lastCameraPoint.x = event.clientX;
        this.lastCameraPoint.y = event.clientY;
        this.capture(cameraSurface, event.pointerId);
        cameraSurface.classList.add("is-active");
      },
      pointerOptions,
    );

    // Window listeners also cover the fallback if pointer capture is unavailable.
    listen(
      window,
      "pointermove",
      (event) => {
        if (event.pointerId === this.joystickPointer) {
          this.consumeEvent(event);
          this.updateJoystick(event);
        } else if (event.pointerId === this.cameraPointer) {
          this.consumeEvent(event);
          this.lookDelta.x += event.clientX - this.lastCameraPoint.x;
          this.lookDelta.y += event.clientY - this.lastCameraPoint.y;
          this.lastCameraPoint.x = event.clientX;
          this.lastCameraPoint.y = event.clientY;
        }
      },
      pointerOptions,
    );

    const release = (event) => this.endPointer(event.pointerId);
    listen(window, "pointerup", release);
    listen(window, "pointercancel", release);
    for (const element of [joystick, cameraSurface]) {
      listen(element, "lostpointercapture", release);
      listen(element, "contextmenu", (event) => event.preventDefault());
      listen(element, "dragstart", (event) => event.preventDefault());
    }

    if (resetButton) {
      listen(resetButton, "pointerdown", (event) => event.stopPropagation());
      listen(resetButton, "click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.lookDelta.x = 0;
        this.lookDelta.y = 0;
        this.onReset();
      });
    }

    this.actions = new TouchActionRouter({
      root: actionRoot,
      canClaimPointer: (event) =>
        event.pointerId !== this.joystickPointer &&
        event.pointerId !== this.cameraPointer,
    });
    const bindings = [
      {
        id: "sprint",
        element: sprintButton,
        behavior: ActionBehavior.HOLD,
        onHoldChange: () => this.updateState(),
      },
      {
        id: "dash",
        element: dashButton,
        behavior: ActionBehavior.PRESS,
        onActivate: () => this.requestDash(),
      },
      {
        id: "fight",
        element: fightButton,
        behavior: ActionBehavior.TOGGLE,
        onActivate: () => this.toggleFighting(),
      },
      ...actionBindings,
    ];
    for (const binding of bindings)
      if (binding.element) this.actions.register(binding);

    listen(window, "keydown", (event) => {
      if (!GAME_KEYS.has(event.code) || this.isTextOrDialogTarget(event.target))
        return;
      event.preventDefault();
      if (event.code === "KeyR") {
        if (!event.repeat) this.onReset();
        return;
      }
      if (event.code === "KeyF") {
        if (!event.repeat && !this.keys.has("KeyF")) this.toggleFighting();
        this.keys.add("KeyF");
        return;
      }
      if (event.code === "KeyE") {
        if (!event.repeat && !this.keys.has("KeyE")) this.requestDash();
        this.keys.add("KeyE");
        return;
      }
      this.keys.add(event.code);
      this.updateState();
    });
    listen(window, "keyup", (event) => {
      // Always release held keys, including when focus moved into another UI.
      if (!GAME_KEYS.has(event.code)) return;
      if (!this.isTextOrDialogTarget(event.target)) event.preventDefault();
      this.keys.delete(event.code);
      this.updateState();
    });

    listen(window, "blur", () => this.reset());
    listen(document, "visibilitychange", () => {
      if (document.hidden) this.reset();
    });
    listen(window, "resize", () => this.reset());
    listen(window, "orientationchange", () => this.reset());
    this.updateState();
  }

  canStartPointer(event) {
    return event.pointerType !== "mouse" || event.button === 0;
  }

  isTextOrDialogTarget(target) {
    return (
      target instanceof Element &&
      Boolean(
        target.closest(
          'input, textarea, select, [contenteditable="true"], dialog[open], [role="dialog"][aria-modal="true"]',
        ),
      )
    );
  }

  consumeEvent(event) {
    if (event.cancelable) event.preventDefault();
    event.stopPropagation();
  }

  toggleFighting() {
    this.fighting = !this.fighting;
    this.updateState();
  }

  requestDash() {
    // The movement state owns cooldown eligibility; HUD updates may lag a frame.
    this.dashRequested = true;
  }

  consumeDashRequest() {
    const requested = this.dashRequested;
    this.dashRequested = false;
    return requested;
  }

  capture(element, pointerId) {
    try {
      element.setPointerCapture(pointerId);
    } catch {
      // The window handlers retain pointer ownership until up/cancel.
    }
  }

  releaseCapture(element, pointerId) {
    if (pointerId === null) return;
    try {
      if (element.hasPointerCapture(pointerId))
        element.releasePointerCapture(pointerId);
    } catch {
      // The browser may have already implicitly released a cancelled pointer.
    }
  }

  updateJoystick(event) {
    const bounds = this.joystick.getBoundingClientRect();
    const radius = Math.max(1, Math.min(bounds.width, bounds.height) * 0.34);
    const dx = event.clientX - (bounds.left + bounds.width / 2);
    const dy = event.clientY - (bounds.top + bounds.height / 2);
    const distance = Math.hypot(dx, dy);
    const directionX = distance > 0 ? dx / distance : 0;
    const directionY = distance > 0 ? dy / distance : 0;
    const knobDistance = Math.min(distance, radius);
    this.joystickKnob.style.transform = `translate(${directionX * knobDistance}px, ${directionY * knobDistance}px)`;

    // Rescaling after the dead zone preserves the full analog speed range.
    const magnitude = Math.max(
      0,
      (Math.min(distance / radius, 1) - DEAD_ZONE) / (1 - DEAD_ZONE),
    );
    this.touchMove.x = directionX * magnitude;
    this.touchMove.y = -directionY * magnitude;
    this.updateState();
  }

  updateState() {
    const pressed = (a, b) => Number(this.keys.has(a) || this.keys.has(b));
    const keyX = pressed("KeyD", "ArrowRight") - pressed("KeyA", "ArrowLeft");
    const keyY = pressed("KeyW", "ArrowUp") - pressed("KeyS", "ArrowDown");
    // An active keyboard vector takes priority; touch resumes on key release.
    const x = keyX || keyY ? keyX : this.touchMove.x;
    const y = keyX || keyY ? keyY : this.touchMove.y;
    const length = Math.max(1, Math.hypot(x, y));
    this.move.x = x / length;
    this.move.y = y / length;
    this.sprinting =
      this.actions.isHeld("sprint") ||
      this.keys.has("ShiftLeft") ||
      this.keys.has("ShiftRight");
    this.sprintButton.classList.toggle("is-active", this.sprinting);
    this.sprintButton.setAttribute("aria-pressed", String(this.sprinting));
    this.fightButton?.classList.toggle("is-active", this.fighting);
    this.fightButton?.setAttribute("aria-pressed", String(this.fighting));
  }

  endPointer(pointerId) {
    if (pointerId === this.joystickPointer) {
      this.joystickPointer = null;
      this.touchMove.x = 0;
      this.touchMove.y = 0;
      this.joystickKnob.style.transform = "translate(0px, 0px)";
      this.joystick.classList.remove("is-active");
      this.releaseCapture(this.joystick, pointerId);
    }
    if (pointerId === this.cameraPointer) {
      this.cameraPointer = null;
      this.cameraSurface.classList.remove("is-active");
      this.releaseCapture(this.cameraSurface, pointerId);
    }
    this.updateState();
  }

  consumeLookDelta() {
    const result = { x: this.lookDelta.x, y: this.lookDelta.y };
    this.lookDelta.x = 0;
    this.lookDelta.y = 0;
    return result;
  }

  reset() {
    // Clear ownership before releasing captures: lostpointercapture can be synchronous.
    const pointers = [
      [this.joystick, this.joystickPointer],
      [this.cameraSurface, this.cameraPointer],
    ];
    this.joystickPointer = null;
    this.cameraPointer = null;
    this.dashRequested = false;
    this.actions.reset();
    this.touchMove.x = 0;
    this.touchMove.y = 0;
    this.lookDelta.x = 0;
    this.lookDelta.y = 0;
    this.keys.clear();
    this.joystickKnob.style.transform = "translate(0px, 0px)";
    this.joystick.classList.remove("is-active");
    this.cameraSurface.classList.remove("is-active");
    for (const [element, id] of pointers) this.releaseCapture(element, id);
    this.updateState();
  }

  get sprintPointer() {
    return this.actions.getPointer("sprint");
  }
  get fightPointer() {
    return this.actions.getPointer("fight");
  }
  get dashPointer() {
    return this.actions.getPointer("dash");
  }

  destroy() {
    this.reset();
    this.actions.destroy();
    for (const removeListener of this.listeners) removeListener();
    this.listeners.length = 0;
  }
}
