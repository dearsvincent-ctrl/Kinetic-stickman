import { MathUtils } from "three";
import { ANIME_STYLE } from "./AnimationStyle.js";

const smooth = (value) => value * value * (3 - 2 * value);
const clamp01 = (value) => MathUtils.clamp(value, 0, 1);

/** Body-driven straight/cross presentation, using the live technique phases.
 * Fast visual extension/recoil never changes action timing or movement. */
export class AttackAnimator {
  constructor(style = ANIME_STYLE.punch) {
    this.style = style;
    this.weight = 0;
    this.reach = 0;
    this.chamber = 0;
    this.sequence = -1;
    this.active = false;
    this.entryWeight = 0;
    this.releaseWeight = 0;
    this.releaseTime = 0;
    this.side = "right";
    this.phase = "idle";
    this.cancelled = false;
    this.recoveryReach = 0;
    this.recoveryChamber = 0;
    this.recoil = 0;
  }

  update(dt, combat) {
    const attack = combat?.attack;
    const animation =
      combat?.currentTechnique?.animation ??
      (attack?.techniqueId === "flying-kick" ? "flying-kick" : "punch");
    const active = Boolean(attack?.active && animation === "punch");
    const s = this.style;
    const previousReach = this.reach,
      previousChamber = this.chamber;
    if (active) {
      this.side = combat.currentTechnique?.side ?? "right";
      const entering = attack.sequence !== this.sequence;
      if (entering) {
        this.sequence = attack.sequence;
        this.entryWeight = this.weight;
        this.phase = "windup";
        this.cancelled = false;
      }
      const seek = entering && attack.elapsed > dt * 1.5;
      const entry = smooth(clamp01(attack.elapsed / s.entryTime));
      this.weight = MathUtils.lerp(this.entryWeight, 1, entry);
      const p = clamp01(attack.phaseProgress);
      if (attack.phase === "recovery") {
        if (
          this.phase !== "recovery" ||
          (attack.cancelled && !this.cancelled)
        ) {
          this.recoveryReach = attack.cancelled ? this.reach : 1;
          this.recoveryChamber = attack.cancelled ? this.chamber : 0;
        }
        const recovery = 1 - smooth(clamp01(p / s.recoveryFraction));
        this.reach = this.recoveryReach * recovery;
        this.chamber = this.recoveryChamber * recovery;
        this.recoil = attack.cancelled ? 0 : Math.sin(Math.PI * p) * (1 - p);
      } else if (attack.phase === "windup") {
        this.reach = 0;
        this.chamber = smooth(p);
        this.recoil = 0;
      } else {
        this.reach =
          attack.phase === "impact"
            ? 1
            : smooth(clamp01(p / s.extensionFraction));
        this.chamber = 1 - this.reach;
        this.recoil = 0;
      }
      this.reach = seek
        ? this.reach
        : MathUtils.damp(previousReach, this.reach, s.poseResponse, dt);
      this.chamber = seek
        ? this.chamber
        : MathUtils.damp(previousChamber, this.chamber, s.poseResponse, dt);
      this.phase = attack.phase;
      this.cancelled = Boolean(attack.cancelled);
      this.releaseTime = 0;
    } else {
      if (this.active) {
        this.releaseWeight = this.weight;
        this.releaseTime = 0;
      }
      this.releaseTime += dt;
      this.weight =
        this.releaseWeight *
        (1 - smooth(clamp01(this.releaseTime / s.releaseTime)));
      this.reach = 0;
      this.chamber = 0;
      this.recoil = 0;
      this.phase = "idle";
    }
    this.active = active;
    return this.weight;
  }

  apply(pose) {
    const w = this.weight;
    if (w <= 0) return;
    const s = this.style,
      drive = this.reach,
      coil = this.chamber;
    const cross = this.side === "left",
      sign = cross ? -1 : 1;
    const guard = pose.arms[cross ? 1 : 0],
      strike = pose.arms[cross ? 0 : 1];
    guard.x = MathUtils.lerp(guard.x, 1.1 + drive * 0.05, w);
    guard.y = MathUtils.lerp(guard.y, -0.06 * sign, w);
    guard.z = MathUtils.lerp(guard.z, 0.18 * sign, w);
    guard.elbow = MathUtils.lerp(guard.elbow, 1.76, w);
    strike.x = MathUtils.lerp(
      strike.x,
      MathUtils.lerp(1.04, cross ? 1.78 : 1.8, drive) - coil * 0.07,
      w,
    );
    strike.y = MathUtils.lerp(
      strike.y,
      MathUtils.lerp(0.06, -0.02, drive) * sign,
      w,
    );
    strike.z = MathUtils.lerp(
      strike.z,
      MathUtils.lerp(-0.18, -0.03, drive) * sign,
      w,
    );
    strike.elbow = MathUtils.lerp(
      strike.elbow,
      MathUtils.lerp(1.84, 0.1, drive) + coil * 0.04,
      w,
    );
    // Shift the visual pelvis over the existing support legs. Their world
    // contacts stay planted and IK absorbs the load; the actor root stays put.
    pose.hipX -= sign * drive * (cross ? 0.035 : 0.025) * w;
    pose.hipY -= (drive + coil * 0.4) * s.compression * w;
    pose.hipZ =
      (pose.hipZ ?? 0) +
      (coil * 0.025 -
        drive * (cross ? s.crossWeightTransfer : s.weightTransfer)) *
        w;
    pose.hipYaw +=
      (drive * (cross ? s.crossHipTwist : s.hipTwist) -
        coil * s.anticipationTwist) *
      sign *
      w;
    pose.spineYaw +=
      (drive * (cross ? s.crossShoulderDrive : s.shoulderDrive) -
        coil * s.anticipationTwist -
        this.recoil * s.recoil) *
      sign *
      w;
    pose.spinePitch -= (drive * 0.04 + coil * 0.02) * w;
    pose.spineRoll = (pose.spineRoll ?? 0) + sign * drive * 0.04 * w;
  }
}
