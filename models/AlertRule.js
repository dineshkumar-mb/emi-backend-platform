import mongoose from 'mongoose';

const alertRuleSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    metric: {
      type: String,
      required: true,
      enum: ['emi_burden', 'savings_ratio', 'dti'],
    },
    thresholdPercent: {
      type: Number,
      required: true,
    },
    active: {
      type: Boolean,
      default: true,
    }
  },
  {
    timestamps: true,
  }
);

const AlertRule = mongoose.model('AlertRule', alertRuleSchema);

export default AlertRule;
