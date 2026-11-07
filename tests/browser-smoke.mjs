import { checkPhysicsSandbox } from "./physics-sandbox-browser.mjs";
import assert from "node:assert/strict";
import { openBrowser } from "./browser-driver.mjs";
import { checkGameplay } from "./analogue-gameplay-browser.mjs";

const run = await openBrowser(
  (process.env.TEST_URL || "http://127.0.0.1:5173") + "/?debug",
);
try {
  await checkGameplay(run.page, run.native);
  await checkPhysicsSandbox(run.page, run.native);
  assert.deepEqual(run.errors, [], "No browser runtime or asset errors");
  console.log(
    "PASS: development mobile browser checks. No physical Android device tested.",
  );
} finally {
  await run.browser.close();
}
