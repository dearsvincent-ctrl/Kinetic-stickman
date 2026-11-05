import test from "node:test";
import assert from "node:assert/strict";
import { Vector3 } from "three";
import { Stickman } from "../src/character/Stickman.js";
import { CharacterAnimator } from "../src/character/CharacterAnimator.js";
import { CharacterController } from "../src/movement/CharacterController.js";
import { CombatController } from "../src/combat/CombatController.js";
import { ProximityCombatController } from "../src/combat/ProximityCombatController.js";
import { ArenaBounds } from "../src/world/ArenaBounds.js";

const DT = 1 / 60;
const input = (x = 0, y = 0, sprinting = false, blocking = false) => ({
  move: { x, y },
  sprinting,
  blocking,
});
const opponent = (x = 0, z = -0.8) => ({
  id: "registered-training-target",
  position: new Vector3(x, 0, z),
  active: false,
});
const rig = (targets = []) => {
  const character = new Stickman();
  const combat = new CombatController();
  return {
    character,
    combat,
    animator: new CharacterAnimator(character),
    // Targets are metadata in these integration tests, leaving the swept path
    // collision-free so animation/automatic attacks cannot hide root drift.
    movement: new CharacterController(character.root, new ArenaBounds(100)),
    proximity: new ProximityCombatController(combat, {
      targets,
      entryDistance: 1,
      exitDistance: 1.15,
    }),
  };
};
const relative = (actor, name) =>
  actor.character.joints[name]
    .getWorldPosition(new Vector3())
    .sub(actor.character.root.position)
    .applyQuaternion(actor.character.root.quaternion.clone().invert());

// The production order is movement/facing -> target/action timing -> animation.
// There are no manual requestAttack calls anywhere in this file.
const step = (actor, controls = input(), dt = DT, cameraYaw = 0) => {
  actor.movement.update(
    dt,
    controls,
    cameraYaw,
    actor.proximity.target?.position,
  );
  actor.proximity.update(dt, {
    position: actor.character.root.position,
    blocking: controls.blocking,
    facing: actor.movement.heading,
    context: {
      speed: actor.movement.speed,
      facing: actor.movement.heading,
      dashActive: actor.movement.dash.active,
      movementDirection: actor.movement.velocity.toArray(),
    },
  });
  const root = actor.character.root;
  const position = root.position.clone();
  const rotation = root.quaternion.clone();
  actor.animator.update(dt, {
    speed: actor.movement.speed,
    blocking: controls.blocking,
    combat: actor.combat,
    dash: actor.movement.dash,
  });
  assert.ok(
    root.position.equals(position),
    "automatic combat pose never translates the root",
  );
  assert.ok(
    root.quaternion.equals(rotation),
    "automatic combat pose never rotates the root",
  );
  for (const joint of Object.values(actor.character.joints)) {
    assert.ok([...joint.position, ...joint.quaternion].every(Number.isFinite));
    assert.ok(Math.abs(joint.quaternion.length() - 1) < 0.00001);
  }
  root.updateMatrixWorld(true);
};
const settle = (actor, controls = input(), seconds = 1, dt = DT) => {
  for (let frame = 0; frame < Math.ceil(seconds / dt); frame++)
    step(actor, controls, dt);
};
const sameMovement = (actor, comparison) => {
  assert.ok(
    actor.character.root.position.equals(comparison.character.root.position),
    "automatic punches and target facing preserve the exact movement path",
  );
  assert.equal(actor.movement.speed, comparison.movement.speed);
  assert.ok(actor.movement.velocity.equals(comparison.movement.velocity));
};

test("a nearby registered target automatically repeats complete, smooth punches while stationary", () => {
  for (const dt of [1 / 30, 1 / 60, 1 / 120]) {
    const target = opponent();
    const actor = rig([target]);
    settle(actor, input(), 1, dt);
    assert.equal(actor.combat.attack.sequence, 0);
    const origin = actor.character.root.position.clone();
    target.active = true;
    const phases = new Set();
    const peaks = new Map();
    let previousHand = relative(actor, "rightHand");
    for (let frame = 0; frame < Math.ceil(2.1 / dt); frame++) {
      step(actor, input(), dt);
      const attack = actor.combat.attack;
      phases.add(attack.phase);
      peaks.set(
        attack.sequence,
        Math.max(peaks.get(attack.sequence) ?? 0, attack.extension),
      );
      assert.equal(attack.context.source, "proximity");
      assert.equal(attack.context.targetId, target.id);
      assert.ok(actor.character.root.position.equals(origin));
      const hand = relative(actor, "rightHand");
      // Preserve v0.5's initial free-idle -> punch entry. Once active, repeated
      // cycles and recovery must remain continuous without dropping the guard.
      if (
        attack.sequence > 1 ||
        attack.phase === "recovery" ||
        attack.phase === "idle"
      )
        assert.ok(
          hand.distanceTo(previousHand) < (0.18 * dt) / DT,
          "repeated punches and recovery do not snap between poses",
        );
      previousHand = hand;
    }
    assert.ok(
      actor.combat.attack.sequence >= 4,
      "standing in range produces further unbuffered punches",
    );
    for (const phase of ["windup", "extension", "recovery"])
      assert.ok(phases.has(phase));
    assert.ok(
      [...peaks.values()].filter((reach) => reach > 0.9).length >= 3,
      "repetition preserves full extension and recovery instead of restarting windup",
    );
    actor.character.dispose();
  }
});

test("automatic punches wait for bounded target-facing rotation instead of striking behind the actor", () => {
  const target = opponent(0, 0.8);
  target.active = true;
  const actor = rig([target]);
  step(actor);
  assert.equal(actor.proximity.target, target);
  assert.equal(
    actor.combat.attack.sequence,
    0,
    "target behind the character is not attack-aligned",
  );
  const origin = actor.character.root.position.clone();
  let previousHeading = actor.movement.heading;
  for (
    let frame = 0;
    frame < 120 && actor.combat.attack.sequence === 0;
    frame++
  ) {
    step(actor);
    assert.ok(
      Math.abs(actor.movement.heading - previousHeading) <= 6 * DT + 1e-8,
    );
    assert.ok(
      actor.character.root.position.equals(origin),
      "facing does not pull the actor toward the target",
    );
    previousHeading = actor.movement.heading;
  }
  assert.equal(actor.combat.attack.sequence, 1);
  assert.ok(actor.proximity.aligned);
  actor.character.dispose();
});

test("walking and sprinting past a target keep their exact path, speed and live foot cycles", () => {
  for (const speed of [2.6, 5.2]) {
    const target = opponent();
    const actor = rig([target]);
    const comparison = rig();
    const controls = input(0, 1, speed > 2.6);
    settle(actor, controls);
    settle(comparison, controls);
    target.position
      .copy(actor.character.root.position)
      .add(new Vector3(0.6, 0, -0.9));
    target.active = true;
    const phase = actor.animator.locomotion.phase;
    let attackingFrames = 0;
    let maximumReach = 0;
    const contacts = new Set();
    for (let frame = 0; frame < 96; frame++) {
      step(actor, controls);
      step(comparison, controls);
      sameMovement(actor, comparison);
      assert.ok(Math.abs(actor.movement.speed - speed) < 0.001);
      maximumReach = Math.max(maximumReach, actor.combat.attack.extension);
      if (actor.combat.attack.active) {
        attackingFrames++;
        for (const foot of actor.animator.footList)
          contacts.add(`${foot.side}:${foot.planted}`);
      }
    }
    assert.ok(
      attackingFrames > 15,
      "an automatic punch plays while the character passes the target",
    );
    assert.ok(maximumReach > 0.9);
    assert.ok(actor.animator.locomotion.phase > phase + 1);
    assert.ok(
      contacts.size > 2,
      "upper-body punches preserve changing foot support",
    );
    assert.equal(
      actor.proximity.target,
      null,
      "a swept-past target is released",
    );
    assert.equal(actor.combat.attack.active, false);
    actor.character.dispose();
    comparison.character.dispose();
  }
});

test("automatic combat leaves a steered dash and its landing unchanged", () => {
  const target = opponent();
  const actor = rig([target]);
  const comparison = rig();
  settle(actor);
  settle(comparison);
  target.active = true;
  assert.equal(actor.movement.requestDash(), true);
  assert.equal(comparison.movement.requestDash(), true);
  let simultaneousFrames = 0;
  let leaned = false;
  let rolled = false;
  let selectedWhileDashing = false;
  let initialDirection;
  for (let frame = 0; frame < 120; frame++) {
    const time = frame * DT;
    target.position
      .copy(actor.character.root.position)
      .add(new Vector3(0, 0, -0.8));
    target.active = time < 0.55;
    const controls =
      time < 0.5
        ? input(time < 0.1 ? 0.8 : -0.4, time < 0.1 ? 0.6 : 0.9)
        : input();
    step(actor, controls);
    step(comparison, controls);
    sameMovement(actor, comparison);
    assert.equal(
      actor.movement.dash.distanceTravelled,
      comparison.movement.dash.distanceTravelled,
    );
    assert.equal(actor.animator.dashWeight, comparison.animator.dashWeight);
    if (actor.movement.dash.active && !initialDirection)
      initialDirection = actor.movement.dash.direction.clone();
    if (actor.movement.dash.active && actor.combat.attack.active) {
      simultaneousFrames++;
      leaned ||= actor.character.joints.spine.rotation.x < -0.1;
      rolled ||= Math.abs(actor.animator.dashAnimation.spineRoll) > 0.03;
      selectedWhileDashing ||= actor.combat.attack.context.dashActive;
    }
  }
  assert.ok(simultaneousFrames > 4);
  assert.ok(
    selectedWhileDashing,
    "automatic selection receives the live dash context",
  );
  assert.ok(
    leaned && rolled,
    "the dash retains directional lean during the punch",
  );
  assert.ok(
    initialDirection.distanceTo(actor.movement.dash.direction) > 0.2,
    "joystick steering remains effective",
  );
  assert.equal(actor.movement.dash.exitReason, "completed");
  assert.ok(Math.abs(actor.movement.dash.distanceTravelled - 2.5) < 0.000001);
  assert.equal(actor.animator.dashWeight, 0);
  assert.equal(actor.animator.attackWeight, 0);
  actor.character.dispose();
  comparison.character.dispose();
});

test("leaving range during a punch completes its recovery without requesting another strike", () => {
  const target = opponent();
  target.active = true;
  const actor = rig([target]);
  step(actor);
  assert.equal(actor.combat.attack.sequence, 1);
  assert.ok(actor.combat.attack.active);
  let leftDuringPunch = false;
  let completedExtension = false;
  for (let frame = 0; frame < 90; frame++) {
    step(actor, input(0, -1, true));
    if (!actor.proximity.target && actor.combat.attack.active)
      leftDuringPunch = true;
    completedExtension ||= actor.combat.attack.extension > 0.9;
    assert.equal(
      actor.combat.attack.sequence,
      1,
      "no pending punch survives range exit",
    );
    assert.equal(
      actor.combat.attack.cancelled,
      false,
      "range exit allows the current punch to finish",
    );
  }
  assert.ok(leftDuringPunch);
  assert.ok(completedExtension);
  assert.equal(actor.combat.attack.active, false);
  assert.equal(actor.combat.attack.exitReason, "completed");
  assert.equal(actor.animator.attackWeight, 0);
  assert.ok(actor.animator.combatWeight < 0.01);
  actor.character.dispose();
});

test("held Block suppresses and cancels automatic punches, then resumes only on release", () => {
  const target = opponent();
  target.active = true;
  const actor = rig([target]);
  settle(actor, input(0, 0, false, true));
  assert.equal(actor.combat.attack.sequence, 0);
  assert.equal(actor.combat.ready, false);
  step(actor);
  assert.equal(actor.combat.attack.sequence, 1);
  for (
    let frame = 0;
    frame < 20 && actor.combat.attack.extension < 0.9;
    frame++
  )
    step(actor);
  assert.ok(actor.combat.attack.extension > 0.9);
  let previousReach = actor.combat.attack.extension;
  for (let frame = 0; frame < 60; frame++) {
    step(actor, input(0, 0, false, true));
    assert.equal(
      actor.combat.attack.sequence,
      1,
      "Block never queues an automatic strike",
    );
    assert.ok(actor.combat.attack.extension <= previousReach + 1e-8);
    previousReach = actor.combat.attack.extension;
  }
  assert.equal(actor.combat.attack.cancelled, true);
  assert.equal(actor.combat.attack.exitReason, "blocked");
  assert.equal(actor.combat.attack.active, false);
  assert.equal(actor.animator.attackWeight, 0);
  const head = relative(actor, "head");
  for (const side of ["left", "right"])
    assert.ok(relative(actor, `${side}Hand`).y > head.y - 0.3);
  step(actor);
  assert.equal(
    actor.combat.attack.sequence,
    2,
    "release permits a fresh automatic request",
  );
  assert.equal(actor.combat.attack.cancelled, false);
  assert.equal(actor.combat.attack.context.source, "proximity");
  actor.character.dispose();
});
