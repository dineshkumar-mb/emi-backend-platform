import { getQueue, registerWorker } from '../utils/queueManager.js';
import { sendWhatsAppMessage, sendWhatsAppTemplate } from './whatsappService.js';
import WhatsAppLog from '../models/WhatsAppLog.js';
import NotificationLog from '../models/NotificationLog.js';
import NotificationOutbox from '../models/NotificationOutbox.js';
import mongoose from 'mongoose';
import { NotificationOptimizationAgent } from './agents/NotificationOptimizationAgent.js';
import { CostOptimizer } from './agents/CostOptimizer.js';


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

  // Log message to NotificationLog for tracking & analytics
  await NotificationLog.create({
    userId: userId || new mongoose.Types.ObjectId(),
    phone: to || '0000000000',
    template: templateName || 'CUSTOM_MESSAGE',
    message: message || `[Template: ${templateName}]`,
    loanId: loanId || null,
    status: result.success ? 'delivered' : 'failed',
    sentAt: new Date(),
    deliveredAt: result.success ? new Date() : null,
    failedReason: result.success ? null : (result.error || 'Failed to dispatch message'),
  });

  if (!result.success) {
    throw new Error(result.error || 'Failed to dispatch message.');
  }

  return result;
};

/**
 * Main BullMQ job processor for WhatsApp notifications (from scheduler).
 * Handles: AI optimization → template selection → dispatch → outbox status update.
 */
async function processNotificationJob(job) {
  const { outboxId, template, payload } = job.data;
  const log = (msg) => console.log(`[NotificationWorker] Job ${job.id}: ${msg}`);

  log(`Processing outbox record ${outboxId}`);

  // 1. Mark as IN_PROGRESS
  await NotificationOutbox.findByIdAndUpdate(outboxId, { status: 'IN_PROGRESS' });

  // 2. AI content optimization (non-blocking — falls back to raw template on failure)
  let optimizedMessage = null;
  try {
    optimizedMessage = await NotificationOptimizationAgent.optimize({
      notificationType: template,
      userName: payload.userName,
      emiAmount: payload.emiAmount,
      nextEmiDueDate: payload.nextEmiDueDate,
      outstandingBalance: payload.outstandingBalance,
      daysOverdue: payload.daysOverdue
    });
    log(`AI optimization succeeded. Tokens used: ${optimizedMessage.tokensUsed}`);
  } catch (aiError) {
    console.warn(`[NotificationWorker] AI optimization failed for ${outboxId}. Using fallback.`, aiError.message);
  }

  // 3. Template selection via CostOptimizer
  const templateConfig = CostOptimizer.selectTemplate({
    notificationType: template,
    region: payload.region,
    hasOptimizedMessage: !!optimizedMessage
  });

  // 4. Build final message
  const messageBody = optimizedMessage?.text ?? templateConfig.fallbackText(payload);

  // 5. Dispatch via OpenWA gateway (sendWhatsAppMessage sends raw text)
  const waResult = await sendWhatsAppMessage(payload.phone, messageBody, payload.userId);

  if (!waResult.success) {
    throw new Error(waResult.error || 'Failed to dispatch WhatsApp message.');
  }

  // 6. Mark as SENT
  await NotificationOutbox.findByIdAndUpdate(outboxId, {
    status: 'SENT',
    sentAt: new Date(),
    messageBody,
    templateUsed: templateConfig.name
  });

  log(`Dispatched successfully to ${payload.phone}`);
}

// Register central worker process
const worker = registerWorker(QUEUE_NAME, async (job) => {
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
        
        // Add back to queue with delay
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
  } else if (job.name === 'whatsapp-notification') {
    await processNotificationJob(job);
  }
}, {
  concurrency: 8,
  limiter: {
    max: 10,
    duration: 1000
  }
});

if (worker) {
  worker.on('completed', (job) => {
    console.log(`[NotificationWorker] Job ${job.id} completed.`);
  });

  worker.on('failed', async (job, err) => {
    console.error(`[NotificationWorker] Job ${job.id} failed: ${err.message}`);
    if (job.name === 'whatsapp-notification' && job.attemptsMade >= (job.opts?.attempts || 3)) {
      // Final failure — mark outbox record as FAILED for manual review
      await NotificationOutbox.findByIdAndUpdate(job.data.outboxId, {
        status: 'FAILED',
        failureReason: err.message,
        failedAt: new Date()
      });
    }
  });

  worker.on('stalled', (jobId) => {
    console.warn(`[NotificationWorker] Job ${jobId} stalled and will be retried.`);
  });
}


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
