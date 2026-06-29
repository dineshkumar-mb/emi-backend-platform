import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';
dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// One model instance, reused across calls (avoids re-initialisation cost)
const model = genAI.getGenerativeModel({
  model: 'gemini-pro',
  generationConfig: {
    maxOutputTokens: 120,     // ~60 words — fits WhatsApp preview
    temperature: 0.4,         // low variance for professional finance messages
    topP: 0.9
  }
});

const SYSTEM_PROMPT = `You are a WhatsApp notification writer for an EMI loan platform.
Rules:
- Max 60 words. No markdown. No lists. Plain conversational text.
- Include: borrower name, exact EMI amount in ₹, due date or days overdue.
- End with a clear call-to-action (e.g., "Pay now to avoid penalties.").
- Tone: friendly but urgent. Never threatening.
- Do NOT include URLs, emojis, or placeholder text.`;

export class NotificationOptimizationAgent {
  /**
   * @param {Object} context
   * @param {'DUE_TOMORROW'|'DUE_TODAY'|'OVERDUE'} context.notificationType
   * @param {string}  context.userName
   * @param {number}  context.emiAmount
   * @param {Date}    context.nextEmiDueDate
   * @param {number}  context.outstandingBalance
   * @param {number}  [context.daysOverdue]  - only for OVERDUE type
   * @param {number}  [context.currentBalance] - For LOW_BALANCE_ALERT
   * @returns {Promise<{ text: string, tokensUsed: number }>}
   */
  static async optimize(context) {
    const {
      notificationType,
      userName,
      emiAmount,
      nextEmiDueDate,
      outstandingBalance,
      daysOverdue,
      currentBalance
    } = context;

    const dueDateStr = nextEmiDueDate
      ? new Date(nextEmiDueDate).toLocaleDateString('en-IN', {
          day: 'numeric', month: 'short', year: 'numeric'
        })
      : 'unknown';

    // Compact user prompt — keeps total input tokens low
    const userPrompt = `
Notification type: ${notificationType}
Borrower name: ${userName}
EMI amount: ₹${emiAmount.toLocaleString('en-IN')}
Due date: ${dueDateStr}
Outstanding balance: ₹${outstandingBalance.toLocaleString('en-IN')}
${notificationType === 'OVERDUE' ? `Days overdue: ${daysOverdue}` : ''}
${notificationType === 'LOW_BALANCE_ALERT' ? `Current Balance: ₹${(currentBalance || 0).toLocaleString('en-IN')} (Shortfall: ₹${(emiAmount - (currentBalance || 0)).toLocaleString('en-IN')})` : ''}

Write the WhatsApp message now.`.trim();

    const result = await model.generateContent([
      { text: SYSTEM_PROMPT },
      { text: userPrompt }
    ]);

    const response = result.response;
    const text = response.text().trim();
    const tokensUsed = response.usageMetadata?.totalTokenCount ?? 0;

    // Sanity check: reject if response is empty or suspiciously long
    if (!text || text.length > 500) {
      throw new Error(`Agent returned invalid output (length: ${text?.length ?? 0})`);
    }

    return { text, tokensUsed };
  }
}
