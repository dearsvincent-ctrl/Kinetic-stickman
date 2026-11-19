import test from "node:test";
import assert from "node:assert/strict";
import { Group, Vector3, Quaternion, PerspectiveCamera } from "three";
import {
  TraversalWorld,
  sweepBox,
  sweepPole,
} from "../src/world/TraversalWorld.js";
import {
  box,
  pole,
  TRAVERSAL_STRUCTURES,
} from "../src/world/TraversalGeometry.js";
import { CharacterController } from "../src/movement/CharacterController.js";
import {
  sandboxMovementConfig,
  movementSubsteps,
} from "../src/sandbox/PhysicsSandbox.js";
import { FollowCamera } from "../src/camera/FollowCamera.js";
import { ArenaBounds } from "../src/world/ArenaBounds.js";
import { BattleWorld } from "../src/combat/BattleWorld.js";
import { JumpState } from "../src/movement/JumpState.js";
import {
  updateCombatContext,
  createCombatContext,
} from "../src/combat/CombatContext.js";
import { PARKOUR_DEFAULTS } from "../src/traversal/ParkourState.js";
const input = (x = 0, y = 0, m = Math.min(1, Math.hypot(x, y))) => ({
  move: { x, y },
  movementMagnitude: m,
  blocking: false,
});
const wall = (height = 12) => box("wall", 0, -3, 30, height, 2);
function actor(surfaces = [wall()], values = {}) {
  const w = new TraversalWorld(10000, [], surfaces),
    c = new CharacterController(new Group(), w);
  c.applyMovementConfig(sandboxMovementConfig(values));
  return c;
}
function tick(c, i = input(0, 1), dt = 1 / 60) {
  const n = movementSubsteps(c, dt, undefined, i.movementMagnitude);
  for (let j = 0; j < n; j++) c.update(dt / n, i, 0);
  assert.ok(
    [...c.root.position, ...c.velocity, c.jump.verticalVelocity].every(
      Number.isFinite,
    ),
  );
}
function run(c, t, i = input(0, 1), dt = 1 / 60) {
  for (let f = 0; f < Math.ceil(t / dt); f++) tick(c, i, dt);
}
function attach(c) {
  for (let f = 0; f < 180 && !c.parkour.attached; f++) tick(c);
  assert.ok(c.parkour.attached);
}
const near = (a, b, e = 0.02) => assert.ok(Math.abs(a - b) < e, `${a} ~ ${b}`);

test("compact structure geometry stays outside the open central arena and has distinct rooftops, gaps, vaults and poles", () => {
  assert.equal(TRAVERSAL_STRUCTURES.length, 9);
  for (const s of TRAVERSAL_STRUCTURES) {
    assert.ok(s.top > s.bottom);
    if (s.kind === "box")
      assert.ok(s.minX >= 40 && s.maxX < 80 && s.minZ > -50 && s.maxZ < 0);
  }
  assert.ok(TRAVERSAL_STRUCTURES.filter((s) => s.vaultable).length >= 2);
  assert.ok(TRAVERSAL_STRUCTURES.filter((s) => s.kind === "pole").length === 2);
});
test("swept boxes and cylinder caps stop high-speed side, roof and ceiling crossings at physical contact", () => {
  const n = new Vector3(),
    s = box("b", 0, 0, 4, 6, 4),
    p = pole("p", 0, 0, 0.25, 8);
  near(
    sweepBox(new Vector3(-20, 2, 0), new Vector3(40, 0, 0), s, 0.36, 1.8, n),
    (20 - 2.36) / 40,
    1e-8,
  );
  assert.equal(n.x, -1);
  near(
    sweepBox(new Vector3(0, 20, 0), new Vector3(0, -40, 0), s, 0.36, 1.8, n),
    0.35,
    1e-8,
  );
  assert.equal(n.y, 1);
  const slab = box("ceiling", 0, 0, 4, 0.4, 4, false, 5);
  near(
    sweepBox(new Vector3(0, 1, 0), new Vector3(0, 10, 0), slab, 0.36, 1.8, n),
    0.22,
    1e-8,
  );
  assert.equal(n.y, -1);
  near(
    sweepPole(new Vector3(0, 15, 0), new Vector3(0, -20, 0), p, 0.36, 1.8, n),
    0.35,
    1e-8,
  );
  assert.equal(n.y, 1);
  const w = new TraversalWorld(100, [], [s, p]),
    out = new Vector3();
  w.sweep(new Vector3(-50, 1, 0), new Vector3(100, 0, 0), 0.36, 1.8, out);
  assert.ok(out.x <= -2.36 + 1e-5);
  w.sweep(new Vector3(0, 30, 0), new Vector3(0, -60, 0), 0.36, 1.8, out);
  near(out.y, 8);
  assert.ok(w.floorHit);
});
test("running parallel to nearby walls, no-input momentum and gentle grazing never attach", () => {
  const c = actor();
  c.root.position.set(-6, 0, -1.55);
  run(c, 2, input(1, 0));
  assert.equal(c.parkour.mode, "free");
  near(c.root.position.y, 0);
  const drift = actor();
  drift.velocity.set(0, 0, -12);
  run(drift, 0.3, input());
  assert.equal(drift.parkour.mode, "free");
  const graze = actor();
  graze.root.position.set(-5, 0, -1.5);
  run(graze, 1, input(1, 0.12));
  assert.equal(graze.parkour.mode, "free");
});
test("deliberate approach attaches without penetration and adhesion closes only the existing gap", () => {
  const c = actor();
  attach(c);
  assert.ok(c.root.position.z >= -1.64 - 1e-5);
  assert.equal(c.jump.jumpCount, 1);
  const z = c.root.position.z;
  run(c, 1);
  assert.ok(Math.abs(c.root.position.z - z) <= 0.15, "adhesion closes only the bounded attachment gap");
  assert.ok(c.root.position.y > 3);
});
test("holding a climb is unlimited and neutral contact holds indefinitely with no stamina/timer", () => {
  const c = actor([wall(10000)]);
  attach(c);
  run(c, 160, input(0, 1), 1 / 30);
  assert.ok(c.root.position.y > 500 && c.parkour.attached);
  run(c, 1, input());
  const h = c.root.position.y;
  run(c, 40, input(), 1 / 30);
  near(c.root.position.y, h, 0.001);
  assert.ok(c.parkour.attached);
});
test("wall running supports lateral steering, reversals, vertical ascent, moderate descent and strong-away detachment", () => {
  const c = actor([wall(100)]);
  attach(c);
  run(c, 0.8);
  const y = c.root.position.y;
  run(c, 0.8, input(1, 0));
  assert.equal(c.parkour.mode, "wall-run");
  assert.ok(c.root.position.x > 2);
  run(c, 0.6, input(-1, 0));
  assert.ok(c.parkour.velocity.x < -4);
  run(c, 0.6, input(0, -0.45));
  assert.ok(c.root.position.y < y + 1 && c.parkour.attached);
  tick(c, input(0, -1));
  assert.equal(c.parkour.mode, "free");
  assert.ok(c.parkour.velocity.z > 0);
  assert.equal(c.parkour.lastExit, "away");
});
test("rooftop mantle is continuous, lands on real support and runs off into gravity", () => {
  const c = actor([wall(6)]);
  let prev = c.root.position.clone(),
    rooftop = false;
  for (let f = 0; f < 280; f++) {
    tick(c);
    assert.ok(
      c.root.position.distanceTo(prev) < 0.3,
      `no authored position jumps: ${c.root.position.distanceTo(prev)}`,
    );
    prev.copy(c.root.position);
    if (c.parkour.lastExit === "rooftop" && !rooftop) {
      rooftop = true;
      near(c.root.position.y, 6);
      assert.equal(c.jump.jumpCount, 0);
      assert.ok(c.velocity.length() > 3);
    }
  }
  assert.ok(rooftop);
  assert.equal(c.parkour.mode, "free");
  assert.ok(c.root.position.y < 1 && c.jump.grounded);
});
test("rooftop launch and both air jumps retain the configured strength and land on elevated geometry", () => {
  const c = actor([box("roof", 0, 0, 20, 6, 20)]);
  c.root.position.set(0, 6, 0);
  c.jump.land(6, 0);
  c.jump.phase = "grounded";
  assert.ok(c.requestJump());
  run(c, 0.16, input());
  assert.ok(c.root.position.y > 6);
  const launch = c.jump.flightLaunchVelocity;
  assert.ok(c.requestJump());
  tick(c, input());
  near(c.jump.flightLaunchVelocity, launch, 1e-9);
  assert.equal(c.requestJump(), false);
  run(c, 2, input());
  near(c.root.position.y, 6);
  assert.equal(c.jump.jumpCount, 0);
  assert.ok(c.jump.canJump);
});
test("wall Jump immediately launches away, permits one air jump and rejects repeated free-air Jump", () => {
  const c = actor([wall(100)]);
  attach(c);
  run(c, 0.5);
  const p = c.root.position.clone();
  assert.ok(c.requestJump(input(0, -1), 0));
  tick(c, input(0, -1));
  assert.equal(c.parkour.mode, "free");
  assert.ok(c.velocity.z > 4);
  assert.ok(c.root.position.y > p.y);
  assert.equal(c.jump.jumpCount, 1);
  assert.ok(c.requestJump());
  tick(c, input(0, -1));
  assert.equal(c.jump.jumpCount, 2);
  assert.equal(c.requestJump(), false);
  for (let f = 0; f < 8; f++) tick(c, input(0, 1));
  assert.equal(c.jump.jumpCount, 2, "wall proximity alone cannot refill jumps");
});
test("a fresh physical wall contact permits repeated wall interactions without a free-air reset", () => {
  const c = actor([wall(100)]);
  attach(c);
  run(c, 0.3);
  c.requestJump();
  run(c, 0.25, input(0, -1));
  assert.ok(c.root.position.z > -0.5);
  for (let f = 0; f < 150 && !c.parkour.attached; f++) tick(c, input(0, 1));
  assert.ok(c.parkour.attached);
  assert.ok(c.requestJump());
  tick(c, input(0, -1));
  assert.equal(c.jump.jumpCount, 1);
});
test("descending ledge catch, lateral shimmy, interruptible pull-up and Jump work without target snapping", () => {
  const c = actor([wall(6)]);
  c.root.position.set(0, 4.7, -1.62);
  c.jump.phase = "airborne";
  c.jump.height = 4.7;
  c.jump.verticalVelocity = -3;
  c.jump.jumpCount = 2;
  c.velocity.z = -1;
  tick(c);
  assert.ok(c.parkour.attached);
  assert.equal(c.parkour.mode, "ledge");
  run(c, 0.3, input());
  const z = c.root.position.z,
    x = c.root.position.x;
  run(c, 0.4, input(1, 0));
  assert.ok(c.root.position.x > x + 0.4);
  assert.ok(Math.abs(c.root.position.z - z) <= 0.15, "adhesion closes only the bounded attachment gap");
  run(c, 0.2, input(0, 1));
  assert.equal(c.parkour.mode, "mantle");
  const h = c.root.position.y;
  run(c, 0.4, input());
  assert.ok(c.root.position.y < h + 0.4);
  assert.ok(c.requestJump());
  tick(c, input(0, -1));
  assert.equal(c.parkour.mode, "free");
  assert.ok(c.jump.verticalVelocity > 0);
});
test("low vaults clear real collision continuously and release into normal airborne control", () => {
  const c = actor([box("vault", 0, -2, 4, 0.8, 0.7, true)]);
  let vault = false,
    maxY = 0;
  for (let f = 0; f < 150; f++) {
    tick(c);
    vault ||= c.parkour.mode === "vault";
    maxY = Math.max(maxY, c.root.position.y);
  }
  assert.ok(vault && maxY > 0.8 && maxY < 1.5);
  assert.equal(c.parkour.mode, "free");
  assert.ok(c.root.position.z < -8);
  near(c.root.position.y, 0);
});
test("pole climb, controlled orbit, top perch and joystick-directed transfer use continuous collision", () => {
  const c = actor([pole("pole", 0, -2, 0.25, 6)]);
  attach(c);
  const radius = Math.hypot(c.root.position.x, c.root.position.z + 2);
  run(c, 0.3, input(1, 0));
  near(Math.hypot(c.root.position.x, c.root.position.z + 2), radius, 0.02);
  assert.equal(c.parkour.mode, "pole-climb");
  // Aim into the current radial face while ascending, independent of camera.
  for (let f = 0; f < 250 && c.parkour.mode !== "perch"; f++) {
    tick(c, input(0, 1));
  }
  assert.equal(c.parkour.mode, "perch");
  near(c.root.position.y, 6, 0.02);
  run(c, 2, input());
  near(c.root.position.y, 6, 0.02);
  assert.ok(c.requestJump(input(1, 0), 0));
  tick(c, input(1, 0));
  assert.ok(c.velocity.x > 4 && c.jump.verticalVelocity > 0);
  assert.equal(c.jump.jumpCount, 1);
});
test("loss of wall contact after knockback or surface removal releases the state rather than floating", () => {
  const c = actor();
  attach(c);
  run(c, 0.3);
  c.root.position.z += 1;
  tick(c, input());
  assert.equal(c.parkour.mode, "free");
  assert.equal(c.parkour.lastExit, "lost-contact");
  const d = actor();
  attach(d);
  d.world.structures = [];
  tick(d, input());
  assert.equal(d.parkour.mode, "free");
});
test("wall/ledge traversal keeps manual aerial combat eligible and perch/roof support remains grounded", () => {
  const c = actor();
  attach(c);
  const ctx = updateCombatContext(createCombatContext(), c);
  assert.equal(ctx.environment, "air");
  assert.ok(ctx.canAttack);
  const roof = actor([box("roof", 0, 0, 8, 6, 8)]);
  roof.root.position.y = 6;
  roof.jump.land(6);
  assert.equal(updateCombatContext(ctx, roof).environment, "ground");
});
test("extreme speed approaches cannot tunnel and climbing/roof exits stay finite across frame rates", () => {
  for (const rate of [30, 60, 120])
    for (const values of [
      { movement: 100 },
      { movement: 100, jumpHeight: 100, gravity: 100, airControl: 100 },
    ]) {
      const c = actor([wall(20)], values);
      let seen = false;
      for (let f = 0; f < rate * 3; f++) {
        tick(c, input(0, 1), 1 / rate);
        seen ||= c.parkour.attached;
        assert.ok(
          c.world.isSpaceFree(c.root.position, c.radius - 1e-4, 1.79),
          "never enters a solid",
        );
      }
      assert.ok(seen);
      assert.ok(c.root.position.y >= 0);
    }
});
test("camera collision shortens only obstructed offsets and preserves free-space orbit/reset tuning", () => {
  const w = new TraversalWorld(100, [], [wall()]),
    out = new Vector3();
  w.clipCamera(new Vector3(0, 2, 0), new Vector3(0, 2, -10), out);
  assert.ok(out.z > -1.81);
  w.clipCamera(new Vector3(20, 2, 0), new Vector3(20, 2, -10), out);
  near(out.z, -10, 1e-8);
  const cam = new PerspectiveCamera(),
    f = new FollowCamera(cam, new Vector3(0, 0, -1.5));
  f.world = w;
  f.reset(Math.PI);
  f.update(1, new Vector3(0, 0, -1.5), { x: 0, y: 0 });
  assert.ok(w.isSpaceFree(cam.position, 0.1, 0.1));
  assert.equal(f.distance, 4.8);
  assert.equal(f.targetPitch, 0.23);
});
test("traversal defaults are finite configurable ability parameters and reject invalid values", () => {
  assert.ok(
    Object.values(PARKOUR_DEFAULTS).every((x) => Number.isFinite(x) && x > 0),
  );
  assert.throws(
    () =>
      new CharacterController(new Group(), new TraversalWorld(10), {
        parkourConfig: { climbSpeed: NaN },
      }),
  );
  const j = new JumpState();
  j.floorHeight = 8;
  j.height = 8;
  j.start();
  j.advance(0.2);
  assert.ok(j.height > 8);
  j.advance(3);
  near(j.height, 8);
  assert.equal(j.jumpCount, 0);
});

test("releasing an unsupported mantle above the rim resumes gravity instead of hovering", () => {
  const c = actor([wall(6)]);
  let found = false;
  for (let f = 0; f < 240; f++) {
    tick(c);
    if (
      c.parkour.mode === "mantle" &&
      c.root.position.y > 6.04 &&
      c.world.supportHeight(c.root.position, 0) < 6
    ) {
      found = true;
      break;
    }
  }
  assert.ok(found);
  run(c, 0.5, input());
  assert.equal(c.parkour.mode, "free");
  assert.equal(c.parkour.lastExit, "mantle-interrupted");
  assert.ok(c.root.position.y < 6.5);
});
test("pole orbit stores actual constrained tangent velocity rather than sandbox speed that never travelled", () => {
  const c = actor([pole("pole", 0, -2, 0.25, 100)]);
  attach(c);
  c.applyMovementConfig(sandboxMovementConfig({ movement: 100 }));
  run(c, 0.2, input(1, 0));
  assert.ok(c.parkour.attached);
  assert.ok(c.velocity.length() < 6);
});

test("open-ground movement, dash chains and double jumps preserve the original adapter path exactly", () => {
  for (const movement of [1, 100]) {
    const a = new CharacterController(new Group(), new ArenaBounds(10000, []));
    const b = new CharacterController(
      new Group(),
      new TraversalWorld(10000, [], [box("far", 5000, 5000, 4, 8, 4)]),
    );
    for (const c of [a, b])
      c.applyMovementConfig(sandboxMovementConfig({ movement }));
    for (let f = 0; f < 480; f++) {
      for (const c of [a, b]) {
        if ([30, 130, 330].includes(f)) c.requestDash();
        if ([35, 50, 200, 215, 335, 350].includes(f)) c.requestJump();
      }
      const i = input(Math.sin(f / 41), Math.cos(f / 57));
      const n = movementSubsteps(a, 1 / 60, undefined, i.movementMagnitude);
      for (let j = 0; j < n; j++)
        for (const c of [a, b]) c.update(1 / (60 * n), i, 0);
      assert.ok(
        a.root.position.distanceTo(b.root.position) < 1e-8,
        `world path ${f}`,
      );
      assert.ok(a.velocity.distanceTo(b.velocity) < 1e-7);
      assert.equal(a.jump.phase, b.jump.phase);
      assert.equal(a.jump.jumpCount, b.jump.jumpCount);
    }
  }
});
test("a swept roof impact followed by an edge exit absorbs vertical impact and starts a fresh fall", () => {
  const c = actor([box("roof", 0, 0, 2, 6, 4)]);
  c.jump.configure({ ...c.jump.config, airDrag: 0 });
  c.root.position.set(-4, 6.8, 0);
  c.jump.height = 6.8;
  c.jump.phase = "airborne";
  c.jump.jumpCount = 2;
  c.jump.verticalVelocity = -100;
  c.velocity.x = 520;
  c.update(1 / 60, input(), 0);
  assert.ok(c.root.position.x > 4 && c.root.position.y >= 6);
  assert.equal(c.jump.verticalVelocity, 0);
  assert.equal(c.jump.jumpCount, 1);
  assert.ok(c.jump.airborne);
  c.update(1 / 60, input(), 0);
  assert.ok(c.root.position.y < 6 && c.jump.verticalVelocity < 0);
});
test("wave resets retain structures, enemy adapters collide with them, and spawns reject solids even from rooftops", () => {
  const structures = [box("large roof", 0, 0, 36, 12, 36)];
  const w = new TraversalWorld(1000, [], structures),
    battle = new BattleWorld({
      playerPosition: new Vector3(0, 12, 0),
      world: w,
      targets: [],
    });
  for (let wave = 0; wave < 12; wave++) {
    assert.ok(battle.alive >= 3 && battle.alive <= 8);
    for (const e of battle.enemies.filter((e) => e.spawned && e.body.active)) {
      assert.ok(w.isSpaceFree(e.root.position, 0.4, 1.8));
      assert.equal(e.world.structures, structures);
      assert.equal(e.controller.parkour, null);
      for (const other of battle.enemies)
        if (other !== e && other.spawned && other.body.active)
          assert.ok(e.root.position.distanceTo(other.root.position) >= 2);
    }
    battle.spawnWave();
    assert.equal(w.structures, structures);
  }
});
test("double jumping crosses the authored rooftop gap and lands on the destination surface", () => {
  const c = actor([...TRAVERSAL_STRUCTURES]);
  c.root.position.set(52, 6, -35);
  c.jump.land(6);
  c.jump.phase = "grounded";
  c.velocity.z = -5.2;
  c.requestJump();
  run(c, 0.35, input(0, 1));
  c.requestJump();
  run(c, 0.8, input(0, 1));
  run(c, 0.35, input(0, -0.3));
  run(c, 0.7, input());
  assert.ok(
    c.root.position.z < -39 && c.root.position.z > -44.3,
    `destination z ${c.root.position.z}`,
  );
  assert.ok(c.jump.grounded);
  near(c.root.position.y, 6);
});

test("camera focus projects out of obstructed follow lag without resetting the free-space orbit", () => {
  const w = new TraversalWorld(100, [], [box("corner", 0, 0, 4, 10, 4)]),
    cam = new PerspectiveCamera(),
    f = new FollowCamera(cam, new Vector3(-2.4, 0, 0));
  f.world = w;
  f.target.set(0, 1.02, 0);
  f.update(1 / 60, new Vector3(-2.4, 0, 0), { x: 0, y: 0 });
  assert.ok(f.target.x <= -2.2 && f.target.x > -2.39);
  assert.ok(w.isSpaceFree(cam.position, 0.19, 0.2));
  assert.equal(f.targetYaw, 0);
});

test("extreme ground speed attaches without vertical launch and reaches a controlled rooftop", () => {
  const c = actor([wall(20)], { movement: 100 });
  let entered = false;
  for (let f=0; f<1800; f++) {
    tick(c);
    entered ||= c.parkour.attached;
    assert.ok(c.jump.verticalVelocity <= 6.1, "ground speed never becomes upward impulse");
    if (c.parkour.lastExit === "rooftop") break;
  }
  assert.ok(entered);
  assert.ok(c.root.position.y >= 19.9);
});

test("rooftop landing anticipation uses local support without granting a premature landing or jump refill", () => {
  const c = actor([box("roof", 0, 0, 20, 6, 20)]);
  c.root.position.y = 6;
  c.jump.land(6);
  c.jump.phase = "grounded";
  c.requestJump();
  run(c, 0.65, input());
  assert.ok(c.jump.airborne && c.jump.verticalVelocity < 0);
  assert.equal(c.jump.jumpCount, 1);
  assert.equal(c.jump.floorHeight, 0);
  assert.equal(c.jump.landingFloor, 6);
  assert.ok(c.jump.timeToLanding < 0.2);
  assert.ok(c.jump.timeToBoundary > 0.5);
  run(c, 0.4, input());
  assert.ok(c.jump.grounded);
  near(c.root.position.y, 6);
  assert.equal(c.jump.jumpCount, 0);
});

test("wall-jump lateral steering respects partial joystick extension rather than applying a full side impulse", () => {
  const velocities = [];
  for (const magnitude of [0.25, 1]) {
    const c = actor([wall(100)]);
    attach(c);
    run(c, 0.3, input());
    c.requestJump(input(magnitude, 0), 0);
    c.update(1e-6, input(magnitude, 0), 0);
    velocities.push(c.velocity.x);
  }
  assert.ok(velocities[0] > 0 && velocities[1] > velocities[0] * 3.8);
});

test("inverted landing clearance is relative to the supported rooftop just as it is to the arena floor", async () => {
  const { BodyRotation } = await import("../src/movement/BodyRotation.js");
  const lifts = [];
  for (const height of [0, 6]) {
    const c = actor([box("roof", 0, 0, 20, 6, 20)]);
    c.root.position.y = height;
    c.jump.land(height);
    c.jump.phase = "grounded";
    const r = new BodyRotation();
    r.phase = "backflip";
    r.orientation.setFromAxisAngle(new Vector3(1, 0, 0), Math.PI);
    r.update(1 / 60, c, input(), 0);
    lifts.push(r.lift);
    near(c.root.position.y, height, 1e-12);
  }
  assert.ok(lifts[0] > 0.05);
  near(lifts[0], lifts[1], 1e-12);
});
