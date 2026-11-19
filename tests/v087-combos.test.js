import test from "node:test";
import assert from "node:assert/strict";
import {
  createAdaptiveTechniques,
  ContextualLimbSelector,
} from "../src/combat/AdaptiveTechniques.js";
import { AttackScheduler } from "../src/combat/AttackScheduler.js";
import { CombatController } from "../src/combat/CombatController.js";
import { createManualTechniques } from "../src/combat/ManualTechniques.js";
import { COMBO_LIMITS } from "../src/combat/ComboFlow.js";

const total = (t) => t.windup + t.extension + t.impact + t.recovery;
const context = (extra = {}) => ({
  clock: 0,
  environment: "ground",
  canAttack: true,
  speed: 0,
  rotationRate: [0, 0, 0],
  lateralMovement: 0,
  limbs: {
    left: { elbow: 1.7, planted: true },
    right: { elbow: 1.7, planted: true },
  },
  ...extra,
});
const fixture = (extra = {}) => {
  const selector = new ContextualLimbSelector(),
    combat = new CombatController({
      techniques: createAdaptiveTechniques(),
      selectTechnique: (ctx, eligible) => selector.choose(ctx, eligible),
    });
  return {
    selector,
    combat,
    scheduler: new AttackScheduler(combat),
    context: context(extra),
    starts: [],
  };
};
function prepare(f, blocking = false) {
  const accepted = f.scheduler.prepare(f.context, blocking);
  if (accepted)
    f.starts.push({
      clock: f.context.clock,
      duration: total(f.combat.currentTechnique),
      id: f.combat.attack.techniqueId,
      side: f.combat.currentTechnique.side,
    });
  return accepted;
}
function advance(f, dt, blocking = false) {
  let remaining = dt;
  while (remaining > 1e-9) {
    prepare(f, blocking);
    const step = Math.min(remaining, Math.max(1e-8, f.combat.timeToBoundary));
    f.combat.update(step);
    f.context.clock += step;
    remaining -= step;
  }
}
function press(f, action) {
  f.scheduler.press(action);
  return prepare(f);
}
function recover(f) {
  const t = f.combat.currentTechnique;
  advance(
    f,
    Math.max(0, t.windup + t.extension + t.impact - f.combat.attack.elapsed) +
      0.02,
  );
  assert.equal(f.combat.attack.phase, "recovery");
}

test("v087 extends only the adaptive registry with explicit animation style contracts", () => {
  const adaptive = createAdaptiveTechniques(),
    manual = createManualTechniques();
  assert.equal(adaptive.length, 14);
  assert.equal(manual.length, 4, "enemy/manual registry retains its defaults");
  for (const original of manual) {
    const t = adaptive.find((entry) => entry.id === original.id);
    for (const field of ["windup", "extension", "impact", "recovery", "reach"])
      assert.equal(t[field], original[field]);
  }
  for (const [id, animation, strikeStyle] of [
    ["cross-punch", "punch", "cross"],
    ["hook-punch", "punch", "hook"],
    ["roundhouse-kick", "ground-kick", "roundhouse"],
    ["side-kick", "ground-kick", "side"],
    ["spinning-kick", "ground-kick", "spinning"],
    ["low-sweep", "ground-kick", "sweep"],
  ]) {
    const t = adaptive.find((entry) => entry.id === id);
    assert.equal(t.animation, animation);
    assert.equal(t.strikeStyle, strikeStyle);
    assert.ok(Object.isFrozen(t) && t.adaptive && t.hitRadius < t.reach);
    assert.ok(t.transitionAfter > 0 && total(t) > 0.4);
  }
  for (const id of ["whip-kick", "descending-sweep", "rotational-backhand"])
    assert.ok(adaptive.some((t) => t.id === id));
});

test("one manual tap performs one strike; movement and proximity cannot start a combo", () => {
  for (const action of ["punch", "kick"]) {
    const f = fixture({ opponentDistance: 0.2, speed: 25 });
    advance(f, 1);
    assert.equal(f.combat.attack.sequence, 0);
    f.scheduler.press(action);
    f.scheduler.setHeld(action, true);
    f.scheduler.setHeld(action, false);
    advance(f, 3);
    assert.equal(f.combat.attack.sequence, 1);
    assert.equal(f.combat.attack.active, false);
    assert.equal(f.combat.attack.context.source, "manual");
    assert.equal(f.combat.attack.context.inputKind, "press");
  }
});

test("Punch → Punch → Kick branches through a cross into a roundhouse at recovery", () => {
  const f = fixture();
  assert.ok(press(f, "punch"));
  assert.equal(f.combat.attack.techniqueId, "basic-punch");
  recover(f);
  assert.ok(press(f, "punch"));
  assert.equal(f.combat.attack.techniqueId, "cross-punch");
  assert.equal(f.combat.lastTransition.kind, "cancellation");
  recover(f);
  assert.ok(press(f, "kick"));
  assert.equal(f.combat.attack.techniqueId, "roundhouse-kick");
  assert.equal(f.combat.lastTransition.kind, "continuation");
  assert.deepEqual(
    f.selector.combo.history.map((entry) => entry.action),
    ["punch", "punch", "kick"],
  );
});

test("Kick → Punch → Kick uses a settled sweep finish and a moving roundhouse finish", () => {
  for (const speed of [0, 6]) {
    const f = fixture({ speed });
    assert.ok(press(f, "kick"));
    recover(f);
    assert.ok(press(f, "punch"));
    assert.equal(f.combat.attack.techniqueId, "cross-punch");
    recover(f);
    assert.ok(press(f, "kick"));
    assert.equal(
      f.combat.attack.techniqueId,
      speed === 0 ? "low-sweep" : "roundhouse-kick",
    );
  }
});

test("lateral input and existing rotation choose side kicks, hooks and spinning kicks", () => {
  const side = fixture({ lateralMovement: -1 });
  assert.ok(press(side, "kick"));
  assert.equal(side.combat.attack.techniqueId, "side-kick");
  assert.equal(side.combat.currentTechnique.side, "left");
  recover(side);
  assert.ok(press(side, "punch"));
  assert.equal(side.combat.attack.techniqueId, "hook-punch");

  const rotation = [0, 8, 0],
    spinning = fixture({ rotationRate: rotation, rotationActive: true });
  assert.ok(press(spinning, "kick"));
  assert.equal(spinning.combat.attack.techniqueId, "spinning-kick");
  assert.deepEqual(rotation, [0, 8, 0], "selection does not change momentum");
  recover(spinning);
  assert.ok(press(spinning, "punch"));
  assert.equal(spinning.combat.attack.techniqueId, "rotational-backhand");
});

test("ordinary Kick → lateral hook → Kick can finish with a supported spin at zero body rotation", () => {
  for (const direction of [-1, 1])
    for (const supported of [false, true]) {
      const rotation = [0, 0, 0],
        f = fixture({ rotationRate: rotation });
      assert.ok(press(f, "kick"));
      assert.equal(f.combat.attack.techniqueId, "front-kick");
      recover(f);
      f.context.lateralMovement = direction * 0.5;
      assert.ok(press(f, "punch"));
      assert.equal(f.combat.attack.techniqueId, "hook-punch");
      recover(f);
      f.context.limbs.left.planted = supported;
      f.context.limbs.right.planted = supported;
      assert.ok(press(f, "kick"));
      assert.equal(
        f.combat.attack.techniqueId,
        supported ? "spinning-kick" : "low-sweep",
      );
      assert.equal(
        f.combat.currentTechnique.side,
        direction < 0 ? "left" : "right",
      );
      assert.deepEqual(rotation, [0, 0, 0]);
      assert.equal(f.combat.attack.context.source, "manual");
      assert.equal(f.combat.attack.context.inputKind, "press");
      const count = f.combat.attack.sequence;
      advance(f, 2);
      assert.equal(
        f.combat.attack.sequence,
        count,
        "the lateral cue cannot start another strike",
      );
    }
});

test("held combos wait for every full authored recovery at 30, 60 and 144 Hz", () => {
  for (const action of ["punch", "kick"])
    for (const fps of [30, 60, 144]) {
      const f = fixture();
      f.scheduler.press(action);
      f.scheduler.setHeld(action, true);
      for (let n = 0; n < fps * 4; n++) advance(f, 1 / fps);
      assert.ok(new Set(f.starts.map((entry) => entry.id)).size >= 3);
      for (let n = 1; n < f.starts.length; n++)
        assert.ok(
          f.starts[n].clock >=
            f.starts[n - 1].clock + f.starts[n - 1].duration - 1e-8,
          "holding cannot use the shorter tap interruption window",
        );
      const count = f.combat.attack.sequence;
      f.scheduler.setHeld(action, false);
      advance(f, 2);
      assert.equal(f.combat.attack.sequence, count);
      assert.ok(f.selector.combo.history.length <= COMBO_LIMITS.history);
    }
});

test("early taps are rejected and discarded; accepted recovery branches respect transition cooldown", () => {
  const f = fixture();
  press(f, "punch");
  advance(f, 0.02);
  for (let n = 0; n < 10; n++) {
    assert.equal(press(f, n % 2 ? "punch" : "kick"), false);
    advance(f, 0.01);
  }
  assert.equal(f.combat.attack.sequence, 1);
  assert.equal(f.selector.combo.history.length, 1);
  advance(f, 1);
  assert.equal(f.combat.attack.sequence, 1, "rejected taps never replay later");

  press(f, "kick");
  recover(f);
  assert.ok(press(f, "punch"));
  const count = f.combat.attack.sequence;
  assert.equal(press(f, "kick"), false);
  assert.equal(f.combat.attack.sequence, count);
  advance(f, 2);
  assert.equal(f.combat.attack.sequence, count);
});

test("only the newest pending entry and independently released held action can take over", () => {
  const f = fixture();
  f.scheduler.press("punch");
  f.scheduler.press("kick");
  assert.ok(prepare(f));
  assert.equal(f.combat.currentTechnique.action, "kick");
  f.scheduler.setHeld("punch", true);
  f.scheduler.setHeld("kick", true);
  advance(f, 0.7);
  assert.equal(f.combat.currentTechnique.action, "kick");
  f.scheduler.setHeld("kick", false);
  advance(f, 0.7);
  assert.equal(f.combat.currentTechnique.action, "punch");
  f.scheduler.setHeld("punch", false);
  const count = f.combat.attack.sequence;
  advance(f, 2);
  assert.equal(f.combat.attack.sequence, count);
});

test("Block has immediate priority, consumes pending taps and breaks the combo before held resumption", () => {
  const f = fixture();
  press(f, "kick");
  recover(f);
  f.scheduler.setHeld("punch", true);
  f.scheduler.press("punch");
  assert.equal(prepare(f, true), false);
  assert.ok(f.combat.blocking && f.combat.attack.cancelled);
  assert.equal(f.combat.attack.exitReason, "blocked");
  advance(f, 0.5, true);
  assert.equal(f.combat.attack.sequence, 1);
  assert.ok(prepare(f, false));
  assert.equal(f.combat.attack.techniqueId, "basic-punch");
  assert.equal(f.selector.combo.history.length, 1);
  f.scheduler.setHeld("punch", false);
  advance(f, 1);
  assert.equal(f.combat.attack.sequence, 2);
});

test("air punches/kicks remain manual and both limbs are usable through landing interruption", () => {
  for (const action of ["punch", "kick"])
    for (const lateralMovement of [-1, 1]) {
      const f = fixture({
        environment: "air",
        height: 0.15,
        airTimeRemaining: 0.01,
        lateralMovement,
      });
      assert.ok(press(f, action));
      assert.equal(
        f.combat.attack.techniqueId,
        action === "punch" ? "aerial-punch" : "flying-kick",
      );
      assert.equal(
        f.combat.currentTechnique.side,
        lateralMovement < 0 ? "left" : "right",
      );
      f.context.environment = "ground";
      f.context.canAttack = false;
      assert.equal(prepare(f), false);
      assert.ok(f.combat.attack.cancelled);
      advance(f, 0.3);
      f.context.canAttack = true;
      f.context.lateralMovement = 0;
      assert.ok(press(f, "punch"));
      assert.equal(f.combat.attack.techniqueId, "basic-punch");
      assert.equal(f.selector.combo.history.length, 1);
    }
});

test("clock expiry, clock reset and scheduler reset clear bounded combo context", () => {
  const f = fixture();
  f.scheduler.setHeld("punch", true);
  advance(f, 5);
  f.scheduler.setHeld("punch", false);
  assert.equal(f.selector.combo.history.length, COMBO_LIMITS.history);
  advance(f, 2);
  press(f, "punch");
  assert.equal(f.combat.attack.techniqueId, "basic-punch");
  assert.equal(f.selector.combo.history.length, 1);
  advance(f, 0.6);
  f.context.clock = 0;
  press(f, "punch");
  assert.equal(f.combat.attack.techniqueId, "basic-punch");
  assert.equal(f.selector.combo.history.length, 1);
  advance(f, 0.6);
  f.scheduler.reset();
  press(f, "punch");
  assert.equal(f.combat.attack.techniqueId, "basic-punch");
  assert.equal(f.selector.combo.history.length, 1);
});

test("limb choice responds to posture and direction without forced alternation", () => {
  for (const action of ["punch", "kick"])
    for (const lateralMovement of [0, -1, 1]) {
      const f = fixture({ lateralMovement });
      f.scheduler.setHeld(action, true);
      advance(f, 4);
      const sides = new Set(f.starts.map((entry) => entry.side));
      if (lateralMovement === 0)
        assert.deepEqual(sides, new Set(["right", "left"]));
      else
        assert.deepEqual(
          sides,
          new Set([lateralMovement < 0 ? "left" : "right"]),
        );
    }
});
