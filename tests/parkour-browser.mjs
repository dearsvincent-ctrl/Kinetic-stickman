import assert from "node:assert/strict";
import { stick } from "./acrobatic-browser.mjs";
const advance = (p, ms) => p.clock.runFor(ms);
async function read(p) {
  return p.evaluate(() => {
    const e = document.querySelector("#stance-label"),
      b = document.querySelector("#battle-status");
    const debug = window.__KINETIC__?.snapshot();
    return {
      mode: e.dataset.parkour,
      surface: e.dataset.surface,
      exit: e.dataset.parkourExit,
      action: e.dataset.action,
      phase: e.dataset.phase,
      sequence: Number(e.dataset.sequence),
      position: JSON.parse(b.dataset.position),
      jumpCount: Number(
        document.querySelector("#jump-button").dataset.jumpCount,
      ),
      debug,
    };
  });
}
async function until(page, predicate, limit = 12000, step = 100) {
  for (let elapsed = 0; elapsed < limit; elapsed += step) {
    await advance(page, step);
    const s = await read(page);
    assert.ok(s.position.every(Number.isFinite));
    if (s.debug) {
      for (const q of Object.values(s.debug.animation.jointRotations))
        assert.ok(
          q.every(Number.isFinite) && Math.abs(Math.hypot(...q) - 1) < 1e-6,
        );
      assert.ok(s.debug.renderer.calls < 90);
    }
    if (await predicate(s)) return s;
  }
  throw Error(
    "Parkour input sequence timed out: " + JSON.stringify(await read(page)),
  );
}
async function movement(page, n) {
  await page.locator("#physics-toggle").click();
  await page.locator("#physics-movement").evaluate((e, n) => {
    e.value = Math.log10(n);
    e.dispatchEvent(new Event("input", { bubbles: true }));
  }, n);
  await page.locator("#physics-close").click();
  await page.evaluate(() => document.activeElement?.blur());
}
async function fresh(page, url) {
  await page.goto(url, { waitUntil: "networkidle" });
  await advance(page, 450);
  await page.evaluate(() => document.activeElement?.blur());
}
export async function navigateX(page, s, destination) {
  await movement(page, 3);
  await s.move(1, 0);
  await until(page, (a) => a.position[0] >= destination - 1.8, 7000);
  await s.move(0, 0);
  await advance(page, 350);
  await movement(page, 1);
  for (let n = 0; n < 60; n++) {
    const a = await read(page),
      dx = destination - a.position[0];
    if (Math.abs(dx) < 0.12) break;
    await s.move(Math.sign(dx) * 0.35, 0);
    await advance(page, 80);
  }
  await s.move(0, 0);
  await advance(page, 220);
  const a = await read(page);
  assert.ok(
    Math.abs(a.position[0] - destination) < 0.3,
    "precise analogue approach " + a.position,
  );
}
export async function checkParkour(page, native) {
  const original = new URL(page.url()),
    url = new URL(page.url());
  url.searchParams.set("sandbox", "1");
  await page.evaluate(() =>
    localStorage.removeItem("kinetic.physics-sandbox.v1"),
  );
  await fresh(page, url.href);
  let s = await stick(page, native);
  await navigateX(page, s, 50);
  await s.move(0, 1);
  const seen = new Set();
  let climbShot = false;
  await until(
    page,
    async (a) => {
      seen.add(a.mode);
      if (!climbShot && a.mode === "climb" && a.position[1] > 1.5) {
        await page.screenshot({ path: "test-results/v081-wall-climb.png" });
        climbShot = true;
        await s.enter("kick");
        await advance(page, 120);
        await s.tap("jump");
        await advance(page, 140);
        const launch = await read(page);
        assert.equal(launch.mode, "free");
        assert.equal(launch.jumpCount, 1);
        assert.ok(launch.position[1] > a.position[1]);
        await page.screenshot({ path: "test-results/v081-wall-jump.png" });
      }
      return a.exit === "rooftop" && a.mode === "free" && a.position[1] > 5.95;
    },
    14000,
  );
  assert.ok(
    seen.has("vault") && seen.has("climb") && seen.has("mantle"),
    JSON.stringify([...seen]),
  );
  await s.move(0, 0);
  await advance(page, 300);
  assert.ok(Math.abs((await read(page)).position[1] - 6) < 0.02);
  await page.screenshot({ path: "test-results/v081-roof.png" });
  await s.enter("block");
  await advance(page, 120);
  assert.equal(await page.locator("#stance-label").textContent(), "BLOCKING");
  await s.enter("punch");
  await advance(page, 140);
  assert.equal((await read(page)).action, "punch");
  await s.enter("kick");
  await advance(page, 360);
  assert.equal((await read(page)).action, "kick");
  await s.releaseAction();
  await advance(page, 500);
  await s.tap("jump");
  await advance(page, 160);
  await s.move(0, 1);
  await s.tap("jump");
  await s.move(0, 0);
  await advance(page, 100);
  assert.equal((await read(page)).jumpCount, 2);
  assert.equal(
    await page.locator("#stance-label").getAttribute("data-acro-kind"),
    "frontflip",
  );
  await s.enter("kick");
  await advance(page, 180);
  assert.equal((await read(page)).action, "kick");
  await s.releaseAction();
  await advance(page, 1900);
  const landed = await read(page);
  assert.equal(landed.jumpCount, 0);
  assert.ok(Math.abs(landed.position[1] - 6) < 0.02, "elevated landing");
  await s.stop();
  console.log(
    "PASS: native automatic vault/climb/mantle, elevated roof support, Punch/Kick/Block slides and directional double-jump aerial combat",
  );
  // Fresh approach to a narrow pole; the same MOVE/Jump controls must suffice.
  await fresh(page, url.href);
  s = await stick(page, native);
  await navigateX(page, s, 60);
  await s.move(0, 1);
  let poleSeen = false;
  await until(
    page,
    (a) => {
      poleSeen ||= a.mode === "pole-climb";
      return a.mode === "perch";
    },
    15000,
  );
  assert.ok(poleSeen);
  await s.move(0, 0);
  await advance(page, 500);
  assert.equal((await read(page)).mode, "perch");
  assert.ok(Math.abs((await read(page)).position[1] - 8) < 0.02);
  await page.screenshot({ path: "test-results/v081-pole-perch.png" });
  await s.move(1, 0);
  await s.tap("jump");
  await advance(page, 140);
  const jumped = await read(page);
  assert.equal(jumped.mode, "free");
  assert.equal(jumped.jumpCount, 1);
  assert.ok(jumped.position[0] > 60.3 && jumped.position[1] > 8);
  await s.enter("punch");
  await advance(page, 140);
  assert.equal((await read(page)).action, "punch");
  await s.stop();
  assert.equal(await page.locator("#sprint-button,#dash-button").count(), 0);
  console.log(
    "PASS: native narrow-pole approach, unlimited climb, stable perch, directed Jump and airborne Punch with no extra controls",
  );
  await fresh(page, original.href);
}
