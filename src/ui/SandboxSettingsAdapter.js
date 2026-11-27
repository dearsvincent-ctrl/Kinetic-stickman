import {
  CONFIG_DEFAULTS,
  normalizeConfiguration,
} from "../sandbox/SandboxConfigurations.js";
import { SANDBOX_PARAMETERS } from "../sandbox/PhysicsSandbox.js";
import { ARCHETYPE_IDS } from "../sandbox/EnemyAbilities.js";
/** Whole-state snapshots use the existing gameplay owners, not rendered slider
 * copies or localStorage seeding. Editor context and HUD preferences stay out. */
export class SandboxSettingsAdapter {
  constructor(game) {
    this.game = game;
    this.registry = null;
  }
  capture() {
    const g = this.game,
      b = g.battle;
    const extras = {};
    for (const entry of this.registry?.entries.values() ?? [])
      if (entry.family === "extras") extras[entry.id] = entry.read();
    return normalizeConfiguration({
      version: 1,
      values: {
        physics: g.physicsSandbox.values,
        aim: g.punchAim.config,
        enemy: b.enemySettings,
        enemyPopulationOverride: b.populationOverride,
        tag: b.tagSettings,
        profiles: b.enemyProfiles,
        rosters: b.enemyRosters,
        camera: g.cameraPreferences.values,
        reactions: b.reactionSettings,
        effects: g.speedEffects.config,
        freeflow: g.freeflow.config,
        animation: g.combatPolishPanel.animation,
        extras,
      },
    });
  }
  apply(snapshot, { families = null } = {}) {
    const { values: v } = normalizeConfiguration(snapshot),
      g = this.game;
    const has = (key) => !families || families.includes(key);
    if (has("physics")) g.physicsSandbox.apply(v.physics);
    if (has("aim")) g.aimAssistPanel.apply(v.aim);
    if (has("enemy"))
      g.enemySettingsPanel.apply(v.enemy, {
        populationOverride: v.enemyPopulationOverride,
      });
    if (has("tag")) g.tagSettingsPanel.apply(v.tag);
    if (has("profiles")) {
      for (const id of ARCHETYPE_IDS)
        g.battle.configureProfile(id, v.profiles[id]);
      g.enemyAbilitiesPanel.refreshProfile();
    }
    if (has("rosters")) {
      for (const mode of ["combat", "tag"])
        g.battle.configureRoster(mode, v.rosters[mode]);
      g.enemyAbilitiesPanel.refreshRosterControls();
    }
    if (has("camera")) {
      for (const mode of ["combat", "tag"])
        g.cameraPreferences.update(mode, v.camera[mode]);
      g.followCamera.configure(g.cameraPreferences.get(g.battle.mode));
      g.cameraSettingsPanel.refresh();
    }
    for (const [key, id] of [
      ["reactions", "enemy-reactions"],
      ["effects", "speed-effects"],
      ["freeflow", "freeflow-combat"],
      ["animation", "animation-polish"],
    ])
      if (has(key)) g.combatPolishPanel.sections.get(id).commit(v[key]);
    if (has("extras"))
      for (const [id, value] of Object.entries(v.extras)) {
        const entry = this.registry?.entries.get(id);
        if (entry?.family === "extras") entry.write(value);
      }
    g.physicsSandbox.sliderLocks.lockAll();
  }
  resetCategory(category) {
    const snapshot = this.capture(),
      v = snapshot.values,
      defaults = CONFIG_DEFAULTS;
    const families = [];
    if (["movement", "parkour", "combat"].includes(category)) {
      for (const p of SANDBOX_PARAMETERS)
        if (
          (p.group === "abilities"
            ? "parkour"
            : p.group === "combat"
              ? "combat"
              : "movement") === category
        )
          v.physics = { ...v.physics, [p.id]: defaults.physics[p.id] };
      families.push("physics");
    }
    const parts =
      {
        combat: ["aim", "freeflow"],
        reactions: ["reactions"],
        enemies: ["enemy", "profiles"],
        camera: ["camera"],
        modes: ["tag"],
        visuals: ["effects", "animation"],
      }[category] ?? [];
    for (const key of parts) {
      v[key] = defaults[key];
      families.push(key);
    }
    if (category === "enemies" || category === "modes") {
      const mode = category === "enemies" ? "combat" : "tag";
      // Apply only this roster, preserving the other gameplay mode and its UI.
      this.game.battle.configureRoster(mode, null);
      this.game.enemyAbilitiesPanel.refreshRosterControls();
      if (category === "enemies") v.enemyPopulationOverride = null;
    }
    this.apply(snapshot, { families });
    for (const entry of this.registry?.entries.values() ?? [])
      if (entry.family === "extras" && entry.category === category)
        entry.write(entry.default);
  }
}
