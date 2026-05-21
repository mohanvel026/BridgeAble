// server/src/routes/roomRoutes.js
const router = require('express').Router();
const ctrl = require('../controllers/roomController');
const { protect } = require('../middleware/authMiddleware');
const { checkCallLimit, requirePro } = require('../middleware/freeTierLimit');

router.post('/create', protect, checkCallLimit, ctrl.createRoom);
router.get('/:roomCode', protect, ctrl.getRoom);
router.get('/history/me', protect, ctrl.getCallHistory);
router.post('/:roomCode/end', protect, ctrl.endRoom);
router.get('/:roomCode/transcript', protect, ctrl.getTranscript);

module.exports = router;