import { MathUtils, Quaternion, Vector3 } from "three";
import { LocomotionAnimator } from "./LocomotionAnimator.js";
import { CombatStanceAnimator } from "./CombatStanceAnimator.js";
import { LegIK } from "./LegIK.js";
import { DashAnimator } from "./DashAnimator.js";
import { AttackAnimator } from "./AttackAnimator.js";
import { JumpAnimator } from "./JumpAnimator.js";
import { AerialDashAnimator } from "./AerialDashAnimator.js";
import { AerialAttackAnimator } from "./AerialAttackAnimator.js";
import { resolveAnimationStyle } from "./AnimationStyle.js";
import { MotionPresentation } from "./MotionPresentation.js";

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
    pitch: 0,
    runningSwing: false,
    deferSwing: false,
    runningCorrection: new Vector3(),
  };
}

/** Composes gait, automatic guard and punch, then resolves planted feet through the existing
 * hierarchy. Animation owns child transforms only; never root movement/yaw.
 */
export class CharacterAnimator {
  constructor(character, { style } = {}) {
    this.character = character;
    this.style = resolveAnimationStyle(style);
    this.locomotion = new LocomotionAnimator(this.style.locomotion);
    this.motion = new MotionPresentation(this.style.motion);
    this.combat = new CombatStanceAnimator(this.style.locomotion);
    this.dashAnimation = new DashAnimator(character, this.style.groundDash);
    this.attackAnimation = new AttackAnimator(this.style.punch);
    this.jumpAnimation = new JumpAnimator(character, this.style.jump);
    this.aerialDashAnimation = new AerialDashAnimator(
      character,
      this.style.aerialDash,
    );
    this.airDashWeight = 0;
    this.aerialAttackAnimation = new AerialAttackAnimator(
      character,
      this.style.aerialAttack,
    );
    this.aerialAttackWeight = 0;
    this.jumpWeight = 0;
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
    this.travelDirection = new Vector3(0, 0, -1);
    this.runningGoal = new Vector3();
    this.runningLocal = new Vector3();
    this.legDirection = new Vector3();
    this.rootYaw = new Quaternion();
    this.landing = new Vector3();
    this.rest = new Vector3();
    this.hipWorld = new Vector3();
    this.gaitOffset = 0;
    this.wasMoving = false;
    this.initialized = false;
  }

  update(dt, { speed = 0, blocking = false, combat, dash, jump } = {}) {
    if (dt <= 0) return;
    const root = this.character.root;
    const j = this.character.joints;
    const gait = this.locomotion;
    const sprintHandoff = gait.sprintBlend * (1 - this.combatWeight);
    this.combatWeight = this.combat.update(
      dt,
      Boolean(blocking || combat?.postureActive),
    );
    this.attackWeight = this.attackAnimation.update(
      dt,
      combat,
      MathUtils.lerp(
        this.style.punch.entryTime,
        Math.max(
          this.style.punch.entryTime,
          this.style.locomotion.attackHandoffTime,
        ),
        sprintHandoff,
      ),
    );
    // The dash has its own single bound, not a 12 m/s running cycle.
    gait.update(dt, {
      speed: dash?.active ? Math.min(speed, 2.6) : speed,
      combatWeight: this.combatWeight,
      cadenceLimit: dash?.active ? this.style.locomotion.dashCadence : Infinity,
    });
    const moving = speed >= 0.015;
    const distance = root.position.distanceTo(this.previousPosition);
    this.velocity
      .subVectors(root.position, this.previousPosition)
      .multiplyScalar(1 / dt);
    this.previousPosition.copy(root.position);
    this.rootYaw.copy(root.quaternion);
    this.velocity.y = 0;
    if (this.velocity.lengthSq() > 0.0001)
      this.travelDirection.copy(this.velocity).normalize();
    this.motion.update(
      dt,
      this.velocity,
      root.quaternion,
      (!jump || jump.ready) && !dash?.active,
      distance > 1.5,
    );
    const groundDash = dash?.mode === "air" ? null : dash;
    const dashOwnsFeet =
      Boolean(groundDash?.active) || this.dashAnimation.ownsFeet;
    const jumpOwnsFeet =
      Boolean(jump && jump.phase !== "grounded") || this.jumpAnimation.ownsFeet;
    if (jumpOwnsFeet) this.velocity.y = 0;

    // Mid-contact start avoids an overlong first planted step. Guard changes
    // during travel never reset phase or switch an existing contact early.
    if (moving && !this.wasMoving) {
      this.gaitOffset = gait.duty * 0.5 - fract(gait.phase);
      for (const foot of this.footList) {
        foot.lastPhase = fract(gait.phase + this.gaitOffset + foot.offset);
        foot.duty = gait.duty;
        foot.deferSwing = false;
      }
    }
    for (const foot of this.footList) {
      this.restPosition(foot, this.rest);
      if (!this.initialized || distance > 1.5) {
        foot.target.copy(this.rest);
        foot.anchor.copy(this.rest);
        foot.yaw.copy(this.rootYaw);
        foot.planted = true;
        foot.runningSwing = false;
        foot.deferSwing = false;
      }
      if (dashOwnsFeet || jumpOwnsFeet) {
        foot.pitch = 0;
        continue;
      }
      if (!moving) {
        foot.pitch = MathUtils.damp(foot.pitch, 0, 20, dt);
        foot.runningSwing = false;
        foot.deferSwing = false;
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
    this.dashAnimation.update(
      dt,
      groundDash,
      this.footList,
      this.combatWeight,
      !jumpOwnsFeet,
      MathUtils.lerp(
        this.style.groundDash.entryTime,
        Math.max(
          this.style.groundDash.entryTime,
          this.style.locomotion.dashHandoffTime,
        ),
        sprintHandoff,
      ),
    );
    this.dashWeight = this.dashAnimation.weight;
    this.jumpAnimation.update(
      dt,
      jump,
      this.footList,
      this.velocity,
      this.combatWeight,
      blocking,
    );
    this.jumpWeight = this.jumpAnimation.weight;
    this.aerialDashAnimation.update(dt, dash, jump, this.footList, blocking);
    this.airDashWeight = this.aerialDashAnimation.weight;
    this.aerialAttackAnimation.update(dt, combat, jump, this.footList);
    this.aerialAttackWeight = this.aerialAttackAnimation.weight;
    if (dashOwnsFeet || jumpOwnsFeet) {
      // Resume the ordinary planner from the physical landing, without a
      // stale pre-dash world anchor or a phase-wrap contact reset.
      for (const foot of this.footList) {
        foot.lastPhase = fract(gait.phase + this.gaitOffset + foot.offset);
        foot.duty = gait.duty;
        foot.swingStart.copy(foot.target);
        foot.swingYaw.copy(foot.yaw);
        foot.startPhase = foot.lastPhase;
        foot.runningSwing = false;
        // A skill can return a planted foot just before the gait wraps. Keep
        // that landing instead of squeezing a complete swing into one frame.
        foot.deferSwing =
          foot.planted &&
          foot.lastPhase >= foot.duty &&
          (1 - foot.lastPhase) / Math.max(0.05, gait.cadence) <
            this.style.locomotion.swingHandoffTime;
      }
    }

    gait.sampleUpperBody(this.pose, this.gaitOffset, this.motion.drive);
    this.motion.apply(
      this.pose,
      (1 - this.combatWeight) * (1 - this.dashWeight) * (1 - this.jumpWeight),
    );
    this.combat.apply(this.pose, gait.movementBlend, gait.sprintBlend);
    this.dashAnimation.apply(this.pose, this.combatWeight);
    this.attackAnimation.apply(this.pose);
    this.jumpAnimation.apply(this.pose);
    this.aerialDashAnimation.apply(this.pose);
    this.aerialAttackAnimation.apply(this.pose);
    const pose = this.pose;
    j.hips.position.set(pose.hipX, pose.hipY, pose.hipZ ?? 0);
    j.hips.rotation.set(0, pose.hipYaw, pose.hipRoll);
    j.spine.rotation.set(
      pose.spinePitch,
      pose.spineYaw,
      MathUtils.lerp(
        MathUtils.lerp(
          pose.spineRoll,
          this.dashAnimation.spineRoll,
          this.dashWeight,
        ),
        this.jumpAnimation.spineRoll,
        this.jumpWeight,
      ),
    );
    j.spine.rotation.z = MathUtils.lerp(
      j.spine.rotation.z,
      this.aerialDashAnimation.spineRoll,
      this.airDashWeight,
    );
    j.spine.rotation.z += this.aerialAttackAnimation.spineRoll ?? 0;
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
    for (const foot of this.footList) {
      if (
        foot.target.y > this.character.dimensions.ankleHeight + 0.001 &&
        gait.runBlend > 0.001
      ) {
        // Keep the sprint's heel recovery inside a human knee range even
        // while a turn, guard blend or skill handoff lowers the pelvis. Floor
        // contacts stay untouched, including the existing planted-foot anchors.
        j[`${foot.side}Hip`].getWorldPosition(this.hipWorld);
        this.legDirection.subVectors(foot.target, this.hipWorld);
        const reach = this.legDirection.length();
        const minimum = this.style.locomotion.kneeReach;
        if (reach > 0.00001 && reach < minimum)
          foot.target
            .copy(this.hipWorld)
            .addScaledVector(this.legDirection, minimum / reach);
      }
      this.ik.solve(foot.side, foot.target, foot.yaw);
      j[`${foot.side}Ankle`].rotateX(foot.pitch);
    }
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
      const deferred = foot.deferSwing;
      foot.planted = true;
      foot.runningSwing = false;
      foot.deferSwing = false;
      foot.duty = gait.duty;
      foot.anchor.copy(foot.target);
      foot.anchor.y = this.character.dimensions.ankleHeight;
      foot.yaw.copy(this.rootYaw);
      if (deferred) {
        // Resume only the support travel still available behind this landing,
        // rather than dragging a centred foot through a full-length contact.
        const forward = this.rest
          .subVectors(foot.anchor, this.character.root.position)
          .dot(this.travelDirection);
        foot.duty *= MathUtils.clamp(
          (gait.stride * 0.5 + forward) / gait.stride,
          0.2,
          1,
        );
      }
    }
    if (foot.planted && phase >= foot.duty && !foot.deferSwing) {
      foot.planted = false;
      foot.swingStart.copy(foot.target);
      foot.swingYaw.copy(foot.yaw);
      foot.startPhase = phase;
      foot.runningSwing = false;
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
        Math.sin(Math.PI * t) *
          MathUtils.lerp(
            this.style.locomotion.walkLift,
            gait.lift,
            this.combatWeight,
          );
      const runWeight = gait.freeRunBlend;
      if (runWeight > 0.001) {
        this.runningFootGoal(foot, phase, this.runningGoal);
        if (!foot.runningSwing) {
          foot.runningCorrection.subVectors(foot.swingStart, this.runningGoal);
          foot.runningSwing = true;
        }
        this.runningGoal.addScaledVector(foot.runningCorrection, 1 - smooth(t));
        foot.target.lerp(this.runningGoal, runWeight);
      } else foot.runningSwing = false;
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
    gait.walking.applyFoot(
      foot,
      phase,
      foot.duty,
      gait.freeRunBlend,
      this.combatWeight,
    );
    foot.lastPhase = phase;
  }

  runningFootGoal(foot, phase, out) {
    const gait = this.locomotion;
    const swing = MathUtils.clamp(
      (phase - foot.duty) / Math.max(0.02, 1 - foot.duty),
      0,
      1,
    );
    const travel =
      (this.velocity.length() * (1 - foot.duty)) / Math.max(0.05, gait.cadence);
    gait.running.sampleFoot(
      swing,
      gait.stride,
      travel,
      gait.sprintBlend,
      this.runningLocal,
    );
    this.restPosition(foot, out);
    out.addScaledVector(this.travelDirection, -this.runningLocal.z);
    out.y += this.runningLocal.y;
    return out;
  }
}
