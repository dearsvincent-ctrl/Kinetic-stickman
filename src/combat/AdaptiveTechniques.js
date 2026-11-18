import { createManualTechniques } from "./ManualTechniques.js";
import { ComboFlow } from "./ComboFlow.js";
/** Procedural technique families, mirrored at execution time. Reach is
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
      ...punch,
      id: "cross-punch",
      label: "Cross",
      strikeStyle: "cross",
      reach: 0.8,
      windup: 0.09,
      extension: 0.085,
      impact: 0.025,
      recovery: 0.26,
      transitionAfter: 0.15,
    }),
    Object.freeze({
      ...punch,
      id: "hook-punch",
      label: "Hook",
      strikeStyle: "hook",
      reach: 0.7,
      maxAngle: Math.PI / 3,
      windup: 0.095,
      extension: 0.065,
      impact: 0.045,
      recovery: 0.25,
      transitionAfter: 0.15,
    }),
    Object.freeze({
      ...kick,
      id: "roundhouse-kick",
      label: "Roundhouse kick",
      strikeStyle: "roundhouse",
      reach: 0.83,
      originHeight: 1.05,
      maxAngle: Math.PI / 3,
      windup: 0.13,
      extension: 0.1,
      impact: 0.045,
      recovery: 0.3,
      transitionAfter: 0.17,
    }),
    Object.freeze({
      ...kick,
      id: "side-kick",
      label: "Side kick",
      strikeStyle: "side",
      reach: 0.84,
      originHeight: 1.08,
      maxAngle: Math.PI / 3,
      windup: 0.14,
      extension: 0.095,
      impact: 0.04,
      recovery: 0.3,
      transitionAfter: 0.17,
    }),
    Object.freeze({
      ...kick,
      id: "spinning-kick",
      label: "Spinning kick",
      strikeStyle: "spinning",
      reach: 0.86,
      originHeight: 1.02,
      maxAngle: Math.PI,
      windup: 0.17,
      extension: 0.12,
      impact: 0.05,
      recovery: 0.33,
      transitionAfter: 0.2,
    }),
    Object.freeze({
      ...kick,
      id: "low-sweep",
      label: "Low sweep",
      strikeStyle: "sweep",
      reach: 0.7,
      originHeight: 0.32,
      maxVertical: 0.4,
      maxAngle: Math.PI / 3,
      windup: 0.12,
      extension: 0.1,
      impact: 0.045,
      recovery: 0.29,
      transitionAfter: 0.17,
    }),
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
  constructor({ scorePosition = null } = {}) {
    this.scorePosition = scorePosition;
    this.combo = new ComboFlow();
    this.readyAt = {
      "punch:left": -10,
      "punch:right": -10,
      "kick:left": -10,
      "kick:right": -10,
    };
  }
  choose(context, eligible) {
    const history = this.combo.read(context),
      previous = context.transition
        ? {
            id: context.transition.techniqueId,
            action: context.transition.action,
          }
        : history.at(-1),
      beforePrevious = history.at(-2),
      rotation = context.rotationRate?.[1] ?? 0,
      lateral = Math.abs(context.lateralMovement ?? 0);
    let id;
    if (context.gesture) id = context.gesture;
    else if (
      context.action === "punch" &&
      context.environment === "ground" &&
      Math.abs(rotation) > 2 &&
      (context.transition?.action === "kick" ||
        previous?.action === "kick" ||
        context.previousAction === "kick")
    )
      id = "rotational-backhand";
    else if (context.environment === "air")
      id = context.action === "punch" ? "aerial-punch" : "flying-kick";
    else if (context.action === "punch") {
      if (previous?.action === "punch")
        id =
          previous.id === "cross-punch" ||
          (previous.id === "basic-punch" && lateral > 0.65)
            ? "hook-punch"
            : previous.id === "hook-punch"
              ? "basic-punch"
              : "cross-punch";
      else if (previous?.action === "kick")
        id = lateral > 0.45 ? "hook-punch" : "cross-punch";
      else id = "basic-punch";
    } else if (context.action === "kick") {
      if (Math.abs(rotation) > 3) id = "spinning-kick";
      else if (lateral > 0.55) id = "side-kick";
      else if (
        previous?.id === "hook-punch" &&
        beforePrevious?.action === "kick" &&
        lateral > 0.35 &&
        (context.limbs?.left?.planted || context.limbs?.right?.planted)
      )
        // A supported kick → hook redirection can release into a spin with a
        // modest lateral cue. It remains an explicit Kick entry, including
        // when the standing body's independent angular velocity is zero.
        id = "spinning-kick";
      else if (previous?.action === "punch")
        id =
          beforePrevious?.action === "kick" && (context.speed ?? 0) < 2
            ? "low-sweep"
            : "roundhouse-kick";
      else if (previous?.action === "kick")
        id =
          previous.id === "front-kick"
            ? "roundhouse-kick"
            : previous.id === "roundhouse-kick" && (context.speed ?? 0) < 2
              ? "low-sweep"
              : "front-kick";
      else id = "front-kick";
    }
    // A shorter hook/sweep may be unavailable for a measured target. Keep the
    // requested action and environment, falling back to its ordinary entry.
    const fallback =
      context.environment === "air"
        ? context.action === "punch"
          ? "aerial-punch"
          : "flying-kick"
        : context.action === "punch"
          ? "basic-punch"
          : "front-kick";
    const technique =
      eligible.get(id) ?? (!context.gesture && eligible.get(fallback));
    if (!technique) return null;
    id = technique.id;
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
        (this.scorePosition?.(context, technique, side) ?? 0) +
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
    this.combo.accept(context, technique, side);
    return {
      id,
      side,
      label: `${side === "left" ? "Left" : "Right"} ${technique.label.toLowerCase()}`,
    };
  }
}
