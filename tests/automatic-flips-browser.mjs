import assert from "node:assert/strict";
import { stick } from "./acrobatic-browser.mjs";
const read = (p) =>
  p.locator("#stance-label").evaluate((e) => ({ ...e.dataset }));
export async function checkAutomaticFlips(page, native) {
  const debug = await page.evaluate(() => Boolean(window.__KINETIC__));
  const base = new URL(`?practice=1${debug ? "&debug" : ""}`, page.url()).href;
  for (const [x, y, kind, action] of [
    [0, 1, "frontflip", "punch"],
    [0, -1, "backflip", "kick"],
    [-1, 0, "leftflip", "punch"],
    [1, 0, "rightflip", "kick"],
    [0, 0, "backflip", null],
  ]) {
    await page.goto(base, { waitUntil: "networkidle" });
    await page.clock.runFor(450);
    const s = await stick(page, native);
    await s.move(0, 0);
    await s.tap("jump");
    await page.clock.runFor(150);
    const launch = await page
      .locator("#jump-button")
      .getAttribute("data-jump-launch");
    await s.move(x, y);
    await s.tap("jump");
    await page.clock.runFor(100);
    let a = await read(page);
    assert.equal(a.acroKind, kind);
    assert.equal(a.acroSequence, "1");
    assert.equal(
      await page.locator("#jump-button").getAttribute("data-jump-launch"),
      launch,
    );
    if (action) {
      await s.tap(action);
      await page.clock.runFor(100);
      assert.equal((await read(page)).action, action);
    } else await page.clock.runFor(100);
    await page.screenshot({
      path: `test-results/v0821-${kind}-${action ?? "neutral"}-initiation.png`,
    });
    await s.move(-0.6, 0.8);
    await page.clock.runFor(120);
    a = await read(page);
    // HUD telemetry is throttled to 80 ms; observe the inversion window rather
    // than assuming a single sample lands exactly at the angular midpoint.
    for (let n = 0; n < 6 && Number(a.bodyUp) > -0.65; n++) {
      await page.clock.runFor(20);
      a = await read(page);
    }
    assert.equal(a.acroKind, kind);
    assert.equal(a.acroSequence, "1");
    assert.ok(Number(a.bodyUp) < -0.65, JSON.stringify(a));
    assert.ok(["tuck", "rotation", "extension"].includes(a.acroStage));
    await page.screenshot({
      path: `test-results/v0821-${kind}-${action ?? "neutral"}-tuck.png`,
    });
    await s.tap("jump");
    await page.clock.runFor(120);
    assert.equal(
      await page.locator("#jump-button").getAttribute("data-jump-sequence"),
      "2",
    );
    await page.clock.runFor(1400);
    a = await read(page);
    assert.equal(a.acroSequence, "1");
    assert.equal(a.completedFlips, "1");
    assert.ok(Math.abs(Number(a.rotationTravel) - Math.PI * 2) < 1e-6);
    assert.equal(a.acroPhase, "idle");
    assert.ok(Number(a.bodyUp) > 0.99);
    assert.equal(
      await page.locator("#jump-button").getAttribute("data-jump-count"),
      "0",
    );
    assert.equal(await page.locator("#dash-button,#sprint-button").count(), 0);
    await s.stop();
  }
  console.log(
    "PASS: automatic front/back/left/right and neutral flips complete exactly one turn with native air steering, Punch/Kick, unchanged launches, third-jump rejection and stable landing",
  );
}
