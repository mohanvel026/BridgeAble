// client/vite.config.js
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// ── LAN IP for phone/multi-device testing ────────────────────────────────────
// Change this to your machine's local IP (run `ipconfig` → IPv4 Address).
// When testing only on one machine, set to 'localhost'.
const LAN_IP = process.env.LAN_IP || 'localhost';
const BACKEND_PORT = 5000;
const BACKEND_URL = `http://localhost:${BACKEND_PORT}`;

export default defineConfig({
  plugins: [react()],
  define: {
    // Expose backend URL to client code (used by socket.js and api.js)
    __VITE_SERVER_URL__: JSON.stringify(BACKEND_URL),
  },
  server: {
    host: true,      // ← Expose on 0.0.0.0 so phones on same WiFi can connect
    port: 5173,
    strictPort: false,
    allowedHosts: true, // ← Disable host checking for tunnel access
    proxy: {
      '/api': {
        target: BACKEND_URL,
        changeOrigin: true,
      },
      '/socket.io': {
        target: BACKEND_URL,
        changeOrigin: true,
        ws: true,    // ← Proxy WebSocket connections too
      },
    },
  },
  optimizeDeps: {
    exclude: ['@mediapipe/hands', '@mediapipe/face_mesh', '@mediapipe/camera_utils'],
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-router-dom'],
          ui: ['framer-motion', 'recharts', 'react-hot-toast'],
          socket: ['socket.io-client'],
          mediapipe: ['@mediapipe/hands', '@mediapipe/face_mesh'],
          tfjs: ['@tensorflow/tfjs'],
        },
      },
    },
  },
});