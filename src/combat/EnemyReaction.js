import { ReactionSkeleton } from "./ReactionSkeleton.js";
import { Vector3, Quaternion, Euler } from "three";
import {
  REACTION_DEFAULTS,
  sanitizeReactions,
} from "../sandbox/ReactionSettings.js";
import { IMPACT_LIMITS } from "./ImpactModel.js";
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const FLOOR_POINTS = [
  "head",
  "leftHand",
  "rightHand",
  "leftElbow",
  "rightElbow",
  "leftKnee",
  "rightKnee",
  "leftAnkle",
  "rightAnkle",
  "leftToe",
  "rightToe",
];
const JOINTS = [
  "spine",
  "head",
  "leftShoulder",
  "rightShoulder",
  "leftElbow",
  "rightElbow",
  "leftHip",
  "rightHip",
  "leftKnee",
  "rightKnee",
  "leftAnkle",
  "rightAnkle",
];
export { JOINTS as REACTION_JOINTS };
/** Ballistic root + bounded angular joint dynamics. Rig bone lengths stay fixed;
 * no independent translational particles, constraint explosions or ragdoll locks. */
export class EnemyReaction {
  constructor(agent) {
    this.agent = agent;
    this.skeleton = new ReactionSkeleton();
    this.settings = REACTION_DEFAULTS;
    this.velocity = new Vector3();
    this.consumedImpulse = new Vector3();
    this.angular = new Vector3();
    this.orientation = new Quaternion();
    this.deltaQ = new Quaternion();
    this.euler = new Euler();
    this.start = new Vector3();
    this.delta = new Vector3();
    this.next = new Vector3();
    this.local = new Vector3();
    this.jointAngles = new Float64Array(JOINTS.length * 3);
    this.jointRates = new Float64Array(JOINTS.length * 3);
    this.presentedPose = new Float64Array(JOINTS.length * 3);
    this.presentedOrientation = new Quaternion();
    this.boxes = [0.9, 1.36, 1.74].map((height, i) => ({
      height,
      part: i === 2 ? "head" : "body",
      radius: [0.25, 0.27, 0.19][i],
      x: 0,
      z: 0,
      previousHeight: height,
      previousX: 0,
      previousZ: 0,
    }));
    this.restBoxes = agent.body.hitboxes;
    this.reset();
  }
  configure(values) {
    this.settings = sanitizeReactions(values);
    if (!this.settings.ragdollEnabled) this.ragdoll = false;
  }
  reset() {
    this.phase = "idle";
    this.age = this.elapsed = this.weight = this.force = 0;
    this.sequence = 0;
    this.ragdoll = false;
    this.bodyHeight = 0.97;
    this.location = "body";
    this.style = "punch";
    this.directionX = this.directionZ = 0;
    this.localX = 0;
    this.localZ = 1;
    this.landings = this.collisions = 0;
    this.lastCollisionTime = -Infinity;
    this.detail = true;
    this.constrained = false;
    this.hasPresentedPose = false;
    this.contactPoint ??= new Vector3();
    this.contactPoint.set(0, 0, 0);
    this.velocity.set(0, 0, 0);
    this.consumedImpulse.set(0, 0, 0);
    this.angular.set(0, 0, 0);
    this.orientation.identity();
    this.jointAngles.fill(0);
    this.jointRates.fill(0);
    this.agent.body.hitboxes = this.restBoxes;
    for (let i = 0; i < this.boxes.length; i++)
      Object.assign(this.boxes[i], {
        x: 0,
        z: 0,
        previousX: 0,
        previousZ: 0,
        height: [0.9, 1.36, 1.74][i],
        previousHeight: [0.9, 1.36, 1.74][i],
      });
  }
  get ownsMotion() {
    return (
      this.phase === "flight" ||
      this.phase === "knockdown" ||
      this.phase === "fallen" ||
      this.phase === "recover"
    );
  }
  get active() {
    return this.phase !== "idle";
  }
  hit(impact) {
    const a = this.agent,
      s = this.settings,
      p = a.profile ?? {};
    const force = Number.isFinite(impact.force)
        ? clamp(impact.force, 0, IMPACT_LIMITS.velocity)
        : 0,
      balance = p.balance ?? 1;
    const score = force / Math.max(0.25, balance);
    this.sequence++;
    this.age = this.elapsed = 0;
    this.lastCollisionTime = -Infinity;
    this.force = force;
    this.weight = Number.isFinite(impact.visual)
      ? clamp(impact.visual, 0, 3)
      : s.intensity;
    this.location = impact.location ?? "body";
    this.style = impact.style ?? impact.action ?? "impact";
    this.directionX = impact.x ?? 0;
    this.directionZ = impact.z ?? 1;
    const yaw = a.controller.heading ?? 0;
    this.localX =
      this.directionX * Math.cos(yaw) - this.directionZ * Math.sin(yaw);
    this.localZ =
      this.directionX * Math.sin(yaw) + this.directionZ * Math.cos(yaw);
    this.ragdoll =
      s.ragdollEnabled &&
      ((this.ragdoll && this.ownsMotion) ||
        score >= Math.max(s.knockdown, s.ragdoll));
    const wasOwner = this.ownsMotion;
    // Combat and pressure contacts can share one simulation tick. The legacy
    // accumulator stays observable until update; consume only its new delta.
    if (wasOwner) {
      this.velocity.add(a.body.impulse).sub(this.consumedImpulse);
      this.consumedImpulse.copy(a.body.impulse);
      this.velocity.clampLength(0, IMPACT_LIMITS.velocity);
    }
    const severe = score >= s.knockdown || !a.body.active;
    if (severe) {
      if (!this.ownsMotion && this.hasPresentedPose) {
        this.jointAngles.set(this.presentedPose);
        this.orientation.copy(this.presentedOrientation);
      }
      if (!wasOwner) {
        this.velocity
          .copy(a.body.impulse)
          .addScaledVector(a.controller.velocity, 0.25);
        this.consumedImpulse.copy(a.body.impulse);
      }
      if (force >= s.knockdown * 1.8 && s.launch > 0) {
        this.phase = "flight";
        const launch =
          Math.min(200, Math.sqrt(force * 18) * 0.55 * s.launch) *
          (this.location === "leg" ? 0.65 : 1);
        if ((impact.up ?? 0) < -0.45) this.velocity.y -= launch;
        else
          this.velocity.y = Math.max(
            this.velocity.y,
            launch * (1 + Math.max(0, impact.up ?? 0) * 0.5),
          );
      } else this.phase = "knockdown";
      this.velocity.clampLength(0, IMPACT_LIMITS.velocity);
      this.angular
        .set(
          -this.localZ * (1.5 + Math.log1p(force)),
          this.style.includes("spinn") || this.style.includes("round")
            ? this.localX * 5
            : 0,
          this.localX * 3,
        )
        .multiplyScalar(s.rotation)
        .clampLength(0, IMPACT_LIMITS.angular);
      a.controller.parkour?.cancel(a.controller);
      a.controller.velocity.set(0, 0, 0);
      a.controller.jumpRequested = a.controller.dashRequested = false;
      if (a.controller.dash.active) a.controller.dash.finish("hit");
    } else if (!this.ownsMotion) {
      this.phase = score >= s.stagger * 2.5 ? "stumble" : "recoil";
    }
    if (score >= s.stagger)
      a.body.stagger = Math.max(
        a.body.stagger,
        0.24 / Math.sqrt(p.balance ?? 1),
      );
    else a.body.stagger = Math.min(a.body.stagger, 0.12);
    a.combat.cancelAttack("impact");
    // Apply a deterministic angular impulse; repeated hits blend current pose.
    this.jointRates[0] += clamp(-this.localZ * this.weight * 4, -8, 8);
    this.jointRates[2] += clamp(this.localX * this.weight * 3, -8, 8);
    if (this.location === "head")
      this.jointRates[3] += clamp(-this.localZ * this.weight * 8, -12, 12);
    for (let side = 0; side < 2; side++) {
      this.jointRates[(2 + side) * 3] -= Math.min(5, this.weight * 2);
      this.jointRates[(2 + side) * 3 + 2] +=
        (side === 0 ? -1 : 1) * Math.min(4, this.weight * 1.5);
      this.jointRates[(4 + side) * 3] -= Math.min(6, this.weight * 3);
    }
    if (this.location === "leg") {
      const side = this.localX < 0 ? 0 : 1;
      this.jointRates[(6 + side) * 3] -= Math.min(5, this.weight * 3);
      this.jointRates[(8 + side) * 3] += Math.min(6, this.weight * 4);
    }
  }
  update(dt) {
    if (!this.active || !Number.isFinite(dt) || dt <= 0) return false;
    const a = this.agent,
      s = this.settings;
    this.age += dt;
    this.elapsed += dt;
    const speed = clamp(s.recovery * (a.profile?.recovery ?? 1), 0.1, 20);
    if (this.phase === "recoil" || this.phase === "stumble") {
      this.weight *= Math.exp(-dt * 7 * speed);
      if (this.elapsed > (this.phase === "stumble" ? 0.65 : 0.4) / speed) {
        this.phase = "idle";
        this.weight = 0;
        this.agent.body.hitboxes = this.restBoxes;
      }
      this.integrateJoints(dt, speed);
      return false;
    }
    a.body.impulse.set(0, 0, 0);
    this.consumedImpulse.set(0, 0, 0);
    a.combat.cancelAttack("reaction");
    a.body.stagger = Math.max(a.body.stagger, 0.06);
    // The world sweep is continuous; avoid nesting centimetre-sized travel
    // steps inside the encounter's own high-speed substeps for every enemy.
    const count = Math.max(
      1,
      Math.min(
        IMPACT_LIMITS.physicsSteps,
        Math.ceil(Math.max(dt * 120, (this.velocity.length() * dt) / 4)),
      ),
    );
    const step = dt / count;
    for (let i = 0; i < count; i++) this.physics(step);
    if (
      this.phase === "fallen" &&
      a.body.active &&
      Math.abs(this.velocity.y) < 0.1 &&
      a.root.position.y <=
        (a.world.supportHeight?.(a.root.position, a.body.radius) ?? 0) + 0.03 &&
      this.elapsed > 0.65 / speed &&
      (!a.world.isSpaceFree ||
        a.world.isSpaceFree(a.root.position, a.body.radius, 1.95))
    ) {
      this.phase = "recover";
      this.elapsed = 0;
    }
    if (this.phase === "recover") {
      const t = clamp(this.elapsed / Math.max(0.18, 0.7 / speed), 0, 1),
        blend = 1 - Math.exp(-12 * dt * speed);
      this.orientation.slerp(this.deltaQ.identity(), blend);
      this.bodyHeight += (0.97 - this.bodyHeight) * blend;
      if (t === 1) {
        this.phase = "idle";
        this.weight = 0;
        this.orientation.identity();
        this.bodyHeight = 0.97;
        a.body.stagger = 0.05;
        a.controller.jump.land(a.root.position.y, 0);
        a.controller.velocity.copy(this.velocity).setY(0);
        a.body.hitboxes = this.restBoxes;
      }
    }
    this.integrateJoints(dt, speed);
    this.syncBoxes();
    a.controller.jump.height = a.root.position.y;
    a.controller.jump.verticalVelocity = this.velocity.y;
    a.controller.jump.phase = this.phase === "flight" ? "airborne" : "landing";
    a.controller.speed = Math.hypot(this.velocity.x, this.velocity.z);
    return this.ownsMotion;
  }
  physics(dt) {
    const a = this.agent,
      w = a.world,
      p = a.root.position;
    this.start.copy(p);
    const falling =
      this.phase === "flight" ||
      p.y > (w.supportHeight?.(p, a.body.radius) ?? 0) + 0.02;
    this.delta.copy(this.velocity).multiplyScalar(dt);
    if (falling) {
      this.delta.y -= 9 * dt * dt;
      this.velocity.y -= 18 * dt;
    } else {
      this.velocity.y = 0;
      this.delta.y = 0;
    }
    this.constrained = Boolean(w.isSpaceFree && !w.isSpaceFree(p, 1.15, 1.95));
    const radius = this.constrained ? a.body.radius : 1.15;
    if (w.sweep) {
      w.contactCount = 0;
      w.hasObstacleContact = false;
      w.sweep(this.start, this.delta, radius, 1.95, this.next);
    } else {
      w.move(this.start, this.delta, radius, this.next);
      this.next.y = Math.max(0, this.start.y + this.delta.y);
    }
    const collisionSpeed = this.velocity.length();
    const beforeY = this.velocity.y;
    w.resolveVelocity?.(this.velocity);
    const hitX = Math.abs(this.next.x - this.start.x - this.delta.x) > 1e-5,
      hitZ = Math.abs(this.next.z - this.start.z - this.delta.z) > 1e-5;
    if (hitX && Math.abs(this.next.x) >= w.halfSize - radius - 0.001)
      this.velocity.x = 0;
    if (hitZ && Math.abs(this.next.z) >= w.halfSize - radius - 0.001)
      this.velocity.z = 0;
    if (w.ceilingHit) this.velocity.y = Math.min(0, this.velocity.y);
    p.copy(this.next);
    const floor = w.supportHeight?.(p, a.body.radius) ?? 0;
    if ((w.floorHit || p.y <= floor + 0.0001) && beforeY < 0) {
      this.contactPoint.copy(p);
      this.contactPoint.y = floor;
      this.landings++;
      this.velocity.y = 0;
      this.phase = "fallen";
      this.elapsed = 0;
      this.angular.multiplyScalar(0.25);
      this.secondary(Math.abs(beforeY));
    } else if (
      (hitX || hitZ || w.ceilingHit) &&
      this.age - this.lastCollisionTime > 0.15
    ) {
      this.lastCollisionTime = this.age;
      this.collisions++;
      this.secondary(collisionSpeed);
      this.angular.multiplyScalar(0.6);
    }
    const drag = Math.exp(-(this.phase === "flight" ? 0.12 : 6) * dt);
    this.velocity.x *= drag;
    this.velocity.z *= drag;
    if (this.phase === "knockdown") {
      this.phase = "fallen";
      this.elapsed = 0;
    }
    if (this.phase === "flight" && !this.constrained) {
      this.euler.set(
        this.angular.x * dt,
        this.angular.y * dt,
        this.angular.z * dt,
      );
      this.deltaQ.setFromEuler(this.euler);
      this.orientation.multiply(this.deltaQ).normalize();
      this.angular.multiplyScalar(
        Math.exp(
          -dt * (this.ragdoll ? 0.25 : 0.7) * (a.profile?.aerialControl ?? 1),
        ),
      );
      this.bodyHeight = 0.97;
    } else if (this.phase !== "recover") {
      this.euler.set(
        this.constrained ? 0 : (-Math.sign(this.localZ || 1) * Math.PI) / 2,
        0,
        this.constrained ? 0 : this.localX * 0.15,
      );
      this.deltaQ.setFromEuler(this.euler);
      this.orientation.slerp(this.deltaQ, 1 - Math.exp(-10 * dt));
      this.bodyHeight +=
        ((this.constrained ? 0.8 : 0.3) - this.bodyHeight) *
        (1 - Math.exp(-12 * dt));
    }
  }
  secondary(speed) {
    this.weight = Math.max(this.weight, Math.min(2, Math.log1p(speed) / 3));
    this.jointRates[0] += Math.min(6, speed * 0.08);
    this.jointRates[3] += Math.min(4, speed * 0.04);
    if (
      this.settings.collisionDamage > 0 &&
      this.agent.body.active &&
      speed > 8
    ) {
      const body = this.agent.body;
      const damage = Math.min(
        10000,
        Math.max(0, speed - 8) * this.settings.collisionDamage * 0.25,
      );
      body.health = Math.max(0, body.health - damage);
      if (body.health === 0) {
        body.active = false;
        this.agent.collisionDefeated = true;
      }
      body.flash = 0.18;
    }
  }
  integrateJoints(dt, speed) {
    if (this.detail === false) return;
    const motor = this.phase === "recover" ? speed : 1;
    const steps = Math.max(
        1,
        Math.min(32, Math.ceil(dt * 120 * Math.max(1, motor))),
      ),
      h = dt / steps;
    for (let k = 0; k < steps; k++)
      for (let j = 0; j < this.jointAngles.length; j++) {
        const joint = Math.floor(j / 3),
          axis = j % 3;
        let target = 0;
        if (this.ownsMotion && this.phase !== "recover") {
          if (joint === 0) target = axis === 0 ? -0.12 : 0;
          if (joint === 1) target = axis === 0 ? 0.12 : 0;
          if (joint === 2 || joint === 3)
            target =
              axis === 2
                ? (joint === 2 ? -1 : 1) * 0.9
                : axis === 0
                  ? -0.25
                  : 0;
          if (joint === 4 || joint === 5) target = axis === 0 ? -0.35 : 0;
          if (joint === 6 || joint === 7)
            target =
              axis === 0 ? 0.2 : axis === 2 ? (joint === 6 ? -0.12 : 0.12) : 0;
          if (joint === 8 || joint === 9) target = axis === 0 ? 0.35 : 0;
          if (this.constrained) {
            if (joint === 2 || joint === 3) target = axis === 0 ? -0.15 : 0;
            if (joint === 4 || joint === 5) target = axis === 0 ? -0.8 : 0;
            if (joint === 6 || joint === 7) target = axis === 0 ? -0.7 : 0;
            if (joint === 8 || joint === 9) target = axis === 0 ? 1.4 : 0;
          }
          if (!this.constrained && this.ragdoll && this.phase === "flight")
            target +=
              clamp((this.age - 0.12) / 0.25, 0, 1) *
              Math.sin(this.age * 3 + joint * 1.7) *
              0.22 *
              (axis === 0 ? 1 : 0.4);
        }
        const stiffness = (this.ragdoll ? 28 : 55) * motor * motor,
          damping = (this.ragdoll ? 9 : 13) * motor;
        this.jointRates[j] +=
          ((target - this.jointAngles[j]) * stiffness -
            this.jointRates[j] * damping) *
          h;
        this.jointRates[j] = clamp(this.jointRates[j], -10, 10);
        this.jointAngles[j] = clamp(
          this.jointAngles[j] + this.jointRates[j] * h,
          (joint === 8 || joint === 9) && axis === 0
            ? 0
            : joint === 4 || joint === 5
              ? -2.2
              : -1.15,
          (joint === 8 || joint === 9) && axis === 0 ? 1.8 : 1.15,
        );
        if ((joint === 8 || joint === 9) && axis === 0)
          this.jointAngles[j] = clamp(this.jointAngles[j], 0, 1.8);
      }
  }
  syncBoxes() {
    const root = this.agent.root.position;
    const points = this.skeleton.sample(
      this,
      this.agent.controller.heading,
      this.detail !== false,
    );
    let correction = 0;
    if (this.phase === "flight" && this.detail !== false) {
      // The ballistic root represents the hull's lowest point, including while
      // inverted. Match the pose envelope instead of landing an empty capsule.
      let low = Infinity;
      for (const name of FLOOR_POINTS) {
        const radius =
          name === "head" ? 0.2 : name.endsWith("Toe") ? 0.05 : 0.08;
        low = Math.min(low, points[name].y - this.bodyHeight - radius);
      }
      const height = clamp(0.025 - low, 0.22, 1.15);
      correction = height - this.bodyHeight;
      this.bodyHeight = height;
    }
    if (this.ownsMotion && this.phase !== "flight" && this.detail !== false) {
      for (const name of FLOOR_POINTS) {
        const p = points[name];
        this.local.copy(p).add(root);
        const floor = this.agent.world.supportHeight?.(this.local, 0.04) ?? 0;
        const radius =
          name === "head" ? 0.2 : name.endsWith("Toe") ? 0.05 : 0.08;
        const penetration = floor + radius - this.local.y;
        if (penetration > correction || name === "head") {
          this.contactPoint.copy(this.local);
          this.contactPoint.y = floor;
        }
        correction = Math.max(correction, penetration);
      }
      correction = Math.min(1.2, Math.max(0, correction));
      this.bodyHeight += correction;
    }
    const centers = this.skeleton.core;
    for (let i = 0; i < this.boxes.length; i++) {
      const b = this.boxes[i],
        p = centers[i];
      b.previousX = b.x;
      b.previousZ = b.z;
      b.previousHeight = b.height;
      b.x = p.x;
      b.z = p.z;
      b.height = p.y + correction;
    }
    if (this.ownsMotion) this.agent.body.hitboxes = this.boxes;
  }

  snapshot() {
    return {
      phase: this.phase,
      force: this.force,
      location: this.location,
      ragdoll: this.ragdoll,
      sequence: this.sequence,
      velocity: this.velocity.toArray(),
      orientation: this.orientation.toArray(),
      bodyHeight: this.bodyHeight,
      landings: this.landings,
      collisions: this.collisions,
      contactPoint: this.contactPoint.toArray(),
    };
  }
}
