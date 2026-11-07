import test from "node:test";
import assert from "node:assert/strict";
import { Group, Vector3, Box3 } from "three";
import { CharacterController } from "../src/movement/CharacterController.js";
import { ArenaBounds } from "../src/world/ArenaBounds.js";
import {
  speedForMagnitude,
  magnitudeForSpeed,
} from "../src/movement/AnalogueLocomotion.js";
import { resolveMovementConfig } from "../src/movement/MovementConfig.js";
import { Stickman } from "../src/character/Stickman.js";
import { CharacterAnimator } from "../src/character/CharacterAnimator.js";

const config = resolveMovementConfig();
const input = (magnitude, x = 0, y = 1) => ({
  move: { x: x * magnitude, y: y * magnitude },
});
const fixture = () =>
  new CharacterController(new Group(), new ArenaBounds(100));
const near = (a, b, tolerance = 1e-6) =>
  assert.ok(Math.abs(a - b) < tolerance, `${a} ~= ${b}`);

test("analogue curve covers slow walk, jog, run and full 5.2m/s sprint without another action", () => {
  let prior = -1;
  for (let i = 0; i <= 512; i++) {
    const speed = speedForMagnitude(i / 512, config.analogue);
    assert.ok(Number.isFinite(speed) && speed >= prior && speed <= 5.2);
    if (i > 0) assert.ok(speed > prior);
    prior = speed;
  }
  near(speedForMagnitude(0, config.analogue), 0);
  near(speedForMagnitude(0.35, config.analogue), 1.3);
  near(speedForMagnitude(0.55, config.analogue), 1.95);
  near(speedForMagnitude(0.7, config.analogue), 2.6);
  near(speedForMagnitude(1, config.analogue), 5.2);
});

test("speed and slope stay continuous across configurable gait thresholds", () => {
  for (const point of config.analogue.points.slice(1, -1)) {
    const h = 1e-5,
      x = point.magnitude,
      mid = speedForMagnitude(x, config.analogue);
    const a = (mid - speedForMagnitude(x - h, config.analogue)) / h;
    const b = (speedForMagnitude(x + h, config.analogue) - mid) / h;
    assert.ok(Math.abs(a - b) < 0.003 && a > 0.1);
  }
  for (const m of [0.01, 0.1, 0.3, 0.65, 0.85, 1])
    near(
      magnitudeForSpeed(speedForMagnitude(m, config.analogue), config.analogue),
      m,
    );
});

test("invalid analogue thresholds and acceleration profiles fail before gameplay", () => {
  for (const analogue of [
    { walkThreshold: 0.8 },
    { jogThreshold: 0.2 },
    { runThreshold: 1 },
    { magnitudeExponent: 0 },
    { accelerationResponse: -1 },
    { decelerationResponse: NaN },
  ])
    assert.throws(
      () => resolveMovementConfig({ movementConfig: { analogue } }),
      RangeError,
    );
});

test("configurable curves do not change jump or dash defaults", () => {
  const custom = resolveMovementConfig({
    movementConfig: { analogue: { magnitudeExponent: 1.4, runThreshold: 0.8 } },
  });
  assert.notEqual(
    speedForMagnitude(0.5, custom.analogue),
    speedForMagnitude(0.5, config.analogue),
  );
  assert.deepEqual(custom.groundDash, config.groundDash);
  assert.deepEqual(custom.aerialDash, config.aerialDash);
  assert.deepEqual(custom.jump, config.jump);
  assert.equal(custom.maxAerialDashes, config.maxAerialDashes);
});

test("dash remains a continuous 2.5m burst at every joystick extension", () => {
  for (const m of [0, 0.12, 0.35, 0.7, 1]) {
    const c = fixture();
    assert.ok(c.requestDash());
    let last = c.root.position.clone();
    for (let i = 0; i < 30; i++) {
      c.update(1 / 120, input(m), 0);
      assert.ok(c.root.position.distanceTo(last) < 0.15);
      last.copy(c.root.position);
    }
    near(c.dash.distanceTravelled, 2.5);
    near(c.root.position.length(), 2.5);
    near(c.dash.cooldownRemaining, 0.45);
  }
});

test("real controller follows every joystick extension, including sprint without a Sprint flag", () => {
  for (const m of [0.05, 0.15, 0.35, 0.5, 0.55, 0.7, 0.85, 1]) {
    const c = fixture();
    for (let i = 0; i < 180; i++) c.update(1 / 60, input(m), 0);
    near(c.speed, speedForMagnitude(m, config.analogue));
    assert.ok(c.root.position.z < 0);
  }
  const a = fixture(),
    b = fixture();
  for (let i = 0; i < 90; i++) {
    a.update(1 / 60, { ...input(1), sprinting: false }, 0);
    b.update(1 / 60, { ...input(1), sprinting: true }, 0);
  }
  assert.ok(a.root.position.equals(b.root.position));
  near(a.speed, 5.2);
});

test("analogue changes preserve acceleration/braking responses, diagonal limits and camera-relative direction", () => {
  const c = fixture();
  c.update(1 / 60, input(1), 0);
  near(c.velocity.length(), 5.2 * (1 - Math.exp(-11 / 60)));
  const speed = c.velocity.length();
  c.update(1 / 60, input(0), 0);
  near(c.velocity.length(), speed * Math.exp(-15 / 60));
  for (const [x, y] of [
    [1, 0],
    [0, 1],
    [Math.SQRT1_2, Math.SQRT1_2],
  ]) {
    const c = fixture();
    for (let i = 0; i < 120; i++) c.update(1 / 60, input(1, x, y), Math.PI / 2);
    near(c.speed, 5.2);
    assert.ok(c.root.position.y === 0);
  }
});

test("analogue steering composes Dash -> Jump -> Air Dash and landing at multiple frame rates", () => {
  for (const fps of [30, 60, 120]) {
    const c = fixture(),
      dt = 1 / fps;
    for (let i = 0; i < fps; i++) c.update(dt, input(1), 0);
    assert.ok(c.requestDash());
    for (let i = 0; i < Math.ceil(0.1 / dt); i++) c.update(dt, input(1), 0);
    assert.ok(c.requestJump());
    while (!c.jump.airborne) c.update(dt, input(0.8), 0);
    assert.equal(c.airDashesRemaining, 1);
    assert.ok(c.requestDash());
    let last = c.root.position.clone();
    for (let i = 0; i < fps; i++) {
      c.update(dt, input(0.85, Math.SQRT1_2, Math.SQRT1_2), 0);
      assert.ok(c.root.position.distanceTo(last) < 18 * dt + 0.01);
      last.copy(c.root.position);
    }
    assert.equal(c.jump.ready, true);
    assert.equal(c.airDashesRemaining, 1);
    assert.ok(c.requestDash());
  }
});

test("walking stays low and relaxed; run and sprint recover the heel behind instead of lifting a marching foot in front", () => {
  for (const speed of [0.65, 1.3, 2.6, 5.2]) {
    const c = new Stickman(),
      a = new CharacterAnimator(c);
    let frontHeight = 0,
      maxKnee = -2,
      roll = 0;
    for (let i = 0; i < 360; i++) {
      c.root.position.z -= speed / 60;
      a.update(1 / 60, { speed });
      if (i < 180) continue;
      for (const s of ["left", "right"]) {
        const f = c.joints[s + "Ankle"].getWorldPosition(new Vector3()),
          k = c.joints[s + "Knee"].getWorldPosition(new Vector3()),
          h = c.joints[s + "Hip"].getWorldPosition(new Vector3());
        maxKnee = Math.max(maxKnee, k.y - h.y);
        if (f.z < c.root.position.z - 0.1)
          frontHeight = Math.max(frontHeight, f.y);
        roll = Math.max(roll, Math.abs(a.feet[s].pitch));
        assert.ok(
          new Box3().setFromObject(c.joints[s + "Ankle"]).min.y > -0.015,
        );
      }
    }
    if (speed <= 1.3) {
      assert.ok(frontHeight < 0.16 && maxKnee < -0.2);
      assert.ok(roll > 0.08);
    }
    if (speed === 2.6) assert.ok(maxKnee < -0.15 && frontHeight < 0.27);
    if (speed === 5.2) assert.ok(maxKnee < 0.08 && frontHeight < 0.46);
    c.dispose();
  }
});
