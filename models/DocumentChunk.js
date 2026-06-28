import mongoose from 'mongoose';

const documentChunkSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: 'User',
    },
    documentId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: 'Document',
    },
    documentName: {
      type: String,
      required: true,
      trim: true,
    },
    content: {
      type: String,
      required: true,
    },
    contentHash: {
      type: String,
      required: true,
    },
    embedding: {
      type: [Number],
      required: true,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
  }
);

// Indexing for faster lookup per user
documentChunkSchema.index({ userId: 1 });
documentChunkSchema.index({ documentId: 1 });
documentChunkSchema.index({ contentHash: 1 });

const DocumentChunk = mongoose.model('DocumentChunk', documentChunkSchema);
export default DocumentChunk;
