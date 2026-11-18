import test from "node:test";
import assert from "node:assert/strict";
import { Vector3 } from "three";
import { ANIME_STYLE } from "../src/character/AnimationStyle.js";
import { LocomotionAnimator } from "../src/character/LocomotionAnimator.js";
import { RunningGait } from "../src/character/RunningGait.js";
import { CharacterAnimator } from "../src/character/CharacterAnimator.js";
import { Stickman } from "../src/character/Stickman.js";
import { CharacterController } from "../src/movement/CharacterController.js";
import { ArenaBounds } from "../src/world/ArenaBounds.js";
import {
  movementSubsteps,
  sandboxMovementConfig,
} from "../src/sandbox/PhysicsSandbox.js";

const relative = (character, name) =>
  character.joints[name]
    .getWorldPosition(new Vector3())
    .sub(character.root.position);

test("v087 actual speed adds bounded opposing drive while preserving the identical contact clock", () => {
  const normal = new LocomotionAnimator();
  const fast = new LocomotionAnimator();
  const excessive = new LocomotionAnimator();
  const quiet = new LocomotionAnimator();
  fast.aggression = excessive.aggression = 1.5;
  quiet.aggression = 0;
  const poses = [normal, fast, excessive, quiet].map(() => ({
    arms: [{}, {}],
  }));
  let front = 0,
    back = 0;
  for (let n = 0; n < 360; n++) {
    for (const [index, gait] of [normal, fast, excessive, quiet].entries()) {
      gait.update(1 / 120, {
        speed: 5.2,
        actualSpeed: [5.2, 520, 1e12, 520][index],
      });
      gait.sampleUpperBody(poses[index]);
      assert.equal(gait.phase, normal.phase);
      assert.equal(gait.cadence, normal.cadence);
      assert.equal(gait.stride, normal.stride);
      assert.equal(gait.duty, normal.duty);
    }
    assert.deepEqual(
      poses[0],
      poses[3],
      "Zero accent retains the existing sprint pose",
    );
    assert.deepEqual(poses[1], poses[2], "Pose growth saturates at 100x speed");
    assert.ok(poses[1].spinePitch >= poses[0].spinePitch - 0.113);
    assert.ok(
      Math.abs(poses[1].spineYaw) <= Math.abs(poses[0].spineYaw) + 0.024,
    );
    assert.equal(
      poses[1].arms[0].z,
      poses[0].arms[0].z,
      "Aggression does not widen the arms",
    );
    for (let arm = 0; arm < 2; arm++)
      assert.ok(Math.abs(poses[1].arms[arm].x - poses[0].arms[arm].x) <= 0.181);
    front = Math.max(front, ...poses[1].arms.map((arm) => arm.x));
    back = Math.min(back, ...poses[1].arms.map((arm) => arm.x));
  }
  assert.ok(fast.highSpeedBlend > 0.99 && normal.highSpeedBlend === 0);
  assert.ok(poses[1].spinePitch < poses[0].spinePitch - 0.1);
  assert.ok(front > 0.7 && back < -0.7);
});

test("v087 faster heel recovery preserves contact endpoints and knee height", () => {
  const s = ANIME_STYLE.locomotion;
  const normal = new RunningGait(s),
    fast = new RunningGait(s);
  fast.highSpeedDrive = 1.5;
  const sample = (gait, t) =>
    gait.sampleFoot(t, s.sprintStride, 1.5, 1, new Vector3());
  for (const t of [0, 1]) assert.deepEqual(sample(normal, t), sample(fast, t));
  const heel = sample(normal, s.heelFraction),
    fastHeel = sample(fast, s.heelFraction);
  assert.ok(fastHeel.z > heel.z && fastHeel.y > heel.y);
  assert.equal(
    sample(normal, s.kneeFraction).y,
    sample(fast, s.kneeFraction).y,
  );
  for (let n = 1; n < 200; n++) {
    const a = sample(fast, (n - 1) / 200),
      b = sample(fast, n / 200);
    assert.ok([...b].every(Number.isFinite));
    assert.ok(
      a.distanceTo(b) < 0.04,
      "The original continuous recovery curve stays smooth",
    );
    assert.ok(b.y >= 0 && b.y < 0.61);
  }
});

test("v087 1x/100x starts, stops and guard handoffs keep finite continuous rig goals at 30/60/120Hz", () => {
  for (const rate of [30, 60, 120]) {
    const character = new Stickman(),
      animator = new CharacterAnimator(character);
    const dt = 1 / rate;
    let previousHand, previousFoot;
    for (const speed of [0, 0.65, 2.6, 5.2, 520, 5.2, 0]) {
      for (let n = 0; n < rate; n++) {
        character.root.position.z -= speed * dt;
        const position = character.root.position.clone(),
          rotation = character.root.quaternion.clone();
        animator.update(dt, {
          speed,
          sandbox: true,
          blocking: speed === 520 && n > rate / 2,
        });
        assert.ok(
          character.root.position.equals(position) &&
            character.root.quaternion.equals(rotation),
        );
        assert.ok(
          animator.locomotion.cadence <= ANIME_STYLE.locomotion.guardCadence,
        );
        for (const joint of Object.values(character.joints))
          assert.ok(
            [...joint.position, ...joint.quaternion].every(Number.isFinite),
          );
        for (const foot of animator.footList) {
          assert.ok([...foot.target].every(Number.isFinite));
          assert.ok(
            Math.hypot(foot.target.x - position.x, foot.target.z - position.z) <
              0.9,
          );
        }
        const hand = relative(character, "rightHand"),
          foot = relative(character, "rightAnkle");
        if (previousHand)
          assert.ok(hand.distanceTo(previousHand) < 22 * dt + 0.04);
        if (previousFoot)
          assert.ok(foot.distanceTo(previousFoot) < 22 * dt + 0.04);
        previousHand = hand;
        previousFoot = foot;
      }
    }
    assert.ok(animator.locomotion.running.highSpeedDrive < 0.0001);
    character.dispose();
  }
});

test("v087 aggression changes no resolved movement at 1x or 100x", () => {
  for (const multiplier of [1, 100]) {
    const actors = [0, 1.5].map((aggression) => {
      const character = new Stickman(),
        animator = new CharacterAnimator(character);
      const controller = new CharacterController(
        character.root,
        new ArenaBounds(10000),
      );
      controller.applyMovementConfig(
        sandboxMovementConfig({ movement: multiplier }),
      );
      animator.locomotion.aggression = aggression;
      return { character, animator, controller };
    });
    for (let n = 0; n < 150; n++) {
      const input = {
        move: { x: 0, y: 1 },
        movementMagnitude: n < 100 ? 1 : 0,
      };
      for (const { character, animator, controller } of actors) {
        const steps = movementSubsteps(controller, 1 / 60);
        for (let i = 0; i < steps; i++)
          controller.update(1 / (60 * steps), input, 0);
        const position = character.root.position.clone(),
          rotation = character.root.quaternion.clone();
        animator.update(1 / 60, {
          speed: controller.speed,
          sandbox: true,
          jump: controller.jump,
          dash: controller.dash,
        });
        assert.ok(
          character.root.position.equals(position) &&
            character.root.quaternion.equals(rotation),
        );
      }
      assert.deepEqual(
        actors[0].character.root.position,
        actors[1].character.root.position,
      );
      assert.ok(
        actors[0].character.root.quaternion.equals(
          actors[1].character.root.quaternion,
        ),
      );
      assert.deepEqual(
        actors[0].controller.velocity,
        actors[1].controller.velocity,
      );
      assert.equal(actors[0].controller.speed, actors[1].controller.speed);
      assert.equal(
        actors[0].animator.locomotion.phase,
        actors[1].animator.locomotion.phase,
      );
    }
    for (const { character } of actors) character.dispose();
  }
});
