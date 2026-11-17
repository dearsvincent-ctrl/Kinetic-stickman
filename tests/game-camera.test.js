import test from "node:test";
import assert from "node:assert/strict";
import { Group, PerspectiveCamera, Quaternion, Vector3 } from "three";
import { Game } from "../src/core/Game.js";
import { CharacterController } from "../src/movement/CharacterController.js";
import { BodyRotation } from "../src/movement/BodyRotation.js";
import { ArenaBounds } from "../src/world/ArenaBounds.js";
import { BattleWorld } from "../src/combat/BattleWorld.js";
import { CombatController } from "../src/combat/CombatController.js";
import { AttackScheduler } from "../src/combat/AttackScheduler.js";
import { StrikeHitDetector } from "../src/combat/StrikeHitDetector.js";
import { createCombatContext } from "../src/combat/CombatContext.js";
import { FollowCamera } from "../src/camera/FollowCamera.js";
import {
  CameraPreferences,
  CAMERA_SETTINGS_KEY,
} from "../src/sandbox/CameraSettings.js";
import { sandboxMovementConfig } from "../src/sandbox/PhysicsSandbox.js";

const STEP = 1 / 60;
const near = (actual, expected, epsilon = 1e-8) =>
  assert.ok(Math.abs(actual - expected) < epsilon, `${actual} ≈ ${expected}`);
const nearVector = (actual, expected) => {
  near(actual.x, expected.x);
  near(actual.y, expected.y);
  near(actual.z, expected.z);
};
const store = () => {
  const data = new Map();
  return {
    data,
    storage: {
      getItem: (key) => data.get(key) ?? null,
      setItem: (key, value) => data.set(key, value),
    },
  };
};

function fixture({
  halfSize = 1000,
  preferences = new CameraPreferences(),
} = {}) {
  const root = new Group();
  const world = new ArenaBounds(halfSize);
  const controller = new CharacterController(root, world);
  const battle = new BattleWorld({
    playerPosition: root.position,
    world,
    targets: [],
    enabled: false,
  });
  const combat = new CombatController();
  const camera = new PerspectiveCamera(52, 1, 0.1, 3000);
  const followCamera = new FollowCamera(camera, root.position);
  followCamera.configure(preferences.get("combat"));
  const cameraVelocity = new Vector3();
  const panelModes = [];
  return Object.assign(Object.create(Game.prototype), {
    character: { root },
    controller,
    battle,
    combat,
    attackScheduler: new AttackScheduler(combat),
    hitDetector: new StrikeHitDetector(),
    combatContext: createCombatContext(),
    contactFeedbackRemaining: 0,
    simulationPrevious: new Vector3(),
    combatStartRoot: new Vector3(),
    combatEndRoot: new Vector3(),
    recoveryPrevious: new Vector3(),
    bodyStart: new Quaternion(),
    bodyEnd: new Quaternion(),
    bodyRotation: new BodyRotation(),
    lastRotationJumpSequence: 0,
    momentumRecovery: { reset() {}, update() {} },
    streaks: { reset() {} },
    animator: {
      initialized: true,
      previousPosition: new Vector3(),
      style: { locomotion: { sprintStart: 4 } },
    },
    camera,
    followCamera,
    cameraPreferences: preferences,
    cameraVelocity,
    cameraContext: {
      velocity: cameraVelocity,
      recentTargetId: null,
      recentEngagementRemaining: 0,
    },
    cameraSettingsPanel: { setGameplayMode: (mode) => panelModes.push(mode) },
    panelModes,
    punchAim: { targets: battle.enemies, config: { strength: 0 } },
    battleHud: { update() {} },
    controlsOpen: false,
    helpOpen: false,
    defeated: false,
    input: {
      move: { x: 0, y: 0 },
      movementMagnitude: 0,
      blocking: false,
      cameraPointer: null,
      joystickPointer: null,
      consumeLookDelta: () => ({ x: 0, y: 0 }),
      reset() {
        this.move.x = this.move.y = this.movementMagnitude = 0;
        this.cameraPointer = this.joystickPointer = null;
      },
      setEnabled(value) {
        this.enabled = value;
      },
    },
  });
}

function orbit(game, yaw, pitch) {
  const follow = game.followCamera;
  game.input.cameraPointer = 42;
  follow.update(
    1,
    game.character.root.position,
    {
      x: -(yaw - follow.targetYaw) / 0.0045,
      y: (pitch - follow.targetPitch) / 0.0035,
    },
    game.refreshCameraContext(),
  );
  game.input.cameraPointer = null;
}

test("Game samples collision-resolved travel after both locomotion and battle knockback", () => {
  const game = fixture({ halfSize: 10 });
  const root = game.character.root;
  root.position.x = 9.63;
  game.input.move.x = game.input.movementMagnitude = 1;
  game.controller.velocity.x = 5;
  game.battle.player.impulse.set(0, 0, 4);
  const before = root.position.clone();
  const velocityReference = game.cameraVelocity;
  const contextReference = game.cameraContext;

  game.simulateMovement(STEP);

  near(root.position.x, 9.64);
  assert.ok(root.position.z > 0, "Battle knockback contributes actual travel");
  const resolved = root.position.clone().sub(before).divideScalar(STEP);
  nearVector(game.cameraVelocity, resolved);
  assert.equal(
    game.controller.velocity.x,
    0,
    "The wall cancels controller intent",
  );
  assert.equal(
    game.controller.velocity.z,
    0,
    "Knockback remains independent of locomotion",
  );
  assert.ok(game.cameraVelocity.x > 0 && game.cameraVelocity.x < 1);
  assert.ok(game.cameraVelocity.z > 3);
  assert.equal(game.cameraVelocity, velocityReference);
  assert.equal(game.cameraContext, contextReference);
  assert.equal(game.cameraContext.velocity, velocityReference);

  game.battle.player.impulse.set(0, 0, 0);
  game.simulateMovement(STEP);
  nearVector(game.cameraVelocity, new Vector3());
});

test("Game camera motion includes physical jump elevation without inheriting actor flips", () => {
  const game = fixture();
  game.controller.requestJump();
  let verticalTravel = 0;
  for (let i = 0; i < 12; i++) {
    const before = game.character.root.position.clone();
    game.simulateMovement(STEP);
    const resolved = game.character.root.position
      .clone()
      .sub(before)
      .divideScalar(STEP);
    nearVector(game.cameraVelocity, resolved);
    verticalTravel = Math.max(verticalTravel, game.cameraVelocity.y);
  }
  assert.ok(verticalTravel > 1);
  assert.equal(game.refreshCameraContext().airborne, true);
  assert.equal(
    game.controller.velocity.y,
    0,
    "Jump elevation is separate from horizontal velocity",
  );

  game.simulationPrevious.copy(game.character.root.position);
  game.character.root.quaternion.setFromAxisAngle(
    new Vector3(1, 0, 0),
    Math.PI,
  );
  game.bodyRotation.orientation.copy(game.character.root.quaternion);
  game.updateCameraMotion(STEP);
  nearVector(game.cameraVelocity, new Vector3());
  game.followCamera.update(
    STEP,
    game.character.root.position,
    { x: 0, y: 0 },
    game.refreshCameraContext(),
  );
  assert.deepEqual(game.camera.up.toArray(), [0, 1, 0]);
  near(new Vector3().setFromMatrixColumn(game.camera.matrixWorld, 0).y, 0);
  assert.ok(game.camera.quaternion.toArray().every(Number.isFinite));
});

test("camera input context recognizes a stationary held pointer and reuses live world references", () => {
  const game = fixture();
  const context = game.cameraContext;
  game.input.joystickPointer = 7;
  game.input.move.x = game.input.movementMagnitude = 1;
  assert.equal(game.refreshCameraContext(), context);
  assert.equal(
    context.manualActive,
    false,
    "Joystick travel does not claim the camera",
  );

  game.input.cameraPointer = 0;
  assert.equal(game.refreshCameraContext(), context);
  assert.equal(
    context.manualActive,
    true,
    "Pointer ID zero is a held camera gesture",
  );
  game.input.move.x = game.input.movementMagnitude = 0;
  assert.deepEqual(game.input.consumeLookDelta(), { x: 0, y: 0 });
  assert.equal(game.refreshCameraContext().manualActive, true);

  game.input.cameraPointer = null;
  game.controller.jump.phase = "airborne";
  game.controller.parkour = { mode: "wall-run" };
  game.refreshCameraContext();
  assert.equal(context.manualActive, false);
  assert.equal(context.airborne, true);
  assert.equal(context.parkour, "wall-run");
  assert.equal(context.gameplayMode, "combat");
  assert.equal(context.velocity, game.cameraVelocity);
  assert.equal(context.enemies, game.battle.enemies);
  assert.equal(context.world, game.controller.world);
  assert.equal(context.cameraPosition, game.camera.position);
});

test("render frames forward refreshed camera context even when no simulation step is due", () => {
  const game = fixture();
  const previousDocument = globalThis.document;
  const previousRaf = globalThis.requestAnimationFrame;
  const calls = [];
  globalThis.document = { hidden: false };
  globalThis.requestAnimationFrame = () => 1;
  Object.assign(game, {
    frame() {},
    lastTime: 0,
    accumulator: 0,
    contextLost: false,
    renderer: { render() {} },
    scene: {},
    arena: { updateFocus() {} },
    enemyViews: { update() {} },
    dummy: { setTargeted() {} },
    punchAimDebug: { update() {} },
    hud: { update() {} },
  });
  game.followCamera.update = (...args) => calls.push(args);
  try {
    game.input.cameraPointer = 12;
    Game.prototype.frame.call(game, 1);
    assert.equal(calls.length, 1);
    assert.equal(calls[0][3], game.cameraContext);
    assert.equal(calls[0][3].manualActive, true);
    game.input.cameraPointer = null;
    Game.prototype.frame.call(game, 2);
    assert.equal(calls.length, 2);
    assert.equal(calls[1][3], game.cameraContext);
    assert.equal(calls[1][3].manualActive, false);
    near(game.accumulator, 0.002);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
    if (previousRaf === undefined) delete globalThis.requestAnimationFrame;
    else globalThis.requestAnimationFrame = previousRaf;
  }
});

test("saved Combat and Tag camera profiles load and switch without changing player physics or AI settings", () => {
  const { data, storage } = store();
  data.set("kinetic.physics.v1", "physics-kept");
  data.set("kinetic.enemy-settings.v1", "enemies-kept");
  data.set("kinetic.controls.v1", "controls-kept");
  const saved = new CameraPreferences(storage);
  saved.update("combat", { mode: "assisted", baseFov: 66, sensitivity: 1.7 });
  saved.update("tag", {
    mode: "dynamic",
    baseFov: 76,
    dynamicFov: true,
    maxFov: 112,
  });
  const loaded = new CameraPreferences(storage);
  const game = fixture({ preferences: loaded });
  game.controller.applyMovementConfig(
    sandboxMovementConfig({ movement: 20, jumpHeight: 5 }),
  );
  game.controller.velocity.set(3, 0, -4);
  game.controller.jump.phase = "airborne";
  game.controller.jump.height = game.character.root.position.y = 5;
  game.controller.jump.verticalVelocity = 4;
  game.controller.jump.jumpCount = 1;
  orbit(game, 0.73, 0.42);
  const config = game.controller.config;
  const position = game.character.root.position.clone();
  const velocity = game.controller.velocity.clone();
  const aiSettings = [
    game.battle.enemySettings,
    game.battle.tagSettings,
    game.battle.strength,
    game.battle.enemyProfiles,
  ];
  const preferences = loaded.values;
  const savedOrbit = [
    game.followCamera.yaw,
    game.followCamera.targetYaw,
    game.followCamera.pitch,
    game.followCamera.targetPitch,
  ];

  assert.deepEqual(game.followCamera.settings, loaded.get("combat"));
  game.setMode("tag");
  assert.deepEqual(game.followCamera.settings, loaded.get("tag"));
  assert.equal(game.refreshCameraContext().gameplayMode, "tag");
  game.setMode("combat");
  assert.deepEqual(game.followCamera.settings, loaded.get("combat"));
  assert.deepEqual(game.panelModes, ["tag", "combat"]);
  assert.equal(game.controller.config, config);
  assert.deepEqual(game.character.root.position, position);
  assert.deepEqual(game.controller.velocity, velocity);
  assert.equal(game.controller.jump.phase, "airborne");
  assert.equal(game.controller.jump.height, 5);
  assert.equal(game.controller.jump.verticalVelocity, 4);
  assert.equal(game.controller.jump.jumpCount, 1);
  assert.deepEqual(
    [
      game.followCamera.yaw,
      game.followCamera.targetYaw,
      game.followCamera.pitch,
      game.followCamera.targetPitch,
    ],
    savedOrbit,
  );
  assert.deepEqual(
    [
      game.battle.enemySettings,
      game.battle.tagSettings,
      game.battle.strength,
      game.battle.enemyProfiles,
    ],
    aiSettings,
  );
  assert.equal(loaded.values, preferences);
  assert.deepEqual(new CameraPreferences(storage).values, preferences);
  assert.equal(data.get("kinetic.physics.v1"), "physics-kept");
  assert.equal(data.get("kinetic.enemy-settings.v1"), "enemies-kept");
  assert.equal(data.get("kinetic.controls.v1"), "controls-kept");
  assert.ok(data.has(CAMERA_SETTINGS_KEY));
});

test("respawn clears camera travel and engagement history while preserving saved tuning and manual orbit", () => {
  const game = fixture();
  game.cameraPreferences.update("combat", {
    mode: "dynamic",
    baseFov: 68,
    dynamicFov: true,
  });
  game.followCamera.configure(game.cameraPreferences.get("combat"));
  game.controller.applyMovementConfig(
    sandboxMovementConfig({ movement: 100, jumpHeight: 20 }),
  );
  game.character.root.position.set(400, 20, 300);
  orbit(game, 0.7, 0.4);
  game.cameraVelocity.set(500, 80, -400);
  game.cameraContext.recentTargetId = "old-life-target";
  game.cameraContext.recentEngagementRemaining = 2;
  const config = game.controller.config;
  const preferences = game.cameraPreferences.values;
  const savedOrbit = [
    game.followCamera.yaw,
    game.followCamera.targetYaw,
    game.followCamera.pitch,
    game.followCamera.targetPitch,
  ];

  game.respawn();

  nearVector(game.cameraVelocity, new Vector3());
  assert.equal(game.cameraContext.velocity, game.cameraVelocity);
  assert.equal(game.cameraContext.recentTargetId, null);
  assert.equal(game.cameraContext.recentEngagementRemaining, 0);
  nearVector(game.followCamera.target, new Vector3(0, 1.02, 0));
  assert.deepEqual(
    [
      game.followCamera.yaw,
      game.followCamera.targetYaw,
      game.followCamera.pitch,
      game.followCamera.targetPitch,
    ],
    savedOrbit,
  );
  assert.equal(game.cameraPreferences.values, preferences);
  assert.deepEqual(game.followCamera.settings, preferences.combat);
  assert.equal(game.controller.config, config);
  game.simulateMovement(STEP);
  game.followCamera.update(
    STEP,
    game.character.root.position,
    { x: 0, y: 0 },
    game.refreshCameraContext(),
  );
  nearVector(game.cameraVelocity, new Vector3());
  assert.ok(game.camera.position.distanceTo(game.character.root.position) < 10);
  assert.ok(Number.isFinite(game.camera.fov));
});

test("camera presentation caps extreme samples, expires engagement and never modifies physical state", () => {
  const game = fixture();
  game.character.root.position.set(1e9, 2e9, -3e9);
  game.controller.velocity.set(500, 0, -400);
  game.cameraContext.recentTargetId = "enemy-1";
  game.cameraContext.recentEngagementRemaining = 0.03;
  const position = game.character.root.position.clone();
  const velocity = game.controller.velocity.clone();
  game.updateCameraMotion(0.01);
  near(game.cameraVelocity.length(), 100000, 1e-6);
  assert.equal(game.cameraContext.recentTargetId, "enemy-1");
  near(game.cameraContext.recentEngagementRemaining, 0.02);
  game.updateCameraMotion(0.02);
  assert.equal(game.cameraContext.recentTargetId, null);
  assert.equal(game.cameraContext.recentEngagementRemaining, 0);
  assert.deepEqual(game.character.root.position, position);
  assert.deepEqual(game.controller.velocity, velocity);
  for (const dt of [0, -1, NaN, Infinity]) {
    game.updateCameraMotion(dt);
    assert.ok(game.cameraVelocity.toArray().every(Number.isFinite));
  }
  game.character.root.position.x = NaN;
  game.updateCameraMotion(STEP);
  nearVector(game.cameraVelocity, new Vector3());
});
