import test from "node:test";
import assert from "node:assert/strict";
import { Vector3 } from "three";
import {
  ANIME_STYLE,
  resolveAnimationStyle,
} from "../src/character/AnimationStyle.js";
import { Stickman } from "../src/character/Stickman.js";
import { CharacterAnimator } from "../src/character/CharacterAnimator.js";
import { CharacterController } from "../src/movement/CharacterController.js";
import { ArenaBounds } from "../src/world/ArenaBounds.js";
import {
  CombatController,
  BASIC_PUNCH,
  CROSS_PUNCH,
} from "../src/combat/CombatController.js";
import { ProximityCombatController } from "../src/combat/ProximityCombatController.js";
import {
  createCombatContext,
  updateCombatContext,
} from "../src/combat/CombatContext.js";

const controls = (x = 0, y = 0, sprinting = false, blocking = false) => ({
  move: { x, y },
  sprinting,
  blocking,
});
const fixture = (
  style,
  dummy = { id: "dummy", position: new Vector3(0, 0, -4.5), radius: 0.32 },
) => {
  const character = new Stickman();
  return {
    character,
    animator: new CharacterAnimator(character, { style }),
    movement: new CharacterController(
      character.root,
      new ArenaBounds(18, [dummy]),
    ),
    combat: new CombatController(),
    context: createCombatContext(),
    dummy,
  };
};
const step = (actor, input = controls(), dt = 1 / 60) => {
  actor.movement.update(dt, input, 0);
  actor.combat.setBlocking(input.blocking);
  actor.combat.update(dt);
  const root = actor.character.root,
    position = root.position.clone(),
    rotation = root.quaternion.clone();
  actor.animator.update(dt, {
    speed: actor.movement.speed,
    blocking: input.blocking,
    combat: actor.combat,
    dash: actor.movement.dash,
    jump: actor.movement.jump,
  });
  assert.ok(root.position.equals(position) && root.quaternion.equals(rotation));
};
const settle = (actor, input, seconds = 1.5, dt = 1 / 60) => {
  for (let i = 0; i < Math.ceil(seconds / dt); i++) step(actor, input, dt);
};
const relative = (actor, name) =>
  actor.character.joints[name]
    .getWorldPosition(new Vector3())
    .sub(actor.character.root.position);

test("animation personalities resolve once, remain immutable and never modify shared defaults", () => {
  const overrides = {
    locomotion: { sprintLean: 0.18 },
    punch: { shoulderDrive: 0.22 },
  };
  const style = resolveAnimationStyle(overrides);
  overrides.locomotion.sprintLean = 0.8;
  assert.equal(style.locomotion.sprintLean, 0.18);
  assert.equal(style.punch.shoulderDrive, 0.22);
  assert.equal(style.jump.landingDepth, ANIME_STYLE.jump.landingDepth);
  assert.ok(Object.isFrozen(style) && Object.isFrozen(style.locomotion));
  assert.notEqual(
    style.locomotion.sprintLean,
    ANIME_STYLE.locomotion.sprintLean,
  );
  assert.throws(() => {
    style.jump.landingDepth = 1;
  }, TypeError);
});

test("invalid visual timing and foot contact profiles fail safely at construction", () => {
  for (const value of [
    null,
    [],
    { unknown: {} },
    { jump: null },
    { punch: { entryTime: 0 } },
    { punch: { extensionFraction: 1.2 } },
    { locomotion: { sprintStride: 0 } },
    { locomotion: { runFull: 1 } },
    { locomotion: { sprintDuty: 1 } },
    { motion: { response: NaN } },
    { aerialDash: { releaseResponse: 0 } },
    { jump: { landingPeak: 1 } },
  ])
    assert.throws(() => resolveAnimationStyle(value));
});

test("run and sprint have distinct athletic lean, leg drive and arm pumping at the original speeds", () => {
  const far = () => ({
    id: "far",
    position: new Vector3(10, 0, -4.5),
    radius: 0.32,
  });
  const actors = [
    fixture(undefined, far()),
    fixture(undefined, far()),
    fixture(undefined, far()),
  ];
  const inputs = [controls(0, 0.25), controls(0, 1), controls(0, 1, true)];
  for (let i = 0; i < actors.length; i++) settle(actors[i], inputs[i]);
  const [walk, run, sprint] = actors.map((actor) => actor.animator.locomotion);
  assert.ok(walk.runBlend < 0.01 && run.runBlend > 0.99);
  assert.ok(run.sprintBlend < 0.01 && sprint.sprintBlend > 0.99);
  assert.ok(sprint.lift > run.lift + 0.05);
  assert.ok(sprint.cadence > run.cadence);
  assert.ok(sprint.duty < run.duty - 0.15);
  assert.ok(
    actors[2].animator.pose.spinePitch <
      actors[1].animator.pose.spinePitch - 0.12,
  );
  assert.equal(actors[1].movement.walkSpeed, 2.6);
  assert.equal(actors[2].movement.sprintSpeed, 5.2);
  let runArm = 0,
    sprintArm = 0;
  for (let i = 0; i < 120; i++) {
    step(actors[1], inputs[1]);
    step(actors[2], inputs[2]);
    runArm = Math.max(runArm, Math.abs(actors[1].animator.pose.arms[0].x));
    sprintArm = Math.max(
      sprintArm,
      Math.abs(actors[2].animator.pose.arms[0].x),
    );
  }
  assert.ok(sprintArm > runArm + 0.2);
  for (const actor of actors) actor.character.dispose();
});

test("acceleration and braking accents follow resolved motion without input or speed changes", () => {
  const actor = fixture();
  let launch = 0,
    brake = 0;
  for (let i = 0; i < 45; i++) {
    step(actor, controls(0, 1, true));
    launch = Math.max(launch, actor.animator.motion.drive);
  }
  for (let i = 0; i < 45; i++) {
    step(actor);
    brake = Math.max(brake, actor.animator.motion.brake);
  }
  assert.ok(launch > 0.3 && brake > 0.3);
  assert.ok(actor.movement.speed < 0.01);
  assert.ok(actor.animator.locomotion.cadence < 0.01);
  assert.ok(actor.animator.motion.brake < 0.02);
  const phase = actor.animator.locomotion.phase;
  settle(actor, controls(0, 0, true), 0.5);
  assert.equal(
    actor.animator.locomotion.phase,
    phase,
    "Sprint input alone never runs in place",
  );
  actor.character.dispose();
});

test("the two punches transfer body weight in opposite directions while planted feet stay anchored", () => {
  for (const id of [BASIC_PUNCH.id, CROSS_PUNCH.id]) {
    const actor = fixture();
    actor.combat = new CombatController({ selectTechnique: () => id });
    settle(actor, controls(0, 0, false, true));
    const feet = [relative(actor, "leftAnkle"), relative(actor, "rightAnkle")];
    actor.combat.setBlocking(false);
    actor.combat.requestAttack();
    let z = 0,
      torso = 0,
      pelvis = 0,
      elbow = 2;
    for (let i = 0; i < 45; i++) {
      step(actor);
      const p = actor.animator.pose;
      z = Math.min(z, p.hipZ);
      torso = Math.max(torso, Math.abs(p.spineYaw));
      pelvis = Math.max(pelvis, Math.abs(p.hipYaw));
      if (actor.animator.attackAnimation.reach > 0.9)
        elbow = Math.min(
          elbow,
          actor.character.joints[
            id === BASIC_PUNCH.id ? "rightElbow" : "leftElbow"
          ].rotation.x,
        );
      if (actor.combat.attack.active)
        for (let f = 0; f < 2; f++)
          if (actor.animator.footList[f].planted)
            assert.ok(
              relative(actor, f ? "rightAnkle" : "leftAnkle").distanceTo(
                feet[f],
              ) < 0.035,
            );
    }
    assert.ok(z < -0.04 && torso > 0.3 && pelvis > 0.15);
    assert.ok(elbow >= 0.09 && elbow < 0.3);
    assert.equal(actor.combat.attack.sequence, 1);
    assert.equal(actor.combat.attack.active, false);
    actor.character.dispose();
  }
});

test("fast extension and sharp recovery stay inside the unchanged attack lifecycle", () => {
  const actor = fixture();
  actor.combat.requestAttack();
  let sawFastExtension = false,
    sawReadyRecovery = false;
  for (let i = 0; i < 60; i++) {
    step(actor, controls(), 1 / 120);
    const attack = actor.combat.attack;
    if (
      attack.phase === "extension" &&
      attack.extension < 0.9 &&
      actor.animator.attackAnimation.reach > attack.extension + 0.02
    )
      sawFastExtension = true;
    if (
      attack.phase === "recovery" &&
      attack.phaseProgress > 0.8 &&
      actor.animator.attackAnimation.reach < 0.05
    )
      sawReadyRecovery = true;
  }
  assert.ok(sawFastExtension && sawReadyRecovery);
  assert.equal(actor.combat.attack.active, false);
  assert.ok(Math.abs(actor.combat.attack.elapsed - 0.42) < 1e-8);
  actor.character.dispose();
});

test("different presentation profiles produce identical physics, targeting and attack timing through the complete movement chain", () => {
  for (const dt of [1 / 30, 1 / 60, 1 / 120]) {
    const quiet = {
      locomotion: { runLean: 0.06, sprintLean: 0.12, sprintArm: 0.48 },
      punch: { shoulderDrive: 0.2, weightTransfer: 0.02 },
      jump: { landingDepth: 0.08 },
      aerialAttack: { shoulderTwist: 0.12, leanBack: 0.1 },
    };
    const actors = [fixture(), fixture(quiet)];
    const proximity = actors.map(
      (actor) =>
        new ProximityCombatController(actor.combat, { targets: [actor.dummy] }),
    );
    let dashed = false,
      jumped = false,
      airDashed = false,
      kicked = false,
      landed = false;
    for (let i = 0; i < Math.ceil(2 / dt); i++) {
      const a = actors[0].movement,
        b = actors[1].movement;
      if (!dashed && i * dt >= 0.2) {
        assert.ok(a.requestDash() && b.requestDash());
        dashed = true;
      }
      if (dashed && !jumped && a.groundDash.elapsed >= 0.09) {
        assert.ok(a.requestJump() && b.requestJump());
        jumped = true;
      }
      if (jumped && !airDashed && a.jump.airborne) {
        assert.ok(a.requestDash() && b.requestDash());
        airDashed = true;
      }
      const input =
        kicked && a.jump.airborne
          ? controls(-0.2, 0.97, true)
          : controls(0, 1, true);
      for (let index = 0; index < 2; index++) {
        const actor = actors[index];
        actor.movement.update(dt, input, 0);
        updateCombatContext(actor.context, actor.movement);
        proximity[index].update(dt, {
          position: actor.character.root.position,
          facing: actor.movement.heading,
          context: actor.context,
          blocking: false,
        });
        const position = actor.character.root.position.clone(),
          rotation = actor.character.root.quaternion.clone();
        actor.animator.update(dt, {
          speed: actor.movement.speed,
          combat: actor.combat,
          jump: actor.movement.jump,
          dash: actor.movement.dash,
        });
        assert.ok(
          actor.character.root.position.equals(position) &&
            actor.character.root.quaternion.equals(rotation),
        );
      }
      assert.ok(
        a.root.position.equals(b.root.position) &&
          a.velocity.equals(b.velocity),
      );
      assert.equal(a.jump.verticalVelocity, b.jump.verticalVelocity);
      assert.equal(a.airDashesRemaining, b.airDashesRemaining);
      assert.equal(
        actors[0].combat.attack.phase,
        actors[1].combat.attack.phase,
      );
      assert.equal(
        actors[0].combat.attack.sequence,
        actors[1].combat.attack.sequence,
      );
      assert.equal(
        actors[0].combat.attack.techniqueId,
        actors[1].combat.attack.techniqueId,
      );
      kicked ||= actors[0].combat.attack.techniqueId === "flying-kick";
      landed ||= jumped && a.jump.ready;
    }
    assert.ok(dashed && jumped && airDashed && kicked && landed);
    for (const actor of actors) actor.character.dispose();
  }
});

test("jump and air dash poses retain finite joints and continuous contacts through moving landings", () => {
  for (const rate of [30, 60, 120]) {
    const actor = fixture();
    const dt = 1 / rate;
    settle(actor, controls(0, 1, true), 0.3, dt);
    actor.movement.requestDash();
    for (let i = 0; i < Math.ceil(0.1 / dt); i++)
      step(actor, controls(0, 1, true), dt);
    actor.movement.requestJump();
    let airDash = false,
      deepest = 1,
      largestHand = 0,
      largestFoot = 0;
    let previousHand = relative(actor, "rightHand"),
      previousFoot = relative(actor, "rightAnkle");
    for (let i = 0; i < rate * 1.5; i++) {
      if (!airDash && actor.movement.jump.airborne) {
        actor.movement.requestDash();
        airDash = true;
      }
      step(actor, controls(0.25, 0.95, true), dt);
      const hand = relative(actor, "rightHand"),
        foot = relative(actor, "rightAnkle");
      largestHand = Math.max(largestHand, hand.distanceTo(previousHand));
      largestFoot = Math.max(largestFoot, foot.distanceTo(previousFoot));
      previousHand = hand;
      previousFoot = foot;
      if (actor.movement.jump.phase === "landing")
        deepest = Math.min(deepest, actor.character.joints.hips.position.y);
      for (const joint of Object.values(actor.character.joints))
        assert.ok(
          [...joint.position, ...joint.quaternion].every(Number.isFinite),
        );
      assert.ok(foot.y + actor.character.root.position.y >= 0.09);
    }
    assert.ok(airDash && deepest < 0.83);
    assert.ok(
      largestHand < 22 * dt + 0.04 && largestFoot < 22 * dt + 0.04,
      `${rate}Hz hand ${largestHand}, foot ${largestFoot}`,
    );
    assert.equal(actor.movement.jump.ready, true);
    assert.equal(actor.animator.jumpWeight, 0);
    actor.character.dispose();
  }
});
