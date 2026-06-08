import { rateLimit } from 'express-rate-limit';

// General API rate limiter
export const apiThrottler = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per window
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many API requests, please try again in 15 minutes.' },
});

// Authentication rate limiter (brute-force login prevention)
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // Max 10 attempts
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many signup or login attempts. Please try again in 15 minutes.' },
});

// OTP generation rate limiter
export const otpLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 3, // Max 3 requests
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many OTP requests. Please try again in 10 minutes.' },
});

// AI Advisor rate limiter (Gemini cost protection)
export const aiLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 30, // Max 30 queries per hour
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Hourly AI query quota exceeded. Local fallback remains active.' },
});

// File upload rate limiter (resource abuse prevention)
export const uploadLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 5, // Max 5 uploads
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many statement upload requests. Please try again in 10 minutes.' },
});
