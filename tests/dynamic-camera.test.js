import test from "node:test";
import assert from "node:assert/strict";
import { Vector3 } from "three";
import { DynamicCameraDirector } from "../src/camera/DynamicCameraDirector.js";

const ORIGIN = new Vector3();
const DEG = Math.PI / 180;
const enemy = (id, x, z, y = 0) => ({
  spawned: true,
  body: { id, active: true },
  root: { position: new Vector3(x, y, z) },
  controller: { velocity: new Vector3() },
  combat: { attack: { active: false } },
});
const context = (enemies = [], velocity = new Vector3()) => ({
  enemies,
  velocity,
  gameplayMode: "combat",
  manualActive: false,
  recentTargetId: null,
  recentEngagementRemaining: 0,
});

function advance(director, seconds, scene, { yaw = 0, pitch = 0.23, hz = 60 } = {}) {
  let remaining = seconds;
  while (remaining > 1e-10) {
    const dt = Math.min(1 / hz, remaining);
    director.update(dt, ORIGIN, yaw, pitch, scene);
    remaining -= dt;
  }
  return director.state;
}

test("manual defaults preserve the base lens and never acquire enemies", () => {
  let queries = 0;
  const director = new DynamicCameraDirector();
  const scene = context([enemy("front", 1, -4)], new Vector3(0, 0, -40));
  scene.world = { firstBlock: () => queries++ };
  const state = advance(director, 3, scene);
  assert.equal(state, director.update(1 / 60, ORIGIN, 0, 0.23, scene));
  assert.equal(state.fov, 52);
  assert.equal(state.selectedTargetId, null);
  assert.equal(state.yawOffset, 0);
  assert.equal(state.pitchOffset, 0);
  assert.equal(state.focusOffset, 0);
  assert.equal(queries, 0);
});

test("dynamic FOV is independent of camera mode and follows real 3D velocity", () => {
  const director = new DynamicCameraDirector({ dynamicFov: true });
  const scene = context();
  scene.move = { x: 1, y: 1 };
  scene.movementMagnitude = 1;
  advance(director, 3, scene);
  assert.equal(director.state.fov, 52, "stationary movement input is not speed");
  scene.velocity.set(0, 0, -1.8);
  advance(director, 3, scene);
  assert.equal(director.state.fov, 52, "walking does not pump the lens");
  scene.velocity.set(0, 0, -5.2);
  advance(director, 4, scene);
  const sprintFov = director.state.fov;
  assert.ok(sprintFov > 56 && sprintFov < 63, `sprint FOV ${sprintFov}`);
  scene.velocity.set(0, 25, 0);
  advance(director, 4, scene);
  assert.ok(director.state.fov > 100, "vertical traversal contributes real speed");
  assert.equal(director.state.selectedTargetId, null);
  assert.equal(director.state.yawOffset, 0);
});

test("FOV clamps settings, responds to sensitivity and recovers smoothly", () => {
  const director = new DynamicCameraDirector({
    dynamicFov: true,
    baseFov: 70,
    maxFov: 500,
    sensitivity: 4,
    smoothness: 0.2,
  });
  const scene = context([], new Vector3(1e300, 1e300, -1e300));
  advance(director, 4, scene);
  assert.ok(director.state.fov <= 120);
  assert.ok(director.state.fov > 119);
  scene.velocity.set(0, 0, 0);
  const before = director.state.fov;
  director.update(1 / 60, ORIGIN, 0, 0.23, scene);
  assert.ok(director.state.fov > 110, "stopping never snaps directly to base");
  assert.ok(director.state.fov <= before + 1e-6);
  advance(director, 5, scene);
  assert.ok(Math.abs(director.state.fov - 70) < 0.001);
  director.configure({ dynamicFov: false });
  assert.equal(director.state.fov, 70);
});

test("FOV response and recovery agree across frame rates and uneven frames", () => {
  const profile = (steps) => {
    const director = new DynamicCameraDirector({ dynamicFov: true });
    const scene = context();
    const checkpoints = [];
    let frame = 0;
    for (const [seconds, speed] of [[0.4, 24], [0.7, 24], [0.6, 0], [1.5, 0]]) {
      scene.velocity.set(0, 0, -speed);
      let remaining = seconds;
      while (remaining > 1e-10) {
        const dt = Math.min(steps[frame++ % steps.length], remaining);
        director.update(dt, ORIGIN, 0, 0.23, scene);
        remaining -= dt;
      }
      checkpoints.push(director.state.fov);
    }
    return checkpoints;
  };
  const reference = profile([1 / 144]);
  for (const steps of [[1 / 30], [1 / 60], [1 / 24, 1 / 120, 1 / 55, 1 / 80]]) {
    const actual = profile(steps);
    actual.forEach((value, i) => {
      assert.ok(Math.abs(value - reference[i]) < 0.2, `${value} vs ${reference[i]}`);
    });
  }
});

test("awareness affects target reach without affecting the FOV response", () => {
  const near = new DynamicCameraDirector({
    mode: "dynamic", dynamicFov: true, awareness: 5,
  });
  const far = new DynamicCameraDirector({
    mode: "dynamic", dynamicFov: true, awareness: 2000,
  });
  const scene = context([enemy("distant", 0, -120)], new Vector3(0, 0, -12));
  advance(near, 2, scene);
  advance(far, 2, scene);
  assert.equal(near.state.selectedTargetId, null);
  assert.equal(far.state.selectedTargetId, "distant");
  assert.equal(near.state.fov, far.state.fov);
});

test("switching to manual clears assistance while retaining optional speed FOV", () => {
  let queries = 0;
  const director = new DynamicCameraDirector({ mode: "dynamic", dynamicFov: true });
  const scene = context([enemy("target", 5, -10)], new Vector3(0, 0, -22));
  scene.world = { firstBlock: () => { queries++; return null; } };
  advance(director, 2, scene);
  assert.equal(director.state.selectedTargetId, "target");
  assert.ok(Math.abs(director.state.yawOffset) > 0.05);
  director.configure({ mode: "manual" });
  assert.equal(director.state.selectedTargetId, null);
  assert.equal(director.state.yawOffset, 0);
  queries = 0;
  advance(director, 1, scene);
  assert.equal(queries, 0);
  assert.ok(director.state.fov > 100);
});

test("selection favors the current forward view over the nearest enemy", () => {
  const director = new DynamicCameraDirector({ mode: "dynamic" });
  const scene = context([
    enemy("nearest-side", 4, -1),
    enemy("frontal", 0, -22),
    enemy("behind", 0, 2),
  ]);
  advance(director, 1, scene);
  assert.equal(director.state.selectedTargetId, "frontal");
  assert.ok(Math.abs(director.state.yawOffset) < 1e-8);
  scene.enemies[1].root.position.set(0, 0, 22);
  scene.enemies[0].root.position.set(9, 0, -1);
  director.configure({ mode: "assisted" });
  advance(director, 1, scene);
  assert.equal(director.state.selectedTargetId, null, "assisted cone is narrower");
});

test("actual approach, recent engagement and combat threats inform ranking", () => {
  const left = enemy("left", -5, -12);
  const right = enemy("right", 5, -12);
  const scene = context([left, right], new Vector3(5, 0, -12));
  const director = new DynamicCameraDirector({ mode: "dynamic" });
  advance(director, 0.1, scene);
  assert.equal(director.state.selectedTargetId, "right");
  director.resetMotion();
  scene.velocity.set(0, 0, 0);
  scene.recentTargetId = "left";
  scene.recentEngagementRemaining = 1;
  advance(director, 0.1, scene);
  assert.equal(director.state.selectedTargetId, "left");
  director.resetMotion();
  scene.recentEngagementRemaining = 0;
  right.combat.attack.active = true;
  advance(director, 0.1, scene);
  assert.equal(director.state.selectedTargetId, "right");
  director.resetMotion();
  scene.gameplayMode = "tag";
  advance(director, 0.1, scene);
  assert.equal(director.state.selectedTargetId, "left", "tag has no attack priority");
});

test("selection holds its target and requires a meaningful challenger", () => {
  const original = enemy("original", 6, -14);
  const better = enemy("challenger", 0, -5);
  better.combat.attack.active = true;
  const scene = context([original]);
  const director = new DynamicCameraDirector({ mode: "dynamic" });
  advance(director, 0.1, scene);
  scene.enemies.push(better);
  advance(director, 0.3, scene);
  assert.equal(director.state.selectedTargetId, "original");
  advance(director, 0.4, scene);
  assert.equal(director.state.selectedTargetId, "challenger");
  original.root.position.copy(better.root.position).add(new Vector3(0.01, 0, 0));
  original.combat.attack.active = true;
  advance(director, 1.5, scene);
  assert.equal(director.state.selectedTargetId, "challenger", "small ties do not chatter");
});

test("occluded, defeated, despawned or rearward targets leave selection", () => {
  const target = enemy("target", 2, -10);
  const scene = context([target]);
  let blocked = false;
  scene.world = { firstBlock: () => blocked ? { t: 0.3 } : null };
  const director = new DynamicCameraDirector({ mode: "dynamic" });
  advance(director, 0.2, scene);
  assert.equal(director.state.selectedTargetId, "target");
  blocked = true;
  advance(director, 0.15, scene);
  assert.equal(director.state.selectedTargetId, null);
  blocked = false;
  advance(director, 0.15, scene);
  assert.equal(director.state.selectedTargetId, "target");
  target.body.active = false;
  director.update(1 / 60, ORIGIN, 0, 0.23, scene);
  assert.equal(director.state.selectedTargetId, null);
  target.body.active = true;
  advance(director, 0.15, scene);
  target.spawned = false;
  director.update(1 / 60, ORIGIN, 0, 0.23, scene);
  assert.equal(director.state.selectedTargetId, null);
  target.spawned = true;
  advance(director, 0.15, scene);
  target.root.position.z = 10;
  director.update(1 / 60, ORIGIN, 0, 0.23, scene);
  assert.equal(director.state.selectedTargetId, null);
});

test("manual capture wins while held, delays on release and eases back", () => {
  const director = new DynamicCameraDirector({ mode: "dynamic" });
  const scene = context([enemy("target", 7, -10)]);
  advance(director, 2, scene);
  const originalOffset = Math.abs(director.state.yawOffset);
  assert.ok(originalOffset > 0.08);
  scene.manualActive = true;
  director.update(1 / 60, ORIGIN, 0, 0.23, scene);
  assert.equal(director.state.yawOffset, 0);
  assert.equal(director.state.selectedTargetId, null);
  advance(director, 3, scene);
  assert.equal(director.state.overrideRemaining, 1.25, "held stationary is still manual");
  scene.manualActive = false;
  advance(director, 1, scene);
  assert.ok(director.state.overrideRemaining > 0.24);
  assert.equal(director.state.yawOffset, 0);
  advance(director, 0.35, scene);
  assert.equal(director.state.overrideRemaining, 0);
  assert.ok(Math.abs(director.state.yawOffset) < originalOffset * 0.25);
  advance(director, 2, scene);
  assert.ok(Math.abs(director.state.yawOffset) > originalOffset * 0.95);
});

test("looking away establishes a new view without reacquiring behind the anchor", () => {
  const director = new DynamicCameraDirector({ mode: "dynamic", overrideDelay: 0.1 });
  const scene = context([enemy("old-target", 6, -10)]);
  advance(director, 2, scene);
  director.update(1 / 60, ORIGIN, Math.PI, 0.23, scene, true);
  advance(director, 3, scene, { yaw: Math.PI });
  assert.equal(director.state.selectedTargetId, null);
  assert.equal(director.state.yawOffset, 0);
  assert.equal(director.state.assistWeight, 0);
});

test("assistance stays bounded, frames height gently and respects strength", () => {
  for (const [mode, yawLimit, pitchLimit] of [["assisted", 12, 6], ["dynamic", 30, 12]]) {
    const director = new DynamicCameraDirector({ mode, strength: 0.6 });
    const scene = context([enemy("high", 18, -10, 35)]);
    advance(director, 4, scene);
    assert.equal(director.state.selectedTargetId, "high");
    assert.ok(Math.abs(director.state.yawOffset) <= yawLimit * DEG * 0.6);
    assert.ok(Math.abs(director.state.pitchOffset) <= pitchLimit * DEG * 0.6);
    assert.ok(director.state.focusOffset > 0 && director.state.focusOffset <= 0.5);
    director.configure({ strength: 0 });
    assert.equal(director.state.yawOffset, 0);
    assert.equal(director.state.focusOffset, 0);
    advance(director, 1, scene);
    assert.equal(director.state.selectedTargetId, null);
  }
});

test("target scans and visibility queries have bounded work", () => {
  let reads = 0;
  let queries = 0;
  const enemies = Array.from({ length: 200 }, (_, index) => {
    const candidate = enemy(`enemy-${index}`, index % 3, -10 - index);
    Object.defineProperty(candidate, "spawned", { get() { reads++; return true; } });
    return candidate;
  });
  const scene = context(enemies);
  scene.world = { firstBlock: () => { queries++; return null; } };
  const director = new DynamicCameraDirector({ mode: "dynamic", awareness: 2000 });
  director.update(1 / 60, ORIGIN, 0, 0.23, scene);
  assert.ok(reads <= 64);
  assert.ok(queries <= 3);
  reads = queries = 0;
  director.update(1 / 60, ORIGIN, 0, 0.23, scene);
  assert.equal(queries, 0, "no per-frame raycasts");
  assert.ok(reads <= 1, "only validates the retained target between scans");
  reads = queries = 0;
  director.update(1, ORIGIN, 0, 0.23, scene);
  assert.ok(reads <= 66);
  assert.ok(queries <= 4, "one selected target and three challengers");
});

test("resetMotion retains preferences and inputs remain read-only", () => {
  const director = new DynamicCameraDirector({ mode: "dynamic", dynamicFov: true });
  const target = enemy("target", 5, -10, 3);
  const scene = context([target], new Vector3(3, 4, -20));
  scene.cameraPosition = new Vector3(0, 2, 5);
  const position = new Vector3(1, 2, 3);
  const before = JSON.stringify({ position, scene });
  for (let i = 0; i < 120; i++) director.update(1 / 60, position, 0, 0.23, scene);
  assert.equal(JSON.stringify({ position, scene }), before);
  assert.ok(director.state.fov > 90);
  director.suspend();
  director.resetMotion();
  assert.equal(director.settings.mode, "dynamic");
  assert.equal(director.settings.dynamicFov, true);
  assert.equal(director.state.fov, 52);
  assert.equal(director.state.speed, 0);
  assert.equal(director.state.overrideRemaining, 0);
  assert.equal(director.state.selectedTargetId, null);
  assert.equal(director.state.yawOffset, 0);
});

test("malformed and extreme presentation inputs remain finite", () => {
  const director = new DynamicCameraDirector({
    mode: "dynamic", dynamicFov: true, awareness: 2000,
  });
  const scene = context([
    enemy("invalid", Infinity, -2),
    enemy("extreme", 1e308, -1e308),
    enemy("valid", 1, -4),
  ], new Vector3(1e308, -1e308, 1e308));
  for (const dt of [0, -1, NaN, Infinity, 1 / 60, 1e308]) {
    const state = director.update(dt, ORIGIN, 1e308, -1e308, scene);
    for (const [key, value] of Object.entries(state)) {
      if (key !== "selectedTargetId") assert.ok(Number.isFinite(value), `${key}: ${value}`);
    }
    assert.ok(state.fov >= 52 && state.fov <= 105);
    assert.ok(Math.abs(state.yawOffset) <= 30 * DEG * director.settings.strength);
    assert.ok(Math.abs(state.pitchOffset) <= 12 * DEG * director.settings.strength);
  }
  scene.velocity.set(NaN, Infinity, 0);
  director.update(0.1, new Vector3(Infinity, 0, 0), NaN, Infinity, scene);
  assert.equal(director.state.selectedTargetId, null);
  assert.equal(director.state.yawOffset, 0);
  assert.ok(Number.isFinite(director.state.fov));
});
