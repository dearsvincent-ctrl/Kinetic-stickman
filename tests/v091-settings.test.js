import test from "node:test";
import assert from "node:assert/strict";
import {
  SettingsRegistry,
  SETTING_CATALOG,
  CATEGORIES,
  loadMenuPreferences,
  saveMenuPreferences,
  MENU_PREFERENCES_KEY,
} from "../src/sandbox/SettingsRegistry.js";
import {
  SandboxConfigurations,
  normalizeConfiguration,
  CONFIGURATIONS_KEY,
  CONFIG_DEFAULTS,
} from "../src/sandbox/SandboxConfigurations.js";
const storage = () => {
  const values = new Map([
    ["kinetic.physics-sandbox.v1", "legacy physics"],
    ["kinetic.controls.v1", "layout"],
  ]);
  return {
    values,
    getItem: (k) => values.get(k) ?? null,
    setItem: (k, v) => values.set(k, v),
  };
};
const snapshot = (physics = {}) => ({
  version: 1,
  values: {
    ...CONFIG_DEFAULTS,
    physics: { ...CONFIG_DEFAULTS.physics, ...physics },
  },
});
test("v091 registry inventories existing settings with stable ids, categories, ranges/defaults and persistence", () => {
  const r = new SettingsRegistry();
  for (const d of SETTING_CATALOG.values()) r.register(d);
  assert.ok(r.entries.size > 100);
  for (const d of r.entries.values()) {
    assert.ok(CATEGORIES.some((c) => c.id === d.category));
    assert.ok(d.persistence);
    assert.ok("default" in d);
    if (d.type === "range") {
      assert.ok(d.default >= d.min && d.default <= d.max, d.id);
    }
  }
  assert.equal(
    r.search("balance recovery")[0].id,
    "enemy-reactions-balanceRecovery",
  );
  assert.ok(r.search("knock").length > 2);
  assert.equal(r.search("no matching setting anywhere").length, 0);
  assert.throws(() =>
    r.register({ id: "future", name: "Future", category: "unassigned" }),
  );
});
test("v091 category expansion/favourites persist separately and safely reject corrupt preferences", () => {
  const s = storage();
  saveMenuPreferences(s, {
    open: new Set(["developer-category-combat"]),
    favourites: new Set(["physics-movement"]),
  });
  assert.deepEqual(loadMenuPreferences(s), {
    open: ["developer-category-combat"],
    favourites: ["physics-movement"],
  });
  assert.equal(s.getItem("kinetic.controls.v1"), "layout");
  assert.equal(s.getItem("kinetic.physics-sandbox.v1"), "legacy physics");
  s.setItem(MENU_PREFERENCES_KEY, "bad");
  assert.deepEqual(loadMenuPreferences(s), { open: [], favourites: [] });
});
test("v091 named builds save, load, explicitly overwrite, rename, duplicate and delete without touching legacy saves", () => {
  const s = storage(),
    configs = new SandboxConfigurations(s),
    id = configs.save("Speedster", snapshot({ movement: 100 }));
  assert.equal(configs.load(id).values.physics.movement, 100);
  assert.throws(() => configs.save("speedster", snapshot()));
  configs.overwrite(id, snapshot({ jumpHeight: 20 }));
  assert.equal(configs.load(id).values.physics.jumpHeight, 20);
  configs.rename(id, "Leaper");
  const second = configs.duplicate(id, "Leaper copy");
  assert.deepEqual(configs.load(id), configs.load(second));
  const reloaded = new SandboxConfigurations(s);
  assert.equal(reloaded.items.length, 2);
  reloaded.delete(id);
  assert.equal(reloaded.items.length, 1);
  assert.equal(s.getItem("kinetic.physics-sandbox.v1"), "legacy physics");
  assert.equal(s.getItem("kinetic.controls.v1"), "layout");
});
test("v091 saved snapshots are isolated copies and missing/new settings migrate safely", () => {
  const c = new SandboxConfigurations(storage()),
    id = c.save("Old", {
      version: 1,
      values: {
        physics: { movement: 5 },
        reactions: { launch: 4 },
        camera: { tag: { baseFov: 90 } },
      },
    });
  const loaded = c.load(id);
  assert.equal(loaded.values.physics.movement, 5);
  assert.equal(loaded.values.physics.agility, 1);
  assert.equal(loaded.values.reactions.launch, 4);
  assert.equal(loaded.values.reactions.balanceRecovery, 1);
  assert.equal(loaded.values.camera.tag.baseFov, 90);
  assert.equal(loaded.values.camera.combat.baseFov, 52);
  loaded.values.physics.movement = 25;
  assert.equal(c.load(id).values.physics.movement, 5);
  assert.throws(() => normalizeConfiguration({ version: 2, values: {} }));
});
test("v091 malformed build slots and unsupported versions never silently apply gameplay changes", () => {
  const s = storage();
  s.setItem(
    CONFIGURATIONS_KEY,
    JSON.stringify({
      version: 1,
      items: [
        { id: "broken", name: "Bad", snapshot: { version: 2, values: {} } },
        { id: "ok", name: "Valid", snapshot: snapshot() },
      ],
    }),
  );
  const c = new SandboxConfigurations(s);
  assert.equal(c.items.length, 1);
  assert.equal(c.items[0].name, "Valid");
  assert.throws(() => c.load("broken"));
  assert.throws(() => c.rename("ok", "   "));
  assert.equal(c.items[0].name, "Valid");
});
test("v091 blocked local storage remains usable for session-only configurations", () => {
  const c = new SandboxConfigurations({
    getItem: () => {
      throw Error("blocked");
    },
    setItem: () => {
      throw Error("quota");
    },
  });
  const id = c.save("Session", snapshot());
  assert.equal(c.lastSaveSucceeded, false);
  assert.equal(c.load(id).values.physics.movement, 1);
});

async function adapterFixture() {
  const { SandboxSettingsAdapter } = await import(
    "../src/ui/SandboxSettingsAdapter.js"
  );
  const v = normalizeConfiguration(
    snapshot({ movement: 20, wallAdhesion: 5, attackPower: 8 }),
  ).values;
  const game = {};
  let locks = 0;
  game.physicsSandbox = {
    values: v.physics,
    apply(x) {
      this.values = x;
    },
    sliderLocks: {
      lockAll() {
        locks++;
      },
    },
  };
  game.punchAim = { config: v.aim };
  game.aimAssistPanel = {
    apply(x) {
      game.punchAim.config = x;
    },
  };
  game.battle = {
    mode: "tag",
    enemySettings: v.enemy,
    tagSettings: v.tag,
    enemyProfiles: v.profiles,
    enemyRosters: { combat: { standard: 2, heavy: 1 }, tag: { leaper: 3 } },
    populationOverride: null,
    reactionSettings: v.reactions,
    configureProfile(id, x) {
      this.enemyProfiles = { ...this.enemyProfiles, [id]: x };
    },
    configureRoster(mode, x) {
      this.enemyRosters = { ...this.enemyRosters, [mode]: x };
    },
  };
  game.enemySettingsPanel = {
    apply(x, o) {
      game.battle.enemySettings = x;
      game.battle.populationOverride = o?.populationOverride ?? null;
    },
  };
  game.tagSettingsPanel = {
    apply(x) {
      game.battle.tagSettings = x;
    },
  };
  game.enemyAbilitiesPanel = {
    refreshProfile() {},
    refreshRosterControls() {},
  };
  game.cameraPreferences = {
    values: v.camera,
    update(mode, x) {
      this.values = { ...this.values, [mode]: x };
    },
    get(mode) {
      return this.values[mode];
    },
  };
  game.cameraSettingsPanel = { refresh() {} };
  game.followCamera = { configure() {} };
  game.speedEffects = { config: v.effects };
  game.freeflow = { config: v.freeflow };
  game.combatPolishPanel = { animation: v.animation, sections: new Map() };
  for (const [family, id] of [
    ["reactions", "enemy-reactions"],
    ["effects", "speed-effects"],
    ["freeflow", "freeflow-combat"],
    ["animation", "animation-polish"],
  ])
    game.combatPolishPanel.sections.set(id, {
      commit(x) {
        if (family === "reactions") game.battle.reactionSettings = x;
        else if (family === "effects") game.speedEffects.config = x;
        else if (family === "freeflow") game.freeflow.config = x;
        else game.combatPolishPanel.animation = x;
      },
    });
  return {
    game,
    adapter: new SandboxSettingsAdapter(game),
    locks: () => locks,
  };
}

test("v091 category defaults change only their own canonical families, regardless of where widgets are displayed", async () => {
  const { game, adapter } = await adapterFixture();
  const before = adapter.capture();
  adapter.resetCategory("combat");
  assert.equal(game.physicsSandbox.values.attackPower, 1);
  assert.equal(game.physicsSandbox.values.movement, 20);
  assert.equal(game.physicsSandbox.values.wallAdhesion, 5);
  assert.deepEqual(game.battle.enemySettings, before.values.enemy);
  adapter.resetCategory("enemies");
  assert.equal(game.battle.enemyRosters.combat, null);
  assert.deepEqual(game.battle.enemyRosters.tag, { leaper: 3 });
  assert.equal(game.battle.mode, "tag");
  adapter.resetCategory("parkour");
  assert.equal(game.physicsSandbox.values.wallAdhesion, 1);
  assert.equal(game.physicsSandbox.values.movement, 20);
});
test("v091 named build application restores both contexts, preserves UI preferences and explicitly relocks controls", async () => {
  const { game, adapter, locks } = await adapterFixture();
  const ui = {
    favourites: ["physics-movement"],
    layout: { move: { x: 0.2, y: 0.8 } },
  };
  game.interfacePreferences = ui;
  const saved = adapter.capture();
  saved.values.camera = {
    combat: { ...CONFIG_DEFAULTS.camera.combat, baseFov: 80 },
    tag: { ...CONFIG_DEFAULTS.camera.tag, baseFov: 100 },
  };
  adapter.apply(saved);
  assert.equal(game.cameraPreferences.values.combat.baseFov, 80);
  assert.equal(game.cameraPreferences.values.tag.baseFov, 100);
  assert.equal(game.battle.mode, "tag");
  assert.equal(game.interfacePreferences, ui);
  assert.ok(locks() > 0);
  assert.deepEqual(game.battle.enemyRosters.tag, {
    standard: 0,
    acrobat: 0,
    leaper: 3,
    heavy: 0,
  });
  assert.throws(() => adapter.apply({ version: 5, values: {} }));
  assert.equal(game.physicsSandbox.values.movement, 20);
});
test("v091 contextual registry retains distinct per-archetype default baselines", () => {
  assert.equal(SETTING_CATALOG.get("ability-mass").contextDefaults.standard, 1);
  assert.equal(SETTING_CATALOG.get("ability-mass").contextDefaults.heavy, 2.5);
  assert.equal(
    SETTING_CATALOG.get("ability-mass").contextId,
    "enemy-profile-select",
  );
});
