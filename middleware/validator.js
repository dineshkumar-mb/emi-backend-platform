import { z } from 'zod';

/**
 * Zod validation request body wrapper middleware.
 * @param {z.ZodSchema} schema - Zod Schema definition
 */
export const validateRequest = (schema) => {
  return (req, res, next) => {
    try {
      // Validate req.body and replace with parsed (stripped of unexpected fields) value
      req.body = schema.parse(req.body);
      next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        const errorMessages = error.errors.map(err => `${err.path.join('.')}: ${err.message}`).join(', ');
        return res.status(400).json({ message: 'Input validation failed: ' + errorMessages });
      }
      next(error);
    }
  };
};

// ── Validation Schemas ────────────────────────────────────────────────────────

export const signupSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters long'),
  email: z.string().email('Invalid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters long'),
  income: z.number().nonnegative().optional().default(0),
  expenses: z.number().nonnegative().optional().default(0),
});

export const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters long'),
});

export const telegramSchema = z.object({
  telegramChatId: z.string().min(4, 'Telegram Chat ID is required'),
});

export const registerKeySchema = z.object({
  publicKey: z.string().min(10, 'Public key JWK/PEM string is required'),
});

export const geoSchema = z.object({
  geo: z.enum(['IN', 'US', 'GB', 'EU', 'AE'], { invalid_type_error: 'Invalid geo region selection' }),
});

export const loanSchema = z.object({
  provider: z.string().min(1, 'Provider name is required'),
  loanType: z.enum([
    'Personal Loan',
    'Home Loan',
    'Vehicle Loan',
    'Education Loan',
    'Credit Card EMI',
    'BNPL',
    'Gold Loan',
    'Business Loan',
    'Other'
  ], { invalid_type_error: 'Invalid loan classification' }),
  principal: z.number().positive('Principal must be a positive number'),
  interestRate: z.number().positive('Interest rate must be a positive number'),
  tenure: z.number().int().positive('Tenure must be a positive integer in months'),
  emiAmount: z.number().nonnegative().optional(),
  nextDueDate: z.string().refine(val => !isNaN(Date.parse(val)), { message: 'Invalid next due date format' }),
});

export const parseSmsSchema = z.object({
  text: z.string().min(8, 'SMS text must be at least 8 characters long'),
});

export const markPaidSchema = z.object({
  amount: z.number().positive().optional(),
  refId: z.string().nullable().optional(),
  source: z.enum(['SMS', 'GPay', 'Manual']).optional().default('Manual'),
  date: z.string().refine(val => !isNaN(Date.parse(val)), { message: 'Invalid payment date format' }).optional(),
});

export const validatePaymentSchema = z.object({
  parsedPayment: z.object({
    isRelevant: z.boolean(),
    isEMIRelated: z.boolean(),
    channel: z.string(),
    provider: z.string().nullable(),
    merchantOrBank: z.string().nullable(),
    loanType: z.string().nullable(),
    transactionType: z.string(),
    amount: z.number().nullable(),
    currency: z.string().optional().default('INR'),
    paymentStatus: z.string(),
    paymentDate: z.string().nullable(),
    accountEnding: z.string().nullable(),
    referenceIdMasked: z.string().nullable(),
    isRecurringPattern: z.boolean(),
    estimatedMonthlyEMI: z.number().nullable(),
    confidence: z.number(),
    securityFlags: z.array(z.string()).optional().default([]),
    explanation: z.string().optional().default(''),
  }),
  matchedLoanId: z.string().min(12, 'Valid Matched Loan ID is required'),
  engineUsed: z.enum(['local', 'ai']).optional().default('local'),
});

// Zod schema for AI response parsing verification (geminiService)
export const aiParseResultSchema = z.object({
  isRelevant: z.boolean(),
  isEMIRelated: z.boolean(),
  channel: z.enum(['sms', 'notification', 'statement', 'ocr', 'manual', 'unknown']),
  provider: z.string().nullable(),
  merchantOrBank: z.string().nullable(),
  loanType: z.string().nullable(),
  transactionType: z.enum(['debit', 'credit', 'refund', 'autopay', 'upi', 'card_emi', 'loan_payment', 'bank_alert', 'unknown']),
  amount: z.number().nullable(),
  currency: z.string().default('INR'),
  paymentStatus: z.enum(['success', 'failed', 'pending', 'reversed', 'unknown']),
  paymentDate: z.string().nullable(),
  accountEnding: z.string().nullable(),
  referenceIdMasked: z.string().nullable(),
  isRecurringPattern: z.boolean(),
  estimatedMonthlyEMI: z.number().nullable(),
  confidence: z.number().min(0).max(100),
  securityFlags: z.array(z.string()),
  explanation: z.string().default(''),
  classification: z.enum(['EMI', 'Credit Card EMI', 'Loan Payment', 'Subscription', 'Salary', 'Expense', 'Unknown']).optional().default('Unknown'),
});

// Zod schema for Stage-2 AI Validation engine response verification
export const aiValidationResultSchema = z.object({
  validated: z.boolean(),
  riskLevel: z.enum(['low', 'medium', 'high']),
  linkedLoanConfidence: z.number().min(0).max(100),
  recommendation: z.string().default('No recommendation generated.'),
  nextAction: z.enum(['confirm_payment', 'flag_for_review', 'reject_payment', 'request_verification', 'mark_as_paid']),
  manualReviewRequired: z.boolean(),
});

// Zod schema for AI advisor queries
export const advisorSchema = z.object({
  query: z.string().min(1, 'Query is required'),
  useRag: z.boolean().optional().default(false),
});

// Zod schema for Assets CRUD
export const assetSchema = z.object({
  name: z.string().min(1, 'Asset name is required'),
  category: z.enum(['Bank Account', 'Mutual Funds', 'Stocks', 'Gold', 'Real Estate', 'Other']),
  value: z.number().nonnegative('Value must be a positive number'),
});

// Zod schema for Goals CRUD
export const goalSchema = z.object({
  name: z.string().min(1, 'Goal name is required'),
  category: z.enum(['House Purchase', 'Car Purchase', 'Marriage Fund', 'Emergency Fund', 'Retirement Fund', 'Vacation Fund', 'Other']),
  targetAmount: z.number().positive('Target amount must be a positive number'),
  currentAmount: z.number().nonnegative().optional().default(0),
  targetDate: z.string().refine(val => !isNaN(Date.parse(val)), { message: 'Invalid target date format' }),
});

// Zod schema for Subscriptions CRUD
export const subscriptionSchema = z.object({
  name: z.string().min(1, 'Subscription name is required'),
  amount: z.number().nonnegative('Amount must be a positive number'),
  frequency: z.enum(['monthly', 'yearly']),
  nextBillingDate: z.string().refine(val => !isNaN(Date.parse(val)), { message: 'Invalid next billing date format' }).optional(),
});

// Zod schema for Transactions CRUD
export const transactionSchema = z.object({
  description: z.string().min(1, 'Description is required'),
  category: z.enum(['Food', 'Fuel', 'Travel', 'Shopping', 'Medical', 'Entertainment', 'Bills', 'Insurance', 'Investments', 'Loans', 'Subscriptions', 'Salary', 'Other']),
  amount: z.number().nonnegative('Amount must be a positive number'),
  date: z.string().refine(val => !isNaN(Date.parse(val)), { message: 'Invalid date format' }).optional(),
  type: z.enum(['debit', 'credit']).default('debit'),
});

// Zod schema for Feedback & Support
export const feedbackSchema = z.object({
  subject: z.string().min(2, 'Subject must be at least 2 characters long'),
  message: z.string().min(5, 'Message must be at least 5 characters long'),
  category: z.enum(['feedback', 'bug', 'support']).optional().default('feedback'),
});

