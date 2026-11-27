import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";
import { openBrowser } from "./browser-driver.mjs";
import { checkProgression } from "./v092-browser.mjs";
import { checkGameplay } from "./manual-gameplay-browser.mjs";
import { checkAcrobatics } from "./acrobatic-browser.mjs";
import { checkActiveBattle } from "./active-battle-browser.mjs";
import { checkPunchAim } from "./punch-aim-browser.mjs";
import { checkAnimationFluidity } from "./animation-fluidity-browser.mjs";
import { checkParkour } from "./parkour-browser.mjs";
import { checkEnemySettings } from "./enemy-settings-browser.mjs";
import { checkAutomaticFlips } from "./automatic-flips-browser.mjs";
import { checkGeometricWorld } from "./geometric-world-browser.mjs";
import { checkCombatStrength } from "./combat-strength-browser.mjs";
import { checkTagMode } from "./tag-mode-browser.mjs";
import { checkEnemyAbilities } from "./enemy-abilities-browser.mjs";
import { checkSliderLocks } from "./slider-locks-browser.mjs";
import { checkCamera } from "./camera-browser.mjs";
import { checkV087Polish } from "./v087-polish-browser.mjs";
import { checkDeveloperMenu } from "./v091-browser.mjs";
import { checkStandingCombat } from "./v091-combat-browser.mjs";
import { checkReactions } from "./v090-browser.mjs";
import { checkMovementAbilities } from "./v089-browser.mjs";
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
const suite = process.env.PAGES_TEST_SUITE || "all";
assert.ok(
  ["all", "movement", "encounter", "polish"].includes(suite),
  "Unknown Pages test suite",
);
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
  if (suite === "all" || suite === "movement") {
    run = await openBrowser(`${origin}${base}`, { practice: true });
    assert.equal(
      await run.page.evaluate(() => typeof window.__KINETIC__),
      "undefined",
    );
    await checkMovementAbilities(run.page, run.native);
    await checkParkour(run.page, run.native);
    await checkAnimationFluidity(run.page, run.native);
    await checkGameplay(run.page, run.native);
    await checkAcrobatics(run.page, run.native);
    await checkAutomaticFlips(run.page, run.native);
    await checkGeometricWorld(run.page, run.native);
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
    await run.browser.close();
    run = null;
  }
  // Fresh context: the normal game must enable active waves by default.
  if (suite !== "movement") {
    run = await openBrowser(`${origin}${base}`);
    assert.equal(
      await run.page.evaluate(() => typeof window.__KINETIC__),
      "undefined",
    );
    if (suite !== "polish") {
      await checkActiveBattle(run.page, run.native);
      await checkPunchAim(run.page, run.native);
      await checkEnemySettings(run.page, run.native);
      await checkCombatStrength(run.page, run.native);
      await checkTagMode(run.page, run.native);
      await checkEnemyAbilities(run.page, run.native);
      await checkSliderLocks(run.page, run.native);
      await checkCamera(run.page, run.native);
    }
    if (suite === "all" || suite === "polish") {
      await checkV087Polish(run.page, run.native);
      await checkReactions(run.page, run.native);
      await checkStandingCombat(run.page, run.native);
      await checkDeveloperMenu(run.page, run.native);
      // Character saves are an independent persistence domain. A fresh browser
      // avoids inheriting deliberately extreme legacy sandbox fixtures.
      const characterRun = await openBrowser(`${origin}${base}`);
      try {
        await checkProgression(characterRun.page, characterRun.native);
        assert.deepEqual(
          characterRun.errors,
          [],
          "No character-interface runtime or asset errors",
        );
        for (const request of characterRun.requests) {
          const url = new URL(request);
          assert.equal(url.origin, origin);
          assert.ok(
            url.pathname.startsWith(base),
            "Progression assets stay below the Pages mount",
          );
        }
      } finally {
        await characterRun.browser.close();
      }
    }
    for (const request of run.requests) {
      const url = new URL(request);
      assert.equal(url.origin, origin);
      assert.ok(
        url.pathname.startsWith(base),
        `Encounter asset stays below ${base}`,
      );
    }
    assert.deepEqual(run.errors, [], "No active-encounter production errors");
  }
  console.log(
    `PASS: production Pages ${suite} suite and mobile controls at ${base}. No physical Android device tested.`,
  );
} finally {
  await run?.browser.close();
  server.closeAllConnections();
  await new Promise((done) => server.close(done));
}
