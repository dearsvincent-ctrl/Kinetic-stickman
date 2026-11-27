import assert from "node:assert/strict";
import { stick } from "./acrobatic-browser.mjs";
import {
  advance,
  read,
  fresh,
  open,
  close,
  until,
  setRange,
} from "./v087-polish-browser.mjs";
import {
  REACTION_PARAMETERS,
  REACTION_SETTINGS_KEY,
} from "../src/sandbox/ReactionSettings.js";
import { ENEMY_PARAMETERS } from "../src/sandbox/EnemySettings.js";
import { unlockSlider } from "./slider-test-utils.mjs";

const section = "enemy-reactions";
const living = (s) => s.enemies.filter((e) => e.health > 0);
const gap = (s, e) =>
  Math.hypot(...e.position.map((x, i) => x - s.position[i]));
async function toward(controls, s, e, m = 0.35) {
  const x = e.position[0] - s.position[0],
    z = e.position[2] - s.position[2],
    d = Math.max(0.001, Math.hypot(x, z)),
    yaw = s.camera.yaw;
  await controls.move(
    ((x * Math.cos(yaw) - z * Math.sin(yaw)) / d) * m,
    ((-x * Math.sin(yaw) - z * Math.cos(yaw)) / d) * m,
  );
}
async function encounter(page, impact) {
  await fresh(page);
  await open(page, section);
  await page.locator(`#${section}-reset`).click();
  await open(page, "enemy-settings");
  await page.locator("#physics-reset").click();
  await page.locator("#enemy-reset").click();
  for (const [id, value] of [
    ["speed", 0.1],
    ["attackFrequency", 0],
    ["maxEnemies", 3],
  ])
    await setRange(
      page,
      "enemy-settings",
      { ...ENEMY_PARAMETERS.find((p) => p.id === id), prefix: "enemy" },
      value,
    );
  for (const [id, value] of [
    ["attackPower", 0],
    ["impact", impact],
  ])
    await setRange(page, "physics", { id }, value);
  await open(page, "speed-effects");
  await page.locator("#speed-effects-sonicEnabled").uncheck();
  await open(page, "freeflow-combat");
  await page.locator("#freeflow-combat-reset").click();
  await close(page);
}
async function contact(page, native, action) {
  const controls = await stick(page, native);
  for (let i = 0; i < 100; i++) {
    const s = await read(page),
      enemy = living(s).sort((a, b) => gap(s, a) - gap(s, b))[0];
    assert.ok(enemy);
    if (gap(s, enemy) <= 9 && gap(s, enemy) >= 4) {
      await toward(controls, s, enemy, 0.25);
      await advance(page, 20);
      break;
    }
    await toward(controls, s, enemy, gap(s, enemy) > 9 ? 0.6 : -0.6);
    await advance(page, 80);
  }
  const before = await read(page);
  await controls.tap(action);
  const hit = await until(
    page,
    (s) =>
      s.polish.strike.contacts > before.polish.strike.contacts &&
      s.polish.strike.sequence > before.polish.strike.sequence,
    `v090 native ${action} makes physical contact`,
    { limit: 2400, step: 20 },
  );
  assert.equal(hit.polish.strike.sequence, before.polish.strike.sequence + 1);
  const enemy = hit.enemies.find(
    (e) => e.id === hit.polish.strike.lastContactTargetId,
  );
  assert.ok(enemy?.reaction.sequence > 0, JSON.stringify({ enemy, hit }));
  assert.equal(
    enemy.health,
    before.enemies.find((e) => e.id === enemy.id).health,
    "0× damage never reduces health despite real impact",
  );
  await controls.move(0, 0);
  await controls.stop();
  return { before, hit, enemy };
}
async function checkSettings(page) {
  await fresh(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, section);
  await page.locator(`#${section}-reset`).click();
  const all = page.locator(`#${section} input[type=range]`);
  assert.equal(await all.count(), REACTION_PARAMETERS.length);
  assert.ok(
    await all.evaluateAll((xs) =>
      xs.every((x) => x.disabled && x.dataset.sliderLocked === "true"),
    ),
  );
  for (const p of REACTION_PARAMETERS)
    assert.equal(
      await page.locator(`[data-slider-lock="${section}-${p.id}"]`).count(),
      1,
    );
  const cdp = await page.context().newCDPSession(page);
  const slider = page.locator(`#${section}-intensity`);
  async function swipe(dx, dy) {
    await slider.evaluate((node) =>
      node.scrollIntoView({ block: "center", inline: "nearest" }),
    );
    const b = await slider.boundingBox(),
      x = b.x + b.width * 0.4,
      y = b.y + b.height / 2;
    const touch = (x, y) => ({
      id: 71,
      x,
      y,
      radiusX: 7,
      radiusY: 7,
      force: 1,
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [touch(x, y)],
    });
    for (let i = 1; i <= 6; i++) {
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [touch(x + (dx * i) / 6, y + (dy * i) / 6)],
      });
      await advance(page, 20);
    }
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await advance(page, 80);
  }
  try {
    const initial = await slider.inputValue();
    await swipe(60, 0);
    assert.equal(await slider.inputValue(), initial);
    for (const unlocked of [false, true]) {
      if (unlocked) await unlockSlider(page, `${section}-intensity`);
      await slider.evaluate((node) =>
        node.scrollIntoView({ block: "center", inline: "nearest" }),
      );
      const scroll = page.locator(".physics-scroll"),
        top = await scroll.evaluate((n) => n.scrollTop);
      await swipe(1, -90);
      assert.ok(
        (await scroll.evaluate((n) => n.scrollTop)) > top + 10,
        `Native vertical scroll with range ${unlocked ? "unlocked" : "locked"}`,
      );
      assert.equal(await slider.inputValue(), initial);
    }
    await slider.press("ArrowRight");
    assert.equal(Number(await slider.inputValue()), 1.05);
    assert.ok(
      await all.evaluateAll((xs) => xs.filter((x) => !x.disabled).length === 1),
    );
    await page.locator(`#${section} > summary`).click();
    await page.locator(`#${section} > summary`).click();
    await advance(page);
    assert.ok(await all.evaluateAll((xs) => xs.every((x) => x.disabled)));
    const saved = await page.evaluate(
      (key) => localStorage.getItem(key),
      REACTION_SETTINGS_KEY,
    );
    assert.equal(JSON.parse(saved).values.intensity, 1.05);
    await fresh(page);
    await open(page, section);
    assert.equal(Number(await slider.inputValue()), 1.05);
    assert.ok(await all.evaluateAll((xs) => xs.every((x) => x.disabled)));
    await page.locator(`#${section}-reset`).click();
    assert.equal(Number(await slider.inputValue()), 1);
  } finally {
    await cdp.detach();
    await close(page);
    await page.setViewportSize({ width: 844, height: 390 });
  }
  console.log(
    "PASS: v090 native locked/unlocked vertical scrolling, independent locks, live settings, isolated save/refresh/reset",
  );
}
export async function checkReactions(page, native) {
  await checkSettings(page);
  await encounter(page, 1);
  const light = await contact(page, native, "punch");
  assert.ok(["recoil", "stumble"].includes(light.enemy.reaction.phase));
  assert.equal(light.enemy.reaction.ragdoll, false);
  await advance(page, 900);
  assert.equal(
    (await read(page)).enemies.find((e) => e.id === light.enemy.id).reaction
      .phase,
    "idle",
  );
  console.log(
    "PASS: v090 native light punch recoil, real physical contact, no automatic ragdoll or damage",
  );

  await encounter(page, 20);
  const heavy = await contact(page, native, "kick");
  assert.ok(
    ["flight", "knockdown", "fallen"].includes(heavy.enemy.reaction.phase),
  );
  assert.equal(heavy.enemy.reaction.ragdoll, true, JSON.stringify(heavy));
  assert.equal(
    heavy.hit.polish.freeflow.active,
    false,
    "Freeflow stops approaching a launched victim after actual contact",
  );
  await page.screenshot({ path: "test-results/v090-severe-contact.png" });
  let travel = 0,
    rotated = false;
  for (let i = 0; i < 25; i++) {
    await advance(page, 40);
    const s = await read(page),
      e = s.enemies.find((e) => e.id === heavy.enemy.id);
    assert.ok(e);
    travel = Math.max(
      travel,
      Math.hypot(...e.position.map((x, j) => x - heavy.enemy.position[j])),
    );
    rotated ||= Math.hypot(...e.reaction.orientation.slice(0, 3)) > 0.05;
    assert.ok(
      [...e.position, ...e.reaction.velocity, ...e.reaction.orientation].every(
        Number.isFinite,
      ),
    );
    assert.ok(Math.abs(Math.hypot(...e.reaction.orientation) - 1) < 1e-5);
  }
  assert.ok(
    travel > 4,
    "Strong contact causes continuous physical travel, not a visual recoil only",
  );
  assert.ok(rotated, "Launched body has independent quaternion rotation");
  await page.screenshot({ path: "test-results/v090-launched-reaction.png" });
  await until(
    page,
    (s) =>
      s.enemies.find((e) => e.id === heavy.enemy.id)?.reaction.phase === "idle",
    "Alive enemy lands and recovers",
    { limit: 7000, step: 80 },
  );
  console.log(
    "PASS: v090 native severe kick, selective ragdoll, quaternion flight, Freeflow contact cancellation, landing and alive recovery",
  );

  await page.locator("#game-mode").selectOption("tag");
  await advance(page, 200);
  const tagBefore = await read(page),
    controls = await stick(page, native);
  await controls.tap("kick");
  await advance(page, 700);
  await controls.stop();
  const tag = await read(page);
  assert.equal(tag.mode, "tag");
  assert.ok(
    tag.enemies.every((e) => e.reaction.phase === "idle" && e.health > 0),
  );
  assert.equal(tag.polish.freeflow.active, false);
  assert.equal(tag.health, tagBefore.health);
  await page.locator("#game-mode").selectOption("combat");
  await advance(page, 200);
  await open(page, section);
  await page.locator(`#${section}-reset`).click();
  await page.locator("#physics-reset").click();
  await close(page);
  console.log(
    "PASS: v090 Tag Mode suppresses combat reactions and restores Combat Mode safely",
  );
}
