/**
 * Calculates remaining duration and closure date to become debt-free.
 * Works on a single loan or an array of active loans.
 * 
 * @param {Object|Array} input - A single loan object or an array of loan objects
 * @returns {Object} - Countdown statistics
 */
export const calculateDebtCountdown = (input) => {
  const loans = Array.isArray(input) ? input : [input];
  const activeLoans = loans.filter(l => l && l.status === 'active' && l.outstandingBalance > 0);

  if (activeLoans.length === 0) {
    return {
      hasDebt: false,
      remainingDays: 0,
      remainingMonths: 0,
      remainingYears: 0,
      remainingText: '0 Months',
      estimatedClosureDate: null,
      estimatedClosureText: 'N/A',
    };
  }

  let furthestClosureDate = new Date();

  for (const loan of activeLoans) {
    const nextDue = loan.nextDueDate ? new Date(loan.nextDueDate) : new Date();
    
    // Estimate remaining months based on exact financial formula to account for interest
    const emi = loan.emiAmount || (loan.outstandingBalance / 12) || 1;
    const annualRate = loan.interestRate || 0;
    let remainingMonths = 1;

    if (annualRate > 0) {
      const r = annualRate / 12 / 100;
      if (emi > loan.outstandingBalance * r) {
        const remaining = Math.log(emi / (emi - loan.outstandingBalance * r)) / Math.log(1 + r);
        remainingMonths = Math.max(1, Math.ceil(remaining));
      } else {
        remainingMonths = Math.max(1, Math.ceil(loan.outstandingBalance / emi));
      }
    } else {
      remainingMonths = Math.max(1, Math.ceil(loan.outstandingBalance / emi));
    }

    // Calculate closure date for this loan
    const closureDate = new Date(nextDue);
    closureDate.setMonth(closureDate.getMonth() + (remainingMonths - 1));

    if (closureDate > furthestClosureDate) {
      furthestClosureDate = closureDate;
    }
  }

  // Calculate difference from today
  const today = new Date();
  
  // Year and Month differences
  let yearsDiff = furthestClosureDate.getFullYear() - today.getFullYear();
  let monthsDiff = furthestClosureDate.getMonth() - today.getMonth();

  if (monthsDiff < 0) {
    yearsDiff -= 1;
    monthsDiff += 12;
  }

  // Format countdown text
  let remainingText = '';
  if (yearsDiff > 0) {
    remainingText += `${yearsDiff} Year${yearsDiff > 1 ? 's' : ''} `;
  }
  if (monthsDiff > 0 || yearsDiff === 0) {
    remainingText += `${monthsDiff} Month${monthsDiff > 1 ? 's' : ''}`;
  }
  remainingText = remainingText.trim();

  // Format estimated closure text
  const options = { day: '2-digit', month: 'short', year: 'numeric' };
  const closureText = furthestClosureDate.toLocaleDateString('en-GB', options).replace(/ /g, '-');

  return {
    hasDebt: true,
    remainingMonths: yearsDiff * 12 + monthsDiff,
    remainingYears: yearsDiff,
    remainingText,
    estimatedClosureDate: furthestClosureDate,
    estimatedClosureText: closureText,
  };
};

export default calculateDebtCountdown;
