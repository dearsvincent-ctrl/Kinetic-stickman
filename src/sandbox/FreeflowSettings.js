// Freeflow is an independent combat preference; legacy magnetism never loads it.
export const FREEFLOW_STORAGE_KEY = "kinetic.freeflow.v1";
export const FREEFLOW_SETTINGS_KEY = FREEFLOW_STORAGE_KEY;
export const FREEFLOW_PARAMETERS = Object.freeze([
  { id: "range", label: "Target range", min: 0, max: 100, default: 14, step: 0.5, unit: " m" },
  { id: "maxApproach", label: "Maximum approach", min: 0, max: 100, default: 18, step: 0.5, unit: " m" },
  { id: "speed", label: "Approach speed", min: 0, max: 1500, default: 80, step: 1, unit: " m/s" },
  { id: "acceleration", label: "Approach acceleration", min: 0, max: 20000, default: 600, step: 10, unit: " m/s²" },
  { id: "alignment", label: "Attack alignment", min: 0, max: 1, default: 1, step: 0.01, unit: "" },
  { id: "directionBias", label: "Direction bias", min: 0, max: 1, default: 0.8, step: 0.01, unit: "" },
  { id: "switchSensitivity", label: "Target switching", min: 0, max: 1, default: 0.55, step: 0.01, unit: "" },
  { id: "airRange", label: "Aerial range", min: 0, max: 100, default: 12, step: 0.5, unit: " m" },
  { id: "airStrength", label: "Aerial assistance", min: 0, max: 2, default: 0.75, step: 0.01, unit: "" },
].map(Object.freeze));
export const FREEFLOW_DEFAULTS = Object.freeze({
  enabled: true,
  ...Object.fromEntries(FREEFLOW_PARAMETERS.map((p) => [p.id, p.default])),
});
export const FREEFLOW_LIMITS = Object.freeze({
  ...Object.fromEntries(FREEFLOW_PARAMETERS.map((p) => [p.id, p.max])),
  timeout: 2,
  hysteresisDuration: 0.7,
  contactTolerance: 0.055,
  facingTolerance: 0.14,
  turnRate: 24,
  verticalAcceleration: 64,
});
export function sanitizeFreeflow(values = {}) {
  const result = { enabled: values?.enabled === undefined ? true : values.enabled === true };
  for (const p of FREEFLOW_PARAMETERS) {
    const value = values?.[p.id];
    result[p.id] = Number.isFinite(value)
      ? Math.max(p.min, Math.min(p.max, value))
      : p.default;
  }
  return Object.freeze(result);
}
export function loadFreeflow(storage) {
  try {
    const saved = JSON.parse(storage?.getItem(FREEFLOW_STORAGE_KEY) ?? "null");
    return saved?.version === 1 && saved.values && typeof saved.values === "object" && !Array.isArray(saved.values)
      ? sanitizeFreeflow(saved.values)
      : null;
  } catch { return null; }
}
export function saveFreeflow(storage, values) {
  try {
    if (!storage) return false;
    storage.setItem(FREEFLOW_STORAGE_KEY, JSON.stringify({ version: 1, values: sanitizeFreeflow(values) }));
    return true;
  } catch { return false; }
}
export const loadFreeflowSettings = loadFreeflow;
export const saveFreeflowSettings = saveFreeflow;
export const sanitizeFreeflowSettings = sanitizeFreeflow;
