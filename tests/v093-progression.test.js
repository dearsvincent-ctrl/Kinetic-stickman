import test from "node:test";
import assert from "node:assert/strict";
import {
  CharacterProgression,
  normalizeProgression,
} from "../src/progression/CharacterProgression.js";
import {
  STATISTICS,
  ABILITIES,
  statMultiplier,
  PROGRESSION_KEY,
} from "../src/progression/ProgressionCatalog.js";
import {
  REFERENCE_RULES,
  RULE_PRESETS,
  sanitizeRules,
  evaluateCurve,
  curveCost,
  investmentCost,
} from "../src/progression/ProgressionCurves.js";
import {
  ProgressionLab,
  PROGRESSION_LAB_KEY,
  BUILD_IDENTITIES,
  buildForBudget,
} from "../src/progression/ProgressionLab.js";
import {
  progressionEffects,
  progressionTechnique,
} from "../src/progression/ProgressionEffects.js";
import { NORMAL_PHYSICS } from "../src/sandbox/PhysicsSandbox.js";
import { CharacterController } from "../src/movement/CharacterController.js";
import { TraversalWorld } from "../src/world/TraversalWorld.js";
import { Object3D } from "three";
const copy = (x) => JSON.parse(JSON.stringify(x)),
  near = (a, b, e = 1e-9) => assert.ok(Math.abs(a - b) < e, `${a} ≈ ${b}`);
const memory = () => ({
  data: new Map(),
  getItem(k) {
    return this.data.get(k) ?? null;
  },
  setItem(k, v) {
    this.data.set(k, v);
  },
});
const character = (upgrades = {}, rules = REFERENCE_RULES) =>
  new CharacterProgression({
    rules,
    temporary: true,
    state: {
      version: 2,
      level: 10,
      points: 100000,
      experience: 7,
      upgrades,
      unlocked: ABILITIES.filter((a) => a.baseline).map((a) => a.id),
      selected: [],
    },
  });

test("v093 every default numerical attribute starts at 1 and advances by one per purchase", () => {
  const c = new CharacterProgression();
  for (const d of STATISTICS) assert.equal(c.attribute(d.id), 1);
  const p = c.preview("maximumVelocity");
  assert.equal(p.attribute, 1);
  assert.equal(p.nextAttribute, 2);
  c.purchase("maximumVelocity");
  assert.equal(c.attribute("maximumVelocity"), 2);
  assert.notEqual(c.values.maximumVelocity, 2);
  near(c.values.maximumVelocity, 1.5438077407660545);
});
test("v093 reference exactly records every existing gain, cost and legacy cap", () => {
  for (const d of STATISTICS)
    for (let rank = 0; rank <= 10; rank++) {
      near(
        evaluateCurve(REFERENCE_RULES.stats[d.id], rank + 1),
        d.base * statMultiplier(d, rank),
      );
      assert.equal(
        curveCost(REFERENCE_RULES.stats[d.id], rank),
        Math.ceil(1 + rank * 0.5),
      );
    }
  assert.equal(REFERENCE_RULES.stats.maximumVelocity.maxAttribute, 11);
});
test("v093 independent linear curves are additive while compounded growth is explicit", () => {
  const r = sanitizeRules(RULE_PRESETS["Additive 10%"]),
    v = r.stats.maximumVelocity;
  near(evaluateCurve(v, 5), v.base * 1.4);
  v.type = "compounded";
  near(evaluateCurve(v, 5), v.base * 1.1 ** 4);
  assert.ok(evaluateCurve(v, 5) > v.base * 1.4);
  r.stats.jumpStrength.rate = 0.5;
  assert.equal(r.stats.maximumVelocity.rate, 0.1);
});
test("v093 slower and faster additive presets differ meaningfully without altering the reference", () => {
  const before = copy(REFERENCE_RULES);
  for (const [name, rate] of [
    ["Additive 5%", 0.05],
    ["Additive 10%", 0.1],
    ["Additive 20%", 0.2],
    ["Additive 50%", 0.5],
  ]) {
    const v = RULE_PRESETS[name].stats.maximumVelocity;
    near(evaluateCurve(v, 2), v.base * (1 + rate));
  }
  assert.deepEqual(REFERENCE_RULES, before);
});
test("v093 accelerating, diminishing, threshold and gameplay caps are independently configurable", () => {
  const r = sanitizeRules(),
    v = r.stats.jumpStrength;
  v.type = "accelerating";
  v.rate = 0.1;
  v.maxAttribute = 100;
  near(evaluateCurve(v, 5), v.base * (1 + 0.1 * 16));
  v.type = "diminishing";
  const increments = [1, 2, 3, 4].map(
    (n) => evaluateCurve(v, n + 1) - evaluateCurve(v, n),
  );
  assert.ok(increments[0] > increments[3]);
  v.type = "linear";
  v.threshold = 3;
  v.postThresholdRate = 0;
  near(evaluateCurve(v, 10), evaluateCurve(v, 3));
  v.maxGameplay = v.base * 1.1;
  near(evaluateCurve(v, 10), v.maxGameplay);
});
test("v093 per-attribute bases, costs and maximum values do not alter other attributes", () => {
  const r = sanitizeRules();
  r.stats.attackPower.base = 2;
  r.stats.attackPower.costBase = 5;
  r.stats.attackPower.costGrowth = 2;
  r.stats.attackPower.costPower = 2;
  r.stats.attackPower.maxAttribute = 3;
  const c = character({}, r);
  assert.equal(c.values.attackPower, 2);
  assert.equal(c.values.attackSpeed, 1);
  assert.equal(c.preview("attackPower").cost, 5);
  c.purchase("attackPower");
  assert.equal(c.preview("attackPower").cost, 7);
  c.purchase("attackPower");
  assert.equal(c.preview("attackPower").available, false);
  assert.equal(c.attribute("attackPower"), 3);
});
test("v093 numerical attribute prerequisites preserve the same legacy ability thresholds", () => {
  const c = character({ jumpStrength: 2, airControl: 1 });
  assert.equal(c.ability("aerialReserve").available, true);
  assert.deepEqual(c.ability("aerialReserve").attributes, {
    jumpStrength: 3,
    airControl: 2,
  });
  assert.equal(c.unlock("aerialReserve").ok, true);
  const r = sanitizeRules();
  r.abilities.wallFlow.attributes = { climbing: 4, agility: 5 };
  const a = character({ climbing: 3, agility: 3 }, r);
  assert.match(a.ability("wallFlow").reason, /Agility attribute 5/);
  a.purchase("agility");
  assert.equal(a.ability("wallFlow").available, true);
});
test("v093 disabled and cyclic ability policies are safe and do not remove purchased unlocks", () => {
  const r = sanitizeRules();
  r.abilities.aerialReserve.enabled = false;
  r.abilities.aerialReserve.abilities = ["wallFlow"];
  r.abilities.wallFlow.abilities = ["aerialReserve"];
  const normalized = sanitizeRules(r);
  assert.ok(
    !normalized.abilities.aerialReserve.abilities.includes("wallFlow") ||
      !normalized.abilities.wallFlow.abilities.includes("aerialReserve"),
  );
  const c = character({}, r);
  assert.match(c.ability("aerialReserve").reason, /Disabled/);
  c.state.unlocked.push("aerialReserve");
  c.state.selected.push("aerialReserve");
  assert.equal(c.ability("aerialReserve").purchased, true);
  assert.equal(progressionEffects(c).movement.jump.maxJumps, 2);
});
test("v093 v092 saves migrate purchase ranks without resetting any owned progress", () => {
  const storage = memory(),
    legacy = {
      version: 1,
      level: 8,
      experience: 152,
      points: 9,
      upgrades: { maximumVelocity: 4, jumpStrength: 3 },
      unlocked: ["doubleJump", "parkour", "freeflow", "aerialReserve"],
      selected: ["aerialReserve"],
    };
  storage.setItem(PROGRESSION_KEY, JSON.stringify(legacy));
  const c = new CharacterProgression({ storage });
  assert.equal(c.state.version, 2);
  assert.equal(c.attribute("maximumVelocity"), 5);
  assert.equal(c.state.level, 8);
  assert.equal(c.state.experience, 152);
  assert.equal(c.state.points, 9);
  assert.ok(c.state.unlocked.includes("aerialReserve"));
  assert.deepEqual(c.state.selected, ["aerialReserve"]);
  assert.equal(storage.getItem(PROGRESSION_KEY), JSON.stringify(legacy));
  c.purchase("agility");
  assert.equal(JSON.parse(storage.getItem(PROGRESSION_KEY)).version, 2);
});
test("v093 lowering test caps preserves purchases, XP and level across saving and restoring rules", () => {
  const r = sanitizeRules();
  r.stats.maximumVelocity.maxAttribute = 2;
  r.economy.maxLevel = 2;
  r.economy.experienceBase = 1;
  const c = character({ maximumVelocity: 8 });
  const before = c.snapshot(),
    reference = c.values.maximumVelocity;
  c.configureRules(r);
  assert.equal(c.attribute("maximumVelocity"), 9);
  assert.equal(c.purchase("maximumVelocity").ok, false);
  assert.equal(c.state.experience, 7);
  const reload = new CharacterProgression({ state: c.snapshot(), rules: r });
  assert.equal(reload.state.level, 10);
  assert.equal(reload.state.experience, 7);
  reload.configureRules(REFERENCE_RULES);
  near(reload.values.maximumVelocity, reference);
  assert.deepEqual(reload.snapshot(), before);
});
test("v093 configuration Save/Load and active-rule selection are separate from ordinary sandbox and character data", () => {
  const s = memory();
  s.setItem(PROGRESSION_KEY, "owned");
  s.setItem("kinetic.sandbox-configurations.v1", "sandboxes");
  const lab = new ProgressionLab(s);
  lab.edit(RULE_PRESETS["Additive 5%"]);
  const slot = lab.save("configurations", "Slow", lab.draft);
  const loaded = new ProgressionLab(s);
  assert.equal(loaded.draft.stats.maximumVelocity.rate, 0.05);
  assert.equal(loaded.active.stats.maximumVelocity.type, "diminishing");
  loaded.activate();
  assert.equal(new ProgressionLab(s).active.stats.maximumVelocity.rate, 0.05);
  assert.equal(loaded.configurations[0].id, slot.id);
  assert.equal(s.getItem(PROGRESSION_KEY), "owned");
  assert.equal(s.getItem("kinetic.sandbox-configurations.v1"), "sandboxes");
});
test("v093 explicit configuration overwrite, deletion and slot limits are validated", () => {
  const l = new ProgressionLab(memory()),
    a = l.save("configurations", "A", REFERENCE_RULES);
  assert.throws(
    () => l.save("configurations", "A", REFERENCE_RULES),
    /already exists/,
  );
  l.save("configurations", "A", RULE_PRESETS["Additive 50%"], a.id);
  assert.equal(l.configurations[0].value.stats.maximumVelocity.rate, 0.5);
  assert.throws(
    () => l.save("configurations", "Lost", REFERENCE_RULES, "missing"),
    /Select/,
  );
  l.remove("configurations", a.id);
  assert.equal(l.configurations.length, 0);
  for (let n = 0; n < 32; n++)
    l.save("configurations", "C" + n, REFERENCE_RULES);
  assert.throws(
    () => l.save("configurations", "Overflow", REFERENCE_RULES),
    /32/,
  );
});
test("v093 corrupt or future lab saves preserve original data and remain session-usable", () => {
  for (const raw of ["bad JSON", JSON.stringify({ version: 99 })]) {
    const s = memory();
    s.setItem(PROGRESSION_LAB_KEY, raw);
    const l = new ProgressionLab(s);
    l.edit(RULE_PRESETS["Additive 20%"]);
    assert.equal(s.getItem(PROGRESSION_LAB_KEY), raw);
    assert.equal(l.persistence, "session");
  }
  const s = memory();
  s.setItem(
    PROGRESSION_LAB_KEY,
    JSON.stringify({ version: 1, active: null, draft: null }),
  );
  assert.equal(
    new ProgressionLab(s).active.stats.maximumVelocity.type,
    "diminishing",
  );
});
test("v093 rule changes and experimental budgets never write the legitimate character", () => {
  const s = memory(),
    c = new CharacterProgression({ storage: s });
  c.purchase("agility");
  const before = s.getItem(PROGRESSION_KEY),
    p = c.fork();
  p.configureRules(RULE_PRESETS["Additive 10%"]);
  p.awardPoints(1000);
  assert.equal(p.redistribute({ maximumVelocity: 10 }, 100).ok, true);
  assert.equal(p.attribute("maximumVelocity"), 10);
  assert.equal(s.getItem(PROGRESSION_KEY), before);
  assert.equal(c.attribute("maximumVelocity"), 1);
  assert.equal(c.redistribute({ maximumVelocity: 2 }, 100).ok, false);
});
test("v093 budget assignment refunds points and rejects overspend without partial changes", () => {
  const c = character();
  assert.equal(c.redistribute({ maximumVelocity: 5 }, 10).ok, true);
  assert.equal(c.investment(), 8);
  assert.equal(c.state.points, 2);
  const before = c.snapshot();
  assert.equal(c.redistribute({ maximumVelocity: 11 }, 1).ok, false);
  assert.deepEqual(c.snapshot(), before);
  assert.equal(c.redistribute({ maximumVelocity: 1 }, 10).ok, true);
  assert.equal(c.state.points, 10);
});
test("v093 experimental builds save their own rules and restore without affecting active normal rules", () => {
  const s = memory(),
    lab = new ProgressionLab(s),
    c = character({ jumpStrength: 4 }, RULE_PRESETS["Additive 20%"]);
  lab.save("builds", "Leaps", {
    character: c.snapshot(),
    rules: c.rules,
    budget: 100,
  });
  const loaded = new ProgressionLab(s),
    entry = loaded.builds[0];
  const restored = new CharacterProgression({
    state: entry.value.character,
    rules: entry.value.rules,
    temporary: true,
  });
  assert.equal(restored.attribute("jumpStrength"), 5);
  assert.equal(restored.rules.stats.jumpStrength.rate, 0.2);
  assert.equal(loaded.active.stats.jumpStrength.type, "diminishing");
});
test("v093 equal-budget identity templates produce distinct connected gameplay effects without classes", () => {
  const rules = sanitizeRules(),
    effects = {};
  for (const name of Object.keys(BUILD_IDENTITIES)) {
    const b = buildForBudget(rules, name, 100);
    assert.ok(b.spent <= 100);
    assert.equal(b.spent + b.remaining, 100);
    const c = character();
    c.redistribute(b.attributes, 100);
    effects[name] = progressionEffects(c);
  }
  assert.ok(
    effects.Speedster.movement.locomotion.sprintSpeed >
      effects.Acrobat.movement.locomotion.sprintSpeed,
  );
  assert.ok(
    effects.Acrobat.movement.jump.airControl >
      effects.Speedster.movement.jump.airControl,
  );
  assert.ok(
    effects["Superhuman Leaper"].movement.jump.height >
      effects.Speedster.movement.jump.height,
  );
  assert.ok(
    effects.Powerhouse.strength.attackPower >
      effects["Martial Artist"].strength.attackPower,
  );
  assert.ok(
    effects["Martial Artist"].attackSpeed > effects.Powerhouse.attackSpeed,
  );
});
test("v093 speed, jump, strength and agility upgrades remain independent under alternative curves", () => {
  const rules = sanitizeRules(RULE_PRESETS["Additive 20%"]),
    base = progressionEffects(character({}, rules));
  for (const [id, field] of [
    ["maximumVelocity", "speed"],
    ["jumpStrength", "jump"],
    ["attackPower", "power"],
    ["agility", "agility"],
  ]) {
    const f = progressionEffects(character({ [id]: 4 }, rules));
    if (field !== "jump")
      assert.equal(f.movement.jump.height, base.movement.jump.height);
    if (field !== "speed")
      assert.equal(
        f.movement.locomotion.sprintSpeed,
        base.movement.locomotion.sprintSpeed,
      );
    if (field !== "power")
      assert.equal(f.strength.attackPower, base.strength.attackPower);
    assert.equal(f.attackSpeed, base.attackSpeed);
  }
});
test("v093 the new wall-jump attribute modifies deliberate wall impulses only", () => {
  const a = progressionEffects(character()),
    b = progressionEffects(character({ wallJump: 5 }));
  assert.ok(b.movement.abilities.wallJump > a.movement.abilities.wallJump);
  assert.deepEqual(a.movement.jump, b.movement.jump);
  assert.equal(
    a.movement.abilities.wallTraversal,
    b.movement.abilities.wallTraversal,
  );
  assert.deepEqual(a.movement.locomotion, b.movement.locomotion);
});
test("v093 extreme curves stay finite with bounded rotation and preserve valid analogue anchors", () => {
  const rules = sanitizeRules(RULE_PRESETS["Additive 50%"]);
  for (const v of Object.values(rules.stats)) {
    v.type = "compounded";
    v.rate = 10;
    v.maxAttribute = 100;
    v.maxGameplay = v.base * 100;
  }
  const c = character(
      Object.fromEntries(STATISTICS.map((d) => [d.id, 99])),
      rules,
    ),
    f = progressionEffects(c, {
      sandbox: true,
      preview: true,
      physics: { ...NORMAL_PHYSICS, movement: 100, jumpHeight: 100 },
    });
  assert.ok(Object.values(c.values).every(Number.isFinite));
  assert.ok(f.rotation.maxAngularSpeed <= 60);
  assert.ok(f.rotation.flipDuration >= 0.25);
  assert.ok(f.movement.locomotion.runSpeed < f.movement.locomotion.sprintSpeed);
  const controller = new CharacterController(
    new Object3D(),
    new TraversalWorld(1000, [], []),
  );
  controller.applyMovementConfig(f.movement);
  for (let n = 0; n < 120; n++)
    controller.update(
      1 / 120,
      { move: { x: 1, y: 0 }, movementMagnitude: 1 },
      0,
    );
  assert.ok(controller.root.position.toArray().every(Number.isFinite));
});
test("v093 future sessions can choose starting attributes and temporary progression without a survival mode", () => {
  const rules = sanitizeRules();
  rules.startingAttributes.agility = 5;
  rules.economy.startingPoints = 20;
  rules.economy.pointsPerLevel = 7;
  const c = new CharacterProgression({ temporary: true, rules });
  assert.equal(c.attribute("agility"), 5);
  assert.equal(c.state.points, 20);
  c.awardExperience(100);
  assert.equal(c.state.points, 27);
  assert.equal(c.save(), false);
});

test("v093 fresh developer characters and templates do not inherit the legitimate character ranks or unlock costs", async () => {
  const { Game } = await import("../src/core/Game.js");
  const original = character({ jumpStrength: 3, maximumVelocity: 4 });
  original.state.unlocked.push("aerialReserve");
  const game = {
    progression: original,
    progressionLab: { draft: sanitizeRules() },
    applyCharacterProgression() {},
    progressionPanel: { render() {} },
  };
  Game.prototype.setProgressionPreview.call(game, true, { state: null });
  assert.equal(game.progressionPreview.attribute("jumpStrength"), 1);
  assert.ok(!game.progressionPreview.state.unlocked.includes("aerialReserve"));
  Game.prototype.setProgressionPreview.call(game, true);
  assert.equal(game.progressionPreview.attribute("jumpStrength"), 4);
  assert.ok(game.progressionPreview.state.unlocked.includes("aerialReserve"));
});
