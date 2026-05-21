// server/src/routes/paymentRoutes.js
// Week 9 — Full Stripe + Razorpay integration
const router = require('express').Router();
const { protect } = require('../middleware/authMiddleware');
const ctrl = require('../controllers/paymentController');

// Plans info (public)
router.get('/plans', (req, res) => {
    res.json({
        success: true,
        plans: {
            free: {
                price: 0,
                features: ['1 helper link', '30min calls/day', 'Basic needs board', 'Community access', 'SOS system'],
            },
            pro: {
                price: { usd: 999, inr: 29900 },
                features: ['Unlimited helpers', 'Unlimited calls', 'Group calls', 'Circles', 'Health PDF export', 'Priority SOS', 'Full history', 'Analytics'],
            },
        },
    });
});

// Stripe
router.post('/stripe/webhook', require('express').raw({ type: 'application/json' }), ctrl.stripeWebhook);
router.post('/stripe/checkout', protect, ctrl.createStripeCheckout);

// Razorpay
router.post('/razorpay/order', protect, ctrl.createRazorpayOrder);
router.post('/razorpay/verify', protect, ctrl.verifyRazorpay);
router.post('/razorpay/webhook', ctrl.razorpayWebhook);

// Payment history
router.get('/history', protect, async (req, res) => {
    try {
        const mongoose = require('mongoose');
        const payments = await mongoose.model('Payment')
            .find({ userId: req.user._id })
            .sort({ createdAt: -1 });
        res.json({ success: true, payments });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

module.exports = router;