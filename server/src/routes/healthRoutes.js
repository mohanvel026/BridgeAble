// server/src/routes/healthRoutes.js
const router   = require('express').Router();
const { protect } = require('../middleware/authMiddleware');
const mongoose = require('mongoose');
const offlineDb = require('../config/offlineDb');

const isDbOnline = () => mongoose.connection.readyState === 1;

// ── POST /api/health — log today's health entry (upsert) ──────────────────────
router.post('/', protect, async (req, res) => {
  try {
    const {
      sleepQuality, painLevel, painLocation,
      mood, appetite, blinkEAR, notes,
    } = req.body;

    // Basic validation
    if (sleepQuality !== undefined && (sleepQuality < 1 || sleepQuality > 5)) {
      return res.status(400).json({ success: false, message: 'sleepQuality must be 1–5' });
    }
    if (painLevel !== undefined && (painLevel < 0 || painLevel > 10)) {
      return res.status(400).json({ success: false, message: 'painLevel must be 0–10' });
    }

    if (!isDbOnline()) {
      const mockLog = {
        _id:          'log-' + Date.now(),
        userId:       req.user._id,
        date:         new Date().toISOString(),
        sleepQuality, painLevel, painLocation,
        mood, appetite, blinkEAR, notes,
      };
      // Persist to offlineDb so it shows up in GET /me
      await offlineDb.addHealthLog({ ...mockLog, userId: String(req.user._id) }).catch(() => {});
      return res.json({ success: true, log: mockLog });
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const log = await mongoose.model('HealthLog').findOneAndUpdate(
      { userId: req.user._id, date: today },
      { sleepQuality, painLevel, painLocation, mood, appetite, blinkEAR, notes },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    res.json({ success: true, log });
  } catch (err) {
    console.error('Health log POST error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to save health log' });
  }
});

// ── GET /api/health/me — last N days for logged-in user ──────────────────────
router.get('/me', protect, async (req, res) => {
  try {
    if (!isDbOnline()) {
      // Return stored offline logs + fill gaps with realistic mock data
      const stored = offlineDb.getHealthLogs(String(req.user._id));
      if (stored.length) return res.json({ success: true, logs: stored });

      // No stored logs — return 7-day plausible demo data (correct scale)
      const mockLogs = Array.from({ length: 7 }).map((_, i) => {
        const date = new Date();
        date.setDate(date.getDate() - i);
        return {
          _id:          'log-mock-' + i,
          userId:       req.user._id,
          date:         date.toISOString(),
          sleepQuality: Math.floor(Math.random() * 2) + 3, // 3–4 (scale: 1–5)
          painLevel:    Math.floor(Math.random() * 3) + 1, // 1–3 (scale: 0–10)
          painLocation: 'None',
          mood:         ['okay', 'good', 'great'][Math.floor(Math.random() * 3)],
          appetite:     ['fair', 'good', 'excellent'][Math.floor(Math.random() * 3)],
        };
      }).reverse();
      return res.json({ success: true, logs: mockLogs });
    }

    const days = Math.min(Math.max(Number(req.query.days) || 30, 1), 365);
    const from  = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const logs  = await mongoose.model('HealthLog')
      .find({ userId: req.user._id, date: { $gte: from } })
      .sort({ date: 1 })
      .lean();
    res.json({ success: true, logs });
  } catch (err) {
    console.error('Health log GET error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to fetch health logs' });
  }
});

// ── GET /api/health/patient/:patientId — helper views patient's logs ──────────
router.get('/patient/:patientId', protect, async (req, res) => {
  try {
    if (!isDbOnline()) {
      const stored = offlineDb.getHealthLogs(req.params.patientId);
      return res.json({ success: true, logs: stored });
    }

    // Verify the requesting user is actually a helper for this patient
    const patient = await mongoose.model('User')
      .findById(req.params.patientId)
      .select('helpers')
      .lean();

    const myId = String(req.user._id);
    const isHelper = patient?.helpers?.map(String).includes(myId);
    // Allow self-access too (for admin/dev)
    if (!isHelper && myId !== req.params.patientId) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const days  = Math.min(Number(req.query.days) || 30, 365);
    const from  = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const logs  = await mongoose.model('HealthLog')
      .find({ userId: req.params.patientId, date: { $gte: from } })
      .sort({ date: -1 })
      .limit(90)
      .lean();
    res.json({ success: true, logs });
  } catch (err) {
    console.error('Patient health log error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to fetch patient logs' });
  }
});

// ── GET /api/health/today — quick check if user already logged today ──────────
router.get('/today', protect, async (req, res) => {
  try {
    if (!isDbOnline()) return res.json({ success: true, logged: false });

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const existing = await mongoose.model('HealthLog')
      .findOne({ userId: req.user._id, date: { $gte: today } })
      .lean();
    res.json({ success: true, logged: !!existing, log: existing || null });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;