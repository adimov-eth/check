import { redisClient } from '@/config'; // Import the Redis client
import { formatError } from '@/utils/error-formatter'; // Import error formatter
import { log } from '@/utils/logger';

// Define TTL in seconds for Redis 'EX' option
const CACHE_TTL_SECONDS = 10 * 60; // 10 minutes

// Define a prefix for Redis keys to avoid collisions
const CACHE_KEY_PREFIX = 'user_exists:';

/**
 * Checks if a user ID exists in the Redis cache.
 */
const get = async (userId: string): Promise<boolean> => {
  const key = `${CACHE_KEY_PREFIX}${userId}`;
  try {
    const exists = await redisClient.exists(key);
    if (exists) {
      log.debug(`User existence cache hit for: ${userId}`);
      return true;
    }
    return false;
  } catch (error) {
    log.error(`Redis error checking user existence for ${userId}`, { error: formatError(error) });
    // In case of Redis error, bypass cache check to avoid blocking functionality
    return false;
  }
};

/**
 * Adds or removes a user ID existence flag in the Redis cache with TTL.
 */
const set = async (userId: string, exists: boolean): Promise<void> => {
  const key = `${CACHE_KEY_PREFIX}${userId}`;
  try {
    if (exists) {
      // Set the key with a value of '1' and an expiration time
      await redisClient.set(key, '1', { EX: CACHE_TTL_SECONDS });
      log.debug(`Caching user existence for: ${userId}`, { ttl: CACHE_TTL_SECONDS });
    } else {
      // Remove the key if the user doesn't exist (or if we need to invalidate)
      await redisClient.del(key);
      log.debug(`Removing user existence cache entry for: ${userId}`);
    }
  } catch (error) {
    log.error(`Redis error setting user existence for ${userId}`, { error: formatError(error) });
    // Error during set is less critical, log and continue
  }
};

// The cleanupExpiredCache function and setInterval are no longer needed
// as Redis handles expiration automatically.

export const userCache = {
  get,
  set,
}; 