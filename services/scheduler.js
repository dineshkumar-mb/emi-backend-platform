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
import NotificationLog from '../models/NotificationLog.js';
import { WhatsAppTemplates, replacePlaceholders } from '../templates/whatsappTemplates.js';

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
 * Sweep function to find active loans due tomorrow and dispatch reminders.
 */
export const runDueTomorrowSweep = async () => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const loans = await Loan.find({ status: 'active' }).populate('userId');
  let queuedCount = 0;

  for (const loan of loans) {
    if (!loan.userId) continue;
    const user = loan.userId;

    const userPrefs = user.notificationSettings || {};
    if (userPrefs.emiReminders === false) continue;

    const dueDate = new Date(loan.nextDueDate);
    dueDate.setHours(0, 0, 0, 0);

    const diffTime = dueDate.getTime() - today.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays === 1) { // Tomorrow
      const geo = user.geo || 'IN';
      const { symbol, locale } = getGeoFormatting(geo);
      const dueDateStr = dueDate.toLocaleDateString(locale, {
        day: 'numeric',
        month: 'long',
        year: 'numeric'
      });

      const messageText = replacePlaceholders(WhatsAppTemplates.EMI_DUE_TOMORROW, {
        name: user.name || 'Customer',
        emiAmount: loan.emiAmount.toLocaleString(locale),
        loanName: `${loan.provider} ${loan.loanType}`,
        dueDate: dueDateStr
      });

      const existing = await NotificationOutbox.findOne({
        userId: user._id,
        loanId: loan._id,
        template: 'EMI_DUE_TOMORROW',
        status: 'pending'
      });

      if (!existing) {
        await NotificationOutbox.create({
          userId: user._id,
          loanId: loan._id,
          template: 'EMI_DUE_TOMORROW',
          chatId: user.notificationChannel === 'WhatsApp' ? (user.whatsappNumber || '') : (user.telegramChatId || ''),
          message: messageText,
        });
        queuedCount++;
      }
    }
  }
  return queuedCount;
};

/**
 * Sweep function to find active loans due today and dispatch reminders.
 */
export const runDueTodaySweep = async () => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const loans = await Loan.find({ status: 'active' }).populate('userId');
  let queuedCount = 0;

  for (const loan of loans) {
    if (!loan.userId) continue;
    const user = loan.userId;

    const userPrefs = user.notificationSettings || {};
    if (userPrefs.emiReminders === false) continue;

    const dueDate = new Date(loan.nextDueDate);
    dueDate.setHours(0, 0, 0, 0);

    const diffTime = dueDate.getTime() - today.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays === 0) { // Today
      const geo = user.geo || 'IN';
      const { symbol, locale } = getGeoFormatting(geo);

      const messageText = replacePlaceholders(WhatsAppTemplates.EMI_DUE_TODAY, {
        emiAmount: loan.emiAmount.toLocaleString(locale),
        loanName: `${loan.provider} ${loan.loanType}`
      });

      const existing = await NotificationOutbox.findOne({
        userId: user._id,
        loanId: loan._id,
        template: 'EMI_DUE_TODAY',
        status: 'pending'
      });

      if (!existing) {
        await NotificationOutbox.create({
          userId: user._id,
          loanId: loan._id,
          template: 'EMI_DUE_TODAY',
          chatId: user.notificationChannel === 'WhatsApp' ? (user.whatsappNumber || '') : (user.telegramChatId || ''),
          message: messageText,
        });
        queuedCount++;
      }
    }
  }
  return queuedCount;
};

/**
 * Sweep function to find overdue active loans and dispatch warnings.
 */
export const runOverdueSweep = async () => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const loans = await Loan.find({ status: 'active' }).populate('userId');
  let queuedCount = 0;

  for (const loan of loans) {
    if (!loan.userId) continue;
    const user = loan.userId;

    const userPrefs = user.notificationSettings || {};
    if (userPrefs.overdueAlerts === false) continue;

    const dueDate = new Date(loan.nextDueDate);
    dueDate.setHours(0, 0, 0, 0);

    if (today > dueDate) { // Overdue
      const diffTime = today.getTime() - dueDate.getTime();
      const days = Math.floor(diffTime / (1000 * 60 * 60 * 24));

      if (days > 0) {
        const geo = user.geo || 'IN';
        const { symbol, locale } = getGeoFormatting(geo);

        const messageText = replacePlaceholders(WhatsAppTemplates.MISSED_PAYMENT, {
          loanName: `${loan.provider} ${loan.loanType}`,
          emiAmount: loan.emiAmount.toLocaleString(locale),
          days: days.toString()
        });

        const existing = await NotificationOutbox.findOne({
          userId: user._id,
          loanId: loan._id,
          template: 'MISSED_PAYMENT',
          status: 'pending'
        });

        if (!existing) {
          await NotificationOutbox.create({
            userId: user._id,
            loanId: loan._id,
            template: 'MISSED_PAYMENT',
            chatId: user.notificationChannel === 'WhatsApp' ? (user.whatsappNumber || '') : (user.telegramChatId || ''),
            message: messageText,
          });
          queuedCount++;
        }
      }
    }
  }
  return queuedCount;
};

/**
 * Sweep function to generate and queue monthly loan summaries for all users.
 */
export const runMonthlySummarySweep = async () => {
  const users = await User.find({ whatsappNumber: { $exists: true, $ne: '' } });
  let queuedCount = 0;

  const now = new Date();
  const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);

  for (const user of users) {
    try {
      const userPrefs = user.notificationSettings || {};
      if (userPrefs.monthlyReports === false) continue;

      const userLoans = await Loan.find({ userId: user._id, status: 'active' });
      const loanIds = userLoans.map(l => l._id);

      const payments = await LoanPayment.find({
        loanId: { $in: loanIds },
        paymentDate: { $gte: prevMonthStart, $lte: prevMonthEnd },
        paymentStatus: 'success',
      });

      const totalPaidLastMonth = payments.reduce((sum, p) => sum + p.emiAmount, 0);
      const outstandingBalance = userLoans.reduce((sum, l) => sum + l.outstandingBalance, 0);

      const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const currentMonthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
      const upcomingEmiCount = userLoans.filter(l => {
        const d = new Date(l.nextDueDate);
        return d >= currentMonthStart && d <= currentMonthEnd;
      }).length;

      const messageText = replacePlaceholders(WhatsAppTemplates.MONTHLY_SUMMARY, {
        activeLoans: userLoans.length.toString(),
        outstanding: outstandingBalance.toLocaleString('en-IN'),
        paid: totalPaidLastMonth.toLocaleString('en-IN'),
        upcoming: upcomingEmiCount.toString()
      });

      const existing = await NotificationOutbox.findOne({
        userId: user._id,
        template: 'MONTHLY_SUMMARY',
        status: 'pending'
      });

      if (!existing) {
        await NotificationOutbox.create({
          userId: user._id,
          template: 'MONTHLY_SUMMARY',
          chatId: user.notificationChannel === 'WhatsApp' ? (user.whatsappNumber || '') : (user.telegramChatId || ''),
          message: messageText,
        });
        queuedCount++;
      }
    } catch (err) {
      console.error(`[Monthly Sweep] Error for user ${user._id}:`, err.message);
    }
  }
  return queuedCount;
};

/**
 * Sweep function to compile weekly smart financial tips for all users.
 */
export const runFinancialTipsSweep = async () => {
  const users = await User.find({ whatsappNumber: { $exists: true, $ne: '' } });
  let queuedCount = 0;

  for (const user of users) {
    try {
      const userPrefs = user.notificationSettings || {};
      if (userPrefs.financialTips === false) continue;

      const userLoans = await Loan.find({ userId: user._id, status: 'active' });
      if (userLoans.length === 0) continue;

      const highestInterestLoan = userLoans.reduce((prev, current) => {
        return (prev.interestRate > current.interestRate) ? prev : current;
      });

      const extraPayment = 500;
      const potentialMonthsSaved = Math.min(12, Math.round(highestInterestLoan.outstandingBalance / (highestInterestLoan.emiAmount * 10)));
      
      const currentRate = highestInterestLoan.interestRate;
      let savingsText = '';
      if (currentRate > 10) {
        const potentialSavings = Math.round(highestInterestLoan.outstandingBalance * (currentRate - 8.5) * 0.01);
        savingsText = `Refinancing your ${highestInterestLoan.provider} ${highestInterestLoan.loanType} (currently @ ${currentRate}%) to a lower rate could save you around ₹${potentialSavings.toLocaleString('en-IN')} annually!`;
      } else {
        savingsText = `Paying ₹${extraPayment} extra monthly on your ${highestInterestLoan.provider} ${highestInterestLoan.loanType} can help you close this loan ${potentialMonthsSaved} months earlier!`;
      }

      const messageText = replacePlaceholders(WhatsAppTemplates.CREDIT_TIPS, {
        name: user.name || 'there',
        insightMessage: savingsText
      });

      const existing = await NotificationOutbox.findOne({
        userId: user._id,
        template: 'CREDIT_TIPS',
        status: 'pending'
      });

      if (!existing) {
        await NotificationOutbox.create({
          userId: user._id,
          template: 'CREDIT_TIPS',
          chatId: user.notificationChannel === 'WhatsApp' ? (user.whatsappNumber || '') : (user.telegramChatId || ''),
          message: messageText,
        });
        queuedCount++;
      }
    } catch (err) {
      console.error(`[Financial Tips Sweep] Error for user ${user._id}:`, err.message);
    }
  }
  return queuedCount;
};

/**
 * Initializes the background cron scheduler.
 */
export const initScheduler = () => {
  // 1. Due Tomorrow sweep: daily at 9:00 AM
  cron.schedule('0 9 * * *', async () => {
    console.log('[Scheduler] Running daily 9:00 AM sweep (due tomorrow)...');
    try {
      const count = await runDueTomorrowSweep();
      console.log(`[Scheduler] Due Tomorrow sweep processed ${count} reminder(s).`);
    } catch (error) {
      console.error('[Scheduler] Due Tomorrow sweep error:', error.message);
    }
  });

  // 2. Due Today sweep: daily at 8:00 AM
  cron.schedule('0 8 * * *', async () => {
    console.log('[Scheduler] Running daily 8:00 AM sweep (due today)...');
    try {
      const count = await runDueTodaySweep();
      console.log(`[Scheduler] Due Today sweep processed ${count} reminder(s).`);
    } catch (error) {
      console.error('[Scheduler] Due Today sweep error:', error.message);
    }
  });

  // 3. Overdue sweep: daily at 10:00 AM
  cron.schedule('0 10 * * *', async () => {
    console.log('[Scheduler] Running daily 10:00 AM sweep (overdue)...');
    try {
      const count = await runOverdueSweep();
      console.log(`[Scheduler] Overdue sweep processed ${count} alert(s).`);
    } catch (error) {
      console.error('[Scheduler] Overdue sweep error:', error.message);
    }
  });

  // 4. Monthly loan summary: monthly on the 1st day at 9:30 AM
  cron.schedule('30 9 1 * *', async () => {
    console.log('[Scheduler] Running monthly summary sweep...');
    try {
      const count = await runMonthlySummarySweep();
      console.log(`[Scheduler] Monthly summary sweep queued for ${count} user(s).`);
    } catch (error) {
      console.error('[Scheduler] Monthly summary sweep error:', error.message);
    }
  });

  // 5. Weekly financial tips sweep: weekly on Monday at 9:00 AM
  cron.schedule('0 9 * * 1', async () => {
    console.log('[Scheduler] Running weekly financial tips sweep...');
    try {
      const count = await runFinancialTipsSweep();
      console.log(`[Scheduler] Weekly financial tips sweep queued for ${count} user(s).`);
    } catch (error) {
      console.error('[Scheduler] Weekly financial tips sweep error:', error.message);
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
        if (!success) dispatchError = waResult.error;
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

    // Log the event to NotificationLog for tracking & analytics
    await NotificationLog.create({
      userId: user ? user._id : notification.userId,
      phone: (user && user.notificationChannel === 'WhatsApp' ? user.whatsappNumber : user?.telegramChatId) || notification.chatId || '0000000000',
      template: notification.template || 'OUTBOX_NOTIFICATION',
      message: notification.message,
      loanId: notification.loanId || null,
      status: success ? 'delivered' : 'failed',
      sentAt: notification.createdAt,
      deliveredAt: success ? new Date() : null,
      failedReason: success ? null : (dispatchError || 'Unknown dispatch error.'),
    });
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
  console.log('[Manual Sweep] Running manual sweeps...');
  let totalQueued = 0;
  totalQueued += await runDueTomorrowSweep();
  totalQueued += await runDueTodaySweep();
  totalQueued += await runOverdueSweep();

  if (totalQueued > 0) {
    await dispatchOutboxQueue();
  }

  return totalQueued;
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

