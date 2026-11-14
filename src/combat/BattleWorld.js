import { Vector3 } from "three";
import { Combatant, DAMAGE_CONFIG } from "./Combatant.js";
import { EnemyAgent } from "./EnemyAgent.js";

export const WAVE_CONFIG = Object.freeze({
  initialEnemies: 3,
  maxEnemies: 8,
  delay: 2.5,
  spawnMin: 9,
  spawnMax: 15,
  attackSpacing: 0.5,
});

/** Owns encounter state only. No DOM, animation, input or player locomotion
 * configuration belongs here. Fixed/substepped simulation calls begin/end. */
export class BattleWorld {
  constructor({
    playerPosition,
    world,
    targets,
    dummy = null,
    enabled = true,
  }) {
    this.world = world;
    this.targets = targets;
    this.dummy = dummy;
    this.enabled = enabled;
    this.player = new Combatant("player", playerPosition, {
      maxHealth: DAMAGE_CONFIG.playerHealth,
      radius: 0.36,
    });
    world.ignoredObstacle = this.player;
    this.impulseStep = new Vector3();
    this.spawnPoint = new Vector3();
    this.enemies = Array.from(
      { length: WAVE_CONFIG.maxEnemies },
      (_, i) =>
        new EnemyAgent(i, world, (agent, hit) => this.hitPlayer(agent, hit)),
    );
    this.time = 0;
    this.generation = 0;
    this.reset();
  }
  reset() {
    this.player.reset(DAMAGE_CONFIG.playerHealth);
    this.player.invulnerable = 1.5;
    this.wave = this.defeated = this.damageEvents = this.blockEvents = 0;
    this.nextWave = this.attackGate = 0;
    this.attackerCursor = 0;
    for (const e of this.enemies) {
      e.spawned = false;
      e.body.active = false;
    }
    this.world.obstacles.length = 0;
    this.targets.length = 0;
    if (this.dummy) {
      this.world.obstacles.push(this.dummy);
      this.targets.push(this.dummy);
    }
    if (this.enabled) this.spawnWave();
  }
  get alive() {
    let count = 0;
    for (const e of this.enemies) if (e.spawned && e.body.active) count++;
    return count;
  }
  spawnWave() {
    this.wave++;
    this.generation++;
    this.nextWave = 0;
    const count = Math.min(
      WAVE_CONFIG.maxEnemies,
      WAVE_CONFIG.initialEnemies + Math.floor((this.wave - 1) / 2),
    );
    this.world.obstacles.length = this.targets.length = 0;
    if (this.dummy) {
      this.world.obstacles.push(this.dummy);
      this.targets.push(this.dummy);
    }
    this.world.obstacles.push(this.player);
    for (let i = 0; i < this.enemies.length; i++) {
      const enemy = this.enemies[i];
      enemy.spawned = i < count;
      enemy.body.active = false;
      if (i >= count) continue;
      // Rotate a spaced ring each wave. Rejection also works in arena corners.
      for (let attempt = 0; attempt < 48; attempt++) {
        const angle =
          (i / count) * Math.PI * 2 + this.wave * 0.67 + attempt * 2.39996;
        const radius = WAVE_CONFIG.spawnMin + (i % 3) * 2 + (attempt % 3);
        const limit = this.world.halfSize - 2;
        this.spawnPoint.set(
          Math.max(
            -limit,
            Math.min(limit, this.player.position.x + Math.cos(angle) * radius),
          ),
          0,
          Math.max(
            -limit,
            Math.min(limit, this.player.position.z + Math.sin(angle) * radius),
          ),
        );
        if (
          Math.hypot(
            this.spawnPoint.x - this.player.position.x,
            this.spawnPoint.z - this.player.position.z,
          ) <
          WAVE_CONFIG.spawnMin - 0.5
        )
          continue;
        if (
          this.world.obstacles.some(
            (b) =>
              b !== this.player && this.spawnPoint.distanceTo(b.position) < 2,
          )
        )
          continue;
        break;
      }
      enemy.spawn(this.spawnPoint, this.wave, this.generation);
      this.world.obstacles.push(enemy.body);
      this.targets.push(enemy.body);
    }
    // All enemy adapters reference this same bounded list, excluding themselves.
    for (const e of this.enemies) e.world.obstacles = this.world.obstacles;
  }
  beginStep(dt, blocking, heading) {
    this.time += dt;
    this.player.previousPosition.copy(this.player.position);
    this.player.update(dt, blocking, heading);
    if (!this.enabled) return;
    this.attackGate = Math.max(0, this.attackGate - dt);
    let attackers = 0;
    for (const e of this.enemies)
      if (e.spawned && e.body.active && e.combat.attack.active) attackers++;
    const budget = this.wave >= 4 ? 2 : 1;
    let preferred = null,
      closest = Infinity;
    // Rotate opportunities, rather than letting array index zero monopolize
    // every opening. Distant fighters never reserve a token indefinitely.
    for (let n = 0; n < this.enemies.length; n++) {
      const e = this.enemies[(this.attackerCursor + n) % this.enemies.length];
      if (
        !e.spawned ||
        !e.body.active ||
        e.body.stagger > 0 ||
        e.combat.attack.active
      )
        continue;
      const d = e.root.position.distanceToSquared(this.player.position);
      if (e.cooldown <= dt && d < 9) {
        preferred = e;
        break;
      }
      if (d < closest) {
        closest = d;
        preferred = e;
      }
    }
    for (const e of this.enemies) {
      if (!e.spawned) continue;
      const wasAttacking = e.combat.attack.active;
      const canAttack =
        e === preferred && attackers < budget && this.attackGate === 0;
      e.move(dt, this.player, this.enemies, canAttack);
      if (!wasAttacking && e.combat.attack.active) {
        attackers++;
        this.attackGate = WAVE_CONFIG.attackSpacing;
        this.attackerCursor = (e.index + 1) % this.enemies.length;
      }
    }
  }
  movePlayerImpulse(dt) {
    this.player.moveImpulse(dt, this.world, this.impulseStep);
  }
  endStep(dt, heading) {
    this.player.heading = heading;
    if (!this.enabled) return;
    for (const e of this.enemies)
      if (e.spawned) e.advanceAttack(dt, this.player);
    if (this.alive === 0 && this.player.active) {
      this.nextWave += dt;
      if (this.nextWave >= WAVE_CONFIG.delay) this.spawnWave();
    }
  }
  hitEnemy(hit, technique) {
    const enemy = this.enemies.find(
      (e) => e.spawned && e.body.id === hit.targetId,
    );
    if (!enemy) return null;
    const kick = technique?.action === "kick";
    const result = enemy.body.receive({
      damage: kick ? DAMAGE_CONFIG.kickDamage : DAMAGE_CONFIG.punchDamage,
      source: hit.source ?? this.player.position,
      heading: hit.heading,
      atPosition: hit.targetPosition ?? enemy.body.position,
      knockback: kick ? 4.2 : 2.5,
    });
    if (result) {
      enemy.combat.cancelAttack("hit");
      if (result.defeated) this.defeated++;
    }
    return result;
  }
  hitPlayer(enemy, hit) {
    const kick = enemy.combat.currentTechnique?.action === "kick";
    const result = this.player.receive({
      damage:
        (kick
          ? DAMAGE_CONFIG.enemyKickDamage
          : DAMAGE_CONFIG.enemyPunchDamage) * enemy.damageScale,
      source: hit.source ?? enemy.root.position,
      heading: hit.heading,
      atPosition: hit.targetPosition ?? this.player.position,
      knockback: kick ? 3.4 : 2,
    });
    if (result) {
      this.damageEvents++;
      if (result.blocked) this.blockEvents++;
    }
    return result;
  }
  snapshot() {
    return {
      wave: this.wave,
      defeated: this.defeated,
      alive: this.alive,
      nextWave: this.nextWave,
      health: this.player.health,
      maxHealth: this.player.maxHealth,
      active: this.player.active,
      damageEvents: this.damageEvents,
      blockEvents: this.blockEvents,
      enemies: this.enemies
        .filter((e) => e.spawned)
        .map((e) => ({
          id: e.body.id,
          state: e.state,
          health: e.body.health,
          maxHealth: e.body.maxHealth,
          position: e.root.position.toArray(),
          heading: e.controller.heading,
          phase: e.combat.attack.phase,
          sequence: e.combat.attack.sequence,
        })),
    };
  }
}
