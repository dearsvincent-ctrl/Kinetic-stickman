import {
  AIM_ASSIST_DEFAULTS,
  AIM_ASSIST_LIMITS,
} from "../combat/PunchAimAssist.js";

/** Temporary development tuning, independent of saved physics/layout data. */
export class AimAssistPanel {
  constructor(assist) {
    if (new URLSearchParams(location.search).get("sandbox") !== "1") return;
    this.assist = assist;
    this.rows = new Map();
    const section = document.createElement("fieldset");
    section.id = "aim-assist-controls";
    section.className = "aim-assist-controls";
    const legend = document.createElement("legend");
    legend.textContent = "Punch aim assist";
    const note = document.createElement("p");
    note.className = "physics-note";
    note.textContent =
      "Live testing · applies to the next punch. 0% restores the original trajectory. Refresh resets aim settings; physics Save/Load stays separate.";
    section.append(legend, note);
    for (const [id, label, min, max, scale, unit] of [
      ["strength", "Aim assist strength", 0, 100, 100, "%"],
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
      input.addEventListener("input", () =>
        this.apply({ ...assist.config, [id]: Number(input.value) / scale }),
      );
    }
    const debugLabel = document.createElement("label");
    debugLabel.className = "aim-debug-label";
    this.debug = document.createElement("input");
    this.debug.type = "checkbox";
    this.debug.id = "aim-debug";
    debugLabel.append(this.debug, " Show target and punch paths");
    section.append(debugLabel);
    this.debug.addEventListener("change", () =>
      this.apply({ ...assist.config, debug: this.debug.checked }),
    );
    const key = document.createElement("p");
    key.className = "physics-note";
    key.textContent =
      "Blue: original path · orange: corrected path · marker: selected target. Selection lasts one punch; contact is still required.";
    const reset = document.createElement("button");
    reset.id = "aim-reset";
    reset.textContent = "Reset aim defaults";
    reset.addEventListener("click", () => this.apply(AIM_ASSIST_DEFAULTS));
    section.append(key, reset);
    document.querySelector("#physics-status").after(section);
    this.apply(assist.config);
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
