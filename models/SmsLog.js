import mongoose from 'mongoose';

const smsLogSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    phone_number: {
      type: String,
      required: true,
    },
    message: {
      type: String,
      required: true,
    },
    status: {
      type: String,
      required: true,
      default: 'MOCK_SENT',
    },
  },
  {
    timestamps: true,
  }
);

const SmsLog = mongoose.model('SmsLog', smsLogSchema);

export default SmsLog;
