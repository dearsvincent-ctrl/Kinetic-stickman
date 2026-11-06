import assert from "node:assert/strict";

// Shared by development and the actual Pages bundle. All actions enter through
// browser input; optional development telemetry only observes simulation state.
export async function checkAerialDashes(page) {
  const advance = (ms) => page.clock.runFor(ms);
  const read = () =>
    page.evaluate(() => window.__KINETIC__?.snapshot() ?? null);
  const label = () => page.locator("#dash-cooldown").textContent();
  for (const [phase, elapsed, sprinting] of [
    ["ascent", 120, false],
    ["apex", 380, true],
    ["descent", 570, false],
  ]) {
    await page.reload({ waitUntil: "networkidle" });
    await advance(500);
    await page.evaluate(() => document.activeElement?.blur());
    if (sprinting) {
      await page.keyboard.down("d");
      await page.keyboard.down("Shift");
      await advance(400);
    }
    await page.keyboard.press("Space");
    await advance(elapsed);
    const before = await read();
    if (before) assert.equal(before.jump.airborne, true, phase);
    // The HUD is sampled every 80ms, so an early ascent may still display
    // takeoff. Availability in the movement state is immediate regardless.
    if (phase !== "ascent")
      assert.equal(await label(), "AIR READY", `${phase} permits an air dash`);
    await page.keyboard.press("e");
    await advance(100);
    const burst = await read();
    assert.equal(await label(), "AIR DASH", `${phase} starts immediately`);
    assert.equal(
      await page.locator("#dash-button").getAttribute("aria-disabled"),
      "true",
    );
    if (burst) {
      assert.equal(burst.dash.active, true);
      assert.equal(burst.dash.mode, "air");
      assert.equal(burst.dash.sequence, before.dash.sequence + 1);
      assert.equal(burst.dash.airDashesRemaining, burst.jump.airborne ? 0 : 1);
      assert.ok(burst.dash.distanceTravelled > 0.3);
      assert.ok(burst.dash.distanceTravelled < 2.5);
      for (const key of ["yaw", "pitch", "distance"])
        assert.equal(burst.camera[key], before.camera[key]);
      if (phase !== "descent")
        assert.ok(burst.animation.airDashWeight > 0.2);
    }
    if (phase === "apex")
      await page.screenshot({ path: "test-results/aerial-dash-peak.png" });
    await page.keyboard.press("e"); // a new PRESS must not stack in flight
    await page.keyboard.down("q");
    await page.keyboard.press("f"); // underlying manual punch stays grounded
    await advance(34);
    const guard = await read();
    if (guard) {
      assert.equal(guard.input.blocking, true);
      assert.equal(guard.combat.attack.active, false);
      assert.equal(guard.dash.sequence, burst.dash.sequence);
    }
    // Reverse the stick during the burst. Momentum changes over multiple steps.
    if (sprinting) await page.keyboard.up("d");
    await page.keyboard.down("a");
    await advance(34);
    const steered = await read();
    if (steered && sprinting) {
      const a = burst.dash.direction;
      const b = steered.dash.direction;
      const turn = Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[2] * b[2])));
      assert.ok(turn > 0.02 && turn < 0.8, "Air steering preserves momentum");
    }
    await page.keyboard.up("a");
    await page.keyboard.up("q");
    if (sprinting) await page.keyboard.up("Shift");
    await advance(140);
    if (phase === "ascent") {
      assert.equal(await label(), "USED", "One aerial dash per jump");
      await page.keyboard.press("e");
      await advance(34);
      const repeated = await read();
      if (repeated) assert.equal(repeated.dash.sequence, burst.dash.sequence);
    }
    await advance(1000);
    const landed = await read();
    assert.equal(await label(), "READY", "Landing restores ground Dash");
    if (landed) {
      assert.equal(landed.jump.phase, "grounded");
      assert.equal(landed.position[1], 0);
      assert.equal(landed.dash.sequence, burst.dash.sequence);
      assert.equal(landed.dash.airDashesRemaining, 1);
      assert.equal(landed.input.blocking, false);
      assert.equal(landed.animation.airDashWeight, 0);
    }
    await page.keyboard.press("e");
    await advance(100);
    // HUD sampling can still show the first 0.7s value at this instant.
    assert.match(await label(), /^0\.[567]s$/, "Ground Dash retains its cooldown");
    const ground = await read();
    if (ground) {
      assert.equal(ground.dash.active, true);
      assert.equal(ground.dash.mode, "ground");
      assert.equal(ground.dash.sequence, burst.dash.sequence + 1);
      assert.ok(ground.dash.groundCooldownRemaining >= 0.58);
      assert.ok(ground.dash.groundCooldownRemaining <= 0.62);
    }
    if (phase === "ascent")
      await page.screenshot({ path: "test-results/aerial-dash-ground-recovery.png" });
  }
  console.log(
    "PASS: browser ascent/apex/descent aerial Dash, steering, one-per-jump, Block, no air punches, landing reset and unchanged ground cooldown",
  );
}
