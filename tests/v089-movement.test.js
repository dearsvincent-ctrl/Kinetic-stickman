import test from "node:test";
import assert from "node:assert/strict";
import { Group, Vector3 } from "three";
import { CharacterController } from "../src/movement/CharacterController.js";
import { TraversalWorld } from "../src/world/TraversalWorld.js";
import { box, pole } from "../src/world/TraversalGeometry.js";
import {
  sandboxMovementConfig,
  movementSubsteps,
  SANDBOX_PRESETS,
  sanitizePhysics,
  savePhysics,
  loadPhysics,
} from "../src/sandbox/PhysicsSandbox.js";
const input = (x = 0, y = 0) => ({
  move: { x, y },
  movementMagnitude: Math.min(1, Math.hypot(x, y)),
});
function actor(values = {}, surfaces = []) {
  const c = new CharacterController(
    new Group(),
    new TraversalWorld(10000, [], surfaces),
  );
  c.applyMovementConfig(sandboxMovementConfig(values));
  return c;
}
function tick(c, i, dt = 1 / 60) {
  const n = movementSubsteps(c, dt, undefined, i.movementMagnitude);
  assert.ok(n <= 32);
  for (let k = 0; k < n; k++) c.update(dt / n, i, 0);
  assert.ok(
    [...c.root.position, ...c.velocity, c.jump.verticalVelocity].every(
      Number.isFinite,
    ),
  );
}
function run(c, i, t = 1, dt = 1 / 60) {
  for (let k = 0; k < Math.round(t / dt); k++) tick(c, i, dt);
}
function flight(c, v = new Vector3(0, 0, -520)) {
  c.root.position.y = 100;
  c.jump.height = 100;
  c.jump.phase = "airborne";
  c.jump.jumpCount = 1;
  c.velocity.copy(v);
}
for (const multiplier of [1, 3, 5, 20, 50, 100]) {
  test(`v089 ${multiplier}x ground speed leaves launch, air and wall abilities independent`, () => {
    const c = actor({ movement: multiplier }),
      normal = actor();
    assert.equal(c.jump.launchVelocity, normal.jump.launchVelocity);
    assert.deepEqual(c.config.abilities, normal.config.abilities);
    assert.equal(c.jump.config.airControl, normal.jump.config.airControl);
    flight(c);
    run(c, input(0, 1), 0.3);
    assert.ok(Math.abs(c.velocity.length() - 520) < 1e-6);
  });
  test(`v089 ${multiplier}x wall contact produces supported climbing, never an impact launch`, () => {
    const c = actor({ movement: multiplier }, [
      box("wall", 0, -3, 50, 1000, 2),
    ]);
    c.velocity.set(0, 0, -5.2 * multiplier);
    for (let f = 0; f < 120 && !c.parkour.attached; f++) tick(c, input(0, 1));
    assert.ok(c.parkour.attached);
    assert.ok(c.jump.verticalVelocity <= 3.61);
    run(c, input(0, 1), 1);
    assert.ok(c.parkour.attached);
    assert.ok(c.jump.verticalVelocity <= 3.61);
    const before = c.jump.sequence;
    assert.ok(c.requestJump(input(0, 1), 0));
    tick(c, input(0, 1));
    assert.equal(c.jump.sequence, before + 1);
    assert.ok(Math.abs(c.velocity.z) <= 6);
    assert.ok(c.jump.verticalVelocity <= c.jump.launchVelocity + 1e-6);
  });
}
test("v089 air steering cannot supply unlimited thrust and braking has its own bound", () => {
  const low = actor({ airControl: 0.1, airAcceleration: 0.1 }),
    high = actor({ airControl: 20, airAcceleration: 10, agility: 9 });
  for (const c of [low, high]) {
    flight(c);
    run(c, input(1, 0), 0.3);
    assert.ok(c.velocity.length() <= 520 + 1e-6);
  }
  assert.ok(high.velocity.x > low.velocity.x + 20);
  const slow = actor({ airBraking: 0.1 }),
    fast = actor({ airBraking: 10 });
  for (const c of [slow, fast]) {
    flight(c);
    run(c, input(0, -1), 0.3);
  }
  assert.ok(slow.velocity.length() > fast.velocity.length() + 20);
  const a = actor({ airControl: 0.1 }),
    b = actor({ airControl: 100 });
  for (const c of [a, b]) {
    flight(c, new Vector3());
    run(c, input(0, 1), 0.3);
  }
  assert.ok(
    a.velocity.distanceTo(b.velocity) < 1e-8,
    "steering alone never boosts straight propulsion",
  );
});
test("v089 Speedster and Acrobat are mechanically distinct without changing jump gravity", () => {
  const s = actor(SANDBOX_PRESETS.Speedster),
    a = actor(SANDBOX_PRESETS.Acrobat);
  for (const c of [s, a]) {
    flight(c);
    run(c, input(1, 0), 0.5);
  }
  assert.ok(a.velocity.x > s.velocity.x + 50);
  assert.equal(a.jump.config.gravity, s.jump.config.gravity);
});
test("v089 wall traversal and deliberate launch scale independently from running", () => {
  const wall = box("tower", 0, -3, 100, 1000, 2);
  const slow = actor({ movement: 100 }, [wall]),
    fast = actor({ movement: 1, wallTraversal: 20, wallJump: 5 }, [wall]);
  for (const c of [slow, fast]) {
    for (let n = 0; n < 180 && !c.parkour.attached; n++) tick(c, input(0, 1));
    run(c, input(0.5, 1), 1);
  }
  assert.ok(fast.root.position.y > slow.root.position.y + 20);
  for (const c of [slow, fast]) {
    c.requestJump();
    tick(c, input());
  }
  assert.ok(fast.velocity.length() > slow.velocity.length() + 10);
});
test("v089 30/60/120/144Hz bounded air trajectories stay consistent at extreme momentum", () => {
  const ends = [30, 60, 120, 144].map((hz) => {
    const c = actor({ movement: 100, airControl: 0.3 });
    flight(c);
    run(c, input(1, 0), 0.5, 1 / hz);
    return c.root.position;
  });
  for (const p of ends) assert.ok(p.distanceTo(ends[0]) < 0.02);
});
test("v089 new abilities migrate old saves without changing original fields", () => {
  let raw = JSON.stringify({
    version: 1,
    values: { movement: 50, jumpHeight: 5, airControl: 0.3 },
  });
  const store = { getItem: () => raw, setItem: (_, v) => (raw = v) };
  const v = loadPhysics(store);
  assert.equal(v.movement, 50);
  assert.equal(v.agility, 1);
  assert.equal(v.wallJump, 1);
  assert.ok(savePhysics(store, { ...v, wallTraversal: 20 }));
  assert.equal(loadPhysics(store).wallTraversal, 20);
  for (const profile of Object.values(SANDBOX_PRESETS))
    assert.deepEqual(sanitizePhysics(profile), profile);
});
test("v089 deliberate elevated gap leap lands on another structure without a teleport", () => {
  const c = actor(
    {
      jumpHeight: 3,
      airAcceleration: 2,
      airControl: 3,
      airBraking: 3,
      agility: 4,
    },
    [box("tree-a", 0, 0, 6, 20, 6), box("tree-b", 14, 0, 10, 20, 6)],
  );
  c.root.position.set(0, 20, 0);
  c.jump.height = 20;
  c.jump.floorHeight = 20;
  c.velocity.set(10, 0, 0);
  c.requestJump(input(1, 0));
  let flew = false,
    landed = false;
  let prev = c.root.position.clone();
  for (let n = 0; n < 240; n++) {
    tick(c, input(1, 0));
    assert.ok(c.root.position.distanceTo(prev) < 1);
    prev.copy(c.root.position);
    flew ||= c.jump.airborne;
    if (flew && !c.jump.airborne && c.root.position.x > 8) {
      landed = true;
      break;
    }
  }
  assert.ok(landed);
  assert.ok(Math.abs(c.root.position.y - 20) < 0.02);
});

test("v089 supported side-steering and controlled descent remain attached without an outward impulse", () => {
  const c = actor({ movement: 100, wallTraversal: 5, wallAdhesion: 5 }, [
    box("face", 0, -3, 100, 1000, 2),
  ]);
  for (let n = 0; n < 180 && !c.parkour.attached; n++) tick(c, input(0, 1));
  run(c, input(0, 1), 0.5);
  const height = c.root.position.y;
  run(c, input(1, 0), 0.5);
  assert.ok(c.parkour.attached);
  assert.equal(c.parkour.mode, "wall-run");
  assert.ok(c.root.position.x > 1);
  run(c, input(0, -0.5), 0.5);
  assert.ok(c.parkour.attached);
  assert.ok(c.root.position.y < height + 1);
  assert.ok(Math.abs(c.velocity.z) < 1);
});
test("v089 landing stability changes braking, never bounces or locks an immediate jump", () => {
  const slow = actor({ landingStability: 0.1 }),
    fast = actor({ landingStability: 10 });
  for (const c of [slow, fast]) {
    c.velocity.set(10, 0, 0);
    c.jump.land(0, 80);
    run(c, input(), 0.1);
    assert.equal(c.root.position.y, 0);
    assert.equal(c.jump.verticalVelocity, 0);
    assert.equal(c.jump.jumpCount, 0);
    assert.ok(c.requestJump());
  }
  assert.ok(fast.velocity.length() < slow.velocity.length() * 0.5);
});

test("v089 combined 100x abilities keep swept wall contact and deliberate leaps numerically stable", () => {
  const values = Object.fromEntries(
    [
      "movement",
      "jumpHeight",
      "airControl",
      "gravity",
      "groundAcceleration",
      "agility",
      "airAcceleration",
      "airBraking",
      "wallAdhesion",
      "wallTraversal",
      "wallJump",
      "landingStability",
    ].map((id) => [id, 100]),
  );
  const c = actor(values, [box("extreme-wall", 0, -3, 100, 2000, 2)]);
  for (let n = 0; n < 120 && !c.parkour.attached; n++) tick(c, input(0, 1));
  assert.ok(c.parkour.attached);
  assert.ok(c.jump.verticalVelocity <= 360);
  run(c, input(0.2, 1), 0.3);
  c.requestJump();
  tick(c, input(1, 0));
  run(c, input(-1, 0), 1);
  assert.ok(c.root.position.y >= 0);
  assert.ok(Math.abs(c.root.position.x) < 10000);
  assert.ok(c.jump.jumpCount <= 2);
});

test("v089 ground acceleration and agility change response, never the configured speed or jump strength", () => {
  const slow = actor({ groundAcceleration: 0.1 }),
    fast = actor({ groundAcceleration: 10 });
  for (const c of [slow, fast]) run(c, input(0, 1), 0.1);
  assert.ok(fast.velocity.length() > slow.velocity.length() + 1);
  assert.equal(fast.sprintSpeed, slow.sprintSpeed);
  assert.equal(fast.jump.launchVelocity, slow.jump.launchVelocity);
  const low = actor({ agility: 0.1 }),
    high = actor({ agility: 100 });
  for (const c of [low, high]) {
    flight(c);
    run(c, input(1, 0), 0.3);
  }
  assert.ok(high.velocity.x > low.velocity.x + 20);
  assert.equal(high.jump.launchVelocity, low.jump.launchVelocity);
});
