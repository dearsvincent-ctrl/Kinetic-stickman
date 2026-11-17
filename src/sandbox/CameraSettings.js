// Camera preferences are independent of developer physics, enemy AI and HUD
// saves. Both gameplay profiles are available outside the developer sandbox.
export const CAMERA_SETTINGS_KEY = "kinetic.camera-settings.v1";
export const CAMERA_PARAMETERS = Object.freeze(
  [
    {
      id: "baseFov",
      label: "Base field of view",
      default: 52,
      min: 50,
      max: 120,
      step: 1,
      unit: "°",
    },
    {
      id: "maxFov",
      label: "Maximum dynamic FOV",
      default: 105,
      min: 50,
      max: 120,
      step: 1,
      unit: "°",
    },
    {
      id: "sensitivity",
      label: "Dynamic FOV speed sensitivity",
      default: 1,
      min: 0.1,
      max: 4,
      log: true,
      unit: "×",
    },
    {
      id: "smoothness",
      label: "FOV transition smoothness",
      default: 0.35,
      min: 0.05,
      max: 3,
      log: true,
      unit: " s",
    },
    {
      id: "awareness",
      label: "Camera awareness distance",
      default: 90,
      min: 2,
      max: 2000,
      log: true,
      unit: " m",
    },
    {
      id: "strength",
      label: "Assistance strength",
      default: 0.35,
      min: 0,
      max: 1,
      step: 0.05,
      unit: "",
    },
    {
      id: "overrideDelay",
      label: "Manual override delay",
      default: 1.25,
      min: 0,
      max: 5,
      step: 0.05,
      unit: " s",
    },
  ].map(Object.freeze),
);
export const CAMERA_DEFAULTS = Object.freeze({
  mode: "manual",
  dynamicFov: false,
  ...Object.fromEntries(CAMERA_PARAMETERS.map((p) => [p.id, p.default])),
});
const profileId = (mode) => (mode === "tag" ? "tag" : "combat");
const isRecord = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

export function sanitizeCameraSettings(values = {}) {
  const settings = {
    mode: ["manual", "assisted", "dynamic"].includes(values?.mode)
      ? values.mode
      : CAMERA_DEFAULTS.mode,
    dynamicFov: values?.dynamicFov === true,
  };
  for (const p of CAMERA_PARAMETERS) {
    const value = values?.[p.id];
    settings[p.id] = Number.isFinite(value)
      ? Math.max(p.min, Math.min(p.max, value))
      : p.default;
  }
  settings.maxFov = Math.max(settings.baseFov, settings.maxFov);
  return Object.freeze(settings);
}

/** Each profile is immutable; updates replace only the selected profile and
 * automatically persist a complete, versioned snapshot when storage works. */
export class CameraPreferences {
  constructor(storage) {
    this.storage = storage ?? null;
    this.lastSaveSucceeded = null;
    let saved;
    try {
      const data = JSON.parse(
        this.storage?.getItem(CAMERA_SETTINGS_KEY) ?? "null",
      );
      if (data?.version === 1 && isRecord(data.values)) saved = data.values;
    } catch {
      // Corrupt or blocked storage leaves both usable default profiles live.
    }
    this.values = Object.freeze({
      combat: sanitizeCameraSettings(
        isRecord(saved?.combat) ? saved.combat : {},
      ),
      tag: sanitizeCameraSettings(isRecord(saved?.tag) ? saved.tag : {}),
    });
  }

  get(mode) {
    return this.values[profileId(mode)];
  }

  update(mode, partial) {
    const id = profileId(mode);
    const settings = sanitizeCameraSettings({
      ...this.values[id],
      ...(isRecord(partial) ? partial : {}),
    });
    this.values = Object.freeze({ ...this.values, [id]: settings });
    this.save();
    return settings;
  }

  reset(mode) {
    const id = profileId(mode);
    this.values = Object.freeze({ ...this.values, [id]: CAMERA_DEFAULTS });
    this.save();
    return this.values[id];
  }

  save() {
    try {
      if (!this.storage) return (this.lastSaveSucceeded = false);
      this.storage.setItem(
        CAMERA_SETTINGS_KEY,
        JSON.stringify({ version: 1, values: this.values }),
      );
      return (this.lastSaveSucceeded = true);
    } catch {
      return (this.lastSaveSucceeded = false);
    }
  }
}
