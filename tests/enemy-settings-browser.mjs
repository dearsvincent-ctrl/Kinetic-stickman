import assert from "node:assert/strict";
import { unlockSlider } from "./slider-test-utils.mjs";
import { stick } from "./acrobatic-browser.mjs";
const read = (p) =>
  p.locator("#battle-status").evaluate((e) => ({
    ...e.dataset,
    config: JSON.parse(e.dataset.enemySettings),
    enemies: JSON.parse(e.dataset.enemies),
    position: JSON.parse(e.dataset.position),
  }));
const tune = (p, values) =>
  p.evaluate((values) => {
    for (const [id, v] of Object.entries(values)) {
      const input = document.querySelector("#enemy-" + id);
      input.value = [
        "speed",
        "acceleration",
        "detection",
        "disengagement",
      ].includes(id)
        ? Math.log10(v)
        : v;
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }, values);
const point = async (p, s) => {
  const b = await p.locator(s).boundingBox();
  assert.ok(b, s);
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
};
const touch = (id, p) => ({ id, ...p, radiusX: 7, radiusY: 7, force: 1 });
async function open(p) {
  await p.locator("#physics-toggle").click();
  if (!(await p.locator("#enemy-settings").evaluate((e) => e.open)))
    await p.locator("#enemy-settings > summary").click();
}
export async function checkEnemySettings(page, native) {
  await page.evaluate(() =>
    localStorage.removeItem("kinetic.enemy-settings.v1"),
  );
  await page.setViewportSize({ width: 844, height: 390 });
  await page.goto(new URL("?sandbox=1", page.url()).href, {
    waitUntil: "networkidle",
  });
  await page.clock.runFor(450);
  assert.equal(await page.locator(".version b").textContent(), "0.9.0");
  let state = await read(page);
  assert.equal(state.alive, "3");
  assert.equal(state.config.speed, 1);
  assert.equal(state.config.maxEnemies, 8);
  await open(page);
  assert.equal(
    await page.locator("#enemy-settings-controls .physics-row").count(),
    7,
  );
  assert.equal(await page.locator("#physics-fields .physics-row").count(), 8);
  await tune(page, { attackFrequency: 0, maxEnemies: 16, speed: 5 });
  await page.clock.runFor(120);
  await page.locator("#enemy-acceleration").scrollIntoViewIfNeeded();
  await unlockSlider(page, "enemy-acceleration");
  const c = await point(page, "#joystick"),
    jb = await page.locator("#joystick").boundingBox();
  const joy = touch(1, { x: c.x, y: c.y - jb.width * 0.34 * 0.4 });
  await native("touchStart", [joy]);
  const range = await page.locator("#enemy-acceleration").boundingBox();
  let slider = touch(2, { x: range.x + 8, y: range.y + range.height / 2 });
  await native("touchStart", [joy, slider], [slider]);
  slider = touch(2, {
    x: range.x + range.width * 0.76,
    y: range.y + range.height / 2,
  });
  await native("touchMove", [joy, slider], [slider]);
  await native("touchEnd", [slider], [slider]);
  await page.clock.runFor(180);
  assert.ok((await read(page)).config.acceleration > 5);
  assert.ok(Number(await page.locator("#speed-value").textContent()) > 0);
  await native("touchCancel", [], [joy]);
  await page.locator("#enemy-acceleration").focus();
  await page.keyboard.press("Home");
  await page.keyboard.press("Space");
  await page.clock.runFor(80);
  assert.equal(
    await page.locator("#jump-button").getAttribute("data-jump-sequence"),
    "0",
  );
  await tune(page, {
    speed: 20,
    acceleration: 3,
    aggression: 2.2,
    attackFrequency: 0,
    maxEnemies: 24,
    detection: 2000,
    disengagement: 3000,
  });
  await page.clock.runFor(120);
  state = await read(page);
  assert.equal(state.alive, "24");
  assert.match(
    await page.locator("#enemy-performance").textContent(),
    /Experimental crowd/,
  );
  await page.locator("#enemy-save").click();
  await page.locator("#physics-close").click();
  await page.reload({ waitUntil: "networkidle" });
  await page.clock.runFor(450);
  state = await read(page);
  assert.equal(state.config.speed, 20);
  assert.equal(state.config.maxEnemies, 24);
  assert.equal(state.alive, "24");
  assert.equal(state.config.attackFrequency, 0);
  await open(page);
  await tune(page, { speed: 0.1, maxEnemies: 2 });
  await page.locator("#enemy-load").click();
  await page.clock.runFor(100);
  assert.equal((await read(page)).config.speed, 20);
  assert.equal((await read(page)).alive, "24");
  // Every layout remains horizontally contained, with usable independently
  // scrollable controls in portrait and two Android landscape sizes.
  for (const size of [
    { width: 390, height: 844 },
    { width: 740, height: 360 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(size);
    await page.locator("#enemy-maxEnemies").scrollIntoViewIfNeeded();
    const b = await page.locator("#physics-panel").boundingBox();
    assert.ok(
      b.x >= 0 &&
        b.x + b.width <= size.width + 0.5 &&
        b.y + b.height <= size.height + 0.5,
    );
    assert.ok(
      await page
        .locator(".physics-scroll")
        .evaluate((e) => e.scrollWidth <= e.clientWidth + 1),
    );
  }
  await page.screenshot({ path: "test-results/v082-enemy-settings.png" });
  await tune(page, {
    speed: 1000,
    acceleration: 100,
    maxEnemies: 64,
    attackFrequency: 0,
    detection: 4000,
    disengagement: 6000,
  });
  await page.locator("#physics-close").click();
  await page.evaluate(() => document.activeElement?.blur());
  const before = await read(page),
    s = await stick(page, native);
  await s.move(1, 0);
  await s.tap("jump");
  await page.clock.runFor(160);
  await s.tap("jump");
  await s.enter("punch");
  await page.clock.runFor(120);
  await s.enter("block");
  await page.clock.runFor(100);
  await s.enter("kick");
  await page.clock.runFor(160);
  await s.stop();
  state = await read(page);
  assert.equal(state.alive, "64");
  assert.equal(
    state.health,
    before.health,
    "High-speed proximity alone never damages the player",
  );
  assert.ok(
    state.enemies.every(
      (e) =>
        e.position.every(Number.isFinite) && e.velocity.every(Number.isFinite),
    ),
  );
  assert.ok(
    state.enemies.some(
      (e, i) =>
        Math.hypot(
          e.position[0] - before.enemies[i]?.position[0],
          e.position[2] - before.enemies[i]?.position[2],
        ) > 0.5,
    ),
  );
  assert.equal(await page.locator("#dash-button,#sprint-button").count(), 0);
  await page.screenshot({ path: "test-results/v082-extreme-crowd.png" });
  console.log(
    "PASS: native Enemy Settings sliders retain joystick ownership; live population, persistence, reset/load, responsive layouts and 64-enemy extreme pursuit preserve double jumps and Punch/Block/Kick slides without proximity damage",
  );
  await open(page);
  await page.locator("#enemy-reset").click();
  await page.clock.runFor(100);
  state = await read(page);
  assert.equal(state.config.speed, 1);
  assert.equal(state.config.maxEnemies, 8);
  assert.ok(Number(state.alive) <= 8);
  await page.locator("#enemy-save").click();
  await page.locator("#physics-close").click();
  await open(page);
  await page.locator('[data-enemy-preset="Slow"]').click();
  await page.clock.runFor(80);
  assert.equal((await read(page)).config.speed, 0.5);
  assert.equal((await read(page)).alive, "3");
  await page.locator('[data-enemy-preset="Relentless"]').click();
  await page.clock.runFor(80);
  assert.equal((await read(page)).config.speed, 20);
  assert.equal((await read(page)).alive, "24");
  await page.locator('[data-enemy-preset="Normal"]').click();
  await page.locator("#enemy-save").click();
  await page.locator("#physics-close").click();
}
