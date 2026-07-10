import mongoose from 'mongoose';
import User from '../models/User.js';
import WhatsAppLog from '../models/WhatsAppLog.js';
import { getWAClient, getSessionUuid } from './openwaClient.js';
import { WhatsAppTemplates, replacePlaceholders } from '../templates/whatsappTemplates.js';
import axios from 'axios';

export const sendWhatsAppMessage = async (to, message, userId = null) => {
  const cleanNumber = to || '[Not Specified]';
  console.log(`[WhatsApp Service] Sending outbound alert to: ${cleanNumber}`);

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

  try {
    const formattedNumber = cleanNumber.replace(/[^0-9]/g, '');

    // Check if local OpenWA session is connected and ready
    let openWaReady = false;
    const sessionUuid = getSessionUuid();
    if (sessionUuid) {
      try {
        const response = await axios.get(`http://localhost:2785/api/sessions/${sessionUuid}`, {
          headers: { 'X-API-Key': 'default_master_key_for_emi_tracker_999' }
        });
        if (response.data && response.data.status === 'ready') {
          openWaReady = true;
        }
      } catch (err) {
        // Local gateway offline or not initialized
      }
    }

    if (openWaReady) {
      console.log(`[WhatsApp Service] Local OpenWA session is active. Sending via OpenWA.`);
      const client = getWAClient();
      const messageId = await client.sendText(`${formattedNumber}@c.us`, message);

      await WhatsAppLog.create({
        userId: resolvedUserId || new mongoose.Types.ObjectId(),
        message,
        status: 'SENT',
      });

      console.log(`[WhatsApp Service] Message to ${formattedNumber} sent successfully via OpenWA.`);
      return {
        success: true,
        messageId: typeof messageId === 'string' ? messageId : 'wa_openwa_' + Math.random().toString(36).substring(2, 11),
        timestamp: new Date().toISOString()
      };
    }

    // 1. Try Meta Cloud API next if token exists
    if (process.env.META_WA_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID) {
      try {
        const url = `https://graph.facebook.com/v17.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
        const payload = {
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: formattedNumber,
          type: "text",
          text: { preview_url: false, body: message }
        };
        
        const response = await axios.post(url, payload, {
          headers: {
            'Authorization': `Bearer ${process.env.META_WA_ACCESS_TOKEN}`,
            'Content-Type': 'application/json'
          }
        });
        
        console.log(`[WhatsApp Service] Message to ${formattedNumber} sent successfully via Meta Cloud API.`);
        
        await WhatsAppLog.create({
          userId: resolvedUserId || new mongoose.Types.ObjectId(),
          message,
          status: 'SENT',
      });
        
        return {
          success: true,
          messageId: response.data?.messages?.[0]?.id || 'wa_meta_' + Math.random().toString(36).substring(2, 11),
          timestamp: new Date().toISOString()
        };
      } catch (metaErr) {
        console.error(`[WhatsApp Service] Meta API transmission failed (falling back to OpenWA): ${metaErr.response?.data?.error?.message || metaErr.message}`);
        // Fallthrough to OpenWA
      }
    }

    // 2. Fallback to OpenWA
    const client = getWAClient();
    
    // Send text via OpenWA
    const messageId = await client.sendText(`${formattedNumber}@c.us`, message);

    await WhatsAppLog.create({
      userId: resolvedUserId || new mongoose.Types.ObjectId(),
      message,
      status: 'SENT',
    });

    console.log(`[WhatsApp Service] Message to ${formattedNumber} sent successfully via OpenWA fallback.`);
    return {
      success: true,
      messageId: typeof messageId === 'string' ? messageId : 'wa_openwa_' + Math.random().toString(36).substring(2, 11),
      timestamp: new Date().toISOString()
    };
  } catch (err) {
    console.error(`[WhatsApp Service] Transmission completely failed: ${err.message}`);
    
    await WhatsAppLog.create({
      userId: resolvedUserId || new mongoose.Types.ObjectId(),
      message,
      status: 'FAILED',
    });
    
    return { success: false, error: err.message };
  }
};

/**
 * Maps legacy / shorthand template names to our WhatsAppTemplates registry keys.
 */
const TEMPLATE_NAME_MAP = {
  'hello_world':       'WELCOME',
  'welcome':           'WELCOME',
  'emi_due_reminder':  'EMI_DUE_TOMORROW',
  'emi_due_today':     'EMI_DUE_TODAY',
  'emi_paid':          'EMI_PAID',
  'loan_closed':       'LOAN_CLOSED',
  'missed_payment':    'MISSED_PAYMENT',
  'monthly_summary':   'MONTHLY_SUMMARY',
  'autopay_failed':    'AUTOPAY_FAILED',
  'autopay_success':   'AUTOPAY_SUCCESS',
  'credit_tips':       'CREDIT_TIPS',
  'credit_alert':      'CREDIT_TIPS',
};

export const sendWhatsAppTemplate = async (to, templateName, languageCode = 'en_US', components = [], userId = null) => {
  console.log(`[WhatsApp Service] Resolving template "${templateName}" from registry...`);

  // Resolve template from our custom registry
  const registryKey = TEMPLATE_NAME_MAP[templateName] || templateName.toUpperCase();
  const templateBody = WhatsAppTemplates[registryKey];

  let messageText;

  if (templateBody) {
    // Build placeholder data from components array (each item is { key, value })
    const placeholderData = {};
    if (Array.isArray(components)) {
      components.forEach(c => {
        if (c && c.key) placeholderData[c.key] = c.value;
      });
    }
    // Resolve user name if not provided in components
    if (!placeholderData.name && userId) {
      try {
        const user = await User.findById(userId);
        if (user) placeholderData.name = user.name || 'Customer';
      } catch (_) { /* ignore */ }
    }
    messageText = replacePlaceholders(templateBody, placeholderData);
    console.log(`[WhatsApp Service] Resolved template "${registryKey}" → ${messageText.length} chars`);
  } else {
    // Fallback for unknown templates
    messageText = `*${templateName.replace(/_/g, ' ').toUpperCase()}*\n\nThis is an automated notification from EMI Intelligence.`;
    if (components && components.length > 0) {
      messageText += `\n\nDetails:\n` + JSON.stringify(components, null, 2);
    }
    console.log(`[WhatsApp Service] Template "${templateName}" not found in registry, using fallback.`);
  }

  // Use the standard send message function
  return sendWhatsAppMessage(to, messageText, userId);
};
