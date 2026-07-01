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
import { getQueue } from '../utils/queueManager.js';
import { buildDueTomorrowPipeline, buildDueTodayPipeline, buildOverduePipeline, buildDueIn3DaysPipeline } from './aggregations/loanNotificationPipelines.js';
import { queueNewsCrawl } from './newsScheduler.js';


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
 * Generic sweep runner.
 * Runs an aggregation pipeline, inserts Outbox records in bulk,
 * then enqueues each record to BullMQ for parallel dispatch.
 *
 * @param {string}   sweepName  - Label for logs
 * @param {Array}    pipeline   - MongoDB aggregation pipeline
 * @param {string}   template   - WhatsApp template name (passed to worker)
 */
async function runSweep(sweepName, pipeline, template) {
  const startTime = Date.now();
  console.log(`[Scheduler] Starting sweep: ${sweepName}`);

  try {
    // 1. Run DB-side aggregation — only matching loans returned
    const loans = await Loan.aggregate(pipeline);

    if (!loans.length) {
      console.log(`[Scheduler] ${sweepName}: 0 loans matched. Skipping.`);
      return 0;
    }

    console.log(`[Scheduler] ${sweepName}: ${loans.length} loans matched.`);

    // 2. Deduplicate — skip loans already in Outbox for today
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const existingOutbox = await NotificationOutbox.distinct('loanId', {
      notificationType: template,
      createdAt: { $gte: today }
    });
    const existingSet = new Set(existingOutbox.map(id => id.toString()));
    const newLoans = loans.filter(l => !existingSet.has(l.loanId.toString()));

    if (!newLoans.length) {
      console.log(`[Scheduler] ${sweepName}: All loans already in outbox today. Skipping.`);
      return 0;
    }

    // 3. Bulk insert into Outbox
    const outboxDocs = newLoans.map(loan => ({
      loanId: loan.loanId,
      userId: loan.userId,
      phone: loan.phone,
      notificationType: loan.notificationType,
      payload: loan,          // full context for the AI agent and template selector
      status: 'PENDING',
      createdAt: new Date()
    }));

    const inserted = await NotificationOutbox.insertMany(outboxDocs, { ordered: false });
    console.log(`[Scheduler] ${sweepName}: Inserted ${inserted.length} outbox records.`);

    // 4. Enqueue each record to BullMQ (non-blocking — workers handle concurrency)
    const notificationsQueue = getQueue('notifications');
    const jobs = inserted.map(doc => ({
      name: 'whatsapp-notification',
      data: {
        outboxId: doc._id.toString(),
        template,
        payload: doc.payload
      },
      opts: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: 100,
        removeOnFail: 200
      }
    }));

    await notificationsQueue.addBulk(jobs);
    console.log(`[Scheduler] ${sweepName}: Enqueued ${jobs.length} jobs to BullMQ.`);
    return inserted.length;

  } catch (error) {
    console.error(`[Scheduler] ${sweepName} failed:`, error);
    return 0;
  } finally {
    const elapsed = Date.now() - startTime;
    console.log(`[Scheduler] ${sweepName} completed in ${elapsed}ms`);
  }
}

// ─── PUBLIC SWEEP FUNCTIONS (called by cron) ──────────────────────────────────

export const runDueTomorrowSweep = async () => {
  return await runSweep(
    'DueTomorrowSweep',
    buildDueTomorrowPipeline(),
    'DUE_TOMORROW'
  );
};

export const runDueTodaySweep = async () => {
  return await runSweep(
    'DueTodaySweep',
    buildDueTodayPipeline(),
    'DUE_TODAY'
  );
};

export const runOverdueSweep = async () => {
  return await runSweep(
    'OverdueSweep',
    buildOverduePipeline(),
    'OVERDUE'
  );
};

export const runDueIn3DaysSweep = async () => {
  return await runSweep(
    'DueIn3DaysSweep',
    buildDueIn3DaysPipeline(),
    'DUE_IN_3_DAYS'
  );
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

  // 1.5 Due In 3 Days sweep: daily at 9:15 AM
  cron.schedule('15 9 * * *', async () => {
    console.log('[Scheduler] Running daily 9:15 AM sweep (due in 3 days)...');
    try {
      const count = await runDueIn3DaysSweep();
      console.log(`[Scheduler] Due In 3 Days sweep processed ${count} reminder(s).`);
    } catch (error) {
      console.error('[Scheduler] Due In 3 Days sweep error:', error.message);
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

/**
 * Helper to execute a manual sweep (queues notifications for anything due in the next 7 days for test purposes).
 * Triggers outbox dispatch immediately via BullMQ (happens automatically after enqueue).
 * 
 * @returns {Promise<number>} - Number of notifications successfully processed
 */
export const runManualSweep = async () => {
  console.log('[Manual Sweep] Running manual sweeps...');
  let totalQueued = 0;
  totalQueued += await runDueIn3DaysSweep();
  totalQueued += await runDueTomorrowSweep();
  totalQueued += await runDueTodaySweep();
  totalQueued += await runOverdueSweep();

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

/**
 * Initialize all automated cron schedules.
 */
export const startScheduler = () => {
  console.log('[Scheduler] Initializing automated background cron jobs...');
  
  // Daily Sweeps at 9:00 AM
  cron.schedule('0 9 * * *', async () => {
    console.log('[Scheduler] Running 9:00 AM daily sweeps...');
    await runDueTodaySweep();
    await runDueTomorrowSweep();
    await runDueIn3DaysSweep();
  });

  // Overdue Sweep at 9:30 AM
  cron.schedule('30 9 * * *', async () => {
    console.log('[Scheduler] Running 9:30 AM overdue sweep...');
    await runOverdueSweep();
  });

  // Monthly Summaries at 10:00 AM on the 1st
  cron.schedule('0 10 1 * *', async () => {
    console.log('[Scheduler] Running monthly summary sweep...');
    await runMonthlySummarySweep();
  });

  // Data Retention Purge at 2:00 AM daily
  cron.schedule('0 2 * * *', async () => {
    console.log('[Scheduler] Running daily data retention purge...');
    await runDataRetentionPurge();
  });

  // Financial News Crawl every 6 hours
  cron.schedule('0 */6 * * *', async () => {
    console.log('[Scheduler] Running 6-hour financial news crawl...');
    await queueNewsCrawl();
  });

  console.log('[Scheduler] Automated cron jobs initialized.');
};
