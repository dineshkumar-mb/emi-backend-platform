import dotenv from 'dotenv';
import { NotificationOptimizationAgent } from './services/agents/NotificationOptimizationAgent.js';

dotenv.config();

const run = async () => {
  try {
    const optimized = await NotificationOptimizationAgent.optimize({
      notificationType: 'DUE_TOMORROW',
      userName: 'John Doe',
      emiAmount: 15000,
      nextEmiDueDate: new Date(Date.now() + 86400000).toISOString(),
      outstandingBalance: 120000,
      daysOverdue: 0
    });
    console.log('[Test] Optimization Result:', optimized);
  } catch (err) {
    console.error('[Test] Optimization failed:', err);
  }
};

run();
