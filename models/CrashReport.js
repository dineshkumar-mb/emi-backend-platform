import mongoose from 'mongoose';

const crashReportSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: false, // Can be anonymous if crashed before login
    },
    errorMessage: {
      type: String,
      required: true,
    },
    errorStack: {
      type: String,
      required: false,
    },
    deviceInfo: {
      type: Map,
      of: String,
      required: false,
    },
    appVersion: {
      type: String,
      required: true,
      default: '1.0.0',
    },
    platform: {
      type: String,
      required: true,
      enum: ['ios', 'android', 'web', 'unknown'],
      default: 'unknown',
    },
  },
  {
    timestamps: true,
  }
);

const CrashReport = mongoose.model('CrashReport', crashReportSchema);
export default CrashReport;
