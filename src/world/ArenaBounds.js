/** Kinematic world adapter. Swap this for Rapier's character controller later.
 * Positions are metres, Y is up, and input displacement is already time-scaled.
 */
export class ArenaBounds {
  constructor(halfSize = 18, obstacles = []) {
    this.halfSize = halfSize;
    this.obstacles = obstacles;
    this.contactNormals = new Float64Array(8);
    this.contactCount = 0;
    this.hasObstacleContact = false;
  }

  move(position, displacement, radius, out) {
    this.contactCount = 0;
    this.hasObstacleContact = false;
    const limit = this.halfSize - radius;
    // Keep the original flat-arena path exactly unchanged when no props exist.
    if (this.obstacles.length)
      return this.moveAroundObstacles(
        position,
        displacement,
        radius,
        limit,
        out,
      );
    out.set(
      Math.max(-limit, Math.min(limit, position.x + displacement.x)),
      0,
      Math.max(-limit, Math.min(limit, position.z + displacement.z)),
    );
    return out;
  }

  /** Sweep the player's footprint against stationary circular props. The
   * unresolved motion slides along each contact instead of jumping to an end
   * position; the same adapter is used by normal movement and dash substeps.
   */
  moveAroundObstacles(position, displacement, radius, limit, out) {
    let x = Math.max(-limit, Math.min(limit, position.x));
    let z = Math.max(-limit, Math.min(limit, position.z));
    const epsilon = 1e-8;

    // Recovery for an externally placed/loaded actor inside a prop. This is
    // normally unused; a sweep starting outside can never enter the boundary.
    for (const obstacle of this.obstacles) {
      if (obstacle.active === false || !(obstacle.radius > 0)) continue;
      const dx = x - obstacle.position.x;
      const dz = z - obstacle.position.z;
      const expanded = radius + obstacle.radius;
      const distance = Math.hypot(dx, dz);
      if (distance < expanded - epsilon) {
        const length = Math.hypot(displacement.x, displacement.z);
        const nx =
          distance > epsilon
            ? dx / distance
            : length > epsilon
              ? -displacement.x / length
              : 1;
        const nz =
          distance > epsilon
            ? dz / distance
            : length > epsilon
              ? -displacement.z / length
              : 0;
        x = obstacle.position.x + nx * expanded;
        z = obstacle.position.z + nz * expanded;
        this.recordContact(nx, nz, true);
      }
    }

    let vx = displacement.x;
    let vz = displacement.z;
    // Four contacts suffice for a prop plus an arena corner. Dropping any
    // unresolved remainder is preferable to tunnelling in a wedged layout.
    for (let iteration = 0; iteration < 4; iteration++) {
      const squaredLength = vx * vx + vz * vz;
      if (squaredLength < 1e-20) break;
      let time = 1;
      let normalX = 0;
      let normalZ = 0;
      let obstacleContact = false;
      const wallX =
        vx > 0 ? (limit - x) / vx : vx < 0 ? (-limit - x) / vx : Infinity;
      const wallZ =
        vz > 0 ? (limit - z) / vz : vz < 0 ? (-limit - z) / vz : Infinity;
      if (wallX >= -epsilon && wallX <= time) {
        time = Math.max(0, wallX);
        normalX = vx > 0 ? -1 : 1;
      }
      if (wallZ >= -epsilon && wallZ <= time) {
        time = Math.max(0, wallZ);
        normalX = 0;
        normalZ = vz > 0 ? -1 : 1;
      }

      for (const obstacle of this.obstacles) {
        if (obstacle.active === false || !(obstacle.radius > 0)) continue;
        const dx = x - obstacle.position.x;
        const dz = z - obstacle.position.z;
        const expanded = radius + obstacle.radius;
        const dot = dx * vx + dz * vz;
        // Tangent/outward motion must remain free, including at exact contact.
        if (dot >= -epsilon) continue;
        const c = dx * dx + dz * dz - expanded * expanded;
        const discriminant = dot * dot - squaredLength * c;
        if (discriminant < 0) continue;
        const hit =
          (-dot - Math.sqrt(Math.max(0, discriminant))) / squaredLength;
        if (hit < -epsilon || hit > time) continue;
        const hitX = dx + vx * Math.max(0, hit);
        const hitZ = dz + vz * Math.max(0, hit);
        const length = Math.hypot(hitX, hitZ);
        time = Math.max(0, hit);
        normalX = hitX / length;
        normalZ = hitZ / length;
        obstacleContact = true;
      }

      x += vx * time;
      z += vz * time;
      if (!normalX && !normalZ) break;
      this.recordContact(normalX, normalZ, obstacleContact);
      vx *= 1 - time;
      vz *= 1 - time;
      const inward = Math.min(0, vx * normalX + vz * normalZ);
      vx -= normalX * inward;
      vz -= normalZ * inward;
    }
    return out.set(
      Math.max(-limit, Math.min(limit, x)),
      0,
      Math.max(-limit, Math.min(limit, z)),
    );
  }

  recordContact(nx, nz, obstacleContact) {
    this.hasObstacleContact ||= obstacleContact;
    if (this.contactCount >= 4) return;
    const index = this.contactCount++ * 2;
    this.contactNormals[index] = nx;
    this.contactNormals[index + 1] = nz;
  }

  /** Retain tangent momentum when a round prop changes both displacement
   * axes. Return false for ordinary arena movement so its original wall-axis
   * cancellation remains unchanged in the character controller.
   */
  resolveVelocity(velocity) {
    if (!this.hasObstacleContact) return false;
    for (let pass = 0; pass < this.contactCount; pass++) {
      for (let index = 0; index < this.contactCount * 2; index += 2) {
        const nx = this.contactNormals[index];
        const nz = this.contactNormals[index + 1];
        const inward = Math.min(0, velocity.x * nx + velocity.z * nz);
        velocity.x -= nx * inward;
        velocity.z -= nz * inward;
      }
    }
    return true;
  }
}
