import { Quaternion, Vector3 } from "three";
import {
  sampleKickPose,
  techniqueStrikeStyle,
} from "../combat/TechniqueGeometry.js";
const UP = new Vector3(0, 1, 0);
/** Ground support/weight transfer only. Attack timing and input availability
 * stay owned by combat; incoming techniques retain the existing pose crossfade. */
export class GroundCombatBalance {
  constructor(character) {
    this.character = character;
    this.sequence = 0;
    this.weight = 0;
    this.anchor = new Vector3();
    this.plantStart = new Vector3();
    this.plantElapsed = 0;
    this.delta = new Vector3();
    this.side = "left";
    this.action = null;
    this.drive = 0;
    this.kickPose = {};
    this.supportYaw = new Quaternion();
    this.strikeStyle = "front";
  }
  plan(dt, combat, jump, speed, feet) {
    const floor = (jump?.floorHeight ?? 0) + 0.1;
    const a = combat?.attack,
      t = combat?.currentTechnique,
      ground =
        (!jump || jump.canActOnGround || jump.ready) &&
        a?.context?.environment !== "air";
    const active = ground && a?.active && !a.cancelled && !combat.blocking;
    this.weight += ((active ? 1 : 0) - this.weight) * (1 - Math.exp(-22 * dt));
    if (active && t?.action === "kick")
      sampleKickPose(this.kickPose, t, a.elapsed);
    this.drive +=
      ((active
        ? t?.action === "kick"
          ? this.kickPose.extension
          : a.extension
        : 0) -
        this.drive) *
      (1 - Math.exp(-24 * dt));
    if (active) {
      this.action = t?.action;
      this.strikeStyle = techniqueStrikeStyle(t);
    } else if (this.weight < 0.001) this.action = null;
    if (!active) return;
    if (a.sequence !== this.sequence) {
      this.sequence = a.sequence;
      this.side = t.side === "left" ? "right" : "left";
      if (t.action === "punch") {
        // A backhand/punch can retain the previous kick's supporting leg.
        // Never force a still-extended free leg straight down into a contact.
        if (feet.left.planted !== feet.right.planted)
          this.side = feet.left.planted ? "left" : "right";
        else {
          this.character.joints.leftAnkle.getWorldPosition(this.anchor);
          this.character.joints.rightAnkle.getWorldPosition(this.delta);
          this.side = this.anchor.y < this.delta.y ? "left" : "right";
        }
      }
      this.character.joints[`${this.side}Ankle`].getWorldPosition(
        this.plantStart,
      );
      this.plantStart.y = Math.max(floor, this.plantStart.y);
      this.anchor.copy(this.plantStart).setY(floor);
      this.delta.subVectors(this.anchor, this.character.root.position).setY(0);
      if (this.delta.length() > 0.42)
        this.anchor
          .copy(this.character.root.position)
          .add(this.delta.setLength(0.42))
          .setY(floor);
      this.plantElapsed = 0;
    }
    const support = feet[this.side];
    if (t.action === "kick" || ["cross", "hook"].includes(this.strikeStyle)) {
      const pivot =
        t.action === "punch"
          ? this.strikeStyle === "hook"
            ? 0.24
            : 0.16
          : this.strikeStyle === "front"
            ? 0.08
            : this.strikeStyle === "side"
              ? 0.7
              : 0.42;
      const turn = t.action === "kick" ? this.kickPose.turn * Math.PI * 2 : 0;
      this.supportYaw.setFromAxisAngle(
        UP,
        (t.side === "left" ? -1 : 1) * (pivot * this.drive + turn),
      );
      support.yaw
        .copy(this.character.root.quaternion)
        .multiply(this.supportYaw);
    }
    if (speed < 0.12) {
      // The guard may reposition the free foot, but a stationary strike retains
      // one real contact under its weight transfer, for either attack family.
      this.plantElapsed += dt;
      const p = Math.min(1, this.plantElapsed / 0.12);
      support.target.lerpVectors(
        this.plantStart,
        this.anchor,
        p * p * (3 - 2 * p),
      );
      support.anchor.copy(support.target);
      support.planted = support.target.y <= 0.101;
      return;
    }
    if (t.action !== "kick") return;
    const root = this.character.root,
      foot = feet[this.side];
    this.delta.subVectors(this.anchor, root.position).setY(0);
    if (this.delta.length() > 0.42)
      this.anchor
        .copy(root.position)
        .add(this.delta.setLength(0.42))
        .setY(floor);
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
