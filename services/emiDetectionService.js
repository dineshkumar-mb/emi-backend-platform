import { GoogleGenerativeAI } from '@google/generative-ai';

const SYSTEM_PROMPT = `You are a financial transaction analyzer. Analyze the provided message (SMS, notification, or alert) and detect if it represents an EMI payment, loan payment, or repayment, or a general transaction.

Extract the following details:
- isEMI: true if the message is an EMI or loan payment/debit. Otherwise false.
- transactionType: Classify as one of "EMI_DEBIT", "SALARY_CREDIT", "LOAN_DISBURSED", "GENERAL_DEBIT", "GENERAL_CREDIT".
- provider: The bank or lending institution name (e.g. HDFC, SBI, ICICI, Bajaj).
- amount: The numerical amount paid or credited.
- availableBalance: The numerical available balance after the transaction (if present in the SMS).
- loanType: One of "Personal Loan", "Home Loan", "Vehicle Loan", "Education Loan", "Credit Card EMI", "BNPL", "Gold Loan", "Business Loan", or "Other".
- referenceId: The transaction reference ID or UTR number if present (e.g. UPI transaction ID, bank reference number).
- confidence: A score between 0.0 and 1.0 indicating your confidence in the extraction.

Return ONLY a valid JSON object matching the schema below. Do not include any markdown formatting, headers, or explanations.

Schema:
{
  "isEMI": boolean,
  "transactionType": string | null,
  "provider": string | null,
  "amount": number | null,
  "availableBalance": number | null,
  "loanType": string | null,
  "referenceId": string | null,
  "confidence": number
}`;

/**
 * Detect EMI payment transaction from raw text using Gemini AI
 * @param {string} text - Raw SMS or notification text
 * @returns {Promise<Object>} - Parsed transaction details
 */
export const detectTransactionEMI = async (text) => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'PLACEHOLDER') {
    throw new Error('GEMINI_API_KEY is not configured.');
  }

  if (!text || text.trim().length < 8) {
    return {
      isEMI: false,
      transactionType: null,
      provider: null,
      amount: null,
      availableBalance: null,
      loanType: null,
      referenceId: null,
      confidence: 0.0,
    };
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    generationConfig: { responseMimeType: 'application/json' },
  });

  try {
    const prompt = `${SYSTEM_PROMPT}\n\nTransaction message:\n"${text}"`;
    const result = await model.generateContent(prompt);
    const responseText = result.response.text().trim();
    
    // Strip code fences if returned
    const cleanJson = responseText.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
    const data = JSON.parse(cleanJson);

    // Normalize confidence to 0-1 range
    let conf = data.confidence || 0;
    if (conf > 1) conf = conf / 100; // If AI returned 0-100 range

    return {
      isEMI: !!data.isEMI,
      transactionType: data.transactionType || null,
      provider: data.provider || null,
      amount: Number(data.amount) || null,
      availableBalance: Number(data.availableBalance) || null,
      loanType: data.loanType || null,
      referenceId: data.referenceId || null,
      confidence: conf,
    };
  } catch (error) {
    console.error('[EmiDetectionService] Gemini error:', error.message);
    // Graceful fallback for offline/errors
    return {
      isEMI: text.toLowerCase().includes('emi') || text.toLowerCase().includes('loan'),
      transactionType: text.toLowerCase().includes('debited') ? 'GENERAL_DEBIT' : 'GENERAL_CREDIT',
      provider: null,
      amount: null,
      availableBalance: null,
      loanType: null,
      referenceId: null,
      confidence: 0.5, // low confidence on error fallback
    };
  }
};

/**
 * Decides transaction processing status based on confidence
 * @param {number} confidence - Score between 0.0 and 1.0
 * @returns {string} - 'auto_process' | 'request_verification' | 'ignore'
 */
export const getProcessingAction = (confidence) => {
  if (confidence >= 0.90) {
    return 'auto_process';
  } else if (confidence >= 0.70) {
    return 'request_verification';
  } else {
    return 'ignore';
  }
};
