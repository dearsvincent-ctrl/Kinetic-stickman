import test from "node:test";
import assert from "node:assert/strict";
import { InputController } from "../src/input/InputController.js";

// These stubs exercise input ownership and lifecycle without pretending to test
// browser gesture arbitration or hardware touch behavior.
class TrackedTarget extends EventTarget {
  constructor() {
    super();
    this.registeredListeners = new Map();
  }

  addEventListener(type, listener, options) {
    super.addEventListener(type, listener, options);
    if (!this.registeredListeners.has(type))
      this.registeredListeners.set(type, new Set());
    this.registeredListeners.get(type).add(listener);
  }

  removeEventListener(type, listener, options) {
    super.removeEventListener(type, listener, options);
    this.registeredListeners.get(type)?.delete(listener);
  }

  get listenerCount() {
    return [...this.registeredListeners.values()].reduce(
      (total, listeners) => total + listeners.size,
      0,
    );
  }
}

class ElementStub extends TrackedTarget {
  constructor() {
    super();
    this.style = {};
    this.attributes = new Map();
    this.classes = new Set();
    this.capturedPointers = new Set();
    this.captureSupported = true;
    this.editableOrDialog = false;
    this.classList = {
      add: (name) => this.classes.add(name),
      remove: (name) => this.classes.delete(name),
      toggle: (name, enabled) =>
        enabled ? this.classes.add(name) : this.classes.delete(name),
    };
  }

  closest() {
    return this.editableOrDialog ? this : null;
  }
  setAttribute(name, value) {
    this.attributes.set(name, value);
  }
  getBoundingClientRect() {
    return {
      left: 20,
      top: 30,
      right: 140,
      bottom: 150,
      width: 120,
      height: 120,
    };
  }

  setPointerCapture(id) {
    if (!this.captureSupported) throw new Error("Capture unavailable");
    this.capturedPointers.add(id);
  }

  hasPointerCapture(id) {
    return this.capturedPointers.has(id);
  }

  releasePointerCapture(id) {
    if (this.capturedPointers.delete(id)) {
      // Synchronous loss checks the controller's defensive reset/release order.
      dispatch(this, "lostpointercapture", { pointerId: id });
    }
  }
}

function dispatch(target, type, properties = {}, focusedTarget) {
  const event = new Event(type, { cancelable: true });
  Object.assign(event, properties);
  if (focusedTarget)
    Object.defineProperty(event, "target", { value: focusedTarget });
  target.dispatchEvent(event);
  return event;
}

function setup(t, { withFightButton = true, withDashButton = true } = {}) {
  const previous = {
    window: globalThis.window,
    document: globalThis.document,
    Element: globalThis.Element,
  };
  const window = new TrackedTarget();
  const document = Object.assign(new TrackedTarget(), { hidden: false });
  Object.assign(globalThis, { window, document, Element: ElementStub });
  const elements = Object.fromEntries(
    [
      "joystick",
      "joystickKnob",
      "sprintButton",
      "cameraSurface",
      "resetButton",
      ...(withFightButton ? ["fightButton"] : []),
      ...(withDashButton ? ["dashButton"] : []),
    ].map((name) => [name, new ElementStub()]),
  );
  let resetCount = 0;
  const input = new InputController({
    ...elements,
    onReset: () => resetCount++,
  });
  t.after(() => {
    input.destroy();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
  });
  return {
    input,
    window,
    document,
    ...elements,
    get resetCount() {
      return resetCount;
    },
    pointer(target, type, id, x = 0, y = 0, pointerType = "touch", button = 0) {
      return dispatch(target, type, {
        pointerId: id,
        clientX: x,
        clientY: y,
        pointerType,
        button,
      });
    },
    joystickPoint(id, x, y) {
      return {
        pointerId: id,
        clientX: 80 + x * 40.8,
        clientY: 90 + y * 40.8,
        pointerType: "touch",
        button: 0,
      };
    },
    key(type, code, options = {}, target) {
      return dispatch(
        window,
        type,
        { code, repeat: false, ...options },
        target,
      );
    },
  };
}

function near(actual, expected, message) {
  assert.ok(
    Math.abs(actual - expected) < 1e-9,
    message ?? `${actual} should equal ${expected}`,
  );
}

function assertStopped(input) {
  near(input.move.x, 0);
  near(input.move.y, 0);
  assert.equal(input.sprinting, false);
  assert.deepEqual(input.consumeLookDelta(), { x: 0, y: 0 });
}

test("three touch pointers independently move, look and sprint without being stolen", (t) => {
  const f = setup(t);
  dispatch(f.joystick, "pointerdown", f.joystickPoint(1, 0, -1));
  f.pointer(f.cameraSurface, "pointerdown", 2, 500, 200);
  f.pointer(f.sprintButton, "pointerdown", 3, 700, 400);

  // Later fingers on the same controls must not take ownership.
  dispatch(f.joystick, "pointerdown", f.joystickPoint(4, -1, 0));
  f.pointer(f.cameraSurface, "pointerdown", 5, 0, 0);
  f.pointer(f.sprintButton, "pointerdown", 6, 0, 0);
  f.pointer(f.window, "pointermove", 5, 50, 50);
  f.pointer(f.window, "pointerup", 6);

  near(f.input.move.x, 0);
  near(f.input.move.y, 1);
  assert.equal(f.input.sprinting, true);
  assert.deepEqual(f.input.consumeLookDelta(), { x: 0, y: 0 });
  assert.equal(f.joystick.hasPointerCapture(1), true);
  assert.equal(f.cameraSurface.hasPointerCapture(2), true);
  assert.equal(f.sprintButton.hasPointerCapture(3), true);

  dispatch(f.window, "pointermove", f.joystickPoint(1, 1, 0));
  f.pointer(f.window, "pointermove", 2, 520, 210);
  near(f.input.move.x, 1);
  near(f.input.move.y, 0);
  assert.equal(f.input.sprinting, true);
  assert.deepEqual(f.input.consumeLookDelta(), { x: 20, y: 10 });
  assert.deepEqual(f.input.consumeLookDelta(), { x: 0, y: 0 });
});

test("up, cancellation and lost capture release only their owning control", (t) => {
  const f = setup(t);
  dispatch(f.joystick, "pointerdown", f.joystickPoint(1, 1, 0));
  f.pointer(f.cameraSurface, "pointerdown", 2, 500, 200);
  f.pointer(f.sprintButton, "pointerdown", 3);

  f.pointer(f.window, "pointerup", 1);
  near(f.input.move.x, 0);
  assert.equal(f.input.sprinting, true);
  assert.equal(f.joystickKnob.style.transform, "translate(0px, 0px)");
  assert.equal(f.joystick.hasPointerCapture(1), false);

  f.pointer(f.window, "pointercancel", 2);
  f.pointer(f.window, "pointermove", 2, 530, 230);
  assert.deepEqual(f.input.consumeLookDelta(), { x: 0, y: 0 });
  assert.equal(f.input.sprinting, true);

  f.sprintButton.releasePointerCapture(3);
  assert.equal(f.input.sprinting, false);
  assert.equal(f.sprintButton.attributes.get("aria-pressed"), "false");

  // Each control can acquire a new pointer after release.
  dispatch(f.joystick, "pointerdown", f.joystickPoint(7, 0, -1));
  f.pointer(f.cameraSurface, "pointerdown", 8, 500, 200);
  f.pointer(f.sprintButton, "pointerdown", 9);
  near(f.input.move.y, 1);
  assert.equal(f.input.sprinting, true);
});

test("joystick has a dead zone, proportional travel and radial magnitude limit", (t) => {
  const f = setup(t);
  dispatch(f.joystick, "pointerdown", f.joystickPoint(1, 0.05, 0));
  near(Math.hypot(f.input.move.x, f.input.move.y), 0);
  dispatch(f.window, "pointermove", f.joystickPoint(1, 0.55, 0));
  near(f.input.move.x, 0.5);
  dispatch(f.window, "pointermove", f.joystickPoint(1, 5, -5));
  near(Math.hypot(f.input.move.x, f.input.move.y), 1);
  near(f.input.move.x, Math.SQRT1_2);
  near(f.input.move.y, Math.SQRT1_2);
});

test("keyboard diagonals normalize, Shift combines with touch and releases cleanly", (t) => {
  const f = setup(t);
  assert.equal(f.key("keydown", "KeyW").defaultPrevented, true);
  f.key("keydown", "KeyD");
  near(f.input.move.x, Math.SQRT1_2);
  near(f.input.move.y, Math.SQRT1_2);
  f.key("keydown", "ShiftLeft");
  assert.equal(f.input.sprinting, true);
  f.key("keyup", "KeyD");
  near(f.input.move.x, 0);
  near(f.input.move.y, 1);
  f.key("keyup", "KeyW");
  dispatch(f.joystick, "pointerdown", f.joystickPoint(1, -1, 0));
  near(f.input.move.x, -1);
  assert.equal(f.input.sprinting, true);
  f.key("keyup", "ShiftLeft");
  assert.equal(f.input.sprinting, false);
  assert.equal(f.key("keydown", "Space").defaultPrevented, false);
});

test("form/dialog focus ignores game keys but still permits held keys to release", (t) => {
  const f = setup(t);
  const editable = new ElementStub();
  editable.editableOrDialog = true;
  assert.equal(f.key("keydown", "KeyW", {}, editable).defaultPrevented, false);
  near(f.input.move.y, 0);
  f.key("keydown", "KeyW");
  near(f.input.move.y, 1);
  f.key("keyup", "KeyW", {}, editable);
  near(f.input.move.y, 0);
});

test("blur and hidden-document resets clear all captures, input and pending look", (t) => {
  const f = setup(t);
  for (const trigger of ["blur", "hidden"]) {
    dispatch(f.joystick, "pointerdown", f.joystickPoint(1, 1, 0));
    f.pointer(f.cameraSurface, "pointerdown", 2, 500, 200);
    f.pointer(f.window, "pointermove", 2, 510, 210);
    f.pointer(f.sprintButton, "pointerdown", 3);
    f.key("keydown", "KeyW");
    if (trigger === "blur") dispatch(f.window, "blur");
    else {
      f.document.hidden = true;
      dispatch(f.document, "visibilitychange");
    }
    assertStopped(f.input);
    assert.equal(f.joystick.capturedPointers.size, 0);
    assert.equal(f.cameraSurface.capturedPointers.size, 0);
    assert.equal(f.sprintButton.capturedPointers.size, 0);
  }
});

test("reset-camera inputs fire once and button clears accumulated look", (t) => {
  const f = setup(t);
  f.key("keydown", "KeyR");
  f.key("keydown", "KeyR", { repeat: true });
  assert.equal(f.resetCount, 1);
  f.pointer(f.cameraSurface, "pointerdown", 2, 500, 200);
  f.pointer(f.window, "pointermove", 2, 510, 210);
  dispatch(f.resetButton, "click");
  assert.equal(f.resetCount, 2);
  assert.deepEqual(f.input.consumeLookDelta(), { x: 0, y: 0 });
});

test("FIGHT clicks and non-repeating F key presses toggle the persistent stance", (t) => {
  const f = setup(t);
  assert.equal(f.input.fighting, false);
  assert.equal(f.fightButton.attributes.get("aria-pressed"), "false");
  dispatch(f.fightButton, "click", { detail: 0 });
  assert.equal(f.input.fighting, true);
  assert.equal(f.fightButton.attributes.get("aria-pressed"), "true");
  assert.equal(f.fightButton.classes.has("is-active"), true);
  dispatch(f.fightButton, "click", { detail: 0 });
  assert.equal(f.input.fighting, false);

  assert.equal(f.key("keydown", "KeyF").defaultPrevented, true);
  assert.equal(f.input.fighting, true);
  f.key("keydown", "KeyF", { repeat: true });
  f.key("keydown", "KeyF");
  assert.equal(f.input.fighting, true, "one toggle per physical key press");
  f.key("keyup", "KeyF");
  f.key("keydown", "KeyF");
  assert.equal(f.input.fighting, false);

  const editable = new ElementStub();
  editable.editableOrDialog = true;
  f.key("keyup", "KeyF");
  assert.equal(f.key("keydown", "KeyF", {}, editable).defaultPrevented, false);
  assert.equal(
    f.input.fighting,
    false,
    "form/dialog input must not toggle guard",
  );
});

test("fight tapping preserves independent joystick, camera and sprint input", (t) => {
  const f = setup(t);
  dispatch(f.joystick, "pointerdown", f.joystickPoint(1, 0.55, 0));
  f.pointer(f.cameraSurface, "pointerdown", 2, 500, 200);
  f.pointer(f.sprintButton, "pointerdown", 3, 700, 400);
  f.pointer(f.window, "pointermove", 2, 515, 207);
  const down = f.pointer(f.fightButton, "pointerdown", 4, 80, 90);
  assert.equal(
    down.defaultPrevented,
    false,
    "native click activation stays enabled",
  );
  f.pointer(f.window, "pointerup", 4, 80, 90);
  assert.equal(
    f.input.fighting,
    true,
    "non-primary touch release works without a browser click",
  );
  dispatch(f.fightButton, "click", { detail: 1 });

  assert.equal(
    f.input.fighting,
    true,
    "following native click must not toggle twice",
  );
  near(f.input.move.x, 0.5);
  near(f.input.move.y, 0);
  assert.equal(f.input.sprinting, true);
  assert.equal(f.input.joystickPointer, 1);
  assert.equal(f.input.cameraPointer, 2);
  assert.equal(f.input.sprintPointer, 3);
  assert.deepEqual(f.input.consumeLookDelta(), { x: 15, y: 7 });
});

test("cancelled or dragged-out fight presses cannot toggle stance", (t) => {
  const f = setup(t);
  f.pointer(f.fightButton, "pointerdown", 4, 80, 90);
  f.pointer(f.window, "pointercancel", 4, 80, 90);
  dispatch(f.fightButton, "click", { detail: 1 });
  assert.equal(f.input.fighting, false);

  f.pointer(f.fightButton, "pointerdown", 5, 80, 90);
  f.pointer(f.window, "pointermove", 5, 150, 90);
  f.pointer(f.window, "pointermove", 5, 80, 90);
  f.pointer(f.window, "pointerup", 5, 80, 90);
  dispatch(f.fightButton, "click", { detail: 1 });
  assert.equal(
    f.input.fighting,
    false,
    "moving back inside must not undo cancellation",
  );

  f.pointer(f.fightButton, "pointerdown", 6, 80, 90);
  f.pointer(f.fightButton, "lostpointercapture", 6, 80, 90);
  dispatch(f.fightButton, "click", { detail: 1 });
  assert.equal(f.input.fighting, false);
  dispatch(f.fightButton, "click", { detail: 0 });
  assert.equal(
    f.input.fighting,
    true,
    "keyboard/accessibility activation remains available",
  );
});

test("momentary resets preserve selected stance across blur, resize, visibility and help", (t) => {
  const f = setup(t);
  dispatch(f.fightButton, "click", { detail: 0 });
  for (const trigger of [
    "blur",
    "resize",
    "orientationchange",
    "hidden",
    "explicit",
  ]) {
    dispatch(f.joystick, "pointerdown", f.joystickPoint(1, 1, 0));
    f.pointer(f.sprintButton, "pointerdown", 3);
    if (trigger === "hidden") {
      f.document.hidden = true;
      dispatch(f.document, "visibilitychange");
    } else if (trigger === "explicit") f.input.reset();
    else dispatch(f.window, trigger);
    assertStopped(f.input);
    assert.equal(f.input.fighting, true);
    assert.equal(f.fightButton.attributes.get("aria-pressed"), "true");
  }
});

test("fight selection also works without an optional touchscreen button", (t) => {
  const f = setup(t, { withFightButton: false });
  f.key("keydown", "KeyF");
  assert.equal(f.input.fighting, true);
  f.input.reset();
  assert.equal(f.input.fighting, true);
});

test("DASH requests on contact once per pointer and consumption is one-shot", (t) => {
  const f = setup(t);
  assert.equal(f.input.consumeDashRequest(), false);
  const down = f.pointer(f.dashButton, "pointerdown", 4, 80, 90);
  assert.equal(down.defaultPrevented, true);
  assert.equal(f.input.consumeDashRequest(), true);
  assert.equal(f.input.consumeDashRequest(), false);
  assert.equal(f.dashButton.hasPointerCapture(4), true);

  f.pointer(f.dashButton, "pointerdown", 4, 80, 90);
  f.pointer(f.dashButton, "pointerdown", 5, 80, 90);
  assert.equal(f.input.dashPointer, 4);
  assert.equal(f.input.consumeDashRequest(), false);
  f.pointer(f.window, "pointerup", 5);
  assert.equal(f.input.dashPointer, 4);
  f.pointer(f.window, "pointerup", 4);
  dispatch(f.dashButton, "click", { detail: 1 });
  assert.equal(f.input.consumeDashRequest(), false);
  assert.equal(f.dashButton.hasPointerCapture(4), false);

  f.pointer(f.dashButton, "pointerdown", 6, 80, 90);
  f.pointer(f.window, "pointercancel", 6);
  assert.equal(
    f.input.consumeDashRequest(),
    true,
    "contact already requested the dash",
  );
  assert.equal(f.input.consumeDashRequest(), false);
  dispatch(f.dashButton, "click", { detail: 1 });
  assert.equal(f.input.consumeDashRequest(), false);
});

test("DASH leaves simultaneous joystick, look, sprint and FIGHT owners untouched", (t) => {
  const f = setup(t);
  dispatch(f.joystick, "pointerdown", f.joystickPoint(1, 0.55, 0));
  f.pointer(f.cameraSurface, "pointerdown", 2, 500, 200);
  f.pointer(f.sprintButton, "pointerdown", 3, 700, 400);
  f.pointer(f.fightButton, "pointerdown", 4, 80, 90);
  f.pointer(f.dashButton, "pointerdown", 5, 80, 90);
  assert.equal(f.input.consumeDashRequest(), true);
  assert.equal(f.input.fightPointer, 4);
  assert.equal(f.input.fighting, false);
  assert.equal(f.input.joystickPointer, 1);
  assert.equal(f.input.cameraPointer, 2);
  assert.equal(f.input.sprintPointer, 3);
  near(f.input.move.x, 0.5);
  near(f.input.move.y, 0);
  assert.equal(f.input.sprinting, true);

  f.pointer(f.window, "pointermove", 2, 515, 207);
  f.pointer(f.window, "pointerup", 4, 80, 90);
  f.pointer(f.window, "pointerup", 5);
  assert.equal(f.input.fighting, true);
  assert.equal(f.input.sprinting, true);
  assert.deepEqual(f.input.consumeLookDelta(), { x: 15, y: 7 });
  assert.equal(f.input.consumeDashRequest(), false);
});

test("dash reset discards queued input and captures while preserving selected stance", (t) => {
  const f = setup(t);
  dispatch(f.fightButton, "click", { detail: 0 });
  for (const trigger of ["blur", "hidden", "explicit"]) {
    f.pointer(f.dashButton, "pointerdown", 5, 80, 90);
    if (trigger === "hidden") {
      f.document.hidden = true;
      dispatch(f.document, "visibilitychange");
    } else if (trigger === "explicit") f.input.reset();
    else dispatch(f.window, trigger);
    assert.equal(f.input.dashPointer, null);
    assert.equal(f.dashButton.capturedPointers.size, 0);
    assert.equal(f.input.consumeDashRequest(), false);
    assert.equal(f.input.fighting, true);
  }
});

test("dash keyboard access is one request per E press and ignores form/dialog focus", (t) => {
  const f = setup(t, { withDashButton: false });
  assert.equal(f.key("keydown", "KeyE").defaultPrevented, true);
  assert.equal(f.input.consumeDashRequest(), true);
  f.key("keydown", "KeyE", { repeat: true });
  f.key("keydown", "KeyE");
  assert.equal(f.input.consumeDashRequest(), false);
  f.key("keyup", "KeyE");
  f.key("keydown", "KeyE");
  assert.equal(f.input.consumeDashRequest(), true);

  const editable = new ElementStub();
  editable.editableOrDialog = true;
  f.key("keyup", "KeyE", {}, editable);
  assert.equal(f.key("keydown", "KeyE", {}, editable).defaultPrevented, false);
  assert.equal(f.input.consumeDashRequest(), false);
  f.key("keydown", "KeyE");
  f.input.reset();
  assert.equal(f.input.consumeDashRequest(), false);
});

test("DASH keeps native keyboard/accessibility clicks and ignores pointer click duplication", (t) => {
  const f = setup(t);
  for (const code of ["Space", "Enter"]) {
    assert.equal(
      f.key("keydown", code, {}, f.dashButton).defaultPrevented,
      false,
    );
    assert.equal(
      f.key("keyup", code, {}, f.dashButton).defaultPrevented,
      false,
    );
    const click = dispatch(f.dashButton, "click", { detail: 0 });
    assert.equal(click.defaultPrevented, true);
    assert.equal(f.input.consumeDashRequest(), true);
    assert.equal(f.input.consumeDashRequest(), false);
  }
  dispatch(f.dashButton, "click", { detail: 1 });
  assert.equal(f.input.consumeDashRequest(), false);
});

test("DASH ignores drag-in and secondary mouse, and cooldown UI never owns eligibility", (t) => {
  const f = setup(t);
  f.pointer(f.dashButton, "pointermove", 4, 80, 90);
  f.pointer(f.window, "pointerup", 4, 80, 90);
  assert.equal(f.input.consumeDashRequest(), false);
  f.pointer(f.dashButton, "pointerdown", 4, 80, 90, "mouse", 2);
  assert.equal(f.input.consumeDashRequest(), false);
  assert.equal(f.input.dashPointer, null);

  f.dashButton.setAttribute("aria-disabled", "true");
  assert.equal(
    f.pointer(f.dashButton, "pointerdown", 5, 80, 90).defaultPrevented,
    true,
  );
  assert.equal(f.input.cameraPointer, null);
  assert.equal(
    f.input.consumeDashRequest(),
    true,
    "movement state decides cooldown eligibility",
  );
  dispatch(f.dashButton, "click", { detail: 0 });
  assert.equal(f.input.consumeDashRequest(), true);
  f.key("keydown", "KeyE");
  assert.equal(f.input.consumeDashRequest(), true);
  f.dashButton.setAttribute("aria-disabled", "false");
  f.pointer(f.dashButton, "pointerdown", 6, 80, 90);
  assert.equal(
    f.input.consumeDashRequest(),
    false,
    "held pointer retains ownership",
  );
  f.pointer(f.window, "pointerup", 5);
  f.dashButton.captureSupported = false;
  f.pointer(f.dashButton, "pointerdown", 7, 80, 90);
  assert.equal(f.input.consumeDashRequest(), true);
  f.pointer(f.window, "pointerup", 7);
  assert.equal(f.input.dashPointer, null);
  assert.equal(f.input.consumeDashRequest(), false);
});

test("pointer capture failure retains window fallback and secondary mouse is ignored", (t) => {
  const f = setup(t);
  f.pointer(f.cameraSurface, "pointerdown", 1, 500, 200, "mouse", 2);
  f.pointer(f.window, "pointermove", 1, 520, 210, "mouse", 2);
  assert.deepEqual(f.input.consumeLookDelta(), { x: 0, y: 0 });
  f.cameraSurface.captureSupported = false;
  f.pointer(f.cameraSurface, "pointerdown", 2, 500, 200);
  f.pointer(f.window, "pointermove", 2, 520, 210);
  assert.deepEqual(f.input.consumeLookDelta(), { x: 20, y: 10 });
  f.pointer(f.window, "pointerup", 2);
  f.pointer(f.window, "pointermove", 2, 530, 220);
  assert.deepEqual(f.input.consumeLookDelta(), { x: 0, y: 0 });
});

test("destroy resets gameplay state and removes every registered event handler", (t) => {
  const f = setup(t);
  dispatch(f.joystick, "pointerdown", f.joystickPoint(1, 1, 0));
  f.pointer(f.sprintButton, "pointerdown", 3);
  f.input.destroy();
  assertStopped(f.input);
  for (const target of [
    f.window,
    f.document,
    f.joystick,
    f.joystickKnob,
    f.sprintButton,
    f.cameraSurface,
    f.resetButton,
    f.fightButton,
    f.dashButton,
  ]) {
    assert.equal(target.listenerCount, 0);
  }
  f.key("keydown", "KeyW");
  f.pointer(f.sprintButton, "pointerdown", 4);
  dispatch(f.joystick, "pointerdown", f.joystickPoint(5, 1, 0));
  dispatch(f.resetButton, "click");
  dispatch(f.fightButton, "click", { detail: 0 });
  f.pointer(f.dashButton, "pointerdown", 6, 80, 90);
  dispatch(f.dashButton, "click", { detail: 0 });
  assertStopped(f.input);
  assert.equal(f.resetCount, 0);
  assert.equal(f.input.fighting, false);
  assert.equal(f.input.consumeDashRequest(), false);
});
