import {
  sandboxMovementConfig,
  sanitizePhysics,
  NORMAL_PHYSICS,
} from "../sandbox/PhysicsSandbox.js";
import { resolveMovementConfig } from "../movement/MovementConfig.js";
import { PARKOUR_DEFAULTS } from "../traversal/ParkourState.js";
import { BODY_ROTATION_CONFIG } from "../movement/BodyRotation.js";
export function progressionEffects(
  character,
  { sandbox = false, preview = false, physics = NORMAL_PHYSICS } = {},
) {
  const tuning = sanitizePhysics(physics),
    source = sandboxMovementConfig(tuning),
    enabled = !sandbox || preview,
    v = enabled
      ? character.values
      : Object.fromEntries(Object.keys(character.values).map((id) => [id, 1]));
  const selected = (id) =>
    enabled &&
    character.state.selected.includes(id) &&
    character.rules?.abilities?.[id]?.enabled !== false;
  const abilities = {
    ...source.abilities,
    groundAcceleration:
      source.abilities.groundAcceleration * v.groundAcceleration,
    agility: source.abilities.agility * v.agility,
    airAcceleration: source.abilities.airAcceleration * v.airAcceleration,
    airBraking: source.abilities.airBraking * v.airBraking,
    wallAdhesion:
      source.abilities.wallAdhesion *
      v.wallAdhesion *
      (selected("wallFlow") ? 1.2 : 1),
    wallTraversal:
      source.abilities.wallTraversal *
      v.wallRunning *
      (selected("wallFlow") ? 1.2 : 1),
    landingStability: source.abilities.landingStability * v.landingStability,
    wallJump: source.abilities.wallJump * (v.wallJump ?? 1),
  };
  const movement = resolveMovementConfig({
    movementConfig: {
      ...source,
      analogue: undefined,
      abilities,
      locomotion: {
        walkSpeed: Math.min(
          source.locomotion.walkSpeed * v.runningSpeed,
          source.locomotion.sprintSpeed * v.maximumVelocity * 0.475,
        ),
        runSpeed: Math.min(
          source.locomotion.runSpeed * v.runningSpeed,
          source.locomotion.sprintSpeed * v.maximumVelocity * 0.95,
        ),
        sprintSpeed: source.locomotion.sprintSpeed * v.maximumVelocity,
      },
      jump: {
        ...source.jump,
        height: source.jump.height * v.jumpStrength,
        airControl: source.jump.airControl * v.airControl,
        maxJumps: source.jump.maxJumps + (selected("aerialReserve") ? 1 : 0),
      },
    },
  });
  return {
    movement,
    strength: {
      attackPower: tuning.attackPower * v.attackPower,
      impact: tuning.impact * v.knockback,
    },
    stability: v.balance,
    attackSpeed: v.attackSpeed,
    recovery: v.combatRecovery * (selected("combatFlow") ? 1.15 : 1),
    aerialRecovery: v.aerialRecovery,
    climbSpeed:
      (PARKOUR_DEFAULTS.climbSpeed *
        source.abilities.wallTraversal *
        v.climbing *
        (selected("wallFlow") ? 1.2 : 1)) /
      movement.abilities.wallTraversal,
    descentSpeed:
      (PARKOUR_DEFAULTS.descentSpeed *
        source.abilities.wallTraversal *
        v.climbing *
        (selected("wallFlow") ? 1.2 : 1)) /
      movement.abilities.wallTraversal,
    rotation: {
      flipDuration: Math.min(
        1.2,
        Math.max(0.25, BODY_ROTATION_CONFIG.flipDuration / v.rotationalControl),
      ),
      minFlipDuration: Math.min(
        0.6,
        Math.max(
          0.2,
          BODY_ROTATION_CONFIG.minFlipDuration / v.rotationalControl,
        ),
      ),
      maxAngularSpeed: Math.min(
        60,
        Math.max(
          12,
          BODY_ROTATION_CONFIG.maxAngularSpeed * v.rotationalControl,
        ),
      ),
      recoveryResponse: Math.min(
        80,
        BODY_ROTATION_CONFIG.recoveryResponse * v.rotationalControl,
      ),
    },
  };
}
// Immutable per-strike profile: animation, phase boundaries and swept contact all
// consume the same timings. Live purchases never retime an executing strike.
export function progressionTechnique(technique, context, effects) {
  if (!effects) return technique;
  const recovery =
      effects.recovery *
      (context.environment === "air" ? effects.aerialRecovery : 1),
    speed = effects.attackSpeed;
  if (speed === 1 && recovery === 1) return technique;
  return Object.freeze({
    ...technique,
    windup: technique.windup / speed,
    extension: technique.extension / speed,
    impact: technique.impact / speed,
    recovery: technique.recovery / recovery,
    transitionAfter: (technique.transitionAfter ?? 0.14) / recovery,
  });
}
export function applyProgressionEffects(game, effects) {
  game.progressionEffects = effects;
  game.controller.applyMovementConfig(effects.movement);
  game.battle.configureStrength(effects.strength);
  game.battle.player.stability = effects.stability;
  if (game.controller.parkour) {
    game.controller.parkour.config = Object.freeze({
      ...game.controller.parkour.config,
      climbSpeed: effects.climbSpeed,
      descentSpeed: effects.descentSpeed,
    });
  }
  Object.assign(game.bodyRotation.config, effects.rotation);
  game.bodyRotation.automatic.config = game.bodyRotation.config;
}
