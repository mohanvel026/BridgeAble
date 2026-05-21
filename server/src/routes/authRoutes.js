// server/src/routes/authRoutes.js
const router = require('express').Router();
const auth = require('../controllers/authController');
const { protect } = require('../middleware/authMiddleware');

router.post('/register', auth.register);
router.post('/login', auth.login);
router.post('/logout', protect, auth.logout);
router.get('/me', protect, auth.getMe);
router.post('/forgot-password', auth.forgotPassword);
router.post('/reset-password', auth.resetPassword);
router.post('/blink-calibration', protect, auth.saveBlinkCalibration);

module.exports = router;