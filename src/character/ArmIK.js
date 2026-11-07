import { Quaternion, Vector3 } from "three";
const DOWN = new Vector3(0, -1, 0);
/** Two-bone hand targeting for adaptive strikes; shoulder/elbow stay separately
 * controllable. Only rig joints are written, never the travel root. */
export class ArmIK {
  constructor(character) {
    this.character = character;
    this.origin = new Vector3();
    this.direction = new Vector3();
    this.pole = new Vector3();
    this.elbow = new Vector3();
    this.part = new Vector3();
    this.parent = new Quaternion();
    this.inverse = new Quaternion();
    this.upper = new Quaternion();
  }
  solve(side, target, bodyOrientation) {
    const j = this.character.joints,
      shoulder = j[`${side}Shoulder`],
      elbow = j[`${side}Elbow`];
    shoulder.getWorldPosition(this.origin);
    shoulder.parent.getWorldQuaternion(this.parent);
    this.direction.subVectors(target, this.origin);
    const desired = this.direction.length(),
      reach = Math.max(0.02, Math.min(0.638, desired));
    if (desired < 1e-6) return;
    this.direction.multiplyScalar(1 / desired);
    this.pole
      .set(side === "left" ? -0.8 : 0.8, -0.4, 0.4)
      .applyQuaternion(bodyOrientation);
    this.pole.addScaledVector(this.direction, -this.pole.dot(this.direction));
    if (this.pole.lengthSq() < 1e-8) this.pole.set(0, 1, 0);
    this.pole.normalize();
    const along = reach / 2,
      outward = Math.sqrt(Math.max(0, 0.32 * 0.32 - along * along));
    this.elbow
      .copy(this.origin)
      .addScaledVector(this.direction, along)
      .addScaledVector(this.pole, outward);
    this.inverse.copy(this.parent).invert();
    this.part
      .subVectors(this.elbow, this.origin)
      .normalize()
      .applyQuaternion(this.inverse);
    shoulder.quaternion.setFromUnitVectors(DOWN, this.part);
    this.upper.copy(this.parent).multiply(shoulder.quaternion);
    this.inverse.copy(this.upper).invert();
    this.part
      .copy(this.origin)
      .addScaledVector(this.direction, reach)
      .sub(this.elbow)
      .normalize()
      .applyQuaternion(this.inverse);
    elbow.quaternion.setFromUnitVectors(DOWN, this.part);
  }
}
