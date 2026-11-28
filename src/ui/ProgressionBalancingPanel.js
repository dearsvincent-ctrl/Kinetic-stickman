import { STATISTICS, ABILITIES } from "../progression/ProgressionCatalog.js";
import {
  CURVE_TYPES,
  REFERENCE_RULES,
  RULE_PRESETS,
  sanitizeRules,
  evaluateCurve,
  curveCost,
  curveDescription,
  gameplayBounds,
} from "../progression/ProgressionCurves.js";
import { LAB_CONTROLS } from "../progression/ProgressionLabControls.js";
import {
  BUILD_IDENTITIES,
  buildForBudget,
} from "../progression/ProgressionLab.js";
const copy = (x) => JSON.parse(JSON.stringify(x));
const el = (tag, text) => {
  const n = document.createElement(tag);
  if (text) n.textContent = text;
  return n;
};
const button = (id, text, fn) => {
  const b = el("button", text);
  b.type = "button";
  b.id = id;
  b.addEventListener("click", fn);
  return b;
};
export class ProgressionBalancingPanel {
  constructor(game) {
    this.game = game;
    this.lab = game.progressionLab;
    this.attribute = "maximumVelocity";
    this.ability = "aerialReserve";
    this.inputs = new Map();
    this.outputs = new Map();
    this.section = el("details");
    this.section.id = "progression-balancing";
    this.section.append(
      el("summary", "Progression Balancing · curves & character builds"),
    );
    const note = el(
      "p",
      "Draft curves affect temporary tests only. Save/Load uses a separate progression library. Applying draft rules to normal play requires confirmation and preserves purchases. Attribute values are not multipliers.",
    );
    note.className = "physics-note";
    this.section.append(note);
    this.status = el("p");
    this.status.id = "progression-lab-status";
    this.status.setAttribute("aria-live", "polite");
    this.section.append(this.status);
    this.preset = this.select(
      "preset",
      "Reference / experimental rules",
      [
        ...Object.keys(RULE_PRESETS),
        ["custom", "Custom / edited configuration"],
      ],
      (name) => {
        if (!RULE_PRESETS[name]) return;
        this.commit(copy(RULE_PRESETS[name]));
        this.refresh();
      },
    );
    this.statSelect = this.select(
      "attribute",
      "Attribute to inspect / edit",
      STATISTICS.map((d) => [d.id, d.name]),
      (id) => {
        this.attribute = id;
        this.refresh();
        this.relock();
      },
    );
    this.type = this.select(
      "type",
      "Progression curve type",
      CURVE_TYPES,
      (type) => this.editRule("type", type),
    );
    for (const p of LAB_CONTROLS.filter(
      (p) =>
        !p.key.startsWith("economy-") &&
        !p.key.startsWith("ability-") &&
        !p.key.startsWith("build-"),
    ))
      this.range(p, (v) => this.editRule(p.key, v));
    this.formula = el("p");
    this.formula.id = "progression-lab-formula";
    this.section.append(this.formula);
    this.table = el("table");
    this.table.id = "progression-lab-preview";
    this.section.append(this.table);
    const economy = el("details");
    economy.id = "progression-lab-economy";
    economy.append(el("summary", "Economy & experience"));
    this.section.append(economy);
    for (const p of LAB_CONTROLS.filter((p) => p.key.startsWith("economy-")))
      this.range(
        p,
        (v) => {
          const r = copy(this.lab.draft);
          r.economy[p.key.slice(8)] = v;
          this.commit(r);
        },
        economy,
      );
    const ability = el("details");
    ability.id = "progression-lab-abilities";
    ability.append(el("summary", "Numerical ability prerequisites"));
    this.section.append(ability);
    this.abilitySelect = this.select(
      "ability",
      "Ability prerequisites to edit",
      ABILITIES.filter((a) => !a.baseline).map((a) => [a.id, a.name]),
      (id) => {
        this.ability = id;
        this.refresh();
        this.relock();
      },
      ability,
    );
    const enable = el("label");
    enable.className = "aim-debug-label";
    this.enabled = el("input");
    this.enabled.id = "progression-lab-ability-enabled";
    this.enabled.type = "checkbox";
    this.enabled.setAttribute(
      "aria-label",
      "Ability available in this ruleset",
    );
    enable.append(
      this.enabled,
      el("span", "Ability available in this ruleset"),
    );
    ability.append(enable);
    this.enabled.addEventListener("change", () =>
      this.editAbility("enabled", this.enabled.checked),
    );
    for (const p of LAB_CONTROLS.filter((p) =>
      ["ability-level", "ability-cost"].includes(p.key),
    ))
      this.range(p, (v) => this.editAbility(p.key.slice(8), v), ability);
    this.requirement = this.select(
      "requirement-stat",
      "Ability prerequisite attribute",
      STATISTICS.map((d) => [d.id, d.name]),
      () => this.refreshRequirement(),
      ability,
    );
    this.requirement.value = "agility";
    this.range(
      LAB_CONTROLS.find((p) => p.key === "ability-requirement"),
      () => {},
      ability,
    );
    ability.append(
      button(
        "progression-lab-add-requirement",
        "Set / replace attribute requirement",
        () => {
          const r = copy(this.lab.draft);
          r.abilities[this.ability].attributes[this.requirement.value] = Number(
            this.inputs.get("ability-requirement").value,
          );
          this.commit(r);
        },
      ),
      button(
        "progression-lab-remove-requirement",
        "Remove this attribute requirement",
        () => {
          const r = copy(this.lab.draft);
          delete r.abilities[this.ability].attributes[this.requirement.value];
          this.commit(r);
        },
      ),
    );
    this.dependency = this.select(
      "dependency",
      "Required previous ability",
      ABILITIES.map((a) => [a.id, a.name]),
      () => {},
      ability,
    );
    ability.append(
      button("progression-lab-add-dependency", "Add required ability", () => {
        if (this.dependency.value === this.ability)
          return this.message("An ability cannot require itself");
        const r = copy(this.lab.draft),
          a = r.abilities[this.ability];
        a.abilities = [...new Set([...a.abilities, this.dependency.value])];
        this.commit(r);
      }),
      button(
        "progression-lab-remove-dependency",
        "Remove required ability",
        () => {
          const r = copy(this.lab.draft);
          r.abilities[this.ability].abilities = r.abilities[
            this.ability
          ].abilities.filter((id) => id !== this.dependency.value);
          this.commit(r);
        },
      ),
    );
    this.requirements = el("p");
    this.requirements.id = "progression-lab-requirements";
    ability.append(this.requirements);
    this.library("configurations", "Progression configurations", this.section);
    this.section.append(
      button("progression-lab-reset", "Reset draft to v0.9.2 reference", () => {
        this.lab.reset();
        this.applyDraft();
        this.refresh();
      }),
      button(
        "progression-lab-activate",
        "Use draft rules for normal character",
        () => {
          if (
            !confirm(
              "Use this progression configuration for normal character gameplay? Purchased upgrades, XP and points are preserved. Sandbox values are unchanged.",
            )
          )
            return;
          this.lab.activate();
          this.game.progression.configureRules(this.lab.active);
          this.message("Normal character uses " + this.lab.active.name);
        },
      ),
      button(
        "progression-lab-restore-reference",
        "Restore normal character reference rules",
        () => {
          if (
            !confirm(
              "Restore v0.9.2 reference curves for normal gameplay? Purchases and character data are preserved.",
            )
          )
            return;
          const draft = this.lab.draft;
          this.lab.draft = copy(REFERENCE_RULES);
          this.lab.activate();
          this.lab.draft = draft;
          this.lab.persist();
          this.game.progression.configureRules(this.lab.active);
          this.message("Normal character reference restored");
        },
      ),
    );
    this.buildTools();
    document.querySelector(".physics-scroll").append(this.section);
    this.refresh();
  }
  message(text) {
    this.status.textContent =
      text +
      (this.lab.persistence === "session"
        ? " · session only; storage unavailable or protected"
        : "");
  }
  select(key, label, options, fn, parent = this.section) {
    const row = el("label");
    row.className = "physics-row";
    const input = el("select");
    input.id = "progression-lab-" + key;
    input.setAttribute("aria-label", label);
    for (const item of options) {
      const [value, text] = Array.isArray(item) ? item : [item, item];
      const o = el("option", text);
      o.value = value;
      input.append(o);
    }
    input.addEventListener("change", () => fn(input.value));
    row.append(el("span", label), input);
    parent.append(row);
    return input;
  }
  range(p, fn, parent = this.section) {
    const row = el("label");
    row.className = "physics-row";
    const input = el("input"),
      out = el("output");
    input.type = "range";
    input.id = p.id;
    input.min = p.log ? Math.log10(p.min) : p.min;
    input.max = p.log ? Math.log10(p.max) : p.max;
    input.step = p.log ? 0.01 : p.step;
    input.setAttribute("aria-label", p.label);
    out.htmlFor = input.id;
    row.append(el("span", p.label), out, input);
    parent.append(row);
    this.inputs.set(p.key, input);
    this.outputs.set(p.key, out);
    input.addEventListener("input", () => {
      const actual = p.log ? 10 ** Number(input.value) : Number(input.value);
      out.value = String(Number(actual.toPrecision(5)));
      fn(actual);
    });
  }
  set(key, value) {
    const input = this.inputs.get(key);
    if (input) {
      const parameter = LAB_CONTROLS.find((p) => p.key === key);
      input.value = String(parameter?.log ? Math.log10(value) : value);
      this.outputs.get(key).value = String(Number(value.toPrecision(5)));
      input.setAttribute("aria-valuetext", String(value));
    }
  }
  relock() {
    this.game.physicsSandbox.sliderLocks?.lockAll(this.section);
    this.section.dispatchEvent(
      new Event("kinetic:relock-sliders", { bubbles: true }),
    );
  }
  commit(rules) {
    this.lab.edit(rules);
    this.applyDraft();
    this.refresh();
    this.message(
      "Draft applied to temporary testing only · " +
        (this.lab.persistence === "session"
          ? "session only; original data preserved"
          : "saved separately in this browser"),
    );
  }
  applyDraft() {
    if (this.game.progressionPreview)
      this.game.progressionPreview.configureRules(this.lab.draft);
  }
  editRule(key, value) {
    const r = copy(this.lab.draft);
    r.stats[this.attribute][key] = value;
    r.name = "Custom draft";
    this.commit(r);
  }
  editAbility(key, value) {
    const r = copy(this.lab.draft);
    r.abilities[this.ability][key] = value;
    r.name = "Custom draft";
    this.commit(r);
  }
  refreshRequirement() {
    this.set(
      "ability-requirement",
      this.lab.draft.abilities[this.ability].attributes[
        this.requirement.value
      ] ?? 1,
    );
  }
  refresh() {
    const r = this.lab.draft,
      v = r.stats[this.attribute];
    const bounds = gameplayBounds(
      STATISTICS.find((d) => d.id === this.attribute),
    );
    for (const key of ["base", "maxGameplay"]) {
      this.inputs.get(key).min = String(Math.log10(bounds.min));
      this.inputs.get(key).max = String(Math.log10(bounds.max));
    }
    this.preset.value =
      Object.keys(RULE_PRESETS).find(
        (name) => RULE_PRESETS[name].name === r.name,
      ) ?? "custom";
    this.statSelect.value = this.attribute;
    this.type.value = v.type;
    for (const p of LAB_CONTROLS) {
      if (p.key.startsWith("economy-"))
        this.set(p.key, r.economy[p.key.slice(8)]);
      else if (Object.hasOwn(v, p.key)) this.set(p.key, v[p.key]);
    }
    this.formula.textContent =
      "Draft: " +
      r.name +
      " · " +
      curveDescription(v) +
      `; n = attribute − 1, threshold ${v.threshold}, beyond-threshold rate ${v.postThresholdRate}. Maximum ${v.maxGameplay}. Values above max attribute ${v.maxAttribute} are capped. Normal active rules: ${this.lab.active.name}`;
    this.table.replaceChildren();
    const head = el("tr");
    for (const text of ["Attribute", "Gameplay value", "Next cost"])
      head.append(el("th", text));
    this.table.append(head);
    for (const n of [1, 2, 5, 10, 20]) {
      const tr = el("tr");
      for (const text of [
        String(n) + (n > v.maxAttribute ? " (capped)" : ""),
        evaluateCurve(v, n).toFixed(3),
        n >= v.maxAttribute ? "MAX" : String(curveCost(v, n - 1)),
      ])
        tr.append(el("td", text));
      this.table.append(tr);
    }
    const a = r.abilities[this.ability];
    this.abilitySelect.value = this.ability;
    this.enabled.checked = a.enabled;
    this.set("ability-level", a.level);
    this.set("ability-cost", a.cost);
    this.refreshRequirement();
    this.requirements.textContent =
      `Level ${a.level}; ` +
      Object.entries(a.attributes)
        .map(([id, n]) => `${STATISTICS.find((d) => d.id === id).name} ${n}`)
        .join(", ") +
      `; abilities: ${a.abilities.join(", ") || "none"}`;
    if (this.inputs.has("build-value")) {
      this.inputs.get("build-value").max = String(v.maxAttribute);
      this.set(
        "build-value",
        Math.min(
          v.maxAttribute,
          this.game.activeCharacter.attribute(this.attribute),
        ),
      );
      this.updateBuildStatus();
    }
  }
  library(kind, title, parent) {
    const section = el("details");
    section.dataset.progressionLibrary = "";
    section.id = "progression-library-section-" + kind;
    section.append(el("summary", title));
    const select = el("select");
    select.id = "progression-library-" + kind;
    select.setAttribute("aria-label", title);
    const name = el("input");
    name.id = "progression-name-" + kind;
    name.maxLength = 48;
    name.placeholder = "Name";
    name.setAttribute("aria-label", title + " name");
    section.append(select, name);
    const refresh = (id) => {
      select.replaceChildren();
      for (const x of this.lab[kind]) {
        const o = el("option", x.name);
        o.value = x.id;
        select.append(o);
      }
      if (id) select.value = id;
    };
    const value = () =>
      kind === "configurations"
        ? this.lab.draft
        : {
            character: this.game.progressionPreview?.snapshot(),
            rules: this.game.progressionPreview?.rules,
            budget: Number(this.inputs.get("build-budget").value),
          };
    const action = (fn) => () => {
      try {
        fn();
      } catch (e) {
        this.message(e.message);
      }
    };
    section.append(
      button(
        "progression-save-" + kind,
        "Save new",
        action(() => {
          if (kind === "builds" && !this.game.progressionPreview)
            throw Error("Begin an experimental character first");
          const item = this.lab.save(kind, name.value, value());
          refresh(item.id);
          this.message("Saved " + item.name);
        }),
      ),
      button(
        "progression-load-" + kind,
        "Load selected",
        action(() => {
          const item = this.lab[kind].find((x) => x.id === select.value);
          if (!item) throw Error("Select a saved slot");
          if (kind === "configurations") {
            this.lab.edit(item.value);
            this.applyDraft();
          } else {
            this.lab.edit(item.value.rules);
            this.game.setProgressionPreview(true, {
              state: item.value.character,
              rules: item.value.rules,
            });
            this.set("build-budget", item.value.budget);
          }
          this.refresh();
          this.relock();
          this.message("Loaded " + item.name);
        }),
      ),
      button(
        "progression-overwrite-" + kind,
        "Overwrite selected",
        action(() => {
          const old = this.lab[kind].find((x) => x.id === select.value);
          if (!old) throw Error("Select a saved slot");
          if (!confirm("Overwrite " + old.name + "?")) return;
          if (kind === "builds" && !this.game.progressionPreview)
            throw Error("Begin a temporary character first");
          const item = this.lab.save(
            kind,
            name.value || old.name,
            value(),
            old.id,
          );
          refresh(item.id);
          this.message("Overwritten " + item.name);
        }),
      ),
      button("progression-delete-" + kind, "Delete selected", () => {
        if (select.value && confirm("Delete selected " + title + "?")) {
          this.lab.remove(kind, select.value);
          refresh();
        }
      }),
    );
    refresh();
    parent.append(section);
  }
  buildTools() {
    const section = el("details");
    section.id = "progression-build-tools";
    section.append(el("summary", "Experimental builds · common point budgets"));
    this.section.append(section);
    section.append(
      button(
        "progression-lab-begin",
        "Begin fresh experimental character",
        () => {
          this.game.setProgressionPreview(true, {
            state: null,
            rules: this.lab.draft,
          });
          this.refresh();
          this.message(
            "Experimental character only; saved character is unchanged",
          );
        },
      ),
      button("progression-lab-end", "End experimental character", () => {
        this.game.setProgressionPreview(false);
        this.refresh();
      }),
    );
    this.range(
      LAB_CONTROLS.find((p) => p.key === "build-budget"),
      () => this.updateBuildStatus(),
      section,
    );
    this.set("build-budget", 100);
    this.range(
      LAB_CONTROLS.find((p) => p.key === "build-value"),
      () => {},
      section,
    );
    const assign = (attributes) => {
      const c = this.game.progressionPreview;
      if (!c) return this.message("Begin an experimental character first");
      const result = c.redistribute(
        attributes,
        Number(this.inputs.get("build-budget").value),
      );
      this.message(
        result.ok
          ? "Temporary attributes redistributed; unspent points refunded"
          : result.reason,
      );
      this.refresh();
    };
    section.append(
      button(
        "progression-lab-assign",
        "Assign current numerical attribute",
        () =>
          assign({
            [this.attribute]: Number(this.inputs.get("build-value").value),
          }),
      ),
      button(
        "progression-lab-budget",
        "Apply budget / refund unspent points",
        () => assign({}),
      ),
      button(
        "progression-lab-respec",
        "Reset experimental attributes to 1",
        () => {
          const c = this.game.progressionPreview;
          if (!c) return this.message("Begin a temporary character first");
          c.state.unlocked = ABILITIES.filter((a) => a.baseline).map(
            (a) => a.id,
          );
          c.state.selected = [];
          assign(Object.fromEntries(STATISTICS.map((d) => [d.id, 1])));
        },
      ),
    );
    this.identity = this.select(
      "identity",
      "Optional comparison template",
      Object.keys(BUILD_IDENTITIES),
      () => {},
      section,
    );
    section.append(
      button(
        "progression-lab-template",
        "Fill template using this point budget",
        () => {
          const budget = Number(this.inputs.get("build-budget").value),
            b = buildForBudget(this.lab.draft, this.identity.value, budget);
          this.game.setProgressionPreview(true, {
            state: null,
            rules: this.lab.draft,
          });
          assign(b.attributes);
        },
      ),
    );
    this.buildStatus = el("p");
    this.buildStatus.id = "progression-build-status";
    section.append(this.buildStatus);
    this.library("builds", "Experimental character builds", section);
  }
  updateBuildStatus() {
    if (!this.buildStatus) return;
    const c = this.game.progressionPreview;
    this.buildStatus.textContent = c
      ? `TEMPORARY · invested ${c.investment()} points · available ${c.state.points} · comparison budget ${this.inputs.get("build-budget").value}. Developer assignment bypasses purchase prerequisites. Saved character is protected.`
      : "No experimental character active. Templates are examples, not permanent classes.";
  }
}
