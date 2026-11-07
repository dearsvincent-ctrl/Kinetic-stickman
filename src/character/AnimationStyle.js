// Visual personality only. These values never reach movement, combat
// eligibility, attack durations, collision, the camera or touchscreen input.
const definitions = {
  locomotion: {
    runStart: 1.35,
    runFull: 2.6,
    sprintStart: 3.1,
    sprintFull: 5.0,
    walkStride: 0.34,
    runStride: 0.68,
    sprintStride: 0.78,
    walkDuty: 0.66,
    runDuty: 0.54,
    sprintDuty: 0.34,
    walkLift: 0.055,
    runLift: 0.105,
    sprintLift: 0.17,
    walkLean: 0.035,
    runLean: 0.18,
    sprintLean: 0.37,
    walkArm: 0.23,
    runArm: 0.46,
    sprintArm: 0.72,
    runElbow: 0.78,
    sprintElbow: 1.12,
    hipTwist: 0.075,
    sprintTwist: 0.11,
    shoulderCounter: 0.95,
    guardStride: 0.6,
    guardDuty: 0.3,
    guardLift: 0.105,
    guardLean: 0.08,
    bob: 0.014,
    sprintBob: 0.022,
    response: 12,
  },
  motion: {
    response: 14,
    accelerationScale: 18,
    startLean: 0.12,
    brakeLean: 0.17,
    compression: 0.035,
    bank: 0.07,
  },
  punch: {
    entryTime: 0.075,
    releaseTime: 0.1,
    poseResponse: 60,
    extensionFraction: 0.65,
    recoveryFraction: 0.62,
    hipTwist: 0.18,
    crossHipTwist: 0.25,
    shoulderDrive: 0.43,
    crossShoulderDrive: 0.57,
    anticipationTwist: 0.1,
    weightTransfer: 0.065,
    crossWeightTransfer: 0.085,
    compression: 0.028,
    recoil: 0.025,
  },
  groundDash: {
    entryTime: 0.04,
    recoveryTime: 0.13,
    lean: 0.43,
    driveLean: 0.1,
    compression: 0.1,
    twist: 0.065,
    rearLift: 0.18,
    frontLift: 0.22,
  },
  aerialDash: {
    entryTime: 0.045,
    blendResponse: 40,
    releaseResponse: 22,
    lean: 0.48,
    bank: 0.32,
    compression: 0.035,
    trail: 0.29,
    lead: 0.19,
    rearLift: 0.25,
    frontLift: 0.14,
  },
  jump: {
    takeoffDepth: 0.16,
    takeoffLean: 0.09,
    takeoffPoseResponse: 55,
    upperBodyResponse: 28,
    flightTuck: 0.3,
    flightLean: 0.055,
    landingDepth: 0.17,
    landingLean: 0.095,
    landingPeak: 0.27,
    recoveryLift: 0.06,
  },
  aerialAttack: {
    entryTime: 0.06,
    releaseResponse: 24,
    extensionFraction: 0.65,
    recoveryFraction: 0.72,
    chamberHeight: 0.72,
    chamberForward: 0.18,
    reach: 0.8,
    hipTwist: 0.14,
    shoulderTwist: 0.3,
    coilTwist: 0.16,
    leanBack: 0.23,
    coilLean: 0.12,
    bank: 0.09,
    landingBlendTime: 0.1,
  },
};

export const ANIME_STYLE = Object.freeze(
  Object.fromEntries(
    Object.entries(definitions).map(([name, values]) => [
      name,
      Object.freeze(values),
    ]),
  ),
);

/** Resolve once per character; all layers share immutable numeric tuning.
 * A future character can override presentation without touching its abilities. */
export function resolveAnimationStyle(overrides = {}) {
  if (!overrides || typeof overrides !== "object" || Array.isArray(overrides))
    throw new TypeError("Animation style must be an object");
  for (const name of Object.keys(overrides))
    if (!Object.hasOwn(ANIME_STYLE, name))
      throw new RangeError(`Unknown animation style section: ${name}`);
  const style = {};
  for (const [name, defaults] of Object.entries(ANIME_STYLE)) {
    if (
      overrides[name] !== undefined &&
      (!overrides[name] ||
        typeof overrides[name] !== "object" ||
        Array.isArray(overrides[name]))
    )
      throw new TypeError(`Invalid animation style section: ${name}`);
    const section = { ...defaults, ...overrides[name] };
    for (const [key, value] of Object.entries(section))
      if (!Object.hasOwn(defaults, key) || !Number.isFinite(value) || value < 0)
        throw new RangeError(`Invalid animation style ${name}.${key}`);
    for (const key of Object.keys(section))
      if (
        (key.endsWith("Time") ||
          key.endsWith("Fraction") ||
          key.endsWith("Stride") ||
          key.endsWith("Response") ||
          key === "response" ||
          key === "accelerationScale") &&
        section[key] <= 0
      )
        throw new RangeError(
          `Animation timing must be positive: ${name}.${key}`,
        );
    for (const key of Object.keys(section))
      if (key.endsWith("Fraction") && section[key] > 1)
        throw new RangeError(
          `Animation phase fraction cannot exceed one: ${name}.${key}`,
        );
    style[name] = Object.freeze(section);
  }
  if (
    style.locomotion.runFull <= style.locomotion.runStart ||
    style.locomotion.sprintFull <= style.locomotion.sprintStart
  )
    throw new RangeError("Animation speed thresholds must increase");
  for (const key of ["walkDuty", "runDuty", "sprintDuty", "guardDuty"])
    if (style.locomotion[key] <= 0 || style.locomotion[key] >= 1)
      throw new RangeError("Foot contact duty must be between zero and one");
  if (style.jump.landingPeak <= 0 || style.jump.landingPeak >= 1)
    throw new RangeError(
      "Landing compression peak must be between zero and one",
    );
  return Object.freeze(style);
}
