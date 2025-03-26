import { authenticate } from '@/middleware/auth';
import { NotFoundError } from '@/middleware/error';
import { getUserUsageStats } from '@/services/usage-service';
import { getUser, upsertUser } from '@/services/user-service';
import { logger } from '@/utils/logger';
import { asyncHandler } from '@/utils/async-handler';
import { formatError } from '@/utils/error-formatter';
import type { AuthenticatedRequest, RequestHandler } from '@/types/common';
import type { ExpressRequestWithAuth } from '@clerk/express';
import { Router } from 'express';

const router = Router();

/**
 * Get current user data with usage stats
 */
const getCurrentUser: RequestHandler = async (req, res) => {
  const { userId } = req as AuthenticatedRequest;
  
  try {
    // Get user info and usage stats
    const [user, usageStats] = await Promise.all([
      getUser(userId),
      getUserUsageStats(userId)
    ]);

    if (!user) {
      // User exists in Clerk but not in our database
      // This shouldn't happen with proper middleware, but let's be defensive
      logger.warn(`User ${userId} found in auth but not in database - creating minimal record`);
      
      // Create a minimal user record using auth data
      const auth = (req as ExpressRequestWithAuth).auth;
      if (auth?.sessionClaims?.email) {
        const result = await upsertUser({
          id: userId,
          email: auth.sessionClaims.email as string,
          name: auth.sessionClaims.name as string
        });
        
        if (result.success) {
          // Retry getting the user
          const createdUser = await getUser(userId);
          if (createdUser) {
            logger.info(`Successfully created and retrieved user ${userId}`);
            return res.json({
              ...createdUser,
              usage: {
                currentUsage: usageStats.currentUsage,
                limit: usageStats.limit,
                isSubscribed: usageStats.isSubscribed,
                remainingConversations: usageStats.remainingConversations,
                resetDate: usageStats.resetDate
              }
            });
          }
        } else {
          logger.error(`Failed to create user: ${formatError(result.error)}`);
        }
      }
      
      // If we couldn't create the user with proper email, fall back to error
      throw new NotFoundError(`User not found: ${userId}`);
    }
    
    logger.debug(`User data retrieved successfully: ${userId}`);
    return res.json({
      ...user,
      usage: {
        currentUsage: usageStats.currentUsage,
        limit: usageStats.limit,
        isSubscribed: usageStats.isSubscribed,
        remainingConversations: usageStats.remainingConversations,
        resetDate: usageStats.resetDate
      }
    });
  } catch (error) {
    logger.error(`Error retrieving user data: ${formatError(error)}`);
    throw error;
  }
};

// Define routes with middleware
router.get('/me', authenticate, asyncHandler(getCurrentUser));

export default router;