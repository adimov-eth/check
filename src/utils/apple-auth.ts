import { verifyAppleIdentityTokenJws } from '@/services/apple-jws-verifier'; // Import new jose-based verifier
import type { Result } from '@/types/common';
import { formatError } from './error-formatter';
import { logger } from './logger';

/**
 * Verifies an Apple ID token using jose and returns the user information
 *
 * @param identityToken The ID token received from Apple
 * @returns Result with user information if verification is successful
 */
export const verifyAppleToken = async (identityToken: string): Promise<Result<{ userId: string; email?: string }>> => {
  try {
    // Verify the token using the jose-based function
    const verificationResult = await verifyAppleIdentityTokenJws(identityToken);

    if (!verificationResult.isValid || !verificationResult.payload) {
      // Use the error message from the jose verifier
      throw new Error(verificationResult.error || 'Apple JWS verification failed');
    }

    const payload = verificationResult.payload;

    // Additional verification (already done in verifyAppleIdentityTokenJws, but can double-check here if needed)
    // Issuer and Audience checks are handled by verifyAppleIdentityTokenJws

    logger.debug(`Successfully verified Apple identity token for user sub: ${payload.sub}`);
    return {
      success: true,
      data: {
        userId: payload.sub, // 'sub' claim is the Apple User ID
        email: payload.email
      }
    };

  } catch (error) {
    logger.error(`Error verifying Apple ID token: ${formatError(error)}`);
    return {
      success: false,
      error: error instanceof Error ? error : new Error(String(error))
    };
  }
}; 