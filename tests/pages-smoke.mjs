import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";
import { openBrowser } from "./browser-driver.mjs";
import { checkGameplay } from "./manual-gameplay-browser.mjs";
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

let run;
try {
  await new Promise((ready, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", ready);
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  run = await openBrowser(`${origin}${base}`);
  assert.equal(
    await run.page.evaluate(() => typeof window.__KINETIC__),
    "undefined",
  );
  await checkGameplay(run.page, run.native);
  for (const request of run.requests) {
    const url = new URL(request);
    assert.equal(url.origin, origin);
    assert.ok(
      url.pathname.startsWith(base),
      `Asset stays below ${base}: ${request}`,
    );
  }
  for (const extension of [".js", ".css", ".woff2", ".svg"])
    assert.ok(
      run.responses.some((url) => new URL(url).pathname.endsWith(extension)),
      `Loaded ${extension}`,
    );
  assert.deepEqual(run.errors, [], "No production runtime or asset errors");
  console.log(
    `PASS: production Pages bundle and mobile controls at ${base}. No physical Android device tested.`,
  );
} finally {
  await run?.browser.close();
  server.closeAllConnections();
  await new Promise((done) => server.close(done));
}
