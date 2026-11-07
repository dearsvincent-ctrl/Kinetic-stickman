import { BASIC_PUNCH, FLYING_KICK } from "./Techniques.js";

/** Execution timing is separate from animation presentation and hit sensing.
 * These code-only factors are ready for v0.7.6; no new sandbox sliders yet. */
export const ATTACK_TIMING_DEFAULTS = Object.freeze({
  punchSpeed: 1,
  kickSpeed: 1,
  recoverySpeed: 1,
});
export const MANUAL_TECHNIQUES = Object.freeze([
  Object.freeze({
    ...BASIC_PUNCH,
    action: "punch",
    startup: 0.08,
    activeDuration: 0.1,
    recovery: 0.24,
    animationSpeed: 1,
    hitRadius: 0.1,
  }),
  Object.freeze({
    ...BASIC_PUNCH,
    id: "aerial-punch",
    label: "Aerial straight",
    action: "punch",
    environments: Object.freeze(["air"]),
    startup: 0.08,
    activeDuration: 0.1,
    recovery: 0.24,
    animationSpeed: 1,
    hitRadius: 0.1,
  }),
  Object.freeze({
    id: "front-kick",
    label: "Front kick",
    action: "kick",
    animation: "ground-kick",
    side: "right",
    environments: Object.freeze(["ground"]),
    reach: 0.81,
    originHeight: 1.25,
    maxVertical: 0.65,
    maxAngle: Math.PI / 4,
    startup: 0.12,
    activeDuration: 0.13,
    recovery: 0.28,
    animationSpeed: 1,
    hitRadius: 0.14,
  }),
  Object.freeze({
    ...FLYING_KICK,
    action: "kick",
    requiresTarget: false,
    minHeight: 0,
    minAirTimeRemaining: 0,
    startup: 0.06,
    activeDuration: 0.105,
    recovery: 0.22,
    animationSpeed: 1,
    hitRadius: 0.14,
  }),
]);
export function createManualTechniques(timing = {}, overrides = {}) {
  const factors = { ...ATTACK_TIMING_DEFAULTS, ...timing };
  for (const n of Object.values(factors))
    if (!Number.isFinite(n) || n <= 0)
      throw new RangeError("Attack speed factors must be positive");
  return MANUAL_TECHNIQUES.map((base) => {
    const t = { ...base, ...overrides[base.id] };
    for (const key of [
      "startup",
      "activeDuration",
      "recovery",
      "animationSpeed",
      "hitRadius",
      "reach",
    ])
      if (
        !Number.isFinite(t[key]) ||
        t[key] < 0 ||
        (["animationSpeed", "activeDuration", "hitRadius"].includes(key) &&
          t[key] === 0)
      )
        throw new RangeError(`Invalid technique ${key}`);
    if (t.hitRadius >= t.reach)
      throw new RangeError(
        "Weapon radius must be smaller than technique reach",
      );
    const speed =
      t.animationSpeed *
      factors[t.action === "punch" ? "punchSpeed" : "kickSpeed"];
    const active = t.activeDuration / speed;
    return Object.freeze({
      ...t,
      windup: t.startup / speed,
      extension: active * 0.75,
      impact: active * 0.25,
      recovery: t.recovery / (t.animationSpeed * factors.recoverySpeed),
    });
  });
}
export const selectManualTechnique = (context, eligible) =>
  [...eligible.values()].find((t) => t.action === context.action)?.id;
