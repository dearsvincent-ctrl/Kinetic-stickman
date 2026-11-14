import { Group, Vector3 } from "three";
import { CharacterController } from "../movement/CharacterController.js";
import { ArenaBounds } from "../world/ArenaBounds.js";
import { CombatController } from "./CombatController.js";
import { Combatant } from "./Combatant.js";
import { createManualTechniques } from "./ManualTechniques.js";
import { StrikeHitDetector } from "./StrikeHitDetector.js";
import { resolveMovementConfig } from "../movement/MovementConfig.js";

export const ENEMY_CONFIG = Object.freeze({
  detectRange: 60,
  runSpeed: 3.6,
  attackDistance: 0.92,
  attackAngle: 0.4,
  cooldown: 1.15,
  punchStartup: 0.32,
  kickStartup: 0.43,
});
const NEUTRAL = { move: { x: 0, y: 0 }, movementMagnitude: 0, blocking: false };

/** Small deterministic state machine. Steering runs every physical step;
 * attack timing is the same phased controller used by the player. */
export class EnemyAgent {
  constructor(index, world, onHit) {
    this.index = index;
    this.root = new Group();
    this.body = new Combatant(`enemy-${index}`, this.root.position);
    this.world = new ArenaBounds(world.halfSize, world.obstacles, this.body);
    this.controller = new CharacterController(this.root, this.world, {
      sprintSpeed: ENEMY_CONFIG.runSpeed,
      radius: this.body.radius,
    });
    this.combat = new CombatController({
      techniques: createManualTechniques(
        {},
        {
          "basic-punch": { startup: ENEMY_CONFIG.punchStartup, recovery: 0.42 },
          "front-kick": { startup: ENEMY_CONFIG.kickStartup, recovery: 0.5 },
        },
      ),
    });
    this.detector = new StrikeHitDetector({
      onContact: (hit) => onHit(this, hit),
    });
    this.input = {
      move: { x: 0, y: 0 },
      movementMagnitude: 0,
      blocking: false,
    };
    this.start = new Vector3();
    this.impulseStep = new Vector3();
    this.attackStart = new Vector3();
    this.attackEnd = new Vector3();
    this.state = "Idle";
    this.spawned = false;
  }
  spawn(position, wave, generation) {
    this.spawned = true;
    this.root.position.copy(position);
    this.body.id = `enemy-${generation}-${this.index}`;
    this.body.reset(Math.min(140, 72 + (wave - 1) * 5));
    this.controller.stop();
    this.controller.velocity.set(0, 0, 0);
    this.combat.cancelAttack("spawn");
    this.combat.update(1);
    this.cooldown = 0.55 + this.index * 0.22;
    this.damageScale = Math.min(1.6, 1 + (wave - 1) * 0.04);
    this.runSpeed = Math.min(4.8, ENEMY_CONFIG.runSpeed + (wave - 1) * 0.08);
    this.controller.applyMovementConfig(
      resolveMovementConfig({ walkSpeed: 2.1, sprintSpeed: this.runSpeed }),
    );
    this.wave = wave;
    this.state = "Idle";
    this.alerted = false;
    this.defeatTime = 0;
    this.attackCount = 0;
  }
  move(dt, player, peers, mayAttack) {
    this.start.copy(this.root.position);
    this.body.previousPosition.copy(this.root.position);
    this.startHeading = this.controller.heading;
    this.body.update(dt, false, this.controller.heading);
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.input.move.x = this.input.move.y = this.input.movementMagnitude = 0;
    if (!this.body.active) {
      this.state = "Defeated";
      this.defeatTime += dt;
      this.combat.cancelAttack("defeated");
    } else if (this.body.stagger > 0) {
      this.state = "Stagger";
      this.combat.cancelAttack("stagger");
    } else if (!player.active) {
      this.state = "Idle";
    } else {
      const dx = player.position.x - this.root.position.x;
      const dz = player.position.z - this.root.position.z;
      const distance = Math.hypot(dx, dz);
      const facing = Math.atan2(-dx, -dz);
      this.alerted ||= distance <= ENEMY_CONFIG.detectRange;
      if (!this.alerted) this.state = "Idle";
      else if (this.combat.attack.active) {
        this.state =
          this.combat.attack.phase === "recovery" ? "Recover" : "Attack";
      } else {
        this.state = distance > 3 ? "Approach" : "Position";
        const angle = this.index * 2.39996 + this.wave * 0.35;
        const radius = mayAttack ? 0 : 1.9;
        let tx = dx + Math.cos(angle) * radius;
        let tz = dz + Math.sin(angle) * radius;
        if (mayAttack && distance < 0.82) tx = tz = 0;
        const forwardLength = Math.hypot(tx, tz);
        if (forwardLength > 0.01) {
          const fx = tx / forwardLength,
            fz = tz / forwardLength;
          for (const obstacle of this.world.obstacles) {
            if (
              obstacle.dynamic ||
              obstacle.active === false ||
              !(obstacle.radius > 0)
            )
              continue;
            const ox = obstacle.position.x - this.root.position.x;
            const oz = obstacle.position.z - this.root.position.z;
            const ahead = ox * fx + oz * fz;
            const lateral = ox * fz - oz * fx;
            const clearance = this.body.radius + obstacle.radius + 0.25;
            if (ahead <= 0 || ahead > 1.8 || Math.abs(lateral) >= clearance)
              continue;
            const side =
              Math.abs(lateral) > 0.01
                ? Math.sign(lateral)
                : this.index % 2
                  ? -1
                  : 1;
            const force =
              (1 - Math.abs(lateral) / clearance) *
              Math.max(1, forwardLength) *
              1.8;
            tx -= fz * side * force;
            tz += fx * side * force;
          }
        }
        for (const peer of peers) {
          if (peer === this || !peer.spawned || !peer.body.active) continue;
          const sx = this.root.position.x - peer.root.position.x;
          const sz = this.root.position.z - peer.root.position.z;
          const d = Math.hypot(sx, sz);
          if (d > 0.001 && d < 1.15) {
            tx += (sx / d) * (1.15 - d) * 3;
            tz += (sz / d) * (1.15 - d) * 3;
          }
        }
        const length = Math.hypot(tx, tz);
        if (length > 0.08) {
          const strength = Math.min(1, length / 1.8);
          this.input.move.x = (tx / length) * strength;
          this.input.move.y = (-tz / length) * strength;
          this.input.movementMagnitude = strength;
        }
        const error = Math.atan2(
          Math.sin(facing - this.controller.heading),
          Math.cos(facing - this.controller.heading),
        );
        if (
          mayAttack &&
          this.cooldown === 0 &&
          distance <= ENEMY_CONFIG.attackDistance &&
          player.position.y < 0.55 &&
          Math.abs(error) < ENEMY_CONFIG.attackAngle
        ) {
          const action = this.attackCount++ % 3 === 2 ? "kick" : "punch";
          if (this.combat.requestAttack({ action, environment: "ground" })) {
            this.state = "Attack";
            this.cooldown = Math.max(
              0.65,
              ENEMY_CONFIG.cooldown - (this.wave - 1) * 0.025,
            );
            this.input.move.x =
              this.input.move.y =
              this.input.movementMagnitude =
                0;
          }
        }
      }
    }
    // Only enemy tuning is scaled by wave difficulty; player values are untouched.
    this.controller.update(
      dt,
      this.body.active && this.body.stagger <= 0 ? this.input : NEUTRAL,
      0,
      this.body.active && player.active ? player.position : null,
    );
    this.body.moveImpulse(dt, this.world, this.impulseStep);
  }
  advanceAttack(dt, player) {
    this.detector.targets[0] = player;
    let elapsed = 0;
    const endHeading = this.controller.heading;
    const turn = Math.atan2(
      Math.sin(endHeading - this.startHeading),
      Math.cos(endHeading - this.startHeading),
    );
    while (elapsed < dt - 1e-9) {
      const step = Math.min(
        dt - elapsed,
        Math.max(1e-8, this.combat.timeToBoundary),
      );
      const t0 = elapsed / dt,
        t1 = (elapsed + step) / dt;
      this.attackStart.lerpVectors(this.start, this.root.position, t0);
      this.attackEnd.lerpVectors(this.start, this.root.position, t1);
      // move() has already advanced the full path. Motion fractions also align
      // target interpolation with each actual active window.
      this.detector.sweep(
        this.combat.currentTechnique,
        this.combat.attack,
        this.combat.attack.elapsed,
        this.combat.attack.elapsed + step,
        this.attackStart,
        this.attackEnd,
        this.startHeading + turn * t0,
        this.startHeading + turn * t1,
        null,
        null,
        0,
        0,
        t0,
        t1,
      );
      this.combat.update(step);
      elapsed += step;
    }
  }
}
