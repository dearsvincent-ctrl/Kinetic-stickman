import { MathUtils } from "three";

/**
 * Procedural pose provider, separate from movement and the character structure.
 * Replace update() with AnimationMixer/IK output when a richer rig is introduced.
 */
export class LocomotionAnimator {
  constructor(character) {
    this.character = character;
    this.phase = 0;
    this.time = 0;
    this.blend = 0;
    this.runBlend = 0;
  }

  update(dt, { speed = 0, maxSpeed = 3, sprinting = false } = {}) {
    const j = this.character.joints;
    const dimensions = this.character.dimensions;
    this.time += dt;
    this.blend = MathUtils.damp(this.blend, Math.min(speed / 0.65, 1), 10, dt);
    this.runBlend = MathUtils.damp(
      this.runBlend,
      sprinting && speed > 2.4 ? 1 : 0,
      7,
      dt,
    );
    // Phase advances from actual travel speed, so pressing into a wall returns
    // the character to idle instead of endlessly running on the spot.
    const frequency = MathUtils.lerp(1.55, 2.2, this.runBlend);
    this.phase +=
      dt *
      Math.PI *
      2 *
      frequency *
      Math.min(speed / Math.max(maxSpeed * 0.6, 0.1), 1.25);
    const stride = MathUtils.lerp(0.28, 0.39, this.runBlend) * this.blend;
    const lift = MathUtils.lerp(0.1, 0.18, this.runBlend) * this.blend;
    const breath = Math.sin(this.time * 2.2) * 0.007 * (1 - this.blend);
    const bob = (Math.cos(this.phase * 2) * 0.012 - 0.012) * this.blend;
    // Lower the pelvis slightly during locomotion so stance feet can reach the
    // floor throughout the stride without over-extending either leg.
    const crouch = MathUtils.lerp(0.07, 0.12, this.runBlend) * this.blend;
    j.hips.position.y = dimensions.hipHeight + breath + bob - crouch;
    j.hips.rotation.z = Math.sin(this.phase) * 0.025 * this.blend;
    j.spine.rotation.x =
      MathUtils.lerp(0.015, -0.11, this.runBlend) * this.blend;
    j.spine.rotation.y = Math.sin(this.phase) * 0.045 * this.blend;
    j.head.rotation.y = -j.spine.rotation.y * 0.65;

    for (const [side, offset, sign] of [
      ["left", 0, -1],
      ["right", Math.PI, 1],
    ]) {
      const phase = this.phase + offset;
      const swing = Math.sin(phase);
      const footZ = -Math.cos(phase) * stride;
      const footY =
        dimensions.ankleHeight + Math.max(0, -swing) * lift - j.hips.position.y;
      const upper = dimensions.upperLeg;
      const lower = dimensions.lowerLeg;
      const reach = Math.min(Math.hypot(footY, footZ), upper + lower - 0.001);
      const knee = -Math.acos(
        MathUtils.clamp(
          (reach * reach - upper * upper - lower * lower) / (2 * upper * lower),
          -1,
          1,
        ),
      );
      const hip =
        Math.atan2(-footZ, -footY) -
        Math.atan2(lower * Math.sin(knee), upper + lower * Math.cos(knee));
      j[`${side}Hip`].rotation.x = hip;
      j[`${side}Knee`].rotation.x = knee;
      j[`${side}Ankle`].rotation.x = -(hip + knee);
      j[`${side}Shoulder`].rotation.x =
        -Math.cos(phase) *
        MathUtils.lerp(0.38, 0.66, this.runBlend) *
        this.blend;
      j[`${side}Shoulder`].rotation.z =
        sign * (0.07 + Math.sin(this.time * 2.2) * 0.008);
      j[`${side}Elbow`].rotation.x =
        -0.1 -
        this.runBlend * 0.62 -
        Math.max(0, Math.cos(phase)) * 0.15 * this.blend;
    }
  }
}
