import assert from "node:assert/strict";
import { stick } from "./acrobatic-browser.mjs";
import {
  read,
  fresh,
  advance,
  open,
  close,
  setRange,
  until,
} from "./v087-polish-browser.mjs";
import { ENEMY_PARAMETERS } from "../src/sandbox/EnemySettings.js";
const distance = (s, e) =>
  Math.hypot(...e.position.map((x, i) => x - s.position[i]));
async function direction(controls, s, e, m = 0.25) {
  const x = e.position[0] - s.position[0],
    z = e.position[2] - s.position[2],
    d = Math.max(0.001, Math.hypot(x, z)),
    yaw = s.camera.yaw;
  await controls.move(
    ((x * Math.cos(yaw) - z * Math.sin(yaw)) / d) * m,
    ((-x * Math.sin(yaw) - z * Math.cos(yaw)) / d) * m,
  );
}
async function encounter(page, impact = 4) {
  await fresh(page);
  await open(page, "enemy-reactions");
  await page.locator("#enemy-reactions-reset").click();
  await page.locator("#physics-reset").click();
  await page.locator("#enemy-reset").click();
  for (const [id, value] of [
    ["speed", 0.1],
    ["attackFrequency", 0],
    ["maxEnemies", 3],
  ])
    await setRange(
      page,
      "enemy-settings",
      { ...ENEMY_PARAMETERS.find((p) => p.id === id), prefix: "enemy" },
      value,
    );
  await setRange(page, "physics", { id: "attackPower" }, 0);
  await setRange(page, "physics", { id: "impact" }, impact);
  await open(page, "freeflow-combat");
  await page.locator("#freeflow-combat-reset").click();
  await open(page, "speed-effects");
  await page.locator("#speed-effects-sonicEnabled").uncheck();
  await close(page);
}
async function strike(page, native, targetId, action) {
  await until(
    page,
    (s) => s.stance.phase === "idle" || s.stance.phase === "recovery",
    "Ready for the next manual test tap",
    { limit: 1600, step: 40 },
  );
  const controls = await stick(page, native);
  let target = null;
  for (let i = 0; i < 90; i++) {
    const s = await read(page);
    target = targetId
      ? s.enemies.find((e) => e.id === targetId)
      : s.enemies
          .filter((e) => e.health > 0)
          .sort((a, b) => distance(s, a) - distance(s, b))[0];
    assert.ok(target?.health > 0);
    if (
      distance(s, target) >= (targetId ? 0.5 : 4) &&
      distance(s, target) <= (targetId ? 14 : 9)
    ) {
      await direction(controls, s, target);
      await advance(page, 20);
      break;
    }
    await direction(
      controls,
      s,
      target,
      distance(s, target) > (targetId ? 14 : 9) ? 0.6 : -0.6,
    );
    await advance(page, 60);
  }
  const before = await read(page);
  await controls.tap(action);
  const contact = await until(
    page,
    (s) =>
      s.polish.strike.sequence > before.polish.strike.sequence &&
      s.polish.strike.contacts > before.polish.strike.contacts &&
      s.polish.strike.lastContactTargetId === target.id,
    `Manual ${action} reaches the selected standing enemy`,
    { limit: 2400, step: 20 },
  );
  assert.equal(
    contact.polish.strike.sequence,
    before.polish.strike.sequence + 1,
  );
  const enemy = contact.enemies.find((e) => e.id === target.id);
  assert.equal(enemy.health, 72);
  await controls.move(0, 0);
  await controls.stop();
  return { state: contact, enemy };
}
export async function checkStandingCombat(page, native) {
  await encounter(page);
  const first = await strike(page, native, null, "punch");
  assert.ok(
    ["stumble", "heavy-stumble", "recoil"].includes(first.enemy.reaction.phase),
  );
  assert.equal(first.enemy.reaction.ragdoll, false);
  assert.ok(
    first.enemy.reaction.instability > 0 &&
      first.enemy.reaction.instability < 1,
  );
  const second = await strike(page, native, first.enemy.id, "kick");
  assert.ok(
    ["stumble", "heavy-stumble", "recoil"].includes(
      second.enemy.reaction.phase,
    ),
  );
  assert.ok(
    second.enemy.reaction.instability > first.enemy.reaction.instability,
  );
  assert.equal(second.enemy.reaction.ragdoll, false);
  const third = await strike(page, native, first.enemy.id, "punch");
  assert.ok(
    ["stumble", "heavy-stumble", "recoil"].includes(third.enemy.reaction.phase),
  );
  assert.ok(
    third.enemy.reaction.instability > second.enemy.reaction.instability,
    JSON.stringify({
      first: first.enemy.reaction,
      second: second.enemy.reaction,
      third: third.enemy.reaction,
    }),
  );
  assert.ok(
    Math.hypot(
      ...third.enemy.position.map((x, i) => x - first.enemy.position[i]),
    ) > 1,
    "Successive physical hits displace a standing opponent",
  );
  await page.screenshot({ path: "test-results/v091-standing-combo.png" });
  await until(
    page,
    (s) =>
      s.enemies.find((e) => e.id === first.enemy.id)?.reaction.instability ===
      0,
    "Balance restores naturally after the combination",
    { limit: 6500, step: 80 },
  );
  console.log(
    "PASS: v091 native Punch → Kick → Punch on the same displaced enemy, progressive instability, standing continuity, unchanged health and natural balance recovery",
  );

  await open(page, "enemy-reactions");
  await setRange(page, "physics", { id: "impact" }, 20);
  await close(page);
  const finish = await strike(page, native, first.enemy.id, "kick");
  assert.ok(
    ["flight", "knockdown", "fallen"].includes(finish.enemy.reaction.phase),
  );
  assert.equal(finish.enemy.reaction.ragdoll, true);
  assert.equal(finish.state.polish.freeflow.active, false);
  await until(
    page,
    (s) =>
      s.enemies.find((e) => e.id === first.enemy.id)?.reaction.phase === "idle",
    "Severe launch still lands and recovers",
    { limit: 8500, step: 80 },
  );
  console.log(
    "PASS: v091 a deliberate powerful finishing kick launches physically and preserves selective ragdoll/landing recovery",
  );

  await encounter(page, 1);
  const controls = await stick(page, native);
  for (let i = 0; i < 80; i++) {
    const s = await read(page),
      e = s.enemies
        .filter((e) => e.health > 0)
        .sort((a, b) => distance(s, a) - distance(s, b))[0];
    await direction(controls, s, e, 0.5);
    await advance(page, 60);
    if (distance(s, e) < 8) break;
  }
  await controls.move(0, 0);
  const before = await read(page);
  await controls.enter("punch");
  const held = await until(
    page,
    (s) => s.polish.strike.contacts >= before.polish.strike.contacts + 3,
    "Holding Punch repeats real physical contacts",
    { limit: 6500, step: 40 },
  );
  assert.ok(held.polish.strike.sequence >= 3);
  await controls.releaseAction();
  await controls.stop();
  await advance(page, 800);
  const released = await read(page);
  await advance(page, 700);
  assert.equal(
    (await read(page)).polish.strike.sequence,
    released.polish.strike.sequence,
    "Release never starts another queued strike",
  );
  await open(page, "enemy-reactions");
  await page.locator("#enemy-reactions-reset").click();
  await page.locator("#physics-reset").click();
  await close(page);
  console.log(
    "PASS: v091 held Punch remains responsive at the existing scheduler rate and release stops repetition",
  );
}
