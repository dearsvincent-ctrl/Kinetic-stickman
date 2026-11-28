import test from "node:test";
import assert from "node:assert/strict";
import { Vector3, Object3D } from "three";
import {
  CharacterProgression,
  normalizeProgression,
} from "../src/progression/CharacterProgression.js";
import {
  STATISTICS,
  ABILITIES,
  ECONOMY,
  PROGRESSION_KEY,
  experienceRequired,
  statMultiplier,
} from "../src/progression/ProgressionCatalog.js";
import {
  progressionEffects,
  progressionTechnique,
  applyProgressionEffects,
} from "../src/progression/ProgressionEffects.js";
import { CharacterController } from "../src/movement/CharacterController.js";
import { BodyRotation } from "../src/movement/BodyRotation.js";
import { TraversalWorld } from "../src/world/TraversalWorld.js";
import { CombatController } from "../src/combat/CombatController.js";
import { createAdaptiveTechniques } from "../src/combat/AdaptiveTechniques.js";
import { Combatant, DAMAGE_CONFIG } from "../src/combat/Combatant.js";
import {
  NORMAL_PHYSICS,
  sandboxMovementConfig,
} from "../src/sandbox/PhysicsSandbox.js";
const memory = () => ({
  data: new Map(),
  getItem(k) {
    return this.data.get(k) ?? null;
  },
  setItem(k, v) {
    this.data.set(k, v);
  },
});
const near = (a, b, e = 1e-8) => assert.ok(Math.abs(a - b) < e, `${a} ≈ ${b}`);
const rich = (upgrades = {}, selected = []) =>
  new CharacterProgression({
    state: {
      version: 1,
      level: 10,
      points: 1000,
      experience: 0,
      upgrades,
      unlocked: [...ABILITIES.map((a) => a.id)],
      selected,
    },
  });
function controller() {
  return new CharacterController(
    new Object3D(),
    new TraversalWorld(1000, [], []),
  );
}

test("v092 fresh character preserves all existing abilities and exact default movement", () => {
  const c = new CharacterProgression();
  assert.equal(c.state.level, 1);
  assert.equal(c.state.points, 3);
  assert.ok(
    ["doubleJump", "parkour", "freeflow"].every(
      (id) => c.ability(id).purchased,
    ),
  );
  assert.deepEqual(
    progressionEffects(c).movement,
    sandboxMovementConfig(NORMAL_PHYSICS),
  );
  assert.equal(progressionEffects(c).movement.jump.maxJumps, 2);
  for (const v of Object.values(c.values)) assert.equal(v, 1);
});
test("v092 progression persists independently of legacy physics, layouts and named sandbox builds", () => {
  const s = memory();
  s.setItem("kinetic.physics-sandbox.v1", "untouched");
  s.setItem("kinetic.sandbox-configurations.v1", "builds");
  const c = new CharacterProgression({ storage: s });
  assert.equal(c.purchase("jumpStrength").ok, true);
  const loaded = new CharacterProgression({ storage: s });
  assert.equal(loaded.state.upgrades.jumpStrength, 1);
  assert.equal(loaded.state.points, 2);
  assert.equal(s.getItem("kinetic.physics-sandbox.v1"), "untouched");
  assert.equal(s.getItem("kinetic.sandbox-configurations.v1"), "builds");
  assert.equal(JSON.parse(s.getItem(PROGRESSION_KEY)).version, 2);
});
test("v092 experience carries over levels and awards configured points", () => {
  const c = new CharacterProgression();
  assert.equal(c.awardExperience(99), 0);
  assert.equal(c.state.experience, 99);
  assert.equal(c.awardExperience(151), 2);
  assert.equal(c.state.level, 3);
  assert.equal(c.state.experience, 0);
  assert.equal(c.state.points, 9);
});
test("v092 economy supports adjustable XP curves and point awards", () => {
  const c = new CharacterProgression({
    economy: {
      experienceBase: 10,
      experienceGrowth: 0,
      pointsPerLevel: 7,
      maxLevel: 4,
    },
  });
  c.awardExperience(25);
  assert.equal(c.state.level, 3);
  assert.equal(c.state.experience, 5);
  assert.equal(c.state.points, 17);
  c.awardExperience(10000);
  assert.equal(c.state.level, 4);
  assert.equal(c.state.experience, 0);
});
test("v092 insufficient points, unknown IDs and maximum ranks never mutate the save", () => {
  const c = rich({ jumpStrength: 10 });
  const before = c.snapshot();
  assert.equal(c.purchase("jumpStrength").ok, false);
  assert.equal(c.purchase("unknown").ok, false);
  assert.deepEqual(c.snapshot(), before);
  c.state.points = 0;
  const b = c.snapshot();
  assert.equal(c.purchase("agility").ok, false);
  assert.deepEqual(c.snapshot(), b);
});
test("v092 preview and purchase use the same cost and value without spending for previews", () => {
  const c = new CharacterProgression(),
    before = c.snapshot(),
    p = c.preview("jumpStrength");
  assert.equal(p.cost, 1);
  assert.ok(p.next > p.current);
  assert.deepEqual(c.snapshot(), before);
  assert.equal(c.purchase("jumpStrength").ok, true);
  near(c.preview("jumpStrength").current, p.next);
  assert.equal(c.preview("jumpStrength").cost, 2);
  assert.equal(c.state.points, 2);
});
test("v092 stat and ability prerequisites form independent branches", () => {
  const c = new CharacterProgression();
  c.awardPoints(100);
  assert.equal(c.purchase("combatRecovery").ok, false);
  assert.equal(c.unlock("aerialReserve").ok, false);
  c.purchase("attackSpeed");
  assert.equal(c.purchase("combatRecovery").ok, true);
  c.awardExperience(100);
  c.purchase("jumpStrength");
  c.purchase("jumpStrength");
  c.purchase("airControl");
  assert.equal(c.unlock("aerialReserve").ok, true);
  assert.equal(c.unlock("aerialReserve").ok, false);
  assert.equal(c.ability("wallFlow").purchased, false);
  assert.equal(progressionEffects(c).movement.jump.maxJumps, 3);
  c.select("aerialReserve", false);
  assert.equal(progressionEffects(c).movement.jump.maxJumps, 2);
});
test("v092 rank curves are finite, capped and have diminishing increments", () => {
  for (const d of STATISTICS) {
    const a = statMultiplier(d, 1) - 1,
      b = statMultiplier(d, 10) - statMultiplier(d, 9);
    assert.ok(a > b);
    assert.equal(statMultiplier(d, 1000), statMultiplier(d, 10));
    assert.equal(statMultiplier(d, -2), 1);
    assert.ok(Number.isFinite(d.base * statMultiplier(d, 10)));
  }
});
test("v092 new fields default safely, unknown IDs are ignored and v0 names migrate", () => {
  const s = normalizeProgression({
    version: 0,
    level: 2,
    xp: 13,
    upgradePoints: 7,
    statistics: { jumpStrength: 2, obsolete: 100 },
    unlocked: ["aerialReserve", "unknown"],
  });
  assert.equal(s.experience, 13);
  assert.equal(s.points, 7);
  assert.equal(s.upgrades.jumpStrength, 2);
  assert.equal(s.upgrades.airControl, 0);
  assert.ok(!("obsolete" in s.upgrades));
  assert.ok(!s.unlocked.includes("unknown"));
});
test("v092 malformed fields are bounded and unsupported versions are preserved", () => {
  const s = memory(),
    original = JSON.stringify({ version: 900, points: 456 });
  s.setItem(PROGRESSION_KEY, original);
  const c = new CharacterProgression({ storage: s });
  assert.match(c.loadError, /Unsupported/);
  c.purchase("agility");
  assert.equal(s.getItem(PROGRESSION_KEY), original);
  const n = normalizeProgression({
    version: 1,
    level: -5,
    points: Infinity,
    upgrades: { jumpStrength: 999, agility: NaN },
  });
  assert.equal(n.level, 1);
  assert.equal(n.points, 0);
  assert.equal(n.upgrades.jumpStrength, 10);
  assert.equal(n.upgrades.agility, 0);
});
test("v092 storage denial remains session-usable and never reports cloud persistence", () => {
  const c = new CharacterProgression({
    storage: {
      getItem() {
        throw Error();
      },
      setItem() {
        throw Error();
      },
    },
  });
  assert.equal(c.purchase("agility").ok, true);
  assert.equal(c.persistence, "session");
  assert.equal(c.save(), false);
});
test("v092 temporary developer character never changes saved character or any local save", () => {
  const s = memory(),
    c = new CharacterProgression({ storage: s });
  c.purchase("agility");
  const disk = s.getItem(PROGRESSION_KEY),
    before = c.snapshot(),
    p = c.fork();
  p.awardExperience(10000);
  p.awardPoints(100);
  p.purchase("jumpStrength");
  assert.deepEqual(c.snapshot(), before);
  assert.equal(s.getItem(PROGRESSION_KEY), disk);
  assert.equal(p.temporary, true);
  assert.ok(p.state.level > c.state.level);
});
test("v092 sandbox ignores ordinary upgrades and preview composes without modifying slider values", () => {
  const c = rich({
      jumpStrength: 5,
      maximumVelocity: 4,
      attackPower: 3,
      airControl: 2,
    }),
    physics = {
      ...NORMAL_PHYSICS,
      movement: 100,
      jumpHeight: 20,
      airControl: 0.3,
    },
    before = { ...physics };
  const sandbox = progressionEffects(c, { sandbox: true, physics });
  assert.deepEqual(sandbox.movement, sandboxMovementConfig(physics));
  assert.equal(sandbox.strength.attackPower, 1);
  const preview = progressionEffects(c, {
    sandbox: true,
    preview: true,
    physics,
  });
  assert.ok(preview.movement.jump.height > sandbox.movement.jump.height);
  assert.deepEqual(physics, before);
  assert.deepEqual(
    c.state.upgrades,
    rich({ jumpStrength: 5, maximumVelocity: 4, attackPower: 3, airControl: 2 })
      .state.upgrades,
  );
});
test("v092 ground speed, ordinary pace, jump and air abilities scale independently", () => {
  const normal = progressionEffects(rich()),
    fast = progressionEffects(rich({ maximumVelocity: 8 })),
    run = progressionEffects(rich({ runningSpeed: 8 })),
    jump = progressionEffects(rich({ jumpStrength: 8 }));
  assert.ok(
    fast.movement.locomotion.sprintSpeed >
      normal.movement.locomotion.sprintSpeed,
  );
  assert.deepEqual(fast.movement.jump, normal.movement.jump);
  assert.deepEqual(fast.movement.abilities, normal.movement.abilities);
  assert.ok(
    run.movement.locomotion.runSpeed > normal.movement.locomotion.runSpeed,
  );
  assert.equal(
    run.movement.locomotion.sprintSpeed,
    normal.movement.locomotion.sprintSpeed,
  );
  assert.equal(jump.movement.jump.gravity, normal.movement.jump.gravity);
  assert.equal(
    jump.movement.locomotion.sprintSpeed,
    normal.movement.locomotion.sprintSpeed,
  );
});
test("v092 physical jump strength changes launch velocity while both jumps share the same value", () => {
  const c = controller(),
    fx = progressionEffects(rich({ jumpStrength: 4 }));
  c.applyMovementConfig(fx.movement);
  const launch = c.jump.launchVelocity;
  c.jump.launch();
  near(c.jump.verticalVelocity, launch);
  c.jump.advance(0.1);
  c.jump.launch();
  near(c.jump.verticalVelocity, launch);
  assert.ok(launch > Math.sqrt(2 * 18 * 1.2));
});
test("v092 real controller achieves upgraded ground velocity without changing independent jump physics", () => {
  const c = controller(),
    fx = progressionEffects(
      rich({ maximumVelocity: 5, groundAcceleration: 3 }),
    );
  c.applyMovementConfig(fx.movement);
  for (let i = 0; i < 240; i++)
    c.update(1 / 120, { move: { x: 1, y: 0 }, movementMagnitude: 1 }, 0);
  assert.ok(c.speed > 5.2);
  near(c.jump.config.gravity, 18);
  near(c.jump.config.airControl, 3.5);
});
test("v092 individual air upgrades do not increase ground speed, gravity or dash physics", () => {
  for (const id of [
    "airControl",
    "airAcceleration",
    "airBraking",
    "agility",
    "landingStability",
  ]) {
    const a = progressionEffects(rich()),
      b = progressionEffects(rich({ [id]: 6 }));
    assert.deepEqual(a.movement.locomotion, b.movement.locomotion);
    assert.deepEqual(a.movement.groundDash, b.movement.groundDash);
    assert.equal(a.movement.jump.gravity, b.movement.jump.gravity);
    assert.equal(a.movement.jump.height, b.movement.jump.height);
  }
});
test("v092 climb and wall-run upgrades are independent in resolved surface-relative speeds", () => {
  const a = progressionEffects(rich()),
    climb = progressionEffects(rich({ climbing: 5 })),
    wall = progressionEffects(rich({ wallRunning: 5 }));
  assert.ok(climb.climbSpeed > a.climbSpeed);
  assert.equal(
    climb.movement.abilities.wallTraversal,
    a.movement.abilities.wallTraversal,
  );
  near(wall.climbSpeed * wall.movement.abilities.wallTraversal, a.climbSpeed);
  assert.ok(
    wall.movement.abilities.wallTraversal > a.movement.abilities.wallTraversal,
  );
});
test("v092 actual attack timings change coherently and in-flight attacks keep their captured profile", () => {
  const fx = progressionEffects(
    rich({ attackSpeed: 6, combatRecovery: 4, aerialRecovery: 3 }),
  );
  let effects = null;
  const combat = new CombatController({
    techniques: createAdaptiveTechniques(),
    transformTechnique: (t, c) => progressionTechnique(t, c, effects),
  });
  assert.equal(
    combat.requestAttack({
      action: "punch",
      environment: "ground",
      canAttack: true,
    }),
    true,
  );
  const original = combat.currentTechnique;
  effects = fx;
  assert.equal(combat.currentTechnique, original);
  combat.reset();
  combat.update(1);
  assert.equal(
    combat.requestAttack({
      action: "punch",
      environment: "ground",
      canAttack: true,
    }),
    true,
  );
  assert.ok(combat.currentTechnique.windup < original.windup);
  assert.ok(combat.currentTechnique.recovery < original.recovery);
  assert.equal(combat.currentTechnique.reach, original.reach);
  const air = progressionTechnique(original, { environment: "air" }, fx),
    ground = progressionTechnique(original, { environment: "ground" }, fx);
  assert.ok(air.recovery < ground.recovery);
});
test("v092 player stability mitigates stagger/impulse, never health damage or enemy reaction settings", () => {
  const a = new Combatant("a", new Vector3()),
    b = new Combatant("b", new Vector3());
  b.stability = 3;
  const strike = { damage: 10, source: new Vector3(0, 0, 1), knockback: 3 };
  a.receive(strike);
  b.receive(strike);
  assert.equal(a.health, b.health);
  assert.ok(b.stagger < a.stagger);
  assert.ok(b.impulse.length() < a.impulse.length());
});
test("v092 applying effects preserves position, velocity, cooldowns, contacts and current rotation", () => {
  const c = controller(),
    game = {
      controller: c,
      battle: {
        configureStrength(v) {
          this.strength = v;
        },
        player: {},
      },
      bodyRotation: new BodyRotation(),
    };
  c.velocity.set(1, 0, 2);
  const p = c.root.position.clone(),
    q = game.bodyRotation.orientation.clone();
  applyProgressionEffects(
    game,
    progressionEffects(
      rich({ jumpStrength: 4, rotationalControl: 3, climbing: 3 }),
    ),
  );
  assert.deepEqual(c.velocity.toArray(), [1, 0, 2]);
  assert.ok(c.root.position.equals(p));
  assert.ok(game.bodyRotation.orientation.equals(q));
  assert.ok(game.bodyRotation.config.flipDuration < 0.62);
  assert.ok(c.parkour.config.climbSpeed > 3.6);
});
test("v092 events/recalculation are purchase-based rather than per-frame work", () => {
  const c = new CharacterProgression();
  let calls = 0;
  c.subscribe(() => calls++);
  const ref = c.values;
  for (let i = 0; i < 1000; i++) c.preview("agility");
  assert.equal(c.values, ref);
  assert.equal(calls, 0);
  c.purchase("agility");
  assert.equal(calls, 1);
  assert.notEqual(c.values, ref);
});

test("v092 confirmed reward events respect sandbox isolation and temporary testing", async () => {
  const { Game } = await import("../src/core/Game.js");
  const character = new CharacterProgression();
  const game = { activeCharacter: character, sandboxEnabled: false };
  Game.prototype.awardProgressionEvent.call(game, "defeatExperience");
  assert.equal(character.state.experience, 35);
  Game.prototype.awardProgressionEvent.call(game, "tagExperience");
  assert.equal(character.state.experience, 55);
  game.sandboxEnabled = true;
  Game.prototype.awardProgressionEvent.call(game, "tagExperience");
  assert.equal(character.state.experience, 55);
  game.progressionPreview = character.fork();
  game.activeCharacter = game.progressionPreview;
  Game.prototype.awardProgressionEvent.call(game, "tagExperience");
  assert.equal(game.activeCharacter.state.experience, 75);
  assert.equal(character.state.experience, 55);
});
test("v092 selected wall-flow and combat-flow unlocks change real traversal and recovery independently", () => {
  const a = progressionEffects(rich()),
    b = progressionEffects(rich({}, ["wallFlow", "combatFlow"]));
  near(
    b.movement.abilities.wallTraversal,
    a.movement.abilities.wallTraversal * 1.2,
  );
  near(
    b.movement.abilities.wallAdhesion,
    a.movement.abilities.wallAdhesion * 1.2,
  );
  near(b.recovery, a.recovery * 1.15);
  assert.deepEqual(a.movement.jump, b.movement.jump);
  assert.deepEqual(a.strength, b.strength);
});
test("v092 runtime resolves malformed partial sandbox values safely and configurable starting points", () => {
  const effects = progressionEffects(rich(), {
    sandbox: true,
    physics: { attackPower: NaN, jumpHeight: Infinity },
  });
  assert.ok(Number.isFinite(effects.strength.attackPower));
  near(effects.movement.jump.height, 1.2);
  const character = new CharacterProgression({
    economy: { startingPoints: 12 },
  });
  assert.equal(character.state.points, 12);
});

test("v092 upgraded attack power and knockback reach actual confirmed enemy contacts independently", async () => {
  const { BattleWorld } = await import("../src/combat/BattleWorld.js");
  const hit = (upgrades) => {
    const b = new BattleWorld({
      playerPosition: new Vector3(),
      world: new TraversalWorld(10000, [], []),
      targets: [],
    });
    const e = b.enemies.find((e) => e.spawned);
    e.spawn(new Vector3(0, 0, -1), 1, 100);
    const fx = progressionEffects(rich(upgrades));
    b.configureStrength(fx.strength);
    const result = b.hitEnemy(
      {
        targetId: e.body.id,
        source: new Vector3(),
        targetPosition: e.root.position.clone(),
        point: e.root.position.clone().add(new Vector3(0, 1.36, 0)),
        direction: new Vector3(0, 0, -1),
      },
      { action: "punch" },
    );
    return { damage: result.damage, impulse: e.body.impulse.length() };
  };
  const a = hit({}),
    damage = hit({ attackPower: 3 }),
    force = hit({ knockback: 3 });
  assert.ok(damage.damage > a.damage);
  near(damage.impulse, a.impulse);
  near(force.damage, a.damage);
  assert.ok(force.impulse > a.impulse);
});
test("v092 normal progression and extreme sandbox previews stay finite at common frame rates", () => {
  for (const hz of [30, 60, 144])
    for (const multiplier of [1, 20, 100]) {
      const c = controller(),
        fx = progressionEffects(
          rich(Object.fromEntries(STATISTICS.map((d) => [d.id, d.maxLevel]))),
          {
            sandbox: true,
            preview: true,
            physics: {
              ...NORMAL_PHYSICS,
              movement: multiplier,
              jumpHeight: multiplier,
              airControl: multiplier,
              wallTraversal: multiplier,
            },
          },
        );
      c.applyMovementConfig(fx.movement);
      for (let i = 0; i < hz; i++)
        c.update(1 / hz, { move: { x: 0.5, y: 1 }, movementMagnitude: 1 }, 0);
      assert.ok(c.root.position.toArray().every(Number.isFinite));
      assert.ok(c.velocity.toArray().every(Number.isFinite));
      assert.ok(c.root.position.length() < 1500);
    }
});

test("v092 XP/point awards update UI/save without reconfiguring existing movement or strike profiles", () => {
  const c = new CharacterProgression(),
    values = c.values,
    changes = [];
  c.subscribe((owner, detail) => changes.push(detail.mechanics));
  c.awardExperience(100);
  c.awardPoints(10);
  assert.equal(c.values, values);
  assert.deepEqual(changes, [false, false]);
  c.purchase("agility");
  assert.notEqual(c.values, values);
  assert.deepEqual(changes, [false, false, true]);
});
test("v092 physical Tag contacts emit one reusable XP event per successful tag", async () => {
  const { BattleWorld } = await import("../src/combat/BattleWorld.js");
  const { Game } = await import("../src/core/Game.js");
  const character = new CharacterProgression(),
    owner = { activeCharacter: character, sandboxEnabled: false };
  const b = new BattleWorld({
    playerPosition: new Vector3(),
    world: new TraversalWorld(1000, [], []),
    targets: [],
  });
  b.setMode("tag");
  b.onTag = () =>
    Game.prototype.awardProgressionEvent.call(owner, "tagExperience");
  const e = b.enemies.find((e) => e.spawned);
  e.spawn(new Vector3(0, 0, 0.2), 1, 100);
  b.endStep(1 / 60, 0);
  assert.equal(b.tags, 1);
  assert.equal(character.state.experience, 20);
  b.endStep(1 / 60, 0);
  assert.equal(character.state.experience, 20);
});
