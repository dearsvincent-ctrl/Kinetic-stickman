import test from "node:test";
import assert from "node:assert/strict";
import { Group, Quaternion, Vector3, PerspectiveCamera } from "three";
import {
  createAdaptiveTechniques,
  ContextualLimbSelector,
} from "../src/combat/AdaptiveTechniques.js";
import { CombatController } from "../src/combat/CombatController.js";
import { AttackScheduler } from "../src/combat/AttackScheduler.js";
import { StrikeHitDetector } from "../src/combat/StrikeHitDetector.js";
import {
  StrikePoseSampler,
  sampleLocalStrike,
  BODY_PIVOT,
} from "../src/combat/TechniqueGeometry.js";
import { BodyRotation } from "../src/movement/BodyRotation.js";
import { CharacterController } from "../src/movement/CharacterController.js";
import { ArenaBounds } from "../src/world/ArenaBounds.js";
import { FollowCamera } from "../src/camera/FollowCamera.js";
import { Stickman } from "../src/character/Stickman.js";
import { CharacterAnimator } from "../src/character/CharacterAnimator.js";
import { AcrobaticPresenter } from "../src/character/AcrobaticPresenter.js";
import { PoseTransitions } from "../src/character/PoseTransitions.js";
const UP = new Vector3(0, 1, 0),
  X = new Vector3(1, 0, 0);
const context = (extra = {}) => ({
  environment: "ground",
  phase: "grounded",
  canAttack: true,
  height: 0,
  clock: 0,
  rotationRate: [0, 0, 0],
  limbs: {
    left: { elbow: 1.7, planted: true },
    right: { elbow: 1.7, planted: true },
  },
  ...extra,
});
const fixture = () => {
  const selector = new ContextualLimbSelector(),
    combat = new CombatController({
      techniques: createAdaptiveTechniques(),
      selectTechnique: (ctx, map) => selector.choose(ctx, map),
    });
  return { selector, combat, scheduler: new AttackScheduler(combat) };
};
function advance(f, dt, ctx) {
  let left = dt;
  while (left > 1e-9) {
    f.scheduler.prepare(ctx);
    const step = Math.min(left, Math.max(1e-8, f.combat.timeToBoundary));
    f.combat.update(step);
    ctx.clock += step;
    left -= step;
  }
}
test("adaptive registry is a small set of mirrored families with authored reach and recovery", () => {
  const ts = createAdaptiveTechniques();
  assert.equal(ts.length, 7);
  assert.equal(ts.filter((t) => t.gesture).length, 2);
  for (const t of ts) {
    assert.ok(t.adaptive);
    assert.ok(t.reach <= 0.95);
    assert.ok(t.hitRadius < t.reach);
    assert.ok(t.transitionAfter > 0);
  }
});
test("stationary held punches and kicks use both limbs without a fixed alternation rule", () => {
  for (const action of ["punch", "kick"]) {
    const f = fixture(),
      ctx = context();
    const sides = new Set();
    f.scheduler.setHeld(action, true);
    let previous = 0;
    for (let n = 0; n < 240; n++) {
      advance(f, 1 / 120, ctx);
      if (f.combat.attack.sequence !== previous) {
        previous = f.combat.attack.sequence;
        sides.add(f.combat.currentTechnique.side);
      }
    }
    assert.deepEqual(sides, new Set(["right", "left"]));
  }
});
test("directed movement can legitimately produce repeated same-limb strikes", () => {
  for (const lateralMovement of [-1, 1]) {
    const f = fixture(),
      ctx = context({ lateralMovement });
    f.scheduler.setHeld("punch", true);
    const sides = [];
    let previous = 0;
    for (let n = 0; n < 180; n++) {
      advance(f, 1 / 120, ctx);
      if (f.combat.attack.sequence !== previous) {
        previous = f.combat.attack.sequence;
        sides.push(f.combat.currentTechnique.side);
      }
    }
    assert.ok(sides.length >= 3);
    assert.ok(
      sides.every((side) => side === (lateralMovement < 0 ? "left" : "right")),
    );
  }
});
test("support foot, limb compactness and rotational direction affect deterministic limb selection", () => {
  const definitions = createAdaptiveTechniques(),
    map = new Map(definitions.map((t) => [t.id, t]));
  const a = new ContextualLimbSelector().choose(
    context({
      action: "kick",
      limbs: { left: { planted: true }, right: { planted: false } },
    }),
    map,
  );
  const b = new ContextualLimbSelector().choose(
    context({ action: "punch", rotationRate: [0, -10, 0] }),
    map,
  );
  const c = new ContextualLimbSelector().choose(
    context({ action: "punch", rotationRate: [0, 10, 0] }),
    map,
  );
  assert.equal(a.side, "right");
  assert.notEqual(b.side, c.side);
});
test("both arms and legs remain eligible in air without requiring an opponent", () => {
  for (const action of ["punch", "kick"])
    for (const direction of [-1, 1]) {
      const f = fixture(),
        ctx = context({
          environment: "air",
          phase: "airborne",
          height: 0.4,
          action,
          lateralMovement: direction,
        });
      assert.ok(f.combat.requestAttack(ctx));
      assert.equal(
        f.combat.currentTechnique.side,
        direction < 0 ? "left" : "right",
      );
    }
});
test("whip/sweep gestures execute distinct unopposed techniques and never arise from ordinary Punch/Kick holds", () => {
  for (const kind of ["whip-kick", "descending-sweep"]) {
    const f = fixture(),
      ctx = context({ rotationActive: true, rotationRate: [0, 16, 0] });
    f.scheduler.gesture(kind, 1, 0.9);
    f.scheduler.prepare(ctx);
    assert.equal(f.combat.attack.techniqueId, kind);
  }
  const f = fixture(),
    ctx = context();
  f.scheduler.setHeld("kick", true);
  advance(f, 2, ctx);
  assert.equal(f.combat.attack.techniqueId, "front-kick");
});
test("spinning kick can continue into a backhand during its active window without dropping angular momentum", () => {
  const f = fixture(),
    ctx = context({ rotationActive: true, rotationRate: [0, 16, 0] });
  f.scheduler.gesture("whip-kick", 1, 1);
  advance(f, 0.15, ctx);
  assert.equal(f.combat.attack.phase, "impact");
  const m = new CharacterController(new Group(), new ArenaBounds(100)),
    r = new BodyRotation();
  r.start("whip-kick", 0, 1);
  const before = r.angularVelocity.clone(),
    orientation = r.orientation.clone();
  f.scheduler.press("punch");
  assert.ok(f.scheduler.prepare(ctx));
  assert.equal(f.combat.attack.techniqueId, "rotational-backhand");
  assert.equal(f.combat.lastTransition.kind, "continuation");
  assert.equal(f.combat.lastTransition.action, "kick");
  assert.deepEqual(r.angularVelocity, before);
  assert.deepEqual(r.orientation, orientation);
});
test("a committed normal strike can redirect in recovery, while early spam and held repeats cannot bypass configured rate", () => {
  const f = fixture(),
    ctx = context();
  f.scheduler.press("punch");
  advance(f, 0.03, ctx);
  f.scheduler.press("kick");
  assert.equal(f.scheduler.prepare(ctx), false);
  assert.equal(f.combat.attack.sequence, 1);
  advance(f, 0.17, ctx);
  f.scheduler.press("kick");
  assert.equal(f.scheduler.prepare(ctx), true);
  assert.equal(f.combat.attack.techniqueId, "front-kick");
  const count = f.combat.attack.sequence;
  f.scheduler.press("punch");
  assert.equal(f.scheduler.prepare(ctx), false);
  assert.equal(f.combat.attack.sequence, count);
});
test("Block cancels rotational attacks and suppresses entry gestures without clearing physical rotation", () => {
  const f = fixture(),
    ctx = context({ rotationActive: true, rotationRate: [0, 16, 0] });
  f.scheduler.gesture("whip-kick", 1, 1);
  advance(f, 0.14, ctx);
  f.scheduler.press("punch");
  f.scheduler.prepare(ctx, true);
  assert.ok(f.combat.blocking);
  assert.ok(f.combat.attack.cancelled);
  assert.equal(f.combat.attack.sequence, 1);
});
test("releasing a held attack ends repetition; transition requests remain bounded", () => {
  const f = fixture(),
    ctx = context({ rotationActive: true, rotationRate: [0, 16, 0] });
  f.scheduler.gesture("whip-kick", 1, 1);
  advance(f, 0.15, ctx);
  f.scheduler.press("punch");
  f.scheduler.prepare(ctx);
  const count = f.combat.attack.sequence;
  advance(f, 2, ctx);
  assert.equal(f.combat.attack.sequence, count);
});
const target = (x, y, z) => ({
  id: "dummy",
  position: new Vector3(x, y, z),
  strikeHeight: 0,
  strikeRadius: 0.2,
  active: true,
});
test("quaternion-oriented aerial Kick can contact below the fighter with no reach expansion", () => {
  const f = fixture();
  f.combat.requestAttack(
    context({
      action: "kick",
      environment: "air",
      phase: "airborne",
      height: 1.2,
    }),
  );
  const t = f.combat.currentTechnique,
    q = new Quaternion().setFromAxisAngle(X, -Math.PI / 2),
    root = new Vector3(0, 1.2, 0),
    sampler = new StrikePoseSampler(),
    point = new Vector3();
  sampler.sample(point, root, 0, t, 0.14, {}, q);
  const d = new StrikeHitDetector({
    targets: [target(point.x, point.y, point.z)],
  });
  d.sweep(t, f.combat.attack, 0.12, 0.15, root, root, 0, 0, q, q);
  assert.equal(d.count, 1);
  assert.ok(point.y < root.y + BODY_PIVOT);
  const miss = new StrikeHitDetector({
    targets: [target(point.x + 1, point.y, point.z)],
  });
  miss.sweep(t, f.combat.attack, 0.12, 0.15, root, root, 0, 0, q, q);
  assert.equal(miss.count, 0);
});
test("fast rotational foot sweeps hit intervening opponents even when both sampled endpoints miss", () => {
  const f = fixture();
  f.scheduler.gesture("whip-kick", 1, 1);
  f.scheduler.prepare(context({ rotationRate: [0, 18, 0] }));
  const t = f.combat.currentTechnique,
    root = new Vector3(),
    a = new Quaternion().setFromAxisAngle(UP, -0.9),
    b = new Quaternion().setFromAxisAngle(UP, 0.9),
    sample = new StrikePoseSampler(),
    middle = new Vector3();
  sample.sample(middle, root, 0, t, 0.18, {}, new Quaternion());
  const d = new StrikeHitDetector({
    targets: [target(middle.x, middle.y, middle.z)],
  });
  d.sweep(t, f.combat.attack, 0.17, 0.19, root, root, 0, 0, a, b);
  assert.equal(d.count, 1);
  d.sweep(t, f.combat.attack, 0.17, 0.19, root, root, 0, 0, a, b);
  assert.equal(d.count, 1);
});
test("descending sweep's physical leg trajectory is lower than the horizontal whip", () => {
  const ts = createAdaptiveTechniques(),
    whip = ts.find((t) => t.id === "whip-kick"),
    sweep = ts.find((t) => t.id === "descending-sweep"),
    a = new Vector3(),
    b = new Vector3();
  sampleLocalStrike(a, whip, 0.24, { gestureIntensity: 1 });
  sampleLocalStrike(b, sweep, 0.26, { gestureIntensity: 1 });
  assert.ok(a.y > 1);
  assert.ok(b.y < 0.3);
  assert.ok(b.z < -0.7);
});
test("multiple opponent hitboxes do not report duplicate contacts for one strike", () => {
  const f = fixture();
  f.scheduler.gesture("descending-sweep", 1, 1);
  f.scheduler.prepare(context());
  const t = f.combat.currentTechnique,
    q = new Quaternion(),
    sample = new StrikePoseSampler(),
    p = new Vector3();
  sample.sample(p, new Vector3(), 0, t, 0.25, {}, q);
  const opponent = {
      ...target(p.x, 0, p.z),
      hitboxes: [
        { height: p.y, radius: 0.2 },
        { height: p.y + 0.02, radius: 0.2 },
      ],
    },
    d = new StrikeHitDetector({ targets: [opponent] });
  d.sweep(
    t,
    f.combat.attack,
    0.24,
    0.26,
    new Vector3(),
    new Vector3(),
    0,
    0,
    q,
    q,
  );
  assert.equal(d.count, 1);
});
test("pose transition interpolates from current joints instead of resetting to neutral", () => {
  const rig = new Stickman(),
    transition = new PoseTransitions(rig),
    joint = rig.joints.rightShoulder;
  joint.quaternion.setFromAxisAngle(X, 1.4);
  const before = joint.quaternion.clone();
  transition.begin({
    attack: {
      active: true,
      sequence: 1,
      context: { transition: { action: "kick" } },
    },
  });
  joint.quaternion.setFromAxisAngle(X, -0.8);
  transition.apply(1 / 60);
  assert.ok(joint.quaternion.angleTo(before) < 0.3);
  assert.ok(
    joint.quaternion.angleTo(new Quaternion().setFromAxisAngle(X, -0.8)) > 0.5,
  );
});
test("procedural presentation rotates the body without moving the root or spinning the camera", () => {
  const rig = new Stickman(),
    animator = new CharacterAnimator(rig),
    presenter = new AcrobaticPresenter(rig, animator),
    movement = new CharacterController(rig.root, new ArenaBounds(100));
  movement.jump.phase = "airborne";
  movement.jump.height = 2;
  movement.root.position.y = 2;
  movement.jump.verticalVelocity = 0;
  const r = new BodyRotation();
  r.start("backflip", 0);
  const f = fixture(),
    camera = new PerspectiveCamera(),
    follow = new FollowCamera(camera, rig.root.position);
  const yaw = follow.yaw,
    pitch = follow.pitch;
  let maxTilt = 0;
  for (let n = 0; n < 40; n++) {
    r.update(1 / 120, movement, { move: { x: 0.2, y: -1 } }, 0);
    presenter.begin(f.combat);
    animator.update(1 / 120, { jump: movement.jump, combat: f.combat });
    const root = rig.root.position.clone(),
      q = rig.root.quaternion.clone();
    presenter.apply(1 / 120, r, f.combat);
    maxTilt = Math.max(
      maxTilt,
      presenter.pivot.quaternion.angleTo(new Quaternion()),
    );
    assert.deepEqual(rig.root.position, root);
    assert.ok(rig.root.quaternion.equals(q));
    follow.update(1 / 120, rig.root.position, { x: 0, y: 0 });
    for (const joint of Object.values(rig.joints))
      assert.ok(
        [...joint.quaternion.toArray(), ...joint.position.toArray()].every(
          Number.isFinite,
        ),
      );
  }
  assert.equal(follow.yaw, yaw);
  assert.equal(follow.pitch, pitch);
  assert.ok(maxTilt > 2);
});
test("adaptive hand/foot targets stay close to contact geometry through mirrored attacks and rotations", () => {
  for (const side of ["left", "right"])
    for (const action of ["punch", "kick"]) {
      const rig = new Stickman(),
        animator = new CharacterAnimator(rig),
        presenter = new AcrobaticPresenter(rig, animator),
        r = new BodyRotation();
      r.orientation.setFromAxisAngle(UP, 0.4);
      r.phase = "spin";
      r.angularVelocity.y = 5;
      const f = fixture(),
        ctx = context({ action, lateralMovement: side === "left" ? -1 : 1 });
      f.combat.requestAttack(ctx);
      for (let n = 0; n < 24; n++) {
        f.combat.update(1 / 120);
        presenter.begin(f.combat);
        animator.update(1 / 120, { combat: f.combat });
        presenter.apply(1 / 120, r, f.combat);
      }
      const t = f.combat.currentTechnique,
        sampler = new StrikePoseSampler(),
        expected = new Vector3();
      sampler.sample(
        expected,
        rig.root.position,
        0,
        t,
        f.combat.attack.elapsed,
        ctx,
        r.orientation,
      );
      const actual = rig.joints[
        `${side}${action === "punch" ? "Hand" : "Ankle"}`
      ].getWorldPosition(new Vector3());
      assert.ok(
        actual.distanceTo(expected) < 0.28,
        `${action} ${side}: ${actual.distanceTo(expected)}`,
      );
    }
});

test("full acrobatic integration preserves translation, dash/jump eligibility and bounds at normal and 100x travel", async () => {
  const { Game } = await import("../src/core/Game.js"),
    { createCombatContext } = await import("../src/combat/CombatContext.js"),
    { sandboxMovementConfig, movementSubsteps } =
      await import("../src/sandbox/PhysicsSandbox.js");
  function integrated(values) {
    const rig = new Stickman(),
      animator = new CharacterAnimator(rig),
      presenter = new AcrobaticPresenter(rig, animator),
      f = fixture();
    const controller = new CharacterController(
      rig.root,
      new ArenaBounds(14, [{ position: new Vector3(1, 0, -5), radius: 0.32 }]),
    );
    controller.applyMovementConfig(sandboxMovementConfig(values));
    return {
      controller,
      character: rig,
      animator,
      acrobaticPresenter: presenter,
      combat: f.combat,
      attackScheduler: f.scheduler,
      hitDetector: new StrikeHitDetector({ targets: [target(1, 1.4, -5)] }),
      bodyRotation: new BodyRotation(),
      bodyStart: new Quaternion(),
      bodyEnd: new Quaternion(),
      combatContext: createCombatContext(),
      simulationPrevious: new Vector3(),
      combatStartRoot: new Vector3(),
      combatEndRoot: new Vector3(),
      contactFeedbackRemaining: 0,
      followCamera: { yaw: 0 },
      input: { move: { x: 0, y: 1 }, movementMagnitude: 1, blocking: false },
    };
  }
  for (const values of [
    {},
    {
      movement: 100,
      jumpHeight: 100,
      gravity: 20,
      groundSpeed: 20,
      groundDistance: 10,
      airSpeed: 20,
      airDistance: 10,
    },
  ]) {
    const a = integrated(values),
      b = integrated(values);
    a.attackScheduler.setHeld("kick", true);
    let rotated = false;
    for (let n = 0; n < 240; n++) {
      if (n === 0) {
        assert.ok(a.controller.requestDash());
        assert.ok(b.controller.requestDash());
        a.bodyRotation.start("whip-kick", 0);
      }
      if (n === 2) {
        assert.ok(a.controller.requestJump());
        assert.ok(b.controller.requestJump());
      }
      if (n === 12) {
        assert.ok(a.controller.requestDash());
        assert.ok(b.controller.requestDash());
      }
      if (n === 28 && a.controller.jump.airborne) {
        a.bodyRotation.start("backflip", a.controller.heading);
        rotated = true;
      }
      if (n === 30) a.attackScheduler.press("punch");
      a.input.blocking = n >= 60 && n < 80;
      a.input.move.x = b.input.move.x = n < 160 ? Math.sin(n * 0.08) * 0.6 : 0;
      a.input.move.y = b.input.move.y = n < 160 ? Math.cos(n * 0.08) * 0.8 : 0;
      a.input.movementMagnitude = b.input.movementMagnitude = n < 160 ? 1 : 0;
      const count = movementSubsteps(a.controller, 1 / 60);
      for (let k = 0; k < count; k++) {
        Game.prototype.simulateMovement.call(a, 1 / 60 / count);
        Game.prototype.simulateMovement.call(b, 1 / 60 / count);
      }
      a.acrobaticPresenter.begin(a.combat);
      a.animator.update(1 / 60, {
        speed: a.controller.speed,
        jump: a.controller.jump,
        dash: a.controller.dash,
        combat: a.combat,
        sandbox: true,
      });
      a.acrobaticPresenter.apply(1 / 60, a.bodyRotation, a.combat);
      assert.deepEqual(a.character.root.position, b.character.root.position);
      assert.deepEqual(a.controller.velocity, b.controller.velocity);
      assert.equal(
        a.controller.airDashesRemaining,
        b.controller.airDashesRemaining,
      );
      assert.ok(
        Math.abs(a.character.root.position.x) <= 14 &&
          Math.abs(a.character.root.position.z) <= 14,
      );
      assert.ok(a.character.root.position.y >= 0);
      assert.ok(Math.abs(a.bodyRotation.orientation.length() - 1) < 1e-10);
      for (const joint of Object.values(a.character.joints))
        assert.ok(joint.quaternion.toArray().every(Number.isFinite));
    }
    assert.ok(rotated);
    assert.ok(a.controller.jump.ready);
    assert.equal(a.bodyRotation.phase, "idle");
    assert.ok(a.combat.attack.sequence > 2);
  }
});

test("lateral aerial rotation still selects a valid aerial punch after a kick", () => {
  const f = fixture();
  assert.ok(
    f.combat.requestAttack(
      context({
        environment: "air",
        action: "punch",
        rotationRate: [12, 6, 2],
        previousAction: "kick",
      }),
    ),
  );
  assert.equal(f.combat.currentTechnique.id, "aerial-punch");
});

test("flip tuck eases into recovery instead of dropping a knee pose in one frame", () => {
  const rig = new Stickman(),
    animator = new CharacterAnimator(rig),
    presenter = new AcrobaticPresenter(rig, animator),
    r = new BodyRotation(),
    f = fixture();
  r.phase = "backflip";
  r.elapsed = 0.3;
  for (let n = 0; n < 30; n++) {
    presenter.begin(f.combat);
    animator.update(1 / 60, { combat: f.combat });
    presenter.apply(1 / 60, r, f.combat);
  }
  const before = rig.joints.leftKnee.quaternion.clone();
  r.phase = "recover";
  presenter.begin(f.combat);
  animator.update(1 / 60, { combat: f.combat });
  presenter.apply(1 / 60, r, f.combat);
  assert.ok(
    rig.joints.leftKnee.quaternion.angleTo(before) < 0.7,
    "Landing retains the preceding tucked pose while blending out",
  );
});
test("moving-opponent sweep respects the enclosing movement fraction across attack phase slices", () => {
  const f = fixture();
  f.combat.requestAttack(context({ action: "punch" }));
  const t = f.combat.currentTechnique,
    root = new Vector3(),
    q = new Quaternion(),
    p = new Vector3();
  new StrikePoseSampler().sample(p, root, 0, t, 0.14, {}, q);
  const opponent = {
    ...target(p.x, p.y, p.z - 4),
    previousPosition: new Vector3(p.x, p.y, p.z + 4),
    strikeRadius: 0.1,
  };
  const d = new StrikeHitDetector({ targets: [opponent] });
  d.sweep(t, f.combat.attack, 0.1, 0.14, root, root, 0, 0, q, q, 0, 0, 0, 0.1);
  assert.equal(
    d.count,
    0,
    "An early movement slice cannot sample a future opponent pass",
  );
  d.sweep(
    t,
    f.combat.attack,
    0.1,
    0.14,
    root,
    root,
    0,
    0,
    q,
    q,
    0,
    0,
    0.45,
    0.55,
  );
  assert.equal(
    d.count,
    1,
    "The slice crossing the actual contact samples relative travel",
  );
});

test("incoming strike geometry begins at the captured limb pose, including kick-to-backhand redirection", () => {
  const t = {
      ...createAdaptiveTechniques().find((t) => t.id === "rotational-backhand"),
      side: "left",
    },
    from = [-0.4, 1.5, 0.15],
    ctx = { transition: { action: "kick" }, limbs: { left: { hand: from } } },
    p = new Vector3(),
    raw = new Vector3();
  sampleLocalStrike(p, t, 0, ctx);
  assert.deepEqual(p.toArray(), from);
  sampleLocalStrike(p, t, 0.04, ctx);
  sampleLocalStrike(raw, t, 0.04, {});
  assert.ok(
    p.distanceTo(new Vector3(...from)) < p.distanceTo(raw),
    "Active entry keeps pose continuity instead of jumping to the authored endpoint",
  );
  sampleLocalStrike(p, t, 0.12, ctx);
  sampleLocalStrike(raw, t, 0.12, {});
  assert.ok(p.distanceTo(raw) < 1e-9);
});

test("airborne rotational kicks keep the free leg's air pose rather than planting it on the floor", () => {
  const rig = new Stickman(),
    animator = new CharacterAnimator(rig),
    presenter = new AcrobaticPresenter(rig, animator),
    r = new BodyRotation(),
    f = fixture(),
    m = new CharacterController(rig.root, new ArenaBounds(20));
  rig.root.position.y = 2;
  m.jump.phase = "airborne";
  m.jump.height = 2;
  m.jump.verticalVelocity = 1;
  r.phase = "recover";
  r.angularVelocity.y = 6;
  f.combat.requestAttack(context({ action: "kick", environment: "air" }));
  f.combat.update(0.1);
  for (let n = 0; n < 8; n++) {
    presenter.begin(f.combat);
    animator.update(1 / 60, { jump: m.jump, combat: f.combat });
    presenter.apply(1 / 60, r, f.combat);
    f.combat.update(1 / 60);
  }
  presenter.begin(f.combat);
  animator.update(1 / 60, { jump: m.jump, combat: f.combat });
  const other = f.combat.currentTechnique.side === "right" ? "left" : "right",
    before = rig.joints[`${other}Knee`].quaternion.clone();
  presenter.apply(1 / 60, r, f.combat);
  assert.ok(
    rig.joints[`${other}Knee`].quaternion.angleTo(before) < 1e-6,
    "A rotating airborne strike preserves the non-striking leg's flight pose",
  );
});
