import { MathUtils, Vector3 } from "three";
import { ANIME_STYLE } from "./AnimationStyle.js";
import {
  sampleLocalStrike,
  sampleBicycleLeg,
  sampleKickPose,
  techniqueStrikeStyle,
  strikeFootOrientation,
} from "../combat/TechniqueGeometry.js";

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
    this.kickPose = {};
    this.cancelStart = new Vector3();
    this.cancelSupportStart = new Vector3();
    this.lastStrikeGoal = new Vector3();
    this.lastSupportGoal = new Vector3();
    this.cancelCaptured = false;
    this.technique = null;
    this.turn = 0;
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
      attack?.active &&
        (animation === "flying-kick" || animation === "bicycle-kick" || groundedKick),
    );
    const eligiblePose = groundedKick
      ? !jump || jump.canActOnGround || jump.ready
      : jump?.airborne;
    const root = this.character.root;
    const s = this.style;
    this.technique = combat?.currentTechnique;
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
        this.cancelCaptured = false;
        this.turn = 0;
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
      sampleKickPose(this.kickPose, this.technique, attack.elapsed);
      if (!attack.cancelled) this.turn = this.kickPose.turn;
      this.extension = attack.cancelled
        ? this.recoveryExtension * (1 - smooth(clamp01(attack.phaseProgress)))
        : this.kickPose.extension;
      this.coil = attack.cancelled ? 0 : this.kickPose.chamber;
      this.phase = attack.phase;
    } else {
      this.weight = MathUtils.damp(this.weight, 0, s.releaseResponse, dt);
      this.phase = "idle";
      this.extension = 0;
      this.coil = 0;
    }
    if (this.weight < 0.001) this.weight = 0;
    if (!eligiblePose || !this.weight) return;
    const technique = this.technique;
    const landing =
      !groundedKick && jump.verticalVelocity < 0
        ? smooth(
            clamp01(
              (jump.timeToLanding ?? jump.timeToBoundary ?? Infinity) /
                s.landingBlendTime,
            ),
          )
        : 1;
    const blend = this.weight * landing;
    if (attack.cancelled && !this.cancelCaptured) {
      // Retain the previous body-local pose. Subtracting the current root from
      // last frame's world goal strands the foot behind 100x travel.
      this.cancelStart.copy(this.lastStrikeGoal);
      this.cancelSupportStart.copy(this.lastSupportGoal);
      this.cancelCaptured = true;
    }
    for (let i = 0; i < feet.length; i++) {
      const foot = feet[i];
      if (i === this.side) {
        sampleLocalStrike(this.goal, technique, attack.elapsed, attack.context);
        if (attack.cancelled) {
          const p = clamp01(attack.phaseProgress);
          this.extended.set(foot.sign * 0.19, 0.72, -0.2);
          if (p < 0.42)
            this.goal
              .copy(this.cancelStart)
              .lerp(this.extended, smooth(p / 0.42));
          else
            this.goal
              .copy(this.extended)
              .lerp(
                this.local.set(foot.sign * 0.16, 0.1, 0.03),
                smooth((p - 0.42) / 0.58),
              );
        }
      } else if (animation === "bicycle-kick") {
        if (attack.cancelled) {
          const p = clamp01(attack.phaseProgress);
          this.extended.set(foot.sign * 0.17, 0.52, 0.1);
          if (p < 0.42)
            this.goal
              .copy(this.cancelSupportStart)
              .lerp(this.extended, smooth(p / 0.42));
          else
            this.goal
              .copy(this.extended)
              .lerp(
                this.local.set(foot.sign * 0.16, 0.1, 0.03),
                smooth((p - 0.42) / 0.58),
              );
        } else
          sampleBicycleLeg(
            this.goal,
            technique,
            attack.elapsed,
            foot.side,
            attack.context,
          );
      }
      else if (groundedKick) continue;
      else
        this.goal.set(
          foot.sign * 0.17,
          0.28 + this.extension * 0.08,
          0.15 + this.extension * 0.1,
        );
      if (i === this.side) this.lastStrikeGoal.copy(this.goal);
      else this.lastSupportGoal.copy(this.goal);
      this.goal.applyQuaternion(root.quaternion).add(root.position);
      foot.target.lerp(this.goal, blend);
      if (i === this.side)
        strikeFootOrientation(
          foot.yaw,
          technique,
          attack.elapsed,
          root.quaternion,
        );
      else foot.yaw.copy(root.quaternion);
      foot.pitch = 0;
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
    const sign = this.side === 1 ? 1 : -1;
    const strikeStyle = techniqueStrikeStyle(this.technique);
    const bicycle = strikeStyle === "bicycle";
    const sweep = strikeStyle === "sweep" || strikeStyle === "descending";
    const turn =
      strikeStyle === "side"
        ? 0.78
        : strikeStyle === "roundhouse"
          ? 0.48
          : strikeStyle === "spinning"
            ? 0.82
            : sweep
              ? 0.5
              : 0.12;
    pose.hipY -=
      w *
      (0.025 +
        (sweep ? (strikeStyle === "descending" ? 0.24 : 0.18) * drive : 0));
    pose.hipZ = (pose.hipZ ?? 0) + (coil * 0.015 + drive * 0.025) * w;
    pose.hipYaw +=
      (this.aimAngle * 0.08 +
        sign * (drive * turn - coil * s.coilTwist * 0.5)) *
      w;
    if (strikeStyle === "spinning") {
      const yaw = this.turn * Math.PI * 2;
      // On interruption unwind only the remaining equivalent angle; never
      // reverse a completed full turn as the ordinary attack weight releases.
      pose.hipYaw +=
        sign *
        (this.cancelled ? Math.atan2(Math.sin(yaw), Math.cos(yaw)) * w : yaw);
    }
    pose.spinePitch = MathUtils.lerp(
      pose.spinePitch,
      drive * (bicycle ? 0.36 : sweep ? -0.16 : s.leanBack) -
        coil * (bicycle ? 0.06 : s.coilLean),
      w * 0.85,
    );
    pose.spineYaw +=
      (sign *
        (drive * (strikeStyle === "front" ? s.shoulderTwist : -turn * 0.35) -
          coil * s.coilTwist) +
        this.aimAngle * 0.2) *
      w;
    this.spineRoll =
      (-this.aimAngle * s.bank -
        sign * drive * (strikeStyle === "side" ? 0.15 : 0.045)) *
      w;
    pose.headPitch -= drive * 0.04 * w;
    if (this.blocking) return; // the existing guard retains hand ownership
    for (let i = 0; i < 2; i++) {
      const arm = pose.arms[i];
      arm.x = MathUtils.lerp(
        arm.x,
        bicycle
          ? 0.85 + drive * (i === this.side ? -0.2 : 0.3)
          : i === this.side
            ? 1.1 - drive * (strikeStyle === "front" ? 0.35 : 0.65)
            : 1.05 + drive * 0.25,
        w,
      );
      arm.elbow = MathUtils.lerp(
        arm.elbow,
        i === this.side ? 1.45 - drive * 0.35 : 1.5,
        w,
      );
      arm.z = MathUtils.lerp(
        arm.z,
        (i === 0 ? 1 : -1) *
          (0.2 +
            drive * (bicycle ? 0.22 : strikeStyle === "front" ? 0.05 : 0.38)),
        w,
      );
    }
  }
}
