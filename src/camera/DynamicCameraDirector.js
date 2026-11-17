import { Vector3 } from "three";
import {
  CAMERA_DEFAULTS,
  sanitizeCameraSettings,
} from "../sandbox/CameraSettings.js";

const DEG = Math.PI / 180;
const SCAN_INTERVAL = 0.12;
const TARGET_HOLD = 0.5;
const CHALLENGER_MARGIN = 0.18;
const MAX_CANDIDATES = 64;
const LOS_CHALLENGERS = 3;
const finitePoint = (point) =>
  point &&
  Number.isFinite(point.x) &&
  Number.isFinite(point.y) &&
  Number.isFinite(point.z);
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const response = (dt, seconds) => -Math.expm1(-dt / seconds);
const angle = (value) => Math.atan2(Math.sin(value), Math.cos(value));

/** Camera presentation only. Manual orbit remains the caller's persistent
 * anchor; this director never changes actors, movement, or supplied vectors. */
export class DynamicCameraDirector {
  constructor(settings = CAMERA_DEFAULTS) {
    this.settings = sanitizeCameraSettings(settings);
    this.state = {
      fov: this.settings.baseFov,
      yawOffset: 0,
      pitchOffset: 0,
      focusOffset: 0,
      selectedTargetId: null,
      overrideRemaining: 0,
      assistWeight: 0,
      speed: 0,
    };
    this._velocity = new Vector3();
    this._losOrigin = new Vector3();
    this._losDelta = new Vector3();
    this._challengers = new Array(LOS_CHALLENGERS).fill(null);
    this._scores = new Float64Array(LOS_CHALLENGERS);
    this._target = null;
    this._holdRemaining = 0;
    this._scanRemaining = 0;
    this._scanCursor = 0;
  }

  configure(settings) {
    const previous = this.settings;
    this.settings = sanitizeCameraSettings({ ...previous, ...settings });
    const next = this.settings;
    this.state.fov = next.dynamicFov
      ? clamp(this.state.fov, next.baseFov, next.maxFov)
      : next.baseFov;
    this.state.overrideRemaining = Math.min(
      this.state.overrideRemaining,
      next.overrideDelay,
    );
    if (next.mode !== previous.mode || next.strength === 0) this._clearAssist();
    this._scanRemaining = 0;
    return this.settings;
  }

  _dropTarget() {
    this._target = null;
    this._holdRemaining = 0;
    this.state.selectedTargetId = null;
  }

  _clearAssist() {
    this._dropTarget();
    this.state.yawOffset = 0;
    this.state.pitchOffset = 0;
    this.state.focusOffset = 0;
    this.state.assistWeight = 0;
    this._scanRemaining = 0;
  }

  /** The follow camera first absorbs its rendered orbit into the manual
   * anchor. Clearing offsets then gives touch/mouse capture immediate control. */
  suspend() {
    this._clearAssist();
    this.state.overrideRemaining = this.settings.overrideDelay;
    return this.state;
  }

  resetMotion() {
    this._velocity.set(0, 0, 0);
    this.state.speed = 0;
    this.state.fov = this.settings.baseFov;
    this.state.overrideRemaining = 0;
    this._scanCursor = 0;
    this._clearAssist();
    return this.state;
  }

  _updateFov(dt, context) {
    const velocity = context?.velocity;
    const valid = finitePoint(velocity);
    // A finite cap protects permissive sandbox settings without affecting
    // normal physical speeds. All three collision-resolved axes contribute.
    const vx = valid ? clamp(velocity.x, -1e6, 1e6) : 0;
    const vy = valid ? clamp(velocity.y, -1e6, 1e6) : 0;
    const vz = valid ? clamp(velocity.z, -1e6, 1e6) : 0;
    const velocitySeconds = this.settings.smoothness * 0.5;
    const blend = response(dt, velocitySeconds);
    const midpointBlend = response(dt * 0.5, velocitySeconds);
    // Integrating the lens from the midpoint velocity avoids a frame-rate
    // dependent extra head start when the speed changes on a coarse frame.
    const midpointSpeed = Math.hypot(
      this._velocity.x + (vx - this._velocity.x) * midpointBlend,
      this._velocity.y + (vy - this._velocity.y) * midpointBlend,
      this._velocity.z + (vz - this._velocity.z) * midpointBlend,
    );
    this._velocity.x += (vx - this._velocity.x) * blend;
    this._velocity.y += (vy - this._velocity.y) * blend;
    this._velocity.z += (vz - this._velocity.z) * blend;
    const speed = Math.hypot(
      this._velocity.x,
      this._velocity.y,
      this._velocity.z,
    );
    this.state.speed = speed;
    const settings = this.settings;
    if (!settings.dynamicFov) {
      this.state.fov = settings.baseFov;
      return;
    }
    const motion = (Math.max(0, midpointSpeed - 2) * settings.sensitivity) / 8;
    const amount = -Math.expm1(-motion * motion);
    const desired =
      settings.baseFov + (settings.maxFov - settings.baseFov) * amount;
    this.state.fov = clamp(
      this.state.fov +
        (desired - this.state.fov) * response(dt, settings.smoothness),
      settings.baseFov,
      settings.maxFov,
    );
  }

  _score(enemy, position, yaw, context) {
    if (
      !enemy?.spawned ||
      !enemy.body?.active ||
      enemy.body.id == null ||
      !finitePoint(enemy.root?.position)
    )
      return -Infinity;
    const point = enemy.root.position;
    const dx = point.x - position.x;
    const dy = point.y - position.y;
    const dz = point.z - position.z;
    const distance = Math.hypot(dx, dy, dz);
    const horizontal = Math.hypot(dx, dz);
    if (
      !Number.isFinite(distance) ||
      distance > this.settings.awareness ||
      horizontal < 0.05
    )
      return -Infinity;
    const bearing = Math.abs(angle(Math.atan2(-dx, -dz) - yaw));
    const cone = (this.settings.mode === "assisted" ? 70 : 85) * DEG;
    if (bearing > cone) return -Infinity;
    const heading = 1 - bearing / cone;
    const velocity = context?.velocity;
    let approach = 0;
    if (finitePoint(velocity)) {
      const speed = Math.hypot(velocity.x, velocity.z);
      if (speed > 0.1 && Number.isFinite(speed))
        approach = Math.max(
          0,
          (velocity.x / speed) * (dx / horizontal) +
            (velocity.z / speed) * (dz / horizontal),
        );
    }
    const recent =
      context?.recentTargetId === enemy.body.id &&
      Number.isFinite(context.recentEngagementRemaining)
        ? clamp(context.recentEngagementRemaining / 0.5, 0, 1)
        : 0;
    const attack =
      context?.gameplayMode !== "tag" && enemy.combat?.attack?.active ? 1 : 0;
    return (
      heading * 1.5 +
      0.5 / (1 + distance / 12) +
      approach * 0.45 +
      recent * 0.75 +
      attack * 0.4
    );
  }

  _visible(enemy, position, context) {
    if (!context?.world?.firstBlock) return true;
    if (finitePoint(context.cameraPosition))
      this._losOrigin.copy(context.cameraPosition);
    else this._losOrigin.copy(position);
    if (!finitePoint(context.cameraPosition)) this._losOrigin.y += 1.02;
    this._losDelta.copy(enemy.root.position);
    this._losDelta.y += 1.02;
    this._losDelta.sub(this._losOrigin);
    if (!finitePoint(this._losDelta)) return false;
    return !context.world.firstBlock(this._losOrigin, this._losDelta, 0, 0);
  }

  _scan(position, yaw, context) {
    const enemies = context?.enemies;
    let currentScore = this._target
      ? this._score(this._target, position, yaw, context)
      : -Infinity;
    if (
      this._target &&
      (currentScore === -Infinity ||
        !this._visible(this._target, position, context))
    ) {
      this._dropTarget();
      currentScore = -Infinity;
    }
    this._challengers.fill(null);
    this._scores.fill(-Infinity);
    const length = enemies?.length ?? 0;
    const count = Math.min(length, MAX_CANDIDATES);
    for (let i = 0; i < count; i++) {
      const enemy = enemies[(this._scanCursor + i) % length];
      if (enemy === this._target) continue;
      const score = this._score(enemy, position, yaw, context);
      for (let slot = 0; slot < LOS_CHALLENGERS; slot++) {
        if (score <= this._scores[slot]) continue;
        for (let tail = LOS_CHALLENGERS - 1; tail > slot; tail--) {
          this._scores[tail] = this._scores[tail - 1];
          this._challengers[tail] = this._challengers[tail - 1];
        }
        this._scores[slot] = score;
        this._challengers[slot] = enemy;
        break;
      }
    }
    this._scanCursor = length ? (this._scanCursor + count) % length : 0;
    for (let slot = 0; slot < LOS_CHALLENGERS; slot++) {
      const enemy = this._challengers[slot];
      if (!enemy) break;
      if (!this._visible(enemy, position, context)) continue;
      if (
        !this._target ||
        (this._holdRemaining <= 0 &&
          this._scores[slot] > currentScore + CHALLENGER_MARGIN)
      ) {
        this._target = enemy;
        this.state.selectedTargetId = enemy.body.id;
        this._holdRemaining = TARGET_HOLD;
      }
      break;
    }
  }

  update(
    dt,
    position,
    manualYaw,
    manualPitch,
    context = null,
    manualInput = false,
  ) {
    const elapsed = Number.isFinite(dt) && dt > 0 ? dt : 0;
    const state = this.state;
    this._updateFov(elapsed, context);
    if (manualInput || context?.manualActive) {
      this.suspend();
      return state;
    }
    const priorOverride = state.overrideRemaining;
    state.overrideRemaining = Math.max(0, priorOverride - elapsed);
    if (
      this.settings.mode === "manual" ||
      this.settings.strength === 0 ||
      !finitePoint(position)
    ) {
      this._clearAssist();
      return state;
    }
    if (state.overrideRemaining > 0 || elapsed === 0) return state;
    const assistDt = Math.max(0, elapsed - priorOverride);
    const yaw = Number.isFinite(manualYaw) ? angle(manualYaw) : 0;
    const pitch = Number.isFinite(manualPitch)
      ? clamp(manualPitch, 0.06, 1.05)
      : 0.23;
    if (
      this._target &&
      (this._target.body?.id !== state.selectedTargetId ||
        this._score(this._target, position, yaw, context) === -Infinity)
    ) {
      this._dropTarget();
      this._scanRemaining = 0;
    }
    this._holdRemaining = Math.max(0, this._holdRemaining - assistDt);
    this._scanRemaining -= assistDt;
    if (this._scanRemaining <= 0) {
      this._scan(position, yaw, context);
      // At most one bounded query batch, even after a long suspended frame.
      this._scanRemaining =
        ((this._scanRemaining % SCAN_INTERVAL) + SCAN_INTERVAL) || SCAN_INTERVAL;
    }
    const blend = response(assistDt, this.settings.smoothness);
    state.assistWeight += ((this._target ? 1 : 0) - state.assistWeight) * blend;
    let yawOffset = 0;
    let pitchOffset = 0;
    let focusOffset = 0;
    if (this._target) {
      const point = this._target.root.position;
      const dx = point.x - position.x;
      const dy = point.y - position.y;
      const dz = point.z - position.z;
      const dynamic = this.settings.mode === "dynamic";
      const strength = this.settings.strength;
      const yawLimit = (dynamic ? 30 : 12) * DEG * strength;
      const pitchLimit = (dynamic ? 12 : 6) * DEG * strength;
      yawOffset = clamp(
        angle(Math.atan2(-dx, -dz) - yaw) * strength * 0.6,
        -yawLimit,
        yawLimit,
      );
      pitchOffset = clamp(
        -Math.atan2(dy, Math.hypot(dx, dz)) * strength * 0.25,
        -pitchLimit,
        pitchLimit,
      );
      // Respect the follow camera's orbit range while gently sharing height.
      pitchOffset = clamp(pitchOffset, 0.06 - pitch, 1.05 - pitch);
      focusOffset = clamp(dy * strength * 0.08, -0.5, 0.5);
    }
    state.yawOffset += (yawOffset * state.assistWeight - state.yawOffset) * blend;
    state.pitchOffset +=
      (pitchOffset * state.assistWeight - state.pitchOffset) * blend;
    state.focusOffset +=
      (focusOffset * state.assistWeight - state.focusOffset) * blend;
    return state;
  }
}
