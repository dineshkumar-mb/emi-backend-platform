/**
 * Personal Finance Planning Suite & Wealth Advisory Engine.
 * Handles SIP compounding, emergency reserve allocations, asset weight rebalancing analysis,
 * and multi-year wealth growth simulations.
 */

/**
 * Calculates compound wealth from systematic investment plans (SIP).
 * Formula: FV = P * [ ((1 + i)^n - 1) / i ] * (1 + i)
 * where P = monthly investment, i = monthly interest rate, n = number of months.
 */
export const calculateSipFutureValue = (monthlyInvestment, annualRate, tenureYears) => {
  const p = parseFloat(monthlyInvestment) || 0;
  const r = parseFloat(annualRate) / 100 / 12; // Monthly rate
  const n = parseInt(tenureYears) * 12; // Total months

  if (p <= 0 || r <= 0 || n <= 0) return { totalInvested: 0, estimatedWealth: 0, wealthGained: 0 };

  const totalInvested = p * n;
  const estimatedWealth = Math.round(p * ((Math.pow(1 + r, n) - 1) / r) * (1 + r));
  const wealthGained = estimatedWealth - totalInvested;

  return {
    totalInvested,
    estimatedWealth,
    wealthGained
  };
};

/**
 * Evaluates emergency fund status against monthly expense benchmarks.
 */
export const analyzeEmergencyFund = (liquidCash, monthlyExpenses) => {
  const cash = parseFloat(liquidCash) || 0;
  const expenses = parseFloat(monthlyExpenses) || 15000;

  const target3Month = expenses * 3;
  const target6Month = expenses * 6;
  const target12Month = expenses * 12;

  let status = 'UNDERFUNDED';
  if (cash >= target12Month) {
    status = 'EXCELLENT (12M)';
  } else if (cash >= target6Month) {
    status = 'FULLY_FUNDED (6M)';
  } else if (cash >= target3Month) {
    status = 'PARTIALLY_FUNDED (3M)';
  }

  const shortfall = Math.max(0, target6Month - cash);

  return {
    current: cash,
    target3Month,
    target6Month,
    target12Month,
    shortfall,
    status
  };
};

/**
 * Analyzes deviations between current asset allocations and target templates.
 */
export const analyzeAssetAllocation = (currentAlloc, targetAlloc) => {
  const categories = Object.keys(targetAlloc);
  const deviations = {};
  let rebalanceRequired = false;

  categories.forEach(cat => {
    const currVal = currentAlloc[cat] || 0;
    const targetVal = targetAlloc[cat] || 0;
    const diff = currVal - targetVal;
    deviations[cat] = diff;

    // Flag rebalancing if deviation exceeds 5% threshold
    if (Math.abs(diff) > 5) {
      rebalanceRequired = true;
    }
  });

  return {
    deviations,
    rebalanceRequired
  };
};

/**
 * Projects future assets and net worth over 1, 3, and 5 years.
 */
export const projectWealthGrowth = (initialAssets, annualGrowthRate, outstandingLiabilities, annualLiabilityReductionRate, years = 5) => {
  const projection = [];
  let currentAssets = parseFloat(initialAssets) || 0;
  let currentDebt = parseFloat(outstandingLiabilities) || 0;

  for (let y = 1; y <= years; y++) {
    currentAssets = currentAssets * (1 + annualGrowthRate / 100);
    currentDebt = Math.max(0, currentDebt * (1 - annualLiabilityReductionRate / 100));
    const netWorth = currentAssets - currentDebt;

    projection.push({
      year: y,
      projectedAssets: Math.round(currentAssets),
      projectedDebt: Math.round(currentDebt),
      projectedNetWorth: Math.round(netWorth)
    });
  }

  return projection;
};
