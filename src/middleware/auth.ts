// /Users/adimov/Developer/final/check/src/middleware/auth.ts
import { verifySessionToken } from '@/services/session-service';
import type { AuthenticatedRequest, Resource } from '@/types/common'; // Import Resource type
import { formatError } from '@/utils/error-formatter';
import { log } from '@/utils/logger';
import type { NextFunction, Request, Response } from 'express';
// --- FIX: Import AuthorizationError instead of ForbiddenError ---
import { AuthenticationError, AuthorizationError, NotFoundError } from './error';
// --- End Fix ---

// Type for the function that fetches a resource by ID
type GetResourceById<T extends Resource> = (id: string) => Promise<T | null>;

export const requireAuth = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next(new AuthenticationError('Unauthorized: Missing or invalid Bearer token'));
  }

  const token = authHeader.split(' ')[1];
  if (!token) {
    return next(new AuthenticationError('Unauthorized: Token is missing'));
  }

  try {
    const result = await verifySessionToken(token);

    if (!result.success) {
      // Forward the specific error from verifySessionToken
      return next(result.error);
    }

    const payload = result.data;

    // Attach user details to the request object
    const authReq = req as AuthenticatedRequest;
    authReq.userId = payload.userId;
    // Optionally attach other details if needed by handlers
    // authReq.email = payload.email; // If email is in session payload
    // authReq.fullName = ... // If name is in session payload

    log.debug("Session token validated for user", { userId: payload.userId });
    next(); // Proceed to the next middleware or route handler
  } catch (error) {
    // Catch unexpected errors during verification
    log.error('Unexpected error during token verification', { error: formatError(error) });
    next(new AuthenticationError('Token verification failed unexpectedly'));
  }
};

// Helper to safely get userId - assumes requireAuth ran successfully
export const getUserId = (req: AuthenticatedRequest): string | undefined => {
  return req.userId;
};


/**
 * Middleware factory to ensure the authenticated user owns the requested resource.
 * Assumes `requireAuth` has already run and `req.userId` is populated.
 * Fetches the resource using the provided getter function and attaches it to `req.resource`.
 *
 * @param getResourceById - An async function that takes a resource ID and returns the resource or null.
 * @param resourceName - The name of the resource type (e.g., 'Conversation') for error messages.
 * @param idParamName - The name of the parameter in req.params containing the resource ID. Defaults to 'id'.
 * @returns An Express middleware function.
 */
export const requireResourceOwnership = <T extends Resource>({
  getResourceById,
  resourceName = 'Resource',
  idParamName = 'id',
}: {
  getResourceById: GetResourceById<T>;
  resourceName?: string;
  idParamName?: string;
}) => {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    const { userId } = authReq;
    const resourceId = req.params[idParamName]; // Get ID using the specified param name

    if (!userId) {
      // Should not happen if requireAuth is used first, but good practice
      return next(new AuthenticationError('User ID not found on request. Ensure requireAuth runs first.'));
    }

    if (!resourceId) {
      return next(new Error(`Resource ID not found in request parameters (expected '${idParamName}').`));
    }

    try {
      const resource = await getResourceById(resourceId);

      if (!resource) {
        log.warn(`${resourceName} not found`, { [idParamName]: resourceId, userId });
        return next(new NotFoundError(`${resourceName} not found`));
      }

      // Check ownership
      if (resource.userId !== userId) {
        log.warn(`User attempted to access unowned ${resourceName}`, { [idParamName]: resourceId, ownerUserId: resource.userId, requestingUserId: userId });
        return next(new AuthorizationError(`You do not have permission to access this ${resourceName}`));
      }

      // Attach the fetched resource to the request for subsequent handlers
      authReq.resource = resource;
      log.debug(`${resourceName} ownership verified`, { [idParamName]: resourceId, userId });
      next();
    } catch (error) {
      log.error(`Error fetching or verifying ${resourceName} ownership`, { [idParamName]: resourceId, userId, error: formatError(error) });
      next(error); // Pass other errors (e.g., database errors) to the main error handler
    }
  };
};