import * as THREE from "three";
import { createArena } from "../world/createArena.js";
import { ArenaBounds } from "../world/ArenaBounds.js";
import { Stickman } from "../character/Stickman.js";
import { CharacterAnimator } from "../character/CharacterAnimator.js";
import { CharacterController } from "../movement/CharacterController.js";
import { FollowCamera } from "../camera/FollowCamera.js";
import { InputController } from "../input/InputController.js";
import { Hud } from "../ui/Hud.js";
import { CombatController } from "../combat/CombatController.js";
import { ProximityCombatController } from "../combat/ProximityCombatController.js";
import {
  createCombatContext,
  updateCombatContext,
} from "../combat/CombatContext.js";
import { TrainingDummy } from "../world/TrainingDummy.js";
import { ControlLayoutEditor } from "../ui/ControlLayoutEditor.js";

const STEP = 1 / 60;

export class Game {
  constructor(container) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: "high-performance",
      alpha: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    container.appendChild(this.renderer.domElement);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(52, 1, 0.1, 150);
    this.arena = createArena(this.scene);
    this.dummy = new TrainingDummy();
    this.scene.add(this.dummy.root);
    this.character = new Stickman();
    this.scene.add(this.character.root);
    this.controller = new CharacterController(
      this.character.root,
      new ArenaBounds(this.arena.halfSize, [this.dummy.target]),
    );
    this.combat = new CombatController();
    this.proximity = new ProximityCombatController(this.combat, {
      targets: [this.dummy.target],
    });
    // Reuse live movement context; accepted attacks take their own snapshot.
    this.combatContext = createCombatContext();
    this.animator = new CharacterAnimator(this.character);
    this.followCamera = new FollowCamera(
      this.camera,
      this.character.root.position,
    );
    this.helpOpen = false;
    this.controlsOpen = false;
    this.contextLost = false;
    this.input = new InputController({
      joystick: document.querySelector("#joystick"),
      joystickKnob: document.querySelector("#joystick-knob"),
      sprintButton: document.querySelector("#sprint-button"),
      blockButton: document.querySelector("#block-button"),
      dashButton: document.querySelector("#dash-button"),
      jumpButton: document.querySelector("#jump-button"),
      cameraSurface: document.querySelector("#camera-surface"),
      resetButton: document.querySelector("#reset-camera"),
      onReset: () => this.followCamera.reset(this.controller.heading),
    });
    this.controlLayoutEditor = new ControlLayoutEditor({
      onActiveChange: (active) => {
        this.controlsOpen = active;
        this.input.setEnabled(!active && !this.helpOpen);
        this.clearMotion();
      },
    });
    this.hud = new Hud({
      onHelpChange: (open) => {
        this.helpOpen = open;
        this.input.setEnabled(!open && !this.controlsOpen);
        this.clearMotion();
      },
    });
    this.accumulator = 0;
    this.lastTime = null;
    this.resize = this.resize.bind(this);
    this.frame = this.frame.bind(this);
    window.addEventListener("resize", this.resize);
    window.visualViewport?.addEventListener("resize", this.resize);
    window.addEventListener("blur", () => this.clearMotion());
    document.addEventListener("visibilitychange", () => this.clearMotion());
    this.renderer.domElement.addEventListener("webglcontextlost", (event) => {
      event.preventDefault();
      this.contextLost = true;
      this.clearMotion();
      this.showError(
        "The graphics context was interrupted. Reload to return to the arena.",
      );
    });
    this.resize();
    this.animator.update(STEP, { speed: 0 });
    this.renderer.render(this.scene, this.camera);
    const loading = document.querySelector("#loading");
    loading.classList.add("finished");
    setTimeout(() => loading.remove(), 400);
    this.raf = requestAnimationFrame(this.frame);

    // Read-only development telemetry used by browser smoke checks, opt-in only.
    if (
      import.meta.env.DEV &&
      new URLSearchParams(location.search).has("debug")
    ) {
      window.__KINETIC__ = { snapshot: () => this.snapshot() };
    }
  }

  resize() {
    const { width, height } = this.container.getBoundingClientRect();
    this.renderer.setSize(width, height);
    this.camera.aspect = width / Math.max(height, 1);
    this.camera.updateProjectionMatrix();
  }

  clearMotion() {
    this.input.reset();
    this.controller.stop();
    this.combat.reset();
    this.proximity.reset();
    this.accumulator = 0;
    this.lastTime = null;
  }

  frame(time) {
    this.raf = requestAnimationFrame(this.frame);
    const elapsed =
      this.lastTime === null
        ? STEP
        : Math.max(0, (time - this.lastTime) / 1000);
    this.lastTime = time;
    // Bound catch-up work after a stall. A 60 Hz simulation is ready for a
    // future fixed-step physics world; rendering/camera use their own delta.
    const dt = Math.min(elapsed, 0.08);
    const paused =
      this.helpOpen || this.controlsOpen || document.hidden || this.contextLost;
    if (!paused) {
      this.accumulator = Math.min(this.accumulator + dt, STEP * 5);
      while (this.accumulator >= STEP) {
        for (
          let action = this.input.consumeMovementRequest();
          action;
          action = this.input.consumeMovementRequest()
        ) {
          if (action === "jump") this.controller.requestJump();
          else if (action === "dash") this.controller.requestDash();
        }
        this.controller.update(
          STEP,
          this.input,
          this.followCamera.yaw,
          this.controller.jump.ready ? this.proximity.target?.position : null,
        );
        const jump = this.controller.jump;
        const context = updateCombatContext(
          this.combatContext,
          this.controller,
        );
        this.combat.setBlocking(this.input.blocking);
        if (this.input.consumeAttackRequest()) {
          // Kept for future dedicated techniques; basic mobile punches are automatic.
          if (jump.ready) this.combat.requestAttack(context);
        }
        this.proximity.update(STEP, {
          position: this.character.root.position,
          blocking: this.input.blocking,
          facing: this.controller.heading,
          context,
          grounded: jump.ready,
        });
        this.animator.update(STEP, {
          speed: this.controller.speed,
          maxSpeed: this.input.sprinting
            ? this.controller.sprintSpeed
            : this.controller.walkSpeed,
          sprinting: this.input.sprinting,
          blocking: this.input.blocking,
          combat: this.combat,
          dash: this.controller.dash,
          jump: this.controller.jump,
        });
        this.accumulator -= STEP;
      }
      this.followCamera.update(
        dt,
        this.character.root.position,
        this.input.consumeLookDelta(),
      );
    }
    this.dummy.setTargeted(Boolean(this.proximity.target));
    if (!this.contextLost) this.renderer.render(this.scene, this.camera);
    this.hud.update(
      Math.max(0.001, elapsed),
      this.controller.speed,
      this.controller.sprintSpeed,
      this.input.sprinting,
      this.combat,
      this.controller.dash,
      this.proximity,
      this.controller.jump,
      this.controller,
    );
  }

  snapshot() {
    return {
      position: this.character.root.position.toArray(),
      heading: this.controller.heading,
      velocity: this.controller.velocity.toArray(),
      speed: this.controller.speed,
      movementState: this.controller.movementState,
      jump: {
        phase: this.controller.jump.phase,
        grounded: this.controller.jump.grounded,
        airborne: this.controller.jump.airborne,
        height: this.controller.jump.height,
        verticalVelocity: this.controller.jump.verticalVelocity,
        elapsed: this.controller.jump.elapsed,
        phaseProgress: this.controller.jump.phaseProgress,
        sequence: this.controller.jump.sequence,
        ready: this.controller.jump.ready,
        canJump: this.controller.canJump,
        config: { ...this.controller.jump.config },
      },
      dash: {
        active: this.controller.dash.active,
        ready: this.controller.canDash,
        mode: this.controller.dash.mode,
        airDashesUsed: this.controller.airDashesUsed,
        airDashesRemaining: this.controller.airDashesRemaining,
        maxAerialDashes: this.controller.config.maxAerialDashes,
        groundCooldownRemaining: this.controller.groundDash.cooldownRemaining,
        elapsed: this.controller.dash.elapsed,
        progress: this.controller.dash.progress,
        cooldownRemaining: this.controller.dash.cooldownRemaining,
        direction: this.controller.dash.direction.toArray(),
        distanceTravelled: this.controller.dash.distanceTravelled,
        sequence: this.controller.dash.sequence,
        exitReason: this.controller.dash.exitReason,
      },
      input: {
        move: { ...this.input.move },
        sprinting: this.input.sprinting,
        blocking: this.input.blocking,
        attackPointer: this.input.attackPointer,
        blockPointer: this.input.blockPointer,
        jumpPointer: this.input.jumpPointer,
        joystickPointer: this.input.joystickPointer,
        cameraPointer: this.input.cameraPointer,
        sprintPointer: this.input.sprintPointer,
      },
      camera: {
        position: this.camera.position.toArray(),
        yaw: this.followCamera.yaw,
        pitch: this.followCamera.pitch,
        targetPitch: this.followCamera.targetPitch,
        targetYaw: this.followCamera.targetYaw,
        distance: this.followCamera.distance,
      },
      combat: {
        blocking: this.combat.blocking,
        ready: this.combat.ready,
        postureActive: this.combat.postureActive,
        attack: {
          active: this.combat.attack.active,
          phase: this.combat.attack.phase,
          elapsed: this.combat.attack.elapsed,
          phaseProgress: this.combat.attack.phaseProgress,
          extension: this.combat.attack.extension,
          sequence: this.combat.attack.sequence,
          techniqueId: this.combat.attack.techniqueId,
          cancelled: this.combat.attack.cancelled,
          environment: this.combat.attack.context?.environment ?? "ground",
        },
      },
      proximity: {
        targetId: this.proximity.target?.id ?? null,
        distance: Number.isFinite(this.proximity.distance)
          ? this.proximity.distance
          : null,
        entryDistance: this.proximity.config.entryDistance,
        exitDistance: this.proximity.config.exitDistance,
        aligned: this.proximity.aligned,
        horizontalDistance: Number.isFinite(this.proximity.horizontalDistance)
          ? this.proximity.horizontalDistance
          : null,
        verticalSeparation: Number.isFinite(this.proximity.verticalSeparation)
          ? this.proximity.verticalSeparation
          : null,
        aerialEntryDistance: this.proximity.config.aerialEntryDistance,
        aerialExitDistance: this.proximity.config.aerialExitDistance,
      },
      dummy: {
        id: this.dummy.target.id,
        position: this.dummy.root.position.toArray(),
        radius: this.dummy.target.radius,
        strikeHeight: this.dummy.target.strikeHeight,
        strikeRadius: this.dummy.target.strikeRadius,
      },
      animation: {
        combatWeight: this.animator.combatWeight,
        phase: this.animator.locomotion.phase,
        cadence: this.animator.locomotion.cadence,
        stride: this.animator.locomotion.stride,
        dashWeight: this.animator.dashWeight,
        attackWeight: this.animator.attackWeight,
        jumpWeight: this.animator.jumpWeight,
        airDashWeight: this.animator.airDashWeight,
        aerialAttackWeight: this.animator.aerialAttackWeight,
        kickExtension: this.animator.aerialAttackAnimation.extension,
        runBlend: this.animator.locomotion.runBlend,
        sprintBlend: this.animator.locomotion.sprintBlend,
        footLift: this.animator.locomotion.lift,
        contactDuty: this.animator.locomotion.duty,
        accelerationCue: this.animator.motion.drive,
        brakingCue: this.animator.motion.brake,
        torsoPitch: this.character.joints.spine.rotation.x,
        torsoYaw: this.character.joints.spine.rotation.y,
        pelvisY: this.character.joints.hips.position.y,
        pelvisZ: this.character.joints.hips.position.z,
        visualPunchReach: this.animator.attackAnimation.reach,
        visualFlight: this.animator.locomotion.running.flight,
        armTrail: this.animator.locomotion.running.trail,
        feet: this.animator.footList.map((foot) => ({
          planted: foot.planted,
          position: this.character.joints[`${foot.side}Ankle`]
            .getWorldPosition(new THREE.Vector3()).toArray(),
        })),
      },
      halfSize: this.arena.halfSize,
      radius: this.controller.radius,
      paused: this.helpOpen || this.controlsOpen,
      layout: {
        active: this.controlLayoutEditor.active,
        editing: this.controlLayoutEditor.editing,
        custom: this.controlLayoutEditor.hasCustomLayout,
      },
      renderer: {
        calls: this.renderer.info.render.calls,
        triangles: this.renderer.info.render.triangles,
      },
    };
  }

  showError(message) {
    document.querySelector("#error-message").textContent = message;
    document.querySelector("#error").hidden = false;
  }
}
