import test from "node:test";
import assert from "node:assert/strict";
import { Group, Vector3 } from "three";
import { CharacterController } from "../src/movement/CharacterController.js";
import { ArenaBounds } from "../src/world/ArenaBounds.js";

const controls = (x = 0, y = 0, sprinting = false, fighting = false) => ({
  move: { x, y },
  sprinting,
  fighting,
});

const close = (actual, expected, tolerance = 0.001) => {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${actual} should be within ${tolerance} of ${expected}`,
  );
};

const actor = ({ halfSize = 100, dashConfig, world } = {}) => {
  const root = new Group();
  const controller = new CharacterController(
    root,
    world ?? new ArenaBounds(halfSize),
    { dashConfig },
  );
  return { root, controller };
};

// Finish at the requested time, including rates that do not divide the duration.
const advance = (controller, seconds, input, yaw = 0, steps = [1 / 60]) => {
  let elapsed = 0;
  let frame = 0;
  while (seconds - elapsed > 1e-10) {
    const dt = Math.min(steps[frame++ % steps.length], seconds - elapsed);
    controller.update(dt, input, yaw);
    elapsed += dt;
  }
};

const start = (controller, input = controls(0, 1), yaw = 0, dt = 1 / 120) => {
  assert.equal(controller.requestDash(), true);
  controller.update(dt, input, yaw);
  assert.equal(controller.movementState, "dash");
  assert.equal(controller.dash.active, true);
};

const angleBetween = (a, b) => Math.acos(Math.max(-1, Math.min(1, a.dot(b))));

class RecordingBounds extends ArenaBounds {
  constructor(halfSize = 100) {
    super(halfSize);
    this.calls = [];
  }

  move(position, displacement, radius, out) {
    super.move(position, displacement, radius, out);
    this.calls.push({
      from: position.clone(),
      requested: displacement.clone(),
      to: out.clone(),
      radius,
    });
    return out;
  }
}

test("a default dash traverses 2.5m continuously over a quarter second", () => {
  const { root, controller } = actor();
  assert.equal(controller.movementState, "locomotion");
  assert.equal(controller.dash.ready, true);
  assert.equal(controller.requestDash(), true);

  advance(controller, 0.025, controls(0, 1));
  const pushOffDistance = root.position.length();
  assert.ok(pushOffDistance > 0 && pushOffDistance < 0.3);
  assert.equal(controller.dash.active, true);
  close(controller.dash.elapsed, 0.025);

  advance(controller, 0.1, controls(0, 1));
  const halfwayDistance = root.position.length();
  assert.ok(halfwayDistance > pushOffDistance && halfwayDistance < 2.3);
  assert.equal(controller.movementState, "dash");
  advance(controller, 0.125, controls(0, 1));

  close(root.position.x, 0);
  close(root.position.y, 0);
  close(root.position.z, -2.5, 0.03);
  close(controller.dash.distanceTravelled, 2.5, 0.03);
  assert.equal(controller.dash.active, false);
  assert.equal(controller.movementState, "locomotion");
  assert.equal(controller.dash.exitReason, "completed");
  close(controller.dash.progress, 1);
});

test("dash displacement is resolved through many bounded world movements", () => {
  const world = new RecordingBounds();
  const { root, controller } = actor({ world });
  assert.equal(controller.requestDash(), true);
  // Even one long frame must pass through intermediate collision checks.
  controller.update(0.25, controls(0, 1), 0);

  close(root.position.length(), 2.5, 0.03);
  assert.ok(world.calls.length >= 30, "a dash needs at least 120Hz substeps");
  for (const call of world.calls) {
    assert.ok(call.requested.length() < 0.15, "each movement must stay short");
    assert.ok(call.to.distanceTo(call.from) < 0.15);
    close(call.to.y, 0);
  }
  for (let index = 1; index < world.calls.length; index++) {
    assert.ok(world.calls[index].from.equals(world.calls[index - 1].to));
  }
});

test("dash uses joystick direction relative to camera, including diagonals", () => {
  for (const { input, yaw, direction } of [
    { input: controls(0, 1), yaw: 0, direction: new Vector3(0, 0, -1) },
    { input: controls(1, 0), yaw: 0, direction: new Vector3(1, 0, 0) },
    {
      input: controls(0, 1),
      yaw: Math.PI / 2,
      direction: new Vector3(-1, 0, 0),
    },
    {
      input: controls(1, 0),
      yaw: Math.PI / 2,
      direction: new Vector3(0, 0, -1),
    },
    {
      input: controls(1, 1),
      yaw: -0.71,
      direction: new Vector3(
        Math.cos(-0.71) - Math.sin(-0.71),
        0,
        -Math.sin(-0.71) - Math.cos(-0.71),
      ).normalize(),
    },
  ]) {
    const { root, controller } = actor();
    assert.equal(controller.requestDash(), true);
    advance(controller, 0.25, input, yaw);
    assert.ok(root.position.clone().normalize().distanceTo(direction) < 0.001);
    close(root.position.length(), 2.5, 0.03);
  }
});

test("a weak joystick selects dash direction without weakening the burst", () => {
  const full = actor();
  const light = actor();
  for (const [entry, input] of [
    [full, controls(0.6, 0.8)],
    [light, controls(0.12, 0.16)],
  ]) {
    assert.equal(entry.controller.requestDash(), true);
    advance(entry.controller, 0.25, input, 0.4);
  }
  assert.ok(full.root.position.distanceTo(light.root.position) < 0.01);
});

test("without joystick input the dash follows character facing, not camera yaw", () => {
  for (const heading of [0, 0.9, -2.3]) {
    const { root, controller } = actor();
    controller.heading = heading;
    root.rotation.y = heading;
    assert.equal(controller.requestDash(), true);
    advance(controller, 0.25, controls(), heading + Math.PI / 2);
    const expected = new Vector3(-Math.sin(heading), 0, -Math.cos(heading));
    assert.ok(root.position.clone().normalize().distanceTo(expected) < 0.001);
    close(root.position.length(), 2.5, 0.03);
  }
});

test("right-angle steering bends the trajectory without instantly replacing momentum", () => {
  const { root, controller } = actor();
  start(controller);
  advance(controller, 0.05 - 1 / 120, controls(0, 1));
  const original = controller.dash.direction.clone();
  const beforeTurn = root.position.clone();
  controller.update(1 / 120, controls(1, 0), 0);
  const firstTurn = controller.dash.direction.clone();

  assert.ok(firstTurn.x > 0, "steering responds on its first simulation step");
  assert.ok(firstTurn.z < -0.9, "the first turn retains forward momentum");
  assert.ok(angleBetween(original, firstTurn) <= 9 / 120 + 0.001);
  assert.ok(root.position.z < beforeTurn.z);
  advance(controller, 0.25 - 0.05 - 1 / 120, controls(1, 0));

  assert.ok(
    root.position.x > 0.5,
    "the burst must visibly follow the new input",
  );
  assert.ok(
    root.position.z < -0.4,
    "the original direction remains part of the path",
  );
  assert.ok(
    root.position.length() < 2.49,
    "turning follows a curve, not a new straight line",
  );
  close(controller.dash.distanceTravelled, 2.5, 0.03);
});

test("opposite steering turns gradually and respects the configured angular limit", () => {
  const { controller } = actor({
    dashConfig: { maxTurnRate: 2, steeringResponse: 100 },
  });
  start(controller);
  let previous = controller.dash.direction.clone();
  const initial = previous.clone();
  for (let frame = 0; frame < 15; frame++) {
    controller.update(1 / 120, controls(0, -1), 0);
    const current = controller.dash.direction.clone();
    assert.ok(angleBetween(previous, current) <= 2 / 120 + 0.0001);
    close(current.length(), 1);
    previous.copy(current);
  }
  assert.ok(
    angleBetween(initial, previous) > 0.15,
    "a 180° request must begin a turn",
  );
  assert.ok(
    previous.z < -0.9,
    "a short burst cannot instantly reverse momentum",
  );
});

test("releasing the joystick retains the last dash heading", () => {
  const { root, controller } = actor();
  start(controller);
  advance(controller, 0.08, controls(1, 0));
  const heldDirection = controller.dash.direction.clone();
  const releasePosition = root.position.clone();
  advance(controller, 0.1, controls());
  assert.ok(controller.dash.direction.distanceTo(heldDirection) < 0.000001);
  const releaseTravel = root.position.clone().sub(releasePosition).normalize();
  assert.ok(releaseTravel.distanceTo(heldDirection) < 0.001);
});

test("camera rotation can redirect held joystick input during the dash smoothly", () => {
  const { root, controller } = actor();
  start(controller);
  advance(controller, 0.04, controls(0, 1));
  const previous = controller.dash.direction.clone();
  controller.update(1 / 120, controls(0, 1), -Math.PI / 2);
  assert.ok(controller.dash.direction.x > 0);
  assert.ok(
    angleBetween(previous, controller.dash.direction) <= 9 / 120 + 0.001,
  );
  advance(controller, 0.15, controls(0, 1), -Math.PI / 2);
  assert.ok(root.position.x > 0.5);
  assert.ok(root.position.z < -0.3);
  assert.equal(controller.dash.active, true);
});

test("cooldown starts with the burst and rapid rejected presses never queue another dash", () => {
  const { controller } = actor();
  assert.equal(controller.requestDash(), true);
  assert.equal(
    controller.requestDash(),
    false,
    "one press may only queue one start",
  );
  controller.update(0.01, controls(0, 1), 0);
  assert.equal(controller.dash.sequence, 1);
  assert.equal(controller.dash.ready, false);
  close(controller.dash.cooldownRemaining, 0.69, 0.001);

  for (let frame = 0; frame < 24; frame++) {
    assert.equal(controller.requestDash(), false);
    controller.update(0.01, controls(0, 1), 0);
  }
  assert.equal(controller.dash.active, false);
  close(controller.dash.cooldownRemaining, 0.45, 0.001);
  assert.equal(controller.requestDash(), false);
  advance(controller, 0.449, controls());
  assert.equal(controller.requestDash(), false);
  assert.equal(controller.dash.ready, false);
  advance(controller, 0.002, controls());
  assert.equal(controller.dash.ready, true);
  assert.equal(
    controller.dash.sequence,
    1,
    "rejected requests cannot be buffered",
  );
  assert.equal(controller.dash.active, false);

  assert.equal(controller.requestDash(), true);
  controller.update(0.01, controls(1, 0), 0);
  assert.equal(controller.dash.sequence, 2);
  assert.equal(controller.dash.active, true);
});

test("wall contact resolves every movement and ends a fully blocked dash early", () => {
  const world = new RecordingBounds(4);
  const { root, controller } = actor({ world });
  const limit = world.halfSize - controller.radius;
  root.position.set(limit - 0.12, 0, 0);
  start(controller, controls(1, 0));
  advance(controller, 0.1 - 1 / 120, controls(1, 0));

  close(root.position.x, limit);
  close(root.position.z, 0);
  assert.equal(controller.dash.active, false);
  assert.equal(controller.dash.exitReason, "blocked");
  assert.ok(controller.dash.elapsed < 0.25);
  assert.ok(controller.dash.distanceTravelled <= 0.121);
  assert.equal(
    controller.requestDash(),
    false,
    "collision does not reset cooldown",
  );
  close(controller.dash.cooldownRemaining, 0.6, 0.002);
  for (const call of world.calls) {
    assert.ok(Math.abs(call.to.x) <= limit && Math.abs(call.to.z) <= limit);
  }
});

test("a diagonal dash slides along a wall and a corner never permits crossing", () => {
  const sliding = actor({ halfSize: 4 });
  const limit = 4 - sliding.controller.radius;
  sliding.root.position.set(limit, 0, 1);
  assert.equal(sliding.controller.requestDash(), true);
  advance(sliding.controller, 0.25, controls(1, 1));
  close(sliding.root.position.x, limit);
  assert.ok(sliding.root.position.z < 0, "the unblocked axis keeps moving");
  assert.ok(sliding.root.position.z > -2, "wall sliding remains a short burst");

  const corner = actor({ halfSize: 4 });
  corner.root.position.set(limit, 0, -limit);
  assert.equal(corner.controller.requestDash(), true);
  corner.controller.update(0.5, controls(1, 1), 0);
  close(corner.root.position.x, limit);
  close(corner.root.position.z, -limit);
  close(corner.controller.speed, 0);
  assert.equal(corner.controller.dash.active, false);
  assert.equal(corner.controller.dash.exitReason, "blocked");
  assert.equal(corner.controller.requestDash(), false);
});

test("dash distance is stable at 30, 60, 144Hz and irregular frame durations", () => {
  const positions = [
    [1 / 30],
    [1 / 60],
    [1 / 144],
    [0.004, 0.041, 0.013, 0.027, 0.009],
  ].map((steps) => {
    const { root, controller } = actor();
    assert.equal(controller.requestDash(), true);
    advance(controller, 0.25, controls(0.6, 0.8), 0.7, steps);
    assert.equal(controller.dash.active, false);
    close(root.position.length(), 2.5, 0.03);
    close(controller.dash.cooldownRemaining, 0.45, 0.001);
    return root.position.clone();
  });
  for (const position of positions) {
    assert.ok(position.distanceTo(positions[0]) < 0.01);
  }
});

test("steered dash trajectories remain comparable across frame rates", () => {
  const positions = [
    [1 / 30],
    [1 / 60],
    [1 / 144],
    [0.008, 0.031, 0.017, 0.005],
  ].map((steps) => {
    const { root, controller } = actor();
    assert.equal(controller.requestDash(), true);
    advance(controller, 0.06, controls(0, 1), 0, steps);
    advance(controller, 0.1, controls(1, 0), 0, steps);
    advance(controller, 0.09, controls(0, -1), 0, steps);
    return root.position.clone();
  });
  for (const position of positions) {
    assert.ok(position.distanceTo(positions[0]) < 0.06);
  }
});

test("dash returns to ordinary walking, sprinting and fighting movement speeds", () => {
  for (const fighting of [false, true]) {
    for (const sprinting of [false, true]) {
      const { controller } = actor();
      const input = controls(0, 1, sprinting, fighting);
      const expectedSpeed = sprinting ? 5.2 : 2.6;
      advance(controller, 1, input);
      close(controller.speed, expectedSpeed, 0.005);
      start(controller, input);
      assert.ok(controller.dash.speed > 0);
      advance(controller, 0.25 - 1 / 120, input);
      assert.equal(controller.movementState, "locomotion");
      assert.equal(controller.dash.active, false);
      advance(controller, 1, input);
      close(controller.speed, expectedSpeed, 0.005);
      close(controller.velocity.length(), expectedSpeed, 0.005);
    }
  }
});

test("changing fighting stance during a dash preserves its timing and return to movement", () => {
  const { controller } = actor();
  start(controller, controls(0, 1, false, false));
  advance(controller, 0.1, controls(0, 1, false, true));
  assert.equal(controller.movementState, "dash");
  advance(controller, 0.25 - 0.1 - 1 / 120, controls(0, 1, false, true));
  assert.equal(controller.movementState, "locomotion");
  assert.equal(controller.dash.exitReason, "completed");
  close(controller.dash.distanceTravelled, 2.5, 0.03);
  advance(controller, 1, controls(0.3, 0.4, false, true));
  close(controller.speed, 1.3, 0.005);
});

test("the end of a dash does not leave dash-speed velocity in locomotion", () => {
  const { controller } = actor();
  assert.equal(controller.requestDash(), true);
  advance(controller, 0.25, controls(0, 1));
  controller.update(1 / 60, controls(0, 1), 0);
  assert.equal(controller.movementState, "locomotion");
  assert.ok(controller.speed <= controller.walkSpeed + 0.001);
  assert.ok(controller.velocity.length() <= controller.walkSpeed + 0.001);
  advance(controller, 1, controls());
  close(controller.speed, 0);
  close(controller.velocity.length(), 0);
});

test("late right-angle and opposite steering preserve physical velocity at dash exit", () => {
  for (const changedInput of [controls(1, 0), controls(0, -1)]) {
    const { root, controller } = actor();
    start(controller);
    const endSpeed = controller.dash.endSpeed;
    advance(controller, 0.225 - 1 / 120, controls(0, 1));
    advance(controller, 0.024, changedInput);
    const directionBeforeExit = controller.velocity.clone().normalize();
    assert.equal(controller.movementState, "dash");
    controller.update(0.001, changedInput, 0);

    assert.equal(controller.movementState, "locomotion");
    const expectedVelocity = controller.dash.direction
      .clone()
      .multiplyScalar(endSpeed);
    assert.ok(
      controller.velocity.distanceTo(expectedVelocity) < 0.000001,
      "state exit must retain the bounded dash trajectory and terminal speed",
    );
    assert.ok(
      angleBetween(
        directionBeforeExit,
        controller.velocity.clone().normalize(),
      ) < 0.01,
      "a final 1ms step cannot jump to the new joystick heading",
    );
    close(controller.dash.distanceTravelled, 2.5, 0.03);

    // The following tick should respond exactly like ordinary movement starting
    // with this physical velocity, rather than restoring a hidden intent cache.
    const reference = actor();
    reference.root.position.copy(root.position);
    reference.controller.heading = controller.heading;
    reference.controller.velocity.copy(expectedVelocity);
    controller.update(1 / 60, changedInput, 0);
    reference.controller.update(1 / 60, changedInput, 0);
    assert.ok(
      controller.velocity.distanceTo(reference.controller.velocity) < 0.000001,
    );
    assert.ok(root.position.distanceTo(reference.root.position) < 0.000001);
    assert.ok(
      angleBetween(
        expectedVelocity.clone().normalize(),
        controller.velocity.clone().normalize(),
      ) < 0.3,
      "normal acceleration must redirect the retained momentum progressively",
    );
  }
});

test("stick release preserves terminal dash speed before normal movement decelerates", () => {
  const { root, controller } = actor();
  start(controller);
  const endSpeed = controller.dash.endSpeed;
  advance(controller, 0.15 - 1 / 120, controls(0, 1));
  advance(controller, 0.1, controls());

  assert.equal(controller.movementState, "locomotion");
  close(endSpeed, 2.6);
  close(controller.velocity.length(), endSpeed, 0.000001);
  const exitDirection = controller.dash.direction.clone();
  assert.ok(
    controller.velocity.clone().normalize().distanceTo(exitDirection) <
      0.000001,
  );
  close(root.position.length(), 2.5, 0.03);

  const reference = actor();
  reference.controller.velocity.copy(controller.velocity);
  controller.update(1 / 60, controls(), 0);
  reference.controller.update(1 / 60, controls(), 0);
  assert.ok(
    controller.velocity.distanceTo(reference.controller.velocity) < 0.000001,
  );
  assert.ok(controller.velocity.length() < endSpeed);
  assert.ok(controller.velocity.length() > endSpeed * 0.7);
  assert.ok(
    controller.velocity.clone().normalize().distanceTo(exitDirection) <
      0.000001,
  );
});

test("dash exit keeps wall-resolved velocity without restoring a blocked component", () => {
  const { root, controller } = actor({ halfSize: 4 });
  const limit = 4 - controller.radius;
  root.position.set(limit, 0, 1);
  start(controller, controls(1, 1));
  const endSpeed = controller.dash.endSpeed;
  advance(controller, 0.25 - 1 / 120, controls(1, 1));

  assert.equal(controller.movementState, "locomotion");
  assert.equal(controller.dash.exitReason, "completed");
  const expectedVelocity = controller.dash.direction
    .clone()
    .multiplyScalar(endSpeed);
  expectedVelocity.x = 0;
  close(controller.velocity.x, 0);
  assert.ok(controller.velocity.distanceTo(expectedVelocity) < 0.000001);
  close(controller.speed, expectedVelocity.length(), 0.000001);
  controller.update(1 / 60, controls(1, 1), 0);
  close(root.position.x, limit);
  close(controller.velocity.x, 0);
  close(controller.velocity.z, expectedVelocity.z, 0.000001);
});

test("straight idle, walking and sprinting dashes retain their intended terminal speeds", () => {
  for (const { input, speed } of [
    { input: controls(), speed: 0 },
    { input: controls(0, 1), speed: 2.6 },
    { input: controls(0, 1, true), speed: 5.2 },
  ]) {
    const { root, controller } = actor();
    assert.equal(controller.requestDash(), true);
    advance(controller, 0.25, input);
    assert.equal(controller.movementState, "locomotion");
    close(controller.velocity.length(), speed, 0.000001);
    close(root.position.length(), 2.5, 0.03);
  }
});

test("stop cancels active and pending dashes without erasing the cooldown", () => {
  const { root, controller } = actor();
  start(controller);
  advance(controller, 0.04, controls(0, 1));
  const cooldown = controller.dash.cooldownRemaining;
  controller.stop();
  assert.equal(controller.movementState, "locomotion");
  assert.equal(controller.dash.active, false);
  assert.equal(controller.dash.exitReason, "cancelled");
  close(controller.speed, 0);
  close(controller.velocity.length(), 0);
  close(controller.dash.cooldownRemaining, cooldown);
  assert.equal(controller.requestDash(), false);
  const stoppedPosition = root.position.clone();
  advance(controller, 0.1, controls());
  assert.ok(root.position.equals(stoppedPosition));

  advance(controller, 0.7, controls());
  assert.equal(controller.requestDash(), true);
  controller.stop();
  const sequence = controller.dash.sequence;
  controller.update(0.02, controls(), 0);
  assert.equal(
    controller.dash.sequence,
    sequence,
    "stop clears a pending start",
  );
  assert.equal(controller.dash.active, false);
});

test("dash distance, duration and cooldown can be tuned independently", () => {
  const { root, controller } = actor({
    dashConfig: {
      distance: 4,
      duration: 0.4,
      cooldown: 0.9,
      accelerationTime: 0.08,
      brakingTime: 0.12,
    },
  });
  assert.equal(controller.requestDash(), true);
  advance(controller, 0.25, controls(0, 1));
  assert.equal(controller.dash.active, true);
  assert.ok(root.position.length() > 0 && root.position.length() < 4);
  advance(controller, 0.15, controls(0, 1));
  assert.equal(controller.dash.active, false);
  close(root.position.length(), 4, 0.03);
  close(controller.dash.cooldownRemaining, 0.5, 0.001);
  advance(controller, 0.501, controls());
  assert.equal(controller.dash.ready, true);
});

test("tuning acceleration changes push-off while preserving total distance", () => {
  const shortPush = actor({ dashConfig: { accelerationTime: 0.02 } });
  const longPush = actor({ dashConfig: { accelerationTime: 0.09 } });
  for (const entry of [shortPush, longPush]) {
    assert.equal(entry.controller.requestDash(), true);
    advance(entry.controller, 0.02, controls(0, 1));
  }
  assert.ok(
    shortPush.root.position.length() > longPush.root.position.length() * 1.5,
    "a longer acceleration window produces a more gradual push-off",
  );
  for (const entry of [shortPush, longPush]) {
    advance(entry.controller, 0.23, controls(0, 1));
    close(entry.root.position.length(), 2.5, 0.03);
  }
});

test("a long frame completes the burst and spends only the remainder in locomotion", () => {
  const oneFrame = actor();
  const splitFrame = actor();
  for (const entry of [oneFrame, splitFrame]) {
    assert.equal(entry.controller.requestDash(), true);
  }
  oneFrame.controller.update(0.4, controls(0, 1), 0);
  splitFrame.controller.update(0.25, controls(0, 1), 0);
  splitFrame.controller.update(0.15, controls(0, 1), 0);
  assert.equal(oneFrame.controller.movementState, "locomotion");
  assert.ok(
    oneFrame.root.position.distanceTo(splitFrame.root.position) < 0.001,
  );
  close(oneFrame.controller.dash.cooldownRemaining, 0.3, 0.001);
});

test("zero-time updates keep queued and active dash transforms finite and unchanged", () => {
  const { root, controller } = actor();
  assert.equal(controller.requestDash(), true);
  controller.update(0, controls(0, 1), 0);
  assert.equal(controller.dash.active, false);
  assert.ok(root.position.equals(new Vector3()));
  controller.update(0.01, controls(0, 1), 0);
  const position = root.position.clone();
  const elapsed = controller.dash.elapsed;
  const cooldown = controller.dash.cooldownRemaining;
  controller.update(0, controls(1, 0), 1);
  assert.ok(root.position.equals(position));
  close(controller.dash.elapsed, elapsed);
  close(controller.dash.cooldownRemaining, cooldown);
  for (const value of [
    ...root.position.toArray(),
    ...controller.dash.direction.toArray(),
    controller.speed,
    controller.dash.speed,
    controller.dash.elapsed,
    controller.dash.progress,
    controller.dash.cooldownRemaining,
    controller.dash.distanceTravelled,
  ]) {
    assert.ok(Number.isFinite(value));
  }
});
