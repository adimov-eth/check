// src/api/index.ts
import { config } from '@/config';
import { getUserId } from '@/middleware/auth';
import { ensureUser } from '@/middleware/ensure-user';
import { AuthenticationError, handleError } from '@/middleware/error';
import { apiRateLimiter } from '@/middleware/rate-limit';
import { getUserUsageStats } from '@/services/usage-service';
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

// Clerk authentication - only apply to routes that need authentication
app.use('/audio', clerkMiddleware({
  secretKey: config.clerkSecretKey
}));
app.use('/conversations', clerkMiddleware({
  secretKey: config.clerkSecretKey
}));
app.use('/subscriptions', clerkMiddleware({
  secretKey: config.clerkSecretKey
}));
app.use('/users', clerkMiddleware({
  secretKey: config.clerkSecretKey
}));
app.use('/usage', clerkMiddleware({
  secretKey: config.clerkSecretKey
}));

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
    res.json({ usage: usageStats }); // Updated to wrap usageStats in { usage: ... }
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