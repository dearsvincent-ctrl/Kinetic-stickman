// Independent multipliers. Agility has a bounded response curve, not a global
// multiplier on speed, gravity, jump height, or attack-driven movement.
export const ABILITY_PARAMETERS = Object.freeze(
  [
    ["groundAcceleration", "Ground acceleration"],
    ["agility", "Agility"],
    ["airAcceleration", "Air acceleration"],
    ["airBraking", "Air braking"],
    ["wallAdhesion", "Wall adhesion"],
    ["wallTraversal", "Wall traversal speed"],
    ["wallJump", "Wall-jump impulse"],
    ["landingStability", "Landing stability"],
  ].map(([id, label]) =>
    Object.freeze({
      id,
      label,
      min: 0.1,
      max: 100,
      log: true,
      group: "abilities",
    }),
  ),
);
export const ABILITY_DEFAULTS = Object.freeze(
  Object.fromEntries(ABILITY_PARAMETERS.map((p) => [p.id, 1])),
);
export function resolveAbilities(values = {}) {
  const out = {};
  for (const p of ABILITY_PARAMETERS)
    out[p.id] = Number.isFinite(values?.[p.id])
      ? Math.max(p.min, Math.min(p.max, values[p.id]))
      : 1;
  return Object.freeze(out);
}
export const agilityResponse = (value) =>
  Math.min(5.5, 0.5 + 0.5 * Math.sqrt(value ?? 1));
