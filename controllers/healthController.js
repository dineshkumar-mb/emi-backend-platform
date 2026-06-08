import mongoose from 'mongoose';
import { GoogleGenerativeAI } from '@google/generative-ai';

/**
 * @desc    Get API health status
 * @route   GET /api/health
 * @access  Public
 */
export const getHealthStatus = async (req, res) => {
  const health = {
    uptime: process.uptime(),
    timestamp: Date.now(),
    services: {
      database: 'down',
      gemini: 'down',
      telegram: 'configured',
      whatsapp: 'configured'
    }
  };

  // 1. Database Check
  try {
    const dbState = mongoose.connection.readyState;
    if (dbState === 1) {
      health.services.database = 'up';
    } else if (dbState === 2) {
      health.services.database = 'connecting';
    }
  } catch (err) {
    health.services.database = `error: ${err.message}`;
  }

  // 2. Gemini Check
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (apiKey && apiKey !== 'PLACEHOLDER') {
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
      // Execute a quick minimal query to assert key & network health
      const result = await model.generateContent("ping");
      if (result && result.response) {
        health.services.gemini = 'up';
      }
    }
  } catch (err) {
    health.services.gemini = `error: ${err.message}`;
  }

  // 3. Telegram & WhatsApp Configuration Check
  if (!process.env.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN.includes('PLACEHOLDER')) {
    health.services.telegram = 'missing';
  }
  if (!process.env.META_WA_ACCESS_TOKEN || process.env.META_WA_ACCESS_TOKEN.includes('PLACEHOLDER')) {
    health.services.whatsapp = 'missing';
  }

  // Determine overall status
  const isHealthy = health.services.database === 'up' && (health.services.gemini === 'up' || health.services.gemini === 'down'); // degraded if gemini down but database is up
  
  res.status(isHealthy ? 200 : 503).json({
    status: isHealthy ? 'healthy' : 'degraded',
    ...health
  });
};
