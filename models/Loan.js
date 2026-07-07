import mongoose from 'mongoose';

const loanSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: 'User',
    },
    provider: {
      type: String,
      required: true,
      trim: true,
    },
    loanType: {
      type: String,
      required: true,
      enum: [
        'Personal Loan',
        'Home Loan',
        'Vehicle Loan',
        'Education Loan',
        'Credit Card EMI',
        'BNPL',
        'Gold Loan',
        'Business Loan',
        'Other'
      ],
      default: 'Personal Loan',
    },
    principal: {
      type: Number,
      required: true,
      min: 0,
    },
    interestRate: {
      type: Number,
      required: true,
      min: 0,
    },
    tenure: {
      type: Number,
      required: true, // in months
      min: 1,
    },
    emiAmount: {
      type: Number,
      required: true,
      min: 0,
    },
    outstandingBalance: {
      type: Number,
      required: true,
      min: 0,
    },
    nextDueDate: {
      type: Date,
      required: true,
    },
    autoPayEnabled: {
      type: Boolean,
      default: false,
    },
    autoPayDay: {
      type: Number,
      min: 1,
      max: 31,
      default: null,
    },
    status: {
      type: String,
      required: true,
      enum: ['active', 'completed', 'defaulted'],
      default: 'active',
    },
    paymentHistory: [
      {
        amount: { type: Number, required: true },
        date: { type: Date, default: Date.now },
        refId: { type: String, default: null },
        source: { type: String, enum: ['SMS', 'GPay', 'Manual', 'AutoPay'], default: 'Manual' },
      },
    ],
  },
  {
    timestamps: true,
  }
);

// Database Hooks for field-level encryption
import { encrypt, decrypt } from '../utils/encryption.js';

const decryptLoan = (doc) => {
  if (!doc) return;
  if (doc.paymentHistory && doc.paymentHistory.length > 0) {
    doc.paymentHistory.forEach(p => {
      if (p.refId) {
        p.refId = decrypt(p.refId);
      }
    });
  }
};

loanSchema.pre('save', function (next) {
  if (this.paymentHistory && this.paymentHistory.length > 0) {
    this.paymentHistory.forEach(p => {
      if (p.refId && !p.refId.includes(':')) {
        p.refId = encrypt(p.refId);
      }
    });
  }
  next();
});

loanSchema.post('find', function (docs) {
  if (Array.isArray(docs)) {
    docs.forEach(decryptLoan);
  }
});

loanSchema.post('findOne', function (doc) {
  decryptLoan(doc);
});

loanSchema.post('findOneAndUpdate', function (doc) {
  decryptLoan(doc);
});

loanSchema.post('save', function (doc) {
  decryptLoan(doc);
});

const Loan = mongoose.model('Loan', loanSchema);

export default Loan;
