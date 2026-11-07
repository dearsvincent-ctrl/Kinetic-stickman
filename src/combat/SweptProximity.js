/** Earliest point of a physical segment inside both unscaled technique reach
 * and selection range. Clip against vertical limits and the forward cone too;
 * a fast pass beside/behind/above a target must never enlarge attack reach.
 * Scratch intervals are caller-owned, with no allocations per query.
 */
export function sweptTechniqueEntry(
  start,
  end,
  target,
  technique,
  entryDistance,
  facing,
  interval,
) {
  const targetY = (target.position.y ?? 0) + (target.strikeHeight ?? 1.4);
  const radius = Math.min(
    entryDistance,
    technique.reach + (target.strikeRadius ?? 0.24),
  );
  const x = target.position.x - start.x;
  const y = targetY - (start.y + technique.originHeight);
  const z = target.position.z - start.z;
  const vx = start.x - end.x,
    vy = start.y - end.y,
    vz = start.z - end.z;
  const a = vx * vx + vy * vy + vz * vz;
  if (a < 1e-20) return null;
  const b = x * vx + y * vy + z * vz;
  const c = x * x + y * y + z * z - radius * radius;
  const discriminant = b * b - a * c;
  if (discriminant < 0) return null;
  const root = Math.sqrt(Math.max(0, discriminant));
  interval[0] = Math.max(0, (-b - root) / a);
  interval[1] = Math.min(1, (-b + root) / a);
  if (interval[0] > interval[1]) return null;
  if (
    !clip(technique.maxVertical - y, -vy, interval) ||
    !clip(technique.maxVertical + y, vy, interval) ||
    !clip(start.y - (technique.minHeight ?? 0), -vy, interval)
  )
    return null;
  const sin = Math.sin(facing),
    cos = Math.cos(facing);
  const forward = -x * sin - z * cos,
    df = -vx * sin - vz * cos;
  const side = x * cos - z * sin,
    ds = vx * cos - vz * sin;
  const tangent = Math.tan(Math.min(Math.PI / 2 - 1e-6, technique.maxAngle));
  if (
    !clip(forward, df, interval) ||
    !clip(forward * tangent + side, df * tangent + ds, interval) ||
    !clip(forward * tangent - side, df * tangent - ds, interval)
  )
    return null;
  return interval[0];
}
function clip(value, delta, interval) {
  if (Math.abs(delta) < 1e-14) return value >= -1e-10;
  const crossing = -value / delta;
  if (delta > 0) interval[0] = Math.max(interval[0], crossing);
  else interval[1] = Math.min(interval[1], crossing);
  return interval[0] <= interval[1] + 1e-12;
}
