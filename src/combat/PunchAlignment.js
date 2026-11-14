import { Quaternion, Vector3 } from "three";

export const UPPER_BODY_PIVOT = 1.04;
const axis = new Vector3();
const correction = new Quaternion();
const smooth = (t) => t * t * (3 - 2 * t);
const clamp = (t) => Math.max(0, Math.min(1, t));

/** Shared by the hand sampler and upper-body presenter. Only an accepted
 * punch carries a correction; the travel root and body rotation stay intact. */
export function punchAlignmentWeight(technique, elapsed) {
  if (elapsed <= technique.windup)
    return smooth(clamp(elapsed / Math.max(1e-6, technique.windup)));
  const end = technique.windup + technique.extension + technique.impact;
  return elapsed <= end
    ? 1
    : 1 - smooth(clamp((elapsed - end) / Math.max(1e-6, technique.recovery)));
}

export function punchAlignmentQuaternion(
  out,
  technique,
  elapsed,
  aim,
  extraWeight = 1,
) {
  if (!aim?.angle || technique.action !== "punch") return out.identity();
  axis.fromArray(aim.axis);
  return out.setFromAxisAngle(
    axis,
    aim.angle * punchAlignmentWeight(technique, elapsed) * extraWeight,
  );
}

export function alignPunchPoint(out, technique, elapsed, context) {
  const aim = context.punchAim;
  if (!aim?.angle || technique.action !== "punch") return out;
  punchAlignmentQuaternion(correction, technique, elapsed, aim);
  out.y -= UPPER_BODY_PIVOT;
  out.applyQuaternion(correction);
  out.y += UPPER_BODY_PIVOT;
  return out;
}
