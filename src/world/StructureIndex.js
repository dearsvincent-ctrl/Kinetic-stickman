export const structureBounds = (s) =>
  s.kind === "pole"
    ? {
        minX: s.x - s.radius,
        maxX: s.x + s.radius,
        minZ: s.z - s.radius,
        maxZ: s.z + s.radius,
      }
    : s;
const byIndex = (a, b) => a - b;

/** Immutable XZ broad phase shared by player, camera and enemy world forks.
 * Queries reuse caller output and return author order for deterministic ties. */
export class StructureIndex {
  constructor(structures, cellSize = 48) {
    this.structures = structures;
    this.cellSize = cellSize;
    if (!Number.isFinite(cellSize) || cellSize <= 0)
      throw new RangeError("Invalid structure cell size");
    this.columns = new Map();
    this.cellCount = 0;
    this.bounds = structures.map(structureBounds);
    this.stamps = new Uint32Array(structures.length);
    this.sequence = 0;
    this.minX = this.minZ = Infinity;
    this.maxX = this.maxZ = -Infinity;
    for (let i = 0; i < structures.length; i++) {
      const b = this.bounds[i],
        x0 = Math.floor(b.minX / cellSize),
        x1 = Math.floor(b.maxX / cellSize),
        z0 = Math.floor(b.minZ / cellSize),
        z1 = Math.floor(b.maxZ / cellSize);
      this.minX = Math.min(this.minX, x0);
      this.maxX = Math.max(this.maxX, x1);
      this.minZ = Math.min(this.minZ, z0);
      this.maxZ = Math.max(this.maxZ, z1);
      for (let x = x0; x <= x1; x++) {
        let column = this.columns.get(x);
        if (!column) this.columns.set(x, (column = new Map()));
        for (let z = z0; z <= z1; z++) {
          let bucket = column.get(z);
          if (!bucket) {
            column.set(z, (bucket = []));
            this.cellCount++;
          }
          bucket.push(i);
        }
      }
    }
  }
  query(minX, maxX, minZ, maxZ, out) {
    out.length = 0;
    const x0 = Math.max(this.minX, Math.floor(minX / this.cellSize)),
      x1 = Math.min(this.maxX, Math.floor(maxX / this.cellSize)),
      z0 = Math.max(this.minZ, Math.floor(minZ / this.cellSize)),
      z1 = Math.min(this.maxZ, Math.floor(maxZ / this.cellSize));
    if (x0 > x1 || z0 > z1) return out;
    if ((x1 - x0 + 1) * (z1 - z0 + 1) > this.cellCount * 2) {
      for (let i = 0; i < this.structures.length; i++) {
        const b = this.bounds[i];
        if (
          b.maxX >= minX &&
          b.minX <= maxX &&
          b.maxZ >= minZ &&
          b.minZ <= maxZ
        )
          out.push(this.structures[i]);
      }
      return out;
    }
    this.sequence = (this.sequence + 1) >>> 0;
    if (!this.sequence) {
      this.stamps.fill(0);
      this.sequence = 1;
    }
    for (let x = x0; x <= x1; x++) {
      const column = this.columns.get(x);
      if (!column) continue;
      for (let z = z0; z <= z1; z++) {
        const bucket = column.get(z);
        if (!bucket) continue;
        for (const i of bucket) {
          if (this.stamps[i] === this.sequence) continue;
          this.stamps[i] = this.sequence;
          const b = this.bounds[i];
          if (
            b.maxX >= minX &&
            b.minX <= maxX &&
            b.maxZ >= minZ &&
            b.minZ <= maxZ
          )
            out.push(i);
        }
      }
    }
    out.sort(byIndex);
    for (let i = 0; i < out.length; i++) out[i] = this.structures[out[i]];
    return out;
  }
}
