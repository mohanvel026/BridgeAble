// server/src/routes/medicineRoutes.js
const router = require('express').Router();
const { protect } = require('../middleware/authMiddleware');
const mongoose = require('mongoose');

const isValidId = (id) => mongoose.Types.ObjectId.isValid(id);

router.post('/', protect, async (req, res) => {
  try {
    const { patientId, name, dosage, times } = req.body;
    
    if (!patientId || !isValidId(patientId)) {
      return res.status(400).json({ success: false, message: 'Valid patientId is required' });
    }
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ success: false, message: 'Medicine name is required' });
    }
    if (!dosage || typeof dosage !== 'string' || !dosage.trim()) {
      return res.status(400).json({ success: false, message: 'Dosage is required' });
    }

    const med = await mongoose.model('Medicine').create({
      patientId,
      helperId: req.user._id,
      name: name.trim(),
      dosage: dosage.trim(),
      times: Array.isArray(times) ? times : [],
    });
    
    res.status(201).json({ success: true, medicine: med });
  } catch (err) {
    console.error('[POST /medicines] Error:', err.message);
    if (err.name === 'ValidationError') {
      return res.status(400).json({ success: false, message: err.message });
    }
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

router.get('/patient/:patientId', protect, async (req, res) => {
  try {
    if (!isValidId(req.params.patientId)) {
      return res.status(400).json({ success: false, message: 'Invalid patient ID format' });
    }

    const meds = await mongoose.model('Medicine').find({
      patientId: req.params.patientId,
      isActive: true,
    }).sort({ createdAt: -1 });

    res.json({ success: true, medicines: meds });
  } catch (err) {
    console.error(`[GET /medicines/patient/${req.params.patientId}] Error:`, err.message);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

router.patch('/:id/confirm', protect, async (req, res) => {
  try {
    if (!isValidId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid medicine ID format' });
    }

    const med = await mongoose.model('Medicine').findByIdAndUpdate(
      req.params.id,
      { $push: { confirmations: { time: new Date(), confirmed: true } } },
      { new: true, runValidators: true }
    );
    
    if (!med) {
      return res.status(404).json({ success: false, message: 'Medicine not found' });
    }
    
    res.json({ success: true, medicine: med });
  } catch (err) {
    console.error(`[PATCH /medicines/${req.params.id}/confirm] Error:`, err.message);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

router.delete('/:id', protect, async (req, res) => {
  try {
    if (!isValidId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid medicine ID format' });
    }

    const med = await mongoose.model('Medicine').findByIdAndUpdate(
      req.params.id,
      { isActive: false },
      { new: true }
    );
    
    if (!med) {
      return res.status(404).json({ success: false, message: 'Medicine not found' });
    }
    
    res.json({ success: true });
  } catch (err) {
    console.error(`[DELETE /medicines/${req.params.id}] Error:`, err.message);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

module.exports = router;
