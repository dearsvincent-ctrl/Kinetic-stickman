import assert from "node:assert/strict";
const advance = (p, ms) => p.clock.runFor(ms);
const snap = (p) => p.evaluate(() => window.__KINETIC__?.snapshot() ?? null);
const touch = (id, p) => ({ id, ...p, radiusX: 7, radiusY: 7, force: 1 });
const point = async (p, s) => {
  const b = await p.locator(s).boundingBox();
  assert.ok(b, s);
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
};
const read = (p) =>
  p.locator("#stance-label").evaluate((e) => ({ ...e.dataset }));
const fresh = async (p) => {
  await p.reload({ waitUntil: "networkidle" });
  await advance(p, 450);
  await p.evaluate(() => document.activeElement?.blur());
};
async function stick(p, native) {
  const centre = await point(p, "#joystick"),
    b = await p.locator("#joystick").boundingBox(),
    r = Math.min(b.width, b.height) * 0.34;
  let fingers = [];
  const move = async (x, y) => {
    const f = touch(1, { x: centre.x + x * r, y: centre.y - y * r });
    if (!fingers.length) {
      fingers = [f];
      await native("touchStart", fingers);
    } else {
      fingers[0] = f;
      await native("touchMove", fingers, [f]);
    }
  };
  const enter = async (id) => {
    const f = touch(2, await point(p, `#${id}-button`));
    const old = fingers.findIndex((f) => f.id === 2);
    if (old < 0) {
      fingers.push(f);
      await native("touchStart", fingers, [f]);
    } else {
      fingers[old] = f;
      await native("touchMove", fingers, [f]);
    }
  };
  const releaseAction = async () => {
    const f = fingers.find((f) => f.id === 2);
    if (f) {
      fingers = fingers.filter((f) => f.id !== 2);
      await native("touchEnd", [f], [f]);
    }
  };
  return {
    move,
    enter,
    releaseAction,
    tap: async (id) => {
      await enter(id);
      await releaseAction();
    },
    stop: async () => {
      if (fingers.length) await native("touchCancel", [], fingers);
      fingers = [];
    },
  };
}
async function groundGesture(p, native, x, y) {
  const s = await stick(p, native);
  await s.move(0, 1);
  await advance(p, 430);
  await s.move(0, 0);
  await advance(p, 17);
  await s.move(x, y);
  await advance(p, 100);
  return s;
}
export async function checkAcrobatics(page, native) {
  await page.evaluate(() => {
    localStorage.removeItem("kinetic.physics-sandbox.v1");
    localStorage.removeItem("kinetic.controls.v1");
  });
  await fresh(page);
  // Ground intent expresses braking only: no gesture technique or attack request.
  for (const [x, y, kind, action] of [
    [0, -1, "back", "punch"],
    [-Math.SQRT1_2, -Math.SQRT1_2, "diagonal", "kick"],
    [Math.SQRT1_2, -Math.SQRT1_2, "diagonal", "punch"],
    [1, 0, "lateral", "kick"],
  ]) {
    await fresh(page);
    const camera = (await snap(page))?.camera,
      s = await groundGesture(page, native, x, y);
    let a = await read(page);
    assert.equal(a.acroSequence, "0");
    assert.equal(a.sequence, "0");
    assert.equal(a.technique, "none");
    assert.equal(a.recoverySequence, "1", JSON.stringify(a));
    assert.equal(a.recoveryKind, kind);
    assert.ok(Number(a.recoveryIntensity) > 0.2);
    assert.equal(
      await page.locator("#contact-status").getAttribute("data-count"),
      "0",
    );
    const recovery = (await snap(page))?.recovery;
    if (recovery)
      assert.ok(
        recovery.streaks > 0,
        "Forceful plant emits a bounded streak burst",
      );
    if (x === 0)
      await page.screenshot({ path: "test-results/v078-hard-reversal.png" });
    await s.enter(action);
    await advance(page, 100);
    a = await read(page);
    assert.equal(a.action, action);
    assert.equal(a.sequence, "1");
    const state = await snap(page);
    if (state) {
      assert.equal(state.camera.yaw, camera.yaw);
      assert.equal(state.camera.pitch, camera.pitch);
      assert.ok(state.speed > 1);
    }
    await s.releaseAction();
    await s.stop();
    await advance(page, 850);
    assert.equal((await read(page)).acroPhase, "idle");
  }
  console.log(
    "PASS: broad back/diagonal/lateral recovery without auto attacks, responsive manual strikes during recovery, stable camera and foot streaks",
  );
  // Moderate reversals recover without striking; curved turns stay ordinary.
  await fresh(page);
  let s = await stick(page, native);
  await s.move(0, 0.55);
  await advance(page, 450);
  await s.move(0, -0.55);
  await advance(page, 250);
  assert.equal((await read(page)).acroSequence, "0");
  assert.equal((await read(page)).sequence, "0");
  assert.equal((await read(page)).recoveryKind, "back");
  await s.stop();
  await fresh(page);
  s = await stick(page, native);
  await s.move(0, 1);
  await advance(page, 350);
  for (let n = 1; n <= 12; n++) {
    const a = (n * Math.PI) / 12;
    await s.move(Math.sin(a), Math.cos(a));
    await advance(page, 40);
  }
  assert.equal((await read(page)).acroSequence, "0");
  await s.stop();
  await fresh(page);
  s = await stick(page, native);
  await s.move(0, 0);
  await s.tap("jump");
  await advance(page, 120);
  await s.move(0, -1);
  await advance(page, 140);
  assert.equal((await read(page)).acroSequence, "0");
  await s.stop();
  await advance(page, 800);
  console.log(
    "PASS: moderate reversal recovery, gentle curved steering and ordinary backward air control never trigger attacks",
  );
  await checkDirectionalDoubleJump(page, native);
  // Directional second-Jump activation reuses the existing rotational presenter.
  async function flip() {
    await fresh(page);
    const s = await stick(page, native);
    await s.move(0, 0);
    await s.tap("jump");
    await advance(page, 115);
    await s.move(0, -1);
    await s.tap("jump");
    await advance(page, 100);
    assert.equal((await read(page)).acroKind, "backflip");
    return s;
  }
  s = await flip();
  const before = await snap(page);
  await s.tap("kick");
  await advance(page, 85);
  let a = await read(page);
  assert.equal(a.technique, "flying-kick");
  const during = await snap(page);
  if (before && during) {
    assert.notEqual(during.position[1], before.position[1]);
    assert.equal(during.camera.yaw, before.camera.yaw);
    assert.ok(during.acrobatics.pitchTravel > before.acrobatics.pitchTravel);
  }
  await page.screenshot({ path: "test-results/v078-backflip-kick.png" });
  await s.enter("block");
  await advance(page, 100);
  a = await read(page);
  assert.equal(a.cancelled, "true");
  assert.equal(
    await page.locator("#block-button").getAttribute("aria-pressed"),
    "true",
  );
  await s.releaseAction();
  await s.stop();
  await advance(page, 1800);
  a = await read(page);
  assert.equal(a.acroPhase, "idle");
  assert.equal(await page.locator("#jump-status").textContent(), "READY");
  console.log(
    "PASS: directional double Jump, Kick during continuing rotation/gravity, Block priority and upright landing recovery",
  );
  // Longer physical jump makes inverted easing and steering easy to inspect;
  // sandbox controls remain the only write path.
  let results = [];
  for (const direction of [-1, 0, 1]) {
    await page.goto(
      new URL("?sandbox=1" + ((await snap(page)) ? "&debug" : ""), page.url())
        .href,
      { waitUntil: "networkidle" },
    );
    await advance(page, 450);
    await page.locator("#physics-toggle").click();
    await page.evaluate(() => {
      const e = document.querySelector("#physics-jumpHeight");
      e.value = Math.log10(4);
      e.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await page.locator("#physics-close").click();
    await advance(page, 34);
    await page.evaluate(() => document.activeElement?.blur());
    s = await stick(page, native);
    await s.move(0, 0);
    await s.tap("jump");
    await advance(page, 115);
    await s.move(0, -1);
    await s.tap("jump");
    await advance(page, 120); // Wait for the throttled HUD, not for jump eligibility.
    assert.equal((await read(page)).acroKind, "backflip");
    await s.move(0, direction);
    let inverted = false,
      minUp = 1;
    // Sample pressure over 0.5 s, before landing. The HUD refreshes every
    // 80 ms; a shorter final-value comparison can straddle different samples.
    for (let n = 0; n < 10; n++) {
      await advance(page, 50);
      a = await read(page);
      minUp = Math.min(minUp, Number(a.bodyUp));
      if (direction === 0 && !inverted && Number(a.invertedWeight) > 0.4)
        await page.screenshot({ path: "test-results/v078-air-rotation.png" });
      inverted ||= Number(a.invertedWeight) > 0.4;
      assert.ok(Number.isFinite(Number(a.angularPitch)));
    }
    results.push(Number(a.angularPitch));
    if (direction === 0) {
      assert.ok(
        inverted && minUp < -0.7,
        "Neutral rotation travels through a responsive inverted phase",
      );
    }
    await s.stop();
    await advance(page, 2300);
    assert.equal((await read(page)).acroPhase, "idle");
  }
  assert.ok(
    results[0] > results[1] + 3 && results[1] > results[2] + 1.5,
    `Back / neutral / forward rates: ${results}`,
  );
  console.log(
    "PASS: backwards pressure accelerates, forward pressure brakes, neutral inverted easing continues, configurable jump remains physical",
  );
  // Reverse before a 100x fighter can reach the first arena wall.
  await page.goto(
    new URL("?sandbox=1" + ((await snap(page)) ? "&debug" : ""), page.url())
      .href,
    { waitUntil: "networkidle" },
  );
  await advance(page, 450);
  await page.locator("#physics-toggle").click();
  await page.evaluate(() => {
    const e = document.querySelector("#physics-movement");
    e.value = Math.log10(100);
    e.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.locator("#physics-close").click();
  await advance(page, 34);
  await page.evaluate(() => document.activeElement?.blur());
  s = await stick(page, native);
  await s.move(0, 1);
  await advance(page, 40);
  await s.move(0.7, -0.7);
  await advance(page, 100);
  a = await read(page);
  assert.equal(a.sequence, "0");
  assert.ok(Number(a.recoverySequence) > 0);
  assert.ok(Number(a.recoveryIntensity) > 0.65);
  const extreme = await snap(page);
  if (extreme) {
    assert.ok(extreme.position.every(Number.isFinite));
    assert.ok(Math.abs(extreme.position[0]) <= extreme.halfSize);
    assert.ok(Math.abs(extreme.position[2]) <= extreme.halfSize);
    assert.ok(extreme.renderer.calls < 80);
    assert.ok(extreme.recovery.streaks > 0);
  }
  await page.screenshot({ path: "test-results/v078-extreme-recovery.png" });
  await s.enter("kick");
  await advance(page, 100);
  assert.equal((await read(page)).action, "kick");
  await s.stop();
  console.log(
    "PASS: 100x reversal recovery, bounded foot effects/arena positions and manual Kick without automatic attacks",
  );
  // Contextual limbs, held attack rates, sliding and moved controls are also
  // covered by the unchanged full manual gameplay/layout regression suite.
  await page.goto(
    new URL("?" + ((await snap(page)) ? "debug" : ""), page.url()).href,
    { waitUntil: "networkidle" },
  );
  await advance(page, 450);
  s = await stick(page, native);
  await s.move(0, 0);
  for (const id of ["punch", "kick"]) {
    let sides = new Set();
    await s.enter(id);
    for (let n = 0; n < 22; n++) {
      await advance(page, 80);
      const a = await read(page);
      if (a.action === id) sides.add(a.side);
    }
    assert.equal(sides.size, 2, `${id} contextual left/right selection`);
    await s.releaseAction();
    await advance(page, 650);
  }
  await s.stop();
  console.log(
    "PASS: native held Punch and Kick use both sides at the configured rate without stacking",
  );
  await checkPartialAnalogueRecovery(page, native);
}

export async function checkPartialAnalogueRecovery(page, native) {
  for (const extreme of [false, true]) {
    await page.goto(new URL(extreme ? "?sandbox=1" : "?", page.url()).href, {
      waitUntil: "networkidle",
    });
    await advance(page, 450);
    if (extreme) {
      await page.locator("#physics-toggle").click();
      await page.evaluate(() => {
        const e = document.querySelector("#physics-movement");
        e.value = 2;
        e.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await page.locator("#physics-close").click();
      await advance(page, 34);
      await page.evaluate(() => document.activeElement?.blur());
    }
    const s = await stick(page, native);
    await s.move(0, 0.28);
    await advance(page, 150);
    await s.move(0, -0.28);
    await advance(page, 100);
    const a = await read(page);
    assert.equal(a.sequence, "0");
    assert.equal(a.acroSequence, "0");
    assert.equal(
      Number(a.recoverySequence),
      extreme ? 1 : 0,
      JSON.stringify(a),
    );
    await page.screenshot({
      path: `test-results/v078-partial-${extreme ? "100x" : "normal"}.png`,
    });
    await s.stop();
  }
  console.log(
    "PASS: partial analogue reversals remain gentle normally and recover from actual braking at 100x without attacking",
  );
}

export async function checkDirectionalDoubleJump(page, native) {
  const cases = [
    [[0, 0], [0, 1], "frontflip"],
    [[0, 0], [0, -1], "backflip"],
    [[0, 0], [0, 0], null],
    [[0, 0], [0.707, 0.707], "frontflip"],
    [[0, 0], [-0.707, -0.707], "backflip"],
    [[1, 0], [1, 0], "frontflip"],
    [[1, 0], [-1, 0], "backflip"],
  ];
  for (const [takeoff, second, kind] of cases) {
    await fresh(page);
    const s = await stick(page, native);
    await s.move(...takeoff);
    await s.tap("jump");
    await advance(page, 150);
    assert.equal(
      await page.locator("#jump-button").getAttribute("data-jump-count"),
      "1",
    );
    assert.equal(
      await page.locator("#jump-button").getAttribute("aria-disabled"),
      "false",
    );
    const launch = Number(
      await page.locator("#jump-button").getAttribute("data-jump-launch"),
    );
    assert.ok(Math.abs(launch - Math.sqrt(2 * 18 * 1.2)) < 1e-8);
    await s.move(...second);
    await s.tap("jump");
    await advance(page, 100);
    const a = await read(page);
    assert.equal(a.acroKind, kind ?? "none");
    assert.equal(
      await page.locator("#jump-button").getAttribute("data-jump-count"),
      "2",
    );
    assert.equal(
      await page.locator("#jump-button").getAttribute("data-jump-sequence"),
      "2",
    );
    assert.equal(
      Number(
        await page.locator("#jump-button").getAttribute("data-jump-launch"),
      ),
      launch,
    );
    await s.tap("jump");
    await advance(page, 100);
    assert.equal(
      await page.locator("#jump-button").getAttribute("data-jump-sequence"),
      "2",
    );
    const state = await snap(page);
    if (state) {
      assert.notEqual(state.input.joystickPointer, null);
      assert.equal(state.jump.count, 2);
      assert.ok(state.position[1] > 0);
    }
    if (kind)
      await page.screenshot({
        path: `test-results/v078-${kind}-${takeoff[0]}.png`,
      });
    await s.stop();
    if (!kind) {
      await advance(page, 1800);
      assert.equal(
        await page.locator("#jump-button").getAttribute("data-jump-count"),
        "0",
      );
      assert.equal(
        await page.locator("#jump-button").getAttribute("data-jump-sequence"),
        "2",
      );
      await s.tap("jump");
      await advance(page, 150);
      assert.equal(
        await page.locator("#jump-button").getAttribute("data-jump-sequence"),
        "3",
      );
      await s.stop();
    }
  }
  // A forward/back flick during the first jump is normal steering, never a flip.
  await fresh(page);
  let s = await stick(page, native);
  await s.move(0, 0);
  await s.tap("jump");
  await advance(page, 115);
  await s.move(0, 1);
  await advance(page, 85);
  await s.move(0, 0);
  await advance(page, 17);
  await s.move(0, -1);
  await advance(page, 100);
  assert.equal((await read(page)).acroSequence, "0");
  assert.equal(
    await page.locator("#jump-button").getAttribute("data-jump-count"),
    "1",
  );
  await s.stop();
  console.log(
    "PASS: native directional double jumps, equal launches, diagonals/take-off-relative directions, neutral bounce, third rejection and no flick activation",
  );
  const normal = new URL(page.url());
  for (const extreme of [false, true]) {
    await page.goto(
      new URL("?sandbox=1" + ((await snap(page)) ? "&debug" : ""), page.url())
        .href,
      { waitUntil: "networkidle" },
    );
    await advance(page, 450);
    await page.locator("#physics-toggle").click();
    await page.evaluate((extreme) => {
      for (const [key, n] of Object.entries({
        jumpHeight: extreme ? 100 : 1,
        gravity: extreme ? 100 : 1,
      })) {
        const e = document.querySelector(`#physics-${key}`);
        e.value = Math.log10(n);
        e.dispatchEvent(new Event("input", { bubbles: true }));
      }
    }, extreme);
    await page.locator("#physics-close").click();
    await advance(page, 34);
    await page.evaluate(() => document.activeElement?.blur());
    const s = await stick(page, native);
    await s.move(0, 0);
    await s.tap("jump");
    await advance(page, 150);
    const first = Number(
      await page.locator("#jump-button").getAttribute("data-jump-launch"),
    );
    assert.ok(
      Math.abs(first - Math.sqrt(2 * 18 * 1.2 * (extreme ? 10000 : 1))) < 1e-8,
    );
    await page.locator("#physics-toggle").click();
    await page.evaluate((extreme) => {
      const e = document.querySelector("#physics-jumpHeight");
      e.value = Math.log10(extreme ? 100 : 2);
      e.dispatchEvent(new Event("input", { bubbles: true }));
    }, extreme);
    await page.locator("#physics-close").click();
    await advance(page, 34);
    await page.evaluate(() => document.activeElement?.blur());
    await s.tap("jump");
    await advance(page, 100);
    assert.equal(
      await page.locator("#jump-button").getAttribute("data-jump-count"),
      "2",
    );
    const second = Number(
      await page.locator("#jump-button").getAttribute("data-jump-launch"),
    );
    const appliedHeight =
        10 ** Number(await page.locator("#physics-jumpHeight").inputValue()),
      appliedGravity =
        10 ** Number(await page.locator("#physics-gravity").inputValue());
    assert.ok(
      Math.abs(
        second - Math.sqrt(2 * 18 * 1.2 * appliedHeight * appliedGravity),
      ) < 1e-8,
    );
    await s.stop();
    await advance(page, 2200);
    assert.equal(
      await page.locator("#jump-button").getAttribute("data-jump-count"),
      "0",
    );
  }
  await page.goto(normal.href, { waitUntil: "networkidle" });
  await advance(page, 450);
  console.log(
    "PASS: mid-flight sandbox changes affect the second launch; both jumps remain stable at 100x height/gravity",
  );
}
