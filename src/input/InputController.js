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
  "KeyQ",
  "Space",
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
    cameraSurface,
    resetButton,
    attackButton,
    blockButton,
    dashButton,
    jumpButton,
    onReset,
    actionRoot = document.documentElement,
    actionBindings = [],
    keyboardMagnitude = 0.7,
  }) {
    this.joystick = joystick;
    this.joystickKnob = joystickKnob;
    this.cameraSurface = cameraSurface;
    this.attackButton = attackButton;
    this.blockButton = blockButton;
    this.dashButton = dashButton;
    this.jumpButton = jumpButton;
    this.onReset = onReset ?? (() => {});
    this.enabled = true;
    this.keyboardMagnitude = keyboardMagnitude;
    this.movementMagnitude = 0;

    this.move = { x: 0, y: 0 };
    this.sprinting = false;
    this.blocking = false;
    this.attackRequested = false;
    this.dashRequested = false;
    this.jumpRequested = false;
    // At most one pending entry per movement action, in original input order.
    this.movementRequests = [];
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
        if (!this.enabled) return;
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

    const release = (event) => {
      if (this.enabled) this.endPointer(event.pointerId);
    };
    listen(window, "pointerup", release);
    listen(window, "pointercancel", release);
    for (const element of [joystick, cameraSurface]) {
      listen(element, "lostpointercapture", release);
      listen(element, "contextmenu", (event) => {
        if (this.enabled) event.preventDefault();
      });
      listen(element, "dragstart", (event) => {
        if (this.enabled) event.preventDefault();
      });
    }

    if (resetButton) {
      listen(resetButton, "pointerdown", (event) => {
        if (this.enabled) event.stopPropagation();
      });
      listen(resetButton, "click", (event) => {
        if (!this.enabled) return;
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
        this.enabled &&
        !event.target.closest?.("[data-gameplay-ui]") &&
        event.pointerId !== this.joystickPointer &&
        event.pointerId !== this.cameraPointer,
    });
    const bindings = [
      {
        id: "dash",
        element: dashButton,
        behavior: ActionBehavior.PRESS,
        onActivate: () => this.requestDash(),
      },
      {
        id: "attack",
        element: attackButton,
        behavior: ActionBehavior.PRESS,
        onActivate: () => this.requestAttack(),
      },
      {
        id: "block",
        element: blockButton,
        behavior: ActionBehavior.HOLD,
        onHoldChange: () => this.updateState(),
      },
      {
        id: "jump",
        element: jumpButton,
        behavior: ActionBehavior.PRESS,
        onActivate: () => this.requestJump(),
      },
      ...actionBindings,
    ];
    for (const binding of bindings)
      if (binding.element) this.actions.register(binding);

    listen(window, "keydown", (event) => {
      if (
        !this.enabled ||
        !GAME_KEYS.has(event.code) ||
        this.isTextOrDialogTarget(event.target)
      )
        return;
      // A key held through suspension needs a fresh press after controls resume.
      if (event.repeat && !this.keys.has(event.code)) return;
      if (event.code === "Space" && this.isButtonOrLinkTarget(event.target))
        return;
      event.preventDefault();
      if (event.code === "KeyR") {
        if (!event.repeat) this.onReset();
        return;
      }
      if (event.code === "KeyF") {
        if (!event.repeat && !this.keys.has("KeyF")) this.requestAttack();
        this.keys.add("KeyF");
        return;
      }
      if (event.code === "KeyE") {
        if (!event.repeat && !this.keys.has("KeyE")) this.requestDash();
        this.keys.add("KeyE");
        return;
      }
      if (event.code === "Space") {
        // Focused action buttons consume Space in the router's capture phase.
        if (!event.repeat && !this.keys.has("Space")) this.requestJump();
        this.keys.add("Space");
        return;
      }
      this.keys.add(event.code);
      this.updateState();
    });
    listen(window, "keyup", (event) => {
      // Always release held keys, including when focus moved into another UI.
      if (!this.enabled || !GAME_KEYS.has(event.code)) return;
      if (
        !this.isTextOrDialogTarget(event.target) &&
        !(event.code === "Space" && this.isButtonOrLinkTarget(event.target))
      )
        event.preventDefault();
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
    return (
      this.enabled && (event.pointerType !== "mouse" || event.button === 0)
    );
  }

  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
    this.actions.setEnabled(this.enabled);
    if (!this.enabled) this.reset();
  }

  isTextOrDialogTarget(target) {
    return (
      target instanceof Element &&
      Boolean(
        target.closest(
          'input, textarea, select, [data-gameplay-ui], [contenteditable="true"], dialog[open], [role="dialog"][aria-modal="true"]',
        ),
      )
    );
  }

  isButtonOrLinkTarget(target) {
    return (
      target instanceof Element &&
      Boolean(target.closest('button, a, [role="button"]'))
    );
  }

  consumeEvent(event) {
    if (event.cancelable) event.preventDefault();
    event.stopPropagation();
  }

  requestAttack() {
    // Combat owns recovery and block eligibility; input records each entry only.
    if (!this.enabled) return;
    this.attackRequested = true;
  }

  consumeAttackRequest() {
    const requested = this.attackRequested;
    this.attackRequested = false;
    return requested;
  }

  requestDash() {
    // The movement state owns cooldown eligibility; HUD updates may lag a frame.
    if (!this.enabled || this.dashRequested) return;
    this.dashRequested = true;
    this.movementRequests.push("dash");
  }

  consumeDashRequest() {
    const requested = this.dashRequested;
    this.dashRequested = false;
    const index = this.movementRequests.indexOf("dash");
    if (index !== -1) this.movementRequests.splice(index, 1);
    return requested;
  }

  requestJump() {
    // Grounding and jump eligibility belong to the movement controller.
    if (!this.enabled || this.jumpRequested) return;
    this.jumpRequested = true;
    this.movementRequests.push("jump");
  }

  consumeJumpRequest() {
    const requested = this.jumpRequested;
    this.jumpRequested = false;
    const index = this.movementRequests.indexOf("jump");
    if (index !== -1) this.movementRequests.splice(index, 1);
    return requested;
  }

  consumeMovementRequest() {
    if (!this.movementRequests.length) return null;
    const action = this.movementRequests.shift();
    if (action === "dash") this.dashRequested = false;
    else if (action === "jump") this.jumpRequested = false;
    return action;
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
    if (!this.enabled) return;
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
    this.movementMagnitude =
      keyX || keyY
        ? this.keys.has("ShiftLeft") || this.keys.has("ShiftRight")
          ? 1
          : this.keyboardMagnitude
        : Math.min(1, Math.hypot(this.move.x, this.move.y));
    this.sprinting = this.movementMagnitude >= 0.9;
    this.blocking = this.actions.isHeld("block") || this.keys.has("KeyQ");
    this.blockButton?.classList.toggle("is-active", this.blocking);
    this.blockButton?.setAttribute("aria-pressed", String(this.blocking));
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
    this.attackRequested = false;
    this.dashRequested = false;
    this.jumpRequested = false;
    this.movementRequests.length = 0;
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

  get attackPointer() {
    return this.actions.getPointer("attack");
  }
  get blockPointer() {
    return this.actions.getPointer("block");
  }
  get dashPointer() {
    return this.actions.getPointer("dash");
  }
  get jumpPointer() {
    return this.actions.getPointer("jump");
  }

  destroy() {
    this.reset();
    this.actions.destroy();
    for (const removeListener of this.listeners) removeListener();
    this.listeners.length = 0;
  }
}
