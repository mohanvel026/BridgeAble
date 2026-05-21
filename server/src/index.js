// server/src/index.js
require('dotenv').config();
const http = require('http');

// Register ALL MongoDB models before anything else
require('./models/index');

const app       = require('./app');
const { initSocket } = require('./socket');
const connectDB = require('./config/db');
const { startCronJobs } = require('./services/cronService');

const PORT = process.env.PORT || 5000;
const server = http.createServer(app);

// Initialize Socket.io BEFORE connecting DB so handshakes work immediately
initSocket(server);

// Connect DB then start server
connectDB().then(() => {
  server.listen(PORT, () => {
    console.log(`\n🚀 BridgeAble server running on port ${PORT}`);
    console.log(`📡 Socket.io ready`);
    startCronJobs();
  });
});

// ── Graceful shutdown (SIGTERM from Docker / Render / Heroku) ─────────────────
const shutdown = async (signal) => {
  console.log(`\n⚠️  ${signal} received. Shutting down gracefully...`);

  server.close(async () => {
    console.log('🔒 HTTP server closed');
    try {
      const mongoose = require('mongoose');
      await mongoose.connection.close(false);
      console.log('🔒 MongoDB connection closed');
    } catch (e) {}
    console.log('✅ Graceful shutdown complete');
    process.exit(0);
  });

  // Force exit if graceful shutdown takes too long
  setTimeout(() => {
    console.error('❌ Forced shutdown after timeout');
    process.exit(1);
  }, 10_000);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

// ── Unhandled error safety net ────────────────────────────────────────────────
process.on('uncaughtException', (err) => {
  console.error('💥 uncaughtException:', err.message, err.stack);
  // Don't exit — cron + socket should keep running
});

process.on('unhandledRejection', (reason) => {
  console.error('💥 unhandledRejection:', reason);
});