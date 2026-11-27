import assert from "node:assert/strict";
import { PROGRESSION_KEY } from "../src/progression/ProgressionCatalog.js";
import { stick } from "./acrobatic-browser.mjs";
import { expandDeveloperSections } from "./slider-test-utils.mjs";
const advance = (p, ms) => p.clock.runFor(ms);
const saved = (p) =>
  p.evaluate((k) => JSON.parse(localStorage.getItem(k)), PROGRESSION_KEY);
async function openCharacter(p) {
  await p.locator("#settings-button").click();
  await p.locator("#character-button").click();
  await advance(p, 60);
  assert.ok(await p.locator("#progression-dialog").isVisible());
}
async function category(p, id) {
  const d = p.locator(`#progression-category-${id}`);
  if (!(await d.evaluate((n) => n.open))) await d.locator("summary").click();
}
async function buy(p, id) {
  await category(
    p,
    ["runningSpeed", "maximumVelocity", "groundAcceleration"].includes(id)
      ? "movement"
      : [
            "airControl",
            "airAcceleration",
            "airBraking",
            "aerialRecovery",
            "rotationalControl",
          ].includes(id)
        ? "aerial"
        : [
              "attackSpeed",
              "attackPower",
              "knockback",
              "combatRecovery",
              "balance",
            ].includes(id)
          ? "combat"
          : "parkour",
  );
  await p.locator(`#progression-preview-${id}`).click();
  assert.ok(await p.locator("#progression-confirm").isEnabled());
  await p.locator("#progression-confirm").click();
  await advance(p, 50);
}
async function dev(p) {
  await p.locator("#physics-toggle").click();
  await expandDeveloperSections(p);
  if (!(await p.locator("#progression-testing").evaluate((n) => n.open)))
    await p.locator("#progression-testing > summary").click();
}
export async function checkProgression(p, native) {
  await p.evaluate((k) => localStorage.removeItem(k), PROGRESSION_KEY);
  await p.goto(new URL("?practice=1", p.url()).href, {
    waitUntil: "networkidle",
  });
  await advance(p, 200);
  assert.equal(await p.locator(".version b").textContent(), "0.9.2");
  await openCharacter(p);
  assert.match(
    await p.locator("#progression-overview").textContent(),
    /Level 1.*3 upgrade points/,
  );
  await category(p, "parkour");
  await p.locator("#progression-preview-jumpStrength").click();
  assert.equal(
    await saved(p),
    null,
    "Preview spends nothing and writes no save",
  );
  await p.locator("#progression-dismiss-preview").click();
  await buy(p, "jumpStrength");
  assert.equal((await saved(p)).upgrades.jumpStrength, 1);
  assert.equal((await saved(p)).points, 2);
  await buy(p, "maximumVelocity");
  assert.equal((await saved(p)).points, 1);
  await category(p, "combat");
  assert.match(
    await p.locator("#progression-stat-combatRecovery").textContent(),
    /Requires Attack speed rank 1/,
  );
  await category(p, "abilities");
  assert.match(
    await p.locator("#progression-ability-aerialReserve").textContent(),
    /Requires character level 2/,
  );
  const initial = await saved(p);
  await p.locator("#progression-close").click();
  await advance(p, 80);
  assert.ok(await p.locator("#progression-dialog").isHidden());
  const controls = await stick(p, native);
  await controls.tap("jump");
  await advance(p, 170);
  const launch = Number(
    await p.locator("#jump-button").getAttribute("data-jump-launch"),
  );
  assert.ok(
    launch > Math.sqrt(2 * 18 * 1.2),
    "Permanent purchased jump changes actual launch",
  );
  await controls.stop();
  await advance(p, 1800);
  await controls.move(1, 0);
  await advance(p, 1100);
  assert.ok(
    Number(await p.locator("#speed-value").textContent()) > 5.2,
    "Maximum-velocity upgrade changes physical ground speed",
  );
  await controls.stop();
  await advance(p, 100);
  await p.reload({ waitUntil: "networkidle" });
  await advance(p, 150);
  await openCharacter(p);
  assert.deepEqual(await saved(p), initial);
  assert.match(
    await p.locator("#progression-stat-jumpStrength").textContent(),
    /Rank 1\/10/,
  );
  const dialog = p.locator("#progression-dialog"),
    cdp = await p.context().newCDPSession(p);
  const rect = await dialog.boundingBox(),
    scrollBefore = await dialog.evaluate((n) => n.scrollTop);
  const point = (n) => ({
    id: 77,
    x: rect.x + rect.width * 0.8,
    y: rect.y + rect.height * 0.8 - n * 15,
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
  assert.ok(
    (await dialog.evaluate((n) => n.scrollTop)) > scrollBefore + 10,
    "Native vertical pan scrolls character panel without purchasing",
  );
  assert.deepEqual(await saved(p), initial);
  await cdp.detach();
  for (const size of [
    { width: 844, height: 390 },
    { width: 390, height: 844 },
    { width: 740, height: 320 },
  ]) {
    await p.setViewportSize(size);
    await advance(p, 50);
    const b = await p.locator("#progression-dialog").boundingBox();
    assert.ok(
      b.x >= 0 &&
        b.y >= 0 &&
        b.x + b.width <= size.width + 1 &&
        b.y + b.height <= size.height + 1,
      "Character dialog remains inside mobile viewport",
    );
    assert.ok(await p.locator("#progression-close").isVisible());
    await p.screenshot({
      path: `test-results/v092-character-${size.width}x${size.height}.png`,
    });
  }
  await p.setViewportSize({ width: 844, height: 390 });
  await p.locator("#progression-close").click();
  console.log(
    "PASS: v092 native progression preview/purchase/prerequisites, saved refresh, physical jump/sprint effects and landscape/portrait dialog",
  );
  // Explicit unrestricted sandbox: saved character is not changed or implicitly
  // multiplied into legacy sliders/builds. Temporary tests never write it.
  await p.goto(new URL("?sandbox=1&practice=1", p.url()).href, {
    waitUntil: "networkidle",
  });
  await advance(p, 150);
  const s = await stick(p, native);
  await s.tap("jump");
  await advance(p, 170);
  assert.ok(
    Math.abs(
      Number(await p.locator("#jump-button").getAttribute("data-jump-launch")) -
        Math.sqrt(2 * 18 * 1.2),
    ) < 1e-10,
  );
  await s.stop();
  await advance(p, 1600);
  const disk = await p.evaluate(() =>
    Object.fromEntries(
      Object.keys(localStorage).map((k) => [k, localStorage.getItem(k)]),
    ),
  );
  await dev(p);
  await p.locator("#progression-test-start").click();
  await p.locator("#progression-test-xp").click();
  for (let n = 0; n < 3; n++)
    await p.locator("#progression-test-points").click();
  await p.locator("#progression-test-open").click();
  assert.match(
    await p.locator("#progression-notice").textContent(),
    /TEMPORARY TEST/,
  );
  assert.match(
    await p.locator("#progression-overview").textContent(),
    /Level 2/,
  );
  await buy(p, "jumpStrength");
  await buy(p, "airControl");
  await category(p, "abilities");
  await p.locator("#progression-unlock-aerialReserve").click();
  await p.locator("#progression-confirm").click();
  await advance(p, 80);
  assert.match(
    await p.locator("#progression-ability-aerialReserve").textContent(),
    /Purchased/,
  );
  assert.deepEqual(
    await saved(p),
    initial,
    "Temporary upgrades never write permanent character",
  );
  await p.locator("#progression-close").click();
  for (let n = 0; n < 3; n++) {
    await s.tap("jump");
    await advance(p, 130);
  }
  assert.equal(
    await p.locator("#jump-button").getAttribute("data-jump-count"),
    "3",
  );
  await s.tap("jump");
  await advance(p, 60);
  assert.equal(
    await p.locator("#jump-button").getAttribute("data-jump-count"),
    "3",
    "No unlimited jumps",
  );
  await s.tap("punch");
  await advance(p, 130);
  await s.tap("kick");
  await advance(p, 330);
  assert.ok(
    ["punch", "kick"].includes(
      await p.locator("#stance-label").getAttribute("data-action"),
    ),
  );
  await s.stop();
  await dev(p);
  await p.locator("#progression-test-end").click();
  await p.locator("#physics-close").click();
  assert.deepEqual(await saved(p), initial);
  const after = await p.evaluate(() =>
    Object.fromEntries(
      Object.keys(localStorage)
        .filter((k) => k !== "kinetic.developer-menu.v1")
        .map((k) => [k, localStorage.getItem(k)]),
    ),
  );
  delete disk["kinetic.developer-menu.v1"];
  assert.deepEqual(
    after,
    disk,
    "Temporary build keeps all character and sandbox saves untouched",
  );
  await advance(p, 1800);
  await p.locator("#game-mode").selectOption("tag");
  await advance(p, 100);
  await p.locator("#game-mode").selectOption("combat");
  await advance(p, 100);
  assert.deepEqual(await saved(p), initial);
  assert.equal(await p.evaluate(() => typeof window.__KINETIC__), "undefined");
  console.log(
    "PASS: v092 sandbox bypass, temporary XP/points/ability unlock, physical third jump cap, manual aerial attacks, save isolation and Combat/Tag compatibility",
  );
}
