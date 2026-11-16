import assert from "node:assert/strict";
const advance = (p, ms) => p.clock.runFor(ms);
const read = (p) =>
  p.locator("#stance-label").evaluate((e) => ({ ...e.dataset }));
const battle = (p) =>
  p.locator("#battle-status").evaluate((e) => ({
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
    strength: 100,
    maxAngle: 20,
    cone: 25,
  }))
    assert.equal(await page.locator("#aim-" + id).inputValue(), String(value));
  for (const [id, min, max] of [
    ["strength", "0", "200"],
    ["maxAngle", "0", "45"],
    ["cone", "5", "60"],
  ]) {
    assert.equal(await page.locator("#aim-" + id).getAttribute("min"), min);
    assert.equal(await page.locator("#aim-" + id).getAttribute("max"), max);
  }
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
    Number(await page.locator("#aim-strength").inputValue()) > 100,
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
  assert.equal(await page.locator("#aim-strength").inputValue(), "100");
  assert.equal(await page.locator("#aim-maxAngle").inputValue(), "20");
  assert.equal(await page.locator("#aim-cone").inputValue(), "25");
  assert.equal(await page.locator("#aim-debug").isChecked(), false);
  assert.equal((await read(page)).aimTarget, "none");
  assert.equal((await read(page)).sequence, "0");
  const physicsBefore = await page.evaluate(() =>
    localStorage.getItem("kinetic.physics-sandbox.v1"),
  );
  await tune(page, { strength: 175, maxAngle: 35, cone: 55 });
  await page.locator("#aim-save").click();
  assert.match(await page.locator("#aim-status").textContent(), /saved/);
  assert.equal(
    await page.evaluate(() =>
      localStorage.getItem("kinetic.physics-sandbox.v1"),
    ),
    physicsBefore,
  );
  const aimSaved = await page.evaluate(() =>
    localStorage.getItem("kinetic.aim-assist.v1"),
  );
  await page.locator("#physics-save").click();
  await tune(page, { strength: 20, maxAngle: 12, cone: 15 });
  await page.locator("#physics-load").click();
  assert.equal(await page.locator("#aim-strength").inputValue(), "20");
  assert.equal(
    await page.evaluate(() => localStorage.getItem("kinetic.aim-assist.v1")),
    aimSaved,
  );
  await page.locator("#aim-load").click();
  assert.equal(await page.locator("#aim-strength").inputValue(), "175");
  await page.reload({ waitUntil: "networkidle" });
  await advance(page, 450);
  await page.locator("#physics-toggle").click();
  for (const [id, v] of Object.entries({
    strength: 175,
    maxAngle: 35,
    cone: 55,
  })) {
    assert.equal(await page.locator("#aim-" + id).inputValue(), String(v));
    assert.ok(
      (
        await page.locator("#aim-" + id).getAttribute("aria-valuetext")
      ).startsWith(String(v)),
    );
  }
  await page.setViewportSize({ width: 360, height: 740 });
  for (const id of ["strength", "maxAngle", "cone", "save", "load", "reset"]) {
    const button = page.locator("#aim-" + id);
    await button.scrollIntoViewIfNeeded();
    const b = await button.boundingBox();
    assert.ok(b.x >= 0 && b.x + b.width <= 360.1 && b.height >= 20);
  }
  await page.screenshot({ path: "test-results/aim-baseline-portrait.png" });
  await page.locator("#aim-reset").click();
  await page.locator("#aim-save").click();
  await page.setViewportSize({ width: 844, height: 390 });
  console.log(
    "PASS: 100%/20°/±25° aim defaults; 200%/45°/±60° ranges, independent aim Save/Load/refresh/reset, portrait controls and native slider/joystick multitouch",
  );
  await page.goto(new URL("?sandbox=1", page.url()).href, {
    waitUntil: "networkidle",
  });
  await advance(page, 450);
  assert.equal(await page.locator(".version b").textContent(), "0.8.3");
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
        Number(a.aimAngle) >= 0 &&
          Number(a.aimAngle) <= (20 * Math.PI) / 180 + 1e-9,
      );
      assert.equal(Number(a.aimStrength), 1);
      assert.equal(Number(a.aimProfile), 0);
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
  await tune(page, { strength: 200, maxAngle: 45, cone: 60 });
  await page.locator("#aim-save").click();
  // Fresh health/encounter; saved developer aim loads without changing physics.
  await page.reload({ waitUntil: "networkidle" });
  await advance(page, 450);
  const c2 = await point(page, "#joystick"),
    b2 = await page.locator("#joystick").boundingBox(),
    r2 = Math.min(b2.width, b2.height) * 0.34;
  joy = touch(1, c2);
  await native("touchStart", [joy]);
  let finger = touch(2, await point(page, "#punch-button"));
  await native("touchStart", [joy, finger], [finger]);
  for (const action of ["punch", "kick"]) {
    if (action === "kick") {
      finger = touch(2, await point(page, "#kick-button"));
      await native("touchMove", [joy, finger], [finger]);
    }
    let found = false;
    for (let n = 0; n < 65; n++) {
      const state = await battle(page);
      assert.ok(Number(state.health) > 0);
      const targets = state.enemies
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
      if (targets.length) {
        const e = targets[0],
          dx = e.position[0] - state.position[0],
          dz = e.position[2] - state.position[2],
          d = Math.hypot(dx, dz),
          m = d > 1.1 ? 0.6 : d > 0.7 ? 0.25 : 0.12;
        joy = touch(1, {
          x: c2.x + (dx / Math.max(0.001, d)) * r2 * m,
          y: c2.y + (dz / Math.max(0.001, d)) * r2 * m,
        });
        await native("touchMove", [joy, finger], [joy]);
      }
      await advance(page, 120);
      const s = await read(page);
      if (
        s.action === action &&
        s.aimTarget !== "none" &&
        Number(s.aimProfile) > 1
      ) {
        assert.equal(Number(s.aimStrength), 2);
        assert.ok(Number(s.aimAngle) <= (45 * Math.PI) / 180 + 1e-8);
        found = true;
        break;
      }
    }
    assert.ok(
      found,
      "Enhanced manual " + action + " uses the captured correction profile",
    );
  }
  finger = touch(2, await point(page, "#block-button"));
  await native("touchMove", [joy, finger], [finger]);
  await advance(page, 100);
  assert.equal(await page.locator("#stance-label").textContent(), "BLOCKING");
  await native("touchCancel", [], [joy, finger]);
  await advance(page, 600);
  console.log(
    "PASS: saved 200%/45°/±60° assistance reaches manual Punch and Kick with native action slides, moving enemies and responsive Block",
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
  await page.locator("#physics-toggle").click();
  await page.locator("#aim-reset").click();
  await page.locator("#aim-save").click();
  await page.locator("#physics-close").click();
  console.log(
    "PASS: default 100%/20° manual Punch acquires moving enemies with bounded physical contacts, no automatic attacks or permanent lock, and 0% restores unassisted strikes",
  );
}
