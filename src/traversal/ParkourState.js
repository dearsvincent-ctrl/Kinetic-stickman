import { agilityResponse } from "../movement/MovementAbilities.js";
import { Vector3 } from "three";
import { dampAngle } from "../core/math.js";
export const PARKOUR_DEFAULTS = Object.freeze({
  attachReach: 0.14,
  minIntent: 0.23,
  approachDot: 0.4,
  climbSpeed: 3.6,
  wallSpeed: 5.2,
  descentSpeed: 3,
  response: 18,
  wallJumpOut: 5,
  jumpFactor: 1,
  maxSpeed: 800,
  maxPoleOrbit: 6,
  hangDrop: 1.35,
  mantleRise: 5,
  mantleSpeed: 4.8,
  vaultRise: 6,
  detachMagnitude: 0.72,
  reattachDelay: 0.2,
});
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
/** Contact-supported abilities, separate from ballistic jumping and attack
 * timelines. No pose, camera, opponent selection or stamina belongs here. */
export class ParkourState {
  constructor(world, overrides = {}) {
    this.world = world;
    this.config = Object.freeze({ ...PARKOUR_DEFAULTS, ...overrides });
    for (const [k, n] of Object.entries(this.config))
      if (!Object.hasOwn(PARKOUR_DEFAULTS, k) || !Number.isFinite(n) || n <= 0)
        throw new RangeError(`Invalid parkour ${k}`);
    this.mode = "free";
    this.sequence = 0;
    this.surface = null;
    this.sample = {
      structure: null,
      normal: new Vector3(),
      gap: 0,
      insideSpan: false,
    };
    this.normal = new Vector3(0, 0, 1);
    this.tangent = new Vector3(1, 0, 0);
    this.direction = new Vector3();
    this.inputNormal = new Vector3();
    this.inputTangent = new Vector3();
    this.incoming = new Vector3();
    this.velocity = new Vector3();
    this.displacement = new Vector3();
    this.start = new Vector3();
    this.goal = new Vector3();
    this.blockedSurface = null;
    this.releaseTime = 0;
    this.mustLeave = false;
    this.time = 0;
    this.distance = 0;
    this.stage = "lift";
    this.lastExit = "none";
    this.jumpAge = Infinity;
  }
  get attached() {
    return this.mode !== "free";
  }
  setMode(mode) {
    if (mode !== this.mode) {
      this.mode = mode;
      this.sequence++;
    }
  }
  begin(dt) {
    this.time += dt;
    this.jumpAge += dt;
    this.releaseTime = Math.max(0, this.releaseTime - dt);
    this.incoming.set(0, 0, 0);
  }
  observe(velocity) {
    if (velocity.lengthSq() > 0.0001) this.incoming.copy(velocity);
  }
  tryAttach(c, magnitude) {
    if (
      this.attached ||
      magnitude < this.config.minIntent ||
      c.desired.lengthSq() < 0.001
    )
      return false;
    if (this.blockedSurface && this.mustLeave) {
      this.world.sampleSurface(
        this.blockedSurface,
        c.root.position,
        c.radius,
        this.sample,
      );
      if (
        this.sample.gap > this.config.attachReach + 0.12 ||
        !this.sample.insideSpan ||
        c.root.position.y > this.blockedSurface.top + 1.8
      )
        this.mustLeave = false;
    }
    this.direction.copy(c.desired).normalize();
    const ignored =
      this.releaseTime > 0 || this.mustLeave ? this.blockedSurface : null;
    if (
      !this.world.querySurface(
        c.root.position,
        this.direction,
        c.radius,
        this.sample,
        this.config.attachReach,
        ignored,
      )
    )
      return false;
    const s = this.sample.structure,
      toward = -this.direction.dot(this.sample.normal);
    if (toward < this.config.approachDot) return false;
    // A glancing pass and released-stick inertia are never grab requests.
    const approach = -this.incoming.dot(this.sample.normal);
    if (approach < 0.2 && (!c.jump.grounded || magnitude < 0.5)) return false;
    const grounded = c.jump.grounded;
    this.surface = s;
    this.characterRadius = c.radius;
    this.normal.copy(this.sample.normal);
    this.tangent.set(this.normal.z, 0, -this.normal.x);
    this.inputNormal.copy(this.normal);
    this.inputTangent.copy(this.tangent);
    const vertical = Math.max(
      0,
      c.jump.verticalVelocity,
      // Impact speed is dissipated against the wall, never converted to lift.
    );
    this.velocity
      .copy(c.velocity)
      .addScaledVector(this.normal, -c.velocity.dot(this.normal));
    this.velocity.clampLength(
      0,
      Math.min(
        this.config.maxSpeed,
        this.config.wallSpeed * (c.config.abilities?.wallTraversal ?? 1),
      ),
    );
    this.velocity.y = Math.min(
      vertical,
      this.config.climbSpeed * (c.config.abilities?.wallTraversal ?? 1),
    );
    c.jump.phase = "airborne";
    c.jump.floorHeight = 0;
    c.jump.height = c.root.position.y;
    c.jump.verticalVelocity = this.velocity.y;
    c.jump.jumpCount = Math.max(1, c.jump.jumpCount);
    c.jump.elapsed = 0;
    if (c.dash.active) c.dash.finish("parkour-contact");
    const low =
      s.kind === "box" &&
      s.vaultable &&
      s.top - c.root.position.y <= 1.1 &&
      grounded;
    this.stage = "lift";
    this.setMode(
      low
        ? "vault"
        : s.kind === "pole"
          ? "pole-climb"
          : s.top - c.root.position.y <= 1.6 &&
              vertical <= this.config.mantleRise * 2
            ? "ledge"
            : "wall-run",
    );
    if (this.mode === "ledge") {
      this.velocity.y = 0;
      this.hangHeight = c.root.position.y;
    }
    this.lastExit = "none";
    return true;
  }
  release(c, reason = "away", block = true) {
    if (!this.attached) return;
    if (block) {
      this.blockedSurface = this.surface;
      this.mustLeave = true;
      this.releaseTime = this.config.reattachDelay;
    }
    this.lastExit = reason;
    this.setMode("free");
    c.velocity.copy(this.velocity).setY(0);
    c.speed = c.velocity.length();
    c.jump.height = c.root.position.y;
    c.jump.floorHeight = 0;
    c.jump.phase = "airborne";
    c.jump.elapsed = 0;
    c.jump.verticalVelocity = this.velocity.y;
    c.jump.jumpCount = Math.max(1, c.jump.jumpCount);
    this.surface = null;
  }
  jumpOff(c, input, cameraYaw) {
    if (!this.attached) return false;
    const x = input?.move.x ?? 0,
      y = input?.move.y ?? 0,
      sin = Math.sin(cameraYaw),
      cos = Math.cos(cameraYaw);
    this.direction.set(x * cos - y * sin, 0, -x * sin - y * cos);
    const inputLength = Math.min(1, this.direction.length());
    if (inputLength > 0) this.direction.normalize();
    const outward =
      this.config.wallJumpOut * (c.config.abilities?.wallJump ?? 1);
    const tangent = this.direction.dot(this.tangent) * outward * inputLength;
    const polePerch = this.surface.kind === "pole" && this.mode === "perch";
    this.velocity.addScaledVector(
      this.normal,
      Math.max(outward, -this.velocity.dot(this.normal) + outward),
    );
    this.velocity.addScaledVector(this.tangent, tangent);
    if (polePerch)
      this.velocity
        .copy(inputLength > 0.15 ? this.direction : this.normal)
        .multiplyScalar(outward);
    this.velocity.clampLength(0, this.config.maxSpeed);
    this.velocity.y =
      c.jump.launchVelocity *
      this.config.jumpFactor *
      Math.sqrt(c.config.abilities?.wallJump ?? 1);
    this.release(c, "wall-jump");
    c.jump.jumpCount = 1;
    c.jump.sequence++;
    c.airDashesUsed = 0;
    c.jump.flightLaunchVelocity = c.jump.verticalVelocity;
    c.jumpEvent.sequence = c.jump.sequence;
    c.jumpEvent.kind = null;
    c.jumpEvent.referenceYaw = c.heading;
    c.jumpReferenceYaw = Math.atan2(-c.velocity.x, -c.velocity.z);
    c.jumpEvent.referenceYaw = c.jumpReferenceYaw;
    this.jumpAge = 0;
    return true;
  }
  update(dt, c, magnitude) {
    if (!this.attached) return false;
    let remaining = dt;
    while (remaining > 1e-9 && this.attached) {
      const budgetStep = dt / 32;
      const travelStep =
        0.18 /
        Math.max(
          1,
          this.velocity.length(),
          Math.min(
            this.config.maxSpeed,
            this.config.wallSpeed * (c.config.abilities?.wallTraversal ?? 1),
          ),
        );
      const step = Math.min(
        remaining,
        Math.max(budgetStep, Math.min(1 / 120, travelStep)),
      );
      this.stepMoved = false;
      this.advance(step, c, magnitude);
      if (this.attached || this.stepMoved) remaining -= step;
    }
    this.unusedTime = remaining;
    c.movementState = this.attached ? this.mode : "jump";
    return true;
  }
  advance(dt, c, magnitude) {
    const cfg = this.config,
      s = this.surface,
      p = c.root.position;
    this.world.sampleSurface(s, p, c.radius, this.sample);
    if (!this.world.structures.includes(s)) {
      this.release(c, "surface-removed");
      return;
    }
    if (
      (this.mode === "climb" ||
        this.mode === "wall-run" ||
        this.mode === "pole-climb" ||
        this.mode === "ledge") &&
      this.sample.gap > cfg.attachReach + 0.25
    ) {
      this.release(c, "lost-contact");
      return;
    }
    if (
      !this.sample.insideSpan &&
      this.mode !== "mantle" &&
      this.mode !== "vault" &&
      this.mode !== "perch"
    ) {
      this.release(c, "edge");
      return;
    }
    if (s.kind === "pole" && this.mode === "pole-climb")
      this.normal.copy(this.sample.normal);
    this.tangent.set(this.normal.z, 0, -this.normal.x);
    this.direction.copy(c.desired);
    if (this.direction.lengthSq() > 0) this.direction.normalize();
    const toward =
        -this.direction.dot(
          s.kind === "pole" ? this.inputNormal : this.normal,
        ) * magnitude,
      lateral =
        this.direction.dot(
          s.kind === "pole" ? this.inputTangent : this.tangent,
        ) * magnitude;
    if (toward < -0.6 && magnitude > cfg.detachMagnitude) {
      this.velocity.addScaledVector(
        this.normal,
        Math.min(2, cfg.wallJumpOut * 0.4),
      );
      this.release(c, "away");
      return;
    }
    if (this.mode === "perch") {
      if (magnitude > 0.2 && toward < 0.6) {
        this.velocity
          .copy(c.desired)
          .clampLength(
            0,
            cfg.wallSpeed * (c.config.abilities?.wallTraversal ?? 1),
          );
        this.release(c, "perch-step");
        return;
      }
      c.jump.advance(dt);
      c.velocity.set(0, 0, 0);
      c.speed = 0;
      return;
    }
    const abilities = c.config.abilities;
    const scale = abilities?.wallTraversal ?? 1,
      wallSpeed = Math.min(cfg.maxSpeed, cfg.wallSpeed * scale),
      rise = Math.min(cfg.maxSpeed, cfg.climbSpeed * scale);
    let vy = toward >= 0 ? toward * rise : toward * cfg.descentSpeed * scale;
    let tangentSpeed = lateral * wallSpeed;
    if (this.mode === "ledge") {
      vy = clamp((this.hangHeight - p.y) * 12, -2, 2);
      tangentSpeed = lateral * Math.min(3 * scale, cfg.maxSpeed);
      if (toward > 0.2) {
        this.stage = "lift";
        this.setMode("mantle");
      }
    }
    if (
      this.mode === "wall-run" ||
      this.mode === "climb" ||
      this.mode === "pole-climb"
    ) {
      if (this.mode !== "pole-climb")
        this.setMode(
          Math.abs(tangentSpeed) > Math.abs(vy) * 0.7 ? "wall-run" : "climb",
        );
      if (p.y >= s.top - cfg.hangDrop) {
        // Every ascent uses a collision-resolved crest transition. High wall
        // speed does not silently turn contact into another ballistic jump.
        this.hangHeight = p.y;
        this.velocity.y = Math.min(this.velocity.y, cfg.mantleRise);
        this.setMode(s.kind === "pole" ? "pole-mantle" : "ledge");
      }
    }
    const mounting =
      this.mode === "mantle" ||
      this.mode === "vault" ||
      this.mode === "pole-mantle";
    if (mounting && this.stage === "cross" && s.kind === "box") {
      const past =
        this.normal.x > 0.5
          ? p.x < s.minX - c.radius
          : this.normal.x < -0.5
            ? p.x > s.maxX + c.radius
            : this.normal.z > 0.5
              ? p.z < s.minZ - c.radius
              : p.z > s.maxZ + c.radius;
      if (past) {
        this.release(c, this.mode === "vault" ? "vault-exit" : "crest-flight");
        return;
      }
    }
    this.goal.copy(this.tangent).multiplyScalar(tangentSpeed);
    if (mounting && toward < 0.1 && p.y > s.top + 0.02) {
      this.release(c, "mantle-interrupted");
      return;
    }
    if (mounting && toward < -0.1) {
      this.setMode(s.kind === "pole" ? "pole-climb" : "climb");
      this.stage = "lift";
      return;
    }
    if (mounting) {
      if (magnitude < 0.08) {
        this.goal.set(0, 0, 0);
        vy = 0;
      } else if (this.stage === "lift") {
        vy =
          Math.min(
            cfg.maxSpeed,
            (this.mode === "vault" ? cfg.vaultRise : cfg.mantleRise) *
              Math.min(6, scale),
          ) * Math.max(0, toward);
        this.goal.multiplyScalar(0.4);
        if (p.y >= s.top + 0.025) this.stage = "cross";
      }
      if (this.stage === "cross") {
        vy = 0;
        if (s.kind === "pole") {
          this.goal.set(s.x - p.x, 0, s.z - p.z);
          if (this.goal.length() < 0.08) {
            this.velocity.set(0, -1, 0);
            this.move(dt, c, null);
            if (p.y <= s.top + 0.005) {
              c.jump.land(s.top, 1);
              this.setMode("perch");
              this.velocity.set(0, 0, 0);
            }
            return;
          }
          this.goal
            .multiplyScalar(8)
            .clampLength(0, Math.min(cfg.mantleSpeed * scale, cfg.maxSpeed));
        } else
          this.goal.addScaledVector(
            this.normal,
            -Math.min(
              cfg.maxSpeed,
              Math.max(cfg.mantleSpeed, wallSpeed) * Math.max(0, toward),
            ),
          );
        if (s.kind === "box" && this.world.supportHeight(p, 0) >= s.top - EPS) {
          this.goal.y = -2;
          this.velocity.copy(this.goal);
          this.move(dt, c);
          if (p.y <= s.top + 0.005) {
            c.jump.land(s.top, 2);
            c.airDashesUsed = 0;
            this.blockedSurface = s;
            this.releaseTime = cfg.reattachDelay;
            this.mustLeave = false;
            this.setMode("free");
            this.surface = null;
            c.velocity.copy(this.velocity).setY(0);
            c.speed = c.velocity.length();
            this.lastExit = "rooftop";
          }
          return;
        }
      }
    }
    this.goal.y = vy;
    // Adhesion closes small gaps through the same swept movement query. It
    // never snaps the actor or creates a vertical/outward impulse.
    if (!mounting && this.sample.gap > 0)
      this.goal.addScaledVector(
        this.normal,
        -Math.min(this.sample.gap / dt, 4 * (abilities?.wallAdhesion ?? 1)),
      );
    this.velocity
      .lerp(
        this.goal,
        1 - Math.exp(-cfg.response * agilityResponse(abilities?.agility) * dt),
      )
      .clampLength(0, cfg.maxSpeed);
    if (s.kind === "pole" && this.mode === "pole-climb") {
      const radius = Math.hypot(p.x - s.x, p.z - s.z),
        omega = clamp(
          tangentSpeed / Math.max(0.1, radius),
          -cfg.maxPoleOrbit,
          cfg.maxPoleOrbit,
        ),
        a = omega * dt;
      const nx = this.normal.x * Math.cos(a) + this.normal.z * Math.sin(a),
        nz = this.normal.z * Math.cos(a) - this.normal.x * Math.sin(a);
      this.displacement.set(
        (nx - this.normal.x) * radius,
        this.velocity.y * dt,
        (nz - this.normal.z) * radius,
      );
      this.move(dt, c, s, true);
    } else this.move(dt, c);
    if (this.attached && p.y <= 0.00001 && this.velocity.y < 0) {
      this.release(c, "ground");
      c.jump.land(0, 0);
      c.airDashesUsed = 0;
    }
    if (this.attached) {
      const heading =
        this.mode === "wall-run" && Math.abs(lateral) > 0.15
          ? Math.atan2(
              -this.tangent.x * Math.sign(lateral),
              -this.tangent.z * Math.sign(lateral),
            )
          : Math.atan2(this.normal.x, this.normal.z);
      c.heading = dampAngle(c.heading, heading, 15, dt);
      c.root.rotation.y = c.heading;
      c.jump.height = p.y;
      c.jump.verticalVelocity = this.velocity.y;
      c.jump.floorHeight = 0;
      c.jump.elapsed += dt;
      c.velocity.copy(this.velocity).setY(0);
      c.speed = c.velocity.length();
    }
  }
  move(dt, c, ignored = null, prepared = false) {
    this.stepMoved = true;
    this.start.copy(c.root.position);
    if (!prepared) this.displacement.copy(this.velocity).multiplyScalar(dt);
    this.world.contactCount = 0;
    this.world.hasObstacleContact = false;
    this.world.sweep(
      this.start,
      this.displacement,
      c.radius,
      1.8,
      c.next,
      ignored,
    );
    c.root.position.copy(c.next);
    if (prepared && dt > 0) {
      this.velocity.x = (c.root.position.x - this.start.x) / dt;
      this.velocity.z = (c.root.position.z - this.start.z) / dt;
    }
    this.distance += c.root.position.distanceTo(this.start);
    // Respect structure contacts rather than carrying hidden velocity through them.
    this.world.resolveVelocity(this.velocity);
    if (this.world.ceilingHit) this.velocity.y = Math.min(0, this.velocity.y);
    if (this.world.floorHit) this.velocity.y = Math.max(0, this.velocity.y);
  }
  cancel(c) {
    if (this.attached) this.release(c, "released");
  }
}
const EPS = 1e-5;
