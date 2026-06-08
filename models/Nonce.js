import mongoose from 'mongoose';

const nonceSchema = new mongoose.Schema(
  {
    hash: {
      type: String,
      required: true,
      unique: true,
    },
    createdAt: {
      type: Date,
      default: Date.now,
      expires: 600, // 10 minutes TTL in seconds
    },
  }
);

const Nonce = mongoose.model('Nonce', nonceSchema);

export default Nonce;
