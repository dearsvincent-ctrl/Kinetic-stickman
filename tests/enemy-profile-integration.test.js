import test from "node:test";
import assert from "node:assert/strict";
import { Vector3 } from "three";
import { BattleWorld } from "../src/combat/BattleWorld.js";
import { DAMAGE_CONFIG } from "../src/combat/Combatant.js";
import { TraversalWorld } from "../src/world/TraversalWorld.js";
import { box } from "../src/world/TraversalGeometry.js";
import { sandboxMovementConfig } from "../src/sandbox/PhysicsSandbox.js";

const near = (a, b, epsilon = 1e-6) =>
  assert.ok(Math.abs(a - b) < epsilon, `${a} ≈ ${b}`);
const live = (b) => b.enemies.filter((e) => e.spawned && e.body.active);
const types = (b) => live(b).map((e) => e.profile.id);
const sortedTypes = (b) => types(b).sort();
const fixture = (world = new TraversalWorld(1000), position = new Vector3()) =>
  new BattleWorld({ playerPosition: position, world, targets: [] });

test("global population tuning cannot revive a completed custom wave or a defeated player's encounter", () => {
  for (const active of [true, false]) {
    const b = fixture();
    b.configureRoster("combat", { heavy: 1 });
    for (const e of live(b))
      e.body.receive({ damage: 1000, source: b.player.position });
    b.player.active = active;
    const wave = b.wave;
    b.configureEnemies({ maxEnemies: 7 });
    assert.equal(b.alive, 0);
    assert.equal(b.wave, wave);
    assert.equal(b.enemySettings.maxEnemies, 7);
  }
});
function tick(b, dt = 1 / 60) {
  const count = b.recommendedSubsteps(dt);
  for (let i = 0; i < count; i++) {
    b.beginStep(dt / count, false, 0);
    b.movePlayerImpulse(dt / count);
    b.endStep(dt / count, 0);
  }
}
function run(b, seconds, dt = 1 / 60) {
  for (let left = seconds; left > 1e-9; ) {
    const step = Math.min(left, dt);
    tick(b, step);
    left -= step;
  }
}
function place(e, p) {
  e.controller.stop();
  e.root.position.copy(p);
  e.body.previousPosition.copy(p);
  e.body.impulse.set(0, 0, 0);
  e.body.invulnerable = 0;
  e.controller.jump.land(p.y);
}
function solo(id, mode = "combat") {
  const b = fixture();
  b.configureRoster(mode, { [id]: 1 });
  if (mode !== b.mode) b.setMode(mode);
  return { b, e: live(b)[0] };
}

test("legacy populations remain Standard unless an explicit mode roster is selected", () => {
  const b = fixture();
  assert.deepEqual(b.enemyRosters, { combat: null, tag: null });
  assert.deepEqual(types(b), ["standard", "standard", "standard"]);
  assert.equal(b.wave, 1);
  b.configureEnemies({ maxEnemies: 6 });
  assert.equal(b.alive, 6);
  assert.ok(types(b).every((id) => id === "standard"));
  b.configureTag({ maxEnemies: 4 });
  b.setMode("tag");
  assert.equal(b.alive, 4);
  assert.ok(types(b).every((id) => id === "standard"));
});

test("Combat and Tag accept independent mixed or single-archetype rosters", () => {
  const b = fixture();
  b.configureEnemies({ maxEnemies: 8 });
  b.configureTag({ maxEnemies: 8 });
  b.configureRoster("combat", { standard: 1, acrobat: 1, leaper: 1, heavy: 1 });
  assert.deepEqual(types(b), ["standard", "acrobat", "leaper", "heavy"]);
  b.configureRoster("tag", { leaper: 3 });
  assert.deepEqual(types(b), ["standard", "acrobat", "leaper", "heavy"]);
  b.setMode("tag");
  assert.deepEqual(types(b), ["leaper", "leaper", "leaper"]);
  b.configureRoster("tag", { acrobat: 2, heavy: 1 });
  assert.deepEqual(sortedTypes(b), ["acrobat", "acrobat", "heavy"]);
  b.setMode("combat");
  assert.deepEqual(types(b), ["standard", "acrobat", "leaper", "heavy"]);
});

test("explicit rosters respect independent global population caps without overwriting them", () => {
  const b = fixture();
  b.configureEnemies({ maxEnemies: 5, speed: 2 });
  b.configureTag({ maxEnemies: 4, speed: 3 });
  const combat = { ...b.enemySettings },
    tag = { ...b.tagSettings };
  b.configureRoster("combat", { leaper: 20, heavy: 20 });
  assert.equal(b.alive, 5);
  assert.deepEqual(sortedTypes(b), [
    "heavy",
    "heavy",
    "leaper",
    "leaper",
    "leaper",
  ]);
  b.configureRoster("tag", { acrobat: 32, leaper: 32 });
  b.setMode("tag");
  assert.equal(b.alive, 4);
  assert.deepEqual(sortedTypes(b), ["acrobat", "acrobat", "leaper", "leaper"]);
  assert.deepEqual(b.enemySettings, combat);
  assert.deepEqual(b.tagSettings, tag);
  assert.ok(b.enemies.length <= 64);
});

test("empty custom rosters pause encounters and returning to legacy controls restores populations", () => {
  const b = fixture();
  b.configureRoster("combat", {});
  assert.equal(b.alive, 0);
  const wave = b.wave;
  run(b, 5.5);
  assert.equal(b.wave, wave, "No endless empty-wave progression");
  b.configureRoster("tag", {});
  b.setMode("tag");
  run(b, 2.2);
  assert.equal(b.alive, 0);
  assert.equal(b.tags, 0);
  b.configureRoster("tag", null);
  assert.equal(b.alive, b.tagSettings.maxEnemies);
  b.configureRoster("combat", null);
  b.setMode("combat");
  assert.equal(b.alive, 3);
});

test("global speed and acceleration multiply each archetype without importing player physics", () => {
  const { b, e } = solo("leaper");
  const profile = { ...e.profile };
  b.configureEnemies({ speed: 2, acceleration: 3 });
  near(e.runSpeed, profile.runSpeed * 2);
  near(
    e.controller.config.analogue.accelerationResponse,
    profile.acceleration * 3,
  );
  near(
    e.controller.config.analogue.decelerationResponse,
    profile.deceleration * 3,
  );
  near(e.controller.jump.config.height, profile.jumpHeight);
  assert.equal(e.controller.jump.config.maxJumps, profile.maxJumps);
  const player = sandboxMovementConfig({
    jumpHeight: 100,
    gravity: 100,
    airControl: 100,
  });
  assert.notEqual(player.jump.height, e.controller.jump.config.height);
  b.configureTag({ speed: 4, acceleration: 0.5 });
  b.configureRoster("tag", { leaper: 1 });
  b.setMode("tag");
  const runner = live(b)[0];
  near(runner.runSpeed, profile.runSpeed * 4);
  near(
    runner.controller.config.analogue.accelerationResponse,
    profile.acceleration * 0.5,
  );
  near(runner.controller.jump.config.height, profile.jumpHeight);
  assert.deepEqual(b.enemySettings.speed, 2);
});

test("live profile edits retain actual pose, velocity, jump counts, health and independent settings", () => {
  const { b, e } = solo("leaper");
  place(e, new Vector3(20, 8, -10));
  e.controller.velocity.set(3, 0, -4);
  e.controller.jump.phase = "airborne";
  e.controller.jump.height = 8;
  e.controller.jump.verticalVelocity = 4;
  e.controller.jump.jumpCount = 2;
  e.body.health = 50;
  const p = e.root.position.clone(),
    velocity = e.controller.velocity.clone();
  const combat = { ...b.enemySettings },
    tag = { ...b.tagSettings };
  b.configureProfile("leaper", {
    runSpeed: 25,
    acceleration: 30,
    deceleration: 35,
    turnRate: 18,
    jumpHeight: 120,
    airControl: 20,
    maxJumps: 2,
  });
  assert.deepEqual(e.root.position, p);
  assert.deepEqual(e.controller.velocity, velocity);
  near(e.controller.jump.verticalVelocity, 4);
  assert.equal(e.controller.jump.jumpCount, 2);
  near(e.controller.jump.config.height, 120);
  assert.equal(e.body.health, 50);
  near(e.runSpeed, 25);
  assert.deepEqual(b.enemySettings, combat);
  assert.deepEqual(b.tagSettings, tag);
  assert.equal(b.enemyProfiles.standard.runSpeed, 3.6);
});

test("individual launch physics give Leaper a genuinely higher continuous jump and permit its second jump", () => {
  const peaks = {};
  const neutral = { move: { x: 0, y: 0 }, movementMagnitude: 0 };
  for (const id of ["standard", "leaper"]) {
    const { e } = solo(id),
      c = e.controller;
    assert.ok(c.requestJump(neutral, 0));
    let peak = 0,
      last = c.root.position.clone(),
      groundedAfterFlight = false,
      airborne = false;
    for (let frame = 0; frame < 1800; frame++) {
      c.update(1 / 120, neutral, 0);
      peak = Math.max(peak, c.root.position.y);
      assert.ok(
        c.root.position.distanceTo(last) < 1,
        "Continuous ballistic travel",
      );
      assert.ok(
        [...c.root.position, c.jump.verticalVelocity].every(Number.isFinite),
      );
      last.copy(c.root.position);
      airborne ||= c.jump.airborne;
      if (airborne && c.jump.grounded) {
        groundedAfterFlight = true;
        break;
      }
    }
    assert.ok(groundedAfterFlight);
    near(peak, e.profile.jumpHeight, 0.03);
    peaks[id] = peak;
  }
  assert.ok(peaks.leaper > peaks.standard * 20);
  const { e } = solo("leaper"),
    c = e.controller;
  c.requestJump(neutral, 0);
  c.update(0.3, neutral, 0);
  assert.ok(c.jump.airborne);
  c.requestJump(neutral, 0);
  c.update(1 / 120, neutral, 0);
  assert.equal(c.jump.jumpCount, 2);
  assert.ok(c.jump.verticalVelocity > c.jump.launchVelocity * 0.98);
  assert.equal(c.requestJump(neutral, 0), false);
});

test("advanced traversal is enabled only for capable profiles and can be edited live", () => {
  for (const id of ["standard", "heavy"]) {
    const { e } = solo(id);
    assert.equal(e.controller.parkour, null);
  }
  for (const id of ["acrobat", "leaper"]) {
    const { b, e } = solo(id);
    assert.ok(e.controller.parkour);
    b.configureProfile(id, {
      climb: false,
      wallRun: false,
      ledgeGrab: false,
      rooftop: false,
    });
    assert.equal(e.controller.parkour, null);
    b.configureProfile(id, {
      climb: true,
      wallRun: true,
      ledgeGrab: true,
      rooftop: true,
    });
    assert.ok(e.controller.parkour);
  }
});

test("Heavy attack damage scales independently from its incoming knockback resistance", () => {
  const values = {};
  for (const id of ["standard", "heavy"]) {
    const { b, e } = solo(id);
    b.player.invulnerable = 0;
    const result = b.hitPlayer(e, {
      source: new Vector3(0, 0, -1),
      heading: 0,
    });
    assert.ok(result);
    near(result.damage, DAMAGE_CONFIG.enemyPunchDamage * e.profile.damage);
    b.configureStrength({ attackPower: 0.25, impact: 20 });
    e.body.invulnerable = 0;
    e.body.impulse.set(0, 0, 0);
    const contact = b.hitEnemy(
      {
        targetId: e.body.id,
        source: e.root.position.clone().add(new Vector3(-1, 0, 0)),
      },
      { action: "punch" },
    );
    assert.ok(contact);
    values[id] = {
      damage: contact.damage,
      impulse: e.body.impulse.length(),
      profile: e.profile,
    };
  }
  near(values.standard.damage, values.heavy.damage);
  near(
    values.standard.impulse / values.heavy.impulse,
    values.heavy.profile.knockbackResistance * values.heavy.profile.mass,
  );
  assert.ok(values.heavy.profile.damage > values.standard.profile.damage);
});

test("mixed Combat waves retain enabled archetypes and still count real damage defeats", () => {
  const b = fixture();
  b.configureRoster("combat", { acrobat: 2, heavy: 1 });
  b.configureStrength({ attackPower: 100, impact: 0 });
  for (const e of live(b)) {
    const result = b.hitEnemy(
      { targetId: e.body.id, source: b.player.position },
      { action: "kick" },
    );
    assert.ok(result?.defeated);
  }
  assert.equal(b.defeated, 3);
  run(b, 2.6);
  assert.equal(b.wave, 2);
  assert.equal(b.alive, 3);
  assert.deepEqual(sortedTypes(b), ["acrobat", "acrobat", "heavy"]);
});

test("a tagged mixed-roster runner respawns as its selected archetype after the delay", () => {
  const b = fixture();
  b.configureTag({ maxEnemies: 4, speed: 0.25, detection: 2 });
  b.configureRoster("tag", { acrobat: 1, leaper: 1 });
  b.setMode("tag");
  const [acrobat, leaper] = live(b);
  place(acrobat, new Vector3(100, 0, 100));
  place(leaper, new Vector3());
  const id = leaper.body.id;
  b.player.position.set(-20, 0, 0);
  b.lastPlayerPosition.copy(b.player.position);
  b.beginStep(1 / 60, false, 0);
  b.player.position.set(20, 0, 0);
  b.endStep(1 / 60, 0);
  assert.equal(b.tags, 1);
  assert.equal(leaper.spawned, false);
  run(b, 0.5);
  assert.equal(leaper.spawned, false);
  run(b, 1.7);
  assert.equal(leaper.spawned, true);
  assert.notEqual(leaper.body.id, id);
  assert.equal(leaper.profile.id, "leaper");
  assert.deepEqual(types(b), ["acrobat", "leaper"]);
  assert.equal(b.damageEvents, 0);
});

test("pooled aerial opponents clear obsolete elevation and jump allowance on a new ground spawn", () => {
  const { e } = solo("leaper", "tag");
  e.root.position.set(10, 150, -10);
  e.controller.jump.height = 150;
  e.controller.jump.floorHeight = 80;
  e.controller.jump.landingFloor = 80;
  e.controller.jump.phase = "airborne";
  e.controller.jump.verticalVelocity = -35;
  e.controller.jump.jumpCount = 2;
  e.controller.airDashesUsed = 1;
  e.spawn(new Vector3(25, 0, -25), 1, 10000);
  assert.deepEqual(e.root.position, new Vector3(25, 0, -25));
  near(e.controller.jump.height, 0);
  near(e.controller.jump.floorHeight, 0);
  near(e.controller.jump.verticalVelocity, 0);
  assert.equal(e.controller.jump.jumpCount, 0);
  assert.equal(e.controller.airDashesUsed, 0);
  assert.ok(e.controller.jump.grounded);
  assert.equal(e.profile.id, "leaper");
});

test("airborne and physically wall-attached opponents remain taggable", () => {
  for (const attached of [false, true]) {
    const world = new TraversalWorld(
      1000,
      [],
      attached ? [box("tag-wall", 0, 0, 20, 20, 2)] : [],
    );
    const b = fixture(world, new Vector3(50, 0, 50));
    b.configureTag({ maxEnemies: 1, speed: 1, detection: 2 });
    b.configureRoster("tag", { leaper: 1 });
    b.setMode("tag");
    const e = live(b)[0];
    place(e, new Vector3(0, 0, 3));
    if (attached) {
      const input = { move: { x: 0, y: 1 }, movementMagnitude: 1 };
      for (
        let frame = 0;
        frame < 240 &&
        !(e.controller.parkour.attached && e.root.position.y > 4);
        frame++
      )
        e.controller.update(1 / 120, input, 0);
      assert.ok(e.controller.parkour.attached && e.root.position.y > 4);
    } else {
      e.controller.requestJump();
      for (let frame = 0; frame < 60; frame++)
        e.controller.update(
          1 / 120,
          { move: { x: 0, y: 0 }, movementMagnitude: 0 },
          0,
        );
      assert.ok(e.controller.jump.airborne && e.root.position.y > 4);
    }
    b.player.position.copy(e.root.position).add(new Vector3(0.72, 0, 0));
    b.lastPlayerPosition.copy(b.player.position);
    b.rebuildBodies();
    b.beginStep(1 / 240, false, 0);
    b.endStep(1 / 240, 0);
    assert.equal(
      b.tags,
      1,
      attached ? "Wall contact can tag" : "Air contact can tag",
    );
    assert.equal(b.damageEvents, 0);
  }
});

test("resetting profile defaults restores live attributes without altering mode settings or saved rosters", () => {
  const { b, e } = solo("heavy");
  const combat = { ...b.enemySettings },
    tag = { ...b.tagSettings },
    rosters = structuredClone(b.enemyRosters);
  const speed = e.profile.runSpeed,
    height = e.profile.jumpHeight;
  b.configureProfile("heavy", {
    runSpeed: 20,
    jumpHeight: 250,
    damage: 5,
    knockbackResistance: 50,
  });
  assert.equal(e.profile.runSpeed, 20);
  b.resetProfiles();
  near(e.profile.runSpeed, speed);
  near(e.controller.jump.config.height, height);
  assert.deepEqual(b.enemySettings, combat);
  assert.deepEqual(b.tagSettings, tag);
  assert.deepEqual(b.enemyRosters, rosters);
});
