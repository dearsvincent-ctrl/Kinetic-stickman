import { MathUtils } from "three";
import { ANIME_STYLE } from "./AnimationStyle.js";
import { RunningGait } from "./RunningGait.js";

/** Speed-driven contact clock: stride is travel during a foot's planted phase.
 * Walking, running and sprinting blend continuously from resolved speed. */
export class LocomotionAnimator {
  constructor(style = ANIME_STYLE.locomotion) {
    this.style = style;
    this.running = new RunningGait(style);
    this.freeRunBlend = 0;
    this.phase = 0;
    this.time = 0;
    this.dt = 0;
    this.movementBlend = 0;
    this.runBlend = 0;
    this.sprintBlend = 0;
    this.stride = style.walkStride;
    this.duty = style.walkDuty;
    this.lift = style.walkLift;
    this.cadence = 0;
  }

  update(dt, { speed = 0, combatWeight = 0 } = {}) {
    const s = this.style;
    this.dt = dt;
    speed = Math.max(0, speed);
    this.time += dt;
    this.movementBlend = MathUtils.damp(
      this.movementBlend,
      Math.min(speed / 0.25, 1),
      s.response,
      dt,
    );
    this.runBlend = MathUtils.damp(
      this.runBlend,
      MathUtils.smoothstep(speed, s.runStart, s.runFull),
      s.response,
      dt,
    );
    this.sprintBlend = MathUtils.damp(
      this.sprintBlend,
      MathUtils.smoothstep(speed, s.sprintStart, s.sprintFull),
      s.response,
      dt,
    );
    this.freeRunBlend = this.runBlend * (1 - combatWeight);
    const brisk = MathUtils.smoothstep(speed, 0.2, 2.6);
    const fast = MathUtils.smoothstep(speed, 0.2, 5.2);
    const freeStride = MathUtils.lerp(
      MathUtils.lerp(s.walkStride, s.runStride, brisk),
      s.sprintStride,
      this.sprintBlend,
    );
    const freeDuty = MathUtils.lerp(
      MathUtils.lerp(s.walkDuty, s.runDuty, this.runBlend),
      s.sprintDuty,
      this.sprintBlend,
    );
    const freeLift = MathUtils.lerp(
      MathUtils.lerp(s.walkLift, s.runLift, this.runBlend),
      s.sprintLift,
      this.sprintBlend,
    );
    const guardStride = MathUtils.lerp(0.25, s.guardStride, fast);
    const guardDuty = MathUtils.lerp(0.55, s.guardDuty, fast);
    this.stride = MathUtils.damp(
      this.stride,
      MathUtils.lerp(freeStride, guardStride, combatWeight),
      s.response,
      dt,
    );
    this.duty = MathUtils.damp(
      this.duty,
      MathUtils.lerp(freeDuty, guardDuty, combatWeight),
      s.response,
      dt,
    );
    this.lift = MathUtils.damp(
      this.lift,
      MathUtils.lerp(
        freeLift,
        MathUtils.lerp(0.045, s.guardLift, fast),
        combatWeight,
      ),
      s.response,
      dt,
    );
    this.cadence = speed < 0.015 ? 0 : (speed * this.duty) / this.stride;
    this.phase += this.cadence * dt;
    return this;
  }

  sampleUpperBody(pose, phaseOffset = 0, acceleration = 0) {
    const s = this.style;
    const angle = (this.phase + phaseOffset) * Math.PI * 2;
    const wave = Math.cos(angle),
      swing = Math.sin(angle);
    const weight = this.movementBlend;
    const amplitude =
      MathUtils.lerp(
        MathUtils.lerp(s.walkArm, s.runArm, this.runBlend),
        s.sprintArm,
        this.sprintBlend,
      ) * weight;
    const breath = Math.sin(this.time * 2.1);
    const bob =
      MathUtils.lerp(s.bob, s.sprintBob, this.sprintBlend) * this.runBlend;
    pose.hipX = swing * MathUtils.lerp(0.012, 0.02, this.sprintBlend) * weight;
    pose.hipZ = 0;
    pose.hipY =
      0.955 -
      weight * (0.025 + 0.025 * this.runBlend + 0.045 * this.sprintBlend) +
      Math.cos(angle * 2) * bob * weight +
      breath * 0.004 * (1 - weight);
    pose.hipYaw =
      swing *
      MathUtils.lerp(s.hipTwist, s.sprintTwist, this.sprintBlend) *
      weight;
    pose.hipRoll = -swing * 0.02 * weight;
    pose.spinePitch =
      -MathUtils.lerp(
        MathUtils.lerp(s.walkLean, s.runLean, this.runBlend),
        s.sprintLean,
        this.sprintBlend,
      ) * weight;
    pose.spineYaw = -pose.hipYaw * s.shoulderCounter;
    pose.spineRoll = swing * 0.025 * weight;
    pose.headPitch = MathUtils.lerp(-0.015, 0.1, this.sprintBlend) * weight;
    for (let i = 0; i < 2; i++) {
      const arm = pose.arms[i],
        sign = i === 0 ? -1 : 1;
      const drive = i === 0 ? wave : -wave;
      arm.x = -drive * amplitude;
      arm.y =
        drive * (0.035 * this.runBlend + 0.065 * this.sprintBlend) * weight;
      arm.z = sign * (0.055 + 0.03 * this.sprintBlend);
      arm.elbow =
        0.12 +
        MathUtils.lerp(s.runElbow, s.sprintElbow, this.sprintBlend) *
          this.runBlend *
          weight +
        Math.max(0, drive) * 0.12 * weight;
    }
    this.running.applyBody(pose, this, this.phase + phaseOffset, acceleration);
  }
}
