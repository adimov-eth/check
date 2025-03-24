import { config } from '@/config';
import type { Request, Response } from 'express';
import { logger } from '../utils/logger';

// Custom error classes
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export class AuthenticationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthenticationError';
  }
}

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}

// Global error handler middleware
export const handleError = (
  err: Error,
  _req: Request,
  res: Response,
): void => {
  logger.error(`Error: ${err.message}`);
  
  if (err.stack) {
    logger.debug(err.stack);
  }

  if (err instanceof ValidationError) {
    res.status(400).json({ error: 'Bad Request', message: err.message });
    return;
  }
  
  if (err instanceof AuthenticationError) {
    res.status(401).json({ error: 'Unauthorized', message: err.message });
    return;
  }
  
  if (err instanceof NotFoundError) {
    res.status(404).json({ error: 'Not Found', message: err.message });
    return;
  }

  // Generic error response
  res.status(500).json({ 
    error: 'Internal Server Error', 
    message: config.nodeEnv === 'production' ? 'An unexpected error occurred' : err.message 
  });
};