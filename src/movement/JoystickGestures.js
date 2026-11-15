/** Direction is sampled only for an accepted second Jump. Ordinary joystick
 * movement never starts a technique. Facing is captured at that press, before
 * subsequent steering or camera input, and cannot redirect the selected flip. */
export const JUMP_DIRECTION_CONFIG = Object.freeze({
  minMagnitude: 0.12,
});
export function intendedJumpFacing(input, cameraYaw, velocity, facing) {
  const { x, y } = input.move;
  if (Math.hypot(x, y) >= JUMP_DIRECTION_CONFIG.minMagnitude)
    return cameraYaw - Math.atan2(x, y);
  return velocity.lengthSq() > 0.04
    ? Math.atan2(-velocity.x, -velocity.z)
    : facing;
}
export function selectDoubleJumpFlip(
  input,
  cameraYaw,
  referenceYaw,
  config = JUMP_DIRECTION_CONFIG,
) {
  const { x, y } = input.move,
    m = Math.hypot(x, y);
  if (m < config.minMagnitude) return "backflip";
  const forward =
    (x * Math.sin(cameraYaw - referenceYaw) +
      y * Math.cos(cameraYaw - referenceYaw)) /
    m;
  const right =
    (x * Math.cos(cameraYaw - referenceYaw) -
      y * Math.sin(cameraYaw - referenceYaw)) /
    m;
  // Stable longitudinal tie-break for equal diagonals; no repeated reselection.
  return Math.abs(forward) >= Math.abs(right)
    ? forward >= 0
      ? "frontflip"
      : "backflip"
    : right >= 0
      ? "rightflip"
      : "leftflip";
}
