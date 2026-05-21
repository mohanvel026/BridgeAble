import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const useStore = create(
  persist(
    (set) => ({
      user: null,
      token: null,
      socket: null,
      setUser: (user) => set({ user }),
      setToken: (token) => set({ token }),
      setSocket: (socket) => set({ socket }),
      logout: () => set({ user: null, token: null, socket: null }),
    }),
    {
      name: 'bridgeable-storage',
      partialize: (state) => ({ user: state.user, token: state.token }),
    }
  )
);
