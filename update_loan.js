import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

import Loan from './models/Loan.js';
import { runAutoPaySweep } from './services/scheduler.js';

const run = async () => {
  const uri = process.env.MONGO_URI;
  await mongoose.connect(uri, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  });
  
  const today = new Date();
  const currentDay = today.getDate();
  
  // Just update ANY loan to test AutoPay
  const res = await Loan.updateMany(
    { status: 'active' },
    { $set: { autoPayEnabled: true, autoPayDay: currentDay } }
  );

  console.log('Update Result:', res);

  console.log('Running AutoPay Sweep...');
  const count = await runAutoPaySweep();
  console.log('Processed:', count);

  process.exit(0);
};

run().catch(console.error);
