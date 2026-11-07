import { MathUtils } from "three";

/** Low-clearance walking with heel contact, flat support and toe release.
 * This only rolls the visual foot; world contact anchors and root motion stay
 * owned by their existing planners. Running has its own recovery trajectory.
 */
export class WalkingGait {
  constructor(style) {
    this.style = style;
  }

  applyFoot(foot, phase, duty, runWeight, guardWeight) {
    const s = this.style,
      weight = (1 - runWeight) * (1 - guardWeight);
    let pitch;
    if (foot.planted) {
      const support = MathUtils.clamp(phase / Math.max(0.01, duty), 0, 1);
      pitch =
        support < 0.22
          ? s.walkHeelAngle * (1 - MathUtils.smoothstep(support, 0, 0.22))
          : -s.walkToeAngle * MathUtils.smoothstep(support, 0.74, 1);
    } else {
      const swing = MathUtils.clamp(
        (phase - duty) / Math.max(0.01, 1 - duty),
        0,
        1,
      );
      pitch = MathUtils.lerp(
        -s.walkToeAngle,
        s.walkHeelAngle,
        MathUtils.smoothstep(swing, 0.1, 0.85),
      );
    }
    foot.pitch = pitch * weight;
    // Raise the ankle around the heel/toe contact so the rotated sole stays
    // above the floor. The world-space XZ contact never moves for this roll.
    const reach = foot.pitch > 0 ? 0.075 : 0.185;
    foot.target.y += Math.max(
      0,
      0.09 * Math.cos(foot.pitch) +
        reach * Math.abs(Math.sin(foot.pitch)) -
        0.09,
    );
  }
}
