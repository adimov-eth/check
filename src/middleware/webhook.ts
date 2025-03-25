// src/middleware/webhook.ts
import { logger } from '@/utils/logger';
import type { NextFunction, Request, Response } from 'express';
import express from 'express';

interface WebhookRequest extends Request {
  rawBody?: string;
}

const MAX_PAYLOAD_SIZE = '100kb';

// Middleware to capture raw request body for webhook verification
export const captureRawBody = (req: WebhookRequest, res: Response, next: NextFunction): void => {
  let data = '';
  
  req.on('data', chunk => {
    data += chunk;
    logger.debug('Received webhook chunk', { size: chunk.length });
  });
  
  req.on('end', () => {
    req.rawBody = data;
    logger.debug('Finished receiving webhook data', { 
      dataSize: data.length,
      contentType: req.headers['content-type']
    });
    next();
  });

  req.on('error', (error) => {
    logger.error('Error receiving webhook data', { error });
    next(error);
  });
};

// Middleware to validate webhook request
export const validateWebhookRequest = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  if (req.headers['content-type'] !== 'application/json') {
    logger.error('Invalid webhook content type', { 
      contentType: req.headers['content-type'] 
    });
    res.status(400).json({
      success: false,
      error: 'Invalid content type. Expected application/json'
    });
    return;
  }

  next();
};

// Configure raw body parser with size limit
export const webhookBodyParser = express.raw({ 
  type: 'application/json',
  limit: MAX_PAYLOAD_SIZE
});

export type { WebhookRequest };
