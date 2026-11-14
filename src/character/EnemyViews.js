import * as THREE from "three";
import { Stickman } from "./Stickman.js";
import { CharacterAnimator } from "./CharacterAnimator.js";

/** Bounded rig pool. Limb meshes share their expensive geometries/materials;
 * distant fighters skip presentation work while simulation keeps pursuing. */
export class EnemyViews {
  constructor(scene, agents) {
    this.barGeometry = new THREE.PlaneGeometry(0.8, 0.065);
    this.barBackground = new THREE.MeshBasicMaterial({
      color: 0x351f24,
      depthTest: false,
    });
    this.barFill = new THREE.MeshBasicMaterial({
      color: 0xe99669,
      depthTest: false,
    });
    this.barFlash = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      depthTest: false,
    });
    let resources = null;
    this.views = agents.map((agent) => {
      const character = new Stickman({ resources });
      if (!resources) {
        resources = character.resources;
        resources.ivory.color.setHex(0xb85f51);
        resources.orange.color.setHex(0xffd088);
      }
      // Give the animator the actual world-travel root, preserving local joints.
      for (const child of [...character.root.children]) agent.root.add(child);
      character.root = agent.root;
      agent.root.visible = false;
      scene.add(agent.root);
      const bar = new THREE.Group();
      bar.position.y = 2.3;
      const background = new THREE.Mesh(this.barGeometry, this.barBackground);
      const fill = new THREE.Mesh(this.barGeometry, this.barFill);
      fill.position.z = 0.002;
      bar.add(background, fill);
      agent.root.add(bar);
      return {
        agent,
        character,
        animator: new CharacterAnimator(character),
        bar,
        fill,
        elapsed: 0,
      };
    });
    this.inverse = new THREE.Quaternion();
  }
  update(dt, camera, playerPosition) {
    for (const v of this.views) {
      const { agent: a, character: c } = v;
      const distance = a.root.position.distanceToSquared(playerPosition);
      a.root.visible =
        a.spawned &&
        (a.body.active || a.defeatTime < 2) &&
        distance < 220 * 220;
      if (!a.root.visible) continue;
      v.elapsed += dt;
      if (v.generation !== a.body.id) {
        v.generation = a.body.id;
        v.animator.initialized = false;
        v.animator.previousPosition.copy(a.root.position);
      }
      if (distance < 65 * 65 || v.elapsed > 0.1) {
        v.animator.update(v.elapsed, {
          speed: a.controller.speed,
          combat: a.combat,
          jump: a.controller.jump,
        });
        v.elapsed = 0;
      }
      // Additive, short reaction after the authored pose. Root physics stays free.
      if (!a.body.active) {
        c.joints.hips.rotation.z = -Math.min(1.5, a.defeatTime * 5);
        c.joints.hips.position.y = Math.max(0.25, 0.97 - a.defeatTime * 1.5);
      } else if (a.body.stagger > 0) {
        c.joints.spine.rotation.x -=
          Math.sin((a.body.stagger / 0.24) * Math.PI) * 0.32;
      }
      v.bar.visible = a.body.active;
      this.inverse.copy(a.root.quaternion).invert();
      v.bar.quaternion.copy(this.inverse).multiply(camera.quaternion);
      const ratio = Math.max(0, a.body.health / a.body.maxHealth);
      v.fill.scale.x = ratio;
      v.fill.position.x = -0.4 * (1 - ratio);
      v.fill.material = a.body.flash > 0 ? this.barFlash : this.barFill;
    }
  }
  dispose() {
    // Dispose shared resources after their last user.
    for (let i = this.views.length - 1; i >= 0; i--) {
      this.views[i].bar.removeFromParent();
      this.views[i].character.dispose();
      this.views[i].agent.root.removeFromParent();
    }
    this.barGeometry.dispose();
    this.barBackground.dispose();
    this.barFill.dispose();
    this.barFlash.dispose();
  }
}
