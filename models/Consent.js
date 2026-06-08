import mongoose from 'mongoose';

const consentSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    vua: {
      type: String,
      required: true,
    },
    consentId: {
      type: String,
      required: true,
      unique: true,
    },
    status: {
      type: String,
      required: true,
      enum: ['PENDING', 'APPROVED', 'REJECTED', 'EXPIRED'],
      default: 'PENDING',
    },
    digitalSignature: {
      type: String,
      required: false,
    },
    linkedAccounts: [
      {
        accountName: { type: String },
        accountNumberMasked: { type: String },
        bankName: { type: String },
        accountType: { type: String },
      }
    ],
    expireAt: {
      type: Date,
      required: true,
    }
  },
  {
    timestamps: true,
  }
);

const Consent = mongoose.model('Consent', consentSchema);

export default Consent;
