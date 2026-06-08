import path from 'path';

// Standard EICAR test string for anti-virus checks
const EICAR_TEST_STRING = 'X5O!P%@AP[4\\PZX54(P^)7CC7}HHEC-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';

// Allowed MIME types and their corresponding magic bytes (hex prefixes)
const MAGIC_NUMBERS = {
  'application/pdf': [0x25, 0x50, 0x44, 0x46], // %PDF
  'image/png': [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A], // PNG signature
  'image/jpeg': [0xFF, 0xD8, 0xFF], // JPEG start of image
};

export const uploadSecurityMiddleware = (req, res, next) => {
  if (!req.file) {
    return res.status(400).json({ message: 'No file uploaded.' });
  }

  const { buffer, originalname, size, mimetype } = req.file;

  // 1. File Size Controls (Strict Max 5MB limit)
  const MAX_SIZE = 5 * 1024 * 1024;
  if (size > MAX_SIZE) {
    return res.status(400).json({ message: 'File upload blocked: File size exceeds the strict 5MB limit.' });
  }

  // 2. MIME & Extension whitelist check
  const allowedExtensions = ['.pdf', '.png', '.jpg', '.jpeg'];
  const ext = path.extname(originalname).toLowerCase();
  if (!allowedExtensions.includes(ext)) {
    return res.status(400).json({ message: `File upload blocked: Extension "${ext}" is not permitted.` });
  }

  // 3. Magic Bytes Content Validation (Deep content inspection to prevent extension spoofing)
  const allowedMimeTypes = Object.keys(MAGIC_NUMBERS);
  if (!allowedMimeTypes.includes(mimetype)) {
    return res.status(400).json({ message: `File upload blocked: MIME type "${mimetype}" is invalid.` });
  }

  const expectedMagicBytes = MAGIC_NUMBERS[mimetype];
  const actualBytes = Array.from(buffer.slice(0, expectedMagicBytes.length));
  const magicBytesMatch = expectedMagicBytes.every((val, index) => val === actualBytes[index]);

  if (!magicBytesMatch) {
    return res.status(400).json({ 
      message: 'Security Alert: File extension spoofing detected. Upload blocked: Magic number prefix does not match MIME type declaration.' 
    });
  }

  // 4. ClamAV Simulation / Malware Signature scanning
  const contentString = buffer.toString('utf8');
  if (contentString.includes(EICAR_TEST_STRING) || contentString.includes('MALWARE_SIGNATURE_MOCK')) {
    return res.status(400).json({ 
      message: 'Critical Security Alert: Malware detected. File upload quarantined.' 
    });
  }

  next();
};
