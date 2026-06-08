import SmsLog from '../models/SmsLog.js';

/**
 * Sends SMS notification.
 * Gated by process.env.MOCK_SMS for internal testing & QA.
 */
export const sendSMS = async (userId, to, message) => {
  const isMock = process.env.MOCK_SMS === 'true';
  const cleanNumber = to || '[Not Specified]';

  console.log(`[SMS Service] Transmitting SMS to ${cleanNumber}. Mock Mode: ${isMock}`);

  if (isMock) {
    try {
      const log = await SmsLog.create({
        userId,
        phone_number: cleanNumber,
        message,
        status: 'MOCK_SENT',
      });
      console.log(`[SMS Service] Logged mock SMS for user: ${userId}`);
      return { success: true, messageId: 'sms_mock_' + log._id };
    } catch (err) {
      console.error(`[SMS Service] Failed to store mock SMS log:`, err.message);
      return { success: false, error: err.message };
    }
  }

  // Real Twilio SMS Integration
  if (process.env.TWILIO_ENABLED === 'true' && process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
    try {
      const twilio = (await import('twilio')).default;
      const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
      const res = await client.messages.create({
        body: message,
        from: process.env.TWILIO_PHONE_NUMBER || '+1234567890',
        to: to.startsWith('+') ? to : '+' + to
      });
      console.log(`[SMS Service] Twilio SMS sent. SID: ${res.sid}`);
      return { success: true, messageId: res.sid };
    } catch (err) {
      console.error(`[SMS Service] Twilio transmission failed:`, err.message);
      return { success: false, error: err.message };
    }
  }

  console.log(`[SMS Service] Twilio disabled. Message simulated: "${message}"`);
  return { success: true, messageId: 'sms_sim_' + Math.random().toString(36).substring(2, 11) };
};
