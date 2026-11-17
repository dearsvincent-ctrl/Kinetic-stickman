import { Vector3 } from "three";
import { ArenaBounds } from "./ArenaBounds.js";
import { StructureIndex } from "./StructureIndex.js";
const EPS = 1e-6;
const AXES = ["x", "y", "z"];

// The normal sweep starts outside its expanded collider. A wider camera lens
// may begin inside the added clearance shell while the player is still clear.
// Catch motion into that shell; motion away from its nearest face can escape.
function entersCameraShell(p, d, s, radius) {
  if (s.kind === "pole") {
    const dx = p.x - s.x,
      dz = p.z - s.z;
    const distance = Math.hypot(dx, dz);
    const radialDepth = s.radius + radius - distance;
    const lowerDepth = p.y - (s.bottom - radius * 2);
    const upperDepth = s.top - p.y;
    if (Math.min(radialDepth, lowerDepth, upperDepth) <= EPS) return false;
    if (lowerDepth < radialDepth && lowerDepth < upperDepth) return d.y > EPS;
    if (upperDepth < radialDepth) return d.y < -EPS;
    return dx * d.x + dz * d.z < -EPS;
  }
  let depth = Infinity,
    axis = "x",
    sign = 0;
  for (const a of AXES) {
    const low =
      a === "x" ? s.minX - radius : a === "y" ? s.bottom - radius * 2 : s.minZ - radius;
    const high =
      a === "x" ? s.maxX + radius : a === "y" ? s.top : s.maxZ + radius;
    const lowerDepth = p[a] - low,
      upperDepth = high - p[a];
    if (Math.min(lowerDepth, upperDepth) <= EPS) return false;
    if (lowerDepth < depth) {
      depth = lowerDepth;
      axis = a;
      sign = -1;
    }
    if (upperDepth < depth) {
      depth = upperDepth;
      axis = a;
      sign = 1;
    }
  }
  return d[axis] * sign < -EPS;
}

function overlapsSweep(p, d, s, r, height) {
  const minX = s.kind === "pole" ? s.x - s.radius : s.minX,
    maxX = s.kind === "pole" ? s.x + s.radius : s.maxX;
  const minZ = s.kind === "pole" ? s.z - s.radius : s.minZ,
    maxZ = s.kind === "pole" ? s.z + s.radius : s.maxZ;
  return (
    Math.max(p.x, p.x + d.x) + r >= minX &&
    Math.min(p.x, p.x + d.x) - r <= maxX &&
    Math.max(p.z, p.z + d.z) + r >= minZ &&
    Math.min(p.z, p.z + d.z) - r <= maxZ &&
    Math.max(p.y, p.y + d.y) + height >= s.bottom &&
    Math.min(p.y, p.y + d.y) <= s.top
  );
}

/** Swept upright avatar against a static box (foot origin, Y up). */
export function sweepBox(p, d, s, r, height, n) {
  let enter = -Infinity,
    exit = Infinity,
    axis = -1,
    sign = 0;
  for (let i = 0; i < 3; i++) {
    const a = AXES[i],
      lo = i === 0 ? s.minX - r : i === 1 ? s.bottom - height : s.minZ - r,
      hi = i === 0 ? s.maxX + r : i === 1 ? s.top : s.maxZ + r;
    if (Math.abs(d[a]) < 1e-12) {
      if (p[a] <= lo + EPS || p[a] >= hi - EPS) return Infinity;
      continue;
    }
    let near = (lo - p[a]) / d[a],
      far = (hi - p[a]) / d[a],
      normal = -1;
    if (near > far) {
      const swap = near;
      near = far;
      far = swap;
      normal = 1;
    }
    if (near > enter) {
      enter = near;
      axis = i;
      sign = normal;
    }
    exit = Math.min(exit, far);
    if (enter > exit + EPS) return Infinity;
  }
  if (enter < -EPS || enter > 1 + EPS || exit < 0 || axis < 0) return Infinity;
  n.set(0, 0, 0);
  n[AXES[axis]] = sign;
  return Math.max(0, Math.min(1, enter));
}
/** Cylinder sides and caps use an analytic interval, rather than a box proxy. */
export function sweepPole(p, d, s, r, height, n) {
  const dx = p.x - s.x,
    dz = p.z - s.z,
    R = s.radius + r,
    a = d.x * d.x + d.z * d.z,
    b = dx * d.x + dz * d.z,
    c = dx * dx + dz * dz - R * R;
  let radial = -Infinity,
    radialExit = Infinity;
  if (a < 1e-16) {
    if (c >= -EPS) return Infinity;
  } else {
    const disc = b * b - a * c;
    if (disc < 0) return Infinity;
    const root = Math.sqrt(Math.max(0, disc));
    radial = (-b - root) / a;
    radialExit = (-b + root) / a;
  }
  let vertical = -Infinity,
    verticalExit = Infinity,
    ny = 0;
  if (Math.abs(d.y) < 1e-12) {
    if (p.y <= s.bottom - height + EPS || p.y >= s.top - EPS) return Infinity;
  } else {
    vertical = (s.bottom - height - p.y) / d.y;
    verticalExit = (s.top - p.y) / d.y;
    ny = -1;
    if (vertical > verticalExit) {
      const swap = vertical;
      vertical = verticalExit;
      verticalExit = swap;
      ny = 1;
    }
  }
  const t = Math.max(radial, vertical),
    end = Math.min(radialExit, verticalExit);
  if (t < -EPS || t > 1 + EPS || end < t || end < 0) return Infinity;
  if (vertical > radial) n.set(0, ny, 0);
  else n.set(dx + d.x * t, 0, dz + d.z * t).normalize();
  return Math.max(0, Math.min(1, t));
}

/** Extends the existing circular-target adapter. Structures are separate from
 * BattleWorld's mutable enemy list, so resetting waves cannot delete the area. */
export class TraversalWorld extends ArenaBounds {
  constructor(
    halfSize,
    obstacles = [],
    structures = [],
    ignoredObstacle = null,
    index = null,
  ) {
    super(halfSize, obstacles, ignoredObstacle);
    this._structures = structures;
    this.spatialIndex = index ?? new StructureIndex(structures);
    this.candidates = [];
    this.queryNormal = new Vector3();
    this.queryHit = { structure: null, fraction: 1, normal: new Vector3() };
    this.querySample = { normal: new Vector3(), gap: 0, insideSpan: false };
    this.bodyHeight = 1.8;
    this.parkourEnabled = true;
    this.roundResult = new Vector3();
    this.cursor = new Vector3();
    this.remainder = new Vector3();
    this.normal = new Vector3();
    this.bestNormal = new Vector3();
    this.delta = new Vector3();
    this.origin = new Vector3();
    this.floorHit = false;
    this.ceilingHit = false;
    this.hitStructure = null;
  }
  get structures() {
    return this._structures;
  }
  set structures(value) {
    this._structures = value;
    this.spatialIndex = new StructureIndex(value);
  }
  query(minX, maxX, minZ, maxZ) {
    return this.spatialIndex.query(minX, maxX, minZ, maxZ, this.candidates);
  }
  sweepCandidates(p, d, r) {
    return this.query(
      Math.min(p.x, p.x + d.x) - r,
      Math.max(p.x, p.x + d.x) + r,
      Math.min(p.z, p.z + d.z) - r,
      Math.max(p.z, p.z + d.z) + r,
    );
  }
  fork(ignored) {
    const w = new TraversalWorld(
      this.halfSize,
      this.obstacles,
      this.structures,
      ignored,
      this.spatialIndex,
    );
    w.parkourEnabled = false;
    return w;
  }
  move(position, displacement, radius, out) {
    // Preserve the exact existing ground/circular collision path.
    super.move(position, displacement, radius, this.roundResult);
    this.roundResult.y = position.y;
    this.delta.subVectors(this.roundResult, position);
    return this.sweep(position, this.delta, radius, this.bodyHeight, out);
  }
  sweep(position, displacement, radius, height, out, ignored = null) {
    this.cursor.copy(position);
    this.remainder.copy(displacement);
    this.floorHit = this.ceilingHit = false;
    this.hitStructure = null;
    for (let pass = 0; pass < 6 && this.remainder.lengthSq() > 1e-20; pass++) {
      let t = 1,
        hit = null;
      for (const s of this.sweepCandidates(
        this.cursor,
        this.remainder,
        radius,
      )) {
        if (
          s === ignored ||
          !overlapsSweep(this.cursor, this.remainder, s, radius, height)
        )
          continue;
        const f = s.kind === "pole" ? sweepPole : sweepBox;
        const q = f(
          this.cursor,
          this.remainder,
          s,
          radius,
          height,
          this.normal,
        );
        if (q <= t) {
          t = q;
          hit = s;
          this.bestNormal.copy(this.normal);
        }
      }
      this.cursor.addScaledVector(this.remainder, t);
      if (!hit) break;
      this.hitStructure = hit;
      this.floorHit ||= this.bestNormal.y > 0.5;
      this.ceilingHit ||= this.bestNormal.y < -0.5;
      if (Math.abs(this.bestNormal.y) < 0.5)
        this.recordContact(this.bestNormal.x, this.bestNormal.z, true);
      this.remainder.multiplyScalar(1 - t);
      const into = Math.min(0, this.remainder.dot(this.bestNormal));
      this.remainder.addScaledVector(this.bestNormal, -into);
      this.cursor.addScaledVector(this.bestNormal, EPS * 2);
    }
    const limit = this.halfSize - radius;
    return out
      .copy(this.cursor)
      .setX(Math.max(-limit, Math.min(limit, this.cursor.x)))
      .setZ(Math.max(-limit, Math.min(limit, this.cursor.z)))
      .setY(Math.max(0, this.cursor.y));
  }
  resolveElevation(start, end, radius, out) {
    this.delta.subVectors(end, start);
    return this.sweep(start, this.delta, radius, this.bodyHeight, out);
  }
  supportHeight(p, radius = 0) {
    let y = 0;
    for (const s of this.query(
      p.x - radius,
      p.x + radius,
      p.z - radius,
      p.z + radius,
    )) {
      if (s.top > p.y + 0.015) continue;
      const pad = radius * 0.3;
      const inside =
        s.kind === "pole"
          ? Math.hypot(p.x - s.x, p.z - s.z) < s.radius + pad
          : p.x > s.minX - pad &&
            p.x < s.maxX + pad &&
            p.z > s.minZ - pad &&
            p.z < s.maxZ + pad;
      if (inside) y = Math.max(y, s.top);
    }
    return y;
  }
  isSpaceFree(p, radius = 0.36, height = 1.8) {
    for (const s of this.query(
      p.x - radius,
      p.x + radius,
      p.z - radius,
      p.z + radius,
    )) {
      if (p.y >= s.top - EPS || p.y + height <= s.bottom + EPS) continue;
      if (s.kind === "pole") {
        if (Math.hypot(p.x - s.x, p.z - s.z) < s.radius + radius) return false;
      } else if (
        p.x > s.minX - radius &&
        p.x < s.maxX + radius &&
        p.z > s.minZ - radius &&
        p.z < s.maxZ + radius
      )
        return false;
    }
    return true;
  }
  sampleSurface(s, p, radius, out) {
    out.structure = s;
    if (s.kind === "pole") {
      const dx = p.x - s.x,
        dz = p.z - s.z,
        d = Math.hypot(dx, dz);
      out.normal.set(dx / (d || 1), 0, dz / (d || 1));
      out.gap = d - s.radius - radius;
      out.insideSpan = true;
    } else {
      // Retain an attached face across its span; candidates choose their nearest
      // exterior face only. Tangent-only passes never satisfy approach intent.
      let gap = Infinity,
        nx = 0,
        nz = 0;
      if (p.x <= s.minX + EPS) {
        gap = s.minX - p.x - radius;
        nx = -1;
      }
      if (p.x >= s.maxX - EPS && p.x - s.maxX - radius < gap) {
        gap = p.x - s.maxX - radius;
        nx = 1;
        nz = 0;
      }
      if (p.z <= s.minZ + EPS && s.minZ - p.z - radius < gap) {
        gap = s.minZ - p.z - radius;
        nx = 0;
        nz = -1;
      }
      if (p.z >= s.maxZ - EPS && p.z - s.maxZ - radius < gap) {
        gap = p.z - s.maxZ - radius;
        nx = 0;
        nz = 1;
      }
      out.normal.set(nx, 0, nz);
      out.gap = gap;
      out.insideSpan =
        nx !== 0
          ? p.z > s.minZ - 0.12 && p.z < s.maxZ + 0.12
          : p.x > s.minX - 0.12 && p.x < s.maxX + 0.12;
    }
    return out;
  }
  querySurface(p, direction, radius, out, reach = 0.16, ignored = null) {
    let best = Infinity,
      found = false;
    const searchPad = radius + reach;
    for (const s of this.query(
      p.x - searchPad,
      p.x + searchPad,
      p.z - searchPad,
      p.z + searchPad,
    )) {
      if (
        s === ignored ||
        !s.climbable ||
        p.y >= s.top + 0.05 ||
        p.y + 1.8 < s.bottom
      )
        continue;
      const pad = radius + reach;
      if (
        s.kind === "box"
          ? p.x < s.minX - pad ||
            p.x > s.maxX + pad ||
            p.z < s.minZ - pad ||
            p.z > s.maxZ + pad
          : Math.abs(p.x - s.x) > s.radius + pad ||
            Math.abs(p.z - s.z) > s.radius + pad
      )
        continue;
      this.sampleSurface(s, p, radius, out);
      const toward = -direction.dot(out.normal);
      if (
        !out.insideSpan ||
        out.gap < -0.025 ||
        out.gap > reach ||
        toward < 0.4
      )
        continue;
      const score = out.gap + (1 - toward) * 0.1;
      if (score < best) {
        best = score;
        this.bestSurface = s;
        found = true;
      }
    }
    return found ? this.sampleSurface(this.bestSurface, p, radius, out) : null;
  }
  clipCamera(target, desired, out, margin = 0.2) {
    const radius = Number.isFinite(margin) ? Math.max(0, margin) : 0.2;
    this.origin.copy(target);
    this.origin.y -= radius;
    this.delta.subVectors(desired, target);
    let t = 1;
    for (const s of this.sweepCandidates(this.origin, this.delta, radius)) {
      if (!overlapsSweep(this.origin, this.delta, s, radius, radius * 2)) continue;
      if (radius > 0.2 && entersCameraShell(this.origin, this.delta, s, radius)) {
        t = 0;
        break;
      }
      const f = s.kind === "pole" ? sweepPole : sweepBox;
      t = Math.min(
        t,
        f(this.origin, this.delta, s, radius, radius * 2, this.normal),
      );
    }
    return out
      .copy(target)
      .addScaledVector(this.delta, t < 1 ? Math.max(0, t - 0.015) : 1);
  }
  /** Read-only local obstacle query for ground navigation, separate from the
   * collision contact normals used to resolve physical momentum. */
  firstBlock(p, d, radius = 0.5, height = 1.8) {
    let best = 1,
      hit = null;
    for (const s of this.sweepCandidates(p, d, radius)) {
      if (!overlapsSweep(p, d, s, radius, height)) continue;
      let t = (s.kind === "pole" ? sweepPole : sweepBox)(
        p,
        d,
        s,
        radius,
        height,
        this.queryNormal,
      );
      if (!Number.isFinite(t)) {
        this.sampleSurface(s, p, radius, this.querySample);
        if (
          p.y < s.top &&
          p.y + height > s.bottom &&
          this.querySample.insideSpan &&
          this.querySample.gap < 0 &&
          this.querySample.gap > -radius - 0.05 &&
          d.dot(this.querySample.normal) < -EPS
        ) {
          t = 0;
          this.queryNormal.copy(this.querySample.normal);
        }
      }
      if (t < best) {
        best = t;
        hit = s;
        this.queryHit.normal.copy(this.queryNormal);
      }
    }
    if (!hit) return null;
    this.queryHit.structure = hit;
    this.queryHit.fraction = best;
    return this.queryHit;
  }
}
