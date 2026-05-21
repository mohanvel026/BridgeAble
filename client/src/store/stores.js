// client/src/store/stores.js
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import api from '../lib/api';

// ── Safe LocalStorage Wrappers ─────────────────────────────
const safeStorage = {
  getItem: (key) => {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  },
  setItem: (key, value) => {
    try { localStorage.setItem(key, value); } catch (e) {}
  },
  removeItem: (key) => {
    try { localStorage.removeItem(key); } catch (e) {}
  }
};

// ── Auth Store ───────────────────────────────────────────
export const useAuthStore = create(
  persist(
    (set, get) => ({
      user: null,
      token: safeStorage.getItem('token'),
      loading: false,

      setUser: (user) => set({ user }),
      updateUser: (updates) => set((state) => ({ user: state.user ? { ...state.user, ...updates } : null })),
      setToken: (token) => {
        if (token) safeStorage.setItem('token', token);
        else safeStorage.removeItem('token');
        set({ token });
      },

      login: async (email, password) => {
        set({ loading: true });
        try {
          const { data } = await api.post('/auth/login', { email, password });
          get().setToken(data?.token);
          set({ user: data?.user });
          return data;
        } finally {
          set({ loading: false });
        }
      },

      register: async (formData) => {
        set({ loading: true });
        try {
          const { data } = await api.post('/auth/register', formData);
          get().setToken(data?.token);
          set({ user: data?.user });
          return data;
        } finally {
          set({ loading: false });
        }
      },

      logout: async () => {
        try { await api.post('/auth/logout').catch(() => {}); } finally {
          get().setToken(null);
          set({ user: null });
        }
      },

      refreshMe: async () => {
        if (!get().token) return;
        try {
          const { data } = await api.get('/auth/me');
          if (data?.user) set({ user: data.user });
        } catch (err) {
          if (err?.response?.status === 401 || err?.response?.status === 403) {
            get().setToken(null);
            set({ user: null });
          }
        }
      },
    }),
    { 
      name: 'bridgeable-auth',
      partialize: (state) => ({ user: state.user, token: state.token }) // Only persist essential data
    }
  )
);

// ── Socket Store ─────────────────────────────────────────
export const useSocketStore = create((set) => ({
  socket: null,
  onlineUsers: {},
  incomingCall: null,

  setSocket: (socket) => set({ socket }),
  setUserOnline: (userId, isOnline) => 
    set(s => ({ onlineUsers: { ...s.onlineUsers, [userId]: isOnline } })),
  setIncomingCall: (call) => set({ incomingCall: call }),
  clearIncomingCall: () => set({ incomingCall: null }),
}));

// ── Call Store ───────────────────────────────────────────
export const useCallStore = create((set) => ({
  inputMode: safeStorage.getItem('ba_inputMode') || null,
  setInputMode: (mode) => {
    safeStorage.setItem('ba_inputMode', mode);
    set({ inputMode: mode });
  },
  subtitles: [],
  participants: [],
  roomCode: null,
  addSubtitle: (subtitle) => set((state) => ({ subtitles: [...state.subtitles, subtitle] })),
  addParticipant: (participant) => set((state) => ({ 
    participants: state.participants.some(p => p.userId === participant.userId) 
      ? state.participants 
      : [...state.participants, participant] 
  })),
  setRoom: (roomCode) => set({ roomCode }),
  endCall: () => set({ subtitles: [], participants: [], roomCode: null }),
}));
