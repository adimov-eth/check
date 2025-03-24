// src/utils/logger.ts
import winston from 'winston';

const environment = process.env.NODE_ENV || 'development';
const logLevel = process.env.LOG_LEVEL || (environment === 'production' ? 'info' : 'debug');

export const logger = winston.createLogger({
  level: logLevel,
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'api-service' },
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(({ timestamp, level, message, stack, ...meta }) => {
          const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
          const stackStr = stack ? `\n${stack}` : '';
          return `${timestamp} [${level}]: ${message}${metaStr}${stackStr}`;
        })
      )
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

// For convenience, provide commonly used log levels as methods
export const log = {
  debug: (message: string, meta = {}) => logger.debug(message, meta),
  info: (message: string, meta = {}) => logger.info(message, meta),
  warn: (message: string, meta = {}) => logger.warn(message, meta),
  error: (message: string, meta = {}) => logger.error(message, meta),
};