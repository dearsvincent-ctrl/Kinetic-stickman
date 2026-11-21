import test from "node:test";
import assert from "node:assert/strict";
import { Vector3, Scene, PerspectiveCamera } from "three";
import { BattleWorld } from "../src/combat/BattleWorld.js";
import { TraversalWorld } from "../src/world/TraversalWorld.js";
import { box, pole } from "../src/world/TraversalGeometry.js";
import { calculateImpact, IMPACT_LIMITS } from "../src/combat/ImpactModel.js";
import { EnemyViews } from "../src/character/EnemyViews.js";
import {
  REACTION_DEFAULTS,
  REACTION_PARAMETERS,
  sanitizeReactions,
  saveReactions,
  loadReactions,
} from "../src/sandbox/ReactionSettings.js";
const near = (a, b, e = 1e-6) => assert.ok(Math.abs(a - b) < e, `${a} ~ ${b}`);
function fixture({ half = 10000, structures = [], profile = "standard" } = {}) {
  const world = new TraversalWorld(half, [], structures);
  const b = new BattleWorld({
    playerPosition: new Vector3(),
    world,
    targets: [],
  });
  b.configureEnemies({ maxEnemies: 1, speed: 0.1, attackFrequency: 0 });
  const e = b.enemies.find((e) => e.spawned);
  e.setProfile(b.enemyProfiles[profile]);
  e.spawn(new Vector3(0, 0, -5), 1, 100);
  return { b, e, world };
}
function hit(
  f,
  { action = "punch", power = 0, impact = 1, height = 1.36, style } = {},
) {
  f.b.configureStrength({ attackPower: power, impact });
  return f.b.hitEnemy(
    {
      targetId: f.e.body.id,
      source: new Vector3(0, 0, 0),
      targetPosition: f.e.root.position.clone(),
      point: f.e.root.position.clone().add(new Vector3(0, height, 0)),
      heading: 0,
    },
    { action, strikeStyle: style },
  );
}
function run(f, seconds, dt = 1 / 60) {
  for (let t = 0; t < seconds - 1e-8; t += dt) {
    f.b.beginStep(Math.min(dt, seconds - t), false, 0);
    f.b.endStep(Math.min(dt, seconds - t), 0);
    assert.ok(
      [
        ...f.e.root.position,
        ...f.e.reaction.velocity,
        ...f.e.reaction.orientation,
      ].every(Number.isFinite),
    );
    assert.ok(f.e.root.position.y >= 0);
    near(f.e.reaction.orientation.length(), 1, 1e-6);
  }
}
test("v090 defaults are independent, ordered, finite and use a separate versioned save", () => {
  const c = sanitizeReactions({
    knockdown: 3,
    stagger: 8,
    ragdoll: 2,
    intensity: Infinity,
  });
  assert.equal(c.knockdown, 8);
  assert.equal(c.ragdoll, 8);
  assert.equal(c.intensity, 1);
  for (const p of REACTION_PARAMETERS) {
    const v = sanitizeReactions({ [p.id]: 1e20 });
    assert.ok(v[p.id] <= p.max);
  }
  let raw = null;
  const s = { getItem: () => raw, setItem: (_, x) => (raw = x) };
  assert.ok(saveReactions(s, { launch: 5 }));
  assert.equal(loadReactions(s).launch, 5);
  raw = "broken";
  assert.equal(loadReactions(s), null);
  assert.equal(loadReactions(null), null);
});
test("v090 physical impact has bounded relative-speed input, real direction and location independent of visual gain", () => {
  const args = {
    hit: {
      source: new Vector3(),
      targetPosition: new Vector3(0, 0, -1),
      point: new Vector3(0, 1.8, -1),
      direction: { x: 1, z: 0 },
    },
    technique: { action: "kick" },
    damage: 28,
    knockback: 4.2,
    sourceVelocity: new Vector3(1e9, 0, 0),
    targetVelocity: new Vector3(),
    settings: REACTION_DEFAULTS,
  };
  const a = calculateImpact({}, args),
    b = calculateImpact(
      {},
      { ...args, settings: sanitizeReactions({ intensity: 0 }) },
    );
  near(a.force, b.force);
  assert.equal(b.visual, 0);
  assert.equal(a.location, "head");
  assert.equal(a.x, 1);
  assert.ok(a.force < 8);
  assert.ok(a.force <= IMPACT_LIMITS.velocity);
  const heavy = calculateImpact(
    {},
    { ...args, profile: { mass: 2.5, knockbackResistance: 4 } },
  );
  near(a.force / heavy.force, 10);
});
test("v090 normal hits stay procedural and head/body/leg reactions differ without automatic ragdolls", () => {
  for (const [height, location] of [
    [1.8, "head"],
    [1.36, "body"],
    [0.5, "leg"],
  ]) {
    const f = fixture();
    hit(f, { height });
    assert.equal(f.e.reaction.location, location);
    assert.equal(f.e.reaction.phase, "recoil");
    assert.equal(f.e.reaction.ragdoll, false);
    run(f, 0.1);
    assert.ok(f.e.body.stagger > 0);
  }
});
test("v090 heavier force stumbles, knockdown falls, launch stays controlled when ragdoll is disabled", () => {
  const heavy = fixture();
  hit(heavy, { action: "kick", impact: 2 });
  assert.equal(heavy.e.reaction.phase, "stumble");
  const down = fixture();
  hit(down, { action: "kick", impact: 3 });
  assert.equal(down.e.reaction.phase, "knockdown");
  run(down, 0.2);
  assert.equal(down.e.reaction.phase, "fallen");
  assert.equal(down.e.reaction.landings, 0);
  const flight = fixture();
  flight.b.configureReactions({ ragdollEnabled: false });
  hit(flight, { action: "kick", impact: 20 });
  assert.equal(flight.e.reaction.phase, "flight");
  assert.equal(flight.e.reaction.ragdoll, false);
  run(flight, 0.2);
  assert.ok(flight.e.root.position.y > 1);
});
test("v090 extreme strikes travel ballistically over large distances, land once and recover alive", () => {
  const f = fixture();
  hit(f, { action: "kick", impact: 100 });
  assert.equal(f.e.reaction.ragdoll, true);
  const vy = f.e.reaction.velocity.y;
  run(f, 1);
  near(f.e.root.position.y, vy - 9, 0.01);
  assert.ok(f.e.root.position.z < -300);
  run(f, 8);
  assert.equal(f.e.reaction.landings, 1);
  assert.equal(f.e.reaction.phase, "idle");
  assert.ok(f.e.body.active);
  near(f.e.root.position.y, 0, 0.001);
  f.b.player.position.copy(f.e.root.position).add(new Vector3(0, 0, 8));
  run(f, 0.4);
  assert.ok(["Approach", "Position", "Idle"].includes(f.e.state));
});
test("v090 swept launches collide with a wall, rooftop, column and arena without tunnelling", () => {
  for (const structure of [
    box("wall", 0, -20, 20, 30, 1),
    pole("column", 0, -20, 3, 40),
  ]) {
    const f = fixture({ half: 60, structures: [structure] });
    f.b.configureReactions({ launch: 0.3 });
    hit(f, { action: "kick", impact: 100 });
    run(f, 1);
    assert.ok(f.e.root.position.z > -20);
    assert.ok(f.e.reaction.collisions > 0);
    assert.equal(f.e.body.health, 72);
  }
  const f = fixture({ half: 40 });
  hit(f, { action: "kick", impact: 100 });
  run(f, 5);
  assert.ok(Math.abs(f.e.root.position.z) <= 40);
  assert.ok(f.e.reaction.velocity.length() <= IMPACT_LIMITS.velocity);
});
test("v090 collision damage starts off, applies only on real contacts and counts defeat once", () => {
  const f = fixture({ structures: [box("wall", 0, -15, 30, 40, 1)] });
  f.b.configureReactions({ collisionDamage: 5, launch: 0.2 });
  hit(f, { action: "kick", impact: 100 });
  run(f, 0.8);
  assert.equal(f.e.body.active, false);
  assert.equal(f.b.defeated, 1);
  const prior = f.b.defeated;
  run(f, 0.4);
  assert.equal(f.b.defeated, prior);
});
test("v090 rig angular constraints, fixed lengths and true head hitbox stay aligned during flight and recovery", () => {
  const f = fixture();
  const views = new EnemyViews(new Scene(), f.b.enemies),
    camera = new PerspectiveCamera();
  hit(f, { action: "kick", impact: 30 });
  const view = views.views[f.e.index],
    point = new Vector3();
  try {
    for (let n = 0; n < 400; n++) {
      run(f, 1 / 60);
      views.update(1 / 60, camera, f.e.root.position);
      if (!f.e.reaction.ownsMotion) continue;
      view.character.root.updateMatrixWorld(true);
      view.character.joints.head.getWorldPosition(point);
      const b = f.e.body.hitboxes[2];
      assert.ok(
        point.distanceTo(
          new Vector3(
            f.e.root.position.x + b.x,
            f.e.root.position.y + b.height,
            f.e.root.position.z + b.z,
          ),
        ) < 0.015,
      );
      for (const side of ["left", "right"]) {
        const a = view.character.joints[side + "Hip"].getWorldPosition(
            new Vector3(),
          ),
          k = view.character.joints[side + "Knee"].getWorldPosition(
            new Vector3(),
          );
        near(a.distanceTo(k), 0.44, 1e-6);
        assert.ok(view.character.joints[side + "Knee"].rotation.x >= 0);
        assert.ok(view.character.joints[side + "Knee"].rotation.x <= 2.25);
      }
    }
  } finally {
    views.dispose();
  }
});
test("v090 light presentation never accumulates additive offsets between throttled animator updates", () => {
  const f = fixture();
  const views = new EnemyViews(new Scene(), f.b.enemies),
    camera = new PerspectiveCamera();
  hit(f);
  try {
    for (let i = 0; i < 120; i++) {
      run(f, 1 / 120);
      views.update(1 / 120, camera, new Vector3(100, 0, 0));
      assert.ok(
        Math.abs(views.views[f.e.index].character.joints.spine.rotation.x) <
          1.2,
      );
    }
  } finally {
    views.dispose();
  }
});
test("v090 landing, rotation and recovery remain stable at 30/60/120/144 Hz", () => {
  const samples = [30, 60, 120, 144].map((hz) => {
    const f = fixture();
    hit(f, { action: "kick", impact: 20 });
    run(f, 0.4, 1 / hz);
    return f.e.root.position.clone();
  });
  for (const p of samples) assert.ok(p.distanceTo(samples[0]) < 0.15);
});
test("v090 zero impact does not add a launch, heavy mass resists more and profile recovery is configurable", () => {
  const zero = fixture();
  hit(zero, { power: 100, impact: 0 });
  assert.equal(zero.e.reaction.phase, "knockdown");
  assert.equal(zero.e.body.impulse.length(), 0);
  run(zero, 0.3);
  near(zero.e.root.position.y, 0, 0.001);
  const a = fixture(),
    b = fixture({ profile: "heavy" });
  hit(a, { impact: 20 });
  hit(b, { impact: 20 });
  assert.ok(a.e.reaction.force > b.e.reaction.force * 5);
  const fast = fixture();
  fast.b.configureReactions({ recovery: 5 });
  hit(fast, { action: "kick", impact: 3 });
  run(fast, 1);
  assert.equal(fast.e.reaction.phase, "idle");
});
test("v090 Tag mode suppresses damage/reactions and switching or spawning clears all transient state", () => {
  const f = fixture();
  hit(f, { impact: 20 });
  assert.ok(f.e.reaction.active);
  f.b.setMode("tag");
  assert.equal(f.e.reaction.active, false);
  assert.equal(hit(f, { impact: 100 }), null);
  run(f, 0.2);
  assert.equal(f.e.body.health, f.e.body.maxHealth);
  f.b.setMode("combat");
  assert.equal(f.e.reaction.phase, "idle");
});

test("v090 descending launches land on real roofs and upward launches stop at undersides", () => {
  const roof = box("roof", 0, -200, 200, 3, 180);
  const f = fixture({ structures: [roof] });
  f.e.spawn(new Vector3(0, 3, -130), 1, 100);
  hit(f, { action: "kick", impact: 10 });
  run(f, 4);
  assert.equal(f.e.reaction.landings, 1);
  near(f.e.root.position.y, 3, 0.002);
  assert.equal(f.e.reaction.phase, "idle");
  const ceiling = fixture({
    structures: [box("ceiling", 0, -5, 200, 1, 200, false, 5)],
  });
  hit(ceiling, { action: "kick", impact: 10 });
  run(ceiling, 1);
  assert.ok(ceiling.e.root.position.y < 3.06);
  assert.ok(ceiling.e.reaction.collisions >= 1);
  assert.equal(ceiling.e.body.health, 72);
});

test("v090 a repeated launch preserves current pose and existing momentum before adding the new impulse", () => {
  const f = fixture();
  hit(f, { action: "kick", impact: 20 });
  run(f, 0.15);
  const pose = f.e.reaction.orientation.clone(),
    velocity = f.e.reaction.velocity.clone();
  const joints = Array.from(f.e.reaction.jointAngles);
  hit(f, { action: "punch", impact: 20 });
  assert.ok(f.e.reaction.orientation.angleTo(pose) < 1e-7);
  assert.deepEqual(Array.from(f.e.reaction.jointAngles), joints);
  assert.ok(f.e.reaction.velocity.z < velocity.z);
  assert.equal(f.e.reaction.sequence, 2);
  run(f, 6);
  assert.ok(f.e.body.active);
});

test("v090 downward and sideways strike sweeps determine the physical launch, never source-to-root magnetism", () => {
  for (const direction of [new Vector3(1, 0, 0), new Vector3(0, -1, 0)]) {
    const f = fixture();
    f.e.spawn(new Vector3(0, 10, -5), 1, 100);
    f.b.configureStrength({ attackPower: 0, impact: 20 });
    f.b.hitEnemy(
      {
        targetId: f.e.body.id,
        source: new Vector3(),
        targetPosition: f.e.root.position.clone(),
        point: f.e.root.position.clone().add(new Vector3(0, 1.5, 0)),
        direction,
      },
      { action: "kick" },
    );
    if (direction.x) {
      assert.ok(f.e.reaction.velocity.x > 80);
      near(f.e.reaction.velocity.z, 0);
    } else {
      assert.ok(f.e.reaction.velocity.y < -10);
      near(f.e.reaction.velocity.x, 0);
      near(f.e.reaction.velocity.z, 0);
    }
    run(f, 0.1);
  }
});

test("v090 detailed angular simulation is bounded for a large impacted crowd without dropping physical motion", () => {
  const f = fixture();
  f.b.configureEnemies({ maxEnemies: 64, speed: 0.1, attackFrequency: 0 });
  for (const [i, e] of f.b.enemies.entries()) {
    if (!e.spawned) continue;
    e.spawn(new Vector3((i % 8) * 3, 0, -5 - Math.floor(i / 8) * 3), 1, 100);
    hit({ ...f, e }, { impact: 20 });
  }
  run(f, 0.1);
  const impacted = f.b.enemies.filter(
    (e) => e.spawned && e.reaction.ownsMotion,
  );
  assert.ok(impacted.length > 8);
  assert.ok(impacted.filter((e) => e.reaction.detail).length <= 8);
  for (const e of impacted) {
    assert.ok(e.root.position.y > 0);
    assert.ok(e.reaction.velocity.length() <= IMPACT_LIMITS.velocity);
    near(e.reaction.orientation.length(), 1);
  }
});

test("v090 dying reactions respect corpse lifetime, wave progression and pooled spawn reset", () => {
  const f = fixture();
  hit(f, { power: 100, impact: 20 });
  assert.equal(f.e.body.active, false);
  assert.equal(f.b.defeated, 1);
  run(f, 4);
  assert.ok(f.b.wave >= 2);
  const live = f.b.enemies.find((e) => e.spawned && e.body.active);
  assert.ok(live);
  assert.equal(live.reaction.phase, "idle");
  assert.equal(live.reaction.sequence, 0);
  assert.equal(live.body.hitboxes, live.reaction.restBoxes);
});

test("v090 rendered running pose carries into a severe reaction instead of resetting its joints to neutral", () => {
  const f = fixture(),
    views = new EnemyViews(new Scene(), f.b.enemies),
    camera = new PerspectiveCamera();
  try {
    f.e.controller.speed = 5;
    f.e.controller.velocity.set(0, 0, -5);
    views.update(0.1, camera, f.e.root.position);
    const view = views.views[f.e.index],
      before = view.character.joints.leftHip.rotation.x;
    hit(f, { action: "kick", impact: 20 });
    views.update(0, camera, f.e.root.position);
    near(view.character.joints.leftHip.rotation.x, before);
    run(f, 0.016);
    views.update(0.016, camera, f.e.root.position);
    assert.ok(
      Math.abs(view.character.joints.leftHip.rotation.x - before) < 0.2,
    );
  } finally {
    views.dispose();
  }
});

test("v090 swept hits track a rotating body's offset contact sphere once per strike without inflating reach", async () => {
  const { CombatController } = await import(
    "../src/combat/CombatController.js"
  );
  const { createManualTechniques } = await import(
    "../src/combat/ManualTechniques.js"
  );
  const { StrikeHitDetector } = await import(
    "../src/combat/StrikeHitDetector.js"
  );
  const combat = new CombatController({ techniques: createManualTechniques() }),
    technique = combat.techniques.get("basic-punch");
  const target = {
    id: "rotated",
    active: true,
    position: new Vector3(0, 0, 0),
    previousPosition: new Vector3(0, 0, 0),
    hitboxes: [
      {
        x: 1.2,
        z: 0,
        previousX: 1.2,
        previousZ: 0,
        height: 1.4,
        previousHeight: 1.4,
        radius: 0.2,
        part: "head",
      },
    ],
  };
  const attack = { active: true, sequence: 1 },
    detector = new StrikeHitDetector({ targets: [target] });
  detector.sweep(
    technique,
    attack,
    0.1,
    0.116,
    new Vector3(0, 0, 5),
    new Vector3(0, 0, -5),
    0,
    0,
  );
  assert.equal(
    detector.count,
    0,
    "An old standing hitbox cannot receive a ghost hit",
  );
  for (let i = 0; i < 3; i++)
    detector.sweep(
      technique,
      attack,
      0.1,
      0.116,
      new Vector3(1.2, 0, 5),
      new Vector3(1.2, 0, -5),
      0,
      0,
    );
  assert.equal(
    detector.count,
    1,
    "Actual displaced head is swept once despite extreme relative travel",
  );
  assert.equal(detector.lastContact.location, "head");
  assert.ok(detector.lastContact.direction.z < 0);
});

test("v090 small subsequent speed contacts cannot erase a severe ongoing ragdoll", () => {
  const f = fixture();
  hit(f, { impact: 20 });
  run(f, 0.1);
  assert.equal(f.e.reaction.ragdoll, true);
  hit(f, { impact: 0.1 });
  assert.equal(f.e.reaction.ragdoll, true);
  assert.equal(f.e.reaction.phase, "flight");
  f.b.configureReactions({ ragdollEnabled: false });
  assert.equal(f.e.reaction.ragdoll, false);
  assert.equal(f.e.reaction.phase, "flight");
});

test("v090 narrow wall-side knockdowns stay supported, keep all sampled joints above ground and recover", () => {
  const f = fixture({ structures: [box("adjacent-wall", 1, -10, 1, 12, 40)] });
  hit(f, { action: "kick", impact: 3 });
  let constrained = false;
  for (let i = 0; i < 120; i++) {
    run(f, 1 / 120);
    if (!f.e.reaction.ownsMotion) continue;
    constrained ||= f.e.reaction.constrained;
    const points = f.e.reaction.skeleton.sample(
      f.e.reaction,
      f.e.controller.heading,
    );
    for (const [name, point] of Object.entries(points)) {
      const world = point.clone().add(f.e.root.position);
      assert.ok(
        world.y >= -0.001,
        `${name} below supporting floor: ${world.y}`,
      );
      assert.ok(world.x < 0.56, `${name} entered adjacent wall: ${world.x}`);
    }
  }
  assert.ok(constrained);
  run(f, 2);
  assert.equal(f.e.reaction.phase, "idle");
});

test("v090 profile reaction sliders represent all default archetype values exactly on their step grid", async () => {
  const { ENEMY_ABILITY_PARAMETERS, DEFAULT_ENEMY_PROFILES } = await import(
    "../src/sandbox/EnemyAbilities.js"
  );
  for (const id of ["mass", "balance", "recovery"]) {
    const p = ENEMY_ABILITY_PARAMETERS.find((p) => p.id === id);
    for (const profile of Object.values(DEFAULT_ENEMY_PROFILES)) {
      const steps = (profile[id] - p.min) / p.step;
      near(steps, Math.round(steps));
    }
  }
});

test("v090 a survivor skidding off a roof waits for genuine support before getting up", () => {
  const f = fixture({ structures: [box("small-roof", 0, -30, 8, 20, 8)] });
  f.e.spawn(new Vector3(0, 20, -33), 1, 100);
  hit(f, { action: "kick", impact: 4 });
  run(f, 0.9);
  assert.ok(f.e.root.position.y > 1 && f.e.root.position.y < 20);
  assert.ok(f.e.reaction.velocity.y < 0);
  assert.notEqual(f.e.reaction.phase, "recover");
  assert.notEqual(f.e.reaction.phase, "idle");
  run(f, 4);
  assert.equal(f.e.reaction.phase, "idle");
  near(f.e.root.position.y, 0, 0.001);
});
