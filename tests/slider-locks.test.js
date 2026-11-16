import test from "node:test";
import assert from "node:assert/strict";
import { SliderGesture } from "../src/ui/SliderLocks.js";

const gesture = (overrides = {}) =>
  new SliderGesture({
    x: 100,
    y: 100,
    value: 50,
    min: 0,
    max: 100,
    step: 1,
    width: 200,
    ...overrides,
  });

test("a slider tap and small thumb drift preserve the existing value", () => {
  const drag = gesture();
  for (const [x, y] of [
    [100, 100],
    [103, 104],
    [107, 106],
  ]) {
    assert.equal(drag.move(x, y), "pending");
    assert.equal(drag.value, 50);
  }
});
test("vertical scroll intent never edits a slider, even when the thumb later drifts sideways", () => {
  const drag = gesture();
  assert.equal(drag.move(103, 118), "vertical");
  assert.equal(drag.move(190, 180), "vertical");
  assert.equal(drag.value, 50);
});
test("deliberate horizontal movement adjusts relative to the starting value and respects steps", () => {
  const drag = gesture({ value: 20, step: 5 });
  assert.equal(drag.move(126, 102), "horizontal");
  assert.equal(drag.value, 35);
  assert.equal(drag.move(50, 140), "horizontal");
  assert.equal(drag.value, 0);
  drag.move(500, 140);
  assert.equal(drag.value, 100);
});
test("diagonal ambiguity does not immediately convert a scroll into an adjustment", () => {
  const drag = gesture();
  assert.equal(drag.move(115, 115), "pending");
  assert.equal(drag.value, 50);
  assert.equal(drag.move(120, 145), "vertical");
  assert.equal(drag.value, 50);
});
test("logarithmic sliders keep their encoded domain and linear sliders retain fractional precision", () => {
  const log = gesture({ value: 0, min: -1, max: 2, step: 0.01, width: 300 });
  log.move(200, 100);
  assert.equal(log.value, 1);
  assert.equal(10 ** log.value, 10);
  const linear = gesture({
    value: 0.85,
    min: 0.75,
    max: 3,
    step: 0.05,
    width: 225,
  });
  linear.move(110, 100);
  assert.equal(linear.value, 0.95);
});
test("independent gestures cannot change one another's values or chosen direction", () => {
  const scrolling = gesture({ value: 30 }),
    adjusting = gesture({ value: 70 });
  scrolling.move(100, 130);
  adjusting.move(120, 100);
  assert.equal(scrolling.value, 30);
  assert.equal(scrolling.axis, "vertical");
  assert.equal(adjusting.value, 80);
  assert.equal(adjusting.axis, "horizontal");
});
test("right-to-left range direction reverses horizontal adjustment without changing scroll handling", () => {
  const drag = gesture({ rtl: true });
  drag.move(120, 101);
  assert.equal(drag.value, 40);
});
