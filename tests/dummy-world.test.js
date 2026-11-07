import test from "node:test";
import assert from "node:assert/strict";
import { Group, Vector3, Box3 } from "three";
import { ArenaBounds } from "../src/world/ArenaBounds.js";
import {
  TrainingDummy,
  TRAINING_DUMMY_CONFIG,
} from "../src/world/TrainingDummy.js";
import { CharacterController } from "./helpers/ControllerFixture.js";

const closeTo = (actual, expected, tolerance = 1e-7) =>
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${actual} should be ${expected}`,
  );
const prop = (x = 0, z = -5, radius = 0.32) => ({
  id: "training-dummy",
  position: new Vector3(x, 0, z),
  radius,
  active: true,
});
const separation = (position, target) =>
  Math.hypot(position.x - target.position.x, position.z - target.position.z);

test("training dummy has one stationary target and a visible base matching its boundary", () => {
  const dummy = new TrainingDummy();
  assert.deepEqual(dummy.root.position.toArray(), [2, 0, -5]);
  assert.equal(dummy.target.position, dummy.root.position);
  assert.equal(dummy.target.id, "training-dummy");
  assert.equal(dummy.target.radius, TRAINING_DUMMY_CONFIG.radius);
  assert.equal(dummy.target.active, true);
  const bounds = new Box3().setFromObject(dummy.root);
  closeTo(bounds.max.y, 1.8);
  closeTo(bounds.min.y, 0);
  closeTo(bounds.max.x, dummy.root.position.x + dummy.target.radius);
  closeTo(bounds.min.x, dummy.root.position.x - dummy.target.radius);
  assert.ok(dummy.root.children.length <= 8, "the target uses few meshes");
  const material = dummy.markerMaterial;
  dummy.setTargeted(true);
  assert.equal(dummy.targeted, true);
  assert.equal(dummy.markerMaterial, material, "selection reuses the material");
  assert.equal(material.color.getHex(), 0xcce9b5);
  dummy.setTargeted(false);
  assert.equal(material.color.getHex(), 0xe4dfc9);
  dummy.dispose();
});

test("empty obstacle adapter preserves the original arena clamp exactly", () => {
  const world = new ArenaBounds(18);
  const out = new Vector3();
  for (const start of [
    [0, 0],
    [17, -17],
    [-8, 13],
    [-18, 18],
  ]) {
    for (const delta of [
      [0, 0],
      [30, 40],
      [-80, -80],
      [1.2345, -3.4567],
    ]) {
      world.move(
        new Vector3(start[0], 9, start[1]),
        new Vector3(delta[0], 4, delta[1]),
        0.36,
        out,
      );
      assert.deepEqual(out.toArray(), [
        Math.max(-17.64, Math.min(17.64, start[0] + delta[0])),
        0,
        Math.max(-17.64, Math.min(17.64, start[1] + delta[1])),
      ]);
    }
  }
});

test("continuous sweep stops a long displacement at the dummy rather than tunnelling", () => {
  const target = prop();
  const world = new ArenaBounds(18, [target]);
  const out = new Vector3();
  world.move(new Vector3(), new Vector3(0, 0, -30), 0.36, out);
  closeTo(out.x, 0);
  closeTo(out.z, -4.32);
  closeTo(separation(out, target), 0.68);
  // The prop is not moved by contact.
  assert.deepEqual(target.position.toArray(), [0, 0, -5]);
});

test("glancing contact slides around the footprint without sticking or crossing it", () => {
  const target = prop();
  const world = new ArenaBounds(18, [target]);
  const position = new Vector3(0.4, 0, -3.5);
  const out = new Vector3();
  for (let step = 0; step < 180; step++) {
    world.move(position, new Vector3(0, 0, -2.6 / 60), 0.36, out);
    assert.ok(separation(out, target) >= 0.68 - 1e-7);
    position.copy(out);
  }
  assert.ok(position.x > 0.67, "contact redirects travel toward the open side");
  assert.ok(position.z < -7, "movement continues past the stationary target");
});

test("outward and tangent movement release an exact dummy contact immediately", () => {
  const target = prop();
  const world = new ArenaBounds(18, [target]);
  const out = new Vector3();
  world.move(new Vector3(0.68, 0, -5), new Vector3(0.2, 0, 0.4), 0.36, out);
  closeTo(out.x, 0.88);
  closeTo(out.z, -4.6);
  world.move(new Vector3(0.68, 0, -5), new Vector3(0, 0, -0.7), 0.36, out);
  closeTo(out.x, 0.68);
  closeTo(out.z, -5.7);
});

test("dummy and arena corner contacts both constrain a large move", () => {
  const target = prop(1.1, 1.1);
  const world = new ArenaBounds(2, [target]);
  const out = new Vector3();
  world.move(new Vector3(), new Vector3(30, 0, 29), 0.36, out);
  assert.ok(Math.abs(out.x) <= 1.64 + 1e-8 && Math.abs(out.z) <= 1.64 + 1e-8);
  assert.ok(separation(out, target) >= 0.68 - 1e-7);
});

test("inactive collision targets are ignored and initial overlap resolves outward", () => {
  const target = prop();
  const world = new ArenaBounds(18, [target]);
  const out = new Vector3();
  target.active = false;
  world.move(new Vector3(), new Vector3(0, 0, -10), 0.36, out);
  assert.equal(out.z, -10);
  target.active = true;
  world.move(new Vector3(0, 0, -5), new Vector3(), 0.36, out);
  closeTo(separation(out, target), 0.68);
  assert.ok(Number.isFinite(out.x) && Number.isFinite(out.z));
});

test("real dash and sprint cannot pass through the dummy across frame rates", () => {
  for (const dt of [1 / 30, 1 / 60, 1 / 120]) {
    const target = prop();
    const root = new Group();
    root.position.set(0, 0, -3.8);
    const movement = new CharacterController(
      root,
      new ArenaBounds(18, [target]),
    );
    const forward = { move: { x: 0, y: 1 }, sprinting: true };
    movement.requestDash();
    for (let frame = 0; frame < 2 / dt; frame++) {
      movement.update(dt, forward, 0);
      assert.ok(
        separation(root.position, target) >= 0.68 - 1e-7,
        `containment at ${1 / dt}Hz`,
      );
      assert.ok(
        root.position.z > target.position.z,
        "cannot pass to the far side",
      );
    }
    closeTo(root.position.z, -4.32);
    assert.equal(movement.dash.active, false);
    assert.equal(movement.dash.exitReason, "blocked");
    movement.update(dt, { move: { x: 0, y: -1 }, sprinting: false }, 0);
    assert.ok(
      root.position.z > -4.32,
      "reversing immediately leaves the boundary",
    );
  }
});

test("off-axis dash preserves side travel while the dummy remains stationary", () => {
  const target = prop();
  const root = new Group();
  root.position.set(0.45, 0, -3.7);
  const movement = new CharacterController(root, new ArenaBounds(18, [target]));
  movement.requestDash();
  for (let frame = 0; frame < 60; frame++) {
    movement.update(1 / 60, { move: { x: 0, y: 1 }, sprinting: false }, 0);
    assert.ok(separation(root.position, target) >= 0.68 - 1e-7);
  }
  assert.ok(root.position.x > 0.67);
  assert.ok(root.position.z < -5);
  assert.deepEqual(target.position.toArray(), [0, 0, -5]);
});

test("glancing sprint retains tangent momentum instead of resetting both axes", () => {
  for (const dt of [1 / 30, 1 / 60, 1 / 120]) {
    const target = prop();
    const root = new Group();
    root.position.set(0.4, 0, -4.4);
    const world = new ArenaBounds(18, [target]);
    const movement = new CharacterController(root, world);
    movement.velocity.set(0, 0, -5.2);
    const forward = { move: { x: 0, y: 1 }, sprinting: true };
    // Each rate reaches the circle within its first two simulation frames.
    let contact = false;
    for (let frame = 0; frame < Math.ceil(2 / dt); frame++) {
      movement.update(dt, forward, 0);
      assert.ok(separation(root.position, target) >= 0.68 - 1e-7);
      if (!contact && world.hasObstacleContact) {
        contact = true;
        assert.ok(
          movement.velocity.x > 1,
          "the contact keeps outward tangent velocity",
        );
        assert.ok(
          movement.velocity.z < -1,
          "forward tangent velocity is not zeroed",
        );
        assert.ok(
          movement.velocity.length() > 2.5,
          "collision preserves responsive side motion",
        );
      }
    }
    assert.equal(contact, true);
    assert.ok(
      root.position.z < -10,
      "sprinting continues past the dummy without crawling",
    );
    assert.ok(movement.speed > 5.19);
  }
});

test("collision velocity feedback is cleared between moves and keeps old wall handling", () => {
  const target = prop();
  const world = new ArenaBounds(18, [target]);
  const out = new Vector3();
  world.move(new Vector3(0.4, 0, -4.4), new Vector3(0, 0, -0.2), 0.36, out);
  assert.equal(world.hasObstacleContact, true);
  const velocity = new Vector3(0, 0, -5.2);
  assert.equal(world.resolveVelocity(velocity), true);
  assert.ok(velocity.x > 1 && velocity.z < -1);
  world.move(new Vector3(10, 0, 0), new Vector3(20, 0, 2), 0.36, out);
  assert.equal(
    world.hasObstacleContact,
    false,
    "a previous prop contact cannot affect this wall move",
  );
  const untouched = new Vector3(3, 0, 2);
  assert.equal(world.resolveVelocity(untouched), false);
  assert.deepEqual(untouched.toArray(), [3, 0, 2]);
  closeTo(out.x, 17.64);
  closeTo(out.z, 2);
});
