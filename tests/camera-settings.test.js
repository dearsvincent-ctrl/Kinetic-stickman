import test from "node:test";
import assert from "node:assert/strict";
import {
  CAMERA_DEFAULTS,
  CAMERA_PARAMETERS,
  CAMERA_SETTINGS_KEY,
  CameraPreferences,
  sanitizeCameraSettings,
} from "../src/sandbox/CameraSettings.js";
import { CameraSettingsPanel } from "../src/ui/CameraSettingsPanel.js";

function memoryStorage(entries = []) {
  const data = new Map(entries);
  const writes = [];
  return {
    data,
    writes,
    getItem: (key) => data.get(key) ?? null,
    setItem(key, value) {
      writes.push(key);
      data.set(key, value);
    },
  };
}

test("camera defaults retain the existing 52 degree manual view", () => {
  assert.deepEqual(CAMERA_DEFAULTS, {
    mode: "manual",
    dynamicFov: false,
    baseFov: 52,
    maxFov: 105,
    sensitivity: 1,
    smoothness: 0.35,
    awareness: 90,
    strength: 0.35,
    overrideDelay: 1.25,
  });
  assert.deepEqual(sanitizeCameraSettings(), CAMERA_DEFAULTS);
  assert.ok(Object.isFrozen(CAMERA_DEFAULTS));
  assert.ok(Object.isFrozen(CAMERA_PARAMETERS));
  assert.deepEqual(
    CAMERA_PARAMETERS.map(({ id, min, max, step, log }) => ({
      id,
      min,
      max,
      ...(step === undefined ? {} : { step }),
      ...(log === undefined ? {} : { log }),
    })),
    [
      { id: "baseFov", min: 50, max: 120, step: 1 },
      { id: "maxFov", min: 50, max: 120, step: 1 },
      { id: "sensitivity", min: 0.1, max: 4, log: true },
      { id: "smoothness", min: 0.05, max: 3, log: true },
      { id: "awareness", min: 2, max: 2000, log: true },
      { id: "strength", min: 0, max: 1, step: 0.05 },
      { id: "overrideDelay", min: 0, max: 5, step: 0.05 },
    ],
  );
  for (const parameter of CAMERA_PARAMETERS) assert.ok(Object.isFrozen(parameter));
});

test("camera sanitization clamps every numeric field and keeps maximum FOV above base", () => {
  const high = sanitizeCameraSettings(
    Object.fromEntries(CAMERA_PARAMETERS.map(({ id }) => [id, 1e9])),
  );
  const low = sanitizeCameraSettings(
    Object.fromEntries(CAMERA_PARAMETERS.map(({ id }) => [id, -1e9])),
  );
  for (const { id, min, max } of CAMERA_PARAMETERS) {
    assert.equal(high[id], max, id);
    assert.equal(low[id], min, id);
  }
  assert.equal(sanitizeCameraSettings({ baseFov: 110, maxFov: 55 }).maxFov, 110);
  assert.equal(sanitizeCameraSettings({ baseFov: 200, maxFov: 105 }).maxFov, 120);
  assert.ok(Object.isFrozen(high));
  for (const bad of [NaN, Infinity, -Infinity, null, "80", {}, undefined]) {
    for (const { id } of CAMERA_PARAMETERS)
      assert.deepEqual(sanitizeCameraSettings({ [id]: bad }), CAMERA_DEFAULTS);
  }
  assert.deepEqual(sanitizeCameraSettings(null), CAMERA_DEFAULTS);
});

test("camera mode and dynamic FOV accept only their explicit enum and boolean values", () => {
  for (const mode of ["manual", "assisted", "dynamic"])
    assert.equal(sanitizeCameraSettings({ mode }).mode, mode);
  for (const mode of ["auto", "MANUAL", null, 1, true])
    assert.equal(sanitizeCameraSettings({ mode }).mode, "manual");
  assert.equal(sanitizeCameraSettings({ dynamicFov: true }).dynamicFov, true);
  for (const dynamicFov of [false, "true", 1, null, undefined])
    assert.equal(sanitizeCameraSettings({ dynamicFov }).dynamicFov, false);
  assert.deepEqual(
    Object.keys(sanitizeCameraSettings({ enemyDetection: 1000, distance: 9 })),
    Object.keys(CAMERA_DEFAULTS),
  );
});

test("camera profiles merge updates, freeze snapshots and persist independently", () => {
  const storage = memoryStorage();
  const preferences = new CameraPreferences(storage);
  assert.equal(preferences.lastSaveSucceeded, null);
  assert.equal(storage.writes.length, 0);
  const initial = preferences.values;
  assert.ok(Object.isFrozen(initial));
  assert.ok(Object.isFrozen(initial.combat));
  assert.ok(Object.isFrozen(initial.tag));
  preferences.update("combat", { mode: "assisted", baseFov: 75, strength: 0.8 });
  const combat = preferences.get("combat");
  preferences.update("tag", { mode: "dynamic", dynamicFov: true, awareness: 1200 });
  preferences.update("tag", { sensitivity: 2 });
  assert.equal(preferences.get("combat"), combat);
  assert.deepEqual(initial.combat, CAMERA_DEFAULTS);
  assert.equal(preferences.get("tag").awareness, 1200);
  assert.equal(preferences.get("tag").sensitivity, 2);
  assert.equal(preferences.get("tag").dynamicFov, true);
  assert.ok(preferences.lastSaveSucceeded);
  assert.deepEqual(storage.writes, Array(3).fill(CAMERA_SETTINGS_KEY));
  const saved = JSON.parse(storage.data.get(CAMERA_SETTINGS_KEY));
  assert.equal(saved.version, 1);
  assert.deepEqual(saved.values, preferences.values);
  const restored = new CameraPreferences(storage);
  assert.deepEqual(restored.values, preferences.values);
  assert.equal(storage.writes.length, 3, "loading and reading never resave");
  assert.throws(() => {
    restored.get("tag").baseFov = 90;
  }, TypeError);
});

test("camera reset touches only the selected profile and never writes legacy saves", () => {
  const legacy = [
    ["kinetic.controls.v1", "saved HUD"],
    ["kinetic.physics-sandbox.v1", "saved physics"],
    ["kinetic.aim-assist.v1", "saved aim"],
    ["kinetic.enemy-settings.v1", "saved pursuit"],
    ["kinetic.tag-settings.v1", "saved escape"],
  ];
  const storage = memoryStorage(legacy);
  const preferences = new CameraPreferences(storage);
  preferences.update("combat", { mode: "dynamic", baseFov: 100 });
  preferences.update("tag", { mode: "assisted", sensitivity: 3, strength: 0.9 });
  const tag = preferences.get("tag");
  assert.deepEqual(preferences.reset("combat"), CAMERA_DEFAULTS);
  assert.equal(preferences.get("tag"), tag);
  assert.deepEqual(new CameraPreferences(storage).get("tag"), tag);
  for (const [key, value] of legacy) assert.equal(storage.data.get(key), value);
  assert.ok(storage.writes.every((key) => key === CAMERA_SETTINGS_KEY));
});

test("camera storage rejects invalid schemas and sanitizes valid profiles independently", () => {
  for (const raw of [
    "{",
    "null",
    "[]",
    '{"version":99,"values":{"combat":{"baseFov":90}}}',
    '{"version":"1","values":{}}',
    '{"version":1,"values":[]}',
    '{"version":1,"values":"bad"}',
    '{"version":1}',
  ]) {
    const storage = memoryStorage([[CAMERA_SETTINGS_KEY, raw]]);
    const preferences = new CameraPreferences(storage);
    assert.deepEqual(preferences.values, {
      combat: CAMERA_DEFAULTS,
      tag: CAMERA_DEFAULTS,
    });
    assert.equal(storage.writes.length, 0);
  }
  const storage = memoryStorage([
    [
      CAMERA_SETTINGS_KEY,
      '{"version":1,"values":{"combat":[],"tag":{"mode":"dynamic","baseFov":100,"maxFov":50,"awareness":1e999,"strength":"1"}}}',
    ],
  ]);
  const preferences = new CameraPreferences(storage);
  assert.deepEqual(preferences.get("combat"), CAMERA_DEFAULTS);
  assert.equal(preferences.get("tag").mode, "dynamic");
  assert.equal(preferences.get("tag").baseFov, 100);
  assert.equal(preferences.get("tag").maxFov, 100);
  assert.equal(preferences.get("tag").awareness, CAMERA_DEFAULTS.awareness);
  assert.equal(preferences.get("tag").strength, CAMERA_DEFAULTS.strength);
});

test("camera settings remain live when browser storage cannot read or write", () => {
  for (const storage of [
    null,
    {},
    {
      getItem() {
        throw new Error("blocked");
      },
      setItem() {
        throw new Error("blocked");
      },
    },
    {
      getItem: () => null,
      setItem() {
        throw new Error("full");
      },
    },
  ]) {
    const preferences = new CameraPreferences(storage);
    assert.deepEqual(preferences.get("combat"), CAMERA_DEFAULTS);
    preferences.update("tag", { baseFov: 95, mode: "assisted" });
    assert.equal(preferences.get("tag").baseFov, 95);
    assert.equal(preferences.lastSaveSucceeded, false);
    preferences.reset("tag");
    assert.deepEqual(preferences.get("tag"), CAMERA_DEFAULTS);
    assert.equal(preferences.lastSaveSucceeded, false);
  }
});

test("camera editor stays absent during normal play and display mode changes never save", () => {
  const storage = memoryStorage();
  const preferences = new CameraPreferences(storage);
  preferences.update("tag", { sensitivity: 2 });
  const before = preferences.values;
  const writes = storage.writes.length;
  let callbacks = 0;
  const panel = new CameraSettingsPanel({
    preferences,
    onChange: () => callbacks++,
    getGameplayMode: () => "tag",
  });
  assert.equal(panel.section, undefined);
  assert.equal(panel.profile, "tag");
  panel.setGameplayMode("combat");
  panel.setGameplayMode("tag");
  assert.equal(preferences.values, before);
  assert.equal(storage.writes.length, writes);
  assert.equal(callbacks, 0);
});
