import Consent from '../models/Consent.js';
import Asset from '../models/Asset.js';
import Loan from '../models/Loan.js';
import Transaction from '../models/Transaction.js';
import crypto from 'crypto';

/**
 * Generate a new consent request for the user's VUA (Virtual Unified Address)
 * @param {string} userId 
 * @param {string} vua 
 * @param {string} bankId
 * @returns {Promise<Object>}
 */
export const requestConsent = async (userId, vua, bankId = 'sbi') => {
  const consentId = `consent-${crypto.randomBytes(8).toString('hex')}`;
  const expireAt = new Date();
  expireAt.setMonth(expireAt.getMonth() + 1); // 1 month validity

  const newConsent = await Consent.create({
    userId,
    vua,
    bankId,
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

  // Define mock accounts linked under this consent dynamically based on selected bank
  const bankId = consent.bankId || 'sbi';
  let linkedAccounts = [];

  if (bankId === 'hdfc') {
    linkedAccounts = [
      {
        accountName: 'HDFC Savings Account',
        accountNumberMasked: 'XXXXXX8921',
        bankName: 'HDFC Bank',
        accountType: 'SAVINGS'
      },
      {
        accountName: 'HDFC Credit Card',
        accountNumberMasked: 'XXXXXX4032',
        bankName: 'HDFC Bank',
        accountType: 'CREDIT_CARD'
      },
      {
        accountName: 'HDFC Personal Loan Account',
        accountNumberMasked: 'XXXXXX1212',
        bankName: 'HDFC Bank',
        accountType: 'LOAN'
      }
    ];
  } else if (bankId === 'icici') {
    linkedAccounts = [
      {
        accountName: 'ICICI Savings Account',
        accountNumberMasked: 'XXXXXX1044',
        bankName: 'ICICI Bank',
        accountType: 'SAVINGS'
      },
      {
        accountName: 'ICICI Amazon Pay Credit Card',
        accountNumberMasked: 'XXXXXX1104',
        bankName: 'ICICI Bank',
        accountType: 'CREDIT_CARD'
      },
      {
        accountName: 'ICICI Car Loan Account',
        accountNumberMasked: 'XXXXXX7702',
        bankName: 'ICICI Bank',
        accountType: 'LOAN'
      }
    ];
  } else if (bankId === 'axis') {
    linkedAccounts = [
      {
        accountName: 'Axis Savings Account',
        accountNumberMasked: 'XXXXXX6643',
        bankName: 'Axis Bank',
        accountType: 'SAVINGS'
      },
      {
        accountName: 'Axis Personal Loan Account',
        accountNumberMasked: 'XXXXXX5050',
        bankName: 'Axis Bank',
        accountType: 'LOAN'
      }
    ];
  } else {
    // Default or State Bank of India
    linkedAccounts = [
      {
        accountName: 'SBI Savings Account',
        accountNumberMasked: 'XXXXXX2941',
        bankName: 'State Bank of India',
        accountType: 'SAVINGS'
      },
      {
        accountName: 'SBI Home Loan Account',
        accountNumberMasked: 'XXXXXX5032',
        bankName: 'State Bank of India',
        accountType: 'LOAN'
      }
    ];
  }

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
  const bankId = consent.bankId || 'sbi';

  const syncedAssets = [];
  const syncedLoans = [];
  let txData = [];

  if (bankId === 'hdfc') {
    // 1. Sync HDFC Assets
    const asset1 = await Asset.findOneAndUpdate(
      { userId, name: 'HDFC Savings Account' },
      {
        userId,
        name: 'HDFC Savings Account',
        type: 'Cash',
        category: 'Cash',
        value: 185000,
        interestRate: 3.5
      },
      { upsert: true, new: true }
    );
    syncedAssets.push(asset1);

    const asset2 = await Asset.findOneAndUpdate(
      { userId, name: 'HDFC Credit Card' },
      {
        userId,
        name: 'HDFC Credit Card',
        type: 'Liability',
        category: 'Credit Card',
        value: -12400,
        interestRate: 32.0
      },
      { upsert: true, new: true }
    );
    syncedAssets.push(asset2);

    // 2. Sync HDFC Loans
    const loan1 = await Loan.findOneAndUpdate(
      { userId, provider: 'HDFC Bank', loanType: 'Personal Loan' },
      {
        userId,
        provider: 'HDFC Bank',
        loanType: 'Personal Loan',
        principal: 500000,
        interestRate: 11.5,
        tenure: 36,
        emiAmount: 16490,
        outstandingBalance: 320000,
        nextDueDate: new Date(Date.now() + 12 * 24 * 60 * 60 * 1000),
        status: 'active',
        paymentHistory: [
          {
            amount: 16490,
            paidDate: new Date(Date.now() - 18 * 24 * 60 * 60 * 1000),
            status: 'Paid',
            refId: 'TXN' + crypto.randomBytes(6).toString('hex').toUpperCase(),
            source: 'AUTO-DEBIT'
          }
        ]
      },
      { upsert: true, new: true }
    );
    syncedLoans.push(loan1);

    // 3. Transactions
    txData = [
      {
        userId,
        amount: 125000,
        type: 'income',
        category: 'Salary',
        description: 'Monthly Salary Credit - HDFC Corp',
        date: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
        isAutoParsed: true
      },
      {
        userId,
        amount: 16490,
        type: 'expense',
        category: 'EMI',
        description: 'HDFC PERSONAL LOAN AUTO-DEBIT',
        date: new Date(Date.now() - 18 * 24 * 60 * 60 * 1000),
        isAutoParsed: true
      },
      {
        userId,
        amount: 4200,
        type: 'expense',
        category: 'Bills',
        description: 'HDFC CC AUTO-DEBIT PAYMENT',
        date: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
        isAutoParsed: true
      }
    ];
  } else if (bankId === 'icici') {
    // 1. Sync ICICI Assets
    const asset1 = await Asset.findOneAndUpdate(
      { userId, name: 'ICICI Savings Account' },
      {
        userId,
        name: 'ICICI Savings Account',
        type: 'Cash',
        category: 'Cash',
        value: 240000,
        interestRate: 3.6
      },
      { upsert: true, new: true }
    );
    syncedAssets.push(asset1);

    const asset2 = await Asset.findOneAndUpdate(
      { userId, name: 'ICICI Amazon Pay Credit Card' },
      {
        userId,
        name: 'ICICI Amazon Pay Credit Card',
        type: 'Liability',
        category: 'Credit Card',
        value: -15400,
        interestRate: 36.0
      },
      { upsert: true, new: true }
    );
    syncedAssets.push(asset2);

    // 2. Sync ICICI Loans
    const loan1 = await Loan.findOneAndUpdate(
      { userId, provider: 'ICICI Bank', loanType: 'Vehicle Loan' },
      {
        userId,
        provider: 'ICICI Bank',
        loanType: 'Vehicle Loan',
        principal: 800000,
        interestRate: 9.5,
        tenure: 60,
        emiAmount: 16800,
        outstandingBalance: 610000,
        nextDueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
        status: 'active',
        paymentHistory: [
          {
            amount: 16800,
            paidDate: new Date(Date.now() - 16 * 24 * 60 * 60 * 1000),
            status: 'Paid',
            refId: 'TXN' + crypto.randomBytes(6).toString('hex').toUpperCase(),
            source: 'AUTO-DEBIT'
          }
        ]
      },
      { upsert: true, new: true }
    );
    syncedLoans.push(loan1);

    // 3. Transactions
    txData = [
      {
        userId,
        amount: 110000,
        type: 'income',
        category: 'Salary',
        description: 'Monthly Salary Credit - ICICI Corp',
        date: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
        isAutoParsed: true
      },
      {
        userId,
        amount: 16800,
        type: 'expense',
        category: 'EMI',
        description: 'ICICI CAR LOAN AUTO-DEBIT',
        date: new Date(Date.now() - 16 * 24 * 60 * 60 * 1000),
        isAutoParsed: true
      },
      {
        userId,
        amount: 5400,
        type: 'expense',
        category: 'Shopping',
        description: 'ICICI Amazon Pay Bill Payment',
        date: new Date(Date.now() - 12 * 24 * 60 * 60 * 1000),
        isAutoParsed: true
      }
    ];
  } else if (bankId === 'axis') {
    // 1. Sync Axis Assets
    const asset1 = await Asset.findOneAndUpdate(
      { userId, name: 'Axis Savings Account' },
      {
        userId,
        name: 'Axis Savings Account',
        type: 'Cash',
        category: 'Cash',
        value: 110000,
        interestRate: 3.5
      },
      { upsert: true, new: true }
    );
    syncedAssets.push(asset1);

    // 2. Sync Axis Loans
    const loan1 = await Loan.findOneAndUpdate(
      { userId, provider: 'Axis Bank', loanType: 'Personal Loan' },
      {
        userId,
        provider: 'Axis Bank',
        loanType: 'Personal Loan',
        principal: 600000,
        interestRate: 12.0,
        tenure: 48,
        emiAmount: 15800,
        outstandingBalance: 420000,
        nextDueDate: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
        status: 'active',
        paymentHistory: [
          {
            amount: 15800,
            paidDate: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000),
            status: 'Paid',
            refId: 'TXN' + crypto.randomBytes(6).toString('hex').toUpperCase(),
            source: 'AUTO-DEBIT'
          }
        ]
      },
      { upsert: true, new: true }
    );
    syncedLoans.push(loan1);

    // 3. Transactions
    txData = [
      {
        userId,
        amount: 95000,
        type: 'income',
        category: 'Salary',
        description: 'Monthly Salary Credit - Axis Corp',
        date: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
        isAutoParsed: true
      },
      {
        userId,
        amount: 15800,
        type: 'expense',
        category: 'EMI',
        description: 'AXIS PERSONAL LOAN AUTO-DEBIT',
        date: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000),
        isAutoParsed: true
      }
    ];
  } else {
    // default (sbi)
    // 1. Sync SBI Assets
    const asset1 = await Asset.findOneAndUpdate(
      { userId, name: 'SBI Savings Account' },
      {
        userId,
        name: 'SBI Savings Account',
        type: 'Cash',
        category: 'Cash',
        value: 145000,
        interestRate: 3.0
      },
      { upsert: true, new: true }
    );
    syncedAssets.push(asset1);

    // 2. Sync SBI Loans
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
    syncedLoans.push(loan1);

    // 3. Sync recent Transactions
    txData = [
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
      }
    ];
  }

  for (const tx of txData) {
    await Transaction.findOneAndUpdate(
      { userId, description: tx.description, date: tx.date },
      tx,
      { upsert: true }
    );
  }

  return {
    assets: syncedAssets,
    loans: syncedLoans
  };
};
