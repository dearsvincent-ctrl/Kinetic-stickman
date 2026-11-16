import assert from "node:assert/strict";

const advance = (page, ms = 60) => page.clock.runFor(ms);
const button = (page, id) => page.locator(`button[data-slider-lock="${id}"]`);
const values = (page) =>
  page
    .locator('#physics-panel input[type="range"]')
    .evaluateAll((inputs) =>
      Object.fromEntries(inputs.map((input) => [input.id, input.value])),
    );
const allLocked = (page) =>
  page
    .locator('#physics-panel input[type="range"]')
    .evaluateAll(
      (inputs) =>
        inputs.length > 0 &&
        inputs.every(
          (input) => input.disabled && input.dataset.sliderLocked === "true",
        ),
    );

/** Uses raw CDP for scrolling, where the browser correctly sends pointercancel
 * after claiming a pan. The general gameplay helper deliberately awaits a
 * pointermove acknowledgement, which would be wrong for that native pan. */
async function swipe(page, cdp, id, dx, dy) {
  const input = page.locator(`#${id}`);
  await input.scrollIntoViewIfNeeded();
  const b = await input.boundingBox(),
    start = { x: b.x + b.width * 0.35, y: b.y + b.height / 2 };
  const point = (x, y) => ({ id: 77, x, y, radiusX: 7, radiusY: 7, force: 1 });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [point(start.x, start.y)],
  });
  for (let n = 1; n <= 6; n++) {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [point(start.x + (dx * n) / 6, start.y + (dy * n) / 6)],
    });
    await advance(page, 20);
  }
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await advance(page, 100);
}

export async function checkSliderLocks(page, native) {
  const url = new URL("?sandbox=1", page.url());
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(url.href, { waitUntil: "networkidle" });
  await advance(page, 450);
  if (await page.locator("#physics-panel").evaluate((node) => node.hidden))
    await page.locator("#physics-toggle").click();
  await advance(page);
  assert.ok(await allLocked(page), "Every existing range starts locked");
  const cdp = await page.context().newCDPSession(page),
    target = page.locator("#physics-movement");
  const initial = await values(page);

  await swipe(page, cdp, "physics-movement", 65, 0);
  assert.deepEqual(
    await values(page),
    initial,
    "A locked horizontal drag changes no values",
  );
  await target.scrollIntoViewIfNeeded();
  const scroll = page.locator(".physics-scroll"),
    beforeLockedScroll = await scroll.evaluate((node) => node.scrollTop);
  await swipe(page, cdp, "physics-movement", 2, -100);
  assert.ok(
    (await scroll.evaluate((node) => node.scrollTop)) > beforeLockedScroll + 10,
    "A locked slider permits native vertical scrolling",
  );
  assert.deepEqual(await values(page), initial);

  await button(page, "physics-movement").click();
  assert.ok(await target.isEnabled());
  assert.ok(
    await page
      .locator('#physics-panel input[type="range"]:not(#physics-movement)')
      .evaluateAll((inputs) => inputs.every((input) => input.disabled)),
    "Unlock affects only its own slider",
  );
  await target.scrollIntoViewIfNeeded();
  const beforeUnlockedScroll = await scroll.evaluate((node) => node.scrollTop),
    beforeAdjustment = await target.inputValue();
  await swipe(page, cdp, "physics-movement", 1, -100);
  assert.ok(
    (await scroll.evaluate((node) => node.scrollTop)) >
      beforeUnlockedScroll + 10,
    "An unlocked slider still permits a predominantly vertical pan",
  );
  assert.equal(await target.inputValue(), beforeAdjustment);

  await swipe(page, cdp, "physics-movement", 65, 1);
  const adjusted = await target.inputValue();
  assert.notEqual(
    adjusted,
    beforeAdjustment,
    "Intentional horizontal movement adjusts an unlocked range",
  );
  await button(page, "physics-movement").click();
  assert.ok(await target.isDisabled());
  assert.equal(
    await target.inputValue(),
    adjusted,
    "Relocking never resets the value",
  );
  const changed = await values(page);
  for (const [id, value] of Object.entries(initial))
    if (id !== "physics-movement") assert.equal(changed[id], value);

  // Keyboard use remains available after intentionally unlocking a field.
  await button(page, "physics-movement").click();
  await target.press("ArrowLeft");
  assert.notEqual(await target.inputValue(), adjusted);
  const beforeReopen = await values(page);
  await page.locator("#physics-close").click();
  await page.locator("#physics-toggle").click();
  await advance(page);
  assert.ok(await allLocked(page));
  assert.deepEqual(
    await values(page),
    beforeReopen,
    "Closing/reopening only relocks; it preserves all values",
  );

  const section = page.locator("#enemy-settings");
  if (!(await section.evaluate((node) => node.open)))
    await page.locator("#enemy-settings > summary").click();
  await button(page, "enemy-speed").click();
  assert.ok(await page.locator("#enemy-speed").isEnabled());
  await page.locator("#enemy-settings > summary").click();
  await page.locator("#enemy-settings > summary").click();
  await advance(page);
  assert.ok(
    await page.locator("#enemy-speed").isDisabled(),
    "Reopening a nested settings section relocks its fields",
  );

  await page.evaluate(() => {
    const row = document.createElement("label");
    row.className = "physics-row";
    row.id = "future-slider-test-row";
    row.innerHTML =
      '<span>Future parameter</span><output>7</output><input id="future-slider-test" aria-label="Future parameter" type="range" min="0" max="10" value="7">';
    document.querySelector("#enemy-settings-controls").append(row);
  });
  await advance(page);
  assert.ok(
    await page.locator("#future-slider-test").isDisabled(),
    "Future sliders are registered and locked automatically",
  );
  await button(page, "future-slider-test").click();
  assert.equal(await page.locator("#future-slider-test").inputValue(), "7");
  assert.ok(await page.locator("#future-slider-test").isEnabled());
  await page.evaluate(() =>
    document
      .querySelector("#enemy-settings")
      .dispatchEvent(
        new CustomEvent("kinetic:relock-sliders", { bubbles: true }),
      ),
  );
  assert.ok(await page.locator("#future-slider-test").isDisabled());
  assert.equal(await page.locator("#future-slider-test").inputValue(), "7");
  await page.evaluate(() =>
    document.querySelector("#future-slider-test-row").remove(),
  );
  // Builders may add anonymous fields or discard temporary fields before a
  // MutationObserver delivery. Neither case may hang or reuse another ID.
  const anonymousId = await page.evaluate(async () => {
    const fields = document.querySelector("#enemy-settings-controls");
    const occupied = document.createElement("span");
    occupied.id = "developer-slider-1";
    occupied.dataset.sliderFixture = "collision";
    fields.append(occupied);
    const row = document.createElement("label");
    row.className = "physics-row";
    row.id = "anonymous-slider-test-row";
    row.innerHTML =
      '<span>Anonymous parameter</span><output>3</output><input aria-label="Anonymous parameter" type="range" min="0" max="10" value="3">';
    fields.append(row);
    for (let i = 0; i < 8; i++) {
      const transient = document.createElement("label");
      transient.className = "physics-row";
      transient.innerHTML = '<input type="range" value="4">';
      fields.append(transient);
      transient.remove();
    }
    // Let the actual observer run; a detached-node loop would never resolve.
    await new Promise((resolve) => queueMicrotask(resolve));
    return row.querySelector("input").id;
  });
  assert.match(anonymousId, /^developer-slider-\d+$/);
  assert.notEqual(
    anonymousId,
    "developer-slider-1",
    "Generated IDs avoid existing DOM IDs",
  );
  const anonymous = page.locator(`#${anonymousId}`);
  assert.ok(await anonymous.isDisabled());
  assert.equal(await anonymous.inputValue(), "3");
  await button(page, anonymousId).click();
  assert.ok(await anonymous.isEnabled());
  assert.equal(await anonymous.inputValue(), "3");
  await page.evaluate(() => {
    document.querySelector("#anonymous-slider-test-row").remove();
    document.querySelector('[data-slider-fixture="collision"]').remove();
  });
  await page.screenshot({
    path: "test-results/v085-slider-locks-portrait.png",
  });

  await page.locator("#physics-close").click();
  // Every raw CDP gesture ends above, so the next gameplay route starts
  // without a compositor-owned touch contact.
  await cdp.detach();
  console.log(
    "PASS: individual developer locks, safe locked/unlocked vertical scrolling, intentional horizontal adjustment, value preservation, keyboard access, reopen relocking and future slider registration",
  );
}
