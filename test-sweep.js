import dotenv from 'dotenv';
import mongoose from 'mongoose';
import connectDB from './config/db.js';
import { runManualSweep } from './services/scheduler.js';

dotenv.config();

const run = async () => {
  await connectDB();
  console.log('[Test] Running sweep...');
  const count = await runManualSweep();
  console.log('[Test] Sweep queued count:', count);
  process.exit(0);
};

run().catch(console.error);
