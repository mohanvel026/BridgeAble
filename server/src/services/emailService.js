// server/src/services/emailService.js
// Centralised email service — single shared transporter (pooled SMTP)
// Exports: sendOTPEmail, sendSOSAlert, sendMedicineMissAlert,
//          sendWeeklyHealthSummary, sendCircleReminder
const nodemailer = require('nodemailer');

// ── Lazy singleton transporter ────────────────────────────────────────────────
// Only created on first use so the server starts even without email credentials.
let _transporter = null;

function getTransporter() {
  if (_transporter) return _transporter;

  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    console.warn('⚠️  EMAIL_USER / EMAIL_PASS not set — email delivery disabled.');
    return null;
  }

  _transporter = nodemailer.createTransport({
    service: 'gmail',
    pool: true,          // Keep SMTP connections alive for high-volume cron use
    maxConnections: 3,
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS, // Gmail App Password
    },
  });

  // Verify on first creation (non-blocking)
  _transporter.verify().catch(err =>
    console.warn('⚠️  SMTP verify failed:', err.message)
  );

  return _transporter;
}

// ── Shared send helper — never throws; returns false on failure ───────────────
async function send(mailOptions) {
  const transporter = getTransporter();
  if (!transporter) return false;
  try {
    await transporter.sendMail(mailOptions);
    return true;
  } catch (err) {
    console.error('📧 Email send error:', err.message);
    return false;
  }
}

// ── Shared HTML wrapper ───────────────────────────────────────────────────────
const wrap = (title, accentColor, body) => `
<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:'Segoe UI',sans-serif">
  <div style="max-width:560px;margin:40px auto;background:#111;border-radius:16px;
              border:1px solid ${accentColor}44;overflow:hidden">
    <div style="background:${accentColor}1a;padding:24px 32px;border-bottom:1px solid ${accentColor}33">
      <h2 style="margin:0;color:${accentColor};font-size:20px">🌉 BridgeAble</h2>
      <h3 style="margin:8px 0 0;color:#fff;font-size:16px">${title}</h3>
    </div>
    <div style="padding:28px 32px;color:#ccc;font-size:15px;line-height:1.7">
      ${body}
    </div>
    <div style="padding:16px 32px;background:#0f0f0f;color:#555;font-size:12px;
                border-top:1px solid #1f1f1f">
      BridgeAble — Accessible Communication Platform<br>
      You received this because you're registered as a caregiver or patient.
    </div>
  </div>
</body>
</html>`;

// ─────────────────────────────────────────────────────────────────────────────
// 1. OTP / Password Reset
// ─────────────────────────────────────────────────────────────────────────────
exports.sendOTPEmail = (email, otp, name) =>
  send({
    from: `"BridgeAble" <${process.env.EMAIL_USER}>`,
    to: email,
    subject: 'Your BridgeAble Verification Code',
    html: wrap('Verification Code', '#22d3ee', `
      <p>Hi <strong style="color:#fff">${name}</strong>,</p>
      <p>Use the following one-time code to verify your account or reset your password:</p>
      <div style="background:#0d9488;color:#fff;font-size:32px;font-weight:bold;
                  letter-spacing:10px;text-align:center;padding:20px;border-radius:12px;
                  margin:24px 0">${otp}</div>
      <p style="color:#888;font-size:13px">⏱ This code expires in <strong>10 minutes</strong>.<br>
      If you didn't request this, you can safely ignore this email.</p>
    `),
  });

// ─────────────────────────────────────────────────────────────────────────────
// 2. SOS Emergency Alert
// ─────────────────────────────────────────────────────────────────────────────
exports.sendSOSAlert = (helperEmails, patientName, { emergencyType, gps } = {}) =>
  send({
    from: `"BridgeAble Emergency" <${process.env.EMAIL_USER}>`,
    to: helperEmails.join(','),
    subject: `🚨 EMERGENCY SOS — ${patientName} needs help`,
    priority: 'high',
    html: wrap('🚨 Emergency SOS Alert', '#ef4444', `
      <p><strong style="color:#f87171;font-size:17px">${patientName}</strong>
         has triggered an <strong>SOS emergency alert</strong> on BridgeAble.</p>
      ${emergencyType ? `<p><strong>Type:</strong> ${emergencyType}</p>` : ''}
      ${gps?.lat ? `<p><strong>Location:</strong>
        <a href="https://maps.google.com/?q=${gps.lat},${gps.lng}"
           style="color:#22d3ee">View on Google Maps</a></p>` : ''}
      <p style="margin-top:24px">
        <a href="${process.env.CLIENT_URL || 'http://localhost:5173'}/helper"
           style="background:#ef4444;color:#fff;padding:12px 24px;border-radius:10px;
                  font-weight:bold;text-decoration:none;display:inline-block">
          Open Helper Dashboard →
        </a>
      </p>
      <p style="color:#888;font-size:13px;margin-top:20px">
        Sent at ${new Date().toLocaleString()}
      </p>
    `),
  });

// ─────────────────────────────────────────────────────────────────────────────
// 3. Medicine Miss Alert  ← was MISSING — crashed cronService on import
// ─────────────────────────────────────────────────────────────────────────────
exports.sendMedicineMissAlert = (helperEmail, patientName, medicineName) =>
  send({
    from: `"BridgeAble" <${process.env.EMAIL_USER}>`,
    to: helperEmail,
    subject: `💊 Missed Medication — ${patientName}`,
    html: wrap('Medication Missed', '#f59e0b', `
      <p>Hi,</p>
      <p><strong style="color:#fbbf24">${patientName}</strong> has not confirmed taking
         <strong style="color:#fff">${medicineName}</strong> within the expected window.</p>
      <p>Please check in with them as soon as possible.</p>
      <p style="margin-top:24px">
        <a href="${process.env.CLIENT_URL || 'http://localhost:5173'}/helper"
           style="background:#f59e0b;color:#000;padding:12px 24px;border-radius:10px;
                  font-weight:bold;text-decoration:none;display:inline-block">
          Open Helper Dashboard →
        </a>
      </p>
    `),
  });

// ─────────────────────────────────────────────────────────────────────────────
// 4. Weekly Health Summary  ← was MISSING — crashed cronService on import
// ─────────────────────────────────────────────────────────────────────────────
exports.sendWeeklyHealthSummary = (helperEmail, patientName, summary) => {
  const { avgSleep, avgPain, dominantMood, dominantAppetite, medicineCompliance } = summary || {};
  return send({
    from: `"BridgeAble" <${process.env.EMAIL_USER}>`,
    to: helperEmail,
    subject: `📊 Weekly Health Summary — ${patientName}`,
    html: wrap('Weekly Health Summary', '#a78bfa', `
      <p>Here is the 7-day health summary for
         <strong style="color:#c4b5fd">${patientName}</strong>:</p>
      <table style="width:100%;border-collapse:collapse;margin:20px 0;font-size:14px">
        <tr style="background:#1a1a2e">
          <td style="padding:10px 14px;color:#a78bfa;font-weight:bold">Sleep Quality</td>
          <td style="padding:10px 14px;color:#fff">${avgSleep ?? 'N/A'} / 5</td>
        </tr>
        <tr style="background:#12122a">
          <td style="padding:10px 14px;color:#a78bfa;font-weight:bold">Pain Level</td>
          <td style="padding:10px 14px;color:#fff">${avgPain ?? 'N/A'} / 10</td>
        </tr>
        <tr style="background:#1a1a2e">
          <td style="padding:10px 14px;color:#a78bfa;font-weight:bold">Dominant Mood</td>
          <td style="padding:10px 14px;color:#fff;text-transform:capitalize">${dominantMood ?? 'N/A'}</td>
        </tr>
        <tr style="background:#12122a">
          <td style="padding:10px 14px;color:#a78bfa;font-weight:bold">Appetite</td>
          <td style="padding:10px 14px;color:#fff;text-transform:capitalize">${dominantAppetite ?? 'N/A'}</td>
        </tr>
        <tr style="background:#1a1a2e">
          <td style="padding:10px 14px;color:#a78bfa;font-weight:bold">Medicine Compliance</td>
          <td style="padding:10px 14px;color:${(medicineCompliance ?? 0) >= 80 ? '#4ade80' : '#f87171'}">
            ${medicineCompliance ?? 'N/A'}%
          </td>
        </tr>
      </table>
      <p style="margin-top:24px">
        <a href="${process.env.CLIENT_URL || 'http://localhost:5173'}/helper"
           style="background:#a78bfa;color:#000;padding:12px 24px;border-radius:10px;
                  font-weight:bold;text-decoration:none;display:inline-block">
          View Full Dashboard →
        </a>
      </p>
    `),
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// 5. Circle Session Reminder  ← extracted so cronService doesn't create its own transporter
// ─────────────────────────────────────────────────────────────────────────────
exports.sendCircleReminder = (memberEmail, circleName, circleTopic, sessionUrl) =>
  send({
    from: `"BridgeAble" <${process.env.EMAIL_USER}>`,
    to: memberEmail,
    subject: `🔵 Starting in 30 min — ${circleName}`,
    html: wrap(`Circle: ${circleName}`, '#22d3ee', `
      <p>Your <strong style="color:#67e8f9">${circleName}</strong> support circle
         starts in <strong>30 minutes</strong>.</p>
      <p style="color:#888">Topic: ${circleTopic}</p>
      <p style="margin-top:24px">
        <a href="${sessionUrl}"
           style="background:#22d3ee;color:#040d0c;padding:12px 28px;border-radius:10px;
                  font-weight:bold;text-decoration:none;display:inline-block">
          Join Session →
        </a>
      </p>
      <p style="color:#555;font-size:12px;margin-top:16px">Direct link: ${sessionUrl}</p>
    `),
  });
