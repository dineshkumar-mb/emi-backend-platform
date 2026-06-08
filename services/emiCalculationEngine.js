/**
 * Calculates interest and principal components of an EMI payment.
 * 
 * @param {number} outstandingPrincipal - Current outstanding loan principal
 * @param {number} annualInterestRate - Annual interest rate (e.g. 10.5 for 10.5%)
 * @param {number} emiAmount - The paid/detected EMI amount
 * @returns {Object} - Calculated breakdown
 */
export const calculateEmiBreakdown = (outstandingPrincipal, annualInterestRate, emiAmount) => {
  const principal = Number(outstandingPrincipal) || 0;
  const rate = Number(annualInterestRate) || 0;
  const emi = Number(emiAmount) || 0;

  // monthlyInterest = (outstandingPrincipal * annualInterestRate) / 12 / 100
  const monthlyInterest = Number(((principal * rate) / 12 / 100).toFixed(2));
  
  // principalPaid = emiAmount - monthlyInterest
  let principalPaid = Number((emi - monthlyInterest).toFixed(2));

  // Handle case where interest is larger than EMI or EMI is very small
  if (principalPaid < 0) {
    principalPaid = 0;
  }

  // Handle case where principal paid exceeds current balance
  if (principalPaid > principal) {
    principalPaid = principal;
  }

  // newBalance = outstandingPrincipal - principalPaid
  const newBalance = Number(Math.max(0, principal - principalPaid).toFixed(2));

  return {
    interestPaid: monthlyInterest,
    principalPaid: principalPaid,
    outstandingBalance: newBalance,
  };
};
