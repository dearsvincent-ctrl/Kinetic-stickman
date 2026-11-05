export const dampFactor = (rate, dt) => 1 - Math.exp(-rate * dt);
export const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
export function dampAngle(current, target, rate, dt) {
  const delta = Math.atan2(
    Math.sin(target - current),
    Math.cos(target - current),
  );
  return current + delta * dampFactor(rate, dt);
}
