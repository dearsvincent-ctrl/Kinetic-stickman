export const GESTURE_CONFIG = Object.freeze({
  strong: 0.9,
  centre: 0.28,
  airPrime: 0.065,
  reversalWindow: 0.14,
  minAirTime: 0.27,
  airCooldown: 0.65,
  diagonalAngle: (130 * Math.PI) / 180,
});
/** Airborne touch-stick gestures only. A deliberate reversal is
 * measured in stick coordinates so orbiting the camera cannot create a flick.
 * A fresh airborne prime and centre crossing are required for a backflip.
 * Ground input never requests attacks; MomentumRecovery observes braking. */
export class JoystickGestures {
  constructor(config = {}) {
    this.config = { ...GESTURE_CONFIG, ...config };
    this.time = 0;
    this.cooldown = 0;
    this.sequence = 0;
    this.reset();
  }
  reset() {
    this.anchor = null;
    this.stable = 0;
    this.lastStrong = -Infinity;
    this.crossed = false;
    this.previous ??= { x: 0, y: 0 };
    this.previous.x = this.previous.y = 0;
    this.wasAirborne = false;
    this.pointer = null;
  }
  update(dt, input, movement, cameraYaw) {
    if (!Number.isFinite(dt) || dt <= 0) return null;
    this.time += dt;
    this.cooldown = Math.max(0, this.cooldown - dt);
    const air = movement.jump.airborne,
      c = this.config;
    if (!air) {
      if (this.wasAirborne || this.anchor) this.reset();
      return null;
    }
    if (
      input.joystickPointer == null ||
      input.blocking ||
      movement.dash.active ||
      air !== this.wasAirborne ||
      this.pointer !== input.joystickPointer
    ) {
      this.reset();
      this.wasAirborne = air;
      this.pointer = input.joystickPointer;
    }
    if (input.joystickPointer == null || input.blocking || movement.dash.active)
      return null;
    const x = input.move.x,
      y = input.move.y,
      m = Math.hypot(x, y),
      p = this.previous;
    const dx = x - p.x,
      dy = y - p.y,
      l = dx * dx + dy * dy;
    const t = l > 0 ? Math.max(0, Math.min(1, -(p.x * dx + p.y * dy) / l)) : 0;
    if (
      m < c.centre ||
      (l > 1 && Math.hypot(p.x + dx * t, p.y + dy * t) < c.centre)
    )
      this.crossed = true;
    let result = null;
    if (m >= c.strong) {
      const nx = x / m,
        ny = y / m;
      if (this.anchor) {
        const dot = Math.max(
            -1,
            Math.min(1, nx * this.anchor.x + ny * this.anchor.y),
          ),
          angle = Math.acos(dot);
        if (angle > 0.3) {
          const prime = c.airPrime;
          // Compare to the primed stick direction, never the current heading:
          // steering can already have rotated the fighter during a valid flick.
          const airborneIntent =
            air &&
            dot < -0.82 &&
            movement.jump.height > 0.12 &&
            movement.jump.timeToBoundary >= c.minAirTime;
          if (
            this.cooldown === 0 &&
            this.stable >= prime &&
            this.crossed &&
            this.time - this.lastStrong <= c.reversalWindow &&
            angle >= c.diagonalAngle &&
            airborneIntent
          ) {
            const cross = this.anchor.x * ny - this.anchor.y * nx;
            const kind = "backflip";
            result = {
              kind,
              referenceYaw: this.anchor.heading,
              direction: cross >= 0 ? 1 : -1,
              intensity: Math.max(
                0.25,
                Math.min(
                  1,
                  movement.speed / Math.max(3.2, movement.sprintSpeed),
                ),
              ),
              sequence: ++this.sequence,
            };
            this.cooldown = c.airCooldown;
          }
          this.anchor = null;
          this.stable = 0;
          this.crossed = false;
        }
      }
      if (!this.anchor) {
        // Air flips must be primed forwards, then flicked backwards. A single
        // backwards steering input from centre is never enough to initiate a flip.
        const forward =
          nx * Math.sin(cameraYaw - movement.heading) +
          ny * Math.cos(cameraYaw - movement.heading);
        if (forward > 0.8) {
          this.anchor = {
            x: nx,
            y: ny,
            heading: cameraYaw - Math.atan2(nx, ny),
          };
          this.stable = dt;
          this.crossed = false;
        }
      } else this.stable += dt;
      this.lastStrong = this.time;
    } else if (this.time - this.lastStrong > c.reversalWindow) {
      this.anchor = null;
      this.stable = 0;
      this.crossed = false;
    }
    p.x = x;
    p.y = y;
    return result;
  }
}
