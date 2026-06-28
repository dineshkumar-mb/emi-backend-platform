import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    password: {
      type: String,
      required: true,
    },
    income: {
      type: Number,
      default: 0,
    },
    expenses: {
      type: Number,
      default: 0,
    },
    riskScore: {
      type: Number,
      default: 0,
    },
    telegramChatId: {
      type: String,
      default: '-5128959794',
    },
    role: {
      type: String,
      enum: ['user', 'admin', 'support', 'auditor'],
      default: 'user',
    },
    aiDailyUsage: {
      date: { type: String, default: '' },
      count: { type: Number, default: 0 },
      tokensUsed: { type: Number, default: 0 },
    },
    devicePublicKey: {
      type: String,
      default: null, // Stores public key (JWK or PEM) for signature checks
    },
    geo: {
      type: String,
      enum: ['IN', 'US', 'GB', 'EU', 'AE'],
      default: 'IN',
    },
    notificationChannel: {
      type: String,
      enum: ['Telegram', 'WhatsApp'],
      default: 'Telegram',
    },
    notificationSettings: {
      emiReminders: { type: Boolean, default: true },
      paymentAlerts: { type: Boolean, default: true },
      overdueAlerts: { type: Boolean, default: true },
      monthlyReports: { type: Boolean, default: true },
      financialTips: { type: Boolean, default: false },
    },
    whatsappNumber: {
      type: String,
      default: '',
    },
    fcmToken: {
      type: String,
      default: null,
    },
    consentAI: {
      type: Boolean,
      default: true,
    },
    consentAnalytics: {
      type: Boolean,
      default: true,
    },
    consentProcessing: {
      type: Boolean,
      default: true,
    },
    consentChangedAt: {
      type: Date,
      default: Date.now,
    },
    trustedDevices: [
      {
        fingerprint: { type: String, required: true },
        deviceName: { type: String, required: false },
        registeredAt: { type: Date, default: Date.now },
        status: { type: String, enum: ['trusted', 'revoked'], default: 'trusted' },
      }
    ],
    refreshTokens: [
      {
        tokenHash: { type: String, required: true },
        clientIp: { type: String, required: false },
        userAgent: { type: String, required: false },
        createdAt: { type: Date, default: Date.now },
        expiresAt: { type: Date, required: true },
      }
    ],
    resetPasswordToken: String,
    resetPasswordExpire: Date,
  },
  {
    timestamps: true,
  }
);

// Match user-entered password to hashed password in database
userSchema.methods.matchPassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

// Generate and hash password token
userSchema.methods.getResetPasswordToken = function () {
  // Generate token
  const resetToken = crypto.randomBytes(20).toString('hex');

  // Hash token and set to resetPasswordToken field
  this.resetPasswordToken = crypto.createHash('sha256').update(resetToken).digest('hex');

  // Set expire (10 minutes)
  this.resetPasswordExpire = Date.now() + 10 * 60 * 1000;

  return resetToken;
};

// Encrypt password before saving
userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) {
    return next();
  }
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});

const User = mongoose.model('User', userSchema);

export default User;
