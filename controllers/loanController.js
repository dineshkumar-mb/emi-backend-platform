import Loan from '../models/Loan.js';
import ParsedSms from '../models/ParsedSms.js';
import LoanPayment from '../models/LoanPayment.js';
import NotificationLog from '../models/NotificationLog.js';
import { WhatsAppTemplates, replacePlaceholders } from '../templates/whatsappTemplates.js';
import { calculateEMI, forecastPrepayment } from '../services/emiEngine.js';
import { detectTransactionEMI, getProcessingAction } from '../services/emiDetectionService.js';
import { findMatchingLoan } from '../services/loanMatchingService.js';
import { calculateEmiBreakdown } from '../services/emiCalculationEngine.js';
import { queueWhatsAppMessage } from '../services/whatsappAutomationService.js';
import { generateLoanInsights } from '../services/aiInsightEngine.js';
import { calculateDebtCountdown } from '../services/debtCountdownService.js';

// @desc    Create new loan
// @route   POST /api/loans
// @access  Private
export const createLoan = async (req, res) => {
  const { provider, loanType, principal, interestRate, tenure, emiAmount, nextDueDate } = req.body;

  try {
    // Determine EMI amount using the engine if not supplied by the user
    const calculatedEmi = emiAmount || calculateEMI(Number(principal), Number(interestRate), Number(tenure));

    const loan = await Loan.create({
      userId: req.user._id,
      provider,
      loanType,
      principal: Number(principal),
      interestRate: Number(interestRate),
      tenure: Number(tenure),
      emiAmount: Number(calculatedEmi),
      outstandingBalance: Number(principal), // Start with total principal as outstanding
      nextDueDate: new Date(nextDueDate),
      status: 'active',
      paymentHistory: [],
    });

    res.status(201).json(loan);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// @desc    Get user's loans
// @route   GET /api/loans
// @access  Private
export const getLoans = async (req, res) => {
  try {
    const loans = await Loan.find({ userId: req.user._id });
    res.json(loans);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get loan by ID (verification handled by ownership middleware)
// @route   GET /api/loans/:id
// @access  Private
export const getLoanById = async (req, res) => {
  // Middleware checkLoanOwnership attaches loan to req.loan
  res.json(req.loan);
};

// @desc    Update loan details
// @route   PATCH /api/loans/:id
// @access  Private
export const updateLoan = async (req, res) => {
  try {
    const loan = req.loan; // retrieved from checkLoanOwnership middleware
    const fieldsToUpdate = req.body;
    
    // If interest rate, principal or tenure changed and emi is not recalculated, update it
    let recalculateEmi = false;
    if (fieldsToUpdate.principal !== undefined || fieldsToUpdate.interestRate !== undefined || fieldsToUpdate.tenure !== undefined) {
      recalculateEmi = true;
    }

    Object.assign(loan, fieldsToUpdate);

    if (recalculateEmi && !fieldsToUpdate.emiAmount) {
      loan.emiAmount = calculateEMI(loan.principal, loan.interestRate, loan.tenure);
    }

    const updatedLoan = await loan.save();
    res.json(updatedLoan);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// @desc    Delete loan
// @route   DELETE /api/loans/:id
// @access  Private
export const deleteLoan = async (req, res) => {
  try {
    const loan = req.loan; // retrieved from checkLoanOwnership middleware
    await Loan.findByIdAndDelete(loan._id);
    res.json({ message: 'Loan removed' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Prepayment forecasting
// @route   POST /api/loans/:id/prepay
// @access  Private
export const prepayForecast = async (req, res) => {
  const { prepaymentAmount, prepaymentMonth } = req.body;

  try {
    const loan = req.loan; // retrieved from checkLoanOwnership middleware

    const forecast = forecastPrepayment(
      loan.outstandingBalance,
      loan.interestRate,
      loan.tenure,
      prepaymentAmount ? Number(prepaymentAmount) : 0,
      prepaymentMonth ? Number(prepaymentMonth) : 1
    );

    res.json(forecast);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// @desc    Mark EMI as paid (validated via ownership and signature checks)
// @route   PATCH /api/loans/:id/mark-paid
// @access  Private
export const markPaid = async (req, res) => {
  const { amount, refId, source, date } = req.body;
  const loan = req.loan; // retrieved from checkLoanOwnership middleware

  try {
    const paymentAmount = Number(amount) || loan.emiAmount;

    // Deduplication check: reject replayed/duplicate transaction reference IDs
    if (refId) {
      const isDuplicate = loan.paymentHistory.some(p => p.refId === refId);
      if (isDuplicate) {
        return res.status(409).json({ message: `Duplicate transaction. Reference ID ${refId} has already been logged.` });
      }
    }

    // Deduct interest portion and reduce outstanding balance by principal portion
    const breakdown = calculateEmiBreakdown(loan.outstandingBalance, loan.interestRate, paymentAmount);
    loan.outstandingBalance = breakdown.outstandingBalance;

    // Roll next due date forward by exactly 1 month
    const currentDue = new Date(loan.nextDueDate);
    currentDue.setMonth(currentDue.getMonth() + 1);
    loan.nextDueDate = currentDue;

    // Mark as completed if fully repaid
    if (loan.outstandingBalance === 0) {
      loan.status = 'completed';
    }

    // Record payment in history
    loan.paymentHistory.push({
      amount: paymentAmount,
      date: date ? new Date(date) : new Date(),
      refId: refId || null,
      source: source || 'Manual',
    });

    const updatedLoan = await loan.save();

    // Create LoanPayment document to keep stats and transaction log in sync
    await LoanPayment.create({
      loanId: loan._id,
      paymentDate: date ? new Date(date) : new Date(),
      emiNumber: loan.paymentHistory.length,
      emiAmount: paymentAmount,
      principalPaid: breakdown.principalPaid,
      interestPaid: breakdown.interestPaid,
      outstandingBalance: breakdown.outstandingBalance,
      paymentStatus: 'success',
      source: source || 'Manual',
      transactionId: refId || null,
    });

    res.json({
      message: 'Payment recorded successfully.',
      loan: updatedLoan,
    });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// @desc    Upload and parse raw SMS text
// @route   POST /api/loans/upload-sms-text
// @access  Private
export const uploadSmsText = async (req, res) => {
  const { text } = req.body;
  if (!text || typeof text !== 'string') {
    return res.status(400).json({ message: 'SMS text is required.' });
  }

  try {
    const cleanText = text.toLowerCase();
    
    // Extract amount
    let amount = 0;
    const amountRegex = /(?:rs\.?|inr|amt|rupees|rs)\s*([\d,]+(?:\.\d{1,2})?)/i;
    const matchAmount = text.match(amountRegex);
    if (matchAmount) {
      amount = parseFloat(matchAmount[1].replace(/,/g, ''));
    } else {
      const numRegex = /\b\d{3,}(?:,\d{3})*(?:\.\d{1,2})?\b/;
      const matchNum = text.match(numRegex);
      if (matchNum) {
        amount = parseFloat(matchNum[0].replace(/,/g, ''));
      }
    }

    let type = 'UNKNOWN';
    let status = 'SUCCESS';

    if (cleanText.includes('fail') || cleanText.includes('decline') || cleanText.includes('reject') || cleanText.includes('bounce')) {
      status = 'FAILED';
    } else if (cleanText.includes('pending') || cleanText.includes('process')) {
      status = 'PENDING';
    }

    if (cleanText.includes('disburs') || cleanText.includes('disbursement')) {
      type = 'LOAN_DISBURSEMENT';
    } else if (cleanText.includes('clos') || cleanText.includes('closure') || cleanText.includes('fully repaid') || cleanText.includes('settled')) {
      type = 'LOAN_CLOSURE';
    } else if (cleanText.includes('credit') || cleanText.includes('receive') || cleanText.includes('deposit')) {
      if (cleanText.includes('emi') || cleanText.includes('loan')) {
        type = 'EMI_CREDIT';
      }
    } else if (cleanText.includes('debit') || cleanText.includes('paid') || cleanText.includes('spent') || cleanText.includes('deduct') || cleanText.includes('auto-debit') || cleanText.includes('charged') || cleanText.includes('towards emi') || cleanText.includes('towards payment')) {
      if (cleanText.includes('emi') || cleanText.includes('loan')) {
        type = 'EMI_PAYMENT';
      }
    }

    if (type === 'UNKNOWN' && (cleanText.includes('emi') || cleanText.includes('loan'))) {
      if (cleanText.includes('credit')) {
        type = 'EMI_CREDIT';
      } else {
        type = 'EMI_PAYMENT';
      }
    }

    // Save parsed SMS
    const parsedSms = await ParsedSms.create({
      userId: req.user._id,
      rawText: text,
      type,
      amount,
      status,
    });

    res.status(201).json({
      type: parsedSms.type,
      amount: parsedSms.amount,
      status: parsedSms.status,
      _id: parsedSms._id,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Record loan payment manually
// @route   POST /api/loans/payment
// @access  Private
export const recordPayment = async (req, res) => {
  const { loanId, amount, date, source, transactionId } = req.body;
  if (!loanId) {
    return res.status(400).json({ message: 'Loan ID is required.' });
  }

  try {
    const loan = await Loan.findOne({ _id: loanId, userId: req.user._id });
    if (!loan) {
      return res.status(404).json({ message: 'Loan not found.' });
    }

    const paymentAmount = Number(amount) || loan.emiAmount;
    
    // Calculate breakdown
    const breakdown = calculateEmiBreakdown(loan.outstandingBalance, loan.interestRate, paymentAmount);
    
    // Deduplication check
    if (transactionId) {
      const isDuplicate = loan.paymentHistory.some(p => p.refId === transactionId);
      if (isDuplicate) {
        return res.status(409).json({ message: `Duplicate transaction. Reference ID ${transactionId} has already been logged.` });
      }
    }

    // Capture values before modification for milestone tracking
    const beforePaid = loan.principal - loan.outstandingBalance;
    const beforePaidPercent = (beforePaid / loan.principal) * 100;

    // Update loan values
    loan.outstandingBalance = breakdown.outstandingBalance;

    // Roll next due date forward by 1 month
    const currentDue = new Date(loan.nextDueDate);
    currentDue.setMonth(currentDue.getMonth() + 1);
    loan.nextDueDate = currentDue;

    if (loan.outstandingBalance === 0) {
      loan.status = 'completed';
    }

    // Record payment in loan history
    loan.paymentHistory.push({
      amount: paymentAmount,
      date: date ? new Date(date) : new Date(),
      refId: transactionId || null,
      source: source || 'Manual',
    });

    const updatedLoan = await loan.save();
    const emiNumber = loan.paymentHistory.length;

    // Create LoanPayment document
    const payment = await LoanPayment.create({
      loanId: loan._id,
      paymentDate: date ? new Date(date) : new Date(),
      emiNumber,
      emiAmount: paymentAmount,
      principalPaid: breakdown.principalPaid,
      interestPaid: breakdown.interestPaid,
      outstandingBalance: breakdown.outstandingBalance,
      paymentStatus: 'success',
      source: source || 'Manual',
      transactionId: transactionId || null,
    });

    // Milestone tracking
    const afterPaid = loan.principal - loan.outstandingBalance;
    const afterPaidPercent = (afterPaid / loan.principal) * 100;
    const milestones = [25, 50, 75, 100];
    let milestoneMessage = null;

    for (const m of milestones) {
      if (beforePaidPercent < m && afterPaidPercent >= m) {
        const remainingEmis = Math.ceil(loan.outstandingBalance / loan.emiAmount);
        milestoneMessage = `🎉 Congratulations\n\nYou have completed ${m}% of your loan.\n\nRemaining Balance:\n₹${loan.outstandingBalance.toLocaleString('en-IN')}\n\nRemaining EMIs:\n${remainingEmis}`;
        break;
      }
    }

    // Send milestone alert via queue if triggered
    if (milestoneMessage && req.user.whatsappNumber) {
      await queueWhatsAppMessage({
        userId: req.user._id,
        to: req.user.whatsappNumber,
        type: 'message',
        message: milestoneMessage,
        loanId: loan._id,
      });
    }

    // Generate AI Financial Insights
    const aiInsight = await generateLoanInsights(loan);

    // Queue WhatsApp success notifications
    const userPrefs = req.user.notificationSettings || {};
    const isPaymentAlertEnabled = userPrefs.paymentAlerts !== false;

    if (isPaymentAlertEnabled && req.user.whatsappNumber) {
      const loanName = `${loan.provider} ${loan.loanType}`;
      
      // 1. Send EMI Paid Alert
      const emiPaidText = replacePlaceholders(WhatsAppTemplates.EMI_PAID, {
        name: req.user.name || 'Customer',
        emiAmount: paymentAmount.toLocaleString('en-IN'),
        loanName,
        paymentDate: (date ? new Date(date) : new Date()).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
        remainingBalance: loan.outstandingBalance.toLocaleString('en-IN')
      });

      await queueWhatsAppMessage({
        userId: req.user._id,
        to: req.user.whatsappNumber,
        type: 'message',
        message: emiPaidText,
        templateName: 'EMI_PAID',
        loanId: loan._id,
      });

      // 2. If loan is closed, send Loan Closed Alert
      if (loan.outstandingBalance === 0 && loan.status === 'completed') {
        // Calculate total amount paid from history or principal
        const totalPaidVal = loan.principal || paymentAmount;
        
        const loanClosedText = replacePlaceholders(WhatsAppTemplates.LOAN_CLOSED, {
          loanName,
          totalPaid: totalPaidVal.toLocaleString('en-IN'),
          closureDate: new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
        });

        await queueWhatsAppMessage({
          userId: req.user._id,
          to: req.user.whatsappNumber,
          type: 'message',
          message: loanClosedText,
          templateName: 'LOAN_CLOSED',
          loanId: loan._id,
        });
      }

      // Also send the AI Insight if enabled (as financial tips or generic)
      const isFinancialTipsEnabled = userPrefs.financialTips === true;
      if (isFinancialTipsEnabled && aiInsight) {
        await queueWhatsAppMessage({
          userId: req.user._id,
          to: req.user.whatsappNumber,
          type: 'message',
          message: aiInsight,
          templateName: 'FINANCIAL_TIPS',
          loanId: loan._id,
        });
      }
    }

    res.status(201).json({
      message: 'Payment recorded successfully.',
      payment,
      loan: updatedLoan,
      aiInsight,
    });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// @desc    Get user's payments
// @route   GET /api/loans/payments
// @access  Private
export const getPayments = async (req, res) => {
  try {
    const userLoans = await Loan.find({ userId: req.user._id });
    const loanIds = userLoans.map(l => l._id);
    const payments = await LoanPayment.find({ loanId: { $in: loanIds } })
      .populate('loanId', 'provider loanType')
      .sort({ paymentDate: -1 });
    res.json(payments);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get user's payment history statistics
// @route   GET /api/loans/payment-history
// @access  Private
export const getPaymentHistory = async (req, res) => {
  try {
    const userLoans = await Loan.find({ userId: req.user._id });
    const loanIds = userLoans.map(l => l._id);

    const payments = await LoanPayment.find({ loanId: { $in: loanIds } }).sort({ paymentDate: -1 });
    
    const totalPrincipalPaid = payments.reduce((sum, p) => sum + p.principalPaid, 0);
    const totalInterestPaid = payments.reduce((sum, p) => sum + p.interestPaid, 0);
    const remainingBalance = userLoans.reduce((sum, l) => sum + l.outstandingBalance, 0);

    res.json({
      totalPrincipalPaid,
      totalInterestPaid,
      remainingBalance,
      payments,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Detect transaction text and trigger auto processing pipeline
// @route   POST /api/loans/detect-transaction
// @access  Private
export const detectAndProcessTransaction = async (req, res) => {
  const { text } = req.body;
  if (!text || typeof text !== 'string') {
    return res.status(400).json({ message: 'Transaction text is required.' });
  }

  try {
    const result = await detectTransactionEMI(text);
    const action = getProcessingAction(result.confidence);

    if (action === 'ignore') {
      return res.json({
        status: 'ignored',
        message: `Transaction ignored. Confidence too low: ${(result.confidence * 100).toFixed(0)}%`,
        parsed: result,
      });
    }

    const matchResult = await findMatchingLoan(req.user._id, result);

    if (action === 'request_verification' || !matchResult) {
      let pendingPayment = null;
      if (matchResult) {
        pendingPayment = await LoanPayment.create({
          loanId: matchResult.loan._id,
          paymentDate: new Date(),
          emiNumber: matchResult.loan.paymentHistory.length + 1,
          emiAmount: result.amount || 0,
          principalPaid: 0,
          interestPaid: 0,
          outstandingBalance: matchResult.loan.outstandingBalance,
          paymentStatus: 'pending',
          source: 'SMS',
          transactionId: result.referenceId || null,
        });
      }

      return res.json({
        status: 'pending_verification',
        message: !matchResult ? 'No matching loan found. Manual link required.' : 'Confidence requires verification.',
        parsed: result,
        matchedLoan: matchResult ? { _id: matchResult.loan._id, provider: matchResult.loan.provider, emiAmount: matchResult.loan.emiAmount } : null,
        paymentId: pendingPayment ? pendingPayment._id : null,
      });
    }

    const loan = matchResult.loan;
    const paymentAmount = result.amount || loan.emiAmount;
    const breakdown = calculateEmiBreakdown(loan.outstandingBalance, loan.interestRate, paymentAmount);

    const beforePaid = loan.principal - loan.outstandingBalance;
    const beforePaidPercent = (beforePaid / loan.principal) * 100;

    loan.outstandingBalance = breakdown.outstandingBalance;
    const currentDue = new Date(loan.nextDueDate);
    currentDue.setMonth(currentDue.getMonth() + 1);
    loan.nextDueDate = currentDue;

    if (loan.outstandingBalance === 0) {
      loan.status = 'completed';
    }

    loan.paymentHistory.push({
      amount: paymentAmount,
      date: new Date(),
      refId: result.referenceId || null,
      source: 'SMS',
    });

    const updatedLoan = await loan.save();
    const emiNumber = loan.paymentHistory.length;

    const payment = await LoanPayment.create({
      loanId: loan._id,
      paymentDate: new Date(),
      emiNumber,
      emiAmount: paymentAmount,
      principalPaid: breakdown.principalPaid,
      interestPaid: breakdown.interestPaid,
      outstandingBalance: breakdown.outstandingBalance,
      paymentStatus: 'success',
      source: 'SMS',
      transactionId: result.referenceId || null,
    });

    const afterPaid = loan.principal - loan.outstandingBalance;
    const afterPaidPercent = (afterPaid / loan.principal) * 100;
    const milestones = [25, 50, 75, 100];
    let milestoneMessage = null;

    for (const m of milestones) {
      if (beforePaidPercent < m && afterPaidPercent >= m) {
        const remainingEmis = Math.ceil(loan.outstandingBalance / loan.emiAmount);
        milestoneMessage = `🎉 Congratulations\n\nYou have completed ${m}% of your loan.\n\nRemaining Balance:\n₹${loan.outstandingBalance.toLocaleString('en-IN')}\n\nRemaining EMIs:\n${remainingEmis}`;
        break;
      }
    }

    if (milestoneMessage && req.user.whatsappNumber) {
      await queueWhatsAppMessage({
        userId: req.user._id,
        to: req.user.whatsappNumber,
        type: 'message',
        message: milestoneMessage,
        loanId: loan._id,
      });
    }

    const aiInsight = await generateLoanInsights(loan);

    // Queue WhatsApp success notifications
    const userPrefs = req.user.notificationSettings || {};
    const isPaymentAlertEnabled = userPrefs.paymentAlerts !== false;

    if (isPaymentAlertEnabled && req.user.whatsappNumber) {
      const loanName = `${loan.provider} ${loan.loanType}`;
      
      // 1. Send EMI Paid Alert
      const emiPaidText = replacePlaceholders(WhatsAppTemplates.EMI_PAID, {
        name: req.user.name || 'Customer',
        emiAmount: paymentAmount.toLocaleString('en-IN'),
        loanName,
        paymentDate: new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
        remainingBalance: loan.outstandingBalance.toLocaleString('en-IN')
      });

      await queueWhatsAppMessage({
        userId: req.user._id,
        to: req.user.whatsappNumber,
        type: 'message',
        message: emiPaidText,
        templateName: 'EMI_PAID',
        loanId: loan._id,
      });

      // 2. If loan is closed, send Loan Closed Alert
      if (loan.outstandingBalance === 0 && loan.status === 'completed') {
        const totalPaidVal = loan.principal || paymentAmount;
        
        const loanClosedText = replacePlaceholders(WhatsAppTemplates.LOAN_CLOSED, {
          loanName,
          totalPaid: totalPaidVal.toLocaleString('en-IN'),
          closureDate: new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
        });

        await queueWhatsAppMessage({
          userId: req.user._id,
          to: req.user.whatsappNumber,
          type: 'message',
          message: loanClosedText,
          templateName: 'LOAN_CLOSED',
          loanId: loan._id,
        });
      }

      // Also send the AI Insight if enabled
      const isFinancialTipsEnabled = userPrefs.financialTips === true;
      if (isFinancialTipsEnabled && aiInsight) {
        await queueWhatsAppMessage({
          userId: req.user._id,
          to: req.user.whatsappNumber,
          type: 'message',
          message: aiInsight,
          templateName: 'FINANCIAL_TIPS',
          loanId: loan._id,
        });
      }
    }

    res.json({
      status: 'auto_processed',
      message: 'EMI payment successfully processed automatically.',
      parsed: result,
      payment,
      loan: updatedLoan,
      aiInsight,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
