// src/services/session-service.ts
import { config } from '@/config';
import { AuthenticationError } from '@/middleware/error';
import type { Result } from '@/types/common';
import { formatError } from '@/utils/error-formatter';
import { log } from '@/utils/logger';
// Import jose functions and types
import { SignJWT, jwtVerify, type JWTPayload } from 'jose';

// Define payload interface extending JWTPayload
interface SessionPayload extends JWTPayload {
  userId: string;
  // Optional standard claims (jose handles exp, iat, etc.)
  iss?: string; // Issuer
  aud?: string; // Audience
}

// Prepare the secret key for jose (needs to be Uint8Array)
let secretKey: Uint8Array | null = null;
const getSecretKey = (): Uint8Array => {
  if (!secretKey) {
    if (!config.jwt.secret) {
      log.error('JWT secret is not configured. Cannot initialize secret key.');
      throw new Error('JWT_SECRET environment variable is not set or empty.');
    }
    secretKey = new TextEncoder().encode(config.jwt.secret);
  }
  return secretKey;
};

/**
 * Creates a session token (JWT) for a given user ID using jose.
 *
 * @param userId The ID of the user for whom to create the session.
 * @returns A Promise resolving to a Result containing the session token or an error.
 */
export const createSessionToken = async (userId: string): Promise<Result<string>> => {
  try {
    const key = getSecretKey();
    const payload: SessionPayload = { userId };

    // Create the JWT
    const token = await new SignJWT(payload)
      .setProtectedHeader({ alg: 'HS256' }) // Set algorithm
      .setIssuedAt() // Set issued at timestamp
      .setExpirationTime(config.jwt.expiresIn) // Set expiration (e.g., '2h', '7d')
      // .setIssuer('urn:example:issuer') // Optional: Set issuer
      // .setAudience('urn:example:audience') // Optional: Set audience
      .sign(key);

    log.debug('Session token created successfully using jose', { userId });
    return { success: true, data: token };
  } catch (error) {
    log.error('Error creating session token using jose', { userId, error: formatError(error) });
    return { success: false, error: new Error('Failed to create session token') };
  }
};

/**
 * Verifies a session token (JWT) using jose and returns the decoded payload.
 *
 * @param token The session token to verify.
 * @returns A Promise resolving to a Result containing the decoded SessionPayload or an AuthenticationError.
 */
export const verifySessionToken = async (token: string): Promise<Result<SessionPayload, AuthenticationError>> => {
  try {
    const key = getSecretKey();

    // Verify the JWT
    const { payload } = await jwtVerify(token, key, {
      // Specify expected algorithms, issuer, audience if they were set during signing
      algorithms: ['HS256'],
      // issuer: 'urn:example:issuer',
      // audience: 'urn:example:audience',
    });

    // Type check the payload
    if (!payload || typeof payload.userId !== 'string') {
      throw new AuthenticationError('Invalid token payload: Missing or invalid userId');
    }

    log.debug('Session token verified successfully using jose', { userId: payload.userId });
    // Cast the verified payload to SessionPayload
    return { success: true, data: payload as SessionPayload };
  } catch (error) {
    const errorMessage = formatError(error);
    log.warn('Session token verification failed using jose', { error: errorMessage });

    // Handle specific jose errors
    if (error instanceof Error) {
       if (error.name === 'JWTExpired') {
         return { success: false, error: new AuthenticationError('Token expired') };
       }if (error.name === 'JWSSignatureVerificationFailed' || error.name === 'JWSInvalid') {
         return { success: false, error: new AuthenticationError('Invalid token signature') };
       }if (error.name === 'JWTClaimValidationFailed') {
         return { success: false, error: new AuthenticationError(`Token claim validation failed: ${error.message}`) };
       }if (error.message.includes('JWT_SECRET')) {
         // Catch the error from getSecretKey()
         return { success: false, error: new AuthenticationError('Server configuration error during token verification') };
       }
    }

    // Generic fallback
    return { success: false, error: new AuthenticationError('Token verification failed') };
  }
};

// Optional: Add functions for session revocation if needed
