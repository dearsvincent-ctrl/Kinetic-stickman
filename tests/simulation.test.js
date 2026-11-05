import test from "node:test";
import assert from "node:assert/strict";
import { Group, PerspectiveCamera, Vector3 } from "three";
import { CharacterController } from "../src/movement/CharacterController.js";
import { ArenaBounds } from "../src/world/ArenaBounds.js";
import { FollowCamera } from "../src/camera/FollowCamera.js";
import { Stickman } from "../src/character/Stickman.js";
import { CharacterAnimator } from "../src/character/CharacterAnimator.js";

const input = (x = 0, y = 0, sprinting = false) => ({
  move: { x, y },
  sprinting,
});
const close = (actual, expected, tolerance = 0.001) => {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${actual} should be within ${tolerance} of ${expected}`,
  );
};
const actor = (halfSize = 100) => {
  const root = new Group();
  return {
    root,
    controller: new CharacterController(root, new ArenaBounds(halfSize)),
  };
};
const step = (controller, seconds, controls, yaw = 0, fps = 60) => {
  for (let frame = 0; frame < Math.round(seconds * fps); frame++) {
    controller.update(1 / fps, controls, yaw);
  }
};

test("forward and right movement follow camera yaw", () => {
  for (const { controls, yaw, direction } of [
    { controls: input(0, 1), yaw: 0, direction: new Vector3(0, 0, -1) },
    { controls: input(1, 0), yaw: 0, direction: new Vector3(1, 0, 0) },
    {
      controls: input(0, 1),
      yaw: Math.PI / 2,
      direction: new Vector3(-1, 0, 0),
    },
    {
      controls: input(1, 0),
      yaw: Math.PI / 2,
      direction: new Vector3(0, 0, -1),
    },
  ]) {
    const { root, controller } = actor();
    step(controller, 1, controls, yaw);
    assert.ok(root.position.clone().normalize().distanceTo(direction) < 0.001);
    close(root.position.y, 0);
  }
});

test("diagonal input is capped at the same speed as axial input", () => {
  const axial = actor();
  const diagonal = actor();
  step(axial.controller, 2, input(0, 1));
  step(diagonal.controller, 2, input(1, 1));
  close(axial.root.position.length(), diagonal.root.position.length());
  close(diagonal.controller.speed, diagonal.controller.walkSpeed);
});

test("movement accelerates smoothly and decelerates to a stable rest", () => {
  const { root, controller } = actor();
  controller.update(1 / 60, input(0, 1), 0);
  const firstSpeed = controller.speed;
  assert.ok(firstSpeed > 0 && firstSpeed < controller.walkSpeed / 2);
  step(controller, 1, input(0, 1));
  close(controller.speed, controller.walkSpeed, 0.01);
  controller.update(1 / 60, input(), 0);
  assert.ok(controller.speed > 0 && controller.speed < controller.walkSpeed);
  step(controller, 1, input());
  const restingPosition = root.position.clone();
  close(controller.speed, 0);
  step(controller, 1, input());
  assert.ok(root.position.equals(restingPosition));
});

test("sprinting reaches its speed limit and cannot cross boundaries or corners", () => {
  const { root, controller } = actor(18);
  step(controller, 1, input(0, 1, true));
  close(controller.speed, controller.sprintSpeed, 0.01);
  step(controller, 20, input(1, 1, true));
  const limit = 18 - controller.radius;
  close(root.position.x, limit);
  close(root.position.z, -limit);
  close(controller.speed, 0);
  close(controller.velocity.length(), 0);
  // A long update must still respect the bounds (e.g. a resumed frame).
  controller.update(2, input(-1, -1, true), 0);
  assert.ok(
    Math.abs(root.position.x) <= limit && Math.abs(root.position.z) <= limit,
  );
});

test("a blocked axis stops while movement slides along the wall", () => {
  const { root, controller } = actor(18);
  root.position.x = 18 - controller.radius;
  step(controller, 1, input(1, 1));
  close(root.position.x, 18 - controller.radius);
  assert.ok(root.position.z < -1);
  close(controller.velocity.x, 0);
  assert.ok(controller.velocity.z < -1);
});

test("reaching a wall preserves movement heading and being fully blocked does not turn the character", () => {
  const { root, controller } = actor(18);
  root.position.z = -17.63;
  controller.update(1 / 60, input(0, 1, true), 0);
  close(root.position.z, -18 + controller.radius);
  assert.ok(
    controller.speed > 0,
    "the contact frame must include actual movement",
  );
  close(controller.velocity.length(), 0);
  close(controller.heading, 0);
  close(root.rotation.y, 0);

  // Once stationary against the wall, a different existing facing must also
  // remain stable rather than being replaced by atan2 of a zero velocity.
  controller.heading = 0.7;
  root.rotation.y = 0.7;
  step(controller, 1, input(0, 1, true));
  close(controller.speed, 0);
  close(controller.heading, 0.7);
  close(root.rotation.y, 0.7);
});

test("movement remains comparable across update rates", () => {
  const positions = [30, 60, 144].map((fps) => {
    const { root, controller } = actor();
    step(controller, 1, input(0.6, 0.8), 0.7, fps);
    step(controller, 0.5, input(), 0.7, fps);
    return root.position;
  });
  assert.ok(
    positions[0].distanceTo(positions[2]) < 0.06,
    "integration drift should remain below 6cm",
  );
  assert.ok(positions[1].distanceTo(positions[2]) < 0.03);
});

test("character and camera yaw interpolate across the short side of the wrap", () => {
  const { root, controller } = actor();
  controller.heading = Math.PI - 0.05;
  root.rotation.y = controller.heading;
  const target = -Math.PI + 0.05;
  controller.update(1 / 60, input(-Math.sin(target), Math.cos(target)), 0);
  assert.ok(controller.heading > Math.PI - 0.05);
  assert.ok(controller.heading < Math.PI + 0.05);

  const follow = new FollowCamera(new PerspectiveCamera(), new Vector3());
  follow.yaw = Math.PI - 0.05;
  follow.targetYaw = -Math.PI + 0.05;
  follow.update(1 / 60, new Vector3(), { x: 0, y: 0 });
  assert.ok(
    Math.abs(follow.yaw) > 3,
    "camera must stay near the wrap, not rotate through zero",
  );
});

test("camera clamps pitch, stays above the floor, follows smoothly, and resets behind the character", () => {
  const camera = new PerspectiveCamera();
  const position = new Vector3();
  const follow = new FollowCamera(camera, position);
  close(camera.position.distanceTo(follow.target), 4.8);
  for (const drag of [-10000, 10000]) {
    follow.update(1, position, { x: 0, y: drag });
    assert.ok(
      follow.targetPitch >= follow.minPitch &&
        follow.targetPitch <= follow.maxPitch,
    );
    assert.ok(camera.position.y >= 0.3);
  }
  position.x = 10;
  follow.update(1 / 60, position, { x: 0, y: 0 });
  assert.ok(
    follow.target.x > 0 && follow.target.x < 10,
    "follow should interpolate rather than snap",
  );
  follow.reset(Math.PI / 2);
  for (let frame = 0; frame < 120; frame++)
    follow.update(1 / 60, position, { x: 0, y: 0 });
  close(follow.pitch, 0.23);
  close(follow.yaw, Math.PI / 2);
  close(camera.position.distanceTo(follow.target), 4.8);
  assert.ok(camera.position.x > follow.target.x);
  follow.update(1, new Vector3(0, -20, 0), { x: 0, y: -10000 });
  assert.ok(
    camera.position.y >= 0.3,
    "floor guard remains effective even with an invalid low target",
  );
});

test("rig joints are hierarchical and animation does not take ownership of world movement", () => {
  const character = new Stickman();
  const j = character.joints;
  assert.equal(j.hips.parent, character.root);
  assert.equal(j.spine.parent, j.hips);
  assert.equal(j.head.parent, j.neck);
  for (const side of ["left", "right"]) {
    assert.equal(j[`${side}Shoulder`].parent, j.spine);
    assert.equal(j[`${side}Elbow`].parent, j[`${side}Shoulder`]);
    assert.equal(j[`${side}Hand`].parent, j[`${side}Elbow`]);
    assert.equal(j[`${side}Hip`].parent, j.hips);
    assert.equal(j[`${side}Knee`].parent, j[`${side}Hip`]);
    assert.equal(j[`${side}Ankle`].parent, j[`${side}Knee`]);
  }
  character.root.position.set(3, 0, -4);
  character.root.rotation.y = 1.2;
  const position = character.root.position.clone();
  const rotation = character.root.quaternion.clone();
  const animator = new CharacterAnimator(character);
  for (let frame = 0; frame < 30; frame++)
    animator.update(1 / 60, { speed: 4, maxSpeed: 5.2, sprinting: true });
  assert.ok(character.root.position.equals(position));
  assert.ok(character.root.quaternion.equals(rotation));
  assert.ok(Math.abs(j.leftKnee.rotation.x) > 0.01);
  assert.ok(Math.abs(j.leftShoulder.rotation.x) > 0.01);
  const movingHipHeight = j.hips.position.y;
  for (let frame = 0; frame < 120; frame++)
    animator.update(1 / 60, { speed: 0 });
  assert.ok(
    j.hips.position.y > movingHipHeight,
    "pose should blend back to standing idle",
  );
  assert.ok(character.root.position.equals(position));
  character.dispose();
});
