import {
  DEFAULT_ENEMY_SETTINGS,
  ENEMY_PARAMETERS,
  ENEMY_PRESETS,
  loadEnemySettings,
  saveEnemySettings,
} from "../sandbox/EnemySettings.js";

/** Opt-in non-modal sandbox section; retains independent gameplay pointers. */
export class EnemySettingsPanel {
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
    section.id = "enemy-settings";
    section.className = "enemy-settings";
    const summary = document.createElement("summary");
    summary.textContent = "Enemy Settings";
    const fields = document.createElement("fieldset");
    fields.id = "enemy-settings-controls";
    const legend = document.createElement("legend");
    legend.textContent = "Pursuit & population";
    const note = document.createElement("p");
    note.className = "physics-note";
    note.textContent =
      "Live enemy-only tuning. Changing the population limit fills the current wave to that limit; Normal restores waves of 3–8. Attack frequency 0 disables new enemy strikes. Player physics, hit reach and damage stay unchanged.";
    fields.append(legend, note);
    for (const p of ENEMY_PARAMETERS) {
      const row = document.createElement("label");
      row.className = "physics-row";
      const name = document.createElement("span");
      name.textContent = p.label;
      const output = document.createElement("output"),
        input = document.createElement("input");
      input.type = "range";
      input.id = `enemy-${p.id}`;
      input.min = p.log ? Math.log10(p.min) : p.min;
      input.max = p.log ? Math.log10(p.max) : p.max;
      input.step = p.log ? "0.01" : String(p.step);
      input.setAttribute("aria-label", `Enemy ${p.label.toLowerCase()}`);
      output.htmlFor = input.id;
      row.append(name, output, input);
      fields.append(row);
      this.rows.set(p.id, { p, input, output });
      input.addEventListener("input", () => {
        let value = p.log ? 10 ** Number(input.value) : Number(input.value);
        if (p.log) {
          const mark = [0.1, 0.5, 1, 2, 10, 20, 50, 100, 200, 500, 1000].find(
            (n) => Math.abs(value - n) < n * 0.012,
          );
          value = mark ?? value;
        }
        this.apply({ ...battle.enemySettings, [p.id]: value });
        this.status.textContent = "Enemy settings applied live · unsaved";
      });
    }
    const presets = document.createElement("div");
    presets.className = "physics-presets";
    for (const [name, values] of Object.entries(ENEMY_PRESETS)) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = name;
      button.dataset.enemyPreset = name;
      button.addEventListener("click", () => {
        this.apply(values, { resetPopulation: name === "Normal" });
        this.status.textContent = `${name} enemies applied · unsaved`;
      });
      presets.append(button);
    }
    const storage = document.createElement("div");
    storage.className = "physics-storage";
    for (const [id, label, action] of [
      [
        "save",
        "Save enemies",
        () => {
          this.status.textContent = saveEnemySettings(
            this.storage,
            battle.enemySettings,
          )
            ? "Enemy configuration saved on this browser"
            : "Storage unavailable · settings remain live";
        },
      ],
      [
        "load",
        "Load enemies",
        () => {
          const saved = loadEnemySettings(this.storage);
          if (saved) this.apply(saved);
          this.status.textContent = saved
            ? "Saved enemy settings loaded"
            : "No valid saved enemy settings";
        },
      ],
      [
        "reset",
        "Reset enemies",
        () => {
          this.apply(DEFAULT_ENEMY_SETTINGS, { resetPopulation: true });
          this.status.textContent = "Enemy defaults restored · Save to keep";
        },
      ],
    ]) {
      const button = document.createElement("button");
      button.type = "button";
      button.id = `enemy-${id}`;
      button.textContent = label;
      button.addEventListener("click", action);
      storage.append(button);
    }
    this.warning = document.createElement("p");
    this.warning.id = "enemy-performance";
    this.warning.className = "physics-note";
    this.status = document.createElement("p");
    this.status.id = "enemy-settings-status";
    this.status.setAttribute("role", "status");
    this.status.textContent =
      "Independent of physics Save/Load and character progression";
    fields.append(presets, this.warning, storage, this.status);
    section.append(summary, fields);
    document.querySelector("#physics-presets").before(section);
    this.apply(loadEnemySettings(this.storage) ?? DEFAULT_ENEMY_SETTINGS);
  }
  apply(values, options) {
    this.battle.configureEnemies(values, options);
    const current = this.battle.enemySettings;
    for (const [id, { p, input, output }] of this.rows) {
      input.value = p.log ? Math.log10(current[id]) : current[id];
      output.value = `${Number(current[id].toFixed(2))}${p.unit}`;
      input.setAttribute("aria-valuetext", output.value);
    }
    this.warning.textContent =
      current.maxEnemies > 16
        ? "Experimental crowd: above 16 enemies costs more CPU/GPU. Shared geometry, limited detailed rigs and bounded substeps help; lower the count if FPS drops. Hard limit: 64."
        : "Start with 3–8 on Android. Experimental limit: 64. Speed supports 0.1×–1000×; acceleration 0.1×–100×. Detection/exit use metres, with at least 2 m separation.";
  }
}
