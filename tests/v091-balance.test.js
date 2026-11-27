import test from "node:test";
import assert from "node:assert/strict";
import { Vector3 } from "three";
import { BattleWorld } from "../src/combat/BattleWorld.js";
import { TraversalWorld } from "../src/world/TraversalWorld.js";
import { BalanceState } from "../src/combat/BalanceState.js";
import {
  REACTION_DEFAULTS,
  sanitizeReactions,
  loadReactions,
} from "../src/sandbox/ReactionSettings.js";
const near = (a, b, e = 1e-6) => assert.ok(Math.abs(a - b) < e, `${a} ~ ${b}`);
function fixture(profile = "standard", settings = {}) {
  const b = new BattleWorld({
    playerPosition: new Vector3(),
    world: new TraversalWorld(10000, [], []),
    targets: [],
  });
  b.configureEnemies({ maxEnemies: 1, speed: 0.1, attackFrequency: 0 });
  b.configureReactions(settings);
  const e = b.enemies.find((e) => e.spawned);
  e.setProfile(b.enemyProfiles[profile]);
  e.spawn(new Vector3(0, 0, -5), 1, 100);
  return { b, e };
}
function hit(
  f,
  impact = 1,
  action = "punch",
  height = 1.36,
  direction = new Vector3(0, 0, -1),
) {
  f.b.configureStrength({ attackPower: 0, impact });
  return f.b.hitEnemy(
    {
      targetId: f.e.body.id,
      source: new Vector3(),
      targetPosition: f.e.root.position.clone(),
      point: f.e.root.position.clone().add(new Vector3(0, height, 0)),
      direction,
    },
    { action },
  );
}
function run(f, seconds, hz = 120) {
  for (let t = 0; t < seconds - 1e-8; t += 1 / hz) {
    const dt = Math.min(1 / hz, seconds - t);
    f.b.beginStep(dt, false, 0);
    f.b.endStep(dt, 0);
  }
}

test("v091 light/moderate/heavy impacts span standing reactions while a powerful single hit launches", () => {
  for (const [impact, phase] of [
    [1, "recoil"],
    [4, "stumble"],
    [10, "heavy-stumble"],
  ]) {
    const f = fixture();
    hit(f, impact);
    assert.equal(f.e.reaction.phase, phase);
    assert.equal(f.e.reaction.ownsMotion, false);
    assert.equal(f.e.reaction.ragdoll, false);
    assert.equal(f.e.body.health, 72);
  }
  const f = fixture();
  hit(f, 20, "kick");
  assert.equal(f.e.reaction.phase, "flight");
  assert.equal(f.e.reaction.ragdoll, true);
});
test("v091 substantial backward displacement does not require loss of footing", () => {
  const f = fixture();
  hit(f, 10);
  run(f, 0.3);
  assert.ok(f.e.root.position.z < -7);
  assert.equal(f.e.reaction.ownsMotion, false);
  assert.ok(f.e.reaction.balance.instability < 1);
  near(f.e.root.position.y, 0);
});
test("v091 consecutive impacts progressively exhaust balance without a scripted hit count", () => {
  const f = fixture();
  let count = 0;
  while (!f.e.reaction.ownsMotion && count < 12) {
    hit(f, 4);
    count++;
    if (!f.e.reaction.ownsMotion) run(f, 0.4);
  }
  assert.ok(count > 1 && count < 12);
  assert.ok(f.e.reaction.balance.instability >= 1);
  assert.equal(f.e.body.health, 72);
  const strong = fixture();
  hit(strong, 100);
  assert.equal(strong.e.reaction.phase, "flight");
});
test("v091 balance recovers after a quiet interval, including after visual recoil has ended", () => {
  const f = fixture();
  hit(f, 4);
  const damaged = f.e.reaction.balance.instability;
  run(f, 0.35);
  near(f.e.reaction.balance.instability, damaged);
  run(f, 2);
  near(f.e.reaction.balance.instability, 0);
  assert.equal(f.e.reaction.phase, "idle");
});
test("v091 health, displacement, balance damage, knockdown resistance and visual gains remain separate", () => {
  const normal = fixture(),
    stable = fixture("standard", { knockdownResistance: 20 }),
    noWear = fixture("standard", { balanceDamage: 0 }),
    visual = fixture("standard", {
      lightIntensity: 0,
      moderateIntensity: 0,
      heavyIntensity: 0,
    });
  for (const f of [normal, stable, noWear, visual]) hit(f, 10);
  near(normal.e.body.impulse.length(), stable.e.body.impulse.length());
  near(normal.e.body.impulse.length(), visual.e.body.impulse.length());
  assert.ok(
    stable.e.reaction.balance.instability <
      normal.e.reaction.balance.instability,
  );
  assert.ok(
    noWear.e.reaction.balance.instability <
      normal.e.reaction.balance.instability,
  );
  assert.equal(visual.e.reaction.weight, 0);
  for (const f of [normal, stable, noWear, visual])
    assert.equal(f.e.body.health, 72);
  const huge = fixture("standard", { knockdownResistance: 20 });
  hit(huge, 100);
  assert.equal(huge.e.reaction.ownsMotion, false);
  assert.ok(huge.e.body.impulse.length() > 200);
});
test("v091 get-up speed does not change standing recovery or balance recovery", () => {
  const a = fixture("standard", { recovery: 0.1 }),
    b = fixture("standard", { recovery: 10 });
  hit(a, 4);
  hit(b, 4);
  run(a, 0.3);
  run(b, 0.3);
  near(a.e.reaction.weight, b.e.reaction.weight);
  near(a.e.reaction.balance.instability, b.e.reaction.balance.instability);
  const fast = fixture("standard", { standingRecovery: 3 });
  hit(fast, 4);
  run(fast, 0.3);
  assert.ok(fast.e.reaction.weight < a.e.reaction.weight);
});
test("v091 head/leg contact, lateral impact, posture, momentum and archetype stability influence balance", () => {
  const settings = REACTION_DEFAULTS;
  const apply = (impact = {}, profile = {}, ctx = {}) => {
    const b = new BalanceState();
    b.hit(
      { force: 10, action: "punch", location: "body", ...impact },
      settings,
      profile,
      ctx,
    );
    return b.instability;
  };
  const base = apply();
  assert.ok(apply({}, {}, { kicking: true }) > base);
  assert.ok(apply({}, {}, { guarded: true }) < base);
  assert.ok(apply({ location: "head" }) > base);
  assert.ok(apply({ location: "leg" }) > base);
  assert.ok(apply({}, {}, { side: 1 }) > base);
  assert.ok(apply({}, {}, { airborne: true, speed: 50 }) > base);
  assert.ok(apply({ speed: 100 }) > base);
  assert.ok(apply({}, { mass: 2.5, balance: 1.8 }) < base);
  const a = fixture(),
    b = fixture("heavy");
  hit(a, 10);
  hit(b, 10);
  assert.ok(
    a.e.reaction.balance.instability > b.e.reaction.balance.instability,
  );
});
test("v091 interrupted standing recovery retains its pose and step cadence across punch/kick hits", () => {
  const f = fixture();
  hit(f, 4);
  run(f, 0.12);
  const pose = Array.from(f.e.reaction.jointAngles),
    step = f.e.reaction.stepPhase;
  hit(f, 3, "kick");
  assert.deepEqual(Array.from(f.e.reaction.jointAngles), pose);
  assert.equal(f.e.reaction.stepPhase, step);
  assert.equal(f.e.reaction.ownsMotion, false);
  run(f, 0.05);
  assert.ok(f.e.reaction.stepPhase > step);
});
test("v091 instability and recovery agree across 30/60/120/144 Hz", () => {
  const values = [30, 60, 120, 144].map((hz) => {
    const f = fixture();
    hit(f, 4);
    run(f, 0.7, hz);
    hit(f, 4, "kick");
    run(f, 1.25, hz);
    return f.e.reaction.balance.instability;
  });
  for (const v of values) near(v, values[0], 0.002);
});
test("v091 extreme impulses remain capable of immediate launches without prior accumulated wear", () => {
  const f = fixture("standard", { balanceDamage: 0 });
  hit(f, 100, "kick");
  assert.equal(f.e.reaction.phase, "flight");
  run(f, 0.5);
  assert.ok(f.e.root.position.distanceTo(new Vector3(0, 0, -5)) > 100);
  assert.ok(f.e.reaction.velocity.length() <= 1200);
  near(f.e.reaction.orientation.length(), 1);
});
test("v091 new reaction settings migrate old saves without altering existing values and thresholds are independent", () => {
  const saved = loadReactions({
    getItem: () =>
      JSON.stringify({
        version: 1,
        values: { launch: 3, recovery: 0.5, ragdollEnabled: false },
      }),
  });
  assert.equal(saved.launch, 3);
  assert.equal(saved.recovery, 0.5);
  assert.equal(saved.ragdollEnabled, false);
  assert.equal(saved.balanceDamage, 1);
  assert.equal(saved.standingRecovery, 1);
  const independent = sanitizeReactions({
    stagger: 30,
    knockdown: 3,
    ragdoll: 2,
  });
  assert.equal(independent.knockdown, 3);
  assert.equal(independent.ragdoll, 2);
});

test("v091 visible standing head contact stays aligned through heavy torso recoil and recovery steps", async () => {
  const { EnemyViews } = await import("../src/character/EnemyViews.js");
  const { Scene, PerspectiveCamera } = await import("three");
  const f = fixture(),
    views = new EnemyViews(new Scene(), f.b.enemies),
    camera = new PerspectiveCamera(),
    point = new Vector3();
  try {
    hit(f, 10);
    for (let i = 0; i < 50; i++) {
      run(f, 1 / 120);
      views.update(1 / 120, camera, f.e.root.position);
      if (!f.e.reaction.active || f.e.reaction.ownsMotion) continue;
      const view = views.views[f.e.index];
      view.character.root.updateMatrixWorld(true);
      view.character.joints.head.getWorldPosition(point);
      const head = f.e.body.hitboxes[2];
      assert.ok(
        point.distanceTo(
          new Vector3(
            f.e.root.position.x + head.x,
            f.e.root.position.y + head.height,
            f.e.root.position.z + head.z,
          ),
        ) < 0.015,
        JSON.stringify({
          point: point.toArray(),
          head,
          hip: view.character.joints.hips.position.toArray(),
          heading: f.e.controller.heading,
          root: f.e.root.quaternion.toArray(),
          r: view.character.joints.hips.quaternion.toArray(),
        }),
      );
      assert.ok(Math.abs(view.character.joints.spine.rotation.x) <= 0.85);
    }
  } finally {
    views.dispose();
  }
});

test("v091 surviving a genuine knockdown restores enough footing to avoid a light-hit fall/get-up loop", () => {
  const f = fixture("standard", { balanceRecovery: 0, recovery: 5 });
  hit(f, 20, "kick");
  assert.equal(f.e.reaction.phase, "flight");
  run(f, 7);
  assert.equal(f.e.reaction.phase, "idle");
  assert.ok(f.e.reaction.balance.instability <= 0.35);
  hit(f, 1);
  assert.equal(f.e.reaction.ownsMotion, false);
  assert.ok(f.e.reaction.balance.instability < 1);
  hit(f, 100, "kick");
  assert.equal(
    f.e.reaction.phase,
    "flight",
    "Restored footing never prevents a legitimate single extreme launch",
  );
});

test("v091 high-intensity standing recovery fades before ending instead of snapping to a neutral pose", async () => {
  const { EnemyViews } = await import("../src/character/EnemyViews.js");
  const { Scene, PerspectiveCamera } = await import("three");
  const f = fixture("standard", { intensity: 3, heavyIntensity: 3 }),
    views = new EnemyViews(new Scene(), f.b.enemies),
    camera = new PerspectiveCamera();
  try {
    hit(f, 10);
    let previous = null,
      largestLateChange = 0;
    for (let i = 0; i < 480; i++) {
      run(f, 1 / 120);
      views.update(1 / 120, camera, f.e.root.position);
      const angle = views.views[f.e.index].character.joints.spine.rotation.x;
      if (i > 40 && previous !== null)
        largestLateChange = Math.max(
          largestLateChange,
          Math.abs(angle - previous),
        );
      previous = angle;
    }
    assert.ok(
      largestLateChange < 0.12,
      `Standing recovery snapped ${largestLateChange} radians`,
    );
    assert.equal(f.e.reaction.phase, "idle");
  } finally {
    views.dispose();
  }
});
