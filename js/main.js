import { createTimer, formatDuration } from "./timer.js";

const timerDisplay = document.getElementById("timer-display");

const timer = createTimer(20 * 60 * 1000); // temporary default, replaced by settings in T5

function render() {
  const remaining = timer.getRemaining();
  timerDisplay.textContent = formatDuration(remaining);
  requestAnimationFrame(render);
}

requestAnimationFrame(render);

// Temporary dev hook until real controls land in T3.
window.__timer = timer;
