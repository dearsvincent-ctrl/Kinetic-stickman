import { Group, Quaternion, Vector3 } from "three";
import {
  BODY_PIVOT,
  sampleLocalStrike,
  worldStrike,
} from "../combat/TechniqueGeometry.js";
import { ArmIK } from "./ArmIK.js";
import { PoseTransitions } from "./PoseTransitions.js";
const SIDES = ["left", "right"];
const ENDPOINTS = [
  ["hand", "Hand"],
  ["foot", "Ankle"],
];
/** A body-only pivot leaves travel yaw/position and camera tracking untouched.
 * The ordinary rig/IK planner runs upright; final limb targets use the same
 * quaternion strike geometry as contact sensing, including inverted kicks. */
export class AcrobaticPresenter {
  constructor(character, animator) {
    this.character = character;
    this.animator = animator;
    this.pivot = new Group();
    this.pivot.name = "acroBodyFrame";
    this.pivot.position.y = BODY_PIVOT;
    this.inner = new Group();
    this.inner.position.y = -BODY_PIVOT;
    this.pivot.add(this.inner);
    character.root.add(this.pivot);
    this.inner.add(character.joints.hips);
    this.local = new Vector3();
    this.target = new Vector3();
    this.support = new Vector3();
    this.inverse = new Quaternion();
    this.body = new Quaternion();
    this.handIK = new ArmIK(character);
    this.transitions = new PoseTransitions(character);
    this.flipWeight = 0;
  }
  begin(combat) {
    this.pivot.quaternion.identity();
    this.pivot.position.y = BODY_PIVOT;
    this.transitions.begin(combat);
  }
  apply(dt, rotation, combat) {
    const root = this.character.root,
      j = this.character.joints,
      attack = combat.attack,
      t = combat.currentTechnique;
    this.transitions.apply(dt);
    this.inverse.copy(root.quaternion).invert();
    this.body.copy(rotation.orientation);
    this.pivot.quaternion.copy(this.inverse).multiply(this.body).normalize();
    this.pivot.position.y = BODY_PIVOT + rotation.lift;
    const spinning =
      rotation.phase === "spin" ||
      (rotation.phase === "recover" &&
        Math.abs(rotation.angularVelocity.y) > 2);
    this.flipWeight +=
      ((rotation.flipping ? 1 : 0) - this.flipWeight) *
      (1 - Math.exp(-18 * dt));
    if (this.flipWeight > 0.001) {
      // Tuck around the existing pelvis. Base jump/attack poses remain the source;
      // local knee targets are controlled rather than a baked flip timeline.
      for (let i = 0; i < SIDES.length; i++) {
        const side = SIDES[i];
        if (attack.active && t.action === "kick" && t.side === side) continue;
        this.local.set(i === 0 ? -0.15 : 0.15, BODY_PIVOT - 0.52, 0.13);
        worldStrike(
          this.target,
          this.local,
          root.position,
          this.body,
          rotation.lift,
        );
        j[`${side}Ankle`].getWorldPosition(this.support);
        const entry = Math.min(1, rotation.elapsed / 0.12);
        this.target.lerpVectors(
          this.support,
          this.target,
          entry * entry * (3 - 2 * entry) * this.flipWeight,
        );
        this.animator.ik.solve(side, this.target, this.body, this.body);
      }
    }
    if (!attack.active || !t?.adaptive) return;
    const side = t.side,
      opposite = side === "left" ? "right" : "left";
    sampleLocalStrike(this.local, t, attack.elapsed, attack.context);
    worldStrike(
      this.target,
      this.local,
      root.position,
      this.body,
      rotation.lift,
    );
    const recovery =
      (attack.phase === "recovery"
        ? Math.max(0, 1 - attack.phaseProgress)
        : 1) *
      (attack.context?.limbs?.[side]?.[t.action === "kick" ? "foot" : "hand"]
        ? 1
        : this.transitions.blend);
    if (t.action === "kick") {
      const ankle = j[`${side}Ankle`];
      ankle.getWorldPosition(this.support);
      this.target.lerpVectors(this.support, this.target, recovery);
      this.animator.ik.solve(side, this.target, this.body, this.body);
      if (
        (spinning || t.gesture) &&
        root.position.y <= 0.001 &&
        attack.context?.environment !== "air" &&
        !rotation.flipping
      ) {
        // The supporting leg stays under the pelvis as yaw sweeps over it. Running
        // can continue; its contact is repositioned with the resolved physical root.
        this.support
          .set(side === "left" ? 0.16 : -0.16, 0.1, 0.08)
          .applyQuaternion(root.quaternion)
          .add(root.position);
        this.animator.ik.solve(
          opposite,
          this.support,
          root.quaternion,
          this.body,
        );
      }
    } else {
      j[`${side}Hand`].getWorldPosition(this.support);
      this.target.lerpVectors(this.support, this.target, recovery);
      this.handIK.solve(side, this.target, this.body);
    }
  }
  fillLimbContext(context, rotation) {
    const j = this.character.joints;
    const root = this.character.root;
    this.inverse.copy(rotation?.orientation ?? root.quaternion).invert();
    for (const side of SIDES) {
      const limb = context.limbs[side];
      limb.elbow = Math.abs(j[`${side}Elbow`].rotation.x);
      limb.legExtension = Math.max(0, Math.cos(j[`${side}Knee`].rotation.x));
      limb.planted = this.animator.feet[side].planted;
      // Captured only for an input/repeat opportunity. Shared local entry
      // positions keep contact sweeps on the same path as the visual transition.
      for (const [kind, name] of ENDPOINTS) {
        j[`${side}${name}`].getWorldPosition(this.local);
        this.local.sub(root.position);
        this.local.y -= BODY_PIVOT + (rotation?.lift ?? 0);
        this.local.applyQuaternion(this.inverse);
        this.local.y += BODY_PIVOT;
        limb[kind] ??= [0, 0, 0];
        this.local.toArray(limb[kind]);
      }
    }
  }
}
