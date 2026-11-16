import { Vector3 } from "three";

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

/** Ability-aware local traversal intent. The character controller remains the
 * sole owner of translation, gravity, collision response and jump counts.
 * Decisions are cached; a route is a surface reference plus a desired landing
 * point, rather than an expensive global graph or a scripted root-motion path. */
export class EnemyTraversalPlanner {
  constructor(world) {
    this.world = world;
    this.velocity = new Vector3();
    this.goal = new Vector3();
    this.delta = new Vector3();
    this.normal = new Vector3();
    this.lastPosition = new Vector3();
    this.escapeIntent = new Vector3();
    this.jumpProbe = new Vector3();
    this.surfaceSample = { normal: new Vector3(), gap: 0, insideSpan: false };
    this.jumpInput = { move: { x: 0, y: 0 }, movementMagnitude: 1 };
    this.candidates = [];
    this.reset();
  }
  reset() {
    this.surface = this.failedSurface = null;
    this.decisionTime =
      this.jumpCooldown =
      this.failureTime =
      this.obstacleTime =
        0;
    this.progressTime = this.stalledTime = this.attachedTime = 0;
    this.lastPosition.set(0, 0, 0);
    this.velocity.set(0, 0, 0);
    this.goal.set(0, 0, 0);
    this.state = "ground";
    this.queries = this.decisions = this.jumpRequests = 0;
    this.initialized = false;
    this.wasAirborne = false;
  }
  /** Ballistic upper bound, deliberately conservative about horizontal reach.
   * A second launch resets vertical speed at its apex; it is not an impulse
   * stack. Collision clearance still decides whether the real flight succeeds. */
  reachable(agent, point, reserve = 0.85) {
    const c = agent.controller,
      p = agent.root.position;
    const rise = point.y - p.y,
      height = c.jump.config.height;
    const jumps = Math.max(1, c.jump.config.maxJumps);
    if (rise > height * jumps * reserve + 0.15) return false;
    const g = c.jump.config.gravity,
      launch = c.jump.launchVelocity;
    const flight =
      ((2 * launch) / g) * jumps + Math.sqrt(Math.max(0, (-2 * rise) / g));
    return (
      Math.hypot(point.x - p.x, point.z - p.z) <=
      Math.max(1.5, agent.runSpeed * flight * reserve)
    );
  }
  setGoalOn(s, p, radius) {
    this.goal.y = s.top;
    if (s.kind === "pole") this.goal.set(s.x, s.top, s.z);
    else {
      const inset = Math.min(
        radius + 0.55,
        (s.maxX - s.minX) * 0.3,
        (s.maxZ - s.minZ) * 0.3,
      );
      this.goal.x = clamp(p.x, s.minX + inset, s.maxX - inset);
      this.goal.z = clamp(p.z, s.minZ + inset, s.maxZ - inset);
    }
  }
  containsXZ(s, p, pad = 0) {
    return s.kind === "pole"
      ? Math.hypot(p.x - s.x, p.z - s.z) <= s.radius + pad
      : p.x >= s.minX - pad &&
          p.x <= s.maxX + pad &&
          p.z >= s.minZ - pad &&
          p.z <= s.maxZ + pad;
  }
  candidatesNear(p, radius) {
    this.queries++;
    if (this.world.spatialIndex)
      this.world.spatialIndex.query(
        p.x - radius,
        p.x + radius,
        p.z - radius,
        p.z + radius,
        this.candidates,
      );
    else {
      this.candidates.length = 0;
      if (this.world.query)
        for (const s of this.world.query(
          p.x - radius,
          p.x + radius,
          p.z - radius,
          p.z + radius,
        ))
          this.candidates.push(s);
    }
    return this.candidates;
  }
  choose(agent, player, mode, groundVelocity) {
    this.decisions++;
    const p = agent.root.position,
      profile = agent.profile,
      c = agent.controller;
    const escape = mode === "tag";
    // Keep the authored landing surface for the whole physical flight. Merely
    // crossing its footprint high in the air is not a completed route, and
    // rescoring here can otherwise send the fighter back toward the old roof.
    if (
      this.surface &&
      c.jump.airborne &&
      (escape || !c.parkour?.attached || player.position.y >= p.y - 2) &&
      this.surface !== this.failedSurface
    )
      return;
    this.surface = null;
    this.goal.copy(player.position);
    // Ground-only profiles keep the old ground planner, including its safe
    // routes around walls. They can still jump genuinely low barriers.
    const canAscend = profile.climb || profile.ledgeGrab || profile.rooftop;
    if (!canAscend && !profile.wallRun) return;
    const radius = Math.min(
      120,
      Math.max(18, agent.runSpeed * 0.85, Math.sqrt(c.jump.config.height) * 7),
    );
    const list = this.candidatesNear(p, radius);
    let best = -Infinity;
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      if (!s.climbable || (s === this.failedSurface && this.failureTime > 0))
        continue;
      if (!escape && s.top > player.position.y + 1.6) continue;
      const rise = s.top - p.y;
      const roofGap =
        p.y > 1 &&
        profile.rooftop &&
        rise > -2 &&
        Math.abs(rise) < 3 &&
        !this.containsXZ(s, p, agent.body.radius + 0.08);
      if (
        (rise < 0.35 && !roofGap) ||
        (s.bottom > p.y + 1.7 && !profile.rooftop)
      )
        continue;
      this.setGoalOn(s, p, agent.body.radius);
      const dx = this.goal.x - p.x,
        dz = this.goal.z - p.z;
      const distance = Math.hypot(dx, dz);
      // A suspended branch/canopy needs a real launch, while a ground-supported
      // tower remains indefinitely climbable regardless of its total height.
      const climbable = profile.climb && s.bottom <= p.y + 1.7;
      if (!climbable && !this.reachable(agent, this.goal)) continue;
      if (!profile.rooftop && !profile.wallRun && !profile.climb) continue;
      let score;
      if (escape) {
        const away =
          (dx * groundVelocity.x + dz * groundVelocity.z) /
          Math.max(0.1, agent.runSpeed * Math.max(1, distance));
        const currentThreat = p.distanceTo(player.position);
        const futureThreat = this.goal.distanceTo(player.position);
        if (roofGap && futureThreat < currentThreat + 0.5) continue;
        score =
          Math.min(80, rise) * 0.23 +
          away * 8 +
          clamp(futureThreat - currentThreat, -20, 40) * 0.3 -
          distance * 0.35;
      } else {
        const verticalError = Math.abs(s.top - player.position.y);
        const targetDistance = this.goal.distanceTo(player.position);
        if (roofGap && targetDistance > p.distanceTo(player.position) + 0.2)
          continue;
        if (
          player.position.y <= p.y + 0.8 &&
          !c.parkour?.attached &&
          !(roofGap && player.position.y >= p.y - 2)
        )
          continue;
        score =
          50 - verticalError * 1.5 - targetDistance * 0.5 - distance * 0.25;
      }
      // Prefer an already chosen nearby surface to avoid oscillating between
      // equal neighbouring boxes every decision tick.
      if (s === c.parkour?.surface) score += 4;
      if (score > best) {
        best = score;
        this.surface = s;
        this.normal.copy(this.goal);
      }
    }
    if (this.surface) this.goal.copy(this.normal);
    else if (escape) {
      this.goal
        .copy(p)
        .addScaledVector(
          groundVelocity,
          Math.min(2, c.jump.flightDuration * 0.65),
        );
      this.goal.y = p.y;
    }
  }
  requestJump(agent, direction, cooldown = true) {
    if (!agent.controller.canJump) return false;
    const c = agent.controller;
    if (
      c.jump.canActOnGround &&
      !c.parkour?.attached &&
      this.world.firstBlock
    ) {
      this.jumpProbe.set(0, Math.min(1.2, c.jump.config.height), 0);
      this.queries++;
      const roof = this.world.firstBlock(
        agent.root.position,
        this.jumpProbe,
        agent.body.radius,
        1.8,
      );
      if (roof && roof.normal.y < -0.5) {
        this.failedSurface = this.surface;
        this.failureTime = 4;
        this.surface = null;
        this.jumpCooldown = Math.max(0.8, agent.profile.jumpInterval * 0.5);
        this.state = "headroom-blocked";
        return false;
      }
    }
    const length = Math.hypot(direction.x, direction.z);
    this.jumpInput.move.x = length > 1e-6 ? direction.x / length : 0;
    this.jumpInput.move.y = length > 1e-6 ? -direction.z / length : 0;
    if (!agent.controller.requestJump(this.jumpInput, 0)) return false;
    this.jumpRequests++;
    if (cooldown) this.jumpCooldown = agent.profile.jumpInterval;
    return true;
  }
  attached(agent, player, mode, groundVelocity) {
    const c = agent.controller,
      k = c.parkour,
      profile = agent.profile;
    const ledge = k.mode === "ledge";
    const mounting =
      k.mode === "mantle" ||
      k.mode === "vault" ||
      k.mode === "pole-mantle" ||
      k.mode === "perch";
    if (
      (!profile.climb && !profile.wallRun && !profile.ledgeGrab) ||
      (ledge && !profile.ledgeGrab && !(profile.climb && profile.rooftop)) ||
      (k.mode === "pole-climb" && !profile.climb) ||
      (mounting && !profile.rooftop)
    ) {
      k.cancel(c);
      this.failedSurface = k.blockedSurface;
      this.failureTime = 1;
      this.surface = null;
      return this.velocity.copy(groundVelocity);
    }
    this.state = k.mode;
    this.delta
      .subVectors(
        this.surface ? this.goal : player.position,
        agent.root.position,
      )
      .setY(0);
    const length = this.delta.length();
    if (length > 1e-6) this.delta.divideScalar(length);
    const away = this.delta.dot(k.normal);
    const otherSurface = this.surface && this.surface !== k.surface;
    const pursueLower =
      mode === "combat" && player.position.y < agent.root.position.y - 4;
    if (
      this.jumpCooldown === 0 &&
      this.attachedTime > 0.3 &&
      ((otherSurface && away > 0.1 && this.reachable(agent, this.goal)) ||
        (pursueLower && away > 0.2) ||
        this.stalledTime > 1.2)
    ) {
      if (this.stalledTime > 1.2) {
        this.delta.copy(k.normal);
        this.failedSurface = k.surface;
        this.failureTime = 4;
        this.surface = null;
      }
      if (this.requestJump(agent, this.delta)) {
        this.state = "wall-jump";
        this.stalledTime = 0;
        if (!otherSurface) this.surface = null;
        return this.velocity.copy(this.delta).multiplyScalar(agent.runSpeed);
      }
    }
    const canRise =
      profile.climb || (ledge && profile.ledgeGrab && profile.rooftop);
    const needRise = this.surface
      ? this.goal.y > agent.root.position.y - 0.1
      : mode === "tag" || player.position.y > agent.root.position.y + 0.5;
    let lateral = this.delta.dot(k.tangent);
    if (ledge && !profile.rooftop) {
      this.velocity
        .copy(k.tangent)
        .multiplyScalar(
          profile.wallRun ? lateral * Math.min(3, agent.runSpeed) : 0,
        );
      return this.velocity;
    }
    if (ledge && !profile.ledgeGrab && profile.climb && profile.rooftop) {
      // Direct climbing crest; this profile cannot remain in a hanging pose.
      k.stage = "lift";
      k.setMode("mantle");
    }
    if (canRise && needRise) {
      // Toward-wall pressure is vertical climb input in the shared controller.
      this.velocity.copy(k.normal).multiplyScalar(-1);
      if (profile.wallRun && Math.abs(lateral) > 0.35)
        this.velocity.addScaledVector(k.tangent, lateral * 0.55);
    } else if (profile.wallRun && Math.abs(lateral) > 0.1) {
      this.velocity.copy(k.tangent).multiplyScalar(Math.sign(lateral));
    } else if (ledge && profile.ledgeGrab) this.velocity.set(0, 0, 0);
    else {
      this.velocity.copy(k.normal);
      k.cancel(c);
    }
    if (this.velocity.lengthSq() > 1e-8)
      this.velocity.setLength(agent.runSpeed);
    return this.velocity;
  }
  update(dt, agent, player, playerVelocity, mode, groundVelocity) {
    this.velocity.copy(groundVelocity);
    if (!Number.isFinite(dt) || dt <= 0 || !agent.profile || !player.active)
      return this.velocity;
    const c = agent.controller,
      p = agent.root.position,
      profile = agent.profile;
    const k = c.parkour;
    this.jumpCooldown = Math.max(0, this.jumpCooldown - dt);
    this.failureTime = Math.max(0, this.failureTime - dt);
    if (this.failureTime === 0) this.failedSurface = null;
    this.decisionTime -= dt;
    this.obstacleTime -= dt;
    if (
      this.wasAirborne &&
      c.jump.grounded &&
      this.surface &&
      p.y < this.surface.top - 0.3
    ) {
      this.failedSurface = this.surface;
      this.failureTime = 4;
      this.surface = null;
      this.decisionTime = 0;
    }
    this.wasAirborne = c.jump.airborne;
    if (!this.initialized) {
      this.lastPosition.copy(p);
      this.initialized = true;
    }
    this.progressTime += dt;
    if (this.progressTime >= 0.25) {
      const moving = groundVelocity.lengthSq() > 0.01 || k?.attached;
      this.stalledTime =
        moving && p.distanceToSquared(this.lastPosition) < 0.005
          ? this.stalledTime + this.progressTime
          : 0;
      this.lastPosition.copy(p);
      this.progressTime = 0;
    }
    this.attachedTime = k?.attached ? this.attachedTime + dt : 0;
    if (mode === "tag" && groundVelocity.lengthSq() < 0.001 && !k?.attached) {
      const threatened = agent.alerted || agent.evasion?.threatened;
      const canEscapeVertically =
        profile.climb ||
        profile.rooftop ||
        profile.ledgeGrab ||
        profile.wallRun ||
        profile.jumpHeight >= 3;
      if (!threatened || !canEscapeVertically) {
        this.state = threatened ? "ground" : "idle";
        return this.velocity;
      }
      // The ground detour solver may return zero inside a blocked corner.
      // That is not lost threat: capable agents can select a genuine vertical
      // route or ballistic leap instead of waiting for the pursuer to leave.
      this.escapeIntent.subVectors(p, player.position).setY(0);
      if (this.escapeIntent.lengthSq() < 1e-8)
        this.escapeIntent.set(-Math.sin(c.heading), 0, -Math.cos(c.heading));
      this.escapeIntent.setLength(agent.runSpeed);
      groundVelocity = this.escapeIntent;
      this.velocity.copy(groundVelocity);
    }
    if (this.decisionTime <= 0) {
      this.choose(agent, player, mode, groundVelocity);
      this.decisionTime =
        p.distanceToSquared(player.position) > 160 * 160 ? 0.6 : 0.2;
    }
    if (k?.attached) return this.attached(agent, player, mode, groundVelocity);
    this.state = c.jump.airborne ? "air" : "ground";
    if (this.surface) {
      this.delta.subVectors(this.goal, p).setY(0);
      const distance = this.delta.length();
      if (
        p.y >= this.surface.top - 0.08 &&
        c.jump.grounded &&
        this.containsXZ(this.surface, p, agent.body.radius * 0.4)
      ) {
        this.state = "rooftop";
        this.surface = null;
        this.decisionTime = Math.max(this.decisionTime, 0.35);
      } else if (distance > 0.05) {
        let speed = agent.runSpeed;
        if (c.jump.airborne && p.y > this.goal.y - 0.2)
          speed = Math.min(
            speed,
            distance * Math.max(1.5, c.jump.config.airControl * 0.5),
          );
        this.velocity.copy(this.delta).setLength(speed);
      } else this.velocity.set(0, 0, 0);
    } else if (
      mode === "combat" &&
      c.jump.airborne &&
      player.position.y > p.y - 1
    ) {
      this.delta.subVectors(player.position, p).setY(0);
      const distance = this.delta.length();
      if (distance > 0.01)
        this.velocity
          .copy(this.delta)
          .setLength(
            Math.min(
              agent.runSpeed,
              distance * Math.max(1.5, c.jump.config.airControl * 0.5),
            ),
          );
    }
    if (c.jump.airborne) {
      const targetY = this.surface
        ? this.goal.y
        : mode === "combat"
          ? player.position.y
          : p.y + profile.jumpHeight;
      const horizontalNeed =
        this.surface &&
        !this.containsXZ(this.surface, p, agent.body.radius) &&
        Math.hypot(this.goal.x - p.x, this.goal.z - p.z) >
          Math.max(1.1, agent.runSpeed * c.jump.timeToLanding * 0.75);
      const remainingRise =
        (c.jump.config.maxJumps - c.jump.jumpCount) * c.jump.config.height;
      if (
        c.jump.jumpCount < c.jump.config.maxJumps &&
        c.jump.verticalVelocity <= c.jump.launchVelocity * 0.12 &&
        targetY - p.y <= remainingRise + 0.15 &&
        (targetY > p.y + Math.min(0.5, c.jump.config.height * 0.15) ||
          horizontalNeed)
      )
        this.requestJump(agent, this.velocity, false);
      return this.velocity;
    }
    if (!c.jump.canActOnGround || this.jumpCooldown > 0) return this.velocity;
    if (
      this.surface &&
      profile.rooftop &&
      this.reachable(agent, this.goal) &&
      (this.goal.y > p.y + 0.25 ||
        (p.y > 1 && !this.containsXZ(this.surface, p, agent.body.radius)))
    ) {
      this.delta.subVectors(this.goal, p).setY(0);
      if (this.requestJump(agent, this.delta)) this.state = "leap";
    } else if (
      mode === "combat" &&
      player.position.y > p.y + 0.45 &&
      this.reachable(agent, player.position) &&
      p.distanceTo(player.position) <
        Math.max(3, agent.runSpeed * c.jump.flightDuration)
    ) {
      if (this.requestJump(agent, this.velocity)) this.state = "jump";
    } else if (
      mode === "tag" &&
      profile.jumpHeight >= 3 &&
      p.distanceToSquared(player.position) <
        Math.max(8, agent.runSpeed * 2) ** 2
    ) {
      if (this.requestJump(agent, this.velocity)) this.state = "escape-leap";
    } else if (
      this.world.firstBlock &&
      this.velocity.lengthSq() > 0.01 &&
      this.obstacleTime <= 0
    ) {
      this.obstacleTime = 0.15;
      this.delta
        .copy(this.velocity)
        .setLength(
          Math.min(
            4,
            Math.max(1, agent.runSpeed * c.jump.flightDuration * 0.3),
          ),
        );
      this.queries++;
      const hit = this.world.firstBlock(p, this.delta, agent.body.radius, 1.8);
      if (
        hit &&
        hit.structure.top - p.y > 0.15 &&
        hit.structure.top - p.y < c.jump.config.height * 0.9 &&
        hit.structure.bottom <= p.y + 0.1
      ) {
        if (this.requestJump(agent, this.velocity))
          this.state = "obstacle-jump";
      }
    }
    return this.velocity;
  }
}
