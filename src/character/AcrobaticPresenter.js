import { Group, Quaternion, Vector3 } from "three";
import {
  BODY_PIVOT,
  sampleLocalStrike,
  sampleBicycleLeg,
  worldStrike,
  strikeFootOrientation,
  strikeKneePole,
} from "../combat/TechniqueGeometry.js";
import { ParkourPresenter } from "./ParkourPresenter.js";
import { ArmIK } from "./ArmIK.js";
import { PoseTransitions } from "./PoseTransitions.js";
import { punchAlignmentQuaternion } from "../combat/PunchAlignment.js";
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
    this.flipKneePole = new Vector3();
    this.strikePole = new Vector3();
    this.strikeFoot = new Quaternion();
    this.target = new Vector3();
    this.support = new Vector3();
    this.inverse = new Quaternion();
    this.body = new Quaternion();
    this.handIK = new ArmIK(character);
    this.parkour = new ParkourPresenter(character, animator);
    this.transitions = new PoseTransitions(character);
    this.flipWeight = 0;
    this.aimCorrection = new Quaternion();
    this.aimWorld = new Quaternion();
    this.aimParent = new Quaternion();
    this.aimInverse = new Quaternion();
    this.captureBody = new Quaternion();
    this.captureInverse = new Quaternion();
    this.flipStarts = [new Vector3(-0.15, 0.1, 0), new Vector3(0.15, 0.1, 0)];
    this.capturedFeet = [new Vector3(-0.15, 0.1, 0), new Vector3(0.15, 0.1, 0)];
    this.flipSequence = -1;
    this.tuck = 0;
  }
  begin(combat, movement) {
    this.pivot.getWorldQuaternion(this.captureBody);
    this.captureInverse.copy(this.captureBody).invert();
    for (let i = 0; i < SIDES.length; i++) {
      const foot = this.animator.footList[i];
      this.character.joints[`${SIDES[i]}Ankle`].getWorldPosition(
        foot.presented,
      );
      foot.presentedValid = true;
      this.capturedFeet[i]
        .copy(foot.presented)
        .sub(this.character.root.position);
      this.capturedFeet[i].y -= this.pivot.position.y;
      this.capturedFeet[i].applyQuaternion(this.captureInverse);
      this.capturedFeet[i].y += BODY_PIVOT;
      foot.presentedLocal.copy(this.capturedFeet[i]);
    }
    this.pivot.quaternion.identity();
    this.pivot.position.y = BODY_PIVOT;
    this.transitions.begin(combat, movement);
  }
  apply(dt, rotation, combat, movement) {
    const root = this.character.root,
      j = this.character.joints,
      attack = combat.attack,
      t = combat.currentTechnique;
    this.transitions.apply(dt, this.animator.footList);
    this.inverse.copy(root.quaternion).invert();
    this.body.copy(rotation.orientation);
    this.pivot.quaternion.copy(this.inverse).multiply(this.body).normalize();
    this.pivot.position.y = BODY_PIVOT + rotation.lift;
    // Re-solve support after pelvis crossfades and independent body rotation.
    // A visual transition cannot drag a physically planted ankle off the floor.
    for (const foot of this.animator.footList)
      if (foot.planted) {
        this.animator.ik.solve(foot.side, foot.target, foot.yaw, this.body);
        j[`${foot.side}Ankle`].rotateX(foot.pitch);
      }
    const spinning =
      rotation.phase === "spin" ||
      (rotation.phase === "recover" &&
        Math.abs(rotation.angularVelocity.y) > 2);
    this.flipWeight +=
      ((rotation.flipping ? 1 : 0) - this.flipWeight) *
      (1 - Math.exp(-18 * dt));
    if (rotation.flipping && rotation.sequence !== this.flipSequence) {
      this.flipSequence = rotation.sequence;
      for (let i = 0; i < 2; i++) this.flipStarts[i].copy(this.capturedFeet[i]);
    }
    const landing =
      movement?.jump?.airborne && movement.jump.verticalVelocity < 0
        ? Math.max(
            0,
            Math.min(
              1,
              (movement.jump.timeToLanding ?? movement.jump.timeToBoundary) /
                0.22,
            ),
          )
        : this.animator.jumpAnimation.phase === "landing"
          ? 0
          : 1;
    const inversion = Math.max(0, Math.min(1, (0.2 - rotation.up.y) / 1.2));
    const automatic = rotation.automatic;
    const authored =
      rotation.sequence > 0 && automatic && automatic.kind !== "none";
    const targetTuck =
      this.flipWeight *
      (authored ? automatic.tuck : 0.35 + 0.65 * inversion) *
      landing;
    this.tuck += (targetTuck - this.tuck) * (1 - Math.exp(-22 * dt));
    if (this.flipWeight > 0.001) {
      const sideways =
        rotation.lastKind === "leftflip" || rotation.lastKind === "rightflip";
      const sideDirection = rotation.lastKind === "leftflip" ? -1 : 1;
      const launch = authored ? automatic.launch : 0;
      const poseWeight = authored ? automatic.poseWeight : 1;
      if (!attack.active) {
        j.hips.position.y +=
          (launch * 0.018 - this.tuck * 0.025) * this.flipWeight;
        j.hips.rotateX(
          (-this.tuck * 0.07 +
            (rotation.lastKind === "backflip" ? 0.1 : -0.1) * launch) *
            this.flipWeight,
        );
        if (sideways) {
          j.hips.rotateZ(sideDirection * 0.11 * this.tuck);
          j.spine.rotateZ(-sideDirection * 0.07 * this.tuck);
        }
      }
      // Tuck around the existing pelvis. Base jump/attack poses remain the source;
      // local knee targets are controlled rather than a baked flip timeline.
      for (let i = 0; i < SIDES.length; i++) {
        const side = SIDES[i];
        if (
          attack.active &&
          t.action === "kick" &&
          (t.side === side || t.animation === "bicycle-kick")
        )
          continue;
        if (
          movement?.jump?.canActOnGround &&
          this.animator.footList[i].planted &&
          !rotation.flipping
        )
          continue;
        const lead = this.animator.jumpAnimation.lead;
        const sideLead = sideDirection < 0 ? 0 : 1;
        const tuckHeight = sideways
          ? i === sideLead
            ? 1.08
            : 0.98
          : i === lead
            ? 1.1
            : 1.02;
        const tuckForward = sideways
          ? i === 0
            ? 0.23
            : 0.14
          : rotation.lastKind === "frontflip"
            ? 0.18
            : 0.25;
        this.local.set(
          (i === 0 ? -0.16 : 0.16) +
            (sideways ? sideDirection * 0.075 * this.tuck : 0),
          0.1 + this.tuck * tuckHeight - 0.012 * launch,
          tuckForward * this.tuck,
        );
        const entry = Math.min(1, rotation.elapsed / 0.1);
        this.local.lerpVectors(
          this.flipStarts[i],
          this.local,
          entry * entry * (3 - 2 * entry),
        );
        worldStrike(
          this.target,
          this.local,
          root.position,
          this.body,
          rotation.lift,
        );
        const footEntry = this.animator.footList[i];
        j[`${side}Ankle`].getWorldPosition(this.support);
        // A new strike must start from the rendered support foot, with a
        // continuous handoff to the base pose as its crossfade completes.
        if (this.transitions.blend < 1 && footEntry.presentedValid)
          this.support.lerpVectors(
            footEntry.presented,
            this.support,
            this.transitions.blend,
          );
        this.target.lerpVectors(
          this.support,
          this.target,
          entry *
            entry *
            (3 - 2 * entry) *
            this.flipWeight *
            this.transitions.blend,
        );
        // Upward/outward knee bias avoids a pole singularity as ankles fold
        // behind the pelvis. Both knees draw toward the chest, rather than
        // merely bending below the hips in an inverted straight-leg silhouette.
        this.animator.ik.solve(
          side,
          this.target,
          this.body,
          this.body,
          this.flipPole(side),
        );
      }
      j.spine.rotateX(-(attack.active ? 0.04 : 0.14) * this.tuck);
      j.head.rotateX(-0.08 * this.tuck);
      if (!combat.blocking)
        for (const side of SIDES) {
          if (attack.active && t?.action === "punch" && t.side === side)
            continue;
          const shoulder = j[`${side}Shoulder`],
            elbow = j[`${side}Elbow`];
          const armBlend =
            this.flipWeight *
            poseWeight *
            (attack.active ? 0.45 : 1) *
            this.transitions.blend;
          const leadArm = side === (sideDirection < 0 ? "left" : "right");
          const swing = sideways
            ? leadArm
              ? 1.9
              : 0.8
            : rotation.lastKind === "backflip"
              ? -2.1
              : 1.9;
          shoulder.rotation.x +=
            (swing * launch + 0.85 * this.tuck - shoulder.rotation.x) *
            armBlend;
          const spread =
            (side === "left" ? -1 : 1) *
            (0.18 + 0.35 * launch + (sideways ? 0.12 : 0));
          shoulder.rotation.z += (spread - shoulder.rotation.z) * armBlend;
          elbow.rotation.x +=
            (0.35 * launch + 1.7 * this.tuck - elbow.rotation.x) * armBlend;
        }
    }
    this.parkour.apply(dt, movement?.parkour, this.body, combat);
    if (!attack.active || !t?.adaptive || attack.cancelled) return;
    if (t.action === "punch" && attack.context?.punchAim) {
      punchAlignmentQuaternion(
        this.aimCorrection,
        t,
        attack.elapsed,
        attack.context.punchAim,
        attack.cancelled ? Math.max(0, 1 - attack.phaseProgress) : 1,
      );
      // Convert the body-frame twist into the animated spine parent's frame.
      // The independent acrobatic quaternion and locomotion root are read only.
      this.aimInverse.copy(this.body).invert();
      this.aimWorld
        .copy(this.body)
        .multiply(this.aimCorrection)
        .multiply(this.aimInverse);
      j.spine.parent.getWorldQuaternion(this.aimParent);
      this.aimInverse.copy(this.aimParent).invert();
      this.aimCorrection
        .copy(this.aimInverse)
        .multiply(this.aimWorld)
        .multiply(this.aimParent);
      j.spine.quaternion.premultiply(this.aimCorrection).normalize();
      j.spine.updateWorldMatrix(false, true);
    }
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
    const activeContact =
      attack.elapsed >= t.windup &&
      attack.elapsed <= t.windup + t.extension + t.impact;
    const recovery = activeContact
      ? 1
      : (attack.phase === "recovery"
          ? Math.max(0, 1 - attack.phaseProgress)
          : 1) *
        (attack.context?.limbs?.[side]?.[t.action === "kick" ? "foot" : "hand"]
          ? 1
          : this.transitions.blend);
    if (t.action === "kick") {
      const ankle = j[`${side}Ankle`];
      ankle.getWorldPosition(this.support);
      this.target.lerpVectors(this.support, this.target, recovery);
      this.animator.ik.solve(
        side,
        this.target,
        strikeFootOrientation(this.strikeFoot, t, attack.elapsed, this.body),
        this.body,
        this.flipWeight > 0.001
          ? this.flipPole(side)
          : strikeKneePole(this.strikePole, t, attack.elapsed),
      );
      if (t.animation === "bicycle-kick") {
        sampleBicycleLeg(this.local, t, attack.elapsed, opposite, attack.context);
        worldStrike(
          this.target,
          this.local,
          root.position,
          this.body,
          rotation.lift,
        );
        j[`${opposite}Ankle`].getWorldPosition(this.support);
        this.target.lerpVectors(this.support, this.target, recovery);
        // The counter-pedaling leg follows the same independent body frame as
        // the contact leg, including a sideways or inverted airborne body.
        this.animator.ik.solve(
          opposite,
          this.target,
          this.body,
          this.body,
          this.strikePole.set(opposite === "left" ? -0.2 : 0.2, 0.9, -1),
        );
      }
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
  reset() {
    this.parkour.reset();
    this.flipWeight = this.tuck = 0;
    this.flipSequence = -1;
    this.pivot.quaternion.identity();
    this.pivot.position.y = BODY_PIVOT;
    this.transitions.elapsed = 1;
    this.transitions.attackActive = false;
    this.transitions.movementSequence.phase = null;
    for (const foot of this.animator.footList) foot.presentedValid = false;
  }
  flipPole(side) {
    return this.flipKneePole.set(
      (side === "left" ? -1 : 1) * 0.45 * this.tuck,
      0.8 * this.tuck,
      -1,
    );
  }
  fillLimbContext(context, rotation) {
    const j = this.character.joints;
    const root = this.character.root;
    this.inverse.copy(rotation?.orientation ?? root.quaternion).invert();
    for (const side of SIDES) {
      const limb = context.limbs[side];
      limb.elbow = Math.abs(j[`${side}Elbow`].rotation.x);
      const knee = j[`${side}Knee`];
      // A compact fold can bend in both local X/Z. Keep ordinary selection
      // unchanged, but report the geometric bend while the flip layer owns it.
      limb.legExtension =
        this.flipWeight > 0.001
          ? Math.max(
              0,
              1 - 2 * (knee.quaternion.x ** 2 + knee.quaternion.z ** 2),
            )
          : Math.max(0, Math.cos(knee.rotation.x));
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
