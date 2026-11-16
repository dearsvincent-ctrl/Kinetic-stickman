import test from "node:test";
import assert from "node:assert/strict";
import { Vector3 } from "three";
import {
  playerStrikeImpact,
  sanitizeCombatStrength,
  NORMAL_COMBAT_STRENGTH,
} from "../src/sandbox/CombatStrength.js";
import {
  NORMAL_PHYSICS,
  sandboxMovementConfig,
  loadPhysics,
  savePhysics,
  SANDBOX_STORAGE_KEY,
} from "../src/sandbox/PhysicsSandbox.js";
import { BattleWorld } from "../src/combat/BattleWorld.js";
import { TraversalWorld } from "../src/world/TraversalWorld.js";
import { ALL_TRAVERSAL_STRUCTURES } from "../src/world/GeometricWorldLayout.js";
import { box } from "../src/world/TraversalGeometry.js";
import { AIM_ASSIST_DEFAULTS } from "../src/sandbox/AimAssistSettings.js";
import { DEFAULT_ENEMY_SETTINGS } from "../src/sandbox/EnemySettings.js";
const near = (a, b, e = 1e-8) => assert.ok(Math.abs(a - b) < e, `${a} ~ ${b}`);
function fixture(
  position = new Vector3(0, 0, -1),
  world = new TraversalWorld(1000, [], ALL_TRAVERSAL_STRUCTURES),
) {
  const b = new BattleWorld({
    playerPosition: new Vector3(),
    world,
    targets: [],
  });
  for (const e of b.enemies) e.spawned = e.body.active = false;
  const e = b.enemies[0];
  e.spawn(position, 1, 100);
  b.rebuildBodies();
  return { b, e };
}
const hit = (b, e, action = "punch") =>
  b.hitEnemy(
    {
      targetId: e.body.id,
      source: b.player.position,
      heading: 0,
      targetPosition: e.body.position.clone(),
    },
    { action },
  );
test("Attack Power and Impact have independent 0–100 bounds, 1x baselines and separate technique profiles", () => {
  assert.deepEqual(sanitizeCombatStrength(), NORMAL_COMBAT_STRENGTH);
  assert.deepEqual(playerStrikeImpact("punch"), { damage: 18, knockback: 2.5 });
  assert.deepEqual(playerStrikeImpact("kick"), { damage: 28, knockback: 4.2 });
  for (const n of [0, 0.25, 1, 10, 50, 100])
    for (const action of ["punch", "kick"]) {
      const base = playerStrikeImpact(action);
      assert.deepEqual(
        playerStrikeImpact(action, { attackPower: n, impact: 1 }),
        { damage: base.damage * n, knockback: base.knockback },
      );
      assert.deepEqual(
        playerStrikeImpact(action, { attackPower: 1, impact: n }),
        { damage: base.damage, knockback: base.knockback * n },
      );
    }
  assert.deepEqual(
    sanitizeCombatStrength({ attackPower: Infinity, impact: -2 }),
    { attackPower: 1, impact: 0 },
  );
  assert.equal(sanitizeCombatStrength({ impact: 1e20 }).impact, 100);
});
test("live damage changes reach confirmed Punch/Kick hits and never rescale movement, aim or enemy settings", () => {
  for (const action of ["punch", "kick"])
    for (const n of [0, 0.5, 1, 100]) {
      const { b, e } = fixture();
      b.configureStrength({ attackPower: n, impact: 0 });
      const r = hit(b, e, action);
      assert.ok(r);
      near(r.damage, playerStrikeImpact(action).damage * n);
      near(e.body.health, Math.max(0, 72 - r.damage));
      assert.equal(e.body.impulse.length(), 0);
      assert.deepEqual(b.enemySettings, DEFAULT_ENEMY_SETTINGS);
    }
  assert.deepEqual(
    sandboxMovementConfig({ ...NORMAL_PHYSICS, attackPower: 100, impact: 100 }),
    sandboxMovementConfig(NORMAL_PHYSICS),
  );
  assert.deepEqual(AIM_ASSIST_DEFAULTS, {
    strength: 1,
    maxAngle: 20,
    cone: 25,
    debug: false,
  });
});
test("zero damage still permits genuine knockback/stagger while zero impact permits full damage", () => {
  const { b, e } = fixture();
  b.configureStrength({ attackPower: 0, impact: 100 });
  const r = hit(b, e, "kick");
  assert.equal(r.damage, 0);
  assert.equal(e.body.health, 72);
  near(e.body.impulse.length(), 420);
  assert.ok(e.body.stagger > 0);
  assert.equal(b.defeated, 0);
  e.body.impulse.set(0, 0, 0);
  b.configureStrength({ attackPower: 1, impact: 0 });
  hit(b, e);
  assert.equal(e.body.health, 54);
  assert.equal(e.body.impulse.length(), 0);
});
test("Impact above 1x produces actual larger physical displacement instead of saturating at the old 8 m/s cap", () => {
  const travel = [];
  for (const impact of [0, 1, 20, 100]) {
    const { b, e } = fixture();
    b.configureStrength({ attackPower: 0, impact });
    hit(b, e, "kick");
    const start = e.root.position.clone();
    e.body.moveImpulse(0.1, e.world, new Vector3());
    travel.push(e.root.position.distanceTo(start));
    assert.ok([...e.root.position, ...e.body.impulse].every(Number.isFinite));
  }
  assert.equal(travel[0], 0);
  assert.ok(travel[2] > travel[1] * 15);
  assert.ok(travel[3] > travel[2] * 4);
});
test("extreme repeated impact remains swept and bounded against walls and arena edges", () => {
  for (const dt of [1 / 30, 1 / 60, 1 / 144])
    for (const atEdge of [false, true]) {
      const w = atEdge
          ? new TraversalWorld(1000)
          : new TraversalWorld(1000, [], [box("wall", 0, -6, 30, 30, 2)]),
        { b, e } = fixture(new Vector3(0, 0, atEdge ? -999.3 : -4.5), w);
      b.player.position.set(0, 0, atEdge ? -997 : -3);
      b.configureStrength({ attackPower: 0, impact: 100 });
      for (let i = 0; i < 100; i++) {
        if (i % 7 === 0) hit(b, e, "kick");
        e.body.moveImpulse(dt, e.world, new Vector3());
        assert.ok(w.isSpaceFree(e.root.position, 0.319, 1.8));
        assert.ok(Math.abs(e.root.position.z) <= 999.68 + 1e-6);
        assert.ok(
          [...e.root.position, ...e.body.impulse].every(Number.isFinite),
        );
        assert.ok(e.body.impulse.length() < 1500);
      }
      assert.equal(e.body.health, 72);
    }
});
test("strength saves migrate older physics data, reset independently to 1x and survive battle respawn", () => {
  const map = new Map(),
    s = {
      getItem: (k) => map.get(k) ?? null,
      setItem: (k, v) => map.set(k, v),
    };
  map.set(
    SANDBOX_STORAGE_KEY,
    JSON.stringify({ version: 1, values: { movement: 20, jumpHeight: 50 } }),
  );
  map.set("kinetic.aim-assist.v1", "aim-kept");
  map.set("kinetic.enemy-settings.v1", "enemy-kept");
  map.set("kinetic.controls.v1", "layout-kept");
  const old = loadPhysics(s);
  assert.equal(old.attackPower, 1);
  assert.equal(old.impact, 1);
  assert.equal(old.movement, 20);
  savePhysics(s, { ...old, attackPower: 0.2, impact: 100 });
  assert.equal(loadPhysics(s).attackPower, 0.2);
  assert.equal(loadPhysics(s).impact, 100);
  const { b } = fixture();
  b.configureStrength(loadPhysics(s));
  b.reset();
  assert.deepEqual(b.strength, { attackPower: 0.2, impact: 100 });
  savePhysics(s, NORMAL_PHYSICS);
  assert.equal(loadPhysics(s).attackPower, 1);
  assert.equal(loadPhysics(s).impact, 1);
  assert.equal(map.get("kinetic.aim-assist.v1"), "aim-kept");
  assert.equal(map.get("kinetic.enemy-settings.v1"), "enemy-kept");
  assert.equal(map.get("kinetic.controls.v1"), "layout-kept");
});
