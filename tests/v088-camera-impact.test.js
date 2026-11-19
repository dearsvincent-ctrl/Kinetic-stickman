import test from "node:test";
import assert from "node:assert/strict";
import { PerspectiveCamera, Vector3 } from "three";
import { CameraImpact, CAMERA_IMPACT_TRANSLATION } from "../src/camera/CameraImpact.js";
import { FollowCamera } from "../src/camera/FollowCamera.js";
import { TraversalWorld } from "../src/world/TraversalWorld.js";
import { box } from "../src/world/TraversalGeometry.js";

const noLook = Object.freeze({ x: 0, y: 0 });
const close = (actual, expected, tolerance = 1e-10) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} vs ${expected}`);
const advance = (channel, seconds, fps) => {
  let elapsed = 0;
  while (elapsed < seconds - 1e-12) {
    const dt = Math.min(1 / fps, seconds - elapsed);
    channel.update(dt);
    elapsed += dt;
  }
};
const scene = () => ({
  velocity: new Vector3(0, 0, -25),
  enemies: [{ spawned: true, body: { id: "side", active: true }, root: { position: new Vector3(-6, 3, -12) } }],
  gameplayMode: "combat",
  manualActive: false,
  rotation: { x: Math.PI, y: -2, z: Math.PI },
});
const follow = (position = new Vector3(), settings) =>
  new FollowCamera(new PerspectiveCamera(52, 2.5, 0.1, 200), position, settings);
const sameBase = (actual, expected) => {
  for (const field of ["yaw", "targetYaw", "pitch", "targetPitch", "renderYaw", "renderPitch", "boomDistance", "obstructionHold"])
    assert.equal(actual[field], expected[field], field);
  assert.deepEqual(actual.target.toArray(), expected.target.toArray());
  assert.deepEqual(actual.lag.toArray(), expected.lag.toArray());
  assert.equal(actual.camera.fov, expected.camera.fov);
  assert.deepEqual(actual.camera.quaternion.toArray(), expected.camera.quaternion.toArray());
  assert.deepEqual(actual.director.state, expected.director.state);
};

test("impact samples agree at 30/60/144 Hz, decay sharply and reach exact zero", () => {
  const checkpoints = [];
  for (const fps of [30, 60, 144]) {
    const impact = new CameraImpact();
    const offset = impact.offset;
    const snapshot = {};
    assert.equal(impact.snapshot(snapshot), snapshot);
    assert.equal(impact.trigger(), true);
    const onset = impact.offset.length();
    advance(impact, 0.1, fps);
    assert.equal(impact.offset, offset, "updates reuse the translation vector");
    assert.ok(impact.offset.length() < onset * 0.2, "the impulse drops promptly");
    checkpoints.push(impact.offset.toArray());
    advance(impact, 0.12, fps);
    assert.equal(impact.active, false);
    assert.deepEqual(impact.offset.toArray(), [0, 0, 0]);
    impact.update(1 / fps);
    assert.deepEqual(impact.offset.toArray(), [0, 0, 0]);
    assert.equal(impact.snapshot(snapshot).remaining, 0);
  }
  for (const point of checkpoints)
    point.forEach((value, axis) => close(value, checkpoints[0][axis]));
});

test("repeated impacts replace the deterministic envelope without stacking", () => {
  const impact = new CameraImpact({ strength: 2, duration: 0.65 });
  impact.trigger();
  const onset = impact.offset.toArray();
  for (let frame = 0; frame < 1000; frame++) {
    impact.update(1 / 144);
    assert.ok(impact.offset.length() <= CAMERA_IMPACT_TRANSLATION * 2);
    impact.trigger(100, 100);
    assert.deepEqual(impact.offset.toArray(), onset);
    assert.equal(impact.activeStrength, 2);
    assert.equal(impact.activeDuration, 0.65);
  }
  impact.reset();
  assert.equal(impact.active, false);
  assert.deepEqual(impact.offset.toArray(), [0, 0, 0]);
});

test("disabled, zero and malformed settings or time inputs remain finite", () => {
  const impact = new CameraImpact({ enabled: false, strength: Infinity, duration: NaN });
  assert.equal(impact.trigger(), false);
  assert.deepEqual(impact.offset.toArray(), [0, 0, 0]);
  impact.configure({ enabled: true, strength: -5, duration: -2 });
  assert.equal(impact.strength, 0);
  assert.equal(impact.duration, 0.05);
  assert.equal(impact.trigger(), false);
  impact.configure({ strength: 0.8, duration: 0.22 });
  impact.trigger(NaN, Infinity);
  const onset = impact.offset.toArray();
  for (const dt of [0, -1, NaN, Infinity, -Infinity]) {
    impact.update(dt);
    assert.deepEqual(impact.offset.toArray(), onset);
  }
  impact.configure({ duration: 100 });
  assert.equal(impact.duration, 0.65);
  assert.equal(impact.activeDuration, 0.22, "live settings do not stretch an existing impact");
  impact.update(1e308);
  assert.deepEqual(impact.offset.toArray(), [0, 0, 0]);
  impact.trigger();
  impact.configure({ enabled: false });
  assert.equal(impact.active, false);
  assert.deepEqual(impact.offset.toArray(), [0, 0, 0]);
  impact.configure({ enabled: true });
  impact.trigger();
  impact.configure({ strength: 0 });
  assert.equal(impact.active, false);
  assert.deepEqual(impact.offset.toArray(), [0, 0, 0]);
});

test("rendered impact recovers exactly to the untouched moving follow camera at all frame rates", () => {
  for (const fps of [30, 60, 144]) {
    const p = new Vector3();
    const actual = follow(p, { mode: "dynamic", dynamicFov: true });
    const expected = follow(p, { mode: "dynamic", dynamicFov: true });
    const ctx = scene();
    actual.triggerImpact();
    let visible = false;
    for (let frame = 0; frame < fps; frame++) {
      p.z -= 25 / fps;
      const look = frame > fps / 4 && frame < fps / 2 ? { x: 2, y: -1 } : noLook;
      actual.update(1 / fps, p, look, ctx);
      expected.update(1 / fps, p, look, ctx);
      sameBase(actual, expected);
      assert.ok(actual.camera.position.distanceTo(expected.camera.position) <= CAMERA_IMPACT_TRANSLATION * 0.8 + 1e-12);
      if (actual.impact.active) visible ||= actual.impactOffset.lengthSq() > 0;
      else {
        assert.deepEqual(actual.camera.position.toArray(), expected.camera.position.toArray());
        assert.deepEqual(actual.impactOffset.toArray(), [0, 0, 0]);
      }
    }
    assert.equal(visible, true);
  }
});

test("manual takeover and camera mode changes cannot inherit an impact into the orbit or preferences", () => {
  const p = new Vector3();
  const actual = follow(p, { mode: "dynamic", dynamicFov: true });
  const expected = follow(p, { mode: "dynamic", dynamicFov: true });
  const ctx = scene();
  for (let frame = 0; frame < 120; frame++) {
    actual.update(1 / 60, p, noLook, ctx);
    expected.update(1 / 60, p, noLook, ctx);
  }
  assert.equal(actual.director.state.selectedTargetId, "side");
  actual.triggerImpact(2, 0.65);
  const profiles = ["manual", "assisted", "dynamic"];
  for (const mode of profiles) {
    actual.configure({ mode });
    expected.configure({ mode });
    ctx.gameplayMode = mode === "assisted" ? "tag" : "combat";
    ctx.manualActive = true;
    actual.update(1 / 60, p, { x: 15, y: -4 }, ctx);
    expected.update(1 / 60, p, { x: 15, y: -4 }, ctx);
    sameBase(actual, expected);
    assert.deepEqual(actual.settings, expected.settings);
  }
  for (let frame = 0; frame < 60; frame++) {
    actual.update(1 / 60, p, noLook, ctx);
    expected.update(1 / 60, p, noLook, ctx);
  }
  sameBase(actual, expected);
  assert.deepEqual(actual.camera.position.toArray(), expected.camera.position.toArray());
});

test("floor clipping bounds the final translation and recenter/reset clear the channel", () => {
  const p = new Vector3(0, -3, 0);
  const actual = follow(p);
  const expected = follow(p);
  actual.triggerImpact(2, 0.65);
  for (let frame = 0; frame < 100; frame++) {
    actual.update(1 / 144, p, noLook);
    expected.update(1 / 144, p, noLook);
    assert.ok(actual.camera.position.y >= 0.3);
    assert.ok(actual.camera.position.distanceTo(expected.camera.position) <= CAMERA_IMPACT_TRANSLATION * 2 + 1e-12);
    sameBase(actual, expected);
  }
  actual.triggerImpact();
  actual.recenter(p);
  assert.equal(actual.impact.active, false);
  assert.deepEqual(actual.impactOffset.toArray(), [0, 0, 0]);
  actual.triggerImpact();
  actual.reset(0.6);
  assert.equal(actual.impact.active, false);
  assert.deepEqual(actual.impactOffset.toArray(), [0, 0, 0]);
  actual.triggerImpact();
  p.x = 500;
  actual.update(1 / 60, p, noLook, { velocity: new Vector3() });
  assert.equal(actual.impact.active, false, "unexplained teleport clears presentation motion");
});

test("walls, corners and roofs constrain the final near-plane envelope without changing boom recovery", () => {
  for (const [p, structures] of [
    [new Vector3(), [box("wall", 0, 3.5, 10, 10, 1)]],
    [new Vector3(-2.4, 0, 0), [box("corner", 0, 0, 4, 10, 4)]],
    [new Vector3(), [box("roof", 0, 0, 20, 1, 20, false, 1.75)]],
  ]) {
    const world = new TraversalWorld(100, [], structures);
    const actual = follow(p, { baseFov: 105 });
    const expected = follow(p, { baseFov: 105 });
    actual.world = world;
    expected.world = world;
    actual.triggerImpact(2, 0.65);
    const margin = Math.min(0.5, Math.max(0.2, actual.camera.near * Math.sqrt(1 + Math.tan(105 * Math.PI / 360) ** 2 * (1 + actual.camera.aspect ** 2))));
    const bottom = new Vector3();
    for (let frame = 0; frame < 100; frame++) {
      actual.update(1 / 144, p, noLook);
      expected.update(1 / 144, p, noLook);
      sameBase(actual, expected);
      assert.ok(actual.camera.position.y >= 0.3);
      assert.ok(actual.camera.position.distanceTo(expected.camera.position) <= CAMERA_IMPACT_TRANSLATION * 2 + 1e-10);
      bottom.copy(actual.camera.position);
      bottom.y -= margin - 0.005;
      assert.ok(world.isSpaceFree(bottom, margin - 0.005, (margin - 0.005) * 2), `near plane intersects ${structures[0].id}`);
      if (!actual.impact.active)
        assert.deepEqual(actual.camera.position.toArray(), expected.camera.position.toArray());
    }
  }
});
