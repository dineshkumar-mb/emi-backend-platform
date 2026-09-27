import mongoose from 'mongoose';

const financialNewsSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true,
  },
  source: {
    type: String,
    required: true,
    index: true,
  },
  url: {
    type: String,
    required: true,
    unique: true,
    trim: true,
  },
  category: {
    type: String,
    default: 'Repo Rate',
    index: true,
  },
  summary: {
    type: String,
    trim: true,
  },
  content: {
    type: String,
  },
  borrowerImpact: {
    type: String,
    default: 'Neutral on existing fixed-rate EMIs, impacts floating-rate loans upon reset date.',
  },
  importanceScore: {
    type: Number,
    default: 7,
    min: 1,
    max: 10,
  },
  keywords: [{
    type: String,
  }],
  repoRateMentioned: {
    type: Boolean,
    default: false,
    index: true,
  },
  currentRepoRate: {
    type: String,
    default: '6.50%',
  },
  publishedDate: {
    type: Date,
    default: Date.now,
    index: true,
  },
}, {
  timestamps: true,
});

export default mongoose.model('FinancialNews', financialNewsSchema);
