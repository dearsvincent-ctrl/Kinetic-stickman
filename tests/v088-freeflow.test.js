import test from "node:test";
import assert from "node:assert/strict";
import { Group, Quaternion, Vector3 } from "three";
import { FreeflowCombat } from "../src/combat/FreeflowCombat.js";
import {
  FREEFLOW_DEFAULTS, FREEFLOW_PARAMETERS, FREEFLOW_STORAGE_KEY,
  sanitizeFreeflow, loadFreeflowSettings, saveFreeflowSettings,
} from "../src/sandbox/FreeflowSettings.js";
import { ATTACK_MAGNETISM_STORAGE_KEY } from "../src/sandbox/AttackMagnetismSettings.js";
import { CharacterController } from "../src/movement/CharacterController.js";
import { ArenaBounds } from "../src/world/ArenaBounds.js";
import { TraversalWorld } from "../src/world/TraversalWorld.js";
import { box } from "../src/world/TraversalGeometry.js";
import { createAdaptiveTechniques } from "../src/combat/AdaptiveTechniques.js";
import { CombatController } from "../src/combat/CombatController.js";
import { StrikeHitDetector } from "../src/combat/StrikeHitDetector.js";

const idle = () => ({ move: { x: 0, y: 0 }, blocking: false });
const body = (id = "enemy", x = 0, y = 0, z = -8) => ({
  id, active: true, position: new Vector3(x, y, z), radius: 0.32,
  strikeHeight: 1.4, strikeRadius: 0.27,
});
function fixture({ config = {}, targets = [body()], world = null, techniqueId = "basic-punch" } = {}) {
  world ??= new ArenaBounds(200, targets);
  const controller = new CharacterController(new Group(), world, { parkour: false });
  const freeflow = new FreeflowCombat({ config, targets });
  const techniques = createAdaptiveTechniques();
  const technique = techniques.find((item) => item.id === techniqueId);
  const input = idle();
  let combat;
  combat = new CombatController({
    techniques,
    selectTechnique: () => techniqueId,
    prepareAttackContext(context, selected) {
      const aim = freeflow.begin(controller, targets, selected, "combat", world, {
        accepted: true, context, input, cameraYaw: 0, sequence: combat.attack.sequence + 1,
      });
      return aim ? { ...context, freeflow: aim, [selected.action === "kick" ? "kickAim" : "punchAim"]: aim } : context;
    },
  });
  const detector = new StrikeHitDetector({ targets });
  const f = { freeflow, controller, combat, detector, technique, input, targets, world };
  f.begin = (options = {}) => freeflow.begin(controller, targets, technique, "combat", world, {
    accepted: true, context: { source: "manual", action: technique.action },
    sequence: combat.attack.sequence, input, cameraYaw: 0, ...options,
  });
  f.request = () => combat.requestAttack({ source: "manual", action: technique.action, environment: controller.jump.airborne ? "air" : "ground", height: controller.root.position.y, airTimeRemaining: 3 });
  f.step = (dt, options = {}) => {
    const start = controller.root.position.clone(), heading = controller.heading;
    const context = { combat, input, mode: "combat", cameraYaw: 0, world, ...options };
    const driver = freeflow.beforeStep(dt, controller, context);
    controller.update(dt, input, 0, null, driver);
    freeflow.afterStep(dt, controller, context);
    combat.holdWindup = freeflow.holdWindup;
    detector.sweep(combat.currentTechnique, combat.attack, combat.attack.elapsed,
      combat.sampleEndTime(dt), start, controller.root.position, heading, controller.heading,
      options.orientation ?? null, options.orientation ?? null);
    combat.update(dt);
    return driver;
  };
  return f;
}

test("Freeflow defaults on and sanitizes every independent persisted parameter", () => {
  assert.equal(FREEFLOW_DEFAULTS.enabled, true);
  assert.deepEqual([FREEFLOW_DEFAULTS.range, FREEFLOW_DEFAULTS.maxApproach, FREEFLOW_DEFAULTS.speed, FREEFLOW_DEFAULTS.acceleration], [14, 18, 80, 600]);
  for (const parameter of FREEFLOW_PARAMETERS) {
    assert.equal(sanitizeFreeflow({ [parameter.id]: Infinity })[parameter.id], parameter.default);
    assert.equal(sanitizeFreeflow({ [parameter.id]: -1e8 })[parameter.id], parameter.min);
    assert.equal(sanitizeFreeflow({ [parameter.id]: 1e8 })[parameter.id], parameter.max);
  }
  assert.equal(sanitizeFreeflow({ enabled: "true" }).enabled, false);
  const data = new Map([[ATTACK_MAGNETISM_STORAGE_KEY, '{"version":1,"values":{"enabled":false}}']]);
  const storage = { getItem: (key) => data.get(key), setItem: (key, value) => data.set(key, value) };
  assert.equal(loadFreeflowSettings(storage), null);
  assert.equal(saveFreeflowSettings(storage, { enabled: false, range: 1000 }), true);
  assert.equal(loadFreeflowSettings(storage).range, 100);
  assert.equal(loadFreeflowSettings(storage).enabled, false);
  assert.equal(data.size, 2);
  assert.equal(data.get(ATTACK_MAGNETISM_STORAGE_KEY), '{"version":1,"values":{"enabled":false}}');
  for (const invalid of ["broken", '{"version":2,"values":{}}', '{"version":1,"values":[]}', '{"version":1,"values":null}']) {
    data.set(FREEFLOW_STORAGE_KEY, invalid);
    assert.equal(loadFreeflowSettings(storage), null);
  }
  assert.equal(saveFreeflowSettings(null, {}), false);
  assert.equal(loadFreeflowSettings({ getItem() { throw Error("unavailable"); } }), null);
});

test("only accepted manual punch/kick input queries targets; disabled motion exactly preserves manual physics", () => {
  for (const options of [{ accepted: false }, { context: { source: "enemy" } }, { context: { source: "manual", gesture: "whip-kick" } }, { context: { source: "manual", canAttack: false } }, { blocking: true }]) {
    const f = fixture();
    assert.equal(f.begin(options), null);
    assert.equal(f.freeflow.queries, 0);
    assert.equal(f.freeflow.beforeStep(1 / 60, f.controller), null);
  }
  const f = fixture({ config: { enabled: false } });
  const original = new CharacterController(new Group(), new ArenaBounds(200), { parkour: false });
  f.controller.world = new ArenaBounds(200);
  assert.equal(f.begin(), null);
  for (let n = 0; n < 180; n++) {
    const input = { move: { x: n < 80 ? 0.7 : -0.3, y: n < 120 ? 0.9 : 0 }, movementMagnitude: n < 120 ? 1.3 : 0.5 };
    if (n === 30) { original.requestJump(input, 0.6); f.controller.requestJump(input, 0.6); }
    if (n === 95) { original.requestDash(); f.controller.requestDash(); }
    original.update(1 / 60, input, 0.6);
    f.controller.update(1 / 60, input, 0.6, null, f.freeflow.beforeStep(1 / 60, f.controller));
  }
  assert.deepEqual(f.controller.root.position, original.root.position);
  assert.deepEqual(f.controller.velocity, original.velocity);
  assert.equal(f.controller.heading, original.heading);
  assert.equal(f.controller.jump.sequence, original.jump.sequence);
  assert.equal(f.freeflow.queries, 0);
});

test("six-to-twelve metre entries stop at natural physical contact before extension at 30/60/144Hz, including 520m/s", () => {
  for (const distance of [6, 12]) for (const fps of [30, 60, 144]) for (const incoming of [0, 520]) {
    const f = fixture({ targets: [body("enemy", 0, 0, -distance)] });
    f.controller.velocity.set(0, 0, -incoming);
    assert.equal(f.request(), true);
    const reach = f.technique.reach, radius = f.technique.hitRadius;
    let firstReady = null, firstContact = null;
    for (let n = 0; n < fps; n++) {
      const previous = f.controller.root.position.clone();
      f.step(1 / fps);
      const moved = f.controller.root.position.distanceTo(previous);
      assert.ok(moved <= 80 / fps + 1e-7, `${distance}m ${fps}Hz ${incoming}m/s stays bounded`);
      assert.ok(f.controller.root.position.z >= -distance + 0.7, "no overshoot through the opponent");
      assert.ok(f.freeflow.traveled <= f.freeflow.budget + 1e-7);
      if (f.freeflow.ready && firstReady === null) firstReady = n / fps;
      if (f.detector.count && firstContact === null) firstContact = n / fps;
      if (f.freeflow.holdWindup) {
        assert.equal(f.combat.attack.phase, "windup");
        assert.ok(f.combat.attack.elapsed <= f.technique.windup + 1e-9);
        assert.equal(f.detector.count, 0);
      }
    }
    assert.ok(firstReady !== null && firstReady <= 0.42, "approach is fast and decisive");
    assert.ok(firstContact >= firstReady);
    assert.equal(f.detector.count, 1, `${distance}m ${fps}Hz ${incoming}m/s produces a real authored limb contact`);
    const gap = f.controller.root.position.distanceTo(f.targets[0].position);
    assert.ok(gap >= 0.75 && gap <= 0.92, `natural root gap ${gap}`);
    assert.equal(f.technique.reach, reach);
    assert.equal(f.technique.hitRadius, radius);
  }
});

test("a sideways target takes control of fast horizontal travel and yaw remains angularly bounded", () => {
  const f = fixture({ targets: [body("side", 8, 0, -8)] });
  f.controller.velocity.set(520, 0, 0);
  f.controller.heading = Math.PI;
  assert.equal(f.request(), true);
  let lastDriver;
  for (let n = 0; n < 60; n++) {
    const heading = f.controller.heading;
    const driver = f.step(1 / 60);
    if (driver) {
      if (lastDriver) assert.equal(driver, lastDriver, "frame intent is reused");
      lastDriver = driver;
      assert.ok(f.controller.velocity.length() <= 80 + 1e-7);
      assert.ok(Math.abs(f.controller.heading - heading) <= 24 / 60 + 1e-8);
    }
  }
  assert.equal(f.detector.count, 1);
  assert.ok(f.controller.root.position.x > 7);
  assert.ok(f.controller.root.position.z < -7);
});

test("fresh manual direction outranks camera and travel; reachable current targets receive switch hysteresis", () => {
  const left = body("left", -6, 0, -1), right = body("right", 6, 0, -1);
  const f = fixture({ targets: [left, right] });
  f.controller.velocity.set(-520, 0, 0);
  assert.equal(f.begin({ input: { move: { x: 1, y: 0 } } }).targetId, "right");
  assert.equal(f.begin({ input: { move: { x: -1, y: 0 } } }).targetId, "left");
  const a = body("a", 0.01, 0, -5), b = body("b", -0.12, 0, -5);
  const stable = fixture({ targets: [a, b], world: new ArenaBounds(200), config: { switchSensitivity: 0 } });
  assert.equal(stable.begin().targetId, "a");
  a.position.x = 0.15;
  b.position.x = -0.01;
  assert.equal(stable.begin().targetId, "a");
  stable.freeflow.configure({ switchSensitivity: 1 });
  assert.equal(stable.begin().targetId, "b");
});

test("moving targets update the bounded goal and an escaping target consumes no more than its accepted budget", () => {
  const f = fixture({ targets: [body("moving", 0, 0, -10)], config: { maxApproach: 10 } });
  assert.equal(f.request(), true);
  for (let n = 0; n < 8; n++) {
    f.targets[0].position.x += 0.02;
    f.step(1 / 60);
  }
  f.targets[0].position.set(0, 0, -90);
  for (let n = 0; n < 120; n++) f.step(1 / 120);
  assert.equal(f.freeflow.active, false);
  assert.ok(f.freeflow.traveled <= 10 + 1e-7);
  assert.equal(f.detector.count, 0);
  assert.equal(f.combat.attack.cancelled, true);
});

test("LOS rejects walls and props, and a newly introduced wall cancels held windup before damage", () => {
  for (const world of [
    new TraversalWorld(200, [], [box("wall", 0, -4, 5, 3, 0.1)]),
    new ArenaBounds(200, [{ active: true, position: new Vector3(0, 0, -4), radius: 0.5 }]),
  ]) {
    const f = fixture({ world });
    assert.equal(f.begin(), null);
    assert.deepEqual(f.controller.root.position.toArray(), [0, 0, 0]);
  }
  const world = new TraversalWorld(200);
  const f = fixture({ world });
  assert.equal(f.request(), true);
  f.step(1 / 120);
  const stopped = f.controller.root.position.clone();
  world.structures = [box("new-wall", 0, -4, 5, 3, 0.1)];
  f.step(1 / 120);
  assert.equal(f.freeflow.reason, "occluded");
  assert.equal(f.combat.attack.cancelled, true);
  assert.equal(f.detector.count, 0);
  assert.deepEqual(f.controller.root.position, stopped);
});

test("block, Tag, death, jump, dash, parkour, manual-away and lost targets cancel owned motion immediately", () => {
  for (const interrupt of [
    (f) => { f.input.blocking = true; },
    (f) => { f.controller.dead = true; },
    (f) => { f.controller.jumpRequested = true; },
    (f) => { f.controller.dashRequested = true; },
    (f) => { f.controller.parkour = { attached: true }; },
    (f) => { f.input.move.y = -1; },
    (f) => { f.targets[0].active = false; },
    (f) => { f.combat.attack.sequence++; },
  ]) {
    const f = fixture();
    f.request();
    f.step(1 / 120);
    interrupt(f);
    assert.equal(f.freeflow.beforeStep(1 / 120, f.controller, { combat: f.combat, input: f.input }), null);
    assert.equal(f.freeflow.active, false);
    assert.equal(f.controller.velocity.length(), 0);
  }
  const f = fixture();
  f.request();
  assert.equal(f.freeflow.beforeStep(1 / 120, f.controller, { combat: f.combat, mode: "tag" }), null);
  assert.equal(f.freeflow.reason, "mode");
});

test("short aerial 3D assistance preserves jump state, applies through normal gravity, and makes physical contact", () => {
  const f = fixture({ targets: [body("air", 0, 2.45, -6)], techniqueId: "aerial-punch" });
  Object.assign(f.controller.jump, { phase: "airborne", height: 2, verticalVelocity: 0, jumpCount: 1 });
  f.controller.root.position.y = 2;
  assert.equal(f.request(), true);
  const sequence = f.controller.jump.sequence;
  let ready = false, assisted = false;
  for (let n = 0; n < 180; n++) {
    const driver = f.step(1 / 240);
    if (driver?.verticalAssist) {
      assisted = true;
      assert.ok(Math.abs(driver.verticalAssist) <= 48 + 1e-8);
    }
    ready ||= f.freeflow.ready;
    assert.equal(f.controller.jump.sequence, sequence);
    assert.ok(f.controller.root.position.y >= 0);
    assert.ok(f.freeflow.traveled <= f.freeflow.budget + 1e-7);
    if (f.controller.jump.airborne) assert.equal(f.controller.jump.jumpCount, 1);
  }
  assert.equal(assisted, true);
  assert.equal(ready, true);
  assert.equal(f.detector.count, 1);
  assert.ok(f.controller.jump.verticalVelocity < 0, "gravity continues after the short assist");
  assert.equal(fixture({ targets: [body("high", 0, 8, -2)] }).begin(), null);
  const independent = fixture({ config: { range: 2, airRange: 12 }, techniqueId: "aerial-punch", targets: [body("air-only", 0, 2, -8)] });
  Object.assign(independent.controller.jump, { phase: "airborne", height: 2, verticalVelocity: 0, jumpCount: 1 });
  independent.controller.root.position.y = 2;
  assert.equal(independent.request(), true);
  assert.equal(independent.freeflow.targetId, "air-only", "aerial radius is independent of the grounded radius");
});

test("direct contact requires no approach and overlap recovery cannot become a teleport", () => {
  const direct = fixture({ targets: [body("near", 0, 0, -0.8)], config: { maxApproach: 0, speed: 0, acceleration: 0 } });
  assert.equal(direct.request(), true);
  for (let n = 0; n < 120; n++) direct.step(1 / 240);
  assert.equal(direct.detector.count, 1);
  assert.deepEqual(direct.controller.root.position.toArray(), [0, 0, 0]);
  const world = { move(start, displacement, radius, out) { return out.copy(start).add(displacement).add(new Vector3(2, 0, 0)); } };
  const f = fixture({ world });
  f.request();
  f.step(1 / 120);
  assert.equal(f.freeflow.active, false);
  assert.equal(f.combat.attack.cancelled, true);
  assert.deepEqual(f.controller.root.position.toArray(), [0, 0, 0]);
});

test("inverted aerial contact derives the root goal from the transformed limb and preserves the supplied flip quaternion", () => {
  const orientation = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI);
  const original = orientation.clone();
  const f = fixture({ targets: [body("inverted", 0, 2, 6)], techniqueId: "aerial-punch" });
  Object.assign(f.controller.jump, { phase: "airborne", height: 2.7, verticalVelocity: 0, jumpCount: 1 });
  f.controller.root.position.y = 2.7;
  f.combat.prepareAttackContext = (context, technique) => {
    const aim = f.freeflow.begin(f.controller, f.targets, technique, "combat", f.world, {
      accepted: true, context, orientation, sequence: f.combat.attack.sequence + 1,
    });
    return { ...context, freeflow: aim, punchAim: aim };
  };
  assert.equal(f.request(), true);
  assert.ok(f.freeflow.localHeight < 0.7, "inversion changes the real hand height around the body pivot");
  let ready = false;
  for (let n = 0; n < 180; n++) {
    f.step(1 / 240, { orientation });
    ready ||= f.freeflow.ready;
  }
  assert.deepEqual(orientation, original, "Freeflow cannot override the flip");
  assert.equal(ready, true);
  assert.equal(f.detector.count, 1, "the same inverted limb path physically contacts the body");
});
