import Loan from '../models/Loan.js';
import Asset from '../models/Asset.js';
import Subscription from '../models/Subscription.js';
import Transaction from '../models/Transaction.js';
import User from '../models/User.js';
import ExcelJS from 'exceljs';
import SmsLog from '../models/SmsLog.js';
import WhatsAppLog from '../models/WhatsAppLog.js';
import EmailLog from '../models/EmailLog.js';
import PushNotificationLog from '../models/PushNotificationLog.js';
import DocumentParseLog from '../models/DocumentParseLog.js';

/**
 * @desc    Get Financial Forecasts (Net Worth, Cash Flow, Debt payoff)
 * @route   GET /api/analytics/forecast
 * @access  Private
 */
export const getForecastAnalytics = async (req, res) => {
  try {
    const userId = req.user._id;
    const user = await User.findById(userId);
    const loans = await Loan.find({ userId, status: 'active' });
    const assets = await Asset.find({ userId });
    const subscriptions = await Subscription.find({ userId });

    const income = user ? user.income : 50000;
    const baseExpenses = user ? user.expenses : 15000;

    // 1. Current Snapshot
    const totalAssets = assets.reduce((sum, a) => sum + (a.value || 0), 0);
    const totalDebt = loans.reduce((sum, l) => sum + (l.outstandingBalance || 0), 0);
    const currentNetWorth = totalAssets - totalDebt;
    
    const monthlySubscriptionsBurn = subscriptions.reduce((sum, s) => sum + (s.amount || 0), 0);
    const monthlyEmiOutflow = loans.reduce((sum, l) => sum + (l.emiAmount || 0), 0);
    const totalMonthlyOutflow = baseExpenses + monthlySubscriptionsBurn + monthlyEmiOutflow;
    const monthlyNetSurplus = Math.max(0, income - totalMonthlyOutflow);

    // 2. Projections Timeline (Next 12 Months)
    const netWorthForecast = [];
    const debtForecast = [];
    const cashFlowForecast = [];

    // Temporary variables to project month-by-month
    let projectedNetWorth = currentNetWorth;
    
    // Deep copy loans for payment schedules
    let projectedLoans = loans.map(l => ({
      outstanding: l.outstandingBalance,
      emi: l.emiAmount,
      rate: l.interestRate / 100 / 12,
      active: true
    }));

    for (let m = 0; m <= 12; m++) {
      const monthLabel = m === 0 ? 'Current' : `Month ${m}`;

      // Calculate total outstanding debt for this month
      const currentMonthDebt = projectedLoans.reduce((sum, l) => l.active ? sum + l.outstanding : 0, 0);
      debtForecast.push({ month: monthLabel, debt: Math.round(currentMonthDebt) });

      // Calculate net worth projection (assuming surplus is saved/invested at a minor 0.5% growth rate)
      if (m > 0) {
        projectedNetWorth = (projectedNetWorth + monthlyNetSurplus) * 1.005;
      }
      netWorthForecast.push({ month: monthLabel, netWorth: Math.round(projectedNetWorth) });

      // Cash Flow (stays relatively fixed but shows changes as loans finish)
      cashFlowForecast.push({
        month: monthLabel,
        income,
        outflow: Math.round(baseExpenses + monthlySubscriptionsBurn + projectedLoans.reduce((sum, l) => l.active ? sum + l.emi : 0, 0)),
        surplus: Math.round(income - (baseExpenses + monthlySubscriptionsBurn + projectedLoans.reduce((sum, l) => l.active ? sum + l.emi : 0, 0)))
      });

      // Update debt outstanding for next month based on amortization
      projectedLoans.forEach(l => {
        if (!l.active) return;
        const interest = l.outstanding * l.rate;
        const principalPaid = Math.min(l.outstanding, l.emi - interest);
        l.outstanding = Math.max(0, l.outstanding - principalPaid);
        if (l.outstanding <= 0) {
          l.active = false;
        }
      });
    }

    // Calculate initial liquid cash balance
    const cashSum = assets.reduce((sum, a) => {
      const cat = (a.category || '').toLowerCase();
      if (cat.includes('cash') || cat.includes('bank') || cat.includes('savings')) {
        return sum + (a.value || 0);
      }
      return sum;
    }, 0);

    // Compute cumulative 30-day, 90-day, and 12-month buckets
    let projectedLoansCashFlow = loans.map(l => ({
      outstanding: l.outstandingBalance,
      emi: l.emiAmount,
      rate: (l.interestRate || 0) / 100 / 12,
      active: true
    }));

    let cumulativeSalary = 0;
    let cumulativeEmi = 0;
    let cumulativeSubscription = 0;
    let cumulativeOther = 0;
    
    let thirtyDay = null;
    let ninetyDay = null;
    let twelveMonth = null;

    for (let m = 1; m <= 12; m++) {
      let emiPaidThisMonth = 0;
      projectedLoansCashFlow.forEach(l => {
        if (!l.active) return;
        const interest = l.outstanding * l.rate;
        const emiPaid = Math.min(l.outstanding + interest, l.emi);
        emiPaidThisMonth += emiPaid;

        const principalPaid = Math.min(l.outstanding, emiPaid - interest);
        l.outstanding = Math.max(0, l.outstanding - principalPaid);
        if (l.outstanding <= 0) {
          l.active = false;
        }
      });

      cumulativeSalary += income;
      cumulativeEmi += emiPaidThisMonth;
      cumulativeSubscription += monthlySubscriptionsBurn;
      cumulativeOther += baseExpenses;

      const totalOutflow = cumulativeEmi + cumulativeSubscription + cumulativeOther;
      const predictedBalance = cashSum + cumulativeSalary - totalOutflow;

      if (m === 1) {
        thirtyDay = {
          salaryInflow: cumulativeSalary,
          emiOutflow: Math.round(cumulativeEmi),
          subscriptionBurn: Math.round(cumulativeSubscription),
          otherOutflow: Math.round(cumulativeOther),
          predictedBalance: Math.round(predictedBalance)
        };
      } else if (m === 3) {
        ninetyDay = {
          salaryInflow: cumulativeSalary,
          emiOutflow: Math.round(cumulativeEmi),
          subscriptionBurn: Math.round(cumulativeSubscription),
          otherOutflow: Math.round(cumulativeOther),
          predictedBalance: Math.round(predictedBalance)
        };
      } else if (m === 12) {
        twelveMonth = {
          salaryInflow: cumulativeSalary,
          emiOutflow: Math.round(cumulativeEmi),
          subscriptionBurn: Math.round(cumulativeSubscription),
          otherOutflow: Math.round(cumulativeOther),
          predictedBalance: Math.round(predictedBalance)
        };
      }
    }

    res.json({
      summary: {
        currentNetWorth,
        totalAssets,
        totalDebt,
        monthlyNetSurplus,
        totalMonthlyOutflow,
        startingLiquidCash: cashSum
      },
      forecasts: {
        netWorth: netWorthForecast,
        debt: debtForecast,
        cashFlow: cashFlowForecast
      },
      cashFlowProjections: {
        thirtyDay,
        ninetyDay,
        twelveMonth
      }
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Export EMI Report & User Summary in Excel format (.xlsx)
// @route   GET /api/analytics/export/excel
// @access  Private
export const exportExcelReport = async (req, res) => {
  try {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'EMI Tracker AI';
    workbook.lastModifiedBy = 'EMI Tracker AI';
    workbook.created = new Date();
    workbook.modified = new Date();

    // Sheet 1: EMI Report
    const emiSheet = workbook.addWorksheet('EMI Report');
    emiSheet.columns = [
      { header: 'Loan Name', key: 'loanName', width: 25 },
      { header: 'EMI Amount', key: 'emiAmount', width: 15 },
      { header: 'Paid EMIs Count', key: 'paidCount', width: 18 },
      { header: 'Total Paid Amount', key: 'paidAmount', width: 18 },
      { header: 'Outstanding Balance', key: 'outstanding', width: 20 },
      { header: 'Due Date', key: 'dueDate', width: 15 },
      { header: 'Status', key: 'status', width: 12 }
    ];

    // Style the header row
    emiSheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    emiSheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF1F497D' } // dark blue
    };

    // Populate EMI sheet data
    const isAdmin = req.user && req.user.role === 'admin';
    const loanFilter = isAdmin ? {} : { userId: req.user._id };
    const loans = await Loan.find(loanFilter).populate('userId');

    loans.forEach(loan => {
      const totalPaid = loan.paymentHistory.reduce((sum, p) => sum + p.amount, 0);
      emiSheet.addRow({
        loanName: `${loan.provider} - ${loan.loanType}`,
        emiAmount: loan.emiAmount,
        paidCount: loan.paymentHistory.length,
        paidAmount: totalPaid,
        outstanding: loan.outstandingBalance,
        dueDate: loan.nextDueDate ? new Date(loan.nextDueDate).toLocaleDateString() : 'N/A',
        status: loan.status.toUpperCase()
      });
    });

    // Sheet 2: User Summary Report
    const userSummarySheet = workbook.addWorksheet('User Summary');
    userSummarySheet.columns = [
      { header: 'User', key: 'userName', width: 25 },
      { header: 'Email', key: 'userEmail', width: 25 },
      { header: 'Loan Count', key: 'loanCount', width: 12 },
      { header: 'Outstanding Balance', key: 'outstanding', width: 20 },
      { header: 'Completion %', key: 'completion', width: 15 }
    ];

    userSummarySheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    userSummarySheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF595959' } // gray
    };

    // If admin, compile rows for all users; if normal user, compile for just this user
    const users = isAdmin ? await User.find() : [req.user];
    
    for (const u of users) {
      const userLoans = await Loan.find({ userId: u._id });
      const loanCount = userLoans.length;
      const totalPrincipal = userLoans.reduce((sum, l) => sum + (l.principal || 0), 0);
      const totalOutstanding = userLoans.reduce((sum, l) => sum + (l.outstandingBalance || 0), 0);
      
      const completionRate = totalPrincipal > 0 
        ? Math.round(((totalPrincipal - totalOutstanding) / totalPrincipal) * 100)
        : (loanCount > 0 ? 100 : 0);

      userSummarySheet.addRow({
        userName: u.name || 'N/A',
        userEmail: u.email,
        loanCount,
        outstanding: totalOutstanding,
        completion: `${completionRate}%`
      });
    }

    // Set response headers and send the Excel file
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader(
      'Content-Disposition',
      'attachment; filename=' + `EMI_Report_${Date.now()}.xlsx`
    );

    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Retrieve telemetry and statistics for internal testing admin dashboard
// @route   GET /api/analytics/admin-stats
// @access  Private
export const getAdminStats = async (req, res) => {
  try {
    const totalUsers = await User.countDocuments();
    
    // An active user is defined as a user who has at least one active loan
    const activeUsersList = await Loan.distinct('userId', { status: 'active' });
    const activeUsersCount = activeUsersList.length;

    const activeLoans = await Loan.countDocuments({ status: 'active' });
    const closedLoans = await Loan.countDocuments({ status: 'completed' });

    const pushSent = await PushNotificationLog.countDocuments({ status: { $in: ['SENT', 'MOCK_SENT'] } });
    const emailsSent = await EmailLog.countDocuments({ status: { $in: ['SENT', 'MOCK_SENT'] } });
    const smsSent = await SmsLog.countDocuments({ status: { $in: ['SENT', 'MOCK_SENT'] } });
    const whatsappSent = await WhatsAppLog.countDocuments({ status: { $in: ['SENT', 'MOCK_SENT'] } });

    const pdfsUploaded = await DocumentParseLog.countDocuments();
    const parsedSuccessfully = await DocumentParseLog.countDocuments({ status: 'success' });
    const failedParsing = await DocumentParseLog.countDocuments({ status: 'failed' });

    res.json({
      users: {
        total: totalUsers,
        active: activeUsersCount,
      },
      loans: {
        active: activeLoans,
        closed: closedLoans,
      },
      notifications: {
        push: pushSent,
        email: emailsSent,
        sms: smsSent,
        whatsapp: whatsappSent,
      },
      documentParsing: {
        uploaded: pdfsUploaded,
        success: parsedSuccessfully,
        failed: failedParsing,
      }
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
