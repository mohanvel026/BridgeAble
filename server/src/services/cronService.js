// server/src/services/cronService.js
// Industry-grade cron jobs with targeted socket push and non-leaking email transport.
const cron = require('node-cron');
const mongoose = require('mongoose');
const {
  sendMedicineMissAlert,
  sendWeeklyHealthSummary,
  sendCircleReminder,
} = require('./emailService');
const { emitToUser } = require('../socket'); // targeted user push — NOT getIO()

exports.startCronJobs = () => {

  // ── Medicine reminder — check every minute ──────────────────────────────────
  cron.schedule('* * * * *', async () => {
    if (mongoose.connection.readyState !== 1) return;
    try {
      const now = new Date();
      const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

      const medicines = await mongoose.model('Medicine')
        .find({ isActive: true, times: hhmm })
        .populate('patientId', 'name email notificationPrefs')
        .populate('helperId',  'name email notificationPrefs')
        .lean();

      for (const med of medicines) {
        if (!med.patientId || !med.helperId) continue;

        // 1. Push real-time reminder to patient
        emitToUser(String(med.patientId._id), 'medicine:reminder', {
          medicineId: med._id,
          name:       med.name,
          dosage:     med.dosage,
          helperId:   med.helperId._id,
          time:       hhmm,
        });

        // 2. Schedule a missed-dose alert after 3 min (checks confirmation first)
        const medId     = med._id;
        const capturedNow = new Date(now);
        setTimeout(async () => {
          try {
            if (mongoose.connection.readyState !== 1) return;
            const freshMed = await mongoose.model('Medicine').findById(medId).lean();
            if (!freshMed) return;

            const confirmed = freshMed.confirmations?.some(c => {
              const diff = capturedNow - new Date(c.time);
              return Math.abs(diff) < 5 * 60 * 1000 && c.confirmed;
            });

            if (!confirmed && med.helperId.email &&
                med.patientId.notificationPrefs?.emailMedicineMiss !== false) {
              await sendMedicineMissAlert(
                med.helperId.email,
                med.patientId.name,
                med.name,
              );
            }
            
            // Twilio SMS
            if (!confirmed && med.helperId.phone &&
                med.patientId.notificationPrefs?.smsMedicineMiss !== false) {
              const { sendMedicineMissSMS } = require('./smsService');
              await sendMedicineMissSMS(
                med.helperId.phone,
                med.patientId.name,
                med.name,
                false // set to true for WhatsApp
              ).catch(() => {});
            }
          } catch (e) {
            console.error('Medicine miss-check error:', e.message);
          }
        }, 3 * 60 * 1000);
      }
    } catch (err) {
      console.error('Medicine cron error:', err.message);
    }
  });

  // ── Weekly health summary — every Sunday at 8am ─────────────────────────────
  cron.schedule('0 8 * * 0', async () => {
    if (mongoose.connection.readyState !== 1) return;
    try {
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

      const patients = await mongoose.model('User')
        .find({ disabilityType: { $ne: 'normal' } })
        .populate('helpers', 'email name')
        .lean();

      for (const patient of patients) {
        if (!patient.helpers?.length) continue;
        if (patient.notificationPrefs?.emailHealthSummary === false) continue;

        try {
          const logs = await mongoose.model('HealthLog')
            .find({ userId: patient._id, date: { $gte: sevenDaysAgo } })
            .lean();

          if (!logs.length) continue;

          const summary = {
            avgSleep:          avg(logs.map(l => l.sleepQuality)),
            avgPain:           avg(logs.map(l => l.painLevel)),
            dominantMood:      dominant(logs.map(l => l.mood)),
            dominantAppetite:  dominant(logs.map(l => l.appetite)),
            medicineCompliance: await getMedicineCompliance(patient._id, sevenDaysAgo),
          };

          for (const helper of patient.helpers) {
            if (helper.email) {
              await sendWeeklyHealthSummary(helper.email, patient.name, summary);
            }
          }
        } catch (e) {
          console.error(`Weekly summary error for ${patient.name}:`, e.message);
        }
      }
    } catch (err) {
      console.error('Weekly summary cron error:', err.message);
    }
  });

  // ── Auto check-in prompt — every 6 hours to online patients ─────────────────
  cron.schedule('0 */6 * * *', async () => {
    if (mongoose.connection.readyState !== 1) return;
    try {
      const patients = await mongoose.model('User')
        .find({ disabilityType: { $ne: 'normal' }, isOnline: true })
        .lean();

      for (const patient of patients) {
        emitToUser(String(patient._id), 'checkin:prompt', {
          message:   'Are you okay? Tap to respond.',
          timestamp: new Date(),
        });
      }
      console.log(`⏰ Check-in prompts sent to ${patients.length} patient(s)`);
    } catch (err) {
      console.error('Check-in cron error:', err.message);
    }
  });

  // ── Daily health log morning prompt — 8am every day ─────────────────────────
  cron.schedule('0 8 * * *', async () => {
    if (mongoose.connection.readyState !== 1) return;
    try {
      const patients = await mongoose.model('User')
        .find({ disabilityType: { $ne: 'normal' }, isOnline: true })
        .lean();

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      let prompted = 0;

      for (const patient of patients) {
        try {
          const existing = await mongoose.model('HealthLog').findOne({
            userId: patient._id,
            date:   { $gte: today },
          }).lean();

          if (!existing) {
            emitToUser(String(patient._id), 'healthlog:prompt', {
              message:   'Good morning! How are you feeling today?',
              timestamp: new Date(),
            });
            prompted++;
          }
        } catch (e) { /* per-patient error — don't break the loop */ }
      }
      console.log(`⏰ Morning health prompts sent to ${prompted} patient(s)`);
    } catch (err) {
      console.error('Health prompt cron error:', err.message);
    }
  });

  // ── Circle session reminders — check every 15 min (tighter window) ──────────
  cron.schedule('*/15 * * * *', async () => {
    if (mongoose.connection.readyState !== 1) return;
    try {
      const now = Date.now();
      const thirtyMinFromNow = new Date(now + 30 * 60 * 1000);
      const twentyFiveMinFromNow = new Date(now + 25 * 60 * 1000);

      const circles = await mongoose.model('Circle')
        .find({ nextSession: { $gte: twentyFiveMinFromNow, $lte: thirtyMinFromNow } })
        .populate('members', 'name email notificationPrefs')
        .lean();

      for (const circle of circles) {
        const roomCode  = `CIRCLE-${circle._id}`;
        const sessionUrl = `${process.env.CLIENT_URL || 'http://localhost:5173'}/call/group/${roomCode}`;

        for (const member of circle.members) {
          // Push in-app real-time notification
          emitToUser(String(member._id), 'circle:reminder', {
            circleName:  circle.name,
            circleTopic: circle.topic,
            sessionUrl,
            startsIn:    30,
          });

          // Email reminder (non-blocking, uses shared transporter)
          if (member.email && member.notificationPrefs?.emailCircleReminder !== false) {
            sendCircleReminder(member.email, circle.name, circle.topic, sessionUrl)
              .catch(e => console.warn('Circle reminder email failed:', e.message));
          }
        }
      }
    } catch (err) {
      console.error('Circle reminder cron error:', err.message);
    }
  });

  console.log('⏰ Cron jobs active: medicine · weekly-summary · check-in · health-prompt · circle-reminders');
};

// ── Pure helpers ──────────────────────────────────────────────────────────────
function avg(arr) {
  const valid = arr.filter(v => v != null && !isNaN(v));
  return valid.length ? (valid.reduce((a, b) => a + b, 0) / valid.length).toFixed(1) : 0;
}

function dominant(arr) {
  const freq = {};
  arr.filter(Boolean).forEach(v => { freq[v] = (freq[v] || 0) + 1; });
  const sorted = Object.entries(freq).sort((a, b) => b[1] - a[1]);
  return sorted[0]?.[0] ?? 'N/A';
}

async function getMedicineCompliance(userId, since) {
  try {
    const meds = await mongoose.model('Medicine')
      .find({ patientId: userId, isActive: true })
      .lean();
    if (!meds.length) return 100;

    const confirms = meds.reduce((sum, m) =>
      sum + (m.confirmations || []).filter(c =>
        new Date(c.time) >= since && c.confirmed
      ).length, 0
    );
    const expected = meds.reduce((sum, m) => sum + (m.times?.length || 0) * 7, 0);
    return expected ? Math.round((confirms / expected) * 100) : 100;
  } catch {
    return 100;
  }
}