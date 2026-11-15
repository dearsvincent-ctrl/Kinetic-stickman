import { Quaternion, Vector3 } from "three";

export const UPPER_BODY_PIVOT = 1.04;
const axis = new Vector3();
const correction = new Quaternion();
const base = new Quaternion();
const path = new Quaternion();
const next = new Quaternion();
const identity = new Quaternion();
const pivot = new Vector3();
const smooth = (t) => t * t * (3 - 2 * t);
const clamp = (t) => Math.max(0, Math.min(1, t));

/** Shared by hand/ankle sampling and presentation. Only accepted manual
 * strikes carry corrections; travel and body rotation remain independent. */
export function punchAlignmentWeight(technique, elapsed) {
  if (elapsed <= technique.windup)
    return smooth(clamp(elapsed / Math.max(1e-6, technique.windup)));
  const end = technique.windup + technique.extension + technique.impact;
  return elapsed <= end
    ? 1
    : 1 - smooth(clamp((elapsed - end) / Math.max(1e-6, technique.recovery)));
}

export function strikeAlignmentPivot(out, technique) {
  return technique.action === "kick"
    ? out.set((technique.side === "left" ? -1 : 1) * 0.15, 0.97, 0)
    : out.set(0, UPPER_BODY_PIVOT, 0);
}

export const strikeAim = (context, technique) =>
  technique?.action === "kick" ? context?.kickAim : context?.punchAim;

export function strikeAlignmentQuaternion(
  out,
  technique,
  elapsed,
  aim,
  extraWeight = 1,
) {
  if (!aim || (technique.action !== "punch" && technique.action !== "kick"))
    return out.identity();
  axis.fromArray(aim.axis);
  if (aim.profile?.length > 1 && aim.strength > 1) {
    // Frozen predictions from the manual entry, not homing onto a live target.
    // Strength >100% improves the whole active path, without over-rotating the
    // fist/foot beyond its requested alignment or scaling the limb's length.
    base.setFromAxisAngle(axis, aim.angle);
    const p =
      clamp(
        (elapsed - technique.windup) /
          Math.max(1e-6, technique.extension + technique.impact),
      ) *
      (aim.profile.length - 1);
    const i = Math.min(aim.profile.length - 2, Math.floor(p));
    path.fromArray(aim.profile[i]);
    next.fromArray(aim.profile[i + 1]);
    path.slerp(next, p - i);
    base.slerp(path, clamp(aim.strength - 1));
    return out
      .slerpQuaternions(
        identity,
        base,
        punchAlignmentWeight(technique, elapsed) * extraWeight,
      )
      .normalize();
  }
  return out.setFromAxisAngle(
    axis,
    aim.angle * punchAlignmentWeight(technique, elapsed) * extraWeight,
  );
}

export function punchAlignmentQuaternion(
  out,
  technique,
  elapsed,
  aim,
  extraWeight = 1,
) {
  return technique.action === "punch"
    ? strikeAlignmentQuaternion(out, technique, elapsed, aim, extraWeight)
    : out.identity();
}

export function strikeAlignmentAngle(technique, elapsed, aim) {
  if (!aim) return 0;
  strikeAlignmentQuaternion(correction, technique, elapsed, aim);
  return 2 * Math.acos(Math.min(1, Math.abs(correction.w)));
}

export function alignStrikePoint(out, technique, elapsed, context) {
  const aim = strikeAim(context, technique);
  if (!aim) return out;
  strikeAlignmentQuaternion(correction, technique, elapsed, aim);
  strikeAlignmentPivot(pivot, technique);
  out.sub(pivot);
  out.applyQuaternion(correction);
  out.add(pivot);
  return out;
}

export function alignPunchPoint(out, technique, elapsed, context) {
  return technique.action === "punch"
    ? alignStrikePoint(out, technique, elapsed, context)
    : out;
}
