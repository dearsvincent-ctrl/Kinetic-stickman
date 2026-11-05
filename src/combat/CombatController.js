export const BASIC_PUNCH = Object.freeze({
  id: "basic-punch",
  windup: 0.08,
  extension: 0.1,
  recovery: 0.24,
});

export const COMBAT_CONFIG = Object.freeze({
  postureHold: 0.15,
  cancelRecovery: 0.16,
});

const EPSILON = 1e-10;
const smoothstep = (value) => value * value * (3 - 2 * value);

// Selection sees an immutable snapshot, never live movement/camera objects.
// This happens only on accepted input, with no allocations in update().
const snapshot = (value, seen = new Map()) => {
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return seen.get(value);
  const copy = Array.isArray(value) ? [] : {};
  seen.set(value, copy);
  for (const [key, child] of Object.entries(value))
    copy[key] = snapshot(child, seen);
  return Object.freeze(copy);
};

const duration = (value, name) => {
  if (!Number.isFinite(value) || value < 0)
    throw new RangeError(`${name} must be a finite, nonnegative duration`);
  return value;
};

const makeRegistry = (definitions) => {
  const entries =
    definitions instanceof Map
      ? definitions.values()
      : Array.isArray(definitions)
        ? definitions
        : Object.values(definitions);
  const registry = new Map();
  for (const definition of entries) {
    if (!definition?.id || typeof definition.id !== "string")
      throw new TypeError("A combat technique needs a string id");
    const technique = Object.freeze({
      ...definition,
      windup: duration(definition.windup, "windup"),
      extension: duration(definition.extension, "extension"),
      recovery: duration(definition.recovery, "recovery"),
    });
    if (technique.windup + technique.extension + technique.recovery <= 0)
      throw new RangeError(
        "A combat technique needs a positive total duration",
      );
    registry.set(technique.id, technique);
  }
  if (registry.size === 0)
    throw new RangeError("At least one technique is required");
  return registry;
};

/** Upper-body action timing only: never changes velocity, dash or actor transforms.
 * Presses during recovery are rejected, rather than queued for a later strike.
 * Future technique selection can inspect movement/opponent context at entry.
 */
export class CombatController {
  constructor({
    techniques = [BASIC_PUNCH],
    selectTechnique,
    postureHold = COMBAT_CONFIG.postureHold,
    cancelRecovery = COMBAT_CONFIG.cancelRecovery,
  } = {}) {
    this.config = Object.freeze({
      postureHold: duration(postureHold, "postureHold"),
      cancelRecovery: duration(cancelRecovery, "cancelRecovery"),
    });
    this.techniques = makeRegistry(techniques);
    this.selectTechnique =
      selectTechnique ??
      (() =>
        this.techniques.has(BASIC_PUNCH.id)
          ? BASIC_PUNCH.id
          : this.techniques.keys().next().value);
    this.blocking = false;
    this.attack = {
      active: false,
      phase: "idle",
      elapsed: 0,
      phaseProgress: 0,
      extension: 0,
      sequence: 0,
      techniqueId: null,
      context: null,
      cancelled: false,
      exitReason: null,
    };
    this._technique = null;
    this._phaseElapsed = 0;
    this._recoveryDuration = 0;
    this._recoveryExtension = 0;
    this._postureRemaining = 0;
  }

  get ready() {
    return !this.blocking && !this.attack.active;
  }

  get postureActive() {
    return (
      this.blocking || this.attack.active || this._postureRemaining > EPSILON
    );
  }

  setBlocking(value) {
    const blocking = Boolean(value);
    if (blocking === this.blocking) return;
    this.blocking = blocking;
    if (blocking) {
      this._cancelAttack("blocked");
    } else {
      this._postureRemaining = this.config.postureHold;
    }
  }

  requestAttack(context = {}) {
    if (!this.ready) return false;
    const selectionContext = snapshot(context);
    const selected = this.selectTechnique(selectionContext, this.techniques);
    const technique = this.techniques.get(
      typeof selected === "string" ? selected : selected?.id,
    );
    if (!technique) return false;

    this._technique = technique;
    this._phaseElapsed = 0;
    this._recoveryDuration = technique.recovery;
    this._recoveryExtension = 1;
    this._postureRemaining = 0;
    Object.assign(this.attack, {
      active: true,
      phase: "windup",
      elapsed: 0,
      phaseProgress: 0,
      extension: 0,
      sequence: this.attack.sequence + 1,
      techniqueId: technique.id,
      context: selectionContext,
      cancelled: false,
      exitReason: null,
    });
    return true;
  }

  update(dt) {
    if (!Number.isFinite(dt) || dt <= 0) return;
    let remaining = dt;
    // Consume phase boundaries and leftover posture time even on a long frame.
    while (this.attack.active && remaining > EPSILON) {
      const phaseDuration =
        this.attack.phase === "recovery"
          ? this._recoveryDuration
          : this._technique[this.attack.phase];
      const step = Math.min(
        remaining,
        Math.max(0, phaseDuration - this._phaseElapsed),
      );
      this._phaseElapsed += step;
      this.attack.elapsed += step;
      remaining -= step;
      const progress =
        phaseDuration > 0 ? Math.min(1, this._phaseElapsed / phaseDuration) : 1;
      this.attack.phaseProgress = progress;
      this.attack.extension =
        this.attack.phase === "extension"
          ? smoothstep(progress)
          : this.attack.phase === "recovery"
            ? this._recoveryExtension * (1 - smoothstep(progress))
            : 0;

      if (phaseDuration - this._phaseElapsed <= EPSILON) this._nextPhase();
    }
    if (!this.attack.active && !this.blocking)
      this._postureRemaining = Math.max(0, this._postureRemaining - remaining);
  }

  _nextPhase() {
    this._phaseElapsed = 0;
    this.attack.phaseProgress = 0;
    if (this.attack.phase === "windup") {
      this.attack.phase = "extension";
    } else if (this.attack.phase === "extension") {
      this.attack.phase = "recovery";
      this.attack.extension = 1;
    } else {
      this.attack.active = false;
      this.attack.phase = "idle";
      this.attack.extension = 0;
      this.attack.exitReason ??= "completed";
      this._postureRemaining = this.config.postureHold;
    }
  }

  _cancelAttack(reason) {
    if (!this.attack.active || this.attack.cancelled) return;
    this.attack.cancelled = true;
    this.attack.exitReason = reason;
    this._recoveryExtension = this.attack.extension;
    this._recoveryDuration = this.config.cancelRecovery;
    this._phaseElapsed = 0;
    this.attack.phase = "recovery";
    this.attack.phaseProgress = 0;
  }

  reset() {
    this.setBlocking(false);
    this._cancelAttack("cancelled");
  }

  stop() {
    this.reset();
  }
}
