import {
  PROGRESSION_KEY,
  ECONOMY,
  STATISTICS,
  STAT_BY_ID,
  ABILITIES,
  experienceRequired,
} from "./ProgressionCatalog.js";
import {
  REFERENCE_RULES,
  sanitizeRules,
  evaluateCurve,
  curveCost,
  investmentCost,
} from "./ProgressionCurves.js";
const integer = (v, min, max, fallback = min) =>
  typeof v === "number" && Number.isFinite(v)
    ? Math.max(min, Math.min(max, Math.floor(v)))
    : fallback;
const fresh = (economy = ECONOMY) => ({
  version: 2,
  level: 1,
  experience: 0,
  points: economy.startingPoints,
  upgrades: {},
  unlocked: ABILITIES.filter((a) => a.baseline).map((a) => a.id),
  selected: [],
});
export function normalizeProgression(raw, economy = ECONOMY) {
  if (raw == null) return fresh(economy);
  // Version 0 uses the same stable IDs with legacy field names.
  if (raw.version !== 0 && raw.version !== 1 && raw.version !== 2)
    throw new Error("Unsupported character save version");
  const s = fresh(economy);
  s.level = integer(
    raw.level,
    1,
    raw.version === 2 ? 100 : ECONOMY.maxLevel,
    1,
  );
  s.points = integer(raw.points ?? raw.upgradePoints, 0, 1000000, 0);
  s.experience = integer(raw.experience ?? raw.xp, 0, 1000000000);
  const levels = raw.upgrades ?? raw.statistics ?? {};
  for (const d of STATISTICS)
    s.upgrades[d.id] = integer(
      levels[d.id],
      0,
      raw.version === 2 ? 99 : d.maxLevel,
    );
  s.unlocked = [
    ...new Set([
      ...s.unlocked,
      ...(Array.isArray(raw.unlocked) ? raw.unlocked : []).filter((id) =>
        ABILITIES.some((a) => a.id === id),
      ),
    ]),
  ];
  s.selected = (Array.isArray(raw.selected) ? raw.selected : s.unlocked).filter(
    (id) =>
      s.unlocked.includes(id) &&
      ABILITIES.some((a) => a.id === id && !a.baseline),
  );
  return s;
}
export class CharacterProgression {
  constructor({
    storage = null,
    state,
    economy = ECONOMY,
    temporary = false,
    rules = REFERENCE_RULES,
  } = {}) {
    this.rules = sanitizeRules(rules);
    this.storage = storage;
    this.economy = {
      ...this.rules.economy,
      ...(economy === ECONOMY ? {} : economy),
    };
    this.temporary = temporary;
    this.listeners = new Set();
    this.revision = 0;
    this.persistence = storage && !temporary ? "local" : "session";
    this.loadError = null;
    let saved = state;
    if (saved === undefined)
      try {
        saved = JSON.parse(storage?.getItem(PROGRESSION_KEY) ?? "null");
      } catch {
        this.loadError =
          "Character save could not be read; session defaults active.";
        this.persistence = "session";
      }
    try {
      this.state = normalizeProgression(saved, this.economy);
      if (saved == null)
        for (const d of STATISTICS)
          this.state.upgrades[d.id] =
            (this.rules.startingAttributes?.[d.id] ?? 1) - 1;
    } catch (error) {
      this.state = fresh(this.economy);
      this.loadError = error.message + "; original save preserved.";
      this.persistence = "session";
    }
    this.values = this.resolve();
  }
  resolve() {
    return Object.freeze(
      Object.fromEntries(
        STATISTICS.map((d) => [
          d.id,
          evaluateCurve(this.rules.stats[d.id], this.attribute(d.id)) / d.base,
        ]),
      ),
    );
  }
  attribute(id) {
    return 1 + (this.state.upgrades[id] ?? 0);
  }
  configureRules(rules) {
    this.rules = sanitizeRules(rules);
    this.economy = { ...this.rules.economy };
    this.changed(true, { persist: false });
  }
  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  snapshot() {
    return JSON.parse(JSON.stringify(this.state));
  }
  save() {
    if (this.temporary || this.loadError) return false;
    try {
      if (!this.storage) throw Error();
      this.storage.setItem(PROGRESSION_KEY, JSON.stringify(this.state));
      this.persistence = "local";
      return true;
    } catch {
      this.persistence = "session";
      return false;
    }
  }
  changed(mechanics = true, { persist = true } = {}) {
    if (mechanics) this.values = this.resolve();
    this.revision++;
    if (persist) this.save();
    for (const f of this.listeners) f(this, { mechanics });
  }
  requirements({
    level = 1,
    stats = {},
    attributes = {},
    abilities = [],
  } = {}) {
    if (this.state.level < level) return `Requires character level ${level}`;
    for (const [id, n] of Object.entries(stats))
      if ((this.state.upgrades[id] ?? 0) < n)
        return `Requires ${STAT_BY_ID.get(id)?.name ?? id} attribute ${n + 1}`;
    for (const [id, n] of Object.entries(attributes))
      if (this.attribute(id) < n)
        return `Requires ${STAT_BY_ID.get(id)?.name ?? id} attribute ${n}`;
    for (const id of abilities)
      if (!this.state.unlocked.includes(id)) return `Requires ${id}`;
    return null;
  }
  preview(id) {
    const d = STAT_BY_ID.get(id);
    if (!d) return null;
    const rank = this.state.upgrades[id] ?? 0,
      rule = this.rules.stats[id],
      cost = curveCost(rule, rank),
      reason =
        rank >= rule.maxAttribute - 1
          ? "Maximum attribute reached"
          : (this.requirements({ stats: d.prerequisites }) ??
            (this.state.points < cost ? "Insufficient upgrade points" : null));
    return {
      ...d,
      rank,
      cost,
      maxLevel: rule.maxAttribute - 1,
      attribute: rank + 1,
      nextAttribute: Math.min(rule.maxAttribute, rank + 2),
      current: d.base * this.values[id],
      next: evaluateCurve(rule, rank + 2),
      available: !reason,
      reason,
    };
  }
  purchase(id) {
    const p = this.preview(id);
    if (!p?.available)
      return { ok: false, reason: p?.reason ?? "Unknown statistic" };
    this.state.points -= p.cost;
    this.state.upgrades[id] = p.rank + 1;
    this.changed();
    return { ok: true };
  }
  ability(id) {
    const definition = ABILITIES.find((a) => a.id === id);
    const a = definition
      ? { ...definition, ...this.rules.abilities[id], stats: {} }
      : null;
    if (!a) return null;
    const purchased = this.state.unlocked.includes(id),
      reason = purchased
        ? null
        : !a.enabled
          ? "Disabled in this testing configuration"
          : (this.requirements(a) ??
            (this.state.points < a.cost
              ? "Insufficient upgrade points"
              : null));
    return {
      ...a,
      purchased,
      selected: this.state.selected.includes(id),
      available: !purchased && !reason,
      reason,
    };
  }
  unlock(id) {
    const a = this.ability(id);
    if (!a?.available)
      return { ok: false, reason: a?.reason ?? "Already available" };
    this.state.points -= a.cost;
    this.state.unlocked.push(id);
    this.state.selected.push(id);
    this.changed();
    return { ok: true };
  }
  select(id, selected) {
    const a = this.ability(id);
    if (!a?.purchased || a.baseline) return false;
    this.state.selected = this.state.selected.filter((x) => x !== id);
    if (selected) this.state.selected.push(id);
    this.changed();
    return true;
  }
  awardExperience(amount) {
    if (!Number.isFinite(amount) || amount <= 0) return 0;
    if (this.state.level >= this.economy.maxLevel) return 0;
    this.state.experience += Math.min(1000000, Math.floor(amount));
    let levels = 0;
    while (
      this.state.level < this.economy.maxLevel &&
      this.state.experience >=
        experienceRequired(this.state.level, this.economy)
    ) {
      this.state.experience -= experienceRequired(
        this.state.level,
        this.economy,
      );
      this.state.level++;
      this.state.points += this.economy.pointsPerLevel;
      levels++;
    }
    if (this.state.level === this.economy.maxLevel) this.state.experience = 0;
    this.changed(false);
    return levels;
  }
  awardPoints(amount) {
    if (!Number.isFinite(amount) || amount <= 0) return false;
    this.state.points = Math.min(
      1000000,
      this.state.points + Math.floor(amount),
    );
    this.changed(false);
    return true;
  }
  investment() {
    return (
      investmentCost(this.rules, this.state.upgrades) +
      this.state.unlocked.reduce(
        (sum, id) =>
          sum +
          (ABILITIES.find((a) => a.id === id)?.baseline
            ? 0
            : (this.rules.abilities[id]?.cost ?? 0)),
        0,
      )
    );
  }
  redistribute(attributes, budget) {
    if (!this.temporary)
      return {
        ok: false,
        reason: "Assignments are restricted to temporary developer characters",
      };
    if (!Number.isFinite(budget) || budget < 0 || budget > 1000000)
      return { ok: false, reason: "Invalid point budget" };
    const upgrades = {};
    for (const d of STATISTICS) {
      const n = attributes[d.id] ?? this.attribute(d.id);
      if (
        !Number.isInteger(n) ||
        n < 1 ||
        n > this.rules.stats[d.id].maxAttribute
      )
        return { ok: false, reason: `${d.name} exceeds its configured range` };
      upgrades[d.id] = n - 1;
    }
    const extra =
        this.investment() - investmentCost(this.rules, this.state.upgrades),
      spent = investmentCost(this.rules, upgrades) + extra;
    if (spent > budget)
      return {
        ok: false,
        reason: `Build costs ${spent} points; budget is ${budget}`,
      };
    this.state.upgrades = upgrades;
    this.state.points = Math.floor(budget) - spent;
    this.changed();
    return { ok: true };
  }
  fork() {
    return new CharacterProgression({
      state: this.snapshot(),
      economy: this.economy,
      temporary: true,
      rules: this.rules,
    });
  }
}
