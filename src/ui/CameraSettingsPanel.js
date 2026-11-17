import { CAMERA_PARAMETERS } from "../sandbox/CameraSettings.js";

const profileId = (mode) => (mode === "tag" ? "tag" : "combat");
const profileName = (mode) => (mode === "tag" ? "Tag" : "Combat");

/** Sandbox-only editor for the persistent camera preferences used in all play. */
export class CameraSettingsPanel {
  constructor({ preferences, onChange, getGameplayMode = () => "combat" }) {
    this.preferences = preferences;
    this.onChange = onChange;
    this.profile = profileId(getGameplayMode());
    this.rows = new Map();
    if (new URLSearchParams(globalThis.location?.search).get("sandbox") !== "1")
      return;

    this.section = document.createElement("details");
    this.section.id = "camera-settings";
    this.section.className = "enemy-settings";
    const summary = document.createElement("summary");
    summary.textContent = "Camera Settings";
    const fields = document.createElement("fieldset");
    fields.id = "camera-settings-controls";
    const legend = document.createElement("legend");
    legend.textContent = "View & assistance";
    this.profileSelect = this.createSelect(
      fields,
      "camera-profile",
      "PROFILE",
      "Camera gameplay profile to edit",
      [
        ["combat", "Combat"],
        ["tag", "Tag"],
      ],
    );
    this.modeSelect = this.createSelect(
      fields,
      "camera-mode",
      "CAMERA MODE",
      "Camera assistance mode",
      [
        ["manual", "Manual"],
        ["assisted", "Assisted"],
        ["dynamic", "Dynamic"],
      ],
    );
    const note = document.createElement("p");
    note.className = "physics-note";
    note.textContent =
      "52° preserves the existing default view. Manual keeps direct orbit control; Assisted and Dynamic add camera guidance. Manual dragging temporarily overrides assistance. Camera awareness is separate from enemy AI detection.";
    fields.prepend(legend, note);
    const dynamicLabel = document.createElement("label");
    dynamicLabel.className = "aim-debug-label";
    this.dynamicFov = document.createElement("input");
    this.dynamicFov.type = "checkbox";
    this.dynamicFov.id = "camera-dynamicFov";
    dynamicLabel.append(
      this.dynamicFov,
      document.createTextNode("Dynamic field of view"),
    );
    fields.append(dynamicLabel);

    for (const p of CAMERA_PARAMETERS) {
      const row = document.createElement("label");
      row.className = "physics-row";
      const name = document.createElement("span");
      name.textContent = p.label;
      const output = document.createElement("output");
      const input = document.createElement("input");
      input.type = "range";
      input.id = `camera-${p.id}`;
      input.min = String(p.log ? Math.log10(p.min) : p.min);
      input.max = String(p.log ? Math.log10(p.max) : p.max);
      input.step = p.log ? "0.001" : String(p.step);
      input.setAttribute("aria-label", p.label);
      output.htmlFor = input.id;
      row.append(name, output, input);
      fields.append(row);
      this.rows.set(p.id, { p, input, output });
      input.addEventListener("input", () => {
        let value = p.log ? 10 ** Number(input.value) : Number(input.value);
        if (p.log) {
          const marks = [p.min, p.default, p.max, 0.5, 1, 2, 10, 50, 100, 1000];
          value =
            marks.find((n) => Math.abs(value - n) <= n * 0.005) ?? value;
        }
        this.apply({ [p.id]: value });
      });
    }

    const storage = document.createElement("div");
    storage.className = "physics-storage";
    const reset = document.createElement("button");
    reset.id = "camera-reset";
    reset.type = "button";
    reset.textContent = "Reset this camera profile";
    reset.addEventListener("click", () => {
      const settings = this.preferences.reset(this.profile);
      this.onChange?.(this.profile, settings);
      this.refresh();
      this.showSaveStatus("defaults restored");
    });
    storage.append(reset);
    this.status = document.createElement("p");
    this.status.id = "camera-settings-status";
    this.status.setAttribute("role", "status");
    fields.append(storage, this.status);
    this.section.append(summary, fields);
    document.querySelector("#physics-presets")?.before(this.section);
    this.profileSelect.addEventListener("change", () =>
      this.setGameplayMode(this.profileSelect.value),
    );
    this.modeSelect.addEventListener("change", () =>
      this.apply({ mode: this.modeSelect.value }),
    );
    this.dynamicFov.addEventListener("change", () =>
      this.apply({ dynamicFov: this.dynamicFov.checked }),
    );
    this.refresh();
  }

  createSelect(fields, id, label, ariaLabel, options) {
    const row = document.createElement("label");
    row.className = "mode-picker";
    const name = document.createElement("span");
    name.textContent = label;
    const select = document.createElement("select");
    select.id = id;
    select.setAttribute("aria-label", ariaLabel);
    for (const [value, text] of options) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = text;
      select.append(option);
    }
    row.append(name, select);
    fields.append(row);
    return select;
  }

  apply(partial) {
    const settings = this.preferences.update(this.profile, partial);
    this.onChange?.(this.profile, settings);
    this.refresh();
    this.showSaveStatus("applied live");
  }

  setGameplayMode(mode) {
    this.profile = profileId(mode);
    this.refresh();
    this.section?.dispatchEvent(
      new Event("kinetic:relock-sliders", { bubbles: true }),
    );
  }

  refresh() {
    if (!this.section) return;
    const settings = this.preferences.get(this.profile);
    this.profileSelect.value = this.profile;
    this.modeSelect.value = settings.mode;
    this.dynamicFov.checked = settings.dynamicFov;
    for (const [id, { p, input, output }] of this.rows) {
      input.value = String(p.log ? Math.log10(settings[id]) : settings[id]);
      output.value = `${Number(settings[id].toFixed(2))}${p.unit}`;
      input.setAttribute("aria-valuetext", output.value);
    }
    this.status.textContent = `${profileName(this.profile)} camera profile · Changes save automatically on this browser`;
  }

  showSaveStatus(action) {
    this.status.textContent = `${profileName(this.profile)} camera ${action} · ${
      this.preferences.lastSaveSucceeded
        ? "Saved on this browser"
        : "Storage unavailable; settings remain live"
    }`;
  }
}
