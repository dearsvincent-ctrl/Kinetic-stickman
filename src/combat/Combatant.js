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
    allowZeroDamage = false,
    impulseLimit = 8,
    direction = null,
  }) {
    if (
      !this.active ||
      this.invulnerable > 0 ||
      !Number.isFinite(damage) ||
      damage < 0 ||
      (damage === 0 && !allowZeroDamage) ||
      !Number.isFinite(knockback) ||
      knockback < 0 ||
      !Number.isFinite(impulseLimit) ||
      impulseLimit <= 0 ||
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
    const stability = Math.max(1, Math.min(10, this.stability ?? 1));
    if (!blocked) this.stagger = DAMAGE_CONFIG.stagger / stability;
    const force = (knockback * (blocked ? 0.15 : 1)) / stability;
    // Bounded impulse, independent of sandbox travel speed and attack reach.
    let nx = length > 1e-8 ? -dx / length : -Math.sin(heading);
    let nz = length > 1e-8 ? -dz / length : -Math.cos(heading);
    if (Number.isFinite(direction?.x) && Number.isFinite(direction?.z)) {
      const d = Math.hypot(direction.x, direction.z);
      if (d > 1e-8) {
        nx = direction.x / d;
        nz = direction.z / d;
      }
    }
    if (force > 0) {
      const cap = Math.min(
        1000,
        Math.max(
          8,
          impulseLimit,
          Math.abs(this.impulse.x),
          Math.abs(this.impulse.z),
        ),
      );
      this.impulse.x = Math.max(
        -cap,
        Math.min(cap, this.impulse.x + nx * force),
      );
      this.impulse.z = Math.max(
        -cap,
        Math.min(cap, this.impulse.z + nz * force),
      );
    }
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
    const expectedX = out.x,
      expectedZ = out.z;
    const y = this.position.y;
    world.move(this.position, out, this.radius, out);
    const travelledX = out.x - this.position.x,
      travelledZ = out.z - this.position.z;
    this.position.copy(out);
    this.position.y = y;
    if (!world.resolveVelocity(this.impulse)) {
      if (Math.abs(travelledX - expectedX) > 1e-6) this.impulse.x = 0;
      if (Math.abs(travelledZ - expectedZ) > 1e-6) this.impulse.z = 0;
    }
    this.impulse.multiplyScalar(decay);
  }
}
