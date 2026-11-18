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
  MAGNETISM_DEFAULTS,
  MAGNETISM_PARAMETERS,
  saveMagnetismSettings,
} from "../sandbox/AttackMagnetismSettings.js";

/** Small independent editors. SliderLocks observes new ranges automatically;
 * these controls never share the physics/aim/camera/layout storage keys. */
export class CombatPolishPanel {
  constructor({ effects, magnetism, animator, animation, storage }) {
    this.storage = storage;
    this.effects = effects;
    this.magnetism = magnetism;
    this.animator = animator;
    this.animation = sanitizeAnimationSettings(animation);
    animator.locomotion.aggression = this.animation.sprintAggression;
    if (new URLSearchParams(globalThis.location?.search).get("sandbox") !== "1")
      return;
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
      note: "Dust follows actual ground contacts and speed. The visual sonic barrier triggers once, then rearms below 80% of its speed threshold. No camera shake or sound.",
      toggle: ["sonicEnabled", "Sonic pressure wave enabled"],
      get: () => effects.config,
      apply: (values) => effects.configure(values),
      defaults: SPEED_EFFECT_DEFAULTS,
      save: saveSpeedEffectSettings,
    });
    this.addSection({
      id: "attack-magnetism",
      title: "Combat Attack Magnetism",
      parameters: MAGNETISM_PARAMETERS,
      note: "Optional short, collision-aware approach on a manual Combat strike. Off preserves the original movement and aim assist. Tag Mode never approaches runners. The captured strike uses one alignment correction, not stacked aim assists.",
      toggle: ["enabled", "Attack magnetism enabled"],
      get: () => magnetism.config,
      apply: (values) => magnetism.configure(values),
      defaults: MAGNETISM_DEFAULTS,
      save: saveMagnetismSettings,
    });
  }

  addSection({
    id,
    title,
    parameters,
    note,
    toggle,
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
    let checkbox;
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
      if (checkbox) checkbox.checked = values[toggle[0]];
    };
    const commit = (values) => {
      apply(values);
      refresh();
      status.textContent = save(this.storage, get())
        ? "Applied live · saved independently on this browser"
        : "Applied live · storage unavailable";
    };
    if (toggle) {
      const label = document.createElement("label");
      label.className = "aim-debug-label";
      checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.id = `${id}-${toggle[0]}`;
      label.append(checkbox, document.createTextNode(toggle[1]));
      fields.append(label);
      checkbox.addEventListener("change", () =>
        commit({ ...get(), [toggle[0]]: checkbox.checked }),
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
