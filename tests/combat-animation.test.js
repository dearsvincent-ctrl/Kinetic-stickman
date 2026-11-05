import test from "node:test";
import assert from "node:assert/strict";
import { Vector3 } from "three";
import { Stickman } from "../src/character/Stickman.js";
import { CharacterAnimator } from "../src/character/CharacterAnimator.js";
import { CharacterController } from "../src/movement/CharacterController.js";
import { CombatController } from "../src/combat/CombatController.js";
import { ArenaBounds } from "../src/world/ArenaBounds.js";

const DT = 1 / 60;
const rates = [1 / 30, 1 / 60, 1 / 120];
const input = (speed = 0, blocking = false) => ({
  move: { x: 0, y: Math.min(speed / (speed > 2.6 ? 5.2 : 2.6), 1) },
  sprinting: speed > 2.6,
  blocking,
});
const rig = () => {
  const character = new Stickman();
  return {
    character,
    animator: new CharacterAnimator(character),
    combat: new CombatController(),
    movement: new CharacterController(character.root, new ArenaBounds(100)),
  };
};
const world = (joint) => joint.getWorldPosition(new Vector3());
const relative = (actor, name) =>
  world(actor.character.joints[name]).sub(actor.character.root.position);

// Follow the actual controller -> pose lifecycle and check animation ownership
// on every sampled frame, including a dash completing before pose evaluation.
const step = (actor, controls = input(), dt = DT, cameraYaw = 0) => {
  actor.combat.setBlocking(controls.blocking);
  actor.combat.update(dt);
  actor.movement.update(dt, controls, cameraYaw);
  const root = actor.character.root;
  const position = root.position.clone();
  const rotation = root.quaternion.clone();
  actor.animator.update(dt, {
    speed: actor.movement.speed,
    blocking: controls.blocking,
    combat: actor.combat,
    dash: actor.movement.dash,
  });
  assert.ok(root.position.equals(position), "pose never translates the root");
  assert.ok(root.quaternion.equals(rotation), "pose never rotates the root");
  for (const joint of Object.values(actor.character.joints)) {
    assert.ok([...joint.position, ...joint.quaternion].every(Number.isFinite));
    assert.ok(Math.abs(joint.quaternion.length() - 1) < 0.00001);
  }
  root.updateMatrixWorld(true);
};
const settle = (actor, controls = input(), seconds = 1.5, dt = DT) => {
  for (let frame = 0; frame < Math.ceil(seconds / dt); frame++)
    step(actor, controls, dt);
};

test("an idle combat controller preserves the existing normal gait exactly", () => {
  const plain = rig();
  const integrated = rig();
  for (let frame = 0; frame < 300; frame++) {
    const speed = Math.max(0, Math.sin(frame / 39)) * 5.2;
    for (const actor of [plain, integrated]) {
      actor.character.root.position.z -= speed * DT;
      actor.character.root.rotation.y = Math.sin(frame / 51);
    }
    plain.animator.update(DT, { speed });
    integrated.combat.update(DT);
    integrated.animator.update(DT, { speed, combat: integrated.combat });
    assert.equal(integrated.animator.attackWeight, 0);
    assert.equal(integrated.animator.combatWeight, 0);
    for (const name of Object.keys(plain.character.joints)) {
      const before = plain.character.joints[name];
      const after = integrated.character.joints[name];
      assert.ok(after.position.equals(before.position), `${name} position`);
      assert.ok(after.quaternion.equals(before.quaternion), `${name} rotation`);
    }
  }
  plain.character.dispose();
  integrated.character.dispose();
});

test("one straight punch extends from guard at head height and recovers at 30/60/120Hz", () => {
  for (const dt of rates) {
    const actor = rig();
    settle(actor, input(0, true), 1.5, dt);
    const guardedHand = relative(actor, "rightHand");
    actor.combat.setBlocking(false);
    assert.equal(actor.combat.requestAttack(), true);
    let furthestAdvance = 0;
    let peakReach = 0;
    let peakElbow = 0;
    let peakYaw = 0;
    for (let frame = 0; frame < Math.ceil(1.8 / dt); frame++) {
      step(actor, input(), dt);
      const attack = actor.combat.attack;
      const head = relative(actor, "head");
      const right = relative(actor, "rightHand");
      const left = relative(actor, "leftHand");
      furthestAdvance = Math.max(furthestAdvance, guardedHand.z - right.z);
      if (attack.extension > peakReach) {
        peakReach = attack.extension;
        peakElbow = actor.character.joints.rightElbow.rotation.x;
        peakYaw = actor.character.joints.spine.rotation.y;
      }
      if (attack.extension > 0.8) {
        assert.ok(right.y > head.y - 0.28, "punch stays at head/chin height");
        assert.ok(left.y > head.y - 0.28, "opposite hand protects the chin");
        assert.ok(
          left.z < head.z - 0.1,
          "guard hand stays in front of the face",
        );
      }
    }
    assert.ok(peakReach > 0.9, "the actual lifecycle samples a full extension");
    assert.ok(furthestAdvance > 0.2, "fist advances visibly beyond the guard");
    assert.ok(
      peakElbow >= 0.09 && peakElbow < 0.3,
      "elbow extends without locking",
    );
    assert.ok(
      peakYaw > 0.2 && peakYaw < 0.4,
      "torso drives the right shoulder forward",
    );
    assert.equal(actor.combat.attack.active, false);
    assert.equal(actor.animator.attackWeight, 0);
    assert.ok(
      actor.animator.combatWeight < 0.01,
      "automatic guard returns to idle",
    );
    actor.character.dispose();
  }
});

test("attacking while creeping, walking and sprinting keeps movement and foot cycles live", () => {
  for (const speed of [0.65, 2.6, 5.2]) {
    const actor = rig();
    const comparison = rig();
    const controls = input(speed);
    settle(actor, controls);
    settle(comparison, controls);
    const phase = actor.animator.locomotion.phase;
    assert.equal(actor.combat.requestAttack(), true);
    let activeFrames = 0;
    const contacts = new Set();
    for (let frame = 0; frame < 75; frame++) {
      step(actor, controls);
      step(comparison, controls);
      assert.ok(
        actor.character.root.position.equals(
          comparison.character.root.position,
        ),
        "an upper-body strike leaves world movement unchanged",
      );
      assert.ok(Math.abs(actor.movement.speed - speed) < 0.001);
      if (actor.combat.attack.active) {
        activeFrames++;
        for (const foot of actor.animator.footList)
          contacts.add(`${foot.side}:${foot.planted}`);
      }
    }
    assert.ok(activeFrames > 15, "the complete punch plays during movement");
    assert.ok(actor.animator.locomotion.phase > phase + 0.6);
    assert.ok(
      contacts.size > 2,
      "feet continue changing support through the strike",
    );
    assert.ok(actor.animator.attackWeight === 0);
    actor.character.dispose();
    comparison.character.dispose();
  }
});

test("held Block keeps both hands guarding and releases smoothly without a residual stance", () => {
  const actor = rig();
  settle(actor);
  const idleHand = relative(actor, "rightHand");
  step(actor, input(0, true));
  assert.ok(relative(actor, "rightHand").distanceTo(idleHand) < 0.12);
  settle(actor, input(2.6, true));
  for (let frame = 0; frame < 60; frame++) {
    step(actor, input(2.6, true));
    const head = relative(actor, "head");
    for (const side of ["left", "right"]) {
      const hand = relative(actor, `${side}Hand`);
      const elbow = relative(actor, `${side}Elbow`);
      assert.ok(hand.y > head.y - 0.3);
      assert.ok(hand.y > elbow.y + 0.12);
    }
    assert.ok(Math.abs(actor.movement.speed - 2.6) < 0.001);
    assert.equal(actor.animator.attackWeight, 0);
  }
  const beforeRelease = relative(actor, "rightHand");
  step(actor, input(2.6));
  assert.ok(relative(actor, "rightHand").distanceTo(beforeRelease) < 0.12);
  settle(actor, input(), 2);
  assert.ok(actor.animator.combatWeight < 0.01);
  assert.ok(relative(actor, "rightHand").distanceTo(idleHand) < 0.03);
  actor.character.dispose();
});

test("Block interrupts an extending punch continuously and never resumes it after release", () => {
  const actor = rig();
  settle(actor);
  assert.equal(actor.combat.requestAttack(), true);
  while (actor.combat.attack.extension < 0.9) step(actor);
  let previousHand = relative(actor, "rightHand");
  let previousReach = actor.combat.attack.extension;
  for (let frame = 0; frame < 50; frame++) {
    step(actor, input(0, frame < 20));
    const hand = relative(actor, "rightHand");
    assert.ok(
      hand.distanceTo(previousHand) < 0.16,
      "cancelled fist recovers without a pose jump",
    );
    assert.ok(actor.combat.attack.extension <= previousReach + 1e-8);
    previousHand = hand;
    previousReach = actor.combat.attack.extension;
    assert.equal(
      actor.combat.attack.sequence,
      1,
      "no buffered or repeated strike",
    );
  }
  settle(actor);
  assert.equal(actor.combat.attack.active, false);
  assert.equal(actor.animator.attackWeight, 0);
  assert.ok(actor.animator.combatWeight < 0.01);
  actor.character.dispose();
});

test("punch and Block blend with a steered dash without changing its path or landing", () => {
  for (const dt of rates) {
    const actor = rig();
    const comparison = rig();
    settle(actor, input(), 1, dt);
    settle(comparison, input(), 1, dt);
    actor.movement.requestDash();
    comparison.movement.requestDash();
    actor.combat.requestAttack();
    let leaned = false;
    let rolled = false;
    for (let frame = 0; frame < Math.ceil(1.5 / dt); frame++) {
      const time = frame * dt;
      const controls = {
        move: time < 0.1 ? { x: 0.8, y: 0.6 } : { x: -0.4, y: 0.9 },
        sprinting: false,
        blocking: time > 0.14 && time < 0.5,
      };
      step(actor, controls, dt);
      step(comparison, { ...controls, blocking: false }, dt);
      assert.ok(
        actor.character.root.position.equals(
          comparison.character.root.position,
        ),
      );
      assert.ok(
        actor.character.root.quaternion.equals(
          comparison.character.root.quaternion,
        ),
      );
      assert.equal(
        actor.movement.dash.distanceTravelled,
        comparison.movement.dash.distanceTravelled,
      );
      if (actor.movement.dash.active) {
        leaned ||= actor.character.joints.spine.rotation.x < -0.1;
        rolled ||= Math.abs(actor.animator.dashAnimation.spineRoll) > 0.03;
      }
    }
    assert.ok(leaned, "punch retains the physical dash lean");
    assert.ok(rolled, "punch retains directional dash roll");
    assert.equal(actor.movement.dash.exitReason, "completed");
    assert.equal(actor.animator.dashWeight, 0);
    assert.equal(actor.animator.attackWeight, 0);
    assert.ok(actor.animator.combatWeight < 0.01);
    actor.character.dispose();
    comparison.character.dispose();
  }
});
