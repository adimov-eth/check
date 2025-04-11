import { AuthenticationError, NotFoundError } from '@/middleware/error';
import { verifySessionToken } from '@/services/session-service';
import type { AuthenticatedRequest, Middleware } from '@/types/common';
import { formatError } from '@/utils/error-formatter';
import { log } from '@/utils/logger';

/**
 * Extract token from Authorization header
 */
const extractToken = (req: AuthenticatedRequest): string | null => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return null;
  return authHeader.slice(7);
};

/**
 * Middleware for Session Token authentication
 */
export const requireAuth: Middleware = async (req, res, next) => {
  try {
    const token = extractToken(req as AuthenticatedRequest);
    if (!token) {
      return next(new AuthenticationError('Unauthorized: No token provided'));
    }

    // Verify the session token
    const result = verifySessionToken(token);
    if (!result.success) {
      // Pass the specific AuthenticationError from verifySessionToken
      return next(result.error);
    }

    // Attach user info from the session payload to the request
    const authReq = req as AuthenticatedRequest;
    authReq.userId = result.data.userId;
    // If you add email/name to JWT payload, extract them here:
    // authReq.email = result.data.email;
    // authReq.fullName = result.data.fullName;

    log.debug(`Session token validated for user`, { userId: authReq.userId });
    next();
  } catch (error) {
    // Catch unexpected errors during middleware execution
    log.error(`Error in requireAuth middleware`, { error: formatError(error) });
    next(new AuthenticationError('Unauthorized: Error processing token'));
  }
};

/**
 * Extract user ID from authenticated request
 */
export const getUserId = (req: AuthenticatedRequest): string | null => req.userId ?? null;

/**
 * Middleware to verify user ID exists and attach it to request
 * This enhances the request with a userId property for convenience
 */
export const requireUserId: Middleware = (req, res, next): void => {
  const userId = getUserId(req as AuthenticatedRequest);
  if (!userId) {
    return next(new AuthenticationError('Unauthorized: No user ID found'));
  }
  next();
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
      const userId = (req as AuthenticatedRequest).userId;
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
      log.error(`Error in requireResourceOwnership middleware`, { resourceName, resourceId: req.params.id, userId: (req as AuthenticatedRequest).userId, error: formatError(error) });
      next(error);
    }
  };
};