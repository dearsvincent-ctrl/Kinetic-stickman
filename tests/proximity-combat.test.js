import test from "node:test";
import assert from "node:assert/strict";
import {
  BASIC_PUNCH,
  CombatController,
} from "../src/combat/CombatController.js";
import {
  PROXIMITY_CONFIG,
  ProximityCombatController,
} from "../src/combat/ProximityCombatController.js";

const dummy = (id = "dummy", x = 0, z = -0.9) => ({
  id,
  position: { x, y: 0, z },
  radius: 0.32,
});
const origin = () => ({ x: 0, y: 0, z: 0 });
const close = (actual, expected, tolerance = 1e-9) => {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${actual} != ${expected}`,
  );
};
const fixture = (options = {}, combatOptions = {}) => {
  const target = dummy();
  const combat = new CombatController(combatOptions);
  const proximity = new ProximityCombatController(combat, {
    targets: [target],
    ...options,
  });
  return { target, combat, proximity };
};
const advance = (proximity, seconds, options, rate = 60) => {
  let elapsed = 0;
  while (seconds - elapsed > 1e-10) {
    const dt = Math.min(1 / rate, seconds - elapsed);
    proximity.update(dt, options);
    elapsed += dt;
  }
};

test("a target entering one metre triggers the existing basic punch automatically", () => {
  const { target, combat, proximity } = fixture();
  const position = { x: 0, y: 0, z: 0.101 };
  proximity.update(1 / 60, { position });
  assert.equal(proximity.target, null);
  assert.equal(combat.attack.sequence, 0);
  position.z = 0.1;
  proximity.update(1 / 60, { position });
  assert.strictEqual(proximity.target, target);
  close(proximity.distance, 1);
  assert.equal(combat.attack.sequence, 1);
  assert.equal(combat.attack.techniqueId, BASIC_PUNCH.id);
  assert.equal(combat.attack.phase, "windup");
});

test("hysteresis retains an acquired target through the exit band", () => {
  const { target, combat, proximity } = fixture();
  const position = origin();
  proximity.update(1 / 60, { position });
  position.z = 0.2;
  proximity.update(1 / 60, { position });
  assert.strictEqual(proximity.target, target);
  close(proximity.distance, 1.1);
  position.z = 0.25;
  proximity.update(1 / 60, { position });
  assert.strictEqual(proximity.target, target);
  close(proximity.distance, PROXIMITY_CONFIG.exitDistance);
  position.z = 0.251;
  proximity.update(1 / 60, { position });
  assert.equal(proximity.target, null);
  assert.equal(proximity.distance, Infinity);
  // Returning only to the exit band does not reacquire an exited target.
  position.z = 0.2;
  advance(proximity, 1, { position });
  assert.equal(proximity.target, null);
  assert.equal(combat.attack.sequence, 1);
  position.z = 0.1;
  proximity.update(1 / 60, { position });
  assert.strictEqual(proximity.target, target);
  assert.equal(combat.attack.sequence, 2);
});

test("acquisition chooses the nearest eligible target and keeps it until exit", () => {
  const far = dummy("far", 0.95, 0);
  const near = dummy("near", 0, -0.75);
  const combat = new CombatController();
  const proximity = new ProximityCombatController(combat, {
    targets: [far, near],
  });
  const position = origin();
  proximity.update(1 / 60, { position });
  assert.strictEqual(proximity.target, near);
  far.position.x = 0.2;
  proximity.update(1 / 60, { position });
  assert.strictEqual(proximity.target, near);
  near.position.z = -1.2;
  proximity.update(1 / 60, { position });
  assert.strictEqual(proximity.target, far);
  close(proximity.distance, 0.2);
});

test("equal-distance targets select the first registry entry consistently", () => {
  const first = dummy("first", 0, -0.9);
  const second = dummy("second", 0.9, 0);
  const { proximity } = fixture({ targets: [first, second] });
  proximity.update(1 / 60, { position: origin() });
  assert.strictEqual(proximity.target, first);
});

test("automatic punches repeat only after the full existing recovery", () => {
  const { combat, proximity } = fixture();
  const position = origin();
  proximity.update(1 / 60, { position });
  const stableAttack = combat.attack;
  advance(proximity, 0.38, { position });
  assert.equal(combat.attack.sequence, 1);
  assert.equal(combat.attack.phase, "recovery");
  proximity.update(0.03, { position });
  assert.equal(combat.ready, true);
  assert.equal(combat.attack.sequence, 1);
  proximity.update(1 / 60, { position });
  assert.equal(combat.attack.sequence, 2);
  assert.equal(combat.attack.phase, "windup");
  assert.strictEqual(combat.attack, stableAttack);
});

test("holding Block suppresses automatic attacks and releasing it resumes them", () => {
  const { combat, proximity } = fixture();
  const position = origin();
  advance(proximity, 1, { position, blocking: true });
  assert.equal(combat.blocking, true);
  assert.equal(combat.postureActive, true);
  assert.equal(combat.attack.sequence, 0);
  proximity.update(1 / 60, { position, blocking: false });
  assert.equal(combat.blocking, false);
  assert.equal(combat.attack.sequence, 1);
});

test("Block interrupts an automatic punch without resuming it on release", () => {
  const { combat, proximity } = fixture();
  const position = origin();
  proximity.update(0.13, { position });
  close(combat.attack.extension, 0.5);
  proximity.update(0.04, { position, blocking: true });
  assert.equal(combat.attack.cancelled, true);
  assert.equal(combat.attack.phase, "recovery");
  assert.ok(combat.attack.extension < 0.5);
  proximity.update(0.04, { position, blocking: false });
  close(combat.attack.extension, 0.25);
  assert.equal(combat.attack.sequence, 1);
  proximity.update(0.08, { position });
  assert.equal(combat.attack.active, false);
  proximity.update(1 / 60, { position });
  assert.equal(combat.attack.sequence, 2);
  assert.equal(combat.attack.cancelled, false);
});

test("leaving mid-punch lets recovery finish and prevents a queued strike", () => {
  const { combat, proximity } = fixture();
  const position = origin();
  proximity.update(0.13, { position });
  position.z = 1;
  proximity.update(0.05, { position });
  assert.equal(proximity.target, null);
  assert.equal(combat.attack.cancelled, false);
  assert.equal(combat.attack.phase, "recovery");
  close(combat.attack.extension, 1);
  advance(proximity, 2, { position });
  assert.equal(combat.attack.active, false);
  assert.equal(combat.attack.sequence, 1);
  assert.equal(combat.postureActive, false);
});

test("inactive, removed or invalid targets immediately stop new requests", () => {
  for (const invalidate of [
    (target) => {
      target.active = false;
    },
    (target) => {
      target.position.x = NaN;
    },
    (target) => {
      target.position = null;
    },
    (_target, proximity) => {
      proximity.setTargets([]);
    },
  ]) {
    const { target, combat, proximity } = fixture();
    proximity.update(0.13, { position: origin() });
    invalidate(target, proximity);
    advance(proximity, 2, { position: origin() });
    assert.equal(proximity.target, null);
    assert.equal(proximity.distance, Infinity);
    assert.equal(combat.attack.sequence, 1);
    assert.equal(combat.attack.active, false);
  }
});

test("unregistered, malformed and inactive entries cannot be acquired", () => {
  const entries = [
    null,
    {},
    { position: origin() },
    { id: "invalid-x", position: { x: Infinity, y: 0, z: 0 } },
    { id: "invalid-y", position: { x: 0, y: NaN, z: 0 } },
    { id: "invalid-z", position: { x: 0, y: 0 } },
    { id: "inactive", position: origin(), active: false },
  ];
  const { combat, proximity } = fixture({ targets: entries });
  advance(proximity, 2, { position: origin() });
  assert.equal(proximity.target, null);
  assert.equal(combat.attack.sequence, 0);
});

test("registered targets can move or reactivate without mutating the registry", () => {
  const target = dummy("moving", 0, -2);
  target.active = false;
  const { combat, proximity } = fixture({ targets: [target] });
  proximity.update(1 / 60, { position: origin() });
  target.position.z = -0.8;
  proximity.update(1 / 60, { position: origin() });
  assert.equal(combat.attack.sequence, 0);
  target.active = true;
  proximity.update(1 / 60, { position: origin() });
  assert.strictEqual(proximity.target, target);
  assert.equal(combat.attack.sequence, 1);
});

test("registry replacement supports Map entries and same-id descriptors", () => {
  const { target, proximity } = fixture();
  proximity.update(1 / 60, { position: origin() });
  const replacement = dummy(target.id, 0, -1.1);
  proximity.setTargets(new Map([[replacement.id, replacement]]));
  proximity.update(1 / 60, { position: origin() });
  assert.strictEqual(proximity.target, replacement);
  close(proximity.distance, 1.1);
  proximity.setTargets(proximity.targets);
  proximity.update(1 / 60, { position: origin() });
  assert.strictEqual(proximity.target, replacement);
  proximity.setTargets([]);
  assert.equal(proximity.target, null);
  assert.equal(proximity.distance, Infinity);
});

test("context identifies proximity target and normalized floor-plane direction", () => {
  const context = {
    speed: 5.2,
    dashActive: true,
    source: "stale",
    targetId: "stale",
  };
  const target = dummy("nearby", 0.48, -0.64);
  const { combat, proximity } = fixture({ targets: [target] });
  proximity.update(1 / 60, { position: origin(), context });
  assert.equal(combat.attack.context.source, "proximity");
  assert.equal(combat.attack.context.targetId, "nearby");
  assert.equal(combat.attack.context.opponentDistance, 0.8);
  close(combat.attack.context.targetDirection.x, 0.6);
  close(combat.attack.context.targetDirection.y, 0);
  close(combat.attack.context.targetDirection.z, -0.8);
  assert.equal(combat.attack.context.speed, 5.2);
  assert.equal(combat.attack.context.dashActive, true);
  assert.ok(Object.isFrozen(combat.attack.context.targetDirection));
  assert.deepEqual(context, {
    speed: 5.2,
    dashActive: true,
    source: "stale",
    targetId: "stale",
  });
});

test("automatic requests preserve existing manually requested attacks", () => {
  const { combat, proximity } = fixture();
  assert.equal(combat.requestAttack({ source: "manual" }), true);
  proximity.update(1 / 60, { position: origin() });
  assert.equal(combat.attack.sequence, 1);
  assert.equal(combat.attack.context.source, "manual");
  advance(proximity, 0.42, { position: origin() });
  proximity.update(1 / 60, { position: origin() });
  assert.equal(combat.attack.sequence, 2);
  assert.equal(combat.attack.context.source, "proximity");
});

test("selection and punch requests never move targets or actor transforms", () => {
  const target = dummy();
  Object.freeze(target.position);
  Object.freeze(target);
  const position = Object.freeze(origin());
  const { proximity } = fixture({ targets: Object.freeze([target]) });
  advance(proximity, 2, {
    position,
    context: { speed: 5.2, sprinting: true, dashActive: true },
  });
  assert.deepEqual(target.position, { x: 0, y: 0, z: -0.9 });
  assert.deepEqual(position, { x: 0, y: 0, z: 0 });
  assert.equal(target.radius, 0.32);
});

test("collision radii do not extend the center-distance activation threshold", () => {
  const target = dummy("large", 0, -1.01);
  target.radius = 10;
  const { proximity, combat } = fixture({ targets: [target] });
  proximity.update(1 / 60, { position: origin() });
  assert.equal(proximity.target, null);
  assert.equal(combat.attack.sequence, 0);
});

test("floor-plane distance ignores decorative height while rejecting invalid coordinates", () => {
  const target = dummy("height", 0.6, -0.8);
  target.position.y = 3;
  const { proximity } = fixture({ targets: [target] });
  proximity.update(1 / 60, { position: { x: 0, y: 0.1, z: 0 } });
  assert.strictEqual(proximity.target, target);
  close(proximity.distance, 1);
  proximity.update(1 / 60, { position: { x: NaN, y: 0, z: 0 } });
  assert.equal(proximity.target, null);
});

test("reset clears hysteresis without cancelling the existing punch", () => {
  const { target, combat, proximity } = fixture();
  proximity.update(0.13, { position: origin() });
  proximity.reset();
  assert.equal(proximity.target, null);
  assert.equal(proximity.distance, Infinity);
  assert.equal(proximity.aligned, false);
  close(combat.attack.extension, 0.5);
  assert.equal(combat.attack.cancelled, false);
  target.position.z = -1.1;
  proximity.update(1 / 60, { position: origin() });
  assert.equal(proximity.target, null);
});

test("facing gate retains a nearby target while waiting for the actor to turn", () => {
  const { target, combat, proximity } = fixture();
  advance(proximity, 1, { position: origin(), facing: Math.PI });
  assert.strictEqual(proximity.target, target);
  assert.equal(proximity.aligned, false);
  assert.equal(combat.attack.sequence, 0);
  proximity.update(1 / 60, { position: origin(), facing: Math.PI / 3 });
  assert.equal(combat.attack.sequence, 0);
  proximity.update(1 / 60, { position: origin(), facing: Math.PI / 4 });
  assert.equal(proximity.aligned, true);
  assert.equal(combat.attack.sequence, 1);
});

test("facing gate wraps around pi and uses the movement heading convention", () => {
  for (const [x, z, facing] of [
    [0, -0.9, 2 * Math.PI],
    [0, 0.9, -Math.PI + 0.01],
    [0.9, 0, -Math.PI / 2],
    [-0.9, 0, Math.PI / 2],
  ]) {
    const { combat, proximity } = fixture({
      targets: [dummy("direction", x, z)],
    });
    proximity.update(1 / 60, { position: origin(), facing });
    assert.equal(proximity.aligned, true);
    assert.equal(combat.attack.sequence, 1);
  }
});

test("facing changes do not cancel a committed punch but gate the next one", () => {
  const { combat, proximity } = fixture();
  proximity.update(0.13, { position: origin(), facing: 0 });
  advance(proximity, 1, { position: origin(), facing: Math.PI });
  assert.equal(combat.attack.cancelled, false);
  assert.equal(combat.attack.active, false);
  assert.equal(combat.attack.sequence, 1);
  assert.equal(proximity.aligned, false);
  proximity.update(1 / 60, { position: origin(), facing: 0 });
  assert.equal(combat.attack.sequence, 2);
});

test("a coincident target has a finite zero direction and no arbitrary facing gate", () => {
  const { combat, proximity } = fixture({
    targets: [dummy("coincident", 0, 0)],
  });
  proximity.update(1 / 60, { position: origin(), facing: 2 });
  assert.equal(proximity.aligned, true);
  assert.equal(combat.attack.sequence, 1);
  assert.deepEqual(combat.attack.context.targetDirection, { x: 0, y: 0, z: 0 });
});

test("30Hz, 60Hz and 120Hz never overlap punches or skip recovery", () => {
  const duration =
    BASIC_PUNCH.windup + BASIC_PUNCH.extension + BASIC_PUNCH.recovery;
  for (const rate of [30, 60, 120]) {
    const { combat, proximity } = fixture();
    let previousSequence = 0;
    let previousStart = -Infinity;
    let starts = 0;
    for (let frame = 0; frame < 3 * rate; frame++) {
      const previouslyReady = combat.ready;
      proximity.update(1 / rate, { position: origin() });
      if (combat.attack.sequence !== previousSequence) {
        assert.equal(previouslyReady, true);
        const time = frame / rate;
        assert.ok(time - previousStart >= duration - 1e-9);
        if (starts > 0)
          assert.ok(time - previousStart <= duration + 1 / rate + 1e-9);
        previousStart = time;
        previousSequence = combat.attack.sequence;
        starts++;
      }
      assert.ok(combat.attack.extension >= 0 && combat.attack.extension <= 1);
    }
    const cycleFrames = Math.ceil(duration * rate - 1e-9);
    assert.equal(starts, Math.ceil((3 * rate) / cycleFrames));
  }
});

test("invalid time steps do not select a target, request punches or change Block", () => {
  const { combat, proximity } = fixture();
  for (const dt of [0, -1, NaN, Infinity, -Infinity])
    proximity.update(dt, { position: origin(), blocking: true });
  assert.equal(proximity.target, null);
  assert.equal(combat.blocking, false);
  assert.equal(combat.attack.sequence, 0);
});

test("distance and facing settings are tunable and validated", () => {
  const { combat, proximity } = fixture({
    entryDistance: 0.8,
    exitDistance: 0.95,
    attackFacingAngle: 0.1,
  });
  proximity.update(1 / 60, { position: origin(), facing: 0 });
  assert.equal(proximity.target, null);
  proximity.update(1 / 60, { position: { x: 0, y: 0, z: -0.15 }, facing: 0.2 });
  assert.notEqual(proximity.target, null);
  assert.equal(proximity.aligned, false);
  assert.equal(combat.attack.sequence, 0);
  proximity.update(1 / 60, {
    position: { x: 0, y: 0, z: -0.15 },
    facing: 0.05,
  });
  assert.equal(combat.attack.sequence, 1);
  assert.ok(Object.isFrozen(proximity.config));
  for (const config of [
    { entryDistance: -1 },
    { entryDistance: NaN },
    { exitDistance: Infinity },
    { entryDistance: 2, exitDistance: 1 },
    { attackFacingAngle: -1 },
    { attackFacingAngle: Infinity },
    { attackFacingAngle: Math.PI + 0.01 },
  ])
    assert.throws(
      () => new ProximityCombatController(new CombatController(), config),
      RangeError,
    );
});
