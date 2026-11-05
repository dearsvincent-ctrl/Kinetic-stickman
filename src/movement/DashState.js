import { Vector3 } from "three";

export const DASH_CONFIG = Object.freeze({
  distance: 2.5,
  duration: 0.25,
  cooldown: 0.7,
  accelerationTime: 0.04,
  brakingTime: 0.07,
  steeringResponse: 18,
  maxTurnRate: 9,
  maxSubstep: 1 / 120,
});

/** A movement skill's timing/profile, independent of input, world and rendering. */
export class DashState {
  constructor(overrides = {}) {
    this.config = { ...DASH_CONFIG, ...overrides };
    for (const key of Object.keys(DASH_CONFIG)) {
      if (!Number.isFinite(this.config[key]) || this.config[key] < 0)
        this.config[key] = DASH_CONFIG[key];
    }
    this.config.duration = Math.max(0.001, this.config.duration);
    this.config.maxSubstep = Math.max(0.001, this.config.maxSubstep);
    const rampTime = this.config.accelerationTime + this.config.brakingTime;
    if (rampTime > this.config.duration) {
      this.config.accelerationTime *= this.config.duration / rampTime;
      this.config.brakingTime *= this.config.duration / rampTime;
    }
    this.active = false;
    this.elapsed = 0;
    this.cooldownRemaining = 0;
    this.direction = new Vector3(0, 0, -1);
    this.speed = 0;
    this.initialSpeed = 0;
    this.endSpeed = 0;
    this.peakSpeed = 0;
    this.sequence = 0;
    this.distanceTravelled = 0;
    this.exitReason = null;
  }

  get ready() {
    return !this.active && this.cooldownRemaining <= 1e-9;
  }

  get progress() {
    return Math.min(1, this.elapsed / this.config.duration);
  }

  start(direction, initialSpeed = 0, endSpeed = 0) {
    if (!this.ready) return false;
    this.direction.copy(direction).setY(0).normalize();
    if (this.direction.lengthSq() === 0) this.direction.set(0, 0, -1);
    this.initialSpeed = Math.max(0, initialSpeed);
    this.endSpeed = Math.max(0, endSpeed);
    const {
      distance,
      duration,
      accelerationTime: a,
      brakingTime: b,
    } = this.config;
    const endpointArea = (this.initialSpeed * a + this.endSpeed * b) / 2;
    if (endpointArea > distance) {
      // Very short custom dashes cannot preserve larger entry/exit speeds.
      this.initialSpeed *= distance / endpointArea;
      this.endSpeed *= distance / endpointArea;
    }
    // Integrating the two linear ramps gives exactly the configured distance.
    this.peakSpeed = Math.max(
      0,
      (distance - (this.initialSpeed * a + this.endSpeed * b) / 2) /
        (duration - (a + b) / 2),
    );
    this.active = true;
    this.elapsed = 0;
    this.speed = this.initialSpeed;
    this.cooldownRemaining = this.config.cooldown;
    this.distanceTravelled = 0;
    this.exitReason = null;
    this.sequence++;
    return true;
  }

  /** Cumulative analytic distance; avoids frame-rate-dependent Euler drift. */
  distanceAt(time) {
    const { duration, accelerationTime: a, brakingTime: b } = this.config;
    const t = Math.max(0, Math.min(duration, time));
    const up = Math.min(t, a);
    const cruise = Math.max(0, Math.min(t, duration - b) - a);
    const down = Math.max(0, t - (duration - b));
    return (
      this.initialSpeed * up +
      (a ? ((this.peakSpeed - this.initialSpeed) * up * up) / (2 * a) : 0) +
      this.peakSpeed * cruise +
      this.peakSpeed * down +
      (b ? ((this.endSpeed - this.peakSpeed) * down * down) / (2 * b) : 0)
    );
  }

  advance(dt, target) {
    if (target.lengthSq() > 0.0001) {
      const angle = Math.atan2(this.direction.x, this.direction.z);
      const delta = Math.atan2(target.x, target.z) - angle;
      const difference = Math.atan2(Math.sin(delta), Math.cos(delta));
      const limit = this.config.maxTurnRate * dt;
      const turn = Math.max(
        -limit,
        Math.min(
          limit,
          difference * (1 - Math.exp(-this.config.steeringResponse * dt)),
        ),
      );
      this.direction.set(Math.sin(angle + turn), 0, Math.cos(angle + turn));
    }
    const end = Math.min(this.config.duration, this.elapsed + dt);
    const distance = this.distanceAt(end) - this.distanceAt(this.elapsed);
    this.elapsed = end;
    const { duration, accelerationTime: a, brakingTime: b } = this.config;
    this.speed =
      a && end < a
        ? this.initialSpeed + ((this.peakSpeed - this.initialSpeed) * end) / a
        : b && end > duration - b
          ? this.peakSpeed +
            ((this.endSpeed - this.peakSpeed) * (end - duration + b)) / b
          : this.peakSpeed;
    return distance;
  }

  finish(reason) {
    this.active = false;
    this.speed = 0;
    this.exitReason = reason;
  }

  tickCooldown(dt) {
    this.cooldownRemaining = Math.max(0, this.cooldownRemaining - dt);
  }
}
