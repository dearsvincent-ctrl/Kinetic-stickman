import * as THREE from "three";
import { ENEMY_LIMITS } from "../sandbox/EnemySettings.js";
const SIDES = [-1, 1];

/** Four instanced draws for the experimental crowd beyond the detailed rigs.
 * Only presentation is simplified: health, collision and strike timing remain
 * the same simulated agents. No per-frame geometries/materials/objects. */
export class EnemyCrowdViews {
  constructor(scene) {
    this.group = new THREE.Group();
    this.group.name = "EnemyCrowdLOD";
    scene.add(this.group);
    this.sphere = new THREE.SphereGeometry(1, 8, 6);
    this.rod = new THREE.CylinderGeometry(1, 1, 1, 6);
    this.plane = new THREE.PlaneGeometry(1, 1);
    this.material = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.backMaterial = new THREE.MeshBasicMaterial({
      color: 0x351f24,
      depthTest: false,
    });
    this.fillMaterial = new THREE.MeshBasicMaterial({
      color: 0xe99669,
      depthTest: false,
    });
    const mesh = (geometry, material, count) => {
      const m = new THREE.InstancedMesh(geometry, material, count);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.frustumCulled = false;
      m.count = 0;
      this.group.add(m);
      return m;
    };
    this.heads = mesh(this.sphere, this.material, ENEMY_LIMITS.population);
    this.rods = mesh(this.rod, this.material, ENEMY_LIMITS.population * 9);
    this.backs = mesh(this.plane, this.backMaterial, ENEMY_LIMITS.population);
    this.fills = mesh(this.plane, this.fillMaterial, ENEMY_LIMITS.population);
    this.matrix = new THREE.Matrix4();
    this.q = new THREE.Quaternion();
    this.scale = new THREE.Vector3();
    this.a = new THREE.Vector3();
    this.b = new THREE.Vector3();
    this.mid = new THREE.Vector3();
    this.direction = new THREE.Vector3();
    this.up = new THREE.Vector3(0, 1, 0);
    this.color = new THREE.Color();
    this.phases = new Float64Array(ENEMY_LIMITS.population);
  }
  begin() {
    this.heads.count =
      this.rods.count =
      this.backs.count =
      this.fills.count =
        0;
  }
  point(out, x, y, z) {
    return out.set(
      this.p.x + x * this.cos + z * this.sin,
      this.p.y + y,
      this.p.z - x * this.sin + z * this.cos,
    );
  }
  segment(x, y, z, bx, by, bz, r = 0.055) {
    this.point(this.a, x, y, z);
    this.point(this.b, bx, by, bz);
    this.direction.subVectors(this.b, this.a);
    const length = Math.max(1e-5, this.direction.length());
    this.q.setFromUnitVectors(this.up, this.direction.divideScalar(length));
    this.mid.addVectors(this.a, this.b).multiplyScalar(0.5);
    this.scale.set(r, length, r);
    this.matrix.compose(this.mid, this.q, this.scale);
    this.rods.setMatrixAt(this.rods.count, this.matrix);
    this.rods.setColorAt(this.rods.count++, this.color);
  }
  add(agent, dt, camera) {
    this.p = agent.root.position;
    this.sin = Math.sin(agent.controller.heading);
    this.cos = Math.cos(agent.controller.heading);
    this.phases[agent.index] =
      (this.phases[agent.index] +
        Math.min(24, agent.controller.speed * 3) * dt) %
      (Math.PI * 2);
    const phase = this.phases[agent.index],
      swing =
        Math.sin(phase) * 0.24 * Math.min(1, agent.controller.speed / 2.6);
    const fall = agent.body.active ? 0 : Math.min(0.75, agent.defeatTime);
    const hip = 0.97 - fall,
      shoulder = 1.45 - fall;
    const extension = agent.combat.attack.active
      ? agent.combat.attack.extension
      : 0;
    const punch =
      agent.combat.currentTechnique?.action === "punch" ? extension : 0;
    const kick =
      agent.combat.currentTechnique?.action === "kick" ? extension : 0;
    this.color.setHex(agent.body.flash > 0 ? 0xffffff : 0xb85f51);
    this.q.identity();
    this.point(this.mid, 0, 1.78 - fall, -0.03);
    this.scale.set(0.17, 0.19, 0.17);
    this.matrix.compose(this.mid, this.q, this.scale);
    this.heads.setMatrixAt(this.heads.count, this.matrix);
    this.heads.setColorAt(this.heads.count++, this.color);
    this.segment(0, hip, 0, 0, shoulder, -0.02, 0.09);
    for (const side of SIDES) {
      const striking = side === 1;
      const elbowZ = -swing * side - (striking ? punch * 0.3 : 0);
      const handZ = -swing * side - (striking ? punch * 0.64 : 0);
      this.segment(
        side * 0.25,
        shoulder,
        0,
        side * 0.29,
        shoulder - 0.28 + punch * (striking ? 0.22 : 0),
        elbowZ,
      );
      this.segment(
        side * 0.29,
        shoulder - 0.28 + punch * (striking ? 0.22 : 0),
        elbowZ,
        side * 0.26,
        shoulder - 0.6 + punch * (striking ? 0.6 : 0),
        handZ,
        0.05,
      );
      const legKick = striking ? kick : 0,
        kneeY = hip - 0.43 + legKick * 0.37,
        kneeZ = swing * side - legKick * 0.38;
      const footZ = swing * side - legKick * 0.78,
        footY = 0.1 + Math.max(0, -swing * side) * 0.4 + legKick * 0.85;
      this.segment(side * 0.15, hip, 0, side * 0.16, kneeY, kneeZ, 0.07);
      this.segment(side * 0.16, kneeY, kneeZ, side * 0.16, footY, footZ, 0.06);
    }
    if (agent.body.active) {
      this.mid.copy(this.p);
      this.mid.y += 2.3;
      this.scale.set(0.8, 0.065, 1);
      this.matrix.compose(this.mid, camera.quaternion, this.scale);
      this.backs.setMatrixAt(this.backs.count++, this.matrix);
      const ratio = Math.max(0, agent.body.health / agent.body.maxHealth);
      this.a
        .set(-0.4 * (1 - ratio), 0, 0.002)
        .applyQuaternion(camera.quaternion);
      this.mid.add(this.a);
      this.scale.x *= ratio;
      this.matrix.compose(this.mid, camera.quaternion, this.scale);
      this.fills.setMatrixAt(this.fills.count++, this.matrix);
    }
  }
  end() {
    for (const m of this.group.children) {
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  }
  dispose() {
    this.group.removeFromParent();
    for (const m of this.group.children) m.dispose();
    for (const r of [
      this.sphere,
      this.rod,
      this.plane,
      this.material,
      this.backMaterial,
      this.fillMaterial,
    ])
      r.dispose();
  }
}
