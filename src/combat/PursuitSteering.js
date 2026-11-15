import { Vector3 } from "three";
import { speedForMagnitude } from "../movement/AnalogueLocomotion.js";

/** Ground navigation intent only. The existing collision controller owns travel.
 * A future route planner can redirect this velocity without changing combat.
 * Local separation is cached; target/arrival feedback stays live each substep. */
export class PursuitSteering {
  constructor({ navigate = null } = {}) {
    this.navigate = navigate;
    this.velocity = new Vector3();
    this.separation = new Vector3();
    this.neighborTime = 0;
    this.queries = 0;
  }
  reset() {
    this.neighborTime = 0;
    this.separation.set(0, 0, 0);
    this.velocity.set(0, 0, 0);
  }
  update(dt, agent, player, targetVelocity, peers, mayAttack) {
    const p = agent.root.position,
      cfg = agent.settings,
      standard = cfg.speed <= 2;
    let dx = player.position.x - p.x,
      dz = player.position.z - p.z;
    const distance = Math.hypot(dx, dz);
    // Prediction is modest, distance-bounded, and never modifies strike reach.
    const predict =
      cfg.speed > 2 && distance > 2.5
        ? Math.min(0.3, (distance / Math.max(1, agent.runSpeed)) * 0.3) *
          Math.min(1, cfg.aggression)
        : 0;
    let lx = targetVelocity.x * predict,
      lz = targetVelocity.z * predict;
    const lead = Math.hypot(lx, lz),
      maxLead = Math.min(24, distance * 0.35);
    if (lead > maxLead) {
      lx *= maxLead / lead;
      lz *= maxLead / lead;
    }
    const angle = agent.index * 2.39996 + agent.wave * 0.35;
    const ring = mayAttack ? 0 : 1.9 / Math.sqrt(Math.max(0.5, cfg.aggression));
    let tx = dx + lx + Math.cos(angle) * ring,
      tz = dz + lz + Math.sin(angle) * ring;
    if (standard && mayAttack && distance < 0.82) tx = tz = 0;
    this.neighborTime -= dt;
    if (this.neighborTime <= 0) {
      // Preserve the established small-group footwork at normal speeds. Fast
      // actors/crowds cache neighborhoods independently of physical substeps.
      this.neighborTime =
        standard && cfg.maxEnemies <= 8 ? 0 : distance > 100 ? 0.15 : 0.05;
      this.queries++;
      this.separation.set(0, 0, 0);
      for (const peer of peers) {
        if (peer === agent || !peer.spawned || !peer.body.active) continue;
        const sx = p.x - peer.root.position.x,
          sz = p.z - peer.root.position.z,
          d = Math.hypot(sx, sz);
        const spacing = cfg.maxEnemies <= 8 ? 1.15 : 1.5;
        if (d < spacing && (!standard || d > 0.001)) {
          const side = agent.index < peer.index ? -1 : 1;
          const nx = d > 1e-5 ? sx / d : side,
            nz = d > 1e-5 ? sz / d : 0;
          const weight = (spacing - d) * 3;
          this.separation.x += nx * weight;
          this.separation.z += nz * weight;
        }
      }
    }
    let length = Math.hypot(tx, tz);
    if (length > 0.01) {
      const fx = tx / length,
        fz = tz / length;
      for (const obstacle of agent.world.obstacles) {
        if (
          obstacle.dynamic ||
          obstacle.active === false ||
          !(obstacle.radius > 0)
        )
          continue;
        const ox = obstacle.position.x - p.x,
          oz = obstacle.position.z - p.z;
        const ahead = ox * fx + oz * fz,
          lateral = ox * fz - oz * fx,
          clearance = agent.body.radius + obstacle.radius + 0.25;
        if (ahead <= 0 || ahead > 1.8 || Math.abs(lateral) >= clearance)
          continue;
        const side =
          Math.abs(lateral) > 0.01
            ? Math.sign(lateral)
            : agent.index % 2
              ? -1
              : 1;
        const force =
          (1 - Math.abs(lateral) / clearance) * Math.max(1, length) * 1.8;
        tx -= fz * side * force;
        tz += fx * side * force;
      }
    }
    tx += this.separation.x;
    tz += this.separation.z;
    length = Math.hypot(tx, tz);
    // The collision world samples moving bodies at the start of a substep.
    // Leave one step of measured target travel so matched-speed pursuit does
    // not repeatedly run into that older footprint and lose all momentum.
    const travelBuffer =
      cfg.speed > 2 && length > 1e-6
        ? Math.max(
            0,
            (targetVelocity.x * tx + targetVelocity.z * tz) / length,
          ) * dt
        : 0;
    const stop =
      (mayAttack ? (cfg.speed > 2 ? 0.72 : 0.82) : 0.12) + travelBuffer;
    // Critically damped arrival with the same acceleration response as travel.
    // Large multipliers increase cruise speed, not the near-target orbit radius.
    const response = agent.controller.config.analogue.accelerationResponse;
    const gain = Math.min(response * 0.24, 2.7 * Math.max(0.4, cfg.aggression));
    const speed = standard
      ? length > 0.08
        ? speedForMagnitude(
            Math.min(1, length / 1.8),
            agent.controller.config.analogue,
          )
        : 0
      : Math.min(
          agent.runSpeed,
          Math.max(
            cfg.speed > 2 ? -agent.runSpeed * 0.25 : 0,
            (length - stop) * gain,
          ),
        );
    this.velocity.set(
      length > 1e-6 ? (tx / length) * speed : 0,
      0,
      length > 1e-6 ? (tz / length) * speed : 0,
    );
    // Arrival feedback alone trails a continuously moving target by v/gain.
    // Match its measured velocity before adding the closing correction; this
    // is steering intent, still acceleration- and collision-resolved below.
    if (cfg.speed > 2)
      this.velocity.addScaledVector(
        targetVelocity,
        Math.min(1, 0.6 + cfg.aggression * 0.4),
      );
    if (this.velocity.lengthSq() > agent.runSpeed * agent.runSpeed)
      this.velocity.setLength(agent.runSpeed);
    this.navigate?.(agent, this.velocity, player.position);
    return this.velocity;
  }
}
