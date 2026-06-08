import crypto from 'crypto';

export const structuredLogger = (req, res, next) => {
  const start = process.hrtime();
  
  // Attach or reuse a unique Request ID
  const requestId = req.headers['x-request-id'] || crypto.randomUUID();
  req.requestId = requestId;
  res.setHeader('x-request-id', requestId);

  // Once response completes, log the metrics
  res.on('finish', () => {
    const diff = process.hrtime(start);
    const latencyMs = (diff[0] * 1e3 + diff[1] * 1e-6).toFixed(2);
    
    const logEntry = {
      timestamp: new Date().toISOString(),
      requestId,
      userId: req.user ? req.user._id.toString() : 'anonymous',
      method: req.method,
      url: req.originalUrl || req.url,
      statusCode: res.statusCode,
      latencyMs: parseFloat(latencyMs),
      ip: req.ip || req.connection.remoteAddress,
      userAgent: req.get('User-Agent') || 'unknown',
    };

    // Log errors as error severity, successful requests as info
    if (res.statusCode >= 400) {
      console.error(JSON.stringify({ severity: 'ERROR', ...logEntry }));
    } else {
      console.log(JSON.stringify({ severity: 'INFO', ...logEntry }));
    }
  });

  next();
};
