import mongoose from 'mongoose';
import User from '../models/User.js';
import WhatsAppLog from '../models/WhatsAppLog.js';
import { getWAClient } from './openwaClient.js';
import { WhatsAppTemplates, replacePlaceholders } from '../templates/whatsappTemplates.js';

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
    const client = getWAClient();
    const formattedNumber = cleanNumber.replace(/[^0-9]/g, '');
    
    // Send text via OpenWA
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
  } catch (err) {
    console.error(`[WhatsApp Service] OpenWA transmission failed: ${err.message}`);
    
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
