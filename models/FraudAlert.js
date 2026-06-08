import mongoose from 'mongoose';

const fraudAlertSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    transactionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Transaction',
    },
    source: {
      type: String,
      enum: ['SMS', 'Notification', 'Statement'],
      required: true,
    },
    message: {
      type: String,
      required: true,
    },
    riskScore: {
      type: Number,
      default: 0,
    },
    threatType: {
      type: String,
      required: true,
    },
    explanation: {
      type: String,
      default: '',
    },
    status: {
      type: String,
      enum: ['active', 'resolved', 'dismissed'],
      default: 'active',
    },
  },
  {
    timestamps: true,
  }
);

const FraudAlert = mongoose.model('FraudAlert', fraudAlertSchema);

export default FraudAlert;
