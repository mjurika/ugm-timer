import {
  DEFAULT_SETTINGS,
  loadSettings,
  pickColor,
  saveSettings,
  validateThreshold,
} from "./settings.js";
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
const btnSettings = document.getElementById("btn-settings");
const settingsDialog = document.getElementById("settings-dialog");
const settingsForm = document.getElementById("settings-form");
const settingsBaseColor = document.getElementById("setting-base-color");
const thresholdRows = document.getElementById("threshold-rows");
const settingsResetDefaults = document.getElementById(
  "settings-reset-defaults",
);
const settingsClose = document.getElementById("settings-close");

let settings = loadSettings();

const timer = createTimer(settings.defaultDurationMs);

function applyBackground(remainingMs) {
  const { bg, fg } = pickColor(settings, remainingMs);
  document.documentElement.style.setProperty("--bg", bg);
  document.documentElement.style.setProperty("--fg", fg);
}

function render() {
  const state = timer.getState();
  const remaining = timer.getRemaining();
  timerDisplay.textContent = formatDuration(remaining);
  applyBackground(remaining);

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

// --- Settings dialog ---
function renderThresholdRows() {
  thresholdRows
    .querySelectorAll(".threshold-row, .threshold-error, #th-add")
    .forEach((el) => el.remove());

  settings.thresholds.forEach((t, index) => {
    const row = document.createElement("div");
    row.className = "threshold-row";
    row.innerHTML =
      '<label><input type="checkbox" class="th-enabled" ' +
      (t.enabled ? "checked" : "") +
      " /></label>" +
      '<label>Min <input type="number" class="th-minutes" min="0" max="180" value="' +
      t.minutes +
      '" /></label>' +
      '<input type="color" class="th-color" value="' +
      t.color +
      '" />' +
      '<button type="button" class="th-remove">Remove</button>';
    row.dataset.index = String(index);
    thresholdRows.appendChild(row);
  });

  if (settings.thresholds.length < 3) {
    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.id = "th-add";
    addBtn.textContent = "Add threshold";
    addBtn.addEventListener("click", () => {
      if (settings.thresholds.length >= 3) return;
      settings.thresholds.push({
        minutes: 10,
        color: "#f5c518",
        enabled: true,
      });
      renderThresholdRows();
    });
    thresholdRows.appendChild(addBtn);
  }
}

function openSettings() {
  settingsBaseColor.value = settings.baseColor;
  renderThresholdRows();
  settingsDialog.showModal();
}

btnSettings.addEventListener("click", openSettings);
settingsClose.addEventListener("click", () => settingsDialog.close());

thresholdRows.addEventListener("click", (e) => {
  const removeBtn = e.target.closest(".th-remove");
  if (!removeBtn) return;
  const row = removeBtn.closest(".threshold-row");
  const index = Number(row.dataset.index);
  settings.thresholds.splice(index, 1);
  renderThresholdRows();
});

settingsResetDefaults.addEventListener("click", () => {
  settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  settingsBaseColor.value = settings.baseColor;
  renderThresholdRows();
});

settingsForm.addEventListener("submit", (e) => {
  e.preventDefault();

  const rows = Array.from(thresholdRows.querySelectorAll(".threshold-row"));
  const nextThresholds = [];
  const errors = [];

  rows.forEach((row) => {
    const minutes = Number(row.querySelector(".th-minutes").value);
    const color = row.querySelector(".th-color").value;
    const enabled = row.querySelector(".th-enabled").checked;
    const rowErrors = validateThreshold(minutes, color, nextThresholds);
    if (rowErrors.length) {
      errors.push(...rowErrors);
    } else {
      nextThresholds.push({ minutes, color, enabled });
    }
  });

  if (errors.length) {
    alert(errors.join("\n"));
    return;
  }

  settings = {
    ...settings,
    thresholds: nextThresholds,
    baseColor: settingsBaseColor.value,
    settingsVersion: (settings.settingsVersion || 0) + 1,
  };
  saveSettings(settings);
  settingsDialog.close();
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
window.__settings = () => settings;
