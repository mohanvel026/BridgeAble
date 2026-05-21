// server/src/services/smsService.js
// Industry-grade SMS/WhatsApp notification service using Twilio
const twilio = require('twilio');

let client = null;

const initTwilio = () => {
  if (client) return client;
  if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
    console.warn('⚠️ Twilio credentials missing. SMS/WhatsApp notifications are disabled.');
    return null;
  }
  try {
    client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    return client;
  } catch (err) {
    console.error('⚠️ Failed to initialize Twilio client:', err.message);
    return null;
  }
};

/**
 * Sleep helper for exponential backoff
 */
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Clean phone number to E.164 format (basic)
 */
const sanitizePhone = (phone) => {
  if (!phone) return null;
  // Remove all non-digit and non-plus characters
  let cleaned = phone.replace(/[^\d+]/g, '');
  // If it doesn't start with +, assume it needs one (caller must provide country code)
  if (!cleaned.startsWith('+')) {
    cleaned = `+${cleaned}`;
  }
  return cleaned;
};

/**
 * Send an SMS or WhatsApp message with exponential backoff retry
 * @param {string} to - The recipient's phone number (E.164 format, e.g., +1234567890)
 * @param {string} body - The message content
 * @param {boolean} useWhatsApp - If true, formats number for WhatsApp
 * @param {number} maxRetries - Maximum number of retries
 */
const sendMessage = async (to, body, useWhatsApp = false, maxRetries = 2) => {
  const twilioClient = initTwilio();
  if (!twilioClient) return false;
  
  const cleanTo = sanitizePhone(to);
  if (!cleanTo) {
    console.warn('⚠️ Invalid phone number format provided to Twilio service.');
    return false;
  }

  const fromNumber = useWhatsApp 
    ? `whatsapp:${process.env.TWILIO_WHATSAPP_NUMBER}` 
    : process.env.TWILIO_PHONE_NUMBER;
    
  const toNumber = useWhatsApp && !cleanTo.startsWith('whatsapp:') 
    ? `whatsapp:${cleanTo}` 
    : cleanTo;

  if (!fromNumber) {
    console.warn(`⚠️ Twilio ${useWhatsApp ? 'WhatsApp' : 'Phone'} number missing from env variables.`);
    return false;
  }

  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    try {
      const message = await twilioClient.messages.create({
        body,
        from: fromNumber,
        to: toNumber,
      });
      console.log(`✅ [Twilio] ${useWhatsApp ? 'WhatsApp' : 'SMS'} sent successfully to ${cleanTo} (SID: ${message.sid})`);
      return true;
    } catch (error) {
      console.error(`❌ [Twilio] Attempt ${attempt} failed for ${cleanTo}:`, error.message);
      
      if (attempt <= maxRetries) {
        const delay = Math.pow(2, attempt) * 500; // 1s, 2s...
        console.log(`⏳ Retrying in ${delay}ms...`);
        await sleep(delay);
      } else {
        console.error(`🚨 [Twilio] All ${maxRetries + 1} attempts failed. Dropping message.`);
        return false;
      }
    }
  }
};

exports.sendMessage = sendMessage;

/**
 * Send SOS Alert via SMS/WhatsApp
 */
exports.sendSOSAlertSMS = async (phoneNumbers, patientName, gps = null, useWhatsApp = false) => {
  if (!phoneNumbers || phoneNumbers.length === 0) return false;
  
  let body = `🚨 EMERGENCY ALERT: ${patientName} has triggered an SOS!`;
  if (gps && gps.lat && gps.lng) {
    body += `\n📍 Location: https://maps.google.com/?q=${gps.lat},${gps.lng}`;
  }
  body += `\n\nPlease check on them immediately.`;

  // Send to all helpers
  const promises = phoneNumbers.map(phone => sendMessage(phone, body, useWhatsApp));
  await Promise.allSettled(promises);
  return true;
};

/**
 * Send Medicine Miss Alert via SMS/WhatsApp
 */
exports.sendMedicineMissSMS = async (phoneNumber, patientName, medicineName, useWhatsApp = false) => {
  if (!phoneNumber) return false;
  const body = `⚠️ MEDICATION ALERT: ${patientName} missed their scheduled dose of ${medicineName}.`;
  return sendMessage(phoneNumber, body, useWhatsApp);
};
