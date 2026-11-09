import {
  InstancedMesh,
  PlaneGeometry,
  MeshBasicMaterial,
  DoubleSide,
  DynamicDrawUsage,
  Object3D,
} from "three";
/** Fixed pool, one instanced draw call; no particle objects or per-frame allocations. */
export class GroundStreaks {
  constructor(capacity = 16) {
    this.capacity = capacity;
    this.cursor = 0;
    this.emissions = 0;
    this.mesh = new InstancedMesh(
      new PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      new MeshBasicMaterial({
        color: 0xc1ad8c,
        transparent: true,
        opacity: 0.23,
        depthWrite: false,
        side: DoubleSide,
      }),
      capacity,
    );
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.name = "footPlantStreaks";
    this.items = Array.from({ length: capacity }, () => ({
      age: 1,
      life: 0.4,
      x: 0,
      z: 0,
      yaw: 0,
      width: 0,
      length: 0,
    }));
    this.scratch = new Object3D();
    this.reset();
  }
  emit(point, direction, intensity, speed) {
    if (
      !Number.isFinite(intensity) ||
      !Number.isFinite(speed) ||
      intensity < 0.32 ||
      speed < 2.5
    )
      return;
    this.emissions++;
    const force = Math.min(1, intensity),
      count = force > 0.72 ? 6 : 3;
    for (let i = 0; i < count; i++) {
      const p = this.items[this.cursor++ % this.capacity],
        a = Math.atan2(direction.x, direction.z) + (i - (count - 1) / 2) * 0.18;
      p.age = 0;
      p.life = 0.28 + 0.18 * force;
      p.x = point.x + Math.cos(a) * (0.03 + i * 0.015);
      p.z = point.z - Math.sin(a) * (0.03 + i * 0.015);
      p.yaw = a;
      p.width = 0.025 + 0.045 * force;
      p.length =
        0.16 + 0.85 * force * Math.min(1, Math.log2(1 + speed / 5.2) / 3);
    }
    this.mesh.visible = true;
  }
  update(dt) {
    let alive = false;
    for (let i = 0; i < this.capacity; i++) {
      const p = this.items[i];
      p.age += dt;
      const t = Math.min(1, p.age / p.life),
        fade = (1 - t) * (1 - t);
      alive ||= t < 1;
      this.scratch.position.set(p.x, 0.018, p.z);
      this.scratch.rotation.set(0, p.yaw, 0);
      this.scratch.scale.set(
        p.width * fade,
        1,
        p.length * (0.7 + 0.3 * t) * fade,
      );
      this.scratch.updateMatrix();
      this.mesh.setMatrixAt(i, this.scratch.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.visible = alive;
  }
  reset() {
    for (const p of this.items) p.age = p.life;
    this.update(0);
  }
  dispose() {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
