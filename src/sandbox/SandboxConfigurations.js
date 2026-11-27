import { NORMAL_PHYSICS, sanitizePhysics } from "./PhysicsSandbox.js";
import { AIM_ASSIST_DEFAULTS, sanitizeAimAssist } from "./AimAssistSettings.js";
import {
  DEFAULT_ENEMY_SETTINGS,
  sanitizeEnemySettings,
} from "./EnemySettings.js";
import { DEFAULT_TAG_SETTINGS, sanitizeTagSettings } from "./TagSettings.js";
import {
  DEFAULT_ENEMY_PROFILES,
  ARCHETYPE_IDS,
  sanitizeEnemyProfile,
  sanitizeRoster,
} from "./EnemyAbilities.js";
import { CAMERA_DEFAULTS, sanitizeCameraSettings } from "./CameraSettings.js";
import { REACTION_DEFAULTS, sanitizeReactions } from "./ReactionSettings.js";
import {
  SPEED_EFFECT_DEFAULTS,
  sanitizeSpeedEffectSettings,
} from "./SpeedEffectsSettings.js";
import {
  FREEFLOW_DEFAULTS,
  sanitizeFreeflowSettings,
} from "./FreeflowSettings.js";
import {
  ANIMATION_DEFAULTS,
  sanitizeAnimationSettings,
} from "./AnimationSettings.js";
export const CONFIGURATIONS_KEY = "kinetic.sandbox-configurations.v1";
const record = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const clone = (v) => JSON.parse(JSON.stringify(v));
export const CONFIG_DEFAULTS = Object.freeze({
  physics: NORMAL_PHYSICS,
  aim: AIM_ASSIST_DEFAULTS,
  enemy: DEFAULT_ENEMY_SETTINGS,
  tag: DEFAULT_TAG_SETTINGS,
  profiles: DEFAULT_ENEMY_PROFILES,
  rosters: { combat: null, tag: null },
  camera: { combat: CAMERA_DEFAULTS, tag: CAMERA_DEFAULTS },
  reactions: REACTION_DEFAULTS,
  effects: SPEED_EFFECT_DEFAULTS,
  freeflow: FREEFLOW_DEFAULTS,
  animation: ANIMATION_DEFAULTS,
});
/** Missing v1 fields gain safe current defaults. Unknown future versions fail
 * before applying anything. UI layout/locks/favourites are never part of a build. */
export function normalizeConfiguration(snapshot) {
  if (!record(snapshot) || snapshot.version !== 1 || !record(snapshot.values))
    throw new Error("Unsupported or invalid sandbox configuration");
  const v = snapshot.values;
  const values = {};
  for (const [key, fn] of Object.entries({
    physics: sanitizePhysics,
    aim: sanitizeAimAssist,
    enemy: sanitizeEnemySettings,
    tag: sanitizeTagSettings,
    reactions: sanitizeReactions,
    effects: sanitizeSpeedEffectSettings,
    freeflow: sanitizeFreeflowSettings,
    animation: sanitizeAnimationSettings,
  }))
    values[key] = fn(record(v[key]) ? v[key] : {});
  values.profiles = Object.fromEntries(
    ARCHETYPE_IDS.map((id) => [
      id,
      sanitizeEnemyProfile(id, record(v.profiles?.[id]) ? v.profiles[id] : {}),
    ]),
  );
  values.rosters = Object.fromEntries(
    ["combat", "tag"].map((mode) => [
      mode,
      record(v.rosters?.[mode]) ? sanitizeRoster(v.rosters[mode]) : null,
    ]),
  );
  values.camera = Object.fromEntries(
    ["combat", "tag"].map((mode) => [
      mode,
      sanitizeCameraSettings(record(v.camera?.[mode]) ? v.camera[mode] : {}),
    ]),
  );
  const extras = {};
  for (const [id, value] of Object.entries(
    record(v.extras) ? v.extras : {},
  ).slice(0, 512))
    if (
      id.length < 160 &&
      (typeof value === "boolean" ||
        (typeof value === "string" && value.length < 128) ||
        (typeof value === "number" && Number.isFinite(value)))
    )
      extras[id] = value;
  values.enemyPopulationOverride = Number.isInteger(v.enemyPopulationOverride)
    ? Math.max(1, Math.min(64, v.enemyPopulationOverride))
    : null;
  values.extras = extras;
  return { version: 1, values };
}
function nameText(name) {
  const s = String(name ?? "")
    .trim()
    .replace(/\s+/g, " ");
  if (!s || s.length > 64)
    throw new Error("Enter a configuration name of 1–64 characters");
  return s;
}
export class SandboxConfigurations {
  constructor(storage) {
    this.storage = storage;
    this.items = [];
    this.lastSaveSucceeded = true;
    this.nextId = 0;
    try {
      const data = JSON.parse(storage?.getItem(CONFIGURATIONS_KEY) ?? "null");
      if (data?.version === 1 && Array.isArray(data.items))
        for (const item of data.items.slice(0, 64)) {
          try {
            if (
              !record(item) ||
              typeof item.id !== "string" ||
              item.id.length > 128 ||
              this.items.some((x) => x.id === item.id)
            )
              continue;
            const name = nameText(item.name);
            if (
              this.items.some(
                (x) => x.name.toLowerCase() === name.toLowerCase(),
              )
            )
              continue;
            this.items.push({
              id: item.id,
              name,
              snapshot: normalizeConfiguration(item.snapshot),
            });
          } catch {
            /* One corrupt slot does not erase other saved builds. */
          }
        }
    } catch {
      /* Storage denial or corruption keeps the live sandbox usable. */
    }
  }
  get(id) {
    const x = this.items.find((x) => x.id === id);
    if (!x) throw new Error("Select a saved configuration");
    return x;
  }
  unique(name, except = null) {
    const text = nameText(name);
    if (
      this.items.some(
        (x) => x.id !== except && x.name.toLowerCase() === text.toLowerCase(),
      )
    )
      throw new Error(
        "That name already exists. Use Overwrite selected explicitly.",
      );
    return text;
  }
  persist() {
    try {
      if (!this.storage) return (this.lastSaveSucceeded = false);
      this.storage.setItem(
        CONFIGURATIONS_KEY,
        JSON.stringify({ version: 1, items: this.items }),
      );
      return (this.lastSaveSucceeded = true);
    } catch {
      return (this.lastSaveSucceeded = false);
    }
  }
  save(name, snapshot) {
    const text = this.unique(name),
      normalized = normalizeConfiguration(snapshot);
    if (this.items.length >= 64)
      throw new Error(
        "64 saved builds: delete an unused build before adding another",
      );
    let id;
    do {
      id = `build-${Date.now().toString(36)}-${++this.nextId}`;
    } while (this.items.some((x) => x.id === id));
    this.items.push({ id, name: text, snapshot: normalized });
    this.persist();
    return id;
  }
  load(id) {
    return clone(this.get(id).snapshot);
  }
  overwrite(id, snapshot) {
    const item = this.get(id),
      normalized = normalizeConfiguration(snapshot);
    item.snapshot = normalized;
    this.persist();
  }
  rename(id, name) {
    const item = this.get(id),
      text = this.unique(name, id);
    item.name = text;
    this.persist();
  }
  duplicate(id, name) {
    const item = this.get(id);
    return this.save(name, item.snapshot);
  }
  delete(id) {
    this.get(id);
    this.items = this.items.filter((x) => x.id !== id);
    this.persist();
  }
}
