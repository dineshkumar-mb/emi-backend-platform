import Consent from '../models/Consent.js';
import Asset from '../models/Asset.js';
import Loan from '../models/Loan.js';
import Transaction from '../models/Transaction.js';
import crypto from 'crypto';

/**
 * Generate a new consent request for the user's VUA (Virtual Unified Address)
 * @param {string} userId 
 * @param {string} vua 
 * @returns {Promise<Object>}
 */
export const requestConsent = async (userId, vua) => {
  const consentId = `consent-${crypto.randomBytes(8).toString('hex')}`;
  const expireAt = new Date();
  expireAt.setMonth(expireAt.getMonth() + 1); // 1 month validity

  const newConsent = await Consent.create({
    userId,
    vua,
    consentId,
    status: 'PENDING',
    expireAt,
  });

  return newConsent;
};

/**
 * Simulates user approving the consent request via an external Consent Manager app.
 * @param {string} consentId 
 * @returns {Promise<Object>}
 */
export const approveConsent = async (consentId) => {
  const consent = await Consent.findOne({ consentId });
  if (!consent) {
    throw new Error('Consent request not found.');
  }

  if (consent.status !== 'PENDING') {
    throw new Error(`Consent is already ${consent.status}`);
  }

  // Generate a mock digital signature to simulate authentic verification
  const digitalSignature = crypto.createHash('sha256').update(consentId + Date.now().toString()).digest('hex');

  // Define mock accounts linked under this consent
  const linkedAccounts = [
    {
      accountName: 'HDFC Savings Account',
      accountNumberMasked: 'XXXXXX8921',
      bankName: 'HDFC Bank',
      accountType: 'SAVINGS'
    },
    {
      accountName: 'SBI Home Loan Account',
      accountNumberMasked: 'XXXXXX5032',
      bankName: 'State Bank of India',
      accountType: 'LOAN'
    },
    {
      accountName: 'ICICI Amazon Pay Credit Card',
      accountNumberMasked: 'XXXXXX1104',
      bankName: 'ICICI Bank',
      accountType: 'CREDIT_CARD'
    }
  ];

  consent.status = 'APPROVED';
  consent.digitalSignature = digitalSignature;
  consent.linkedAccounts = linkedAccounts;
  await consent.save();

  return consent;
};

/**
 * Fetches data from mock FIPs under the approved consent and syncs it into the database.
 * @param {string} consentId 
 * @returns {Promise<Object>}
 */
export const syncConsentData = async (consentId) => {
  const consent = await Consent.findOne({ consentId });
  if (!consent) {
    throw new Error('Consent request not found.');
  }

  if (consent.status !== 'APPROVED') {
    throw new Error(`Cannot fetch data. Consent is in ${consent.status} state.`);
  }

  const userId = consent.userId;

  // 1. Sync Assets (Savings Accounts / Deposits)
  // Let's create or update the corresponding assets in the db
  const asset1 = await Asset.findOneAndUpdate(
    { userId, name: 'HDFC Savings Account' },
    {
      userId,
      name: 'HDFC Savings Account',
      type: 'Cash',
      category: 'Cash',
      value: 145000,
      interestRate: 3.5
    },
    { upsert: true, new: true }
  );

  const asset2 = await Asset.findOneAndUpdate(
    { userId, name: 'ICICI Amazon Pay Credit Card' },
    {
      userId,
      name: 'ICICI Amazon Pay Credit Card',
      type: 'Liability',
      category: 'Credit Card',
      value: -15400, // Credit card balance is a negative asset / liability
      interestRate: 36.0
    },
    { upsert: true, new: true }
  );

  // 2. Sync Loans
  const loan1 = await Loan.findOneAndUpdate(
    { userId, provider: 'State Bank of India', loanType: 'Home Loan' },
    {
      userId,
      provider: 'State Bank of India',
      loanType: 'Home Loan',
      principal: 2500000,
      interestRate: 8.5,
      tenure: 180, // 15 years
      emiAmount: 31012,
      outstandingBalance: 2350000,
      nextDueDate: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000), // Due in 15 days
      status: 'active',
      paymentHistory: [
        {
          amount: 31012,
          paidDate: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000),
          status: 'Paid',
          refId: 'TXN' + crypto.randomBytes(6).toString('hex').toUpperCase(),
          source: 'AUTO-DEBIT'
        }
      ]
    },
    { upsert: true, new: true }
  );

  // 3. Sync recent Transactions (Simulate last month activity)
  const txData = [
    {
      userId,
      amount: 85000,
      type: 'income',
      category: 'Salary',
      description: 'Monthly Salary Credit - ABC Corp',
      date: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
      isAutoParsed: true
    },
    {
      userId,
      amount: 31012,
      type: 'expense',
      category: 'EMI',
      description: 'SBI HOME LOAN AUTO-DEBIT',
      date: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000),
      isAutoParsed: true
    },
    {
      userId,
      amount: 4500,
      type: 'expense',
      category: 'Shopping',
      description: 'Amazon Pay ICICI Card Bill Payment',
      date: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000),
      isAutoParsed: true
    }
  ];

  for (const tx of txData) {
    await Transaction.findOneAndUpdate(
      { userId, description: tx.description, date: tx.date },
      tx,
      { upsert: true }
    );
  }

  return {
    assets: [asset1, asset2],
    loans: [loan1]
  };
};
