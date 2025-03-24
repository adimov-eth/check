// src/middleware/webhook.ts
import type { NextFunction, Request, Response } from 'express';

// Middleware to capture raw request body for webhook verification
export const captureRawBody = (req: Request, res: Response, next: NextFunction): void => {
  let data = '';
  
  req.on('data', chunk => {
    data += chunk;
  });
  
  req.on('end', () => {
    req.rawBody = data;
    next();
  });
};