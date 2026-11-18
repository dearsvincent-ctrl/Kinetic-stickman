/** One entry request, no recovery queue. Held actions are sampled only after
 * full recovery. Latest held choice wins; each source's release is independent.
 * This scheduler never reads frame/animation poses, opponents or movement speed.
 */
export class AttackScheduler {
  constructor(combat) {
    this.combat = combat;
    this.held = new Map();
    this.order = 0;
    this.pending = null;
    this.comboEpoch = 0;
    this.comboInterrupted = false;
    this.environment = null;
  }
  gesture(kind, direction, intensity) {
    this.gestureRequest = { kind, direction, intensity };
  }
  press(action) {
    if (action !== "punch" && action !== "kick") return;
    this.pending = action;
    if (this.held.has(action)) this.held.set(action, ++this.order);
  }
  setHeld(action, value) {
    if (action !== "punch" && action !== "kick") return;
    if (value) {
      if (!this.held.has(action)) this.held.set(action, ++this.order);
    } else this.held.delete(action);
  }
  prepare(context, blocking = false) {
    const combat = this.combat;
    combat.setBlocking(blocking);
    const environment = context.environment ?? "ground",
      interrupted = blocking || context.canAttack === false;
    if (
      (interrupted && !this.comboInterrupted) ||
      (this.environment !== null && environment !== this.environment)
    )
      this.comboEpoch++;
    this.comboInterrupted = interrupted;
    this.environment = environment;
    const technique = combat.currentTechnique;
    if (
      combat.attack.active &&
      technique &&
      (context.canAttack === false ||
        !technique.environments.includes(environment))
    )
      combat.cancelAttack(environment === "ground" ? "landing" : "movement");
    const gesture = this.gestureRequest;
    this.gestureRequest = null;
    const entry = this.pending;
    this.pending = null;
    if (blocking || context.canAttack === false) return false;
    const request = gesture
      ? {
          ...context,
          action: "kick",
          source: "manual",
          inputKind: "gesture",
          comboEpoch: this.comboEpoch,
          gesture: gesture.kind,
          gestureDirection: gesture.direction,
          gestureIntensity: gesture.intensity,
        }
      : entry
        ? {
            ...context,
            action: entry,
            source: "manual",
            inputKind: "press",
            comboEpoch: this.comboEpoch,
          }
        : null;
    if (!combat.ready)
      return request ? combat.transitionAttack(request) : false;
    if (gesture) return combat.requestAttack(request);
    let action = entry;
    if (!action) {
      let order = -1;
      for (const [candidate, stamp] of this.held)
        if (stamp > order) {
          action = candidate;
          order = stamp;
        }
    }
    return action
      ? combat.requestAttack({
          ...context,
          action,
          source: "manual",
          inputKind: entry ? "press" : "hold",
          comboEpoch: this.comboEpoch,
        })
      : false;
  }
  reset() {
    this.pending = null;
    this.gestureRequest = null;
    this.held.clear();
    this.comboEpoch++;
    this.comboInterrupted = false;
    this.environment = null;
  }
}
