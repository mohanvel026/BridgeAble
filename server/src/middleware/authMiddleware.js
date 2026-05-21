// server/src/middleware/authMiddleware.js
// Industry-grade auth middleware with token caching and granular error responses
const jwt     = require('jsonwebtoken');
const mongoose = require('mongoose');

// ── In-memory user cache (reduces DB round-trips on hot paths) ────────────────
// Each entry: { user, expiresAt }  — TTL: 60 seconds
const userCache = new Map();
const CACHE_TTL_MS = 60_000;

function getCachedUser(userId) {
  const entry = userCache.get(userId);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) { userCache.delete(userId); return null; }
  return entry.user;
}
function cacheUser(userId, user) {
  userCache.set(userId, { user, expiresAt: Date.now() + CACHE_TTL_MS });
}

// Evict cache when a user is updated (call from relevant controllers)
exports.evictUserCache = (userId) => userCache.delete(String(userId));

// ── Main protect middleware ───────────────────────────────────────────────────
exports.protect = async (req, res, next) => {
  try {
    // 1. Extract token from cookie or Authorization header
    let token = req.cookies?.token;
    if (!token && req.headers.authorization?.startsWith('Bearer ')) {
      token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
      return res.status(401).json({
        success: false,
        code:    'NO_TOKEN',
        message: 'Authentication required. Please log in.',
      });
    }

    // 2. Verify JWT
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (jwtErr) {
      const isExpired = jwtErr.name === 'TokenExpiredError';
      return res.status(401).json({
        success: false,
        code:    isExpired ? 'TOKEN_EXPIRED' : 'TOKEN_INVALID',
        message: isExpired
          ? 'Your session has expired. Please log in again.'
          : 'Invalid authentication token.',
      });
    }

    const userId = decoded.id || decoded._id || decoded.userId;
    if (!userId) {
      return res.status(401).json({ success: false, code: 'TOKEN_MALFORMED', message: 'Malformed token.' });
    }

    // 3. Offline / mock mode
    if (mongoose.connection.readyState !== 1) {
      const offlineDb = require('../config/offlineDb');
      const user = offlineDb.getUserById(userId);
      if (!user) {
        return res.status(401).json({ success: false, code: 'USER_NOT_FOUND', message: 'User not found.' });
      }
      req.user = user;
      return next();
    }

    // 4. Try cache first, then DB
    let user = getCachedUser(userId);
    if (!user) {
      const User = require('../models').User;
      user = await User.findById(userId).select('-passwordHash -resetOTP -resetOTPExpiry').lean();
      if (!user) {
        return res.status(401).json({ success: false, code: 'USER_NOT_FOUND', message: 'User not found.' });
      }
      cacheUser(userId, user);
    }

    req.user = user;
    next();
  } catch (err) {
    console.error('Auth middleware error:', err.message);
    res.status(500).json({ success: false, message: 'Authentication service error.' });
  }
};

// ── Pro plan guard ────────────────────────────────────────────────────────────
exports.requirePro = (req, res, next) => {
  if (req.user?.plan === 'pro') return next();
  return res.status(403).json({
    success:     false,
    code:        'PRO_REQUIRED',
    message:     'This feature requires a Pro subscription.',
    upgradeUrl:  '/pricing',
    limitReached: true,
  });
};