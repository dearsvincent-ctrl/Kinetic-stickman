import test from "node:test";
import assert from "node:assert/strict";
import {
  ARCHETYPE_IDS,
  DEFAULT_ENEMY_PROFILES,
  ENEMY_ABILITY_PARAMETERS,
  ENEMY_ABILITY_TOGGLES,
  sanitizeEnemyProfile,
  sanitizeRoster,
  rosterCount,
  rosterProfileAt,
} from "../src/sandbox/EnemyAbilities.js";
import { DEFAULT_ENEMY_SETTINGS } from "../src/sandbox/EnemySettings.js";
import { DEFAULT_TAG_SETTINGS } from "../src/sandbox/TagSettings.js";
import { JUMP_CONFIG } from "../src/movement/JumpState.js";

test("four default archetypes have distinct grounded, acrobatic, superhuman and heavy capabilities", () => {
  const { standard, acrobat, leaper, heavy } = DEFAULT_ENEMY_PROFILES;
  assert.deepEqual(ARCHETYPE_IDS, ["standard", "acrobat", "leaper", "heavy"]);
  assert.equal(standard.runSpeed, 3.6);
  assert.equal(standard.acceleration, 11);
  assert.equal(standard.deceleration, 15);
  assert.equal(standard.maxJumps, 1);
  assert.equal(standard.climb, false);
  assert.equal(standard.wallRun, false);
  assert.ok(acrobat.runSpeed > standard.runSpeed);
  assert.ok(acrobat.turnRate > standard.turnRate);
  assert.equal(acrobat.maxJumps, 2);
  assert.ok(
    acrobat.climb && acrobat.wallRun && acrobat.ledgeGrab && acrobat.rooftop,
  );
  assert.ok(leaper.jumpHeight >= standard.jumpHeight * 50);
  assert.ok(leaper.runSpeed > acrobat.runSpeed);
  assert.ok(leaper.acceleration > acrobat.acceleration);
  assert.ok(leaper.airControl > acrobat.airControl);
  assert.ok(leaper.climb && leaper.wallRun && leaper.rooftop);
  assert.ok(heavy.runSpeed < standard.runSpeed);
  assert.ok(heavy.damage > standard.damage);
  assert.ok(heavy.knockbackResistance > standard.knockbackResistance);
  assert.ok(heavy.jumpInterval > standard.jumpInterval);
  assert.equal(
    new Set(ARCHETYPE_IDS.map((id) => DEFAULT_ENEMY_PROFILES[id].color)).size,
    4,
  );
  for (const profile of Object.values(DEFAULT_ENEMY_PROFILES)) {
    assert.ok(Object.isFrozen(profile));
    assert.ok(
      ENEMY_ABILITY_PARAMETERS.every(({ id }) => Number.isFinite(profile[id])),
    );
  }
});

test("ability data clamps extreme values, rejects invalid numbers and keeps independently gated traversal abilities", () => {
  const profile = sanitizeEnemyProfile("leaper", {
    id: "untrusted",
    name: "untrusted",
    color: NaN,
    runSpeed: 1e100,
    acceleration: Infinity,
    deceleration: -5,
    jumpHeight: 1e100,
    maxJumps: 2.8,
    airControl: NaN,
    aerialControl: 1e100,
    turnRate: -100,
    climbSpeed: 0,
    jumpInterval: "1",
    damage: -1,
    knockbackResistance: 1e100,
    climb: false,
    wallRun: true,
    ledgeGrab: false,
    rooftop: true,
  });
  assert.equal(profile.id, "leaper");
  assert.equal(profile.name, "Leaper");
  assert.equal(profile.color, DEFAULT_ENEMY_PROFILES.leaper.color);
  assert.equal(profile.runSpeed, 100);
  assert.equal(
    profile.acceleration,
    DEFAULT_ENEMY_PROFILES.leaper.acceleration,
  );
  assert.equal(profile.deceleration, 0.1);
  assert.equal(profile.jumpHeight, 500);
  assert.equal(profile.maxJumps, 3);
  assert.equal(profile.airControl, DEFAULT_ENEMY_PROFILES.leaper.airControl);
  assert.equal(profile.aerialControl, 8);
  assert.equal(profile.turnRate, 1);
  assert.equal(profile.climbSpeed, 1);
  assert.equal(
    profile.jumpInterval,
    DEFAULT_ENEMY_PROFILES.leaper.jumpInterval,
  );
  assert.equal(profile.damage, 0);
  assert.equal(profile.knockbackResistance, 100);
  assert.equal(profile.climb, false);
  assert.equal(profile.wallRun, true);
  assert.equal(profile.ledgeGrab, false);
  assert.equal(profile.rooftop, true);
  for (const id of ENEMY_ABILITY_TOGGLES.map((p) => p.id))
    assert.equal(sanitizeEnemyProfile("standard", { [id]: "true" })[id], false);
  assert.deepEqual(
    sanitizeEnemyProfile("missing"),
    DEFAULT_ENEMY_PROFILES.standard,
  );
  assert.deepEqual(
    sanitizeEnemyProfile("heavy", null),
    DEFAULT_ENEMY_PROFILES.heavy,
  );
});

test("profile edits merge cleanly without changing another archetype, player jumping or global enemy settings", () => {
  const profiles = { ...DEFAULT_ENEMY_PROFILES };
  const before = JSON.stringify({
    profiles,
    enemy: DEFAULT_ENEMY_SETTINGS,
    tag: DEFAULT_TAG_SETTINGS,
    jump: JUMP_CONFIG,
  });
  profiles.acrobat = sanitizeEnemyProfile("acrobat", {
    ...profiles.acrobat,
    jumpHeight: 12,
    climb: false,
  });
  assert.equal(profiles.acrobat.jumpHeight, 12);
  assert.equal(profiles.acrobat.climb, false);
  assert.equal(profiles.acrobat.wallRun, true);
  assert.equal(profiles.acrobat.maxJumps, 2);
  assert.equal(profiles.leaper, DEFAULT_ENEMY_PROFILES.leaper);
  assert.equal(DEFAULT_ENEMY_PROFILES.acrobat.jumpHeight, 2);
  assert.equal(DEFAULT_ENEMY_SETTINGS.speed, 1);
  assert.equal(DEFAULT_TAG_SETTINGS.speed, 1);
  assert.ok(Math.abs(JUMP_CONFIG.height - 1.2) < 1e-9);
  const roundTrip = JSON.parse(JSON.stringify(profiles.acrobat));
  assert.deepEqual(
    sanitizeEnemyProfile("acrobat", roundTrip),
    profiles.acrobat,
  );
  assert.notEqual(
    JSON.stringify({
      profiles,
      enemy: DEFAULT_ENEMY_SETTINGS,
      tag: DEFAULT_TAG_SETTINGS,
      jump: JUMP_CONFIG,
    }),
    before,
  );
});

test("custom rosters represent exact mixed counts in a deterministic fair cycle", () => {
  const counts = sanitizeRoster({ standard: 3, acrobat: 2, heavy: 1 });
  assert.deepEqual(counts, { standard: 3, acrobat: 2, leaper: 0, heavy: 1 });
  assert.equal(rosterCount(counts), 6);
  assert.deepEqual(
    Array.from({ length: 6 }, (_, i) => rosterProfileAt(counts, i)),
    ["standard", "acrobat", "heavy", "standard", "acrobat", "standard"],
  );
  assert.equal(rosterProfileAt(counts, 6), "standard");
  assert.equal(rosterProfileAt(counts, 8), "heavy");
  assert.deepEqual(
    Array.from({ length: 4 }, (_, i) =>
      rosterProfileAt(
        sanitizeRoster({ standard: 20, acrobat: 20, leaper: 20, heavy: 20 }),
        i,
      ),
    ),
    ARCHETYPE_IDS,
  );
  assert.ok(Object.isFrozen(counts));
});

test("legacy, empty and single-archetype roster selection remain distinct and safely bounded", () => {
  assert.equal(sanitizeRoster(null), null);
  assert.equal(rosterProfileAt(null, 0), "standard");
  assert.equal(rosterCount(null), 0);
  const empty = sanitizeRoster({});
  assert.equal(rosterCount(empty), 0);
  assert.equal(rosterProfileAt(empty, 0), null);
  const leapers = sanitizeRoster({
    standard: -1,
    acrobat: NaN,
    leaper: 2000,
    heavy: "3",
  });
  assert.deepEqual(leapers, { standard: 0, acrobat: 0, leaper: 64, heavy: 0 });
  for (let i = 0; i < 64; i++)
    assert.equal(rosterProfileAt(leapers, i), "leaper");
  assert.equal(rosterProfileAt(leapers, -1), null);
  assert.equal(rosterProfileAt(leapers, Infinity), null);
  assert.equal(rosterProfileAt({ standard: Infinity, heavy: 2 }, 0), "heavy");
  assert.equal(rosterCount({ standard: Infinity, heavy: 2 }), 2);
});
