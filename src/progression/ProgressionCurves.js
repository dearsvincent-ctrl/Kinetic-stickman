import { STATISTICS, ABILITIES, ECONOMY } from "./ProgressionCatalog.js";
export const CURVE_TYPES = Object.freeze([
  "diminishing",
  "linear",
  "accelerating",
  "compounded",
]);
export const CURVE_LIMITS = Object.freeze({
  maxAttribute: 100,
  maxMultiplier: 100,
  minMultiplier: 0.1,
});
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const number = (v, lo, hi, fallback) =>
  typeof v === "number" && Number.isFinite(v)
    ? clamp(v, lo, hi)
    : clamp(fallback, lo, hi);
const copy = (v) => JSON.parse(JSON.stringify(v));
export const REFERENCE_RULES = Object.freeze({
  version: 1,
  name: "v0.9.2 reference",
  stats: Object.fromEntries(
    STATISTICS.map((d) => [
      d.id,
      {
        base: d.base,
        type: "diminishing",
        rate: d.gain,
        scale: 5,
        power: 2,
        threshold: 100,
        postThresholdRate: 1,
        maxAttribute: d.maxLevel + 1,
        maxGameplay: d.base * 100,
        costBase: d.costBase,
        costGrowth: d.costGrowth,
        costPower: 1,
      },
    ]),
  ),
  startingAttributes: Object.fromEntries(STATISTICS.map((d) => [d.id, 1])),
  economy: { ...ECONOMY },
  abilities: Object.fromEntries(
    ABILITIES.map((a) => [
      a.id,
      {
        enabled: true,
        level: a.level ?? 1,
        cost: a.cost ?? 0,
        attributes: Object.fromEntries(
          Object.entries(a.stats ?? {}).map(([id, n]) => [id, n + 1]),
        ),
        abilities: [...(a.abilities ?? [])],
      },
    ]),
  ),
});
export const gameplayBounds = (d) => ({
  min: d.base * 0.1,
  max:
    d.base *
    (d.id === "balance" ? 10 : d.id === "rotationalControl" ? 60 / 26 : 100),
});
export function sanitizeRules(raw = {}) {
  raw = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const result = copy(REFERENCE_RULES);
  result.name =
    typeof raw.name === "string"
      ? raw.name.trim().slice(0, 64) || result.name
      : result.name;
  for (const d of STATISTICS) {
    const v = raw.stats?.[d.id] ?? {},
      o = result.stats[d.id];
    const bounds = gameplayBounds(d);
    o.base = number(v.base, bounds.min, bounds.max, o.base);
    o.type = CURVE_TYPES.includes(v.type) ? v.type : o.type;
    for (const [key, min, max] of [
      ["rate", 0, 10],
      ["scale", 0.1, 100],
      ["power", 1, 4],
      ["threshold", 1, 100],
      ["postThresholdRate", 0, 2],
      ["maxAttribute", 1, 100],
      ["maxGameplay", bounds.min, bounds.max],
      ["costBase", 1, 1000],
      ["costGrowth", 0, 100],
      ["costPower", 1, 3],
    ])
      o[key] = number(v[key], min, max, o[key]);
    o.maxAttribute = Math.floor(o.maxAttribute);
    o.threshold = Math.floor(o.threshold);
    o.maxGameplay = Math.max(o.base, o.maxGameplay);
  }
  for (const d of STATISTICS)
    result.startingAttributes[d.id] = Math.floor(
      number(
        raw.startingAttributes?.[d.id],
        1,
        result.stats[d.id].maxAttribute,
        1,
      ),
    );
  for (const [key, min, max] of [
    ["maxLevel", 1, 100],
    ["startingPoints", 0, 10000],
    ["pointsPerLevel", 0, 1000],
    ["experienceBase", 1, 100000],
    ["experienceGrowth", 0, 100000],
    ["defeatExperience", 0, 100000],
    ["tagExperience", 0, 100000],
  ])
    result.economy[key] = Math.floor(
      number(raw.economy?.[key], min, max, result.economy[key]),
    );
  for (const a of ABILITIES) {
    const v = raw.abilities?.[a.id] ?? {},
      o = result.abilities[a.id];
    o.enabled = a.baseline
      ? true
      : typeof v.enabled === "boolean"
        ? v.enabled
        : true;
    o.level = Math.floor(number(v.level, 1, 100, o.level));
    o.cost = Math.floor(number(v.cost, 0, 10000, o.cost));
    if (v.attributes && typeof v.attributes === "object") {
      o.attributes = {};
      for (const d of STATISTICS)
        if (Object.hasOwn(v.attributes, d.id))
          o.attributes[d.id] = Math.floor(
            number(v.attributes[d.id], 1, 100, 1),
          );
    }
    if (Array.isArray(v.abilities))
      o.abilities = [
        ...new Set(
          v.abilities.filter(
            (id) => id !== a.id && ABILITIES.some((x) => x.id === id),
          ),
        ),
      ];
  }
  const reaches = (from, target, seen = new Set()) => {
    if (from === target) return true;
    if (seen.has(from)) return false;
    seen.add(from);
    return (result.abilities[from]?.abilities ?? []).some((id) =>
      reaches(id, target, seen),
    );
  };
  for (const a of ABILITIES)
    result.abilities[a.id].abilities = result.abilities[a.id].abilities.filter(
      (id) => !reaches(id, a.id),
    );
  return result;
}
/** Rank is purchased increments. Attribute = rank + 1. No gameplay module owns a curve. */
export function evaluateCurve(rule, attribute) {
  const r = clamp(
      Number.isFinite(attribute) ? attribute - 1 : 0,
      0,
      rule.maxAttribute - 1,
    ),
    t = Math.max(0, rule.threshold - 1),
    n = Math.min(r, t) + Math.max(0, r - t) * rule.postThresholdRate;
  let factor;
  if (rule.type === "linear") factor = 1 + rule.rate * n;
  else if (rule.type === "accelerating")
    factor = 1 + rule.rate * n ** rule.power;
  else if (rule.type === "compounded") factor = (1 + rule.rate) ** n;
  else factor = 1 + rule.rate * (1 - Math.exp(-n / rule.scale));
  return clamp(
    rule.base * factor,
    rule.base,
    Math.max(rule.base, rule.maxGameplay),
  );
}
export const curveCost = (rule, rank) =>
  Math.min(
    1000000,
    Math.ceil(
      rule.costBase + rule.costGrowth * Math.max(0, rank) ** rule.costPower,
    ),
  );
export function investmentCost(rules, upgrades) {
  let total = 0;
  for (const d of STATISTICS)
    for (let n = 0; n < Math.min(99, upgrades[d.id] ?? 0); n++)
      total += curveCost(rules.stats[d.id], n);
  return total;
}
export function experimentalRules(rate) {
  const r = copy(REFERENCE_RULES);
  r.name = `Additive ${Math.round(rate * 100)}% per point`;
  for (const v of Object.values(r.stats)) {
    v.type = "linear";
    v.rate = rate;
    v.maxAttribute = 100;
  }
  return sanitizeRules(r);
}
export const RULE_PRESETS = Object.freeze({
  "v0.9.2 reference": REFERENCE_RULES,
  "Additive 5%": experimentalRules(0.05),
  "Additive 10%": experimentalRules(0.1),
  "Additive 20%": experimentalRules(0.2),
  "Additive 50%": experimentalRules(0.5),
});
export function curveDescription(r) {
  return r.type === "diminishing"
    ? `base × [1 + ${r.rate} × (1 − exp(−n/${r.scale}))]`
    : r.type === "compounded"
      ? `base × (1 + ${r.rate})^n (compounded)`
      : r.type === "accelerating"
        ? `base × [1 + ${r.rate} × n^${r.power}] (additive accelerating)`
        : `base × [1 + ${r.rate} × n] (additive, not compounded)`;
}
