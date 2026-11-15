import * as THREE from "three";
import { TRAVERSAL_STRUCTURES } from "./TraversalGeometry.js";
/** A small authored test cluster. Collision and meshes share one description. */
export function createTraversalArea(scene) {
  const group = new THREE.Group();
  group.name = "traversal-test-area";
  scene.add(group);
  const geometry = new THREE.BoxGeometry(1, 1, 1),
    matrix = new THREE.Matrix4(),
    position = new THREE.Vector3(),
    scale = new THREE.Vector3(),
    q = new THREE.Quaternion();
  const boxes = TRAVERSAL_STRUCTURES.filter((s) => s.kind === "box"),
    poles = TRAVERSAL_STRUCTURES.filter((s) => s.kind === "pole");
  const concrete = new THREE.MeshStandardMaterial({
    color: "#59706c",
    roughness: 0.95,
  });
  const trim = new THREE.MeshStandardMaterial({
    color: "#d4a477",
    roughness: 0.85,
  });
  const roofMaterial = new THREE.MeshStandardMaterial({
    color: "#a7b6a4",
    roughness: 1,
  });
  const batch = (geo, material, transforms) => {
    const mesh = new THREE.InstancedMesh(geo, material, transforms.length);
    transforms.forEach((t, i) => {
      position.fromArray(t.p);
      scale.fromArray(t.s);
      matrix.compose(position, q, scale);
      mesh.setMatrixAt(i, matrix);
    });
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  };
  batch(
    geometry,
    concrete,
    boxes.map((s) => ({
      p: [(s.minX + s.maxX) / 2, (s.bottom + s.top) / 2, (s.minZ + s.maxZ) / 2],
      s: [s.maxX - s.minX, s.top - s.bottom, s.maxZ - s.minZ],
    })),
  );
  // Thin coplanar/inset accents only, rather than extra collision ledges.
  batch(
    geometry,
    roofMaterial,
    boxes.map((s) => ({
      p: [(s.minX + s.maxX) / 2, s.top + 0.006, (s.minZ + s.maxZ) / 2],
      s: [s.maxX - s.minX, 0.012, s.maxZ - s.minZ],
    })),
  );
  const marks = [];
  for (const s of boxes) {
    marks.push({
      p: [s.minX - 0.006, s.top - 0.2, (s.minZ + s.maxZ) / 2],
      s: [0.012, 0.12, s.maxZ - s.minZ],
    });
    marks.push({
      p: [(s.minX + s.maxX) / 2, s.top - 0.2, s.maxZ + 0.006],
      s: [s.maxX - s.minX, 0.12, 0.012],
    });
  }
  for (let i = 0; i < 10; i++)
    marks.push({
      p: [4 + i * 4.1, 0.012, -0.5 - i * 2.3],
      s: [0.7, 0.024, 0.22],
    });
  batch(geometry, trim, marks);
  const cylinder = new THREE.CylinderGeometry(1, 1, 1, 12);
  batch(
    cylinder,
    concrete,
    poles.map((s) => ({
      p: [s.x, (s.top + s.bottom) / 2, s.z],
      s: [s.radius, s.top - s.bottom, s.radius],
    })),
  );
  batch(
    cylinder,
    trim,
    poles.map((s) => ({
      p: [s.x, s.top + 0.008, s.z],
      s: [s.radius, 0.016, s.radius],
    })),
  );
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#e3c1a0";
  ctx.font = "600 46px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("TRAVERSAL / 01", 256, 52);
  ctx.font = "24px sans-serif";
  ctx.fillStyle = "#b9ccc0";
  ctx.fillText("APPROACH · CLIMB · JUMP", 256, 94);
  const texture = new THREE.CanvasTexture(canvas),
    label = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
        depthWrite: false,
      }),
    );
  label.position.set(53, 8, -23);
  label.scale.set(9, 2.25, 1);
  group.add(label);
  return {
    group,
    structures: TRAVERSAL_STRUCTURES,
    dispose() {
      scene.remove(group);
      geometry.dispose();
      cylinder.dispose();
      concrete.dispose();
      trim.dispose();
      roofMaterial.dispose();
      label.material.dispose();
      texture.dispose();
    },
  };
}
