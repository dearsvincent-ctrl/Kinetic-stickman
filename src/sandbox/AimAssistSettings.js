// Developer aim tuning has its own save, independent of physics and HUD data.
export const AIM_ASSIST_STORAGE_KEY = "kinetic.aim-assist.v1";
export const AIM_ASSIST_DEFAULTS = Object.freeze({
  strength: 1,
  maxAngle: 20,
  cone: 25,
  debug: false,
});
export const AIM_ASSIST_LIMITS = Object.freeze({
  strengthMax: 2,
  maxAngle: 45,
  coneMin: 5,
  coneMax: 60,
  acquireDistance: 2.5,
  predictionHorizon: 0.2,
  maxTravelLead: 120,
});
const finite = (v, fallback, lo, hi) =>
  Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : fallback;
export function sanitizeAimAssist(values = {}) {
  return Object.freeze({
    strength: finite(
      values?.strength,
      AIM_ASSIST_DEFAULTS.strength,
      0,
      AIM_ASSIST_LIMITS.strengthMax,
    ),
    maxAngle: finite(
      values?.maxAngle,
      AIM_ASSIST_DEFAULTS.maxAngle,
      0,
      AIM_ASSIST_LIMITS.maxAngle,
    ),
    cone: finite(
      values?.cone,
      AIM_ASSIST_DEFAULTS.cone,
      AIM_ASSIST_LIMITS.coneMin,
      AIM_ASSIST_LIMITS.coneMax,
    ),
    debug: values?.debug === true,
  });
}
export function loadAimAssist(storage) {
  try {
    const saved = JSON.parse(
      storage?.getItem(AIM_ASSIST_STORAGE_KEY) ?? "null",
    );
    return saved?.version === 1 &&
      saved.values &&
      typeof saved.values === "object" &&
      !Array.isArray(saved.values)
      ? sanitizeAimAssist(saved.values)
      : null;
  } catch {
    return null;
  }
}
export function saveAimAssist(storage, values) {
  try {
    if (!storage) return false;
    storage.setItem(
      AIM_ASSIST_STORAGE_KEY,
      JSON.stringify({ version: 1, values: sanitizeAimAssist(values) }),
    );
    return true;
  } catch {
    return false;
  }
}
