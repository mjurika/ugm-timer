import { createTimer, formatDuration } from "./timer.js";

const timerDisplay = document.getElementById("timer-display");
const durationEditor = document.getElementById("duration-editor");
const durationMinutes = document.getElementById("duration-minutes");
const durationSeconds = document.getElementById("duration-seconds");
const durationApply = document.getElementById("duration-apply");
const durationCancel = document.getElementById("duration-cancel");
const durationPresets = document.getElementById("duration-presets");
const btnToggle = document.getElementById("btn-toggle");
const btnReset = document.getElementById("btn-reset");
const quickAdjust = document.getElementById("quick-adjust");

const DEFAULT_DURATION_MS = 20 * 60 * 1000; // replaced by settings in T5
const timer = createTimer(DEFAULT_DURATION_MS);

function render() {
  const state = timer.getState();
  const remaining = timer.getRemaining();
  timerDisplay.textContent = formatDuration(remaining);

  const isRunning = state.status === "running";
  btnToggle.textContent = isRunning
    ? "Pause"
    : state.status === "paused"
      ? "Resume"
      : "Start";
  btnToggle.classList.toggle("is-running", isRunning);

  quickAdjust.hidden = !(
    state.status === "running" || state.status === "paused"
  );

  requestAnimationFrame(render);
}
requestAnimationFrame(render);

// --- Start / Pause / Resume toggle ---
btnToggle.addEventListener("click", () => {
  const state = timer.getState();
  if (state.status === "running") {
    timer.pause();
  } else {
    timer.start(); // handles both fresh start and resume-from-pause
  }
});

// --- Reset (double-tap confirm while running) ---
let resetArmed = false;
let resetArmTimeout = null;

btnReset.addEventListener("click", () => {
  const state = timer.getState();
  if (state.status !== "running") {
    timer.reset();
    return;
  }
  if (resetArmed) {
    clearTimeout(resetArmTimeout);
    resetArmed = false;
    btnReset.textContent = "Reset";
    timer.reset();
    return;
  }
  resetArmed = true;
  btnReset.textContent = "Tap again";
  resetArmTimeout = setTimeout(() => {
    resetArmed = false;
    btnReset.textContent = "Reset";
  }, 2000);
});

// --- Duration editor ---
function msToFields(ms) {
  const totalSeconds = Math.round(ms / 1000);
  return {
    minutes: Math.floor(totalSeconds / 60),
    seconds: totalSeconds % 60,
  };
}

function openEditor() {
  const state = timer.getState();
  if (state.status === "running") return; // avoid editing while running
  const { minutes, seconds } = msToFields(state.durationMs);
  durationMinutes.value = String(minutes);
  durationSeconds.value = String(seconds);
  durationEditor.hidden = false;
  timerDisplay.setAttribute("aria-expanded", "true");
}

function closeEditor() {
  durationEditor.hidden = true;
  timerDisplay.setAttribute("aria-expanded", "false");
}

timerDisplay.addEventListener("click", openEditor);
timerDisplay.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    openEditor();
  }
});

durationApply.addEventListener("click", () => {
  const minutes = Math.max(
    0,
    Math.min(180, Number(durationMinutes.value) || 0),
  );
  const seconds = Math.max(0, Math.min(59, Number(durationSeconds.value) || 0));
  timer.setDuration((minutes * 60 + seconds) * 1000);
  closeEditor();
});

durationCancel.addEventListener("click", closeEditor);

durationPresets.addEventListener("click", (e) => {
  const btn = e.target.closest(".preset-btn");
  if (!btn) return;
  const minutes = Number(btn.dataset.minutes);
  durationMinutes.value = String(minutes);
  durationSeconds.value = "0";
});

// --- Quick adjust (±30s / ±1m) ---
function flashDisplay() {
  timerDisplay.classList.remove("flash");
  void timerDisplay.offsetWidth; // force reflow so animation retriggers on rapid taps
  timerDisplay.classList.add("flash");
}

quickAdjust.addEventListener("click", (e) => {
  const btn = e.target.closest(".adjust-btn");
  if (!btn) return;
  const deltaSeconds = Number(btn.dataset.delta);
  timer.adjust(deltaSeconds * 1000);
  flashDisplay();
});

// --- Keyboard shortcuts (desktop convenience) ---
window.addEventListener("keydown", (e) => {
  if (e.target instanceof HTMLInputElement) return;
  if (e.code === "Space") {
    e.preventDefault();
    btnToggle.click();
  } else if (e.key === "r" || e.key === "R") {
    btnReset.click();
  }
});

// Temporary dev hook until peer sync lands in T7/T8.
window.__timer = timer;
