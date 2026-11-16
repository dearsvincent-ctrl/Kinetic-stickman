import {
  DEFAULT_TAG_SETTINGS,
  TAG_PARAMETERS,
  loadTagSettings,
  saveTagSettings,
} from "../sandbox/TagSettings.js";

const INTELLIGENCE_NAMES = ["Low", "Medium", "High"];

/** Developer-only, non-modal escape tuning. The independent storage key never
 * modifies saved combat enemy, aim, physics or control-layout preferences. */
export class TagSettingsPanel {
  constructor(battle) {
    if (new URLSearchParams(location.search).get("sandbox") !== "1") return;
    this.battle = battle;
    this.rows = new Map();
    try {
      this.storage = localStorage;
    } catch {
      this.storage = null;
    }
    const section = document.createElement("details");
    section.id = "tag-settings";
    section.className = "enemy-settings tag-settings";
    const summary = document.createElement("summary");
    summary.textContent = "Tag Mode";
    const fields = document.createElement("fieldset");
    fields.id = "tag-settings-controls";
    const legend = document.createElement("legend");
    legend.textContent = "Escape & evasion";
    const note = document.createElement("p");
    note.className = "physics-note";
    note.textContent =
      "Choose Tag Mode in the MODE selector to chase runners. Escape settings apply live and remain separate from Combat Mode. Touch a runner to tag; walls block tags. No Punch or Kick is needed.";
    fields.append(legend, note);
    for (const p of TAG_PARAMETERS) {
      const row = document.createElement("label");
      row.className = "physics-row";
      const name = document.createElement("span");
      name.textContent = p.label;
      const output = document.createElement("output");
      const input = document.createElement("input");
      input.type = "range";
      input.id = `tag-${p.id}`;
      input.min = p.log ? Math.log10(p.min) : p.min;
      input.max = p.log ? Math.log10(p.max) : p.max;
      input.step = p.log ? "0.01" : String(p.step ?? 0.1);
      input.setAttribute("aria-label", `Tag ${p.label.toLowerCase()}`);
      output.htmlFor = input.id;
      row.append(name, output, input);
      fields.append(row);
      this.rows.set(p.id, { p, input, output });
      input.addEventListener("input", () => {
        let value = p.log ? 10 ** Number(input.value) : Number(input.value);
        if (p.log) {
          const mark = [0.1, 0.25, 0.5, 1, 2, 10, 20, 50, 100].find(
            (n) => Math.abs(value - n) < n * 0.012,
          );
          value = mark ?? value;
        }
        this.apply({ ...battle.tagSettings, [p.id]: value });
        this.status.textContent = "Tag settings applied live · unsaved";
      });
    }
    this.warning = document.createElement("p");
    this.warning.id = "tag-performance";
    this.warning.className = "physics-note";
    const storage = document.createElement("div");
    storage.className = "physics-storage";
    for (const [id, label, action] of [
      [
        "save",
        "Save tag",
        () => {
          this.status.textContent = saveTagSettings(
            this.storage,
            battle.tagSettings,
          )
            ? "Tag configuration saved on this browser"
            : "Storage unavailable · settings remain live";
        },
      ],
      [
        "load",
        "Load tag",
        () => {
          const saved = loadTagSettings(this.storage);
          if (saved) this.apply(saved);
          this.status.textContent = saved
            ? "Saved tag settings loaded"
            : "No valid saved tag settings";
        },
      ],
      [
        "reset",
        "Reset tag",
        () => {
          this.apply(DEFAULT_TAG_SETTINGS);
          this.status.textContent = "Tag defaults restored · Save to keep";
        },
      ],
    ]) {
      const button = document.createElement("button");
      button.type = "button";
      button.id = `tag-${id}`;
      button.textContent = label;
      button.addEventListener("click", action);
      storage.append(button);
    }
    this.status = document.createElement("p");
    this.status.id = "tag-settings-status";
    this.status.setAttribute("role", "status");
    this.status.textContent =
      "Independent Tag Mode settings · ground escape routes";
    fields.append(this.warning, storage, this.status);
    section.append(summary, fields);
    document.querySelector("#physics-presets").before(section);
    this.apply(loadTagSettings(this.storage) ?? DEFAULT_TAG_SETTINGS);
  }
  apply(values) {
    this.battle.configureTag(values);
    const current = this.battle.tagSettings;
    for (const [id, { p, input, output }] of this.rows) {
      input.value = p.log ? Math.log10(current[id]) : current[id];
      output.value =
        id === "intelligence"
          ? INTELLIGENCE_NAMES[Math.round(current[id])]
          : `${Number(current[id].toFixed(2))}${p.unit ?? ""}`;
      input.setAttribute("aria-valuetext", output.value);
    }
    this.warning.textContent =
      current.maxEnemies > 16
        ? "Experimental crowd: above 16 runners costs more CPU/GPU. Lower population if FPS drops. Hard limit: 64. Navigation and movement updates are bounded; runners do not climb."
        : "Start with 3–8 runners on Android. Speed: 0.25×–100× of the enemy movement baseline; acceleration is independent. Low flees directly, Medium avoids obstacles, High predicts approaches and evaluates escape routes. Runners stay on ground-level routes.";
  }
}
