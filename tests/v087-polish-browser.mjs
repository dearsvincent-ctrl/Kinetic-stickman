import assert from "node:assert/strict";
import { stick } from "./acrobatic-browser.mjs";
import { unlockSlider } from "./slider-test-utils.mjs";
import { ANIMATION_PARAMETERS } from "../src/sandbox/AnimationSettings.js";
import { SPEED_EFFECT_PARAMETERS } from "../src/sandbox/SpeedEffectsSettings.js";
import { ATTACK_MAGNETISM_PARAMETERS } from "../src/sandbox/AttackMagnetismSettings.js";
import { SPEED_EFFECT_LIMITS } from "../src/world/SpeedEffects.js";

const advance = (page, ms = 80) => page.clock.runFor(ms);
const KEYS = [
  "kinetic.animation-presentation.v1",
  "kinetic.speed-effects.v1",
  "kinetic.attack-magnetism.v1",
];
const SECTIONS = [
  ["animation-polish", ANIMATION_PARAMETERS],
  ["speed-effects", SPEED_EFFECT_PARAMETERS],
  ["attack-magnetism", ATTACK_MAGNETISM_PARAMETERS],
];
const touch = (id, p) => ({ id, ...p, radiusX: 7, radiusY: 7, force: 1 });
const point = async (page, selector) => {
  const b = await page.locator(selector).boundingBox();
  assert.ok(b, `${selector} has a native touch target`);
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
};
const read = (page) =>
  page.evaluate(() => {
    const battle = document.querySelector("#battle-status");
    return {
      ...battle.dataset,
      stance: { ...document.querySelector("#stance-label").dataset },
      position: JSON.parse(battle.dataset.position),
      enemies: JSON.parse(battle.dataset.enemies),
      camera: JSON.parse(battle.dataset.camera),
      polish: JSON.parse(battle.dataset.polish),
      contacts: Number(document.querySelector("#contact-status").dataset.count),
    };
  });
const unrelated = (page) =>
  page.evaluate(
    (keys) =>
      Object.fromEntries(
        Object.keys(localStorage)
          .filter((key) => !keys.includes(key))
          .sort()
          .map((key) => [key, localStorage.getItem(key)]),
      ),
    KEYS,
  );
async function fresh(page, { sandbox = true, practice = false } = {}) {
  const url = new URL(page.url());
  url.search = sandbox ? "?sandbox=1" : "";
  if (practice) url.searchParams.set("practice", "1");
  await page.goto(url.href, { waitUntil: "networkidle" });
  await advance(page, 450);
  assert.equal(
    await page.evaluate(() => typeof window.__KINETIC__),
    "undefined",
    "v087 acceptance uses the production UI without a debug state hook",
  );
}
async function open(page, section) {
  if (await page.locator("#physics-panel").evaluate((node) => node.hidden))
    await page.locator("#physics-toggle").click();
  if (!(await page.locator(`#${section}`).evaluate((node) => node.open)))
    await page.locator(`#${section} > summary`).click();
  await advance(page);
}
async function close(page) {
  if (!(await page.locator("#physics-panel").evaluate((node) => node.hidden)))
    await page.locator("#physics-close").click();
  await advance(page);
}
const locked = (page, section) =>
  page
    .locator(`#${section} input[type="range"]`)
    .evaluateAll(
      (inputs) =>
        inputs.length > 0 &&
        inputs.every(
          (input) => input.disabled && input.dataset.sliderLocked === "true",
        ),
    );
async function until(page, predicate, label, { limit = 2000, step = 20 } = {}) {
  for (let elapsed = 0; elapsed <= limit; elapsed += step) {
    const state = await read(page);
    if (predicate(state)) return state;
    await advance(page, step);
  }
  assert.fail(`${label}: ${JSON.stringify(await read(page))}`);
}

/** Real range keyboard operation after an individual unlock. PageUp/Down
 * covers large logarithmic ranges; arrow keys finish at the nearest step. */
async function setRange(page, section, parameter, value) {
  if (section === "physics") {
    if (await page.locator("#physics-panel").evaluate((node) => node.hidden))
      await page.locator("#physics-toggle").click();
  } else await open(page, section);
  const id = `${section}-${parameter.id}`;
  const slider = await unlockSlider(page, id);
  const bounds = await slider.evaluate((input) => ({
    min: Number(input.min),
    max: Number(input.max),
    step: Number(input.step),
  }));
  const raw = parameter.log ? Math.log10(value) : value;
  const target = Math.max(
    bounds.min,
    Math.min(
      bounds.max,
      bounds.min + Math.round((raw - bounds.min) / bounds.step) * bounds.step,
    ),
  );
  await slider.press(target < (bounds.min + bounds.max) / 2 ? "Home" : "End");
  for (let n = 0; n < 14; n++) {
    const current = Number(await slider.inputValue());
    if (Math.abs(target - current) <= (bounds.max - bounds.min) * 0.051) break;
    await slider.press(target > current ? "PageUp" : "PageDown");
  }
  for (let n = 0; n < 180; n++) {
    const current = Number(await slider.inputValue());
    if (Math.abs(target - current) < bounds.step * 0.51) break;
    await slider.press(target > current ? "ArrowRight" : "ArrowLeft");
  }
  assert.ok(
    Math.abs(Number(await slider.inputValue()) - target) < bounds.step * 0.51,
    `${id} responds to native keyboard adjustment`,
  );
  await advance(page);
}
async function resetNew(page) {
  for (const [section] of SECTIONS) {
    await open(page, section);
    await page.locator(`#${section}-reset`).click();
  }
  await close(page);
}
// Raw CDP is intentional: a native vertical pan sends pointercancel once
// Chromium owns the scroll, so gameplay pointermove acknowledgements do not apply.
async function swipe(page, cdp, id, dx, dy) {
  const slider = page.locator(`#${id}`);
  await slider.scrollIntoViewIfNeeded();
  const b = await slider.boundingBox();
  const start = { x: b.x + b.width * 0.32, y: b.y + b.height / 2 };
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [touch(71, start)],
  });
  for (let n = 1; n <= 6; n++) {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [
        touch(71, { x: start.x + (dx * n) / 6, y: start.y + (dy * n) / 6 }),
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
async function checkSettings(page, native) {
  const independent = await unrelated(page);
  await fresh(page, { practice: true });
  await resetNew(page);
  assert.equal((await read(page)).polish.magnetism.enabled, false);
  const cdp = await page.context().newCDPSession(page);
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    for (const [section, parameters] of SECTIONS) {
      await open(page, section);
      assert.equal(
        await page.locator(`#${section} input[type="range"]`).count(),
        parameters.length,
      );
      assert.ok(
        await locked(page, section),
        `${section} starts with every range individually locked`,
      );
      for (const parameter of parameters) {
        const id = `${section}-${parameter.id}`;
        const slider = page.locator(`#${id}`);
        assert.equal(
          await page.locator(`[data-slider-lock="${id}"]`).count(),
          1,
        );
        assert.ok(await slider.getAttribute("aria-label"));
        assert.ok(await slider.getAttribute("aria-valuetext"));
      }
      const id = `${section}-${parameters[0].id}`;
      const initial = await page.locator(`#${id}`).inputValue();
      await swipe(page, cdp, id, 55, 0);
      assert.equal(
        await page.locator(`#${id}`).inputValue(),
        initial,
        `A locked ${section} range ignores horizontal adjustment`,
      );
      const scroll = page.locator(".physics-scroll");
      await page.locator(`#${id}`).scrollIntoViewIfNeeded();
      const lockedScroll = await scroll.evaluate((node) => node.scrollTop);
      await swipe(page, cdp, id, 1, -90);
      assert.ok(
        (await scroll.evaluate((node) => node.scrollTop)) > lockedScroll + 10,
        `${section} permits native vertical panning while locked`,
      );
      await unlockSlider(page, id);
      assert.ok(
        await page
          .locator(`#${section} input[type="range"]`)
          .evaluateAll(
            (inputs, id) =>
              inputs.every((input) => input.id === id || input.disabled),
            id,
          ),
        "An individual unlock never unlocks another range",
      );
      await page.locator(`#${id}`).scrollIntoViewIfNeeded();
      const unlockedScroll = await scroll.evaluate((node) => node.scrollTop);
      await swipe(page, cdp, id, 1, -90);
      assert.ok(
        (await scroll.evaluate((node) => node.scrollTop)) > unlockedScroll + 10,
        `${section} permits native vertical panning after unlock`,
      );
      assert.equal(await page.locator(`#${id}`).inputValue(), initial);
      await page.locator(`#${section} > summary`).click();
      await page.locator(`#${section} > summary`).click();
      await advance(page);
      assert.ok(
        await locked(page, section),
        "Reopening a new settings section relocks its ranges",
      );
      assert.ok(
        await scroll.evaluate(
          (node) => node.scrollWidth <= node.clientWidth + 1,
        ),
      );
    }
    await page.locator("#speed-effects-sonicSpeed").scrollIntoViewIfNeeded();
    await page.screenshot({
      path: "test-results/v087-polish-settings-portrait.png",
    });
  } finally {
    await cdp.detach();
  }

  await page.setViewportSize({ width: 844, height: 390 });
  await open(page, "animation-polish");
  const slider = await unlockSlider(page, "animation-polish-sprintAggression");
  await slider.scrollIntoViewIfNeeded();
  const joyBox = await page.locator("#joystick").boundingBox();
  const joy = touch(1, {
    x: joyBox.x + joyBox.width / 2,
    y: joyBox.y + joyBox.height / 2 - joyBox.height * 0.34 * 0.6,
  });
  const b = await slider.boundingBox();
  let finger = touch(2, { x: b.x + b.width * 0.25, y: b.y + b.height / 2 });
  const before = await read(page);
  await native("touchStart", [joy]);
  await native("touchStart", [joy, finger], [finger]);
  finger = touch(2, { x: b.x + b.width * 0.8, y: b.y + b.height / 2 });
  await native("touchMove", [joy, finger], [finger]);
  await native("touchEnd", [finger], [finger]);
  await advance(page, 220);
  const during = await read(page);
  assert.ok(
    during.polish.sprintAggression > 1,
    "A real horizontal range drag changes sprint presentation",
  );
  assert.ok(
    during.polish.effects.horizontalSpeed > 0.5,
    "A separate joystick finger keeps movement ownership",
  );
  assert.equal(
    during.camera.targetYaw,
    before.camera.targetYaw,
    "A range adjustment never orbits the camera",
  );
  assert.equal(
    during.stance.sequence,
    "0",
    "Settings multitouch never initiates an attack",
  );
  await native("touchCancel", [], [joy]);
  await setRange(page, "animation-polish", ANIMATION_PARAMETERS[0], 0.6);
  await setRange(
    page,
    "speed-effects",
    SPEED_EFFECT_PARAMETERS.find((p) => p.id === "dustIntensity"),
    1.5,
  );
  await open(page, "speed-effects");
  await page.locator("#speed-effects-sonicEnabled").uncheck();
  await setRange(
    page,
    "attack-magnetism",
    ATTACK_MAGNETISM_PARAMETERS.find((p) => p.id === "range"),
    4,
  );
  await page.locator("#attack-magnetism-enabled").check();
  await advance(page);
  const saved = await page.evaluate(
    (keys) => keys.map((key) => JSON.parse(localStorage.getItem(key))),
    KEYS,
  );
  assert.ok(saved.every((entry) => entry.version === 1));
  assert.equal(saved[0].values.sprintAggression, 0.6);
  assert.equal(saved[1].values.dustIntensity, 1.5);
  assert.equal(saved[1].values.sonicEnabled, false);
  assert.equal(saved[2].values.enabled, true);
  assert.equal(saved[2].values.range, 4);
  assert.deepEqual(
    await unrelated(page),
    independent,
    "Auto-saving the new preferences preserves unrelated browser storage",
  );
  await fresh(page, { sandbox: false, practice: true });
  const ordinary = await read(page);
  assert.equal(
    await page
      .locator("#animation-polish,#speed-effects,#attack-magnetism")
      .count(),
    0,
  );
  assert.equal(
    ordinary.polish.sprintAggression,
    0.6,
    "Animation preferences load in ordinary play",
  );
  assert.equal(ordinary.polish.effects.config.dustIntensity, 1.5);
  assert.equal(ordinary.polish.effects.config.sonicEnabled, false);
  assert.equal(ordinary.polish.magnetism.config.enabled, true);
  assert.equal(ordinary.polish.magnetism.config.range, 4);
  await fresh(page, { practice: true });
  await resetNew(page);
  await open(page, "speed-effects");
  await page.locator("#speed-effects-sonicSpeed").scrollIntoViewIfNeeded();
  await page.screenshot({
    path: "test-results/v087-polish-settings-landscape.png",
  });
  await close(page);
  assert.deepEqual(
    await unrelated(page),
    independent,
    "Refresh and independent resets preserve unrelated settings",
  );
}

export async function checkManualFlow(page, native) {
  for (const action of ["punch", "kick"]) {
    await fresh(page, { sandbox: false, practice: true });
    const controls = await stick(page, native);
    await controls.tap(action);
    const entry = await until(
      page,
      (s) => Number(s.stance.sequence) === 1,
      `A native ${action} tap is accepted`,
    );
    assert.equal(entry.stance.action, action);
    if (action === "kick") {
      await until(
        page,
        (s) => s.stance.phase === "windup",
        "Kick chamber is visible",
      );
      await page.screenshot({ path: "test-results/v087-kick-chamber.png" });
      const contact = await until(
        page,
        (s) => ["extension", "impact"].includes(s.stance.phase),
        "Kick extends toward contact",
      );
      assert.ok(
        contact.polish.strike.point.length === 3 &&
          contact.polish.strike.point.every(Number.isFinite),
      );
      await page.screenshot({ path: "test-results/v087-kick-extension.png" });
      await until(
        page,
        (s) => s.stance.phase === "recovery",
        "Kick recoils through recovery",
      );
      await page.screenshot({ path: "test-results/v087-kick-recovery.png" });
    }
    await advance(page, 1300);
    const completed = await read(page);
    assert.equal(
      completed.stance.sequence,
      "1",
      `One native ${action} tap performs exactly one strike`,
    );
    assert.equal(completed.stance.phase, "idle");
    assert.equal(
      completed.polish.magnetism.queries,
      0,
      "Default-off magnetism does no target acquisition work",
    );
    await controls.stop();
  }
  await fresh(page, { sandbox: false, practice: true });
  let controls = await stick(page, native);
  await controls.enter("punch");
  const styles = new Set();
  for (let n = 0; n < 32; n++) {
    await advance(page, 70);
    const state = await read(page);
    if (state.polish.strike.active) styles.add(state.polish.strike.id);
    const history = state.polish.strike.combo.history;
    assert.ok(
      history.length <= 4,
      "Native held combos retain a bounded accepted history",
    );
    for (let i = 1; i < history.length; i++)
      assert.ok(
        history[i].clock >= history[i - 1].endClock - 1e-7,
        "Native holding waits for every full authored recovery",
      );
  }
  assert.ok(Number((await read(page)).stance.sequence) >= 3);
  assert.ok(
    styles.size >= 3,
    "Holding Punch naturally visits distinct authored combo techniques",
  );
  await controls.enter("kick");
  await until(
    page,
    (s) => s.stance.action === "kick" && s.stance.phase !== "idle",
    "A native Punch-to-Kick slide branches the combo",
  );
  await controls.enter("block");
  await advance(page, 100);
  const blocked = await read(page);
  assert.equal(await page.locator("#stance-label").textContent(), "BLOCKING");
  assert.equal(blocked.stance.cancelled, "true");
  await advance(page, 700);
  assert.equal(
    (await read(page)).stance.sequence,
    blocked.stance.sequence,
    "Block cancels combo repetition immediately",
  );
  await controls.releaseAction();
  await advance(page, 900);
  assert.equal(
    (await read(page)).stance.sequence,
    blocked.stance.sequence,
    "Releasing Block never replays a cancelled action",
  );
  await controls.stop();

  await fresh(page, { sandbox: false, practice: true });
  controls = await stick(page, native);
  await controls.enter("kick");
  const heldKicks = new Set();
  for (let n = 0; n < 30; n++) {
    await advance(page, 80);
    const held = await read(page);
    if (held.polish.strike.active) heldKicks.add(held.polish.strike.id);
    const history = held.polish.strike.combo.history;
    for (let i = 1; i < history.length; i++)
      assert.ok(
        history[i].clock >= history[i - 1].endClock - 1e-7,
        "Native held Kicks also finish every full authored recovery",
      );
  }
  assert.ok(
    Number((await read(page)).stance.sequence) >= 3 && heldKicks.size >= 3,
    "Holding Kick repeats distinct manual combo techniques",
  );
  await controls.releaseAction();
  const releasedSequence = (await read(page)).stance.sequence;
  await advance(page, 1000);
  assert.equal(
    (await read(page)).stance.sequence,
    releasedSequence,
    "Releasing a held Kick ends repetition",
  );
  await controls.stop();

  await fresh(page, { sandbox: false, practice: true });
  controls = await stick(page, native);
  for (const [action, expected] of [
    ["punch", "cross-punch"],
    ["kick", "roundhouse-kick"],
  ]) {
    if (Number((await read(page)).stance.sequence) === 0) {
      await controls.tap("punch");
      await until(
        page,
        (s) => s.stance.phase === "recovery",
        "Opening punch reaches its combo window",
      );
    }
    await controls.tap(action);
    await until(
      page,
      (s) => s.stance.technique === expected,
      `Native recovery tap selects ${expected}`,
    );
    await until(
      page,
      (s) => s.stance.phase === "recovery",
      `${expected} reaches authored recovery`,
    );
  }
  assert.equal(
    (await read(page)).stance.sequence,
    "3",
    "Punch, Punch, Kick creates three accepted manual entries",
  );
  await controls.stop();
  await fresh(page, { sandbox: false, practice: true });
  controls = await stick(page, native);
  await controls.move(0, 0.75);
  await advance(page, 300);
  const movingStart = await read(page);
  await controls.tap("kick");
  await advance(page, 150);
  const movingKick = await read(page);
  assert.equal(movingKick.stance.action, "kick");
  assert.ok(movingKick.polish.effects.horizontalSpeed > 1);
  assert.ok(
    Math.hypot(
      movingKick.position[0] - movingStart.position[0],
      movingKick.position[2] - movingStart.position[2],
    ) > 0.1,
    "A manual moving Kick preserves physical travel",
  );
  await controls.stop();
  for (const action of ["punch", "kick"]) {
    await fresh(page, { sandbox: false, practice: true });
    controls = await stick(page, native);
    await controls.move(0, 0.5);
    await controls.tap("jump");
    await advance(page, 90);
    await controls.tap(action);
    const airborne = await until(
      page,
      (s) =>
        s.stance.action === action &&
        s.stance.phase !== "idle" &&
        s.polish.strike.action === action &&
        s.position[1] > 0.1,
      `Native aerial ${action}`,
    );
    assert.ok(airborne.position[1] > 0.1);
    assert.equal(
      airborne.stance.technique,
      action === "kick" ? "flying-kick" : "aerial-punch",
    );
    assert.ok(airborne.polish.strike.point.every(Number.isFinite));
    await controls.enter("block");
    await advance(page, 100);
    assert.equal(await page.locator("#stance-label").textContent(), "BLOCKING");
    await controls.stop();
  }
}

export async function checkSpeedEffects(page, native) {
  await fresh(page, { practice: true });
  await open(page, "speed-effects");
  await page.locator("#physics-reset").click();
  await setRange(page, "physics", { id: "movement", log: true }, 4);
  await setRange(
    page,
    "speed-effects",
    SPEED_EFFECT_PARAMETERS.find((p) => p.id === "sonicSpeed"),
    12,
  );
  await close(page);
  let controls = await stick(page, native);
  await controls.move(0, -0.25);
  await advance(page, 600);
  const slow = (await read(page)).polish.effects;
  assert.ok(
    slow.horizontalSpeed > 0 && slow.horizontalSpeed < slow.config.dustSpeed,
  );
  assert.equal(
    slow.dustEmissions,
    0,
    "Slow grounded movement does not emit superhuman-speed dust",
  );
  await controls.move(0, -1);
  const fast = await until(
    page,
    (s) =>
      s.polish.effects.horizontalSpeed > 8.5 &&
      s.polish.effects.actualSpeed > s.polish.effects.config.sonicSpeed &&
      s.polish.effects.dustEmissions > 0,
    "Actual sprint velocity emits grounded dust",
    { limit: 1600, step: 50 },
  );
  const burstCount = fast.polish.effects.sonicBursts;
  assert.equal(
    burstCount,
    1,
    "The first physical threshold crossing emits one sonic burst",
  );
  assert.equal(fast.polish.effects.sonicArmed, false);
  for (let n = 0; n < 8; n++) {
    await advance(page, 60);
    const effects = (await read(page)).polish.effects;
    assert.ok(effects.actualSpeed > effects.config.sonicSpeed * 0.8);
    assert.equal(
      effects.sonicBursts,
      burstCount,
      "Sustained speed cannot emit repeated sonic waves",
    );
    assert.ok(
      effects.activeDust <= SPEED_EFFECT_LIMITS.dust &&
        effects.activeRings <= SPEED_EFFECT_LIMITS.rings &&
        effects.activeStreaks <= SPEED_EFFECT_LIMITS.streaks,
      "Speed effects keep finite bounded pools",
    );
  }
  await controls.stop();
  await until(
    page,
    (s) => s.polish.effects.actualSpeed < 0.5 && s.polish.effects.sonicArmed,
    "Slowing below the hysteresis threshold rearms the sonic wave",
  );
  controls = await stick(page, native);
  await controls.move(0, -1);
  await until(
    page,
    (s) => s.polish.effects.sonicBursts === burstCount + 1,
    "A new real threshold crossing emits one rearmed sonic wave",
  );
  await advance(page, 120);
  assert.ok(
    (await read(page)).polish.effects.activeRings > 0,
    "The rearmed sonic wave remains visible during its bounded expansion",
  );
  await page.screenshot({ path: "test-results/v087-speed-pressure-wave.png" });
  await until(
    page,
    (s) => s.polish.effects.horizontalSpeed > 8.5,
    "Sprint settles before Jump",
  );
  await controls.tap("jump");
  const airborne = await until(
    page,
    (s) => s.position[1] > 0.3 && Number(s.stance.elevation) > 0.3,
    "Jump reaches an airborne physical HUD sample before checking dust",
    { limit: 700, step: 20 },
  );
  assert.ok(airborne.position[1] > 0.3);
  const airDust = airborne.polish.effects.dustEmissions;
  await advance(page, 180);
  const laterAir = await read(page);
  assert.ok(laterAir.position[1] > 0.3);
  assert.equal(
    laterAir.polish.effects.dustEmissions,
    airDust,
    "Existing particles may fade in flight, but airborne motion emits no ground dust",
  );
  await controls.stop();
  await fresh(page, { practice: true });
  await open(page, "speed-effects");
  await page.locator("#speed-effects-reset").click();
  await close(page);
}

const nearest = (s) =>
  s.enemies
    .filter((enemy) => enemy.health > 0)
    .sort(
      (a, b) =>
        Math.hypot(
          a.position[0] - s.position[0],
          a.position[2] - s.position[2],
        ) -
        Math.hypot(
          b.position[0] - s.position[0],
          b.position[2] - s.position[2],
        ),
    )[0];
async function toward(controls, state, target, magnitude) {
  const dx = target.position[0] - state.position[0],
    dz = target.position[2] - state.position[2];
  const distance = Math.hypot(dx, dz),
    yaw = state.camera.yaw;
  await controls.move(
    ((dx * Math.cos(yaw) - dz * Math.sin(yaw)) / Math.max(0.001, distance)) *
      magnitude,
    ((-dx * Math.sin(yaw) - dz * Math.cos(yaw)) / Math.max(0.001, distance)) *
      magnitude,
  );
  return distance;
}
export async function checkMagnetism(page, native) {
  await fresh(page);
  await advance(page, 750);
  let state = await read(page);
  assert.equal(
    state.polish.magnetism.enabled,
    false,
    "Optional attack magnetism starts off",
  );
  assert.equal(
    state.stance.sequence,
    "0",
    "Enemy proximity cannot start a manual player attack",
  );
  assert.equal(state.polish.magnetism.queries, 0);
  await open(page, "attack-magnetism");
  await page.locator("#attack-magnetism-enabled").check();
  await close(page);
  await fresh(page, { sandbox: false });
  assert.equal(
    (await read(page)).polish.magnetism.enabled,
    true,
    "The opt-in is applied in ordinary play",
  );
  let controls = await stick(page, native);
  let positioned = false;
  for (let n = 0; n < 65; n++) {
    state = await read(page);
    const target = nearest(state);
    assert.ok(target && Number(state.health) > 0);
    const distance = Math.hypot(
      target.position[0] - state.position[0],
      target.position[2] - state.position[2],
    );
    if (distance < 2.7 && distance > 1.4) {
      positioned = true;
      break;
    }
    await toward(controls, state, target, distance > 3.5 ? 0.6 : 0.25);
    await advance(page, 80);
  }
  assert.ok(
    positioned,
    "Native movement brings a real pursuing enemy within a short approach distance",
  );
  await controls.move(0, 0);
  await advance(page, 80);
  state = await read(page);
  const queriesBefore = state.polish.magnetism.queries;
  assert.equal(state.stance.sequence, "0");
  await controls.tap("kick");
  let acquired = false,
    physical = false,
    cancelledDuringApproach = false;
  let selected;
  for (let n = 0; n < 18; n++) {
    await advance(page, 20);
    state = await read(page);
    const magnetism = state.polish.magnetism;
    assert.ok(state.position.every(Number.isFinite));
    assert.ok(
      magnetism.traveled >= 0 && magnetism.traveled <= magnetism.budget + 1e-7,
    );
    assert.ok(
      magnetism.budget <= magnetism.config.maxApproach &&
        magnetism.duration <= 0.28 + 1e-8,
      "Manual approach retains its configured distance and short duration bounds",
    );
    if (magnetism.selectedTargetId) {
      acquired = true;
      selected ??= magnetism.selectedTargetId;
      assert.equal(
        magnetism.selectedTargetId,
        selected,
        "A captured strike never switches its target during execution",
      );
      assert.ok(
        state.enemies.some((enemy) => enemy.id === selected),
        "Magnetism selects an actual active enemy",
      );
    }
    physical ||= magnetism.traveled > 0.005;
    if (magnetism.active && physical) {
      await controls.enter("block");
      await advance(page, 100);
      state = await read(page);
      assert.equal(
        state.polish.magnetism.active,
        false,
        "Block ends a currently active physical approach",
      );
      assert.equal(
        await page.locator("#stance-label").textContent(),
        "BLOCKING",
      );
      cancelledDuringApproach = true;
      break;
    }
  }
  assert.ok(
    acquired && physical,
    "A manually initiated Kick makes a small physical approach to a real target",
  );
  assert.ok(
    cancelledDuringApproach,
    "Block is tested while the short approach is still active",
  );
  assert.equal(
    state.polish.magnetism.queries,
    queriesBefore + 1,
    "One accepted tap captures one target query",
  );
  assert.equal(state.stance.sequence, "1");
  await controls.stop();

  // A real contact screenshot also verifies that the new Kick presentation
  // still reaches collision-tested moving enemies rather than awarding hits.
  await fresh(page, { sandbox: false });
  controls = await stick(page, native);
  await controls.enter("kick");
  let contact = false;
  for (let n = 0; n < 200; n++) {
    state = await read(page);
    const contactCount = state.contacts;
    assert.ok(
      Number(state.health) > 0,
      "Manual attacks remain usable during the live encounter",
    );
    const target = nearest(state);
    if (target) {
      const distance = Math.hypot(
        target.position[0] - state.position[0],
        target.position[2] - state.position[2],
      );
      await toward(
        controls,
        state,
        target,
        distance > 1.15 ? 0.6 : distance > 0.75 ? 0.23 : 0.1,
      );
    }
    await advance(page, 40);
    state = await read(page);
    const damaged =
      state.enemies.some((enemy) => enemy.health > 0 && enemy.health < 72) ||
      Number(state.defeated) > 0;
    const hitRealEnemy = state.enemies.some(
      (enemy) => enemy.id === state.polish.strike.lastContactTargetId,
    );
    if (
      damaged &&
      hitRealEnemy &&
      state.contacts > contactCount &&
      state.stance.action === "kick" &&
      ["extension", "impact"].includes(state.stance.phase)
    ) {
      await page.screenshot({
        path: "test-results/v087-kick-live-contact.png",
      });
      contact = true;
      break;
    }
  }
  assert.ok(
    contact,
    "Manual native Kicks visibly contact and damage real moving targets",
  );
  await controls.stop();

  await fresh(page, { sandbox: false });
  await page.locator("#game-mode").selectOption("tag");
  await advance(page, 180);
  state = await read(page);
  const tagQueries = state.polish.magnetism.queries;
  const tagHealth = state.enemies.map((enemy) => [enemy.id, enemy.health]);
  controls = await stick(page, native);
  await controls.tap("kick");
  await advance(page, 180);
  state = await read(page);
  assert.equal(state.mode, "tag");
  assert.equal(state.polish.magnetism.active, false);
  assert.equal(
    state.polish.magnetism.queries,
    tagQueries,
    "Opted-in Combat assistance never acquires Tag runners",
  );
  assert.equal(
    state.polish.magnetism.traveled,
    0,
    "Tag Mode never receives an attack approach",
  );
  assert.deepEqual(
    state.enemies.map((enemy) => [enemy.id, enemy.health]),
    tagHealth,
    "A remote manual Kick cannot award damage to Tag runners",
  );
  assert.equal(state.tags, "0", "Manual attacks never award a remote Tag");
  await controls.stop();
  await fresh(page);
  await resetNew(page);
}

/** v0.8.7 acceptance: native touch/keyboard UI, read-only production telemetry.
 * No actor writes, synthetic DOM input events, storage seeding or debug hooks. */
export async function checkV087Polish(page, native) {
  await page.setViewportSize({ width: 844, height: 390 });
  await fresh(page, { practice: true });
  assert.equal(await page.locator(".version b").textContent(), "0.8.7");
  const independent = await unrelated(page);
  await checkSettings(page, native);
  console.log("PASS: v0.8.7 polish settings locks, native panning/multitouch and independent ordinary-play persistence");
  await checkManualFlow(page, native);
  console.log("PASS: v0.8.7 native tap/held/slide/recovery combos, Block and moving/aerial strikes");
  await checkSpeedEffects(page, native);
  console.log("PASS: v0.8.7 actual-speed grounded dust and one-shot/rearmed sonic effects");
  await checkMagnetism(page, native);
  console.log("PASS: v0.8.7 optional bounded manual Combat approach, physical Kick contact and Tag isolation");
  assert.deepEqual(
    await unrelated(page),
    independent,
    "v087 acceptance preserves every unrelated preference byte",
  );
  console.log(
    "PASS: v0.8.7 native Punch/Kick taps, held/recovery combos and slides, moving/aerial strikes and Block; independent saved polish settings, slider locks/scroll/multitouch; physical-speed dust and one-shot/rearmed sonic waves; optional bounded manual Combat approach and Tag isolation. No physical Android device tested.",
  );
}
