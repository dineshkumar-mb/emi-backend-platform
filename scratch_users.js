import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

import User from './models/User.js';

const run = async () => {
  const uri = process.env.MONGO_URI;
  await mongoose.connect(uri);

  const users = await User.find({}).lean();
  console.log('Users in Database:');
  console.log(JSON.stringify(users, null, 2));

  process.exit(0);
};

run().catch(console.error);
