import { MathUtils, Quaternion, Vector3 } from "three";
import { ANIME_STYLE } from "./AnimationStyle.js";

/** Resolved motion -> visual launch/brake/bank accents. No input buffering,
 * forces, root offsets, physics timing or movement-state ownership. */
export class MotionPresentation {
  constructor(style = ANIME_STYLE.motion) {
    this.style = style;
    this.previousSpeed = 0;
    this.drive = 0;
    this.brake = 0;
    this.bank = 0;
    this.local = new Vector3();
    this.inverse = new Quaternion();
  }

  update(dt, velocity, quaternion, enabled, reset = false) {
    const speed = Math.hypot(velocity.x, velocity.z);
    const change = reset ? 0 : (speed - this.previousSpeed) / dt;
    this.previousSpeed = speed;
    this.inverse.copy(quaternion).invert();
    this.local.copy(velocity).setY(0).applyQuaternion(this.inverse);
    const s = this.style;
    this.drive = MathUtils.damp(
      this.drive,
      enabled ? MathUtils.clamp(change / s.accelerationScale, 0, 1) : 0,
      s.response,
      dt,
    );
    this.brake = MathUtils.damp(
      this.brake,
      enabled ? MathUtils.clamp(-change / s.accelerationScale, 0, 1) : 0,
      s.response,
      dt,
    );
    this.bank = MathUtils.damp(
      this.bank,
      enabled ? MathUtils.clamp(this.local.x / 5.2, -1, 1) : 0,
      s.response,
      dt,
    );
  }

  apply(pose, weight) {
    const s = this.style;
    pose.spinePitch +=
      (-this.drive * s.startLean + this.brake * s.brakeLean) * weight;
    pose.spineRoll -= this.bank * s.bank * weight;
    pose.hipY -= (this.drive + this.brake) * s.compression * weight;
    pose.hipZ += this.brake * 0.025 * weight;
    pose.headPitch += (this.drive - this.brake) * 0.035 * weight;
  }
}
