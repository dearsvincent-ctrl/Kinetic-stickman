import { expandDeveloperSections } from "./slider-test-utils.mjs";
import assert from "node:assert/strict";
import { stick } from "./acrobatic-browser.mjs";
const advance = (p, ms) => p.clock.runFor(ms);
const read = (p) =>
  p.evaluate(() => ({
    position: JSON.parse(
      document.querySelector("#battle-status").dataset.position,
    ),
    zone: document.querySelector("#battle-status").dataset.worldZone,
    ...document.querySelector("#stance-label").dataset,
  }));
async function tune(p, n) {
  await p.locator("#physics-toggle").click();
  await expandDeveloperSections(p);
  await p.locator("#physics-movement").evaluate((e, n) => {
    e.value = Math.log10(n);
    e.dispatchEvent(new Event("input", { bubbles: true }));
  }, n);
  await p.locator("#physics-close").click();
  await p.evaluate(() => document.activeElement?.blur());
}
async function travel(p, s, x, z) {
  for (const [scale, stop, limit] of [
    [20, 28, 180],
    [3, 4, 180],
    [1, 0.2, 240],
  ]) {
    await tune(p, scale);
    for (let n = 0; n < limit; n++) {
      const a = await read(p),
        dx = x - a.position[0],
        dz = z - a.position[2],
        d = Math.hypot(dx, dz);
      if (d < stop) break;
      const m = scale === 1 ? Math.max(0.22, Math.min(0.55, d * 0.5)) : 1;
      await s.move((dx / d) * m, (-dz / d) * m);
      await advance(p, scale === 1 ? 60 : 80);
    }
    await s.move(0, 0);
    await advance(p, 350);
  }
  const a = await read(p);
  assert.ok(
    Math.hypot(a.position[0] - x, a.position[2] - z) < 0.45,
    JSON.stringify(a),
  );
}
async function until(p, predicate, limit = 18000) {
  for (let t = 0; t < limit; t += 100) {
    await advance(p, 100);
    const s = await read(p);
    assert.ok(s.position.every(Number.isFinite));
    if (predicate(s)) return s;
  }
  throw Error("World route timed out: " + JSON.stringify(await read(p)));
}
export async function checkGeometricWorld(page, native) {
  const original = new URL(page.url()),
    url = new URL(page.url());
  url.searchParams.set("practice", "1");
  url.searchParams.set("sandbox", "1");
  await page.setViewportSize({ width: 844, height: 390 });
  await page.evaluate(() =>
    localStorage.removeItem("kinetic.physics-sandbox.v1"),
  );
  await page.goto(url.href, { waitUntil: "networkidle" });
  await advance(page, 450);
  assert.equal(await page.locator(".version b").textContent(), "0.9.3");
  let s = await stick(page, native);
  await s.move(0, 0);
  await travel(page, s, -130, 0);
  await travel(page, s, -130, -75);
  await s.move(0, 1);
  const seen = new Set();
  await until(page, (a) => {
    seen.add(a.parkour);
    return (
      a.position[1] > 13.9 &&
      a.parkourExit === "rooftop" &&
      a.parkour === "free"
    );
  });
  assert.ok(seen.has("vault") && seen.has("climb"));
  assert.equal((await read(page)).zone, "Block city");
  await s.move(0, 0);
  await advance(page, 350);
  await page.screenshot({ path: "test-results/v083-city-rooftop.png" });
  await s.tap("jump");
  await advance(page, 150);
  await s.move(0, 0.25);
  await s.tap("jump");
  await advance(page, 100);
  assert.equal((await read(page)).acroKind, "frontflip");
  await s.enter("kick");
  await advance(page, 120);
  assert.equal((await read(page)).action, "kick");
  await s.stop();
  await advance(page, 1800);
  assert.ok(Math.abs((await read(page)).position[1] - 14) < 0.05);
  console.log(
    "PASS: native high-speed city approach, entry vault, wall climb, rooftop, directional double jump and manual aerial Kick",
  );
  await page.goto(url.href, { waitUntil: "networkidle" });
  await advance(page, 450);
  s = await stick(page, native);
  await s.move(0, 0);
  await travel(page, s, 135, 0);
  await travel(page, s, 135, -100);
  await s.move(0, 1);
  await until(
    page,
    (a) =>
      a.position[1] > 37.9 &&
      a.parkourExit === "rooftop" &&
      a.parkour === "free",
    20000,
  );
  await s.move(0, 0);
  await advance(page, 350);
  assert.equal((await read(page)).zone, "Geometric jungle");
  await page.screenshot({ path: "test-results/v083-jungle-rooftop.png" });
  await s.tap("jump");
  await advance(page, 150);
  await s.tap("jump");
  await s.enter("punch");
  await advance(page, 120);
  assert.equal((await read(page)).action, "punch");
  await s.stop();
  await advance(page, 1800);
  assert.ok(Math.abs((await read(page)).position[1] - 38) < 0.05);
  console.log(
    "PASS: native jungle approach, giant-column climb with clear canopy channel, stable top, double jump, Punch and landing",
  );
  await page.goto(original.href, { waitUntil: "networkidle" });
  await advance(page, 450);
}
