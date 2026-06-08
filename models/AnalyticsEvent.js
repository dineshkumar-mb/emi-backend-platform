import mongoose from 'mongoose';

const analyticsEventSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: false,
    },
    eventName: {
      type: String,
      required: true,
    },
    eventProperties: {
      type: Map,
      of: mongoose.Schema.Types.Mixed,
      required: false,
    },
    platform: {
      type: String,
      required: true,
      enum: ['ios', 'android', 'web', 'unknown'],
      default: 'unknown',
    },
    appVersion: {
      type: String,
      required: true,
      default: '1.0.0',
    },
  },
  {
    timestamps: true,
  }
);

const AnalyticsEvent = mongoose.model('AnalyticsEvent', analyticsEventSchema);
export default AnalyticsEvent;
