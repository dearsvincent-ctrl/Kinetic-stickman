import assert from "node:assert/strict";

// Shared real Pointer Events coverage for dev and the Pages bundle. `native`
// acknowledges each CDP event before the fixed clock advances.
export async function checkDashJumpTransitions(page, native) {
  const advance = (ms) => page.clock.runFor(ms);
  const read = () => page.evaluate(() => window.__KINETIC__?.snapshot() ?? null);
  const center = async (selector) => {
    const b = await page.locator(selector).boundingBox();
    return { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) };
  };
  const touch = (id, p) => ({ id, ...p, radiusX: 7, radiusY: 7, force: 1 });
  for (const [phase, delay, sprinting] of [
    ["beginning", 17, false],
    ["middle", 100, true],
    ["end", 217, true],
  ]) {
    if (phase === "end")
      await page.evaluate(() => {
        const positions = Object.fromEntries(["move", "sprint", "dash", "block", "jump"].map(id => {
          const selector = id === "move" ? "#joystick" : `#${id}-button`;
          const b = document.querySelector(selector).getBoundingClientRect();
          return [id, { x: (b.x + b.width / 2) / innerWidth, y: (b.y + b.height / 2) / innerHeight - 0.04 }];
        }));
        localStorage.setItem("kinetic.controls.v1", JSON.stringify({ version: 1, positions }));
      });
    await page.reload({ waitUntil: "networkidle" });
    await advance(500);
    const layout = await page.evaluate(() => localStorage.getItem("kinetic.controls.v1"));
    const joy = await center("#joystick");
    const buttons = Object.fromEntries(await Promise.all(["sprint", "dash", "jump", "block"].map(async id => [id, await center(`#${id}-button`)])));
    let points = [touch(301, joy), touch(302, { x: 440, y: 205 })];
    await native("touchStart", points);
    points[0] = touch(301, { x: joy.x + 28, y: joy.y - 22 });
    await native("touchMove", points, [points[0]]);
    await advance(300);
    const owners = await read();
    points.push(touch(303, sprinting ? buttons.sprint : buttons.dash));
    await native("touchStart", points, [points[2]]);
    const slide = async (action, ms) => {
      points[2] = touch(303, buttons[action]);
      await native("touchMove", points, [points[2]]);
      await advance(ms);
      return read();
    };
    if (sprinting) {
      await advance(200);
      await slide("dash", delay);
    } else await advance(delay);
    const before = await read();
    if (before) {
      assert.equal(before.dash.active, true, `${phase} samples an active ground dash`);
      assert.equal(before.dash.mode, "ground");
    }
    assert.equal(await page.locator("#jump-button").getAttribute("aria-disabled"), "false", "Jump stays available during ground Dash");
    const launched = await slide("jump", 100);
    assert.equal(await page.locator("#sprint-button").getAttribute("aria-pressed"), "false");
    // The 80ms HUD sampler can still show the old ground cooldown here.
    // The next native Dash entry must start in air regardless of that caption.
    if (launched) {
      assert.equal(launched.jump.sequence, 1);
      assert.equal(launched.jump.airborne, true);
      assert.equal(launched.dash.active, false);
      assert.equal(launched.dash.exitReason, "jumped");
      assert.equal(launched.dash.airDashesRemaining, 1);
      assert.equal(launched.dash.ready, true);
      assert.ok(launched.dash.groundCooldownRemaining > 0);
      assert.ok(launched.speed > before.speed * 0.7, "Takeoff retains momentum");
    }
    if (phase === "middle")
      await page.screenshot({ path: "test-results/dash-jump-takeoff.png" });
    points[0] = touch(301, { x: joy.x - 26, y: joy.y - 24 });
    points[1] = touch(302, { x: 470, y: 215 });
    await native("touchMove", points, points.slice(0, 2));
    const air = await slide("dash", 100);
    assert.equal(await page.locator("#dash-cooldown").textContent(), "AIR DASH");
    if (air) {
      assert.equal(air.dash.sequence, 2);
      assert.equal(air.dash.mode, "air");
      assert.equal(air.dash.active, true);
      assert.equal(air.dash.airDashesRemaining, 0);
      assert.equal(air.combat.attack.active, false);
      for (const owner of ["joystickPointer", "cameraPointer"])
        assert.equal(air.input[owner], owners.input[owner]);
    }
    if (phase === "middle")
      await page.screenshot({ path: "test-results/dash-jump-air-dash.png" });
    await slide("block", 100);
    assert.equal(await page.locator("#block-button").getAttribute("aria-pressed"), "true");
    const used = await slide("dash", 100);
    await advance(100); // let the sampled HUD observe the completed burst
    assert.equal(await page.locator("#block-button").getAttribute("aria-pressed"), "false");
    assert.equal(await page.locator("#dash-cooldown").textContent(), "USED");
    if (used) assert.equal(used.dash.sequence, 2, "Re-entry never stacks an aerial dash");
    await native("touchCancel", [], []);
    await advance(1000);
    assert.equal(await page.locator("#jump-status").textContent(), "READY");
    assert.equal(await page.locator("#dash-cooldown").textContent(), "READY");
    const landed = await read();
    if (landed) {
      assert.equal(landed.jump.sequence, 1);
      assert.equal(landed.position[1], 0);
      assert.equal(landed.dash.airDashesRemaining, 1);
      assert.equal(landed.input.joystickPointer, null);
      assert.equal(landed.input.cameraPointer, null);
    }
    const p = await center("#dash-button");
    await page.touchscreen.tap(p.x, p.y);
    await advance(100);
    assert.equal(await page.locator("#dash-button").evaluate(el => el.classList.contains("is-active")), true);
    const ground = await read();
    if (ground) {
      assert.equal(ground.dash.mode, "ground");
      assert.equal(ground.dash.sequence, 3);
    }
    assert.equal(await page.evaluate(() => localStorage.getItem("kinetic.controls.v1")), layout, "Movement never changes saved layout anchors");
  }
  await page.evaluate(() => localStorage.removeItem("kinetic.controls.v1"));
  console.log("PASS: native beginning/middle/end Ground Dash -> Jump -> Air Dash, Sprint, independent joystick/camera, Block, re-entry, landing and custom layout preservation");
}
