// client/src/lib/socket.js
// Industry-grade Socket.io client manager.
// Features: JWT auth handshake, session isolation, Page Visibility reconnect,
//           connection quality events, and SOS cooldown feedback.
import { io } from 'socket.io-client';

let socket = null;
let registeredUserId = null;
let _onVisibilityChange = null; // stored so we can remove on teardown

/**
 * Create (or reuse) a Socket.io connection for the given user.
 * If a socket already exists for a DIFFERENT user, it is torn down first.
 * @param {string} token   - JWT auth token
 * @param {string} userId  - The logged-in user's _id
 */
export const createSocket = (token, userId) => {
  // Reuse if same user already connected
  if (socket && socket.connected && registeredUserId === userId) {
    return socket;
  }

  // Tear down stale socket (e.g. previous user's session)
  _teardown();

  const SERVER_URL = import.meta.env.VITE_SERVER_URL || window.location.origin;

  socket = io(SERVER_URL, {
    // Send both token AND userId in handshake so server can auto-register
    auth: { token, userId },
    transports: ['websocket', 'polling'], // polling fallback for restrictive networks
    reconnectionAttempts: 12,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 10000,
    timeout: 20000,
    // Heartbeat: detect dead connections faster
    pingInterval: 20000,
    pingTimeout: 10000,
  });

  registeredUserId = userId;

  // ── Re-authenticate on every (re)connect so onlineUsers map stays current ───
  socket.on('connect', () => {
    console.log(`🔌 Socket connected [${socket.id}] for user ${userId}`);
    socket.emit('auth', userId);
    // Dispatch global event so UI components can react to reconnection
    window.dispatchEvent(new CustomEvent('bridgeable:socket-connected'));
  });

  socket.on('reconnect', (attempt) => {
    console.log(`🔄 Socket reconnected after ${attempt} attempt(s)`);
    socket.emit('auth', userId);
    window.dispatchEvent(new CustomEvent('bridgeable:socket-reconnected', { detail: { attempt } }));
  });

  socket.on('reconnect_attempt', (attempt) => {
    window.dispatchEvent(new CustomEvent('bridgeable:socket-reconnecting', { detail: { attempt } }));
  });

  socket.on('reconnect_failed', () => {
    console.error('❌ Socket failed to reconnect after all attempts');
    window.dispatchEvent(new CustomEvent('bridgeable:socket-failed'));
  });

  socket.on('connect_error', (err) => {
    console.warn('⚠️ Socket connection error:', err.message);
  });

  socket.on('disconnect', (reason) => {
    console.log('❌ Socket disconnected:', reason);
    // Server-initiated disconnect — don't auto-reconnect, session may be invalid
    if (reason === 'io server disconnect') {
      console.warn('Server closed the connection. Attempting manual reconnect...');
      socket.connect();
    }
    window.dispatchEvent(new CustomEvent('bridgeable:socket-disconnected', { detail: { reason } }));
  });

  // ── SOS cooldown feedback ────────────────────────────────────────────────────
  socket.on('sos:cooldown', ({ retryAfterMs }) => {
    const secs = Math.ceil(retryAfterMs / 1000);
    window.dispatchEvent(new CustomEvent('bridgeable:sos-cooldown', { detail: { retryAfterMs, secs } }));
    console.warn(`⏳ SOS cooldown active — retry in ${secs}s`);
  });

  // ── Circle reminder ──────────────────────────────────────────────────────────
  socket.on('circle:reminder', (data) => {
    window.dispatchEvent(new CustomEvent('bridgeable:circle-reminder', { detail: data }));
  });

  // ── Page Visibility API reconnect ────────────────────────────────────────────
  // When a user returns to the tab after backgrounding, force reconnect if the
  // socket dropped while the tab was hidden (common on mobile browsers)
  _onVisibilityChange = () => {
    if (document.visibilityState === 'visible' && socket && !socket.connected) {
      console.log('👁️ Tab visible again — forcing socket reconnect');
      socket.connect();
    }
  };
  document.addEventListener('visibilitychange', _onVisibilityChange);

  return socket;
};

/** Get the current socket instance (may be null if not yet created) */
export const getSocket = () => socket;

/** Fully disconnect and clear the singleton (call on logout) */
export const disconnectSocket = () => _teardown();

// ── Internal teardown ─────────────────────────────────────────────────────────
function _teardown() {
  if (_onVisibilityChange) {
    document.removeEventListener('visibilitychange', _onVisibilityChange);
    _onVisibilityChange = null;
  }
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
    registeredUserId = null;
  }
}
