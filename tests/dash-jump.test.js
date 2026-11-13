import test from "node:test";
import assert from "node:assert/strict";
import { Group, Vector3 } from "three";
import { CharacterController } from "./helpers/ControllerFixture.js";
import { ArenaBounds } from "../src/world/ArenaBounds.js";
import { Stickman } from "../src/character/Stickman.js";
import { CharacterAnimator } from "../src/character/CharacterAnimator.js";

const controls = (x = 0, y = 0, sprinting = false) => ({
  move: { x, y },
  sprinting,
});
const rig = (world = new ArenaBounds(100), options = {}) =>
  new CharacterController(new Group(), world, options);
const close = (a, b, tolerance = 1e-7) =>
  assert.ok(Math.abs(a - b) < tolerance, `${a} ~= ${b}`);
const advance = (actor, seconds, input = controls(), dt = 1 / 60) => {
  for (let remaining = seconds; remaining > 1e-10;) {
    const step = Math.min(dt, remaining);
    actor.update(step, input, 0);
    remaining -= step;
  }
};

test("Jump interrupts the beginning, middle and end of ground Dash without stacking or teleporting at 30/60/120Hz", () => {
  for (const dt of [1 / 30, 1 / 60, 1 / 120])
    for (const time of [1 / 120, 0.125, 0.249]) {
      const actor = rig();
      actor.requestDash();
      advance(actor, time, controls(), dt);
      assert.equal(actor.groundDash.active, true);
      const position = actor.root.position.clone();
      const velocity = actor.velocity.clone();
      const elapsed = actor.groundDash.elapsed;
      const travelled = actor.groundDash.distanceTravelled;
      const cooldown = actor.groundDash.cooldownRemaining;
      assert.equal(actor.canJump, true);
      assert.equal(actor.requestJump(), true);
      assert.ok(actor.root.position.equals(position));
      actor.update(dt, controls(), 0);
      assert.equal(actor.jump.sequence, 1);
      assert.equal(actor.groundDash.active, false);
      assert.equal(actor.groundDash.exitReason, "jumped");
      close(actor.groundDash.elapsed, elapsed);
      close(actor.groundDash.distanceTravelled, travelled);
      close(actor.groundDash.cooldownRemaining, cooldown - dt);
      const response = actor.jump.config.airDrag;
      close(
        actor.velocity.length(),
        velocity.length() * Math.exp(-response * dt),
      );
      close(
        actor.root.position.distanceTo(position),
        (velocity.length() * (1 - Math.exp(-response * dt))) / response,
      );
      assert.equal(actor.airDashesRemaining, 1);
      advance(actor, 0.12, controls(), dt);
      assert.equal(actor.jump.airborne, true);
      assert.equal(
        actor.groundDash.elapsed,
        elapsed,
        "Cancelled acceleration never resumes",
      );
    }
});

test("normal and sprint Dash -> Jump -> Air Dash chains preserve momentum and independent availability", () => {
  for (const sprint of [false, true]) {
    const actor = rig();
    const input = controls(0.6, 0.8, sprint);
    advance(actor, 0.5, input);
    actor.requestDash();
    advance(actor, 0.12, input);
    const dashVelocity = actor.velocity.length();
    actor.requestJump();
    actor.update(1 / 60, input, 0);
    assert.ok(actor.velocity.length() > dashVelocity * 0.9);
    advance(actor, 0.1, input);
    assert.equal(actor.jump.airborne, true);
    assert.ok(actor.groundDash.cooldownRemaining > 0);
    assert.equal(actor.airDashesRemaining, 1);
    assert.equal(actor.requestDash(), true);
    actor.update(1 / 60, input, 0);
    assert.equal(actor.dash.mode, "air");
    assert.equal(actor.dash.sequence, 2);
    assert.equal(actor.airDashesRemaining, 0);
    while (actor.dash.active) actor.update(1 / 60, input, 0);
    close(actor.dash.distanceTravelled, 2.5);
    while (!actor.jump.ready) {
      assert.equal(actor.canJump, actor.jump.airborne);
      assert.equal(actor.requestDash(), false);
      actor.update(1 / 60, input, 0);
    }
    assert.equal(actor.airDashesRemaining, 1);
    assert.equal(actor.requestDash(), true);
    actor.update(1 / 60, input, 0);
    assert.equal(actor.dash.mode, "ground");
    assert.equal(actor.dash.sequence, 3);
  }
});

test("rapid ground Dash and Jump entries resolve in order without a free extra impulse or buffered repeats", () => {
  const actor = rig();
  assert.equal(actor.requestDash(), true);
  assert.equal(actor.requestJump(), true);
  assert.equal(actor.requestJump(), false);
  assert.equal(actor.requestDash(), false);
  actor.update(1 / 60, controls(), 0);
  assert.equal(actor.groundDash.sequence, 1);
  assert.equal(actor.groundDash.active, false);
  assert.equal(actor.groundDash.exitReason, "jumped");
  assert.equal(actor.jump.sequence, 1);
  assert.equal(actor.velocity.length(), 0);
  assert.ok(actor.root.position.equals(new Vector3()));
  advance(actor, 1.2);
  assert.equal(actor.jump.sequence, 1);
  assert.equal(actor.dashSequence, 1);
  assert.equal(actor.jump.ready, true);
});

test("an exhausted jump allowance rejects Jump through an air burst touchdown", () => {
  const actor = rig(new ArenaBounds(100), {
    jumpConfig: { height: 0.8, maxJumps: 1, landingDuration: 0 },
  });
  actor.requestJump();
  advance(actor, 0.64);
  actor.requestDash();
  do {
    actor.update(1 / 120, controls(), 0);
    assert.equal(actor.canJump, false);
    assert.equal(actor.requestJump(), false);
  } while (actor.jump.airborne);
  assert.equal(actor.jump.ready, true);
  assert.equal(actor.dash.active, true);
  assert.equal(actor.requestJump(), false);
  advance(actor, 0.3);
  assert.equal(actor.canJump, true);
  assert.equal(actor.jump.sequence, 1);
});

test("interrupted dash momentum and a subsequent air burst stay inside walls and dummy collision", () => {
  for (const dt of [1 / 30, 1 / 60, 1 / 120])
    for (const dummy of [
      null,
      { position: new Vector3(0, 0, -1.4), radius: 0.32 },
    ]) {
      const actor = rig(
        dummy ? new ArenaBounds(18, [dummy]) : new ArenaBounds(1.2),
      );
      actor.requestDash();
      advance(actor, 0.05, controls(), dt);
      actor.requestJump();
      let requestedAir = false;
      for (let i = 0; i < Math.ceil(1.4 / dt); i++) {
        if (actor.jump.airborne && !requestedAir) {
          assert.equal(actor.requestDash(), true);
          requestedAir = true;
        }
        const before = actor.root.position.clone();
        actor.update(dt, controls(), 0);
        assert.ok(actor.root.position.distanceTo(before) < 20 * dt);
        assert.ok(actor.root.position.y >= 0);
        if (dummy)
          assert.ok(
            Math.hypot(actor.root.position.x, actor.root.position.z + 1.4) >=
              0.68 - 1e-7,
          );
        else assert.ok(Math.abs(actor.root.position.z) <= 0.84 + 1e-7);
      }
      assert.ok(requestedAir);
      assert.equal(actor.jump.ready, true);
      assert.equal(actor.airDashesRemaining, 1);
      assert.equal(actor.root.position.y, 0);
    }
});

test("dash recovery yields foot contacts to Jump while its body pose blends out", () => {
  const character = new Stickman();
  const actor = new CharacterController(character.root, new ArenaBounds(100));
  const animator = new CharacterAnimator(character);
  const step = () => {
    actor.update(1 / 60, controls(0, 1), 0);
    animator.update(1 / 60, {
      speed: actor.speed,
      jump: actor.jump,
      dash: actor.dash,
    });
  };
  step();
  actor.requestDash();
  for (let i = 0; i < 6; i++) step();
  actor.requestJump();
  actor.update(1 / 60, controls(0, 1), 0);
  const contacts = animator.footList.map((foot) => foot.target.clone());
  animator.dashAnimation.update(
    1 / 60,
    actor.dash,
    animator.footList,
    0,
    false,
  );
  for (let i = 0; i < 2; i++)
    assert.ok(animator.footList[i].target.equals(contacts[i]));
  assert.ok(
    animator.dashAnimation.weight > 0 && animator.dashAnimation.weight < 1,
  );
  assert.ok(Math.min(...contacts.map((foot) => foot.y)) > 0.12);
  animator.jumpAnimation.update(
    1 / 60,
    actor.jump,
    animator.footList,
    actor.velocity,
    0,
    false,
  );
  const support = animator.footList[animator.jumpAnimation.support];
  assert.ok(
    support.target.y > 0.12,
    "An elevated dash foot loads gradually instead of snapping to the floor",
  );
  assert.equal(support.planted, false);
  character.dispose();
});

test("interrupted dash, jump, air dash and landing animations keep finite joints and root ownership", () => {
  for (const rate of [30, 60, 120])
    for (const time of [1 / rate, 0.125, 0.24]) {
      const character = new Stickman();
      const actor = new CharacterController(
        character.root,
        new ArenaBounds(100),
      );
      const animator = new CharacterAnimator(character);
      const step = () => {
        actor.update(1 / rate, controls(0.4, 0.9, true), 0);
        const position = character.root.position.clone();
        animator.update(1 / rate, {
          speed: actor.speed,
          jump: actor.jump,
          dash: actor.dash,
          blocking: true,
        });
        assert.ok(character.root.position.equals(position));
        for (const joint of Object.values(character.joints))
          assert.ok(
            [...joint.position, ...joint.quaternion].every(Number.isFinite),
          );
        for (const side of ["left", "right"])
          assert.ok(
            character.joints[`${side}Ankle`].getWorldPosition(new Vector3())
              .y >= 0.09,
          );
      };
      step();
      actor.requestDash();
      for (let i = 0; i < Math.max(1, Math.round(time * rate)); i++) step();
      actor.requestJump();
      do {
        step();
      } while (!actor.jump.airborne);
      actor.requestDash();
      for (let i = 0; i < rate * 1.3; i++) step();
      assert.equal(actor.jump.ready, true);
      assert.equal(animator.jumpWeight, 0);
      assert.equal(animator.airDashWeight, 0);
      character.dispose();
    }
});
