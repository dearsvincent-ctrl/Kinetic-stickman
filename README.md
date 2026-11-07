# Kinetic — Movement Lab v0.7.2

A mobile-first, third-person 3D stickman prototype built with JavaScript, Three.js, and Vite. Version 0.7.2 replaces the walking-style sprint swing with a dedicated athletic running gait: loaded ground contacts, powerful rear extension, heel recovery, high knee drive, paw-back landings and visible two-foot flight. Ordinary running has a shorter flight interval; sprinting adds long strides, a more aggressive silhouette and brief ninja-inspired arm trails that return to opposing arm drive. Walking keeps its controlled planner. The full-body punches, flying kick, dash and jump animations from Version 0.7.1 remain in place. The same three techniques and automatic three-dimensional proximity combat from Version 0.7 remain in place. Jump, fall, air dash and steer while attacks animate independently of movement. The existing camera, progressive joystick, Sprint, steerable ground/air Dash, Jump, held Block, and locally saved control layouts remain intact. There is no Attack button or manual combat-mode switch.

The existing camera angle and controls, progressive joystick, acceleration/deceleration, 2.6 m/s movement speed, 5.2 m/s sprint speed, arena, boundaries, and rendering settings are preserved. The locomotion layers coordinate arms and legs, bend the knees, move the hips and torso, and blend between idle and faster gaits using actual travel speed. Planted feet and two-bone leg IK reduce sliding on the flat floor.

Approach the stationary orange training dummy at `(2, 0, −5)` to attack automatically when facing it and a technique can actually reach its body. Ground strikes use the existing one-metre entry and 1.15-metre exit thresholds. The straight is the default; close entries at up to 0.86 metres favor the left cross when moving faster than 1.2 m/s or after a completed straight. At settled close range, the two alternate only after full recovery. This is a selection rule, not a queued combo.

In the air, proximity remains active and a valid front-facing target can trigger the flying kick. It chambers the knee, extends the leg, briefly holds the impact pose and retracts into the current jump/fall/landing animation. It works during normal jumps, during an air dash and after the dash ends. Target distance includes vertical separation from each technique’s strike origin to the dummy’s body; targets above, below, behind or beyond the technique’s reach cannot trigger attacks. The kick requires at least 0.08 metres of elevation and 0.22 seconds of remaining flight so its striking phase can finish before touchdown. Attacks never pull the player towards the target, hold them in the air, consume dash availability or change movement velocity.

Hold or slide onto **BLOCK** to maintain guard while moving, jumping or dashing. Block suppresses every automatic technique and cancels an active strike into smooth recovery. Release it to resume eligible attacks after recovery. Target detection continues while guarding. Ground strikes blend back to the current gait; airborne strikes yield their foot targets to landing. The dummy remains a passive collision prop: impact phases are visual timing only, with no hits, health or damage.

Tap or slide onto **JUMP** for a 0.8-metre jump with a short takeoff, ballistic rise and fall, and soft landing recovery. Jumping carries horizontal movement into flight; the joystick provides smooth air steering instead of immediately resetting momentum. Holding Block maintains a manual air guard. Starting a jump recovers an incompatible ground punch smoothly while proximity stays active. Airborne technique selection becomes eligible after takeoff; a kick is cancelled smoothly on landing before ground strikes resume. Automatic body-facing stays restricted to grounded movement, preserving player-controlled air steering and camera behavior.

Tap **DASH** for a short movement burst, normally 2.5 metres over 0.25 seconds. On the ground, it starts in the camera-relative joystick direction, or the character's facing direction when the joystick is centred. Steer during the dash to curve its path; releasing the joystick keeps the current trajectory. Ground push-off and recovery, or aerial balance and limb posing, blend over the existing animation, including while guarding. The dummy has a solid 0.32-metre collision radius: walking, sprinting, and dashing collide and slide around it continuously instead of passing through it.

Version 0.7.2 changes visual presentation only. Movement values, technique eligibility, attack timing and automatic recovery rules remain unchanged from Version 0.7. There are no enemy AI, health, damage, elaborate combos, bicycle kicks, special abilities, invincibility frames, stamina costs, progression, multiplayer, ragdolls, or rigid-body simulation. The dummy is a passive stationary prop; punches and Block do not implement hits or damage. More advanced techniques and learned-technique systems remain future work.

## Play on Android with GitHub Pages

GitHub Pages is already enabled for this repository using GitHub Actions. Open **https://dearsvincent-ctrl.github.io/Kinetic-stickman/** in Android Chrome. No computer, local build, app installation, or terminal on your phone is needed. Updates appear after the deployment workflow succeeds; if the header still shows an older version, reload the page after the run turns green.

To check or rerun deployment from your phone:

1. Sign in to GitHub in Chrome and open [dearsvincent-ctrl/Kinetic-stickman](https://github.com/dearsvincent-ctrl/Kinetic-stickman).
2. Open the repository's **Actions** tab. If GitHub shows an Actions-disabled banner, enable workflows for this repository.
3. Open [Settings → Pages](https://github.com/dearsvincent-ctrl/Kinetic-stickman/settings/pages). Under **Build and deployment → Source**, choose **GitHub Actions**. Do not select a branch or create a `gh-pages` branch. If Settings or the controls are hidden on the mobile layout, open Chrome's three-dot menu and enable **Desktop site**.
4. Open [Actions](https://github.com/dearsvincent-ctrl/Kinetic-stickman/actions), choose **Deploy GitHub Pages**, tap **Run workflow**, select **main**, and tap **Run workflow** again. This also retries an initial run that failed before Pages was enabled.
5. Wait for that run's build and deploy jobs to finish with green check marks. Open its **github-pages** deployment link, or return to **Settings → Pages → Visit site**.
6. Rotate the phone to landscape and play. Drag the **MOVE** joystick to move, drag the right side to look, hold **SPRINT** to run, tap or slide onto **DASH** or **JUMP**, and hold **BLOCK** to guard. Approach the stationary dummy to punch on the ground or kick automatically while airborne and within reach.

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
| Move                 | Drag MOVE joystick (default: bottom-left) | WASD or arrow keys             |
| Look                 | Drag the right side of the viewport       | Click and drag the right side  |
| Sprint               | Hold or slide onto SPRINT                 | Hold Shift                     |
| Automatic strikes    | Approach the dummy on the ground or in air | Approach the dummy on the ground or in air |
| Defensive guard      | Hold or slide onto BLOCK                  | Hold Q                         |
| Directional dash     | Tap or slide onto DASH                    | Press E                        |
| Jump                 | Tap or slide onto JUMP                    | Press Space                    |
| Reset camera         | Tap RESET VIEW                            | Press R                        |
| Edit control layout  | Settings → Edit Controls                  | Settings → Edit Controls       |
| Instructions / pause | Tap the question-mark button              | Click the question-mark button |
| Fullscreen           | Tap the fullscreen button where supported | Click the fullscreen button    |

Start a finger on any gameplay action button, then slide it between buttons without lifting:

- **HOLD — SPRINT and BLOCK:** active while a finger is inside. Leaving releases the action; sliding back immediately resumes it. Block raises and maintains guard rather than selecting a persistent mode.
- **PRESS — DASH and JUMP:** requests an action once on entry. Ground Dash requires its cooldown to finish; aerial Dash requires an unused per-jump allowance. Jump requires the full jump and landing recovery to finish. Staying inside does not repeat, queue an action, or activate it automatically when it becomes available.

Sliding from SPRINT onto DASH releases sprint and requests a dash. Sliding onto JUMP requests one jump, just as a tap does; leave and re-enter after landing recovery to jump again. Sliding off BLOCK releases guard; automatic strikes can resume when the current environment, 3D reach, facing and recovery conditions are met. Crossing a gap releases any HOLD action but keeps that finger assigned to gameplay buttons until it lifts or is cancelled. Joystick and camera fingers retain their original controls when crossing buttons. Multiple action fingers work independently; if two hold the same HOLD action, it remains active until both leave. This allows simultaneous joystick steering, camera dragging, and action input.

Dash can start immediately during ascent, at the apex, or during descent. One aerial dash is available per jump and replenishes on touchdown. It uses the same 2.5-metre, 0.25-second burst as the ground dash, with independent availability; a recent ground dash does not delay it. Existing horizontal momentum provides the initial heading while moving, then the camera-relative joystick smoothly redirects it with a bounded turn rate. At rest, the joystick or character-facing direction supplies the heading. Gravity continues unchanged; the dash neither lifts nor pulls the character towards a target. Afterward, ordinary air steering resumes from the exit momentum. A late descending dash carries its remaining horizontal burst through landing. The button shows AIR READY, AIR DASH, or USED in flight.

Jump can interrupt a ground dash at any point. Takeoff starts on the next fixed simulation step, using the existing short preparation, height, gravity and air control. The remaining ground-dash acceleration ends; the collision-resolved horizontal velocity carries into the jump and then responds to normal air steering. Ground cooldown continues from its original start without consuming or delaying the aerial allowance. As soon as takeoff leaves the floor, another Dash entry can initiate the aerial dash. A Jump entry during an aerial dash, Dash during takeoff or landing recovery, or another Jump before landing recovery finishes is discarded rather than queued. Entries retain their order: Dash → Jump before one simulation tick records the ground dash and immediately interrupts it without adding a free velocity boost; Jump → Dash rejects the premature dash. Rejected requests never activate later. There is no double jump. Holding JUMP through landing does not jump again. On desktop, Space normally requests Jump; if a gameplay button has keyboard focus, Space activates that focused action instead.

Block takes priority over Attack. A punch requested while Block is held is rejected. Raising Block during a punch cancels its remaining extension into a smooth recovery; releasing Block does not resume the cancelled punch. Automatic attacks start afresh only after recovery, with a selected target reachable by a technique eligible in the current movement state. Outside target range, releasing Block lets the automatic posture settle smoothly back to the current movement gait. Block input remains responsive during a jump and suppresses the flying kick; air guard does not turn the actor towards a target.

Joystick travel controls normal movement speed, with a small central dead zone. Movement uses the camera's horizontal direction. When grounded with a selected nearby target, the character smoothly faces the target while translation continues to follow the joystick; otherwise it faces the direction of travel. Releasing normal ground movement decelerates to idle. In flight, release retains momentum with gentle air drag, while a changed joystick direction redirects movement gradually.

The existing camera follows the character's root height during a jump; its yaw, pitch limits, follow distance, drag controls, and reset behavior are unchanged. Camera reset returns to the character's current heading, with the default low viewing angle and 4.8-metre follow distance. RESET VIEW is a separate tap-only utility beneath the top-right DRAG TO LOOK hint, with responsive spacing and a reduced height of 28 pixels on desktop and 32 pixels on touch devices. Sliding gameplay fingers over it does not reset the camera.

DASH triggers once per button entry or keyboard press. Its cooldown starts when the dash begins: the default 0.7 seconds includes the 0.25-second dash, leaving about 0.45 seconds afterwards. The button shows the remaining cooldown; entering it while unavailable does not queue another dash. Dashing works during attacks or blocking and while sprint is held. Steering turns gradually, with a bounded turn rate so direction changes retain momentum. Target-facing changes the body orientation without redirecting an active dash. The configured distance is path length, so a curved dash has shorter net displacement; walls and the dummy can shorten the distance actually travelled.

Touch gestures, page scrolling, text selection, and dragging are suppressed within the game. Momentary input clears when a touch is cancelled, the page loses focus, becomes hidden, or changes size/orientation to prevent stuck movement or Block. Pausing or losing focus cancels an active or pending dash without clearing its cooldown and cancels a punch into recovery. Simulation time, including cooldown and recovery, pauses while the game is paused or backgrounded. Focused gameplay buttons also support Space and Enter through the shared action system.

Pausing during a jump preserves its current height and vertical velocity. Resuming continues the same jump rather than resetting the character to the floor or teleporting it. Arena walls and the dummy's horizontal collision footprint still apply in the air; this version does not implement jumping over or onto physical bodies.

## Customize touchscreen controls

1. Open **Settings**, then select **Edit Controls**. Settings and the editor pause the game and disable gameplay input, so dragging a control cannot move the character or trigger an action.
2. Drag the **Move joystick**, **SPRINT**, **DASH**, **BLOCK**, and **JUMP** controls to comfortable positions. Each control moves independently. Placement stays within the usable screen area and avoids other controls and protected HUD areas.
3. Select **Save** to keep the layout for later visits in this browser, or **Cancel** to restore the previously saved layout. If no custom layout was saved, Cancel restores the default layout.
4. To return to the original arrangement, select **Reset to Default**, check the preview, and select **Save**. Reset is a preview until saved; **Cancel** also undoes a reset preview.

On compact screens, the editor may temporarily fit its default preview around protected UI. Saving defaults restores the original responsive arrangement. Saving a custom layout keeps the positions shown in the editor.

One layout is shared between portrait and landscape. Saved control centres use normalized screen coordinates, so they are reprojected when the screen resizes or rotates rather than staying at fixed pixel positions. Layout constraints keep the resulting controls visible and separated from each other and the HUD. Short helper captions may be hidden for custom layouts, but the action labels remain visible. Without a saved custom layout, the original default positions are used.

Layouts are stored in `localStorage` under `kinetic.controls.v1`, using schema version 1. Invalid or outdated saved data is ignored and the default layout is used. If browser storage is unavailable, Save shows an error and leaves the editor open; Cancel remains available to return to the previous layout. Layouts are local to the current browser and site, and do not require an account or server.

Slide-to-activate behavior is the same after repositioning: Sprint and Block remain HOLD actions, while Dash and Jump remain PRESS actions. Multiple fingers can still move, look, and use actions independently. Opening Settings or the editor clears momentary input and pauses simulation like the instructions panel, including preserving jump height and vertical velocity until play resumes.

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
| `src/ui/Hud.js`                         | FPS/speed readouts, dash/jump availability, combat posture, instructions, fullscreen  |
| `src/ui/ControlLayoutEditor.js`          | Settings/editor flow, drag placement, Save/Cancel/reset, and browser storage          |
| `src/ui/controlLayoutModel.js`           | Versioned normalized layouts, validation, and responsive placement constraints        |
| `src/input/InputController.js`          | Pointer ownership, joystick normalization, keyboard state, camera deltas            |
| `src/input/TouchActionRouter.js`        | Shared HOLD/PRESS/TOGGLE registry, slide routing, cancellation, keyboard activation |
| `src/movement/CharacterController.js`   | Locomotion/dash/jump states, camera-relative steering, facing, world movement       |
| `src/movement/MovementConfig.js`       | Central per-character locomotion, ground/air dash, jump and allowance tuning         |
| `src/movement/DashState.js`             | Configurable dash timing, acceleration profile, steering, and cooldown              |
| `src/movement/JumpState.js`             | Configurable ballistic elevation, vertical velocity, and jump phase timing          |
| `src/combat/CombatController.js`         | Technique phases/recovery, held Block, automatic posture and eligible technique selection |
| `src/combat/Techniques.js`               | Individual reach/timing/environment definitions, eligibility and simple strike selection |
| `src/combat/CombatContext.js`            | Reused read-only movement sensor data for combat; no movement ownership |
| `src/combat/ProximityCombatController.js` | 3D target selection, per-technique geometry, hysteresis and automatic action requests  |
| `src/world/ArenaBounds.js`              | Flat-ground movement adapter, boundary containment, and swept circular obstacles     |
| `src/world/TrainingDummy.js`            | Stationary dummy visual, target data, and shared collision footprint                  |
| `src/world/createArena.js`              | Lightweight arena visuals, lighting, and authoritative arena dimensions             |
| `src/camera/FollowCamera.js`            | Smoothed follow target, orbit angles, pitch limits, floor clearance                 |
| `src/character/Stickman.js`             | Named hierarchical body parts and joint pivots                                      |
| `src/character/AnimationStyle.js` | Validated immutable visual personality and per-layer timing; no gameplay settings |
| `src/character/MotionPresentation.js` | Resolved-velocity launch, braking and balance cues; no root movement |
| `src/character/CharacterAnimator.js`    | Composes animation layers and applies the final joint pose                          |
| `src/character/RunningGait.js` | Dedicated heel-recovery/knee-drive/landing curves, loaded support and visual flight, athletic arm drive and brief trails |
| `src/character/LocomotionAnimator.js`   | Speed-driven gait timing and foot contacts                                          |
| `src/character/CombatStanceAnimator.js` | Smooth defensive guard and balanced stance poses                                    |
| `src/character/DashAnimator.js`         | Dash push-off, directional lean, foot targets, and recovery overlay                 |
| `src/character/AttackAnimator.js`       | Right straight / left cross upper-body extension, torso rotation and recovery         |
| `src/character/AerialDashAnimator.js` | Directional air balance, limb posing, Block and landing blending without root movement |
| `src/character/AerialAttackAnimator.js` | Flying-kick chamber, extension, impact, recovery and landing blend; no root movement |
| `src/character/JumpAnimator.js`         | Takeoff, flight, landing, and recovery poses without root movement                    |
| `src/character/LegIK.js`                | Lightweight two-bone leg posing and floor contact                                   |
| `src/style.css`                         | Responsive HUD, touch controls, safe-area spacing                                   |
| `build/pagesBase.js`                    | GitHub Pages repository base-path selection                                         |
| `.github/workflows/deploy-pages.yml`    | Automated checks, production build, and Pages deployment                            |
| `tests/`                                | Movement/camera checks and browser smoke coverage                                   |

All world distances are metres. The coordinate system is Y-up, and the character's local forward direction is −Z. Input uses normalized screen-right `x` and screen-forward `y`; the controller converts these into horizontal world movement.

### Animation presentation

`AnimationStyle.js` contains the default anime-inspired personality. Timing fractions accelerate the visible strike extension and recoil inside the existing technique phases; they never shorten mechanical recovery, change attack cadence or bypass Block. Run and sprint blend from actual resolved speed with different lean, hip/shoulder counter-rotation, arm drive, foot clearance and contact duty. `MotionPresentation` derives start/brake accents from actual velocity rather than changing player acceleration. World-space foot contacts and leg IK remain authoritative for planted feet.

`RunningGait` supplies a distinct running swing rather than speeding up the walking arc. Contacts stay anchored in world space. Swing curves fold the heel, drive the knee forward, then extend and paw back at touchdown; their endpoint velocity matches resolved ground travel. Run contact duty is 0.46 of a full leg cycle, sprint duty 0.28. Both are below 0.5, leaving two flight windows per cycle. The visual pelvis loads over the supporting leg and rises in flight; the actual character root stays grounded, so ordinary sprint flight never changes combat eligibility or Jump availability. Cadence follows resolved speed and contact travel. During turns, guard transitions and skill handoffs, raised swing goals preserve the rig's knee limit. A planted foot returned just before a cycle boundary keeps its landing instead of attempting a one-frame recovery swing. Sprint-to-Dash and sprint-to-punch visual entry envelopes blend out of the larger arm poses; action eligibility, windup/recovery timing, dash travel and input responsiveness remain unchanged.

Ninja-inspired arm trails occur briefly during launch and high-speed flight, blend with a damped response, and return to opposite arm/leg drive each cycle. Existing guard, punch, dash and jump layers keep priority. Walk/run/sprint comparison screenshots use the same camera angle; cycle screenshots show push-off, flight and landing.

Visual styles resolve and validate once per character. A future character can use `new CharacterAnimator(character, { style: { locomotion: { sprintLean: 0.3 }, punch: { shoulderDrive: 0.4 } } })` to override individual presentation values. Every layer shares immutable numeric settings; scratch vectors/quaternions are reused during updates. This is a code extension point, without character stats or a settings menu.

Ground punches layer torso/arm/hip movement over the ongoing lower-body gait. Jump upper-body blending is separate from foot loading so a recovering punch can yield smoothly at takeoff. Aerial dash entry is damped, the flying kick coils the torso and chambers the knee before extending, and landing progressively takes back foot ownership. These layers cannot freeze flight or change ability availability, velocity or root position. Spin/bicycle kicks and aerial combinations are not implemented.

### Integration boundaries

The movement controller owns the character root position and heading. `JumpState` supplies its elevation and vertical velocity; the world adapter resolves horizontal collisions. `CharacterAnimator` owns child joint transforms, never the character root. It composes locomotion, automatic guard, dash, punch, and jump layers, then resolves the leg poses. The punch overlay acts on the upper body after guard and dash posing. Normal gait phase follows actual resolved movement speed, so the character does not keep running when blocked by a wall. Dash supplies its own foot sequence; `JumpAnimator` supplies takeoff, flight, and landing poses. Both return smoothly to the current gait or guard. When Jump takes over, the dash layer can recover its upper-body pose without writing foot contacts; the jump loads the current support-foot position smoothly before launch. The camera reads the resulting actor position.

`CombatController` owns the timing of one technique at a time: windup, extension, optional impact, then recovery. It filters the registry by environment and per-technique eligibility before calling the selector with an immutable context and eligible candidates. Requests during an active action are discarded, with no combo queue. Block cancels the current action into recovery. Incompatible ground strikes recover on takeoff and the flying kick recovers on landing; techniques explicitly eligible in both environments can continue through those transitions. The manual request method and one-shot desktop F input remain available for grounded shadow punches, without a visible mobile Attack control.

`CombatContext` reads physical movement state, horizontal velocity, heading, elevation and remaining ballistic flight time. It never changes them. `ProximityCombatController` continuously selects the nearest valid target, preserves it through a small exit band, and measures each available technique from its own strike origin to the target body in 3D. It checks actual surface reach, vertical limits, front-facing angle and physical eligibility on every possible attack entry. A retained target outside reach cannot trigger an attack. Ground target-facing uses the existing controller and stays independent of camera-relative translation. Airborne target selection never rotates or pulls the character.

`CharacterAnimator` composes the punch layer with ground gait/guard, and the flying-kick layer after jump and aerial-dash posing. The latter animates reusable world-space foot goals through the existing leg IK, adjusts balance and guard, fades before touchdown, and yields foot ownership to landing. Animation never writes the character root or movement velocities.

World-space foot contacts reduce stance-foot drift; they can replant during turns and transitions. This remains a procedural visual animation system rather than physical foot collision or motion capture. Attacks do not freeze navigation or alter dash state, steering, or cooldown. The solid dummy is a horizontal world obstacle shared by normal movement, dash, and jump collision.

`CharacterController.requestDash()` selects the ground or aerial profile for the next simulation step; `requestJump()` requests takeoff. `canJump` expresses physical readiness and compatible ability interruption separately from the displayed animation. Ground Dash can yield to Jump, while an aerial dash cannot grant another jump, including if its burst continues through touchdown. `movementState` is `"locomotion"`, `"dash"`, `"aerial-dash"`, or `"jump"`; `JumpState.phase` distinguishes `"grounded"`, `"takeoff"`, `"airborne"`, and `"landing"`. Aerial Dash composes horizontal dash motion with ballistic jump elevation. Separate `DashState` instances retain ground cooldown and air availability independently, while a shared sequence counts accepted dashes. The controller owns the per-jump allowance; animation and input cannot refill it. Rejected requests are not buffered. The controller carries resolved dash exit velocity into ordinary locomotion damping and carries horizontal jump momentum into air control. `stop()` cancels pending skill requests and active dashes while retaining dash cooldown; it preserves jump elevation, vertical velocity, and the used aerial allowance. `DashState` and `JumpState` own movement timing, while their animation modules only pose the existing hierarchy.

`ArenaBounds.move(position, displacement, radius, out)` is the current world-movement contract. It constrains the character's horizontal radius inside the arena and sweeps movement against stationary circular obstacle footprints. The controller keeps the jump's elevation separate from this flat-floor collision adapter. The dummy shares its position between collision and combat, with separate base collision and body strike volumes. Resolved motion can slide along obstacle contacts instead of tunnelling through them, including in the air. For Rapier, introduce a world adapter backed by a kinematic character controller and static floor/wall/prop colliders. The controller already derives animation speed from resolved travel and cancels blocked velocity components. Extend that response for slopes and physical contacts when integrating Rapier, which is intentionally not installed yet.

Dash motion integrates the acceleration/cruise/braking profile continuously in substeps no longer than 1/120 second. Every displacement goes through the same world adapter; the character slides along a boundary when possible and stops a dash early if fully blocked. It never teleports to a precomputed destination.

### Extending touchscreen actions

`InputController.actions` exposes the reusable `TouchActionRouter`. Register a button with an ID, DOM element, and `ActionBehavior`; use `onHoldChange` for HOLD and `onActivate` for PRESS or TOGGLE. Sprint and Block use HOLD, while Dash and Jump use PRESS. The router is unchanged, and TOGGLE remains supported for future bindings; Version 0.7 has no toggled combat mode or visible Attack button. For example, a future action can be wired without changing the router:

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

`ControlLayoutEditor` changes the existing control elements' placement without changing their action bindings. `controlLayoutModel` validates versioned normalized centres and resolves them against current screen bounds and reserved areas. The router continues hit-testing the actual elements after editing, refreshing, or rotating; it does not use stale saved pixel hit boxes. Layout code has no ownership of character movement, animation, combat, or camera state.

### Techniques and proximity tuning

Definitions live in `src/combat/Techniques.js`; `CombatController` also re-exports the three technique constants. All times are seconds, reach and heights are metres, and angles are radians.

| Technique | Environment | Surface reach | Strike origin above root | Vertical limit | Windup | Extension | Impact | Recovery |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `basic-punch` | ground | 0.76 | 1.4 | ±0.35 | 0.08 | 0.10 | 0 | 0.24 |
| `cross-punch` | ground | 0.80 | 1.4 | ±0.35 | 0.10 | 0.12 | 0.025 | 0.26 |
| `flying-kick` | air | 0.81 | 0.9 | ±0.65 | 0.06 | 0.07 | 0.035 | 0.22 |

All three use a 45-degree front-facing half-angle. The kick additionally uses `minHeight: 0.08` and `minAirTimeRemaining: 0.22`. `COMBAT_CONFIG` defines 0.16-second interrupted recovery and 0.15-second posture hold. Recovery remains authoritative while the player moves, jumps, dashes or blocks. An impact phase holds the pose without applying damage or an impulse.

A technique can specify `environments: ["ground"]`, `["air"]`, or both, plus `reach`, `originHeight`, `maxVertical`, `maxAngle`, four phase durations, `animation`, `side`, `requiresTarget`, and an optional pure `eligible(context)` predicate. The controller accepts a registry and a `selectTechnique(context, eligibleTechniques)` callback. `GROUND_SELECTION_CONFIG` supplies the initial close-distance and approach-speed rules. This creates extension points for later learned/contextual techniques without adding those systems now.

`PROXIMITY_CONFIG` keeps ground target acquisition at 1.0 metre and retention at 1.15 metres, and adds aerial entry/exit distances of 1.05/1.2 metres. These are 3D centre distances from a compatible technique’s strike origin, not attack permissions. A new attack must also pass that technique’s own surface-reach and height checks. Hysteresis never grants extra attack reach.

The dummy’s separate body strike sphere is centred 1.4 metres above its base with radius 0.24 metres. Its unchanged 0.32-metre base collision radius is used only for physical containment. Thus the straight’s 0.76-metre surface reach preserves the original one-metre ground entry, while vertical separation can exclude a strike. `TRAINING_DUMMY_CONFIG` holds these descriptors. Its position, visuals and movement collision remain unchanged.

Ground target-facing still uses response 13 per second and maximum turn rate 6 radians per second. It changes heading only. Target position, camera control, joystick translation, jump physics and dash steering remain independently owned.

### Movement profiles

`MOVEMENT_DEFAULTS` in `src/movement/MovementConfig.js` centralizes per-character settings. Supply `movementConfig` to `CharacterController` to override profiles without changing input, collision, animation, or combat code. These are developer settings; no character stats or upgrade interface are implemented.

```js
new CharacterController(root, world, {
  movementConfig: {
    locomotion: { walkSpeed: 1.3, runSpeed: 2.6, sprintSpeed: 5.2 },
    groundDash: { distance: 2.5, speed: 10 },
    aerialDash: { distance: 2.5, speed: 10, exitSpeed: 2.6, cooldown: 0 },
    jump: { height: 0.8, gravity: 18, airControl: 3.5 },
    maxAerialDashes: 1,
  },
});
```

`walkSpeed` is the half-stick speed and `runSpeed` the full-stick normal speed. Their defaults preserve the original linear progressive joystick curve; Sprint still scales 5.2 m/s by joystick magnitude. The legacy top-level `walkSpeed` option retains its original full-stick meaning. All speeds are metres per second. Dash `speed` denotes average travel speed, deriving duration as distance/speed; the acceleration profile determines peak speed. Explicit legacy `duration` overrides remain supported. Ground and air profiles independently accept the ramp and steering settings below. Set `maxAerialDashes` to zero to disable aerial dashes or a larger integer for future abilities. Landing replenishes the allowance; opening Settings does not.

### Jump tuning

Jump defaults originate in `JUMP_CONFIG` in `src/movement/JumpState.js` and are exposed through `MOVEMENT_DEFAULTS.jump`. Supply `movementConfig.jump` to the controller; the existing `jumpConfig` constructor option remains supported.

| Setting           | Default | Meaning                                                    |
| ----------------- | ------- | ---------------------------------------------------------- |
| `height`          | 0.8 m   | Ballistic apex above the flat floor                         |
| `gravity`         | 18 m/s² | Downward acceleration; launch velocity derives from height |
| `airControl`      | 3.5 /s  | Smooth response to camera-relative joystick input in flight |
| `airDrag`         | 0.1 /s  | Gentle momentum decay with a centred joystick in flight     |
| `takeoffDuration` | 0.08 s  | Short preparation before leaving the floor                  |
| `landingDuration` | 0.18 s  | Recovery before another ground skill or attack can start    |

`JumpState` advances vertical motion ballistically and resolves the exact floor-contact time, so height remains nonnegative across different frame rates. Horizontal movement uses the existing world adapter; changing elevation does not disable wall or dummy collisions. Animation reads jump phases and progress without modifying root position. Aerial Dash is accepted only during flight; the landing phase finishes before a new ground Jump or Dash can be accepted. Ground strikes wait for landing recovery; airborne techniques may run during flight and air dashing if their own eligibility checks pass.

### Dash tuning

Ground defaults originate in `DASH_CONFIG` in `src/movement/DashState.js` and are exposed through `MOVEMENT_DEFAULTS.groundDash`. Aerial defaults use the same distance, speed, ramps and steering, with zero independent cooldown and a per-jump limit. Existing `dashConfig` overrides ground settings; `airDashConfig` overrides aerial settings.

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

Peak speed is derived from distance, duration, ramp times, and the entry/exit speeds so the profile covers the requested distance. Aerial exit speed retains incoming momentum or requested movement speed, with a 2.6 m/s minimum; it then blends through normal air control or ground deceleration. Increasing steering response or turn rate makes redirection sharper; acceleration and braking remain independent of normal walking and sprinting.

The game uses a fixed 60 Hz movement step, with rendering and camera smoothing separate. Frame delta is capped at 80 ms and catch-up work at five steps, preventing a backgrounded tab or long stall from producing a large movement jump. Add Rapier stepping to that simulation boundary rather than tying physics to display refresh rate. Keep character root ownership in one system when introducing physics or root-motion animation.

### Mobile rendering

The scene uses shared low-poly geometry and materials, instanced arena details, a baked floor texture, one shadow-casting directional light, and no postprocessing. WebGL 2 rendering uses antialiasing, ACES tone mapping, a device pixel ratio capped at 1.5, and a 1024 × 1024 soft-shadow map. The FPS readout measures this browser session; it is not a promise of performance on every phone.

## Validation

Version 0.7.2 passed all 293 unit and integration tests, the production build, development Chromium browser regression checks, and the complete production Pages browser suite. Checks include actual two-foot mesh clearance and sustained sprint flight at 30/60/120 Hz, controlled walking support, rear-leg extension and high knee drive, brief arm trailing with smooth return, forward/sideways contact stability, reversals and guard joint limits, Dash/Jump/punch interruptions throughout support and flight at 30/60/120 Hz, immutable visual-style validation, distinct speed-matched gaits and start/brake cues, full-body weight transfer with planted contacts, sharp visual strike curves inside unchanged recovery timing, identical physics/targeting/attack timelines across different styles at 30/60/120 Hz, bounded jump/dash handoffs and moving landings, native touch gait/sprint/braking screenshots, three-dimensional body reach and facing, ground-strike selection, full flying-kick phases, Block cancellation, airborne/landing transitions, identical combat/no-combat movement trajectories, native full-chain attacks and post-dash kicks, ground-dash interruptions at 30/60/120 Hz, native Dash → Jump → Air Dash sliding with independent joystick/camera and relocated buttons, aerial Dash during ascent/apex/descent, landing resets, Block, ground recovery, independent mouse/touch dragging, persistence, Cancel/Reset, resizing, relocated slide controls, editor input isolation, storage failure recovery, and short-screen reachability. Production assets were verified under `/Kinetic-stickman/`.

Run the checks below and inspect the GitHub Actions run for the current commit. Unit tests cover movement, camera limits, input ownership, Pages base paths, proximity thresholds and facing, repeat-punch recovery, Block priority, automatic posture transitions, dummy collision, animation blending, and character-root ownership. Layout checks cover normalized positioning, validation, responsive constraints, and saved-data handling. Jump checks cover height, gravity, phases, horizontal momentum and steering, ground-skill ordering, repeated-input rejection, pause continuity, collision, and ground/air technique eligibility. Dash checks cover ground and aerial distance at 30/60/120 Hz, ascent/apex/descent activation, momentum and steering, cooldown, per-jump limits and landing resets, wall/dummy containment, late-dash landing, configuration overrides, state transitions, and animation blending. Action-router checks cover HOLD/PRESS/TOGGLE entry and re-entry, multiple fingers, cancellation, keyboard activation, and binding replacement. Browser checks cover control editing, Save/Cancel/reset, storage failure, refresh and rotation, gameplay-input isolation, rendering, Jump taps and slides, moving jumps, approaching and leaving the dummy, automatic ground and aerial techniques, held Block, native emulated multi-touch input and cancellation, action slides, recovery and dash cooldown, camera reset/pitch limits, instructions, and responsive layout. Screenshots are saved under `test-results/` by the browser scripts. UI fonts are bundled locally; the game makes no external asset requests.

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

In development, opening `http://localhost:5173/?debug` exposes a read-only `window.__KINETIC__.snapshot()` function for inspecting position, inputs, movement state, dash timing, jump phases and elevation, combat phases and proximity targeting, camera limits, and render statistics. This hook is excluded from production builds.

Version 0.7.2 has not been verified on a physical Android device by the implementer. Desktop Chromium and touch emulation can check rendering, pointer behavior, and responsive layouts, but cannot establish real mobile GPU performance, thermals, browser chrome behavior, or device-specific touch handling.

Before shipping to phones, verify on physical Android devices:

- Open Settings → Edit Controls, drag each of the five controls independently, and confirm the character and camera do not respond to those editor touches. Check that controls cannot cover each other or protected HUD areas.
- Save a layout, refresh the page, and confirm it returns. Rotate between portrait and landscape and check usable positions, visible labels, and HUD spacing. Reopen the editor, make changes, and Cancel; confirm the saved arrangement returns.
- Preview Reset to Default and Cancel it, then repeat and Save. Confirm Cancel restores the custom layout and Save restores the original arrangement, including after a refresh.
- After editing, move the joystick while dragging the camera and sliding between action buttons at their new positions. Confirm HOLD release, PRESS entry, cooldowns, and cancellation behave as before, with no stale hit boxes or stuck inputs.
- Open Settings while airborne, enter and leave the editor, and resume. Confirm the paused jump keeps its height and vertical motion without a floor reset or teleport.
- Move the joystick while dragging the camera and holding sprint; release/cancel each finger independently.
- Jump at rest, while walking, and while sprinting. Check takeoff, height, smooth ballistic travel, landing, and return to the current gait. Release or redirect the joystick in flight; momentum should decay gently or steer smoothly.
- Hold JUMP through landing and confirm there is no repeat. Slide away and re-enter after landing recovery to jump again. Jump at the beginning, middle and end of a ground dash, then air dash once the feet leave the floor. Confirm continuous travel, preserved momentum and no remaining ground acceleration. Request Jump during an aerial dash and Dash during takeoff or landing recovery; neither should queue a later action. Dash during flight should activate immediately.
- Jump beside the dummy during a punch. Check that the punch recovers smoothly and a valid front-facing airborne target can trigger the flying kick. Watch the knee chamber, leg extension, short impact and recovery into falling/landing. Manual BLOCK should suppress or cancel the kick; release it with enough flight time to resume eligible attacks. Ground strikes should resume after landing recovery.
- Approach the dummy slowly from multiple directions. Check smooth facing, the first punch once aligned, and repeat punches after full recovery. Move near the range edge and confirm targeting does not flicker; leave beyond the exit threshold and confirm no new punches start.
- Walk, run, sprint, and dash past or around the dummy. Check the right straight, close-range left cross, torso twist, full recovery, smooth ground target-facing, and uninterrupted movement without being pulled towards the target.
- Hold BLOCK at rest and while moving near the dummy. Guard should remain raised and prevent new punches. Raise Block during a punch and confirm it cancels smoothly into recovery. Release Block in range and confirm a new automatic punch begins only after recovery and correct facing; release out of range and confirm return to normal movement.
- Vary joystick travel from slow walking through full movement and sprint. Check cadence, opposite arm/leg motion, foot contacts, and controlled guard steps.
- Air dash during ascent, at the apex, and during descent. Reverse the joystick during the burst, release it, and steer normally afterward. Confirm continuous gravity, visible torso/limb posing, smooth landing, and no second air dash until landing. Try a late air dash into a wall and around the dummy, then ground dash after recovery.
- Dash at rest, while moving, and while blocking. Steer through the burst, reverse the joystick, and release it midway; check push-off, bounded turning, recovery, and cooldown.
- Perform Sprint → Ground Dash → Jump → Air Dash → automatic Kick → Landing near the dummy. Keep steering and dragging the camera, including with saved custom control positions. Move away mid-kick and pass the dummy; no new attack should start outside reach or behind the fighter.
- Move the joystick while dragging the camera and activating action buttons; nearby controls should not activate accidentally.
- Slide SPRINT → JUMP → BLOCK → SPRINT without lifting while other fingers move and look. Confirm each PRESS entry is a single request, HOLD actions release on exit, and Block can guard in flight. Also slide SPRINT → DASH → SPRINT, then re-enter DASH after cooldown.
- Cancel action touches and lift multiple fingers in different orders; confirm HOLD actions release without a stuck guard. Check the smaller Reset View button sits beneath the top-right hint without overlapping text.
- Rotate between portrait and landscape, including devices with display cutouts and Android gesture navigation.
- Background and resume the browser; confirm no stuck inputs, movement jumps, or camera jumps.
- Pause or background the page while airborne, then resume. Confirm the same height and vertical motion continue without a floor reset or teleport.
- Walk, sprint, dash, and jump into each boundary and along corners, then into and around the dummy; confirm containment, solid horizontal collision, and smooth sliding without tunnelling or jumping through the dummy.
- Test camera pitch extremes, camera reset, full character visibility, and floor clearance.
- Watch FPS and device temperature during a sustained session on both lower-end and newer phones.

This version contains flat arena bounds, one stationary circular dummy obstacle, and ballistic jumping over the floor. Camera obstacle collision, uneven terrain, steps, jumping onto or over physical bodies, moving-body physics, advanced aerial techniques, damage/hit physics, and elaborate movement-combat combinations are future work.
