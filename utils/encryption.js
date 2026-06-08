import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;

// Derives a 32-byte key from ENCRYPTION_KEY or JWT_SECRET fallback
const getKey = () => {
  const secret = process.env.ENCRYPTION_KEY || process.env.JWT_SECRET || 'default_fallback_encryption_key_mitr_ai_2026';
  return crypto.createHash('sha256').update(secret).digest();
};

/**
 * Encrypt plain text using AES-256-GCM.
 * @param {string} text 
 * @returns {string} - formatted as iv:encryptedText:authTag
 */
export const encrypt = (text) => {
  if (!text || typeof text !== 'string') return text;
  
  try {
    const iv = crypto.randomBytes(IV_LENGTH);
    const key = getKey();
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const tag = cipher.getAuthTag().toString('hex');
    
    return `${iv.toString('hex')}:${encrypted}:${tag}`;
  } catch (error) {
    console.error('Encryption failed:', error.message);
    return text;
  }
};

/**
 * Decrypt cipher text using AES-256-GCM.
 * @param {string} encryptedText - formatted as iv:encryptedText:authTag
 * @returns {string} - decrypted plain text
 */
export const decrypt = (encryptedText) => {
  if (!encryptedText || typeof encryptedText !== 'string') return encryptedText;
  
  const parts = encryptedText.split(':');
  if (parts.length !== 3) {
    // Return text directly if not encrypted (legacy records support)
    return encryptedText;
  }
  
  try {
    const iv = Buffer.from(parts[0], 'hex');
    const encrypted = parts[1];
    const tag = Buffer.from(parts[2], 'hex');
    
    const key = getKey();
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (error) {
    console.error('Decryption failed, returning placeholder:', error.message);
    return '[Encrypted/Decryption Failed]';
  }
};
