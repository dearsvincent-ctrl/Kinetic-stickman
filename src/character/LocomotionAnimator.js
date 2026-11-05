import { MathUtils } from "three";

/** Speed-driven gait settings and a continuous phase clock; no rig ownership.
 * Stride is the ground distance covered by one foot during its contact period.
 * Cadence follows actual travel, so analog creep never plays a full-speed run.
 */
export class LocomotionAnimator {
  constructor() {
    this.phase = 0;
    this.time = 0;
    this.movementBlend = 0;
    this.runBlend = 0;
    this.stride = 0.34;
    this.duty = 0.66;
    this.lift = 0.055;
    this.cadence = 0;
  }

  update(dt, { speed = 0, combatWeight = 0 } = {}) {
    speed = Math.max(0, speed);
    this.time += dt;
    this.movementBlend = MathUtils.damp(
      this.movementBlend,
      Math.min(speed / 0.25, 1),
      12,
      dt,
    );
    this.runBlend = MathUtils.damp(
      this.runBlend,
      MathUtils.smoothstep(speed, 2.7, 4.25),
      10,
      dt,
    );
    const brisk = MathUtils.smoothstep(speed, 0.2, 2.6);
    const fast = MathUtils.smoothstep(speed, 0.2, 5.2);
    const freeStride = MathUtils.lerp(
      MathUtils.lerp(0.34, 0.7, brisk),
      0.86,
      this.runBlend,
    );
    const freeDuty = MathUtils.lerp(
      MathUtils.lerp(0.66, 0.58, brisk),
      0.34,
      this.runBlend,
    );
    const freeLift = MathUtils.lerp(0.055 + brisk * 0.025, 0.14, this.runBlend);
    // A shorter contact interval at high speed keeps guard steps controlled
    // without changing travel speed or requiring an extreme shuffle cadence.
    const guardStride = MathUtils.lerp(0.25, 0.56, fast);
    const guardDuty = MathUtils.lerp(0.55, 0.28, fast);
    this.stride = MathUtils.damp(
      this.stride,
      MathUtils.lerp(freeStride, guardStride, combatWeight),
      12,
      dt,
    );
    this.duty = MathUtils.damp(
      this.duty,
      MathUtils.lerp(freeDuty, guardDuty, combatWeight),
      12,
      dt,
    );
    this.lift = MathUtils.damp(
      this.lift,
      MathUtils.lerp(
        freeLift,
        MathUtils.lerp(0.045, 0.075, fast),
        combatWeight,
      ),
      12,
      dt,
    );
    this.cadence = speed < 0.015 ? 0 : (speed * this.duty) / this.stride;
    this.phase += this.cadence * dt;
    return this;
  }

  sampleUpperBody(pose) {
    const wave = Math.cos(this.phase * Math.PI * 2);
    const weight = this.movementBlend;
    const amplitude = MathUtils.lerp(0.23, 0.43, this.runBlend) * weight;
    const breath = Math.sin(this.time * 2.1);
    pose.hipX = Math.sin(this.phase * Math.PI * 2) * 0.012 * weight;
    pose.hipY =
      0.955 -
      weight * (0.025 + 0.07 * this.runBlend) +
      breath * 0.004 * (1 - weight);
    pose.hipYaw = Math.sin(this.phase * Math.PI * 2) * 0.045 * weight;
    pose.hipRoll = -Math.sin(this.phase * Math.PI * 2) * 0.014 * weight;
    pose.spinePitch = -MathUtils.lerp(0.025, 0.13, this.runBlend) * weight;
    pose.spineYaw = -pose.hipYaw * 0.65;
    pose.headPitch = -0.015 * weight;
    for (let index = 0; index < 2; index++) {
      const arm = pose.arms[index];
      const sign = index === 0 ? -1 : 1;
      const swing = index === 0 ? wave : -wave;
      arm.x = -swing * amplitude;
      arm.y = 0;
      arm.z = sign * 0.055;
      arm.elbow =
        0.12 + this.runBlend * 0.65 + Math.max(0, swing) * 0.12 * weight;
    }
  }
}
