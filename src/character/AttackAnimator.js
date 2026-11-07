import { MathUtils } from "three";

const smooth = (value) => value * value * (3 - 2 * value);
const clamp01 = (value) => MathUtils.clamp(value, 0, 1);

/** Left/right straight punches layered over gait, guard and dash.
 * The combat state owns timing/recovery; this layer only poses the upper body.
 * No root transforms, foot contacts or movement state are changed here.
 */
export class AttackAnimator {
  constructor() {
    this.weight = 0;
    this.reach = 0;
    this.chamber = 0;
    this.sequence = -1;
    this.active = false;
    this.entryWeight = 0;
    this.releaseWeight = 0;
    this.releaseTime = 0;
    this.side = "right";
  }

  update(dt, combat) {
    const attack = combat?.attack;
    const animation =
      combat?.currentTechnique?.animation ??
      (attack?.techniqueId === "flying-kick" ? "flying-kick" : "punch");
    const active = Boolean(attack?.active && animation === "punch");
    if (active) {
      this.side = combat.currentTechnique?.side ?? "right";
      if (attack.sequence !== this.sequence) {
        this.sequence = attack.sequence;
        this.entryWeight = this.weight;
      }
      // A gentle entry raises the free-running hands before the extension.
      // Absolute attack time keeps this envelope consistent across frame rates.
      const entry = smooth(clamp01(attack.elapsed / 0.1));
      this.weight = MathUtils.lerp(this.entryWeight, 1, entry);
      this.reach = clamp01(attack.extension);
      this.chamber =
        attack.phase === "windup"
          ? Math.sin(Math.PI * clamp01(attack.phaseProgress))
          : 0;
      this.releaseTime = 0;
    } else {
      if (this.active) {
        this.releaseWeight = this.weight;
        this.releaseTime = 0;
      }
      this.releaseTime += dt;
      this.weight =
        this.releaseWeight * (1 - smooth(clamp01(this.releaseTime / 0.12)));
      this.reach = 0;
      this.chamber = 0;
    }
    this.active = active;
    return this.weight;
  }

  apply(pose) {
    const weight = this.weight;
    if (weight <= 0) return;
    const reach = this.reach;
    const chamber = this.chamber;
    const sign = this.side === "left" ? -1 : 1;
    const left = pose.arms[this.side === "left" ? 1 : 0];
    const right = pose.arms[this.side === "left" ? 0 : 1];

    // The opposite hand stays beside the chin through the strike and recovery.
    left.x = MathUtils.lerp(left.x, 1.1 + reach * 0.05, weight);
    left.y = MathUtils.lerp(left.y, -0.06 * sign, weight);
    left.z = MathUtils.lerp(left.z, 0.18 * sign, weight);
    left.elbow = MathUtils.lerp(left.elbow, 1.76, weight);

    // Positive elbow flexion bends toward the front of this hierarchical rig.
    // Leave a small bend at full extension instead of locking the joint.
    right.x = MathUtils.lerp(
      right.x,
      MathUtils.lerp(1.04, 1.75, reach) - chamber * 0.045,
      weight,
    );
    right.y = MathUtils.lerp(
      right.y,
      MathUtils.lerp(0.06, -0.02, reach) * sign,
      weight,
    );
    right.z = MathUtils.lerp(
      right.z,
      MathUtils.lerp(-0.18, -0.03, reach) * sign,
      weight,
    );
    right.elbow = MathUtils.lerp(
      right.elbow,
      MathUtils.lerp(1.84, 0.1, reach) + chamber * 0.035,
      weight,
    );
    // Add drive to the existing body pose, retaining dash lean and spine roll.
    pose.hipYaw += reach * 0.1 * weight * sign;
    pose.spineYaw +=
      (reach * (sign < 0 ? 0.38 : 0.3) - chamber * 0.025) * weight * sign;
    pose.spinePitch -= reach * 0.025 * weight;
  }
}
