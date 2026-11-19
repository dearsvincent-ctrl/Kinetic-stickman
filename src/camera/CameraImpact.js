import { Vector3 } from "three";

const MIN_DURATION = 0.05;
const MAX_DURATION = 0.65;
const MAX_STRENGTH = 2;
// At the default strength the entire displacement stays inside a 3.6 cm sphere.
export const CAMERA_IMPACT_TRANSLATION = 0.045;
const bounded = (value, fallback, min, max) =>
  Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;

/** A short analytic impulse, sampled from elapsed time rather than frame noise.
 * This channel never owns a follow target, orbit angle, lens, or body transform. */
export class CameraImpact {
  constructor(settings = {}) {
    this.enabled = true;
    this.strength = 0.8;
    this.duration = 0.22;
    this.offset = new Vector3();
    this.active = false;
    this.elapsed = 0;
    this.activeStrength = 0;
    this.activeDuration = this.duration;
    this.configure(settings);
  }

  configure(settings = {}) {
    if (typeof settings?.enabled === "boolean") this.enabled = settings.enabled;
    this.strength = bounded(settings?.strength, this.strength, 0, MAX_STRENGTH);
    this.duration = bounded(
      settings?.duration,
      this.duration,
      MIN_DURATION,
      MAX_DURATION,
    );
    if (!this.enabled || this.strength === 0) this.reset();
    return this;
  }

  trigger(strength = this.strength, duration = this.duration) {
    if (!this.enabled) return false;
    const nextStrength = bounded(strength, this.strength, 0, MAX_STRENGTH);
    if (nextStrength === 0) {
      this.reset();
      return false;
    }
    this.activeStrength = nextStrength;
    this.activeDuration = bounded(duration, this.duration, MIN_DURATION, MAX_DURATION);
    this.elapsed = 0;
    this.active = true;
    // Re-triggering replaces the impulse. Displacements can never stack.
    this.sample();
    return true;
  }

  sample() {
    const phase = this.elapsed;
    const envelope = 1 - phase / this.activeDuration;
    const amplitude =
      CAMERA_IMPACT_TRANSLATION * this.activeStrength * envelope ** 3;
    // The sum of squared axis weights is < 1, bounding the whole vector.
    this.offset.set(
      Math.cos(phase * 120) * 0.7 * amplitude,
      Math.cos(phase * 145 + 0.5) * 0.45 * amplitude,
      Math.sin(phase * 110 + 0.35) * 0.45 * amplitude,
    );
    return this.offset;
  }

  update(dt) {
    if (!this.active) return this.offset;
    dt = Number.isFinite(dt) ? Math.max(0, dt) : 0;
    this.elapsed += Math.min(dt, this.activeDuration);
    // The tolerance only removes floating point residue at the exact endpoint.
    if (this.elapsed >= this.activeDuration - 1e-10) {
      this.elapsed = this.activeDuration;
      this.active = false;
      this.activeStrength = 0;
      return this.offset.set(0, 0, 0);
    }
    return this.sample();
  }

  reset() {
    this.active = false;
    this.elapsed = 0;
    this.activeStrength = 0;
    this.offset.set(0, 0, 0);
    return this;
  }

  // Callers that sample every frame can supply and retain their own output.
  snapshot(out = {}) {
    out.enabled = this.enabled;
    out.strength = this.strength;
    out.duration = this.duration;
    out.active = this.active;
    out.elapsed = this.elapsed;
    out.remaining = this.active ? this.activeDuration - this.elapsed : 0;
    out.activeStrength = this.activeStrength;
    out.activeDuration = this.activeDuration;
    out.offsetX = this.offset.x;
    out.offsetY = this.offset.y;
    out.offsetZ = this.offset.z;
    return out;
  }
}
