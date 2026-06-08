import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import Nonce from '../models/Nonce.js';
import { getDeterministicPayload, verifySignature } from '../utils/signature.js';

/**
 * Protect helper checks for valid JWT in HTTP-Only cookies or Authorization header.
 */
export const protect = async (req, res, next) => {
  let token;

  // Try reading token from cookies or Authorization header
  if (req.cookies && req.cookies.token) {
    token = req.cookies.token;
  } else if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  } else if (req.query && req.query.token) {
    token = req.query.token;
  }

  if (!token) {
    return res.status(401).json({ message: 'Not authorized, no token provided' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = await User.findById(decoded.id).select('-password');
    if (!req.user) {
      return res.status(401).json({ message: 'Not authorized, user not found' });
    }
    next();
  } catch (error) {
    console.error('Authentication Error:', error.message);
    return res.status(401).json({ message: 'Not authorized, token verification failed' });
  }
};

/**
 * Role-Based Access Control middleware for Admin-only operations.
 */
export const requireAdmin = (req, res, next) => {
  if (req.user && req.user.role === 'admin') {
    next();
  } else {
    return res.status(403).json({ message: 'Access denied. Administrator privileges required.' });
  }
};

/**
 * Authorization middleware validating that the active user owns the target loan.
 */
export const checkLoanOwnership = async (req, res, next) => {
  const loanId = req.params.id || req.body.matchedLoanId;
  if (!loanId) {
    return res.status(400).json({ message: 'Loan ID is required for verification.' });
  }

  try {
    const LoanModel = (await import('../models/Loan.js')).default;
    const FamilyModel = (await import('../models/Family.js')).default;

    let loan = await LoanModel.findOne({
      _id: loanId,
      userId: req.user._id,
    });

    // Fallback: Check if shared with any family the user is a member of
    if (!loan) {
      const sharedFamily = await FamilyModel.findOne({
        sharedLoans: loanId,
        'members.userId': req.user._id
      });
      if (sharedFamily) {
        loan = await LoanModel.findById(loanId);
      }
    }

    if (!loan) {
      return res.status(403).json({ message: 'Access denied. You do not own this loan contract.' });
    }

    req.loan = loan; // Attach loan to avoid subsequent DB queries
    next();
  } catch (error) {
    return res.status(500).json({ message: 'Authorization check failed: ' + error.message });
  }
};

/**
 * Middleware ensuring device-bound trust via signature verification and replay prevention.
 */
export const verifyDeviceSignature = async (req, res, next) => {
  const signature = req.headers['x-device-signature'];
  const timestamp = req.headers['x-device-timestamp'];
  const nonce = req.headers['x-device-nonce'];

  if (!signature || !timestamp || !nonce) {
    return res.status(401).json({ message: 'Security signature, timestamp, and nonce headers are required.' });
  }

  // 1. Verify Timestamp Age (within 10 minutes)
  const requestTime = new Date(timestamp).getTime();
  const now = Date.now();
  const ageSeconds = Math.abs(now - requestTime) / 1000;
  if (isNaN(ageSeconds) || ageSeconds > 600) {
    return res.status(401).json({ message: 'Request timestamp is expired or invalid. Replay window closed.' });
  }

  try {
    // 2. Verify Nonce Reuse
    const existingNonce = await Nonce.findOne({ hash: nonce });
    if (existingNonce) {
      return res.status(409).json({ message: 'Replay attack detected. Nonce has already been processed.' });
    }

    // Save Nonce to prevent replay within TTL window
    await Nonce.create({ hash: nonce });

    // 3. Verify Public Key Registration
    if (!req.user.devicePublicKey) {
      return res.status(401).json({ message: 'No registered device key found. Please pair your device first.' });
    }

    // 4. Verify Cryptographic Signature
    const dataStr = getDeterministicPayload(req.body);
    const isValid = verifySignature(req.user.devicePublicKey, signature, dataStr);

    if (!isValid) {
      return res.status(401).json({ message: 'Security validation failed: Invalid cryptographic signature.' });
    }

    next();
  } catch (error) {
    console.error('Signature middleware error:', error.message);
    return res.status(500).json({ message: 'Internal security gateway failure: ' + error.message });
  }
};
