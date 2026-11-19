import { navigateX } from "./parkour-browser.mjs";
import assert from "node:assert/strict";
import { stick } from "./acrobatic-browser.mjs";
import { unlockSlider } from "./slider-test-utils.mjs";
import { ABILITY_PARAMETERS } from "../src/movement/MovementAbilities.js";
import {
  advance,
  read,
  fresh,
  open,
  close,
  setRange,
  until,
} from "./v087-polish-browser.mjs";
export async function checkMovementAbilities(page, native) {
  await fresh(page, { practice: true });
  await open(page, "movement-abilities");
  for (const { id } of ABILITY_PARAMETERS) {
    const slider = page.locator("#physics-" + id);
    assert.ok(await slider.isDisabled());
    assert.equal(
      await page.locator(`[data-slider-lock="physics-${id}"]`).count(),
      1,
    );
  }
  const ground = await page.locator("#physics-movement").inputValue();
  const slider = await unlockSlider(page, "physics-airAcceleration");
  await slider.press("End");
  await advance(page);
  assert.equal(
    await page
      .locator("#physics-airAcceleration")
      .getAttribute("aria-valuetext"),
    "100×",
  );
  assert.equal(await page.locator("#physics-movement").inputValue(), ground);
  await page.locator("#physics-save").click();
  await fresh(page, { practice: true });
  await open(page, "movement-abilities");
  assert.equal(
    await page
      .locator("#physics-airAcceleration")
      .getAttribute("aria-valuetext"),
    "100×",
  );
  assert.ok(await page.locator("#physics-airAcceleration").isDisabled());
  for (const name of [
    "Balanced",
    "Speedster",
    "Acrobat",
    "Superhuman Leaper",
  ]) {
    await page.locator('[data-physics-preset="' + name + '"]').click();
    assert.ok(await page.locator("#physics-status").textContent());
  }
  await page.locator("#physics-reset").click();
  await page.locator("#physics-save").click();
  await close(page);
  for (const speed of [3, 5, 20, 50, 100]) {
    await fresh(page, { practice: true });
    await setRange(page, "physics", { id: "movement", log: true }, speed);
    await close(page);
    const controls = await stick(page, native);
    await controls.move(0, -1);
    await advance(page, 320);
    const start = await read(page);
    await controls.tap("jump");
    await advance(page, 160);
    const jump = await read(page);
    assert.ok(
      jump.position[1] > 0.1 && jump.position[1] < 1.3,
      "ground speed does not boost launch height",
    );
    await controls.move(1, 0);
    await advance(page, 180);
    const air = await read(page);
    assert.ok(air.position.every(Number.isFinite));
    assert.ok(
      air.position[2] > jump.position[2],
      "takeoff momentum is not instantly redirected",
    );
    assert.equal(air.polish.strike.sequence, 0);
    assert.equal(start.polish.strike.sequence, 0);
    await controls.stop();
  }
  await fresh(page, { practice: true });
  await open(page, "movement-abilities");
  await page.locator("#physics-reset").click();
  await page.locator("#physics-save").click();
  await close(page);
  await checkExtremeWall(page, native);
  console.log(
    "PASS: v0.8.9 native independent locked/saved abilities, editable profiles, 3/5/20/50/100x grounded launches and bounded air redirection",
  );
}

export async function checkExtremeWall(page, native) {
  await fresh(page, { practice: true });
  const wallControls = await stick(page, native);
  await navigateX(page, wallControls, 50);
  await setRange(page, "physics", { id: "movement", log: true }, 100);
  await close(page);
  await wallControls.move(0, 1);
  const contact = await until(
    page,
    (s) =>
      ["vault", "climb", "wall-run", "ledge", "mantle"].includes(
        s.stance.parkour,
      ),
    "100x contact attaches contextually",
    { limit: 1800, step: 20 },
  );
  assert.ok(
    contact.position[1] < 3,
    "wall contact cannot create a speed-driven upward launch",
  );
  await wallControls.move(0, 0);
  await advance(page, 300);
  const held = await read(page);
  assert.notEqual(held.stance.parkour, "free");
  assert.ok(held.position[1] < 4);
  await wallControls.tap("jump");
  await advance(page, 180);
  const launch = await read(page);
  assert.equal(launch.stance.parkour, "free");
  assert.ok(
    launch.position[1] < 5,
    "explicit wall jump remains independently powered",
  );
  await wallControls.stop();
  await fresh(page, { practice: true });
  await open(page, "movement-abilities");
  await page.locator("#physics-reset").click();
  await page.locator("#physics-save").click();
  await close(page);
}
