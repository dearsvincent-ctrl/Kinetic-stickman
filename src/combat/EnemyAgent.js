import { Group, Vector3 } from "three";
import { CharacterController } from "../movement/CharacterController.js";
import { ArenaBounds } from "../world/ArenaBounds.js";
import { CombatController } from "./CombatController.js";
import { Combatant } from "./Combatant.js";
import { createManualTechniques } from "./ManualTechniques.js";
import { StrikeHitDetector } from "./StrikeHitDetector.js";
import { PursuitSteering } from "./PursuitSteering.js";
import { DEFAULT_ENEMY_SETTINGS } from "../sandbox/EnemySettings.js";
import { resolveMovementConfig } from "../movement/MovementConfig.js";
import { GroundObstacleAvoidance } from "./GroundObstacleAvoidance.js";

export const ENEMY_CONFIG = Object.freeze({
  detectRange: 60,
  runSpeed: 3.6,
  attackDistance: 0.92,
  attackAngle: 0.4,
  cooldown: 1.15,
  punchStartup: 0.32,
  kickStartup: 0.43,
});
const NEUTRAL_VELOCITY = new Vector3();
const NEUTRAL = { move: { x: 0, y: 0 }, movementMagnitude: 0, blocking: false };

/** Small deterministic state machine. Steering runs every physical step;
 * attack timing is the same phased controller used by the player. */
export class EnemyAgent {
  constructor(index, world, onHit) {
    this.index = index;
    this.root = new Group();
    this.body = new Combatant(`enemy-${index}`, this.root.position);
    this.world =
      world.fork?.(this.body) ??
      new ArenaBounds(world.halfSize, world.obstacles, this.body);
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
    this.wave = 1;
    this.settings = DEFAULT_ENEMY_SETTINGS;
    this.navigation = new GroundObstacleAvoidance(this.world);
    this.steering = new PursuitSteering({
      navigate: (agent, velocity, target, dt) =>
        this.navigation.update(agent, velocity, target, dt),
    });
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
    this.cooldown =
      (0.55 + (this.index % 8) * 0.22) / (this.settings.attackFrequency || 1);
    this.damageScale = Math.min(1.6, 1 + (wave - 1) * 0.04);
    this.wave = wave;
    this.configure(this.settings);
    this.steering.reset();
    this.navigation.reset();
    this.lostTime = 0;
    this.state = "Idle";
    this.alerted = false;
    this.defeatTime = 0;
    this.attackCount = 0;
  }
  configure(settings) {
    const prior = this.settings.attackFrequency;
    this.settings = settings;
    this.runSpeed =
      Math.min(4.8, ENEMY_CONFIG.runSpeed + (this.wave - 1) * 0.08) *
      settings.speed;
    this.controller.applyMovementConfig(
      resolveMovementConfig({
        walkSpeed: 2.1 * settings.speed,
        sprintSpeed: this.runSpeed,
        movementConfig: {
          analogue: {
            accelerationResponse: 11 * settings.acceleration,
            decelerationResponse: 15 * settings.acceleration,
          },
        },
      }),
    );
    this.controller.facingTurnRate = Math.min(
      20,
      6 + Math.log2(Math.max(1, settings.speed)) * 1.4,
    );
    if (
      prior !== settings.attackFrequency &&
      prior > 0 &&
      settings.attackFrequency > 0
    )
      this.cooldown *= prior / settings.attackFrequency;
    if (prior === 0 && settings.attackFrequency > 0)
      this.cooldown = Math.min(
        this.cooldown ?? 0,
        0.25 / settings.attackFrequency,
      );
    const frequency = Math.max(0.1, settings.attackFrequency);
    this.combat.setTechniques(
      createManualTechniques(
        {
          punchSpeed: frequency,
          kickSpeed: frequency,
          recoverySpeed: frequency,
        },
        {
          "basic-punch": { startup: ENEMY_CONFIG.punchStartup, recovery: 0.42 },
          "front-kick": { startup: ENEMY_CONFIG.kickStartup, recovery: 0.5 },
        },
      ),
    );
    this.steering.neighborTime = 0;
  }
  steer(dt, player, playerVelocity, peers, mayAttack) {
    const velocity = this.steering.update(
      dt,
      this,
      player,
      playerVelocity,
      peers,
      mayAttack,
    );
    const speed = velocity.length();
    if (speed > 1e-6) {
      this.input.move.x = velocity.x / speed;
      this.input.move.y = -velocity.z / speed;
      this.input.movementMagnitude = Math.min(1, speed / this.runSpeed);
      this.input.locomotionSpeed = speed;
    }
  }
  move(dt, player, peers, mayAttack, playerVelocity = NEUTRAL_VELOCITY) {
    this.start.copy(this.root.position);
    this.body.previousPosition.copy(this.root.position);
    this.startHeading = this.controller.heading;
    this.body.update(dt, false, this.controller.heading);
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.input.move.x = this.input.move.y = this.input.movementMagnitude = 0;
    this.input.locomotionSpeed = 0;
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
      const detectionDistance = Math.hypot(
        distance,
        player.position.y - this.root.position.y,
      );
      if (detectionDistance <= this.settings.detection) {
        this.alerted = true;
        this.lostTime = 0;
      } else if (detectionDistance > this.settings.disengagement) {
        this.lostTime = (this.lostTime || 0) + dt;
        if (this.lostTime > 0.25 + this.settings.aggression * 0.75)
          this.alerted = false;
      } else this.lostTime = 0;
      if (!this.alerted) this.state = "Idle";
      else if (this.combat.attack.active) {
        this.state =
          this.combat.attack.phase === "recovery" ? "Recover" : "Attack";
        if (this.settings.speed > 2)
          this.steer(dt, player, playerVelocity, peers, true);
      } else {
        this.state = distance > 3 ? "Approach" : "Position";
        this.steer(dt, player, playerVelocity, peers, mayAttack);
        const action = this.attackCount % 3 === 2 ? "kick" : "punch";
        const technique = this.combat.techniques.get(
          action === "kick" ? "front-kick" : "basic-punch",
        );
        const travelBuffer =
          this.settings.speed > 2 && distance > 1e-6
            ? Math.max(
                0,
                (playerVelocity.x * dx + playerVelocity.z * dz) / distance,
              ) * dt
            : 0;
        // Start only within the technique's unchanged physical contact envelope.
        // A small step-buffer avoids requiring contact with an older footprint.
        const attackDistance = Math.min(
          ENEMY_CONFIG.attackDistance + travelBuffer,
          technique.reach + player.strikeRadius,
        );
        const error = Math.atan2(
          Math.sin(facing - this.controller.heading),
          Math.cos(facing - this.controller.heading),
        );
        if (
          mayAttack &&
          this.settings.attackFrequency > 0 &&
          this.cooldown === 0 &&
          distance <= attackDistance &&
          Math.abs(player.position.y - this.root.position.y) < 0.55 &&
          Math.abs(error) < ENEMY_CONFIG.attackAngle
        ) {
          if (this.combat.requestAttack({ action, environment: "ground" })) {
            this.attackCount++;
            this.state = "Attack";
            this.cooldown =
              Math.max(0.65, ENEMY_CONFIG.cooldown - (this.wave - 1) * 0.025) /
              this.settings.attackFrequency;
            if (this.settings.speed <= 2) {
              this.input.move.x =
                this.input.move.y =
                this.input.movementMagnitude =
                  0;
              this.input.locomotionSpeed = 0;
            }
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
