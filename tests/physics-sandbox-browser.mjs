import assert from "node:assert/strict";
import {
  NORMAL_PHYSICS,
  SANDBOX_STORAGE_KEY,
} from "../src/sandbox/PhysicsSandbox.js";
const snap = (page) =>
  page.evaluate(() => window.__KINETIC__?.snapshot() ?? null);
const advance = (page, ms) => page.clock.runFor(ms);
const point = async (page, s) => {
  const b = await page.locator(s).boundingBox();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
};
const touch = (id, p) => ({ id, ...p, radiusX: 7, radiusY: 7, force: 1 });
const goto = async (page, url) => {
  await page.goto(url, { waitUntil: "networkidle" });
  await advance(page, 500);
  await page.evaluate(() => document.activeElement?.blur());
};
const click = async (page, s) => {
  await page.locator(s).scrollIntoViewIfNeeded();
  await page.locator(s).click();
  await advance(page, 34);
};
const tune = async (page, values) =>
  page.evaluate((values) => {
    for (const [id, value] of Object.entries(values)) {
      const el = document.querySelector(`#physics-${id}`);
      el.value = Math.log10(value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }, values);

export async function checkPhysicsSandbox(page, native) {
  const normal = new URL(page.url());
  normal.searchParams.delete("sandbox");
  const developer = new URL(normal);
  developer.searchParams.set("sandbox", "1");
  const originalLayout = await page.evaluate(() =>
    localStorage.getItem("kinetic.controls.v1"),
  );
  if (!originalLayout)
    await page.evaluate(() => {
      const positions = Object.fromEntries(
        [...document.querySelectorAll("[data-layout-control]")].map((el) => {
          const b = el.getBoundingClientRect();
          return [
            el.dataset.layoutControl,
            {
              x:
                (b.x +
                  b.width / 2 +
                  (el.dataset.layoutControl === "move" ? 8 : -4)) /
                innerWidth,
              y: (b.y + b.height / 2 - 4) / innerHeight,
            },
          ];
        }),
      );
      localStorage.setItem(
        "kinetic.controls.v1",
        JSON.stringify({ version: 1, positions }),
      );
    });
  const sandboxLayout = await page.evaluate(() =>
    localStorage.getItem("kinetic.controls.v1"),
  );
  await goto(page, normal.href);
  assert.equal(await page.locator("#physics-toggle").isVisible(), false);
  await page.evaluate(
    ({ key, values }) =>
      localStorage.setItem(key, JSON.stringify({ version: 1, values })),
    { key: SANDBOX_STORAGE_KEY, values: { ...NORMAL_PHYSICS, movement: 20 } },
  );
  await goto(page, normal.href);
  if (await snap(page)) assert.equal((await snap(page)).sandbox.enabled, false);
  await page.keyboard.down("Shift");
  await page.keyboard.down("a");
  await advance(page, 400);
  assert.ok(
    Number(await page.locator("#speed-value").textContent()) <= 5.3,
    "Normal game ignores saved developer multipliers",
  );
  await page.keyboard.up("a");
  await page.keyboard.up("Shift");
  await goto(page, developer.href);
  await click(page, "#physics-toggle");
  assert.equal(await page.locator(".physics-row").count(), 8);
  assert.equal(
    await page.locator("#physics-movement").getAttribute("aria-valuetext"),
    "20×",
  );
  await click(page, '[data-physics-preset="Normal"]');
  // Every live slider is independently wired; test the exact experimental marks.
  for (const id of Object.keys(NORMAL_PHYSICS)) {
    for (const value of [10, 20, 50, 100]) {
      await tune(page, { [id]: value });
      assert.equal(
        await page.locator(`#physics-${id}`).getAttribute("aria-valuetext"),
        `${value}×`,
      );
      const state = await snap(page);
      if (state) assert.equal(state.sandbox.values[id], value);
    }
    await tune(page, { [id]: 1 });
  }
  // Native touch scroll: bottom controls must be reachable on an Android viewport.
  const scroll = page.locator(".physics-scroll");
  await scroll.evaluate((e) => (e.scrollTop = 0));
  const box = await scroll.boundingBox();
  let fingers = [
    touch(910, { x: box.x + box.width - 8, y: box.y + box.height - 12 }),
  ];
  await native("touchStart", fingers);
  fingers = [touch(910, { x: box.x + box.width - 8, y: box.y + 20 })];
  await native("touchMove", fingers);
  await native("touchEnd", [], []);
  await advance(page, 100);
  assert.ok(
    (await scroll.evaluate((e) => e.scrollTop)) > 10,
    "Panel scrolls using native touch",
  );
  await scroll.evaluate((e) => (e.scrollTop = 0));
  // Independent thumb on joystick + native slider drag; no dash/jump/camera claim.
  const joy = await point(page, "#joystick"),
    jbox = await page.locator("#joystick").boundingBox(),
    r = Math.min(jbox.width, jbox.height) * 0.34;
  const slider = await page.locator("#physics-movement").boundingBox();
  fingers = [touch(911, { x: joy.x - r * 0.3, y: joy.y })];
  await native("touchStart", fingers);
  fingers.push(
    touch(912, {
      x: slider.x + slider.width * 0.35,
      y: slider.y + slider.height / 2,
    }),
  );
  await native("touchStart", fingers, [fingers[1]]);
  fingers[1] = touch(912, {
    x: slider.x + slider.width * 0.7,
    y: slider.y + slider.height / 2,
  });
  await native("touchMove", fingers, [fingers[1]]);
  await advance(page, 34);
  let state = await snap(page);
  if (state) {
    assert.notEqual(state.input.joystickPointer, null);
    assert.equal(state.input.cameraPointer, null);
    assert.equal(state.jump.sequence, 0);
    assert.equal(state.dash.sequence, 0);
    assert.equal(state.input.blocking, false);
  }
  assert.notEqual(
    await page.locator("#physics-movement").getAttribute("aria-valuetext"),
    "1×",
  );
  await native("touchCancel", [], fingers);
  await advance(page, 100);
  await click(page, '[data-physics-preset="Enhanced"]');
  await click(page, "#physics-save");
  await tune(page, { gravity: 100 });
  await click(page, "#physics-load");
  assert.equal(
    await page.locator("#physics-gravity").getAttribute("aria-valuetext"),
    "1×",
  );
  await page.reload({ waitUntil: "networkidle" });
  await advance(page, 500);
  await click(page, "#physics-toggle");
  assert.equal(
    await page.locator("#physics-movement").getAttribute("aria-valuetext"),
    "3×",
  );
  assert.equal(
    await page.evaluate(() => localStorage.getItem("kinetic.controls.v1")),
    sandboxLayout,
    "Physics presets/save never rewrite custom control positions",
  );
  // Real high-speed approach to the dummy: original close range and held Block.
  await tune(page, { ...NORMAL_PHYSICS, movement: 20 });
  await click(page, "#physics-close");
  const approachJoy = await point(page, "#joystick");
  const approachBox = await page.locator("#joystick").boundingBox();
  const approachRadius = Math.min(approachBox.width, approachBox.height) * 0.34;
  let approach = [
    touch(920, {
      x: approachJoy.x + (approachRadius * 2) / Math.sqrt(29),
      y: approachJoy.y - (approachRadius * 5) / Math.sqrt(29),
    }),
  ];
  await native("touchStart", approach);
  await advance(page, 200);
  let combatState = await snap(page);
  if (combatState) {
    assert.ok(
      combatState.combat.attack.sequence > 0,
      "Fast approach detects close attack opportunity",
    );
    assert.ok(combatState.proximity.entryDistance <= 1);
    assert.ok(combatState.proximity.distance <= 1.15);
  }
  assert.notEqual(
    await page.locator("#stance-label").getAttribute("data-technique"),
    "none",
  );
  approach.push(touch(921, await point(page, "#block-button")));
  await native("touchStart", approach, [approach[1]]);
  await advance(page, 500);
  combatState = await snap(page);
  if (combatState) assert.equal(combatState.combat.blocking, true);
  assert.equal(
    await page.locator("#block-button").getAttribute("aria-pressed"),
    "true",
  );
  await native("touchCancel", [], approach);
  await goto(page, developer.href);
  await click(page, "#physics-toggle");
  // Independent extremes: long, fast dash, tall ballistic jump, steering and landing.
  await click(page, '[data-physics-preset="Extreme"]');
  await tune(page, {
    movement: 1,
    jumpHeight: 100,
    gravity: 1,
    groundSpeed: 50,
    groundDistance: 20,
    airSpeed: 50,
    airDistance: 20,
    airControl: 100,
  });
  await click(page, "#physics-close");
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press("Space");
  await advance(page, 200);
  state = await snap(page);
  if (state) {
    assert.ok(state.jump.airborne);
    assert.ok(state.position[1] > 4);
  }
  assert.equal(await page.locator("#jump-status").textContent(), "UP");
  await page.keyboard.down("w");
  await page.keyboard.press("e");
  await advance(page, 34);
  state = await snap(page);
  if (state) {
    assert.equal(state.dash.airDashesRemaining, 0);
    assert.ok(state.position[2] < -1);
  }
  await page.keyboard.up("w");
  await page.keyboard.down("a");
  await advance(page, 80);
  await page.keyboard.up("a");
  await page.keyboard.press("e");
  await advance(page, 100);
  state = await snap(page);
  if (state) assert.equal(state.dash.airDashesUsed, 1);
  for (let ms = 0; ms < 6500; ms += 250) {
    await advance(page, 250);
    state = await snap(page);
    if (state) {
      assert.ok(
        [...state.position, ...state.velocity, ...state.camera.position].every(
          Number.isFinite,
        ),
      );
      assert.ok(state.position[1] >= 0 && state.position[1] <= 80.001);
      assert.ok(state.sandbox.substeps <= 32);
      const horizontal = Math.cos(state.camera.pitch) * state.camera.distance;
      const target = state.camera.position.map(
        (v, i) =>
          v -
          [
            Math.sin(state.camera.yaw) * horizontal,
            Math.sin(state.camera.pitch) * state.camera.distance,
            Math.cos(state.camera.yaw) * horizontal,
          ][i],
      );
      assert.ok(
        Math.hypot(
          target[0] - state.position[0],
          target[1] - state.position[1] - 1.02,
          target[2] - state.position[2],
        ) < 0.66,
      );
    }
  }
  assert.equal(await page.locator("#jump-status").textContent(), "READY");
  state = await snap(page);
  if (state) {
    assert.equal(state.position[1], 0);
    assert.equal(state.dash.airDashesRemaining, 1);
  }
  await page.keyboard.down("d");
  await page.keyboard.press("e");
  await advance(page, 150);
  await page.keyboard.up("d");
  state = await snap(page);
  if (state) {
    assert.ok(Math.abs(state.position[0]) <= 17.641);
    assert.ok(Math.abs(state.position[2]) <= 17.641);
  }
  // Independent speed/distance can create a very long burst. Its feet must
  // keep cycling while the same continuous physical dash remains active.
  await goto(page, developer.href);
  await click(page, "#physics-toggle");
  await tune(page, {
    ...NORMAL_PHYSICS,
    groundSpeed: 0.1,
    groundDistance: 100,
  });
  await click(page, "#physics-close");
  await page.evaluate(() => document.activeElement?.blur());
  const longStart = await snap(page);
  await page.keyboard.down("w");
  await page.keyboard.press("e");
  await advance(page, 1000);
  await page.keyboard.up("w");
  state = await snap(page);
  if (state) {
    assert.ok(state.dash.active);
    assert.ok(state.position[2] < longStart.position[2] - 0.4);
    assert.ok(state.animation.phase > longStart.animation.phase + 0.1);
  }
  assert.equal(await page.locator("#movement-state").textContent(), "DASH");
  await page.screenshot({ path: "test-results/v074-long-dash.png" });
  // Mobile viewport fit and readable close control, including portrait orientation.
  await click(page, "#physics-toggle");
  for (const [width, height] of [
    [390, 844],
    [360, 640],
    [320, 568],
    [740, 360],
    [844, 390],
  ]) {
    await page.setViewportSize({ width, height });
    await advance(page, 50);
    const b = await page.locator("#physics-panel").boundingBox(),
      c = await page.locator("#physics-close").boundingBox();
    assert.ok(
      b.x >= 0 &&
        b.y >= 0 &&
        b.x + b.width <= width &&
        b.y + b.height <= height,
    );
    assert.ok(c.width >= 40 && c.height >= 40);
    assert.ok(b.height > 180);
  }
  await page.screenshot({ path: "test-results/v074-physics-panel.png" });
  await click(page, "#physics-reset");
  await click(page, "#physics-save");
  await click(page, "#physics-close");
  await goto(page, normal.href);
  assert.equal(await page.locator("#physics-toggle").isVisible(), false);
  await page.evaluate((original) => {
    if (original === null) localStorage.removeItem("kinetic.controls.v1");
    else localStorage.setItem("kinetic.controls.v1", original);
  }, originalLayout);
  console.log(
    "PASS: opt-in sandbox, 8 independent 100x sliders, native slider/joystick multitouch and scrolling, presets/save/load, layout preservation, extreme jump/dash/air steering/landing, camera and mobile fit",
  );
}
