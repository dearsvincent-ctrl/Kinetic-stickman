import { Vector3 } from "three";
export const GESTURE_CONFIG = Object.freeze({
  strong: 0.9,
  centre: 0.28,
  groundPrime: 0.22,
  airPrime: 0.065,
  reversalWindow: 0.14,
  minGroundSpeed: 3.2,
  minAirTime: 0.27,
  groundCooldown: 0.8,
  airCooldown: 0.65,
  diagonalAngle: (130 * Math.PI) / 180,
  straightAngle: (168 * Math.PI) / 180,
});
/** Touch-stick gestures only. World velocity validates intent; reversal is
 * measured in stick coordinates so orbiting the camera cannot create a flick.
 * A fresh stable prime and centre crossing are required for each technique. */
export class JoystickGestures {
  constructor(config = {}) {
    this.config = { ...GESTURE_CONFIG, ...config };
    this.time = 0;
    this.cooldown = 0;
    this.sequence = 0;
    this.world = new Vector3();
    this.reset();
  }
  reset() {
    this.anchor = null;
    this.stable = 0;
    this.lastStrong = -Infinity;
    this.crossed = false;
    this.previous = { x: 0, y: 0 };
    this.wasAirborne = false;
    this.pointer = null;
  }
  update(dt, input, movement, cameraYaw) {
    if (!Number.isFinite(dt) || dt <= 0) return null;
    this.time += dt;
    this.cooldown = Math.max(0, this.cooldown - dt);
    const air = movement.jump.airborne,
      c = this.config;
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
    if (
      input.joystickPointer == null ||
      input.blocking ||
      movement.dash.active ||
      (!air && !movement.jump.ready)
    )
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
          const prime = air ? c.airPrime : c.groundPrime;
          const sin = Math.sin(cameraYaw),
            cos = Math.cos(cameraYaw);
          this.world.set(nx * cos - ny * sin, 0, -nx * sin - ny * cos);
          const velocity = movement.velocity,
            speed = velocity.length();
          const against = speed > 0.1 ? this.world.dot(velocity) / speed : 0;
          const forward =
            -this.world.x * Math.sin(movement.heading) -
            this.world.z * Math.cos(movement.heading);
          const airborneIntent =
            air &&
            forward < -0.82 &&
            movement.jump.height > 0.12 &&
            movement.jump.timeToBoundary >= c.minAirTime;
          const groundIntent =
            !air && speed >= c.minGroundSpeed && against < -0.55;
          if (
            this.cooldown === 0 &&
            this.stable >= prime &&
            this.crossed &&
            this.time - this.lastStrong <= c.reversalWindow &&
            angle >= c.diagonalAngle &&
            (airborneIntent || groundIntent)
          ) {
            const cross = this.anchor.x * ny - this.anchor.y * nx;
            const kind = air
              ? "backflip"
              : angle >= c.straightAngle
                ? "descending-sweep"
                : "whip-kick";
            result = {
              kind,
              direction: cross >= 0 ? 1 : -1,
              intensity: Math.max(
                0.25,
                Math.min(1, speed / Math.max(3.2, movement.sprintSpeed)),
              ),
              sequence: ++this.sequence,
            };
            this.cooldown = air ? c.airCooldown : c.groundCooldown;
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
        if (!air || forward > 0.8) {
          this.anchor = { x: nx, y: ny };
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
