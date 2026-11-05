import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";
import { chromium } from "playwright";
import { resolvePagesBase } from "../build/pagesBase.js";

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
    await page.locator("#fight-button").getAttribute("aria-pressed"),
    "false",
  );
  await page.locator("#fight-button").tap();
  await page.waitForFunction(
    () =>
      document.querySelector("#stance-label").textContent === "FIGHTING STANCE",
  );
  assert.equal(
    await page.locator("#fight-button").getAttribute("aria-pressed"),
    "true",
  );

  const center = async (selector) => {
    const box = await page.locator(selector).boundingBox();
    return {
      x: Math.round(box.x + box.width / 2),
      y: Math.round(box.y + box.height / 2),
    };
  };
  const checkResetLayout = async (width, height) => {
    const reset = await page.locator("#reset-camera").boundingBox();
    const hint = await page.locator(".camera-hint").boundingBox();
    assert.ok(reset.height <= 34, "Production Reset Camera has reduced height");
    assert.ok(
      reset.x >= width / 2 &&
        reset.y >= hint.y + hint.height + 8 &&
        reset.x + reset.width <= width &&
        reset.y + reset.height <= height,
      "Reset Camera fits below the top-right hint with an 8px gap",
    );
    assert.ok(
      Math.abs(reset.x + reset.width - hint.x - hint.width) < 2,
      "Reset Camera aligns with the right edge of the hint",
    );
    for (const selector of [
      ".topbar",
      "#sprint-button",
      "#fight-button",
      "#dash-button",
    ]) {
      const other = await page.locator(selector).boundingBox();
      assert.ok(
        reset.x + reset.width <= other.x ||
          other.x + other.width <= reset.x ||
          reset.y + reset.height <= other.y ||
          other.y + other.height <= reset.y,
        `Reset Camera does not overlap ${selector}`,
      );
    }
  };
  await checkResetLayout(844, 390);
  const joystick = await center("#joystick");
  const sprint = await center("#sprint-button");
  const dash = await center("#dash-button");
  const session = await page.context().newCDPSession(page);
  const touch = (id, point) => ({
    id,
    ...point,
    radiusX: 7,
    radiusY: 7,
    force: 1,
  });
  let fingers = [
    touch(1, joystick),
    touch(2, { x: 550, y: 165 }),
    touch(3, sprint),
  ];
  await session.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: fingers,
  });
  fingers = [
    touch(1, { x: joystick.x + 32, y: joystick.y }),
    touch(2, { x: 590, y: 180 }),
    touch(3, sprint),
  ];
  await session.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: fingers,
  });
  // Keep production coverage independent of the development telemetry. Sample
  // HUD states before the native fourth touch so the short dash cannot be
  // missed by a slower assertion round-trip to the browser.
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
        guard: document
          .querySelector("#fight-button")
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
  const dashFinger = touch(4, dash);
  await session.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [...fingers, dashFinger],
  });
  await session.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    // CDP identifies the ended touch, rather than the remaining three.
    touchPoints: [dashFinger],
  });
  const dashHudSamples = await dashHudPromise;
  assert.ok(
    dashHudSamples.some(
      (sample) => sample.movement === "DASH" || sample.active,
    ),
    "The production HUD displays the native fourth-touch dash",
  );
  assert.ok(
    dashHudSamples.some(
      (sample) =>
        /^\d+\.\d+s$/.test(sample.cooldown) && sample.disabled === "true",
    ),
    "The production DASH button displays its cooldown",
  );
  assert.equal(dashHudSamples.at(-1).disabled, "false");
  for (const sample of dashHudSamples) {
    assert.equal(sample.guard, "true", "Dashing preserves fighting stance");
    assert.equal(sample.sprint, "true", "Dashing preserves the sprint touch");
    assert.equal(sample.joystick, true, "Dashing preserves the joystick touch");
    assert.equal(sample.camera, true, "Dashing preserves the camera touch");
  }
  await page.waitForFunction(() =>
    ["WALK", "SPRINT"].includes(
      document.querySelector("#movement-state").textContent,
    ),
  );
  assert.equal(
    await page.locator("#sprint-button").getAttribute("aria-pressed"),
    "true",
  );
  assert.ok(
    await page
      .locator("#camera-surface")
      .evaluate((element) => element.classList.contains("is-active")),
    "Camera drag owns a separate active touch",
  );
  assert.ok(
    await page
      .locator("#joystick")
      .evaluate((element) => element.classList.contains("is-active")),
    "Joystick remains active during camera drag and sprint",
  );
  assert.equal(
    await page.locator("#fight-button").getAttribute("aria-pressed"),
    "true",
    "Guard remains selected during simultaneous movement/look/sprint",
  );
  await session.send("Input.dispatchTouchEvent", {
    type: "touchCancel",
    touchPoints: [],
  });
  await page.waitForFunction(
    () => document.querySelector("#movement-state").textContent === "IDLE",
  );
  assert.equal(
    await page.locator("#sprint-button").getAttribute("aria-pressed"),
    "false",
  );
  assert.equal(
    await page.locator("#fight-button").getAttribute("aria-pressed"),
    "true",
    "Cancelling momentary touches preserves the selected guard",
  );
  await mkdir("test-results", { recursive: true });
  await page.screenshot({ path: "test-results/pages-guard.png" });
  await page.locator("#fight-button").tap();
  await page.waitForFunction(
    () =>
      document.querySelector("#stance-label").textContent === "FREE MOVEMENT",
  );
  assert.equal(
    await page.locator("#fight-button").getAttribute("aria-pressed"),
    "false",
  );

  // Exercise the exact production bundle with one native finger that never
  // lifts between actions. Assert rendered accessibility/HUD states rather
  // than relying on development-only controller telemetry.
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
  const fight = await center("#fight-button");
  const gap = { x: 420, y: 220 };
  let slider = touch(21, sprint);
  const slideTo = async (point) => {
    slider = touch(21, point);
    // A CDP acknowledgement may precede native pointermove delivery. Await the
    // event itself before advancing the game's frozen animation clock.
    await page.evaluate((expected) => {
      window.__nativeActionMove = new Promise((resolve) => {
        const moved = (event) => {
          if (
            Math.abs(expected.x - event.clientX) >= 1 ||
            Math.abs(expected.y - event.clientY) >= 1
          )
            return;
          document.removeEventListener("pointermove", moved, true);
          resolve();
        };
        document.addEventListener("pointermove", moved, true);
      });
    }, slider);
    await session.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [slider],
    });
    let timer;
    try {
      await Promise.race([
        page.evaluate(() => window.__nativeActionMove),
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("Native action move was not delivered")),
            10000,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
    // The production HUD intentionally refreshes every 80ms; advance far enough
    // to observe its next refresh while remaining inside the 250ms dash.
    await page.clock.runFor(100);
  };
  const pressed = (selector) =>
    page.locator(selector).getAttribute("aria-pressed");
  await session.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [slider],
  });
  await page.clock.runFor(34);
  assert.equal(await pressed("#sprint-button"), "true");
  await slideTo(dash);
  assert.equal(
    await pressed("#sprint-button"),
    "false",
    "Sprint releases when the finger enters Dash",
  );
  assert.equal(
    await page.locator("#dash-button").getAttribute("aria-disabled"),
    "true",
    "Entering Dash starts its cooldown",
  );
  await page.clock.runFor(1050);
  assert.equal(
    await page.locator("#dash-cooldown").textContent(),
    "READY",
    "Holding Dash does not repeat when the cooldown expires",
  );
  await slideTo(sprint);
  assert.equal(
    await pressed("#sprint-button"),
    "true",
    "Sliding back resumes Sprint",
  );
  await slideTo(dash);
  assert.equal(
    await page.locator("#dash-button").getAttribute("aria-disabled"),
    "true",
    "Re-entering Dash triggers another burst after cooldown",
  );
  await slideTo(fight);
  assert.equal(
    await pressed("#fight-button"),
    "true",
    "Fight toggles on finger entry",
  );
  await slideTo({ x: fight.x + 1, y: fight.y });
  assert.equal(
    await pressed("#fight-button"),
    "true",
    "Moving within Fight does not toggle again",
  );
  await slideTo(gap);
  assert.equal(
    await pressed("#fight-button"),
    "true",
    "Leaving Fight preserves stance",
  );
  assert.equal(
    await page
      .locator("#camera-surface")
      .evaluate((node) => node.classList.contains("is-active")),
    false,
    "An action finger is not adopted by the camera in a gap",
  );
  await slideTo(fight);
  assert.equal(
    await pressed("#fight-button"),
    "false",
    "Re-entering Fight toggles off",
  );
  await session.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [slider],
  });
  await page.clock.runFor(34);
  assert.equal(
    await pressed("#fight-button"),
    "false",
    "Releasing the pointer cannot duplicate the toggle",
  );
  slider = touch(22, sprint);
  await session.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [slider],
  });
  await page.clock.runFor(34);
  assert.equal(await pressed("#sprint-button"), "true");
  await session.send("Input.dispatchTouchEvent", {
    type: "touchCancel",
    touchPoints: [],
  });
  await page.clock.runFor(34);
  assert.equal(
    await pressed("#sprint-button"),
    "false",
    "Cancellation releases production HOLD controls",
  );
  await page.clock.resume();
  await page.locator("#reset-camera").tap();
  await mkdir("test-results", { recursive: true });
  await page.screenshot({ path: "test-results/pages-landscape.png" });
  for (const viewport of [
    { width: 740, height: 360 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await checkResetLayout(viewport.width, viewport.height);
  }
  await page.screenshot({ path: "test-results/pages-portrait.png" });

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
    `PASS: production bundle renders at ${base}; Pages assets, native multitouch, slide HOLD/PRESS/TOGGLE, DASH cooldown and responsive Reset Camera layout work`,
  );
  console.log("No physical Android device was tested.");
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise((resolveClosed) => server.close(resolveClosed));
}
