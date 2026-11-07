import { Quaternion, Vector3 } from "three";
import { StrikePoseSampler, BODY_PIVOT } from "./TechniqueGeometry.js";
const EPS = 1e-9;
const UP = new Vector3(0, 1, 0);
const DEFAULT_BOXES = [null];
const AXES = ["x", "y", "z"];
const point = () => ({ x: 0, y: 0, z: 0 });
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => t * t * (3 - 2 * t);
function weaponPose(out, root, heading, technique, elapsed) {
  const p = Math.max(
    0,
    Math.min(
      1,
      (elapsed - technique.windup) / Math.max(EPS, technique.extension),
    ),
  );
  const distance =
    (technique.reach - technique.hitRadius) * (0.35 + 0.65 * smooth(p));
  const side =
    (technique.side === "left" ? -1 : 1) * Math.min(0.07, distance * 0.3);
  const forward = Math.sqrt(Math.max(0, distance * distance - side * side));
  out.x = root.x - Math.sin(heading) * forward + Math.cos(heading) * side;
  out.y = root.y + technique.originHeight;
  out.z = root.z - Math.cos(heading) * forward - Math.sin(heading) * side;
}
/** Swept weapon-sphere vs body-sphere contacts. Active-time clipping prevents a
 * fast startup/recovery pass from counting as a strike. Hit ids reset per strike,
 * not per frame. Contact events are signals only: no health/damage is implemented.
 */
export class StrikeHitDetector {
  constructor({ targets = [], onContact = () => {} } = {}) {
    this.targets = targets;
    this.onContact = onContact;
    this.sequence = -1;
    this.hitIds = new Set();
    this.count = 0;
    this.lastContact = null;
    this.a = new Vector3();
    this.b = new Vector3();
    this.poseSampler = new StrikePoseSampler();
    this.orientation = new Quaternion();
    this.bodyLocal = new Vector3();
    this.rootA = point();
    this.rootB = point();
  }
  sweep(
    technique,
    attack,
    startElapsed,
    endElapsed,
    start,
    end,
    startHeading,
    endHeading,
    orientationStart = null,
    orientationEnd = null,
    liftStart = 0,
    liftEnd = 0,
    motionFrom = 0,
    motionTo = 1,
  ) {
    if (
      !technique ||
      !attack.active ||
      attack.cancelled ||
      !technique.hitRadius ||
      endElapsed <= startElapsed
    )
      return;
    if (attack.sequence !== this.sequence) {
      this.sequence = attack.sequence;
      this.hitIds.clear();
    }
    const from = Math.max(startElapsed, technique.windup),
      to = Math.min(
        endElapsed,
        technique.windup + technique.extension + technique.impact,
      );
    if (to <= from + EPS) return;
    const span = endElapsed - startElapsed;
    const t0 = (from - startElapsed) / span,
      t1 = (to - startElapsed) / span;
    const turn = Math.atan2(
      Math.sin(endHeading - startHeading),
      Math.cos(endHeading - startHeading),
    );
    // Bound the curved limb/yaw approximation without scaling reach with speed.
    const bodyTurn =
      orientationStart && orientationEnd
        ? orientationStart.angleTo(orientationEnd) * (motionTo - motionFrom)
        : Math.abs(turn);
    const localArc =
      technique.animation === "backhand"
        ? ((to - from) /
            Math.max(0.001, technique.extension + technique.impact)) *
          1.85
        : 0;
    const steps = Math.max(
      1,
      Math.min(32, Math.ceil((bodyTurn + localArc) / 0.055)),
    );
    for (let n = 0; n < steps; n++) {
      const f0 = lerp(t0, t1, n / steps),
        f1 = lerp(t0, t1, (n + 1) / steps),
        g0 = lerp(motionFrom, motionTo, f0),
        g1 = lerp(motionFrom, motionTo, f1);
      for (const axis of AXES) {
        this.rootA[axis] = lerp(start[axis], end[axis], f0);
        this.rootB[axis] = lerp(start[axis], end[axis], f1);
      }
      if (technique.adaptive) {
        if (orientationStart && orientationEnd)
          this.orientation.slerpQuaternions(
            orientationStart,
            orientationEnd,
            g0,
          );
        else this.orientation.setFromAxisAngle(UP, startHeading + turn * f0);
        this.poseSampler.sample(
          this.a,
          this.rootA,
          startHeading + turn * f0,
          technique,
          lerp(startElapsed, endElapsed, f0),
          attack.context,
          this.orientation,
          lerp(liftStart, liftEnd, g0),
        );
        if (orientationStart && orientationEnd)
          this.orientation.slerpQuaternions(
            orientationStart,
            orientationEnd,
            g1,
          );
        else this.orientation.setFromAxisAngle(UP, startHeading + turn * f1);
        this.poseSampler.sample(
          this.b,
          this.rootB,
          startHeading + turn * f1,
          technique,
          lerp(startElapsed, endElapsed, f1),
          attack.context,
          this.orientation,
          lerp(liftStart, liftEnd, g1),
        );
      } else {
        weaponPose(
          this.a,
          this.rootA,
          startHeading + turn * f0,
          technique,
          lerp(startElapsed, endElapsed, f0),
        );
        weaponPose(
          this.b,
          this.rootB,
          startHeading + turn * f1,
          technique,
          lerp(startElapsed, endElapsed, f1),
        );
      }
      for (const target of this.targets) {
        if (
          !target ||
          target.id == null ||
          !target.position ||
          !Number.isFinite(target.position.x) ||
          !Number.isFinite(target.position.y ?? 0) ||
          !Number.isFinite(target.position.z) ||
          !Number.isFinite(target.strikeRadius ?? 0.24) ||
          (target.strikeRadius ?? 0.24) <= 0 ||
          target.active === false ||
          this.hitIds.has(target.id)
        )
          continue;
        const previous = target.previousPosition ?? target.position,
          current = target.position;
        const hitboxes = target.hitboxes ?? DEFAULT_BOXES;
        for (const box of hitboxes) {
          if (this.hitIds.has(target.id)) break;
          const cy = box?.height ?? target.strikeHeight ?? 1.4,
            bodyRadius = box?.radius ?? target.strikeRadius ?? 0.24,
            radius = bodyRadius + technique.hitRadius;
          const x = this.a.x - lerp(previous.x, current.x, g0),
            y = this.a.y - lerp(previous.y ?? 0, current.y ?? 0, g0) - cy,
            z = this.a.z - lerp(previous.z, current.z, g0);
          const vx = this.b.x - lerp(previous.x, current.x, g1) - x,
            vy = this.b.y - lerp(previous.y ?? 0, current.y ?? 0, g1) - cy - y,
            vz = this.b.z - lerp(previous.z, current.z, g1) - z;
          const a = vx * vx + vy * vy + vz * vz,
            b = x * vx + y * vy + z * vz,
            c = x * x + y * y + z * z - radius * radius;
          let hit =
            c <= EPS
              ? 0
              : a > EPS && b * b - a * c >= 0
                ? (-b - Math.sqrt(Math.max(0, b * b - a * c))) / a
                : Infinity;
          if (hit < -EPS || hit > 1 + EPS) continue;
          hit = Math.max(0, Math.min(1, hit));
          const f = lerp(f0, f1, hit),
            heading = startHeading + turn * f,
            global = lerp(motionFrom, motionTo, f);
          let dx =
            lerp(previous.x, current.x, global) - lerp(start.x, end.x, f);
          let dz =
            lerp(previous.z, current.z, global) - lerp(start.z, end.z, f);
          let dy =
            lerp(previous.y ?? 0, current.y ?? 0, global) +
            cy -
            lerp(start.y, end.y, f) -
            technique.originHeight;
          let angle = Math.atan2(-dx, -dz) - heading;
          if (technique.adaptive) {
            if (orientationStart && orientationEnd)
              this.orientation.slerpQuaternions(
                orientationStart,
                orientationEnd,
                global,
              );
            else this.orientation.setFromAxisAngle(UP, heading);
            this.bodyLocal
              .set(
                dx,
                dy +
                  technique.originHeight -
                  BODY_PIVOT -
                  lerp(liftStart, liftEnd, global),
                dz,
              )
              .applyQuaternion(this.orientation.invert());
            dx = this.bodyLocal.x;
            dz = this.bodyLocal.z;
            dy = this.bodyLocal.y - (technique.originHeight - BODY_PIVOT);
            angle = Math.atan2(-dx, -dz);
          }
          if (
            Math.hypot(dx, dy, dz) > technique.reach + bodyRadius + EPS ||
            Math.abs(dy) > technique.maxVertical + EPS ||
            Math.abs(Math.atan2(Math.sin(angle), Math.cos(angle))) >
              technique.maxAngle + EPS
          )
            continue;
          this.hitIds.add(target.id);
          this.count++;
          this.lastContact = Object.freeze({
            sequence: attack.sequence,
            techniqueId: technique.id,
            targetId: target.id,
            time: lerp(startElapsed, endElapsed, f),
            point: Object.freeze({
              x: lerp(this.a.x, this.b.x, hit),
              y: lerp(this.a.y, this.b.y, hit),
              z: lerp(this.a.z, this.b.z, hit),
            }),
          });
          this.onContact(this.lastContact);
        }
      }
    }
  }
}
