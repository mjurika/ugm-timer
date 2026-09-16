import { createPeerSession, normalizeCode } from "./peer.js";
import {
  DEFAULT_SETTINGS,
  loadSettings,
  pickColor,
  saveSettings,
  validateThreshold,
} from "./settings.js";
import { createTimer, formatDuration } from "./timer.js";

// --- Topbar ---
const pairingStatus = document.getElementById("pairing-status");
const pairingCode = document.getElementById("pairing-code");
const btnCopyCode = document.getElementById("btn-copy-code");
const btnConnectAdmin = document.getElementById("btn-connect-admin");
const btnComposeMessage = document.getElementById("btn-compose-message");
const btnDismissMessage = document.getElementById("btn-dismiss-message");
const btnToggle = document.getElementById("btn-toggle");
const btnToggleIcon = document.getElementById("btn-toggle-icon");
const btnToggleLabel = document.getElementById("btn-toggle-label");
const btnReset = document.getElementById("btn-reset");
const btnDuration = document.getElementById("btn-duration");
const sectionAdjust = document.getElementById("section-adjust");
const btnFullscreen = document.getElementById("btn-fullscreen");
const btnSettings = document.getElementById("btn-settings");

// --- Message band + timer ---
const messageBand = document.getElementById("message-band");
const messageText = document.getElementById("message-text");
const timerDisplay = document.getElementById("timer-display");

// --- Duration dialog ---
const durationDialog = document.getElementById("duration-dialog");
const durationForm = document.getElementById("duration-form");
const durationMinutes = document.getElementById("duration-minutes");
const durationSeconds = document.getElementById("duration-seconds");
const durationCancel = document.getElementById("duration-cancel");
const durationPresets = document.getElementById("duration-presets");

// --- Settings dialog ---
const settingsDialog = document.getElementById("settings-dialog");
const settingsForm = document.getElementById("settings-form");
const thresholdRows = document.getElementById("threshold-rows");
const settingsResetDefaults = document.getElementById(
  "settings-reset-defaults",
);
const settingsClose = document.getElementById("settings-close");
const btnDisconnect = document.getElementById("btn-disconnect");
const pairingSettingsInfo = document.getElementById("pairing-settings-info");
const btnInstall = document.getElementById("btn-install");

// --- Connect dialog ---
const connectDialog = document.getElementById("connect-dialog");
const connectForm = document.getElementById("connect-form");
const connectCode = document.getElementById("connect-code");
const connectCancel = document.getElementById("connect-cancel");
const connectError = document.getElementById("connect-error");

// --- Message dialog ---
const messageDialog = document.getElementById("message-dialog");
const messageForm = document.getElementById("message-form");
const messageInput = document.getElementById("message-input");
const messageFontMinus = document.getElementById("message-font-minus");
const messageFontPlus = document.getElementById("message-font-plus");
const messageFontValue = document.getElementById("message-font-value");
const messageDismissBtn = document.getElementById("message-dismiss-btn");
const messageCloseBtn = document.getElementById("message-close");

let settings = loadSettings();

const timer = createTimer(settings.defaultDurationMs);

// =====================================================================
// Render loop
// =====================================================================

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
  btnToggleIcon.textContent = isRunning ? "⏸" : "▶";
  btnToggleLabel.textContent = isRunning
    ? "Pause"
    : state.status === "paused"
      ? "Resume"
      : "Start";
  btnToggle.classList.toggle("is-running", isRunning);
  btnDuration.disabled = isRunning; // duration is only editable while stopped

  requestAnimationFrame(render);
}
requestAnimationFrame(render);

// =====================================================================
// Timer controls (routed through the presenter when acting as admin)
// =====================================================================

function isAdmin() {
  return peerSession.getRole() === "admin";
}

btnToggle.addEventListener("click", () => {
  const state = timer.getState();
  if (isAdmin()) {
    sendCommand(state.status === "running" ? "pause" : "start");
    return;
  }
  if (state.status === "running") {
    timer.pause();
  } else {
    timer.start(); // handles both fresh start and resume-from-pause
  }
});

let resetArmed = false;
let resetArmTimeout = null;

btnReset.addEventListener("click", () => {
  const state = timer.getState();
  const doReset = () => {
    if (isAdmin()) {
      sendCommand("reset");
    } else {
      timer.reset();
    }
  };
  if (state.status !== "running") {
    doReset();
    return;
  }
  // Double-tap confirm while running, so a stray tap can't wipe a live timer.
  if (resetArmed) {
    clearTimeout(resetArmTimeout);
    resetArmed = false;
    btnReset.lastElementChild.textContent = "Reset";
    doReset();
    return;
  }
  resetArmed = true;
  btnReset.lastElementChild.textContent = "Sure?";
  resetArmTimeout = setTimeout(() => {
    resetArmed = false;
    btnReset.lastElementChild.textContent = "Reset";
  }, 2000);
});

function flashDisplay() {
  timerDisplay.classList.remove("flash");
  void timerDisplay.offsetWidth; // force reflow so it retriggers on rapid taps
  timerDisplay.classList.add("flash");
}

sectionAdjust.addEventListener("click", (e) => {
  const btn = e.target.closest(".adjust-btn");
  if (!btn) return;
  const deltaMs = Number(btn.dataset.delta) * 1000;
  if (isAdmin()) {
    sendCommand("adjust", { deltaMs });
  } else {
    timer.adjust(deltaMs);
  }
  flashDisplay();
});

// =====================================================================
// Duration dialog (tap the timer while it isn't running)
// =====================================================================

function msToFields(ms) {
  const totalSeconds = Math.round(ms / 1000);
  return {
    minutes: Math.floor(totalSeconds / 60),
    seconds: totalSeconds % 60,
  };
}

function openDurationDialog() {
  const state = timer.getState();
  if (state.status === "running") return; // don't edit a live countdown
  const { minutes, seconds } = msToFields(state.durationMs);
  durationMinutes.value = String(minutes);
  durationSeconds.value = String(seconds);
  durationDialog.showModal();
}

btnDuration.addEventListener("click", openDurationDialog);

durationCancel.addEventListener("click", () => durationDialog.close());

durationPresets.addEventListener("click", (e) => {
  const btn = e.target.closest(".preset-btn");
  if (!btn) return;
  durationMinutes.value = btn.dataset.minutes;
  durationSeconds.value = "0";
});

durationForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const minutes = Math.max(
    0,
    Math.min(180, Number(durationMinutes.value) || 0),
  );
  const seconds = Math.max(0, Math.min(59, Number(durationSeconds.value) || 0));
  const durationMs = (minutes * 60 + seconds) * 1000;
  if (isAdmin()) {
    sendCommand("setDuration", { durationMs });
  } else {
    timer.setDuration(durationMs);
  }
  durationDialog.close();
});

// =====================================================================
// Settings dialog
// =====================================================================

function renderThresholdRows() {
  thresholdRows
    .querySelectorAll(".threshold-row, #th-add")
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

btnSettings.addEventListener("click", () => {
  renderThresholdRows();
  updateRoleUi();
  settingsDialog.showModal();
});

settingsClose.addEventListener("click", () => settingsDialog.close());

thresholdRows.addEventListener("click", (e) => {
  const removeBtn = e.target.closest(".th-remove");
  if (!removeBtn) return;
  const index = Number(removeBtn.closest(".threshold-row").dataset.index);
  settings.thresholds.splice(index, 1);
  renderThresholdRows();
});

settingsResetDefaults.addEventListener("click", () => {
  settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  renderThresholdRows();
});

function bumpSettingsVersion() {
  settings.settingsVersion = (settings.settingsVersion || 0) + 1;
}

settingsForm.addEventListener("submit", (e) => {
  e.preventDefault();

  const nextThresholds = [];
  const errors = [];

  thresholdRows.querySelectorAll(".threshold-row").forEach((row) => {
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

  settings = { ...settings, thresholds: nextThresholds };
  bumpSettingsVersion();
  saveSettings(settings);
  broadcastSettings();
  settingsDialog.close();
});

btnDisconnect.addEventListener("click", () => {
  clearMessage();
  // Tell the other side to reset too. Small delay so the "bye" is flushed
  // before the connection is torn down.
  peerSession.broadcast({ type: "bye" });
  settingsDialog.close();
  setTimeout(() => startPresenterMode(), 200);
});

// =====================================================================
// Keyboard shortcuts, fullscreen, wake lock, navigation guard
// =====================================================================

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

btnFullscreen.addEventListener("click", () => {
  if (document.fullscreenElement) {
    document.exitFullscreen();
  } else {
    document.documentElement.requestFullscreen().catch((err) => {
      console.warn("Fullscreen request failed:", err);
    });
  }
});

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
  if (document.visibilityState === "visible") requestWakeLock();
});
requestWakeLock();

window.addEventListener("beforeunload", (e) => {
  if (timer.getState().status === "running") {
    e.preventDefault();
    e.returnValue = "";
  }
});

// =====================================================================
// Message band
// =====================================================================

function updateMessageUi() {
  btnDismissMessage.hidden = !messageBand.classList.contains("has-message");
}

function showMessage(text, fontSize) {
  messageText.textContent = text;
  messageText.style.fontSize = `${fontSize || settings.messageFontSize}vh`;
  messageBand.classList.add("has-message");
  messageBand.classList.remove("pulse");
  void messageBand.offsetWidth;
  messageBand.classList.add("pulse");
  updateMessageUi();
}

function clearMessage() {
  messageText.textContent = "";
  messageBand.classList.remove("has-message", "pulse");
  updateMessageUi();
}

function sendMessage(text, fontSize) {
  showMessage(text, fontSize);
  peerSession.broadcast({ type: "msg", text, fontSize });
}

function dismissMessage() {
  clearMessage();
  peerSession.broadcast({ type: "msg-dismiss" });
}

btnDismissMessage.addEventListener("click", dismissMessage);

// =====================================================================
// P2P: pairing, state sync, settings sync
// =====================================================================

let applyingRemote = false; // guards against re-broadcasting state we just received
let lastAppliedStateVersion = -1;

function handlePeerData(data) {
  if (!data || typeof data !== "object") return;

  switch (data.type) {
    case "state": {
      if (!isAdmin()) return;
      if (data.version <= lastAppliedStateVersion) return;
      lastAppliedStateVersion = data.version;
      applyingRemote = true;
      timer.applyRemoteState(data);
      applyingRemote = false;
      break;
    }
    case "cmd": {
      if (isAdmin()) return; // only the presenter applies commands
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
      if (settingsDialog.open) renderThresholdRows();
      if (!isAdmin()) peerSession.broadcast(data); // relay to other admins
      break;
    }
    case "msg": {
      showMessage(data.text, data.fontSize);
      if (!isAdmin()) peerSession.broadcast(data);
      break;
    }
    case "msg-dismiss": {
      clearMessage();
      if (!isAdmin()) peerSession.broadcast(data);
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

function stateEnvelope() {
  const state = timer.getState();
  return {
    type: "state",
    version: state.version,
    status: state.status,
    remainingMs: state.remainingMs,
    durationMs: state.durationMs,
    sentAt: Date.now(),
  };
}

function settingsEnvelope() {
  return {
    type: "settings",
    settingsVersion: settings.settingsVersion,
    settings,
  };
}

function broadcastState() {
  if (isAdmin()) return; // presenter is the source of truth
  peerSession.broadcast(stateEnvelope());
}

function broadcastSettings() {
  peerSession.broadcast(settingsEnvelope());
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
  onPeerConnected: (conn) => {
    if (isAdmin()) return;
    conn.send(stateEnvelope());
    conn.send(settingsEnvelope());
  },
  onConnectedAsAdmin: (conn) => {
    connectError.textContent = "";
    if (connectDialog.open) connectDialog.close();
    // Share our locally-persisted settings, in case we edited them while
    // offline; the version check on both ends decides who wins.
    conn.send(settingsEnvelope());
  },
});

// Topbar visibility rules:
// - presenter, unlinked: show code + copy + "Connect as admin"
// - presenter, linked:   hide code/connect (pairing already established)
// - admin:               hide code/connect
// Every other control is available to both roles: commands are routed to the
// presenter when we're an admin, so it doesn't matter who does what.
function updateRoleUi() {
  const admin = peerSession.getRole() === "admin";
  const linked = peerSession.getStatus() === "linked";
  const showCode = !admin && !linked;

  pairingCode.hidden = !showCode;
  btnCopyCode.hidden = !showCode;
  btnConnectAdmin.hidden = admin || linked;

  if (pairingSettingsInfo) {
    pairingSettingsInfo.textContent = admin
      ? `Connected as admin to ${peerSession.getCode() || "presenter"}.`
      : `You are the presenter. Your code is ${peerSession.getCode() || "…"}.`;
  }
}

function startPresenterMode() {
  const code = peerSession.startAsPresenter();
  pairingCode.textContent = code;
  updateRoleUi();
  return code;
}

startPresenterMode();

timer.subscribe(() => {
  if (applyingRemote) return;
  broadcastState();
});
setInterval(broadcastState, 1000); // cheap resync heartbeat

btnCopyCode.addEventListener("click", async () => {
  const text = pairingCode.textContent;
  try {
    await navigator.clipboard.writeText(text);
  } catch (err) {
    console.warn("Clipboard write failed, falling back.", err);
    const helper = document.createElement("textarea");
    helper.value = text;
    helper.style.position = "fixed";
    helper.style.opacity = "0";
    document.body.appendChild(helper);
    helper.select();
    document.execCommand("copy");
    helper.remove();
  }
  btnCopyCode.classList.add("copied");
  btnCopyCode.textContent = "✓";
  setTimeout(() => {
    btnCopyCode.classList.remove("copied");
    btnCopyCode.textContent = "⧉";
  }, 1500);
});

btnConnectAdmin.addEventListener("click", () => {
  connectError.textContent = "";
  connectCode.value = "";
  connectDialog.showModal();
});

connectCancel.addEventListener("click", () => {
  connectDialog.close();
  // If we flipped into admin mode but never linked, go back to standalone
  // presenter rather than retrying forever in the background.
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
  // Dialog stays open until the link succeeds (see onConnectedAsAdmin), so the
  // user can see errors and correct the code.
});

// =====================================================================
// Message composer (admin only)
// =====================================================================

const MESSAGE_MAX_CHARS = 120;

btnComposeMessage.addEventListener("click", () => {
  messageInput.textContent = "";
  applyComposeFontSize();
  messageDialog.showModal();
  messageInput.focus();
});

messageCloseBtn.addEventListener("click", () => messageDialog.close());

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

messageInput.addEventListener("paste", (e) => {
  e.preventDefault();
  const text = (e.clipboardData || window.clipboardData).getData("text");
  document.execCommand("insertText", false, text);
});

messageInput.addEventListener("input", () => {
  const text = messageInput.textContent;
  if (text.length > MESSAGE_MAX_CHARS) {
    messageInput.textContent = text.slice(0, MESSAGE_MAX_CHARS);
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
// PWA: service worker + install prompt
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

// Dev hooks for debugging in the console.
window.__timer = timer;
window.__settings = () => settings;
window.__peer = peerSession;
