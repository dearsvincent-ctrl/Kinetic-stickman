import * as THREE from "three";

/**
 * A small, named transform rig. World translation/yaw belong to root; animation
 * owns only the joints below it. All dimensions are in metres; forward is -Z.
 */
export class Stickman {
  constructor() {
    this.root = new THREE.Group();
    this.root.name = "stickman";
    this.joints = {};
    this.dimensions = {
      height: 1.98,
      hipHeight: 0.97,
      upperLeg: 0.44,
      lowerLeg: 0.43,
      ankleHeight: 0.1,
    };

    const ivory = new THREE.MeshStandardMaterial({
      color: 0xede5d4,
      roughness: 0.62,
      metalness: 0.1,
    });
    const graphite = new THREE.MeshStandardMaterial({
      color: 0x303c3b,
      roughness: 0.72,
      metalness: 0.18,
    });
    const orange = new THREE.MeshStandardMaterial({
      color: 0xf58144,
      roughness: 0.54,
      metalness: 0.12,
    });
    const visor = new THREE.MeshStandardMaterial({
      color: 0x202d2c,
      roughness: 0.33,
      metalness: 0.3,
    });
    const sphereGeometry = new THREE.SphereGeometry(1, 12, 8);
    const rodGeometry = new THREE.CylinderGeometry(1, 1, 1, 10);

    const mesh = (geometry, material, parent) => {
      const part = new THREE.Mesh(geometry, material);
      part.castShadow = true;
      part.receiveShadow = true;
      parent.add(part);
      return part;
    };
    const joint = (name, parent, x, y, z = 0, radius = 0.075) => {
      const group = new THREE.Group();
      group.name = name;
      group.position.set(x, y, z);
      parent.add(group);
      this.joints[name] = group;
      if (radius > 0)
        mesh(sphereGeometry, graphite, group).scale.setScalar(radius);
      return group;
    };
    const rod = (parent, length, radius, material = ivory) => {
      const part = mesh(rodGeometry, material, parent);
      part.scale.set(radius, length, radius);
      part.position.y = -length / 2;
      return part;
    };
    const crossbar = (parent, width, y, radius) => {
      const part = rod(parent, width, radius);
      part.rotation.z = Math.PI / 2;
      part.position.set(0, y, 0);
    };

    const hips = joint(
      "hips",
      this.root,
      0,
      this.dimensions.hipHeight,
      0,
      0.105,
    );
    crossbar(hips, 0.3, 0, 0.065);
    const spine = joint("spine", hips, 0, 0.07, 0, 0);
    const torso = rod(spine, 0.43, 0.09);
    torso.position.y = 0.215;
    crossbar(spine, 0.48, 0.41, 0.062);
    // One restrained colour cue helps the moving silhouette read on the floor.
    const chestMark = mesh(
      new THREE.BoxGeometry(0.09, 0.15, 0.025),
      orange,
      spine,
    );
    chestMark.position.set(0, 0.3, -0.087);
    const neck = joint("neck", spine, 0, 0.49, 0, 0.055);
    const head = joint("head", neck, 0, 0.21, 0, 0);
    const skull = mesh(sphereGeometry, ivory, head);
    skull.scale.set(0.18, 0.19, 0.175);
    const face = mesh(new THREE.BoxGeometry(0.2, 0.046, 0.035), visor, head);
    face.position.set(0, 0.018, -0.156);
    const headStripe = mesh(
      new THREE.BoxGeometry(0.033, 0.1, 0.014),
      orange,
      head,
    );
    headStripe.position.set(0, 0.11, -0.144);

    for (const [side, sign] of [
      ["left", -1],
      ["right", 1],
    ]) {
      const shoulder = joint(
        `${side}Shoulder`,
        spine,
        sign * 0.25,
        0.41,
        0,
        0.082,
      );
      rod(shoulder, 0.32, 0.058);
      const elbow = joint(`${side}Elbow`, shoulder, 0, -0.32, 0, 0.07);
      rod(elbow, 0.3, 0.05);
      const hand = joint(`${side}Hand`, elbow, 0, -0.32, 0, 0.062);
      const grip = mesh(sphereGeometry, ivory, hand);
      grip.scale.set(0.058, 0.082, 0.057);

      const hip = joint(`${side}Hip`, hips, sign * 0.15, 0, 0, 0.085);
      rod(hip, this.dimensions.upperLeg, 0.067);
      const knee = joint(
        `${side}Knee`,
        hip,
        0,
        -this.dimensions.upperLeg,
        0,
        0.079,
      );
      rod(knee, this.dimensions.lowerLeg, 0.057);
      const ankle = joint(
        `${side}Ankle`,
        knee,
        0,
        -this.dimensions.lowerLeg,
        0,
        0.061,
      );
      const foot = mesh(
        new THREE.BoxGeometry(0.13, 0.09, 0.26),
        graphite,
        ankle,
      );
      foot.position.set(0, -0.045, -0.055);
      const toe = mesh(
        new THREE.BoxGeometry(0.131, 0.022, 0.048),
        orange,
        ankle,
      );
      toe.position.set(0, -0.048, -0.164);
    }
  }

  dispose() {
    // Geometries/materials are shared by several parts of this character.
    const geometries = new Set();
    const materials = new Set();
    this.root.traverse((part) => {
      if (!part.isMesh) return;
      geometries.add(part.geometry);
      materials.add(part.material);
    });
    geometries.forEach((geometry) => geometry.dispose());
    materials.forEach((material) => material.dispose());
  }
}
