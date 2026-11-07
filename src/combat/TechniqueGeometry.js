import { Quaternion, Vector3 } from "three";
export const BODY_PIVOT = 0.955;
const UP = new Vector3(0, 1, 0);
const smooth = (t) => t * t * (3 - 2 * t);
const clamp = (t) => Math.max(0, Math.min(1, t));
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
  const reach = technique.reach - technique.hitRadius;
  let distance = reach * (0.35 + 0.65 * ext),
    side = sign * Math.min(0.07, distance * 0.3),
    height = technique.originHeight;
  if (
    technique.animation === "whip-kick" ||
    technique.animation === "descending-sweep"
  ) {
    distance = reach * (0.65 + 0.35 * ext);
    side = sign * 0.1;
    if (technique.animation === "descending-sweep")
      height =
        1.02 -
        smooth(active) * (0.7 + 0.15 * (context.gestureIntensity ?? 0.7));
  } else if (technique.animation === "backhand") {
    const angle = sign * (1.1 - 1.85 * smooth(active));
    side = Math.sin(angle) * distance;
    distance = Math.cos(angle) * distance;
  }
  out.set(
    side,
    height,
    -Math.sqrt(
      Math.max(
        0,
        distance * distance -
          (technique.animation === "backhand" ? 0 : side * side),
      ),
    ),
  );
  // Arms retain their real two-bone length, even when a backhand crosses the chest.
  if (technique.action === "punch") {
    const sx = sign * 0.25,
      sy = 1.43,
      dx = out.x - sx,
      dy = out.y - sy,
      dz = out.z,
      len = Math.hypot(dx, dy, dz);
    if (len > 0.635)
      out.set(
        sx + (dx * 0.635) / len,
        sy + (dy * 0.635) / len,
        (dz * 0.635) / len,
      );
  }
  const entry =
    context.limbs?.[technique.side]?.[
      technique.action === "kick" ? "foot" : "hand"
    ];
  if (entry?.length === 3 && entry.every(Number.isFinite)) {
    const duration = context.transition?.action === "kick" ? 0.11 : 0.075,
      blend = smooth(clamp(elapsed / duration));
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
