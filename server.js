import './utils/otel.js';
import express from 'express';
import dotenv from 'dotenv';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import multer from 'multer';
import { rateLimit } from 'express-rate-limit';
import crypto from 'crypto';
import * as Sentry from '@sentry/node';
import mongoose from 'mongoose';
import { structuredLogger } from './middleware/loggingMiddleware.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import swaggerUi from 'swagger-ui-express';
import helmet from 'helmet';
import { apiThrottler, authLimiter, aiLimiter, uploadLimiter } from './middleware/rateLimiter.js';
import { uploadSecurityMiddleware } from './middleware/uploadSecurity.js';
import { metricsMiddleware, register } from './utils/metrics.js';
import { authorize } from './middleware/rbacMiddleware.js';
import { initOpenWA, getSessionUuid } from './services/openwaClient.js';
import { WhatsAppTemplates, replacePlaceholders } from './templates/whatsappTemplates.js';
import { queueWhatsAppMessage } from './services/whatsappAutomationService.js';
import { startScheduler } from './services/scheduler.js';
import cronRoutes from './routes/cronRoutes.js';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const swaggerDocument = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'swagger.json'), 'utf8')
);

// Initialize Sentry logging
Sentry.init({
  dsn: process.env.SENTRY_DSN || '',
  tracesSampleRate: 1.0,
  skipOpenTelemetrySetup: true,
});

import connectDB from './config/db.js';
import { protect, requireAdmin, checkLoanOwnership, verifyDeviceSignature } from './middleware/authMiddleware.js';
import User from './models/User.js';
import Loan from './models/Loan.js';
import DocumentParseLog from './models/DocumentParseLog.js';
import NotificationLog from './models/NotificationLog.js';

// Route Imports
import {
  registerUser,
  loginUser,
  logoutUser,
  getUserProfile,
  deleteUserProfile,
  exportUserData,
  refreshSession,
  registerTrustedDevice,
  updateConsent,
  forgotPassword,
  resetPassword,
} from './controllers/authController.js';
import {
  createLoan,
  getLoans,
  getLoanById,
  updateLoan,
  deleteLoan,
  prepayForecast,
  markPaid,
  uploadSmsText,
  recordPayment,
  getPayments,
  getPaymentHistory,
  detectAndProcessTransaction,
} from './controllers/loanController.js';

import {
  requestConsentController,
  getConsentStatusController,
  mockApproveConsentController,
  syncConsentDataController,
} from './controllers/consentController.js';

// Validator Imports
import {
  validateRequest,
  signupSchema,
  loginSchema,
  telegramSchema,
  registerKeySchema,
  loanSchema,
  parseSmsSchema,
  markPaidSchema,
  validatePaymentSchema,
  geoSchema,
  advisorSchema,
  assetSchema,
  goalSchema,
  subscriptionSchema,
  transactionSchema,
  feedbackSchema,
} from './middleware/validator.js';


// Services Imports
import { extractLoanFromFile, parseSmsWithGemini, validatePaymentWithGemini } from './services/geminiService.js';
import { sendWhatsAppTemplate, sendWhatsAppMessage } from './services/whatsappService.js';

// New Controller Imports
import {
  askAdvisor,
  getDebtFreeForecast,
  getHealthScore,
  analyzeStatement,
  getCreditPrediction,
  getWealthAdvice,
  downloadPdfReport,
  getFraudAlerts,
  resolveFraudAlert,
  scanTextForFraud,
  getNotificationCenterLogs,
  getSipPlan,
  getWealthProjection,
  uploadDocument,
  getDocuments,
  deleteDocument,
  deleteAllDocuments,
  clearNotificationCenterLogs,
} from './controllers/intelligenceController.js';
import {
  getAssets,
  createAsset,
  deleteAsset,
  getNetWorth,
} from './controllers/assetController.js';
import {
  getGoals,
  createGoal,
  deleteGoal,
} from './controllers/goalController.js';
import {
  getSubscriptions,
  createSubscription,
  deleteSubscription,
  detectSubscriptions,
} from './controllers/subscriptionController.js';
import {
  createFamily,
  inviteMember,
  shareLoan,
  shareAsset,
  getFamilies,
  getFamilyDashboard,
} from './controllers/familyController.js';
import { getForecastAnalytics, exportExcelReport } from './controllers/analyticsController.js';
import { getHealthStatus } from './controllers/healthController.js';
import newsRoutes from './routes/newsRoutes.js';

import { sendTelegramMessage } from './services/telegramService.js';
import { runManualSweep, dispatchMonthlyPdfReports } from './services/scheduler.js';
import { scanTransactionForFraud } from './services/fraudEngine.js';
import { createFeedback, getFeedback, createCrashReport, createAnalyticsEvent } from './controllers/supportController.js';

dotenv.config();

// Startup Environment Validation Checks
console.log('--- Environment Variables Status ---');
console.log(`MONGO_URI set: ${!!process.env.MONGO_URI}`);
console.log(`JWT_SECRET set: ${!!process.env.JWT_SECRET}`);
console.log(`GEMINI_API_KEY set: ${!!process.env.GEMINI_API_KEY}`);
if (process.env.MONGO_URI) {
  try {
    const parsedUrl = process.env.MONGO_URI.startsWith('mongodb+srv://') 
      ? new URL(process.env.MONGO_URI.replace('mongodb+srv://', 'http://'))
      : new URL(process.env.MONGO_URI);
    console.log(`MONGO_URI Host: ${parsedUrl.host}, Path: ${parsedUrl.pathname}`);
  } catch (e) {
    console.log(`MONGO_URI (masked): ${process.env.MONGO_URI.substring(0, 20)}...`);
  }
}
console.log('------------------------------------');

const requiredEnv = ['MONGO_URI', 'JWT_SECRET', 'GEMINI_API_KEY'];
const missingEnv = requiredEnv.filter(key => !process.env[key] || process.env[key] === 'PLACEHOLDER');
if (missingEnv.length > 0) {
  console.error(`🚨 CRITICAL STARTUP ERROR: Missing required environment variables: ${missingEnv.join(', ')}`);
  process.exit(1);
}

// Connect to Database
connectDB().then(() => {
  // Start the background cron scheduler for automated sweeps
  startScheduler();
}).catch(err => {
  console.error('⚠️ Database connection failed at startup. Server will run but DB features will fail:', err.message);
});

// Initialize Daily Cron Scheduler (Notification Outbox Worker)
// (Now handled inside connectDB().then block using startScheduler)

const app = express();

// Apply Helmet Security Headers
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://apis.google.com"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "https://*"],
      connectSrc: ["'self'", "http://localhost:5000", "ws://localhost:5173", "http://127.0.0.1:5000", "http://localhost:5000/metrics", "https://emi-backend-platform.vercel.app", "https://emi-frontend-platform.vercel.app"],
    },
  },
}));

// Apply Prometheus Metrics and Latency Tracker Middleware
app.use(metricsMiddleware);

// Prometheus Metrics Endpoint
app.get('/metrics', async (req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});

// Apply global API rate limiting throttling
app.use('/api', apiThrottler);

// Middlewares
const allowedOrigins = [
  'http://localhost:5173',
  'https://emi-frontend-platform.vercel.app'
];
app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(structuredLogger);

// Global Database Connection Middleware for Serverless Environment (Vercel)
// Ensures the DB is connected before any route attempts to query it.
app.use(async (req, res, next) => {
  try {
    await connectDB();
    next();
  } catch (error) {
    res.status(503).json({ message: 'Database connection failed. Please try again later.' });
  }
});

// Multer Storage Configuration (In-Memory parsing for statements)
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 } // Limit files to 10MB
});

// ── Auth Routes ───────────────────────────────────────────────────────────────

const authRouter = express.Router();
authRouter.post('/signup', authLimiter, validateRequest(signupSchema), registerUser);
authRouter.post('/login', authLimiter, validateRequest(loginSchema), loginUser);
authRouter.post('/logout', logoutUser);
authRouter.get('/profile', protect, getUserProfile);
authRouter.delete('/profile', protect, deleteUserProfile);
authRouter.get('/profile/export', protect, exportUserData);
authRouter.post('/refresh', refreshSession);
authRouter.post('/device/trust', protect, registerTrustedDevice);
authRouter.patch('/consent', protect, updateConsent);
authRouter.post('/forgotpassword', forgotPassword);
authRouter.put('/resetpassword/:resettoken', resetPassword);

// Update user Telegram settings
authRouter.patch('/telegram', protect, validateRequest(telegramSchema), async (req, res) => {
  const { telegramChatId } = req.body;
  try {
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    user.telegramChatId = telegramChatId;
    user.notificationChannel = 'Telegram'; // Auto switch to Telegram channel
    await user.save();
    res.json({ message: 'Telegram Chat ID saved and notification channel updated.', telegramChatId: user.telegramChatId, notificationChannel: user.notificationChannel });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Update user Geo settings
authRouter.patch('/geo', protect, validateRequest(geoSchema), async (req, res) => {
  const { geo } = req.body;
  try {
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    user.geo = geo;
    await user.save();
    res.json({ message: 'Geographic region saved successfully.', geo: user.geo });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Register user device public key for signing operations
authRouter.patch('/register-key', protect, validateRequest(registerKeySchema), async (req, res) => {
  const { publicKey } = req.body;
  try {
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    user.devicePublicKey = publicKey;
    await user.save();
    res.json({ message: 'Device public key registered successfully.', devicePublicKey: user.devicePublicKey });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Update user notification channel preference
authRouter.patch('/notification-channel', protect, async (req, res) => {
  const { notificationChannel } = req.body;
  if (!['Telegram', 'WhatsApp'].includes(notificationChannel)) {
    return res.status(400).json({ message: 'Invalid notification channel. Must be Telegram or WhatsApp.' });
  }
  try {
    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    user.notificationChannel = notificationChannel;
    await user.save();
    res.json({ message: 'Notification channel preference saved.', notificationChannel: user.notificationChannel });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Update user WhatsApp number
authRouter.patch('/whatsapp-number', protect, async (req, res) => {
  const { whatsappNumber } = req.body;
  if (typeof whatsappNumber !== 'string') {
    return res.status(400).json({ message: 'WhatsApp number must be a string.' });
  }
  try {
    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    user.whatsappNumber = whatsappNumber;
    user.notificationChannel = 'WhatsApp'; // Auto switch to WhatsApp channel
    await user.save();

    // Trigger Welcome Message immediately after linking
    const welcomeMsg = replacePlaceholders(WhatsAppTemplates.WELCOME, { name: user.name });
    const waResult = await sendWhatsAppMessage(whatsappNumber, welcomeMsg, user._id);
    
    // Log message to NotificationLog
    await NotificationLog.create({
      userId: user._id,
      phone: whatsappNumber,
      template: 'WELCOME',
      message: welcomeMsg,
      status: waResult.success ? 'delivered' : 'failed',
      sentAt: new Date(),
      deliveredAt: waResult.success ? new Date() : null,
      failedReason: waResult.success ? null : (waResult.error || 'Failed to dispatch message'),
    });

    res.json({ message: 'WhatsApp number saved and notification channel updated.', whatsappNumber: user.whatsappNumber, notificationChannel: user.notificationChannel });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Update user FCM token
authRouter.patch('/fcm-token', protect, async (req, res) => {
  const { fcmToken } = req.body;
  try {
    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    user.fcmToken = fcmToken;
    await user.save();
    res.json({ message: 'FCM token saved successfully.', fcmToken: user.fcmToken });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.use('/api/auth', authRouter);

// ── Loan Routes ───────────────────────────────────────────────────────────────

const loanRouter = express.Router();

// Endpoint to fetch and display the WhatsApp Web QR code for linking
loanRouter.get('/whatsapp-qr', async (req, res) => {
  try {
    // 1. Resolve the session UUID
    let uuid = getSessionUuid();
    
    if (!uuid) {
      // Fallback: fetch sessions list and find by name
      const listRes = await fetch('http://localhost:2785/api/sessions', {
        headers: {
          'X-API-Key': 'default_master_key_for_emi_tracker_999'
        }
      });
      if (listRes.ok) {
        const sessions = await listRes.json();
        const defaultSess = sessions.find(s => s.name === 'default-session');
        if (defaultSess) {
          uuid = defaultSess.id;
        }
      }
    }

    if (!uuid) {
      return res.send(`
        <html>
          <head>
            <title>Scan WhatsApp QR</title>
            <meta http-equiv="refresh" content="5">
          </head>
          <body style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:100vh; font-family:sans-serif; background:#121212; color:white; padding: 20px; text-align: center;">
            <h1>WhatsApp Session Info</h1>
            <p>Initializing gateway session... Please wait.</p>
            <p style="color: #666; font-size: 0.9em; margin-top: 20px;">Refreshing automatically in 5 seconds...</p>
          </body>
        </html>
      `);
    }

    // 2. Fetch session status
    const statusRes = await fetch(`http://localhost:2785/api/sessions/${uuid}`, {
      headers: {
        'X-API-Key': 'default_master_key_for_emi_tracker_999'
      }
    });

    let sessionInfo = null;
    if (statusRes.ok) {
      sessionInfo = await statusRes.json();
    }

    // 3. Fetch QR code
    const response = await fetch(`http://localhost:2785/api/sessions/${uuid}/qr`, {
      headers: {
        'X-API-Key': 'default_master_key_for_emi_tracker_999'
      }
    });
    
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      return res.send(`
        <html>
          <head>
            <title>Scan WhatsApp QR</title>
            <meta http-equiv="refresh" content="5">
          </head>
          <body style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:100vh; font-family:sans-serif; background:#121212; color:white; padding: 20px; text-align: center;">
            <h1>WhatsApp Session Info</h1>
            <div style="background:#222; padding: 20px; border-radius: 8px; margin: 20px 0; text-align: left; min-width: 300px; max-width: 500px;">
              <p><strong>Session Name:</strong> default-session</p>
              <p><strong>Session UUID:</strong> ${uuid}</p>
              <p><strong>Status:</strong> <span style="color: ${sessionInfo?.status === 'ready' ? '#4CAF50' : '#FFC107'}">${sessionInfo?.status || 'unknown'}</span></p>
              <p><strong>Engine:</strong> ${sessionInfo?.engine || 'baileys'}</p>
              <p><strong>Error Message:</strong> ${err.message || 'None'}</p>
            </div>
            ${sessionInfo?.status === 'disconnected' ? '<button onclick="fetch(\'/api/loans/whatsapp-qr/start\', {method:\'POST\'}).then(()=>location.reload())" style="background:#4CAF50; color:white; padding:10px 20px; border:none; border-radius:5px; cursor:pointer;">Start Session</button>' : ''}
            <p style="color: #666; font-size: 0.9em; margin-top: 20px;">Refreshing automatically in 5 seconds...</p>
          </body>
        </html>
      `);
    }

    const data = await response.json();
    res.send(`
      <html>
        <head>
          <title>Scan WhatsApp QR</title>
        </head>
        <body style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:100vh; font-family:sans-serif; background:#121212; color:white;">
          <h1 style="margin-bottom: 5px;">Link WhatsApp Account</h1>
          <p style="color: #aaa; margin-top: 0;">Scan this QR code using WhatsApp on your phone (Linked Devices)</p>
          <div style="background:white; padding:20px; border-radius:10px; margin-top:20px; box-shadow: 0 4px 20px rgba(0,0,0,0.5);">
            <img src="${data.qrCode}" style="width:300px; height:300px; display: block;" />
          </div>
          <p style="margin-top:20px; color:#888;">Session Status: <strong style="color: #FFC107;">${sessionInfo?.status || 'qr_ready'}</strong></p>
          <p style="color:#888; font-size:0.9em; margin-top: 5px;">Once scanned, this page will update automatically!</p>
          <script>
            setTimeout(() => { window.location.reload(); }, 10000);
          </script>
        </body>
      </html>
    `);
  } catch (err) {
    res.status(500).send(`
      <html>
        <body style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:100vh; font-family:sans-serif; background:#121212; color:white;">
          <h1>Gateway Connection Offline</h1>
          <p>Failed to connect to the WhatsApp API gateway. Please ensure the backend server has started up completely.</p>
          <p style="color: red;">Error: ${err.message}</p>
        </body>
      </html>
    `);
  }
});

// Helper route to force start session if it gets disconnected
loanRouter.post('/whatsapp-qr/start', async (req, res) => {
  try {
    let uuid = getSessionUuid();
    if (!uuid) {
      const listRes = await fetch('http://localhost:2785/api/sessions', {
        headers: { 'X-API-Key': 'default_master_key_for_emi_tracker_999' }
      });
      if (listRes.ok) {
        const sessions = await listRes.json();
        const defaultSess = sessions.find(s => s.name === 'default-session');
        if (defaultSess) uuid = defaultSess.id;
      }
    }
    
    if (uuid) {
      await fetch(`http://localhost:2785/api/sessions/${uuid}/start`, {
        method: 'POST',
        headers: {
          'X-API-Key': 'default_master_key_for_emi_tracker_999'
        }
      });
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

loanRouter.use(protect); // protect all loan routes

loanRouter.post('/', validateRequest(loanSchema), createLoan);
loanRouter.get('/', getLoans);
loanRouter.post('/payment', recordPayment);
loanRouter.get('/payments', getPayments);
loanRouter.get('/payment-history', getPaymentHistory);
loanRouter.post('/detect-transaction', detectAndProcessTransaction);


loanRouter.get('/:id', checkLoanOwnership, getLoanById);
loanRouter.patch('/:id', checkLoanOwnership, validateRequest(loanSchema.partial()), updateLoan);
loanRouter.delete('/:id', checkLoanOwnership, deleteLoan);
loanRouter.post('/:id/prepay', checkLoanOwnership, prepayForecast);
loanRouter.post('/upload-sms-text', uploadSmsText);

// Secure payment marking route (requires signature verification + body validation)
loanRouter.patch('/:id/mark-paid', checkLoanOwnership, verifyDeviceSignature, validateRequest(markPaidSchema), markPaid);

// Parse SMS Text via Gemini AI
loanRouter.post('/parse-sms', aiLimiter, validateRequest(parseSmsSchema), async (req, res) => {
  const { text } = req.body;
  try {
    const result = await parseSmsWithGemini(text);
    if (req.user) {
      await scanTransactionForFraud(
        req.user._id,
        result.channel === 'unknown' ? 'SMS' : (result.channel === 'notification' ? 'Notification' : 'SMS'),
        text,
        result.amount || 0,
        result.provider || result.merchantOrBank || ''
      );
    }
    res.json(result);
  } catch (error) {
    res.status(200).json({
      isRelevant: false, isEMIRelated: false, channel: 'unknown',
      provider: null, merchantOrBank: null, loanType: null,
      transactionType: 'unknown', amount: null, currency: 'INR',
      paymentStatus: 'unknown', paymentDate: null,
      accountEnding: null, referenceIdMasked: null,
      isRecurringPattern: false, estimatedMonthlyEMI: null,
      confidence: 0, securityFlags: ['low_signal'],
      explanation: 'AI engine temporarily unavailable. Using local parser.',
      _aiError: error.message,
    });
  }
});

// Stage-2 Payment Validation Engine (Requires Signature Verification)
loanRouter.post('/validate-payment', checkLoanOwnership, verifyDeviceSignature, validateRequest(validatePaymentSchema), async (req, res) => {
  const { parsedPayment, matchedLoanId, engineUsed } = req.body;
  try {
    const loan = req.loan; // already loaded by checkLoanOwnership middleware

    // Build sanitized loan metadata — no sensitive fields exposed to AI
    const nextDueDays = loan.nextDueDate
      ? Math.ceil((new Date(loan.nextDueDate) - Date.now()) / (1000 * 60 * 60 * 24))
      : null;

    const providerRef = parsedPayment.provider || parsedPayment.merchantOrBank || '';
    const providerMatch = providerRef && loan.provider
      ? loan.provider.toLowerCase().includes(providerRef.toLowerCase()) ||
        providerRef.toLowerCase().includes(loan.provider.toLowerCase())
      : false;

    const matchedLoanMeta = {
      loanType:          loan.loanType,
      emiAmount:         loan.emiAmount,
      outstandingBalance: loan.outstandingBalance,
      nextDueDaysAway:   nextDueDays,
      providerNameMatch: providerMatch,
      provider:          loan.provider,
    };

    const result = await validatePaymentWithGemini({
      parsedPayment,
      matchedLoan: matchedLoanMeta,
      timestamp:   new Date().toISOString(),
      engineUsed:  engineUsed || 'unknown',
    });

    res.json(result);
  } catch (error) {
    // Graceful degradation — return a safe medium-risk result with manual review
    console.error('Validation route error:', error.message);
    res.status(200).json({
      validated: false,
      riskLevel: 'medium',
      linkedLoanConfidence: 0,
      recommendation: 'AI validation engine temporarily unavailable. Manual review required.',
      nextAction: 'flag_for_review',
      manualReviewRequired: true,
      _aiError: error.message,
    });
  }
});

// Statement Parsing (Gemini AI Extraction)
loanRouter.post('/upload-statement', uploadLimiter, upload.single('file'), uploadSecurityMiddleware, async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: 'Please upload a statement file.' });
  }
  try {
    const fileBuffer = req.file.buffer;
    const mimeType = req.file.mimetype;
    const extractedData = await extractLoanFromFile(fileBuffer, mimeType);

    // Log successful parse
    await DocumentParseLog.create({
      userId: req.user._id,
      fileName: req.file.originalname || 'loan_statement.pdf',
      fileSize: req.file.size || 0,
      status: 'success'
    });

    res.json(extractedData);
  } catch (error) {
    // Log failed parse
    try {
      await DocumentParseLog.create({
        userId: req.user ? req.user._id : null,
        fileName: req.file.originalname || 'loan_statement.pdf',
        fileSize: req.file.size || 0,
        status: 'failed',
        errorMessage: error.message
      });
    } catch (dbErr) {
      console.error('Failed to log document parse error:', dbErr.message);
    }
    res.status(500).json({ message: error.message });
  }
});

// Telegram Link Validation Endpoint
loanRouter.post('/test-telegram', async (req, res) => {
  const { telegramChatId } = req.body;
  if (!telegramChatId) {
    return res.status(400).json({ message: 'Telegram Chat ID is required.' });
  }
  try {
    const success = await sendTelegramMessage(
      telegramChatId,
      `🔔 <b>EMI Tracker AI Connection Verified!</b>\n\nYour Telegram account is now successfully linked to receive automated payment alerts.`
    );
    if (success) {
      res.json({ message: 'Test message sent successfully!' });
    } else {
      res.status(400).json({ message: 'Failed to send message. Please ensure you have started the bot on Telegram first.' });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// WhatsApp Link Validation Endpoint — sends a real custom welcome test message
loanRouter.post('/test-whatsapp', async (req, res) => {
  const { whatsappNumber } = req.body;
  if (!whatsappNumber) {
    return res.status(400).json({ message: 'WhatsApp number is required.' });
  }
  try {
    const userName = req.user ? req.user.name : 'Customer';
    const welcomeMsg = replacePlaceholders(WhatsAppTemplates.WELCOME, { name: userName });
    const result = await sendWhatsAppMessage(whatsappNumber, welcomeMsg, req.user?._id);
    if (result.success) {
      res.json({ message: 'Custom WhatsApp welcome message sent successfully!', messageId: result.messageId });
    } else {
      res.status(400).json({ message: result.error || 'Failed to send WhatsApp message.' });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});



// Manual scheduler sweep trigger (available to all authenticated users for testing purposes)
loanRouter.post('/trigger-scheduler', protect, async (req, res) => {
  try {
    const count = await runManualSweep();
    res.json({ message: `Triggered sweep. Sent ${count} alert(s).` });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.use('/api/loans', loanRouter);

// ── Intelligence Router ───────────────────────────────────────────────────────
const intelligenceRouter = express.Router();
intelligenceRouter.use(protect);
intelligenceRouter.post('/advisor', aiLimiter, validateRequest(advisorSchema), askAdvisor);
intelligenceRouter.get('/debt-free-forecast', getDebtFreeForecast);
intelligenceRouter.get('/health-score', getHealthScore);
intelligenceRouter.post('/analyze-statement', uploadLimiter, upload.single('file'), uploadSecurityMiddleware, analyzeStatement);
intelligenceRouter.get('/credit-prediction', getCreditPrediction);
intelligenceRouter.get('/wealth-advice', getWealthAdvice);
intelligenceRouter.post('/sip-plan', getSipPlan);
intelligenceRouter.get('/wealth-projection', getWealthProjection);
intelligenceRouter.get('/report/pdf', downloadPdfReport);
intelligenceRouter.get('/fraud', getFraudAlerts);
intelligenceRouter.patch('/fraud/:id', resolveFraudAlert);
intelligenceRouter.post('/scan-text', scanTextForFraud);
intelligenceRouter.get('/notifications', getNotificationCenterLogs);
intelligenceRouter.delete('/notifications', clearNotificationCenterLogs);
intelligenceRouter.post('/documents', uploadLimiter, upload.single('file'), uploadSecurityMiddleware, uploadDocument);
intelligenceRouter.get('/documents', getDocuments);
intelligenceRouter.delete('/documents', deleteAllDocuments);
intelligenceRouter.delete('/documents/:id', deleteDocument);
// Manual monthly report trigger (per-user PDF email dispatch)
intelligenceRouter.post('/report/send-monthly', async (req, res) => {
  try {
    const count = await dispatchMonthlyPdfReports();
    res.json({ message: `Monthly PDF reports dispatched successfully to ${count} user(s).`, count });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});
app.use('/api/intelligence', intelligenceRouter);

app.use('/api/news', newsRoutes);

// ── Analytics Router ─────────────────────────────────────────────────────────
const analyticsRouter = express.Router();
analyticsRouter.use(protect);
analyticsRouter.get('/forecast', getForecastAnalytics);
analyticsRouter.get('/export/excel', exportExcelReport);
app.use('/api/analytics', analyticsRouter);

// ── Assets Router ─────────────────────────────────────────────────────────────
const assetRouter = express.Router();
assetRouter.use(protect);
assetRouter.get('/', getAssets);
assetRouter.post('/', validateRequest(assetSchema), createAsset);
assetRouter.delete('/:id', deleteAsset);
assetRouter.get('/net-worth', getNetWorth);
app.use('/api/assets', assetRouter);


// ── Notification Router ───────────────────────────────────────────────────────
const notificationRouter = express.Router();
notificationRouter.use(protect);

notificationRouter.get('/preferences', async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    res.json(user.notificationSettings || {
      emiReminders: true,
      paymentAlerts: true,
      overdueAlerts: true,
      monthlyReports: true,
      financialTips: false
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

notificationRouter.patch('/preferences', async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    user.notificationSettings = {
      ...user.notificationSettings,
      ...req.body
    };
    await user.save();
    res.json({ message: 'Notification preferences updated.', preferences: user.notificationSettings });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

notificationRouter.get('/logs', async (req, res) => {
  try {
    const logs = await NotificationLog.find({ userId: req.user._id })
      .sort({ createdAt: -1 })
      .limit(100);
    res.json(logs);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

notificationRouter.delete('/logs', async (req, res) => {
  try {
    await NotificationLog.deleteMany({ userId: req.user._id });
    res.json({ message: 'Delivery logs reset successfully.' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

notificationRouter.get('/analytics', async (req, res) => {
  try {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const totalSent = await NotificationLog.countDocuments({ userId: req.user._id });
    const sentToday = await NotificationLog.countDocuments({ userId: req.user._id, sentAt: { $gte: startOfToday } });
    const successCount = await NotificationLog.countDocuments({ userId: req.user._id, status: 'delivered' });
    const failedCount = await NotificationLog.countDocuments({ userId: req.user._id, status: 'failed' });

    const successRate = totalSent > 0 ? Math.round((successCount / totalSent) * 100) : 100;

    // Top template
    const topTemplates = await NotificationLog.aggregate([
      { $match: { userId: req.user._id } },
      { $group: { _id: '$template', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 1 }
    ]);
    const topTemplate = topTemplates.length > 0 ? topTemplates[0]._id : 'None';

    res.json({
      sentToday,
      successRate,
      failedCount,
      topTemplate
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Autopay simulation
notificationRouter.post('/simulate-autopay/:loanId', async (req, res) => {
  const { status, reason } = req.body;
  const { loanId } = req.params;

  try {
    const loan = await Loan.findOne({ _id: loanId, userId: req.user._id });
    if (!loan) return res.status(404).json({ message: 'Loan not found.' });

    const userPrefs = req.user.notificationSettings || {};
    if (userPrefs.paymentAlerts === false) {
      return res.status(400).json({ message: 'Payment alerts are disabled in your preferences.' });
    }

    const loanName = `${loan.provider} ${loan.loanType}`;
    let messageText = '';
    let templateName = '';

    if (status === 'success') {
      templateName = 'AUTOPAY_SUCCESS';
      messageText = replacePlaceholders(WhatsAppTemplates.AUTOPAY_SUCCESS, {
        loanName,
        emiAmount: loan.emiAmount.toLocaleString('en-IN')
      });
    } else {
      templateName = 'AUTOPAY_FAILED';
      messageText = replacePlaceholders(WhatsAppTemplates.AUTOPAY_FAILED, {
        loanName,
        emiAmount: loan.emiAmount.toLocaleString('en-IN'),
        reason: reason || 'Insufficient account balance'
      });
    }

    // Queue message immediately
    await queueWhatsAppMessage({
      userId: req.user._id,
      to: req.user.whatsappNumber,
      type: 'message',
      message: messageText,
      templateName,
      loanId: loan._id
    });

    res.json({ message: `Autopay ${status} simulation triggered.` });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.use('/api/notifications', notificationRouter);

// ── Goals Router ──────────────────────────────────────────────────────────────
const goalRouter = express.Router();
goalRouter.use(protect);
goalRouter.get('/', getGoals);
goalRouter.post('/', validateRequest(goalSchema), createGoal);
goalRouter.delete('/:id', deleteGoal);
app.use('/api/goals', goalRouter);

// ── Subscriptions Router ──────────────────────────────────────────────────────
const subscriptionRouter = express.Router();
subscriptionRouter.use(protect);
subscriptionRouter.get('/', getSubscriptions);
subscriptionRouter.post('/', validateRequest(subscriptionSchema), createSubscription);
subscriptionRouter.delete('/:id', deleteSubscription);
subscriptionRouter.get('/detect', detectSubscriptions);
app.use('/api/subscriptions', subscriptionRouter);
// ── Family Router ─────────────────────────────────────────────────────────────
const familyRouter = express.Router();
familyRouter.use(protect);
familyRouter.post('/', createFamily);
familyRouter.post('/invite', inviteMember);
familyRouter.post('/share-loan', shareLoan);
familyRouter.post('/share-asset', shareAsset);
familyRouter.get('/', getFamilies);
familyRouter.get('/:familyId/dashboard', getFamilyDashboard);
app.use('/api/families', familyRouter);

// ── Transactions Router ───────────────────────────────────────────────────────
import Transaction from './models/Transaction.js';
const txRouter = express.Router();
txRouter.use(protect);
txRouter.get('/', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const skip = parseInt(req.query.skip) || 0;
    const category = req.query.category;
    const type = req.query.type;
    const query = { userId: req.user._id };
    if (category) query.category = category;
    if (type) query.type = type;
    const transactions = await Transaction.find(query).sort({ date: -1 }).skip(skip).limit(limit);
    const total = await Transaction.countDocuments({ userId: req.user._id });
    res.json({ transactions, total });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});
txRouter.post('/', async (req, res) => {
  const { description, category, amount, type, date } = req.body;
  try {
    const tx = await Transaction.create({
      userId: req.user._id,
      description: description || 'Manual entry',
      category: category || 'Other',
      amount: parseFloat(amount) || 0,
      type: type || 'debit',
      date: date ? new Date(date) : new Date(),
    });
    // Also run fraud scan on manual entries
    if (tx.type === 'debit' && tx.amount > 0) {
      await scanTransactionForFraud(req.user._id, 'Statement', description, tx.amount, category || '');
    }
    res.status(201).json(tx);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});
txRouter.delete('/:id', async (req, res) => {
  try {
    const tx = await Transaction.findOneAndDelete({ _id: req.params.id, userId: req.user._id });
    if (!tx) return res.status(404).json({ message: 'Transaction not found.' });
    res.json({ message: 'Transaction deleted.' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});
app.use('/api/transactions', txRouter);

// ── Consent Router (Account Aggregator Simulation) ──────────────────────────
const consentRouter = express.Router();
consentRouter.use(protect);
consentRouter.post('/request', requestConsentController);
consentRouter.get('/status/:consentId', getConsentStatusController);
consentRouter.post('/mock-approve', mockApproveConsentController);
consentRouter.post('/sync', syncConsentDataController);
app.use('/api/consent', consentRouter);

// ── User Profile Update Route ─────────────────────────────────────────────────
app.patch('/api/auth/profile', protect, async (req, res) => {
  const { name, income, expenses, monthlyIncome } = req.body;
  try {
    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ message: 'User not found.' });
    if (name !== undefined) user.name = name;
    if (income !== undefined) user.income = parseFloat(income) || 0;
    if (expenses !== undefined) user.expenses = parseFloat(expenses) || 0;
    if (monthlyIncome !== undefined) user.income = parseFloat(monthlyIncome) || 0;
    await user.save();
    res.json({ message: 'Profile updated successfully.', user: { name: user.name, income: user.income, expenses: user.expenses } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});


// ── Support / Feedback Routes ──────────────────────────────────────────────────
const supportRouter = express.Router();
supportRouter.post('/crash', createCrashReport);
supportRouter.post('/analytics', createAnalyticsEvent);
supportRouter.post('/feedback', protect, validateRequest(feedbackSchema), createFeedback);
supportRouter.get('/feedback', protect, getFeedback);
app.use('/api/support', supportRouter);
app.use('/api/cron', cronRoutes);

// ── App Version Checker Route ─────────────────────────────────────────────────
app.get('/api/app-version', (req, res) => {
  res.json({
    minimumVersion: '1.0.0',
    currentVersion: '1.0.0',
    updateRequired: false,
    downloadUrl: 'https://emitracker.ai/apk',
  });
});

app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));
app.get('/api/health', getHealthStatus);

// The error handler must be before any other error middleware and after all controllers
Sentry.setupExpressErrorHandler(app);

// Error Handling Middleware (Redacts stack traces in production + logs with correlation IDs)
app.use((err, req, res, next) => {
  const statusCode = res.statusCode === 200 ? 500 : res.statusCode;
  const isProduction = process.env.NODE_ENV === 'production';
  
  // Data minimization: mask sensitive fields in request bodies for system logs
  const logBody = req.body ? { ...req.body } : {};
  if (logBody.password) logBody.password = '[REDACTED]';
  if (logBody.text) logBody.text = '[REDACTED_SMS]';

  const correlationId = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2, 9);
  
  console.error(`[Error ${correlationId}]`, {
    message: err.message,
    stack: err.stack,
    method: req.method,
    url: req.originalUrl,
    body: logBody,
    userId: req.user ? req.user._id : 'anonymous'
  });

  res.status(statusCode).json({
    message: isProduction 
      ? `An internal server error occurred. Support reference code: ${correlationId}`
      : err.message,
    stack: isProduction ? null : err.stack,
    code: correlationId,
  });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, async () => {
  console.log(`Server running in ${process.env.NODE_ENV || 'development'} mode on port ${PORT}`);
  
  // Initialize OpenWA client
  try {
    await initOpenWA();
  } catch (err) {
    console.error('Failed to initialize OpenWA at startup:', err);
  }
});

export default app;
