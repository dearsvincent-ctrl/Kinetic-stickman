import { Quaternion, Vector3 } from "three";
const UP = new Vector3(0, 1, 0),
  TAU = Math.PI * 2;
const clamp = (n) => Math.max(0, Math.min(1, n));
const smooth = (n) => {
  const p = clamp(n);
  return p * p * (3 - 2 * p);
};
const ease = (n) => n * n * n * (10 + n * (-15 + 6 * n));
export const FLIP_KINDS = Object.freeze([
  "frontflip",
  "backflip",
  "leftflip",
  "rightflip",
]);
export const AUTOMATIC_FLIP_CONFIG = Object.freeze({
  flipDuration: 0.62,
  minFlipDuration: 0.36,
  flightFraction: 0.82,
});

/** One authored angular path. No joystick, gravity, travel or attack ownership.
 * The winding angle is explicit, rather than interpolating equivalent 0/360°
 * quaternions. Pose envelopes share this same clock at every frame rate. */
export class AutomaticFlip {
  constructor(config) {
    this.config = config;
    this.entry = new Quaternion();
    this.basis = new Quaternion();
    this.base = new Quaternion();
    this.turn = new Quaternion();
    this.axis = new Vector3();
    this.reset();
  }
  reset() {
    this.active = false;
    this.progress = 0;
    this.angle = 0;
    this.elapsed = 0;
    this.duration = this.config.flipDuration;
    this.stage = "idle";
    this.tuck = 0;
    this.launch = 0;
    this.poseWeight = 0;
    this.kind = "none";
    this.reason = null;
  }
  start(kind, orientation, yaw, airTime = Infinity) {
    if (!FLIP_KINDS.includes(kind))
      throw new RangeError("Unknown automatic flip");
    this.reset();
    this.kind = kind;
    this.active = true;
    this.stage = "launch";
    this.entry.copy(orientation);
    this.basis.setFromAxisAngle(UP, yaw);
    const roll = kind === "leftflip" || kind === "rightflip";
    this.axis.set(roll ? 0 : 1, 0, roll ? 1 : 0);
    this.sign = kind === "frontflip" || kind === "rightflip" ? -1 : 1;
    // Quintic easing has a maximum slope of 1.875. Account for residual body
    // tilt as well as one turn. Very short flights use early-contact recovery.
    const minimum =
      ((TAU + this.entry.angleTo(this.basis)) * 1.875) /
      this.config.maxAngularSpeed;
    this.duration = Math.min(
      1.5,
      Math.max(
        this.config.minFlipDuration,
        minimum,
        Math.min(
          this.config.flipDuration,
          Math.max(0, airTime) * this.config.flightFraction,
        ),
      ),
    );
    this.launch = 1;
  }
  stop(reason) {
    this.active = false;
    this.reason = reason;
    this.stage = "recovery";
    this.tuck = this.launch = this.poseWeight = 0;
  }
  advance(dt, out) {
    if (!this.active || !Number.isFinite(dt) || dt <= 0) return false;
    this.elapsed = Math.min(this.duration, this.elapsed + dt);
    const u = (this.progress = clamp(this.elapsed / this.duration));
    this.angle = TAU * ease(u);
    this.base.slerpQuaternions(this.entry, this.basis, smooth(u));
    this.turn.setFromAxisAngle(this.axis, this.sign * this.angle);
    out.copy(this.base).multiply(this.turn).normalize();
    this.launch = 1 - smooth(u / 0.17);
    this.tuck = smooth((u - 0.1) / 0.23) * (1 - smooth((u - 0.62) / 0.25));
    this.poseWeight = smooth(u / 0.12) * (1 - smooth((u - 0.8) / 0.2));
    this.stage =
      u < 0.13
        ? "launch"
        : u < 0.25
          ? "initiation"
          : u < 0.39
            ? "tuck"
            : u < 0.65
              ? "rotation"
              : u < 0.87
                ? "extension"
                : "recovery";
    if (u === 1) {
      this.stop("complete");
      return true;
    }
    return false;
  }
}
