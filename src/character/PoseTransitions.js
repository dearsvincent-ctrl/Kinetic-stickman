import { Quaternion, Vector3 } from "three";
const NAMES = [
  "hips",
  "spine",
  "head",
  "leftShoulder",
  "leftElbow",
  "rightShoulder",
  "rightElbow",
  "leftHip",
  "leftKnee",
  "leftAnkle",
  "rightHip",
  "rightKnee",
  "rightAnkle",
];
/** New techniques fade from the actual authored joint configuration. A
 * transition does not visit neutral or restart the lower-body gait clock. */
export class PoseTransitions {
  constructor(character) {
    this.character = character;
    this.starts = NAMES.map(() => new Quaternion());
    this.hip = new Vector3();
    this.target = new Quaternion();
    this.blend = 1;
    this.sequence = 0;
    this.elapsed = 1;
    this.duration = 0.085;
  }
  begin(combat) {
    const attack = combat?.attack;
    if (!attack?.active || attack.sequence === this.sequence) return;
    this.sequence = attack.sequence;
    this.elapsed = 0;
    this.duration =
      attack.context?.transition?.action === "kick" ? 0.11 : 0.075;
    NAMES.forEach((name, i) =>
      this.starts[i].copy(this.character.joints[name].quaternion),
    );
    this.hip.copy(this.character.joints.hips.position);
  }
  apply(dt) {
    if (this.elapsed >= this.duration) {
      this.blend = 1;
      return;
    }
    this.elapsed += dt;
    const p = Math.min(1, this.elapsed / this.duration),
      blend = p * p * (3 - 2 * p);
    this.blend = blend;
    NAMES.forEach((name, i) => {
      this.target.copy(this.character.joints[name].quaternion);
      this.character.joints[name].quaternion.slerpQuaternions(
        this.starts[i],
        this.target,
        blend,
      );
    });
    this.character.joints.hips.position.lerpVectors(
      this.hip,
      this.character.joints.hips.position,
      blend,
    );
  }
}
