import { ENEMY_LIMITS } from "./EnemySettings.js";

// Tag tuning has its own saved configuration. It never modifies pursuit,
// player physics, aim assistance, damage or the saved Combat Mode settings.
export const TAG_SETTINGS_KEY = "kinetic.tag-settings.v1";
export const TAG_PARAMETERS = Object.freeze(
  [
    {
      id: "speed",
      label: "Escape speed",
      min: 0.25,
      max: 100,
      default: 1,
      log: true,
      unit: "×",
    },
    {
      id: "acceleration",
      label: "Escape acceleration",
      min: 0.1,
      max: 100,
      default: 1,
      log: true,
      unit: "×",
    },
    {
      id: "intelligence",
      label: "Evasion intelligence",
      min: 0,
      max: 2,
      default: 1,
      step: 1,
      unit: "",
    },
    {
      id: "maxEnemies",
      label: "Fleeing characters",
      min: 1,
      max: ENEMY_LIMITS.population,
      default: 3,
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
      id: "tagRadius",
      label: "Tag radius",
      min: 0.75,
      max: 3,
      default: 0.85,
      step: 0.05,
      unit: " m",
    },
  ].map(Object.freeze),
);
export const DEFAULT_TAG_SETTINGS = Object.freeze(
  Object.fromEntries(TAG_PARAMETERS.map((p) => [p.id, p.default])),
);
export function sanitizeTagSettings(values = {}) {
  const result = {};
  for (const p of TAG_PARAMETERS) {
    const n = values?.[p.id];
    result[p.id] =
      typeof n === "number" && Number.isFinite(n)
        ? Math.max(p.min, Math.min(p.max, n))
        : p.default;
  }
  result.intelligence = Math.round(result.intelligence);
  result.maxEnemies = Math.round(result.maxEnemies);
  return Object.freeze(result);
}
export function loadTagSettings(storage) {
  try {
    const saved = JSON.parse(storage?.getItem(TAG_SETTINGS_KEY) ?? "null");
    return saved?.version === 1 &&
      saved.values &&
      typeof saved.values === "object"
      ? sanitizeTagSettings(saved.values)
      : null;
  } catch {
    return null;
  }
}
export function saveTagSettings(storage, values) {
  try {
    if (!storage) return false;
    storage.setItem(
      TAG_SETTINGS_KEY,
      JSON.stringify({ version: 1, values: sanitizeTagSettings(values) }),
    );
    return true;
  } catch {
    return false;
  }
}
