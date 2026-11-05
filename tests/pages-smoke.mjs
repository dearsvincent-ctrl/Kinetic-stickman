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

  const center = async (selector) => {
    const box = await page.locator(selector).boundingBox();
    return {
      x: Math.round(box.x + box.width / 2),
      y: Math.round(box.y + box.height / 2),
    };
  };
  const joystick = await center("#joystick");
  const sprint = await center("#sprint-button");
  const session = await page.context().newCDPSession(page);
  const touch = (id, point) => ({
    id,
    ...point,
    radiusX: 7,
    radiusY: 7,
    force: 1,
  });
  await session.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [
      touch(1, joystick),
      touch(2, { x: 550, y: 165 }),
      touch(3, sprint),
    ],
  });
  await session.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [
      touch(1, { x: joystick.x + 32, y: joystick.y }),
      touch(2, { x: 590, y: 180 }),
      touch(3, sprint),
    ],
  });
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
  await page.locator("#reset-camera").tap();
  await mkdir("test-results", { recursive: true });
  await page.screenshot({ path: "test-results/pages-landscape.png" });

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
    `PASS: production bundle renders at ${base}; JS, CSS, fonts and favicon load from the Pages path; native emulated touch controls work`,
  );
  console.log("No physical Android device was tested.");
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise((resolveClosed) => server.close(resolveClosed));
}
