import test from "node:test";
import assert from "node:assert/strict";
import { Quaternion, Vector3 } from "three";
import { AttackMagnetism } from "../src/combat/AttackMagnetism.js";
import {
  MAGNETISM_DEFAULTS,
  MAGNETISM_PARAMETERS,
  MAGNETISM_LIMITS,
  ATTACK_MAGNETISM_STORAGE_KEY,
  sanitizeAttackMagnetism,
  loadMagnetismSettings,
  saveMagnetismSettings,
} from "../src/sandbox/AttackMagnetismSettings.js";
import { createAdaptiveTechniques } from "../src/combat/AdaptiveTechniques.js";
import { StrikeHitDetector } from "../src/combat/StrikeHitDetector.js";
import { ArenaBounds } from "../src/world/ArenaBounds.js";
import { TraversalWorld } from "../src/world/TraversalWorld.js";
import { box } from "../src/world/TraversalGeometry.js";
import { Game } from "../src/core/Game.js";

const close = (a, b, epsilon = 1e-8) =>
  assert.ok(Math.abs(a - b) <= epsilon, `${a} ~= ${b}`);
const target = (id = "enemy", x = 0, y = 0, z = -2) => ({
  id,
  active: true,
  position: new Vector3(x, y, z),
  radius: 0.32,
  strikeHeight: 1.4,
  strikeRadius: 0.27,
});
const fixture = (
  config = {},
  targets = [target()],
  world = new ArenaBounds(100),
) => {
  const technique = createAdaptiveTechniques()[0];
  const controller = {
    root: { position: new Vector3() },
    velocity: new Vector3(),
    heading: 0,
    radius: 0.36,
    world,
    jump: { airborne: false, verticalVelocity: 0 },
    jumpEvent: { sequence: 0 },
    parkour: { attached: false },
    dash: { active: false },
  };
  return {
    magnetism: new AttackMagnetism({ config: { enabled: true, ...config } }),
    controller,
    technique,
    targets,
    world,
    combat: {
      blocking: false,
      attack: {
        active: true,
        cancelled: false,
        sequence: 1,
        techniqueId: technique.id,
        context: { source: "manual", action: "punch" },
      },
    },
  };
};
const begin = (f, options = {}, mode = "combat") =>
  f.magnetism.begin(f.controller, f.targets, f.technique, mode, f.world, {
    accepted: true,
    context: f.combat.attack.context,
    sequence: f.combat.attack.sequence,
    ...options,
  });
const update = (f, dt, options = {}) =>
  f.magnetism.update(dt, f.controller, {
    combat: f.combat,
    world: f.world,
    ...options,
  });

test("magnetism defaults off, saves independently, and sanitizes every control to its hard bounds", () => {
  assert.equal(MAGNETISM_DEFAULTS.enabled, false);
  assert.equal(MAGNETISM_DEFAULTS.maxApproach, 1.25);
  assert.equal(MAGNETISM_LIMITS.maxApproach, 3);
  for (const p of MAGNETISM_PARAMETERS) {
    assert.equal(
      sanitizeAttackMagnetism({ [p.id]: Infinity })[p.id],
      p.default,
    );
    assert.equal(sanitizeAttackMagnetism({ [p.id]: -1e9 })[p.id], p.min);
    assert.equal(sanitizeAttackMagnetism({ [p.id]: 1e9 })[p.id], p.max);
  }
  assert.equal(sanitizeAttackMagnetism({ enabled: "true" }).enabled, false);
  const values = new Map(),
    storage = {
      getItem: (key) => values.get(key),
      setItem: (key, value) => values.set(key, value),
    };
  assert.equal(loadMagnetismSettings(storage), null);
  assert.ok(
    saveMagnetismSettings(storage, {
      enabled: true,
      maxApproach: 90,
      range: -2,
    }),
  );
  assert.equal(values.size, 1);
  assert.equal(loadMagnetismSettings(storage).maxApproach, 3);
  assert.equal(loadMagnetismSettings(storage).range, 0);
  values.set(ATTACK_MAGNETISM_STORAGE_KEY, "invalid json");
  assert.equal(loadMagnetismSettings(storage), null);
  values.set(
    ATTACK_MAGNETISM_STORAGE_KEY,
    JSON.stringify({ version: 1, values: [] }),
  );
  assert.equal(loadMagnetismSettings(storage), null);
  assert.equal(
    saveMagnetismSettings(
      {
        setItem() {
          throw new Error("unavailable");
        },
      },
      {},
    ),
    false,
  );
  const magnetism = new AttackMagnetism(),
    out = {};
  assert.equal(magnetism.snapshot(out), out);
  assert.equal(out.enabled, false);
});

test("disabled magnetism returns the exact existing aim result without target queries or physics changes", () => {
  const f = fixture({ enabled: false }),
    before = f.controller.root.position.clone();
  const context = { source: "manual", action: "punch" },
    legacy = { ...context, punchAim: { legacy: true } };
  let calls = 0;
  const result = Game.prototype.prepareManualAttack.call(
    {
      attackMagnetism: f.magnetism,
      controller: f.controller,
      battle: { mode: "combat", enemies: f.targets },
      input: { move: { x: 1, y: 1 } },
      combat: f.combat,
      punchAim: {
        prepare(ctx, technique) {
          calls++;
          assert.equal(ctx, context);
          assert.equal(technique, f.technique);
          return legacy;
        },
      },
    },
    context,
    f.technique,
  );
  assert.equal(result, legacy);
  assert.equal(calls, 1);
  assert.equal(f.magnetism.queries, 0);
  assert.equal(update(f, 1), 0);
  assert.deepEqual(f.controller.root.position, before);
});

test("proximity and joystick movement remain inert without one accepted manual Punch or Kick", () => {
  for (const options of [
    { accepted: false },
    { context: { source: "enemy" } },
    { context: { source: "manual", canAttack: false } },
    { context: { source: "manual", gesture: "whip-kick" } },
    { blocking: true },
    { input: { blocking: true } },
  ]) {
    const f = fixture();
    assert.equal(begin(f, options), null);
    assert.equal(update(f, 0.5), 0);
    assert.equal(f.magnetism.queries, 0);
    assert.deepEqual(f.controller.root.position, new Vector3());
  }
  const f = fixture();
  for (let n = 0; n < 300; n++)
    update(f, 1 / 60, { input: { move: { x: 0, y: 1 } } });
  assert.equal(f.magnetism.queries, 0);
  assert.deepEqual(f.controller.root.position, new Vector3());
});

test("an accepted strike captures one capped correction and suppresses alignment during flips", () => {
  for (const context of [
    {},
    { rotationActive: true },
    { rotationRate: [8, 0, 0] },
  ]) {
    const f = fixture({ alignment: 1 }, [target("side", 1.3, 0, -0.9)]);
    const velocity = f.controller.velocity.clone(),
      heading = f.controller.heading;
    const orientation = new Quaternion(),
      before = orientation.clone();
    const alignment = begin(f, {
      context: { source: "manual", ...context },
      orientation,
    });
    assert.ok(alignment);
    assert.ok(alignment.angle <= (35 * Math.PI) / 180 + 1e-10);
    if (context.rotationActive || context.rotationRate)
      assert.equal(alignment.angle, 0);
    else close(alignment.angle, (35 * Math.PI) / 180);
    assert.ok(Object.isFrozen(alignment) && Object.isFrozen(alignment.axis));
    assert.deepEqual(orientation, before);
    assert.deepEqual(f.controller.velocity, velocity);
    assert.equal(f.controller.heading, heading);
    f.targets.push(target("closer", 0, 0, -0.8));
    update(f, 0.05);
    assert.equal(f.magnetism.last, alignment);
    assert.equal(f.magnetism.queries, 1);
  }
});

test("manual Punch and Kick install one captured alignment through the existing aim field", () => {
  for (const id of ["basic-punch", "front-kick"]) {
    const f = fixture({}, [target("enemy", 0.3, 0, -1.4)]);
    f.technique = createAdaptiveTechniques().find((t) => t.id === id);
    f.targets[0].strikeHeight = f.technique.originHeight;
    const context = {
      source: "manual",
      action: f.technique.action,
      punchAim: null,
      kickAim: null,
    };
    const result = Game.prototype.prepareManualAttack.call(
      {
        attackMagnetism: f.magnetism,
        controller: f.controller,
        battle: { mode: "combat", enemies: f.targets },
        input: { move: { x: 0, y: 0 } },
        combat: f.combat,
        punchAim: {
          prepare() {
            assert.fail(
              "the independent correction cannot stack onto magnetism",
            );
          },
        },
      },
      context,
      f.technique,
    );
    const field = f.technique.action === "punch" ? "punchAim" : "kickAim";
    assert.equal(result[field], f.magnetism.last);
    assert.equal(result.strikeAim, result[field]);
    assert.equal(f.magnetism.queries, 1);
  }
});

test("an airborne manual strike preserves elevation and vertical velocity and ends its approach on landing", () => {
  const f = fixture({}, [target("enemy", 0, 2, -1.6)]);
  f.technique = createAdaptiveTechniques().find((t) => t.id === "aerial-punch");
  f.combat.attack.techniqueId = f.technique.id;
  f.controller.root.position.y = 2;
  f.controller.velocity.y = 0.8;
  f.controller.jump.airborne = true;
  const velocity = f.controller.velocity.clone();
  assert.ok(begin(f));
  assert.ok(update(f, 0.05) > 0);
  assert.equal(f.controller.root.position.y, 2);
  assert.deepEqual(f.controller.velocity, velocity);
  f.controller.jump.airborne = false;
  const position = f.controller.root.position.clone();
  assert.equal(update(f, 0.05), 0);
  assert.deepEqual(f.controller.root.position, position);
  assert.equal(f.magnetism.active, false);
});

test("assisted approach is continuous, time bounded and never exceeds the per-strike distance budget", () => {
  for (const budget of [0.05, 1.25, 3])
    for (const fps of [30, 60, 144]) {
      const f = fixture(
        { maxApproach: budget, range: 8, approachAcceleration: 100 },
        [target("enemy", 0, 0, -4)],
      );
      f.technique = {
        ...f.technique,
        windup: 0.18,
        extension: 0.16,
        impact: 0.04,
      };
      if (budget < 3) f.targets[0].position.z = -(budget + 0.9);
      assert.ok(begin(f));
      assert.deepEqual(
        f.controller.root.position,
        new Vector3(),
        "begin never moves the player",
      );
      let prior = 0;
      for (let n = 0; n < fps; n++) {
        update(f, 1 / fps);
        const distance = f.controller.root.position.length();
        assert.ok(distance >= prior - 1e-10);
        assert.ok(
          distance - prior <= MAGNETISM_LIMITS.approachSpeed / fps + 1e-8,
        );
        assert.ok(f.magnetism.traveled <= budget + 1e-8);
        prior = distance;
      }
      assert.ok(prior > 0 && prior <= budget + 1e-8);
      assert.ok(
        f.magnetism.elapsed <= MAGNETISM_LIMITS.approachDuration + 1e-8,
      );
      assert.equal(f.magnetism.active, false);
      close(f.magnetism.traveled, prior);
      assert.equal(f.controller.root.position.y, 0);
    }
});

test("high-speed assistance preserves all velocity and heading while rejecting incompatible travel", () => {
  for (const speed of [25, 2500]) {
    const f = fixture({ maxApproach: 3, range: 8, approachAcceleration: 100 });
    f.controller.velocity.set(0, 0, -speed);
    // Match the immediate trajectory; no need to acquire a target far outside the bounded search radius.
    f.technique = { ...f.technique, windup: 0, extension: 0.001, impact: 0.2 };
    const before = f.controller.velocity.clone(),
      heading = f.controller.heading;
    assert.ok(begin(f));
    update(f, 0.2);
    assert.deepEqual(f.controller.velocity, before);
    assert.equal(f.controller.heading, heading);
    assert.ok(
      f.magnetism.traveled <= 0.4 + 1e-8,
      "fast motion adds at most 2 m/s of approach",
    );
  }
  const f = fixture();
  assert.ok(begin(f));
  f.controller.velocity.set(10, 0, 0);
  assert.equal(update(f, 0.1), 0);
  assert.equal(f.magnetism.reason, "travel-intent");
});

test("walls and circular blockers reject occluded targets, including a wall introduced during approach", () => {
  for (const world of [
    new TraversalWorld(100, [], [box("wall", 0, -1, 2, 3, 0.05)]),
    new ArenaBounds(100, [
      { active: true, position: new Vector3(0, 0, -1), radius: 0.3 },
    ]),
  ]) {
    const f = fixture({}, [target()], world);
    assert.equal(begin(f), null);
    assert.equal(update(f, 0.3), 0);
    assert.deepEqual(f.controller.root.position, new Vector3());
  }
  const world = new TraversalWorld(100),
    f = fixture({}, [target()], world);
  assert.ok(begin(f));
  world.structures = [box("new-wall", 0, -1, 2, 3, 0.05)];
  assert.equal(update(f, 0.3), 0);
  assert.equal(f.magnetism.reason, "occluded");
  assert.deepEqual(f.controller.root.position, new Vector3());
});

test("collision recovery cannot turn a tiny assisted step into an unbudgeted position jump", () => {
  const world = {
    move(start, displacement, radius, out) {
      return out
        .copy(start)
        .add(displacement)
        .add(new Vector3(2, 0, 0));
    },
  };
  const f = fixture({}, [target()], world);
  assert.ok(begin(f));
  assert.equal(update(f, 0.1), 0);
  assert.equal(f.magnetism.reason, "collision-recovery");
  assert.deepEqual(f.controller.root.position, new Vector3());
  assert.equal(f.magnetism.traveled, 0);
});

test("Block, Tag, missing or replaced actions, parkour and landing cancel approach immediately", () => {
  for (const interrupt of [
    (f) => {
      f.combat.blocking = true;
    },
    (f) => {
      f.combat.attack.active = false;
    },
    (f) => {
      f.combat.attack.cancelled = true;
    },
    (f) => {
      f.combat.attack.sequence++;
    },
    (f) => {
      f.combat.attack.context.source = "enemy";
    },
    (f) => {
      f.controller.parkour.attached = true;
    },
    (f) => {
      f.controller.jump.airborne = true;
    },
    (f) => {
      f.controller.jumpRequested = true;
    },
  ]) {
    const f = fixture();
    assert.ok(begin(f));
    interrupt(f);
    assert.equal(update(f, 0.1), 0);
    assert.equal(f.magnetism.active, false);
    assert.deepEqual(f.controller.root.position, new Vector3());
  }
  const f = fixture();
  assert.ok(begin(f));
  assert.equal(
    f.magnetism.update(0.1, f.controller),
    0,
    "an old accepted request cannot move without live combat",
  );
  assert.ok(begin(f));
  assert.equal(update(f, 0.1, { mode: "tag" }), 0);
  assert.equal(f.magnetism.active, false);
  assert.equal(begin(f, {}, "tag"), null);
});

test("short target hysteresis prevents tie flicker but sensitivity and deliberate input can switch targets", () => {
  for (const switchSensitivity of [0, 1]) {
    const a = target("a", 0.01),
      b = target("b", -0.12),
      f = fixture({ switchSensitivity }, [a, b]);
    assert.equal(begin(f)?.targetId, "a");
    a.position.x = 0.15;
    b.position.x = -0.01;
    assert.equal(begin(f)?.targetId, switchSensitivity === 0 ? "a" : "b");
    a.position.set(1, 0, -1);
    b.position.set(-1, 0, -1);
    assert.equal(begin(f, { input: { move: { x: -1, y: 0 } } })?.targetId, "b");
  }
});

test("magnetism creates a physical contact opportunity without recording a hit or extending reach", () => {
  const run = (enabled, escaping = false) => {
    const body = target("enemy", 0, 0, -1.2),
      f = fixture({ enabled }, [body]);
    const original = {
      reach: f.technique.reach,
      radius: f.technique.hitRadius,
    };
    const aim = begin(f);
    if (aim)
      f.combat.attack.context = { ...f.combat.attack.context, punchAim: aim };
    const detector = new StrikeHitDetector({ targets: [body] });
    if (escaping) body.position.z = -8;
    for (let n = 0; n < 45; n++) {
      const start = f.controller.root.position.clone(),
        from = n / 240,
        to = (n + 1) / 240;
      update(f, 1 / 240);
      detector.sweep(
        f.technique,
        f.combat.attack,
        from,
        to,
        start,
        f.controller.root.position,
        0,
        0,
      );
    }
    assert.equal(f.technique.reach, original.reach);
    assert.equal(f.technique.hitRadius, original.radius);
    return detector.count;
  };
  assert.equal(run(false), 0);
  assert.equal(run(true), 1);
  assert.equal(run(true, true), 0, "an escaping target can still miss");
});
