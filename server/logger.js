/**
 * Structured logging with pino
 * Provides consistent JSON logs with request context
 */
import pino from 'pino';
import { randomUUID } from 'node:crypto';

// Determine log level from env
const LOG_LEVEL = process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug');
const PRETTY = process.env.NODE_ENV !== 'production' && process.env.LOG_PRETTY !== 'false';

// Base logger configuration
const baseLogger = pino({
  level: LOG_LEVEL,
  formatters: {
    level: (label) => ({ level: label }),
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  base: {
    service: 'manga-studio-api',
    env: process.env.NODE_ENV || 'development',
    hostname: process.env.HOSTNAME || 'unknown',
  },
  // Redact sensitive fields
  redact: {
    paths: [
      '*.password',
      '*.apiKey',
      '*.secret',
      '*.token',
      '*.authorization',
      '*.cookie',
      'req.headers.authorization',
      'req.headers.cookie',
      'req.headers.x-csrf-token',
      'req.headers.idempotency-key',
      'body.password',
      'body.apiKey',
      'body.secret',
      'body.token',
      '*.creditCard',
    ],
    censor: '[REDACTED]',
  },
}, PRETTY ? pino.transport({
  target: 'pino-pretty',
  options: {
    colorize: true,
    translateTime: 'SYS:standard',
    ignore: 'pid,hostname',
  },
}) : undefined);

// ===== Request-scoped logger factory =====

export function createRequestLogger(req) {
  const requestId = req.id || randomUUID();
  return baseLogger.child({
    requestId,
    method: req.method,
    path: req.path,
    ip: req.ip,
    userAgent: req.get('user-agent'),
    userId: req.user?.user_id,
  });
}

// ===== Module-specific loggers =====

export const loggers = {
  // Gateway model invocations
  gateway: baseLogger.child({ component: 'model-gateway' }),
  
  // Database operations
  db: baseLogger.child({ component: 'database' }),
  
  // Authentication & sessions
  auth: baseLogger.child({ component: 'auth' }),
  
  // Credit system
  credits: baseLogger.child({ component: 'credits' }),
  
  // Payments
  payments: baseLogger.child({ component: 'payments' }),
  
  // Email outbox
  email: baseLogger.child({ component: 'email' }),
  
  // Migration
  migration: baseLogger.child({ component: 'migration' }),
  
  // Backup
  backup: baseLogger.child({ component: 'backup' }),
  
  // WebSocket / realtime
  ws: baseLogger.child({ component: 'websocket' }),
  
  // File storage
  storage: baseLogger.child({ component: 'storage' }),
};

// ===== Helper functions for common patterns =====

// Log model invocation with full context
export function logModelInvocation(logger, { 
  operation, 
  modelId, 
  userId, 
  durationMs, 
  status, 
  tokensIn, 
  tokensOut,
  error 
}) {
  const log = logger.child({ 
    operation, 
    modelId, 
    userId,
    durationMs,
    status,
    tokensIn,
    tokensOut,
  });
  
  if (status === 'success') {
    log.info({ 
      tokensIn, 
      tokensOut,
      totalTokens: (tokensIn || 0) + (tokensOut || 0),
    }, `Model ${operation} completed`);
  } else {
    log.warn({ error: error?.message || error }, `Model ${operation} failed`);
  }
}

// Log database query
export function logDbQuery(logger, { queryType, durationMs, rowsAffected, error }) {
  const log = logger.child({ 
    queryType, 
    durationMs,
    rowsAffected,
  });
  
  if (error) {
    log.error({ error: error.message, stack: error.stack }, `DB ${queryType} failed`);
  } else if (durationMs > 1000) {
    log.warn({ durationMs }, `Slow DB ${queryType} (${durationMs}ms)`);
  } else {
    log.debug(`DB ${queryType} completed`);
  }
}

// Log HTTP request
export function logHttpRequest(logger, { method, path, statusCode, durationMs, userId, ip }) {
  const log = logger.child({ 
    method, 
    path, 
    statusCode,
    durationMs,
    userId,
    ip,
  });
  
  if (statusCode >= 500) {
    log.error(`HTTP ${method} ${path} -> ${statusCode} (${durationMs}ms)`);
  } else if (statusCode >= 400) {
    log.warn(`HTTP ${method} ${path} -> ${statusCode} (${durationMs}ms)`);
  } else {
    log.info(`HTTP ${method} ${path} -> ${statusCode} (${durationMs}ms)`);
  }
}

// Log credit operation
export function logCreditOperation(logger, { userId, operation, amount, balanceBefore, balanceAfter, reason }) {
  logger.info({
    userId,
    operation,
    amount,
    balanceBefore,
    balanceAfter,
    reason,
    delta: balanceAfter - balanceBefore,
  }, `Credit ${operation}: ${amount > 0 ? '+' : ''}${amount}`);
}

// Log payment operation
export function logPayment(logger, { userId, orderNo, amount, status, channel }) {
  logger.info({
    userId,
    orderNo,
    amount,
    status,
    channel,
  }, `Payment ${status}: ${orderNo}`);
}

// Log email sent
export function logEmail(logger, { userId, purpose, recipientEmail, status, error }) {
  const log = logger.child({ userId, purpose, recipientEmail, status });
  if (status === 'sent') {
    log.info('Email sent');
  } else {
    log.warn({ error: error?.message }, 'Email failed');
  }
}

// Log migration
export function logMigration(logger, { userId, modelCount, providerCount, status, error }) {
  const log = logger.child({ userId, modelCount, providerCount, status });
  if (status === 'success') {
    log.info('Legacy config migration completed');
  } else {
    log.error({ error: error?.message }, 'Legacy config migration failed');
  }
}

// Log backup
export function logBackup(logger, { status, sizeBytes, durationMs, path, error }) {
  const log = logger.child({ status, sizeBytes, durationMs, path });
  if (status === 'success') {
    log.info('Backup completed');
  } else {
    log.error({ error: error?.message }, 'Backup failed');
  }
}

// ===== Export base logger for direct use =====
export { baseLogger as logger };
export default baseLogger;