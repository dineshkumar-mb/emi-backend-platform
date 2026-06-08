import mongoose from 'mongoose';

const securityAuditSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: false,
    },
    action: {
      type: String,
      required: true,
      enum: [
        'auth_login',
        'auth_logout',
        'data_export',
        'account_purge',
        'statement_upload',
        'ai_query',
        'consent_change',
        'encryption_key_rotation'
      ],
    },
    ipAddress: {
      type: String,
      required: false,
    },
    userAgent: {
      type: String,
      required: false,
    },
    deviceFingerprint: {
      type: String,
      required: false,
    },
    status: {
      type: String,
      required: true,
      enum: ['success', 'failure'],
    },
    details: {
      type: mongoose.Schema.Types.Mixed,
      required: false,
    },
    timestamp: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: { createdAt: 'timestamp', updatedAt: false },
  }
);

// Enforce immutability by preventing updates and deletes
const preventModification = function (next) {
  const err = new Error('Security Audit Logs are immutable and cannot be updated or deleted.');
  next(err);
};

securityAuditSchema.pre('save', function (next) {
  if (!this.isNew) {
    return preventModification(next);
  }
  next();
});

securityAuditSchema.pre('updateOne', preventModification);
securityAuditSchema.pre('findOneAndRemove', preventModification);
securityAuditSchema.pre('findOneAndUpdate', preventModification);
securityAuditSchema.pre('deleteOne', preventModification);
securityAuditSchema.pre('deleteMany', preventModification);
securityAuditSchema.pre('remove', preventModification);

const SecurityAudit = mongoose.model('SecurityAudit', securityAuditSchema);

export default SecurityAudit;
