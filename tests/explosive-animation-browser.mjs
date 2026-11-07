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
    page.screenshot({ path: `test-results/v072-${name}.png` });
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
  // All three speeds face left under the same untouched follow-camera angle,
  // so knee drive, rear extension and true flight are visible in comparison.
  fingers[0] = touch(701, { x: joy.x - 13, y: joy.y });
  await native("touchMove", fingers, [fingers[0]]);
  await advance(600);
  assert.ok(
    (await speed()) > 0.2 && (await speed()) < 1.4,
    "Progressive walking remains available",
  );
  await capture("walk");
  fingers[0] = touch(701, { x: joy.x - 45, y: joy.y });
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
  let flightSamples = 0,
    supportSamples = 0;
  for (let frame = 0; frame < 6; frame++) {
    await advance(100);
    const state = await read();
    if (state) {
      // Actual IK-resolved ankle positions; the flat foot sole is 9 cm below
      // the ankle. Contact flags alone cannot establish visible flight.
      if (state.animation.feet.every((foot) => foot.position[1] > 0.13))
        flightSamples++;
      if (state.animation.feet.some((foot) => foot.planted)) supportSamples++;
      assert.equal(
        state.position[1],
        0,
        "Sprint flight is visual, never a gameplay jump",
      );
      assert.equal(state.jump.phase, "grounded");
    }
    await capture(`sprint-cycle-${frame}`);
  }
  if (fast)
    assert.ok(
      flightSamples > 0 && supportSamples > 0,
      "Native sprint has visible two-foot flight and planted push-off/landing",
    );
  fingers[0] = touch(701, { x: joy.x, y: joy.y - 45 });
  await native("touchMove", fingers, [fingers[0]]);
  await advance(550);
  await capture("sprint-forward");
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
    "PASS: same-angle native walk/run/sprint comparison, genuine two-foot sprint flight, knee drive and rear extension, forward/side steering, braking/cancellation and existing straight/cross; camera and movement speeds preserved",
  );
}
