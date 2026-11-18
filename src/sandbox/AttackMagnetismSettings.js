// Optional manual-attack assistance has an independent save and never changes
// the player's locomotion, aim-assist or enemy configuration.
export const ATTACK_MAGNETISM_STORAGE_KEY = "kinetic.attack-magnetism.v1";
export const ATTACK_MAGNETISM_SETTINGS_KEY = ATTACK_MAGNETISM_STORAGE_KEY;
export const ATTACK_MAGNETISM_PARAMETERS = Object.freeze(
  [
    {
      id: "range",
      label: "Target range",
      min: 0,
      max: 8,
      default: 3,
      step: 0.1,
      unit: " m",
    },
    {
      id: "maxApproach",
      label: "Maximum approach",
      min: 0,
      max: 3,
      default: 1.25,
      step: 0.05,
      unit: " m",
    },
    {
      id: "alignment",
      label: "Attack alignment",
      min: 0,
      max: 1,
      default: 0.7,
      step: 0.01,
      unit: "",
    },
    {
      id: "approachAcceleration",
      label: "Approach acceleration",
      min: 0,
      max: 100,
      default: 24,
      step: 1,
      unit: " m/s²",
    },
    {
      id: "switchSensitivity",
      label: "Target switching",
      min: 0,
      max: 1,
      default: 0.35,
      step: 0.01,
      unit: "",
    },
  ].map(Object.freeze),
);
export const ATTACK_MAGNETISM_DEFAULTS = Object.freeze({
  enabled: false,
  ...Object.fromEntries(
    ATTACK_MAGNETISM_PARAMETERS.map((p) => [p.id, p.default]),
  ),
});
export const ATTACK_MAGNETISM_LIMITS = Object.freeze({
  range: 8,
  maxApproach: 3,
  alignment: 1,
  approachAcceleration: 100,
  switchSensitivity: 1,
  acquireAngle: (80 * Math.PI) / 180,
  alignmentAngle: (35 * Math.PI) / 180,
  approachDuration: 0.28,
  approachSpeed: 6,
  predictionHorizon: 0.2,
  hysteresisDuration: 0.55,
});
export const MAGNETISM_PARAMETERS = ATTACK_MAGNETISM_PARAMETERS;
export const MAGNETISM_DEFAULTS = ATTACK_MAGNETISM_DEFAULTS;
export const MAGNETISM_LIMITS = ATTACK_MAGNETISM_LIMITS;
export const DEFAULT_ATTACK_MAGNETISM_SETTINGS = ATTACK_MAGNETISM_DEFAULTS;

export function sanitizeAttackMagnetism(values = {}) {
  const result = { enabled: values?.enabled === true };
  for (const p of ATTACK_MAGNETISM_PARAMETERS) {
    const value = values?.[p.id];
    result[p.id] = Number.isFinite(value)
      ? Math.max(p.min, Math.min(p.max, value))
      : p.default;
  }
  return Object.freeze(result);
}
export function loadAttackMagnetism(storage) {
  try {
    const saved = JSON.parse(
      storage?.getItem(ATTACK_MAGNETISM_STORAGE_KEY) ?? "null",
    );
    return saved?.version === 1 &&
      saved.values &&
      typeof saved.values === "object" &&
      !Array.isArray(saved.values)
      ? sanitizeAttackMagnetism(saved.values)
      : null;
  } catch {
    return null;
  }
}
export function saveAttackMagnetism(storage, values) {
  try {
    if (!storage) return false;
    storage.setItem(
      ATTACK_MAGNETISM_STORAGE_KEY,
      JSON.stringify({ version: 1, values: sanitizeAttackMagnetism(values) }),
    );
    return true;
  } catch {
    return false;
  }
}
export const loadAttackMagnetismSettings = loadAttackMagnetism;
export const saveAttackMagnetismSettings = saveAttackMagnetism;
export const loadMagnetismSettings = loadAttackMagnetism;
export const saveMagnetismSettings = saveAttackMagnetism;
