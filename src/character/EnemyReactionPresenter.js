import { Group, Vector3, Quaternion } from "three";
import { REACTION_JOINTS } from "../combat/EnemyReaction.js";
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
/** An articulated angular ragdoll layer. Joint translations/scales never change,
 * preserving authored bone lengths and ordinary animation underneath recovery. */
export class EnemyReactionPresenter {
  constructor(character) {
    this.character = character;
    this.pivot = new Group();
    this.pivot.name = "enemyReactionFrame";
    this.pivot.position.y = 0.97;
    this.inner = new Group();
    this.inner.position.y = -0.97;
    this.pivot.add(this.inner);
    character.root.add(this.pivot);
    this.inner.add(character.joints.hips);
    this.base = new Float64Array(REACTION_JOINTS.length * 3);
    this.applied = false;
    this.hipsPosition = new Vector3();
    this.hipsQuaternion = new Quaternion();
  }
  begin() {
    if (this.applied) {
      this.character.joints.hips.position.copy(this.hipsPosition);
      this.character.joints.hips.quaternion.copy(this.hipsQuaternion);
    }
    if (this.applied)
      for (let i = 0; i < REACTION_JOINTS.length; i++) {
        const j = this.character.joints[REACTION_JOINTS[i]];
        j.rotation.set(
          this.base[i * 3],
          this.base[i * 3 + 1],
          this.base[i * 3 + 2],
        );
      }
    this.applied = false;
    this.pivot.quaternion.identity();
    this.pivot.position.y = 0.97;
  }
  reset() {
    this.begin();
  }
  capture(reaction) {
    if (!reaction) return;
    for (let i = 0; i < REACTION_JOINTS.length; i++) {
      const j = this.character.joints[REACTION_JOINTS[i]];
      reaction.presentedPose[i * 3] = j.rotation.x;
      reaction.presentedPose[i * 3 + 1] = j.rotation.y;
      reaction.presentedPose[i * 3 + 2] = j.rotation.z;
    }
    reaction.presentedOrientation.copy(this.character.joints.hips.quaternion);
    reaction.hasPresentedPose = true;
  }
  apply(reaction) {
    if (!reaction?.active) return;
    const c = this.character,
      r = reaction;
    this.hipsPosition.copy(c.joints.hips.position);
    this.hipsQuaternion.copy(c.joints.hips.quaternion);
    let weight = r.ownsMotion ? 1 : clamp(r.weight, 0, 1.5);

    for (let i = 0; i < REACTION_JOINTS.length; i++) {
      const j = c.joints[REACTION_JOINTS[i]],
        k = i * 3;
      this.base[k] = j.rotation.x;
      this.base[k + 1] = j.rotation.y;
      this.base[k + 2] = j.rotation.z;
      const x = r.jointAngles[k] * weight,
        y = r.jointAngles[k + 1] * weight,
        z = r.jointAngles[k + 2] * weight;
      if (r.ownsMotion)
        j.rotation.set(
          this.base[k] * (1 - weight) + x,
          this.base[k + 1] * (1 - weight) + y,
          this.base[k + 2] * (1 - weight) + z,
        );
      else
        j.rotation.set(
          this.base[k] + x,
          this.base[k + 1] + y,
          this.base[k + 2] + z,
        );
    }
    if (r.ownsMotion) {
      c.joints.hips.position.set(0, 0.97, 0);
      c.joints.hips.quaternion.identity();
      this.pivot.quaternion.copy(r.orientation);
      this.pivot.position.y = r.bodyHeight;
    } else {
      const recoil = Math.exp(-r.age * 7) * clamp(r.weight, 0, 2);
      const j = c.joints;
      j.spine.rotation.x -=
        r.localZ * recoil * (r.location === "body" ? 0.24 : 0.12);
      j.spine.rotation.z += r.localX * recoil * 0.2;
      j.spine.rotation.y += r.localX * recoil * 0.22;
      j.head.rotation.x -=
        r.localZ * recoil * (r.location === "head" ? 0.38 : 0.08);
      if (r.phase === "stumble")
        for (const side of ["left", "right"]) {
          const sign = side === "left" ? 1 : -1;
          const step = Math.sin(r.age * 19) * sign * recoil;
          j[side + "Hip"].rotation.x += step * 0.32;
          j[side + "Knee"].rotation.x = Math.max(
            0,
            j[side + "Knee"].rotation.x + Math.abs(step) * 0.25,
          );
        }
    }
    // Articulation is limited independently of root travel. Preserve elbows and
    // knees as hinges; all rotations stay finite and bones stay their rig length.
    for (const side of ["left", "right"]) {
      c.joints[side + "Knee"].rotation.x = clamp(
        c.joints[side + "Knee"].rotation.x,
        0,
        2.25,
      );
      c.joints[side + "Elbow"].rotation.x = clamp(
        c.joints[side + "Elbow"].rotation.x,
        -2.2,
        0.3,
      );
    }
    this.applied = true;
  }
}
