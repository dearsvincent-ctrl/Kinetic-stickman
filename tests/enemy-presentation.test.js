import test from "node:test";
import assert from "node:assert/strict";
import {
  Group,
  Matrix4,
  PerspectiveCamera,
  Scene,
  Vector3,
  Color,
} from "three";
import { EnemyViews } from "../src/character/EnemyViews.js";
import { EnemyCrowdViews } from "../src/character/EnemyCrowdViews.js";
import { CharacterController } from "../src/movement/CharacterController.js";
import { Combatant } from "../src/combat/Combatant.js";
import { CombatController } from "../src/combat/CombatController.js";
import { createManualTechniques } from "../src/combat/ManualTechniques.js";
import { TraversalWorld } from "../src/world/TraversalWorld.js";
import { box } from "../src/world/TraversalGeometry.js";
import { ENEMY_LIMITS } from "../src/sandbox/EnemySettings.js";

const profiles = [
  { id: "standard", color: 0xb85f51 },
  { id: "acrobat", color: 0x55aaa0 },
  { id: "leaper", color: 0xd6aa50 },
  { id: "heavy", color: 0x8f719e },
];
function agent(index, profile = profiles[0], world = new TraversalWorld(1000)) {
  const root = new Group();
  root.position.set(index * 2, 0, 0);
  return {
    index,
    root,
    profile,
    spawned: true,
    defeatTime: 0,
    body: new Combatant(`presentation-${index}`, root.position),
    controller: new CharacterController(root, world),
    combat: new CombatController({ techniques: createManualTechniques() }),
  };
}
function finiteRig(character) {
  for (const joint of Object.values(character.joints))
    assert.ok(
      [...joint.position, ...joint.quaternion, ...joint.scale].every(
        Number.isFinite,
      ),
      joint.name,
    );
}
const camera = () => {
  const c = new PerspectiveCamera();
  c.position.set(0, 2, 5);
  c.lookAt(0, 1, 0);
  return c;
};
const idle = { move: { x: 0, y: 0 }, movementMagnitude: 0 };

test("archetypes share primitive geometry and a bounded color palette across reused enemy slots", () => {
  const agents = Array.from({ length: 12 }, (_, i) =>
      agent(i, profiles[i % 4]),
    ),
    scene = new Scene(),
    views = new EnemyViews(scene, agents);
  const first = views.views[0].character;
  for (let i = 0; i < agents.length; i++) {
    const v = views.views[i];
    assert.equal(
      v.character.resources.sphereGeometry,
      first.resources.sphereGeometry,
    );
    assert.equal(
      v.character.resources.rodGeometry,
      first.resources.rodGeometry,
    );
    assert.equal(
      v.character.resources.ivory.color.getHex(),
      agents[i].profile.color,
    );
    assert.equal(
      v.bodyParts[0].material,
      views.views[i % 4].bodyParts[0].material,
    );
  }
  assert.equal(views.palette.size, 4);
  const sharedGeometry = first.resources.sphereGeometry;
  agents[0].profile = profiles[2];
  agents[0].body.id = "respawn-leaper";
  views.update(1 / 60, camera(), new Vector3());
  assert.equal(
    views.views[0].character.resources.ivory,
    views.views[2].character.resources.ivory,
  );
  assert.equal(
    views.views[0].bodyParts[0].material.color.getHex(),
    profiles[2].color,
  );
  assert.equal(
    views.views[0].character.resources.sphereGeometry,
    sharedGeometry,
  );
  assert.equal(
    views.palette.size,
    4,
    "profile reassignment creates no extra palette materials",
  );
  views.dispose();
});

test("detailed enemies reuse coordinated wall and jump presentation without moving physics roots", () => {
  const world = new TraversalWorld(1000, [], [box("climb", 0, -3, 8, 12, 2)]),
    a = agent(0, profiles[1], world),
    views = new EnemyViews(new Scene(), [a]),
    c = camera();
  const input = { move: { x: 0, y: 1 }, movementMagnitude: 1 };
  for (let frame = 0; frame < 90; frame++) {
    a.controller.update(1 / 60, input, 0);
    const position = a.root.position.clone(),
      orientation = a.root.quaternion.clone();
    views.update(1 / 60, c, a.root.position);
    assert.deepEqual(a.root.position, position);
    assert.deepEqual(a.root.quaternion.toArray(), orientation.toArray());
    finiteRig(views.views[0].character);
  }
  assert.ok(a.controller.parkour.attached);
  assert.ok(a.root.position.y > 1);
  const view = views.views[0];
  assert.ok(view.parkour.weight > 0.9);
  const climbingHand = view.character.joints.leftHand.getWorldPosition(
    new Vector3(),
  );
  assert.ok(climbingHand.y > a.root.position.y + 1.2);
  assert.ok(
    a.controller.requestJump({ move: { x: 1, y: -1 }, cameraYaw: 0 }, 0),
  );
  for (let frame = 0; frame < 90; frame++) {
    a.controller.update(1 / 60, idle, 0);
    views.update(1 / 60, c, a.root.position);
    finiteRig(view.character);
  }
  assert.equal(a.controller.parkour.attached, false);
  assert.ok(view.parkour.weight < 0.01);
  views.dispose();
});

test("extreme enemy running and ballistic jumps keep coordinated poses finite and root translation independent", () => {
  const a = agent(0, profiles[2]),
    views = new EnemyViews(new Scene(), [a]),
    c = camera();
  a.controller.speed = 5000;
  a.controller.jump.configure({
    ...a.controller.jump.config,
    height: 400,
    maxJumps: 2,
  });
  a.controller.jump.start();
  for (let frame = 0; frame < 240; frame++) {
    a.controller.jump.advance(1 / 60);
    a.root.position.x += 5000 / 60;
    a.root.position.y = a.controller.jump.height;
    const physical = a.root.position.clone();
    views.update(1 / 60, c, a.root.position);
    assert.deepEqual(a.root.position, physical);
    finiteRig(views.views[0].character);
  }
  assert.ok(views.views[0].animator.locomotion.cadence < 10);
  views.dispose();
});

test("wall running and ledge-to-rooftop presentation recover into supported standing without root motion", () => {
  const world = new TraversalWorld(1000, [], [box("roof", 0, -3, 30, 8, 2)]),
    a = agent(0, profiles[1], world),
    views = new EnemyViews(new Scene(), [a]),
    c = camera(),
    seen = new Set();
  let rooftop = false;
  for (let frame = 0; frame < 700; frame++) {
    const input =
      frame >= 75 && frame < 110
        ? { move: { x: 1, y: 0.2 }, movementMagnitude: 1 }
        : { move: { x: 0, y: 1 }, movementMagnitude: 1 };
    a.controller.update(1 / 60, input, 0);
    seen.add(a.controller.parkour.mode);
    const physical = a.root.position.clone();
    views.update(1 / 60, c, a.root.position);
    assert.deepEqual(a.root.position, physical);
    finiteRig(views.views[0].character);
    if (a.controller.parkour.lastExit === "rooftop") {
      rooftop = true;
      break;
    }
  }
  assert.ok(seen.has("wall-run"));
  assert.ok(seen.has("ledge") || seen.has("mantle"));
  assert.ok(rooftop);
  for (let frame = 0; frame < 40; frame++) {
    a.controller.update(1 / 60, idle, 0);
    views.update(1 / 60, c, a.root.position);
  }
  assert.ok(Math.abs(a.root.position.y - 8) < 1e-4);
  assert.ok(views.views[0].parkour.weight < 0.001);
  for (const side of ["left", "right"])
    assert.ok(
      views.views[0].character.joints[`${side}Ankle`].getWorldPosition(
        new Vector3(),
      ).y >= 8,
    );
  views.dispose();
});

test("crowd LOD retains archetype colors, animated aerial/climb poses and bounded instance budgets", () => {
  const scene = new Scene(),
    crowd = new EnemyCrowdViews(scene),
    c = camera(),
    m = new Matrix4(),
    color = new Color();
  const a = agent(0, profiles[2]);
  crowd.begin();
  crowd.add(a, 1 / 60, c);
  crowd.rods.getMatrixAt(1, m);
  const grounded = [...m.elements];
  crowd.heads.getColorAt(0, color);
  assert.equal(color.getHex(), profiles[2].color);
  a.controller.jump.start();
  a.controller.jump.advance(0.12);
  crowd.begin();
  crowd.add(a, 1 / 60, c);
  crowd.rods.getMatrixAt(1, m);
  assert.notDeepEqual(
    [...m.elements],
    grounded,
    "airborne arm recovery differs from ordinary running",
  );
  a.controller.parkour.setMode("climb");
  a.controller.parkour.velocity.set(0, 4, 0);
  crowd.begin();
  crowd.add(a, 1 / 60, c);
  crowd.rods.getMatrixAt(1, m);
  const climb = [...m.elements];
  crowd.begin();
  crowd.add(a, 0.1, c);
  crowd.rods.getMatrixAt(1, m);
  assert.notDeepEqual(
    [...m.elements],
    climb,
    "opposite climbing limbs advance with actual traversal speed",
  );
  crowd.begin();
  for (let i = 0; i < ENEMY_LIMITS.population + 10; i++)
    crowd.add(a, 1 / 60, c);
  crowd.end();
  assert.equal(crowd.heads.count, ENEMY_LIMITS.population);
  assert.equal(crowd.rods.count, ENEMY_LIMITS.population * 9);
  assert.equal(crowd.group.children.length, 4);
  for (const mesh of crowd.group.children)
    assert.ok([...mesh.instanceMatrix.array].every(Number.isFinite));
  crowd.dispose();
  assert.ok(!scene.children.includes(crowd.group));
});

test("enemy visual pool retains the detailed rig limit, hides tagged bodies and disposes shared palette once", () => {
  const agents = Array.from({ length: ENEMY_LIMITS.population }, (_, i) =>
      agent(i, profiles[i % 4]),
    ),
    scene = new Scene(),
    views = new EnemyViews(scene, agents);
  const resources = new Set([
    ...Object.values(views.resources),
    ...views.palette.values(),
  ]);
  const disposals = new Map();
  for (const r of resources)
    r.addEventListener("dispose", () =>
      disposals.set(r, (disposals.get(r) ?? 0) + 1),
    );
  views.update(1 / 60, camera(), new Vector3());
  assert.equal(
    agents.filter((a) => a.root.visible).length,
    ENEMY_LIMITS.fullRigs,
  );
  assert.equal(
    views.crowd.heads.count,
    ENEMY_LIMITS.population - ENEMY_LIMITS.fullRigs,
  );
  agents[0].spawned = false;
  agents[0].body.active = false;
  views.update(1 / 60, camera(), new Vector3());
  assert.equal(agents[0].root.visible, false);
  agents[0].spawned = agents[0].body.active = true;
  agents[0].body.id = "respawned-runner";
  views.update(1 / 60, camera(), new Vector3());
  assert.equal(agents[0].root.visible, true);
  assert.equal(views.views[0].generation, agents[0].body.id);
  views.dispose();
  for (const resource of resources)
    assert.equal(disposals.get(resource), 1, resource.type);
  assert.ok(agents.every((a) => !scene.children.includes(a.root)));
});
