# Kinetic — Movement Lab v0.7.9

A mobile-first Three.js/Vite stickman prototype. Version 0.7.9 adds a **2,000 × 2,000-unit arena, active enemy waves, health, blocking and physical strike damage**. The v0.7.8 directional double jump, 1.5× original jump-height baseline, manual combat, analogue movement, momentum recovery, camera, saved layouts, sandbox and preserved dash physics remain in place.

## Play on Android

Open **https://dearsvincent-ctrl.github.io/Kinetic-stickman/?v=0.7.9** in Android Chrome. No computer, installation or local build is needed. Refresh until the header shows **0.7.9**. Landscape gives the controls more space; portrait is supported.

| Action            | Touch                                                       | Desktop                            |
| ----------------- | ----------------------------------------------------------- | ---------------------------------- |
| Move / sprint     | Extend MOVE progressively: slow walk → jog → run → sprint   | WASD/arrows; Shift for full sprint |
| Punch             | Tap once; hold to repeat after full recovery                | Tap / hold F                       |
| Kick              | Tap once; hold to repeat after full recovery                | Tap / hold G                       |
| Block             | Hold; takes priority over attacks                           | Hold Q                             |
| Jump              | Tap/slide onto JUMP; press again in the air                 | Space                              |
| Camera            | Drag on the right side                                      | Mouse drag on the right            |
| Reset View        | Small top-right RESET VIEW button                           | R                                  |
| Edit Controls     | Settings → Edit Controls                                    | Same                               |
| Developer physics | Settings → Developer tools → Open physics sandbox, then DEV | Same                               |

Punch and Kick can start **without an opponent**. Punch uses a basic straight on the ground and an upper-body aerial straight while airborne. Kick uses a grounded front kick or the existing flying kick in the air. Approach the orange dummy and time the strike so its active hitbox actually intersects the body. The dummy's marker briefly flashes green and the readout says **CONTACT** for a confirmed contact. This is a contact signal, not damage or a hit reaction.

Sliding between **Punch, Kick, Block and Jump** uses the same central action router after repositioning controls. Each entry onto Punch/Kick requests one strike. Holding repeats only after the previous technique recovers. The most recently entered held attack takes priority if two attack fingers are down; releasing it allows the other held attack to resume. Brief taps never become held repeats. Fresh taps can redirect a normal strike during recovery, or continue a rotating strike after its short commitment window. Held repeats still wait for full recovery. Requests rejected during commitment are discarded; there is no combo queue. Releasing a button finishes the current strike/recovery and stops repeats. Block cancels an active strike into recovery and suppresses new attacks while held.

Combat never reduces movement speed, applies root motion, pulls the character toward a target or automatically turns toward the dummy. Keep using the analogue joystick and Jump while attacking. When collision would leave the fighter facing a tiny tangent slide, facing smoothly retains the last joystick intent; it never reads the opponent to aim. A ground-only strike yields to takeoff; an air-only strike yields to landing. Held input can resume the appropriate technique when the new physical phase permits it. There is no automatic attack merely from standing near the dummy.

**Dash is removed from the normal HUD, keyboard bindings and layout editor.** Its physical ground/aerial implementations remain in the code for future movement abilities. Developer mode retains E and a **Test preserved dash** utility inside the physics panel, so its existing dash sliders remain testable on a phone. Dash still moves continuously, steers, collides, permits ground-dash-to-jump transitions and tracks its aerial allowance independently.

## Active combat and expanded arena (v0.7.9)

Normal play starts **wave 1 with three red fighters**. Enemies detect within 60 m, pursue after detection, run toward the player, spread around them, and take staggered attack opportunities. Their states are Idle, Approach, Position, Attack, Recover, Stagger and Defeated. Punches have 0.32 s startup; kicks have 0.43 s startup, followed by active contact and recovery. Early waves allow one attacking enemy at a time; later waves allow two, with at least 0.5 s between starts. Escape a telegraphed strike by moving or jumping: proximity alone never causes damage.

The player starts with **120 HP**, enemies with **72 HP**. Confirmed player punches deal 18 and kicks 28; enemy punches deal 10 and kicks 15 before gradual wave scaling. Each strike can contact each opponent only once. The existing active-window, swept weapon/body queries also track moving target positions; attack reach never scales with travel speed. Enemy stagger cancels its current strike. Knockback is a bounded, decaying, collision-resolved impulse; it never changes the joystick's movement parameters. Player hit reactions are visual and do not lock movement or attacks.

**Block** covers the forward 144° arc. A newly raised guard (first 0.16 s) prevents damage; a maintained guard reduces front damage by 85%. Attacks from behind connect normally. Health bars above enemies flash on hits. The compact HUD shows player HP, wave, living enemies and total defeated enemies, with restrained screen-edge damage/block feedback. Defeated enemies fall and stop colliding or attacking. Player defeat disables gameplay input and offers **RESPAWN**. The HUD's small **RESET** button also restores full health and restarts wave 1. Respawn retains saved controls, live sandbox multipliers and camera orbit. New lives have 1.5 s spawn protection.

After clearing a wave, the next spawns after 2.5 s. Every two waves add an enemy, capped at **eight**; enemy health, running speed and damage rise gradually with safe ceilings. Spawn positions form a separated ring roughly 9–15 m from the player, including near arena corners. Reset starts a fresh defeated count; no reload is required.

The floor and swept collision bounds both span ±1,000 m. A repeated 256 px grid, central training markings, four instanced perimeter rails, one local 1,024 px shadow map and distance fog keep geometry/light costs bounded. Camera angle, follow distance, drag and Reset View are unchanged; the far plane supports the expanded field and high jumps. Enemy rigs share limb geometry and materials. Eight preallocated agents are reused between waves; distant rig animation is throttled and presentation is hidden past 220 m while pursuit continues.

The stationary dummy remains as a supplementary contact target and does not count toward waves or kills. Optional **`?practice=1`** retains isolated stationary-target practice without active waves. Historical movement/control browser regressions explicitly use that fixture; separate browser checks exercise the normal active encounter, damage, defeating enemies, wave progression, Block and respawn. Normal game URLs always start active combat.

The encounter uses simple kinematic circular footprints and torso/head/hip strike spheres, not a ragdoll or skeletal hurtbox simulation. Enemies currently fight on the ground; the player retains aerial strikes, steering and flips. No progression, animation overhaul, parkour or multiplayer is added.

## Momentum recovery and aerial control (v0.7.9)

**Sharp ground turns do not attack.** Back, diagonal and lateral reversals produce a short foot plant, knee compression, hip/shoulder counter-rotation and push-off, driven by actual collision-resolved velocity and braking. Detection accepts broad angles (65°–180°), including direct direction changes without a centre-crossing gesture. Gentle turns remain ordinary locomotion. The recovery layer observes movement; it cannot change speed, acceleration, steering, position or ability availability.

Forceful plants leave restrained dust-coloured ground streaks. Actual speed and braking determine intensity. Sixteen pooled instances share one geometry, material and instanced mesh; weak walking changes emit nothing. Superhuman travel uses larger, stronger streaks, with bounded leg reach and effect size.

Manual Punch and Kick can start during recovery. Grounded kicks shift weight over a supporting foot; running support yields to travel. Punches coordinate hip/shoulder drive and unwind through recovery. Existing pose snapshots and shared limb-entry targets blend attacks from the current body configuration. Both sides remain available, with contextual selection and mechanically appropriate same-limb repeats. Holding attacks still repeats only after the configured technique recovery; no new combat cooldown or input lock is introduced.

**Directional double jump:** tap Jump, then press it again while airborne. Holding the joystick is supported. The second launch replaces vertical velocity with the current configured launch velocity; it never adds a second impulse on top of existing vertical speed. A third press is discarded until landing. Takeoff and landing recovery do not buffer extra jumps. The HUD shows **JUMP 2** while the airborne second jump is available.

On the **second** Jump: forward input starts a frontflip, backward input starts a backflip, and centred input stays upright. Diagonals work; purely lateral input stays upright. Direction is measured against the intended world travel/facing captured at the first Jump, including camera-relative input. For example, a rightward takeoff followed by right + Jump is a frontflip; left + Jump is a backflip. Subsequent steering or camera orbit does not replace that reference. Rapid joystick flicks alone never initiate rotation.

The existing quaternion body pivot, tuck, inverted easing and landing recovery are reused for both rotation directions. Forward pressure accelerates forward rotation or brakes backward rotation; backward pressure does the opposite. Release to coast through the soft inverted phase. Side pressure still adds roll/yaw. Gravity, air steering and horizontal momentum remain independent. Punch/Kick/Block remain available without waiting for a turn to finish.

**New default and sandbox:** the original sandbox multiplies target jump height, then derives launch velocity as `sqrt(2 × gravity × height)`. The baseline therefore changes from **0.8 m to 1.2 m** (0.8 × 1.5); launch velocity scales by **√1.5**, not 1.5. Sandbox **1.0×** now means that 1.2 m baseline. Additional Jump Height multipliers apply once: 2× = 2.4 m of rise per launch at unchanged gravity. Both jumps read the same current configuration, including changes made between launches. Existing saved modifiers remain relative modifiers; Normal/Reset restores the new 1.0× baseline. An aerial jump does not refill the aerial dash allowance.

Whip-kick, descending-sweep and rotational-backhand definitions, explicit technique requests and their contact/transition framework remain in the code for future deliberate attacks. Normal ground locomotion no longer invokes those requests or starts a body spin.

### Android playtest checklist

1. Walk, jog and sprint, then make back, diagonal and sideways reversals. Steering should respond immediately; sharp turns should plant/compress/rebound without starting a strike. Gentle curved turns should stay understated.
2. Tap/hold Punch and Kick during a plant, slide between them and Block, and release. Look for either limb, possible same-limb repeats, grounded support and smooth follow-through without a neutral reset.
3. Jump twice with forward, backward, diagonal and neutral input. Keep the joystick held. Try a rightward takeoff to check the reference frame. A third press must do nothing; landing must restore both jumps. Punch/Kick/Block and counter-steering should remain responsive during either flip. Try flicking without a second Jump: no flip should start.
4. Try Enhanced/Extreme presets and 100× travel with broad reversals. Check restrained effects at ordinary speed and stronger plants/streaks at high speed. Watch for stretched legs or camera jitter. The existing developer Dash utility can still chain ground Dash → Jump → aerial Dash.
5. Repeat with saved/repositioned controls, different orientations and simultaneous joystick/action/camera fingers. Use the on-screen FPS readout on your device.

### Scope and limitations

Support and recovery are procedural visual approximations, not a rigid-body balance or ragdoll solver. At superhuman travel speeds, a human-length leg cannot stay anchored across many metres: visual contacts yield within bounded reach and can slide. A bounded angular spring assists landing, with up to 0.3 m of visual-only clearance for a late inverted pose. It never moves the physical actor or suspends gravity. Detailed body/floor collisions, perfectly planted pivots, arbitrary technique chains and moving-opponent prediction remain future work. No new attacks, character attributes or progression systems are added.

## Custom controls and layout migration

Settings → **Edit Controls** pauses gameplay and lets you drag **Move, Block, Jump, Punch and Kick** with touch or a mouse. Save commits the arrangement; Cancel discards unsaved edits; Reset to Default previews the responsive defaults until saved. Inputs are released when editing, pausing, losing focus, rotating or cancelling a touch.

Positions are normalized to the playable viewport and saved under `kinetic.controls.v1`. The compatible version-1 schema migrates old Dash/Sprint layouts by preserving the exact saved Move/Block/Jump coordinates, removing retired entries and initializing Punch/Kick independently. Remaining legal controls are placed first when projecting a custom layout; new buttons reflow around them. Screen resizing can constrain visible placement around essential UI and other controls without destroying the stored anchors. Invalid data falls back safely; a failed migration write keeps the valid layout usable in memory. Physics configurations use a separate storage key.

## Developer physics sandbox

Open **https://dearsvincent-ctrl.github.io/Kinetic-stickman/?sandbox=1&v=0.7.9** and tap **DEV**. The panel is opt-in, collapsible and scrollable; it does not pause gameplay. Other fingers retain joystick/action/camera ownership while a slider is adjusted. Normal play ignores saved developer multipliers. This tool is separate from any future progression system.

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

- `BattleWorld.js`, `EnemyAgent.js`, `Combatant.js`: bounded wave pool, deterministic attack opportunities, stateful pursuit/positioning, health, timed directional Block and collision-resolved damage impulses.
- `EnemyViews.js`, `BattleHud.js`: shared rig presentation, distance throttling, health/defeat feedback and reset. `ArenaConfig.js` is the source of truth for the expanded floor, collision dimensions and rendering distance.

- `ManualTechniques.js`: separate ground/air Punch and Kick definitions. Each declares startup, active duration, recovery, playback speed, reach, hit radius and ground/air eligibility. `createManualTechniques()` resolves them to the existing windup/extension/impact/recovery animation phases. Code-only `punchSpeed`, `kickSpeed` and `recoverySpeed` factors remain available for future tuning; **no new sandbox parameters are added** in this version.
- `AdaptiveTechniques.js`: seven mirrored procedural families and deterministic pose/momentum-based limb selection. `TechniqueGeometry.js` shares strike targets and captured limb-entry poses between procedural IK and contact queries.
- `MomentumRecovery.js`: collision-resolved velocity/braking observer with broad-angle recovery classification. `MomentumRecoveryAnimator.js` and `GroundCombatBalance.js` layer bounded foot support and additive body loading over the existing gait. `GroundStreaks.js` owns the fixed instanced effect pool.
- `JoystickGestures.js`: pure take-off-reference and directional second-jump selection; no flick history or automatic activation. `JumpState.js` owns the two-jump allowance and ballistic relaunch; `CharacterController.js` preserves horizontal movement and publishes accepted jump events. `BodyRotation.js`: separate normalized quaternion/angular velocity, bounded substeps, steerable torque, inverted drag and upright recovery. Neither changes physical translation.
- `AcrobaticPresenter.js`, `ArmIK.js`, `LegIK.js`, `PoseTransitions.js`: body-only pelvis pivot, shared strike targets, supporting-leg approximation and current-pose crossfades; the original root and camera remain upright.
- `AttackScheduler.js`: one bounded entry request plus held intent. It schedules by gameplay recovery boundaries, independently of render/animation loops. It never queries target range or changes movement.
- `CombatController.js`: technique timing, cancellation, defensive priority and immutable accepted-strike context.
- `StrikeHitDetector.js`: sweeps a bounded weapon sphere against moving enemy/player body spheres and the dummy's body/post hitboxes only during the technique's active window. It clips startup/recovery time out of movement segments, samples quaternion-oriented hand/ankle trajectories with bounded angular subdivisions, preserves body-local reach limits, and records each target once per strike. The dummy has body and low post hitboxes matching its visible geometry. Previous/current opponent positions support relative sweeps. Contact callbacks carry sequence, technique, opponent, time, contact point and contact-time source; the encounter applies damage and reactions.
- `Game.simulateMovement()`: advances physical movement once at its own step size, then samples the resolved path at combat boundaries. Attack timing cannot change the ground integrator, acceleration, jump gravity, speed or dash state. Physics and visual presentation remain separate.
- `TouchActionRouter.js`: reusable HOLD, PRESS, TOGGLE and TAP_HOLD behaviors with dynamic DOM hit testing, independent contact ownership, keyboard/accessibility support, capture fallback and cancellation. TAP_HOLD combines one entry request with held-state reporting; the router does not itself repeat attacks.
- Existing punch and kick animators blend with locomotion and jump/dash poses. Manual punches retain the athletic lower-body gait at running/sprinting speed; the guard remains on the upper body. Deliberate Block retains defensive footwork. Aerial punches retain lower-body flight animation; the grounded kick retains the moving support leg. Animators never translate the physical root.

The former `ProximityCombatController` and legacy technique definitions remain unwired library code with regression coverage. They are **not instantiated by the game**. Manual attacks do not depend on target acquisition. Swept contact sensing does not enlarge reach with speed, guarantee a hit or compensate for poor timing. A strike that passes the dummy only during startup or recovery misses.

The arena still uses swept horizontal bounds and a stationary circular dummy footprint. It does not simulate jumping over/onto props, uneven terrain, camera obstacle collision, rigid-body impacts or ragdolls. The hierarchy/kinematic adapter remain suitable for a later Rapier integration.

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

Logic tests additionally cover broad-angle recovery, exact movement independence at normal/100× settings, bounded effects, grounded support, manual attacks during recovery, directional double jumping versus ordinary air steering, three-axis normalization, counter-rotation/inverted easing, upright recovery, contextual and repeated same-limb selection, kick-to-backhand continuation, pose continuity and rotational swept contacts. They cover scheduling, tap/hold switching, cancellation, numerical stability, swept active-window contacts/misses, one contact per target, moving-target preparation, root ownership, exact movement independence during attacks, animation blending and layout migration. Existing underlying dash, jump, movement, camera, input and sandbox regressions remain. Browser checks exercise real Chromium touch/pointer events, multitouch, action slides, moved controls, Save/Cancel/Reset, portrait/landscape sizes, manual ground/air strikes, Block, misses, extreme physics and production asset routing. Native browser checks cover ground reversals without automatic attacks, manual strikes during recovery, restrained curved turns, attacks during directional double-jump flips, Block, rotational steering, inversion and landing. Screenshots are written to `test-results/`.

Browser testing uses desktop Chromium and Android-style touch emulation. **No physical Android phone or hardware performance is claimed.** The on-screen FPS indicator remains available for your device playtest.

## GitHub Pages deployment

The existing [Deploy GitHub Pages workflow](.github/workflows/deploy-pages.yml) runs logic tests, builds with the correct `/Kinetic-stickman/` Vite base, runs the production browser suite, uploads `dist/` and deploys every successful push to `main`. Pull requests run checks without publishing. Assets/fonts are bundled locally; no external rendering service is required.

Pages is already enabled for this repository. To inspect or rerun deployment from Android:

1. Open [the repository](https://github.com/dearsvincent-ctrl/Kinetic-stickman) and its **Actions** tab.
2. Choose **Deploy GitHub Pages** and inspect the latest run. To retry, tap **Run workflow**, select `main`, and confirm Run workflow.
3. If Pages needs enabling, open **Settings → Pages → Build and deployment → Source → GitHub Actions**. Chrome's **Desktop site** mode may help expose GitHub settings on a phone.
4. Wait for green build/deploy jobs, then open the deployment link or the play URL above. Refresh until **0.7.9** appears.

No personal access token, added secret, `gh-pages` branch or local phone build is needed. This release stops at Version 0.7.9 for Android playtesting.
