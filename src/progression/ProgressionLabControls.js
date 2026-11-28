// Registry metadata is also the source used to construct the developer fields.
export const LAB_CONTROLS = Object.freeze(
  [
    ["base", "Base gameplay value", 0.001, 100000, 0.01],
    ["rate", "Growth rate / gain (base fraction)", 0, 10, 0.01],
    ["scale", "Diminishing-return scale", 0.1, 100, 0.1],
    ["power", "Acceleration exponent", 1, 4, 0.1],
    ["threshold", "Growth threshold attribute", 1, 100, 1],
    ["postThresholdRate", "Growth beyond threshold", 0, 2, 0.05],
    ["maxAttribute", "Maximum attribute", 1, 100, 1],
    ["maxGameplay", "Maximum gameplay value", 0.001, 100000, 0.01],
    ["costBase", "Starting upgrade cost", 1, 1000, 1],
    ["costGrowth", "Upgrade cost growth", 0, 100, 0.1],
    ["costPower", "Upgrade cost exponent", 1, 3, 0.1],
    ...[
      ["maxLevel", "Maximum character level", 1, 100],
      ["startingPoints", "Starting upgrade points", 0, 10000],
      ["pointsPerLevel", "Points per character level", 0, 1000],
      ["experienceBase", "Base experience requirement", 1, 100000],
      ["experienceGrowth", "Experience requirement growth", 0, 100000],
      ["defeatExperience", "XP per combat defeat", 0, 100000],
      ["tagExperience", "XP per successful tag", 0, 100000],
    ].map(([id, label, min, max]) => ["economy-" + id, label, min, max, 1]),
    ["ability-level", "Ability character-level requirement", 1, 100, 1],
    ["ability-cost", "Ability unlock cost", 0, 10000, 1],
    ["ability-requirement", "Required numerical attribute", 1, 100, 1],
    ["build-value", "Experimental attribute value", 1, 100, 1],
    ["build-budget", "Equivalent investment budget", 0, 1000, 1],
  ].map(([key, label, min, max, step]) =>
    Object.freeze({
      key,
      id: "progression-lab-" + key,
      label,
      min,
      max,
      step,
      log: ["base", "maxGameplay"].includes(key),
    }),
  ),
);
export const LAB_SELECTS = Object.freeze(
  [
    ["attribute", "Attribute to inspect / edit", "maximumVelocity"],
    ["type", "Progression curve type", "diminishing"],
    ["ability", "Ability prerequisites to edit", "aerialReserve"],
    ["requirement-stat", "Ability prerequisite attribute", "agility"],
    ["dependency", "Required previous ability", "doubleJump"],
    ["identity", "Optional comparison template", "Speedster"],
  ].map(([key, name, value]) => ({
    id: "progression-lab-" + key,
    key,
    name,
    default: value,
  })),
);
