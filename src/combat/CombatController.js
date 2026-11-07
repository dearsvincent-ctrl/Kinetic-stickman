import {
  DEFAULT_TECHNIQUES,
  isTechniqueEligible,
  selectBasicTechnique,
  techniqueContext,
} from "./Techniques.js";
export { BASIC_PUNCH, CROSS_PUNCH, FLYING_KICK } from "./Techniques.js";

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
      animation: "punch",
      side: "right",
      reach: 0.76,
      originHeight: 1.4,
      maxVertical: 0.35,
      maxAngle: Math.PI / 4,
      minHeight: 0,
      minAirTimeRemaining: 0,
      ...definition,
      environments: Object.freeze([...(definition.environments ?? ["ground"])]),
      windup: duration(definition.windup, "windup"),
      extension: duration(definition.extension, "extension"),
      impact: duration(definition.impact ?? 0, "impact"),
      recovery: duration(definition.recovery, "recovery"),
    });
    for (const key of [
      "reach",
      "originHeight",
      "maxVertical",
      "maxAngle",
      "minHeight",
      "minAirTimeRemaining",
    ])
      if (!Number.isFinite(technique[key]) || technique[key] < 0)
        throw new RangeError(`Invalid technique ${key}`);
    if (
      !technique.environments.length ||
      technique.environments.some((value) => !["ground", "air"].includes(value))
    )
      throw new RangeError("Technique environments must be ground and/or air");
    if (technique.maxAngle > Math.PI)
      throw new RangeError("Technique facing angle cannot exceed pi");
    if (
      technique.eligible !== undefined &&
      typeof technique.eligible !== "function"
    )
      throw new TypeError("Technique eligibility must be a function");
    if (
      technique.windup +
        technique.extension +
        technique.impact +
        technique.recovery <=
      0
    )
      throw new RangeError(
        "A combat technique needs a positive total duration",
      );
    registry.set(technique.id, technique);
  }
  if (registry.size === 0)
    throw new RangeError("At least one technique is required");
  return registry;
};

/** Technique timing only: never changes velocity, dash or actor transforms.
 * Adaptive techniques declare compatible interruption windows. Entries are
 * accepted immediately or rejected, never queued for a later strike.
 */
export class CombatController {
  constructor({
    techniques = DEFAULT_TECHNIQUES,
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
      ((context, eligible) =>
        selectBasicTechnique(context, eligible, this.lastCompletedTechniqueId));
    this.lastCompletedTechniqueId = null;
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
    this.transitionCooldown = 0;
    this.lastTransition = null;
    this._phaseElapsed = 0;
    this._recoveryDuration = 0;
    this._recoveryExtension = 0;
    this._postureRemaining = 0;
  }

  get ready() {
    return !this.blocking && !this.attack.active;
  }

  get currentTechnique() {
    return this._technique;
  }

  get timeToBoundary() {
    if (!this.attack.active) return Infinity;
    const duration =
      this.attack.phase === "recovery"
        ? this._recoveryDuration
        : this._technique[this.attack.phase];
    return Math.max(0, duration - this._phaseElapsed);
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
    const eligible = new Map();
    for (const technique of this.techniques.values())
      if (
        (!selectionContext.techniqueContexts ||
          Object.hasOwn(selectionContext.techniqueContexts, technique.id)) &&
        isTechniqueEligible(
          technique,
          techniqueContext(selectionContext, technique.id),
        )
      )
        eligible.set(technique.id, technique);
    if (!eligible.size) return false;
    const selected = this.selectTechnique(selectionContext, eligible);
    let technique = eligible.get(
      typeof selected === "string" ? selected : selected?.id,
    );
    if (!technique) return false;
    if (technique.adaptive && selected?.side)
      technique = Object.freeze({
        ...technique,
        side: selected.side,
        label: selected.label ?? technique.label,
      });
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
      context: selectionContext.techniqueContexts
        ? snapshot(techniqueContext(selectionContext, technique.id))
        : selectionContext,
      cancelled: false,
      exitReason: null,
    });
    return true;
  }

  update(dt) {
    if (!Number.isFinite(dt) || dt <= 0) return;
    this.transitionCooldown = Math.max(0, this.transitionCooldown - dt);
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
          : this.attack.phase === "impact"
            ? 1
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
      this.attack.phase = this._technique.impact > 0 ? "impact" : "recovery";
      this.attack.extension = 1;
    } else if (this.attack.phase === "impact") {
      this.attack.phase = "recovery";
      this.attack.extension = 1;
    } else {
      if (!this.attack.cancelled)
        this.lastCompletedTechniqueId = this.attack.techniqueId;
      this.attack.active = false;
      this.attack.phase = "idle";
      this.attack.extension = 0;
      this.attack.exitReason ??= "completed";
      this._postureRemaining = this.config.postureHold;
    }
    if (this.attack.active) {
      const nextDuration =
        this.attack.phase === "recovery"
          ? this._recoveryDuration
          : this._technique[this.attack.phase];
      if (nextDuration === 0) this._nextPhase();
    }
  }

  transitionAttack(context = {}) {
    const attack = this.attack,
      from = this._technique;
    if (
      !from?.adaptive ||
      !attack.active ||
      attack.cancelled ||
      this.blocking ||
      this.transitionCooldown > 0
    )
      return false;
    const rotational = from.gesture || context.rotationActive;
    if (
      attack.elapsed < (context.gesture ? 0 : (from.transitionAfter ?? 0.14)) ||
      (!rotational && attack.phase !== "recovery")
    )
      return false;
    const transition = {
      techniqueId: from.id,
      action: from.action,
      side: from.side,
      extension: attack.extension,
      phase: attack.phase,
      kind: context.gesture
        ? "redirection"
        : context.action !== from.action
          ? "continuation"
          : "cancellation",
    };
    attack.active = false;
    const accepted = this.requestAttack({ ...context, transition });
    if (!accepted) {
      attack.active = true;
      return false;
    }
    this.transitionCooldown = 0.14;
    this.lastTransition = Object.freeze(transition);
    return true;
  }

  // Movement states may end a grounded strike without releasing held defence.
  // Repeated cancellation keeps the same recovery instead of restarting it.
  cancelAttack(reason = "movement") {
    this._cancelAttack(reason);
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
    if (this._recoveryDuration === 0) this._nextPhase();
  }

  reset() {
    this.setBlocking(false);
    this._cancelAttack("cancelled");
  }

  stop() {
    this.reset();
  }
}
