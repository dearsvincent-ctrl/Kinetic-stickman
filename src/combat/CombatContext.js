/** Reused sensor data at the movement/combat boundary. Reading these fields
 * cannot apply impulses, rotate the actor, consume abilities or change input. */
export function createCombatContext() {
  return {
    speed: 0,
    movementDirection: [0, 0, 0],
    facing: 0,
    dashActive: false,
    opponentDistance: null,
    environment: "ground",
    phase: "grounded",
    canAttack: true,
    height: 0,
    airTimeRemaining: 0,
  };
}

export function updateCombatContext(context, movement) {
  const velocity = movement.velocity;
  const length = velocity.length();
  const jump = movement.jump;
  context.speed = movement.speed;
  context.movementDirection[0] = length > 0.001 ? velocity.x / length : 0;
  context.movementDirection[2] = length > 0.001 ? velocity.z / length : 0;
  context.facing = movement.heading;
  context.dashActive = movement.dash.active;
  context.environment = jump.airborne ? "air" : "ground";
  context.phase = jump.phase;
  context.canAttack = jump.airborne || jump.ready;
  context.height = jump.height;
  context.airTimeRemaining = jump.airborne ? jump.timeToBoundary : 0;
  return context;
}
