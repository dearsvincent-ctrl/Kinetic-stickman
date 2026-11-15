import assert from "node:assert/strict";
import { openBrowser } from "./browser-driver.mjs";
import { checkGameplay } from "./manual-gameplay-browser.mjs";
import { checkAcrobatics } from "./acrobatic-browser.mjs";
import { checkActiveBattle } from "./active-battle-browser.mjs";
import { checkPunchAim } from "./punch-aim-browser.mjs";
import { checkAnimationFluidity } from "./animation-fluidity-browser.mjs";
import { checkParkour } from "./parkour-browser.mjs";
import { checkEnemySettings } from "./enemy-settings-browser.mjs";
import { checkAutomaticFlips } from "./automatic-flips-browser.mjs";

const run = await openBrowser(
  (process.env.TEST_URL || "http://127.0.0.1:5173") + "/?debug",
  { practice: true },
);
try {
  await checkParkour(run.page, run.native);
  await checkAnimationFluidity(run.page, run.native);
  await checkGameplay(run.page, run.native);
  await checkAcrobatics(run.page, run.native);
  await checkAutomaticFlips(run.page, run.native);
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
  await checkPunchAim(active.page, active.native);
  await checkEnemySettings(active.page, active.native);
  assert.deepEqual(
    active.errors,
    [],
    "No active-encounter runtime or asset errors",
  );
} finally {
  await active.browser.close();
}
