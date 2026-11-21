import assert from "node:assert/strict";
import { stick } from "./acrobatic-browser.mjs";
import { ENEMY_PARAMETERS } from "../src/sandbox/EnemySettings.js";
import { SPEED_EFFECT_PARAMETERS } from "../src/sandbox/SpeedEffectsSettings.js";
import { advance, read, fresh, open, close, until, setRange, resetNew } from "./v087-polish-browser.mjs";

const distance = (state, enemy) => Math.hypot(...enemy.position.map((n, i) => n - state.position[i]));
const living = (state) => state.enemies.filter((enemy) => enemy.health > 0);
async function toward(controls, state, enemy, magnitude = 0.2) {
  const dx = enemy.position[0] - state.position[0], dz = enemy.position[2] - state.position[2];
  const length = Math.max(0.001, Math.hypot(dx, dz)), yaw = state.camera.yaw;
  await controls.move((dx * Math.cos(yaw) - dz * Math.sin(yaw)) / length * magnitude,
    (-dx * Math.sin(yaw) - dz * Math.cos(yaw)) / length * magnitude);
}

async function slowEnemies(page) {
  await open(page, "enemy-settings");
  await page.locator("#physics-reset").click();
  await page.locator("#enemy-reset").click();
  for (const [id, value] of [["speed", 0.1], ["attackFrequency", 0], ["maxEnemies", 3]])
    await setRange(page, "enemy-settings", { ...ENEMY_PARAMETERS.find((p) => p.id === id), prefix: "enemy" }, value);
  await close(page);
}

async function encounter(page, { sonic = false } = {}) {
  await fresh(page);
  await resetNew(page);
  await slowEnemies(page);
  if (!sonic) {
    await open(page, "speed-effects");
    await page.locator("#speed-effects-sonicEnabled").uncheck();
    await close(page);
  }
  assert.equal((await read(page)).stance.sequence, "0", "Proximity and tuning cannot start an attack");
  assert.equal((await read(page)).polish.freeflow.queries, 0, "Idle Freeflow never acquires autonomously");
}

async function atRange(page, controls, minimum = 7, maximum = 10, excludedId = null) {
  for (let frame = 0; frame < 100; frame++) {
    const state = await read(page), enemy = living(state).filter((enemy) => enemy.id !== excludedId).sort((a, b) => distance(state, a) - distance(state, b))[0];
    assert.ok(enemy, "The fixture uses a real active enemy");
    const gap = distance(state, enemy);
    if (gap >= minimum && gap <= maximum) {
      await toward(controls, state, enemy);
      await advance(page, 20);
      return { state: await read(page), enemy };
    }
    await toward(controls, state, enemy, gap > maximum ? 0.6 : -0.6);
    await advance(page, 80);
  }
  assert.fail(`Native movement did not reach a long-range entry: ${JSON.stringify(await read(page))}`);
}

async function physicalStrike(page, controls, enemy, action = "kick", screenshot = "ground") {
  const before = await read(page), queries = before.polish.freeflow.queries;
  await toward(controls, before, enemy, 0.35);
  await advance(page, 20);
  const origin = await read(page), initialGap = distance(origin, enemy);
  await controls.tap(action);
  let captured = null, maxTravel = 0, hit = null;
  for (let frame = 0; frame < 110; frame++) {
    await advance(page, 20);
    const state = await read(page), flow = state.polish.freeflow;
    if (state.polish.strike.sequence <= before.polish.strike.sequence) continue;
    assert.equal(state.polish.strike.sequence, before.polish.strike.sequence + 1, "A tap accepts exactly one new strike");
    assert.ok(state.position.every(Number.isFinite));
    assert.ok(flow.traveled >= 0 && flow.traveled <= flow.budget + 0.06);
    assert.ok(flow.duration <= 2 && flow.budget <= flow.config.maxApproach);
    if (flow.selectedTargetId) {
      captured ??= flow.selectedTargetId;
      assert.equal(flow.selectedTargetId, captured, "A captured entry keeps its target through execution");
    }
    maxTravel = Math.max(maxTravel, flow.traveled);
    if (state.contacts > before.contacts && state.polish.strike.lastContactTargetId === captured) {
      const contacted = state.enemies.find((target) => target.id === captured);
      assert.ok(contacted && distance(state, contacted) < 1.9, "Authored limbs hit only after a real close approach");
      const previousHealth = before.enemies.find((target) => target.id === captured)?.health;
      assert.ok(contacted.health < previousHealth || Number(state.defeated) > Number(before.defeated));
      await page.screenshot({ path: `test-results/v088-freeflow-${screenshot}-contact.png` });
      hit = state;
      break;
    }
  }
  assert.ok(captured && hit, `One native ${action} must approach and physically contact a real target: ${JSON.stringify(await read(page))}`);
  assert.equal(hit.polish.freeflow.queries, queries + 1, "One accepted tap performs one target query");
  if (initialGap >= 6) assert.ok(maxTravel > 4, `A ${initialGap.toFixed(1)} m entry must make substantial physical travel`);
  await controls.move(0, 0);
  await until(page, (state) => state.stance.phase === "idle", "The accepted strike finishes its recovery");
  await advance(page, 100);
  return { state: hit, targetId: captured, maxTravel, initialGap };
}

async function checkStrongEntries(page, native) {
  await encounter(page);
  let controls = await stick(page, native);
  const entry = await atRange(page, controls);
  assert.ok(distance(entry.state, entry.enemy) >= 6 && distance(entry.state, entry.enemy) <= 12);
  const first = await physicalStrike(page, controls, entry.enemy, "kick", "ground");
  const redirected = await atRange(page, controls, 6, 11, first.targetId);
  assert.ok(distance(redirected.state, redirected.enemy) <= redirected.state.polish.freeflow.config.range, "Native movement positions a second reachable enemy");
  const second = await physicalStrike(page, controls, redirected.enemy, "punch", "redirect");
  assert.notEqual(second.targetId, first.targetId, "A fresh directional attack redirects to another real enemy");
  await controls.stop();

  await encounter(page);
  controls = await stick(page, native);
  await atRange(page, controls);
  await controls.tap("kick");
  await until(page, (s) => s.polish.freeflow.active && s.polish.freeflow.traveled > 0.1, "A long-range entry begins before Block");
  await controls.enter("block");
  await advance(page, 100);
  assert.equal((await read(page)).polish.freeflow.active, false);
  assert.equal(await page.locator("#stance-label").textContent(), "BLOCKING");
  await controls.stop();

  await encounter(page);
  await open(page, "freeflow-combat");
  await page.locator("#freeflow-combat-enabled").uncheck();
  await close(page);
  controls = await stick(page, native);
  const manual = await atRange(page, controls);
  await controls.move(0, 0);
  await advance(page, 200);
  const before = await read(page);
  await controls.tap("kick");
  await advance(page, 600);
  const disabled = await read(page);
  assert.equal(disabled.stance.sequence, "1");
  assert.equal(disabled.polish.freeflow.active, false);
  assert.equal(disabled.polish.freeflow.queries, 0);
  assert.equal(disabled.contacts, before.contacts);
  assert.ok(Math.hypot(disabled.position[0] - before.position[0], disabled.position[2] - before.position[2]) < 0.3);
  assert.ok(distance(disabled, manual.enemy) > 5, "Disabled manual attacks never pull toward a distant enemy");
  await controls.stop();

  await checkAerialEntry(page, native);
  console.log("PASS: v0.8.8 native 6–12 m entries, multi-target switching, Block, manual mode and aerial contact");
}

export async function checkAerialEntry(page, native) {
  await encounter(page);
  const controls = await stick(page, native);
  const aerial = await atRange(page, controls, 6, 9);
  await controls.tap("jump");
  await until(page, (s) => s.position[1] > 0.3, "Jump becomes airborne in sampled HUD", { limit: 350, step: 20 });
  const airHit = await physicalStrike(page, controls, aerial.enemy, "kick", "aerial");
  assert.ok(airHit.maxTravel > 3, "Aerial assistance produces physical horizontal travel");
  assert.equal(airHit.state.polish.strike.environment, "air");
  await controls.stop();
  console.log("PASS: native aerial freeflow contact");
}

export async function checkBoomAndTag(page, native) {
  await encounter(page, { sonic: true });
  await setRange(page, "physics", { id: "movement", log: true }, 12);
  await setRange(page, "speed-effects", SPEED_EFFECT_PARAMETERS.find((p) => p.id === "sonicSpeed"), 12);
  await close(page);
  let controls = await stick(page, native);
  const before = await read(page), yaw = before.camera.targetYaw, pitch = before.camera.targetPitch;
  await controls.move(0, -1);
  const boom = await until(page, (s) => s.polish.effects.sonicBursts > 0 && s.polish.cameraImpact.active, "A real threshold crossing triggers the pressure wave and brief camera impulse", { step: 20 });
  assert.ok(boom.polish.effects.activeRings > 0);
  assert.ok(boom.polish.impacts.booms > 0 && boom.polish.impacts.boomHits > 0, "The same boom pushes nearby combat enemies");
  assert.equal(boom.stance.sequence, "0", "Speed feedback never starts a strike");
  assert.equal(boom.camera.targetYaw, yaw);
  assert.equal(boom.camera.targetPitch, pitch);
  assert.ok(Math.hypot(boom.polish.cameraImpact.offsetX, boom.polish.cameraImpact.offsetY, boom.polish.cameraImpact.offsetZ) <= 0.09);
  await page.screenshot({ path: "test-results/v088-sonic-boom-shake.png" });
  await advance(page, 400);
  const recovered = await read(page);
  assert.equal(recovered.polish.cameraImpact.active, false);
  assert.deepEqual([recovered.polish.cameraImpact.offsetX, recovered.polish.cameraImpact.offsetY, recovered.polish.cameraImpact.offsetZ], [0, 0, 0]);
  assert.equal(recovered.polish.effects.sonicBursts, 1, "Sustained speed does not retrigger the boom");
  await controls.stop();
  await until(page, (s) => s.polish.effects.sonicArmed && s.polish.effects.actualSpeed < 0.5, "Stopping rearms the sonic threshold");
  await open(page, "speed-effects");
  await page.locator("#speed-effects-shakeEnabled").uncheck();
  await close(page);
  controls = await stick(page, native);
  await controls.move(0, -1);
  const unshaken = await until(page, (s) => s.polish.effects.sonicBursts === 2, "A second crossing emits a wave with shake disabled");
  assert.equal(unshaken.polish.cameraImpact.active, false);
  await controls.stop();

  await fresh(page);
  await resetNew(page);
  await page.locator("#game-mode").selectOption("tag");
  await advance(page, 180);
  controls = await stick(page, native);
  const tagBefore = await read(page);
  await controls.tap("kick");
  await advance(page, 200);
  const tag = await read(page);
  assert.equal(tag.mode, "tag");
  assert.equal(tag.polish.freeflow.active, false);
  assert.equal(tag.polish.freeflow.queries, tagBefore.polish.freeflow.queries);
  assert.equal(tag.polish.freeflow.traveled, 0);
  assert.deepEqual(tag.polish.impacts, tagBefore.polish.impacts, "Remote Tag attacks create no combat impact work");
  assert.deepEqual(tag.enemies.map((enemy) => [enemy.id, enemy.health]), tagBefore.enemies.map((enemy) => [enemy.id, enemy.health]));
  assert.equal(tag.tags, "0");
  await controls.stop();
  await fresh(page);
  await resetNew(page);
  console.log("PASS: v0.8.8 native physical-speed sonic event, combat pressure impulse, brief exact camera recovery, shake disable and Tag isolation");
}

export async function checkPassbyAndCollision(page, native) {
  for (const kind of ["near-miss", "direct"]) {
    await encounter(page);
    await open(page, "speed-effects");
    await page.locator("#speed-effects-sonicEnabled").uncheck();
    await setRange(page, "speed-effects", SPEED_EFFECT_PARAMETERS.find((p) => p.id === "impactSpeed"), 5);
    await setRange(page, "speed-effects", SPEED_EFFECT_PARAMETERS.find((p) => p.id === "nearMissSpeed"), 5);
    await setRange(page, "physics", { id: "movement", log: true }, 12);
    await close(page);
    const controls = await stick(page, native);
    const entry = await atRange(page, controls, 7, 10);
    const before = await read(page), dx = entry.enemy.position[0] - before.position[0], dz = entry.enemy.position[2] - before.position[2];
    const length = Math.max(0.001, Math.hypot(dx, dz));
    const lateral = kind === "near-miss" ? 1.7 : 0;
    const waypoint = { position: [entry.enemy.position[0] - dz / length * lateral, entry.enemy.position[1], entry.enemy.position[2] + dx / length * lateral] };
    await toward(controls, before, waypoint, 1);
    const key = kind === "near-miss" ? "nearMisses" : "directHits";
    const affected = await until(page, (s) => s.polish.impacts[key] > 0, `Real high-speed ${kind} triggers its swept collision effect`, { limit: 2200, step: 20 });
    assert.equal(affected.stance.sequence, "0", "Physical speed impacts never initiate attacks");
    assert.equal(affected.contacts, 0, "Speed reactions do not award limb contacts");
    assert.ok(affected.polish.impacts.lastRelativeSpeed >= 5);
    if (kind === "near-miss") assert.equal(affected.polish.impacts.directHits, 0, "A pass-by can react without direct contact");
    else assert.ok(affected.polish.impacts.lastForce > 0 && affected.enemies.some((enemy) => Math.max(Math.hypot(...enemy.impulse), Math.hypot(...(enemy.reaction?.velocity ?? [0,0,0]))) > 0));
    assert.deepEqual(affected.enemies.map((enemy) => [enemy.id, enemy.health]), before.enemies.map((enemy) => [enemy.id, enemy.health]), "Movement impulses preserve enemy health");
    await page.screenshot({ path: `test-results/v088-speed-${kind}.png` });
    await controls.stop();
  }
  console.log("PASS: v0.8.8 native high-speed pass-by and swept direct collision create bounded reactions without automatic attacks or damage");
}

/** Production acceptance uses native touch and real keyboard-operated sliders.
 * Read-only HUD telemetry verifies collision contact, movement and recovery. */
export async function checkFreeflow(page, native) {
  await checkStrongEntries(page, native);
  await checkPassbyAndCollision(page, native);
  await checkBoomAndTag(page, native);
}
