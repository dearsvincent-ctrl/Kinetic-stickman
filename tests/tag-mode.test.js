import test from "node:test";
import assert from "node:assert/strict";
import { Group, Vector3 } from "three";
import { BattleWorld } from "../src/combat/BattleWorld.js";
import { ArenaBounds } from "../src/world/ArenaBounds.js";
import { TraversalWorld } from "../src/world/TraversalWorld.js";
import { box } from "../src/world/TraversalGeometry.js";
import { ALL_TRAVERSAL_STRUCTURES } from "../src/world/GeometricWorldLayout.js";
import { ENEMY_LIMITS } from "../src/sandbox/EnemySettings.js";
import { CharacterController } from "../src/movement/CharacterController.js";
import {
  movementSubsteps,
  sandboxMovementConfig,
} from "../src/sandbox/PhysicsSandbox.js";

const near = (a, b, epsilon = 1e-6) =>
  assert.ok(Math.abs(a - b) < epsilon, `${a} ~ ${b}`);
function fixture(world = new ArenaBounds(1000), position = new Vector3()) {
  return new BattleWorld({ playerPosition: position, world, targets: [] });
}
function tick(b, dt = 1 / 60) {
  const steps = b.recommendedSubsteps(dt);
  for (let i = 0; i < steps; i++) {
    b.beginStep(dt / steps, false, 0);
    b.movePlayerImpulse(dt / steps);
    b.endStep(dt / steps, 0);
  }
}
function run(b, duration, dt = 1 / 60) {
  for (let elapsed = 0; elapsed < duration - 1e-9; elapsed += dt)
    tick(b, Math.min(dt, duration - elapsed));
}
function tagFixture(settings = {}, world) {
  const b = fixture(world);
  b.configureTag({ maxEnemies: 1, ...settings });
  assert.equal(b.setMode("tag"), true);
  return b;
}
function placeEnemy(b, point) {
  const e = b.enemies.find((agent) => agent.spawned && agent.body.active);
  assert.ok(e, "A live pooled runner is available");
  e.root.position.copy(point);
  e.body.previousPosition.copy(point);
  e.controller.stop();
  e.controller.velocity.set(0, 0, 0);
  e.body.impulse.set(0, 0, 0);
  e.evasion.reset();
  b.rebuildBodies();
  return e;
}

test("mode changes safely reset encounter AI while preserving independent combat and strength settings", () => {
  const b = fixture();
  assert.equal(b.mode, "combat");
  assert.equal(b.alive, 3);
  b.configureEnemies({ speed: 4, maxEnemies: 12, attackFrequency: 2 });
  b.configureStrength({ attackPower: 2, impact: 3 });
  b.configureTag({ speed: 20, maxEnemies: 5, intelligence: 2 });
  const combat = { ...b.enemySettings },
    strength = { ...b.strength };
  b.enemies[0].combat.requestAttack({ action: "punch", environment: "ground" });
  assert.equal(b.setMode("tag"), true);
  assert.equal(b.mode, "tag");
  assert.equal(b.alive, 5);
  assert.equal(b.tags, 0);
  assert.equal(b.tagTime, 0);
  assert.deepEqual(b.enemySettings, combat);
  assert.deepEqual(b.strength, strength);
  for (const e of b.enemies.filter((agent) => agent.spawned)) {
    assert.equal(e.combat.attack.active, false);
    assert.ok(e.controller.velocity.length() < 1e-9);
  }
  assert.equal(b.setMode("tag"), false);
  assert.equal(b.setMode("future-mode"), false);
  assert.equal(b.setMode("combat"), true);
  assert.equal(b.alive, 12);
  assert.equal(b.wave, 1);
  assert.deepEqual(b.enemySettings, combat);
  assert.deepEqual(b.strength, strength);
  assert.equal(b.tagSettings.speed, 20);
  assert.equal(b.tagSettings.maxEnemies, 5);
});

test("nearby tag runners flee from the player without attacking or causing proximity damage", () => {
  const b = tagFixture({ detection: 40 }),
    e = placeEnemy(b, new Vector3(0, 0, -12));
  const initial = e.root.position.distanceTo(b.player.position),
    health = b.player.health;
  run(b, 1);
  assert.ok(e.root.position.distanceTo(b.player.position) > initial + 1);
  assert.ok(e.controller.velocity.z < 0);
  assert.equal(e.combat.attack.sequence, 0);
  assert.equal(b.damageEvents, 0);
  assert.equal(b.player.health, health);
  assert.ok(b.tagTime >= 0.99 && b.tagTime <= 1.01);
});

test("tag detection distance applies live and idle runners begin escaping when the player approaches", () => {
  const b = tagFixture({ detection: 10 }),
    e = placeEnemy(b, new Vector3(0, 0, -50));
  const initial = e.root.position.clone();
  run(b, 0.25);
  assert.ok(e.root.position.distanceTo(initial) < 1e-6);
  b.configureTag({ detection: 80 });
  run(b, 0.25);
  assert.ok(e.root.position.distanceTo(initial) > 0.1);
  assert.equal(e.combat.attack.active, false);
});

test("escape speed and independent acceleration update live without position or velocity snapping", () => {
  const b = tagFixture(),
    e = placeEnemy(b, new Vector3(0, 0, -12));
  run(b, 0.1);
  const position = e.root.position.clone(),
    velocity = e.controller.velocity.clone();
  b.configureTag({ speed: 100, acceleration: 0.1 });
  assert.deepEqual(e.root.position, position);
  assert.deepEqual(e.controller.velocity, velocity);
  near(e.runSpeed, 360);
  tick(b, 1 / 120);
  assert.ok(e.controller.velocity.length() > velocity.length());
  assert.ok(e.controller.velocity.length() < e.runSpeed);
  const speeds = [];
  for (const acceleration of [0.1, 10]) {
    const trial = tagFixture({ speed: 20, acceleration });
    const runner = placeEnemy(trial, new Vector3(0, 0, -10));
    run(trial, 0.1);
    speeds.push(runner.controller.velocity.length());
  }
  assert.ok(speeds[1] > speeds[0] * 3, JSON.stringify(speeds));
});

test("Tag Mode suppresses pending enemy hits and player attack damage without changing combat multipliers", () => {
  const b = tagFixture(),
    e = placeEnemy(b, new Vector3(0, 0, -0.9));
  b.configureStrength({ attackPower: 100, impact: 100 });
  const health = e.body.health,
    playerHealth = b.player.health;
  const hit = { targetId: e.body.id, source: b.player.position, heading: 0 };
  assert.equal(b.hitEnemy(hit, { action: "kick" }), null);
  assert.equal(e.body.health, health);
  assert.equal(e.body.impulse.length(), 0);
  b.player.invulnerable = 0;
  assert.equal(
    b.hitPlayer(e, { source: e.root.position, heading: Math.PI }),
    null,
  );
  assert.equal(b.player.health, playerHealth);
  assert.equal(b.damageEvents, 0);
  assert.equal(b.defeated, 0);
  assert.equal(b.strength.attackPower, 100);
  assert.equal(b.strength.impact, 100);
});

test("a high-speed crossing counts one tag, deactivates that runner and safely respawns after a delay", () => {
  const b = tagFixture({ speed: 0.25, detection: 2 });
  b.player.position.set(-20, 0, 0);
  b.lastPlayerPosition.copy(b.player.position);
  const e = placeEnemy(b, new Vector3()),
    id = e.body.id,
    wave = b.wave;
  b.beginStep(1 / 60, false, 0);
  b.player.position.set(20, 0, 0);
  b.endStep(1 / 60, 0);
  assert.equal(b.tags, 1);
  assert.equal(e.body.active, false);
  assert.equal(b.alive, 0);
  assert.ok(b.tagFeedback > 0);
  assert.equal(
    b.targets.some((target) => target.id === id),
    false,
  );
  run(b, 0.5);
  assert.equal(b.tags, 1);
  assert.equal(b.alive, 0);
  run(b, 1.7);
  assert.equal(b.tags, 1);
  assert.equal(b.alive, 1);
  assert.notEqual(e.body.id, id);
  assert.ok(e.root.position.distanceTo(b.player.position) > 8);
  assert.equal(b.defeated, 0);
  assert.equal(b.wave, wave, "Tag respawns never advance combat waves");
  assert.equal(b.damageEvents, 0);
});

test("a large tag radius cannot award tags through a nearby solid wall", () => {
  const wall = box("tag-divider", 0, 0, 0.2, 10, 40),
    world = new TraversalWorld(1000, [], [wall]),
    b = tagFixture({ speed: 0.25, detection: 2, tagRadius: 3 }, world);
  b.player.position.set(-0.6, 0, 0);
  b.lastPlayerPosition.copy(b.player.position);
  placeEnemy(b, new Vector3(0.6, 0, 0));
  run(b, 0.1);
  assert.equal(b.tags, 0);
  assert.equal(b.alive, 1);
  assert.equal(b.world.structures[0], wall);
});

test("minimum tag radius is reachable through real collision-resolved movement at ordinary and superhuman speeds", () => {
  for (const fps of [30, 60, 144])
    for (const movement of [1, 20]) {
      const root = new Group(),
        world = new TraversalWorld(1000),
        controller = new CharacterController(root, world),
        b = fixture(world, root.position);
      controller.applyMovementConfig(sandboxMovementConfig({ movement }));
      b.configureTag({
        maxEnemies: 1,
        speed: 0.25,
        detection: 4000,
        tagRadius: 0.75,
      });
      b.setMode("tag");
      placeEnemy(b, new Vector3(0, 0, -8));
      const dt = 1 / fps,
        input = { move: { x: 0, y: 1 }, movementMagnitude: 1 };
      for (let frame = 0; frame < fps * 3 && b.tags === 0; frame++) {
        const count = Math.max(
          movementSubsteps(controller, dt),
          b.recommendedSubsteps(dt),
        );
        for (let step = 0; step < count && b.tags === 0; step++) {
          b.beginStep(dt / count, false, controller.heading);
          controller.update(dt / count, input, 0);
          b.endStep(dt / count, controller.heading);
        }
      }
      assert.equal(
        b.tags,
        1,
        `${fps}Hz, ${movement}x movement physically reaches the minimum tag radius`,
      );
      assert.equal(b.alive, 0);
      assert.equal(b.damageEvents, 0);
    }
});

test("live Tag tuning does not skip a tagged runner's removal delay or carry stale tags into Combat", () => {
  const b = tagFixture({ speed: 0.25, detection: 2 });
  b.player.position.set(-20, 0, 0);
  b.lastPlayerPosition.copy(b.player.position);
  placeEnemy(b, new Vector3());
  b.beginStep(1 / 60, false, 0);
  b.player.position.set(20, 0, 0);
  b.endStep(1 / 60, 0);
  assert.equal(b.tags, 1);
  b.configureTag({ speed: 20, acceleration: 3, intelligence: 2 });
  run(b, 0.25);
  assert.equal(b.alive, 0, "A slider change must not bypass the respawn delay");
  b.setMode("combat");
  assert.equal(b.alive, 3);
  run(b, 2.1);
  assert.equal(b.tags, 0);
  assert.equal(b.mode, "combat");
  assert.equal(
    b.alive,
    3,
    "Old Tag timers must not add enemies to a combat wave",
  );
  b.setMode("tag");
  assert.equal(b.tags, 0);
  assert.equal(b.alive, 1);
});

test("reducing the Tag population cancels removed runners' pending respawns without awarding extra tags", () => {
  const b = tagFixture({ maxEnemies: 3, speed: 0.25, detection: 2 });
  const runners = b.enemies.filter((e) => e.spawned && e.body.active);
  runners[0].root.position.set(100, 0, 0);
  runners[1].root.position.set(120, 0, 0);
  runners[2].root.position.set(0, 0, 0);
  for (const e of runners) {
    e.body.previousPosition.copy(e.root.position);
    e.controller.stop();
    e.evasion.reset();
  }
  b.player.position.set(-20, 0, 0);
  b.lastPlayerPosition.copy(b.player.position);
  b.beginStep(1 / 60, false, 0);
  b.player.position.set(20, 0, 0);
  b.endStep(1 / 60, 0);
  assert.equal(b.tags, 1);
  assert.equal(runners[2].body.active, false);
  b.configureTag({ maxEnemies: 1 });
  run(b, 2.2);
  assert.equal(b.alive, 1);
  assert.equal(b.tags, 1);
  assert.equal(runners[2].spawned, false);
});

test("Tag and Combat population changes remain isolated, bounded and reversible", () => {
  const b = fixture();
  b.configureTag({ maxEnemies: 6 });
  assert.equal(b.alive, 3, "Inactive Tag tuning does not fill a combat wave");
  b.setMode("tag");
  assert.equal(b.alive, 6);
  b.configureEnemies({ maxEnemies: 24, speed: 50 });
  assert.equal(b.alive, 6, "Inactive pursuit settings do not resize Tag Mode");
  b.configureTag({ maxEnemies: 10000 });
  assert.equal(b.tagSettings.maxEnemies, ENEMY_LIMITS.population);
  assert.equal(b.alive, ENEMY_LIMITS.population);
  assert.ok(b.enemies.length <= ENEMY_LIMITS.population);
  b.configureTag({ maxEnemies: 2 });
  assert.equal(b.alive, 2);
  assert.equal(b.tags, 0);
  assert.equal(b.defeated, 0);
  b.setMode("combat");
  assert.equal(b.alive, 24);
  assert.equal(b.enemySettings.speed, 50);
  assert.equal(b.tagSettings.maxEnemies, 2);
});

test("Tag runners spawn outside the geometric world and away from the player at city, jungle and arena corners", () => {
  for (const position of [
    new Vector3(-100, 0, -90),
    new Vector3(115, 0, -90),
    new Vector3(999.6, 0, 999.6),
    new Vector3(-999.6, 0, -999.6),
  ]) {
    const world = new TraversalWorld(1000, [], ALL_TRAVERSAL_STRUCTURES),
      b = fixture(world, position);
    b.configureTag({ maxEnemies: 8 });
    b.setMode("tag");
    assert.equal(b.alive, 8);
    const runners = b.enemies.filter((e) => e.spawned && e.body.active);
    for (let i = 0; i < runners.length; i++) {
      const e = runners[i];
      assert.ok(world.isSpaceFree(e.root.position, e.body.radius, 1.8));
      assert.ok(e.root.position.distanceTo(b.player.position) >= 8.4);
      for (let j = i + 1; j < runners.length; j++)
        assert.ok(e.root.position.distanceTo(runners[j].root.position) >= 1.9);
    }
  }
});

test("extreme Tag crowds remain finite and collision-bounded with a capped simulation budget", () => {
  const wall = box("escape-wall", 12, 0, 1, 10, 80),
    world = new TraversalWorld(1000, [], [wall]),
    b = fixture(world);
  b.configureTag({
    maxEnemies: 64,
    speed: 100,
    acceleration: 100,
    intelligence: 2,
    detection: 4000,
  });
  b.setMode("tag");
  run(b, 0.5);
  assert.equal(b.alive, 64);
  assert.equal(b.damageEvents, 0);
  for (const e of b.enemies.filter(
    (agent) => agent.spawned && agent.body.active,
  )) {
    assert.ok(
      [
        ...e.root.position,
        ...e.controller.velocity,
        ...e.root.quaternion,
      ].every(Number.isFinite),
    );
    assert.ok(Math.abs(e.root.position.x) <= 999.68 + 1e-5);
    assert.ok(Math.abs(e.root.position.z) <= 999.68 + 1e-5);
    assert.ok(world.isSpaceFree(e.root.position, e.body.radius - 1e-5, 1.8));
    assert.equal(e.controller.parkour, null);
    assert.equal(e.combat.attack.sequence, 0);
    assert.ok(e.controller.velocity.length() <= e.runSpeed + 1e-5);
  }
  assert.ok(b.recommendedSubsteps(1 / 60) <= ENEMY_LIMITS.maxSubsteps);
});

test("returning to Combat restores timed enemy strikes, damage and ordinary wave progression", () => {
  const b = fixture();
  b.configureTag({ speed: 100, maxEnemies: 1 });
  b.setMode("tag");
  run(b, 0.1);
  b.setMode("combat");
  assert.equal(b.alive, 3);
  const e = b.enemies[0];
  for (const other of b.enemies) {
    if (other === e) continue;
    other.spawned = other.body.active = false;
  }
  e.root.position.set(0, 0, -0.86);
  e.controller.stop();
  e.controller.heading = Math.PI;
  e.cooldown = 0;
  b.player.invulnerable = 0;
  b.rebuildBodies();
  run(b, 0.7);
  assert.ok(e.combat.attack.sequence > 0);
  assert.ok(b.damageEvents > 0);
  near(e.runSpeed, 3.6);
  e.body.receive({ damage: 1000, source: b.player.position });
  run(b, 2.6);
  assert.equal(b.wave, 2);
  assert.equal(b.alive, 3);
});

test("invalid step inputs and disabled practice mode cannot corrupt Tag state or spawn an encounter", () => {
  const b = tagFixture();
  const before = b.snapshot();
  for (const dt of [0, -1, NaN, Infinity]) {
    b.beginStep(dt, false, 0);
    b.endStep(dt, 0);
    assert.equal(b.recommendedSubsteps(dt), 1);
  }
  assert.deepEqual(b.snapshot(), before);
  const practice = new BattleWorld({
    playerPosition: new Vector3(),
    world: new ArenaBounds(1000),
    targets: [],
    enabled: false,
  });
  practice.configureTag({ maxEnemies: 64, speed: 100 });
  practice.setMode("tag");
  run(practice, 0.2);
  assert.equal(practice.alive, 0);
  assert.equal(practice.tags, 0);
  assert.equal(practice.recommendedSubsteps(1 / 60), 1);
});
