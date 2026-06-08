import mongoose from 'mongoose';

const goalSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: 'User',
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    category: {
      type: String,
      required: true,
      enum: ['House Purchase', 'Car Purchase', 'Marriage Fund', 'Emergency Fund', 'Retirement Fund', 'Vacation Fund', 'Other'],
      default: 'Other',
    },
    targetAmount: {
      type: Number,
      required: true,
      min: 1,
    },
    currentAmount: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },
    targetDate: {
      type: Date,
      required: true,
    },
    recommendation: {
      type: String,
      default: 'AI savings recommendation pending...',
    },
  },
  {
    timestamps: true,
  }
);

const Goal = mongoose.model('Goal', goalSchema);
export default Goal;
