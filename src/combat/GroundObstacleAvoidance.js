import { Vector3 } from "three";
import { structureBounds } from "../world/StructureIndex.js";
import { sweepBox, sweepPole } from "../world/TraversalWorld.js";

/** Small local ground detours, not a global navigator or enemy parkour. A
 * committed one-obstacle route avoids oscillating between sides of a wall. */
export class GroundObstacleAvoidance {
  constructor(world) {
    this.world = world;
    this.corners = Array.from({ length: 4 }, () => new Vector3());
    this.route = Array.from({ length: 4 }, () => new Vector3());
    this.sourceVisible = new Uint8Array(4);
    this.targetVisible = new Uint8Array(4);
    this.edges = new Uint8Array(4);
    this.delta = new Vector3();
    this.normal = new Vector3();
    this.flatGoal = new Vector3();
    this.reset();
  }
  reset() {
    this.obstacle = null;
    this.count = this.cursor = 0;
    this.timer = 0;
    this.plans = 0;
  }
  blocked(a, b, r) {
    this.delta.subVectors(b, a);
    return !!this.world.firstBlock(a, this.delta, r, 1.8);
  }
  plan(p, goal, obstacle, radius) {
    this.plans++;
    const b = structureBounds(obstacle),
      pad = radius + 0.65,
      c = this.corners;
    c[0].set(b.minX - pad, p.y, b.minZ - pad);
    c[1].set(b.maxX + pad, p.y, b.minZ - pad);
    c[2].set(b.maxX + pad, p.y, b.maxZ + pad);
    c[3].set(b.minX - pad, p.y, b.maxZ + pad);
    for (let i = 0; i < 4; i++) {
      this.sourceVisible[i] = !this.blocked(p, c[i], radius + 0.08);
      this.delta.subVectors(goal, c[i]);
      this.targetVisible[i] = !Number.isFinite(
        (obstacle.kind === "pole" ? sweepPole : sweepBox)(
          c[i],
          this.delta,
          obstacle,
          radius + 0.08,
          1.8,
          this.normal,
        ),
      );
      this.edges[i] = !this.blocked(c[i], c[(i + 1) % 4], radius + 0.08);
    }
    let best = Infinity,
      start = -1,
      direction = 1,
      steps = 0;
    for (let i = 0; i < 4; i++)
      if (this.sourceVisible[i])
        for (const sign of [-1, 1]) {
          let length = p.distanceTo(c[i]),
            valid = true;
          for (let n = 0; n < 4; n++) {
            const j = (i + sign * n + 8) % 4;
            if (this.targetVisible[j] && valid) {
              const score = length + c[j].distanceTo(goal);
              if (score < best) {
                best = score;
                start = i;
                direction = sign;
                steps = n;
              }
            }
            const k = (j + sign + 4) % 4,
              edge = sign > 0 ? j : k;
            valid &&= !!this.edges[edge];
            length += c[j].distanceTo(c[k]);
          }
        }
    this.count = 0;
    this.cursor = 0;
    if (start >= 0)
      for (let n = 0; n <= steps; n++)
        this.route[this.count++].copy(c[(start + direction * n + 8) % 4]);
    this.obstacle = obstacle;
  }
  update(agent, velocity, goal, dt) {
    if (!this.world.firstBlock || velocity.lengthSq() < 1e-8) return;
    const p = agent.root.position,
      speed = velocity.length();
    this.flatGoal.copy(goal).setY(p.y);
    this.delta.subVectors(this.flatGoal, p);
    const distance = this.delta.length();
    if (distance < 0.2) return;
    this.delta.setLength(
      Math.min(distance, Math.max(4, Math.min(128, speed * 0.4))),
    );
    const hit = this.world.firstBlock(
      p,
      this.delta,
      agent.body.radius + 0.12,
      1.8,
    );
    if (!hit) {
      this.obstacle = null;
      this.count = this.cursor = 0;
      return;
    }
    const obstacle = hit.structure;
    this.timer -= dt;
    if (
      this.obstacle !== obstacle ||
      (this.cursor >= this.count && this.count > 0) ||
      (this.timer <= 0 &&
        (this.count === 0 ||
          this.blocked(p, this.route[this.cursor], agent.body.radius + 0.04)))
    ) {
      this.plan(p, this.flatGoal, obstacle, agent.body.radius);
      this.timer = 0.15;
    }
    while (
      this.cursor < this.count &&
      p.distanceTo(this.route[this.cursor]) <
        Math.max(0.45, Math.min(2, speed * dt * 1.2))
    )
      this.cursor++;
    if (this.cursor < this.count) {
      velocity.subVectors(this.route[this.cursor], p).setY(0);
      if (velocity.lengthSq() > 1e-8) velocity.setLength(speed);
    } else if (this.count === 0) velocity.set(0, 0, 0);
  }
}
