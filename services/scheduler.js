import cron from 'node-cron';
import Loan from '../models/Loan.js';
import NotificationOutbox from '../models/NotificationOutbox.js';
import User from '../models/User.js';
import Asset from '../models/Asset.js';
import Subscription from '../models/Subscription.js';
import LoanPayment from '../models/LoanPayment.js';
import SmsLog from '../models/SmsLog.js';
import WhatsAppLog from '../models/WhatsAppLog.js';
import EmailLog from '../models/EmailLog.js';
import PushNotificationLog from '../models/PushNotificationLog.js';
import DocumentParseLog from '../models/DocumentParseLog.js';
import AnalyticsEvent from '../models/AnalyticsEvent.js';
import FraudAlert from '../models/FraudAlert.js';
import { generateFinancialReportPDF } from './pdfService.js';
import { sendEmailReport } from './emailService.js';
import { sendTelegramMessage } from './telegramService.js';
import { sendPushNotification } from './pushNotificationService.js';
import { sendSMS } from './smsService.js';
import { calculateCreditScore } from './creditEngine.js';
import { queueWhatsAppMessage } from './whatsappAutomationService.js';

const getGeoFormatting = (geo) => {
  switch (geo) {
    case 'US': return { symbol: '$', locale: 'en-US' };
    case 'GB': return { symbol: '£', locale: 'en-GB' };
    case 'EU': return { symbol: '€', locale: 'de-DE' };
    case 'AE': return { symbol: 'د.إ', locale: 'en-AE' };
    case 'IN':
    default:
      return { symbol: '₹', locale: 'en-IN' };
  }
};

/**
 * Sweep function to find active loans due in daysRemaining days and dispatch reminders.
 */
export const runEmiDueSweep = async (daysRemaining) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const loans = await Loan.find({ status: 'active' }).populate('userId');
  let processedCount = 0;

  for (const loan of loans) {
    if (!loan.userId) continue;

    const user = loan.userId;
    const dueDate = new Date(loan.nextDueDate);
    dueDate.setHours(0, 0, 0, 0);

    const diffTime = dueDate.getTime() - today.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays === daysRemaining) {
      const dayLabel = daysRemaining === 0 ? 'Today' : 'Tomorrow';
      const title = `🔔 EMI Due Alert: Due ${dayLabel}`;
      
      const geo = user.geo || 'IN';
      const { symbol, locale } = getGeoFormatting(geo);
      const dueDateStr = dueDate.toLocaleDateString(locale, {
        day: 'numeric',
        month: 'long',
        year: 'numeric'
      });

      const message = `Dear ${user.name || 'Customer'},\nYour EMI of ${symbol}${loan.emiAmount.toLocaleString(locale)} for your ${loan.loanType} loan with ${loan.provider} is due ${dayLabel.toLowerCase()} (${dueDateStr}). Please ensure sufficient balance.`;

      console.log(`[Scheduler Sweep] Dispatching EMI reminder to user ${user.email} (Due in ${daysRemaining} days)`);

      // 1. Send Push Notification
      await sendPushNotification(user._id, title, message);

      // 2. Send Email
      await sendEmailReport(user.email, title, message, null, user._id);

      // 3. Send SMS (via MockSMS / Twilio)
      const phone = user.whatsappNumber || '0000000000';
      await sendSMS(user._id, phone, message);

      // 4. Send Mock WhatsApp if MOCK_WHATSAPP=true
      if (process.env.MOCK_WHATSAPP === 'true') {
        const { sendWhatsAppMessage } = await import('./whatsappService.js');
        await sendWhatsAppMessage(phone, message, user._id);
      }

      processedCount++;
    }
  }
  return processedCount;
};

/**
 * Initializes the background cron scheduler.
 */
export const initScheduler = () => {
  // Sweep daily at 9:00 AM: check EMI due tomorrow
  cron.schedule('0 9 * * *', async () => {
    console.log('[Scheduler] Running daily 9:00 AM sweep (due tomorrow)...');
    try {
      const count = await runEmiDueSweep(1);
      console.log(`[Scheduler] 9 AM sweep processed ${count} reminder(s).`);
    } catch (error) {
      console.error('[Scheduler] 9 AM sweep error:', error.message);
    }
  });

  // Sweep daily at 10:00 AM: check EMI due today
  cron.schedule('0 10 * * *', async () => {
    console.log('[Scheduler] Running daily 10:00 AM sweep (due today)...');
    try {
      const count = await runEmiDueSweep(0);
      console.log(`[Scheduler] 10 AM sweep processed ${count} reminder(s).`);
    } catch (error) {
      console.error('[Scheduler] 10 AM sweep error:', error.message);
    }
  });

  // Outbox worker: runs every 5 minutes to dispatch queued alerts with retry support
  cron.schedule('*/5 * * * *', async () => {
    console.log('[Scheduler] Outbox worker sweeping pending queue...');
    try {
      const count = await dispatchOutboxQueue();
      if (count > 0) {
        console.log(`[Scheduler] Dispatched ${count} pending notification(s).`);
      }
    } catch (error) {
      console.error('[Scheduler] Outbox worker sweep error:', error.message);
    }
  });

  // Monthly PDF Financial Report Dispatch — fires on the 1st of each month at 8:00 AM
  cron.schedule('0 8 1 * *', async () => {
    console.log('[Scheduler] Running monthly PDF report dispatch...');
    try {
      const count = await dispatchMonthlyPdfReports();
      console.log(`[Scheduler] Monthly PDF reports dispatched to ${count} user(s).`);
    } catch (error) {
      console.error('[Scheduler] Monthly PDF dispatch error:', error.message);
    }
  });

  // Monthly WhatsApp Financial Summary Automation — fires on the 1st of each month at 9:00 AM
  cron.schedule('0 9 1 * *', async () => {
    console.log('[Scheduler] Running monthly WhatsApp summaries automation...');
    try {
      const count = await dispatchMonthlyWhatsAppSummaries();
      console.log(`[Scheduler] Monthly WhatsApp summaries queued for ${count} user(s).`);
    } catch (error) {
      console.error('[Scheduler] Monthly WhatsApp summaries error:', error.message);
    }
  });

  // GDPR Data Retention Purge: Runs every Sunday at midnight
  cron.schedule('0 0 * * 0', async () => {
    console.log('[Scheduler] Running scheduled GDPR data retention sweep...');
    try {
      await runDataRetentionPurge();
    } catch (error) {
      console.error('[Scheduler] Scheduled GDPR data retention sweep error:', error.message);
    }
  });

  console.log('[Scheduler] Background cron scheduler registered successfully.');
};


/**
 * Sweeps active loans, generates due alert messages, and queues them in the Outbox.
 * Alerts are scheduled if a loan is due today or in exactly 3 days.
 * 
 * @returns {Promise<number>} - Number of notifications queued
 */
const checkAndQueueLoans = async () => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const loans = await Loan.find({ status: 'active' }).populate('userId');
  let queuedCount = 0;

  for (const loan of loans) {
    if (!loan.userId || !loan.userId.telegramChatId) {
      continue;
    }

    const dueDate = new Date(loan.nextDueDate);
    dueDate.setHours(0, 0, 0, 0);

    const diffTime = dueDate.getTime() - today.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    // Send notifications if the loan is due today (0 days) or in exactly 3 days
    if (diffDays === 0 || diffDays === 3) {
      const geo = loan.userId && typeof loan.userId === 'object' ? loan.userId.geo : 'IN';
      const { symbol, locale } = getGeoFormatting(geo);

      const dueDateStr = new Date(loan.nextDueDate).toLocaleDateString(locale, {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      });

      const message = `🔔 <b>EMI Due Reminder</b>

Hello! This is a reminder regarding your upcoming EMI payment:

🏛️ <b>Provider:</b> ${loan.provider}
📋 <b>Loan Type:</b> ${loan.loanType}
💰 <b>EMI Amount:</b> ${symbol}${loan.emiAmount.toLocaleString(locale)}
📅 <b>Due Date:</b> ${dueDateStr}
⌛ <b>Time Left:</b> ${diffDays === 0 ? 'Due Today!' : `In ${diffDays} day(s)`}

<i>Please ensure your account has sufficient funds for the auto-debit transfer.</i>`;

      // Check if this exact alert is already queued/pending to prevent duplicates
      const existing = await NotificationOutbox.findOne({
        userId: loan.userId._id,
        loanId: loan._id,
        status: 'pending',
        message: message,
      });

      if (!existing) {
        await NotificationOutbox.create({
          userId: loan.userId._id,
          loanId: loan._id,
          chatId: loan.userId.telegramChatId,
          message: message,
        });
        queuedCount++;
      }
    }
  }

  return queuedCount;
};

import { sendWhatsAppMessage } from './whatsappService.js';

/**
 * Sweeps the NotificationOutbox and attempts to send pending or failed entries (max 5 attempts).
 * 
 * @returns {Promise<number>} - Number of notifications successfully sent
 */
export const dispatchOutboxQueue = async () => {
  const pendingNotifications = await NotificationOutbox.find({
    status: { $in: ['pending', 'failed'] },
    attempts: { $lt: 5 },
  }).populate('userId');

  let sentCount = 0;

  for (const notification of pendingNotifications) {
    notification.attempts += 1;

    const user = notification.userId;
    let success = false;
    let dispatchError = null;

    if (user && user.notificationChannel === 'WhatsApp') {
      const waNumber = user.whatsappNumber || notification.chatId;
      try {
        const cleanMsg = notification.message
          .replace(/<br\s*\/?>/gi, '\n')
          .replace(/<[^>]*>/g, ''); // Strip HTML tags for clean WhatsApp text formatting
        const waResult = await sendWhatsAppMessage(waNumber, cleanMsg);
        success = waResult.success;
      } catch (err) {
        dispatchError = err.message;
      }
    } else {
      success = await sendTelegramMessage(notification.chatId, notification.message);
      if (!success) {
        dispatchError = 'Telegram Bot API request rejected or timeout.';
      }
    }

    if (success) {
      notification.status = 'sent';
      notification.sentAt = new Date();
      notification.lastError = null;
      sentCount++;
    } else {
      notification.status = 'failed';
      notification.lastError = dispatchError || 'Unknown dispatch error.';
    }

    await notification.save();
  }

  return sentCount;
};

/**
 * Helper to execute a manual sweep (queues notifications for anything due in the next 7 days for test purposes).
 * Triggers outbox dispatch immediately.
 * 
 * @returns {Promise<number>} - Number of notifications successfully processed
 */
export const runManualSweep = async () => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const loans = await Loan.find({ status: 'active' }).populate('userId');
  let queuedCount = 0;

  for (const loan of loans) {
    if (!loan.userId || !loan.userId.telegramChatId) continue;

    const dueDate = new Date(loan.nextDueDate);
    dueDate.setHours(0, 0, 0, 0);

    const diffTime = dueDate.getTime() - today.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    // Queue anything due in the next 7 days for manual test sweeps
    if (diffDays >= 0 && diffDays <= 7) {
      const geo = loan.userId && typeof loan.userId === 'object' ? loan.userId.geo : 'IN';
      const { symbol, locale } = getGeoFormatting(geo);

      const dueDateStr = new Date(loan.nextDueDate).toLocaleDateString(locale, {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      });

      const message = `🔔 <b>EMI Due Reminder (Test Sweep)</b>

Hello! This is a manual test reminder regarding your upcoming EMI payment:

🏛️ <b>Provider:</b> ${loan.provider}
📋 <b>Loan Type:</b> ${loan.loanType}
💰 <b>EMI Amount:</b> ${symbol}${loan.emiAmount.toLocaleString(locale)}
📅 <b>Due Date:</b> ${dueDateStr}
⌛ <b>Time Left:</b> ${diffDays === 0 ? 'Due Today!' : `In ${diffDays} day(s)`}

<i>Please ensure your account has sufficient funds for the auto-debit transfer.</i>`;

      const existing = await NotificationOutbox.findOne({
        userId: loan.userId._id,
        loanId: loan._id,
        status: 'pending',
        message: message,
      });

      if (!existing) {
        await NotificationOutbox.create({
          userId: loan.userId._id,
          loanId: loan._id,
          chatId: loan.userId.telegramChatId,
          message: message,
        });
        queuedCount++;
      }
    }
  }

  // Immediately invoke dispatch sweep if new alerts were queued
  if (queuedCount > 0) {
    await dispatchOutboxQueue();
  }

  return queuedCount;
};

/**
 * Compiles and emails a personalized financial intelligence PDF report to every user.
 * Fired by the monthly cron on the 1st of each month at 08:00.
 * @returns {Promise<number>} Number of emails dispatched
 */
export const dispatchMonthlyPdfReports = async () => {
  const users = await User.find({ email: { $exists: true, $ne: '' } });
  let dispatchedCount = 0;

  for (const user of users) {
    try {
      const loans = await Loan.find({ userId: user._id, status: 'active' });
      const assets = await Asset.find({ userId: user._id });
      const subscriptions = await Subscription.find({ userId: user._id });

      // Calculate net worth snapshot
      const totalAssets = assets.reduce((sum, a) => sum + (a.currentValue || 0), 0);
      const totalLiabilities = loans.reduce((sum, l) => sum + (l.outstandingBalance || 0), 0);
      const netWorth = totalAssets - totalLiabilities;

      // Calculate total loan health score (simplified)
      const totalEmi = loans.reduce((sum, l) => sum + l.emiAmount, 0);
      const income = user.monthlyIncome || 50000;
      const dtiRatio = income > 0 ? Math.min(((totalEmi / income) * 100).toFixed(1), 100) : 0;
      const healthScore = Math.max(0, Math.min(100, Math.round(100 - dtiRatio * 0.7)));
      const defaultRisk = healthScore >= 75 ? 'low' : healthScore >= 50 ? 'moderate' : 'high';

      // Subscription burn
      const subscriptionsBurn = subscriptions.reduce((sum, s) => sum + (s.amount || 0), 0);

      const reportData = {
        userId: user._id.toString(),
        loans,
        netWorthData: { totalAssets, totalLiabilities, netWorth },
        subscriptionsCount: subscriptions.length,
        subscriptionsBurn,
        healthData: { score: healthScore, debtToIncomeRatio: dtiRatio, defaultRisk },
      };

      // Generate PDF buffer in-memory using PassThrough stream
      const { PassThrough } = await import('stream');
      const pdfBuffer = await new Promise((resolve, reject) => {
        const pass = new PassThrough();
        const chunks = [];
        pass.on('data', chunk => chunks.push(chunk));
        pass.on('end', () => resolve(Buffer.concat(chunks)));
        pass.on('error', reject);
        try {
          generateFinancialReportPDF(reportData, pass);
        } catch (pdfErr) {
          reject(pdfErr);
        }
      });

      const month = new Date().toLocaleString('default', { month: 'long', year: 'numeric' });
      await sendEmailReport(
        user.email,
        `📊 Your Monthly Financial Intelligence Report — ${month}`,
        `Hello ${user.name || user.email},\n\nPlease find attached your AI-generated monthly financial intelligence report for ${month}.\n\nThis report includes:\n• Active loan portfolio summary\n• Net worth snapshot\n• SaaS subscription burn rate\n• Credit health score\n\nStay on top of your finances with EMI Tracker AI.\n\n— EMI Tracker AI Team`,
        pdfBuffer
      );

      if (user.whatsappNumber) {
        const waMsg = `📊 *Monthly Financial Intelligence Summary (${month})*\n\nHello ${user.name || 'there'},\nYour monthly report PDF has been emailed to ${user.email}.\n\n*Key Highlights*:\n• *Net Worth*: ₹${netWorth.toLocaleString()}\n• *Active Loans*: ${loans.length}\n• *Credit Health*: ${healthScore}/100 (${defaultRisk.toUpperCase()} Risk)\n• *SaaS Subscriptions*: ₹${subscriptionsBurn.toLocaleString()}/mo\n\nTrack more on your dashboard.`;
        await sendWhatsAppMessage(user.whatsappNumber, waMsg);
      }

      dispatchedCount++;
      console.log(`[Monthly Reports] PDF dispatched to ${user.email}`);
    } catch (err) {
      console.error(`[Monthly Reports] Failed for user ${user._id}:`, err.message);
    }
  }

  return dispatchedCount;
};

/**
 * Compiles and queues a monthly financial summary WhatsApp message for every user with a registered WhatsApp number.
 * Fired by cron on the 1st of each month at 9:00 AM.
 * @returns {Promise<number>} Number of summaries queued
 */
export const dispatchMonthlyWhatsAppSummaries = async () => {
  const users = await User.find({ whatsappNumber: { $exists: true, $ne: '' } });
  let queuedCount = 0;

  const now = new Date();
  // Start and end of previous month
  const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);

  for (const user of users) {
    try {
      const userLoans = await Loan.find({ userId: user._id, status: 'active' });
      const loanIds = userLoans.map(l => l._id);

      // Query payments recorded in the previous month
      const payments = await LoanPayment.find({
        loanId: { $in: loanIds },
        paymentDate: { $gte: prevMonthStart, $lte: prevMonthEnd },
        paymentStatus: 'success',
      });

      const emisPaid = payments.length;
      const principalPaid = payments.reduce((sum, p) => sum + p.principalPaid, 0);
      const interestPaid = payments.reduce((sum, p) => sum + p.interestPaid, 0);
      const outstandingDebt = userLoans.reduce((sum, l) => sum + l.outstandingBalance, 0);

      // Compute Credit score and rating
      const score = calculateCreditScore(user, userLoans);
      let creditHealth = 'Needs Work';
      if (score >= 750) creditHealth = 'Excellent';
      else if (score >= 700) creditHealth = 'Good';
      else if (score >= 650) creditHealth = 'Fair';

      const message = `📊 *Monthly Loan Summary*\n\n*EMIs Paid*:\n${emisPaid}\n\n*Principal Paid*:\n₹${principalPaid.toLocaleString('en-IN')}\n\n*Interest Paid*:\n₹${interestPaid.toLocaleString('en-IN')}\n\n*Outstanding Debt*:\n₹${outstandingDebt.toLocaleString('en-IN')}\n\n*Credit Health*:\n${creditHealth}`;

      await queueWhatsAppMessage({
        userId: user._id,
        to: user.whatsappNumber,
        type: 'message',
        message: message,
      });

      queuedCount++;
      console.log(`[Monthly WhatsApp Summaries] Queued monthly summary for ${user.email}`);
    } catch (err) {
      console.error(`[Monthly WhatsApp Summaries] Failed for user ${user._id}:`, err.message);
    }
  }

  return queuedCount;
};

/**
 * Purges expired, revoked, or non-consented logs and user accounts in accordance with GDPR compliance.
 */
export const runDataRetentionPurge = async () => {
  console.log('[Data Retention] Running scheduled GDPR retention purges...');
  
  try {
    // 1. Purge all users (and their data) who have revoked processing consent
    const revokedUsers = await User.find({ consentProcessing: false });
    for (const user of revokedUsers) {
      const userId = user._id;
      console.log(`[Data Retention] Purging user ${user.email} due to revoked processing consent.`);
      
      await Loan.deleteMany({ userId });
      await Asset.deleteMany({ userId });
      await Goal.deleteMany({ userId });
      await Subscription.deleteMany({ userId });
      await Transaction.deleteMany({ userId });
      await FraudAlert.deleteMany({ userId });
      
      await User.findByIdAndDelete(userId);
    }

    // 2. Purge analytics data for users who have revoked analytics consent
    const revokedAnalyticsUsers = await User.find({ consentAnalytics: false });
    const revokedAnalyticsUserIds = revokedAnalyticsUsers.map(u => u._id);
    if (revokedAnalyticsUserIds.length > 0) {
      await AnalyticsEvent.deleteMany({ userId: { $in: revokedAnalyticsUserIds } });
    }

    // 3. Purge logs older than 90 days
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    
    const smsPurged = await SmsLog.deleteMany({ createdAt: { $lt: ninetyDaysAgo } });
    const waPurged = await WhatsAppLog.deleteMany({ createdAt: { $lt: ninetyDaysAgo } });
    const emailPurged = await EmailLog.deleteMany({ createdAt: { $lt: ninetyDaysAgo } });
    const pushPurged = await PushNotificationLog.deleteMany({ createdAt: { $lt: ninetyDaysAgo } });
    const parseLogsPurged = await DocumentParseLog.deleteMany({ createdAt: { $lt: ninetyDaysAgo } });

    console.log(`[Data Retention] Purge completed successfully.`);
    console.log(`- Revoked users purged: ${revokedUsers.length}`);
    console.log(`- SMS Logs purged: ${smsPurged.deletedCount}`);
    console.log(`- WhatsApp Logs purged: ${waPurged.deletedCount}`);
    console.log(`- Email Logs purged: ${emailPurged.deletedCount}`);
    console.log(`- Push Logs purged: ${pushPurged.deletedCount}`);
    console.log(`- Parse Logs purged: ${parseLogsPurged.deletedCount}`);

  } catch (error) {
    console.error('[Data Retention] Purge execution error:', error.message);
  }
};

