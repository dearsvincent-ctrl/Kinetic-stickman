import test from "node:test";
import assert from "node:assert/strict";
import { Group, Vector3 } from "three";
import { CombatController } from "../src/combat/CombatController.js";
import { AttackScheduler } from "../src/combat/AttackScheduler.js";
import {
  createManualTechniques,
  selectManualTechnique,
  ATTACK_TIMING_DEFAULTS,
} from "../src/combat/ManualTechniques.js";
import { StrikeHitDetector } from "../src/combat/StrikeHitDetector.js";
import { CharacterController } from "../src/movement/CharacterController.js";
import { ArenaBounds } from "../src/world/ArenaBounds.js";
import { Game } from "../src/core/Game.js";
import { createCombatContext } from "../src/combat/CombatContext.js";
import {
  sandboxMovementConfig,
  NORMAL_PHYSICS,
  movementSubsteps,
} from "../src/sandbox/PhysicsSandbox.js";
import { Stickman } from "../src/character/Stickman.js";
import { CharacterAnimator } from "../src/character/CharacterAnimator.js";
import {
  validateLayout,
  loadLayout,
  CONTROL_IDS,
} from "../src/ui/controlLayoutModel.js";
const close = (a, b, e = 1e-8) =>
  assert.ok(Math.abs(a - b) < e, `${a} ~= ${b}`);
const ground = {
  environment: "ground",
  phase: "grounded",
  canAttack: true,
  height: 0,
};
const air = {
  environment: "air",
  phase: "airborne",
  canAttack: true,
  height: 0.5,
  airTimeRemaining: 0.1,
};
const fixture = () => {
  const combat = new CombatController({
    techniques: createManualTechniques(),
    selectTechnique: selectManualTechnique,
  });
  return { combat, scheduler: new AttackScheduler(combat) };
};
function advance(f, dt, ctx = ground, block = false) {
  let remaining = dt;
  while (remaining > 1e-9) {
    f.scheduler.prepare(ctx, block);
    const step = Math.min(remaining, Math.max(1e-8, f.combat.timeToBoundary));
    f.combat.update(step);
    remaining -= step;
  }
}
const total = (t) => t.windup + t.extension + t.impact + t.recovery;

test("manual techniques declare independent startup, active, recovery, playback speed, reach and environments", () => {
  const list = createManualTechniques();
  assert.equal(list.length, 4);
  for (const t of list) {
    assert.ok(
      t.startup > 0 &&
        t.activeDuration > 0 &&
        t.recovery > 0 &&
        t.animationSpeed > 0 &&
        t.reach < 1,
    );
    assert.equal(t.requiresTarget ?? false, false);
  }
  const fast = createManualTechniques({
    punchSpeed: 2,
    kickSpeed: 3,
    recoverySpeed: 4,
  });
  for (const t of fast) {
    const base = list.find((b) => b.id === t.id);
    close(t.windup, base.windup / (t.action === "punch" ? 2 : 3));
    close(t.recovery, base.recovery / 4);
    close(t.reach, base.reach);
  }
  assert.deepEqual(ATTACK_TIMING_DEFAULTS, {
    punchSpeed: 1,
    kickSpeed: 1,
    recoverySpeed: 1,
  });
  for (const bad of [0, -1, NaN, Infinity])
    assert.throws(
      () => createManualTechniques({ punchSpeed: bad }),
      RangeError,
    );
});
for (const action of ["punch", "kick"]) {
  test(`a brief ${action} tap executes exactly one untargeted strike`, () => {
    const f = fixture();
    f.scheduler.press(action);
    f.scheduler.setHeld(action, true);
    f.scheduler.setHeld(action, false);
    advance(f, 2);
    assert.equal(f.combat.attack.sequence, 1);
    assert.equal(f.combat.attack.active, false);
    assert.equal(f.combat.attack.context.source, "manual");
  });
  test(`held ${action} repeats only after full recovery at 30, 60 and 144 Hz`, () => {
    for (const fps of [30, 60, 144]) {
      const f = fixture();
      f.scheduler.press(action);
      f.scheduler.setHeld(action, true);
      let prior = -1;
      for (let n = 0; n < fps * 2; n++) {
        advance(f, 1 / fps);
        if (f.combat.attack.sequence > prior) {
          prior = f.combat.attack.sequence;
          assert.ok(
            f.combat.attack.elapsed <= total(f.combat.currentTechnique),
          );
        }
      }
      const duration = total(f.combat.currentTechnique);
      assert.equal(f.combat.attack.sequence, Math.ceil((2 - 1e-9) / duration));
      const count = f.combat.attack.sequence;
      f.scheduler.setHeld(action, false);
      advance(f, 1);
      assert.equal(f.combat.attack.sequence, count);
    }
  });
}
test("rapid taps cannot queue recovery attacks or overlap existing techniques", () => {
  const f = fixture();
  f.scheduler.press("punch");
  advance(f, 0.02);
  for (let n = 0; n < 12; n++) {
    f.scheduler.press(n % 2 ? "kick" : "punch");
    advance(f, 0.01);
  }
  assert.equal(f.combat.attack.sequence, 1);
  advance(f, 1);
  assert.equal(f.combat.attack.sequence, 1);
});
test("latest held choice takes over after recovery; releasing it independently resumes the other held action", () => {
  const f = fixture();
  f.scheduler.press("punch");
  f.scheduler.setHeld("punch", true);
  advance(f, 0.05);
  f.scheduler.press("kick");
  f.scheduler.setHeld("kick", true);
  advance(f, 0.4);
  assert.equal(f.combat.currentTechnique.action, "kick");
  f.scheduler.setHeld("kick", false);
  advance(f, 0.6);
  assert.equal(f.combat.currentTechnique.action, "punch");
  f.scheduler.reset();
  const count = f.combat.attack.sequence;
  advance(f, 2);
  assert.equal(f.combat.attack.sequence, count);
});
test("Block cancels active strikes, rejects entry requests, and resumes eligible held attacks only after release", () => {
  const f = fixture();
  f.scheduler.press("punch");
  f.scheduler.setHeld("punch", true);
  advance(f, 0.1);
  advance(f, 0.01, ground, true);
  assert.ok(f.combat.attack.cancelled);
  assert.equal(f.combat.attack.exitReason, "blocked");
  f.scheduler.press("kick");
  advance(f, 1, ground, true);
  assert.equal(f.combat.attack.sequence, 1);
  advance(f, 0.02, ground, false);
  assert.equal(f.combat.attack.sequence, 2);
  assert.equal(f.combat.currentTechnique.action, "punch");
});
test("air Punch and flying Kick execute without targets or minimum remaining-airtime gating", () => {
  for (const action of ["punch", "kick"]) {
    const f = fixture();
    f.scheduler.press(action);
    advance(f, 0.03, air);
    assert.equal(
      f.combat.attack.techniqueId,
      action === "punch" ? "aerial-punch" : "flying-kick",
    );
    f.scheduler.prepare(ground);
    assert.equal(f.combat.attack.cancelled, true);
    assert.equal(f.combat.attack.exitReason, "landing");
  }
});
test("takeoff/landing transitions suppress incompatible attacks but never consume an unlimited queue", () => {
  const f = fixture();
  f.scheduler.press("punch");
  advance(f, 0.03);
  advance(f, 0.02, { ...air, phase: "takeoff", canAttack: false });
  assert.ok(f.combat.attack.cancelled);
  f.scheduler.press("kick");
  advance(f, 0.5, { ...ground, phase: "landing", canAttack: false });
  advance(f, 0.01);
  assert.equal(f.combat.attack.sequence, 1);
});
const dummy = (x = 0, y = 0, z = 0) => ({
  id: "dummy",
  position: new Vector3(x, y, z),
  strikeHeight: 1.4,
  strikeRadius: 0.24,
  active: true,
});
function sense({
  start = new Vector3(0, 0, 5),
  end = new Vector3(0, 0, -5),
  target = dummy(),
  from = 0.1,
  to = 0.116,
  heading = 0,
  id = "basic-punch",
  cancelled = false,
} = {}) {
  const f = fixture();
  const t = f.combat.techniques.get(id);
  const detector = new StrikeHitDetector({ targets: [target] });
  const attack = { active: true, cancelled, sequence: 1 };
  detector.sweep(t, attack, from, to, start, end, heading, heading);
  return { detector, t, attack, start, end, target };
}
test("an active high-speed punch sweeps through an opponent even with both endpoints far outside reach", () => {
  const f = sense();
  assert.equal(f.detector.count, 1);
  assert.ok(
    f.detector.lastContact.time >= 0.1 && f.detector.lastContact.time <= 0.116,
  );
});
test("startup, recovery and cancellation never create swept false hits", () => {
  for (const v of [
    { from: 0, to: 0.04 },
    { from: 0.2, to: 0.24 },
    { cancelled: true },
  ])
    assert.equal(sense(v).detector.count, 0);
});
test("active-time clipping prevents counting a range pass that happened only before startup completed", () => {
  assert.equal(
    sense({
      start: new Vector3(0, 0, 1),
      end: new Vector3(0, 0, -5),
      from: 0,
      to: 0.1,
    }).detector.count,
    0,
  );
});
test("side, vertical, behind and inactive-target misses never inflate strike reach at high speed", () => {
  for (const v of [
    { start: new Vector3(1.1, 0, 5), end: new Vector3(1.1, 0, -5) },
    { start: new Vector3(0, 4, 5), end: new Vector3(0, 4, -5) },
    { start: new Vector3(-5, 0, -1), end: new Vector3(5, 0, -1) },
    { target: { ...dummy(), active: false } },
  ])
    assert.equal(sense(v).detector.count, 0);
});
test("one strike reports a target once across repeated sweeps; another strike can contact again", () => {
  const f = sense();
  for (let n = 0; n < 10; n++)
    f.detector.sweep(f.t, f.attack, 0.1, 0.116, f.start, f.end, 0, 0);
  assert.equal(f.detector.count, 1);
  f.attack.sequence = 2;
  f.detector.sweep(f.t, f.attack, 0.1, 0.116, f.start, f.end, 0, 0);
  assert.equal(f.detector.count, 2);
});
test("ground and flying kicks use separate real hitboxes, with bounded reach", () => {
  for (const id of ["front-kick", "flying-kick"]) {
    assert.equal(
      sense({
        id,
        from: 0.13,
        to: 0.14,
        start: new Vector3(0, id === "flying-kick" ? 0.5 : 0, 5),
        end: new Vector3(0, id === "flying-kick" ? 0.5 : 0, -5),
      }).detector.count,
      1,
    );
  }
  assert.equal(
    sense({
      start: new Vector3(0, 0, 1.001),
      end: new Vector3(0, 0, 1.001),
      from: 0.15,
      to: 0.16,
    }).detector.count,
    0,
  );
});
test("relative sweeps prepare contacts against a moving opponent without repeated hits", () => {
  const target = { ...dummy(0, 0, -5), previousPosition: new Vector3(0, 0, 5) };
  assert.equal(
    sense({ target, start: new Vector3(0, 0, 0), end: new Vector3(0, 0, 0) })
      .detector.count,
    1,
  );
});
function gameFixture(values = {}) {
  const root = new Group(),
    controller = new CharacterController(root, new ArenaBounds(10000));
  controller.applyMovementConfig(
    sandboxMovementConfig({ ...NORMAL_PHYSICS, ...values }),
  );
  const { combat, scheduler } = fixture();
  return {
    controller,
    character: { root },
    combat,
    attackScheduler: scheduler,
    hitDetector: new StrikeHitDetector({ targets: [dummy()] }),
    contactFeedbackRemaining: 0,
    combatContext: createCombatContext(),
    simulationPrevious: new Vector3(),
    combatStartRoot: new Vector3(),
    combatEndRoot: new Vector3(),
    followCamera: { yaw: 0 },
    input: { move: { x: 0, y: 1 }, movementMagnitude: 1, blocking: false },
  };
}
test("manual combat never changes physical movement, including 100x running, gravity or steering", () => {
  const a = gameFixture({ movement: 100, jumpHeight: 20 }),
    b = gameFixture({ movement: 100, jumpHeight: 20 });
  a.attackScheduler.setHeld("punch", true);
  for (let n = 0; n < 100; n++) {
    if (n === 12) {
      a.controller.requestJump();
      b.controller.requestJump();
    }
    a.input.move.x = b.input.move.x = Math.sin(n * 0.1);
    const count = movementSubsteps(a.controller, 1 / 60);
    for (let i = 0; i < count; i++) {
      Game.prototype.simulateMovement.call(a, 1 / 60 / count);
      Game.prototype.simulateMovement.call(b, 1 / 60 / count);
    }
    assert.deepEqual(a.controller.root.position, b.controller.root.position);
    assert.deepEqual(a.controller.velocity, b.controller.velocity);
    close(a.controller.jump.height, b.controller.jump.height);
  }
  assert.ok(a.combat.attack.sequence > 1);
  assert.equal(b.combat.attack.sequence, 0);
});
test("proximity alone never initiates an attack or turns a stationary fighter", () => {
  const f = gameFixture();
  f.input.move.y = 0;
  f.input.movementMagnitude = 0;
  f.controller.root.position.set(0, 0, 0.7);
  const heading = f.controller.heading;
  for (let n = 0; n < 120; n++) Game.prototype.simulateMovement.call(f, 1 / 60);
  assert.equal(f.combat.attack.sequence, 0);
  assert.equal(f.hitDetector.count, 0);
  close(f.controller.heading, heading);
});
test("manual punch, ground kick and aerial strike animations remain finite and never move the root", () => {
  for (const [action, ctx] of [
    ["punch", ground],
    ["kick", ground],
    ["punch", air],
    ["kick", air],
  ]) {
    const rig = new Stickman(),
      animator = new CharacterAnimator(rig),
      f = fixture();
    f.scheduler.press(action);
    const jump =
      ctx === air
        ? {
            airborne: true,
            ready: false,
            phase: "airborne",
            height: 0.5,
            verticalVelocity: 0,
            config: { height: 0.8, gravity: 18 },
            elapsed: 0.2,
            sequence: 1,
            timeToBoundary: 0.5,
          }
        : undefined;
    if (jump) rig.root.position.y = 0.5;
    let weight = 0;
    for (let n = 0; n < 40; n++) {
      advance(f, 1 / 120, ctx);
      const pos = rig.root.position.clone();
      animator.update(1 / 120, { combat: f.combat, jump, speed: 4 });
      assert.deepEqual(rig.root.position, pos);
      weight = Math.max(
        weight,
        action === "punch"
          ? animator.attackWeight
          : animator.aerialAttackWeight,
      );
      for (const joint of Object.values(rig.joints))
        assert.ok(
          [...joint.position.toArray(), ...joint.quaternion.toArray()].every(
            Number.isFinite,
          ),
        );
    }
    assert.ok(weight > 0.8);
  }
});
test("old Dash/Sprint layouts migrate with all surviving coordinates unchanged and independently placeable Punch/Kick", () => {
  const old = {
    version: 1,
    positions: {
      move: { x: 0.12, y: 0.72 },
      dash: null,
      block: { x: 0.8, y: 0.74 },
      jump: { x: 0.69, y: 0.74 },
      sprint: { x: 0.9, y: 0.8 },
    },
  };
  let saved;
  const migrated = loadLayout({
    getItem: () => JSON.stringify(old),
    setItem: (_, v) => {
      saved = JSON.parse(v);
    },
  });
  for (const id of ["move", "block", "jump"])
    assert.deepEqual(migrated.positions[id], old.positions[id]);
  assert.deepEqual(Object.keys(migrated.positions), CONTROL_IDS);
  assert.equal(Object.hasOwn(saved.positions, "dash"), false);
  assert.equal(Object.hasOwn(saved.positions, "sprint"), false);
  assert.ok(validateLayout(migrated));
  const readOnly = loadLayout({
    getItem: () => JSON.stringify(old),
    setItem() {
      throw Error();
    },
  });
  assert.deepEqual(readOnly, migrated);
});

test("blocked normal movement keeps smooth joystick-facing rather than turning away along a tiny collision slide", () => {
  const root = new Group(),
    target = { ...dummy(2, 0, -5), radius: 0.32 };
  root.position.set(2.0265, 0, -4.3205);
  const c = new CharacterController(root, new ArenaBounds(18, [target]), {
    faceInputWhenBlocked: true,
  });
  c.heading = -1.12;
  const referenceRoot = new Group();
  referenceRoot.position.copy(root.position);
  const reference = new CharacterController(
    referenceRoot,
    new ArenaBounds(18, [target]),
  );
  for (let n = 0; n < 12; n++) {
    const input = { move: { x: 0, y: 1 }, movementMagnitude: 0.7 };
    c.update(1 / 60, input, 0);
    reference.update(1 / 60, input, 0);
  }
  for (let n = 0; n < 30; n++) {
    const input = { move: { x: 0, y: 0 }, movementMagnitude: 0 };
    c.update(1 / 60, input, 0);
    reference.update(1 / 60, input, 0);
  }
  assert.ok(Math.abs(c.heading) < 0.02);
  assert.deepEqual(root.position, referenceRoot.position);
  assert.deepEqual(c.velocity, reference.velocity);
});

test("a pre-emptive strike starts far outside reach and can connect after 100x approach, once per strike", () => {
  const f = gameFixture({ movement: 100 });
  const target = { ...dummy(), radius: 0.32 };
  f.hitDetector = new StrikeHitDetector({ targets: [target] });
  f.controller.world = new ArenaBounds(1000, [target]);
  f.controller.root.position.set(0, 0, 50);
  f.controller.velocity.set(0, 0, -520);
  f.attackScheduler.press("punch");
  for (let n = 0; n < 20; n++) {
    const count = movementSubsteps(f.controller, 1 / 60);
    for (let k = 0; k < count; k++)
      Game.prototype.simulateMovement.call(f, 1 / 60 / count);
  }
  assert.equal(f.combat.attack.sequence, 1);
  assert.equal(f.hitDetector.count, 1);
  assert.ok(f.controller.root.position.z >= 0.68 - 1e-8);
});
test("invalid opponent hitboxes are skipped safely and invalid technique radii are rejected", () => {
  for (const target of [
    { id: "bad" },
    { ...dummy(), position: new Vector3(NaN, 0, 0) },
    { ...dummy(), strikeRadius: NaN },
    { ...dummy(), strikeRadius: -1 },
  ])
    assert.equal(sense({ target }).detector.count, 0);
  assert.throws(
    () => createManualTechniques({}, { "basic-punch": { hitRadius: 2 } }),
    RangeError,
  );
});

test("extended manual kick foot stays coherent with its contact sphere in both ground and air poses", () => {
  for (const ctx of [ground, air]) {
    const rig = new Stickman(),
      animator = new CharacterAnimator(rig),
      f = fixture();
    f.scheduler.press("kick");
    const jump =
      ctx === air
        ? {
            airborne: true,
            ready: false,
            phase: "airborne",
            height: 0.5,
            verticalVelocity: 0,
            config: { height: 0.8, gravity: 18 },
            elapsed: 0.2,
            sequence: 1,
            timeToBoundary: 0.5,
          }
        : undefined;
    if (jump) rig.root.position.y = 0.5;
    const count = ctx === air ? 17 : 25;
    for (let n = 0; n < count; n++) {
      advance(f, 1 / 120, ctx);
      animator.update(1 / 120, { combat: f.combat, jump });
    }
    const t = f.combat.currentTechnique,
      ankle = rig.joints.rightAnkle.getWorldPosition(new Vector3());
    const center = new Vector3(
      0.07,
      rig.root.position.y + t.originHeight,
      -Math.sqrt((t.reach - t.hitRadius) ** 2 - 0.07 ** 2),
    );
    assert.ok(
      ankle.distanceTo(center) < 0.18,
      `${ctx.environment} foot follows the active hit volume`,
    );
  }
});

test("held manual punches retain the athletic sprint gait while Block still blends defensive footwork", () => {
  const rig = new Stickman(),
    animator = new CharacterAnimator(rig),
    f = fixture();
  f.scheduler.setHeld("punch", true);
  for (let n = 0; n < 120; n++) {
    rig.root.position.z -= 5.2 / 60;
    advance(f, 1 / 60);
    animator.update(1 / 60, { speed: 5.2, combat: f.combat });
  }
  assert.ok(animator.locomotion.sprintBlend > 0.99);
  assert.ok(animator.locomotion.freeRunBlend > 0.9);
  assert.ok(animator.locomotion.stride > 0.7);
  assert.ok(animator.combatWeight > 0.9);
  for (let n = 0; n < 60; n++) {
    rig.root.position.z -= 5.2 / 60;
    advance(f, 1 / 60, ground, true);
    animator.update(1 / 60, { speed: 5.2, combat: f.combat, blocking: true });
  }
  assert.ok(animator.locomotion.freeRunBlend < 0.1);
  assert.ok(animator.combatWeight > 0.9);
});

test("manual attack scheduling cannot alter the preserved Ground Dash -> Jump -> Air Dash sequence", () => {
  const values = {
    groundSpeed: 20,
    groundDistance: 10,
    airSpeed: 20,
    airDistance: 10,
    jumpHeight: 10,
  };
  const a = gameFixture(values),
    b = gameFixture(values);
  a.attackScheduler.setHeld("punch", true);
  for (let n = 0; n < 240; n++) {
    if (n === 0) {
      a.controller.requestDash();
      b.controller.requestDash();
    }
    if (n === 2) {
      assert.ok(a.controller.requestJump());
      assert.ok(b.controller.requestJump());
    }
    if (n === 20) {
      assert.ok(a.controller.requestDash());
      assert.ok(b.controller.requestDash());
    }
    if (n === 25) {
      a.input.move.x = b.input.move.x = 0.6;
      a.input.move.y = b.input.move.y = 0.8;
    }
    if (n === 40) {
      a.attackScheduler.setHeld("punch", false);
      a.attackScheduler.press("kick");
      a.attackScheduler.setHeld("kick", true);
    }
    if (n === 60) a.input.blocking = true;
    if (n === 80) a.input.blocking = false;
    const count = movementSubsteps(a.controller, 1 / 60);
    for (let k = 0; k < count; k++) {
      Game.prototype.simulateMovement.call(a, 1 / 60 / count);
      Game.prototype.simulateMovement.call(b, 1 / 60 / count);
    }
    assert.deepEqual(a.controller.root.position, b.controller.root.position);
    assert.deepEqual(a.controller.velocity, b.controller.velocity);
    assert.equal(
      a.controller.airDashesRemaining,
      b.controller.airDashesRemaining,
    );
    assert.equal(a.controller.movementState, b.controller.movementState);
  }
  assert.ok(a.combat.attack.sequence > 2);
  assert.ok(a.controller.jump.ready);
});
