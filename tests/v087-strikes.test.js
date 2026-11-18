import test from "node:test";
import assert from "node:assert/strict";
import { Quaternion, Vector3 } from "three";
import { Stickman } from "../src/character/Stickman.js";
import { CharacterAnimator } from "../src/character/CharacterAnimator.js";
import { AcrobaticPresenter } from "../src/character/AcrobaticPresenter.js";
import { CombatController } from "../src/combat/CombatController.js";
import { createAdaptiveTechniques } from "../src/combat/AdaptiveTechniques.js";
import { StrikeHitDetector } from "../src/combat/StrikeHitDetector.js";
import {
  sampleKickPose,
  sampleLocalStrike,
  StrikePoseSampler,
} from "../src/combat/TechniqueGeometry.js";

const techniques = createAdaptiveTechniques();
const kicks = techniques.filter((t) => t.action === "kick");
const position = (rig, name) =>
  rig.joints[name].getWorldPosition(new Vector3());
const close = (a, b, tolerance = 1e-8) =>
  assert.ok(Math.abs(a - b) < tolerance, `${a} ≈ ${b}`);

function fighter(technique, side, pitch = 0) {
  const character = new Stickman(),
    animator = new CharacterAnimator(character),
    presenter = new AcrobaticPresenter(character, animator),
    combat = new CombatController({
      techniques: [technique],
      selectTechnique: () => ({ id: technique.id, side }),
    }),
    airborne = technique.environments.includes("air");
  character.root.rotation.y = 0.4;
  if (airborne) character.root.position.y = 4;
  const rotation = {
    orientation: character.root.quaternion
      .clone()
      .multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), pitch)),
    lift: 0,
    phase: "idle",
    angularVelocity: new Vector3(),
    up: new Vector3(0, 1, 0),
  };
  const jump = airborne
    ? {
        airborne: true,
        ready: false,
        phase: "airborne",
        height: 4,
        verticalVelocity: 0,
        config: { height: 4, gravity: 18 },
        elapsed: 0.2,
        sequence: 1,
        timeToBoundary: 1,
      }
    : undefined;
  assert.equal(
    combat.requestAttack({
      action: technique.action,
      source: "manual",
      canAttack: true,
      environment: airborne ? "air" : "ground",
      height: airborne ? 4 : 0,
      airTimeRemaining: 1,
      ...(technique.gesture ? { gesture: technique.gesture } : {}),
    }),
    true,
  );
  return { character, animator, presenter, combat, rotation, jump };
}

function render(f, dt, speed) {
  f.character.root.position.addScaledVector(
    new Vector3(-Math.sin(0.4), 0, -Math.cos(0.4)),
    speed * dt,
  );
  const root = f.character.root,
    p = root.position.clone(),
    q = root.quaternion.clone();
  f.combat.update(dt);
  f.presenter.begin(f.combat);
  f.animator.update(dt, {
    combat: f.combat,
    jump: f.jump,
    speed,
    sandbox: speed > 5.2,
  });
  f.presenter.apply(dt, f.rotation, f.combat);
  assert.ok(
    root.position.equals(p) && root.quaternion.equals(q),
    "strike animation preserves resolved travel and facing",
  );
}

test("v087 rendered kick ankles and rigid leg lengths match contact geometry at 1x/100x and 30/60/120Hz", () => {
  const sampler = new StrikePoseSampler();
  for (const technique of kicks)
    for (const side of ["left", "right"])
      for (const rate of [30, 60, 120])
        for (const speed of [0, 5.2, 520])
          for (const pitch of technique.id === "flying-kick"
            ? [0, -0.9, 0.9, Math.PI]
            : [0]) {
            const f = fighter(technique, side, pitch),
              dt = 1 / rate;
            let measured = 0;
            for (
              let n = 0;
              n <
              Math.ceil(
                (technique.windup +
                  technique.extension +
                  technique.impact +
                  technique.recovery) *
                  rate,
              );
              n++
            ) {
              render(f, dt, speed);
              const a = f.combat.attack,
                t = f.combat.currentTechnique;
              for (const s of ["left", "right"]) {
                const hip = position(f.character, `${s}Hip`),
                  knee = position(f.character, `${s}Knee`),
                  ankle = position(f.character, `${s}Ankle`);
                close(hip.distanceTo(knee), 0.44);
                close(knee.distanceTo(ankle), 0.43);
              }
              if (
                !a.active ||
                a.elapsed < t.windup ||
                a.elapsed > t.windup + t.extension + t.impact
              )
                continue;
              const actual = position(f.character, `${side}Ankle`),
                goal = sampler.sample(
                  new Vector3(),
                  f.character.root.position,
                  0.4,
                  t,
                  a.elapsed,
                  a.context,
                  f.rotation.orientation,
                );
              assert.ok(
                actual.distanceTo(goal) < 1e-7,
                `${t.id}/${side}/${rate}Hz/${speed}/${pitch}: ${actual.distanceTo(goal)} ankle/contact error`,
              );
              measured++;
            }
            assert.ok(measured > 0);
            f.character.dispose();
          }
});

test("v087 kicks chamber, extend, rechamber and recover continuously with distinct arcs", () => {
  const ends = new Map();
  for (const t of kicks) {
    const end = t.windup + t.extension + t.impact,
      chamber = sampleLocalStrike(new Vector3(), t, t.windup),
      bodyChamber = chamber
        .clone()
        .applyAxisAngle(
          new Vector3(0, 1, 0),
          -(t.side === "left" ? -1 : 1) *
            Math.PI *
            2 *
            sampleKickPose({}, t, t.windup).turn,
        ),
      extended = sampleLocalStrike(new Vector3(), t, end),
      rechamber = sampleLocalStrike(new Vector3(), t, end + t.recovery * 0.42),
      recovered = sampleLocalStrike(new Vector3(), t, end + t.recovery);
    assert.ok(chamber.y > recovered.y + 0.3, `${t.id} lifts before extending`);
    assert.ok(
      extended.distanceTo(chamber) > 0.3,
      `${t.id} has visible extension`,
    );
    assert.ok(
      rechamber.distanceTo(bodyChamber) < 1e-8,
      `${t.id} folds before lowering`,
    );
    close(recovered.y, 0.1);
    close(recovered.z, 0.03);
    for (const boundary of [t.windup, end, end + t.recovery * 0.42]) {
      const before = sampleLocalStrike(new Vector3(), t, boundary - 1e-7),
        after = sampleLocalStrike(new Vector3(), t, boundary + 1e-7),
        poseBefore = sampleKickPose({}, t, boundary - 1e-7),
        poseAfter = sampleKickPose({}, t, boundary + 1e-7);
      assert.ok(
        before.distanceTo(after) < 1e-5,
        `${t.id} keeps its foot path continuous`,
      );
      assert.ok(
        Math.abs(poseBefore.chamber - poseAfter.chamber) < 1e-5,
        `${t.id} keeps torso coil continuous`,
      );
    }
    ends.set(t.id, extended);
  }
  assert.ok(ends.get("front-kick").distanceTo(ends.get("side-kick")) > 0.15);
  assert.ok(
    ends.get("roundhouse-kick").distanceTo(ends.get("spinning-kick")) > 0.1,
  );
  assert.ok(
    ends.get("low-sweep").y < 0.4 && ends.get("descending-sweep").y < 0.3,
  );
  assert.ok(ends.get("flying-kick").y < ends.get("front-kick").y - 0.3);
});

test("v087 every rendered kick makes an actual active contact once and rejects separated targets", () => {
  for (const technique of kicks) {
    const f = fighter(technique, "right"),
      dt = 1 / 120;
    let contactAt =
      technique.windup + technique.extension + technique.impact * 0.6;
    if (["spinning-kick", "whip-kick"].includes(technique.id)) {
      let rear = -Infinity;
      for (
        let elapsed = technique.windup;
        elapsed < technique.windup + technique.extension + technique.impact;
        elapsed += 0.001
      ) {
        const point = sampleLocalStrike(new Vector3(), technique, elapsed);
        if (point.z > rear) {
          rear = point.z;
          contactAt = elapsed;
        }
      }
      assert.ok(rear > 0.1, "the complete spin has a real rearward foot sweep");
    }
    while (f.combat.attack.elapsed < contactAt) render(f, dt, 0);
    const a = f.combat.attack,
      t = f.combat.currentTechnique,
      actual = position(f.character, "rightAnkle"),
      target = {
        id: "physical",
        position: actual.clone(),
        strikeHeight: 0,
        strikeRadius: 0.015,
      },
      detector = new StrikeHitDetector({ targets: [target] }),
      root = f.character.root.position;
    detector.sweep(
      t,
      a,
      a.elapsed - 1e-5,
      a.elapsed,
      root,
      root,
      0.4,
      0.4,
      f.rotation.orientation,
      f.rotation.orientation,
    );
    assert.equal(detector.count, 1, `${t.id} contacts the rendered ankle`);
    assert.ok(
      new Vector3().copy(detector.lastContact.point).distanceTo(actual) <
        t.hitRadius + target.strikeRadius,
    );
    detector.sweep(
      t,
      a,
      a.elapsed - 1e-5,
      a.elapsed,
      root,
      root,
      0.4,
      0.4,
      f.rotation.orientation,
      f.rotation.orientation,
    );
    assert.equal(detector.count, 1, `${t.id} cannot hit twice`);
    target.position.add(new Vector3(4, 4, 4));
    const miss = new StrikeHitDetector({ targets: [target] });
    miss.sweep(
      t,
      a,
      a.elapsed - 1e-5,
      a.elapsed,
      root,
      root,
      0.4,
      0.4,
      f.rotation.orientation,
      f.rotation.orientation,
    );
    assert.equal(miss.count, 0);
    f.character.dispose();
  }
});

test("v087 cross and hook coordinate hip, shoulder and support pivot for either striking arm", () => {
  for (const side of ["left", "right"]) {
    const samples = {};
    for (const id of ["basic-punch", "cross-punch", "hook-punch"]) {
      const t = techniques.find((t) => t.id === id),
        f = fighter(t, side);
      while (f.combat.attack.elapsed < t.windup + t.extension)
        render(f, 1 / 120, 0);
      const root = f.character.root,
        support = f.animator.feet[f.animator.groundBalance.side],
        footYaw = support.yaw
          .clone()
          .premultiply(root.quaternion.clone().invert());
      samples[id] = {
        hip: Math.abs(f.character.joints.hips.rotation.y),
        shoulder: Math.abs(f.character.joints.spine.rotation.y),
        pivot: footYaw.angleTo(new Quaternion()),
      };
      const goal = new StrikePoseSampler().sample(
          new Vector3(),
          root.position,
          0.4,
          f.combat.currentTechnique,
          f.combat.attack.elapsed,
          f.combat.attack.context,
          f.rotation.orientation,
        ),
        hand = position(f.character, `${side}Hand`);
      assert.ok(
        hand.distanceTo(goal) < 0.01,
        `${id}/${side} fist follows its physical path`,
      );
      assert.ok(
        position(f.character, `${support.side}Ankle`).y < 0.101,
        `${id}/${side} retains its support contact`,
      );
      f.character.dispose();
    }
    assert.ok(samples["hook-punch"].hip > samples["basic-punch"].hip);
    assert.ok(samples["hook-punch"].shoulder > samples["basic-punch"].shoulder);
    assert.ok(
      samples["cross-punch"].pivot > 0.05 &&
        samples["hook-punch"].pivot > samples["cross-punch"].pivot,
      JSON.stringify(samples),
    );
  }
});

test("v087 kick cancellation carries the rendered pose through 100x travel without a stale world anchor", () => {
  for (const speed of [0, 5.2, 520])
    for (const id of [
      "front-kick",
      "flying-kick",
      "spinning-kick",
      "whip-kick",
    ]) {
      const t = techniques.find((t) => t.id === id),
        f = fighter(t, "right"),
        dt = 1 / 120;
      const localFoot = () =>
        position(f.character, "rightAnkle")
          .sub(f.character.root.position)
          .applyQuaternion(f.character.root.quaternion.clone().invert());
      const cancelAt = ["spinning-kick", "whip-kick"].includes(id)
        ? t.windup * 0.65
        : t.windup + t.extension * 0.8;
      while (f.combat.attack.elapsed < cancelAt) render(f, dt, speed);
      let previous = localFoot();
      f.combat.cancelAttack("blocked");
      for (let n = 0; n < 24; n++) {
        render(f, dt, speed);
        const next = localFoot();
        assert.ok(
          next.distanceTo(previous) < 0.35,
          `${id}/${speed}: cancellation ankle step ${next.distanceTo(previous)}`,
        );
        previous = next;
      }
      assert.equal(f.combat.attack.active, false);
      f.character.dispose();
    }
});

test("v087 spinning kicks turn the complete body and support foot while keeping windup and active targets reachable", () => {
  for (const id of ["spinning-kick", "whip-kick"])
    for (const side of ["left", "right"])
      for (const rate of [30, 60, 120])
        for (const speed of [0, 5.2, 520]) {
          const t = techniques.find((t) => t.id === id),
            f = fighter(t, side),
            dt = 1 / rate,
            sampler = new StrikePoseSampler(),
            sign = side === "left" ? -1 : 1;
          let previousYaw = 0,
            accumulatedYaw = 0,
            peakYaw = 0,
            supportTurn = 0,
            previousSupport = 0;
          for (
            let n = 0;
            n <
            Math.ceil(
              (t.windup + t.extension + t.impact + t.recovery + 0.15) * rate,
            );
            n++
          ) {
            render(f, dt, speed);
            const root = f.character.root,
              body = f.character.joints.hips
                .getWorldQuaternion(new Quaternion())
                .premultiply(root.quaternion.clone().invert()),
              forward = new Vector3(0, 0, -1).applyQuaternion(body),
              yaw = Math.atan2(-forward.x, -forward.z),
              support = f.animator.feet[f.animator.groundBalance.side],
              supportForward = new Vector3(0, 0, -1)
                .applyQuaternion(support.yaw)
                .applyQuaternion(root.quaternion.clone().invert()),
              supportYaw = Math.atan2(-supportForward.x, -supportForward.z);
            accumulatedYaw += Math.atan2(
              Math.sin(yaw - previousYaw),
              Math.cos(yaw - previousYaw),
            );
            supportTurn += Math.atan2(
              Math.sin(supportYaw - previousSupport),
              Math.cos(supportYaw - previousSupport),
            );
            peakYaw = Math.max(peakYaw, sign * accumulatedYaw);
            previousYaw = yaw;
            previousSupport = supportYaw;
            const a = f.combat.attack;
            if (a.active && a.phase !== "recovery") {
              const goal = sampler.sample(
                  new Vector3(),
                  root.position,
                  0.4,
                  f.combat.currentTechnique,
                  a.elapsed,
                  a.context,
                  f.rotation.orientation,
                ),
                hip = position(f.character, `${side}Hip`);
              assert.ok(
                goal.distanceTo(hip) <= 0.869 + 1e-8,
                `${id}/${side}/${rate}Hz: windup or extension exceeds leg reach`,
              );
            }
          }
          assert.ok(
            peakYaw > Math.PI * 2,
            `${id}/${side}/${rate}Hz: body turn ${peakYaw}`,
          );
          if (!speed)
            assert.ok(
              sign * supportTurn > Math.PI * 1.8,
              `${id}/${side}/${rate}Hz: support pivot ${supportTurn}`,
            );
          assert.ok(
            sign * accumulatedYaw > Math.PI * 1.8,
            "recovery retains the completed turn without reversing it",
          );
          f.character.dispose();
        }
});
