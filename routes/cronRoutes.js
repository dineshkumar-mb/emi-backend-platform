import express from 'express';
import { 
  runDueTodaySweep, 
  runDueTomorrowSweep, 
  runDueIn3DaysSweep, 
  runOverdueSweep,
  runMonthlySummarySweep,
  runDataRetentionPurge
} from '../services/scheduler.js';

const router = express.Router();

/**
 * @route   GET /api/cron/ping
 * @desc    Lightweight endpoint for UptimeRobot to hit and keep Vercel function warm
 */
router.get('/ping', (req, res) => {
  res.status(200).json({ status: 'active', message: 'Vercel keep-warm ping successful.' });
});

/**
 * @route   GET /api/cron/master-sweep
 * @desc    Vercel Cron endpoint to trigger ALL sweeps (due to Vercel Hobby limits)
 */
router.get('/master-sweep', async (req, res) => {
  try {
    console.log('[Vercel Cron] Triggering master sweep...');
    
    // Daily sweeps
    await runDueTodaySweep();
    await runDueTomorrowSweep();
    await runDueIn3DaysSweep();
    
    // Overdue sweep
    await runOverdueSweep();
    
    // Data retention purge
    await runDataRetentionPurge();

    // Monthly sweep (if it's the 1st of the month)
    const today = new Date();
    if (today.getDate() === 1) {
      await runMonthlySummarySweep();
    }

    res.status(200).json({ success: true, message: 'Master sweep completed successfully.' });
  } catch (error) {
    console.error('[Vercel Cron] Master sweep failed:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
