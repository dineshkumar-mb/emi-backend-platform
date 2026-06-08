/**
 * Deterministic math calculations for EMI and Amortization schedules.
 */

/**
 * Calculate Monthly EMI
 * @param {number} principal - Principal amount
 * @param {number} annualRate - Annual interest rate in percentage (e.g. 10.5 for 10.5%)
 * @param {number} tenureMonths - Tenure in months
 * @returns {number} - Calculated EMI amount (rounded to 2 decimal places)
 */
export const calculateEMI = (principal, annualRate, tenureMonths) => {
  if (!principal || !tenureMonths) return 0;
  if (!annualRate) return Number((principal / tenureMonths).toFixed(2));

  const monthlyRate = annualRate / 12 / 100;
  const emi = (principal * monthlyRate * Math.pow(1 + monthlyRate, tenureMonths)) / 
              (Math.pow(1 + monthlyRate, tenureMonths) - 1);
  
  return Number(emi.toFixed(2));
};

/**
 * Get Amortization Schedule
 * @param {number} principal - Principal amount
 * @param {number} annualRate - Annual interest rate in percentage
 * @param {number} tenureMonths - Tenure in months
 * @returns {Array} - Array of monthly schedules containing payment details
 */
export const getAmortizationSchedule = (principal, annualRate, tenureMonths) => {
  const emi = calculateEMI(principal, annualRate, tenureMonths);
  const monthlyRate = annualRate / 12 / 100;
  
  let balance = principal;
  const schedule = [];

  for (let month = 1; month <= tenureMonths; month++) {
    if (balance <= 0) break;
    
    const interestPaid = Number((balance * monthlyRate).toFixed(2));
    let principalPaid = Number((emi - interestPaid).toFixed(2));
    
    if (principalPaid > balance) {
      principalPaid = balance;
    }
    
    balance = Number((balance - principalPaid).toFixed(2));
    if (balance < 0) balance = 0;

    schedule.push({
      month,
      emi,
      interestPaid,
      principalPaid,
      remainingBalance: balance,
    });
  }

  return schedule;
};

/**
 * Forecast Prepayment Impact
 * @param {number} principal - Original principal
 * @param {number} annualRate - Annual interest rate in percentage
 * @param {number} tenureMonths - Original tenure in months
 * @param {number} prepaymentAmount - Lump-sum prepayment amount
 * @param {number} prepaymentMonth - Month index at which prepayment is made
 * @returns {Object} - Comparison of original vs prepaid loan stats
 */
export const forecastPrepayment = (principal, annualRate, tenureMonths, prepaymentAmount, prepaymentMonth) => {
  const emi = calculateEMI(principal, annualRate, tenureMonths);
  const monthlyRate = annualRate / 12 / 100;

  // Run normal simulation
  const normalSchedule = getAmortizationSchedule(principal, annualRate, tenureMonths);
  const originalTotalInterest = normalSchedule.reduce((sum, item) => sum + item.interestPaid, 0);

  // Run prepaid simulation
  let balance = principal;
  let totalInterestPrepaid = 0;
  let monthsCount = 0;
  const prepaidSchedule = [];

  for (let month = 1; month <= tenureMonths; month++) {
    if (balance <= 0) break;
    monthsCount++;

    const interestPaid = Number((balance * monthlyRate).toFixed(2));
    let principalPaid = Number((emi - interestPaid).toFixed(2));

    if (principalPaid > balance) {
      principalPaid = balance;
    }

    balance = Number((balance - principalPaid).toFixed(2));

    // Apply prepayment lump sum if we reached the prepayment month
    let actualPrepaymentApplied = 0;
    if (month === prepaymentMonth && prepaymentAmount > 0) {
      actualPrepaymentApplied = Math.min(balance, prepaymentAmount);
      balance = Number((balance - actualPrepaymentApplied).toFixed(2));
    }

    totalInterestPrepaid += interestPaid;

    prepaidSchedule.push({
      month,
      emi,
      interestPaid,
      principalPaid,
      prepayment: actualPrepaymentApplied,
      remainingBalance: balance,
    });

    if (balance <= 0) break;
  }

  const interestSaved = Number((originalTotalInterest - totalInterestPrepaid).toFixed(2));
  const tenureSaved = tenureMonths - monthsCount;

  return {
    original: {
      tenureMonths,
      totalInterest: Number(originalTotalInterest.toFixed(2)),
      totalRepayment: Number((principal + originalTotalInterest).toFixed(2)),
    },
    projected: {
      tenureMonths: monthsCount,
      totalInterest: Number(totalInterestPrepaid.toFixed(2)),
      totalRepayment: Number((principal + totalInterestPrepaid).toFixed(2)),
    },
    savings: {
      interestSaved,
      tenureSavedMonths: tenureSaved,
    },
  };
};
