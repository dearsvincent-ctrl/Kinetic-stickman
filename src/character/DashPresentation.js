import { Vector3 } from "three";

/** A sub-frame physical burst still gets one readable launch/recovery pose.
 * This object is only passed to animators; collision, cooldowns and abilities
 * always read the real DashState. Ordinary dash timing is unchanged.
 */
export class DashPresentation {
  constructor(minimumDuration = 0.09, maximumBoundDuration = 0.5) {
    this.minimumDuration = minimumDuration;
    this.maximumBoundDuration = maximumBoundDuration;
    this.launchDuration = 0.12;
    this.landingDuration = 0.15;
    this.pulse = false;
    this.cruising = false;
    this.sequence = -1;
    this.elapsed = 0;
    this.active = false;
    this.direction = new Vector3();
    this.config = { distance: 0, duration: minimumDuration };
  }
  sample(dt, dash) {
    if (!dash || dash.sequence === 0) return dash;
    if (dash.sequence !== this.sequence) {
      this.sequence = dash.sequence;
      this.elapsed = 0;
      this.pulse = dash.config.duration < this.minimumDuration;
      this.active = this.pulse;
      this.cruising = false;
      this.config.duration = this.minimumDuration;
      this.mode = dash.mode;
      this.config.distance = dash.config.distance;
    }
    if (dash.config.duration > this.maximumBoundDuration) {
      this.direction.copy(dash.direction);
      this.active = dash.active;
      this.elapsed = dash.elapsed;
      this.config.duration = dash.config.duration;
      this.config.distance = dash.config.distance;
      this.distanceTravelled = dash.distanceTravelled;
      this.exitReason = dash.exitReason;
      const remaining = Math.max(0, dash.config.duration - dash.elapsed);
      this.cruising =
        dash.active &&
        this.elapsed > this.launchDuration &&
        remaining > this.landingDuration;
      // Independent distance/speed sliders can produce a 250-second dash.
      // Keep launch/touchdown readable in real time and let locomotion own
      // the ground feet during cruise instead of holding a single bound.
      this.progress =
        this.elapsed <= this.launchDuration
          ? (0.24 * this.elapsed) / this.launchDuration
          : remaining <= this.landingDuration
            ? 0.76 + 0.24 * (1 - remaining / this.landingDuration)
            : 0.24 +
              (0.52 * (this.elapsed - this.launchDuration)) /
                (dash.config.duration -
                  this.launchDuration -
                  this.landingDuration);
      return this;
    }
    if (!this.pulse) return dash;
    this.direction.copy(dash.direction);
    this.elapsed = Math.min(this.minimumDuration, this.elapsed + dt);
    this.progress = this.elapsed / this.minimumDuration;
    this.distanceTravelled = this.config.distance * this.progress;
    this.exitReason = "completed";
    // Let the animator observe p=1 before handing off on the next sample.
    if (this.elapsed >= this.minimumDuration) this.active = this.pulse = false;
    return this;
  }
}
