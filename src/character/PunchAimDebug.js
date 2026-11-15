import * as THREE from "three";
import { StrikePoseSampler } from "../combat/TechniqueGeometry.js";
import { strikeAim } from "../combat/PunchAlignment.js";

/** Optional shared-sampler visualization. Hidden mode performs no pose work. */
export class PunchAimDebug {
  constructor(scene, assist) {
    this.assist = assist;
    this.group = new THREE.Group();
    this.group.name = "PunchAimDebug";
    this.group.visible = false;
    this.sampler = new StrikePoseSampler();
    this.point = new THREE.Vector3();
    this.baselineContext = {};
    this.lines = [0x73baf0, 0xff9b57].map((color) => {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute(
        "position",
        new THREE.BufferAttribute(new Float32Array(9 * 3), 3),
      );
      const line = new THREE.Line(
        geometry,
        new THREE.LineBasicMaterial({ color, depthTest: false }),
      );
      line.frustumCulled = false;
      line.renderOrder = 20;
      this.group.add(line);
      return line;
    });
    this.marker = new THREE.Mesh(
      new THREE.SphereGeometry(0.3, 8, 6),
      new THREE.MeshBasicMaterial({
        color: 0xffd28d,
        wireframe: true,
        depthTest: false,
      }),
    );
    this.group.add(this.marker);
    scene.add(this.group);
  }
  update(combat, root, orientation, lift = 0) {
    const t = combat.currentTechnique,
      attack = combat.attack;
    this.group.visible =
      this.assist.config.debug &&
      attack.active &&
      !attack.cancelled &&
      (t?.action === "punch" || t?.action === "kick");
    if (!this.group.visible) return;
    this.baselineContext.limbs = attack.context?.limbs;
    this.baselineContext.transition = attack.context?.transition;
    for (let l = 0; l < 2; l++) {
      const attribute = this.lines[l].geometry.attributes.position;
      for (let i = 0; i < 9; i++) {
        this.sampler.sample(
          this.point,
          root,
          0,
          t,
          t.windup + ((t.extension + t.impact) * i) / 8,
          l ? attack.context : this.baselineContext,
          orientation,
          lift,
        );
        attribute.setXYZ(i, this.point.x, this.point.y, this.point.z);
      }
      attribute.needsUpdate = true;
    }
    const aim = strikeAim(attack.context, t);
    const candidate =
      aim && this.assist.targets.find((e) => (e.body ?? e).id === aim.targetId);
    const body = candidate?.body ?? candidate;
    this.marker.visible = !!body?.active;
    if (this.marker.visible) {
      this.marker.position.copy(body.position);
      this.marker.position.y += aim.targetHeight;
    }
  }
  dispose() {
    for (const line of this.lines) {
      line.geometry.dispose();
      line.material.dispose();
    }
    this.marker.geometry.dispose();
    this.marker.material.dispose();
    this.group.removeFromParent();
  }
}
