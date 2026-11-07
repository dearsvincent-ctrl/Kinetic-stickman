// Reach is measured from the technique's strike origin to the target's body
// surface. Collision footprints never extend attack reach.
export const TARGET_STRIKE_DEFAULTS = Object.freeze({
  height: 1.4,
  radius: 0.24,
});

export const BASIC_PUNCH = Object.freeze({
  id: "basic-punch",
  label: "Right straight",
  animation: "punch",
  side: "right",
  environments: Object.freeze(["ground"]),
  reach: 0.76,
  originHeight: 1.4,
  maxVertical: 0.35,
  maxAngle: Math.PI / 4,
  windup: 0.08,
  extension: 0.1,
  impact: 0,
  recovery: 0.24,
});

export const CROSS_PUNCH = Object.freeze({
  id: "cross-punch",
  label: "Left cross",
  animation: "punch",
  side: "left",
  environments: Object.freeze(["ground"]),
  reach: 0.8,
  originHeight: 1.4,
  maxVertical: 0.35,
  maxAngle: Math.PI / 4,
  windup: 0.1,
  extension: 0.12,
  impact: 0.025,
  recovery: 0.26,
});

export const FLYING_KICK = Object.freeze({
  id: "flying-kick",
  label: "Flying kick",
  animation: "flying-kick",
  side: "right",
  environments: Object.freeze(["air"]),
  requiresTarget: true,
  reach: 0.81,
  originHeight: 0.9,
  maxVertical: 0.65,
  maxAngle: Math.PI / 4,
  minHeight: 0.08,
  minAirTimeRemaining: 0.22,
  windup: 0.06,
  extension: 0.07,
  impact: 0.035,
  recovery: 0.22,
});

export const DEFAULT_TECHNIQUES = Object.freeze([
  BASIC_PUNCH,
  CROSS_PUNCH,
  FLYING_KICK,
]);
export const GROUND_SELECTION_CONFIG = Object.freeze({
  closeDistance: 0.86,
  approachSpeed: 1.2,
});

export function techniqueContext(context, id) {
  const measured = context.techniqueContexts?.[id];
  return measured ? Object.freeze({ ...context, ...measured }) : context;
}

export function isTechniqueEligible(technique, context = {}) {
  const environment = context.environment ?? "ground";
  if (
    !technique.environments.includes(environment) ||
    context.canAttack === false
  )
    return false;
  if (context.height !== undefined && !Number.isFinite(context.height))
    return false;
  if (
    context.airTimeRemaining !== undefined &&
    Number.isNaN(context.airTimeRemaining)
  )
    return false;
  if ((context.height ?? 0) < technique.minHeight) return false;
  if (
    environment === "air" &&
    (context.airTimeRemaining ?? Infinity) < technique.minAirTimeRemaining
  )
    return false;
  const targeted = context.targetId !== undefined && context.targetId !== null;
  if (technique.requiresTarget && !targeted) return false;
  if (
    technique.requiresTarget &&
    ![
      context.targetPoint?.x,
      context.targetPoint?.y,
      context.targetPoint?.z,
    ].every(Number.isFinite)
  )
    return false;
  if (context.source === "proximity" || targeted) {
    const surfaceDistance =
      context.surfaceDistance ??
      Math.max(
        0,
        context.opponentDistance -
          (context.targetRadius ?? TARGET_STRIKE_DEFAULTS.radius),
      );
    if (
      !Number.isFinite(surfaceDistance) ||
      surfaceDistance > technique.reach + 1e-9
    )
      return false;
    if (
      !Number.isFinite(context.verticalSeparation) ||
      Math.abs(context.verticalSeparation) > technique.maxVertical
    )
      return false;
    if (
      !Number.isFinite(context.facingAngle) ||
      Math.abs(context.facingAngle) > technique.maxAngle + 1e-9
    )
      return false;
  }
  return !technique.eligible || technique.eligible(context);
}

// No combo queue: each choice is made afresh after full recovery. Close moving
// entries favor the cross; settled close range alternates with the straight.
export function selectBasicTechnique(context, eligible, lastCompleted) {
  if (context.environment === "air")
    return eligible.get(FLYING_KICK.id) ?? eligible.values().next().value;
  if (
    context.source === "proximity" &&
    context.opponentDistance <= GROUND_SELECTION_CONFIG.closeDistance &&
    ((context.speed ?? 0) > GROUND_SELECTION_CONFIG.approachSpeed ||
      lastCompleted === BASIC_PUNCH.id) &&
    eligible.has(CROSS_PUNCH.id)
  )
    return CROSS_PUNCH.id;
  return eligible.has(BASIC_PUNCH.id)
    ? BASIC_PUNCH.id
    : eligible.keys().next().value;
}
