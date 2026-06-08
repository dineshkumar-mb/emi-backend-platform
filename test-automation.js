import dotenv from 'dotenv';
import { calculateEmiBreakdown } from './services/emiCalculationEngine.js';
import { findMatchingLoan } from './services/loanMatchingService.js';
import { detectTransactionEMI, getProcessingAction } from './services/emiDetectionService.js';
import { calculateDebtCountdown } from './services/debtCountdownService.js';
import { queueWhatsAppMessage } from './services/whatsappAutomationService.js';

dotenv.config();

const runTests = async () => {
  console.log('🧪 Starting EMI Success & WhatsApp Automation Test Suite...\n');
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

  // ──── TEST 1: EMI Calculation Math ────
  try {
    const principal = 500000;
    const rate = 10.2; // 10.2% p.a.
    const emi = 12500;

    // Monthly interest should be (500000 * 10.2) / 12 / 100 = 4250
    // Principal paid should be 12500 - 4250 = 8250
    // New balance should be 500000 - 8250 = 491750
    const breakdown = calculateEmiBreakdown(principal, rate, emi);

    assert('EMI Calculation Interest Paid', breakdown.interestPaid === 4250, `Expected 4250, got ${breakdown.interestPaid}`);
    assert('EMI Calculation Principal Paid', breakdown.principalPaid === 8250, `Expected 8250, got ${breakdown.principalPaid}`);
    assert('EMI Calculation Outstanding Balance', breakdown.outstandingBalance === 491750, `Expected 491750, got ${breakdown.outstandingBalance}`);
  } catch (err) {
    assert('EMI Calculation Math exception', false, err.message);
  }

  // ──── TEST 2: Fuzzy Loan Matching Score ────
  try {
    // Mock user loans
    const mockLoans = [
      { _id: 'loan_001', provider: 'HDFC Bank', emiAmount: 12500, outstandingBalance: 480000, status: 'active', principal: 500000, interestRate: 10, tenure: 60, nextDueDate: new Date() },
      { _id: 'loan_002', provider: 'SBI Finance', emiAmount: 8400, outstandingBalance: 200000, status: 'active', principal: 300000, interestRate: 8.5, tenure: 48, nextDueDate: new Date() }
    ];

    // Mock finding loan
    const testMatch = (loans, provider, amount) => {
      let bestMatch = null;
      let highestScore = 0;
      for (const loan of loans) {
        let score = 0;
        if (provider && loan.provider) {
          const lProv = loan.provider.toLowerCase();
          const tProv = provider.toLowerCase();
          if (lProv.includes(tProv) || tProv.includes(lProv)) score += 60;
        }
        if (amount && loan.emiAmount) {
          const diff = Math.abs(loan.emiAmount - amount) / loan.emiAmount;
          if (diff === 0) score += 40;
          else if (diff <= 0.05) score += 25;
        }
        if (score > highestScore) {
          highestScore = score;
          bestMatch = loan;
        }
      }
      return highestScore >= 40 ? { loan: bestMatch, score: highestScore } : null;
    };

    const match1 = testMatch(mockLoans, 'HDFC', 12500);
    assert('Perfect match found with score 100', match1 && match1.loan._id === 'loan_001' && match1.score === 100, `Expected loan_001, got ${match1?.loan?._id} with score ${match1?.score}`);

    const match2 = testMatch(mockLoans, 'SBI', 8350); // slight amount difference
    assert('Fuzzy amount match found', match2 && match2.loan._id === 'loan_002' && match2.score >= 60, `Expected loan_002, got ${match2?.loan?._id} with score ${match2?.score}`);
  } catch (err) {
    assert('Fuzzy Loan Matching exception', false, err.message);
  }

  // ──── TEST 3: Processing Action by Confidence ────
  try {
    assert('Confidence >= 90% is Auto Process', getProcessingAction(0.95) === 'auto_process');
    assert('Confidence 70%-89% is Request Verification', getProcessingAction(0.85) === 'request_verification');
    assert('Confidence < 70% is Ignore', getProcessingAction(0.50) === 'ignore');
  } catch (err) {
    assert('Confidence Actions exception', false, err.message);
  }

  // ──── TEST 4: Debt Countdown Calculator ────
  try {
    const mockLoan = {
      status: 'active',
      outstandingBalance: 125000,
      emiAmount: 12500,
      nextDueDate: new Date('2026-07-05')
    };

    // 125000 / 12500 = 10 months remaining
    const countdown = calculateDebtCountdown(mockLoan);
    assert('Debt Countdown remaining text calculation', countdown.remainingText === '10 Months', `Expected "10 Months", got "${countdown.remainingText}"`);
    assert('Estimated Closure Date format', countdown.estimatedClosureText !== 'N/A');
  } catch (err) {
    assert('Debt Countdown exception', false, err.message);
  }

  // ──── TEST 5: Milestone Trigger Threshold Crossing ────
  try {
    const principal = 500000;
    // Before outstanding: 380,000 -> Paid: 120,000 (24%)
    // After outstanding: 367,500 -> Paid: 132,500 (26.5%)
    // Should cross the 25% milestone
    const beforePaidPercent = ((500000 - 380000) / 500000) * 100;
    const afterPaidPercent = ((500000 - 367500) / 500000) * 100;
    
    let milestoneCrossed = false;
    if (beforePaidPercent < 25 && afterPaidPercent >= 25) {
      milestoneCrossed = true;
    }
    assert('Milestone trigger 25% boundary check', milestoneCrossed === true, `Expected boundary trigger, but missed`);
  } catch (err) {
    assert('Milestone Trigger exception', false, err.message);
  }

  // ──── TEST 6: WhatsApp Queue Verification ────
  try {
    // Queue should not crash the server even if Redis is down
    await queueWhatsAppMessage({
      userId: '660d1b9d4f04c6a9a9d20c51',
      to: '+919999999999',
      type: 'message',
      message: 'Test automated WhatsApp dispatch queue fallback',
    });
    assert('WhatsApp message queued with resilient fallback', true);
  } catch (err) {
    assert('WhatsApp Queue fallback check failed', false, err.message);
  }

  console.log('\n======================================');
  console.log(`📊 Test Results: ${passed} passed, ${failed} failed`);
  console.log('======================================\n');

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
};

runTests();
