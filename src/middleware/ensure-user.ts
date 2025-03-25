import { getUserId } from '@/middleware/auth';
import { userCache } from '@/services/user-cache-service';
import { getUser, upsertUser } from '@/services/user-service';
import { logger } from '@/utils/logger';
import type { ExpressRequestWithAuth } from '@clerk/express';
import type { NextFunction, Request, Response } from 'express';

export const ensureUser = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
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
    if (!auth?.userId || !auth.sessionClaims?.email) {
      logger.warn('Missing user info in auth object', { userId });
      return;
    }

    // Create user in database
    await upsertUser({
      id: auth.userId,
      email: auth.sessionClaims.email as string,
      name: auth.sessionClaims.name as string
    });

    userCache.set(userId, true);
    logger.info(`Created missing user record for ${userId}`);
  };

  // Properly handle async errors
  handleAsync()
    .then(() => next())
    .catch(error => {
      logger.error(`Error in ensureUser middleware: ${error instanceof Error ? error.message : String(error)}`);
      next(error);
    });
}; 