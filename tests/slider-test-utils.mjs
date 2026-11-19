import assert from "node:assert/strict";

/** Native adjustment requires the player's explicit, individual unlock.
 * Programmatic value/input fixtures intentionally bypass touch interaction. */
export async function unlockSlider(page, id) {
  const slider = page.locator(`#${id}`);
  // Ranges may live in nested collapsible settings. Open their real UI first;
  // scrolling a descendant of a closed details element cannot reveal it.
  const closed = await slider.evaluate((node) => {
    const ids = [];
    for (let parent = node.parentElement; parent; parent = parent.parentElement)
      if (parent.tagName === "DETAILS" && !parent.open && parent.id) ids.unshift(parent.id);
    return ids;
  });
  for (const section of closed)
    await page.locator(`details[id="${section}"] > summary`).click();
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
