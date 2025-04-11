import { join } from 'path';
import { createClient } from 'redis';
import type { AppConfig } from './types/config';
import { log } from './utils/logger';

const validateEnvVars = () => {
  const requiredVars = [
    'JWT_SECRET',
    'OPENAI_API_KEY',
    'APPLE_SHARED_SECRET'
  ] as const;

  const missingVars = requiredVars.filter(key => !process.env[key]);

  if (missingVars.length > 0) {
    throw new Error(
      `FATAL ERROR: Missing required environment variables: ${missingVars.join(', ')}`
    );
  }
};

// Validate environment variables before creating config
validateEnvVars();

export const config: AppConfig = {
  port: Number(process.env.PORT) || 3001,
  nodeEnv: process.env.NODE_ENV || 'development',
  openaiApiKey: process.env.OPENAI_API_KEY!,
  appleSharedSecret: process.env.APPLE_SHARED_SECRET!,
  appleBundleId: process.env.APPLE_BUNDLE_ID || 'com.three30.vibecheck',
  validAppleBundleIds: ['com.three30.vibecheck', 'host.exp.Exponent'] as const,
  
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: Number(process.env.REDIS_PORT) || 6379,
  },
  
  uploadsDir: join(process.cwd(), 'uploads'),
  
  rateLimit: {
    windowMs: 15 * 60 * 1000,
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
  
  freeTier: {
    weeklyConversationLimit: 100,
  },

  jwt: {
    secret: process.env.JWT_SECRET!,
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  },
} as const;

export const redisClient = createClient({
  url: `redis://${config.redis.host}:${config.redis.port}`
});

redisClient.on('error', (err) => log.error('Redis Client Error:', err));

// Initialize Redis connection
(async () => {
  await redisClient.connect();
})();