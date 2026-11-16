import test from "node:test";
import assert from "node:assert/strict";
import { Vector3 } from "three";
import { TagContactDetector } from "../src/combat/TagContactDetector.js";
import { TraversalWorld } from "../src/world/TraversalWorld.js";
import { box, pole } from "../src/world/TraversalGeometry.js";
const v = (x = 0, y = 0, z = 0) => new Vector3(x, y, z);
const detector = (...structures) =>
  new TagContactDetector(new TraversalWorld(1000, [], structures));
const close = (actual, expected, tolerance = 1e-8) =>
  assert.ok(
    actual !== null && Math.abs(actual - expected) < tolerance,
    `${actual} should be near ${expected}`,
  );

test("tag contact recognizes stationary overlap and only uses true 3D configurable range", () => {
  const d = detector();
  assert.equal(d.contact(v(), v(), v(0.8), v(0.8), 0.85), 0);
  assert.equal(d.contact(v(), v(), v(0.86), v(0.86), 0.85), null);
  assert.equal(d.contact(v(), v(), v(0, 0.86), v(0, 0.86), 0.85), null);
  assert.equal(d.contact(v(), v(), v(0, 0.8), v(0, 0.8), 0.85), 0);
  assert.equal(d.contact(v(), v(), v(), v(), 0), 0);
});

test("tag sweep catches extremely fast crossings, opposite travel and tangency without enlarging reach", () => {
  const d = detector();
  close(d.contact(v(-500), v(500), v(), v(), 0.85), 0.49915);
  close(d.contact(v(-500), v(500), v(500), v(-500), 0.85), 0.499575);
  close(d.contact(v(-10, 0, 0.85), v(10, 0, 0.85), v(), v(), 0.85), 0.5);
  assert.equal(
    d.contact(v(-500), v(500), v(0, 0, 0.8501), v(0, 0, 0.8501), 0.85),
    null,
  );
  close(d.contact(v(0, 100), v(0, -100), v(), v(), 0.85), 0.49575);
});

test("swept trails crossing at different times are not a contact", () => {
  const d = detector();
  assert.equal(d.contact(v(-4), v(4), v(0, 0, -8), v(), 0.85), null);
  assert.equal(d.contact(v(-10), v(10), v(-8), v(12), 0.85), null);
  close(d.contact(v(), v(-1), v(0.8), v(1.8), 0.85), 0);
});

test("tags do not pass through boxes, thin walls, poles or separating rooftop slabs", () => {
  for (const structure of [
    box("wall", 0, 0, 0.1, 4, 8),
    pole("column", 0, 0, 0.1, 4),
  ]) {
    const d = detector(structure);
    assert.equal(d.contact(v(-0.4), v(-0.4), v(0.4), v(0.4), 0.85), null);
  }
  const roof = detector(box("roof", 0, 0, 4, 0.15, 4, false, 1));
  assert.equal(roof.contact(v(), v(), v(0, 0.4), v(0, 0.4), 0.85), null);
  const lowBarrier = detector(box("low", 0, 0, 0.1, 0.5, 8));
  assert.equal(lowBarrier.contact(v(-0.4), v(-0.4), v(0.4), v(0.4), 0.85), 0);
});

test("occlusion is tested at synchronized contact positions instead of unrelated path endpoints", () => {
  const d = detector(box("thin wall", 0, 0, 0.1, 4, 2));
  // Both actors clear the end of the wall during a common contact interval.
  const t = d.contact(v(-0.4), v(-0.4, 0, 2), v(0.4), v(0.4, 0, 2), 0.85);
  assert.ok(t >= 0.5 && t <= 1, `corner should clear at common time, got ${t}`);
  // A crossing with both ends clear is blocked at its only closest approach.
  assert.equal(
    d.contact(v(-0.4, 0, -5), v(-0.4, 0, 5), v(0.4, 0, 5), v(0.4, 0, -5), 0.85),
    null,
  );
});

test("tag queries preserve the collision-resolved body positions and collision response state", () => {
  const w = new TraversalWorld(1000, [], [box("wall", 0, 0, 0.1, 4, 8)]),
    d = new TagContactDetector(w),
    p = v(-0.4),
    e = v(0.4);
  w.contactCount = 2;
  w.contactNormals[0] = 0.75;
  w.hasObstacleContact = true;
  const beforeP = p.clone(),
    beforeE = e.clone(),
    normals = w.contactNormals.slice();
  assert.equal(d.contact(p, p, e, e, 0.85), null);
  assert.deepEqual(p, beforeP);
  assert.deepEqual(e, beforeE);
  assert.deepEqual(w.contactNormals, normals);
  assert.equal(w.contactCount, 2);
  assert.equal(w.hasObstacleContact, true);
});

test("tag contact rejects invalid states and stays finite for extreme travel with a bounded query budget", () => {
  let queries = 0;
  const d = new TagContactDetector({
    firstBlock() {
      queries++;
      return {};
    },
  });
  assert.equal(d.contact(v(), v(Infinity), v(), v(), 0.85), null);
  assert.equal(d.contact(v(), v(), v(), v(), NaN), null);
  assert.equal(d.contact(v(), v(), v(), v(), -1), null);
  assert.equal(d.contact(v(-1e200), v(1e200), v(), v(), 0.85), null);
  assert.ok(queries <= 5);
  const open = detector();
  close(open.contact(v(-1e200), v(1e200), v(), v(), 0.85), 0.5);
  for (const rate of [30, 60, 144]) {
    // Same physical crossing, different per-step partitions.
    let detected = false;
    for (let i = 0; i < rate; i++) {
      const a = -100 + (i * 200) / rate,
        b = -100 + ((i + 1) * 200) / rate;
      detected ||= open.contact(v(a), v(b), v(), v(), 0.85) !== null;
    }
    assert.ok(detected);
  }
});
