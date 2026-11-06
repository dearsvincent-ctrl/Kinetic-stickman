import {
  CONTROL_IDS,
  clearLayout,
  constrainPosition,
  loadLayout,
  normalizeCenters,
  resolveLayout,
  saveLayout,
  validateLayout,
} from "./controlLayoutModel.js";

const SELECTORS = {
  move: "#joystick",
  sprint: "#sprint-button",
  dash: "#dash-button",
  block: "#block-button",
  jump: "#jump-button",
};
const LABELS = {
  move: "Move",
  sprint: "Sprint",
  dash: "Dash",
  block: "Block",
  jump: "Jump",
};
const POSITION_PROPERTIES = [
  "position",
  "left",
  "top",
  "right",
  "bottom",
  "margin",
];
const rectOf = (element) => {
  const rect = element.getBoundingClientRect();
  return {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
  };
};
const intersects = (a, b) =>
  a.left < b.left + b.width - 0.001 &&
  a.left + a.width > b.left + 0.001 &&
  a.top < b.top + b.height - 0.001 &&
  a.top + a.height > b.top + 0.001;

/** Browser-only layout ownership. Input is paused by the host while the menu
 * or editor is active. Existing controls remain the actual hit-test elements;
 * this layer changes their placement, never their action bindings or sizes.
 */
export class ControlLayoutEditor {
  constructor({ onActiveChange = () => {} } = {}) {
    this.onActiveChange = onActiveChange;
    this.mode = "closed";
    this.destroyed = false;
    this.drag = null;
    this.listeners = [];
    this.app = document.querySelector("#app");
    this.safeAreaProbe = document.createElement("div");
    this.safeAreaProbe.setAttribute("aria-hidden", "true");
    Object.assign(this.safeAreaProbe.style, {
      position: "fixed",
      left: "0px",
      top: "0px",
      width: "0px",
      height: "0px",
      visibility: "hidden",
      pointerEvents: "none",
      padding:
        "env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)",
    });
    this.app.appendChild(this.safeAreaProbe);
    this.settingsButton = document.querySelector("#settings-button");
    this.dialog = document.querySelector("#settings-dialog");
    this.editButton = document.querySelector("#edit-controls-button");
    this.toolbar = document.querySelector("#control-editor-toolbar");
    this.overlay = document.querySelector("#control-editor-overlay");
    this.saveButton = document.querySelector("#layout-save");
    this.cancelButton = document.querySelector("#layout-cancel");
    this.resetButton = document.querySelector("#layout-reset");
    this.status = document.querySelector("#layout-status");
    this.controls = Object.fromEntries(
      CONTROL_IDS.map((id) => [id, document.querySelector(SELECTORS[id])]),
    );
    this.originalStyles = new Map();
    for (const [id, element] of Object.entries(this.controls)) {
      element.setAttribute("data-layout-control", id);
      this.originalStyles.set(
        element,
        POSITION_PROPERTIES.map((property) => [
          property,
          element.style.getPropertyValue(property),
          element.style.getPropertyPriority(property),
        ]),
      );
    }
    try {
      this.storage = window.localStorage;
    } catch {
      this.storage = null;
    }
    this.layout = loadLayout(this.storage);
    this.draft = null;
    this.rects = {};
    const listen = (target, type, handler, options) => {
      target.addEventListener(type, handler, options);
      this.listeners.push(() =>
        target.removeEventListener(type, handler, options),
      );
    };
    listen(this.settingsButton, "click", () => this.openSettings());
    listen(this.editButton, "click", () => this.edit());
    listen(this.dialog, "close", () => {
      // The dialog closes when entering edit mode, without unpausing play.
      if (this.mode === "settings") this.setMode("closed");
    });
    listen(this.saveButton, "click", () => this.save());
    listen(this.cancelButton, "click", () => this.cancel());
    listen(this.resetButton, "click", () => this.reset());
    const capture = { capture: true, passive: false };
    listen(
      document,
      "pointerdown",
      (event) => this.pointerDown(event),
      capture,
    );
    listen(
      document,
      "pointermove",
      (event) => this.pointerMove(event),
      capture,
    );
    listen(
      document,
      "click",
      (event) => {
        // Native keyboard/assistive clicks must not open utilities or activate
        // a gameplay button underneath the editing surface.
        if (this.editing && !this.toolbar.contains(event.target))
          this.consume(event);
      },
      true,
    );
    for (const type of ["pointerup", "pointercancel", "lostpointercapture"])
      listen(document, type, (event) => this.pointerEnd(event), capture);
    listen(
      document,
      "keydown",
      (event) => {
        if (!this.editing || event.code !== "Escape") return;
        this.consume(event);
        this.cancel();
      },
      true,
    );
    const resize = () => {
      this.endDrag();
      this.refresh();
    };
    listen(window, "resize", resize);
    listen(window, "orientationchange", resize);
    window.visualViewport && listen(window.visualViewport, "resize", resize);
    window.visualViewport && listen(window.visualViewport, "scroll", resize);
    listen(window, "blur", () => this.endDrag());
    listen(document, "visibilitychange", () => {
      if (document.hidden) this.endDrag();
    });
    this.refresh();
    document.fonts?.ready.then(() => {
      if (!this.destroyed) {
        this.endDrag();
        this.refresh();
      }
    });
  }

  get active() {
    return this.mode !== "closed";
  }

  get editing() {
    return this.mode === "editing";
  }

  get hasCustomLayout() {
    return this.layout !== null;
  }

  setMode(mode) {
    const wasActive = this.active;
    this.mode = mode;
    if (wasActive !== this.active) this.onActiveChange(this.active);
  }

  openSettings() {
    if (this.active) return;
    this.setMode("settings");
    try {
      this.dialog.showModal();
    } catch {
      this.setMode("closed");
    }
  }

  edit() {
    if (this.editing) return;
    this.draft = this.layout ? validateLayout(this.layout) : null;
    this.setMode("editing");
    this.dialog.close();
    this.toolbar.hidden = false;
    this.overlay.hidden = false;
    document.body.classList.add("is-layout-editing");
    this.setStatus("Drag controls, then Save.");
    this.refresh();
    this.cancelButton.focus({ preventScroll: true });
  }

  save() {
    if (!this.editing) return;
    this.endDrag();
    const persisted = this.draft
      ? saveLayout(this.storage, this.draft)
      : clearLayout(this.storage);
    if (!persisted) {
      this.setStatus("Cannot save. Cancel or retry.");
      return;
    }
    this.layout = this.draft ? validateLayout(this.draft) : null;
    this.finish();
  }

  cancel() {
    if (!this.editing) return;
    this.endDrag();
    this.finish();
  }

  reset() {
    if (!this.editing) return;
    this.endDrag();
    this.draft = null;
    this.refresh();
    this.setStatus("Defaults shown. Save or Cancel.");
  }

  finish() {
    this.draft = null;
    this.toolbar.hidden = true;
    this.overlay.hidden = true;
    document.body.classList.remove("is-layout-editing");
    this.setMode("closed");
    this.refresh();
    this.settingsButton.focus({ preventScroll: true });
  }

  bounds() {
    const app = this.app.getBoundingClientRect();
    const viewport = window.visualViewport;
    const left = viewport?.offsetLeft ?? 0;
    const top = viewport?.offsetTop ?? 0;
    const safe = getComputedStyle(this.safeAreaProbe);
    const inset = (property) => Number.parseFloat(safe[property]) || 0;
    return {
      left: Math.max(app.left, left) + inset("paddingLeft"),
      top: Math.max(app.top, top) + inset("paddingTop"),
      right:
        Math.min(app.right, left + (viewport?.width ?? window.innerWidth)) -
        inset("paddingRight"),
      bottom:
        Math.min(app.bottom, top + (viewport?.height ?? window.innerHeight)) -
        inset("paddingBottom"),
    };
  }

  restoreStyles() {
    for (const [element, styles] of this.originalStyles) {
      for (const [property, value, priority] of styles) {
        if (value) element.style.setProperty(property, value, priority);
        else element.style.removeProperty(property);
      }
    }
    document.body.classList.remove("has-custom-controls");
  }

  toolbarRect() {
    // Keep this reservation in normal custom play too, so entering the editor
    // never shifts a saved control from underneath its temporary action bar.
    const hidden = this.toolbar.hidden;
    const visibility = this.toolbar.style.visibility;
    if (hidden) {
      this.toolbar.style.visibility = "hidden";
      this.toolbar.hidden = false;
    }
    const rect = rectOf(this.toolbar);
    if (hidden) {
      this.toolbar.hidden = true;
      this.toolbar.style.visibility = visibility;
    }
    return rect;
  }

  refresh() {
    this.restoreStyles();
    this.defaultRects = Object.fromEntries(
      CONTROL_IDS.map((id) => [id, rectOf(this.controls[id])]),
    );
    this.screen = this.bounds();
    this.baseExclusions = [
      ".topbar",
      ".arena-heading",
      ".camera-tools",
      ".movement-readout",
    ]
      .map((selector) => document.querySelector(selector))
      .filter(Boolean)
      .map(rectOf)
      .filter((rect) => rect.width > 0 && rect.height > 0);
    this.exclusions = [...this.baseExclusions, this.toolbarRect()];
    const layout = this.editing ? this.draft : this.layout;
    if (!layout && !this.editing) {
      this.rects = this.defaultRects;
      return;
    }
    const sizes = Object.fromEntries(
      CONTROL_IDS.map((id) => [
        id,
        {
          width: this.defaultRects[id].width,
          height: this.defaultRects[id].height,
        },
      ]),
    );
    const defaults = Object.fromEntries(
      CONTROL_IDS.map((id) => [
        id,
        {
          x: this.defaultRects[id].left + this.defaultRects[id].width / 2,
          y: this.defaultRects[id].top + this.defaultRects[id].height / 2,
        },
      ]),
    );
    // Short viewports can put an original control underneath the temporary
    // editor toolbar. Fit that preview without changing or saving CSS defaults.
    const fitDefaults =
      this.editing &&
      !layout &&
      CONTROL_IDS.some((id) => {
        const rect = this.defaultRects[id];
        return (
          rect.left < this.screen.left ||
          rect.top < this.screen.top ||
          rect.left + rect.width > this.screen.right ||
          rect.top + rect.height > this.screen.bottom ||
          this.exclusions.some((reserved) => intersects(rect, reserved))
        );
      });
    this.rects =
      layout || fitDefaults
        ? resolveLayout(
            layout?.positions ??
              normalizeCenters(this.defaultRects, this.screen),
            sizes,
            this.screen,
            this.exclusions,
            defaults,
          )
        : this.defaultRects;
    if (!this.rects) {
      this.rects = this.defaultRects;
      if (this.editing) this.setStatus("No space. Defaults shown.");
    }
    document.body.classList.add("has-custom-controls");
    for (const id of CONTROL_IDS) this.applyRect(id, this.rects[id]);
  }

  applyRect(id, rect) {
    Object.assign(this.controls[id].style, {
      position: "fixed",
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      right: "auto",
      bottom: "auto",
      margin: "0px",
    });
  }

  pointerDown(event) {
    if (!this.editing || this.toolbar.contains(event.target)) return;
    this.consume(event);
    if (this.drag || (event.pointerType === "mouse" && event.button !== 0))
      return;
    const id = CONTROL_IDS.find((key) =>
      this.controls[key].contains(event.target),
    );
    if (!id) return;
    const rect = this.rects[id];
    this.drag = {
      id,
      pointerId: event.pointerId,
      offsetX: rect.left + rect.width / 2 - event.clientX,
      offsetY: rect.top + rect.height / 2 - event.clientY,
    };
    this.controls[id].classList.add("is-layout-dragging");
    this.setStatus(`Moving ${LABELS[id]}`);
    try {
      this.controls[id].setPointerCapture(event.pointerId);
    } catch {
      // Document listeners retain the drag when capture is unavailable.
    }
  }

  pointerMove(event) {
    if (!this.editing || event.pointerId !== this.drag?.pointerId) return;
    this.consume(event);
    const { id, offsetX, offsetY } = this.drag;
    const rect = this.rects[id];
    const occupied = CONTROL_IDS.filter((key) => key !== id).map(
      (key) => this.rects[key],
    );
    this.exclusions = [...this.baseExclusions, this.toolbarRect()];
    const center = constrainPosition(
      { x: event.clientX + offsetX, y: event.clientY + offsetY },
      rect,
      this.screen,
      this.exclusions,
      occupied,
    );
    if (!center) {
      this.setStatus("No room. Move another control.");
      return;
    }
    if (!this.draft)
      this.draft = {
        version: 1,
        positions: normalizeCenters(this.rects, this.screen),
      };
    this.rects[id] = {
      ...rect,
      left: center.x - rect.width / 2,
      top: center.y - rect.height / 2,
    };
    const normalized = normalizeCenters(this.rects, this.screen);
    // Commit the visible arrangement after an edit. In a reflowed portrait
    // layout, stale anchors for the other controls could otherwise move them
    // again on Save even though only this control was dragged.
    this.draft.positions = normalized;
    this.applyRect(id, this.rects[id]);
  }

  pointerEnd(event) {
    if (event.pointerId !== this.drag?.pointerId) return;
    this.consume(event);
    this.endDrag();
  }

  endDrag() {
    if (!this.drag) return;
    const { id, pointerId } = this.drag;
    this.drag = null;
    const element = this.controls[id];
    element.classList.remove("is-layout-dragging");
    try {
      if (element.hasPointerCapture(pointerId))
        element.releasePointerCapture(pointerId);
    } catch {
      // Cancellation can implicitly release the capture first.
    }
    if (this.editing) this.setStatus("Drag controls, then Save.");
  }

  setStatus(message) {
    this.status.textContent = message;
  }

  consume(event) {
    if (event.cancelable) event.preventDefault();
    event.stopImmediatePropagation();
  }

  destroy() {
    this.destroyed = true;
    this.endDrag();
    for (const remove of this.listeners) remove();
    this.listeners.length = 0;
    if (this.dialog.open) this.dialog.close();
    this.toolbar.hidden = true;
    this.overlay.hidden = true;
    document.body.classList.remove("is-layout-editing");
    this.restoreStyles();
    this.safeAreaProbe.remove();
    this.setMode("closed");
  }
}
