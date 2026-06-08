import client from 'prom-client';
import { getQueueDepth } from './queueManager.js';

// Create a Registry
const register = new client.Registry();

// Enable default metrics collection (CPU, memory, garbage collection, etc.)
client.collectDefaultMetrics({ register });

// HTTP request duration histogram
const httpRequestDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status'],
  buckets: [0.1, 0.3, 0.5, 1, 1.5, 2, 5],
});
register.registerMetric(httpRequestDuration);

// HTTP requests counter
const httpRequestsTotal = new client.Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests processed',
  labelNames: ['method', 'route', 'status'],
});
register.registerMetric(httpRequestsTotal);

// Queue depth gauge
const queueDepthGauge = new client.Gauge({
  name: 'queue_depth_total',
  help: 'Total number of active, waiting, and delayed jobs in queues',
});
register.registerMetric(queueDepthGauge);

// Poll queue depth periodically to update the gauge
setInterval(async () => {
  try {
    const depth = await getQueueDepth();
    queueDepthGauge.set(depth);
  } catch (err) {
    // Suppress polling errors
  }
}, 5000);

// Middleware to measure latencies and request rates
export const metricsMiddleware = (req, res, next) => {
  const start = process.hrtime();
  
  res.on('finish', () => {
    const diff = process.hrtime(start);
    const durationInSeconds = diff[0] + diff[1] / 1e9;
    
    // Normalize route to avoid high-cardinality values (like individual user IDs)
    let route = req.baseUrl + req.path;
    if (req.route && req.route.path) {
      route = req.baseUrl + req.route.path;
    }

    const labels = {
      method: req.method,
      route: route || 'unknown',
      status: res.statusCode,
    };

    httpRequestDuration.observe(labels, durationInSeconds);
    httpRequestsTotal.inc(labels);
  });

  next();
};

export { register };
