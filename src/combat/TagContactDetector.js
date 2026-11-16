import { Vector3 } from "three";

const CENTRE_HEIGHT = 0.9;
const clamp01 = (value) => Math.max(0, Math.min(1, value));
const finitePoint = (p) =>
  p && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z);

/** Continuous contact between two independently moving root paths. The range
 * is a real 3D distance, never enlarged by speed. Queries use the shared static
 * collision index and leave movement/collision response state untouched.
 *
 * Call once for each collision-resolved simulation substep. Contact candidates
 * are synchronized times on both paths; a mere intersection of their trails
 * at different times is not a tag. */
export class TagContactDetector {
  constructor(world) {
    this.world = world;
    this.playerCentre = new Vector3();
    this.enemyCentre = new Vector3();
    this.ray = new Vector3();
    this.times = new Float64Array(5);
  }

  visible(playerStart, playerEnd, enemyStart, enemyEnd, time) {
    if (!this.world?.firstBlock) return true;
    this.playerCentre.lerpVectors(playerStart, playerEnd, time);
    this.enemyCentre.lerpVectors(enemyStart, enemyEnd, time);
    this.playerCentre.y += CENTRE_HEIGHT;
    this.enemyCentre.y += CENTRE_HEIGHT;
    this.ray.subVectors(this.enemyCentre, this.playerCentre);
    // A zero-length contact has no separating surface. Real movement never
    // enters a structure; both points come from collision-resolved positions.
    return !this.world.firstBlock(this.playerCentre, this.ray, 0, 0);
  }

  contact(playerStart, playerEnd, enemyStart, enemyEnd, radius) {
    if (
      !finitePoint(playerStart) ||
      !finitePoint(playerEnd) ||
      !finitePoint(enemyStart) ||
      !finitePoint(enemyEnd) ||
      !Number.isFinite(radius) ||
      radius < 0
    )
      return null;

    const x = enemyStart.x - playerStart.x,
      y = enemyStart.y - playerStart.y,
      z = enemyStart.z - playerStart.z,
      vx = enemyEnd.x - enemyStart.x - (playerEnd.x - playerStart.x),
      vy = enemyEnd.y - enemyStart.y - (playerEnd.y - playerStart.y),
      vz = enemyEnd.z - enemyStart.z - (playerEnd.z - playerStart.z);
    if (
      !Number.isFinite(x) ||
      !Number.isFinite(y) ||
      !Number.isFinite(z) ||
      !Number.isFinite(vx) ||
      !Number.isFinite(vy) ||
      !Number.isFinite(vz)
    )
      return null;

    // Normalize before dot products so extreme but finite sandbox motion
    // cannot overflow squared lengths or quadratic discriminants.
    const scale = Math.max(
      Math.abs(x),
      Math.abs(y),
      Math.abs(z),
      Math.abs(vx),
      Math.abs(vy),
      Math.abs(vz),
      radius,
    );
    if (scale === 0)
      return this.visible(playerStart, playerEnd, enemyStart, enemyEnd, 0)
        ? 0
        : null;
    const sx = x / scale,
      sy = y / scale,
      sz = z / scale,
      dx = vx / scale,
      dy = vy / scale,
      dz = vz / scale,
      r = radius / scale,
      motion = dx * dx + dy * dy + dz * dz;
    if (motion === 0) {
      return Math.hypot(sx, sy, sz) <= r
        ? this.clearWindow(
            playerStart,
            playerEnd,
            enemyStart,
            enemyEnd,
            0,
            1,
            0.75,
          )
        : null;
    }
    const closest = -(sx * dx + sy * dy + sz * dz) / motion,
      t = clamp01(closest),
      distance = Math.hypot(sx + dx * t, sy + dy * t, sz + dz * t);
    if (distance > r + Number.EPSILON * r * 8) return null;
    const perpendicular = Math.hypot(
      sx + dx * closest,
      sy + dy * closest,
      sz + dz * closest,
    );
    const halfWindow = Math.sqrt(
      Math.max(0, ((r - perpendicular) * (r + perpendicular)) / motion),
    );
    const enter = clamp01(closest - halfWindow),
      exit = clamp01(closest + halfWindow);
    return this.clearWindow(
      playerStart,
      playerEnd,
      enemyStart,
      enemyEnd,
      enter,
      exit,
      t,
    );
  }

  clearWindow(
    playerStart,
    playerEnd,
    enemyStart,
    enemyEnd,
    enter,
    exit,
    closest,
  ) {
    // Entry is the common case. Bounded extra samples allow a corner to clear
    // during the same contact window without ever tagging through the wall.
    this.times[0] = enter;
    this.times[1] = enter + (exit - enter) * 0.25;
    this.times[2] = enter + (exit - enter) * 0.5;
    this.times[3] = Math.max(enter, Math.min(exit, closest));
    this.times[4] = exit;
    // Five elements, insertion sort: deterministic, no transient arrays.
    for (let i = 1; i < this.times.length; i++) {
      const value = this.times[i];
      let j = i - 1;
      while (j >= 0 && this.times[j] > value) {
        this.times[j + 1] = this.times[j];
        j--;
      }
      this.times[j + 1] = value;
    }
    for (let i = 0; i < this.times.length; i++) {
      const candidate = this.times[i];
      if (i > 0 && candidate === this.times[i - 1]) continue;
      if (this.visible(playerStart, playerEnd, enemyStart, enemyEnd, candidate))
        return candidate;
    }
    return null;
  }
}
