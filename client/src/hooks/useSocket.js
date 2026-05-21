// client/src/hooks/useSocket.js
// Industry-grade Socket.io lifecycle manager.
// Call once at App root level — all sub-components access state via stores.
// Handles: auth, call events, presence, SOS cooldown, circle reminders,
//          network quality feedback, and Page Visibility reconnection.

import { useEffect, useRef, useCallback } from 'react';
import toast from 'react-hot-toast';
import { useAuthStore } from '../store/stores';
import { useSocketStore } from '../store/stores';
import { createSocket, disconnectSocket } from '../lib/socket';

export default function useSocket() {
  const { user, token } = useAuthStore();
  const {
    setSocket,
    setIncomingCall,
    setUserOnline,
    clearIncomingCall,
  } = useSocketStore();

  const initialised = useRef(false);
  const socketRef   = useRef(null);

  // ── Connection quality toast ─────────────────────────────────────────────────
  const onConnected = useCallback(() => {
    if (initialised.current) {
      // Only show toast on RE-connects, not the first connect
      toast.success('Reconnected ✓', { id: 'socket-status', duration: 2000 });
    }
  }, []);

  const onReconnecting = useCallback(({ attempt }) => {
    if (attempt >= 2) {
      toast.loading(`Reconnecting… (attempt ${attempt})`, { id: 'socket-status' });
    }
  }, []);

  const onFailed = useCallback(() => {
    toast.error('Connection lost. Please refresh.', { id: 'socket-status', duration: 0 });
  }, []);

  useEffect(() => {
    if (!user || !token || initialised.current) return;
    initialised.current = true;

    const socket = createSocket(token, user._id);
    socketRef.current = socket;
    setSocket(socket);

    // ── Call signaling ─────────────────────────────────────────────────────────
    socket.on('call:incoming', (data) => {
      setIncomingCall(data);
    });

    socket.on('call:cancelled', () => {
      clearIncomingCall();
    });

    socket.on('call:recipient-offline', ({ recipientId } = {}) => {
      toast.error('User is offline right now', { id: 'offline-' + recipientId });
      window.dispatchEvent(new CustomEvent('bridgeable:recipient-offline', { detail: { recipientId } }));
    });

    // ── Presence ───────────────────────────────────────────────────────────────
    socket.on('user:status', ({ userId, status }) => {
      setUserOnline(userId, status === 'online');
    });

    socket.on('presence:update', ({ userId, isOnline }) => {
      setUserOnline(userId, isOnline);
    });

    // ── Health & care prompts ──────────────────────────────────────────────────
    socket.on('checkin:prompt', () => {
      window.dispatchEvent(new CustomEvent('bridgeable:checkin'));
    });

    socket.on('medicine:reminder', (data) => {
      window.dispatchEvent(new CustomEvent('bridgeable:medicine', { detail: data }));
      // In-app toast so user doesn't miss it even if panel is closed
      toast(`💊 Time for ${data.name} — ${data.dosage}`, {
        duration: 10000,
        id: `med-${data.medicineId}`,
      });
    });

    socket.on('healthlog:prompt', () => {
      window.dispatchEvent(new CustomEvent('bridgeable:healthprompt'));
    });

    // ── SOS events ─────────────────────────────────────────────────────────────
    socket.on('sos:alert', (data) => {
      window.dispatchEvent(new CustomEvent('bridgeable:sos-alert', { detail: data }));
    });

    socket.on('sos:cooldown', ({ retryAfterMs, secs }) => {
      toast.error(`SOS sent — cooldown ${secs ?? Math.ceil(retryAfterMs / 1000)}s`, {
        id: 'sos-cooldown', duration: retryAfterMs,
      });
      window.dispatchEvent(new CustomEvent('bridgeable:sos-cooldown', { detail: { retryAfterMs } }));
    });

    // ── Circle reminder ────────────────────────────────────────────────────────
    socket.on('circle:reminder', (data) => {
      toast(`🔵 ${data.circleName} starts in 30 min`, {
        duration: 10000, id: 'circle-reminder',
      });
      window.dispatchEvent(new CustomEvent('bridgeable:circle-reminder', { detail: data }));
    });

    // ── Host removed participant from group call ────────────────────────────────
    socket.on('host:removed', () => {
      window.dispatchEvent(new CustomEvent('bridgeable:removed'));
      toast.error('You were removed from the call by the host.');
    });

    // ── Social connection events ───────────────────────────────────────────────
    socket.on('connection:request', ({ fromUser }) => {
      toast(`👋 ${fromUser?.name ?? 'Someone'} wants to connect`, { duration: 5000 });
      window.dispatchEvent(new CustomEvent('bridgeable:connection-request', { detail: { fromUser } }));
    });

    socket.on('connection:accepted', ({ byUser }) => {
      toast.success(`✓ ${byUser?.name ?? 'Someone'} accepted your connection`);
      window.dispatchEvent(new CustomEvent('bridgeable:connection-accepted', { detail: { byUser } }));
    });

    // ── Network quality (bridgeable:socket-* dispatched by lib/socket.js) ─────
    window.addEventListener('bridgeable:socket-connected',    onConnected);
    window.addEventListener('bridgeable:socket-reconnecting', (e) => onReconnecting(e.detail));
    window.addEventListener('bridgeable:socket-failed',       onFailed);

    return () => {
      // Remove all socket listeners
      socket.off('call:incoming');
      socket.off('call:cancelled');
      socket.off('call:recipient-offline');
      socket.off('user:status');
      socket.off('presence:update');
      socket.off('checkin:prompt');
      socket.off('medicine:reminder');
      socket.off('healthlog:prompt');
      socket.off('sos:alert');
      socket.off('sos:cooldown');
      socket.off('circle:reminder');
      socket.off('host:removed');
      socket.off('connection:request');
      socket.off('connection:accepted');

      // Remove global window listeners
      window.removeEventListener('bridgeable:socket-connected',    onConnected);
      window.removeEventListener('bridgeable:socket-reconnecting', onReconnecting);
      window.removeEventListener('bridgeable:socket-failed',       onFailed);

      disconnectSocket();
      socketRef.current  = null;
      initialised.current = false;
    };
  }, [user, token]);
}