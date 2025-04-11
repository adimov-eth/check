// src/services/session-service.ts
import { config } from '@/config';
import { AuthenticationError } from '@/middleware/error';
import type { Result } from '@/types/common';
import { formatError } from '@/utils/error-formatter';
import { log } from '@/utils/logger';
import type { Secret, SignOptions } from 'jsonwebtoken';
import jwt from 'jsonwebtoken';

interface SessionPayload {
  readonly userId: string;
  // Add other relevant session data if needed, e.g., roles, session ID for revocation
}

/**
 * Creates a session token (JWT) for a given user ID.
 *
 * @param userId The ID of the user for whom to create the session.
 * @returns A Result containing the session token or an error.
 */
export const createSessionToken = (userId: string): Result<string> => {
  try {
    if (!config.jwt.secret) {
      log.error('JWT secret is not configured. Cannot create session token.');
      throw new Error('JWT_SECRET environment variable is not set or empty.');
    }

    const payload: SessionPayload = { userId };
    const secret: Secret = String(config.jwt.secret);
    const options: SignOptions = {
      expiresIn: `${config.jwt.expiresIn}` as SignOptions['expiresIn'],
    };

    const token = jwt.sign(payload, secret, options);

    log.debug('Session token created successfully', { userId });
    return { success: true, data: token };
  } catch (error) {
    log.error('Error creating session token', { userId, error: formatError(error) });
    return { success: false, error: new Error('Failed to create session token') };
  }
};

/**
 * Verifies a session token (JWT) and returns the decoded payload.
 *
 * @param token The session token to verify.
 * @returns A Result containing the decoded SessionPayload or an AuthenticationError.
 */
export const verifySessionToken = (token: string): Result<SessionPayload, AuthenticationError> => {
  try {
    if (!config.jwt.secret) {
      log.error('JWT secret is not configured. Cannot verify session token.');
      throw new Error('JWT_SECRET environment variable is not set or empty.');
    }

    const secret: Secret = String(config.jwt.secret);
    const decoded = jwt.verify(token, secret) as SessionPayload;

    if (!decoded?.userId) {
      throw new AuthenticationError('Invalid token payload: Missing userId');
    }

    log.debug('Session token verified successfully', { userId: decoded.userId });
    return { success: true, data: decoded };
  } catch (error) {
    log.warn('Session token verification failed', { error: formatError(error) });
    
    if (error instanceof jwt.TokenExpiredError) {
      return { success: false, error: new AuthenticationError('Token expired') };
    }
    
    if (error instanceof jwt.JsonWebTokenError) {
      return { success: false, error: new AuthenticationError(`Invalid token: ${error.message}`) };
    }
    
    if (error instanceof Error && error.message.includes('JWT_SECRET')) {
      return { 
        success: false, 
        error: new AuthenticationError('Server configuration error during token verification')
      };
    }
    
    return { success: false, error: new AuthenticationError('Token verification failed') };
  }
};

// Optional: Add functions for session revocation if needed (requires storing session IDs)
// export const invalidateSession = async (sessionId: string): Promise<void> => { ... }