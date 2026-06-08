import FraudAlert from '../models/FraudAlert.js';
import Transaction from '../models/Transaction.js';

/**
 * Fraud Risk Assessment Engine.
 * Evaluates unknown sender status, link reputation, urgency keywords, statistical amount anomalies,
 * device registration state, and transaction frequency deviations to calculate a consolidated risk rating.
 * 
 * @param {string} userId - Target user ID
 * @param {'SMS' | 'Notification' | 'Statement' | 'Manual'} source - Data origin
 * @param {string} text - Raw alert message text
 * @param {number} amount - Transaction amount
 * @param {string} provider - Bank or merchant provider
 * @param {boolean} isNewDevice - Whether request originates from an unrecognized device
 * @returns {Promise<Object | null>} Active FraudAlert if threat is detected, otherwise null.
 */
export const scanTransactionForFraud = async (userId, source, text, amount, provider, isNewDevice = false) => {
  if (!text) return null;

  const lowerText = text.toLowerCase();
  const reasons = [];
  
  let unknownSenderScore = 0;
  let linkReputationScore = 0;
  let urgencyLanguageScore = 0;
  let amountAnomalyScore = 0;
  let newDeviceScore = 0;
  let paymentPatternScore = 0;

  // Fetch user's historical transactions to compute metrics
  const pastTx = await Transaction.find({ userId }).sort({ createdAt: -1 }).limit(100);
  const now = Date.now();

  // 1. Unknown Sender Score (Max: 20 points)
  if (provider && provider.trim().length > 0 && pastTx.length >= 3) {
    const knownProviders = new Set(pastTx.map(t => (t.provider || '').toLowerCase().trim()));
    const isNewProvider = !knownProviders.has(provider.toLowerCase().trim());
    
    if (isNewProvider) {
      unknownSenderScore = 20;
      reasons.push("Unknown sender: merchant or bank has no matching history in transaction records.");
    }
  }

  // 2. Link Reputation Score (Max: 25 points)
  const shortenerPattern = /(bit\.ly|tinyurl\.com|t\.co|ow\.ly|is\.gd|buff\.ly|rebrand\.ly)/i;
  const isShortened = shortenerPattern.test(lowerText);
  if (isShortened) {
    linkReputationScore = 25;
    reasons.push("Suspicious link: transaction text contains a URL shortener domain often used in scams.");
  }

  // 3. Urgency Language Score (Max: 15 points)
  const isUrgencyKeyword = /suspended|blocked|verify|update|now|immediately|action required|limited time|lucky|win|reward/i.test(lowerText);
  if (isUrgencyKeyword) {
    urgencyLanguageScore = 15;
    reasons.push("Urgency language: trigger words requesting immediate verification or action detected.");
  }

  // 4. Amount Anomaly Score (Max: 20 points)
  if (amount && amount > 0 && pastTx.length >= 5) {
    const amounts = pastTx.map(t => t.amount).filter(a => a > 0);
    const count = amounts.length;
    
    if (count >= 5) {
      const mean = amounts.reduce((sum, val) => sum + val, 0) / count;
      const variance = amounts.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / count;
      const stdDev = Math.sqrt(variance);
      const zScore = stdDev > 0 ? Math.abs(amount - mean) / stdDev : 0;

      if (zScore > 2.5) {
        amountAnomalyScore = 20;
        reasons.push(`Unusual payment amount: transaction is a statistical outlier (Z-Score: ${zScore.toFixed(2)}).`);
      }
    }
  }

  // 5. New Device Score (Max: 10 points)
  if (isNewDevice) {
    newDeviceScore = 10;
    reasons.push("New device: transaction was registered from an unrecognized device.");
  }

  // 6. Payment Pattern Deviation Score (Max: 20 points)
  // Check transaction velocity burst as pattern deviation
  const tenMinsAgo = new Date(now - 10 * 60 * 1000);
  const txInTenMins = pastTx.filter(t => new Date(t.createdAt) >= tenMinsAgo).length;
  if (txInTenMins >= 3) {
    paymentPatternScore = 20;
    reasons.push(`Velocity deviation: ${txInTenMins} transactions executed in the past 10 minutes.`);
  }

  // UPI Collect / OTP context flags
  const isUpiRequest = /requested money|request of|pay to|click to approve|enter pin/i.test(lowerText);
  const isReceiveContext = /receive|credited|refund/i.test(lowerText);
  const isOtpLeak = /otp|one time password|verification code/i.test(lowerText);

  if (isUpiRequest && isReceiveContext) {
    paymentPatternScore = Math.min(20, paymentPatternScore + 10);
    reasons.push("Spoofed payment context: UPI collect request received in credit/refund context.");
  }

  if (isOtpLeak) {
    paymentPatternScore = Math.min(20, paymentPatternScore + 15);
    reasons.push("Sensitive information leak: SMS context includes OTP or verification codes.");
  }

  // Calculate composite risk score
  let fraudRisk = unknownSenderScore + linkReputationScore + urgencyLanguageScore + amountAnomalyScore + newDeviceScore + paymentPatternScore;
  fraudRisk = Math.min(100, fraudRisk);

  // Determine risk level category
  let riskLevel = 'LOW';
  if (fraudRisk >= 85) {
    riskLevel = 'CRITICAL';
  } else if (fraudRisk >= 70) {
    riskLevel = 'HIGH';
  } else if (fraudRisk >= 35) {
    riskLevel = 'MEDIUM';
  }

  // Flag warning alert if score exceeds threshold
  if (fraudRisk >= 30) {
    const compiledExplanation = JSON.stringify({
      fraudRisk,
      riskLevel,
      reasons,
      breakdown: {
        unknownSenderScore,
        linkReputationScore,
        urgencyLanguageScore,
        amountAnomalyScore,
        newDeviceScore,
        paymentPatternScore
      }
    });

    const primaryThreat = reasons.length > 0 ? reasons[0].split(':')[0].toLowerCase().replace(/\s+/g, '_') : 'anomaly_detected';

    const alert = await FraudAlert.create({
      userId,
      source: source === 'Manual' ? 'SMS' : source, // Map manual to SMS for backward compatibility in schema
      message: text,
      riskScore: fraudRisk,
      threatType: primaryThreat,
      status: 'active',
      explanation: compiledExplanation
    });

    console.warn(`[Fraud Assessment Engine] Flagged transaction for user ${userId}. Risk Level: ${riskLevel} (${fraudRisk}%), Reasons: ${reasons.join(', ')}`);
    return alert;
  }

  return null;
};

