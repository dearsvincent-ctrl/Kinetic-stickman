import {
  PROGRESSION_KEY,
  ECONOMY,
  STATISTICS,
  STAT_BY_ID,
  ABILITIES,
  experienceRequired,
  upgradeCost,
  statMultiplier,
} from "./ProgressionCatalog.js";
const integer = (v, min, max, fallback = min) =>
  typeof v === "number" && Number.isFinite(v)
    ? Math.max(min, Math.min(max, Math.floor(v)))
    : fallback;
const fresh = (economy = ECONOMY) => ({
  version: 1,
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
  if (raw.version !== 0 && raw.version !== 1)
    throw new Error("Unsupported character save version");
  const s = fresh(economy);
  s.level = integer(raw.level, 1, economy.maxLevel, 1);
  s.points = integer(raw.points ?? raw.upgradePoints, 0, 1000000, 0);
  s.experience = integer(
    raw.experience ?? raw.xp,
    0,
    s.level === economy.maxLevel ? 0 : experienceRequired(s.level, economy) - 1,
  );
  const levels = raw.upgrades ?? raw.statistics ?? {};
  for (const d of STATISTICS)
    s.upgrades[d.id] = integer(levels[d.id], 0, d.maxLevel);
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
  } = {}) {
    this.storage = storage;
    this.economy = { ...ECONOMY, ...economy };
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
          statMultiplier(d, this.state.upgrades[d.id] ?? 0),
        ]),
      ),
    );
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
  changed(mechanics = true) {
    if (mechanics) this.values = this.resolve();
    this.revision++;
    this.save();
    for (const f of this.listeners) f(this, { mechanics });
  }
  requirements({ level = 1, stats = {}, abilities = [] } = {}) {
    if (this.state.level < level) return `Requires character level ${level}`;
    for (const [id, n] of Object.entries(stats))
      if ((this.state.upgrades[id] ?? 0) < n)
        return `Requires ${STAT_BY_ID.get(id)?.name ?? id} rank ${n}`;
    for (const id of abilities)
      if (!this.state.unlocked.includes(id)) return `Requires ${id}`;
    return null;
  }
  preview(id) {
    const d = STAT_BY_ID.get(id);
    if (!d) return null;
    const rank = this.state.upgrades[id] ?? 0,
      cost = upgradeCost(d, rank),
      reason =
        rank >= d.maxLevel
          ? "Maximum rank reached"
          : (this.requirements({ stats: d.prerequisites }) ??
            (this.state.points < cost ? "Insufficient upgrade points" : null));
    return {
      ...d,
      rank,
      cost,
      current: d.base * this.values[id],
      next: d.base * statMultiplier(d, rank + 1),
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
    const a = ABILITIES.find((a) => a.id === id);
    if (!a) return null;
    const purchased = this.state.unlocked.includes(id),
      reason = purchased
        ? null
        : (this.requirements(a) ??
          (this.state.points < a.cost ? "Insufficient upgrade points" : null));
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
  fork() {
    return new CharacterProgression({
      state: this.snapshot(),
      economy: this.economy,
      temporary: true,
    });
  }
}
