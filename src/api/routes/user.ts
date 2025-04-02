import { requireAuth } from '@/middleware/auth';
import { NotFoundError } from '@/middleware/error';
import { getUserUsageStats } from '@/services/usage-service';
import { authenticateWithApple, getUser, upsertUser } from '@/services/user-service';
import type { AuthenticatedRequest } from '@/types/common';
import { asyncHandler } from '@/utils/async-handler';
import { formatError } from '@/utils/error-formatter';
import { logger } from '@/utils/logger';
import type { NextFunction, Request, Response } from 'express';
import { Router } from 'express';

const router = Router();

/**
 * Get current user data with usage stats
 */
const getCurrentUser = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<unknown> => {
  const { userId } = req as AuthenticatedRequest;
  
  try {
    // Get user info and usage stats
    const [user, usageStats] = await Promise.all([
      getUser(userId),
      getUserUsageStats(userId)
    ]);

    if (!user) {
      // User exists in auth but not in database
      // This shouldn't happen with proper middleware, but let's be defensive
      logger.warn(`User ${userId} found in auth but not in database - creating minimal record`);
      
      // Create a minimal user record using auth data
      const authReq = req as AuthenticatedRequest;
      if (authReq.email) {
        const result = await upsertUser({
          id: userId,
          email: authReq.email,
          name: authReq.fullName ? `${authReq.fullName.givenName} ${authReq.fullName.familyName}`.trim() : undefined
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
    next(error);
  }
};

/**
 * Apple Sign In authentication
 * POST /api/user/apple-auth
 */
const appleAuth = async (
  req: Request,
  res: Response
) => {
  const { identityToken, fullName } = req.body;
  
  if (!identityToken) {
    return res.status(400).json({
      success: false,
      error: 'Identity token is required'
    });
  }
  
  // Format name if provided
  let formattedName;
  if (fullName?.givenName && fullName?.familyName) {
    formattedName = `${fullName.givenName} ${fullName.familyName}`;
  }
  
  try {
    const authResult = await authenticateWithApple(identityToken, formattedName);
    
    if (!authResult.success) {
      return res.status(401).json({
        success: false,
        error: authResult.error.message
      });
    }
    
    // Get user's usage stats after successful authentication
    const usageStats = await getUserUsageStats(authResult.data.id);
    
    logger.info(`User authenticated successfully with Apple: ${authResult.data.id}`);
    res.status(200).json({
      success: true,
      data: {
        user: {
          ...authResult.data,
          usage: {
            currentUsage: usageStats.currentUsage,
            limit: usageStats.limit,
            isSubscribed: usageStats.isSubscribed,
            remainingConversations: usageStats.remainingConversations,
            resetDate: usageStats.resetDate
          }
        }
      }
    });
  } catch (error) {
    logger.error(`Error in Apple authentication: ${formatError(error)}`);
    res.status(500).json({
      success: false,
      error: 'Authentication failed'
    });
  }
};

// Routes
router.get('/me', requireAuth, asyncHandler(getCurrentUser));
router.post('/apple-auth', asyncHandler(appleAuth));

export default router;