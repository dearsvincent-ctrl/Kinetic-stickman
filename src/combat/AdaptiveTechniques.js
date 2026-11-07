import { createManualTechniques } from "./ManualTechniques.js";
/** Seven procedural technique families, mirrored at execution time. Reach is
 * authored in metres from actual limb extension, never scaled with movement. */
export function createAdaptiveTechniques() {
  const base = createManualTechniques().map((t) =>
    Object.freeze({
      ...t,
      adaptive: true,
      transitionAfter: t.action === "kick" ? 0.13 : 0.14,
    }),
  );
  const kick = base.find((t) => t.id === "front-kick"),
    punch = base[0];
  return [
    ...base,
    Object.freeze({
      ...kick,
      id: "whip-kick",
      label: "Spinning whip kick",
      gesture: "whip-kick",
      animation: "whip-kick",
      maxAngle: Math.PI,
      reach: 0.95,
      originHeight: 1.12,
      windup: 0.045,
      extension: 0.09,
      impact: 0.14,
      recovery: 0.17,
      transitionAfter: 0.13,
    }),
    Object.freeze({
      ...kick,
      id: "descending-sweep",
      label: "Descending sweep",
      gesture: "descending-sweep",
      animation: "descending-sweep",
      maxAngle: Math.PI,
      reach: 0.95,
      originHeight: 0.65,
      windup: 0.055,
      extension: 0.1,
      impact: 0.13,
      recovery: 0.18,
      transitionAfter: 0.14,
    }),
    Object.freeze({
      ...punch,
      id: "rotational-backhand",
      label: "Rotational backhand",
      animation: "backhand",
      maxAngle: Math.PI,
      reach: 0.82,
      windup: 0.04,
      extension: 0.08,
      impact: 0.045,
      recovery: 0.2,
      transitionAfter: 0.12,
    }),
  ];
}
export class ContextualLimbSelector {
  constructor() {
    this.readyAt = {
      "punch:left": -10,
      "punch:right": -10,
      "kick:left": -10,
      "kick:right": -10,
    };
  }
  choose(context, eligible) {
    const rotation = context.rotationRate?.[1] ?? 0;
    let id;
    if (context.gesture) id = context.gesture;
    else if (
      context.action === "punch" &&
      context.environment === "ground" &&
      Math.abs(rotation) > 2 &&
      (context.transition?.action === "kick" ||
        context.previousAction === "kick")
    )
      id = "rotational-backhand";
    else
      id =
        context.environment === "air"
          ? context.action === "punch"
            ? "aerial-punch"
            : "flying-kick"
          : context.action === "punch"
            ? "basic-punch"
            : "front-kick";
    const technique = eligible.get(id);
    if (!technique) return null;
    const action = technique.action,
      time = context.clock ?? 0,
      sideInput = context.lateralMovement ?? 0;
    const score = (side) => {
      const sign = side === "left" ? -1 : 1,
        m = context.limbs?.[side] ?? {};
      const resetting = Math.max(
        0,
        Math.min(1, (this.readyAt[`${action}:${side}`] - time) / 0.09),
      );
      const compact =
        action === "punch"
          ? (m.elbow ?? 1.7) / 1.9
          : 1 - (m.legExtension ?? 0.5) * 0.25;
      const support =
        action === "kick"
          ? context.limbs?.[side === "left" ? "right" : "left"]?.planted
            ? 0.25
            : 0
          : 0;
      return (
        compact * 0.2 +
        sign * sideInput * 0.65 +
        sign * rotation * 0.045 +
        support -
        resetting * 0.4 +
        (side === "right" ? 0.025 : 0)
      );
    };
    const side = score("left") > score("right") ? "left" : "right";
    this.readyAt[`${action}:${side}`] =
      time +
      technique.windup +
      technique.extension +
      technique.impact +
      technique.recovery +
      0.075;
    return {
      id,
      side,
      label: `${side === "left" ? "Left" : "Right"} ${technique.label.toLowerCase()}`,
    };
  }
}
