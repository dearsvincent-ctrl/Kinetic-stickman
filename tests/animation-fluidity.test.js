import test from "node:test";
import assert from "node:assert/strict";
import { Quaternion, Vector3 } from "three";
import { Stickman } from "../src/character/Stickman.js";
import { CharacterAnimator } from "../src/character/CharacterAnimator.js";
import { AcrobaticPresenter } from "../src/character/AcrobaticPresenter.js";
import { CharacterController } from "../src/movement/CharacterController.js";
import { BodyRotation } from "../src/movement/BodyRotation.js";
import { MomentumRecovery } from "../src/movement/MomentumRecovery.js";
import { ArenaBounds } from "../src/world/ArenaBounds.js";
import { CombatController } from "../src/combat/CombatController.js";
import { AttackScheduler } from "../src/combat/AttackScheduler.js";
import {
  createAdaptiveTechniques,
  ContextualLimbSelector,
} from "../src/combat/AdaptiveTechniques.js";
import {
  createCombatContext,
  updateCombatContext,
} from "../src/combat/CombatContext.js";
import { StrikeHitDetector } from "../src/combat/StrikeHitDetector.js";
import {
  sampleLocalStrike,
  StrikePoseSampler,
} from "../src/combat/TechniqueGeometry.js";
import {
  sandboxMovementConfig,
  movementSubsteps,
} from "../src/sandbox/PhysicsSandbox.js";
import { Game } from "../src/core/Game.js";
import { MotionPresentation } from "../src/character/MotionPresentation.js";

function fixture(values = {}) {
  const character = new Stickman(),
    controller = new CharacterController(character.root, new ArenaBounds(1000));
  controller.applyMovementConfig(sandboxMovementConfig(values));
  const selector = new ContextualLimbSelector();
  const combat = new CombatController({
    techniques: createAdaptiveTechniques(),
    selectTechnique: (ctx, map) => selector.choose(ctx, map),
  });
  const animator = new CharacterAnimator(character);
  return {
    character,
    controller,
    combat,
    animator,
    acrobaticPresenter: new AcrobaticPresenter(character, animator),
    bodyRotation: new BodyRotation(),
    momentumRecovery: new MomentumRecovery(),
    recoveryPrevious: new Vector3(),
    attackScheduler: new AttackScheduler(combat),
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
    sandbox: Object.values(values).some((x) => x !== 1),
  };
}
function intent(g, x, y) {
  g.input.move = { x, y };
  g.input.movementMagnitude = Math.min(1, Math.hypot(x, y));
}
function tick(g, dt = 1 / 60) {
  const n = movementSubsteps(g.controller, dt);
  for (let i = 0; i < n; i++) Game.prototype.simulateMovement.call(g, dt / n);
  const root = g.character.root,
    p = root.position.clone(),
    q = root.quaternion.clone();
  g.acrobaticPresenter.begin(g.combat, g.controller);
  g.animator.update(dt, {
    speed: g.controller.speed,
    jump: g.controller.jump,
    dash: g.controller.dash,
    combat: g.combat,
    blocking: g.input.blocking,
    recovery: g.momentumRecovery,
    sandbox: g.sandbox,
  });
  g.acrobaticPresenter.apply(dt, g.bodyRotation, g.combat, g.controller);
  assert.ok(
    root.position.equals(p) && root.quaternion.equals(q),
    "visual layers never own travel or facing",
  );
  for (const j of Object.values(g.character.joints)) {
    assert.ok([...j.position, ...j.quaternion].every(Number.isFinite));
    assert.ok(Math.abs(j.quaternion.length() - 1) < 1e-6);
  }
}
function run(g, t, dt = 1 / 60) {
  for (let n = 0; n < Math.ceil(t / dt); n++) tick(g, dt);
}
const local = (g, name) =>
  g.character.joints[name]
    .getWorldPosition(new Vector3())
    .sub(g.character.root.position)
    .applyQuaternion(g.character.root.quaternion.clone().invert());

test("contact-coordinated walk, run and sprint retain distinct flight, bounded rhythm and opposed shoulders", () => {
  const samples = [];
  for (const speed of [0.7, 2.6, 5.2, 520]) {
    const g = fixture(),
      a = g.animator,
      c = g.character,
      dt = 1 / 60;
    let flight = 0,
      hipLo = 2,
      hipHi = 0,
      opposition = 0;
    for (let f = 0; f < 360; f++) {
      c.root.position.z -= speed * dt;
      a.update(dt, { speed, sandbox: speed > 5.2 });
      if (f < 120) continue;
      flight += a.footList.every((x) => !x.planted) ? 1 : 0;
      hipLo = Math.min(hipLo, c.joints.hips.position.y);
      hipHi = Math.max(hipHi, c.joints.hips.position.y);
      if (a.pose.hipYaw * a.pose.spineYaw < 0) opposition++;
      assert.ok(a.locomotion.cadence <= 2.4);
      assert.ok(
        c.joints.hips.position.y > 0.75 && c.joints.hips.position.y < 1.03,
      );
    }
    samples.push({ flight, range: hipHi - hipLo });
    assert.ok(
      opposition > 180,
      "hips and shoulders counterbalance actual leg support",
    );
    c.dispose();
  }
  assert.equal(samples[0].flight, 0);
  assert.ok(samples[1].flight > 0 && samples[2].flight > samples[1].flight);
  assert.ok(
    samples[0].range < samples[1].range && samples[1].range < samples[2].range,
  );
});

test("banking reacts to actual lateral acceleration, then relaxes on straight travel", () => {
  const m = new MotionPresentation(),
    q = new Quaternion(),
    v = new Vector3(0, 0, -5.2);
  m.update(1 / 60, v, q, true, true);
  const straight = m.bank;
  m.update(1 / 60, new Vector3(1, 0, -5), q, true);
  assert.ok(m.bank > straight + 0.15);
  for (let f = 0; f < 100; f++) m.update(1 / 60, v, q, true);
  assert.ok(Math.abs(m.bank) < 0.001);
});

test("touchdown permits immediate Jump, Punch and Kick while visual absorption continues", () => {
  for (const action of ["jump", "punch", "kick"]) {
    const g = fixture();
    intent(g, 0, 1);
    run(g, 0.5);
    g.controller.requestJump();
    while (g.controller.jump.phase !== "landing") tick(g);
    const velocity = g.controller.velocity.clone(),
      ctx = updateCombatContext(createCombatContext(), g.controller);
    assert.equal(ctx.environment, "ground");
    assert.equal(ctx.canAttack, true);
    assert.ok(g.controller.jump.canActOnGround && !g.controller.jump.ready);
    if (action === "jump") {
      const launch = g.controller.jump.launchVelocity;
      assert.ok(g.controller.requestJump());
      tick(g);
      assert.equal(g.controller.jump.jumpCount, 1);
      run(g, 0.09);
      assert.ok(g.controller.jump.airborne);
      assert.equal(g.controller.jump.flightLaunchVelocity, launch);
    } else {
      g.attackScheduler.press(action);
      tick(g);
      assert.equal(g.combat.currentTechnique.action, action);
      assert.equal(g.combat.attack.context.environment, "ground");
    }
    assert.ok(
      g.controller.speed >= velocity.length() * 0.98,
      "visual recovery never brakes gameplay",
    );
    g.character.dispose();
  }
});

test("rapid recovery, strike interruption and directional flips retain pose continuity and exact active limb contacts", () => {
  for (const rate of [30, 60, 120]) {
    const g = fixture(),
      dt = 1 / rate,
      sampler = new StrikePoseSampler(),
      goal = new Vector3();
    intent(g, 0, 1);
    run(g, 0.5, dt);
    let previousFoot = local(g, "rightAnkle"),
      largestFoot = 0;
    let previous = local(g, "rightHand"),
      largest = 0,
      contacts = 0,
      flipped = false;
    for (let f = 0; f < rate * 3; f++) {
      if (f === 0) intent(g, -0.6, -0.8);
      if (f === Math.round(rate * 0.1)) g.attackScheduler.press("punch");
      if (f === Math.round(rate * 0.28)) g.controller.requestJump();
      if (f === Math.round(rate * 0.46)) {
        g.controller.requestJump({ move: { x: 0, y: -1 } }, 0);
        flipped = true;
      }
      if (f > rate * 0.5 && f % Math.max(1, Math.round(rate * 0.12)) === 0)
        g.attackScheduler.press(f % 2 ? "punch" : "kick");
      tick(g, dt);
      const foot = local(g, "rightAnkle");
      largestFoot = Math.max(largestFoot, foot.distanceTo(previousFoot));
      previousFoot = foot;
      const hand = local(g, "rightHand");
      largest = Math.max(largest, hand.distanceTo(previous));
      previous = hand;
      const a = g.combat.attack,
        t = g.combat.currentTechnique;
      if (
        a.active &&
        !a.cancelled &&
        a.elapsed >= Math.max(0.11, t.windup) &&
        a.elapsed <= t.windup + t.extension + t.impact
      ) {
        const joint =
          g.character.joints[
            `${t.side}${t.action === "kick" ? "Ankle" : "Hand"}`
          ];
        sampler.sample(
          goal,
          g.character.root.position,
          g.controller.heading,
          t,
          a.elapsed,
          a.context,
          g.bodyRotation.orientation,
          g.bodyRotation.lift,
        );
        const error = joint.getWorldPosition(new Vector3()).distanceTo(goal);
        assert.ok(
          error < 0.06,
          `${rate}Hz ${t.id} visual/contact error ${error}`,
        );
        contacts++;
      }
    }
    assert.ok(flipped && g.bodyRotation.sequence > 0);
    assert.ok(contacts > 0);
    assert.ok(largest < 32 * dt + 0.04, `${rate}Hz hand motion ${largest}`);
    assert.ok(
      largestFoot < 32 * dt + 0.04,
      `${rate}Hz ankle motion ${largestFoot}`,
    );
    assert.ok(g.combat.attack.sequence > 4);
    assert.ok(g.controller.jump.grounded);
    g.character.dispose();
  }
});

test("vertical superhuman launches preserve body-local takeoff pose instead of resetting ground contacts", () => {
  const g = fixture({ jumpHeight: 100, gravity: 100 });
  run(g, 0.2);
  g.controller.requestJump();
  while (!g.controller.jump.airborne) tick(g);
  assert.ok(g.character.root.position.y > 1.5);
  for (const p of g.animator.jumpAnimation.flightStarts)
    assert.ok(p.y > -0.2 && p.y < 1.2, `local entry height ${p.y}`);
  assert.equal(g.animator.motion.drive, 0);
  g.character.dispose();
});

test("100x rapid input remains finite through air dashes, both directional flips, attacks and running landings", () => {
  for (const direction of [-1, 1]) {
    const g = fixture({
      movementSpeed: 100,
      jumpHeight: 100,
      gravity: 100,
      airControl: 100,
      groundDashSpeed: 100,
      aerialDashSpeed: 100,
    });
    intent(g, 0, 1);
    run(g, 0.4);
    g.controller.requestDash();
    tick(g);
    g.controller.requestJump();
    run(g, 0.12);
    g.controller.requestJump({ move: { x: 0, y: direction } }, 0);
    g.controller.requestDash();
    let sequences = 0;
    for (let f = 0; f < 200; f++) {
      intent(g, Math.sin(f / 17), Math.cos(f / 17));
      if (f % 7 === 0) g.attackScheduler.press(f % 14 ? "punch" : "kick");
      g.input.blocking = f % 37 === 0;
      tick(g);
      sequences = Math.max(sequences, g.combat.attack.sequence);
      assert.ok(
        Math.abs(g.character.root.position.x) <= 999.75 &&
          Math.abs(g.character.root.position.z) <= 999.75,
      );
      assert.ok(g.animator.locomotion.cadence <= 2.4);
    }
    assert.ok(sequences > 10 && g.controller.jump.grounded);
    g.character.dispose();
  }
});

test("shared strike paths chamber and recover without changing their authored active reach", () => {
  for (const t of createAdaptiveTechniques().filter((t) => !t.gesture)) {
    const p = new Vector3(),
      end = t.windup + t.extension + t.impact;
    const active = sampleLocalStrike(p, t, end, {}).clone();
    const recovered = sampleLocalStrike(p, t, end + t.recovery, {}).clone();
    assert.ok(active.distanceTo(recovered) > 0.25);
    if (t.action === "kick")
      assert.ok(
        Math.abs(recovered.y - 0.1) < 1e-8 &&
          Math.abs(recovered.z - 0.03) < 1e-8,
      );
    else assert.ok(recovered.y > 1.3 && recovered.z > -0.2);
    const before = sampleLocalStrike(p, t, end - 1e-6, {}).clone(),
      after = sampleLocalStrike(p, t, end + 1e-6, {}).clone();
    assert.ok(
      before.distanceTo(after) < 0.0001,
      "recovery leaves the physical impact path continuously",
    );
  }
});

test("pose crossfades preserve stationary support contacts through a strike and its recovery", () => {
  const g = fixture();
  run(g, 0.4);
  g.attackScheduler.press("punch");
  const anchors = new Map();
  let samples = 0;
  for (let f = 0; f < 60; f++) {
    tick(g);
    for (const foot of g.animator.footList) {
      if (!foot.planted) {
        anchors.delete(foot.side);
        continue;
      }
      const actual = g.character.joints[`${foot.side}Ankle`].getWorldPosition(
        new Vector3(),
      );
      assert.ok(
        actual.distanceTo(foot.target) < 0.025,
        "final pelvis crossfade is followed by support IK",
      );
      const prior = anchors.get(foot.side);
      if (prior)
        assert.ok(
          actual.distanceTo(prior) < 0.04,
          "stationary supporting ankle does not follow torso twist",
        );
      anchors.set(foot.side, actual);
      samples++;
    }
  }
  assert.ok(samples > 20);
  g.character.dispose();
});

test("opening a utility during a flip preserves rotational momentum; respawn clears visual caches", () => {
  const g = fixture();
  g.controller.requestJump();
  run(g, 0.2);
  g.controller.requestJump({ move: { x: 0, y: -1 } }, 0);
  run(g, 0.15);
  const q = g.bodyRotation.orientation.clone(),
    v = g.bodyRotation.angularVelocity.clone();
  assert.ok(g.bodyRotation.flipping);
  g.input.reset = () => {};
  g.streaks = { reset() {} };
  Game.prototype.clearMotion.call(g);
  assert.ok(
    g.bodyRotation.orientation.equals(q) &&
      g.bodyRotation.angularVelocity.equals(v),
  );
  assert.ok(g.controller.jump.airborne);
  g.acrobaticPresenter.reset();
  assert.equal(g.acrobaticPresenter.flipWeight, 0);
  assert.ok(g.animator.footList.every((f) => !f.presentedValid));
  g.character.dispose();
});

test("stationary alternating attack families retain supporting-leg continuity without enforcing limb alternation", () => {
  const g = fixture();
  run(g, 0.4);
  const previous = ["left", "right"].map((side) => local(g, `${side}Ankle`));
  let largest = 0,
    requests = 0;
  for (let f = 0; f < 240; f++) {
    if (f % 12 === 0) {
      g.attackScheduler.press(requests++ % 2 ? "punch" : "kick");
    }
    tick(g);
    for (let i = 0; i < 2; i++) {
      const actual = local(g, `${i ? "right" : "left"}Ankle`);
      largest = Math.max(largest, actual.distanceTo(previous[i]));
      previous[i] = actual;
    }
  }
  assert.ok(g.combat.attack.sequence > 8);
  assert.ok(largest < 0.38, `stationary strike ankle motion ${largest}`);
  g.character.dispose();
});
