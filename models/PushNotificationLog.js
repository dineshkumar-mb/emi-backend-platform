import mongoose from 'mongoose';

const pushNotificationLogSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    title: {
      type: String,
      required: true,
    },
    body: {
      type: String,
      required: true,
    },
    deviceToken: {
      type: String,
      required: false,
      default: '[Simulated Device]',
    },
    status: {
      type: String,
      required: true,
      default: 'MOCK_SENT',
    },
    error: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

const PushNotificationLog = mongoose.model('PushNotificationLog', pushNotificationLogSchema);

export default PushNotificationLog;
