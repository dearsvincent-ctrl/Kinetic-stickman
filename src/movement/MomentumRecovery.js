import { Vector3 } from "three";
export const RECOVERY_CONFIG = Object.freeze({
  minSpeed: 1.4,
  minInput: 0.05,
  minAngle: (65 * Math.PI) / 180,
  inputChange: (32 * Math.PI) / 180,
  minBraking: 2,
  reentryTime: 0.09,
  duration: 0.34,
});
const clamp = (n) => Math.max(0, Math.min(1, n));
const smooth = (n) => {
  n = clamp(n);
  return n * n * (3 - 2 * n);
};
/** Observer of collision-resolved velocity. No movement, attack or angular-state
 * writes: steering always happens before the visual recovery is sampled. */
export class MomentumRecovery {
  constructor(config = {}) {
    this.config = { ...RECOVERY_CONFIG, ...config };
    this.incoming = new Vector3();
    this.redirect = new Vector3();
    this.lastIntent = new Vector3();
    this.sequence = 0;
    this.reset();
  }
  reset() {
    this.elapsed = 1;
    this.duration = this.config.duration;
    this.weight = 0;
    this.compression = 0;
    this.push = 0;
    this.intensity = 0;
    this.speed = 0;
    this.braking = 0;
    this.kind = "none";
    this.side = 1;
    this.lastIntent.set(0, 0, 0);
  }
  get active() {
    return this.elapsed < this.duration;
  }
  update(dt, previousVelocity, movement, input, cameraYaw) {
    if (!Number.isFinite(dt) || dt <= 0) return;
    this.elapsed += dt;
    const c = this.config,
      x = input.move.x,
      y = input.move.y,
      m = Math.hypot(x, y),
      speed = previousVelocity.length();
    if (m > c.minInput) {
      const sin = Math.sin(cameraYaw),
        cos = Math.cos(cameraYaw),
        dx = (x * cos - y * sin) / m,
        dz = (-x * sin - y * cos) / m;
      const changed =
        this.lastIntent.lengthSq() < 0.1 ||
        dx * this.lastIntent.x + dz * this.lastIntent.z <
          Math.cos(c.inputChange);
      this.lastIntent.set(dx, 0, dz);
      const dot =
        speed > 1e-6
          ? (dx * previousVelocity.x + dz * previousVelocity.z) / speed
          : 1;
      const braking =
        speed > 1e-6
          ? Math.max(
              0,
              (previousVelocity.x * (previousVelocity.x - movement.velocity.x) +
                previousVelocity.z *
                  (previousVelocity.z - movement.velocity.z)) /
                (speed * dt),
            )
          : 0;
      if (
        changed &&
        movement.jump.ready &&
        !movement.dash.active &&
        speed >= c.minSpeed &&
        dot < Math.cos(c.minAngle) &&
        braking >= c.minBraking &&
        this.elapsed > c.reentryTime
      ) {
        const angle = Math.acos(Math.max(-1, Math.min(1, dot)));
        this.incoming.copy(previousVelocity).normalize();
        this.redirect.set(dx, 0, dz);
        this.kind =
          angle > (150 * Math.PI) / 180
            ? "back"
            : angle > (105 * Math.PI) / 180
              ? "diagonal"
              : "lateral";
        this.side = this.incoming.x * dz - this.incoming.z * dx >= 0 ? 1 : -1;
        const speedCue =
          0.2 +
          0.4 * Math.min(1, speed / 5.2) +
          0.4 * Math.min(1, Math.log2(1 + speed / 5.2) / Math.log2(101));
        this.intensity = clamp(
          Math.sqrt((1 - dot) / 2) *
            speedCue *
            Math.min(1, Math.sqrt(braking / ((speed + 1) * 8))),
        );
        this.speed = speed;
        this.braking = braking;
        this.duration = c.duration + 0.06 * this.intensity;
        this.elapsed = 0;
        this.sequence++;
      }
    }
    const t = this.elapsed / this.duration;
    this.weight = smooth(t / 0.12) * (1 - smooth((t - 0.65) / 0.35));
    this.compression = Math.sin(Math.PI * clamp(t / 0.58)) * this.weight;
    this.push = Math.sin(Math.PI * clamp((t - 0.3) / 0.7)) * this.weight;
  }
}
