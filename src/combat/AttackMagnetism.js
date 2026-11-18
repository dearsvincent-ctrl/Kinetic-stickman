import { Quaternion, Vector3 } from "three";
import { sampleLocalStrike, worldStrike } from "./TechniqueGeometry.js";
import {
  ATTACK_MAGNETISM_LIMITS as LIMITS,
  sanitizeAttackMagnetism,
} from "../sandbox/AttackMagnetismSettings.js";
export {
  ATTACK_MAGNETISM_DEFAULTS,
  ATTACK_MAGNETISM_LIMITS,
  MAGNETISM_DEFAULTS,
  MAGNETISM_LIMITS,
  sanitizeAttackMagnetism,
} from "../sandbox/AttackMagnetismSettings.js";

const UP = new Vector3(0, 1, 0);
const ZERO = new Vector3();
const EPS = 1e-9;
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const finiteVector = (v) => v && [v.x, v.y, v.z].every(Number.isFinite);
const bodyOf = (candidate) => candidate?.body ?? candidate?.target ?? candidate;
const wrap = (angle) => Math.atan2(Math.sin(angle), Math.cos(angle));

/** One short, collision-resolved approach per accepted manual Punch/Kick.
 * Selection is immutable during execution. This class never starts attacks,
 * writes locomotion velocity/heading, extends strike reach, or records hits.
 * Alignment uses the existing shared physical limb path, once per strike.
 */
export class AttackMagnetism {
  constructor({ targets = [], config = {} } = {}) {
    this.targets = targets;
    this.config = sanitizeAttackMagnetism(config);
    this.clock = 0;
    this.queries = 0;
    this.last = null;
    this.recentId = null;
    this.recentAt = -Infinity;
    this.active = false;
    this.traveled = this.budget = this.elapsed = this.duration = 0;
    this.approachSpeed = 0;
    this.reason = "idle";
    this.position = new Vector3();
    this.predictedRoot = new Vector3();
    this.predictedTarget = new Vector3();
    this.targetVelocity = new Vector3();
    this.local = new Vector3();
    this.strike = new Vector3();
    this.delta = new Vector3();
    this.direction = new Vector3();
    this.intent = new Vector3();
    this.facing = new Vector3();
    this.trajectory = new Vector3();
    this.displacement = new Vector3();
    this.resolved = new Vector3();
    this.orientation = new Quaternion();
    this.inverse = new Quaternion();
    this.axis = new Vector3();
    this.up = new Vector3();
  }

  configure(values) {
    this.config = sanitizeAttackMagnetism(values);
    if (!this.config.enabled) this.cancel("disabled");
  }
  get targetId() {
    return this.active ? (this.last?.targetId ?? null) : null;
  }
  get remainingBudget() {
    return Math.max(0, this.budget - this.traveled);
  }
  snapshot(out = {}) {
    return Object.assign(out, {
      enabled: this.config.enabled,
      active: this.active,
      targetId: this.targetId,
      selectedTargetId: this.last?.targetId ?? null,
      traveled: this.traveled,
      budget: this.budget,
      remainingBudget: this.remainingBudget,
      elapsed: this.elapsed,
      duration: this.duration,
      reason: this.reason,
      queries: this.queries,
    });
  }
  cancel(reason = "cancelled") {
    this.active = false;
    this.approachSpeed = 0;
    this.reason = reason;
    this.candidate = null;
  }

  /** Call only from CombatController.prepareAttackContext, after an entry is
   * accepted. Returns a normal punchAim/kickAim object, replacing (rather than
   * adding to) the separate aim-assist correction for this selected strike. */
  begin(controller, targets, technique, mode, world, options = {}) {
    const context = options.context ?? {};
    const action =
      typeof technique === "string" ? technique : technique?.action;
    if (
      !this.config.enabled ||
      mode !== "combat" ||
      options.accepted !== true ||
      (context.source ?? options.source) !== "manual" ||
      context.gesture ||
      context.canAttack === false ||
      (action !== "punch" && action !== "kick") ||
      !finiteVector(controller?.root?.position) ||
      !finiteVector(controller.velocity) ||
      options.blocking ||
      options.input?.blocking ||
      controller.jumpRequested ||
      controller.parkour?.attached
    ) {
      if (!this.config.enabled || mode !== "combat")
        this.cancel(!this.config.enabled ? "disabled" : "mode");
      return null;
    }
    // String actions are supported for small adapters; real combat passes the
    // authored technique so both selection and assistance respect its reach.
    if (typeof technique === "string")
      technique = {
        action,
        side: "right",
        animation: action,
        reach: action === "kick" ? 0.95 : 0.76,
        hitRadius: 0.1,
        originHeight: action === "kick" ? 0.95 : 1.4,
        maxVertical: 0.4,
        windup: 0.08,
        extension: 0.1,
        impact: 0,
      };
    this.cancel("no-target");
    this.last = null;
    this.traveled = this.budget = this.elapsed = 0;
    this.position.copy(controller.root.position);
    this.orientation.copy(
      options.orientation ??
        this.inverse.setFromAxisAngle(UP, controller.heading ?? 0),
    );
    if (
      ![
        this.orientation.x,
        this.orientation.y,
        this.orientation.z,
        this.orientation.w,
      ].every(Number.isFinite)
    )
      return null;
    this.facing.set(
      -Math.sin(controller.heading ?? 0),
      0,
      -Math.cos(controller.heading ?? 0),
    );
    this.trajectory.copy(controller.velocity).setY(0);
    const speed = this.trajectory.length();
    if (speed > EPS) this.trajectory.multiplyScalar(1 / speed);
    this.intent.copy(this.facing);
    const move = options.input?.move;
    const inputX = Number.isFinite(move?.x) ? move.x : 0;
    const inputY = Number.isFinite(move?.y) ? move.y : 0;
    const inputStrength = Math.hypot(inputX, inputY);
    if (inputStrength > 0.08) {
      const yaw = Number.isFinite(options.cameraYaw) ? options.cameraYaw : 0;
      this.intent
        .set(
          inputX * Math.cos(yaw) - inputY * Math.sin(yaw),
          0,
          -inputX * Math.sin(yaw) - inputY * Math.cos(yaw),
        )
        .normalize();
    }
    const horizon = clamp(
      technique.windup + technique.extension * 0.8,
      0,
      LIMITS.predictionHorizon,
    );
    this.predictedRoot
      .copy(this.position)
      .addScaledVector(controller.velocity, horizon);
    if (controller.jump?.airborne) {
      this.predictedRoot.y =
        this.position.y +
        (controller.jump.verticalVelocity ?? 0) * horizon -
        0.5 * (controller.jump.config?.gravity ?? 0) * horizon * horizon;
    }
    // Do not rank a path that already contains the independent aim correction.
    const unaligned = {
      ...context,
      punchAim: null,
      kickAim: null,
      strikeAim: null,
    };
    sampleLocalStrike(this.local, technique, horizon, unaligned);
    worldStrike(
      this.strike,
      this.local,
      this.predictedRoot,
      this.orientation,
      options.lift ?? 0,
    );
    this.queries++;
    let selected = null;
    let previous = null;
    const candidates = targets ?? this.targets;
    for (const candidate of candidates) {
      const body = bodyOf(candidate);
      if (
        !body ||
        body.active !== true ||
        candidate.spawned === false ||
        !finiteVector(body.position)
      )
        continue;
      const distance = this.position.distanceTo(body.position);
      if (distance > this.config.range || distance < EPS) continue;
      this.delta.subVectors(body.position, this.position).setY(0);
      const horizontal = this.delta.length();
      if (horizontal < EPS) continue;
      this.direction.copy(this.delta).multiplyScalar(1 / horizontal);
      const facingDot = this.direction.dot(this.facing);
      const intentDot = this.direction.dot(this.intent);
      const travelDot =
        speed > 0.5 ? this.direction.dot(this.trajectory) : facingDot;
      const wantedDot =
        inputStrength > 0.08 ? intentDot : speed > 1 ? travelDot : facingDot;
      if (wantedDot < Math.cos(LIMITS.acquireAngle)) continue;
      if (
        this.blocked(
          world,
          this.position,
          body.position,
          controller.radius ?? 0.36,
          body,
        )
      )
        continue;
      this.velocityOf(candidate, this.targetVelocity);
      if (!finiteVector(this.targetVelocity)) continue;
      this.predictedTarget
        .copy(body.position)
        .addScaledVector(this.targetVelocity, horizon);
      const enemyJump = candidate.controller?.jump;
      if (enemyJump?.airborne)
        this.predictedTarget.y -=
          0.5 * (enemyJump.config?.gravity ?? 0) * horizon * horizon;
      let vertical = Infinity;
      let pathDistance = Infinity;
      let targetHeight = body.strikeHeight ?? 1.36;
      for (const box of body.hitboxes ?? [
        { height: targetHeight, radius: body.strikeRadius ?? 0.27 },
      ]) {
        if (
          !Number.isFinite(box.height) ||
          !Number.isFinite(box.radius) ||
          box.radius <= 0
        )
          continue;
        const dy = Math.abs(
          this.predictedTarget.y + box.height - this.strike.y,
        );
        const d =
          Math.hypot(
            this.predictedTarget.x - this.strike.x,
            dy,
            this.predictedTarget.z - this.strike.z,
          ) - box.radius;
        if (d < pathDistance) {
          pathDistance = d;
          targetHeight = box.height;
        }
        vertical = Math.min(vertical, Math.max(0, dy - box.radius));
      }
      if (vertical > (technique.maxVertical ?? 0.4) + 0.1) continue;
      const futureGap = Math.hypot(
        this.predictedTarget.x - this.predictedRoot.x,
        this.predictedTarget.z - this.predictedRoot.z,
      );
      // A large configured range is a search radius, never added strike reach.
      if (
        futureGap >
        this.config.maxApproach + technique.reach + (body.radius ?? 0.32)
      )
        continue;
      const score =
        (pathDistance / Math.max(0.1, this.config.range)) * 0.5 +
        (distance / Math.max(0.1, this.config.range)) * 0.2 +
        (1 - travelDot) * (speed > 1 ? 0.75 : 0.15) +
        (1 - intentDot) * (inputStrength > 0.08 ? 0.7 : 0.15) +
        (1 - facingDot) * 0.15;
      const item = {
        candidate,
        body,
        score,
        targetHeight,
        targetX: this.predictedTarget.x,
        targetZ: this.predictedTarget.z,
      };
      if (!selected || score < selected.score) selected = item;
      if (
        body.id === this.recentId &&
        this.clock - this.recentAt < LIMITS.hysteresisDuration
      )
        previous = item;
    }
    // A short preference between accepted entries avoids tie flicker while a
    // clear joystick/trajectory change still selects the new intended target.
    const margin = (1 - this.config.switchSensitivity) * 0.18;
    if (previous && selected && previous.score <= selected.score + margin)
      selected = previous;
    if (!selected) return null;
    const targetYaw = Math.atan2(
      -(selected.targetX - this.predictedRoot.x),
      -(selected.targetZ - this.predictedRoot.z),
    );
    const strikeYaw = Math.atan2(
      -(this.strike.x - this.predictedRoot.x),
      -(this.strike.z - this.predictedRoot.z),
    );
    const requested = wrap(targetYaw - strikeYaw);
    this.up.copy(UP).applyQuaternion(this.orientation);
    const rotating =
      context.rotationActive ||
      Math.hypot(...(context.rotationRate ?? [0, 0, 0])) > 2 ||
      this.up.dot(UP) < 0.75;
    const correction = rotating
      ? 0
      : clamp(requested, -LIMITS.alignmentAngle, LIMITS.alignmentAngle) *
        this.config.alignment;
    this.inverse.copy(this.orientation).invert();
    this.axis
      .copy(UP)
      .applyQuaternion(this.inverse)
      .multiplyScalar(correction < 0 ? -1 : 1);
    this.duration = Math.min(
      LIMITS.approachDuration,
      technique.windup + technique.extension + (technique.impact ?? 0),
    );
    this.budget = this.config.maxApproach;
    this.last = Object.freeze({
      targetId: selected.body.id,
      targetHeight: selected.targetHeight,
      axis: Object.freeze(this.axis.toArray()),
      angle: Math.abs(correction),
      requestedAngle: Math.abs(requested),
      strength: 1,
      score: selected.score,
      time: horizon,
      side: technique.side,
      magnetism: true,
      budget: this.budget,
      duration: this.duration,
    });
    this.candidate = selected.candidate;
    this.body = selected.body;
    this.world = world ?? controller.world;
    this.sequence = options.sequence ?? null;
    this.jumpSequence = controller.jumpEvent?.sequence;
    this.airborne = Boolean(controller.jump?.airborne);
    this.reach = technique.reach;
    this.action = action;
    this.techniqueId = technique.id ?? null;
    this.recentId = selected.body.id;
    this.recentAt = this.clock;
    this.active =
      this.duration > 0 &&
      this.budget > 0 &&
      this.config.approachAcceleration > 0;
    this.reason = this.active ? "approaching" : "alignment-only";
    return this.last;
  }

  velocityOf(candidate, out) {
    const body = bodyOf(candidate);
    out.copy(candidate.controller?.velocity ?? body.velocity ?? ZERO);
    if (candidate.controller?.jump?.airborne)
      out.y = candidate.controller.jump.verticalVelocity;
    if (finiteVector(body.impulse)) out.add(body.impulse);
    return out;
  }

  /** Read-only LOS: structures use the same swept geometry as locomotion;
   * circular bodies/props are tested without mutating world contact state. */
  blocked(world, start, target, radius, ownTarget) {
    this.delta.subVectors(target, start);
    if (world?.firstBlock?.(start, this.delta, radius * 0.25, 1.8)) return true;
    const lengthSq = this.delta.x ** 2 + this.delta.z ** 2;
    if (lengthSq < EPS) return false;
    for (const obstacle of world?.obstacles ?? []) {
      if (
        obstacle === ownTarget ||
        obstacle === world.ignoredObstacle ||
        obstacle.active === false ||
        !finiteVector(obstacle.position) ||
        !(obstacle.radius > 0)
      )
        continue;
      if (
        obstacle.height &&
        (start.y >= obstacle.position.y + obstacle.height ||
          start.y + 1.8 <= obstacle.position.y)
      )
        continue;
      const fraction = clamp(
        ((obstacle.position.x - start.x) * this.delta.x +
          (obstacle.position.z - start.z) * this.delta.z) /
          lengthSq,
        0,
        1,
      );
      if (fraction >= 1 - EPS) continue;
      const separation = Math.hypot(
        start.x + this.delta.x * fraction - obstacle.position.x,
        start.z + this.delta.z * fraction - obstacle.position.z,
      );
      if (separation < obstacle.radius + radius * 0.25) return true;
    }
    return false;
  }

  update(
    dt,
    controller,
    {
      combat = null,
      blocking = false,
      mode = "combat",
      input = null,
      world = this.world ?? controller?.world,
    } = {},
  ) {
    if (!Number.isFinite(dt) || dt <= 0) return 0;
    this.clock += dt;
    if (!this.config.enabled || mode !== "combat") {
      if (this.active) this.cancel(!this.config.enabled ? "disabled" : "mode");
      return 0;
    }
    if (!this.active) return 0;
    const attack = combat?.attack;
    if (
      blocking ||
      input?.blocking ||
      combat?.blocking ||
      !attack?.active ||
      attack.cancelled ||
      attack.context?.source !== "manual" ||
      (this.sequence !== null && attack.sequence !== this.sequence) ||
      (this.techniqueId !== null && attack.techniqueId !== this.techniqueId) ||
      controller.jumpRequested ||
      controller.parkour?.attached ||
      (this.jumpSequence !== undefined &&
        controller.jumpEvent?.sequence !== this.jumpSequence) ||
      Boolean(controller.jump?.airborne) !== this.airborne
    ) {
      this.cancel(
        blocking || input?.blocking || combat?.blocking
          ? "blocked"
          : "interrupted",
      );
      return 0;
    }
    if (this.sequence === null && attack) this.sequence = attack.sequence;
    if (
      this.body?.active !== true ||
      this.candidate?.spawned === false ||
      !finiteVector(this.body.position) ||
      !finiteVector(controller.root.position) ||
      !world?.move
    ) {
      this.cancel("target-lost");
      return 0;
    }
    let remaining = Math.min(dt, this.duration - this.elapsed);
    const before = this.traveled;
    while (remaining > EPS && this.active) {
      const step = Math.min(remaining, 1 / 120);
      this.elapsed += step;
      remaining -= step;
      const start = controller.root.position;
      if (
        this.blocked(
          world,
          start,
          this.body.position,
          controller.radius ?? 0.36,
          this.body,
        )
      ) {
        this.cancel("occluded");
        break;
      }
      this.direction.subVectors(this.body.position, start).setY(0);
      const distance = this.direction.length();
      const clearance =
        (controller.radius ?? 0.36) + (this.body.radius ?? 0.32) + 0.015;
      if (distance <= clearance || this.remainingBudget <= EPS) {
        this.cancel("budget-or-contact");
        break;
      }
      this.direction.multiplyScalar(1 / distance);
      const speed = Math.hypot(controller.velocity.x, controller.velocity.z);
      const compatible =
        speed < 1 ||
        (controller.velocity.x * this.direction.x +
          controller.velocity.z * this.direction.z) /
          speed >
          0.8;
      if (!compatible || controller.dash?.active) {
        this.cancel("travel-intent");
        break;
      }
      // A fast player keeps every component of incoming velocity. The separate
      // approach can add only a small compatible displacement at high speeds.
      const maxSpeed = speed > 8 ? 2 : LIMITS.approachSpeed;
      const oldSpeed = this.approachSpeed;
      this.approachSpeed = Math.min(
        maxSpeed,
        oldSpeed + this.config.approachAcceleration * step,
      );
      const request = Math.min(
        (oldSpeed + this.approachSpeed) * 0.5 * step,
        this.remainingBudget,
        distance - clearance,
      );
      if (request <= EPS) continue;
      this.displacement.copy(this.direction).multiplyScalar(request);
      world.move(
        start,
        this.displacement,
        controller.radius ?? 0.36,
        this.resolved,
      );
      this.resolved.y = start.y;
      const actual = Math.hypot(
        this.resolved.x - start.x,
        this.resolved.z - start.z,
      );
      // A world adapter may recover a pre-existing overlap. Assistance must
      // never turn that recovery into an unbudgeted positional jump.
      if (!finiteVector(this.resolved) || actual > request + 1e-5) {
        this.cancel("collision-recovery");
        break;
      }
      start.copy(this.resolved);
      this.traveled += actual;
      if (actual < request * 0.05) {
        this.cancel("collision");
        break;
      }
    }
    if (this.active && this.elapsed >= this.duration - EPS)
      this.cancel("completed");
    return this.traveled - before;
  }
}
