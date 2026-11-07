import { MathUtils, Quaternion, Vector3 } from "three";

const clamp01 = (value) => MathUtils.clamp(value, 0, 1);
const smooth = (value) => value * value * (3 - 2 * value);

/** Flying front kick over the live jump/dash pose. Only child joints and foot
 * goals are animated: gravity, translation, yaw and ability counts stay owned
 * by movement. Both feet yield to landing before touching the floor. */
export class AerialAttackAnimator {
  constructor(character) {
    this.character = character;
    this.weight = 0;
    this.extension = 0;
    this.sequence = -1;
    this.phase = "idle";
    this.cancelled = false;
    this.recoveryWeight = 0;
    this.aimAngle = 0;
    this.blocking = false;
    this.side = 1;
    this.target = new Vector3();
    this.local = new Vector3();
    this.goal = new Vector3();
    this.extended = new Vector3();
    this.inverse = new Quaternion();
  }

  update(dt, combat, jump, feet) {
    const attack = combat?.attack;
    const animation =
      combat?.currentTechnique?.animation ??
      (attack?.techniqueId === "flying-kick" ? "flying-kick" : "punch");
    const active = Boolean(attack?.active && animation === "flying-kick");
    const root = this.character.root;
    this.blocking = Boolean(combat?.blocking);
    if (active) {
      if (attack.sequence !== this.sequence) {
        this.sequence = attack.sequence;
        this.side = combat.currentTechnique?.side === "left" ? 0 : 1;
        const point = attack.context.targetPoint;
        this.target.set(point.x, point.y, point.z);
        this.phase = "windup";
        this.cancelled = false;
        this.aimAngle = 0;
      }
      if (
        attack.phase === "recovery" &&
        (this.phase !== "recovery" || (attack.cancelled && !this.cancelled))
      )
        this.recoveryWeight = this.weight;
      this.cancelled = Boolean(attack.cancelled);
      const envelope =
        attack.phase === "recovery"
          ? this.recoveryWeight * (1 - smooth(clamp01(attack.phaseProgress)))
          : smooth(clamp01(attack.elapsed / 0.06));
      this.weight = jump?.airborne
        ? envelope
        : MathUtils.damp(this.weight, 0, 24, dt);
      this.extension = clamp01(attack.extension);
      this.phase = attack.phase;
    } else {
      this.weight = MathUtils.damp(this.weight, 0, 24, dt);
      this.phase = "idle";
      this.extension = 0;
    }
    if (this.weight < 0.001) this.weight = 0;
    if (!jump?.airborne || !this.weight) return;

    this.inverse.copy(root.quaternion).invert();
    this.local
      .subVectors(this.target, root.position)
      .applyQuaternion(this.inverse);
    // A committed strike can miss as the player steers away. Never turn a leg
    // behind the torso or rotate/pull the character to keep hitting its target.
    const angle = MathUtils.clamp(
      Math.atan2(this.local.x, -this.local.z),
      -Math.PI / 4,
      Math.PI / 4,
    );
    this.aimAngle = MathUtils.damp(this.aimAngle, angle, 18, dt);
    const distance = MathUtils.clamp(
      Math.hypot(this.local.x, this.local.z) - 0.16,
      0.5,
      0.78,
    );
    const landing =
      jump.verticalVelocity < 0
        ? smooth(clamp01((jump.timeToBoundary ?? Infinity) / 0.1))
        : 1;
    const blend = this.weight * landing;
    for (let i = 0; i < feet.length; i++) {
      const foot = feet[i];
      if (i === this.side) {
        this.goal.set(foot.sign * 0.15, 0.62, -0.12);
        this.extended.set(
          foot.sign * 0.12 + Math.sin(this.aimAngle) * distance,
          MathUtils.clamp(this.target.y - root.position.y, 0.25, 1.1),
          -Math.cos(this.aimAngle) * distance,
        );
        this.goal.lerp(this.extended, this.extension);
      } else {
        this.goal.set(
          foot.sign * 0.17,
          0.18 + this.extension * 0.1,
          0.12 + this.extension * 0.1,
        );
      }
      this.goal.applyQuaternion(root.quaternion).add(root.position);
      foot.target.lerp(this.goal, blend);
      foot.yaw.copy(root.quaternion);
      foot.anchor.copy(foot.target);
      foot.planted = false;
    }
  }

  apply(pose) {
    const w = this.weight;
    if (!w) return;
    pose.hipY -= w * 0.025;
    pose.hipYaw += this.aimAngle * 0.06 * w;
    pose.spinePitch = MathUtils.lerp(pose.spinePitch, 0.14, w * 0.75);
    pose.spineYaw += ((this.side === 1 ? -0.1 : 0.1) + this.aimAngle * 0.2) * w;
    if (this.blocking) return; // the existing guard retains hand ownership
    for (let i = 0; i < 2; i++) {
      const arm = pose.arms[i];
      arm.x = MathUtils.lerp(arm.x, i === this.side ? 1.05 : 0.8, w);
      arm.elbow = MathUtils.lerp(arm.elbow, i === this.side ? 1.5 : 1.2, w);
      arm.z = MathUtils.lerp(arm.z, i === 0 ? 0.24 : -0.2, w);
    }
  }
}
