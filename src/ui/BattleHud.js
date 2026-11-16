import { worldZoneAt } from "../world/GeometricWorldLayout.js";
export class BattleHud {
  constructor(onRespawn, onModeChange = () => {}) {
    this.root = document.querySelector("#battle-status");
    this.health = document.querySelector("#health-value");
    this.fill = document.querySelector("#health-fill");
    this.meter = document.querySelector("#health-meter");
    this.wave = document.querySelector("#wave-value");
    this.defeated = document.querySelector("#defeated-value");
    this.alive = document.querySelector("#enemies-value");
    this.defeatPanel = document.querySelector("#defeat-panel");
    this.mode = document.querySelector("#game-mode");
    this.healthReadout = this.root.querySelector(".health-readout");
    this.waveReadout = this.root.querySelector(".wave-readout");
    this.tagReadout = document.querySelector("#tag-readout");
    this.tagActive = document.querySelector("#tag-active-value");
    this.tagCount = document.querySelector("#tag-count-value");
    this.tagTime = document.querySelector("#tag-time-value");
    this.tagFeedback = document.querySelector("#tag-feedback");
    this.reset = this.root.querySelector("[data-respawn]");
    this.mode.addEventListener("change", () => onModeChange(this.mode.value));
    for (const button of document.querySelectorAll("[data-respawn]"))
      button.addEventListener("click", onRespawn);
    this.elapsed = 1;
  }
  update(dt, battle) {
    this.elapsed += dt;
    if (this.elapsed < 0.08) return;
    this.elapsed = 0;
    const p = battle.player;
    const tag = battle.mode === "tag";
    this.mode.value = tag ? "tag" : "combat";
    this.healthReadout.hidden = this.waveReadout.hidden = tag;
    this.tagReadout.hidden = !tag;
    this.tagActive.textContent = battle.alive;
    this.tagCount.textContent = battle.tags ?? 0;
    const seconds = Math.max(0, Math.floor(battle.tagTime ?? 0));
    this.tagTime.textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
    const feedback = tag && battle.tagFeedback > 0 ? "TAG +1" : "";
    if (this.tagFeedback.textContent !== feedback)
      this.tagFeedback.textContent = feedback;
    this.reset.title = tag
      ? "Restart Tag Mode and reset the tag counter"
      : "Restore health and restart wave 1";
    this.root.dataset.mode = tag ? "tag" : "combat";
    this.root.dataset.tags = battle.tags ?? 0;
    this.root.dataset.tagTime = battle.tagTime ?? 0;
    this.root.dataset.tagSettings = JSON.stringify(battle.tagSettings ?? {});
    this.health.textContent = `${Math.ceil(p.health)} / ${p.maxHealth}`;
    this.fill.style.transform = `scaleX(${p.health / p.maxHealth})`;
    this.meter.setAttribute("aria-valuenow", p.health);
    this.wave.textContent = battle.enabled ? battle.wave : "PRACTICE";
    this.defeated.textContent = battle.defeated;
    this.alive.textContent = battle.alive;
    this.root.dataset.health = p.health;
    this.root.dataset.alive = battle.alive;
    this.root.dataset.wave = battle.wave;
    this.root.dataset.defeated = battle.defeated;
    this.root.dataset.damageEvents = battle.damageEvents;
    this.root.dataset.blockEvents = battle.blockEvents;
    this.root.dataset.position = JSON.stringify(p.position.toArray());
    this.root.dataset.heading = p.heading;
    this.root.dataset.enemySettings = JSON.stringify(battle.enemySettings);
    this.root.dataset.enemyProfiles = JSON.stringify(battle.enemyProfiles);
    this.root.dataset.enemyRosters = JSON.stringify(battle.enemyRosters);
    this.root.dataset.enemySettingsRevision = battle.settingsRevision;
    this.root.dataset.strength = JSON.stringify(battle.strength);
    this.root.dataset.worldZone = worldZoneAt(p.position);
    this.root.dataset.enemies = JSON.stringify(
      battle.enemies
        .filter((e) => e.spawned)
        .map((e) => ({
          id: e.body.id,
          profile: e.profile.id,
          parkour: e.controller.parkour?.mode ?? "free",
          jump: {
            phase: e.controller.jump.phase,
            count: e.controller.jump.jumpCount,
            height: e.controller.jump.height,
            verticalVelocity: e.controller.jump.verticalVelocity,
            launchVelocity: e.controller.jump.launchVelocity,
          },
          traversal: e.traversalPlanner.state,
          routeGoal: e.traversalPlanner.goal?.toArray() ?? null,
          health: e.body.health,
          state: e.state,
          position: e.root.position.toArray(),
          phase: e.combat.attack.phase,
          velocity: e.controller.velocity.toArray(),
          impulse: e.body.impulse.toArray(),
          alerted: e.alerted,
        })),
    );
    this.defeatPanel.hidden = p.active;
    document.body.classList.toggle(
      "received-hit",
      p.flash > 0 && !p.lastResult?.blocked,
    );
    document.body.classList.toggle(
      "received-block",
      p.flash > 0 && !!p.lastResult?.blocked,
    );
  }
}
