// server/src/routes/taskRoutes.js
// Week 8 — Kanban task board per patient
const router = require('express').Router();
const mongoose = require('mongoose');
const { protect } = require('../middleware/authMiddleware');

const isValidId = (id) => mongoose.Types.ObjectId.isValid(id);

// ── Get tasks for a patient ───────────────────────────────
router.get('/patient/:patientId', protect, async (req, res) => {
  try {
    if (!isValidId(req.params.patientId)) {
      return res.status(400).json({ success: false, message: 'Invalid patient ID format' });
    }

    const { date } = req.query;
    const filter = { patientId: req.params.patientId };

    if (date) {
      const parsedDate = new Date(date);
      if (isNaN(parsedDate.getTime())) {
        return res.status(400).json({ success: false, message: 'Invalid date parameter' });
      }
      const start = new Date(parsedDate); start.setHours(0, 0, 0, 0);
      const end = new Date(parsedDate); end.setHours(23, 59, 59, 999);
      filter.scheduledFor = { $gte: start, $lte: end };
    }

    const tasks = await mongoose.model('Task').find(filter).sort({ scheduledFor: 1 });
    res.json({ success: true, tasks });
  } catch (err) {
    console.error(`[GET /tasks/patient/${req.params.patientId}] Error:`, err.message);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// ── Create task ───────────────────────────────────────────
router.post('/', protect, async (req, res) => {
  try {
    const { patientId, title, notes, category, scheduledFor } = req.body;

    if (!patientId || !isValidId(patientId)) {
      return res.status(400).json({ success: false, message: 'Valid patientId is required' });
    }
    if (!title || typeof title !== 'string' || !title.trim()) {
      return res.status(400).json({ success: false, message: 'Task title is required' });
    }

    const task = await mongoose.model('Task').create({
      patientId,
      helperId: req.user._id,
      title: title.trim(),
      notes: notes?.trim() || '',
      category: category?.trim() || 'General',
      scheduledFor: scheduledFor ? new Date(scheduledFor) : undefined,
    });
    
    res.status(201).json({ success: true, task });
  } catch (err) {
    console.error('[POST /tasks] Error:', err.message);
    if (err.name === 'ValidationError') {
      return res.status(400).json({ success: false, message: err.message });
    }
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// ── Update task status ────────────────────────────────────
router.patch('/:id', protect, async (req, res) => {
  try {
    if (!isValidId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid task ID format' });
    }

    // Only allow updating certain fields to prevent injecting patientId/helperId
    const allowedUpdates = ['title', 'notes', 'category', 'status', 'scheduledFor'];
    const updates = {};
    for (const key of allowedUpdates) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ success: false, message: 'No valid fields provided for update' });
    }

    const task = await mongoose.model('Task').findByIdAndUpdate(
      req.params.id,
      { $set: updates },
      { new: true, runValidators: true }
    );
    
    if (!task) return res.status(404).json({ success: false, message: 'Task not found' });
    
    res.json({ success: true, task });
  } catch (err) {
    console.error(`[PATCH /tasks/${req.params.id}] Error:`, err.message);
    if (err.name === 'ValidationError') {
      return res.status(400).json({ success: false, message: err.message });
    }
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// ── Delete task ───────────────────────────────────────────
router.delete('/:id', protect, async (req, res) => {
  try {
    if (!isValidId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid task ID format' });
    }

    const task = await mongoose.model('Task').findByIdAndDelete(req.params.id);
    if (!task) return res.status(404).json({ success: false, message: 'Task not found' });

    res.json({ success: true });
  } catch (err) {
    console.error(`[DELETE /tasks/${req.params.id}] Error:`, err.message);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

module.exports = router;