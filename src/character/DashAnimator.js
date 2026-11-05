import { MathUtils, Quaternion, Vector3 } from "three";

const clamp01 = (value) => MathUtils.clamp(value, 0, 1);
const smooth = (value) => value * value * (3 - 2 * value);
const UP = new Vector3(0, 1, 0);

/** A single push, low bound, and landing layered over the existing gait/guard.
 * World-space ankle contacts are separate from the movement state: this layer
 * never moves the character root, applies impulses, or chooses dash direction.
 */
export class DashAnimator {
  constructor(character) {
    this.character = character;
    this.weight = 0;
    this.spineRoll = 0;
    this.recoveryDuration = 0.16;
    this.sequence = -1;
    this.active = false;
    this.progress = 0;
    this.recoveryTime = 0;
    this.recoveryWeight = 0;
    this.rear = 1;
    this.direction = new Vector3(0, 0, -1);
    this.localDirection = new Vector3();
    this.inverseRoot = new Quaternion();
    this.yaw = new Quaternion();
    this.right = new Vector3();
    this.goal = new Vector3();
    this.rest = new Vector3();
    this.starts = [new Vector3(), new Vector3()];
    this.startYaws = [new Quaternion(), new Quaternion()];
    this.landing = new Vector3();
    this.landed = false;
  }

  get ownsFeet() {
    return this.active || this.weight > 0;
  }

  update(dt, dash, feet, combatWeight) {
    const active = Boolean(dash?.active);
    const root = this.character.root;
    const ankleY = this.character.dimensions.ankleHeight;
    let completed = false;
    if (active && (!this.active || dash.sequence !== this.sequence)) {
      this.sequence = dash.sequence;
      this.landed = false;
      this.recoveryTime = 0;
      for (let i = 0; i < 2; i++) {
        this.starts[i].copy(feet[i].target);
        this.startYaws[i].copy(feet[i].yaw);
      }
      // The foot furthest behind the requested direction supplies the push.
      this.goal.subVectors(feet[0].target, feet[1].target);
      this.rear = this.goal.dot(dash.direction) < 0 ? 0 : 1;
    } else if (!active && this.active) {
      completed = dash?.exitReason === "completed";
      if (completed) {
        // The controller finishes before animation samples the last frame.
        // Resolve that touchdown explicitly even if a frame skipped the last
        // active contact sample, then begin recovery on the following frame.
        this.progress = 1;
        const front = feet[1 - this.rear];
        if (!this.landed) {
          this.direction.copy(dash.direction);
          this.right.set(-this.direction.z, 0, this.direction.x);
          this.landing
            .copy(root.position)
            .addScaledVector(this.direction, 0.18)
            .addScaledVector(this.right, front.sign * 0.16);
          this.landing.y = ankleY;
        }
        front.target.copy(this.landing);
        front.anchor.copy(this.landing);
        front.planted = true;
        this.landed = true;
      }
      this.recoveryTime = 0;
      this.recoveryWeight = this.weight;
      for (let i = 0; i < 2; i++) {
        this.starts[i].copy(feet[i].target);
        this.startYaws[i].copy(feet[i].yaw);
      }
    }
    this.active = active;

    if (active) {
      this.progress = clamp01(dash.progress);
      this.direction.copy(dash.direction);
      this.weight = smooth(clamp01(dash.elapsed / 0.032));
      this.right.set(-this.direction.z, 0, this.direction.x);
      this.yaw.setFromAxisAngle(
        UP,
        Math.atan2(-this.direction.x, -this.direction.z),
      );
      const p = this.progress;
      const toeOff = smooth(clamp01((p - 0.16) / 0.2));
      const landingBlend = smooth(clamp01((p - 0.76) / 0.14));
      const remaining = Math.max(
        0,
        (dash.config?.distance ?? 2.5) - dash.distanceTravelled,
      );

      for (let i = 0; i < 2; i++) {
        const foot = feet[i];
        const rear = i === this.rear;
        const flight = Math.sin(Math.PI * clamp01((p - 0.16) / 0.84));
        const along = rear
          ? MathUtils.lerp(-0.3, -0.16, p)
          : 0.3 + flight * 0.04;
        this.goal
          .copy(root.position)
          .addScaledVector(this.direction, along)
          .addScaledVector(this.right, foot.sign * 0.16);
        this.goal.y = ankleY + flight * (rear ? 0.14 : 0.18);
        foot.target.lerpVectors(this.starts[i], this.goal, toeOff);
        foot.planted = rear && p <= 0.16;

        if (!rear && p > 0.76) {
          if (!this.landed) {
            // Predict only the remaining travel. Steering can adjust this
            // target while the foot is airborne; contact then stays fixed.
            this.landing
              .copy(root.position)
              .addScaledVector(this.direction, remaining + 0.18)
              .addScaledVector(this.right, foot.sign * 0.16);
            this.landing.y = ankleY;
          }
          foot.target.lerp(this.landing, landingBlend);
          if (p >= 0.9) {
            this.landed = true;
            foot.target.copy(this.landing);
            foot.planted = true;
          }
        }
        foot.yaw
          .copy(this.startYaws[i])
          .slerp(this.yaw, smooth(clamp01(p / 0.65)));
        this.limitReach(foot);
        foot.anchor.copy(foot.target);
      }
    } else if (this.weight > 0 && !completed) {
      this.recoveryTime += dt;
      const t = clamp01(this.recoveryTime / this.recoveryDuration);
      const blend = smooth(t);
      this.weight = this.recoveryWeight * (1 - blend);
      for (let i = 0; i < 2; i++) {
        const foot = feet[i];
        const stagger = (i === 0 ? -0.13 : 0.13) * combatWeight;
        this.rest
          .set(
            foot.sign * MathUtils.lerp(0.15, 0.18, combatWeight),
            ankleY,
            stagger,
          )
          .applyQuaternion(root.quaternion)
          .add(root.position);
        foot.target.lerpVectors(this.starts[i], this.rest, blend);
        // A small recovery step repositions the feet above the floor rather
        // than dragging them back to the ordinary gait's stance width.
        foot.target.y =
          MathUtils.lerp(this.starts[i].y, ankleY, blend) +
          Math.sin(Math.PI * t) * 0.045;
        foot.yaw.copy(this.startYaws[i]).slerp(root.quaternion, blend);
        foot.planted = t >= 1;
        this.limitReach(foot);
        foot.anchor.copy(foot.target);
      }
    }
  }

  limitReach(foot) {
    const root = this.character.root.position;
    const dx = foot.target.x - root.x;
    const dz = foot.target.z - root.z;
    const distance = Math.hypot(dx, dz);
    if (distance > 0.58) {
      foot.target.x = root.x + (dx / distance) * 0.58;
      foot.target.z = root.z + (dz / distance) * 0.58;
      // An exceptional early blocked/reversed dash must release an old
      // contact instead of stretching a planted knee beyond its reach.
      foot.planted = false;
    }
  }

  apply(pose, combatWeight) {
    this.spineRoll = 0;
    if (this.weight === 0) return;
    this.inverseRoot.copy(this.character.root.quaternion).invert();
    this.localDirection.copy(this.direction).applyQuaternion(this.inverseRoot);
    const p = this.progress;
    const push = 1 - smooth(clamp01(p / 0.32));
    const drive = smooth(clamp01(p / 0.16));
    const lean = 0.24 + drive * 0.1 - smooth(clamp01((p - 0.72) / 0.28)) * 0.1;
    pose.hipY -= push * 0.075 * this.weight;
    pose.hipYaw += (this.rear === 0 ? -1 : 1) * 0.035 * drive * this.weight;
    pose.spinePitch = MathUtils.lerp(
      pose.spinePitch,
      this.localDirection.z * lean,
      this.weight,
    );
    this.spineRoll = -this.localDirection.x * lean * 0.75 * this.weight;
    pose.headPitch += -this.localDirection.z * 0.065 * this.weight;
    for (let i = 0; i < 2; i++) {
      const arm = pose.arms[i];
      const rearArm = i === this.rear;
      const guardX = arm.x + (rearArm ? 0.07 : -0.05) * drive;
      const freeX = rearArm ? 0.85 : -0.48;
      const targetX = MathUtils.lerp(freeX, guardX, combatWeight);
      const targetElbow = MathUtils.lerp(
        rearArm ? 1.05 : 0.48,
        arm.elbow,
        combatWeight,
      );
      arm.x = MathUtils.lerp(arm.x, targetX, this.weight);
      arm.elbow = MathUtils.lerp(arm.elbow, targetElbow, this.weight);
    }
  }
}
