import test from "node:test";
import assert from "node:assert/strict";
import { Group, Vector3, Quaternion, PerspectiveCamera } from "three";
import { BodyRotation } from "../src/movement/BodyRotation.js";
import { selectDoubleJumpFlip } from "../src/movement/JoystickGestures.js";
import { CharacterController } from "../src/movement/CharacterController.js";
import { ArenaBounds } from "../src/world/ArenaBounds.js";
import { TraversalWorld } from "../src/world/TraversalWorld.js";
import { box } from "../src/world/TraversalGeometry.js";
import {
  sandboxMovementConfig,
  movementSubsteps,
} from "../src/sandbox/PhysicsSandbox.js";
import { Stickman } from "../src/character/Stickman.js";
import { CharacterAnimator } from "../src/character/CharacterAnimator.js";
import { AcrobaticPresenter } from "../src/character/AcrobaticPresenter.js";
import { CombatController } from "../src/combat/CombatController.js";
import {
  createAdaptiveTechniques,
  ContextualLimbSelector,
} from "../src/combat/AdaptiveTechniques.js";
import { createCombatContext } from "../src/combat/CombatContext.js";
import { AttackScheduler } from "../src/combat/AttackScheduler.js";
import { StrikeHitDetector } from "../src/combat/StrikeHitDetector.js";
import { FollowCamera } from "../src/camera/FollowCamera.js";
import { Game } from "../src/core/Game.js";
const TAU = Math.PI * 2,
  kinds = ["frontflip", "backflip", "leftflip", "rightflip"];
const input = (x = 0, y = 0) => ({
  move: { x, y },
  movementMagnitude: Math.min(1, Math.hypot(x, y)),
  blocking: false,
});
const near = (a, b, e = 1e-8) => assert.ok(Math.abs(a - b) < e, `${a} ~ ${b}`);
function airborne() {
  const m = new CharacterController(new Group(), new ArenaBounds(1000));
  m.jump.phase = "airborne";
  m.jump.height = m.root.position.y = 10;
  return m;
}
function rig(values = {}, world = new ArenaBounds(1000)) {
  const character = new Stickman(),
    controller = new CharacterController(character.root, world),
    selector = new ContextualLimbSelector();
  controller.applyMovementConfig(sandboxMovementConfig(values));
  const combat = new CombatController({
      techniques: createAdaptiveTechniques(),
      selectTechnique: (c, e) => selector.choose(c, e),
    }),
    animator = new CharacterAnimator(character);
  return {
    character,
    controller,
    combat,
    animator,
    bodyRotation: new BodyRotation(),
    attackScheduler: new AttackScheduler(combat),
    acrobaticPresenter: new AcrobaticPresenter(character, animator),
    bodyStart: new Quaternion(),
    bodyEnd: new Quaternion(),
    lastRotationJumpSequence: 0,
    simulationPrevious: new Vector3(),
    combatStartRoot: new Vector3(),
    combatEndRoot: new Vector3(),
    hitDetector: new StrikeHitDetector(),
    contactFeedbackRemaining: 0,
    combatContext: createCombatContext(),
    followCamera: { yaw: 0 },
    input: input(),
    sandbox: Object.values(values).some((n) => n !== 1),
  };
}
function tick(g, dt = 1 / 60) {
  const n = movementSubsteps(
    g.controller,
    dt,
    undefined,
    g.input.movementMagnitude,
  );
  for (let i = 0; i < n; i++) Game.prototype.simulateMovement.call(g, dt / n);
  g.acrobaticPresenter.begin(g.combat, g.controller);
  g.animator.update(dt, {
    speed: g.controller.speed,
    jump: g.controller.jump,
    dash: g.controller.dash,
    combat: g.combat,
    blocking: g.input.blocking,
    sandbox: g.sandbox,
  });
  g.acrobaticPresenter.apply(dt, g.bodyRotation, g.combat, g.controller);
}
function run(g, time, dt = 1 / 60) {
  for (let t = 0; t < time - 1e-9; t += dt) tick(g, Math.min(dt, time - t));
}
function launch(g, x = 0, y = 0) {
  g.controller.requestJump();
  run(g, 0.15);
  g.input = input(x, y);
  assert.ok(g.controller.requestJump(g.input, 0));
  tick(g);
}

test("four directions, dominant diagonals and drift default are relative to captured facing rather than screen axes", () => {
  for (const yaw of [0, 0.7, Math.PI / 2, -2.8])
    for (const [x, y, kind] of [
      [0, 1, "frontflip"],
      [0, -1, "backflip"],
      [-1, 0, "leftflip"],
      [1, 0, "rightflip"],
      [0.9, 0.4, "rightflip"],
      [-0.8, -0.3, "leftflip"],
      [0.3, -0.9, "backflip"],
      [0, 0, "backflip"],
      [0.04, -0.03, "backflip"],
    ]) {
      assert.equal(selectDoubleJumpFlip(input(x, y), yaw, yaw), kind);
    }
  assert.equal(selectDoubleJumpFlip(input(0, 1), 0, Math.PI / 2), "rightflip");
  assert.equal(selectDoubleJumpFlip(input(1, 0), Math.PI / 2, 0), "frontflip");
});
test("front/back pitch and left/right roll have distinct signed axes and exactly one winding", () => {
  for (const kind of kinds) {
    const m = airborne(),
      r = new BodyRotation();
    r.start(kind, 0);
    let previous = 0,
      inverted = false;
    for (let n = 0; n < 240; n++) {
      r.update(1 / 120, m, input(n % 2 ? 1 : -1, n % 3 ? -1 : 1), n * 0.1);
      assert.ok(r.rotationTravel >= previous - 1e-10);
      previous = r.rotationTravel;
      inverted ||= r.up.y < -0.95;
    }
    near(r.rotationTravel, TAU);
    assert.equal(r.completedFlips, 1);
    assert.ok(inverted);
    assert.equal(r.phase, "idle");
    if (kind === "frontflip") near(r.pitchTravel, -TAU);
    if (kind === "backflip") near(r.pitchTravel, TAU);
    if (kind === "leftflip") near(r.rollTravel, TAU);
    if (kind === "rightflip") near(r.rollTravel, -TAU);
  }
});
test("held/reversed joystick input cannot replay, reverse or accelerate an automatic flip", () => {
  const m = airborne(),
    rotations = [];
  for (const i of [input(), input(0, -1), input(0, 1), input(1, 0)]) {
    const r = new BodyRotation();
    r.start("leftflip", 0);
    for (let n = 0; n < 36; n++) r.update(1 / 120, m, i, 2);
    rotations.push(r.orientation.clone());
    for (let n = 0; n < 1200; n++) r.update(1 / 120, m, i, 2);
    assert.equal(r.completedFlips, 1);
    near(r.rotationTravel, TAU);
    assert.equal(r.phase, "idle");
    assert.ok(r.angularVelocity.length() < 0.001);
  }
  for (const q of rotations) near(q.angleTo(rotations[0]), 0);
});
test("automatic rotation is frame-rate independent and both old and new quaternions stay normalized", () => {
  const samples = [];
  for (const fps of [30, 60, 144]) {
    const m = airborne(),
      r = new BodyRotation();
    r.start("rightflip", 0.4);
    for (let t = 0; t < 0.3 - 1e-9; t += 1 / fps)
      r.update(Math.min(1 / fps, 0.3 - t), m, input(), 0);
    samples.push(r.orientation.clone());
    near(r.orientation.length(), 1, 1e-12);
    assert.ok(r.angularVelocity.length() <= r.config.maxAngularSpeed + 1e-8);
  }
  for (const q of samples) near(q.angleTo(samples[0]), 0, 1e-7);
});
test("every authored launch/initiation/tuck/rotation/extension/recovery stage is visited once", () => {
  const r = new BodyRotation(),
    m = airborne(),
    stages = new Set();
  r.start("backflip", 0);
  for (let n = 0; n < 100; n++) {
    r.update(1 / 120, m, input(), 0);
    stages.add(r.automatic.stage);
  }
  for (const s of [
    "launch",
    "initiation",
    "tuck",
    "rotation",
    "extension",
    "recovery",
  ])
    assert.ok(stages.has(s), s);
  assert.equal(r.automatic.reason, "complete");
});
test("an acrobatic layer cannot change horizontal movement, jump height, gravity or air steering", () => {
  for (const values of [
    {},
    { movement: 100, jumpHeight: 100, gravity: 100, airControl: 100 },
  ]) {
    const a = rig(values),
      b = new CharacterController(new Group(), new ArenaBounds(1000));
    b.applyMovementConfig(sandboxMovementConfig(values));
    a.controller.requestJump();
    b.requestJump();
    for (let f = 0; f < 360; f++) {
      const i = input(Math.sin(f * 0.07), Math.cos(f * 0.07));
      a.input = i;
      if (f === 20) {
        a.controller.requestJump(i, 0);
        b.requestJump(i, 0);
      }
      const count = movementSubsteps(
        a.controller,
        1 / 60,
        undefined,
        i.movementMagnitude,
      );
      for (let n = 0; n < count; n++) {
        Game.prototype.simulateMovement.call(a, 1 / 60 / count);
        b.update(1 / 60 / count, i, 0);
      }
      near(a.character.root.position.distanceTo(b.root.position), 0);
      assert.deepEqual(a.controller.velocity, b.velocity);
      near(a.controller.jump.verticalVelocity, b.jump.verticalVelocity);
    }
    a.character.dispose();
  }
});
test("attacks during all four flip types are accepted immediately without neutralizing the body or travel", () => {
  for (const [x, y, kind] of [
    [0, 1, "frontflip"],
    [0, -1, "backflip"],
    [-1, 0, "leftflip"],
    [1, 0, "rightflip"],
  ])
    for (const action of ["punch", "kick"]) {
      const g = rig({ jumpHeight: 4 });
      launch(g, x, y);
      run(g, 0.2);
      const before = g.bodyRotation.orientation.clone(),
        sequence = g.bodyRotation.sequence;
      g.attackScheduler.press(action);
      tick(g);
      assert.ok(g.combat.attack.active);
      assert.equal(g.combat.currentTechnique.action, action);
      assert.equal(g.bodyRotation.lastKind, kind);
      assert.equal(g.bodyRotation.sequence, sequence);
      assert.ok(g.bodyRotation.orientation.angleTo(new Quaternion()) > 0.3);
      assert.ok(g.bodyRotation.orientation.angleTo(before) < 0.5);
      assert.ok(g.controller.jump.airborne);
      run(g, 0.12);
      g.input.blocking = true;
      tick(g);
      assert.ok(g.combat.blocking);
      assert.ok(!g.combat.attack.active || g.combat.attack.cancelled);
      for (const j of Object.values(g.character.joints)) {
        near(j.quaternion.length(), 1, 1e-8);
        assert.ok([...j.position].every(Number.isFinite));
      }
      g.character.dispose();
    }
});
test("full-body posing coordinates shoulders, elbows, hips, knees and head, with distinct side mechanics", () => {
  const poses = [];
  for (const [x, y] of [
    [0, 1],
    [0, -1],
    [-1, 0],
    [1, 0],
  ]) {
    const g = rig({ jumpHeight: 4 });
    launch(g, x, y);
    run(g, 0.27);
    assert.ok(g.acrobaticPresenter.tuck > 0.5);
    assert.ok(
      g.character.joints.leftKnee.quaternion.angleTo(new Quaternion()) > 0.6,
    );
    const toBody = (joint) => {
      const p = joint
        .getWorldPosition(new Vector3())
        .sub(g.character.root.position);
      p.y -= 0.955 + g.bodyRotation.lift;
      p.applyQuaternion(g.bodyRotation.orientation.clone().invert());
      p.y += 0.955;
      return p;
    };
    const hips = toBody(g.character.joints.hips);
    const knee = toBody(g.character.joints.leftKnee);
    assert.ok(
      knee.y > hips.y + 0.12,
      `Knee should draw toward the torso: ${knee.y} vs hip ${hips.y}`,
    );
    assert.ok(Math.abs(g.character.joints.leftElbow.rotation.x) > 0.6);
    assert.ok(Math.abs(g.character.joints.head.rotation.x) > 0.01);
    poses.push(
      Object.fromEntries(
        ["leftHip", "rightHip", "leftShoulder", "rightShoulder"].map((n) => [
          n,
          g.character.joints[n].quaternion.clone(),
        ]),
      ),
    );
    g.character.dispose();
  }
  assert.ok(poses[0].leftHip.angleTo(poses[1].leftHip) > 0.1);
  assert.ok(poses[2].leftHip.angleTo(poses[3].leftHip) > 0.1);
});
test("early contact at several rotation phases blends upright on floor or roof without moving the physical root", () => {
  for (const floor of [0, 6])
    for (const progress of [0.2, 0.5, 0.8])
      for (const kind of kinds) {
        const m = airborne(),
          r = new BodyRotation();
        r.start(kind, 0);
        for (
          let t = 0;
          t < r.automatic.duration * progress - 1e-9;
          t += 1 / 240
        )
          r.update(1 / 240, m, input(), 0);
        m.root.position.y = floor;
        m.jump.land(floor);
        const position = m.root.position.clone(),
          q = r.orientation.clone();
        r.update(1 / 60, m, input(), 0);
        assert.ok(
          r.orientation.angleTo(q) <= r.config.maxAngularSpeed / 60 + 1e-6,
        );
        assert.deepEqual(m.root.position, position);
        assert.equal(r.phase, "recover");
        assert.equal(r.completedFlips, 0);
        assert.ok(
          m.root.position.y + 0.955 + r.up.y * 1.04 - 0.2 + r.lift >=
            floor + 0.024,
        );
        for (let f = 0; f < 180; f++) r.update(1 / 120, m, input(), 0);
        assert.equal(r.phase, "idle");
        near(r.orientation.angleTo(new Quaternion()), 0, 1e-6);
      }
});
test("extreme jump heights finish once before the apex while very short flights recover without suspending gravity", () => {
  for (const values of [
    { jumpHeight: 100, gravity: 0.1, movement: 100 },
    { jumpHeight: 0.1, gravity: 100, movement: 100 },
  ]) {
    const g = rig(values);
    g.controller.requestJump();
    // Wait for real takeoff (not a queued second press during the push).
    while (!g.controller.jump.airborne) tick(g);
    g.input = input(1, 0);
    g.controller.requestJump(g.input, 0);
    tick(g);
    const duration = g.bodyRotation.automatic.duration;
    assert.ok(duration <= 1.5);
    run(g, 2);
    assert.ok(g.bodyRotation.completedFlips <= 1);
    assert.ok(g.bodyRotation.rotationTravel <= TAU + 1e-8);
    if (values.gravity < 1) {
      assert.ok(g.controller.jump.verticalVelocity > 0);
      assert.equal(g.bodyRotation.completedFlips, 1);
    } else {
      assert.ok(g.controller.jump.grounded);
      assert.equal(g.bodyRotation.phase, "idle");
    }
    assert.ok(
      [...g.character.root.position, ...g.bodyRotation.orientation].every(
        Number.isFinite,
      ),
    );
    g.character.dispose();
  }
});
test("wall contacts stop a flip without creating another jump, while actual wall Jump retains a single second-jump flip", () => {
  const world = new TraversalWorld(1000, [], [box("wall", 0, -3, 20, 40, 2)]),
    g = rig({}, world);
  g.input = input(0, 1);
  run(g, 0.8);
  assert.ok(g.controller.parkour.attached);
  assert.equal(g.bodyRotation.sequence, 0);
  g.controller.requestJump(input(0, -1), 0);
  tick(g);
  assert.equal(g.controller.jump.jumpCount, 1);
  assert.equal(g.bodyRotation.sequence, 0);
  run(g, 0.12);
  g.controller.requestJump(input(1, 0), 0);
  tick(g);
  assert.equal(g.controller.jump.jumpCount, 2);
  assert.equal(g.bodyRotation.sequence, 1);
  const m = airborne(),
    r = new BodyRotation();
  r.start("backflip", 0);
  r.update(0.1, m, input(), 0);
  m.parkour = { attached: true };
  r.update(0.01, m, input(), 0);
  assert.equal(r.automatic.reason, "parkour");
  assert.equal(r.phase, "recover");
  assert.equal(r.sequence, 1);
  g.character.dispose();
});
test("camera orbit and follow read the physical root, never the flipping body pivot", () => {
  const g = rig(),
    camera = new PerspectiveCamera(),
    follow = new FollowCamera(camera, g.character.root.position);
  const yaw = follow.yaw,
    pitch = follow.pitch;
  launch(g, -1, 0);
  for (let n = 0; n < 60; n++) {
    tick(g);
    follow.update(1 / 60, g.character.root.position, { x: 0, y: 0 });
  }
  assert.equal(follow.yaw, yaw);
  assert.equal(follow.pitch, pitch);
  assert.ok(camera.position.y >= 0.1);
  g.character.dispose();
});
