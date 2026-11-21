import { ENEMY_LIMITS } from "./EnemySettings.js";

/** Enemy-only physical tuning. Profiles are plain data so a future custom-save
 * format need not serialize controllers, animation state or navigation routes. */
export const ARCHETYPE_IDS = Object.freeze([
  "standard",
  "acrobat",
  "leaper",
  "heavy",
]);

export const ENEMY_ABILITY_PARAMETERS = Object.freeze(
  [
    {
      id: "mass",
      label: "Body mass",
      min: 0.25,
      max: 20,
      default: 1,
      step: 0.05,
      unit: "×",
    },
    {
      id: "balance",
      label: "Balance / stagger resistance",
      min: 0.25,
      max: 8,
      default: 1,
      step: 0.05,
      unit: "×",
    },
    {
      id: "recovery",
      label: "Hit recovery speed",
      min: 0.25,
      max: 8,
      default: 1,
      step: 0.05,
      unit: "×",
    },

    {
      id: "runSpeed",
      label: "Maximum running speed",
      min: 0.5,
      max: 100,
      default: 3.6,
      log: true,
      unit: " m/s",
    },
    {
      id: "acceleration",
      label: "Acceleration response",
      min: 0.1,
      max: 1000,
      default: 11,
      log: true,
      unit: " /s",
    },
    {
      id: "deceleration",
      label: "Deceleration response",
      min: 0.1,
      max: 1000,
      default: 15,
      log: true,
      unit: " /s",
    },
    {
      id: "turnRate",
      label: "Turning responsiveness",
      min: 1,
      max: 40,
      default: 6,
      step: 0.5,
      unit: " rad/s",
    },
    {
      id: "jumpHeight",
      label: "Jump height",
      min: 0.2,
      max: 500,
      default: 0.8,
      log: true,
      unit: " m",
    },
    {
      id: "maxJumps",
      label: "Maximum jump count",
      min: 1,
      max: 4,
      default: 1,
      step: 1,
      unit: "",
    },
    {
      id: "airControl",
      label: "Air steering",
      min: 0.1,
      max: 100,
      default: 3.5,
      log: true,
      unit: " /s",
    },
    {
      id: "aerialControl",
      label: "Aerial manoeuvrability",
      min: 0.25,
      max: 8,
      default: 1,
      step: 0.05,
      unit: "×",
    },
    {
      id: "climbSpeed",
      label: "Climbing speed",
      min: 1,
      max: 300,
      default: 3.6,
      log: true,
      unit: " m/s",
    },
    {
      id: "jumpInterval",
      label: "Jump decision interval",
      min: 0.5,
      max: 12,
      default: 3,
      step: 0.1,
      unit: " s",
    },
    {
      id: "damage",
      label: "Attack damage",
      min: 0,
      max: 100,
      default: 1,
      step: 0.1,
      unit: "×",
    },
    {
      id: "knockbackResistance",
      label: "Knockback resistance",
      min: 0.1,
      max: 100,
      default: 1,
      log: true,
      unit: "×",
    },
  ].map(Object.freeze),
);

export const ENEMY_ABILITY_TOGGLES = Object.freeze(
  [
    { id: "wallRun", label: "Wall running" },
    { id: "climb", label: "Wall and pole climbing" },
    { id: "ledgeGrab", label: "Ledge grabbing" },
    { id: "rooftop", label: "Rooftop transitions" },
  ].map(Object.freeze),
);

const STANDARD = {
  mass: 1,
  balance: 1,
  recovery: 1,
  runSpeed: 3.6,
  acceleration: 11,
  deceleration: 15,
  turnRate: 6,
  jumpHeight: 0.8,
  maxJumps: 1,
  airControl: 3.5,
  aerialControl: 1,
  climbSpeed: 3.6,
  jumpInterval: 3,
  wallRun: false,
  climb: false,
  ledgeGrab: false,
  rooftop: false,
  damage: 1,
  knockbackResistance: 1,
};
const BASE_PROFILES = {
  standard: { ...STANDARD, id: "standard", name: "Standard", color: 0xb85f51 },
  acrobat: {
    ...STANDARD,
    id: "acrobat",
    name: "Acrobat",
    balance: 1.6,
    recovery: 1.5,
    color: 0x56a7a2,
    runSpeed: 5.4,
    acceleration: 16,
    deceleration: 19,
    turnRate: 11,
    jumpHeight: 2,
    maxJumps: 2,
    airControl: 8,
    aerialControl: 1.4,
    climbSpeed: 7,
    jumpInterval: 2,
    wallRun: true,
    climb: true,
    ledgeGrab: true,
    rooftop: true,
  },
  leaper: {
    ...STANDARD,
    id: "leaper",
    name: "Leaper",
    balance: 1.25,
    recovery: 1.35,
    color: 0xd4a844,
    runSpeed: 14,
    acceleration: 32,
    deceleration: 28,
    turnRate: 14,
    jumpHeight: 80,
    maxJumps: 2,
    airControl: 16,
    aerialControl: 2,
    climbSpeed: 35,
    jumpInterval: 1.5,
    wallRun: true,
    climb: true,
    ledgeGrab: true,
    rooftop: true,
  },
  heavy: {
    ...STANDARD,
    id: "heavy",
    name: "Heavy",
    mass: 2.5,
    balance: 1.8,
    recovery: 0.8,
    color: 0x8c7db2,
    runSpeed: 2.6,
    acceleration: 7,
    deceleration: 11,
    turnRate: 4,
    jumpHeight: 3,
    airControl: 2,
    aerialControl: 0.8,
    jumpInterval: 6,
    damage: 1.8,
    knockbackResistance: 4,
  },
};

export function sanitizeEnemyProfile(id, values = {}) {
  const key = ARCHETYPE_IDS.includes(id) ? id : "standard";
  const base = BASE_PROFILES[key];
  const result = { id: key, name: base.name, color: base.color };
  for (const p of ENEMY_ABILITY_PARAMETERS) {
    const n = values?.[p.id];
    result[p.id] =
      typeof n === "number" && Number.isFinite(n)
        ? Math.max(p.min, Math.min(p.max, n))
        : base[p.id];
  }
  result.maxJumps = Math.round(result.maxJumps);
  for (const p of ENEMY_ABILITY_TOGGLES)
    result[p.id] =
      typeof values?.[p.id] === "boolean" ? values[p.id] : base[p.id];
  return Object.freeze(result);
}

export const DEFAULT_ENEMY_PROFILES = Object.freeze(
  Object.fromEntries(ARCHETYPE_IDS.map((id) => [id, sanitizeEnemyProfile(id)])),
);

/** Null retains legacy waves/global population; an empty custom roster is
 * deliberately empty. Requested totals are not silently rewritten to a cap. */
export function sanitizeRoster(values) {
  if (values === null) return null;
  const result = {};
  for (const id of ARCHETYPE_IDS) {
    const n = values?.[id];
    result[id] =
      typeof n === "number" && Number.isFinite(n)
        ? Math.round(Math.max(0, Math.min(ENEMY_LIMITS.population, n)))
        : 0;
  }
  return Object.freeze(result);
}

export function rosterCount(counts) {
  if (!counts) return 0;
  let count = 0;
  for (const id of ARCHETYPE_IDS) {
    const n = counts[id];
    if (typeof n === "number" && Number.isFinite(n))
      count += Math.round(Math.max(0, Math.min(ENEMY_LIMITS.population, n)));
  }
  return count;
}

/** Stable round-robin keeps enabled types represented when the global cap is
 * smaller than the request. A full cycle honours each type's requested count. */
export function rosterProfileAt(counts, slot) {
  if (counts === null) return "standard";
  const total = rosterCount(counts);
  if (total === 0 || !Number.isFinite(slot) || slot < 0) return null;
  let remaining = Math.floor(slot) % total;
  for (let round = 0; round < ENEMY_LIMITS.population; round++)
    for (const id of ARCHETYPE_IDS) {
      const n = counts[id];
      const count =
        typeof n === "number" && Number.isFinite(n)
          ? Math.round(Math.max(0, Math.min(ENEMY_LIMITS.population, n)))
          : 0;
      if (count <= round) continue;
      if (remaining-- === 0) return id;
    }
  return null;
}
