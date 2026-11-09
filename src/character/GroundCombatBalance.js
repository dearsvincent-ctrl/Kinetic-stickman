import { Vector3 } from "three";
/** Ground support/weight transfer only. Attack timing and input availability
 * stay owned by combat; incoming techniques retain the existing pose crossfade. */
export class GroundCombatBalance {
  constructor(character) {
    this.character = character;
    this.sequence = 0;
    this.weight = 0;
    this.anchor = new Vector3();
    this.delta = new Vector3();
    this.side = "left";
    this.action = null;
    this.drive = 0;
  }
  plan(dt, combat, jump, speed, feet) {
    const a = combat?.attack,
      t = combat?.currentTechnique,
      ground = (!jump || jump.ready) && a?.context?.environment !== "air";
    const active = ground && a?.active && !a.cancelled && !combat.blocking;
    this.weight += ((active ? 1 : 0) - this.weight) * (1 - Math.exp(-22 * dt));
    this.drive +=
      ((active ? a.extension : 0) - this.drive) * (1 - Math.exp(-24 * dt));
    if (active) this.action = t?.action;
    else if (this.weight < 0.001) this.action = null;
    if (!active) return;
    if (a.sequence !== this.sequence) {
      this.sequence = a.sequence;
      this.side = t.side === "left" ? "right" : "left";
      this.character.joints[`${this.side}Ankle`].getWorldPosition(this.anchor);
      this.anchor.y = 0.1;
    }
    if (t.action !== "kick") return;
    const root = this.character.root,
      foot = feet[this.side];
    this.delta.subVectors(this.anchor, root.position).setY(0);
    if (this.delta.length() > 0.42)
      this.anchor.copy(root.position).add(this.delta.setLength(0.42)).setY(0.1);
    // A stationary kick has a firm support. A running kick keeps a yielding
    // moving contact instead of pinning a foot while the body travels away.
    const stationary = 1 - Math.min(1, speed / 3.5),
      blend = this.weight * (0.25 + 0.7 * stationary);
    foot.target.lerp(this.anchor, blend);
    foot.yaw.slerp(root.quaternion, 0.18 * blend);
  }
  apply(pose, speed) {
    if (!this.action || this.weight < 0.001) return;
    const sign = this.side === "left" ? -1 : 1,
      w = this.weight * (1 - Math.min(1, speed / 5.2)),
      drive = this.drive;
    pose.hipX += sign * (this.action === "kick" ? 0.065 : 0.022) * drive * w;
    pose.hipY -= 0.018 * drive * w;
    pose.hipRoll += -sign * 0.035 * drive * w;
    pose.spineRoll += sign * 0.035 * drive * w;
    if (this.action === "kick") pose.spineYaw -= sign * 0.055 * drive * w;
  }
}
