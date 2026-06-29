import mongoose from 'mongoose';

const notificationOutboxSchema = new mongoose.Schema(
  {
    loanId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Loan',
      required: false,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    phone: {
      type: String,
      required: false, // Make false to stay compatible with existing entries using chatId
    },
    chatId: {
      type: String,
      required: false,
    },
    template: {
      type: String,
      default: null,
    },
    notificationType: {
      type: String,
      enum: ['DUE_TOMORROW', 'DUE_TODAY', 'OVERDUE', 'MONTHLY_SUMMARY', 'CREDIT_TIPS', 'MISSED_PAYMENT', 'EMI_DUE_TOMORROW', 'EMI_DUE_TODAY'], // Keep backwards compatibility
      required: false,
    },
    message: {
      type: String,
      required: false,
    },
    payload: {
      type: mongoose.Schema.Types.Mixed, // full context snapshot
    },
    status: {
      type: String,
      enum: ['pending', 'sent', 'failed', 'PENDING', 'IN_PROGRESS', 'SENT', 'FAILED'], // Keep lowercase for backwards compatibility
      default: 'PENDING',
    },
    messageBody: {
      type: String,
    },
    templateUsed: {
      type: String,
    },
    attempts: {
      type: Number,
      default: 0,
    },
    failureReason: {
      type: String,
    },
    lastError: {
      type: String,
      default: null,
    },
    failedAt: {
      type: Date,
    },
    sentAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// Index for duplicate-check query in runSweep()
notificationOutboxSchema.index({ loanId: 1, notificationType: 1, createdAt: -1 });

// Index for status monitoring queries
notificationOutboxSchema.index({ status: 1, createdAt: -1 });

const NotificationOutbox = mongoose.model('NotificationOutbox', notificationOutboxSchema);

export default NotificationOutbox;
