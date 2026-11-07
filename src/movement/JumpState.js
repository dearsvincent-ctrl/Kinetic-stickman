export const JUMP_CONFIG = Object.freeze({
  height: 0.8,
  gravity: 18,
  airControl: 3.5,
  airDrag: 0.1,
  takeoffDuration: 0.08,
  landingDuration: 0.18,
});

const EPSILON = 1e-10;

/** Vertical movement timing only. The world adapter retains horizontal
 * collision ownership; animation reads these phases without moving the root.
 */
export class JumpState {
  constructor(overrides = {}) {
    const config = { ...JUMP_CONFIG, ...overrides };
    for (const key of Object.keys(JUMP_CONFIG)) {
      if (!Number.isFinite(config[key]) || config[key] < 0)
        throw new RangeError(`${key} must be a finite, nonnegative number`);
    }
    if (config.height <= 0 || config.gravity <= 0)
      throw new RangeError("Jump height and gravity must be positive");
    this.configure(config);
    this.phase = "grounded";
    this.height = 0;
    this.verticalVelocity = 0;
    this.elapsed = 0;
    this.sequence = 0;
    this.landingSpeed = 0;
  }

  configure(config) {
    for (const key of Object.keys(JUMP_CONFIG))
      if (!Number.isFinite(config[key]) || config[key] < 0)
        throw new RangeError(`Invalid jump ${key}`);
    if (config.height <= 0 || config.gravity <= 0)
      throw new RangeError("Jump height and gravity must be positive");
    this.config = Object.freeze({ ...config });
    this.launchVelocity = Math.sqrt(2 * config.gravity * config.height);
    this.flightDuration = (2 * this.launchVelocity) / config.gravity;
    // Height/launch velocity affect the next launch. Gravity and air response
    // can change during flight without rewriting position or current velocity.
  }

  get ready() {
    return this.phase === "grounded";
  }

  get airborne() {
    return this.phase === "airborne";
  }

  get grounded() {
    return !this.airborne;
  }

  get phaseProgress() {
    const duration =
      this.phase === "takeoff"
        ? this.config.takeoffDuration
        : this.phase === "airborne"
          ? this.flightDuration
          : this.phase === "landing"
            ? this.config.landingDuration
            : 0;
    return duration > 0 ? Math.min(1, this.elapsed / duration) : 0;
  }

  /** Time to the next physical or animation boundary, for horizontal stepping
   * with the correct ground/air response even during a longer frame.
   */
  get timeToBoundary() {
    if (this.phase === "takeoff")
      return Math.max(0, this.config.takeoffDuration - this.elapsed);
    if (this.phase === "landing")
      return Math.max(0, this.config.landingDuration - this.elapsed);
    if (!this.airborne) return Infinity;
    const speed = this.verticalVelocity;
    const root = Math.sqrt(
      speed * speed + 2 * this.config.gravity * this.height,
    );
    // The descending form avoids cancellation close to the floor.
    return speed < 0
      ? (2 * this.height) / (root - speed)
      : (speed + root) / this.config.gravity;
  }

  start() {
    if (!this.ready) return false;
    this.sequence++;
    this.height = 0;
    this.verticalVelocity = 0;
    this.landingSpeed = 0;
    this.elapsed = 0;
    this.phase = "takeoff";
    if (this.config.takeoffDuration === 0) this.launch();
    return true;
  }

  launch() {
    this.phase = "airborne";
    this.elapsed = 0;
    this.verticalVelocity = this.launchVelocity;
    this.flightLaunchVelocity = this.launchVelocity;
  }

  advance(dt) {
    if (!Number.isFinite(dt) || dt <= 0) return;
    let remaining = dt;
    while (!this.ready && remaining > EPSILON) {
      const boundary = this.timeToBoundary;
      const step = Math.min(remaining, boundary);
      if (this.airborne) {
        this.height +=
          this.verticalVelocity * step -
          0.5 * this.config.gravity * step * step;
        this.verticalVelocity -= this.config.gravity * step;
      }
      this.elapsed += step;
      remaining -= step;
      if (boundary - step > EPSILON) break;
      if (this.phase === "takeoff") {
        this.launch();
      } else if (this.airborne) {
        this.landingSpeed = Math.abs(this.verticalVelocity);
        this.height = 0;
        this.verticalVelocity = 0;
        this.elapsed = 0;
        this.phase = this.config.landingDuration > 0 ? "landing" : "grounded";
      } else {
        this.phase = "grounded";
        this.elapsed = 0;
      }
    }
    // Floating point error must never let the actor descend below the floor.
    this.height = Math.max(0, this.height);
  }
}
