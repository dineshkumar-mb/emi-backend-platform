import Loan from '../models/Loan.js';

/**
 * Finds the best matching active loan for a transaction.
 * Searches by provider name, transaction amount vs. EMI amount, and outstanding balance.
 * 
 * @param {ObjectId} userId - The owner of the loans
 * @param {Object} parsedTx - Parsed transaction data
 * @param {string} parsedTx.provider - Detected bank/lending provider
 * @param {number} parsedTx.amount - Transaction amount
 * @returns {Promise<Object|null>} - Best matched loan and match score
 */
export const findMatchingLoan = async (userId, parsedTx) => {
  const { provider, amount } = parsedTx;

  if (!amount) return null;

  // Retrieve all active loans for the user
  const activeLoans = await Loan.find({ userId, status: 'active' });

  if (activeLoans.length === 0) return null;

  let bestMatch = null;
  let highestScore = 0;

  for (const loan of activeLoans) {
    let score = 0;

    // 1. Provider Matching (Weight: 60%)
    if (provider && loan.provider) {
      const loanProvClean = loan.provider.toLowerCase().replace(/[^a-z0-9]/g, '');
      const txProvClean = provider.toLowerCase().replace(/[^a-z0-9]/g, '');

      if (loanProvClean === txProvClean) {
        score += 60;
      } else if (loanProvClean.includes(txProvClean) || txProvClean.includes(loanProvClean)) {
        score += 40;
      } else {
        // Simple letter overlap check for acronyms or short forms (e.g. HDFC Bank vs HDFC)
        const words1 = loanProvClean.split(' ');
        const words2 = txProvClean.split(' ');
        const hasCommonWord = words1.some(w => w.length > 2 && words2.includes(w));
        if (hasCommonWord) {
          score += 30;
        }
      }
    }

    // 2. Amount Matching (Weight: 40%)
    if (amount && loan.emiAmount) {
      const diffPercent = Math.abs(loan.emiAmount - amount) / loan.emiAmount;
      if (diffPercent === 0) {
        score += 40;
      } else if (diffPercent <= 0.05) {
        score += 25; // 5% tolerance
      } else if (diffPercent <= 0.15) {
        score += 10; // 15% tolerance
      }
    }

    // 3. Outstanding Balance Match (Bonus: 10%)
    if (amount && loan.outstandingBalance) {
      const diffPercent = Math.abs(loan.outstandingBalance - amount) / loan.outstandingBalance;
      if (diffPercent === 0) {
        score += 10;
      }
    }

    if (score > highestScore) {
      highestScore = score;
      bestMatch = loan;
    }
  }

  // Threshold: If score is less than 40, we do not auto-match with high confidence
  if (highestScore >= 40 && bestMatch) {
    return {
      loan: bestMatch,
      score: highestScore, // 0 to 100+
    };
  }

  return null;
};
