# Animation sources and the v0.8.7 rig decision

Reviewed on 2026-11-17. No external animation clips, character meshes, textures,
or audio were downloaded or added for v0.8.7. The running and combat changes use
the existing procedural rig. Dust, pressure rings, and streaks use generated
geometry and shaders.

## Official sources reviewed

| Source                                                                                                                                                                                                                                                                                  | Published use terms and practical limits                                                                                                                                                                                                                                                                                                                                                                                   | Decision for this rig                                                                                                                                                                                                                                                                 |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Adobe Mixamo FAQ](https://helpx.adobe.com/creative-cloud/faq/mixamo-faq.html)                                                                                                                                                                                                          | Mixamo is free with an Adobe ID. The FAQ permits characters and animations “royalty free for personal, commercial, and non-profit projects,” including video games. Its libraries and auto-rigger are for bipedal humanoids; the auto-rigger also requires a suitable neutral humanoid mesh. This FAQ is project-use permission, not evidence of unrestricted standalone asset redistribution.                             | A possible future source of authored running or martial-arts motion. Access requires an account and a compatible source skeleton. Do not commit a raw FBX or redistribute a clip pack based only on the FAQ; verify the current applicable terms for the exact delivery method first. |
| [CMU Graphics Lab motion database](http://mocap.cs.cmu.edu/) and [official FAQ](http://mocap.cs.cmu.edu/faqs.php)                                                                                                                                                                       | The homepage permits including data in commercially sold products but says it may not be resold directly, even in converted form. The FAQ says the data may be copied, modified, or redistributed without permission. Read both together: conversion does not remove the standalone resale restriction. The homepage requests an acknowledgment for published results and warns that toe/hand channels may need smoothing. | A possible future source for studying real running and balance. Original ASF/AMC data requires conversion; third-party BVH conversions need separate provenance review. No clips were selected or imported.                                                                           |
| [Three.js SkeletonUtils documentation](https://threejs.org/docs/pages/module-SkeletonUtils.html), [r180 implementation](https://github.com/mrdoob/three.js/blob/r180/examples/jsm/utils/SkeletonUtils.js), and [r180 MIT license](https://github.com/mrdoob/three.js/blob/r180/LICENSE) | Three.js is MIT licensed; retain its copyright and permission notice when redistributing substantial portions. This covers the software, not an animation asset loaded through it. `retarget` works with skeletons; `retargetClip` generates bone quaternion tracks and a hip position track. Bone names, hip identity, scale, rest-pose offsets, and hip influence need explicit configuration.                           | The existing Three.js dependency can support a future retargeting tool, but this utility alone does not adapt an arbitrary Group hierarchy to this game's procedural animation system.                                                                                                |

The CMU HTTPS endpoints returned HTTP 503 during this review; the same official
homepage and FAQ were successfully read over HTTP. Only those two pages were
read; the database was not crawled. If CMU data is used later, retain its requested
acknowledgment: “The data used in this project was obtained from mocap.cs.cmu.edu.
The database was created with funding from NSF EIA-0196217.”

## Why clips were not integrated

`Stickman.js` builds named `THREE.Group` joints, rods, and spheres. It has no
`THREE.Bone`, `Skeleton`, or `SkinnedMesh`. `CharacterAnimator` composes poses and
solves limbs against world-space foot and strike targets. The controller owns
root translation and facing; combat geometry owns the authored active strike
path. A typical Mixamo FBX or CMU BVH clip supplies another hierarchy, another
rest pose, and sometimes moving hip/root tracks. Playing those tracks directly
would bypass the contact planner and could move a rendered fist away from its
hit path or slide a supporting foot.

A reliable clip import therefore needs an explicit adapter, not only a loader:

1. Record the clip's official source, exact identifier, acquisition date, terms,
   and any acknowledgment. Check distribution rights for the actual build and
   repository. Keep original asset provenance with any derived clip.
2. Convert into a known source skeleton, normalize scale and forward/up axes,
   and map every required joint to a target skeleton with calibrated rest-pose
   offsets. CMU's FAQ gives an ASF/AMC-to-meters scale of approximately 0.056444;
   a third-party conversion may already have applied it.
3. Retarget and bake offline, then translate the result into this rig's pose
   controls. Remove root travel/facing from the visual clip. Preserve controller
   movement, world foot contacts, and the shared active strike path.
4. Mark support, toe-off, recovery, and impact phases. Blend those poses with
   existing IK and movement/combat ownership, rather than changing attack
   durations or using clip displacement as physics.
5. Verify source and adapted clips at 30/60/120 Hz, through interruptions,
   guards, turns, jumps, rooftops, and 1×/100× sandbox motion. Check finite limb
   goals, continuous handoffs, active visual/hit alignment, and unchanged root
   movement before shipping.

For this update, the procedural approach makes the improvements reviewable
without a skeleton migration or new asset terms. Running keeps its planted-foot
clock, opposing arm drive, heel recovery, and flight intervals. Physical speed
adds a bounded pose accent above 5.2 m/s and saturates at 100× that reference;
the aggression control is clamped to 0–1.5. It does not increase stride or the
cadence clock. Free running remains capped at 2.4 cycles/s, guard footwork at 3,
and a normal dash bound at 1.6. Actor physics is unchanged.

Speed effects remain cosmetic with fixed pools: 64 dust particles, two pressure
rings, and 12 streaks. Dust requires grounded horizontal travel and honors
supplied planted-foot contacts; hard landings produce one brief ground burst.
Sonic events use actual 3D speed, trigger once on crossing the selected threshold,
and rearm at or below 80% of it. Airborne crossings never emit ground dust. No camera
shake or audio is added.
