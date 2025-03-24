// src/api/index.ts
import { config } from '@/config';
import { logger } from '@/utils/logger';
import { clerkMiddleware } from '@clerk/express';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';

import { handleError } from '@/middleware/error';
import { apiRateLimiter } from '@/middleware/rate-limit';

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

// Parse JSON requests
app.use(express.json());

// Clerk authentication
app.use(clerkMiddleware({
  secretKey: config.clerkSecretKey
}));

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
app.use('/webhook', webhookRoutes);

// 404 handler
app.use((_, res) => {
  res.status(404).json({ error: 'Not Found' });
});

// Error handler
app.use(handleError);