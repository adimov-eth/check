// src/api/index.ts
import { getUserId, requireAuth } from '@/middleware/auth';
import { ensureUser } from '@/middleware/ensure-user';
import { AuthenticationError, handleError } from '@/middleware/error';
import { apiRateLimiter } from '@/middleware/rate-limit';
import { getUserUsageStats } from '@/services/usage-service';
import type { AuthenticatedRequest } from '@/types/common';
import { logger } from '@/utils/logger';
import cors from 'cors';
import type { NextFunction, Request, Response } from 'express';
import express from 'express';
import helmet from 'helmet';
import audioRoutes from './routes/audio';
import conversationRoutes from './routes/conversation';
import subscriptionRoutes from './routes/subscription';
import userRoutes from './routes/user';

// Create Express app
export const app = express();

// Apply middleware
app.use(helmet());
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// Request logger
app.use((req, res, next) => {
  logger.debug(`${req.method} ${req.path}`);
  const start = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.debug(`${req.method} ${req.path} ${res.statusCode} - ${duration}ms`);
  });
  
  next();
});

// Parse JSON requests globally for all routes that might need it.
app.use(express.json());

// Apply authentication middleware to protected routes
app.use('/audio', requireAuth);
app.use('/conversations', requireAuth);
app.use('/subscriptions', requireAuth);
app.use('/users', requireAuth);
app.use('/usage', requireAuth);

// Ensure user exists in database - apply to the same routes
app.use('/audio', ensureUser);
app.use('/conversations', ensureUser);
app.use('/subscriptions', ensureUser);
app.use('/users', ensureUser);
app.use('/usage', ensureUser);

// Default rate limiter
app.use(apiRateLimiter);

// Health check endpoint
app.get('/health', (_, res) => {
  res.status(200).json({ status: 'ok' });
});

// Routes
app.use('/users', userRoutes);
app.use('/audio', audioRoutes);
app.use('/conversations', conversationRoutes);
app.use('/subscriptions', subscriptionRoutes);

// Usage stats endpoint
app.get('/usage/stats', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = getUserId(req as AuthenticatedRequest);
    if (!userId) {
      throw new AuthenticationError('Unauthorized: No user ID found');
    }
    
    const usageStats = await getUserUsageStats(userId);
    res.json({ usage: usageStats });
  } catch (error) {
    next(error);
  }
});

// 404 handler
app.use((_, res) => {
  res.status(404).json({ error: 'Not Found' });
});

// Error handler
app.use(handleError);