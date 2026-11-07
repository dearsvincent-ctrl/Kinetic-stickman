import test from "node:test";
import assert from "node:assert/strict";
import { Box3, Vector3 } from "three";
import { Stickman } from "../src/character/Stickman.js";
import { CharacterAnimator } from "../src/character/CharacterAnimator.js";

const DT = 1 / 60;
const sides = ["left", "right"];
const controls = (speed = 0, blocking = false) => ({
  speed,
  maxSpeed: speed > 2.6 ? 5.2 : 2.6,
  sprinting: speed > 2.6,
  blocking,
});
const rig = () => {
  const character = new Stickman();
  return { character, animator: new CharacterAnimator(character) };
};
const position = (joint) => joint.getWorldPosition(new Vector3());
const update = (actor, input, move = true, dt = DT) => {
  if (move) actor.character.root.position.z -= input.speed * dt;
  actor.animator.update(dt, input);
  actor.character.root.updateMatrixWorld(true);
};
const settle = (actor, input, seconds = 1.5, move = true) => {
  for (let i = 0; i < Math.round(seconds / DT); i++) update(actor, input, move);
};
const bend = (a, b, c) => {
  const upper = position(b).sub(position(a));
  const lower = position(c).sub(position(b));
  return upper.angleTo(lower);
};
const correlation = (a, b) => {
  const meanA = a.reduce((sum, v) => sum + v, 0) / a.length;
  const meanB = b.reduce((sum, v) => sum + v, 0) / b.length;
  let numerator = 0,
    varianceA = 0,
    varianceB = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] - meanA,
      y = b[i] - meanB;
    numerator += x * y;
    varianceA += x * x;
    varianceB += y * y;
  }
  return numerator / Math.sqrt(varianceA * varianceB);
};

test("blocking guard blends in and out while raising both hands into protection", () => {
  const actor = rig();
  const j = actor.character.joints;
  settle(actor, controls());
  const idleHands = sides.map((side) => position(j[`${side}Hand`]));
  update(actor, controls(0, true));
  assert.ok(
    actor.animator.combatWeight > 0 && actor.animator.combatWeight < 0.3,
  );
  for (const [index, side] of sides.entries()) {
    assert.ok(
      position(j[`${side}Hand`]).distanceTo(idleHands[index]) < 0.12,
      "first guard frame must not snap the hand into place",
    );
  }
  settle(actor, controls(0, true));
  assert.ok(actor.animator.combatWeight > 0.99);
  const head = position(j.head);
  for (const [index, side] of sides.entries()) {
    const hand = position(j[`${side}Hand`]);
    const elbow = position(j[`${side}Elbow`]);
    assert.ok(hand.y > idleHands[index].y + 0.45, `${side} fist is raised`);
    assert.ok(hand.y > head.y - 0.35, `${side} fist protects the chin`);
    assert.ok(hand.y > elbow.y + 0.12, `${side} forearm bends upward`);
    assert.ok(hand.z < head.z - 0.1, `${side} fist is in front of the face`);
    assert.ok(
      Math.abs(hand.x - head.x) < 0.34,
      `${side} fist stays close to the head`,
    );
    assert.ok(
      bend(j[`${side}Hip`], j[`${side}Knee`], j[`${side}Ankle`]) > 0.15,
      "guard leaves the knees flexed",
    );
  }
  const leftFoot = position(j.leftAnkle),
    rightFoot = position(j.rightAnkle);
  assert.ok(
    Math.abs(leftFoot.x - rightFoot.x) > 0.26,
    "guard has a balanced base",
  );
  assert.ok(
    Math.abs(leftFoot.z - rightFoot.z) > 0.1,
    "guard staggers the feet",
  );
  update(actor, controls());
  assert.ok(
    actor.animator.combatWeight > 0.6 && actor.animator.combatWeight < 1,
  );
  settle(actor, controls());
  assert.ok(actor.animator.combatWeight < 0.01);
  for (const [index, side] of sides.entries())
    assert.ok(
      Math.abs(position(j[`${side}Hand`]).y - idleHands[index].y) < 0.03,
    );
  actor.character.dispose();
});

test("walking and sprinting coordinate opposite arms and legs", () => {
  for (const speed of [2.6, 5.2]) {
    const actor = rig();
    settle(actor, controls(speed));
    const arm = [],
      thigh = [];
    for (let frame = 0; frame < 180; frame++) {
      update(actor, controls(speed));
      const j = actor.character.joints;
      arm.push(position(j.leftElbow).sub(position(j.leftShoulder)).z);
      thigh.push(position(j.leftKnee).sub(position(j.leftHip)).z);
    }
    assert.ok(
      correlation(arm, thigh) < -0.25,
      `same-side arm and thigh should oppose each other at ${speed} m/s`,
    );
    actor.character.dispose();
  }
});

test("cadence follows travel speed and sprint input alone does not run in place", () => {
  const idle = rig();
  settle(idle, { ...controls(), sprinting: true }, 2);
  assert.ok(idle.animator.locomotion.cadence < 0.01);
  const idlePhase = idle.animator.locomotion.phase;
  settle(idle, { ...controls(), sprinting: true }, 1);
  assert.ok(Math.abs(idle.animator.locomotion.phase - idlePhase) < 0.001);
  const slow = rig(),
    fast = rig();
  settle(slow, controls(0.6));
  settle(fast, controls(2.6));
  assert.ok(
    fast.animator.locomotion.cadence > slow.animator.locomotion.cadence,
  );
  assert.ok(slow.animator.locomotion.cadence > 0);
  settle(fast, controls(), 2);
  assert.ok(fast.animator.locomotion.cadence < 0.01);
  const stoppedPhase = fast.animator.locomotion.phase;
  settle(fast, controls(), 1);
  assert.ok(Math.abs(fast.animator.locomotion.phase - stoppedPhase) < 0.001);
  for (const actor of [idle, slow, fast]) actor.character.dispose();
});

test("planted feet stay close to their ground contact while walking and sprinting", () => {
  for (const speed of [2.6, 5.2]) {
    const actor = rig();
    settle(actor, controls(speed));
    const starts = { left: null, right: null };
    const samples = { left: 0, right: 0 };
    for (let frame = 0; frame < 180; frame++) {
      update(actor, controls(speed));
      for (const side of sides) {
        const ankle = actor.character.joints[`${side}Ankle`];
        const foot = actor.animator.feet[side];
        const actual = position(ankle);
        const box = new Box3().setFromObject(ankle);
        assert.ok(
          box.min.y >= -0.025,
          `${side} foot must not sink through the floor`,
        );
        if (foot.planted) {
          if (starts[side] === null) starts[side] = actual.clone();
          assert.ok(
            actual.distanceTo(starts[side]) < 0.045,
            `${side} planted ankle drift stays below 4.5 cm at ${speed} m/s`,
          );
          samples[side]++;
        } else starts[side] = null;
      }
    }
    for (const side of sides)
      assert.ok(samples[side] > 20, "both feet have real contact intervals");
    actor.character.dispose();
  }
});

test("guard uses controlled shorter steps without taking ownership of travel", () => {
  const free = rig(),
    guard = rig();
  for (let frame = 0; frame < 180; frame++) {
    update(free, controls(5.2));
    update(guard, controls(5.2, true));
  }
  assert.ok(
    guard.animator.locomotion.stride < free.animator.locomotion.stride,
    "guard contact travel remains shorter than an unguarded sprint",
  );
  assert.ok(
    guard.character.root.position.equals(free.character.root.position),
    "animation must preserve exactly the same game movement speed",
  );
  for (const side of sides) {
    const j = guard.character.joints;
    assert.ok(
      position(j[`${side}Hand`]).y > position(j[`${side}Elbow`]).y + 0.1,
      "moving guard keeps both hands raised",
    );
  }
  free.character.dispose();
  guard.character.dispose();
});

test("nearby movement speeds produce continuous poses across gait transitions", () => {
  for (const speed of [0.1, 0.65, 1.2, 2.4, 2.6, 3, 4.4]) {
    const lower = rig(),
      higher = rig();
    settle(lower, controls(speed - 0.0001), 2);
    settle(higher, controls(speed + 0.0001), 2);
    for (const name of [
      "hips",
      "leftHand",
      "rightHand",
      "leftAnkle",
      "rightAnkle",
    ]) {
      const low = position(lower.character.joints[name]).sub(
        lower.character.root.position,
      );
      const high = position(higher.character.joints[name]).sub(
        higher.character.root.position,
      );
      assert.ok(
        low.distanceTo(high) < 0.02,
        `${name} has no pose discontinuity at ${speed} m/s`,
      );
    }
    lower.character.dispose();
    higher.character.dispose();
  }
});

test("walking and guard stay quiet while athletic running loads and rises without a deep squat", () => {
  for (const blocking of [false, true]) {
    for (const speed of [0.6, 2.6, 5.2]) {
      const actor = rig();
      settle(actor, controls(speed, blocking));
      let lowest = Infinity,
        highest = -Infinity;
      for (let frame = 0; frame < 180; frame++) {
        update(actor, controls(speed, blocking));
        const height = actor.character.joints.hips.position.y;
        lowest = Math.min(lowest, height);
        highest = Math.max(highest, height);
      }
      assert.ok(
        highest - lowest <
          (blocking ? 0.04 : speed > 3.1 ? 0.21 : speed > 1.35 ? 0.13 : 0.09) &&
          lowest > 0.75,
        `pelvis stays controlled at ${speed} m/s with guard ${blocking}`,
      );
      actor.character.dispose();
    }
  }
});

test("animation transitions remain finite and preserve the root during turns and repeated toggles", () => {
  const actor = rig();
  const root = actor.character.root;
  const j = actor.character.joints;
  for (let frame = 0; frame < 900; frame++) {
    const speed = Math.max(0, Math.sin(frame / 67)) * 5.2;
    root.position.set(Math.sin(frame / 100) * 3, 0, -frame * 0.005);
    root.rotation.y = Math.sin(frame / 75) * Math.PI;
    const beforePosition = root.position.clone();
    const beforeRotation = root.quaternion.clone();
    update(actor, controls(speed, Math.floor(frame / 19) % 2 === 1), false);
    assert.ok(root.position.equals(beforePosition));
    assert.ok(root.quaternion.equals(beforeRotation));
    assert.ok(
      actor.animator.combatWeight >= 0 && actor.animator.combatWeight <= 1,
    );
    for (const joint of Object.values(j)) {
      assert.ok(
        [...joint.position, ...joint.quaternion].every(Number.isFinite),
      );
      assert.ok(Math.abs(joint.quaternion.length() - 1) < 0.0001);
    }
    for (const side of sides) {
      assert.ok(
        bend(j[`${side}Shoulder`], j[`${side}Elbow`], j[`${side}Hand`]) < 2.65,
        "arm does not fold into an unnatural full reversal",
      );
      assert.ok(
        bend(j[`${side}Hip`], j[`${side}Knee`], j[`${side}Ankle`]) < 2.65,
        "knee stays within a human flexion range",
      );
    }
  }
  actor.character.dispose();
});
