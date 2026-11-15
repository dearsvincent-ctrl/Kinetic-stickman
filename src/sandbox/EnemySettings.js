// Independent developer tuning, never applied to the player's movement config.
export const ENEMY_SETTINGS_KEY = "kinetic.enemy-settings.v1";
export const ENEMY_LIMITS = Object.freeze({
  population: 64,
  fullRigs: 12,
  maxSubsteps: 32,
});
export const ENEMY_PARAMETERS = Object.freeze(
  [
    {
      id: "speed",
      label: "Movement speed",
      min: 0.1,
      max: 1000,
      default: 1,
      log: true,
      unit: "×",
    },
    {
      id: "acceleration",
      label: "Acceleration / braking",
      min: 0.1,
      max: 100,
      default: 1,
      log: true,
      unit: "×",
    },
    {
      id: "aggression",
      label: "Pursuit aggression",
      min: 0,
      max: 3,
      default: 1,
      step: 0.05,
      unit: "×",
    },
    {
      id: "attackFrequency",
      label: "Attack frequency",
      min: 0,
      max: 10,
      default: 1,
      step: 0.1,
      unit: "×",
    },
    {
      id: "maxEnemies",
      label: "Maximum active enemies",
      min: 1,
      max: ENEMY_LIMITS.population,
      default: 8,
      step: 1,
      unit: "",
    },
    {
      id: "detection",
      label: "Detection distance",
      min: 2,
      max: 4000,
      default: 60,
      log: true,
      unit: " m",
    },
    {
      id: "disengagement",
      label: "Disengagement distance",
      min: 4,
      max: 6000,
      default: 120,
      log: true,
      unit: " m",
    },
  ].map(Object.freeze),
);
export const DEFAULT_ENEMY_SETTINGS = Object.freeze(
  Object.fromEntries(ENEMY_PARAMETERS.map((p) => [p.id, p.default])),
);
export function sanitizeEnemySettings(values = {}) {
  const result = {};
  for (const p of ENEMY_PARAMETERS) {
    const n = values?.[p.id];
    result[p.id] =
      typeof n === "number" && Number.isFinite(n)
        ? Math.max(p.min, Math.min(p.max, n))
        : p.default;
  }
  result.maxEnemies = Math.round(result.maxEnemies);
  result.disengagement = Math.max(result.detection + 2, result.disengagement);
  return Object.freeze(result);
}
export const ENEMY_PRESETS = Object.freeze({
  Normal: DEFAULT_ENEMY_SETTINGS,
  Slow: sanitizeEnemySettings({
    speed: 0.5,
    acceleration: 0.7,
    aggression: 0.4,
    attackFrequency: 0.5,
    maxEnemies: 3,
  }),
  Relentless: sanitizeEnemySettings({
    speed: 20,
    acceleration: 3,
    aggression: 2.5,
    attackFrequency: 2,
    maxEnemies: 24,
    detection: 2000,
    disengagement: 3000,
  }),
});
export function loadEnemySettings(storage) {
  try {
    const saved = JSON.parse(storage?.getItem(ENEMY_SETTINGS_KEY) ?? "null");
    return saved?.version === 1 &&
      saved.values &&
      typeof saved.values === "object"
      ? sanitizeEnemySettings(saved.values)
      : null;
  } catch {
    return null;
  }
}
export function saveEnemySettings(storage, values) {
  try {
    if (!storage) return false;
    storage.setItem(
      ENEMY_SETTINGS_KEY,
      JSON.stringify({ version: 1, values: sanitizeEnemySettings(values) }),
    );
    return true;
  } catch {
    return false;
  }
}
