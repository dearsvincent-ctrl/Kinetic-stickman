import assert from "node:assert/strict";
import { ENEMY_ABILITY_PARAMETERS } from "../src/sandbox/EnemyAbilities.js";
import { stick } from "./acrobatic-browser.mjs";
import { unlockSlider } from "./slider-test-utils.mjs";

const advance = (page, ms) => page.clock.runFor(ms);
const read = (page) =>
  page.locator("#battle-status").evaluate((element) => ({
    ...element.dataset,
    enemies: JSON.parse(element.dataset.enemies),
    profiles: JSON.parse(element.dataset.enemyProfiles),
    rosters: JSON.parse(element.dataset.enemyRosters),
    enemySettings: JSON.parse(element.dataset.enemySettings),
    tagSettings: JSON.parse(element.dataset.tagSettings),
  }));
const point = (id, x, y) => ({ id, x, y, radiusX: 7, radiusY: 7, force: 1 });
const profileId = (enemy) =>
  typeof enemy.profile === "string" ? enemy.profile : enemy.profile?.id;

async function panel(page) {
  if (
    await page.locator("#physics-panel").evaluate((element) => element.hidden)
  )
    await page.locator("#physics-toggle").click();
}
async function details(page, id) {
  await panel(page);
  if (!(await page.locator(id).evaluate((element) => element.open)))
    await page.locator(`${id} > summary`).click();
}
async function close(page) {
  await page.locator("#physics-close").click();
  await page.evaluate(() => document.activeElement?.blur());
}
async function mode(page, value) {
  await page.locator("#game-mode").selectOption(value);
  await page.evaluate(() => document.activeElement?.blur());
  await advance(page, 120);
}
async function roster(page, kind, counts) {
  await details(page, kind === "tag" ? "#tag-settings" : "#enemy-settings");
  for (const id of ["standard", "acrobat", "leaper", "heavy"]) {
    const enabled = page.locator(`#${kind}-roster-${id}-enabled`);
    const count = counts[id] ?? 0;
    if (count > 0) {
      await enabled.check();
      await page
        .locator(`#${kind}-roster-${id}-count`)
        .evaluate((input, value) => {
          input.value = value;
          input.dispatchEvent(new Event("input", { bubbles: true }));
        }, count);
    } else await enabled.uncheck();
  }
  assert.equal(await page.locator(`#${kind}-roster-custom`).isChecked(), true);
}

/** Production-safe controls and telemetry: no mutation of actor positions,
 * movement state, health or navigation is exposed to the browser test. */
export async function checkEnemyAbilities(page, native) {
  await page.setViewportSize({ width: 844, height: 390 });
  await page.evaluate(() => {
    for (const key of [
      "kinetic.physics-sandbox.v1",
      "kinetic.enemy-settings.v1",
      "kinetic.tag-settings.v1",
    ])
      localStorage.removeItem(key);
  });
  await page.goto(new URL("?sandbox=1", page.url()).href, {
    waitUntil: "networkidle",
  });
  await advance(page, 450);
  await page.waitForSelector("#loading", { state: "detached" });
  assert.equal(await page.locator(".version b").textContent(), "0.9.0");
  const initial = await read(page);
  assert.equal(initial.alive, "3");
  assert.ok(initial.enemies.every((enemy) => profileId(enemy) === "standard"));
  const saved = await page.evaluate(() => ({ ...localStorage }));

  await details(page, "#enemy-abilities");
  assert.equal(await page.locator("#enemy-profile-select option").count(), 4);
  await page.locator("#enemy-profile-select").selectOption("leaper");
  const before = await read(page);
  const jump = page.locator("#ability-jumpHeight");
  assert.equal(
    await jump.isDisabled(),
    true,
    "Ability ranges begin individually locked",
  );
  const playerJump = await page.locator("#physics-jumpHeight").inputValue();
  await unlockSlider(page, "ability-jumpHeight");
  const bounds = await jump.boundingBox();
  const start = point(
    21,
    bounds.x + bounds.width * 0.4,
    bounds.y + bounds.height / 2,
  );
  const end = { ...start, x: bounds.x + bounds.width * 0.58 };
  await native("touchStart", [start]);
  await native("touchMove", [end], [end]);
  await native("touchEnd", [end], [end]);
  await advance(page, 80);
  let state = await read(page);
  assert.ok(
    state.profiles.leaper.jumpHeight > before.profiles.leaper.jumpHeight,
  );
  assert.equal(
    await page.locator("#physics-jumpHeight").inputValue(),
    playerJump,
  );
  const adjusted = await jump.inputValue();
  await page.locator('[data-slider-lock="ability-jumpHeight"]').click();
  assert.equal(await jump.isDisabled(), true);
  assert.equal(
    await jump.inputValue(),
    adjusted,
    "Locking retains the edited ability",
  );
  // Set a bounded authored height so the live AI route uses a consistent test
  // profile independently of the native-drag amount above.
  const jumpParameter = ENEMY_ABILITY_PARAMETERS.find(
    (parameter) => parameter.id === "jumpHeight",
  );
  await jump.evaluate(
    (input, value) => {
      input.value = value;
      input.dispatchEvent(new Event("input", { bubbles: true }));
    },
    jumpParameter.log ? Math.log10(80) : 80,
  );

  // Global count remains an explicit cap rather than being silently replaced.
  await details(page, "#tag-settings");
  await page.locator("#tag-maxEnemies").evaluate((input) => {
    input.value = 4;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await roster(page, "tag", { leaper: 2 });
  await close(page);
  await mode(page, "tag");
  state = await read(page);
  assert.equal(state.alive, "2");
  assert.ok(state.enemies.every((enemy) => profileId(enemy) === "leaper"));
  assert.equal(
    state.tagSettings.maxEnemies,
    4,
    "Custom roster preserves the global cap",
  );
  let maximumHeight = Math.max(
    ...state.enemies.map((enemy) => enemy.position[1]),
  );
  for (let sample = 0; sample < 50 && maximumHeight < 8; sample++) {
    await advance(page, 100);
    state = await read(page);
    maximumHeight = Math.max(
      maximumHeight,
      ...state.enemies.map((enemy) => enemy.position[1]),
    );
    assert.ok(
      state.enemies.every((enemy) => enemy.position.every(Number.isFinite)),
    );
    assert.ok(
      state.enemies.every((enemy) => enemy.phase === "idle"),
      "Tag enemies never attack",
    );
  }
  assert.ok(
    maximumHeight > 8,
    `Leaper escape uses physical vertical movement: ${JSON.stringify(state.enemies)}`,
  );
  assert.equal(state.health, initial.health);
  await page.screenshot({ path: "test-results/v085-leaper-tag-airborne.png" });
  console.log(
    "PASS: individual ability locks preserve player jump tuning; Leaper-only Tag roster makes genuine high vertical escapes with no combat damage",
  );

  await roster(page, "combat", { standard: 1, acrobat: 1, heavy: 1 });
  await close(page);
  await mode(page, "combat");
  state = await read(page);
  assert.equal(state.alive, "3");
  assert.deepEqual(state.enemies.map(profileId).sort(), [
    "acrobat",
    "heavy",
    "standard",
  ]);
  assert.equal(state.wave, "1");
  assert.deepEqual(state.enemySettings, initial.enemySettings);
  const controls = await stick(page, native);
  await controls.move(0, -0.35);
  await controls.tap("jump");
  await advance(page, 120);
  await controls.enter("punch");
  await advance(page, 100);
  assert.equal(
    await page.locator("#stance-label").getAttribute("data-action"),
    "punch",
  );
  const punchSequence = Number(
    await page.locator("#stance-label").getAttribute("data-sequence"),
  );
  await controls.enter("block");
  await advance(page, 80);
  assert.equal(
    await page.locator("#block-button").getAttribute("aria-pressed"),
    "true",
  );
  await controls.enter("kick");
  // Canceled Punch recovery is 160 ms; after the 80 ms guard hold, allow its
  // remainder plus the 80 ms HUD refresh and a render frame for the held Kick.
  for (let elapsed = 0; elapsed < 240; elapsed += 20) {
    if (
      (await page.locator("#stance-label").getAttribute("data-action")) ===
      "kick"
    )
      break;
    await advance(page, 20);
  }
  assert.equal(
    await page.locator("#stance-label").getAttribute("data-action"),
    "kick",
  );
  assert.equal(
    Number(await page.locator("#stance-label").getAttribute("data-sequence")),
    punchSequence + 1,
  );
  assert.equal(
    await page.locator("#block-button").getAttribute("aria-pressed"),
    "false",
  );
  await controls.stop();
  state = await read(page);
  assert.ok(
    state.enemies.every((enemy) => enemy.position.every(Number.isFinite)),
  );
  assert.deepEqual(
    await page.evaluate(() => ({ ...localStorage })),
    saved,
    "Session-only profile and roster edits preserve all saved preferences",
  );

  await details(page, "#enemy-abilities");
  await page.locator("#ability-reset-all").click();
  await details(page, "#enemy-settings");
  await page.locator("#combat-roster-custom").uncheck();
  await details(page, "#tag-settings");
  await page.locator("#tag-roster-custom").uncheck();
  await page.locator("#tag-reset").click();
  await close(page);
  console.log(
    "PASS: mixed Combat archetypes, independent mode rosters and profile reset preserve waves, saved settings and native Jump/Punch/Block/Kick controls",
  );
}
