import { expandDeveloperSections } from "./slider-test-utils.mjs";
import assert from "node:assert/strict";
import { stick } from "./acrobatic-browser.mjs";
import { unlockSlider } from "./slider-test-utils.mjs";
import { ANIMATION_PARAMETERS } from "../src/sandbox/AnimationSettings.js";
import { SPEED_EFFECT_PARAMETERS } from "../src/sandbox/SpeedEffectsSettings.js";
import { FREEFLOW_PARAMETERS } from "../src/sandbox/FreeflowSettings.js";
import { checkFreeflow } from "./v088-freeflow-browser.mjs";
import { SPEED_EFFECT_LIMITS } from "../src/world/SpeedEffects.js";

export const advance = (page, ms = 80) => page.clock.runFor(ms);
const KEYS = [
  "kinetic.animation-presentation.v1",
  "kinetic.speed-effects.v1",
  "kinetic.freeflow.v1",
];
const SECTIONS = [
  ["animation-polish", ANIMATION_PARAMETERS],
  ["speed-effects", SPEED_EFFECT_PARAMETERS],
  ["freeflow-combat", FREEFLOW_PARAMETERS],
];
const touch = (id, p) => ({ id, ...p, radiusX: 7, radiusY: 7, force: 1 });
const point = async (page, selector) => {
  const b = await page.locator(selector).boundingBox();
  assert.ok(b, `${selector} has a native touch target`);
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
};
export const read = (page) =>
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
          .filter(
            (key) => !keys.includes(key) && key !== "kinetic.developer-menu.v1",
          )
          .sort()
          .map((key) => [key, localStorage.getItem(key)]),
      ),
    KEYS,
  );
export async function fresh(page, { sandbox = true, practice = false } = {}) {
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
export async function open(page, section) {
  if (await page.locator("#physics-panel").evaluate((node) => node.hidden))
    await page.locator("#physics-toggle").click();
  await expandDeveloperSections(page);
  if (!(await page.locator(`#${section}`).evaluate((node) => node.open)))
    await page.locator(`#${section} > summary`).click();
  await advance(page);
}
export async function close(page) {
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
export async function until(
  page,
  predicate,
  label,
  { limit = 2000, step = 20 } = {},
) {
  for (let elapsed = 0; elapsed <= limit; elapsed += step) {
    const state = await read(page);
    if (predicate(state)) return state;
    await advance(page, step);
  }
  assert.fail(`${label}: ${JSON.stringify(await read(page))}`);
}

/** Real range keyboard operation after an individual unlock. PageUp/Down
 * covers large logarithmic ranges; arrow keys finish at the nearest step. */
export async function setRange(page, section, parameter, value) {
  if (section === "physics") {
    if (await page.locator("#physics-panel").evaluate((node) => node.hidden))
      await page.locator("#physics-toggle").click();
    await expandDeveloperSections(page);
  } else await open(page, section);
  const id = `${parameter.prefix ?? section}-${parameter.id}`;
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
export async function resetNew(page) {
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
  await slider.evaluate((node) =>
    node.scrollIntoView({ block: "center", inline: "nearest" }),
  );
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
  assert.equal((await read(page)).polish.freeflow.enabled, true);
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
  await slider.evaluate((node) =>
    node.scrollIntoView({ block: "center", inline: "nearest" }),
  );
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
    "freeflow-combat",
    FREEFLOW_PARAMETERS.find((p) => p.id === "range"),
    4,
  );
  await page.locator("#freeflow-combat-enabled").uncheck();
  await advance(page);
  const saved = await page.evaluate(
    (keys) => keys.map((key) => JSON.parse(localStorage.getItem(key))),
    KEYS,
  );
  assert.ok(saved.every((entry) => entry.version === 1));
  assert.equal(saved[0].values.sprintAggression, 0.6);
  assert.equal(saved[1].values.dustIntensity, 1.5);
  assert.equal(saved[1].values.sonicEnabled, false);
  assert.equal(saved[2].values.enabled, false);
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
      .locator("#animation-polish,#speed-effects,#freeflow-combat")
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
  assert.equal(ordinary.polish.freeflow.config.enabled, false);
  assert.equal(ordinary.polish.freeflow.config.range, 4);
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
      completed.polish.freeflow.selectedTargetId,
      null,
      "The isolated practice fixture has no active enemy acquisition",
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

/** v0.8.8 acceptance: native touch/keyboard UI, read-only production telemetry.
 * No actor writes, synthetic DOM input events, storage seeding or debug hooks. */
export async function checkV087Polish(page, native) {
  await page.setViewportSize({ width: 844, height: 390 });
  await fresh(page, { practice: true });
  assert.equal(await page.locator(".version b").textContent(), "0.9.3");
  const independent = await unrelated(page);
  await checkSettings(page, native);
  console.log(
    "PASS: v0.8.8 polish settings locks, native panning/multitouch and independent ordinary-play persistence",
  );
  await checkManualFlow(page, native);
  console.log(
    "PASS: v0.8.8 native tap/held/slide/recovery combos, Block and moving/aerial strikes",
  );
  await checkSpeedEffects(page, native);
  console.log(
    "PASS: v0.8.8 actual-speed grounded dust and one-shot/rearmed sonic effects",
  );
  await checkFreeflow(page, native);
  console.log(
    "PASS: v0.8.8 strong manual Combat freeflow approach, physical Kick contact and Tag isolation",
  );
  assert.deepEqual(
    await unrelated(page),
    independent,
    "v088 acceptance preserves every unrelated preference byte",
  );
  console.log(
    "PASS: v0.8.8 native Punch/Kick taps, held/recovery combos and slides, moving/aerial strikes and Block; independent saved polish settings, slider locks/scroll/multitouch; physical-speed dust and one-shot/rearmed sonic waves; strong manual Combat freeflow approach and Tag isolation. No physical Android device tested.",
  );
}
