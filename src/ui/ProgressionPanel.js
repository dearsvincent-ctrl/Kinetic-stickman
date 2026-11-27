import {
  STATISTICS,
  ABILITIES,
  experienceRequired,
} from "../progression/ProgressionCatalog.js";
const make = (tag, text, cls) => {
  const n = document.createElement(tag);
  if (text) n.textContent = text;
  if (cls) n.className = cls;
  return n;
};
const button = (id, text, action) => {
  const n = make("button", text);
  n.id = id;
  n.type = "button";
  n.addEventListener("click", action);
  return n;
};
const value = (n, unit) => `${Number(n.toFixed(2))} ${unit}`;
/** Event-driven view of the character owner; never copies slider or gameplay state. */
export class ProgressionPanel {
  constructor(game) {
    this.game = game;
    this.previewId = null;
    this.dialog = make("dialog", null, "progression-dialog");
    this.dialog.id = "progression-dialog";
    this.dialog.setAttribute("aria-labelledby", "progression-title");
    this.dialog.dataset.gameplayUi = "";
    const header = make("header", null, "progression-heading"),
      title = make("h2", "Character progression");
    title.id = "progression-title";
    header.append(
      title,
      button("progression-close", "Close", () => this.dialog.close()),
    );
    this.overview = make("p", null, "progression-overview");
    this.overview.id = "progression-overview";
    this.overview.setAttribute("aria-live", "polite");
    this.meter = make("progress");
    this.meter.setAttribute(
      "aria-label",
      "Experience towards next character level",
    );
    this.notice = make("p", null, "physics-note");
    this.notice.id = "progression-notice";
    this.preview = make("section", null, "progression-preview");
    this.preview.id = "progression-preview";
    this.preview.setAttribute("aria-live", "polite");
    this.fields = make("div", null, "progression-fields");
    this.dialog.append(
      header,
      this.overview,
      this.meter,
      this.notice,
      this.preview,
      this.fields,
    );
    document.body.append(this.dialog);
    const entry = button("character-button", "Character progression ↗", () =>
      this.open(),
    );
    entry.className = "primary-button";
    document.querySelector("#edit-controls-button").after(entry);
    this.dialog.addEventListener("close", () => {
      game.progressionOpen = false;
      game.clearMotion();
      game.input.setEnabled(
        !game.controlsOpen && !game.helpOpen && !game.defeated,
      );
      entry.focus({ preventScroll: true });
    });
    this.dialog.addEventListener("keydown", (e) => e.stopPropagation());
    if (game.physicsSandbox.enabled) this.buildDeveloper();
    this.render();
  }
  open() {
    document.querySelector("#settings-dialog").close();
    this.game.physicsSandbox.setOpen(false);
    this.game.progressionOpen = true;
    this.game.input.setEnabled(false);
    this.game.clearMotion();
    this.render(true);
    this.dialog.showModal();
  }
  render(force = false) {
    this.refreshTestStatus();
    // Reward bursts can contain several physical tags in one simulation step.
    // Do not allocate/rebuild hidden statistic cards for each reward.
    if (!force && !this.dialog.open && this.fields.children.length) return;
    const character = this.game.activeCharacter,
      s = character.state,
      oldOpen = new Set(
        [...this.fields.querySelectorAll("details[open]")].map((n) => n.id),
      ),
      scroll = this.dialog.scrollTop,
      first = !this.fields.children.length;
    this.overview.textContent = `Level ${s.level} · XP ${s.experience} / ${s.level >= character.economy.maxLevel ? "MAX" : experienceRequired(s.level, character.economy)} · ${s.points} upgrade ${s.points === 1 ? "point" : "points"}`;
    this.meter.max = experienceRequired(s.level, character.economy);
    this.meter.value =
      s.level >= character.economy.maxLevel ? this.meter.max : s.experience;
    this.notice.textContent = this.game.progressionPreview
      ? "TEMPORARY TEST · changes and rewards are discarded when you end this preview."
      : (character.loadError ??
        `${character.persistence === "local" ? "Saved locally in this browser." : "Session only: browser storage unavailable."} Earn ${character.economy.defeatExperience} XP per combat defeat or ${character.economy.tagExperience} XP per tag; ${character.economy.pointsPerLevel} points per level. ${this.game.sandboxEnabled ? "Sandbox physics override your build. Use a temporary developer preview to test it." : "Upgrades affect this character immediately."}`);
    this.fields.replaceChildren();
    for (const [id, name] of [
      ["movement", "Movement"],
      ["parkour", "Agility & Parkour"],
      ["combat", "Combat"],
      ["aerial", "Aerial abilities"],
      ["abilities", "Unlockable abilities"],
    ]) {
      const section = make("details");
      section.id = `progression-category-${id}`;
      section.open = oldOpen.has(section.id) || (first && id === "movement");
      section.append(make("summary", name));
      if (id === "abilities")
        for (const definition of ABILITIES) {
          const a = character.ability(definition.id),
            row = make("article", null, "progression-row");
          row.id = `progression-ability-${a.id}`;
          row.append(
            make("h3", a.name),
            make("p", a.effect),
            make(
              "p",
              a.baseline
                ? "Available from the start"
                : a.purchased
                  ? "Purchased"
                  : (a.reason ?? `Available · ${a.cost} points`),
            ),
          );
          if (!a.baseline) {
            if (a.purchased)
              row.append(
                button(
                  `progression-select-${a.id}`,
                  a.selected ? "Selected · disable" : "Select ability",
                  () => character.select(a.id, !a.selected),
                ),
              );
            else {
              const b = button(
                `progression-unlock-${a.id}`,
                `Unlock · ${a.cost} points`,
                () => {
                  this.previewId = `ability:${a.id}`;
                  this.render();
                },
              );
              b.disabled = !a.available;
              row.append(b);
            }
          }
          section.append(row);
        }
      else
        for (const d of STATISTICS.filter((d) => d.category === id)) {
          const p = character.preview(d.id),
            row = make("article", null, "progression-row");
          row.id = `progression-stat-${d.id}`;
          const name = make("h3", d.name);
          row.append(
            name,
            make(
              "p",
              `Rank ${p.rank}/${p.maxLevel} · ${value(p.current, p.unit)}`,
            ),
            make(
              "p",
              p.rank >= p.maxLevel
                ? "Maximum upgrade reached"
                : `Next: ${value(p.next, p.unit)} · ${p.cost} ${p.cost === 1 ? "point" : "points"}`,
            ),
            make("p", p.effect),
          );
          const b = button(
            `progression-preview-${d.id}`,
            "Preview upgrade",
            () => {
              this.previewId = d.id;
              this.render();
              this.preview.scrollIntoView({ block: "nearest" });
            },
          );
          row.append(b);
          if (p.reason) row.append(make("p", p.reason, "physics-note"));
          section.append(row);
        }
      this.fields.append(section);
    }
    this.preview.replaceChildren();
    this.preview.hidden = !this.previewId;
    if (this.previewId) {
      const ability = this.previewId.startsWith("ability:"),
        id = ability ? this.previewId.slice(8) : this.previewId,
        p = ability ? character.ability(id) : character.preview(id);
      if (p) {
        this.preview.append(
          make("h3", `Preview: ${p.name}`),
          make(
            "p",
            ability
              ? p.effect
              : `${value(p.current, p.unit)} → ${value(p.next, p.unit)}. ${p.effect}`,
          ),
          make("p", p.reason ?? `Spend ${p.cost} upgrade points?`),
        );
        const confirm = button(
          "progression-confirm",
          `Spend ${p.cost} ${p.cost === 1 ? "point" : "points"}`,
          () => {
            const result = ability
              ? character.unlock(id)
              : character.purchase(id);
            if (!result.ok) {
              this.notice.textContent = result.reason;
              return;
            }
            this.previewId = null;
            this.render();
          },
        );
        confirm.disabled = !p.available;
        this.preview.append(
          confirm,
          button("progression-dismiss-preview", "Cancel preview", () => {
            this.previewId = null;
            this.render();
          }),
        );
      }
    }
    this.dialog.scrollTop = scroll;
  }
  refreshTestStatus() {
    const s = this.game.activeCharacter.state;
    if (this.testStatus) {
      this.testStatus.textContent = this.game.progressionPreview
        ? `Temporary character · level ${s.level} · ${s.points} points · never saved`
        : "Saved character is protected. Begin a temporary test to experiment.";
      for (const b of this.testButtons)
        b.disabled = !this.game.progressionPreview;
    }
  }
  buildDeveloper() {
    const section = make("details");
    section.id = "progression-testing";
    section.append(make("summary", "Character progression testing"));
    this.testStatus = make("p", null, "physics-note");
    section.append(this.testStatus);
    section.append(
      button(
        "progression-test-start",
        "Begin / restart temporary character test",
        () => this.game.setProgressionPreview(true),
      ),
    );
    this.testButtons = [
      button("progression-test-xp", "Award 100 XP to temporary character", () =>
        this.game.progressionPreview?.awardExperience(100),
      ),
      button(
        "progression-test-points",
        "Grant 10 temporary upgrade points",
        () => this.game.progressionPreview?.awardPoints(10),
      ),
      button("progression-test-open", "Open temporary character upgrades", () =>
        this.open(),
      ),
      button(
        "progression-test-end",
        "End test · restore sandbox settings",
        () => this.game.setProgressionPreview(false),
      ),
    ];
    section.append(...this.testButtons);
    document.querySelector(".physics-scroll").append(section);
  }
}
