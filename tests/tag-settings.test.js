import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_TAG_SETTINGS,
  TAG_PARAMETERS,
  TAG_SETTINGS_KEY,
  sanitizeTagSettings,
  saveTagSettings,
  loadTagSettings,
} from "../src/sandbox/TagSettings.js";
import {
  DEFAULT_ENEMY_SETTINGS,
  ENEMY_SETTINGS_KEY,
  saveEnemySettings,
  loadEnemySettings,
} from "../src/sandbox/EnemySettings.js";
import {
  SANDBOX_STORAGE_KEY,
  savePhysics,
  loadPhysics,
} from "../src/sandbox/PhysicsSandbox.js";

test("tag defaults and bounds are independent of the existing Combat Mode baseline", () => {
  assert.deepEqual(DEFAULT_TAG_SETTINGS, {
    speed: 1,
    acceleration: 1,
    intelligence: 1,
    maxEnemies: 3,
    detection: 60,
    tagRadius: 0.85,
  });
  assert.deepEqual(TAG_PARAMETERS.find((p) => p.id === "speed").min, 0.25);
  assert.equal(TAG_PARAMETERS.find((p) => p.id === "speed").max, 100);
  assert.equal(sanitizeTagSettings({ tagRadius: 0 }).tagRadius, 0.75);
  const c = sanitizeTagSettings({
    speed: 1e9,
    acceleration: -20,
    intelligence: 1.8,
    maxEnemies: 1e8,
    detection: Infinity,
    tagRadius: 200,
  });
  assert.deepEqual(c, {
    speed: 100,
    acceleration: 0.1,
    intelligence: 2,
    maxEnemies: 64,
    detection: 60,
    tagRadius: 3,
  });
  assert.ok(Object.isFrozen(c));
  for (const bad of [NaN, Infinity, -Infinity, null, "20"])
    assert.deepEqual(sanitizeTagSettings({ speed: bad }), DEFAULT_TAG_SETTINGS);
  assert.equal(DEFAULT_ENEMY_SETTINGS.speed, 1);
  assert.equal(DEFAULT_ENEMY_SETTINGS.maxEnemies, 8);
});
test("tag settings save/load leaves pursuit and physics saves intact and safely rejects old or unavailable storage", () => {
  const data = new Map(),
    storage = {
      getItem: (key) => data.get(key),
      setItem: (key, value) => data.set(key, value),
    };
  saveEnemySettings(storage, {
    speed: 500,
    attackFrequency: 3,
    maxEnemies: 24,
  });
  savePhysics(storage, { movement: 100, attackPower: 20, impact: 50 });
  const combat = data.get(ENEMY_SETTINGS_KEY),
    physics = data.get(SANDBOX_STORAGE_KEY);
  assert.ok(
    saveTagSettings(storage, {
      speed: 100,
      acceleration: 5,
      intelligence: 2,
      maxEnemies: 32,
      tagRadius: 1.2,
    }),
  );
  assert.equal(loadTagSettings(storage).speed, 100);
  assert.equal(loadTagSettings(storage).tagRadius, 1.2);
  assert.equal(loadEnemySettings(storage).speed, 500);
  assert.equal(loadPhysics(storage).movement, 100);
  assert.equal(data.get(ENEMY_SETTINGS_KEY), combat);
  assert.equal(data.get(SANDBOX_STORAGE_KEY), physics);
  for (const raw of [
    "{",
    "null",
    '{"version":99,"values":{}}',
    '{"version":1,"values":"bad"}',
  ]) {
    data.set(TAG_SETTINGS_KEY, raw);
    assert.equal(loadTagSettings(storage), null);
  }
  assert.equal(
    loadTagSettings({
      getItem() {
        throw Error("blocked");
      },
    }),
    null,
  );
  assert.equal(
    saveTagSettings(
      {
        setItem() {
          throw Error("full");
        },
      },
      {},
    ),
    false,
  );
  assert.equal(saveTagSettings(null, {}), false);
});
