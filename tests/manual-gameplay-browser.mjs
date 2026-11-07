import assert from "node:assert/strict";
import { speedForMagnitude } from "../src/movement/AnalogueLocomotion.js";
import { resolveMovementConfig } from "../src/movement/MovementConfig.js";
import {
  NORMAL_PHYSICS,
  SANDBOX_STORAGE_KEY,
} from "../src/sandbox/PhysicsSandbox.js";
import { checkLayoutEditorEdges } from "./layout-editor-edge-cases.mjs";
const ids = ["move", "block", "jump", "punch", "kick"];
const sel = (id) => (id === "move" ? "#joystick" : `#${id}-button`);
const advance = (p, ms) => p.clock.runFor(ms);
const snap = (p) => p.evaluate(() => window.__KINETIC__?.snapshot() ?? null);
const point = async (p, s) => {
  const b = await p.locator(s).boundingBox();
  assert.ok(b, s);
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
};
const touch = (id, p) => ({ id, ...p, radiusX: 7, radiusY: 7, force: 1 });
const click = async (p, s) => {
  await p.locator(s).scrollIntoViewIfNeeded();
  await p.locator(s).click();
  await advance(p, 34);
  await p.evaluate(() => document.activeElement?.blur());
};
const fresh = async (p) => {
  await p.reload({ waitUntil: "networkidle" });
  await advance(p, 450);
  await p.evaluate(() => document.activeElement?.blur());
};
const sequence = (p) =>
  p.locator("#stance-label").evaluate((e) => Number(e.dataset.sequence ?? 0));
const contacts = (p) =>
  p.locator("#contact-status").evaluate((e) => Number(e.dataset.count ?? 0));
const action = (p) => p.locator("#stance-label").getAttribute("data-action");
const speed = async (p) =>
  Number(await p.locator("#speed-value").textContent());
const rects = (p) =>
  p.evaluate(() =>
    Object.fromEntries(
      [...document.querySelectorAll("[data-layout-control]")].map((e) => {
        const { x, y, width, height } = e.getBoundingClientRect();
        return [e.dataset.layoutControl, { x, y, width, height }];
      }),
    ),
  );
const same = (a, b) => {
  for (const id of ids)
    for (const key of ["x", "y", "width", "height"])
      assert.ok(Math.abs(a[id][key] - b[id][key]) < 0.6, `${id} ${key}`);
};
async function tap(page, native, id, n = 10) {
  const f = [touch(n, await point(page, sel(id)))];
  await native("touchStart", f);
  await native("touchEnd", [], f);
}
const tune = (p, values) =>
  p.evaluate((values) => {
    for (const [id, v] of Object.entries(values)) {
      const el = document.querySelector(`#physics-${id}`);
      el.value = Math.log10(v);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }, values);

export async function checkGameplay(page, native) {
  await page.evaluate(() => {
    localStorage.removeItem("kinetic.controls.v1");
    localStorage.removeItem("kinetic.physics-sandbox.v1");
  });
  await fresh(page);
  assert.equal(await page.locator("#dash-button").count(), 0);
  assert.equal(await page.locator("#sprint-button").count(), 0);
  assert.deepEqual(
    await page
      .locator("[data-layout-control]")
      .evaluateAll((es) => es.map((e) => e.dataset.layoutControl).sort()),
    [...ids].sort(),
  );
  assert.deepEqual(
    await page
      .locator('[data-touch-behavior="TAP_HOLD"]')
      .evaluateAll((es) => es.map((e) => e.dataset.touchAction).sort()),
    ["kick", "punch"],
  );
  // Full analogue extension, camera-relative steering, and default camera/reset.
  const joy = await point(page, "#joystick"),
    box = await page.locator("#joystick").boundingBox(),
    r = Math.min(box.width, box.height) * 0.34;
  let fingers = [touch(1, joy)];
  await native("touchStart", fingers);
  for (const m of [0.12, 0.35, 0.55, 0.7, 0.85, 1]) {
    fingers = [touch(1, { x: joy.x - r * (0.1 + 0.9 * m), y: joy.y })];
    await native("touchMove", fingers);
    await advance(page, 450);
    assert.ok(
      Math.abs(
        (await speed(page)) -
          speedForMagnitude(m, resolveMovementConfig().analogue),
      ) < 0.18,
    );
  }
  await native("touchCancel", [], fingers);
  await advance(page, 450);
  assert.ok((await speed(page)) < 0.1);
  await page.keyboard.press("e");
  await advance(page, 80);
  let state = await snap(page);
  if (state)
    assert.equal(state.dash.sequence, 0, "Dash is disabled in normal play");
  const cameraStart = (await snap(page))?.camera;
  fingers = [touch(2, { x: 450, y: 220 })];
  await native("touchStart", fingers);
  fingers = [touch(2, { x: 550, y: 200 })];
  await native("touchMove", fingers);
  await native("touchEnd", [], fingers);
  await advance(page, 180);
  state = await snap(page);
  if (state) assert.ok(Math.abs(state.camera.yaw - cameraStart.yaw) > 0.1);
  await click(page, "#reset-camera");
  await advance(page, 250);
  state = await snap(page);
  if (state) {
    assert.ok(state.camera.position[1] >= 0.3);
    assert.equal(state.camera.targetPitch, 0.23);
  }
  console.log(
    "PASS: analogue walk/jog/run/sprint, no Dash/Sprint HUD, camera orbit/reset and touch cancellation",
  );
  // Tap exactly once, held repetition, rapid taps and switching at recovery.
  await fresh(page);
  for (const id of ["punch", "kick"]) {
    const before = await sequence(page);
    await tap(page, native, id, 20);
    await advance(page, 100);
    assert.equal(await sequence(page), before + 1);
    assert.equal(await action(page), id);
    await advance(page, 650);
    assert.equal(await sequence(page), before + 1);
    assert.equal(await contacts(page), 0);
  }
  let before = await sequence(page);
  fingers = [touch(21, await point(page, sel("punch")))];
  await native("touchStart", fingers);
  await advance(page, 950);
  assert.ok(
    (await sequence(page)) >= before + 2 &&
      (await sequence(page)) <= before + 3,
  );
  await native("touchEnd", [], fingers);
  await advance(page, 100);
  const released = await sequence(page);
  await advance(page, 650);
  assert.equal(await sequence(page), released);
  before = await sequence(page);
  fingers = [touch(22, await point(page, sel("kick")))];
  await native("touchStart", fingers);
  await advance(page, 1100);
  assert.ok(
    (await sequence(page)) >= before + 2 &&
      (await sequence(page)) <= before + 3,
  );
  await native("touchEnd", [], fingers);
  await advance(page, 650);
  await tap(page, native, "punch", 23);
  await advance(page, 80);
  const busy = await sequence(page);
  for (let n = 0; n < 4; n++) {
    await tap(page, native, n % 2 ? "kick" : "punch", 24);
    await advance(page, 30);
  }
  await advance(page, 600);
  assert.equal(
    await sequence(page),
    busy,
    "No recovery queue from rapid released taps",
  );
  fingers = [touch(25, await point(page, sel("punch")))];
  await native("touchStart", fingers);
  await advance(page, 100);
  fingers = [touch(25, await point(page, sel("kick")))];
  await native("touchMove", fingers);
  await advance(page, 500);
  assert.equal(await action(page), "kick");
  fingers = [touch(25, await point(page, sel("block")))];
  await native("touchMove", fingers);
  await advance(page, 100);
  assert.equal(
    await page.locator("#block-button").getAttribute("aria-pressed"),
    "true",
  );
  const blocked = await sequence(page);
  await advance(page, 450);
  assert.equal(await sequence(page), blocked);
  fingers = [touch(25, await point(page, sel("punch")))];
  await native("touchMove", fingers);
  await advance(page, 100);
  assert.equal(await action(page), "punch");
  assert.equal(
    await page.locator("#block-button").getAttribute("aria-pressed"),
    "false",
  );
  await native("touchCancel", [], fingers);
  await advance(page, 600);
  const cancelled = await sequence(page);
  await advance(page, 500);
  assert.equal(await sequence(page), cancelled);
  console.log(
    "PASS: single Punch/Kick taps, held repeat, rapid taps, Punch/Kick/Block slides, Block priority and cancellation",
  );
  // Opponent proximity alone does nothing. Contacts are active-window signals.
  await fresh(page);
  await page.keyboard.down("d");
  await advance(page, 800);
  await page.keyboard.up("d");
  await advance(page, 250);
  await page.keyboard.down("w");
  await advance(page, 1800);
  await page.keyboard.up("w");
  await advance(page, 350);
  assert.equal(await sequence(page), 0);
  assert.equal(await contacts(page), 0);
  await tap(page, native, "punch", 31);
  await advance(page, 180);
  assert.equal(await contacts(page), 1);
  await advance(page, 600);
  assert.equal(await contacts(page), 1);
  await tap(page, native, "kick", 32);
  await advance(page, 240);
  assert.equal(await contacts(page), 2);
  await advance(page, 650);
  await page.keyboard.down("s");
  await advance(page, 500);
  await page.keyboard.up("s");
  await advance(page, 250);
  const misses = await contacts(page);
  await tap(page, native, "punch", 33);
  await advance(page, 650);
  assert.equal(await contacts(page), misses, "An out-of-range strike misses");
  console.log(
    "PASS: no proximity auto attacks; real punch/kick contact once per strike, active recovery and misses",
  );
  // Independent native joystick/camera/attack fingers, moving and airborne strikes.
  await fresh(page);
  const j = await point(page, "#joystick");
  fingers = [
    touch(40, { x: j.x - r, y: j.y }),
    touch(41, await point(page, sel("punch"))),
    touch(42, { x: 450, y: 200 }),
  ];
  await native("touchStart", fingers);
  await advance(page, 450);
  assert.ok((await speed(page)) > 4.8);
  fingers[2] = touch(42, { x: 475, y: 210 });
  await native("touchMove", fingers, [fingers[2]]);
  await advance(page, 100);
  state = await snap(page);
  if (state) {
    assert.notEqual(state.input.joystickPointer, null);
    assert.notEqual(state.input.cameraPointer, null);
    assert.ok(state.combat.attack.sequence > 0);
  }
  await native("touchCancel", [], fingers);
  await advance(page, 500);
  for (const [key, technique] of [
    ["f", "aerial-punch"],
    ["g", "flying-kick"],
  ]) {
    await fresh(page);
    await page.keyboard.down("Shift");
    await page.keyboard.down("a");
    await advance(page, 350);
    await page.keyboard.press("Space");
    await advance(page, 140);
    await page.keyboard.down(key);
    await advance(page, 100);
    assert.equal(
      await page.locator("#stance-label").getAttribute("data-technique"),
      technique,
    );
    assert.ok((await speed(page)) > 4.5);
    await page.screenshot({ path: `test-results/v075-${technique}.png` });
    await page.keyboard.up(key);
    await page.keyboard.up("a");
    await page.keyboard.up("Shift");
    await advance(page, 900);
    assert.equal(await page.locator("#jump-status").textContent(), "READY");
  }
  console.log(
    "PASS: native movement/attack/camera multitouch, moving strikes, aerial punch/flying kick, momentum and landing",
  );
  // Preserve remaining legacy coordinates, add new buttons, drag every control.
  await page.evaluate(() =>
    localStorage.setItem(
      "kinetic.controls.v1",
      JSON.stringify({
        version: 1,
        positions: {
          move: { x: 0.12, y: 0.72 },
          dash: { x: 0.8, y: 0.5 },
          block: { x: 0.78, y: 0.74 },
          jump: { x: 0.69, y: 0.74 },
          sprint: null,
        },
      }),
    ),
  );
  await fresh(page);
  const migrated = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("kinetic.controls.v1")),
  );
  for (const [id, p] of Object.entries({
    move: { x: 0.12, y: 0.72 },
    block: { x: 0.78, y: 0.74 },
    jump: { x: 0.69, y: 0.74 },
  }))
    assert.deepEqual(migrated.positions[id], p);
  assert.deepEqual(Object.keys(migrated.positions), ids);
  const openEditor = async () => {
    await click(page, "#settings-button");
    await click(page, "#edit-controls-button");
  };
  await openEditor();
  assert.equal(await page.locator("#dash-button").count(), 0);
  for (const id of ids) {
    const beforeRects = await rects(page),
      b = beforeRects[id];
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2 - 9, b.y + b.height / 2 - 7, {
      steps: 3,
    });
    await page.mouse.up();
    await advance(page, 34);
    const after = await rects(page);
    assert.ok(
      Math.abs(after[id].x - b.x) + Math.abs(after[id].y - b.y) > 1,
      `${id} drags`,
    );
    for (const other of ids.filter((x) => x !== id))
      assert.deepEqual(after[other], beforeRects[other]);
  }
  const edited = await rects(page);
  await click(page, "#layout-save");
  await fresh(page);
  same(await rects(page), edited);
  await openEditor();
  let p = await point(page, sel("punch"));
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.move(p.x - 15, p.y + 10);
  await page.mouse.up();
  await click(page, "#layout-cancel");
  same(await rects(page), edited);
  // Slid hits follow actual relocated DOM bounds after refresh.
  fingers = [touch(50, await point(page, sel("block")))];
  await native("touchStart", fingers);
  fingers = [touch(50, await point(page, sel("punch")))];
  await native("touchMove", fingers);
  await advance(page, 120);
  assert.equal(await action(page), "punch");
  fingers = [touch(50, await point(page, sel("kick")))];
  await native("touchMove", fingers);
  await advance(page, 500);
  assert.equal(await action(page), "kick");
  await native("touchCancel", [], fingers);
  await openEditor();
  await click(page, "#layout-reset");
  await click(page, "#layout-save");
  assert.equal(
    await page.evaluate(() => localStorage.getItem("kinetic.controls.v1")),
    null,
  );
  await checkLayoutEditorEdges(page, (ms) => advance(page, ms));
  console.log(
    "PASS: legacy migration, 5 independent editor controls, save/refresh/cancel/reset, relocated slides and compact-screen editor",
  );
  await checkSandbox(page, native);
}

export async function checkSandbox(page, native) {
  const normal = new URL(page.url());
  normal.searchParams.delete("sandbox");
  const dev = new URL(normal);
  dev.searchParams.set("sandbox", "1");
  await page.goto(dev.href, { waitUntil: "networkidle" });
  await advance(page, 450);
  await click(page, "#physics-toggle");
  assert.equal(await page.locator(".physics-row").count(), 8);
  const original = await page.evaluate(() =>
    localStorage.getItem("kinetic.controls.v1"),
  );
  for (const id of Object.keys(NORMAL_PHYSICS)) {
    await tune(page, { [id]: 100 });
    assert.equal(
      await page.locator(`#physics-${id}`).getAttribute("aria-valuetext"),
      "100×",
    );
    await tune(page, { [id]: 1 });
  }
  await click(page, '[data-physics-preset="Enhanced"]');
  await click(page, "#physics-save");
  await tune(page, { gravity: 50 });
  await click(page, "#physics-load");
  assert.equal(
    await page.locator("#physics-gravity").getAttribute("aria-valuetext"),
    "1×",
  );
  await fresh(page);
  await click(page, "#physics-toggle");
  assert.equal(
    await page.locator("#physics-movement").getAttribute("aria-valuetext"),
    "3×",
  );
  assert.equal(
    await page.evaluate(() => localStorage.getItem("kinetic.controls.v1")),
    original,
  );
  // Native joystick + live slider: utility contact never turns into an attack.
  const joy = await point(page, "#joystick"),
    box = await page.locator("#physics-movement").boundingBox();
  let fingers = [
    touch(60, joy),
    touch(61, { x: box.x + box.width * 0.3, y: box.y + box.height / 2 }),
  ];
  await native("touchStart", fingers);
  fingers[1] = touch(61, {
    x: box.x + box.width * 0.7,
    y: box.y + box.height / 2,
  });
  await native("touchMove", fingers, [fingers[1]]);
  await advance(page, 40);
  assert.equal(await sequence(page), 0);
  await native("touchCancel", [], fingers);
  // Start before contact at extreme speed: steering remains independent.
  await tune(page, { ...NORMAL_PHYSICS, movement: 20 });
  await click(page, "#physics-close");
  await page.keyboard.down("f");
  await page.keyboard.down("Shift");
  await page.keyboard.down("a");
  await advance(page, 130);
  assert.ok((await sequence(page)) > 0);
  assert.ok((await speed(page)) > 50);
  {
    const state = await snap(page);
    if (state) {
      assert.ok(state.sandbox.substeps <= 32);
      assert.ok(state.position.every(Number.isFinite));
    }
  }
  await page.keyboard.up("f");
  await page.keyboard.up("a");
  await page.keyboard.up("Shift");
  await advance(page, 500);
  // Preserve both dash implementations in the developer lab, with no HUD/editor Dash.
  await click(page, "#physics-toggle");
  await tune(page, {
    ...NORMAL_PHYSICS,
    jumpHeight: 20,
    groundSpeed: 20,
    groundDistance: 10,
    airSpeed: 20,
    airDistance: 10,
    airControl: 20,
  });
  await click(page, "#physics-test-dash");
  await advance(page, 40);
  await click(page, "#physics-close");
  await page.keyboard.press("Space");
  await advance(page, 150);
  await page.keyboard.press("e");
  await advance(page, 30);
  let state = await snap(page);
  if (state) {
    assert.ok(state.jump.airborne);
    assert.equal(state.dash.airDashesRemaining, 0);
  }
  await page.keyboard.down("g");
  await advance(page, 100);
  assert.equal(
    await page.locator("#stance-label").getAttribute("data-technique"),
    "flying-kick",
  );
  await page.keyboard.up("g");
  await advance(page, 3000);
  assert.equal(await page.locator("#jump-status").textContent(), "READY");
  await click(page, "#physics-toggle");
  for (const [width, height] of [
    [320, 568],
    [390, 844],
    [740, 360],
    [844, 390],
  ]) {
    await page.setViewportSize({ width, height });
    await advance(page, 35);
    const b = await page.locator("#physics-panel").boundingBox();
    assert.ok(
      b.x >= 0 &&
        b.y >= 0 &&
        b.x + b.width <= width &&
        b.y + b.height <= height,
    );
  }
  await page.screenshot({ path: "test-results/v075-sandbox.png" });
  await click(page, "#physics-reset");
  await click(page, "#physics-save");
  await click(page, "#physics-close");
  await page.goto(normal.href, { waitUntil: "networkidle" });
  await advance(page, 450);
  assert.equal(await page.locator("#physics-toggle").isVisible(), false);
  console.log(
    "PASS: 8 original sandbox sliders, presets/save/load/default isolation, native slider multitouch, 20x manual combat, preserved ground/air dash code, flying kick and landing",
  );
}
