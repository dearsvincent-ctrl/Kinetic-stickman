import * as THREE from "three";
import { Stickman } from "./Stickman.js";
import { CharacterAnimator } from "./CharacterAnimator.js";
import { EnemyCrowdViews } from "./EnemyCrowdViews.js";
import { ParkourPresenter } from "./ParkourPresenter.js";
import { ENEMY_LIMITS } from "../sandbox/EnemySettings.js";

const PROFILE_IDS = ["standard", "acrobat", "leaper", "heavy"];
const DEFAULT_COLOR = 0xb85f51;

/** Bounded rig pool. Limb meshes share their expensive geometries/materials;
 * distant fighters skip presentation work while simulation keeps pursuing. */
export class EnemyViews {
  constructor(scene, agents) {
    this.scene = scene;
    this.agents = agents;
    this.crowd = new EnemyCrowdViews(scene);
    this.fullIndices = new Int16Array(ENEMY_LIMITS.fullRigs);
    this.fullDistances = new Float64Array(ENEMY_LIMITS.fullRigs);
    this.detailMask = new Uint8Array(ENEMY_LIMITS.population);
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
    this.resources = null;
    this.palette = new Map();
    this.views = [];
    this.syncAgents();
    this.inverse = new THREE.Quaternion();
    this.body = new THREE.Quaternion();
  }
  syncAgents() {
    while (this.views.length < this.agents.length) {
      const agent = this.agents[this.views.length];
      const character = new Stickman({ resources: this.resources });
      if (!this.resources) {
        // The pool owns its shared resources separately from each rig's
        // appearance references, which may change when a slot is reused.
        this.resources = { ...character.resources };
        this.resources.ivory.color.setHex(DEFAULT_COLOR);
        this.resources.orange.color.setHex(0xffd088);
        this.palette.set("standard", this.resources.ivory);
      }
      const bodyParts = [];
      character.root.traverse((part) => {
        if (part.isMesh && part.material === this.resources.ivory)
          bodyParts.push(part);
      });
      // Give the animator the actual world-travel root, preserving local joints.
      for (const child of [...character.root.children]) agent.root.add(child);
      character.root = agent.root;
      agent.root.visible = false;
      this.scene.add(agent.root);
      const bar = new THREE.Group();
      bar.position.y = 2.3;
      const background = new THREE.Mesh(this.barGeometry, this.barBackground);
      const fill = new THREE.Mesh(this.barGeometry, this.barFill);
      fill.position.z = 0.002;
      bar.add(background, fill);
      agent.root.add(bar);
      const animator = new CharacterAnimator(character);
      const view = {
        agent,
        character,
        animator,
        parkour: new ParkourPresenter(character, animator),
        bodyParts,
        bar,
        fill,
        elapsed: 0,
      };
      this.applyAppearance(view);
      this.views.push(view);
    }
  }
  applyAppearance(view) {
    const profile = view.agent.profile;
    const id = PROFILE_IDS.includes(profile?.id) ? profile.id : "standard";
    const color = Number.isInteger(profile?.color)
      ? profile.color & 0xffffff
      : DEFAULT_COLOR;
    let material = this.palette.get(id);
    if (!material) {
      material = this.resources.ivory.clone();
      this.palette.set(id, material);
    }
    if (material.color.getHex() !== color) material.color.setHex(color);
    if (view.profileId !== id) {
      for (const part of view.bodyParts) part.material = material;
      view.character.resources.ivory = material;
      view.profileId = id;
    }
  }
  update(dt, camera, playerPosition) {
    this.syncAgents();
    this.fullIndices.fill(-1);
    this.fullDistances.fill(Infinity);
    this.detailMask.fill(0);
    for (let i = 0; i < this.views.length; i++) {
      const a = this.views[i].agent;
      if (!a.spawned || (!a.body.active && a.defeatTime >= 2)) continue;
      const distance = a.root.position.distanceToSquared(playerPosition);
      for (let j = 0; j < this.fullIndices.length; j++)
        if (distance < this.fullDistances[j]) {
          for (let k = this.fullIndices.length - 1; k > j; k--) {
            this.fullIndices[k] = this.fullIndices[k - 1];
            this.fullDistances[k] = this.fullDistances[k - 1];
          }
          this.fullIndices[j] = i;
          this.fullDistances[j] = distance;
          break;
        }
    }
    for (const i of this.fullIndices) if (i >= 0) this.detailMask[i] = 1;
    this.crowd.begin();
    for (const v of this.views) {
      const { agent: a, character: c } = v;
      this.applyAppearance(v);
      const distance = a.root.position.distanceToSquared(playerPosition);
      const visible =
        a.spawned &&
        (a.body.active || a.defeatTime < 2) &&
        distance < 220 * 220;
      a.root.visible = visible && Boolean(this.detailMask[a.index]);
      if (!visible) continue;
      if (!a.root.visible) {
        this.crowd.add(a, dt, camera);
        continue;
      }
      v.elapsed += dt;
      if (v.generation !== a.body.id) {
        v.generation = a.body.id;
        v.animator.initialized = false;
        v.animator.previousPosition.copy(a.root.position);
        v.parkour.reset();
      }
      if (distance < 65 * 65 || v.elapsed > 0.1) {
        v.animator.update(v.elapsed, {
          speed: a.controller.speed,
          combat: a.combat,
          jump: a.controller.jump,
          sandbox: a.controller.speed > 5.2,
        });
        a.root.getWorldQuaternion(this.body);
        v.parkour.apply(v.elapsed, a.controller.parkour, this.body, a.combat);
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
    this.crowd.end();
  }
  dispose() {
    this.crowd.dispose();
    // Dispose shared resources after their last user.
    for (let i = this.views.length - 1; i >= 0; i--) {
      this.views[i].bar.removeFromParent();
      // Per-rig box geometries are private, but primitives and palette
      // materials belong to this pool and are disposed once below.
      this.views[i].character.sharedResources = true;
      this.views[i].character.dispose();
      this.views[i].agent.root.removeFromParent();
    }
    this.barGeometry.dispose();
    this.barBackground.dispose();
    this.barFill.dispose();
    this.barFlash.dispose();
    if (this.resources)
      for (const resource of new Set([
        ...Object.values(this.resources),
        ...this.palette.values(),
      ]))
        resource.dispose();
    this.palette.clear();
  }
}
