import { speedForMagnitude } from "../movement/AnalogueLocomotion.js";
import {
  MOVEMENT_DEFAULTS,
  resolveMovementConfig,
} from "../movement/MovementConfig.js";

export const SANDBOX_STORAGE_KEY = "kinetic.physics-sandbox.v1";
// Numerical guardrails, not balance rules. Each multiplier is independent.
export const SANDBOX_PARAMETERS = Object.freeze(
  [
    ["movement", "Movement speed"],
    ["jumpHeight", "Jump height"],
    ["groundSpeed", "Ground dash speed"],
    ["groundDistance", "Ground dash distance"],
    ["airSpeed", "Aerial dash speed"],
    ["airDistance", "Aerial dash distance"],
    ["airControl", "Air steering / control"],
    ["gravity", "Gravity"],
  ].map(([id, label]) => Object.freeze({ id, label, min: 0.1, max: 100 })),
);
export const NORMAL_PHYSICS = Object.freeze(
  Object.fromEntries(SANDBOX_PARAMETERS.map(({ id }) => [id, 1])),
);
export const SANDBOX_PRESETS = Object.freeze({
  Normal: NORMAL_PHYSICS,
  Enhanced: Object.freeze({
    movement: 3,
    jumpHeight: 5,
    groundSpeed: 5,
    groundDistance: 3,
    airSpeed: 5,
    airDistance: 3,
    airControl: 3,
    gravity: 1,
  }),
  Extreme: Object.freeze({
    movement: 20,
    jumpHeight: 50,
    groundSpeed: 50,
    groundDistance: 20,
    airSpeed: 50,
    airDistance: 20,
    airControl: 10,
    gravity: 2,
  }),
});
export function sanitizePhysics(values = {}) {
  return Object.freeze(
    Object.fromEntries(
      SANDBOX_PARAMETERS.map(({ id, min, max }) => {
        const n = values?.[id];
        return [
          id,
          typeof n === "number" && Number.isFinite(n)
            ? Math.max(min, Math.min(max, n))
            : 1,
        ];
      }),
    ),
  );
}
export function sandboxMovementConfig(values) {
  const v = sanitizePhysics(values),
    d = MOVEMENT_DEFAULTS;
  return resolveMovementConfig({
    movementConfig: {
      locomotion: Object.fromEntries(
        Object.entries(d.locomotion).map(([key, n]) => [key, n * v.movement]),
      ),
      groundDash: {
        speed: d.groundDash.speed * v.groundSpeed,
        distance: d.groundDash.distance * v.groundDistance,
      },
      aerialDash: {
        speed: d.aerialDash.speed * v.airSpeed,
        distance: d.aerialDash.distance * v.airDistance,
        exitSpeed: d.aerialDash.exitSpeed * v.movement,
      },
      jump: {
        height: d.jump.height * v.jumpHeight,
        gravity: d.jump.gravity * v.gravity,
        airControl: d.jump.airControl * v.airControl,
      },
    },
  });
}
export function loadPhysics(storage) {
  try {
    const saved = JSON.parse(storage?.getItem(SANDBOX_STORAGE_KEY) ?? "null");
    if (
      saved?.version !== 1 ||
      !saved.values ||
      typeof saved.values !== "object"
    )
      return null;
    return sanitizePhysics(saved.values);
  } catch {
    return null;
  }
}
export function savePhysics(storage, values) {
  try {
    if (!storage) return false;
    storage.setItem(
      SANDBOX_STORAGE_KEY,
      JSON.stringify({ version: 1, values: sanitizePhysics(values) }),
    );
    return true;
  } catch {
    return false;
  }
}

export const SIMULATION_LIMITS = Object.freeze({
  maxSubsteps: 32,
  travelPerStep: 0.18,
});
// Budget work by maximum possible travel, not by multiplier alone. Swept world
// and proximity queries cover segments even when this finite budget is reached.
export function movementSubsteps(
  controller,
  dt,
  limits = SIMULATION_LIMITS,
  intentMagnitude = 1,
) {
  const dash = controller.dash;
  const requestedSpeed = controller.dashRequested
    ? (controller.requestedDashMode === "air"
        ? controller.config.aerialDash.speed
        : controller.config.groundDash.speed) * 2
    : 0;
  const speed = Math.max(
    speedForMagnitude(intentMagnitude, controller.config.analogue),
    controller.velocity.length(),
    requestedSpeed,
    dash.active ? dash.peakSpeed : 0,
  );
  const jump = controller.jump;
  const vertical = jump.airborne
    ? Math.abs(jump.verticalVelocity) + jump.config.gravity * dt
    : controller.jumpRequested || jump.phase === "takeoff"
      ? jump.launchVelocity + jump.config.gravity * dt
      : 0;
  return Math.max(
    1,
    Math.min(
      limits.maxSubsteps,
      Math.ceil((Math.hypot(speed, vertical) * dt) / limits.travelPerStep),
    ),
  );
}
