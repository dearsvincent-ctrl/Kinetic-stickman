import { Quaternion, Vector3 } from "three";

const AXES = ["x", "y", "z"];
const JOINTS = [
  "hips",
  "spine",
  "head",
  "leftShoulder",
  "leftElbow",
  "rightShoulder",
  "rightElbow",
];

/** Fast quaternion following plus an analytic critically damped pelvis spring.
 * Contacts and active-strike IK solve AFTER this layer, retaining their exact
 * endpoints. No animation filter owns the physical root or action eligibility. */
export class PoseContinuity {
  constructor(character, style) {
    this.character = character;
    this.style = style;
    this.states = JOINTS.map(() => new Quaternion());
    this.position = new Vector3();
    this.velocity = new Vector3();
    this.goal = new Vector3();
    this.initialized = false;
  }
  reset() {
    this.initialized = false;
    this.velocity.set(0, 0, 0);
  }
  apply(dt, attacking = false) {
    const j = this.character.joints;
    if (!this.initialized) {
      for (let i = 0; i < JOINTS.length; i++)
        this.states[i].copy(j[JOINTS[i]].quaternion);
      this.position.copy(j.hips.position);
      this.initialized = true;
      return;
    }
    const response = attacking
      ? this.style.strikeResponse
      : this.style.upperResponse;
    const blend = 1 - Math.exp(-response * Math.min(dt, 0.1));
    for (let i = 0; i < JOINTS.length; i++) {
      const joint = j[JOINTS[i]];
      this.states[i].slerp(joint.quaternion, blend).normalize();
      joint.quaternion.copy(this.states[i]);
    }
    this.goal.copy(j.hips.position);
    const omega = this.style.pelvisResponse,
      time = Math.min(dt, 0.1),
      decay = Math.exp(-omega * time);
    for (const axis of AXES) {
      const offset = this.position[axis] - this.goal[axis];
      const carry = this.velocity[axis] + omega * offset;
      this.position[axis] = this.goal[axis] + (offset + carry * time) * decay;
      this.velocity[axis] =
        (this.velocity[axis] - omega * carry * time) * decay;
    }
    j.hips.position.copy(this.position);
  }
}
