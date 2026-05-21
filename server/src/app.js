// server/src/app.js
const express      = require('express');
const cors         = require('cors');
const helmet       = require('helmet');
const morgan       = require('morgan');
const cookieParser = require('cookie-parser');

// Routes
const authRoutes     = require('./routes/authRoutes');
const userRoutes     = require('./routes/userRoutes');
const roomRoutes     = require('./routes/roomRoutes');
const messageRoutes  = require('./routes/messageRoutes');
const medicineRoutes = require('./routes/medicineRoutes');
const healthRoutes   = require('./routes/healthRoutes');
const paymentRoutes  = require('./routes/paymentRoutes');
const circleRoutes   = require('./routes/circleRoutes');
const taskRoutes     = require('./routes/taskRoutes');
const exportRoutes   = require('./routes/exportRoutes');

const app = express();

// ── Security headers ──────────────────────────────────────────────────────────
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' }, // allow media streams
  contentSecurityPolicy: false,                           // CSP managed separately
}));

// ── CORS ──────────────────────────────────────────────────────────────────────
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    // Allow same-origin requests (no origin header) and configured origins
    if (!origin || ALLOWED_ORIGINS.length === 0 || ALLOWED_ORIGINS.includes(origin)) {
      return cb(null, true);
    }
    // In dev mode allow all; in production restrict
    if (process.env.NODE_ENV !== 'production') return cb(null, true);
    cb(new Error(`CORS: origin ${origin} not allowed`));
  },
  credentials: true,
}));

// ── Request logging ───────────────────────────────────────────────────────────
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('dev'));
}

app.use(cookieParser());

// ── Body parsers ──────────────────────────────────────────────────────────────
// Raw body for Stripe webhook (MUST come before express.json)
app.use('/api/payments/stripe/webhook', express.raw({ type: 'application/json' }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ── Simple in-process rate limiter (no extra package needed) ──────────────────
// Protects auth endpoints from brute-force without requiring redis
const rateBuckets = new Map(); // ip -> { count, resetAt }
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const RATE_LIMIT_MAX       = 20;              // 20 auth attempts per window

function authRateLimit(req, res, next) {
  const ip  = req.ip || req.connection.remoteAddress || 'unknown';
  const now = Date.now();
  const bucket = rateBuckets.get(ip);

  if (!bucket || now > bucket.resetAt) {
    rateBuckets.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return next();
  }

  bucket.count++;
  if (bucket.count > RATE_LIMIT_MAX) {
    const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
    res.set('Retry-After', retryAfter);
    return res.status(429).json({
      success: false,
      message: `Too many requests. Try again in ${retryAfter} seconds.`,
    });
  }
  next();
}

// Prune stale rate-limit entries every 15 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, b] of rateBuckets) {
    if (now > b.resetAt) rateBuckets.delete(ip);
  }
}, RATE_LIMIT_WINDOW_MS).unref();

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api/auth',      authRateLimit, authRoutes);
app.use('/api/users',     userRoutes);
app.use('/api/rooms',     roomRoutes);
app.use('/api/messages',  messageRoutes);
app.use('/api/medicines', medicineRoutes);
app.use('/api/health',    healthRoutes);
app.use('/api/payments',  paymentRoutes);
app.use('/api/circles',   circleRoutes);
app.use('/api/tasks',     taskRoutes);
app.use('/api/export',    exportRoutes);

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/api/ping', (req, res) => {
  const mongoose = require('mongoose');
  res.json({
    status:   'ok',
    time:     new Date(),
    db:       mongoose.connection.readyState === 1 ? 'online' : 'offline (mock mode)',
    env:      process.env.NODE_ENV || 'development',
  });
});

// ── Global error handler ──────────────────────────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  // CORS error from our origin check
  if (err.message?.startsWith('CORS:')) {
    return res.status(403).json({ success: false, message: err.message });
  }
  console.error('[Express Error]', err.stack || err.message);
  res.status(err.status || 500).json({
    success: false,
    message: process.env.NODE_ENV === 'production'
      ? 'Internal server error'
      : (err.message || 'Internal server error'),
  });
});

module.exports = app;