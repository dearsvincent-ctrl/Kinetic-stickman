const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
/** Independent of health and displacement. Wear accumulates from physical
 * context; no hit counter or compulsory combo/knockdown sequence. */
export class BalanceState {
  constructor() {
    this.reset();
  }
  reset() {
    this.instability = 0;
    this.sinceHit = 10;
    this.lastLoad = 0;
  }
  update(dt, settings, profile = {}) {
    if (!Number.isFinite(dt) || dt <= 0) return;
    const before = this.sinceHit;
    this.sinceHit += dt;
    const recoveryTime = Math.max(0, this.sinceHit - Math.max(0.5, before));
    this.instability = Math.max(
      0,
      this.instability -
        recoveryTime * 0.24 * settings.balanceRecovery * (profile.balance ?? 1),
    );
  }
  hit(impact, settings, profile = {}, context = {}) {
    const stability =
      Math.max(0.25, profile.balance ?? 1) * settings.knockdownResistance;
    const mass = Math.sqrt(
      Math.max(0.025, (profile.mass ?? 1) * settings.mass),
    );
    const location =
      impact.location === "leg" ? 1.4 : impact.location === "head" ? 1.15 : 1;
    const posture =
      (context.guarded
        ? 0.65
        : context.kicking
          ? 1.25
          : context.committed
            ? 1.1
            : 1) *
      (context.airborne ? 1.25 : 1) *
      (1 + Math.min(0.2, Math.max(0, context.speed ?? 0) / 60));
    const lateral = 1 + Math.min(0.25, Math.abs(context.side ?? 0) * 0.25);
    const closing =
      1 + Math.min(0.2, Math.log1p(Math.max(0, impact.speed ?? 0) / 20) * 0.05);
    const intrinsic =
      impact.action === "kick"
        ? 0.2
        : impact.action === "impact"
          ? 0.035
          : 0.12;
    const wear =
      (intrinsic *
        settings.balanceDamage *
        location *
        posture *
        lateral *
        closing) /
      (stability * mass);
    // A wide standing band absorbs displacement. Extreme impulses can still
    // destroy footing immediately, even without previous hits.
    const critical = Math.max(1, settings.knockdown * 4) * stability;
    const kinetic =
      0.45 *
      ((Number.isFinite(impact.force) ? Math.max(0, impact.force) : 0) /
        critical) **
        2;
    this.lastLoad = clamp(wear + kinetic, 0, 2);
    this.instability = clamp(this.instability + this.lastLoad, 0, 2);
    this.sinceHit = 0;
    return this.instability >= 1;
  }
}
