import { Vector3 } from "three";
import { Combatant, DAMAGE_CONFIG } from "./Combatant.js";
import { EnemyAgent } from "./EnemyAgent.js";
import {
  DEFAULT_ENEMY_SETTINGS,
  ENEMY_LIMITS,
  sanitizeEnemySettings,
} from "../sandbox/EnemySettings.js";
import {
  NORMAL_COMBAT_STRENGTH,
  sanitizeCombatStrength,
  playerStrikeImpact,
} from "../sandbox/CombatStrength.js";
import {
  DEFAULT_TAG_SETTINGS,
  sanitizeTagSettings,
} from "../sandbox/TagSettings.js";
import { TagContactDetector } from "./TagContactDetector.js";
import {
  DEFAULT_ENEMY_PROFILES,
  sanitizeEnemyProfile,
  sanitizeRoster,
  rosterCount,
  rosterProfileAt,
} from "../sandbox/EnemyAbilities.js";

export const TAG_CONFIG = Object.freeze({
  respawnDelay: 2,
  feedbackDuration: 0.9,
});

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
    this.enemySettings = DEFAULT_ENEMY_SETTINGS;
    this.tagSettings = DEFAULT_TAG_SETTINGS;
    this.enemyProfiles = DEFAULT_ENEMY_PROFILES;
    this.enemyRosters = { combat: null, tag: null };
    this.mode = "combat";
    this.tagDetector = new TagContactDetector(world);
    this.tagSettingsRevision = 0;
    this.strength = NORMAL_COMBAT_STRENGTH;
    this.populationOverride = null;
    this.settingsRevision = 0;
    this.playerVelocity = new Vector3();
    this.lastPlayerPosition = playerPosition.clone();
    this.playerSample = new Vector3();
    this.time = 0;
    this.generation = 0;
    this.reset();
  }
  reset() {
    this.player.reset(DAMAGE_CONFIG.playerHealth);
    this.playerVelocity.set(0, 0, 0);
    this.lastPlayerPosition.copy(this.player.position);
    this.player.invulnerable = 1.5;
    this.wave = this.defeated = this.damageEvents = this.blockEvents = 0;
    this.tags = this.tagTime = this.tagFeedback = 0;
    this.nextWave = this.attackGate = 0;
    this.attackerCursor = 0;
    for (const e of this.enemies) {
      e.spawned = false;
      e.body.active = false;
      e.tagRespawnRemaining = 0;
      e.combat.cancelAttack("encounter-reset");
      e.controller.stop();
    }
    this.world.obstacles.length = 0;
    this.targets.length = 0;
    if (this.dummy) {
      this.world.obstacles.push(this.dummy);
      this.targets.push(this.dummy);
    }
    if (this.enabled) {
      if (this.mode === "tag") this.reconcileTagPopulation();
      else this.spawnWave();
    }
  }
  setMode(mode) {
    if ((mode !== "combat" && mode !== "tag") || mode === this.mode)
      return false;
    this.mode = mode;
    // Restart the encounter, not the scene/player transform or configuration.
    this.reset();
    return true;
  }
  configureTag(values) {
    this.tagSettings = sanitizeTagSettings({ ...this.tagSettings, ...values });
    this.tagSettingsRevision++;
    if (this.mode !== "tag") return;
    this.ensureCapacity(this.tagSettings.maxEnemies);
    for (const e of this.enemies) e.configureTag(this.tagSettings);
    if (this.enabled && this.player.active) this.reconcileTagPopulation();
  }
  configureProfile(id, patch) {
    if (!Object.hasOwn(this.enemyProfiles, id)) return;
    const profile = sanitizeEnemyProfile(id, {
      ...this.enemyProfiles[id],
      ...patch,
    });
    this.enemyProfiles = { ...this.enemyProfiles, [id]: profile };
    for (const e of this.enemies)
      if (e.profile.id === id) {
        e.setProfile(profile);
        if (this.mode === "tag") e.configureTag(this.tagSettings);
      }
  }
  resetProfiles() {
    this.enemyProfiles = DEFAULT_ENEMY_PROFILES;
    for (const e of this.enemies) {
      e.setProfile(this.enemyProfiles[e.profile.id]);
      if (this.mode === "tag") e.configureTag(this.tagSettings);
    }
  }
  configureRoster(mode, values) {
    if (mode !== "combat" && mode !== "tag") return;
    this.enemyRosters = {
      ...this.enemyRosters,
      [mode]: sanitizeRoster(values),
    };
    if (mode === this.mode && this.enabled && this.player.active)
      this.reconcileRoster();
  }
  profileForSlot(slot) {
    return this.enemyProfiles[
      rosterProfileAt(this.enemyRosters[this.mode], slot) ?? "standard"
    ];
  }
  reconcileRoster() {
    const count = this.desiredPopulation;
    this.ensureCapacity(count);
    for (let i = 0; i < this.enemies.length; i++) {
      const e = this.enemies[i];
      if (i >= count) {
        e.spawned = e.body.active = false;
        e.tagRespawnRemaining = 0;
        e.combat.cancelAttack("roster");
        e.controller.stop();
      } else {
        const profile = this.profileForSlot(i);
        if (e.profile !== profile) {
          e.setProfile(profile);
          e.combat.cancelAttack("roster");
          e.traversalPlanner.reset();
        }
        if (this.mode === "tag") e.configureTag(this.tagSettings);
      }
    }
    this.rebuildBodies();
    for (let i = 0; i < count; i++) {
      const e = this.enemies[i];
      if ((!e.spawned || !e.body.active) && e.tagRespawnRemaining <= 0)
        this.spawnEnemy(e, i, count);
    }
    this.nextWave = 0;
  }
  reconcileTagPopulation() {
    const count = this.desiredPopulation;
    this.ensureCapacity(count);
    for (let i = count; i < this.enemies.length; i++) {
      const e = this.enemies[i];
      e.spawned = e.body.active = false;
      e.tagRespawnRemaining = 0;
      e.combat.cancelAttack("population");
      e.controller.stop();
    }
    this.rebuildBodies();
    for (let i = 0; i < count; i++) {
      const e = this.enemies[i];
      if (!e.spawned && e.tagRespawnRemaining <= 0)
        this.spawnEnemy(e, i, count);
    }
  }
  configureStrength(values) {
    this.strength = sanitizeCombatStrength(values);
  }
  get alive() {
    let count = 0;
    for (const e of this.enemies) if (e.spawned && e.body.active) count++;
    return count;
  }
  get desiredPopulation() {
    const roster = this.enemyRosters[this.mode];
    if (roster !== null)
      return Math.min(
        rosterCount(roster),
        this.mode === "tag"
          ? this.tagSettings.maxEnemies
          : this.enemySettings.maxEnemies,
      );
    if (this.mode === "tag") return this.tagSettings.maxEnemies;
    return Math.min(
      this.enemySettings.maxEnemies,
      this.populationOverride ??
        WAVE_CONFIG.initialEnemies + Math.floor((this.wave - 1) / 2),
    );
  }
  ensureCapacity(count) {
    while (this.enemies.length < count) {
      const e = new EnemyAgent(this.enemies.length, this.world, (agent, hit) =>
        this.hitPlayer(agent, hit),
      );
      e.configure(this.enemySettings);
      this.enemies.push(e);
    }
  }
  configureEnemies(values, { resetPopulation = false } = {}) {
    const prior = this.enemySettings;
    this.enemySettings = sanitizeEnemySettings({ ...prior, ...values });
    const populationChanged =
      resetPopulation || prior.maxEnemies !== this.enemySettings.maxEnemies;
    if (resetPopulation) this.populationOverride = null;
    else if (prior.maxEnemies !== this.enemySettings.maxEnemies)
      this.populationOverride = this.enemySettings.maxEnemies;
    if (prior.attackFrequency > 0 && this.enemySettings.attackFrequency > 0)
      this.attackGate *=
        prior.attackFrequency / this.enemySettings.attackFrequency;
    if (prior.attackFrequency === 0 && this.enemySettings.attackFrequency > 0)
      this.attackGate = Math.min(
        this.attackGate,
        0.25 / this.enemySettings.attackFrequency,
      );
    this.ensureCapacity(this.enemySettings.maxEnemies);
    for (const e of this.enemies) {
      e.configure(this.enemySettings);
      if (this.mode === "tag") e.configureTag(this.tagSettings);
    }
    this.settingsRevision++;
    if (this.mode === "tag") return;
    if (
      populationChanged &&
      this.enemyRosters.combat !== null &&
      this.enabled
    ) {
      // A tuning change must not revive a finished wave or repopulate a
      // defeated player's encounter. Keep the same gate as legacy waves.
      if (this.player.active && this.alive > 0) this.reconcileRoster();
      return;
    }
    if (
      !populationChanged ||
      !this.enabled ||
      !this.player.active ||
      this.alive === 0
    )
      return;
    // Reconcile live bodies without healing survivors, clearing attacks or
    // awarding defeat credit. A fully defeated wave retains its usual delay.
    const count = this.desiredPopulation;
    let alive = this.alive;
    for (let i = this.enemies.length - 1; i >= 0 && alive > count; i--) {
      const e = this.enemies[i];
      if (!e.spawned || !e.body.active) continue;
      e.spawned = e.body.active = false;
      e.combat.cancelAttack("population");
      e.controller.stop();
      alive--;
    }
    this.rebuildBodies();
    for (const e of this.enemies) {
      if (alive >= count) break;
      if (e.spawned && e.body.active) continue;
      if (this.spawnEnemy(e, alive, count)) alive++;
    }
  }
  rebuildBodies() {
    this.world.obstacles.length = this.targets.length = 0;
    if (this.dummy) {
      this.world.obstacles.push(this.dummy);
      this.targets.push(this.dummy);
    }
    this.world.obstacles.push(this.player);
    for (const e of this.enemies)
      if (e.spawned && e.body.active) {
        this.world.obstacles.push(e.body);
        if (this.mode === "combat") this.targets.push(e.body);
      }
    for (const e of this.enemies) e.world.obstacles = this.world.obstacles;
  }
  spawnEnemy(enemy, slot, count) {
    let ready = false;
    for (let attempt = 0; attempt < 64; attempt++) {
      const angle =
        (slot / count) * Math.PI * 2 + this.wave * 0.67 + attempt * 2.39996;
      const radius =
        WAVE_CONFIG.spawnMin +
        (slot % 3) * 2 +
        (attempt % 3) +
        Math.max(0, attempt - 23) * 0.75;
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
        this.world.isSpaceFree &&
        !this.world.isSpaceFree(this.spawnPoint, 0.4, 1.8)
      )
        continue;
      if (
        this.world.obstacles.some(
          (b) =>
            b !== this.player &&
            b.active !== false &&
            this.spawnPoint.distanceTo(b.position) < 2,
        )
      )
        continue;
      ready = true;
      break;
    }
    if (!ready) {
      enemy.spawned = enemy.body.active = false;
      return false;
    }
    enemy.setProfile(this.profileForSlot(slot));
    enemy.spawn(this.spawnPoint, Math.max(1, this.wave), ++this.generation);
    if (this.mode === "tag") enemy.configureTag(this.tagSettings);
    this.world.obstacles.push(enemy.body);
    if (this.mode === "combat") this.targets.push(enemy.body);
    return true;
  }
  spawnWave() {
    this.wave++;
    this.nextWave = 0;
    const count = this.desiredPopulation;
    this.ensureCapacity(count);
    for (const e of this.enemies) {
      e.spawned = e.body.active = false;
    }
    this.rebuildBodies();
    for (let i = 0; i < count; i++) this.spawnEnemy(this.enemies[i], i, count);
  }
  recommendedSubsteps(dt) {
    if (!Number.isFinite(dt) || dt <= 0) return 1;
    if (!this.enabled) return 1;
    let speed = 0,
      count = 0;
    for (const e of this.enemies)
      if (e.spawned && e.body.active) {
        count++;
        speed = Math.max(
          speed,
          e.controller.velocity.length(),
          Math.abs(e.controller.jump.verticalVelocity),
          e.controller.jumpRequested ? e.controller.jump.launchVelocity : 0,
          e.controller.parkour?.attached
            ? e.controller.parkour.velocity.length()
            : 0,
        );
        if (
          e.alerted ||
          e.root.position.distanceToSquared(this.player.position) <
            (this.mode === "tag"
              ? this.tagSettings.detection
              : this.enemySettings.detection) **
              2
        )
          speed = Math.max(speed, e.runSpeed);
      }
    // A finite simulation budget plus swept collision/contact paths. Player
    // substep requirements are independently retained by Game.
    const budget = Math.min(
      ENEMY_LIMITS.maxSubsteps,
      Math.max(2, Math.floor(512 / Math.max(1, count))),
    );
    return Math.max(1, Math.min(budget, Math.ceil((speed * dt) / 0.25)));
  }
  beginStep(dt, blocking, heading) {
    if (!Number.isFinite(dt) || dt <= 0) return;
    this.time += dt;
    this.playerSample
      .copy(this.player.position)
      .sub(this.lastPlayerPosition)
      .divideScalar(dt);
    if (this.playerSample.lengthSq() > 10000 ** 2)
      this.playerSample.setLength(10000);
    this.playerVelocity.lerp(this.playerSample, 1 - Math.exp(-18 * dt));
    this.lastPlayerPosition.copy(this.player.position);
    this.player.previousPosition.copy(this.player.position);
    this.player.update(dt, blocking, heading);
    if (!this.enabled) return;
    if (this.mode === "tag") {
      this.tagTime += dt;
      this.tagFeedback = Math.max(0, this.tagFeedback - dt);
      const count = this.desiredPopulation;
      for (let i = 0; i < count; i++) {
        const e = this.enemies[i];
        if (!e.spawned) {
          e.tagRespawnRemaining = Math.max(0, e.tagRespawnRemaining - dt);
          if (
            e.tagRespawnRemaining === 0 &&
            this.player.active &&
            !this.spawnEnemy(e, i, count)
          )
            e.tagRespawnRemaining = 0.5;
        }
        if (e.spawned)
          e.moveTag(dt, this.player, this.enemies, this.playerVelocity);
      }
      return;
    }
    this.attackGate = Math.max(0, this.attackGate - dt);
    let attackers = 0;
    for (const e of this.enemies)
      if (e.spawned && e.body.active && e.combat.attack.active) attackers++;
    const budget = Math.min(
      4,
      Math.max(this.wave >= 4 ? 2 : 1, 1 + Math.floor(this.alive / 12)),
    );
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
      e.move(dt, this.player, this.enemies, canAttack, this.playerVelocity);
      if (!wasAttacking && e.combat.attack.active) {
        attackers++;
        this.attackGate =
          WAVE_CONFIG.attackSpacing /
          Math.max(0.1, this.enemySettings.attackFrequency);
        this.attackerCursor = (e.index + 1) % this.enemies.length;
      }
    }
  }
  movePlayerImpulse(dt) {
    this.player.moveImpulse(dt, this.world, this.impulseStep);
  }
  endStep(dt, heading) {
    if (!Number.isFinite(dt) || dt <= 0) return;
    this.player.heading = heading;
    if (!this.enabled) return;
    if (this.mode === "tag") {
      let changed = false;
      for (const e of this.enemies) {
        if (!e.spawned || !e.body.active) continue;
        if (
          this.tagDetector.contact(
            this.player.previousPosition,
            this.player.position,
            e.body.previousPosition,
            e.body.position,
            this.tagSettings.tagRadius,
          ) === null
        )
          continue;
        this.tags++;
        this.tagFeedback = TAG_CONFIG.feedbackDuration;
        e.spawned = e.body.active = false;
        e.tagRespawnRemaining = TAG_CONFIG.respawnDelay;
        e.defeatTime = 3;
        e.state = "Tagged";
        e.combat.cancelAttack("tagged");
        e.controller.stop();
        changed = true;
      }
      if (changed) this.rebuildBodies();
      return;
    }
    for (const e of this.enemies)
      if (e.spawned) e.advanceAttack(dt, this.player);
    if (this.alive === 0 && this.player.active && this.desiredPopulation > 0) {
      this.nextWave += dt;
      if (this.nextWave >= WAVE_CONFIG.delay) this.spawnWave();
    }
  }
  hitEnemy(hit, technique) {
    if (this.mode === "tag") return null;
    const enemy = this.enemies.find(
      (e) => e.spawned && e.body.id === hit.targetId,
    );
    if (!enemy) return null;
    const effect = playerStrikeImpact(technique?.action, this.strength);
    const knockback = effect.knockback / enemy.profile.knockbackResistance;
    const result = enemy.body.receive({
      damage: effect.damage,
      source: hit.source ?? this.player.position,
      heading: hit.heading,
      atPosition: hit.targetPosition ?? enemy.body.position,
      knockback,
      allowZeroDamage: true,
      impulseLimit: Math.max(8, knockback * 2),
    });
    if (result) {
      enemy.combat.cancelAttack("hit");
      enemy.controller.parkour?.cancel(enemy.controller);
      if (result.defeated) this.defeated++;
    }
    return result;
  }
  hitPlayer(enemy, hit) {
    if (this.mode === "tag") return null;
    const kick = enemy.combat.currentTechnique?.action === "kick";
    const result = this.player.receive({
      damage:
        (kick
          ? DAMAGE_CONFIG.enemyKickDamage
          : DAMAGE_CONFIG.enemyPunchDamage) *
        enemy.damageScale *
        enemy.profile.damage,
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
      mode: this.mode,
      enemyProfiles: this.enemyProfiles,
      enemyRosters: this.enemyRosters,
      tagSettings: this.tagSettings,
      tagSettingsRevision: this.tagSettingsRevision,
      tags: this.tags,
      tagTime: this.tagTime,
      tagFeedback: this.tagFeedback,
      enemySettings: this.enemySettings,
      strength: this.strength,
      populationOverride: this.populationOverride,
      settingsRevision: this.settingsRevision,
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
          profile: e.profile.id,
          parkour: e.controller.parkour?.mode ?? "free",
          jump: {
            phase: e.controller.jump.phase,
            count: e.controller.jump.jumpCount,
            height: e.controller.jump.height,
            verticalVelocity: e.controller.jump.verticalVelocity,
            launchVelocity: e.controller.jump.launchVelocity,
          },
          state: e.state,
          health: e.body.health,
          maxHealth: e.body.maxHealth,
          position: e.root.position.toArray(),
          heading: e.controller.heading,
          phase: e.combat.attack.phase,
          sequence: e.combat.attack.sequence,
          velocity: e.controller.velocity.toArray(),
          impulse: e.body.impulse.toArray(),
          alerted: e.alerted,
        })),
    };
  }
}
