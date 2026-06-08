import SecurityAudit from '../models/SecurityAudit.js';

/**
 * Log a security-sensitive event to the immutable database log.
 * 
 * @param {Object} req - Express request object (optional, for IP/UA/User context)
 * @param {Object} params - Logging params
 * @param {string} params.action - Event type (e.g. auth_login)
 * @param {string} params.status - 'success' | 'failure'
 * @param {string} [params.userId] - Override user ID if req is not present or user is not in req.user
 * @param {Object} [params.details] - Extra non-sensitive metadata
 */
export const logSecurityEvent = async (req, params) => {
  try {
    const userId = params.userId || (req && req.user ? req.user._id : null);
    const ipAddress = req ? (req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress) : 'system';
    const userAgent = req ? req.headers['user-agent'] : 'system';
    const deviceFingerprint = req ? req.headers['x-device-fingerprint'] : null;

    await SecurityAudit.create({
      userId,
      action: params.action,
      ipAddress,
      userAgent,
      deviceFingerprint,
      status: params.status,
      details: params.details,
    });
  } catch (error) {
    // Fail silently in production, but print to console to prevent blocking main flow
    console.error('Failed to log security audit event:', error.message);
  }
};
