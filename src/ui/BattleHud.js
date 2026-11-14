export class BattleHud {
  constructor(onRespawn) {
    this.root = document.querySelector("#battle-status");
    this.health = document.querySelector("#health-value");
    this.fill = document.querySelector("#health-fill");
    this.meter = document.querySelector("#health-meter");
    this.wave = document.querySelector("#wave-value");
    this.defeated = document.querySelector("#defeated-value");
    this.alive = document.querySelector("#enemies-value");
    this.defeatPanel = document.querySelector("#defeat-panel");
    for (const button of document.querySelectorAll("[data-respawn]"))
      button.addEventListener("click", onRespawn);
    this.elapsed = 1;
  }
  update(dt, battle) {
    this.elapsed += dt;
    if (this.elapsed < 0.08) return;
    this.elapsed = 0;
    const p = battle.player;
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
    this.root.dataset.enemies = JSON.stringify(
      battle.enemies
        .filter((e) => e.spawned)
        .map((e) => ({
          id: e.body.id,
          health: e.body.health,
          state: e.state,
          position: e.root.position.toArray(),
          phase: e.combat.attack.phase,
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
