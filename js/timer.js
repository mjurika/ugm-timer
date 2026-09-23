// Pure timer engine. No DOM access — subscribe to get updates.
//
// State shape:
// { status: 'idle' | 'running' | 'paused',
//   durationMs, remainingMs, endsAt, version }
//
// Once running hits zero it keeps counting into negative remainingMs
// instead of stopping — callers decide how to display overtime.

const MINUTE = 60 * 1000;

function nowMs() {
  return Date.now();
}

export function createTimer(initialDurationMs = 0) {
  let state = {
    status: "idle",
    durationMs: initialDurationMs,
    remainingMs: initialDurationMs,
    endsAt: null,
    version: 0,
  };

  const listeners = new Set();

  function emit() {
    for (const cb of listeners) cb(state);
  }

  function bump(patch) {
    state = { ...state, ...patch, version: state.version + 1 };
    emit();
  }

  function computeRemaining() {
    if (state.status === "running") {
      return state.endsAt - nowMs();
    }
    return state.remainingMs;
  }

  function setDuration(ms) {
    const durationMs = Math.max(0, ms);
    if (state.status === "running") return; // only settable while stopped/paused
    bump({ status: "idle", durationMs, remainingMs: durationMs, endsAt: null });
  }

  function start() {
    if (state.status === "running") return;
    const remainingMs =
      state.status === "paused" ? state.remainingMs : state.durationMs;
    if (remainingMs <= 0) return;
    bump({
      status: "running",
      remainingMs,
      endsAt: nowMs() + remainingMs,
    });
  }

  function pause() {
    if (state.status !== "running") return;
    bump({ status: "paused", remainingMs: computeRemaining(), endsAt: null });
  }

  function resume() {
    start();
  }

  function reset() {
    bump({
      status: "idle",
      remainingMs: state.durationMs,
      endsAt: null,
    });
  }

  function adjust(deltaMs) {
    if (state.status === "running") {
      const remaining = computeRemaining() + deltaMs;
      bump({ remainingMs: remaining, endsAt: nowMs() + remaining });
    } else if (state.status === "paused") {
      const remaining = Math.max(0, state.remainingMs + deltaMs);
      bump({ remainingMs: remaining });
    } else if (state.status === "idle") {
      const remaining = Math.max(0, state.remainingMs + deltaMs);
      bump({ remainingMs: remaining, durationMs: remaining });
    }
  }

  function getRemaining() {
    return computeRemaining();
  }

  function getState() {
    return { ...state, remainingMs: computeRemaining() };
  }

  function applyRemoteState({ status, remainingMs, durationMs }) {
    const patch = { status, remainingMs };
    if (typeof durationMs === "number") patch.durationMs = durationMs;
    if (status === "running") {
      patch.endsAt = nowMs() + remainingMs;
    } else {
      patch.endsAt = null;
    }
    state = { ...state, ...patch, version: state.version + 1 };
    emit();
  }

  function subscribe(cb) {
    listeners.add(cb);
    cb(state);
    return () => listeners.delete(cb);
  }

  return {
    setDuration,
    start,
    pause,
    resume,
    reset,
    adjust,
    getRemaining,
    getState,
    subscribe,
    applyRemoteState,
  };
}

export function formatDuration(ms) {
  const sign = ms < 0 ? "-" : "";
  const totalSeconds = Math.ceil(Math.abs(ms) / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const mm = String(minutes).padStart(2, "0");
  const ss = String(seconds).padStart(2, "0");

  if (hours > 0) {
    return `${sign}${hours}:${mm}:${ss}`;
  }
  return `${sign}${mm}:${ss}`;
}

export { MINUTE };
