import { createPeerSession, normalizeCode } from "./peer.js";
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
const btnFullscreen = document.getElementById("btn-fullscreen");
const pairingStatus = document.getElementById("pairing-status");
const pairingCode = document.getElementById("pairing-code");
const btnCopyCode = document.getElementById("btn-copy-code");
const btnConnectAdmin = document.getElementById("btn-connect-admin");
const connectDialog = document.getElementById("connect-dialog");
const connectForm = document.getElementById("connect-form");
const connectCode = document.getElementById("connect-code");
const connectCancel = document.getElementById("connect-cancel");
const connectError = document.getElementById("connect-error");
const messageBand = document.getElementById("message-band");
const messageText = document.getElementById("message-text");
const btnDismissMessage = document.getElementById("btn-dismiss-message");
const btnComposeMessage = document.getElementById("btn-compose-message");
const messageDialog = document.getElementById("message-dialog");
const messageForm = document.getElementById("message-form");
const messageInput = document.getElementById("message-input");
const messageFontMinus = document.getElementById("message-font-minus");
const messageFontPlus = document.getElementById("message-font-plus");
const messageFontValue = document.getElementById("message-font-value");
const messageDismissBtn = document.getElementById("message-dismiss-btn");
const messageCloseBtn = document.getElementById("message-close");
const btnInstall = document.getElementById("btn-install");
const btnDisconnect = document.getElementById("btn-disconnect");
const pairingSettingsInfo = document.getElementById("pairing-settings-info");

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

  requestAnimationFrame(render);
}
requestAnimationFrame(render);

// --- Start / Pause / Resume toggle ---
btnToggle.addEventListener("click", () => {
  const state = timer.getState();
  if (peerSession.getRole() === "admin") {
    sendCommand(state.status === "running" ? "pause" : "start");
    return;
  }
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
  const doReset = () => {
    if (peerSession.getRole() === "admin") {
      sendCommand("reset");
    } else {
      timer.reset();
    }
  };
  if (state.status !== "running") {
    doReset();
    return;
  }
  if (resetArmed) {
    clearTimeout(resetArmTimeout);
    resetArmed = false;
    btnReset.textContent = "Reset";
    doReset();
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
  const durationMs = (minutes * 60 + seconds) * 1000;
  if (peerSession.getRole() === "admin") {
    sendCommand("setDuration", { durationMs });
  } else {
    timer.setDuration(durationMs);
  }
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
  const deltaMs = deltaSeconds * 1000;
  if (peerSession.getRole() === "admin") {
    sendCommand("adjust", { deltaMs });
  } else {
    timer.adjust(deltaMs);
  }
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

function bumpSettingsVersion() {
  settings.settingsVersion = (settings.settingsVersion || 0) + 1;
}

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
  };
  bumpSettingsVersion();
  saveSettings(settings);
  broadcastSettings();
  settingsDialog.close();
});

// --- Keyboard shortcuts (desktop convenience) ---
function isTextEntryTarget(target) {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target.isContentEditable
  );
}

window.addEventListener("keydown", (e) => {
  // Never steal keys from text entry or while a modal dialog is open.
  if (isTextEntryTarget(e.target)) return;
  if (document.querySelector("dialog[open]")) return;

  if (e.code === "Space") {
    e.preventDefault();
    btnToggle.click();
  } else if (e.key === "r" || e.key === "R") {
    btnReset.click();
  }
});

// --- Fullscreen ---
btnFullscreen.addEventListener("click", () => {
  if (document.fullscreenElement) {
    document.exitFullscreen();
  } else {
    document.documentElement.requestFullscreen().catch((err) => {
      console.warn("Fullscreen request failed:", err);
    });
  }
});

// --- Wake lock (keep screen on) ---
let wakeLock = null;

async function requestWakeLock() {
  if (!settings.keepAwake || !("wakeLock" in navigator)) return;
  try {
    wakeLock = await navigator.wakeLock.request("screen");
  } catch (err) {
    console.warn("Wake lock request failed:", err);
  }
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    requestWakeLock();
  }
});
requestWakeLock();

// --- Guard against accidental navigation while running ---
window.addEventListener("beforeunload", (e) => {
  if (timer.getState().status === "running") {
    e.preventDefault();
    e.returnValue = "";
  }
});

// =====================================================================
// P2P pairing (T7) + state/settings sync (T8, T8b)
// =====================================================================

let applyingRemote = false; // guards against re-broadcasting state we just received

function handlePeerData(data) {
  if (!data || typeof data !== "object") return;

  switch (data.type) {
    case "state": {
      if (peerSession.getRole() !== "admin") return;
      if (data.version <= lastAppliedStateVersion) return;
      lastAppliedStateVersion = data.version;
      applyingRemote = true;
      timer.applyRemoteState(data);
      applyingRemote = false;
      break;
    }
    case "cmd": {
      if (peerSession.getRole() !== "presenter") return;
      applyCommand(data.action, data.payload);
      break;
    }
    case "settings": {
      if ((data.settingsVersion || 0) <= (settings.settingsVersion || 0))
        return;
      settings = {
        ...settings,
        ...data.settings,
        settingsVersion: data.settingsVersion,
      };
      saveSettings(settings);
      if (peerSession.getRole() === "presenter") {
        peerSession.broadcast({
          type: "settings",
          settingsVersion: settings.settingsVersion,
          settings,
        });
      }
      break;
    }
    case "msg": {
      showMessage(data.text, data.fontSize);
      if (peerSession.getRole() === "presenter") {
        peerSession.broadcast(data);
      }
      break;
    }
    case "msg-dismiss": {
      clearMessage();
      if (peerSession.getRole() === "presenter") {
        peerSession.broadcast(data);
      }
      break;
    }
    case "bye": {
      // The other side ended the pairing: drop back to standalone presenter.
      clearMessage();
      startPresenterMode();
      break;
    }
    default:
      break;
  }
}

function applyCommand(action, payload) {
  switch (action) {
    case "start":
      timer.start();
      break;
    case "pause":
      timer.pause();
      break;
    case "resume":
      timer.resume();
      break;
    case "reset":
      timer.reset();
      break;
    case "adjust":
      timer.adjust(payload.deltaMs);
      break;
    case "setDuration":
      timer.setDuration(payload.durationMs);
      break;
    default:
      break;
  }
}

let lastAppliedStateVersion = -1;

function broadcastState() {
  if (peerSession.getRole() !== "presenter") return;
  const state = timer.getState();
  peerSession.broadcast({
    type: "state",
    version: state.version,
    status: state.status,
    remainingMs: state.remainingMs,
    durationMs: state.durationMs,
    sentAt: Date.now(),
  });
}

function broadcastSettings() {
  peerSession.broadcast({
    type: "settings",
    settingsVersion: settings.settingsVersion,
    settings,
  });
}

function sendCommand(action, payload) {
  peerSession.broadcast({ type: "cmd", action, payload, sentAt: Date.now() });
}

const peerSession = createPeerSession({
  onStatusChange: (status, count, role) => {
    let label = status;
    if (status === "linked") {
      label = role === "admin" ? "linked • admin" : `linked • ${count} admin`;
    } else if (status === "ready") {
      label = "presenter • ready";
    }
    pairingStatus.textContent = label;
    pairingStatus.className = status;
    updateRoleUi();
  },
  onError: (err, asRole) => {
    if (err.type === "peer-unavailable") {
      connectError.textContent =
        "No presenter found with that code. Check it and try again — we'll keep retrying.";
    } else if (asRole === "admin") {
      connectError.textContent = `Connection problem: ${err.type || err.message}`;
    }
  },
  onData: handlePeerData,
  onPeerCount: () => {},
  onPeerConnected: (conn) => {
    if (peerSession.getRole() !== "presenter") return;
    const state = timer.getState();
    conn.send({
      type: "state",
      version: state.version,
      status: state.status,
      remainingMs: state.remainingMs,
      durationMs: state.durationMs,
      sentAt: Date.now(),
    });
    conn.send({
      type: "settings",
      settingsVersion: settings.settingsVersion,
      settings,
    });
  },
  onConnectedAsAdmin: (conn) => {
    connectError.textContent = "";
    if (connectDialog.open) connectDialog.close();
    // Share our locally-persisted settings too, in case we edited them while
    // offline; version check on both ends decides who wins.
    conn.send({
      type: "settings",
      settingsVersion: settings.settingsVersion,
      settings,
    });
  },
});

function startPresenterMode() {
  const code = peerSession.startAsPresenter();
  pairingCode.textContent = code;
  pairingCode.hidden = false;
  btnCopyCode.hidden = false;
  btnConnectAdmin.hidden = false;
  updateRoleUi();
  return code;
}

startPresenterMode();

btnCopyCode.addEventListener("click", async () => {
  const text = pairingCode.textContent;
  try {
    await navigator.clipboard.writeText(text);
  } catch (err) {
    console.warn("Clipboard write failed, falling back.", err);
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
  }
  btnCopyCode.classList.add("copied");
  btnCopyCode.textContent = "✅";
  setTimeout(() => {
    btnCopyCode.classList.remove("copied");
    btnCopyCode.textContent = "📋";
  }, 1500);
});

timer.subscribe(() => {
  if (applyingRemote) return;
  broadcastState();
});
setInterval(broadcastState, 1000); // cheap resync heartbeat

btnConnectAdmin.addEventListener("click", () => {
  connectError.textContent = "";
  connectCode.value = "";
  connectDialog.showModal();
});

connectCancel.addEventListener("click", () => {
  connectDialog.close();
  // If we already flipped into admin mode but never linked, go back to being
  // a standalone presenter rather than retrying forever in the background.
  if (
    peerSession.getRole() === "admin" &&
    peerSession.getStatus() !== "linked"
  ) {
    startPresenterMode();
  }
});

connectForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const raw = normalizeCode(connectCode.value);
  if (!raw) {
    connectError.textContent = "Enter a code.";
    return;
  }
  connectError.textContent = "Connecting…";
  peerSession.connectAsAdmin(raw);
  btnConnectAdmin.hidden = true;
  pairingCode.hidden = true;
  btnCopyCode.hidden = true;
  // Dialog stays open until the link succeeds (see onConnectedAsAdmin), so the
  // user can see errors and correct the code.
});

// Temporary dev hooks for debugging in the console.
window.__timer = timer;
window.__settings = () => settings;
window.__peer = peerSession;

// =====================================================================
// Message overlay (T9)
// =====================================================================

function showMessage(text, fontSize) {
  messageText.textContent = text;
  messageText.style.fontSize = `${fontSize || settings.messageFontSize}vh`;
  messageBand.classList.add("has-message");
  messageBand.classList.remove("pulse");
  void messageBand.offsetWidth;
  messageBand.classList.add("pulse");
  btnDismissMessage.hidden = peerSession.getRole() !== "admin";
}

function clearMessage() {
  messageText.textContent = "";
  messageBand.classList.remove("has-message", "pulse");
  btnDismissMessage.hidden = true;
}

function sendMessage(text, fontSize) {
  const payload = { type: "msg", text, fontSize };
  showMessage(text, fontSize);
  if (peerSession.getRole() === "presenter") {
    peerSession.broadcast(payload);
  } else {
    peerSession.broadcast(payload); // admin -> presenter, presenter re-broadcasts to others
  }
}

function dismissMessage() {
  const payload = { type: "msg-dismiss" };
  clearMessage();
  peerSession.broadcast(payload);
}

btnDismissMessage.addEventListener("click", dismissMessage);

// Role-dependent UI: only admins compose messages.
function updateRoleUi() {
  const isAdmin = peerSession.getRole() === "admin";
  btnComposeMessage.hidden = !isAdmin;
  if (pairingSettingsInfo) {
    pairingSettingsInfo.textContent = isAdmin
      ? `Connected as admin to ${peerSession.getCode() || "presenter"}.`
      : `You are the presenter. Your code is ${peerSession.getCode() || "…"}.`;
  }
}

updateRoleUi();

btnDisconnect.addEventListener("click", () => {
  clearMessage();
  // Tell the other side to reset too, then go back to standalone presenter.
  // Small delay so the "bye" is flushed before we tear the connection down.
  peerSession.broadcast({ type: "bye" });
  settingsDialog.close();
  setTimeout(() => startPresenterMode(), 200);
});

btnComposeMessage.addEventListener("click", () => {
  messageInput.textContent = "";
  applyComposeFontSize();
  messageDialog.showModal();
  messageInput.focus();
});

messageCloseBtn.addEventListener("click", () => messageDialog.close());

const MESSAGE_MAX_CHARS = 120;

// Keep the editable box plain text and bounded.
messageInput.addEventListener("paste", (e) => {
  e.preventDefault();
  const text = (e.clipboardData || window.clipboardData).getData("text");
  document.execCommand("insertText", false, text);
});

messageInput.addEventListener("input", () => {
  const text = messageInput.textContent;
  if (text.length > MESSAGE_MAX_CHARS) {
    messageInput.textContent = text.slice(0, MESSAGE_MAX_CHARS);
    // Put the caret back at the end after truncating.
    const range = document.createRange();
    range.selectNodeContents(messageInput);
    range.collapse(false);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  }
});

messageInput.addEventListener("keydown", (e) => {
  // Enter sends; Shift+Enter makes a line break.
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    messageForm.requestSubmit();
  }
});

// The compose box renders at the exact size used on the presenter screen, so
// the admin can see straight away whether the text is too long or too large.
function applyComposeFontSize() {
  messageInput.style.fontSize = `${settings.messageFontSize}vh`;
  messageFontValue.textContent = String(settings.messageFontSize);
}

messageFontMinus.addEventListener("click", () => {
  settings.messageFontSize = Math.max(2, settings.messageFontSize - 0.5);
  applyComposeFontSize();
});

messageFontPlus.addEventListener("click", () => {
  settings.messageFontSize = Math.min(10, settings.messageFontSize + 0.5);
  applyComposeFontSize();
});

messageForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = messageInput.textContent.trim();
  if (!text) return;
  sendMessage(text, settings.messageFontSize);
  bumpSettingsVersion();
  saveSettings(settings);
  broadcastSettings();
  messageDialog.close();
});

messageDismissBtn.addEventListener("click", () => {
  dismissMessage();
  messageDialog.close();
});

// =====================================================================
// PWA: service worker + install prompt (T10)
// =====================================================================

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch((err) => {
      console.warn("Service worker registration failed:", err);
    });
  });
}

let deferredInstallPrompt = null;

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  btnInstall.hidden = false;
});

btnInstall.addEventListener("click", async () => {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  btnInstall.hidden = true;
});

window.addEventListener("appinstalled", () => {
  btnInstall.hidden = true;
  deferredInstallPrompt = null;
});
