import { Vector3 } from "three";
import { dampAngle, dampFactor } from "../core/math.js";
import { DashState } from "./DashState.js";

/** Input -> desired velocity -> world adapter -> actor transform.
 * This layer never writes to individual rig joints.
 */
export class CharacterController {
  constructor(
    root,
    world,
    { walkSpeed = 2.6, sprintSpeed = 5.2, radius = 0.36, dashConfig } = {},
  ) {
    this.root = root;
    this.world = world;
    this.walkSpeed = walkSpeed;
    this.sprintSpeed = sprintSpeed;
    this.radius = radius;
    this.velocity = new Vector3();
    this.speed = 0;
    this.heading = 0;
    this.desired = new Vector3();
    this.displacement = new Vector3();
    this.previous = new Vector3();
    this.next = new Vector3();
    this.dashDirection = new Vector3();
    this.dash = new DashState(dashConfig);
    this.movementState = "locomotion";
    this.dashRequested = false;
  }

  requestDash() {
    if (this.dashRequested || !this.dash.ready) return false;
    this.dashRequested = true;
    return true;
  }

  update(dt, input, cameraYaw) {
    if (!Number.isFinite(dt) || dt <= 0) return;
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
    const maximum = speed * Math.min(1, Math.hypot(x, y));
    if (this.desired.length() > maximum) this.desired.setLength(maximum);
    this.dashDirection.copy(this.desired);
    if (this.dashRequested) {
      this.dashRequested = false;
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
          maximum,
        )
      ) {
        this.movementState = "dash";
      }
      // Releasing the stick during a dash retains its current trajectory.
      this.dashDirection.copy(this.desired);
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
    this.dash.tickCooldown(dt);
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
    this.root.position.copy(this.next);
    // Cancel only the blocked component: sliding along a wall stays responsive.
    const actualX = this.next.x - this.previous.x;
    const actualZ = this.next.z - this.previous.z;
    if (Math.abs(actualX - this.displacement.x) > 0.000001) {
      this.velocity.x = 0;
    }
    if (Math.abs(actualZ - this.displacement.z) > 0.000001) {
      this.velocity.z = 0;
    }
    const distance = this.next.distanceTo(this.previous);
    this.speed = distance / dt;
    if (this.speed > 0.03) {
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
    if (this.dash.active) this.dash.finish("cancelled");
    this.movementState = "locomotion";
  }
}
