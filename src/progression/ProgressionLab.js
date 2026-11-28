import {
  REFERENCE_RULES,
  sanitizeRules,
  curveCost,
} from "./ProgressionCurves.js";
import { STATISTICS } from "./ProgressionCatalog.js";
export const PROGRESSION_LAB_KEY = "kinetic.progression-lab.v1";
const copy = (x) => JSON.parse(JSON.stringify(x));
export const BUILD_IDENTITIES = Object.freeze({
  Speedster: {
    maximumVelocity: 3,
    groundAcceleration: 2,
    agility: 1,
    runningSpeed: 1,
  },
  Acrobat: {
    agility: 3,
    airControl: 3,
    rotationalControl: 2,
    landingStability: 2,
    airBraking: 2,
  },
  "Superhuman Leaper": {
    jumpStrength: 3,
    airAcceleration: 3,
    wallJump: 2,
    climbing: 2,
    aerialRecovery: 1,
  },
  Powerhouse: { attackPower: 3, knockback: 3, balance: 3 },
  "Martial Artist": {
    attackSpeed: 3,
    combatRecovery: 3,
    agility: 2,
    balance: 2,
  },
});
export function buildForBudget(rules, identity, budget) {
  const weights = BUILD_IDENTITIES[identity];
  if (!weights) throw Error("Unknown comparison template");
  const attributes = Object.fromEntries(STATISTICS.map((d) => [d.id, 1]));
  let left = Math.max(0, Math.min(1000000, Math.floor(budget)));
  for (let n = 0; n < 2000; n++) {
    const next = Object.keys(weights)
      .filter(
        (id) =>
          attributes[id] < rules.stats[id].maxAttribute &&
          curveCost(rules.stats[id], attributes[id] - 1) <= left,
      )
      .sort(
        (a, b) =>
          (attributes[a] - 1) / weights[a] - (attributes[b] - 1) / weights[b],
      )[0];
    if (!next) break;
    left -= curveCost(rules.stats[next], attributes[next] - 1);
    attributes[next]++;
  }
  return { attributes, spent: budget - left, remaining: left };
}
export class ProgressionLab {
  constructor(storage) {
    this.storage = storage;
    this.persistence = storage ? "local" : "session";
    this.error = null;
    let raw;
    try {
      raw = JSON.parse(storage?.getItem(PROGRESSION_LAB_KEY) ?? "null");
      if (raw && raw.version !== 1)
        throw Error("Unsupported progression-lab save");
    } catch (e) {
      this.error = e.message;
    }
    if (this.error) this.persistence = "session";
    this.active = sanitizeRules(!this.error ? raw?.active : REFERENCE_RULES);
    this.draft = sanitizeRules(!this.error ? raw?.draft : REFERENCE_RULES);
    this.configurations = [];
    this.builds = [];
    if (!this.error)
      for (const kind of ["configurations", "builds"])
        for (const item of (Array.isArray(raw?.[kind]) ? raw[kind] : []).slice(
          0,
          32,
        ))
          try {
            if (
              typeof item.id !== "string" ||
              typeof item.name !== "string" ||
              !item.name.trim() ||
              !item.value
            )
              continue;
            const value =
              kind === "configurations"
                ? sanitizeRules(item.value)
                : {
                    character: item.value.character,
                    rules: sanitizeRules(item.value.rules),
                    budget: Math.max(
                      0,
                      Math.min(1e6, Number(item.value.budget) || 0),
                    ),
                  };
            if (
              kind === "builds" &&
              ![0, 1, 2].includes(value.character?.version)
            )
              continue;
            this[kind].push({
              id: item.id.slice(0, 80),
              name: item.name.trim().slice(0, 48),
              value,
            });
          } catch {
            /* Skip an invalid independent slot. */
          }
  }
  persist() {
    if (this.error) {
      this.persistence = "session";
      return false;
    }
    try {
      if (!this.storage) {
        this.persistence = "session";
        return false;
      }
      this.storage.setItem(
        PROGRESSION_LAB_KEY,
        JSON.stringify({
          version: 1,
          active: this.active,
          draft: this.draft,
          configurations: this.configurations,
          builds: this.builds,
        }),
      );
      this.persistence = "local";
      return true;
    } catch {
      this.persistence = "session";
      return false;
    }
  }
  edit(rules) {
    this.draft = sanitizeRules(rules);
    return this.persist();
  }
  activate() {
    this.active = sanitizeRules(this.draft);
    return this.persist();
  }
  reset() {
    this.draft = sanitizeRules(REFERENCE_RULES);
    return this.persist();
  }
  save(kind, name, value, overwriteId = null) {
    if (!["configurations", "builds"].includes(kind))
      throw Error("Unknown library");
    name = String(name).trim().slice(0, 48);
    if (!name) throw Error("Enter a name");
    const list = this[kind],
      existing = list.find((x) => x.id === overwriteId);
    if (overwriteId && !existing) throw Error("Select an existing slot");
    if (
      list.some(
        (x) => x.name.toLowerCase() === name.toLowerCase() && x !== existing,
      )
    )
      throw Error("Name already exists; select the slot and use Overwrite");
    if (!existing && list.length >= 32)
      throw Error("This library holds 32 slots");
    const item = {
      id:
        existing?.id ??
        `${kind}-${Date.now()}-${list.length}-${Math.random().toString(36).slice(2, 7)}`,
      name,
      value: copy(kind === "configurations" ? sanitizeRules(value) : value),
    };
    if (existing) list[list.indexOf(existing)] = item;
    else list.push(item);
    this.persist();
    return item;
  }
  remove(kind, id) {
    this[kind] = this[kind].filter((x) => x.id !== id);
    this.persist();
  }
}
