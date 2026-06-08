import mongoose from 'mongoose';

const loanPaymentSchema = new mongoose.Schema(
  {
    loanId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Loan',
      required: true,
    },
    paymentDate: {
      type: Date,
      default: Date.now,
    },
    emiNumber: {
      type: Number,
      required: true,
    },
    emiAmount: {
      type: Number,
      required: true,
    },
    principalPaid: {
      type: Number,
      required: true,
    },
    interestPaid: {
      type: Number,
      required: true,
    },
    outstandingBalance: {
      type: Number,
      required: true,
    },
    paymentStatus: {
      type: String,
      enum: ['success', 'pending', 'failed'],
      default: 'success',
    },
    source: {
      type: String,
      required: true,
    },
    transactionId: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

const LoanPayment = mongoose.model('LoanPayment', loanPaymentSchema);

export default LoanPayment;
