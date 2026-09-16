// P2P foundation on top of PeerJS (loaded globally as window.Peer via CDN script tag).
// Handles: presenter code generation/persistence, admin connection, reconnect
// with backoff, and a simple pub/sub for incoming data messages.
//
// This module knows nothing about timer/settings semantics — it just moves
// envelopes back and forth. See main.js for how envelopes are interpreted.

const CODE_STORAGE_KEY = "ugm-timer:presenter-code:v1";
// Lowercase only: peer ids are case-sensitive, so we normalise everywhere to
// avoid "peer-unavailable" when someone types/pastes the code in a different case.
const CODE_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz"; // no 0/o/1/l/i
const CODE_PREFIX = "ugm-";

export function normalizeCode(code) {
  return String(code || "")
    .trim()
    .toLowerCase();
}

function randomCode(length = 6) {
  let out = "";
  for (let i = 0; i < length; i++) {
    out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return CODE_PREFIX + out;
}

function loadOrCreatePresenterCode() {
  try {
    const existing = localStorage.getItem(CODE_STORAGE_KEY);
    if (existing) return normalizeCode(existing);
  } catch (err) {
    console.warn("Could not read stored presenter code.", err);
  }
  const code = randomCode();
  try {
    localStorage.setItem(CODE_STORAGE_KEY, code);
  } catch (err) {
    console.warn("Could not persist presenter code.", err);
  }
  return code;
}

export function createPeerSession({
  onStatusChange,
  onData,
  onPeerCount,
  onPeerConnected,
  onConnectedAsAdmin,
  onError,
} = {}) {
  let peer = null;
  let role = "presenter"; // 'presenter' | 'admin'
  let connections = []; // presenter: list of admin DataConnections. admin: single-element list.
  let status = "offline"; // 'offline' | 'connecting' | 'ready' | 'linked'
  let reconnectAttempts = 0;
  let reconnectTimer = null;
  let presenterCode = null; // our own code when acting as presenter
  let targetCode = null; // the presenter we're attached to when acting as admin

  function setStatus(next) {
    status = next;
    onStatusChange?.(status, connections.length, role);
  }

  function notifyPeerCount() {
    onPeerCount?.(connections.length);
  }

  function idleStatus() {
    // Presenter with no admins attached is still fully operational.
    return role === "presenter" ? "ready" : "connecting";
  }

  function wireConnection(conn) {
    conn.on("open", () => {
      connections.push(conn);
      setStatus("linked");
      notifyPeerCount();
      onPeerConnected?.(conn);
    });
    conn.on("data", (data) => onData?.(data, conn));
    conn.on("close", () => {
      connections = connections.filter((c) => c !== conn);
      notifyPeerCount();
      if (connections.length === 0) setStatus(idleStatus());
    });
    conn.on("error", (err) => {
      console.warn("Peer connection error:", err);
    });
  }

  function scheduleReconnect(startFn) {
    reconnectAttempts += 1;
    const delay = Math.min(1000 * 2 ** reconnectAttempts, 15000);
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(startFn, delay);
  }

  function teardownPeer() {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
    for (const conn of connections) {
      try {
        conn.close();
      } catch (err) {
        console.warn("Error closing connection:", err);
      }
    }
    connections = [];
    notifyPeerCount();
    try {
      peer?.destroy();
    } catch (err) {
      console.warn("Error destroying peer:", err);
    }
    peer = null;
  }

  function startAsPresenter() {
    teardownPeer();
    role = "presenter";
    targetCode = null;
    presenterCode = loadOrCreatePresenterCode();
    setStatus("connecting");

    function attempt(idSuffix = "") {
      const id = presenterCode + idSuffix;
      peer = new Peer(id);

      peer.on("open", () => {
        reconnectAttempts = 0;
        setStatus(connections.length ? "linked" : "ready");
      });

      peer.on("connection", (conn) => wireConnection(conn));

      peer.on("disconnected", () => {
        setStatus("connecting");
        peer.reconnect();
      });

      peer.on("error", (err) => {
        console.warn("Presenter peer error:", err);
        if (err.type === "unavailable-id") {
          // Id already taken (e.g. another tab on this machine); retry with a suffix.
          attempt("-" + Math.floor(Math.random() * 1000));
        } else {
          onError?.(err, "presenter");
          setStatus("connecting");
          scheduleReconnect(() => attempt(idSuffix));
        }
      });
    }

    attempt();
    return presenterCode;
  }

  function connectAsAdmin(code) {
    const normalized = normalizeCode(code);
    teardownPeer();
    role = "admin";
    targetCode = normalized;
    setStatus("connecting");
    peer = new Peer();

    peer.on("open", () => {
      const conn = peer.connect(normalized, { reliable: true });

      conn.on("open", () => {
        reconnectAttempts = 0;
        connections = [conn];
        setStatus("linked");
        notifyPeerCount();
        onConnectedAsAdmin?.(conn);
      });
      conn.on("data", (data) => onData?.(data, conn));
      conn.on("close", () => {
        connections = [];
        notifyPeerCount();
        if (role !== "admin") return; // we deliberately left admin mode
        setStatus("connecting");
        scheduleReconnect(() => connectAsAdmin(normalized));
      });
      conn.on("error", (err) => {
        console.warn("Admin connection error:", err);
        onError?.(err, "admin");
      });
    });

    peer.on("error", (err) => {
      console.warn("Admin peer error:", err);
      onError?.(err, "admin");
      if (role !== "admin") return;
      setStatus("connecting");
      // "peer-unavailable" means the code is wrong or the presenter is offline.
      // Keep retrying (with backoff) so it links up as soon as it appears.
      scheduleReconnect(() => connectAsAdmin(normalized));
    });
  }

  function broadcast(payload) {
    for (const conn of connections) {
      if (conn.open) conn.send(payload);
    }
  }

  function getRole() {
    return role;
  }

  function getStatus() {
    return status;
  }

  function getPeerCount() {
    return connections.length;
  }

  function getCode() {
    return role === "presenter" ? presenterCode : targetCode;
  }

  function destroy() {
    teardownPeer();
    setStatus("offline");
  }

  return {
    startAsPresenter,
    connectAsAdmin,
    broadcast,
    getRole,
    getStatus,
    getPeerCount,
    getCode,
    destroy,
  };
}
