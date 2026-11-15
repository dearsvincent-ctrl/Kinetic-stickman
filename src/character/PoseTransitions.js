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
    this.movementSequence = {
      jump: -1,
      phase: null,
      dash: -1,
      active: false,
      parkour: 0,
    };
    this.attackActive = false;
  }
  begin(combat, movement) {
    const attack = combat?.attack;
    const previous = this.movementSequence;
    const moving = Boolean(
      movement &&
        previous.phase !== null &&
        (movement.jump.sequence !== previous.jump ||
          movement.jump.phase !== previous.phase ||
          movement.dash.sequence !== previous.dash ||
          movement.dash.active !== previous.active ||
          (movement.parkour?.sequence ?? 0) !== previous.parkour),
    );
    if (movement) {
      previous.jump = movement.jump.sequence;
      previous.phase = movement.jump.phase;
      previous.dash = movement.dash.sequence;
      previous.active = movement.dash.active;
      previous.parkour = movement.parkour?.sequence ?? 0;
    }
    const enteringAttack = attack?.active && attack.sequence !== this.sequence;
    const exitingAttack = this.attackActive && !attack?.active;
    this.attackActive = Boolean(attack?.active);
    if (!enteringAttack && !exitingAttack && !moving) return;
    if (enteringAttack) this.sequence = attack.sequence;
    this.elapsed = 0;
    this.duration = enteringAttack
      ? attack.context?.transition?.action === "kick"
        ? 0.11
        : 0.075
      : 0.09;
    NAMES.forEach((name, i) =>
      this.starts[i].copy(this.character.joints[name].quaternion),
    );
    this.hip.copy(this.character.joints.hips.position);
  }
  apply(dt, feet) {
    if (this.elapsed >= this.duration) {
      this.blend = 1;
      return;
    }
    this.elapsed += dt;
    const p = Math.min(1, this.elapsed / this.duration),
      blend = p * p * (3 - 2 * p);
    this.blend = blend;
    for (let i = 0; i < NAMES.length; i++) {
      // Leg entries are contiguous: left 7..9, right 10..12. Contact IK owns
      // these joints after the pelvis blend; no per-joint callback allocation.
      if (
        (i >= 7 && i < 10 && feet?.[0].planted) ||
        (i >= 10 && feet?.[1].planted)
      )
        continue;
      const joint = this.character.joints[NAMES[i]];
      this.target.copy(joint.quaternion);
      joint.quaternion.slerpQuaternions(this.starts[i], this.target, blend);
    }
    this.character.joints.hips.position.lerpVectors(
      this.hip,
      this.character.joints.hips.position,
      blend,
    );
  }
}
