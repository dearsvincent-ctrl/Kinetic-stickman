import { MathUtils, Vector3 } from "three";

const smooth = (t) => t * t * (3 - 2 * t);
const clamp = (t) => MathUtils.clamp(t, 0, 1);

/** Actual leg support drives the pelvis, opposing shoulders and balance arms.
 * One contact rhythm replaces unrelated arm/hip oscillators. Child pose only. */
export class AthleticCoordination {
  constructor(style) {
    this.style = style;
    this.split = 0;
    this.support = 0;
    this.load = 0;
    this.flight = 0;
    this.offset = new Vector3();
  }
  apply(dt, pose, gait, feet, root, direction, motion, freeWeight) {
    const s = this.style,
      w = gait.movementBlend * freeWeight;
    if (w < 0.0001) return;
    const left = this.offset
      .subVectors(feet[0].target, root.position)
      .dot(direction);
    const right = this.offset
      .subVectors(feet[1].target, root.position)
      .dot(direction);
    const split = MathUtils.clamp(
      (left - right) / Math.max(0.2, gait.stride),
      -1,
      1,
    );
    let load = 0,
      support = 0;
    for (const foot of feet)
      if (foot.planted) {
        const p = clamp(
          (foot.currentPhase ?? foot.lastPhase) / Math.max(0.01, foot.duty),
        );
        const pressure =
          p < 0.26 ? smooth(p / 0.26) : 1 - smooth((p - 0.26) / 0.74);
        load = Math.max(load, pressure);
        support += foot.sign * (0.3 + 0.7 * pressure);
      }
    const response = 1 - Math.exp(-s.contactResponse * dt);
    this.split += (split - this.split) * response;
    this.support += (MathUtils.clamp(support, -1, 1) - this.support) * response;
    this.load += (load - this.load) * response;
    this.flight +=
      ((!feet[0].planted && !feet[1].planted ? 1 : 0) - this.flight) * response;
    const run = gait.freeRunBlend,
      sprint = gait.sprintBlend;
    const twist = MathUtils.lerp(
      gait.style.walkHipTwist,
      MathUtils.lerp(gait.style.hipTwist, gait.style.sprintTwist, sprint),
      run,
    );
    pose.hipYaw = MathUtils.lerp(pose.hipYaw, -this.split * twist, w);
    pose.hipX = MathUtils.lerp(
      pose.hipX,
      this.support * s.supportShift - motion.bank * s.turnShift,
      w,
    );
    pose.hipRoll = MathUtils.lerp(
      pose.hipRoll,
      -this.support * 0.018 - motion.bank * s.pelvisBank,
      w,
    );
    const runHeight = MathUtils.lerp(
      gait.style.runHipHeight,
      gait.style.sprintHipHeight,
      sprint,
    );
    const compression = MathUtils.lerp(
      gait.style.runCompression,
      gait.style.sprintCompression,
      sprint,
    );
    const rise = MathUtils.lerp(
      gait.style.runFlightRise,
      gait.style.sprintFlightRise,
      sprint,
    );
    pose.hipY = MathUtils.lerp(
      pose.hipY,
      runHeight - this.load * compression + this.flight * rise,
      run * w,
    );
    pose.spineYaw = MathUtils.lerp(
      pose.spineYaw,
      -pose.hipYaw * gait.style.shoulderCounter,
      w,
    );
    pose.spineRoll -= motion.bank * s.torsoBank * w;
    const amplitude = MathUtils.lerp(
      gait.style.walkArm,
      MathUtils.lerp(gait.style.runArm, gait.style.sprintArm, sprint),
      run,
    );
    const trail = Math.min(1, gait.running.trail * 1.5) * sprint;
    for (let i = 0; i < 2; i++) {
      const drive = (i === 0 ? -1 : 1) * this.split;
      const arm = pose.arms[i];
      arm.x = MathUtils.lerp(
        arm.x,
        MathUtils.lerp(drive * amplitude, -gait.style.trailingArm, trail),
        w,
      );
      arm.elbow = MathUtils.lerp(
        arm.elbow,
        0.15 + run * (0.45 + Math.max(0, drive) * 0.65) + sprint * 0.16,
        w,
      );
      arm.y = MathUtils.lerp(arm.y, -drive * (0.025 + run * 0.045), w);
    }
  }
  head(pose) {
    // Gaze counterbalances the connected hip/spine chain, not a separate bob.
    pose.headPitch = MathUtils.lerp(
      pose.headPitch,
      -pose.spinePitch * this.style.headCounter,
      0.75,
    );
    pose.headYaw = -pose.spineYaw * 0.65;
    pose.headRoll = -(pose.hipRoll + pose.spineRoll) * 0.45;
  }
}
