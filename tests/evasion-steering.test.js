import test from "node:test";
import assert from "node:assert/strict";
import { Group, Vector3 } from "three";
import { EvasionSteering } from "../src/combat/EvasionSteering.js";
import { sanitizeTagSettings } from "../src/sandbox/TagSettings.js";
import { CharacterController } from "../src/movement/CharacterController.js";
import { resolveMovementConfig } from "../src/movement/MovementConfig.js";
import { TraversalWorld } from "../src/world/TraversalWorld.js";
import { box, pole } from "../src/world/TraversalGeometry.js";
import { ALL_TRAVERSAL_STRUCTURES } from "../src/world/GeometricWorldLayout.js";

function fixture(values = {}, structures = [], halfSize = 1000) {
  const world = new TraversalWorld(halfSize, [], structures);
  const root = new Group(),
    tagSettings = sanitizeTagSettings(values);
  const controller = new CharacterController(root, world, { parkour: false });
  const agent = {
    index: 0,
    root,
    controller,
    world,
    body: { radius: 0.32, active: true },
    tagSettings,
    runSpeed: 3.6 * tagSettings.speed,
    spawned: true,
  };
  controller.applyMovementConfig(
    resolveMovementConfig({
      walkSpeed: 2.1 * tagSettings.speed,
      sprintSpeed: agent.runSpeed,
      movementConfig: {
        analogue: {
          accelerationResponse: 11 * tagSettings.acceleration,
          decelerationResponse: 15 * tagSettings.acceleration,
        },
      },
    }),
  );
  const player = { position: new Vector3(-5, 0, 0), active: true };
  return { world, agent, player, steering: new EvasionSteering(world) };
}
const neutral = new Vector3();
function step(f, dt = 1 / 60, velocity = neutral, peers = [f.agent]) {
  const v = f.steering.update(dt, f.agent, f.player, velocity, peers);
  const speed = v.length();
  f.agent.controller.update(
    dt,
    {
      move: { x: speed ? v.x / speed : 0, y: speed ? -v.z / speed : 0 },
      movementMagnitude: Math.min(1, speed / f.agent.runSpeed),
      locomotionSpeed: speed,
    },
    0,
  );
  return v;
}
function run(f, time, velocity = neutral) {
  const dt = Math.min(1 / 60, 0.2 / f.agent.runSpeed);
  for (let t = 0; t < time - 1e-9; t += dt)
    step(f, Math.min(dt, time - t), velocity);
}

test("evasion activates on approach, maintains hysteresis and stops after losing the threat", () => {
  const f = fixture({ detection: 10 });
  f.player.position.x = -20;
  assert.equal(step(f).length(), 0);
  assert.equal(f.steering.threatened, false);
  f.player.position.x = -5;
  const old = f.agent.root.position.clone(),
    v = f.steering.update(1 / 60, f.agent, f.player, neutral, [f.agent]);
  assert.ok(v.x > 0);
  assert.deepEqual(
    f.agent.root.position,
    old,
    "steering must never move an actor directly",
  );
  f.player.position.x = -11;
  for (let i = 0; i < 100; i++)
    f.steering.update(1 / 60, f.agent, f.player, neutral, [f.agent]);
  assert.equal(f.steering.threatened, true);
  f.player.position.x = -14;
  for (let i = 0; i < 40; i++)
    f.steering.update(1 / 60, f.agent, f.player, neutral, [f.agent]);
  assert.equal(f.steering.threatened, false);
  assert.equal(f.steering.velocity.length(), 0);
});
test("escape speed changes desired travel while independent acceleration changes the physical buildup", () => {
  for (const speed of [0.25, 1, 20, 100]) {
    const f = fixture({ speed });
    const v = f.steering.update(1 / 120, f.agent, f.player, neutral, [f.agent]);
    assert.ok(Math.abs(v.length() - 3.6 * speed) < 1e-8);
  }
  const slow = fixture({ speed: 20, acceleration: 0.1 }),
    fast = fixture({ speed: 20, acceleration: 5 });
  run(slow, 0.15);
  run(fast, 0.15);
  assert.ok(
    fast.agent.controller.velocity.length() >
      slow.agent.controller.velocity.length() * 3,
  );
  assert.ok(fast.agent.root.position.x > slow.agent.root.position.x);
  assert.ok(slow.agent.controller.velocity.length() > 0);
});
test("medium evasion escapes around a building and a narrow pole without walking through solids", () => {
  for (const obstacle of [
    box("building", 8, 0, 2, 8, 14),
    pole("column", 8, 0, 1.5, 20),
  ]) {
    const f = fixture({ detection: 200, intelligence: 1 }, [obstacle]);
    for (let i = 0; i < 900; i++) {
      step(f);
      assert.ok(
        f.world.isSpaceFree(f.agent.root.position, f.agent.body.radius, 1.8),
      );
    }
    assert.ok(
      f.agent.root.position.x > 12,
      `escaped ${obstacle.kind}: ${f.agent.root.position.toArray()}`,
    );
    assert.ok(f.agent.root.position.distanceTo(f.player.position) > 20);
  }
});
test("high evasion predicts a moving pursuer while low remains direct and both stay finite", () => {
  const low = fixture({ intelligence: 0 }),
    high = fixture({ intelligence: 2 });
  const incoming = new Vector3(20, 0, 35);
  const a = low.steering
    .update(1 / 60, low.agent, low.player, incoming, [low.agent])
    .clone();
  const b = high.steering
    .update(1 / 60, high.agent, high.player, incoming, [high.agent])
    .clone();
  assert.ok(a.x > 0 && Math.abs(a.z) < 1e-8);
  assert.ok(b.z < -0.1, `predictive side route ${b.toArray()}`);
  assert.ok(b.length() <= high.agent.runSpeed + 1e-8);
});
test("crowd separation, committed choices and bounded probes avoid per-substep route thrashing", () => {
  const f = fixture({ intelligence: 2 });
  const peer = {
    index: 1,
    spawned: true,
    body: { active: true },
    root: { position: new Vector3(0, 0, -0.5) },
  };
  const v = f.steering.update(1 / 1920, f.agent, f.player, neutral, [
    f.agent,
    peer,
  ]);
  assert.ok(
    v.z > 0,
    "a neighboring runner influences the selected escape side",
  );
  for (let i = 0; i < 1920; i++)
    f.steering.update(1 / 1920, f.agent, f.player, neutral, [f.agent, peer]);
  assert.ok(f.steering.decisions <= 9, `${f.steering.decisions} decisions`);
  assert.ok(f.steering.queries <= 108, `${f.steering.queries} spatial probes`);
  assert.ok(f.steering.neighborQueries <= 14);
});
test("a blocked corner can select a route toward the pursuer instead of pushing against the same wall", () => {
  const f = fixture({ intelligence: 2, detection: 100 }, [
    box("end", 6, 0, 1, 8, 14),
    box("side", 0, 7, 12, 8, 1),
  ]);
  run(f, 7);
  assert.ok(f.agent.root.position.distanceTo(f.player.position) > 10);
  assert.ok(
    f.agent.root.position.z < -4 || f.agent.root.position.x < -5,
    f.agent.root.position.toArray().join(","),
  );
});
test("100x escape remains collision-resolved at city walls and turns away from arena edges", () => {
  const f = fixture(
    { speed: 100, acceleration: 100, intelligence: 2, detection: 4000 },
    ALL_TRAVERSAL_STRUCTURES,
  );
  f.agent.root.position.set(-90, 0, -130);
  f.player.position.set(-50, 0, -130);
  let peak = 0;
  const incoming = new Vector3(-500, 0, 0);
  for (let i = 0; i < 600; i++) {
    const substeps = 24;
    for (let n = 0; n < substeps; n++) {
      step(f, 1 / (60 * substeps), incoming);
      assert.ok(
        [...f.agent.root.position, ...f.agent.controller.velocity].every(
          Number.isFinite,
        ),
      );
      assert.ok(
        f.world.isSpaceFree(f.agent.root.position, f.agent.body.radius, 1.8),
      );
      assert.ok(
        Math.abs(f.agent.root.position.x) <= 999.68 &&
          Math.abs(f.agent.root.position.z) <= 999.68,
      );
      peak = Math.max(peak, f.agent.controller.velocity.length());
    }
  }
  assert.ok(peak > 300);
  assert.ok(
    f.steering.decisions < 100,
    `bounded route decisions ${f.steering.decisions}`,
  );
  const edge = fixture({ intelligence: 0, detection: 100 }, [], 20);
  edge.agent.root.position.set(18, 0, 0);
  edge.player.position.set(14, 0, 0);
  assert.ok(
    edge.steering.update(1 / 60, edge.agent, edge.player, neutral, [edge.agent])
      .x < 0,
  );
});

test("curated jungle escape routes go around solid columns and recover through a narrow city alley", () => {
  for (const [start, pursuer] of [
    [new Vector3(135, 0, -95), new Vector3(135, 0, -85)],
    [new Vector3(-130, 0, -75), new Vector3(-130, 0, -65)],
  ]) {
    const f = fixture(
      { intelligence: 2, detection: 200 },
      ALL_TRAVERSAL_STRUCTURES,
    );
    f.agent.root.position.copy(start);
    f.player.position.copy(pursuer);
    for (let i = 0; i < 900; i++) {
      step(f);
      assert.ok(
        f.world.isSpaceFree(f.agent.root.position, f.agent.body.radius, 1.8),
      );
    }
    assert.ok(
      f.agent.root.position.distanceTo(pursuer) > 25,
      f.agent.root.position.toArray().join(","),
    );
    assert.equal(
      f.agent.root.position.y,
      0,
      "ground escape never invokes enemy parkour",
    );
  }
});
