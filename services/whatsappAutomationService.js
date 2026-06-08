import { getQueue, registerWorker } from '../utils/queueManager.js';
import { sendWhatsAppMessage, sendWhatsAppTemplate } from './whatsappService.js';
import WhatsAppLog from '../models/WhatsAppLog.js';
import NotificationLog from '../models/NotificationLog.js';
import mongoose from 'mongoose';

const QUEUE_NAME = 'notifications';
const MAX_RETRIES = 3;

// Process job business logic
const processWhatsAppJob = async (jobData) => {
  const { userId, to, type, message, templateName, components, loanId } = jobData;
  let result = null;

  if (type === 'template') {
    result = await sendWhatsAppTemplate(to, templateName, 'en_US', components, userId);
  } else {
    result = await sendWhatsAppMessage(to, message, userId);
  }

  const statusStr = result.success ? 'SENT' : 'FAILED';
  const deliveryIdStr = result.messageId || null;

  // Log to database models
  await WhatsAppLog.create({
    userId: userId || new mongoose.Types.ObjectId(),
    message: message || `[Template: ${templateName}]`,
    status: statusStr,
    template: templateName || null,
    payload: jobData,
    response: result,
    error: result.error || null,
    retryCount: jobData.retryCount || 0,
  });

  if (loanId) {
    await NotificationLog.create({
      message: message || `Template notification: ${templateName}`,
      userId: userId,
      loanId: loanId,
      status: statusStr.toLowerCase(),
      deliveryId: deliveryIdStr,
    });
  }

  if (!result.success) {
    throw new Error(result.error || 'Failed to dispatch message.');
  }

  return result;
};

// Register central worker process
registerWorker(QUEUE_NAME, async (job) => {
  if (job.name === 'whatsapp') {
    console.log(`[WhatsApp Worker] Processing job: ${job.id}`);
    try {
      await processWhatsAppJob(job.data);
    } catch (err) {
      console.error(`[WhatsApp Worker] Job failed: ${job.id}. Error: ${err.message}`);
      
      // Implement retry logic
      const data = job.data;
      if ((data.retryCount || 0) < MAX_RETRIES) {
        data.retryCount = (data.retryCount || 0) + 1;
        console.log(`[WhatsApp Worker] Retrying job. Attempt ${data.retryCount}/${MAX_RETRIES}`);
        
        // Add back to queue with delay (if mock queue, it will run again soon)
        const q = getQueue(QUEUE_NAME);
        await q.add('whatsapp', data, { delay: 5000 });
      } else {
        console.error(`[WhatsApp Worker] Max retries reached for job ${job.id}`);
        // Log final failure audit
        await WhatsAppLog.create({
          userId: data.userId || new mongoose.Types.ObjectId(),
          message: data.message || `[Template: ${data.templateName}]`,
          status: 'FAILED',
          template: data.templateName || null,
          payload: data,
          response: null,
          error: `Max retries exceeded. Last error: ${err.message}`,
          retryCount: data.retryCount || MAX_RETRIES,
        });
      }
    }
  }
});

/**
 * Public API to queue a WhatsApp message (text or template)
 * @param {Object} jobData - Job details
 */
export const queueWhatsAppMessage = async (jobData) => {
  const payload = {
    userId: jobData.userId,
    to: jobData.to,
    type: jobData.type || 'message', // 'message' | 'template'
    message: jobData.message || '',
    templateName: jobData.templateName || '',
    components: jobData.components || [],
    loanId: jobData.loanId || null,
    retryCount: 0,
  };

  const q = getQueue(QUEUE_NAME);
  await q.add('whatsapp', payload);
  console.log(`[WhatsApp Queue] Job added to queue: send to ${payload.to}`);
};
