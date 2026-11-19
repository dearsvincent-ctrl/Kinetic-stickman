import test from "node:test";
import assert from "node:assert/strict";
import { SpeedEffects, SPEED_EFFECT_LIMITS } from "../src/world/SpeedEffects.js";
import {
  SPEED_EFFECT_DEFAULTS,
  SPEED_EFFECT_PARAMETERS,
  SPEED_EFFECT_SETTINGS_KEY,
  sanitizeSpeedEffectSettings,
  loadSpeedEffectSettings,
  saveSpeedEffectSettings,
} from "../src/sandbox/SpeedEffectsSettings.js";

const sample = (overrides = {}) => ({
  position: { x: 0, y: 1, z: 0 },
  velocity: { x: 40, y: 0, z: 0 },
  grounded: false,
  floorHeight: 0,
  ...overrides,
});

function storageWith(values) {
  const entries = new Map(values);
  return {
    entries,
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => entries.set(key, value),
  };
}

test("v088 feedback metadata supplies clamped size, shake, near-miss and impact controls", () => {
  const additions = {
    shockwaveSize: [18, 2, 100],
    shakeStrength: [0.8, 0, 2],
    shakeDuration: [0.22, 0.05, 0.65],
    nearMissRadius: [2.4, 0.7, 12],
    nearMissSpeed: [20, 5, 1000],
    impactStrength: [1, 0, 20],
    impactSpeed: [25, 5, 1200],
  };
  for (const [id, [value, min, max]] of Object.entries(additions)) {
    const parameter = SPEED_EFFECT_PARAMETERS.find((p) => p.id === id);
    assert.ok(parameter && Object.isFrozen(parameter), id);
    assert.deepEqual([parameter.default, parameter.min, parameter.max], [value, min, max]);
    assert.equal(SPEED_EFFECT_DEFAULTS[id], value);
    assert.equal(sanitizeSpeedEffectSettings({ [id]: -1e6 })[id], min);
    assert.equal(sanitizeSpeedEffectSettings({ [id]: 1e6 })[id], max);
    for (const invalid of [NaN, Infinity, "12", null, undefined])
      assert.equal(sanitizeSpeedEffectSettings({ [id]: invalid })[id], value);
  }
  for (const id of ["sonicEnabled", "shakeEnabled", "nearMissEnabled"]) {
    assert.equal(SPEED_EFFECT_DEFAULTS[id], true);
    assert.equal(sanitizeSpeedEffectSettings({ [id]: false })[id], false);
    for (const invalid of [0, null, "false", undefined])
      assert.equal(sanitizeSpeedEffectSettings({ [id]: invalid })[id], true);
  }
  assert.equal(sanitizeSpeedEffectSettings({ ignored: 1 }).ignored, undefined);
  assert.ok(Object.isFrozen(sanitizeSpeedEffectSettings()));
});

test("v088 old v1 preferences acquire feedback defaults without losing existing choices", () => {
  assert.equal(SPEED_EFFECT_SETTINGS_KEY, "kinetic.speed-effects.v1");
  const storage = storageWith([[SPEED_EFFECT_SETTINGS_KEY, JSON.stringify({
    version: 1,
    values: { sonicEnabled: false, sonicSpeed: 110, dustDensity: 0.3 },
  })]]);
  const loaded = loadSpeedEffectSettings(storage);
  assert.equal(loaded.sonicEnabled, false);
  assert.equal(loaded.sonicSpeed, 110);
  assert.equal(loaded.dustDensity, 0.3);
  assert.equal(loaded.shockwaveSize, 18);
  assert.equal(loaded.shakeEnabled, true);
  assert.equal(loaded.nearMissEnabled, true);
  assert.equal(saveSpeedEffectSettings(storage, { ...loaded, shakeStrength: 1.4, impactStrength: 12 }), true);
  assert.equal(JSON.parse(storage.entries.get(SPEED_EFFECT_SETTINGS_KEY)).version, 1);
  assert.equal(loadSpeedEffectSettings(storage).shakeStrength, 1.4);
  assert.equal(loadSpeedEffectSettings(storage).impactStrength, 12);
});

test("v088 reused boom events advance only for real crossings and rearm at exactly 80 percent", () => {
  const effects = new SpeedEffects();
  try {
    const event = effects.lastBoom;
    const position = event.position;
    const velocity = event.velocity;
    effects.configure({ dustDensity: 0, sonicSpeed: 50 });
    const state = sample({ velocity: { x: 30, y: 40, z: 0 } });
    effects.update(1 / 60, state);
    assert.equal(event.sequence, 1);
    assert.equal(event.speed, 50);
    assert.deepEqual(event.velocity.toArray(), [30, 40, 0]);
    assert.deepEqual(event.position.toArray(), [0, 2, 0]);
    const recorded = event.position.toArray();
    state.position.x = 20;
    for (const speed of [70, 49.999, 50, 40.001, 51]) {
      state.velocity.x = speed;
      state.velocity.y = 0;
      effects.update(1 / 60, state);
      assert.equal(event.sequence, 1);
    }
    assert.deepEqual(event.position.toArray(), recorded, "following visuals do not mutate the crossing event");
    state.velocity.x = 40;
    effects.update(1 / 60, state);
    assert.equal(effects.sonicArmed, true);
    state.velocity.x = 50;
    effects.update(1 / 60, state);
    assert.equal(event.sequence, 2);
    assert.equal(effects.sonicBursts, 2);
    assert.equal(effects.lastBoom, event);
    assert.equal(event.position, position);
    assert.equal(event.velocity, velocity);
    effects.reset();
    assert.equal(effects.lastBoom, event);
    assert.equal(event.position, position);
    assert.equal(event.sequence, 0);
    assert.equal(event.radius, 0);
    for (const disabled of [{ sonicEnabled: false }, { sonicEnabled: true, sonicIntensity: 0 }]) {
      effects.reset();
      effects.configure(disabled);
      effects.update(1 / 60, state);
      assert.equal(event.sequence, 0);
    }
  } finally {
    effects.dispose();
  }
});

test("v088 pressure radius scales with actual 3D speed and size instead of the threshold setting", () => {
  function burst(speed, configuration = {}, vertical = false) {
    const effects = new SpeedEffects();
    effects.configure({ dustDensity: 0, ...configuration });
    effects.update(1 / 60, sample({ velocity: { x: vertical ? 0 : speed, y: vertical ? speed : 0, z: 0 } }));
    return effects;
  }
  const slow = burst(40);
  const fast = burst(160);
  const vertical = burst(160, { sonicSpeed: 5 }, true);
  const large = burst(160, { shockwaveSize: 36 });
  try {
    assert.equal(slow.lastBoom.radius, 18);
    assert.equal(fast.lastBoom.radius, 36);
    assert.equal(vertical.lastBoom.radius, fast.lastBoom.radius);
    assert.equal(large.lastBoom.radius, fast.lastBoom.radius * 2);
    assert.ok(fast.lastBoom.intensity > slow.lastBoom.intensity);
    const front = slow.rings.find((p) => p.active);
    assert.ok(front.currentRadius > 4, "the front begins around the player, larger than a body-sized trail ring");
    assert.equal(front.bands.length, 3);
    assert.equal(front.shells.length, 2);
    assert.equal(front.mesh.position.x, 0, "the front is centred on the runner");
    assert.ok(front.bands.every((band) => band.material.opacity > 0));
    assert.ok(front.shells.every((shell) => shell.material.uniforms.alpha.value > 0));
    let radius = front.currentRadius;
    for (let i = 0; i < 30; i++) {
      slow.update(1 / 60, sample());
      assert.ok(front.currentRadius >= radius);
      radius = front.currentRadius;
    }
    assert.ok(radius > front.radius * 0.96, "the visible pressure front expands to its configured world size");
  } finally {
    for (const effect of [slow, fast, vertical, large]) effect.dispose();
  }
});

test("v088 fronts follow for 120ms, interpolate their release, then remain in world space", () => {
  const effects = new SpeedEffects();
  try {
    effects.configure({ dustDensity: 0 });
    const state = sample({ grounded: true });
    effects.update(0.01, state);
    const front = effects.rings.find((p) => p.active);
    assert.equal(front.following, true);
    state.position.x = 10;
    effects.update(0.05, state);
    assert.equal(front.mesh.position.x, 10);
    state.position.x = 20;
    effects.update(0.05, state);
    assert.equal(front.mesh.position.x, 20);
    state.position.x = 30;
    effects.update(0.05, state);
    assert.equal(front.following, false);
    assert.ok(Math.abs(front.mesh.position.x - 22) < 1e-9);
    assert.equal(front.ground.position.x, front.mesh.position.x);
    state.position.x = 200;
    state.position.y = 100;
    effects.update(0.05, state);
    assert.ok(Math.abs(front.mesh.position.x - 22) < 1e-9);
    assert.equal(front.mesh.position.y, 2);
    assert.equal(front.ground.position.y, 0.055);
  } finally {
    effects.dispose();
  }
});

test("v088 grounded booms create outward radial dust around the support; airborne booms never do", () => {
  for (const grounded of [true, false]) {
    const effects = new SpeedEffects();
    try {
      effects.configure({ dustSpeed: 1000 });
      effects.update(1 / 60, sample({
        grounded,
        position: { x: 5, y: 13, z: -3 },
        floorHeight: 12,
      }));
      const particles = effects.dust.filter((p) => p.active);
      const front = effects.rings.find((p) => p.active);
      assert.equal(front.ground.visible, grounded);
      if (!grounded) {
        assert.equal(particles.length, 0);
        continue;
      }
      assert.ok(particles.length >= 16);
      const quadrants = new Set();
      for (const p of particles) {
        assert.equal(p.radial, true);
        assert.ok((p.x - 5) * p.vx + (p.z + 3) * p.vz > 0, "each dust plume pushes away from the runner");
        assert.ok(Math.hypot(p.x - 5, p.z + 3) > 2, "dust starts around the pressure front");
        assert.ok(p.y >= 12 && p.y < 13, "the rooftop support supplies the dust height");
        quadrants.add(`${p.x > 5},${p.z > -3}`);
      }
      assert.equal(quadrants.size, 4);
    } finally {
      effects.dispose();
    }
  }
});

test("v088 repeated 100x booms reuse bounded render pools, geometry, event and GPU buffers", () => {
  const effects = new SpeedEffects();
  try {
    const state = sample({ grounded: true });
    const event = effects.lastBoom;
    const slots = [effects.dust.slice(), effects.rings.slice(), effects.streaks.slice()];
    const renderObjects = [];
    effects.group.traverse((object) => renderObjects.push(object));
    const geometries = renderObjects.map((object) => object.geometry);
    const matrices = effects.streakMesh.instanceMatrix;
    const colors = effects.streakMesh.instanceColor;
    effects.configure({ dustDensity: 2, sonicIntensity: 3, shockwaveSize: 100 });
    for (let i = 0; i < 1200; i++) {
      state.velocity.x = i % 8 === 0 ? 0 : 1000;
      state.position.x += state.velocity.x / 60;
      effects.update(1 / 60, state);
      assert.ok(effects.activeDust <= SPEED_EFFECT_LIMITS.dust);
      assert.ok(effects.activeRings <= SPEED_EFFECT_LIMITS.rings);
      assert.ok(effects.activeStreaks <= SPEED_EFFECT_LIMITS.streaks);
      assert.ok(effects.lastBoom.radius <= 250);
    }
    const currentObjects = [];
    effects.group.traverse((object) => currentObjects.push(object));
    assert.deepEqual(currentObjects, renderObjects);
    assert.deepEqual(currentObjects.map((object) => object.geometry), geometries);
    assert.equal(effects.lastBoom, event);
    assert.equal(effects.streakMesh.instanceMatrix, matrices);
    assert.equal(effects.streakMesh.instanceColor, colors);
    for (const [index, pool] of [effects.dust, effects.rings, effects.streaks].entries()) {
      pool.forEach((slot, i) => {
        assert.equal(slot, slots[index][i]);
        for (const value of Object.values(slot))
          if (typeof value === "number") assert.ok(Number.isFinite(value));
      });
    }
    for (const object of currentObjects)
      for (const value of [...object.position.toArray(), ...object.scale.toArray(), ...object.quaternion.toArray()])
        assert.ok(Number.isFinite(value));
    effects.reset();
    assert.equal(effects.activeRings, 0);
    assert.ok(effects.rings.every((front) => !front.mesh.visible && !front.ground.visible));
  } finally {
    effects.dispose();
  }
});
