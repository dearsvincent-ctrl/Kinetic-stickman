# Kinetic — Movement Lab v0.1

A mobile-first, third-person 3D stickman movement prototype built with JavaScript, Three.js, and Vite. The arena opens directly into play. This version establishes character structure, movement, animation, camera control, and touch input for a future physics-based martial arts game.

Included: a hierarchical humanoid rig, idle/walk/run animation, camera-relative analog movement, held sprint, acceleration/deceleration, boundary containment, an orbiting follow camera, a reset-view control, and an FPS display. There is no combat, enemy AI, progression, networking, gravity, ragdoll, or rigid-body simulation.

## Play on Android with GitHub Pages

The source repository is intended to remain private. **GitHub Pages for a private personal repository requires GitHub Pro.** GitHub Free supports Pages from public repositories only. If Settings → Pages asks you to upgrade, a private-repository Pages deployment cannot run until the account has an eligible plan. Publishing a Pages site normally makes the game page public even when its source repository is private.

After the first successful deployment, open **https://dearsvincent-ctrl.github.io/Kinetic-stickman/** in Android Chrome. No computer, local build, app installation, or terminal on your phone is needed.

Enable deployment from your phone:

1. Sign in to GitHub in Chrome and open [dearsvincent-ctrl/Kinetic-stickman](https://github.com/dearsvincent-ctrl/Kinetic-stickman).
2. Open the repository's **Actions** tab. If GitHub shows an Actions-disabled banner, enable workflows for this repository.
3. Open [Settings → Pages](https://github.com/dearsvincent-ctrl/Kinetic-stickman/settings/pages). Under **Build and deployment → Source**, choose **GitHub Actions**. Do not select a branch or create a `gh-pages` branch. If Settings or the controls are hidden on the mobile layout, open Chrome's three-dot menu and enable **Desktop site**.
4. Open [Actions](https://github.com/dearsvincent-ctrl/Kinetic-stickman/actions), choose **Deploy GitHub Pages**, tap **Run workflow**, select **main**, and tap **Run workflow** again. This also retries an initial run that failed before Pages was enabled.
5. Wait for that run's build and deploy jobs to finish with green check marks. Open its **github-pages** deployment link, or return to **Settings → Pages → Visit site**.
6. Rotate the phone to landscape and play. Drag the left joystick to move, drag the right side to look, and hold **SPRINT** to run.

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
| Sprint               | Hold the bottom-right SPRINT button       | Hold Shift                     |
| Reset camera         | Tap RESET VIEW                            | Press R                        |
| Instructions / pause | Tap the question-mark button              | Click the question-mark button |
| Fullscreen           | Tap the fullscreen button where supported | Click the fullscreen button    |

The joystick, camera drag, and sprint each own a separate pointer, allowing simultaneous input. Joystick travel controls speed, with a small central dead zone. Movement uses the camera's horizontal direction; the character smoothly faces the direction of travel. Releasing movement decelerates to idle. Camera reset returns to the character's current heading, with the default low viewing angle and 4.8-metre follow distance.

Touch gestures, page scrolling, text selection, and dragging are suppressed within the game. Input clears when the page loses focus, becomes hidden, or changes size/orientation to prevent stuck movement.

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

| Module                                | Responsibility                                                           |
| ------------------------------------- | ------------------------------------------------------------------------ |
| `src/main.js`                         | Application entry point and startup error handling                       |
| `src/core/Game.js`                    | Renderer, scene composition, game loop, simulation ownership             |
| `src/core/math.js`                    | Shared damping and angle helpers                                         |
| `src/ui/Hud.js`                       | FPS/speed readouts, instructions, fullscreen                             |
| `src/input/InputController.js`        | Pointer ownership, joystick normalization, keyboard state, camera deltas |
| `src/movement/CharacterController.js` | Acceleration, camera-relative velocity, facing, world movement requests  |
| `src/world/ArenaBounds.js`            | Flat-ground movement adapter and boundary containment                    |
| `src/world/createArena.js`            | Lightweight arena visuals, lighting, and authoritative arena dimensions  |
| `src/camera/FollowCamera.js`          | Smoothed follow target, orbit angles, pitch limits, floor clearance      |
| `src/character/Stickman.js`           | Named hierarchical body parts and joint pivots                           |
| `src/character/LocomotionAnimator.js` | Procedural idle and locomotion poses                                     |
| `src/style.css`                       | Responsive HUD, touch controls, safe-area spacing                        |
| `build/pagesBase.js`                  | GitHub Pages repository base-path selection                              |
| `.github/workflows/deploy-pages.yml`  | Automated checks, production build, and Pages deployment                 |
| `tests/`                              | Movement/camera checks and browser smoke coverage                        |

All world distances are metres. The coordinate system is Y-up, and the character's local forward direction is −Z. Input uses normalized screen-right `x` and screen-forward `y`; the controller converts these into horizontal world movement.

### Integration boundaries

The movement controller owns the character root position and heading. The animator owns child joint transforms, never the character root. The camera reads the resulting actor position. This keeps a future AnimationMixer, IK system, or physics-driven pose provider separate from navigation.

`ArenaBounds.move(position, displacement, radius, out)` is the current world-movement contract. It constrains the character's radius inside the arena and fixes its feet to the ground. For Rapier, introduce a world adapter backed by a kinematic character controller and static floor/wall colliders. The controller already derives facing and animation speed from resolved travel and cancels blocked velocity components. Extend that response for slopes and physical contacts when integrating Rapier, which is intentionally not installed yet.

The game uses a fixed 60 Hz movement step, with rendering and camera smoothing separate. Frame delta is capped at 80 ms and catch-up work at five steps, preventing a backgrounded tab or long stall from producing a large movement jump. Add Rapier stepping to that simulation boundary rather than tying physics to display refresh rate. Keep character root ownership in one system when introducing physics or root-motion animation.

### Mobile rendering

The scene uses shared low-poly geometry and materials, instanced arena details, a baked floor texture, one shadow-casting directional light, and no postprocessing. WebGL 2 rendering uses antialiasing, ACES tone mapping, a device pixel ratio capped at 1.5, and a 1024 × 1024 soft-shadow map. The FPS readout measures this browser session; it is not a promise of performance on every phone.

## Validation

The original v0.1 build, Node tests, and Playwright Chromium smoke checks passed in the development environment. Deployment changes add base-path and production asset checks; use the workflow run to see the results for the current commit. The browser checks cover rendering, sprint and boundaries, native emulated three-finger input and cancellation, camera reset/pitch limits, instructions, and portrait layout. Screenshots are saved under `test-results/` by the browser script. UI fonts are bundled locally; the game makes no external asset requests.

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

In development, opening `http://localhost:5173/?debug` exposes a read-only `window.__KINETIC__.snapshot()` function for inspecting position, inputs, camera limits, and render statistics. This hook is excluded from production builds.

No physical Android phone testing has been performed for this prototype. Desktop Chromium and touch emulation can check rendering, pointer behavior, and responsive layouts, but cannot establish real mobile GPU performance, thermals, browser chrome behavior, or device-specific touch handling.

Before shipping to phones, verify on physical Android devices:

- Move the joystick while dragging the camera and holding sprint; release/cancel each finger independently.
- Rotate between portrait and landscape, including devices with display cutouts and Android gesture navigation.
- Background and resume the browser; confirm no stuck inputs, movement jumps, or camera jumps.
- Walk and sprint into each boundary and along corners; confirm containment and smooth sliding.
- Test camera pitch extremes, camera reset, full character visibility, and floor clearance.
- Watch FPS and device temperature during a sustained session on both lower-end and newer phones.

This version only contains flat arena bounds. Camera obstacle collision, uneven terrain, steps, jumping, and physical body interactions are future work.
