// Speed feedback has its own versioned preference. Keep the v1 key/schema so
// existing dust/sonic choices gain the newer controls with their defaults.
export const SPEED_EFFECT_SETTINGS_KEY = "kinetic.speed-effects.v1";
export const SPEED_EFFECT_PARAMETERS = Object.freeze(
  [
    {
      id: "dustSpeed",
      label: "Dust speed threshold",
      min: 1,
      max: 1000,
      default: 8,
      log: true,
      unit: " m/s",
    },
    {
      id: "dustIntensity",
      label: "Dust intensity",
      min: 0,
      max: 3,
      default: 1,
      step: 0.05,
      unit: "×",
    },
    {
      id: "dustDensity",
      label: "Dust density",
      min: 0,
      max: 2,
      default: 1,
      step: 0.05,
      unit: "×",
    },
    {
      id: "sonicSpeed",
      label: "Sonic speed threshold",
      min: 5,
      max: 1200,
      default: 40,
      log: true,
      unit: " m/s",
    },
    {
      id: "sonicIntensity",
      label: "Sonic intensity",
      min: 0,
      max: 3,
      default: 1,
      step: 0.05,
      unit: "×",
    },
    {
      id: "shockwaveSize",
      label: "Shockwave size",
      min: 2,
      max: 100,
      default: 18,
      step: 0.5,
      unit: " m",
    },
    {
      id: "shakeStrength",
      label: "Boom shake strength",
      min: 0,
      max: 2,
      default: 0.8,
      step: 0.05,
      unit: "×",
    },
    {
      id: "shakeDuration",
      label: "Boom shake duration",
      min: 0.05,
      max: 0.65,
      default: 0.22,
      step: 0.01,
      unit: " s",
    },
    {
      id: "nearMissRadius",
      label: "Near-miss radius",
      min: 0.7,
      max: 12,
      default: 2.4,
      step: 0.1,
      unit: " m",
    },
    {
      id: "nearMissSpeed",
      label: "Near-miss speed threshold",
      min: 5,
      max: 1000,
      default: 20,
      log: true,
      unit: " m/s",
    },
    {
      id: "impactStrength",
      label: "Speed impact strength",
      min: 0,
      max: 20,
      default: 1,
      step: 0.05,
      unit: "×",
    },
    {
      id: "impactSpeed",
      label: "Speed impact threshold",
      min: 5,
      max: 1200,
      default: 25,
      log: true,
      unit: " m/s",
    },
  ].map(Object.freeze),
);

export const SPEED_EFFECT_DEFAULTS = Object.freeze({
  sonicEnabled: true,
  shakeEnabled: true,
  nearMissEnabled: true,
  ...Object.fromEntries(SPEED_EFFECT_PARAMETERS.map((p) => [p.id, p.default])),
});

export function sanitizeSpeedEffectSettings(values = {}) {
  const settings = {
    sonicEnabled:
      typeof values?.sonicEnabled === "boolean"
        ? values.sonicEnabled
        : SPEED_EFFECT_DEFAULTS.sonicEnabled,
    shakeEnabled:
      typeof values?.shakeEnabled === "boolean"
        ? values.shakeEnabled
        : SPEED_EFFECT_DEFAULTS.shakeEnabled,
    nearMissEnabled:
      typeof values?.nearMissEnabled === "boolean"
        ? values.nearMissEnabled
        : SPEED_EFFECT_DEFAULTS.nearMissEnabled,
  };
  for (const p of SPEED_EFFECT_PARAMETERS) {
    const value = values?.[p.id];
    settings[p.id] = Number.isFinite(value)
      ? Math.max(p.min, Math.min(p.max, value))
      : p.default;
  }
  return Object.freeze(settings);
}

export function loadSpeedEffectSettings(storage) {
  try {
    const saved = JSON.parse(
      storage?.getItem(SPEED_EFFECT_SETTINGS_KEY) ?? "null",
    );
    return saved?.version === 1 &&
      saved.values !== null &&
      typeof saved.values === "object" &&
      !Array.isArray(saved.values)
      ? sanitizeSpeedEffectSettings(saved.values)
      : null;
  } catch {
    return null;
  }
}

export function saveSpeedEffectSettings(storage, values) {
  try {
    if (!storage) return false;
    storage.setItem(
      SPEED_EFFECT_SETTINGS_KEY,
      JSON.stringify({
        version: 1,
        values: sanitizeSpeedEffectSettings(values),
      }),
    );
    return true;
  } catch {
    return false;
  }
}
