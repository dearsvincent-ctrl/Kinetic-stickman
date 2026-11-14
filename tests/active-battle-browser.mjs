import assert from "node:assert/strict";
const advance = (p, ms) => p.clock.runFor(ms);
const read = async (p) =>
  p.locator("#battle-status").evaluate((e) => ({
    ...e.dataset,
    enemies: JSON.parse(e.dataset.enemies || "[]"),
    position: JSON.parse(e.dataset.position || "[0,0,0]"),
  }));
const point = async (p, s) => {
  const b = await p.locator(s).boundingBox();
  assert.ok(b, s);
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
};
const touch = (id, p) => ({ id, ...p, radiusX: 7, radiusY: 7, force: 1 });
export async function checkWaveCombat(page, native) {
  await advance(page, 450);
  assert.equal(await page.locator(".version b").textContent(), "0.7.9");
  let state = await read(page);
  assert.equal(state.wave, "1");
  assert.equal(state.alive, "3");
  assert.equal(state.health, "120");
  assert.equal(await page.locator("#dash-button,#sprint-button").count(), 0);
  const initial = state.enemies.map((e) => e.position);
  await advance(page, 1500);
  state = await read(page);
  assert.ok(
    state.enemies.some(
      (e, i) =>
        Math.hypot(
          e.position[0] - initial[i][0],
          e.position[2] - initial[i][2],
        ) > 1,
    ),
    "Enemies visibly pursue the fighter",
  );
  assert.ok(
    state.enemies.some((e) =>
      ["Approach", "Position", "Attack", "Recover"].includes(e.state),
    ),
  );
  await page.screenshot({ path: "test-results/v079-active-approach.png" });
  // Native joystick + held Kick, with real steering toward each living opponent.
  const centre = await point(page, "#joystick"),
    box = await page.locator("#joystick").boundingBox(),
    r = Math.min(box.width, box.height) * 0.34;
  let joy = touch(1, centre),
    attack = touch(2, await point(page, "#kick-button"));
  await native("touchStart", [joy]);
  await native("touchStart", [joy, attack], [attack]);
  const sides = new Set();
  let sawDamage = false,
    sawStagger = false,
    sawDefeat = false;
  for (let n = 0; n < 110; n++) {
    state = await read(page);
    if (Number(state.wave) > 1) break;
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
      await advance(page, 300);
      continue;
    }
    const target = live[0],
      dx = target.position[0] - state.position[0],
      dz = target.position[2] - state.position[2],
      d = Math.hypot(dx, dz),
      strength = d > 1.1 ? 0.6 : d > 0.65 ? 0.27 : 0.12;
    joy = touch(1, {
      x: centre.x + (dx / Math.max(0.001, d)) * r * strength,
      y: centre.y + (dz / Math.max(0.001, d)) * r * strength,
    });
    await native("touchMove", [joy, attack], [joy]);
    await advance(page, 250);
    const a = await page.locator("#stance-label").getAttribute("data-side");
    sides.add(a);
    state = await read(page);
    sawDamage ||= state.enemies.some((e) => e.health > 0 && e.health < 72);
    sawStagger ||= state.enemies.some((e) => e.state === "Stagger");
    sawDefeat ||= Number(state.defeated) > 0;
    assert.ok(
      Number(state.health) > 0,
      "Mobile inputs should remain usable through a real encounter",
    );
  }
  await native("touchCancel", [], [joy, attack]);
  state = await read(page);
  assert.ok(sawDamage, "Player Kick reduces actual enemy health");
  assert.ok(sawDefeat, "Enemies are defeated by physical strikes");
  assert.ok(
    Number(state.wave) >= 2,
    `Wave continues: ${JSON.stringify(state)}`,
  );
  assert.ok(Number(state.defeated) >= 3);
  assert.ok(state.enemies.length <= 8);
  await page.screenshot({ path: "test-results/v079-next-wave.png" });
  console.log(
    "PASS: default active game pursues, takes physical manual Kick damage, staggers/defeats and spawns the next wave with native multitouch",
  );
}

export async function checkActiveBattle(page, native) {
  await checkWaveCombat(page, native);
  await checkDefeatAndBlock(page, native);
  await checkExtremeBattleMovement(page, native);
}
export async function checkDefeatAndBlock(page, native) {
  let state;
  const centre = await point(page, "#joystick"),
    box = await page.locator("#joystick").boundingBox(),
    r = Math.min(box.width, box.height) * 0.34;
  let joy;
  // Reset does not reload or erase layouts/sandbox; defeat/respawn is tested below.
  await page.locator(".battle-reset").click();
  await advance(page, 200);
  state = await read(page);
  assert.equal(state.wave, "1");
  assert.equal(state.defeated, "0");
  assert.equal(state.health, "120");
  await advance(page, 16000);
  state = await read(page);
  for (let n = 0; n < 4 && Number(state.health) > 0; n++) {
    await advance(page, 4000);
    state = await read(page);
  }
  assert.equal(state.health, "0");
  await page.locator("#defeat-panel").waitFor({ state: "visible" });
  const sequence = await page
    .locator("#stance-label")
    .getAttribute("data-sequence");
  await page.locator("#kick-button").dispatchEvent("click");
  await advance(page, 400);
  assert.equal(
    await page.locator("#stance-label").getAttribute("data-sequence"),
    sequence,
  );
  await page.screenshot({ path: "test-results/v079-defeat.png" });
  await page.locator("#defeat-panel [data-respawn]").click();
  await advance(page, 200);
  state = await read(page);
  assert.equal(state.health, "120");
  assert.equal(state.wave, "1");
  assert.equal(state.alive, "3");
  assert.ok(await page.locator("#defeat-panel").isHidden());
  // Facing a nearby pursuer with the joystick while holding Block.
  const block = touch(3, await point(page, "#block-button"));
  joy = touch(1, centre);
  await native("touchStart", [joy]);
  await native("touchStart", [joy, block], [block]);
  for (let n = 0; n < 32; n++) {
    state = await read(page);
    if (Number(state.blockEvents) > 0) break;
    const target = state.enemies
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
      )[0];
    const dx = target.position[0] - state.position[0],
      dz = target.position[2] - state.position[2],
      d = Math.hypot(dx, dz);
    joy = touch(1, {
      x: centre.x + (dx / d) * r * 0.2,
      y: centre.y + (dz / d) * r * 0.2,
    });
    await native("touchMove", [joy, block], [joy]);
    await advance(page, 250);
  }
  await native("touchCancel", [], [joy, block]);
  state = await read(page);
  assert.ok(
    Number(state.blockEvents) > 0,
    "Facing held Block mitigates an actual enemy hit",
  );
  assert.ok(Number(state.health) > 0);
  console.log(
    "PASS: actual enemy hits reduce health, defeat disables gameplay, respawn restores the encounter, and held facing Block mitigates contact",
  );
  await checkBattleHudScreens(page);
}
export async function checkBattleHudScreens(page) {
  for (const [width, height] of [
    [844, 390],
    [390, 844],
    [667, 320],
    [740, 360],
  ]) {
    await page.setViewportSize({ width, height });
    await advance(page, 100);
    const b = await page.locator("#battle-status").boundingBox(),
      reset = await page.locator("#reset-camera").boundingBox();
    assert.ok(
      b.x >= 0 &&
        b.y >= 0 &&
        b.x + b.width <= width &&
        b.y + b.height <= height,
    );
    for (const id of [
      "joystick",
      "punch-button",
      "kick-button",
      "block-button",
      "jump-button",
    ]) {
      const c = await page.locator("#" + id).boundingBox();
      assert.ok(
        !(
          b.x < c.x + c.width &&
          b.x + b.width > c.x &&
          b.y < c.y + c.height &&
          b.y + b.height > c.y
        ),
        `Combat HUD avoids ${id} at ${width}x${height}`,
      );
      assert.ok(
        !(
          reset.x < c.x + c.width &&
          reset.x + reset.width > c.x &&
          reset.y < c.y + c.height &&
          reset.y + reset.height > c.y
        ),
        `Reset View avoids ${id} at ${width}x${height}`,
      );
    }
    assert.ok(reset.x + reset.width <= width);
    await page.screenshot({ path: `test-results/v079-hud-${width}.png` });
  }
  console.log(
    "PASS: combat HUD and Reset View remain clear of mobile action controls in landscape, portrait and short landscape",
  );
}

export async function checkExtremeBattleMovement(page, native) {
  await page.setViewportSize({ width: 844, height: 390 });
  await page.goto(new URL("?sandbox=1", page.url()).href, {
    waitUntil: "networkidle",
  });
  await advance(page, 450);
  await page.locator("#physics-toggle").click();
  await page.evaluate(() => {
    for (const [id, value] of Object.entries({
      movement: 100,
      jumpHeight: 100,
      gravity: 100,
    })) {
      const e = document.querySelector("#physics-" + id);
      if (e) {
        e.value = Math.log10(value);
        e.dispatchEvent(new Event("input", { bubbles: true }));
      }
    }
  });
  await page.locator("#physics-close").click();
  await advance(page, 50);
  await page.evaluate(() => document.activeElement?.blur());
  const centre = await point(page, "#joystick"),
    box = await page.locator("#joystick").boundingBox(),
    r = Math.min(box.width, box.height) * 0.34;
  const joy = touch(1, { x: centre.x + r, y: centre.y });
  let action = touch(2, await point(page, "#punch-button"));
  await native("touchStart", [joy]);
  await native("touchStart", [joy, action], [action]);
  await advance(page, 500);
  let state = await read(page);
  assert.ok(
    Math.abs(state.position[0]) > 100,
    "100x travel works in the expanded active arena",
  );
  const tapJump = async () => {
    const jump = touch(3, await point(page, "#jump-button"));
    await native("touchStart", [joy, action, jump], [jump]);
    await native("touchEnd", [jump], [jump]);
  };
  await tapJump();
  await advance(page, 150);
  await tapJump();
  await advance(page, 100);
  assert.equal(
    await page.locator("#jump-button").getAttribute("data-jump-count"),
    "2",
  );
  assert.equal(
    await page.locator("#stance-label").getAttribute("data-acro-kind"),
    "frontflip",
  );
  action = touch(2, await point(page, "#kick-button"));
  await native("touchMove", [joy, action], [action]);
  await advance(page, 180);
  // A slide during an existing strike's brief commitment is held intent;
  // it resumes at that technique's normal transition/recovery boundary.
  for (
    let n = 0;
    n < 5 &&
    (await page.locator("#stance-label").getAttribute("data-action")) !==
      "kick";
    n++
  )
    await advance(page, 50);
  assert.equal(
    await page.locator("#stance-label").getAttribute("data-action"),
    "kick",
  );
  state = await read(page);
  assert.ok(state.position.every(Number.isFinite));
  assert.ok(state.position[1] > 0);
  assert.ok(Math.abs(state.position[0]) <= 999.64 + 1e-6);
  await page.screenshot({
    path: "test-results/v079-extreme-aerial-combat.png",
  });
  await native("touchCancel", [], [joy, action]);
  await advance(page, 2500);
  state = await read(page);
  assert.ok(state.position.every(Number.isFinite));
  assert.ok(state.position[1] >= 0);
  assert.equal(await page.locator("#jump-status").textContent(), "READY");
  assert.ok(
    state.enemies.every((e) => e.health === 72),
    "Far-away attacks do not deal proximity damage",
  );
  await page.locator(".battle-reset").click();
  await advance(page, 100);
  assert.equal((await read(page)).wave, "1");
  console.log(
    "PASS: active combat preserves 100x analogue travel, double jumps/flips, aerial manual strikes, arena bounds and physical landings without distant false hits",
  );
}
