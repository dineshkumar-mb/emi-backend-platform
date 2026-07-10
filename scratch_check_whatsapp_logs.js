import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

import WhatsAppLog from './models/WhatsAppLog.js';

const run = async () => {
  const uri = process.env.MONGO_URI;
  await mongoose.connect(uri);

  const logs = await WhatsAppLog.find({}).sort({ createdAt: -1 }).limit(10).lean();
  console.log('WhatsAppLogs:');
  console.log(JSON.stringify(logs, null, 2));

  process.exit(0);
};

run().catch(console.error);
