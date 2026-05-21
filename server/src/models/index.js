// server/src/models/index.js
// Registers ALL 9 MongoDB models in one place
// Import this file once in server startup to ensure all models are registered

const mongoose = require('mongoose');
const bcrypt    = require('bcryptjs');

// ── 1. User ───────────────────────────────────────────────
const userSchema = new mongoose.Schema({
  name:             { type: String, required: true, trim: true },
  email:            { type: String, required: true, unique: true, lowercase: true },
  passwordHash:     { type: String, required: true },
  disabilityType:   { type: String, enum: ['deaf','paralyzed','speech','blind','normal'], required: true },
  inputMode:        { type: String, enum: ['gesture','blink','symbol','voice','type'], default: 'type' },
  blinkProfile: {
    earThreshold: { type: Number, default: 0.25 },
    dashMs:       { type: Number, default: 400 },
    calibrated:   { type: Boolean, default: false },
  },
  helpers:          [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  patients:         [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  plan:             { type: String, enum: ['free','pro'], default: 'free' },
  stripeCustomerId: String,
  avatar:           { type: String, default: '' },
  preferences: {
    language:       { type: String, default: 'en' },
    speed:          { type: String, default: 'normal' },
    fontSize:       { type: String, default: 'medium' },
    highContrast:   { type: Boolean, default: false },
    ttsSpeed:       { type: Number, default: 1.0 },
    ttsVoiceGender: { type: String, default: 'neutral' },
    theme:          { type: String, default: 'dark' },
  },
  interests:        [String],
  isOnline:         { type: Boolean, default: false },
  lastSeen:         { type: Date, default: Date.now },
  resetOTP:         String,
  resetOTPExpiry:   Date,
  blockedUsers:     [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  friends:          [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  // Industry-grade social graph fields
  connections:      [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  sentRequests:     [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  receivedRequests: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  phone:            { type: String, default: '' },  // E.164 format e.g. +1234567890
  notificationPrefs: {
    emailSOS:            { type: Boolean, default: true },
    emailMedicineMiss:   { type: Boolean, default: true },
    emailCircleReminder: { type: Boolean, default: true },
    emailHealthSummary:  { type: Boolean, default: true },
    emailCallMissed:     { type: Boolean, default: true },
    smsSOS:              { type: Boolean, default: false },
    smsMedicineMiss:     { type: Boolean, default: false },
  },
  privacySettings: {
    whoCanCall:          { type: String, default: 'everyone' },
    anonymousCommunity:  { type: Boolean, default: false },
  },
}, { timestamps: true });

userSchema.pre('save', async function(next) {
  if (!this.isModified('passwordHash')) return next();
  this.passwordHash = await bcrypt.hash(this.passwordHash, 12);
  next();
});
userSchema.methods.comparePassword = function(plain) {
  return bcrypt.compare(plain, this.passwordHash);
};
userSchema.methods.toJSON = function() {
  const obj = this.toObject();
  delete obj.passwordHash;
  delete obj.resetOTP;
  delete obj.resetOTPExpiry;
  return obj;
};

// ── 2. Room ───────────────────────────────────────────────
const roomSchema = new mongoose.Schema({
  roomCode:        { type: String, required: true, unique: true },
  hostId:          { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  participants:    [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  type:            { type: String, enum: ['1-1','group','care'], default: '1-1' },
  status:          { type: String, enum: ['waiting','active','ended'], default: 'waiting' },
  startedAt:       Date,
  endedAt:         Date,
  durationSeconds: { type: Number, default: 0 },
  isGroup:         { type: Boolean, default: false },
}, { timestamps: true });

// ── 3. Transcript ─────────────────────────────────────────
const transcriptSchema = new mongoose.Schema({
  roomId:    { type: mongoose.Schema.Types.ObjectId, ref: 'Room', required: true },
  senderId:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  text:      { type: String, required: true },
  inputMode: { type: String, enum: ['gesture','blink','symbol','voice','type'], required: true },
  confidence:{ type: Number, default: 1.0, min: 0, max: 1 },
  timestamp: { type: Date, default: Date.now },
});

// ── 4. Message ────────────────────────────────────────────
const messageSchema = new mongoose.Schema({
  senderId:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  receiverId:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  type:        { type: String, enum: ['need','pain','emotion','custom','sos','yes-no'], required: true },
  content:     { type: mongoose.Schema.Types.Mixed, required: true },
  isRead:      { type: Boolean, default: false, index: true },
  deletedFor:  [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }], // soft delete per-user
  deliveredAt: { type: Date, default: null },
}, { timestamps: true });

// Compound index for fast inbox & conversation queries
messageSchema.index({ receiverId: 1, createdAt: -1 });
messageSchema.index({ senderId: 1, receiverId: 1, createdAt: -1 });
messageSchema.index({ receiverId: 1, isRead: 1 });

// ── 5. HealthLog ──────────────────────────────────────────
const healthLogSchema = new mongoose.Schema({
  userId:       { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  date:         { type: Date, required: true },
  sleepQuality: { type: Number, min: 1, max: 5 },
  painLevel:    { type: Number, min: 0, max: 10 },
  painLocation: String,
  mood:         String,
  appetite:     String,
  blinkEAR:     Number,
  notes:        String,
}, { timestamps: true });

// Compound index for fast time-series queries
healthLogSchema.index({ userId: 1, date: -1 });

// ── 6. Medicine ───────────────────────────────────────────
const medicineSchema = new mongoose.Schema({
  patientId:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  helperId:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  name:          { type: String, required: true },
  dosage:        { type: String, required: true },
  times:         [String],
  confirmations: [{ time: Date, confirmed: { type: Boolean, default: false } }],
  isActive:      { type: Boolean, default: true },
}, { timestamps: true });

// Compound index for dashboard queries and cron job filtering
medicineSchema.index({ patientId: 1, isActive: 1 });
medicineSchema.index({ helperId: 1 });

// ── 7. Task ───────────────────────────────────────────────
const taskSchema = new mongoose.Schema({
  patientId:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  helperId:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  title:        { type: String, required: true },
  notes:        String,
  status:       { type: String, enum: ['todo','done','skip'], default: 'todo' },
  category:     { type: String, enum: ['routine','meal','physio','med','other'], default: 'other' },
  scheduledFor: Date,
}, { timestamps: true });

// Indexes for scheduling and helper dashboards
taskSchema.index({ patientId: 1, status: 1 });
taskSchema.index({ helperId: 1 });

// ── 8. Circle ─────────────────────────────────────────────
const circleSchema = new mongoose.Schema({
  name:            { type: String, required: true },
  topic:           { type: String, required: true },
  hostId:          { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  members:         [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  schedule: {
    day:    String,
    time:   String,
    repeat: String,
  },
  nextSession:     Date,
  isPublic:        { type: Boolean, default: true },
  maxParticipants: { type: Number, default: 4 },
}, { timestamps: true });

// Index for cron jobs calculating upcoming sessions
circleSchema.index({ nextSession: 1 });

// ── 9. Payment ────────────────────────────────────────────
const paymentSchema = new mongoose.Schema({
  userId:          { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  stripeSessionId: String,
  razorpayOrderId: String,
  provider:        { type: String, enum: ['stripe','razorpay'], required: true },
  amount:          Number,
  currency:        { type: String, default: 'usd' },
  status:          { type: String, enum: ['paid','pending','failed'], default: 'pending' },
}, { timestamps: true });

// ── Register all models (safe — won't re-register if already done) ────
const models = {
  User:       mongoose.models.User       || mongoose.model('User',       userSchema),
  Room:       mongoose.models.Room       || mongoose.model('Room',       roomSchema),
  Transcript: mongoose.models.Transcript || mongoose.model('Transcript', transcriptSchema),
  Message:    mongoose.models.Message    || mongoose.model('Message',    messageSchema),
  HealthLog:  mongoose.models.HealthLog  || mongoose.model('HealthLog',  healthLogSchema),
  Medicine:   mongoose.models.Medicine   || mongoose.model('Medicine',   medicineSchema),
  Task:       mongoose.models.Task       || mongoose.model('Task',       taskSchema),
  Circle:     mongoose.models.Circle     || mongoose.model('Circle',     circleSchema),
  Payment:    mongoose.models.Payment    || mongoose.model('Payment',    paymentSchema),
};

module.exports = models;