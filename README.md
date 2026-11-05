# Kinetic — Movement Lab v0.5

A mobile-first, third-person 3D stickman prototype built with JavaScript, Three.js, and Vite. The arena opens directly into play. Version 0.5 adds one basic punch, held defensive Block, and automatic combat posture through the existing slide-to-activate controls. There is no manual combat-mode switch.

The existing camera angle and controls, progressive joystick, acceleration/deceleration, 2.6 m/s movement speed, 5.2 m/s sprint speed, arena, boundaries, and rendering settings are preserved. The locomotion layers coordinate arms and legs, bend the knees, move the hips and torso, and blend between idle and faster gaits using actual travel speed. Planted feet and two-bone leg IK reduce sliding on the flat floor.

Tap or slide onto **ATTACK** to throw a basic right punch with arm extension, torso rotation, and recovery. Hold or slide onto **BLOCK** to maintain a defensive guard while moving. The guard raises automatically for attacks and blocking, with balanced feet, idle breathing, and small weight shifts, then blends back to ordinary movement. Attacks and blocking do not change movement speeds or stop walking, running, sprinting, or dashing.

Tap **DASH** for a short movement burst, normally 2.5 metres over 0.25 seconds. The dash starts in the camera-relative joystick direction, or the character's facing direction when the joystick is centred. Steer during the dash to curve its path; releasing the joystick keeps the current trajectory. A push-off, directional torso lean, low bound, and recovery blend over the existing animation, including while guarding. Version 0.5 has no Jump, enemies, health, damage, combos, contextual strikes, special abilities, invincibility frames, stamina costs, progression, multiplayer, ragdolls, or rigid-body simulation. Attack and Block currently control movement-independent animation and state only.

## Play on Android with GitHub Pages

GitHub Pages is already enabled for this repository using GitHub Actions. Open **https://dearsvincent-ctrl.github.io/Kinetic-stickman/** in Android Chrome. No computer, local build, app installation, or terminal on your phone is needed. Updates appear after the deployment workflow succeeds; if the header still shows an older version, reload the page after the run turns green.

To check or rerun deployment from your phone:

1. Sign in to GitHub in Chrome and open [dearsvincent-ctrl/Kinetic-stickman](https://github.com/dearsvincent-ctrl/Kinetic-stickman).
2. Open the repository's **Actions** tab. If GitHub shows an Actions-disabled banner, enable workflows for this repository.
3. Open [Settings → Pages](https://github.com/dearsvincent-ctrl/Kinetic-stickman/settings/pages). Under **Build and deployment → Source**, choose **GitHub Actions**. Do not select a branch or create a `gh-pages` branch. If Settings or the controls are hidden on the mobile layout, open Chrome's three-dot menu and enable **Desktop site**.
4. Open [Actions](https://github.com/dearsvincent-ctrl/Kinetic-stickman/actions), choose **Deploy GitHub Pages**, tap **Run workflow**, select **main**, and tap **Run workflow** again. This also retries an initial run that failed before Pages was enabled.
5. Wait for that run's build and deploy jobs to finish with green check marks. Open its **github-pages** deployment link, or return to **Settings → Pages → Visit site**.
6. Rotate the phone to landscape and play. Drag the left joystick to move, drag the right side to look, hold **SPRINT** to run, tap or slide onto **ATTACK** and **DASH**, and hold **BLOCK** to guard.

Every later push or merged pull request to `main` automatically rebuilds and deploys the game. Pull requests run checks without publishing. If a page initially returns 404, confirm the deployment job succeeded and allow GitHub a short time to publish it, then reload the exact URL above, including its final slash.

The workflow uses GitHub's built-in token and Pages deployment identity. You do not need to create secrets, a personal access token, or an external hosting account.

## Local development (optional)

Use Node.js 22.12+ and npm. The browser must support WebGL 2.

```sh
npm ci
npm run dev
```

Open `http://localhost:5173`. Vite listens on `0.0.0.0`, so another device can connect over your local network.

For an Android phone, connect the phone and development computer to the same Wi-Fi network, find the computer's LAN IP address, and open `http://<computer-LAN-IP>:5173` in Chrome. Allow incoming connections to port 5173 through the computer's firewall if necessary. `localhost` on the phone refers to the phone itself. Rotate to landscape; portrait also adapts, but leaves less room around the controls.

## Controls

| Action               | Touch                                     | Desktop                        |
| -------------------- | ----------------------------------------- | ------------------------------ |
| Move                 | Drag the bottom-left joystick             | WASD or arrow keys             |
| Look                 | Drag the right side of the viewport       | Click and drag the right side  |
| Sprint               | Hold or slide onto SPRINT                 | Hold Shift                     |
| Basic punch          | Tap or slide onto ATTACK                  | Press F                        |
| Defensive guard      | Hold or slide onto BLOCK                  | Hold Q                         |
| Directional dash     | Tap or slide onto DASH                    | Press E                        |
| Reset camera         | Tap RESET VIEW                            | Press R                        |
| Instructions / pause | Tap the question-mark button              | Click the question-mark button |
| Fullscreen           | Tap the fullscreen button where supported | Click the fullscreen button    |

Start a finger on any gameplay action button, then slide it between buttons without lifting:

- **HOLD — SPRINT and BLOCK:** active while a finger is inside. Leaving releases the action; sliding back immediately resumes it. Block raises and maintains guard rather than selecting a persistent mode.
- **PRESS — ATTACK and DASH:** requests the action once on entry. ATTACK must finish recovery before a new punch is accepted; DASH must finish its cooldown. Staying inside does not repeat, queue a future action, or activate it automatically when it becomes available.

Sliding from SPRINT onto DASH releases sprint and requests a dash. Sliding from BLOCK onto ATTACK releases Block first, then requests a punch if recovery has finished. Crossing a gap releases any HOLD action but keeps that finger assigned to gameplay buttons until it lifts or is cancelled. Joystick and camera fingers retain their original controls when crossing buttons. Multiple action fingers work independently; if two hold the same HOLD action, it remains active until both leave. This allows simultaneous joystick steering, camera dragging, and action input. The layout leaves room for a future Jump button; no Jump control or action is included.

Block takes priority over Attack. A punch requested while Block is held is rejected. Raising Block during a punch cancels its remaining extension into a smooth recovery; releasing Block does not resume the cancelled punch. Requests during attack recovery are discarded rather than buffered. Leave and re-enter ATTACK after recovery, or press F again, to throw another punch. Releasing Block lets the automatic posture settle smoothly back to the current movement gait.

Joystick travel controls normal movement speed, with a small central dead zone. Movement uses the camera's horizontal direction; the character smoothly faces the direction of travel. Releasing normal movement decelerates to idle. Camera reset returns to the character's current heading, with the default low viewing angle and 4.8-metre follow distance. RESET VIEW is a separate tap-only utility beneath the top-right DRAG TO LOOK hint, with responsive spacing and a reduced height of 28 pixels on desktop and 32 pixels on touch devices. Sliding gameplay fingers over it does not reset the camera.

DASH triggers once per button entry or keyboard press. Its cooldown starts when the dash begins: the default 0.7 seconds includes the 0.25-second dash, leaving about 0.45 seconds afterwards. The button shows the remaining cooldown; entering it while unavailable does not queue another dash. Dashing works during attacks or blocking and while sprint is held. Steering turns gradually, with a bounded turn rate so direction changes retain momentum. The configured distance is path length, so a curved dash has shorter net displacement; walls can shorten the distance actually travelled.

Touch gestures, page scrolling, text selection, and dragging are suppressed within the game. Momentary input clears when a touch is cancelled, the page loses focus, becomes hidden, or changes size/orientation to prevent stuck movement or Block. Pausing or losing focus cancels an active or pending dash without clearing its cooldown and cancels a punch into recovery. Simulation time, including cooldown and recovery, pauses while the game is paused or backgrounded. Focused gameplay buttons also support Space and Enter through the shared action system; holding an Attack key does not repeatedly punch.

## Production builds and deployment

[`.github/workflows/deploy-pages.yml`](.github/workflows/deploy-pages.yml) installs the locked dependencies, runs the tests, builds `dist/`, verifies production asset loading, uploads the Pages artifact, and deploys it from `main`. It also supports the manual run described above. GitHub performs these steps; Android users do not need to run the commands themselves.

`vite.config.js` uses `build/pagesBase.js` to select the Pages asset prefix from `GITHUB_REPOSITORY` when `GITHUB_PAGES=true`. For this repository the prefix is `/Kinetic-stickman/`, so JavaScript, CSS, fonts, and the favicon load beneath the repository URL. A repository named `<owner>.github.io` uses `/`. Ordinary local builds retain the relative `./` base.

For developers, reproduce the Pages build locally with:

```sh
GITHUB_PAGES=true GITHUB_REPOSITORY=dearsvincent-ctrl/Kinetic-stickman npm run build
PAGES_TEST_BASE=/Kinetic-stickman/ npm run test:pages
```

For a normal local build and preview:

```sh
npm run build
npm run preview
```

The production build is written to `dist/`. Preview it at `http://localhost:4173`; preview is for local verification, not a production server. A Pages-specific build is served beneath `/Kinetic-stickman/`, so use that path when previewing it.

For other static HTTPS hosts, use the ordinary `npm run build` command without the Pages environment variables and publish `dist/`. Netlify or Vercel can use that build command and output directory. No backend, API keys, database, or Node.js runtime is required in production. Open the hosted HTTPS URL on the phone; do not open `index.html` directly as a `file://` URL.

## Project structure

| Module                                  | Responsibility                                                                      |
| --------------------------------------- | ----------------------------------------------------------------------------------- |
| `src/main.js`                           | Application entry point and startup error handling                                  |
| `src/core/Game.js`                      | Renderer, scene composition, game loop, simulation ownership                        |
| `src/core/math.js`                      | Shared damping and angle helpers                                                    |
| `src/ui/Hud.js`                         | FPS/speed readouts, dash/attack availability, combat posture, instructions, fullscreen |
| `src/input/InputController.js`          | Pointer ownership, joystick normalization, keyboard state, camera deltas            |
| `src/input/TouchActionRouter.js`        | Shared HOLD/PRESS/TOGGLE registry, slide routing, cancellation, keyboard activation |
| `src/movement/CharacterController.js`   | Locomotion/dash states, camera-relative steering, facing, world movement            |
| `src/movement/DashState.js`             | Configurable dash timing, acceleration profile, steering, and cooldown              |
| `src/combat/CombatController.js`         | Punch phases and recovery, held Block, automatic posture, technique selection boundary |
| `src/world/ArenaBounds.js`              | Flat-ground movement adapter and boundary containment                               |
| `src/world/createArena.js`              | Lightweight arena visuals, lighting, and authoritative arena dimensions             |
| `src/camera/FollowCamera.js`            | Smoothed follow target, orbit angles, pitch limits, floor clearance                 |
| `src/character/Stickman.js`             | Named hierarchical body parts and joint pivots                                      |
| `src/character/CharacterAnimator.js`    | Composes animation layers and applies the final joint pose                          |
| `src/character/LocomotionAnimator.js`   | Speed-driven gait timing and foot contacts                                          |
| `src/character/CombatStanceAnimator.js` | Smooth defensive guard and balanced stance poses                                    |
| `src/character/DashAnimator.js`         | Dash push-off, directional lean, foot targets, and recovery overlay                 |
| `src/character/AttackAnimator.js`       | Basic right-punch upper-body extension, torso rotation, and recovery overlay         |
| `src/character/LegIK.js`                | Lightweight two-bone leg posing and floor contact                                   |
| `src/style.css`                         | Responsive HUD, touch controls, safe-area spacing                                   |
| `build/pagesBase.js`                    | GitHub Pages repository base-path selection                                         |
| `.github/workflows/deploy-pages.yml`    | Automated checks, production build, and Pages deployment                            |
| `tests/`                                | Movement/camera checks and browser smoke coverage                                   |

All world distances are metres. The coordinate system is Y-up, and the character's local forward direction is −Z. Input uses normalized screen-right `x` and screen-forward `y`; the controller converts these into horizontal world movement.

### Integration boundaries

The movement controller owns the character root position and heading. `CharacterAnimator` owns child joint transforms, never the character root. It composes locomotion, automatic guard, dash, and punch layers, then solves leg poses against their foot targets. The punch overlay acts on the upper body after guard and dash posing; the existing gait and dash layers retain foot ownership. Normal gait phase follows actual resolved movement speed, so the character does not keep running when blocked by a wall. During a dash, its own foot sequence supplies the push-off and landing, then blends back to the current gait or guard. The camera reads the resulting actor position.

`CombatController` separates attack timing, recovery, held Block, and automatic posture from locomotion and rendering. `requestAttack(context)` selects the currently available basic punch, `setBlocking(held)` gives Block priority, and `update(dt)` advances the state. `ready` reports whether another attack can begin. The technique-selection boundary can later use movement direction, opponent distance, and available techniques; this release implements only the basic punch and no contextual bonuses or movement changes. Guard pose logic remains separate from punch animation, leaving room for opponent-aware guard positioning and combat footwork later.

World-space foot contacts reduce stance-foot drift; they can replant during turns and transitions. This remains a procedural visual animation system rather than physical foot collision or motion capture. Attacks do not freeze navigation or alter dash state, collision, steering, or cooldown.

`CharacterController.requestDash()` requests a dash on the next simulation step. Its `movementState` is either `"locomotion"` or `"dash"`; cooldown remains separate so later movement skills can inspect availability without changing the locomotion state. The controller carries the resolved dash exit velocity into the original locomotion damping, keeping steering and deceleration continuous after the burst. `stop()` cancels active and pending dashes while retaining cooldown. `DashState` owns timing, speed profile, steering, and state; `DashAnimator` only poses the existing hierarchy.

`ArenaBounds.move(position, displacement, radius, out)` is the current world-movement contract. It constrains the character's radius inside the arena and fixes its feet to the ground. For Rapier, introduce a world adapter backed by a kinematic character controller and static floor/wall colliders. The controller already derives facing and animation speed from resolved travel and cancels blocked velocity components. Extend that response for slopes and physical contacts when integrating Rapier, which is intentionally not installed yet.

Dash motion integrates the acceleration/cruise/braking profile continuously in substeps no longer than 1/120 second. Every displacement goes through the same world adapter; the character slides along a boundary when possible and stops a dash early if fully blocked. It never teleports to a precomputed destination.

### Extending touchscreen actions

`InputController.actions` exposes the reusable `TouchActionRouter`. Register a button with an ID, DOM element, and `ActionBehavior`; use `onHoldChange` for HOLD and `onActivate` for PRESS or TOGGLE. Sprint and Block use HOLD, while Attack and Dash use PRESS. TOGGLE remains supported by the generic router for future bindings, but Version 0.5 has no toggled combat mode. For example, a future action can be wired without changing the router:

```js
import { ActionBehavior } from "./src/input/TouchActionRouter.js";

const unregister = input.actions.register({
  id: "future-action",
  element: futureButton,
  behavior: ActionBehavior.PRESS,
  onActivate: () => futureActions.request(),
});

// Call unregister() when removing this binding.
```

The future action above is an integration example, not an implemented feature. The `InputController` constructor also accepts an `actionBindings` array using the same registration objects. Registering the same ID or element replaces its old binding and releases its held state; an ongoing action finger can enter the replacement on its next move. The returned disposer only removes its own binding, so an old disposer cannot remove a later reassignment.

The router captures each action finger on a stable root and hit-tests current coordinates with `document.elementFromPoint()`, including coalesced movement samples. Layout changes need no cached hit-box updates. Registration adds `data-touch-action` and `data-touch-behavior`; CSS keeps registered button bounds stable while active. HOLD tracks all occupying fingers, while PRESS and TOGGLE run once per entry. Blur, visibility changes, cancellation, reset, and teardown release momentary ownership. Reset View is deliberately outside this registry.

### Combat timing

`BASIC_PUNCH` and `COMBAT_CONFIG` in `src/combat/CombatController.js` define the initial timing. The basic punch has 0.08 seconds of windup, 0.10 seconds of extension, and 0.24 seconds of recovery. Automatic posture lingers for 0.15 seconds after an action before blending out; Block interrupt recovery takes 0.16 seconds. These are animation and action-availability timings, not hit detection or damage windows.

The controller accepts a technique registry and optional `selectTechnique(context, techniques)` callback. A request receives a frozen context snapshot, so a future selector can inspect distance, movement direction, or available techniques without owning live movement objects. Only `basic-punch` is registered in this release. Movement and dash remain independently controlled.

### Dash tuning

Defaults live in `DASH_CONFIG` in `src/movement/DashState.js`. Pass a `dashConfig` object to the `CharacterController` constructor to override individual values.

| Setting            | Default | Meaning                                                   |
| ------------------ | ------- | --------------------------------------------------------- |
| `distance`         | 2.5 m   | Unobstructed path length over the full dash               |
| `duration`         | 0.25 s  | Burst duration                                            |
| `cooldown`         | 0.7 s   | Time from one dash start until another can begin          |
| `accelerationTime` | 0.04 s  | Initial ramp from the current forward speed               |
| `brakingTime`      | 0.07 s  | Final ramp towards ordinary movement speed                |
| `steeringResponse` | 18 /s   | How quickly the dash follows a changed joystick direction |
| `maxTurnRate`      | 9 rad/s | Maximum steering rate, including reversals                |
| `maxSubstep`       | 1/120 s | Largest collision-aware movement substep                  |

Peak speed is derived from distance, duration, ramp times, and the entry/exit speeds so the profile covers the requested distance. Increasing steering response or turn rate makes redirection sharper; acceleration and braking remain independent of normal walking and sprinting.

The game uses a fixed 60 Hz movement step, with rendering and camera smoothing separate. Frame delta is capped at 80 ms and catch-up work at five steps, preventing a backgrounded tab or long stall from producing a large movement jump. Add Rapier stepping to that simulation boundary rather than tying physics to display refresh rate. Keep character root ownership in one system when introducing physics or root-motion animation.

### Mobile rendering

The scene uses shared low-poly geometry and materials, instanced arena details, a baked floor texture, one shadow-casting directional light, and no postprocessing. WebGL 2 rendering uses antialiasing, ACES tone mapping, a device pixel ratio capped at 1.5, and a 1024 × 1024 soft-shadow map. The FPS readout measures this browser session; it is not a promise of performance on every phone.

## Validation

Version 0.5 passed all 132 unit tests, the production build, and both Chromium browser smoke suites. The production suite served the exact build under `/Kinetic-stickman/` to verify Pages asset paths and touchscreen controls.

Run the checks below and inspect the GitHub Actions run for the current commit. Unit tests cover movement, camera limits, input ownership, Pages base paths, attack recovery, Block priority, automatic posture transitions, animation blending, and character-root ownership. Dash checks cover distance, steering, cooldown, wall containment, state transitions, and animation blending. Action-router checks cover HOLD/PRESS/TOGGLE entry and re-entry, multiple fingers, cancellation, keyboard activation, and binding replacement. Browser checks cover rendering, moving attacks, held Block, native emulated multi-touch input and cancellation, action slides, recovery and dash cooldown, camera reset/pitch limits, instructions, and responsive layout. Screenshots are saved under `test-results/` by the browser scripts. UI fonts are bundled locally; the game makes no external asset requests.

```sh
npm test
npm run build
```

For the browser smoke checks, first leave `npm run dev` running in another terminal, then run:

```sh
npm run test:browser
```

For the production asset check, build `dist/` first and run `npm run test:pages`. It serves the build under the Pages prefix and checks that JavaScript, CSS, fonts, the favicon, the arena, and basic emulated touch input load correctly. `PAGES_TEST_BASE=/Kinetic-stickman/` makes the expected mount explicit. This check starts and closes its own server. The Pages workflow runs it with a Playwright-installed Chromium browser.

The existing development browser script uses Playwright with Chromium at `/usr/bin/chromium` by default. Set `CHROMIUM_PATH` to an installed Chromium-compatible executable if needed:

```sh
CHROMIUM_PATH=/path/to/chromium npm run test:browser
```

In development, opening `http://localhost:5173/?debug` exposes a read-only `window.__KINETIC__.snapshot()` function for inspecting position, inputs, movement state, dash timing, combat phases, camera limits, and render statistics. This hook is excluded from production builds.

Version 0.5 has not been verified on a physical Android device by the implementer. Desktop Chromium and touch emulation can check rendering, pointer behavior, and responsive layouts, but cannot establish real mobile GPU performance, thermals, browser chrome behavior, or device-specific touch handling.

Before shipping to phones, verify on physical Android devices:

- Move the joystick while dragging the camera and holding sprint; release/cancel each finger independently.
- Attack at rest, while walking, running, sprinting, and dashing. Check the right punch, torso twist, natural recovery, and uninterrupted movement and steering.
- Hold BLOCK at rest and while moving. Guard should blend in, remain raised, and settle smoothly after release. Raise Block during a punch and confirm it cancels into recovery without resuming after release.
- Vary joystick travel from slow walking through full movement and sprint. Check cadence, opposite arm/leg motion, foot contacts, and controlled guard steps.
- Dash at rest, while moving, and while blocking. Steer through the burst, reverse the joystick, and release it midway; check push-off, bounded turning, recovery, and cooldown.
- Move the joystick while dragging the camera and activating action buttons; nearby controls should not activate accidentally.
- Slide SPRINT → DASH → SPRINT without lifting, then re-enter DASH after cooldown. Slide BLOCK → ATTACK → BLOCK; Block should release on exit, each attack entry should request one punch, and held ATTACK should never repeat or queue another punch. Re-enter ATTACK after recovery to attack again while other fingers move and look.
- Cancel action touches and lift multiple fingers in different orders; confirm HOLD actions release without a stuck guard. Check the smaller Reset View button sits beneath the top-right hint without overlapping text.
- Rotate between portrait and landscape, including devices with display cutouts and Android gesture navigation.
- Background and resume the browser; confirm no stuck inputs, movement jumps, or camera jumps.
- Walk, sprint, and dash into each boundary and along corners; confirm containment and smooth sliding.
- Test camera pitch extremes, camera reset, full character visibility, and floor clearance.
- Watch FPS and device temperature during a sustained session on both lower-end and newer phones.

This version only contains flat arena bounds. Camera obstacle collision, uneven terrain, steps, jumping, and physical body interactions are future work.
