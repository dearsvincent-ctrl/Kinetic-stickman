import * as THREE from "three";
import { createArena } from "../world/createArena.js";
import { ArenaBounds } from "../world/ArenaBounds.js";
import { ARENA_CONFIG } from "../world/ArenaConfig.js";
import { BattleWorld } from "../combat/BattleWorld.js";
import { EnemyViews } from "../character/EnemyViews.js";
import { BattleHud } from "../ui/BattleHud.js";
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
  createAdaptiveTechniques,
  ContextualLimbSelector,
} from "../combat/AdaptiveTechniques.js";
import { BodyRotation } from "../movement/BodyRotation.js";
import { MomentumRecovery } from "../movement/MomentumRecovery.js";
import { GroundStreaks } from "../world/GroundStreaks.js";
import { AcrobaticPresenter } from "../character/AcrobaticPresenter.js";
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
    this.camera = new THREE.PerspectiveCamera(
      52,
      1,
      0.1,
      ARENA_CONFIG.cameraFar,
    );
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
    this.bodyRotation = new BodyRotation();
    this.lastRotationJumpSequence = 0;
    this.momentumRecovery = new MomentumRecovery();
    this.recoveryPrevious = new THREE.Vector3();
    this.streaks = new GroundStreaks();
    this.scene.add(this.streaks.mesh);
    this.streakOrigin = new THREE.Vector3();
    this.lastPlantSequence = 0;
    this.limbSelector = new ContextualLimbSelector();
    this.bodyStart = new THREE.Quaternion();
    this.bodyEnd = new THREE.Quaternion();
    this.combat = new CombatController({
      techniques: createAdaptiveTechniques(),
      selectTechnique: (context, eligible) =>
        this.limbSelector.choose(context, eligible),
    });
    this.attackScheduler = new AttackScheduler(this.combat);
    this.targets = [];
    this.battle = new BattleWorld({
      playerPosition: this.character.root.position,
      world: this.controller.world,
      targets: this.targets,
      dummy: this.dummy.target,
      enabled: new URLSearchParams(location.search).get("practice") !== "1",
    });
    this.enemyViews = new EnemyViews(this.scene, this.battle.enemies);
    this.defeated = false;
    this.contactFeedbackRemaining = 0;
    this.hitDetector = new StrikeHitDetector({
      targets: this.targets,
      onContact: (hit) => {
        this.contactFeedbackRemaining = 0.18;
        this.battle.hitEnemy(hit, this.combat.currentTechnique);
      },
    });
    // Reuse live movement context; accepted attacks take their own snapshot.
    this.combatContext = createCombatContext();
    this.animator = new CharacterAnimator(this.character);
    this.acrobaticPresenter = new AcrobaticPresenter(
      this.character,
      this.animator,
    );
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
      getCameraYaw: () => this.followCamera.yaw,
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
        this.input.setEnabled(!active && !this.helpOpen && !this.defeated);
        this.clearMotion();
      },
    });
    this.hud = new Hud({
      onHelpChange: (open) => {
        if (open) this.physicsSandbox?.setOpen(false);
        this.helpOpen = open;
        this.input.setEnabled(!open && !this.controlsOpen && !this.defeated);
        this.clearMotion();
      },
    });
    this.battleHud = new BattleHud(() => this.respawn());
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
    this.momentumRecovery.reset();
    this.streaks.reset();
    this.bodyRotation.reset(this.controller.heading);
    this.accumulator = 0;
    this.lastTime = null;
  }

  respawn() {
    // Reset only the encounter/life. Saved controls, sandbox multipliers and
    // camera orbit survive; no reload or replacement scene is needed.
    this.clearMotion();
    const config = this.controller.config;
    const world = this.controller.world;
    this.character.root.position.set(0, 0, 0);
    this.character.root.rotation.set(0, 0, 0);
    this.controller = new CharacterController(this.character.root, world, {
      faceInputWhenBlocked: true,
    });
    this.controller.applyMovementConfig(config);
    this.lastRotationJumpSequence = 0;
    this.bodyRotation.reset(0);
    this.animator.initialized = false;
    this.animator.previousPosition.copy(this.character.root.position);
    this.battle.reset();
    this.defeated = false;
    this.contactFeedbackRemaining = 0;
    this.followCamera.target.copy(this.character.root.position);
    this.followCamera.target.y += 1.02;
    this.input.setEnabled(!this.controlsOpen && !this.helpOpen);
    this.battleHud.update(1, this.battle);
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
          if (action === "jump")
            this.controller.requestJump(
              this.input.jumpIntent,
              this.input.jumpIntent.cameraYaw,
            );
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
        this.acrobaticPresenter.begin(this.combat);
        this.animator.update(STEP, {
          speed: this.controller.speed,
          blocking: this.input.blocking,
          combat: this.combat,
          dash: this.controller.dash,
          jump: this.controller.jump,
          sandbox: this.physicsSandbox.enabled && this.sandboxModified,
          recovery: this.momentumRecovery,
        });
        this.acrobaticPresenter.apply(STEP, this.bodyRotation, this.combat);
        if (this.battle.player.stagger > 0)
          this.character.joints.spine.rotation.x -=
            Math.sin((this.battle.player.stagger / 0.24) * Math.PI) * 0.18;
        const plant = this.animator.recoveryAnimation;
        if (plant.impactSequence !== this.lastPlantSequence) {
          this.lastPlantSequence = plant.impactSequence;
          this.character.joints[`${plant.side}Ankle`].getWorldPosition(
            this.streakOrigin,
          );
          this.streaks.emit(
            this.streakOrigin,
            this.momentumRecovery.incoming,
            this.momentumRecovery.intensity,
            this.momentumRecovery.speed,
          );
        }
        this.streaks.update(STEP);
        this.accumulator -= STEP;
      }
      this.followCamera.update(
        dt,
        this.character.root.position,
        this.input.consumeLookDelta(),
      );
      this.arena.updateFocus(this.character.root.position);
      this.enemyViews.update(dt, this.camera, this.character.root.position);
    }
    this.dummy.setTargeted(
      this.contactFeedbackRemaining > 0 &&
        this.hitDetector.lastContact?.targetId === this.dummy.target.id,
    );
    this.battleHud.update(dt, this.battle);
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
      this.bodyRotation,
      this.momentumRecovery,
    );
  }

  simulateMovement(dt) {
    // Physics advances exactly once at its own step size, independent of attack
    // speed. Combat samples that resolved path at its own phase boundaries.
    this.battle?.beginStep(dt, this.input.blocking, this.controller.heading);
    this.simulationPrevious.copy(this.character.root.position);
    const heading = this.controller.heading;
    const startLift = this.bodyRotation?.lift ?? 0;
    if (this.bodyRotation) this.bodyStart.copy(this.bodyRotation.orientation);
    if (this.momentumRecovery)
      this.recoveryPrevious.copy(this.controller.velocity);
    this.controller.update(dt, this.input, this.followCamera.yaw);
    this.battle?.movePlayerImpulse(dt);
    const jumpEvent = this.controller.jumpEvent;
    if (
      this.bodyRotation &&
      jumpEvent.sequence !== this.lastRotationJumpSequence
    ) {
      this.lastRotationJumpSequence = jumpEvent.sequence;
      if (jumpEvent.kind)
        this.bodyRotation.start(
          jumpEvent.kind,
          this.controller.heading,
          1,
          1,
          jumpEvent.referenceYaw,
        );
    }
    this.momentumRecovery?.update(
      dt,
      this.recoveryPrevious,
      this.controller,
      this.input,
      this.followCamera.yaw,
    );
    this.bodyRotation?.update(
      dt,
      this.controller,
      this.input,
      this.followCamera.yaw,
    );
    if (this.bodyRotation) this.bodyEnd.copy(this.bodyRotation.orientation);
    const context = updateCombatContext(this.combatContext, this.controller);
    if (this.battle && !this.battle.player.active) context.canAttack = false;
    if (this.bodyRotation) {
      context.clock = this.bodyRotation.time;
      context.rotationActive = this.bodyRotation.phase !== "idle";
      context.rotationRate ??= [0, 0, 0];
      this.bodyRotation.angularVelocity.toArray(context.rotationRate);
      context.previousAction = this.combat.currentTechnique?.action;
      context.lateralMovement = this.input.move.x;
      context.limbs ??= { left: {}, right: {} };
      if (
        (this.combat.ready && this.attackScheduler.held.size > 0) ||
        this.attackScheduler.pending ||
        this.attackScheduler.gestureRequest
      )
        this.acrobaticPresenter.fillLimbContext(context, this.bodyRotation);
    }
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
        this.bodyRotation ? this.bodyStart : null,
        this.bodyRotation ? this.bodyEnd : null,
        startLift,
        this.bodyRotation?.lift ?? 0,
        t0,
        t1,
      );
      this.combat.update(step);
      elapsed += step;
    }
    this.battle?.endStep(dt, this.controller.heading);
    if (this.battle && !this.battle.player.active && !this.defeated) {
      this.defeated = true;
      this.input.setEnabled(false);
      this.controller.stop();
      this.attackScheduler.reset();
      this.combat.cancelAttack("defeated");
    }
  }

  snapshot() {
    return {
      battle: this.battle?.snapshot(),
      recovery: {
        sequence: this.momentumRecovery.sequence,
        kind: this.momentumRecovery.kind,
        intensity: this.momentumRecovery.intensity,
        weight: this.momentumRecovery.weight,
        compression: this.momentumRecovery.compression,
        speed: this.momentumRecovery.speed,
        braking: this.momentumRecovery.braking,
        plantSide: this.animator.recoveryAnimation.side,
        streaks: this.streaks.emissions,
      },
      sandbox: {
        enabled: this.physicsSandbox.enabled,
        values: this.physicsSandbox.values,
        substeps: this.simulationSteps,
        contacts: this.hitDetector.count,
      },
      acrobatics: {
        phase: this.bodyRotation.phase,
        kind: this.bodyRotation.lastKind,
        sequence: this.bodyRotation.sequence,
        quaternion: this.bodyRotation.orientation.toArray(),
        angularVelocity: this.bodyRotation.angularVelocity.toArray(),
        pitchTravel: this.bodyRotation.pitchTravel,
        invertedWeight: this.bodyRotation.invertedWeight,
        referenceYaw: this.bodyRotation.referenceYaw,
        lift: this.bodyRotation.lift,
        transition: this.combat.lastTransition,
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
        count: this.controller.jump.jumpCount,
        maxJumps: this.controller.jump.config.maxJumps,
        launchVelocity: this.controller.jump.launchVelocity,
        referenceYaw: this.controller.jumpReferenceYaw,
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
          side: this.combat.currentTechnique?.side,
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
