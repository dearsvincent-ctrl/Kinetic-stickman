import { Vector3 } from "three";
import { dampAngle, dampFactor } from "../core/math.js";

/** Input -> desired velocity -> world adapter -> actor transform.
 * This layer never writes to individual rig joints.
 */
export class CharacterController {
  constructor(
    root,
    world,
    { walkSpeed = 2.6, sprintSpeed = 5.2, radius = 0.36 } = {},
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
  }

  update(dt, input, cameraYaw) {
    if (dt <= 0) return;
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
    this.velocity.lerp(this.desired, dampFactor(maximum > 0.01 ? 11 : 15, dt));
    if (this.velocity.lengthSq() < 0.0001 && maximum < 0.01)
      this.velocity.set(0, 0, 0);
    this.previous.copy(this.root.position);
    this.displacement.copy(this.velocity).multiplyScalar(dt);
    this.world.move(this.previous, this.displacement, this.radius, this.next);
    this.root.position.copy(this.next);
    // Cancel only the blocked component: sliding along a wall stays responsive.
    const actualX = this.next.x - this.previous.x;
    const actualZ = this.next.z - this.previous.z;
    if (Math.abs(actualX - this.displacement.x) > 0.000001) this.velocity.x = 0;
    if (Math.abs(actualZ - this.displacement.z) > 0.000001) this.velocity.z = 0;
    this.speed = this.next.distanceTo(this.previous) / dt;
    if (this.speed > 0.03) {
      this.heading = dampAngle(
        this.heading,
        Math.atan2(-actualX, -actualZ),
        13,
        dt,
      );
      this.root.rotation.y = this.heading;
    }
  }

  stop() {
    this.velocity.set(0, 0, 0);
    this.speed = 0;
  }
}
