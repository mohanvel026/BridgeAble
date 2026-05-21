// server/src/routes/exportRoutes.js
// Week 7 — PDF export endpoints
const router = require('express').Router();
const mongoose = require('mongoose');
const { protect } = require('../middleware/authMiddleware');
const { generateHealthReport, generateTranscriptPDF, generateMedicinePDF } = require('../services/pdfService');

// ── Export health report as PDF ───────────────────────────
router.get('/health/:userId', protect, async (req, res) => {
  try {
    const { days = 30 } = req.query;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const [user, logs, medicines] = await Promise.all([
      mongoose.model('User').findById(req.params.userId).select('name'),
      mongoose.model('HealthLog').find({ userId: req.params.userId, date: { $gte: since } }).sort({ date: 1 }),
      mongoose.model('Medicine').find({ patientId: req.params.userId, isActive: true }),
    ]);

    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const pdfBuffer = await generateHealthReport(user.name, logs, medicines);

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="BridgeAble-Health-${user.name.replace(/\s/g, '-')}-${new Date().toISOString().slice(0, 10)}.pdf"`,
      'Content-Length': pdfBuffer.length,
    });
    res.send(pdfBuffer);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── Export call transcript as PDF ─────────────────────────
router.get('/transcript/:roomCode', protect, async (req, res) => {
  try {
    const room = await mongoose.model('Room').findOne({ roomCode: req.params.roomCode })
      .populate('participants', 'name disabilityType');
    if (!room) return res.status(404).json({ success: false, message: 'Room not found' });

    const transcripts = await mongoose.model('Transcript').find({ roomId: room._id })
      .populate('senderId', 'name disabilityType')
      .sort({ timestamp: 1 });

    const pdfBuffer = await generateTranscriptPDF(req.params.roomCode, room.participants, transcripts);

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="Transcript-${req.params.roomCode}.pdf"`,
      'Content-Length': pdfBuffer.length,
    });
    res.send(pdfBuffer);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── Export medicine log as PDF ────────────────────────────
router.get('/medicines/:patientId', protect, async (req, res) => {
  try {
    const [user, medicines] = await Promise.all([
      mongoose.model('User').findById(req.params.patientId).select('name'),
      mongoose.model('Medicine').find({ patientId: req.params.patientId }),
    ]);

    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const pdfBuffer = await generateMedicinePDF(user.name, medicines);

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="Medicine-Log-${user.name.replace(/\s/g, '-')}.pdf"`,
      'Content-Length': pdfBuffer.length,
    });
    res.send(pdfBuffer);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;