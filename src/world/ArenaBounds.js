/** Kinematic world adapter. Swap this for Rapier's character controller later.
 * Positions are metres, Y is up, and input displacement is already time-scaled.
 */
export class ArenaBounds {
  constructor(halfSize = 18) {
    this.halfSize = halfSize;
  }

  move(position, displacement, radius, out) {
    const limit = this.halfSize - radius;
    out.set(
      Math.max(-limit, Math.min(limit, position.x + displacement.x)),
      0,
      Math.max(-limit, Math.min(limit, position.z + displacement.z)),
    );
    return out;
  }
}
