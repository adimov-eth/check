import { join } from 'path';
import { createClient } from 'redis';
import { logger } from './utils/logger';
export const config = {
    port: Number(process.env.PORT) || 3001,
    clerkSecretKey: process.env.CLERK_SECRET_KEY || '',
    clerkWebhookSecret: process.env.CLERK_WEBHOOK_SECRET || '',
    openaiApiKey: process.env.OPENAI_API_KEY || '',
    appleSharedSecret: process.env.APPLE_SHARED_SECRET || '',
    nodeEnv: process.env.NODE_ENV || 'development',
    
    // Redis configuration
    redis: {
      host: process.env.REDIS_HOST || 'localhost',
      port: Number(process.env.REDIS_PORT) || 6379,
    },
    
    // File upload configuration
    uploadsDir: join(process.cwd(), 'uploads'),
    
    // Rate limiting configuration
    rateLimit: {
      windowMs: 15 * 60 * 1000, // 15 minutes
      maxRequestsPerWindow: {
        default: 100,
        auth: 20,
        conversations: 60,
        audio: 30,
        subscriptions: 20,
        usage: 30,
        users: 30,
      },
    },
    
    // Free tier limits
    freeTier: {
      weeklyConversationLimit: 10, // 10 free conversations per week
    },
  };



export const redisClient = createClient({
  url: `redis://${config.redis.host}:${config.redis.port}` // e.g., "redis://localhost:6379"
});

redisClient.on('error', (err) => logger.error('Redis Client Error:', err));
(async () => {
  await redisClient.connect();
})();