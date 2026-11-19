import test from "node:test";
import assert from "node:assert/strict";
import {
  SpeedEffects,
  SPEED_EFFECT_LIMITS,
} from "../src/world/SpeedEffects.js";
import {
  SPEED_EFFECT_PARAMETERS,
  SPEED_EFFECT_DEFAULTS,
  SPEED_EFFECT_SETTINGS_KEY,
  sanitizeSpeedEffectSettings,
  loadSpeedEffectSettings,
  saveSpeedEffectSettings,
} from "../src/sandbox/SpeedEffectsSettings.js";

function context(overrides = {}) {
  return {
    position: { x: 0, y: 1, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    grounded: true,
    floorHeight: 0,
    ...overrides,
  };
}

function stepFor(effects, seconds, fps, sample) {
  const frames = Math.round(seconds * fps);
  for (let i = 0; i < frames; i++) effects.update(1 / fps, sample);
}

function memoryStorage(initial = []) {
  const data = new Map(initial);
  return {
    data,
    getItem(key) {
      return data.get(key) ?? null;
    },
    setItem(key, value) {
      data.set(key, value);
    },
  };
}

test("v087 speed effects defaults and numeric controls are independently sanitized", () => {
  assert.deepEqual(SPEED_EFFECT_DEFAULTS, {
    dustSpeed: 8,
    dustIntensity: 1,
    dustDensity: 1,
    sonicEnabled: true,
    sonicSpeed: 40,
    sonicIntensity: 1,
    shockwaveSize: 18,
    shakeEnabled: true,
    shakeStrength: 0.8,
    shakeDuration: 0.22,
    nearMissEnabled: true,
    nearMissRadius: 2.4,
    nearMissSpeed: 20,
    impactStrength: 1,
    impactSpeed: 25,
  });
  assert.deepEqual(sanitizeSpeedEffectSettings(), SPEED_EFFECT_DEFAULTS);
  assert.deepEqual(sanitizeSpeedEffectSettings(null), SPEED_EFFECT_DEFAULTS);
  assert.ok(Object.isFrozen(SPEED_EFFECT_DEFAULTS));
  assert.ok(Object.isFrozen(SPEED_EFFECT_PARAMETERS));
  const bounds = {
    dustSpeed: [1, 1000],
    dustIntensity: [0, 3],
    dustDensity: [0, 2],
    sonicSpeed: [5, 1200],
    sonicIntensity: [0, 3],
    shockwaveSize: [2, 100],
    shakeStrength: [0, 2],
    shakeDuration: [0.05, 0.65],
    nearMissRadius: [0.7, 12],
    nearMissSpeed: [5, 1000],
    impactStrength: [0, 20],
    impactSpeed: [5, 1200],
  };
  assert.deepEqual(
    SPEED_EFFECT_PARAMETERS.map((parameter) => parameter.id).sort(),
    Object.keys(bounds).sort(),
  );
  for (const parameter of SPEED_EFFECT_PARAMETERS) {
    assert.ok(Object.isFrozen(parameter));
    assert.deepEqual([parameter.min, parameter.max], bounds[parameter.id]);
    assert.equal(
      sanitizeSpeedEffectSettings({ [parameter.id]: -1e9 })[parameter.id],
      parameter.min,
    );
    assert.equal(
      sanitizeSpeedEffectSettings({ [parameter.id]: 1e9 })[parameter.id],
      parameter.max,
    );
    for (const invalid of [
      NaN,
      Infinity,
      -Infinity,
      "12",
      null,
      {},
      undefined,
    ]) {
      assert.equal(
        sanitizeSpeedEffectSettings({ [parameter.id]: invalid })[parameter.id],
        parameter.default,
      );
    }
  }
  assert.equal(
    sanitizeSpeedEffectSettings({ sonicEnabled: false }).sonicEnabled,
    false,
  );
  for (const invalid of ["false", 0, null, undefined]) {
    assert.equal(
      sanitizeSpeedEffectSettings({ sonicEnabled: invalid }).sonicEnabled,
      true,
    );
  }
  assert.equal(
    "cameraFov" in sanitizeSpeedEffectSettings({ cameraFov: 120 }),
    false,
  );
});

test("v087 speed settings use their own versioned storage key and tolerate blocked storage", () => {
  const storage = memoryStorage([
    ["kinetic.camera-settings.v1", "camera unchanged"],
  ]);
  const values = {
    dustSpeed: 19,
    dustDensity: 1.7,
    sonicEnabled: false,
    sonicSpeed: 175,
  };
  assert.equal(saveSpeedEffectSettings(storage, values), true);
  assert.equal(
    storage.data.get("kinetic.camera-settings.v1"),
    "camera unchanged",
  );
  assert.deepEqual(
    loadSpeedEffectSettings(storage),
    sanitizeSpeedEffectSettings(values),
  );
  assert.deepEqual(JSON.parse(storage.data.get(SPEED_EFFECT_SETTINGS_KEY)), {
    version: 1,
    values: sanitizeSpeedEffectSettings(values),
  });
  assert.equal(loadSpeedEffectSettings(memoryStorage()), null);
  for (const raw of [
    "{",
    "null",
    "[]",
    '{"version":2,"values":{}}',
    '{"version":1,"values":[]}',
  ]) {
    assert.equal(
      loadSpeedEffectSettings(
        memoryStorage([[SPEED_EFFECT_SETTINGS_KEY, raw]]),
      ),
      null,
    );
  }
  const blocked = {
    getItem() {
      throw new Error("blocked");
    },
    setItem() {
      throw new Error("blocked");
    },
  };
  assert.equal(loadSpeedEffectSettings(blocked), null);
  assert.equal(saveSpeedEffectSettings(blocked, values), false);
  assert.equal(saveSpeedEffectSettings(null, values), false);
});

test("v087 sonic crossing uses actual 3D speed and a lower hysteresis rearm threshold", () => {
  const effects = new SpeedEffects();
  try {
    effects.configure({ dustDensity: 0, sonicSpeed: 40 });
    const sample = context({ grounded: false });
    sample.velocity.y = 39;
    effects.update(1 / 60, sample);
    assert.equal(effects.telemetry.sonicBursts, 0);
    sample.velocity.y = 41;
    effects.update(1 / 60, sample);
    assert.equal(effects.telemetry.sonicBursts, 1);
    assert.ok(effects.telemetry.activeRings > 0);
    assert.ok(effects.telemetry.activeStreaks > 0);
    for (const speed of [45, 100, 39, 41, 33, 41]) {
      sample.velocity.y = speed;
      effects.update(1 / 60, sample);
    }
    assert.equal(
      effects.telemetry.sonicBursts,
      1,
      "small threshold oscillations do not retrigger",
    );
    sample.velocity.y = 31;
    effects.update(1 / 60, sample);
    sample.velocity.y = 41;
    effects.update(1 / 60, sample);
    assert.equal(effects.telemetry.sonicBursts, 2);
    assert.equal(
      effects.telemetry.dustEmissions,
      0,
      "airborne sonic bursts do not kick up floor dust",
    );
  } finally {
    effects.dispose();
  }
});

test("v087 crossing bursts occur once per crossing at 30, 60 and 120 fps", () => {
  for (const fps of [30, 60, 120]) {
    const effects = new SpeedEffects();
    try {
      effects.configure({ dustDensity: 0 });
      const sample = context({
        velocity: { x: 60, y: 0, z: 0 },
        grounded: false,
      });
      stepFor(effects, 1, fps, sample);
      assert.equal(
        effects.telemetry.sonicBursts,
        1,
        `${fps} fps initial crossing`,
      );
      sample.velocity.x = 20;
      stepFor(effects, 0.5, fps, sample);
      sample.velocity.x = 80;
      stepFor(effects, 1, fps, sample);
      assert.equal(
        effects.telemetry.sonicBursts,
        2,
        `${fps} fps rearmed crossing`,
      );
    } finally {
      effects.dispose();
    }
  }
});

test("v087 disabled and zero-intensity sonic effects emit no flash or persistent burst", () => {
  for (const config of [{ sonicEnabled: false }, { sonicIntensity: 0 }]) {
    const effects = new SpeedEffects();
    try {
      effects.configure({ ...config, dustDensity: 0 });
      stepFor(effects, 1, 60, context({ velocity: { x: 100, y: 0, z: 0 } }));
      assert.equal(effects.telemetry.sonicBursts, 0);
      assert.equal(effects.telemetry.activeRings, 0);
      assert.equal(effects.telemetry.activeStreaks, 0);
    } finally {
      effects.dispose();
    }
  }
});

test("v087 dust needs horizontal speed and floor contact, including on rooftops", () => {
  const effects = new SpeedEffects();
  try {
    effects.configure({ sonicEnabled: false, dustSpeed: 8 });
    const sample = context({
      position: { x: 2, y: 13, z: 3 },
      floorHeight: 12,
    });
    sample.velocity.y = 100;
    stepFor(effects, 0.5, 60, sample);
    assert.equal(
      effects.telemetry.dustEmissions,
      0,
      "vertical movement alone is not running dust",
    );
    sample.velocity.x = 7;
    sample.velocity.y = 0;
    stepFor(effects, 0.5, 60, sample);
    assert.equal(effects.telemetry.dustEmissions, 0);
    sample.velocity.x = 30;
    sample.grounded = false;
    stepFor(effects, 0.5, 60, sample);
    assert.equal(
      effects.telemetry.dustEmissions,
      0,
      "jumping does not leave a continuous air trail",
    );
    sample.grounded = true;
    sample.feet = [
      { x: 1.8, y: 12, z: 3 },
      { position: { x: 2.2, y: 12, z: 3 }, contact: true },
    ];
    stepFor(effects, 0.3, 60, sample);
    assert.ok(effects.telemetry.dustEmissions > 0);
    for (const dust of effects.dust) {
      if (dust.active)
        assert.ok(
          dust.y >= 11.95,
          "dust uses the current physical support height",
        );
    }
    const emitted = effects.telemetry.dustEmissions;
    sample.grounded = false;
    stepFor(effects, 1, 60, sample);
    assert.equal(effects.telemetry.dustEmissions, emitted);
    assert.equal(
      effects.telemetry.activeDust,
      0,
      "existing dust dissipates after leaving the floor",
    );
  } finally {
    effects.dispose();
  }
});

test("v087 running dust honors explicit planted feet and skips visual flight windows", () => {
  const effects = new SpeedEffects();
  try {
    effects.configure({ sonicEnabled: false });
    const sample = context({
      velocity: { x: 30, y: 0, z: 0 },
      feet: [
        { position: { x: -4, y: 0, z: 0 }, contact: false },
        { position: { x: 4, y: 0, z: 0 }, contact: false },
      ],
    });
    stepFor(effects, 0.5, 60, sample);
    assert.equal(
      effects.dustEmissions,
      0,
      "low ankles alone do not imply a planted foot",
    );
    sample.feet[0].contact = true;
    stepFor(effects, 0.25, 60, sample);
    assert.ok(effects.dustEmissions > 0);
    for (const dust of effects.dust)
      if (dust.active)
        assert.ok(dust.x < -3, "dust comes from the only planted foot");
    const emitted = effects.dustEmissions;
    sample.feet[0].contact = false;
    stepFor(effects, 0.25, 60, sample);
    assert.equal(effects.dustEmissions, emitted);
  } finally {
    effects.dispose();
  }
});

test("v087 airborne sonic crossings near a floor never emit ground dust", () => {
  const effects = new SpeedEffects();
  try {
    effects.update(
      1 / 60,
      context({
        grounded: false,
        position: { x: 0, y: 0.1, z: 0 },
        velocity: { x: 80, y: 0, z: 0 },
      }),
    );
    assert.equal(effects.sonicBursts, 1);
    assert.equal(effects.dustEmissions, 0);
  } finally {
    effects.dispose();
  }
});

test("v087 changing sonic travel direction retains a full perpendicular streak spread", () => {
  const effects = new SpeedEffects();
  try {
    effects.configure({ dustDensity: 0 });
    const sample = context({
      grounded: false,
      velocity: { x: 64, y: 48, z: 0 },
    });
    effects.update(1 / 60, sample);
    sample.velocity.x = sample.velocity.y = 0;
    stepFor(effects, 1, 60, sample);
    sample.velocity.x = -48;
    sample.velocity.y = 64;
    effects.update(1 / 60, sample);
    assert.equal(effects.sonicBursts, 2);
    for (const streak of effects.streaks) {
      if (!streak.active) continue;
      const x = streak.x + streak.dx * 0.9;
      const y = streak.y - 2 + streak.dy * 0.9;
      const z = streak.z + streak.dz * 0.9;
      assert.ok(
        Math.hypot(x, y, z) >= 0.54,
        "the travel frame cannot collapse after a diagonal crossing",
      );
      assert.ok(Math.abs(x * streak.dx + y * streak.dy + z * streak.dz) < 1e-9);
    }
  } finally {
    effects.dispose();
  }
});

test("v087 running dust density follows elapsed time and zero controls suppress emissions", () => {
  const counts = [];
  for (const fps of [30, 60, 120]) {
    const effects = new SpeedEffects();
    try {
      effects.configure({ sonicEnabled: false });
      stepFor(effects, 2, fps, context({ velocity: { x: 30, y: 0, z: 0 } }));
      counts.push(effects.telemetry.dustEmissions);
    } finally {
      effects.dispose();
    }
  }
  assert.ok(Math.min(...counts) > 0);
  assert.ok(
    Math.max(...counts) - Math.min(...counts) <=
      Math.max(3, Math.min(...counts) * 0.2),
    `frame rates emitted ${counts.join(", ")}`,
  );
  for (const config of [{ dustDensity: 0 }, { dustIntensity: 0 }]) {
    const effects = new SpeedEffects();
    try {
      effects.configure({ sonicEnabled: false, ...config });
      stepFor(effects, 1, 60, context({ velocity: { x: 100, y: 0, z: 0 } }));
      effects.update(
        1 / 60,
        context({ grounded: false, velocity: { x: 0, y: -25, z: 0 } }),
      );
      effects.update(1 / 60, context());
      assert.equal(effects.telemetry.dustEmissions, 0);
    } finally {
      effects.dispose();
    }
  }
});

test("v087 running dust responds to resolved speed, turns and acceleration", () => {
  const emitted = {};
  for (const mode of ["slow", "fast", "turn", "accelerate"]) {
    const effects = new SpeedEffects();
    try {
      effects.configure({ sonicEnabled: false });
      const sample = context({ velocity: { x: 30, y: 0, z: 0 } });
      stepFor(effects, 1, 60, sample);
      const before = effects.dustEmissions;
      for (let frame = 0; frame < 60; frame++) {
        sample.velocity.x =
          mode === "slow"
            ? 9
            : mode === "fast"
              ? 30
              : mode === "turn"
                ? frame % 2
                  ? 30
                  : -30
                : frame % 2
                  ? 12
                  : 70;
        effects.update(1 / 60, sample);
      }
      emitted[mode] = effects.dustEmissions - before;
    } finally {
      effects.dispose();
    }
  }
  assert.ok(emitted.fast > emitted.slow);
  assert.ok(
    emitted.turn > emitted.fast,
    "changing heading at the same speed adds contact dust",
  );
  assert.ok(
    emitted.accelerate > emitted.fast,
    "rapid changes in resolved travel add contact dust",
  );
});

test("v087 a hard landing gives one brief ground burst below the running threshold", () => {
  const effects = new SpeedEffects();
  try {
    effects.configure({ sonicEnabled: false, dustSpeed: 1000 });
    const sample = context({
      grounded: false,
      velocity: { x: 0, y: -20, z: 0 },
    });
    effects.update(1 / 60, sample);
    assert.equal(effects.telemetry.dustEmissions, 0);
    sample.grounded = true;
    sample.velocity.y = 0;
    effects.update(1 / 60, sample);
    const burst = effects.telemetry.dustEmissions;
    assert.ok(burst > 0);
    stepFor(effects, 1, 60, sample);
    assert.equal(
      effects.telemetry.dustEmissions,
      burst,
      "standing on the floor cannot repeat a landing burst",
    );
    assert.equal(effects.telemetry.activeDust, 0);
    sample.grounded = false;
    sample.velocity.y = -2;
    effects.update(1 / 60, sample);
    sample.grounded = true;
    sample.velocity.y = 0;
    effects.update(1 / 60, sample);
    assert.equal(
      effects.telemetry.dustEmissions,
      burst,
      "gentle contact does not produce a hard-landing plume",
    );
  } finally {
    effects.dispose();
  }
});

test("v087 pools stay bounded and finite under 100x movement and repeated crossings", () => {
  const effects = new SpeedEffects();
  try {
    assert.deepEqual(SPEED_EFFECT_LIMITS, { dust: 64, rings: 2, streaks: 12 });
    const pools = [effects.dust, effects.rings, effects.streaks];
    const instanceColor = effects.streakMesh.instanceColor;
    const instanceMatrix = effects.streakMesh.instanceMatrix;
    assert.ok(
      instanceColor,
      "color storage is allocated before the first crossing",
    );
    const slots = pools.map((pool) => pool.slice());
    const renderObjects = [];
    effects.group.traverse((object) => renderObjects.push(object));
    effects.configure({ dustDensity: 2, dustIntensity: 3, sonicIntensity: 3 });
    const sample = context({ velocity: { x: 1000, y: 0, z: 0 } });
    for (let i = 0; i < 1200; i++) {
      sample.position.x = (i * 1000) / 60;
      sample.position.z = Math.sin(i * 0.05) * 100;
      sample.velocity.x = i % 10 < 2 ? 0 : i % 20 < 10 ? 1000 : -1000;
      sample.velocity.z = i % 3 ? 250 : -250;
      if (i % 10 === 0) sample.velocity.z = 0;
      effects.update(i % 25 === 0 ? 10 : 1 / 60, sample);
      assert.ok(effects.telemetry.activeDust <= SPEED_EFFECT_LIMITS.dust);
      assert.ok(effects.telemetry.activeRings <= SPEED_EFFECT_LIMITS.rings);
      assert.ok(effects.telemetry.activeStreaks <= SPEED_EFFECT_LIMITS.streaks);
    }
    assert.equal(effects.dust, pools[0]);
    assert.equal(effects.rings, pools[1]);
    assert.equal(effects.streaks, pools[2]);
    assert.equal(effects.streakMesh.instanceColor, instanceColor);
    assert.equal(effects.streakMesh.instanceMatrix, instanceMatrix);
    for (let p = 0; p < pools.length; p++) {
      for (let i = 0; i < pools[p].length; i++) {
        const slot = pools[p][i];
        assert.equal(slot, slots[p][i], "particle state objects are reused");
        assert.ok(Number.isFinite(slot.age));
        assert.ok(Number.isFinite(slot.life));
        for (const value of Object.values(slot))
          if (typeof value === "number") assert.ok(Number.isFinite(value));
      }
    }
    const currentObjects = [];
    effects.group.traverse((object) => {
      currentObjects.push(object);
      for (const value of [
        ...object.position.toArray(),
        ...object.scale.toArray(),
        ...object.quaternion.toArray(),
      ]) {
        assert.ok(Number.isFinite(value), "render transforms remain finite");
      }
    });
    assert.deepEqual(
      currentObjects,
      renderObjects,
      "render objects are reused",
    );
    for (const buffer of [
      effects.dustPositions,
      effects.dustSizes,
      effects.dustOpacities,
    ]) {
      for (const value of buffer)
        assert.ok(
          Number.isFinite(value),
          "dust render attributes remain finite",
        );
    }
    assert.ok(effects.telemetry.dustEmissions > 0);
    assert.ok(effects.telemetry.sonicBursts > 2);
    assert.ok(Object.isFrozen(effects.telemetry));
    assert.throws(() => {
      effects.telemetry.dustEmissions = 0;
    }, TypeError);
  } finally {
    effects.dispose();
  }
});

test("v087 reset reuses render pools and clears transient state; invalid frame time is ignored", () => {
  const effects = new SpeedEffects();
  try {
    effects.configure({ dustSpeed: 11 });
    const sample = context({ velocity: { x: 100, y: 0, z: 0 } });
    const dust = effects.dust;
    stepFor(effects, 0.3, 60, sample);
    assert.ok(effects.telemetry.sonicBursts > 0);
    effects.reset();
    assert.equal(effects.dust, dust);
    for (const key of [
      "dustEmissions",
      "sonicBursts",
      "activeDust",
      "activeRings",
      "activeStreaks",
    ])
      assert.equal(effects.telemetry[key], 0);
    for (const dt of [0, -1, NaN, Infinity]) effects.update(dt, sample);
    for (const key of [
      "dustEmissions",
      "sonicBursts",
      "activeDust",
      "activeRings",
      "activeStreaks",
    ])
      assert.equal(effects.telemetry[key], 0);
    effects.update(1 / 60, sample);
    assert.equal(
      effects.telemetry.sonicBursts,
      1,
      "reset rearms threshold detection",
    );
    assert.equal(
      effects.settings.dustSpeed,
      11,
      "reset retains the selected settings",
    );
  } finally {
    effects.dispose();
  }
});

test("v087 configuring effects preserves other controls and never mutates movement inputs", () => {
  const effects = new SpeedEffects();
  try {
    effects.configure({ dustSpeed: 15, sonicSpeed: 60, dustDensity: 0.5 });
    effects.configure({ dustIntensity: 2, sonicIntensity: 1.5 });
    assert.equal(effects.settings.dustSpeed, 15);
    assert.equal(effects.settings.sonicSpeed, 60);
    assert.equal(effects.settings.dustDensity, 0.5);
    assert.equal(effects.settings.dustIntensity, 2);
    const position = Object.freeze({ x: 3, y: 9, z: -2 });
    const velocity = Object.freeze({ x: 1000, y: 0, z: 15 });
    const feet = Object.freeze([
      Object.freeze({
        position: Object.freeze({ x: 2.8, y: 8, z: -2 }),
        contact: true,
      }),
      Object.freeze({
        position: Object.freeze({ x: 3.2, y: 8, z: -2 }),
        contact: true,
      }),
    ]);
    const sample = Object.freeze({
      position,
      velocity,
      grounded: true,
      floorHeight: 8,
      feet,
    });
    stepFor(effects, 1, 60, sample);
    assert.deepEqual(position, { x: 3, y: 9, z: -2 });
    assert.deepEqual(velocity, { x: 1000, y: 0, z: 15 });
    assert.ok(effects.telemetry.dustEmissions > 0);
    assert.equal(effects.telemetry.sonicBursts, 1);
  } finally {
    effects.dispose();
  }
});
