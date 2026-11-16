import { Vector3 } from "three";
import { GroundObstacleAvoidance } from "./GroundObstacleAvoidance.js";

const TAU = Math.PI * 2;
const OFFSETS_MEDIUM = [0, 0.65, -0.65, 1.3, -1.3, 1.95, -1.95, Math.PI];
const OFFSETS_HIGH = [
  0,
  0.4,
  -0.4,
  0.8,
  -0.8,
  1.2,
  -1.2,
  1.65,
  -1.65,
  2.2,
  -2.2,
  Math.PI,
];

/** Ground-level escape intent only. This planner never changes transforms or
 * physics state. Bounded direction probes use the shared static spatial index;
 * cached peer separation and committed choices are independent of substeps.
 * A future enemy traversal planner can replace navigation without changing
 * tag detection, human movement or the combat state machine. */
export class EvasionSteering {
  constructor(world) {
    this.world = world;
    this.velocity = new Vector3();
    this.direction = new Vector3();
    this.separation = new Vector3();
    this.delta = new Vector3();
    this.goal = new Vector3();
    this.navigation = new GroundObstacleAvoidance(world);
    this.reset();
  }
  reset() {
    this.velocity.set(0, 0, 0);
    this.direction.set(0, 0, 0);
    this.separation.set(0, 0, 0);
    this.threatened = false;
    this.lostTime =
      this.decisionTime =
      this.decisionAge =
      this.neighborTime =
        0;
    this.decisions = this.queries = this.neighborQueries = 0;
    this.navigation.reset();
  }
  boundaryDistance(p, x, z, limit) {
    return Math.max(
      0,
      Math.min(
        x > 1e-8
          ? (limit - p.x) / x
          : x < -1e-8
            ? (-limit - p.x) / x
            : Infinity,
        z > 1e-8
          ? (limit - p.z) / z
          : z < -1e-8
            ? (-limit - p.z) / z
            : Infinity,
      ),
    );
  }
  choose(agent, player, playerVelocity, fx, fz) {
    this.decisions++;
    const p = agent.root.position,
      cfg = agent.tagSettings;
    const speed = Math.max(agent.runSpeed, agent.controller.velocity.length());
    const probe = Math.max(4, Math.min(100, speed * 0.65));
    const limit = this.world.halfSize - agent.body.radius - 0.2;
    const base = Math.atan2(fz, fx);
    const offsets = cfg.intelligence > 1 ? OFFSETS_HIGH : OFFSETS_MEDIUM;
    const side = agent.index % 2 ? -1 : 1;
    let scoreBest = -Infinity,
      bestX = fx,
      bestZ = fz;
    for (let i = 0; i < offsets.length; i++) {
      const a = base + offsets[i] * side,
        x = Math.cos(a),
        z = Math.sin(a);
      let clearance = Math.min(probe, this.boundaryDistance(p, x, z, limit));
      if (this.world.firstBlock && clearance > 1e-6) {
        this.delta.set(x * clearance, 0, z * clearance);
        const hit = this.world.firstBlock(
          p,
          this.delta,
          agent.body.radius + 0.12,
          1.8,
        );
        this.queries++;
        if (hit) clearance *= Math.max(0, hit.fraction);
      }
      // Prefer a real open escape corridor over a tiny directly-away step.
      // An almost blocked choice may reverse toward the player to exit a
      // corner, rather than endlessly pushing into the same wall.
      let score = (clearance / probe) * 5 + (x * fx + z * fz) * 1.6;
      score += (x * this.direction.x + z * this.direction.z) * 0.5;
      score += (x * this.separation.x + z * this.separation.z) * 0.2;
      if (clearance < Math.min(1.3, probe * 0.25)) score -= 4;
      if (cfg.intelligence > 1) {
        // Score a short future encounter, not a permanently selected target
        // heading. Prediction is capped even at superhuman velocity.
        const horizon = Math.min(0.4, clearance / Math.max(1, speed));
        let px = playerVelocity.x * horizon,
          pz = playerVelocity.z * horizon;
        const lead = Math.hypot(px, pz),
          maxLead = Math.min(24, probe * 0.6);
        if (lead > maxLead) {
          px *= maxLead / lead;
          pz *= maxLead / lead;
        }
        const futureX = p.x + x * clearance - player.position.x - px;
        const futureZ = p.z + z * clearance - player.position.z - pz;
        score += Math.min(2.5, Math.hypot(futureX, futureZ) / probe) * 0.65;
        score +=
          ((x * agent.controller.velocity.x + z * agent.controller.velocity.z) /
            Math.max(1, speed)) *
          0.25;
      }
      if (score > scoreBest + 1e-6) {
        scoreBest = score;
        bestX = x;
        bestZ = z;
      }
    }
    if (bestX * this.direction.x + bestZ * this.direction.z < 0.45)
      this.navigation.reset();
    this.direction.set(bestX, 0, bestZ);
    const distance = Math.max(12, Math.min(160, probe * 2));
    this.goal.set(
      Math.max(-limit, Math.min(limit, p.x + bestX * distance)),
      p.y,
      Math.max(-limit, Math.min(limit, p.z + bestZ * distance)),
    );
  }
  update(dt, agent, player, playerVelocity, peers) {
    if (!Number.isFinite(dt) || dt <= 0) return this.velocity;
    const p = agent.root.position,
      cfg = agent.tagSettings;
    let fx = p.x - player.position.x,
      fz = p.z - player.position.z;
    const distance = Math.hypot(fx, p.y - player.position.y, fz);
    if (!player.active || !agent.body.active) {
      this.threatened = false;
      return this.velocity.set(0, 0, 0);
    }
    if (distance <= cfg.detection) {
      this.threatened = true;
      this.lostTime = 0;
    } else if (distance > cfg.detection * 1.25) {
      this.lostTime += dt;
      if (this.lostTime > 0.6) this.threatened = false;
    } else this.lostTime = 0;
    if (!this.threatened) return this.velocity.set(0, 0, 0);

    this.neighborTime -= dt;
    if (this.neighborTime <= 0) {
      this.neighborTime = 0.08;
      this.neighborQueries++;
      this.separation.set(0, 0, 0);
      if (cfg.intelligence > 0)
        for (const peer of peers) {
          if (peer === agent || !peer.spawned || !peer.body.active) continue;
          const dx = p.x - peer.root.position.x,
            dz = p.z - peer.root.position.z;
          const d = Math.hypot(dx, dz),
            spacing = 1.7;
          if (d >= spacing) continue;
          const weight = (spacing - d) / spacing;
          this.separation.x +=
            (d > 1e-6 ? dx / d : agent.index < peer.index ? -1 : 1) * weight;
          this.separation.z += (d > 1e-6 ? dz / d : 0) * weight;
        }
    }
    if (cfg.intelligence > 1) {
      const horizon = Math.min(
        0.25,
        (distance / Math.max(1, agent.runSpeed)) * 0.3,
      );
      let leadX = playerVelocity.x * horizon,
        leadZ = playerVelocity.z * horizon;
      const length = Math.hypot(leadX, leadZ),
        bound = Math.min(20, distance * 0.45);
      if (length > bound) {
        leadX *= bound / length;
        leadZ *= bound / length;
      }
      fx -= leadX;
      fz -= leadZ;
    }
    fx += this.separation.x * 2;
    fz += this.separation.z * 2;
    let length = Math.hypot(fx, fz);
    if (length < 1e-6) {
      const angle = (agent.index * 2.39996) % TAU;
      fx = Math.cos(angle);
      fz = Math.sin(angle);
      length = 1;
    }
    fx /= length;
    fz /= length;
    if (cfg.intelligence === 0) {
      // The intentionally simple level still turns away from the outer edge,
      // rather than standing against it indefinitely. Static wall collision
      // remains the controller's responsibility at every intelligence level.
      const margin = Math.max(3, Math.min(100, agent.runSpeed * 0.7));
      const limit = this.world.halfSize - agent.body.radius;
      if (limit - Math.abs(p.x) < margin) fx -= Math.sign(p.x) * 1.8;
      if (limit - Math.abs(p.z) < margin) fz -= Math.sign(p.z) * 1.8;
      this.direction.set(fx, 0, fz).normalize();
      return this.velocity.copy(this.direction).multiplyScalar(agent.runSpeed);
    }
    this.decisionTime -= dt;
    this.decisionAge += dt;
    // Sudden approach changes can prompt a fresh choice, but no physical
    // substep can cause a left/right decision oscillation every frame.
    const reverse = this.direction.x * fx + this.direction.z * fz < 0.2;
    if (this.decisionTime <= 0 || (reverse && this.decisionAge >= 0.08)) {
      this.choose(agent, player, playerVelocity, fx, fz);
      this.decisionTime = cfg.intelligence > 1 ? 0.14 : 0.22;
      this.decisionAge = 0;
    }
    this.velocity.copy(this.direction).multiplyScalar(agent.runSpeed);
    this.navigation.update(agent, this.velocity, this.goal, dt);
    return this.velocity;
  }
}
