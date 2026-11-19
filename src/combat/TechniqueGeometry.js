import { Quaternion, Vector3 } from "three";
import { alignStrikePoint } from "./PunchAlignment.js";
export const BODY_PIVOT = 0.955;
const UP = new Vector3(0, 1, 0);
const smooth = (t) => t * t * (3 - 2 * t);
const clamp = (t) => Math.max(0, Math.min(1, t));
const mix = (a, b, t) => a + (b - a) * t;
const footRotation = new Quaternion();
const footAxis = new Vector3();

export function techniqueStrikeStyle(technique) {
  if (technique?.animation === "bicycle-kick") return "bicycle";
  if (technique?.animation === "whip-kick") return "spinning";
  if (technique?.animation === "descending-sweep") return "descending";
  return technique?.strikeStyle ?? "front";
}

/** One timing envelope for the foot path, pelvis and counterbalance. Recovery
 * first folds the knee back into chamber, then lowers the foot into stance. */
export function sampleKickPose(out, technique, elapsed) {
  const end = technique.windup + technique.extension + technique.impact;
  const extension = smooth(
    clamp((elapsed - technique.windup) / Math.max(1e-6, technique.extension)),
  );
  const recovery = clamp((elapsed - end) / Math.max(1e-6, technique.recovery));
  const recoil = smooth(clamp(recovery / 0.42));
  out.extension = extension * (1 - recoil);
  out.chamber =
    elapsed < technique.windup
      ? smooth(clamp(elapsed / Math.max(1e-6, technique.windup)))
      : elapsed <= end
        ? 1 - extension
        : recovery < 0.42
          ? recoil
          : 1 - smooth(clamp((recovery - 0.42) / 0.58));
  out.weight =
    elapsed <= end
      ? smooth(
          clamp(elapsed / Math.min(0.07, Math.max(0.01, technique.windup))),
        )
      : 1 - smooth(recovery);
  out.activeProgress = smooth(
    clamp(
      (elapsed - technique.windup) /
        Math.max(1e-6, technique.extension + technique.impact),
    ),
  );
  // The turn completes before the heel reaches full extension, then stays at
  // the equivalent upright orientation throughout recovery.
  out.turn =
    techniqueStrikeStyle(technique) === "spinning"
      ? smooth(
          clamp(
            elapsed /
              Math.max(1e-6, technique.windup + technique.extension * 0.9),
          ),
        )
      : 0;
  out.recovery = recovery;
  return out;
}
const kickState = {};
function kickPoint(out, technique, extension, arc, chamber = false) {
  const sign = technique.side === "left" ? -1 : 1;
  const style = techniqueStrikeStyle(technique);
  const sweep = style === "sweep" || style === "descending";
  const height =
    style === "descending"
      ? 1.02 - arc * 0.78
      : sweep
        ? Math.max(0.24, Math.min(0.36, technique.originHeight))
        : Math.min(1.25, technique.originHeight);
  const chamberHeight = sweep ? 0.43 : 0.76;
  const chamberSide = style === "side" ? 0.28 : 0.19;
  if (chamber) return out.set(sign * chamberSide, chamberHeight, -0.2);
  // Low descending contacts must remain reachable while the running pelvis is
  // higher than a stationary crouch. The shared path owns this bound, so the
  // visible ankle and contact sphere never disagree at the IK reach limit.
  const reach = Math.min(
    sweep ? (style === "descending" ? 0.67 : 0.61) : 0.75,
    technique.reach - (technique.hitRadius ?? 0.14),
  );
  let x = sign * mix(chamberSide, 0.07, extension),
    z = mix(
      -0.2,
      -Math.sqrt(Math.max(0, reach * reach - 0.07 ** 2)),
      extension,
    );
  if (style === "roundhouse" || style === "spinning" || sweep) {
    const angle =
      style === "roundhouse"
        ? 1.08 - 1.23 * arc
        : style === "spinning"
          ? 1.8 - 2.12 * arc
          : 1.05 - 1.65 * arc;
    x = mix(sign * chamberSide, sign * Math.sin(angle) * reach, extension);
    z = mix(-0.2, -Math.cos(angle) * reach, extension);
  } else if (style === "side") {
    x = sign * mix(chamberSide, 0.2, extension);
    z = mix(-0.2, -Math.sqrt(Math.max(0, reach * reach - 0.2 ** 2)), extension);
  }
  return out.set(x, mix(chamberHeight, height, extension), z);
}
const kickEnd = new Vector3();
const kickChamber = new Vector3();
const bicycleWaypoint = new Vector3();
/** The striking foot pedals forward, folds into chamber, then drives out.
 * The other foot counter-pedals instead of remaining in a static air tuck.
 * Every point stays inside the rig's unscaled two-bone leg length. */
function bicyclePoint(out, technique, elapsed, side) {
  const sign = side === "left" ? -1 : 1;
  const primary = side === technique.side;
  const end = technique.windup + technique.extension + technique.impact;
  const recovery = clamp((elapsed - end) / Math.max(1e-6, technique.recovery));
  const windup = clamp(elapsed / Math.max(1e-6, technique.windup));
  if (primary) {
    if (elapsed < technique.windup) {
      out.set(sign * 0.19, 0.76, -0.2);
      if (windup < 0.55)
        return out
          .set(sign * 0.16, 0.1, 0.03)
          .lerp(
            bicycleWaypoint.set(sign * 0.17, 0.66, -0.43),
            smooth(windup / 0.55),
          );
      return out.lerp(
        bicycleWaypoint.set(sign * 0.17, 0.66, -0.43),
        1 - smooth((windup - 0.55) / 0.45),
      );
    }
    if (recovery > 0) {
      kickPoint(kickEnd, technique, 1, 1);
      kickPoint(kickChamber, technique, 0, 0, true);
      if (recovery < 0.42)
        return out.copy(kickEnd).lerp(kickChamber, smooth(recovery / 0.42));
      return out.copy(kickChamber).lerp(
        bicycleWaypoint.set(sign * 0.16, 0.1, 0.03),
        smooth((recovery - 0.42) / 0.58),
      );
    }
    const state = sampleKickPose(kickState, technique, elapsed);
    return kickPoint(out, technique, state.extension, state.activeProgress);
  }
  if (elapsed < technique.windup) {
    if (windup < 0.45)
      return out.set(sign * 0.16, 0.1, 0.03).lerp(
        bicycleWaypoint.set(sign * 0.17, 0.4, 0.27),
        smooth(windup / 0.45),
      );
    return out.set(sign * 0.17, 0.4, 0.27).lerp(
      bicycleWaypoint.set(sign * 0.18, 0.9, -0.32),
      smooth((windup - 0.45) / 0.55),
    );
  }
  if (recovery > 0) {
    if (recovery < 0.42)
      return out.set(sign * 0.17, 0.46, 0.25).lerp(
        bicycleWaypoint.set(sign * 0.18, 0.76, -0.2),
        smooth(recovery / 0.42),
      );
    return out.set(sign * 0.18, 0.76, -0.2).lerp(
      bicycleWaypoint.set(sign * 0.16, 0.1, 0.03),
      smooth((recovery - 0.42) / 0.58),
    );
  }
  const drive = smooth(
    clamp((elapsed - technique.windup) / Math.max(1e-6, technique.extension)),
  );
  return out.set(sign * 0.18, 0.9, -0.32).lerp(
    bicycleWaypoint.set(sign * 0.17, 0.46, 0.25),
    drive,
  );
}
function sampleKick(out, technique, elapsed) {
  if (techniqueStrikeStyle(technique) === "bicycle")
    return bicyclePoint(out, technique, elapsed, technique.side);
  const state = sampleKickPose(kickState, technique, elapsed);
  const sign = technique.side === "left" ? -1 : 1;
  kickPoint(kickChamber, technique, 0, 0, true);
  if (elapsed < technique.windup) {
    out.set(sign * 0.16, 0.1, 0.03).lerp(kickChamber, state.chamber);
  } else if (state.recovery > 0) {
    kickPoint(kickEnd, technique, 1, 1);
    if (state.recovery < 0.42)
      out.copy(kickEnd).lerp(kickChamber, smooth(state.recovery / 0.42));
    else
      out
        .copy(kickChamber)
        .lerp(
          kickEnd.set(sign * 0.16, 0.1, 0.03),
          smooth((state.recovery - 0.42) / 0.58),
        );
  } else kickPoint(out, technique, state.extension, state.activeProgress);
  if (state.turn) out.applyAxisAngle(UP, sign * Math.PI * 2 * state.turn);
  return out;
}

/** Foot orientation follows the strike surface, while the knee keeps its own
 * bend plane. The resulting quaternion is a world orientation for leg IK. */
export function strikeFootOrientation(
  out,
  technique,
  elapsed,
  bodyOrientation,
) {
  const state = sampleKickPose(kickState, technique, elapsed);
  const sign = technique.side === "left" ? -1 : 1,
    style = techniqueStrikeStyle(technique);
  const drive = state.extension;
  const yaw =
    style === "side"
      ? sign * 1.05
      : style === "front" || style === "bicycle"
        ? 0
        : sign * 0.55;
  const roll =
    style === "side"
      ? sign * 0.82
      : style === "roundhouse" || style === "spinning"
        ? sign * 0.65
        : 0;
  const pitch =
    style === "front" || style === "bicycle"
      ? 0.35
      : style === "sweep" || style === "descending"
        ? 0.08
        : -0.12;
  out.copy(bodyOrientation);
  footRotation.setFromAxisAngle(
    UP,
    yaw * drive + sign * Math.PI * 2 * state.turn,
  );
  out.multiply(footRotation);
  footRotation.setFromAxisAngle(footAxis.set(0, 0, 1), roll * drive);
  out.multiply(footRotation);
  footRotation.setFromAxisAngle(footAxis.set(1, 0, 0), pitch * drive);
  return out.multiply(footRotation);
}

export function strikeKneePole(out, technique, elapsed) {
  const state = sampleKickPose(kickState, technique, elapsed);
  const sign = technique.side === "left" ? -1 : 1,
    style = techniqueStrikeStyle(technique);
  const lateral =
    style === "front" || style === "bicycle"
      ? 0.12
      : style === "side"
        ? 0.95
        : 0.65;
  // Keep the knee above/outside the ankle path. A forward-only pole can cross
  // the hip-to-ankle direction during side kicks and reverse the bend plane.
  return out
    .set(
      sign * (0.18 + lateral * state.extension),
      0.65 + 0.45 * state.extension,
      -1 + 0.65 * state.extension,
    )
    .applyAxisAngle(UP, sign * Math.PI * 2 * state.turn)
    .normalize();
}

/** Shared procedural hand/ankle targets for presentation and contact sensing.
 * Coordinates start in an upright body frame; an independent quaternion can
 * turn that same strike into a side, downward or inverted airborne contact. */
export function sampleLocalStrike(out, technique, elapsed, context = {}) {
  const phase = clamp(
    (elapsed - technique.windup) / Math.max(1e-6, technique.extension),
  );
  const active = clamp(
    (elapsed - technique.windup) /
      Math.max(1e-6, technique.extension + technique.impact),
  );
  const ext = smooth(phase),
    sign = technique.side === "left" ? -1 : 1;
  const hand =
    technique.action === "punch" ||
    technique.animation === "punch" ||
    technique.animation === "backhand";
  if (!hand) sampleKick(out, technique, elapsed);
  else {
    const reach = technique.reach - (technique.hitRadius ?? 0.1);
    let distance = reach * (0.35 + 0.65 * ext),
      side = sign * Math.min(0.07, distance * 0.3);
    const hook = technique.strikeStyle === "hook";
    if (technique.animation === "backhand" || hook) {
      const angle =
        sign *
        (hook ? 1.12 - 1.5 * smooth(active) : 1.1 - 1.85 * smooth(active));
      distance = Math.min(distance, hook ? 0.52 : distance);
      side = Math.sin(angle) * distance;
      out.set(side, technique.originHeight, -Math.cos(angle) * distance);
    } else
      out.set(
        side,
        technique.originHeight,
        -Math.sqrt(Math.max(0, distance * distance - side * side)),
      );
    const activeEnd = technique.windup + technique.extension + technique.impact;
    if (elapsed < technique.windup) {
      const coil = Math.sin(
        Math.PI * clamp(elapsed / Math.max(1e-6, technique.windup)),
      );
      out.x += sign * coil * 0.035;
      out.y -= coil * 0.035;
      out.z += coil * 0.07;
    } else if (elapsed > activeEnd) {
      const p = smooth(
        clamp((elapsed - activeEnd) / Math.max(1e-6, technique.recovery)),
      );
      out.x += (sign * 0.21 - out.x) * p;
      out.y += (1.34 - out.y) * p + Math.sin(Math.PI * p) * 0.035;
      out.z += (-0.19 - out.z) * p;
    }
    // Preserve the arm's real two-bone length when the fist crosses the chest.
    const sx = sign * 0.25,
      sy = 1.43,
      dx = out.x - sx,
      dy = out.y - sy,
      dz = out.z;
    const len = Math.hypot(dx, dy, dz);
    if (len > 0.635)
      out.set(
        sx + (dx * 0.635) / len,
        sy + (dy * 0.635) / len,
        (dz * 0.635) / len,
      );
  }
  alignStrikePoint(out, technique, elapsed, context);
  const entry = context.limbs?.[technique.side]?.[hand ? "hand" : "foot"];
  if (entry?.length === 3 && entry.every(Number.isFinite)) {
    const duration = context.transition?.action === "kick" ? 0.11 : 0.075;
    const blend = smooth(clamp(elapsed / duration));
    out.set(
      entry[0] + (out.x - entry[0]) * blend,
      entry[1] + (out.y - entry[1]) * blend,
      entry[2] + (out.z - entry[2]) * blend,
    );
  }
  return out;
}
/** Shared secondary ankle path; only the primary leg owns strike contact. */
export function sampleBicycleLeg(out, technique, elapsed, side, context = {}) {
  if (side === technique.side)
    return sampleLocalStrike(out, technique, elapsed, context);
  bicyclePoint(out, technique, elapsed, side);
  const entry = context.limbs?.[side]?.foot;
  if (entry?.length === 3 && entry.every(Number.isFinite)) {
    const duration = context.transition?.action === "kick" ? 0.11 : 0.075;
    const blend = smooth(clamp(elapsed / duration));
    out.set(
      entry[0] + (out.x - entry[0]) * blend,
      entry[1] + (out.y - entry[1]) * blend,
      entry[2] + (out.z - entry[2]) * blend,
    );
  }
  return out;
}
export function worldStrike(out, local, root, orientation, lift = 0) {
  out.copy(local);
  out.y -= BODY_PIVOT;
  out.applyQuaternion(orientation);
  out.y += BODY_PIVOT + lift;
  return out.add(root);
}
export class StrikePoseSampler {
  constructor() {
    this.local = new Vector3();
    this.q = new Quaternion();
  }
  sample(
    out,
    root,
    heading,
    technique,
    elapsed,
    context = {},
    orientation = null,
    lift = 0,
  ) {
    sampleLocalStrike(this.local, technique, elapsed, context);
    if (orientation) this.q.copy(orientation);
    else this.q.setFromAxisAngle(UP, heading);
    return worldStrike(out, this.local, root, this.q, lift);
  }
}
