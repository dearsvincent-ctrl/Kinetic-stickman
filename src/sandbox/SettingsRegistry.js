import {
  SANDBOX_PARAMETERS,
  NORMAL_PHYSICS,
  SANDBOX_STORAGE_KEY,
} from "./PhysicsSandbox.js";
import {
  REACTION_PARAMETERS,
  REACTION_DEFAULTS,
  REACTION_SETTINGS_KEY,
} from "./ReactionSettings.js";
import {
  ENEMY_PARAMETERS,
  DEFAULT_ENEMY_SETTINGS,
  ENEMY_SETTINGS_KEY,
} from "./EnemySettings.js";
import {
  TAG_PARAMETERS,
  DEFAULT_TAG_SETTINGS,
  TAG_SETTINGS_KEY,
} from "./TagSettings.js";
import {
  CAMERA_PARAMETERS,
  CAMERA_DEFAULTS,
  CAMERA_SETTINGS_KEY,
} from "./CameraSettings.js";
import {
  ENEMY_ABILITY_PARAMETERS,
  ENEMY_ABILITY_TOGGLES,
  DEFAULT_ENEMY_PROFILES,
  ARCHETYPE_IDS,
} from "./EnemyAbilities.js";
import {
  FREEFLOW_PARAMETERS,
  FREEFLOW_DEFAULTS,
  FREEFLOW_SETTINGS_KEY,
} from "./FreeflowSettings.js";
import {
  ANIMATION_PARAMETERS,
  ANIMATION_DEFAULTS,
  ANIMATION_SETTINGS_KEY,
} from "./AnimationSettings.js";
import {
  SPEED_EFFECT_PARAMETERS,
  SPEED_EFFECT_DEFAULTS,
  SPEED_EFFECT_SETTINGS_KEY,
} from "./SpeedEffectsSettings.js";
import {
  AIM_ASSIST_DEFAULTS,
  AIM_ASSIST_LIMITS,
  AIM_ASSIST_STORAGE_KEY,
} from "./AimAssistSettings.js";
export const MENU_PREFERENCES_KEY = "kinetic.developer-menu.v1";
export const CATEGORIES = Object.freeze(
  [
    ["movement", "↗", "Player Movement"],
    ["parkour", "↥", "Parkour & Traversal"],
    ["combat", "⚔", "Combat & Freeflow"],
    ["reactions", "◉", "Hit Reactions & Physics"],
    ["enemies", "♟", "Enemies & AI"],
    ["camera", "◎", "Camera & Field of View"],
    ["modes", "⇄", "Game Modes"],
    ["visuals", "✦", "Visual Effects"],
    ["interface", "☷", "Controls & Interface"],
  ].map(([id, icon, name]) => Object.freeze({ id, icon, name })),
);
const catalog = new Map();
function family(prefix, name, parameters, defaults, category, persistence) {
  for (const p of parameters) {
    const cat = typeof category === "function" ? category(p) : category;
    const id = `${prefix}-${p.id}`;
    catalog.set(
      id,
      Object.freeze({
        id,
        family: name,
        key: p.id,
        name: p.label,
        category: cat,
        default: defaults[p.id],
        min: p.min,
        max: p.max,
        step: p.step,
        log: !!p.log,
        type: "range",
        persistence,
      }),
    );
  }
}
function toggle(id, family, key, name, value, category, persistence) {
  catalog.set(
    id,
    Object.freeze({
      id,
      family,
      key,
      name,
      default: value,
      category,
      type: "checkbox",
      persistence,
    }),
  );
}
family(
  "physics",
  "physics",
  SANDBOX_PARAMETERS,
  NORMAL_PHYSICS,
  (p) =>
    p.group === "combat"
      ? "combat"
      : p.group === "abilities"
        ? "parkour"
        : "movement",
  SANDBOX_STORAGE_KEY,
);
family(
  "enemy-reactions",
  "reactions",
  REACTION_PARAMETERS,
  REACTION_DEFAULTS,
  "reactions",
  REACTION_SETTINGS_KEY,
);
family(
  "enemy",
  "enemy",
  ENEMY_PARAMETERS,
  DEFAULT_ENEMY_SETTINGS,
  "enemies",
  ENEMY_SETTINGS_KEY,
);
family(
  "tag",
  "tag",
  TAG_PARAMETERS,
  DEFAULT_TAG_SETTINGS,
  "modes",
  TAG_SETTINGS_KEY,
);
family(
  "camera",
  "camera",
  CAMERA_PARAMETERS,
  CAMERA_DEFAULTS,
  "camera",
  CAMERA_SETTINGS_KEY,
);
family(
  "ability",
  "profiles",
  ENEMY_ABILITY_PARAMETERS,
  DEFAULT_ENEMY_PROFILES.standard,
  "enemies",
  "named configurations / session",
);
family(
  "freeflow-combat",
  "freeflow",
  FREEFLOW_PARAMETERS,
  FREEFLOW_DEFAULTS,
  "combat",
  FREEFLOW_SETTINGS_KEY,
);
family(
  "animation-polish",
  "animation",
  ANIMATION_PARAMETERS,
  ANIMATION_DEFAULTS,
  "visuals",
  ANIMATION_SETTINGS_KEY,
);
family(
  "speed-effects",
  "effects",
  SPEED_EFFECT_PARAMETERS,
  SPEED_EFFECT_DEFAULTS,
  "visuals",
  SPEED_EFFECT_SETTINGS_KEY,
);
family(
  "aim",
  "aim",
  [
    {
      id: "strength",
      label: "Aim assist strength",
      min: 0,
      max: 2,
      step: 0.01,
    },
    {
      id: "maxAngle",
      label: "Maximum correction angle",
      min: 0,
      max: AIM_ASSIST_LIMITS.maxAngle,
      step: 1,
    },
    {
      id: "cone",
      label: "Target acquisition half-cone",
      min: AIM_ASSIST_LIMITS.coneMin,
      max: AIM_ASSIST_LIMITS.coneMax,
      step: 1,
    },
  ],
  AIM_ASSIST_DEFAULTS,
  "combat",
  AIM_ASSIST_STORAGE_KEY,
);
for (const [id, fam, key, label, def, cat, store] of [
  [
    "aim-debug",
    "aim",
    "debug",
    "Show target and strike paths",
    false,
    "combat",
    AIM_ASSIST_STORAGE_KEY,
  ],
  [
    "enemy-reactions-ragdollEnabled",
    "reactions",
    "ragdollEnabled",
    "Selective ragdoll enabled",
    true,
    "reactions",
    REACTION_SETTINGS_KEY,
  ],
  [
    "camera-dynamicFov",
    "camera",
    "dynamicFov",
    "Dynamic field of view",
    false,
    "camera",
    CAMERA_SETTINGS_KEY,
  ],
  [
    "freeflow-combat-enabled",
    "freeflow",
    "enabled",
    "Attack-driven freeflow enabled",
    true,
    "combat",
    FREEFLOW_SETTINGS_KEY,
  ],
  ...[
    ["sonicEnabled", "Sonic pressure wave enabled"],
    ["shakeEnabled", "Brief sonic camera impact"],
    ["nearMissEnabled", "Combat near-miss stagger"],
  ].map(([key, label]) => [
    `speed-effects-${key}`,
    "effects",
    key,
    label,
    SPEED_EFFECT_DEFAULTS[key],
    "visuals",
    SPEED_EFFECT_SETTINGS_KEY,
  ]),
  ...ENEMY_ABILITY_TOGGLES.map((p) => [
    `ability-${p.id}`,
    "profiles",
    p.id,
    p.label,
    DEFAULT_ENEMY_PROFILES.standard[p.id],
    "enemies",
    "named configurations / session",
  ]),
])
  toggle(id, fam, key, label, def, cat, store);
for (const mode of ["combat", "tag"]) {
  const category = mode === "tag" ? "modes" : "enemies";
  toggle(
    `${mode}-roster-custom`,
    "rosters",
    mode,
    "Use custom archetype group",
    false,
    category,
    "named configurations / session",
  );
  for (const id of ARCHETYPE_IDS) {
    toggle(
      `${mode}-roster-${id}-enabled`,
      "rosters",
      `${mode}.${id}.enabled`,
      `${mode} ${DEFAULT_ENEMY_PROFILES[id].name} enabled`,
      id === "standard",
      category,
      "named configurations / session",
    );
    const key = `${mode}-roster-${id}-count`;
    catalog.set(
      key,
      Object.freeze({
        id: key,
        family: "rosters",
        key: `${mode}.${id}`,
        name: `${mode} ${DEFAULT_ENEMY_PROFILES[id].name} count`,
        category,
        type: "range",
        min: 1,
        max: 64,
        step: 1,
        default: id === "standard" ? 3 : 1,
        persistence: "named configurations / session",
      }),
    );
  }
}
for (const [id, name, category, context, def] of [
  [
    "camera-profile",
    "Camera gameplay profile to edit",
    "camera",
    true,
    "combat",
  ],
  ["camera-mode", "Camera assistance mode", "camera", false, "manual"],
  [
    "enemy-profile-select",
    "Enemy archetype to edit",
    "enemies",
    true,
    "standard",
  ],
])
  catalog.set(
    id,
    Object.freeze({
      id,
      name,
      category,
      type: "select",
      family: context ? "context" : "camera",
      key: "mode",
      context,
      default: def,
      persistence: context ? "interface only" : CAMERA_SETTINGS_KEY,
    }),
  );
// Contextual widgets retain each archetype's own baseline, not just Standard.
for (const p of [...ENEMY_ABILITY_PARAMETERS, ...ENEMY_ABILITY_TOGGLES]) {
  const id = `ability-${p.id}`,
    entry = catalog.get(id);
  catalog.set(
    id,
    Object.freeze({
      ...entry,
      contextId: "enemy-profile-select",
      contextDefaults: Object.freeze(
        Object.fromEntries(
          ARCHETYPE_IDS.map((profile) => [
            profile,
            DEFAULT_ENEMY_PROFILES[profile][p.id],
          ]),
        ),
      ),
    }),
  );
}
export const SETTING_CATALOG = catalog;
export class SettingsRegistry {
  constructor() {
    this.entries = new Map();
  }
  register(definition) {
    if (!definition?.id || !definition.name)
      throw new Error("A setting needs a stable id and display name");
    if (!CATEGORIES.some((c) => c.id === definition.category))
      throw new Error(`Unknown settings category: ${definition.category}`);
    if (this.entries.has(definition.id)) return this.entries.get(definition.id);
    const entry = { ...definition };
    this.entries.set(entry.id, entry);
    return entry;
  }
  search(query) {
    const words = String(query)
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);
    return [...this.entries.values()].filter((e) =>
      words.every((w) =>
        `${e.name} ${e.path ?? ""} ${e.id}`.toLowerCase().includes(w),
      ),
    );
  }
}
export function loadMenuPreferences(storage) {
  try {
    const data = JSON.parse(storage?.getItem(MENU_PREFERENCES_KEY) ?? "null");
    if (data?.version !== 1) return { open: [], favourites: [] };
    const strings = (v) =>
      Array.isArray(v)
        ? [
            ...new Set(
              v.filter((x) => typeof x === "string" && x.length < 160),
            ),
          ].slice(0, 512)
        : [];
    return { open: strings(data.open), favourites: strings(data.favourites) };
  } catch {
    return { open: [], favourites: [] };
  }
}
export function saveMenuPreferences(storage, values) {
  try {
    if (!storage) return false;
    storage.setItem(
      MENU_PREFERENCES_KEY,
      JSON.stringify({
        version: 1,
        open: [...values.open],
        favourites: [...values.favourites],
      }),
    );
    return true;
  } catch {
    return false;
  }
}
