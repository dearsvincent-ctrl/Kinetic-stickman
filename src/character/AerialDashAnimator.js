import { MathUtils, Quaternion, Vector3 } from "three";
import { ANIME_STYLE } from "./AnimationStyle.js";

const clamp01 = (value) => MathUtils.clamp(value, 0, 1);
const smooth = (value) => value * value * (3 - 2 * value);

/** Air-only balance overlay. Jump retains vertical timing and touchdown;
 * this layer never moves the root or plants a foot in empty space. */
export class AerialDashAnimator {
  constructor(character, style = ANIME_STYLE.aerialDash) {
    this.character = character;
    this.style = style;
    this.weight = 0;
    this.spineRoll = 0;
    this.blocking = 0;
    this.direction = new Vector3(0, 0, -1);
    this.localDirection = new Vector3();
    this.inverse = new Quaternion();
    this.goal = new Vector3();
  }

  update(dt, dash, jump, feet, blocking) {
    const active = dash?.mode === "air" && dash.active && jump?.airborne;
    const floorBlend = smooth(clamp01((jump?.height ?? 0) / 0.22));
    const target = active
      ? smooth(clamp01(dash.elapsed / this.style.entryTime)) * floorBlend
      : 0;
    this.weight = MathUtils.damp(
      this.weight,
      target,
      active ? this.style.blendResponse : this.style.releaseResponse,
      dt,
    );
    if (this.weight < 0.001) this.weight = 0;
    this.blocking = MathUtils.damp(this.blocking, blocking ? 1 : 0, 16, dt);
    if (dash?.mode === "air") this.direction.copy(dash.direction);
    this.inverse.copy(this.character.root.quaternion).invert();
    this.localDirection.copy(this.direction).applyQuaternion(this.inverse);
    this.spineRoll = -this.localDirection.x * this.style.bank;
    if (!jump?.airborne || !this.weight) return;
    for (let i = 0; i < feet.length; i++) {
      const foot = feet[i];
      const along = i === 0 ? -this.style.trail : this.style.lead;
      this.goal
        .set(
          foot.sign * 0.16 + this.localDirection.x * along,
          this.character.dimensions.ankleHeight +
            (i === 0 ? this.style.rearLift : this.style.frontLift),
          this.localDirection.z * along,
        )
        .applyQuaternion(this.character.root.quaternion)
        .add(this.character.root.position);
      foot.target.lerp(this.goal, this.weight * 0.75);
      foot.anchor.copy(foot.target);
      foot.planted = false;
    }
  }

  apply(pose) {
    if (!this.weight) return;
    pose.spinePitch = MathUtils.lerp(
      pose.spinePitch,
      this.localDirection.z * this.style.lean,
      this.weight,
    );
    pose.hipY -= this.weight * this.style.compression;
    pose.headPitch -= this.localDirection.z * 0.08 * this.weight;
    for (let i = 0; i < 2; i++) {
      const arm = pose.arms[i];
      const free = i === 0 ? 1.0 : -0.58;
      arm.x = MathUtils.lerp(
        arm.x,
        MathUtils.lerp(free, i === 0 ? 1.1 : 1.04, this.blocking),
        this.weight,
      );
      arm.elbow = MathUtils.lerp(
        arm.elbow,
        MathUtils.lerp(i === 0 ? 1.05 : 0.8, 1.76, this.blocking),
        this.weight,
      );
    }
  }
}
