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
  sampleBicycleLeg,
  sampleLocalStrike,
  StrikePoseSampler,
  worldStrike,
} from "../src/combat/TechniqueGeometry.js";

const bicycle = createAdaptiveTechniques().find((t) => t.id === "bicycle-kick");
const end = bicycle.windup + bicycle.extension + bicycle.impact;
const position = (character, name) => character.joints[name].getWorldPosition(new Vector3());

function fighter(side, pitch = 0) {
  const character = new Stickman(),
    animator = new CharacterAnimator(character),
    presenter = new AcrobaticPresenter(character, animator),
    combat = new CombatController({
      techniques: [bicycle],
      selectTechnique: () => ({ id: bicycle.id, side }),
    });
  character.root.position.y = 4;
  character.root.rotation.y = 0.4;
  const rotation = {
    orientation: character.root.quaternion.clone().multiply(
      new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), pitch),
    ),
    lift: 0,
    phase: "idle",
    flipping: pitch !== 0,
    sequence: 1,
    elapsed: 0.2,
    lastKind: "backflip",
    angularVelocity: new Vector3(),
    up: new Vector3(0, 1, 0),
  };
  rotation.up.applyQuaternion(rotation.orientation);
  const jump = {
    airborne: true,
    ready: false,
    phase: "airborne",
    height: 4,
    verticalVelocity: 0,
    config: { height: 4, gravity: 18 },
    elapsed: 0.2,
    sequence: 1,
    timeToBoundary: 1,
  };
  assert.ok(combat.requestAttack({
    action: "kick", source: "manual", environment: "air",
    canAttack: true, height: 4, airTimeRemaining: 1,
  }));
  return { character, animator, presenter, combat, rotation, jump };
}

function render(f, dt, speed) {
  const root = f.character.root;
  root.position.z -= dt * speed;
  const before = root.position.clone(), orientation = root.quaternion.clone();
  f.combat.update(dt);
  f.presenter.begin(f.combat);
  f.animator.update(dt, { combat: f.combat, jump: f.jump, speed, sandbox: speed > 5.2 });
  f.presenter.apply(dt, f.rotation, f.combat);
  assert.ok(root.position.equals(before) && root.quaternion.equals(orientation));
}

test("v088 bicycle feet counter-pedal, chamber, extend and rechamber continuously", () => {
  for (const side of ["left", "right"]) {
    const t = { ...bicycle, side }, opposite = side === "left" ? "right" : "left";
    const primary = (time) => sampleBicycleLeg(new Vector3(), t, time, side);
    const support = (time) => sampleBicycleLeg(new Vector3(), t, time, opposite);
    assert.ok(primary(t.windup * 0.55).z < primary(t.windup).z - 0.2,
      "the lead pedal retracts into its chamber before the strike");
    assert.ok(support(t.windup * 0.45).z > support(t.windup).z + 0.5,
      "the other leg pedals from behind into a compact forward fold");
    assert.ok(primary(end).z < primary(t.windup).z - 0.4);
    assert.ok(support(end).z > support(t.windup).z + 0.5,
      "the counter-leg reverses as the striking leg extends");
    assert.ok(primary(end + t.recovery * 0.42).distanceTo(primary(t.windup)) < 1e-8);
    for (const time of [t.windup * 0.45, t.windup * 0.55, t.windup, end, end + t.recovery * 0.42])
      for (const s of [side, opposite])
        assert.ok(sampleBicycleLeg(new Vector3(), t, time - 1e-7, s).distanceTo(
          sampleBicycleLeg(new Vector3(), t, time + 1e-7, s),
        ) < 1e-5, `${s} keeps its pedal path continuous at ${time}`);
    for (const s of [side, opposite]) {
      const recovered = sampleBicycleLeg(new Vector3(), t, end + t.recovery, s);
      assert.ok(Math.abs(recovered.y - 0.1) < 1e-10);
      assert.ok(Math.abs(recovered.z - 0.03) < 1e-10);
    }
  }
});

test("v088 bicycle cancellation folds both live pedals smoothly during fast travel", () => {
  for (const speed of [0, 520])
    for (const cancelAt of [bicycle.windup * 0.8, bicycle.windup + bicycle.extension * 0.8]) {
      const f = fighter("right"), dt = 1 / 120;
      const localFeet = () => ["left", "right"].map((side) =>
        position(f.character, `${side}Ankle`).sub(f.character.root.position),
      );
      while (f.combat.attack.elapsed < cancelAt) render(f, dt, speed);
      let before = localFeet();
      f.combat.setBlocking(true);
      for (let n = 0; n < 24; n++) {
        render(f, dt, speed);
        const next = localFeet();
        for (let i = 0; i < 2; i++)
          assert.ok(next[i].distanceTo(before[i]) < 0.35,
            `${speed}/${cancelAt}: cancelling pedal ${i} moved ${next[i].distanceTo(before[i])}`);
        before = next;
      }
      assert.ok(f.combat.blocking && !f.combat.attack.active);
      f.character.dispose();
    }
});

test("v088 both bicycle ankles match shared geometry through body rotation and fast travel", () => {
  const sampler = new StrikePoseSampler();
  for (const side of ["left", "right"])
    for (const rate of [30, 60, 144])
      for (const speed of [0, 520])
        for (const pitch of [0, -0.9, Math.PI]) {
          const f = fighter(side, pitch), dt = 1 / rate;
          let samples = 0;
          for (let n = 0; n < Math.ceil((end + bicycle.recovery) * rate); n++) {
            render(f, dt, speed);
            const { attack: a, currentTechnique: t } = f.combat;
            for (const s of ["left", "right"]) {
              const hip = position(f.character, `${s}Hip`),
                knee = position(f.character, `${s}Knee`),
                ankle = position(f.character, `${s}Ankle`);
              assert.ok(Math.abs(hip.distanceTo(knee) - 0.44) < 1e-8);
              assert.ok(Math.abs(knee.distanceTo(ankle) - 0.43) < 1e-8);
              if (!a.active || a.elapsed < t.windup || a.elapsed > end) continue;
              const goal = s === side
                ? sampler.sample(new Vector3(), f.character.root.position, 0.4,
                  t, a.elapsed, a.context, f.rotation.orientation)
                : worldStrike(new Vector3(),
                  sampleBicycleLeg(new Vector3(), t, a.elapsed, s, a.context),
                  f.character.root.position, f.rotation.orientation);
              assert.ok(ankle.distanceTo(goal) < 1e-7,
                `${s}/${rate}Hz/${speed}/${pitch}: ankle/contact error ${ankle.distanceTo(goal)}`);
              assert.ok(goal.distanceTo(hip) <= 0.869 + 1e-8,
                "the shared target fits the rigid leg without stretching");
              samples++;
            }
          }
          assert.ok(samples > 0);
          f.character.dispose();
        }
});

test("v088 bicycle contact uses only the active primary foot, survives fast CCD and hits once", () => {
  for (const rate of [30, 60, 144])
    for (const speed of [0, 520]) {
      const t = bicycle, sampler = new StrikePoseSampler(),
        at = t.windup + t.extension * 0.7,
        rootAt = (time) => new Vector3(0, 4, -speed * time),
        target = {
          id: "contact", position: sampler.sample(new Vector3(), rootAt(at), 0, t, at),
          strikeHeight: 0, strikeRadius: 0.025,
        },
        detector = new StrikeHitDetector({ targets: [target] }),
        attack = { active: true, cancelled: false, sequence: 1, context: {} };
      for (let elapsed = 0; elapsed < end; elapsed += 1 / rate)
        detector.sweep(t, attack, elapsed, Math.min(end, elapsed + 1 / rate),
          rootAt(elapsed), rootAt(Math.min(end, elapsed + 1 / rate)), 0, 0);
      assert.equal(detector.count, 1, `${rate}Hz/${speed} captures the physical foot crossing once`);
      assert.ok(detector.lastContact.time >= t.windup);
      detector.sweep(t, attack, t.windup, end, rootAt(t.windup), rootAt(end), 0, 0);
      assert.equal(detector.count, 1, "the same strike cannot hit twice");
      const earlyPoint = sampleLocalStrike(new Vector3(), t, t.windup * 0.55);
      earlyPoint.y += 4;
      const early = new StrikeHitDetector({ targets: [{ ...target, position: earlyPoint }] });
      early.sweep(t, attack, 0, t.windup, rootAt(0), rootAt(0), 0, 0);
      assert.equal(early.count, 0, "a visible windup pedal is never an active hit");
      const rear = worldStrike(new Vector3(),
        sampleBicycleLeg(new Vector3(), t, end, "left"), rootAt(0), new Quaternion());
      const secondary = new StrikeHitDetector({ targets: [{ ...target, position: rear }] });
      secondary.sweep(t, attack, end - 0.01, end, rootAt(0), rootAt(0), 0, 0);
      assert.equal(secondary.count, 0, "the non-striking counter-pedal leg does not create a second strike");
    }
});
