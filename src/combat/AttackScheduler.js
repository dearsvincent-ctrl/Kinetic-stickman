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
  }
  press(action) {
    if (action !== "punch" && action !== "kick") return;
    this.pending = action;
    if (this.held.has(action)) this.held.set(action, ++this.order);
  }
  setHeld(action, value) {
    if (value) {
      if (!this.held.has(action)) this.held.set(action, ++this.order);
    } else this.held.delete(action);
  }
  prepare(context, blocking = false) {
    const combat = this.combat;
    combat.setBlocking(blocking);
    const technique = combat.currentTechnique;
    if (
      combat.attack.active &&
      technique &&
      (!context.canAttack ||
        !technique.environments.includes(context.environment))
    )
      combat.cancelAttack(
        context.environment === "ground" ? "landing" : "movement",
      );
    const entry = this.pending;
    this.pending = null;
    if (blocking || !combat.ready || context.canAttack === false) return false;
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
      ? combat.requestAttack({ ...context, action, source: "manual" })
      : false;
  }
  reset() {
    this.pending = null;
    this.held.clear();
  }
}
