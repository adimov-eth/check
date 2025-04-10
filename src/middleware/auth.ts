import { AuthenticationError, NotFoundError } from '@/middleware/error';
import type { AuthenticatedRequest, Middleware } from '@/types/common';
import { verifyAppleToken } from '@/utils/apple-auth';
import { formatError } from '@/utils/error-formatter';
import { log } from '@/utils/logger';
import jwt from 'jsonwebtoken';

/** 
 * Decoded Apple token payload interface
 */
interface DecodedAppleToken {
  sub: string; // Apple's unique user ID
  email?: string;
  email_verified?: boolean;
  is_private_email?: boolean;
  // Name might not be present in the token itself after first login
  // It's only included in the first sign-in response
}

/**
 * Extract token from Authorization header
 */
const extractToken = (req: AuthenticatedRequest): string | null => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return null;
  return authHeader.slice(7);
};

/**
 * Middleware for Apple authentication
 */
export const requireAuth: Middleware = async (req, res, next) => {
  try {
    const token = extractToken(req as AuthenticatedRequest);
    if (!token) {
      return next(new AuthenticationError('Unauthorized: No token provided'));
    }

    // Verify the token signature and basic claims with Apple
    const result = await verifyAppleToken(token);
    if (!result.success) {
      return next(new AuthenticationError(`Unauthorized: ${result.error.message}`));
    }

    // Attach user info to request
    const authReq = req as AuthenticatedRequest;
    authReq.userId = `apple:${result.data.userId}`;
    authReq.email = result.data.email; // Email from verified token

    // Attempt to decode the token to get additional fields
    // This is less critical as the primary source should be the DB
    // Apple often only includes name/email in the *first* token
    try {
      const decodedPayload = jwt.decode(token) as DecodedAppleToken | null;
      if (decodedPayload?.email && !authReq.email) {
        // Fallback if verifyAppleToken didn't return it but decode did
        authReq.email = decodedPayload.email;
      }
    } catch (decodeError) {
      log.warn(`Could not decode token payload after verification`, { error: formatError(decodeError) });
      // Continue since token was already verified
    }

    next();
  } catch (error) {
    log.error(`Error in requireAuth middleware`, { error: formatError(error) });
    next(new AuthenticationError('Unauthorized: Invalid token'));
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