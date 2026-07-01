import User from '../models/User.js';

const DAILY_QUERY_LIMIT = 100;
const DAILY_TOKEN_LIMIT = 100000;

/**
 * Validates and increments the user's daily AI budget.
 * Throws an error if daily thresholds are exceeded.
 * @param {string} userId 
 * @param {number} estimatedTokens 
 * @returns {Promise<Object>} Updated budget details
 */
export const checkAndIncrementBudget = async (userId, estimatedTokens = 1000) => {
  const user = await User.findById(userId);
  if (!user) {
    throw new Error('User not found.');
  }

  const today = new Date().toISOString().split('T')[0];

  // Initialize or fetch usage structure
  if (!user.aiDailyUsage || user.aiDailyUsage.date !== today) {
    user.aiDailyUsage = {
      date: today,
      count: 0,
      tokensUsed: 0,
    };
  }

  // Quota verification
  if (user.aiDailyUsage.count >= DAILY_QUERY_LIMIT) {
    throw new Error('Too Many Prompts: Daily AI request quota reached (30 queries). Please try again tomorrow.');
  }

  if (user.aiDailyUsage.tokensUsed >= DAILY_TOKEN_LIMIT) {
    throw new Error('Usage Throttled: Daily AI token quota reached. Please try again tomorrow.');
  }

  // Increment usage counters
  user.aiDailyUsage.count += 1;
  user.aiDailyUsage.tokensUsed += estimatedTokens;
  
  await user.save();
  return user.aiDailyUsage;
};
