import { verifyAppleIdentityTokenJws } from '@/services/apple-jws-verifier'; // Import new jose-based verifier
import type { Result } from '@/types/common';
import { cacheAppleAuthResult, getCachedAppleAuth } from './apple-auth-cache';
import { formatError } from './error-formatter';
import { log } from './logger';

/**
 * Verifies an Apple ID token using jose and returns the user information
 *
 * @param identityToken The ID token received from Apple
 * @returns Result with user information if verification is successful
 */
export const verifyAppleToken = async (identityToken: string): Promise<Result<{ userId: string; email?: string }>> => {
  try {
    // Check cache first
    const cachedResult = await getCachedAppleAuth(identityToken);
    if (cachedResult) {
      return cachedResult;
    }

    const result = await verifyAppleIdentityTokenJws(identityToken);

    if (result.isValid && result.payload?.sub) {
      const userId = result.payload.sub; // Apple's unique ID
      const email = result.payload.email; // Email might be null or private
      log.debug(`Successfully verified Apple identity token for user sub: ${userId}`);

      // Cache the successful verification result
      const successResult = { success: true as const, data: { userId, email } };
      await cacheAppleAuthResult(identityToken, successResult);
      return successResult;
    }
      // Cache the failure result
      const error = new Error(result.error || 'Apple token verification failed');
      log.error(`Error verifying Apple ID token: ${formatError(error)}`);
      const failureResult = { success: false as const, error };
      await cacheAppleAuthResult(identityToken, failureResult); // Cache failures too to prevent retries
      return failureResult;

  } catch (error) {
    log.error(`Error verifying Apple ID token: ${formatError(error)}`);
    return {
      success: false,
      error: error instanceof Error ? error : new Error(String(error))
    };
  }
}; 