import { redisClient } from '@/config'; // Import the Redis client
import type { Result } from '@/types/common';
import { formatError } from './error-formatter'; // Import error formatter
import { log } from './logger';

// Define TTL in seconds for Redis 'EX' option
const CACHE_TTL_SECONDS = 5 * 60; // 5 minutes

// Define a prefix for Redis keys
const CACHE_KEY_PREFIX = 'apple_auth:';

// Interface for the structure of a serialized error
interface SerializedError {
    message: string;
    name?: string;
    // stack?: string; // Optionally include stack
}

/**
 * Gets a cached Apple token verification result from Redis.
 * Returns undefined if not found or if there's an error.
 */
export const getCachedAppleAuth = async (token: string): Promise<Result<{ userId: string }, Error> | undefined> => {
  // Use a portion of the token or a hash if tokens are very long, but ensure uniqueness
  // For simplicity, using the full token as key here, assuming it's manageable
  const key = `${CACHE_KEY_PREFIX}${token}`;
  try {
    const cachedData = await redisClient.get(key);
    if (cachedData) {
      try {
        // Parse the JSON string stored in Redis
        const result = JSON.parse(cachedData) as Result<{ userId: string }, Error>;
        log.debug(`Using cached Apple auth result for token (start): ${token.substring(0, 10)}...`);
        // Important: Need to reconstruct Error objects if they were serialized
        if (!result.success && result.error) {
             // Re-create the error object if it was serialized as plain object
             // Use the SerializedError interface for type safety
             const serializedError = result.error as unknown as SerializedError;
             result.error = new Error(serializedError.message || String(result.error));
             if (serializedError.name) {
                result.error.name = serializedError.name;
             }
        }
        return result;
      } catch (parseError) {
        log.error(`Failed to parse cached Apple auth data for token ${token.substring(0, 10)}...: ${formatError(parseError)}`);
        // If parsing fails, treat it as a cache miss
        return undefined;
      }
    }
    // Key doesn't exist or expired
    return undefined;
  } catch (error) {
    log.error(`Redis error getting cached Apple auth for token ${token.substring(0, 10)}...: ${formatError(error)}`);
    // Treat Redis error as a cache miss
    return undefined;
  }
};

/**
 * Caches an Apple token verification result in Redis with TTL.
 */
export const cacheAppleAuthResult = async (token: string, result: Result<{ userId: string }, Error>): Promise<void> => {
  const key = `${CACHE_KEY_PREFIX}${token}`;
  try {
    // Serialize the result object to a JSON string for storage in Redis
    // Handle potential non-serializable parts like Error objects
    const resultToStore = JSON.stringify(result, (key, value) => {
        if (value instanceof Error) {
            // Serialize Error object to a plain object matching SerializedError
            return { message: value.message, name: value.name /* add stack if needed */ };
        }
        return value;
    });

    await redisClient.set(key, resultToStore, { EX: CACHE_TTL_SECONDS });
    log.debug(`Caching Apple auth result for token (start): ${token.substring(0, 10)}... with TTL ${CACHE_TTL_SECONDS}s`);
  } catch (error) {
    log.error(`Redis error caching Apple auth result for token ${token.substring(0, 10)}...: ${formatError(error)}`);
    // Log error and continue
  }
};

// The cleanupExpiredCache function and setInterval are no longer needed
// as Redis handles expiration automatically.