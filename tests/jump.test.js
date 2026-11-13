import test from "node:test";
import assert from "node:assert/strict";
import { Group, Vector3 } from "three";
import { JumpState, JUMP_CONFIG } from "../src/movement/JumpState.js";
import { CharacterController } from "./helpers/ControllerFixture.js";
import { ArenaBounds } from "../src/world/ArenaBounds.js";

const DT = 1 / 60;
const input = (x = 0, y = 0, sprinting = false) => ({
  move: { x, y },
  sprinting,
});
const close = (actual, expected, tolerance = 1e-8) =>
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${actual} should equal ${expected} within ${tolerance}`,
  );
const actor = (options = {}, world = new ArenaBounds(100)) => {
  const root = new Group();
  return { root, controller: new CharacterController(root, world, options) };
};
const advance = (
  controller,
  seconds,
  controls = input(),
  dt = DT,
  yaw = 0,
  target,
) => {
  let remaining = seconds;
  while (remaining > 1e-9) {
    const step = Math.min(dt, remaining);
    controller.update(step, controls, yaw, target);
    remaining -= step;
  }
};

test("jump phases include a grounded push, continuous ballistic ascent/descent and landing", () => {
  for (const dt of [1 / 30, 1 / 60, 1 / 120]) {
    const { root, controller: c } = actor();
    const phases = new Set();
    assert.equal(c.requestJump(), true);
    let maximum = 0;
    let ascended = false;
    let descended = false;
    let previousY = 0;
    for (let frame = 0; frame < Math.ceil(1.2 / dt); frame++) {
      c.update(dt, input(), 0);
      phases.add(c.jump.phase);
      assert.ok(root.position.y >= 0);
      close(root.position.y, c.jump.height);
      close(c.speed, 0);
      close(c.velocity.y, 0);
      assert.ok(
        Math.abs(root.position.y - previousY) <=
          c.jump.launchVelocity * dt + 1e-6,
        "no frame teleports the root above the ballistic speed bound",
      );
      ascended ||= root.position.y > previousY + 0.001;
      descended ||= root.position.y < previousY - 0.001;
      maximum = Math.max(maximum, root.position.y);
      previousY = root.position.y;
    }
    assert.deepEqual(
      phases,
      new Set(["takeoff", "airborne", "landing", "grounded"]),
    );
    assert.ok(ascended && descended);
    close(maximum, JUMP_CONFIG.height, 0.003);
    close(root.position.y, 0);
    close(c.jump.verticalVelocity, 0);
    assert.equal(c.jump.ready, true);
    assert.equal(c.movementState, "locomotion");
  }
});

test("vertical height and touchdown timing use exact gravity at arbitrary step sizes", () => {
  const states = [1 / 30, 1 / 60, 1 / 120, 0.079].map((dt) => {
    const jump = new JumpState();
    assert.equal(jump.start(), true);
    let remaining = 0.38;
    while (remaining > 1e-9) {
      const step = Math.min(dt, remaining);
      jump.advance(step);
      remaining -= step;
    }
    return jump;
  });
  const flightTime = 0.38 - JUMP_CONFIG.takeoffDuration;
  const expected =
    Math.sqrt(2 * 18 * JUMP_CONFIG.height) * flightTime -
    0.5 * 18 * flightTime ** 2;
  for (const jump of states) {
    close(jump.height, expected);
    close(jump.verticalVelocity, jump.launchVelocity - 18 * flightTime);
    const timeToTouchdown = jump.timeToBoundary;
    jump.advance(timeToTouchdown - 0.00001);
    assert.equal(jump.phase, "airborne");
    assert.ok(jump.height > 0);
    jump.advance(0.00002);
    assert.equal(jump.phase, "landing");
    close(jump.height, 0);
    close(jump.landingSpeed, jump.launchVelocity);
  }
});

test("long frames consume takeoff, flight, landing and leftover ground movement without a second hop", () => {
  const jump = new JumpState();
  jump.start();
  jump.advance(3);
  assert.equal(jump.ready, true);
  assert.equal(jump.sequence, 1);
  close(jump.height, 0);
  close(jump.verticalVelocity, 0);
  const { root, controller: c } = actor();
  c.requestJump();
  c.update(2, input(0, 1), 0);
  assert.equal(c.jump.ready, true);
  close(root.position.y, 0);
  assert.ok(root.position.z < -3);
  assert.equal(c.jump.sequence, 1);
});

test("walking and sprinting momentum survive takeoff and a centred stick in flight", () => {
  for (const sprinting of [false, true]) {
    const { root, controller: c } = actor();
    const controls = input(0, 1, sprinting);
    advance(c, 1.5, controls);
    const speed = sprinting ? 5.2 : 2.6;
    close(c.velocity.length(), speed, 0.001);
    const start = root.position.clone();
    assert.equal(c.requestJump(), true);
    c.update(DT, input(), 0);
    assert.ok(
      c.velocity.length() > speed * 0.99,
      "jump entry does not apply ordinary ground braking to released input",
    );
    advance(c, 0.3 - DT, input());
    assert.equal(c.jump.airborne, true);
    assert.ok(c.velocity.length() > speed * 0.96);
    assert.ok(start.z - root.position.z > speed * 0.28);
    close(c.speed, Math.hypot(c.velocity.x, c.velocity.z), 0.02);
  }
});

test("forward, backward, sideways and camera-relative jumps follow the joystick", () => {
  for (const [controls, yaw, expected] of [
    [input(0, 1), 0, new Vector3(0, 0, -1)],
    [input(0, -1), 0, new Vector3(0, 0, 1)],
    [input(1, 0), 0, new Vector3(1, 0, 0)],
    [input(-1, 0), 0, new Vector3(-1, 0, 0)],
    [input(0, 1), Math.PI / 2, new Vector3(-1, 0, 0)],
  ]) {
    const { root, controller: c } = actor();
    advance(c, 0.5, controls, DT, yaw);
    const start = root.position.clone();
    c.requestJump();
    advance(c, 0.3, controls, DT, yaw);
    const direction = root.position.clone().sub(start).setY(0).normalize();
    assert.ok(direction.distanceTo(expected) < 1e-8);
    assert.ok(root.position.y > 0.5);
  }
});

test("air steering responds immediately while preserving momentum through reversals", () => {
  const { root, controller: c } = actor();
  advance(c, 1, input(0, 1, true));
  c.requestJump();
  advance(c, 0.2, input(0, 1, true));
  const previous = c.velocity.clone();
  const position = root.position.clone();
  c.update(DT, input(1, 0, true), 0);
  assert.ok(c.velocity.x > 0);
  assert.ok(c.velocity.z < -4.7);
  assert.ok(c.velocity.distanceTo(previous) < 0.5);
  assert.ok(root.position.z < position.z);
  const beforeReverse = c.velocity.clone();
  c.update(DT, input(-1, -1, true), 0);
  assert.ok(c.velocity.z < -4);
  assert.ok(c.velocity.distanceTo(beforeReverse) < 0.6);
  advance(c, 0.25, input(-1, -1, true));
  assert.ok(c.velocity.x < -1);
  assert.ok(c.velocity.z > -1.5);
});

test("air control and drag are configurable and constant-input paths are rate independent", () => {
  const endpoints = [1 / 30, 1 / 60, 1 / 120].map((dt) => {
    const { root, controller: c } = actor({
      jumpConfig: { takeoffDuration: 0, airControl: 4 },
    });
    c.velocity.set(0, 0, -5.2);
    c.requestJump();
    advance(c, 0.3, input(1, 0, true), dt);
    return root.position.clone();
  });
  for (const endpoint of endpoints)
    assert.ok(endpoint.distanceTo(endpoints[0]) < 1e-8);
  const slow = actor({ jumpConfig: { takeoffDuration: 0, airControl: 1 } });
  const fast = actor({ jumpConfig: { takeoffDuration: 0, airControl: 8 } });
  for (const { controller: c } of [slow, fast]) {
    c.velocity.set(0, 0, -5.2);
    c.requestJump();
    advance(c, 0.3, input(1, 0, true));
  }
  assert.ok(fast.controller.velocity.x > slow.controller.velocity.x + 2);
  const coast = actor({ jumpConfig: { takeoffDuration: 0, airDrag: 0 } });
  coast.controller.velocity.set(3, 0, 0);
  coast.controller.requestJump();
  advance(coast.controller, 0.3);
  close(coast.root.position.x, 0.9);
  close(coast.controller.velocity.x, 3);
});

test("takeoff, third-jump and landing input is rejected without buffering", () => {
  const { controller: c } = actor();
  assert.equal(c.requestJump(), true);
  assert.equal(c.requestJump(), false);
  const phases = new Set();
  let second = false;
  do {
    c.update(DT, input(), 0);
    if (!c.jump.ready) {
      phases.add(c.jump.phase);
      if (c.jump.airborne && !second) {
        assert.equal(c.requestJump(), true);
        assert.equal(c.requestJump(), false);
        second = true;
      } else assert.equal(c.requestJump(), false);
    }
  } while (!c.jump.ready);
  assert.deepEqual(phases, new Set(["takeoff", "airborne", "landing"]));
  advance(c, 1);
  assert.equal(c.jump.sequence, 2);
  assert.equal(c.requestJump(), true);
  c.update(DT, input(), 0);
  assert.equal(c.jump.sequence, 3);
});

test("ground skills keep request order without buffering takeoff or landing requests", () => {
  const jumpFirst = actor().controller;
  assert.equal(jumpFirst.requestJump(), true);
  assert.equal(jumpFirst.requestDash(), false);
  jumpFirst.update(DT, input(), 0);
  while (!jumpFirst.jump.ready) {
    if (!jumpFirst.jump.airborne) assert.equal(jumpFirst.requestDash(), false);
    jumpFirst.update(DT, input(), 0);
  }
  assert.equal(jumpFirst.dash.sequence, 0);
  advance(jumpFirst, 0.2);
  assert.equal(jumpFirst.requestDash(), true);
  jumpFirst.update(DT, input(), 0);
  assert.equal(jumpFirst.dash.active, true);

  const dashFirst = actor().controller;
  assert.equal(dashFirst.requestDash(), true);
  assert.equal(dashFirst.requestJump(), true);
  dashFirst.update(DT, input(), 0);
  assert.equal(dashFirst.requestJump(), false);
  assert.equal(dashFirst.dash.exitReason, "jumped");
  advance(dashFirst, 0.3);
  assert.equal(dashFirst.jump.sequence, 1);
  advance(dashFirst, 0.7);
  assert.equal(
    dashFirst.requestJump(),
    true,
    "dash cooldown need not suppress an otherwise available grounded jump",
  );
});

test("airborne wall and dummy collisions preserve elevation and continuous containment", () => {
  const dummy = {
    position: new Vector3(0, 0, -1.2),
    radius: 0.32,
    active: true,
  };
  const world = new ArenaBounds(2, [dummy]);
  const { root, controller: c } = actor(
    { jumpConfig: { takeoffDuration: 0 } },
    world,
  );
  c.velocity.set(0, 0, -5.2);
  c.requestJump();
  let contacted = false;
  for (let frame = 0; frame < 28; frame++) {
    c.update(DT, input(0, 1, true), 0);
    assert.ok(
      Math.hypot(
        root.position.x - dummy.position.x,
        root.position.z - dummy.position.z,
      ) >=
        0.68 - 1e-8,
    );
    assert.ok(Math.abs(root.position.x) <= 1.64 + 1e-9);
    assert.ok(Math.abs(root.position.z) <= 1.64 + 1e-9);
    close(root.position.y, c.jump.height);
    contacted ||= root.position.z <= -0.519;
  }
  assert.ok(contacted);
  assert.ok(root.position.y > 0);
  advance(c, 0.8, input(1, 1, true));
  close(root.position.y, 0);
  assert.ok(Math.abs(root.position.x) <= 1.64 + 1e-9);
  assert.ok(Math.abs(root.position.z) <= 1.64 + 1e-9);
});

test("active jump ignores target-facing and never pulls toward an opponent", () => {
  const withTarget = actor();
  const baseline = actor();
  const target = new Vector3(0.8, 0, 0);
  for (const actor of [withTarget, baseline]) {
    actor.controller.requestJump();
  }
  for (let frame = 0; frame < 30; frame++) {
    withTarget.controller.update(DT, input(0, 1), 0, target);
    baseline.controller.update(DT, input(0, 1), 0);
    assert.ok(withTarget.root.position.equals(baseline.root.position));
    close(withTarget.controller.heading, baseline.controller.heading);
  }
});

test("stop clears pending input but preserves active height and vertical momentum", () => {
  const pending = actor();
  pending.controller.requestJump();
  pending.controller.stop();
  pending.controller.update(DT, input(), 0);
  assert.equal(pending.controller.jump.sequence, 0);
  close(pending.root.position.y, 0);

  const { root, controller: c } = actor();
  c.requestJump();
  advance(c, 0.3, input(0, 1, true));
  const height = root.position.y;
  const verticalVelocity = c.jump.verticalVelocity;
  const elapsed = c.jump.elapsed;
  c.stop();
  close(root.position.y, height);
  close(c.jump.verticalVelocity, verticalVelocity);
  close(c.jump.elapsed, elapsed);
  close(c.velocity.length(), 0);
  assert.equal(c.movementState, "jump");
  assert.equal(c.canJump, true);
  assert.equal(c.jump.jumpCount, 1);
  c.update(DT, input(), 0);
  assert.ok(root.position.y > height);
  advance(c, 1);
  close(root.position.y, 0);
  assert.equal(c.jump.ready, true);
});

test("jump tuning changes height and duration independently and rejects invalid settings", () => {
  const jump = new JumpState({
    height: 0.5,
    gravity: 10,
    takeoffDuration: 0,
    landingDuration: 0,
  });
  jump.start();
  jump.advance(jump.launchVelocity / 10);
  close(jump.height, 0.5);
  close(jump.verticalVelocity, 0);
  jump.advance(jump.launchVelocity / 10);
  assert.equal(jump.ready, true);
  close(jump.height, 0);
  for (const overrides of [
    { height: 0 },
    { gravity: 0 },
    { gravity: NaN },
    { airControl: -1 },
    { airDrag: Infinity },
  ])
    assert.throws(() => new JumpState(overrides), RangeError);
});

test("zero and tiny animation durations cross their boundaries without a zero-progress loop", () => {
  for (const duration of [0, 1e-12, 1e-9]) {
    const { root, controller: c } = actor({
      jumpConfig: { takeoffDuration: duration, landingDuration: duration },
    });
    c.requestJump();
    advance(c, 1.1);
    assert.equal(c.jump.ready, true);
    assert.equal(c.jump.sequence, 1);
    close(root.position.y, 0);
  }
});

test("zero and invalid time steps preserve pending requests and finite transforms", () => {
  const { root, controller: c } = actor();
  c.requestJump();
  for (const dt of [0, -1, NaN, Infinity]) c.update(dt, input(), 0);
  assert.equal(c.jump.sequence, 0);
  assert.equal(c.jumpRequested, true);
  assert.ok(root.position.equals(new Vector3()));
  c.update(DT, input(), 0);
  assert.equal(c.jump.sequence, 1);
});
