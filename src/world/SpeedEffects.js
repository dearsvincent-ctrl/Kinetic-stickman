import {
  AdditiveBlending,
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
const BOOM_FOLLOW_TIME = 0.12;
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
    this._actorPosition = new Vector3();
    // Consumers compare sequence after update(); neither the event nor either
    // vector is replaced, including across reset. Positions are body-centred.
    this.lastBoom = {
      sequence: 0,
      position: new Vector3(),
      velocity: new Vector3(),
      speed: 0,
      radius: 0,
      intensity: 0,
    };
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
      radial: false,
    }));

    // A body-centred pressure front, with nested broad bands and curved shells.
    // It follows the runner for 120ms, then expands at its release position.
    // Every mesh/material is pooled; no texture or per-burst geometry is used.
    this.ringGeometry = new RingGeometry(0.905, 1, 64);
    this.shellGeometry = new SphereGeometry(1, 24, 14);
    this.rings = Array.from({ length: SPEED_EFFECT_LIMITS.rings }, () => {
      const mesh = new Group();
      mesh.name = "sonicPressureFront";
      const bands = Array.from({ length: 3 }, (_, i) => {
        const band = new Mesh(this.ringGeometry, new MeshBasicMaterial({
          color: i === 0 ? 0xe3ffff : 0x9ddde7,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          side: DoubleSide,
          blending: AdditiveBlending,
        }));
        const size = 1 - i * 0.135;
        band.scale.set(size, size, 1);
        band.position.z = i * -0.1;
        return band;
      });
      const shells = Array.from({ length: 2 }, (_, i) => {
        const shell = new Mesh(this.shellGeometry, new ShaderMaterial({
          transparent: true,
          depthWrite: false,
          side: DoubleSide,
          blending: AdditiveBlending,
          uniforms: {
            tint: { value: new Color(i === 0 ? 0xa0e4f1 : 0xd4faff) },
            alpha: { value: 0 },
          },
          vertexShader: `
            varying vec3 viewNormal;
            varying vec3 viewDirection;
            void main() {
              vec4 view = modelViewMatrix * vec4(position, 1.0);
              viewNormal = normalize(normalMatrix * normal);
              viewDirection = -view.xyz;
              gl_Position = projectionMatrix * view;
            }
          `,
          fragmentShader: `
            uniform vec3 tint;
            uniform float alpha;
            varying vec3 viewNormal;
            varying vec3 viewDirection;
            void main() {
              float rim = 1.0 - abs(dot(normalize(viewNormal), normalize(viewDirection)));
              float a = alpha * (0.025 + 0.975 * pow(rim, 2.4));
              if (a < 0.002) discard;
              gl_FragColor = vec4(tint, a);
              #include <tonemapping_fragment>
              #include <colorspace_fragment>
            }
          `,
        }));
        shell.scale.set(1 - i * 0.13, 1 - i * 0.13, 0.42 + i * 0.18);
        return shell;
      });
      const ground = new Mesh(this.ringGeometry, new MeshBasicMaterial({
        color: 0xd6c8ac,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        side: DoubleSide,
      }));
      ground.name = "sonicGroundSweep";
      ground.rotation.x = -Math.PI / 2;
      ground.visible = false;
      mesh.add(...bands, ...shells);
      mesh.visible = false;
      this.group.add(mesh, ground);
      return {
        mesh,
        ring: bands[0],
        shell: shells[0],
        bands,
        shells,
        ground,
        active: false,
        age: 0,
        life: 0.72,
        strength: 1,
        speed: 0,
        radius: 0,
        startRadius: 0,
        currentRadius: 0,
        following: false,
        grounded: false,
        floor: 0,
        sequence: 0,
        originX: 0,
        originY: 0,
        originZ: 0,
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
        opacity: 0.42,
        depthWrite: false,
        side: DoubleSide,
        blending: AdditiveBlending,
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
      radialX: 0,
      radialY: 0,
      radialZ: 0,
      spread: 0,
      travel: 0,
      parent: 0,
      sequence: 0,
      followX: 0,
      followY: 0,
      followZ: 0,
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
      get boomSequence() {
        return effect.lastBoom.sequence;
      },
      get shockwaveRadius() {
        return effect._shockwaveRadius;
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
    p.radial = radial;
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
    return p;
  }

  _groundBurst(x, y, z, force, amount) {
    if (this.settings.dustIntensity <= 0 || this.settings.dustDensity <= 0)
      return;
    const count = Math.min(20, Math.ceil(amount * this.settings.dustDensity));
    for (let i = 0; i < count; i++) this._emitDust(x, y, z, 0, 0, force, true);
  }

  _groundPressure(x, floor, z, radius, strength, speedScale) {
    if (this.settings.dustIntensity <= 0 || this.settings.dustDensity <= 0)
      return;
    const count = Math.min(
      36,
      Math.ceil((16 + strength * 6) * this.settings.dustDensity),
    );
    // Angular strata keep a complete 360-degree skirt even at low density.
    for (let i = 0; i < count; i++) {
      const angle = ((i + this._random() * 0.35) / count) * TAU;
      const dx = Math.cos(angle);
      const dz = Math.sin(angle);
      const start = radius * (0.6 + this._random() * 0.2);
      const p = this._emitDust(x, floor, z, 0, 0, strength, true);
      p.x = x + dx * start;
      p.z = z + dz * start;
      const push = (6 + this._random() * 5) * speedScale;
      p.vx = dx * push;
      p.vz = dz * push;
      p.vy = 0.4 + this._random() * 0.7;
      p.life = 0.5 + this._random() * 0.25;
      p.size = (0.6 + this._random() * 0.6) * Math.min(2, speedScale);
      p.opacity = Math.min(0.5, (0.22 + strength * 0.08) * this.settings.dustIntensity);
    }
  }

  _emitSonic(x, y, z, vx, vy, vz, floor, grounded) {
    const speed = Math.hypot(vx, vy, vz);
    // Resolved world speed controls the scale, independently of the selected
    // crossing threshold: turning a slider down cannot simulate faster travel.
    const speedScale = Math.max(0.75, Math.min(2.5, Math.sqrt(speed / 40)));
    const strength = this.settings.sonicIntensity * (0.7 + speedScale * 0.3);
    const index = this._ringCursor;
    const r = this.rings[index];
    this._ringCursor = (this._ringCursor + 1) % SPEED_EFFECT_LIMITS.rings;
    this._direction.set(vx, vy, vz).normalize();
    r.active = true;
    r.age = 0;
    r.life = 0.64 + 0.08 * speedScale + 0.04 * Math.min(3, strength);
    r.strength = strength;
    r.speed = speed;
    r.radius = this.settings.shockwaveSize * speedScale;
    r.startRadius = Math.min(r.radius * 0.8, Math.max(1.2, r.radius * 0.26));
    r.following = true;
    r.grounded = grounded;
    r.floor = floor;
    r.originX = x;
    r.originY = y + 1;
    r.originZ = z;
    r.mesh.position.set(x, y + 1, z);
    r.mesh.quaternion.setFromUnitVectors(this._normal, this._direction);
    r.mesh.visible = true;
    r.ground.position.set(x, floor + 0.055, z);
    r.ground.visible = grounded;
    this._sonicBursts++;
    r.sequence = ++this.lastBoom.sequence;
    this.lastBoom.position.copy(r.mesh.position);
    this.lastBoom.velocity.set(vx, vy, vz);
    this.lastBoom.speed = speed;
    this.lastBoom.radius = r.radius;
    this.lastBoom.intensity = strength;

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
      const radius = r.startRadius * (0.65 + this._random() * 0.3);
      const side = Math.cos(angle) * radius;
      const up = Math.sin(angle) * radius;
      p.active = true;
      p.age = 0;
      p.life = 0.27 + this._random() * 0.17;
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
      p.width = (0.05 + strength * 0.025) * speedScale;
      p.length = (2 + this._random() * 2 + Math.min(2, strength)) * speedScale;
      p.strength = Math.min(1, 0.5 + strength * 0.2);
      p.radialX = this._side.x * Math.cos(angle) + this._frameUp.x * Math.sin(angle);
      p.radialY = this._side.y * Math.cos(angle) + this._frameUp.y * Math.sin(angle);
      p.radialZ = this._side.z * Math.cos(angle) + this._frameUp.z * Math.sin(angle);
      p.spread = r.radius * 0.32;
      p.travel = 4 * speedScale;
      p.parent = index;
      p.sequence = r.sequence;
      p.followX = p.followY = p.followZ = 0;
    }
    if (grounded)
      this._groundPressure(x, floor, z, r.startRadius, strength, speedScale);
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
    this._actorPosition.set(x, y + 1, z);
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
    this._shockwaveRadius = 0;
    for (let i = 0; i < this.rings.length; i++) {
      const p = this.rings[i];
      const previousAge = p.age;
      p.age += dt;
      if (!p.active || p.age >= p.life) {
        p.active = false;
        p.following = false;
        p.mesh.visible = false;
        p.ground.visible = false;
        continue;
      }
      this._activeRings++;
      if (p.following) {
        const fraction = dt > 0 ? clamp01((BOOM_FOLLOW_TIME - previousAge) / dt) : 1;
        p.mesh.position.lerp(this._actorPosition, fraction);
        p.ground.position.set(p.mesh.position.x, p.floor + 0.055, p.mesh.position.z);
        if (p.age >= BOOM_FOLLOW_TIME) p.following = false;
      }
      const t = p.age / p.life;
      const spread =
        p.startRadius + (1 - (1 - t) ** 3) * (p.radius - p.startRadius);
      const fade = Math.min(1, 0.5 + t * 9) * (1 - t) ** 1.35;
      p.currentRadius = spread;
      this._shockwaveRadius = Math.max(this._shockwaveRadius, spread);
      p.mesh.scale.setScalar(spread);
      for (let band = 0; band < p.bands.length; band++) {
        p.bands[band].material.opacity =
          Math.min(0.7, 0.28 * p.strength) * fade * (1 - band * 0.22);
      }
      for (let shell = 0; shell < p.shells.length; shell++) {
        p.shells[shell].material.uniforms.alpha.value =
          Math.min(0.4, 0.16 * p.strength) * fade * (1 - shell * 0.3);
      }
      p.ground.scale.setScalar(spread * 1.05);
      p.ground.material.opacity = Math.min(0.24, p.strength * 0.12) * fade;
      p.ground.visible = p.grounded;
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
        const parent = this.rings[p.parent];
        if (parent.sequence === p.sequence) {
          p.followX = parent.mesh.position.x - parent.originX;
          p.followY = parent.mesh.position.y - parent.originY;
          p.followZ = parent.mesh.position.z - parent.originZ;
        }
        this._scratch.position.set(
          p.x + p.followX + p.dx * t * p.travel + p.radialX * t * p.spread,
          p.y + p.followY + p.dy * t * p.travel + p.radialY * t * p.spread,
          p.z + p.followZ + p.dz * t * p.travel + p.radialZ * t * p.spread,
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
    this._shockwaveRadius = 0;
    this._previousHorizontal = 0;
    this._previousVY = 0;
    this._previousDX = 0;
    this._previousDZ = 1;
    this._airborneDownward = 0;
    this._wasGrounded = null;
    this._sonicArmed = true;
    this._seed = 0x4b1d;
    this._actorPosition.set(0, 0, 0);
    this.lastBoom.sequence = 0;
    this.lastBoom.position.set(0, 0, 0);
    this.lastBoom.velocity.set(0, 0, 0);
    this.lastBoom.speed = this.lastBoom.radius = this.lastBoom.intensity = 0;
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
      const p = this.rings[i];
      for (const band of p.bands) band.material.dispose();
      for (const shell of p.shells) shell.material.dispose();
      p.ground.material.dispose();
    }
    this.streakMesh.geometry.dispose();
    this.streakMesh.material.dispose();
  }
}
