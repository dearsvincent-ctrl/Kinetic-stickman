import test from "node:test";
import assert from "node:assert/strict";
import { Box3, Vector3 } from "three";
import { Stickman } from "../src/character/Stickman.js";
import { CharacterAnimator } from "../src/character/CharacterAnimator.js";
import { resolveAnimationStyle } from "../src/character/AnimationStyle.js";
import { CharacterController } from "../src/movement/CharacterController.js";
import { ArenaBounds } from "../src/world/ArenaBounds.js";
import { CombatController } from "../src/combat/CombatController.js";

const sides = ["left", "right"];
const pos = (c, name) => c.joints[name].getWorldPosition(new Vector3());
const fixture = () => {
  const character = new Stickman();
  return { character, animator: new CharacterAnimator(character) };
};
const step = (a, speed, dt, angle = 0, blocking = false) => {
  a.character.root.position.addScaledVector(
    new Vector3(-Math.sin(angle), 0, -Math.cos(angle)),
    speed * dt,
  );
  a.character.root.rotation.y = angle;
  const before = a.character.root.position.clone(),
    q = a.character.root.quaternion.clone();
  a.animator.update(dt, { speed, blocking });
  assert.ok(
    a.character.root.position.equals(before) &&
      a.character.root.quaternion.equals(q),
  );
  a.character.root.updateMatrixWorld(true);
};
const settle = (a, speed, dt, angle = 0) => {
  for (let i = 0; i < Math.ceil(1.5 / dt); i++) step(a, speed, dt, angle);
};

test("walking keeps support while run and sprint have actual sustained two-foot flight at 30/60/120 Hz", () => {
  for (const rate of [30, 60, 120]) {
    const fractions = [];
    for (const speed of [0.65, 2.6, 5.2]) {
      const a = fixture(),
        dt = 1 / rate;
      settle(a, speed, dt);
      let flight = 0,
        contacts = 0,
        longest = 0,
        consecutive = 0,
        highest = 0;
      for (let i = 0; i < rate * 2; i++) {
        step(a, speed, dt);
        const feet = sides.map(
          (s) =>
            new Box3().setFromObject(a.character.joints[`${s}Ankle`]).min.y,
        );
        const floor = Math.min(...feet);
        assert.ok(
          floor >= -0.015,
          "Foot meshes never penetrate the arena floor",
        );
        highest = Math.max(highest, floor);
        if (floor > 0.025) {
          flight++;
          consecutive++;
          longest = Math.max(longest, consecutive);
        } else {
          consecutive = 0;
          contacts++;
        }
        assert.equal(
          a.character.root.position.y,
          0,
          "Visual flight never turns locomotion into a physical jump",
        );
      }
      fractions.push(flight / (rate * 2));
      if (speed === 0.65) assert.equal(flight, 0);
      else assert.ok(flight > 0 && contacts > 0);
      if (speed === 5.2)
        assert.ok(
          flight > rate * 0.5 && longest * dt >= 0.06 && highest > 0.15,
          "Sprint includes long visible flight windows, not merely an unplanted flag",
        );
      a.character.dispose();
    }
    assert.ok(fractions[2] > fractions[1] + 0.2);
  }
});

test("sprint drives a high knee, extends the rear leg and loads before flight", () => {
  const a = fixture(),
    dt = 1 / 120;
  settle(a, 5.2, dt);
  let kneeDrive = 0,
    rearExtension = 0,
    low = 2,
    high = 0;
  for (let i = 0; i < 240; i++) {
    step(a, 5.2, dt);
    low = Math.min(low, a.character.joints.hips.position.y);
    high = Math.max(high, a.character.joints.hips.position.y);
    for (const s of sides) {
      const hip = pos(a.character, `${s}Hip`),
        knee = pos(a.character, `${s}Knee`),
        ankle = pos(a.character, `${s}Ankle`);
      kneeDrive = Math.max(kneeDrive, knee.y - hip.y);
      if (ankle.z - a.character.root.position.z > 0.28)
        rearExtension = Math.max(rearExtension, hip.distanceTo(ankle));
    }
  }
  assert.ok(kneeDrive > 0.1 && rearExtension > 0.8);
  assert.ok(high - low > 0.13 && low > 0.75 && high < 1.02);
  a.character.dispose();
});

test("sprint arm trails are brief and return to purposeful opposing arm drive", () => {
  const a = fixture(),
    dt = 1 / 120;
  settle(a, 5.2, dt);
  let trail = 0,
    front = 0,
    back = 0,
    largest = 0;
  let previous = pos(a.character, "rightHand").sub(a.character.root.position);
  for (let i = 0; i < 360; i++) {
    step(a, 5.2, dt);
    const arms = a.animator.pose.arms;
    if (arms.every((arm) => arm.x < -0.15)) trail++;
    front = Math.max(front, ...arms.map((arm) => arm.x));
    back = Math.min(back, ...arms.map((arm) => arm.x));
    const p = pos(a.character, "rightHand").sub(a.character.root.position);
    largest = Math.max(largest, p.distanceTo(previous));
    previous = p;
  }
  assert.ok(
    trail > 0 && trail < 360 * 0.3,
    "Both arms are never permanently parked behind the body",
  );
  assert.ok(front > 0.6 && back < -0.6);
  assert.ok(
    largest < 0.2,
    "Trailing/pumping handoffs do not snap between poses",
  );
  a.character.dispose();
});

test("running contacts stay fixed through forward and sideways sprinting", () => {
  for (const angle of [0, Math.PI / 2, -Math.PI / 2, Math.PI]) {
    const a = fixture(),
      dt = 1 / 60;
    settle(a, 5.2, dt, angle);
    const anchors = [null, null];
    for (let i = 0; i < 150; i++) {
      step(a, 5.2, dt, angle);
      for (let f = 0; f < 2; f++) {
        const p = pos(a.character, `${sides[f]}Ankle`);
        if (a.animator.footList[f].planted) {
          anchors[f] ??= p;
          assert.ok(
            p.distanceTo(anchors[f]) < 0.025,
            "Planted foot sliding stays below 2.5 cm",
          );
        } else anchors[f] = null;
      }
    }
    a.character.dispose();
  }
});

test("walk/run/sprint, reversals and guard transitions preserve joint limits and smooth visual contacts", () => {
  for (const rate of [30, 60, 120]) {
    const a = fixture(),
      dt = 1 / rate;
    let largest = 0,
      last = null;
    for (let i = 0; i < rate * 6; i++) {
      const t = i * dt;
      const speed =
        5.2 *
        Math.sin((Math.min(t, 3) * Math.PI) / 6) *
        (t > 4.5 ? Math.max(0, (6 - t) / 1.5) : 1);
      const angle = t < 2 ? 0 : Math.sin((t - 2) * 2) * Math.PI;
      step(a, speed, dt, angle, t > 3 && t < 3.8);
      const ankle = pos(a.character, "rightAnkle").sub(
        a.character.root.position,
      );
      if (last) largest = Math.max(largest, ankle.distanceTo(last));
      last = ankle;
      for (const s of sides) {
        const h = pos(a.character, `${s}Hip`),
          k = pos(a.character, `${s}Knee`),
          f = pos(a.character, `${s}Ankle`);
        assert.ok(k.clone().sub(h).angleTo(f.clone().sub(k)) < 2.65);
        assert.ok(
          new Box3().setFromObject(a.character.joints[`${s}Ankle`]).min.y >
            -0.02,
        );
      }
    }
    assert.ok(largest < 22 * dt + 0.04);
    a.character.dispose();
  }
});

test("running style validation retains flight and ordered heel/knee/landing phases", () => {
  for (const locomotion of [
    { runDuty: 0.5 },
    { sprintDuty: 0.7 },
    { heelFraction: 0.8 },
    { kneeFraction: 1 },
    { kneeReach: 0 },
    { flightTrail: 1.1 },
  ])
    assert.throws(() => resolveAnimationStyle({ locomotion }), RangeError);
});

test("sprint can yield to Dash, Jump or a punch throughout its support and flight phases without freezing or snapping", () => {
  for (const rate of [30, 60, 120]) {
    const dt = 1 / rate;
    for (const action of ["dash", "jump", "punch"]) {
      for (const offset of [0, 0.06, 0.12, 0.18, 0.24, 0.3, 0.36, 0.42]) {
        const a = fixture();
        const movement = new CharacterController(
          a.character.root,
          new ArenaBounds(100),
        );
        const combat = new CombatController();
        const advance = () => {
          movement.update(
            dt,
            { move: { x: 0, y: 1 }, sprinting: true, blocking: false },
            0,
          );
          combat.update(dt);
          a.animator.update(dt, {
            speed: movement.speed,
            dash: movement.dash,
            jump: movement.jump,
            combat,
          });
        };
        for (let i = 0; i < Math.ceil((1.5 + offset) / dt); i++) advance();
        if (action === "dash") assert.ok(movement.requestDash());
        else if (action === "jump") assert.ok(movement.requestJump());
        else assert.ok(combat.requestAttack());
        let hand = pos(a.character, "rightHand").sub(a.character.root.position);
        let foot = pos(a.character, "rightAnkle").sub(
          a.character.root.position,
        );
        for (let i = 0; i < Math.ceil(0.9 / dt); i++) {
          const z = a.character.root.position.z;
          advance();
          assert.ok(
            a.character.root.position.z < z && movement.speed > 4,
            "Animation never stops physical sprint momentum",
          );
          const h = pos(a.character, "rightHand").sub(
            a.character.root.position,
          );
          const f = pos(a.character, "rightAnkle").sub(
            a.character.root.position,
          );
          assert.ok(
            h.distanceTo(hand) < 22 * dt + 0.04 &&
              f.distanceTo(foot) < 22 * dt + 0.04,
            `${action} at ${offset}s / ${rate}Hz step ${i} phase ${combat.attack.phase} hand ${h.distanceTo(hand)} foot ${f.distanceTo(foot)}`,
          );
          hand = h;
          foot = f;
          for (const side of sides) {
            const hip = pos(a.character, `${side}Hip`),
              knee = pos(a.character, `${side}Knee`),
              ankle = pos(a.character, `${side}Ankle`);
            assert.ok(
              knee.clone().sub(hip).angleTo(ankle.clone().sub(knee)) < 2.65,
              `${action} preserves knee limits at every sprint entry phase`,
            );
            assert.ok(
              new Box3().setFromObject(a.character.joints[`${side}Ankle`]).min
                .y >= -0.02,
            );
          }
        }
        a.character.dispose();
      }
    }
  }
});
