import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { encrypt, decrypt } from './utils/encryption.js';
import User from './models/User.js';
import Loan from './models/Loan.js';
import SecurityAudit from './models/SecurityAudit.js';
import Consent from './models/Consent.js';
import AlertRule from './models/AlertRule.js';
import Asset from './models/Asset.js';
import Transaction from './models/Transaction.js';
import { structuredLogger } from './middleware/loggingMiddleware.js';
import * as accountAggregatorService from './services/accountAggregatorService.js';

dotenv.config();

const runNewTests = async () => {
  console.log('🧪 Starting Mitr AI New Features Validation Suite...\n');
  let passed = 0;
  let failed = 0;

  const assert = (name, condition, details = '') => {
    if (condition) {
      console.log(`✅ [PASS] ${name}`);
      passed++;
    } else {
      console.error(`❌ [FAIL] ${name} ${details}`);
      failed++;
    }
  };

  // 1. Encryption / Decryption Math Verification
  try {
    const rawText = 'TXN1234567890_ref_id';
    const cipher = encrypt(rawText);
    assert('Encryption returns different cipher text', cipher !== rawText);
    assert('Encryption text format includes colons', cipher.includes(':'));
    
    const plain = decrypt(cipher);
    assert('Decryption returns original raw text', plain === rawText, `Expected "${rawText}", got "${plain}"`);
  } catch (err) {
    assert('Encryption/Decryption exception', false, err.message);
  }

  // 2. Connect to Database for Integration Tests
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('\n🔌 Connected to MongoDB for integration checks.\n');

    // Create a temporary user
    const tempEmail = `test_user_${Date.now()}@mitr.ai`;
    const user = await User.create({
      name: 'Test Hardening User',
      email: tempEmail,
      password: 'password123',
      income: 80000,
      expenses: 20000,
      consentAI: true,
      consentAnalytics: true,
      consentProcessing: true
    });

    assert('GDPR Consent flags set correctly', user.consentAI === true && user.consentAnalytics === true);

    // Test Loan encryption hook
    const loan = await Loan.create({
      userId: user._id,
      provider: 'Test Bank Ltd',
      loanType: 'Personal Loan',
      principal: 100000,
      interestRate: 12,
      tenure: 12,
      emiAmount: 9000,
      outstandingBalance: 100000,
      nextDueDate: new Date(),
      status: 'active',
      paymentHistory: [
        { amount: 9000, refId: 'SECRET_TXN_REF_12345', source: 'SMS' }
      ]
    });

    // Check raw DB value for encryption
    const rawLoanInDb = await mongoose.connection.collection('loans').findOne({ _id: loan._id });
    const rawRefId = rawLoanInDb.paymentHistory[0].refId;
    assert('Mongoose Hook: paymentHistory refId is encrypted in the raw DB collection', rawRefId !== 'SECRET_TXN_REF_12345' && rawRefId.includes(':'));

    // Check retrieved document decryption
    const fetchedLoan = await Loan.findById(loan._id);
    assert('Mongoose Hook: paymentHistory refId is decrypted on find/retrieve', fetchedLoan.paymentHistory[0].refId === 'SECRET_TXN_REF_12345');

    // Test Security Audit Log immutability
    const audit = await SecurityAudit.create({
      userId: user._id,
      action: 'auth_login',
      status: 'success',
      details: { test: 'integration' }
    });
    assert('Security Audit log entry written successfully', audit._id !== undefined);

    let immutabilityPassed = false;
    try {
      audit.status = 'failure';
      await audit.save();
    } catch (err) {
      if (err.message.includes('immutable') || err.message.includes('immutable and cannot be updated')) {
        immutabilityPassed = true;
      }
    }
    assert('Security Audit entry is immutable (pre-save modification fails)', immutabilityPassed);

    // 3. Account Aggregator Integration Tests (Phase 6)
    console.log('\n🏦 Testing Account Aggregator Simulation Services...');
    
    // Test Consent request
    const consent = await accountAggregatorService.requestConsent(user._id, 'test@sahamati');
    assert('Consent requested successfully in PENDING status', consent.consentId !== undefined && consent.status === 'PENDING');

    // Test Consent approval
    const approvedConsent = await accountAggregatorService.approveConsent(consent.consentId);
    assert('Consent successfully approved with links', approvedConsent.status === 'APPROVED' && approvedConsent.linkedAccounts.length > 0);

    // Test FIP syncing
    const syncRes = await accountAggregatorService.syncConsentData(consent.consentId);
    assert('FIP data synced successfully', syncRes.assets.length > 0 && syncRes.loans.length > 0);

    // Assert database collections synced correctly
    const syncedAssets = await Asset.find({ userId: user._id });
    assert('Asset collection populated accurately from FIP sync', syncedAssets.length === 2);
    
    const syncedLoans = await Loan.find({ userId: user._id, provider: 'State Bank of India' });
    assert('Loan collection populated accurately from FIP sync', syncedLoans.length === 1 && syncedLoans[0].emiAmount === 31012);

    // 4. Alert Rule CRUD (Phase 6)
    console.log('\n🔔 Testing Alert Rule Creation & CRUD...');
    const alertRule = await AlertRule.findOneAndUpdate(
      { userId: user._id, metric: 'emi_burden' },
      { userId: user._id, metric: 'emi_burden', thresholdPercent: 40, active: true },
      { upsert: true, new: true }
    );
    assert('AlertRule configured correctly', alertRule.metric === 'emi_burden' && alertRule.thresholdPercent === 40);

    // 5. Structured Log Middleware (Phase 6)
    console.log('\n📑 Testing Structured Logging Middleware...');
    
    let originalConsoleLog = console.log;
    let interceptedLogs = [];
    console.log = (msg) => {
      interceptedLogs.push(msg);
    };

    try {
      const mockReq = {
        headers: {},
        user,
        method: 'GET',
        url: '/api/test-log-route',
        ip: '127.0.0.1',
        get: () => 'TestAgent'
      };
      
      let finishCallback = null;
      const mockRes = {
        setHeader: () => {},
        statusCode: 200,
        on: (event, cb) => {
          if (event === 'finish') finishCallback = cb;
        }
      };

      // Call logger middleware
      structuredLogger(mockReq, mockRes, () => {});
      
      // Fire response finish callback
      if (finishCallback) {
        finishCallback();
      }

      console.log = originalConsoleLog; // Restore console log

      assert('Structured Logger output intercept captured', interceptedLogs.length > 0);
      
      const logObj = JSON.parse(interceptedLogs[0]);
      assert('Log structure contains correct JSON keys', 
        logObj.severity === 'INFO' && 
        logObj.requestId !== undefined && 
        logObj.userId === user._id.toString() &&
        logObj.url === '/api/test-log-route' &&
        logObj.statusCode === 200 &&
        typeof logObj.latencyMs === 'number'
      );
    } catch (e) {
      console.log = originalConsoleLog; // Restore in case of error
      assert('Structured logger parsing verification failed', false, e.message);
    }

    // Cleanup all test records
    await Loan.deleteMany({ userId: user._id });
    await Asset.deleteMany({ userId: user._id });
    await Transaction.deleteMany({ userId: user._id });
    await Consent.deleteMany({ userId: user._id });
    await AlertRule.deleteMany({ userId: user._id });
    await User.findByIdAndDelete(user._id);
    await mongoose.connection.collection('securityaudits').deleteOne({ _id: audit._id });

    console.log('\n🧹 Integration test cleanup completed.');
    await mongoose.disconnect();
  } catch (err) {
    console.error('Database Integration tests exception:', err);
    failed++;
  }

  console.log('\n======================================');
  console.log(`📊 Test Results: ${passed} passed, ${failed} failed`);
  console.log('======================================\n');

  process.exit(failed > 0 ? 1 : 0);
};

runNewTests();
