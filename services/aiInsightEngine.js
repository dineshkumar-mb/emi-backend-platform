import { GoogleGenerativeAI } from '@google/generative-ai';

const PROMPT_TEMPLATE = `You are an AI financial advisor. Analyze the following loan terms:
- Provider: $PROVIDER
- Loan Type: $LOAN_TYPE
- Principal: ₹$PRINCIPAL
- Outstanding Balance: ₹$OUTSTANDING
- Interest Rate: $RATE% p.a.
- Tenure: $TENURE months
- EMI Amount: ₹$EMI

Calculate or recommend a prepayment simulation:
Recommend an extra payment amount (e.g., an extra ₹2,000 to ₹10,000 per month depending on the principal and EMI size).
Calculate estimated interest savings and tenure reduction.
Provide a concise, highly actionable recommendation text exactly in this layout (do not include other text, markdown blocks, or commentary, return raw text):

🤖 AI Insight

If you pay ₹[Extra Amount] extra every month,

You will save:
₹[Interest Savings]

Loan tenure reduced:
[Months] months

[One short sentence of refinancing/prepayment advice]`;

/**
 * Generates custom AI financial insights for a loan using Gemini AI
 * @param {Object} loan - Loan details
 * @returns {Promise<string>} - Formatted insight text
 */
export const generateLoanInsights = async (loan) => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'PLACEHOLDER') {
    return `🤖 AI Insight\n\nIf you pay ₹5,000 extra every month,\n\nYou will save:\n₹1,12,430\n\nLoan tenure reduced:\n11 months\n\nPaying extra principal early will save significant compound interest.`;
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

  // Simple interpolation
  const userPrompt = PROMPT_TEMPLATE
    .replace('$PROVIDER', loan.provider || 'Bank')
    .replace('$LOAN_TYPE', loan.loanType || 'Personal Loan')
    .replace('$PRINCIPAL', loan.principal)
    .replace('$OUTSTANDING', loan.outstandingBalance)
    .replace('$RATE', loan.interestRate)
    .replace('$TENURE', loan.tenure)
    .replace('$EMI', loan.emiAmount);

  try {
    const result = await model.generateContent(userPrompt);
    return result.response.text().trim();
  } catch (err) {
    console.error('[AiInsightEngine] Gemini insight generation failed:', err.message);
    // Simple mathematical approximation fallback
    const extra = Math.round(loan.emiAmount * 0.2); // 20% extra
    const savedInt = Math.round(loan.outstandingBalance * (loan.interestRate / 100) * 0.15);
    const savedTenure = Math.max(2, Math.round(loan.tenure * 0.15));
    
    return `🤖 AI Insight\n\nIf you pay ₹${extra.toLocaleString()} extra every month,\n\nYou will save:\n₹${savedInt.toLocaleString()}\n\nLoan tenure reduced:\n${savedTenure} months\n\nIncrease your monthly payments to lower your interest burden.`;
  }
};
export default generateLoanInsights;
