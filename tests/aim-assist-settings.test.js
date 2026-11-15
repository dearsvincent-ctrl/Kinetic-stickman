import test from "node:test";
import assert from "node:assert/strict";
import {
  AIM_ASSIST_DEFAULTS,
  AIM_ASSIST_STORAGE_KEY,
  loadAimAssist,
  saveAimAssist,
  sanitizeAimAssist,
} from "../src/sandbox/AimAssistSettings.js";
import { loadPhysics, savePhysics } from "../src/sandbox/PhysicsSandbox.js";
test("aim Save/Load preserves old-range values and new 200%/45/60 settings without touching physics or layouts", () => {
  const m = new Map(),
    storage = {
      getItem: (k) => m.get(k) ?? null,
      setItem: (k, v) => m.set(k, v),
    };
  m.set("kinetic.controls.v1", "layout-kept");
  savePhysics(storage, { movement: 20 });
  assert.ok(saveAimAssist(storage, { strength: 0.2, maxAngle: 12, cone: 25 }));
  assert.deepEqual(loadAimAssist(storage), {
    strength: 0.2,
    maxAngle: 12,
    cone: 25,
    debug: false,
  });
  assert.ok(saveAimAssist(storage, { strength: 2, maxAngle: 45, cone: 60 }));
  assert.deepEqual(loadAimAssist(storage), {
    strength: 2,
    maxAngle: 45,
    cone: 60,
    debug: false,
  });
  savePhysics(storage, { movement: 50 });
  assert.equal(loadAimAssist(storage).strength, 2);
  assert.equal(loadPhysics(storage).movement, 50);
  assert.equal(m.get("kinetic.controls.v1"), "layout-kept");
  saveAimAssist(storage, AIM_ASSIST_DEFAULTS);
  assert.deepEqual(loadAimAssist(storage), AIM_ASSIST_DEFAULTS);
  assert.equal(loadPhysics(storage).movement, 50);
});
test("aim saves safely reject malformed/unsupported data, sanitize old bounds and tolerate unavailable storage", () => {
  for (const raw of [
    "invalid",
    "null",
    "[]",
    '{"version":2,"values":{}}',
    '{"version":1,"values":[]}',
  ])
    assert.equal(loadAimAssist({ getItem: () => raw }), null);
  assert.deepEqual(sanitizeAimAssist(null), AIM_ASSIST_DEFAULTS);
  assert.equal(loadAimAssist(null), null);
  assert.equal(saveAimAssist(null, {}), false);
  const broken = {
    getItem: () => {
      throw Error("denied");
    },
    setItem: () => {
      throw Error("denied");
    },
  };
  assert.equal(loadAimAssist(broken), null);
  assert.equal(saveAimAssist(broken, {}), false);
  const old = {
    getItem: (k) =>
      k === AIM_ASSIST_STORAGE_KEY
        ? '{"version":1,"values":{"strength":1,"maxAngle":20,"cone":40}}'
        : null,
  };
  assert.deepEqual(loadAimAssist(old), {
    strength: 1,
    maxAngle: 20,
    cone: 40,
    debug: false,
  });
});
