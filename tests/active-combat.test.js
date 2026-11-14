import test from "node:test";
import assert from "node:assert/strict";
import { Group, Scene, Vector3 } from "three";
import { ARENA_CONFIG } from "../src/world/ArenaConfig.js";
import { createArena } from "../src/world/createArena.js";
import { ArenaBounds } from "../src/world/ArenaBounds.js";
import { CharacterController } from "../src/movement/CharacterController.js";
import { BodyRotation } from "../src/movement/BodyRotation.js";
import {
  sandboxMovementConfig,
  movementSubsteps,
} from "../src/sandbox/PhysicsSandbox.js";
import { Combatant, DAMAGE_CONFIG } from "../src/combat/Combatant.js";
import { BattleWorld, WAVE_CONFIG } from "../src/combat/BattleWorld.js";
import { ENEMY_CONFIG } from "../src/combat/EnemyAgent.js";
import { CombatController } from "../src/combat/CombatController.js";
import { AttackScheduler } from "../src/combat/AttackScheduler.js";
import {
  createManualTechniques,
  selectManualTechnique,
} from "../src/combat/ManualTechniques.js";
import { StrikeHitDetector } from "../src/combat/StrikeHitDetector.js";
import { Stickman } from "../src/character/Stickman.js";
import { EnemyViews } from "../src/character/EnemyViews.js";
import { Game } from "../src/core/Game.js";
const close = (a, b, e = 1e-7) => assert.ok(Math.abs(a - b) < e, `${a} ≈ ${b}`);
const input = { move: { x: 1, y: 0 }, movementMagnitude: 1, blocking: false };
const fixture = (position = new Vector3()) =>
  new BattleWorld({
    playerPosition: position,
    world: new ArenaBounds(ARENA_CONFIG.halfSize),
    targets: [],
  });
function step(b, t = 1 / 60, block = false) {
  b.beginStep(t, block, 0);
  b.movePlayerImpulse(t);
  b.endStep(t, 0);
}
function advance(b, t, block = false) {
  for (let left = t; left > 1e-8; ) {
    const d = Math.min(1 / 120, left);
    step(b, d, block);
    left -= d;
  }
}
function oneEnemy(b, z = -0.86) {
  for (const e of b.enemies) {
    e.spawned = false;
    e.body.active = false;
  }
  const e = b.enemies[0];
  e.spawn(new Vector3(0, 0, z), 1, 100);
  e.controller.heading = z < 0 ? Math.PI : 0;
  e.root.rotation.y = e.controller.heading;
  e.cooldown = 0;
  b.player.invulnerable = 0;
  return e;
}
test("the rendered floor and physical arena share exactly 2000 × 2000 units", () => {
  const prior = globalThis.document;
  const context = new Proxy(
    {},
    {
      get: (o, k) =>
        k === "createRadialGradient" ? () => ({ addColorStop() {} }) : () => {},
      set: () => true,
    },
  );
  globalThis.document = {
    createElement: () => ({ getContext: () => context }),
  };
  try {
    const scene = new Scene(),
      arena = createArena(scene);
    const floor = scene.getObjectByName("TrainingFloor");
    assert.equal(ARENA_CONFIG.size, 2000);
    assert.equal(arena.halfSize, 1000);
    assert.equal(floor.geometry.parameters.width, 2000);
    assert.equal(floor.geometry.parameters.height, 2000);
    assert.ok(floor.geometry.attributes.position.count <= 4);
    assert.equal(floor.material.map.repeat.x, 200);
    assert.ok(ARENA_CONFIG.cameraFar > 2000);
    arena.dispose();
  } finally {
    if (prior === undefined) delete globalThis.document;
    else globalThis.document = prior;
  }
});
test("100× analogue travel, double jumps and physical dash substeps cross the expanded field without crossing its walls", () => {
  const c = new CharacterController(new Group(), new ArenaBounds(1000));
  c.applyMovementConfig(
    sandboxMovementConfig({
      movement: 100,
      groundDashSpeed: 100,
      groundDashDistance: 100,
      jumpHeight: 100,
      gravity: 100,
    }),
  );
  let previous = c.root.position.clone(),
    moved = 0;
  for (let n = 0; n < 480; n++) {
    if (n === 30) c.requestJump();
    if (n === 40) c.requestJump();
    if (n === 120) c.requestDash();
    const count = movementSubsteps(c, 1 / 60);
    for (let j = 0; j < count; j++) {
      c.update(1 / 60 / count, input, 0);
      assert.ok(c.root.position.toArray().every(Number.isFinite));
      assert.ok(Math.abs(c.root.position.x) <= 999.64 + 1e-6);
      assert.ok(c.root.position.y >= 0);
      assert.ok(c.root.position.distanceTo(previous) < 2000 / 60 + 1);
      moved += c.root.position.distanceTo(previous);
      previous.copy(c.root.position);
    }
  }
  assert.ok(moved > 1000);
  close(c.root.position.x, 999.64);
  assert.ok(c.jump.ready);
});
test("collision adapters ignore self, block moving opponents and permit travel above their height", () => {
  const own = new Combatant("self", new Vector3()),
    enemy = new Combatant("enemy", new Vector3(0, 0, -2));
  const w = new ArenaBounds(1000, [own, enemy], own),
    out = new Vector3();
  w.move(own.position, new Vector3(0, 0, -10), own.radius, out);
  close(out.z, -2 + own.radius + enemy.radius);
  w.move(new Vector3(0, 3, 0), new Vector3(0, 0, -10), own.radius, out);
  close(out.z, -10);
  w.move(new Vector3(999, 0, 999), new Vector3(1000, 0, 1000), own.radius, out);
  close(out.x, 999.68);
  close(out.z, 999.68);
});
test("waves start with three separated enemies at sensible distances, including near an arena corner", () => {
  for (const p of [new Vector3(), new Vector3(999.6, 120, 999.6)]) {
    const b = fixture(p);
    assert.equal(b.alive, 3);
    const seen = [];
    for (const e of b.enemies.filter((e) => e.spawned)) {
      const d = Math.hypot(e.root.position.x - p.x, e.root.position.z - p.z);
      assert.ok(d >= 8.5);
      assert.ok(
        Math.abs(e.root.position.x) <= 998 &&
          Math.abs(e.root.position.z) <= 998,
      );
      for (const q of seen) assert.ok(q.distanceTo(e.root.position) >= 2);
      seen.push(e.root.position);
    }
  }
});
test("enemies detect, pursue, position and turn independently while retaining physical separation", () => {
  const b = fixture();
  const initial = b.enemies[0].root.position.distanceTo(b.player.position),
    states = new Set();
  for (let n = 0; n < 480; n++) {
    step(b);
    for (const e of b.enemies.filter((e) => e.spawned)) {
      states.add(e.state);
      for (const p of b.enemies.filter((p) => p.spawned && p !== e))
        assert.ok(e.root.position.distanceTo(p.root.position) >= 0.63);
    }
  }
  assert.ok(
    b.enemies[0].root.position.distanceTo(b.player.position) < initial - 4,
  );
  for (const s of ["Approach", "Position", "Attack", "Recover"])
    assert.ok(states.has(s), s);
  assert.ok(
    b.damageEvents > 0,
    "Timed enemy strikes actually reach a stationary fighter",
  );
});
test("distant idle enemies wake on detection and continue pursuit after the fighter escapes detection range", () => {
  const b = fixture();
  const e = oneEnemy(b, -200);
  step(b);
  assert.equal(e.state, "Idle");
  b.player.position.z = -190;
  step(b);
  assert.equal(e.state, "Approach");
  b.player.position.z = 200;
  step(b);
  assert.equal(e.state, "Approach");
});
test("attack slots are spaced and shared rather than simultaneous or monopolized", () => {
  const b = fixture();
  b.player.maxHealth = b.player.health = 10000;
  let prior = 0,
    last = -Infinity;
  const strikers = new Set();
  for (let n = 0; n < 1200; n++) {
    step(b);
    const es = b.enemies.filter((e) => e.spawned && e.body.active);
    assert.ok(es.filter((e) => e.combat.attack.active).length <= 1);
    const sequence = es.reduce((s, e) => s + e.combat.attack.sequence, 0);
    if (sequence > prior) {
      assert.ok(b.time - last >= WAVE_CONFIG.attackSpacing - 1 / 60 - 1e-6);
      last = b.time;
      prior = sequence;
      for (const e of es) if (e.combat.attack.active) strikers.add(e.index);
    }
  }
  assert.ok(strikers.size >= 2, "Multiple opponents receive attack turns");
});
test("enemy punch and kick have readable startup, active windows, range and full recovery", () => {
  const b = fixture(),
    e = oneEnemy(b);
  step(b);
  assert.equal(e.state, "Attack");
  assert.equal(e.combat.currentTechnique.action, "punch");
  close(e.combat.currentTechnique.windup, ENEMY_CONFIG.punchStartup);
  advance(b, 0.22);
  assert.equal(b.damageEvents, 0);
  advance(b, 0.2);
  assert.equal(b.damageEvents, 1);
  const health = b.player.health;
  advance(b, 0.3);
  assert.equal(
    b.player.health,
    health,
    "one strike does not repeatedly damage",
  );
  e.combat.cancelAttack();
  e.combat.update(2);
  b.player.position.set(0, 0, 0);
  b.player.impulse.set(0, 0, 0);
  e.cooldown = 0;
  e.attackCount = 2;
  e.root.position.set(0, 0, -0.86);
  e.controller.heading = Math.PI;
  b.attackGate = 0;
  step(b);
  assert.equal(e.combat.currentTechnique.action, "kick");
  close(e.combat.currentTechnique.windup, ENEMY_CONFIG.kickStartup);
});
test("moving away or jumping above an enemy attack during windup causes a genuine miss", () => {
  for (const escape of [new Vector3(0, 0, 5), new Vector3(0, 3, 0)]) {
    const b = fixture(),
      e = oneEnemy(b);
    step(b);
    advance(b, 0.2);
    b.player.position.copy(escape);
    advance(b, 0.35);
    assert.equal(b.damageEvents, 0);
    assert.equal(b.player.health, DAMAGE_CONFIG.playerHealth);
    assert.ok(e.combat.attack.sequence === 1);
  }
});
test("facing/timing based Block prevents fresh front hits and mitigates held front hits, while rear hits connect", () => {
  const p = new Combatant("p", new Vector3(), { maxHealth: 100 });
  p.update(0.01, true, 0);
  let r = p.receive({ damage: 20, source: new Vector3(0, 0, -1) });
  assert.ok(r.perfect && r.blocked);
  assert.equal(p.health, 100);
  p.update(0.5, true, 0);
  r = p.receive({ damage: 20, source: new Vector3(0, 0, -1) });
  assert.ok(r.blocked && !r.perfect);
  close(p.health, 97);
  r = p.receive({ damage: 20, source: new Vector3(0, 0, 1) });
  assert.equal(r.blocked, false);
  close(p.health, 77);
  assert.ok(p.stagger > 0);
  p.update(0.01, false, 0);
  p.receive({ damage: 20, source: new Vector3(0, 0, -1) });
  close(p.health, 57);
});
test("held Block is integrated with actual enemy contact rather than proximity damage", () => {
  const b = fixture();
  oneEnemy(b);
  advance(b, 0.6, true);
  assert.equal(b.blockEvents, 1);
  assert.ok(b.player.health > DAMAGE_CONFIG.playerHealth - 5);
  assert.ok(b.player.active);
});
test("confirmed player hits cause bounded knockback, stagger, cancellation and defeat without repeated death credit", () => {
  const b = fixture(),
    e = oneEnemy(b);
  step(b);
  const from = e.root.position.clone();
  let r = b.hitEnemy(
    { targetId: e.body.id, source: b.player.position, heading: 0 },
    { action: "kick" },
  );
  assert.equal(r.damage, 28);
  assert.ok(e.combat.attack.cancelled);
  assert.ok(e.body.stagger > 0);
  advance(b, 0.1);
  assert.equal(e.state, "Stagger");
  assert.ok(e.root.position.distanceTo(from) > 0.1);
  assert.ok(e.root.position.distanceTo(from) < 1);
  b.hitEnemy(
    { targetId: e.body.id, source: b.player.position },
    { action: "kick" },
  );
  r = b.hitEnemy(
    { targetId: e.body.id, source: b.player.position },
    { action: "kick" },
  );
  assert.ok(r.defeated);
  assert.equal(b.defeated, 1);
  assert.equal(
    b.hitEnemy(
      { targetId: e.body.id, source: b.player.position },
      { action: "kick" },
    ),
    null,
  );
  step(b);
  assert.equal(e.state, "Defeated");
});
test("moving enemy hitboxes are swept through the active window at superhuman travel speed without expanding reach", () => {
  for (const z of [-0.65, -4]) {
    const b = fixture(),
      e = oneEnemy(b);
    e.body.previousPosition.set(-3, 0, z);
    e.root.position.set(3, 0, z);
    const c = new CombatController({
      techniques: createManualTechniques(),
      selectTechnique: selectManualTechnique,
    });
    c.requestAttack({ action: "punch" });
    const t = c.currentTechnique,
      d = new StrikeHitDetector({
        targets: [e.body],
        onContact: (hit) => b.hitEnemy(hit, t),
      });
    const root = new Vector3();
    d.sweep(t, c.attack, t.windup, t.windup + t.extension, root, root, 0, 0);
    d.sweep(t, c.attack, t.windup, t.windup + t.extension, root, root, 0, 0);
    assert.equal(d.count, z === -0.65 ? 1 : 0);
    assert.equal(e.body.health, z === -0.65 ? 72 - 18 : 72);
  }
});
test("waves advance without reload, progressively scale and cap simultaneous opponents at eight", () => {
  const b = fixture();
  for (let wave = 1; wave <= 15; wave++) {
    assert.equal(b.wave, wave);
    assert.equal(b.alive, Math.min(8, 3 + Math.floor((wave - 1) / 2)));
    for (const e of b.enemies.filter((e) => e.spawned))
      while (e.body.active)
        b.hitEnemy(
          { targetId: e.body.id, source: b.player.position },
          { action: "kick" },
        );
    assert.equal(b.alive, 0);
    const kills = b.defeated;
    advance(b, WAVE_CONFIG.delay + 0.02);
    assert.equal(b.wave, wave + 1);
    assert.equal(b.defeated, kills);
    assert.ok(b.alive <= 8);
  }
});
test("invalid damage cannot corrupt health; defeated targets no longer collide, attack or accept damage", () => {
  const b = fixture(),
    e = oneEnemy(b);
  for (const damage of [NaN, Infinity, -1, 0])
    assert.equal(e.body.receive({ damage, source: b.player.position }), null);
  assert.equal(e.body.health, 72);
  e.body.receive({ damage: 1000, source: b.player.position });
  assert.equal(e.body.health, 0);
  advance(b, 0.5);
  assert.equal(e.combat.attack.sequence, 0);
  assert.equal(e.body.active, false);
});
test("respawn restores health/wave/jump availability and preserves live sandbox tuning and camera orbit", () => {
  const root = new Group(),
    world = new ArenaBounds(1000),
    controller = new CharacterController(root, world);
  controller.applyMovementConfig(
    sandboxMovementConfig({ movement: 100, jumpHeight: 20 }),
  );
  const b = new BattleWorld({
    playerPosition: root.position,
    world,
    targets: [],
  });
  const combat = new CombatController({ techniques: createManualTechniques() }),
    scheduler = new AttackScheduler(combat);
  root.position.set(400, 15, 300);
  b.player.health = 0;
  b.player.active = false;
  b.wave = 5;
  b.defeated = 20;
  const g = {
    character: { root },
    controller,
    battle: b,
    combat,
    attackScheduler: scheduler,
    bodyRotation: new BodyRotation(),
    animator: { previousPosition: new Vector3(), initialized: true },
    followCamera: { target: new Vector3(), yaw: 0.7 },
    input: {
      setEnabled(value) {
        this.enabled = value;
      },
    },
    battleHud: { update() {} },
    clearMotion() {
      controller.stop();
      combat.reset();
      scheduler.reset();
    },
  };
  Game.prototype.respawn.call(g);
  assert.equal(g.battle.player.health, 120);
  assert.equal(g.battle.wave, 1);
  assert.equal(g.battle.defeated, 0);
  assert.equal(g.battle.alive, 3);
  assert.ok(g.controller.jump.ready);
  assert.equal(g.controller.jump.jumpCount, 0);
  close(g.controller.jump.config.height, 24);
  close(g.controller.sprintSpeed, 520);
  assert.equal(g.followCamera.yaw, 0.7);
  assert.ok(g.input.enabled);
  assert.deepEqual(root.position, new Vector3());
});
test("enemy pool shares geometry/material resources and binds animations to actual movement roots", () => {
  const scene = new Scene(),
    b = fixture(),
    views = new EnemyViews(scene, b.enemies);
  const a = views.views[0],
    c = views.views[1];
  assert.equal(
    a.character.resources.sphereGeometry,
    c.character.resources.sphereGeometry,
  );
  assert.equal(a.character.resources.ivory, c.character.resources.ivory);
  assert.equal(a.character.root, a.agent.root);
  const player = new Stickman();
  assert.notEqual(player.resources.ivory, a.character.resources.ivory);
  player.dispose();
  views.dispose();
});

test("capped waves remain separated and outside the player at every arena corner", () => {
  const b = fixture();
  for (const x of [-999.64, 999.64])
    for (const z of [-999.64, 999.64])
      for (const wave of [11, 20, 40]) {
        b.player.position.set(x, 0, z);
        b.wave = wave - 1;
        b.spawnWave();
        assert.equal(b.alive, 8);
        const es = b.enemies.filter((e) => e.spawned);
        for (let i = 0; i < es.length; i++) {
          assert.ok(
            Math.hypot(es[i].root.position.x - x, es[i].root.position.z - z) >=
              8.5,
          );
          for (let j = i + 1; j < es.length; j++)
            assert.ok(es[i].root.position.distanceTo(es[j].root.position) >= 2);
        }
      }
});
test("blocked and unblocked damage signals do not touch the player velocity, jump or attack availability", () => {
  const b = fixture(),
    root = new Group(),
    c = new CharacterController(root, new ArenaBounds(1000));
  c.applyMovementConfig(sandboxMovementConfig({ movement: 100 }));
  c.velocity.set(300, 0, -200);
  c.requestJump();
  c.update(0.15, input, 0);
  const velocity = c.velocity.clone(),
    height = c.jump.height,
    vertical = c.jump.verticalVelocity;
  b.player.invulnerable = 0;
  b.player.position.copy(root.position);
  b.player.receive({ damage: 10, source: new Vector3(0, 0, -1) });
  assert.deepEqual(c.velocity, velocity);
  assert.equal(c.jump.height, height);
  assert.equal(c.jump.verticalVelocity, vertical);
  assert.equal(c.canJump, true);
});
test("contact-time source positions keep directional blocking correct during fast crossing strikes", () => {
  const target = new Combatant("p", new Vector3(), { maxHealth: 100 });
  target.update(0.01, true, Math.PI);
  target.update(1, true, Math.PI);
  const c = new CombatController({
    techniques: createManualTechniques(),
    selectTechnique: selectManualTechnique,
  });
  c.requestAttack({ action: "punch" });
  const t = c.currentTechnique;
  let source;
  const d = new StrikeHitDetector({
    targets: [target],
    onContact: (hit) => {
      source = hit.source;
      target.receive({ damage: 20, source: hit.source, heading: hit.heading });
    },
  });
  // Attacker moves from in front of +Z-facing guard to behind it in one step.
  d.sweep(
    t,
    c.attack,
    t.windup,
    t.windup + t.extension,
    new Vector3(0, 0, 2),
    new Vector3(0, 0, -2),
    0,
    0,
  );
  assert.equal(d.count, 1);
  assert.ok(
    source.z > 0,
    "Source is interpolated to impact, not taken after crossing",
  );
  close(target.health, 97);
});

test("manual grounded and airborne Punch/Kick contacts damage moving fighters once, with facing and active-window misses preserved", () => {
  for (const environment of ["ground", "air"])
    for (const action of ["punch", "kick"])
      for (const facing of [0, Math.PI]) {
        const b = fixture(),
          e = oneEnemy(b),
          c = new CombatController({
            techniques: createManualTechniques(),
            selectTechnique: selectManualTechnique,
          });
        c.requestAttack({
          action,
          environment,
          height: environment === "air" ? 0.3 : 0,
          airTimeRemaining: 1,
        });
        const t = c.currentTechnique;
        e.root.position.set(0, 0, -(t.reach - t.hitRadius));
        e.body.previousPosition.copy(e.root.position);
        const root = new Vector3(0, environment === "air" ? 0.3 : 0, 0),
          d = new StrikeHitDetector({
            targets: [e.body],
            onContact: (hit) => b.hitEnemy(hit, t),
          });
        d.sweep(t, c.attack, 0, t.windup, root, root, facing, facing);
        assert.equal(d.count, 0);
        for (let n = 0; n < 2; n++)
          d.sweep(
            t,
            c.attack,
            t.windup,
            t.windup + t.extension + t.impact,
            root,
            root,
            facing,
            facing,
          );
        assert.equal(d.count, facing === 0 ? 1 : 0);
        assert.equal(
          e.body.health,
          facing === 0 ? 72 - (action === "punch" ? 18 : 28) : 72,
        );
      }
});

test("a moving defender blocks using its contact-time position instead of its far-away frame endpoint", () => {
  const p = new Combatant("p", new Vector3(100, 0, 0), { maxHealth: 100 });
  p.update(0.01, true, 0);
  p.update(1, true, 0);
  const r = p.receive({
    damage: 20,
    source: new Vector3(0, 0, -1),
    atPosition: new Vector3(),
    heading: Math.PI,
  });
  assert.ok(r.blocked);
  close(p.health, 97);
  assert.ok(p.impulse.z > 0);
  close(p.impulse.x, 0);
});

test("a lone pursuer steers around a directly blocking stationary dummy instead of stalling", () => {
  const dummy = { id: "dummy", position: new Vector3(0, 0, -2), radius: 0.32 };
  const b = new BattleWorld({
    playerPosition: new Vector3(),
    world: new ArenaBounds(1000),
    targets: [],
    dummy,
  });
  for (const e of b.enemies) {
    e.spawned = false;
    e.body.active = false;
  }
  const e = b.enemies[0];
  e.spawn(new Vector3(0, 0, -4), 1, 20);
  e.controller.heading = Math.PI;
  b.player.health = 10000;
  let lateral = false;
  for (let n = 0; n < 900; n++) {
    step(b);
    lateral ||= Math.abs(e.root.position.x) > 0.4;
    assert.ok(e.root.position.distanceTo(dummy.position) >= 0.64 - 1e-6);
  }
  assert.ok(lateral);
  assert.ok(
    b.damageEvents > 0,
    "The enemy clears the prop and resumes physical attacks",
  );
});
