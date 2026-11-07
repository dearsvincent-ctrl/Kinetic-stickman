import assert from "node:assert/strict";

// The same native touch/keyboard scenarios run against dev, the Pages build and
// the live site. Production observations use the rendered HUD, never game hooks.
export async function checkFluidCombat(page, native) {
  const advance = (ms) => page.clock.runFor(ms);
  const center = async (selector) => {
    const b = await page.locator(selector).boundingBox();
    return {
      x: Math.round(b.x + b.width / 2),
      y: Math.round(b.y + b.height / 2),
    };
  };
  const touch = (id, p) => ({ id, ...p, radiusX: 7, radiusY: 7, force: 1 });
  const rows = () => page.evaluate(() => window.__fluidCombatRows);
  const mark = async () => (await rows()).length;
  const read = () =>
    page.evaluate(() => window.__KINETIC__?.snapshot() ?? null);
  const fresh = async () => {
    await page.reload({ waitUntil: "networkidle" });
    await advance(500);
    await page.evaluate(() => {
      document.activeElement?.blur();
      window.__fluidCombatRows = [];
      const sample = () => {
        const state = window.__KINETIC__?.snapshot();
        const label = document.querySelector("#stance-label");
        const jump = document.querySelector("#jump-status").textContent;
        window.__fluidCombatRows.push({
          technique: state
            ? state.combat.attack.active
              ? state.combat.attack.techniqueId
              : "none"
            : label.dataset.technique,
          phase: state?.combat.attack.phase ?? label.dataset.phase,
          airborne: state?.jump.airborne ?? ["UP", "DOWN"].includes(jump),
          movement: document.querySelector("#movement-state").textContent,
          stance: label.textContent,
          speed:
            state?.speed ??
            Number(document.querySelector("#speed-value").textContent),
          dashActive: state?.dash.active,
          sequence: state?.combat.attack.sequence,
          targetId: state?.proximity.targetId,
          height: state?.jump.height,
          weight: state?.animation.aerialAttackWeight,
        });
        requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
  };
  const alignX = async (milliseconds = 800) => {
    await page.keyboard.down("d");
    await advance(milliseconds);
    await page.keyboard.up("d");
    await advance(350);
  };
  const approach = async (ms) => {
    await page.keyboard.down("w");
    await advance(ms);
    await page.keyboard.up("w");
    await advance(350);
  };
  const kickRows = (samples) =>
    samples.filter((row) => row.technique === "flying-kick");

  // Stationary auto punches vary, then a manual Block suppresses a native jump
  // kick until the finger slides away. No Sprint or Attack input is required.
  await page.evaluate(() => localStorage.removeItem("kinetic.controls.v1"));
  await fresh();
  await alignX();
  await approach(1800);
  await advance(1500);
  const groundTechniques = new Set((await rows()).map((row) => row.technique));
  assert.ok(
    groundTechniques.has("basic-punch") && groundTechniques.has("cross-punch"),
  );
  const block = await center("#block-button"),
    jump = await center("#jump-button");
  let fingers = [touch(501, block)];
  await native("touchStart", fingers);
  await advance(350);
  const blockedStart = await mark();
  fingers.push(touch(502, jump));
  await native("touchStart", fingers, [fingers[1]]);
  await advance(160);
  assert.equal(kickRows((await rows()).slice(blockedStart)).length, 0);
  assert.equal(
    await page.locator("#block-button").getAttribute("aria-pressed"),
    "true",
  );
  fingers[0] = touch(501, { x: 410, y: 230 });
  await native("touchMove", fingers, [fingers[0]]);
  await advance(120);
  const inAir = kickRows((await rows()).slice(blockedStart));
  assert.ok(
    inAir.length > 0,
    "Releasing Block automatically starts a valid airborne kick",
  );
  assert.ok(inAir.some((row) => row.airborne));
  await page.screenshot({ path: "test-results/v07-flying-kick.png" });
  const cancelling = await read();
  fingers[0] = touch(501, block);
  await native("touchMove", fingers, [fingers[0]]);
  await advance(100);
  const guarded = await read();
  if (guarded) {
    assert.equal(guarded.combat.blocking, true);
    assert.equal(
      guarded.combat.attack.sequence,
      cancelling.combat.attack.sequence,
    );
    assert.equal(guarded.combat.attack.cancelled, true);
  }
  await advance(800);
  assert.equal(await page.locator("#jump-status").textContent(), "READY");
  assert.equal(await page.locator("#stance-label").textContent(), "BLOCKING");
  const groundResume = await mark();
  fingers[0] = touch(501, { x: 410, y: 230 });
  await native("touchMove", fingers, [fingers[0]]);
  await advance(400);
  assert.ok(
    (await rows())
      .slice(groundResume)
      .some((row) => ["basic-punch", "cross-punch"].includes(row.technique)),
  );
  await native("touchCancel", [], []);

  // Save a different normalized layout, then use the real relocated controls
  // for Sprint -> ground Dash -> Jump -> air Dash -> automatic aerial attack.
  await page.evaluate(() => {
    const positions = Object.fromEntries(
      ["move", "sprint", "dash", "jump", "block"].map((id) => {
        const b = document
          .querySelector(id === "move" ? "#joystick" : `#${id}-button`)
          .getBoundingClientRect();
        return [
          id,
          {
            x: (b.x + b.width / 2) / innerWidth,
            y: (b.y + b.height / 2) / innerHeight - 0.035,
          },
        ];
      }),
    );
    localStorage.setItem(
      "kinetic.controls.v1",
      JSON.stringify({ version: 1, positions }),
    );
  });
  await fresh();
  await alignX();
  const saved = await page.evaluate(() =>
    localStorage.getItem("kinetic.controls.v1"),
  );
  const joy = await center("#joystick");
  const actions = Object.fromEntries(
    await Promise.all(
      ["sprint", "dash", "jump", "block"].map(async (id) => [
        id,
        await center(`#${id}-button`),
      ]),
    ),
  );
  fingers = [
    touch(511, joy),
    touch(512, { x: 440, y: 205 }),
    touch(513, actions.sprint),
  ];
  await native("touchStart", fingers);
  fingers[0] = touch(511, { x: joy.x, y: joy.y - 45 });
  await native("touchMove", fingers, [fingers[0]]);
  await advance(250);
  const owners = await read();
  const slide = async (id, ms) => {
    fingers[2] = touch(513, actions[id]);
    await native("touchMove", fingers, [fingers[2]]);
    await advance(ms);
  };
  const chainStart = await mark();
  await slide("dash", 100);
  await slide("jump", 100);
  await slide("dash", 100);
  const burst = await read();
  if (burst) {
    assert.equal(burst.dash.mode, "air");
    assert.equal(burst.dash.sequence, 2);
    assert.equal(burst.dash.airDashesRemaining, 0);
  }
  await advance(140);
  const chainKicks = kickRows((await rows()).slice(chainStart));
  assert.ok(
    chainKicks.length > 0,
    "The complete native movement chain reaches the dummy and kicks automatically",
  );
  await page.screenshot({ path: "test-results/v07-movement-chain.png" });
  fingers[0] = touch(511, { x: joy.x + 18, y: joy.y - 42 });
  fingers[1] = touch(512, { x: 460, y: 210 });
  await native("touchMove", fingers, fingers.slice(0, 2));
  await advance(120);
  const steering = await read();
  if (steering) {
    assert.ok(steering.input.move.x > 0);
    for (const owner of ["joystickPointer", "cameraPointer"])
      assert.equal(steering.input[owner], owners.input[owner]);
    assert.equal(steering.jump.airborne, true);
  }
  await slide("block", 100);
  await advance(700);
  assert.equal(await page.locator("#stance-label").textContent(), "BLOCKING");
  assert.equal(await page.locator("#jump-status").textContent(), "READY");
  await slide("sprint", 100);
  assert.equal(
    await page.locator("#block-button").getAttribute("aria-pressed"),
    "false",
  );
  assert.equal(
    await page.locator("#sprint-button").getAttribute("aria-pressed"),
    "true",
  );
  await native("touchCancel", [], []);
  await advance(300);
  assert.equal(
    await page.evaluate(() => localStorage.getItem("kinetic.controls.v1")),
    saved,
  );

  // Approach while still out of range, jump, and let an air dash finish before
  // ordinary exit momentum brings the stationary dummy into kicking reach.
  await page.evaluate(() => localStorage.removeItem("kinetic.controls.v1"));
  await fresh();
  await alignX();
  await approach(550);
  await page.keyboard.press("Space");
  await advance(120);
  await page.keyboard.press("e");
  await advance(250);
  const afterDash = await mark();
  await advance(150);
  const afterDashKicks = kickRows((await rows()).slice(afterDash));
  assert.ok(
    afterDashKicks.length > 0,
    "Automatic flying kick remains available after the air dash",
  );
  assert.ok(afterDashKicks.some((row) => row.movement !== "AIR DASH"));
  if (afterDashKicks[0].dashActive !== undefined)
    assert.equal(afterDashKicks[0].dashActive, false);
  await advance(700);

  // Sprint past the dummy: enter the forward striking cone during a jump,
  // leave range mid-kick, and continue moving without another queued attack.
  await fresh();
  await alignX(1040);
  await page.keyboard.down("Shift");
  await page.keyboard.down("w");
  await advance(600);
  const passStart = await mark();
  await page.keyboard.press("Space");
  await advance(700);
  const passing = kickRows((await rows()).slice(passStart));
  assert.ok(passing.length > 0, "Moving airborne entry triggers the technique");
  assert.ok(
    passing.some((row) => row.speed > 4),
    "Attacking never freezes sprint momentum",
  );
  await advance(1000);
  await page.keyboard.up("w");
  await page.keyboard.up("Shift");
  await advance(500);
  const outside = await mark();
  await advance(700);
  assert.equal(
    await page.locator("#stance-label").textContent(),
    "FREE MOVEMENT",
  );
  assert.equal(
    kickRows((await rows()).slice(outside)).length,
    0,
    "Leaving range or passing behind cannot queue another aerial attack",
  );
  assert.equal(await page.locator("#attack-button").count(), 0);
  console.log(
    "PASS: 3D auto combat, both ground punches, native jump kick and Block, full Sprint/Dash/Jump/Air Dash/attack chain, post-dash kick, air steering, range exit, landing and saved layouts",
  );
}
