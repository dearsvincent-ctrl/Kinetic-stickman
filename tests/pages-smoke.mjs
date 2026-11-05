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
    await page.locator("#fight-button").count(),
    0,
    "Manual Fight toggle is removed",
  );
  assert.equal(
    await page.getByRole("button", { name: /^jump$/i }).count(),
    0,
    "No premature Jump control",
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
      "#attack-button",
      "#block-button",
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
  const attack = await center("#attack-button");
  const block = await center("#block-button");
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
  const attackFinger = touch(4, attack);
  await native("touchStart", [...fingers, attackFinger], [attackFinger]);
  await page.clock.runFor(100);
  assert.equal(
    await disabled("#attack-button"),
    "true",
    "Native fourth touch starts the production punch",
  );
  assert.ok(
    ["WALK", "SPRINT"].includes(
      await page.locator("#movement-state").textContent(),
    ),
    "Attacking preserves movement",
  );
  assert.equal(
    await pressed("#sprint-button"),
    "true",
    "Attacking preserves the Sprint touch",
  );
  await native("touchEnd", [attackFinger]);
  await page.clock.runFor(550);
  assert.equal(
    await disabled("#attack-button"),
    "false",
    "Punch recovers in the production bundle",
  );
  const blockFinger = touch(5, block);
  await native("touchStart", [...fingers, blockFinger], [blockFinger]);
  await page.clock.runFor(400);
  assert.equal(
    await pressed("#block-button"),
    "true",
    "Held Block immediately raises defence",
  );
  assert.equal(
    await disabled("#attack-button"),
    "true",
    "Held Block prevents another punch",
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

  // Count only rendered ready-to-busy transitions. This validates per-entry
  // attack recovery without exposing any development-only game internals.
  await page.evaluate(() => {
    const button = document.querySelector("#attack-button");
    let previous = button.getAttribute("aria-disabled");
    window.__attackBusyEntries = 0;
    new MutationObserver(() => {
      const current = button.getAttribute("aria-disabled");
      if (current === "true" && previous !== "true")
        window.__attackBusyEntries++;
      previous = current;
    }).observe(button, {
      attributes: true,
      attributeFilter: ["aria-disabled"],
    });
  });
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
  await slideTo(attack);
  assert.equal(
    await pressed("#block-button"),
    "false",
    "Block releases before entering Attack",
  );
  assert.equal(
    await disabled("#attack-button"),
    "true",
    "Block to Attack initiates the punch without lifting",
  );
  const firstBusyCount = await page.evaluate(() => window.__attackBusyEntries);
  await slideTo(gap);
  await slideTo(attack);
  assert.equal(
    await page.evaluate(() => window.__attackBusyEntries),
    firstBusyCount,
    "Recovery rejects rapid re-entry",
  );
  await page.clock.runFor(850);
  assert.equal(
    await disabled("#attack-button"),
    "false",
    "Attack recovers while the thumb remains over it",
  );
  assert.equal(
    await page.evaluate(() => window.__attackBusyEntries),
    firstBusyCount,
    "Held or rejected entries do not buffer a repeated punch",
  );
  await slideTo(gap);
  assert.equal(
    await page
      .locator("#camera-surface")
      .evaluate((node) => node.classList.contains("is-active")),
    false,
    "Action finger is not adopted by camera in a gap",
  );
  await slideTo(attack);
  assert.equal(
    await disabled("#attack-button"),
    "true",
    "Recovered re-entry initiates another punch",
  );
  assert.equal(
    await page.evaluate(() => window.__attackBusyEntries),
    firstBusyCount + 1,
  );
  await page.clock.runFor(850);
  await native("touchEnd", [slider]);
  await page.clock.runFor(100);
  assert.equal(
    await disabled("#attack-button"),
    "false",
    "Releasing Attack does not generate a synthetic extra punch",
  );
  assert.equal(
    await page.evaluate(() => window.__attackBusyEntries),
    firstBusyCount + 1,
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
    `PASS: production bundle renders at ${base}; Pages assets, native multitouch, slide Attack/Block/HOLD/PRESS recovery, DASH cooldown and responsive action/Reset Camera layouts work`,
  );
  console.log("No physical Android device was tested.");
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise((resolveClosed) => server.close(resolveClosed));
}
