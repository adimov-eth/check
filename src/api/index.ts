// src/api/index.ts
import { config } from '@/config';
import { getUserId } from '@/middleware/auth'; // Import getUserId
import { ensureUser } from '@/middleware/ensure-user';
import { AuthenticationError, handleError } from '@/middleware/error'; // Import AuthenticationError
import { apiRateLimiter } from '@/middleware/rate-limit';
import { getUserUsageStats } from '@/services/usage-service'; // Import getUserUsageStats
import { logger } from '@/utils/logger';
import type { ExpressRequestWithAuth } from '@clerk/express';
import { clerkMiddleware } from '@clerk/express';
import cors from 'cors';
import type { NextFunction, Request, Response } from 'express';
import express from 'express';
import helmet from 'helmet';
import audioRoutes from './routes/audio';
import conversationRoutes from './routes/conversation';
import subscriptionRoutes from './routes/subscription';
import userRoutes from './routes/user';
import webhookRoutes from './routes/webhook';

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

// Webhook routes first (before body parsing)
app.use('/api', webhookRoutes);

// Parse JSON requests (skip for webhook routes)
app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) {
    return next();
  }
  express.json()(req, res, next);
});

// Clerk authentication
app.use(clerkMiddleware({
  secretKey: config.clerkSecretKey
}));

// Ensure user exists in database
app.use(ensureUser);

// Default rate limiter
app.use(apiRateLimiter);

// Health check endpoint
app.get('/health', (_, res) => {
  res.status(200).json({ status: 'ok' });
});

// Routes
app.use('/audio', audioRoutes);
app.use('/conversations', conversationRoutes);
app.use('/subscriptions', subscriptionRoutes);
app.use('/users', userRoutes);

// Usage stats endpoint
app.get('/usage/stats', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = getUserId(req as ExpressRequestWithAuth);
    if (!userId) {
      throw new AuthenticationError('Unauthorized: No user ID found');
    }
    
    const usageStats = await getUserUsageStats(userId);
    res.json(usageStats);
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