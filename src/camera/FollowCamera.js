import { Vector3 } from "three";
import { clamp, dampAngle, dampFactor } from "../core/math.js";

export class FollowCamera {
  constructor(camera, position) {
    this.camera = camera;
    this.distance = 4.8;
    this.targetYaw = 0;
    this.yaw = 0;
    this.targetPitch = 0.23;
    this.pitch = 0.23;
    this.minPitch = 0.06;
    this.maxPitch = 1.05;
    this.target = position.clone().add(new Vector3(0, 1.02, 0));
    this.desiredTarget = new Vector3();
    this.offset = new Vector3();
    this.update(1, position, { x: 0, y: 0 });
  }

  update(dt, position, look) {
    this.targetYaw -= look.x * 0.0045;
    this.targetPitch = clamp(
      this.targetPitch + look.y * 0.0035,
      this.minPitch,
      this.maxPitch,
    );
    this.yaw = dampAngle(this.yaw, this.targetYaw, 20, dt);
    // Keep angles bounded over long sessions while retaining the shortest path.
    this.yaw = Math.atan2(Math.sin(this.yaw), Math.cos(this.yaw));
    this.targetYaw = Math.atan2(
      Math.sin(this.targetYaw),
      Math.cos(this.targetYaw),
    );
    this.pitch += (this.targetPitch - this.pitch) * dampFactor(20, dt);
    this.desiredTarget.copy(position);
    this.desiredTarget.y += 1.02;
    this.target.lerp(this.desiredTarget, dampFactor(16, dt));
    const horizontal = Math.cos(this.pitch) * this.distance;
    this.offset.set(
      Math.sin(this.yaw) * horizontal,
      Math.sin(this.pitch) * this.distance,
      Math.cos(this.yaw) * horizontal,
    );
    this.camera.position.copy(this.target).add(this.offset);
    this.camera.position.y = Math.max(0.3, this.camera.position.y);
    this.camera.lookAt(this.target);
  }

  reset(heading = 0) {
    this.targetYaw = heading;
    this.targetPitch = 0.23;
  }
}
