import { Quaternion, Vector3 } from "three";
/** A short supporting-foot plan and additive body pose over the current gait.
 * World anchors yield to resolved travel before a leg can overextend. */
export class MomentumRecoveryAnimator {
  constructor(character) {
    this.character = character;
    this.sequence = 0;
    this.weight = 0;
    this.compression = 0;
    this.push = 0;
    this.twist = 0;
    this.supportSign = -1;
    this.side = "left";
    this.anchor = new Vector3();
    this.goal = new Vector3();
    this.local = new Vector3();
    this.inverse = new Quaternion();
    this.impactSequence = 0;
  }
  plan(dt, state, feet, jump, dash, combat) {
    const root = this.character.root,
      ground = (!jump || jump.ready) && !dash?.active;
    this.weight +=
      ((ground ? (state?.weight ?? 0) * (state?.intensity ?? 0) : 0) -
        this.weight) *
      (1 - Math.exp(-28 * dt));
    this.compression +=
      ((ground ? (state?.compression ?? 0) : 0) - this.compression) *
      (1 - Math.exp(-22 * dt));
    this.push +=
      ((ground ? (state?.push ?? 0) : 0) - this.push) *
      (1 - Math.exp(-22 * dt));
    this.twist +=
      ((state?.side ?? 1) *
        (state?.kind === "back" ? 0.08 : 0.23) *
        (this.compression - 0.4 * this.push) -
        this.twist) *
      (1 - Math.exp(-20 * dt));
    this.supportSign +=
      ((this.side === "left" ? -1 : 1) - this.supportSign) *
      (1 - Math.exp(-20 * dt));
    if (!ground || !state?.active) {
      return;
    }
    const kick =
      combat?.attack.active && combat.currentTechnique?.action === "kick"
        ? combat.currentTechnique.side
        : null;
    if (state.sequence !== this.sequence) {
      this.sequence = state.sequence;
      this.side = kick
        ? kick === "left"
          ? "right"
          : "left"
        : feet.left.planted !== feet.right.planted
          ? feet.left.planted
            ? "left"
            : "right"
          : state.side > 0
            ? "right"
            : "left";
      this.character.joints[`${this.side}Ankle`].getWorldPosition(this.anchor);
      this.anchor.y = 0.1;
    }
    if (kick === this.side) {
      this.side = kick === "left" ? "right" : "left";
      this.character.joints[`${this.side}Ankle`].getWorldPosition(this.anchor);
      this.anchor.y = 0.1;
    }
    // Human leg reach is bounded even at 100x. Carry excess root travel rather
    // than stretching a planted limb across many metres.
    this.goal.subVectors(this.anchor, root.position).setY(0);
    if (this.goal.length() > 0.48) {
      this.goal.setLength(0.48);
      this.anchor.copy(root.position).add(this.goal).setY(0.1);
    }
    const foot = feet[this.side],
      plant = this.weight * (0.45 + 0.55 * (state.compression ?? 0));
    foot.target.lerp(this.anchor, plant);
    foot.yaw.slerp(root.quaternion, Math.min(1, plant * 0.45));
    if (state.compression > 0.35 && this.impactSequence !== state.sequence)
      this.impactSequence = state.sequence;
  }
  apply(pose, state, rootQuaternion) {
    if (this.weight < 0.001 || !state) return;
    const w = this.weight,
      c = this.compression,
      p = this.push;
    this.inverse.copy(rootQuaternion).invert();
    this.local.copy(state.incoming).applyQuaternion(this.inverse);
    pose.hipY -= w * (0.085 * c + 0.018 * p);
    pose.hipX += this.supportSign * 0.045 * w * c;
    pose.hipYaw += this.twist * w;
    pose.spinePitch += (-this.local.z * 0.24 * c - 0.12 * p) * w;
    pose.spineRoll += this.local.x * 0.16 * c * w;
    pose.spineYaw -= state.side * 0.16 * w * c;
    // Balance arms are a base layer; explicit guard and strikes retain priority.
    for (let i = 0; i < 2; i++) {
      pose.arms[i].z += (i === 0 ? -0.1 : 0.1) * w * c;
      pose.arms[i].elbow += w * c * 0.18;
    }
  }
}
