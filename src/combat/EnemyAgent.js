import { EnemyReaction } from "./EnemyReaction.js";
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
import { EvasionSteering } from "./EvasionSteering.js";
import { DEFAULT_TAG_SETTINGS } from "../sandbox/TagSettings.js";
import { DEFAULT_ENEMY_PROFILES } from "../sandbox/EnemyAbilities.js";
import { EnemyTraversalPlanner } from "./EnemyTraversalPlanner.js";
import { ParkourState } from "../traversal/ParkourState.js";

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
    this.tagSettings = DEFAULT_TAG_SETTINGS;
    this.profile = DEFAULT_ENEMY_PROFILES.standard;
    this.mode = "combat";
    this.traversalPlanner = new EnemyTraversalPlanner(this.world);
    this.travelIntent = new Vector3();
    this.tagRespawnRemaining = 0;
    this.evasion = new EvasionSteering(this.world);
    this.navigation = new GroundObstacleAvoidance(this.world);
    this.steering = new PursuitSteering({
      navigate: (agent, velocity, target, dt) =>
        this.navigation.update(agent, velocity, target, dt),
    });
    this.reaction = new EnemyReaction(this);
    this.applyAbilities(this.settings, true);
  }
  spawn(position, wave, generation) {
    this.spawned = true;
    this.root.position.copy(position);
    this.body.id = `enemy-${generation}-${this.index}`;
    this.body.reset(Math.min(140, 72 + (wave - 1) * 5));
    this.reaction.reset();
    this.controller.stop();
    this.controller.velocity.set(0, 0, 0);
    // A tagged airborne actor must not carry its old height into a ground
    // respawn. This is an explicit spawn reset, never traversal root motion.
    this.controller.jump.land(position.y, 0);
    this.controller.jump.phase = "grounded";
    this.controller.airDashesUsed = 0;
    this.controller.parkour = null;
    this.traversalPlanner.reset();
    this.combat.cancelAttack("spawn");
    this.combat.update(1);
    this.cooldown =
      (0.55 + (this.index % 8) * 0.22) / (this.settings.attackFrequency || 1);
    this.damageScale = Math.min(1.6, 1 + (wave - 1) * 0.04);
    this.wave = wave;
    this.configure(this.settings);
    this.steering.reset();
    this.navigation.reset();
    this.evasion.reset();
    this.tagRespawnRemaining = 0;
    this.lostTime = 0;
    this.state = "Idle";
    this.alerted = false;
    this.defeatTime = 0;
    this.collisionDefeated = false;
    this.attackCount = 0;
  }
  configure(settings) {
    const prior = this.settings.attackFrequency;
    this.settings = settings;
    this.mode = "combat";
    this.applyAbilities(settings, true);
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
  setProfile(profile) {
    this.profile = profile;
    this.applyAbilities(
      this.mode === "tag" ? this.tagSettings : this.settings,
      this.mode !== "tag",
    );
  }
  applyAbilities(settings, waveScaling) {
    const p = this.profile;
    const waveFactor = waveScaling
      ? Math.min(4.8, ENEMY_CONFIG.runSpeed + (this.wave - 1) * 0.08) /
        ENEMY_CONFIG.runSpeed
      : 1;
    // Finite integration guard, far above ordinary/superhuman presets. These
    // values never read or rewrite the player's sandbox configuration.
    this.runSpeed = Math.min(8000, p.runSpeed * settings.speed * waveFactor);
    this.controller.applyMovementConfig(
      resolveMovementConfig({
        walkSpeed: Math.min(8000, p.runSpeed * (2.1 / 3.6) * settings.speed),
        sprintSpeed: this.runSpeed,
        movementConfig: {
          abilities: {
            airAcceleration: p.aerialControl,
            airBraking: p.aerialControl,
            wallTraversal: 1,
            wallJump: 1,
          },
          analogue: {
            accelerationResponse: p.acceleration * settings.acceleration,
            decelerationResponse: p.deceleration * settings.acceleration,
          },
          jump: {
            airSpeedLimit: 5.2 * p.aerialControl,
            height: p.jumpHeight,
            maxJumps: p.maxJumps,
            gravity: 18,
            airControl: p.airControl * p.aerialControl,
            airDrag: 0.1 / p.aerialControl,
          },
        },
      }),
    );
    this.controller.facingTurnRate = Math.min(
      40,
      p.turnRate + Math.log2(Math.max(1, settings.speed)) * 1.4,
    );
    if (
      this.world.querySurface &&
      (p.wallRun || p.climb || p.ledgeGrab || p.rooftop)
    ) {
      this.controller.parkour ??= new ParkourState(this.world);
      this.controller.parkour.config = Object.freeze({
        ...this.controller.parkour.config,
        wallSpeed: p.climbSpeed * (5.2 / 3.6),
        climbSpeed: p.climbSpeed,
        descentSpeed: Math.max(3, p.climbSpeed * 0.8),
      });
    } else if (this.controller.parkour) {
      this.controller.parkour.cancel(this.controller);
      this.controller.parkour = null;
    }
  }
  planTraversal(dt, player, playerVelocity, mode) {
    const magnitude = Math.hypot(this.input.move.x, this.input.move.y);
    this.travelIntent.set(this.input.move.x, 0, -this.input.move.y);
    if (magnitude > 1e-6)
      this.travelIntent.multiplyScalar(this.input.locomotionSpeed / magnitude);
    const velocity = this.traversalPlanner.update(
      dt,
      this,
      player,
      playerVelocity,
      mode,
      this.travelIntent,
    );
    const speed = velocity.length();
    this.input.move.x = speed > 1e-6 ? velocity.x / speed : 0;
    this.input.move.y = speed > 1e-6 ? -velocity.z / speed : 0;
    this.input.locomotionSpeed = speed;
    this.input.movementMagnitude = Math.min(1, speed / this.runSpeed);
    this.controller.facingResponse = this.controller.jump.airborne
      ? Math.min(80, 13 * this.profile.aerialControl)
      : 13;
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
  /** Independent escape tuning: never writes Combat Mode's pursuit values. */
  configureTag(settings) {
    this.tagSettings = settings;
    this.mode = "tag";
    this.applyAbilities(settings, false);
    // Retain the committed escape route when a live slider changes.
  }
  moveTag(dt, player, peers, playerVelocity = NEUTRAL_VELOCITY) {
    this.start.copy(this.root.position);
    this.body.previousPosition.copy(this.root.position);
    this.startHeading = this.controller.heading;
    this.body.update(dt, false, this.controller.heading);
    const velocity = this.evasion.update(
      dt,
      this,
      player,
      playerVelocity,
      peers,
    );
    const speed = velocity.length();
    this.alerted = this.evasion.threatened;
    this.state = this.alerted ? "Flee" : "Idle";
    this.input.move.x = speed > 1e-6 ? velocity.x / speed : 0;
    this.input.move.y = speed > 1e-6 ? -velocity.z / speed : 0;
    this.input.movementMagnitude = Math.min(1, speed / this.runSpeed);
    this.input.locomotionSpeed = speed;
    if (this.alerted || this.controller.parkour?.attached)
      this.planTraversal(dt, player, playerVelocity, "tag");
    // Do not face the pursuer: body orientation follows the resolved travel.
    // No damage/stagger/attack scheduler is advanced in Tag Mode.
    this.controller.update(dt, this.input, 0);
  }
  move(dt, player, peers, mayAttack, playerVelocity = NEUTRAL_VELOCITY) {
    this.start.copy(this.root.position);
    this.body.previousPosition.copy(this.root.position);
    this.startHeading = this.controller.heading;
    this.body.update(dt, false, this.controller.heading);
    if (this.reaction.active) {
      if (!this.body.active) {
        this.defeatTime += dt;
        if (this.defeatTime >= 2) {
          this.state = "Defeated";
          return;
        }
      }
      const owned = this.reaction.update(dt);
      if (owned) {
        this.state = this.body.active ? this.reaction.phase : "Defeated";
        return;
      }
    }
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
          if (
            this.combat.requestAttack({
              action,
              environment: this.controller.jump.airborne ? "air" : "ground",
            })
          ) {
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
    if (
      this.body.active &&
      this.body.stagger <= 0 &&
      player.active &&
      (this.alerted || this.controller.parkour?.attached)
    )
      this.planTraversal(dt, player, playerVelocity, "combat");
    else this.controller.parkour?.cancel(this.controller);
    // Only enemy tuning is scaled by wave difficulty; player values are untouched.
    this.controller.update(
      dt,
      this.body.active && this.body.stagger <= 0 ? this.input : NEUTRAL,
      0,
      this.body.active &&
        player.active &&
        !this.controller.jump.airborne &&
        !this.controller.parkour?.attached
        ? player.position
        : null,
    );
    const environment = this.controller.jump.airborne ? "air" : "ground";
    if (
      this.combat.attack.active &&
      !this.combat.currentTechnique.environments.includes(environment)
    )
      this.combat.cancelAttack("movement-phase");
    this.body.moveImpulse(dt, this.world, this.impulseStep);
  }
  advanceAttack(dt, player) {
    if (this.reaction.ownsMotion) {
      this.combat.cancelAttack("reaction");
      return;
    }
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
