import test from "node:test";
import assert from "node:assert/strict";
import { Group } from "three";
import {
  ActionBehavior,
  TouchActionRouter,
} from "../src/input/TouchActionRouter.js";
import { CharacterController } from "./helpers/ControllerFixture.js";
import { ArenaBounds } from "../src/world/ArenaBounds.js";

// DOM event/hit-test doubles verify routing, not browser or physical-phone touch
// arbitration. Browser smoke tests cover real pointer capture and mobile layout.
class TrackedTarget extends EventTarget {
  constructor() {
    super();
    this.listeners = new Map();
  }

  addEventListener(type, listener, options) {
    super.addEventListener(type, listener, options);
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(listener);
  }

  removeEventListener(type, listener, options) {
    super.removeEventListener(type, listener, options);
    this.listeners.get(type)?.delete(listener);
  }

  get listenerCount() {
    return [...this.listeners.values()].reduce(
      (n, listeners) => n + listeners.size,
      0,
    );
  }
}

class ElementStub extends TrackedTarget {
  constructor(document, name, x, y = 400, width = 70, height = 70) {
    super();
    this.ownerDocument = document;
    this.name = name;
    this.tagName = "BUTTON";
    this.nodeType = 1;
    this.parentElement = null;
    this.rect = { left: x, top: y, width, height };
    this.capturedPointers = new Set();
    this.captureSupported = true;
    this.disabled = false;
    this.dataset = {};
    this.style = {};
    this.attributes = new Map();
    const classes = new Set();
    this.classList = {
      add: (name) => classes.add(name),
      remove: (name) => classes.delete(name),
      toggle: (name, force) => {
        const add = force === undefined ? !classes.has(name) : force;
        add ? classes.add(name) : classes.delete(name);
        return add;
      },
      contains: (name) => classes.has(name),
    };
  }

  contains(element) {
    for (let node = element; node; node = node.parentElement) {
      if (node === this) return true;
    }
    return false;
  }

  closest() {
    return null;
  }

  getBoundingClientRect() {
    const { left, top, width, height } = this.rect;
    return {
      left,
      top,
      width,
      height,
      right: left + width,
      bottom: top + height,
    };
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
    if (name.startsWith("data-")) {
      const key = name
        .slice(5)
        .replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
      this.dataset[key] = String(value);
    }
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  removeAttribute(name) {
    this.attributes.delete(name);
    if (name.startsWith("data-")) {
      const key = name
        .slice(5)
        .replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
      delete this.dataset[key];
    }
  }

  setPointerCapture(pointerId) {
    if (!this.captureSupported) throw new Error("Pointer capture unavailable");
    this.capturedPointers.add(pointerId);
  }

  hasPointerCapture(pointerId) {
    return this.capturedPointers.has(pointerId);
  }

  releasePointerCapture(pointerId) {
    if (!this.capturedPointers.delete(pointerId)) return;
    // Browser release may synchronously cause loss; reset must be reentrant.
    dispatch(this.ownerDocument, "lostpointercapture", { pointerId }, this);
  }
}

function dispatch(target, type, properties = {}, originalTarget = target) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, properties);
  Object.defineProperty(event, "target", { value: originalTarget });
  event.composedPath = () => {
    const path = [];
    for (let node = originalTarget; node; node = node.parentElement)
      path.push(node);
    return path;
  };
  target.dispatchEvent(event);
  return event;
}

function setup(t, routerOptions = {}) {
  const previous = Object.fromEntries(
    ["window", "document", "Element", "HTMLElement"].map((key) => [
      key,
      globalThis[key],
    ]),
  );
  const window = new TrackedTarget();
  const document = Object.assign(new TrackedTarget(), { hidden: false });
  const root = new ElementStub(document, "root", 0, 0, 900, 600);
  root.tagName = "HTML";
  document.documentElement = root;
  document.defaultView = window;
  const layers = [];
  const makeElement = (name, x, y, width, height) => {
    const element = new ElementStub(document, name, x, y, width, height);
    element.parentElement = root;
    layers.push(element);
    return element;
  };
  document.elementFromPoint = (x, y) => {
    for (const element of [...layers].reverse()) {
      const rect = element.getBoundingClientRect();
      if (x >= rect.left && x < rect.right && y >= rect.top && y < rect.bottom)
        return element;
    }
    return x >= 0 && x < 900 && y >= 0 && y < 600 ? root : null;
  };
  Object.assign(globalThis, {
    window,
    document,
    Element: ElementStub,
    HTMLElement: ElementStub,
  });
  const router = new TouchActionRouter({
    root,
    eventTarget: document,
    ...routerOptions,
  });
  t.after(() => {
    router.destroy();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
  });
  const sprint = makeElement("sprint", 500);
  const dash = makeElement("dash", 600);
  const fight = makeElement("fight", 700);
  const holdChanges = [];
  let dashCount = 0;
  let fightCount = 0;
  let fighting = false;
  router.register({
    id: "sprint",
    element: sprint,
    behavior: ActionBehavior.HOLD,
    onHoldChange: (value) => holdChanges.push(value),
  });
  router.register({
    id: "dash",
    element: dash,
    behavior: ActionBehavior.PRESS,
    onActivate: () => dashCount++,
  });
  router.register({
    id: "fight",
    element: fight,
    behavior: ActionBehavior.TOGGLE,
    onActivate: () => {
      fightCount++;
      fighting = !fighting;
    },
  });
  return {
    router,
    root,
    window,
    document,
    sprint,
    dash,
    fight,
    holdChanges,
    makeElement,
    get dashCount() {
      return dashCount;
    },
    get fightCount() {
      return fightCount;
    },
    get fighting() {
      return fighting;
    },
    pointer(type, pointerId, x, y = 435, target) {
      return dispatch(
        document,
        type,
        {
          pointerId,
          clientX: x,
          clientY: y,
          pointerType: "touch",
          button: 0,
          buttons: type === "pointerup" || type === "pointercancel" ? 0 : 1,
          isPrimary: pointerId === 1,
        },
        target ??
          (type === "pointerdown" ? document.elementFromPoint(x, y) : root),
      );
    },
    key(type, key, target, properties = {}) {
      document.activeElement = target;
      return dispatch(
        document,
        type,
        { key, code: key === " " ? "Space" : key, ...properties },
        target,
      );
    },
  };
}

test("a continuous slide releases HOLD, activates PRESS and TOGGLE once per entry", (t) => {
  const f = setup(t);
  f.pointer("pointerdown", 1, 535);
  assert.equal(f.router.isHeld("sprint"), true);
  assert.equal(f.router.getPointer("sprint"), 1);
  assert.equal(f.router.ownsPointer(1), true);
  f.pointer("pointermove", 1, 635);
  assert.equal(f.router.isHeld("sprint"), false);
  assert.equal(f.dashCount, 1);
  for (let i = 0; i < 4; i++) f.pointer("pointermove", 1, 635 + i);
  assert.equal(
    f.dashCount,
    1,
    "remaining inside a PRESS button never repeats it",
  );
  f.pointer("pointermove", 1, 535);
  assert.equal(f.router.isHeld("sprint"), true);
  f.pointer("pointermove", 1, 635);
  assert.equal(f.dashCount, 2);
  f.pointer("pointermove", 1, 735);
  assert.equal(f.fighting, true);
  f.pointer("pointermove", 1, 740);
  assert.equal(f.fightCount, 1);
  f.pointer("pointermove", 1, 800);
  assert.equal(
    f.fighting,
    true,
    "leaving a TOGGLE button preserves external stance state",
  );
  assert.equal(
    f.router.ownsPointer(1),
    true,
    "a gap retains the action gesture role",
  );
  f.pointer("pointermove", 1, 735);
  assert.equal(f.fighting, false);
  f.pointer("pointerup", 1, 735);
  assert.equal(f.fightCount, 2, "release does not activate again");
  assert.equal(f.router.ownsPointer(1), false);
  assert.deepEqual(f.holdChanges, [true, false, true, false]);
});

test("HOLD ownership is aggregated across independent fingers", (t) => {
  const f = setup(t);
  f.pointer("pointerdown", 1, 535);
  f.pointer("pointerdown", 2, 540);
  assert.deepEqual(f.holdChanges, [true]);
  f.pointer("pointermove", 1, 635);
  assert.equal(f.dashCount, 1);
  assert.equal(f.router.isHeld("sprint"), true);
  assert.equal(f.router.getPointer("sprint"), 2);
  f.pointer("pointerdown", 3, 735);
  assert.equal(f.fighting, true);
  f.pointer("pointercancel", 2, 540);
  assert.equal(f.router.isHeld("sprint"), false);
  assert.deepEqual(f.holdChanges, [true, false]);
  assert.equal(f.router.ownsPointer(1), true);
  assert.equal(f.router.ownsPointer(3), true);
  f.pointer("pointermove", 1, 535);
  assert.equal(f.router.isHeld("sprint"), true);
  f.pointer("pointerup", 3, 735);
  assert.equal(f.router.isHeld("sprint"), true);
  f.pointer("pointerup", 1, 535);
  assert.equal(f.router.isHeld("sprint"), false);
});

test("PRESS and TOGGLE entry tracking is independent for simultaneous fingers", (t) => {
  const f = setup(t);
  f.pointer("pointerdown", 1, 635);
  f.pointer("pointerdown", 2, 640);
  assert.equal(f.dashCount, 2);
  f.pointer("pointermove", 1, 735);
  assert.equal(f.fighting, true);
  f.pointer("pointermove", 2, 635);
  assert.equal(
    f.dashCount,
    2,
    "one finger's exit does not reset another finger's entry",
  );
  f.pointer("pointermove", 2, 735);
  assert.equal(
    f.fighting,
    false,
    "both fingers can independently enter the same TOGGLE",
  );
  f.pointer("pointermove", 1, 635);
  assert.equal(f.dashCount, 3);
  f.pointer("pointerup", 1, 635);
  assert.equal(f.router.ownsPointer(2), true);
});

test("coalesced move samples preserve button entries during a fast continuous slide", (t) => {
  const f = setup(t);
  f.pointer("pointerdown", 1, 535);
  dispatch(
    f.document,
    "pointermove",
    {
      pointerId: 1,
      pointerType: "touch",
      clientX: 735,
      clientY: 435,
      getCoalescedEvents: () => [
        { clientX: 575, clientY: 435 },
        { clientX: 635, clientY: 435 },
        { clientX: 645, clientY: 435 },
        { clientX: 735, clientY: 435 },
      ],
    },
    f.root,
  );
  assert.equal(f.router.isHeld("sprint"), false);
  assert.equal(f.dashCount, 1);
  assert.equal(f.fightCount, 1);
  assert.equal(f.fighting, true);
});

test("capture targets, button children and fresh hit-test geometry route the current location", (t) => {
  const f = setup(t);
  const label = f.makeElement("dash-label", 610, 415, 40, 30);
  label.parentElement = f.dash;
  f.pointer("pointerdown", 1, 535);
  assert.equal(f.root.hasPointerCapture(1), true);
  f.pointer("pointermove", 1, 635, 435, f.root);
  assert.equal(
    f.dashCount,
    1,
    "the child hit belongs to Dash despite root pointer capture",
  );
  f.dash.rect.left = 300;
  label.rect.left = 310;
  f.pointer("pointermove", 1, 635);
  assert.equal(f.router.getPointer("dash"), null);
  f.pointer("pointermove", 1, 335);
  assert.equal(f.dashCount, 2, "a moved button uses current DOM geometry");
  const overlay = f.makeElement("overlay", 300);
  f.pointer("pointermove", 1, 335);
  assert.equal(
    f.router.getPointer("dash"),
    null,
    "an unrelated topmost element blocks activation",
  );
  f.pointer("pointerup", 1, 335, 435, overlay);
  assert.equal(f.dashCount, 2);
});

test("pointers begun on camera, joystick or utility controls cannot be adopted by action buttons", (t) => {
  const f = setup(t);
  const joystick = f.makeElement("joystick", 50);
  const camera = f.makeElement("camera", 250);
  const reset = f.makeElement("reset", 800, 50, 80, 30);
  for (const [id, x, y, target] of [
    [1, 85, 435, joystick],
    [2, 285, 435, camera],
    [3, 830, 65, reset],
  ]) {
    f.pointer("pointerdown", id, x, y, target);
    assert.equal(f.router.ownsPointer(id), false);
    f.pointer("pointermove", id, 635);
    f.pointer("pointermove", id, 535);
    f.pointer("pointermove", id, 735);
    f.pointer("pointerup", id, 735);
  }
  assert.equal(f.dashCount, 0);
  assert.equal(f.fightCount, 0);
  assert.equal(f.router.isHeld("sprint"), false);
  f.pointer("pointerdown", 4, 535);
  f.pointer("pointermove", 4, 285);
  assert.equal(f.router.isHeld("sprint"), false);
  assert.equal(f.router.ownsPointer(4), true);
  f.pointer("pointermove", 4, 635);
  assert.equal(f.dashCount, 1);
});

test("an externally reserved pointer cannot be claimed even over an action button", (t) => {
  const f = setup(t, { canClaimPointer: (event) => event.pointerId !== 7 });
  f.pointer("pointerdown", 7, 535);
  f.pointer("pointermove", 7, 635);
  assert.equal(f.router.ownsPointer(7), false);
  assert.equal(f.router.isHeld("sprint"), false);
  assert.equal(f.dashCount, 0);
  f.pointer("pointerdown", 8, 535);
  f.pointer("pointermove", 8, 635);
  assert.equal(f.dashCount, 1);
});

test("future actions and reassigned buttons use the same registration and slide routing", (t) => {
  const f = setup(t);
  const block = f.makeElement("block", 300);
  const jump = f.makeElement("jump", 400);
  const blockChanges = [];
  let jumps = 0;
  const unregisterBlock = f.router.register({
    id: "block",
    element: block,
    behavior: ActionBehavior.HOLD,
    onHoldChange: (value) => blockChanges.push(value),
  });
  f.router.register({
    id: "jump",
    element: jump,
    behavior: ActionBehavior.PRESS,
    onActivate: () => jumps++,
  });
  f.pointer("pointerdown", 1, 335);
  assert.equal(f.router.isHeld("block"), true);
  f.pointer("pointermove", 1, 435);
  assert.equal(jumps, 1);
  f.pointer("pointermove", 1, 335);
  unregisterBlock();
  assert.equal(f.router.isHeld("block"), false);
  assert.deepEqual(blockChanges, [true, false, true, false]);
  const replacement = [];
  f.router.register({
    id: "parry",
    element: block,
    behavior: ActionBehavior.HOLD,
    onHoldChange: (value) => replacement.push(value),
  });
  f.pointer("pointermove", 1, 335);
  assert.equal(f.router.isHeld("parry"), true);
  assert.deepEqual(replacement, [true]);
  f.router.register({
    id: "parry",
    element: jump,
    behavior: ActionBehavior.HOLD,
    onHoldChange: (value) => replacement.push(value),
  });
  assert.equal(
    f.router.isHeld("parry"),
    false,
    "reassignment releases the old held binding",
  );
  f.pointer("pointermove", 1, 435);
  assert.equal(f.router.isHeld("parry"), true);
  assert.equal(
    jumps,
    1,
    "registering a new action on an occupied element replaces its old action",
  );
  f.router.unregister("parry");
  assert.equal(f.router.isHeld("parry"), false);
  f.pointer("pointermove", 1, 435);
  assert.equal(f.router.getPointer("parry"), null);
});

for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) {
  test(`${type} clears ownership and HOLD without activating the release location`, (t) => {
    const f = setup(t);
    f.pointer("pointerdown", 1, 535);
    f.pointer(type, 1, 635);
    assert.equal(f.router.isHeld("sprint"), false);
    assert.equal(f.router.ownsPointer(1), false);
    assert.equal(f.dashCount, 0);
    f.pointer("pointermove", 1, 735);
    f.pointer("pointerup", 1, 735);
    assert.equal(
      f.fightCount,
      0,
      "late events cannot revive a canceled action gesture",
    );
    assert.deepEqual(f.holdChanges, [true, false]);
  });
}

for (const reason of ["reset", "blur", "visibilitychange", "resize"]) {
  test(`${reason} releases all momentary input while preserving a toggled stance`, (t) => {
    const f = setup(t);
    f.pointer("pointerdown", 1, 535);
    f.pointer("pointerdown", 2, 735);
    assert.equal(f.fighting, true);
    if (reason === "reset") f.router.reset();
    else if (reason === "visibilitychange") {
      f.document.hidden = true;
      dispatch(f.document, reason);
    } else dispatch(f.window, reason);
    assert.equal(f.router.isHeld("sprint"), false);
    assert.equal(f.router.ownsPointer(1), false);
    assert.equal(f.router.ownsPointer(2), false);
    assert.equal(f.fighting, true);
    f.pointer("pointermove", 1, 635);
    assert.equal(f.dashCount, 0);
    assert.deepEqual(f.holdChanges, [true, false]);
  });
}

test("native accessibility clicks work without duplicating pointer entry activations", (t) => {
  const f = setup(t);
  f.pointer("pointerdown", 1, 635);
  f.pointer("pointerup", 1, 635);
  dispatch(f.document, "click", { detail: 1 }, f.dash);
  assert.equal(f.dashCount, 1);
  dispatch(f.document, "click", { detail: 0 }, f.dash);
  assert.equal(f.dashCount, 2);
  dispatch(f.document, "click", { detail: 0 }, f.fight);
  assert.equal(f.fighting, true);
  dispatch(f.document, "click", { detail: 0 }, f.sprint);
  assert.equal(
    f.router.isHeld("sprint"),
    false,
    "a synthetic click cannot leave a HOLD action stuck",
  );
});

test("focused HOLD keyboard input and touch input release independently", (t) => {
  const f = setup(t);
  f.key("keydown", " ", f.sprint);
  f.key("keydown", " ", f.sprint, { repeat: true });
  assert.equal(f.router.isHeld("sprint"), true);
  f.pointer("pointerdown", 1, 535);
  f.key("keyup", " ", f.sprint);
  assert.equal(f.router.isHeld("sprint"), true);
  f.pointer("pointerup", 1, 535);
  assert.equal(f.router.isHeld("sprint"), false);
  assert.deepEqual(f.holdChanges, [true, false]);
  f.key("keydown", "Enter", f.sprint);
  assert.equal(f.router.isHeld("sprint"), true);
  dispatch(f.window, "blur");
  assert.equal(f.router.isHeld("sprint"), false);
});

test("keyboard PRESS and TOGGLE activate once per key entry and suppress native repeat clicks", (t) => {
  const f = setup(t);
  const enter = f.key("keydown", "Enter", f.dash);
  assert.equal(enter.defaultPrevented, true);
  f.key("keydown", "Enter", f.dash, { repeat: true });
  f.key("keydown", "Enter", f.dash, { repeat: true });
  assert.equal(f.dashCount, 1);
  f.key("keyup", "Enter", f.dash);
  assert.equal(f.dashCount, 1);
  f.key("keydown", "Enter", f.dash);
  assert.equal(f.dashCount, 2);
  f.key("keyup", "Enter", f.dash);
  f.key("keydown", " ", f.fight);
  f.key("keydown", " ", f.fight, { repeat: true });
  f.key("keyup", " ", f.fight);
  assert.equal(f.fightCount, 1);
  assert.equal(f.fighting, true);
  f.key("keydown", " ", f.fight);
  f.key("keyup", " ", f.fight);
  assert.equal(f.fighting, false);
});

test("document routing still releases gestures when pointer capture is unavailable", (t) => {
  const f = setup(t);
  f.root.captureSupported = false;
  f.pointer("pointerdown", 1, 535);
  assert.equal(f.router.isHeld("sprint"), true);
  f.pointer("pointermove", 1, 635);
  assert.equal(f.dashCount, 1);
  assert.equal(f.router.isHeld("sprint"), false);
  f.pointer("pointermove", 1, 535);
  f.pointer("pointerup", 1, -10, -10);
  assert.equal(f.router.isHeld("sprint"), false);
  assert.equal(f.router.ownsPointer(1), false);
});

test("destroy removes routing and lifecycle listeners and releases held controls", (t) => {
  const f = setup(t);
  f.pointer("pointerdown", 1, 535);
  f.router.destroy();
  assert.equal(f.router.isHeld("sprint"), false);
  assert.equal(f.router.ownsPointer(1), false);
  assert.equal(f.root.capturedPointers.size, 0);
  assert.equal(f.document.listenerCount, 0);
  assert.equal(f.window.listenerCount, 0);
  assert.equal(f.root.listenerCount, 0);
  f.pointer("pointerdown", 2, 635);
  f.pointer("pointermove", 2, 735);
  assert.equal(f.dashCount, 0);
  assert.equal(f.fightCount, 0);
});

test("Dash entry respects real movement cooldown without queueing or automatic repeat", (t) => {
  const f = setup(t);
  const character = new CharacterController(new Group(), new ArenaBounds());
  const input = { move: { x: 0, y: 0 }, sprinting: false };
  const requests = [];
  f.router.register({
    id: "dash",
    element: f.dash,
    behavior: ActionBehavior.PRESS,
    onActivate: () => requests.push(character.requestDash()),
  });
  const advance = (seconds) => {
    const steps = Math.ceil(seconds * 120);
    for (let i = 0; i < steps; i++) character.update(seconds / steps, input, 0);
  };
  f.pointer("pointerdown", 1, 635);
  advance(0.1);
  assert.equal(character.dash.sequence, 1);
  f.pointer("pointermove", 1, 800);
  f.pointer("pointermove", 1, 635);
  assert.deepEqual(
    requests,
    [true, false],
    "re-entry during cooldown is rejected immediately",
  );
  advance(0.65);
  assert.equal(character.dash.ready, true);
  for (let i = 0; i < 5; i++) f.pointer("pointermove", 1, 635 + i);
  advance(0.1);
  assert.equal(
    character.dash.sequence,
    1,
    "remaining over Dash never auto-dashes when cooldown expires",
  );
  f.pointer("pointermove", 1, 800);
  f.pointer("pointermove", 1, 635);
  advance(1 / 120);
  assert.deepEqual(requests, [true, false, true]);
  assert.equal(character.dash.sequence, 2);
  assert.equal(character.movementState, "dash");
});

test("disabling the router releases every HOLD source and capture without clearing registrations", (t) => {
  const f = setup(t);
  assert.equal(f.router.enabled, true);
  f.pointer("pointerdown", 1, 535);
  f.pointer("pointerdown", 2, 535);
  f.key("keydown", " ", f.sprint);
  f.pointer("pointerdown", 3, 635);
  assert.equal(f.router.isHeld("sprint"), true);
  assert.equal(f.router.pointers.size, 3);
  assert.equal(f.router.keyboard.size, 1);
  assert.equal(f.root.capturedPointers.size, 3);
  f.router.setEnabled(false);
  assert.equal(f.router.enabled, false);
  assert.equal(f.router.isHeld("sprint"), false);
  assert.deepEqual(f.holdChanges, [true, false]);
  assert.equal(f.router.pointers.size, 0);
  assert.equal(f.router.keyboard.size, 0);
  assert.equal(f.root.capturedPointers.size, 0);
  assert.equal(f.router.actions.size, 3);
  assert.equal(f.sprint.getAttribute("data-touch-behavior"), "HOLD");
  f.router.setEnabled(false);
  assert.deepEqual(f.holdChanges, [true, false]);
});

test("disabled routing leaves editor pointer, keyboard and assistive events unconsumed", (t) => {
  const f = setup(t);
  f.router.setEnabled(false);
  for (const [index, button] of [f.sprint, f.dash, f.fight].entries()) {
    const x = button.rect.left + 35;
    const id = index + 1;
    assert.equal(f.pointer("pointerdown", id, x).defaultPrevented, false);
    assert.equal(f.pointer("pointermove", id, 635).defaultPrevented, false);
    for (const type of ["pointerup", "pointercancel", "lostpointercapture"])
      assert.equal(f.pointer(type, id, 735).defaultPrevented, false);
    for (const key of [" ", "Enter"])
      for (const type of ["keydown", "keyup"])
        assert.equal(f.key(type, key, button).defaultPrevented, false);
    for (const type of ["click", "contextmenu", "dragstart"])
      assert.equal(
        dispatch(f.document, type, { detail: 0 }, button).defaultPrevented,
        false,
      );
  }
  assert.equal(f.router.pointers.size, 0);
  assert.equal(f.router.keyboard.size, 0);
  assert.equal(f.root.capturedPointers.size, 0);
  assert.equal(f.router.isHeld("sprint"), false);
  assert.equal(f.dashCount, 0);
  assert.equal(f.fightCount, 0);
  assert.deepEqual(f.holdChanges, []);
});

test("resumed routing requires fresh entries and uses relocated button hit positions", (t) => {
  const f = setup(t);
  f.pointer("pointerdown", 1, 535);
  f.key("keydown", " ", f.sprint);
  f.router.setEnabled(false);
  f.pointer("pointerdown", 2, 635);
  f.dash.rect.left = 300;
  f.router.setEnabled(true);
  assert.equal(f.router.enabled, true);
  f.pointer("pointermove", 1, 335);
  f.pointer("pointermove", 2, 335);
  f.key("keydown", " ", f.sprint, { repeat: true });
  assert.equal(f.router.isHeld("sprint"), false);
  assert.equal(f.router.pointers.size, 0);
  assert.equal(
    f.dashCount,
    0,
    "contacts held through suspension are not replayed",
  );
  f.pointer("pointerdown", 3, 635);
  assert.equal(
    f.dashCount,
    0,
    "the previous Dash hit position is no longer active",
  );
  f.pointer("pointerdown", 4, 335);
  assert.equal(f.dashCount, 1);
  f.pointer("pointermove", 4, 535);
  assert.equal(f.router.isHeld("sprint"), true);
  f.router.setEnabled(true);
  assert.equal(
    f.router.getPointer("sprint"),
    4,
    "enabling twice does not interrupt a fresh gesture",
  );
  f.pointer("pointerup", 4, 535);
  assert.equal(f.router.isHeld("sprint"), false);
  f.key("keydown", " ", f.sprint);
  assert.equal(f.router.isHeld("sprint"), true);
  f.key("keyup", " ", f.sprint);
  assert.equal(f.router.isHeld("sprint"), false);
  f.key("keydown", "Enter", f.dash);
  assert.equal(f.dashCount, 2);
  f.key("keyup", "Enter", f.dash);
  dispatch(f.document, "click", { detail: 0 }, f.fight);
  assert.equal(f.fightCount, 1, "fresh assistive activation resumes normally");
});
