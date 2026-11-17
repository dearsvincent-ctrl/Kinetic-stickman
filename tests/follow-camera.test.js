import test from "node:test";
import assert from "node:assert/strict";
import { PerspectiveCamera, Vector3 } from "three";
import { FollowCamera } from "../src/camera/FollowCamera.js";
import { TraversalWorld } from "../src/world/TraversalWorld.js";
import { box } from "../src/world/TraversalGeometry.js";

const close = (actual, expected, tolerance = 1e-9) =>
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${actual} should be within ${tolerance} of ${expected}`,
  );
const noLook = Object.freeze({ x: 0, y: 0 });
const enemy = (id, x, y, z) => ({
  spawned: true,
  body: { id, active: true },
  root: { position: new Vector3(x, y, z) },
});
const context = (overrides = {}) => ({
  velocity: new Vector3(),
  enemies: [],
  gameplayMode: "combat",
  manualActive: false,
  ...overrides,
});
function acquire(follow, position, ctx, seconds = 2, fps = 60) {
  for (let frame = 0; frame < seconds * fps; frame++)
    follow.update(1 / fps, position, noLook, ctx);
}

test("manual defaults retain the original orbit, low pitch, damping and interrupted drag accumulation", () => {
  const camera = new PerspectiveCamera();
  const p = new Vector3();
  const follow = new FollowCamera(camera, p);
  close(camera.fov, 52);
  close(follow.distance, 4.8);
  close(follow.pitch, 0.23);
  close(camera.position.distanceTo(follow.target), 4.8);
  assert.equal(follow.maxLag, Infinity);
  const dt = 1 / 60;
  const blend = 1 - Math.exp(-20 * dt);
  let expectedYaw = 0;
  let expectedTarget = 0;
  // Two fresh touches arrive before the previous orbit has caught up.
  for (const x of [80, 0, 0, 50, 0, -20, 0]) {
    expectedTarget -= x * 0.0045;
    expectedYaw += (expectedTarget - expectedYaw) * blend;
    follow.update(dt, p, { x, y: 0 });
    close(follow.targetYaw, expectedTarget);
    close(follow.yaw, expectedYaw);
    close(follow.renderYaw, expectedYaw);
  }
  p.x = 10;
  follow.update(dt, p, noLook);
  close(follow.target.x, 10 * (1 - Math.exp(-16 * dt)));
  follow.maxLag = 0.65;
  p.set(200, 80, -100);
  follow.update(dt, p, noLook);
  assert.ok(follow.target.distanceTo(p.clone().add(new Vector3(0, 1.02, 0))) <= 0.650001);
});

test("live configuration updates the real perspective projection and preserves the manual orbit", () => {
  const camera = new PerspectiveCamera(52, 2.1, 0.1, 200);
  const follow = new FollowCamera(camera, new Vector3());
  follow.update(0.03, new Vector3(), { x: 120, y: 25 });
  const yaw = follow.yaw;
  const targetYaw = follow.targetYaw;
  const pitch = follow.pitch;
  const oldProjection = camera.projectionMatrix.clone();
  follow.configure({ baseFov: 78, sensitivity: 2 });
  close(camera.fov, 78);
  assert.notDeepEqual(camera.projectionMatrix.elements, oldProjection.elements);
  const expected = new PerspectiveCamera(78, 2.1, 0.1, 200);
  assert.deepEqual(camera.projectionMatrix.elements, expected.projectionMatrix.elements);
  close(follow.yaw, yaw);
  close(follow.targetYaw, targetYaw);
  close(follow.pitch, pitch);
  follow.configure({ smoothness: 0.8 });
  assert.equal(follow.settings.sensitivity, 2, "partial updates retain other values");
  assert.equal(follow.settings.baseFov, 78);
  const orbit = new FollowCamera(new PerspectiveCamera(), new Vector3(), { sensitivity: 0.1 });
  const fastSensitivity = new FollowCamera(new PerspectiveCamera(), new Vector3(), { sensitivity: 4 });
  orbit.update(1 / 60, new Vector3(), { x: 24, y: 12 });
  fastSensitivity.update(1 / 60, new Vector3(), { x: 24, y: 12 });
  close(orbit.targetYaw, fastSensitivity.targetYaw);
  close(orbit.targetPitch, fastSensitivity.targetPitch);
});

test("assist offsets never accumulate into the anchor and a still held touch takes over without an orbit snap", () => {
  const p = new Vector3();
  const follow = new FollowCamera(new PerspectiveCamera(), p, {
    mode: "dynamic",
    strength: 0.8,
    overrideDelay: 0.3,
  });
  const ctx = context({ enemies: [enemy("right", -7, 2, -12)] });
  acquire(follow, p, ctx);
  assert.equal(follow.director.state.selectedTargetId, "right");
  assert.ok(Math.abs(follow.renderYaw) > 0.05);
  close(follow.targetYaw, 0);
  close(follow.yaw, 0);
  const visibleYaw = follow.renderYaw;
  const visiblePitch = follow.renderPitch;
  const held = { ...ctx, manualActive: true };
  follow.update(1 / 60, p, noLook, held);
  close(follow.renderYaw, visibleYaw);
  close(follow.renderPitch, visiblePitch);
  close(follow.targetYaw, visibleYaw);
  assert.equal(follow.director.state.selectedTargetId, null);
  for (let frame = 0; frame < 60; frame++) follow.update(1 / 60, p, noLook, held);
  close(follow.director.state.overrideRemaining, 0.3);
  close(follow.renderYaw, visibleYaw);
  follow.update(0.1, p, noLook, ctx);
  assert.equal(follow.director.state.selectedTargetId, null);
  acquire(follow, p, ctx, 1);
  assert.equal(follow.director.state.selectedTargetId, "right");
  const beforeDrag = follow.renderYaw;
  follow.update(1 / 60, p, { x: 10, y: 0 }, ctx);
  close(follow.renderYaw, beforeDrag - 0.045 * (1 - Math.exp(-20 / 60)));
  close(follow.director.state.yawOffset, 0);
});

test("reset restores the original heading/pitch and postpones autonomous capture", () => {
  const p = new Vector3();
  const follow = new FollowCamera(new PerspectiveCamera(), p, {
    mode: "dynamic",
    overrideDelay: 0.4,
  });
  const ctx = context({ enemies: [enemy("target", -5, 3, -10)] });
  acquire(follow, p, ctx);
  const visibleYaw = follow.renderYaw;
  follow.reset(0.7);
  close(follow.targetYaw, 0.7);
  close(follow.targetPitch, 0.23);
  assert.equal(follow.director.state.selectedTargetId, null);
  follow.update(0.1, p, noLook, ctx);
  close(follow.renderYaw, visibleYaw + (0.7 - visibleYaw) * (1 - Math.exp(-2)));
  assert.equal(follow.director.state.selectedTargetId, null);
  // Body animation/flip transforms supplied by callers do not own the orbit.
  follow.configure({ mode: "manual" });
  acquire(follow, p, { ...ctx, rotation: { x: Math.PI, y: -2, z: Math.PI } });
  close(follow.renderYaw, 0.7);
  close(follow.renderPitch, 0.23);
});

test("dynamic FOV changes the projection smoothly and remains comparable at different frame rates", () => {
  const results = [30, 60, 144].map((fps) => {
    const camera = new PerspectiveCamera(52, 2, 0.1, 200);
    const follow = new FollowCamera(camera, new Vector3(), {
      dynamicFov: true,
      maxFov: 105,
      smoothness: 0.5,
    });
    const initial = camera.projectionMatrix.clone();
    const ctx = context({ velocity: new Vector3(0, 18, 0) });
    follow.update(1 / fps, new Vector3(), noLook, ctx);
    assert.ok(camera.fov >= 52 && camera.fov < 55, "the first frame is blended");
    for (let frame = 1; frame < fps * 2; frame++)
      follow.update(1 / fps, new Vector3(), noLook, ctx);
    assert.ok(camera.fov > 100 && camera.fov <= 105);
    assert.notDeepEqual(camera.projectionMatrix.elements, initial.elements);
    const steadyFov = camera.fov;
    const steadyProjection = camera.projectionMatrix.clone();
    follow.configure({ awareness: 140, strength: 0.5, smoothness: 0.6 });
    close(camera.fov, steadyFov);
    assert.deepEqual(camera.projectionMatrix.elements, steadyProjection.elements);
    return camera.fov;
  });
  assert.ok(Math.max(...results) - Math.min(...results) < 0.2);
});

test("camera clipping keeps the baseline margin and clears wide lenses, corners and low roofs", () => {
  const wall = box("wall", 0, 3.5, 10, 10, 1);
  const world = new TraversalWorld(100, [], [wall]);
  const origin = new Vector3(0, 1.02, 0);
  const desired = new Vector3(0, 2.1, 4.8);
  const oldDefault = world.clipCamera(origin, desired, new Vector3());
  const explicitDefault = world.clipCamera(origin, desired, new Vector3(), 0.2);
  assert.deepEqual(oldDefault.toArray(), explicitDefault.toArray());
  const wide = world.clipCamera(origin, desired, new Vector3(), 0.45);
  assert.ok(wide.z < oldDefault.z);
  let clips = 0;
  let lastMargin = 0;
  const clip = world.clipCamera.bind(world);
  world.clipCamera = (...args) => {
    clips++;
    lastMargin = args[3] ?? 0.2;
    return clip(...args);
  };
  const camera = new PerspectiveCamera(52, 2.5, 0.1, 200);
  const follow = new FollowCamera(camera, new Vector3(), { baseFov: 105 });
  follow.world = world;
  follow.update(1 / 60, new Vector3(), noLook);
  assert.ok(lastMargin > 0.3 && lastMargin <= 0.5);
  assert.ok(clips >= 1 && clips <= 2);
  assert.ok(world.isSpaceFree(camera.position, lastMargin - 0.01, 0.2));
  const closeP = new Vector3(0, 0, 2.68);
  const closeFollow = new FollowCamera(new PerspectiveCamera(52, 2.5, 0.1, 200), closeP, { baseFov: 105 });
  closeFollow.world = world;
  closeFollow.update(1 / 60, closeP, noLook);
  assert.ok(closeFollow.camera.position.z < wall.minZ, "a wide sweep starting in the added clearance shell must not pass through the wall");
  assert.ok(closeFollow.boomDistance < 0.4);
  const escaping = world.clipCamera(
    closeP.clone().add(new Vector3(0, 1.02, 0)),
    new Vector3(0, 2, 0),
    new Vector3(),
    0.4,
  );
  close(escaping.z, 0, 1e-8);
  const corner = new TraversalWorld(100, [], [box("corner", 0, 0, 4, 10, 4)]);
  const cornerP = new Vector3(-2.4, 0, 0);
  const cornerFollow = new FollowCamera(new PerspectiveCamera(), cornerP);
  cornerFollow.world = corner;
  cornerFollow.target.set(0, 1.02, 0);
  cornerFollow.update(1 / 60, cornerP, noLook);
  assert.ok(corner.isSpaceFree(cornerFollow.camera.position, 0.19, 0.2));
  const roof = new TraversalWorld(100, [], [box("roof", 0, 0, 20, 1, 20, false, 1.75)]);
  const roofFollow = new FollowCamera(new PerspectiveCamera(), new Vector3());
  roofFollow.world = roof;
  roofFollow.update(1 / 60, new Vector3(), noLook);
  assert.ok(roofFollow.camera.position.y < 1.55);
  assert.ok(roofFollow.camera.position.y >= 0.3);
  const nearRoof = new TraversalWorld(100, [], [box("near-roof", 0, 0, 20, 1, 20, false, 1.34)]);
  const nearRoofFollow = new FollowCamera(new PerspectiveCamera(52, 2.5, 0.1, 200), new Vector3(), { baseFov: 105 });
  nearRoofFollow.world = nearRoof;
  nearRoofFollow.update(1 / 60, new Vector3(), noLook);
  assert.ok(nearRoofFollow.camera.position.y < 1.34, "the same expanded-shell guard protects roof undersides");
});

test("obstructions retract immediately, hold after clearing and recover smoothly with bounded queries", () => {
  const p = new Vector3();
  const follow = new FollowCamera(new PerspectiveCamera(), p);
  let allowed = 4.8;
  let clips = 0;
  follow.world = {
    isSpaceFree: () => true,
    clipCamera(target, desired, out) {
      clips++;
      return out.copy(target).lerp(desired, allowed / 4.8);
    },
  };
  allowed = 1.5;
  follow.update(1 / 60, p, noLook);
  close(follow.camera.position.distanceTo(follow.target), 1.5);
  acquire(follow, p, null, 0.5);
  allowed = 4.8;
  follow.update(1 / 60, p, noLook);
  close(follow.boomDistance, 1.5, 1e-8);
  for (let frame = 0; frame < 5; frame++) follow.update(1 / 60, p, noLook);
  assert.ok(follow.boomDistance > 1.5 && follow.boomDistance < 4.8);
  const partiallyRestored = follow.boomDistance;
  allowed = 1;
  follow.update(1 / 60, p, noLook);
  close(follow.boomDistance, 1);
  assert.ok(follow.boomDistance < partiallyRestored);
  assert.equal(clips, 38, "one clipping query per frame in clear focus space");
});

test("recenter clears presentation motion and unexplained teleport lag while extreme physical travel remains continuous", () => {
  const p = new Vector3();
  const follow = new FollowCamera(new PerspectiveCamera(), p, {
    mode: "dynamic",
    dynamicFov: true,
  });
  const ctx = context({ velocity: new Vector3(0, 0, -30), enemies: [enemy("target", -5, 2, -12)] });
  acquire(follow, p, ctx);
  const yaw = follow.renderYaw;
  const pitch = follow.renderPitch;
  const settings = follow.settings;
  assert.ok(follow.camera.fov > 80);
  follow.boomDistance = 1;
  p.set(800, 200, -600);
  follow.recenter(p);
  close(follow.target.distanceTo(p.clone().add(new Vector3(0, 1.02, 0))), 0);
  close(follow.lag.length(), 0);
  close(follow.yaw, yaw);
  close(follow.pitch, pitch);
  close(follow.boomDistance, 4.8);
  close(follow.director.state.speed, 0);
  close(follow.camera.fov, 52);
  assert.equal(follow.director.state.selectedTargetId, null);
  assert.equal(follow.settings, settings);
  follow.update(1 / 60, p, noLook, context());
  close(follow.renderYaw, yaw);
  const fast = context({ velocity: new Vector3(12000, 0, 0) });
  p.x += 200;
  follow.update(1 / 60, p, noLook, fast);
  assert.ok(follow.target.x < p.x - 100, "real extreme travel retains normal follow lag");
  // Once actual velocity is quiet, a later unexplained relocation recenters.
  follow.update(1 / 60, p, noLook, context());
  p.set(-2000, 0, 500);
  follow.update(1 / 60, p, noLook, context());
  close(follow.target.distanceTo(p.clone().add(new Vector3(0, 1.02, 0))), 0);
  assert.ok([...follow.camera.position, ...follow.camera.quaternion].every(Number.isFinite));
});
