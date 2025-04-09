import { getUserId, requireAuth } from '@/middleware/auth';
import { AuthenticationError, NotFoundError } from '@/middleware/error';
import { getUserUsageStats } from '@/services/usage-service';
import { authenticateWithApple, getUser, upsertUser } from '@/services/user-service';
import type { AuthenticatedRequest } from '@/types/common';
import { asyncHandler } from '@/utils/async-handler';
import { formatError } from '@/utils/error-formatter';
import { log } from '@/utils/logger';
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
      log.warn(`User found in auth but not in database - creating minimal record`, { userId });
      
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
            log.info(`Successfully created and retrieved user`, { userId });
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
          log.error(`Failed to create user`, { userId, error: formatError(result.error) });
        }
      }
      
      // If we couldn't create the user with proper email, fall back to error
      throw new NotFoundError(`User not found: ${userId}`);
    }
    
    log.debug(`User data retrieved successfully`, { userId });
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
    log.error(`Error retrieving user data`, { error: formatError(error) });
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
    
    log.info(`User authenticated successfully with Apple`, { userId: authResult.data.id });
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
    log.error(`Error in Apple authentication endpoint`, { error: formatError(error) });
    res.status(500).json({
      success: false,
      error: 'Authentication failed'
    });
  }
};

/**
 * Get current user's usage stats
 */
const getUserUsage = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<unknown> => {
  const userId = getUserId(req as AuthenticatedRequest);
  if (!userId) {
    // This check might be redundant if requireAuth guarantees userId, but good defense
    return next(new AuthenticationError('Unauthorized: User ID missing for usage stats'));
  }

  try {
    const usageStats = await getUserUsageStats(userId);
    log.debug('Retrieved usage stats', { userId });
    return res.json({ usage: usageStats });
  } catch (error) {
    log.error('Error retrieving usage stats', { userId, error: formatError(error) });
    next(error);
  }
};

// Routes
router.get('/me', requireAuth, asyncHandler(getCurrentUser));
router.post('/apple-auth', asyncHandler(appleAuth));
router.get('/usage', requireAuth, asyncHandler(getUserUsage));

export default router;