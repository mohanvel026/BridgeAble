// server/src/config/db.js
// Industry-grade MongoDB connection with exponential-backoff reconnect
const mongoose = require('mongoose');

const MAX_RETRIES   = 5;
const BASE_DELAY_MS = 2000; // 2s → 4s → 8s → 16s → 32s

async function connectDB(attempt = 1) {
  try {
    await mongoose.connect(process.env.MONGO_URI, {
      serverSelectionTimeoutMS: 8000,  // fail fast if Atlas is unreachable
      socketTimeoutMS: 45000,
      maxPoolSize: 10,
    });
    console.log(`✅ MongoDB connected: ${mongoose.connection.host}`);
    _registerEvents();
  } catch (err) {
    const isLastAttempt = attempt >= MAX_RETRIES;
    console.error(`⚠️  MongoDB connection failed (attempt ${attempt}/${MAX_RETRIES}): ${err.message}`);

    if (isLastAttempt) {
      console.log('💡 Running in Mock Fallback Mode — DB offline.');
      _registerEvents(); // Still watch for late connections
      return;
    }

    const delay = BASE_DELAY_MS * (2 ** (attempt - 1)); // exponential backoff
    console.log(`🔄 Retrying MongoDB in ${delay / 1000}s...`);
    await new Promise(r => setTimeout(r, delay));
    return connectDB(attempt + 1);
  }
}

function _registerEvents() {
  mongoose.connection.off('disconnected', _onDisconnect); // avoid duplicate listeners
  mongoose.connection.on('disconnected', _onDisconnect);
  mongoose.connection.on('reconnected',  () => console.log('✅ MongoDB reconnected'));
  mongoose.connection.on('error',        err => console.error('❌ MongoDB error:', err.message));
}

function _onDisconnect() {
  console.warn('⚠️  MongoDB disconnected — attempting auto-reconnect...');
  // Mongoose auto-reconnects by default; this is purely for observability
}

module.exports = connectDB;