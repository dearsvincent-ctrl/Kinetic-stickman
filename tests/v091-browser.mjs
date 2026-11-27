import assert from "node:assert/strict";
import {
  SETTING_CATALOG,
  MENU_PREFERENCES_KEY,
} from "../src/sandbox/SettingsRegistry.js";
import { CONFIGURATIONS_KEY } from "../src/sandbox/SandboxConfigurations.js";
import { unlockSlider } from "./slider-test-utils.mjs";
import { fresh, advance, read } from "./v087-polish-browser.mjs";
import { stick } from "./acrobatic-browser.mjs";
const menu = "#physics-panel";
async function show(page) {
  if (await page.locator(menu).evaluate((n) => n.hidden))
    await page.locator("#physics-toggle").click();
  await advance(page, 80);
}
async function hide(page) {
  if (!(await page.locator(menu).evaluate((n) => n.hidden)))
    await page.locator("#physics-close").click();
  await advance(page, 80);
}
async function reveal(page, selector) {
  await show(page);
  const loc = page.locator(selector);
  const closed = await loc.evaluate((n) => {
    const ids = [];
    for (let p = n.parentElement; p; p = p.parentElement)
      if (
        p.tagName === "DETAILS" &&
        !p.open &&
        p.id &&
        !(n.tagName === "SUMMARY" && n.parentElement === p)
      )
        ids.unshift(p.id);
    return ids;
  });
  for (const id of closed) await page.locator(`#${id} > summary`).click();
  await loc.scrollIntoViewIfNeeded();
  return loc;
}
const search = async (page, text) => {
  await show(page);
  await page.locator("#developer-search").fill(text);
  await advance(page, 80);
};
async function arrow(page, id, key = "ArrowRight") {
  const s = await unlockSlider(page, id);
  await s.press(key);
  await advance(page, 80);
  return s;
}
const pref = (page) =>
  page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)),
    MENU_PREFERENCES_KEY,
  );
const builds = (page) =>
  page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)),
    CONFIGURATIONS_KEY,
  );
async function invoke(page, id, confirm = null) {
  const b = await reveal(page, `#${id}`);
  if (confirm !== null)
    page.once("dialog", (d) => (confirm ? d.accept() : d.dismiss()));
  await b.click();
  await advance(page, 80);
}
async function checkNavigation(page) {
  await fresh(page);
  await show(page);
  assert.equal(await page.locator(".developer-category").count(), 9);
  for (const d of SETTING_CATALOG.values())
    assert.equal(
      await page.locator(`#${d.id}`).count(),
      1,
      `${d.id} retains its original widget`,
    );
  const ranges = await page.locator(`${menu} input[type=range]`).count();
  assert.equal(
    await page.locator(`${menu} [data-slider-lock]`).count(),
    ranges,
  );
  await page.locator("#developer-collapse-all").click();
  await advance(page, 80);
  assert.ok(
    await page
      .locator(`${menu} details`)
      .evaluateAll((xs) => xs.every((x) => !x.open)),
  );
  await page.locator("#developer-expand-all").click();
  await advance(page, 80);
  assert.ok(
    await page
      .locator(`${menu} details`)
      .evaluateAll((xs) => xs.every((x) => x.open)),
  );
  await page.locator("#developer-collapse-all").click();
  await page.locator("#developer-category-reactions > summary").click();
  await advance(page, 80);
  const saved = await pref(page);
  assert.ok(saved.open.includes("developer-category-reactions"));
  await fresh(page);
  await show(page);
  assert.ok(
    await page.locator("#developer-category-reactions").evaluate((n) => n.open),
  );
  assert.equal(
    await page.locator("#developer-category-camera").evaluate((n) => n.open),
    false,
  );
  console.log(
    "PASS: v091 complete setting inventory, unique original widgets, compact category navigation, Expand/Collapse and persisted expansion",
  );
}
async function checkSearchFavourites(page) {
  await search(page, "ground movement");
  const range = page.locator("#physics-movement");
  assert.ok(await range.isVisible());
  assert.ok(await range.isDisabled());
  assert.match(
    await page.locator("#developer-search-results").innerText(),
    /Player Movement/,
  );
  await arrow(page, "physics-movement");
  const value = await range.inputValue();
  assert.ok(await range.isEnabled());
  await page.locator("#developer-favourite-physics-movement").click();
  await advance(page, 80);
  assert.equal(await page.locator("#physics-movement").count(), 1);
  assert.equal(await range.inputValue(), value);
  assert.ok(await range.isEnabled());
  await search(page, "");
  assert.equal(
    await page.locator("#developer-category-reactions").evaluate((n) => n.open),
    true,
    "Clearing search preserves the pre-search category layout",
  );
  await page.locator("#developer-favourites > summary").click();
  await advance(page, 80);
  assert.ok(await range.isVisible());
  assert.equal(await range.inputValue(), value);
  assert.ok(
    await range.isDisabled(),
    "Opening the Favourites section relocks its original range",
  );
  await arrow(page, "physics-movement");
  const changed = await range.inputValue();
  await hide(page);
  await show(page);
  assert.ok(await range.isDisabled());
  assert.equal(await range.inputValue(), changed);
  await fresh(page);
  await show(page);
  assert.ok((await pref(page)).favourites.includes("physics-movement"));
  assert.equal(
    await page
      .locator("#developer-favourite-physics-movement")
      .getAttribute("aria-pressed"),
    "true",
  );
  await search(page, "jump height");
  await unlockSlider(page, "ability-jumpHeight");
  assert.ok(await page.locator("#ability-jumpHeight").isEnabled());
  await page.locator("#enemy-profile-select").selectOption("leaper");
  await advance(page, 80);
  assert.ok(
    await page.locator("#ability-jumpHeight").isDisabled(),
    "Profile changes relock the same moved search widget",
  );
  await page.locator("#developer-favourite-ability-jumpHeight").click();
  await advance(page, 80);
  await search(page, "");
  await reveal(page, "#ability-jumpHeight");
  await unlockSlider(page, "ability-jumpHeight");
  await page.locator("#enemy-profile-select").selectOption("standard");
  await advance(page, 80);
  assert.ok(
    await page.locator("#ability-jumpHeight").isDisabled(),
    "Profile changes also relock the original widget inside Favourites",
  );
  await search(page, "Enemy archetype to edit");
  assert.ok(
    await page.locator("#enemy-profile-select").isVisible(),
    "Context selectors are searchable by their own names",
  );
  await search(page, "unlikely absent setting");
  assert.match(
    await page.locator("#developer-menu-status").textContent(),
    /0 matching/,
  );
  await search(page, "");
  console.log(
    "PASS: v091 partial search/path display, direct original adjustment, shared favourite values/locks, persistence and menu relocking",
  );
}
async function checkTouch(page, native) {
  await page.setViewportSize({ width: 844, height: 390 });
  await search(page, "speed");
  const id = "physics-movement",
    slider = page.locator(`#${id}`);
  const cdp = await page.context().newCDPSession(page);
  async function swipe(dx, dy) {
    await slider.evaluate((node) =>
      node.scrollIntoView({ block: "center", inline: "nearest" }),
    );
    const b = await slider.boundingBox(),
      x = b.x + b.width * 0.35,
      y = b.y + b.height / 2;
    const touch = (x, y) => ({
      id: 81,
      x,
      y,
      radiusX: 7,
      radiusY: 7,
      force: 1,
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [touch(x, y)],
    });
    for (let n = 1; n <= 6; n++) {
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [touch(x + (dx * n) / 6, y + (dy * n) / 6)],
      });
      await advance(page, 20);
    }
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await advance(page, 80);
  }
  try {
    await hide(page);
    await show(page);
    const before = await slider.inputValue();
    await swipe(60, 0);
    assert.equal(await slider.inputValue(), before);
    for (const unlocked of [false, true]) {
      if (unlocked) await unlockSlider(page, id);
      await slider.evaluate((node) =>
        node.scrollIntoView({ block: "center", inline: "nearest" }),
      );
      const scroll = page.locator(".physics-scroll"),
        top = await scroll.evaluate((n) => n.scrollTop);
      await swipe(1, -85);
      assert.ok((await scroll.evaluate((n) => n.scrollTop)) > top + 5);
      assert.equal(await slider.inputValue(), before);
    }
    await swipe(45, 0);
    assert.notEqual(await slider.inputValue(), before);
    assert.equal(
      await page.locator(`${menu} input[type=range]:enabled`).count(),
      1,
    );
    assert.ok(
      await page
        .locator(menu)
        .evaluate((n) => n.scrollWidth <= n.clientWidth + 1),
    );
    assert.equal(await page.evaluate(() => scrollY), 0);
  } finally {
    await cdp.detach();
  }
  // A second native pointer can still own MOVE while the menu is open.
  await search(page, "");
  const controls = await stick(page, native),
    start = await read(page);
  await controls.move(0, 0.5);
  await advance(page, 200);
  await controls.stop();
  const after = await read(page);
  assert.ok(
    Math.hypot(...after.position.map((x, i) => x - start.position[i])) > 0.01,
  );
  console.log(
    "PASS: v091 locked/unlocked native vertical scrolling, intentional horizontal adjustment, landscape fit and independent joystick pointer",
  );
}
async function checkResets(page) {
  await search(page, "balance damage");
  await arrow(page, "enemy-reactions-balanceDamage");
  const modified = await page
    .locator("#enemy-reactions-balanceDamage")
    .inputValue();
  assert.notEqual(modified, "1");
  const physical = await page.locator("#physics-movement").inputValue(),
    favourites = [...(await pref(page)).favourites];
  await search(page, "");
  await invoke(page, "developer-reset-reactions", false);
  assert.equal(
    await page.locator("#enemy-reactions-balanceDamage").inputValue(),
    modified,
  );
  await invoke(page, "developer-reset-reactions", true);
  assert.equal(
    await page.locator("#enemy-reactions-balanceDamage").inputValue(),
    "1",
  );
  assert.equal(await page.locator("#physics-movement").inputValue(), physical);
  assert.deepEqual((await pref(page)).favourites, favourites);
  console.log(
    "PASS: v091 category reset confirmation, isolation from unrelated settings and preserved favourites",
  );
}
async function checkConfigurations(page) {
  await search(page, "");
  await invoke(page, "physics-reset");
  const preset = await reveal(page, '[data-physics-preset="Speedster"]');
  await preset.click();
  await advance(page, 80);
  await (await reveal(page, "#enemy-profile-select")).selectOption("leaper");
  await arrow(page, "ability-jumpHeight");
  await (await reveal(page, "#camera-profile")).selectOption("tag");
  await (await reveal(page, "#camera-mode")).selectOption("assisted");
  await arrow(page, "camera-baseFov");
  await (await reveal(page, "#tag-roster-custom")).check();
  await (await reveal(page, "#tag-roster-standard-enabled")).uncheck();
  await (await reveal(page, "#tag-roster-leaper-enabled")).check();
  await arrow(page, "tag-roster-leaper-count");
  await (
    await reveal(page, "#developer-build-name")
  ).fill("V091 native Speedster");
  await invoke(page, "developer-build-save");
  let all = await builds(page),
    item = all.items.find((x) => x.name === "V091 native Speedster");
  assert.ok(item);
  assert.equal(item.snapshot.values.physics.movement, 100);
  assert.equal(item.snapshot.values.camera.tag.mode, "assisted");
  assert.equal(item.snapshot.values.camera.combat.mode, "manual");
  assert.equal(item.snapshot.values.rosters.tag.leaper, 2);
  assert.equal(item.snapshot.values.rosters.tag.standard, 0);
  assert.equal(item.snapshot.values.rosters.combat, null);
  const leap = item.snapshot.values.profiles.leaper.jumpHeight,
    tagFov = item.snapshot.values.camera.tag.baseFov;
  assert.ok(leap > 0);
  assert.ok(tagFov > 52);
  const prefBefore = (await pref(page)).favourites;
  await invoke(page, "physics-reset");
  await invoke(page, "ability-reset-all");
  await invoke(page, "camera-reset");
  await (await reveal(page, "#tag-roster-custom")).uncheck();
  await invoke(page, "developer-build-load");
  assert.equal(await page.locator("#physics-movement").inputValue(), "2");
  assert.ok(
    await page
      .locator(`${menu} input[type=range]`)
      .evaluateAll((xs) => xs.every((x) => x.disabled)),
  );
  assert.ok(await page.locator("#tag-roster-custom").isChecked());
  assert.ok(await page.locator("#tag-roster-leaper-enabled").isChecked());
  assert.equal(
    await page.locator("#tag-roster-leaper-count").inputValue(),
    "2",
  );
  assert.equal(
    Number(await page.locator("#camera-baseFov").inputValue()),
    tagFov,
  );
  assert.equal(await page.locator("#camera-mode").inputValue(), "assisted");
  assert.ok(
    Math.abs(
      10 ** Number(await page.locator("#ability-jumpHeight").inputValue()) -
        leap,
    ) <
      leap * 0.02,
  );
  assert.deepEqual((await pref(page)).favourites, prefBefore);
  await invoke(page, "developer-build-save");
  assert.match(
    await page.locator("#developer-build-status").textContent(),
    /already exists/,
  );
  await invoke(page, "developer-build-overwrite", false);
  assert.equal((await builds(page)).items.length, 1);
  await invoke(page, "developer-build-overwrite", true);
  await (await reveal(page, "#developer-build-name")).fill("V091 renamed");
  await invoke(page, "developer-build-rename");
  await (await reveal(page, "#developer-build-name")).fill("V091 copy");
  await invoke(page, "developer-build-duplicate");
  assert.equal((await builds(page)).items.length, 2);
  await invoke(page, "developer-build-delete", false);
  assert.equal((await builds(page)).items.length, 2);
  await invoke(page, "developer-build-delete", true);
  assert.equal((await builds(page)).items.length, 1);
  await fresh(page);
  await show(page);
  await reveal(page, "#developer-build-select");
  all = await builds(page);
  item = all.items[0];
  assert.equal(item.name, "V091 renamed");
  await page.locator("#developer-build-select").selectOption(item.id);
  await invoke(page, "developer-build-load");
  assert.equal(await page.locator("#physics-movement").inputValue(), "2");
  // Restore actual default gameplay owners through the same category actions.
  for (const category of [
    "movement",
    "parkour",
    "combat",
    "reactions",
    "enemies",
    "camera",
    "modes",
    "visuals",
  ])
    await invoke(page, `developer-reset-${category}`, true);
  const favouritesBeforeTools = (await pref(page)).favourites;
  await invoke(page, "developer-edit-controls");
  assert.ok(await page.locator("#control-editor-toolbar").isVisible());
  assert.equal(
    await page.locator("#physics-panel").evaluate((n) => n.hidden),
    true,
  );
  await page.locator("#layout-cancel").click();
  await advance(page, 80);
  await invoke(page, "developer-reset-interface", false);
  assert.equal(
    await page.locator("#physics-panel").evaluate((n) => n.hidden),
    false,
  );
  await invoke(page, "developer-reset-interface", true);
  assert.equal(
    await page.locator("#physics-panel").evaluate((n) => n.hidden),
    true,
  );
  assert.equal(
    await page.locator("#control-editor-toolbar").isVisible(),
    false,
  );
  assert.deepEqual((await pref(page)).favourites, favouritesBeforeTools);
  await hide(page);
  console.log(
    "PASS: v091 native named save/load, independent camera/profile capture, explicit overwrite, rename/duplicate/delete confirmations and refresh; original presets and lock safety retained",
  );
}
export async function checkDeveloperMenu(page, native) {
  await checkNavigation(page);
  await checkSearchFavourites(page);
  await checkTouch(page, native);
  await checkResets(page);
  await checkConfigurations(page);
  await page.screenshot({ path: "test-results/v091-developer-complete.png" });
}
