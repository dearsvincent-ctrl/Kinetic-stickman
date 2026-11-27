export const REACTION_SETTINGS_KEY = "kinetic.enemy-reactions.v1";
export const REACTION_PARAMETERS = Object.freeze(
  [
    ["lightIntensity", "Light reaction intensity", 0, 3, 1, 0.05, "×"],
    ["moderateIntensity", "Moderate reaction intensity", 0, 3, 1, 0.05, "×"],
    ["heavyIntensity", "Heavy stagger intensity", 0, 3, 1, 0.05, "×"],
    ["balanceDamage", "Balance damage", 0, 10, 1, 0.05, "×"],
    ["balanceRecovery", "Balance recovery speed", 0, 10, 1, 0.05, "×"],
    ["knockdownResistance", "Knockdown resistance", 0.1, 20, 1, 0.1, "×"],
    ["standingRecovery", "Standing recovery strength", 0.1, 10, 1, 0.05, "×"],
    ["intensity", "Hit reaction intensity", 0, 3, 1, 0.05, "×"],
    ["stagger", "Stagger threshold", 0.1, 100, 2, 0.1, " m/s"],
    ["knockdown", "Knockdown threshold", 1, 200, 10, 1, " m/s"],
    ["ragdoll", "Ragdoll threshold", 2, 500, 30, 1, " m/s"],
    ["launch", "Launch strength", 0, 20, 1, 0.1, "×"],
    ["rotation", "Airborne rotation", 0, 5, 1, 0.05, "×"],
    ["mass", "Enemy mass", 0.1, 20, 1, 0.1, "×"],
    ["resistance", "Reaction knockback resistance", 0.1, 20, 1, 0.1, "×"],
    ["recovery", "Recovery speed", 0.1, 10, 1, 0.1, "×"],
    ["collisionDamage", "Environmental collision damage", 0, 5, 0, 0.05, "×"],
  ].map(([id, label, min, max, value, step, unit]) =>
    Object.freeze({ id, label, min, max, default: value, step, unit }),
  ),
);
export const REACTION_DEFAULTS = Object.freeze({
  ragdollEnabled: true,
  ...Object.fromEntries(REACTION_PARAMETERS.map((p) => [p.id, p.default])),
});
export function sanitizeReactions(v = {}) {
  const out = {
    ragdollEnabled:
      typeof v?.ragdollEnabled === "boolean" ? v.ragdollEnabled : true,
  };
  for (const p of REACTION_PARAMETERS)
    out[p.id] = Number.isFinite(v?.[p.id])
      ? Math.max(p.min, Math.min(p.max, v[p.id]))
      : p.default;
  return Object.freeze(out);
}
export function loadReactions(storage) {
  try {
    const s = JSON.parse(storage?.getItem(REACTION_SETTINGS_KEY) ?? "null");
    return s?.version === 1 &&
      s.values &&
      !Array.isArray(s.values) &&
      typeof s.values === "object"
      ? sanitizeReactions(s.values)
      : null;
  } catch {
    return null;
  }
}
export function saveReactions(storage, values) {
  try {
    if (!storage) return false;
    storage.setItem(
      REACTION_SETTINGS_KEY,
      JSON.stringify({ version: 1, values: sanitizeReactions(values) }),
    );
    return true;
  } catch {
    return false;
  }
}
