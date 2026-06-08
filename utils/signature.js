import crypto from 'crypto';

/**
 * Deterministically serialize a request body by sorting keys recursively.
 * @param {*} obj - Any input object, array, or value
 * @returns {string} - Deterministic JSON string
 */
export const getDeterministicPayload = (obj) => {
  if (obj === null || typeof obj !== 'object') {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return '[' + obj.map(getDeterministicPayload).join(',') + ']';
  }
  const sortedKeys = Object.keys(obj).sort();
  const properties = sortedKeys.map(key => {
    return JSON.stringify(key) + ':' + getDeterministicPayload(obj[key]);
  });
  return '{' + properties.join(',') + '}';
};

/**
 * Verifies a signature against deterministic data using a JWK public key.
 * Supports RSASSA-PKCS1-v1_5 and ECDSA signatures.
 * 
 * @param {string} publicKeyJwkStr - Registered public key in JWK format
 * @param {string} signatureBase64 - Base64 encoded signature
 * @param {string} dataStr - Deterministic message string signed by the client
 * @returns {boolean} - True if signature is valid
 */
export const verifySignature = (publicKeyJwkStr, signatureBase64, dataStr) => {
  try {
    const jwk = JSON.parse(publicKeyJwkStr);
    const publicKey = crypto.createPublicKey({ key: jwk, format: 'jwk' });

    // Detect format type
    const isEcdsa = jwk.kty === 'EC';

    // Verify using crypto.verify
    const verified = crypto.verify(
      isEcdsa ? null : 'sha256', // Algorithm is auto-detected for EC
      Buffer.from(dataStr),
      isEcdsa 
        ? { key: publicKey, dsaEncoding: 'ieee-p1363' } 
        : publicKey,
      Buffer.from(signatureBase64, 'base64')
    );

    return verified;
  } catch (error) {
    console.error('[Signature Verify] Verification error:', error.message);
    return false;
  }
};
