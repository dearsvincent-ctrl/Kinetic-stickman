import {
  REACTION_DEFAULTS,
  REACTION_PARAMETERS,
  saveReactions,
} from "../sandbox/ReactionSettings.js";
import {
  ANIMATION_DEFAULTS,
  ANIMATION_PARAMETERS,
  saveAnimationSettings,
  sanitizeAnimationSettings,
} from "../sandbox/AnimationSettings.js";
import {
  SPEED_EFFECT_DEFAULTS,
  SPEED_EFFECT_PARAMETERS,
  saveSpeedEffectSettings,
} from "../sandbox/SpeedEffectsSettings.js";
import {
  FREEFLOW_DEFAULTS,
  FREEFLOW_PARAMETERS,
  saveFreeflowSettings,
} from "../sandbox/FreeflowSettings.js";

/** Small independent editors. SliderLocks observes new ranges automatically;
 * these controls never share the physics/aim/camera/layout storage keys. */
export class CombatPolishPanel {
  constructor({ effects, freeflow, animator, animation, storage, battle }) {
    this.storage = storage;
    this.effects = effects;
    this.freeflow = freeflow;
    this.animator = animator;
    this.animation = sanitizeAnimationSettings(animation);
    animator.locomotion.aggression = this.animation.sprintAggression;
    if (new URLSearchParams(globalThis.location?.search).get("sandbox") !== "1")
      return;
    if (battle)
      this.addSection({
        id: "enemy-reactions",
        title: "Enemy Hit Reactions / Hybrid Ragdoll",
        parameters: REACTION_PARAMETERS,
        note: "Angular ragdoll joints keep fixed bone lengths. Physical launch and mass are separate from visual intensity and Attack Power. Thresholds are ordered automatically. Secondary collision damage starts off. Tag Mode never applies combat reactions. Settings save independently.",
        toggle: ["ragdollEnabled", "Selective ragdoll enabled"],
        get: () => battle.reactionSettings,
        apply: (values) => battle.configureReactions(values),
        defaults: REACTION_DEFAULTS,
        save: saveReactions,
      });
    this.addSection({
      id: "animation-polish",
      title: "Animation Presentation",
      parameters: ANIMATION_PARAMETERS,
      note: "Visual accents only. The existing gait, movement speeds and foot-contact timing stay independent.",
      get: () => this.animation,
      apply: (values) => {
        this.animation = sanitizeAnimationSettings(values);
        animator.locomotion.aggression = this.animation.sprintAggression;
      },
      defaults: ANIMATION_DEFAULTS,
      save: saveAnimationSettings,
    });
    this.addSection({
      id: "speed-effects",
      title: "Superhuman Speed Effects",
      parameters: SPEED_EFFECT_PARAMETERS,
      note: "Dust follows actual ground contacts and speed. The visual sonic barrier triggers once, then rearms below 80% of its speed threshold. Layered pressure waves and brief camera impact work in both modes. Enemy speed reactions apply only in Combat Mode; no health damage is added.",
      toggles: [
        ["sonicEnabled", "Sonic pressure wave enabled"],
        ["shakeEnabled", "Brief sonic camera impact"],
        ["nearMissEnabled", "Combat near-miss stagger"],
      ],
      get: () => effects.config,
      apply: (values) => effects.configure(values),
      defaults: SPEED_EFFECT_DEFAULTS,
      save: saveSpeedEffectSettings,
    });
    this.addSection({
      id: "freeflow-combat",
      title: "Freeflow Combat",
      parameters: FREEFLOW_PARAMETERS,
      note: "Manual Punch/Kick triggers a rapid, collision-aware approach in Combat Mode. Joystick intent selects targets. Off restores manual movement and aim assist. Tag Mode never approaches runners. These values are independent of camera assistance.",
      toggle: ["enabled", "Attack-driven freeflow enabled"],
      get: () => freeflow.config,
      apply: (values) => freeflow.configure(values),
      defaults: FREEFLOW_DEFAULTS,
      save: saveFreeflowSettings,
    });
  }

  addSection({
    id,
    title,
    parameters,
    note,
    toggle,
    toggles,
    get,
    apply,
    defaults,
    save,
  }) {
    const section = document.createElement("details");
    section.id = id;
    section.className = "enemy-settings";
    const summary = document.createElement("summary");
    summary.textContent = title;
    const fields = document.createElement("fieldset");
    const legend = document.createElement("legend");
    legend.textContent = title;
    const description = document.createElement("p");
    description.className = "physics-note";
    description.textContent = note;
    fields.append(legend, description);
    const rows = [];
    const checkboxes = [];
    const status = document.createElement("p");
    status.className = "physics-note";
    status.id = `${id}-status`;
    status.setAttribute("role", "status");
    const refresh = () => {
      const values = get();
      for (const { p, input, output } of rows) {
        input.value = String(p.log ? Math.log10(values[p.id]) : values[p.id]);
        output.value = `${Number(values[p.id].toFixed(2))}${p.unit ?? "×"}`;
        input.setAttribute("aria-valuetext", output.value);
      }
      for (const { checkbox, key } of checkboxes)
        checkbox.checked = values[key];
    };
    const commit = (values) => {
      apply(values);
      refresh();
      status.textContent = save(this.storage, get())
        ? "Applied live · saved independently on this browser"
        : "Applied live · storage unavailable";
    };
    for (const [key, text] of toggles ?? (toggle ? [toggle] : [])) {
      const label = document.createElement("label");
      label.className = "aim-debug-label";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.id = `${id}-${key}`;
      label.append(checkbox, document.createTextNode(text));
      fields.append(label);
      checkboxes.push({ checkbox, key });
      checkbox.addEventListener("change", () =>
        commit({ ...get(), [key]: checkbox.checked }),
      );
    }
    for (const p of parameters) {
      const row = document.createElement("label");
      row.className = "physics-row";
      const name = document.createElement("span");
      name.textContent = p.label;
      const output = document.createElement("output");
      const input = document.createElement("input");
      input.type = "range";
      input.id = `${id}-${p.id}`;
      input.min = String(p.log ? Math.log10(p.min) : p.min);
      input.max = String(p.log ? Math.log10(p.max) : p.max);
      input.step = p.log ? "0.001" : String(p.step ?? 0.05);
      input.setAttribute("aria-label", p.label);
      output.htmlFor = input.id;
      row.append(name, output, input);
      fields.append(row);
      rows.push({ p, input, output });
      input.addEventListener("input", () =>
        commit({
          ...get(),
          [p.id]: p.log ? 10 ** Number(input.value) : Number(input.value),
        }),
      );
    }
    const reset = document.createElement("button");
    reset.type = "button";
    reset.id = `${id}-reset`;
    reset.textContent = "Reset these defaults";
    reset.addEventListener("click", () => commit(defaults));
    fields.append(reset, status);
    section.append(summary, fields);
    document.querySelector("#physics-presets")?.before(section);
    refresh();
    status.textContent =
      "Independent browser preferences · changes save automatically";
  }
}
