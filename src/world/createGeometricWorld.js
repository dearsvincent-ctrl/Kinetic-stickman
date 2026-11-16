import * as THREE from "three";
import { GEOMETRIC_WORLD_STRUCTURES } from "./GeometricWorldLayout.js";
const COLORS = Object.freeze({
  city: 0x637e87,
  bridge: 0xd0b08b,
  barrier: 0xc57c4c,
  trunk: 0x6e6651,
  canopy: 0x52785d,
  branch: 0x99a87a,
  pole: 0x8d9a80,
});

/** A handful of spatially culled, static instance batches. Their dimensions
 * come directly from playable colliders; there is no scenery update loop. */
export function createGeometricWorld(
  scene,
  structures = GEOMETRIC_WORLD_STRUCTURES,
) {
  const group = new THREE.Group();
  group.name = "geometric-world";
  scene.add(group);
  const box = new THREE.BoxGeometry(1, 1, 1),
    cylinder = new THREE.CylinderGeometry(1, 1, 1, 10),
    material = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 1,
    });
  const chunks = new Map(),
    matrix = new THREE.Matrix4(),
    p = new THREE.Vector3(),
    scale = new THREE.Vector3(),
    q = new THREE.Quaternion(),
    color = new THREE.Color();
  for (const s of structures) {
    const x = s.kind === "pole" ? s.x : (s.minX + s.maxX) / 2,
      z = s.kind === "pole" ? s.z : (s.minZ + s.maxZ) / 2,
      key = `${Math.floor(x / 160)},${Math.floor(z / 160)},${s.kind}`;
    let a = chunks.get(key);
    if (!a) chunks.set(key, (a = []));
    a.push(s);
  }
  for (const [key, items] of chunks) {
    const pole = items[0].kind === "pole",
      mesh = new THREE.InstancedMesh(
        pole ? cylinder : box,
        material,
        items.length * (pole ? 1 : 2),
      );
    mesh.name = `world-chunk-${key}`;
    mesh.userData.colliderIds = items.map((s) => s.id);
    items.forEach((s, i) => {
      p.set(
        pole ? s.x : (s.minX + s.maxX) / 2,
        (s.bottom + s.top) / 2,
        pole ? s.z : (s.minZ + s.maxZ) / 2,
      );
      scale.set(
        pole ? s.radius : s.maxX - s.minX,
        s.top - s.bottom,
        pole ? s.radius : s.maxZ - s.minZ,
      );
      matrix.compose(p, q, scale);
      mesh.setMatrixAt(i, matrix);
      mesh.setColorAt(i, color.setHex(COLORS[s.style]));
      if (!pole) {
        p.y = s.top + 0.006;
        scale.y = 0.012;
        matrix.compose(p, q, scale);
        mesh.setMatrixAt(i + items.length, matrix);
        mesh.setColorAt(
          i + items.length,
          color.setHex(s.zone === "city" ? 0xa5b8b8 : 0x96b477),
        );
      }
    });
    mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    group.add(mesh);
  }
  const points = [];
  for (const sign of [-1, 1])
    for (let i = 0; i < 16; i++) {
      const x = sign * (18 + i * 6),
        z = -8 - i * 5;
      points.push(x, 0.016, z, x + sign * 1.4, 0.016, z - 1.2);
    }
  const guideGeometry = new THREE.BufferGeometry();
  guideGeometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(points, 3),
  );
  const guideMaterial = new THREE.LineBasicMaterial({
    color: 0xc4ac82,
    transparent: true,
    opacity: 0.6,
  });
  group.add(new THREE.LineSegments(guideGeometry, guideMaterial));
  const labels = [];
  for (const [text, x, z, c] of [
    ["BLOCK CITY / 320 M", -120, -78, "#d6b28e"],
    ["GEOMETRIC JUNGLE", 135, -78, "#b7d29b"],
  ]) {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 96;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = c;
    ctx.font = "600 34px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(text, 256, 58);
    const texture = new THREE.CanvasTexture(canvas),
      m = new THREE.SpriteMaterial({ map: texture, depthWrite: false }),
      label = new THREE.Sprite(m);
    label.position.set(x, 6, z);
    label.scale.set(24, 4.5, 1);
    group.add(label);
    labels.push({ texture, m });
  }
  return {
    group,
    structures,
    dispose() {
      scene.remove(group);
      box.dispose();
      cylinder.dispose();
      material.dispose();
      guideGeometry.dispose();
      guideMaterial.dispose();
      for (const l of labels) {
        l.texture.dispose();
        l.m.dispose();
      }
    },
  };
}
