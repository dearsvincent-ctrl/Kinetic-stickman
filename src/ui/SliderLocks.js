const DRAG_THRESHOLD = 8;
const AXIS_BIAS = 1.35;

/** A range keeps its value until a deliberate horizontal gesture is resolved.
 * The numerical domain is the input's own domain, including logarithmic rows. */
export class SliderGesture {
  constructor({
    x,
    y,
    value,
    min = 0,
    max = 100,
    step = 1,
    width = 1,
    rtl = false,
  }) {
    this.x = x;
    this.y = y;
    this.min = min;
    this.max = Math.max(min, max);
    this.step = Number.isFinite(step) && step > 0 ? step : 0.01;
    this.width = Math.max(1, width);
    this.initial = this.value = Math.max(min, Math.min(this.max, value));
    this.rtl = rtl ? -1 : 1;
    this.axis = "pending";
  }
  move(x, y) {
    const dx = x - this.x,
      dy = y - this.y;
    if (this.axis === "pending") {
      if (
        Math.abs(dy) >= DRAG_THRESHOLD &&
        Math.abs(dy) > Math.abs(dx) * AXIS_BIAS
      )
        this.axis = "vertical";
      else if (
        Math.abs(dx) >= DRAG_THRESHOLD &&
        Math.abs(dx) > Math.abs(dy) * AXIS_BIAS
      )
        this.axis = "horizontal";
    }
    if (this.axis === "horizontal") {
      const raw =
        this.initial + ((dx * this.rtl) / this.width) * (this.max - this.min);
      const stepped =
        this.min + Math.round((raw - this.min) / this.step) * this.step;
      this.value = Math.max(
        this.min,
        Math.min(this.max, Number(stepped.toFixed(10))),
      );
    }
    return this.axis;
  }
}

/** One lock per existing or future developer range. Gesture ownership stays
 * inside this panel, leaving independent gameplay pointers untouched. */
export class SliderLocks {
  constructor(panel) {
    this.panel = panel;
    this.records = new Map();
    this.nextId = 0;
    this.relock = (event) => this.lockAll(event.target);
    panel.addEventListener("kinetic:relock-sliders", this.relock);
    this.release = (event) => {
      for (const record of this.records.values())
        if (record.pointer === event.pointerId) this.finish(record);
    };
    this.cancelGestures = () => {
      for (const record of this.records.values()) this.finish(record);
    };
    window.addEventListener("pointerup", this.release);
    window.addEventListener("pointercancel", this.release);
    window.addEventListener("blur", this.cancelGestures);
    this.scan(panel);
    this.observer = new MutationObserver((changes) => {
      for (const change of changes) {
        if (change.type === "attributes") {
          if (change.target === panel || change.target.tagName === "DETAILS")
            this.lockAll(change.target);
        } else {
          for (const node of change.addedNodes)
            if (node.nodeType === 1) this.scan(node);
        }
      }
      for (const [input, record] of this.records)
        if (!panel.contains(input)) this.unregister(record);
    });
    this.observer.observe(panel, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["hidden", "open"],
    });
  }
  scan(root) {
    if (root !== this.panel && !this.panel.contains(root)) return;
    if (root.matches?.('input[type="range"]')) this.register(root);
    for (const input of root.querySelectorAll?.('input[type="range"]') ?? [])
      this.register(input);
  }
  register(input) {
    if (this.records.has(input)) return;
    if (!input.id) {
      let id;
      do {
        id = `developer-slider-${++this.nextId}`;
      } while (input.ownerDocument.getElementById(id));
      input.id = id;
    }
    const row = input.closest(".physics-row") ?? input.parentElement;
    const name =
      input.getAttribute("aria-label") ||
      row.querySelector("span")?.textContent ||
      input.id;
    const control = document.createElement("div"),
      track = document.createElement("div"),
      button = document.createElement("button");
    control.className = "slider-control";
    track.className = "slider-track";
    button.className = "slider-lock";
    button.type = "button";
    button.id = `${input.id}-lock`;
    button.dataset.sliderLock = input.id;
    button.setAttribute("aria-controls", input.id);
    button.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10" width="14" height="11" rx="2"/><path data-shackle d="M8 10V7a4 4 0 0 1 8 0v3"/><path d="M12 14v3"/></svg>';
    input.before(control);
    track.append(input);
    control.append(track, button);
    const record = {
      input,
      control,
      track,
      button,
      name,
      initialDisabled: input.disabled,
      locked: true,
      pointer: null,
      gesture: null,
    };
    this.records.set(input, record);
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.setLocked(record, !record.locked);
    });
    // Prevent the surrounding <label> from forwarding a tap to the range.
    control.addEventListener("click", (event) => event.preventDefault());
    track.addEventListener("pointerdown", (event) => this.start(record, event));
    track.addEventListener("pointermove", (event) => this.move(record, event), {
      passive: false,
    });
    for (const type of ["pointerup", "pointercancel", "lostpointercapture"])
      track.addEventListener(type, (event) => {
        if (record.pointer === event.pointerId) this.finish(record);
      });
    this.setLocked(record, true);
  }
  setLocked(record, locked) {
    this.finish(record);
    record.locked = locked;
    record.input.disabled = locked || record.initialDisabled;
    record.input.dataset.sliderLocked = String(locked);
    record.control.classList.toggle("is-locked", locked);
    record.button.setAttribute("aria-pressed", String(!locked));
    record.button.setAttribute(
      "aria-label",
      `${locked ? "Unlock" : "Lock"} ${record.name}`,
    );
    record.button.title = locked
      ? "Locked · scroll safely; tap to adjust this slider"
      : "Unlocked · drag horizontally to adjust; tap to lock";
    record.button
      .querySelector("[data-shackle]")
      .setAttribute(
        "d",
        locked ? "M8 10V7a4 4 0 0 1 8 0v3" : "M8 10V7a4 4 0 0 1 8 0",
      );
  }
  lockAll(root = this.panel) {
    for (const record of this.records.values())
      if (root === this.panel || root.contains(record.input))
        this.setLocked(record, true);
  }
  start(record, event) {
    if (
      record.locked ||
      record.input.disabled ||
      record.pointer !== null ||
      (event.pointerType === "mouse" && event.button !== 0)
    )
      return;
    const input = record.input,
      bounds = input.getBoundingClientRect();
    record.pointer = event.pointerId;
    record.gesture = new SliderGesture({
      x: event.clientX,
      y: event.clientY,
      value: Number(input.value),
      min: input.min === "" ? 0 : Number(input.min),
      max: input.max === "" ? 100 : Number(input.max),
      step: input.step === "" ? 1 : Number(input.step),
      width: bounds.width,
      rtl: getComputedStyle(input).direction === "rtl",
    });
    if (event.pointerType === "mouse") input.focus({ preventScroll: true });
    // pan-y remains native until horizontal intent is established. In
    // particular, never capture/prevent the initial vertical scroll contact.
  }
  move(record, event) {
    if (record.pointer !== event.pointerId || !record.gesture) return;
    const gesture = record.gesture,
      axis = gesture.move(event.clientX, event.clientY);
    if (axis !== "horizontal") return;
    event.preventDefault();
    try {
      record.track.setPointerCapture(event.pointerId);
    } catch {
      /* Older engines can continue within the track. */
    }
    if (Number(record.input.value) !== gesture.value) {
      record.input.value = String(gesture.value);
      record.input.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }
  finish(record) {
    if (record.pointer === null) return;
    const pointer = record.pointer,
      changed =
        record.gesture?.axis === "horizontal" &&
        record.gesture.value !== record.gesture.initial;
    record.pointer = null;
    record.gesture = null;
    try {
      record.track.releasePointerCapture(pointer);
    } catch {
      /* No capture on taps, scrolling or cancelled contacts. */
    }
    if (changed)
      record.input.dispatchEvent(new Event("change", { bubbles: true }));
  }
  unregister(record) {
    this.finish(record);
    record.input.disabled = record.initialDisabled;
    delete record.input.dataset.sliderLocked;
    if (record.track.contains(record.input))
      record.control.replaceWith(record.input);
    else record.control.remove();
    this.records.delete(record.input);
  }
  destroy() {
    this.observer.disconnect();
    this.panel.removeEventListener("kinetic:relock-sliders", this.relock);
    window.removeEventListener("pointerup", this.release);
    window.removeEventListener("pointercancel", this.release);
    window.removeEventListener("blur", this.cancelGestures);
    for (const record of this.records.values()) this.unregister(record);
  }
}
