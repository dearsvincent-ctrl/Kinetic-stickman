import { Vector3 } from "three";

export const DAMAGE_CONFIG = Object.freeze({
  playerHealth: 120,
  enemyHealth: 72,
  punchDamage: 18,
  kickDamage: 28,
  enemyPunchDamage: 10,
  enemyKickDamage: 15,
  blockArc: Math.PI * 0.4,
  blockReduction: 0.85,
  perfectBlockWindow: 0.16,
  stagger: 0.24,
  impulseDrag: 8,
});
const HITBOXES = Object.freeze([
  Object.freeze({ height: 0.9, radius: 0.25 }),
  Object.freeze({ height: 1.36, radius: 0.27 }),
  Object.freeze({ height: 1.74, radius: 0.19 }),
]);

/** Damage consumes confirmed swept contacts. It never selects targets or
 * writes travel velocity. Impulses are collision-resolved by the encounter. */
export class Combatant {
  constructor(id, position, { maxHealth = 72, radius = 0.32 } = {}) {
    this.id = id;
    this.position = position;
    this.previousPosition = position.clone();
    this.radius = radius;
    this.height = 2;
    this.dynamic = true;
    this.strikeHeight = 1.36;
    this.strikeRadius = 0.27;
    this.hitboxes = HITBOXES;
    this.impulse = new Vector3();
    this.reset(maxHealth);
  }
  reset(maxHealth = this.maxHealth) {
    this.maxHealth = this.health = maxHealth;
    this.active = true;
    this.heading = 0;
    this.blocking = false;
    this.blockTime = 0;
    this.stagger = this.flash = this.invulnerable = 0;
    this.lastResult = null;
    this.impulse.set(0, 0, 0);
    this.previousPosition.copy(this.position);
  }
  update(dt, blocking = false, heading = this.heading) {
    this.heading = heading;
    this.blockTime = blocking ? (this.blocking ? this.blockTime + dt : 0) : 0;
    this.blocking = blocking;
    this.stagger = Math.max(0, this.stagger - dt);
    this.flash = Math.max(0, this.flash - dt);
    this.invulnerable = Math.max(0, this.invulnerable - dt);
  }
  receive({
    damage,
    source,
    heading = 0,
    knockback = 3,
    atPosition = this.position,
  }) {
    if (
      !this.active ||
      this.invulnerable > 0 ||
      !Number.isFinite(damage) ||
      damage <= 0 ||
      !Number.isFinite(source?.x) ||
      !Number.isFinite(source?.z)
    )
      return null;
    const dx = source.x - atPosition.x,
      dz = source.z - atPosition.z;
    const length = Math.hypot(dx, dz);
    const front =
      length > 1e-8
        ? (-Math.sin(this.heading) * dx - Math.cos(this.heading) * dz) / length
        : Math.cos(heading - this.heading + Math.PI);
    const blocked = this.blocking && front >= Math.cos(DAMAGE_CONFIG.blockArc);
    const perfect =
      blocked && this.blockTime <= DAMAGE_CONFIG.perfectBlockWindow;
    const applied =
      damage * (perfect ? 0 : blocked ? 1 - DAMAGE_CONFIG.blockReduction : 1);
    this.health = Math.max(0, this.health - applied);
    this.flash = 0.18;
    if (!blocked) this.stagger = DAMAGE_CONFIG.stagger;
    const force = knockback * (blocked ? 0.15 : 1);
    // Bounded impulse, independent of sandbox travel speed and attack reach.
    const nx = length > 1e-8 ? -dx / length : -Math.sin(heading);
    const nz = length > 1e-8 ? -dz / length : -Math.cos(heading);
    this.impulse.x = Math.max(-8, Math.min(8, this.impulse.x + nx * force));
    this.impulse.z = Math.max(-8, Math.min(8, this.impulse.z + nz * force));
    if (this.health === 0) this.active = false;
    return (this.lastResult = {
      damage: applied,
      blocked,
      perfect,
      defeated: !this.active,
    });
  }
  moveImpulse(dt, world, out) {
    if (this.impulse.lengthSq() < 1e-6) return;
    const decay = Math.exp(-DAMAGE_CONFIG.impulseDrag * dt);
    out
      .copy(this.impulse)
      .multiplyScalar((1 - decay) / DAMAGE_CONFIG.impulseDrag);
    const y = this.position.y;
    world.move(this.position, out, this.radius, out);
    this.position.copy(out);
    this.position.y = y;
    world.resolveVelocity(this.impulse);
    this.impulse.multiplyScalar(decay);
  }
}
