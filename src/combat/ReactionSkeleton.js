import { Vector3, Quaternion, Euler } from "three";
const UP = new Vector3(0, 1, 0);
/** Shared forward kinematics for angular reactions and true body contact points.
 * Fixed rig offsets mirror Stickman; never scale a limb to a target. */
export class ReactionSkeleton {
  constructor() {
    this.points = Object.fromEntries(
      [
        "hips",
        "torso",
        "head",
        "leftHand",
        "rightHand",
        "leftElbow",
        "rightElbow",
        "leftKnee",
        "rightKnee",
        "leftAnkle",
        "rightAnkle",
        "leftToe",
        "rightToe",
      ].map((k) => [k, new Vector3()]),
    );
    this.all = Object.values(this.points);
    this.core = [this.points.hips, this.points.torso, this.points.head];
    this.spine = new Quaternion();
    this.arm = new Quaternion();
    this.elbow = new Quaternion();
    this.leg = new Quaternion();
    this.knee = new Quaternion();
    this.ankle = new Quaternion();
    this.world = new Quaternion();
    this.q = new Quaternion();
    this.euler = new Euler();
    this.base = new Vector3();
    this.elbowPoint = new Vector3();
    this.kneePoint = new Vector3();
    this.temp = new Vector3();
  }
  rotation(out, r, index) {
    const k = index * 3;
    return out.setFromEuler(
      this.euler.set(
        r.jointAngles[k],
        r.jointAngles[k + 1],
        r.jointAngles[k + 2],
      ),
    );
  }
  sample(r, heading, detail = true) {
    const p = this.points;
    p.hips.set(0, 0.97, 0);
    this.rotation(this.spine, r, 0);
    this.base.set(0, 1.04, 0);
    p.torso.set(0, 0.32, 0).applyQuaternion(this.spine).add(this.base);
    p.head.set(0, 0.7, 0).applyQuaternion(this.spine).add(this.base);
    if (detail)
      for (let i = 0; i < 2; i++) {
        const side = i === 0 ? "left" : "right",
          sign = i === 0 ? -1 : 1;
        this.temp
          .set(sign * 0.25, 0.41, 0)
          .applyQuaternion(this.spine)
          .add(this.base);
        this.arm.copy(this.spine).multiply(this.rotation(this.q, r, 2 + i));
        this.elbowPoint
          .set(0, -0.32, 0)
          .applyQuaternion(this.arm)
          .add(this.temp);
        p[side + "Elbow"].copy(this.elbowPoint);
        this.elbow.copy(this.arm).multiply(this.rotation(this.q, r, 4 + i));
        p[side + "Hand"]
          .set(0, -0.32, 0)
          .applyQuaternion(this.elbow)
          .add(this.elbowPoint);
        this.leg.copy(this.rotation(this.q, r, 6 + i));
        this.temp.set(sign * 0.15, 0.97, 0);
        this.kneePoint
          .set(0, -0.44, 0)
          .applyQuaternion(this.leg)
          .add(this.temp);
        p[side + "Knee"].copy(this.kneePoint);
        this.knee.copy(this.leg).multiply(this.rotation(this.q, r, 8 + i));
        p[side + "Ankle"]
          .set(0, -0.43, 0)
          .applyQuaternion(this.knee)
          .add(this.kneePoint);
        this.ankle.copy(this.knee).multiply(this.rotation(this.q, r, 10 + i));
        p[side + "Toe"]
          .set(0, -0.06, -0.17)
          .applyQuaternion(this.ankle)
          .add(p[side + "Ankle"]);
      }
    this.world.setFromAxisAngle(UP, heading).multiply(r.orientation);
    for (const point of detail ? this.all : this.core) {
      point.y -= 0.97;
      point.applyQuaternion(this.world);
      point.y += r.bodyHeight;
    }
    return p;
  }
}
