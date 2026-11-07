import { CharacterController as Controller } from "../../src/movement/CharacterController.js";
import { magnitudeForSpeed } from "../../src/movement/AnalogueLocomotion.js";
export { TARGET_FACING_CONFIG } from "../../src/movement/CharacterController.js";

// Historical collision, dash, jump and combat fixtures specify fractions of
// the former normal/sprint speeds. Keep those physical scenarios unchanged;
// the new analogue contract is tested directly against Controller elsewhere.
export class CharacterController extends Controller {
  update(dt, input, yaw, facingTarget) {
    if (input.movementMagnitude !== undefined)
      return super.update(dt, input, yaw, facingTarget);
    const magnitude = Math.min(1, Math.hypot(input.move.x, input.move.y));
    const target = input.sprinting
      ? this.sprintSpeed * magnitude
      : magnitude <= 0.5
        ? this.walkingSpeed * magnitude * 2
        : this.walkingSpeed +
          (this.runSpeed - this.walkingSpeed) * (magnitude - 0.5) * 2;
    return super.update(
      dt,
      {
        ...input,
        movementMagnitude: magnitudeForSpeed(target, this.config.analogue),
      },
      yaw,
      facingTarget,
    );
  }
}
