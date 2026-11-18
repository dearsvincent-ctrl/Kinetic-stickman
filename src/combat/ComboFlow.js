export const COMBO_LIMITS = Object.freeze({
  history: 4,
  continuationWindow: 0.65,
});

/** A short record of accepted manual strikes, never a list of future attacks.
 * The continuation window begins after authored recovery, so input cadence
 * stays useful for both a recovery interrupt and an ordinary held repeat. */
export class ComboFlow {
  constructor() {
    this.history = [];
    this.environment = null;
    this.epoch = null;
    this.clock = null;
  }

  read(context) {
    const environment = context.environment ?? "ground",
      epoch = context.comboEpoch ?? null,
      clock = Number.isFinite(context.clock) ? context.clock : null,
      last = this.history.at(-1);
    if (
      environment !== this.environment ||
      epoch !== this.epoch ||
      clock === null ||
      (this.clock !== null && clock < this.clock - 1e-9) ||
      (last && clock > last.endClock + COMBO_LIMITS.continuationWindow)
    )
      this.history.length = 0;
    this.environment = environment;
    this.epoch = epoch;
    this.clock = clock;
    return this.history;
  }

  accept(context, technique, side) {
    if (this.clock === null) return;
    this.history.push(
      Object.freeze({
        id: technique.id,
        action: technique.action,
        side,
        environment: this.environment,
        clock: this.clock,
        endClock:
          this.clock +
          technique.windup +
          technique.extension +
          technique.impact +
          technique.recovery,
        inputKind: context.inputKind ?? "press",
      }),
    );
    if (this.history.length > COMBO_LIMITS.history) this.history.shift();
  }

  reset() {
    this.history.length = 0;
    this.environment = null;
    this.epoch = null;
    this.clock = null;
  }
}
