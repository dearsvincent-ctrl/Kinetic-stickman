import test from "node:test";
import assert from "node:assert/strict";
import { Quaternion, Vector3 } from "three";
import { Stickman } from "../src/character/Stickman.js";
import { CharacterAnimator } from "../src/character/CharacterAnimator.js";
import { AcrobaticPresenter } from "../src/character/AcrobaticPresenter.js";
import { CharacterController } from "../src/movement/CharacterController.js";
import { BodyRotation } from "../src/movement/BodyRotation.js";
import { TraversalWorld } from "../src/world/TraversalWorld.js";
import { box, pole } from "../src/world/TraversalGeometry.js";
import { CombatController } from "../src/combat/CombatController.js";
import { AttackScheduler } from "../src/combat/AttackScheduler.js";
import { StrikeHitDetector } from "../src/combat/StrikeHitDetector.js";
import { StrikePoseSampler } from "../src/combat/TechniqueGeometry.js";
import {
  createAdaptiveTechniques,
  ContextualLimbSelector,
} from "../src/combat/AdaptiveTechniques.js";
import { createCombatContext } from "../src/combat/CombatContext.js";
import {
  sandboxMovementConfig,
  movementSubsteps,
} from "../src/sandbox/PhysicsSandbox.js";
import { Game } from "../src/core/Game.js";
function rig(s = box("wall", 0, -3, 10, 6, 2), values = {}) {
  const character = new Stickman(),
    controller = new CharacterController(
      character.root,
      new TraversalWorld(1000, [], [s]),
    );
  controller.applyMovementConfig(sandboxMovementConfig(values));
  const selector = new ContextualLimbSelector(),
    combat = new CombatController({
      techniques: createAdaptiveTechniques(),
      selectTechnique: (ctx, map) => selector.choose(ctx, map),
    }),
    animator = new CharacterAnimator(character);
  return {
    character,
    controller,
    combat,
    animator,
    acrobaticPresenter: new AcrobaticPresenter(character, animator),
    bodyRotation: new BodyRotation(),
    bodyStart: new Quaternion(),
    bodyEnd: new Quaternion(),
    lastRotationJumpSequence: 0,
    simulationPrevious: new Vector3(),
    combatStartRoot: new Vector3(),
    combatEndRoot: new Vector3(),
    hitDetector: new StrikeHitDetector(),
    contactFeedbackRemaining: 0,
    attackScheduler: new AttackScheduler(combat),
    combatContext: createCombatContext(),
    followCamera: { yaw: 0 },
    input: { move: { x: 0, y: 1 }, movementMagnitude: 1, blocking: false },
    sandbox: Object.values(values).some((x) => x !== 1),
  };
}
function tick(g, dt = 1 / 60) {
  const n = movementSubsteps(g.controller, dt);
  for (let i = 0; i < n; i++) Game.prototype.simulateMovement.call(g, dt / n);
  const p = g.character.root.position.clone(),
    q = g.character.root.quaternion.clone();
  g.acrobaticPresenter.begin(g.combat, g.controller);
  g.animator.update(dt, {
    speed: g.controller.speed,
    jump: g.controller.jump,
    dash: g.controller.dash,
    combat: g.combat,
    blocking: g.input.blocking,
    sandbox: g.sandbox,
    parkour: g.controller.parkour,
  });
  g.acrobaticPresenter.apply(dt, g.bodyRotation, g.combat, g.controller);
  assert.ok(
    g.character.root.position.equals(p) &&
      g.character.root.quaternion.equals(q),
    "traversal posing never moves the physical root",
  );
  for (const j of Object.values(g.character.joints)) {
    assert.ok([...j.position, ...j.quaternion].every(Number.isFinite));
    assert.ok(Math.abs(j.quaternion.length() - 1) < 1e-6);
  }
}
function run(g, t, dt = 1 / 60) {
  for (let f = 0; f < Math.ceil(t / dt); f++) tick(g, dt);
}
const point = (g, name) =>
  g.character.joints[name].getWorldPosition(new Vector3());

test("climb contact presentation coordinates reachable hands, flexed knees and vertical soles without moving physics", () => {
  const g = rig(box("wall", 0, -3, 20, 100, 2));
  run(g, 1.2);
  assert.ok(g.controller.parkour.attached);
  for (let f = 0; f < 90; f++) {
    tick(g);
    for (const side of ["left", "right"]) {
      const hand = point(g, `${side}Hand`),
        foot = point(g, `${side}Ankle`);
      assert.ok(
        Math.abs(hand.z + 2) < 0.13,
        `${side} hand stays near the wall face ${hand.z}`,
      );
      assert.ok(Math.abs(foot.z + 2) < 0.18);
      assert.ok(foot.y > g.character.root.position.y + 0.07);
      const up = new Vector3(0, 1, 0).applyQuaternion(
        g.character.joints[`${side}Ankle`].getWorldQuaternion(new Quaternion()),
      );
      assert.ok(up.z > 0.9, "sole faces the vertical wall");
    }
  }
  g.character.dispose();
});
test("ledge, mantle, running roof landing and a fresh double-jump blend continuously at 30/60/120Hz", () => {
  for (const rate of [30, 60, 120]) {
    const g = rig(),
      dt = 1 / rate;
    let roof = false,
      peak = 0,
      prior = point(g, "leftAnkle").sub(g.character.root.position),
      largest = 0;
    for (let f = 0; f < rate * 4; f++) {
      tick(g, dt);
      const p = point(g, "leftAnkle").sub(g.character.root.position);
      largest = Math.max(largest, p.distanceTo(prior));
      prior = p;
      if (g.controller.parkour.lastExit === "rooftop" && !roof) {
        roof = true;
        g.input.move.y = 0;
        g.input.movementMagnitude = 0;
      }
      if (roof) {
        const foot = point(g, "leftAnkle");
        assert.ok(
          foot.y > 5.95,
          "displayed feet do not drop through elevated roofs",
        );
        peak = Math.max(peak, g.character.root.position.y);
      }
    }
    assert.ok(roof);
    assert.ok(largest < 32 * dt + 0.05, `${rate}Hz ankle delta ${largest}`);
    assert.ok(g.controller.requestJump());
    run(g, 0.18, dt);
    assert.ok(g.controller.requestJump({ move: { x: 0, y: -1 } }, 0));
    tick(g, dt);
    assert.equal(g.bodyRotation.lastKind, "backflip");
    run(g, 1.8, dt);
    assert.ok(g.controller.jump.grounded);
    assert.ok(Math.abs(g.character.root.position.y - 6) < 0.02);
    g.character.dispose();
  }
});
test("Punch, Kick and Block stay responsive on a wall and actual strike IK remains on the physical active path", () => {
  const g = rig(box("wall", 0, -3, 20, 100, 2));
  run(g, 0.8);
  g.input.move.y = 0;
  g.input.movementMagnitude = 0;
  run(g, 0.2);
  const sampler = new StrikePoseSampler(),
    goal = new Vector3();
  let samples = 0;
  for (const action of ["punch", "kick", "punch", "kick"]) {
    g.attackScheduler.press(action);
    for (let f = 0; f < 24; f++) {
      tick(g);
      const a = g.combat.attack,
        t = g.combat.currentTechnique;
      if (
        a.active &&
        !a.cancelled &&
        a.elapsed >= Math.max(0.11, t.windup) &&
        a.elapsed <= t.windup + t.extension + t.impact
      ) {
        sampler.sample(
          goal,
          g.character.root.position,
          g.controller.heading,
          t,
          a.elapsed,
          a.context,
          g.bodyRotation.orientation,
          g.bodyRotation.lift,
        );
        const actual = point(
          g,
          `${t.side}${action === "kick" ? "Ankle" : "Hand"}`,
        );
        assert.ok(
          actual.distanceTo(goal) < 0.06,
          `${action} visual contact error ${actual.distanceTo(goal)}`,
        );
        samples++;
      }
    }
  }
  assert.ok(samples > 4);
  g.attackScheduler.press("punch");
  tick(g);
  assert.ok(g.combat.attack.active);
  g.input.blocking = true;
  tick(g);
  assert.ok(g.combat.blocking && g.combat.attack.cancelled);
  g.input.blocking = false;
  tick(g);
  assert.ok(g.controller.requestJump());
  run(g, 0.16);
  g.attackScheduler.press("kick");
  run(g, 0.12);
  assert.equal(g.combat.currentTechnique.action, "kick");
  assert.ok(g.controller.jump.airborne);
  g.character.dispose();
});
test("wall Jump into directional second Jump retains 3D rotation, steering and interruptible aerial attacks", () => {
  const g = rig(box("wall", 0, -3, 20, 100, 2));
  run(g, 0.9);
  g.controller.requestJump({ move: { x: 0, y: -1 } }, 0);
  g.input.move.y = -1;
  run(g, 0.12);
  assert.ok(g.controller.velocity.z > 0);
  assert.equal(g.controller.jump.jumpCount, 1);
  g.controller.requestJump({ move: { x: 0.4, y: -0.9 } }, 0);
  tick(g);
  assert.ok(g.bodyRotation.flipping);
  const sequence = g.bodyRotation.sequence;
  g.attackScheduler.press("kick");
  run(g, 0.12);
  assert.equal(g.combat.currentTechnique.action, "kick");
  g.attackScheduler.press("punch");
  run(g, 0.12);
  assert.equal(g.bodyRotation.sequence, sequence);
  assert.ok(g.controller.jump.airborne);
  assert.ok(g.controller.velocity.z > 0);
  g.character.dispose();
});
test("pole grip/perch and vault poses stay bounded at ordinary and extreme movement scaling", () => {
  for (const s of [
    pole("pole", 0, -2, 0.25, 8),
    box("vault", 0, -2, 4, 0.8, 0.7, true),
  ])
    for (const scale of [1, 100]) {
      const g = rig(s, { movement: scale, jumpHeight: scale, gravity: scale });
      let contact = false;
      for (let f = 0; f < 240; f++) {
        tick(g);
        contact ||= g.controller.parkour.attached;
        assert.ok(
          g.acrobaticPresenter.parkour.phase >= 0 &&
            g.acrobaticPresenter.parkour.phase < Math.PI * 2,
        );
      }
      assert.ok(contact);
      g.character.dispose();
    }
});

test("rapid wall run/climb redirection keeps finite, continuous feet and strike-ready limbs", () => {
  const g = rig(box("wall", 0, -3, 40, 100, 2));
  run(g, 0.8);
  let prior = point(g, "rightAnkle").sub(g.character.root.position),
    largest = 0;
  for (let f = 0; f < 180; f++) {
    g.input.move = { x: f % 24 < 12 ? 0.9 : -0.9, y: f % 16 < 8 ? 0.8 : 0.1 };
    g.input.movementMagnitude = 1;
    if (f % 27 === 0) g.attackScheduler.press("punch");
    tick(g);
    const p = point(g, "rightAnkle").sub(g.character.root.position);
    largest = Math.max(largest, p.distanceTo(prior));
    prior = p;
  }
  assert.ok(largest < 0.4, `redirected ankle motion ${largest}`);
  assert.ok(g.combat.attack.sequence > 3);
  g.character.dispose();
});
