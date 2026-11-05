import * as THREE from "three";

export const TRAINING_DUMMY_CONFIG = Object.freeze({
  id: "training-dummy",
  x: 2,
  z: -5,
  radius: 0.32,
  height: 1.8,
});

/** A stationary target prop. Its circular base is the collision footprint;
 * targeting and a future physics adapter share the same position and radius.
 */
export class TrainingDummy {
  constructor() {
    const config = TRAINING_DUMMY_CONFIG;
    this.root = new THREE.Group();
    this.root.name = "TrainingDummy";
    this.root.position.set(config.x, 0, config.z);
    this.target = {
      id: config.id,
      position: this.root.position,
      radius: config.radius,
      active: true,
    };

    const graphite = new THREE.MeshStandardMaterial({
      color: 0x253638,
      roughness: 0.82,
    });
    const orange = new THREE.MeshStandardMaterial({
      color: 0xe28b4d,
      roughness: 0.74,
    });
    const ivory = new THREE.MeshStandardMaterial({
      color: 0xe4dfc9,
      roughness: 0.8,
    });
    this.markerMaterial = ivory;
    this.targeted = false;
    const cylinder = new THREE.CylinderGeometry(1, 1, 1, 12);
    const part = (geometry, material, scale, position) => {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.scale.set(...scale);
      mesh.position.set(...position);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.root.add(mesh);
      return mesh;
    };
    part(
      cylinder,
      graphite,
      [config.radius, 0.14, config.radius],
      [0, 0.07, 0],
    );
    part(
      cylinder,
      orange,
      [config.radius, 0.024, config.radius],
      [0, 0.152, 0],
    );
    part(cylinder, graphite, [0.075, 0.76, 0.075], [0, 0.54, 0]);
    part(
      new THREE.CylinderGeometry(0.22, 0.26, 0.68, 12),
      orange,
      [1, 1, 1],
      [0, 1.22, 0],
    );
    part(
      new THREE.SphereGeometry(0.16, 12, 8),
      graphite,
      [1, 1, 1],
      [0, 1.64, 0],
    );
    const target = part(
      new THREE.RingGeometry(0.105, 0.13, 16),
      ivory,
      [1, 1, 1],
      [0, 1.3, 0.244],
    );
    target.castShadow = false;
    // A second small bullseye distinguishes this passive prop from a fighter.
    const center = part(
      new THREE.CircleGeometry(0.026, 12),
      ivory,
      [1, 1, 1],
      [0, 1.3, 0.245],
    );
    center.castShadow = false;
  }

  setTargeted(selected) {
    if (this.targeted === Boolean(selected)) return;
    this.targeted = Boolean(selected);
    this.markerMaterial.color.setHex(this.targeted ? 0xcce9b5 : 0xe4dfc9);
    this.markerMaterial.emissive.setHex(this.targeted ? 0x63804b : 0x000000);
    this.markerMaterial.emissiveIntensity = this.targeted ? 0.25 : 0;
  }

  dispose() {
    const geometries = new Set();
    const materials = new Set();
    this.root.traverse((part) => {
      if (part.geometry) geometries.add(part.geometry);
      if (part.material) materials.add(part.material);
    });
    geometries.forEach((geometry) => geometry.dispose());
    materials.forEach((material) => material.dispose());
    this.root.removeFromParent();
  }
}
