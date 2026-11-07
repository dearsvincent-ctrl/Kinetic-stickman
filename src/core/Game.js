import * as THREE from "three";
import { createArena } from "../world/createArena.js";
import { ArenaBounds } from "../world/ArenaBounds.js";
import { Stickman } from "../character/Stickman.js";
import { CharacterAnimator } from "../character/CharacterAnimator.js";
import { CharacterController } from "../movement/CharacterController.js";
import { magnitudeForSpeed } from "../movement/AnalogueLocomotion.js";
import { FollowCamera } from "../camera/FollowCamera.js";
import { InputController } from "../input/InputController.js";
import { Hud } from "../ui/Hud.js";
import { CombatController } from "../combat/CombatController.js";
import { AttackScheduler } from "../combat/AttackScheduler.js";
import {
  createManualTechniques,
  selectManualTechnique,
} from "../combat/ManualTechniques.js";
import { StrikeHitDetector } from "../combat/StrikeHitDetector.js";
import {
  createCombatContext,
  updateCombatContext,
} from "../combat/CombatContext.js";
import { TrainingDummy } from "../world/TrainingDummy.js";
import { PhysicsSandboxPanel } from "../ui/PhysicsSandboxPanel.js";
import {
  movementSubsteps,
  sandboxMovementConfig,
} from "../sandbox/PhysicsSandbox.js";
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
      { faceInputWhenBlocked: true },
    );
    this.combat = new CombatController({
      techniques: createManualTechniques(),
      selectTechnique: selectManualTechnique,
    });
    this.attackScheduler = new AttackScheduler(this.combat);
    this.contactFeedbackRemaining = 0;
    this.hitDetector = new StrikeHitDetector({
      targets: [this.dummy.target],
      onContact: () => {
        this.contactFeedbackRemaining = 0.18;
      },
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
      keyboardMagnitude: magnitudeForSpeed(
        this.controller.runSpeed,
        this.controller.config.analogue,
      ),
      blockButton: document.querySelector("#block-button"),
      punchButton: document.querySelector("#punch-button"),
      kickButton: document.querySelector("#kick-button"),
      enableDash: new URLSearchParams(location.search).get("sandbox") === "1",
      onAttackPress: (action) => this.attackScheduler.press(action),
      onAttackHold: (action, held) =>
        this.attackScheduler.setHeld(action, held),
      onCombatReset: () => this.attackScheduler.reset(),
      jumpButton: document.querySelector("#jump-button"),
      cameraSurface: document.querySelector("#camera-surface"),
      resetButton: document.querySelector("#reset-camera"),
      onReset: () => this.followCamera.reset(this.controller.heading),
    });
    this.controlLayoutEditor = new ControlLayoutEditor({
      onActiveChange: (active) => {
        if (active) this.physicsSandbox?.setOpen(false);
        this.controlsOpen = active;
        this.input.setEnabled(!active && !this.helpOpen);
        this.clearMotion();
      },
    });
    this.hud = new Hud({
      onHelpChange: (open) => {
        if (open) this.physicsSandbox?.setOpen(false);
        this.helpOpen = open;
        this.input.setEnabled(!open && !this.controlsOpen);
        this.clearMotion();
      },
    });
    this.simulationPrevious = new THREE.Vector3();
    this.combatStartRoot = new THREE.Vector3();
    this.combatEndRoot = new THREE.Vector3();
    this.simulationSteps = 1;
    this.physicsSandbox = new PhysicsSandboxPanel({
      onDash: () => this.input.requestDash(),
      onChange: (values) => {
        this.controller.applyMovementConfig(sandboxMovementConfig(values));
        // Keep the normal camera angle and user orbit. Bound follow lag only in
        // the explicit sandbox, so a fast launch cannot outrun the view.
        this.sandboxModified = Object.values(values).some((v) => v !== 1);
        this.followCamera.maxLag = this.sandboxModified ? 0.65 : Infinity;
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
    this.attackScheduler.reset();
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
        this.simulationSteps = this.physicsSandbox.enabled
          ? movementSubsteps(
              this.controller,
              STEP,
              undefined,
              this.input.movementMagnitude,
            )
          : 1;
        const step = STEP / this.simulationSteps;
        for (let i = 0; i < this.simulationSteps; i++)
          this.simulateMovement(step);
        this.animator.update(STEP, {
          speed: this.controller.speed,
          blocking: this.input.blocking,
          combat: this.combat,
          dash: this.controller.dash,
          jump: this.controller.jump,
          sandbox: this.physicsSandbox.enabled && this.sandboxModified,
        });
        this.accumulator -= STEP;
      }
      this.followCamera.update(
        dt,
        this.character.root.position,
        this.input.consumeLookDelta(),
      );
    }
    this.dummy.setTargeted(this.contactFeedbackRemaining > 0);
    if (!this.contextLost) this.renderer.render(this.scene, this.camera);
    this.hud.update(
      Math.max(0.001, elapsed),
      this.controller.speed,
      this.controller.sprintSpeed,
      this.controller.speed >= this.animator.style.locomotion.sprintStart,
      this.combat,
      this.controller.dash,
      this.controller.jump,
      this.controller,
      this.hitDetector,
      this.contactFeedbackRemaining,
    );
  }

  simulateMovement(dt) {
    // Physics advances exactly once at its own step size, independent of attack
    // speed. Combat samples that resolved path at its own phase boundaries.
    this.simulationPrevious.copy(this.character.root.position);
    const heading = this.controller.heading;
    this.controller.update(dt, this.input, this.followCamera.yaw);
    const context = updateCombatContext(this.combatContext, this.controller);
    let elapsed = 0;
    const turn = Math.atan2(
      Math.sin(this.controller.heading - heading),
      Math.cos(this.controller.heading - heading),
    );
    while (elapsed < dt - 1e-9) {
      this.attackScheduler.prepare(context, this.input.blocking);
      const step = Math.min(
        dt - elapsed,
        Math.max(1e-8, this.combat.timeToBoundary),
      );
      const t0 = elapsed / dt,
        t1 = (elapsed + step) / dt;
      this.combatStartRoot.lerpVectors(
        this.simulationPrevious,
        this.character.root.position,
        t0,
      );
      this.combatEndRoot.lerpVectors(
        this.simulationPrevious,
        this.character.root.position,
        t1,
      );
      const start = this.combat.attack.elapsed;
      this.contactFeedbackRemaining = Math.max(
        0,
        this.contactFeedbackRemaining - step,
      );
      this.hitDetector.sweep(
        this.combat.currentTechnique,
        this.combat.attack,
        start,
        start + step,
        this.combatStartRoot,
        this.combatEndRoot,
        heading + turn * t0,
        heading + turn * t1,
      );
      this.combat.update(step);
      elapsed += step;
    }
  }

  snapshot() {
    return {
      sandbox: {
        enabled: this.physicsSandbox.enabled,
        values: this.physicsSandbox.values,
        substeps: this.simulationSteps,
        contacts: this.hitDetector.count,
      },
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
        movementMagnitude: this.input.movementMagnitude,
        sprinting: this.input.sprinting,
        blocking: this.input.blocking,
        punchHeld: this.input.punchHeld,
        kickHeld: this.input.kickHeld,
        punchPointer: this.input.punchPointer,
        kickPointer: this.input.kickPointer,
        blockPointer: this.input.blockPointer,
        jumpPointer: this.input.jumpPointer,
        joystickPointer: this.input.joystickPointer,
        cameraPointer: this.input.cameraPointer,
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
      contacts: {
        count: this.hitDetector.count,
        last: this.hitDetector.lastContact,
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
            .getWorldPosition(new THREE.Vector3())
            .toArray(),
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
