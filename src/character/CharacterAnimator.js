import { MathUtils, Quaternion, Vector3 } from "three";
import { LocomotionAnimator } from "./LocomotionAnimator.js";
import { CombatStanceAnimator } from "./CombatStanceAnimator.js";
import { LegIK } from "./LegIK.js";
import { DashAnimator } from "./DashAnimator.js";
import { AttackAnimator } from "./AttackAnimator.js";

const TAU = Math.PI * 2;
const fract = (value) => value - Math.floor(value);
const smooth = (value) => value * value * (3 - 2 * value);

function createFoot(side, offset, sign) {
  return {
    side,
    offset,
    sign,
    planted: true,
    target: new Vector3(),
    anchor: new Vector3(),
    swingStart: new Vector3(),
    yaw: new Quaternion(),
    swingYaw: new Quaternion(),
    lastPhase: offset,
    startPhase: 0,
    duty: 0.66,
  };
}

/** Composes gait, automatic guard and punch, then resolves planted feet through the existing
 * hierarchy. Animation owns child transforms only; never root movement/yaw.
 */
export class CharacterAnimator {
  constructor(character) {
    this.character = character;
    this.locomotion = new LocomotionAnimator();
    this.combat = new CombatStanceAnimator();
    this.dashAnimation = new DashAnimator(character);
    this.attackAnimation = new AttackAnimator();
    this.attackWeight = 0;
    this.dashWeight = 0;
    this.ik = new LegIK(character);
    this.combatWeight = 0;
    this.feet = {
      left: createFoot("left", 0, -1),
      right: createFoot("right", 0.5, 1),
    };
    this.footList = [this.feet.left, this.feet.right];
    this.pose = { arms: [{}, {}] };
    this.previousPosition = character.root.position.clone();
    this.velocity = new Vector3();
    this.rootYaw = new Quaternion();
    this.landing = new Vector3();
    this.rest = new Vector3();
    this.hipWorld = new Vector3();
    this.gaitOffset = 0;
    this.wasMoving = false;
    this.initialized = false;
  }

  update(dt, { speed = 0, blocking = false, combat, dash } = {}) {
    if (dt <= 0) return;
    const root = this.character.root;
    const j = this.character.joints;
    const gait = this.locomotion;
    this.combatWeight = this.combat.update(
      dt,
      Boolean(blocking || combat?.postureActive),
    );
    this.attackWeight = this.attackAnimation.update(dt, combat);
    // The dash has its own single bound, not a 12 m/s running cycle.
    gait.update(dt, {
      speed: dash?.active ? Math.min(speed, 2.6) : speed,
      combatWeight: this.combatWeight,
    });
    const moving = speed >= 0.015;
    const distance = root.position.distanceTo(this.previousPosition);
    this.velocity
      .subVectors(root.position, this.previousPosition)
      .multiplyScalar(1 / dt);
    this.previousPosition.copy(root.position);
    this.rootYaw.copy(root.quaternion);
    const dashOwnsFeet = Boolean(dash?.active) || this.dashAnimation.ownsFeet;

    // Mid-contact start avoids an overlong first planted step. Guard changes
    // during travel never reset phase or switch an existing contact early.
    if (moving && !this.wasMoving) {
      this.gaitOffset = gait.duty * 0.5 - fract(gait.phase);
      for (const foot of this.footList) {
        foot.lastPhase = fract(gait.phase + this.gaitOffset + foot.offset);
        foot.duty = gait.duty;
      }
    }
    for (const foot of this.footList) {
      this.restPosition(foot, this.rest);
      if (!this.initialized || distance > 1.5) {
        foot.target.copy(this.rest);
        foot.anchor.copy(this.rest);
        foot.yaw.copy(this.rootYaw);
        foot.planted = true;
      }
      if (dashOwnsFeet) continue;
      if (!moving) {
        foot.target.lerp(this.rest, 1 - Math.exp(-12 * dt));
        foot.yaw.slerp(this.rootYaw, 1 - Math.exp(-12 * dt));
        foot.anchor.copy(foot.target);
        foot.planted = foot.target.distanceToSquared(this.rest) < 0.00001;
      } else {
        this.updateFoot(foot);
      }
    }
    this.initialized = true;
    this.wasMoving = moving;
    this.dashAnimation.update(dt, dash, this.footList, this.combatWeight);
    this.dashWeight = this.dashAnimation.weight;
    if (dashOwnsFeet) {
      // Resume the ordinary planner from the physical landing, without a
      // stale pre-dash world anchor or a phase-wrap contact reset.
      for (const foot of this.footList) {
        foot.lastPhase = fract(gait.phase + this.gaitOffset + foot.offset);
        foot.duty = gait.duty;
        foot.swingStart.copy(foot.target);
        foot.swingYaw.copy(foot.yaw);
        foot.startPhase = foot.lastPhase;
      }
    }

    gait.sampleUpperBody(this.pose);
    const wave = Math.cos((gait.phase + this.gaitOffset) * TAU);
    const amplitude =
      MathUtils.lerp(0.23, 0.43, gait.runBlend) * gait.movementBlend;
    this.pose.arms[0].x = -wave * amplitude;
    this.pose.arms[1].x = wave * amplitude;
    this.combat.apply(this.pose, gait.movementBlend);
    this.dashAnimation.apply(this.pose, this.combatWeight);
    this.attackAnimation.apply(this.pose);
    const pose = this.pose;
    j.hips.position.set(pose.hipX, pose.hipY, 0);
    j.hips.rotation.set(0, pose.hipYaw, pose.hipRoll);
    j.spine.rotation.set(
      pose.spinePitch,
      pose.spineYaw,
      this.dashAnimation.spineRoll,
    );
    j.head.rotation.set(pose.headPitch, -pose.spineYaw * 0.65, 0);
    for (let index = 0; index < 2; index++) {
      const side = index === 0 ? "left" : "right";
      const arm = pose.arms[index];
      j[`${side}Shoulder`].rotation.set(arm.x, arm.y, arm.z);
      j[`${side}Elbow`].rotation.set(arm.elbow, 0, 0);
    }

    // Pelvis height follows the support legs instead of stretching a locked
    // ankle upward: down through double support, up through mid-step.
    let lowerBy = 0;
    for (const foot of this.footList) {
      if (!foot.planted) continue;
      j[`${foot.side}Hip`].getWorldPosition(this.hipWorld);
      const dx = this.hipWorld.x - foot.target.x;
      const dz = this.hipWorld.z - foot.target.z;
      const safeReach = 0.858;
      const maximumY =
        foot.target.y +
        Math.sqrt(Math.max(0.01, safeReach * safeReach - dx * dx - dz * dz));
      lowerBy = Math.max(lowerBy, this.hipWorld.y - maximumY);
    }
    j.hips.position.y = Math.max(0.68, j.hips.position.y - lowerBy);
    for (const foot of this.footList)
      this.ik.solve(foot.side, foot.target, foot.yaw);
  }

  restPosition(foot, out) {
    const width = MathUtils.lerp(0.15, 0.18, this.combatWeight);
    const stagger = (foot.side === "left" ? -0.13 : 0.13) * this.combatWeight;
    return out
      .set(foot.sign * width, this.character.dimensions.ankleHeight, stagger)
      .applyQuaternion(this.rootYaw)
      .add(this.character.root.position);
  }

  updateFoot(foot) {
    const gait = this.locomotion;
    const phase = fract(gait.phase + this.gaitOffset + foot.offset);
    if (phase < foot.lastPhase) {
      foot.planted = true;
      foot.duty = gait.duty;
      foot.anchor.copy(foot.target);
      foot.anchor.y = this.character.dimensions.ankleHeight;
      foot.yaw.copy(this.rootYaw);
    }
    if (foot.planted && phase >= foot.duty) {
      foot.planted = false;
      foot.swingStart.copy(foot.target);
      foot.swingYaw.copy(foot.yaw);
      foot.startPhase = phase;
    }
    if (foot.planted) {
      foot.target.copy(foot.anchor);
    } else {
      const t = MathUtils.clamp(
        (phase - foot.startPhase) / Math.max(0.02, 1 - foot.startPhase),
        0,
        1,
      );
      const remaining = (1 - phase) / Math.max(0.05, gait.cadence);
      this.restPosition(foot, this.landing);
      // Root-at-touchdown prediction is stationary during constant-velocity
      // travel, reducing swim/slide during both contact and foot recovery.
      this.landing.addScaledVector(this.velocity, remaining);
      this.rest.set(0, 0, -gait.stride * 0.5).applyQuaternion(this.rootYaw);
      this.landing.add(this.rest);
      foot.target.lerpVectors(foot.swingStart, this.landing, smooth(t));
      foot.target.y =
        this.character.dimensions.ankleHeight +
        Math.sin(Math.PI * t) * gait.lift;
      foot.yaw.copy(foot.swingYaw).slerp(this.rootYaw, smooth(t));
    }
    // Sudden reversals can strand an old contact. Relax that exceptional
    // contact rather than stretching the knee through an impossible pose.
    const root = this.character.root;
    const dx = foot.target.x - root.position.x;
    const dz = foot.target.z - root.position.z;
    const horizontal = Math.hypot(dx, dz);
    if (horizontal > 0.62) {
      foot.target.x = root.position.x + (dx / horizontal) * 0.62;
      foot.target.z = root.position.z + (dz / horizontal) * 0.62;
      if (foot.planted) foot.anchor.copy(foot.target);
    }
    foot.lastPhase = phase;
  }
}
