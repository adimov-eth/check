// src/middleware/ensure-user.ts

import { getUser, upsertUser } from '@/services/user-service';
import type { AuthenticatedRequest, Middleware } from '@/types/common';
import { formatError } from '@/utils/error-formatter';
import { logger } from '@/utils/logger';
import { NotFoundError } from './error';

export const ensureUser: Middleware = async (req, res, next) => {
  const { userId, email } = req as AuthenticatedRequest;

  if (!userId) {
    return next(new Error('User ID is missing'));
  }

  try {
    const existingUser = await getUser(userId);

    if (existingUser) {
      // User already exists, proceed to the next middleware/route handler
      logger.debug(`User ${userId} already exists in database`);
      return next();
    }

    // User doesn't exist, attempt to create a minimal record (if possible)
    logger.warn(`User ${userId} not found in DB, attempting to create record.`);

    if (email) {
      const result = await upsertUser({
        id: userId,
        email: email,
        name: undefined // Or get name from somewhere else
      });

      if (result.success) {
        logger.info(`Successfully created minimal user record for ${userId}`);
        return next(); // Proceed after successful creation
      } else {
        logger.error(`Failed to create user record for ${userId}: ${formatError(result.error)}`);
        return next(result.error); // Pass the error to the error handler
      }
    } else {
      // If no email, we can't create a minimal record.  Throw a NotFoundError
      logger.error(`User ${userId} not found and no email available to create a record.`);
      return next(new NotFoundError(`User not found: ${userId}`));
    }

  } catch (error) {
    logger.error(`Error in ensureUser middleware for user ${userId}: ${formatError(error)}`);
    next(error);
  }
};