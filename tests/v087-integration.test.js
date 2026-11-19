import test from "node:test";
import assert from "node:assert/strict";
import { Group, Quaternion, Vector3 } from "three";
import { Game } from "../src/core/Game.js";
import {
  ANIMATION_DEFAULTS,
  ANIMATION_SETTINGS_KEY,
  loadAnimationSettings,
  saveAnimationSettings,
  sanitizeAnimationSettings,
} from "../src/sandbox/AnimationSettings.js";
import {
  loadSpeedEffectSettings,
  saveSpeedEffectSettings,
} from "../src/sandbox/SpeedEffectsSettings.js";
import {
  loadMagnetismSettings,
  saveMagnetismSettings,
} from "../src/sandbox/AttackMagnetismSettings.js";
import { CombatPolishPanel } from "../src/ui/CombatPolishPanel.js";
import { SpeedEffects } from "../src/world/SpeedEffects.js";
import { CharacterController } from "../src/movement/CharacterController.js";
import { BodyRotation } from "../src/movement/BodyRotation.js";
import { ArenaBounds } from "../src/world/ArenaBounds.js";
import { CombatController } from "../src/combat/CombatController.js";
import { AttackScheduler } from "../src/combat/AttackScheduler.js";
import {
  ContextualLimbSelector,
  createAdaptiveTechniques,
} from "../src/combat/AdaptiveTechniques.js";
import { createCombatContext } from "../src/combat/CombatContext.js";

const storage = () => {
  const values = new Map([
    ["kinetic.physics.v1", "keep physics"],
    ["kinetic.camera-settings.v1", "keep camera"],
    ["kinetic.controls.v1", "keep layout"],
  ]);
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
};

test("v087 effects expose the frozen live settings used by the editor and production telemetry", () => {
  const effects = new SpeedEffects();
  try {
    assert.equal(effects.config, effects.settings);
    assert.ok(Object.isFrozen(effects.config));
    effects.configure({ dustSpeed: 25 });
    assert.equal(effects.config.dustSpeed, 25);
    assert.equal(effects.config.sonicSpeed, 40);
  } finally {
    effects.dispose();
  }
});

test("v087 presentation, effects and magnetism saves stay separate and reject malformed animation profiles", () => {
  const store = storage();
  assert.equal(saveAnimationSettings(store, { sprintAggression: 1.5 }), true);
  assert.equal(
    saveSpeedEffectSettings(store, { sonicSpeed: 100, dustDensity: 1.5 }),
    true,
  );
  assert.equal(
    saveMagnetismSettings(store, { enabled: true, maxApproach: 0.5 }),
    true,
  );
  assert.equal(loadAnimationSettings(store).sprintAggression, 1.5);
  assert.equal(loadSpeedEffectSettings(store).sonicSpeed, 100);
  assert.equal(loadMagnetismSettings(store).maxApproach, 0.5);
  assert.equal(store.getItem("kinetic.physics.v1"), "keep physics");
  assert.equal(store.getItem("kinetic.camera-settings.v1"), "keep camera");
  assert.equal(store.getItem("kinetic.controls.v1"), "keep layout");
  for (const value of [
    "broken JSON",
    '{"version":2,"values":{}}',
    '{"version":1,"values":null}',
    '{"version":1,"values":[]}',
  ]) {
    store.setItem(ANIMATION_SETTINGS_KEY, value);
    assert.equal(loadAnimationSettings(store), null);
  }
  assert.deepEqual(
    sanitizeAnimationSettings({ sprintAggression: Infinity }),
    ANIMATION_DEFAULTS,
  );
  assert.equal(
    sanitizeAnimationSettings({ sprintAggression: -5 }).sprintAggression,
    0,
  );
  assert.equal(
    sanitizeAnimationSettings({ sprintAggression: 100 }).sprintAggression,
    1.5,
  );
  assert.equal(
    loadAnimationSettings({
      getItem() {
        throw Error("blocked");
      },
    }),
    null,
  );
  assert.equal(saveAnimationSettings(null, ANIMATION_DEFAULTS), false);
});

test("v087 optional magnetism has exactly one strike-alignment owner and preserves the complete aim fallback", () => {
  const context = Object.freeze({
    source: "manual",
    environment: "ground",
    punchAim: { old: true },
    kickAim: { old: true },
  });
  const alignment = Object.freeze({
    axis: [0, 1, 0],
    angle: 0.2,
    strength: 0.7,
  });
  const root = new Group(),
    velocity = new Vector3(100, 0, -70);
  const game = Object.assign(Object.create(Game.prototype), {
    controller: { root, velocity, world: {} },
    battle: { mode: "combat", enemies: [] },
    input: {},
    followCamera: { yaw: 0.2 },
    bodyRotation: { orientation: new Quaternion() },
    combat: { attack: { sequence: 3 } },
  });
  let fallbackCalls = 0,
    beginCalls = 0;
  const fallback = { untouched: true };
  game.punchAim = {
    prepare() {
      fallbackCalls++;
      return fallback;
    },
  };
  game.freeflow = {
    begin(...args) {
      beginCalls++;
      assert.equal(args[3], "combat");
      assert.equal(args[5].accepted, true);
      assert.equal(args[5].sequence, 4);
      return null;
    },
  };
  assert.equal(
    game.prepareManualAttack(context, { action: "punch" }),
    fallback,
  );
  assert.equal(fallbackCalls, 1);
  assert.equal(beginCalls, 1);
  game.freeflow.begin = () => alignment;
  const punch = game.prepareManualAttack(context, { action: "punch" });
  assert.equal(punch.punchAim, alignment);
  assert.equal(punch.kickAim, null);
  const kick = game.prepareManualAttack(context, { action: "kick" });
  assert.equal(kick.kickAim, alignment);
  assert.equal(kick.punchAim, null);
  assert.equal(fallbackCalls, 1);
  assert.deepEqual(root.position.toArray(), [0, 0, 0]);
  assert.deepEqual(velocity.toArray(), [100, 0, -70]);
  assert.equal(context.punchAim.old, true);
});

test("v087 Game effects sample collision-resolved travel and real foot contacts without writing motion", () => {
  const root = new Group(),
    velocity = new Vector3(0, -2, 0);
  const feet = [
    { position: new Vector3(), contact: false },
    { position: new Vector3(), contact: false },
  ];
  const context = { position: root.position, velocity: new Vector3(), feet };
  const samples = [];
  const game = Object.assign(Object.create(Game.prototype), {
    controller: {
      speed: 520,
      jump: {
        canActOnGround: true,
        ready: false,
        floorHeight: 20,
        phase: "landing",
        landingSpeed: 25,
      },
    },
    cameraVelocity: velocity,
    speedEffectContext: context,
    effectFeet: feet,
    character: {
      root,
      joints: {
        leftAnkle: {
          getWorldPosition(out) {
            return out.set(-0.1, 20.1, 0);
          },
        },
        rightAnkle: {
          getWorldPosition(out) {
            return out.set(0.1, 20.9, 0);
          },
        },
      },
    },
    animator: { feet: { left: { planted: true }, right: { planted: false } } },
    speedEffects: {
      update(dt, value) {
        samples.push({
          dt,
          contact: value.feet.map((f) => f.contact),
          floor: value.floorHeight,
          velocity: value.velocity.toArray(),
          landingSpeed: value.landingSpeed,
        });
      },
    },
  });
  game.updateSpeedEffects(1 / 60);
  assert.deepEqual(
    samples[0].velocity,
    [0, -2, 0],
    "A blocked high joystick speed does not manufacture dust velocity",
  );
  assert.deepEqual(samples[0].contact, [true, false]);
  assert.equal(samples[0].floor, 20);
  assert.equal(samples[0].landingSpeed, 25);
  game.controller.jump = {
    canActOnGround: false,
    ready: false,
    phase: "airborne",
    floorHeight: 20,
  };
  game.updateSpeedEffects(1 / 60);
  assert.deepEqual(samples[1].contact, [false, false]);
  assert.equal(samples[1].landingSpeed, 0);
  assert.deepEqual(velocity.toArray(), [0, -2, 0]);
  assert.deepEqual(root.position.toArray(), [0, 0, 0]);
});

test("v087 normal play loads visual aggression without constructing developer controls", () => {
  const before = globalThis.location;
  globalThis.location = { search: "" };
  try {
    const animator = { locomotion: { aggression: 1 } };
    const panel = new CombatPolishPanel({
      animator,
      animation: { sprintAggression: 1.35 },
    });
    assert.equal(animator.locomotion.aggression, 1.35);
    assert.equal(panel.animation.sprintAggression, 1.35);
  } finally {
    if (before === undefined) delete globalThis.location;
    else globalThis.location = before;
  }
});

test("v087 Game timestamps held combo entries at their exact recovery boundary inside fixed steps", () => {
  const root = new Group(),
    controller = new CharacterController(root, new ArenaBounds(1000));
  const selector = new ContextualLimbSelector(),
    entries = [];
  const combat = new CombatController({
    techniques: createAdaptiveTechniques(),
    selectTechnique(context, registry) {
      const selected = selector.choose(context, registry),
        t = registry.get(selected?.id);
      if (t)
        entries.push({
          clock: context.clock,
          duration: t.windup + t.extension + t.impact + t.recovery,
        });
      return selected;
    },
  });
  const scheduler = new AttackScheduler(combat);
  const game = Object.assign(Object.create(Game.prototype), {
    character: { root },
    controller,
    bodyRotation: new BodyRotation(),
    lastRotationJumpSequence: 0,
    input: { move: { x: 0, y: 0 }, movementMagnitude: 0, blocking: false },
    followCamera: { yaw: 0 },
    combat,
    attackScheduler: scheduler,
    combatContext: createCombatContext(),
    simulationPrevious: new Vector3(),
    combatStartRoot: new Vector3(),
    combatEndRoot: new Vector3(),
    bodyStart: new Quaternion(),
    bodyEnd: new Quaternion(),
    contactFeedbackRemaining: 0,
    acrobaticPresenter: { fillLimbContext() {} },
    hitDetector: { sweep() {} },
  });
  scheduler.press("punch");
  scheduler.setHeld("punch", true);
  for (let n = 0; n < 180; n++) game.simulateMovement(1 / 60);
  assert.ok(entries.length >= 6);
  for (let n = 1; n < entries.length; n++)
    assert.ok(
      Math.abs(
        entries[n].clock - entries[n - 1].clock - entries[n - 1].duration,
      ) < 1e-9,
      "A held strike begins after full recovery, with the same clock shown in its combo record",
    );
  assert.deepEqual(root.position.toArray(), [0, 0, 0]);
});
