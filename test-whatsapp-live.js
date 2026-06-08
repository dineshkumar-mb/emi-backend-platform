import dotenv from 'dotenv';
import { sendWhatsAppTemplate, sendWhatsAppMessage } from './services/whatsappService.js';
import mongoose from 'mongoose';

dotenv.config();

const runLiveTest = async () => {
  const targetNumber = process.argv[2];

  if (!targetNumber) {
    console.error('❌ Error: Please provide a recipient phone number starting with country code.');
    console.log('\nUsage: node test-whatsapp-live.js <phone_number> [template_name]');
    console.log('Example: node test-whatsapp-live.js +919999999999 hello_world\n');
    process.exit(1);
  }

  const templateName = process.argv[3] || 'hello_world';

  console.log('===================================================');
  console.log('🚀 Realtime Meta WhatsApp API Tester');
  console.log('===================================================');
  console.log(`🔑 META_WA_ACCESS_TOKEN: ${process.env.META_WA_ACCESS_TOKEN ? '✅ Configured' : '❌ Missing'}`);
  console.log(`📱 WHATSAPP_PHONE_NUMBER_ID / META_WA_PHONE_NUMBER_ID: ${
    (process.env.META_WA_PHONE_NUMBER_ID || process.env.WHATSAPP_PHONE_NUMBER_ID) ? '✅ Configured' : '❌ Missing'
  }`);
  console.log(`🧪 MOCK_WHATSAPP: ${process.env.MOCK_WHATSAPP === 'true' ? '⚠️ Enabled (Simulated logs only)' : '✅ Disabled (Live requests)'}`);
  console.log(`🎯 Target Phone Number: ${targetNumber}`);
  console.log(`📝 Template to send: ${templateName}`);
  console.log('===================================================\n');

  // Verify credentials exist
  if (!process.env.META_WA_ACCESS_TOKEN || !(process.env.META_WA_PHONE_NUMBER_ID || process.env.WHATSAPP_PHONE_NUMBER_ID)) {
    console.error('❌ Error: Missing Meta credentials in backend/.env. Cannot proceed with real-time test.');
    process.exit(1);
  }

  // If DB URI is present, connect to Mongo to allow log entry creation without crash
  if (process.env.MONGO_URI) {
    try {
      console.log('Connecting to MongoDB for logging...');
      await mongoose.connect(process.env.MONGO_URI);
      console.log('✅ MongoDB connected.');
    } catch (dbErr) {
      console.warn('⚠️ Could not connect to MongoDB, proceeding without database logging:', dbErr.message);
    }
  }

  console.log(`\nDispatched template "${templateName}" transmission call...`);
  
  try {
    const result = await sendWhatsAppTemplate(
      targetNumber,
      templateName,
      'en_US',
      [] // No component parameters for simple test (e.g. hello_world)
    );

    console.log('\n=================== RESULT ===================');
    if (result.success) {
      console.log('✅ Success! Message sent successfully.');
      console.log(`💬 Message ID: ${result.messageId}`);
    } else {
      console.error('❌ Failed to send WhatsApp message.');
      console.error(`Error details: ${result.error}`);
    }
    console.log('==============================================\n');
  } catch (err) {
    console.error('💥 An unexpected exception occurred:', err.message);
  } finally {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
    process.exit(0);
  }
};

runLiveTest();
