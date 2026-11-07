import { sweptTechniqueEntry } from "./SweptProximity.js";
import { TARGET_STRIKE_DEFAULTS } from "./Techniques.js";

export const PROXIMITY_CONFIG = Object.freeze({
  entryDistance: 1,
  exitDistance: 1.15,
  aerialEntryDistance: 1.05,
  aerialExitDistance: 1.2,
  attackFacingAngle: Math.PI / 4,
});

const validPosition = (p) =>
  p &&
  Number.isFinite(p.x) &&
  Number.isFinite(p.z) &&
  (p.y === undefined || Number.isFinite(p.y));
const validTarget = (t) =>
  t &&
  t.id !== undefined &&
  t.id !== null &&
  t.active !== false &&
  validPosition(t.position);

/** Selection stays live in every movement phase. Retaining a target never
 * bypasses a technique's own 3D reach, height, facing or physical eligibility.
 * This layer never changes movement objects or actor transforms. */
export class ProximityCombatController {
  constructor(combat, options = {}) {
    this.combat = combat;
    const { targets = [], ...config } = options;
    this.config = Object.freeze({ ...PROXIMITY_CONFIG, ...config });
    for (const key of [
      "entryDistance",
      "exitDistance",
      "aerialEntryDistance",
      "aerialExitDistance",
      "attackFacingAngle",
    ])
      if (!Number.isFinite(this.config[key]) || this.config[key] < 0)
        throw new RangeError(`Invalid proximity ${key}`);
    if (
      this.config.exitDistance < this.config.entryDistance ||
      this.config.aerialExitDistance < this.config.aerialEntryDistance
    )
      throw new RangeError("Exit distance must be at least entry distance");
    if (this.config.attackFacingAngle > Math.PI)
      throw new RangeError("Invalid facing angle");
    this.targets = new Map();
    this.sample = {};
    this.sweepInterval = new Float64Array(2);
    this.sweepPosition = { x: 0, y: 0, z: 0 };
    this.sweptOpportunities = 0;
    this.reset();
    this.setTargets(targets);
  }

  setTargets(targets) {
    const entries = targets instanceof Map ? targets.values() : targets;
    this.targets = new Map();
    for (const target of entries)
      if (target?.id !== undefined && target.id !== null)
        this.targets.set(target.id, target);
    if (this.target) {
      this.target = this.targets.get(this.target.id) ?? null;
      if (!this.target) this.reset();
    }
  }

  update(
    dt,
    { position, blocking = false, facing, grounded = true, context = {} } = {},
  ) {
    if (!Number.isFinite(dt) || dt <= 0) return;
    const environment = context.environment ?? (grounded ? "ground" : "air");
    const phase = context.phase ?? (grounded ? "grounded" : "airborne");
    const canAttack =
      context.canAttack ?? ["grounded", "airborne"].includes(phase);
    const current = this.combat.currentTechnique;
    const shared =
      current?.environments.includes("ground") &&
      current.environments.includes("air");
    if (
      this.combat.attack.active &&
      ((!canAttack && !shared) || !current.environments.includes(environment))
    )
      this.combat.cancelAttack(
        environment === "ground" && current.environments.includes("air")
          ? "landing"
          : "movement",
      );
    this.combat.setBlocking(blocking);
    this._refreshTarget(position, environment, facing);
    if (this.target) {
      const horizontal = Math.hypot(
        this.target.position.x - position.x,
        this.target.position.z - position.z,
      );
      const delta =
        Math.atan2(
          -(this.target.position.x - position.x),
          -(this.target.position.z - position.z),
        ) - facing;
      const angle =
        !Number.isFinite(facing) || horizontal < 1e-9
          ? 0
          : Math.atan2(Math.sin(delta), Math.cos(delta));
      this.aligned = Math.abs(angle) <= this.config.attackFacingAngle + 1e-9;
      if (this.aligned && this.combat.ready && canAttack) {
        // Entry snapshots are allocated only when combat is ready, never
        // during the ordinary busy-animation update path.
        let techniqueContexts = null;
        for (const technique of this.combat.techniques.values()) {
          if (!technique.environments.includes(environment)) continue;
          this._sample(technique, this.target, position, facing);
          const s = this.sample;
          if (
            s.surfaceDistance > technique.reach + 1e-9 ||
            Math.abs(s.verticalSeparation) > technique.maxVertical ||
            Math.abs(s.facingAngle) > technique.maxAngle + 1e-9 ||
            (context.height ?? Math.max(0, position.y ?? 0)) <
              technique.minHeight ||
            (environment === "air" &&
              (context.airTimeRemaining ?? Infinity) <
                technique.minAirTimeRemaining)
          )
            continue;
          techniqueContexts ??= {};
          const divisor = s.distance || 1;
          techniqueContexts[technique.id] = {
            opponentDistance: s.distance,
            surfaceDistance: s.surfaceDistance,
            horizontalDistance: s.horizontalDistance,
            verticalSeparation: s.verticalSeparation,
            facingAngle: s.facingAngle,
            targetRadius: s.radius,
            targetPoint: {
              x: this.target.position.x,
              y: s.targetY,
              z: this.target.position.z,
            },
            targetDirection: {
              x: s.dx / divisor,
              y: s.verticalSeparation / divisor,
              z: s.dz / divisor,
            },
          };
        }
        if (techniqueContexts)
          this.combat.requestAttack({
            ...context,
            environment,
            phase,
            canAttack,
            height: context.height ?? Math.max(0, position.y ?? 0),
            source: "proximity",
            targetId: this.target.id,
            opponentDistance: this.distance,
            techniqueContexts,
          });
      }
    }
    this.combat.update(dt);
  }

  updateSwept(dt, options, previousPosition) {
    const { position, facing = 0, blocking, context = {} } = options;
    if (
      !validPosition(previousPosition) ||
      blocking ||
      !this.combat.ready ||
      context.canAttack === false
    ) {
      this.update(dt, options);
      return;
    }
    const environment =
      context.environment ?? (options.grounded === false ? "air" : "ground");
    const entry =
      environment === "air"
        ? this.config.aerialEntryDistance
        : this.config.entryDistance;
    let first = Infinity;
    for (const target of this.targets.values()) {
      if (!validTarget(target)) continue;
      for (const technique of this.combat.techniques.values()) {
        if (!technique.environments.includes(environment)) continue;
        const time = sweptTechniqueEntry(
          previousPosition,
          position,
          target,
          technique,
          entry,
          facing,
          this.sweepInterval,
        );
        if (time !== null && time < first) first = time;
      }
    }
    if (first < 1) {
      // Sample just inside the boundary to avoid floating-point tangent misses.
      const t = Math.min(1, first + 1e-9);
      const sample = this.sweepPosition;
      sample.x = previousPosition.x + (position.x - previousPosition.x) * t;
      sample.y = previousPosition.y + (position.y - previousPosition.y) * t;
      sample.z = previousPosition.z + (position.z - previousPosition.z) * t;
      const sequence = this.combat.attack.sequence;
      this.update(dt, {
        ...options,
        position: sample,
        context: { ...context, height: sample.y },
      });
      if (this.combat.attack.sequence > sequence) this.sweptOpportunities++;
      // Hysteresis/selection describe the live endpoint, never a stale contact.
      this._refreshTarget(position, environment, facing);
    } else this.update(dt, options);
  }

  _sample(technique, target, position, facing) {
    const s = this.sample;
    s.dx = target.position.x - position.x;
    s.dz = target.position.z - position.z;
    s.targetY =
      (target.position.y ?? 0) +
      (target.strikeHeight ?? TARGET_STRIKE_DEFAULTS.height);
    s.radius = target.strikeRadius ?? TARGET_STRIKE_DEFAULTS.radius;
    s.verticalSeparation =
      s.targetY - ((position.y ?? 0) + technique.originHeight);
    s.horizontalDistance = Math.hypot(s.dx, s.dz);
    s.distance = Math.hypot(s.horizontalDistance, s.verticalSeparation);
    s.surfaceDistance = Math.max(0, s.distance - s.radius);
    const delta = Math.atan2(-s.dx, -s.dz) - facing;
    s.facingAngle =
      !Number.isFinite(facing) || s.horizontalDistance < 1e-9
        ? 0
        : Math.atan2(Math.sin(delta), Math.cos(delta));
  }

  _distance(target, position, environment, facing) {
    let best = Infinity;
    for (const technique of this.combat.techniques.values()) {
      if (!technique.environments.includes(environment)) continue;
      this._sample(technique, target, position, facing);
      const s = this.sample;
      if (
        !Number.isFinite(s.radius) ||
        s.radius < 0 ||
        Math.abs(s.verticalSeparation) > technique.maxVertical
      )
        continue;
      if (s.distance < best) {
        best = s.distance;
        this.measuredHorizontal = s.horizontalDistance;
        this.measuredVertical = s.verticalSeparation;
      }
    }
    return best;
  }

  _refreshTarget(position, environment, facing) {
    if (!validPosition(position)) {
      this.reset();
      return;
    }
    const entry =
      environment === "air"
        ? this.config.aerialEntryDistance
        : this.config.entryDistance;
    const exit =
      environment === "air"
        ? this.config.aerialExitDistance
        : this.config.exitDistance;
    const retained = this.target && this.targets.get(this.target.id);
    if (validTarget(retained)) {
      const distance = this._distance(retained, position, environment, facing);
      if (distance <= exit) {
        this.target = retained;
        this.distance = distance;
        this.horizontalDistance = this.measuredHorizontal;
        this.verticalSeparation = this.measuredVertical;
        return;
      }
    }
    this.reset();
    for (const target of this.targets.values()) {
      if (!validTarget(target)) continue;
      const distance = this._distance(target, position, environment, facing);
      if (distance <= entry && distance < this.distance) {
        this.target = target;
        this.distance = distance;
        this.horizontalDistance = this.measuredHorizontal;
        this.verticalSeparation = this.measuredVertical;
      }
    }
  }

  reset() {
    this.target = null;
    this.distance = Infinity;
    this.horizontalDistance = Infinity;
    this.verticalSeparation = Infinity;
    this.aligned = false;
  }
}
