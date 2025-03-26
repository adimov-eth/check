import { config } from '@/config';
import { AuthenticationError, NotFoundError } from '@/middleware/error';
import type { AuthenticatedRequest, Middleware } from '@/types/common';
import { formatError } from '@/utils/error-formatter';
import { logger } from '@/utils/logger';
import { clerkMiddleware, type ExpressRequestWithAuth } from '@clerk/express';

/**
 * Middleware for Clerk authentication
 */
export const requireAuth = clerkMiddleware({
  secretKey: config.clerkSecretKey,
});

/**
 * Extract user ID from authenticated request
 */
export const getUserId = (req: ExpressRequestWithAuth): string | null => req.auth?.userId ?? null;

/**
 * Middleware to verify user ID exists and attach it to request
 * This enhances the request with a userId property for convenience
 */
export const requireUserId: Middleware = (req, res, next): void => {
  const userId = getUserId(req as ExpressRequestWithAuth);
  if (!userId) {
    return next(new AuthenticationError('Unauthorized: No user ID found'));
  }
  
  // Attach userId to request object for convenience in route handlers
  (req as AuthenticatedRequest).userId = userId;
  next();
};

/**
 * Composable auth middleware - combines auth check and userId extraction
 */
export const authenticate: Middleware = (req, res, next): void => {
  requireAuth(req, res, (authError) => {
    if (authError) return next(authError);
    requireUserId(req, res, next);
  });
};

/**
 * Higher-order middleware to verify resource ownership
 * Confirms the authenticated user owns the requested resource
 * 
 * @param resourceFetcher Function to fetch the resource
 * @param resourceName Name of the resource (for error messages)
 */
export const requireResourceOwnership = (
  resourceFetcher: (resourceId: string, userId: string) => Promise<unknown>,
  resourceName: string = 'Resource'
): Middleware => {
  return async (req, res, next): Promise<void> => {
    try {
      // First make sure we have a userId
      const userId = (req as AuthenticatedRequest).userId || getUserId(req as ExpressRequestWithAuth);
      if (!userId) {
        return next(new AuthenticationError('Unauthorized: No user ID found'));
      }
      
      // Get the resource ID from URL params
      const resourceId = req.params.id;
      if (!resourceId) {
        return next(new NotFoundError(`${resourceName} ID not provided`));
      }
      
      // Fetch the resource and verify ownership
      const resource = await resourceFetcher(resourceId, userId);
      if (!resource) {
        return next(new NotFoundError(`${resourceName} not found: ${resourceId}`));
      }
      
      // Attach the resource to the request for use in the route handler
      (req as AuthenticatedRequest).resource = resource;
      next();
    } catch (error) {
      logger.error(`Error in requireResourceOwnership: ${formatError(error)}`);
      next(error);
    }
  };
};