import test from "node:test";
import assert from "node:assert/strict";
import { Group, Quaternion, Vector3 } from "three";
import { JoystickGestures } from "../src/movement/JoystickGestures.js";
import { BodyRotation } from "../src/movement/BodyRotation.js";
import { CharacterController } from "../src/movement/CharacterController.js";
import { ArenaBounds } from "../src/world/ArenaBounds.js";
import { sandboxMovementConfig } from "../src/sandbox/PhysicsSandbox.js";
const close = (a, b, e = 1e-8) =>
  assert.ok(Math.abs(a - b) < e, `${a} ~= ${b}`);
const movement = () => {
  const m = new CharacterController(new Group(), new ArenaBounds(10000));
  m.velocity.set(0, 0, -5);
  m.speed = 5;
  m.sprintSpeed = 5.2;
  return m;
};
const stick = (x = 0, y = 0) => ({
  move: { x, y },
  movementMagnitude: Math.hypot(x, y),
  joystickPointer: 1,
  blocking: false,
});
function prime(g, m, input = stick(0, 1), duration = 0.3) {
  for (let t = 0; t < duration - 1e-9; t += 1 / 60)
    assert.equal(g.update(1 / 60, input, m, 0), null);
}
function airMovement() {
  const m = movement();
  m.jump.phase = "airborne";
  m.jump.height = 2;
  m.root.position.y = 2;
  m.jump.verticalVelocity = 1;
  return m;
}
test("ground reversals never request an attack or body spin", () => {
  for (const x of [-0.707, 0.707, 0, 1]) {
    const g = new JoystickGestures(),
      m = movement();
    prime(g, m);
    assert.equal(g.update(1 / 60, stick(), m, 0), null);
    assert.equal(g.update(1 / 60, stick(x, x === 1 ? 0 : -1), m, 0), null);
    assert.equal(g.sequence, 0);
  }
});
test("walks, jogging reversals, slow turns, camera orbit, Block and non-joystick movement never generate techniques", () => {
  for (const variant of ["slow", "speed", "camera", "block", "keyboard"]) {
    const g = new JoystickGestures(),
      m = movement();
    if (variant === "speed") m.velocity.z = -2;
    prime(g, m);
    if (variant === "slow") {
      for (let n = 1; n <= 20; n++) {
        const a = (n * Math.PI) / 20;
        assert.equal(
          g.update(1 / 60, stick(Math.sin(a), Math.cos(a)), m, 0),
          null,
        );
      }
    } else if (variant === "camera")
      assert.equal(g.update(1 / 60, stick(0, 1), m, Math.PI), null);
    else {
      const input = stick(0, -1);
      if (variant === "block") input.blocking = true;
      if (variant === "keyboard") input.joystickPointer = null;
      assert.equal(g.update(1 / 60, input, m, 0), null);
    }
  }
});
test("gesture cooldown and fresh stable prime prevent repeated reversal spam", () => {
  const g = new JoystickGestures(),
    m = airMovement();
  prime(g, m, stick(0, 1), 0.1);
  assert.ok(g.update(1 / 60, stick(0, -1), m, 0));
  for (let n = 0; n < 30; n++)
    assert.equal(g.update(1 / 60, stick(0, n % 2 ? -1 : 1), m, 0), null);
});
test("air backflip requires forward prime and a fast backward flick, not ordinary backward air steering", () => {
  const m = airMovement();
  let g = new JoystickGestures();
  assert.equal(g.update(1 / 60, stick(0, -1), m, 0), null);
  g = new JoystickGestures();
  prime(g, m, stick(0, 1), 0.1);
  g.update(1 / 60, stick(), m, 0);
  assert.equal(g.update(1 / 60, stick(0, -1), m, 0)?.kind, "backflip");
  m.jump.height = 0.05;
  g = new JoystickGestures();
  prime(g, m, stick(0, 1), 0.1);
  assert.equal(g.update(1 / 60, stick(0, -1), m, 0), null);
});
test("late descent, touch release or a stale prime cannot initiate an air flip", () => {
  const m = airMovement();
  m.jump.height = 0.1;
  m.jump.verticalVelocity = -5;
  const g = new JoystickGestures();
  prime(g, m, stick(0, 1), 0.1);
  assert.equal(g.update(1 / 60, stick(0, -1), m, 0), null);
  const m2 = airMovement(),
    g2 = new JoystickGestures();
  prime(g2, m2, stick(0, 1), 0.1);
  g2.update(1 / 60, { ...stick(), joystickPointer: null }, m2, 0);
  assert.equal(g2.update(1 / 60, stick(0, -1), m2, 0), null);
});
function rotate(input, duration = 0.25) {
  const m = airMovement(),
    r = new BodyRotation();
  r.start("backflip", 0);
  for (let t = 0; t < duration - 1e-9; t += 1 / 120)
    r.update(1 / 120, m, input, 0);
  return r;
}
test("back pressure accelerates a flip, forward pressure slows and can reverse it, release retains momentum", () => {
  const back = rotate(stick(0, -1)),
    free = rotate(stick()),
    forward = rotate(stick(0, 1));
  assert.ok(back.angularVelocity.x > free.angularVelocity.x);
  assert.ok(free.angularVelocity.x > forward.angularVelocity.x);
  assert.ok(free.angularVelocity.x > 5);
  assert.ok(rotate(stick(0, 1), 0.6).angularVelocity.x < 0);
});
test("inverted easing is soft, responds to pressure and does not alter translation or gravity", () => {
  const m = airMovement(),
    a = new BodyRotation(),
    b = new BodyRotation();
  a.start("backflip", 0);
  b.start("backflip", 0);
  a.orientation.setFromAxisAngle(new Vector3(1, 0, 0), Math.PI);
  b.orientation.copy(a.orientation);
  a.angularVelocity.x = b.angularVelocity.x = 8;
  const before = m.root.position.clone(),
    velocity = m.velocity.clone(),
    gravity = m.jump.config.gravity;
  a.update(0.04, m, stick(), 0);
  b.update(0.04, m, stick(0, -1), 0);
  assert.ok(a.invertedWeight > 0.8);
  assert.ok(a.angularVelocity.x > 0);
  assert.ok(b.angularVelocity.x > a.angularVelocity.x);
  assert.deepEqual(m.root.position, before);
  assert.deepEqual(m.velocity, velocity);
  assert.equal(m.jump.config.gravity, gravity);
});
test("yaw, pitch and roll retain finite normalized quaternions across varied frame rates", () => {
  for (const fps of [30, 60, 144]) {
    const m = airMovement(),
      r = new BodyRotation();
    r.start("backflip", 0.7);
    for (let n = 0; n < fps * 3; n++)
      r.update(1 / fps, m, stick(0.6, -0.8), 0.2);
    assert.ok(Math.abs(r.angularVelocity.z) > 0.1);
    assert.ok(Math.abs(r.angularVelocity.y) > 0.1);
    close(r.orientation.length(), 1, 1e-10);
    assert.ok(r.angularVelocity.length() <= r.config.maxAngularSpeed + 1e-8);
  }
});
test("landing recovers smoothly to upright without changing the actor root", () => {
  const m = airMovement(),
    r = rotate(stick(0, 1), 0.25);
  m.jump.phase = "landing";
  m.jump.height = 0;
  m.root.position.y = 0;
  const prior = r.orientation.clone();
  r.update(1 / 60, m, stick(), 0);
  assert.ok(prior.angleTo(r.orientation) < 0.5);
  for (let n = 0; n < 400; n++) r.update(1 / 120, m, stick(), 0);
  assert.equal(r.phase, "idle");
  close(r.orientation.angleTo(new Quaternion()), 0, 1e-6);
  close(m.root.position.y, 0);
});
test("100x sandbox translation and independent rotation remain stable through jump and landing", () => {
  const m = movement();
  m.applyMovementConfig(
    sandboxMovementConfig({
      movement: 100,
      jumpHeight: 100,
      gravity: 100,
      airControl: 100,
    }),
  );
  m.requestJump();
  const r = new BodyRotation();
  let launched = false;
  for (let n = 0; n < 600; n++) {
    m.update(1 / 120, stick(0.6, -0.8), 0);
    if (m.jump.airborne && !launched) {
      r.start("backflip", m.heading);
      launched = true;
    }
    r.update(1 / 120, m, stick(0.6, -0.8), 0);
    assert.ok(
      [...r.orientation.toArray(), ...m.root.position.toArray()].every(
        Number.isFinite,
      ),
    );
    assert.ok(m.root.position.y >= 0);
  }
  assert.ok(launched);
  assert.ok(m.jump.ready);
  assert.equal(r.phase, "idle");
});
test("invalid angular parameters fail safely and speed bounds remain configurable", () => {
  for (const n of [NaN, Infinity, 0, -1])
    assert.throws(() => new BodyRotation({ pitchTorque: n }), RangeError);
  assert.equal(
    new BodyRotation({ maxAngularSpeed: 1000 }).config.maxAngularSpeed,
    60,
  );
});

test("backflip control reference stays on the primed direction even if steering has turned the body", () => {
  const g = new JoystickGestures(),
    m = airMovement();
  prime(g, m, stick(0, 1), 0.1);
  m.heading = Math.PI;
  g.update(1 / 60, stick(), m, 0);
  const gesture = g.update(1 / 60, stick(0, -1), m, 0);
  assert.equal(gesture.kind, "backflip");
  assert.equal(gesture.referenceYaw, 0);
  const rotations = [];
  for (const y of [-1, 1]) {
    const r = new BodyRotation();
    r.start("backflip", m.heading, gesture.direction, 1, gesture.referenceYaw);
    const original = r.orientation.clone();
    for (let n = 0; n < 12; n++) r.update(1 / 120, m, stick(0, y), 0);
    rotations.push(r.angularVelocity.x);
    assert.ok(r.orientation.angleTo(original) > 0);
  }
  assert.ok(
    rotations[0] > rotations[1] + 2,
    "Backward pressure accelerates; forward pressure brakes independently of the turned travel heading",
  );
});
