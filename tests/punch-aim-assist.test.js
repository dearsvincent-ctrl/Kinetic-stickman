import test from "node:test";
import assert from "node:assert/strict";
import { Group, Quaternion, Vector3 } from "three";
import {
  PunchAimAssist,
  AIM_ASSIST_DEFAULTS,
  AIM_ASSIST_LIMITS,
  sanitizeAimAssist,
} from "../src/combat/PunchAimAssist.js";
import {
  punchAlignmentQuaternion,
  UPPER_BODY_PIVOT,
} from "../src/combat/PunchAlignment.js";
import {
  createAdaptiveTechniques,
  ContextualLimbSelector,
} from "../src/combat/AdaptiveTechniques.js";
import {
  sampleLocalStrike,
  StrikePoseSampler,
} from "../src/combat/TechniqueGeometry.js";
import { Combatant } from "../src/combat/Combatant.js";
import { StrikeHitDetector } from "../src/combat/StrikeHitDetector.js";
import { CombatController } from "../src/combat/CombatController.js";
import { AttackScheduler } from "../src/combat/AttackScheduler.js";
import { CharacterController } from "../src/movement/CharacterController.js";
import { BodyRotation } from "../src/movement/BodyRotation.js";
import { ArenaBounds } from "../src/world/ArenaBounds.js";
import { Stickman } from "../src/character/Stickman.js";
import { CharacterAnimator } from "../src/character/CharacterAnimator.js";
import { AcrobaticPresenter } from "../src/character/AcrobaticPresenter.js";
import { createCombatContext } from "../src/combat/CombatContext.js";
import {
  sandboxMovementConfig,
  movementSubsteps,
} from "../src/sandbox/PhysicsSandbox.js";
import { Game } from "../src/core/Game.js";
const RAD = Math.PI / 180;
const techniques = createAdaptiveTechniques();
const punch = (side) => ({
  ...techniques.find((t) => t.id === "basic-punch"),
  side: side ?? "right",
});
const enemy = (id, x, z, velocity = new Vector3()) => ({
  spawned: true,
  body: new Combatant(id, new Vector3(x, 0, z)),
  controller: { velocity },
});
const close = (a, b, e = 1e-8) => assert.ok(Math.abs(a - b) < e, `${a} ≈ ${b}`);
function aim(targets, config = {}, motion = {}) {
  const a = new PunchAimAssist({ targets, config });
  a.setMotion({ position: new Vector3(), ...motion });
  return a;
}
function contacts(
  t,
  context,
  targets,
  {
    root = new Vector3(),
    end = root,
    orientation = null,
    from = 0,
    to = 0.3,
  } = {},
) {
  const d = new StrikeHitDetector({ targets: targets.map((e) => e.body ?? e) });
  const attack = { sequence: 1, active: true, cancelled: false, context };
  d.sweep(t, attack, from, to, root, end, 0, 0, orientation, orientation);
  return d;
}
test("default assistance is 20%, max correction 12 degrees and a narrow 25-degree half-cone with safe independent bounds", () => {
  assert.deepEqual(sanitizeAimAssist(), AIM_ASSIST_DEFAULTS);
  const c = sanitizeAimAssist({
    strength: Infinity,
    maxAngle: 300,
    cone: -100,
    debug: "true",
  });
  assert.equal(c.strength, 0.2);
  assert.equal(c.maxAngle, 20);
  assert.equal(c.cone, 5);
  assert.equal(c.debug, false);
  assert.equal(sanitizeAimAssist({ strength: -10 }).strength, 0);
  assert.equal(sanitizeAimAssist({ strength: 200 }).strength, 1);
});
test("0% bypasses acquisition and returns the exact unmodified execution context and trajectories", () => {
  const a = aim([enemy("near", 0.32, -0.91)], { strength: 0 }),
    ctx = Object.freeze({ environment: "ground", clock: 1 });
  assert.equal(a.prepare(ctx, punch()), ctx);
  assert.equal(a.queries, 0);
  assert.equal(a.last, null);
  for (const time of [0, 0.04, 0.08, 0.12, 0.18, 0.3])
    assert.deepEqual(
      sampleLocalStrike(new Vector3(), punch(), time, ctx),
      sampleLocalStrike(new Vector3(), punch(), time, a.prepare(ctx, punch())),
    );
});
test("acquisition requires an accepted manual punch, not walking, nearby enemies, Kick or held Block", () => {
  const a = aim([enemy("near", 0.32, -0.91)]),
    c = new CombatController({
      techniques,
      prepareAttackContext: (ctx, t) => a.prepare(ctx, t),
    }),
    s = new AttackScheduler(c);
  for (let n = 0; n < 100; n++) {
    s.prepare({ environment: "ground", canAttack: true });
    c.update(1 / 60);
  }
  assert.equal(a.queries, 0);
  s.press("kick");
  s.prepare({ environment: "ground", canAttack: true });
  assert.equal(a.queries, 0);
  c.update(2);
  s.press("punch");
  s.prepare({ environment: "ground", canAttack: true }, true);
  assert.equal(a.queries, 0);
  assert.ok(c.blocking);
  s.prepare({ environment: "ground", canAttack: true }, false);
  assert.equal(a.queries, 0);
  s.press("punch");
  assert.ok(s.prepare({ environment: "ground", canAttack: true }));
  assert.equal(a.queries, 1);
});
test("target priority follows the actual hand trajectory instead of the nearest root", () => {
  const nearer = enemy("nearer", 0.25, -0.6),
    onPath = enemy("on-path", 0.08, -0.74),
    a = aim([nearer, onPath]);
  assert.ok(nearer.body.position.length() < onPath.body.position.length());
  assert.equal(a.prepare({}, punch()).punchAim.targetId, "on-path");
});
test("behind, far, defeated, lateral and vertically unreachable opponents cannot be selected or awarded hits", () => {
  for (const [x, y, z, active] of [
    [0, 0, 1, true],
    [0, 0, -1.6, true],
    [0.8, 0, -0.5, true],
    [0, 5, -0.8, true],
    [0, 0, -0.8, false],
  ]) {
    const e = enemy("no", x, z);
    e.body.position.y = y;
    e.body.active = active;
    e.body.previousPosition.copy(e.body.position);
    const a = aim([e], { strength: 1 }),
      ctx = a.prepare({}, punch());
    assert.equal(ctx.punchAim, undefined);
    assert.equal(contacts(punch(), ctx, [e]).count, 0);
  }
});
test("a grazing stationary punch misses at 0% and physically connects with the default subtle correction", () => {
  const e = enemy("edge", 0.32, -0.91),
    t = punch(),
    none = aim([e], { strength: 0 }).prepare({}, t),
    assisted = aim([e]).prepare({}, t);
  assert.equal(contacts(t, none, [e]).count, 0);
  assert.equal(contacts(t, assisted, [e]).count, 1);
  assert.ok(assisted.punchAim.angle > 0 && assisted.punchAim.angle < 4 * RAD);
});
test("a correction is not a free hit and never changes reach, hit radius or active timing", () => {
  const e = enemy("left-edge", -0.32, -0.91),
    t = punch("right"),
    saved = { ...t };
  const ctx = aim([e], { strength: 1 }).prepare({}, t);
  assert.ok(ctx.punchAim);
  assert.equal(
    contacts(t, ctx, [e]).count,
    0,
    "The bounded right-arm correction still cannot reach this target",
  );
  assert.deepEqual(t, saved);
  e.body.position.set(0, 0, -0.8);
  e.body.previousPosition.copy(e.body.position);
  assert.equal(contacts(t, ctx, [e], { from: 0, to: t.windup }).count, 0);
  assert.equal(
    contacts(t, ctx, [e], { from: t.windup + t.extension + t.impact, to: 0.4 })
      .count,
    0,
  );
});
test("full strength obeys the total 3D angular cap and does not lengthen the striking arm", () => {
  for (const side of ["left", "right"])
    for (const maxAngle of [0, 5, 12, 20]) {
      const e = enemy("edge", side === "left" ? -0.35 : 0.35, -0.9),
        t = punch(side),
        ctx = aim([e], { strength: 1, maxAngle }).prepare({}, t);
      if (maxAngle === 0) {
        assert.equal(ctx.punchAim, undefined);
        continue;
      }
      assert.ok(ctx.punchAim.angle <= maxAngle * RAD + 1e-12);
      for (const time of [0.02, 0.06, 0.08, 0.12, 0.18, 0.24, 0.4]) {
        const base = sampleLocalStrike(new Vector3(), t, time, {}),
          corrected = sampleLocalStrike(new Vector3(), t, time, ctx);
        const q = punchAlignmentQuaternion(
            new Quaternion(),
            t,
            time,
            ctx.punchAim,
          ),
          shoulder = new Vector3(
            (side === "left" ? -1 : 1) * 0.25,
            1.43 - UPPER_BODY_PIVOT,
            0,
          ).applyQuaternion(q);
        shoulder.y += UPPER_BODY_PIVOT;
        close(
          corrected.distanceTo(shoulder),
          base.distanceTo(
            new Vector3((side === "left" ? -1 : 1) * 0.25, 1.43, 0),
          ),
        );
        assert.ok(corrected.distanceTo(shoulder) <= 0.635 + 1e-9);
      }
    }
});
test("moving targets are predicted against the active trajectory, without tracking a lock during the punch", () => {
  const e = enemy("moving", 0.3, -0.85, new Vector3(-2, 0, 0)),
    a = aim([e], { strength: 1 }),
    c = new CombatController({
      techniques,
      prepareAttackContext: (ctx, t) => a.prepare(ctx, t),
    });
  c.requestAttack({ action: "punch", environment: "ground" });
  const captured = c.attack.context.punchAim;
  assert.ok(captured);
  assert.ok(
    captured.axis[1] > 0,
    "Lead the crossing target left, rather than chasing its old right-side position",
  );
  assert.ok(Object.isFrozen(captured));
  e.body.position.set(5, 0, 5);
  c.update(0.15);
  assert.equal(c.attack.context.punchAim, captured);
  assert.equal(a.queries, 1);
  assert.equal(contacts(c.currentTechnique, c.attack.context, [e]).count, 0);
  c.update(1);
  c.requestAttack({ action: "punch", environment: "ground" });
  assert.equal(c.attack.context.punchAim, undefined);
  assert.equal(a.queries, 2);
});
test("config changes affect subsequent punches, without snapping an existing immutable correction", () => {
  const a = aim([enemy("edge", 0.32, -0.91)]),
    c = new CombatController({
      techniques,
      prepareAttackContext: (ctx, t) => a.prepare(ctx, t),
    });
  c.requestAttack({ action: "punch" });
  const before = c.attack.context.punchAim;
  a.configure({ strength: 0 });
  c.update(0.1);
  assert.equal(c.attack.context.punchAim, before);
  c.update(1);
  c.requestAttack({ action: "punch" });
  assert.equal(c.attack.context.punchAim, undefined);
});
test("positional arm preference supplements posture and momentum, uses both limbs, and permits same-limb repeats", () => {
  const target = enemy("left", -0.32, -0.91),
    a = aim([target]),
    s = new ContextualLimbSelector({
      scorePosition: (ctx, t, side) => a.limbPreference(ctx, t, side),
    }),
    eligible = new Map([[punch().id, punch()]]);
  const make = (clock = 0, lateralMovement = 0) => ({
    action: "punch",
    environment: "ground",
    clock,
    lateralMovement,
    limbs: { left: { elbow: 1.7 }, right: { elbow: 1.7 } },
  });
  assert.equal(s.choose(make(), eligible).side, "left");
  assert.equal(s.choose(make(1), eligible).side, "left");
  target.body.position.x = 0.32;
  a.setMotion({ position: new Vector3() });
  assert.equal(s.choose(make(2), eligible).side, "right");
  assert.equal(
    s.choose(make(3, -1), eligible).side,
    "left",
    "Strong movement/posture choice is not overridden by a target tie-break",
  );
  const old = new ContextualLimbSelector(),
    zero = new ContextualLimbSelector({
      scorePosition: (ctx, t, side) => a.limbPreference(ctx, t, side),
    });
  a.configure({ strength: 0 });
  for (let i = 0; i < 20; i++) {
    const ctx = make(i * 0.18, Math.sin(i));
    assert.deepEqual(zero.choose(ctx, eligible), old.choose(ctx, eligible));
  }
});
test("airborne inverted punches share the same corrected sampler and require real 3D contact", () => {
  const orientation = new Quaternion().setFromAxisAngle(
      new Vector3(1, 0, 0),
      Math.PI,
    ),
    root = new Vector3(0, 0.81, 0),
    e = enemy("air-contact", 0.32, 0.91),
    t = { ...techniques.find((t) => t.id === "aerial-punch"), side: "right" };
  const a = aim([e], {}, { position: root, orientation }),
    ctx = a.prepare({ environment: "air" }, t);
  assert.ok(ctx.punchAim);
  assert.equal(contacts(t, {}, [e], { root, orientation }).count, 0);
  assert.equal(contacts(t, ctx, [e], { root, orientation }).count, 1);
  e.body.position.y -= 3;
  e.body.previousPosition.copy(e.body.position);
  assert.equal(contacts(t, ctx, [e], { root, orientation }).count, 0);
});
test("high-speed startup passes still miss, while continuous active-window passes remain swept physical contacts", () => {
  const e = enemy("near", 0, -0.85),
    a = aim([e], { strength: 1 }, { velocity: new Vector3(520, 0, 0) }),
    t = punch(),
    ctx = a.prepare({}, t);
  assert.equal(
    ctx.punchAim,
    undefined,
    "A nearby target passed before startup cannot be magnetized into reach",
  );
  assert.equal(
    contacts(t, ctx, [e], { root: new Vector3(), end: new Vector3(156, 0, 0) })
      .count,
    0,
  );
  e.body.position.set(0, 0, -0.65);
  e.body.previousPosition.copy(e.body.position);
  assert.equal(
    contacts(t, {}, [e], {
      root: new Vector3(-3, 0, 0),
      end: new Vector3(3, 0, 0),
      from: t.windup,
      to: t.windup + t.extension,
    }).count,
    1,
  );
  e.body.position.z = -4;
  e.body.previousPosition.copy(e.body.position);
  assert.equal(
    contacts(t, {}, [e], {
      root: new Vector3(-3, 0, 0),
      end: new Vector3(3, 0, 0),
      from: t.windup,
      to: t.windup + t.extension,
    }).count,
    0,
  );
});
function rig(strength = null, values = {}) {
  const character = new Stickman(),
    controller = new CharacterController(character.root, new ArenaBounds(1000));
  controller.applyMovementConfig(sandboxMovementConfig(values));
  const a =
      strength === null
        ? null
        : aim([enemy("edge", 0.32, -0.91)], { strength }),
    selector = new ContextualLimbSelector({
      scorePosition: a
        ? (ctx, t, side) => a.limbPreference(ctx, t, side)
        : null,
    });
  const combat = new CombatController({
      techniques,
      selectTechnique: (ctx, e) => selector.choose(ctx, e),
      prepareAttackContext: a ? (ctx, t) => a.prepare(ctx, t) : null,
    }),
    animator = new CharacterAnimator(character);
  return {
    character,
    controller,
    combat,
    animator,
    punchAim: a,
    attackScheduler: new AttackScheduler(combat),
    acrobaticPresenter: new AcrobaticPresenter(character, animator),
    bodyRotation: new BodyRotation(),
    bodyStart: new Quaternion(),
    bodyEnd: new Quaternion(),
    lastRotationJumpSequence: 0,
    simulationPrevious: new Vector3(),
    combatStartRoot: new Vector3(),
    combatEndRoot: new Vector3(),
    hitDetector: new StrikeHitDetector(),
    contactFeedbackRemaining: 0,
    combatContext: createCombatContext(),
    followCamera: { yaw: 0 },
    input: { move: { x: 0, y: 0 }, movementMagnitude: 0, blocking: false },
  };
}
function tick(g, dt = 1 / 60) {
  const steps = movementSubsteps(g.controller, dt);
  for (let i = 0; i < steps; i++)
    Game.prototype.simulateMovement.call(g, dt / steps);
  g.acrobaticPresenter.begin(g.combat);
  g.animator.update(dt, {
    speed: g.controller.speed,
    jump: g.controller.jump,
    dash: g.controller.dash,
    combat: g.combat,
    blocking: g.input.blocking,
  });
  g.acrobaticPresenter.apply(dt, g.bodyRotation, g.combat);
}
test("0% reproduces original technique choices, full rig poses and physics bit-for-bit", () => {
  const old = rig(),
    zero = rig(0);
  for (let n = 0; n < 180; n++) {
    for (const g of [old, zero]) {
      g.input.move.x = n > 50 ? 0.3 : 0;
      g.input.move.y = n > 50 ? 0.6 : 0;
      g.input.movementMagnitude = Math.hypot(g.input.move.x, g.input.move.y);
      if (n % 30 === 0)
        g.attackScheduler.press(n % 60 === 0 ? "punch" : "kick");
      if (n === 70 || n === 83) g.controller.requestJump(g.input, 0);
      tick(g);
    }
    assert.deepEqual(zero.character.root.position, old.character.root.position);
    assert.deepEqual(zero.controller.velocity, old.controller.velocity);
    assert.deepEqual(zero.combat.currentTechnique, old.combat.currentTechnique);
    for (const name of Object.keys(old.character.joints))
      assert.deepEqual(
        zero.character.joints[name].quaternion.toArray(),
        old.character.joints[name].quaternion.toArray(),
        name,
      );
  }
  old.character.dispose();
  zero.character.dispose();
});
test("assistance never writes locomotion velocity, facing, jump/dash state, acrobatic orientation or camera input", () => {
  for (const scale of [1, 100]) {
    const plain = rig(0, {
        movement: scale,
        jumpHeight: scale,
        gravity: scale,
      }),
      assisted = rig(1, { movement: scale, jumpHeight: scale, gravity: scale });
    let corrections = 0;
    for (let n = 0; n < 240; n++) {
      for (const g of [plain, assisted]) {
        g.input.move.x = n > 45 ? Math.sin(n * 0.08) * 0.6 : 0;
        g.input.move.y = n > 45 ? 0.8 : 0;
        g.input.movementMagnitude = Math.min(
          1,
          Math.hypot(g.input.move.x, g.input.move.y),
        );
        if (n % 28 === 0) g.attackScheduler.press("punch");
        if (n === 60 || n === 75) g.controller.requestJump(g.input, 0);
        if (n === 62) g.controller.requestDash();
        if (n === 120) g.input.blocking = true;
        if (n === 145) g.input.blocking = false;
        tick(g);
      }
      if (assisted.combat.attack.context?.punchAim) corrections++;
      assert.deepEqual(
        assisted.character.root.position,
        plain.character.root.position,
      );
      assert.deepEqual(assisted.controller.velocity, plain.controller.velocity);
      assert.equal(assisted.controller.heading, plain.controller.heading);
      assert.equal(
        assisted.controller.jump.verticalVelocity,
        plain.controller.jump.verticalVelocity,
      );
      assert.equal(
        assisted.controller.airDashesUsed,
        plain.controller.airDashesUsed,
      );
      assert.deepEqual(
        assisted.bodyRotation.orientation,
        plain.bodyRotation.orientation,
      );
      assert.deepEqual(assisted.input, plain.input);
    }
    assert.ok(corrections > 0);
    plain.character.dispose();
    assisted.character.dispose();
  }
});
test("the corrected visible wrist follows the same sampler without changing root orientation or arm segment lengths", () => {
  const g = rig(1);
  g.attackScheduler.press("punch");
  let measured = false;
  for (let n = 0; n < 30; n++) {
    tick(g);
    const t = g.combat.currentTechnique,
      attack = g.combat.attack;
    if (
      !attack.active ||
      !attack.context?.punchAim ||
      attack.phase === "recovery" ||
      attack.elapsed < 0.09
    )
      continue;
    const sampler = new StrikePoseSampler(),
      goal = new Vector3(),
      hand = g.character.joints[`${t.side}Hand`].getWorldPosition(
        new Vector3(),
      );
    sampler.sample(
      goal,
      g.character.root.position,
      g.controller.heading,
      t,
      attack.elapsed,
      attack.context,
      g.bodyRotation.orientation,
      g.bodyRotation.lift,
    );
    assert.ok(
      hand.distanceTo(goal) < 0.025,
      `${hand.distanceTo(goal)} wrist/contact mismatch`,
    );
    assert.equal(g.character.root.rotation.x, 0);
    assert.equal(g.character.root.rotation.z, 0);
    measured = true;
  }
  assert.ok(measured);
  g.character.dispose();
});
test("extreme motion and arbitrary three-axis rotation keep all corrections and samples finite and bounded", () => {
  for (let i = 0; i < 80; i++) {
    const e = enemy("finite", Math.sin(i) * 0.4, -0.8),
      a = aim(
        [e],
        { strength: 1, maxAngle: 20 },
        {
          position: new Vector3(999, 120, -999),
          velocity: new Vector3(520, 0, 0),
          verticalVelocity: 657,
          gravity: 1800,
          orientation: new Quaternion().setFromAxisAngle(
            new Vector3(1, 2, 3).normalize(),
            i,
          ),
          angularVelocity: new Vector3(12, 5, 8),
        },
      );
    const ctx = a.prepare({}, punch());
    if (ctx.punchAim) {
      assert.ok(ctx.punchAim.axis.every(Number.isFinite));
      assert.ok(ctx.punchAim.angle <= 20 * RAD);
    }
    assert.ok(
      sampleLocalStrike(new Vector3(), punch(), 0.1, ctx)
        .toArray()
        .every(Number.isFinite),
    );
  }
});

test("a pre-timed 100x passing punch acquires only the imminent corridor and connects through genuine swept contact", () => {
  for (const fps of [30, 60, 144])
    for (const strength of [0, 0.2, 1]) {
      const e = enemy("future", 83.2, -0.99),
        t = punch(),
        a = aim([e], { strength }, { velocity: new Vector3(520, 0, 0) }),
        ctx = a.prepare({}, t),
        d = new StrikeHitDetector({ targets: [e.body] });
      const attack = {
        sequence: 1,
        active: true,
        cancelled: false,
        context: ctx,
      };
      for (let time = 0; time < 0.3; time += 1 / fps) {
        const end = Math.min(0.3, time + 1 / fps);
        d.sweep(
          t,
          attack,
          time,
          end,
          new Vector3(520 * time, 0, 0),
          new Vector3(520 * end, 0, 0),
          0,
          0,
        );
      }
      assert.equal(d.count, strength === 0 ? 0 : 1, `${fps} fps / ${strength}`);
      if (strength) {
        assert.equal(ctx.punchAim.targetId, "future");
        assert.ok(ctx.punchAim.time < AIM_ASSIST_LIMITS.predictionHorizon);
        const point = new Vector3().copy(d.lastContact.point);
        assert.ok(
          point.distanceTo(
            e.body.position.clone().add(new Vector3(0, 1.36, 0)),
          ) <=
            0.37 + 1e-7,
        );
        const source = d.lastContact.source;
        assert.ok(
          Math.hypot(83.2 - source.x, -0.04 - source.y, -0.99 - source.z) <=
            t.reach + 0.27 + 1e-7,
        );
      }
    }
});
test("corrected contact evaluation still rejects distant misses and suppresses duplicate hits through recovery", () => {
  const e = enemy("grazing", 0.32, -0.91),
    t = punch(),
    a = aim([e]),
    ctx = a.prepare({}, t),
    attack = { sequence: 1, active: true, cancelled: false, context: ctx },
    d = new StrikeHitDetector({ targets: [e.body] });
  for (let n = 0; n < 20; n++)
    d.sweep(t, attack, 0, 0.4, new Vector3(), new Vector3(), 0, 0);
  assert.equal(d.count, 1);
  e.body.position.z = -4;
  e.body.previousPosition.copy(e.body.position);
  attack.sequence = 2;
  d.sweep(t, attack, 0, 0.4, new Vector3(), new Vector3(), 0, 0);
  assert.equal(d.count, 1);
});

test("player and moving-target acquisition are sampled at the same physical substep fraction", () => {
  const e = enemy("sampled", 0, -0.9),
    a = aim([e]),
    c = new CharacterController(new Group(), new ArenaBounds(1000));
  e.body.previousPosition.set(0.3, 0, -0.9);
  e.body.position.set(0, 0, -0.9);
  a.capture(c, new Vector3(), null, new Quaternion(), 0, 1 / 60);
  const early = a.prepare({}, punch()).punchAim;
  a.capture(c, new Vector3(), null, new Quaternion(), 1, 1 / 60);
  const late = a.prepare({}, punch()).punchAim;
  assert.ok(early && late);
  assert.ok(early.axis[1] < 0);
  assert.ok(
    late.axis[1] > 0,
    "Start-of-step selection must not incorrectly sample the target endpoint",
  );
});
