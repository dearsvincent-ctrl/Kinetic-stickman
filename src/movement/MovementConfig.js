import { DASH_CONFIG } from "./DashState.js";
import { JUMP_CONFIG } from "./JumpState.js";
import {
  ANALOGUE_DEFAULTS,
  createAnalogueProfile,
} from "./AnalogueLocomotion.js";

const dashSpeed = DASH_CONFIG.distance / DASH_CONFIG.duration;
export const MOVEMENT_DEFAULTS = Object.freeze({
  locomotion: Object.freeze({
    walkSpeed: 1.3,
    runSpeed: 2.6,
    sprintSpeed: 5.2,
  }),
  groundDash: Object.freeze({ ...DASH_CONFIG, speed: dashSpeed }),
  aerialDash: Object.freeze({
    ...DASH_CONFIG,
    speed: dashSpeed,
    cooldown: 0,
    exitSpeed: 2.6,
  }),
  jump: JUMP_CONFIG,
  maxAerialDashes: 1,
  analogue: ANALOGUE_DEFAULTS,
});

function dashProfile(defaults, overrides = {}, legacy = {}) {
  const profile = { ...defaults, ...overrides, ...legacy };
  // Speed means average travel speed; peak speed still follows the physical
  // acceleration/braking profile. Legacy duration-based overrides keep working.
  const speed = legacy.speed ?? overrides.speed;
  if (speed !== undefined) {
    if (!Number.isFinite(speed) || speed <= 0)
      throw new RangeError("Dash speed must be positive");
    profile.duration = profile.distance / speed;
  } else if (
    Object.hasOwn(overrides, "distance") &&
    !Object.hasOwn(overrides, "duration") &&
    !Object.keys(legacy).length
  ) {
    profile.duration = profile.distance / defaults.speed;
  }
  for (const key of Object.keys(DASH_CONFIG)) {
    if (!Number.isFinite(profile[key]) || profile[key] < 0)
      throw new RangeError(`Invalid dash ${key}`);
  }
  profile.duration = Math.max(0.001, profile.duration);
  profile.speed = profile.distance / profile.duration;
  if (
    profile.exitSpeed !== undefined &&
    (!Number.isFinite(profile.exitSpeed) || profile.exitSpeed < 0)
  )
    throw new RangeError("Invalid aerial dash exit speed");
  return Object.freeze(profile);
}

/** Resolved per-character tuning. Later stats/abilities can supply overrides
 * without owning input, collision, action timing or animation state. */
export function resolveMovementConfig(options = {}) {
  const config = options.movementConfig ?? {};
  const locomotion = { ...MOVEMENT_DEFAULTS.locomotion, ...config.locomotion };
  if (options.walkSpeed !== undefined) {
    // The original walkSpeed option denotes the full normal joystick speed.
    locomotion.runSpeed = options.walkSpeed;
    locomotion.walkSpeed = options.walkSpeed / 2;
  }
  if (options.sprintSpeed !== undefined)
    locomotion.sprintSpeed = options.sprintSpeed;
  for (const value of Object.values(locomotion))
    if (!Number.isFinite(value) || value < 0)
      throw new RangeError("Invalid locomotion speed");
  const maxAerialDashes =
    options.maxAerialDashes ??
    config.maxAerialDashes ??
    MOVEMENT_DEFAULTS.maxAerialDashes;
  if (!Number.isInteger(maxAerialDashes) || maxAerialDashes < 0)
    throw new RangeError("maxAerialDashes must be a nonnegative integer");
  return Object.freeze({
    locomotion: Object.freeze(locomotion),
    analogue: createAnalogueProfile(locomotion, config.analogue),
    groundDash: dashProfile(
      MOVEMENT_DEFAULTS.groundDash,
      config.groundDash,
      options.dashConfig,
    ),
    aerialDash: dashProfile(
      MOVEMENT_DEFAULTS.aerialDash,
      config.aerialDash,
      options.airDashConfig,
    ),
    jump: Object.freeze({
      ...JUMP_CONFIG,
      ...config.jump,
      ...options.jumpConfig,
    }),
    maxAerialDashes,
  });
}
