import mongoose from 'mongoose';

const parsedSmsSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    rawText: {
      type: String,
      required: true,
    },
    type: {
      type: String,
      required: true,
      enum: ['EMI_PAYMENT', 'EMI_DEBIT', 'EMI_CREDIT', 'LOAN_DISBURSEMENT', 'LOAN_CLOSURE', 'UNKNOWN'],
      default: 'UNKNOWN',
    },
    amount: {
      type: Number,
      required: false,
      default: 0,
    },
    status: {
      type: String,
      required: true,
      enum: ['SUCCESS', 'FAILED', 'PENDING', 'UNKNOWN'],
      default: 'SUCCESS',
    },
  },
  {
    timestamps: true,
  }
);

const ParsedSms = mongoose.model('ParsedSms', parsedSmsSchema);

export default ParsedSms;
