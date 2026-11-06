export const PROXIMITY_CONFIG = Object.freeze({
  entryDistance: 1,
  exitDistance: 1.15,
  attackFacingAngle: Math.PI / 4,
});

const validPosition = (position) =>
  position &&
  Number.isFinite(position.x) &&
  Number.isFinite(position.z) &&
  (position.y === undefined || Number.isFinite(position.y));

const validTarget = (target) =>
  target &&
  target.id !== undefined &&
  target.id !== null &&
  target.active !== false &&
  validPosition(target.position);

/** Requests the existing punch when a registered target is near the actor.
 * Distance is measured between floor-plane centers, not collision surfaces.
 * This layer never moves/rotates targets, the actor or the camera.
 */
export class ProximityCombatController {
  constructor(
    combat,
    {
      targets = [],
      entryDistance = PROXIMITY_CONFIG.entryDistance,
      exitDistance = PROXIMITY_CONFIG.exitDistance,
      attackFacingAngle = PROXIMITY_CONFIG.attackFacingAngle,
    } = {},
  ) {
    if (!Number.isFinite(entryDistance) || entryDistance < 0)
      throw new RangeError(
        "entryDistance must be a finite, nonnegative distance",
      );
    if (!Number.isFinite(exitDistance) || exitDistance < entryDistance)
      throw new RangeError(
        "exitDistance must be finite and at least entryDistance",
      );
    if (
      !Number.isFinite(attackFacingAngle) ||
      attackFacingAngle < 0 ||
      attackFacingAngle > Math.PI
    )
      throw new RangeError(
        "attackFacingAngle must be between zero and pi radians",
      );
    this.combat = combat;
    this.config = Object.freeze({
      entryDistance,
      exitDistance,
      attackFacingAngle,
    });
    this.targets = new Map();
    this.target = null;
    this.distance = Infinity;
    this.aligned = false;
    this.setTargets(targets);
  }

  setTargets(targets) {
    const entries = targets instanceof Map ? targets.values() : targets;
    const registry = new Map();
    for (const target of entries) {
      if (target?.id !== undefined && target.id !== null)
        registry.set(target.id, target);
    }
    this.targets = registry;
    if (this.target) {
      this.target = this.targets.get(this.target.id) ?? null;
      if (!this.target) {
        this.distance = Infinity;
        this.aligned = false;
      }
    }
  }

  update(
    dt,
    { position, blocking = false, facing, grounded = true, context = {} } = {},
  ) {
    if (!Number.isFinite(dt) || dt <= 0) return;
    if (grounded) {
      this._refreshTarget(position);
    } else {
      // Takeoff, flight and landing all suspend grounded combat selection.
      // Discard hysteresis so neither an attack nor target-facing can resume
      // from stale proximity while movement owns the character.
      this.reset();
      this.combat.cancelAttack("movement");
    }
    this.combat.setBlocking(blocking);
    if (this.target) {
      const dx = this.target.position.x - position.x;
      const dz = this.target.position.z - position.z;
      const yawDifference = Math.atan2(-dx, -dz) - facing;
      this.aligned =
        !Number.isFinite(facing) ||
        this.distance === 0 ||
        Math.abs(
          Math.atan2(Math.sin(yawDifference), Math.cos(yawDifference)),
        ) <= this.config.attackFacingAngle;
      if (this.aligned && this.combat.ready) {
        const divisor = this.distance || 1;
        this.combat.requestAttack({
          ...context,
          source: "proximity",
          targetId: this.target.id,
          opponentDistance: this.distance,
          targetDirection: { x: dx / divisor, y: 0, z: dz / divisor },
        });
      }
    }
    // Existing recovery remains authoritative; no pending strikes are saved.
    this.combat.update(dt);
  }

  _refreshTarget(position) {
    if (!validPosition(position)) {
      this.reset();
      return;
    }
    const retained = this.target && this.targets.get(this.target.id);
    if (validTarget(retained)) {
      const distance = Math.hypot(
        retained.position.x - position.x,
        retained.position.z - position.z,
      );
      if (distance <= this.config.exitDistance) {
        this.target = retained;
        this.distance = distance;
        return;
      }
    }

    this.reset();
    for (const target of this.targets.values()) {
      if (!validTarget(target)) continue;
      const distance = Math.hypot(
        target.position.x - position.x,
        target.position.z - position.z,
      );
      if (distance <= this.config.entryDistance && distance < this.distance) {
        this.target = target;
        this.distance = distance;
      }
    }
  }

  reset() {
    this.target = null;
    this.distance = Infinity;
    this.aligned = false;
  }
}
