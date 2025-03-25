// src/utils/logger.ts
import winston from 'winston';

const environment = process.env.NODE_ENV || 'development';
// Force debug level for better visibility
const logLevel = process.env.LOG_LEVEL || 'debug';

// Custom format for better console readability
const consoleFormat = winston.format.printf(({ level, message, timestamp, ...metadata }) => {
  const meta = Object.keys(metadata).length ? 
    `\n${JSON.stringify(metadata, null, 2)}` : '';
    
  return `${timestamp} [${level.toUpperCase()}] 🔹 ${message}${meta}`;
});

export const logger = winston.createLogger({
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
  logger.add(new winston.transports.File({ 
    filename: 'error.log', 
    level: 'error',
    dirname: 'logs' 
  }));
  
  logger.add(new winston.transports.File({ 
    filename: 'combined.log',
    dirname: 'logs'
  }));
}

// Enhanced logging utility with type support and metadata
export const log = {
  debug: (message: string, meta: Record<string, unknown> = {}) => 
    logger.debug(message, { ...meta, timestamp: new Date().toISOString() }),
  info: (message: string, meta: Record<string, unknown> = {}) => 
    logger.info(message, { ...meta, timestamp: new Date().toISOString() }),
  warn: (message: string, meta: Record<string, unknown> = {}) => 
    logger.warn(message, { ...meta, timestamp: new Date().toISOString() }),
  error: (message: string, meta: Record<string, unknown> = {}) => 
    logger.error(message, { ...meta, timestamp: new Date().toISOString() }),
};

// Add test log to verify logger is working
logger.debug('Logger initialized with level: ' + logLevel);