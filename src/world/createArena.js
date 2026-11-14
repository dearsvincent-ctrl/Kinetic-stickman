import * as THREE from "three";
import { ARENA_CONFIG } from "./ArenaConfig.js";

const HALF_SIZE = ARENA_CONFIG.halfSize;
const MARKING_HALF_SIZE = 18;
const WALL_HEIGHT = 0.55;
const WALL_THICKNESS = 0.32;

/** Baked floor detail keeps the arena legible without hundreds of grid meshes. */
function createFloorTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 2048;
  const context = canvas.getContext("2d");
  const scale = canvas.width / (MARKING_HALF_SIZE * 2);
  const center = canvas.width / 2;
  const toPixel = (metres) => metres * scale;

  context.fillStyle = "#344747";
  context.fillRect(0, 0, canvas.width, canvas.height);
  const wash = context.createRadialGradient(
    center,
    center,
    0,
    center,
    center,
    center * 1.2,
  );
  wash.addColorStop(0, "rgba(157, 176, 164, 0.09)");
  wash.addColorStop(1, "rgba(7, 18, 22, 0.15)");
  context.fillStyle = wash;
  context.fillRect(0, 0, canvas.width, canvas.height);

  // One-metre grid, with slightly stronger three-metre divisions.
  for (let metre = 0; metre <= MARKING_HALF_SIZE * 2; metre += 1) {
    const pixel = toPixel(metre);
    context.strokeStyle =
      metre % 3 === 0
        ? "rgba(179, 199, 190, 0.13)"
        : "rgba(179, 199, 190, 0.065)";
    context.lineWidth = metre % 3 === 0 ? 1.5 : 1;
    context.beginPath();
    context.moveTo(pixel, 0);
    context.lineTo(pixel, canvas.height);
    context.moveTo(0, pixel);
    context.lineTo(canvas.width, pixel);
    context.stroke();
  }

  // An inset perimeter makes the collision boundary easy to read at ground level.
  const inset = toPixel(0.6);
  context.strokeStyle = "rgba(189, 204, 189, 0.36)";
  context.lineWidth = 3;
  context.strokeRect(
    inset,
    inset,
    canvas.width - inset * 2,
    canvas.height - inset * 2,
  );
  context.strokeStyle = "rgba(207, 217, 202, 0.11)";
  context.lineWidth = 1;
  context.strokeRect(
    inset + 8,
    inset + 8,
    canvas.width - (inset + 8) * 2,
    canvas.height - (inset + 8) * 2,
  );

  context.save();
  context.translate(center, center);
  context.strokeStyle = "rgba(224, 229, 204, 0.52)";
  context.lineWidth = 3;
  context.beginPath();
  context.arc(0, 0, toPixel(3.5), 0, Math.PI * 2);
  context.stroke();
  context.strokeStyle = "rgba(224, 229, 204, 0.15)";
  context.lineWidth = 1;
  context.beginPath();
  context.arc(0, 0, toPixel(3.65), 0, Math.PI * 2);
  context.stroke();

  // Four short orange arc segments and a quiet centre cross orient the player.
  context.strokeStyle = "#d78c54";
  context.lineWidth = 9;
  for (let side = 0; side < 4; side += 1) {
    const angle = (side * Math.PI) / 2;
    context.beginPath();
    context.arc(0, 0, toPixel(3.5), angle - 0.055, angle + 0.055);
    context.stroke();
  }
  context.strokeStyle = "rgba(222, 230, 211, 0.28)";
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(-toPixel(0.25), 0);
  context.lineTo(toPixel(0.25), 0);
  context.moveTo(0, -toPixel(0.25));
  context.lineTo(0, toPixel(0.25));
  context.stroke();

  context.fillStyle = "rgba(220, 229, 209, 0.22)";
  context.textAlign = "center";
  context.font = "600 22px Arial, sans-serif";
  context.fillText("M O V E M E N T   /   T R A I N I N G", 0, -toPixel(4.3));
  context.font = "700 105px Arial, sans-serif";
  context.fillStyle = "rgba(220, 229, 209, 0.12)";
  context.fillText("01", 0, toPixel(6.4));
  context.restore();

  // Sparse survey ticks avoid noisy ground detail on small screens.
  context.fillStyle = "#bd8050";
  for (let index = 1; index < 6; index += 1) {
    const pixel = toPixel(index * 6);
    context.fillRect(pixel - 2, inset - 7, 4, 24);
    context.fillRect(pixel - 2, canvas.height - inset - 17, 4, 24);
    context.fillRect(inset - 7, pixel - 2, 24, 4);
    context.fillRect(canvas.width - inset - 17, pixel - 2, 24, 4);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function instanceBoxes(geometry, material, transforms, parent) {
  const mesh = new THREE.InstancedMesh(geometry, material, transforms.length);
  const dummy = new THREE.Object3D();
  transforms.forEach(
    ({ position, scale = [1, 1, 1], rotationY = 0 }, index) => {
      dummy.position.set(...position);
      dummy.scale.set(...scale);
      dummy.rotation.set(0, rotationY, 0);
      dummy.updateMatrix();
      mesh.setMatrixAt(index, dummy.matrix);
    },
  );
  mesh.instanceMatrix.needsUpdate = true;
  parent.add(mesh);
  return mesh;
}

/**
 * Pure visual arena. The returned dimensions are also the source of truth for
 * the current boundary adapter and can later describe Rapier static colliders.
 */
export function createArena(scene) {
  const group = new THREE.Group();
  group.name = "TrainingArena";
  scene.add(group);
  scene.background = new THREE.Color("#172124");
  scene.fog = new THREE.Fog(
    "#172124",
    ARENA_CONFIG.fogNear,
    ARENA_CONFIG.fogFar,
  );

  const hemisphere = new THREE.HemisphereLight("#e4eeeb", "#263a36", 2.25);
  scene.add(hemisphere);
  const sunlight = new THREE.DirectionalLight("#fff0d5", 2.8);
  sunlight.position.set(-10, 17, 9);
  sunlight.castShadow = true;
  sunlight.shadow.mapSize.set(1024, 1024);
  Object.assign(sunlight.shadow.camera, {
    left: -23,
    right: 23,
    top: 23,
    bottom: -23,
    near: 1,
    far: 65,
  });
  sunlight.shadow.bias = -0.0004;
  sunlight.shadow.normalBias = 0.025;
  sunlight.shadow.camera.updateProjectionMatrix();
  scene.add(sunlight);

  const exterior = new THREE.Mesh(
    new THREE.PlaneGeometry(ARENA_CONFIG.size + 40, ARENA_CONFIG.size + 40),
    new THREE.MeshStandardMaterial({ color: "#1c2a2d", roughness: 1 }),
  );
  exterior.rotation.x = -Math.PI / 2;
  exterior.position.y = -0.12;
  group.add(exterior);

  const platform = new THREE.Mesh(
    new THREE.BoxGeometry(
      ARENA_CONFIG.size + 0.6,
      0.2,
      ARENA_CONFIG.size + 0.6,
    ),
    new THREE.MeshStandardMaterial({ color: "#223335", roughness: 1 }),
  );
  platform.position.y = -0.11;
  group.add(platform);

  const floorTexture = createFloorTexture();
  const gridCanvas = document.createElement("canvas");
  gridCanvas.width = gridCanvas.height = 256;
  const gridContext = gridCanvas.getContext("2d");
  gridContext.fillStyle = "#344747";
  gridContext.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 10; i++) {
    gridContext.strokeStyle = i % 5 === 0 ? "#53635e" : "#3e504d";
    gridContext.lineWidth = i % 5 === 0 ? 1.4 : 0.8;
    gridContext.beginPath();
    gridContext.moveTo(i * 25.6, 0);
    gridContext.lineTo(i * 25.6, 256);
    gridContext.moveTo(0, i * 25.6);
    gridContext.lineTo(256, i * 25.6);
    gridContext.stroke();
  }
  const gridTexture = new THREE.CanvasTexture(gridCanvas);
  gridTexture.colorSpace = THREE.SRGBColorSpace;
  gridTexture.wrapS = gridTexture.wrapT = THREE.RepeatWrapping;
  gridTexture.repeat.set(ARENA_CONFIG.size / 10, ARENA_CONFIG.size / 10);
  gridTexture.anisotropy = 4;
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(HALF_SIZE * 2, HALF_SIZE * 2),
    new THREE.MeshStandardMaterial({
      map: gridTexture,
      roughness: 0.95,
      metalness: 0.02,
    }),
  );
  floor.name = "TrainingFloor";
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  group.add(floor);
  const centreMarkings = new THREE.Mesh(
    new THREE.PlaneGeometry(36, 36),
    new THREE.MeshStandardMaterial({ map: floorTexture, roughness: 0.95 }),
  );
  centreMarkings.rotation.x = -Math.PI / 2;
  centreMarkings.position.y = 0.002;
  centreMarkings.receiveShadow = true;
  group.add(centreMarkings);

  const box = new THREE.BoxGeometry(1, 1, 1);
  const railMaterial = new THREE.MeshStandardMaterial({
    color: "#253638",
    roughness: 0.83,
  });
  const topMaterial = new THREE.MeshStandardMaterial({
    color: "#687871",
    roughness: 0.85,
  });
  const orangeMaterial = new THREE.MeshStandardMaterial({
    color: "#ca7d43",
    roughness: 0.7,
    emissive: "#94552e",
    emissiveIntensity: 0.13,
  });
  const wallDistance = HALF_SIZE + WALL_THICKNESS / 2;
  const wallTransforms = [];
  const capTransforms = [];
  const accentTransforms = [];
  for (let side = 0; side < 4; side += 1) {
    const rotationY = (side * Math.PI) / 2;
    const x = Math.sin(rotationY) * wallDistance;
    const z = Math.cos(rotationY) * wallDistance;
    wallTransforms.push({
      position: [x, WALL_HEIGHT / 2, z],
      scale: [ARENA_CONFIG.size + 0.65, WALL_HEIGHT, WALL_THICKNESS],
      rotationY,
    });
    capTransforms.push({
      position: [x, WALL_HEIGHT + 0.015, z],
      scale: [ARENA_CONFIG.size + 0.65, 0.03, WALL_THICKNESS + 0.03],
      rotationY,
    });
    for (let mark = -2; mark <= 2; mark += 1) {
      const offset = mark * 400;
      accentTransforms.push({
        position: [
          x + Math.cos(rotationY) * offset,
          WALL_HEIGHT + 0.034,
          z - Math.sin(rotationY) * offset,
        ],
        scale: [0.7, 0.008, 0.1],
        rotationY,
      });
    }
  }
  instanceBoxes(box, railMaterial, wallTransforms, group);
  instanceBoxes(box, topMaterial, capTransforms, group);
  instanceBoxes(box, orangeMaterial, accentTransforms, group);

  const postTransforms = [];
  const lightTransforms = [];
  const baseTransforms = [];
  for (const x of [-wallDistance, wallDistance]) {
    for (const z of [-wallDistance, wallDistance]) {
      baseTransforms.push({ position: [x, 0.15, z], scale: [0.8, 0.3, 0.8] });
      postTransforms.push({ position: [x, 0.85, z], scale: [0.33, 1.4, 0.33] });
      lightTransforms.push({
        position: [x, 1.47, z],
        scale: [0.36, 0.08, 0.36],
      });
    }
  }
  instanceBoxes(box, railMaterial, baseTransforms, group);
  instanceBoxes(box, topMaterial, postTransforms, group);
  const beaconMaterial = new THREE.MeshStandardMaterial({
    color: "#d6e6d4",
    emissive: "#b9ddbd",
    emissiveIntensity: 1.2,
    roughness: 0.6,
  });
  instanceBoxes(box, beaconMaterial, lightTransforms, group);

  return {
    group,
    halfSize: HALF_SIZE,
    wallHeight: WALL_HEIGHT,
    wallThickness: WALL_THICKNESS,
    floorHeight: 0,
    sunlight,
    updateFocus(position) {
      // One small shadow map follows the fighter, rather than covering 4 km².
      const x = Math.round(position.x / 2) * 2;
      const z = Math.round(position.z / 2) * 2;
      sunlight.position.set(x - 10, 17, z + 9);
      sunlight.target.position.set(x, 0, z);
      sunlight.target.updateMatrixWorld();
    },
    dispose() {
      const geometries = new Set();
      const materials = new Set();
      group.traverse((object) => {
        if (object.geometry) geometries.add(object.geometry);
        if (object.material) materials.add(object.material);
      });
      geometries.forEach((geometry) => geometry.dispose());
      materials.forEach((material) => material.dispose());
      floorTexture.dispose();
      gridTexture.dispose();
      sunlight.shadow.map?.dispose();
      scene.remove(group, hemisphere, sunlight);
    },
  };
}
