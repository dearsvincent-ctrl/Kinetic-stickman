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
async function groundGesture(p, native, x) {
  const s = await stick(p, native);
  await s.move(0, 1);
  await advance(p, 430);
  await s.move(0, 0);
  await advance(p, 17);
  await s.move(x, x === 0 ? -1 : -Math.SQRT1_2);
  await advance(p, 70);
  return s;
}
export async function checkAcrobatics(page, native) {
  await page.evaluate(() => {
    localStorage.removeItem("kinetic.physics-sandbox.v1");
    localStorage.removeItem("kinetic.controls.v1");
  });
  await fresh(page);
  // Two distinct diagonal reversals and a straight-back descending sweep.
  for (const x of [-Math.SQRT1_2, Math.SQRT1_2, 0]) {
    await fresh(page);
    const camera = (await snap(page))?.camera,
      s = await groundGesture(page, native, x);
    let a = await read(page);
    assert.equal(a.acroSequence, "1", `Ground reversal x=${x}: ${JSON.stringify(a)}; joystick=${JSON.stringify(await page.evaluate(() => ({ width: document.querySelector("#joystick")?.getBoundingClientRect().width, height: document.querySelector("#joystick")?.getBoundingClientRect().height, knob: document.querySelector("#joystick-knob")?.style.transform })))}`);
    assert.equal(a.acroKind, x === 0 ? "descending-sweep" : "whip-kick");
    assert.equal(a.technique, a.acroKind);
    if (x < 0) {
      await advance(page, 80);
      await s.enter("punch");
      await advance(page, 100);
      a = await read(page);
      assert.equal(a.technique, "rotational-backhand");
      const state = await snap(page);
      if (state) {
        assert.equal(state.acrobatics.transition.action, "kick");
        assert.ok(Math.abs(state.acrobatics.angularVelocity[1]) > 2);
        assert.equal(state.camera.yaw, camera.yaw);
        assert.equal(state.camera.pitch, camera.pitch);
      }
      await page.screenshot({ path: "test-results/v076-kick-to-backhand.png" });
      await s.releaseAction();
    }
    await s.stop();
    await advance(page, 1500);
    a = await read(page);
    assert.equal(a.acroPhase, "idle");
  }
  console.log(
    "PASS: native diagonal whip kicks, descending reversal sweep, active kick→backhand continuation and stable camera",
  );
  // Casual reversals, round-the-rim turning and ordinary air steering stay ordinary.
  await fresh(page);
  let s = await stick(page, native);
  await s.move(0, 0.55);
  await advance(page, 450);
  await s.move(0, -0.55);
  await advance(page, 250);
  assert.equal((await read(page)).acroSequence, "0");
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
    "PASS: ordinary walk/run reversals, curved steering and backward air steering do not trigger gestures",
  );
  // Prime a deliberate forward→back flick after launch. Never requires a target.
  async function flip() {
    await fresh(page);
    const s = await stick(page, native);
    await s.move(0, 0);
    await s.tap("jump");
    await advance(page, 115);
    await s.move(0, 1);
    await advance(page, 85);
    await s.move(0, 0);
    await advance(page, 17);
    await s.move(0, -1);
    await advance(page, 50);
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
  await page.screenshot({ path: "test-results/v076-backflip-kick.png" });
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
    "PASS: early airborne flick, Kick during continuing rotation/gravity, Block priority and upright landing recovery",
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
    await s.move(0, 1);
    await advance(page, 85);
    await s.move(0, 0);
    await advance(page, 17);
    await s.move(0, -1);
    await advance(page, 35);
    assert.equal((await read(page)).acroKind, "backflip");
    await s.move(0, direction);
    let inverted = false,
      minUp = 1;
    for (let n = 0; n < 6; n++) {
      await advance(page, 50);
      a = await read(page);
      minUp = Math.min(minUp, Number(a.bodyUp));
      if (direction === 0 && !inverted && Number(a.invertedWeight) > 0.4)
        await page.screenshot({ path: "test-results/v076-air-rotation.png" });
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
    results[0] > results[1] + 3 && results[1] > results[2] + 3,
    `Back / neutral / forward rates: ${results}`,
  );
  console.log(
    "PASS: backwards pressure accelerates, forward pressure brakes, neutral inverted easing continues, configurable jump remains physical",
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
}
