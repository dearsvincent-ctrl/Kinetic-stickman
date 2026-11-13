import test from "node:test";
import assert from "node:assert/strict";
import { Group, PerspectiveCamera, Vector3 } from "three";
import {
  NORMAL_PHYSICS,
  SANDBOX_PARAMETERS,
  SANDBOX_PRESETS,
  SANDBOX_STORAGE_KEY,
  sanitizePhysics,
  sandboxMovementConfig,
  loadPhysics,
  savePhysics,
  movementSubsteps,
} from "../src/sandbox/PhysicsSandbox.js";
import {
  MOVEMENT_DEFAULTS,
  resolveMovementConfig,
} from "../src/movement/MovementConfig.js";
import { CharacterController } from "../src/movement/CharacterController.js";
import { JumpState } from "../src/movement/JumpState.js";
import { DashState } from "../src/movement/DashState.js";
import { ArenaBounds } from "../src/world/ArenaBounds.js";
import { FollowCamera } from "../src/camera/FollowCamera.js";
import { CombatController } from "../src/combat/CombatController.js";
import { ProximityCombatController } from "../src/combat/ProximityCombatController.js";
import { Stickman } from "../src/character/Stickman.js";
import { CharacterAnimator } from "../src/character/CharacterAnimator.js";
import { DashPresentation } from "../src/character/DashPresentation.js";

const close = (a, b, e = 1e-7) =>
  assert.ok(Math.abs(a - b) < e, `${a} ~= ${b}`);
const input = (x = 0, y = 0) => ({
  move: { x, y },
  movementMagnitude: Math.min(1, Math.hypot(x, y)),
});
const actor = (values = {}, world = new ArenaBounds(10000)) => {
  const c = new CharacterController(new Group(), world);
  c.applyMovementConfig(
    sandboxMovementConfig({ ...NORMAL_PHYSICS, ...values }),
  );
  return c;
};
const tick = (c, dt = 1 / 60, i = input()) => {
  const n = movementSubsteps(c, dt);
  for (let j = 0; j < n; j++) c.update(dt / n, i, 0);
};
const memory = () => {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) };
};

test("Normal sandbox resolves the exact original movement profiles", () => {
  assert.deepEqual(
    sandboxMovementConfig(NORMAL_PHYSICS),
    resolveMovementConfig(),
  );
  assert.equal(SANDBOX_PARAMETERS.length, 8);
  for (const values of Object.values(SANDBOX_PRESETS))
    assert.deepEqual(sanitizePhysics(values), values);
});
test("all eight independent parameters support 10x, 20x, 50x and 100x", () => {
  for (const n of [10, 20, 50, 100]) {
    for (const { id } of SANDBOX_PARAMETERS) {
      const cfg = sandboxMovementConfig({ ...NORMAL_PHYSICS, [id]: n }),
        d = MOVEMENT_DEFAULTS;
      close(
        cfg.locomotion.sprintSpeed,
        d.locomotion.sprintSpeed * (id === "movement" ? n : 1),
      );
      close(cfg.jump.height, d.jump.height * (id === "jumpHeight" ? n : 1));
      close(cfg.jump.gravity, d.jump.gravity * (id === "gravity" ? n : 1));
      close(
        cfg.jump.airControl,
        d.jump.airControl * (id === "airControl" ? n : 1),
      );
      close(
        cfg.groundDash.distance,
        d.groundDash.distance * (id === "groundDistance" ? n : 1),
      );
      close(
        cfg.groundDash.speed,
        d.groundDash.speed * (id === "groundSpeed" ? n : 1),
      );
      close(
        cfg.aerialDash.distance,
        d.aerialDash.distance * (id === "airDistance" ? n : 1),
      );
      close(
        cfg.aerialDash.speed,
        d.aerialDash.speed * (id === "airSpeed" ? n : 1),
      );
    }
  }
});
test("finite sandbox bounds reject NaN, Infinity and strings without leaking unknown attributes", () => {
  const v = sanitizePhysics({
    movement: NaN,
    jumpHeight: Infinity,
    gravity: -20,
    airControl: 1e200,
    groundSpeed: "100",
    level: 5,
  });
  assert.deepEqual(v, { ...NORMAL_PHYSICS, gravity: 0.1, airControl: 100 });
  assert.deepEqual(sanitizePhysics(null), NORMAL_PHYSICS);
});
test("custom physics is versioned in a separate local save; invalid/outdated storage is safe", () => {
  const s = memory();
  s.setItem("kinetic.controls.v1", "layout-kept");
  const v = { ...NORMAL_PHYSICS, movement: 20 };
  assert.ok(savePhysics(s, v));
  assert.deepEqual(loadPhysics(s), v);
  assert.equal(s.getItem("kinetic.controls.v1"), "layout-kept");
  for (const raw of [
    "{broken",
    "null",
    '{"version":2,"values":{}}',
    '{"version":1,"values":null}',
  ]) {
    s.setItem(SANDBOX_STORAGE_KEY, raw);
    assert.equal(loadPhysics(s), null);
  }
  const failed = {
    getItem() {
      throw Error();
    },
    setItem() {
      throw Error();
    },
  };
  assert.equal(loadPhysics(failed), null);
  assert.equal(savePhysics(failed, v), false);
});
test("dash speed and distance remain independent even at the shortest sandbox duration", () => {
  for (const mode of ["groundDash", "aerialDash"]) {
    for (const [speed, distance] of [
      [100, 0.1],
      [0.1, 100],
      [20, 50],
      [100, 100],
    ]) {
      const cfg = sandboxMovementConfig({
        [mode === "groundDash" ? "groundSpeed" : "airSpeed"]: speed,
        [mode === "groundDash" ? "groundDistance" : "airDistance"]: distance,
      })[mode];
      close(cfg.duration, cfg.distance / (10 * speed));
      const d = new DashState(cfg);
      d.start(new Vector3(0, 0, -1));
      let travelled = 0;
      const dt = cfg.duration / 100;
      for (let j = 0; j < 100; j++) travelled += d.advance(dt, d.direction);
      close(travelled, 2.5 * distance, 1e-5);
    }
  }
});
test("100x ground dash travels continuously, remains steerable and is independent of frame rate", () => {
  for (const fps of [30, 60, 144]) {
    const c = actor({ groundSpeed: 100, groundDistance: 100 });
    c.requestDash();
    let prior = c.root.position.clone(),
      moves = 0;
    for (let t = 0; t < 0.25 - 1e-8; t += 1 / fps) {
      tick(c, Math.min(1 / fps, 0.25 - t));
      if (c.root.position.distanceTo(prior) > 0) moves++;
      prior.copy(c.root.position);
    }
    close(c.groundDash.distanceTravelled, 250, 1e-4);
    assert.ok(moves >= 7);
  }
  const c = actor({ groundSpeed: 50, groundDistance: 100 });
  c.requestDash();
  tick(c, 0.1, input(0, 1));
  const before = c.dash.direction.clone();
  tick(c, 0.05, input(1, 0));
  assert.ok(c.dash.direction.x > 0);
  assert.ok(c.dash.direction.dot(before) > 0);
});
test("live tuning retains dash timeline, momentum, cooldown and ability usage", () => {
  const c = actor();
  c.requestDash();
  tick(c, 0.05, input(0, 1));
  const before = {
    position: c.root.position.clone(),
    velocity: c.velocity.clone(),
    elapsed: c.dash.elapsed,
    cooldown: c.dash.cooldownRemaining,
  };
  c.applyMovementConfig(
    sandboxMovementConfig({ groundSpeed: 100, jumpHeight: 50 }),
  );
  assert.deepEqual(c.root.position, before.position);
  assert.deepEqual(c.velocity, before.velocity);
  close(c.dash.elapsed, before.elapsed);
  close(c.dash.cooldownRemaining, before.cooldown);
  close(c.dash.config.duration, 0.25);
  for (let i = 0; i < 30; i++) tick(c);
  close(c.groundDash.config.duration, 0.0025);
});
test("jump velocity derives from height and gravity; extreme combinations land finitely", () => {
  for (const h of [0.1, 10, 50, 100])
    for (const g of [0.1, 1, 100]) {
      const c = actor({ jumpHeight: h, gravity: g });
      close(
        c.jump.launchVelocity,
        Math.sqrt(2 * MOVEMENT_DEFAULTS.jump.height * h * 18 * g),
      );
      c.requestJump();
      let peak = 0;
      for (let n = 0; n < 5000; n++) {
        tick(c);
        peak = Math.max(peak, c.jump.height);
        assert.ok(c.root.position.toArray().every(Number.isFinite));
        assert.ok(c.jump.height >= 0);
        if (c.jump.ready && n > 0) break;
      }
      assert.ok(c.jump.ready);
      assert.ok(peak <= MOVEMENT_DEFAULTS.jump.height * h + 1e-7);
      close(c.root.position.y, 0);
      close(c.jump.verticalVelocity, 0);
    }
});
test("changing live gravity and next jump height does not teleport or reset flight velocity", () => {
  const c = actor({ jumpHeight: 100 });
  c.requestJump();
  for (let i = 0; i < 15; i++) tick(c);
  const y = c.jump.height,
    vy = c.jump.verticalVelocity;
  c.applyMovementConfig(
    sandboxMovementConfig({ gravity: 100, jumpHeight: 0.1 }),
  );
  close(c.jump.height, y);
  close(c.jump.verticalVelocity, vy);
  for (let i = 0; i < 300; i++) tick(c);
  assert.ok(c.jump.ready);
  close(c.root.position.y, 0);
});
test("extreme steering preserves momentum; Dash -> Jump -> Air Dash retains independent allowance", () => {
  const c = actor({
    movement: 20,
    jumpHeight: 20,
    airSpeed: 50,
    airDistance: 20,
    airControl: 20,
  });
  c.requestDash();
  tick(c, 0.05, input(0, 1));
  assert.ok(c.requestJump());
  for (let n = 0; n < 8; n++) tick(c, 1 / 60, input(0, 1));
  assert.ok(c.jump.airborne);
  assert.equal(c.airDashesRemaining, 1);
  assert.ok(c.requestDash());
  tick(c, 1 / 120, input(1, 0));
  assert.equal(c.airDashesRemaining, 0);
  const before = c.velocity.clone();
  tick(c, 1 / 120, input(-1, 0));
  assert.ok(c.velocity.dot(before) > 0);
  assert.equal(c.requestDash(), false);
  for (let n = 0; n < 500; n++) tick(c);
  assert.ok(c.jump.ready);
  assert.equal(c.airDashesRemaining, 1);
  assert.ok(c.requestDash());
});
test("100x movement and both dashes cannot tunnel through a dummy or arena boundary", () => {
  const dummy = { position: new Vector3(0, 0, -5), radius: 0.32 };
  for (const aerial of [false, true]) {
    const c = actor(
      {
        movement: 100,
        groundSpeed: 100,
        groundDistance: 100,
        airSpeed: 100,
        airDistance: 100,
      },
      new ArenaBounds(18, [dummy]),
    );
    if (aerial) {
      c.requestJump();
      for (let n = 0; n < 10; n++) tick(c);
    }
    c.requestDash();
    for (let n = 0; n < 15; n++) tick(c, 1 / 60, input(0, 1));
    assert.ok(c.root.position.z >= -5 + 0.32 + c.radius - 1e-7);
    for (let n = 0; n < 20; n++) tick(c, 1 / 30, input(1, 0));
    assert.ok(Math.abs(c.root.position.x) <= 18 - c.radius + 1e-7);
    assert.ok(c.root.position.toArray().every(Number.isFinite));
  }
});
test("substep budget remains bounded for every maximum multiplier", () => {
  const c = actor(
    Object.fromEntries(SANDBOX_PARAMETERS.map(({ id }) => [id, 100])),
  );
  c.requestDash();
  assert.equal(movementSubsteps(c, 1 / 60), 32);
  tick(c);
  assert.ok(movementSubsteps(c, 1 / 60) <= 32);
  assert.equal(movementSubsteps(actor(), 1 / 60), 1);
});
const target = {
  id: "dummy",
  position: new Vector3(),
  strikeHeight: 1.4,
  strikeRadius: 0.24,
};
function swept(start, end, extra = {}) {
  const combat = new CombatController(),
    p = new ProximityCombatController(combat, { targets: [target] });
  p.updateSwept(
    1 / 60,
    {
      position: end,
      facing: 0,
      context: { canAttack: true, environment: "ground", phase: "grounded" },
      ...extra,
    },
    start,
  );
  return { combat, p };
}
test("swept proximity catches a full high-speed pass at original close reach without moving the actor", () => {
  const end = new Vector3(0, 0, -5),
    copy = end.clone();
  const { combat, p } = swept(new Vector3(0, 0, 5), end);
  assert.equal(combat.attack.sequence, 1);
  assert.equal(p.sweptOpportunities, 1);
  assert.ok(combat.attack.context.opponentDistance <= 1 + 1e-7);
  assert.ok(
    combat.attack.context.surfaceDistance <=
      combat.currentTechnique.reach + 1e-7,
  );
  assert.deepEqual(end, copy);
  assert.equal(p.target, null);
});
test("swept proximity never extends lateral, vertical or behind-target reach", () => {
  for (const [a, b, extra] of [
    [new Vector3(2, 0, 5), new Vector3(2, 0, -5), {}],
    [new Vector3(0, 5, 5), new Vector3(0, 5, -5), {}],
    [new Vector3(-5, 0, 1), new Vector3(5, 0, 1), { facing: Math.PI }],
    [new Vector3(0, 0, 5), new Vector3(0, 0, -5), { blocking: true }],
  ])
    assert.equal(swept(a, b, extra).combat.attack.sequence, 0);
});
test("swept aerial attack respects height, flight eligibility and recovery; Block cancels", () => {
  const extra = {
    grounded: false,
    context: {
      environment: "air",
      phase: "airborne",
      canAttack: true,
      height: 0.5,
      airTimeRemaining: 1,
    },
  };
  const { combat, p } = swept(
    new Vector3(0, 0.5, 5),
    new Vector3(0, 0.5, -5),
    extra,
  );
  assert.equal(combat.attack.techniqueId, "flying-kick");
  p.updateSwept(
    0.01,
    { ...extra, position: new Vector3(0, 0.5, -5), facing: 0 },
    new Vector3(0, 0.5, 5),
  );
  assert.equal(combat.attack.sequence, 1);
  p.updateSwept(
    0.01,
    { ...extra, blocking: true, position: new Vector3(0, 0.5, 1), facing: 0 },
    new Vector3(0, 0.5, 5),
  );
  assert.equal(combat.blocking, true);
  assert.ok(combat.attack.cancelled);
});
test("sandbox camera retains angle, keeps actor in frame and cannot sink below floor", () => {
  const cam = new PerspectiveCamera(52, 844 / 390, 0.1, 150),
    follow = new FollowCamera(cam, new Vector3());
  follow.maxLag = 0.65;
  for (const p of [
    new Vector3(10, 0, 0),
    new Vector3(-17, 80, -17),
    new Vector3(17, 0, 17),
  ]) {
    follow.update(1 / 60, p, { x: 0, y: 0 });
    close(follow.pitch, 0.23);
    assert.ok(
      follow.target.distanceTo(p.clone().add(new Vector3(0, 1.02, 0))) <=
        0.650001,
    );
    cam.updateMatrixWorld();
    const screen = p
      .clone()
      .add(new Vector3(0, 1, 0))
      .project(cam);
    assert.ok(Math.abs(screen.x) < 1 && Math.abs(screen.y) < 1);
    assert.ok(cam.position.y >= 0.3);
  }
});
test("superhuman presentation advances gait without stretching or changing movement physics", () => {
  const rig = new Stickman(),
    animator = new CharacterAnimator(rig);
  let prior = 0;
  for (let n = 0; n < 120; n++) {
    rig.root.position.z -= 520 / 60;
    const before = rig.root.position.clone();
    animator.update(1 / 60, { speed: 520, sandbox: true });
    assert.deepEqual(rig.root.position, before);
    assert.ok(animator.locomotion.phase >= prior);
    prior = animator.locomotion.phase;
    for (const joint of Object.values(rig.joints))
      assert.ok(
        [...joint.position.toArray(), ...joint.quaternion.toArray()].every(
          Number.isFinite,
        ),
      );
    for (const foot of animator.footList)
      assert.ok(
        Math.hypot(
          foot.target.x - rig.root.position.x,
          foot.target.z - rig.root.position.z,
        ) < 0.7,
      );
  }
  assert.ok(prior > 1);
  assert.ok(animator.locomotion.cadence <= 3);
});
test("sub-frame dash has bounded visual presentation without prolonging physics", () => {
  const dash = new DashState({ duration: 0.0025 }),
    visual = new DashPresentation();
  dash.mode = "ground";
  dash.start(new Vector3(0, 0, -1));
  dash.advance(0.0025, dash.direction);
  dash.finish("completed");
  const pose = visual.sample(1 / 60, dash);
  assert.ok(pose.active);
  assert.equal(dash.active, false);
  for (let n = 0; n < 12; n++) visual.sample(1 / 60, dash);
  assert.equal(visual.sample(1 / 60, dash), dash);
});

test("ballistic extreme jump reaches its requested apex and lands exactly, including 100x gravity", () => {
  for (const height of [0.08, 8, 80])
    for (const gravity of [1.8, 18, 1800]) {
      const jump = new JumpState({
        height,
        gravity,
        takeoffDuration: 0,
        landingDuration: 0,
      });
      jump.start();
      jump.advance(jump.launchVelocity / gravity);
      close(jump.height, height, 1e-6);
      close(jump.verticalVelocity, 0, 1e-6);
      jump.advance(jump.launchVelocity / gravity);
      assert.ok(jump.ready);
      close(jump.height, 0);
    }
});
test("all-100x idle avoids needless substeps; live stress keeps finite continuous state", () => {
  const values = Object.fromEntries(
    SANDBOX_PARAMETERS.map(({ id }) => [id, 100]),
  );
  const c = actor(
    values,
    new ArenaBounds(18, [{ position: new Vector3(2, 0, -5), radius: 0.32 }]),
  );
  assert.equal(movementSubsteps(c, 1 / 60, undefined, 0), 1);
  for (let n = 0; n < 1200; n++) {
    if (n % 31 === 0) c.requestJump();
    if (n % 17 === 0) c.requestDash();
    if (n % 47 === 0)
      c.applyMovementConfig(
        sandboxMovementConfig(n % 94 === 0 ? values : NORMAL_PHYSICS),
      );
    const i = input(Math.sin(n * 0.13), Math.cos(n * 0.13));
    tick(c, [1 / 30, 1 / 60, 1 / 144][n % 3], i);
    assert.ok(
      [
        ...c.root.position.toArray(),
        ...c.velocity.toArray(),
        c.jump.verticalVelocity,
        c.dash.elapsed,
      ].every(Number.isFinite),
    );
    assert.ok(
      Math.abs(c.root.position.x) <= 17.64001 &&
        Math.abs(c.root.position.z) <= 17.64001 &&
        c.root.position.y >= 0,
    );
  }
});

test("long developer dashes retain physical distance/timing while ground feet keep animating", () => {
  const rig = new Stickman(),
    animator = new CharacterAnimator(rig);
  const dash = new DashState({ duration: 25, distance: 250 });
  dash.mode = "ground";
  dash.start(new Vector3(0, 0, -1));
  let cruiseSamples = 0,
    changingFeet = 0,
    previous = null;
  for (let frame = 0; frame < 120; frame++) {
    rig.root.position.z -= dash.advance(1 / 60, dash.direction);
    const before = rig.root.position.clone();
    animator.update(1 / 60, { speed: dash.speed, dash, sandbox: true });
    assert.deepEqual(rig.root.position, before);
    if (animator.dashPresentation.cruising) {
      cruiseSamples++;
      const foot = animator.footList[0].target.clone().sub(rig.root.position);
      if (previous && previous.distanceTo(foot) > 0.005) changingFeet++;
      previous = foot;
    }
  }
  assert.ok(cruiseSamples > 100);
  assert.ok(changingFeet > 40, "Feet cycle during extended cruise");
  assert.ok(animator.locomotion.sprintBlend > 0.9);
  assert.equal(dash.active, true);
  close(dash.config.duration, 25);
  close(dash.config.distance, 250);
  const visual = new DashPresentation();
  dash.elapsed = dash.config.duration - 0.05;
  assert.equal(visual.sample(1 / 60, dash).cruising, false);
  assert.ok(visual.progress > 0.9);
});

test("ordinary dash presentation remains the real state with its existing timing", () => {
  const dash = new DashState(),
    visual = new DashPresentation();
  dash.start(new Vector3(0, 0, -1));
  for (let frame = 0; frame < 10; frame++) {
    dash.advance(1 / 60, dash.direction);
    assert.equal(visual.sample(1 / 60, dash), dash);
  }
});
