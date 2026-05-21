// server/src/routes/circleRoutes.js
// Week 8 — Peer support circles CRUD + join/leave
const router = require('express').Router();
const mongoose = require('mongoose');
const { protect } = require('../middleware/authMiddleware');
const nodemailer = require('nodemailer');

// ── Helper: Valid ObjectId ────────────────────────────────
const isValidId = (id) => mongoose.Types.ObjectId.isValid(id);

// ── Get all public circles ────────────────────────────────
router.get('/', protect, async (req, res) => {
  try {
    const circles = await mongoose.model('Circle')
      .find({ isPublic: true })
      .populate('hostId', 'name avatar disabilityType')
      .populate('members', 'name avatar disabilityType')
      .sort({ nextSession: 1 });
    res.json({ success: true, circles });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// ── Get my circles ────────────────────────────────────────
router.get('/mine', protect, async (req, res) => {
  try {
    const circles = await mongoose.model('Circle')
      .find({ members: req.user._id })
      .populate('hostId', 'name avatar')
      .populate('members', 'name avatar disabilityType');
    res.json({ success: true, circles });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// ── Create circle ─────────────────────────────────────────
router.post('/', protect, async (req, res) => {
  try {
    const { name, topic, schedule, isPublic } = req.body;

    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ success: false, message: 'Circle name is required' });
    }
    if (!topic || typeof topic !== 'string' || !topic.trim()) {
      return res.status(400).json({ success: false, message: 'Circle topic is required' });
    }

    const nextSession = computeNextSession(schedule);

    const circle = await mongoose.model('Circle').create({
      name: name.trim(),
      topic: topic.trim(),
      hostId: req.user._id,
      members: [req.user._id],
      schedule,
      nextSession,
      isPublic: isPublic !== false,
    });

    res.status(201).json({ success: true, circle });
  } catch (err) {
    if (err.name === 'ValidationError') return res.status(400).json({ success: false, message: err.message });
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// ── Join circle ───────────────────────────────────────────
router.post('/:id/join', protect, async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid circle ID' });

    const circle = await mongoose.model('Circle').findById(req.params.id);
    if (!circle) return res.status(404).json({ success: false, message: 'Circle not found' });

    if (circle.members.map(m => m.toString()).includes(req.user._id.toString())) {
      return res.status(400).json({ success: false, message: 'You are already a member of this circle' });
    }

    if (circle.members.length >= (circle.maxParticipants || 4)) {
      return res.status(400).json({ success: false, message: 'Circle is full (max 4 members)' });
    }

    circle.members.push(req.user._id);
    await circle.save();

    res.json({ success: true, circle });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// ── Leave circle ──────────────────────────────────────────
router.post('/:id/leave', protect, async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid circle ID' });

    const circle = await mongoose.model('Circle').findById(req.params.id);
    if (!circle) return res.status(404).json({ success: false, message: 'Circle not found' });

    if (circle.hostId.toString() === req.user._id.toString()) {
      return res.status(400).json({ success: false, message: 'Host cannot leave the circle. Please delete it instead.' });
    }

    await mongoose.model('Circle').findByIdAndUpdate(req.params.id, {
      $pull: { members: req.user._id },
    });

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// ── Delete circle (host only) ─────────────────────────────
router.delete('/:id', protect, async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid circle ID' });

    const circle = await mongoose.model('Circle').findById(req.params.id);
    if (!circle) return res.status(404).json({ success: false, message: 'Not found' });
    
    if (circle.hostId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: 'Only host can delete' });
    }
    
    await circle.deleteOne();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// ── Helper: compute next session date ────────────────────
function computeNextSession(schedule) {
  if (!schedule?.day || !schedule?.time) return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const targetDay = days.indexOf(schedule.day);
  const [hour, min] = (schedule.time || '18:00').split(':').map(Number);

  const now = new Date();
  const next = new Date();
  next.setHours(hour, min, 0, 0);

  const diff = (targetDay - now.getDay() + 7) % 7;
  next.setDate(now.getDate() + (diff === 0 && next <= now ? 7 : diff));

  return next;
}

module.exports = router;