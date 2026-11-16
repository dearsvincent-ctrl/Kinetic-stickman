import assert from "node:assert/strict";

/** Native adjustment requires the player's explicit, individual unlock.
 * Programmatic value/input fixtures intentionally bypass touch interaction. */
export async function unlockSlider(page, id) {
  const slider = page.locator(`#${id}`);
  await slider.scrollIntoViewIfNeeded();
  if (await slider.isDisabled())
    await page.locator(`[data-slider-lock="${id}"]`).click();
  assert.equal(
    await slider.isDisabled(),
    false,
    `${id} is individually unlocked`,
  );
  return slider;
}
