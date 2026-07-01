import Loan from '../models/Loan.js';
import Asset from '../models/Asset.js';
import Goal from '../models/Goal.js';
import Subscription from '../models/Subscription.js';
import Transaction from '../models/Transaction.js';
import FraudAlert from '../models/FraudAlert.js';
import User from '../models/User.js';
import SmsLog from '../models/SmsLog.js';
import WhatsAppLog from '../models/WhatsAppLog.js';
import EmailLog from '../models/EmailLog.js';
import PushNotificationLog from '../models/PushNotificationLog.js';
import DocumentParseLog from '../models/DocumentParseLog.js';
import AlertRule from '../models/AlertRule.js';
import Document from '../models/Document.js';
import { askAdvisorWithGemini, analyzeStatementWithGemini, getCreditPredictionAdviceWithGemini, getWealthAdviceWithGemini, getDynamicHealthScoreWithGemini } from '../services/geminiService.js';
import { checkAndIncrementBudget } from '../utils/aiBudgetManager.js';
import { generateFinancialReportPDF } from '../services/pdfService.js';
import { calculateCreditScore, simulateCreditProjections, simulateScenario } from '../services/creditEngine.js';
import { calculateSipFutureValue, analyzeEmergencyFund, analyzeAssetAllocation, projectWealthGrowth } from '../services/financialPlannerService.js';
import { financialAdvisorAgent } from '../services/agents/financialAdvisorAgent.js';
import { queueDocumentIndexing } from '../services/ragService.js';
import { chromaService } from '../services/chromaClient.js';

// @desc    Ask AI Advisor for customized advice
// @route   POST /api/intelligence/advisor
// @access  Private
export const askAdvisor = async (req, res) => {
  const { query, useRag } = req.body;
  try {
    // Check and update AI budget to prevent abuse
    await checkAndIncrementBudget(req.user._id, 1500);

    const loans = await Loan.find({ userId: req.user._id });
    const assets = await Asset.find({ userId: req.user._id });
    const goals = await Goal.find({ userId: req.user._id });
    const subscriptions = await Subscription.find({ userId: req.user._id });
    
    // User context for the agent
    const userContext = {
      income: req.user.income || 0,
      expenses: req.user.expenses || 0,
      loans,
      assets,
      goals,
      subscriptions
    };

    let advice;
    let sources = [];

    if (useRag) {
      // Use the LangChain/ChromaDB Agent
      const sessionId = req.user._id.toString();
      const rawAdvice = await financialAdvisorAgent.generateAdvice(userContext, query, sessionId);
      advice = {
        response: rawAdvice.advice,
        actions: (rawAdvice.recommendedActions || []).map(a => ({ type: 'RECOMMENDATION', parameters: { text: a } }))
      };
      // Mock sources as the agent formats them inline or we can adjust later
      sources = []; 
    } else {
      // Use existing base advisor
      advice = await askAdvisorWithGemini(
        query,
        loans,
        assets,
        goals,
        subscriptions,
        req.user.income || 0,
        req.user.expenses || 0,
        ''
      );
    }

    // Process actions if requested by the AI
    if (advice.actions && Array.isArray(advice.actions) && advice.actions.length > 0) {
      for (const action of advice.actions) {
        const params = action.parameters || {};
        if (action.type === 'FILTER_LOANS') {
          const queryObj = { userId: req.user._id };
          if (params.minInterestRate !== undefined) {
            queryObj.interestRate = { ...queryObj.interestRate, $gte: params.minInterestRate };
          }
          if (params.maxInterestRate !== undefined) {
            queryObj.interestRate = { ...queryObj.interestRate, $lte: params.maxInterestRate };
          }
          if (params.minPrincipal !== undefined) {
            queryObj.principal = { ...queryObj.principal, $gte: params.minPrincipal };
          }
          if (params.maxPrincipal !== undefined) {
            queryObj.principal = { ...queryObj.principal, $lte: params.maxPrincipal };
          }
          const matchedLoans = await Loan.find(queryObj);
          action.actionData = { loans: matchedLoans };
        } else if (action.type === 'CREATE_REPAYMENT_PLAN') {
          const strategy = params.strategy || 'avalanche';
          const extraPayment = parseFloat(params.extraPayment) || 0;
          const activeLoans = await Loan.find({ userId: req.user._id, status: 'active' });
          const user = await User.findById(req.user._id);
          const userAssets = await Asset.find({ userId: req.user._id });

          const income = user?.income || 50000;
          const expenses = user?.expenses || 15000;
          const cashSum = userAssets.reduce((sum, a) => {
            const cat = (a.category || '').toLowerCase();
            if (cat.includes('cash') || cat.includes('bank') || cat.includes('savings')) {
              return sum + (a.value || 0);
            }
            return sum;
          }, 0);

          const target6Month = expenses * 6;
          const isEmergencyFundSafe = cashSum >= target6Month;
          const totalMinEmi = activeLoans.reduce((sum, l) => sum + l.emiAmount, 0);
          const monthlyNetSurplus = Math.max(0, income - expenses - totalMinEmi);

          const extraBudgetFromSurplus = isEmergencyFundSafe ? monthlyNetSurplus * 0.6 : monthlyNetSurplus * 0.2;
          const totalExtraPayment = extraBudgetFromSurplus + extraPayment;

          const sortFn = (loansList) => {
            if (strategy === 'avalanche') {
              return [...loansList].sort((a, b) => b.rate - a.rate);
            } else {
              return [...loansList].sort((a, b) => a.balance - b.balance);
            }
          };

          let tempLoans = activeLoans.map(l => ({
            id: l._id.toString(),
            provider: l.provider,
            loanType: l.loanType,
            balance: l.outstandingBalance,
            rate: l.interestRate,
            emi: l.emiAmount,
            originalEmi: l.emiAmount,
          }));

          let totalMinEmiInitial = tempLoans.reduce((sum, l) => sum + l.emi, 0);
          let extraRepaymentPool = totalExtraPayment;
          let totalInterestPaid = 0;
          let month = 0;
          let chartData = [{ month: 0, totalDebt: tempLoans.reduce((sum, l) => sum + l.balance, 0) }];

          while (month < 360) {
            let currentOutstanding = tempLoans.reduce((sum, l) => sum + l.balance, 0);
            if (currentOutstanding <= 0) break;
            
            month++;
            tempLoans = sortFn(tempLoans);
            
            let monthInterest = 0;
            let paymentsThisMonth = {};
            
            for (let loan of tempLoans) {
              if (loan.balance <= 0) continue;
              let monthlyRate = loan.rate / 12 / 100;
              let interest = Number((loan.balance * monthlyRate).toFixed(2));
              monthInterest += interest;
              totalInterestPaid += interest;
              
              let minPayment = Math.min(loan.emi, loan.balance + interest);
              paymentsThisMonth[loan.id] = { min: minPayment, extra: 0, interest };
            }
            
            let totalPaidThisMonth = Object.values(paymentsThisMonth).reduce((s, p) => s + p.min, 0);
            let extraAvailable = Math.max(0, totalMinEmiInitial - totalPaidThisMonth) + extraRepaymentPool;
            
            for (let loan of tempLoans) {
              if (loan.balance <= 0) continue;
              let pDetails = paymentsThisMonth[loan.id];
              let remainingBal = loan.balance + pDetails.interest - pDetails.min;
              
              if (remainingBal > 0 && extraAvailable > 0) {
                let extraPay = Math.min(extraAvailable, remainingBal);
                pDetails.extra = extraPay;
                extraAvailable -= extraPay;
              }
            }
            
            for (let loan of tempLoans) {
              if (loan.balance <= 0) continue;
              let pDetails = paymentsThisMonth[loan.id];
              let totalPay = pDetails.min + pDetails.extra;
              let principalPaid = totalPay - pDetails.interest;
              
              loan.balance = Number((loan.balance - principalPaid).toFixed(2));
              if (loan.balance <= 0) {
                loan.balance = 0;
                extraRepaymentPool += loan.originalEmi;
              }
            }
            
            let newOutstanding = tempLoans.reduce((sum, l) => sum + l.balance, 0);
            chartData.push({ month, totalDebt: Math.max(0, Number(newOutstanding.toFixed(2))) });
          }

          action.actionData = {
            strategy,
            extraPaymentUsed: totalExtraPayment,
            monthsToDebtFree: month,
            totalInterestPaid: Number(totalInterestPaid.toFixed(2)),
            chartData
          };
        } else if (action.type === 'SET_EMI_ALERT') {
          const metric = params.metric;
          const thresholdPercent = parseFloat(params.thresholdPercent);
          if (metric && !isNaN(thresholdPercent)) {
            const rule = await AlertRule.findOneAndUpdate(
              { userId: req.user._id, metric },
              { userId: req.user._id, metric, thresholdPercent, active: true },
              { upsert: true, new: true }
            );
            action.actionData = {
              success: true,
              rule,
              message: `Alert successfully set: notify when ${metric.replace('_', ' ')} exceeds ${thresholdPercent}%.`
            };
          }
        }
      }
    }

    res.json({ ...advice, sources });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get Debt-Free Forecast Timeline & Strategy Projections (Snowball vs Avalanche)
// @route   GET /api/intelligence/debt-free-forecast
// @access  Private
export const getDebtFreeForecast = async (req, res) => {
  try {
    const loans = await Loan.find({ userId: req.user._id, status: 'active' });
    if (loans.length === 0) {
      return res.json({
        hasLoans: false,
        normal: { monthsToDebtFree: 0, totalInterest: 0, chartData: [] },
        snowball: { monthsToDebtFree: 0, totalInterest: 0, chartData: [] },
        avalanche: { monthsToDebtFree: 0, totalInterest: 0, chartData: [] },
        aiDebtStrategy: null
      });
    }

    const user = await User.findById(req.user._id);
    const assets = await Asset.find({ userId: req.user._id });

    const income = user?.income || 50000;
    const expenses = user?.expenses || 15000;
    const cashSum = assets.reduce((sum, a) => {
      const cat = a.category.toLowerCase();
      if (cat.includes('cash') || cat.includes('bank') || cat.includes('savings')) {
        return sum + (a.value || 0);
      }
      return sum;
    }, 0);

    const target6Month = expenses * 6;
    const isEmergencyFundSafe = cashSum >= target6Month;
    const totalMinEmi = loans.reduce((sum, l) => sum + l.emiAmount, 0);
    const monthlyNetSurplus = Math.max(0, income - expenses - totalMinEmi);

    // AI strategy: allocate part of surplus to prepayment based on emergency fund safety
    const extraBudgetFromSurplus = isEmergencyFundSafe ? monthlyNetSurplus * 0.6 : monthlyNetSurplus * 0.2;

    // Helper: simulate a strategy
    const simulateStrategy = (sortFn, extraMonthlyBudget = 0) => {
      let activeLoans = loans.map(l => ({
        id: l._id.toString(),
        provider: l.provider,
        balance: l.outstandingBalance,
        rate: l.interestRate,
        emi: l.emiAmount,
        originalEmi: l.emiAmount,
      }));

      let totalMinEmiInitial = activeLoans.reduce((sum, l) => sum + l.emi, 0);
      let extraRepaymentPool = extraMonthlyBudget; // starts with extra budget allocated from surplus
      let totalInterestPaid = 0;
      let month = 0;
      let chartData = [{ month: 0, totalDebt: activeLoans.reduce((sum, l) => sum + l.balance, 0) }];
      
      while (month < 360) {
        let currentOutstanding = activeLoans.reduce((sum, l) => sum + l.balance, 0);
        if (currentOutstanding <= 0) break;
        
        month++;
        
        activeLoans = sortFn(activeLoans);
        
        let monthInterest = 0;
        let paymentsThisMonth = {};
        
        // 1. Pay interest and minimum EMIs
        for (let loan of activeLoans) {
          if (loan.balance <= 0) continue;
          
          let monthlyRate = loan.rate / 12 / 100;
          let interest = Number((loan.balance * monthlyRate).toFixed(2));
          monthInterest += interest;
          totalInterestPaid += interest;
          
          let minPayment = Math.min(loan.emi, loan.balance + interest);
          paymentsThisMonth[loan.id] = { min: minPayment, extra: 0, interest };
        }
        
        // Calculate total minimum payment executed
        let totalPaidThisMonth = Object.values(paymentsThisMonth).reduce((s, p) => s + p.min, 0);
        // Extra money available this month
        let extraAvailable = Math.max(0, totalMinEmiInitial - totalPaidThisMonth) + extraRepaymentPool;
        
        // 2. Allocate extra payments to the highest priority loan
        for (let loan of activeLoans) {
          if (loan.balance <= 0) continue;
          let pDetails = paymentsThisMonth[loan.id];
          let remainingBal = loan.balance + pDetails.interest - pDetails.min;
          
          if (remainingBal > 0 && extraAvailable > 0) {
            let extraPay = Math.min(extraAvailable, remainingBal);
            pDetails.extra = extraPay;
            extraAvailable -= extraPay;
          }
        }
        
        // 3. Apply payments and update balances
        for (let loan of activeLoans) {
          if (loan.balance <= 0) continue;
          let pDetails = paymentsThisMonth[loan.id];
          let totalPay = pDetails.min + pDetails.extra;
          let principalPaid = totalPay - pDetails.interest;
          
          loan.balance = Number((loan.balance - principalPaid).toFixed(2));
          if (loan.balance <= 0) {
            loan.balance = 0;
            // Roll completed loan's EMI into the extra repayment pool
            extraRepaymentPool += loan.originalEmi;
          }
        }
        
        let newOutstanding = activeLoans.reduce((sum, l) => sum + l.balance, 0);
        chartData.push({ month, totalDebt: Math.max(0, Number(newOutstanding.toFixed(2))) });
      }

      return {
        monthsToDebtFree: month,
        totalInterest: Number(totalInterestPaid.toFixed(2)),
        chartData,
      };
    };

    // 1. Normal strategy: exact EMIs paid (sorted by original order, no rolling extra cash)
    const normalSim = () => {
      let activeLoans = loans.map(l => ({
        id: l._id.toString(),
        balance: l.outstandingBalance,
        rate: l.interestRate,
        emi: l.emiAmount,
      }));
      let totalInterestPaid = 0;
      let month = 0;
      let chartData = [{ month: 0, totalDebt: activeLoans.reduce((sum, l) => sum + l.balance, 0) }];

      while (month < 360) {
        let currentOutstanding = activeLoans.reduce((sum, l) => sum + l.balance, 0);
        if (currentOutstanding <= 0) break;
        month++;

        for (let loan of activeLoans) {
          if (loan.balance <= 0) continue;
          let monthlyRate = loan.rate / 12 / 100;
          let interest = Number((loan.balance * monthlyRate).toFixed(2));
          totalInterestPaid += interest;

          let payment = Math.min(loan.emi, loan.balance + interest);
          let principalPaid = payment - interest;
          loan.balance = Number((loan.balance - principalPaid).toFixed(2));
          if (loan.balance < 0) loan.balance = 0;
        }

        let newOutstanding = activeLoans.reduce((sum, l) => sum + l.balance, 0);
        chartData.push({ month, totalDebt: Math.max(0, Number(newOutstanding.toFixed(2))) });
      }

      return {
        monthsToDebtFree: month,
        totalInterest: Number(totalInterestPaid.toFixed(2)),
        chartData,
      };
    };

    const normal = normalSim();

    // 2. Snowball strategy: sort loans by balance ascending (smallest first)
    const snowball = simulateStrategy((lList) => {
      return [...lList].sort((a, b) => {
        if (a.balance <= 0 && b.balance > 0) return 1;
        if (b.balance <= 0 && a.balance > 0) return -1;
        return a.balance - b.balance;
      });
    }, extraBudgetFromSurplus);

    // 3. Avalanche strategy: sort loans by interest rate descending (highest first)
    const avalanche = simulateStrategy((lList) => {
      return [...lList].sort((a, b) => {
        if (a.balance <= 0 && b.balance > 0) return 1;
        if (b.balance <= 0 && a.balance > 0) return -1;
        return b.rate - a.rate;
      });
    }, extraBudgetFromSurplus);

    // Determine recommended strategy
    const recommendAvalanche = avalanche.totalInterest <= snowball.totalInterest;
    const recommendedStrategy = recommendAvalanche ? avalanche : snowball;
    const recommendedName = recommendAvalanche ? 'Avalanche Strategy' : 'Snowball Strategy';

    // Payoff Order Providers
    const rawPayoffOrder = [...loans].sort((a, b) => {
      return recommendAvalanche ? (b.interestRate - a.interestRate) : (a.outstandingBalance - b.outstandingBalance);
    });
    const recommendedPayoffOrder = rawPayoffOrder.map(l => ({
      loanId: l._id,
      provider: l.provider,
      emiAmount: l.emiAmount,
      outstandingBalance: l.outstandingBalance,
      interestRate: l.interestRate
    }));

    const interestSaved = Math.max(0, Number((normal.totalInterest - recommendedStrategy.totalInterest).toFixed(2)));
    const timelineReductionMonths = Math.max(0, normal.monthsToDebtFree - recommendedStrategy.monthsToDebtFree);

    const aiDebtStrategy = {
      recommendedStrategy: recommendedName,
      interestSaved,
      timelineReductionMonths,
      recommendedPayoffOrder,
      isEmergencyFundSafe,
      monthlyNetSurplus,
      allocatedPrepaymentBudget: extraBudgetFromSurplus,
      explanation: `We suggest the ${recommendedName} model. By allocating ₹${Math.round(extraBudgetFromSurplus)} of your monthly net surplus (₹${Math.round(monthlyNetSurplus)}) directly into prepaying the highest-priority loans, you will save ₹${interestSaved.toLocaleString()} in interest and become debt-free ${timelineReductionMonths} months sooner.`
    };

    res.json({
      hasLoans: true,
      normal,
      snowball,
      avalanche,
      aiDebtStrategy
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Calculate Loan Health Score (0-100) and Credit metrics
// @route   GET /api/intelligence/health-score
// @access  Private
export const getHealthScore = async (req, res) => {
  try {
    const loans = await Loan.find({ userId: req.user._id });
    const assets = await Asset.find({ userId: req.user._id });
    const goals = await Goal.find({ userId: req.user._id });
    const subscriptions = await Subscription.find({ userId: req.user._id });

    const totalIncome = req.user.income || 50000;
    const expenses = req.user.expenses || 15000;
    const creditScore = 750; // Dynamic default

    // Check and update AI budget (low cost calculation)
    await checkAndIncrementBudget(req.user._id, 1000);

    const healthAnalysis = await getDynamicHealthScoreWithGemini(
      loans,
      assets,
      goals,
      subscriptions,
      totalIncome,
      expenses,
      creditScore
    );

    // Basic calculation for backward compatible sub-metrics in UI
    const totalEmi = loans.reduce((sum, l) => l.status === 'active' ? sum + l.emiAmount : sum, 0);
    const totalOutstanding = loans.reduce((sum, l) => sum + l.outstandingBalance, 0);
    const totalPrincipal = loans.reduce((sum, l) => sum + l.principal, 0);
    const dti = totalIncome > 0 ? (totalEmi / totalIncome) * 100 : 0;
    
    let totalExpectedPayments = 0;
    let totalPaidPayments = 0;
    loans.forEach(loan => {
      const paymentsCount = loan.paymentHistory ? loan.paymentHistory.length : 0;
      totalPaidPayments += paymentsCount;
      const monthsSinceCreation = Math.max(1, Math.min(loan.tenure, paymentsCount + 1));
      totalExpectedPayments += monthsSinceCreation;
    });
    const paymentConsistency = totalExpectedPayments > 0 
      ? (totalPaidPayments / totalExpectedPayments) * 100 
      : 100;

    const creditUtilization = totalPrincipal > 0 
      ? (totalOutstanding / totalPrincipal) * 100 
      : 0;

    const uniqueTypes = new Set(loans.map(l => l.loanType));
    const diversityScore = Math.min(100, uniqueTypes.size * 35);

    res.json({
      healthScore: healthAnalysis.healthScore,
      rating: healthAnalysis.rating,
      debtToIncomeRatio: Math.round(dti),
      paymentConsistency: Math.round(paymentConsistency),
      creditUtilization: Math.round(creditUtilization),
      loanDiversityScore: Math.round(diversityScore),
      defaultRisk: healthAnalysis.defaultRisk,
      explanation: healthAnalysis.explanation,
      weights: healthAnalysis.weights,
      recommendations: healthAnalysis.recommendations
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Analyze uploaded bank statement and populate database
// @route   POST /api/intelligence/analyze-statement
// @access  Private
export const analyzeStatement = async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: 'Please upload a bank statement file.' });
  }

  try {
    // Check and update AI budget to prevent abuse
    await checkAndIncrementBudget(req.user._id, 3000);

    const fileBuffer = req.file.buffer;
    const mimeType = req.file.mimetype;

    const analysis = await analyzeStatementWithGemini(fileBuffer, mimeType);

    // Save detected transactions to Transaction DB
    const savedTransactions = [];
    if (analysis.transactions && Array.isArray(analysis.transactions)) {
      for (const tx of analysis.transactions) {
        const created = await Transaction.create({
          userId: req.user._id,
          description: tx.description || 'Statement Transaction',
          category: tx.category || 'Other',
          amount: Math.abs(tx.amount) || 0,
          date: tx.date ? new Date(tx.date) : new Date(),
          type: tx.type || 'debit',
        });
        savedTransactions.push(created);
      }
    }

    // Save detected subscriptions to Subscription DB
    const savedSubscriptions = [];
    if (analysis.subscriptions && Array.isArray(analysis.subscriptions)) {
      for (const sub of analysis.subscriptions) {
        // Avoid duplicate active subscriptions
        const existing = await Subscription.findOne({ userId: req.user._id, name: sub.name, status: 'active' });
        if (!existing) {
          const created = await Subscription.create({
            userId: req.user._id,
            name: sub.name,
            amount: sub.amount,
            frequency: sub.frequency || 'monthly',
            nextBillingDate: sub.nextBillingDate ? new Date(sub.nextBillingDate) : new Date(),
            status: 'active',
          });
          savedSubscriptions.push(created);
        }
      }
    }

    // Log successful parse
    await DocumentParseLog.create({
      userId: req.user._id,
      fileName: req.file.originalname || 'statement.pdf',
      fileSize: req.file.size || 0,
      status: 'success',
    });

    // Return the response details
    res.json({
      summary: analysis.financialSummary,
      loansDetected: analysis.loans || [],
      subscriptionsCreated: savedSubscriptions,
      transactionsCreatedCount: savedTransactions.length,
    });
  } catch (error) {
    // Log failed parse
    try {
      await DocumentParseLog.create({
        userId: req.user ? req.user._id : null,
        fileName: req.file.originalname || 'statement.pdf',
        fileSize: req.file.size || 0,
        status: 'failed',
        errorMessage: error.message,
      });
    } catch (dbErr) {
      console.error('Failed to log document parse error:', dbErr.message);
    }
    res.status(500).json({ message: error.message });
  }
};

/**
 * Helper to compute user financial health metrics offline.
 */
const computeHealthMetrics = async (userId) => {
  const loans = await Loan.find({ userId });
  const assets = await Asset.find({ userId });
  const user = await User.findById(userId);

  const totalIncome = user ? user.income : 50000;
  const expenses = user ? user.expenses : 15000;

  if (loans.length === 0 && assets.length === 0) {
    return {
      score: 100,
      rating: 'Excellent',
      debtToIncomeRatio: 0,
      paymentConsistency: 100,
      creditUtilization: 0,
      defaultRisk: 'Low',
    };
  }

  let cashSum = 0;
  let equitySum = 0;
  let goldSum = 0;
  let otherSum = 0;

  assets.forEach(asset => {
    const cat = (asset.category || '').toLowerCase();
    const val = asset.value || 0;
    if (cat.includes('cash') || cat.includes('bank') || cat.includes('savings')) {
      cashSum += val;
    } else if (cat.includes('stock') || cat.includes('mutual') || cat.includes('equity') || cat.includes('crypto')) {
      equitySum += val;
    } else if (cat.includes('gold') || cat.includes('commodity')) {
      goldSum += val;
    } else {
      otherSum += val;
    }
  });

  const totalAssets = cashSum + equitySum + goldSum + otherSum;
  const totalEmi = loans.reduce((sum, l) => l.status === 'active' ? sum + l.emiAmount : sum, 0);
  const totalOutstanding = loans.reduce((sum, l) => sum + l.outstandingBalance, 0);
  const totalPrincipal = loans.reduce((sum, l) => sum + l.principal, 0);

  // 1. Savings Ratio
  const surplus = Math.max(0, totalIncome - expenses - totalEmi);
  const savingsRatio = totalIncome > 0 ? surplus / totalIncome : 0;
  const savingsScore = Math.min(20, Math.max(0, Math.round((savingsRatio / 0.3) * 20)));

  // 2. Debt Ratio
  const debtToAsset = totalAssets > 0 ? (totalOutstanding / totalAssets) : (totalOutstanding > 0 ? 1 : 0);
  const debtRatioScore = totalOutstanding === 0 ? 20 : (totalAssets > 0 ? Math.round(Math.min(20, Math.max(0, 20 * (1 - debtToAsset)))) : 0);

  // 3. Emergency Coverage
  const monthsCovered = expenses > 0 ? (cashSum / expenses) : 6;
  const emergencyScore = Math.round(Math.min(20, Math.max(0, (monthsCovered / 6) * 20)));

  // 4. EMI Burden
  const dti = totalIncome > 0 ? (totalEmi / totalIncome) * 100 : 0;
  let emiBurdenScore = 20;
  if (dti > 50) emiBurdenScore = 0;
  else if (dti > 40) emiBurdenScore = 5;
  else if (dti > 30) emiBurdenScore = 10;
  else if (dti > 15) emiBurdenScore = 15;

  // 5. Investment Ratio
  const investmentAssets = equitySum + goldSum + otherSum;
  const investmentRatio = totalAssets > 0 ? (investmentAssets / totalAssets) : 0;
  const investmentScore = totalAssets > 0 ? Math.round(Math.min(20, Math.max(0, (investmentRatio / 0.5) * 20))) : (totalIncome > expenses ? 10 : 0);

  const score = Math.round(savingsScore + debtRatioScore + emergencyScore + emiBurdenScore + investmentScore);

  let rating = 'Critical';
  let defaultRisk = 'High';
  if (score >= 85) { rating = 'Excellent'; defaultRisk = 'Low'; }
  else if (score >= 70) { rating = 'Good'; defaultRisk = 'Low'; }
  else if (score >= 50) { rating = 'Average'; defaultRisk = 'Medium'; }
  else if (score >= 30) { rating = 'Poor'; defaultRisk = 'High'; }

  let totalExpectedPayments = 0;
  let totalPaidPayments = 0;
  loans.forEach(loan => {
    const paymentsCount = loan.paymentHistory ? loan.paymentHistory.length : 0;
    totalPaidPayments += paymentsCount;
    const monthsSinceCreation = Math.max(1, Math.min(loan.tenure, paymentsCount + 1));
    totalExpectedPayments += monthsSinceCreation;
  });
  const paymentConsistency = totalExpectedPayments > 0 ? (totalPaidPayments / totalExpectedPayments) * 100 : 100;
  const creditUtilization = totalPrincipal > 0 ? (totalOutstanding / totalPrincipal) * 100 : 0;

  return {
    score,
    rating,
    debtToIncomeRatio: Math.round(dti),
    paymentConsistency: Math.round(paymentConsistency),
    creditUtilization: Math.round(creditUtilization),
    defaultRisk,
  };
};

// @desc    Get Credit Score Predictions & simulations
// @route   GET /api/intelligence/credit-prediction
// @access  Private
export const getCreditPrediction = async (req, res) => {
  try {
    // Check and update AI budget to prevent abuse
    await checkAndIncrementBudget(req.user._id, 1000);

    const healthData = await computeHealthMetrics(req.user._id);
    const loans = await Loan.find({ userId: req.user._id });
    const user = await User.findById(req.user._id);

    const currentScore = calculateCreditScore(user, loans);
    const projections = simulateCreditProjections(currentScore, loans, 12);

    const chartData = [{
      month: 'Current',
      expected: currentScore,
      defaulted: currentScore,
      prepay: currentScore
    }];

    for (let i = 0; i < 6; i++) {
      chartData.push({
        month: `Month ${i + 1}`,
        expected: projections.expectedPath[i].score,
        defaulted: projections.defaultPath[i].score,
        prepay: projections.prepayPath[i].score,
      });
    }

    const advice = await getCreditPredictionAdviceWithGemini(healthData, {
      expectedStart: currentScore,
      expectedEnd: projections.expectedPath[5].score,
      defaultEnd: projections.defaultPath[5].score,
      prepayEnd: projections.prepayPath[5].score,
    });

    const scenarios = [
      simulateScenario(currentScore, 'miss_emi'),
      simulateScenario(currentScore, 'pay_extra'),
      simulateScenario(currentScore, 'close_loan'),
      simulateScenario(currentScore, 'add_loan')
    ];

    res.json({
      currentScore,
      score: currentScore,
      predictedScore: currentScore,
      defaultRisk: healthData.defaultRisk,
      factors: [
        { name: 'Payment Consistency', description: `Payment consistency is at ${healthData.paymentConsistency}%`, impact: healthData.paymentConsistency >= 85 ? 'positive' : 'negative', score: healthData.paymentConsistency >= 85 ? 15 : -10 },
        { name: 'Debt Utilization', description: `Credit utilization is at ${healthData.creditUtilization}%`, impact: healthData.creditUtilization <= 30 ? 'positive' : 'negative', score: healthData.creditUtilization <= 30 ? 10 : -15 },
        { name: 'Debt-to-Income', description: `Debt-to-income burden is at ${healthData.debtToIncomeRatio}%`, impact: healthData.debtToIncomeRatio <= 35 ? 'positive' : 'negative', score: healthData.debtToIncomeRatio <= 35 ? 10 : -15 }
      ],
      debtToIncomeRatio: healthData.debtToIncomeRatio,
      utilizationRate: healthData.creditUtilization,
      recommendations: [
        healthData.paymentConsistency < 85 ? 'Pay upcoming EMIs on or before the due date to improve consistency.' : 'Maintain your excellent payment discipline.',
        healthData.creditUtilization > 30 ? 'Try to reduce your credit utilization below 30% to boost your score.' : 'Your credit utilization is within a healthy range.',
        healthData.debtToIncomeRatio > 40 ? 'Avoid taking new loans to decrease your debt-to-income ratio.' : 'Your debt-to-income ratio is well-managed.'
      ],
      rating: healthData.rating,
      chartData,
      scenarios,
      advice,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get Wealth Asset Allocation Advice
// @route   GET /api/intelligence/wealth-advice
// @access  Private
export const getWealthAdvice = async (req, res) => {
  const { riskProfile } = req.query;
  const profile = riskProfile || 'Moderate';

  try {
    // Check and update AI budget to prevent abuse
    await checkAndIncrementBudget(req.user._id, 1000);

    const assets = await Asset.find({ userId: req.user._id });
    const loans = await Loan.find({ userId: req.user._id, status: 'active' });

    let cashSum = 0;
    let equitySum = 0;
    let goldSum = 0;
    let otherSum = 0;

    assets.forEach(asset => {
      const cat = asset.category.toLowerCase();
      const val = asset.value || 0;
      if (cat.includes('cash') || cat.includes('bank') || cat.includes('savings')) {
        cashSum += val;
      } else if (cat.includes('stock') || cat.includes('mutual') || cat.includes('equity') || cat.includes('crypto')) {
        equitySum += val;
      } else if (cat.includes('gold') || cat.includes('commodity')) {
        goldSum += val;
      } else {
        otherSum += val;
      }
    });

    const totalAssets = cashSum + equitySum + goldSum + otherSum;

    const currentAllocation = {
      cash: totalAssets > 0 ? Math.round((cashSum / totalAssets) * 100) : 100,
      equity: totalAssets > 0 ? Math.round((equitySum / totalAssets) * 100) : 0,
      gold: totalAssets > 0 ? Math.round((goldSum / totalAssets) * 100) : 0,
      other: totalAssets > 0 ? Math.round((otherSum / totalAssets) * 100) : 0,
    };

    let targetAllocation = { cash: 20, equity: 60, gold: 15, other: 5 };
    let expectedReturn = 10;
    if (profile === 'Conservative') {
      targetAllocation = { cash: 50, equity: 20, gold: 20, other: 10 };
      expectedReturn = 7;
    } else if (profile === 'Aggressive') {
      targetAllocation = { cash: 10, equity: 80, gold: 5, other: 5 };
      expectedReturn = 12;
    }

    const advice = await getWealthAdviceWithGemini(assets, loans, profile, currentAllocation, targetAllocation);

    // Compute dynamic milestones based on user financial profile
    const expenses = req.user.expenses || 15000;
    const netWorth = totalAssets - loans.reduce((s, l) => l.status === 'active' ? s + l.outstandingBalance : s, 0);

    const milestones = [
      {
        name: 'Emergency Fund Setup',
        description: 'Maintain liquid cash equivalent to 3-6 months of declared monthly expenses.',
        achieved: cashSum >= Math.max(30000, expenses * 3),
      },
      {
        name: 'Debt-Free Milestone',
        description: 'Fully repay all active outstanding liability contracts.',
        achieved: loans.length === 0,
      },
      {
        name: 'Positive Net Household Worth',
        description: 'Verify total asset base valuation exceeds current liabilities.',
        achieved: netWorth > 0,
      },
      {
        name: 'Diversified Portfolio Mix',
        description: 'Ensure exposure across both liquid cash and equities or gold.',
        achieved: equitySum > 0 && (goldSum > 0 || otherSum > 0),
      }
    ];

    const highestInterestRate = loans.length > 0 ? Math.max(...loans.map(l => l.interestRate)) : 0;

    const repayVsInvest = {
      highestInterestRate,
      expectedReturn,
      recommendation: (highestInterestRate > expectedReturn) ? 'repay' : 'invest',
      actionableText: (highestInterestRate > expectedReturn)
        ? `Prepaying your loan is mathematically optimal. Your highest interest rate of ${highestInterestRate}% is higher than your expected market return of ${expectedReturn}%.`
        : `Investing is mathematically optimal. Your expected return of ${expectedReturn}% is higher than your highest loan interest rate of ${highestInterestRate}%.`
    };

    const allocations = {
      mutualFunds: profile === 'Aggressive'
        ? '80% Equity Index Funds (Nifty 50 / S&P 500), 20% Active Growth/Midcap Funds'
        : (profile === 'Conservative'
          ? '70% Conservative Debt Mutual Funds, 30% Equity Index Funds'
          : '50% Nifty 50 Index Mutual Funds, 30% Active Large/Midcap, 20% Hybrid/Debt Funds'),
      etfs: profile === 'Aggressive'
        ? '70% Broad-market Equity ETFs, 20% Sectoral/Tech ETFs, 10% Gold ETFs'
        : (profile === 'Conservative'
          ? '60% Liquid/G-Sec ETFs, 25% Gold ETFs, 15% Equity Index ETFs'
          : '50% Equity Index ETFs, 30% Gold/Silver ETFs, 20% Short-term Bond ETFs')
    };

    const emergencyFundAnalysis = analyzeEmergencyFund(cashSum, expenses);
    const allocationAnalysis = analyzeAssetAllocation(currentAllocation, targetAllocation);
    const growthProjections = projectWealthGrowth(
      totalAssets,
      10, // 10% expected return
      loans.reduce((s, l) => l.status === 'active' ? s + l.outstandingBalance : s, 0),
      15, // 15% debt reduction per year
      5
    );

    const strategies = [
      { description: allocationAnalysis.rebalanceRequired ? 'Rebalance your active asset base; current deviations exceed 5% limits.' : 'Rebalance your active asset base to align with your target asset allocation percentages.' },
      { description: loans.length > 0 ? 'Prioritize paying down high-interest liabilities first to release locked monthly cash flow.' : 'Keep liabilities at zero and route all surplus funds into productive investments.' },
      {
        description: profile === 'Aggressive'
          ? 'Route 80% of investment surplus into low-cost equity index funds and direct equities.'
          : (profile === 'Conservative'
            ? 'Allocate the majority of savings into capital-preserving instruments like high-yield savings accounts and debt mutual funds.'
            : 'Maintain a balanced approach with 60% in equities, 15% in gold/commodities, and 20% in liquid cash reserves.')
      }
    ];

    const summary = advice ? (advice.substring(0, 180) + '...') : `Based on your ${profile} profile, we suggest aligning your active holdings towards the target allocation.`;

    res.json({
      riskProfile: profile,
      currentAllocation,
      targetAllocation,
      totalAssetValuation: totalAssets,
      advice,
      summary,
      milestones,
      strategies,
      repayVsInvest,
      allocations,
      emergencyFund: {
        current: emergencyFundAnalysis.current,
        target3Month: emergencyFundAnalysis.target3Month,
        target6Month: emergencyFundAnalysis.target6Month,
        target12Month: emergencyFundAnalysis.target12Month,
        shortfall: emergencyFundAnalysis.shortfall,
        status: emergencyFundAnalysis.status
      },
      allocationAnalysis,
      growthProjections
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Download PDF Financial Report Statement
// @route   GET /api/intelligence/report/pdf
// @access  Private
export const downloadPdfReport = async (req, res) => {
  try {
    const userId = req.user._id;

    const loans = await Loan.find({ userId });
    const assets = await Asset.find({ userId });
    const subscriptions = await Subscription.find({ userId });
    
    const totalAssets = assets.reduce((sum, a) => sum + (a.value || 0), 0);
    const totalLiabilities = loans.reduce((sum, l) => l.status === 'active' ? sum + l.outstandingBalance : sum, 0);
    const netWorth = totalAssets - totalLiabilities;
    const netWorthData = { totalAssets, totalLiabilities, netWorth };

    const subscriptionsCount = subscriptions.filter(s => s.status === 'active').length;
    const subscriptionsBurn = subscriptions.reduce((sum, s) => {
      if (s.status !== 'active') return sum;
      return sum + (s.frequency === 'yearly' ? (s.amount || 0) / 12 : (s.amount || 0));
    }, 0);

    const healthData = await computeHealthMetrics(userId);

    const reportPayload = {
      userId: req.user.email,
      loans,
      netWorthData,
      subscriptionsCount,
      subscriptionsBurn,
      healthData
    };

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename=financial_report.pdf');

    generateFinancialReportPDF(reportPayload, res);
  } catch (error) {
    res.status(500).json({ message: 'Failed to generate report PDF: ' + error.message });
  }
};

// @desc    Get Fraud Alerts for user
// @route   GET /api/intelligence/fraud
// @access  Private
export const getFraudAlerts = async (req, res) => {
  try {
    const alerts = await FraudAlert.find({ userId: req.user._id }).sort({ createdAt: -1 });
    res.json({ alerts, total: alerts.length });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Resolve or dismiss fraud warning log
// @route   PATCH /api/intelligence/fraud/:id
// @access  Private
export const resolveFraudAlert = async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  try {
    const alert = await FraudAlert.findOneAndUpdate(
      { _id: id, userId: req.user._id },
      { status: status || 'resolved' },
      { new: true }
    );
    if (!alert) return res.status(404).json({ message: 'Alert notification not found.' });
    res.json(alert);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Scan arbitrary text for fraud threats
// @route   POST /api/intelligence/scan-text
// @access  Private
export const scanTextForFraud = async (req, res) => {
  const { text, amount, provider, source } = req.body;
  if (!text || typeof text !== 'string') {
    return res.status(400).json({ message: 'text field is required.' });
  }
  try {
    const { scanTransactionForFraud } = await import('../services/fraudEngine.js');
    const alert = await scanTransactionForFraud(
      req.user._id,
      source || 'Manual',
      text,
      parseFloat(amount) || 0,
      provider || 'Unknown'
    );
    if (alert) {
      res.json({ threatDetected: true, alert, message: `Threat detected: ${alert.threatType} (risk: ${alert.riskScore}%)` });
    } else {
      res.json({ threatDetected: false, alert: null, message: 'No threats detected. Transaction appears safe.' });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Retrieve all notification logs (Push, SMS, WhatsApp, Email)
// @route   GET /api/intelligence/notifications
// @access  Private
export const getNotificationCenterLogs = async (req, res) => {
  const { search, status, type } = req.query;
  const userId = req.user._id;

  try {
    let smsPromise = Promise.resolve([]);
    let waPromise = Promise.resolve([]);
    let emailPromise = Promise.resolve([]);
    let pushPromise = Promise.resolve([]);

    // Check which types are requested (or all if not specified)
    const fetchSMS = !type || type === 'sms';
    const fetchWA = !type || type === 'whatsapp';
    const fetchEmail = !type || type === 'email';
    const fetchPush = !type || type === 'push';

    const smsFilter = { userId };
    const waFilter = { userId };
    const emailFilter = { userId };
    const pushFilter = { userId };

    if (status) {
      smsFilter.status = status;
      waFilter.status = status;
      emailFilter.status = status;
      pushFilter.status = status;
    }

    if (fetchSMS) {
      if (search) {
        smsFilter.$or = [
          { message: { $regex: search, $options: 'i' } },
          { phone_number: { $regex: search, $options: 'i' } }
        ];
      }
      smsPromise = SmsLog.find(smsFilter).lean();
    }

    if (fetchWA) {
      if (search) {
        waFilter.message = { $regex: search, $options: 'i' };
      }
      waPromise = WhatsAppLog.find(waFilter).lean();
    }

    if (fetchEmail) {
      if (search) {
        emailFilter.$or = [
          { subject: { $regex: search, $options: 'i' } },
          { body: { $regex: search, $options: 'i' } },
          { to: { $regex: search, $options: 'i' } }
        ];
      }
      emailPromise = EmailLog.find(emailFilter).lean();
    }

    if (fetchPush) {
      if (search) {
        pushFilter.$or = [
          { title: { $regex: search, $options: 'i' } },
          { body: { $regex: search, $options: 'i' } }
        ];
      }
      pushPromise = PushNotificationLog.find(pushFilter).lean();
    }

    const [smsLogs, waLogs, emailLogs, pushLogs] = await Promise.all([
      smsPromise,
      waPromise,
      emailPromise,
      pushPromise,
    ]);

    // Map into normalized format
    const normalized = [];

    smsLogs.forEach(log => {
      normalized.push({
        _id: log._id,
        type: 'sms',
        recipient: log.phone_number,
        title: 'SMS Sent',
        message: log.message,
        status: log.status,
        timestamp: log.createdAt,
      });
    });

    waLogs.forEach(log => {
      normalized.push({
        _id: log._id,
        type: 'whatsapp',
        recipient: '[WhatsApp]',
        title: 'WhatsApp Message Sent',
        message: log.message,
        status: log.status,
        timestamp: log.timestamp || log.createdAt,
      });
    });

    emailLogs.forEach(log => {
      normalized.push({
        _id: log._id,
        type: 'email',
        recipient: log.to,
        title: log.subject,
        message: log.body,
        status: log.status,
        timestamp: log.createdAt,
      });
    });

    pushLogs.forEach(log => {
      normalized.push({
        _id: log._id,
        type: 'push',
        recipient: log.deviceToken || 'FCM Device',
        title: log.title,
        message: log.body,
        status: log.status,
        timestamp: log.createdAt,
      });
    });

    // Sort by timestamp descending
    normalized.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    res.json({ logs: normalized, total: normalized.length });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
// @desc    Calculate SIP future value projections
// @route   POST /api/intelligence/sip-plan
// @access  Private
export const getSipPlan = async (req, res) => {
  const { monthlyInvestment, annualRate, tenureYears } = req.body;
  try {
    const result = calculateSipFutureValue(monthlyInvestment, annualRate, tenureYears);
    res.json(result);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get wealth growth projections over 5 years
// @route   GET /api/intelligence/wealth-projection
// @access  Private
export const getWealthProjection = async (req, res) => {
  try {
    const assets = await Asset.find({ userId: req.user._id });
    const loans = await Loan.find({ userId: req.user._id, status: 'active' });

    const totalAssets = assets.reduce((sum, a) => sum + (a.value || 0), 0);
    const totalDebt = loans.reduce((sum, l) => sum + l.outstandingBalance, 0);

    const projections = projectWealthGrowth(
      totalAssets,
      10, // Default assumed annual asset growth
      totalDebt,
      15, // Default assumed annual liability reduction
      5
    );

    res.json(projections);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Upload document for RAG indexing
// @route   POST /api/intelligence/documents
// @access  Private
export const uploadDocument = async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: 'No file uploaded.' });
  }

  try {
    const doc = await Document.create({
      userId: req.user._id,
      name: req.file.originalname,
      fileSize: req.file.size,
      mimeType: req.file.mimetype,
      status: 'processing',
    });

    // Start background processing without awaiting, so it doesn't block the response
    queueDocumentIndexing(
      req.user._id,
      doc._id,
      req.file.originalname,
      req.file.buffer,
      req.file.mimetype
    ).catch(err => {
      console.error("[uploadDocument] Background indexing error:", err);
    });

    res.status(201).json(doc);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get user's uploaded documents
// @route   GET /api/intelligence/documents
// @access  Private
export const getDocuments = async (req, res) => {
  try {
    const docs = await Document.find({ userId: req.user._id }).sort({ createdAt: -1 });
    res.json(docs);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Delete document and its indexed chunks
// @route   DELETE /api/intelligence/documents/:id
// @access  Private
export const deleteDocument = async (req, res) => {
  try {
    const doc = await Document.findOne({ _id: req.params.id, userId: req.user._id });
    if (!doc) {
      return res.status(404).json({ message: 'Document not found.' });
    }

    // Delete the document record
    await Document.deleteOne({ _id: doc._id });

    // Delete from ChromaDB
    try {
      const collection = await chromaService.getCollection('user_documents');
      await collection.delete({ where: { docId: doc._id.toString() } });
    } catch (chromaErr) {
      console.error('[ChromaDB Delete] Error:', chromaErr);
    }

    res.json({ message: 'Document and its indexed contents successfully deleted.' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Delete all documents for the user
// @route   DELETE /api/intelligence/documents
// @access  Private
export const deleteAllDocuments = async (req, res) => {
  try {
    const userIdStr = req.user._id.toString();
    await Document.deleteMany({ userId: req.user._id });

    // Delete from ChromaDB
    try {
      const collection = await chromaService.getCollection('user_documents');
      await collection.delete({ where: { userId: userIdStr } });
    } catch (chromaErr) {
      console.error('[ChromaDB Delete All] Error:', chromaErr);
    }

    res.json({ message: 'All documents successfully deleted.' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Clear all notification logs (Push, SMS, WhatsApp, Email)
// @route   DELETE /api/intelligence/notifications
// @access  Private
export const clearNotificationCenterLogs = async (req, res) => {
  const userId = req.user._id;
  try {
    await Promise.all([
      SmsLog.deleteMany({ userId }),
      WhatsAppLog.deleteMany({ userId }),
      EmailLog.deleteMany({ userId }),
      PushNotificationLog.deleteMany({ userId })
    ]);
    res.json({ message: 'Recent notifications log cleared successfully.' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
