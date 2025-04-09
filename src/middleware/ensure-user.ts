// src/middleware/ensure-user.ts

import { getUser, upsertUser } from '@/services/user-service';
import type { AuthenticatedRequest, Middleware } from '@/types/common';
import { formatError } from '@/utils/error-formatter';
import { log } from '@/utils/logger'; // Use 'log' object
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
      log.debug(`User already exists in database`, { userId });
      return next();
    }

    // User doesn't exist, attempt to create a minimal record (if possible)
    log.warn(`User not found in DB, attempting to create record`, { userId });

    if (email) {
      const result = await upsertUser({
        id: userId,
        email: email,
        name: undefined // Or get name from somewhere else
      });

      if (result.success) {
        log.info(`Successfully created minimal user record`, { userId });
        return next(); // Proceed after successful creation
      } else {
        log.error(`Failed to create user record`, { userId, error: formatError(result.error) });
        return next(result.error); // Pass the error to the error handler
      }
    } else {
      // If no email, we can't create a minimal record.  Throw a NotFoundError
      log.error(`User not found and no email available to create a record`, { userId });
      return next(new NotFoundError(`User not found: ${userId}`));
    }

  } catch (error) {
    log.error(`Error in ensureUser middleware`, { userId, error: formatError(error) });
    next(error);
  }
};