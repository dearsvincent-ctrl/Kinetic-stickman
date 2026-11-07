import test from "node:test";
import assert from "node:assert/strict";
import { Group, Vector3 } from "three";
import {
  CharacterController,
  TARGET_FACING_CONFIG,
} from "./helpers/ControllerFixture.js";
import { ArenaBounds } from "../src/world/ArenaBounds.js";
import { dampAngle } from "../src/core/math.js";

const rates = [1 / 30, 1 / 60, 1 / 120];
const input = (x = 0, y = 0, sprinting = false) => ({
  move: { x, y },
  sprinting,
});
const actor = (options, halfSize = 100) => {
  const root = new Group();
  return {
    root,
    controller: new CharacterController(
      root,
      new ArenaBounds(halfSize),
      options,
    ),
  };
};
const delta = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
const desiredYaw = (actor, target) =>
  Math.atan2(
    -(target.x - actor.root.position.x),
    -(target.z - actor.root.position.z),
  );
const sameMotion = (a, b) => {
  assert.ok(
    a.root.position.equals(b.root.position),
    "target-facing never changes translation",
  );
  assert.ok(
    a.controller.velocity.equals(b.controller.velocity),
    "target-facing never changes velocity",
  );
  assert.equal(a.controller.speed, b.controller.speed);
  assert.equal(a.controller.movementState, b.controller.movementState);
};

test("standing target-facing turns at a capped rate without moving the root at 30/60/120Hz", () => {
  for (const dt of rates) {
    const facing = actor();
    const target = new Vector3(4, 10, 0);
    let previous = facing.controller.heading;
    let largestTurn = 0;
    for (let frame = 0; frame < Math.ceil(1.5 / dt); frame++) {
      facing.controller.update(dt, input(), 0, target);
      const turn = Math.abs(delta(facing.controller.heading, previous));
      largestTurn = Math.max(largestTurn, turn);
      assert.ok(turn <= TARGET_FACING_CONFIG.turnRate * dt + 1e-10);
      assert.ok(facing.root.position.equals(new Vector3()));
      assert.equal(facing.controller.speed, 0);
      assert.ok(facing.controller.velocity.equals(new Vector3()));
      previous = facing.controller.heading;
    }
    assert.ok(largestTurn > 0, "idle characters can turn toward the target");
    assert.ok(
      Math.abs(delta(facing.controller.heading, desiredYaw(facing, target))) <
        0.001,
    );
  }
});

test("target-facing keeps the exact existing walking and sprinting path and speed", () => {
  for (const dt of rates) {
    for (const sprinting of [false, true]) {
      const facing = actor();
      const normal = actor();
      const target = new Vector3(6, 0, 5);
      for (let frame = 0; frame < Math.ceil(2 / dt); frame++) {
        const controls = input(0.6, 0.8, sprinting);
        facing.controller.update(dt, controls, 0.4, target);
        normal.controller.update(dt, controls, 0.4);
        sameMotion(facing, normal);
      }
      assert.ok(
        Math.abs(delta(facing.controller.heading, desiredYaw(facing, target))) <
          0.06,
      );
      assert.ok(
        Math.abs(facing.controller.speed - (sprinting ? 5.2 : 2.6)) < 0.001,
      );
      assert.ok(
        Math.abs(delta(facing.controller.heading, normal.controller.heading)) >
          0.5,
      );
    }
  }
});

test("target-facing preserves continuous steered dash trajectory and wall collision", () => {
  for (const dt of rates) {
    for (const halfSize of [100, 1.6]) {
      const facing = actor(undefined, halfSize);
      const normal = actor(undefined, halfSize);
      const target = new Vector3(-4, 0, 4);
      facing.controller.requestDash();
      normal.controller.requestDash();
      let turnedDuringDash = false;
      for (let frame = 0; frame < Math.ceil(1 / dt); frame++) {
        const controls = frame * dt < 0.09 ? input(0.8, 0.6) : input(-0.5, 0.8);
        facing.controller.update(dt, controls, 0.2, target);
        normal.controller.update(dt, controls, 0.2);
        sameMotion(facing, normal);
        assert.ok(
          facing.controller.dash.direction.equals(
            normal.controller.dash.direction,
          ),
        );
        assert.equal(
          facing.controller.dash.distanceTravelled,
          normal.controller.dash.distanceTravelled,
        );
        assert.equal(
          facing.controller.dash.elapsed,
          normal.controller.dash.elapsed,
        );
        assert.equal(
          facing.controller.dash.exitReason,
          normal.controller.dash.exitReason,
        );
        if (facing.controller.dash.active)
          turnedDuringDash ||=
            Math.abs(
              delta(facing.controller.heading, normal.controller.heading),
            ) > 0.05;
      }
      assert.ok(
        turnedDuringDash,
        "body can face the target independently during the dash",
      );
      assert.equal(facing.controller.dash.active, false);
    }
  }
});

test("without a target, existing movement heading math remains unchanged", () => {
  const implicit = actor();
  const explicit = actor();
  let expected = 0;
  for (let frame = 0; frame < 360; frame++) {
    const controls = input(
      Math.sin(frame / 37),
      Math.cos(frame / 37),
      frame % 80 > 39,
    );
    const before = implicit.root.position.clone();
    implicit.controller.update(1 / 60, controls, 0.7);
    explicit.controller.update(1 / 60, controls, 0.7, null);
    sameMotion(implicit, explicit);
    const displacement = implicit.root.position.clone().sub(before);
    if (implicit.controller.speed > 0.03)
      expected = dampAngle(
        expected,
        Math.atan2(-displacement.x, -displacement.z),
        13,
        1 / 60,
      );
    assert.equal(implicit.controller.heading, expected);
    assert.equal(implicit.controller.heading, explicit.controller.heading);
    assert.ok(implicit.root.quaternion.equals(explicit.root.quaternion));
  }
});

test("releasing a target holds idle orientation and smoothly resumes travel-facing", () => {
  const facing = actor();
  const target = new Vector3(0, 0, 4);
  for (let frame = 0; frame < 120; frame++)
    facing.controller.update(1 / 60, input(), 0, target);
  const initial = facing.controller.heading;
  for (let frame = 0; frame < 30; frame++)
    facing.controller.update(1 / 60, input(), 0, null);
  assert.equal(facing.controller.heading, initial);
  facing.controller.update(1 / 60, input(0, 1), 0, null);
  assert.ok(
    Math.abs(delta(facing.controller.heading, initial)) < 0.7,
    "release does not snap to travel heading",
  );
  assert.ok(
    Math.abs(delta(facing.controller.heading, 0)) > 2,
    "first movement frame remains in transition",
  );
  for (let frame = 0; frame < 90; frame++)
    facing.controller.update(1 / 60, input(0, 1), 0, null);
  assert.ok(Math.abs(delta(facing.controller.heading, 0)) < 0.001);
});

test("target-facing takes the short path across the yaw wrap", () => {
  const facing = actor();
  facing.controller.heading = Math.PI - 0.05;
  facing.root.rotation.y = facing.controller.heading;
  const yaw = -Math.PI + 0.05;
  const target = new Vector3(-Math.sin(yaw) * 4, 0, -Math.cos(yaw) * 4);
  facing.controller.update(1 / 60, input(), 0, target);
  assert.ok(facing.controller.heading > Math.PI - 0.05);
  assert.ok(facing.controller.heading < Math.PI + 0.05);
  assert.ok(facing.root.position.equals(new Vector3()));
});

test("target-facing resolves from wall-corrected position and ignores unusable targets", () => {
  const facing = actor({ facingTurnRate: 2, facingResponse: 20 }, 2);
  const limit = 2 - facing.controller.radius;
  facing.root.position.set(limit, 0, limit);
  const target = new Vector3(-2, 0, limit);
  for (let frame = 0; frame < 90; frame++) {
    const previous = facing.controller.heading;
    facing.controller.update(1 / 60, input(1, -1, true), 0, target);
    assert.ok(
      Math.abs(delta(facing.controller.heading, previous)) <= 2 / 60 + 1e-10,
    );
    assert.ok(facing.root.position.equals(new Vector3(limit, 0, limit)));
  }
  assert.ok(Math.abs(delta(facing.controller.heading, Math.PI / 2)) < 0.001);
  const heading = facing.controller.heading;
  facing.controller.update(1 / 60, input(), 0, facing.root.position);
  assert.equal(
    facing.controller.heading,
    heading,
    "coincident target has no arbitrary yaw",
  );
  facing.controller.update(1 / 60, input(), 0, { x: NaN, z: 0 });
  assert.equal(facing.controller.heading, heading);
  assert.ok(Number.isFinite(facing.root.rotation.y));
});
