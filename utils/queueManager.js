import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';

const QUEUES = {};
const WORKERS = {};
const MOCK_QUEUES = {};
let redisClient = null;
let isRedisAvailable = false;

// Mock Queue representation for when Redis is unavailable
class MockQueue {
  constructor(name) {
    this.name = name;
    this.jobs = [];
    this.processFn = null;
    this.isWorkerRunning = false;
  }

  async add(jobName, data, opts = {}) {
    const job = { 
      id: `mock-job-${Math.random().toString(36).substring(2, 9)}`, 
      name: jobName, 
      data,
      opts 
    };
    this.jobs.push(job);
    console.log(`[MockQueue ${this.name}] Job added: ${job.id}`);
    
    // Process async
    if (this.processFn && !this.isWorkerRunning) {
      this.startWorker();
    }
    return job;
  }

  async addBulk(jobs) {
    const addedJobs = [];
    for (const job of jobs) {
      addedJobs.push(await this.add(job.name, job.data, job.opts));
    }
    return addedJobs;
  }

  async getJobCount() {
    return this.jobs.length;
  }

  setProcessFn(fn) {
    this.processFn = fn;
    if (this.jobs.length > 0 && !this.isWorkerRunning) {
      this.startWorker();
    }
  }

  async startWorker() {
    this.isWorkerRunning = true;
    while (this.jobs.length > 0) {
      const job = this.jobs.shift();
      console.log(`[MockWorker ${this.name}] Processing job: ${job.id}`);
      try {
        await this.processFn(job);
        console.log(`[MockWorker ${this.name}] Job completed: ${job.id}`);
      } catch (err) {
        console.error(`[MockWorker ${this.name}] Job failed: ${job.id}. Error: ${err.message}`);
      }
      await new Promise(r => setTimeout(r, 1000)); // Simulate delay
    }
    this.isWorkerRunning = false;
  }
}

// Initialize connection
const redisUrl = process.env.REDIS_URI || '127.0.0.1:6379';
console.log(`[Queue Manager] Attempting Redis connection at ${redisUrl}...`);

try {
  redisClient = new IORedis(redisUrl, {
    maxRetriesPerRequest: null,
    connectTimeout: 2000,
    retryStrategy(times) {
      if (times > 2) {
        console.warn('[Queue Manager] Redis is unavailable. Utilizing in-memory queue fallback.');
        return null; // Stop trying, trigger fallback
      }
      return 1000;
    }
  });

  redisClient.on('error', (err) => {
    console.warn('[Queue Manager] Redis connection issue:', err.message);
    isRedisAvailable = false;
  });

  redisClient.on('connect', () => {
    console.log('[Queue Manager] Redis connected! Enabling BullMQ queues.');
    isRedisAvailable = true;
  });
} catch (e) {
  console.warn('[Queue Manager] Redis init failed. Using fallback:', e.message);
  isRedisAvailable = false;
}

/**
 * Get a queue by name, returning standard BullMQ or Mock in-memory queue
 * @param {string} name 
 * @returns {Queue|MockQueue}
 */
export const getQueue = (name) => {
  if (isRedisAvailable && redisClient) {
    if (!QUEUES[name]) {
      QUEUES[name] = new Queue(name, { connection: redisClient });
    }
    return QUEUES[name];
  } else {
    if (!MOCK_QUEUES[name]) {
      MOCK_QUEUES[name] = new MockQueue(name);
    }
    return MOCK_QUEUES[name];
  }
};

/**
 * Register worker for a queue
 * @param {string} name 
 * @param {Function} processFn 
 * @param {Object} opts - BullMQ worker options (e.g. concurrency, limiter)
 * @returns {Worker|null}
 */
export const registerWorker = (name, processFn, opts = {}) => {
  if (isRedisAvailable && redisClient) {
    if (WORKERS[name]) {
      console.warn(`[Queue Manager] Worker for queue "${name}" is already registered.`);
      return WORKERS[name];
    }
    const worker = new Worker(name, async (job) => {
      console.log(`[Worker ${name}] Processing job ${job.id}`);
      await processFn(job);
    }, { connection: redisClient, ...opts });
    
    WORKERS[name] = worker;
    return worker;
  } else {
    const mockQueue = getQueue(name);
    mockQueue.setProcessFn(processFn);
    return null;
  }
};

/**
 * Track total queue depth (for Prometheus metrics)
 * @returns {Promise<number>}
 */
export const getQueueDepth = async () => {
  let totalDepth = 0;
  const queueNames = ['notifications', 'emails', 'ai_tasks', 'reports'];
  
  for (const name of queueNames) {
    if (isRedisAvailable && redisClient) {
      try {
        const q = getQueue(name);
        const count = await q.getJobCountByTypes('waiting', 'active', 'delayed');
        totalDepth += count;
      } catch (err) {
        // Ignore errors
      }
    } else {
      const mq = MOCK_QUEUES[name];
      if (mq) {
        totalDepth += await mq.getJobCount();
      }
    }
  }
  return totalDepth;
};
