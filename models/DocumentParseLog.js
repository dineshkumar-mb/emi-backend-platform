import mongoose from 'mongoose';

const documentParseLogSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: false,
    },
    fileName: {
      type: String,
      required: true,
    },
    fileSize: {
      type: Number,
      required: true,
    },
    status: {
      type: String,
      required: true,
      enum: ['success', 'failed'],
      default: 'success',
    },
    errorMessage: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

const DocumentParseLog = mongoose.model('DocumentParseLog', documentParseLogSchema);

export default DocumentParseLog;
