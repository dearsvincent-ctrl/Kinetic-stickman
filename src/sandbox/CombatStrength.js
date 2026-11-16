import { DAMAGE_CONFIG } from "../combat/Combatant.js";
export const COMBAT_STRENGTH_PARAMETERS = Object.freeze([
  Object.freeze({
    id: "attackPower",
    label: "Attack Power",
    min: 0,
    max: 100,
    log: false,
    group: "combat",
    step: 0.1,
  }),
  Object.freeze({
    id: "impact",
    label: "Impact / Knockback",
    min: 0,
    max: 100,
    log: false,
    group: "combat",
    step: 0.1,
  }),
]);
export const NORMAL_COMBAT_STRENGTH = Object.freeze({
  attackPower: 1,
  impact: 1,
});
const multiplier = (n) =>
  typeof n === "number" && Number.isFinite(n)
    ? Math.max(0, Math.min(100, n))
    : 1;
export const sanitizeCombatStrength = (v = {}) =>
  Object.freeze({
    attackPower: multiplier(v?.attackPower),
    impact: multiplier(v?.impact),
  });
// Separate technique profiles allow later Punch/Kick stat scaling without
// coupling animation timing, hit geometry or damage to physical impulse.
export const PLAYER_STRIKE_PROFILES = Object.freeze({
  punch: Object.freeze({ damage: DAMAGE_CONFIG.punchDamage, knockback: 2.5 }),
  kick: Object.freeze({ damage: DAMAGE_CONFIG.kickDamage, knockback: 4.2 }),
});
export function playerStrikeImpact(action, values = NORMAL_COMBAT_STRENGTH) {
  const v = sanitizeCombatStrength(values),
    base = PLAYER_STRIKE_PROFILES[action] ?? PLAYER_STRIKE_PROFILES.punch;
  return {
    damage: base.damage * v.attackPower,
    knockback: base.knockback * v.impact,
  };
}
