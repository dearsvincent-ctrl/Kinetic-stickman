import { MathUtils, Quaternion, Vector3 } from "three";

const DOWN = new Vector3(0, -1, 0);

/**
 * Two-bone positional IK for the existing rigid, hierarchical legs. The knee
 * pole points forward in character space; the ankle cancels parent rotation
 * so a planted foot remains level while the pelvis breathes and turns.
 * All scratch objects are reused. This solver never changes the actor root.
 */
export class LegIK {
  constructor(character) {
    this.character = character;
    this.actualTargetWorld = new Vector3();
    this.reached = true;
    this.hipWorld = new Vector3();
    this.direction = new Vector3();
    this.pole = new Vector3();
    this.kneeWorld = new Vector3();
    this.upperDirection = new Vector3();
    this.lowerDirection = new Vector3();
    this.parentQuaternion = new Quaternion();
    this.inverseQuaternion = new Quaternion();
    this.hipQuaternionWorld = new Quaternion();
    this.kneeQuaternionWorld = new Quaternion();
    this.rootQuaternionWorld = new Quaternion();
  }

  solve(side, targetWorld, footYawQuaternionWorld, bodyOrientation) {
    const { joints: j, dimensions: d, root } = this.character;
    const hip = j[`${side}Hip`];
    const knee = j[`${side}Knee`];
    const ankle = j[`${side}Ankle`];
    hip.updateWorldMatrix(true, false);
    hip.getWorldPosition(this.hipWorld);
    hip.parent.getWorldQuaternion(this.parentQuaternion);
    if (bodyOrientation) this.rootQuaternionWorld.copy(bodyOrientation);
    else root.getWorldQuaternion(this.rootQuaternionWorld);

    this.actualTargetWorld.copy(targetWorld);
    this.actualTargetWorld.y = Math.max(
      d.ankleHeight,
      this.actualTargetWorld.y,
    );
    this.direction.subVectors(this.actualTargetWorld, this.hipWorld);
    const desiredReach = this.direction.length();
    const reach = MathUtils.clamp(
      desiredReach,
      Math.abs(d.upperLeg - d.lowerLeg) + 0.001,
      d.upperLeg + d.lowerLeg - 0.001,
    );
    this.reached = Math.abs(desiredReach - reach) < 0.00001;
    if (desiredReach > 0.00001) this.direction.multiplyScalar(1 / desiredReach);
    else this.direction.copy(DOWN).applyQuaternion(this.parentQuaternion);
    this.actualTargetWorld
      .copy(this.hipWorld)
      .addScaledVector(this.direction, reach);

    // Project the forward pole perpendicular to the hip-to-foot direction.
    this.pole.set(0, 0, -1).applyQuaternion(this.rootQuaternionWorld);
    this.pole.addScaledVector(this.direction, -this.pole.dot(this.direction));
    if (this.pole.lengthSq() < 0.000001) {
      this.pole.set(1, 0, 0).applyQuaternion(this.rootQuaternionWorld);
      this.pole.addScaledVector(this.direction, -this.pole.dot(this.direction));
    }
    this.pole.normalize();
    const along =
      (d.upperLeg * d.upperLeg - d.lowerLeg * d.lowerLeg + reach * reach) /
      (2 * reach);
    const outward = Math.sqrt(
      Math.max(0, d.upperLeg * d.upperLeg - along * along),
    );
    this.kneeWorld
      .copy(this.hipWorld)
      .addScaledVector(this.direction, along)
      .addScaledVector(this.pole, outward);

    this.inverseQuaternion.copy(this.parentQuaternion).invert();
    this.upperDirection
      .subVectors(this.kneeWorld, this.hipWorld)
      .normalize()
      .applyQuaternion(this.inverseQuaternion);
    hip.quaternion.setFromUnitVectors(DOWN, this.upperDirection);
    this.hipQuaternionWorld
      .copy(this.parentQuaternion)
      .multiply(hip.quaternion);

    this.inverseQuaternion.copy(this.hipQuaternionWorld).invert();
    this.lowerDirection
      .subVectors(this.actualTargetWorld, this.kneeWorld)
      .normalize()
      .applyQuaternion(this.inverseQuaternion);
    knee.quaternion.setFromUnitVectors(DOWN, this.lowerDirection);
    this.kneeQuaternionWorld
      .copy(this.hipQuaternionWorld)
      .multiply(knee.quaternion);
    ankle.quaternion
      .copy(this.kneeQuaternionWorld)
      .invert()
      .multiply(footYawQuaternionWorld ?? this.rootQuaternionWorld);
    ankle.updateWorldMatrix(true, false);
    return this.actualTargetWorld;
  }
}
