import test from "node:test";
import assert from "node:assert/strict";
import {
  Vector3,
  Group,
  Scene,
  Matrix4,
  Quaternion,
  PerspectiveCamera,
} from "three";
import {
  GEOMETRIC_WORLD_STRUCTURES as scenery,
  ALL_TRAVERSAL_STRUCTURES as surfaces,
  createWorldLayout,
  WORLD_ZONES,
  worldZoneAt,
} from "../src/world/GeometricWorldLayout.js";
import {
  StructureIndex,
  structureBounds,
} from "../src/world/StructureIndex.js";
import { TraversalWorld } from "../src/world/TraversalWorld.js";
import { box } from "../src/world/TraversalGeometry.js";
import { createGeometricWorld } from "../src/world/createGeometricWorld.js";
import { CharacterController } from "../src/movement/CharacterController.js";
import {
  sandboxMovementConfig,
  movementSubsteps,
} from "../src/sandbox/PhysicsSandbox.js";
import { BattleWorld } from "../src/combat/BattleWorld.js";
import { FollowCamera } from "../src/camera/FollowCamera.js";
const input = (x, y, m = Math.min(1, Math.hypot(x, y))) => ({
  move: { x, y },
  movementMagnitude: m,
  blocking: false,
});
const world = () => new TraversalWorld(1000, [], surfaces);
function tick(c, i, dt = 1 / 60) {
  const n = movementSubsteps(c, dt, undefined, i.movementMagnitude);
  for (let k = 0; k < n; k++) c.update(dt / n, i, 0);
  assert.ok(
    [...c.root.position, ...c.velocity, c.jump.verticalVelocity].every(
      Number.isFinite,
    ),
  );
}
const near = (a, b, e = 0.015) => assert.ok(Math.abs(a - b) < e, `${a} ~ ${b}`);

test("fixed city and jungle composition preserves the open arena and includes massive playable vertical routes", () => {
  assert.deepEqual(createWorldLayout(), scenery);
  assert.ok(scenery.length > 120 && scenery.length < 200);
  assert.equal(new Set(surfaces.map((s) => s.id)).size, surfaces.length);
  assert.equal(Math.max(...scenery.map((s) => s.top)), 320);
  assert.ok(scenery.filter((s) => s.style === "trunk").length >= 20);
  assert.ok(scenery.some((s) => s.style === "bridge" && s.bottom > 100));
  assert.ok(scenery.filter((s) => s.vaultable).length >= 5);
  for (const s of scenery) {
    const b = structureBounds(s);
    assert.ok(s.climbable && s.top > s.bottom);
    assert.ok(
      b.minX > -1000 && b.maxX < 1000 && b.minZ > -1000 && b.maxZ < 1000,
    );
    assert.ok(b.minX >= 100 || b.maxX <= -100);
  }
  assert.equal(worldZoneAt(new Vector3()), "Open training arena");
  assert.equal(worldZoneAt(new Vector3(-200, 0, -200)), WORLD_ZONES.city.name);
  assert.equal(worldZoneAt(new Vector3(200, 0, -200)), WORLD_ZONES.jungle.name);
  const w = world();
  for (let x = -90; x <= 90; x += 15)
    for (let z = 20; z < 900; z += 80)
      assert.ok(w.isSpaceFree(new Vector3(x, 0, z)));
});
test("every world collider has matching static instanced geometry and render work stays bounded", () => {
  const prior = globalThis.document;
  globalThis.document = {
    createElement: () => ({ getContext: () => ({ fillText() {} }) }),
  };
  try {
    const scene = new Scene(),
      v = createGeometricWorld(scene),
      ids = new Set(),
      m = new Matrix4(),
      p = new Vector3(),
      q = new Quaternion(),
      scale = new Vector3();
    let batches = 0;
    for (const mesh of v.group.children)
      if (mesh.isInstancedMesh) {
        batches++;
        assert.ok(mesh.frustumCulled);
        assert.equal(mesh.castShadow, false);
        mesh.userData.colliderIds.forEach((id, i) => {
          ids.add(id);
          const s = scenery.find((s) => s.id === id);
          mesh.getMatrixAt(i, m);
          m.decompose(p, q, scale);
          near(p.y, (s.top + s.bottom) / 2, 1e-4);
          near(scale.y, s.top - s.bottom, 1e-4);
          if (s.kind === "box") {
            near(p.x, (s.minX + s.maxX) / 2, 1e-4);
            near(scale.x, s.maxX - s.minX, 1e-4);
          } else near(scale.x, s.radius, 1e-5);
        });
      }
    assert.equal(ids.size, scenery.length);
    assert.ok(batches < 35);
    v.dispose();
    assert.ok(!scene.children.includes(v.group));
  } finally {
    if (prior === undefined) delete globalThis.document;
    else globalThis.document = prior;
  }
});
test("spatial queries match brute force in author order, share across enemy forks and cover extreme sweeps", () => {
  const index = new StructureIndex(surfaces),
    out = [];
  for (let i = 0; i < 300; i++) {
    const x = Math.sin(i * 1.7) * 600,
      z = Math.cos(i * 0.63) * 600,
      r = i % 8 === 0 ? 2000 : 2 + (i % 47);
    const actual = index.query(x - r, x + r, z - r, z + r, out);
    assert.deepEqual(
      actual,
      surfaces.filter((s) => {
        const b = structureBounds(s);
        return (
          b.maxX >= x - r &&
          b.minX <= x + r &&
          b.maxZ >= z - r &&
          b.minZ <= z + r
        );
      }),
    );
  }
  const w = world();
  assert.equal(w.fork(null).spatialIndex, w.spatialIndex);
  assert.equal(w.query(-10, 10, -10, 10).length, 0);
  assert.ok(w.query(-1e9, 1e9, -1e9, 1e9).length === surfaces.length);
});
test("city towers, suspended bridges and jungle crowns have continuous side, roof and underside collision at extreme travel", () => {
  const w = world(),
    out = new Vector3(),
    tower = scenery.find((s) => s.id === "city-monolith");
  w.sweep(new Vector3(-700, 80, -330), new Vector3(1400, 0, 0), 0.36, 1.8, out);
  near(out.x, tower.minX - 0.36);
  w.sweep(
    new Vector3(-365, 900, -330),
    new Vector3(0, -2000, 0),
    0.36,
    1.8,
    out,
  );
  near(out.y, 320);
  assert.ok(w.floorHit);
  const bridge = scenery.find((s) => s.id === "city-high-bridge");
  w.sweep(new Vector3(-258, 60, -295), new Vector3(0, 1000, 0), 0.36, 1.8, out);
  near(out.y, bridge.bottom - 1.8);
  assert.ok(w.ceilingHit);
  const crown = scenery.find((s) => s.id === "jungle-crown-0-1"),
    x = (crown.minX + crown.maxX) / 2;
  w.sweep(new Vector3(x, 200, -110), new Vector3(0, -400, 0), 0.36, 1.8, out);
  near(out.y, crown.top);
  assert.ok(w.isSpaceFree(out));
  near(w.supportHeight(out), crown.top);
});
test("city entry vault and wall climb transition continuously onto a rooftop", () => {
  const c = new CharacterController(new Group(), world());
  c.root.position.set(-130, 0, -78);
  const seen = new Set();
  let rooftop = false;
  for (let f = 0; f < 1200; f++) {
    tick(c, input(0, 1));
    seen.add(c.parkour.mode);
    if (c.parkour.lastExit === "rooftop" && c.root.position.y > 13.9) {
      rooftop = true;
      break;
    }
  }
  assert.ok(seen.has("vault") && seen.has("climb"));
  assert.ok(rooftop);
  near(c.root.position.y, 14);
  assert.ok(c.world.isSpaceFree(c.root.position));
});
test("giant jungle columns retain an unobstructed climb channel and usable crowns/perches", () => {
  const c = new CharacterController(new Group(), world());
  c.root.position.set(135, 0, -100);
  let roof = false;
  for (let f = 0; f < 1600; f++) {
    tick(c, input(0, 1));
    if (c.parkour.lastExit === "rooftop" && c.root.position.y > 37.9) {
      roof = true;
      break;
    }
  }
  assert.ok(roof);
  near(c.root.position.y, 38);
  assert.ok(c.world.isSpaceFree(c.root.position));
  const p = new CharacterController(new Group(), world());
  p.root.position.set(116, 0, -153);
  for (let f = 0; f < 900 && p.parkour.mode !== "perch"; f++)
    tick(p, input(0, 1));
  assert.equal(p.parkour.mode, "perch");
  near(p.root.position.y, 16);
});
test("unlimited tower climbing, high-speed glancing travel and wall jumping preserve player control", () => {
  const c = new CharacterController(new Group(), world());
  c.root.position.set(-365, 0, -306);
  for (let f = 0; f < 1200; f++) tick(c, input(0, 1));
  assert.ok(
    c.parkour.attached && c.root.position.y > 60 && c.root.position.y < 320,
  );
  c.requestJump(input(0, -1), 0);
  tick(c, input(0, -1));
  assert.equal(c.jump.jumpCount, 1);
  assert.equal(c.parkour.mode, "free");
  c.requestJump(input(1, 0), 0);
  tick(c, input(1, 0));
  assert.equal(c.jump.jumpCount, 2);
  assert.ok(c.jumpEvent.kind);
  const fast = new CharacterController(new Group(), world());
  fast.applyMovementConfig(sandboxMovementConfig({ movement: 100 }));
  fast.root.position.set(-110, 0, -60);
  for (let f = 0; f < 30; f++) tick(fast, input(1, 0));
  assert.equal(fast.parkour.mode, "free");
  assert.ok(Math.abs(fast.root.position.x) <= 999.64);
});
test("spawns avoid solids and remain separate at city roofs, jungle clusters and arena corners", () => {
  for (const position of [
    new Vector3(-365, 320, -330),
    new Vector3(216, 0, -192),
    new Vector3(135, 38, -110),
    new Vector3(999, 0, 999),
  ]) {
    const w = world(),
      b = new BattleWorld({ playerPosition: position, world: w, targets: [] });
    b.configureEnemies({ maxEnemies: 24 });
    assert.ok(b.alive > 0);
    for (const e of b.enemies)
      if (e.spawned && e.body.active) {
        assert.ok(w.isSpaceFree(e.root.position, 0.4, 1.8));
        assert.ok(
          Math.abs(e.root.position.x) < 1000 &&
            Math.abs(e.root.position.z) < 1000,
        );
      }
    b.spawnWave();
    for (const e of b.enemies)
      if (e.spawned && e.body.active)
        assert.ok(w.isSpaceFree(e.root.position, 0.4, 1.8));
  }
});
test("basic enemy detours route around a wall without enabling enemy parkour or changing open-ground steering", () => {
  for (const speed of [1, 20]) {
    const w = new TraversalWorld(100, [], [box("wall", 0, -5, 12, 16, 2)]),
      b = new BattleWorld({
        playerPosition: new Vector3(0, 0, -12),
        world: w,
        targets: [],
      });
    for (const e of b.enemies) e.spawned = e.body.active = false;
    const e = b.enemies[0];
    e.spawn(new Vector3(0, 0, 0), 1, 100);
    b.rebuildBodies();
    b.configureEnemies({
      speed,
      acceleration: 2,
      attackFrequency: 0,
      detection: 100,
    });
    let sideways = 0;
    for (let f = 0; f < 2400; f++) {
      const n = b.recommendedSubsteps(1 / 60);
      for (let k = 0; k < n; k++) {
        b.beginStep(1 / 60 / n, false, 0);
        b.endStep(1 / 60 / n, 0);
      }
      sideways = Math.max(sideways, Math.abs(e.root.position.x));
      assert.ok(w.isSpaceFree(e.root.position, 0.319, 1.8));
      if (e.root.position.distanceTo(b.player.position) < 2.8) break;
    }
    assert.ok(sideways > 6.3, `speed ${speed}: went around the wall`);
    assert.ok(
      e.root.position.distanceTo(b.player.position) < 2.8,
      `${speed}: ${e.root.position.toArray()}`,
    );
    assert.equal(e.controller.parkour, null);
  }
});
test("camera clearance remains stable around giant walls and crowns with unchanged orbit", () => {
  const w = world(),
    p = new Vector3(-365, 200, -307.6),
    camera = new PerspectiveCamera(),
    follow = new FollowCamera(camera, p);
  follow.world = w;
  const yaw = follow.yaw,
    pitch = follow.pitch;
  for (let i = 0; i < 120; i++) follow.update(1 / 60, p, { x: 0, y: 0 });
  assert.equal(follow.yaw, yaw);
  assert.equal(follow.pitch, pitch);
  assert.ok(w.isSpaceFree(camera.position, 0.1, 0.2));
  assert.ok([...camera.position, ...camera.quaternion].every(Number.isFinite));
});

test("local detours negotiate the actual city entry barrier and building in sequence", () => {
  const w = world(),
    b = new BattleWorld({
      playerPosition: new Vector3(-130, 0, -128),
      world: w,
      targets: [],
    });
  for (const a of b.enemies) a.spawned = a.body.active = false;
  const e = b.enemies[0];
  e.spawn(new Vector3(-130, 0, -70), 1, 100);
  b.rebuildBodies();
  b.configureEnemies({ attackFrequency: 0, detection: 200 });
  for (let f = 0; f < 3600; f++) {
    b.beginStep(1 / 60, false, 0);
    b.endStep(1 / 60, 0);
    assert.ok(w.isSpaceFree(e.root.position, 0.319, 1.8));
    if (e.root.position.distanceTo(b.player.position) < 2.8) break;
  }
  assert.ok(
    e.root.position.distanceTo(b.player.position) < 2.8,
    e.root.position.toArray().join(","),
  );
  assert.ok(e.navigation.plans < 100);
});

test("unreachable rooftop goals cache failed local routes and leave ground enemies stable", () => {
  const w = new TraversalWorld(100, [], [box("roof", 0, -5, 12, 16, 2)]),
    b = new BattleWorld({
      playerPosition: new Vector3(0, 16, -5),
      world: w,
      targets: [],
    });
  for (const a of b.enemies) a.spawned = a.body.active = false;
  const e = b.enemies[0];
  e.spawn(new Vector3(), 1, 100);
  b.rebuildBodies();
  b.configureEnemies({ attackFrequency: 0 });
  for (let i = 0; i < 300; i++) {
    b.beginStep(1 / 120, false, 0);
    b.endStep(1 / 120, 0);
    assert.ok(w.isSpaceFree(e.root.position, 0.319, 1.8));
  }
  assert.ok(e.navigation.plans > 0 && e.navigation.plans < 25);
  assert.equal(e.root.position.y, 0);
  assert.ok(e.controller.velocity.length() < 0.01);
});
