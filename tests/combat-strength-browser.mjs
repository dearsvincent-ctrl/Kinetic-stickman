import assert from "node:assert/strict";
import { stick } from "./acrobatic-browser.mjs";
const advance = (p, ms) => p.clock.runFor(ms);
const read = (p) =>
  p
    .locator("#battle-status")
    .evaluate((e) => ({
      ...e.dataset,
      position: JSON.parse(e.dataset.position),
      enemies: JSON.parse(e.dataset.enemies),
      strength: JSON.parse(e.dataset.strength),
    }));
async function open(p) {
  await p.locator("#physics-toggle").click();
}
async function tune(p, values) {
  await p.evaluate((values) => {
    for (const [id, n] of Object.entries(values)) {
      const e = document.querySelector("#physics-" + id);
      e.value = n;
      e.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }, values);
}
async function engage(p, native, action, predicate) {
  const s = await stick(p, native);
  await s.move(0, 0);
  await s.enter(action);
  let found = false;
  for (let n = 0; n < 100; n++) {
    const a = await read(p);
    assert.ok(Number(a.health) > 0);
    const live = a.enemies
      .filter((e) => e.health > 0)
      .sort(
        (a1, b) =>
          Math.hypot(
            a1.position[0] - a.position[0],
            a1.position[2] - a.position[2],
          ) -
          Math.hypot(
            b.position[0] - a.position[0],
            b.position[2] - a.position[2],
          ),
      );
    if (live.length) {
      const e = live[0],
        dx = e.position[0] - a.position[0],
        dz = e.position[2] - a.position[2],
        d = Math.hypot(dx, dz),
        m = d > 1.8 ? 0.9 : d > 0.8 ? 0.4 : 0.15;
      await s.move(
        (dx / Math.max(0.001, d)) * m,
        (-dz / Math.max(0.001, d)) * m,
      );
    }
    await advance(p, 80);
    const b = await read(p);
    if (predicate(b)) {
      found = true;
      break;
    }
  }
  await s.stop();
  assert.ok(
    found,
    "Manual " + action + " produces configured physical damage/impact",
  );
}
export async function checkCombatStrength(page, native) {
  const url = new URL("?sandbox=1", page.url());
  await page.evaluate(() => {
    localStorage.removeItem("kinetic.physics-sandbox.v1");
    localStorage.removeItem("kinetic.enemy-settings.v1");
  });
  await page.goto(url.href, { waitUntil: "networkidle" });
  await advance(page, 450);
  await open(page);
  assert.equal(await page.locator("#physics-fields .physics-row").count(), 8);
  assert.equal(
    await page.locator("#strength-controls .physics-row").count(),
    2,
  );
  for (const id of ["attackPower", "impact"]) {
    const e = page.locator("#physics-" + id);
    assert.equal(await e.inputValue(), "1");
    assert.equal(await e.getAttribute("min"), "0");
    assert.equal(await e.getAttribute("max"), "100");
  }
  const independent = await page.evaluate(() => ({
    aim: localStorage.getItem("kinetic.aim-assist.v1"),
    layout: localStorage.getItem("kinetic.controls.v1"),
  }));
  await tune(page, { attackPower: 0.2, impact: 100 });
  await advance(page, 100);
  assert.deepEqual((await read(page)).strength, {
    attackPower: 0.2,
    impact: 100,
  });
  await page.locator("#physics-save").click();
  await page.reload({ waitUntil: "networkidle" });
  await advance(page, 450);
  await open(page);
  assert.equal(await page.locator("#physics-attackPower").inputValue(), "0.2");
  assert.equal(await page.locator("#physics-impact").inputValue(), "100");
  await page.setViewportSize({ width: 360, height: 740 });
  for (const id of ["attackPower", "impact"]) {
    const e = page.locator("#physics-" + id);
    await e.scrollIntoViewIfNeeded();
    const b = await e.boundingBox();
    assert.ok(b.x >= 0 && b.x + b.width <= 360.1 && b.height >= 20);
  }
  await page.screenshot({ path: "test-results/v083-strength-portrait.png" });
  await page.setViewportSize({ width: 844, height: 390 });
  await page.locator("#physics-reset").click();
  await advance(page, 100);
  assert.deepEqual((await read(page)).strength, { attackPower: 1, impact: 1 });
  assert.deepEqual(
    await page.evaluate(() => ({
      aim: localStorage.getItem("kinetic.aim-assist.v1"),
      layout: localStorage.getItem("kinetic.controls.v1"),
    })),
    independent,
  );
  await tune(page, { attackPower: 0, impact: 100 });
  await page.locator("#physics-close").click();
  await page.evaluate(() => document.activeElement?.blur());
  await engage(page, native, "punch", (a) =>
    a.enemies.some((e) => e.health === 72 && Math.max(Math.hypot(...e.impulse), Math.hypot(...(e.reaction?.velocity ?? [0,0,0]))) > 20),
  );
  console.log(
    "PASS: native 0x damage / 100x impact yields real enemy impulse with unchanged health; independent live/save/refresh/reset strength and portrait controls",
  );
  await page.evaluate(() =>
    localStorage.removeItem("kinetic.physics-sandbox.v1"),
  );
  await page.goto(url.href, { waitUntil: "networkidle" });
  await advance(page, 450);
  await open(page);
  await tune(page, { attackPower: 100, impact: 0 });
  await page.locator("#physics-close").click();
  await page.evaluate(() => document.activeElement?.blur());
  await engage(
    page,
    native,
    "kick",
    (a) =>
      Number(a.defeated) > 0 &&
      a.enemies.some((e) => e.health === 0 && Math.hypot(...e.impulse) === 0),
  );
  console.log(
    "PASS: native 100x damage / 0x impact defeats through manual Kick without knockback; attack inputs and waves remain responsive",
  );
  await open(page);
  await page.locator("#physics-reset").click();
  await page.locator("#physics-save").click();
  await page.locator("#physics-close").click();
}
