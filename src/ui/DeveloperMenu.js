import {
  CATEGORIES,
  SETTING_CATALOG,
  SettingsRegistry,
  loadMenuPreferences,
  saveMenuPreferences,
} from "../sandbox/SettingsRegistry.js";
import { SandboxConfigurations } from "../sandbox/SandboxConfigurations.js";
import { SandboxSettingsAdapter } from "./SandboxSettingsAdapter.js";
const button = (id, text, action) => {
  const b = document.createElement("button");
  b.type = "button";
  b.id = id;
  b.textContent = text;
  if (action) b.addEventListener("click", action);
  return b;
};
const makeDetails = (id, title) => {
  const d = document.createElement("details");
  d.id = id;
  const s = document.createElement("summary");
  s.textContent = title;
  d.append(s);
  return d;
};
const SOURCE_CATEGORIES = {
  "physics-fields": "movement",
  "movement-abilities": "parkour",
  "strength-controls": "combat",
  "aim-assist-controls": "combat",
  "freeflow-combat": "combat",
  "enemy-reactions": "reactions",
  "enemy-settings": "enemies",
  "enemy-abilities": "enemies",
  "camera-settings": "camera",
  "tag-settings": "modes",
  "speed-effects": "visuals",
  "animation-polish": "visuals",
  "progression-testing": "movement",
};
/** One original live widget per setting. Search/Favourites move that widget
 * through anchored slots, preserving handler, value, context and slider lock. */
export class DeveloperMenu {
  constructor(game) {
    if (!game.physicsSandbox.enabled) return;
    this.game = game;
    this.panel = game.physicsSandbox.panel;
    this.scroll = this.panel.querySelector(".physics-scroll");
    this.storage = game.physicsSandbox.storage;
    this.registry = new SettingsRegistry();
    this.adapter = new SandboxSettingsAdapter(game);
    this.adapter.registry = this.registry;
    const preferences = loadMenuPreferences(this.storage);
    this.expanded = new Set(preferences.open);
    this.favourites = new Set(preferences.favourites);
    this.groups = new Map();
    this.rows = new Map();
    this.query = "";
    this.rendering = false;
    this.configurations = new SandboxConfigurations(this.storage);
    this.build();
    this.toolbarResize = new ResizeObserver(() => {
      const height = this.panel
        .querySelector(".developer-toolbar")
        .getBoundingClientRect().height;
      if (height > 0)
        this.scroll.style.setProperty(
          "--developer-toolbar-height",
          `${height}px`,
        );
    });
    this.toolbarResize.observe(this.panel.querySelector(".developer-toolbar"));
    this.scan(this.panel);
    this.restoreExpansion();
    this.render();
    this.panel.addEventListener(
      "toggle",
      (event) => {
        if (event.target.tagName !== "DETAILS") return;
        if (event.target.open) this.expanded.add(event.target.id);
        else this.expanded.delete(event.target.id);
        this.savePreferences();
      },
      true,
    );
    // Context changes must relock widgets even when Search/Favourites has
    // moved them away from the source editor that emits this event.
    this.panel.addEventListener("kinetic:relock-sliders", (event) => {
      for (const row of this.rows.values())
        if (event.target === this.panel || event.target.contains(row.anchor))
          for (const entry of row.entries) {
            const record = this.game.physicsSandbox.sliderLocks.records.get(
              entry.input,
            );
            if (record)
              this.game.physicsSandbox.sliderLocks.setLocked(record, true);
          }
    });
    this.observer = new MutationObserver((changes) => {
      let added = false;
      for (const change of changes)
        for (const node of change.addedNodes)
          if (node.nodeType === 1) added = this.scan(node) || added;
      let removed = false;
      for (const [id, entry] of this.registry.entries)
        if (!this.panel.contains(entry.input)) {
          this.registry.entries.delete(id);
          removed = true;
          entry.star?.remove();
          const r = this.rows.get(entry.row);
          if (r) {
            r.entries = r.entries.filter((e) => e.id !== id);
            if (!r.entries.length) {
              r.anchor.remove();
              r.link.remove();
              this.rows.delete(entry.row);
            }
          }
        }
      if (added) this.restoreExpansion();
      if (added || removed) this.render();
    });
    this.observer.observe(this.panel, { subtree: true, childList: true });
  }
  savePreferences() {
    const signature = JSON.stringify({
      open: [...this.expanded].sort(),
      favourites: [...this.favourites].sort(),
    });
    if (signature === this.savedPreferenceSignature) return;
    if (
      saveMenuPreferences(this.storage, {
        open: this.expanded,
        favourites: this.favourites,
      })
    )
      this.savedPreferenceSignature = signature;
  }
  build() {
    this.panel.querySelector("h2").textContent = "Developer sandbox";
    const oldIntro = [...this.scroll.children].filter(
      (n) => n.tagName === "P" && !n.id,
    );
    oldIntro.forEach((n) => n.remove());
    const toolbar = document.createElement("div");
    toolbar.className = "developer-toolbar";
    const search = document.createElement("input");
    search.id = "developer-search";
    search.type = "search";
    search.placeholder = "Search all settings";
    search.setAttribute("aria-label", "Search developer settings");
    search.autocomplete = "off";
    search.maxLength = 128;
    search.addEventListener("input", () => {
      this.query = search.value;
      this.render();
    });
    const navigation = document.createElement("div");
    navigation.className = "developer-actions";
    navigation.append(
      button("developer-expand-all", "Expand all", () => this.expandAll(true)),
      button("developer-collapse-all", "Collapse all", () =>
        this.expandAll(false),
      ),
    );
    toolbar.append(search, navigation);
    this.scroll.prepend(toolbar);
    this.status = document.createElement("p");
    this.status.id = "developer-menu-status";
    this.status.setAttribute("role", "status");
    toolbar.append(this.status);
    this.results = document.createElement("section");
    this.results.id = "developer-search-results";
    this.results.setAttribute("aria-label", "Matching developer settings");
    toolbar.after(this.results);
    this.favouritesSection = makeDetails(
      "developer-favourites",
      "★ Favourites",
    );
    this.favouritesSection.className = "developer-favourites";
    this.favouritesBody = document.createElement("div");
    this.favouritesSection.append(this.favouritesBody);
    this.results.after(this.favouritesSection);
    this.configurationSection = this.buildConfigurations();
    this.favouritesSection.after(this.configurationSection);
    this.categoryRoot = document.createElement("div");
    this.categoryRoot.id = "developer-categories";
    this.configurationSection.after(this.categoryRoot);
    for (const c of CATEGORIES) {
      const section = makeDetails(
        `developer-category-${c.id}`,
        `${c.icon}  ${c.name}`,
      );
      section.className = "developer-category";
      section.dataset.devCategory = c.id;
      const body = document.createElement("div");
      body.className = "developer-category-body";
      section.append(body);
      this.categoryRoot.append(section);
      this.groups.set(c.id, { section, body });
      body.append(
        button(`developer-reset-${c.id}`, "Reset category defaults", () => {
          if (
            !window.confirm(
              `Reset ${c.name} to defaults? Other categories, favourites and menu layout will be preserved.`,
            )
          )
            return;
          if (c.id === "interface") {
            this.game.physicsSandbox.setOpen(false);
            this.game.controlLayoutEditor.edit();
            this.game.controlLayoutEditor.reset();
            this.game.controlLayoutEditor.save();
            return;
          }
          this.adapter.resetCategory(c.id);
          this.status.textContent = `${c.name} defaults applied`;
          this.render();
        }),
      );
    }
    for (const [id, cat] of Object.entries(SOURCE_CATEGORIES)) {
      const source = document.getElementById(id);
      if (!source) continue;
      let container = source;
      if (source.tagName !== "DETAILS") {
        const titles = {
          "physics-fields": "Ground movement, jumping & air control",
          "strength-controls": "Attack Power & Impact",
          "aim-assist-controls": "Combat aim assist",
        };
        container = makeDetails(`developer-section-${id}`, titles[id] ?? id);
        container.append(source);
      }
      this.groups.get(cat).body.append(container);
    }
    const legacy = makeDetails(
      "developer-legacy-physics",
      "Physics presets & original Save / Load",
    );
    const note = document.createElement("p");
    note.textContent =
      "Original physics Save/Load/Reset includes movement, parkour and strength. Named builds above capture all sandbox categories.";
    legacy.append(note);
    for (const id of [
      "physics-presets",
      "physics-test-dash",
      "physics-status",
    ]) {
      const el = document.getElementById(id);
      if (el) legacy.append(el);
    }
    const actions = document.createElement("div");
    actions.className = "physics-storage";
    for (const id of ["physics-save", "physics-load", "physics-reset"])
      actions.append(document.getElementById(id));
    legacy.append(actions);
    this.groups.get("movement").body.append(legacy);
    const controls = this.groups.get("interface").body;
    const controlsNote = document.createElement("p");
    controlsNote.textContent =
      "Mobile layouts retain their existing Save, Cancel and Reset editor. Named builds preserve HUD layout and these menu preferences.";
    controls.append(
      controlsNote,
      button("developer-edit-controls", "Edit mobile controls", () => {
        this.game.physicsSandbox.setOpen(false);
        this.game.controlLayoutEditor.openSettings();
        document.querySelector("#edit-controls-button").click();
      }),
      button("developer-reset-view", "Reset View", () =>
        document.querySelector("#reset-camera").click(),
      ),
    );
    // Keep the existing exit link and original utility/status nodes accessible.
    for (const node of [...this.scroll.children])
      if (
        ![
          toolbar,
          this.results,
          this.favouritesSection,
          this.configurationSection,
          this.categoryRoot,
        ].includes(node) &&
        !node.id &&
        node.tagName !== "A" &&
        node.children.length === 0
      )
        node.remove();
    this.splitReactions();
  }
  splitReactions() {
    const source = document.querySelector("#enemy-reactions fieldset");
    if (!source) return;
    const specs = [
      [
        "presentation",
        "Standing reactions",
        [
          "intensity",
          "lightIntensity",
          "moderateIntensity",
          "heavyIntensity",
          "stagger",
        ],
      ],
      [
        "balance",
        "Balance & stability",
        [
          "balanceDamage",
          "balanceRecovery",
          "knockdownResistance",
          "standingRecovery",
          "mass",
          "resistance",
        ],
      ],
      [
        "flight",
        "Knockdowns, launch & ragdoll",
        ["knockdown", "ragdoll", "launch", "rotation", "ragdollEnabled"],
      ],
      [
        "recovery",
        "Ground recovery & environmental impacts",
        ["recovery", "collisionDamage"],
      ],
    ];
    for (const [id, title, keys] of specs) {
      const d = makeDetails(`developer-reaction-${id}`, title);
      for (const key of keys) {
        const input = document.getElementById(`enemy-reactions-${key}`);
        const row = input?.closest(".physics-row, .aim-debug-label");
        if (row) d.append(row);
      }
      source.querySelector("button")?.before(d);
    }
  }
  registerSetting(input, metadata = {}) {
    if (
      !this.panel.contains(input) ||
      !input.id ||
      this.registry.entries.has(input.id) ||
      input.closest(".developer-toolbar, #developer-configurations")
    )
      return false;
    if (!["range", "checkbox", "select-one", "number"].includes(input.type))
      return false;
    const definition = {
      ...(SETTING_CATALOG.get(input.id) ?? {}),
      ...metadata,
    };
    const closest = input.closest("[data-dev-category]");
    const category =
      definition.category ?? closest?.dataset.devCategory ?? "interface";
    const name =
      definition.name ?? input.getAttribute("aria-label") ?? input.id;
    let row =
      input.closest(".physics-row, .aim-debug-label, .mode-picker") ??
      input.parentElement;
    if (!row || row === this.panel) return false;
    if (!closest) this.groups.get(category).body.append(row);
    const path = [];
    for (let p = row.parentElement; p && p !== this.scroll; p = p.parentElement)
      if (p.tagName === "DETAILS")
        path.unshift(
          p.querySelector(":scope > summary")?.textContent.trim() ?? "",
        );
    const family = definition.family ?? "extras";
    const scale = input.id === "aim-strength" ? 100 : 1;
    if (input.type === "range" || input.type === "number") {
      definition.min ??= Number(input.min || 0);
      definition.max ??= Number(input.max || 100);
      definition.step ??= Number(input.step || 1);
    }
    const read = () =>
      input.type === "checkbox"
        ? input.checked
        : input.tagName === "SELECT"
          ? input.value
          : definition.log
            ? 10 ** Number(input.value)
            : Number(input.value) / scale;
    const write = (value) => {
      if (input.type === "checkbox") input.checked = !!value;
      else if (input.tagName === "SELECT") {
        if (![...input.options].some((x) => x.value === value)) return;
        input.value = value;
      } else {
        if (!Number.isFinite(value)) return;
        const n = Math.max(
          definition.min ?? -Infinity,
          Math.min(definition.max ?? Infinity, value),
        );
        input.value = String(
          definition.log
            ? Math.log10(Math.max(Number.MIN_VALUE, n))
            : n * scale,
        );
      }
      input.dispatchEvent(
        new Event(
          input.type === "checkbox" || input.tagName === "SELECT"
            ? "change"
            : "input",
          { bubbles: true },
        ),
      );
    };
    const entry = this.registry.register({
      ...definition,
      id: input.id,
      name,
      category,
      family,
      type: input.type,
      default: definition.default ?? read(),
      path: path.join(" / ") || CATEGORIES.find((c) => c.id === category).name,
      input,
      row,
      read,
      write,
    });
    let record = this.rows.get(row);
    if (!record) {
      const anchor = document.createComment(`setting-slot:${entry.id}`);
      row.before(anchor);
      const link = button(
        `developer-link-${entry.id}`,
        `${name} · in Favourites ↗`,
        () => {
          this.favouritesSection.open = true;
          row.scrollIntoView({ block: "nearest" });
        },
      );
      link.className = "developer-setting-link";
      link.hidden = true;
      anchor.after(link);
      const tools = document.createElement("div");
      tools.className = "developer-setting-tools";
      row.append(tools);
      record = {
        row,
        anchor,
        link,
        tools,
        entries: [],
        originalCategory: category,
      };
      this.rows.set(row, record);
    }
    record.entries.push(entry);
    const star = button(`developer-favourite-${entry.id}`, "☆", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (this.favourites.has(entry.id)) this.favourites.delete(entry.id);
      else this.favourites.add(entry.id);
      this.savePreferences();
      this.render();
    });
    star.className = "developer-star";
    star.dataset.favourite = entry.id;
    record.tools.append(star);
    entry.star = star;
    return true;
  }
  scan(root) {
    let changed = false;
    const inputs = root.matches?.("input,select")
      ? [root]
      : [...(root.querySelectorAll?.("input,select") ?? [])];
    for (const input of inputs)
      changed = this.registerSetting(input) || changed;
    return changed;
  }
  restoreExpansion() {
    for (const d of this.panel.querySelectorAll("details[id]")) {
      const open = this.expanded.has(d.id);
      if (d.open !== open) d.open = open;
    }
  }
  expandAll(open) {
    for (const d of this.panel.querySelectorAll("details[id]"))
      if (d.open !== open) d.open = open;
    this.expanded = new Set(
      open
        ? [...this.panel.querySelectorAll("details[id]")].map((d) => d.id)
        : [],
    );
    this.savePreferences();
  }
  render() {
    if (this.rendering) return;
    this.rendering = true;
    try {
      // Restore actual widgets before constructing the next presentation. Slot
      // comments remain under their original category even while widgets move.
      for (const r of this.rows.values()) {
        r.anchor.after(r.row);
        r.link.hidden = true;
      }
      this.results.replaceChildren();
      this.favouritesBody.replaceChildren();
      const query = this.query.trim(),
        matches = new Set(this.registry.search(query).map((e) => e.id));
      this.panel.classList.toggle("developer-searching", !!query);
      let count = 0,
        favs = 0;
      const contexts = new Set();
      const addContext = (row) => {
        for (const e of this.registry.entries.values())
          if (e.context && e.category === row.originalCategory)
            contexts.add(e.row);
      };
      for (const r of this.rows.values()) {
        const matching = !!query && r.entries.some((e) => matches.has(e.id));
        const favourite = r.entries.some((e) => this.favourites.has(e.id));
        for (const e of r.entries) {
          const active = this.favourites.has(e.id);
          e.star.textContent = active ? "★" : "☆";
          e.star.setAttribute("aria-pressed", String(active));
          e.star.setAttribute(
            "aria-label",
            `${active ? "Remove" : "Add"} ${e.name} ${active ? "from" : "to"} Favourites`,
          );
        }
        if (matching || (!query && favourite)) {
          const wrapper = document.createElement("div");
          wrapper.className = "developer-setting-result";
          const path = document.createElement("p");
          path.className = "developer-setting-path";
          path.textContent = r.entries[0].path;
          wrapper.append(path, r.row);
          (query ? this.results : this.favouritesBody).append(wrapper);
          r.link.hidden = false;
          if (matching) count++;
          else favs++;
          addContext(r);
        }
      }
      for (const row of contexts) {
        const r = this.rows.get(row);
        if (
          !r ||
          r.entries.some((e) => this.favourites.has(e.id)) ||
          (query && r.entries.some((e) => matches.has(e.id)))
        )
          continue;
        const target = query ? this.results : this.favouritesBody;
        target.prepend(row);
        r.link.hidden = false;
      }
      if (!query && !favs) {
        const p = document.createElement("p");
        p.textContent = "Tap ☆ beside a setting to keep it here.";
        this.favouritesBody.append(p);
      }
      this.status.textContent = query
        ? `${count} matching controls`
        : `${this.registry.entries.size} settings · each slider has its own lock`;
    } finally {
      this.rendering = false;
    }
  }
  buildConfigurations() {
    const section = makeDetails(
      "developer-configurations",
      "▣ Named sandbox configurations",
    );
    const note = document.createElement("p");
    note.textContent =
      "Captures all gameplay tuning, both mode rosters/cameras and every archetype. Preserves menu layout, favourites, HUD and individual locks. Original presets and Save/Load remain available.";
    const select = document.createElement("select");
    select.id = "developer-build-select";
    select.setAttribute("aria-label", "Saved sandbox configuration");
    const name = document.createElement("input");
    name.id = "developer-build-name";
    name.type = "text";
    name.maxLength = 64;
    name.placeholder = "Configuration name";
    name.setAttribute("aria-label", "Configuration name");
    const status = document.createElement("p");
    status.id = "developer-build-status";
    status.setAttribute("role", "status");
    const actions = document.createElement("div");
    actions.className = "developer-actions";
    const refresh = (id) => {
      select.replaceChildren();
      const empty = document.createElement("option");
      empty.value = "";
      empty.textContent = "Choose a saved build";
      select.append(empty);
      for (const item of this.configurations.items) {
        const o = document.createElement("option");
        o.value = item.id;
        o.textContent = item.name;
        select.append(o);
      }
      if (id) select.value = id;
    };
    const run = (fn) => {
      try {
        const id = fn();
        if (id) refresh(id);
        status.textContent = this.configurations.lastSaveSucceeded
          ? "Configuration updated locally"
          : "Applied for this session; browser storage unavailable";
      } catch (error) {
        status.textContent = error.message;
      }
    };
    select.addEventListener("change", () => {
      name.value = select.value
        ? this.configurations.get(select.value).name
        : "";
    });
    actions.append(
      button("developer-build-save", "Save new", () =>
        run(() => this.configurations.save(name.value, this.adapter.capture())),
      ),
      button("developer-build-load", "Load selected", () =>
        run(() => {
          this.adapter.apply(this.configurations.load(select.value));
          this.render();
          return select.value;
        }),
      ),
      button("developer-build-overwrite", "Overwrite selected", () => {
        try {
          const item = this.configurations.get(select.value);
          if (
            window.confirm(
              `Overwrite “${item.name}” with the current sandbox settings?`,
            )
          )
            run(() => {
              this.configurations.overwrite(item.id, this.adapter.capture());
              return item.id;
            });
        } catch (error) {
          status.textContent = error.message;
        }
      }),
      button("developer-build-rename", "Rename", () =>
        run(() => {
          this.configurations.rename(select.value, name.value);
          return select.value;
        }),
      ),
      button("developer-build-duplicate", "Duplicate", () =>
        run(() => {
          const item = this.configurations.get(select.value);
          return this.configurations.duplicate(
            item.id,
            name.value && name.value !== item.name
              ? name.value
              : `${item.name} copy`,
          );
        }),
      ),
      button("developer-build-delete", "Delete selected", () => {
        try {
          const item = this.configurations.get(select.value);
          if (window.confirm(`Delete saved configuration “${item.name}”?`))
            run(() => {
              this.configurations.delete(item.id);
              refresh();
              return null;
            });
        } catch (error) {
          status.textContent = error.message;
        }
      }),
    );
    section.append(note, select, name, actions, status);
    refresh();
    return section;
  }
}
