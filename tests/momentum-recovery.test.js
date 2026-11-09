import test from "node:test";
import assert from "node:assert/strict";
import { Group, Vector3, Quaternion } from "three";
import { MomentumRecovery } from "../src/movement/MomentumRecovery.js";
import { CharacterController } from "../src/movement/CharacterController.js";
import { BodyRotation } from "../src/movement/BodyRotation.js";
import { ArenaBounds } from "../src/world/ArenaBounds.js";
import { sandboxMovementConfig } from "../src/sandbox/PhysicsSandbox.js";
import { Stickman } from "../src/character/Stickman.js";
import { CharacterAnimator } from "../src/character/CharacterAnimator.js";
import { AcrobaticPresenter } from "../src/character/AcrobaticPresenter.js";
import { CombatController } from "../src/combat/CombatController.js";
import { AttackScheduler } from "../src/combat/AttackScheduler.js";
import {
  createAdaptiveTechniques,
  ContextualLimbSelector,
} from "../src/combat/AdaptiveTechniques.js";
import { GroundStreaks } from "../src/world/GroundStreaks.js";
const input = (x = 0, y = 1) => ({
  move: { x, y },
  movementMagnitude: Math.hypot(x, y),
  blocking: false,
});
function fixture(values = {}) {
  const m = new CharacterController(new Group(), new ArenaBounds(10000));
  m.applyMovementConfig(sandboxMovementConfig(values));
  return { m, r: new MomentumRecovery() };
}
function step(f, i, dt = 1 / 60) {
  const before = f.m.velocity.clone();
  f.m.update(dt, i, 0);
  f.r.update(dt, before, f.m, i, 0);
}
function reverse(f, angle = 180) {
  for (let n = 0; n < 40; n++) step(f, input());
  const a = (angle * Math.PI) / 180;
  step(f, input(Math.sin(a), Math.cos(a)));
}
test("broad actual-velocity reversal angles select back, diagonal and lateral visual recovery", () => {
  for (const [a, kind] of [
    [75, "lateral"],
    [95, "lateral"],
    [120, "diagonal"],
    [145, "diagonal"],
    [165, "back"],
    [180, "back"],
  ]) {
    const f = fixture();
    reverse(f, a);
    assert.equal(f.r.kind, kind, `angle ${a}`);
    assert.equal(f.r.sequence, 1);
    assert.ok(f.r.intensity > 0 && f.r.braking > 2);
    for (let n = 0; n < 40; n++)
      step(
        f,
        input(Math.sin((a * Math.PI) / 180), Math.cos((a * Math.PI) / 180)),
      );
    assert.equal(f.r.sequence, 1, "Held redirect is one recovery");
    assert.equal(f.r.weight, 0);
  }
});
test("gentle curves, low-speed direction changes and motion without braking do not exaggerate", () => {
  const f = fixture();
  reverse(f, 30);
  assert.equal(f.r.sequence, 0);
  for (let n = 0; n < 30; n++)
    step(f, input(Math.sin(n * 0.08), Math.cos(n * 0.08)));
  assert.equal(f.r.sequence, 0);
  const slow = fixture();
  for (let n = 0; n < 40; n++) step(slow, input(0, 0.2));
  step(slow, input(0, -0.2));
  assert.equal(slow.r.sequence, 0);
  const m = new CharacterController(new Group(), new ArenaBounds(20));
  m.velocity.set(0, 0, -5);
  const r = new MomentumRecovery();
  r.update(1 / 60, m.velocity, m, input(0, -1), 0);
  assert.equal(r.sequence, 0);
});
test("recovery intensity scales with actual speed and braking at extreme sandbox values", () => {
  const normal = fixture(),
    extreme = fixture({ movement: 100 });
  reverse(normal);
  reverse(extreme);
  assert.ok(extreme.r.intensity > normal.r.intensity);
  assert.ok(extreme.r.intensity <= 1);
  assert.ok(extreme.r.speed > 500);
  assert.ok(extreme.r.braking > normal.r.braking * 50);
});
test("observer never changes collision-resolved translation, dash, jump, heading or ability state", () => {
  for (const values of [
    {},
    { movement: 100, jumpHeight: 100, gravity: 20, airControl: 100 },
  ]) {
    const a = fixture(values),
      b = fixture(values);
    for (let n = 0; n < 300; n++) {
      if (n === 60 || n === 170) {
        a.m.requestJump();
        b.m.requestJump();
      }
      if (n === 75 || n === 190) {
        a.m.requestDash();
        b.m.requestDash();
      }
      const angle = Math.floor(n / 25) * 2.2,
        i = input(Math.sin(angle), Math.cos(angle));
      step(a, i);
      b.m.update(1 / 60, i, 0);
      assert.deepEqual(a.m.root.position, b.m.root.position);
      assert.deepEqual(a.m.velocity, b.m.velocity);
      assert.equal(a.m.heading, b.m.heading);
      assert.equal(a.m.airDashesRemaining, b.m.airDashesRemaining);
      assert.equal(a.m.jump.phase, b.m.jump.phase);
    }
    assert.ok(a.r.sequence > 0);
  }
});
test("airborne, active dash and released input cannot initiate ground recovery", () => {
  for (const kind of ["air", "dash", "released"]) {
    const f = fixture();
    for (let n = 0; n < 40; n++) step(f, input());
    if (kind === "air") f.m.jump.phase = "airborne";
    if (kind === "dash") f.m.requestDash();
    step(f, kind === "released" ? input(0, 0) : input(0, -1));
    assert.equal(f.r.sequence, 0);
  }
});
test("recovery reset releases its visual envelope and needs a fresh actual reversal", () => {
  const f = fixture();
  reverse(f);
  step(f, input(0, -1));
  assert.ok(f.r.weight > 0);
  f.r.reset();
  assert.equal(f.r.weight, 0);
  assert.equal(f.r.active, false);
});
test("fixed streak pool scales restrained effects, expires and never grows", () => {
  const s = new GroundStreaks(16),
    p = new Vector3(),
    d = new Vector3(0, 0, -1),
    items = s.items;
  s.emit(p, d, 0.2, 1.3);
  assert.equal(s.emissions, 0);
  s.emit(p, d, 0.6, 5.2);
  s.update(0.01);
  const length = Math.max(...s.items.map((p) => p.length));
  assert.equal(s.mesh.visible, true);
  for (let n = 0; n < 100; n++) s.emit(p, d, 1, 520);
  s.update(0.01);
  assert.equal(s.items, items);
  assert.equal(s.items.length, 16);
  assert.ok(Math.max(...s.items.map((p) => p.length)) > length);
  assert.ok(s.items.every((p) => Number.isFinite(p.length) && p.length < 1.1));
  s.update(1);
  assert.equal(s.mesh.visible, false);
  s.dispose();
});
test("manual Punch/Kick can start and switch during recovery without changing root or either limb availability", () => {
  for (const action of ["punch", "kick"])
    for (const side of ["left", "right"]) {
      const rig = new Stickman(),
        animator = new CharacterAnimator(rig),
        presenter = new AcrobaticPresenter(rig, animator),
        f = fixture(),
        selector = new ContextualLimbSelector(),
        combat = new CombatController({
          techniques: createAdaptiveTechniques(),
          selectTechnique: (c, e) => selector.choose(c, e),
        }),
        scheduler = new AttackScheduler(combat),
        rotation = new BodyRotation();
      reverse(f, 120);
      rig.root.position.copy(f.m.root.position);
      const root = rig.root.position.clone();
      scheduler.press(action);
      scheduler.prepare({
        environment: "ground",
        canAttack: true,
        lateralMovement: side === "left" ? -1 : 1,
      });
      assert.equal(combat.currentTechnique.side, side);
      for (let n = 0; n < 18; n++) {
        f.r.update(1 / 60, f.m.velocity, f.m, input(), 0);
        combat.update(1 / 60);
        presenter.begin(combat);
        animator.update(1 / 60, { speed: 0, combat, recovery: f.r });
        presenter.apply(1 / 60, rotation, combat);
        assert.deepEqual(rig.root.position, root);
        for (const j of Object.values(rig.joints))
          assert.ok(j.quaternion.toArray().every(Number.isFinite));
      }
      scheduler.press(action === "kick" ? "punch" : "kick");
      assert.ok(
        scheduler.prepare({
          environment: "ground",
          canAttack: true,
          lateralMovement: side === "left" ? -1 : 1,
        }),
      );
    }
});
test("stationary grounded kicks keep the supporting foot near the floor and balance over either leg", () => {
  for (const side of ["left", "right"]) {
    const rig = new Stickman(),
      animator = new CharacterAnimator(rig),
      selector = new ContextualLimbSelector(),
      combat = new CombatController({
        techniques: createAdaptiveTechniques(),
        selectTechnique: (c, e) => selector.choose(c, e),
      });
    combat.requestAttack({
      environment: "ground",
      action: "kick",
      lateralMovement: side === "left" ? -1 : 1,
    });
    for (let n = 0; n < 16; n++) {
      combat.update(1 / 60);
      animator.update(1 / 60, { combat });
    }
    const support = side === "left" ? "right" : "left",
      p = rig.joints[`${support}Ankle`].getWorldPosition(new Vector3());
    assert.ok(p.y >= 0.095 && p.y < 0.14, `${side}: support y=${p.y}`);
    assert.ok(Math.abs(p.x) < 0.4);
    assert.ok((support === "left" ? -1 : 1) * rig.joints.hips.position.x > 0);
  }
});
test("inverted coast is noticeable, continuously advances and responds to counter-pressure without changing gravity", () => {
  const rotations = [];
  for (const y of [-1, 0, 1]) {
    const f = fixture();
    f.m.jump.phase = "airborne";
    f.m.jump.height = 3;
    f.m.root.position.y = 3;
    f.m.jump.verticalVelocity = 0;
    const r = new BodyRotation();
    r.start("backflip", 0);
    r.orientation.setFromAxisAngle(new Vector3(1, 0, 0), Math.PI);
    r.angularVelocity.x = 8;
    const start = r.orientation.clone();
    for (let n = 0; n < 24; n++) r.update(1 / 120, f.m, input(0, y), 0);
    assert.ok(start.angleTo(r.orientation) > 0.05);
    assert.equal(f.m.root.position.y, 3);
    assert.equal(f.m.jump.config.gravity, 18);
    rotations.push(r.angularVelocity.x);
  }
  assert.ok(rotations[0] > rotations[1] + 2);
  assert.ok(rotations[1] > rotations[2] + 2);
});

test("defensive cancellation releases ground weight transfer smoothly without delaying Block", async () => {
  const { GroundCombatBalance } =
      await import("../src/character/GroundCombatBalance.js"),
    rig = new Stickman(),
    anim = new CharacterAnimator(rig),
    balance = new GroundCombatBalance(rig),
    combat = new CombatController({ techniques: createAdaptiveTechniques() });
  combat.requestAttack({ action: "kick", environment: "ground" });
  combat.update(0.2);
  for (let n = 0; n < 15; n++) balance.plan(1 / 60, combat, null, 0, anim.feet);
  const before = balance.drive * balance.weight;
  combat.setBlocking(true);
  balance.plan(1 / 60, combat, null, 0, anim.feet);
  assert.equal(combat.blocking, true);
  assert.equal(combat.attack.cancelled, true);
  assert.ok(balance.drive * balance.weight > before * 0.4);
  assert.ok(balance.drive * balance.weight < before);
  for (let n = 0; n < 45; n++) balance.plan(1 / 60, combat, null, 0, anim.feet);
  assert.ok(balance.weight < 0.001);
});

test("rapid recovery redirection retains compression instead of resetting the visual pose", async () => {
  const { MomentumRecoveryAnimator } =
      await import("../src/character/MomentumRecoveryAnimator.js"),
    rig = new Stickman(),
    animator = new CharacterAnimator(rig),
    layer = new MomentumRecoveryAnimator(rig);
  const state = {
    active: true,
    sequence: 1,
    weight: 1,
    intensity: 1,
    compression: 1,
    push: 0,
    kind: "back",
    side: 1,
    incoming: new Vector3(0, 0, -1),
  };
  for (let n = 0; n < 30; n++) layer.plan(1 / 60, state, animator.feet);
  const pose = {
    hipX: 0,
    hipY: 0.955,
    hipYaw: 0,
    spinePitch: 0,
    spineRoll: 0,
    spineYaw: 0,
    arms: [
      { z: 0, elbow: 0 },
      { z: 0, elbow: 0 },
    ],
  };
  layer.plan(
    1 / 120,
    { ...state, sequence: 2, weight: 0, compression: 0, side: -1 },
    animator.feet,
  );
  layer.apply(pose, state, new Quaternion());
  assert.ok(
    pose.hipY < 0.925,
    "The new recovery begins from the compressed body configuration",
  );
});

test("partial analogue reversals at superhuman speed still follow actual braking force", () => {
  const f = fixture({ movement: 100 });
  for (let n = 0; n < 40; n++) step(f, input(0, 0.15));
  assert.ok(f.m.speed > 5);
  step(f, input(0, -0.15));
  assert.equal(
    f.r.sequence,
    1,
    "A low stick magnitude must not hide forceful high-speed recovery",
  );
});
