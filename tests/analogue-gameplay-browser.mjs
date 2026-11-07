import assert from "node:assert/strict";
import { checkLayoutEditorEdges } from "./layout-editor-edge-cases.mjs";
import { checkAerialDashes } from "./aerial-dash-browser.mjs";
import { checkDashJumpTransitions } from "./dash-jump-browser.mjs";
import { checkFluidCombat } from "./fluid-combat-browser.mjs";
import { resolveMovementConfig } from "../src/movement/MovementConfig.js";
import { speedForMagnitude } from "../src/movement/AnalogueLocomotion.js";

const ids = ["move", "dash", "block", "jump"];
const selector = (id) => (id === "move" ? "#joystick" : `#${id}-button`);
const point = async (page, s) => {
  const b = await page.locator(s).boundingBox();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
};
const touch = (id, p) => ({ id, ...p, radiusX: 7, radiusY: 7, force: 1 });
const read = (page) =>
  page.evaluate(() => window.__KINETIC__?.snapshot() ?? null);
const advance = (page, ms) => page.clock.runFor(ms);
const fresh = async (page) => {
  await page.reload({ waitUntil: "networkidle" });
  await advance(page, 500);
  await page.evaluate(() => document.activeElement?.blur());
};
const click = async (page, s) => {
  const p = await point(page, s);
  await page.mouse.click(p.x, p.y);
  await advance(page, 34);
};
const capture = (page, name) =>
  page.screenshot({ path: `test-results/v073-${name}.png` });
const speed = async (page) =>
  Number(await page.locator("#speed-value").textContent());
const rects = (page) =>
  page.evaluate(() =>
    Object.fromEntries(
      [...document.querySelectorAll("[data-layout-control]")].map((el) => {
        const { x, y, width, height } = el.getBoundingClientRect();
        return [el.dataset.layoutControl, { x, y, width, height }];
      }),
    ),
  );
const sameRects = (a, b) => {
  for (const id of ids)
    for (const key of ["x", "y", "width", "height"])
      assert.ok(
        Math.abs(a[id][key] - b[id][key]) < 0.6,
        `${id} ${key} preserved`,
      );
};

export async function checkAnalogueMovement(page, native) {
  await page.evaluate(() => localStorage.removeItem("kinetic.controls.v1"));
  await fresh(page);
  assert.equal(await page.locator("#sprint-button").count(), 0);
  assert.deepEqual(
    await page
      .locator("[data-layout-control]")
      .evaluateAll((els) => els.map((e) => e.dataset.layoutControl).sort()),
    [...ids].sort(),
  );
  assert.deepEqual(
    await page
      .locator("[data-touch-action]")
      .evaluateAll((els) => els.map((e) => e.dataset.touchAction).sort()),
    ["block", "dash", "jump"],
  );
  const config = resolveMovementConfig();
  const camera = (await read(page))?.camera;
  const joy = await point(page, "#joystick"),
    box = await page.locator("#joystick").boundingBox(),
    radius = Math.min(box.width, box.height) * 0.34;
  let fingers = [touch(701, joy)];
  await native("touchStart", fingers);
  let previous = -1;
  for (const m of [0, 0.12, 0.25, 0.35, 0.55, 0.7, 0.85, 1]) {
    fingers[0] = touch(701, {
      x: joy.x - (m === 0 ? 0 : radius * (0.1 + 0.9 * m)),
      y: joy.y,
    });
    await native("touchMove", fingers, [fingers[0]]);
    await advance(page, 700);
    const actual = await speed(page),
      expected = speedForMagnitude(m, config.analogue);
    assert.ok(
      Math.abs(actual - expected) < 0.16,
      `Joystick ${m} gives ${actual}m/s, expected ${expected}`,
    );
    assert.ok(actual >= previous);
    previous = actual;
    const state = await read(page);
    if (state) {
      assert.ok(Math.abs(state.input.movementMagnitude - m) < 0.025);
      for (const key of ["yaw", "pitch", "distance"])
        assert.equal(state.camera[key], camera[key]);
    }
    if ([0.35, 0.55, 0.7, 1].includes(m))
      await capture(
        page,
        m === 0.35 ? "walk" : m === 0.55 ? "jog" : m === 0.7 ? "run" : "sprint",
      );
  }
  assert.ok(
    Math.abs((await speed(page)) - 5.2) < 0.1,
    "Full stick sprints with no other finger or button",
  );
  let flight = 0,
    support = 0;
  for (let frame = 0; frame < 6; frame++) {
    await advance(page, 100);
    const s = await read(page);
    if (s) {
      if (s.animation.feet.every((f) => f.position[1] > 0.13)) flight++;
      if (s.animation.feet.some((f) => f.planted)) support++;
      assert.equal(s.position[1], 0);
      assert.equal(s.jump.phase, "grounded");
    }
    await capture(page, `sprint-cycle-${frame}`);
  }
  if (await read(page))
    assert.ok(
      flight > 0 && support > 0,
      "Sprint has actual two-foot flight and support",
    );
  fingers[0] = touch(701, { x: joy.x, y: joy.y - radius });
  await native("touchMove", fingers, [fingers[0]]);
  await advance(page, 350);
  await capture(page, "sprint-forward");
  // Independent camera and action fingers while the joystick alone maintains
  // sprint. Slide HOLD -> PRESS -> PRESS without changing joystick ownership.
  const actions = Object.fromEntries(
    await Promise.all(
      ["block", "dash", "jump"].map(async (id) => [
        id,
        await point(page, selector(id)),
      ]),
    ),
  );
  fingers.push(touch(702, { x: 440, y: 205 }), touch(703, actions.block));
  await native("touchStart", fingers, fingers.slice(1));
  await advance(page, 150);
  assert.equal(
    await page.locator("#block-button").getAttribute("aria-pressed"),
    "true",
  );
  const owners = await read(page);
  const slide = async (id, ms) => {
    fingers[2] = touch(703, actions[id]);
    await native("touchMove", fingers, [fingers[2]]);
    await advance(page, ms);
  };
  await slide("dash", 100);
  assert.equal(
    await page.locator("#block-button").getAttribute("aria-pressed"),
    "false",
  );
  await slide("jump", 100);
  await slide("dash", 120);
  const air = await read(page);
  if (air) {
    assert.equal(air.dash.mode, "air");
    assert.equal(air.dash.sequence, 2);
    assert.equal(air.jump.airborne, true);
    assert.equal(air.input.joystickPointer, owners.input.joystickPointer);
  }
  fingers[0] = touch(701, {
    x: joy.x + radius * 0.5,
    y: joy.y - radius * 0.75,
  });
  fingers[1] = touch(702, { x: 465, y: 213 });
  await native("touchMove", fingers, fingers.slice(0, 2));
  await advance(page, 100);
  await native("touchCancel", [], []);
  await advance(page, 1200);
  assert.equal(await page.locator("#jump-status").textContent(), "READY");
  assert.equal(
    await page.locator("#block-button").getAttribute("aria-pressed"),
    "false",
  );
  assert.ok((await speed(page)) < 0.1);
  console.log(
    "PASS: complete analogue speed range without Sprint UI, same-angle walk/jog/run/sprint, visible flight, steering, HOLD/PRESS slides, Dash/Jump/Air Dash and cancellation",
  );
}

async function checkCameraAndPause(page, native) {
  await fresh(page);
  const before = await read(page);
  let fingers = [touch(711, { x: 470, y: 215 })];
  await native("touchStart", fingers);
  fingers[0] = touch(711, { x: 535, y: 230 });
  await native("touchMove", fingers);
  await advance(page, 200);
  assert.equal(
    await page
      .locator("#camera-surface")
      .evaluate((el) => el.classList.contains("is-active")),
    true,
  );
  await native("touchCancel", [], []);
  const reset = await point(page, "#reset-camera");
  await page.touchscreen.tap(reset.x, reset.y);
  await advance(page, 800);
  const after = await read(page);
  if (after) {
    assert.ok(Math.abs(after.camera.pitch - 0.23) < 0.01);
    assert.ok(after.camera.position[1] > 0.35);
    assert.deepEqual(after.position, before.position);
  }
  await click(page, "#help-button");
  await advance(page, 34);
  assert.equal(
    await page.locator("#help-dialog").evaluate((el) => el.open),
    true,
  );
  await page.keyboard.down("w");
  await advance(page, 400);
  await page.keyboard.up("w");
  assert.ok((await speed(page)) < 0.1);
  await page.keyboard.press("Escape");
  await advance(page, 34);
  assert.equal(
    await page.locator("#help-dialog").evaluate((el) => el.open),
    false,
  );
  console.log(
    "PASS: unchanged camera reset, floor clearance and utility pause",
  );
}

async function checkLayouts(page, native) {
  await fresh(page);
  const defaults = await rects(page);
  const positions = await page.evaluate(() =>
    Object.fromEntries(
      [...document.querySelectorAll("[data-layout-control]")].map((el) => {
        const b = el.getBoundingClientRect();
        return [
          el.dataset.layoutControl,
          {
            x: (b.x + b.width / 2) / innerWidth,
            y: (b.y + b.height / 2) / innerHeight - 0.025,
          },
        ];
      }),
    ),
  );
  const legacy = {
    version: 1,
    positions: { ...positions, sprint: { x: 0.9, y: 0.75 } },
  };
  await page.evaluate(
    (v) => localStorage.setItem("kinetic.controls.v1", JSON.stringify(v)),
    legacy,
  );
  await fresh(page);
  const stored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("kinetic.controls.v1")),
  );
  assert.deepEqual(stored, { version: 1, positions });
  assert.equal(await page.locator("#sprint-button").count(), 0);
  const migrated = await rects(page);
  await fresh(page);
  sameRects(await rects(page), migrated);
  const open = async () => {
    await click(page, "#settings-button");
    await click(page, "#edit-controls-button");
    await advance(page, 34);
  };
  await page.keyboard.press("Space");
  await advance(page, 160);
  const airborne = await read(page);
  await open();
  await advance(page, 400);
  const paused = await read(page);
  if (paused) {
    assert.equal(paused.jump.airborne, true);
    assert.equal(paused.jump.height, airborne.jump.height);
  }
  assert.equal(await page.locator("#control-editor-toolbar").isVisible(), true);
  for (const id of ids) {
    const before = await rects(page),
      b = before[id],
      p = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    const to = {
      x: p.x + (id === "move" || id === "jump" ? -8 : 8),
      y: p.y - 6,
    };
    if (id === "jump" || id === "block") {
      const f = [touch(720, p)];
      await native("touchStart", f);
      f[0] = touch(720, to);
      await native("touchMove", f);
      assert.equal(
        await page
          .locator(selector(id))
          .evaluate((el) => el.classList.contains("is-layout-dragging")),
        true,
      );
      await native("touchEnd", [], f);
    } else {
      await page.mouse.move(p.x, p.y);
      await page.mouse.down();
      await page.mouse.move(to.x, to.y, { steps: 4 });
      await page.mouse.up();
    }
    await advance(page, 34);
    const changed = await rects(page);
    assert.ok(
      Math.abs(changed[id].x - b.x) + Math.abs(changed[id].y - b.y) > 1,
      `${id} drags independently`,
    );
    for (const other of ids.filter((x) => x !== id))
      assert.deepEqual(changed[other], before[other]);
  }
  await page.keyboard.down("w");
  await advance(page, 300);
  await page.keyboard.up("w");
  assert.ok((await speed(page)) < 0.1);
  const preview = await rects(page);
  await capture(page, "control-editor");
  await click(page, "#layout-save");
  await advance(page, 34);
  sameRects(await rects(page), preview);
  await fresh(page);
  sameRects(await rects(page), preview);
  await open();
  let move = await point(page, "#joystick");
  await page.mouse.move(move.x, move.y);
  await page.mouse.down();
  await page.mouse.move(move.x + 20, move.y);
  await page.mouse.up();
  await click(page, "#layout-cancel");
  await advance(page, 34);
  sameRects(await rects(page), preview);
  await open();
  await click(page, "#layout-reset");
  await click(page, "#layout-cancel");
  await advance(page, 34);
  sameRects(await rects(page), preview);
  // Hit-test the actual moved buttons after refresh; no cached layout boxes.
  const joy = await point(page, "#joystick"),
    block = await point(page, "#block-button"),
    dash = await point(page, "#dash-button");
  let fingers = [touch(731, joy), touch(732, block)];
  await native("touchStart", fingers);
  fingers[0] = touch(731, { x: joy.x, y: joy.y - 45 });
  await native("touchMove", fingers, [fingers[0]]);
  await advance(page, 150);
  assert.equal(
    await page.locator("#block-button").getAttribute("aria-pressed"),
    "true",
  );
  fingers[1] = touch(732, dash);
  await native("touchMove", fingers, [fingers[1]]);
  await advance(page, 100);
  assert.equal(
    await page.locator("#block-button").getAttribute("aria-pressed"),
    "false",
  );
  assert.equal(
    await page
      .locator("#dash-button")
      .evaluate((el) => el.classList.contains("is-active")),
    true,
  );
  await native("touchCancel", [], []);
  await advance(page, 1000);
  const saved = await page.evaluate(() =>
    localStorage.getItem("kinetic.controls.v1"),
  );
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 640, height: 320 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(viewport);
    await advance(page, 200);
    for (const id of ids) {
      const b = await page.locator(selector(id)).boundingBox();
      assert.ok(
        b.x >= 0 &&
          b.y >= 0 &&
          b.x + b.width <= viewport.width + 0.5 &&
          b.y + b.height <= viewport.height + 0.5,
      );
    }
    const reset = await page.locator("#reset-camera").boundingBox();
    assert.ok(reset.height <= 32 && reset.x + reset.width <= viewport.width);
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    assert.equal(
      await page.evaluate(() => localStorage.getItem("kinetic.controls.v1")),
      saved,
    );
  }
  await open();
  await click(page, "#layout-reset");
  await click(page, "#layout-save");
  await advance(page, 34);
  assert.equal(
    await page.evaluate(() => localStorage.getItem("kinetic.controls.v1")),
    null,
  );
  sameRects(await rects(page), defaults);
  for (const invalid of [
    "{",
    JSON.stringify({ version: 0, positions }),
    JSON.stringify({ version: 1, positions: { move: positions.move } }),
  ]) {
    await page.evaluate(
      (v) => localStorage.setItem("kinetic.controls.v1", v),
      invalid,
    );
    await fresh(page);
    sameRects(await rects(page), defaults);
  }
  await page.evaluate(() => localStorage.removeItem("kinetic.controls.v1"));
  console.log(
    "PASS: legacy Sprint layout migration preserves remaining positions; mouse/touch drag every control, Save/refresh/Cancel/Reset, relocated slides and responsive layouts",
  );
}

async function checkBoundaries(page) {
  await fresh(page);
  await page.keyboard.down("Shift");
  await page.keyboard.down("d");
  await advance(page, 4000);
  assert.ok(
    (await speed(page)) < 0.1,
    "Full analogue/keyboard sprint stops at the arena wall",
  );
  await page.keyboard.down("w");
  await advance(page, 400);
  await page.keyboard.press("Space");
  await advance(page, 1100);
  const s = await read(page);
  if (s) {
    assert.ok(s.position[0] <= s.halfSize - s.radius + 0.001);
    assert.equal(s.position[1], 0);
  }
  assert.equal(await page.locator("#jump-status").textContent(), "READY");
  await page.keyboard.up("w");
  await page.keyboard.up("d");
  await page.keyboard.up("Shift");
  await advance(page, 500);
  console.log(
    "PASS: sprint wall containment, sliding and moving jump/landing against a boundary",
  );
}

export async function checkGameplay(page, native) {
  await checkAnalogueMovement(page, native);
  await checkCameraAndPause(page, native);
  await checkBoundaries(page);
  await checkLayouts(page, native);
  await checkLayoutEditorEdges(page, (ms) => advance(page, ms));
  await checkAerialDashes(page);
  await checkDashJumpTransitions(page, native);
  await checkFluidCombat(page, native);
}
