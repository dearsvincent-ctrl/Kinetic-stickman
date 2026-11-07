import test from "node:test";
import assert from "node:assert/strict";
import { Group, Quaternion, Vector3 } from "three";
import {
  CombatController,
  BASIC_PUNCH,
  CROSS_PUNCH,
  FLYING_KICK,
} from "../src/combat/CombatController.js";
import { ProximityCombatController } from "../src/combat/ProximityCombatController.js";
import {
  createCombatContext,
  updateCombatContext,
} from "../src/combat/CombatContext.js";
import { CharacterController } from "./helpers/ControllerFixture.js";
import { ArenaBounds } from "../src/world/ArenaBounds.js";
import { Stickman } from "../src/character/Stickman.js";
import { CharacterAnimator } from "../src/character/CharacterAnimator.js";

const close = (a, b, tolerance = 1e-8) =>
  assert.ok(Math.abs(a - b) < tolerance, `${a} ~= ${b}`);
const target = (x = 0, z = -0.9, y = 0) => ({
  id: "dummy",
  position: new Vector3(x, y, z),
  radius: 0.32,
  strikeHeight: 1.4,
  strikeRadius: 0.24,
});
const air = (height = 0.5, extra = {}) => ({
  environment: "air",
  phase: "airborne",
  height,
  airTimeRemaining: 0.5,
  canAttack: true,
  ...extra,
});
const fixture = (dummy = target(), options = {}, combatOptions = {}) => {
  const combat = new CombatController(combatOptions);
  const proximity = new ProximityCombatController(combat, {
    targets: [dummy],
    ...options,
  });
  return { combat, proximity, dummy };
};
const options = (height = 0.5, context = air(height)) => ({
  position: new Vector3(0, height, 0),
  facing: 0,
  grounded: false,
  context,
});
const finish = (proximity, opts, dt = 1 / 120) => {
  for (let i = 0; proximity.combat.attack.active && i < 200; i++)
    proximity.update(dt, opts);
  assert.equal(proximity.combat.attack.active, false);
};

test("airborne proximity selects a flying kick using three-dimensional body-surface reach", () => {
  const { combat, proximity } = fixture();
  proximity.update(1 / 60, options(0.7));
  assert.equal(combat.attack.techniqueId, FLYING_KICK.id);
  assert.equal(combat.attack.context.environment, "air");
  const ctx = combat.attack.context;
  close(ctx.opponentDistance, Math.hypot(0.9, -0.2));
  close(ctx.surfaceDistance, ctx.opponentDistance - 0.24);
  close(ctx.verticalSeparation, -0.2);
  assert.ok(ctx.targetDirection.y < 0);
  close(Math.hypot(...Object.values(ctx.targetDirection)), 1);
  assert.ok(Object.isFrozen(ctx.targetPoint));
});

test("excessive vertical, diagonal and behind-target separation cannot trigger an air technique", () => {
  for (const [dummy, opts] of [
    [target(0, -0.9, 2), options()],
    [target(0, -0.9, -2), options()],
    [target(0, -1.0), options(0.9)],
    [target(), { ...options(), facing: Math.PI }],
    [target(), { ...options(), facing: Math.PI / 2 }],
  ]) {
    const { combat, proximity } = fixture(dummy);
    proximity.update(1 / 60, opts);
    assert.equal(combat.attack.sequence, 0);
  }
});

test("exact aerial reach is accepted while the next millimetre and a short remaining flight are rejected", () => {
  for (const [distance, remaining, accepted] of [
    [1.05, 0.5, true],
    [1.051, 0.5, false],
    [0.9, 0.1, false],
  ]) {
    const { combat, proximity } = fixture(target(0, -distance));
    proximity.update(
      1 / 60,
      options(0.5, air(0.5, { airTimeRemaining: remaining })),
    );
    assert.equal(combat.attack.active, accepted);
  }
});

test("aerial exit hysteresis never extends actual technique reach or queues out-of-range attacks", () => {
  const { combat, proximity, dummy } = fixture();
  const opts = options();
  proximity.update(1 / 60, opts);
  dummy.position.z = -1.1;
  finish(proximity, opts);
  assert.equal(proximity.target, dummy);
  for (let i = 0; i < 120; i++) proximity.update(1 / 120, opts);
  assert.equal(combat.attack.sequence, 1);
  dummy.position.z = -1.21;
  proximity.update(1 / 60, opts);
  assert.equal(proximity.target, null);
  dummy.position.z = -0.9;
  proximity.update(1 / 60, opts);
  assert.equal(combat.attack.sequence, 2);
});

test("moving an airborne target above or below reach immediately ends eligibility", () => {
  const { combat, proximity, dummy } = fixture();
  const opts = options();
  proximity.update(1 / 60, opts);
  dummy.position.y = 3;
  finish(proximity, opts);
  assert.equal(proximity.target, null);
  assert.equal(combat.attack.sequence, 1);
  dummy.position.y = -3;
  for (let i = 0; i < 60; i++) proximity.update(1 / 60, opts);
  assert.equal(combat.attack.sequence, 1);
});

test("the flying kick has wind-up, extension, impact and recovery at 30/60/120Hz without stacking", () => {
  for (const dt of [1 / 30, 1 / 60, 1 / 120]) {
    const { combat, proximity } = fixture();
    proximity.update(0.001, options());
    const phases = new Set([combat.attack.phase]);
    let previous = combat.attack.extension;
    while (combat.attack.active) {
      assert.equal(combat.requestAttack(), false);
      combat.update(dt);
      phases.add(combat.attack.phase);
      assert.ok(combat.attack.extension >= 0 && combat.attack.extension <= 1);
      if (combat.attack.phase === "impact") close(combat.attack.extension, 1);
      if (combat.attack.phase === "extension")
        assert.ok(combat.attack.extension >= previous);
      previous = combat.attack.extension;
      assert.equal(combat.attack.sequence, 1);
    }
    for (const phase of ["windup", "extension", "impact", "recovery", "idle"])
      assert.ok(phases.has(phase));
    close(
      combat.attack.elapsed,
      FLYING_KICK.windup +
        FLYING_KICK.extension +
        FLYING_KICK.impact +
        FLYING_KICK.recovery,
    );
  }
});

test("ground strikes vary predictably only after full recovery and according to approach distance", () => {
  const { combat, proximity } = fixture(target(0, -0.75));
  const opts = { position: new Vector3(), facing: 0 };
  proximity.update(0.001, opts);
  assert.equal(combat.attack.techniqueId, BASIC_PUNCH.id);
  finish(proximity, opts);
  proximity.update(0.001, opts);
  assert.equal(combat.attack.techniqueId, CROSS_PUNCH.id);
  finish(proximity, opts);
  proximity.update(0.001, opts);
  assert.equal(combat.attack.techniqueId, BASIC_PUNCH.id);
  const approaching = fixture(target(0, -0.8));
  approaching.proximity.update(0.001, { ...opts, context: { speed: 3 } });
  assert.equal(approaching.combat.attack.techniqueId, CROSS_PUNCH.id);
  const farther = fixture();
  farther.proximity.update(0.001, { ...opts, context: { speed: 5.2 } });
  assert.equal(farther.combat.attack.techniqueId, BASIC_PUNCH.id);
});

test("manual Block suppresses, cancels and resumes eligible aerial attacks without changing target tracking", () => {
  const { combat, proximity, dummy } = fixture();
  const opts = options();
  proximity.update(0.1, { ...opts, blocking: true });
  assert.equal(proximity.target, dummy);
  assert.equal(combat.attack.sequence, 0);
  proximity.update(0.1, opts);
  assert.equal(combat.attack.techniqueId, FLYING_KICK.id);
  const extension = combat.attack.extension;
  proximity.update(0.02, { ...opts, blocking: true });
  assert.equal(combat.attack.cancelled, true);
  assert.equal(combat.attack.exitReason, "blocked");
  assert.ok(combat.attack.extension < extension);
  for (let i = 0; i < 60; i++)
    proximity.update(1 / 60, { ...opts, blocking: true });
  assert.equal(combat.attack.sequence, 1);
  proximity.update(1 / 60, opts);
  assert.equal(combat.attack.sequence, 2);
});

test("landing recovers an airborne kick before ground attacks can start", () => {
  const { combat, proximity } = fixture(target(0, -0.75));
  proximity.update(0.11, options());
  const extension = combat.attack.extension;
  const landing = {
    position: new Vector3(),
    facing: 0,
    context: { environment: "ground", phase: "landing", canAttack: false },
  };
  proximity.update(0.02, landing);
  assert.equal(combat.attack.exitReason, "landing");
  assert.equal(combat.attack.phase, "recovery");
  assert.ok(combat.attack.extension < extension);
  const ground = { position: new Vector3(), facing: 0 };
  finish(proximity, ground);
  assert.equal(combat.attack.sequence, 1);
  proximity.update(0.001, ground);
  assert.equal(combat.attack.techniqueId, BASIC_PUNCH.id);
  assert.equal(combat.attack.sequence, 2);
});

test("individual custom techniques can support ground, air or both with independent eligibility", () => {
  const shared = {
    ...BASIC_PUNCH,
    id: "shared-fixture",
    environments: ["ground", "air"],
    eligible: (ctx) => Object.isFrozen(ctx) && ctx.speed > 2,
  };
  const combat = new CombatController({ techniques: [shared] });
  assert.equal(combat.requestAttack({ speed: 1 }), false);
  assert.equal(
    combat.requestAttack({ speed: 3, environment: "air", height: 1 }),
    true,
  );
  combat.update(1);
  assert.equal(combat.requestAttack({ speed: 3, environment: "ground" }), true);
  for (const override of [
    { reach: -1 },
    { originHeight: NaN },
    { maxVertical: -1 },
    { maxAngle: 4 },
    { impact: -1 },
    { environments: ["water"] },
    { eligible: true },
  ])
    assert.throws(
      () => new CombatController({ techniques: [{ ...shared, ...override }] }),
    );
});

test("a shared ground/air technique can continue through takeoff and landing without allowing new transition attacks", () => {
  const { combat, proximity } = fixture(
    target(),
    {},
    {
      techniques: [
        { ...BASIC_PUNCH, id: "shared", environments: ["ground", "air"] },
      ],
    },
  );
  proximity.update(0.02, { position: new Vector3(), facing: 0 });
  for (const [environment, phase, height] of [
    ["ground", "takeoff", 0],
    ["air", "airborne", 0.1],
    ["ground", "landing", 0],
  ]) {
    proximity.update(0.02, {
      position: new Vector3(0, height, 0),
      facing: 0,
      context: { environment, phase, canAttack: false, height },
    });
    assert.equal(combat.attack.cancelled, false);
    assert.equal(combat.attack.sequence, 1);
  }
});

test("a custom selector cannot force a ground punch in the air or bypass spatial eligibility", () => {
  const { combat, proximity } = fixture(
    target(),
    {},
    { selectTechnique: () => BASIC_PUNCH.id },
  );
  proximity.update(1 / 60, options());
  assert.equal(combat.attack.sequence, 0);
  assert.equal(combat.postureActive, false);
});

test("an impact-only configured technique completes its zero-length recovery on time", () => {
  const combat = new CombatController({
    techniques: [
      {
        ...BASIC_PUNCH,
        id: "impact-only",
        windup: 0,
        extension: 0,
        impact: 0.1,
        recovery: 0,
      },
    ],
  });
  assert.equal(combat.requestAttack(), true);
  combat.update(0.1);
  assert.equal(combat.attack.active, false);
  close(combat.attack.elapsed, 0.1);
});

const input = (x = 0, y = 1, sprinting = true) => ({
  move: { x, y },
  sprinting,
});
const actor = (dummy, withRig = false) => {
  const character = withRig ? new Stickman() : null;
  const movement = new CharacterController(
    character?.root ?? new Group(),
    new ArenaBounds(18, [dummy]),
  );
  const combat = new CombatController();
  const proximity = new ProximityCombatController(combat, { targets: [dummy] });
  const context = createCombatContext();
  const animator = character && new CharacterAnimator(character);
  const updateCombat = (dt, blocking = false) => {
    updateCombatContext(context, movement);
    proximity.update(dt, {
      position: movement.root.position,
      facing: movement.heading,
      blocking,
      context,
    });
    if (animator)
      animator.update(dt, {
        speed: movement.speed,
        blocking,
        combat,
        jump: movement.jump,
        dash: movement.dash,
      });
  };
  return {
    movement,
    combat,
    proximity,
    context,
    animator,
    character,
    updateCombat,
  };
};

test("Sprint -> Dash -> Jump -> Air Dash -> Kick -> Landing leaves physics identical to movement alone", () => {
  for (const dt of [1 / 30, 1 / 60, 1 / 120]) {
    const dummy = target(0, -4.5);
    const fighter = actor(dummy);
    const reference = actor(dummy);
    let ground = false,
      jumped = false,
      dashed = false,
      kicked = false,
      landed = false;
    for (let i = 0; i < Math.ceil(1.8 / dt); i++) {
      const a = fighter.movement,
        b = reference.movement;
      if (!ground && i * dt >= 0.2) {
        assert.ok(a.requestDash() && b.requestDash());
        ground = true;
      }
      if (ground && !jumped && a.groundDash.elapsed >= 0.09) {
        assert.ok(a.requestJump() && b.requestJump());
        jumped = true;
      }
      if (jumped && !dashed && a.jump.airborne) {
        assert.ok(a.requestDash() && b.requestDash());
        dashed = true;
      }
      const controls = kicked && a.jump.airborne ? input(-0.25, 0.96) : input();
      a.update(dt, controls, 0);
      b.update(dt, controls, 0);
      fighter.updateCombat(dt);
      if (
        fighter.combat.attack.techniqueId === FLYING_KICK.id &&
        fighter.combat.attack.active
      )
        kicked = true;
      if (jumped && a.jump.ready) landed = true;
      assert.ok(
        a.root.position.equals(b.root.position),
        "Combat never pulls or teleports the root",
      );
      assert.ok(
        a.velocity.equals(b.velocity),
        "Combat never changes momentum or air steering",
      );
      assert.equal(a.jump.verticalVelocity, b.jump.verticalVelocity);
      assert.equal(a.airDashesRemaining, b.airDashesRemaining);
      assert.ok(a.root.position.y >= 0);
    }
    assert.ok(ground && jumped && dashed && kicked && landed);
    assert.equal(fighter.movement.groundDash.exitReason, "jumped");
    assert.equal(fighter.movement.airDashesRemaining, 1);
  }
});

test("normal ascent, apex and descent attacks use eligibility without pausing gravity", () => {
  for (const start of [0.12, 0.37, 0.42]) {
    const fighter = actor(target());
    fighter.movement.requestJump();
    for (let i = 0; i < Math.round(start * 120); i++)
      fighter.movement.update(1 / 120, input(0, 0, false), 0);
    const height = fighter.movement.jump.height;
    fighter.updateCombat(1 / 120);
    assert.equal(fighter.combat.attack.techniqueId, FLYING_KICK.id);
    const velocity = fighter.movement.jump.verticalVelocity;
    fighter.movement.update(1 / 120, input(0, 0, false), 0);
    fighter.updateCombat(1 / 120);
    close(fighter.movement.jump.verticalVelocity, velocity - 18 / 120);
    assert.notEqual(fighter.movement.jump.height, height);
  }
});

test("a stationary dummy can enter flying-kick reach after the air dash has finished", () => {
  const fighter = actor(target(0, -3.6));
  fighter.movement.requestJump();
  let dashed = false,
    kickedAfterDash = false;
  for (let i = 0; i < 140; i++) {
    const movement = fighter.movement;
    if (!dashed && movement.jump.airborne) {
      movement.requestDash();
      dashed = true;
    }
    movement.update(1 / 120, input(0, 0, false), 0);
    fighter.updateCombat(1 / 120);
    if (
      fighter.combat.attack.techniqueId === FLYING_KICK.id &&
      fighter.combat.attack.active
    ) {
      assert.equal(movement.dash.active, false);
      kickedAfterDash = true;
    }
  }
  assert.ok(dashed && kickedAfterDash);
  assert.equal(fighter.movement.airDashesRemaining, 1);
});

test("a normal jump produces a controlled kick, yields to Block and returns to ground striking", () => {
  const fighter = actor(target(0, -0.75));
  fighter.movement.requestJump();
  let kicks = 0,
    previous = 0;
  for (let i = 0; i < 120; i++) {
    fighter.movement.update(1 / 120, input(0, 0, false), 0);
    fighter.updateCombat(1 / 120);
    if (fighter.combat.attack.sequence !== previous) {
      if (fighter.combat.attack.techniqueId === FLYING_KICK.id) kicks++;
      previous = fighter.combat.attack.sequence;
    }
  }
  assert.equal(kicks, 1);
  assert.equal(fighter.movement.jump.ready, true);
  assert.notEqual(fighter.combat.attack.techniqueId, FLYING_KICK.id);
});

test("flying kick foot posing has visible chamber/extension and blends into landing without writing the root", () => {
  for (const rate of [30, 60, 120]) {
    const fighter = actor(target(0, -0.95), true);
    const root = fighter.movement.root;
    fighter.movement.requestJump();
    let highestWeight = 0,
      chamberZ = null,
      impactZ = null,
      lastFoot = null;
    for (let i = 0; i < Math.ceil(rate * 1.3); i++) {
      fighter.movement.update(1 / rate, input(0, 0, false), 0);
      const position = root.position.clone(),
        rotation = root.quaternion.clone();
      fighter.updateCombat(1 / rate);
      assert.ok(
        root.position.equals(position) && root.quaternion.equals(rotation),
      );
      highestWeight = Math.max(
        highestWeight,
        fighter.animator.aerialAttackWeight,
      );
      const foot = fighter.character.joints.rightAnkle
        .getWorldPosition(new Vector3())
        .sub(root.position);
      if (fighter.combat.attack.techniqueId === FLYING_KICK.id) {
        if (fighter.combat.attack.phase === "windup") chamberZ = foot.z;
        if (fighter.combat.attack.phase === "impact") impactZ = foot.z;
      }
      for (const joint of Object.values(fighter.character.joints))
        assert.ok(
          [...joint.position, ...joint.quaternion].every(Number.isFinite),
        );
      assert.ok(foot.y + root.position.y >= 0.09);
      if (lastFoot)
        assert.ok(
          foot.distanceTo(lastFoot) < 0.65,
          "No foot teleport across animation layers",
        );
      lastFoot = foot;
    }
    assert.ok(highestWeight > 0.8);
    assert.ok(
      chamberZ !== null && impactZ !== null && impactZ < chamberZ - 0.2,
    );
    assert.equal(fighter.animator.aerialAttackWeight, 0);
    assert.equal(fighter.movement.jump.ready, true);
    fighter.character.dispose();
  }
});

test("blocking during kick recovery retracts the current pose without raising its animation weight again", () => {
  const fighter = actor(target(0, -0.95), true);
  fighter.movement.requestJump();
  for (let i = 0; i < 100; i++) {
    fighter.movement.update(1 / 120, input(0, 0, false), 0);
    fighter.updateCombat(1 / 120);
    if (
      fighter.combat.attack.techniqueId === FLYING_KICK.id &&
      fighter.combat.attack.phase === "recovery" &&
      fighter.combat.attack.phaseProgress > 0.5
    )
      break;
  }
  const before = fighter.animator.aerialAttackWeight;
  assert.ok(before > 0.1 && before < 0.6);
  fighter.updateCombat(1 / 120, true);
  assert.ok(fighter.animator.aerialAttackWeight <= before);
  assert.equal(fighter.combat.attack.cancelled, true);
  for (let i = 0; i < 12; i++) {
    fighter.movement.update(1 / 60, input(0, 0, false), 0);
    fighter.updateCombat(1 / 60, true);
  }
  for (const side of ["left", "right"])
    assert.ok(
      fighter.character.joints[`${side}Elbow`].quaternion.angleTo(
        new Quaternion(),
      ) > 1.4,
    );
  fighter.character.dispose();
});

test("the additional cross extends the opposite arm while keeping movement and the original right straight", () => {
  for (const [id, side] of [
    [BASIC_PUNCH.id, "right"],
    [CROSS_PUNCH.id, "left"],
  ]) {
    const character = new Stickman();
    const animator = new CharacterAnimator(character);
    const combat = new CombatController({ selectTechnique: () => id });
    combat.requestAttack();
    const technique = combat.currentTechnique;
    combat.update(technique.windup + technique.extension - 0.001);
    const position = character.root.position.clone();
    animator.update(1 / 60, { combat });
    const elbow = character.joints[`${side}Elbow`].quaternion.angleTo(
      new Quaternion(),
    );
    assert.ok(elbow < 0.2);
    assert.ok(
      character.joints[
        `${side === "left" ? "right" : "left"}Elbow`
      ].quaternion.angleTo(new Quaternion()) > 1.5,
    );
    assert.ok(character.root.position.equals(position));
    character.dispose();
  }
});
