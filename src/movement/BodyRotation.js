import { Quaternion, Vector3 } from "three";
export const BODY_ROTATION_CONFIG = Object.freeze({
  maxAngularSpeed: 18,
  flipLaunch: 11.5,
  pitchTorque: 18,
  rollTorque: 5,
  yawTorque: 3,
  airDrag: 0.85,
  invertedDrag: 7.5,
  invertedCoastSpeed: 3.5,
  recoveryStiffness: 75,
  recoveryDamping: 14,
  landingAssistStiffness: 10,
  landingAssistDamping: 1.5,
  spinSpeed: 18,
});
const UP = new Vector3(0, 1, 0);
/** Angular momentum is independent of travel, jump gravity, camera and attack
 * timelines. Quaternion integration stays bounded; no root translation occurs. */
export class BodyRotation {
  constructor(config = {}) {
    this.config = { ...BODY_ROTATION_CONFIG, ...config };
    for (const key of Object.keys(BODY_ROTATION_CONFIG))
      if (!Number.isFinite(this.config[key]) || this.config[key] <= 0)
        throw new RangeError(`Invalid angular ${key}`);
    this.config.maxAngularSpeed = Math.min(60, this.config.maxAngularSpeed);
    this.orientation = new Quaternion();
    this.angularVelocity = new Vector3();
    this.delta = new Quaternion();
    this.target = new Quaternion();
    this.error = new Quaternion();
    this.local = new Vector3();
    this.axis = new Vector3();
    this.forward = new Vector3(0, 0, -1);
    this.up = new Vector3();
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
    return this.phase === "backflip" || this.phase === "frontflip";
  }
  start(kind, heading, direction = 1, intensity = 1, referenceYaw = heading) {
    if (this.phase === "idle") this.orientation.setFromAxisAngle(UP, heading);
    this.referenceYaw = referenceYaw;
    this.elapsed = 0;
    this.sequence++;
    this.lastKind = kind;
    if (kind === "backflip" || kind === "frontflip") {
      this.phase = kind;
      const sign = kind === "backflip" ? 1 : -1;
      this.angularVelocity.x =
        sign *
        Math.max(10, sign * this.angularVelocity.x + this.config.flipLaunch);
      this.pitchTravel = 0;
    } else {
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
      air = movement.jump.airborne;
    if (this.phase === "idle") {
      this.orientation.setFromAxisAngle(UP, movement.heading);
      this.angularVelocity.set(0, 0, 0);
      this.lift = 0;
      this.invertedWeight = 0;
      return;
    }
    this.elapsed += dt;
    const x = input.move.x,
      y = input.move.y,
      sin = Math.sin(cameraYaw),
      cos = Math.cos(cameraYaw);
    this.local.set(x * cos - y * sin, 0, -x * sin - y * cos);
    const backwards =
      this.local.x * Math.sin(this.referenceYaw) +
      this.local.z * Math.cos(this.referenceYaw);
    const lateral =
      this.local.x * Math.cos(this.referenceYaw) -
      this.local.z * Math.sin(this.referenceYaw);
    this.up.copy(UP).applyQuaternion(this.orientation);
    this.invertedWeight = Math.max(0, Math.min(1, (-this.up.y - 0.15) / 0.85));
    if (this.flipping && air) {
      // Extra drag near inversion is soft and bypassed by deliberate pressure.
      const easing =
        c.invertedDrag *
        this.invertedWeight *
        Math.max(
          0,
          1 -
            (c.invertedCoastSpeed /
              Math.max(
                c.invertedCoastSpeed,
                Math.abs(this.angularVelocity.x),
              )) **
              2,
        ) *
        (1 -
          Math.max(
            0,
            Math.min(
              1,
              backwards *
                Math.sign(
                  this.angularVelocity.x ||
                    (this.lastKind === "frontflip" ? -1 : 1),
                ),
            ),
          ));
      this.angularVelocity.multiplyScalar(Math.exp(-(c.airDrag + easing) * dt));
      this.angularVelocity.x += backwards * c.pitchTorque * dt;
      this.angularVelocity.z -= lateral * c.rollTorque * dt;
      this.angularVelocity.y += lateral * c.yawTorque * dt;
      this.pitchTravel += this.angularVelocity.x * dt;
    } else if (
      this.phase === "spin" &&
      movement.jump.ready &&
      this.elapsed < 0.34
    ) {
      this.angularVelocity.y *= Math.exp(-0.8 * dt);
      this.angularVelocity.y += lateral * 2 * dt;
    } else {
      this.phase = "recover";
    }
    const landingSoon =
      air &&
      movement.jump.verticalVelocity < 0 &&
      movement.jump.timeToBoundary < 0.16;
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
    // Conservative visual head/foot clearance. This never alters the actor's
    // physical height or gravity and eases away as the body returns upright.
    const pivot = 0.955,
      headMinimum = movement.root.position.y + pivot + this.up.y * 1.04 - 0.2;
    const clearance = Math.max(0, Math.min(0.3, 0.025 - headMinimum));
    this.lift += (clearance - this.lift) * (1 - Math.exp(-35 * dt));
  }
  reset(heading = 0) {
    this.phase = "idle";
    this.angularVelocity.set(0, 0, 0);
    this.orientation.setFromAxisAngle(UP, heading);
    this.invertedWeight = 0;
    this.lift = 0;
  }
}
