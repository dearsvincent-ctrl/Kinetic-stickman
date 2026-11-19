import { Vector3 } from "three";
import { clamp, dampAngle, dampFactor } from "../core/math.js";
import { sanitizeCameraSettings } from "../sandbox/CameraSettings.js";
import { DynamicCameraDirector } from "./DynamicCameraDirector.js";
import { CameraImpact } from "./CameraImpact.js";

const wrapAngle = (angle) => Math.atan2(Math.sin(angle), Math.cos(angle));
const finiteVector = (v) =>
  v && Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);

export class FollowCamera {
  constructor(camera, position, settings) {
    this.camera = camera;
    this.settings = sanitizeCameraSettings(settings);
    this.director = new DynamicCameraDirector(this.settings);
    this.impact = new CameraImpact();
    this.impactOffset = new Vector3();
    this.impactBasePosition = new Vector3();
    this.distance = 4.8;
    this.maxLag = Infinity;
    this.lag = new Vector3();
    this.targetYaw = 0;
    this.yaw = 0;
    this.targetPitch = 0.23;
    this.pitch = 0.23;
    this.minPitch = 0.06;
    this.maxPitch = 1.05;
    this.target = position.clone().add(new Vector3(0, 1.02, 0));
    this.desiredTarget = new Vector3();
    this.offset = new Vector3();
    this.collisionTarget = new Vector3();
    this.previousPosition = position.clone();
    this.previousSpeed = 0;
    this.boomDistance = this.distance;
    this.obstructionHold = 0;
    this.manualActive = false;
    this.renderYaw = this.yaw;
    this.renderPitch = this.pitch;
    this.configure(this.settings);
    this.update(1, position, { x: 0, y: 0 });
  }

  configure(settings = {}) {
    const next = sanitizeCameraSettings({ ...this.settings, ...settings });
    const baseChanged = next.baseFov !== this.settings.baseFov;
    if (
      next.mode !== this.settings.mode ||
      (next.strength === 0 && this.settings.strength !== 0)
    )
      this.takeManualView();
    this.settings = next;
    this.director.configure(this.settings);
    this.setFov(
      baseChanged || !next.dynamicFov ? next.baseFov : this.director.state.fov,
    );
    return this.settings;
  }

  setFov(fov) {
    if (!Number.isFinite(fov) || Math.abs(this.camera.fov - fov) < 1e-6)
      return;
    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
  }

  // Autonomous offsets belong to the rendered view, never the manual anchor.
  // Taking ownership starts from that exact visible view, including mid-blend.
  takeManualView() {
    if (
      Math.abs(wrapAngle(this.renderYaw - this.yaw)) < 1e-10 &&
      Math.abs(this.renderPitch - this.pitch) < 1e-10
    )
      return;
    this.yaw = this.targetYaw = wrapAngle(this.renderYaw);
    this.pitch = this.targetPitch = clamp(
      this.renderPitch,
      this.minPitch,
      this.maxPitch,
    );
  }

  recenter(position) {
    this.impact.reset();
    this.impactOffset.set(0, 0, 0);
    // Preserve the visible orbit when resetting an autonomous target or speed.
    const yawOffset = wrapAngle(this.renderYaw - this.yaw);
    const pitchOffset = this.renderPitch - this.pitch;
    this.yaw = wrapAngle(this.yaw + yawOffset);
    this.targetYaw = wrapAngle(this.targetYaw + yawOffset);
    this.pitch = clamp(this.pitch + pitchOffset, this.minPitch, this.maxPitch);
    this.targetPitch = clamp(
      this.targetPitch + pitchOffset,
      this.minPitch,
      this.maxPitch,
    );
    this.target.copy(position);
    this.target.y += 1.02;
    this.desiredTarget.copy(this.target);
    this.lag.set(0, 0, 0);
    this.previousPosition.copy(position);
    this.previousSpeed = 0;
    this.boomDistance = this.distance;
    this.obstructionHold = 0;
    this.director.resetMotion();
    this.setFov(this.settings.baseFov);
  }

  update(dt, position, look = { x: 0, y: 0 }, context = null) {
    dt = Number.isFinite(dt) ? Math.max(0, dt) : 0;
    const lookX = Number.isFinite(look?.x) ? look.x : 0;
    const lookY = Number.isFinite(look?.y) ? look.y : 0;
    const hasDelta = lookX !== 0 || lookY !== 0;
    const manualActive = Boolean(context?.manualActive) || hasDelta;
    const velocity = context?.velocity;
    const speed = finiteVector(velocity)
      ? Math.hypot(velocity.x, velocity.y, velocity.z)
      : 0;
    // Legacy callers retain the original lag. Context lets the live game tell a
    // respawn/teleport apart from even extremely fast continuous movement.
    if (
      context &&
      this.previousPosition.distanceTo(position) >
        Math.max(12, Math.max(speed, this.previousSpeed) * dt * 3 + 3)
    )
      this.recenter(position);
    if ((manualActive && !this.manualActive) || hasDelta) {
      if (!this.manualActive) this.takeManualView();
      this.director.suspend();
    }
    this.manualActive = manualActive;
    this.targetYaw -= lookX * 0.0045;
    this.targetPitch = clamp(
      this.targetPitch + lookY * 0.0035,
      this.minPitch,
      this.maxPitch,
    );
    this.yaw = dampAngle(this.yaw, this.targetYaw, 20, dt);
    // Keep angles bounded over long sessions while retaining the shortest path.
    this.yaw = wrapAngle(this.yaw);
    this.targetYaw = wrapAngle(this.targetYaw);
    this.pitch += (this.targetPitch - this.pitch) * dampFactor(20, dt);
    const view = this.director.update(
      dt,
      position,
      this.yaw,
      this.pitch,
      context,
      manualActive,
    );
    this.renderYaw = wrapAngle(this.yaw + view.yawOffset);
    this.renderPitch = clamp(
      this.pitch + view.pitchOffset,
      this.minPitch,
      this.maxPitch,
    );
    this.setFov(view.fov);
    this.desiredTarget.copy(position);
    this.desiredTarget.y += 1.02;
    this.desiredTarget.y += view.focusOffset;
    this.target.lerp(this.desiredTarget, dampFactor(16, dt));
    this.lag.subVectors(this.target, this.desiredTarget);
    const lag = this.lag.length();
    if (lag > this.maxLag)
      this.target
        .copy(this.desiredTarget)
        .addScaledVector(this.lag, this.maxLag / lag);
    if (this.world && !this.world.isSpaceFree(this.target, 0.2, 0.2)) {
      // Project lag to a clear focus rather than resetting it at every corner.
      this.world.clipCamera(
        this.desiredTarget,
        this.target,
        this.collisionTarget,
      );
      this.target.copy(this.collisionTarget);
    }
    const horizontal = Math.cos(this.renderPitch) * this.distance;
    this.offset.set(
      Math.sin(this.renderYaw) * horizontal,
      Math.sin(this.renderPitch) * this.distance,
      Math.cos(this.renderYaw) * horizontal,
    );
    this.camera.position.copy(this.target).add(this.offset);
    this.camera.position.y = Math.max(0.3, this.camera.position.y);
    let margin = 0.2;
    if (this.world) {
      // A wide lens exposes more of its near plane at corners. Keep the old
      // 20 cm clearance at the default lens and cap the conservative envelope.
      const near = Number.isFinite(this.camera.near) ? this.camera.near : 0.1;
      const aspect = Number.isFinite(this.camera.aspect) ? this.camera.aspect : 1;
      const plane = Math.tan((this.camera.fov * Math.PI) / 360);
      margin = Math.min(
        0.5,
        Math.max(0.2, near * Math.sqrt(1 + plane * plane * (1 + aspect * aspect))),
      );
      this.offset.subVectors(this.camera.position, this.target);
      const fullDistance = this.offset.length();
      this.world.clipCamera(
        this.target,
        this.camera.position,
        this.collisionTarget,
        margin,
      );
      const available = Math.min(
        fullDistance,
        this.collisionTarget.distanceTo(this.target),
      );
      const obstructed = available < fullDistance - 1e-4;
      if (available < this.boomDistance - 1e-6) {
        this.boomDistance = available;
      } else {
        if (!obstructed)
          this.obstructionHold = Math.max(0, this.obstructionHold - dt);
        if (obstructed || this.obstructionHold === 0)
          this.boomDistance +=
            (available - this.boomDistance) * dampFactor(10, dt);
      }
      if (obstructed) this.obstructionHold = 0.08;
      if (fullDistance > 1e-8)
        this.camera.position
          .copy(this.target)
          .addScaledVector(this.offset, this.boomDistance / fullDistance);
      else this.camera.position.copy(this.collisionTarget);
    } else this.boomDistance = this.distance;
    // Clipping can shorten a boom toward an unusually low focus point.
    this.camera.position.y = Math.max(0.3, this.camera.position.y);
    this.camera.lookAt(this.target);
    this.impactBasePosition.copy(this.camera.position);
    this.impactOffset.copy(this.impact.update(dt));
    if (this.impactOffset.lengthSq() > 0) {
      // Translation uses the normal rendered camera basis. Its rotation and
      // manual/assisted orbit remain untouched, including during manual input.
      this.impactOffset.applyQuaternion(this.camera.quaternion);
      this.camera.position.add(this.impactOffset);
      this.camera.position.y = Math.max(0.3, this.camera.position.y);
      if (this.world) {
        // Sweep only this tiny displacement from the already safe base view.
        // This cannot alter boom recovery or enlarge the impact at a corner.
        this.world.clipCamera(
          this.impactBasePosition,
          this.camera.position,
          this.collisionTarget,
          margin,
        );
        this.camera.position.copy(this.collisionTarget);
      }
      this.camera.position.y = Math.max(0.3, this.camera.position.y);
      this.impactOffset.subVectors(this.camera.position, this.impactBasePosition);
    }
    this.previousPosition.copy(position);
    this.previousSpeed = speed;
  }

  reset(heading = 0) {
    this.impact.reset();
    this.impactOffset.set(0, 0, 0);
    this.takeManualView();
    this.targetYaw = heading;
    this.targetPitch = 0.23;
    this.director.suspend();
  }

  triggerImpact(strength, duration) {
    return this.impact.trigger(strength, duration);
  }
}
