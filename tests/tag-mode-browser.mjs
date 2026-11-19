import assert from "node:assert/strict";
import { unlockSlider } from "./slider-test-utils.mjs";
import { stick } from "./acrobatic-browser.mjs";

const advance = (p, ms) => p.clock.runFor(ms);
const read = (p) =>
  p.locator("#battle-status").evaluate((e) => ({
    ...e.dataset,
    position: JSON.parse(e.dataset.position),
    enemies: JSON.parse(e.dataset.enemies),
    tagSettings: JSON.parse(e.dataset.tagSettings),
    enemySettings: JSON.parse(e.dataset.enemySettings),
    strength: JSON.parse(e.dataset.strength),
  }));
const savedCombatKeys = (p) =>
  p.evaluate(() =>
    Object.fromEntries(
      [
        "kinetic.enemy-settings.v1",
        "kinetic.physics-sandbox.v1",
        "kinetic.aim-assist.v1",
        "kinetic.controls.v1",
      ].map((k) => [k, localStorage.getItem(k)]),
    ),
  );
const tune = (p, values) =>
  p.evaluate((values) => {
    for (const [id, n] of Object.entries(values)) {
      const e = document.querySelector("#tag-" + id);
      e.value = ["speed", "acceleration", "detection"].includes(id)
        ? Math.log10(n)
        : n;
      e.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }, values);
async function open(p) {
  if (await p.locator("#physics-panel").evaluate((e) => e.hidden))
    await p.locator("#physics-toggle").click();
  if (!(await p.locator("#tag-settings").evaluate((e) => e.open)))
    await p.locator("#tag-settings > summary").click();
}
async function close(p) {
  await p.locator("#physics-close").click();
  await p.evaluate(() => document.activeElement?.blur());
}
async function mode(p, value) {
  await p.locator("#game-mode").selectOption(value);
  await p.evaluate(() => document.activeElement?.blur());
  await advance(p, 100);
  assert.equal((await read(p)).mode, value);
}

/** Real production UI + native touch; no mutation/debug hooks or teleports. */
export async function checkTagMode(page, native) {
  const url = new URL("?sandbox=1", page.url());
  // Valid non-default preferences model an existing player, rather than
  // proving isolation only against empty storage. These are storage fixtures,
  // not direct writes to the game/physics state.
  const layoutFixture = {
    version: 1,
    positions: {
      move: { x: 0.14, y: 0.76 },
      punch: { x: 0.62, y: 0.48 },
      kick: { x: 0.75, y: 0.75 },
      block: { x: 0.87, y: 0.55 },
      jump: { x: 0.5, y: 0.78 },
    },
  };
  await page.evaluate((layout) => {
    localStorage.removeItem("kinetic.tag-settings.v1");
    localStorage.setItem("kinetic.controls.v1", JSON.stringify(layout));
    localStorage.setItem(
      "kinetic.enemy-settings.v1",
      JSON.stringify({
        version: 1,
        values: {
          speed: 0.7,
          acceleration: 1.5,
          aggression: 0.8,
          attackFrequency: 0.75,
          maxEnemies: 8,
          detection: 80,
          disengagement: 150,
        },
      }),
    );
    localStorage.setItem(
      "kinetic.aim-assist.v1",
      JSON.stringify({
        version: 1,
        values: { strength: 1.5, maxAngle: 30, cone: 35, debug: false },
      }),
    );
  }, layoutFixture);
  await page.setViewportSize({ width: 844, height: 390 });
  await page.goto(url.href, { waitUntil: "networkidle" });
  await advance(page, 450);
  assert.equal(await page.locator("#game-mode").inputValue(), "combat");
  const combat = await read(page),
    keys = await savedCombatKeys(page);
  assert.equal(combat.mode, "combat");
  assert.equal(combat.enemySettings.speed, 0.7);
  assert.equal(combat.enemySettings.acceleration, 1.5);
  assert.ok(Object.values(keys).filter((v) => v !== null).length >= 3);
  assert.equal(JSON.parse(keys["kinetic.aim-assist.v1"]).values.strength, 1.5);
  const relocatedPunch = await page.locator("#punch-button").boundingBox();
  assert.ok(
    Math.abs(
      relocatedPunch.x +
        relocatedPunch.width / 2 -
        844 * layoutFixture.positions.punch.x,
    ) < 1,
    "Non-default saved Punch position is actually applied",
  );
  assert.equal(combat.alive, "3");
  await mode(page, "tag");
  let a = await read(page);
  assert.equal(a.tags, "0");
  assert.equal(a.alive, "3");
  assert.deepEqual(a.tagSettings, {
    speed: 1,
    acceleration: 1,
    intelligence: 1,
    maxEnemies: 3,
    detection: 60,
    tagRadius: 0.85,
  });
  const start = a;
  await advance(page, 800);
  a = await read(page);
  assert.equal(
    a.health,
    start.health,
    "Fleeing NPCs never cause combat damage",
  );
  assert.ok(a.enemies.every((e) => e.phase === "idle"));
  assert.ok(
    a.enemies.some((e) => {
      const prior = start.enemies.find((p) => p.id === e.id);
      return (
        prior &&
        Math.hypot(e.position[0], e.position[2]) >
          Math.hypot(prior.position[0], prior.position[2]) + 0.5
      );
    }),
    "Fleeing characters physically increase separation from the player",
  );
  await open(page);
  assert.equal(
    await page.locator("#tag-settings-controls .physics-row").count(),
    6,
  );
  const range = page.locator("#tag-speed");
  assert.ok(
    Math.abs(Number(await range.getAttribute("min")) - Math.log10(0.25)) < 1e-8,
  );
  assert.equal(await range.getAttribute("max"), "2");
  // A slider contact is UI-only while another finger keeps the joystick.
  await page.locator("#tag-acceleration").scrollIntoViewIfNeeded();
  await unlockSlider(page, "tag-acceleration");
  const jb = await page.locator("#joystick").boundingBox(),
    joy = {
      id: 1,
      x: jb.x + jb.width / 2,
      y: jb.y + jb.height / 2 - jb.height * 0.34 * 0.4,
      radiusX: 7,
      radiusY: 7,
      force: 1,
    },
    rb = await page.locator("#tag-acceleration").boundingBox();
  await native("touchStart", [joy]);
  let slider = {
    id: 2,
    x: rb.x + 8,
    y: rb.y + rb.height / 2,
    radiusX: 7,
    radiusY: 7,
    force: 1,
  };
  await native("touchStart", [joy, slider], [slider]);
  slider = { ...slider, x: rb.x + rb.width * 0.76 };
  await native("touchMove", [joy, slider], [slider]);
  await native("touchEnd", [slider], [slider]);
  await advance(page, 180);
  assert.ok((await read(page)).tagSettings.acceleration > 5);
  assert.ok(Number(await page.locator("#speed-value").textContent()) > 0);
  await native("touchCancel", [], [joy]);
  await tune(page, {
    speed: 20,
    acceleration: 2,
    intelligence: 2,
    maxEnemies: 16,
    detection: 2000,
    tagRadius: 1.2,
  });
  await advance(page, 100);
  a = await read(page);
  assert.equal(a.alive, "16");
  assert.equal(a.tagSettings.speed, 20);
  assert.equal(a.tagSettings.acceleration, 2);
  assert.equal(a.tagSettings.intelligence, 2);
  assert.deepEqual(a.enemySettings, combat.enemySettings);
  assert.deepEqual(a.strength, combat.strength);
  await page.locator("#tag-save").click();
  assert.deepEqual(await savedCombatKeys(page), keys);
  await page.reload({ waitUntil: "networkidle" });
  await advance(page, 450);
  assert.equal(
    (await read(page)).mode,
    "combat",
    "Reload defaults to ordinary Combat Mode",
  );
  assert.equal((await read(page)).tagSettings.speed, 20);
  assert.equal((await read(page)).tagSettings.maxEnemies, 16);
  await mode(page, "tag");
  assert.equal((await read(page)).alive, "16");
  await open(page);
  await tune(page, { speed: 0.25, maxEnemies: 1 });
  await page.locator("#tag-load").click();
  await advance(page, 100);
  assert.equal((await read(page)).tagSettings.speed, 20);
  assert.equal((await read(page)).alive, "16");

  // The new section stays within the same independent mobile scroll surface.
  for (const size of [
    { width: 390, height: 844 },
    { width: 740, height: 360 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(size);
    await page.locator("#tag-tagRadius").scrollIntoViewIfNeeded();
    const b = await page.locator("#physics-panel").boundingBox();
    assert.ok(b.x >= 0 && b.x + b.width <= size.width + 0.5);
    assert.ok(b.y >= 0 && b.y + b.height <= size.height + 0.5);
    assert.ok(
      await page
        .locator(".physics-scroll")
        .evaluate((e) => e.scrollWidth <= e.clientWidth + 1),
    );
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "test-results/v084-tag-settings-portrait.png",
  });
  await close(page);
  const selector = await page.locator("#game-mode").boundingBox();
  assert.ok(selector.x >= 0 && selector.x + selector.width <= 390.5);
  await page.setViewportSize({ width: 844, height: 390 });

  // Experimental population and independent joystick/action contacts.
  await open(page);
  await tune(page, {
    speed: 100,
    acceleration: 100,
    maxEnemies: 64,
    detection: 4000,
  });
  await close(page);
  const s = await stick(page, native);
  await s.move(1, 0);
  await s.tap("jump");
  await advance(page, 120);
  await s.tap("jump");
  await s.enter("punch");
  await advance(page, 90);
  assert.equal(
    await page.locator("#stance-label").getAttribute("data-action"),
    "punch",
  );
  await s.enter("block");
  await advance(page, 90);
  await s.enter("kick");
  await advance(page, 100);
  assert.equal(
    await page.locator("#stance-label").getAttribute("data-action"),
    "kick",
  );
  await s.stop();
  a = await read(page);
  assert.equal(a.alive, "64");
  assert.equal(a.health, start.health);
  assert.ok(
    a.enemies.every(
      (e) =>
        e.position.every(Number.isFinite) &&
        e.velocity.every(Number.isFinite) &&
        e.phase === "idle",
    ),
  );
  assert.equal(await page.locator("#dash-button,#sprint-button").count(), 0);
  console.log(
    "PASS: Tag Mode flees without attacking; independent live settings, save/load, portrait UI and bounded 64-character extreme chase preserve native double-jump/Punch/Block/Kick controls",
  );

  // Fresh encounter: physically catch a slow runner at superhuman speed.
  await open(page);
  await page.locator("#tag-reset").click();
  await tune(page, {
    speed: 0.25,
    acceleration: 1,
    maxEnemies: 1,
    intelligence: 0,
    tagRadius: 0.85,
  });
  await page.locator("#tag-save").click();
  await page.locator("#physics-movement").evaluate((e) => {
    e.value = Math.log10(20);
    e.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await close(page);
  await mode(page, "combat");
  await mode(page, "tag");
  const chase = await stick(page, native),
    before = await read(page);
  let tagged = false;
  for (let n = 0; n < 180; n++) {
    a = await read(page);
    if (Number(a.tags) > Number(before.tags)) {
      tagged = true;
      break;
    }
    const e = a.enemies.find((e) => e.health > 0);
    assert.ok(e, "One active runner remains until a successful tag");
    const dx = e.position[0] - a.position[0],
      dz = e.position[2] - a.position[2],
      d = Math.max(0.001, Math.hypot(dx, dz));
    await chase.move(dx / d, -dz / d);
    await advance(page, 20);
  }
  await chase.stop();
  assert.ok(
    tagged,
    "Native joystick catch registers a continuous high-speed tag without attacking",
  );
  a = await read(page);
  assert.equal(Number(a.tags), Number(before.tags) + 1);
  assert.equal(a.alive, "0", "Tagged runner temporarily deactivates");
  await page.screenshot({ path: "test-results/v084-tag-success.png" });
  await advance(page, 2500);
  a = await read(page);
  assert.equal(a.alive, "1", "Runner respawns after the tag delay");
  assert.equal(Number(a.tags), Number(before.tags) + 1);
  assert.ok(
    a.enemies.every(
      (e) =>
        Math.hypot(
          e.position[0] - a.position[0],
          e.position[2] - a.position[2],
        ) > 5,
    ),
  );
  assert.equal(a.health, before.health);
  console.log(
    "PASS: native superhuman approach tags by physical contact, increments exactly once and respawns a separated runner without health damage or automatic attacks",
  );

  await mode(page, "combat");
  a = await read(page);
  assert.equal(a.wave, "1");
  assert.equal(a.alive, "3");
  assert.deepEqual(a.enemySettings, combat.enemySettings);
  assert.deepEqual(a.strength, combat.strength);
  assert.deepEqual(await savedCombatKeys(page), keys);
  const restoredPunch = await page.locator("#punch-button").boundingBox();
  assert.ok(
    Math.abs(
      restoredPunch.x +
        restoredPunch.width / 2 -
        844 * layoutFixture.positions.punch.x,
    ) < 1,
    "Mode changes preserve the relocated action layout",
  );
  // A single action finger slides between relocated actual buttons, while an
  // independent joystick contact keeps moving after both mode transitions.
  const relocated = await stick(page, native);
  await relocated.move(0, -0.3);
  await relocated.enter("punch");
  await advance(page, 90);
  assert.equal(
    await page.locator("#stance-label").getAttribute("data-action"),
    "punch",
  );
  await relocated.enter("block");
  await advance(page, 90);
  assert.equal(
    await page.locator("#block-button").getAttribute("aria-pressed"),
    "true",
  );
  const beforeKick = Number(
    await page.locator("#stance-label").getAttribute("data-sequence"),
  );
  await relocated.enter("kick");
  // Block cancels into the existing short recovery; the HUD samples at 80ms.
  // Verify a single accepted held entry after recovery, not a stale Punch row.
  for (let elapsed = 0; elapsed < 280; elapsed += 20) {
    await advance(page, 20);
    if (
      (await page.locator("#stance-label").getAttribute("data-action")) ===
      "kick"
    )
      break;
  }
  assert.equal(
    await page.locator("#stance-label").getAttribute("data-action"),
    "kick",
  );
  assert.equal(
    Number(await page.locator("#stance-label").getAttribute("data-sequence")),
    beforeKick + 1,
  );
  assert.equal(
    await page.locator("#block-button").getAttribute("aria-pressed"),
    "false",
  );
  await relocated.stop();
  assert.deepEqual(await savedCombatKeys(page), keys);
  await open(page);
  await page.locator("#tag-reset").click();
  await page.locator("#tag-save").click();
  await page.locator("#physics-reset").click();
  await close(page);
  console.log(
    "PASS: switching back restores Combat Mode waves and original combat settings; tag settings never overwrite combat, aim, physics or custom layout saves",
  );
}
