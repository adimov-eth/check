// src/utils/logger.ts
import winston from 'winston';

const environment = process.env.NODE_ENV || 'development';
// Set default log level based on environment, allow override
const defaultLogLevel = environment === 'production' ? 'info' : 'debug';
const logLevel = process.env.LOG_LEVEL || defaultLogLevel;

// Custom format for better console readability
const consoleFormat = winston.format.printf(({ level, message, timestamp, ...metadata }) => {
  // Extract core metadata if present
  const { service, method, path, statusCode, duration, userId, requestId, ...rest } = metadata;

  // Base log string
  let logString = `${timestamp} [${level.toUpperCase()}] [${service}]`;

  // Add request details if available
  if (method && path) logString += ` ${method} ${path}`;
  if (statusCode) logString += ` (${statusCode})`;
  if (duration) logString += ` - ${duration}ms`;
  if (userId) logString += ` [user:${userId}]`;
  if (requestId) logString += ` [req:${requestId}]`;

  // Add the main message
  logString += ` ${message}`;

  // Add remaining metadata if any exists
  if (Object.keys(rest).length > 0) {
    logString += ` ${JSON.stringify(rest)}`; // Keep it concise inline
  }

  return logString;
});

// Keep the instance internal to this module
const internalLogger = winston.createLogger({
  level: logLevel,
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.splat(),
    winston.format.json()
  ),
  defaultMeta: { service: 'api-service' },
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        consoleFormat
      ),
      // Force logging to console
      level: 'debug'
    })
  ]
});

// Add file transport in production
if (environment === 'production') {
  internalLogger.add(new winston.transports.File({ 
    filename: 'error.log', 
    level: 'error',
    dirname: 'logs' 
  }));
  
  internalLogger.add(new winston.transports.File({ 
    filename: 'combined.log',
    dirname: 'logs'
  }));
}

// Enhanced logging utility with type support and metadata - This is the preferred export
export const log = {
  debug: (message: string, meta: Record<string, unknown> = {}) => 
    internalLogger.debug(message, { ...meta }),
  info: (message: string, meta: Record<string, unknown> = {}) => 
    internalLogger.info(message, { ...meta }),
  warn: (message: string, meta: Record<string, unknown> = {}) => 
    internalLogger.warn(message, { ...meta }),
  error: (message: string, meta: Record<string, unknown> = {}) => 
    internalLogger.error(message, { ...meta }),
};

// Add test log to verify logger is working
log.debug('Logger initialized', { level: logLevel, environment });