import test from "node:test";
import assert from "node:assert/strict";
import { stick } from "./acrobatic-browser.mjs";

function fixture() {
  const calls = [];
  const page = {
    locator: (selector) => ({
      boundingBox: async () =>
        selector === "#joystick"
          ? { x: 40, y: 200, width: 120, height: 120 }
          : { x: 700, y: 240, width: 60, height: 60 },
    }),
  };
  const native = async (type, points, changed = points) =>
    calls.push({
      type,
      points: points.map((p) => ({ ...p })),
      changed: changed.map((p) => ({ ...p })),
    });
  return { page, native, calls };
}

test("browser gestures can start movement after holding an action without replacing its touch contact", async () => {
  const f = fixture(),
    controls = await stick(f.page, f.native);
  await controls.enter("kick");
  await controls.move(0.6, -0.2);
  assert.equal(
    f.calls[1].type,
    "touchStart",
    "A new joystick contact requires pointerdown, even while Kick is held",
  );
  assert.deepEqual(
    f.calls[1].points.map((p) => p.id),
    [1, 2],
  );
  assert.deepEqual(
    f.calls[1].changed.map((p) => p.id),
    [1],
  );
  assert.deepEqual(
    f.calls[1].points[1],
    f.calls[0].points[0],
    "The held action keeps its exact contact",
  );
  await controls.move(0.4, 0.1);
  assert.equal(f.calls[2].type, "touchMove");
  assert.deepEqual(
    f.calls[2].points.map((p) => p.id),
    [1, 2],
  );
  await controls.releaseAction();
  assert.deepEqual(
    f.calls[3].points.map((p) => p.id),
    [2],
  );
  await controls.stop();
  assert.equal(f.calls[4].type, "touchCancel");
  assert.deepEqual(
    f.calls[4].changed.map((p) => p.id),
    [1],
  );
});

test("browser gestures preserve joystick-first multitouch and action-only taps", async () => {
  const f = fixture(),
    controls = await stick(f.page, f.native);
  await controls.move(0, 1);
  await controls.tap("punch");
  assert.deepEqual(
    f.calls.map((c) => c.type),
    ["touchStart", "touchStart", "touchEnd"],
  );
  assert.deepEqual(
    f.calls[1].points.map((p) => p.id),
    [1, 2],
  );
  assert.deepEqual(
    f.calls[1].changed.map((p) => p.id),
    [2],
  );
  await controls.move(1, 0);
  assert.deepEqual(
    f.calls[3].points.map((p) => p.id),
    [1],
  );
  await controls.stop();
  const tap = fixture(),
    taps = await stick(tap.page, tap.native);
  await taps.tap("kick");
  assert.deepEqual(
    tap.calls.map((c) => c.type),
    ["touchStart", "touchEnd"],
  );
  assert.deepEqual(
    tap.calls[0].points.map((p) => p.id),
    [2],
  );
});
