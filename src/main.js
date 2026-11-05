import "./style.css";
import { Game } from "./core/Game.js";

try {
  new Game(document.querySelector("#viewport"));
} catch (error) {
  console.error("Kinetic could not initialize:", error);
  document.querySelector("#loading")?.remove();
  document.querySelector("#error-message").textContent =
    "This prototype needs WebGL 2. Update your browser and check that hardware acceleration is available, then try again.";
  document.querySelector("#error").hidden = false;
}
