import * as THREE from "three";
import { createArena } from "../world/createArena.js";
import { TraversalWorld } from "../world/TraversalWorld.js";
import { createTraversalArea } from "../world/createTraversalArea.js";
import { createGeometricWorld } from "../world/createGeometricWorld.js";
import { ALL_TRAVERSAL_STRUCTURES } from "../world/GeometricWorldLayout.js";
import { ARENA_CONFIG } from "../world/ArenaConfig.js";
import { BattleWorld } from "../combat/BattleWorld.js";
import { EnemyViews } from "../character/EnemyViews.js";
import { BattleHud } from "../ui/BattleHud.js";
import { PunchAimAssist } from "../combat/PunchAimAssist.js";
import { AimAssistPanel } from "../ui/AimAssistPanel.js";
import { EnemySettingsPanel } from "../ui/EnemySettingsPanel.js";
import { TagSettingsPanel } from "../ui/TagSettingsPanel.js";
import { EnemyAbilitiesPanel } from "../ui/EnemyAbilitiesPanel.js";
import { CameraSettingsPanel } from "../ui/CameraSettingsPanel.js";
import { CameraPreferences } from "../sandbox/CameraSettings.js";
import { PunchAimDebug } from "../character/PunchAimDebug.js";
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
import { SpeedEffects } from "../world/SpeedEffects.js";
import { FreeflowCombat } from "../combat/FreeflowCombat.js";
import { SpeedImpact } from "../combat/SpeedImpact.js";
import { loadSpeedEffectSettings } from "../sandbox/SpeedEffectsSettings.js";
import { loadFreeflowSettings } from "../sandbox/FreeflowSettings.js";
import { loadAnimationSettings } from "../sandbox/AnimationSettings.js";
import { CombatPolishPanel } from "../ui/CombatPolishPanel.js";
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
  SANDBOX_PARAMETERS,
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
    this.traversalArea = createTraversalArea(this.scene);
    this.geometricWorld = createGeometricWorld(this.scene);
    this.dummy = new TrainingDummy();
    this.scene.add(this.dummy.root);
    this.character = new Stickman();
    this.scene.add(this.character.root);
    this.controller = new CharacterController(
      this.character.root,
      new TraversalWorld(
        this.arena.halfSize,
        [this.dummy.target],
        ALL_TRAVERSAL_STRUCTURES,
      ),
      { faceInputWhenBlocked: true },
    );
    this.bodyRotation = new BodyRotation();
    this.lastRotationJumpSequence = 0;
    this.momentumRecovery = new MomentumRecovery();
    this.recoveryPrevious = new THREE.Vector3();
    this.streaks = new GroundStreaks();
    this.scene.add(this.streaks.mesh);
    this.speedEffects = new SpeedEffects();
    this.scene.add(this.speedEffects.group);
    this.effectFeet = [
      { position: new THREE.Vector3(), contact: false },
      { position: new THREE.Vector3(), contact: false },
    ];
    this.speedEffectContext = {
      position: this.character.root.position,
      velocity: new THREE.Vector3(),
      feet: this.effectFeet,
      grounded: true,
      floorHeight: 0,
    };
    this.freeflow = new FreeflowCombat();
    this.speedImpact = new SpeedImpact();
    this.lastBoomSequence = 0;
    this.impactIncomingVelocity = new THREE.Vector3();
    this.speedImpactContext = { start: null, end: null, incomingVelocity: this.impactIncomingVelocity };
    this.streakOrigin = new THREE.Vector3();
    this.lastPlantSequence = 0;
    this.limbSelector = new ContextualLimbSelector({
      scorePosition: (context, technique, side) =>
        this.punchAim?.limbPreference(context, technique, side) ?? 0,
    });
    this.bodyStart = new THREE.Quaternion();
    this.bodyEnd = new THREE.Quaternion();
    this.punchAim = new PunchAimAssist();
    this.combat = new CombatController({
      techniques: createAdaptiveTechniques(),
      selectTechnique: (context, eligible) =>
        this.limbSelector.choose(context, eligible),
      prepareAttackContext: (context, technique) =>
        this.prepareManualAttack(context, technique),
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
    this.freeflowContext = {
      combat: this.combat,
      blocking: false,
      mode: this.battle.mode,
      input: this.input,
      world: this.controller.world,
    };
    this.enemyViews = new EnemyViews(this.scene, this.battle.enemies);
    this.punchAim.targets = this.battle.enemies;
    this.punchAimDebug = new PunchAimDebug(this.scene, this.punchAim);
    this.defeated = false;
    this.contactFeedbackRemaining = 0;
    this.hitDetector = new StrikeHitDetector({
      targets: this.targets,
      onContact: (hit) => {
        this.contactFeedbackRemaining = 0.18;
        this.battle.hitEnemy(hit, this.combat.currentTechnique);
        if (this.cameraContext) {
          this.cameraContext.recentTargetId = hit.targetId;
          this.cameraContext.recentEngagementRemaining = 2.5;
        }
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
    this.followCamera.world = this.controller.world;
    let cameraStorage;
    try {
      cameraStorage = localStorage;
    } catch {
      cameraStorage = null;
    }
    // Camera preferences also load in ordinary play. They never share the
    // physics/AI/aim/layout saves or modify the player's movement parameters.
    this.cameraPreferences = new CameraPreferences(cameraStorage);
    this.speedEffects.configure(loadSpeedEffectSettings(cameraStorage) ?? {});
    this.freeflow.configure(loadFreeflowSettings(cameraStorage) ?? {});
    this.animationPreferences =
      loadAnimationSettings(cameraStorage) ?? undefined;
    this.followCamera.configure(this.cameraPreferences.get(this.battle.mode));
    this.cameraVelocity = new THREE.Vector3();
    this.cameraContext = {
      velocity: this.cameraVelocity,
      enemies: this.battle.enemies,
      gameplayMode: this.battle.mode,
      manualActive: false,
      recentTargetId: null,
      recentEngagementRemaining: 0,
      airborne: false,
      parkour: "free",
      world: this.controller.world,
      cameraPosition: this.camera.position,
    };
    this.cameraTelemetry = { velocity: [0, 0, 0], cameraPosition: [0, 0, 0] };
    this.polishTelemetry = {
      effects: {},
      freeflow: {},
      impacts: {},
      cameraImpact: {},
      strike: { point: [0, 0, 0] },
    };
    this.polishStrikePoint = new THREE.Vector3();
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
    this.battleHud = new BattleHud(
      () => this.respawn(),
      (mode) => this.setMode(mode),
    );
    this.simulationPrevious = new THREE.Vector3();
    this.combatStartRoot = new THREE.Vector3();
    this.combatEndRoot = new THREE.Vector3();
    this.simulationSteps = 1;
    this.physicsSandbox = new PhysicsSandboxPanel({
      onDash: () => this.input.requestDash(),
      onChange: (values) => {
        this.controller.applyMovementConfig(sandboxMovementConfig(values));
        this.battle.configureStrength(values);
        // Keep the normal camera angle and user orbit. Bound follow lag only in
        // the explicit sandbox, so a fast launch cannot outrun the view.
        this.sandboxModified = SANDBOX_PARAMETERS.some(
          ({ id, group }) => group !== "combat" && values[id] !== 1,
        );
        this.followCamera.maxLag = this.sandboxModified ? 0.65 : Infinity;
      },
    });
    this.aimAssistPanel = new AimAssistPanel(this.punchAim);
    this.enemySettingsPanel = new EnemySettingsPanel(this.battle);
    this.tagSettingsPanel = new TagSettingsPanel(this.battle);
    this.enemyAbilitiesPanel = new EnemyAbilitiesPanel(this.battle);
    this.cameraSettingsPanel = new CameraSettingsPanel({
      preferences: this.cameraPreferences,
      getGameplayMode: () => this.battle.mode,
      onChange: (mode, settings) => {
        if (mode === this.battle.mode) this.followCamera.configure(settings);
      },
    });
    this.combatPolishPanel = new CombatPolishPanel({
      effects: this.speedEffects,
      freeflow: this.freeflow,
      animator: this.animator,
      animation: this.animationPreferences,
      storage: cameraStorage,
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
    this.speedEffects?.reset();
    this.lastBoomSequence = 0;
    this.freeflow?.reset();
    this.speedImpact?.reset();
    this.followCamera?.impact?.reset();
    this.cameraVelocity?.set(0, 0, 0);
    // Pause/release input without erasing a flip or recovery configuration.
    if (this.controller.jump.grounded && this.bodyRotation.phase === "idle")
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
    this.acrobaticPresenter?.reset();
    this.animator.initialized = false;
    this.animator.previousPosition.copy(this.character.root.position);
    this.battle.reset();
    this.defeated = false;
    this.contactFeedbackRemaining = 0;
    this.followCamera.target.copy(this.character.root.position);
    this.followCamera.target.y += 1.02;
    this.followCamera.recenter?.(this.character.root.position);
    this.cameraVelocity?.set(0, 0, 0);
    if (this.cameraContext) {
      this.cameraContext.recentTargetId = null;
      this.cameraContext.recentEngagementRemaining = 0;
    }
    this.input.setEnabled(!this.controlsOpen && !this.helpOpen);
    this.battleHud.update(1, this.battle);
    this.controlLayoutEditor?.refresh();
  }

  setMode(mode) {
    if (!this.battle.setMode(mode)) return;
    // Release held combat/touch requests at the mode boundary while retaining
    // player velocity, aerial state, camera and all independent configurations.
    this.input.reset();
    this.combat.reset();
    this.attackScheduler.reset();
    this.freeflow?.reset();
    this.speedImpact?.reset();
    this.defeated = false;
    this.contactFeedbackRemaining = 0;
    this.punchAim.targets = mode === "tag" ? [] : this.battle.enemies;
    if (this.cameraPreferences)
      this.followCamera.configure(this.cameraPreferences.get(mode));
    this.cameraSettingsPanel?.setGameplayMode(mode);
    if (this.cameraContext) {
      this.cameraContext.gameplayMode = mode;
      this.cameraContext.recentTargetId = null;
      this.cameraContext.recentEngagementRemaining = 0;
    }
    this.input.setEnabled(!this.controlsOpen && !this.helpOpen);
    this.battleHud.update(1, this.battle);
    this.controlLayoutEditor?.refresh();
  }

  updateCameraMotion(dt) {
    if (
      !this.cameraVelocity ||
      !this.cameraContext ||
      !Number.isFinite(dt) ||
      dt <= 0
    )
      return;
    this.cameraVelocity
      .subVectors(this.character.root.position, this.simulationPrevious)
      .divideScalar(dt);
    const speed = this.cameraVelocity.length();
    if (!Number.isFinite(speed)) this.cameraVelocity.set(0, 0, 0);
    else if (speed > 100000) this.cameraVelocity.setLength(100000);
    this.cameraContext.recentEngagementRemaining = Math.max(
      0,
      this.cameraContext.recentEngagementRemaining - dt,
    );
    if (this.cameraContext.recentEngagementRemaining === 0)
      this.cameraContext.recentTargetId = null;
  }

  refreshCameraContext() {
    const context = this.cameraContext;
    if (!context) return null;
    context.manualActive = this.input?.cameraPointer != null;
    context.gameplayMode = this.battle.mode;
    context.enemies = this.battle.enemies;
    context.airborne = this.controller.jump.airborne;
    context.parkour = this.controller.parkour?.mode ?? "free";
    context.world = this.controller.world;
    context.cameraPosition = this.camera.position;
    return context;
  }

  prepareManualAttack(context, technique) {
    const alignment = this.freeflow?.begin(
      this.controller,
      this.battle?.enemies ?? [],
      technique,
      this.battle?.mode ?? "combat",
      this.controller.world,
      {
        accepted: true,
        context,
        input: this.input,
        cameraYaw: this.followCamera?.yaw ?? 0,
        orientation: this.bodyRotation?.orientation,
        sequence: (this.combat?.attack.sequence ?? 0) + 1,
      },
    );
    // Only one correction owns a captured strike. The unchanged aim system is
    // the complete fallback when freeflow is disabled or finds no safe target.
    return alignment
      ? {
          ...context,
          freeflow: alignment,
          punchAim: technique.action === "punch" ? alignment : null,
          kickAim: technique.action === "kick" ? alignment : null,
          strikeAim: alignment,
        }
      : this.punchAim.prepare(context, technique);
  }

  configureSpeedFeedback(config) {
    if (config === this.appliedSpeedFeedback || !config) return;
    this.appliedSpeedFeedback = config;
    this.followCamera?.impact?.configure({
      enabled: config.shakeEnabled,
      strength: config.shakeStrength,
      duration: config.shakeDuration,
    });
    this.speedImpact?.configure(config);
  }

  updateSpeedEffects(dt) {
    if (!this.speedEffects) return;
    const jump = this.controller.jump,
      context = this.speedEffectContext;
    context.velocity.copy(this.cameraVelocity);
    context.grounded = jump.canActOnGround || jump.ready;
    context.floorHeight = jump.floorHeight ?? 0;
    context.verticalVelocity = context.velocity.y;
    context.landingSpeed = jump.phase === "landing" ? jump.landingSpeed : 0;
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? "left" : "right",
        foot = this.effectFeet[i];
      this.character.joints[`${side}Ankle`].getWorldPosition(foot.position);
      foot.contact =
        context.grounded &&
        this.animator.feet[side].planted &&
        foot.position.y <= context.floorHeight + 0.24;
    }
    this.speedEffects.update(dt, context);
    const fx = this.speedEffects.config ?? {};
    this.configureSpeedFeedback?.(fx);
    const boom = this.speedEffects.lastBoom;
    if (boom?.sequence > 0 && boom.sequence !== this.lastBoomSequence) {
      this.lastBoomSequence = boom.sequence;
      this.followCamera.triggerImpact();
      this.speedImpact.boom(boom, this.battle, { excludeTargetId: this.freeflow?.active ? this.freeflow.targetId : null });
    }
  }

  refreshPolishTelemetry() {
    const out = this.polishTelemetry;
    if (!out) return;
    const fx = this.speedEffects;
    Object.assign(out.effects, {
      dustEmissions: fx.dustEmissions,
      sonicBursts: fx.sonicBursts,
      activeDust: fx.activeDust,
      activeRings: fx.activeRings,
      activeStreaks: fx.activeStreaks,
      sonicArmed: fx.sonicArmed,
      actualSpeed: fx.actualSpeed,
      horizontalSpeed: fx.horizontalSpeed,
      config: fx.config,
    });
    this.freeflow.snapshot(out.freeflow);
    out.freeflow.config = this.freeflow.config;
    this.speedImpact.snapshot(out.impacts);
    this.followCamera.impact.snapshot(out.cameraImpact);
    const t = this.combat.currentTechnique,
      attack = this.combat.attack;
    Object.assign(out.strike, {
      id: t?.id ?? null,
      style: t?.strikeStyle ?? null,
      action: t?.action ?? null,
      environment: attack.context?.environment ?? "ground",
      side: t?.side ?? null,
      active: attack.active,
      phase: attack.phase,
      sequence: attack.sequence,
      reach: t?.reach ?? 0,
      hitRadius: t?.hitRadius ?? 0,
      contacts: this.hitDetector.count,
      lastContactTargetId: this.hitDetector.lastContact?.targetId ?? null,
      combo: this.limbSelector.combo ?? null,
    });
    if (t) {
      this.character.joints[
        `${t.side}${t.action === "kick" ? "Ankle" : "Hand"}`
      ].getWorldPosition(this.polishStrikePoint);
      this.polishStrikePoint.toArray(out.strike.point);
    }
    out.sprintAggression = this.animator.locomotion.aggression;
  }

  refreshCameraTelemetry() {
    if (!this.cameraTelemetry) return;
    const out = this.cameraTelemetry,
      follow = this.followCamera;
    const state = follow.director?.state;
    this.cameraVelocity.toArray(out.velocity);
    this.camera.position.toArray(out.cameraPosition);
    out.actualFov = this.camera.fov;
    out.projectionY = this.camera.projectionMatrix.elements[5];
    out.distance = follow.distance;
    out.yaw = follow.yaw;
    out.pitch = follow.pitch;
    out.targetYaw = follow.targetYaw;
    out.targetPitch = follow.targetPitch;
    out.speed = this.cameraVelocity.length();
    out.settings = follow.settings;
    out.preferences = this.cameraPreferences.values;
    out.gameplayMode = this.battle.mode;
    out.selectedTargetId = state?.selectedTargetId ?? null;
    out.overrideRemaining = state?.overrideRemaining ?? 0;
    out.assistWeight = state?.assistWeight ?? 0;
    out.yawOffset = state?.yawOffset ?? 0;
    out.pitchOffset = state?.pitchOffset ?? 0;
    out.focusOffset = state?.focusOffset ?? 0;
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
        const playerSteps = this.physicsSandbox.enabled || this.freeflow?.active
          ? movementSubsteps(
              this.controller,
              STEP,
              undefined,
              this.input.movementMagnitude,
            )
          : 1;
        this.simulationSteps = Math.max(
          playerSteps,
          this.battle.recommendedSubsteps(STEP),
        );
        const step = STEP / this.simulationSteps;
        for (let i = 0; i < this.simulationSteps; i++)
          this.simulateMovement(step);
        this.acrobaticPresenter.begin(this.combat, this.controller);
        this.animator.update(STEP, {
          speed: this.controller.speed,
          blocking: this.input.blocking,
          combat: this.combat,
          dash: this.controller.dash,
          jump: this.controller.jump,
          sandbox: this.physicsSandbox.enabled && this.sandboxModified,
          recovery: this.momentumRecovery,
          parkour: this.controller.parkour,
        });
        this.acrobaticPresenter.apply(
          STEP,
          this.bodyRotation,
          this.combat,
          this.controller,
        );
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
        this.updateSpeedEffects?.(STEP);
        this.accumulator -= STEP;
      }
      this.followCamera.update(
        dt,
        this.character.root.position,
        this.input.consumeLookDelta(),
        this.refreshCameraContext(),
      );
      this.arena.updateFocus(this.character.root.position);
      this.enemyViews.update(dt, this.camera, this.character.root.position);
    }
    this.dummy.setTargeted(
      this.contactFeedbackRemaining > 0 &&
        this.hitDetector.lastContact?.targetId === this.dummy.target.id,
    );
    this.punchAimDebug.update(
      this.combat,
      this.character.root.position,
      this.bodyRotation.orientation,
      this.bodyRotation.lift,
    );
    this.refreshCameraTelemetry();
    this.refreshPolishTelemetry();
    this.battleHud.update(
      dt,
      this.battle,
      this.cameraTelemetry,
      this.polishTelemetry,
    );
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
    const flowContext = this.freeflowContext ?? {};
    flowContext.blocking = this.input.blocking;
    flowContext.mode = this.battle?.mode ?? "combat";
    flowContext.input = this.input;
    flowContext.cameraYaw = this.followCamera.yaw;
    flowContext.orientation = this.bodyRotation?.orientation;
    flowContext.world = this.controller.world;
    flowContext.combat = this.combat;
    const motion = this.freeflow?.beforeStep(dt, this.controller, flowContext);
    this.impactIncomingVelocity?.copy(motion?.velocity ?? this.controller.velocity);
    this.controller.update(dt, this.input, this.followCamera.yaw, null, motion);
    this.battle?.movePlayerImpulse(dt);
    this.freeflow?.afterStep(dt, this.controller, flowContext);
    this.combat.holdWindup = this.freeflow?.holdWindup ?? false;
    if (this.speedImpact) {
    Object.assign(this.speedImpactContext, {
      start: this.simulationPrevious, end: this.character.root.position,
      velocity: this.controller.velocity, playerRadius: this.controller.radius,
      world: this.controller.world, mode: this.battle?.mode,
      attackTargetId: this.freeflow?.active ? this.freeflow.targetId : null,
    });
    this.configureSpeedFeedback?.(this.speedEffects.config);
    this.speedImpact.update(dt, this.battle, this.speedImpactContext);
    }
    this.controller.syncSupport?.();
    this.updateCameraMotion?.(dt);
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
          this.controller.jump.timeToLanding,
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
      // Selection timestamps follow the actual combat boundary, including a
      // held repeat that begins partway through this fixed physics step.
      if (this.bodyRotation)
        context.clock = this.bodyRotation.time - dt + elapsed;
      if (
        !this.input.blocking &&
        this.punchAim?.config.strength > 0 &&
        this.punchAim.config.maxAngle > 0 &&
        (this.attackScheduler.pending === "punch" ||
          this.attackScheduler.pending === "kick" ||
          (this.combat.ready &&
            (this.attackScheduler.held.has("punch") ||
              this.attackScheduler.held.has("kick"))))
      )
        this.punchAim.capture(
          this.controller,
          this.simulationPrevious,
          this.bodyRotation,
          this.bodyStart,
          elapsed / dt,
          dt,
        );
      context.freeflowRedirect = !!(this.freeflow?.active && this.freeflow.holdWindup);
      this.attackScheduler.prepare(context, this.input.blocking);
      this.combat.holdWindup = this.freeflow?.holdWindup ?? false;
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
        this.combat.sampleEndTime?.(step) ?? start + step,
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
      this.freeflow?.cancel("defeated");
    }
  }

  snapshot() {
    return {
      aimAssist: this.punchAim
        ? {
            ...this.punchAim.config,
            queries: this.punchAim.queries,
            current: this.combat.attack.active
              ? (this.combat.attack.context?.punchAim ??
                this.combat.attack.context?.kickAim ??
                null)
              : null,
          }
        : null,
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
        rollTravel: this.bodyRotation.rollTravel,
        rotationTravel: this.bodyRotation.rotationTravel,
        flipProgress: this.bodyRotation.automatic.progress,
        flipStage: this.bodyRotation.automatic.stage,
        completedFlips: this.bodyRotation.completedFlips,
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
      parkour: this.controller.parkour
        ? {
            mode: this.controller.parkour.mode,
            sequence: this.controller.parkour.sequence,
            surface: this.controller.parkour.surface?.id ?? null,
            normal: this.controller.parkour.normal.toArray(),
            velocity: this.controller.parkour.velocity.toArray(),
            lastExit: this.controller.parkour.lastExit,
          }
        : null,
      jump: {
        phase: this.controller.jump.phase,
        grounded: this.controller.jump.grounded,
        airborne: this.controller.jump.airborne,
        height: this.controller.jump.height,
        floorHeight: this.controller.jump.floorHeight,
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
        jointRotations: Object.fromEntries(
          Object.entries(this.character.joints).map(([name, joint]) => [
            name,
            joint.quaternion.toArray(),
          ]),
        ),
        flipTuck: this.acrobaticPresenter.tuck,
        landingAnticipation: this.animator.jumpAnimation.anticipation,
        traversalWeight: this.acrobaticPresenter.parkour.weight,
        traversalPhase: this.acrobaticPresenter.parkour.phase,
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
