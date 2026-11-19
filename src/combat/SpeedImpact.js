import { Vector3 } from "three";
import { TagContactDetector } from "./TagContactDetector.js";
import {
  SPEED_EFFECT_DEFAULTS,
  sanitizeSpeedEffectSettings,
} from "../sandbox/SpeedEffectsSettings.js";

export const SPEED_IMPACT_LIMITS = Object.freeze({
  enemies: 64,
  impulse: 1000,
  directCooldown: 0.45,
  nearMissCooldown: 0.65,
});

const finitePoint = (p) =>
  p && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z);
const clamp01 = (n) => Math.max(0, Math.min(1, n));
const component = (n) => Math.max(-1e7, Math.min(1e7, n));
const positive = (n, fallback) =>
  Number.isFinite(n) && n >= 0 ? n : fallback;
const combatEnabled = (battle, mode) =>
  battle &&
  battle.enabled !== false &&
  battle.mode !== "tag" &&
  mode !== "tag" &&
  battle.player?.active !== false;

/** Swept speed contacts add only stagger and collision-resolved body impulse.
 * Actor positions, health, locomotion tuning and the AI remain their owners'.
 * Call after both actors have moved, before advancing enemy strike contacts. */
export class SpeedImpact {
  constructor() {
    this.settings = SPEED_EFFECT_DEFAULTS;
    this.contact = new TagContactDetector(null);
    this.playerAt = new Vector3();
    this.enemyAt = new Vector3();
    this.direction = new Vector3();
    this.relativeVelocity = new Vector3();
    this.boomOrigin = new Vector3();
    this.boomTarget = new Vector3();
    this.ray = new Vector3();
    this.records = Array.from({ length: SPEED_IMPACT_LIMITS.enemies }, () => ({
      enemy: null,
      id: null,
      directCooldown: 0,
      nearMissCooldown: 0,
      directContact: false,
      nearContact: false,
    }));
    this.reset();
  }

  configure(values) {
    this.settings = sanitizeSpeedEffectSettings({ ...this.settings, ...values });
    return this.settings;
  }

  reset() {
    this.nearMisses = this.directHits = this.booms = this.boomHits = 0;
    this.lastForce = this.lastRelativeSpeed = this.lastAffected = 0;
    this.lastBoomSequence = -1;
    for (const record of this.records) this.clearRecord(record);
  }

  clearRecord(record, enemy = null) {
    record.enemy = enemy;
    record.id = enemy?.body?.id ?? null;
    record.directCooldown = record.nearMissCooldown = 0;
    record.directContact = record.nearContact = false;
  }

  strength(battle, enemy) {
    const resistance = Math.max(
      0.1,
      positive(enemy.profile?.knockbackResistance, 1),
    );
    return Math.min(
      1e6,
      (this.settings.impactStrength *
        Math.min(100, positive(battle.strength?.impact, 1))) /
        resistance,
    );
  }

  apply(enemy, battle, force, stagger, reason) {
    const body = enemy.body;
    const amount = Math.min(
      SPEED_IMPACT_LIMITS.impulse,
      Math.max(0, force * this.strength(battle, enemy)),
    );
    const length = Math.hypot(this.direction.x, this.direction.z);
    if (amount > 0 && length > 1e-8 && body.impulse) {
      const x = Number.isFinite(body.impulse.x) ? body.impulse.x : 0,
        z = Number.isFinite(body.impulse.z) ? body.impulse.z : 0;
      body.impulse.x = x +
        (this.direction.x / length) * amount;
      body.impulse.z = z +
        (this.direction.z / length) * amount;
      const magnitude = Math.hypot(body.impulse.x, body.impulse.z);
      if (magnitude > SPEED_IMPACT_LIMITS.impulse) {
        const scale = SPEED_IMPACT_LIMITS.impulse / magnitude;
        body.impulse.x *= scale;
        body.impulse.z *= scale;
      }
    }
    body.stagger = Math.max(positive(body.stagger, 0), stagger);
    body.flash = Math.max(positive(body.flash, 0), 0.12);
    enemy.combat?.cancelAttack(reason);
    this.lastForce = amount;
  }

  update(dt, battle, context = {}) {
    this.lastAffected = 0;
    if (!Number.isFinite(dt) || dt <= 0 || !combatEnabled(battle, context.mode))
      return 0;
    const start = context.start ?? battle.player?.previousPosition,
      end = context.end ?? battle.player?.position;
    if (!finitePoint(start) || !finitePoint(end)) return 0;
    let playerVelocity = finitePoint(context.incomingVelocity)
      ? context.incomingVelocity
      : finitePoint(context.velocity)
        ? context.velocity
        : null;
    // Preserve pre-collision speed when resolution zeroes travel, and allow
    // the first acceleration step to supply a faster resulting velocity.
    if (finitePoint(context.velocity) && (!playerVelocity ||
      Math.hypot(context.velocity.x, context.velocity.y, context.velocity.z) >
      Math.hypot(playerVelocity.x, playerVelocity.y, playerVelocity.z)))
      playerVelocity = context.velocity;
    const px = component(playerVelocity ? playerVelocity.x : (end.x - start.x) / dt),
      py = component(playerVelocity ? playerVelocity.y : (end.y - start.y) / dt),
      pz = component(playerVelocity ? playerVelocity.z : (end.z - start.z) / dt);
    if (!Number.isFinite(px) || !Number.isFinite(py) || !Number.isFinite(pz))
      return 0;
    this.contact.world = context.world ?? battle.world;
    const playerRadius = positive(context.playerRadius ?? battle.player?.radius, 0.36);
    const enemies = battle.enemies ?? [];
    for (let i = 0; i < this.records.length; i++) {
      const enemy = enemies[i],
        record = this.records[i],
        body = enemy?.body;
      if (!enemy || enemy.spawned === false || !body || body.active === false) {
        this.clearRecord(record);
        continue;
      }
      // The strike owner retains its approach target until its captured
      // contact is resolved; incidental actors still receive speed impacts.
      if (body.id === context.attackTargetId) {
        this.clearRecord(record);
        continue;
      }
      if (record.enemy !== enemy || record.id !== body.id)
        this.clearRecord(record, enemy);
      record.directCooldown = Math.max(0, record.directCooldown - dt);
      record.nearMissCooldown = Math.max(0, record.nearMissCooldown - dt);
      const enemyStart = body.previousPosition ?? body.position,
        enemyEnd = body.position;
      if (!finitePoint(enemyStart) || !finitePoint(enemyEnd)) continue;
      this.relativeVelocity.set(
        px - component((enemyEnd.x - enemyStart.x) / dt),
        py - component((enemyEnd.y - enemyStart.y) / dt),
        pz - component((enemyEnd.z - enemyStart.z) / dt),
      );
      const speed = this.relativeVelocity.length();
      if (!Number.isFinite(speed)) continue;
      const directRadius = playerRadius + positive(body.radius, 0.32) + 0.03;
      const directTime = speed >= this.settings.impactSpeed
        ? this.contact.contact(start, end, enemyStart, enemyEnd, directRadius)
        : null;
      const nearTime = directTime === null && this.settings.nearMissEnabled &&
        speed >= this.settings.nearMissSpeed
        ? this.contact.contact(start, end, enemyStart, enemyEnd, this.settings.nearMissRadius)
        : null;
      if (directTime !== null) {
        if (!record.directContact && record.directCooldown === 0) {
          this.playerAt.lerpVectors(start, end, directTime);
          this.enemyAt.lerpVectors(enemyStart, enemyEnd, directTime);
          this.direction.subVectors(this.enemyAt, this.playerAt);
          if (Math.hypot(this.direction.x, this.direction.z) < 1e-8)
            this.direction.copy(this.relativeVelocity);
          if (Math.hypot(this.direction.x, this.direction.z) < 1e-8)
            this.direction.set(1, 0, 0);
          const intensity = clamp01((speed - this.settings.impactSpeed) /
            (this.settings.impactSpeed * 7));
          this.apply(enemy, battle, 6 + intensity * 74, 0.24 + intensity * 0.36, "speed-impact");
          this.directHits++;
          this.lastRelativeSpeed = speed;
          this.lastAffected++;
          record.directCooldown = SPEED_IMPACT_LIMITS.directCooldown;
        }
      } else if (nearTime !== null && !record.nearContact &&
        record.nearMissCooldown === 0) {
        this.playerAt.lerpVectors(start, end, nearTime);
        this.enemyAt.lerpVectors(enemyStart, enemyEnd, nearTime);
        this.direction.subVectors(this.enemyAt, this.playerAt);
        const intensity = clamp01((speed - this.settings.nearMissSpeed) /
          (this.settings.nearMissSpeed * 4));
        this.apply(enemy, battle, intensity * 2, 0.08 + intensity * 0.22, "speed-near-miss");
        this.nearMisses++;
        this.lastRelativeSpeed = speed;
        this.lastAffected++;
        record.nearMissCooldown = SPEED_IMPACT_LIMITS.nearMissCooldown;
      }
      record.directContact = directTime !== null;
      record.nearContact = directTime !== null || nearTime !== null;
    }
    return this.lastAffected;
  }

  boom(event, battle, options = {}) {
    if (!event || !Number.isSafeInteger(event.sequence) ||
      event.sequence <= this.lastBoomSequence || !finitePoint(event.position) ||
      !Number.isFinite(event.radius) || event.radius <= 0)
      return 0;
    this.lastBoomSequence = event.sequence;
    if (!combatEnabled(battle)) return 0;
    this.booms++;
    let affected = 0;
    const speed = positive(event.speed, this.settings.sonicSpeed),
      intensity = clamp01((speed - this.settings.sonicSpeed) /
        (this.settings.sonicSpeed * 4)),
      enemies = battle.enemies ?? [],
      world = battle.world;
    this.boomOrigin.copy(event.position);
    this.boomOrigin.y += positive(battle.player?.height, 2) * 0.45;
    for (let i = 0; i < Math.min(this.records.length, enemies.length); i++) {
      const enemy = enemies[i], body = enemy?.body;
      if (!body || enemy.spawned === false || body.active === false ||
        !finitePoint(body.position) ||
        body.id === (options.excludeTargetId ?? event.excludeTargetId)) continue;
      const distance = body.position.distanceTo(event.position);
      if (!Number.isFinite(distance) || distance > event.radius) continue;
      this.boomTarget.copy(body.position);
      this.boomTarget.y += positive(body.height, 2) * 0.45;
      this.ray.subVectors(this.boomTarget, this.boomOrigin);
      if (world?.firstBlock?.(this.boomOrigin, this.ray, 0, 0)) continue;
      this.direction.subVectors(body.position, event.position);
      if (Math.hypot(this.direction.x, this.direction.z) < 1e-8) {
        if (finitePoint(event.velocity)) this.direction.copy(event.velocity);
        if (Math.hypot(this.direction.x, this.direction.z) < 1e-8)
          this.direction.set(1, 0, 0);
      }
      const falloff = 1 - clamp01(distance / event.radius);
      this.apply(enemy, battle, 8 + intensity * falloff * 32,
        0.16 + intensity * falloff * 0.24, "sonic-boom");
      affected++;
    }
    this.boomHits += affected;
    return affected;
  }

  snapshot(out = {}) {
    out.nearMisses = this.nearMisses;
    out.directHits = this.directHits;
    out.booms = this.booms;
    out.boomHits = this.boomHits;
    out.lastForce = this.lastForce;
    out.lastRelativeSpeed = this.lastRelativeSpeed;
    out.lastAffected = this.lastAffected;
    out.lastBoomSequence = this.lastBoomSequence;
    out.capacity = this.records.length;
    return out;
  }
}
