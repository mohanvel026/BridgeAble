// server/src/middleware/freeTierLimit.js
// Week 9 — Enforces free tier restrictions
// Free: 1 helper, 30min calls/day, no group calls, no circles

const mongoose = require('mongoose');

// ── Check call duration limit (30min/day for free) ────────
exports.checkCallLimit = async (req, res, next) => {
  try {
    if (req.user.plan === 'pro') return next();

    const FREE_LIMIT_SECONDS = 30 * 60; // 30 minutes

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const todayRooms = await mongoose.model('Room').find({
      participants: req.user._id,
      status: 'ended',
      endedAt: { $gte: startOfDay },
    });

    const totalSeconds = todayRooms.reduce((sum, r) => sum + (r.durationSeconds || 0), 0);

    if (totalSeconds >= FREE_LIMIT_SECONDS) {
      return res.status(403).json({
        success: false,
        message: `Free tier limit reached. You have used ${Math.floor(totalSeconds / 60)} minutes today (limit: 30 min). Upgrade to Pro for unlimited calls.`,
        limitReached: true,
        upgradeUrl: '/pricing',
      });
    }

    // Attach remaining time to request
    req.remainingCallSeconds = FREE_LIMIT_SECONDS - totalSeconds;
    next();
  } catch (err) {
    next(); // Don't block call on middleware error
  }
};

// ── Check helper limit (1 helper for free) ────────────────
exports.checkHelperLimit = async (req, res, next) => {
  try {
    if (req.user.plan === 'pro') return next();

    const user = await mongoose.model('User').findById(req.user._id).select('helpers');
    if ((user.helpers || []).length >= 1) {
      return res.status(403).json({
        success: false,
        message: 'Free tier allows only 1 linked helper. Upgrade to Pro for unlimited helpers.',
        limitReached: true,
        upgradeUrl: '/pricing',
      });
    }
    next();
  } catch (err) {
    next();
  }
};

// ── Check group call access (pro only) ────────────────────
exports.requirePro = (feature = 'This feature') => (req, res, next) => {
  if (req.user.plan === 'pro') return next();
  return res.status(403).json({
    success: false,
    message: `${feature} is a Pro feature. Upgrade to unlock.`,
    limitReached: true,
    upgradeUrl: '/pricing',
  });
};