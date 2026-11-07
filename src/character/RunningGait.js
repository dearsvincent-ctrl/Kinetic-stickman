import { MathUtils } from "three";

const fract = (v) => v - Math.floor(v);
const smooth = (v) => v * v * (3 - 2 * v);
const clamp01 = (v) => MathUtils.clamp(v, 0, 1);

// Cubic Hermite with velocities measured over the complete swing interval.
// Matching the ground-relative velocity at either end gives a planted paw-back
// rather than a foot dragged forward and stopped abruptly at touchdown.
function curve(t, length, a, b, va = 0, vb = 0) {
  const t2 = t * t,
    t3 = t2 * t;
  return (
    (2 * t3 - 3 * t2 + 1) * a +
    (t3 - 2 * t2 + t) * va * length +
    (-2 * t3 + 3 * t2) * b +
    (t3 - t2) * vb * length
  );
}

/** Running presentation, separate from the walking swing and from physics.
 * Each leg loads/pushes on a world contact, folds its heel, drives the knee,
 * then extends/paws back for landing. Contact duty below 0.5 creates two
 * genuine visual flight windows per cycle. No actor/root transforms are owned.
 */
export class RunningGait {
  constructor(style) {
    this.style = style;
    this.flight = 0;
    this.trail = 0;
  }

  sampleFoot(t, stride, swingTravel, sprint, out) {
    const s = this.style;
    const lift = MathUtils.lerp(s.runLift, s.sprintLift, sprint);
    const rear = stride * 0.5;
    const knee = MathUtils.lerp(s.runKneeForward, s.sprintKneeForward, sprint);
    if (t < s.heelFraction) {
      const p = clamp01(t / s.heelFraction);
      out.z = curve(p, s.heelFraction, rear, rear * 0.6, swingTravel, -1);
      out.y = curve(p, s.heelFraction, 0, lift * 0.9);
    } else if (t < s.kneeFraction) {
      const length = s.kneeFraction - s.heelFraction;
      const p = clamp01((t - s.heelFraction) / length);
      out.z = curve(p, length, rear * 0.6, -knee, -1, -1);
      out.y = curve(p, length, lift * 0.9, lift);
    } else {
      const length = 1 - s.kneeFraction;
      const p = clamp01((t - s.kneeFraction) / length);
      out.z = curve(p, length, -knee, -rear, -1, swingTravel);
      out.y = curve(p, length, lift, 0);
    }
    return out;
  }

  applyBody(pose, gait, phase, acceleration) {
    const s = this.style,
      sprint = gait.sprintBlend;
    const w = gait.freeRunBlend * gait.movementBlend;
    const step = fract(phase * 2);
    const contact = Math.min(0.999, gait.duty * 2);
    const support = clamp01(step / contact);
    const flightTime = clamp01((step - contact) / Math.max(0.001, 1 - contact));
    this.flight = Math.sin(Math.PI * flightTime) * w;
    const base = MathUtils.lerp(s.runHipHeight, s.sprintHipHeight, sprint);
    const compression = MathUtils.lerp(
      s.runCompression,
      s.sprintCompression,
      sprint,
    );
    const load =
      support < 0.3 ? smooth(support / 0.3) : 1 - smooth((support - 0.3) / 0.7);
    const flightRise = MathUtils.lerp(
      s.runFlightRise,
      s.sprintFlightRise,
      sprint,
    );
    const height =
      step < contact
        ? base - compression * load
        : base + flightRise * Math.sin(Math.PI * flightTime);
    const twist = Math.sin((phase - 0.08) * Math.PI * 2);
    pose.hipY = MathUtils.lerp(pose.hipY, height, w);
    pose.hipYaw = MathUtils.lerp(
      pose.hipYaw,
      twist * MathUtils.lerp(s.hipTwist, s.sprintTwist, sprint),
      w,
    );
    pose.spineYaw = MathUtils.lerp(
      pose.spineYaw,
      -pose.hipYaw * s.shoulderCounter,
      w,
    );
    pose.spinePitch = MathUtils.lerp(
      pose.spinePitch,
      -MathUtils.lerp(s.runLean, s.sprintLean, sprint) - load * sprint * 0.025,
      w,
    );
    pose.headPitch = MathUtils.lerp(pose.headPitch, 0.08 + sprint * 0.1, w);
    // Brief launch/flight trails return to an opposing athletic arm drive each
    // step. Guard, punch, dash and jump layers retain their existing priority.
    const trailing =
      sprint *
      Math.max(
        acceleration * s.launchTrail,
        Math.pow(this.flight, 4) * s.flightTrail,
      );
    this.trail = MathUtils.damp(this.trail, trailing, s.armResponse, gait.dt);
    for (let i = 0; i < 2; i++) {
      const arm = pose.arms[i];
      const drive = Math.cos((phase + i * 0.5 - 0.22) * Math.PI * 2);
      const pump = drive * MathUtils.lerp(s.runArm, s.sprintArm, sprint);
      arm.x = MathUtils.lerp(
        arm.x,
        MathUtils.lerp(pump, -s.trailingArm, this.trail),
        w,
      );
      arm.elbow = MathUtils.lerp(
        arm.elbow,
        MathUtils.lerp(
          0.4 +
            Math.max(0, drive) *
              MathUtils.lerp(s.runElbow, s.sprintElbow, sprint),
          0.35,
          this.trail,
        ),
        w,
      );
      arm.y = MathUtils.lerp(arm.y, -drive * 0.07, w);
      arm.z = MathUtils.lerp(
        arm.z,
        (i === 0 ? -1 : 1) * (0.1 + this.trail * 0.12),
        w,
      );
    }
  }
}
