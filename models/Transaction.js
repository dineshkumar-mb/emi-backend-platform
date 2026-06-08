import mongoose from 'mongoose';

const transactionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: 'User',
    },
    description: {
      type: String,
      required: true,
      trim: true,
    },
    category: {
      type: String,
      required: true,
      enum: [
        'Food',
        'Fuel',
        'Travel',
        'Shopping',
        'Medical',
        'Entertainment',
        'Bills',
        'Insurance',
        'Investments',
        'Loans',
        'Subscriptions',
        'Salary',
        'Other'
      ],
      default: 'Other',
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    date: {
      type: Date,
      required: true,
      default: Date.now,
    },
    type: {
      type: String,
      required: true,
      enum: ['debit', 'credit'],
      default: 'debit',
    },
  },
  {
    timestamps: true,
  }
);

const Transaction = mongoose.model('Transaction', transactionSchema);
export default Transaction;
