import test from "node:test";
import assert from "node:assert/strict";
import { Vector3, Scene, PerspectiveCamera } from "three";
import { BattleWorld, WAVE_CONFIG } from "../src/combat/BattleWorld.js";
import { ArenaBounds } from "../src/world/ArenaBounds.js";
import { TraversalWorld } from "../src/world/TraversalWorld.js";
import { box } from "../src/world/TraversalGeometry.js";
import { EnemyViews } from "../src/character/EnemyViews.js";
import {
  DEFAULT_ENEMY_SETTINGS,
  ENEMY_LIMITS,
  sanitizeEnemySettings,
  loadEnemySettings,
  saveEnemySettings,
  ENEMY_SETTINGS_KEY,
} from "../src/sandbox/EnemySettings.js";
import {
  SANDBOX_STORAGE_KEY,
  savePhysics,
  loadPhysics,
} from "../src/sandbox/PhysicsSandbox.js";
const near = (a, b, e = 1e-6) => assert.ok(Math.abs(a - b) < e, `${a} ~ ${b}`);
function fixture(world = new ArenaBounds(1000)) {
  const b = new BattleWorld({
    playerPosition: new Vector3(),
    world,
    targets: [],
  });
  b.player.maxHealth = b.player.health = 1e8;
  b.player.invulnerable = 0;
  return b;
}
function tick(b, dt = 1 / 60, block = false) {
  const n = b.recommendedSubsteps(dt);
  for (let i = 0; i < n; i++) {
    b.beginStep(dt / n, block, 0);
    b.movePlayerImpulse(dt / n);
    b.endStep(dt / n, 0);
  }
}
function run(b, time, dt = 1 / 60) {
  for (let t = 0; t < time - 1e-9; t += dt) tick(b, Math.min(dt, time - t));
}
function lone(b, position = new Vector3(0, 0, -100)) {
  for (const e of b.enemies) {
    e.spawned = e.body.active = false;
  }
  const e = b.enemies[0];
  e.spawn(position, 1, 1000);
  b.rebuildBodies();
  return e;
}

test("enemy defaults preserve baseline cruise/acceleration, three starters and the eight-enemy wave cap", () => {
  const b = fixture();
  assert.equal(b.alive, 3);
  assert.equal(b.enemies.length, 8);
  assert.equal(b.enemySettings, DEFAULT_ENEMY_SETTINGS);
  near(b.enemies[0].runSpeed, 3.6);
  near(b.enemies[0].controller.config.analogue.accelerationResponse, 11);
  b.wave = 40;
  b.spawnWave();
  assert.equal(b.alive, 8);
});
test("finite independent numerical bounds, integer populations and detection hysteresis survive invalid input", () => {
  for (const invalid of [NaN, Infinity, -Infinity, "100", null])
    assert.equal(sanitizeEnemySettings({ speed: invalid }).speed, 1);
  const c = sanitizeEnemySettings({
    speed: 1e8,
    acceleration: 0,
    maxEnemies: 10000,
    aggression: -20,
    attackFrequency: 0,
    detection: 4000,
    disengagement: 4,
  });
  assert.equal(c.speed, 1000);
  assert.equal(c.acceleration, 0.1);
  assert.equal(c.maxEnemies, 64);
  assert.equal(c.aggression, 0);
  assert.equal(c.attackFrequency, 0);
  assert.ok(c.disengagement >= c.detection + 2);
  assert.ok(Object.isFrozen(c));
  assert.equal(sanitizeEnemySettings({ maxEnemies: 12.6 }).maxEnemies, 13);
});
test("enemy save/load is independent of player physics and safely rejects unavailable/outdated data", () => {
  const data = new Map(),
    storage = {
      getItem: (k) => data.get(k),
      setItem: (k, v) => data.set(k, v),
    };
  savePhysics(storage, { movement: 20 });
  assert.ok(saveEnemySettings(storage, { speed: 100, maxEnemies: 32 }));
  assert.equal(loadEnemySettings(storage).speed, 100);
  assert.equal(loadPhysics(storage).movement, 20);
  assert.ok(data.has(SANDBOX_STORAGE_KEY) && data.has(ENEMY_SETTINGS_KEY));
  for (const raw of ["{", "null", '{"version":99,"values":{}}']) {
    data.set(ENEMY_SETTINGS_KEY, raw);
    assert.equal(loadEnemySettings(storage), null);
  }
  assert.equal(saveEnemySettings(null, {}), false);
  assert.equal(
    loadEnemySettings({
      getItem() {
        throw Error();
      },
    }),
    null,
  );
});
test("live speed/acceleration updates retain position, velocity, damage, wave and current immutable attack", () => {
  const b = fixture(),
    e = lone(b, new Vector3(0, 0, -0.86));
  e.controller.heading = Math.PI;
  e.cooldown = 0;
  tick(b);
  assert.ok(e.combat.attack.active);
  const technique = e.combat.currentTechnique,
    elapsed = e.combat.attack.elapsed,
    p = e.root.position.clone();
  e.controller.velocity.set(2, 0, 1);
  e.body.health = 33;
  b.configureEnemies({ speed: 100, acceleration: 4, attackFrequency: 5 });
  assert.deepEqual(e.root.position, p);
  assert.deepEqual(e.controller.velocity, new Vector3(2, 0, 1));
  assert.equal(e.body.health, 33);
  assert.equal(b.wave, 1);
  assert.equal(e.combat.currentTechnique, technique);
  assert.equal(e.combat.attack.elapsed, elapsed);
  near(e.runSpeed, 360);
  near(e.controller.config.analogue.accelerationResponse, 44);
});
test("population changes preserve survivors and kill credit, grow a bounded reusable pool and retain moving target lists", () => {
  const b = fixture();
  b.enemies[0].body.health = 31;
  const id = b.enemies[0].body.id;
  b.configureEnemies({ maxEnemies: 24 });
  assert.equal(b.alive, 24);
  assert.equal(b.enemies[0].body.id, id);
  assert.equal(b.enemies[0].body.health, 31);
  assert.equal(b.targets.length, 24);
  assert.equal(new Set(b.targets.map((t) => t.id)).size, 24);
  b.configureEnemies({ maxEnemies: 2 });
  assert.equal(b.alive, 2);
  assert.equal(b.defeated, 0);
  assert.equal(b.targets.length, 2);
  b.configureEnemies({ maxEnemies: 64 });
  assert.equal(b.alive, 64);
  assert.equal(b.enemies.length, 64);
  b.configureEnemies({ maxEnemies: 200 });
  assert.equal(b.enemies.length, 64);
  assert.equal(b.alive, 64);
  b.configureEnemies(DEFAULT_ENEMY_SETTINGS, { resetPopulation: true });
  assert.equal(b.alive, 3);
  assert.equal(b.enemies[0].body.health, 31);
});
test("acceleration and braking are live smooth physical responses rather than position or velocity teleports", () => {
  const speeds = [];
  for (const acceleration of [0.3, 5]) {
    const b = fixture();
    b.configureEnemies({
      speed: 20,
      acceleration,
      attackFrequency: 0,
      detection: 1000,
    });
    const e = lone(b);
    const p = e.root.position.clone();
    tick(b, 1 / 120);
    assert.ok(e.root.position.distanceTo(p) > 0);
    assert.ok(e.controller.velocity.length() < e.runSpeed);
    run(b, 0.1);
    speeds.push(e.controller.velocity.length());
    const v = e.controller.velocity.length();
    b.player.active = false;
    tick(b, 1 / 120);
    assert.ok(
      e.controller.velocity.length() < v && e.controller.velocity.length() > 0,
    );
  }
  assert.ok(speeds[1] > speeds[0] * 2);
});
test("superhuman pursuit exceeds normal player sprint multipliers and catches a fast moving player without proximity damage", () => {
  const b = fixture();
  b.configureEnemies({
    speed: 500,
    acceleration: 4,
    aggression: 2,
    attackFrequency: 0,
    detection: 4000,
    disengagement: 5000,
  });
  b.player.position.x = -500;
  const e = lone(b, new Vector3(-900, 0, 0));
  b.lastPlayerPosition.copy(b.player.position);
  let peak = 0;
  for (let i = 0; i < 180; i++) {
    b.player.position.x = Math.min(850, b.player.position.x + 450 / 60);
    tick(b);
    peak = Math.max(peak, e.controller.velocity.length());
  }
  assert.ok(peak > 600, `Peak ${peak}`);
  run(b, 4);
  assert.ok(e.root.position.distanceTo(b.player.position) < 2.5);
  assert.equal(b.damageEvents, 0);
});
test("arrival braking avoids endless high-speed orbits and recovers after abrupt target reversals", () => {
  const b = fixture();
  b.configureEnemies({
    speed: 100,
    acceleration: 3,
    attackFrequency: 0,
    detection: 2000,
    aggression: 1.5,
  });
  const e = lone(b);
  b.player.position.z = 150;
  run(b, 0.25);
  const heading = e.controller.heading;
  b.player.position.z = -300;
  tick(b, 1 / 120);
  const delta = Math.atan2(
    Math.sin(e.controller.heading - heading),
    Math.cos(e.controller.heading - heading),
  );
  assert.ok(Math.abs(delta) <= e.controller.facingTurnRate / 120 + 1e-6);
  run(b, 6);
  assert.ok(e.root.position.distanceTo(b.player.position) < 2.6);
  assert.ok(e.controller.velocity.length() < 0.3);
});
test("detection/disengagement have hysteresis, persistence follows aggression, and enemies reacquire", () => {
  for (const aggression of [0, 3]) {
    const b = fixture();
    b.configureEnemies({
      aggression,
      attackFrequency: 0,
      detection: 30,
      disengagement: 50,
    });
    const e = lone(b);
    run(b, 0.2);
    assert.equal(e.alerted, false);
    b.player.position.copy(e.root.position).add(new Vector3(0, 0, 20));
    tick(b);
    assert.ok(e.alerted);
    b.player.position.copy(e.root.position).add(new Vector3(0, 0, 40));
    run(b, 0.15);
    assert.ok(e.alerted);
    b.player.position.copy(e.root.position).add(new Vector3(0, 0, 200));
    run(b, 0.6);
    assert.equal(e.alerted, aggression > 0);
    run(b, 3);
    assert.equal(e.alerted, false);
    b.player.position.copy(e.root.position).add(new Vector3(0, 0, 20));
    tick(b);
    assert.ok(e.alerted);
  }
});
test("attack frequency scales explicit windup/recovery and permits zero without enabling proximity damage", () => {
  const counts = [];
  for (const frequency of [0, 0.5, 3]) {
    const b = fixture();
    b.configureEnemies({ attackFrequency: frequency });
    const e = lone(b, new Vector3(0, 0, -0.86));
    e.controller.heading = Math.PI;
    e.cooldown = 0;
    run(b, 7);
    counts.push(e.combat.attack.sequence);
    if (frequency === 0) assert.equal(b.damageEvents, 0);
    else assert.ok(b.damageEvents > 0);
  }
  assert.equal(counts[0], 0);
  assert.ok(counts[2] > counts[1] * 2, JSON.stringify(counts));
});
test("custom population survives respawn and waves, with no fake deaths or forced encounter reset", () => {
  const b = fixture();
  b.configureEnemies({ maxEnemies: 12, speed: 20, attackFrequency: 0 });
  for (const e of b.enemies)
    if (e.spawned) e.body.receive({ damage: 1000, source: b.player.position });
  run(b, WAVE_CONFIG.delay + 0.05);
  assert.equal(b.wave, 2);
  assert.equal(b.alive, 12);
  near(b.enemies[0].runSpeed, 3.68 * 20);
  b.reset();
  assert.equal(b.wave, 1);
  assert.equal(b.alive, 12);
  assert.equal(b.enemySettings.speed, 20);
});
test("64 pursuers remain separated, finite and bounded with cached neighborhood queries", () => {
  const b = fixture();
  b.configureEnemies({
    maxEnemies: 64,
    speed: 20,
    acceleration: 4,
    attackFrequency: 0,
    detection: 1000,
  });
  run(b, 2);
  for (let i = 0; i < b.enemies.length; i++) {
    const a = b.enemies[i];
    assert.ok(
      [...a.root.position, ...a.controller.velocity].every(Number.isFinite),
    );
    assert.ok(
      a.steering.queries < 65,
      `Unbounded neighborhood work ${a.steering.queries}`,
    );
    for (let j = i + 1; j < b.enemies.length; j++)
      assert.ok(a.root.position.distanceTo(b.enemies[j].root.position) > 0.6);
  }
  assert.ok(b.recommendedSubsteps(1 / 60) <= ENEMY_LIMITS.maxSubsteps);
});
test("experimental spawn populations are separate and outside the player even at arena corners", () => {
  const b = fixture();
  for (const x of [-999.6, 999.6])
    for (const z of [-999.6, 999.6]) {
      b.player.position.set(x, 0, z);
      b.configureEnemies({ maxEnemies: 64 });
      b.spawnWave();
      assert.equal(b.alive, 64);
      for (const e of b.enemies)
        assert.ok(e.root.position.distanceTo(b.player.position) > 8.4);
      for (let i = 0; i < 64; i++)
        for (let j = i + 1; j < 64; j++)
          assert.ok(
            b.enemies[i].root.position.distanceTo(b.enemies[j].root.position) >=
              2 - 1e-6,
          );
    }
});
test("extreme enemy speed cannot tunnel through authored structures or activate player-only parkour", () => {
  const wall = box("wall", 0, 0, 2000, 20, 2),
    world = new TraversalWorld(1000, [], [wall]),
    b = fixture(world);
  b.configureEnemies({
    speed: 1000,
    acceleration: 100,
    attackFrequency: 0,
    detection: 4000,
  });
  b.player.position.z = 100;
  const e = lone(b, new Vector3(0, 0, -100));
  run(b, 2);
  assert.ok(e.root.position.z <= -1 - e.body.radius + 1e-5);
  assert.equal(e.controller.parkour, null);
  assert.equal(b.world.structures.length, 1);
  b.configureEnemies({ maxEnemies: 16 });
  b.reset();
  assert.equal(b.world.structures.length, 1);
});
test("pursuit remains stable across frame rates at the maximum sandbox multipliers", () => {
  const positions = [];
  for (const dt of [1 / 30, 1 / 60, 1 / 120]) {
    const b = fixture();
    b.configureEnemies({
      speed: 1000,
      acceleration: 100,
      aggression: 3,
      attackFrequency: 0,
      detection: 4000,
    });
    const e = lone(b, new Vector3(-900, 0, -900));
    b.player.position.set(850, 0, 850);
    run(b, 3, dt);
    assert.ok(
      [
        ...e.root.position,
        ...e.controller.velocity,
        ...e.root.quaternion,
      ].every(Number.isFinite),
    );
    assert.ok(
      Math.abs(e.root.position.x) <= 999.68 &&
        Math.abs(e.root.position.z) <= 999.68,
    );
    positions.push(e.root.position.clone());
  }
  assert.ok(positions[0].distanceTo(positions[2]) < 0.1);
});
test("crowd presentation grows live, limits detailed rigs and retains health indicators in four instanced meshes", () => {
  const b = fixture(),
    scene = new Scene(),
    v = new EnemyViews(scene, b.enemies),
    camera = new PerspectiveCamera();
  b.configureEnemies({ maxEnemies: 64 });
  const p = b.enemies[0].root.position.clone();
  v.update(1 / 60, camera, b.player.position);
  assert.equal(v.views.length, 64);
  assert.equal(
    v.views.filter((view) => view.agent.root.visible).length,
    ENEMY_LIMITS.fullRigs,
  );
  assert.equal(v.crowd.heads.count, 64 - ENEMY_LIMITS.fullRigs);
  assert.equal(v.crowd.fills.count, 64 - ENEMY_LIMITS.fullRigs);
  assert.equal(v.crowd.group.children.length, 4);
  assert.deepEqual(b.enemies[0].root.position, p);
  for (const m of v.crowd.group.children)
    assert.ok([...m.instanceMatrix.array].every(Number.isFinite));
  assert.equal(
    v.views[0].character.resources.ivory,
    v.views[63].character.resources.ivory,
  );
  v.dispose();
});
test("isolated practice never gains enemies from developer settings or waves", () => {
  const b = new BattleWorld({
    playerPosition: new Vector3(),
    world: new ArenaBounds(1000),
    targets: [],
    enabled: false,
  });
  b.configureEnemies({ maxEnemies: 64, speed: 1000 });
  run(b, 1);
  assert.equal(b.alive, 0);
  assert.equal(b.recommendedSubsteps(1 / 60), 1);
});

test("fast pursuit still needs visible attack windup/contact, and facing Block remains defensive", () => {
  const damage = [];
  for (const blocking of [false, true]) {
    const b = fixture();
    b.configureEnemies({
      speed: 100,
      acceleration: 10,
      attackFrequency: 2,
      detection: 1000,
    });
    const e = lone(b, new Vector3(0, 0, -60));
    for (let i = 0; i < 8; i++) tick(b, 1 / 120, blocking);
    assert.equal(
      b.damageEvents,
      0,
      "Passing/approaching alone cannot apply damage",
    );
    for (let i = 0; i < 360; i++) tick(b, 1 / 120, blocking);
    assert.ok(e.combat.attack.sequence > 0);
    assert.ok(b.damageEvents > 0);
    if (blocking) assert.ok(b.blockEvents > 0);
    damage.push(b.player.maxHealth - b.player.health);
  }
  assert.ok(damage[1] < damage[0]);
});
test("invalid external step values cannot contaminate prediction, wave timers or physics", () => {
  const b = fixture();
  const prior = b.snapshot();
  for (const dt of [0, -1, NaN, Infinity]) {
    b.beginStep(dt, false, 0);
    b.endStep(dt, 0);
    assert.equal(b.recommendedSubsteps(dt), 1);
  }
  assert.deepEqual(b.snapshot(), prior);
  assert.ok([...b.playerVelocity].every(Number.isFinite));
});

test("tuning pursuit or attack rate never replenishes defeated enemies in an unfinished wave", () => {
  const b = fixture(),
    e = b.enemies[0];
  while (e.body.active)
    b.hitEnemy(
      { targetId: e.body.id, source: b.player.position },
      { action: "kick" },
    );
  assert.equal(b.alive, 2);
  assert.equal(b.defeated, 1);
  b.configureEnemies({ speed: 20, attackFrequency: 2 });
  assert.equal(b.alive, 2);
  assert.equal(b.defeated, 1);
  assert.equal(e.body.health, 0);
  b.configureEnemies({ maxEnemies: 8, acceleration: 5 });
  assert.equal(b.alive, 2);
});

test("re-enabling enemy attacks after a chase-only spawn does not inherit a fictitious zero-frequency delay", () => {
  const b = fixture();
  b.configureEnemies({ attackFrequency: 0 });
  const e = lone(b, new Vector3(0, 0, -0.86));
  e.controller.heading = Math.PI;
  run(b, 0.1);
  assert.equal(e.combat.attack.sequence, 0);
  b.configureEnemies({ attackFrequency: 2 });
  run(b, 0.3);
  assert.ok(e.combat.attack.active);
  assert.equal(e.combat.attack.sequence, 1);
});

test("faster enemies maintain striking distance with continuously moving superhuman players at default and boosted acceleration", () => {
  for (const [speed, target, time, acceleration] of [
    [50, 104, 5, 1],
    [200, 520, 3, 1],
    [500, 450, 3, 4],
  ]) {
    const b = fixture();
    b.configureEnemies({
      speed,
      acceleration,
      aggression: 2,
      attackFrequency: 0,
      detection: 4000,
      disengagement: 5000,
    });
    b.player.position.x = -800;
    b.lastPlayerPosition.copy(b.player.position);
    const e = lone(b, new Vector3(-950, 0, 0));
    let lateMax = 0;
    for (let f = 0; f < 60 * time; f++) {
      const n = b.recommendedSubsteps(1 / 60),
        dt = 1 / 60 / n;
      for (let i = 0; i < n; i++) {
        b.beginStep(dt, false, 0);
        b.player.position.x += target * dt;
        b.endStep(dt, 0);
      }
      if (f >= 60 * (time - 0.5))
        lateMax = Math.max(
          lateMax,
          e.root.position.distanceTo(b.player.position),
        );
    }
    assert.ok(lateMax < 3, `${speed}x peak trailing distance ${lateMax}`);
    assert.ok(e.controller.velocity.x > target * 0.9);
    assert.equal(b.damageEvents, 0);
  }
});

test("moving high-speed punches and kicks retain pursuit momentum and still require actual active contacts", () => {
  const b = fixture();
  b.configureEnemies({
    speed: 200,
    acceleration: 2,
    aggression: 2,
    attackFrequency: 2,
    detection: 4000,
  });
  b.player.position.x = -800;
  b.lastPlayerPosition.copy(b.player.position);
  const e = lone(b, new Vector3(-950, 0, 0));
  let movingAttack = false,
    kick = false;
  for (let f = 0; f < 180; f++) {
    const n = b.recommendedSubsteps(1 / 60),
      dt = 1 / 60 / n;
    for (let i = 0; i < n; i++) {
      b.beginStep(dt, false, 0);
      b.player.position.x += 520 * dt;
      b.endStep(dt, 0);
      if (e.combat.attack.active) {
        movingAttack ||= e.controller.velocity.x > 400;
        kick ||= e.combat.currentTechnique.action === "kick";
      }
    }
  }
  assert.ok(movingAttack);
  assert.ok(kick);
  assert.ok(
    b.damageEvents > 0,
    "Swept active strike windows can hit the moving player",
  );
  assert.ok(e.root.position.distanceTo(b.player.position) < 3);
});

test("an underpowered pursuer cannot gain hidden speed or magnetise itself onto a faster player", () => {
  const b = fixture();
  b.configureEnemies({ speed: 20, attackFrequency: 0, detection: 4000 });
  b.player.position.x = -800;
  b.lastPlayerPosition.copy(b.player.position);
  const e = lone(b, new Vector3(-950, 0, 0));
  let peak = 0;
  for (let f = 0; f < 180; f++) {
    const n = b.recommendedSubsteps(1 / 60),
      dt = 1 / 60 / n;
    for (let i = 0; i < n; i++) {
      b.beginStep(dt, false, 0);
      b.player.position.x += 104 * dt;
      b.endStep(dt, 0);
      peak = Math.max(peak, e.controller.velocity.length());
    }
  }
  assert.ok(e.root.position.distanceTo(b.player.position) > 200);
  assert.ok(peak <= e.runSpeed + 1e-6);
  assert.ok(peak > e.runSpeed * 0.95);
  assert.equal(b.damageEvents, 0);
});

test("default pursuit retains the v0.8.1 close-range footwork and contact/Block outcome", () => {
  // Recorded from the released v0.8.1 controller, not derived from the new
  // steering formula. This catches subtle combat regressions before a browser
  // fight rather than merely checking that an enemy moves toward a target.
  const b = new BattleWorld({
    playerPosition: new Vector3(),
    world: new ArenaBounds(1000),
    targets: [],
    dummy: {
      id: "dummy",
      position: new Vector3(0, 0, -2.5),
      radius: 0.32,
      height: 2,
    },
  });
  b.player.maxHealth = b.player.health = 1e8;
  for (let f = 0; f < 900; f++) tick(b, 1 / 60, f > 300);
  const recorded = [
    [0.6897898958748307, 0, -0.39970757087947184],
    [-1.7602213231431318, 0, 0.017041931395653083],
    [0.8972807591301021, 0, -2.1473525708766696],
  ];
  for (let i = 0; i < 3; i++)
    assert.ok(
      b.enemies[i].root.position.distanceTo(new Vector3(...recorded[i])) <
        0.002,
    );
  assert.equal(b.damageEvents, 10);
  near(b.player.health, 99999914.75);
});
