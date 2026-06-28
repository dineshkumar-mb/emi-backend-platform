import mongoose from 'mongoose';

const notificationLogSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    phone: {
      type: String,
      required: true,
    },
    template: {
      type: String,
      required: true,
    },
    message: {
      type: String,
      required: true,
    },
    loanId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Loan',
      required: false,
    },
    status: {
      type: String,
      required: true,
      default: 'sent', // 'sent', 'delivered', 'failed'
    },
    sentAt: {
      type: Date,
      default: Date.now,
    },
    deliveredAt: {
      type: Date,
      default: null,
    },
    failedReason: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

const NotificationLog = mongoose.model('NotificationLog', notificationLogSchema);

export default NotificationLog;
