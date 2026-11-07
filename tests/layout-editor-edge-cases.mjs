import assert from "node:assert/strict";

// Shared native-browser regressions for the editor's viewport/utility edges.
// They use the visible controls and browser storage, never game-state writes.
export async function checkLayoutEditorEdges(page, advance) {
  const ids = ["move", "block", "jump", "punch", "kick"];
  const rects = () =>
    page.evaluate(() =>
      Object.fromEntries(
        [...document.querySelectorAll("[data-layout-control]")].map(
          (element) => {
            const { x, y, width, height } = element.getBoundingClientRect();
            return [element.dataset.layoutControl, { x, y, width, height }];
          },
        ),
      ),
    );
  const click = async (selector) => {
    const box = await page.locator(selector).boundingBox();
    assert.ok(box, `${selector} is available`);
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await advance(34);
  };
  const open = async () => {
    await click("#settings-button");
    await click("#edit-controls-button");
    assert.equal(
      await page.locator("#control-editor-toolbar").isVisible(),
      true,
    );
  };
  const drag = async (id, destination) => {
    const box = (await rects())[id];
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(destination.x, destination.y, { steps: 4 });
    await page.mouse.up();
    await advance(34);
  };

  for (const viewport of [
    { width: 640, height: 320 },
    { width: 568, height: 320 },
    { width: 320, height: 568 },
  ]) {
    await page.setViewportSize(viewport);
    await advance(100);
    const defaults = await rects();
    await open();
    const toolbar = await page.locator("#control-editor-toolbar").boundingBox();
    await page.locator("#layout-status").evaluate((element) => {
      element.textContent =
        "A long browser storage error should never expand the toolbar over a control. ".repeat(
          4,
        );
    });
    const expanded = await page
      .locator("#control-editor-toolbar")
      .boundingBox();
    assert.ok(
      Math.abs(expanded.height - toolbar.height) < 0.5,
      "Status messages preserve toolbar height",
    );
    const preview = await rects();
    for (const id of ids) {
      const box = preview[id];
      assert.ok(
        box.x >= 0 &&
          box.y >= 0 &&
          box.x + box.width <= viewport.width + 0.5 &&
          box.y + box.height <= viewport.height + 0.5,
        `${id} fits the short-screen editor`,
      );
      const overlaps =
        box.x < expanded.x + expanded.width &&
        box.x + box.width > expanded.x &&
        box.y < expanded.y + expanded.height &&
        box.y + box.height > expanded.y;
      assert.equal(overlaps, false, `${id} stays outside the editor toolbar`);
      assert.equal(
        await page.evaluate(
          ({ x, y }) =>
            document.elementFromPoint(x, y)?.closest("[data-layout-control]")
              ?.dataset.layoutControl,
          { x: box.x + box.width / 2, y: box.y + box.height / 2 },
        ),
        id,
        `${id} remains directly hittable`,
      );
    }
    await click("#layout-cancel");
    const restored = await rects();
    for (const id of ids)
      for (const axis of ["x", "y", "width", "height"])
        assert.ok(
          Math.abs(restored[id][axis] - defaults[id][axis]) < 0.5,
          "Cancel restores exact CSS defaults outside the editor",
        );
  }

  await page.setViewportSize({ width: 844, height: 390 });
  await advance(100);
  const vacatedJump = (await rects()).jump;
  await open();
  await drag("jump", { x: 478, y: 219 });
  await click("#layout-save");
  const saved = await page.evaluate(() =>
    localStorage.getItem("kinetic.controls.v1"),
  );

  const cameraPoint = {
    x: vacatedJump.x + vacatedJump.width / 2,
    y: vacatedJump.y + vacatedJump.height / 2,
  };
  assert.equal(
    await page.evaluate(
      ({ x, y }) => document.elementFromPoint(x, y)?.id,
      cameraPoint,
    ),
    "camera-surface",
    "The old action container cannot swallow camera starts",
  );
  await page.mouse.move(cameraPoint.x, cameraPoint.y);
  await page.mouse.down();
  assert.equal(
    await page
      .locator("#camera-surface")
      .evaluate((element) => element.classList.contains("is-active")),
    true,
    "Camera dragging starts in the vacated action area",
  );
  await page.mouse.move(cameraPoint.x - 30, cameraPoint.y);
  await page.mouse.up();
  await advance(100);

  await open();
  await drag("jump", { x: 566, y: 288 });
  await page.evaluate(() => {
    window.__layoutOriginalSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === "kinetic.controls.v1")
        throw new DOMException("Storage unavailable", "QuotaExceededError");
      return window.__layoutOriginalSetItem.call(this, key, value);
    };
  });
  try {
    await click("#layout-save");
    assert.equal(
      await page.locator("#control-editor-toolbar").isVisible(),
      true,
    );
    assert.match(
      await page.locator("#layout-status").textContent(),
      /cannot save/i,
    );
    assert.equal(
      await page.evaluate(() => localStorage.getItem("kinetic.controls.v1")),
      saved,
      "Failed Save preserves the last stored layout",
    );
    await click("#layout-cancel");
  } finally {
    await page.evaluate(() => {
      Storage.prototype.setItem = window.__layoutOriginalSetItem;
      delete window.__layoutOriginalSetItem;
    });
  }
  // An orientation reflow can separate originally coincident anchors. Editing
  // one control must save the visible arrangement rather than reshuffle others.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(
    (ids) =>
      localStorage.setItem(
        "kinetic.controls.v1",
        JSON.stringify({
          version: 1,
          positions: Object.fromEntries(
            ids.map((id) => [id, { x: 0.8, y: 0.7 }]),
          ),
        }),
      ),
    ids,
  );
  await page.reload({ waitUntil: "networkidle" });
  await advance(500);
  await open();
  const projected = await rects();
  await drag("punch", {
    x: 99,
    y: projected.punch.y + projected.punch.height / 2,
  });
  const preview = await rects();
  await click("#layout-save");
  const committed = await rects();
  for (const id of ids)
    for (const axis of ["x", "y", "width", "height"])
      assert.ok(
        Math.abs(committed[id][axis] - preview[id][axis]) < 0.5,
        `${id} keeps its preview position after Save`,
      );
  await open();
  await click("#layout-reset");
  await click("#layout-save");
  assert.equal(
    await page.evaluate(() => localStorage.getItem("kinetic.controls.v1")),
    null,
  );
  await page.setViewportSize({ width: 844, height: 390 });
  await advance(100);
  await click("#reset-camera");
  await advance(500);
  console.log(
    "PASS: short-screen editor reachability, stable status messages, vacated camera hit area and failed-Save recovery",
  );
}
