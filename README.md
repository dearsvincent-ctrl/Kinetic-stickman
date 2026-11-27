# Kinetic — Movement Lab v0.9.1

A mobile-first Three.js/Vite stickman prototype. Version 0.9.1 adds graduated standing hit reactions and independent accumulated balance, plus a hierarchical developer workbench with search, favourites and named local builds. It preserves bounded ballistic launches, angular ragdoll joints and alive recovery. It retains the v0.8.9 separation of ground speed, air acceleration/braking, agility and supported wall movement, eliminating speed-driven wall launches. It preserves attack-driven freeflow approaches, directional target switching, ground/aerial combinations and bicycle kicks. Sonic barriers now create layered expanding pressure fronts, radial dust, speed streaks and brief camera impact. Combat-only near misses and direct high-speed collisions stagger or displace enemies without adding contact damage. **Manual, Assisted and Dynamic camera modes**, optional dynamic field of view and independently saved Combat/Tag camera profiles remain available. The default retains the existing 52° manual view. Configurable Standard/Acrobat/Leaper/Heavy enemies, ability-aware traversal and individual developer slider locks remain available. **Tag Mode** retains fleeing AI, swept contact tags, counters and delayed respawning. **Combat Mode** retains pursuit, manual Punch/Kick, health, damage, waves, aim assistance and strength tuning. The 2,000 × 2,000 city/jungle playground, player parkour, directional double jumps, analogue locomotion and custom mobile HUD remain available in both modes. Enemy route planning is local and bounded.

## Combat reaction refinement (v0.9.1)

Health, displacement and balance have separate owners. The v0.9.0 direct `force / balance >= knockdown` cutoff was the reason moderate impulses abruptly made enemies fall. There were only recoil/stumble standing poses, and get-up speed also shortened standing responses. v0.9.1 removes that direct cutoff and separates standing recovery from getting up.

Light hits recoil locally; moderate and heavy hits bend/rotate the torso and make directional recovery steps while the enemy remains a valid Freeflow target. Standing intensity blends continuously with force and instability. The step phase, joint spring state and displacement persist across successive punches and kicks. Standing head/torso contact spheres follow the presented pose, including pelvis offsets; weapon reach remains unchanged.

Each enemy accumulates internal instability independently of health. Strike type/location, lateral direction, posture, relative momentum, mass and profile balance influence wear. A quiet interval of 0.5 s permits natural balance recovery. Completing a genuine get-up restores usable footing, so a surviving enemy is not immediately tripped by the next light hit. There is no scripted hit count: repeated ordinary impacts can eventually exhaust footing; an extreme single impulse can do so immediately. Knockback is not multiplied into health or treated as an unconditional fall trigger. The old Knockdown threshold now supplies a stability reference, with a wide standing band; it, Stagger threshold and Ragdoll threshold are independent. Ragdoll only activates after genuine loss of footing and its own threshold.

Open **DEV → Hit Reactions & Physics → Enemy Hit Reactions / Hybrid Ragdoll**. Existing names/ranges/defaults remain. New controls are **Light reaction intensity**, **Moderate reaction intensity**, **Heavy stagger intensity**, **Balance damage**, **Balance recovery speed**, **Knockdown resistance** and **Standing recovery strength**. **Recovery speed** remains ground get-up speed. Launch/rotation/mass/resistance, selective ragdoll and optional environmental damage remain. Collision damage starts at **0×**. Old `kinetic.enemy-reactions.v1` saves retain their values and gain defaults for new fields.

Try **Attack Power = 0×**, **Impact = 4×** and Punch → Kick → Punch against a live enemy: it should stay available for follow-ups and regain balance after a pause. **Impact = 20×** Kick can still launch immediately. High knockdown resistance permits substantial standing displacement independently of visual intensity. Mass and balance remain archetype data. Tag Mode never accumulates combat instability.

The existing hybrid remains lightweight: fixed bone lengths, constrained angular springs, bounded ballistic movement and swept body/world collision. Detailed angular simulation covers eight nearby impacted enemies; distant enemies use coarse presentation/collision. Per-bone rigid-body environmental contacts and physical collisions between launched enemies are not implemented. Extreme standing displacement can exceed human-length foot planting; recovery steps remain bounded visual approximations. Physical Android performance and animation feel need phone playtesting.

## Developer workbench (v0.9.1)

Open **https://dearsvincent-ctrl.github.io/Kinetic-stickman/?sandbox=1&v=0.9.1** and tap **DEV**. Nine compact categories organise the existing inventory: Player Movement; Parkour & Traversal; Combat & Freeflow; Hit Reactions & Physics; Enemies & AI; Camera & Field of View; Game Modes; Visual Effects; Controls & Interface. Subcategories retain the original editors. Physics presets/legacy Save/Load/Reset are under Player Movement; advanced agility/air/wall controls share Parkour's existing Movement Abilities editor.

**Expand all / Collapse all** and individual category/subcategory expansion persist independently. Search matches partial names/paths/IDs across categories and displays the original adjustable controls with their category paths. Clearing search restores the previous expansion layout. Tap **☆** to add a control to **Favourites**. A favourite uses the same actual widget, not a second range; its original category contains a shortcut. Contextual enemy/camera editors keep their profile selector available. Values, handlers and individual locks are shared across all presentations. Every menu reopen locks all ranges; vertical swipes scroll even when a slider is unlocked. A deliberate horizontal gesture adjusts only that unlocked slider.

Every category reset asks for confirmation and touches only that category's gameplay parameters. It preserves favourites, expansion preferences and unrelated settings. Controls & Interface uses the existing layout editor to restore/save its default HUD layout after confirmation. The original global physics reset and independent editor resets remain available.

**Named sandbox configurations** save current gameplay tuning across physics, damage/impact, aim, reactions, effects, Freeflow, both camera profiles, all enemy archetypes and both mode rosters. Enter any name and **Save new**; select a saved build and **Load selected**. Rename, duplicate and delete are available. Duplicate names are rejected: replacing an existing slot requires **Overwrite selected** and confirmation. Delete also requires confirmation. Builds load on request; after refresh, use Load to restore an experimental build. They do not overwrite legacy manual physics/aim/enemy/Tag save files, change the current game mode, unlock sliders, or replace the HUD layout/menu preferences. Camera/effects/reaction edits retain their existing autosave behaviour.

Storage is versioned under `kinetic.sandbox-configurations.v1` and `kinetic.developer-menu.v1`. Missing new settings receive safe defaults; invalid slots are skipped individually; unsupported versions are not applied. Original presets and existing separate saves remain compatible. Blocked/quota-limited storage reports session-only availability. Up to 64 named builds are retained.

`SettingsRegistry.js` contains stable IDs, names, categories, defaults, ranges, types and persistence metadata. `DeveloperMenu.js` binds those definitions to existing controls; no game-state query or interface rendering runs each frame. `SandboxSettingsAdapter.js` captures/applies through existing gameplay owners, and `SandboxConfigurations.js` validates independent named snapshots. Future editors should register their stable widget with a valid category through the registry/menu; dynamically added fields are also discovered, locked and placed in their containing category (or Controls & Interface fallback).

## Movement abilities and controlled parkour (v0.8.9)

Ground speed no longer supplies airborne propulsion, vertical wall-contact velocity, climb speed, wall-jump impulse or automatic outward detachment force. Surface contact dissipates the incoming normal component and retains a bounded tangent component. Roofs use continuous ledge/mantle transitions instead of automatic high-speed crest launches. Jump strength and gravity still determine the two equal vertical launches.

In **DEV → Movement Abilities / Advanced Parkour**, tune Ground acceleration, Agility, Air acceleration, Air braking, Wall adhesion, Wall traversal speed, Wall-jump impulse and Landing stability. Reuse **Movement speed**, **Jump height** and **Air steering / control** above; there are no duplicate sliders. Every slider has an individual lock. These multipliers are included in physics Save/Load/Reset under the existing version-1 key; old saves keep their original values and default new fields to 1×.

Air steering changes directional response, while acceleration and braking bound velocity changes in metres/second². Inherited speed is never clamped at takeoff. Additional propulsion is limited relative to baseline aerial speed and the acceleration ability, independently of running speed; steering cannot grow that inherited speed indefinitely. Neutral input uses drag with separately configurable braking. Agility uses a bounded square-root response curve for steering, recovery and parkour transitions; it does not multiply jump height or gravity. Ground acceleration tunes the ground velocity-response rate. Landing stability tunes braking during physical landing without locking controls.

Wall traversal scales supported climb/descent/tangent speeds. Wall adhesion closes only the existing small attachment gap through swept movement. Wall-jump strength affects only explicit Jump launches; detachment and rooftop transitions do not borrow running speed. Enemy traversal retains its own profile's climb and wall-running speed, independent of player sandbox values.

Editable development presets: **Balanced** retains normal movement; **Speedster** selects 100× running with modest jumps and limited air redirection; **Acrobat** raises agility, air control and wall traversal; **Superhuman Leaper** combines 50× jump height with strong deliberate aerial control. They are tuning examples, not character classes. Existing Normal/Enhanced/Extreme presets remain available.

Root causes fixed: wall impact speed was copied into vertical velocity; climb, descent, tangent, wall-jump and detach velocities read sprint speed; the air controller chased the ground-speed target with exponential acceleration proportional to velocity error; aerial-dash exit tuning also inherited the ground-speed multiplier. Swept world collision remains authoritative. Parkour uses bounded adaptive surface steps, and air acceleration uses an analytic linear-to-exponential integration to avoid frame-rate-dependent impulse accumulation. Freeflow remains a separate attack-driven motion owner.


## Play on Android

Open **https://dearsvincent-ctrl.github.io/Kinetic-stickman/?v=0.8.9** in Android Chrome. No computer, installation or local build is needed. Refresh until the header shows **0.9.1**. Landscape gives the controls more space; portrait is supported.

| Action            | Touch                                                       | Desktop                            |
| ----------------- | ----------------------------------------------------------- | ---------------------------------- |
| Move / sprint     | Extend MOVE progressively: slow walk → jog → run → sprint   | WASD/arrows; Shift for full sprint |
| Punch             | Tap once; hold to repeat after full recovery                | Tap / hold F                       |
| Kick              | Tap once; hold to repeat after full recovery                | Tap / hold G                       |
| Block             | Hold; takes priority over attacks                           | Hold Q                             |
| Jump              | Tap/slide onto JUMP; press again in the air                 | Space                              |
| Camera            | Drag on the right side                                      | Mouse drag on the right            |
| Reset View        | Small top-right RESET VIEW button                           | R                                  |
| Game mode         | MODE selector in the top-left status readout                | Same                               |
| Edit Controls     | Settings → Edit Controls                                    | Same                               |
| Developer physics | Settings → Developer tools → Open physics sandbox, then DEV | Same                               |

Punch and Kick can start **without an opponent**. Punch develops from straight to cross/hook with recent input and posture; Kick can branch into front, roundhouse, side, spinning or low-sweep techniques. Airborne inputs retain aerial punches and flying kicks. Approach the orange dummy and time the strike so its active hitbox actually intersects the body. The dummy's marker briefly flashes green and the readout says **CONTACT** for a confirmed contact. This is a contact signal, not damage or a hit reaction.

Sliding between **Punch, Kick, Block and Jump** uses the same central action router after repositioning controls. Each entry onto Punch/Kick requests one strike. Holding repeats only after the previous technique recovers. The most recently entered held attack takes priority if two attack fingers are down; releasing it allows the other held attack to resume. Brief taps never become held repeats. Fresh taps can redirect a normal strike during recovery, or continue a rotating strike after its short commitment window. Held repeats still wait for full recovery. Requests rejected during commitment are discarded; there is no combo queue. Releasing a button finishes the current strike/recovery and stops repeats. Block cancels an active strike into recovery and suppresses new attacks while held.

**Freeflow starts enabled in Combat Mode.** Each accepted manual Punch/Kick can select a reachable enemy and rapidly move through collision-resolved space to a natural contact position. Joystick direction has the strongest influence on selection; fresh inputs can redirect an unfinished approach. Held attacks still wait for full recovery. Block, deliberate steering away, Jump, dash, wall attachment, loss of a target or a blocked path cancel the approach. No attack begins merely because an enemy is nearby. Disable Freeflow in DEV to restore manual locomotion and the existing aim assist. Tag Mode never uses attack-driven approaches.

**Dash is removed from the normal HUD, keyboard bindings and layout editor.** Its physical ground/aerial implementations remain in the code for future movement abilities. Developer mode retains E and a **Test preserved dash** utility inside the physics panel, so its existing dash sliders remain testable on a phone. Dash still moves continuously, steers, collides, permits ground-dash-to-jump transitions and tracks its aerial allowance independently.

## Freeflow and superhuman impact (v0.9.0)

Open **https://dearsvincent-ctrl.github.io/Kinetic-stickman/?sandbox=1&v=0.8.9**, tap **DEV**, then expand **Freeflow Combat**, **Superhuman Speed Effects** or **Animation Presentation**. Every range retains its own lock and vertical scrolling. Preferences save independently and load in ordinary play. Reset affects only its section; camera, physics, enemy, aim and HUD settings remain separate.

Freeflow defaults to a **14 m** ground acquisition radius, **12 m** aerial radius, **18 m** maximum physical approach, **80 m/s** speed and **600 m/s²** acceleration. Range, budget, approach speed/acceleration, alignment, directional bias, switching responsiveness and aerial assistance are configurable. Aerial assistance adjusts vertical reach and lift; horizontal ground/air approaches share the speed and acceleration controls. These are movement assists, not larger hitboxes. The controller retains continuous world/body collision, jump counts and gravity. An unreachable target is rejected, and failed approaches cancel rather than hitting through geometry. Disabling Freeflow restores manual movement and aim assistance; v0.8.7 magnetism saves remain untouched but are superseded by the independent `kinetic.freeflow.v1` settings.

Punch/Kick chains retain their bounded contextual history instead of a fixed combo queue. Ground/air transitions retain compatible history. An aerial Punch followed by an eligible Kick can select a bicycle kick; isolated aerial Kicks retain the flying kick. The same authored, natural-reach limb geometry drives visible joints and swept contacts. A held repeat waits for full recovery; a fresh input can branch from recovery or redirect an approach. Block always takes priority.

Dust retains actual foot-contact emission, directional trails, acceleration/turn response and landing bursts. The sonic barrier still triggers once when actual speed crosses its threshold, then rearms below **80%**. A layered expanding pressure front briefly travels with the fighter before dissipating, accompanied by radial ground dust and directional streaks. The bounded pools use at most 64 dust puffs, two wave events and twelve streaks. No third-party sound, full-screen distortion or flashing is added.

| Control | Default | Range |
| --- | --- | --- |
| Dust activation | 8 m/s | 1–1000 m/s |
| Dust intensity / density | 1× / 1× | 0–3× / 0–2× |
| Sonic activation | 40 m/s | 5–1200 m/s |
| Sonic visual intensity | 1× | 0–3× |
| Shockwave size | 18 m | 2–100 m |
| Camera impact | Enabled, 0.8×, 0.22 s | Off, 0–2×, 0.05–0.65 s |
| Combat near-miss stagger | Enabled, 2.4 m, 20 m/s | Off, 0.7–12 m, 5–1000 m/s |
| Direct impact strength / speed | 1× / 25 m/s | 0–20× / 5–1200 m/s |

Speed reactions add **no health damage**. Combat-only near misses briefly unbalance enemies; direct swept collisions and a sonic pressure front can apply stronger collision-resolved impulses. Existing Impact/Knockback strength and enemy resistance scale the force. Per-enemy cooldowns prevent repeated reactions every frame, and walls block the effect. The current freeflow target is excluded so the pressure effect cannot steal the strike's contact. Tag Mode retains ordinary contact tags, fleeing and respawns without combat stagger/knockback.

Camera impact is short, bounded and additive to the rendered view. It does not change the manual orbit anchor, touch input, FOV preferences or camera mode, and returns exactly to zero. It can be disabled independently.

Animation asset research remains in [docs/ANIMATION_ASSETS.md](docs/ANIMATION_ASSETS.md). The procedural stickman style and original lightweight effects remain; no external animation or sound assets are bundled.

## Camera profiles and assistance (v0.8.6)

Open **https://dearsvincent-ctrl.github.io/Kinetic-stickman/?sandbox=1&v=0.8.9**, tap **DEV**, then expand **Camera Settings**. Choose the Combat or Tag profile to edit; changing that selector displays its saved controls without changing the gameplay mode. The top-left MODE selector applies the matching camera profile and updates the editor. Changes apply live to the active gameplay profile and save automatically on this browser. Camera preferences also reload in ordinary play, where the developer editor stays hidden.

**Manual** retains direct orbit control and the existing low-angle view: 52° base FOV, 4.8 m follow distance and 0.23-radian pitch. **Assisted** subtly reframes relevant visible actors; **Dynamic** allows a wider correction. Both stay within bounded angles around the manually chosen view, reject actors behind that view and hold a context briefly to reduce rapid switching. Solid structures block context selection. Dragging the right side always gives manual camera control; assistance waits for the configured override delay after the drag ends, then resumes gradually. Dynamic FOV is a separate checkbox, off by default, that responds to smoothed three-dimensional movement speed in any camera mode. Its maximum is always at least the base FOV. Reset View remains available.

| Camera control                | Default | Range                       |
| ----------------------------- | ------- | --------------------------- |
| Base field of view            | 52°     | 50°–120°                    |
| Maximum dynamic FOV           | 105°    | 50°–120°, at least base FOV |
| Dynamic FOV speed sensitivity | 1×      | 0.1×–4×                     |
| FOV transition smoothness     | 0.35 s  | 0.05–3 s                    |
| Camera awareness              | 90 m    | 2–2000 m                    |
| Assistance strength           | 0.35    | 0–1                         |
| Manual override delay         | 1.25 s  | 0–5 s                       |

Sensitivity controls how strongly movement speed widens dynamic FOV. Smoothness sets the FOV transition response time. Right-side orbit dragging keeps its existing sensitivity. Automatic visual framing offsets do not steer the character; the manual orbit anchor remains the movement reference. Awareness bounds camera context queries; it never changes enemy detection, pursuit, evasion, player movement, attacks, aim assistance or hit reach. **Reset this camera profile** restores only the selected Combat or Tag camera defaults. Saves use `kinetic.camera-settings.v1`; physics, aim, enemy, Tag and HUD keys stay independent. Corrupt or unsupported camera saves fall back safely; blocked storage keeps changes live for the current session.

Every camera range uses the existing individual slider lock. Opening DEV or Camera Settings relocks them; switching the edited profile or the gameplay mode relocks the camera ranges too. Unlock one range, drag horizontally to adjust, and swipe vertically to scroll while other fingers retain movement/action/camera ownership.

For the Android playtest, first check the unchanged Manual default. Compare Assisted and Dynamic while running, double jumping and moving among elevated enemies in Combat/Tag; drag the view during assistance, wait for the override delay, and check Reset View near buildings. Try dynamic FOV at ordinary and extreme speeds, independent Combat/Tag values, save/refresh, and reset one profile while retaining the other. Repeat in portrait and landscape. Camera assistance cannot guarantee that every actor or route stays visible around dense structures; use manual orbit when needed. Physical-device performance remains for your playtest.

## Enemy profiles and selection (v0.8.5)

Open **https://dearsvincent-ctrl.github.io/Kinetic-stickman/?sandbox=1&v=0.8.9**, tap **DEV**, then expand **Enemy Settings** for the Combat roster or **Tag Mode** for the fleeing roster. The two rosters are independent. Ordinary waves and Tag population controls remain the default: **Use custom archetype group** starts off. Enable it, choose the types and set their counts to make a mixed group or a single-type encounter. Editing a type/count also enables its custom group. Uncheck the custom-group option to return to the original controls.

| Archetype | Base running speed | Jump height / allowance | Distinct abilities                                                                   |
| --------- | ------------------ | ----------------------- | ------------------------------------------------------------------------------------ |
| Standard  | 3.6 m/s            | 0.8 m / one jump        | Ordinary ground pursuit and low jumps; no advanced wall abilities                    |
| Acrobat   | 5.4 m/s            | 2 m / two jumps         | Faster turns, strong air steering, wall running/climbing, ledges and roofs           |
| Leaper    | 14 m/s             | 80 m / two jumps        | Explosive acceleration, powerful air steering, long physical leaps and fast climbing |
| Heavy     | 2.6 m/s            | 3 m / one jump          | Less frequent jumps, 1.8× attack damage and 4× knockback resistance                  |

The **Enemy Abilities** section edits one selected archetype. Running speed, acceleration, braking, turning, jump height/count, air steering, aerial manoeuvrability, climbing speed, jump interval, damage and knockback resistance are independent profile values. Wall running, climbing, ledge grabbing and rooftop traversal have separate capability checkboxes. Colours distinguish the simple stickmen; no detailed character models are added. **Reset this profile** or **Reset all profiles** restores ability defaults without clearing rosters or saved global settings.

Global pursuit speed in Combat, or Escape Speed in Tag, multiplies the profile's base running speed. That mode's acceleration slider multiplies both acceleration and deceleration response. Combat also retains its existing modest wave speed scaling. Turning uses the profile baseline plus bounded compensation for higher global speeds. Combined running speed has a finite 8,000 m/s integration guard; saved values are not rewritten to reach it. Jump height/count and air control come from the enemy profile, never the player's physics sandbox. Launch velocity is `sqrt(2 × 18 × profile jump height)`, with continuous gravity/collision and the same launch strength for each permitted jump. Climbing speed is a profile baseline: the shared traversal controller can retain faster running momentum, with its existing bounded wall speeds. Enemy damage scales the existing wave attack damage; resistance divides incoming knockback. Player Attack Power/Impact and attack reach remain separate.

The existing **Maximum active enemies** or **Fleeing characters** slider is still the mode's population cap. The roster readout shows requested versus allowed counts; it never changes those global saved values silently. If a request exceeds the cap, enabled types share slots in a stable rotation. Raise the global cap to use the full request. An empty custom group pauses that encounter; selecting a type resumes it. Combat waves continue with the selected composition and existing health/difficulty progression. Tagged characters keep their selected type when they respawn.

Profiles and custom rosters remain live across mode switches. Named sandbox configurations now capture them; load a named build explicitly after refresh. Existing independent physics, aim, pursuit, Tag and HUD saves remain compatible. Builds store validated data, never controllers or animation state.

Capable enemies use local ability-aware surface queries to choose reachable roofs, climbable walls, ledges, jungle columns and nearby platform transfers. They reuse the player's collision-supported traversal and ballistic jumps, with AI steering decisions separate from player input. Unsupported capabilities stay disabled. There is no teleporting to roofs, hidden jump-strength inheritance from the player, or global route search every frame. Dense multi-obstacle mazes, distant roofs and awkward elevated routes may remain unreachable; failed/stalled choices are cooled down so the actor can recover instead of retrying one impossible jump continuously. Start with 3–8 enemies on Android; mixed groups above 16 remain experimental, with a hard pool cap of 64.

For the Android playtest, select **Leaper only** in Tag Mode, raise the Tag population cap if needed, and chase near city roofs and jungle columns. Compare Standard/Acrobat/Heavy, mix types in Combat, stand on a roof to test vertical pursuit, and confirm manual Punch/Kick, Block, tags, counters, respawns and waves still work while actors are airborne or attached to walls. Change the player's jump slider and confirm enemy launch strength stays independent; then edit Leaper jump height and compare its next launch. Check ordinary and extreme global multipliers, failed landings, wall jumps and roof-to-roof transfers. Detection and disengagement still measure three-dimensional distance; raise them for long chases up exceptionally tall structures. Physical-device performance remains for your playtest.

## Safe individual slider adjustment (v0.8.5)

Every developer range has its **own lock icon**. Sliders start locked when DEV or their nested settings section opens. Tap a slider's lock to unlock only that slider; its neighbours remain locked. Tap again to lock it. Locking never resets its value, and Save/Load/presets/Reset still apply their chosen values normally. Closing and reopening DEV or a nested section relocks its sliders. Selecting a different enemy archetype also relocks the ability editor.

Swipe vertically over a locked slider to scroll safely. An unlocked slider also preserves vertical scrolling: a clear horizontal drag, after a small direction threshold, adjusts relative to its current value; a tap does not jump the value. Other fingers can retain joystick, camera and action control. Mouse dragging works after unlocking; desktop keyboard users can focus an unlocked range and use its arrow keys. The lock buttons are separate touch targets, not a global unlock switch. The same reusable control wraps existing player physics, jump, aim, strength, pursuit, Tag, camera, roster-count and ability ranges, including future ranges added to the developer panel.

## Tag Mode and AI evasion (v0.8.4)

Use the **MODE** selector in the top-left status readout to choose **Combat Mode** or **Tag Mode**. Combat remains the default. Switching starts a clean encounter for the selected mode without overwriting saved Combat Mode, aim, strength, player physics or control-layout preferences. The selector is a utility control; movable Punch, Kick, Jump and Block buttons keep their positions and slide-to-activate behaviour.

In Tag Mode, approach and chase the fleeing stickmen. No attack button is required: physically reach a runner inside the configured tag radius. Contact is tested continuously along the player/runner movement paths, with solid structures blocking tags. Successful tags show **TAG +1**, increase **TAGS**, temporarily remove the tagged runner and respawn it after a short delay at a free ground-level position away from the player. The compact status readout shows active runners, total tags and elapsed session time. **RESET** restarts the tag session. Runners never attack or damage the player in this mode.

Open the developer sandbox, tap **DEV**, then expand **Tag Mode**:

| Escape control          | Default                    | Range               |
| ----------------------- | -------------------------- | ------------------- |
| Escape Speed Multiplier | 1× enemy movement baseline | 0.25×–100×          |
| Escape Acceleration     | 1×                         | 0.1×–100×           |
| Evasion Intelligence    | Medium                     | Low / Medium / High |
| Enemy Count             | 3                          | 1–64                |
| Detection Distance      | 60 m                       | 2–4000 m            |
| Tag Radius              | 0.85 m                     | 0.75–3 m            |

Speed and acceleration apply independently and live, without changing the player's acceleration. Low uses direct fleeing with collision safety; Medium evaluates clear directions around obstacles; High also predicts the player's approach and scores escape routes. Decision hysteresis reduces constant side-switching. Escaping remains collision-resolved physical movement, not teleportation. Tag Radius controls the actual contact threshold; increasing movement speed never secretly expands it.

**Save tag**, **Load tag** and **Reset tag** use a separate local configuration. Saved Tag settings are read only in the opted-in developer sandbox. Ordinary play starts with defaults. Reset tag restores the values above without modifying saved Combat Mode enemy settings, aim assistance or physics. Counts above 16 are experimental and show a performance warning; start with 3–8 on Android. Detailed character rigs and simulation substeps retain their existing budgets.

Standard runners use lightweight ground routes and local obstacle avoidance. Capable v0.8.5 profiles can also choose physical jumps and supported wall/ledge/roof routes. The player retains all existing parkour. Navigation remains local: very dense multi-obstacle arrangements can still trap a runner temporarily, and this is not an advanced city-wide pathfinder.

For your Android playtest: switch modes, compare Low/High near the city alleys and jungle columns, reverse direction suddenly, chase with ordinary and extreme speeds, tag while jumping, and confirm the counter/respawn delay. Change speed and acceleration separately, save/refresh/reset Tag settings, then return to Combat and check Punch/Kick, Block, health and waves. Repeat in portrait/landscape with your saved control positions. Browser validation uses Chromium touch emulation; physical Android performance remains for your playtest.

## Geometric playground and strength (v0.8.3)

From spawn, Reset View to face north. Go **left and forward for the block city** (entrance around X −130 / Z −82), or **right and forward for the jungle** (X +135 / Z −88). Ground route markings and entrance signs identify both routes. Developer Movement Speed 3–20× makes crossing the open approaches quicker. The old traversal test area at X 42–80 / Z −20…−50 stays available. Most of the arena, including the entire large area behind spawn, remains open for combat and pursuit.

The fixed city contains 20 blocks of varied size/height, towers up to **320 units**, a narrow alley, stepping roofs, gaps, elevated stages/bridges, vault barriers and poles. The geometric jungle has 20 giant square-column trunks up to **172 units**, split angular crowns, elevated branches, a canopy crossing and narrow perch poles. The split crowns deliberately leave front/back climbing channels; climb a column to its top, then jump/drop across to the lower crown wings. These are stylised geometric silhouettes, not detailed architecture or realistic vegetation.

All **141 new structures** share their exact dimensions with solid collision/parkour surfaces; the existing nine test structures are retained. Static instances are grouped in spatial chunks with shared primitive geometry/materials and frustum culling. Scenery has no update loop or expensive extra shadow maps. A shared static spatial index bounds collision, support, camera and surface queries; continuous box/cylinder sweeps still cover high-speed motion. Standard enemies commit to local ground routes around obstacles; capable v0.8.5 profiles can use supported vertical routes. None of the profiles solve arbitrary city-wide multi-obstacle mazes. Open approaches/plazas remain useful for high-speed combat and pursuit.

Open **https://dearsvincent-ctrl.github.io/Kinetic-stickman/?sandbox=1&v=0.8.9**, tap **DEV**, and scroll to **Superhuman strength**:

| Control            | Default | Range  | Applies to                                       |
| ------------------ | ------- | ------ | ------------------------------------------------ |
| Attack Power       | 1×      | 0–100× | Damage from confirmed player Punch/Kick contacts |
| Impact / Knockback | 1×      | 0–100× | Enemy impulse from those contacts                |

They apply live at contact and are independent: 0× power + 100× impact moves an enemy without reducing its health; 100× power + 0× impact deals damage without adding knockback. Zero-damage contacts can still stagger/react. Neither setting changes attack reach, aim, timings, input rate, enemy attack damage or player locomotion. Separate technique profiles retain the base Punch/Kick damage/impulse values for future individual scaling. Large impulses travel continuously, decay and collide with structures/arena bounds; finite numerical caps prevent runaway stacking without the old 8 m/s cap suppressing the 100× setting.

Both controls are included in the existing physics Save/Load and Reset. Old version-1 physics saves keep their eight movement values and default the missing strength multipliers to 1×. Normal/Enhanced/Extreme presets and Reset restore strength to 1×; Save keeps the chosen configuration. Aim saves, enemy settings and HUD layouts keep their separate keys. Ordinary play ignores saved developer multipliers.

For the Android playtest: enter both zones, vault the entrances, climb a tall wall/column, run along a roof or bridge, jump away from a wall and double jump/flip while Punch/Kick remain available. Try ordinary and extreme movement, land on crowns/branches, check camera clearance, then return to open ground to compare 0×/1×/100× damage and impact independently. Physical-device performance remains for your phone playtest; browser validation uses Chromium touch emulation.

## Automatic acrobatic double jumps (v0.8.2.1)

Tap **JUMP** normally, then press/slide onto it again while airborne. Both launches keep exactly the existing strength and momentum. At the second button entry, MOVE relative to the fighter's facing selects forward → frontflip, backward → backflip, left/right → side flip. Diagonals choose the dominant component; neutral/drift chooses a compact backflip. The fighter performs one quick staged turn automatically. MOVE continues steering travel; holding/reversing it cannot replay or reverse the flip.

Punch/Kick/Block remain available throughout, with striking limbs taking priority over the tuck. Actual early floor/roof contact or parkour attachment blends into recovery without extending gravity, moving the physical root or waiting for an animation to end. Extremely short flights can show a partial turn instead of a complete one. Normal climbing/vaulting/pole movement never triggers a flip; wall Jump still leaves one legitimate second jump.

For the Android playtest: try all four directions plus neutral, redirect travel halfway through, Punch/Kick while inverted, hold Block, and run immediately after landing. Repeat with high and low Jump Height/Gravity settings; a long jump should show just one flip, while a short jump should land safely. Jump away from walls/ledges, then use the directional second Jump. The camera, saved HUD positions, Enemy Settings and combat should retain their existing behaviour.

## Enemy pursuit settings (v0.8.2)

Open **https://dearsvincent-ctrl.github.io/Kinetic-stickman/?sandbox=1&v=0.8.9**, tap **DEV**, then expand **Enemy Settings**. Ordinary play ignores saved developer enemy settings. No gameplay buttons or saved control positions change.

| Control                | Default                      | Experimental bounds                            |
| ---------------------- | ---------------------------- | ---------------------------------------------- |
| Movement speed         | 1× (3.6 m/s on wave 1)       | 0.1×–1000×                                     |
| Acceleration / braking | 1×                           | 0.1×–100×                                      |
| Pursuit aggression     | 1×                           | 0–3×                                           |
| Attack frequency       | 1×                           | 0–10×; 0 suppresses new enemy attacks          |
| Maximum active enemies | 8; normal waves begin with 3 | 1–64                                           |
| Detection distance     | 60 m                         | 2–4000 m                                       |
| Disengagement distance | 120 m                        | 4–6000 m, always at least 2 m beyond detection |

Changes apply live. Speed and acceleration are independent of the player sliders; the displayed speed multiplier scales the archetype's wave-adjusted enemy cruise speed. Acceleration scales velocity response and braking without resetting velocity. Aggression changes arrival/directness, surrounding distance, prediction and pursuit memory: after leaving disengagement range, alertness expires in 0.25–2.5 seconds. Detection is three-dimensional; Standard uses ground routes while enabled Acrobat/Leaper abilities can pursue local elevated surfaces. A close approach does not inflict damage: existing swept strike contacts, windup/recovery, range, Block and stagger still decide hits. Timing changes apply to the next enemy strike, preserving an executing strike's contact window. At superhuman enemy settings, attacks retain pursuit movement and velocity matching; their start gate remains bounded by the technique's original physical reach. A substep travel margin avoids repeatedly colliding with the player's older footprint while both are moving together. Enemies never automatically trigger player attacks.

Without a custom roster, changing the population limit fills the current active wave to the chosen count. Survivors keep health and attack state; removing surplus enemies awards no defeat credit. Subsequent waves and respawn retain the chosen population, with health/difficulty still increasing. **Normal** / **Reset enemies** restores the original three-to-eight wave growth when custom composition is off. A custom roster instead requests its type counts under this population cap. A completed wave retains its normal delay. Spawns reject occupied/solid space; a completely obstructed area may have fewer than the chosen count.

**Normal**, **Slow** and **Relentless** presets are provided. **Save enemies**, **Load enemies** and **Reset enemies** are independent of the existing physics Save/Load. Saved enemy tuning reloads only in the opted-in developer sandbox. Invalid/outdated stored settings fall back safely. Closing DEV does not pause the encounter; other fingers retain joystick, camera and action ownership.

Pursuit retains the established close-range footwork at ordinary speeds. Superhuman pursuit uses collision-resolved velocity, bounded prediction, target-velocity matching and arrival braking. Larger/faster groups cache local separation; all groups share explicit attack slots. Ground steering is separate from physical travel, and the v0.8.5 traversal planner can redirect capable profiles toward nearby elevated routes. Standard/Heavy retain ground navigation and their permitted jumps; advanced wall abilities require their own profile flags. A blocked or distant route can still be unreachable, which is not permission to pass through it. Existing player traversal, double jumps, flips and attacks remain available.

Start with 3–8 enemies on Android. Counts above 16 are experimental and visibly warned in DEV. The twelve nearest fighters retain detailed rigs; the rest use four instanced draws with basic limb motion, hit flashes and health indicators. All enemies retain full collision, health and attack simulation. Neighborhood searches are cached, population is bounded at 64, and adaptive movement substeps are finite with swept collision/contact fallback. Crowds at extreme speed can still be CPU-heavy; lower population if FPS drops. No physical Android performance claim is made.

### v0.8.2 Android playtest

1. Try Slow and Normal; chase, reverse, stop and let enemies settle into attack range. Check health, Block and respawn.
2. Set player speed to 20×, enemy speed to 50×–200×, detection to 2000 m and disengagement to 3000 m. Sprint, double-jump and reverse; compare low/high acceleration and aggression.
3. Set enemy attack frequency to 0 for a pure chase. Passing nearby must not cause damage. Restore 1× and check that visible enemy strikes and player Punch/Kick still connect.
4. Increase the population to 16, then experimentally 24–64. Check separation, the crowd warning and FPS. Defeat a wave and confirm progression.
5. Save, refresh, alter then Load enemies; use Reset enemies and check the original wave population. Player physics and HUD layouts must be retained. Repeat in portrait and landscape while using MOVE and the action buttons.
6. Climb, run and jump off the gold-marked structures. Enemies remain on the ground and cannot interfere with the player's traversal inputs.

## Automatic traversal (v0.8.1)

Look to the right of spawn for the gold-marked structures and **TRAVERSAL / 01** sign. The small cluster occupies approximately **x = 42–77, z = −44–−16** (metres), leaving the central combat field and the rest of the 2 km arena open. It contains a long wall, 6/12/20 m buildings, two 6 m rooftops separated by a 3 m gap, two low barriers and 8/12 m poles. Collision dimensions and instanced render geometry come from the same `TraversalGeometry` definitions.

No additional action button is needed:

| Context                 | MOVE / Jump                                                                                                                                                                                                                                                                                                                                      |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Wall approach           | Intentionally move into a nearby face; parallel passes and released-stick inertia do not attach.                                                                                                                                                                                                                                                 |
| Wall climb / run        | Continue toward the wall to ascend; steer along its face to run sideways. Combine both directions for diagonal travel.                                                                                                                                                                                                                           |
| Hold / descend / detach | Centre MOVE to hold a reachable contact. Extend moderately away to descend; a strong away input detaches.                                                                                                                                                                                                                                        |
| Wall / ledge Jump       | Press Jump to launch outward, with lateral steering from MOVE. This starts a fresh first jump; one ordinary directional second jump remains. Repeated free-air presses cannot refill it. A new wall interaction requires leaving and contacting a surface again.                                                                                 |
| Ledge                   | Approach within hand reach to catch it. MOVE sideways to shimmy, toward the wall to pull up, or Jump away. Above an unsupported rim, interrupting the pull-up returns to gravity.                                                                                                                                                                |
| Roof                    | Continue onto the roof and immediately walk/run/jump/attack. Leaving a roof starts a fall; roof or ground contact restores both jumps.                                                                                                                                                                                                           |
| Low barrier             | Moving into a gold-marked low barrier automatically vaults it. Keep steering, interrupt away or press Jump.                                                                                                                                                                                                                                      |
| Pole                    | Approach deliberately, then climb using the approach direction. Left/right relative to the initial contact plane circles the pole; the control direction stays consistent around the shaft. Continue to the top to perch. Neutral/continued approach holds the perch; steer sideways to step off, or Jump with MOVE aimed at the next structure. |

Climbing and wall running have **no stamina or duration limit**. Very fast upward runs carry momentum over a crest into ballistic flight; brake before the rim to settle into a normal ledge catch/perch. Punch/Kick still use the manual scheduler and existing active contact paths; wall contacts use the existing aerial techniques, while roofs/perches support grounded techniques. Block retains priority. No damage, attack-rate or hit-range tuning is changed.

`TraversalWorld` extends the circular target adapter with swept box/cylinder sides, roof caps, ceilings, elevated support and camera obstruction queries. Structures live separately from the mutable enemy list, so waves/reset cannot erase them. Enemy adapters share structure collision and spawn rejection, while remaining ground-based. `ParkourState` owns contact abilities and velocities; `JumpState` retains launch/gravity/double-jump ownership using an explicit support height. `ParkourPresenter` layers reachable hand/foot IK, sole orientation, hips/shoulders and recovery over the current rig; final strike IK retains priority. None of the animation code moves the player root.

Code-only `PARKOUR_DEFAULTS` prepare climb speed, descent, acceleration response, mantle/vault rates, wall-jump impulse and contact thresholds for future attributes. Current movement/jump sandbox values apply live; there are no new progression or enemy-speed menus. Traversal uses bounded collision iterations, a broad phase, the existing adaptive step budget, bounded animation cadence and a pole orbit cap to keep extreme settings numerically stable. Visual landing anticipation queries the roof beneath the player separately from the collision-confirmed landing state. Camera distance/orbit/reset stay unchanged in free space; obstruction shortens the camera offset rather than placing it inside a building.

This foundation supports the authored vertical boxes, ledges and poles, not arbitrary mesh climbing or a ragdoll. Wall ends release into the air; automatic corner wrapping, enemy parkour/pathfinding and a larger obstacle playground are deferred. Close obstructions can pull the camera in; orbit to a clear side. Human-sized limb contacts can still slide at extreme sandbox speeds.

### v0.8.1 Android playtest

1. Run toward the gold-marked wall. Climb, steer sideways, reverse along it, hold neutral, descend with a partial away input and detach with a stronger one. Running past it should not grab it.
2. Jump away from a wall, use the directional second Jump and Punch/Kick/Block while steering. Return to a wall deliberately, then repeat; free-air Jump spam must stop at the normal allowance.
3. Hold toward a building until the roof transition completes; continue sprinting or immediately jump/attack. Cross the gap between the two 6 m roofs with jumping/double jumping.
4. Vault a low barrier, interrupt a pull-up, shimmy a ledge and climb/perch on both poles. Jump toward another reachable structure. Use right-thumb look and Reset View near each surface.
5. Repeat with Enhanced/Extreme sandbox settings. Check continuous contact, solid roofs/walls, stable rotations, camera tracking and independent controls. Return to the open area to check enemy attacks, damage, Block, waves, defeat/respawn and saved HUD positions.

## Coordinated procedural animation (v0.8.0)

The existing hierarchical rig, two-bone leg/arm IK, independent quaternion body rotation, combat scheduler and shared strike sampler remain. The inspection found disconnected body oscillators, joint layers overwriting each other, foot prediction following facing rather than actual travel, fixed flip tuck and a vertical-travel foot reset. This release extends those layers instead of replacing gameplay.

- `AthleticCoordination` reads actual leg support and fore/aft foot separation to coordinate pelvis load, hip twist, opposing shoulders/arms and head balance. Walking has quiet heel/toe steps; running and sprinting retain their distinct heel recovery, push-off and two-foot flight. Sprint adds stronger load/rise, lean and brief trailing arms. Foot prediction follows resolved travel during turns.
- `MotionPresentation` uses actual lateral acceleration for banking and resolved acceleration/braking for weight shifts. Sharp reversals remain non-damaging athletic recovery, with the existing restrained streak effects.
- `PoseContinuity` follows upper-body targets using normalized shortest-path quaternion blending and an analytic critically damped pelvis spring. `PoseTransitions` snapshots the current rig at attack and movement boundaries, including interruptions and attack exit. Support IK runs after those crossfades; active strike IK remains last so visuals retain the shared physical trajectory.
- Jump entry captures the displayed body-local ankle positions. Flip tuck follows body inversion and gradually extends on descent; free shoulders, elbows and head counterbalance the pelvis. Landing anticipates contact, unfolds the feet, absorbs impact and takes a recovery step. Running landings use shallower compression without waiting for a fixed pose.
- Physical touchdown restores fresh Jump, Punch/Kick and ground-dash eligibility while visual absorption continues. Launch strength, double-jump limits, gravity, air control and dash values are unchanged. Existing safeguards for an aerial dash still crossing touchdown remain. Pausing a flip through a utility no longer erases body orientation or angular momentum; respawn clears its visual caches.
- Grounded strikes retain a stationary supporting foot, coordinated hip/shoulder transfer and counterbalancing guard. The shared strike sampler chambers during wind-up and follows a curved guard/chamber recovery. **Active hit paths, reach, hit radii, damage and attack timing are unchanged.** Both limbs and appropriate same-limb repeats remain available; there are no added combat locks.

Animation values live in immutable `AnimationStyle` sections so another character can use different presentation tuning. No visual layer writes player travel, velocity, facing or camera. At extreme sandbox speeds, excess travel carries foot contacts while stride rhythm, knee reach and joint interpolation stay bounded; this retains the existing deliberate visual compromise rather than cycling limbs at 100× speed.

This remains procedural kinematic animation, not a simulated balance/ragdoll system. Severe last-moment turns, extreme root travel and interrupted inverted landings can still show some foot sliding or reach-limited limbs. Active strikes intentionally take priority over aesthetic smoothing to preserve contact timing. No parkour or new technique is introduced.

### v0.8.0 Android playtest

1. Extend the joystick slowly from idle through walk/run/sprint and release. Compare relaxed walking, athletic running and the sprint's brief two-foot flight and stronger body commitment. Try sideways travel and broad reversals; movement should respond immediately without attacks.
2. Sprint → Jump → Kick → land while still moving → sprint. Repeat with an immediate Jump or Punch on touchdown; visual knee absorption must not lock input.
3. Forward/backward/sideways/neutral second Jump should select front/back/side/default-back flips. Steer travel independently, Kick/Punch while inverted, and Block. Check the camera stays stable and the body does not reset upright in mid-air.
4. Tap/hold/slide Punch → Kick → Block during reversals and landings. Look for supporting-foot balance, torso drive, either striking limb and recovery from the current pose rather than idle.
5. Repeat with Enhanced/Extreme and 100× settings. Check stable feet, finite rotations, responsive steering and preserved dash chains using the developer utility. Check enemies, damage, guard, waves, respawn and saved control positions.

## Manual combat aim assist

An accepted manual Punch or Kick (tap, slide entry or held repeat) can select an enemy near its imminent **physical fist/foot trajectory**. It never starts attacks, changes root position/velocity/facing, turns the camera, extends a limb or changes hitbox sizes. Targets are ranked by distance from the predicted strike path rather than distance from the player. Selection includes both actors' motion, jump gravity and current three-dimensional body rotation. Targets outside the predicted forward cone, original reach/vertical limits or alive enemy pool are rejected. A short forecast covers travel through the active window (up to 0.2 s, with a numerical lead cap); physical melee reach remains unchanged at contact, even at 100× speed.

Defaults are **100% strength**, **20° maximum total 3D correction**, and a **±25° acquisition cone**. Up to 100%, the original captured punch-correction calculation is preserved; recorded stationary, moving, inverted and 100× passing-punch fixtures verify the 100%/20° baseline exactly. The upper body, shoulder and two-bone arm share the same corrected point as collision detection. Kicks rotate their authored ankle goal about the striking hip, with existing leg IK preserving natural limb length and support. Contextual limb selection retains its stronger posture, support, recovery and rotational-momentum rules; both sides and repeated same-limb attacks remain available.

Above 100%, assistance progressively blends toward a seven-point predicted alignment profile across the active window. At 200%, the strike follows that predicted profile within the configured angular cap, improving crossing-target contact without simply multiplying the angle and rotating past the target. The profile is captured once at manual entry and cannot follow later target changes; there is **no permanent lock or live homing**. Correction fades through wind-up/recovery, and the visual limb and collision query use the same profile. Steering, flips, attack interruption and Block remain responsive. Live tuning affects subsequent strikes, keeping an executing strike continuous. At **0%**, acquisition and limb preference bypass entirely; original poses, technique choices, physics and the unassisted contact-query path are preserved.

In **Settings → Developer tools → Open physics sandbox**, scroll to **Combat aim assist** for strength (**0–200%**), maximum correction (**0–45°**), acquisition half-cone (**5–60° per side**), optional target/trajectory debug, **Save aim**, **Load aim** and **Reset aim defaults**. Reset applies 100%/20°/±25° immediately; Save aim keeps it across developer-mode refreshes. Aim settings use their own versioned browser key (`kinetic.aim-assist.v1`); old-range values are preserved, invalid/outdated saves are ignored, and unavailable storage does not interrupt gameplay. Physics Save/Load, presets and saved control layouts remain separate. Ordinary play ignores developer aim saves and always starts at the new baseline. Blue shows the original path; orange shows the corrected path. Debug is off by default and performs no sampling while hidden.

Inspection found existing relative swept collision and active-time clipping. A new 30 Hz crossing-target regression exposed under-sampling around the hand's natural full-extension clamp. Corrected curves now use bounded finer temporal/rotational samples; the physical overlap interval's entry, closest point and exit are validated against the same reach, facing and height limits. Facing validation follows the corrected strike direction at the actual contact time, preventing wide-angle visible contact from being rejected by a stale direction. Radial reach and height limits remain in the original body frame. Tests cover 30/60/144 Hz contacts at both ordinary and 100× travel, misses, one hit per target, visible wrist/ankle agreement, expanded cones, multiple targets and unchanged physics. Startup/recovery passes and unreachable or departing targets can still miss. At 5.2 m/s, a 0.08 s punch startup still covers 0.416 m; extreme movement requires deliberate strike timing. Assistance does not guarantee a hit.

## Active combat and expanded arena (v0.7.9)

Normal play starts **wave 1 with three red fighters**. Enemies detect within 60 m, pursue after detection, run toward the player, spread around them, and take staggered attack opportunities. Their states are Idle, Approach, Position, Attack, Recover, Stagger and Defeated. Punches have 0.32 s startup; kicks have 0.43 s startup, followed by active contact and recovery. Early waves allow one attacking enemy at a time; later waves allow two, with at least 0.5 s between starts. Escape a telegraphed strike by moving or jumping: proximity alone never causes damage.

The player starts with **120 HP**, enemies with **72 HP**. Confirmed player punches deal 18 and kicks 28; enemy punches deal 10 and kicks 15 before gradual wave scaling. Each strike can contact each opponent only once. The existing active-window, swept weapon/body queries also track moving target positions; attack reach never scales with travel speed. Enemy stagger cancels its current strike. Enemy knockback starts as a bounded impulse and can transition into collision-resolved ballistic flight and angular reactions; it never changes the joystick's movement parameters. Player hit reactions are visual and do not lock movement or attacks.

**Block** covers the forward 144° arc. A newly raised guard (first 0.16 s) prevents damage; a maintained guard reduces front damage by 85%. Attacks from behind connect normally. Health bars above enemies flash on hits. The compact HUD shows player HP, wave, living enemies and total defeated enemies, with restrained screen-edge damage/block feedback. Defeated enemies fall and stop colliding or attacking. Player defeat disables gameplay input and offers **RESPAWN**. The HUD's small **RESET** button also restores full health and restarts wave 1. Respawn retains saved controls, live sandbox multipliers and camera orbit. New lives have 1.5 s spawn protection.

After clearing a wave, the next spawns after 2.5 s. Every two waves add an enemy, capped at **eight**; enemy health, running speed and damage rise gradually with safe ceilings. Spawn positions form a separated ring roughly 9–15 m from the player, including near arena corners. Reset starts a fresh defeated count; no reload is required.

The floor and swept collision bounds both span ±1,000 m. A repeated 256 px grid, central training markings, four instanced perimeter rails, one local 1,024 px shadow map and distance fog keep geometry/light costs bounded. Camera angle, follow distance, drag and Reset View are unchanged; the far plane supports the expanded field and high jumps. Enemy rigs share limb geometry and materials. Eight preallocated agents are reused between waves; distant rig animation is throttled and presentation is hidden past 220 m while pursuit continues.

The stationary dummy remains as a supplementary contact target and does not count toward waves or kills. Optional **`?practice=1`** retains isolated stationary-target practice without active waves. Historical movement/control browser regressions explicitly use that fixture; separate browser checks exercise the normal active encounter, damage, defeating enemies, wave progression, Block and respawn. Normal game URLs always start active combat.

The encounter uses simple kinematic circular footprints and torso/head/hip strike spheres, not a ragdoll or skeletal hurtbox simulation. Enemies currently fight on the ground; the player retains aerial strikes, steering and flips. No progression, parkour or multiplayer is added.

## Momentum recovery and aerial control (v0.7.9)

**Sharp ground turns do not attack.** Back, diagonal and lateral reversals produce a short foot plant, knee compression, hip/shoulder counter-rotation and push-off, driven by actual collision-resolved velocity and braking. Detection accepts broad angles (65°–180°), including direct direction changes without a centre-crossing gesture. Gentle turns remain ordinary locomotion. The recovery layer observes movement; it cannot change speed, acceleration, steering, position or ability availability.

Forceful plants leave restrained dust-coloured ground streaks. Actual speed and braking determine intensity. Sixteen pooled instances share one geometry, material and instanced mesh; weak walking changes emit nothing. Superhuman travel uses larger, stronger streaks, with bounded leg reach and effect size.

Manual Punch and Kick can start during recovery. Grounded kicks shift weight over a supporting foot; running support yields to travel. Punches coordinate hip/shoulder drive and unwind through recovery. Existing pose snapshots and shared limb-entry targets blend attacks from the current body configuration. Both sides remain available, with contextual selection and mechanically appropriate same-limb repeats. Holding attacks still repeats only after the configured technique recovery; no new combat cooldown or input lock is introduced.

**Directional double jump:** tap Jump, then press it again while airborne. Holding the joystick is supported. The second launch replaces vertical velocity with the current configured launch velocity; it never adds a second impulse on top of existing vertical speed. A third press is discarded until landing. Takeoff and landing recovery do not buffer extra jumps. The HUD shows **JUMP 2** while the airborne second jump is available.

On the **second** Jump, direction is sampled once relative to the character's current movement-facing yaw, captured at the button entry before later steering/camera samples. Forward selects **frontflip**, backward **backflip**, left **left side flip**, and right **right side flip**. Diagonals use the dominant component (longitudinal ties are stable); neutral/drift below 0.12 joystick magnitude selects a compact **backflip**. This replaces the previous take-off-reference/upright-neutral and joystick-torque controls.

`AutomaticFlip` authors one complete turn using a normalized quaternion path with explicit winding, bounded timing and shared launch/initiation/tuck/rotation/extension/recovery envelopes. Normal turns take approximately 0.62 seconds; duration adapts to remaining flight where practical without extending gravity or flight. Hips, spine, shoulders, elbows, knees and head follow the staged pose; side flips use roll and asymmetric leg/arm mechanics. Front/back flips use pitch with different arm launch and leg-fold shapes. Holding, releasing or reversing MOVE steers travel and cannot accelerate/reverse/replay the turn. Long superhuman jumps perform one turn, then settle upright even while still rising.

Punch/Kick are accepted by the existing manual scheduler during flips. Their striking limb and final contact IK retain priority; other limbs counterbalance and recover from the current pose. Block still takes priority. There is no attack lock, target pull, added attack range or new technique. Early floor/roof contact or a parkour attachment interrupts the angular path into bounded upright recovery; body-pivot clearance prevents head clipping without changing the physical root. Extremely short flights may show a partial flip/recovery instead of a full turn. Continuing to run or immediately jumping again does not wait for a landing animation. Normal wall climbing/vaulting/pole interactions never initiate a flip; a deliberate wall Jump retains the existing first-jump-plus-one-air-jump contract.

**Existing jump baseline and sandbox:** the original sandbox multiplies target jump height, then derives launch velocity as `sqrt(2 × gravity × height)`. The existing baseline is **1.2 m**, from the original **0.8 m** (0.8 × 1.5); launch velocity scales by **√1.5**, not 1.5. Sandbox **1.0×** now means that 1.2 m baseline. Additional Jump Height multipliers apply once: 2× = 2.4 m of rise per launch at unchanged gravity. Both jumps read the same current configuration, including changes made between launches. Existing saved modifiers remain relative modifiers; Normal/Reset restores the new 1.0× baseline. An aerial jump does not refill the aerial dash allowance.

Whip-kick, descending-sweep and rotational-backhand definitions, explicit technique requests and their contact/transition framework remain in the code for future deliberate attacks. Normal ground locomotion no longer invokes those requests or starts a body spin.

### Android playtest checklist

1. Walk, jog and sprint, then make back, diagonal and sideways reversals. Steering should respond immediately; sharp turns should plant/compress/rebound without starting a strike. Gentle curved turns should stay understated.
2. Tap/hold Punch and Kick during a plant, slide between them and Block, and release. Look for either limb, possible same-limb repeats, grounded support and smooth follow-through without a neutral reset.
3. Jump twice with forward, backward, diagonal and neutral input. Keep the joystick held. Try a rightward takeoff to check the reference frame. A third press must do nothing; landing must restore both jumps. Punch/Kick/Block and counter-steering should remain responsive during either flip. Try flicking without a second Jump: no flip should start.
4. Try Enhanced/Extreme presets and 100× travel with broad reversals. Check restrained effects at ordinary speed and stronger plants/streaks at high speed. Watch for stretched legs or camera jitter. The existing developer Dash utility can still chain ground Dash → Jump → aerial Dash.
5. Repeat with saved/repositioned controls, different orientations and simultaneous joystick/action/camera fingers. Use the on-screen FPS readout on your device.

### Scope and limitations

Player support and recovery are procedural visual approximations, not a rigid-body balance solver. Enemy angular reactions are documented separately above. At superhuman travel speeds, a human-length leg cannot stay anchored across many metres: visual contacts yield within bounded reach and can slide. A bounded angular spring assists landing, with up to 0.3 m of visual-only clearance for a late inverted pose. It never moves the physical actor or suspends gravity. Detailed body/floor collisions, perfectly planted pivots, arbitrary technique chains and moving-opponent prediction remain future work. No new attacks, character attributes or progression systems are added.

## Custom controls and layout migration

Settings → **Edit Controls** pauses gameplay and lets you drag **Move, Block, Jump, Punch and Kick** with touch or a mouse. Save commits the arrangement; Cancel discards unsaved edits; Reset to Default previews the responsive defaults until saved. Inputs are released when editing, pausing, losing focus, rotating or cancelling a touch.

Positions are normalized to the playable viewport and saved under `kinetic.controls.v1`. The compatible version-1 schema migrates old Dash/Sprint layouts by preserving the exact saved Move/Block/Jump coordinates, removing retired entries and initializing Punch/Kick independently. Remaining legal controls are placed first when projecting a custom layout; new buttons reflow around them. Screen resizing can constrain visible placement around essential UI and other controls without destroying the stored anchors. Invalid data falls back safely; a failed migration write keeps the valid layout usable in memory. Physics configurations use a separate storage key.

## Developer physics sandbox

Open **https://dearsvincent-ctrl.github.io/Kinetic-stickman/?sandbox=1&v=0.8.9** and tap **DEV**. The panel is opt-in, collapsible and scrollable; it does not pause gameplay. Other fingers retain joystick/action/camera ownership while a slider is adjusted. Normal play ignores saved developer multipliers. This tool is separate from any future progression system.

The original eight sliders still support **0.1×–100×**, with precise stops near 1×, 10×, 20×, 50× and 100×:

| Parameter            | 1× default                                                              |
| -------------------- | ----------------------------------------------------------------------- |
| Movement speed       | Walk 1.3, run 2.6, maximum sprint 5.2 m/s; entire analogue curve scales |
| Jump height          | 1.2 m                                                                   |
| Ground dash speed    | 10 m/s average                                                          |
| Ground dash distance | 2.5 m                                                                   |
| Aerial dash speed    | 10 m/s average                                                          |
| Aerial dash distance | 2.5 m                                                                   |
| Air steering/control | 3.5/s response                                                          |
| Gravity              | 18 m/s²                                                                 |

**Normal**, **Enhanced** and **Extreme** presets are unchanged. **Reset to Defaults** applies Normal. **Save custom** stores one configuration locally; **Load saved** recalls it. Refreshing a sandbox URL loads the saved configuration. Reset/presets do not overwrite the saved configuration until Save is pressed. Storage uses `kinetic.physics-sandbox.v1`; unavailable/corrupt storage cannot corrupt the movement state or control-layout save.

Movement speed, gravity and normal air control apply live. Jump height affects the next launch, including an available second airborne jump, whose velocity is `sqrt(2 × effective gravity × desired height)`. Dash speed and distance determine duration independently and apply on the next burst; editing sliders never rewrites an impulse in progress. Existing momentum, cooldowns, steering and the allowance of one aerial dash before landing remain intact.

Numeric bounds are configurable in `PhysicsSandbox.js`. Defaults allow up to 520 m/s locomotion, 120 m rise per launch, 1,000 m/s average dash speed, 250 m dash distance and 1,800 m/s² gravity. The game bounds catch-up work, uses up to 32 adaptive physical steps and swept world/strike queries, and keeps animation cadence/leg reach bounded. Short bursts receive a readable visual launch; long developer dashes animate a cruise between launch and touchdown. The camera bounds extreme follow lag while preserving its angle, distance, orbit and Reset View. Superhuman travel can still produce some visual foot sliding on a human-sized rig.

## Combat architecture

- `CameraSettings.js` / `CameraSettingsPanel.js`: immutable, validated Combat/Tag camera preferences, independent browser persistence, live sandbox controls and per-profile reset.
- `FollowCamera.js` / `DynamicCameraDirector.js`: direct orbit, bounded camera guidance, manual override and optional dynamic FOV; camera state stays separate from gameplay decisions.
- `GeometricWorldLayout.js`, `createGeometricWorld.js`: one fixed city/jungle collider layout with spatially culled instance batches. `StructureIndex.js` is shared by traversal-world forks; `TraversalWorld.js` retains continuous side/roof/ceiling and camera queries.
- `EnemyAbilities.js` / `EnemyAbilitiesPanel.js`: validated, plain per-archetype capability profiles, independent mode rosters and live editing, captured by named sandbox builds. `EnemyTraversalPlanner.js` makes bounded ability-aware ground/air/surface decisions; `EnemyAgent.js` configures the existing character controller and shared parkour state.
- `SliderLocks.js`: automatic per-range registration, independent accessible locks, directional touch intent and reopening/profile-change relocking; saved values stay independent.
- `GroundObstacleAvoidance.js`: committed local perimeter detours and cached failed routes for ground-only enemies. `CombatStrength.js` resolves independent per-technique damage/impulse profiles; `Combatant.js` continuously resolves and damps the resulting momentum.
- `PunchAimAssist.js`: per-manual-strike short-horizon ranking, bounded correction and contextual limb preference. `PunchAlignment.js` shares hand/ankle correction with presentation and contact queries; `AimAssistSettings.js` owns independent developer defaults, bounds and Save/Load.
- `AimAssistPanel.js`, `PunchAimDebug.js`: temporary live developer controls and optional shared-sampler target/path visualization; saved physics and HUD data remain separate.

- `BattleWorld.js`, `EnemyAgent.js`, `Combatant.js`: bounded wave pool, deterministic attack opportunities, stateful pursuit/positioning, health, timed directional Block and collision-resolved damage impulses.
- `ImpactModel.js`, `EnemyReaction.js`, `ReactionSkeleton.js`: independent bounded impact calculation, ballistic/settling/recovery states, angular joints and shared pose/contact calculations. `EnemyReactionPresenter.js` applies that state to the fixed-length visual rig; `ReactionSettings.js` owns the independent developer preferences.
- `EnemyViews.js`, `BattleHud.js`: shared rig presentation, distance throttling, health/defeat feedback and reset. `ArenaConfig.js` is the source of truth for the expanded floor, collision dimensions and rendering distance.

- `ManualTechniques.js`: separate ground/air Punch and Kick definitions. Each declares startup, active duration, recovery, playback speed, reach, hit radius and ground/air eligibility. `createManualTechniques()` resolves them to the existing windup/extension/impact/recovery animation phases. Code-only `punchSpeed`, `kickSpeed` and `recoverySpeed` factors remain available for future tuning; the new strength controls do not retime attacks.
- `AdaptiveTechniques.js`: fourteen procedural technique families, including a two-leg aerial bicycle kick; deterministic pose/momentum-based limb selection. `TechniqueGeometry.js` shares strike targets and captured limb-entry poses between procedural IK and contact queries.
- `MomentumRecovery.js`: collision-resolved velocity/braking observer with broad-angle recovery classification. `MomentumRecoveryAnimator.js` and `GroundCombatBalance.js` layer bounded foot support and additive body loading over the existing gait. `GroundStreaks.js` owns the fixed instanced effect pool.
- `JoystickGestures.js`: press-time facing-relative second-jump selection; no flick history or activation without an accepted second Jump. `JumpState.js` owns the two-jump allowance and ballistic relaunch; `CharacterController.js` preserves horizontal movement and publishes accepted jump events. `BodyRotation.js` / `AutomaticFlip.js`: separate normalized quaternion/angular state, one bounded authored turn, pose envelopes and upright/contact recovery. Neither changes physical translation.
- `AcrobaticPresenter.js`, `ArmIK.js`, `LegIK.js`, `PoseTransitions.js`: body-only pelvis pivot, shared strike targets, supporting-leg approximation and current-pose crossfades; the original root and camera remain upright.
- `AttackScheduler.js`: one bounded entry request plus held intent. It schedules by gameplay recovery boundaries, independently of render/animation loops. It never queries target range or changes movement.
- `CombatController.js`: technique timing, cancellation, defensive priority and immutable accepted-strike context. An explicit approach gate can hold startup without advancing contact time; fresh input and Block remain interruptible.
- `FreeflowCombat.js` / `FreeflowSettings.js`: accepted-input acquisition, directional switching/hysteresis, bounded live contact goals, approach budgets and one collision-resolved controller driver. Quaternion-aware contact goals use the same physical endpoint as the strike detector. No freeflow query can create an attack or a hit.
- `SpeedImpact.js`: synchronized swept speed contacts, obstruction checks, bounded enemy impulses and per-enemy contact/cooldown records; Combat-only, no health damage.
- `SpeedEffects.js` / `CameraImpact.js`: pooled foot/radial dust, layered pressure fronts and streaks, one threshold event and a brief collision-safe render-only camera envelope.
- `StrikeHitDetector.js`: sweeps a bounded weapon sphere against moving enemy/player body spheres and the dummy's body/post hitboxes only during the technique's active window. It clips startup/recovery time out of movement segments, samples quaternion-oriented hand/ankle trajectories with bounded angular subdivisions, preserves body-local reach limits, and records each target once per strike. The dummy has body and low post hitboxes matching its visible geometry. Previous/current opponent positions support relative sweeps. Contact callbacks carry sequence, technique, opponent, time, contact point and contact-time source; the encounter applies damage and reactions.
- `Game.simulateMovement()`: advances physical movement once at its own step size, then samples the resolved path at combat boundaries. A freeflow motion intent runs through the normal swept controller, while gravity, jump counts, dash and traversal retain their own state. With freeflow off, attack timing cannot alter manual movement. Physics and visual presentation remain separate.
- `TouchActionRouter.js`: reusable HOLD, PRESS, TOGGLE and TAP_HOLD behaviors with dynamic DOM hit testing, independent contact ownership, keyboard/accessibility support, capture fallback and cancellation. TAP_HOLD combines one entry request with held-state reporting; the router does not itself repeat attacks.
- Existing punch and kick animators blend with locomotion and jump/dash poses. Manual punches retain the athletic lower-body gait at running/sprinting speed; the guard remains on the upper body. Deliberate Block retains defensive footwork. Aerial punches retain lower-body flight animation; the grounded kick retains the moving support leg. Animators never translate the physical root.

The former `ProximityCombatController` and legacy technique definitions remain unwired library code with regression coverage. They are **not instantiated by the game**. Manual attacks do not depend on target acquisition. Swept contact sensing does not enlarge reach with speed, guarantee a hit or compensate for poor timing. A strike that passes the dummy only during startup or recovery misses.

The kinematic world uses swept horizontal bounds, round actor/dummy footprints and solid box/cylinder traversal surfaces. It supports roofs, undersides and camera obstacle clearance; it does not simulate a full rigid-body environment or ragdoll balance. The hierarchy and collision adapter remain suitable for later Rapier integration.

## Run and test locally (optional)

Use Node.js 22.12+ and a WebGL 2 browser.

```sh
npm ci
npm run dev
npm test
npm run test:browser
```

Vite listens at `http://localhost:5173`. For another device on the same network use the development machine's LAN IP. The Android phone itself does not need to run any commands.

Build and test exactly the repository Pages mount:

```sh
GITHUB_PAGES=true GITHUB_REPOSITORY=dearsvincent-ctrl/Kinetic-stickman npm run build
GITHUB_REPOSITORY=dearsvincent-ctrl/Kinetic-stickman npm run test:pages
```

For a normal local build use `npm run build` and `npm run preview`. For a Pages-specific preview use the same `GITHUB_PAGES`/`GITHUB_REPOSITORY` variables with `npm run preview`, then open `http://localhost:4173/Kinetic-stickman/`.

The v0.9.1 tests additionally cover light/moderate/heavy standing reactions, accumulated instability and delayed recovery, independent displacement/knockdown resistance, hit location/posture/momentum, profile stability, immediate extreme launches, standing rig/contact alignment, recovery without light-hit fall loops, bounded high-intensity pose fading and 30–144 Hz consistency. Settings tests cover catalog metadata, contextual defaults, scoped resets, shared canonical owners, all named-build operations, malformed slots, missing new fields, blocked storage and preservation of unrelated preferences.

The production polish suite uses native touch and keyboard-operated original widgets for same-enemy Punch → Kick → Punch, accumulated balance, a powerful finisher and held-input release. It also verifies all setting IDs remain unique/accessibly located, category persistence, search paths and context selectors, favourite value/lock sharing, profile-change relocking outside source editors, native vertical/horizontal gestures, confirmation/isolation of category resets, named builds including both cameras/archetypes/mixed rosters, and the Controls editor shortcut/reset. Historical gameplay fixtures expand the new navigation through its actual UI. Storage-isolation checks exclude only the intentional new menu-organisational key; gameplay saves remain checked. Gesture setup centres the real visible track below the sticky header. No physical Android device was used.

The retained v0.9.0 reaction regressions cover independent finite settings, relative-speed saturation, strike direction and location, procedural recoil, stumble/knockdown thresholds, selective ragdoll, fixed bone lengths, rig/hitbox agreement, momentum-preserving re-hits, roof/ceiling/wall/column collision, optional collision damage, alive recovery, corpse/wave reset, 30–144 Hz stability, a 64-enemy impacted crowd, wall-side supported poses and Tag isolation. Production touchscreen checks cover individual locks/scrolling/save/reset, real light and severe contacts, Freeflow release after impact, continuous flight, recovery and safe mode switching. No physical phone was used for these checks.

The preceding freeflow tests additionally cover 6–12 m attack-driven approaches, extreme incoming velocity, directional switching, swept world rejection, input cancellation, inverted/aerial contact, bicycle-kick geometry, approach contact-time gating, pressure-front expansion, camera recovery and mode-aware speed impulses. Existing regressions cover actual rendered hand/ankle agreement with the active contact sampler, natural bone lengths and knee planes, chamber/rechamber continuity, full spinning/support-foot turns, interrupted strikes at 100× speed, manual combo branches and exact held-recovery timing. They also cover fixed effect pools, ground-only dust, sonic crossing/rearming, independent preferences, optional approach budgets and collision/Block/Tag gates. Native browser checks exercise both finger orders (action first or joystick first), slide transitions, moving/aerial combinations, live-enemy approach and physical Kick contact, all new slider locks and safe vertical scrolling. Profile screenshots show chamber, extension and recovery; they are visual evidence, while the separate rig/contact tests verify collision alignment.

The v0.8.6 camera tests cover exact defaults and bounds, independent Combat/Tag persistence, invalid or unavailable storage, actual projection changes, nonlinear velocity-driven FOV and recovery, target scoring and persistence, awareness independent of AI, held manual override, bounded vertical framing, wide-lens obstruction clearance, stable collision recovery and actual collision-resolved Game integration. Production browser checks exercise individual locks and native touch scrolling, simultaneous joystick input, both mode profiles, refresh/reset, speed/vertical FOV response and manual takeover of live enemy framing.

The v0.8.5 tests cover independent enemy ability data, exact mixed/single-type rosters, global multiplier isolation, genuine per-profile jumps, high leaps, ability-gated wall/roof traversal, movement stability, damage/resistance and unchanged Combat/Tag interactions. Slider checks cover individual locking, value preservation, locked and unlocked vertical scrolling, deliberate horizontal adjustment, dynamically added ranges, reopening/profile-change relocking and independent gameplay pointers. Native browser routes exercise profile selection/editing, mixed encounters and safe slider gestures in mobile layouts.

The v0.8.4 tests cover safe Combat/Tag switching, independent live/saved Tag settings, direct and predictive fleeing, acceleration/speed scaling, decision hysteresis, obstacle/boundary escape, high-speed three-dimensional swept tags, wall occlusion, one credit per runner activation, safe delayed respawning and bounded experimental populations. Native browser checks use the real mode selector, tune/save/reload Tag settings, chase and tag using touchscreen movement, verify the counter/feedback/respawn, exercise double jumps and action sliding with 64 runners, and return to unchanged Combat Mode.

The v0.8.3 tests cover deterministic city/jungle composition, exact instanced collider dimensions, spatial-index equivalence, tall/raised/underside sweeps, city vault/climb/rooftop transitions, giant-column channels, jungle poles, unlimited climbs, wall/double jumps, ground detours through actual city geometry, cached unreachable-roof routes, safe spawns, camera clearance, 0–100× independent damage/impact, real impulse scaling, extreme collision stability and legacy saves. Native routes travel from spawn using the actual joystick, reach city and jungle rooftops, attack/double jump/land, test portrait strength controls and saves, then demonstrate 0× damage/100× impact and 100× damage/0× impact against active enemies.

The v0.8.2.1 tests cover front/back/left/right/diagonal/neutral selection, press-time facing capture, staged full-body posing, one turn independent of held/reversed input, frame-rate stability, exact movement/gravity independence, manual attacks/Block during every flip, early floor/roof contact, extreme settings, wall-jump/attachment compatibility and unchanged camera orbit. Native browser checks capture initiation/tuck poses and verify one turn, physical equal-strength launches, air steering, third-jump rejection and landing. Testing uses Chromium touch emulation; no physical Android testing is claimed.

The v0.8.2 tests cover live and saved enemy tuning, independent speed/acceleration, high-speed moving-target pursuit, reversal/arrival recovery, detection hysteresis/persistence, separation, bounded adaptive steps, actual attack contacts/Block, population changes without fake deaths or replenishing defeated enemies, wave/respawn compatibility, crowded corner spawns and shared/instanced crowd presentation. Native browser checks exercise Enemy Settings alongside held joystick input, Save/Load/Reset/presets, orientation changes and a 64-enemy extreme chase with directional double jumps and Punch/Block/Kick slides.

The v0.8.1 tests cover deliberate versus glancing attachment, unlimited climbs, wall running/descent/jumps, ledge interruptions, continuous vaults, poles/perches, rooftop gaps, elevated double jumps, high-speed side/roof/ceiling collision, camera clearance, contact poses and manual aerial combat. They also compare the open-ground adapter paths exactly at 1×/100× and reject enemy spawns inside structures. Native browser routes reach the area using the actual joystick and developer panel, then exercise vault/climb/mantle, roof attacks/double jumps, pole perching and directed jumps.

The v0.8.0 tests add contact-driven gait comparisons, acceleration banking, immediate touchdown actions, exact active wrist/ankle agreement with the contact sampler, rapid attack/flip continuity, vertical 100× takeoff capture, support contacts and pause/reset handling. Browser checks capture walk/run/sprint at the same camera angle and exercise sprint → reversal → Punch → double-jump backflip → Kick → Block → running landing.

Logic tests additionally cover broad-angle recovery, exact movement independence at normal/100× settings, bounded effects, grounded support, manual attacks during recovery, directional double jumping versus ordinary air steering, three-axis normalization, automatic one-turn invariance under steering, upright recovery, contextual and repeated same-limb selection, kick-to-backhand continuation, pose continuity and rotational swept contacts. They cover scheduling, tap/hold switching, cancellation, numerical stability, swept active-window contacts/misses, one contact per target, moving-target preparation, root ownership, exact movement independence during attacks, animation blending and layout migration. Existing underlying dash, jump, movement, camera, input and sandbox regressions remain. Browser checks exercise real Chromium touch/pointer events, multitouch, action slides, moved controls, Save/Cancel/Reset, portrait/landscape sizes, manual ground/air strikes, Block, misses, extreme physics and production asset routing. Native browser checks cover ground reversals without automatic attacks, manual strikes during recovery, restrained curved turns, attacks during directional double-jump flips, Block, independent air steering, inversion and landing. Screenshots are written to `test-results/`.

Browser testing uses desktop Chromium and Android-style touch emulation. **No physical Android phone or hardware performance is claimed.** The on-screen FPS indicator remains available for your device playtest.

## GitHub Pages deployment

The existing [Deploy GitHub Pages workflow](.github/workflows/deploy-pages.yml) runs logic tests, builds with the correct `/Kinetic-stickman/` Vite base, runs the production browser suite, uploads `dist/` and deploys every successful push to `main`. Movement and encounter browser checks run as independent parallel matrix jobs so software rendering stays within each job budget. Both jobs must pass before deployment; only the movement job uploads the shared Pages artifact. `npm run test:pages` still runs the entire suite by default; `PAGES_TEST_SUITE=movement` or `encounter` selects a CI partition. Pull requests run checks without publishing. Assets/fonts are bundled locally; no external rendering service is required.

Pages is already enabled for this repository. To inspect or rerun deployment from Android:

1. Open [the repository](https://github.com/dearsvincent-ctrl/Kinetic-stickman) and its **Actions** tab.
2. Choose **Deploy GitHub Pages** and inspect the latest run. To retry, tap **Run workflow**, select `main`, and confirm Run workflow.
3. If Pages needs enabling, open **Settings → Pages → Build and deployment → Source → GitHub Actions**. Chrome's **Desktop site** mode may help expose GitHub settings on a phone.
4. Wait for green build/deploy jobs, then open the deployment link or the play URL above. Refresh until **0.8.6** appears.

No personal access token, added secret, `gh-pages` branch or local phone build is needed. This release stops at Version 0.8.6 for Android playtesting.
