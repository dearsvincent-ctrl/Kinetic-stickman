import {
  NORMAL_PHYSICS,
  SANDBOX_PARAMETERS,
  SANDBOX_PRESETS,
  sanitizePhysics,
  loadPhysics,
  savePhysics,
} from "../sandbox/PhysicsSandbox.js";

/** Explicit developer opt-in, separate from saved layouts and progression.
 * Non-modal: only this panel's pointer contacts are UI; other fingers retain
 * their joystick, camera and action ownership while parameters change live.
 */
export class PhysicsSandboxPanel {
  constructor({ onChange, onDash = () => {} }) {
    this.enabled = new URLSearchParams(location.search).get("sandbox") === "1";
    this.values = NORMAL_PHYSICS;
    this.onChange = onChange;
    this.toggle = document.querySelector("#physics-toggle");
    this.panel = document.querySelector("#physics-panel");
    this.status = document.querySelector("#physics-status");
    this.rows = new Map();
    try {
      this.storage = localStorage;
    } catch {
      this.storage = null;
    }
    if (!this.enabled) return;
    document.body.classList.add("has-physics-sandbox");
    this.toggle.hidden = false;
    this.toggle.addEventListener("click", () =>
      this.setOpen(this.panel.hidden),
    );
    document
      .querySelector("#physics-close")
      .addEventListener("click", () => this.setOpen(false));
    const dashTest = document.createElement("button");
    dashTest.id = "physics-test-dash";
    dashTest.textContent = "Test preserved dash";
    dashTest.addEventListener("click", onDash);
    document.querySelector("#physics-presets").after(dashTest);
    const fields = document.querySelector("#physics-fields");
    const strengthFields = document.createElement("fieldset");
    strengthFields.id = "strength-controls";
    strengthFields.className = "aim-assist-controls";
    const legend = document.createElement("legend");
    legend.textContent = "Superhuman strength";
    const note = document.createElement("p");
    note.className = "physics-note";
    note.textContent =
      "Player strikes only · damage and impact are independent. 0× disables that effect; 1× preserves the original. Included in physics Save/Load and Reset.";
    strengthFields.append(legend, note);
    fields.after(strengthFields);
    for (const parameter of SANDBOX_PARAMETERS) {
      const row = document.createElement("label");
      row.className = "physics-row";
      const label = document.createElement("span");
      label.textContent = parameter.label;
      const output = document.createElement("output");
      const slider = document.createElement("input");
      slider.type = "range";
      slider.id = `physics-${parameter.id}`;
      slider.min = String(
        parameter.log ? Math.log10(parameter.min) : parameter.min,
      );
      slider.max = String(
        parameter.log ? Math.log10(parameter.max) : parameter.max,
      );
      slider.step = parameter.log ? "0.01" : String(parameter.step);
      slider.setAttribute("aria-label", parameter.label);
      output.htmlFor = slider.id;
      row.append(label, output, slider);
      (parameter.group === "combat" ? strengthFields : fields).appendChild(row);
      this.rows.set(parameter.id, { output, slider, parameter });
      slider.addEventListener("input", () => {
        const raw = parameter.log
          ? 10 ** Number(slider.value)
          : Number(slider.value);
        const mark = parameter.log
          ? [0.1, 1, 10, 20, 50, 100].find(
              (n) => Math.abs(raw - n) <= n * 0.012,
            )
          : undefined;
        this.apply({ ...this.values, [parameter.id]: mark ?? raw });
        this.status.textContent = "Applied live · unsaved";
      });
    }
    for (const [name, values] of Object.entries(SANDBOX_PRESETS)) {
      const button = document.createElement("button");
      button.textContent = name;
      button.type = "button";
      button.dataset.physicsPreset = name;
      button.addEventListener("click", () => {
        this.apply(values);
        this.status.textContent = `${name} applied · unsaved`;
      });
      document.querySelector("#physics-presets").appendChild(button);
    }
    document.querySelector("#physics-reset").addEventListener("click", () => {
      this.apply(NORMAL_PHYSICS);
      this.status.textContent = "Defaults restored · Save to keep";
    });
    document.querySelector("#physics-save").addEventListener("click", () => {
      this.status.textContent = savePhysics(this.storage, this.values)
        ? "Custom configuration saved on this browser"
        : "Storage unavailable · settings still active";
    });
    document.querySelector("#physics-load").addEventListener("click", () => {
      const saved = loadPhysics(this.storage);
      if (saved) this.apply(saved);
      this.status.textContent = saved
        ? "Saved configuration loaded"
        : "No valid saved configuration";
    });
    this.panel.addEventListener("keydown", (event) => {
      if (event.code === "Escape") {
        event.stopPropagation();
        this.setOpen(false);
      }
    });
    this.apply(loadPhysics(this.storage) ?? NORMAL_PHYSICS);
  }

  apply(values) {
    this.values = sanitizePhysics(values);
    for (const [id, { slider, output, parameter }] of this.rows) {
      const value = this.values[id];
      slider.value = String(parameter.log ? Math.log10(value) : value);
      output.value = `${Number(value.toFixed(2))}×`;
      slider.setAttribute("aria-valuetext", output.value);
    }
    this.onChange(this.values);
  }

  setOpen(open) {
    this.panel.hidden = !open;
    this.toggle.setAttribute("aria-expanded", String(open));
    if (!open) this.toggle.focus({ preventScroll: true });
  }
}
