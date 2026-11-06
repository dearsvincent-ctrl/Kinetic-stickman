import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";
import { chromium } from "playwright";
import { resolvePagesBase } from "../build/pagesBase.js";
import { checkLayoutEditorEdges } from "./layout-editor-edge-cases.mjs";
import { checkAerialDashes } from "./aerial-dash-browser.mjs";

// Exercise the production bundle with Pages-style routing. Serving ONLY under
// the expected prefix makes root-relative asset mistakes fail with real 404s.
const dist = resolve("dist");
const html = await readFile(resolve(dist, "index.html"), "utf8");
const builtScript = html.match(/<script\b[^>]*\bsrc=["']([^"']+)["']/i)?.[1];
assert.ok(builtScript, "Build dist/ before running the Pages smoke check");
const inferredBase = builtScript.startsWith("/")
  ? builtScript.slice(0, builtScript.lastIndexOf("/assets/") + 1) || "/"
  : "/";
const configuredBase = process.env.GITHUB_REPOSITORY
  ? resolvePagesBase({
      GITHUB_PAGES: "true",
      GITHUB_REPOSITORY: process.env.GITHUB_REPOSITORY,
    })
  : inferredBase;
const base = process.env.PAGES_TEST_BASE || configuredBase;
assert.match(
  base,
  /^\/(?:[^?#]*\/)?$/,
  "PAGES_TEST_BASE must start and end with /",
);

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
};
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(
      new URL(request.url, "http://localhost").pathname,
    );
    if (!pathname.startsWith(base)) {
      response.writeHead(404).end("Outside Pages mount");
      return;
    }
    const path = resolve(dist, pathname.slice(base.length) || "index.html");
    if (path !== dist && !path.startsWith(`${dist}${sep}`)) {
      response.writeHead(403).end("Forbidden");
      return;
    }
    const content = await readFile(path);
    response.writeHead(200, {
      "Content-Type": mimeTypes[extname(path)] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    response.end(content);
  } catch (error) {
    response.writeHead(error.code === "ENOENT" ? 404 : 500).end("Not found");
  }
});

let browser;
try {
  await new Promise((resolveListening, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListening);
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({
    executablePath:
      process.env.CHROMIUM_PATH ||
      (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined),
    headless: true,
    args: ["--no-sandbox", "--enable-unsafe-swiftshader"],
  });
  const page = await browser.newPage({
    viewport: { width: 844, height: 390 },
    deviceScaleFactor: 1,
    isMobile: true,
    hasTouch: true,
  });
  const errors = [];
  const requests = [];
  const responses = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("request", (request) => requests.push(request.url()));
  page.on("requestfailed", (request) =>
    errors.push(`${request.url()}: ${request.failure()?.errorText}`),
  );
  page.on("response", (response) => {
    responses.push(response.url());
    if (response.status() >= 400)
      errors.push(`${response.status()} ${response.url()}`);
  });

  await page.addInitScript(() => {
    window.__layoutNativeEvent = { sequence: 0, latest: null };
    for (const type of [
      "pointerdown",
      "pointermove",
      "pointerup",
      "pointercancel",
    ])
      window.addEventListener(
        type,
        (event) => {
          window.__layoutNativeEvent.sequence++;
          window.__layoutNativeEvent.latest = {
            type,
            pointerType: event.pointerType,
            x: event.clientX,
            y: event.clientY,
          };
        },
        true,
      );
  });
  await page.clock.install();
  await page.goto(`${origin}${base}`, { waitUntil: "networkidle" });
  await page.waitForSelector("#loading", { state: "detached" });
  assert.equal(await page.locator("#error").isVisible(), false);
  assert.equal(await page.locator("#viewport canvas").count(), 1);
  await page.evaluate(async () => {
    await document.fonts.ready;
    const icon = document.querySelector('link[rel="icon"]');
    const response = await fetch(icon.href);
    if (!response.ok) throw new Error(`Favicon failed: ${response.status}`);
  });
  assert.ok(
    await page.evaluate(() => document.fonts.check('500 20px "DM Sans"')),
    "Bundled UI font loads",
  );
  assert.equal(
    await page.evaluate(() => typeof window.__KINETIC__),
    "undefined",
    "Production build excludes development telemetry",
  );
  assert.equal(
    await page.locator("#attack-button").count(),
    0,
    "Automatic combat has no visible Attack button",
  );
  assert.equal(
    await page.locator("#fight-button").count(),
    0,
    "Manual Fight toggle is removed",
  );
  assert.equal(
    await page.getByRole("button", { name: /^jump$/i }).count(),
    1,
    "Version 0.6 exposes one Jump control",
  );
  const center = async (selector) => {
    const box = await page.locator(selector).boundingBox();
    return {
      x: Math.round(box.x + box.width / 2),
      y: Math.round(box.y + box.height / 2),
    };
  };
  const separate = (a, b) =>
    a.x + a.width <= b.x ||
    b.x + b.width <= a.x ||
    a.y + a.height <= b.y ||
    b.y + b.height <= a.y;
  const checkLayout = async (width, height) => {
    const reset = await page.locator("#reset-camera").boundingBox();
    const hint = await page.locator(".camera-hint").boundingBox();
    assert.ok(
      reset.height <= 34,
      "Production Reset Camera retains its reduced height",
    );
    assert.ok(
      reset.x >= width / 2 &&
        reset.y >= hint.y + hint.height + 8 &&
        reset.x + reset.width <= width &&
        reset.y + reset.height <= height,
      "Reset Camera fits below the top-right hint with an 8px gap",
    );
    assert.ok(
      Math.abs(reset.x + reset.width - hint.x - hint.width) < 2,
      "Reset Camera aligns with the hint",
    );
    const actionSelectors = [
      "#sprint-button",
      "#dash-button",
      "#block-button",
      "#jump-button",
    ];
    for (const selector of actionSelectors) {
      const box = await page.locator(selector).boundingBox();
      assert.ok(
        box.x >= 0 &&
          box.y >= 0 &&
          box.x + box.width <= width &&
          box.y + box.height <= height,
        `${selector} fits ${width}x${height}`,
      );
      assert.ok(
        box.width >= 44 && box.height >= 44,
        `${selector} remains a usable mobile target`,
      );
      for (const otherSelector of [
        ...actionSelectors.filter((other) => other !== selector),
        "#joystick",
        "#reset-camera",
        "#help-button",
        "#settings-button",
      ]) {
        assert.ok(
          separate(box, await page.locator(otherSelector).boundingBox()),
          `${selector} does not overlap ${otherSelector}`,
        );
      }
    }
    assert.ok(
      separate(reset, await page.locator(".topbar").boundingBox()),
      "Reset Camera does not overlap the information bar",
    );
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
      "No horizontal page overflow",
    );
  };
  await checkLayout(844, 390);
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
  const session = await page.context().newCDPSession(page);
  const touch = (id, point) => ({
    id,
    ...point,
    radiusX: 7,
    radiusY: 7,
    force: 1,
  });
  const native = async (type, points, changed = points) => {
    const pointerType = {
      touchStart: "pointerdown",
      touchMove: "pointermove",
      touchEnd: "pointerup",
      touchCancel: "pointercancel",
    }[type];
    if (changed.length)
      await page.evaluate(
        ({ pointerType, expected }) => {
          window.__nativeActionEvent = new Promise((resolve) => {
            const pending = [...expected];
            const delivered = (event) => {
              const index = pending.findIndex(
                (point) =>
                  Math.abs(point.x - event.clientX) < 1 &&
                  Math.abs(point.y - event.clientY) < 1,
              );
              if (index >= 0) pending.splice(index, 1);
              if (pending.length) return;
              document.removeEventListener(pointerType, delivered, true);
              resolve();
            };
            document.addEventListener(pointerType, delivered, true);
          });
        },
        { pointerType, expected: changed },
      );
    await session.send("Input.dispatchTouchEvent", {
      type,
      touchPoints: points,
    });
    if (!changed.length) return;
    let timer;
    try {
      await Promise.race([
        page.evaluate(() => window.__nativeActionEvent),
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`Native ${type} was not delivered`)),
            10000,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  };
  const pressed = (selector) =>
    page.locator(selector).getAttribute("aria-pressed");
  const disabled = (selector) =>
    page.locator(selector).getAttribute("aria-disabled");
  const joystick = await center("#joystick");
  const sprint = await center("#sprint-button");
  const dash = await center("#dash-button");
  const block = await center("#block-button");
  const jump = await center("#jump-button");
  const gap = { x: 420, y: 220 };

  let fingers = [
    touch(1, joystick),
    touch(2, { x: 550, y: 165 }),
    touch(3, sprint),
  ];
  await native("touchStart", fingers);
  fingers = [
    touch(1, { x: joystick.x + 32, y: joystick.y }),
    touch(2, { x: 590, y: 180 }),
    fingers[2],
  ];
  await native("touchMove", fingers, fingers.slice(0, 2));
  await page.clock.runFor(400);
  await page.keyboard.press("f");
  await page.clock.runFor(100);
  assert.ok(
    ["ATTACKING", "RECOVERING"].includes(
      await page.locator("#stance-label").textContent(),
    ),
    "The reusable manual F request still starts a production punch",
  );
  assert.ok(
    ["WALK", "SPRINT"].includes(
      await page.locator("#movement-state").textContent(),
    ),
    "Punching preserves movement",
  );
  assert.equal(
    await pressed("#sprint-button"),
    "true",
    "Punching preserves Sprint touch",
  );
  await page.clock.runFor(650);
  assert.equal(
    await page.locator("#stance-label").textContent(),
    "FREE MOVEMENT",
    "Manual punch recovers outside proximity",
  );
  const blockFinger = touch(5, block);
  await native("touchStart", [...fingers, blockFinger], [blockFinger]);
  await page.clock.runFor(400);
  assert.equal(
    await pressed("#block-button"),
    "true",
    "Held Block immediately raises defence",
  );
  assert.equal(await page.locator("#stance-label").textContent(), "BLOCKING");

  // Rendered HUD checks run against the production bundle, with no debug API.
  const dashHudPromise = page.evaluate(async () => {
    const samples = [];
    let sawDash = false;
    let sawCooldown = false;
    for (let frame = 0; frame < 240; frame++) {
      const sample = {
        movement: document.querySelector("#movement-state").textContent,
        cooldown: document.querySelector("#dash-cooldown").textContent,
        active: document
          .querySelector("#dash-button")
          .classList.contains("is-active"),
        disabled: document
          .querySelector("#dash-button")
          .getAttribute("aria-disabled"),
        block: document
          .querySelector("#block-button")
          .getAttribute("aria-pressed"),
        sprint: document
          .querySelector("#sprint-button")
          .getAttribute("aria-pressed"),
        joystick: document
          .querySelector("#joystick")
          .classList.contains("is-active"),
        camera: document
          .querySelector("#camera-surface")
          .classList.contains("is-active"),
      };
      samples.push(sample);
      sawDash ||= sample.movement === "DASH" || sample.active;
      sawCooldown ||= /^\d+\.\d+s$/.test(sample.cooldown);
      if (sawDash && sawCooldown && sample.cooldown === "READY") return samples;
      await new Promise(requestAnimationFrame);
    }
    throw new Error(
      "Production DASH HUD did not progress through dash, cooldown and ready",
    );
  });
  const dashFinger = touch(6, dash);
  await native(
    "touchStart",
    [...fingers, blockFinger, dashFinger],
    [dashFinger],
  );
  await page.clock.runFor(34);
  fingers[0] = touch(1, { x: joystick.x - 32, y: joystick.y });
  await native(
    "touchMove",
    [...fingers, blockFinger, dashFinger],
    [fingers[0]],
  );
  await page.clock.runFor(850);
  const dashHudSamples = await dashHudPromise;
  await native("touchEnd", [dashFinger]);
  assert.ok(
    dashHudSamples.some(
      (sample) => sample.movement === "DASH" || sample.active,
    ),
    "The production HUD displays a native fifth-touch dash",
  );
  assert.ok(
    dashHudSamples.some(
      (sample) =>
        /^\d+\.\d+s$/.test(sample.cooldown) && sample.disabled === "true",
    ),
    "Production Dash displays cooldown",
  );
  assert.equal(dashHudSamples.at(-1).disabled, "false");
  for (const sample of dashHudSamples) {
    assert.equal(sample.block, "true", "Dash preserves the Block touch");
    assert.equal(sample.sprint, "true", "Dash preserves the Sprint touch");
    assert.equal(sample.joystick, true, "Dash preserves the joystick touch");
    assert.equal(sample.camera, true, "Dash preserves the camera touch");
  }
  await native("touchEnd", [blockFinger]);
  await page.clock.runFor(100);
  assert.equal(
    await pressed("#block-button"),
    "false",
    "Releasing Block releases defence",
  );
  await native("touchCancel", [], []);
  await page.clock.runFor(900);
  assert.equal(await pressed("#sprint-button"), "false");
  assert.equal(await pressed("#block-button"), "false");
  assert.equal(await page.locator("#movement-state").textContent(), "IDLE");
  assert.equal(
    await page.locator("#stance-label").textContent(),
    "FREE MOVEMENT",
    "Automatic posture returns to normal after releasing Block",
  );

  // Exercise every remaining gameplay action with one finger that never lifts.
  let slider = touch(21, sprint);
  const slideTo = async (point, milliseconds = 100) => {
    slider = touch(21, point);
    await native("touchMove", [slider]);
    await page.clock.runFor(milliseconds);
  };
  await native("touchStart", [slider]);
  await page.clock.runFor(100);
  assert.equal(await pressed("#sprint-button"), "true");
  await slideTo(dash);
  assert.equal(
    await pressed("#sprint-button"),
    "false",
    "Sprint releases when the finger enters Dash",
  );
  assert.equal(
    await disabled("#dash-button"),
    "true",
    "Entering Dash starts its cooldown",
  );
  await page.clock.runFor(1050);
  assert.equal(
    await page.locator("#dash-cooldown").textContent(),
    "READY",
    "Holding Dash does not repeat after cooldown",
  );
  await slideTo(sprint);
  assert.equal(
    await pressed("#sprint-button"),
    "true",
    "Sliding back resumes Sprint",
  );
  await slideTo(dash);
  assert.equal(
    await disabled("#dash-button"),
    "true",
    "Dash re-entry triggers another burst",
  );
  await slideTo(block, 350);
  assert.equal(
    await pressed("#block-button"),
    "true",
    "Block activates on slide entry",
  );
  await slideTo(gap);
  assert.equal(
    await pressed("#block-button"),
    "false",
    "Leaving Block releases defence immediately",
  );
  assert.equal(
    await page
      .locator("#camera-surface")
      .evaluate((node) => node.classList.contains("is-active")),
    false,
    "Action pointer retains ownership across a gap",
  );
  await slideTo(sprint);
  assert.equal(
    await pressed("#sprint-button"),
    "true",
    "Block to Sprint resumes sprinting without lifting",
  );
  await slideTo(block);
  assert.equal(await pressed("#sprint-button"), "false");
  assert.equal(
    await pressed("#block-button"),
    "true",
    "Re-entering Block holds defence again",
  );
  await native("touchEnd", [slider]);
  await page.clock.runFor(100);
  assert.equal(
    await pressed("#block-button"),
    "false",
    "Releasing the action finger releases Block",
  );

  slider = touch(22, block);
  await native("touchStart", [slider]);
  await page.clock.runFor(100);
  assert.equal(await pressed("#block-button"), "true");
  await native("touchCancel", [], []);
  await page.clock.runFor(100);
  assert.equal(
    await pressed("#block-button"),
    "false",
    "Touch cancellation releases Block",
  );
  assert.equal(
    await pressed("#sprint-button"),
    "false",
    "Touch cancellation releases every HOLD",
  );
  // A fresh production scene reaches the dummy through real movement. Observe
  // only HUD text, never development telemetry or a position mutation hook.
  await page.reload({ waitUntil: "networkidle" });
  await page.clock.runFor(500);
  await page.evaluate(() => {
    const label = document.querySelector("#stance-label");
    window.__combatLabels = [label.textContent];
    new MutationObserver(() => {
      const value = label.textContent;
      if (window.__combatLabels.at(-1) !== value)
        window.__combatLabels.push(value);
    }).observe(label, { childList: true, subtree: true });
  });
  // The stationary dummy is front-right at x=2m. Move there through the
  // unchanged movement controls before approaching along the camera's forward.
  await page.keyboard.down("d");
  await page.clock.runFor(800);
  await page.keyboard.up("d");
  await page.clock.runFor(350);
  await page.keyboard.down("w");
  await page.clock.runFor(1800);
  await page.keyboard.up("w");
  await page.clock.runFor(1400);
  const automaticLabels = await page.evaluate(() => window.__combatLabels);
  assert.ok(
    automaticLabels.filter((value) => value === "ATTACKING").length >= 2,
    "Approaching and standing at the training dummy automatically repeats recovered punches",
  );
  assert.equal(
    await page.locator("#movement-state").textContent(),
    "IDLE",
    "Standing proximity punches do not cause movement",
  );
  const jumpStages = ["TAKE-OFF", "ASCENT", "DESCENT", "LANDING"];
  const proximityJumpFinger = touch(41, jump);
  const attacksBeforeJump = await page.evaluate(
    () => window.__combatLabels.filter((value) => value === "ATTACKING").length,
  );
  const proximityJumpHudPromise = page.evaluate(async () => {
    const samples = [];
    let sawJump = false;
    for (let frame = 0; frame < 120; frame++) {
      const sample = {
        movement: document.querySelector("#movement-state").textContent,
        stance: document.querySelector("#stance-label").textContent,
        status: document.querySelector("#jump-status").textContent,
      };
      samples.push(sample);
      sawJump ||= ["TAKE-OFF", "ASCENT", "DESCENT", "LANDING"].includes(
        sample.movement,
      );
      if (
        sawJump &&
        sample.status === "READY" &&
        !["TAKE-OFF", "ASCENT", "DESCENT", "LANDING"].includes(sample.movement)
      )
        return samples;
      await new Promise(requestAnimationFrame);
    }
    throw new Error("Production proximity jump did not land");
  });
  await native("touchStart", [proximityJumpFinger]);
  await page.clock.runFor(1100);
  const proximityJumpHud = await proximityJumpHudPromise;
  assert.ok(
    proximityJumpHud.some((sample) =>
      ["ASCENT", "DESCENT"].includes(sample.movement),
    ),
    "Production automatic-combat scene performs a real jump",
  );
  assert.ok(
    proximityJumpHud.some((sample) => sample.movement === "LANDING"),
    "Landing is represented before ground combat resumes",
  );
  for (const sample of proximityJumpHud)
    if (jumpStages.includes(sample.movement))
      assert.notEqual(
        sample.stance,
        "ATTACKING",
        "Grounded punches remain suppressed throughout jump HUD phases",
      );
  assert.ok(
    (await page.evaluate(
      () =>
        window.__combatLabels.filter((value) => value === "ATTACKING").length,
    )) > attacksBeforeJump,
    "Automatic combat resumes only after landing",
  );
  await native("touchEnd", [proximityJumpFinger]);

  const proximityBlockFinger = touch(40, block);
  await native("touchStart", [proximityBlockFinger]);
  await page.clock.runFor(100);
  const beforeBlockingLabels = await page.evaluate(
    () => window.__combatLabels.filter((value) => value === "ATTACKING").length,
  );
  await page.clock.runFor(1100);
  assert.equal(await pressed("#block-button"), "true");
  assert.equal(await page.locator("#stance-label").textContent(), "BLOCKING");
  assert.equal(
    await page.evaluate(
      () =>
        window.__combatLabels.filter((value) => value === "ATTACKING").length,
    ),
    beforeBlockingLabels,
    "Held Block suppresses automatic production punches",
  );
  await native("touchEnd", [proximityBlockFinger]);
  await page.clock.runFor(100);
  assert.equal(await pressed("#block-button"), "false");
  assert.ok(
    ["ATTACKING", "RECOVERING"].includes(
      await page.locator("#stance-label").textContent(),
    ),
    "Releasing Block resumes an eligible automatic punch",
  );
  await page.keyboard.down("s");
  await page.keyboard.down("Shift");
  await page.clock.runFor(1000);
  await page.keyboard.up("s");
  await page.keyboard.up("Shift");
  await page.clock.runFor(1000);
  assert.equal(
    await page.locator("#stance-label").textContent(),
    "FREE MOVEMENT",
    "Leaving the dummy returns to normal posture",
  );
  const afterLeavingLabels = await page.evaluate(
    () => window.__combatLabels.filter((value) => value === "ATTACKING").length,
  );
  await page.clock.runFor(850);
  assert.equal(
    await page.evaluate(
      () =>
        window.__combatLabels.filter((value) => value === "ATTACKING").length,
    ),
    afterLeavingLabels,
    "Leaving proximity never queues another production punch",
  );
  await page.reload({ waitUntil: "networkidle" });
  await page.clock.runFor(500);
  await page.evaluate(() => {
    const movement = document.querySelector("#movement-state");
    let active = false;
    window.__jumpEntries = 0;
    new MutationObserver(() => {
      const next = ["TAKE-OFF", "ASCENT", "DESCENT", "LANDING"].includes(
        movement.textContent,
      );
      if (next && !active) window.__jumpEntries++;
      active = next;
    }).observe(movement, { childList: true, subtree: true });
  });
  const idleJumpFinger = touch(51, jump);
  await native("touchStart", [idleJumpFinger]);
  await page.clock.runFor(120);
  assert.equal(await disabled("#jump-button"), "true");
  assert.ok(
    ["TAKE-OFF", "ASCENT"].includes(
      await page.locator("#movement-state").textContent(),
    ),
    "Native Jump starts the production takeoff/flight state",
  );
  await page.keyboard.press("Space");
  await page.keyboard.press("f");
  await page.clock.runFor(1200);
  assert.equal(await page.locator("#jump-status").textContent(), "READY");
  assert.equal(await disabled("#jump-button"), "false");
  assert.equal(
    await page.evaluate(() => window.__jumpEntries),
    1,
    "Holding Jump or entering another jump in flight never repeats after landing",
  );
  assert.equal(
    await page.locator("#dash-cooldown").textContent(),
    "READY",
    "An idle jump does not start a dash or consume ground cooldown",
  );
  assert.equal(
    await page.locator("#stance-label").textContent(),
    "FREE MOVEMENT",
    "Rejected airborne manual punch never queues after landing",
  );
  await native("touchEnd", [idleJumpFinger]);
  await page.clock.runFor(100);
  assert.equal(
    await page.evaluate(() => window.__jumpEntries),
    1,
    "Pointer release cannot duplicate Jump PRESS",
  );

  // One action thumb joins independent joystick and camera fingers, and never
  // lifts while sliding from Sprint through Jump, Block and Dash.
  await page.reload({ waitUntil: "networkidle" });
  await page.clock.runFor(500);
  let jumpFingers = [
    touch(61, joystick),
    touch(62, { x: 550, y: 165 }),
    touch(63, sprint),
  ];
  await native("touchStart", jumpFingers);
  jumpFingers = [
    touch(61, { x: joystick.x + 32, y: joystick.y }),
    touch(62, { x: 615, y: 185 }),
    jumpFingers[2],
  ];
  await native("touchMove", jumpFingers, jumpFingers.slice(0, 2));
  await page.clock.runFor(350);
  const slideJumpAction = async (point, milliseconds = 100) => {
    jumpFingers[2] = touch(63, point);
    await native("touchMove", jumpFingers, [jumpFingers[2]]);
    await page.clock.runFor(milliseconds);
  };
  await slideJumpAction(jump);
  assert.equal(
    await pressed("#sprint-button"),
    "false",
    "Sprint releases while sliding onto Jump",
  );
  assert.equal(
    await disabled("#jump-button"),
    "true",
    "Sliding onto Jump activates PRESS",
  );
  for (const selector of ["#joystick", "#camera-surface"])
    assert.equal(
      await page
        .locator(selector)
        .evaluate((node) => node.classList.contains("is-active")),
      true,
      "Jump retains independent joystick and look fingers",
    );
  await slideJumpAction(block);
  assert.equal(
    await pressed("#block-button"),
    "true",
    "Sliding onto Block holds guard in flight",
  );
  assert.equal(await page.locator("#stance-label").textContent(), "BLOCKING");
  await slideJumpAction(dash);
  assert.equal(
    await pressed("#block-button"),
    "false",
    "Leaving Block releases guard in flight",
  );
  assert.equal(
    await page.locator("#dash-cooldown").textContent(),
    "AIR DASH",
    "Airborne Dash entry starts immediately",
  );
  await page.clock.runFor(1100);
  assert.equal(
    await page.locator("#dash-cooldown").textContent(),
    "READY",
    "A held aerial Dash never starts another dash automatically after landing",
  );
  assert.notEqual(await page.locator("#movement-state").textContent(), "DASH");
  await slideJumpAction(sprint);
  assert.equal(await pressed("#sprint-button"), "true");
  await slideJumpAction(dash);
  assert.equal(
    await disabled("#dash-button"),
    "true",
    "Dash re-entry after landing starts its normal cooldown",
  );
  assert.notEqual(
    await page.locator("#dash-cooldown").textContent(),
    "LAND FIRST",
  );
  await native("touchCancel", [], []);
  await page.clock.runFor(800);
  assert.equal(await pressed("#sprint-button"), "false");
  assert.equal(await pressed("#block-button"), "false");
  for (const selector of ["#joystick", "#camera-surface"])
    assert.equal(
      await page
        .locator(selector)
        .evaluate((node) => node.classList.contains("is-active")),
      false,
      "Cancellation releases movement/look while Jump state recovers",
    );
  assert.equal(await page.locator("#jump-status").textContent(), "READY");
  await page.clock.resume();
  await page.locator("#reset-camera").tap();
  await mkdir("test-results", { recursive: true });
  await page.screenshot({ path: "test-results/pages-landscape.png" });
  for (const viewport of [
    { width: 740, height: 360 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await checkLayout(viewport.width, viewport.height);
  }
  await page.screenshot({ path: "test-results/pages-portrait.png" });

  await page.setViewportSize({ width: 844, height: 390 });
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
  await page.evaluate(() => localStorage.removeItem("kinetic.controls.v1"));
  await page.reload({ waitUntil: "networkidle" });
  await page.clock.runFor(500);
  const layoutSelectors = {
    move: "#joystick",
    sprint: "#sprint-button",
    dash: "#dash-button",
    block: "#block-button",
    jump: "#jump-button",
  };
  const layoutIds = Object.keys(layoutSelectors);
  const layoutRects = async () =>
    Object.fromEntries(
      await Promise.all(
        layoutIds.map(async (id) => [
          id,
          await page.locator(layoutSelectors[id]).boundingBox(),
        ]),
      ),
    );
  const pointOf = (rect) => ({
    x: rect.x + rect.width / 2,
    y: rect.y + rect.height / 2,
  });
  const sameLayout = (actual, expected, message) => {
    for (const id of layoutIds)
      for (const axis of ["x", "y", "width", "height"])
        assert.ok(
          Math.abs(actual[id][axis] - expected[id][axis]) < 1,
          `${message}: ${id}.${axis}`,
        );
  };
  const hudState = () =>
    page.evaluate(() =>
      Object.fromEntries(
        [
          "movement-state",
          "speed-value",
          "stance-label",
          "jump-status",
          "dash-cooldown",
        ].map((id) => [id, document.getElementById(id).textContent]),
      ),
    );
  const clickLayoutUi = async (selector) => {
    const point = await center(selector);
    await page.mouse.click(point.x, point.y);
    await page.clock.runFor(34);
  };
  const openEditor = async () => {
    await clickLayoutUi("#settings-button");
    assert.equal(await page.locator("#settings-dialog").isVisible(), true);
    await clickLayoutUi("#edit-controls-button");
    assert.equal(await page.locator("#settings-dialog").isVisible(), false);
    assert.equal(
      await page.locator("#control-editor-toolbar").isVisible(),
      true,
    );
    assert.equal(
      await page
        .locator("body")
        .evaluate((node) => node.classList.contains("is-layout-editing")),
      true,
    );
  };
  const editorTouch = async (type, points) => {
    const eventType = {
      touchStart: "pointerdown",
      touchMove: "pointermove",
      touchEnd: "pointerup",
      touchCancel: "pointercancel",
    }[type];
    const sequence = await page.evaluate(
      () => window.__layoutNativeEvent.sequence,
    );
    await session.send("Input.dispatchTouchEvent", {
      type,
      touchPoints: points,
    });
    for (let attempt = 0; attempt < 100; attempt++) {
      const observed = await page.evaluate(() => window.__layoutNativeEvent);
      if (
        observed.sequence > sequence &&
        observed.latest?.type === eventType &&
        observed.latest.pointerType === "touch"
      )
        return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`Production editor ${type} was not delivered`);
  };
  const dragLayout = async (id, delta, pointerType) => {
    const before = await layoutRects();
    const start = pointOf(before[id]);
    const destination = { x: start.x + delta.x, y: start.y + delta.y };
    if (pointerType === "mouse") {
      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      await page.mouse.move(destination.x, destination.y, { steps: 3 });
      await page.mouse.up();
    } else {
      await editorTouch("touchStart", [touch(180, start)]);
      await editorTouch("touchMove", [touch(180, destination)]);
      await editorTouch("touchEnd", [touch(180, destination)]);
    }
    await page.clock.runFor(34);
    const after = await layoutRects();
    assert.ok(
      Math.hypot(after[id].x - before[id].x, after[id].y - before[id].y) > 3,
      `${id} moves with ${pointerType} in production`,
    );
    for (const other of layoutIds.filter((key) => key !== id))
      for (const axis of ["x", "y", "width", "height"])
        assert.ok(
          Math.abs(after[other][axis] - before[other][axis]) < 1,
          `Moving ${id} leaves ${other} independent`,
        );
  };
  const checkCustomLayout = async (width, height) => {
    const rects = await layoutRects();
    for (const [id, box] of Object.entries(rects)) {
      assert.ok(
        box.x >= 0 &&
          box.y >= 0 &&
          box.x + box.width <= width + 0.5 &&
          box.y + box.height <= height + 0.5,
        `${id} fits custom ${width}x${height}`,
      );
      assert.ok(box.width >= 44 && box.height >= 44);
      for (const other of layoutIds.filter((key) => key !== id))
        assert.ok(separate(box, rects[other]), `${id} avoids ${other}`);
      for (const selector of [
        ".topbar",
        ".arena-heading",
        ".camera-tools",
        ".movement-readout",
        "#settings-button",
        "#reset-camera",
      ]) {
        const reserved = await page.locator(selector).boundingBox();
        if (reserved)
          assert.ok(separate(box, reserved), `${id} avoids ${selector}`);
      }
    }
    assert.ok(
      separate(
        await page.locator("#settings-button").boundingBox(),
        await page.locator("#reset-camera").boundingBox(),
      ),
    );
  };
  const defaultLayout = await layoutRects();
  await page.keyboard.press("Space");
  await page.clock.runFor(160);
  await openEditor();
  const pausedHud = await hudState();
  assert.ok(
    ["TAKE-OFF", "ASCENT", "DESCENT", "LANDING"].includes(
      pausedHud["movement-state"],
    ),
    "Editor freezes the existing airborne production state",
  );
  const deltas = {
    move: { x: 25, y: -18 },
    sprint: { x: 0, y: 14 },
    dash: { x: 10, y: -10 },
    block: { x: -10, y: 14 },
    jump: { x: -22, y: 14 },
  };
  for (const [index, id] of layoutIds.entries()) {
    await dragLayout(id, deltas[id], index % 2 ? "touch" : "mouse");
    assert.deepEqual(
      await hudState(),
      pausedHud,
      "Production editor dragging cannot advance movement or actions",
    );
  }
  await page.evaluate(() => document.activeElement?.blur());
  for (const key of ["w", "Shift", "Space", "e", "q", "f", "r"])
    await page.keyboard.down(key);
  await editorTouch("touchStart", [touch(181, { x: 440, y: 210 })]);
  await editorTouch("touchMove", [touch(181, { x: 475, y: 185 })]);
  await editorTouch("touchEnd", [touch(181, { x: 475, y: 185 })]);
  await page.clock.runFor(500);
  assert.deepEqual(
    await hudState(),
    pausedHud,
    "Ignored keyboard/camera attempts cannot change production editor state",
  );
  assert.equal(await pressed("#sprint-button"), "false");
  assert.equal(await pressed("#block-button"), "false");
  const draftLayout = await layoutRects();
  await clickLayoutUi("#layout-save");
  for (const key of ["w", "Shift", "Space", "e", "q", "f", "r"])
    await page.keyboard.up(key);
  await page.clock.runFor(1100);
  assert.equal(await page.locator("#jump-status").textContent(), "READY");
  assert.equal(await page.locator("#dash-cooldown").textContent(), "READY");
  assert.equal(await pressed("#sprint-button"), "false");
  assert.equal(await pressed("#block-button"), "false");
  assert.equal(
    await page.locator("#stance-label").textContent(),
    "FREE MOVEMENT",
  );
  const storedText = await page.evaluate(() =>
    localStorage.getItem("kinetic.controls.v1"),
  );
  const stored = JSON.parse(storedText);
  assert.equal(stored.version, 1);
  assert.deepEqual(Object.keys(stored.positions).sort(), [...layoutIds].sort());
  for (const id of layoutIds) {
    const point = pointOf(draftLayout[id]);
    assert.ok(Math.abs(stored.positions[id].x - point.x / 844) < 0.002);
    assert.ok(Math.abs(stored.positions[id].y - point.y / 390) < 0.002);
  }
  await page.reload({ waitUntil: "networkidle" });
  await page.clock.runFor(500);
  const savedLayout = await layoutRects();
  sameLayout(
    savedLayout,
    draftLayout,
    "Custom layout persists in the production bundle",
  );
  await checkCustomLayout(844, 390);

  const customMove = pointOf(savedLayout.move);
  const customAction = Object.fromEntries(
    ["sprint", "jump", "block", "dash"].map((id) => [
      id,
      pointOf(savedLayout[id]),
    ]),
  );
  let customFingers = [
    touch(191, customMove),
    touch(192, { x: 440, y: 205 }),
    touch(193, customAction.sprint),
  ];
  await native("touchStart", customFingers);
  customFingers[0] = touch(191, { x: customMove.x + 32, y: customMove.y });
  customFingers[1] = touch(192, { x: 475, y: 215 });
  await native("touchMove", customFingers, customFingers.slice(0, 2));
  await page.clock.runFor(300);
  const customSlide = async (id, milliseconds = 100) => {
    customFingers[2] = touch(193, customAction[id]);
    await native("touchMove", customFingers, [customFingers[2]]);
    await page.clock.runFor(milliseconds);
  };
  await customSlide("jump");
  assert.equal(await pressed("#sprint-button"), "false");
  assert.equal(await disabled("#jump-button"), "true");
  for (const selector of ["#joystick", "#camera-surface"])
    assert.equal(
      await page
        .locator(selector)
        .evaluate((node) => node.classList.contains("is-active")),
      true,
    );
  await customSlide("block");
  assert.equal(await pressed("#block-button"), "true");
  await customSlide("dash");
  assert.equal(await pressed("#block-button"), "false");
  assert.equal(
    await page.locator("#dash-cooldown").textContent(),
    "AIR DASH",
  );
  await page.clock.runFor(1100);
  assert.equal(await page.locator("#dash-cooldown").textContent(), "READY");
  await customSlide("sprint");
  assert.equal(await pressed("#sprint-button"), "true");
  await customSlide("dash");
  assert.equal(await disabled("#dash-button"), "true");
  await native("touchCancel", [], []);
  await page.clock.runFor(800);
  await openEditor();
  for (const [index, id] of layoutIds.entries())
    await dragLayout(
      id,
      { x: index % 2 ? -10 : 10, y: index % 2 ? -6 : 6 },
      index % 2 ? "mouse" : "touch",
    );
  await clickLayoutUi("#layout-cancel");
  sameLayout(
    await layoutRects(),
    savedLayout,
    "Production Cancel restores saved positions",
  );
  assert.equal(
    await page.evaluate(() => localStorage.getItem("kinetic.controls.v1")),
    storedText,
  );
  await openEditor();
  await clickLayoutUi("#layout-reset");
  sameLayout(
    await layoutRects(),
    defaultLayout,
    "Production Reset previews default positions",
  );
  await clickLayoutUi("#layout-cancel");
  sameLayout(
    await layoutRects(),
    savedLayout,
    "Production Cancel undoes a Reset preview",
  );
  for (const viewport of [
    { width: 740, height: 360 },
    { width: 390, height: 844 },
    { width: 320, height: 568 },
    { width: 568, height: 320 },
  ]) {
    await page.setViewportSize(viewport);
    await page.clock.runFor(100);
    await checkCustomLayout(viewport.width, viewport.height);
    assert.equal(
      await page.evaluate(() => localStorage.getItem("kinetic.controls.v1")),
      storedText,
      "Orientation leaves normalized saved anchors untouched",
    );
  }
  await page.setViewportSize({ width: 844, height: 390 });
  await page.clock.runFor(100);
  sameLayout(
    await layoutRects(),
    savedLayout,
    "Returning to landscape restores custom anchors",
  );
  await openEditor();
  await clickLayoutUi("#layout-reset");
  await clickLayoutUi("#layout-save");
  assert.equal(
    await page.evaluate(() => localStorage.getItem("kinetic.controls.v1")),
    null,
  );
  sameLayout(
    await layoutRects(),
    defaultLayout,
    "Saving Reset clears custom data and restores CSS defaults",
  );
  for (const invalid of ["{", JSON.stringify({ ...stored, version: 0 })]) {
    await page.evaluate(
      (value) => localStorage.setItem("kinetic.controls.v1", value),
      invalid,
    );
    await page.reload({ waitUntil: "networkidle" });
    await page.clock.runFor(500);
    sameLayout(
      await layoutRects(),
      defaultLayout,
      "Invalid/outdated production storage uses defaults safely",
    );
  }
  await page.evaluate(() => localStorage.removeItem("kinetic.controls.v1"));
  await checkLayoutEditorEdges(page, (milliseconds) =>
    page.clock.runFor(milliseconds),
  );
  await checkAerialDashes(page);
  await page.clock.resume();

  for (const asset of requests) {
    const url = new URL(asset);
    assert.equal(url.origin, origin, `No external asset request: ${asset}`);
    assert.ok(
      url.pathname.startsWith(base),
      `Asset stays under ${base}: ${asset}`,
    );
  }
  for (const extension of [".js", ".css", ".woff2", ".svg"])
    assert.ok(
      responses.some((url) => new URL(url).pathname.endsWith(extension)),
      `Loaded ${extension} asset from the Pages mount`,
    );
  assert.deepEqual(
    errors,
    [],
    "Production page has no runtime or asset errors",
  );
  console.log(
    `PASS: production bundle renders at ${base}; Pages assets, native Jump/aerial Dash/multitouch, grounded-only automatic proximity punches, Block priority, slide HOLD/PRESS, responsive action/Reset Camera layouts and saved control editing work`,
  );
  console.log("No physical Android device was tested.");
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise((resolveClosed) => server.close(resolveClosed));
}
