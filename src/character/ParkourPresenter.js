import { Quaternion, Vector3 } from "three";
import { ArmIK } from "./ArmIK.js";
const SIDES = ["left", "right"];
const IDENTITY = new Quaternion();
const clamp = (x) => Math.max(0, Math.min(1, x));
/** Final contact poses over the existing rig. Physics supplies surface, mode,
 * velocity and travelled distance; attacks retain final ownership of a limb. */
export class ParkourPresenter {
  constructor(character, animator) {
    this.character = character;
    this.animator = animator;
    this.arms = new ArmIK(character);
    this.weight = 0;
    this.wallRunWeight = 0;
    this.normal = new Vector3(0, 0, 1);
    this.tangent = new Vector3(1, 0, 0);
    this.inverse = new Quaternion();
    this.footOrientation = new Quaternion();
    this.align = new Quaternion();
    this.up = new Vector3();
    this.target = new Vector3();
    this.actual = new Vector3();
    this.localNormal = new Vector3();
    this.surface = null;
    this.mode = "climb";
    this.phase = 0;
    this.lastDistance = 0;
    this.reach = 0.4;
  }
  apply(dt, state, body, combat) {
    const active = Boolean(state?.attached);
    this.wallRunWeight +=
      ((active && state.mode === "wall-run" ? 1 : 0) - this.wallRunWeight) *
      (1 - Math.exp(-18 * dt));
    this.weight += ((active ? 1 : 0) - this.weight) * (1 - Math.exp(-22 * dt));
    if (active) {
      this.mode = state.mode;
      this.surface = state.surface;
      this.normal.copy(state.normal);
      this.tangent.copy(state.tangent);
      this.phase =
        (this.phase +
          Math.min(Math.max(0, state.distance - this.lastDistance), 6 * dt) *
            2.5) %
        (Math.PI * 2);
      this.lastDistance = state.distance;
      // Root-to-surface distance, not a magnetic body offset.
      this.reach =
        state.surface.kind === "pole"
          ? Math.max(
              0.25,
              Math.hypot(
                this.character.root.position.x - state.surface.x,
                this.character.root.position.z - state.surface.z,
              ) - state.surface.radius,
            )
          : Math.max(
              0.3,
              Math.min(0.6, (state.characterRadius ?? 0.36) + state.sample.gap),
            );
    }
    if (this.weight < 0.001 || !this.surface) return;
    const root = this.character.root,
      j = this.character.joints,
      s = this.surface,
      w = this.weight;
    const perch = this.mode === "perch",
      ledge =
        this.mode === "ledge" ||
        this.mode === "mantle" ||
        this.mode === "pole-mantle",
      vault = this.mode === "vault";
    const cycle = Math.sin(this.phase),
      compress = vault ? 0.76 : perch ? 0.84 : ledge ? 0.88 : 0.89;
    j.hips.position.y += (compress - j.hips.position.y) * w;
    j.hips.rotateY(cycle * 0.035 * w * (ledge ? 0 : 1));
    this.localNormal
      .copy(this.normal)
      .applyQuaternion(this.inverse.copy(body).invert());
    j.hips.rotateZ(
      (this.localNormal.x * 0.18 * this.wallRunWeight +
        cycle * 0.025 * (1 - this.wallRunWeight)) *
        w,
    );
    j.spine.rotateX((vault ? -0.16 : ledge ? 0.08 : -0.09) * w);
    j.spine.rotateY(-cycle * 0.045 * w * (ledge ? 0 : 1));
    j.head.rotateX((ledge ? -0.08 : 0.04) * w);
    this.footOrientation.copy(body);
    if (!perch && !vault) {
      this.up.set(0, 1, 0).applyQuaternion(body);
      this.align.setFromUnitVectors(this.up, this.normal);
      this.align.slerp(
        IDENTITY,
        1 - w * (ledge ? clamp((s.top - root.position.y + 0.25) / 1.1) : 1),
      );
      this.footOrientation.premultiply(this.align).normalize();
    }
    for (let i = 0; i < 2; i++) {
      const side = SIDES[i],
        sign = i === 0 ? -1 : 1,
        striking = Boolean(
          combat?.attack.active &&
            !combat.attack.cancelled &&
            combat.currentTechnique?.side === side,
        );
      const stride = Math.sin(this.phase + i * Math.PI);
      if (!active && this.animator.footList[i].planted) {
        const foot = this.animator.footList[i];
        this.animator.ik.solve(side, foot.target, foot.yaw, body);
      } else if (!(striking && combat.currentTechnique.action === "kick")) {
        if (perch)
          this.target
            .set(s.x, s.top + 0.1, s.z)
            .addScaledVector(this.tangent, sign * 0.08);
        else
          this.target
            .copy(root.position)
            .addScaledVector(this.normal, -this.reach * 0.9)
            .addScaledVector(
              this.tangent,
              sign * (0.15 + 0.1 * this.wallRunWeight),
            );
        if (!perch)
          this.target.y =
            root.position.y +
            (vault
              ? 0.28 + 0.2 * Math.max(0, stride)
              : ledge
                ? 0.16
                : 0.18 + 0.16 * Math.max(0, stride));
        j[`${side}Ankle`].getWorldPosition(this.actual);
        this.target.lerpVectors(this.actual, this.target, w);
        this.animator.ik.solve(side, this.target, this.footOrientation, body);
      }
      if (
        !combat?.blocking &&
        !(striking && combat.currentTechnique.action === "punch")
      ) {
        if (perch) {
          j[`${side}Shoulder`].rotateZ(-sign * 0.4 * w);
          j[`${side}Elbow`].rotateX(0.15 * w);
          continue;
        }
        this.target
          .copy(root.position)
          .addScaledVector(this.normal, -this.reach)
          .addScaledVector(
            this.tangent,
            sign * (s.kind === "pole" ? 0.08 : 0.23),
          );
        this.target.y =
          ledge || vault
            ? s.top + 0.035
            : root.position.y + 1.4 + stride * 0.15;
        const handWeight = vault
          ? w * clamp((s.top + 0.2 - root.position.y) / 0.6)
          : ledge
            ? w * clamp((s.top + 0.2 - root.position.y) / 1.1)
            : w;
        j[`${side}Hand`].getWorldPosition(this.actual);
        this.target.lerpVectors(this.actual, this.target, handWeight);
        this.arms.solve(side, this.target, body);
      }
    }
  }
  reset() {
    this.weight = 0;
    this.surface = null;
    this.phase = this.lastDistance = this.wallRunWeight = 0;
  }
}
