import type { NextFunction, Request, Response } from 'express';
import { config } from '../config';
import { logger } from '../utils/logger';

interface RateLimitStore {
  [key: string]: {
    count: number;
    resetTime: number;
  };
}

// In-memory store for rate limits
const stores: Record<string, RateLimitStore> = {};

// Clean up expired entries periodically
const cleanupStores = (): void => {
  const now = Date.now();
  Object.keys(stores).forEach(storeName => {
    const store = stores[storeName];
    Object.keys(store).forEach(key => {
      if (store[key].resetTime <= now) {
        delete store[key];
      }
    });
  });
};

// Run cleanup every 10 minutes
setInterval(cleanupStores, 10 * 60 * 1000);

// Factory function to create rate limiter middleware
export const createRateLimiter = (
  name: string,
  maxRequests: number,
  windowMs = config.rateLimit.windowMs
) => {
  // Create store if it doesn't exist
  if (!stores[name]) {
    stores[name] = {};
  }
  
  const store = stores[name];

  return (req: Request, res: Response, next: NextFunction): void => {
    // Use IP address or user ID as key
    const key = req.auth?.userId || req.ip || 'unknown';
    const now = Date.now();

    // Initialize or reset entry if it doesn't exist or has expired
    if (!store[key] || store[key].resetTime <= now) {
      store[key] = {
        count: 0,
        resetTime: now + windowMs
      };
    }

    // Increment request count
    store[key].count += 1;

    // Calculate headers
    const currentCount = store[key].count;
    const remainingRequests = Math.max(0, maxRequests - currentCount);
    const resetTime = store[key].resetTime;

    // Set headers
    res.setHeader('RateLimit-Limit', maxRequests);
    res.setHeader('RateLimit-Remaining', remainingRequests);
    res.setHeader('RateLimit-Reset', Math.ceil(resetTime / 1000));

    // Check if rate limit is exceeded
    if (currentCount > maxRequests) {
      logger.warn(`Rate limit exceeded: ${key} on route ${req.path}`);
      res.setHeader('Retry-After', Math.ceil((resetTime - now) / 1000));
      res.status(429).json({
        error: 'Too many requests, please try again later'
      });
      return;
    }

    next();
  };
};

// Create rate limiters for different routes
export const apiRateLimiter = createRateLimiter('api', config.rateLimit.maxRequestsPerWindow.default);
export const authRateLimiter = createRateLimiter('auth', config.rateLimit.maxRequestsPerWindow.auth);
export const conversationsRateLimiter = createRateLimiter('conversations', config.rateLimit.maxRequestsPerWindow.conversations);
export const audioRateLimiter = createRateLimiter('audio', config.rateLimit.maxRequestsPerWindow.audio);
export const subscriptionsRateLimiter = createRateLimiter('subscriptions', config.rateLimit.maxRequestsPerWindow.subscriptions);
export const usageRateLimiter = createRateLimiter('usage', config.rateLimit.maxRequestsPerWindow.usage);
export const usersRateLimiter = createRateLimiter('users', config.rateLimit.maxRequestsPerWindow.users);