// server/src/controllers/authController.js
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const mongoose = require('mongoose');
const User = require('../models').User;
const { sendOTPEmail } = require('../services/emailService');
const offlineDb = require('../config/offlineDb');

// ── Helpers ───────────────────────────────────────────────
const signToken = (id) =>
  jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  });

const sendTokenCookie = (res, token) => {
  res.cookie('token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  });
};

// ── Register ──────────────────────────────────────────────
exports.register = async (req, res) => {
  try {
    const {
      name, email, password,
      disabilityType, inputMode,
      helperEmail, language, speed,
    } = req.body;

    if (mongoose.connection.readyState !== 1) {
      console.log('🤖 Database offline. Registering offline mock user.');
      
      const existing = offlineDb.getUserByEmail(email);
      if (existing) {
        return res.status(400).json({ success: false, message: 'Email already registered' });
      }

      const mockUser = await offlineDb.createUser({
        name,
        email,
        passwordHash: password, // plain password for simple local offline verification
        disabilityType: disabilityType || 'normal',
        inputMode: inputMode || getDefaultMode(disabilityType)
      });

      const token = signToken(mockUser._id);
      sendTokenCookie(res, token);
      
      return res.status(201).json({
        success: true,
        message: 'Registered successfully (Mock)',
        user: mockUser,
        token,
        needsCalibration: disabilityType === 'paralyzed'
      });
    }

    // Check duplicate
    if (await User.findOne({ email })) {
      return res.status(400).json({ success: false, message: 'Email already registered' });
    }

    // Link helper if email provided
    let helpers = [];
    if (helperEmail) {
      const helper = await User.findOne({ email: helperEmail });
      if (helper) helpers = [helper._id];
    }

    const user = await User.create({
      name,
      email,
      passwordHash: password, // pre-save hook hashes it
      disabilityType,
      inputMode: inputMode || getDefaultMode(disabilityType),
      helpers,
      preferences: { language: language || 'en', speed: speed || 'normal' },
    });

    // If helper was found, add this user as their patient
    if (helperEmail) {
      const helper = await User.findOne({ email: helperEmail });
      if (helper) {
        helper.patients = helper.patients || [];
        helper.patients.push(user._id);
        await helper.save();
      }
    }

    const token = signToken(user._id);
    sendTokenCookie(res, token);

    res.status(201).json({
      success: true,
      message: 'Registered successfully',
      user,
      token,
      needsCalibration: disabilityType === 'paralyzed',
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── Login ─────────────────────────────────────────────────
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (mongoose.connection.readyState !== 1) {
      console.log('🤖 Database offline. Authenticating via offline database.');
      const user = offlineDb.getUserByEmail(email);
      if (!user) {
        return res.status(401).json({ success: false, message: 'Invalid credentials' });
      }

      const bcrypt = require('bcryptjs');
      const isMatch = await bcrypt.compare(password, user.passwordHash);
      if (!isMatch) {
        return res.status(401).json({ success: false, message: 'Invalid credentials' });
      }

      offlineDb.updateUser(user._id, { isOnline: true, lastSeen: new Date() });

      const token = signToken(user._id);
      sendTokenCookie(res, token);
      return res.json({
        success: true,
        user,
        token,
        needsCalibration: false
      });
    }

    const user = await User.findOne({ email }).select('+passwordHash');
    if (!user || !(await user.comparePassword(password))) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    user.isOnline = true;
    user.lastSeen = new Date();
    await user.save({ validateBeforeSave: false });

    const token = signToken(user._id);
    sendTokenCookie(res, token);

    res.json({
      success: true,
      user,
      token,
      needsCalibration: user.disabilityType === 'paralyzed' && !user.blinkProfile.calibrated,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── Logout ────────────────────────────────────────────────
exports.logout = async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      if (req.user) {
        offlineDb.updateUser(req.user._id, { isOnline: false, lastSeen: new Date() });
      }
      res.clearCookie('token');
      return res.json({ success: true, message: 'Logged out (Mock)' });
    }
    if (req.user) {
      await User.findByIdAndUpdate(req.user._id, { isOnline: false, lastSeen: new Date() });
    }
    res.clearCookie('token');
    res.json({ success: true, message: 'Logged out' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── Get current user (me) ─────────────────────────────────
exports.getMe = async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      const user = offlineDb.getUserById(req.user._id);
      if (!user) return res.status(404).json({ success: false, message: 'User not found' });
      
      const populatedFriends = (user.friends || []).map(fId => offlineDb.getUserById(fId)).filter(Boolean);
      const populatedHelpers = (user.helpers || []).map(hId => offlineDb.getUserById(hId)).filter(Boolean);
      
      const fullUser = {
        ...user,
        friends: populatedFriends,
        helpers: populatedHelpers
      };
      return res.json({ success: true, user: fullUser });
    }
    const user = await User.findById(req.user._id).populate('helpers', 'name email isOnline avatar disabilityType');
    res.json({ success: true, user });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── Forgot password — send OTP ────────────────────────────
exports.forgotPassword = async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.json({ success: true, message: 'Mock OTP sent to email' });
    }
    const { email } = req.body;
    const user = await User.findOne({ email });
    if (!user) {
      return res.json({ success: true, message: 'If that email exists, OTP was sent' });
    }

    const otp = crypto.randomInt(100000, 999999).toString();
    const otpHash = crypto.createHash('sha256').update(otp).digest('hex');

    user.resetOTP = otpHash;
    user.resetOTPExpiry = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
    await user.save({ validateBeforeSave: false });

    await sendOTPEmail(email, otp, user.name);

    res.json({ success: true, message: 'OTP sent to email' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── Verify OTP + reset password ───────────────────────────
exports.resetPassword = async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.json({ success: true, message: 'Password reset successful (Mock)' });
    }
    const { email, otp, newPassword } = req.body;

    const otpHash = crypto.createHash('sha256').update(otp).digest('hex');
    const user = await User.findOne({
      email,
      resetOTP: otpHash,
      resetOTPExpiry: { $gt: Date.now() },
    });

    if (!user) {
      return res.status(400).json({ success: false, message: 'Invalid or expired OTP' });
    }

    user.passwordHash = newPassword; // pre-save hook hashes it
    user.resetOTP = undefined;
    user.resetOTPExpiry = undefined;
    await user.save();

    res.json({ success: true, message: 'Password reset successful' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── Save blink calibration ────────────────────────────────
exports.saveBlinkCalibration = async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.json({ success: true, message: 'Blink calibration saved (Mock)' });
    }
    const { earThreshold, dashMs } = req.body;

    await User.findByIdAndUpdate(req.user._id, {
      'blinkProfile.earThreshold': earThreshold,
      'blinkProfile.dashMs': dashMs,
      'blinkProfile.calibrated': true,
    });

    res.json({ success: true, message: 'Blink calibration saved' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── Helpers ───────────────────────────────────────────────
function getDefaultMode(disabilityType) {
  const map = {
    deaf: 'gesture',
    paralyzed: 'blink',
    speech: 'symbol',
    blind: 'voice',
    normal: 'voice',
  };
  return map[disabilityType] || 'type';
}