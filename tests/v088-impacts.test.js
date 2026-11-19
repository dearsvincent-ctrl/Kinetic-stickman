import test from "node:test";
import assert from "node:assert/strict";
import { Vector3 } from "three";
import { SpeedImpact, SPEED_IMPACT_LIMITS } from "../src/combat/SpeedImpact.js";
import { Combatant } from "../src/combat/Combatant.js";
import { TraversalWorld } from "../src/world/TraversalWorld.js";
import { box } from "../src/world/TraversalGeometry.js";

const v = (x = 0, y = 0, z = 0) => new Vector3(x, y, z);
const close = (actual, expected, tolerance = 1e-7) =>
  assert.ok(Math.abs(actual - expected) < tolerance, `${actual} ~ ${expected}`);

function fixture(positions = [v()], structures = []) {
  const world = new TraversalWorld(1000, [], structures);
  const battle = {
    enabled: true,
    mode: "combat",
    world,
    player: new Combatant("player", v(), { radius: 0.36 }),
    strength: { impact: 1, attackPower: 100 },
    damageEvents: 0,
    defeated: 0,
    enemies: positions.map((position, index) => ({
      spawned: true,
      body: new Combatant(`enemy-${index}`, position),
      profile: { knockbackResistance: 1 },
      cancellations: 0,
      combat: { cancelAttack() {} },
    })),
  };
  for (const enemy of battle.enemies)
    enemy.combat.cancelAttack = () => enemy.cancellations++;
  return { battle, impact: new SpeedImpact(), enemy: battle.enemies[0] };
}

const pass = (impact, battle, overrides = {}, dt = 0.1) =>
  impact.update(dt, battle, {
    start: v(-10),
    end: v(10),
    velocity: v(200),
    playerRadius: 0.36,
    world: battle.world,
    ...overrides,
  });

test("v088 direct speed contacts sweep arbitrary travel and use the existing physical impulse", () => {
  const { battle, impact, enemy } = fixture([v()], [box("wall", 5, 0, 0.2, 5, 8)]);
  const position = enemy.body.position.clone(), health = enemy.body.health;
  assert.equal(pass(impact, battle), 1);
  assert.deepEqual(enemy.body.position, position);
  close(enemy.body.impulse.length(), 80);
  assert.ok(enemy.body.impulse.x > 0);
  assert.ok(enemy.body.stagger >= 0.24 && enemy.body.flash > 0);
  assert.equal(enemy.cancellations, 1);
  assert.equal(enemy.body.health, health);
  assert.equal(enemy.body.lastResult, null);
  assert.equal(battle.damageEvents, 0);
  assert.equal(battle.defeated, 0);
  assert.equal(impact.snapshot().directHits, 1);
  assert.equal(impact.snapshot().nearMisses, 0);
  enemy.body.moveImpulse(0.2, battle.world, v());
  assert.ok(enemy.body.position.x > 0);
  assert.ok(enemy.body.position.x <= 4.58 + 1e-6);
  assert.ok(battle.world.isSpaceFree(enemy.body.position, 0.319, 1.8));

  for (const rate of [30, 60, 144]) {
    const f = fixture();
    for (let i = 0; i < rate; i++)
      pass(f.impact, f.battle, {
        start: v(-100 + (i * 200) / rate),
        end: v(-100 + ((i + 1) * 200) / rate),
      }, 1 / rate);
    assert.equal(f.impact.directHits, 1);
  }
});

test("v088 relative motion distinguishes a fast collision from co-moving and asynchronous paths", () => {
  const opposite = fixture([v(-2)]);
  opposite.enemy.body.previousPosition.set(2, 0, 0);
  assert.equal(pass(opposite.impact, opposite.battle, {
    start: v(-2), end: v(2), velocity: v(40),
  }), 1);
  close(opposite.impact.lastRelativeSpeed, 80);

  const movingEnemy = fixture([v(10)]);
  movingEnemy.enemy.body.previousPosition.set(-10, 0, 0);
  assert.equal(pass(movingEnemy.impact, movingEnemy.battle, {
    start: v(), end: v(), velocity: v(),
  }), 1);
  assert.ok(movingEnemy.enemy.body.impulse.x < 0);

  const matching = fixture([v(4)]);
  matching.enemy.body.previousPosition.set(0, 0, 0);
  assert.equal(pass(matching.impact, matching.battle, {
    start: v(-2), end: v(2), velocity: v(40),
  }), 0);

  const asynchronous = fixture([v()]);
  asynchronous.impact.configure({ nearMissEnabled: false });
  asynchronous.enemy.body.previousPosition.set(0, 0, -8);
  assert.equal(pass(asynchronous.impact, asynchronous.battle, {
    start: v(-4), end: v(4), velocity: v(80),
  }), 0);

  const stopped = fixture();
  assert.equal(pass(stopped.impact, stopped.battle, {
    start: v(-2), end: v(-0.7), velocity: v(), incomingVelocity: v(100),
  }), 1);
  close(stopped.impact.lastRelativeSpeed, 100);

  const accelerating = fixture();
  assert.equal(pass(accelerating.impact, accelerating.battle, {
    start: v(-2), end: v(-0.7), velocity: v(100), incomingVelocity: v(),
  }), 1);
  close(accelerating.impact.lastRelativeSpeed, 100);
});

test("v088 near misses are a small non-damaging reaction at a real 3D radius", () => {
  const { battle, impact, enemy } = fixture([v(0, 0, 1.5)]);
  assert.equal(pass(impact, battle), 1);
  assert.equal(impact.nearMisses, 1);
  assert.equal(impact.directHits, 0);
  assert.ok(enemy.body.impulse.length() <= 2 + 1e-8);
  assert.ok(enemy.body.impulse.z > 0);
  assert.ok(enemy.body.stagger >= 0.08 && enemy.body.stagger <= 0.3);
  assert.equal(enemy.body.health, 72);

  for (const position of [v(0, 0, 2.401), v(0, 2.401, 0), v(0, 8, 0)]) {
    const f = fixture([position]);
    assert.equal(pass(f.impact, f.battle), 0);
    assert.equal(f.enemy.cancellations, 0);
  }
  const disabled = fixture([v(0, 0, 1.5)]);
  disabled.impact.configure({ nearMissEnabled: false });
  assert.equal(pass(disabled.impact, disabled.battle), 0);
  const slow = fixture([v(0, 0, 1.5)]);
  assert.equal(pass(slow.impact, slow.battle, { velocity: v(19.9) }), 0);
});

test("v088 contact visibility is synchronized, uses height, and preserves collision response", () => {
  const wall = box("thin wall", 0, 0, 0.1, 6, 2);
  const f = fixture([v(0.3)], [wall]);
  f.battle.world.contactCount = 2;
  f.battle.world.contactNormals[0] = 0.75;
  const normals = f.battle.world.contactNormals.slice();
  assert.equal(pass(f.impact, f.battle, {
    start: v(-0.3), end: v(-0.3), incomingVelocity: v(100),
  }), 0);
  assert.equal(f.battle.world.contactCount, 2);
  assert.deepEqual(f.battle.world.contactNormals, normals);

  const crossing = fixture([v(0.4, 0, -5)], [wall]);
  crossing.enemy.body.previousPosition.set(0.4, 0, 5);
  assert.equal(pass(crossing.impact, crossing.battle, {
    start: v(-0.4, 0, -5), end: v(-0.4, 0, 5), velocity: v(0, 0, 100),
  }), 0);

  const rooftop = fixture([v(0, 0.6)], [box("slab", 0, 0, 8, 0.15, 8, false, 1.1)]);
  assert.equal(pass(rooftop.impact, rooftop.battle, {
    start: v(-0.3), end: v(0.3), velocity: v(100),
  }), 0);
});

test("v088 zero force settings retain reaction independently and resistance scales bounded impulses", () => {
  for (const setting of ["impactStrength", "impact"])
    for (const near of [false, true]) {
      const f = fixture([v(0, 0, near ? 1.5 : 0)]);
      if (setting === "impact") f.battle.strength.impact = 0;
      else f.impact.configure({ impactStrength: 0 });
      assert.equal(pass(f.impact, f.battle), 1);
      assert.equal(f.enemy.body.impulse.length(), 0);
      assert.ok(f.enemy.body.stagger > 0);
      assert.equal(f.enemy.body.health, 72);
    }
  const normal = fixture(), resistant = fixture();
  resistant.enemy.profile.knockbackResistance = 4;
  pass(normal.impact, normal.battle);
  pass(resistant.impact, resistant.battle);
  close(normal.enemy.body.impulse.length(), resistant.enemy.body.impulse.length() * 4);

  const extreme = fixture();
  extreme.impact.configure({ impactStrength: 20 });
  extreme.battle.strength.impact = 100;
  extreme.enemy.profile.knockbackResistance = 0.1;
  extreme.enemy.body.impulse.set(999, 0, 999);
  pass(extreme.impact, extreme.battle, { velocity: v(1e200) });
  assert.ok(extreme.enemy.body.impulse.length() <= 1000 + 1e-7);
  assert.ok([...extreme.enemy.body.impulse].every(Number.isFinite));
});

test("v088 contact latches and per-generation cooldowns prevent continuous repeats in 64 fixed slots", () => {
  const f = fixture();
  assert.equal(pass(f.impact, f.battle, {}, 0.01), 1);
  assert.equal(pass(f.impact, f.battle, {}, 1), 0);
  assert.equal(pass(f.impact, f.battle, {
    start: v(10), end: v(20),
  }, 0.5), 0);
  assert.equal(pass(f.impact, f.battle, {}, 0.01), 1);
  f.enemy.body.id = "new-spawn-generation";
  assert.equal(pass(f.impact, f.battle, {}, 0.01), 1);
  assert.equal(f.impact.directHits, 3);

  const cooldown = fixture();
  pass(cooldown.impact, cooldown.battle, {}, 0.01);
  pass(cooldown.impact, cooldown.battle, { start: v(10), end: v(20) }, 0.1);
  assert.equal(pass(cooldown.impact, cooldown.battle, {}, 0.1), 0);

  const crowd = fixture(Array.from({ length: 64 }, (_, i) => v(0, 0, (i - 32) * 0.01)));
  const pool = crowd.impact.records;
  assert.equal(pass(crowd.impact, crowd.battle), 64);
  assert.equal(pass(crowd.impact, crowd.battle), 0);
  assert.strictEqual(crowd.impact.records, pool);
  assert.equal(pool.length, SPEED_IMPACT_LIMITS.enemies);
  assert.ok(crowd.battle.enemies.every((e) => e.body.health === 72));
  const out = {};
  assert.strictEqual(crowd.impact.snapshot(out), out);
  assert.equal(out.capacity, 64);
  crowd.impact.reset();
  assert.equal(pass(crowd.impact, crowd.battle), 64);
});

test("v088 Tag and inactive encounters have no speed-impact combat side effects", () => {
  for (const disabled of ["tag", "disabled", "dead-player", "context-tag"]) {
    const f = fixture();
    if (disabled === "tag") f.battle.mode = "tag";
    if (disabled === "disabled") f.battle.enabled = false;
    if (disabled === "dead-player") f.battle.player.active = false;
    assert.equal(pass(f.impact, f.battle,
      disabled === "context-tag" ? { mode: "tag" } : {}), 0);
    if (disabled !== "context-tag")
      assert.equal(f.impact.boom({ sequence: 1, position: v(), radius: 20, speed: 200 }, f.battle), 0);
    assert.equal(f.enemy.body.impulse.length(), 0);
    assert.equal(f.enemy.body.stagger, 0);
    assert.equal(f.enemy.body.flash, 0);
    assert.equal(f.enemy.body.health, 72);
    assert.equal(f.enemy.cancellations, 0);
  }
});

test("v088 sonic boom uses the captured event radius and origin once per sequence with LOS", () => {
  const f = fixture([v(2), v(4), v(0, 5)]);
  f.battle.player.position.set(100, 0, 0);
  const event = { sequence: 1, position: v(), velocity: v(200), radius: 3, speed: 200 };
  assert.equal(f.impact.boom(event, f.battle), 1);
  const impulse = f.enemy.body.impulse.clone();
  assert.ok(impulse.length() >= 8 && impulse.length() <= 40);
  assert.ok(impulse.x > 0);
  assert.equal(f.battle.enemies[1].body.impulse.length(), 0);
  assert.equal(f.battle.enemies[2].body.impulse.length(), 0);
  assert.equal(f.impact.boom(event, f.battle), 0);
  assert.deepEqual(f.enemy.body.impulse, impulse);
  assert.equal(f.impact.boom({ ...event, sequence: 2 }, f.battle), 1);
  assert.equal(f.impact.boom(event, f.battle), 0);
  assert.equal(f.impact.booms, 2);
  assert.equal(f.impact.boomHits, 2);
  assert.equal(f.enemy.body.health, 72);

  const occluded = fixture([v(2)], [box("wall", 0, 0, 0.1, 5, 8)]);
  assert.equal(occluded.impact.boom({ ...event, position: v(-2), radius: 8 }, occluded.battle), 0);
  assert.equal(occluded.enemy.cancellations, 0);
});

test("v088 selected strike targets retain approach ownership while bystanders react", () => {
  const f = fixture([v(), v(0, 0, 1)]);
  assert.equal(pass(f.impact, f.battle, { attackTargetId: f.enemy.body.id }), 1);
  assert.equal(f.enemy.cancellations, 0);
  assert.equal(f.enemy.body.impulse.length(), 0);
  assert.equal(f.impact.boom({ sequence: 1, position: v(), radius: 8, speed: 200 },
    f.battle, { excludeTargetId: f.enemy.body.id }), 1);
  assert.equal(f.enemy.body.stagger, 0);
  assert.ok(f.battle.enemies[1].body.stagger > 0);
});

test("v088 malformed impact samples and events stay finite and do not consume valid contacts", () => {
  const f = fixture();
  for (const dt of [0, -1, NaN, Infinity])
    assert.equal(pass(f.impact, f.battle, {}, dt), 0);
  assert.equal(pass(f.impact, f.battle, { start: v(Infinity) }), 0);
  for (const event of [null, {}, { sequence: 1, position: v(), radius: Infinity },
    { sequence: NaN, position: v(), radius: 3 }])
    assert.equal(f.impact.boom(event, f.battle), 0);
  assert.equal(pass(f.impact, f.battle), 1);
  assert.ok([...f.enemy.body.impulse].every(Number.isFinite));
});
