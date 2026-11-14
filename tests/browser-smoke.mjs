import assert from "node:assert/strict";
import { openBrowser } from "./browser-driver.mjs";
import { checkGameplay } from "./manual-gameplay-browser.mjs";
import { checkAcrobatics } from "./acrobatic-browser.mjs";
import { checkActiveBattle } from "./active-battle-browser.mjs";

const run = await openBrowser(
  (process.env.TEST_URL || "http://127.0.0.1:5173") + "/?debug",
  { practice: true },
);
try {
  await checkGameplay(run.page, run.native);
  await checkAcrobatics(run.page, run.native);
  assert.deepEqual(run.errors, [], "No browser runtime or asset errors");
  console.log(
    "PASS: development mobile browser checks. No physical Android device tested.",
  );
} finally {
  await run.browser.close();
}

const active = await openBrowser(
  (process.env.TEST_URL || "http://127.0.0.1:5173") + "/?debug",
);
try {
  await checkActiveBattle(active.page, active.native);
  assert.deepEqual(
    active.errors,
    [],
    "No active-encounter runtime or asset errors",
  );
} finally {
  await active.browser.close();
}
