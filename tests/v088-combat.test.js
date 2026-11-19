import test from "node:test";
import assert from "node:assert/strict";
import { Vector3 } from "three";
import { CombatController } from "../src/combat/CombatController.js";
import { AttackScheduler } from "../src/combat/AttackScheduler.js";
import {
  createAdaptiveTechniques,
  ContextualLimbSelector,
} from "../src/combat/AdaptiveTechniques.js";
import { StrikeHitDetector } from "../src/combat/StrikeHitDetector.js";
import { StrikePoseSampler } from "../src/combat/TechniqueGeometry.js";
import { JumpState } from "../src/movement/JumpState.js";
import { updateCombatContext } from "../src/combat/CombatContext.js";

const total = (t) => t.windup + t.extension + t.impact + t.recovery;
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} ≈ ${b}`);
function fixture(extra = {}) {
  const selector = new ContextualLimbSelector();
  const combat = new CombatController({
    techniques: createAdaptiveTechniques(),
    selectTechnique: (context, eligible) => selector.choose(context, eligible),
  });
  return {
    combat,
    selector,
    scheduler: new AttackScheduler(combat),
    context: {
      clock: 0,
      environment: "ground",
      canAttack: true,
      height: 0,
      airTimeRemaining: 0,
      rotationRate: [0, 0, 0],
      movementDirection: [0, 0, 0],
      lateralMovement: 0,
      limbs: {
        left: { elbow: 1.7, planted: true },
        right: { elbow: 1.7, planted: true },
      },
      ...extra,
    },
  };
}
function press(f, action, blocking = false) {
  f.scheduler.press(action);
  return f.scheduler.prepare(f.context, blocking);
}
function advance(f, dt, blocking = false) {
  let remaining = dt,
    slices = 0;
  while (remaining > 1e-9) {
    assert.ok(++slices < 30, "a held windup cannot spin on epsilon boundaries");
    f.scheduler.prepare(f.context, blocking);
    const step = Math.min(remaining, Math.max(1e-8, f.combat.timeToBoundary));
    f.combat.update(step);
    f.context.clock += step;
    remaining -= step;
  }
  return slices;
}

test("v088 approach consumes wall time while its strike remains at the windup edge", () => {
  for (const rate of [30, 60, 144]) {
    const f = fixture();
    assert.equal(f.combat.holdWindup, false);
    assert.ok(press(f, "punch"));
    const technique = f.combat.currentTechnique;
    f.combat.holdWindup = true;
    for (let n = 0; n < rate * 2; n++) advance(f, 1 / rate);
    assert.equal(f.combat.attack.phase, "windup");
    assert.equal(f.combat.attack.phaseProgress, 1);
    assert.equal(f.combat.attack.extension, 0);
    close(f.combat.attack.elapsed, technique.windup);
    assert.equal(f.combat.timeToBoundary, Infinity);
    assert.equal(advance(f, 5), 1);
    close(f.combat.sampleEndTime(5), technique.windup);
    f.combat.holdWindup = false;
    advance(f, technique.extension / 2);
    assert.equal(f.combat.attack.phase, "extension");
    close(f.combat.attack.phaseProgress, 0.5);
    advance(f, technique.extension / 2 + technique.impact + technique.recovery);
    assert.equal(f.combat.attack.active, false);
    assert.equal(f.combat.attack.exitReason, "completed");
  }
});

test("v088 long and irregular held updates never leak into active contact time", () => {
  const f = fixture();
  press(f, "kick");
  f.combat.holdWindup = true;
  const t = f.combat.currentTechnique,
    origin = new Vector3(),
    target = {
      id: "chamber-target",
      position: new StrikePoseSampler().sample(
        new Vector3(), origin, 0, t, t.windup, f.combat.attack.context,
      ),
      strikeHeight: 0,
      strikeRadius: 0.1,
      active: true,
    },
    detector = new StrikeHitDetector({ targets: [target] });
  for (const dt of [0.017, 0.003, 0.14, 1.5, 4]) {
    const start = f.combat.attack.elapsed;
    detector.sweep(t, f.combat.attack, start, f.combat.sampleEndTime(dt), origin, origin, 0, 0);
    f.combat.update(dt);
  }
  assert.equal(detector.count, 0, "a nearby chambered foot is never an active hit");
  close(f.combat.attack.elapsed, t.windup);
  assert.equal(f.combat.timeToBoundary, Infinity);
  f.combat.holdWindup = false;
  detector.sweep(t, f.combat.attack, t.windup, f.combat.sampleEndTime(0.001), origin, origin, 0, 0);
  assert.equal(detector.count, 1, "physical overlap is queried only after release");
});

test("v088 a fresh approach entry redirects immediately; held inputs never stack strikes", () => {
  const f = fixture({ freeflowRedirect: true });
  assert.ok(press(f, "punch"));
  f.combat.holdWindup = true;
  advance(f, 0.01);
  f.scheduler.setHeld("punch", true);
  f.scheduler.setHeld("kick", true);
  assert.ok(press(f, "kick"));
  assert.equal(f.combat.attack.sequence, 2);
  assert.equal(f.combat.currentTechnique.action, "kick");
  assert.equal(f.combat.lastTransition.kind, "redirection");
  assert.equal(f.combat.attack.elapsed, 0);
  assert.ok(press(f, "punch"), "another fresh entry can change the approach again");
  assert.equal(f.combat.attack.sequence, 3);
  advance(f, 2);
  assert.equal(f.combat.attack.sequence, 3, "holds cannot redirect a chambered strike");
  const t = f.combat.currentTechnique;
  f.combat.holdWindup = false;
  advance(f, t.extension + t.impact + t.recovery - 0.001);
  assert.equal(f.combat.attack.sequence, 3);
  assert.equal(f.combat.attack.phase, "recovery");
  advance(f, 0.002);
  assert.equal(f.combat.attack.sequence, 4);
  assert.equal(f.combat.attack.context.inputKind, "hold");
});

test("v088 approach redirection is opt-in and discarded taps cannot replay later", () => {
  for (const freeflowRedirect of [undefined, false]) {
    const f = fixture({ freeflowRedirect });
    press(f, "punch");
    advance(f, 0.01);
    assert.equal(press(f, "kick"), false);
    advance(f, 1);
    assert.equal(f.combat.attack.sequence, 1);
  }
  const f = fixture({ freeflowRedirect: true });
  press(f, "punch");
  advance(f, 0.1);
  assert.equal(press(f, "kick"), false, "committed extension retains its ordinary lock");
  assert.equal(f.combat.transitionAttack({ ...f.context, action: "kick", inputKind: "hold" }), false);
  advance(f, 1);
  assert.equal(f.combat.attack.sequence, 1);
});

test("v088 Block cancels a held approach immediately and consumes the fresh redirect", () => {
  const f = fixture({ freeflowRedirect: true });
  press(f, "punch");
  f.combat.holdWindup = true;
  advance(f, 1);
  assert.equal(press(f, "kick", true), false);
  assert.equal(f.combat.attack.cancelled, true);
  assert.equal(f.combat.attack.exitReason, "blocked");
  assert.equal(f.combat.attack.phase, "recovery");
  assert.equal(f.combat.timeToBoundary, f.combat.config.cancelRecovery);
  advance(f, 1, true);
  assert.equal(f.combat.attack.active, false);
  f.scheduler.prepare(f.context, false);
  assert.equal(f.combat.attack.sequence, 1);
  f.combat.reset();
  assert.equal(f.combat.holdWindup, false);
});

test("v088 ground and air inputs share bounded combo history while current eligibility stays physical", () => {
  const f = fixture();
  press(f, "punch");
  advance(f, total(f.combat.currentTechnique));
  Object.assign(f.context, { environment: "air", height: 1, airTimeRemaining: 1 });
  assert.ok(press(f, "kick"));
  assert.equal(f.combat.attack.techniqueId, "bicycle-kick");
  assert.deepEqual(f.selector.combo.history.map((entry) => entry.environment), ["ground", "air"]);
  advance(f, total(f.combat.currentTechnique));
  Object.assign(f.context, { environment: "ground", height: 0, airTimeRemaining: 0 });
  assert.ok(press(f, "punch"));
  assert.equal(f.combat.attack.techniqueId, "cross-punch");
  assert.equal(f.selector.combo.history.length, 3);
  assert.ok(f.combat.currentTechnique.environments.includes("ground"));
});

test("v088 a fresh airborne approach redirect uses its new environment before incompatible cancellation", () => {
  const f = fixture({ freeflowRedirect: true });
  press(f, "punch");
  f.combat.holdWindup = true;
  advance(f, 0.01);
  Object.assign(f.context, { environment: "air", height: 1, airTimeRemaining: 1 });
  assert.ok(press(f, "kick"));
  assert.equal(f.combat.attack.techniqueId, "bicycle-kick");
  assert.equal(f.combat.attack.cancelled, false);
});

test("v088 a physical jump's takeoff suppresses attacks while preserving the ground-to-air chain", () => {
  const f = fixture(),
    movement = {
      velocity: new Vector3(), speed: 0, heading: 0,
      dash: { active: false }, jump: new JumpState(),
    };
  updateCombatContext(f.context, movement);
  press(f, "punch");
  advance(f, 0.21);
  assert.ok(movement.jump.start());
  updateCombatContext(f.context, movement);
  assert.equal(f.context.canAttack, false);
  assert.equal(press(f, "kick"), false, "takeoff never buffers a Kick");
  for (let n = 0; n < 36; n++) {
    movement.jump.advance(1 / 120);
    updateCombatContext(f.context, movement);
    advance(f, 1 / 120);
  }
  assert.equal(f.context.environment, "air");
  assert.equal(f.combat.attack.active, false);
  assert.equal(f.combat.attack.sequence, 1);
  assert.ok(press(f, "kick"));
  assert.equal(f.combat.attack.techniqueId, "bicycle-kick");
  assert.equal(f.selector.combo.history.length, 2);
});

test("v088 bicycle remains contextual and short-airtime kicks keep their responsive ordinary entry", () => {
  const isolated = fixture({ environment: "air", height: 1, airTimeRemaining: 1 });
  press(isolated, "kick");
  assert.equal(isolated.combat.attack.techniqueId, "flying-kick");
  for (const [height, airTimeRemaining] of [[0.05, 1], [1, 0.1]]) {
    const f = fixture({ environment: "air", height, airTimeRemaining });
    press(f, "punch");
    advance(f, total(f.combat.currentTechnique));
    assert.ok(press(f, "kick"));
    assert.equal(f.combat.attack.techniqueId, "flying-kick");
  }
});
