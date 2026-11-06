import { Vector3 } from "three";
import { dampAngle, dampFactor } from "../core/math.js";
import { DashState } from "./DashState.js";
import { JumpState } from "./JumpState.js";
import { resolveMovementConfig } from "./MovementConfig.js";

export const TARGET_FACING_CONFIG = Object.freeze({
  turnRate: 6,
  response: 13,
});

/** Input -> desired velocity -> world adapter -> actor transform.
 * This layer never writes to individual rig joints.
 */
export class CharacterController {
  constructor(root, world, options = {}) {
    const {
      radius = 0.36,
      facingTurnRate = TARGET_FACING_CONFIG.turnRate,
      facingResponse = TARGET_FACING_CONFIG.response,
    } = options;
    this.config = resolveMovementConfig(options);
    this.root = root;
    this.world = world;
    this.walkingSpeed = this.config.locomotion.walkSpeed;
    this.runSpeed = this.config.locomotion.runSpeed;
    this.walkSpeed = this.runSpeed; // Backward-compatible full-stick speed.
    this.sprintSpeed = this.config.locomotion.sprintSpeed;
    this.radius = radius;
    this.velocity = new Vector3();
    this.speed = 0;
    this.heading = 0;
    this.facingTarget = null;
    this.facingTurnRate = facingTurnRate;
    this.facingResponse = facingResponse;
    this.desired = new Vector3();
    this.displacement = new Vector3();
    this.previous = new Vector3();
    this.next = new Vector3();
    this.dashDirection = new Vector3();
    this.groundDash = new DashState(this.config.groundDash);
    this.groundDash.mode = "ground";
    this.airDash = new DashState(this.config.aerialDash);
    this.airDash.mode = "air";
    this.dash = this.groundDash;
    this.dashSequence = 0;
    this.jump = new JumpState(this.config.jump);
    this.airDashesUsed = 0;
    this.movementState = "locomotion";
    this.dashRequested = false;
    this.requestedDashMode = null;
    this.jumpRequested = false;
  }

  requestDash() {
    if (!this.canDash) return false;
    this.dashRequested = true;
    this.requestedDashMode = this.jump.airborne ? "air" : "ground";
    return true;
  }

  get airDashesRemaining() {
    return Math.max(0, this.config.maxAerialDashes - this.airDashesUsed);
  }

  get canDash() {
    if (this.dashRequested || this.dash.active || this.jumpRequested)
      return false;
    return this.jump.airborne
      ? this.airDashesRemaining > 0 && this.airDash.ready
      : this.jump.ready && this.groundDash.ready;
  }

  tickDashCooldowns(dt) {
    this.groundDash.tickCooldown(dt);
    this.airDash.tickCooldown(dt);
  }

  requestJump() {
    if (
      this.jumpRequested ||
      !this.jump.ready ||
      this.dash.active ||
      this.dashRequested
    )
      return false;
    this.jumpRequested = true;
    return true;
  }

  update(dt, input, cameraYaw, facingTarget = null) {
    if (!Number.isFinite(dt) || dt <= 0) return;
    if (this.jumpRequested) {
      this.jumpRequested = false;
      if (!this.dash.active) this.jump.start();
    }
    this.facingTarget =
      this.jump.ready &&
      !(this.dash.active && this.dash.mode === "air") &&
      Number.isFinite(facingTarget?.x) &&
      Number.isFinite(facingTarget?.z)
        ? facingTarget
        : null;
    const x = input.move.x;
    const y = input.move.y;
    const speed = input.sprinting ? this.sprintSpeed : this.walkSpeed;
    const sin = Math.sin(cameraYaw),
      cos = Math.cos(cameraYaw);
    // Forward points away from the camera; right is screen-right on the floor.
    this.desired.set(
      (x * cos - y * sin) * speed,
      0,
      (-x * sin - y * cos) * speed,
    );
    const magnitude = Math.min(1, Math.hypot(x, y));
    let maximum = speed * magnitude;
    if (!input.sprinting && this.walkingSpeed * 2 !== this.runSpeed) {
      maximum =
        magnitude <= 0.5
          ? this.walkingSpeed * magnitude * 2
          : this.walkingSpeed +
            (this.runSpeed - this.walkingSpeed) * (magnitude - 0.5) * 2;
      if (this.desired.lengthSq() > 0) this.desired.setLength(maximum);
    }
    if (this.desired.length() > maximum) this.desired.setLength(maximum);
    this.dashDirection.copy(this.desired);
    if (this.dashRequested) {
      this.dashRequested = false;
      const airborne = this.requestedDashMode === "air";
      this.requestedDashMode = null;
      this.dash = airborne ? this.airDash : this.groundDash;
      if (airborne && this.velocity.lengthSq() > 0.04)
        this.dashDirection.copy(this.velocity);
      if (this.dashDirection.lengthSq() < 0.0001)
        this.dashDirection.set(
          -Math.sin(this.heading),
          0,
          -Math.cos(this.heading),
        );
      this.dashDirection.normalize();
      if (
        this.dash.start(
          this.dashDirection,
          Math.max(0, this.velocity.dot(this.dashDirection)),
          airborne
            ? Math.max(
                maximum,
                this.velocity.length(),
                this.config.aerialDash.exitSpeed,
              )
            : maximum,
        )
      ) {
        this.dash.sequence = ++this.dashSequence;
        if (airborne) this.airDashesUsed++;
        this.movementState = airborne ? "aerial-dash" : "dash";
      }
      // Releasing the stick during a dash retains its current trajectory.
      this.dashDirection.copy(this.desired);
    }
    if (!this.jump.ready) {
      this.updateJump(dt, maximum);
      this.tickDashCooldowns(dt);
      return;
    }
    let remaining = dt;
    while (this.dash.active && remaining > 1e-10) {
      const step = Math.min(
        remaining,
        this.dash.config.maxSubstep,
        this.dash.config.duration - this.dash.elapsed,
      );
      const distance = this.dash.advance(step, this.dashDirection);
      this.displacement.copy(this.dash.direction).multiplyScalar(distance);
      this.velocity.copy(this.dash.direction).multiplyScalar(this.dash.speed);
      const travelled = this.move(step);
      this.dash.distanceTravelled += travelled;
      remaining -= step;
      const blocked = distance > 1e-9 && travelled < 1e-9;
      if (blocked || this.dash.elapsed >= this.dash.config.duration - 1e-10) {
        this.dash.finish(blocked ? "blocked" : "completed");
        this.movementState = "locomotion";
        // Preserve the resolved endpoint momentum. Ordinary acceleration and
        // deceleration blend from it on the next locomotion step.
        this.speed = this.velocity.length();
      }
    }
    if (remaining > 1e-10) this.updateLocomotion(remaining, maximum);
    this.tickDashCooldowns(dt);
  }

  updateJump(dt, maximum) {
    let remaining = dt;
    while (remaining > 1e-10) {
      const step = Math.min(
        remaining,
        Math.max(1e-8, this.jump.timeToBoundary),
        this.dash.active ? this.dash.config.maxSubstep : Infinity,
        this.dash.active
          ? Math.max(1e-8, this.dash.config.duration - this.dash.elapsed)
          : Infinity,
      );
      if (this.dash.active) {
        const distance = this.dash.advance(step, this.dashDirection);
        this.displacement.copy(this.dash.direction).multiplyScalar(distance);
        this.velocity.copy(this.dash.direction).multiplyScalar(this.dash.speed);
        const travelled = this.move(step);
        this.dash.distanceTravelled += travelled;
        if (
          (distance > 1e-9 && travelled < 1e-9) ||
          this.dash.elapsed >= this.dash.config.duration - 1e-10
        )
          this.dash.finish(
            distance > 1e-9 && travelled < 1e-9 ? "blocked" : "completed",
          );
      } else if (this.jump.airborne || this.jump.phase === "takeoff")
        this.updateAir(step, maximum);
      else this.updateLocomotion(step, maximum);
      const wasAirborne = this.jump.airborne;
      this.jump.advance(step);
      if (wasAirborne && !this.jump.airborne) this.airDashesUsed = 0;
      this.root.position.y = this.jump.height;
      remaining -= step;
    }
    this.movementState = this.dash.active
      ? this.jump.airborne
        ? "aerial-dash"
        : "dash"
      : this.jump.ready
        ? "locomotion"
        : "jump";
  }

  updateAir(dt, maximum) {
    const response =
      maximum > 0.01 ? this.jump.config.airControl : this.jump.config.airDrag;
    const blend = dampFactor(response, dt);
    // Integrate the exponential horizontal response analytically. A centred
    // stick retains takeoff momentum instead of applying ground braking.
    const contribution = response > 0 ? blend / response : dt;
    this.displacement
      .copy(this.velocity)
      .sub(this.desired)
      .multiplyScalar(contribution)
      .addScaledVector(this.desired, dt);
    this.velocity.lerp(this.desired, blend);
    this.move(dt);
  }

  updateLocomotion(dt, maximum) {
    this.velocity.lerp(this.desired, dampFactor(maximum > 0.01 ? 11 : 15, dt));
    if (this.velocity.lengthSq() < 0.0001 && maximum < 0.01)
      this.velocity.set(0, 0, 0);
    this.displacement.copy(this.velocity).multiplyScalar(dt);
    this.move(dt);
  }

  move(dt) {
    this.previous.copy(this.root.position);
    this.world.move(this.previous, this.displacement, this.radius, this.next);
    // The flat world adapter resolves XZ collisions; JumpState owns elevation.
    this.next.y = this.previous.y;
    this.root.position.copy(this.next);
    const contactResolved =
      this.world.resolveVelocity?.(this.velocity) === true;
    const actualX = this.next.x - this.previous.x;
    const actualZ = this.next.z - this.previous.z;
    // Circular contacts resolve along their normal, retaining tangent momentum.
    // The original per-axis cancellation remains exact for the flat arena.
    if (!contactResolved) {
      if (Math.abs(actualX - this.displacement.x) > 0.000001) {
        this.velocity.x = 0;
      }
      if (Math.abs(actualZ - this.displacement.z) > 0.000001) {
        this.velocity.z = 0;
      }
    }
    const distance = this.next.distanceTo(this.previous);
    this.speed = distance / dt;
    if (this.facingTarget) {
      // Facing is independent of travel: never steer or pull the root toward
      // a nearby target. Resolve yaw from the collision-corrected position.
      const dx = this.facingTarget.x - this.next.x;
      const dz = this.facingTarget.z - this.next.z;
      if (dx * dx + dz * dz > 1e-10) {
        const desired = Math.atan2(-dx, -dz);
        const damped = dampAngle(
          this.heading,
          desired,
          this.facingResponse,
          dt,
        );
        const maximum = Math.max(0, this.facingTurnRate) * dt;
        this.heading += Math.max(
          -maximum,
          Math.min(maximum, damped - this.heading),
        );
        this.root.rotation.y = this.heading;
      }
    } else if (this.speed > 0.03) {
      this.heading = dampAngle(
        this.heading,
        Math.atan2(-actualX, -actualZ),
        13,
        dt,
      );
      this.root.rotation.y = this.heading;
    }
    return distance;
  }

  stop() {
    this.velocity.set(0, 0, 0);
    this.speed = 0;
    this.dashRequested = false;
    this.requestedDashMode = null;
    this.jumpRequested = false;
    if (this.dash.active) this.dash.finish("cancelled");
    this.movementState = this.jump.ready ? "locomotion" : "jump";
  }
}
