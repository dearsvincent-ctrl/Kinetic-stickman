import assert from "node:assert/strict";
import { stick } from "./acrobatic-browser.mjs";
const advance = (p, ms) => p.clock.runFor(ms);
const snapshot = (p) =>
  p.evaluate(() => window.__KINETIC__?.snapshot() ?? null);
const state = (p) =>
  p.locator("#stance-label").evaluate((e) => ({ ...e.dataset }));
export async function checkAnimationFluidity(page, native) {
  await page.reload({ waitUntil: "networkidle" });
  await advance(page, 450);
  const initial = await snapshot(page),
    s = await stick(page, native),
    samples = [];
  for (const [name, magnitude] of [
    ["walk", 0.25],
    ["run", 0.75],
    ["sprint", 1],
  ]) {
    await s.move(0, magnitude);
    await advance(page, 950);
    const sample = await snapshot(page);
    samples.push(sample);
    assert.ok(Number(await page.locator("#speed-value").textContent()) > 0);
    if (sample) {
      assert.ok(sample.animation.cadence <= 2.4);
      assert.ok(Math.abs(sample.camera.yaw - initial.camera.yaw) < 1e-8);
      for (const q of Object.values(sample.animation.jointRotations))
        assert.ok(
          q.every(Number.isFinite) && Math.abs(Math.hypot(...q) - 1) < 1e-6,
        );
    }
    await page.screenshot({ path: `test-results/v080-${name}.png` });
  }
  if (samples[0]) {
    assert.ok(samples[0].animation.runBlend < 0.1);
    assert.ok(
      samples[1].animation.runBlend > 0.95 &&
        samples[1].animation.sprintBlend < 0.1,
    );
    assert.ok(samples[2].animation.sprintBlend > 0.95);
  }
  assert.equal(
    (await state(page)).sequence,
    "0",
    "locomotion never initiates attacks",
  );
  await s.move(-0.6, -0.8);
  await advance(page, 100);
  assert.equal((await state(page)).sequence, "0");
  await s.tap("punch");
  await advance(page, 100);
  assert.equal((await state(page)).action, "punch");
  await s.move(0, 1);
  await s.tap("jump");
  await advance(page, 180);
  await s.move(0, -1);
  await s.tap("jump");
  await advance(page, 100);
  assert.equal((await state(page)).acroKind, "backflip");
  await s.enter("kick");
  await advance(page, 150);
  const kicking = await state(page);
  assert.equal(kicking.action, "kick");
  const during = await snapshot(page);
  if (during) {
    assert.ok(during.jump.airborne);
    assert.ok(during.speed > 0);
    assert.ok(during.animation.flipTuck > 0);
  }
  await page.screenshot({ path: "test-results/v080-backflip-kick.png" });
  await s.enter("block");
  await advance(page, 100);
  assert.equal(await page.locator("#stance-label").textContent(), "BLOCKING");
  await s.releaseAction();
  await s.move(0, 1);
  await advance(page, 1800);
  assert.equal(
    await page.locator("#jump-button").getAttribute("data-jump-count"),
    "0",
  );
  await s.tap("jump");
  await advance(page, 150);
  assert.equal(
    await page.locator("#jump-button").getAttribute("data-jump-count"),
    "1",
  );
  await s.stop();
  await advance(page, 1500);
  assert.equal((await state(page)).phase, "idle");
  assert.equal(await page.locator("#sprint-button, #dash-button").count(), 0);
  console.log(
    "PASS: v0.8.0 native analogue gait comparison, reversal-to-punch, sprint/double-jump/backflip/kick/Block/landing continuity",
  );
}
