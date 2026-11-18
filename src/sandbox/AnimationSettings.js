export const ANIMATION_SETTINGS_KEY = "kinetic.animation-presentation.v1";
export const ANIMATION_DEFAULTS = Object.freeze({ sprintAggression: 1 });
export const ANIMATION_PARAMETERS = Object.freeze([
  Object.freeze({
    id: "sprintAggression",
    label: "Superhuman sprint aggression",
    min: 0,
    max: 1.5,
    step: 0.05,
    unit: "×",
  }),
]);
export function sanitizeAnimationSettings(values = {}) {
  const value = values?.sprintAggression;
  return Object.freeze({
    sprintAggression: Number.isFinite(value)
      ? Math.max(0, Math.min(1.5, value))
      : 1,
  });
}
export function loadAnimationSettings(storage) {
  try {
    const saved = JSON.parse(
      storage?.getItem(ANIMATION_SETTINGS_KEY) ?? "null",
    );
    return saved?.version === 1 &&
      saved.values !== null &&
      typeof saved.values === "object" &&
      !Array.isArray(saved.values)
      ? sanitizeAnimationSettings(saved.values)
      : null;
  } catch {
    return null;
  }
}
export function saveAnimationSettings(storage, values) {
  try {
    if (!storage) return false;
    storage.setItem(
      ANIMATION_SETTINGS_KEY,
      JSON.stringify({ version: 1, values: sanitizeAnimationSettings(values) }),
    );
    return true;
  } catch {
    return false;
  }
}
