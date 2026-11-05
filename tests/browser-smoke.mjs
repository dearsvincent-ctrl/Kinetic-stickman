import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

// Run against `npm run dev`. CDP dispatches native multi-touch input rather
// than directly mutating the controller. This is emulation, not device testing.
const baseURL = process.env.TEST_URL || "http://127.0.0.1:5173";
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
  headless: true,
  args: ["--no-sandbox", "--enable-unsafe-swiftshader"],
});
await mkdir("test-results", { recursive: true });
const errors = [];
const page = await browser.newPage({
  viewport: { width: 844, height: 390 },
  deviceScaleFactor: 1,
  isMobile: true,
  hasTouch: true,
});
page.on("pageerror", (error) => errors.push(error.message));
page.on("console", (message) => {
  if (message.type() === "error") errors.push(message.text());
});
const snapshot = () => page.evaluate(() => window.__KINETIC__.snapshot());
const wait = (predicate, timeout = 25000) =>
  page.waitForFunction(predicate, null, { timeout });
const closeTo = (a, b, tolerance = 0.06) =>
  assert.ok(Math.abs(a - b) < tolerance, `${a} ≈ ${b}`);
const checkFightLayout = async (width, height) => {
  const fight = await page.locator("#fight-button").boundingBox();
  assert.ok(
    fight.x >= 0 &&
      fight.y >= 0 &&
      fight.x + fight.width <= width &&
      fight.y + fight.height <= height,
    "FIGHT fits the viewport",
  );
  assert.ok(
    fight.width >= 44 && fight.height >= 44,
    "FIGHT remains a usable touch target",
  );
  for (const selector of ["#joystick", "#sprint-button", "#reset-camera"]) {
    const other = await page.locator(selector).boundingBox();
    assert.ok(
      fight.x + fight.width <= other.x ||
        other.x + other.width <= fight.x ||
        fight.y + fight.height <= other.y ||
        other.y + other.height <= fight.y,
      `FIGHT does not cover ${selector}`,
    );
  }
};

try {
  await page.goto(`${baseURL}/?debug`, { waitUntil: "networkidle" });
  await wait(() => Boolean(window.__KINETIC__));
  assert.equal(await page.locator("#error").isVisible(), false);
  const initial = await snapshot();
  closeTo(initial.camera.distance, 4.8);
  assert.equal(initial.renderer.triangles < 15000, true);
  await page.screenshot({ path: "test-results/landscape.png" });
  console.log("PASS: arena renders in a mobile landscape viewport");

  await checkFightLayout(844, 390);
  assert.equal(initial.input.fighting, false);
  assert.equal(
    await page.locator("#fight-button").getAttribute("aria-pressed"),
    "false",
  );
  await page.locator("#fight-button").tap();
  const guardWeights = await page.evaluate(async () => {
    const samples = [];
    for (let frame = 0; frame < 180; frame++) {
      const weight = window.__KINETIC__.snapshot().animation.combatWeight;
      samples.push(weight);
      if (weight > 0.95) break;
      await new Promise(requestAnimationFrame);
    }
    return samples;
  });
  assert.ok(
    guardWeights.some((weight) => weight > 0 && weight < 0.95),
    "Guard blends through intermediate poses",
  );
  assert.ok(guardWeights.at(-1) > 0.95, "Guard reaches its target pose");
  assert.ok(
    guardWeights.every(
      (weight, index) =>
        weight >= 0 &&
        weight <= 1 &&
        (index === 0 || weight >= guardWeights[index - 1]),
    ),
    "Guard entry is bounded and monotonic",
  );
  const guarded = await snapshot();
  assert.equal(guarded.input.fighting, true);
  assert.deepEqual(
    guarded.position,
    initial.position,
    "Stance never translates the actor",
  );
  closeTo(guarded.camera.pitch, initial.camera.pitch, 0.000001);
  closeTo(guarded.camera.yaw, initial.camera.yaw, 0.000001);
  closeTo(guarded.camera.distance, initial.camera.distance, 0.000001);
  await page.screenshot({ path: "test-results/guard.png" });
  await page.locator("#fight-button").tap();
  await wait(
    () =>
      !window.__KINETIC__.snapshot().input.fighting &&
      window.__KINETIC__.snapshot().animation.combatWeight < 0.02,
  );
  console.log(
    "PASS: FIGHT smoothly toggles the guard without moving the actor or camera",
  );

  await page.keyboard.down("w");
  await page.keyboard.down("Shift");
  await wait(() => window.__KINETIC__.snapshot().speed > 4.9);
  await page.keyboard.up("w");
  await page.keyboard.up("Shift");
  await wait(() => window.__KINETIC__.snapshot().speed < 0.01);
  assert.ok((await snapshot()).position[2] < -0.2);
  console.log("PASS: keyboard sprint accelerates and stops");

  await page.keyboard.down("w");
  await page.keyboard.down("Shift");
  await wait(() => window.__KINETIC__.snapshot().position[2] < -17.63, 45000);
  const boundary = await snapshot();
  closeTo(boundary.position[2], -(boundary.halfSize - boundary.radius));
  await page.keyboard.down("d");
  await wait(() => window.__KINETIC__.snapshot().position[0] > 1);
  closeTo((await snapshot()).position[2], boundary.position[2]);
  await page.keyboard.up("w");
  await page.keyboard.up("d");
  await page.keyboard.up("Shift");
  await wait(() => window.__KINETIC__.snapshot().speed < 0.01);
  console.log("PASS: sprint respects the arena boundary and slides along it");

  const center = async (selector) => {
    const box = await page.locator(selector).boundingBox();
    return {
      x: Math.round(box.x + box.width / 2),
      y: Math.round(box.y + box.height / 2),
    };
  };
  const joy = await center("#joystick");
  const sprint = await center("#sprint-button");
  const session = await page.context().newCDPSession(page);
  const touch = (id, point) => ({
    id,
    x: point.x,
    y: point.y,
    radiusX: 7,
    radiusY: 7,
    force: 1,
  });
  const camera = { x: 550, y: 165 };
  let fingers = [touch(1, joy), touch(2, camera), touch(3, sprint)];
  await session.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: fingers,
  });
  fingers = [
    touch(1, { x: joy.x + 32, y: joy.y + 6 }),
    touch(2, { x: camera.x + 80, y: camera.y + 25 }),
    touch(3, sprint),
  ];
  await session.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: fingers,
  });
  await wait(() => {
    const s = window.__KINETIC__.snapshot();
    return (
      s.input.move.x > 0.5 && s.input.sprinting && Math.abs(s.camera.yaw) > 0.2
    );
  });
  const multi = await snapshot();
  assert.equal(
    new Set([
      multi.input.joystickPointer,
      multi.input.cameraPointer,
      multi.input.sprintPointer,
    ]).size,
    3,
  );
  assert.ok(
    multi.input.joystickPointer !== null &&
      multi.input.cameraPointer !== null &&
      multi.input.sprintPointer !== null,
  );
  assert.equal(
    await page.locator("#sprint-button").getAttribute("aria-pressed"),
    "true",
  );
  assert.ok(
    await page
      .locator("#joystick")
      .evaluate((node) => node.classList.contains("is-active")),
  );
  await page.screenshot({ path: "test-results/multitouch.png" });
  const fight = await center("#fight-button");
  const fourthFinger = touch(6, fight);
  const beforeFightTap = await snapshot();
  await session.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [...fingers, fourthFinger],
  });
  await session.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [fourthFinger],
  });
  await wait(
    () =>
      window.__KINETIC__.snapshot().input.fighting &&
      window.__KINETIC__.snapshot().animation.combatWeight > 0.95,
  );
  const guardedMulti = await snapshot();
  assert.equal(
    guardedMulti.input.joystickPointer,
    beforeFightTap.input.joystickPointer,
  );
  assert.equal(
    guardedMulti.input.cameraPointer,
    beforeFightTap.input.cameraPointer,
  );
  assert.equal(
    guardedMulti.input.sprintPointer,
    beforeFightTap.input.sprintPointer,
  );
  assert.deepEqual(guardedMulti.input.move, beforeFightTap.input.move);
  assert.equal(guardedMulti.input.sprinting, true);
  closeTo(
    guardedMulti.camera.targetYaw,
    beforeFightTap.camera.targetYaw,
    0.000001,
  );
  assert.equal(
    await page.locator("#fight-button").getAttribute("aria-pressed"),
    "true",
  );
  await page.keyboard.press("f");
  await wait(
    () =>
      !window.__KINETIC__.snapshot().input.fighting &&
      window.__KINETIC__.snapshot().animation.combatWeight < 0.02,
  );
  console.log(
    "PASS: a fourth touch toggles FIGHT while joystick, look and sprint keep their owners",
  );
  await session.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    // CDP touchEnd identifies the ended finger, unlike TouchEvent.touches.
    touchPoints: fingers.slice(0, 1),
  });
  await wait(
    () => window.__KINETIC__.snapshot().input.joystickPointer === null,
  );
  let released = await snapshot();
  closeTo(released.input.move.x, 0);
  assert.ok(released.input.cameraPointer !== null && released.input.sprinting);
  await session.send("Input.dispatchTouchEvent", {
    type: "touchCancel",
    touchPoints: [],
  });
  released = await snapshot();
  assert.equal(released.input.cameraPointer, null);
  assert.equal(released.input.sprinting, false);
  assert.equal(await page.evaluate(() => window.scrollY), 0);
  console.log(
    "PASS: native three-finger movement, look, sprint, independent release and cancellation",
  );

  await page.locator("#reset-camera").tap();
  await wait(() => {
    const s = window.__KINETIC__.snapshot();
    return (
      Math.abs(
        Math.atan2(
          Math.sin(s.camera.yaw - s.heading),
          Math.cos(s.camera.yaw - s.heading),
        ),
      ) < 0.03
    );
  });
  closeTo((await snapshot()).camera.targetPitch, 0.23);
  await session.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [touch(4, { x: 520, y: 85 })],
  });
  await session.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [touch(4, { x: 520, y: 385 })],
  });
  await session.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await wait(() => window.__KINETIC__.snapshot().camera.pitch > 1);
  const upper = await snapshot();
  assert.ok(upper.camera.pitch <= 1.05 && upper.camera.position[1] >= 0.3);
  await session.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [touch(5, { x: 520, y: 385 })],
  });
  await session.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [touch(5, { x: 520, y: 0 })],
  });
  await session.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await wait(() => window.__KINETIC__.snapshot().camera.pitch < 0.1);
  assert.ok((await snapshot()).camera.position[1] >= 0.3);
  console.log("PASS: reset and vertical camera limits via touch");

  await page.locator("#help-button").tap();
  assert.ok((await snapshot()).paused);
  const helpPosition = (await snapshot()).position;
  await page.keyboard.down("w");
  await page.waitForTimeout(250);
  await page.keyboard.up("w");
  assert.deepEqual((await snapshot()).position, helpPosition);
  await page.locator(".primary-button").tap();
  assert.equal((await snapshot()).paused, false);
  console.log("PASS: instructions pause movement and close cleanly");

  await page.setViewportSize({ width: 390, height: 844 });
  await wait(
    () => window.__KINETIC__.snapshot().input.joystickPointer === null,
  );
  for (const selector of ["#joystick", "#sprint-button", "#reset-camera"]) {
    const box = await page.locator(selector).boundingBox();
    assert.ok(
      box.x >= 0 &&
        box.y >= 0 &&
        box.x + box.width <= 390 &&
        box.y + box.height <= 844,
      `${selector} fits portrait`,
    );
  }
  await checkFightLayout(390, 844);
  await page.locator("#reset-camera").tap();
  await page.screenshot({ path: "test-results/portrait.png" });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  assert.deepEqual(errors, [], "No browser runtime errors");
  console.log(
    "PASS: portrait adaptation, controls within viewport, no page overflow or runtime errors",
  );
  console.log(
    "Browser smoke checks passed. Screenshots in test-results/. No physical-phone testing performed.",
  );
} finally {
  await browser.close();
}
