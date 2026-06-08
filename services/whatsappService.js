import mongoose from 'mongoose';
import User from '../models/User.js';
import WhatsAppLog from '../models/WhatsAppLog.js';

/**
 * Sends a regular free-text message.
 * Gated by process.env.MOCK_WHATSAPP.
 */
export const sendWhatsAppMessage = async (to, message, userId = null) => {
  const isMock = process.env.MOCK_WHATSAPP === 'true';
  const cleanNumber = to || '[Not Specified]';
  console.log(`[WhatsApp Service] Sending outbound alert to: ${cleanNumber}. Mock Mode: ${isMock}`);

  let resolvedUserId = userId;
  if (!resolvedUserId) {
    try {
      const cleanTo = to.replace(/[^0-9]/g, '');
      const user = await User.findOne({ whatsappNumber: { $regex: cleanTo } });
      if (user) {
        resolvedUserId = user._id;
      }
    } catch (err) {
      console.error('[WhatsApp Service] User lookup error:', err.message);
    }
  }

  if (isMock) {
    try {
      const log = await WhatsAppLog.create({
        userId: resolvedUserId || new mongoose.Types.ObjectId(),
        message,
        status: 'MOCK_SENT',
      });
      return {
        success: true,
        messageId: 'wa_mock_' + log._id,
        timestamp: new Date().toISOString()
      };
    } catch (err) {
      console.error('[WhatsApp Service] Failed to log mock WhatsApp:', err.message);
      return { success: false, error: err.message };
    }
  }
  
  // 1. Integrates with Twilio API when credentials exist:
  if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
    try {
      const client = (await import('twilio')).default(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
      await client.messages.create({
        body: message,
        from: `whatsapp:${process.env.TWILIO_WHATSAPP_NUMBER || '+14155238886'}`,
        to: `whatsapp:${to.startsWith('+') ? to : '+' + to}`
      });
      console.log(`[WhatsApp Service] Twilio message to ${to} sent successfully.`);
      return {
        success: true,
        messageId: 'wa_twilio_' + Math.random().toString(36).substring(2, 11),
        timestamp: new Date().toISOString()
      };
    } catch (err) {
      console.error(`[WhatsApp Service] Twilio transmission failed: ${err.message}`);
    }
  }
  
  return {
    success: true,
    messageId: 'wa_mock_fallback_' + Math.random().toString(36).substring(2, 11),
    timestamp: new Date().toISOString()
  };
};

/**
 * Sends an official Meta WhatsApp Business Cloud API Template Message.
 * Supported Templates: emi_due_reminder, loan_summary, missed_emi, credit_alert, monthly_report.
 */
export const sendWhatsAppTemplate = async (to, templateName, languageCode = 'en_US', components = [], userId = null) => {
  const token = process.env.META_WA_ACCESS_TOKEN;
  const phoneNumberId = process.env.META_WA_PHONE_NUMBER_ID || process.env.WHATSAPP_PHONE_NUMBER_ID;
  const cleanNumber = to.replace(/[^0-9]/g, ''); // Numeric digits only

  const isMock = process.env.MOCK_WHATSAPP === 'true';
  console.log(`[WhatsApp Meta API] Sending template "${templateName}" to phone "${cleanNumber}". Mock Mode: ${isMock}`);

  if (isMock) {
    let simulatedText = `[Template: ${templateName}] Params: ${JSON.stringify(components)}`;
    if (templateName === 'emi_due_reminder') {
      simulatedText = `🔔 *EMI Due Alert*:\nYour EMI payment is scheduled soon. Please ensure your account balance is sufficient.`;
    } else if (templateName === 'credit_alert') {
      simulatedText = `⚠️ *Credit Score Alert*:\nAn event has occurred that might impact your credit bureau score. Check the dashboard.`;
    }
    return sendWhatsAppMessage(to, simulatedText, userId);
  }

  if (token && phoneNumberId) {
    try {
      const url = `https://graph.facebook.com/v17.0/${phoneNumberId}/messages`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: cleanNumber,
          type: 'template',
          template: {
            name: templateName,
            language: {
              code: languageCode
            },
            components
          }
        })
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error?.message || 'Meta WhatsApp API error response');
      }
      console.log(`[WhatsApp Meta API] Template "${templateName}" sent successfully. Meta Msg ID: ${data.messages?.[0]?.id}`);
      return { success: true, messageId: data.messages?.[0]?.id };
    } catch (err) {
      console.error(`[WhatsApp Meta API] Failed to transmit template message:`, err.message);
      return { success: false, error: err.message };
    }
  }

  // Fallback to text message simulation
  console.log(`[WhatsApp Service] Meta Cloud API credentials missing. Simulating template dispatch...`);
  let simulatedText = `[Template: ${templateName}] Params: ${JSON.stringify(components)}`;
  return sendWhatsAppMessage(to, simulatedText, userId);
};
