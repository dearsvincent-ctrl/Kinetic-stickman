import test from "node:test";
import assert from "node:assert/strict";
import { Box3, Vector3 } from "three";
import { Stickman } from "../src/character/Stickman.js";
import { CharacterAnimator } from "../src/character/CharacterAnimator.js";
import { CharacterController } from "./helpers/ControllerFixture.js";
import { DashState } from "../src/movement/DashState.js";
import { ArenaBounds } from "../src/world/ArenaBounds.js";

const DT = 1 / 120;
const RATES = [1 / 30, 1 / 60, 1 / 120];
const sides = ["left", "right"];
const controls = (x = 0, y = 0, sprinting = false, blocking = false) => ({
  move: { x, y },
  sprinting,
  blocking,
});
const rig = (halfSize = 100) => {
  const character = new Stickman();
  return {
    character,
    animator: new CharacterAnimator(character),
    controller: new CharacterController(
      character.root,
      new ArenaBounds(halfSize),
    ),
  };
};
const world = (joint) => joint.getWorldPosition(new Vector3());
const relative = (actor, joint) =>
  world(joint).sub(actor.character.root.position);

// Match Game's lifecycle: controller resolves movement and may finish the dash
// before animation sees this frame. Animation must never write the root back.
const step = (actor, input = controls(), dt = DT, cameraYaw = 0) => {
  actor.controller.update(dt, input, cameraYaw);
  const root = actor.character.root;
  const position = root.position.clone();
  const rotation = root.quaternion.clone();
  actor.animator.update(dt, {
    speed: actor.controller.speed,
    blocking: input.blocking,
    dash: actor.controller.dash,
  });
  assert.ok(
    root.position.equals(position),
    "animation leaves root translation to the controller",
  );
  assert.ok(
    root.quaternion.equals(rotation),
    "animation leaves root heading to the controller",
  );
  for (const joint of Object.values(actor.character.joints)) {
    assert.ok([...joint.position, ...joint.quaternion].every(Number.isFinite));
    assert.ok(Math.abs(joint.quaternion.length() - 1) < 0.0001);
  }
  root.updateMatrixWorld(true);
  for (const side of sides) {
    const ankle = actor.character.joints[`${side}Ankle`];
    assert.ok(
      new Box3().setFromObject(ankle).min.y > -0.025,
      "feet stay above the arena floor",
    );
  }
};
const settle = (actor, blocking = false) => {
  for (let frame = 0; frame < 180; frame++)
    step(actor, controls(0, 0, false, blocking));
};

test("an inactive dash leaves the existing animation path unchanged", () => {
  const plain = rig();
  const integrated = rig();
  const dash = new DashState();
  for (let frame = 0; frame < 360; frame++) {
    const speed = Math.max(0, Math.sin(frame / 39)) * 5.2;
    const blocking = Math.floor(frame / 43) % 2 === 1;
    for (const actor of [plain, integrated]) {
      actor.character.root.position.z -= speed * DT;
      actor.character.root.rotation.y = Math.sin(frame / 50);
    }
    plain.animator.update(DT, { speed, blocking });
    integrated.animator.update(DT, { speed, blocking, dash });
    assert.equal(integrated.animator.dashWeight, 0);
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

test("real controller dash pushes, bounds, lands and recovers at 30/60/120Hz", () => {
  for (const dt of RATES) {
    const actor = rig();
    settle(actor);
    const initialHip = actor.character.joints.hips.position.y;
    const initialFeet = actor.animator.footList.map((foot) =>
      foot.target.clone(),
    );
    const initialAnkles = sides.map((side) =>
      world(actor.character.joints[`${side}Ankle`]),
    );
    const startPhase = actor.animator.locomotion.phase;
    const dash = actor.controller.dash;
    actor.controller.requestDash();
    let lowestHip = initialHip;
    let highestFoot = 0;
    let airborneTime = 0;
    let activeLanding = false;
    for (let frame = 0; frame < 40; frame++) {
      step(actor, controls(), dt);
      const animation = actor.animator.dashAnimation;
      if (dash.active && dash.elapsed <= 0.04) {
        const rear = actor.animator.footList[animation.rear];
        assert.ok(rear.planted, "rear foot supplies the initial floor contact");
        assert.ok(
          rear.target.distanceTo(initialFeet[animation.rear]) < 0.00001,
        );
        assert.ok(
          world(actor.character.joints[`${rear.side}Ankle`]).distanceTo(
            initialAnkles[animation.rear],
          ) < 0.045,
        );
      }
      lowestHip = Math.min(lowestHip, actor.character.joints.hips.position.y);
      if (dash.active && actor.animator.footList.every((foot) => !foot.planted))
        airborneTime += dt;
      if (dash.active && dash.progress > 0.85) {
        const front = actor.animator.footList[1 - animation.rear];
        activeLanding ||= front.planted;
      }
      for (const foot of actor.animator.footList)
        highestFoot = Math.max(highestFoot, foot.target.y);
      if (!dash.active) break;
    }
    assert.equal(dash.exitReason, "completed");
    assert.equal(dash.active, false);
    assert.ok(
      lowestHip < initialHip - 0.03,
      "push-off visibly flexes the legs",
    );
    assert.ok(
      highestFoot > 0.2 && highestFoot < 0.35,
      "one athletic low bound with controlled knee lift",
    );
    assert.ok(
      airborneTime >= 0.1,
      "feet travel through the burst above the floor",
    );
    assert.ok(
      actor.animator.locomotion.phase - startPhase < 0.7,
      "dash speed never drives a frantic gait cycle",
    );
    assert.ok(
      activeLanding,
      `front contact is sampled before finish at ${1 / dt}Hz`,
    );
    const front =
      actor.animator.footList[1 - actor.animator.dashAnimation.rear];
    assert.ok(
      front.planted,
      "the controller's completed event preserves a touchdown frame",
    );
    assert.ok(Math.abs(front.target.y - 0.1) < 1e-8);
    assert.ok(
      actor.animator.dashWeight > 0.95,
      "completion cannot instantly reset the pose",
    );
    let previousWeight = actor.animator.dashWeight;
    for (let frame = 0; frame < Math.ceil(0.4 / dt); frame++) {
      step(actor, controls(), dt);
      assert.ok(actor.animator.dashWeight <= previousWeight);
      previousWeight = actor.animator.dashWeight;
    }
    assert.equal(actor.animator.dashWeight, 0);
    assert.ok(actor.animator.footList.every((foot) => foot.planted));
    actor.character.dispose();
  }
});

test("completion resolves touchdown when a frame skips the active landing window", () => {
  const actor = rig();
  settle(actor);
  actor.controller.requestDash();
  for (let frame = 0; frame < 4; frame++) step(actor, controls(), 0.05);
  assert.ok(actor.controller.dash.active);
  assert.ok(Math.abs(actor.controller.dash.progress - 0.8) < 1e-8);
  assert.equal(actor.animator.dashAnimation.landed, false);
  const front = actor.animator.footList[1 - actor.animator.dashAnimation.rear];
  assert.equal(front.planted, false);
  const previousAnkle = world(actor.character.joints[`${front.side}Ankle`]);
  step(actor, controls(), 0.05);
  assert.equal(actor.controller.dash.exitReason, "completed");
  assert.ok(front.planted, "completed event supplies the skipped touchdown");
  assert.ok(Math.abs(front.target.y - 0.1) < 1e-8);
  assert.ok(
    world(actor.character.joints[`${front.side}Ankle`]).distanceTo(
      previousAnkle,
    ) < 0.25,
    "touchdown remains a short continuous step",
  );
  assert.ok(actor.animator.dashWeight > 0.95);
  for (let frame = 0; frame < 8; frame++) step(actor, controls(), 0.05);
  assert.equal(actor.animator.dashWeight, 0);
  actor.character.dispose();
});

test("mid-dash lean follows world travel while the controller's heading catches up", () => {
  const actor = rig();
  actor.character.root.rotation.y = Math.PI / 2;
  actor.controller.heading = Math.PI / 2;
  settle(actor);
  actor.controller.requestDash();
  for (let frame = 0; frame < 6; frame++) step(actor, controls(0, 1));
  assert.ok(actor.controller.dash.active);
  assert.ok(
    actor.controller.dash.progress < 0.3,
    "sample the lean during the burst",
  );
  const forward = new Vector3(0, 0, -1);
  const torso = world(actor.character.joints.neck).sub(
    world(actor.character.joints.spine),
  );
  assert.ok(
    torso.dot(forward) > 0.1,
    "torso leans into actual travel despite a lagging root heading",
  );
  assert.ok(Math.abs(actor.character.joints.spine.rotation.z) > 0.12);
  actor.character.dispose();
});

test("a real completed dash retains both protective fists and the selected guard", () => {
  const actor = rig();
  settle(actor, true);
  actor.controller.requestDash();
  for (let frame = 0; frame < 40; frame++) {
    step(actor, controls(0, 0, false, true));
    for (const side of sides) {
      const hand = world(actor.character.joints[`${side}Hand`]);
      const elbow = world(actor.character.joints[`${side}Elbow`]);
      const head = world(actor.character.joints.head);
      assert.ok(hand.y > elbow.y + 0.1, `${side} guard forearm stays raised`);
      assert.ok(hand.y > head.y - 0.35, `${side} fist still protects the chin`);
    }
    if (!actor.controller.dash.active) break;
  }
  assert.equal(actor.controller.dash.exitReason, "completed");
  for (let frame = 0; frame < 30; frame++)
    step(actor, controls(0, 0, false, true));
  assert.equal(actor.animator.dashWeight, 0);
  assert.ok(actor.animator.combatWeight > 0.99);
  assert.ok(actor.character.joints.leftShoulder.rotation.x > 1);
  assert.ok(actor.character.joints.rightShoulder.rotation.x > 1);
  actor.character.dispose();
});

test("a wall-blocked controller dash blends out without stale contacts or joint snapping", () => {
  for (const dt of RATES) {
    const actor = rig(1.2);
    settle(actor);
    actor.controller.requestDash();
    for (let frame = 0; frame < 40; frame++) {
      step(actor, controls(), dt);
      if (!actor.controller.dash.active) break;
    }
    assert.equal(actor.controller.dash.exitReason, "blocked");
    assert.ok(actor.character.root.position.z >= -0.84 - 1e-8);
    let previousHand = relative(actor, actor.character.joints.leftHand);
    for (let frame = 0; frame < Math.ceil(0.4 / dt); frame++) {
      step(actor, controls(), dt);
      const hand = relative(actor, actor.character.joints.leftHand);
      assert.ok(
        hand.distanceTo(previousHand) < 7 * dt + 0.01,
        "recovery bounds the joint's return speed across frame rates",
      );
      previousHand = hand;
      for (const foot of actor.animator.footList)
        assert.ok(foot.target.distanceTo(actor.character.root.position) < 0.7);
    }
    assert.equal(actor.animator.dashWeight, 0);
    assert.ok(actor.animator.footList.every((foot) => foot.planted));
    actor.character.dispose();
  }
});

test("landing and recovery stay finite while sprint momentum continues", () => {
  for (const dt of RATES) {
    for (const blocking of [false, true]) {
      const actor = rig();
      const input = controls(0, 1, true, blocking);
      for (let frame = 0; frame < Math.ceil(1 / dt); frame++)
        step(actor, input, dt);
      actor.controller.requestDash();
      for (let frame = 0; frame < 40; frame++) {
        step(actor, input, dt);
        if (!actor.controller.dash.active) break;
      }
      assert.equal(actor.controller.dash.exitReason, "completed");
      assert.ok(Math.abs(actor.controller.velocity.length() - 5.2) < 0.01);
      const front =
        actor.animator.footList[1 - actor.animator.dashAnimation.rear];
      assert.ok(
        front.planted,
        "sprint dash also resolves its touchdown before recovery",
      );
      const afterDash = actor.character.root.position.clone();
      const previous = sides.map((side) =>
        relative(actor, actor.character.joints[`${side}Ankle`]),
      );
      let contactFrames = 0;
      const frames = Math.ceil(0.5 / dt);
      for (let frame = 0; frame < frames; frame++) {
        step(actor, input, dt);
        for (let i = 0; i < 2; i++) {
          const ankle = relative(
            actor,
            actor.character.joints[`${sides[i]}Ankle`],
          );
          assert.ok(
            ankle.distanceTo(previous[i]) < 0.08 + 12 * dt,
            "feet hand off continuously to sprinting",
          );
          previous[i].copy(ankle);
          if (actor.animator.footList[i].planted) contactFrames++;
        }
      }
      assert.ok(
        Math.abs(
          actor.character.root.position.distanceTo(afterDash) -
            5.2 * frames * dt,
        ) < 0.01,
      );
      assert.equal(actor.animator.dashWeight, 0);
      assert.ok(
        contactFrames > 0,
        "ordinary ground contacts resume after the bound",
      );
      if (blocking) assert.ok(actor.animator.combatWeight > 0.99);
      actor.character.dispose();
    }
  }
});
