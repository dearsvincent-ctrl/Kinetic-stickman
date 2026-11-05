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
const checkActionLayout = async (width, height) => {
  const selectors = [
    "#sprint-button",
    "#dash-button",
    "#attack-button",
    "#block-button",
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
    "#attack-button",
    "#block-button",
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
  await wait(() => {
    const state = window.__KINETIC__.snapshot();
    return state.dash.ready && state.animation.dashWeight < 0.02;
  });
  console.log(
    "PASS: stationary DASH travels continuously for 2.5m, preserves camera angles, blends back and respects cooldown",
  );

  assert.equal(
    await page.locator("#fight-button").count(),
    0,
    "Manual Fight toggle is removed",
  );
  assert.equal(
    await page.getByRole("button", { name: /^jump$/i }).count(),
    0,
    "Jump remains reserved for a future version",
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
  const attack = await center("#attack-button");
  const block = await center("#block-button");
  const reset = await center("#reset-camera");
  const camera = { x: 550, y: 165 };
  const gap = { x: 420, y: 220 };
  const step = async (milliseconds = 34) => {
    await page.clock.runFor(milliseconds);
    return snapshot();
  };

  // Attack is one PRESS. Rejected recovery entries never buffer a later punch.
  let attackFinger = touch(5, attack);
  let beforeAttack = await snapshot();
  await native("touchStart", [attackFinger]);
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
    "Holding Attack does not repeat after recovery",
  );
  assert.equal(state.combat.ready, true);
  await native("touchMove", [touch(5, gap)]);
  await step();
  await native("touchMove", [attackFinger]);
  state = await step(100);
  const secondSequence = state.combat.attack.sequence;
  assert.equal(
    secondSequence,
    beforeAttack.combat.attack.sequence + 2,
    "Re-entry triggers a new punch",
  );
  await native("touchMove", [touch(5, gap)]);
  await step();
  await native("touchMove", [attackFinger]);
  state = await step();
  assert.equal(
    state.combat.attack.sequence,
    secondSequence,
    "Recovery rejects another entry",
  );
  state = await step(850);
  assert.equal(
    state.combat.attack.sequence,
    secondSequence,
    "Rejected entry never queues an attack",
  );
  assert.ok(
    state.animation.combatWeight < 0.03,
    "Automatic combat posture blends back to idle",
  );
  assert.ok(
    state.animation.attackWeight < 0.03,
    "Punch naturally recovers its arm pose",
  );
  await native("touchEnd", [attackFinger]);
  assert.equal(
    (await step()).combat.attack.sequence,
    secondSequence,
    "Release cannot produce another attack",
  );
  console.log(
    "PASS: basic punch, automatic posture, one attack per entry, recovery rejection and no buffered repeat",
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
    const movingFinger = touch(10, { x: joy.x, y: joy.y - radius * fraction });
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
  const fourthFinger = touch(6, attack);
  await native("touchStart", [...fingers, fourthFinger], [fourthFinger]);
  const attackingMulti = await step(100);
  assert.equal(attackingMulti.combat.attack.active, true);
  assert.ok(
    attackingMulti.speed > 3.3,
    "Punching preserves the simultaneous sprinting joystick motion",
  );
  for (const owner of ["joystickPointer", "cameraPointer", "sprintPointer"])
    assert.equal(attackingMulti.input[owner], multi.input[owner]);
  assert.deepEqual(attackingMulti.input.move, multi.input.move);
  closeTo(attackingMulti.camera.targetYaw, multi.camera.targetYaw, 0.000001);
  await page.screenshot({ path: "test-results/multitouch.png" });
  await native("touchEnd", [fourthFinger]);
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

  // One action pointer never lifts while crossing all four gameplay buttons.
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
  const beforeSlideAttack = slid.combat.attack.sequence;
  slid = await slideTo(attack);
  assert.equal(
    slid.input.blocking,
    false,
    "Block releases before the Attack entry",
  );
  assert.equal(
    slid.combat.attack.sequence,
    beforeSlideAttack + 1,
    "Block to Attack initiates one punch without lifting",
  );
  assert.equal(slid.combat.attack.active, true);
  assert.equal(
    (await step(700)).combat.attack.sequence,
    beforeSlideAttack + 1,
    "Holding Attack never repeats",
  );
  await slideTo(gap);
  assert.equal(
    (await snapshot()).input.cameraPointer,
    null,
    "Action ownership survives gaps without becoming camera input",
  );
  slid = await slideTo(attack);
  assert.equal(
    slid.combat.attack.sequence,
    beforeSlideAttack + 2,
    "Attack re-entry initiates another recovered punch",
  );
  slid = await slideTo(block);
  assert.equal(slid.input.blocking, true);
  assert.equal(
    slid.combat.attack.cancelled,
    true,
    "Block safely recovers an in-progress punch",
  );
  slid = await slideTo(gap, 750);
  assert.equal(
    slid.input.blocking,
    false,
    "Leaving Block releases HOLD immediately",
  );
  assert.equal(
    slid.combat.attack.active,
    false,
    "Releasing Block never resumes the cancelled punch",
  );
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
  crossing = [touch(44, sprint), touch(45, attack)];
  await native("touchMove", crossing);
  let crossingState = await step();
  assert.equal(crossingState.input.sprinting, false);
  assert.equal(crossingState.input.blocking, false);
  assert.equal(
    crossingState.combat.attack.sequence,
    crossingAttackSequence,
    "Camera drag crossing Attack cannot activate a punch",
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
  ])
    assert.equal(crossingState.input[owner], null);
  assert.equal(crossingState.input.sprinting, false);
  assert.equal(crossingState.input.blocking, false);
  await page.clock.resume();
  console.log(
    "PASS: native slide Sprint/Dash/Attack/Block entry and recovery, shared HOLD, role isolation and cancellation",
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
