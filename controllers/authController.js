import User from '../models/User.js';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import Loan from '../models/Loan.js';
import Asset from '../models/Asset.js';
import Goal from '../models/Goal.js';
import Subscription from '../models/Subscription.js';
import Transaction from '../models/Transaction.js';
import FraudAlert from '../models/FraudAlert.js';
import { logSecurityEvent } from '../utils/securityAudit.js';

// Helper to generate access and refresh tokens
const generateSessionTokens = async (req, res, user) => {
  // Access Token (short-lived: 15 minutes)
  const accessToken = jwt.sign({ id: user._id }, process.env.JWT_SECRET, {
    expiresIn: '15m',
  });

  // Refresh Token (long-lived: 30 days)
  const refreshSecret = process.env.JWT_REFRESH_SECRET || (process.env.JWT_SECRET + '_refresh');
  const tokenHash = crypto.randomBytes(32).toString('hex');
  const refreshToken = jwt.sign({ id: user._id, tokenHash }, refreshSecret, {
    expiresIn: '30d',
  });

  // Store in User document
  user.refreshTokens.push({
    tokenHash,
    clientIp: req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress,
    userAgent: req.headers['user-agent'],
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
  });

  // Filter out expired refresh tokens
  user.refreshTokens = user.refreshTokens.filter(rt => rt.expiresAt > new Date());
  await user.save();

  res.cookie('token', accessToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV !== 'development',
    sameSite: 'strict',
    maxAge: 15 * 60 * 1000, // 15 minutes
  });

  res.cookie('refreshToken', refreshToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV !== 'development',
    sameSite: 'strict',
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
  });

  return accessToken;
};

// @desc    Register a new user
// @route   POST /api/auth/signup
// @access  Public
export const registerUser = async (req, res) => {
  const { name, email, password, income, expenses, deviceFingerprint, deviceName } = req.body;

  try {
    const userExists = await User.findOne({ email });

    if (userExists) {
      return res.status(400).json({ message: 'User already exists' });
    }

    const user = await User.create({
      name,
      email,
      password,
      income: income || 0,
      expenses: expenses || 0,
    });

    if (user) {
      if (deviceFingerprint) {
        user.trustedDevices.push({
          fingerprint: deviceFingerprint,
          deviceName: deviceName || 'Initial Device',
          status: 'trusted'
        });
      }

      const token = await generateSessionTokens(req, res, user);

      // Log security event
      await logSecurityEvent(req, {
        action: 'auth_login',
        status: 'success',
        userId: user._id,
        details: { method: 'signup', deviceFingerprint }
      });

      res.status(201).json({
        _id: user._id,
        name: user.name,
        email: user.email,
        token: token,
        income: user.income,
        expenses: user.expenses,
        telegramChatId: user.telegramChatId,
        geo: user.geo,
        consentAI: user.consentAI,
        consentAnalytics: user.consentAnalytics,
        consentProcessing: user.consentProcessing
      });
    } else {
      res.status(400).json({ message: 'Invalid user data' });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Authenticate user & get token
// @route   POST /api/auth/login
// @access  Public
export const loginUser = async (req, res) => {
  const { email, password, deviceFingerprint, deviceName } = req.body;

  try {
    const user = await User.findOne({ email });

    if (user && (await user.matchPassword(password))) {
      // Manage trusted devices
      if (deviceFingerprint) {
        const hasDevice = user.trustedDevices.some(d => d.fingerprint === deviceFingerprint);
        if (!hasDevice) {
          user.trustedDevices.push({
            fingerprint: deviceFingerprint,
            deviceName: deviceName || 'Trusted Device',
            status: 'trusted'
          });
        }
      }

      const token = await generateSessionTokens(req, res, user);

      // Log security event
      await logSecurityEvent(req, {
        action: 'auth_login',
        status: 'success',
        userId: user._id,
        details: { method: 'login', deviceFingerprint }
      });

      res.json({
        _id: user._id,
        name: user.name,
        email: user.email,
        token: token,
        income: user.income,
        expenses: user.expenses,
        telegramChatId: user.telegramChatId,
        geo: user.geo,
        consentAI: user.consentAI,
        consentAnalytics: user.consentAnalytics,
        consentProcessing: user.consentProcessing
      });
    } else {
      // Log failed login event
      const failedUser = user ? user._id : null;
      await logSecurityEvent(req, {
        action: 'auth_login',
        status: 'failure',
        userId: failedUser,
        details: { reason: 'Invalid password or username', email }
      });

      res.status(401).json({ message: 'Invalid email or password' });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Logout user / clear cookie
// @route   POST /api/auth/logout
// @access  Public
export const logoutUser = async (req, res) => {
  try {
    const refreshToken = req.cookies.refreshToken;
    if (refreshToken) {
      const refreshSecret = process.env.JWT_REFRESH_SECRET || (process.env.JWT_SECRET + '_refresh');
      try {
        const decoded = jwt.verify(refreshToken, refreshSecret);
        const user = await User.findById(decoded.id);
        if (user) {
          // Invalidate the current session token from db
          user.refreshTokens = user.refreshTokens.filter(rt => rt.tokenHash !== decoded.tokenHash);
          await user.save();

          await logSecurityEvent(req, {
            action: 'auth_logout',
            status: 'success',
            userId: user._id
          });
        }
      } catch (err) {
        // Token might be expired, just log it out locally
      }
    }

    res.cookie('token', '', {
      httpOnly: true,
      expires: new Date(0),
    });
    res.cookie('refreshToken', '', {
      httpOnly: true,
      expires: new Date(0),
    });

    res.status(200).json({ message: 'Logged out successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get user profile
// @route   GET /api/auth/profile
// @access  Private
export const getUserProfile = async (req, res) => {
  if (req.user) {
    res.json(req.user);
  } else {
    res.status(404).json({ message: 'User not found' });
  }
};

// @desc    Delete user profile (GDPR Right to Erasure)
// @route   DELETE /api/auth/profile
// @access  Private
export const deleteUserProfile = async (req, res) => {
  try {
    const userId = req.user._id;

    // Log security event before deletion
    await logSecurityEvent(req, {
      action: 'account_purge',
      status: 'success',
      userId: userId,
      details: { email: req.user.email }
    });

    // Delete all linked documents
    await Loan.deleteMany({ userId });
    await Asset.deleteMany({ userId });
    await Goal.deleteMany({ userId });
    await Subscription.deleteMany({ userId });
    await Transaction.deleteMany({ userId });
    await FraudAlert.deleteMany({ userId });

    // Delete user profile
    await User.findByIdAndDelete(userId);

    res.cookie('token', '', {
      httpOnly: true,
      expires: new Date(0),
    });
    res.cookie('refreshToken', '', {
      httpOnly: true,
      expires: new Date(0),
    });

    res.status(200).json({ message: 'User profile and all associated financial data successfully deleted.' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Export user data (GDPR Right to Portability)
// @route   GET /api/auth/profile/export
// @access  Private
export const exportUserData = async (req, res) => {
  try {
    const userId = req.user._id;

    const loans = await Loan.find({ userId });
    const assets = await Asset.find({ userId });
    const goals = await Goal.find({ userId });
    const subscriptions = await Subscription.find({ userId });
    const transactions = await Transaction.find({ userId });

    const exportedData = {
      profile: {
        name: req.user.name,
        email: req.user.email,
        income: req.user.income,
        expenses: req.user.expenses,
        geo: req.user.geo
      },
      loans,
      assets,
      goals,
      subscriptions,
      transactions,
      exportedAt: new Date().toISOString()
    };

    // Log security event
    await logSecurityEvent(req, {
      action: 'data_export',
      status: 'success',
      userId: userId
    });

    res.setHeader('Content-disposition', 'attachment; filename=mitr_financial_data.json');
    res.setHeader('Content-type', 'application/json');
    res.write(JSON.stringify(exportedData, null, 2));
    res.end();
  } catch (error) {
    await logSecurityEvent(req, {
      action: 'data_export',
      status: 'failure',
      details: { error: error.message }
    });
    res.status(500).json({ message: error.message });
  }
};

// @desc    Refresh session tokens (Rotation)
// @route   POST /api/auth/refresh
// @access  Public
export const refreshSession = async (req, res) => {
  const refreshToken = req.cookies.refreshToken || req.body.refreshToken;

  if (!refreshToken) {
    return res.status(401).json({ message: 'Refresh token is missing' });
  }

  try {
    const refreshSecret = process.env.JWT_REFRESH_SECRET || (process.env.JWT_SECRET + '_refresh');
    const decoded = jwt.verify(refreshToken, refreshSecret);
    const user = await User.findById(decoded.id);

    if (!user) {
      return res.status(401).json({ message: 'User not found' });
    }

    // Check if tokenHash is in the active list
    const tokenIndex = user.refreshTokens.findIndex(rt => rt.tokenHash === decoded.tokenHash);

    if (tokenIndex === -1) {
      // Token reuse detected! (Possible token theft/hijacking)
      user.refreshTokens = [];
      await user.save();

      // Log security event
      await logSecurityEvent(req, {
        action: 'auth_logout',
        status: 'failure',
        userId: user._id,
        details: { reason: 'Refresh token reuse detected. Revoking all sessions.' }
      });

      res.clearCookie('token');
      res.clearCookie('refreshToken');
      return res.status(403).json({ message: 'Security Alert: Session hijack attempt detected. All sessions revoked.' });
    }

    // Token is valid and exists. Rotate it!
    user.refreshTokens.splice(tokenIndex, 1);

    // Create new tokens
    const newAccessToken = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '15m' });
    const newTokenHash = crypto.randomBytes(32).toString('hex');
    const newRefreshToken = jwt.sign({ id: user._id, tokenHash: newTokenHash }, refreshSecret, { expiresIn: '30d' });

    // Save the new token
    user.refreshTokens.push({
      tokenHash: newTokenHash,
      clientIp: req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress,
      userAgent: req.headers['user-agent'],
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    });
    await user.save();

    // Set cookies
    res.cookie('token', newAccessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV !== 'development',
      sameSite: 'strict',
      maxAge: 15 * 60 * 1000 // 15 minutes
    });

    res.cookie('refreshToken', newRefreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV !== 'development',
      sameSite: 'strict',
      maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days
    });

    res.json({ message: 'Session refreshed successfully' });
  } catch (error) {
    console.error('Session Refresh Error:', error.message);
    res.status(401).json({ message: 'Invalid or expired refresh token' });
  }
};

// @desc    Register a trusted device
// @route   POST /api/auth/device/trust
// @access  Private
export const registerTrustedDevice = async (req, res) => {
  const { fingerprint, deviceName } = req.body;
  if (!fingerprint) {
    return res.status(400).json({ message: 'Device fingerprint is required' });
  }
  try {
    const user = await User.findById(req.user._id);
    const exists = user.trustedDevices.some(d => d.fingerprint === fingerprint);
    if (!exists) {
      user.trustedDevices.push({
        fingerprint,
        deviceName: deviceName || 'Unknown Device',
        status: 'trusted'
      });
      await user.save();

      await logSecurityEvent(req, {
        action: 'consent_change',
        status: 'success',
        details: { message: `Device registered: ${deviceName}`, fingerprint }
      });
    }
    res.json({ message: 'Device registered successfully', trustedDevices: user.trustedDevices });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// @desc    Update GDPR consent settings
// @route   PATCH /api/auth/consent
// @access  Private
export const updateConsent = async (req, res) => {
  const { consentAI, consentAnalytics, consentProcessing } = req.body;
  try {
    const user = await User.findById(req.user._id);
    
    const oldConsent = {
      consentAI: user.consentAI,
      consentAnalytics: user.consentAnalytics,
      consentProcessing: user.consentProcessing
    };

    if (consentAI !== undefined) user.consentAI = consentAI;
    if (consentAnalytics !== undefined) user.consentAnalytics = consentAnalytics;
    if (consentProcessing !== undefined) user.consentProcessing = consentProcessing;
    
    user.consentChangedAt = new Date();
    await user.save();

    await logSecurityEvent(req, {
      action: 'consent_change',
      status: 'success',
      details: {
        previous: oldConsent,
        updated: {
          consentAI: user.consentAI,
          consentAnalytics: user.consentAnalytics,
          consentProcessing: user.consentProcessing
        }
      }
    });

    res.json({
      message: 'GDPR consent settings updated successfully',
      consent: {
        consentAI: user.consentAI,
        consentAnalytics: user.consentAnalytics,
        consentProcessing: user.consentProcessing,
        consentChangedAt: user.consentChangedAt
      }
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
