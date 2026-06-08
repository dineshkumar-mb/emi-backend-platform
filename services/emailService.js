import fs from 'fs';
import EmailLog from '../models/EmailLog.js';
import User from '../models/User.js';

/**
 * Mock/Real Email Dispatcher Service
 * Logs emails to system console/database or sends them via SMTP.
 * 
 * @param {string} to - Destination email address
 * @param {string} subject - Email subject header
 * @param {string} text - Email body text content
 * @param {Buffer} [pdfAttachmentBuffer] - Financial report PDF buffer
 * @param {string} [userId] - Optional ID of the recipient user
 * @returns {Promise<Object>} Status log payload
 */
export const sendEmailReport = async (to, subject, text, pdfAttachmentBuffer = null, userId = null) => {
  const isMock = process.env.MOCK_EMAIL === 'true';
  console.log(`[Email Service] Initiating email transmission to: ${to}. Mock Mode: ${isMock}`);
  console.log(`[Email Service] Subject Header: "${subject}"`);
  console.log(`[Email Service] PDF Attachment: ${pdfAttachmentBuffer ? pdfAttachmentBuffer.length : 0} bytes`);

  let resolvedUserId = userId;
  if (!resolvedUserId && to) {
    try {
      const user = await User.findOne({ email: to.trim().toLowerCase() });
      if (user) resolvedUserId = user._id;
    } catch (err) {
      console.error('[Email Service] User lookup error:', err.message);
    }
  }

  if (isMock) {
    try {
      const log = await EmailLog.create({
        userId: resolvedUserId,
        to: to,
        subject: subject,
        body: text,
        status: 'MOCK_SENT',
        attachmentSize: pdfAttachmentBuffer ? pdfAttachmentBuffer.length : 0,
      });
      console.log(`[Email Service] Logged mock email for user: ${resolvedUserId || 'unknown'}`);
      return { success: true, messageId: 'email_mock_' + log._id, timestamp: new Date().toISOString() };
    } catch (err) {
      console.error(`[Email Service] Failed to store mock email log:`, err.message);
      return { success: false, error: err.message };
    }
  }

  // Real SMTP / Gmail SMTP integration
  if (process.env.SMTP_ENABLED === 'true' && process.env.SMTP_HOST && (process.env.SMTP_USER || process.env.SMTP_USERNAME)) {
    try {
      const nodemailer = (await import('nodemailer')).default;
      const host = process.env.SMTP_HOST;
      const port = parseInt(process.env.SMTP_PORT) || 587;
      const user = process.env.SMTP_USER || process.env.SMTP_USERNAME;
      const pass = process.env.SMTP_PASSWORD || process.env.SMTP_PASS;

      const transporter = nodemailer.createTransport({
        host,
        port,
        secure: port === 465, // true for 465, false for other ports
        auth: { user, pass }
      });

      const mailOptions = {
        from: `"${process.env.SMTP_FROM_NAME || 'Financial Intelligence'}" <${process.env.SMTP_FROM_EMAIL || user}>`,
        to,
        subject,
        text,
      };

      if (pdfAttachmentBuffer) {
        mailOptions.attachments = [{
          filename: 'financial_intelligence_report.pdf',
          content: pdfAttachmentBuffer
        }];
      }

      await transporter.sendMail(mailOptions);
      console.log(`[Email Service] SMTP transmission to ${to} completed successfully.`);
      return { success: true, messageId: 'email_smtp_' + Math.random().toString(36).substring(2, 11), timestamp: new Date().toISOString() };
    } catch (err) {
      console.error(`[Email Service] SMTP transmission failed:`, err.message);
      return { success: false, error: err.message };
    }
  }

  console.log(`[Email Service] SMTP disabled. Message simulated: "${subject}"`);
  return { success: true, messageId: 'email_sim_' + Math.random().toString(36).substring(2, 11), timestamp: new Date().toISOString() };
};

