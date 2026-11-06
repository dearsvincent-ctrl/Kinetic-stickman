import test from "node:test";
import assert from "node:assert/strict";
import { Group } from "three";
import {
  BASIC_PUNCH,
  COMBAT_CONFIG,
  CombatController,
} from "../src/combat/CombatController.js";
import { CharacterController } from "../src/movement/CharacterController.js";
import { ArenaBounds } from "../src/world/ArenaBounds.js";

const close = (actual, expected, tolerance = 1e-9) => {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${actual} should be within ${tolerance} of ${expected}`,
  );
};

const advance = (combat, seconds, steps = [1 / 60]) => {
  let elapsed = 0;
  let frame = 0;
  while (seconds - elapsed > 1e-10) {
    const dt = Math.min(steps[frame++ % steps.length], seconds - elapsed);
    combat.update(dt);
    elapsed += dt;
  }
};

test("one basic punch has a windup, smooth extension and natural recovery", () => {
  const combat = new CombatController();
  const stableState = combat.attack;
  assert.equal(combat.ready, true);
  assert.equal(combat.postureActive, false);
  assert.equal(combat.requestAttack(), true);
  assert.equal(combat.attack.phase, "windup");
  assert.equal(combat.attack.sequence, 1);
  assert.equal(combat.attack.techniqueId, "basic-punch");
  assert.equal(combat.ready, false);
  assert.equal(combat.postureActive, true);

  combat.update(0.04);
  close(combat.attack.phaseProgress, 0.5);
  close(combat.attack.extension, 0);
  combat.update(0.04);
  assert.equal(combat.attack.phase, "extension");
  combat.update(0.025);
  close(combat.attack.extension, 0.15625);
  combat.update(0.025);
  close(combat.attack.extension, 0.5);
  combat.update(0.05);
  assert.equal(combat.attack.phase, "recovery");
  close(combat.attack.extension, 1);
  combat.update(0.12);
  close(combat.attack.extension, 0.5);
  combat.update(0.12);
  assert.equal(combat.attack.phase, "idle");
  assert.equal(combat.attack.active, false);
  assert.equal(combat.attack.exitReason, "completed");
  assert.equal(combat.ready, true);
  close(combat.attack.elapsed, 0.42);
  close(combat.attack.extension, 0);
  assert.strictEqual(combat.attack, stableState);
});

test("busy attack entries never repeat or buffer a later punch", () => {
  const combat = new CombatController();
  combat.requestAttack();
  for (let frame = 0; frame < 42; frame++) {
    assert.equal(combat.requestAttack(), false);
    combat.update(0.01);
  }
  assert.equal(combat.ready, true);
  combat.update(5);
  assert.equal(combat.attack.sequence, 1);
  assert.equal(combat.attack.active, false);
  assert.equal(combat.requestAttack(), true);
  assert.equal(combat.attack.sequence, 2);
});

test("automatic posture lingers briefly after recovery then returns to free movement", () => {
  const combat = new CombatController();
  combat.requestAttack();
  combat.update(0.42);
  assert.equal(combat.postureActive, true);
  // The posture blend-out is not another attack cooldown.
  assert.equal(combat.ready, true);
  combat.update(COMBAT_CONFIG.postureHold - 0.001);
  assert.equal(combat.postureActive, true);
  combat.update(0.001);
  assert.equal(combat.postureActive, false);
});

test("Block is immediate, maintained, and prevents attack requests", () => {
  const combat = new CombatController();
  combat.setBlocking(true);
  assert.equal(combat.blocking, true);
  assert.equal(combat.postureActive, true);
  assert.equal(combat.ready, false);
  assert.equal(combat.requestAttack(), false);
  combat.update(10);
  assert.equal(combat.blocking, true);
  assert.equal(combat.attack.sequence, 0);
  combat.setBlocking(false);
  assert.equal(combat.blocking, false);
  assert.equal(combat.ready, true);
  assert.equal(combat.postureActive, true);
  combat.update(COMBAT_CONFIG.postureHold);
  assert.equal(combat.postureActive, false);
});

test("Block to Attack accepts a fresh entry once Block releases", () => {
  const combat = new CombatController();
  combat.setBlocking(true);
  assert.equal(combat.requestAttack(), false);
  combat.setBlocking(false);
  assert.equal(combat.requestAttack(), true);
  assert.equal(combat.attack.sequence, 1);
  assert.equal(combat.attack.phase, "windup");
});

test("Block interrupts a punch continuously and release cannot resume it", () => {
  const combat = new CombatController();
  combat.requestAttack();
  combat.update(0.13);
  close(combat.attack.extension, 0.5);
  combat.setBlocking(true);
  assert.equal(combat.attack.phase, "recovery");
  assert.equal(combat.attack.cancelled, true);
  assert.equal(combat.attack.exitReason, "blocked");
  close(combat.attack.extension, 0.5);
  combat.update(0.04);
  const partialRecovery = combat.attack.extension;
  assert.ok(partialRecovery < 0.5 && partialRecovery > 0);
  combat.setBlocking(false);
  assert.equal(combat.requestAttack(), false);
  combat.update(0.04);
  close(combat.attack.extension, 0.25);
  combat.update(0.08);
  assert.equal(combat.attack.active, false);
  assert.equal(combat.attack.sequence, 1);
  assert.equal(combat.attack.cancelled, true);
  close(combat.attack.elapsed, 0.29);
  assert.equal(combat.requestAttack(), true);
  assert.equal(combat.attack.cancelled, false);
  assert.equal(combat.attack.exitReason, null);
});

test("holding Block does not continually restart interruption recovery", () => {
  const combat = new CombatController();
  combat.requestAttack();
  combat.update(0.15);
  combat.setBlocking(true);
  for (let frame = 0; frame < 60; frame++) {
    combat.setBlocking(true);
    combat.update(1 / 60);
  }
  assert.equal(combat.attack.active, false);
  assert.equal(combat.blocking, true);
  combat.setBlocking(false);
  assert.equal(combat.requestAttack(), true);
});

test("Block during ordinary recovery preserves reach without another extension", () => {
  const combat = new CombatController();
  combat.requestAttack();
  combat.update(0.26);
  const reach = combat.attack.extension;
  assert.ok(reach > 0 && reach < 1);
  combat.setBlocking(true);
  close(combat.attack.extension, reach);
  let previous = reach;
  for (let frame = 0; frame < 20; frame++) {
    combat.update(1 / 60);
    assert.ok(combat.attack.extension <= previous);
    previous = combat.attack.extension;
  }
  assert.equal(combat.attack.active, false);
});

test("Block during windup cancels before any arm extension", () => {
  const combat = new CombatController();
  combat.requestAttack();
  combat.update(0.04);
  combat.setBlocking(true);
  combat.setBlocking(false);
  combat.update(0.08);
  close(combat.attack.extension, 0);
  assert.equal(combat.attack.phase, "recovery");
  assert.equal(combat.requestAttack(), false);
  combat.update(0.08);
  assert.equal(combat.attack.active, false);
  assert.equal(combat.requestAttack(), true);
});

test("reset and stop release Block and cancel smoothly without queued attacks", () => {
  for (const method of ["reset", "stop"]) {
    const combat = new CombatController();
    combat.requestAttack();
    combat.update(0.13);
    const reach = combat.attack.extension;
    combat[method]();
    close(combat.attack.extension, reach);
    assert.equal(combat.attack.cancelled, true);
    assert.equal(combat.attack.exitReason, "cancelled");
    combat.update(0.08);
    close(combat.attack.extension, reach / 2);
    combat[method](); // repeated focus-loss cleanup must not prolong recovery
    combat.update(0.08);
    assert.equal(combat.attack.active, false);
    combat.update(5);
    assert.equal(combat.attack.sequence, 1);
    combat.setBlocking(true);
    combat[method]();
    assert.equal(combat.blocking, false);
    assert.equal(combat.ready, true);
  }
});

test("long updates consume all action stages and remaining posture time", () => {
  const combat = new CombatController();
  combat.requestAttack();
  combat.update(0.55);
  assert.equal(combat.attack.active, false);
  assert.equal(combat.postureActive, true);
  combat.update(0.02);
  assert.equal(combat.postureActive, false);
  close(combat.attack.elapsed, 0.42);
  combat.requestAttack();
  combat.update(10);
  assert.equal(combat.attack.sequence, 2);
  assert.equal(combat.attack.active, false);
  assert.equal(combat.postureActive, false);
});

test("30Hz, 60Hz, 144Hz and irregular frames produce the same punch timing", () => {
  const reference = new CombatController();
  reference.requestAttack();
  const sampleTimes = [0.04, 0.08, 0.105, 0.13, 0.18, 0.3, 0.42, 0.5, 0.57];
  const expected = [];
  let previous = 0;
  for (const time of sampleTimes) {
    reference.update(time - previous);
    expected.push({ ...reference.attack, posture: reference.postureActive });
    previous = time;
  }
  for (const steps of [
    [1 / 30],
    [1 / 60],
    [1 / 144],
    [0.019, 0.041, 0.007, 0.083],
  ]) {
    const combat = new CombatController();
    combat.requestAttack();
    let previousTime = 0;
    for (const [index, time] of sampleTimes.entries()) {
      advance(combat, time - previousTime, steps);
      const sample = expected[index];
      assert.equal(combat.attack.active, sample.active);
      assert.equal(combat.attack.phase, sample.phase);
      assert.equal(combat.postureActive, sample.posture);
      close(combat.attack.extension, sample.extension);
      close(combat.attack.phaseProgress, sample.phaseProgress);
      close(combat.attack.elapsed, sample.elapsed);
      previousTime = time;
    }
  }
});

test("cancellation is deterministic across frame rates and long updates", () => {
  for (const steps of [[1 / 30], [1 / 60], [1 / 144], [0.051, 0.007, 0.021]]) {
    const combat = new CombatController();
    combat.requestAttack();
    advance(combat, 0.13, steps);
    combat.setBlocking(true);
    combat.setBlocking(false);
    advance(combat, 0.08, steps);
    close(combat.attack.extension, 0.25);
    advance(combat, 0.08, steps);
    assert.equal(combat.attack.active, false);
    close(combat.attack.elapsed, 0.29);
    advance(combat, 0.15, steps);
    assert.equal(combat.postureActive, false);
  }
});

test("zero, negative and nonfinite deltas leave combat state unchanged", () => {
  const combat = new CombatController();
  combat.requestAttack();
  combat.update(0.13);
  const before = { ...combat.attack };
  for (const dt of [0, -1, NaN, Infinity, -Infinity, undefined])
    combat.update(dt);
  assert.deepEqual(combat.attack, before);
});

test("technique selection runs once on accepted entry using immutable context", () => {
  const observed = [];
  const combat = new CombatController({
    selectTechnique(context, registry) {
      assert.ok(registry.has(BASIC_PUNCH.id));
      observed.push(context);
      return BASIC_PUNCH.id;
    },
  });
  const context = {
    speed: 5.2,
    movementDirection: { x: 0.6, z: -0.8 },
    facing: 0.4,
    dashActive: true,
    opponentDistance: null,
    availableTechniques: [BASIC_PUNCH.id],
  };
  assert.equal(combat.requestAttack(context), true);
  assert.equal(observed.length, 1);
  assert.deepEqual(observed[0], context);
  assert.notStrictEqual(observed[0], context);
  assert.ok(Object.isFrozen(observed[0]));
  assert.ok(Object.isFrozen(observed[0].movementDirection));
  assert.ok(Object.isFrozen(observed[0].availableTechniques));
  assert.throws(() => {
    observed[0].movementDirection.x = 2;
  }, TypeError);
  context.movementDirection.x = -1;
  assert.equal(observed[0].movementDirection.x, 0.6);
  for (let frame = 0; frame < 10; frame++) {
    assert.equal(combat.requestAttack(context), false);
    combat.update(0.01);
  }
  assert.equal(observed.length, 1);
  assert.strictEqual(combat.attack.context, observed[0]);
  assert.equal(Object.isFrozen(context), false);
});

test("the technique registry supports later timing definitions without branching the state machine", () => {
  const injected = {
    id: "test-fixture",
    windup: 0.02,
    extension: 0.04,
    recovery: 0.08,
  };
  const registry = new Map([
    [BASIC_PUNCH.id, BASIC_PUNCH],
    [injected.id, injected],
  ]);
  const combat = new CombatController({
    techniques: registry,
    selectTechnique: () => injected.id,
    postureHold: 0.03,
    cancelRecovery: 0.02,
  });
  assert.equal(combat.requestAttack(), true);
  assert.equal(combat.attack.techniqueId, injected.id);
  injected.extension = 99;
  combat.update(0.04);
  close(combat.attack.extension, 0.5);
  combat.update(0.1);
  assert.equal(combat.attack.active, false);
  close(combat.attack.elapsed, 0.14);
  combat.update(0.03);
  assert.equal(combat.postureActive, false);
});

test("an unavailable selection does not consume an attack or change posture", () => {
  const combat = new CombatController({
    selectTechnique: () => "not-available",
  });
  assert.equal(combat.requestAttack(), false);
  assert.equal(combat.ready, true);
  assert.equal(combat.postureActive, false);
  assert.equal(combat.attack.sequence, 0);
  assert.equal(combat.attack.context, null);
});

test("tunable zero-length stages transition safely without freezing", () => {
  const combat = new CombatController({
    techniques: [
      { id: BASIC_PUNCH.id, windup: 0, extension: 0, recovery: 0.1 },
    ],
    cancelRecovery: 0,
    postureHold: 0,
  });
  combat.requestAttack();
  combat.update(0.05);
  assert.equal(combat.attack.phase, "recovery");
  close(combat.attack.extension, 0.5);
  combat.setBlocking(true);
  combat.update(0.001);
  assert.equal(combat.attack.active, false);
  combat.setBlocking(false);
  assert.equal(combat.postureActive, false);
});

test("invalid durations are rejected rather than poisoning animation state", () => {
  for (const value of [-1, Infinity, NaN]) {
    assert.throws(
      () => new CombatController({ postureHold: value }),
      RangeError,
    );
    assert.throws(
      () => new CombatController({ cancelRecovery: value }),
      RangeError,
    );
    assert.throws(
      () =>
        new CombatController({
          techniques: [{ ...BASIC_PUNCH, extension: value }],
        }),
      RangeError,
    );
  }
  assert.throws(() => new CombatController({ techniques: [] }), RangeError);
  assert.throws(
    () =>
      new CombatController({
        techniques: [{ id: "empty", windup: 0, extension: 0, recovery: 0 }],
      }),
    RangeError,
  );
});

test("attacking and blocking never change walking or sprinting displacement", () => {
  for (const sprinting of [false, true]) {
    const baselineRoot = new Group();
    const combatRoot = new Group();
    const baseline = new CharacterController(
      baselineRoot,
      new ArenaBounds(100),
    );
    const movement = new CharacterController(combatRoot, new ArenaBounds(100));
    const combat = new CombatController();
    const input = { move: { x: 0.6, y: 0.8 }, sprinting };
    combat.requestAttack({
      speed: 0,
      movementDirection: input.move,
      dashActive: false,
    });
    for (let frame = 0; frame < 90; frame++) {
      if (frame === 40) combat.setBlocking(true);
      if (frame === 65) combat.setBlocking(false);
      baseline.update(1 / 60, input, 0.5);
      movement.update(1 / 60, input, 0.5);
      combat.update(1 / 60);
      assert.ok(combatRoot.position.equals(baselineRoot.position));
      assert.ok(combatRoot.quaternion.equals(baselineRoot.quaternion));
      close(movement.speed, baseline.speed);
    }
    assert.deepEqual(input, { move: { x: 0.6, y: 0.8 }, sprinting });
  }
});

test("punches and Block preserve a continuously steering dash", () => {
  const baselineRoot = new Group();
  const combatRoot = new Group();
  const baseline = new CharacterController(baselineRoot, new ArenaBounds(100));
  const movement = new CharacterController(combatRoot, new ArenaBounds(100));
  const combat = new CombatController();
  baseline.requestDash();
  movement.requestDash();
  combat.requestAttack({ speed: 5.2, dashActive: true });
  for (let frame = 0; frame < 60; frame++) {
    const input = {
      move: frame < 5 ? { x: 0, y: 1 } : { x: 1, y: 0 },
      sprinting: true,
    };
    if (frame === 8) combat.setBlocking(true);
    if (frame === 20) combat.setBlocking(false);
    baseline.update(1 / 120, input, 0);
    movement.update(1 / 120, input, 0);
    combat.update(1 / 120);
    assert.ok(combatRoot.position.equals(baselineRoot.position));
    assert.ok(movement.dash.direction.equals(baseline.dash.direction));
    assert.equal(movement.dash.active, baseline.dash.active);
    close(movement.dash.distanceTravelled, baseline.dash.distanceTravelled);
    close(movement.dash.cooldownRemaining, baseline.dash.cooldownRemaining);
  }
  assert.ok(combatRoot.position.x > 0.5);
  assert.ok(combatRoot.position.z < -0.5);
});

test("movement cancellation preserves current reach and completes smooth recovery", () => {
  const combat = new CombatController();
  combat.requestAttack();
  combat.update(0.13);
  const reach = combat.attack.extension;
  combat.cancelAttack();
  close(combat.attack.extension, reach);
  assert.equal(combat.attack.phase, "recovery");
  assert.equal(combat.attack.cancelled, true);
  assert.equal(combat.attack.exitReason, "movement");
  combat.update(0.08);
  close(combat.attack.extension, reach / 2);
  combat.cancelAttack();
  combat.update(0.08);
  assert.equal(combat.attack.active, false);
  assert.equal(combat.attack.sequence, 1);
  close(combat.attack.extension, 0);
  // Cleanup itself does not save another strike for when recovery ends.
  combat.update(1);
  assert.equal(combat.attack.sequence, 1);
});

test("public attack cancellation keeps held Block and supports explicit reasons", () => {
  const combat = new CombatController();
  combat.setBlocking(true);
  combat.cancelAttack("jump");
  assert.equal(combat.blocking, true);
  assert.equal(combat.ready, false);
  assert.equal(combat.attack.active, false);
  combat.setBlocking(false);
  combat.requestAttack();
  combat.update(0.12);
  combat.cancelAttack("jump");
  assert.equal(combat.attack.exitReason, "jump");
  combat.setBlocking(true);
  combat.cancelAttack();
  combat.update(0.16);
  assert.equal(combat.blocking, true);
  assert.equal(combat.attack.active, false);
  assert.equal(combat.attack.exitReason, "jump");
});
