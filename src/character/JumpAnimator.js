import { MathUtils, Quaternion, Vector3 } from "three";

const clamp01 = (value) => MathUtils.clamp(value, 0, 1);
const smooth = (value) => value * value * (3 - 2 * value);

/** Take-off, flight and touchdown poses over the existing rig. Physics owns
 * height and timing; this layer only controls child joints and ankle targets.
 * Scratch vectors and contact snapshots are reused for every jump.
 */
export class JumpAnimator {
  constructor(character) {
    this.character = character;
    this.active = false;
    this.phase = "grounded";
    this.sequence = -1;
    this.weight = 0;
    this.guardWeight = 0;
    this.spineRoll = 0;
    this.support = 0;
    this.lead = 1;
    this.progress = 0;
    this.tuck = 0;
    this.compression = 0;
    this.starts = [new Vector3(), new Vector3()];
    this.startYaws = [new Quaternion(), new Quaternion()];
    this.flightStarts = [new Vector3(), new Vector3()];
    this.takeoffOrigin = new Vector3();
    this.travel = new Vector3();
    this.flightHipStart = 0.955;
    this.goal = new Vector3();
    this.rest = new Vector3();
    this.inverseRoot = new Quaternion();
    this.localVelocity = new Vector3();
    this.hipY = 0.955;
    this.pitch = 0;
    this.freeArmX = 0;
    this.freeElbow = 0;
  }

  get ownsFeet() {
    return this.active;
  }

  update(dt, jump, feet, velocity, combatWeight, blocking) {
    const phase = jump?.phase ?? "grounded";
    const active = phase !== "grounded";
    const root = this.character.root;
    const ankleY = this.character.dimensions.ankleHeight;
    const previousPhase = this.phase;
    this.guardWeight = MathUtils.damp(
      this.guardWeight,
      blocking ? 1 : 0,
      16,
      dt,
    );

    if (active && (!this.active || jump.sequence !== this.sequence)) {
      this.sequence = jump.sequence;
      this.support = feet[0].planted
        ? 0
        : feet[1].planted
          ? 1
          : feet[0].target.y <= feet[1].target.y
            ? 0
            : 1;
      this.lead = 1 - this.support;
      this.takeoffOrigin.copy(root.position);
      for (let i = 0; i < 2; i++) {
        this.starts[i].copy(feet[i].target);
        this.startYaws[i].copy(feet[i].yaw);
      }
    }

    if (!active && !this.active) {
      this.weight = 0;
      this.spineRoll = 0;
      return;
    }

    this.inverseRoot.copy(root.quaternion).invert();
    this.localVelocity.copy(velocity).applyQuaternion(this.inverseRoot);
    this.localVelocity.y = 0;
    this.spineRoll = -MathUtils.clamp(this.localVelocity.x / 5.2, -1, 1) * 0.06;
    const travelPitch =
      MathUtils.clamp(this.localVelocity.z / 5.2, -1, 1) * 0.08;
    this.compression = 0;

    if (phase === "takeoff") {
      const p = clamp01(jump.phaseProgress);
      this.progress = p;
      this.weight = smooth(p);
      this.tuck = 0;
      this.compression = Math.sin(Math.PI * p);
      this.hipY = 0.955 - 0.11 * this.compression;
      this.pitch = travelPitch - 0.035 * this.compression;
      this.freeArmX = MathUtils.lerp(-0.22, 0.53, smooth(p));
      this.freeElbow = 0.65;
      this.travel.subVectors(root.position, this.takeoffOrigin);
      this.travel.y = 0;
      for (let i = 0; i < 2; i++) {
        const foot = feet[i];
        foot.target.copy(this.starts[i]);
        if (i !== this.support)
          foot.target.addScaledVector(this.travel, smooth(p));
        // An interrupted dash may have both visual feet above the floor.
        // Load the support foot over takeoff rather than snapping it down.
        foot.target.y =
          i === this.support
            ? MathUtils.lerp(this.starts[i].y, ankleY, smooth(p))
            : this.starts[i].y;
        foot.yaw.copy(this.startYaws[i]).slerp(root.quaternion, smooth(p));
        foot.planted = i === this.support && foot.target.y <= ankleY + 1e-5;
        this.limitReach(foot, 0.62);
        if (i === this.support) {
          this.goal
            .set(foot.sign * 0.15, 0, 0)
            .applyQuaternion(root.quaternion)
            .add(root.position);
          const horizontal = Math.hypot(
            this.goal.x - foot.target.x,
            this.goal.z - foot.target.z,
          );
          this.hipY = Math.min(
            this.hipY,
            foot.target.y -
              root.position.y +
              Math.sqrt(
                Math.max(0.01, 0.858 * 0.858 - horizontal * horizontal),
              ),
          );
        }
        foot.anchor.copy(foot.target);
      }
    } else if (phase === "airborne") {
      if (previousPhase !== "airborne") {
        this.flightHipStart = this.character.joints.hips.position.y;
        for (let i = 0; i < 2; i++) {
          this.flightStarts[i]
            .copy(feet[i].target)
            .sub(root.position)
            .applyQuaternion(this.inverseRoot);
          this.startYaws[i].copy(feet[i].yaw);
        }
      }
      const launchSpeed = Math.sqrt(
        2 * jump.config.gravity * jump.config.height,
      );
      const p = clamp01(0.5 - jump.verticalVelocity / (2 * launchSpeed));
      this.progress = p;
      this.weight = 1;
      // Unfold early enough that touchdown does not snap tucked feet down.
      this.tuck =
        Math.sin(Math.PI * p) * (1 - smooth(clamp01((p - 0.55) / 0.35)));
      this.hipY = MathUtils.lerp(
        this.flightHipStart,
        0.955 - this.tuck * 0.018,
        smooth(clamp01(jump.elapsed / 0.12)),
      );
      this.pitch = travelPitch - 0.025;
      this.freeArmX = 0.35 + this.tuck * 0.3;
      this.freeElbow = 0.65 + this.tuck * 0.32;
      const release = smooth(clamp01(jump.elapsed / 0.16));
      for (let i = 0; i < 2; i++) {
        const foot = feet[i];
        this.goal.set(
          foot.sign * 0.16,
          ankleY + this.tuck * 0.22,
          (i === this.lead ? -0.045 : 0.065) * this.tuck,
        );
        this.goal
          .lerpVectors(this.flightStarts[i], this.goal, release)
          .applyQuaternion(root.quaternion)
          .add(root.position);
        foot.target.copy(this.goal);
        foot.yaw.copy(this.startYaws[i]).slerp(root.quaternion, release);
        foot.planted = false;
        foot.anchor.copy(foot.target);
      }
    } else {
      // Sample p=1 once when movement has already crossed the final phase
      // boundary. This hands real touchdown targets back to the gait planner.
      const p = active ? clamp01(jump.phaseProgress) : 1;
      if (previousPhase !== "landing") {
        for (let i = 0; i < 2; i++) {
          this.starts[i].copy(feet[i].target);
          this.starts[i].y = ankleY;
          this.startYaws[i].copy(feet[i].yaw);
        }
      }
      this.progress = p;
      this.compression =
        p < 0.35 ? smooth(p / 0.35) : 1 - smooth((p - 0.35) / 0.65);
      this.tuck = 0;
      this.weight = 1 - smooth(clamp01((p - 0.45) / 0.55));
      this.hipY = 0.955 - this.compression * 0.12;
      this.pitch = travelPitch - this.compression * 0.04;
      this.freeArmX = 0.28 + this.compression * 0.18;
      this.freeElbow = 0.65;
      for (let i = 0; i < 2; i++) {
        const foot = feet[i];
        this.restFoot(foot, combatWeight, this.goal);
        // One leg absorbs contact while the other takes the first recovery
        // step. Release that contact during forward travel rather than drag it.
        const t =
          i === this.lead ? smooth(clamp01((p - 0.28) / 0.72)) : smooth(p);
        foot.target.lerpVectors(this.starts[i], this.goal, t);
        foot.target.y = ankleY + Math.sin(Math.PI * t) * 0.045;
        foot.yaw.copy(this.startYaws[i]).slerp(root.quaternion, t);
        foot.planted = (i === this.lead && p < 0.28) || p >= 1;
        this.limitReach(foot);
        foot.anchor.copy(foot.target);
      }
    }
    this.phase = phase;
    this.active = active;
  }

  restFoot(foot, combatWeight, out) {
    return out
      .set(
        foot.sign * MathUtils.lerp(0.15, 0.18, combatWeight),
        this.character.dimensions.ankleHeight,
        (foot.side === "left" ? -0.13 : 0.13) * combatWeight,
      )
      .applyQuaternion(this.character.root.quaternion)
      .add(this.character.root.position);
  }

  limitReach(foot, maximum = 0.54) {
    const root = this.character.root.position;
    const dx = foot.target.x - root.x;
    const dz = foot.target.z - root.z;
    const length = Math.hypot(dx, dz);
    if (length > maximum) {
      foot.target.x = root.x + (dx / length) * maximum;
      foot.target.z = root.z + (dz / length) * maximum;
      foot.planted = false;
    }
  }

  apply(pose) {
    const weight = this.weight;
    if (weight <= 0) return;
    pose.hipY = MathUtils.lerp(pose.hipY, this.hipY, weight);
    pose.hipX *= 1 - weight;
    pose.hipYaw = MathUtils.lerp(pose.hipYaw, this.guardWeight * 0.06, weight);
    pose.hipRoll *= 1 - weight;
    pose.spinePitch = MathUtils.lerp(pose.spinePitch, this.pitch, weight);
    pose.spineYaw *= 1 - weight;
    pose.headPitch = MathUtils.lerp(pose.headPitch, -0.025, weight);
    for (let i = 0; i < 2; i++) {
      const arm = pose.arms[i];
      const sign = i === 0 ? -1 : 1;
      arm.x = MathUtils.lerp(
        arm.x,
        MathUtils.lerp(this.freeArmX, i === 0 ? 1.1 : 1.04, this.guardWeight),
        weight,
      );
      arm.y = MathUtils.lerp(arm.y, -sign * 0.06 * this.guardWeight, weight);
      arm.z = MathUtils.lerp(arm.z, -sign * 0.18, weight);
      arm.elbow = MathUtils.lerp(
        arm.elbow,
        MathUtils.lerp(this.freeElbow, i === 0 ? 1.76 : 1.84, this.guardWeight),
        weight,
      );
    }
  }
}
