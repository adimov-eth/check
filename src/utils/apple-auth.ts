import type { Result } from '@/types/common';
import jwt from 'jsonwebtoken';
import jwkToPem from 'jwk-to-pem';
import fetch from 'node-fetch';
import { formatError } from './error-formatter';
import { logger } from './logger';

interface ApplePublicKey {
  kty: "RSA";
  kid: string;
  use: string;
  alg: string;
  n: string;
  e: string;
}

interface AppleKeyResponse {
  keys: ApplePublicKey[];
}

interface AppleTokenPayload {
  iss: string;
  aud: string;
  exp: number;
  iat: number;
  sub: string; // Apple User ID
  email?: string;
  email_verified?: boolean;
  is_private_email?: boolean;
  auth_time?: number;
  nonce_supported?: boolean;
}

/**
 * Retrieves Apple's public keys needed to verify JWT tokens
 */
async function getApplePublicKeys(): Promise<Result<AppleKeyResponse>> {
  try {
    const response = await fetch('https://appleid.apple.com/auth/keys');
    if (!response.ok) {
      throw new Error(`Failed to fetch Apple public keys: ${response.statusText}`);
    }
    const keys = await response.json() as AppleKeyResponse;
    return { success: true, data: keys };
  } catch (error) {
    logger.error(`Error fetching Apple public keys: ${formatError(error)}`);
    return {
      success: false,
      error: error instanceof Error ? error : new Error(String(error))
    };
  }
}

/**
 * Verifies an Apple ID token and returns the user information
 * 
 * @param identityToken The ID token received from Apple
 * @returns Result with user information if verification is successful
 */
export const verifyAppleToken = async (identityToken: string): Promise<Result<{ userId: string; email?: string }>> => {
  try {
    // First, decode the token without verification to get the header
    const decodedToken = jwt.decode(identityToken, { complete: true });
    if (!decodedToken || typeof decodedToken === 'string') {
      throw new Error('Invalid token format');
    }

    // Get the key ID from the token header
    const keyId = decodedToken.header.kid;
    if (!keyId) {
      throw new Error('Token header missing key ID');
    }

    // Fetch Apple's public keys
    const keysResult = await getApplePublicKeys();
    if (!keysResult.success) {
      throw keysResult.error;
    }

    // Find the matching key
    const matchingKey = keysResult.data.keys.find(key => key.kid === keyId);
    if (!matchingKey) {
      throw new Error(`No matching key found for kid: ${keyId}`);
    }

    // Convert Apple's JWK format to PEM format that jwt.verify can use
    const publicKeyPem = jwkToPem(matchingKey);

    // Verify the token
    try {
      const verified = jwt.verify(identityToken, publicKeyPem, {
        algorithms: ['RS256'],
      }) as AppleTokenPayload;
      
      // Additional verification
      // Verify token is for your app 
      if (verified.aud !== 'com.three30.vibecheck') {
        throw new Error(`Token was issued for a different app: ${verified.aud}`);
      }

      // Verify issuer is Apple
      if (verified.iss !== 'https://appleid.apple.com') {
        throw new Error(`Token has invalid issuer: ${verified.iss}`);
      }

      return {
        success: true,
        data: {
          userId: verified.sub,
          email: verified.email
        }
      };
    } catch (jwtError) {
      logger.error(`JWT verification failed: ${formatError(jwtError)}`);
      throw jwtError;
    }
  } catch (error) {
    logger.error(`Error verifying Apple ID token: ${formatError(error)}`);
    return {
      success: false,
      error: error instanceof Error ? error : new Error(String(error))
    };
  }
}; 