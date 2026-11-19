import test from "node:test";
import assert from "node:assert/strict";
import { Group, Quaternion, Vector3 } from "three";
import { Game } from "../src/core/Game.js";
import { FreeflowCombat } from "../src/combat/FreeflowCombat.js";
import { CombatController } from "../src/combat/CombatController.js";
import { AttackScheduler } from "../src/combat/AttackScheduler.js";
import { StrikeHitDetector } from "../src/combat/StrikeHitDetector.js";
import { BattleWorld } from "../src/combat/BattleWorld.js";
import { PunchAimAssist } from "../src/combat/PunchAimAssist.js";
import { createAdaptiveTechniques, ContextualLimbSelector } from "../src/combat/AdaptiveTechniques.js";
import { createCombatContext } from "../src/combat/CombatContext.js";
import { CharacterController } from "../src/movement/CharacterController.js";
import { BodyRotation } from "../src/movement/BodyRotation.js";
import { TraversalWorld } from "../src/world/TraversalWorld.js";
import { box } from "../src/world/TraversalGeometry.js";
import { movementSubsteps } from "../src/sandbox/PhysicsSandbox.js";

function gameFixture(distance = 8) {
  const root = new Group(), world = new TraversalWorld(200);
  const controller = new CharacterController(root, world, { parkour: false });
  const targets = [];
  const battle = new BattleWorld({ playerPosition: root.position, world, targets });
  battle.configureEnemies({ maxEnemies: 1, speed: 0.1, aggression: 0, attackFrequency: 0, detection: 2 });
  const enemy = battle.enemies.find((item) => item.spawned);
  enemy.spawn(new Vector3(0, 0, -distance), 1, 99);
  const selector = new ContextualLimbSelector();
  const game = Object.assign(Object.create(Game.prototype), {
    character: { root }, controller, battle, targets, enemy,
    freeflow: new FreeflowCombat(), punchAim: new PunchAimAssist({ targets: battle.enemies }),
    bodyRotation: new BodyRotation(), lastRotationJumpSequence: 0,
    input: { move: { x: 0, y: 0 }, blocking: false, movementMagnitude: 0, setEnabled() {} },
    followCamera: { yaw: 0 }, combatContext: createCombatContext(),
    simulationPrevious: new Vector3(), combatStartRoot: new Vector3(), combatEndRoot: new Vector3(),
    bodyStart: new Quaternion(), bodyEnd: new Quaternion(),
    contactFeedbackRemaining: 0, acrobaticPresenter: { fillLimbContext() {} },
  });
  game.combat = new CombatController({
    techniques: createAdaptiveTechniques(), selectTechnique: (context, registry) => selector.choose(context, registry),
    prepareAttackContext: (context, technique) => game.prepareManualAttack(context, technique),
  });
  game.attackScheduler = new AttackScheduler(game.combat);
  game.hitDetector = new StrikeHitDetector({ targets, onContact: (hit) => battle.hitEnemy(hit, game.combat.currentTechnique) });
  return game;
}

test("Game uses one accepted Punch/Kick to approach a real enemy at 6–12m, then damages through the actual detector", () => {
  for (const distance of [6, 12]) for (const action of ["punch", "kick"]) {
    const game = gameFixture(distance), initialHealth = game.enemy.body.health;
    game.attackScheduler.press(action);
    let ready = false;
    for (let n = 0; n < 180; n++) {
      game.simulateMovement(1 / 240);
      ready ||= game.freeflow.ready;
      if (game.freeflow.holdWindup) {
        assert.equal(game.combat.attack.phase, "windup");
        assert.equal(game.enemy.body.health, initialHealth, "no early damage while physically approaching");
      }
    }
    assert.equal(ready, true);
    assert.equal(game.hitDetector.count, 1, `${action} at ${distance}m makes exactly one real contact`);
    assert.ok(game.enemy.body.health < initialHealth);
    assert.ok(game.freeflow.traveled <= 18 + 1e-7);
    assert.equal(game.combat.attack.sequence, 1, "proximity never synthesizes another manual attack");
  }
});

test("Game takes over a 520m/s entry before it can overshoot the selected enemy", () => {
  const game = gameFixture(12);
  game.controller.velocity.set(0, 0, -520);
  game.attackScheduler.press("punch");
  for (let n = 0; n < 180; n++) {
    game.simulateMovement(1 / 240);
    assert.ok(game.character.root.position.z > game.enemy.root.position.z + 0.6);
    if (game.freeflow.active && game.controller.motionDriver) assert.ok(game.controller.velocity.length() <= 80 + 1e-6);
  }
  assert.equal(game.hitDetector.count, 1);
  assert.ok(game.enemy.body.health < game.enemy.body.maxHealth);
});

test("Game cancels an occluded approach and Block immediately clears the windup gate", () => {
  const game = gameFixture(12);
  game.attackScheduler.press("punch");
  game.simulateMovement(1 / 240);
  assert.equal(game.freeflow.holdWindup, true);
  game.controller.world.structures = [box("wall", 0, -6, 5, 4, 0.1)];
  for (let n = 0; n < 120; n++) game.simulateMovement(1 / 240);
  assert.equal(game.freeflow.active, false);
  assert.equal(game.enemy.body.health, game.enemy.body.maxHealth);
  assert.equal(game.hitDetector.count, 0);
  const blocked = gameFixture();
  blocked.attackScheduler.press("punch");
  blocked.simulateMovement(1 / 240);
  blocked.input.blocking = true;
  blocked.simulateMovement(1 / 240);
  assert.equal(blocked.freeflow.active, false);
  assert.equal(blocked.combat.holdWindup, false);
  assert.equal(blocked.combat.attack.cancelled, true);
});

test("Game aerial approach keeps jump counts and gravity while creating a real grounded-target contact", () => {
  const game = gameFixture(6);
  Object.assign(game.controller.jump, { phase: "airborne", height: 0.7, verticalVelocity: 0, jumpCount: 1 });
  game.character.root.position.y = 0.7;
  game.attackScheduler.press("punch");
  let aerialAssist = false;
  for (let n = 0; n < 200; n++) {
    game.simulateMovement(1 / 240);
    aerialAssist ||= game.freeflow.active && game.freeflow.airborne;
    assert.equal(game.controller.jump.sequence, 0);
    assert.ok(game.character.root.position.y >= 0);
  }
  assert.equal(aerialAssist, true);
  assert.equal(game.hitDetector.count, 1);
  assert.ok(game.enemy.body.health < game.enemy.body.maxHealth);
});

test("Game quaternion-aware Punch/Kick approaches lateral and behind targets without yaw oscillation at 30/60/144Hz", () => {
  for (const position of [[8, 0, 0], [-8, 0, 4]]) for (const fps of [30, 60, 144]) for (const action of ["punch", "kick"]) {
    const game = gameFixture();
    game.enemy.spawn(new Vector3(...position), 1, 99);
    const initialHealth = game.enemy.body.health;
    const yawSign = position[0] > 0 ? -1 : 1;
    game.attackScheduler.press(action);
    let ready = false, readyAt = null;
    for (let frame = 0; frame < fps; frame++) {
      const dt = 1 / fps;
      const steps = Math.max(
        game.freeflow.active ? movementSubsteps(game.controller, dt, undefined, game.input.movementMagnitude) : 1,
        game.battle.recommendedSubsteps(dt),
      );
      for (let n = 0; n < steps; n++) {
        const heading = game.controller.heading;
        game.simulateMovement(dt / steps);
        const turn = Math.atan2(Math.sin(game.controller.heading - heading), Math.cos(game.controller.heading - heading));
        if (game.controller.motionDriver) assert.ok(Math.abs(turn) <= 24 * dt / steps + 1e-8);
        if (game.freeflow.holdWindup) {
          assert.ok(turn * yawSign >= -0.015, `${position} ${fps}Hz ${action} does not reverse yaw while approaching`);
          assert.equal(game.enemy.body.health, initialHealth);
        }
        if (game.freeflow.ready) {
          ready = true;
          readyAt ??= frame / fps;
        }
      }
    }
    const label = `${position} ${fps}Hz ${action}`;
    assert.equal(ready, true, `${label} physically reaches its target`);
    assert.ok(readyAt < 0.65, `${label} finishes the bounded approach promptly`);
    assert.equal(game.hitDetector.count, 1, `${label} registers one authored limb contact`);
    assert.ok(game.enemy.body.health < initialHealth, `${label} applies real battle damage`);
    assert.equal(game.combat.attack.sequence, 1);
  }
});

test("Game dynamic flip keeps quaternion ownership and manual-away interrupts its aerial approach", () => {
  const game = gameFixture(6);
  Object.assign(game.controller.jump, { phase: "airborne", height: 2, verticalVelocity: 1, jumpCount: 2 });
  game.character.root.position.y = 2;
  game.bodyRotation.start("frontflip", 0, 1, 1, 0, game.controller.jump.timeToLanding);
  game.bodyRotation.update(0.1, game.controller, game.input, 0);
  for (const method of ["beforeStep", "afterStep"]) {
    const original = game.freeflow[method].bind(game.freeflow);
    game.freeflow[method] = (...args) => {
      const orientation = args[2].orientation.clone();
      const result = original(...args);
      assert.deepEqual(args[2].orientation, orientation, `${method} leaves the live flip quaternion untouched`);
      return result;
    };
  }
  game.attackScheduler.press("punch");
  for (let n = 0; n < 8; n++) game.simulateMovement(1 / 240);
  assert.equal(game.freeflow.active, true);
  const elapsed = game.bodyRotation.automatic.elapsed;
  const sequence = game.bodyRotation.sequence;
  game.input.move.y = -1;
  game.simulateMovement(1 / 240);
  assert.equal(game.freeflow.active, false);
  assert.equal(game.freeflow.reason, "manual-away");
  assert.equal(game.bodyRotation.sequence, sequence);
  assert.ok(game.bodyRotation.automatic.elapsed > elapsed, "the independent flip continues after movement assistance is cancelled");
  assert.equal(game.controller.jump.jumpCount, 2);
});
