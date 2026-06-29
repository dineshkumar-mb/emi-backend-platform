import dotenv from 'dotenv';
import mongoose from 'mongoose';
import connectDB from './config/db.js';
import User from './models/User.js';
import Loan from './models/Loan.js';
import NotificationOutbox from './models/NotificationOutbox.js';
import { runDueTomorrowSweep } from './services/scheduler.js';
import { initOpenWA } from './services/openwaClient.js';
import './services/whatsappAutomationService.js';

dotenv.config();

const YOUR_PHONE_NUMBER = process.env.TEST_WHATSAPP_NUMBER; // Sourced from .env

const run = async () => {
  await connectDB();
  console.log('--- Setting up Test Data ---');
  
  // Wait for WhatsApp gateway to sync session
  await initOpenWA();

  // Clear previous test outbox records to avoid 'already sent today' block
  await NotificationOutbox.deleteMany({});

  // 1. Setup Test User
  const user = await User.findOneAndUpdate(
    { email: 'test@example.com' },
    {
      name: 'Dinesh',
      email: 'test@example.com',
      password: 'password123',
      whatsappNumber: YOUR_PHONE_NUMBER,
      notificationChannel: 'WhatsApp',
      currentBalance: 15000,
      notificationSettings: { emiReminders: true }
    },
    { upsert: true, new: true }
  );

  // 2. Setup Canfin Loan due tomorrow
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);

  const loan = await Loan.findOneAndUpdate(
    { userId: user._id, provider: 'Canfin Home Finance' },
    {
      userId: user._id,
      provider: 'Canfin Home Finance',
      loanType: 'Home Loan',
      principal: 2000000,
      interestRate: 9.1,
      emiAmount: 12702,
      tenure: 240,
      outstandingBalance: 1950000,
      nextDueDate: tomorrow,
      status: 'active'
    },
    { upsert: true, new: true }
  );

  console.log('\n=============================================');
  console.log('SCENARIO 1: Due Tomorrow, Good Balance (₹15,000)');
  console.log('=============================================');
  await runDueTomorrowSweep();

  // Wait a sec for BullMQ processing
  await new Promise(resolve => setTimeout(resolve, 5000));

  console.log('\n=============================================');
  console.log('SCENARIO 2: Due Tomorrow, LOW Balance (₹5,000)');
  console.log('=============================================');
  
  // 3. Update balance to trigger low balance alert
  await User.findByIdAndUpdate(user._id, { currentBalance: 5000 });
  
  // Clear outbox so it doesn't block the second sweep
  await NotificationOutbox.deleteMany({});
  
  await runDueTomorrowSweep();

  // Wait for worker to finish sending WhatsApp messages
  setTimeout(() => {
    console.log('\n--- Test Completed ---');
    process.exit(0);
  }, 15000);
};

run().catch(console.error);
