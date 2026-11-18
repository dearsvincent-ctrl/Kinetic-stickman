import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  DynamicDrawUsage,
  Group,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  Points,
  RingGeometry,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
} from "three";
import {
  SPEED_EFFECT_DEFAULTS,
  sanitizeSpeedEffectSettings,
} from "../sandbox/SpeedEffectsSettings.js";

export const SPEED_EFFECT_LIMITS = Object.freeze({
  dust: 64,
  rings: 2,
  streaks: 12,
});
const EMPTY_CONTEXT = Object.freeze({});
const TAU = Math.PI * 2;
const finite = (n, fallback = 0) => (Number.isFinite(n) ? n : fallback);
const bound = (n, fallback = 0) =>
  Math.max(-1e7, Math.min(1e7, finite(n, fallback)));
const clamp01 = (n) => Math.max(0, Math.min(1, n));

/** Cosmetic world-space effects only. All particles, geometry, GPU buffers and
 * scratch vectors are allocated once. update() accepts a reused context and
 * never changes the supplied actor, velocity, feet, or camera. */
export class SpeedEffects {
  constructor() {
    this.settings = SPEED_EFFECT_DEFAULTS;
    this.group = new Group();
    this.group.name = "superhumanSpeedEffects";
    this.group.userData.cosmetic = true;
    this._scratch = new Object3D();
    this._direction = new Vector3(0, 0, 1);
    this._normal = new Vector3(0, 0, 1);
    this._side = new Vector3(1, 0, 0);
    this._up = new Vector3(0, 1, 0);
    this._frameUp = new Vector3(0, 1, 0);
    this._color = new Color();
    this._disposed = false;

    this.dustPositions = new Float32Array(SPEED_EFFECT_LIMITS.dust * 3);
    this.dustSizes = new Float32Array(SPEED_EFFECT_LIMITS.dust);
    this.dustOpacities = new Float32Array(SPEED_EFFECT_LIMITS.dust);
    const dustGeometry = new BufferGeometry();
    dustGeometry.setAttribute(
      "position",
      new BufferAttribute(this.dustPositions, 3).setUsage(DynamicDrawUsage),
    );
    dustGeometry.setAttribute(
      "aSize",
      new BufferAttribute(this.dustSizes, 1).setUsage(DynamicDrawUsage),
    );
    dustGeometry.setAttribute(
      "aOpacity",
      new BufferAttribute(this.dustOpacities, 1).setUsage(DynamicDrawUsage),
    );
    const dustMaterial = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { tint: { value: new Color(0xbda98b) } },
      vertexShader: `
        attribute float aSize;
        attribute float aOpacity;
        varying float opacity;
        void main() {
          vec4 view = modelViewMatrix * vec4(position, 1.0);
          opacity = aOpacity;
          gl_Position = projectionMatrix * view;
          gl_PointSize = clamp(aSize * 520.0 / max(0.5, -view.z), 0.0, 72.0);
        }
      `,
      fragmentShader: `
        uniform vec3 tint;
        varying float opacity;
        void main() {
          vec2 p = gl_PointCoord * 2.0 - 1.0;
          float r = length(p);
          float edge = 1.0 - smoothstep(0.32, 1.0, r);
          float wisp = 0.88 + 0.12 * sin(p.x * 8.0 + p.y * 5.0);
          float alpha = edge * edge * wisp * opacity;
          if (alpha < 0.002) discard;
          gl_FragColor = vec4(tint, alpha);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    });
    this.dustMesh = new Points(dustGeometry, dustMaterial);
    this.dustMesh.name = "speedDustPool";
    this.dustMesh.frustumCulled = false;
    this.group.add(this.dustMesh);
    this.dust = Array.from({ length: SPEED_EFFECT_LIMITS.dust }, () => ({
      active: false,
      age: 0,
      life: 0.5,
      x: 0,
      y: 0,
      z: 0,
      vx: 0,
      vy: 0,
      vz: 0,
      floor: 0,
      size: 0,
      opacity: 0,
    }));

    // Ring planes face travel direction; a shallow ellipsoid supplies a faint
    // pressure shell. These meshes remain at their crossing's world position.
    this.ringGeometry = new RingGeometry(0.955, 1, 56);
    this.shellGeometry = new SphereGeometry(1, 18, 10);
    this.rings = Array.from({ length: SPEED_EFFECT_LIMITS.rings }, () => {
      const mesh = new Group();
      const ring = new Mesh(
        this.ringGeometry,
        new MeshBasicMaterial({
          color: 0xc4e7e8,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          side: DoubleSide,
        }),
      );
      const shell = new Mesh(
        this.shellGeometry,
        new MeshBasicMaterial({
          color: 0x9dcdd1,
          transparent: true,
          opacity: 0,
          depthWrite: false,
        }),
      );
      shell.scale.set(1, 1, 0.16);
      mesh.add(ring, shell);
      mesh.visible = false;
      this.group.add(mesh);
      return {
        mesh,
        ring,
        shell,
        active: false,
        age: 0,
        life: 0.72,
        strength: 1,
      };
    });

    // One tapered ribbon geometry is instanced for all the short directional
    // streaks. Its local +Z axis is aligned with the crossing velocity.
    const streakGeometry = new BufferGeometry();
    streakGeometry.setAttribute(
      "position",
      new BufferAttribute(
        new Float32Array([
          -0.5, 0, -0.5, 0.5, 0, -0.5, 0.08, 0, 0.5, -0.5, 0, -0.5, 0.08, 0,
          0.5, -0.08, 0, 0.5,
        ]),
        3,
      ),
    );
    this.streakMesh = new InstancedMesh(
      streakGeometry,
      new MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.28,
        depthWrite: false,
        side: DoubleSide,
      }),
      SPEED_EFFECT_LIMITS.streaks,
    );
    this.streakMesh.name = "sonicStreakPool";
    this.streakMesh.instanceMatrix.setUsage(DynamicDrawUsage);
    // InstancedMesh creates this buffer lazily on the first setColorAt call.
    // Initialize it here so the first crossing also reuses all GPU buffers.
    for (let i = 0; i < SPEED_EFFECT_LIMITS.streaks; i++)
      this.streakMesh.setColorAt(i, this._color);
    this.streakMesh.instanceColor.setUsage(DynamicDrawUsage);
    this.streakMesh.frustumCulled = false;
    this.group.add(this.streakMesh);
    this.streaks = Array.from({ length: SPEED_EFFECT_LIMITS.streaks }, () => ({
      active: false,
      age: 0,
      life: 0.3,
      x: 0,
      y: 0,
      z: 0,
      dx: 0,
      dy: 0,
      dz: 1,
      width: 0,
      length: 0,
      strength: 0,
    }));

    // This object is stable, frozen and directly serializable in debugState.
    const effect = this;
    this.telemetry = Object.freeze({
      get dustEmissions() {
        return effect._dustEmissions;
      },
      get sonicBursts() {
        return effect._sonicBursts;
      },
      get activeDust() {
        return effect._activeDust;
      },
      get activeRings() {
        return effect._activeRings;
      },
      get activeStreaks() {
        return effect._activeStreaks;
      },
      get horizontalSpeed() {
        return effect._horizontalSpeed;
      },
      get actualSpeed() {
        return effect._actualSpeed;
      },
      get sonicArmed() {
        return effect._sonicArmed;
      },
    });
    this.reset();
  }

  get dustEmissions() {
    return this._dustEmissions;
  }
  get config() {
    return this.settings;
  }
  get sonicBursts() {
    return this._sonicBursts;
  }
  get activeDust() {
    return this._activeDust;
  }
  get activeRings() {
    return this._activeRings;
  }
  get activeStreaks() {
    return this._activeStreaks;
  }
  get horizontalSpeed() {
    return this._horizontalSpeed;
  }
  get actualSpeed() {
    return this._actualSpeed;
  }
  get sonicArmed() {
    return this._sonicArmed;
  }

  configure(values) {
    this.settings = sanitizeSpeedEffectSettings({
      ...this.settings,
      ...values,
    });
    if (this.settings.dustDensity === 0 || this.settings.dustIntensity === 0)
      this._dustRemainder = 0;
    return this.settings;
  }

  _random() {
    this._seed = (Math.imul(this._seed, 1664525) + 1013904223) >>> 0;
    return this._seed / 4294967296;
  }

  _emitDust(x, y, z, dx, dz, force, radial = false) {
    const p = this.dust[this._dustCursor];
    this._dustCursor = (this._dustCursor + 1) % SPEED_EFFECT_LIMITS.dust;
    const angle = this._random() * TAU;
    const spread = 0.05 + this._random() * 0.28;
    const drift = (0.3 + this._random() * 0.9) * (0.55 + force * 0.25);
    p.active = true;
    p.age = 0;
    p.life = 0.3 + this._random() * 0.28;
    p.x = x + Math.cos(angle) * spread;
    p.y = y + 0.045 + this._random() * 0.06;
    p.z = z + Math.sin(angle) * spread;
    p.floor = y;
    p.vx =
      Math.cos(angle) * drift * (radial ? 1.8 : 0.45) -
      dx * (radial ? 0.05 : drift * 0.5);
    p.vy = 0.32 + this._random() * 0.48 + force * 0.12;
    p.vz =
      Math.sin(angle) * drift * (radial ? 1.8 : 0.45) -
      dz * (radial ? 0.05 : drift * 0.5);
    p.size = (0.22 + this._random() * 0.2) * (0.65 + force * 0.45);
    p.opacity = Math.min(
      0.42,
      (0.1 + force * 0.075) * this.settings.dustIntensity,
    );
    this._dustEmissions++;
  }

  _groundBurst(x, y, z, force, amount) {
    if (this.settings.dustIntensity <= 0 || this.settings.dustDensity <= 0)
      return;
    const count = Math.min(20, Math.ceil(amount * this.settings.dustDensity));
    for (let i = 0; i < count; i++) this._emitDust(x, y, z, 0, 0, force, true);
  }

  _emitSonic(x, y, z, vx, vy, vz, floor, grounded) {
    const strength = this.settings.sonicIntensity;
    const r = this.rings[this._ringCursor];
    this._ringCursor = (this._ringCursor + 1) % SPEED_EFFECT_LIMITS.rings;
    this._direction.set(vx, vy, vz).normalize();
    r.active = true;
    r.age = 0;
    r.life = 0.66 + 0.08 * Math.min(2, strength);
    r.strength = strength;
    r.mesh.position.set(x, y + 1, z).addScaledVector(this._direction, -0.3);
    r.mesh.quaternion.setFromUnitVectors(this._normal, this._direction);
    r.mesh.visible = true;
    this._sonicBursts++;

    // Build an orthonormal travel frame even for a vertical dash or freefall.
    this._side
      .crossVectors(
        this._direction,
        Math.abs(this._direction.y) > 0.9 ? this._normal : this._up,
      )
      .normalize();
    this._frameUp.crossVectors(this._side, this._direction).normalize();
    const count = Math.min(
      SPEED_EFFECT_LIMITS.streaks,
      6 + Math.ceil(strength * 2),
    );
    for (let i = 0; i < count; i++) {
      const p = this.streaks[this._streakCursor];
      this._streakCursor =
        (this._streakCursor + 1) % SPEED_EFFECT_LIMITS.streaks;
      const angle = (i / count) * TAU + this._random() * 0.3;
      const radius = 0.55 + this._random() * 0.75;
      const side = Math.cos(angle) * radius;
      const up = Math.sin(angle) * radius;
      p.active = true;
      p.age = 0;
      p.life = 0.2 + this._random() * 0.16;
      p.x =
        x +
        this._side.x * side +
        this._frameUp.x * up -
        this._direction.x * 0.9;
      p.y =
        y +
        1 +
        this._side.y * side +
        this._frameUp.y * up -
        this._direction.y * 0.9;
      p.z =
        z +
        this._side.z * side +
        this._frameUp.z * up -
        this._direction.z * 0.9;
      p.dx = this._direction.x;
      p.dy = this._direction.y;
      p.dz = this._direction.z;
      p.width = 0.018 + strength * 0.013;
      p.length = 1.2 + this._random() * 1.6 + Math.min(2, strength) * 0.5;
      p.strength = Math.min(1, 0.5 + strength * 0.2);
    }
    if (grounded)
      this._groundBurst(x, floor, z, 0.8 + strength * 0.4, 5 + strength * 2);
  }

  update(dt, context = EMPTY_CONTEXT) {
    if (this._disposed || !Number.isFinite(dt) || dt <= 0) return;
    dt = Math.min(0.1, dt);
    const position = context.position ?? EMPTY_CONTEXT;
    const velocity = context.velocity ?? EMPTY_CONTEXT;
    const x = bound(position.x),
      y = bound(position.y),
      z = bound(position.z);
    const vx = bound(velocity.x),
      vz = bound(velocity.z);
    const vy = bound(context.verticalVelocity, bound(velocity.y));
    const grounded = context.grounded === true;
    const floor = bound(context.floorHeight);
    const horizontal = Math.hypot(vx, vz);
    const actual = Math.hypot(horizontal, vy);
    this._horizontalSpeed = horizontal;
    this._actualSpeed = actual;
    const dx = horizontal > 0.001 ? vx / horizontal : this._previousDX;
    const dz = horizontal > 0.001 ? vz / horizontal : this._previousDZ;

    if (!grounded)
      this._airborneDownward = Math.max(this._airborneDownward, -vy);
    else if (this._wasGrounded === false) {
      const landing = Math.max(
        this._airborneDownward,
        -this._previousVY,
        finite(context.landingSpeed),
      );
      if (landing >= 5)
        this._groundBurst(
          x,
          floor,
          z,
          Math.min(3, landing / 10),
          4 + Math.min(8, landing / 4),
        );
      this._airborneDownward = 0;
    }

    if (actual <= this.settings.sonicSpeed * 0.8) this._sonicArmed = true;
    if (this._sonicArmed && actual >= this.settings.sonicSpeed) {
      this._sonicArmed = false;
      if (this.settings.sonicEnabled && this.settings.sonicIntensity > 0)
        this._emitSonic(x, y, z, vx, vy, vz, floor, grounded);
    }

    if (
      grounded &&
      horizontal >= this.settings.dustSpeed &&
      this.settings.dustDensity > 0 &&
      this.settings.dustIntensity > 0
    ) {
      const speedWeight = Math.min(
        3,
        Math.log2(1 + horizontal / this.settings.dustSpeed),
      );
      const turn = clamp01(
        (1 - dx * this._previousDX - dz * this._previousDZ) * 0.5,
      );
      const acceleration = Math.min(
        1,
        Math.abs(horizontal - this._previousHorizontal) / Math.max(1, dt * 100),
      );
      const force = Math.min(
        3,
        0.5 + speedWeight * 0.55 + turn * 0.9 + acceleration * 0.35,
      );
      const rate = Math.min(
        90,
        (7 + speedWeight * 8) *
          (1 + turn * 0.6 + acceleration * 0.25) *
          this.settings.dustDensity,
      );
      this._dustRemainder = Math.min(12, this._dustRemainder + rate * dt);
      let count = Math.floor(this._dustRemainder);
      this._dustRemainder -= count;
      const feet = context.feet;
      const footCount = feet?.length ?? 0;
      while (count-- > 0) {
        let px = x - dx * 0.18 + dz * (this._footSide ? 0.16 : -0.16);
        let pz = z - dz * 0.18 - dx * (this._footSide ? 0.16 : -0.16);
        if (footCount > 0) {
          let contact = null;
          for (let i = 0; i < footCount; i++) {
            const foot = feet[this._footCursor++ % footCount];
            const p = foot?.position ?? foot;
            // Explicit contact state takes priority over ankle height. A
            // grounded runner still has visual flight windows with no plant.
            if (
              p &&
              (foot?.contact === true ||
                (foot?.contact === undefined &&
                  Math.abs(finite(p.y, floor) - floor) < 0.35))
            ) {
              contact = p;
              break;
            }
          }
          if (!contact) continue;
          px = bound(contact.x, px);
          pz = bound(contact.z, pz);
        }
        this._footSide = !this._footSide;
        this._emitDust(px, floor, pz, dx, dz, force);
      }
    } else this._dustRemainder = 0;

    this._previousHorizontal = horizontal;
    this._previousDX = dx;
    this._previousDZ = dz;
    this._previousVY = vy;
    this._wasGrounded = grounded;
    this._render(dt);
  }

  _render(dt) {
    this._activeDust = 0;
    for (let i = 0; i < this.dust.length; i++) {
      const p = this.dust[i];
      p.age += dt;
      if (!p.active || p.age >= p.life) {
        p.active = false;
        this.dustSizes[i] = 0;
        this.dustOpacities[i] = 0;
        continue;
      }
      this._activeDust++;
      const t = p.age / p.life;
      p.x += p.vx * dt;
      p.z += p.vz * dt;
      p.y = Math.max(p.floor + 0.025, p.y + p.vy * dt);
      p.vy -= dt * 0.55;
      this.dustPositions[i * 3] = p.x;
      this.dustPositions[i * 3 + 1] = p.y;
      this.dustPositions[i * 3 + 2] = p.z;
      this.dustSizes[i] = p.size * (0.6 + t * 1.4);
      this.dustOpacities[i] =
        p.opacity * (1 - t) * (1 - t) * Math.min(1, t * 12);
    }
    this.dustMesh.geometry.attributes.position.needsUpdate = true;
    this.dustMesh.geometry.attributes.aSize.needsUpdate = true;
    this.dustMesh.geometry.attributes.aOpacity.needsUpdate = true;
    this.dustMesh.visible = this._activeDust > 0;

    this._activeRings = 0;
    for (let i = 0; i < this.rings.length; i++) {
      const p = this.rings[i];
      p.age += dt;
      if (!p.active || p.age >= p.life) {
        p.active = false;
        p.mesh.visible = false;
        continue;
      }
      this._activeRings++;
      const t = p.age / p.life;
      const spread =
        0.6 + (1 - (1 - t) ** 2) * (3.5 + Math.min(3, p.strength) * 1.2);
      const fade = Math.sin(Math.PI * Math.min(1, t * 1.3)) * (1 - t);
      p.mesh.scale.setScalar(spread);
      p.ring.material.opacity = Math.min(0.55, 0.22 * p.strength) * fade;
      p.shell.material.opacity = Math.min(0.09, 0.03 * p.strength) * fade;
    }

    this._activeStreaks = 0;
    for (let i = 0; i < this.streaks.length; i++) {
      const p = this.streaks[i];
      p.age += dt;
      if (!p.active || p.age >= p.life) {
        p.active = false;
        this._scratch.scale.setScalar(0);
      } else {
        this._activeStreaks++;
        const t = p.age / p.life;
        const fade = (1 - t) * (1 - t);
        this._scratch.position.set(
          p.x + p.dx * t * 1.5,
          p.y + p.dy * t * 1.5,
          p.z + p.dz * t * 1.5,
        );
        this._direction.set(p.dx, p.dy, p.dz);
        this._scratch.quaternion.setFromUnitVectors(
          this._normal,
          this._direction,
        );
        this._scratch.scale.set(
          p.width * fade,
          1,
          p.length * (0.8 + t * 0.5) * fade,
        );
        this._color.setRGB(
          0.58 * p.strength * fade,
          0.79 * p.strength * fade,
          0.85 * p.strength * fade,
        );
        this.streakMesh.setColorAt(i, this._color);
      }
      this._scratch.updateMatrix();
      this.streakMesh.setMatrixAt(i, this._scratch.matrix);
    }
    this.streakMesh.instanceMatrix.needsUpdate = true;
    if (this.streakMesh.instanceColor)
      this.streakMesh.instanceColor.needsUpdate = true;
    this.streakMesh.visible = this._activeStreaks > 0;
  }

  reset() {
    this._dustEmissions = 0;
    this._sonicBursts = 0;
    this._dustCursor = 0;
    this._ringCursor = 0;
    this._streakCursor = 0;
    this._footCursor = 0;
    this._footSide = false;
    this._dustRemainder = 0;
    this._horizontalSpeed = 0;
    this._actualSpeed = 0;
    this._previousHorizontal = 0;
    this._previousVY = 0;
    this._previousDX = 0;
    this._previousDZ = 1;
    this._airborneDownward = 0;
    this._wasGrounded = null;
    this._sonicArmed = true;
    this._seed = 0x4b1d;
    for (let i = 0; i < this.dust.length; i++) this.dust[i].active = false;
    for (let i = 0; i < this.rings.length; i++) this.rings[i].active = false;
    for (let i = 0; i < this.streaks.length; i++)
      this.streaks[i].active = false;
    this._render(0);
  }

  dispose() {
    if (this._disposed) return;
    this.reset();
    this._disposed = true;
    this.group.removeFromParent();
    this.dustMesh.geometry.dispose();
    this.dustMesh.material.dispose();
    this.ringGeometry.dispose();
    this.shellGeometry.dispose();
    for (let i = 0; i < this.rings.length; i++) {
      this.rings[i].ring.material.dispose();
      this.rings[i].shell.material.dispose();
    }
    this.streakMesh.geometry.dispose();
    this.streakMesh.material.dispose();
  }
}
