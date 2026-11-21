import { Quaternion, Vector3 } from "three";
import {
  BODY_PIVOT,
  sampleLocalStrike,
  worldStrike,
} from "./TechniqueGeometry.js";
import {
  FREEFLOW_LIMITS as LIMITS,
  sanitizeFreeflow,
} from "../sandbox/FreeflowSettings.js";
export {
  FREEFLOW_DEFAULTS,
  FREEFLOW_PARAMETERS,
  FREEFLOW_LIMITS,
  sanitizeFreeflow,
} from "../sandbox/FreeflowSettings.js";

const EPS = 1e-8;
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const wrap = (n) => Math.atan2(Math.sin(n), Math.cos(n));
const finiteVector = (v) => v && [v.x, v.y, v.z].every(Number.isFinite);
const bodyOf = (candidate) => candidate?.body ?? candidate?.target ?? candidate;
const UP = new Vector3(0, 1, 0);
const finiteQuaternion = (q) =>
  q &&
  [q.x, q.y, q.z, q.w].every(Number.isFinite) &&
  q.x ** 2 + q.y ** 2 + q.z ** 2 + q.w ** 2 > EPS;

/** One accepted manual strike owns a short, collision-resolved movement intent.
 * Only CharacterController applies that intent; this class never moves a root,
 * starts an attack, changes authored reach, or records a hit.
 */
export class FreeflowCombat {
  constructor({ targets = [], config = {} } = {}) {
    this.targets = targets;
    this.config = sanitizeFreeflow(config);
    this.clock = 0;
    this.queries = 0;
    this.last = null;
    this.recentId = null;
    this.recentAt = -Infinity;
    this._active = this._ready = this._issued = false;
    this.reason = "idle";
    this.traveled = this.budget = this.elapsed = this.duration = 0;
    this.approachSpeed = 0;
    this.local = new Vector3();
    this.sampledLocal = new Vector3();
    this.strikePoint = new Vector3();
    this.orientation = new Quaternion();
    this.relativeOrientation = new Quaternion();
    this.delta = new Vector3();
    this.direction = new Vector3();
    this.intent = new Vector3();
    this.goal = new Vector3();
    this.goalWanted = new Vector3();
    this.start = new Vector3();
    this.entryVelocity = new Vector3();
    this.stepStart = new Vector3();
    this.targetStart = new Vector3();
    this.targetPoint = new Vector3();
    this.driver = {
      velocity: new Vector3(),
      heading: 0,
      turnRate: LIMITS.turnRate,
      verticalAssist: 0,
      collisionRecovery: false,
    };
  }

  configure(values) {
    this.config = sanitizeFreeflow(values);
    if (!this.config.enabled) this.cancel("disabled");
  }
  get active() {
    return this._active;
  }
  get ready() {
    return this._active && this._ready;
  }
  get holdWindup() {
    return this._active && !this._ready;
  }
  get phase() {
    return this._active ? (this._ready ? "contact" : "approach") : "idle";
  }
  get targetId() {
    return this._active ? (this.body?.id ?? null) : null;
  }
  get remainingBudget() {
    return Math.max(0, this.budget - this.traveled);
  }
  snapshot(out = {}) {
    return Object.assign(out, {
      enabled: this.config.enabled,
      active: this.active,
      ready: this.ready,
      holdWindup: this.holdWindup,
      phase: this.phase,
      targetId: this.targetId,
      selectedTargetId: this.last?.targetId ?? null,
      traveled: this.traveled,
      budget: this.budget,
      remainingBudget: this.remainingBudget,
      elapsed: this.elapsed,
      duration: this.duration,
      reason: this.reason,
      queries: this.queries,
      speed: this.approachSpeed,
    });
  }
  cancel(reason = "cancelled") {
    // Remove only velocity installed by this driver. A disabled Freeflow that
    // has never owned motion leaves the original controller path untouched.
    if (this._issued && this.controller?.velocity) {
      this.controller.velocity.x = this.controller.velocity.z = 0;
    }
    this._active = this._ready = this._issued = false;
    this.approachSpeed = 0;
    this.driver.velocity.set(0, 0, 0);
    this.driver.verticalAssist = 0;
    this.reason = reason;
  }
  reset() {
    this.cancel("reset");
    this.last = null;
    this.recentId = null;
    this.recentAt = -Infinity;
    this.traveled = this.budget = this.elapsed = this.duration = 0;
  }

  begin(controller, targets, technique, mode, world, options = {}) {
    const context = options.context ?? {};
    const action =
      typeof technique === "string"
        ? technique
        : (technique?.action ?? context.action);
    if (
      !this.config.enabled ||
      mode !== "combat" ||
      options.accepted !== true ||
      (context.source ?? options.source) !== "manual" ||
      context.gesture ||
      context.canAttack === false ||
      !["punch", "kick"].includes(action) ||
      !finiteVector(controller?.root?.position) ||
      !finiteVector(controller.velocity) ||
      options.blocking ||
      options.input?.blocking ||
      controller.jumpRequested ||
      controller.dashRequested ||
      controller.dash?.active ||
      controller.parkour?.attached
    ) {
      if (!this.config.enabled || mode !== "combat")
        this.cancel(!this.config.enabled ? "disabled" : "mode");
      return null;
    }
    if (typeof technique === "string")
      technique = {
        id: action,
        action,
        side: "right",
        animation: action,
        reach: action === "kick" ? 0.95 : 0.76,
        hitRadius: 0.1,
        originHeight: action === "kick" ? 1 : 1.4,
        maxVertical: 0.4,
        windup: 0.08,
        extension: 0.1,
        impact: 0,
        recovery: 0.24,
      };
    // A fresh accepted input may select a different target; no autonomous scan
    // happens between inputs, and hysteresis compares only reachable choices.
    this.entryVelocity.copy(controller.velocity);
    this.intentKind = this.readIntent(
      controller,
      options.input,
      options.cameraYaw,
    );
    this.cancel("no-target");
    this.last = null;
    this.traveled = this.elapsed = 0;
    this.controller = controller;
    this.world = world ?? controller.world;
    this.start.copy(controller.root.position);
    this.airborne = Boolean(controller.jump?.airborne);
    const range = this.airborne ? this.config.airRange : this.config.range;
    sampleLocalStrike(
      this.sampledLocal,
      technique,
      technique.windup + technique.extension,
      {},
    );
    this.relativeOrientation.identity();
    this.updateStrikeGeometry(controller, options.orientation);
    this.queries++;
    let best = null,
      recent = null;
    for (const candidate of targets ?? this.targets) {
      const body = bodyOf(candidate);
      if (
        !body ||
        body.active !== true ||
        candidate.spawned === false ||
        body.health === 0 ||
        !finiteVector(body.position)
      )
        continue;
      this.delta.subVectors(body.position, this.start);
      const distance = this.delta.length(),
        horizontal = Math.hypot(this.delta.x, this.delta.z);
      if (distance > range || horizontal < EPS) continue;
      this.direction
        .copy(this.delta)
        .setY(0)
        .multiplyScalar(1 / horizontal);
      const dot = this.direction.dot(this.intent);
      if (this.intentKind === "joystick" && dot < -0.1) continue;
      if (
        this.blocked(
          this.world,
          this.start,
          body.position,
          controller.radius ?? 0.36,
          body,
        )
      )
        continue;
      let boxChoice = null;
      for (const box of body.hitboxes ?? [
        { height: body.strikeHeight ?? 1.4, radius: body.strikeRadius ?? 0.24 },
      ]) {
        if (!Number.isFinite(box.height) || !(box.radius > 0)) continue;
        const rootY = body.position.y + box.height - this.localHeight;
        const dy = Math.abs(rootY - this.start.y);
        const verticalLimit = this.airborne
          ? Math.min(range, 0.4 + this.config.airStrength * 3)
          : Math.min(
              technique.maxVertical ?? 0.35,
              box.radius + (technique.hitRadius ?? 0.1),
            );
        if (dy > verticalLimit) continue;
        const gap = clamp(
          this.localDistance +
            (box.radius + (technique.hitRadius ?? 0.1)) * 0.62,
          0.75,
          0.9,
        );
        const needed = Math.hypot(
          Math.max(0, horizontal - gap),
          this.airborne ? dy : 0,
        );
        if (needed > this.config.maxApproach + LIMITS.contactTolerance)
          continue;
        if (!boxChoice || dy < boxChoice.dy)
          boxChoice = {
            box,
            height: box.height,
            radius: box.radius,
            rootY,
            gap,
            needed,
            dy,
          };
      }
      if (!boxChoice) continue;
      const directional =
        (1 - dot) *
        this.config.directionBias *
        (this.intentKind === "joystick"
          ? 2
          : this.intentKind === "travel"
            ? 1.6
            : 0.65);
      const score = distance / Math.max(0.1, range) + directional;
      const item = { candidate, body, ...boxChoice, dot, score };
      if (!best || score < best.score) best = item;
      if (
        body.id === this.recentId &&
        this.clock - this.recentAt <= LIMITS.hysteresisDuration
      )
        recent = item;
    }
    const margin = (1 - this.config.switchSensitivity) * 0.32;
    if (
      recent &&
      best &&
      recent.score <= best.score + margin &&
      !(this.intentKind === "joystick" && best.dot > recent.dot + 0.22)
    )
      best = recent;
    if (!best) return null;
    if (
      (this.config.speed <= 0 ||
        this.config.acceleration <= 0 ||
        this.config.maxApproach <= 0) &&
      best.needed > LIMITS.contactTolerance
    )
      return null;
    this.candidate = best.candidate;
    this.body = best.body;
    this.targetBox = best.box;
    this.technique = technique;
    this.targetHeight = best.height;
    this.targetRadius = best.radius;
    this.contactGap = best.gap;
    this.budget = this.config.maxApproach;
    this.sequence = options.sequence ?? null;
    this.jumpSequence = controller.jumpEvent?.sequence;
    this.targetStart.copy(best.body.position);
    this.updateGoal(controller, 0, true);
    this.direction.subVectors(this.goal, this.start).setY(0);
    const distance = this.direction.length();
    if (distance > EPS) this.direction.multiplyScalar(1 / distance);
    this.approachSpeed = Math.min(
      this.config.speed,
      Math.max(0, this.entryVelocity.dot(this.direction)),
      Math.sqrt(2 * this.config.acceleration * distance),
    );
    this.duration = clamp(
      0.25 +
        2 * Math.sqrt(best.needed / Math.max(1, this.config.acceleration)) +
        best.needed / Math.max(1, this.config.speed),
      0.65,
      LIMITS.timeout,
    );
    this._active = true;
    this._ready = false;
    this.reason = "approaching";
    this.recentId = best.body.id;
    this.recentAt = this.clock;
    this.last = Object.freeze({
      freeflow: true,
      targetId: best.body.id,
      targetHeight: best.height,
      axis: Object.freeze([0, 1, 0]),
      angle: 0,
      strength: 1,
      score: best.score,
      side: technique.side,
      budget: this.budget,
      duration: this.duration,
      contactGap: this.contactGap,
    });
    return this.last;
  }

  readIntent(controller, input, cameraYaw = 0) {
    const x = Number.isFinite(input?.move?.x) ? input.move.x : 0;
    const y = Number.isFinite(input?.move?.y) ? input.move.y : 0;
    const yaw = Number.isFinite(cameraYaw)
      ? cameraYaw
      : (controller.heading ?? 0);
    if (Math.hypot(x, y) > 0.12) {
      this.intent
        .set(
          x * Math.cos(yaw) - y * Math.sin(yaw),
          0,
          -x * Math.sin(yaw) - y * Math.cos(yaw),
        )
        .normalize();
      return "joystick";
    }
    this.intent.copy(controller.velocity).setY(0);
    if (this.intent.lengthSq() > 1) {
      this.intent.normalize();
      return "travel";
    }
    this.intent.set(-Math.sin(yaw), 0, -Math.cos(yaw));
    return "camera";
  }

  updateStrikeGeometry(controller, orientation) {
    const heading = controller.heading ?? 0;
    if (finiteQuaternion(orientation)) {
      this.orientation.copy(orientation).normalize();
      this.relativeOrientation
        .setFromAxisAngle(UP, -heading)
        .multiply(this.orientation);
    } else {
      this.orientation
        .setFromAxisAngle(UP, heading)
        .multiply(this.relativeOrientation);
    }
    // The full-extension endpoint is the exact shared fist/ankle path, tilted
    // around the same pelvis pivot as presentation and the hit detector.
    this.local.copy(this.sampledLocal);
    this.local.y -= BODY_PIVOT;
    this.local.applyQuaternion(this.relativeOrientation);
    this.local.y += BODY_PIVOT;
    this.localYaw = Math.atan2(-this.local.x, -this.local.z);
    this.localDistance = Math.hypot(this.local.x, this.local.z);
    this.localHeight = this.local.y;
  }

  blocked(world, start, target, radius, ownTarget) {
    this.delta.subVectors(target, start);
    if (world?.firstBlock?.(start, this.delta, radius * 0.4, 1.8)) return true;
    const squared = this.delta.x ** 2 + this.delta.z ** 2;
    if (squared < EPS) return false;
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
          squared,
        0,
        1,
      );
      if (fraction >= 1 - EPS) continue;
      if (
        Math.hypot(
          start.x + this.delta.x * fraction - obstacle.position.x,
          start.z + this.delta.z * fraction - obstacle.position.z,
        ) <
        obstacle.radius + radius * 0.4
      )
        return true;
    }
    return false;
  }

  updateTargetPoint() {
    this.targetPoint.copy(this.body.position);
    this.targetPoint.x += this.targetBox?.x ?? 0;
    this.targetPoint.z += this.targetBox?.z ?? 0;
    if (Number.isFinite(this.targetBox?.height))
      this.targetHeight = this.targetBox.height;
    return this.targetPoint;
  }
  updateGoal(controller, dt, immediate = false) {
    this.updateTargetPoint();
    const start = controller.root.position;
    this.direction.subVectors(this.targetPoint, start).setY(0);
    const distance = this.direction.length();
    if (distance > EPS) this.direction.multiplyScalar(1 / distance);
    else
      this.direction.set(
        -Math.sin(controller.heading ?? 0),
        0,
        -Math.cos(controller.heading ?? 0),
      );
    this.contactGap = clamp(
      this.localDistance +
        (this.targetRadius + (this.technique?.hitRadius ?? 0.1)) * 0.62,
      0.75,
      0.9,
    );
    this.goalWanted
      .copy(this.targetPoint)
      .addScaledVector(this.direction, -Math.min(distance, this.contactGap));
    this.goalWanted.y = this.airborne
      ? Math.max(0, this.body.position.y + this.targetHeight - this.localHeight)
      : start.y;
    if (immediate) this.goal.copy(this.goalWanted);
    else {
      // Live targets can move the goal only at a bounded rate. A teleport or
      // escaping target cannot turn a captured entry into unlimited pursuit.
      this.delta.subVectors(this.goalWanted, this.goal);
      const length = this.delta.length(),
        maximum = Math.max(4, this.config.speed) * dt;
      if (length > maximum && length > EPS)
        this.delta.multiplyScalar(maximum / length);
      this.goal.add(this.delta);
    }
    this.targetHeading =
      Math.atan2(-this.direction.x, -this.direction.z) -
      this.localYaw * this.config.alignment;
  }

  interrupted(
    controller,
    {
      combat,
      blocking,
      mode = "combat",
      input,
      cameraYaw = 0,
      dead = false,
    } = {},
  ) {
    const attack = combat?.attack;
    if (!this.config.enabled || mode !== "combat")
      return !this.config.enabled ? "disabled" : "mode";
    if (blocking || input?.blocking || combat?.blocking) return "blocked";
    if (dead || controller.dead || controller.health === 0) return "death";
    if (
      !attack?.active ||
      attack.cancelled ||
      attack.context?.source !== "manual" ||
      (this.sequence !== null && attack.sequence !== this.sequence) ||
      (this.technique?.id &&
        attack.techniqueId &&
        attack.techniqueId !== this.technique.id)
    )
      return "interrupted";
    if (
      controller.jumpRequested ||
      controller.dashRequested ||
      controller.dash?.active ||
      controller.parkour?.attached ||
      (this.jumpSequence !== undefined &&
        controller.jumpEvent?.sequence !== this.jumpSequence) ||
      Boolean(controller.jump?.airborne) !== this.airborne
    )
      return "movement";
    if (
      this.body?.active !== true ||
      this.body?.health === 0 ||
      this.candidate?.spawned === false ||
      !finiteVector(this.body?.position) ||
      !finiteVector(controller.root.position)
    )
      return "target-lost";
    if (this.sequence === null) this.sequence = attack.sequence;
    const x = input?.move?.x ?? 0,
      y = input?.move?.y ?? 0;
    if (Math.hypot(x, y) > 0.35) {
      const yaw = Number.isFinite(cameraYaw) ? cameraYaw : 0;
      this.intent
        .set(
          x * Math.cos(yaw) - y * Math.sin(yaw),
          0,
          -x * Math.sin(yaw) - y * Math.cos(yaw),
        )
        .normalize();
      this.direction
        .subVectors(this.updateTargetPoint(), controller.root.position)
        .setY(0)
        .normalize();
      if (this.intent.dot(this.direction) < -0.3) return "manual-away";
    }
    return null;
  }

  beforeStep(dt, controller, options = {}) {
    if (!Number.isFinite(dt) || dt <= 0) return null;
    this.clock += dt;
    if (!this._active) return null;
    const interruption = this.interrupted(controller, options);
    if (interruption) {
      this.cancel(interruption);
      return null;
    }
    const world = options.world ?? this.world ?? controller.world;
    if (
      this.blocked(
        world,
        controller.root.position,
        this.body.position,
        controller.radius ?? 0.36,
        this.body,
      )
    ) {
      this.fail("occluded", options.combat);
      return null;
    }
    if (this.elapsed >= this.duration) {
      if (this._ready) this.cancel("completed");
      else this.fail("timeout", options.combat);
      return null;
    }
    this.updateStrikeGeometry(controller, options.orientation);
    this.updateGoal(controller, dt);
    this.delta.subVectors(this.goal, controller.root.position).setY(0);
    const distance = this.delta.length();
    if (
      this.remainingBudget <= EPS &&
      !this._ready &&
      distance > LIMITS.contactTolerance
    ) {
      this.fail("budget", options.combat);
      return null;
    }
    this.approachSpeed = Math.min(
      this.config.speed,
      this.approachSpeed + this.config.acceleration * dt,
      Math.sqrt(2 * this.config.acceleration * distance),
      distance / dt,
      this.remainingBudget / dt,
    );
    if (distance < EPS) this.driver.velocity.set(0, 0, 0);
    else
      this.driver.velocity
        .copy(this.delta)
        .multiplyScalar(this.approachSpeed / distance);
    this.driver.heading = this.targetHeading;
    this.driver.turnRate =
      LIMITS.turnRate * (0.35 + 0.65 * this.config.alignment);
    this.driver.verticalAssist = 0;
    if (this.airborne && this.config.airStrength > 0) {
      const dy = this.goal.y - controller.root.position.y;
      const vertical = controller.jump?.verticalVelocity ?? 0;
      const acceleration =
        this.config.airStrength * LIMITS.verticalAcceleration;
      // A damped acceleration assists a short 3D approach while JumpState
      // continues applying gravity and owns jump counts and floor contact.
      this.driver.verticalAssist = clamp(
        dy * 100 -
          vertical * 16 +
          (controller.jump?.config?.gravity ?? 18) * 0.85,
        -acceleration,
        acceleration,
      );
      const verticalTravel = Math.abs(
        vertical * dt + this.driver.verticalAssist * dt * dt * 0.5,
      );
      const horizontalBudget = Math.sqrt(
        Math.max(0, this.remainingBudget ** 2 - verticalTravel ** 2),
      );
      if (this.driver.velocity.length() * dt > horizontalBudget)
        this.driver.velocity.setLength(horizontalBudget / dt);
    }
    this.driver.collisionRecovery = false;
    this.stepStart.copy(controller.root.position);
    this.requestedDistance = this.driver.velocity.length() * dt;
    this._issued = true;
    this.elapsed += dt;
    return this.driver;
  }

  fail(reason, combat) {
    this.cancel(reason);
    combat?.cancelAttack?.(`freeflow-${reason}`);
  }

  afterStep(dt, controller, options = {}) {
    if (!this._active || !this._issued || !Number.isFinite(dt) || dt <= 0)
      return false;
    const interruption = this.interrupted(controller, options);
    if (interruption) {
      this.cancel(interruption);
      return false;
    }
    const moved = this.stepStart.distanceTo(controller.root.position);
    this.traveled += moved;
    if (this.driver.collisionRecovery || this.traveled > this.budget + 1e-5) {
      this.fail("collision-or-budget", options.combat);
      return false;
    }
    const horizontalMoved = Math.hypot(
      controller.root.position.x - this.stepStart.x,
      controller.root.position.z - this.stepStart.z,
    );
    if (
      this.requestedDistance > 0.02 &&
      horizontalMoved < this.requestedDistance * 0.05
    ) {
      this.fail("collision", options.combat);
      return false;
    }
    this.updateStrikeGeometry(controller, options.orientation);
    this.direction
      .subVectors(this.updateTargetPoint(), controller.root.position)
      .setY(0);
    const rootDistance = this.direction.length();
    const horizontal = Math.max(0, rootDistance - this.contactGap);
    const vertical = Math.abs(
      this.body.position.y +
        this.targetHeight -
        this.localHeight -
        controller.root.position.y,
    );
    const heading =
      Math.atan2(-this.direction.x, -this.direction.z) -
      this.localYaw * this.config.alignment;
    const facing = Math.abs(wrap(heading - controller.heading));
    worldStrike(
      this.strikePoint,
      this.sampledLocal,
      controller.root.position,
      this.orientation,
    );
    const physicalGap = Math.hypot(
      this.strikePoint.x - this.targetPoint.x,
      this.strikePoint.y - this.targetPoint.y - this.targetHeight,
      this.strikePoint.z - this.targetPoint.z,
    );
    const physicalContact =
      physicalGap <=
      this.targetRadius + (this.technique.hitRadius ?? 0.1) + 0.01;
    if (
      horizontal <= LIMITS.contactTolerance &&
      (!this.airborne || vertical <= 0.18) &&
      facing <= LIMITS.facingTolerance &&
      physicalContact
    ) {
      this._ready = true;
      this.reason = "contact-ready";
    }
    return this.ready;
  }
}
