import assert from "node:assert/strict";

// Native touches exercise presentation through the same controls as gameplay.
// Production uses the visible HUD; optional dev snapshots inspect blend values.
export async function checkExplosiveAnimation(page, native) {
  const advance = (ms) => page.clock.runFor(ms);
  const read = () =>
    page.evaluate(() => window.__KINETIC__?.snapshot() ?? null);
  const fresh = async () => {
    await page.reload({ waitUntil: "networkidle" });
    await advance(500);
    await page.evaluate(() => document.activeElement?.blur());
  };
  const center = async (selector) => {
    const b = await page.locator(selector).boundingBox();
    return {
      x: Math.round(b.x + b.width / 2),
      y: Math.round(b.y + b.height / 2),
    };
  };
  const touch = (id, p) => ({ id, ...p, radiusX: 7, radiusY: 7, force: 1 });
  const capture = (name) =>
    page.screenshot({ path: `test-results/v071-${name}.png` });
  const speed = async () =>
    Number(await page.locator("#speed-value").textContent());
  await page.evaluate(() => localStorage.removeItem("kinetic.controls.v1"));
  await fresh();
  const camera = (await read())?.camera;
  await capture("idle");
  const joy = await center("#joystick"),
    sprint = await center("#sprint-button");
  let fingers = [touch(701, joy)];
  await native("touchStart", fingers);
  fingers[0] = touch(701, { x: joy.x, y: joy.y - 13 });
  await native("touchMove", fingers, [fingers[0]]);
  await advance(600);
  assert.ok(
    (await speed()) > 0.2 && (await speed()) < 1.4,
    "Progressive walking remains available",
  );
  await capture("walk");
  fingers[0] = touch(701, { x: joy.x, y: joy.y - 45 });
  await native("touchMove", fingers, [fingers[0]]);
  await advance(700);
  assert.ok(
    Math.abs((await speed()) - 2.6) < 0.1,
    "Normal running speed is unchanged",
  );
  const run = await read();
  if (run)
    assert.ok(run.animation.runBlend > 0.9 && run.animation.sprintBlend < 0.01);
  await capture("run");
  fingers.push(touch(702, sprint));
  await native("touchStart", fingers, [fingers[1]]);
  await advance(600);
  assert.ok(Math.abs((await speed()) - 5.2) < 0.1, "Sprint speed is unchanged");
  const fast = await read();
  if (fast) {
    assert.ok(
      fast.animation.sprintBlend > 0.9 && fast.animation.footLift > 0.14,
    );
    assert.ok(
      fast.animation.torsoPitch < -0.28,
      "Sprint has a distinct athletic lean",
    );
    for (const key of ["yaw", "pitch", "distance"])
      assert.equal(fast.camera[key], camera[key]);
  }
  await capture("sprint");
  // The unchanged camera sees the side silhouette when steering left; this
  // makes forward lean, arm opposition and knee drive easier to inspect.
  fingers[0] = touch(701, { x: joy.x - 45, y: joy.y });
  await native("touchMove", fingers, [fingers[0]]);
  await advance(550);
  await capture("sprint-side");
  fingers[0] = touch(701, joy);
  await native("touchMove", fingers, [fingers[0]]);
  await advance(100);
  const braking = await read();
  if (braking)
    assert.ok(braking.animation.brakingCue > 0.3 && braking.input.move.y === 0);
  await capture("brake");
  await native("touchCancel", [], []);
  await advance(650);
  assert.ok(
    (await speed()) < 0.1,
    "Cancellation stops movement without running in place",
  );

  await fresh();
  await page.keyboard.down("d");
  await advance(800);
  await page.keyboard.up("d");
  await advance(350);
  await page.keyboard.down("w");
  await advance(1800);
  await page.keyboard.up("w");
  await advance(350);
  const seen = new Set();
  let peak = 0,
    transfer = 0;
  for (let frame = 0; frame < 85; frame++) {
    await advance(17);
    const state = await read();
    const technique = await page
      .locator("#stance-label")
      .getAttribute("data-technique");
    const phase = await page
      .locator("#stance-label")
      .getAttribute("data-phase");
    if (state) {
      peak = Math.max(peak, state.animation.visualPunchReach);
      transfer = Math.min(transfer, state.animation.pelvisZ);
    }
    if (
      ["basic-punch", "cross-punch"].includes(technique) &&
      phase === "extension" &&
      (!state || state.combat.attack.phaseProgress >= 0.65) &&
      !seen.has(technique)
    ) {
      seen.add(technique);
      await capture(technique);
    }
  }
  assert.equal(
    seen.size,
    2,
    "Both existing ground strikes continue automatically",
  );
  if (await read())
    assert.ok(
      peak > 0.85 && transfer < -0.035,
      "Punches extend sharply with visual body-weight transfer",
    );
  console.log(
    "PASS: native progressive walk/run/sprint, distinct sprint presentation, braking/cancellation, sharp straight/cross poses; camera and movement speeds preserved",
  );
}
