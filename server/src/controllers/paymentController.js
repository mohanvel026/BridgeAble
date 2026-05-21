// server/src/controllers/paymentController.js
// Week 9 — Stripe Checkout + Razorpay + webhook plan update
const mongoose  = require('mongoose');
const stripe    = require('stripe')(process.env.STRIPE_SECRET_KEY);
const Razorpay  = require('razorpay');

const razorpay = new Razorpay({
  key_id:     process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// ── Create Stripe Checkout Session ───────────────────────
exports.createStripeCheckout = async (req, res) => {
  try {
    const user = req.user;

    // Create or retrieve Stripe customer
    let customerId = user.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        name:  user.name,
        metadata: { userId: user._id.toString() },
      });
      customerId = customer.id;
      await mongoose.model('User').findByIdAndUpdate(user._id, { stripeCustomerId: customerId });
    }

    const session = await stripe.checkout.sessions.create({
      customer:             customerId,
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency:     'usd',
          unit_amount:  999,  // $9.99 in cents
          product_data: {
            name:        'BridgeAble Pro',
            description: 'Unlimited helpers, calls, group calls, health PDF, analytics',
            images:      [],
          },
        },
        quantity: 1,
      }],
      mode:        'payment',
      success_url: `${process.env.CLIENT_URL}/dashboard?payment=success`,
      cancel_url:  `${process.env.CLIENT_URL}/pricing?payment=cancelled`,
      metadata:    { userId: user._id.toString() },
    });

    // Save pending payment record
    await mongoose.model('Payment').create({
      userId:          user._id,
      stripeSessionId: session.id,
      provider:        'stripe',
      amount:          999,
      currency:        'usd',
      status:          'pending',
    });

    res.json({ success: true, checkoutUrl: session.url, sessionId: session.id });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── Create Razorpay Order (India / UPI) ───────────────────
exports.createRazorpayOrder = async (req, res) => {
  try {
    const order = await razorpay.orders.create({
      amount:   29900,        // ₹299 in paise
      currency: 'INR',
      receipt:  `order_${req.user._id}_${Date.now()}`,
      notes:    { userId: req.user._id.toString(), plan: 'pro' },
    });

    await mongoose.model('Payment').create({
      userId:         req.user._id,
      razorpayOrderId: order.id,
      provider:        'razorpay',
      amount:          29900,
      currency:        'INR',
      status:          'pending',
    });

    res.json({
      success: true,
      orderId:  order.id,
      amount:   order.amount,
      currency: order.currency,
      keyId:    process.env.RAZORPAY_KEY_ID,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── Stripe Webhook ────────────────────────────────────────
exports.stripeWebhook = async (req, res) => {
  const sig    = req.headers['stripe-signature'];
  let   event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Stripe webhook error:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const userId  = session.metadata?.userId;

    if (userId) {
      // Upgrade user to pro
      await mongoose.model('User').findByIdAndUpdate(userId, { plan: 'pro' });

      // Mark payment as paid
      await mongoose.model('Payment').findOneAndUpdate(
        { stripeSessionId: session.id },
        { status: 'paid' }
      );

      console.log(`✅ Stripe: User ${userId} upgraded to Pro`);
    }
  }

  if (event.type === 'payment_intent.payment_failed') {
    const pi = event.data.object;
    await mongoose.model('Payment').findOneAndUpdate(
      { stripeSessionId: pi.id },
      { status: 'failed' }
    );
  }

  res.json({ received: true });
};

// ── Razorpay Webhook ──────────────────────────────────────
exports.razorpayWebhook = async (req, res) => {
  try {
    const { payload } = req.body;
    const event = req.body.event;

    if (event === 'payment.captured') {
      const orderId = payload?.payment?.entity?.order_id;
      const notes   = payload?.payment?.entity?.notes;
      const userId  = notes?.userId;

      if (userId) {
        await mongoose.model('User').findByIdAndUpdate(userId, { plan: 'pro' });
        await mongoose.model('Payment').findOneAndUpdate(
          { razorpayOrderId: orderId },
          { status: 'paid' }
        );
        console.log(`✅ Razorpay: User ${userId} upgraded to Pro`);
      }
    }

    res.json({ received: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── Razorpay payment verification (client-side confirm) ───
exports.verifyRazorpay = async (req, res) => {
  try {
    const crypto = require('crypto');
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    const body      = razorpay_order_id + '|' + razorpay_payment_id;
    const expected  = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(body)
      .digest('hex');

    if (expected !== razorpay_signature) {
      return res.status(400).json({ success: false, message: 'Invalid signature' });
    }

    // Upgrade user
    await mongoose.model('User').findByIdAndUpdate(req.user._id, { plan: 'pro' });
    await mongoose.model('Payment').findOneAndUpdate(
      { razorpayOrderId: razorpay_order_id },
      { status: 'paid' }
    );

    res.json({ success: true, message: 'Payment verified. Pro plan activated!' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};