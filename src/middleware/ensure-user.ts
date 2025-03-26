import { getUserId } from '@/middleware/auth';
import { userCache } from '@/services/user-cache-service';
import { getUser, upsertUser } from '@/services/user-service';
import type { Middleware } from '@/types/common';
import { formatError } from '@/utils/error-formatter';
import { logger } from '@/utils/logger';
import type { ExpressRequestWithAuth } from '@clerk/express';

/**
 * Middleware to ensure a user exists in our database
 * Checks cache first, then database, creates user if needed
 */
export const ensureUser: Middleware = (req, res, next): void => {
  const handleAsync = async () => {
    const userId = getUserId(req as ExpressRequestWithAuth);
    if (!userId) {
      return;
    }

    // Check cache first
    const exists = userCache.get(userId);
    if (exists) {
      return;
    }

    // If not in cache or cache expired, check database
    const user = await getUser(userId);
    
    if (user) {
      userCache.set(userId, true);
      return;
    }

    // User doesn't exist, get their info from Clerk auth object
    const auth = (req as ExpressRequestWithAuth).auth;
    
    // Always create a user record, even if we don't have complete information
    try {
      if (auth?.userId && auth.sessionClaims?.email) {
        // We have complete information, create a proper user record
        const result = await upsertUser({
          id: auth.userId,
          email: auth.sessionClaims.email as string,
          name: auth.sessionClaims.name as string
        });
        
        if (result.success) {
          userCache.set(userId, true);
          logger.info(`Created missing user record for ${userId} with complete info`);
        } else {
          logger.error(`Failed to create user record: ${formatError(result.error)}`);
        }
      } else if (auth?.userId) {
        // We only have userId, create a minimal record
        // This shouldn't normally happen, but we want to be robust
        const tempEmail = `${auth.userId}@temporary.vibecheck.app`;
        
        const result = await upsertUser({
          id: auth.userId,
          email: tempEmail,
          name: undefined
        });
        
        if (result.success) {
          userCache.set(userId, true);
          logger.warn(`Created minimal user record for ${userId} without email claim`);
        } else {
          logger.error(`Failed to create minimal user record: ${formatError(result.error)}`);
        }
      } else {
        // This is a highly unusual situation - we have a userId from Clerk but no auth object
        logger.warn('Missing auth object for authenticated user', { userId });
        
        // Still try to create a minimal record
        const tempEmail = `${userId}@temporary.vibecheck.app`;
        
        const result = await upsertUser({
          id: userId,
          email: tempEmail,
          name: undefined
        });
        
        if (result.success) {
          userCache.set(userId, true);
          logger.warn(`Created emergency minimal user record for ${userId} with no auth data`);
        } else {
          logger.error(`Failed to create emergency user record: ${formatError(result.error)}`);
        }
      }
    } catch (error) {
      // Log but don't throw - we want to continue processing the request
      logger.error(`Error ensuring user exists: ${formatError(error)}`);
    }
  };

  // Properly handle async errors
  handleAsync()
    .then(() => next())
    .catch(error => {
      logger.error(`Error in ensureUser middleware: ${formatError(error)}`);
      next(error);
    });
}; 