/**
 * Credit Health Analytics & Simulation Engine.
 * Calculates credit health index (0-100) based on:
 * - Payment Consistency: 35%
 * - Debt-to-Income Ratio (DTI): 30%
 * - Credit Utilization: 20%
 * - Length of Credit History: 10%
 * - Active Loan Burden & Penalties: 5% (with deductions for defaults/misses)
 */

/**
 * Calculates current credit health score (0-100) based on active loans, payment history, and income.
 */
export const calculateCreditScore = (user, loans) => {
  if (!loans || loans.length === 0) {
    return 100; // Thin-file/zero debt users start with perfect clean record
  }

  const income = user?.income || 50000;
  const totalEmi = loans.reduce((sum, l) => l.status === 'active' ? sum + l.emiAmount : sum, 0);
  const totalPrincipal = loans.reduce((sum, l) => sum + l.principal, 0);
  const totalOutstanding = loans.reduce((sum, l) => sum + l.outstandingBalance, 0);

  // 1. Payment Consistency (35% weight, max 35 points)
  let totalPayments = 0;
  let onTimePayments = 0;
  
  loans.forEach(loan => {
    if (loan.paymentHistory) {
      loan.paymentHistory.forEach((p) => {
        totalPayments++;
        if (p.source !== 'failed') {
          onTimePayments++;
        }
      });
    }
  });

  const paymentRatio = totalPayments > 0 ? onTimePayments / totalPayments : 1.0;
  const paymentPoints = paymentRatio * 35;

  // 2. Debt-to-Income Ratio (30% weight, max 30 points)
  const dti = income > 0 ? (totalEmi / income) * 100 : 0;
  let dtiPoints = 30;
  if (dti > 50) dtiPoints = 5;
  else if (dti > 40) dtiPoints = 12;
  else if (dti > 30) dtiPoints = 20;
  else if (dti > 15) dtiPoints = 26;

  // 3. Credit Utilization (20% weight, max 20 points)
  const utilizationRatio = totalPrincipal > 0 ? totalOutstanding / totalPrincipal : 0.0;
  let utilizationPoints = 20;
  if (utilizationRatio > 0.9) utilizationPoints = 2;
  else if (utilizationRatio > 0.7) utilizationPoints = 6;
  else if (utilizationRatio > 0.5) utilizationPoints = 11;
  else if (utilizationRatio > 0.3) utilizationPoints = 16;

  // 4. Credit History Length (10% weight, max 10 points)
  const avgTenure = loans.reduce((sum, l) => sum + l.tenure, 0) / loans.length;
  let historyPoints = 10;
  if (avgTenure < 12) historyPoints = 3;
  else if (avgTenure < 36) historyPoints = 7;

  // 5. Default Penalties & Active Burden (5% weight, max 5 points)
  const defaultedCount = loans.filter(l => l.status === 'defaulted').length;
  const activeCount = loans.filter(l => l.status === 'active').length;
  
  let penaltyPoints = 5;
  if (defaultedCount > 0) {
    penaltyPoints -= Math.min(5, defaultedCount * 3);
  }
  if (activeCount > 4) {
    penaltyPoints -= 1.5; // excessive loan accounts penalty
  }

  const finalScore = paymentPoints + dtiPoints + utilizationPoints + historyPoints + penaltyPoints;
  return Math.min(100, Math.max(0, Math.round(finalScore)));
};

/**
 * Simulates future credit health score path over N months.
 */
export const simulateCreditProjections = (currentHealth, loans, months = 12) => {
  const expectedPath = [];
  const defaultPath = [];
  const prepayPath = [];

  let exp = currentHealth;
  let def = currentHealth;
  let pre = currentHealth;

  for (let m = 1; m <= months; m++) {
    // 1. Expected path: on-time payments slowly boost health score
    exp = Math.min(100, exp + 0.6 + (m % 3 === 0 ? 0.2 : 0));
    expectedPath.push({ month: m, score: Math.round(exp) });

    // 2. Default path: user misses a payment in Month 2
    if (m === 2) {
      def = Math.max(0, def - 15); // Severe drop
    } else if (m > 2) {
      def = Math.min(100, def + 0.2); // Slow recovery
    } else {
      def = Math.min(100, def + 0.6);
    }
    defaultPath.push({ month: m, score: Math.round(def) });

    // 3. Prepayment path: early closures boost score fast
    pre = Math.min(100, pre + 1.8 + (m % 2 === 0 ? 0.4 : 0));
    prepayPath.push({ month: m, score: Math.round(pre) });
  }

  return {
    months,
    expectedPath,
    defaultPath,
    prepayPath
  };
};

/**
 * Simulates immediate credit health impact of a single scenario.
 */
export const simulateScenario = (currentHealth, scenarioType) => {
  let impact = 0;
  let newScore = currentHealth;
  let explanation = '';

  switch (scenarioType) {
    case 'miss_emi':
      impact = -15;
      explanation = "Missing a scheduled EMI payment severely harms your payment consistency rating, reducing your health index.";
      break;
    case 'pay_extra':
      impact = 5;
      explanation = "Making a prepayment reduces your outstanding debt balance and lowers your credit utilization ratio immediately.";
      break;
    case 'close_loan':
      impact = 8;
      explanation = "Closing a liability account reduces your overall active debt burden and debt-to-income (DTI) ratio.";
      break;
    case 'add_loan':
      impact = -3;
      explanation = "Adding a new loan increases your debt utilization and slightly raises your monthly outflow burden.";
      break;
    default:
      impact = 0;
      explanation = "Scenario not recognized. No credit health impact calculated.";
  }

  newScore = Math.min(100, Math.max(0, currentHealth + impact));

  return {
    scenario: scenarioType,
    impact,
    originalScore: currentHealth,
    projectedScore: newScore,
    explanation
  };
};

