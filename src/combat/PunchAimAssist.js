import { Quaternion, Vector3 } from "three";
import {
  sampleLocalStrike,
  worldStrike,
  BODY_PIVOT,
} from "./TechniqueGeometry.js";
import { strikeAlignmentPivot } from "./PunchAlignment.js";
import {
  AIM_ASSIST_DEFAULTS,
  AIM_ASSIST_LIMITS,
  sanitizeAimAssist,
} from "../sandbox/AimAssistSettings.js";
export { AIM_ASSIST_DEFAULTS, AIM_ASSIST_LIMITS, sanitizeAimAssist };

const RAD = Math.PI / 180;
const UP = new Vector3(0, 1, 0);
const ZERO = new Vector3();
const SAMPLES = 7;
/** Selection occurs once per accepted manual strike, including held repeats.
 * Short-horizon predictions rank actual hand paths, never apply root motion,
 * extend reach, track a lock or turn contact into an automatic hit. */
export class PunchAimAssist {
  constructor({ targets = [], config = {} } = {}) {
    this.targets = targets;
    this.configure(config);
    this.position = new Vector3();
    this.velocity = new Vector3();
    this.angularVelocity = new Vector3();
    this.orientation = new Quaternion();
    this.predictedOrientation = new Quaternion();
    this.inverse = new Quaternion();
    this.delta = new Quaternion();
    this.axis = new Vector3();
    this.local = new Vector3();
    this.root = new Vector3();
    this.targetPoint = new Vector3();
    this.targetOrigin = new Vector3();
    this.fromDirection = new Vector3();
    this.toDirection = new Vector3();
    this.rotation = new Quaternion();
    this.pivot = new Vector3();
    this.times = new Float64Array(SAMPLES);
    this.points = Array.from({ length: SAMPLES }, () => new Vector3());
    this.hasMotion = false;
    this.targetFraction = 1;
    this.queries = 0;
    this.last = null;
  }
  configure(values) {
    this.config = sanitizeAimAssist(values);
    this.cacheContext = null;
  }
  limbPreference(context, technique, side) {
    if (
      (technique.action !== "punch" && technique.action !== "kick") ||
      !technique.adaptive ||
      !this.hasMotion ||
      this.config.strength === 0 ||
      this.config.maxAngle === 0
    )
      return 0;
    if (this.cacheContext !== context || this.cacheId !== technique.id) {
      this.cacheContext = context;
      this.cacheId = technique.id;
      this.cache = {
        left: this.evaluate(context, { ...technique, side: "left" }),
        right: this.evaluate(context, { ...technique, side: "right" }),
      };
    }
    const own = this.cache[side]?.score ?? 1;
    const other = this.cache[side === "left" ? "right" : "left"]?.score ?? 1;
    // Small positional tie-break. Recovery, posture and rotational momentum
    // retain stronger weights; the same limb can still strike consecutively.
    return (
      Math.max(-1, Math.min(1, (other - own) / 0.08)) *
      0.1 *
      Math.min(1, this.config.strength)
    );
  }
  capture(controller, previous, rotation, orientationStart, fraction, dt) {
    this.cacheContext = null;
    this.targetFraction = fraction;
    this.position.lerpVectors(previous, controller.root.position, fraction);
    this.velocity.copy(controller.velocity);
    this.gravity = controller.jump.airborne
      ? controller.jump.config.gravity
      : 0;
    this.velocity.y = controller.jump.airborne
      ? controller.jump.verticalVelocity + this.gravity * dt * (1 - fraction)
      : 0;
    if (rotation) {
      this.orientation.slerpQuaternions(
        orientationStart,
        rotation.orientation,
        fraction,
      );
      this.angularVelocity.copy(rotation.angularVelocity);
    } else {
      this.orientation.setFromAxisAngle(UP, controller.heading);
      this.angularVelocity.set(0, 0, 0);
    }
    this.lift = rotation?.lift ?? 0;
    this.hasMotion = true;
  }
  setMotion({
    position,
    velocity = ZERO,
    orientation = null,
    heading = 0,
    angularVelocity = ZERO,
    verticalVelocity = 0,
    gravity = 0,
    lift = 0,
  }) {
    this.position.copy(position);
    this.targetFraction = 1;
    this.cacheContext = null;
    this.velocity.copy(velocity);
    this.velocity.y = verticalVelocity;
    this.orientation.copy(
      orientation ?? this.delta.setFromAxisAngle(UP, heading),
    );
    this.angularVelocity.copy(angularVelocity);
    this.gravity = gravity;
    this.lift = lift;
    this.hasMotion = true;
  }
  predictPose(time) {
    this.root.copy(this.position).addScaledVector(this.velocity, time);
    this.root.y = Math.max(0, this.root.y - 0.5 * this.gravity * time * time);
    this.predictedOrientation.copy(this.orientation);
    const speed = this.angularVelocity.length();
    if (speed > 1e-8) {
      this.axis.copy(this.angularVelocity).multiplyScalar(1 / speed);
      this.delta.setFromAxisAngle(this.axis, speed * time);
      this.predictedOrientation.multiply(this.delta).normalize();
    }
  }
  prepare(context, technique) {
    if (technique.action !== "punch" && technique.action !== "kick")
      return context;
    this.last = null;
    if (
      !technique.adaptive ||
      !this.hasMotion ||
      this.config.strength === 0 ||
      this.config.maxAngle === 0
    )
      return context;
    this.queries++;
    const selected =
      this.cacheContext === context && this.cacheId === technique.id
        ? this.cache[technique.side]
        : this.evaluate(context, technique);
    this.last = selected;
    if (!selected) return context;
    // Up to 100% keeps the original single captured correction. Beyond 100%,
    // blend toward an immutable predicted active-window path, never past the
    // target. No live tracking or additional target queries during execution.
    if (this.config.strength > 1) {
      selected.profile = this.alignmentProfile(context, technique, selected);
      selected.profileRate = 0;
      for (let i = 1; i < (selected.profile?.length ?? 0); i++) {
        this.rotation.fromArray(selected.profile[i - 1]);
        this.delta.fromArray(selected.profile[i]);
        selected.profileRate = Math.max(
          selected.profileRate,
          (this.rotation.angleTo(this.delta) * (SAMPLES - 1)) /
            (technique.extension + technique.impact),
        );
      }
    }
    return {
      ...context,
      [technique.action === "punch" ? "punchAim" : "kickAim"]: selected,
    };
  }
  evaluate(context, technique) {
    const config = this.config;
    for (let i = 0; i < SAMPLES; i++) {
      const time =
        technique.windup +
        ((technique.extension + technique.impact) * i) / (SAMPLES - 1);
      this.times[i] = time;
      this.predictPose(time);
      sampleLocalStrike(this.local, technique, time, context);
      worldStrike(
        this.points[i],
        this.local,
        this.root,
        this.predictedOrientation,
        this.lift,
      );
    }
    let best = Infinity,
      selected = null;
    // Nearby means near the imminent physical punch corridor, including its
    // short travel at sandbox speeds. Contact reach itself never changes.
    const horizon = Math.min(
      AIM_ASSIST_LIMITS.predictionHorizon,
      technique.windup + technique.extension + technique.impact,
    );
    const searchDistance =
      AIM_ASSIST_LIMITS.acquireDistance +
      Math.min(
        AIM_ASSIST_LIMITS.maxTravelLead,
        this.velocity.length() * horizon,
      );
    for (const candidate of this.targets) {
      const body = candidate.body ?? candidate;
      if (
        !body?.active ||
        candidate.spawned === false ||
        !body.position ||
        ![body.position.x, body.position.y, body.position.z].every(
          Number.isFinite,
        )
      )
        continue;
      const previous = body.previousPosition;
      if (
        previous &&
        [previous.x, previous.y, previous.z].every(Number.isFinite)
      )
        this.targetOrigin.lerpVectors(
          previous,
          body.position,
          this.targetFraction,
        );
      else this.targetOrigin.copy(body.position);
      if (
        this.position.distanceTo(this.targetOrigin) >
        searchDistance + (body.radius ?? 0.32)
      )
        continue;
      const reactionOwned = candidate.reaction?.ownsMotion;
      const reactionFlight =
        reactionOwned &&
        (candidate.reaction.phase === "flight" ||
          Math.abs(candidate.reaction.velocity.y) > 1e-4);
      const velocity = reactionOwned
        ? candidate.reaction.velocity
        : (candidate.controller?.velocity ?? body.velocity ?? ZERO);
      const impulse = reactionOwned ? ZERO : (body.impulse ?? ZERO);
      if (
        ![
          velocity.x,
          velocity.y,
          velocity.z,
          impulse.x,
          impulse.y,
          impulse.z,
        ].every(Number.isFinite)
      )
        continue;
      for (const box of body.hitboxes ?? [
        { height: body.strikeHeight ?? 1.4, radius: body.strikeRadius ?? 0.24 },
      ]) {
        if (
          !Number.isFinite(box.height) ||
          !Number.isFinite(box.radius) ||
          box.radius <= 0
        )
          continue;
        for (let i = 1; i < SAMPLES; i++) {
          const t0 = this.times[i - 1],
            t1 = this.times[i];
          const p0 = this.points[i - 1],
            p1 = this.points[i];
          const k0 = (1 - Math.exp(-8 * t0)) / 8,
            k1 = (1 - Math.exp(-8 * t1)) / 8;
          const x =
            p0.x -
            this.targetOrigin.x -
            (box.x ?? 0) -
            velocity.x * t0 -
            impulse.x * k0;
          const y =
            p0.y -
            this.targetOrigin.y -
            box.height -
            velocity.y * t0 +
            (reactionFlight ? 9 * t0 * t0 : 0);
          const z =
            p0.z -
            this.targetOrigin.z -
            (box.z ?? 0) -
            velocity.z * t0 -
            impulse.z * k0;
          const dx =
            p1.x -
            this.targetOrigin.x -
            (box.x ?? 0) -
            velocity.x * t1 -
            impulse.x * k1 -
            x;
          const dy =
            p1.y -
            this.targetOrigin.y -
            box.height -
            velocity.y * t1 +
            (reactionFlight ? 9 * t1 * t1 : 0) -
            y;
          const dz =
            p1.z -
            this.targetOrigin.z -
            (box.z ?? 0) -
            velocity.z * t1 -
            impulse.z * k1 -
            z;
          const length = dx * dx + dy * dy + dz * dz;
          const f =
            length > 1e-12
              ? Math.max(0, Math.min(1, -(x * dx + y * dy + z * dz) / length))
              : 0;
          const time = t0 + (t1 - t0) * f;
          const trajectoryDistance = Math.hypot(
            x + dx * f,
            y + dy * f,
            z + dz * f,
          );
          this.predictPose(time);
          const impulseTime = (1 - Math.exp(-8 * time)) / 8;
          this.targetPoint
            .copy(this.targetOrigin)
            .addScaledVector(velocity, time);
          this.targetPoint.x += (box.x ?? 0) + impulse.x * impulseTime;
          this.targetPoint.z += (box.z ?? 0) + impulse.z * impulseTime;
          this.targetPoint.y +=
            box.height - (reactionFlight ? 9 * time * time : 0);
          this.targetPoint.sub(this.root);
          this.targetPoint.y -= BODY_PIVOT + this.lift;
          this.inverse.copy(this.predictedOrientation).invert();
          this.targetPoint.applyQuaternion(this.inverse);
          this.targetPoint.y += BODY_PIVOT;
          const vertical = this.targetPoint.y - technique.originHeight;
          const reach = Math.hypot(
            this.targetPoint.x,
            vertical,
            this.targetPoint.z,
          );
          const cone = Math.atan2(
            Math.hypot(this.targetPoint.x, vertical),
            -this.targetPoint.z,
          );
          if (
            cone > config.cone * RAD ||
            reach > technique.reach + box.radius ||
            Math.abs(vertical) > technique.maxVertical
          )
            continue;
          sampleLocalStrike(this.local, technique, time, context);
          strikeAlignmentPivot(this.pivot, technique);
          this.fromDirection.copy(this.local).sub(this.pivot);
          this.toDirection.copy(this.targetPoint).sub(this.pivot);
          const angle = this.fromDirection.angleTo(this.toDirection);
          const score = trajectoryDistance + cone * 0.005 + time * 0.0001;
          if (score >= best || !Number.isFinite(angle) || angle < 1e-6)
            continue;
          this.fromDirection.normalize();
          this.toDirection.normalize();
          this.rotation.setFromUnitVectors(
            this.fromDirection,
            this.toDirection,
          );
          this.axis
            .set(this.rotation.x, this.rotation.y, this.rotation.z)
            .normalize();
          const correction = Math.min(
            config.maxAngle * RAD,
            angle * Math.min(1, config.strength),
          );
          best = score;
          selected = {
            targetId: body.id,
            targetHeight: box.height,
            ...(box.x || box.z
              ? { targetOffsetX: box.x ?? 0, targetOffsetZ: box.z ?? 0 }
              : {}),
            axis: this.axis.toArray(),
            angle: correction,
            requestedAngle: angle,
            score,
            time,
            side: technique.side,
            strength: config.strength,
          };
        }
      }
    }
    return selected;
  }
  alignmentProfile(context, technique, selected) {
    const candidate = this.targets.find(
      (e) => (e.body ?? e).id === selected.targetId,
    );
    const body = candidate?.body ?? candidate;
    if (!body) return null;
    const previous = body.previousPosition;
    if (previous && [previous.x, previous.y, previous.z].every(Number.isFinite))
      this.targetOrigin.lerpVectors(
        previous,
        body.position,
        this.targetFraction,
      );
    else this.targetOrigin.copy(body.position);
    const reactionOwned = candidate.reaction?.ownsMotion;
    const reactionFlight =
      reactionOwned &&
      (candidate.reaction.phase === "flight" ||
        Math.abs(candidate.reaction.velocity.y) > 1e-4);
    const velocity = reactionOwned
      ? candidate.reaction.velocity
      : (candidate.controller?.velocity ?? body.velocity ?? ZERO);
    const impulse = reactionOwned ? ZERO : (body.impulse ?? ZERO);
    const profile = [];
    strikeAlignmentPivot(this.pivot, technique);
    for (let i = 0; i < SAMPLES; i++) {
      const time =
        technique.windup +
        ((technique.extension + technique.impact) * i) / (SAMPLES - 1);
      this.predictPose(time);
      this.targetPoint.copy(this.targetOrigin).addScaledVector(velocity, time);
      const impulseTime = (1 - Math.exp(-8 * time)) / 8;
      this.targetPoint.x +=
        (selected.targetOffsetX ?? 0) + impulse.x * impulseTime;
      this.targetPoint.z +=
        (selected.targetOffsetZ ?? 0) + impulse.z * impulseTime;
      this.targetPoint.y +=
        selected.targetHeight - (reactionFlight ? 9 * time * time : 0);
      this.targetPoint.sub(this.root);
      this.targetPoint.y -= BODY_PIVOT + this.lift;
      this.targetPoint.applyQuaternion(
        this.inverse.copy(this.predictedOrientation).invert(),
      );
      this.targetPoint.y += BODY_PIVOT;
      sampleLocalStrike(this.local, technique, time, context);
      this.fromDirection.copy(this.local).sub(this.pivot).normalize();
      this.toDirection.copy(this.targetPoint).sub(this.pivot).normalize();
      const angle = this.fromDirection.angleTo(this.toDirection);
      this.rotation.setFromUnitVectors(this.fromDirection, this.toDirection);
      this.axis.set(this.rotation.x, this.rotation.y, this.rotation.z);
      if (this.axis.lengthSq() > 1e-12 && Number.isFinite(angle))
        this.rotation.setFromAxisAngle(
          this.axis.normalize(),
          Math.min(this.config.maxAngle * RAD, angle),
        );
      else this.rotation.identity();
      profile.push(this.rotation.toArray());
    }
    return profile;
  }
}
