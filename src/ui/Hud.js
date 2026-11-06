export class Hud {
  constructor({ onHelpChange }) {
    this.fpsValue = document.querySelector("#fps-value");
    this.speedValue = document.querySelector("#speed-value");
    this.speedFill = document.querySelector("#speed-fill");
    this.movementState = document.querySelector("#movement-state");
    this.movementDot = document.querySelector("#movement-dot");
    this.stanceLabel = document.querySelector("#stance-label");
    this.dashButton = document.querySelector("#dash-button");
    this.dashCooldown = document.querySelector("#dash-cooldown");
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
    proximity = null,
    jump = null,
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
      jump && !jump.ready
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
            : sprinting && speed > 2.7
              ? "SPRINT"
              : "WALK";
    this.movementState.textContent = state;
    this.stanceLabel.textContent = combat?.blocking
      ? "BLOCKING"
      : combat?.attack.active
        ? combat.attack.phase === "recovery"
          ? "RECOVERING"
          : "ATTACKING"
        : combat?.postureActive
          ? "COMBAT POSTURE"
          : proximity?.target
            ? "TARGET IN RANGE"
            : "FREE MOVEMENT";
    this.speedValue.textContent = speed.toFixed(1);
    this.speedFill.style.width = `${Math.min(100, (speed / maxSpeed) * 100)}%`;
    this.movementDot.style.background =
      state === "IDLE" ? "#9faa98" : "#ff885e";
    if (dash) {
      this.dashButton.setAttribute(
        "aria-disabled",
        String(!dash.ready || Boolean(jump && !jump.ready)),
      );
      this.dashButton.classList.toggle("is-active", dash.active);
      this.dashCooldown.textContent = dash.ready
        ? jump && !jump.ready
          ? "LAND FIRST"
          : "READY"
        : `${Math.max(0, dash.cooldownRemaining).toFixed(1)}s`;
    }
    if (jump) {
      this.jumpButton.setAttribute(
        "aria-disabled",
        String(!jump.ready || Boolean(dash?.active)),
      );
      this.jumpButton.classList.toggle("is-active", !jump.ready);
      this.jumpStatus.textContent = jump.ready
        ? dash?.active
          ? "DASHING"
          : "READY"
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
