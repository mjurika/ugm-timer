// P2P foundation on top of PeerJS (loaded globally as window.Peer via CDN script tag).
// Handles: presenter code generation/persistence, admin connection, reconnect
// with backoff, and a simple pub/sub for incoming data messages.
//
// This module knows nothing about timer/settings semantics — it just moves
// envelopes back and forth. See main.js for how envelopes are interpreted.

const CODE_STORAGE_KEY = "ugm-timer:presenter-code:v1";
const CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"; // no 0/O/1/I
const CODE_PREFIX = "ugm-";

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
    if (existing) return existing;
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
} = {}) {
  let peer = null;
  let role = "presenter"; // 'presenter' | 'admin'
  let connections = []; // presenter: list of admin DataConnections. admin: single-element list.
  let status = "offline"; // 'offline' | 'connecting' | 'linked'
  let reconnectAttempts = 0;
  let reconnectTimer = null;

  function setStatus(next) {
    status = next;
    onStatusChange?.(status, connections.length);
  }

  function notifyPeerCount() {
    onPeerCount?.(connections.length);
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
      if (connections.length === 0 && role === "presenter") {
        setStatus("linked"); // presenter stays "up" waiting for admins even with none connected
      }
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

  function startAsPresenter() {
    role = "presenter";
    const code = loadOrCreatePresenterCode();
    setStatus("connecting");

    function attempt(idSuffix = "") {
      const id = code + idSuffix;
      peer = new Peer(id);

      peer.on("open", () => {
        reconnectAttempts = 0;
        setStatus(connections.length ? "linked" : "linked");
      });

      peer.on("connection", (conn) => wireConnection(conn));

      peer.on("disconnected", () => {
        setStatus("connecting");
        peer.reconnect();
      });

      peer.on("error", (err) => {
        console.warn("Presenter peer error:", err);
        if (err.type === "unavailable-id") {
          // Extremely rare id collision; retry with a random suffix.
          attempt("-" + Math.floor(Math.random() * 1000));
        } else {
          setStatus("connecting");
          scheduleReconnect(() => attempt(idSuffix));
        }
      });
    }

    attempt();
    return code;
  }

  function connectAsAdmin(presenterCode) {
    peer?.destroy();
    role = "admin";
    setStatus("connecting");
    peer = new Peer();

    peer.on("open", () => {
      const conn = peer.connect(presenterCode.trim());
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
        setStatus("connecting");
        notifyPeerCount();
        scheduleReconnect(() => connectAsAdmin(presenterCode));
      });
      conn.on("error", (err) => {
        console.warn("Admin connection error:", err);
      });
    });

    peer.on("error", (err) => {
      console.warn("Admin peer error:", err);
      setStatus("connecting");
      scheduleReconnect(() => connectAsAdmin(presenterCode));
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

  function destroy() {
    clearTimeout(reconnectTimer);
    peer?.destroy();
  }

  return {
    startAsPresenter,
    connectAsAdmin,
    broadcast,
    getRole,
    getStatus,
    getPeerCount,
    destroy,
  };
}
