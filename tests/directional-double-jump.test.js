import test from "node:test";
import assert from "node:assert/strict";
import { Group, Quaternion, Vector3 } from "three";
import {
  JumpState,
  JUMP_CONFIG,
  ORIGINAL_JUMP_HEIGHT,
  DEFAULT_JUMP_HEIGHT_MULTIPLIER,
} from "../src/movement/JumpState.js";
import { CharacterController } from "../src/movement/CharacterController.js";
import { selectDoubleJumpFlip } from "../src/movement/JoystickGestures.js";
import { BodyRotation } from "../src/movement/BodyRotation.js";
import { ArenaBounds } from "../src/world/ArenaBounds.js";
import {
  sandboxMovementConfig,
  NORMAL_PHYSICS,
  movementSubsteps,
} from "../src/sandbox/PhysicsSandbox.js";
import { Stickman } from "../src/character/Stickman.js";
import { CharacterAnimator } from "../src/character/CharacterAnimator.js";
import { AcrobaticPresenter } from "../src/character/AcrobaticPresenter.js";
import { CombatController } from "../src/combat/CombatController.js";
import { AttackScheduler } from "../src/combat/AttackScheduler.js";
import {
  createAdaptiveTechniques,
  ContextualLimbSelector,
} from "../src/combat/AdaptiveTechniques.js";
import { StrikeHitDetector } from "../src/combat/StrikeHitDetector.js";
import { createCombatContext } from "../src/combat/CombatContext.js";
import { Game } from "../src/core/Game.js";
const close = (a, b, e = 1e-8) =>
  assert.ok(Math.abs(a - b) < e, `${a} ~= ${b}`);
const input = (x = 0, y = 0) => ({
  move: { x, y },
  movementMagnitude: Math.min(1, Math.hypot(x, y)),
  blocking: false,
});
function controller(values = {}) {
  const c = new CharacterController(new Group(), new ArenaBounds(10000));
  c.applyMovementConfig(sandboxMovementConfig(values));
  return c;
}
function advance(c, t, i = input(), dt = 1 / 120, yaw = 0) {
  for (let left = t; left > 1e-9;) {
    const d = Math.min(dt, left);
    c.update(d, i, yaw);
    left -= d;
  }
}
function game(values = {}) {
  const character = new Stickman(),
    controller = new CharacterController(character.root, new ArenaBounds(24)),
    selector = new ContextualLimbSelector(),
    combat = new CombatController({
      techniques: createAdaptiveTechniques(),
      selectTechnique: (c, e) => selector.choose(c, e),
    }),
    animator = new CharacterAnimator(character);
  controller.applyMovementConfig(sandboxMovementConfig(values));
  return {
    character,
    controller,
    combat,
    animator,
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
    input: input(),
  };
}
function tick(g, dt = 1 / 60) {
  const count = movementSubsteps(g.controller, dt);
  for (let n = 0; n < count; n++)
    Game.prototype.simulateMovement.call(g, dt / count);
  g.acrobaticPresenter.begin(g.combat);
  g.animator.update(dt, {
    speed: g.controller.speed,
    jump: g.controller.jump,
    dash: g.controller.dash,
    combat: g.combat,
  });
  g.acrobaticPresenter.apply(dt, g.bodyRotation, g.combat);
}
function run(g, t, dt = 1 / 60) {
  for (let left = t; left > 1e-9;) {
    const d = Math.min(dt, left);
    tick(g, d);
    left -= d;
  }
}
test("new default scales the actual sandbox height parameter once, with 1x using the new baseline", () => {
  assert.equal(DEFAULT_JUMP_HEIGHT_MULTIPLIER, 1.5);
  close(JUMP_CONFIG.height, ORIGINAL_JUMP_HEIGHT * 1.5);
  close(JUMP_CONFIG.gravity, 18);
  close(JUMP_CONFIG.airControl, 3.5);
  const normal = sandboxMovementConfig(NORMAL_PHYSICS);
  close(normal.jump.height, JUMP_CONFIG.height);
  close(
    sandboxMovementConfig({ jumpHeight: 1.48 }).jump.height,
    JUMP_CONFIG.height * 1.48,
  );
  close(
    new JumpState().launchVelocity,
    Math.sqrt(2 * 18 * ORIGINAL_JUMP_HEIGHT * 1.5),
  );
});
test("second launch replaces vertical velocity identically in ascent and descent without changing height", () => {
  for (const at of [0.12, 0.6]) {
    const j = new JumpState();
    j.start();
    j.advance(at);
    assert.ok(j.airborne);
    const y = j.height,
      launch = j.flightLaunchVelocity;
    assert.equal(j.start(), true);
    close(j.height, y);
    close(j.verticalVelocity, launch);
    assert.equal(j.jumpCount, 2);
    assert.equal(j.start(), false);
    assert.equal(j.sequence, 2);
  }
});
test("landing resets the allowance while takeoff/landing inputs cannot buffer extra jumps", () => {
  const j = new JumpState();
  j.start();
  assert.equal(j.start(), false);
  j.advance(0.12);
  j.start();
  assert.equal(j.canJump, false);
  j.advance(j.timeToBoundary);
  assert.equal(j.phase, "landing");
  assert.equal(j.jumpCount, 0);
  assert.equal(j.start(), false);
  j.advance(j.config.landingDuration);
  assert.equal(j.start(), true);
  assert.equal(j.jumpCount, 1);
});
test("both launches use the same current Jump configuration across extreme height and gravity modifiers", () => {
  for (const h of [0.1, 1, 1.48, 20, 100])
    for (const gravity of [0.1, 1, 100]) {
      const c = controller({ jumpHeight: h, gravity }),
        expected = Math.sqrt(2 * JUMP_CONFIG.height * h * 18 * gravity);
      c.requestJump();
      advance(c, c.jump.config.takeoffDuration + 1e-5);
      close(c.jump.flightLaunchVelocity, expected);
      c.requestJump();
      c.update(1e-6, input(), 0);
      close(c.jump.flightLaunchVelocity, expected);
      close(c.jump.verticalVelocity, expected - c.jump.config.gravity * 1e-6);
      assert.equal(c.jump.jumpCount, 2);
      advance(c, c.jump.timeToBoundary + c.jump.config.landingDuration + 0.01);
      assert.equal(c.jump.jumpCount, 0);
      assert.ok(c.jump.ready);
    }
});
test("live jump tuning changes the next midair launch without teleporting or double-applying baseline", () => {
  const c = controller();
  c.requestJump();
  advance(c, 0.2);
  const before = c.root.position.clone(),
    velocity = c.jump.verticalVelocity;
  c.applyMovementConfig(sandboxMovementConfig({ jumpHeight: 4 }));
  assert.deepEqual(c.root.position, before);
  close(c.jump.verticalVelocity, velocity);
  c.requestJump();
  c.update(1e-6, input(), 0);
  close(
    c.jump.flightLaunchVelocity,
    Math.sqrt(2 * 18 * JUMP_CONFIG.height * 4),
  );
  assert.ok(
    c.root.position.y > before.y && c.root.position.y - before.y < 0.0001,
  );
});
test("directional selection accepts forward/backward diagonals and keeps neutral/strafe upright", () => {
  for (const [x, y, expected] of [
    [0, 1, "frontflip"],
    [0, -1, "backflip"],
    [0.707, 0.707, "frontflip"],
    [-0.707, -0.707, "backflip"],
    [0.9, 0.4, "frontflip"],
    [0, 0, null],
    [1, 0, null],
  ])
    assert.equal(selectDoubleJumpFlip(input(x, y), 0, 0), expected);
  assert.equal(selectDoubleJumpFlip(input(-1, 0), 0, Math.PI / 2), "frontflip");
  assert.equal(selectDoubleJumpFlip(input(1, 0), 0, Math.PI / 2), "backflip");
  assert.equal(
    selectDoubleJumpFlip(input(0, 1), Math.PI / 2, Math.PI / 2),
    "frontflip",
  );
});
test("accepted second Jump starts front/back rotation immediately in the real simulation, neutral does not", () => {
  for (const [x, y, kind] of [
    [0, 1, "frontflip"],
    [0, -1, "backflip"],
    [0.707, 0.707, "frontflip"],
    [-0.707, -0.707, "backflip"],
    [0, 0, null],
  ]) {
    const g = game();
    g.controller.requestJump();
    run(g, 0.15);
    g.input = input(x, y);
    const before = g.character.root.position.clone();
    assert.equal(g.controller.requestJump(g.input, 0), true);
    tick(g);
    assert.equal(g.controller.jump.jumpCount, 2);
    assert.equal(g.bodyRotation.lastKind, kind ?? "none");
    assert.equal(g.bodyRotation.sequence, kind ? 1 : 0);
    if (kind)
      assert.ok(
        (kind === "frontflip" ? -1 : 1) * g.bodyRotation.angularVelocity.x > 0,
      );
    assert.ok(g.character.root.position.y > before.y);
    assert.ok(
      g.character.root.position.y - before.y <
        g.controller.jump.launchVelocity / 60 + 0.001,
    );
  }
});
test("take-off facing stays stable through later steering, camera orbit and captured press intent", () => {
  const c = controller();
  c.requestJump(input(1, 0), 0);
  c.update(0.1, input(1, 0), 0);
  close(c.jumpReferenceYaw, -Math.PI / 2);
  advance(c, 0.2, input(-1, 0));
  c.requestJump(input(1, 0), 0);
  c.update(1 / 120, input(-1, 0), 0);
  assert.equal(
    c.jumpEvent.kind,
    "frontflip",
    "Direction is captured at the press, before a later steer sample",
  );
  close(c.jumpEvent.referenceYaw, -Math.PI / 2);
});
test("joystick flicks and ordinary air steering never initiate flips or attacks", () => {
  const g = game({ jumpHeight: 20 });
  g.controller.requestJump();
  run(g, 0.15);
  for (let n = 0; n < 90; n++) {
    g.input = input(Math.sin(n), n % 2 ? 1 : -1);
    tick(g);
  }
  assert.equal(g.controller.jump.sequence, 1);
  assert.equal(g.bodyRotation.sequence, 0);
  assert.equal(g.combat.attack.sequence, 0);
});
test("double Jump preserves horizontal momentum and does not refill or cancel the aerial dash", () => {
  const a = controller(),
    b = controller();
  for (const c of [a, b]) {
    c.velocity.set(0, 0, -5.2);
    c.requestJump();
    advance(c, 0.15, input());
    assert.equal(c.requestDash(), true);
    c.update(1 / 120, input(0, 1), 0);
  }
  assert.equal(a.requestJump(), true);
  for (let n = 0; n < 10; n++) {
    a.update(1 / 120, input(0.6, 0.8), 0);
    b.update(1 / 120, input(0.6, 0.8), 0);
    close(a.root.position.x, b.root.position.x);
    close(a.root.position.z, b.root.position.z);
    assert.deepEqual(a.velocity, b.velocity);
    assert.equal(a.airDashesUsed, 1);
    assert.equal(a.canDash, false);
  }
  assert.equal(a.jump.jumpCount, 2);
  assert.equal(a.requestJump(), false);
});
test("Punch and Kick stay responsive through first jump, double-jump flips, steering and transitions", () => {
  for (const action of ["punch", "kick"])
    for (const flipDirection of [-1, 1]) {
      const g = game({ jumpHeight: 4 });
      g.input = input(0, 1);
      g.controller.requestJump();
      run(g, 0.15);
      g.attackScheduler.press(action);
      tick(g);
      assert.equal(g.combat.currentTechnique.action, action);
      assert.equal(g.combat.attack.context.environment, "air");
      run(g, 0.18);
      const before = g.character.root.position.clone();
      g.input = input(0.25, flipDirection);
      g.controller.requestJump(g.input, 0);
      tick(g);
      assert.ok(g.bodyRotation.flipping);
      assert.ok(g.character.root.position.distanceTo(before) > 0);
      g.attackScheduler.press(action === "punch" ? "kick" : "punch");
      tick(g);
      assert.equal(
        g.combat.currentTechnique.action,
        action === "punch" ? "kick" : "punch",
      );
      assert.equal(g.combat.attack.cancelled, false);
      g.input.blocking = true;
      tick(g);
      assert.equal(g.combat.blocking, true);
      assert.equal(g.combat.attack.cancelled, true);
    }
});
test("double-jump physics, mirrored flip poses and landing stay finite across frame rates at 100x", () => {
  for (const dt of [1 / 30, 1 / 60, 1 / 144])
    for (const direction of [-1, 1]) {
      const g = game({ movement: 100, jumpHeight: 100, gravity: 100 });
      g.input = input(0.6, 0.8);
      g.controller.requestJump();
      run(g, 0.18, dt);
      g.input = input(0.25, direction);
      g.controller.requestJump(g.input, 0);
      tick(g, dt);
      assert.equal(g.controller.jump.jumpCount, 2);
      for (let n = 0; n < Math.ceil(3 / dt); n++) {
        tick(g, dt);
        assert.ok(g.character.root.position.toArray().every(Number.isFinite));
        assert.ok(g.character.root.position.y >= 0);
        assert.ok(g.bodyRotation.orientation.toArray().every(Number.isFinite));
        for (const j of Object.values(g.character.joints))
          assert.ok(j.quaternion.toArray().every(Number.isFinite));
      }
      assert.ok(g.controller.jump.ready);
      assert.equal(g.controller.jump.jumpCount, 0);
      assert.equal(g.bodyRotation.phase, "idle");
    }
});
