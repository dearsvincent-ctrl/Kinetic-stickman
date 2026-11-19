import assert from "node:assert/strict";
import { stick } from "./acrobatic-browser.mjs";
import { unlockSlider } from "./slider-test-utils.mjs";

const KEY = "kinetic.camera-settings.v1";
const advance = (page, ms = 100) => page.clock.runFor(ms);
const touch = (id, point) => ({
  id,
  ...point,
  radiusX: 7,
  radiusY: 7,
  force: 1,
});
const angle = (value) => Math.atan2(Math.sin(value), Math.cos(value));
const read = (page) =>
  page.locator("#battle-status").evaluate((node) => ({
    ...node.dataset,
    position: JSON.parse(node.dataset.position),
    enemies: JSON.parse(node.dataset.enemies),
    camera: JSON.parse(node.dataset.camera),
    enemySettings: JSON.parse(node.dataset.enemySettings),
    tagSettings: JSON.parse(node.dataset.tagSettings),
  }));
const otherSaved = (page) =>
  page.evaluate(
    (key) =>
      Object.fromEntries(
        Object.entries(localStorage).filter(([name]) => name !== key),
      ),
    KEY,
  );
const allLocked = (page) =>
  page
    .locator('#camera-settings input[type="range"]')
    .evaluateAll(
      (inputs) =>
        inputs.length === 7 &&
        inputs.every(
          (input) => input.disabled && input.dataset.sliderLocked === "true",
        ),
    );

async function fresh(page, sandbox = true) {
  const url = new URL(page.url());
  url.search = sandbox ? "?sandbox=1" : "";
  url.hash = "";
  await page.goto(url.href, { waitUntil: "networkidle" });
  await advance(page, 450);
  await page.evaluate(() => document.activeElement?.blur());
}
async function open(page) {
  if (await page.locator("#physics-panel").evaluate((node) => node.hidden))
    await page.locator("#physics-toggle").click();
  if (!(await page.locator("#camera-settings").evaluate((node) => node.open)))
    await page.locator("#camera-settings > summary").click();
  await advance(page, 50);
}
async function close(page) {
  if (!(await page.locator("#physics-panel").evaluate((node) => node.hidden)))
    await page.locator("#physics-close").click();
  await page.evaluate(() => document.activeElement?.blur());
}
// Fixtures use the real settings inputs and their production input handlers.
// They never write player/enemy/camera runtime state or use a debug API.
async function tune(page, values, prefix = "camera") {
  await page.evaluate(
    ({ values, prefix }) => {
      for (const [id, value] of Object.entries(values)) {
        const input = document.querySelector(`#${prefix}-${id}`);
        const logarithmic =
          prefix === "physics" ||
          ["sensitivity", "smoothness", "awareness"].includes(id);
        input.value = String(logarithmic ? Math.log10(value) : value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }
    },
    { values, prefix },
  );
  await advance(page);
}
async function cameraMode(page, mode) {
  await page.locator("#camera-mode").selectOption(mode);
  await page.evaluate(() => document.activeElement?.blur());
  await advance(page);
}
async function gameplayMode(page, mode) {
  await page.locator("#game-mode").selectOption(mode);
  await page.evaluate(() => document.activeElement?.blur());
  await advance(page);
  assert.equal((await read(page)).camera.gameplayMode, mode);
}
function projection(camera) {
  assert.ok(Number.isFinite(camera.actualFov));
  assert.ok(
    Math.abs(
      camera.projectionY - 1 / Math.tan((camera.actualFov * Math.PI) / 360),
    ) < 1e-7,
    "Telemetry describes the rendered perspective projection matrix",
  );
  assert.ok(camera.cameraPosition.every(Number.isFinite));
  assert.ok(camera.velocity.every(Number.isFinite));
  assert.ok(
    Math.abs(camera.speed - Math.hypot(...camera.velocity)) < 1e-6,
    "Dynamic FOV reads actual three-dimensional physical velocity",
  );
}

// Vertical pans need raw CDP: the browser may claim scrolling and cancel the
// pointer, so the gameplay helper's pointermove acknowledgement is unsuitable.
async function swipe(page, cdp, id, dx, dy) {
  await page.locator(`#${id}`).scrollIntoViewIfNeeded();
  const b = await page.locator(`#${id}`).boundingBox();
  const start = { x: b.x + b.width * 0.3, y: b.y + b.height / 2 };
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [touch(71, start)],
  });
  for (let n = 1; n <= 6; n++) {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [
        touch(71, {
          x: start.x + (dx * n) / 6,
          y: start.y + (dy * n) / 6,
        }),
      ],
    });
    await advance(page, 20);
  }
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await advance(page);
}
async function freeCameraPoint(page) {
  const point = await page.evaluate(() => {
    for (const y of [0.4, 0.5, 0.3, 0.65])
      for (const x of [0.64, 0.7, 0.8, 0.55]) {
        const point = { x: innerWidth * x, y: innerHeight * y };
        if (
          document.elementFromPoint(point.x, point.y)?.id === "camera-surface"
        )
          return point;
      }
    return null;
  });
  assert.ok(
    point,
    "A native camera drag starts on the production camera surface",
  );
  return point;
}
async function dragCamera(page, native, dx, { hold = 0 } = {}) {
  const start = await freeCameraPoint(page);
  const end = { x: start.x + dx, y: start.y };
  let finger = touch(61, start);
  await native("touchStart", [finger]);
  finger = touch(61, end);
  await native("touchMove", [finger]);
  await advance(page, 100);
  if (hold) {
    await advance(page, hold);
    const camera = (await read(page)).camera;
    assert.equal(
      camera.assistWeight,
      0,
      "A held manual camera contact suppresses assistance past the timeout",
    );
    assert.ok(
      camera.overrideRemaining > 0,
      "Manual override remains active while a finger is held still",
    );
  }
  await native("touchEnd", [finger]);
  await advance(page, 50);
}
async function orbitTo(page, native, yaw) {
  for (let attempt = 0; attempt < 10; attempt++) {
    const camera = (await read(page)).camera;
    const delta = angle(yaw - camera.targetYaw);
    if (Math.abs(delta) < 0.01) return;
    await dragCamera(
      page,
      native,
      Math.max(-125, Math.min(125, -delta / 0.0045)),
    );
  }
  assert.ok(Math.abs(angle(yaw - (await read(page)).camera.targetYaw)) < 0.04);
}
const bearing = (state, enemy) =>
  Math.atan2(
    -(enemy.position[0] - state.position[0]),
    -(enemy.position[2] - state.position[2]),
  );

/** Native production controls, read-only DOM telemetry, no actor mutation hooks. */
export async function checkCamera(page, native) {
  const savedCamera = await page.evaluate(
    (key) => localStorage.getItem(key),
    KEY,
  );
  const independent = await otherSaved(page);
  let controls;
  let cdp;
  try {
    await page.evaluate((key) => localStorage.removeItem(key), KEY);
    await page.setViewportSize({ width: 844, height: 390 });
    await fresh(page);
    assert.equal(await page.locator(".version b").textContent(), "0.8.9");
    assert.equal(
      await page.evaluate(() => typeof window.__KINETIC__),
      "undefined",
    );
    let state = await read(page);
    projection(state.camera);
    assert.equal(state.camera.settings.mode, "manual");
    assert.equal(state.camera.settings.dynamicFov, false);
    assert.equal(state.camera.actualFov, 52);
    const fixedDistance = state.camera.distance;
    await open(page);
    assert.equal(
      await page.locator('#camera-settings input[type="range"]').count(),
      7,
    );
    for (const id of ["baseFov", "maxFov"]) {
      assert.equal(
        await page.locator(`#camera-${id}`).getAttribute("min"),
        "50",
      );
      assert.equal(
        await page.locator(`#camera-${id}`).getAttribute("max"),
        "120",
      );
    }
    assert.ok(await allLocked(page));

    // The new camera ranges share individual locks and native panel scrolling.
    await page.setViewportSize({ width: 390, height: 844 });
    cdp = await page.context().newCDPSession(page);
    const before = await page.locator("#camera-baseFov").inputValue();
    await swipe(page, cdp, "camera-baseFov", 65, 0);
    assert.equal(await page.locator("#camera-baseFov").inputValue(), before);
    await page.locator("#camera-baseFov").scrollIntoViewIfNeeded();
    const scroll = page.locator(".physics-scroll");
    const scrollBefore = await scroll.evaluate((node) => node.scrollTop);
    await swipe(page, cdp, "camera-baseFov", 1, -90);
    assert.ok(
      (await scroll.evaluate((node) => node.scrollTop)) > scrollBefore + 10,
      "A locked camera range allows a native vertical panel pan",
    );
    await unlockSlider(page, "camera-baseFov");
    await page.locator("#camera-baseFov").scrollIntoViewIfNeeded();
    const unlockedBefore = await scroll.evaluate((node) => node.scrollTop);
    await swipe(page, cdp, "camera-baseFov", 1, -90);
    assert.ok(
      (await scroll.evaluate((node) => node.scrollTop)) > unlockedBefore + 10,
      "An unlocked camera range still permits vertical scrolling",
    );
    assert.equal(await page.locator("#camera-baseFov").inputValue(), before);
    assert.ok(
      await scroll.evaluate((node) => node.scrollWidth <= node.clientWidth + 1),
      "Camera settings stay horizontally contained in portrait",
    );
    await page.screenshot({
      path: "test-results/v086-camera-settings-portrait.png",
    });
    await cdp.detach();
    cdp = null;

    await page.setViewportSize({ width: 844, height: 390 });
    await page.locator("#camera-baseFov").scrollIntoViewIfNeeded();
    await unlockSlider(page, "camera-baseFov");
    const joystick = await page.locator("#joystick").boundingBox();
    const joy = touch(1, {
      x: joystick.x + joystick.width / 2,
      y: joystick.y + joystick.height / 2 - joystick.height * 0.34 * 0.5,
    });
    const range = await page.locator("#camera-baseFov").boundingBox();
    const start = {
      x: range.x + range.width * 0.2,
      y: range.y + range.height / 2,
    };
    const yawBefore = (await read(page)).camera.targetYaw;
    await native("touchStart", [joy]);
    let slider = touch(2, start);
    await native("touchStart", [joy, slider], [slider]);
    slider = touch(2, { x: start.x + range.width * 0.2, y: start.y });
    await native("touchMove", [joy, slider], [slider]);
    await native("touchEnd", [slider], [slider]);
    await advance(page, 180);
    state = await read(page);
    assert.ok(
      state.camera.settings.baseFov > 52,
      "Intentional native horizontal drag changes FOV",
    );
    assert.ok(
      state.camera.speed > 0.1,
      "A separate joystick finger retains movement ownership",
    );
    assert.equal(
      state.camera.targetYaw,
      yawBefore,
      "A camera settings drag never becomes a camera orbit",
    );
    await native("touchCancel", [], [joy]);
    await advance(page, 1200);
    projection((await read(page)).camera);
    assert.equal(
      (await read(page)).camera.distance,
      fixedDistance,
      "FOV changes the projection without replacing it with a camera distance change",
    );
    await page.locator("#camera-baseFov").press("Home");
    await advance(page);
    assert.equal((await read(page)).camera.actualFov, 50);
    projection((await read(page)).camera);
    await page.locator("#camera-baseFov").press("End");
    await advance(page);
    assert.equal((await read(page)).camera.actualFov, 120);
    projection((await read(page)).camera);

    // Distinct mode profiles auto-save without touching AI, physics or layouts.
    await tune(page, {
      baseFov: 60,
      maxFov: 95,
      awareness: 150,
      smoothness: 0.35,
    });
    await cameraMode(page, "assisted");
    const combat = (await read(page)).camera.preferences.combat;
    await unlockSlider(page, "camera-baseFov");
    await page.locator("#camera-profile").selectOption("tag");
    await advance(page);
    assert.ok(
      await allLocked(page),
      "Changing profile relocks every camera slider",
    );
    await tune(page, { baseFov: 73, maxFov: 112, awareness: 500 });
    await cameraMode(page, "dynamic");
    await page.locator("#camera-dynamicFov").check();
    await advance(page);
    state = await read(page);
    assert.deepEqual(
      state.camera.settings,
      combat,
      "Editing the Tag profile leaves the active Combat camera unchanged",
    );
    const tag = state.camera.preferences.tag;
    const stored = await page.evaluate(
      (key) => JSON.parse(localStorage.getItem(key)),
      KEY,
    );
    assert.equal(stored.version, 1);
    assert.deepEqual(stored.values, { combat, tag });
    assert.deepEqual(
      await otherSaved(page),
      independent,
      "Camera saves preserve every unrelated localStorage byte value",
    );
    await close(page);
    await fresh(page, false);
    state = await read(page);
    assert.deepEqual(
      state.camera.settings,
      combat,
      "Camera preferences load during normal play without sandbox/debug",
    );
    assert.deepEqual(state.camera.preferences.tag, tag);
    await gameplayMode(page, "tag");
    assert.deepEqual(
      (await read(page)).camera.settings,
      tag,
      "Tag gameplay selects its independent camera profile",
    );
    await fresh(page);
    await open(page);
    await page.locator("#camera-profile").selectOption("tag");
    await page.locator("#camera-reset").click();
    await advance(page);
    state = await read(page);
    assert.deepEqual(
      state.camera.preferences.combat,
      combat,
      "Reset affects only the selected camera profile",
    );
    assert.equal(state.camera.preferences.tag.baseFov, 52);
    assert.equal(state.camera.preferences.tag.mode, "manual");
    assert.equal(state.camera.preferences.tag.dynamicFov, false);
    await page.locator("#camera-profile").selectOption("combat");
    await unlockSlider(page, "camera-sensitivity");
    await page.locator("#camera-settings > summary").click();
    await page.locator("#camera-settings > summary").click();
    await advance(page);
    assert.ok(
      await allLocked(page),
      "Reopening Camera Settings relocks its ranges",
    );
    await unlockSlider(page, "camera-sensitivity");
    await close(page);
    await open(page);
    assert.ok(
      await allLocked(page),
      "Reopening the developer panel relocks camera ranges",
    );
    assert.deepEqual((await read(page)).camera.preferences.combat, combat);
    await page.screenshot({
      path: "test-results/v086-camera-settings-landscape.png",
    });

    // Speed-derived FOV runs in Manual as well: no assisted yaw is needed.
    await cameraMode(page, "manual");
    await tune(page, { baseFov: 58, maxFov: 90, smoothness: 0.2 });
    await page.locator("#camera-dynamicFov").check();
    await close(page);
    await fresh(page);
    await advance(page, 1000);
    const stationary = (await read(page)).camera;
    assert.ok(Math.abs(stationary.actualFov - 58) < 0.1);
    controls = await stick(page, native);
    await controls.move(0, 0.3);
    await advance(page, 350);
    const slow = (await read(page)).camera;
    await controls.move(0, 1);
    await advance(page, 450);
    const sprint = (await read(page)).camera;
    projection(slow);
    projection(sprint);
    assert.ok(
      sprint.speed > slow.speed + 0.5,
      "Native analogue input causes a real physical speed increase",
    );
    assert.ok(
      sprint.actualFov > slow.actualFov + 0.2,
      "FOV widens as actual physical speed increases",
    );
    assert.equal(sprint.distance, stationary.distance);
    assert.equal(
      sprint.targetYaw,
      stationary.targetYaw,
      "Manual mode never adds an assisted yaw",
    );
    await controls.stop();
    controls = null;
    const movingFov = sprint.actualFov;
    await advance(page, 100);
    const earlyRecovery = (await read(page)).camera;
    assert.ok(
      earlyRecovery.actualFov > 58 && earlyRecovery.actualFov <= movingFov + 3,
      "FOV recovers through a bounded smooth transition after motion ends",
    );
    await advance(page, 1800);
    assert.ok(Math.abs((await read(page)).camera.actualFov - 58) < 0.15);

    // A high jump proves vertical velocity participates independently of input.
    await fresh(page);
    await open(page);
    await tune(page, { movement: 1, jumpHeight: 20, gravity: 1 }, "physics");
    await close(page);
    controls = await stick(page, native);
    await controls.move(0, 0);
    await controls.tap("jump");
    await advance(page, 160);
    const airborne = (await read(page)).camera;
    projection(airborne);
    assert.ok(
      Math.abs(airborne.velocity[1]) > 10,
      "Native Jump produces physical vertical velocity",
    );
    assert.ok(
      Math.hypot(airborne.velocity[0], airborne.velocity[2]) < 1,
      "The vertical FOV case has no horizontal movement input",
    );
    assert.ok(
      airborne.actualFov > 60,
      "Vertical travel widens the rendered field of view",
    );
    await controls.stop();
    controls = null;

    // Session-only extreme physics exercises the advertised cap and finiteness.
    await fresh(page);
    await open(page);
    await tune(page, { movement: 20 }, "physics");
    await close(page);
    controls = await stick(page, native);
    let peakSpeed = 0,
      peakFov = 58;
    for (const [x, y] of [
      [1, -1],
      [-1, -1],
      [0, 1],
    ]) {
      await controls.move(x * Math.SQRT1_2, y * Math.SQRT1_2);
      for (let sample = 0; sample < 5; sample++) {
        await advance(page, 120);
        const camera = (await read(page)).camera;
        projection(camera);
        peakSpeed = Math.max(peakSpeed, camera.speed);
        peakFov = Math.max(peakFov, camera.actualFov);
        assert.ok(
          camera.actualFov <= 90.001,
          "Extreme physical speed stays within the configured maximum FOV",
        );
      }
      if (peakSpeed > 30 && peakFov > 80) break;
    }
    assert.ok(
      peakSpeed > 20,
      `Extreme input produces actual high velocity (${peakSpeed})`,
    );
    assert.ok(
      peakFov > 75,
      `Extreme velocity visibly widens the rendered projection (${peakFov})`,
    );
    await controls.stop();
    controls = null;
    await page.screenshot({ path: "test-results/v086-camera-speed-fov.png" });

    // Start a fresh ordinary encounter before exercising camera assistance.
    await fresh(page);
    await open(page);
    await tune(page, {
      baseFov: 52,
      maxFov: 105,
      awareness: 2000,
      strength: 1,
      sensitivity: 2,
      smoothness: 0.15,
      overrideDelay: 0.35,
    });
    await cameraMode(page, "assisted");
    await page.locator("#camera-dynamicFov").uncheck();
    const aiBefore = await otherSaved(page);
    const enemySettings = (await read(page)).enemySettings;
    await tune(page, { awareness: 2 });
    await tune(page, { awareness: 2000 });
    assert.deepEqual(
      (await read(page)).enemySettings,
      enemySettings,
      "Camera awareness never changes live enemy AI detection settings",
    );
    assert.deepEqual(
      await otherSaved(page),
      aiBefore,
      "Camera awareness never rewrites any AI save bytes",
    );
    await close(page);
    state = await read(page);
    const target = state.enemies.find((enemy) => enemy.health > 0);
    assert.ok(
      target,
      "An ordinary live AI enemy is available for camera awareness",
    );
    await orbitTo(page, native, bearing(state, target));
    await advance(page, 700);
    state = await read(page);
    assert.ok(
      state.camera.selectedTargetId !== null,
      "Assisted mode acquires an actual enemy ahead of the camera",
    );
    assert.ok(
      state.camera.assistWeight > 0,
      "Assisted mode applies gentle guidance after manual override expires",
    );
    const selected = state.camera.selectedTargetId;
    let stableSamples = 0;
    for (let sample = 0; sample < 5; sample++) {
      const previous = state.camera;
      await advance(page, 100);
      state = await read(page);
      projection(state.camera);
      assert.ok(
        Math.abs(angle(state.camera.yaw - previous.yaw)) < 0.3,
        "Moving AI targets cannot abruptly snap the camera yaw",
      );
      const retained = state.enemies.find(
        (enemy) => enemy.id === selected && enemy.health > 0,
      );
      if (
        retained &&
        Math.abs(angle(bearing(state, retained) - state.camera.targetYaw)) <
          Math.PI / 3
      ) {
        assert.equal(
          state.camera.selectedTargetId,
          selected,
          "A still-valid front target stays selected as nearby AI moves",
        );
        stableSamples++;
      }
    }
    assert.ok(
      stableSamples > 0,
      "Target stability is observed against live moving enemies",
    );
    const beforeLook = state.camera.targetYaw;
    await dragCamera(page, native, 220, { hold: 900 });
    state = await read(page);
    assert.ok(
      Math.abs(angle(state.camera.targetYaw - beforeLook)) > 0.7,
      "Native manual orbit takes precedence over active assistance",
    );
    const userYaw = state.camera.targetYaw;
    assert.equal(state.camera.assistWeight, 0);
    await advance(page, 100);
    assert.equal(
      (await read(page)).camera.targetYaw,
      userYaw,
      "Assistance cannot overwrite the user's orbit during the release delay",
    );
    await orbitTo(page, native, angle(beforeLook + Math.PI));
    await advance(page, 650);
    state = await read(page);
    const behind = state.enemies.filter(
      (enemy) =>
        enemy.health > 0 &&
        Math.abs(angle(bearing(state, enemy) - state.camera.targetYaw)) >
          Math.PI / 2,
    );
    assert.ok(
      behind.length > 0,
      "The native look-away places live AI enemies behind the camera",
    );
    for (const enemy of behind)
      assert.notEqual(
        state.camera.selectedTargetId,
        enemy.id,
        "An enemy behind a deliberate look-away cannot force a 180-degree turn",
      );
    assert.ok(
      Math.abs(state.camera.yawOffset) < Math.PI / 2,
      "Assist yaw remains bounded after a deliberate look-away",
    );
    await page.screenshot({
      path: "test-results/v086-camera-manual-override.png",
    });
    assert.deepEqual(
      await otherSaved(page),
      independent,
      "Camera modes, awareness, dynamic FOV, refresh and profile reset preserve every unrelated saved setting",
    );
    console.log(
      "PASS: production native camera locks/scroll/joystick ownership; real projection and 3D-speed FOV including vertical/extreme travel; separate persistent Combat/Tag camera profiles; live AI target stability and manual look-away override. No physical Android device tested.",
    );
  } finally {
    await controls?.stop();
    await cdp?.detach();
    await page.evaluate(
      ({ key, saved }) => {
        if (saved === null) localStorage.removeItem(key);
        else localStorage.setItem(key, saved);
      },
      { key: KEY, saved: savedCamera },
    );
    assert.deepEqual(
      await otherSaved(page),
      independent,
      "Camera browser checks preserve all unrelated localStorage bytes",
    );
  }
}
