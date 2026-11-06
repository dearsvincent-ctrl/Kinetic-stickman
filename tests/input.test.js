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
  constructor(rect = { left: 20, top: 30, width: 120, height: 120 }) {
    super();
    this.rect = rect;
    this.parentElement = null;
    this.ownerDocument = null;
    this.tagName = "DIV";
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

  closest(selector) {
    if (selector === 'button, a, [role="button"]') {
      for (let element = this; element; element = element.parentElement) {
        if (
          element.tagName === "BUTTON" ||
          element.tagName === "A" ||
          element.getAttribute("role") === "button"
        )
          return element;
      }
      return null;
    }
    return this.editableOrDialog ? this : null;
  }
  contains(element) {
    for (let current = element; current; current = current.parentElement)
      if (current === this) return true;
    return false;
  }
  setAttribute(name, value) {
    this.attributes.set(name, value);
  }
  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }
  getBoundingClientRect() {
    return {
      ...this.rect,
      right: this.rect.left + this.rect.width,
      bottom: this.rect.top + this.rect.height,
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

// Node EventTarget does not provide a DOM propagation path. Route interaction
// events through document first, then their target and window, to model the
// capture delegation used by the action router without browser-only dependencies.
function dispatch(target, type, properties = {}, focusedTarget) {
  const event = new Event(type, { cancelable: true });
  Object.assign(event, properties);
  const logicalTarget = focusedTarget ?? target;
  Object.defineProperty(event, "target", { value: logicalTarget });
  const document = target.ownerDocument ?? globalThis.document;
  const window = document?.defaultView;
  const interaction = /^(pointer|lostpointercapture|click|keydown|keyup)/.test(
    type,
  );
  let stopped = false;
  const stop = event.stopPropagation.bind(event);
  event.stopPropagation = () => {
    stopped = true;
    stop();
  };
  const stopImmediate = event.stopImmediatePropagation.bind(event);
  event.stopImmediatePropagation = () => {
    stopped = true;
    stopImmediate();
  };
  if (interaction && document && target !== document) {
    document.dispatchEvent(event);
    if (!stopped) target.dispatchEvent(event);
    if (!stopped && window && target !== window) window.dispatchEvent(event);
  } else target.dispatchEvent(event);
  return event;
}

function setup(
  t,
  {
    withAttackButton = true,
    withBlockButton = true,
    withDashButton = true,
    withJumpButton = true,
  } = {},
) {
  const previous = {
    window: globalThis.window,
    document: globalThis.document,
    Element: globalThis.Element,
  };
  const window = new TrackedTarget();
  const document = Object.assign(new TrackedTarget(), {
    hidden: false,
    defaultView: window,
  });
  const actionRoot = new ElementStub({
    left: 0,
    top: 0,
    width: 800,
    height: 450,
  });
  actionRoot.ownerDocument = document;
  document.documentElement = actionRoot;
  window.ownerDocument = document;
  Object.assign(globalThis, { window, document, Element: ElementStub });
  const geometries = {
    joystick: { left: 20, top: 30, width: 120, height: 120 },
    joystickKnob: { left: 65, top: 75, width: 30, height: 30 },
    sprintButton: { left: 660, top: 360, width: 80, height: 80 },
    dashButton: { left: 580, top: 360, width: 70, height: 80 },
    attackButton: { left: 660, top: 260, width: 80, height: 80 },
    blockButton: { left: 580, top: 260, width: 70, height: 80 },
    jumpButton: { left: 740, top: 360, width: 60, height: 80 },
    cameraSurface: { left: 400, top: 100, width: 150, height: 200 },
    resetButton: { left: 690, top: 40, width: 90, height: 30 },
  };
  const hitElements = [];
  function addElement(rect) {
    const element = new ElementStub(rect);
    element.ownerDocument = document;
    element.parentElement = actionRoot;
    hitElements.push(element);
    return element;
  }
  const elements = Object.fromEntries(
    [
      "joystick",
      "joystickKnob",
      "sprintButton",
      "cameraSurface",
      "resetButton",
      ...(withAttackButton ? ["attackButton"] : []),
      ...(withBlockButton ? ["blockButton"] : []),
      ...(withDashButton ? ["dashButton"] : []),
      ...(withJumpButton ? ["jumpButton"] : []),
    ].map((name) => {
      const element = addElement(geometries[name]);
      if (name.endsWith("Button")) element.tagName = "BUTTON";
      return [name, element];
    }),
  );
  document.elementFromPoint = (x, y) => {
    if (x < 0 || y < 0 || x > 800 || y > 450) return null;
    return (
      [...hitElements].reverse().find((element) => {
        const rect = element.getBoundingClientRect();
        return (
          x >= rect.left && x < rect.right && y >= rect.top && y < rect.bottom
        );
      }) ?? actionRoot
    );
  };
  let resetCount = 0;
  const input = new InputController({
    ...elements,
    actionRoot,
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
    actionRoot,
    addElement,
    ...elements,
    get resetCount() {
      return resetCount;
    },
    pointer(target, type, id, x, y, pointerType = "touch", button = 0) {
      const rect =
        target instanceof ElementStub ? target.getBoundingClientRect() : null;
      return dispatch(target, type, {
        pointerId: id,
        clientX: x ?? (rect ? rect.left + rect.width / 2 : 0),
        clientY: y ?? (rect ? rect.top + rect.height / 2 : 0),
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
  assert.equal(input.blocking, false);
  assert.deepEqual(input.consumeLookDelta(), { x: 0, y: 0 });
}

test("three touch pointers independently move, look and sprint without being stolen", (t) => {
  const f = setup(t);
  dispatch(f.joystick, "pointerdown", f.joystickPoint(1, 0, -1));
  f.pointer(f.cameraSurface, "pointerdown", 2, 500, 200);
  f.pointer(f.sprintButton, "pointerdown", 3, 700, 400);

  // Joystick and camera retain exclusive owners; action fingers are independent.
  dispatch(f.joystick, "pointerdown", f.joystickPoint(4, -1, 0));
  f.pointer(f.cameraSurface, "pointerdown", 5, 0, 0);
  f.pointer(f.sprintButton, "pointerdown", 6, 700, 400);
  assert.equal(f.input.sprintPointer, 3);
  assert.equal(f.actionRoot.hasPointerCapture(6), true);
  f.pointer(f.window, "pointermove", 5, 50, 50);
  f.pointer(f.window, "pointerup", 6);

  near(f.input.move.x, 0);
  near(f.input.move.y, 1);
  assert.equal(f.input.sprinting, true);
  assert.deepEqual(f.input.consumeLookDelta(), { x: 0, y: 0 });
  assert.equal(f.joystick.hasPointerCapture(1), true);
  assert.equal(f.cameraSurface.hasPointerCapture(2), true);
  assert.equal(f.actionRoot.hasPointerCapture(3), true);

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

  f.actionRoot.releasePointerCapture(3);
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
  assert.equal(f.key("keydown", "KeyZ").defaultPrevented, false);
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
    assert.equal(f.actionRoot.capturedPointers.size, 0);
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

test("ATTACK accessibility clicks and non-repeating F presses request one attack", (t) => {
  const f = setup(t);
  assert.equal(f.input.consumeAttackRequest(), false);
  dispatch(f.attackButton, "click", { detail: 0 });
  assert.equal(f.input.consumeAttackRequest(), true);
  assert.equal(f.input.consumeAttackRequest(), false);
  dispatch(f.attackButton, "click", { detail: 0 });
  assert.equal(f.input.consumeAttackRequest(), true);

  assert.equal(f.key("keydown", "KeyF").defaultPrevented, true);
  assert.equal(f.input.consumeAttackRequest(), true);
  f.key("keydown", "KeyF", { repeat: true });
  f.key("keydown", "KeyF");
  assert.equal(
    f.input.consumeAttackRequest(),
    false,
    "one request per physical press",
  );
  f.key("keyup", "KeyF");
  f.key("keydown", "KeyF");
  assert.equal(f.input.consumeAttackRequest(), true);

  const editable = new ElementStub();
  editable.editableOrDialog = true;
  f.key("keyup", "KeyF", {}, editable);
  assert.equal(f.key("keydown", "KeyF", {}, editable).defaultPrevented, false);
  assert.equal(
    f.input.consumeAttackRequest(),
    false,
    "form/dialog input cannot attack",
  );
});

test("ATTACK tapping preserves independent joystick, camera and sprint input", (t) => {
  const f = setup(t);
  dispatch(f.joystick, "pointerdown", f.joystickPoint(1, 0.55, 0));
  f.pointer(f.cameraSurface, "pointerdown", 2, 500, 200);
  f.pointer(f.sprintButton, "pointerdown", 3, 700, 400);
  f.pointer(f.window, "pointermove", 2, 515, 207);
  const down = f.pointer(f.attackButton, "pointerdown", 4, 700, 300);
  assert.equal(down.defaultPrevented, true);
  assert.equal(
    f.input.consumeAttackRequest(),
    true,
    "attack requests immediately on entry",
  );
  f.pointer(f.window, "pointerup", 4, 700, 300);
  dispatch(f.attackButton, "click", { detail: 1 });
  assert.equal(
    f.input.consumeAttackRequest(),
    false,
    "release/native click cannot duplicate entry",
  );
  near(f.input.move.x, 0.5);
  near(f.input.move.y, 0);
  assert.equal(f.input.sprinting, true);
  assert.equal(f.input.joystickPointer, 1);
  assert.equal(f.input.cameraPointer, 2);
  assert.equal(f.input.sprintPointer, 3);
  assert.deepEqual(f.input.consumeLookDelta(), { x: 15, y: 7 });
});

test("ATTACK requests once per entry, with no repeat on stay, release or lost capture", (t) => {
  const f = setup(t);
  f.pointer(f.attackButton, "pointerdown", 4);
  assert.equal(f.input.consumeAttackRequest(), true);
  f.pointer(f.window, "pointermove", 4, 705, 305);
  assert.equal(
    f.input.consumeAttackRequest(),
    false,
    "remaining inside cannot repeat",
  );
  f.pointer(f.window, "pointercancel", 4, 700, 300);
  dispatch(f.attackButton, "click", { detail: 1 });
  assert.equal(f.input.consumeAttackRequest(), false);
  assert.equal(f.input.attackPointer, null);

  f.pointer(f.attackButton, "pointerdown", 5);
  assert.equal(f.input.consumeAttackRequest(), true);
  f.pointer(f.window, "pointermove", 5, 750, 300);
  assert.equal(f.input.attackPointer, null);
  assert.equal(f.input.consumeAttackRequest(), false, "leaving cannot request");
  f.pointer(f.window, "pointermove", 5, 700, 300);
  assert.equal(
    f.input.consumeAttackRequest(),
    true,
    "re-entry is one new request",
  );
  f.pointer(f.window, "pointerup", 5, 700, 300);
  dispatch(f.attackButton, "click", { detail: 1 });
  assert.equal(f.input.consumeAttackRequest(), false);

  f.pointer(f.attackButton, "pointerdown", 6);
  assert.equal(f.input.consumeAttackRequest(), true);
  f.actionRoot.releasePointerCapture(6);
  dispatch(f.attackButton, "click", { detail: 1 });
  assert.equal(f.input.consumeAttackRequest(), false);
  assert.equal(f.input.attackPointer, null);
});

test("BLOCK holds until the final touch or Q key releases and preserves movement", (t) => {
  const f = setup(t);
  assert.equal(f.blockButton.attributes.get("aria-pressed"), "false");
  dispatch(f.joystick, "pointerdown", f.joystickPoint(1, 0.55, 0));
  f.pointer(f.blockButton, "pointerdown", 4);
  f.pointer(f.blockButton, "pointerdown", 5);
  assert.equal(f.input.blocking, true);
  assert.equal(f.blockButton.attributes.get("aria-pressed"), "true");
  assert.equal(f.blockButton.classes.has("is-active"), true);
  near(f.input.move.x, 0.5);
  f.key("keydown", "KeyQ");
  f.pointer(f.window, "pointermove", 4, 750, 300);
  assert.equal(
    f.input.blocking,
    true,
    "second finger and keyboard remain held",
  );
  assert.equal(f.input.blockPointer, 5);
  f.pointer(f.window, "pointercancel", 5);
  assert.equal(f.input.blocking, true, "Q remains held independently");
  assert.equal(f.input.blockPointer, null);
  f.key("keyup", "KeyQ");
  assert.equal(f.input.blocking, false);
  assert.equal(f.blockButton.attributes.get("aria-pressed"), "false");
  assert.equal(f.blockButton.classes.has("is-active"), false);

  f.pointer(f.window, "pointermove", 4, 615, 300);
  assert.equal(f.input.blocking, true, "re-entry holds immediately");
  f.actionRoot.releasePointerCapture(4);
  assert.equal(f.input.blocking, false, "capture loss releases guard");
  const editable = new ElementStub();
  editable.editableOrDialog = true;
  assert.equal(f.key("keydown", "KeyQ", {}, editable).defaultPrevented, false);
  assert.equal(f.input.blocking, false);
  f.key("keydown", "KeyQ");
  assert.equal(f.input.blocking, true);
  f.key("keyup", "KeyQ", {}, editable);
  assert.equal(
    f.input.blocking,
    false,
    "focus changes cannot stick a held key",
  );
});

test("sliding BLOCK to ATTACK releases guard and requests once without lifting", (t) => {
  const f = setup(t);
  f.pointer(f.blockButton, "pointerdown", 4);
  assert.equal(f.input.blocking, true);
  f.pointer(f.window, "pointermove", 4, 700, 300);
  assert.equal(
    f.input.blocking,
    false,
    "guard releases before attack consumption",
  );
  assert.equal(f.input.blockPointer, null);
  assert.equal(f.input.attackPointer, 4);
  assert.equal(f.input.consumeAttackRequest(), true);
  f.pointer(f.window, "pointermove", 4, 705, 305);
  assert.equal(f.input.consumeAttackRequest(), false);
  f.pointer(f.window, "pointermove", 4, 615, 300);
  assert.equal(f.input.blocking, true);
  f.pointer(f.window, "pointermove", 4, 700, 300);
  assert.equal(f.input.blocking, false);
  assert.equal(
    f.input.consumeAttackRequest(),
    true,
    "new entry can request after recovery",
  );
  f.pointer(f.window, "pointercancel", 4);
  assert.equal(f.input.consumeAttackRequest(), false);
  assert.equal(f.input.actions.ownsPointer(4), false);
});

test("momentary resets release BLOCK and discard action requests across lifecycle changes", (t) => {
  const f = setup(t);
  for (const trigger of [
    "blur",
    "resize",
    "orientationchange",
    "hidden",
    "explicit",
  ]) {
    dispatch(f.joystick, "pointerdown", f.joystickPoint(1, 1, 0));
    f.pointer(f.sprintButton, "pointerdown", 3);
    f.pointer(f.blockButton, "pointerdown", 4);
    f.pointer(f.attackButton, "pointerdown", 5);
    f.pointer(f.dashButton, "pointerdown", 6);
    f.pointer(f.jumpButton, "pointerdown", 7);
    f.key("keydown", "KeyQ");
    if (trigger === "hidden") {
      f.document.hidden = true;
      dispatch(f.document, "visibilitychange");
    } else if (trigger === "explicit") f.input.reset();
    else dispatch(f.window, trigger);
    assertStopped(f.input);
    assert.equal(f.input.attackPointer, null);
    assert.equal(f.input.blockPointer, null);
    assert.equal(f.input.consumeAttackRequest(), false);
    assert.equal(f.input.consumeDashRequest(), false);
    assert.equal(f.input.consumeJumpRequest(), false);
    assert.equal(f.input.jumpPointer, null);
    assert.equal(f.blockButton.attributes.get("aria-pressed"), "false");
    assert.equal(f.actionRoot.capturedPointers.size, 0);
  }
});

test("ATTACK and BLOCK keyboard access works without optional touchscreen buttons", (t) => {
  const f = setup(t, { withAttackButton: false, withBlockButton: false });
  f.key("keydown", "KeyF");
  f.key("keydown", "KeyQ");
  assert.equal(f.input.consumeAttackRequest(), true);
  assert.equal(f.input.blocking, true);
  f.input.reset();
  assert.equal(f.input.blocking, false);
  assert.equal(f.input.consumeAttackRequest(), false);
});

test("ATTACK input leaves recovery and block eligibility to the combat state", (t) => {
  const f = setup(t);
  f.attackButton.setAttribute("aria-disabled", "true");
  f.pointer(f.blockButton, "pointerdown", 1);
  f.pointer(f.attackButton, "pointerdown", 2);
  assert.equal(f.input.blocking, true);
  assert.equal(
    f.input.consumeAttackRequest(),
    true,
    "input does not gate another finger's entry",
  );
  assert.equal(f.input.consumeAttackRequest(), false);
  f.pointer(f.window, "pointermove", 2, 750, 300);
  f.pointer(f.window, "pointermove", 2, 700, 300);
  assert.equal(
    f.input.consumeAttackRequest(),
    true,
    "recovery UI cannot prevent a fresh request",
  );
});

test("native button keys activate ATTACK once and HOLD BLOCK until key release", (t) => {
  const f = setup(t);
  for (const code of ["Space", "Enter"]) {
    assert.equal(
      f.key("keydown", code, {}, f.attackButton).defaultPrevented,
      true,
    );
    assert.equal(f.input.consumeAttackRequest(), true);
    f.key("keydown", code, { repeat: true }, f.attackButton);
    f.key("keydown", code, {}, f.attackButton);
    assert.equal(f.input.consumeAttackRequest(), false);
    f.key("keyup", code, {}, f.attackButton);
    dispatch(f.attackButton, "click", { detail: 1 });
    assert.equal(
      f.input.consumeAttackRequest(),
      false,
      "native click cannot duplicate the key entry",
    );

    assert.equal(
      f.key("keydown", code, {}, f.blockButton).defaultPrevented,
      true,
    );
    assert.equal(f.input.blocking, true);
    f.key("keydown", code, { repeat: true }, f.blockButton);
    assert.equal(f.input.blocking, true);
    assert.equal(f.input.consumeAttackRequest(), false);
    f.key("keyup", code, {}, f.blockButton);
    assert.equal(f.input.blocking, false);
  }
  dispatch(f.blockButton, "click", { detail: 0 });
  assert.equal(
    f.input.blocking,
    false,
    "standalone assistive click cannot leave HOLD stuck",
  );
});

test("JUMP requests once per entry and cancellation cannot repeat a consumed request", (t) => {
  const f = setup(t);
  assert.equal(f.input.consumeJumpRequest(), false);
  assert.equal(
    f.pointer(f.jumpButton, "pointerdown", 4).defaultPrevented,
    true,
  );
  assert.equal(f.input.jumpPointer, 4);
  assert.equal(f.input.consumeJumpRequest(), true);
  assert.equal(f.input.consumeJumpRequest(), false);
  f.pointer(f.window, "pointermove", 4, 775, 405);
  f.pointer(f.jumpButton, "pointerdown", 4);
  assert.equal(
    f.input.consumeJumpRequest(),
    false,
    "holding inside cannot auto-hop",
  );

  f.pointer(f.jumpButton, "pointerdown", 5);
  assert.equal(
    f.input.consumeJumpRequest(),
    true,
    "another finger has an independent entry",
  );
  f.pointer(f.window, "pointercancel", 5);
  assert.equal(f.input.jumpPointer, 4);
  f.actionRoot.releasePointerCapture(4);
  assert.equal(f.input.jumpPointer, null);
  f.pointer(f.window, "pointermove", 4, 770, 400);
  dispatch(f.jumpButton, "click", { detail: 1 });
  assert.equal(
    f.input.consumeJumpRequest(),
    false,
    "cancelled contacts and native clicks cannot repeat",
  );

  f.pointer(f.jumpButton, "pointerdown", 6);
  f.pointer(f.window, "pointercancel", 6);
  assert.equal(
    f.input.consumeJumpRequest(),
    true,
    "PRESS was requested at contact, like Dash",
  );
  assert.equal(f.input.consumeJumpRequest(), false);
  assert.equal(f.input.actions.ownsPointer(6), false);
});

test("one action finger slides Sprint to Jump, Block, Dash and Jump re-entry", (t) => {
  const f = setup(t);
  f.pointer(f.sprintButton, "pointerdown", 1);
  assert.equal(f.input.sprinting, true);
  f.pointer(f.window, "pointermove", 1, 770, 400);
  assert.equal(f.input.sprinting, false);
  assert.equal(f.input.jumpPointer, 1);
  assert.equal(f.input.consumeJumpRequest(), true);
  f.pointer(f.window, "pointermove", 1, 775, 405);
  assert.equal(f.input.consumeJumpRequest(), false);
  f.pointer(f.window, "pointermove", 1, 615, 300);
  assert.equal(f.input.blocking, true);
  assert.equal(f.input.jumpPointer, null);
  f.pointer(f.window, "pointermove", 1, 615, 400);
  assert.equal(f.input.blocking, false);
  assert.equal(f.input.consumeDashRequest(), true);
  f.pointer(f.window, "pointermove", 1, 770, 400);
  assert.equal(
    f.input.consumeJumpRequest(),
    true,
    "re-entry makes a fresh request",
  );
  f.pointer(f.window, "pointercancel", 1);
  assert.equal(f.input.sprinting, false);
  assert.equal(f.input.blocking, false);
  assert.equal(f.input.jumpPointer, null);
  assert.equal(f.input.consumeJumpRequest(), false);
  assert.equal(f.input.consumeDashRequest(), false);
  assert.equal(f.input.actions.ownsPointer(1), false);
});

test("JUMP preserves simultaneous movement, camera, Sprint, Dash and aggregated Block input", (t) => {
  const f = setup(t);
  dispatch(f.joystick, "pointerdown", f.joystickPoint(1, 0.55, 0));
  f.pointer(f.cameraSurface, "pointerdown", 2, 500, 200);
  f.pointer(f.sprintButton, "pointerdown", 3);
  f.pointer(f.blockButton, "pointerdown", 4);
  f.pointer(f.blockButton, "pointerdown", 5);
  f.pointer(f.dashButton, "pointerdown", 6);
  f.pointer(f.jumpButton, "pointerdown", 7);
  assert.equal(f.input.consumeJumpRequest(), true);
  assert.equal(f.input.consumeDashRequest(), true);
  assert.equal(f.input.joystickPointer, 1);
  assert.equal(f.input.cameraPointer, 2);
  assert.equal(f.input.sprintPointer, 3);
  assert.equal(f.input.blockPointer, 4);
  assert.equal(f.input.blocking, true);
  assert.equal(f.input.sprinting, true);
  near(f.input.move.x, 0.5);
  f.pointer(f.window, "pointermove", 2, 515, 207);
  assert.deepEqual(f.input.consumeLookDelta(), { x: 15, y: 7 });

  f.pointer(f.window, "pointercancel", 7);
  f.pointer(f.window, "pointercancel", 4);
  assert.equal(f.input.jumpPointer, null);
  assert.equal(f.input.blocking, true, "the second Block finger remains held");
  assert.equal(f.input.blockPointer, 5);
  f.pointer(f.window, "pointerup", 5);
  assert.equal(f.input.blocking, false);
  assert.equal(f.input.sprinting, true);
  assert.equal(f.input.consumeJumpRequest(), false);
});

test("Space requests JUMP once per physical press and respects text/dialog focus", (t) => {
  const f = setup(t, { withJumpButton: false });
  assert.equal(f.key("keydown", "Space").defaultPrevented, true);
  assert.equal(f.input.consumeJumpRequest(), true);
  f.key("keydown", "Space", { repeat: true });
  f.key("keydown", "Space");
  assert.equal(
    f.input.consumeJumpRequest(),
    false,
    "holding Space cannot auto-hop",
  );
  f.key("keyup", "Space");
  f.key("keydown", "Space");
  assert.equal(f.input.consumeJumpRequest(), true);
  const editable = new ElementStub();
  editable.editableOrDialog = true;
  f.key("keyup", "Space", {}, editable);
  assert.equal(f.key("keydown", "Space", {}, editable).defaultPrevented, false);
  assert.equal(f.input.consumeJumpRequest(), false);
  f.key("keydown", "Space");
  f.input.reset();
  assert.equal(f.input.consumeJumpRequest(), false);
  f.key("keydown", "Space");
  assert.equal(
    f.input.consumeJumpRequest(),
    true,
    "reset clears the keyboard latch",
  );
});

test("Space preserves native utility button and link activation while body and canvas can JUMP", (t) => {
  const f = setup(t);
  const helpButton = f.addElement({ left: 20, top: 10, width: 60, height: 30 });
  helpButton.tagName = "BUTTON";
  const helpIcon = f.addElement({ left: 30, top: 15, width: 15, height: 15 });
  helpIcon.parentElement = helpButton;
  const link = f.addElement({ left: 100, top: 10, width: 60, height: 30 });
  link.tagName = "A";
  const roleButton = f.addElement({
    left: 180,
    top: 10,
    width: 60,
    height: 30,
  });
  roleButton.setAttribute("role", "button");
  for (const target of [
    f.resetButton,
    helpButton,
    helpIcon,
    link,
    roleButton,
  ]) {
    assert.equal(f.key("keydown", "Space", {}, target).defaultPrevented, false);
    assert.equal(
      f.input.consumeJumpRequest(),
      false,
      "utility activation cannot jump",
    );
    assert.equal(f.key("keyup", "Space", {}, target).defaultPrevented, false);
  }
  dispatch(f.resetButton, "click", { detail: 0 });
  assert.equal(f.resetCount, 1, "Reset retains its native click handler");
  const canvas = f.addElement({ left: 250, top: 10, width: 60, height: 30 });
  canvas.tagName = "CANVAS";
  for (const target of [f.actionRoot, canvas]) {
    assert.equal(f.key("keydown", "Space", {}, target).defaultPrevented, true);
    assert.equal(f.input.consumeJumpRequest(), true);
    f.key("keyup", "Space", {}, target);
  }
});

test("focused registered action buttons own Space and Enter without also requesting JUMP", (t) => {
  const f = setup(t);
  for (const code of ["Space", "Enter"]) {
    for (const [button, consume] of [
      [f.sprintButton, () => assert.equal(f.input.sprinting, true)],
      [f.blockButton, () => assert.equal(f.input.blocking, true)],
      [
        f.attackButton,
        () => assert.equal(f.input.consumeAttackRequest(), true),
      ],
      [f.dashButton, () => assert.equal(f.input.consumeDashRequest(), true)],
    ]) {
      f.key("keydown", code, {}, button);
      consume();
      assert.equal(
        f.input.consumeJumpRequest(),
        false,
        "the focused action consumes the key",
      );
      f.key("keyup", code, {}, button);
    }
    let jumpRequests = 0;
    const requestJump = f.input.requestJump.bind(f.input);
    f.input.requestJump = () => {
      jumpRequests++;
      requestJump();
    };
    f.key("keydown", code, {}, f.jumpButton);
    assert.equal(jumpRequests, 1, "Jump button entry is routed once");
    assert.equal(f.input.consumeJumpRequest(), true);
    f.key("keydown", code, { repeat: true }, f.jumpButton);
    assert.equal(f.input.consumeJumpRequest(), false);
    f.key("keyup", code, {}, f.jumpButton);
    assert.equal(jumpRequests, 1);
    f.input.requestJump = requestJump;
  }
  dispatch(f.jumpButton, "click", { detail: 0 });
  assert.equal(
    f.input.consumeJumpRequest(),
    true,
    "assistive activation remains available",
  );
});

test("DASH requests on contact once per pointer and consumption is one-shot", (t) => {
  const f = setup(t);
  assert.equal(f.input.consumeDashRequest(), false);
  const down = f.pointer(f.dashButton, "pointerdown", 4, 615, 400);
  assert.equal(down.defaultPrevented, true);
  assert.equal(f.input.consumeDashRequest(), true);
  assert.equal(f.input.consumeDashRequest(), false);
  assert.equal(f.actionRoot.hasPointerCapture(4), true);

  f.pointer(f.dashButton, "pointerdown", 4, 615, 400);
  assert.equal(f.input.consumeDashRequest(), false, "one entry cannot repeat");
  f.pointer(f.dashButton, "pointerdown", 5, 615, 400);
  assert.equal(f.input.dashPointer, 4);
  assert.equal(
    f.input.consumeDashRequest(),
    true,
    "another finger has an independent entry",
  );
  f.pointer(f.window, "pointerup", 5);
  assert.equal(f.input.dashPointer, 4);
  f.pointer(f.window, "pointerup", 4);
  dispatch(f.dashButton, "click", { detail: 1 });
  assert.equal(f.input.consumeDashRequest(), false);
  assert.equal(f.actionRoot.hasPointerCapture(4), false);

  f.pointer(f.dashButton, "pointerdown", 6, 615, 400);
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

test("DASH leaves simultaneous joystick, look, sprint, BLOCK and ATTACK owners untouched", (t) => {
  const f = setup(t);
  dispatch(f.joystick, "pointerdown", f.joystickPoint(1, 0.55, 0));
  f.pointer(f.cameraSurface, "pointerdown", 2, 500, 200);
  f.pointer(f.sprintButton, "pointerdown", 3, 700, 400);
  f.pointer(f.blockButton, "pointerdown", 4, 615, 300);
  f.pointer(f.dashButton, "pointerdown", 5, 615, 400);
  f.pointer(f.attackButton, "pointerdown", 6, 700, 300);
  assert.equal(f.input.consumeDashRequest(), true);
  assert.equal(f.input.consumeAttackRequest(), true);
  assert.equal(f.input.blockPointer, 4);
  assert.equal(f.input.attackPointer, 6);
  assert.equal(f.input.blocking, true);
  assert.equal(f.input.joystickPointer, 1);
  assert.equal(f.input.cameraPointer, 2);
  assert.equal(f.input.sprintPointer, 3);
  near(f.input.move.x, 0.5);
  near(f.input.move.y, 0);
  assert.equal(f.input.sprinting, true);

  f.pointer(f.window, "pointermove", 2, 515, 207);
  f.pointer(f.window, "pointerup", 4, 80, 90);
  f.pointer(f.window, "pointerup", 5);
  f.pointer(f.window, "pointerup", 6);
  assert.equal(f.input.blocking, false);
  assert.equal(f.input.sprinting, true);
  assert.deepEqual(f.input.consumeLookDelta(), { x: 15, y: 7 });
  assert.equal(f.input.consumeDashRequest(), false);
  assert.equal(f.input.consumeAttackRequest(), false);
});

test("dash reset discards queued input and captures and releases guard", (t) => {
  const f = setup(t);
  for (const trigger of ["blur", "hidden", "explicit"]) {
    f.pointer(f.blockButton, "pointerdown", 4);
    f.pointer(f.dashButton, "pointerdown", 5, 615, 400);
    if (trigger === "hidden") {
      f.document.hidden = true;
      dispatch(f.document, "visibilitychange");
    } else if (trigger === "explicit") f.input.reset();
    else dispatch(f.window, trigger);
    assert.equal(f.input.dashPointer, null);
    assert.equal(f.actionRoot.capturedPointers.size, 0);
    assert.equal(f.input.consumeDashRequest(), false);
    assert.equal(f.input.blocking, false);
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

test("DASH keyboard entry and accessibility clicks activate once without pointer-click duplication", (t) => {
  const f = setup(t);
  for (const code of ["Space", "Enter"]) {
    assert.equal(
      f.key("keydown", code, {}, f.dashButton).defaultPrevented,
      true,
    );
    assert.equal(f.input.consumeDashRequest(), true);
    f.key("keydown", code, { repeat: true }, f.dashButton);
    f.key("keydown", code, {}, f.dashButton);
    assert.equal(
      f.input.consumeDashRequest(),
      false,
      "key repeat cannot repeat PRESS",
    );
    assert.equal(f.key("keyup", code, {}, f.dashButton).defaultPrevented, true);
    assert.equal(f.input.consumeDashRequest(), false);
  }
  const click = dispatch(f.dashButton, "click", { detail: 0 });
  assert.equal(click.defaultPrevented, true);
  assert.equal(
    f.input.consumeDashRequest(),
    true,
    "standalone accessibility click remains available",
  );
  assert.equal(f.input.consumeDashRequest(), false);
  dispatch(f.dashButton, "click", { detail: 1 });
  assert.equal(f.input.consumeDashRequest(), false);
});

test("DASH ignores drag-in and secondary mouse, and cooldown UI never owns eligibility", (t) => {
  const f = setup(t);
  f.pointer(f.dashButton, "pointermove", 4, 615, 400);
  f.pointer(f.window, "pointerup", 4, 80, 90);
  assert.equal(f.input.consumeDashRequest(), false);
  f.pointer(f.dashButton, "pointerdown", 4, 615, 400, "mouse", 2);
  assert.equal(f.input.consumeDashRequest(), false);
  assert.equal(f.input.dashPointer, null);

  f.dashButton.setAttribute("aria-disabled", "true");
  assert.equal(
    f.pointer(f.dashButton, "pointerdown", 5, 615, 400).defaultPrevented,
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
  f.pointer(f.dashButton, "pointerdown", 6, 615, 400);
  assert.equal(
    f.input.consumeDashRequest(),
    true,
    "another finger can request while the first retains ownership",
  );
  assert.equal(f.input.dashPointer, 5);
  f.pointer(f.window, "pointerup", 5);
  assert.equal(f.input.dashPointer, 6);
  f.pointer(f.window, "pointerup", 6);
  f.actionRoot.captureSupported = false;
  f.pointer(f.dashButton, "pointerdown", 7, 615, 400);
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
  f.pointer(f.blockButton, "pointerdown", 4);
  f.pointer(f.attackButton, "pointerdown", 5);
  f.input.destroy();
  assertStopped(f.input);
  for (const target of [
    f.window,
    f.document,
    f.actionRoot,
    f.joystick,
    f.joystickKnob,
    f.sprintButton,
    f.cameraSurface,
    f.resetButton,
    f.attackButton,
    f.blockButton,
    f.dashButton,
    f.jumpButton,
  ]) {
    assert.equal(target.listenerCount, 0);
  }
  f.key("keydown", "KeyW");
  f.key("keydown", "KeyF");
  f.key("keydown", "KeyQ");
  f.key("keydown", "Space");
  f.pointer(f.sprintButton, "pointerdown", 4);
  dispatch(f.joystick, "pointerdown", f.joystickPoint(5, 1, 0));
  dispatch(f.resetButton, "click");
  dispatch(f.attackButton, "click", { detail: 0 });
  f.pointer(f.blockButton, "pointerdown", 7);
  f.pointer(f.dashButton, "pointerdown", 6, 615, 400);
  dispatch(f.dashButton, "click", { detail: 0 });
  f.pointer(f.jumpButton, "pointerdown", 8);
  dispatch(f.jumpButton, "click", { detail: 0 });
  assertStopped(f.input);
  assert.equal(f.resetCount, 0);
  assert.equal(f.input.consumeAttackRequest(), false);
  assert.equal(f.input.consumeDashRequest(), false);
  assert.equal(f.input.consumeJumpRequest(), false);
});

test("one action finger slides through Sprint, Dash, Block, Attack and gaps without lifting", (t) => {
  const f = setup(t);
  f.pointer(f.sprintButton, "pointerdown", 10);
  assert.equal(f.input.sprinting, true);
  assert.equal(f.actionRoot.hasPointerCapture(10), true);
  assert.equal(f.sprintButton.hasPointerCapture(10), false);

  f.pointer(f.window, "pointermove", 10, 615, 400);
  assert.equal(
    f.input.sprinting,
    false,
    "leaving HOLD releases it immediately",
  );
  assert.equal(f.input.sprintPointer, null);
  assert.equal(f.input.dashPointer, 10);
  assert.equal(f.input.consumeDashRequest(), true);
  f.pointer(f.window, "pointermove", 10, 620, 405);
  assert.equal(
    f.input.consumeDashRequest(),
    false,
    "PRESS cannot repeat inside",
  );

  f.pointer(f.window, "pointermove", 10, 700, 400);
  assert.equal(
    f.input.sprinting,
    true,
    "sliding back immediately resumes HOLD",
  );
  f.pointer(f.window, "pointermove", 10, 615, 400);
  assert.equal(
    f.input.consumeDashRequest(),
    true,
    "PRESS requests again on re-entry",
  );
  f.pointer(f.window, "pointermove", 10, 615, 300);
  assert.equal(f.input.blocking, true);
  assert.equal(f.input.sprinting, false);
  f.pointer(f.window, "pointermove", 10, 700, 300);
  assert.equal(f.input.blocking, false);
  assert.equal(f.input.consumeAttackRequest(), true);
  f.pointer(f.window, "pointermove", 10, 705, 305);
  assert.equal(f.input.consumeAttackRequest(), false);

  f.pointer(f.window, "pointermove", 10, 750, 350);
  assert.equal(f.input.attackPointer, null);
  assert.equal(f.input.blocking, false);
  assert.equal(
    f.input.actions.ownsPointer(10),
    true,
    "ownership survives a gap",
  );
  f.pointer(f.window, "pointermove", 10, 700, 400);
  assert.equal(f.input.sprinting, true);
  f.pointer(f.window, "pointerup", 10, 700, 400);
  assert.equal(f.input.sprinting, false);
  assert.equal(f.input.actions.ownsPointer(10), false);
  assert.equal(f.actionRoot.hasPointerCapture(10), false);
  assert.equal(f.input.consumeAttackRequest(), false);
});

test("multiple action fingers release HOLD only when its last occupant leaves", (t) => {
  const f = setup(t);
  f.pointer(f.sprintButton, "pointerdown", 1);
  f.pointer(f.sprintButton, "pointerdown", 2);
  f.pointer(f.window, "pointermove", 1, 615, 400);
  assert.equal(f.input.consumeDashRequest(), true);
  assert.equal(f.input.sprinting, true, "second finger still holds Sprint");
  assert.equal(f.input.sprintPointer, 2);
  f.pointer(f.window, "pointercancel", 1);
  assert.equal(f.input.sprinting, true);
  f.pointer(f.window, "pointermove", 2, 750, 350);
  assert.equal(f.input.sprinting, false);
  f.pointer(f.window, "pointermove", 2, 700, 400);
  assert.equal(f.input.sprinting, true);
  f.actionRoot.releasePointerCapture(2);
  assert.equal(f.input.sprinting, false);
  assert.equal(f.input.actions.ownsPointer(2), false);
});

test("joystick and camera gestures crossing action buttons cannot activate them", (t) => {
  const f = setup(t);
  dispatch(f.joystick, "pointerdown", f.joystickPoint(1, 0, -1));
  f.pointer(f.cameraSurface, "pointerdown", 2, 500, 200);
  for (const [x, y] of [
    [700, 400],
    [615, 400],
    [615, 300],
    [770, 400],
    [700, 300],
  ]) {
    f.pointer(f.window, "pointermove", 1, x, y);
    f.pointer(f.window, "pointermove", 2, x, y);
    assert.equal(f.input.sprinting, false);
    assert.equal(f.input.consumeDashRequest(), false);
    assert.equal(f.input.blocking, false);
    assert.equal(f.input.consumeAttackRequest(), false);
    assert.equal(f.input.consumeJumpRequest(), false);
  }
  assert.equal(f.input.joystickPointer, 1);
  assert.equal(f.input.cameraPointer, 2);
  assert.deepEqual(f.input.consumeLookDelta(), { x: 200, y: 100 });
  assert.equal(f.input.actions.ownsPointer(1), false);
  assert.equal(f.input.actions.ownsPointer(2), false);

  f.pointer(f.sprintButton, "pointerdown", 3);
  f.pointer(f.window, "pointermove", 3, 500, 200);
  assert.equal(f.input.sprinting, false);
  assert.equal(
    f.input.cameraPointer,
    2,
    "action gestures cannot steal the camera",
  );
  assert.deepEqual(f.input.consumeLookDelta(), { x: 0, y: 0 });
});

test("future actions join the same sliding gesture and follow current layout geometry", (t) => {
  const f = setup(t);
  const focus = f.addElement({ left: 500, top: 350, width: 70, height: 80 });
  const icon = f.addElement({ left: 520, top: 375, width: 20, height: 20 });
  icon.parentElement = focus;
  const held = [];
  const unregister = f.input.actions.register({
    id: "focus",
    element: focus,
    behavior: "HOLD",
    onHoldChange: (active) => held.push(active),
  });
  f.pointer(f.sprintButton, "pointerdown", 1);
  f.pointer(f.window, "pointermove", 1, 530, 385);
  assert.equal(f.input.sprinting, false);
  assert.equal(
    f.input.actions.isHeld("focus"),
    true,
    "button children hit their registered ancestor",
  );
  assert.deepEqual(held, [true]);

  focus.rect.left = 410;
  icon.rect.left = 430;
  f.pointer(f.window, "pointermove", 1, 530, 385);
  assert.equal(
    f.input.actions.isHeld("focus"),
    false,
    "layout changes do not leave stale hit bounds",
  );
  f.pointer(f.window, "pointermove", 1, 440, 385);
  assert.equal(f.input.actions.isHeld("focus"), true);
  unregister();
  assert.equal(f.input.actions.isHeld("focus"), false);
  assert.deepEqual(held, [true, false, true, false]);
  f.pointer(f.window, "pointermove", 1, 700, 400);
  assert.equal(
    f.input.sprinting,
    true,
    "removing a binding does not strand an action finger",
  );
});

test("action capture fallback still routes sliding and cancellation clears momentary state", (t) => {
  const f = setup(t);
  f.actionRoot.captureSupported = false;
  f.pointer(f.sprintButton, "pointerdown", 1);
  assert.equal(f.input.sprinting, true);
  f.pointer(f.window, "pointermove", 1, 615, 400);
  assert.equal(f.input.sprinting, false);
  assert.equal(f.input.consumeDashRequest(), true);
  f.pointer(f.window, "pointermove", 1, 700, 300);
  assert.equal(f.input.consumeAttackRequest(), true);
  f.pointer(f.window, "pointermove", 1, 615, 300);
  assert.equal(f.input.blocking, true);
  f.pointer(f.window, "pointercancel", 1);
  assert.equal(f.input.sprinting, false);
  assert.equal(f.input.blocking, false);
  assert.equal(f.input.actions.ownsPointer(1), false);
  f.pointer(f.window, "pointermove", 1, 615, 400);
  f.pointer(f.window, "pointermove", 1, 700, 300);
  assert.equal(
    f.input.consumeDashRequest(),
    false,
    "cancelled pointers cannot reactivate by moving",
  );
  assert.equal(f.input.consumeAttackRequest(), false);
});

test("movement requests preserve Dash and Jump entry order before a fixed step", (t) => {
  const f = setup(t);
  for (const source of ["touch", "shortcut", "button-key"]) {
    for (const order of [
      ["dash", "jump"],
      ["jump", "dash"],
    ]) {
      f.input.reset();
      for (const [index, action] of order.entries()) {
        const button = action === "dash" ? f.dashButton : f.jumpButton;
        if (source === "touch") f.pointer(button, "pointerdown", index + 1);
        else if (source === "shortcut")
          f.key("keydown", action === "dash" ? "KeyE" : "Space");
        else
          f.key("keydown", action === "dash" ? "Enter" : "Space", {}, button);
      }
      assert.equal(f.input.dashRequested, true);
      assert.equal(f.input.jumpRequested, true);
      assert.equal(
        f.input.consumeMovementRequest(),
        order[0],
        `${source}: first entry wins priority`,
      );
      assert.equal(
        f.input.consumeMovementRequest(),
        order[1],
        `${source}: second entry follows immediately`,
      );
      assert.equal(f.input.consumeMovementRequest(), null);
      assert.equal(
        f.input.consumeDashRequest(),
        false,
        "ordered consumption also clears the Dash flag",
      );
      assert.equal(
        f.input.consumeJumpRequest(),
        false,
        "ordered consumption also clears the Jump flag",
      );
    }
  }
});

test("movement requests deduplicate pending actions and legacy consumers cannot double-deliver", (t) => {
  const f = setup(t);
  for (let index = 0; index < 20; index++) {
    f.input.requestDash();
    f.input.requestJump();
  }
  assert.equal(
    f.input.movementRequests.length,
    2,
    "at most two movement requests are pending",
  );
  assert.equal(f.input.consumeDashRequest(), true);
  assert.equal(f.input.consumeDashRequest(), false);
  assert.equal(f.input.consumeMovementRequest(), "jump");
  assert.equal(f.input.consumeJumpRequest(), false);
  assert.equal(f.input.consumeMovementRequest(), null);

  f.input.requestJump();
  f.input.requestDash();
  assert.equal(
    f.input.consumeDashRequest(),
    true,
    "a legacy consumer can remove the later entry",
  );
  assert.equal(f.input.consumeJumpRequest(), true);
  assert.equal(
    f.input.consumeMovementRequest(),
    null,
    "neither consumed entry can be delivered again",
  );

  f.input.requestDash();
  f.input.requestJump();
  assert.equal(f.input.consumeMovementRequest(), "dash");
  f.input.requestDash();
  assert.equal(
    f.input.consumeMovementRequest(),
    "jump",
    "a new entry stays behind an older pending entry",
  );
  assert.equal(f.input.consumeMovementRequest(), "dash");
  assert.equal(f.input.consumeMovementRequest(), null);
});

test("lifecycle resets discard ordered movement requests and release their pending flags", (t) => {
  const f = setup(t);
  for (const trigger of [
    "blur",
    "resize",
    "orientationchange",
    "hidden",
    "explicit",
  ]) {
    f.input.requestJump();
    f.input.requestDash();
    if (trigger === "hidden") {
      f.document.hidden = true;
      dispatch(f.document, "visibilitychange");
    } else if (trigger === "explicit") f.input.reset();
    else dispatch(f.window, trigger);
    assert.equal(f.input.consumeMovementRequest(), null);
    assert.equal(f.input.consumeJumpRequest(), false);
    assert.equal(f.input.consumeDashRequest(), false);
    assert.equal(f.input.movementRequests.length, 0);
  }
});

test("disabling input immediately releases controls, captures, keys and pending requests", (t) => {
  const f = setup(t);
  assert.equal(f.input.enabled, true);
  assert.equal(f.input.actions.enabled, true);
  dispatch(f.joystick, "pointerdown", f.joystickPoint(1, 1, 0));
  f.pointer(f.cameraSurface, "pointerdown", 2, 500, 200);
  f.pointer(f.window, "pointermove", 2, 520, 210);
  f.pointer(f.sprintButton, "pointerdown", 3);
  f.pointer(f.blockButton, "pointerdown", 4);
  f.key("keydown", "KeyQ");
  f.key("keydown", "ShiftLeft");
  f.key("keydown", "KeyW");
  f.input.requestDash();
  f.input.requestJump();
  f.input.requestAttack();
  assert.equal(f.input.sprinting, true);
  assert.equal(f.input.blocking, true);
  assert.equal(f.input.movementRequests.length, 2);

  f.input.setEnabled(false);
  assert.equal(f.input.enabled, false);
  assert.equal(f.input.actions.enabled, false);
  assertStopped(f.input);
  assert.equal(f.input.joystickPointer, null);
  assert.equal(f.input.cameraPointer, null);
  assert.equal(f.input.sprintPointer, null);
  assert.equal(f.input.blockPointer, null);
  assert.equal(f.input.keys.size, 0);
  assert.equal(f.input.actions.pointers.size, 0);
  assert.equal(f.input.actions.keyboard.size, 0);
  assert.equal(f.input.consumeMovementRequest(), null);
  assert.equal(f.input.consumeDashRequest(), false);
  assert.equal(f.input.consumeJumpRequest(), false);
  assert.equal(f.input.consumeAttackRequest(), false);
  for (const element of [f.joystick, f.cameraSurface, f.actionRoot])
    assert.equal(element.capturedPointers.size, 0);
  assert.equal(f.sprintButton.getAttribute("aria-pressed"), "false");
  assert.equal(f.blockButton.getAttribute("aria-pressed"), "false");
  f.input.setEnabled(false);
  assertStopped(f.input);
});

test("disabled input leaves editor gestures, native button events and game keys unconsumed", (t) => {
  const f = setup(t);
  f.input.setEnabled(false);
  let propagatedDown = 0;
  f.window.addEventListener("pointerdown", () => propagatedDown++);
  const controls = [
    f.joystick,
    f.cameraSurface,
    f.sprintButton,
    f.blockButton,
    f.attackButton,
    f.dashButton,
    f.jumpButton,
    f.resetButton,
  ];
  for (const [index, element] of controls.entries()) {
    const id = index + 1;
    assert.equal(f.pointer(element, "pointerdown", id).defaultPrevented, false);
    assert.equal(
      f.pointer(f.window, "pointermove", id, 700, 300).defaultPrevented,
      false,
    );
    assert.equal(f.pointer(f.window, "pointerup", id).defaultPrevented, false);
    assert.equal(
      dispatch(element, "click", { detail: 0 }).defaultPrevented,
      false,
    );
    assert.equal(dispatch(element, "contextmenu").defaultPrevented, false);
    assert.equal(dispatch(element, "dragstart").defaultPrevented, false);
  }
  assert.equal(
    propagatedDown,
    controls.length,
    "disabled controls do not stop editor pointer propagation",
  );
  for (const code of [
    "KeyW",
    "ArrowLeft",
    "ShiftLeft",
    "KeyQ",
    "KeyF",
    "KeyE",
    "KeyR",
    "Space",
  ])
    for (const type of ["keydown", "keyup"])
      assert.equal(f.key(type, code).defaultPrevented, false);
  for (const button of [
    f.sprintButton,
    f.blockButton,
    f.attackButton,
    f.dashButton,
    f.jumpButton,
  ])
    for (const code of ["Space", "Enter"])
      for (const type of ["keydown", "keyup"])
        assert.equal(f.key(type, code, {}, button).defaultPrevented, false);
  f.input.requestAttack();
  f.input.requestDash();
  f.input.requestJump();
  assert.equal(f.input.consumeAttackRequest(), false);
  assert.equal(f.input.consumeMovementRequest(), null);
  assert.equal(f.input.consumeDashRequest(), false);
  assert.equal(f.input.consumeJumpRequest(), false);
  assert.equal(f.resetCount, 0);
  assertStopped(f.input);
  assert.equal(f.input.keys.size, 0);
  assert.equal(f.input.actions.pointers.size, 0);
});

test("enabling input requires fresh entries and resumes touch, keyboard and reset controls", (t) => {
  const f = setup(t);
  f.key("keydown", "KeyW");
  f.key("keydown", "KeyQ");
  f.key("keydown", "Space");
  f.input.setEnabled(false);
  f.pointer(f.joystick, "pointerdown", 1);
  f.pointer(f.cameraSurface, "pointerdown", 2, 500, 200);
  f.pointer(f.dashButton, "pointerdown", 3);
  f.input.setEnabled(true);
  assert.equal(f.input.enabled, true);
  assert.equal(f.input.actions.enabled, true);
  f.pointer(f.window, "pointermove", 1, 700, 400);
  f.pointer(f.window, "pointermove", 2, 520, 220);
  f.pointer(f.window, "pointermove", 3, 770, 400);
  for (const code of ["KeyW", "KeyQ", "ShiftLeft", "KeyF", "KeyE", "Space"])
    f.key("keydown", code, { repeat: true });
  assertStopped(f.input);
  assert.equal(f.input.consumeMovementRequest(), null);
  assert.equal(f.input.consumeAttackRequest(), false);
  assert.equal(f.input.actions.pointers.size, 0);

  f.key("keydown", "KeyW");
  f.key("keydown", "KeyQ");
  f.key("keydown", "ShiftLeft");
  f.key("keydown", "KeyF");
  f.key("keydown", "KeyE");
  f.key("keydown", "Space");
  near(f.input.move.y, 1);
  assert.equal(f.input.blocking, true);
  assert.equal(f.input.sprinting, true);
  assert.equal(f.input.consumeAttackRequest(), true);
  assert.equal(f.input.consumeMovementRequest(), "dash");
  assert.equal(f.input.consumeMovementRequest(), "jump");
  f.input.reset();
  dispatch(f.joystick, "pointerdown", f.joystickPoint(10, -1, 0));
  f.pointer(f.cameraSurface, "pointerdown", 11, 500, 200);
  f.pointer(f.window, "pointermove", 11, 515, 207);
  f.pointer(f.sprintButton, "pointerdown", 12);
  f.pointer(f.blockButton, "pointerdown", 13);
  f.pointer(f.dashButton, "pointerdown", 14);
  f.pointer(f.jumpButton, "pointerdown", 15);
  f.pointer(f.attackButton, "pointerdown", 16);
  near(f.input.move.x, -1);
  assert.equal(f.input.sprinting, true);
  assert.equal(f.input.blocking, true);
  assert.deepEqual(f.input.consumeLookDelta(), { x: 15, y: 7 });
  assert.equal(f.input.consumeMovementRequest(), "dash");
  assert.equal(f.input.consumeMovementRequest(), "jump");
  assert.equal(f.input.consumeAttackRequest(), true);
  f.input.setEnabled(true);
  assert.equal(
    f.input.sprintPointer,
    12,
    "enabling an already enabled controller preserves current input",
  );
  dispatch(f.resetButton, "click", { detail: 0 });
  assert.equal(f.resetCount, 1);
});

test("buttons relocated while input is disabled use their current hit positions on resume", (t) => {
  const f = setup(t);
  f.input.setEnabled(false);
  Object.assign(f.dashButton.rect, { left: 200, top: 260 });
  Object.assign(f.jumpButton.rect, { left: 290, top: 260 });
  f.input.setEnabled(true);
  f.pointer(f.dashButton, "pointerdown", 1, 615, 400);
  assert.equal(
    f.input.consumeMovementRequest(),
    null,
    "the old Dash position no longer activates Dash",
  );
  f.pointer(f.sprintButton, "pointerdown", 2);
  assert.equal(f.input.sprinting, true);
  f.pointer(f.window, "pointermove", 2, 235, 300);
  assert.equal(f.input.sprinting, false);
  assert.equal(f.input.consumeMovementRequest(), "dash");
  f.pointer(f.window, "pointermove", 2, 320, 300);
  assert.equal(f.input.consumeMovementRequest(), "jump");
  f.pointer(f.window, "pointerup", 2);
  assert.equal(f.input.actions.ownsPointer(2), false);
});
