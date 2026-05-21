// server/src/routes/userRoutes.js
const router = require('express').Router();
const ctrl = require('../controllers/userController');
const { protect } = require('../middleware/authMiddleware');
const { avatarUpload } = require('../config/cloudinary');
const { checkHelperLimit } = require('../middleware/freeTierLimit');

router.get('/discover', protect, ctrl.discoverUsers);
router.get('/connection-requests', protect, ctrl.getConnectionRequests);
router.get('/connections', protect, ctrl.getConnections);
router.get('/:id', protect, ctrl.getProfile);
router.put('/profile', protect, avatarUpload.single('avatar'), ctrl.updateProfile);
router.post('/link-helper', protect, checkHelperLimit, ctrl.linkHelper);
router.delete('/unlink-helper/:helperId', protect, ctrl.unlinkHelper);

// ── Connection request flow (industry-grade: request → accept → connected)
router.post('/connect-request/:userId', protect, ctrl.sendConnectionRequest);
router.post('/connect-accept/:userId', protect, ctrl.acceptConnectionRequest);
router.post('/connect-decline/:userId', protect, ctrl.declineConnectionRequest);
router.delete('/connect-remove/:userId', protect, ctrl.removeConnection);

// ── Legacy friend routes (kept for backward compat)
router.post('/friend/:userId', protect, ctrl.addFriend);
router.delete('/friend/:userId', protect, ctrl.removeFriend);
router.post('/block/:userId', protect, ctrl.blockUser);

module.exports = router;