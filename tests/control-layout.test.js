import test from "node:test";
import assert from "node:assert/strict";
import {
  CONTROL_IDS,
  STORAGE_KEY,
  LAYOUT_GAP,
  LAYOUT_MARGIN,
  validateLayout,
  loadLayout,
  saveLayout,
  clearLayout,
  normalizeCenters,
  constrainPosition,
  resolveLayout,
} from "../src/ui/controlLayoutModel.js";

const bounds = { left: 0, top: 0, right: 844, bottom: 390 };
const defaultRects = {
  move: { left: 44, top: 224, width: 112, height: 112 },
  sprint: { left: 708, top: 240, width: 96, height: 96 },
  dash: { left: 630, top: 176, width: 64, height: 64 },
  block: { left: 630, top: 256, width: 64, height: 64 },
  jump: { left: 552, top: 256, width: 64, height: 64 },
};
const uiRects = [
  { left: 20, top: 16, width: 804, height: 48 },
  { left: 28, top: 88, width: 260, height: 72 },
  { left: 728, top: 90, width: 84, height: 84 },
  { left: 340, top: 300, width: 164, height: 40 },
];
const positions = () => normalizeCenters(defaultRects, bounds);
const layout = () => ({ version: 1, positions: positions() });
const storage = () => {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
};
const near = (actual, expected) =>
  assert.ok(Math.abs(actual - expected) < 1e-7, `${actual} ~= ${expected}`);
const overlap = (a, b) =>
  a.left < b.left + b.width + LAYOUT_GAP - 1e-7 &&
  a.left + a.width > b.left - LAYOUT_GAP + 1e-7 &&
  a.top < b.top + b.height + LAYOUT_GAP - 1e-7 &&
  a.top + a.height > b.top - LAYOUT_GAP + 1e-7;
const assertLegal = (rects, viewport, exclusions = []) => {
  assert.ok(rects, "all controls fit");
  for (let index = 0; index < CONTROL_IDS.length; index++) {
    const rect = rects[CONTROL_IDS[index]];
    assert.ok(rect.left >= viewport.left + LAYOUT_MARGIN - 1e-7);
    assert.ok(rect.top >= viewport.top + LAYOUT_MARGIN - 1e-7);
    assert.ok(rect.left + rect.width <= viewport.right - LAYOUT_MARGIN + 1e-7);
    assert.ok(rect.top + rect.height <= viewport.bottom - LAYOUT_MARGIN + 1e-7);
    for (const exclusion of exclusions)
      assert.equal(overlap(rect, exclusion), false);
    for (const id of CONTROL_IDS.slice(index + 1))
      assert.equal(overlap(rect, rects[id]), false);
  }
};

test("saved layout validation clones only known normalized control positions", () => {
  const source = { ...layout(), future: true };
  source.positions.extra = { x: 0, y: 0 };
  const validated = validateLayout(source);
  assert.deepEqual(Object.keys(validated), ["version", "positions"]);
  assert.deepEqual(Object.keys(validated.positions), CONTROL_IDS);
  assert.notEqual(validated.positions.move, source.positions.move);
  source.positions.move.x = 0.9;
  assert.notEqual(validated.positions.move.x, 0.9);
});

test("retired Sprint migrates without moving or resetting any remaining saved control", () => {
  const store = storage(),
    legacy = layout();
  legacy.positions.sprint = { x: 0.91, y: 0.73 };
  store.setItem(STORAGE_KEY, JSON.stringify(legacy));
  const migrated = loadLayout(store);
  assert.deepEqual(migrated, layout());
  assert.equal(
    Object.hasOwn(JSON.parse(store.getItem(STORAGE_KEY)).positions, "sprint"),
    false,
  );
  assert.deepEqual(Object.keys(migrated.positions), [
    "move",
    "dash",
    "block",
    "jump",
  ]);
});

test("a malformed removed Sprint entry or failed migration write never discards valid remaining positions", () => {
  const legacy = layout();
  legacy.positions.sprint = null;
  const migrated = loadLayout({
    getItem: () => JSON.stringify(legacy),
    setItem: () => {
      throw Error("read only");
    },
  });
  assert.deepEqual(migrated, layout());
});

test("malformed, partial, nonfinite, out-of-range and outdated layouts fall back safely", () => {
  const invalid = [
    null,
    [],
    {},
    { version: 0, positions: positions() },
    { version: 2, positions: positions() },
    { version: "1", positions: positions() },
    { version: 1, positions: [] },
  ];
  for (const value of [
    NaN,
    Infinity,
    -Infinity,
    -0.01,
    1.01,
    "0.5",
    null,
    undefined,
  ]) {
    const candidate = layout();
    candidate.positions.jump.x = value;
    invalid.push(candidate);
  }
  const partial = layout();
  delete partial.positions.move;
  invalid.push(partial);
  invalid.push({ version: 1, positions: Object.create(positions()) });
  for (const value of invalid) assert.equal(validateLayout(value), null);
});

test("storage saves, reloads and clears a complete versioned layout", () => {
  const local = storage();
  assert.equal(loadLayout(local), null);
  assert.equal(saveLayout(local, layout()), true);
  assert.deepEqual(loadLayout(local), layout());
  const stored = JSON.parse(local.getItem(STORAGE_KEY));
  assert.equal(stored.version, 1);
  assert.equal(typeof stored.positions.move.x, "number");
  assert.ok(
    stored.positions.move.x < 1,
    "positions are fractions rather than pixels",
  );
  assert.equal(clearLayout(local), true);
  assert.equal(loadLayout(local), null);
});

test("invalid or corrupt storage never becomes a partial working layout", () => {
  const local = storage();
  for (const raw of [
    "{broken",
    "null",
    "[]",
    JSON.stringify({ version: 99, positions: positions() }),
    JSON.stringify({ version: 1, positions: { move: { x: 0.1, y: 0.1 } } }),
  ]) {
    local.setItem(STORAGE_KEY, raw);
    assert.equal(loadLayout(local), null);
  }
  assert.equal(saveLayout(local, { version: 1, positions: {} }), false);
});

test("browser storage security, quota and missing-method failures are contained", () => {
  const unavailable = {
    getItem() {
      throw new Error("SecurityError");
    },
    setItem() {
      throw new Error("QuotaExceededError");
    },
    removeItem() {
      throw new Error("SecurityError");
    },
  };
  assert.equal(loadLayout(unavailable), null);
  assert.equal(saveLayout(unavailable, layout()), false);
  assert.equal(clearLayout(unavailable), false);
  assert.equal(loadLayout({}), null);
  assert.equal(saveLayout({}, layout()), false);
  assert.equal(clearLayout({}), false);
  const before = layout();
  const copy = structuredClone(before);
  saveLayout(unavailable, before);
  assert.deepEqual(
    before,
    copy,
    "a failed persistence attempt cannot mutate the session layout",
  );
});

test("normalized centres round-trip in an offset playable viewport", () => {
  const viewport = { left: 100, top: 50, right: 944, bottom: 440 };
  const rects = Object.fromEntries(
    CONTROL_IDS.map((id) => [
      id,
      {
        ...defaultRects[id],
        left: defaultRects[id].left + 100,
        top: defaultRects[id].top + 50,
      },
    ]),
  );
  const normalized = normalizeCenters(rects, viewport);
  assert.deepEqual(normalized, positions());
  const resolved = resolveLayout(normalized, rects, viewport);
  for (const id of CONTROL_IDS) {
    near(resolved[id].left, rects[id].left);
    near(resolved[id].top, rects[id].top);
  }
  assert.equal(normalizeCenters({}, viewport), null);
  assert.equal(
    normalizeCenters(rects, { ...viewport, right: viewport.left }),
    null,
  );
});

test("dragging clamps the entire control inside visible bounds", () => {
  const viewport = { left: 20, top: 30, right: 420, bottom: 330 };
  const size = { width: 80, height: 60 };
  assert.deepEqual(constrainPosition({ x: -100, y: -100 }, size, viewport), {
    x: 68,
    y: 68,
  });
  assert.deepEqual(constrainPosition({ x: 2000, y: 2000 }, size, viewport), {
    x: 372,
    y: 292,
  });
});

test("dragging chooses the nearest legal location outside essential UI", () => {
  const viewport = { left: 0, top: 0, right: 400, bottom: 300 };
  const size = { width: 60, height: 60 };
  const header = { left: 0, top: 0, width: 400, height: 70 };
  const center = constrainPosition({ x: 200, y: 80 }, size, viewport, [header]);
  assert.deepEqual(center, { x: 200, y: 108 });
  assert.equal(
    overlap({ left: center.x - 30, top: center.y - 30, ...size }, header),
    false,
  );
});

test("dragging avoids other controls without changing their positions", () => {
  const occupied = [{ left: 170, top: 120, width: 60, height: 60 }];
  const before = structuredClone(occupied);
  const center = constrainPosition(
    { x: 200, y: 150 },
    { width: 60, height: 60 },
    { left: 0, top: 0, right: 400, bottom: 300 },
    [],
    occupied,
  );
  assert.deepEqual(center, { x: 200, y: 82 });
  assert.deepEqual(occupied, before);
});

test("hidden zero-sized exclusions are ignored and fully blocked layouts return null", () => {
  const viewport = { left: 0, top: 0, right: 300, bottom: 300 };
  const point = { x: 100, y: 100 };
  const size = { width: 60, height: 60 };
  assert.deepEqual(
    constrainPosition(point, size, viewport, [
      { left: 100, top: 100, width: 0, height: 0 },
    ]),
    point,
  );
  assert.equal(
    constrainPosition(point, size, viewport, [
      { left: 0, top: 0, width: 300, height: 300 },
    ]),
    null,
  );
  assert.equal(
    constrainPosition(point, { width: 400, height: 30 }, viewport),
    null,
  );
  assert.equal(constrainPosition({ x: NaN, y: 100 }, size, viewport), null);
});

test("a legal default-sized layout is projected exactly without moving controls", () => {
  const resolved = resolveLayout(positions(), defaultRects, bounds, uiRects);
  assertLegal(resolved, bounds, uiRects);
  for (const id of CONTROL_IDS) {
    near(resolved[id].left, defaultRects[id].left);
    near(resolved[id].top, defaultRects[id].top);
  }
});

test("saved anchors adapt to small portrait and landscape sizes without overlaps", () => {
  const anchors = positions();
  const snapshot = structuredClone(anchors);
  for (const [width, height] of [
    [740, 360],
    [390, 844],
    [360, 640],
    [320, 568],
  ]) {
    const viewport = { left: 0, top: 0, right: width, bottom: height };
    const portrait = height > width;
    const sizes = {
      move: { width: 112, height: 112 },
      sprint: { width: 96, height: 96 },
      ...Object.fromEntries(
        ["dash", "block", "jump"].map((id) => [
          id,
          { width: portrait ? 90 : 64, height: portrait ? 48 : 64 },
        ]),
      ),
    };
    const exclusions = portrait
      ? [
          { left: 16, top: 16, width: width - 32, height: 48 },
          { left: 20, top: 88, width: width - 40, height: 100 },
          { left: width - 104, top: 205, width: 84, height: 32 },
          { left: (width - 166) / 2, top: height - 70, width: 166, height: 40 },
        ]
      : [
          { left: 20, top: 16, width: width - 40, height: 48 },
          { left: 28, top: 88, width: 230, height: 72 },
          { left: width - 116, top: 90, width: 84, height: 84 },
          { left: (width - 164) / 2, top: height - 90, width: 164, height: 40 },
        ];
    assertLegal(
      resolveLayout(anchors, sizes, viewport, exclusions),
      viewport,
      exclusions,
    );
  }
  assert.deepEqual(
    anchors,
    snapshot,
    "orientation changes do not accumulate clamps in saved anchors",
  );
  const restored = resolveLayout(anchors, defaultRects, bounds, uiRects);
  for (const id of CONTROL_IDS) near(restored[id].left, defaultRects[id].left);
});

test("coincident normalized anchors reflow into five independent hit boxes", () => {
  const anchors = Object.fromEntries(
    CONTROL_IDS.map((id) => [id, { x: 0.5, y: 0.7 }]),
  );
  assertLegal(
    resolveLayout(anchors, defaultRects, bounds, uiRects),
    bounds,
    uiRects,
  );
});

test("impossible or invalid projections fail without altering input data", () => {
  const anchors = positions();
  const before = structuredClone(anchors);
  assert.equal(
    resolveLayout(anchors, defaultRects, {
      left: 0,
      top: 0,
      right: 120,
      bottom: 120,
    }),
    null,
  );
  assert.equal(
    resolveLayout({ jump: { x: 0.5, y: 0.5 } }, defaultRects, bounds),
    null,
  );
  assert.equal(
    resolveLayout(
      anchors,
      { ...defaultRects, jump: { width: NaN, height: 60 } },
      bounds,
    ),
    null,
  );
  assert.deepEqual(anchors, before);
});
