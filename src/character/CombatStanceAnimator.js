import { MathUtils } from "three";
import { ANIME_STYLE } from "./AnimationStyle.js";

/** Guard overlay only. Future strikes/blocks can replace this layer separately
 * from the gait clock, foot planting, input, and world movement.
 */
export class CombatStanceAnimator {
  constructor(style = ANIME_STYLE.locomotion) {
    this.style = style;
    this.weight = 0;
    this.intent = 0;
    this.time = 0;
  }

  update(dt, fighting) {
    this.time += dt;
    // Two damped stages give the transition a gentle onset as well as a
    // gentle finish, instead of moving a large Euler arc on the first frame.
    this.intent = MathUtils.damp(this.intent, fighting ? 1 : 0, 16, dt);
    this.weight = MathUtils.damp(this.weight, this.intent, 16, dt);
    return this.weight;
  }

  apply(pose, movementBlend, sprintBlend = 0) {
    const weight = this.weight;
    const quiet = 1 - movementBlend;
    const breath = Math.sin(this.time * 2.3);
    const shift = Math.sin(this.time * 1.35);
    pose.hipX = MathUtils.lerp(pose.hipX, shift * 0.01 * quiet, weight);
    pose.hipY = MathUtils.lerp(
      pose.hipY,
      0.885 -
        movementBlend * 0.035 -
        sprintBlend * 0.015 +
        breath * 0.004 +
        Math.abs(shift) * 0.003 * quiet,
      weight,
    );
    pose.hipYaw = MathUtils.lerp(
      pose.hipYaw,
      0.1 + shift * 0.012 * quiet,
      weight,
    );
    pose.hipRoll = MathUtils.lerp(pose.hipRoll, shift * 0.008 * quiet, weight);
    pose.spinePitch = MathUtils.lerp(
      pose.spinePitch,
      -0.055 - sprintBlend * this.style.guardLean + breath * 0.006,
      weight,
    );
    pose.spineYaw = MathUtils.lerp(pose.spineYaw, -0.035, weight);
    pose.headPitch = MathUtils.lerp(
      pose.headPitch,
      -0.055 + sprintBlend * 0.04,
      weight,
    );
    for (let index = 0; index < 2; index++) {
      const arm = pose.arms[index];
      const left = index === 0;
      arm.x = MathUtils.lerp(
        arm.x,
        (left ? 1.1 : 1.04) + breath * 0.008,
        weight,
      );
      arm.y = MathUtils.lerp(arm.y, left ? -0.06 : 0.06, weight);
      arm.z = MathUtils.lerp(arm.z, left ? 0.18 : -0.18, weight);
      arm.elbow = MathUtils.lerp(arm.elbow, left ? 1.76 : 1.84, weight);
    }
  }
}
