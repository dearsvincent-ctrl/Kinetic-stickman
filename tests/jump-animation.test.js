import test from "node:test";
import assert from "node:assert/strict";
import { Quaternion, Vector3 } from "three";
import { Stickman } from "../src/character/Stickman.js";
import { CharacterAnimator } from "../src/character/CharacterAnimator.js";
import { CharacterController } from "../src/movement/CharacterController.js";
import { JumpState } from "../src/movement/JumpState.js";
import { CombatController } from "../src/combat/CombatController.js";
import { ArenaBounds } from "../src/world/ArenaBounds.js";

const rates = [30, 60, 120];
const controls = (speed = 0, blocking = false, x = 0) => ({
  move: {
    x,
    y: Math.sqrt(1 - x * x) * Math.min(speed / (speed > 2.6 ? 5.2 : 2.6), 1),
  },
  sprinting: speed > 2.6,
  blocking,
});
const rig = () => {
  const character = new Stickman();
  return {
    character,
    movement: new CharacterController(character.root, new ArenaBounds(100)),
    animator: new CharacterAnimator(character),
    combat: new CombatController(),
  };
};
const relative = (actor, name) =>
  actor.character.joints[name]
    .getWorldPosition(new Vector3())
    .sub(actor.character.root.position)
    .applyQuaternion(actor.character.root.quaternion.clone().invert());
const step = (actor, input, dt) => {
  actor.movement.update(dt, input, 0);
  actor.combat.setBlocking(input.blocking);
  if (!actor.movement.jump.ready) actor.combat.cancelAttack("movement");
  actor.combat.update(dt);
  const root = actor.character.root;
  const position = root.position.clone();
  const rotation = root.quaternion.clone();
  actor.animator.update(dt, {
    speed: actor.movement.speed,
    blocking: input.blocking,
    combat: actor.combat,
    dash: actor.movement.dash,
    jump: actor.movement.jump,
  });
  assert.ok(
    root.position.equals(position),
    "jump posing never changes physical position",
  );
  assert.ok(
    root.quaternion.equals(rotation),
    "jump posing never changes physical heading",
  );
  root.updateMatrixWorld(true);
  for (const joint of Object.values(actor.character.joints)) {
    assert.ok([...joint.position, ...joint.quaternion].every(Number.isFinite));
    assert.ok(Math.abs(joint.quaternion.length() - 1) < 1e-6);
  }
};
const settle = (actor, input, dt, seconds = 1) => {
  for (let frame = 0; frame < Math.ceil(seconds / dt); frame++)
    step(actor, input, dt);
};

test("an inactive JumpState leaves the existing gait and guard poses exactly unchanged", () => {
  const plain = new Stickman();
  const integrated = new Stickman();
  const before = new CharacterAnimator(plain);
  const after = new CharacterAnimator(integrated);
  const jump = new JumpState();
  for (let frame = 0; frame < 360; frame++) {
    const speed = Math.max(0, Math.sin(frame / 29)) * 5.2;
    for (const character of [plain, integrated]) {
      character.root.position.z -= speed / 60;
      character.root.rotation.y = Math.sin(frame / 57);
    }
    const input = { speed, blocking: frame > 100 && frame < 200 };
    before.update(1 / 60, input);
    after.update(1 / 60, { ...input, jump });
    assert.equal(after.jumpWeight, 0);
    for (const name of Object.keys(plain.joints)) {
      assert.ok(
        plain.joints[name].position.equals(integrated.joints[name].position),
      );
      assert.ok(
        plain.joints[name].quaternion.equals(
          integrated.joints[name].quaternion,
        ),
      );
    }
  }
  plain.dispose();
  integrated.dispose();
});

test("jump poses push off, tuck in flight and compress on landing at 30/60/120Hz", () => {
  for (const rate of rates) {
    const dt = 1 / rate;
    const actor = rig();
    const input = controls();
    settle(actor, input, dt);
    assert.ok(actor.movement.requestJump());
    const phases = new Set();
    let takeoffHip = 1,
      landingHip = 1,
      apexFeet = 0,
      kneeBend = 0;
    let previousHand = relative(actor, "rightHand");
    let previousFoot = relative(actor, "rightAnkle");
    for (let frame = 0; frame < rate * 1.5; frame++) {
      step(actor, input, dt);
      const jump = actor.movement.jump;
      phases.add(jump.phase);
      const hand = relative(actor, "rightHand");
      const foot = relative(actor, "rightAnkle");
      assert.ok(
        hand.distanceTo(previousHand) < 12 * dt + 0.035,
        "arms blend through takeoff and touchdown without a pose jump",
      );
      assert.ok(
        foot.distanceTo(previousFoot) < 12 * dt + 0.035,
        "ankle targets follow a continuous takeoff/landing arc",
      );
      previousHand = hand;
      previousFoot = foot;
      if (jump.phase === "takeoff")
        takeoffHip = Math.min(
          takeoffHip,
          actor.character.joints.hips.position.y,
        );
      if (jump.phase === "landing")
        landingHip = Math.min(
          landingHip,
          actor.character.joints.hips.position.y,
        );
      if (jump.height > 0.7) {
        apexFeet = Math.max(apexFeet, foot.y);
        kneeBend = Math.max(
          kneeBend,
          actor.character.joints.rightKnee.quaternion.angleTo(new Quaternion()),
        );
        assert.ok(actor.animator.footList.every((contact) => !contact.planted));
        assert.equal(actor.animator.jumpWeight, 1);
      }
    }
    assert.deepEqual(
      phases,
      new Set(["takeoff", "airborne", "landing", "grounded"]),
    );
    assert.ok(takeoffHip < 0.92, "legs visibly load before the impulse");
    assert.ok(landingHip < 0.87, "landing is absorbed with bent knees");
    assert.ok(
      apexFeet > 0.24,
      "feet tuck with the airborne body rather than staying on the floor",
    );
    assert.ok(
      kneeBend > 0.7 && kneeBend < 2.6,
      "knees bend naturally in flight",
    );
    assert.equal(actor.animator.jumpWeight, 0);
    assert.equal(actor.movement.jump.phase, "grounded");
    assert.ok(Math.abs(relative(actor, "rightAnkle").y - 0.1) < 0.015);
    actor.character.dispose();
  }
});

test("walking and sprint jumps retain live movement and return feet to the speed-driven gait", () => {
  for (const rate of rates) {
    const dt = 1 / rate;
    for (const speed of [1.1, 2.6, 5.2]) {
      const actor = rig();
      const input = controls(speed);
      settle(actor, input, dt);
      const start = actor.character.root.position.clone();
      const phase = actor.animator.locomotion.phase;
      actor.movement.requestJump();
      let airborneFrames = 0;
      const supportStates = new Set();
      const anchors = actor.animator.footList.map((foot) =>
        foot.target.clone(),
      );
      const planted = actor.animator.footList.map((foot) => foot.planted);
      for (let frame = 0; frame < rate * 1.5; frame++) {
        step(actor, input, dt);
        if (actor.movement.jump.airborne) {
          airborneFrames++;
          assert.ok(
            actor.movement.speed > speed * 0.95,
            "jumping does not stop walking or sprint momentum",
          );
        }
        for (let i = 0; i < 2; i++) {
          const foot = actor.animator.footList[i];
          if (
            actor.movement.jump.phase === "landing" &&
            planted[i] &&
            foot.planted
          ) {
            assert.ok(
              Math.hypot(
                foot.target.x - anchors[i].x,
                foot.target.z - anchors[i].z,
              ) < 0.002,
              "landing support releases before repositioning",
            );
          }
          planted[i] = foot.planted;
          anchors[i].copy(foot.target);
          if (actor.movement.jump.ready)
            supportStates.add(`${foot.side}:${foot.planted}`);
        }
      }
      assert.ok(airborneFrames > rate * 0.5);
      assert.ok(actor.character.root.position.distanceTo(start) > speed * 1.35);
      assert.ok(actor.animator.locomotion.phase > phase + 0.5);
      assert.ok(
        supportStates.size > 2,
        "normal support/swing phases resume after touchdown",
      );
      assert.equal(actor.animator.jumpWeight, 0);
      actor.character.dispose();
    }
  }
});

test("held Block keeps a defensive guard throughout flight and releases smoothly", () => {
  const actor = rig();
  const dt = 1 / 60;
  const guarded = controls(2.6, true);
  settle(actor, guarded, dt);
  actor.movement.requestJump();
  for (let frame = 0; frame < 60; frame++) {
    step(actor, guarded, dt);
    if (actor.movement.jump.airborne) {
      const head = relative(actor, "head");
      for (const side of ["left", "right"]) {
        const hand = relative(actor, `${side}Hand`);
        assert.ok(
          hand.y > head.y - 0.34,
          "held Block keeps both fists beside the chin",
        );
        assert.ok(actor.character.joints[`${side}Elbow`].rotation.x > 1.6);
      }
    }
  }
  assert.ok(actor.combat.blocking);
  const hand = relative(actor, "rightHand");
  step(actor, controls(2.6), dt);
  assert.ok(relative(actor, "rightHand").distanceTo(hand) < 0.15);
  settle(actor, controls(), dt);
  assert.ok(actor.animator.combatWeight < 0.01);
  actor.character.dispose();
});

test("a grounded punch recovers into jump balance without an airborne arm extension", () => {
  const actor = rig();
  const dt = 1 / 60;
  const input = controls();
  settle(actor, input, dt);
  actor.combat.requestAttack();
  while (actor.combat.attack.extension < 0.9) step(actor, input, dt);
  const sequence = actor.combat.attack.sequence;
  actor.movement.requestJump();
  let previous = relative(actor, "rightHand");
  for (let frame = 0; frame < 65; frame++) {
    step(actor, input, dt);
    const hand = relative(actor, "rightHand");
    assert.ok(
      hand.distanceTo(previous) < 0.28,
      "strike cancellation and jump entry share a smooth pose handoff",
    );
    previous = hand;
    if (actor.movement.jump.airborne) {
      assert.ok(
        actor.character.joints.rightElbow.rotation.x > 0.55,
        "jump balancing replaces the straight punch elbow",
      );
      assert.equal(actor.animator.jumpWeight, 1);
    }
    assert.equal(actor.combat.attack.sequence, sequence);
  }
  assert.ok(actor.combat.attack.cancelled);
  assert.equal(actor.animator.attackWeight, 0);
  assert.equal(actor.animator.jumpWeight, 0);
  actor.character.dispose();
});

test("jump takes feet cleanly from a finished dash recovery and steers in flight", () => {
  const actor = rig();
  const dt = 1 / 60;
  settle(actor, controls(), dt);
  actor.movement.requestDash();
  do {
    step(actor, controls(2.6), dt);
  } while (actor.movement.dash.active);
  assert.ok(actor.animator.dashWeight > 0);
  assert.ok(actor.movement.requestJump());
  for (let frame = 0; frame < 90; frame++) {
    step(actor, controls(2.6, false, frame < 18 ? 0.7 : -0.7), dt);
    if (actor.movement.jump.airborne) {
      assert.ok(actor.animator.footList.every((foot) => !foot.planted));
      assert.ok(actor.animator.footList.every((foot) => foot.target.y > 0.1));
    }
  }
  assert.equal(actor.animator.jumpWeight, 0);
  assert.equal(actor.animator.dashWeight, 0);
  assert.equal(actor.movement.jump.phase, "grounded");
  actor.character.dispose();
});
