import assert from "node:assert/strict";
import { PROGRESSION_KEY } from "../src/progression/ProgressionCatalog.js";
import { PROGRESSION_LAB_KEY } from "../src/progression/ProgressionLab.js";
import { unlockSlider, expandDeveloperSections } from "./slider-test-utils.mjs";
const advance = (p, ms = 80) => p.clock.runFor(ms);
const saved = (p) =>
  p.evaluate((k) => JSON.parse(localStorage.getItem(k)), PROGRESSION_KEY);
const lab = (p) =>
  p.evaluate((k) => JSON.parse(localStorage.getItem(k)), PROGRESSION_LAB_KEY);
async function character(p) {
  await p.locator("#settings-button").click();
  await p.locator("#character-button").click();
  await advance(p);
}
async function category(p, id) {
  const d = p.locator("#progression-category-" + id);
  if (!(await d.evaluate((n) => n.open))) await d.locator("summary").click();
}
async function menu(p) {
  if (await p.locator("#physics-panel").evaluate((n) => n.hidden))
    await p.locator("#physics-toggle").click();
  await expandDeveloperSections(p);
}
async function press(p, id) {
  const n = p.locator("#" + id);
  const ids = await n.evaluate((n) => {
    const result = [];
    for (let q = n.parentElement; q; q = q.parentElement)
      if (q.tagName === "DETAILS" && !q.open && q.id) result.unshift(q.id);
    return result;
  });
  for (const id of ids) await p.locator("#" + id + " > summary").click();
  await n.click();
  await advance(p);
}
async function confirm(p, id, accept) {
  p.once("dialog", (d) => (accept ? d.accept() : d.dismiss()));
  await press(p, id);
}
export async function checkProgressionRefinement(p, native) {
  await p.evaluate(
    (keys) => keys.forEach((k) => localStorage.removeItem(k)),
    [PROGRESSION_KEY, PROGRESSION_LAB_KEY],
  );
  await p.goto(new URL("?practice=1", p.url()).href, {
    waitUntil: "networkidle",
  });
  await advance(p, 150);
  await character(p);
  assert.equal(await p.locator(".progression-stat").count(), 0);
  const rows = await p.locator('[id^="progression-stat-"]').allTextContents();
  assert.equal(rows.length, 20);
  assert.ok(rows.every((t) => t.includes("Attribute 1 /")));
  assert.ok(
    rows.every((t) => !t.includes("×")),
    "Normal attribute cards hide gameplay multipliers",
  );
  await p.locator("#progression-preview-maximumVelocity").tap();
  assert.match(
    await p.locator("#progression-preview").textContent(),
    /Attribute 1 → 2/,
  );
  await p.locator("#progression-confirm").tap();
  assert.match(
    await p.locator("#progression-stat-maximumVelocity").textContent(),
    /Attribute 2/,
  );
  await p.locator("#progression-close").click();
  const legacy = {
    version: 1,
    level: 8,
    experience: 31,
    points: 9,
    upgrades: { maximumVelocity: 4, jumpStrength: 3 },
    unlocked: ["doubleJump", "parkour", "freeflow", "aerialReserve"],
    selected: ["aerialReserve"],
  };
  await p.evaluate(
    ([key, value]) => localStorage.setItem(key, JSON.stringify(value)),
    [PROGRESSION_KEY, legacy],
  );
  await p.reload({ waitUntil: "networkidle" });
  await advance(p);
  await character(p);
  assert.match(
    await p.locator("#progression-overview").textContent(),
    /Level 8.*XP 31.*9 upgrade points/,
  );
  assert.match(
    await p.locator("#progression-stat-maximumVelocity").textContent(),
    /Attribute 5/,
  );
  await category(p, "parkour");
  await p.locator("#progression-preview-agility").click();
  await p.locator("#progression-confirm").tap();
  const permanent = await saved(p);
  assert.equal(permanent.version, 2);
  assert.equal(permanent.experience, 31);
  assert.equal(permanent.points, 8);
  assert.ok(permanent.unlocked.includes("aerialReserve"));
  await p.locator("#progression-close").click();
  console.log(
    "PASS: v093 numerical attributes, native one-point purchases, multiplier-free cards and v092 save migration preserve character progress",
  );
  await p.goto(new URL("?sandbox=1&practice=1", p.url()).href, {
    waitUntil: "networkidle",
  });
  await advance(p);
  await menu(p);
  assert.ok(await p.locator("#progression-lab-rate").isDisabled());
  await p.locator("#progression-lab-preset").selectOption("Additive 10%");
  await p.locator("#progression-lab-attribute").selectOption("maximumVelocity");
  const rate = await unlockSlider(p, "progression-lab-rate");
  await rate.press("ArrowRight");
  await advance(p);
  assert.ok(
    Math.abs((await lab(p)).draft.stats.maximumVelocity.rate - 0.11) < 1e-9,
  );
  assert.ok(await p.locator("#progression-lab-base").isDisabled());
  assert.match(
    await p.locator("#progression-lab-preview").textContent(),
    /5.772/,
  );
  assert.match(
    await p.locator("#progression-lab-formula").textContent(),
    /not compounded/,
  );
  // Real native pan on the new unlocked track must scroll without changing it.
  await rate.evaluate((n) =>
    n.scrollIntoView({ block: "center", inline: "nearest" }),
  );
  const rect = await rate.boundingBox(),
    scroll = p.locator(".physics-scroll"),
    before = await scroll.evaluate((n) => n.scrollTop),
    storedRate = (await lab(p)).draft.stats.maximumVelocity.rate,
    cdp = await p.context().newCDPSession(p);
  const point = (n) => ({
    id: 77,
    x: rect.x + rect.width * 0.35,
    y: rect.y + rect.height / 2 - n * 14,
    radiusX: 7,
    radiusY: 7,
    force: 1,
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [point(0)],
  });
  for (let n = 1; n <= 6; n++) {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [point(n)],
    });
    await advance(p, 20);
  }
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await advance(p, 100);
  assert.ok((await scroll.evaluate((n) => n.scrollTop)) > before + 10);
  assert.equal((await lab(p)).draft.stats.maximumVelocity.rate, storedRate);
  await cdp.detach();
  await p.locator("#progression-lab-ability").selectOption("aerialReserve");
  await p.locator("#progression-lab-requirement-stat").selectOption("agility");
  const requirement = await unlockSlider(
    p,
    "progression-lab-ability-requirement",
  );
  await requirement.press("Home");
  for (let n = 0; n < 4; n++) await requirement.press("ArrowRight");
  await press(p, "progression-lab-add-requirement");
  assert.equal(
    (await lab(p)).draft.abilities.aerialReserve.attributes.agility,
    5,
  );
  assert.equal(
    (await lab(p)).draft.abilities.aerialReserve.attributes.jumpStrength,
    3,
  );
  const experience = await unlockSlider(
    p,
    "progression-lab-economy-experienceBase",
  );
  await experience.press("Home");
  await experience.press("ArrowRight");
  await advance(p);
  assert.equal((await lab(p)).draft.economy.experienceBase, 2);
  await p.locator("#progression-name-configurations").fill("Curve 11");
  await press(p, "progression-save-configurations");
  await p.locator("#progression-lab-preset").selectOption("Additive 50%");
  await press(p, "progression-load-configurations");
  assert.equal((await lab(p)).draft.stats.maximumVelocity.rate, 0.11);
  assert.equal(
    (await lab(p)).draft.abilities.aerialReserve.attributes.agility,
    5,
  );
  assert.equal((await lab(p)).draft.economy.experienceBase, 2);
  assert.ok(await rate.isDisabled(), "Loading rules relocks sliders");
  assert.deepEqual(await saved(p), permanent);
  await confirm(p, "progression-lab-activate", false);
  assert.equal((await lab(p)).active.stats.maximumVelocity.type, "diminishing");
  await confirm(p, "progression-lab-activate", true);
  assert.equal((await lab(p)).active.stats.maximumVelocity.rate, 0.11);
  assert.deepEqual(await saved(p), permanent);
  await confirm(p, "progression-lab-restore-reference", true);
  assert.equal((await lab(p)).active.stats.maximumVelocity.type, "diminishing");
  await p.reload({ waitUntil: "networkidle" });
  await advance(p);
  await menu(p);
  assert.equal((await lab(p)).draft.stats.maximumVelocity.rate, 0.11);
  assert.ok(await p.locator("#progression-lab-rate").isDisabled());
  await press(p, "progression-lab-begin");
  await press(p, "progression-lab-budget");
  await p.locator("#progression-lab-identity").selectOption("Speedster");
  await press(p, "progression-lab-template");
  await p.locator("#progression-name-builds").fill("Fast 100");
  await press(p, "progression-save-builds");
  let state = await lab(p),
    fast = state.builds[0].value.character;
  assert.ok(fast.upgrades.maximumVelocity > 0);
  assert.equal(fast.upgrades.jumpStrength, 0);
  assert.equal(fast.upgrades.airControl, 0);
  await p.locator("#progression-lab-identity").selectOption("Acrobat");
  await press(p, "progression-lab-template");
  await p.locator("#progression-name-builds").fill("Agile 100");
  await press(p, "progression-save-builds");
  state = await lab(p);
  assert.equal(state.builds.length, 2);
  const agile = state.builds[1].value.character;
  assert.ok(agile.upgrades.airControl > 0);
  assert.equal(agile.upgrades.maximumVelocity, 0);
  assert.match(
    await p.locator("#progression-build-status").textContent(),
    /budget 100/,
  );
  await p
    .locator("#progression-library-builds")
    .selectOption({ label: "Fast 100" });
  await press(p, "progression-load-builds");
  await press(p, "progression-test-open");
  assert.match(
    await p.locator("#progression-notice").textContent(),
    /TEMPORARY/,
  );
  assert.match(
    await p.locator("#progression-stat-maximumVelocity").textContent(),
    new RegExp("Attribute " + (fast.upgrades.maximumVelocity + 1)),
  );
  await p.locator("#progression-close").click();
  await menu(p);
  await press(p, "progression-lab-respec");
  assert.match(
    await p.locator("#progression-build-status").textContent(),
    /invested 0 points/,
  );
  await press(p, "progression-lab-end");
  assert.deepEqual(await saved(p), permanent);
  // The original named sandbox snapshot must not include any progression editor.
  const buildSection = p.locator("#developer-configurations");
  if (!(await buildSection.evaluate((n) => n.open)))
    await buildSection.locator("summary").click();
  await p.locator("#developer-build-name").fill("Ordinary sandbox");
  await p.locator("#developer-build-save").click();
  const standard = await p.evaluate(() =>
    JSON.parse(localStorage.getItem("kinetic.sandbox-configurations.v1")),
  );
  assert.ok(
    !Object.keys(standard.items.at(-1).snapshot.values.extras ?? {}).some(
      (id) => id.startsWith("progression-"),
    ),
  );
  assert.deepEqual(await saved(p), permanent);
  await press(p, "progression-lab-reset");
  assert.equal((await lab(p)).draft.stats.maximumVelocity.type, "diminishing");
  await p.locator("#physics-close").click();
  await p.locator("#game-mode").selectOption("tag");
  await advance(p);
  await p.locator("#game-mode").selectOption("combat");
  await advance(p);
  assert.deepEqual(await saved(p), permanent);
  await menu(p);
  await p.locator("#developer-search").fill("growth rate");
  await advance(p);
  assert.equal(await p.locator("#progression-lab-rate").count(), 1);
  await p.locator("#developer-favourite-progression-lab-rate").click();
  await p.locator("#developer-search").fill("");
  if (!(await p.locator("#developer-favourites").evaluate((n) => n.open)))
    await p.locator("#developer-favourites > summary").click();
  await p.locator("#progression-lab-attribute").selectOption("jumpStrength");
  await advance(p);
  assert.equal(await p.locator("#progression-lab-rate").inputValue(), "4");
  assert.ok(
    await p.locator("#progression-lab-rate").isDisabled(),
    "Favourite uses the same context and relocked range",
  );
  await p.locator("#developer-favourite-progression-lab-rate").click();
  await p.setViewportSize({ width: 390, height: 844 });
  await advance(p);
  await p.locator("#progression-lab-attribute").selectOption("jumpStrength");
  await p
    .locator("#progression-lab-rate")
    .evaluate((n) => n.scrollIntoView({ block: "center" }));
  await p.screenshot({ path: "test-results/v093-balancing-portrait.png" });
  await p.setViewportSize({ width: 844, height: 390 });
  await advance(p);
  await p.screenshot({ path: "test-results/v093-balancing-landscape.png" });
  await p.locator("#physics-close").click();
  console.log(
    "PASS: v093 locked live curve editor, numerical previews, native scrolling, independent config persistence, confirmed activation, equal-budget build libraries/respec, sandbox isolation and Combat/Tag switching",
  );
}
