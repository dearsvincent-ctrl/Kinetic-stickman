import { MathUtils, Quaternion, Vector3 } from "three";
import { ANIME_STYLE } from "./AnimationStyle.js";

const clamp01 = (value) => MathUtils.clamp(value, 0, 1);
const smooth = (value) => value * value * (3 - 2 * value);

/** Flying front kick over the live jump/dash pose. Only child joints and foot
 * goals are animated: gravity, translation, yaw and ability counts stay owned
 * by movement. Both feet yield to landing before touching the floor. */
export class AerialAttackAnimator {
  constructor(character, style = ANIME_STYLE.aerialAttack) {
    this.character = character;
    this.style = style;
    this.weight = 0;
    this.extension = 0;
    this.sequence = -1;
    this.phase = "idle";
    this.cancelled = false;
    this.recoveryWeight = 0;
    this.recoveryExtension = 0;
    this.coil = 0;
    this.spineRoll = 0;
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
    const groundedKick =
      animation === "ground-kick" ||
      animation === "whip-kick" ||
      animation === "descending-sweep";
    const active = Boolean(
      attack?.active && (animation === "flying-kick" || groundedKick),
    );
    const eligiblePose = groundedKick ? !jump || jump.ready : jump?.airborne;
    const root = this.character.root;
    const s = this.style;
    this.blocking = Boolean(combat?.blocking);
    if (active) {
      if (attack.sequence !== this.sequence) {
        this.sequence = attack.sequence;
        this.side = combat.currentTechnique?.side === "left" ? 0 : 1;
        const point = attack.context.targetPoint;
        this.manual = !point;
        if (point) this.target.set(point.x, point.y, point.z);
        this.phase = "windup";
        this.cancelled = false;
        this.aimAngle = 0;
      }
      if (
        attack.phase === "recovery" &&
        (this.phase !== "recovery" || (attack.cancelled && !this.cancelled))
      ) {
        this.recoveryWeight = this.weight;
        this.recoveryExtension = attack.cancelled ? this.extension : 1;
      }
      this.cancelled = Boolean(attack.cancelled);
      const envelope =
        attack.phase === "recovery"
          ? this.recoveryWeight *
            (1 - smooth(clamp01(attack.phaseProgress / s.recoveryFraction)))
          : smooth(clamp01(attack.elapsed / s.entryTime));
      this.weight = eligiblePose
        ? envelope
        : MathUtils.damp(this.weight, 0, s.releaseResponse, dt);
      this.extension =
        attack.phase === "recovery"
          ? this.recoveryExtension *
            (1 - smooth(clamp01(attack.phaseProgress / s.recoveryFraction)))
          : attack.phase === "extension"
            ? smooth(clamp01(attack.phaseProgress / s.extensionFraction))
            : attack.phase === "impact"
              ? 1
              : 0;
      this.coil =
        attack.phase === "windup"
          ? smooth(clamp01(attack.phaseProgress))
          : attack.phase === "extension"
            ? 1 - this.extension
            : 0;
      this.phase = attack.phase;
    } else {
      this.weight = MathUtils.damp(this.weight, 0, s.releaseResponse, dt);
      this.phase = "idle";
      this.extension = 0;
      this.coil = 0;
    }
    if (this.weight < 0.001) this.weight = 0;
    if (!eligiblePose || !this.weight) return;
    if (this.manual) {
      const technique = combat.currentTechnique;
      this.target
        .set(
          0,
          technique.originHeight,
          -(technique.reach - technique.hitRadius),
        )
        .applyQuaternion(root.quaternion)
        .add(root.position);
    }

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
    const distance = this.manual
      ? combat.currentTechnique.reach - combat.currentTechnique.hitRadius
      : MathUtils.clamp(
          Math.hypot(this.local.x, this.local.z) - 0.16,
          0.5,
          s.reach,
        );
    const landing =
      !groundedKick && jump.verticalVelocity < 0
        ? smooth(
            clamp01((jump.timeToBoundary ?? Infinity) / s.landingBlendTime),
          )
        : 1;
    const blend = this.weight * landing;
    for (let i = 0; i < feet.length; i++) {
      const foot = feet[i];
      if (i === this.side) {
        this.goal.set(foot.sign * 0.15, s.chamberHeight, -s.chamberForward);
        this.extended.set(
          foot.sign * 0.12 + Math.sin(this.aimAngle) * distance,
          this.manual
            ? combat.currentTechnique.originHeight
            : MathUtils.clamp(this.target.y - root.position.y, 0.25, 1.1),
          -Math.cos(this.aimAngle) * distance,
        );
        this.goal.lerp(this.extended, this.extension);
      } else if (groundedKick) {
        // Keep the moving support leg's existing gait/ground contact.
        continue;
      } else {
        this.goal.set(
          foot.sign * 0.17,
          0.26 + this.extension * 0.12,
          0.16 + this.extension * 0.12,
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
    this.spineRoll = 0;
    if (!w) return;
    const s = this.style,
      drive = this.extension,
      coil = this.coil;
    const sign = this.side === 1 ? -1 : 1;
    pose.hipY -= w * 0.025;
    pose.hipZ = (pose.hipZ ?? 0) + (coil * 0.025 - drive * 0.035) * w;
    pose.hipYaw +=
      (this.aimAngle * 0.08 +
        sign * (drive * s.hipTwist - coil * s.coilTwist * 0.5)) *
      w;
    pose.spinePitch = MathUtils.lerp(
      pose.spinePitch,
      drive * s.leanBack - coil * s.coilLean,
      w * 0.85,
    );
    pose.spineYaw +=
      (sign * (drive * s.shoulderTwist - coil * s.coilTwist) +
        this.aimAngle * 0.2) *
      w;
    this.spineRoll = (-this.aimAngle * s.bank + sign * drive * 0.035) * w;
    pose.headPitch -= drive * 0.04 * w;
    if (this.blocking) return; // the existing guard retains hand ownership
    for (let i = 0; i < 2; i++) {
      const arm = pose.arms[i];
      arm.x = MathUtils.lerp(
        arm.x,
        i === this.side ? 1.05 - drive * 0.6 : 0.85 + drive * 0.3,
        w,
      );
      arm.elbow = MathUtils.lerp(
        arm.elbow,
        i === this.side ? 1.45 - drive * 0.35 : 1.5,
        w,
      );
      arm.z = MathUtils.lerp(arm.z, i === 0 ? 0.24 : -0.2, w);
    }
  }
}
