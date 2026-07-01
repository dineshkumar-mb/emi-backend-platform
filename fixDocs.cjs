require('dotenv').config();
const mongoose = require('mongoose');
mongoose.connect(process.env.MONGO_URI).then(async () => {
  const db = mongoose.connection.db;
  const res = await db.collection('documents').updateMany(
    { status: 'processing' },
    { $set: { status: 'failed', errorMessage: 'Server restarted during processing' } }
  );
  console.log('Marked ' + res.modifiedCount + ' stuck documents as failed');
  process.exit(0);
}).catch(console.error);
