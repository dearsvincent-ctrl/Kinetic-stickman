export class Hud {
  constructor({ onHelpChange }) {
    this.fpsValue = document.querySelector("#fps-value");
    this.speedValue = document.querySelector("#speed-value");
    this.speedFill = document.querySelector("#speed-fill");
    this.movementState = document.querySelector("#movement-state");
    this.movementDot = document.querySelector("#movement-dot");
    this.stanceLabel = document.querySelector("#stance-label");
    this.contactStatus = document.querySelector("#contact-status");
    this.jumpButton = document.querySelector("#jump-button");
    this.jumpStatus = document.querySelector("#jump-status");
    this.helpDialog = document.querySelector("#help-dialog");
    this.fullscreenButton = document.querySelector("#fullscreen-button");
    this.frameCount = 0;
    this.sampleTime = 0;
    this.hudTime = 0;
    document.querySelector("#help-button").addEventListener("click", () => {
      onHelpChange(true);
      this.helpDialog.showModal();
    });
    this.helpDialog.addEventListener("close", () => onHelpChange(false));
    this.fullscreenButton.addEventListener("click", async () => {
      try {
        if (document.fullscreenElement) await document.exitFullscreen();
        else {
          await document.documentElement.requestFullscreen();
          // Android generally permits a lock only after entering fullscreen.
          try {
            await screen.orientation?.lock?.("landscape");
          } catch {
            /* Optional browser capability. */
          }
        }
      } catch {
        this.fullscreenButton.title =
          "Fullscreen is unavailable in this browser";
      }
    });
    document.addEventListener("fullscreenchange", () => {
      const active = Boolean(document.fullscreenElement);
      this.fullscreenButton.setAttribute(
        "aria-label",
        active ? "Exit fullscreen" : "Enter fullscreen",
      );
      this.fullscreenButton.setAttribute("aria-pressed", String(active));
    });
    if (!document.fullscreenEnabled) this.fullscreenButton.hidden = true;
  }

  update(
    dt,
    speed,
    maxSpeed,
    sprinting,
    combat = null,
    dash = null,
    jump = null,
    movement = null,
    hits = null,
    contactFeedback = 0,
    rotation = null,
    recovery = null,
  ) {
    this.frameCount++;
    this.sampleTime += dt;
    this.hudTime += dt;
    if (this.sampleTime >= 0.6) {
      this.fpsValue.textContent = String(
        Math.round(this.frameCount / this.sampleTime),
      );
      this.frameCount = 0;
      this.sampleTime = 0;
    }
    if (this.hudTime < 0.08) return;
    this.hudTime = 0;
    const state =
      dash?.active && dash.mode === "air"
        ? "AIR DASH"
        : jump && !jump.ready
          ? jump.phase === "takeoff"
            ? "TAKE-OFF"
            : jump.phase === "landing"
              ? "LANDING"
              : jump.verticalVelocity >= 0
                ? "ASCENT"
                : "DESCENT"
          : dash?.active
            ? "DASH"
            : speed < 0.08
              ? "IDLE"
              : sprinting
                ? "SPRINT"
                : speed > 2.5
                  ? "RUN"
                  : speed > 1.4
                    ? "JOG"
                    : "WALK";
    this.movementState.textContent = state;
    this.stanceLabel.textContent = combat?.blocking
      ? "BLOCKING"
      : combat?.attack.active
        ? combat.attack.phase === "recovery"
          ? "RECOVERING"
          : (combat.currentTechnique?.label?.toUpperCase() ?? "ATTACKING")
        : combat?.postureActive
          ? "COMBAT POSTURE"
          : rotation?.flipping
            ? `${rotation.phase.toUpperCase()} · STEER ROTATION`
            : "FREE MOVEMENT";
    this.speedValue.textContent = speed.toFixed(1);
    this.stanceLabel.dataset.technique = combat?.attack.active
      ? combat.attack.techniqueId
      : "none";
    this.stanceLabel.dataset.phase = combat?.attack.phase ?? "idle";
    this.stanceLabel.dataset.sequence = String(combat?.attack.sequence ?? 0);
    this.stanceLabel.dataset.action =
      combat?.currentTechnique?.action ?? "none";
    this.stanceLabel.dataset.side = combat?.currentTechnique?.side ?? "none";
    this.stanceLabel.dataset.acroSequence = String(rotation?.sequence ?? 0);
    this.stanceLabel.dataset.acroKind = rotation?.lastKind ?? "none";
    this.stanceLabel.dataset.recoverySequence = String(recovery?.sequence ?? 0);
    this.stanceLabel.dataset.recoveryKind = recovery?.kind ?? "none";
    this.stanceLabel.dataset.recoveryIntensity = String(
      recovery?.intensity ?? 0,
    );
    this.stanceLabel.dataset.acroPhase = rotation?.phase ?? "idle";
    this.stanceLabel.dataset.bodyUp = String(rotation?.up.y ?? 1);
    this.stanceLabel.dataset.invertedWeight = String(
      rotation?.invertedWeight ?? 0,
    );
    this.stanceLabel.dataset.angularPitch = String(
      rotation?.angularVelocity.x ?? 0,
    );
    this.stanceLabel.dataset.cancelled = String(
      combat?.attack.cancelled ?? false,
    );
    this.speedFill.style.width = `${Math.min(100, (speed / maxSpeed) * 100)}%`;
    this.movementDot.style.background =
      state === "IDLE" ? "#9faa98" : "#ff885e";
    if (hits) {
      this.contactStatus.dataset.count = String(hits.count);
      this.contactStatus.dataset.technique =
        hits.lastContact?.techniqueId ?? "none";
      this.contactStatus.classList.toggle("is-contact", contactFeedback > 0);
      this.contactStatus.textContent =
        contactFeedback > 0 ? "CONTACT" : "PRACTISE YOUR STRIKES";
    }
    if (jump) {
      this.jumpButton.dataset.jumpCount = String(jump.jumpCount);
      this.jumpButton.dataset.jumpSequence = String(jump.sequence);
      this.jumpButton.dataset.jumpLaunch = String(
        jump.flightLaunchVelocity ?? jump.launchVelocity,
      );
      this.jumpButton.setAttribute(
        "aria-disabled",
        String(!(movement ? movement.canJump : jump.ready && !dash?.active)),
      );
      this.jumpButton.classList.toggle("is-active", !jump.ready);
      this.jumpStatus.textContent = jump.ready
        ? dash?.active && dash.mode === "air"
          ? "DASHING"
          : "READY"
        : jump.airborne && jump.canJump
          ? "JUMP 2"
          : jump.phase === "takeoff"
            ? "PUSH"
            : jump.phase === "landing"
              ? "LAND"
              : jump.verticalVelocity >= 0
                ? "UP"
                : "DOWN";
    }
  }
}
