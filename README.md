# Kinetic — Movement Lab v0.7.5

A mobile-first Three.js/Vite stickman prototype. Version 0.7.5 replaces automatic proximity attacks with player-controlled **Punch** and **Kick**. Normal movement, integrated analogue sprinting, jumping, air steering, Block, camera controls, custom layouts and the developer physics sandbox are preserved. There is no enemy AI, health, damage, grappling, multiplayer or combo system.

## Play on Android

Open **https://dearsvincent-ctrl.github.io/Kinetic-stickman/?v=0.7.5** in Android Chrome. No computer, installation or local build is needed. Refresh until the header shows **0.7.5**. Landscape gives the controls more space; portrait is supported.

| Action            | Touch                                                       | Desktop                            |
| ----------------- | ----------------------------------------------------------- | ---------------------------------- |
| Move / sprint     | Extend MOVE progressively: slow walk → jog → run → sprint   | WASD/arrows; Shift for full sprint |
| Punch             | Tap once; hold to repeat after full recovery                | Tap / hold F                       |
| Kick              | Tap once; hold to repeat after full recovery                | Tap / hold G                       |
| Block             | Hold; takes priority over attacks                           | Hold Q                             |
| Jump              | Tap or slide onto JUMP                                      | Space                              |
| Camera            | Drag on the right side                                      | Mouse drag on the right            |
| Reset View        | Small top-right RESET VIEW button                           | R                                  |
| Edit Controls     | Settings → Edit Controls                                    | Same                               |
| Developer physics | Settings → Developer tools → Open physics sandbox, then DEV | Same                               |

Punch and Kick can start **without an opponent**. Punch uses a basic straight on the ground and an upper-body aerial straight while airborne. Kick uses a grounded front kick or the existing flying kick in the air. Approach the orange dummy and time the strike so its active hitbox actually intersects the body. The dummy's marker briefly flashes green and the readout says **CONTACT** for a confirmed contact. This is a contact signal, not damage or a hit reaction.

Sliding between **Punch, Kick, Block and Jump** uses the same central action router after repositioning controls. Each entry onto Punch/Kick requests one strike. Holding repeats only after the previous technique recovers. The most recently entered held attack takes priority if two attack fingers are down; releasing it allows the other held attack to resume. Brief taps never become held repeats. Requests made during recovery are rejected rather than stored in a combo queue. Releasing a button finishes the current strike/recovery and stops repeats. Block cancels an active strike into recovery and suppresses new attacks while held.

Combat never reduces movement speed, applies root motion, pulls the character toward a target or automatically turns toward the dummy. Keep using the analogue joystick and Jump while attacking. When collision would leave the fighter facing a tiny tangent slide, facing smoothly retains the last joystick intent; it never reads the opponent to aim. A ground-only strike yields to takeoff; an air-only strike yields to landing. Held input can resume the appropriate technique when the new physical phase permits it. There is no automatic attack merely from standing near the dummy.

**Dash is removed from the normal HUD, keyboard bindings and layout editor.** Its physical ground/aerial implementations remain in the code for future movement abilities. Developer mode retains E and a **Test preserved dash** utility inside the physics panel, so its existing dash sliders remain testable on a phone. Dash still moves continuously, steers, collides, permits ground-dash-to-jump transitions and tracks its aerial allowance independently.

## Custom controls and layout migration

Settings → **Edit Controls** pauses gameplay and lets you drag **Move, Block, Jump, Punch and Kick** with touch or a mouse. Save commits the arrangement; Cancel discards unsaved edits; Reset to Default previews the responsive defaults until saved. Inputs are released when editing, pausing, losing focus, rotating or cancelling a touch.

Positions are normalized to the playable viewport and saved under `kinetic.controls.v1`. The compatible version-1 schema migrates old Dash/Sprint layouts by preserving the exact saved Move/Block/Jump coordinates, removing retired entries and initializing Punch/Kick independently. Remaining legal controls are placed first when projecting a custom layout; new buttons reflow around them. Screen resizing can constrain visible placement around essential UI and other controls without destroying the stored anchors. Invalid data falls back safely; a failed migration write keeps the valid layout usable in memory. Physics configurations use a separate storage key.

## Developer physics sandbox

Open **https://dearsvincent-ctrl.github.io/Kinetic-stickman/?sandbox=1&v=0.7.5** and tap **DEV**. The panel is opt-in, collapsible and scrollable; it does not pause gameplay. Other fingers retain joystick/action/camera ownership while a slider is adjusted. Normal play ignores saved developer multipliers. This tool is separate from any future progression system.

The original eight sliders still support **0.1×–100×**, with precise stops near 1×, 10×, 20×, 50× and 100×:

| Parameter            | 1× default                                                              |
| -------------------- | ----------------------------------------------------------------------- |
| Movement speed       | Walk 1.3, run 2.6, maximum sprint 5.2 m/s; entire analogue curve scales |
| Jump height          | 0.8 m                                                                   |
| Ground dash speed    | 10 m/s average                                                          |
| Ground dash distance | 2.5 m                                                                   |
| Aerial dash speed    | 10 m/s average                                                          |
| Aerial dash distance | 2.5 m                                                                   |
| Air steering/control | 3.5/s response                                                          |
| Gravity              | 18 m/s²                                                                 |

**Normal**, **Enhanced** and **Extreme** presets are unchanged. **Reset to Defaults** applies Normal. **Save custom** stores one configuration locally; **Load saved** recalls it. Refreshing a sandbox URL loads the saved configuration. Reset/presets do not overwrite the saved configuration until Save is pressed. Storage uses `kinetic.physics-sandbox.v1`; unavailable/corrupt storage cannot corrupt the movement state or control-layout save.

Movement speed, gravity and normal air control apply live. Jump height affects the next launch, whose velocity is `sqrt(2 × effective gravity × desired height)`. Dash speed and distance determine duration independently and apply on the next burst; editing sliders never rewrites an impulse in progress. Existing momentum, cooldowns, steering and the one-air-dash-per-jump allowance remain intact.

Numeric bounds are configurable in `PhysicsSandbox.js`. Defaults allow up to 520 m/s locomotion, 80 m jump height, 1,000 m/s average dash speed, 250 m dash distance and 1,800 m/s² gravity. The game bounds catch-up work, uses up to 32 adaptive physical steps and swept world/strike queries, and keeps animation cadence/leg reach bounded. Short bursts receive a readable visual launch; long developer dashes animate a cruise between launch and touchdown. The camera bounds extreme follow lag while preserving its angle, distance, orbit and Reset View. Superhuman travel can still produce some visual foot sliding on a human-sized rig.

## Combat architecture

- `ManualTechniques.js`: separate ground/air Punch and Kick definitions. Each declares startup, active duration, recovery, playback speed, reach, hit radius and ground/air eligibility. `createManualTechniques()` resolves them to the existing windup/extension/impact/recovery animation phases. Code-only `punchSpeed`, `kickSpeed` and `recoverySpeed` factors are prepared for v0.7.6; **no new sandbox parameters are added** in this version.
- `AttackScheduler.js`: one bounded entry request plus held intent. It schedules by gameplay recovery boundaries, independently of render/animation loops. It never queries target range or changes movement.
- `CombatController.js`: technique timing, cancellation, defensive priority and immutable accepted-strike context.
- `StrikeHitDetector.js`: sweeps a bounded weapon sphere against the dummy's actual body sphere only during the technique's active window. It clips startup/recovery time out of movement segments, accounts for physical movement and limited yaw rotation, preserves configured reach/facing/vertical limits, and records each target once per strike. Optional previous opponent positions support future relative sweeps. Contact callbacks carry sequence, technique, opponent, time and contact point; no damage/health is applied.
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

Logic tests cover scheduling, tap/hold switching, cancellation, numerical stability, swept active-window contacts/misses, one contact per target, moving-target preparation, root ownership, exact movement independence during attacks, animation blending and layout migration. Existing underlying dash, jump, movement, camera, input and sandbox regressions remain. Browser checks exercise real Chromium touch/pointer events, multitouch, action slides, moved controls, Save/Cancel/Reset, portrait/landscape sizes, manual ground/air strikes, Block, misses, extreme physics and production asset routing. Screenshots are written to `test-results/`.

Browser testing uses desktop Chromium and Android-style touch emulation. **No physical Android phone or hardware performance is claimed.** The on-screen FPS indicator remains available for your device playtest.

## GitHub Pages deployment

The existing [Deploy GitHub Pages workflow](.github/workflows/deploy-pages.yml) runs logic tests, builds with the correct `/Kinetic-stickman/` Vite base, runs the production browser suite, uploads `dist/` and deploys every successful push to `main`. Pull requests run checks without publishing. Assets/fonts are bundled locally; no external rendering service is required.

Pages is already enabled for this repository. To inspect or rerun deployment from Android:

1. Open [the repository](https://github.com/dearsvincent-ctrl/Kinetic-stickman) and its **Actions** tab.
2. Choose **Deploy GitHub Pages** and inspect the latest run. To retry, tap **Run workflow**, select `main`, and confirm Run workflow.
3. If Pages needs enabling, open **Settings → Pages → Build and deployment → Source → GitHub Actions**. Chrome's **Desktop site** mode may help expose GitHub settings on a phone.
4. Wait for green build/deploy jobs, then open the deployment link or the play URL above. Refresh until **0.7.5** appears.

No personal access token, added secret, `gh-pages` branch or local phone build is needed. Stop at Version 0.7.5 for Android playtesting before exposing attack-speed controls in a later release.
