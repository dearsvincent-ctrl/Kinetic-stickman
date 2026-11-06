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
const center = async (selector) => {
  const box = await page.locator(selector).boundingBox();
  return {
    x: Math.round(box.x + box.width / 2),
    y: Math.round(box.y + box.height / 2),
  };
};
// Observe in the page on every rendered frame: a 250ms dash can finish before
// a later Playwright assertion gets its turn, especially in software rendering.
const observeDash = (sequence) =>
  page.evaluate(async (previousSequence) => {
    const samples = [];
    for (let frame = 0; frame < 240; frame++) {
      const state = window.__KINETIC__.snapshot();
      samples.push(state);
      if (state.dash.sequence > previousSequence && !state.dash.active)
        return samples;
      await new Promise(requestAnimationFrame);
    }
    throw new Error("DASH did not start and finish within 240 rendered frames");
  }, sequence);
const observeJump = (sequence) =>
  page.evaluate(async (previousSequence) => {
    const samples = [];
    for (let frame = 0; frame < 240; frame++) {
      const state = window.__KINETIC__.snapshot();
      samples.push(state);
      if (
        state.jump.sequence > previousSequence &&
        state.jump.phase === "grounded"
      )
        return samples;
      await new Promise(requestAnimationFrame);
    }
    throw new Error("Jump did not start and land within 240 rendered frames");
  }, sequence);
const checkActionLayout = async (width, height) => {
  const selectors = [
    "#sprint-button",
    "#dash-button",
    "#block-button",
    "#jump-button",
  ];
  for (const selector of selectors) {
    const box = await page.locator(selector).boundingBox();
    assert.ok(
      box.x >= 0 &&
        box.y >= 0 &&
        box.x + box.width <= width &&
        box.y + box.height <= height,
      `${selector} fits the viewport`,
    );
    assert.ok(
      box.width >= 44 && box.height >= 44,
      `${selector} remains a usable touch target`,
    );
    for (const otherSelector of [
      ...selectors.filter((other) => other !== selector),
      "#joystick",
      "#reset-camera",
      "#help-button",
    ]) {
      const other = await page.locator(otherSelector).boundingBox();
      assert.ok(
        box.x + box.width <= other.x ||
          other.x + other.width <= box.x ||
          box.y + box.height <= other.y ||
          other.y + other.height <= box.y,
        `${selector} does not overlap ${otherSelector}`,
      );
    }
  }
};
const checkResetLayout = async (width, height) => {
  const reset = await page.locator("#reset-camera").boundingBox();
  const hint = await page.locator(".camera-hint").boundingBox();
  assert.ok(reset.height <= 34, "Reset Camera remains a slim utility button");
  assert.ok(
    reset.x >= width / 2 &&
      reset.y >= 0 &&
      reset.x + reset.width <= width &&
      reset.y + reset.height <= height,
    "Reset Camera fits the top-right area",
  );
  assert.ok(
    reset.y >= hint.y + hint.height + 8,
    "Reset Camera has at least 8px clearance below DRAG TO LOOK",
  );
  closeTo(reset.x + reset.width, hint.x + hint.width, 2);
  for (const selector of [
    ".topbar",
    "#sprint-button",
    "#dash-button",
    "#block-button",
    "#jump-button",
  ]) {
    const other = await page.locator(selector).boundingBox();
    assert.ok(
      reset.x + reset.width <= other.x ||
        other.x + other.width <= reset.x ||
        reset.y + reset.height <= other.y ||
        other.y + other.height <= reset.y,
      `Reset Camera does not overlap ${selector}`,
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

  await checkActionLayout(844, 390);
  await checkResetLayout(844, 390);
  assert.equal(initial.movementState, "locomotion");
  assert.equal(initial.dash.ready, true);
  assert.equal(await page.locator("#dash-cooldown").textContent(), "READY");
  const dashButton = await center("#dash-button");
  const firstDashPromise = observeDash(initial.dash.sequence);
  await page.touchscreen.tap(dashButton.x, dashButton.y);
  const firstDashSamples = (await firstDashPromise).filter(
    (sample) => sample.dash.sequence > initial.dash.sequence,
  );
  const firstDashEnd = firstDashSamples.at(-1);
  assert.equal(firstDashEnd.dash.sequence, initial.dash.sequence + 1);
  assert.ok(
    firstDashSamples.some(
      (sample) =>
        sample.movementState === "dash" &&
        sample.dash.distanceTravelled > 0 &&
        sample.dash.distanceTravelled < 2.45,
    ),
    "DASH visibly travels through intermediate world positions",
  );
  closeTo(firstDashEnd.dash.distanceTravelled, 2.5, 0.03);
  closeTo(
    Math.hypot(
      firstDashEnd.position[0] - initial.position[0],
      firstDashEnd.position[2] - initial.position[2],
    ),
    2.5,
    0.03,
  );
  assert.ok(firstDashEnd.position[2] < initial.position[2]);
  assert.equal(firstDashEnd.movementState, "locomotion");
  assert.equal(firstDashEnd.dash.active, false);
  assert.equal(firstDashEnd.dash.exitReason, "completed");
  assert.ok(
    firstDashSamples.some(
      (sample) =>
        sample.animation.dashWeight > 0 && sample.animation.dashWeight < 1,
    ),
    "DASH blends through intermediate animation poses",
  );
  for (const sample of firstDashSamples) {
    closeTo(sample.camera.pitch, initial.camera.pitch, 0.000001);
    closeTo(sample.camera.yaw, initial.camera.yaw, 0.000001);
    closeTo(sample.camera.distance, initial.camera.distance, 0.000001);
  }
  assert.ok(firstDashEnd.dash.cooldownRemaining > 0);
  // Native coordinates bypass aria-disabled actionability while cooling down,
  // as a real finger would. The movement state must reject this extra request.
  await page.touchscreen.tap(dashButton.x, dashButton.y);
  await page.evaluate(() => new Promise(requestAnimationFrame));
  assert.equal((await snapshot()).dash.sequence, initial.dash.sequence + 1);
  await wait(() => window.__KINETIC__.snapshot().dash.ready);
  const retryDashPromise = observeDash(initial.dash.sequence + 1);
  await page.touchscreen.tap(dashButton.x, dashButton.y);
  const retryDashEnd = (await retryDashPromise).at(-1);
  assert.equal(retryDashEnd.dash.sequence, initial.dash.sequence + 2);
  closeTo(retryDashEnd.dash.distanceTravelled, 2.5, 0.03);
  await wait(() => {
    const state = window.__KINETIC__.snapshot();
    return state.dash.ready && state.animation.dashWeight < 0.02;
  });
  console.log(
    "PASS: stationary DASH travels continuously for 2.5m, preserves camera angles, blends back and respects cooldown",
  );

  await page.reload({ waitUntil: "networkidle" });
  await wait(() => Boolean(window.__KINETIC__));
  assert.equal(
    await page.locator("#attack-button").count(),
    0,
    "Automatic combat has no visible Attack button",
  );
  assert.equal(
    await page.locator("#fight-button").count(),
    0,
    "Manual Fight toggle is removed",
  );
  assert.equal(
    await page.getByRole("button", { name: /^jump$/i }).count(),
    1,
    "Version 0.6 exposes one Jump action",
  );
  const beforeGuard = await snapshot();
  assert.equal(beforeGuard.input.blocking, false);
  await page.keyboard.down("q");
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
    "Block blends through intermediate guard poses",
  );
  assert.ok(guardWeights.at(-1) > 0.95, "Held Block reaches its target guard");
  const guarded = await snapshot();
  assert.equal(guarded.input.blocking, true);
  assert.deepEqual(
    guarded.position,
    beforeGuard.position,
    "Guard does not translate the actor",
  );
  closeTo(guarded.camera.pitch, initial.camera.pitch, 0.000001);
  closeTo(guarded.camera.yaw, initial.camera.yaw, 0.000001);
  closeTo(guarded.camera.distance, initial.camera.distance, 0.000001);
  await page.screenshot({ path: "test-results/guard.png" });
  await page.keyboard.up("q");
  await wait(
    () =>
      !window.__KINETIC__.snapshot().input.blocking &&
      window.__KINETIC__.snapshot().animation.combatWeight < 0.02,
  );
  console.log(
    "PASS: held Block smoothly raises and releases guard without moving the actor or camera",
  );

  await page.keyboard.down("w");
  await page.keyboard.down("Shift");
  await wait(() => window.__KINETIC__.snapshot().speed > 4.9);
  await page.keyboard.up("w");
  await page.keyboard.up("Shift");
  await wait(() => window.__KINETIC__.snapshot().speed < 0.01);
  assert.ok((await snapshot()).position[2] < -0.2);
  console.log("PASS: keyboard sprint accelerates and stops");

  await page.keyboard.down("d");
  await page.keyboard.down("Shift");
  await wait(() => window.__KINETIC__.snapshot().position[0] > 3);
  await page.keyboard.up("d");
  await page.keyboard.down("w");
  await wait(() => window.__KINETIC__.snapshot().position[2] < -17.63, 45000);
  const boundary = await snapshot();
  closeTo(boundary.position[2], -(boundary.halfSize - boundary.radius));
  await page.keyboard.down("d");
  await wait(() => window.__KINETIC__.snapshot().position[0] > 4.5);
  closeTo((await snapshot()).position[2], boundary.position[2]);
  await page.keyboard.up("w");
  await page.keyboard.up("d");
  await page.keyboard.up("Shift");
  await wait(() => window.__KINETIC__.snapshot().speed < 0.01);
  console.log(
    "PASS: sprint respects the arena boundary and slides along it while avoiding the dummy",
  );

  const wallBeforeJump = await snapshot();
  const wallJumpPromise = observeJump(wallBeforeJump.jump.sequence);
  await page.keyboard.down("w");
  await page.keyboard.press("Space");
  const wallJumpSamples = (await wallJumpPromise).filter(
    (sample) => sample.jump.sequence > wallBeforeJump.jump.sequence,
  );
  await page.keyboard.up("w");
  assert.ok(wallJumpSamples.some((sample) => sample.jump.height > 0.3));
  for (const sample of wallJumpSamples) {
    closeTo(sample.position[2], wallBeforeJump.position[2], 0.002);
    assert.ok(
      Math.abs(sample.position[0]) <= sample.halfSize - sample.radius + 0.001,
    );
    assert.ok(sample.position[1] >= 0 && sample.camera.position[1] >= 0.3);
  }
  console.log(
    "PASS: jumping while pushing an arena wall remains inside the boundary and above the floor",
  );

  // Native events and fixed virtual frames keep brief punches and dashes
  // deterministic even with software-rendered Chromium on a busy CI machine.
  await page.clock.install();
  await page.reload({ waitUntil: "networkidle" });
  await wait(() => Boolean(window.__KINETIC__));
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
  const session = await page.context().newCDPSession(page);
  const touch = (id, point) => ({
    id,
    ...point,
    radiusX: 7,
    radiusY: 7,
    force: 1,
  });
  const native = async (type, points, changed = points) => {
    const pointerType = {
      touchStart: "pointerdown",
      touchMove: "pointermove",
      touchEnd: "pointerup",
      touchCancel: "pointercancel",
    }[type];
    if (changed.length)
      await page.evaluate(
        ({ pointerType, expected }) => {
          window.__nativeActionEvent = new Promise((resolve) => {
            const pending = [...expected];
            const delivered = (event) => {
              const index = pending.findIndex(
                (point) =>
                  Math.abs(point.x - event.clientX) < 1 &&
                  Math.abs(point.y - event.clientY) < 1,
              );
              if (index >= 0) pending.splice(index, 1);
              if (pending.length) return;
              document.removeEventListener(pointerType, delivered, true);
              resolve();
            };
            document.addEventListener(pointerType, delivered, true);
          });
        },
        { pointerType, expected: changed },
      );
    await session.send("Input.dispatchTouchEvent", {
      type,
      touchPoints: points,
    });
    if (!changed.length) return;
    let timer;
    try {
      await Promise.race([
        page.evaluate(() => window.__nativeActionEvent),
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`Native ${type} was not delivered`)),
            10000,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  };
  const joy = await center("#joystick");
  const sprint = await center("#sprint-button");
  const dash = await center("#dash-button");
  const block = await center("#block-button");
  const jump = await center("#jump-button");
  const reset = await center("#reset-camera");
  const camera = { x: 550, y: 165 };
  const gap = { x: 420, y: 220 };
  const step = async (milliseconds = 34) => {
    await page.clock.runFor(milliseconds);
    return snapshot();
  };

  // The extensible manual request remains available through F for regression
  // coverage, but no visible Attack control is rendered or registered.
  const beforeAttack = await snapshot();
  await page.keyboard.down("f");
  let state = await step();
  assert.equal(
    state.combat.attack.sequence,
    beforeAttack.combat.attack.sequence + 1,
  );
  assert.equal(state.combat.attack.active, true);
  assert.ok(
    state.animation.attackWeight > 0,
    "Punch begins through an intermediate pose",
  );
  await step(800);
  state = await snapshot();
  assert.equal(
    state.combat.attack.sequence,
    beforeAttack.combat.attack.sequence + 1,
    "Held F does not repeatedly request manual punches",
  );
  assert.equal(state.combat.ready, true);
  await page.keyboard.up("f");
  await page.keyboard.press("f");
  state = await step(100);
  const secondSequence = state.combat.attack.sequence;
  assert.equal(secondSequence, beforeAttack.combat.attack.sequence + 2);
  await page.keyboard.press("f");
  assert.equal(
    (await step()).combat.attack.sequence,
    secondSequence,
    "Recovery rejects another manual request",
  );
  state = await step(850);
  assert.equal(
    state.combat.attack.sequence,
    secondSequence,
    "Rejected manual request never queues an attack",
  );
  assert.ok(
    state.animation.combatWeight < 0.03,
    "Automatic posture blends back outside proximity",
  );
  assert.ok(
    state.animation.attackWeight < 0.03,
    "Punch naturally recovers its arm pose",
  );
  console.log(
    "PASS: reusable manual punch request, recovery and no held/rejected-repeat remain intact without an Attack button",
  );

  // Slow analog walk, full normal movement and sprint retain their speed while
  // attacking. The combat animation never controls the actor's root motion.
  const joystickBox = await page.locator("#joystick").boundingBox();
  const radius = Math.min(joystickBox.width, joystickBox.height) * 0.34;
  for (const [name, fraction, sprinting] of [
    ["slow walk", 0.45, false],
    ["run", 1, false],
    ["sprint", 1, true],
  ]) {
    const movingFinger = touch(10, { x: joy.x + radius * fraction, y: joy.y });
    await native("touchStart", [movingFinger]);
    if (sprinting) await page.keyboard.down("Shift");
    const moving = await step(650);
    assert.ok(
      moving.speed > (sprinting ? 4.9 : fraction === 1 ? 2.4 : 0.8),
      `${name} accelerates to its existing speed`,
    );
    await page.keyboard.press("f");
    const punching = await step(180);
    assert.equal(punching.combat.attack.active, true, `${name} can punch`);
    assert.ok(
      punching.speed >= moving.speed * 0.98,
      `${name} does not freeze or slow during a punch`,
    );
    assert.ok(
      Math.hypot(
        punching.position[0] - moving.position[0],
        punching.position[2] - moving.position[2],
      ) >
        moving.speed * 0.12,
      `${name} continues translating during the punch`,
    );
    await step(550);
    await native("touchEnd", [movingFinger]);
    if (sprinting) await page.keyboard.up("Shift");
    await step(500);
  }
  console.log(
    "PASS: attacks preserve slow walking, running and sprinting speeds and continuous movement",
  );

  await page.reload({ waitUntil: "networkidle" });
  await step(500);
  let fingers = [touch(1, joy), touch(2, camera), touch(3, sprint)];
  await native("touchStart", fingers);
  fingers = [
    touch(1, { x: joy.x + 32, y: joy.y + 6 }),
    touch(2, { x: camera.x + 80, y: camera.y + 25 }),
    fingers[2],
  ];
  await native("touchMove", fingers, fingers.slice(0, 2));
  const multi = await step(400);
  assert.ok(
    multi.input.move.x > 0.5 &&
      multi.input.sprinting &&
      Math.abs(multi.camera.yaw) > 0.2,
  );
  assert.equal(
    new Set([
      multi.input.joystickPointer,
      multi.input.cameraPointer,
      multi.input.sprintPointer,
    ]).size,
    3,
  );
  for (const owner of ["joystickPointer", "cameraPointer", "sprintPointer"])
    assert.notEqual(multi.input[owner], null);
  await page.keyboard.press("f");
  const attackingMulti = await step(100);
  assert.equal(attackingMulti.combat.attack.active, true);
  assert.ok(
    attackingMulti.speed > 3.3,
    "Manual punch preserves simultaneous sprinting joystick motion",
  );
  for (const owner of ["joystickPointer", "cameraPointer", "sprintPointer"])
    assert.equal(attackingMulti.input[owner], multi.input[owner]);
  assert.deepEqual(attackingMulti.input.move, multi.input.move);
  closeTo(attackingMulti.camera.targetYaw, multi.camera.targetYaw, 0.000001);
  await page.screenshot({ path: "test-results/multitouch.png" });
  await step(600);

  const blockFinger = touch(8, block);
  await native("touchStart", [...fingers, blockFinger], [blockFinger]);
  let blockingMulti = await step(400);
  assert.equal(blockingMulti.input.blocking, true);
  assert.ok(blockingMulti.animation.combatWeight > 0.95);
  assert.ok(
    blockingMulti.speed > 3.3,
    "Holding Block preserves movement speed",
  );
  assert.equal(
    await page.locator("#block-button").getAttribute("aria-pressed"),
    "true",
  );
  const blockedSequence = blockingMulti.combat.attack.sequence;
  await page.keyboard.press("f");
  assert.equal(
    (await step()).combat.attack.sequence,
    blockedSequence,
    "Holding Block rejects attacks",
  );

  // Dash continues to steer with native joystick input while a fourth finger
  // holds Block. Combat upper-body poses cannot steal movement/camera ownership.
  const beforeDashTouch = await snapshot();
  const dashFinger = touch(7, dash);
  const dashSamplesPromise = observeDash(beforeDashTouch.dash.sequence);
  await native(
    "touchStart",
    [...fingers, blockFinger, dashFinger],
    [dashFinger],
  );
  const startedDash = (await step()).dash;
  assert.equal(startedDash.active, true);
  fingers[0] = touch(1, { x: joy.x - 32, y: joy.y - 6 });
  await native(
    "touchMove",
    [...fingers, blockFinger, dashFinger],
    [fingers[0]],
  );
  await step(300);
  const dashSamples = (await dashSamplesPromise).filter(
    (sample) => sample.dash.sequence > beforeDashTouch.dash.sequence,
  );
  await native("touchEnd", [dashFinger]);
  assert.equal(
    dashSamples.at(-1).dash.sequence,
    beforeDashTouch.dash.sequence + 1,
  );
  for (const sample of dashSamples) {
    assert.equal(sample.input.blocking, true);
    assert.equal(sample.input.sprinting, true);
    for (const owner of ["joystickPointer", "cameraPointer", "sprintPointer"])
      assert.equal(sample.input[owner], beforeDashTouch.input[owner]);
    closeTo(
      sample.camera.targetYaw,
      beforeDashTouch.camera.targetYaw,
      0.000001,
    );
  }
  for (let index = 1; index < dashSamples.length; index++) {
    const previous = dashSamples[index - 1].dash;
    const current = dashSamples[index].dash;
    const dot =
      previous.direction[0] * current.direction[0] +
      previous.direction[2] * current.direction[2];
    assert.ok(
      Math.acos(Math.max(-1, Math.min(1, dot))) <=
        9 * (current.elapsed - previous.elapsed + 1 / 120) + 0.02,
      "Dash steering retains bounded momentum while blocking",
    );
  }
  assert.ok(
    dashSamples.some(
      (sample) => sample.input.move.x < -0.5 && sample.dash.active,
    ),
    "Opposing joystick input arrives during the dash",
  );
  const finalDirection = dashSamples.at(-1).dash.direction;
  assert.ok(
    startedDash.direction[0] * finalDirection[0] +
      startedDash.direction[2] * finalDirection[2] <
      0.999,
    "Dash responds to the new joystick direction",
  );
  await native("touchEnd", [blockFinger]);
  assert.equal((await step()).input.blocking, false);
  await native("touchEnd", [fingers[0]]);
  const releasedJoystick = await step();
  assert.equal(releasedJoystick.input.joystickPointer, null);
  closeTo(releasedJoystick.input.move.x, 0);
  assert.ok(
    releasedJoystick.input.cameraPointer !== null &&
      releasedJoystick.input.sprinting,
  );
  await native("touchCancel", [], []);
  const released = await step(400);
  assert.equal(released.input.cameraPointer, null);
  assert.equal(released.input.sprinting, false);
  assert.equal(released.input.blocking, false);
  assert.equal(await page.evaluate(() => window.scrollY), 0);
  console.log(
    "PASS: independent movement, look, sprint, punch and Block touches; dash steering and cancellation remain intact",
  );

  await step(500);
  let burstJoystick = touch(9, { x: joy.x + 32, y: joy.y });
  await native("touchStart", [burstJoystick]);
  await step(200);
  await page.keyboard.press("f");
  await page.keyboard.press("e");
  const punchingDash = await step();
  assert.equal(
    punchingDash.dash.active,
    true,
    "Dash remains available with an active punch",
  );
  assert.equal(
    punchingDash.combat.attack.active,
    true,
    "Punch animation continues during the dash",
  );
  burstJoystick = touch(9, { x: joy.x - 32, y: joy.y });
  await native("touchMove", [burstJoystick]);
  const steeredPunchDash = await step(100);
  assert.equal(steeredPunchDash.dash.active, true);
  assert.equal(steeredPunchDash.combat.attack.active, true);
  const punchDashDot =
    punchingDash.dash.direction[0] * steeredPunchDash.dash.direction[0] +
    punchingDash.dash.direction[2] * steeredPunchDash.dash.direction[2];
  assert.ok(
    punchDashDot < 0.999,
    "Joystick steering still redirects a dash while punching",
  );
  assert.ok(
    Math.acos(Math.max(-1, Math.min(1, punchDashDot))) <=
      9 *
        (steeredPunchDash.dash.elapsed - punchingDash.dash.elapsed + 1 / 120) +
        0.02,
    "Punching does not change dash steering limits",
  );
  await native("touchEnd", [burstJoystick]);
  await step(750);
  console.log(
    "PASS: punch and dash remain independent while native joystick steering redirects the burst",
  );

  // One action pointer never lifts while crossing Sprint, Dash and Block.
  let slider = touch(41, sprint);
  const slideTo = async (point, duration = 34) => {
    slider = touch(41, point);
    await native("touchMove", [slider]);
    return step(duration);
  };
  await native("touchStart", [slider]);
  assert.equal((await step()).input.sprinting, true);
  const slideSequence = (await snapshot()).dash.sequence;
  let slid = await slideTo(dash);
  assert.equal(slid.input.sprinting, false, "Leaving Sprint releases HOLD");
  assert.equal(
    slid.dash.sequence,
    slideSequence + 1,
    "Entering Dash presses once",
  );
  slid = await step(850);
  assert.equal(slid.dash.ready, true);
  assert.equal(
    slid.dash.sequence,
    slideSequence + 1,
    "Holding Dash does not repeat after cooldown",
  );
  assert.equal(
    (await slideTo(sprint)).input.sprinting,
    true,
    "Sliding back resumes Sprint",
  );
  assert.equal(
    (await slideTo(dash)).dash.sequence,
    slideSequence + 2,
    "Re-entering Dash triggers after cooldown",
  );
  slid = await slideTo(block, 350);
  assert.equal(slid.input.blocking, true, "Sliding onto Block holds defence");
  assert.ok(slid.animation.combatWeight > 0.95);
  slid = await slideTo(gap);
  assert.equal(
    slid.input.blocking,
    false,
    "Leaving Block releases HOLD immediately",
  );
  assert.equal(
    slid.input.cameraPointer,
    null,
    "Action ownership survives gaps without becoming camera input",
  );
  await slideTo(sprint);
  assert.equal(
    (await snapshot()).input.sprinting,
    true,
    "Block to Sprint resumes sprinting without lifting",
  );
  slid = await slideTo(block);
  assert.equal(slid.input.sprinting, false);
  assert.equal(
    slid.input.blocking,
    true,
    "Re-entering Block holds defence again",
  );
  slid = await slideTo(gap, 750);
  assert.equal(slid.input.blocking, false);
  const cameraBeforeUtilityCrossing = slid.camera;
  const utilitySequence = slid.combat.attack.sequence;
  await slideTo(reset);
  await native("touchEnd", [slider]);
  const afterUtilityCrossing = await step();
  closeTo(
    afterUtilityCrossing.camera.targetYaw,
    cameraBeforeUtilityCrossing.targetYaw,
    0.000001,
  );
  closeTo(
    afterUtilityCrossing.camera.targetPitch,
    cameraBeforeUtilityCrossing.targetPitch,
    0.000001,
  );
  assert.equal(
    afterUtilityCrossing.combat.attack.sequence,
    utilitySequence,
    "Release and synthetic click do not duplicate a punch",
  );
  assert.equal(afterUtilityCrossing.input.sprinting, false);

  // Reference-counted HOLD works for Block too, including keyboard and touch.
  let sharedBlock = [
    touch(42, block),
    touch(43, block),
    touch(46, joy),
    touch(47, camera),
  ];
  await native("touchStart", sharedBlock);
  const sharedOwners = (await step()).input;
  sharedBlock[0] = touch(42, gap);
  await native("touchMove", sharedBlock, [sharedBlock[0]]);
  assert.equal(
    (await step()).input.blocking,
    true,
    "Second finger keeps Block held",
  );
  await page.keyboard.down("q");
  await native("touchEnd", [sharedBlock[1]]);
  assert.equal(
    (await step()).input.blocking,
    true,
    "Keyboard keeps Block held after the last action finger leaves",
  );
  await page.keyboard.up("q");
  const lastBlockRelease = await step();
  assert.equal(
    lastBlockRelease.input.blocking,
    false,
    "Final holder releases Block",
  );
  assert.equal(
    lastBlockRelease.input.joystickPointer,
    sharedOwners.joystickPointer,
  );
  assert.equal(
    lastBlockRelease.input.cameraPointer,
    sharedOwners.cameraPointer,
  );
  await native("touchCancel", [], []);
  await step();

  // Camera/joystick drags keep their roles even when crossing action buttons.
  const crossingSequence = (await snapshot()).dash.sequence;
  const crossingAttackSequence = (await snapshot()).combat.attack.sequence;
  let crossing = [touch(44, joy), touch(45, camera)];
  await native("touchStart", crossing);
  const crossingOwners = (await step()).input;
  crossing = [touch(44, sprint), touch(45, block)];
  await native("touchMove", crossing);
  let crossingState = await step();
  assert.equal(crossingState.input.sprinting, false);
  assert.equal(crossingState.input.blocking, false);
  assert.equal(
    crossingState.combat.attack.sequence,
    crossingAttackSequence,
    "Camera drag crossing Block cannot activate a punch",
  );
  assert.equal(
    crossingState.input.joystickPointer,
    crossingOwners.joystickPointer,
  );
  assert.equal(crossingState.input.cameraPointer, crossingOwners.cameraPointer);
  crossing[1] = touch(45, dash);
  await native("touchMove", crossing, [crossing[1]]);
  assert.equal(
    (await step()).dash.sequence,
    crossingSequence,
    "Camera drag crossing Dash cannot activate it",
  );
  crossing[1] = touch(45, block);
  await native("touchMove", crossing, [crossing[1]]);
  assert.equal(
    (await step()).input.blocking,
    false,
    "Camera drag crossing Block cannot hold it",
  );
  await native("touchCancel", [], []);
  crossingState = await step();
  for (const owner of [
    "joystickPointer",
    "cameraPointer",
    "sprintPointer",
    "attackPointer",
    "blockPointer",
    "jumpPointer",
  ])
    assert.equal(crossingState.input[owner], null);
  assert.equal(crossingState.input.sprinting, false);
  assert.equal(crossingState.input.blocking, false);
  await page.clock.resume();
  console.log(
    "PASS: native slide Sprint/Dash/Block entry, shared HOLD, role isolation and cancellation",
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
  await wait(() => !window.__KINETIC__.snapshot().paused);
  assert.equal((await snapshot()).paused, false);
  console.log("PASS: instructions pause movement and close cleanly");

  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
  const freshScene = async () => {
    await page.reload({ waitUntil: "networkidle" });
    await step(500);
  };
  const advanceUntil = async (predicate, limit = 3000, quantum = 34) => {
    for (let time = 0; time <= limit; time += quantum) {
      const sample = await snapshot();
      if (predicate(sample)) return sample;
      await step(quantum);
    }
    throw new Error(
      "Native movement did not reach its expected proximity state",
    );
  };
  // Place the actor using a proportional native joystick, with no position
  // mutation hook. Low-speed settling leaves margin around the hysteresis band.
  const walkTo = async (target) => {
    let driver = touch(90, joy);
    await native("touchStart", [driver]);
    let settled = false;
    for (let index = 0; index < 120; index++) {
      const sample = await snapshot();
      const dx = target.x - sample.position[0];
      const dz = target.z - sample.position[2];
      const distance = Math.hypot(dx, dz);
      if (distance < 0.02 && sample.speed < 0.08) {
        settled = true;
        break;
      }
      const magnitude = Math.min(1, distance);
      const fraction = distance < 0.003 ? 0 : 0.1 + magnitude * 0.9;
      const cos = Math.cos(sample.camera.yaw),
        sin = Math.sin(sample.camera.yaw);
      const divisor = distance || 1;
      const nextDriver = touch(90, {
        x: joy.x + ((dx * cos - dz * sin) / divisor) * radius * fraction,
        y: joy.y - ((-dx * sin - dz * cos) / divisor) * radius * fraction,
      });
      if (Math.hypot(nextDriver.x - driver.x, nextDriver.y - driver.y) > 0.01) {
        driver = nextDriver;
        await native("touchMove", [driver]);
      }
      await step(100);
    }
    await native("touchEnd", [driver]);
    const result = await step(300);
    assert.ok(settled, "Native joystick settles near its requested test point");
    assert.ok(
      Math.hypot(result.position[0] - target.x, result.position[2] - target.z) <
        0.04,
    );
    return result;
  };
  await freshScene();
  const approachStart = await snapshot();
  const dummyX = approachStart.dummy.position[0];
  const dummyZ = approachStart.dummy.position[2];
  await walkTo({ x: dummyX, z: 0 });
  assert.equal(approachStart.proximity.targetId, null);
  await page.keyboard.down("w");
  const entered = await advanceUntil(
    (sample) => sample.proximity.targetId !== null,
  );
  assert.ok(
    entered.proximity.distance <= entered.proximity.entryDistance + 0.001,
  );
  const movingAuto = await advanceUntil(
    (sample) => sample.combat.attack.active && sample.speed > 0.1,
  );
  assert.equal(movingAuto.combat.attack.techniqueId, "basic-punch");
  await step(500);
  await page.keyboard.up("w");
  const atDummy = await step(350);
  const separation = Math.hypot(
    atDummy.position[0] - atDummy.dummy.position[0],
    atDummy.position[2] - atDummy.dummy.position[2],
  );
  closeTo(separation, atDummy.radius + atDummy.dummy.radius, 0.01);
  const repeatStart = atDummy.combat.attack.sequence;
  const repeated = await step(1400);
  assert.ok(
    repeated.combat.attack.sequence >= repeatStart + 2,
    "Standing in range repeats only recovered basic punches",
  );
  assert.deepEqual(
    repeated.position,
    atDummy.position,
    "Automatic punches never push or translate the actor",
  );
  assert.deepEqual(
    repeated.dummy.position,
    approachStart.dummy.position,
    "The training dummy stays stationary",
  );
  closeTo(repeated.camera.yaw, approachStart.camera.yaw, 0.000001);
  closeTo(repeated.camera.pitch, approachStart.camera.pitch, 0.000001);
  await page.screenshot({ path: "test-results/proximity-combat.png" });

  const heldBlock = touch(80, block);
  await native("touchStart", [heldBlock]);
  const blockStart = await step();
  const blockedAuto = await step(1100);
  assert.equal(blockedAuto.input.blocking, true);
  assert.equal(
    blockedAuto.combat.attack.sequence,
    blockStart.combat.attack.sequence,
    "Held Block suppresses automatic attacks",
  );
  assert.equal(blockedAuto.combat.attack.active, false);
  assert.ok(blockedAuto.animation.combatWeight > 0.95);
  await native("touchEnd", [heldBlock]);
  const resumed = await step();
  assert.equal(resumed.input.blocking, false);
  assert.equal(
    resumed.combat.attack.sequence,
    blockStart.combat.attack.sequence + 1,
    "Releasing Block resumes an eligible automatic punch",
  );
  await page.keyboard.down("s");
  await page.keyboard.down("Shift");
  const leftRange = await advanceUntil(
    (sample) => sample.proximity.targetId === null,
  );
  const leaveSequence = leftRange.combat.attack.sequence;
  await page.keyboard.up("s");
  await page.keyboard.up("Shift");
  const recoveredOutside = await step(1100);
  assert.equal(
    recoveredOutside.combat.attack.sequence,
    leaveSequence,
    "Leaving range never queues another punch",
  );
  assert.equal(
    recoveredOutside.combat.attack.active,
    false,
    "A started punch recovers naturally after leaving range",
  );
  console.log(
    "PASS: native approach triggers moving and stationary automatic punches; dummy collision, held Block, release and leaving range are stable",
  );

  await freshScene();
  await walkTo({ x: dummyX, z: 0 });
  await page.keyboard.down("w");
  await page.keyboard.down("Shift");
  const sprintingAuto = await advanceUntil(
    (sample) =>
      sample.combat.attack.active && sample.proximity.targetId !== null,
    2000,
    17,
  );
  assert.ok(
    sprintingAuto.speed > 4.5,
    "Automatic punches do not stop an approaching sprint",
  );
  assert.equal(sprintingAuto.input.sprinting, true);
  await page.keyboard.up("w");
  await page.keyboard.up("Shift");
  await step(500);

  await freshScene();
  await walkTo({ x: dummyX, z: dummyZ + 2 });
  await page.keyboard.down("w");
  await step();
  await page.keyboard.press("e");
  const dashingAuto = await advanceUntil(
    (sample) => sample.dash.active && sample.combat.attack.active,
    500,
    17,
  );
  assert.equal(
    dashingAuto.proximity.targetId,
    dashingAuto.dummy.id,
    "A dash can trigger the existing automatic punch without a special dash strike",
  );
  const dummyDashSamples = [dashingAuto];
  for (
    let index = 0;
    index < 40 && dummyDashSamples.at(-1).dash.active;
    index++
  )
    dummyDashSamples.push(await step(17));
  await page.keyboard.up("w");
  await step(500);
  for (const sample of dummyDashSamples)
    assert.ok(
      Math.hypot(
        sample.position[0] - sample.dummy.position[0],
        sample.position[2] - sample.dummy.position[2],
      ) >=
        sample.radius + sample.dummy.radius - 0.002,
      "Continuous dash collision never enters the dummy",
    );
  assert.equal(dummyDashSamples.at(-1).dash.active, false);
  console.log(
    "PASS: proximity punches work during sprint and dash while preserving continuous dummy collision",
  );

  await freshScene();
  const outsideEntry = await walkTo({ x: dummyX, z: dummyZ + 1.06 });
  assert.equal(
    outsideEntry.proximity.targetId,
    null,
    "Outside the 1m entry radius does not acquire the dummy",
  );
  assert.equal(outsideEntry.combat.attack.sequence, 0);
  const insideEntry = await walkTo({ x: dummyX, z: dummyZ + 0.92 });
  assert.notEqual(insideEntry.proximity.targetId, null);
  const insideExit = await walkTo({ x: dummyX, z: dummyZ + 1.06 });
  assert.notEqual(
    insideExit.proximity.targetId,
    null,
    "An acquired target is retained inside the 1.15m exit band",
  );
  const outsideExit = await walkTo({ x: dummyX, z: dummyZ + 1.28 });
  assert.equal(
    outsideExit.proximity.targetId,
    null,
    "Passing the exit radius clears the target",
  );
  const returnedBand = await walkTo({ x: dummyX, z: dummyZ + 1.06 });
  assert.equal(
    returnedBand.proximity.targetId,
    null,
    "Returning only to the hysteresis band cannot reacquire the target",
  );
  console.log(
    "PASS: native joystick entry/exit hysteresis prevents proximity flicker without teleporting the actor",
  );

  await freshScene();
  await walkTo({ x: dummyX + 0.9, z: 0 });
  await page.keyboard.down("w");
  const sideEntry = await advanceUntil(
    (sample) => sample.proximity.targetId !== null,
  );
  assert.equal(
    sideEntry.proximity.aligned,
    false,
    "A side-on target is not instantly treated as aligned",
  );
  assert.equal(
    sideEntry.combat.attack.sequence,
    0,
    "Automatic punch waits for the body to face the target",
  );
  await page.keyboard.up("w");
  const facingSamples = [];
  let firstAlignedAttack;
  for (let index = 0; index < 120; index++) {
    const sample = await step(17);
    facingSamples.push(sample);
    if (sample.combat.attack.sequence > 0) {
      firstAlignedAttack = sample;
      break;
    }
  }
  assert.ok(
    firstAlignedAttack,
    "Smooth body facing eventually permits the basic punch",
  );
  assert.equal(firstAlignedAttack.proximity.aligned, true);
  assert.ok(
    facingSamples.some(
      (sample) =>
        sample.heading > sideEntry.heading &&
        sample.heading < firstAlignedAttack.heading,
    ),
    "Body facing passes through intermediate angles",
  );
  for (const sample of facingSamples) {
    closeTo(sample.camera.yaw, sideEntry.camera.yaw, 0.000001);
    closeTo(sample.camera.pitch, sideEntry.camera.pitch, 0.000001);
  }
  console.log(
    "PASS: automatic body facing is gradual, gates punches until aligned and never rotates the camera",
  );
  // Read-only snapshots measure real controller movement; all jump requests
  // below enter through native action pointers or the unchanged keyboard path.
  const collectJump = async (sequence, onSample = async () => {}) => {
    const samples = [];
    for (let index = 0; index < 150; index++) {
      const sample = await step(17);
      samples.push(sample);
      await onSample(sample);
      if (sample.jump.sequence > sequence && sample.jump.phase === "grounded")
        return samples;
    }
    throw new Error("Jump did not complete within fixed browser frames");
  };
  await freshScene();
  const idleJumpStart = await snapshot();
  const heldJumpFinger = touch(101, jump);
  await native("touchStart", [heldJumpFinger]);
  let airRequestsSent = false;
  let landingRequestsSent = false;
  await page.keyboard.press("e");
  await page.keyboard.press("Space");
  const idleJumpSamples = await collectJump(
    idleJumpStart.jump.sequence,
    async (sample) => {
      if (!airRequestsSent && sample.jump.height > 0.15) {
        airRequestsSent = true;
        await page.keyboard.press("Space");
        await page.keyboard.press("e");
        await page.keyboard.press("f");
      }
      if (!landingRequestsSent && sample.jump.phase === "landing") {
        landingRequestsSent = true;
        await page.keyboard.press("Space");
        await page.keyboard.press("e");
      }
    },
  );
  assert.ok(idleJumpSamples.some((sample) => sample.jump.phase === "takeoff"));
  assert.ok(idleJumpSamples.some((sample) => sample.jump.phase === "landing"));
  assert.ok(
    airRequestsSent && landingRequestsSent,
    "Repeated requests exercise airborne and landing phases",
  );
  closeTo(
    Math.max(...idleJumpSamples.map((sample) => sample.jump.height)),
    idleJumpStart.jump.config.height,
    0.035,
  );
  assert.ok(idleJumpSamples.some((sample) => sample.jump.verticalVelocity > 1));
  assert.ok(
    idleJumpSamples.some((sample) => sample.jump.verticalVelocity < -1),
  );
  assert.ok(
    idleJumpSamples.some(
      (sample) =>
        sample.animation.jumpWeight > 0 && sample.animation.jumpWeight < 1,
    ),
    "Jump animation blends through intermediate poses",
  );
  for (let index = 0; index < idleJumpSamples.length; index++) {
    const sample = idleJumpSamples[index];
    assert.equal(
      sample.jump.sequence,
      idleJumpStart.jump.sequence + 1,
      "Repeated entries cannot double jump",
    );
    assert.equal(
      sample.dash.sequence,
      idleJumpStart.dash.sequence,
      "Dash is rejected throughout takeoff, flight and landing",
    );
    closeTo(sample.dash.cooldownRemaining, 0, 0.000001);
    closeTo(sample.position[0], idleJumpStart.position[0], 0.000001);
    closeTo(sample.position[2], idleJumpStart.position[2], 0.000001);
    closeTo(sample.position[1], sample.jump.height, 0.000001);
    closeTo(sample.camera.yaw, idleJumpStart.camera.yaw, 0.000001);
    closeTo(sample.camera.pitch, idleJumpStart.camera.pitch, 0.000001);
    closeTo(sample.camera.distance, idleJumpStart.camera.distance, 0.000001);
    assert.ok(sample.position[1] >= 0 && sample.camera.position[1] >= 0.3);
    assert.equal(
      sample.combat.attack.sequence,
      idleJumpStart.combat.attack.sequence,
      "No manual punch starts while jumping",
    );
    if (index > 0)
      assert.ok(
        Math.abs(sample.position[1] - idleJumpSamples[index - 1].position[1]) <
          0.21,
        "Vertical movement remains continuous between frames",
      );
  }
  assert.ok(
    idleJumpSamples.some(
      (sample) =>
        sample.camera.position[1] > idleJumpStart.camera.position[1] + 0.3,
    ),
    "The existing follow camera naturally follows root height",
  );
  const heldAfterLanding = await step(800);
  assert.equal(
    heldAfterLanding.jump.sequence,
    idleJumpStart.jump.sequence + 1,
    "Holding Jump through landing never repeats PRESS",
  );
  assert.equal(
    heldAfterLanding.dash.sequence,
    idleJumpStart.dash.sequence,
    "Rejected Dash input is never queued after landing",
  );
  assert.equal(
    heldAfterLanding.combat.attack.sequence,
    idleJumpStart.combat.attack.sequence,
    "Rejected airborne attack input is never queued",
  );
  await native("touchEnd", [heldJumpFinger]);
  await step();
  console.log(
    "PASS: continuous configured-height ballistic jump, animation blending, camera invariants, no double jump, no held repeat and rejected airborne actions",
  );

  for (const sprinting of [false, true]) {
    await freshScene();
    await page.keyboard.down("d");
    if (sprinting) await page.keyboard.down("Shift");
    const moving = await step(650);
    await page.keyboard.press("Space");
    const launched = await step(120);
    assert.ok(launched.jump.airborne);
    assert.ok(
      launched.velocity[0] >= moving.velocity[0] * 0.94,
      "Walking/sprinting momentum carries through takeoff",
    );
    assert.ok(launched.position[0] - moving.position[0] > moving.speed * 0.08);
    await page.keyboard.up("d");
    if (sprinting) await page.keyboard.up("Shift");
    const coasting = await step(100);
    assert.ok(
      coasting.velocity[0] >= launched.velocity[0] * 0.94,
      "Releasing the stick in flight preserves momentum with light air drag",
    );
    await step(1000);
    assert.equal((await snapshot()).jump.phase, "grounded");
  }
  await freshScene();
  await page.keyboard.down("d");
  await page.keyboard.down("Shift");
  await step(650);
  await page.keyboard.press("Space");
  const beforeAirTurn = await step(120);
  await page.keyboard.up("d");
  await page.keyboard.down("a");
  const firstAirTurn = await step(17);
  assert.ok(
    firstAirTurn.velocity[0] > 0,
    "Opposing air input cannot reverse momentum instantly",
  );
  const steeredAir = await step(250);
  assert.ok(
    steeredAir.jump.airborne && steeredAir.velocity[0] < 0,
    "Sustained air input redirects the jump responsively",
  );
  assert.ok(firstAirTurn.velocity[0] < beforeAirTurn.velocity[0]);
  await page.keyboard.up("a");
  await page.keyboard.up("Shift");
  await step(1000);
  console.log(
    "PASS: walk/sprint jump momentum, light airborne drag and gradual joystick-direction reversal",
  );

  await freshScene();
  await page.keyboard.press("Space");
  await page.keyboard.press("e");
  const jumpWon = await step();
  assert.equal(jumpWon.jump.sequence, 1);
  assert.equal(
    jumpWon.dash.sequence,
    0,
    "The first pending mobility request wins",
  );
  await step(1100);
  assert.equal((await snapshot()).dash.sequence, 0);
  await freshScene();
  await page.keyboard.press("e");
  await page.keyboard.press("Space");
  const dashWon = await step();
  assert.equal(dashWon.dash.active, true);
  assert.equal(
    dashWon.jump.sequence,
    0,
    "An accepted Dash rejects a later pending Jump",
  );
  await step(1000);
  assert.equal(
    (await snapshot()).jump.sequence,
    0,
    "Rejected Jump never starts after Dash",
  );

  await freshScene();
  const lookStart = { x: 550, y: 165 };
  let jumpFingers = [
    touch(111, joy),
    touch(112, lookStart),
    touch(113, sprint),
  ];
  await native("touchStart", jumpFingers);
  jumpFingers = [
    touch(111, { x: joy.x + 32, y: joy.y }),
    touch(112, { x: lookStart.x + 65, y: lookStart.y + 20 }),
    jumpFingers[2],
  ];
  await native("touchMove", jumpFingers, jumpFingers.slice(0, 2));
  const jumpOwners = await step(350);
  jumpFingers[2] = touch(113, jump);
  await native("touchMove", jumpFingers, [jumpFingers[2]]);
  const slidJump = await step();
  assert.equal(
    slidJump.input.sprinting,
    false,
    "Sprint releases before sliding onto Jump",
  );
  assert.equal(
    slidJump.jump.sequence,
    1,
    "Sliding onto Jump triggers PRESS without lifting",
  );
  for (const owner of ["joystickPointer", "cameraPointer"])
    assert.equal(slidJump.input[owner], jumpOwners.input[owner]);
  assert.notEqual(slidJump.input.jumpPointer, null);
  await step(120);
  jumpFingers[1] = touch(112, {
    x: lookStart.x + 90,
    y: lookStart.y + 10,
  });
  await native("touchMove", jumpFingers, [jumpFingers[1]]);
  const airborneLook = await step(17);
  assert.ok(airborneLook.jump.airborne);
  assert.notEqual(airborneLook.camera.targetYaw, slidJump.camera.targetYaw);
  assert.equal(
    airborneLook.input.joystickPointer,
    jumpOwners.input.joystickPointer,
    "An airborne camera drag preserves the joystick owner",
  );
  jumpFingers[2] = touch(113, block);
  await native("touchMove", jumpFingers, [jumpFingers[2]]);
  const airBlock = await step();
  assert.equal(
    airBlock.input.blocking,
    true,
    "Sliding Jump to Block immediately holds guard in flight",
  );
  assert.ok(airBlock.jump.airborne);
  const beforeRejectedDash = airBlock.dash;
  jumpFingers[2] = touch(113, dash);
  await native("touchMove", jumpFingers, [jumpFingers[2]]);
  const rejectedDash = await step();
  assert.equal(
    rejectedDash.input.blocking,
    false,
    "Leaving Block releases guard in flight",
  );
  assert.equal(rejectedDash.dash.sequence, beforeRejectedDash.sequence);
  closeTo(
    rejectedDash.dash.cooldownRemaining,
    beforeRejectedDash.cooldownRemaining,
    0.000001,
  );
  await step(1000);
  assert.equal(
    (await snapshot()).dash.sequence,
    beforeRejectedDash.sequence,
    "A rejected slide onto Dash never queues a landing dash",
  );
  jumpFingers[2] = touch(113, sprint);
  await native("touchMove", jumpFingers, [jumpFingers[2]]);
  assert.equal((await step()).input.sprinting, true);
  jumpFingers[2] = touch(113, dash);
  await native("touchMove", jumpFingers, [jumpFingers[2]]);
  const groundDash = await step();
  assert.equal(
    groundDash.dash.sequence,
    beforeRejectedDash.sequence + 1,
    "Dash re-entry is accepted after landing",
  );
  for (const owner of ["joystickPointer", "cameraPointer"])
    assert.equal(groundDash.input[owner], jumpOwners.input[owner]);
  await native("touchCancel", [], []);
  const cancelledJumpControls = await step(700);
  for (const owner of [
    "joystickPointer",
    "cameraPointer",
    "sprintPointer",
    "jumpPointer",
    "blockPointer",
  ])
    assert.equal(cancelledJumpControls.input[owner], null);
  assert.equal(cancelledJumpControls.input.sprinting, false);
  assert.equal(cancelledJumpControls.input.blocking, false);
  await freshScene();
  const cancelJumpFinger = touch(114, jump);
  const cancelBlockFinger = touch(115, block);
  await native("touchStart", [cancelJumpFinger, cancelBlockFinger]);
  await step(180);
  await native("touchCancel", [], []);
  const cancelInAir = await step();
  assert.equal(cancelInAir.input.jumpPointer, null);
  assert.equal(
    cancelInAir.input.blocking,
    false,
    "Touch cancellation releases an airborne guard",
  );
  const landedAfterCancel = await step(1100);
  assert.equal(landedAfterCancel.jump.phase, "grounded");
  assert.equal(landedAfterCancel.jump.sequence, 1);
  console.log(
    "PASS: Jump/Dash request order, native Sprint→Jump→Block→Dash slide, independent movement/look, re-entry and touch cancellation",
  );

  await freshScene();
  await walkTo({ x: dummyX, z: 0 });
  await page.keyboard.down("w");
  await advanceUntil(
    (sample) =>
      sample.proximity.distance !== null && sample.proximity.distance < 0.7,
  );
  await page.keyboard.up("w");
  await step(400);
  const groundPunch = await advanceUntil(
    (sample) => sample.combat.attack.active,
    500,
    17,
  );
  const combatJumpFinger = touch(121, jump);
  await native("touchStart", [combatJumpFinger]);
  const combatJumpStart = await step();
  const combatJumpSequence = combatJumpStart.combat.attack.sequence;
  assert.equal(
    combatJumpSequence,
    groundPunch.combat.attack.sequence,
    "Jump cancels the current ground punch without starting another",
  );
  assert.equal(combatJumpStart.combat.attack.cancelled, true);
  const airGuardFinger = touch(122, block);
  let guardStarted = false;
  const combatJumpSamples = await collectJump(
    groundPunch.jump.sequence,
    async (sample) => {
      if (!guardStarted && sample.jump.height > 0.2) {
        guardStarted = true;
        await native(
          "touchStart",
          [combatJumpFinger, airGuardFinger],
          [airGuardFinger],
        );
      }
    },
  );
  for (const sample of [combatJumpStart, ...combatJumpSamples]) {
    assert.equal(
      sample.combat.attack.sequence,
      combatJumpSequence,
      "No ground punch starts during takeoff, flight or landing, or held Block",
    );
    if (sample.combat.attack.active)
      assert.ok(
        sample.combat.attack.cancelled &&
          sample.combat.attack.phase === "recovery",
        "An interrupted punch only recovers while airborne",
      );
    assert.ok(
      Math.hypot(
        sample.position[0] - sample.dummy.position[0],
        sample.position[2] - sample.dummy.position[2],
      ) >=
        sample.radius + sample.dummy.radius - 0.002,
      "Jumping cannot pass through the dummy cylinder",
    );
  }
  const groundedBlock = combatJumpSamples.at(-1);
  assert.equal(groundedBlock.input.blocking, true);
  assert.ok(
    groundedBlock.animation.combatWeight > 0.95,
    "Held guard remains raised in the air and on landing",
  );
  await native("touchEnd", [combatJumpFinger, airGuardFinger]);
  const autoAfterLanding = await step();
  assert.equal(autoAfterLanding.jump.phase, "grounded");
  assert.equal(
    autoAfterLanding.combat.attack.sequence,
    combatJumpSequence + 1,
    "Grounded automatic combat resumes after landing and Block release",
  );
  console.log(
    "PASS: jumping interrupts a ground punch, suppresses all ground attacks through landing, preserves air Block and dummy containment, then resumes automatic combat",
  );
  await page.clock.resume();

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
  await checkActionLayout(390, 844);
  await checkResetLayout(390, 844);
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
