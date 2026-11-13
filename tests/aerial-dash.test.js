import test from "node:test";
import assert from "node:assert/strict";
import { Group, Vector3 } from "three";
import { CharacterController } from "./helpers/ControllerFixture.js";
import { resolveMovementConfig } from "../src/movement/MovementConfig.js";
import { ArenaBounds } from "../src/world/ArenaBounds.js";
import { Stickman } from "../src/character/Stickman.js";
import { CharacterAnimator } from "../src/character/CharacterAnimator.js";
import { CombatController } from "../src/combat/CombatController.js";
import { ProximityCombatController } from "../src/combat/ProximityCombatController.js";

const controls = (x = 0, y = 0, sprinting = false) => ({
  move: { x, y },
  sprinting,
});
const rig = (options = {}, world = new ArenaBounds(100)) =>
  new CharacterController(new Group(), world, options);
const close = (a, b, tolerance = 1e-7) =>
  assert.ok(Math.abs(a - b) <= tolerance, `${a} ~= ${b}`);
const advance = (actor, seconds, input = controls(), dt = 1 / 60) => {
  for (let remaining = seconds; remaining > 1e-10;) {
    const step = Math.min(dt, remaining);
    actor.update(step, input, 0);
    remaining -= step;
  }
};
const jumpTo = (actor, time, input = controls(), dt) => {
  assert.equal(actor.requestJump(), true);
  advance(actor, time, input, dt);
  assert.equal(actor.jump.airborne, true);
};

test("ascent, apex and descent dashes begin immediately and integrate continuous distance at 30/60/120Hz", () => {
  for (const dt of [1 / 30, 1 / 60, 1 / 120])
    for (const time of [0.12, 0.375, 0.54]) {
      const actor = rig();
      const comparison = rig();
      jumpTo(actor, time, controls(), dt);
      jumpTo(comparison, time, controls(), dt);
      const start = actor.root.position.clone();
      assert.equal(actor.requestDash(), true);
      actor.update(dt, controls(), 0);
      comparison.update(dt, controls(), 0);
      assert.equal(actor.dash.mode, "air");
      assert.equal(actor.dash.active, true);
      assert.ok(actor.root.position.distanceTo(start) > 0);
      assert.ok(
        actor.dash.distanceTravelled > 0 && actor.dash.distanceTravelled < 2.5,
      );
      while (actor.dash.active) {
        actor.update(dt, controls(), 0);
        comparison.update(dt, controls(), 0);
        close(actor.jump.height, comparison.jump.height);
        close(actor.jump.verticalVelocity, comparison.jump.verticalVelocity);
        assert.ok(actor.root.position.y >= 0);
      }
      close(actor.dash.distanceTravelled, 2.5);
      assert.equal(actor.dash.exitReason, "completed");
      assert.ok(
        actor.velocity.length() > 2,
        "air exit retains horizontal momentum",
      );
    }
});

test("air entry and opposing joystick steering preserve momentum and obey turn-rate limits", () => {
  const actor = rig();
  advance(actor, 1, controls(0, 1, true));
  jumpTo(actor, 0.12, controls(0, 1, true));
  const oldDirection = actor.velocity.clone().normalize();
  actor.requestDash();
  actor.update(1 / 120, controls(1, 0, true), 0);
  assert.ok(
    actor.dash.direction.dot(oldDirection) > 0.99,
    "initial direction follows momentum instead of snapping sideways",
  );
  let previous = actor.dash.direction.clone();
  for (let i = 0; i < 20; i++) {
    actor.update(1 / 120, controls(1, 0, true), 0);
    assert.ok(previous.angleTo(actor.dash.direction) <= 9 / 120 + 1e-7);
    previous.copy(actor.dash.direction);
  }
  assert.ok(actor.dash.direction.x > 0.6, "joystick redirects the burst");
});

test("one aerial dash per jump rejects held/repeated requests and replenishes on touchdown", () => {
  const actor = rig();
  jumpTo(actor, 0.1);
  actor.requestDash();
  actor.update(1 / 60, controls(), 0);
  const sequence = actor.dash.sequence;
  while (actor.jump.airborne) {
    assert.equal(actor.requestDash(), false);
    actor.update(1 / 120, controls(), 0);
    assert.equal(actor.dash.sequence, sequence);
  }
  assert.equal(actor.airDashesRemaining, 1);
  advance(actor, 0.5);
  assert.equal(
    actor.dash.sequence,
    sequence,
    "rejected entries are never buffered",
  );
  assert.equal(actor.requestDash(), true);
  actor.update(1 / 60, controls(), 0);
  assert.equal(actor.dash.mode, "ground");
  assert.equal(actor.dash.sequence, sequence + 1);
  advance(actor, 0.3);
  jumpTo(actor, 0.12);
  assert.equal(
    actor.requestDash(),
    true,
    "next jump gets a fresh allowance despite ground cooldown",
  );
});

test("aerial dash allowance is configurable, including disabling it and permitting two", () => {
  const disabled = rig({ maxAerialDashes: 0 });
  jumpTo(disabled, 0.12);
  assert.equal(disabled.requestDash(), false);
  const actor = rig({ movementConfig: { maxAerialDashes: 2 } });
  jumpTo(actor, 0.1);
  actor.requestDash();
  advance(actor, 0.26);
  assert.equal(actor.jump.airborne, true);
  assert.equal(actor.airDashesRemaining, 1);
  assert.equal(actor.requestDash(), true);
  actor.update(1 / 60, controls(), 0);
  assert.equal(actor.airDashesRemaining, 0);
  assert.equal(actor.dash.sequence, 2);
  assert.equal(actor.requestDash(), false);
});

test("ground cooldown and aerial allowance are independent and pause never grants an extra dash", () => {
  const actor = rig();
  actor.requestDash();
  advance(actor, 0.26);
  assert.ok(actor.groundDash.cooldownRemaining > 0);
  jumpTo(actor, 0.12);
  assert.equal(actor.requestDash(), true);
  actor.update(1 / 60, controls(), 0);
  const height = actor.jump.height;
  const vertical = actor.jump.verticalVelocity;
  actor.stop();
  close(actor.jump.height, height);
  close(actor.jump.verticalVelocity, vertical);
  assert.equal(actor.requestDash(), false);
  advance(actor, 0.05);
  assert.equal(actor.airDashesRemaining, 0);
});

test("late descending dash flows through touchdown without resetting height or stopping its burst", () => {
  const actor = rig();
  jumpTo(actor, 0.62);
  actor.requestDash();
  let landedWhileDashing = false;
  for (let i = 0; i < 50; i++) {
    actor.update(1 / 120, controls(), 0);
    if (!actor.jump.airborne && actor.dash.active) landedWhileDashing = true;
    assert.ok(actor.root.position.y >= 0);
  }
  assert.ok(landedWhileDashing);
  close(actor.dash.distanceTravelled, 2.5);
  assert.equal(actor.jump.ready, true);
  assert.equal(
    actor.canDash,
    true,
    "ground dash becomes available after recovery",
  );
});

test("aerial sweeps cannot tunnel through arena walls or the training dummy", () => {
  for (const dt of [1 / 30, 1 / 60, 1 / 120])
    for (const obstacle of [false, true]) {
      const target = { position: new Vector3(0, 0, -1.2), radius: 0.32 };
      const world = obstacle
        ? new ArenaBounds(18, [target])
        : new ArenaBounds(1.2);
      const actor = rig({}, world);
      jumpTo(actor, 0.12, controls(), dt);
      actor.requestDash();
      for (let i = 0; i < Math.ceil(0.5 / dt); i++) {
        actor.update(dt, controls(), 0);
        if (obstacle)
          assert.ok(
            Math.hypot(actor.root.position.x, actor.root.position.z + 1.2) >=
              0.68 - 1e-8,
          );
        else assert.ok(Math.abs(actor.root.position.z) <= 0.84 + 1e-8);
        assert.ok(actor.root.position.y >= 0);
      }
      assert.equal(actor.dash.exitReason, "blocked");
    }
});

test("normal air steering resumes after the dash instead of freezing or retaining dash-speed control", () => {
  const actor = rig();
  jumpTo(actor, 0.1);
  actor.requestDash();
  advance(actor, 0.26);
  const exit = actor.velocity.clone();
  actor.update(1 / 60, controls(-1, 0), 0);
  assert.ok(actor.velocity.x < 0);
  assert.ok(
    actor.velocity.z < 0,
    "previous forward momentum survives initial left steering",
  );
  assert.ok(actor.velocity.distanceTo(exit) < 0.5);
});

test("an aerial dash into the dummy retains Block, suspends punches and reacquires after landing", () => {
  const dummy = {
    id: "training",
    position: new Vector3(0, 0, -0.9),
    radius: 0.32,
  };
  const actor = rig(
    { jumpConfig: { height: 0.8 } },
    new ArenaBounds(18, [dummy]),
  ); // Authored legacy proximity range.
  const combat = new CombatController();
  const proximity = new ProximityCombatController(combat, { targets: [dummy] });
  const step = (blocking = false) => {
    actor.update(1 / 60, controls(), 0, proximity.target?.position);
    proximity.update(1 / 60, {
      position: actor.root.position,
      facing: actor.heading,
      blocking,
      grounded:
        actor.jump.ready && !(actor.dash.active && actor.dash.mode === "air"),
    });
  };
  step();
  assert.equal(combat.attack.sequence, 1);
  actor.requestJump();
  for (let i = 0; i < 9; i++) step(true);
  assert.equal(actor.requestDash(), true);
  do {
    step(true);
    assert.equal(combat.blocking, true);
    assert.equal(combat.attack.sequence, 1);
    assert.ok(
      proximity.target,
      "Proximity stays live while manual Block suppresses attacks",
    );
  } while (!actor.jump.ready);
  assert.equal(actor.dash.exitReason, "blocked");
  assert.ok(proximity.target);
  assert.ok(actor.root.position.distanceTo(dummy.position) >= 0.68 - 1e-7);
  step();
  assert.equal(combat.blocking, false);
  assert.equal(combat.attack.sequence, 2);
});

test("movement profiles expose functional speed, distance, gravity and locomotion tuning", () => {
  const config = resolveMovementConfig();
  close(config.groundDash.distance, 2.5);
  close(config.groundDash.duration, 0.25);
  close(config.groundDash.cooldown, 0.7);
  close(config.groundDash.speed, 10);
  const actor = rig({
    movementConfig: {
      groundDash: { distance: 3, speed: 6 },
      aerialDash: { distance: 1.5, speed: 12 },
      locomotion: { walkSpeed: 0.7, runSpeed: 3, sprintSpeed: 6 },
      jump: { height: 1, gravity: 12 },
    },
  });
  advance(actor, 2, controls(0, 0.5));
  close(actor.velocity.length(), 0.7, 0.001);
  advance(actor, 2, controls(0, 1));
  close(actor.velocity.length(), 3, 0.001);
  advance(actor, 2, controls(0, 1, true));
  close(actor.velocity.length(), 6, 0.001);
  close(actor.groundDash.config.duration, 0.5);
  close(actor.airDash.config.duration, 0.125);
  close(actor.jump.config.height, 1);
  close(actor.jump.config.gravity, 12);
  for (const bad of [-1, 0.5, NaN])
    assert.throws(() => rig({ maxAerialDashes: bad }));
  assert.throws(() => rig({ movementConfig: { aerialDash: { speed: 0 } } }));
});

test("aerial animation leans, keeps airborne feet above floor, respects Block and blends through landing", () => {
  for (const time of [0.12, 0.38, 0.6]) {
    const character = new Stickman();
    const actor = new CharacterController(character.root, new ArenaBounds(100));
    const animator = new CharacterAnimator(character);
    const step = (blocking = false) => {
      actor.update(1 / 60, controls(0.5, 0.8), 0);
      const position = character.root.position.clone();
      animator.update(1 / 60, {
        speed: actor.speed,
        jump: actor.jump,
        dash: actor.dash,
        blocking,
      });
      assert.ok(character.root.position.equals(position));
      for (const joint of Object.values(character.joints))
        assert.ok(
          [...joint.position, ...joint.quaternion].every(Number.isFinite),
        );
      for (const side of ["left", "right"])
        assert.ok(
          character.joints[`${side}Ankle`].getWorldPosition(new Vector3()).y >=
            0.09,
        );
    };
    actor.requestJump();
    for (let i = 0; i < Math.round(time * 60); i++) step();
    actor.requestDash();
    let visible = false;
    for (let i = 0; i < 90; i++) {
      step(i > 4 && i < 20);
      visible ||= animator.airDashWeight > 0.2;
    }
    assert.ok(visible);
    assert.equal(actor.jump.ready, true);
    assert.equal(animator.airDashWeight, 0);
    character.dispose();
  }
});
