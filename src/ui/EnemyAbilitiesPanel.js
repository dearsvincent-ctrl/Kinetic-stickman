import {
  ARCHETYPE_IDS,
  DEFAULT_ENEMY_PROFILES,
  ENEMY_ABILITY_PARAMETERS,
  ENEMY_ABILITY_TOGGLES,
  rosterCount,
} from "../sandbox/EnemyAbilities.js";
import { ENEMY_LIMITS } from "../sandbox/EnemySettings.js";

const numberText = (n) => Number(n.toFixed(2));

/** Session-only profile editing and independent mode composition. Existing
 * pursuit/Tag saves are never replaced with profile data or roster counts. */
export class EnemyAbilitiesPanel {
  constructor(battle) {
    if (new URLSearchParams(location.search).get("sandbox") !== "1") return;
    this.battle = battle;
    this.profileId = "standard";
    this.rows = new Map();
    this.toggles = new Map();
    this.rosters = new Map();
    for (const mode of ["combat", "tag"]) this.createRoster(mode);
    this.createEditor();
    this.refreshProfile();
    this.refreshRosterStatus();
    // Global sliders/presets can alter a cap after this panel was constructed.
    // Updating readouts on user events avoids per-frame DOM/navigation work.
    const panel = document.querySelector("#physics-panel");
    for (const type of ["input", "click"])
      panel.addEventListener(type, () =>
        queueMicrotask(() => this.refreshRosterStatus()),
      );
    document
      .querySelector("#game-mode")
      ?.addEventListener("change", () => this.refreshRosterStatus());
  }

  createRoster(mode) {
    const section = document.querySelector(
      mode === "combat" ? "#enemy-settings" : "#tag-settings",
    );
    if (!section) return;
    const fields = document.createElement("fieldset");
    fields.id = `${mode}-roster-controls`;
    const legend = document.createElement("legend");
    legend.textContent = `${mode === "combat" ? "Combat" : "Tag"} archetypes`;
    const note = document.createElement("p");
    note.className = "physics-note";
    note.textContent =
      mode === "combat"
        ? "Choose a custom mix for each combat wave. Waves, health and attacks remain active. Off uses the existing wave/population controls. Counts are capped by Maximum active enemies. Session only: Save enemies saves global tuning, not this mix."
        : "Choose which runners escape in Tag Mode. Off uses the existing Fleeing characters setting. Counts are capped by Fleeing characters; raise that slider for larger custom groups. Session only: Save tag saves global tuning, not this mix.";
    const customLabel = document.createElement("label");
    customLabel.className = "aim-debug-label";
    const custom = document.createElement("input");
    custom.type = "checkbox";
    custom.id = `${mode}-roster-custom`;
    customLabel.append(
      custom,
      document.createTextNode("Use custom archetype group"),
    );
    const status = document.createElement("p");
    status.id = `${mode}-roster-status`;
    status.className = "physics-note";
    status.setAttribute("role", "status");
    const entries = new Map();
    const saved = this.battle.enemyRosters?.[mode] ?? null;
    custom.checked = saved !== null;
    fields.append(legend, note, customLabel);
    for (const id of ARCHETYPE_IDS) {
      const row = document.createElement("div");
      row.className = "physics-row";
      const enabledLabel = document.createElement("label");
      enabledLabel.className = "aim-debug-label";
      const enabled = document.createElement("input");
      enabled.type = "checkbox";
      enabled.id = `${mode}-roster-${id}-enabled`;
      enabled.checked = saved ? saved[id] > 0 : id === "standard";
      enabledLabel.append(
        enabled,
        document.createTextNode(DEFAULT_ENEMY_PROFILES[id].name),
      );
      const output = document.createElement("output");
      const input = document.createElement("input");
      input.type = "range";
      input.id = `${mode}-roster-${id}-count`;
      input.min = "1";
      input.max = String(ENEMY_LIMITS.population);
      input.step = "1";
      input.value = saved?.[id] > 0 ? saved[id] : id === "standard" ? 3 : 1;
      input.setAttribute(
        "aria-label",
        `${mode === "combat" ? "Combat" : "Tag"} ${DEFAULT_ENEMY_PROFILES[id].name} count`,
      );
      output.htmlFor = input.id;
      row.append(enabledLabel, output, input);
      fields.append(row);
      entries.set(id, { enabled, input, output });
      enabled.addEventListener("change", () => {
        custom.checked = true;
        this.applyRoster(mode);
      });
      input.addEventListener("input", () => {
        enabled.checked = custom.checked = true;
        this.applyRoster(mode);
      });
    }
    this.rosters.set(mode, { fields, custom, status, entries });
    custom.addEventListener("change", () => this.applyRoster(mode));
    fields.append(status);
    section.append(fields);
  }

  applyRoster(mode) {
    const row = this.rosters.get(mode);
    const counts = Object.fromEntries(
      [...row.entries].map(([id, entry]) => [
        id,
        entry.enabled.checked ? Number(entry.input.value) : 0,
      ]),
    );
    this.battle.configureRoster(mode, row.custom.checked ? counts : null);
    this.refreshRosterStatus();
  }

  refreshRosterStatus() {
    for (const [mode, row] of this.rosters) {
      const counts = this.battle.enemyRosters?.[mode] ?? null;
      const cap =
        mode === "combat"
          ? this.battle.enemySettings.maxEnemies
          : this.battle.tagSettings.maxEnemies;
      for (const entry of row.entries.values()) {
        entry.output.value = entry.enabled.checked ? entry.input.value : "Off";
        entry.input.setAttribute(
          "aria-valuetext",
          `${entry.input.value} characters${entry.enabled.checked ? "" : ", type disabled"}`,
        );
      }
      if (counts === null) {
        row.status.textContent = `Original ${mode === "combat" ? "waves" : "Tag population"} active · global cap ${cap}. Profile changes remain live; composition is not customised.`;
      } else {
        const requested = rosterCount(counts),
          count = Math.min(cap, requested);
        row.status.textContent = `${requested} requested · ${count} allowed by global cap ${cap}${requested > cap ? " · Raise the global population slider to use the full request. Enabled types share capped slots in a stable rotation." : ""}${requested === 0 ? " · No archetypes enabled; this mode waits until a type is selected." : ""}${count > 16 ? " · Experimental crowd: reduce counts if Android FPS drops." : ""}`;
      }
    }
  }

  createEditor() {
    const section = document.createElement("details");
    section.id = "enemy-abilities";
    section.className = "enemy-settings";
    const summary = document.createElement("summary");
    summary.textContent = "Enemy Abilities";
    const fields = document.createElement("fieldset");
    fields.id = "enemy-ability-controls";
    const legend = document.createElement("legend");
    legend.textContent = "Archetype movement & combat";
    const selectLabel = document.createElement("label");
    selectLabel.className = "mode-picker";
    const name = document.createElement("span");
    name.textContent = "PROFILE";
    this.select = document.createElement("select");
    this.select.id = "enemy-profile-select";
    this.select.setAttribute("aria-label", "Enemy archetype to edit");
    for (const id of ARCHETYPE_IDS) {
      const option = document.createElement("option");
      option.value = id;
      option.textContent = DEFAULT_ENEMY_PROFILES[id].name;
      this.select.append(option);
    }
    selectLabel.append(name, this.select);
    const note = document.createElement("p");
    note.className = "physics-note";
    note.textContent =
      "Live, session-only enemy profiles. Combat pursuit or Tag escape speed multiplies running speed; its acceleration slider multiplies acceleration and braking. Combined running speed has an 8,000 m/s numerical safety bound. Jump height/count and air control never use player physics. Climbing uses this baseline and shared running momentum. Enemy damage multiplies wave damage; resistance divides incoming knockback. Saved global settings remain separate.";
    fields.append(legend, selectLabel, note);
    for (const p of ENEMY_ABILITY_PARAMETERS) {
      const row = document.createElement("label");
      row.className = "physics-row";
      const label = document.createElement("span");
      label.textContent = p.label;
      const output = document.createElement("output");
      const input = document.createElement("input");
      input.type = "range";
      input.id = `ability-${p.id}`;
      input.min = p.log ? Math.log10(p.min) : p.min;
      input.max = p.log ? Math.log10(p.max) : p.max;
      input.step = p.log ? "0.01" : String(p.step);
      input.setAttribute(
        "aria-label",
        `Enemy ability ${p.label.toLowerCase()}`,
      );
      output.htmlFor = input.id;
      row.append(label, output, input);
      fields.append(row);
      this.rows.set(p.id, { p, input, output });
      input.addEventListener("input", () => {
        let value = p.log ? 10 ** Number(input.value) : Number(input.value);
        if (p.log) {
          const marks = [
            p.min,
            p.max,
            ...ARCHETYPE_IDS.map((id) => DEFAULT_ENEMY_PROFILES[id][p.id]),
            0.5,
            1,
            2,
            5,
            10,
            20,
            50,
            100,
            200,
          ];
          value =
            marks.find((n) => n > 0 && Math.abs(value - n) <= n * 0.012) ??
            value;
        }
        this.battle.configureProfile(this.profileId, { [p.id]: value });
        this.refreshProfile();
        this.status.textContent = `${DEFAULT_ENEMY_PROFILES[this.profileId].name} abilities applied live · session only`;
      });
    }
    for (const p of ENEMY_ABILITY_TOGGLES) {
      const label = document.createElement("label");
      label.className = "aim-debug-label";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.id = `ability-${p.id}`;
      label.append(input, document.createTextNode(p.label));
      fields.append(label);
      this.toggles.set(p.id, input);
      input.addEventListener("change", () => {
        this.battle.configureProfile(this.profileId, { [p.id]: input.checked });
        this.refreshProfile();
        this.status.textContent =
          "Traversal abilities applied live · unsupported abilities stay disabled";
      });
    }
    const actions = document.createElement("div");
    actions.className = "physics-storage";
    for (const [id, text, action] of [
      [
        "selected",
        "Reset this profile",
        () =>
          this.battle.configureProfile(
            this.profileId,
            DEFAULT_ENEMY_PROFILES[this.profileId],
          ),
      ],
      ["all", "Reset all profiles", () => this.battle.resetProfiles()],
    ]) {
      const button = document.createElement("button");
      button.type = "button";
      button.id = `ability-reset-${id}`;
      button.textContent = text;
      button.addEventListener("click", () => {
        action();
        this.refreshProfile();
        this.status.textContent =
          "Ability defaults restored · mode rosters and saved global settings unchanged";
      });
      actions.append(button);
    }
    this.status = document.createElement("p");
    this.status.id = "enemy-abilities-status";
    this.status.className = "physics-note";
    this.status.setAttribute("role", "status");
    this.status.textContent =
      "Profiles and custom rosters are session-only; reload restores sensible defaults. Save/Load for custom profiles is reserved for a later update.";
    fields.append(actions, this.status);
    section.append(summary, fields);
    document.querySelector("#physics-presets").before(section);
    this.select.addEventListener("change", () => {
      this.profileId = this.select.value;
      this.refreshProfile();
      section.dispatchEvent(
        new Event("kinetic:relock-sliders", { bubbles: true }),
      );
      this.status.textContent = `Editing ${DEFAULT_ENEMY_PROFILES[this.profileId].name} · adjustments affect that archetype only`;
    });
  }

  refreshProfile() {
    const profile = this.battle.enemyProfiles[this.profileId];
    for (const [id, { p, input, output }] of this.rows) {
      input.value = p.log ? Math.log10(profile[id]) : profile[id];
      output.value = `${numberText(profile[id])}${p.unit}`;
      input.setAttribute("aria-valuetext", output.value);
    }
    for (const [id, input] of this.toggles) input.checked = profile[id];
  }
}
