import assert from "node:assert/strict";
const advance = (p, ms) => p.clock.runFor(ms);
const read = (p) =>
  p.locator("#stance-label").evaluate((e) => ({ ...e.dataset }));
const battle = (p) =>
  p
    .locator("#battle-status")
    .evaluate((e) => ({
      ...e.dataset,
      position: JSON.parse(e.dataset.position),
      enemies: JSON.parse(e.dataset.enemies),
    }));
const point = async (p, s) => {
  const b = await p.locator(s).boundingBox();
  assert.ok(b, s);
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
};
const touch = (id, p) => ({ id, ...p, radiusX: 7, radiusY: 7, force: 1 });
const tune = (p, values) =>
  p.evaluate((values) => {
    for (const [id, v] of Object.entries(values)) {
      const e = document.querySelector("#aim-" + id);
      e.value = v;
      e.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }, values);
export async function checkPunchAim(page, native) {
  await page.setViewportSize({ width: 844, height: 390 });
  await page.goto(new URL("?sandbox=1&practice=1", page.url()).href, {
    waitUntil: "networkidle",
  });
  await advance(page, 450);
  await page.locator("#physics-toggle").click();
  assert.equal(await page.locator("#physics-fields .physics-row").count(), 8);
  assert.equal(
    await page.locator("#aim-assist-controls .physics-row").count(),
    3,
  );
  for (const [id, value] of Object.entries({
    strength: 20,
    maxAngle: 12,
    cone: 25,
  }))
    assert.equal(await page.locator("#aim-" + id).inputValue(), String(value));
  await tune(page, { strength: 0, maxAngle: 7, cone: 15 });
  assert.equal(await page.locator("#aim-strength").inputValue(), "0");
  await page.locator("#aim-strength").scrollIntoViewIfNeeded();
  const centre = await point(page, "#joystick"),
    joyBox = await page.locator("#joystick").boundingBox(),
    r = Math.min(joyBox.width, joyBox.height) * 0.34;
  let joy = touch(1, { x: centre.x, y: centre.y - r * 0.4 });
  await native("touchStart", [joy]);
  const range = await page.locator("#aim-strength").boundingBox();
  let slider = touch(2, { x: range.x + 8, y: range.y + range.height / 2 });
  await native("touchStart", [joy, slider], [slider]);
  slider = touch(2, {
    x: range.x + range.width * 0.8,
    y: range.y + range.height / 2,
  });
  await native("touchMove", [joy, slider], [slider]);
  await native("touchEnd", [slider], [slider]);
  await advance(page, 250);
  assert.ok(
    Number(await page.locator("#aim-strength").inputValue()) > 50,
    "Native aim slider remains usable with a held joystick",
  );
  assert.ok(Number(await page.locator("#speed-value").textContent()) > 0);
  await native("touchCancel", [], [joy]);
  await page.locator("#aim-strength").focus();
  await page.keyboard.press("Home");
  await page.keyboard.press("Space");
  await advance(page, 100);
  assert.equal(
    await page.locator("#jump-button").getAttribute("data-jump-sequence"),
    "0",
    "Slider keyboard input never jumps",
  );
  await page.locator("#aim-debug").check();
  assert.ok(await page.locator("#aim-debug").isChecked());
  await page.locator("#aim-reset").click();
  assert.equal(await page.locator("#aim-strength").inputValue(), "20");
  assert.equal(await page.locator("#aim-maxAngle").inputValue(), "12");
  assert.equal(await page.locator("#aim-cone").inputValue(), "25");
  assert.equal(await page.locator("#aim-debug").isChecked(), false);
  assert.equal((await read(page)).aimTarget, "none");
  assert.equal((await read(page)).sequence, "0");
  console.log(
    "PASS: aim strength/angle/cone sliders, zero strength, reset, optional debug and native joystick/UI multitouch remain independent of physics controls",
  );
  await page.goto(new URL("?sandbox=1", page.url()).href, {
    waitUntil: "networkidle",
  });
  await advance(page, 450);
  assert.equal(await page.locator(".version b").textContent(), "0.8.2");
  assert.equal(
    (await read(page)).sequence,
    "0",
    "Enemies never trigger automatic player punches",
  );
  await page.locator("#physics-toggle").click();
  await page.locator("#aim-debug").scrollIntoViewIfNeeded();
  await page.locator("#aim-debug").check();
  await page.locator("#physics-close").click();
  await page.evaluate(() => document.activeElement?.blur());
  const c = await point(page, "#joystick"),
    box = await page.locator("#joystick").boundingBox(),
    radius = Math.min(box.width, box.height) * 0.34;
  joy = touch(1, c);
  const punch = touch(2, await point(page, "#punch-button"));
  await native("touchStart", [joy]);
  await native("touchStart", [joy, punch], [punch]);
  let assisted = 0,
    damage = false,
    shot = false;
  const sides = new Set();
  for (let n = 0; n < 75; n++) {
    let state = await battle(page);
    assert.ok(
      Number(state.health) > 0,
      "Punch inputs remain usable during exchanges",
    );
    const live = state.enemies
      .filter((e) => e.health > 0)
      .sort(
        (a, b) =>
          Math.hypot(
            a.position[0] - state.position[0],
            a.position[2] - state.position[2],
          ) -
          Math.hypot(
            b.position[0] - state.position[0],
            b.position[2] - state.position[2],
          ),
      );
    if (!live.length) {
      await advance(page, 150);
      continue;
    }
    const target = live[0],
      dx = target.position[0] - state.position[0],
      dz = target.position[2] - state.position[2],
      d = Math.hypot(dx, dz),
      strength = d > 1.1 ? 0.6 : d > 0.7 ? 0.25 : 0.12;
    joy = touch(1, {
      x: c.x + (dx / Math.max(0.001, d)) * radius * strength,
      y: c.y + (dz / Math.max(0.001, d)) * radius * strength,
    });
    await native("touchMove", [joy, punch], [joy]);
    await advance(page, 150);
    const a = await read(page);
    state = await battle(page);
    damage ||=
      state.enemies.some((e) => e.health > 0 && e.health < 72) ||
      Number(state.defeated) > 0;
    if (a.aimTarget !== "none") {
      assisted++;
      sides.add(a.side);
      assert.ok(
        Number(a.aimAngle) > 0 &&
          Number(a.aimAngle) <= (12 * Math.PI) / 180 + 1e-9,
      );
      assert.ok(
        state.enemies.some((e) => e.id === a.aimTarget),
        "Assist selects a real enemy",
      );
      if (!shot && ["extension", "impact"].includes(a.phase)) {
        await page.screenshot({
          path: "test-results/v0710-assisted-punch.png",
        });
        shot = true;
      }
    }
    if (assisted >= 5 && damage && shot) break;
  }
  await native("touchCancel", [], [joy, punch]);
  assert.ok(assisted > 0, "Player initiated punches acquire moving opponents");
  assert.ok(damage, "Actual manual strikes reduce enemy health");
  assert.ok(shot, "Debug trajectories are visible during a strike");
  await advance(page, 700);
  assert.equal(
    (await read(page)).aimTarget,
    "none",
    "Selection disappears after punch recovery",
  );
  await page.locator("#physics-toggle").click();
  await page.locator("#aim-strength").scrollIntoViewIfNeeded();
  await tune(page, { strength: 0 });
  await page.locator("#physics-close").click();
  await page.evaluate(() => document.activeElement?.blur());
  const f = touch(9, await point(page, "#punch-button"));
  await native("touchStart", [f]);
  await native("touchEnd", [], [f]);
  await advance(page, 120);
  assert.equal((await read(page)).aimTarget, "none");
  assert.equal(Number((await read(page)).aimAngle), 0);
  console.log(
    "PASS: default 20% manual Punch acquires actual moving enemies with bounded correction/debug paths, real damage, no automatic attack or permanent lock, and 0% restores unassisted strikes",
  );
}
