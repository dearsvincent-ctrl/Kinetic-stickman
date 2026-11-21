import { REACTION_DEFAULTS } from "../sandbox/ReactionSettings.js";
export const IMPACT_LIMITS = Object.freeze({
  velocity: 1200,
  angular: 16,
  physicsSteps: 16,
  gravity: 18,
});
const finite = (n, f = 0) => (Number.isFinite(n) ? n : f);
export function physicalResistance(profile = {}, settings = REACTION_DEFAULTS) {
  return Math.max(
    0.01,
    finite(profile.mass, 1) *
      settings.mass *
      finite(profile.knockbackResistance, 1) *
      settings.resistance,
  );
}
/** Saturated speed contribution; damage is never multiplied into displacement.
 * Force is a delta-velocity in our kinematic adapter, not Newtons or a damage hit. */
export function calculateImpact(
  out,
  {
    hit,
    technique,
    damage,
    knockback,
    sourceVelocity,
    targetVelocity,
    profile = {},
    settings = REACTION_DEFAULTS,
  },
) {
  const target = hit.targetPosition ?? {},
    source = hit.source ?? {};
  let x = finite(target.x) - finite(source.x),
    z = finite(target.z) - finite(source.z),
    d = Math.hypot(x, z);
  if (
    Number.isFinite(hit.direction?.x) &&
    Number.isFinite(hit.direction?.z) &&
    Math.hypot(hit.direction.x, hit.direction.z) > 1e-6
  ) {
    x = hit.direction.x;
    z = hit.direction.z;
    d = Math.hypot(x, z);
  }
  if (d < 1e-6) {
    x = -Math.sin(finite(hit.heading));
    z = -Math.cos(finite(hit.heading));
    d = 1;
  }
  out.x = x / d;
  out.z = z / d;
  const dy = finite(hit.direction?.y),
    total = Math.hypot(finite(hit.direction?.x), dy, finite(hit.direction?.z));
  out.up = total > 1e-6 ? Math.max(-1, Math.min(1, dy / total)) : 0;
  out.horizontal = Math.sqrt(Math.max(0, 1 - out.up * out.up));
  const relative = Math.min(
    10000,
    Math.max(
      0,
      (finite(sourceVelocity?.x) - finite(targetVelocity?.x)) *
        out.x *
        out.horizontal +
        (finite(sourceVelocity?.z) - finite(targetVelocity?.z)) *
          out.z *
          out.horizontal +
        (finite(sourceVelocity?.y) - finite(targetVelocity?.y)) * out.up,
    ),
  );
  const speedGain = 1 + Math.min(0.6, Math.log1p(relative / 20) * 0.12);
  out.force = Math.min(
    IMPACT_LIMITS.velocity,
    (Math.max(0, knockback) * speedGain) /
      physicalResistance(profile, settings),
  );
  out.speed = relative;
  out.damage = finite(damage);
  out.action = technique?.action ?? "punch";
  out.style = technique?.strikeStyle ?? technique?.animation ?? out.action;
  out.height = finite(hit.point?.y, finite(target.y) + 1.36) - finite(target.y);
  out.location =
    hit.location ??
    (out.height < 0.75 ? "leg" : out.height > 1.55 ? "head" : "body");
  out.visual = Math.min(
    3,
    (0.35 +
      Math.log1p(out.force) * 0.28 +
      Math.sqrt(Math.max(0, out.damage)) * 0.015) *
      settings.intensity,
  );
  return out;
}
