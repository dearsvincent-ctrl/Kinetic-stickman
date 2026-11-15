/** Static authored collision surfaces; render meshes are built from these same
 * dimensions. Keep the central 40 m combat field and most of the arena open. */
export const TRAVERSAL_STRUCTURES = Object.freeze([
  box("run-wall", 42, -30, 1, 8, 28),
  box("starter-roof", 52, -31, 8, 6, 10),
  box("gap-roof", 52, -41.5, 8, 6, 5),
  box("middle-tower", 64, -31, 10, 12, 10),
  box("high-tower", 74, -41, 6, 20, 6),
  box("low-vault", 50, -21, 6, 0.8, 0.7, true),
  box("return-vault", 73, -20, 0.7, 1, 7, true),
  pole("short-pole", 60, -22, 0.24, 8),
  pole("high-pole", 66, -19, 0.26, 12),
]);
export function box(
  id,
  x,
  z,
  width,
  height,
  depth,
  vaultable = false,
  bottom = 0,
) {
  return Object.freeze({
    id,
    kind: "box",
    minX: x - width / 2,
    maxX: x + width / 2,
    minZ: z - depth / 2,
    maxZ: z + depth / 2,
    bottom,
    top: bottom + height,
    vaultable,
    climbable: true,
  });
}
export function pole(id, x, z, radius, height, bottom = 0) {
  return Object.freeze({
    id,
    kind: "pole",
    x,
    z,
    radius,
    bottom,
    top: bottom + height,
    climbable: true,
  });
}
