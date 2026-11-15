import {
  AIM_ASSIST_DEFAULTS,
  AIM_ASSIST_LIMITS,
  loadAimAssist,
  saveAimAssist,
} from "../sandbox/AimAssistSettings.js";

/** Independent developer tuning/save; ordinary play uses the new baseline. */
export class AimAssistPanel {
  constructor(assist) {
    if (new URLSearchParams(location.search).get("sandbox") !== "1") return;
    this.assist = assist;
    try {
      this.storage = localStorage;
    } catch {
      this.storage = null;
    }
    this.rows = new Map();
    const section = document.createElement("fieldset");
    section.id = "aim-assist-controls";
    section.className = "aim-assist-controls";
    const legend = document.createElement("legend");
    legend.textContent = "Combat aim assist";
    const note = document.createElement("p");
    note.className = "physics-note";
    note.textContent =
      "Live testing · applies to the next manual Punch/Kick. Above 100% improves predicted strike-path alignment without over-rotating past the target. Aim Save/Load is separate from physics.";
    section.append(legend, note);
    for (const [id, label, min, max, scale, unit] of [
      [
        "strength",
        "Aim assist strength",
        0,
        AIM_ASSIST_LIMITS.strengthMax * 100,
        100,
        "%",
      ],
      [
        "maxAngle",
        "Maximum correction angle",
        0,
        AIM_ASSIST_LIMITS.maxAngle,
        1,
        "°",
      ],
      [
        "cone",
        "Target acquisition half-cone",
        AIM_ASSIST_LIMITS.coneMin,
        AIM_ASSIST_LIMITS.coneMax,
        1,
        "° per side",
      ],
    ]) {
      const row = document.createElement("label");
      row.className = "physics-row";
      const name = document.createElement("span");
      name.textContent = label;
      const output = document.createElement("output");
      const input = document.createElement("input");
      input.type = "range";
      input.min = min;
      input.max = max;
      input.step = "1";
      input.id = `aim-${id}`;
      input.setAttribute("aria-label", label);
      output.htmlFor = input.id;
      row.append(name, output, input);
      section.append(row);
      this.rows.set(id, { input, output, scale, unit });
      input.addEventListener("input", () => {
        this.apply({ ...assist.config, [id]: Number(input.value) / scale });
        this.status.textContent = "Aim applied live · unsaved";
      });
    }
    const debugLabel = document.createElement("label");
    debugLabel.className = "aim-debug-label";
    this.debug = document.createElement("input");
    this.debug.type = "checkbox";
    this.debug.id = "aim-debug";
    debugLabel.append(this.debug, " Show target and strike paths");
    section.append(debugLabel);
    this.debug.addEventListener("change", () => {
      this.apply({ ...assist.config, debug: this.debug.checked });
      this.status.textContent = "Aim applied live · unsaved";
    });
    const key = document.createElement("p");
    key.className = "physics-note";
    key.textContent =
      "Blue: original path · orange: corrected path · marker: selected target. Selection lasts one manual strike; physical contact is still required. 0% is fully unassisted.";
    const storage = document.createElement("div");
    storage.className = "physics-storage";
    this.status = document.createElement("p");
    this.status.id = "aim-status";
    this.status.className = "physics-note";
    this.status.setAttribute("role", "status");
    for (const [id, label, action] of [
      [
        "save",
        "Save aim",
        () => {
          this.status.textContent = saveAimAssist(this.storage, assist.config)
            ? "Aim configuration saved on this browser"
            : "Storage unavailable · aim remains live";
        },
      ],
      [
        "load",
        "Load aim",
        () => {
          const saved = loadAimAssist(this.storage);
          if (saved) this.apply(saved);
          this.status.textContent = saved
            ? "Saved aim settings loaded"
            : "No valid saved aim settings";
        },
      ],
      [
        "reset",
        "Reset aim defaults",
        () => {
          this.apply(AIM_ASSIST_DEFAULTS);
          this.status.textContent = "Aim defaults restored · Save aim to keep";
        },
      ],
    ]) {
      const button = document.createElement("button");
      button.type = "button";
      button.id = `aim-${id}`;
      button.textContent = label;
      button.addEventListener("click", action);
      storage.append(button);
    }
    section.append(key, storage, this.status);
    document.querySelector("#physics-status").after(section);
    const saved = loadAimAssist(this.storage);
    this.apply(saved ?? assist.config);
    this.status.textContent = saved
      ? "Saved developer aim settings loaded"
      : "Independent of physics Save/Load · normal play uses 100% / 20° / ±25°";
  }
  apply(values) {
    this.assist.configure(values);
    for (const [id, row] of this.rows) {
      const value = this.assist.config[id] * row.scale;
      row.input.value = value;
      row.output.value = `${Math.round(value)}${row.unit}`;
      row.input.setAttribute("aria-valuetext", row.output.value);
    }
    this.debug.checked = this.assist.config.debug;
  }
}
