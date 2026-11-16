import test from "node:test";
import assert from "node:assert/strict";
import { Group, Vector3 } from "three";
import { EnemyTraversalPlanner } from "../src/combat/EnemyTraversalPlanner.js";
import { CharacterController } from "../src/movement/CharacterController.js";
import { resolveMovementConfig } from "../src/movement/MovementConfig.js";
import { ParkourState } from "../src/traversal/ParkourState.js";
import { TraversalWorld } from "../src/world/TraversalWorld.js";
import { box, pole } from "../src/world/TraversalGeometry.js";
import { ALL_TRAVERSAL_STRUCTURES } from "../src/world/GeometricWorldLayout.js";

const STANDARD = {
  runSpeed: 3.6,
  acceleration: 11,
  deceleration: 15,
  turnRate: 6,
  jumpHeight: 0.8,
  maxJumps: 1,
  airControl: 3.5,
  aerialControl: 1,
  climbSpeed: 3.6,
  jumpInterval: 3,
  wallRun: false,
  climb: false,
  ledgeGrab: false,
  rooftop: false,
};
const ACROBAT = {
  ...STANDARD,
  runSpeed: 5.4,
  jumpHeight: 2,
  maxJumps: 2,
  airControl: 7,
  climbSpeed: 7,
  wallRun: true,
  climb: true,
  ledgeGrab: true,
  rooftop: true,
};
const LEAPER = {
  ...ACROBAT,
  runSpeed: 14,
  jumpHeight: 80,
  airControl: 16,
  climbSpeed: 35,
  acceleration: 24,
};
const NEUTRAL = new Vector3();

function fixture(profile = STANDARD, structures = [], start = new Vector3()) {
  const world = new TraversalWorld(1000, [], structures),
    root = new Group();
  root.position.copy(start);
  const controller = new CharacterController(root, world, {
    radius: 0.32,
    parkour: false,
  });
  controller.applyMovementConfig(
    resolveMovementConfig({
      sprintSpeed: profile.runSpeed,
      movementConfig: {
        analogue: {
          accelerationResponse: profile.acceleration,
          decelerationResponse: profile.deceleration,
        },
        jump: {
          height: profile.jumpHeight,
          maxJumps: profile.maxJumps,
          airControl: profile.airControl * profile.aerialControl,
        },
      },
    }),
  );
  if (profile.wallRun || profile.climb || profile.ledgeGrab || profile.rooftop)
    controller.parkour = new ParkourState(world, {
      climbSpeed: profile.climbSpeed,
    });
  controller.syncSupport();
  const agent = {
    root,
    controller,
    profile,
    runSpeed: profile.runSpeed,
    body: { radius: 0.32, active: true },
    alerted: true,
    index: 0,
  };
  return {
    world,
    agent,
    player: { position: new Vector3(8, 0, 0), active: true },
    planner: new EnemyTraversalPlanner(world),
    modes: new Set(),
    peak: 0,
    input: { move: { x: 0, y: 0 }, movementMagnitude: 1, locomotionSpeed: 0 },
  };
}
function step(f, mode = "combat", dt = 1 / 120) {
  const p = f.agent.root.position;
  const ground = new Vector3().subVectors(f.player.position, p).setY(0);
  if (mode === "tag") ground.negate();
  if (ground.lengthSq() > 0.01) ground.setLength(f.agent.runSpeed);
  const velocity = f.planner.update(
    dt,
    f.agent,
    f.player,
    NEUTRAL,
    mode,
    ground,
  );
  const speed = velocity.length();
  f.input.move.x = speed > 1e-6 ? velocity.x / speed : 0;
  f.input.move.y = speed > 1e-6 ? -velocity.z / speed : 0;
  f.input.movementMagnitude = Math.min(1, speed / f.agent.runSpeed);
  f.input.locomotionSpeed = speed;
  f.agent.controller.update(dt, f.input, 0);
  f.modes.add(f.agent.controller.parkour?.mode ?? "free");
  f.peak = Math.max(f.peak, p.y);
  assert.ok(
    [
      ...p,
      ...f.agent.controller.velocity,
      f.agent.controller.jump.verticalVelocity,
    ].every(Number.isFinite),
  );
  assert.ok(
    f.world.isSpaceFree(p, 0.319, 1.8),
    `solid intersection at ${p.toArray()}`,
  );
}
function run(f, seconds, mode = "combat") {
  for (let i = 0; i < seconds * 120; i++) step(f, mode);
}

test("ordinary enemies use actual low jumps while leapers use independent high launch strength", () => {
  const low = fixture();
  low.player.position.set(2, 0.6, 0);
  run(low, 0.5);
  assert.ok(low.peak > 0.5 && low.peak <= 0.81);
  assert.equal(low.agent.controller.jump.config.maxJumps, 1);
  const high = fixture(LEAPER);
  high.player.position.set(-5, 0, 0);
  run(high, 1, "tag");
  assert.ok(high.peak > 30, `physical leaper height ${high.peak}`);
  assert.equal(high.agent.controller.jump.config.height, 80);
  assert.ok(
    high.agent.root.position.x > 8,
    "the leap retains horizontal travel",
  );
});

test("double jumping resets launch velocity at the apex and never creates unlimited free-air jumps", () => {
  const f = fixture(LEAPER);
  f.player.position.set(-5, 0, 0);
  let peakCount = 0;
  for (let i = 0; i < 6 * 120; i++) {
    step(f, "tag");
    peakCount = Math.max(peakCount, f.agent.controller.jump.jumpCount);
  }
  assert.equal(peakCount, 2);
  assert.equal(f.planner.jumpRequests, 2);
  assert.ok(f.peak > 145 && f.peak < 161);
});

test("capable enemies climb a real wall, grab its crest and transition onto the player's rooftop", () => {
  const roof = box("roof", 8, 0, 4, 6, 8);
  const f = fixture(ACROBAT, [roof]);
  f.player.position.set(8, 6, 0);
  let reached = false;
  for (let i = 0; i < 6 * 120; i++) {
    step(f);
    if (
      f.agent.controller.jump.grounded &&
      f.agent.root.position.y > 5.98 &&
      f.agent.root.position.x > roof.minX &&
      f.world.supportHeight(f.agent.root.position, 0.32) === roof.top
    ) {
      reached = true;
      break;
    }
  }
  assert.ok(f.modes.has("climb") || f.modes.has("wall-run"));
  assert.ok(f.modes.has("ledge") || f.modes.has("mantle"));
  assert.ok(reached);
  assert.ok(Math.abs(f.agent.root.position.y - 6) < 0.02);
});

test("Tag evasion chooses an elevated route and physically climbs onto its roof", () => {
  const f = fixture(ACROBAT, [box("escape-roof", 8, 0, 4, 6, 8)]);
  f.player.position.set(-5, 0, 0);
  let roof = false;
  for (let i = 0; i < 6 * 120; i++) {
    step(f, "tag");
    if (
      f.agent.controller.jump.grounded &&
      f.agent.root.position.y > 5.98 &&
      f.agent.root.position.x > 6 &&
      f.world.supportHeight(f.agent.root.position, 0.32) === 6
    ) {
      roof = true;
      break;
    }
  }
  assert.ok(roof && f.peak >= 6);
});

test("ground-only profiles do not attempt unsupported tall-wall climbing or impossible repeated jumps", () => {
  const f = fixture(STANDARD, [box("tower", 8, 0, 4, 30, 8)]);
  f.player.position.set(8, 30, 0);
  run(f, 5);
  assert.equal(f.agent.controller.parkour, null);
  assert.equal(f.planner.jumpRequests, 0);
  assert.equal(f.peak, 0);
});

test("wall running follows a lateral target without requiring vertical climb intent", () => {
  const f = fixture(
    ACROBAT,
    [box("wall", 8, 0, 4, 20, 40)],
    new Vector3(5.68, 3, 0),
  );
  const c = f.agent.controller,
    k = c.parkour;
  c.jump.phase = "airborne";
  c.jump.height = 3;
  c.jump.jumpCount = 1;
  k.surface = f.world.structures[0];
  k.normal.set(-1, 0, 0);
  k.tangent.set(0, 0, 1);
  k.inputNormal.copy(k.normal);
  k.inputTangent.copy(k.tangent);
  k.setMode("wall-run");
  k.velocity.set(0, 0, 2);
  f.player.position.set(5.68, 3, 15);
  run(f, 0.8);
  assert.ok(f.agent.root.position.z > 2);
  assert.ok(Math.abs(f.agent.root.position.y - 3) < 1);
  assert.ok(f.modes.has("wall-run"));
});

test("roof gaps use real jumps and preserve valid landing support", () => {
  const f = fixture(
    ACROBAT,
    [box("one", 0, 0, 6, 6, 8), box("two", 9, 0, 6, 6, 8)],
    new Vector3(1, 6, 0),
  );
  f.player.position.set(9, 6, 0);
  let landed = false;
  for (let i = 0; i < 5 * 120; i++) {
    step(f);
    if (
      f.agent.root.position.x > 6.1 &&
      f.agent.controller.jump.grounded &&
      f.agent.root.position.y > 5.9
    ) {
      landed = true;
      break;
    }
  }
  assert.ok(f.planner.jumpRequests > 0);
  assert.ok(f.peak > 7);
  assert.ok(landed, f.agent.root.position.toArray().join(","));
});

test("ledge-only profiles hold instead of silently mounting unsupported rooftops", () => {
  const profile = { ...ACROBAT, climb: false, wallRun: false, rooftop: false };
  const f = fixture(
    profile,
    [box("ledge", 8, 0, 4, 6, 8)],
    new Vector3(5.68, 4.8, 0),
  );
  const c = f.agent.controller,
    k = c.parkour;
  k.surface = f.world.structures[0];
  k.normal.set(-1, 0, 0);
  k.tangent.set(0, 0, 1);
  k.inputNormal.copy(k.normal);
  k.inputTangent.copy(k.tangent);
  k.hangHeight = 4.8;
  k.setMode("ledge");
  c.jump.phase = "airborne";
  c.jump.height = 4.8;
  c.jump.jumpCount = 1;
  f.player.position.set(8, 6, 0);
  run(f, 0.8);
  assert.equal(k.mode, "ledge");
  assert.ok(Math.abs(c.root.position.y - 4.8) < 0.1);
  assert.ok(!f.modes.has("mantle"));
});

test("heavy jump decisions have a genuine cooldown rather than repeating every grounded frame", () => {
  const f = fixture({
    ...STANDARD,
    runSpeed: 2.6,
    jumpHeight: 3,
    jumpInterval: 6,
  });
  f.player.position.set(-5, 0, 0);
  run(f, 5.5, "tag");
  assert.equal(f.planner.jumpRequests, 1);
});

test("navigation remains query-bounded at substep rates and stable around curated city/jungle structures", () => {
  for (const start of [new Vector3(-130, 0, -75), new Vector3(135, 0, -95)]) {
    const f = fixture(LEAPER, ALL_TRAVERSAL_STRUCTURES, start);
    f.player.position.copy(start).add(new Vector3(0, 0, 10));
    for (let i = 0; i < 3 * 120; i++) step(f, "tag");
    assert.ok(f.peak > 8);
    assert.ok(f.planner.decisions <= 17);
    assert.ok(f.planner.queries <= 40);
  }
});

test("a real wall climb can be interrupted by a physical wall jump toward a lower pursuer", () => {
  const f = fixture(ACROBAT, [box("wall-jump", 8, 0, 4, 20, 12)]);
  f.player.position.set(8, 20, 0);
  for (let i = 0; i < 4 * 120; i++) {
    step(f);
    if (f.agent.controller.parkour.attached && f.agent.root.position.y > 6)
      break;
  }
  const c = f.agent.controller,
    before = f.agent.root.position.clone();
  assert.ok(c.parkour.attached && before.y > 6);
  f.player.position.set(-5, 0, 0);
  let jumped = false;
  for (let i = 0; i < 120; i++) {
    const prior = f.agent.root.position.clone();
    step(f);
    assert.ok(
      f.agent.root.position.distanceTo(prior) < 0.3,
      "wall jump must move continuously through collision-resolved space",
    );
    if (c.parkour.lastExit === "wall-jump") {
      jumped = true;
      break;
    }
  }
  assert.ok(jumped);
  assert.ok(!c.parkour.attached && c.jump.airborne);
  assert.ok(c.jump.verticalVelocity > 0 && c.velocity.x < 0);
  assert.equal(c.jump.jumpCount, 1);
});

test("capable enemies pursue onto the actual 320m city tower and 38m jungle column without teleportation", () => {
  for (const [start, target, top] of [
    [new Vector3(-365, 0, -305), new Vector3(-365, 320, -330), 320],
    [new Vector3(135, 0, -95), new Vector3(135, 38, -110), 38],
  ]) {
    const f = fixture(LEAPER, ALL_TRAVERSAL_STRUCTURES, start);
    f.player.position.copy(target);
    let landed = false;
    for (let i = 0; i < 22 * 120; i++) {
      const prior = f.agent.root.position.clone();
      step(f);
      assert.ok(
        f.agent.root.position.distanceTo(prior) < 1,
        "vertical traversal must retain a bounded physical step",
      );
      if (
        f.agent.controller.jump.grounded &&
        Math.abs(f.agent.root.position.y - top) < 0.02 &&
        f.agent.root.position.distanceTo(target) < 25
      ) {
        landed = true;
        break;
      }
    }
    assert.ok(
      landed,
      `${top}m actual surface: ${f.agent.root.position.toArray()}`,
    );
    assert.ok(f.world.supportHeight(f.agent.root.position, 0.32) >= top - 0.02);
  }
});

test("an alerted capable runner with blocked ground steering still initiates a vertical escape", () => {
  const f = fixture(LEAPER, [box("corner", 7, 0, 4, 20, 12)]);
  f.player.position.set(-3, 0, 0);
  const before = f.agent.root.position.clone();
  const result = f.planner.update(
    1 / 60,
    f.agent,
    f.player,
    NEUTRAL,
    "tag",
    NEUTRAL,
  );
  assert.ok(result.length() > 0);
  assert.ok(
    f.agent.controller.jumpRequested || f.planner.surface,
    "blocked ground intent must not suppress supported vertical abilities",
  );
  assert.deepEqual(
    f.agent.root.position,
    before,
    "planning never changes the fighter's position",
  );
  const idle = fixture(LEAPER);
  idle.agent.alerted = false;
  idle.planner.update(1 / 60, idle.agent, idle.player, NEUTRAL, "tag", NEUTRAL);
  assert.equal(idle.agent.controller.jumpRequested, false);
  assert.equal(idle.planner.state, "idle");
});

test("individual wall-running and climbing switches prevent unsupported attached movement", () => {
  for (const profile of [
    { ...ACROBAT, wallRun: false, climb: true },
    {
      ...ACROBAT,
      wallRun: true,
      climb: false,
      ledgeGrab: false,
      rooftop: false,
    },
  ]) {
    const f = fixture(
      profile,
      [box("capability-wall", 8, 0, 4, 20, 40)],
      new Vector3(5.68, 3, 0),
    );
    const c = f.agent.controller,
      k = c.parkour;
    c.jump.phase = "airborne";
    c.jump.height = 3;
    c.jump.jumpCount = 1;
    k.surface = f.world.structures[0];
    k.normal.set(-1, 0, 0);
    k.tangent.set(0, 0, 1);
    k.inputNormal.copy(k.normal);
    k.inputTangent.copy(k.tangent);
    k.setMode("wall-run");
    f.player.position.set(
      profile.wallRun ? 8 : 5.68,
      profile.climb ? 3 : 20,
      profile.wallRun ? 0 : 15,
    );
    for (let i = 0; i < 48; i++) {
      const z = f.agent.root.position.z;
      step(f);
      if (!profile.wallRun && k.attached)
        assert.ok(
          Math.abs(f.agent.root.position.z - z) < 0.01,
          "a non-wallrunner must not translate sideways while attached",
        );
    }
    if (!profile.wallRun)
      assert.equal(
        k.attached,
        false,
        "ordinary free-air steering remains available after detaching",
      );
    if (!profile.climb)
      assert.ok(
        f.agent.root.position.y < 3.1,
        "a wallrunner without climbing cannot ascend a vertical route",
      );
  }
});

test("blocked overhead headroom does not cause repeated impossible jump requests", () => {
  const f = fixture(ACROBAT, [box("overhang", 0, 0, 20, 1, 20, false, 2.5)]);
  f.player.position.set(0, 3.5, 0);
  run(f, 3);
  assert.equal(f.planner.jumpRequests, 0);
  assert.ok(
    f.planner.queries < 40,
    "blocked launches are throttled instead of probing on every substep",
  );
  assert.equal(f.peak, 0);
});

test("extreme-speed route intent stays finite, collision-resolved and within arena bounds", () => {
  for (const speed of [140, 1400]) {
    const f = fixture(
      { ...LEAPER, runSpeed: speed },
      ALL_TRAVERSAL_STRUCTURES,
      new Vector3(-90, 0, -130),
    );
    f.player.position.set(-50, 0, -130);
    for (let i = 0; i < 3 * 144; i++) {
      step(f, "tag", 1 / 144);
      assert.ok(Math.abs(f.agent.root.position.x) <= 999.68 + 1e-5);
      assert.ok(Math.abs(f.agent.root.position.z) <= 999.68 + 1e-5);
    }
    assert.ok(f.planner.decisions <= 17);
  }
});
