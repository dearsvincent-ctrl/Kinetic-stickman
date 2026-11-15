import { Quaternion, Vector3 } from "three";
import {
  AutomaticFlip,
  AUTOMATIC_FLIP_CONFIG,
  FLIP_KINDS,
} from "./AutomaticFlip.js";
export const BODY_ROTATION_CONFIG = Object.freeze({
  ...AUTOMATIC_FLIP_CONFIG,
  maxAngularSpeed: 26,
  recoveryResponse: 16,
  recoveryStiffness: 75,
  recoveryDamping: 14,
  landingAssistStiffness: 10,
  landingAssistDamping: 1.5,
  spinSpeed: 18,
});
const UP = new Vector3(0, 1, 0);
/** Automatic flips and legacy angular technique motion share a body-only
 * quaternion. Travel, jump gravity, camera and attack timelines stay independent. */
export class BodyRotation {
  constructor(config = {}) {
    this.config = { ...BODY_ROTATION_CONFIG, ...config };
    for (const key of Object.keys(config))
      if (!Object.hasOwn(BODY_ROTATION_CONFIG, key))
        throw new RangeError(`Unknown angular ${key}`);
    for (const key of Object.keys(BODY_ROTATION_CONFIG))
      if (!Number.isFinite(this.config[key]) || this.config[key] <= 0)
        throw new RangeError(`Invalid angular ${key}`);
    this.config.maxAngularSpeed = Math.max(
      12,
      Math.min(60, this.config.maxAngularSpeed),
    );
    this.config.flipDuration = Math.min(
      1.2,
      Math.max(0.25, this.config.flipDuration),
    );
    this.config.minFlipDuration = Math.min(
      0.6,
      Math.max(0.2, this.config.minFlipDuration),
    );
    this.automatic = new AutomaticFlip(this.config);
    this.previousOrientation = new Quaternion();
    this.completedFlips = 0;
    this.rollTravel = 0;
    this.rotationTravel = 0;
    this.automaticRecovery = false;
    this.orientation = new Quaternion();
    this.angularVelocity = new Vector3();
    this.delta = new Quaternion();
    this.target = new Quaternion();
    this.error = new Quaternion();
    this.local = new Vector3();
    this.axis = new Vector3();
    this.forward = new Vector3(0, 0, -1);
    this.up = new Vector3(0, 1, 0);
    this.referenceYaw = 0;
    this.phase = "idle";
    this.time = 0;
    this.elapsed = 0;
    this.sequence = 0;
    this.pitchTravel = 0;
    this.invertedWeight = 0;
    this.lift = 0;
    this.lastKind = "none";
  }
  get flipping() {
    return FLIP_KINDS.includes(this.phase);
  }
  start(
    kind,
    heading,
    direction = 1,
    intensity = 1,
    referenceYaw = heading,
    airTime = Infinity,
  ) {
    if (this.phase === "idle") this.orientation.setFromAxisAngle(UP, heading);
    this.referenceYaw = referenceYaw;
    this.elapsed = 0;
    this.sequence++;
    this.lastKind = kind;
    if (FLIP_KINDS.includes(kind)) {
      this.phase = kind;
      this.automaticRecovery = true;
      this.automatic.start(kind, this.orientation, referenceYaw, airTime);
      this.angularVelocity.set(0, 0, 0);
      this.pitchTravel = this.rollTravel = this.rotationTravel = 0;
    } else {
      this.automatic.stop("technique");
      this.automaticRecovery = false;
      this.phase = "spin";
      this.angularVelocity.y =
        direction * this.config.spinSpeed * (0.8 + 0.2 * intensity);
      this.angularVelocity.z += -direction * 0.3;
    }
    this.angularVelocity.clampLength(0, this.config.maxAngularSpeed);
  }
  update(dt, movement, input, cameraYaw) {
    if (!Number.isFinite(dt) || dt <= 0) return;
    let remaining = Math.min(dt, 0.25);
    while (remaining > 1e-9) {
      const step = Math.min(remaining, 1 / 120);
      this.advance(step, movement, input, cameraYaw);
      remaining -= step;
    }
  }
  advance(dt, movement, input, cameraYaw) {
    this.time += dt;
    const c = this.config,
      air = movement.jump.airborne && !movement.parkour?.attached;
    if (this.phase === "idle") {
      this.orientation.setFromAxisAngle(UP, movement.heading);
      this.angularVelocity.set(0, 0, 0);
      this.lift = 0;
      this.invertedWeight = 0;
      this.up.copy(UP);
      return;
    }
    this.elapsed += dt;
    if (this.flipping) {
      const landingTime =
        movement.jump.timeToLanding ?? movement.jump.timeToBoundary;
      const imminent =
        air &&
        movement.jump.verticalVelocity < 0 &&
        landingTime < 0.14 &&
        this.automatic.duration - this.automatic.elapsed > landingTime;
      if (this.automatic.active && air && !imminent) {
        this.previousOrientation.copy(this.orientation);
        const completed = this.automatic.advance(dt, this.orientation);
        this.rotationTravel = this.automatic.angle;
        this.pitchTravel =
          this.automatic.axis.x * this.automatic.sign * this.rotationTravel;
        this.rollTravel =
          this.automatic.axis.z * this.automatic.sign * this.rotationTravel;
        this.measureRate(dt);
        if (completed) {
          this.completedFlips++;
          this.phase = "recover";
          this.angularVelocity.set(0, 0, 0);
        }
        this.clearance(dt, movement);
        return;
      }
      this.automatic.stop(
        movement.parkour?.attached
          ? "parkour"
          : imminent
            ? "landing-anticipation"
            : "contact",
      );
      this.automaticRecovery = true;
      this.phase = "recover";
    }
    if (this.phase === "recover" && this.automaticRecovery) {
      this.previousOrientation.copy(this.orientation);
      this.target.setFromAxisAngle(UP, movement.heading);
      const angle = this.orientation.angleTo(this.target);
      this.orientation.rotateTowards(
        this.target,
        Math.min(
          c.maxAngularSpeed * dt,
          angle * (1 - Math.exp(-c.recoveryResponse * dt)),
        ),
      );
      this.measureRate(dt);
      if (angle < 0.001 && this.angularVelocity.length() < 0.05) {
        this.orientation.copy(this.target);
        this.angularVelocity.set(0, 0, 0);
        this.phase = "idle";
      }
      this.clearance(dt, movement);
      return;
    }
    const x = input.move.x,
      y = input.move.y,
      sin = Math.sin(cameraYaw),
      cos = Math.cos(cameraYaw);
    this.local.set(x * cos - y * sin, 0, -x * sin - y * cos);
    const lateral =
      this.local.x * Math.cos(this.referenceYaw) -
      this.local.z * Math.sin(this.referenceYaw);
    this.up.copy(UP).applyQuaternion(this.orientation);
    this.invertedWeight = Math.max(0, Math.min(1, (-this.up.y - 0.15) / 0.85));
    if (this.phase === "spin" && movement.jump.ready && this.elapsed < 0.34) {
      this.angularVelocity.y *= Math.exp(-0.8 * dt);
      this.angularVelocity.y += lateral * 2 * dt;
    } else {
      this.phase = "recover";
    }
    const landingSoon =
      air &&
      movement.jump.verticalVelocity < 0 &&
      (movement.jump.timeToLanding ?? movement.jump.timeToBoundary) < 0.16;
    const recovering = this.phase === "recover" || (!air && this.flipping);
    if (recovering || landingSoon) {
      if (!air) this.phase = "recover";
      this.target.setFromAxisAngle(UP, movement.heading);
      this.error
        .copy(this.orientation)
        .invert()
        .multiply(this.target)
        .normalize();
      if (this.error.w < 0)
        this.error.set(
          -this.error.x,
          -this.error.y,
          -this.error.z,
          -this.error.w,
        );
      const angle = 2 * Math.acos(Math.max(-1, Math.min(1, this.error.w)));
      this.axis.set(this.error.x, this.error.y, this.error.z);
      if (this.axis.lengthSq() > 1e-10)
        this.angularVelocity.addScaledVector(
          this.axis.normalize(),
          angle *
            (landingSoon ? c.landingAssistStiffness : c.recoveryStiffness) *
            dt,
        );
      this.angularVelocity.multiplyScalar(
        Math.exp(
          -(landingSoon ? c.landingAssistDamping : c.recoveryDamping) * dt,
        ),
      );
    }
    this.angularVelocity.clampLength(0, c.maxAngularSpeed);
    const speed = this.angularVelocity.length();
    if (speed > 1e-8) {
      this.axis.copy(this.angularVelocity).multiplyScalar(1 / speed);
      this.delta.setFromAxisAngle(this.axis, speed * dt);
      this.orientation.multiply(this.delta).normalize();
    }
    if (
      !air &&
      this.phase === "recover" &&
      this.orientation.angleTo(this.target) < 0.012 &&
      speed < 0.15
    ) {
      this.orientation.copy(this.target);
      this.angularVelocity.set(0, 0, 0);
      this.phase = "idle";
    }
    this.clearance(dt, movement);
  }
  measureRate(dt) {
    this.delta
      .copy(this.previousOrientation)
      .invert()
      .multiply(this.orientation)
      .normalize();
    if (this.delta.w < 0)
      this.delta.set(
        -this.delta.x,
        -this.delta.y,
        -this.delta.z,
        -this.delta.w,
      );
    const angle = 2 * Math.acos(Math.max(-1, Math.min(1, this.delta.w)));
    this.angularVelocity.set(this.delta.x, this.delta.y, this.delta.z);
    if (this.angularVelocity.lengthSq() > 1e-16)
      this.angularVelocity.setLength(angle / dt);
    else this.angularVelocity.set(0, 0, 0);
    this.angularVelocity.clampLength(0, this.config.maxAngularSpeed);
  }
  clearance(dt, movement) {
    this.up.copy(UP).applyQuaternion(this.orientation);
    this.invertedWeight = Math.max(0, Math.min(1, (-this.up.y - 0.15) / 0.85));
    const headMinimum =
      movement.root.position.y + 0.955 + this.up.y * 1.04 - 0.2;
    const support = movement.parkour?.attached
      ? 0
      : (movement.jump.landingFloor ?? movement.jump.floorHeight ?? 0);
    const required = Math.max(0, Math.min(0.42, support + 0.025 - headMinimum));
    // Follow descent immediately, release smoothly. This is a body-pivot visual
    // clearance, never a change to root height, gravity or collision support.
    this.lift = Math.max(
      required,
      this.lift + (required - this.lift) * (1 - Math.exp(-35 * dt)),
    );
  }
  reset(heading = 0) {
    this.phase = "idle";
    this.automatic.reset();
    this.automaticRecovery = false;
    this.angularVelocity.set(0, 0, 0);
    this.orientation.setFromAxisAngle(UP, heading);
    this.invertedWeight = 0;
    this.up.copy(UP);
    this.lift = 0;
  }
}
