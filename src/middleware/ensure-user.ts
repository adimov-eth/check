import { getUserId } from '@/middleware/auth';
import { AuthenticationError } from '@/middleware/error';
import { userCache } from '@/services/user-cache-service';
import { getUser, upsertUser } from '@/services/user-service';
import type { AuthenticatedRequest, Middleware } from '@/types/common';
import { formatError } from '@/utils/error-formatter';
import { logger } from '@/utils/logger';

/**
 * Middleware to ensure a user exists in our database
 * Checks cache first, then database, creates user if needed
 */
export const ensureUser: Middleware = (req, res, next): void => {
  const handleAsync = async () => {
    const authReq = req as AuthenticatedRequest;
    const userId = getUserId(authReq);

    if (!userId) {
      // This should ideally be caught by requireAuth first
      throw new AuthenticationError('User ID missing after authentication middleware');
    }

    // Check cache first - AWAIT the result
    const exists = await userCache.get(userId);
    if (exists) {
      return; // User known to exist, continue
    }

    // If not in cache or cache expired, check database
    const user = await getUser(userId);

    if (user) {
      await userCache.set(userId, true); // Update cache - Also await this
      return; // User exists in DB, continue
    }

    // User not found in cache or DB - attempt to create
    logger.info(`User ${userId} not found in DB, attempting to create record.`);

    // Use email directly from the authenticated request if available
    const emailToUse = authReq.email;
    if (!emailToUse) {
      // If email is missing after auth, it's a problem.
      // Avoid creating users with temporary emails if possible.
      logger.warn(`Cannot create user ${userId}: Email missing from authenticated request.`);
      // Decide if this is a fatal error for the request:
      // throw new Error(`User creation failed for ${userId}: Email missing.`);
      // Or allow continuation:
      return; // Or proceed without user creation if non-critical
    }

    // Name is not reliably available from token after first login.
    // Let upsertUser handle potential existing name or null.
    const result = await upsertUser({
      id: userId,
      email: emailToUse,
      name: undefined // Let upsertUser handle potential existing name or null
    });

    if (result.success) {
      await userCache.set(userId, true); // Await cache set here too
      logger.info(`Created user record for ${userId}`);
    } else {
      // If upsert failed, log the error and re-throw it
      logger.error(`Failed to create user record for ${userId}: ${formatError(result.error)}`);
      throw result.error; // Propagate the error
    }
  };

  // Properly handle async errors
  handleAsync()
    .then(() => next())
    .catch(error => {
      // Log the specific error from ensureUser
      logger.error(`Error in ensureUser middleware for user ${getUserId(req as AuthenticatedRequest) || 'unknown'}: ${formatError(error)}`);
      // Pass the error to the global error handler
      next(error);
    });
}; 