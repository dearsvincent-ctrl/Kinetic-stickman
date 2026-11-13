/** Direction is sampled only for an accepted second Jump. Ordinary joystick
 * movement never starts a technique. The reference stays on take-off intent,
 * independently of later camera orbit or velocity/facing changes. */
export const JUMP_DIRECTION_CONFIG = Object.freeze({
  minMagnitude: 0.08,
  longitudinalThreshold: 0.35,
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
  if (m < config.minMagnitude) return null;
  const forward =
    (x * Math.sin(cameraYaw - referenceYaw) +
      y * Math.cos(cameraYaw - referenceYaw)) /
    m;
  return forward >= config.longitudinalThreshold
    ? "frontflip"
    : forward <= -config.longitudinalThreshold
      ? "backflip"
      : null;
}
