export const ActionBehavior = Object.freeze({
  HOLD: "HOLD",
  TAP_HOLD: "TAP_HOLD",
  PRESS: "PRESS",
  TOGGLE: "TOGGLE",
});

/** Routes an action gesture by coordinates, independent of capture targets.
 * Only contacts that START on a registered button belong to this router.
 * Crossing a gap keeps ownership; joystick/camera gestures are never adopted.
 */
const holds = (action) =>
  action?.behavior === ActionBehavior.HOLD ||
  action?.behavior === ActionBehavior.TAP_HOLD;

export class TouchActionRouter {
  constructor({
    root = document.documentElement,
    eventTarget = document,
    onChange = () => {},
    canClaimPointer = () => true,
  } = {}) {
    this.root = root;
    this.eventTarget = eventTarget;
    this.document = root?.ownerDocument ?? eventTarget;
    this.onChange = onChange;
    this.canClaimPointer = canClaimPointer;
    this.enabled = true;
    this.actions = new Map();
    this.pointers = new Map();
    this.keyboard = new Map();
    this.listeners = [];
    const listen = (target, type, handler, options) => {
      target.addEventListener(type, handler, options);
      this.listeners.push(() =>
        target.removeEventListener(type, handler, options),
      );
    };
    const capture = { capture: true, passive: false };
    listen(
      eventTarget,
      "pointerdown",
      (event) => {
        if (
          !this.enabled ||
          this.pointers.has(event.pointerId) ||
          (event.pointerType === "mouse" && event.button !== 0) ||
          !this.canClaimPointer(event)
        )
          return;
        const action = this.hit(event.clientX, event.clientY, event.target);
        if (!action) return;
        this.consume(event);
        const pointer = { id: event.pointerId, action: null };
        this.pointers.set(pointer.id, pointer);
        try {
          root.setPointerCapture(pointer.id);
        } catch {
          /* Document fallback. */
        }
        this.transition(pointer, action, event);
      },
      capture,
    );
    listen(
      eventTarget,
      "pointermove",
      (event) => {
        if (!this.enabled) return;
        const pointer = this.pointers.get(event.pointerId);
        if (!pointer) return;
        this.consume(event);
        const samples = event.getCoalescedEvents?.() ?? [];
        for (const sample of samples) {
          if (!this.pointers.has(pointer.id)) break;
          this.transition(
            pointer,
            this.hit(sample.clientX, sample.clientY, event.target),
            event,
          );
        }
        if (this.pointers.has(pointer.id))
          this.transition(
            pointer,
            this.hit(event.clientX, event.clientY, event.target),
            event,
          );
      },
      capture,
    );
    for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) {
      listen(
        eventTarget,
        type,
        (event) => {
          if (!this.enabled) return;
          if (!this.pointers.has(event.pointerId)) return;
          this.consume(event);
          this.endPointer(event.pointerId, event);
        },
        capture,
      );
    }
    listen(
      eventTarget,
      "click",
      (event) => {
        if (!this.enabled) return;
        const action = this.fromElement(event.target);
        if (!action) return;
        this.consume(event);
        // All pointer activations already happened on entry. A detail=0 click
        // is keyboard/assistive activation without a physical pointer gesture.
        if (event.detail !== 0 || this.keyboard.size) return;
        if (holds(action)) {
          const token = Symbol("accessible-hold");
          this.hold(action, token, true, event);
          if (action.behavior === ActionBehavior.TAP_HOLD)
            action.onActivate(event);
          this.hold(action, token, false, event);
        } else action.onActivate(event);
      },
      capture,
    );
    listen(
      eventTarget,
      "keydown",
      (event) => {
        if (!this.enabled) return;
        if (event.code !== "Space" && event.code !== "Enter") return;
        const action = this.fromElement(event.target);
        if (!action) return;
        this.consume(event);
        if (event.repeat || this.keyboard.has(event.code)) return;
        const source = { action, token: Symbol(event.code) };
        this.keyboard.set(event.code, source);
        if (holds(action)) this.hold(action, source.token, true, event);
        if (action.behavior !== ActionBehavior.HOLD) action.onActivate(event);
      },
      capture,
    );
    listen(
      eventTarget,
      "keyup",
      (event) => {
        if (!this.enabled) return;
        if (!this.keyboard.has(event.code)) return;
        this.consume(event);
        this.endKey(event.code, event);
      },
      capture,
    );
    listen(
      eventTarget,
      "focusout",
      (event) => {
        if (!this.enabled) return;
        for (const [code, source] of this.keyboard)
          if (source.action.element.contains(event.target))
            this.endKey(code, event);
      },
      true,
    );
    for (const type of ["contextmenu", "dragstart"]) {
      listen(
        eventTarget,
        type,
        (event) => {
          if (!this.enabled) return;
          if (this.fromElement(event.target) || this.pointers.size)
            this.consume(event);
        },
        capture,
      );
    }
    for (const type of ["blur", "resize", "orientationchange"])
      listen(window, type, () => this.reset());
    listen(this.document, "visibilitychange", () => {
      if (this.document.hidden) this.reset();
    });
  }

  register({
    id,
    element,
    behavior,
    onHoldChange = () => {},
    onActivate = () => {},
  }) {
    if (!id || !element || !Object.values(ActionBehavior).includes(behavior))
      throw new TypeError(
        "An action needs an id, element, and HOLD/PRESS/TOGGLE/TAP_HOLD behavior.",
      );
    this.unregister(id);
    for (const action of this.actions.values())
      if (action.element === element) this.unregister(action.id);
    const action = {
      id,
      element,
      behavior,
      onHoldChange,
      onActivate,
      holders: new Set(),
    };
    this.actions.set(id, action);
    element.setAttribute("data-touch-action", id);
    element.setAttribute("data-touch-behavior", behavior);
    // A stale disposer must not unregister a later reassignment of this id.
    return () => {
      if (this.actions.get(id) === action) this.unregister(id);
    };
  }

  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
    if (!this.enabled) this.reset();
  }

  unregister(id) {
    const action = this.actions.get(id);
    if (!action) return;
    this.actions.delete(id);
    for (const pointer of this.pointers.values())
      if (pointer.action === action) this.transition(pointer, null);
    for (const [code, source] of this.keyboard)
      if (source.action === action) this.endKey(code);
    action.element.removeAttribute?.("data-touch-action");
    action.element.removeAttribute?.("data-touch-behavior");
  }

  fromElement(element) {
    if (!element) return null;
    for (const action of this.actions.values()) {
      if (
        !action.element.disabled &&
        (action.element === element || action.element.contains(element))
      )
        return action;
    }
    return null;
  }

  hit(x, y, fallback) {
    const element =
      typeof this.document.elementFromPoint === "function"
        ? this.document.elementFromPoint(x, y)
        : fallback;
    return this.fromElement(element);
  }

  transition(pointer, action, event) {
    if (pointer.action === action) return;
    const previous = pointer.action;
    pointer.action = null;
    if (holds(previous)) this.hold(previous, pointer.id, false, event);
    pointer.action = action;
    if (holds(action)) this.hold(action, pointer.id, true, event);
    if (action && action.behavior !== ActionBehavior.HOLD)
      action.onActivate(event);
    this.onChange();
  }

  hold(action, token, active, event) {
    const held = action.holders.size > 0;
    if (active) action.holders.add(token);
    else action.holders.delete(token);
    if (held !== action.holders.size > 0)
      action.onHoldChange(action.holders.size > 0, event);
  }

  isHeld(id) {
    return (this.actions.get(id)?.holders.size ?? 0) > 0;
  }
  getPointer(id) {
    for (const pointer of this.pointers.values())
      if (pointer.action?.id === id) return pointer.id;
    return null;
  }
  ownsPointer(id) {
    return this.pointers.has(id);
  }

  endPointer(id, event) {
    const pointer = this.pointers.get(id);
    if (!pointer) return;
    this.pointers.delete(id);
    this.transition(pointer, null, event);
    try {
      if (this.root.hasPointerCapture(id)) this.root.releasePointerCapture(id);
    } catch {
      /* Capture may already be implicitly released. */
    }
  }

  endKey(code, event) {
    const source = this.keyboard.get(code);
    if (!source) return;
    this.keyboard.delete(code);
    if (holds(source.action))
      this.hold(source.action, source.token, false, event);
    this.onChange();
  }

  consume(event) {
    if (event.cancelable) event.preventDefault();
    event.stopPropagation();
  }

  reset() {
    for (const id of [...this.pointers.keys()]) this.endPointer(id);
    for (const code of [...this.keyboard.keys()]) this.endKey(code);
  }

  destroy() {
    this.reset();
    for (const remove of this.listeners) remove();
    this.listeners.length = 0;
    for (const id of [...this.actions.keys()]) this.unregister(id);
  }
}
